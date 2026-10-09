const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script id="bridge-code">([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, 'bridge inline script exists');

function launch(options = {}) {
  const handlers = {};
  const outgoing = [];
  const frame = { style: { display: 'none' }, src: '' };
  const message = { style: {}, textContent: '', classList: { add: () => {} } };
  const state = { ready: 0, expanded: 0, hidden: 0, closed: 0 };
  const telegram = options.initData === null ? null : {
    initData: options.initData === undefined ? 'valid-test-signed-initdata' : options.initData,
    ready: () => { state.ready++; },
    expand: () => { state.expanded++; },
    close: () => { state.closed++; },
    MainButton: { hide: () => { state.hidden++; } }
  };
  const window = {
    location: { search: options.search === undefined ? '?session=opaque-token' : options.search },
    Telegram: telegram ? { WebApp: telegram } : null,
    addEventListener: (name, callback) => { handlers[name] = callback; }
  };
  const document = { getElementById: id => ({ message, 'gas-frame': frame })[id] };
  const crypto = { getRandomValues: bytes => {
    for (let i = 0; i < bytes.length; i++) bytes[i] = i;
  } };
  vm.runInNewContext(script, { window, document, crypto, URLSearchParams });
  return { handlers, outgoing, frame, message, state, telegram };
}

function request(app, origin = 'https://script.google.com', overrides = {}) {
  const nonce = new URL(app.frame.src).searchParams.get('bridgeNonce');
  app.handlers.message({
    source: { postMessage: (data, target) => app.outgoing.push({ data, target }) },
    origin,
    data: { type: 'TCG_BRIDGE_AUTH_REQUEST', nonce, ...overrides }
  });
}

test('restored stable bridge loads Telegram SDK before handshake (no parallel race)', () => {
  assert.match(html, /<script src="https:\/\/telegram\.org\/js\/telegram-web-app\.js\?64"><\/script>/);
  assert.doesNotMatch(html, /telegram-web-app\.js\?64"\s+defer/);
  const app = launch();
  assert.equal(app.state.ready, 1);
  assert.equal(app.state.expanded, 1);
  assert.equal(app.state.hidden, 1);
  assert.match(app.frame.src, /\/exec\?session=opaque-token&bridgeNonce=[a-f0-9]{64}/);
});

test('server authentication data never appears in iframe URL and is sent only after checked origin and nonce', () => {
  const app = launch();
  assert.doesNotMatch(app.frame.src, /valid-test-signed-initdata|initData/);
  request(app, 'https://attacker.invalid');
  request(app, 'https://script.google.com', { nonce: 'wrong' });
  assert.equal(app.outgoing.length, 0);
  request(app, 'https://script.google.com');
  assert.equal(app.outgoing.length, 1);
  assert.equal(app.outgoing[0].data.type, 'TCG_BRIDGE_AUTH');
  assert.equal(app.outgoing[0].data.initData, 'valid-test-signed-initdata');
  assert.equal(app.outgoing[0].target, 'https://script.google.com');
});

test('rejected invalid token or absent Telegram signature does not open iframe', () => {
  for (const opts of [
    { search: '?session=bad%20token' },
    { initData: '' },
    { initData: null }
  ]) {
    const app = launch(opts);
    assert.equal(app.frame.src, '');
    assert.match(app.message.textContent, /Sessione non disponibile/);
    assert.equal(app.outgoing.length, 0);
  }
});

test('close from valid Google origin and matching nonce works', () => {
  const app = launch();
  const nonce = new URL(app.frame.src).searchParams.get('bridgeNonce');
  app.handlers.message({ origin: 'https://attacker.invalid', data: { type: 'TCG_BRIDGE_CLOSE', nonce } });
  app.handlers.message({ origin: 'https://script.google.com', data: { type: 'TCG_BRIDGE_CLOSE', nonce: 'bad' } });
  assert.equal(app.state.closed, 0);
  app.handlers.message({ origin: 'https://script.google.com', data: { type: 'TCG_BRIDGE_CLOSE', nonce } });
  assert.equal(app.state.closed, 1);
});

test('app iframe can authenticate from trusted googleusercontent host', () => {
  const app = launch();
  request(app, 'https://a-script.googleusercontent.com');
  assert.equal(app.outgoing.length, 1);
});
