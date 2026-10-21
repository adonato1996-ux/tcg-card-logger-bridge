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
  const frame = { style: { display: 'none' }, src: '', onload: null,
    addEventListener(type, callback) { if (type === 'load') this.onload = callback; } };
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

test('P1 bridge shows loading content before Telegram SDK and warms GAS connection', () => {
  const head = html.indexOf('<head>');
  const body = html.indexOf('<body>');
  const status = html.indexOf('id="message"');
  const telegramSdk = html.indexOf('src="https://telegram.org/js/telegram-web-app.js?64"');
  const bridgeCode = html.indexOf('<script id="bridge-code">');
  assert.ok(head >= 0 && body > head && status > body &&
    telegramSdk > status && bridgeCode > telegramSdk);
  assert.match(html, /rel="preconnect" href="https:\/\/script\.google\.com"/);
  assert.match(html, /rel="preconnect" href="https:\/\/telegram\.org"/);
});

test('the GAS iframe only replaces the loading message after the load event', () => {
  const app = launch();
  assert.equal(app.frame.style.display, 'none');
  assert.notEqual(app.message.style.display, 'none');
  assert.match(app.message.textContent, /Caricamento della scheda/);
  assert.equal(typeof app.frame.onload, 'function');
  app.frame.onload();
  assert.equal(app.frame.style.display, 'block');
  assert.equal(app.message.style.display, 'none');
});

test('collection opens without a purchase session and retains the fixed LIVE destination', () => {
  const app = launch({ search: '?mode=collection' });
  assert.match(app.frame.src, /\/exec\?mode=collection&bridgeNonce=/);
  const target = new URL(app.frame.src);
  assert.equal(target.origin + target.pathname,
    'https://script.google.com/macros/s/AKfycbzUF1lmp7OhjWgMbK0YOqAip1RgCQdNHdFMswpgPKXRvUCOqN4d97lPEy3jaoBmySLH/exec');
  assert.equal(target.searchParams.get('mode'), 'collection');
  assert.equal(target.searchParams.has('session'), false);
  assert.match(target.searchParams.get('bridgeNonce'), /^[a-f0-9]{64}$/);
  assert.match(app.message.textContent, /Caricamento della collezione/);
  assert.equal(app.state.ready, 1);
});

test('collection ignores purchase tokens and client identity, credentials and destinations', () => {
  const app = launch({ search: '?mode=collection&session=bad%20token&telegramUserId=999&spreadsheetId=other&initData=forged&token=secret&WEB_APP_URL=https://attacker.invalid&bridgeNonce=client' });
  assert.match(app.frame.src, /\/exec\?mode=collection&bridgeNonce=/);
  const target = new URL(app.frame.src);
  assert.deepEqual([...target.searchParams.keys()], ['mode', 'bridgeNonce']);
  assert.match(target.searchParams.get('bridgeNonce'), /^[a-f0-9]{64}$/);
  assert.doesNotMatch(app.frame.src, /attacker|forged|secret|client|999|other/);
  request(app);
  assert.equal(app.outgoing[0].data.initData, 'valid-test-signed-initdata');
});

test('collection still requires Telegram initData before loading or posting authentication', () => {
  for (const initData of ['', null]) {
    const app = launch({ search: '?mode=collection', initData });
    assert.equal(app.frame.src, '');
    assert.equal(app.state.ready, 0);
    assert.equal(app.handlers.message, undefined);
    assert.deepEqual(app.outgoing, []);
  }
});

test('unsupported modes cannot silently become purchase or collection', () => {
  for (const mode of ['admin', 'Collection', 'collection-extra']) {
    const app = launch({ search: '?mode=' + mode + '&session=opaque-token' });
    assert.equal(app.frame.src, '');
    assert.match(app.message.textContent, /Sessione non disponibile/);
  }
});

test('explicit purchase mode preserves the original purchase URL and validation', () => {
  const old = launch();
  const explicit = launch({ search: '?mode=purchase&session=opaque-token' });
  assert.equal(explicit.frame.src, old.frame.src);
  assert.equal(launch({ search: '?mode=purchase' }).frame.src, '');
  assert.equal(launch({ search: '?session=bad%20token' }).frame.src, '');
});

test('collection authentication keeps origin and nonce checks and never puts initData in URLs', () => {
  const app = launch({ search: '?mode=collection' });
  assert.match(app.frame.src, /\/exec\?mode=collection&bridgeNonce=/);
  assert.doesNotMatch(app.frame.src, /initData|valid-test/);
  for (const origin of ['https://attacker.invalid', 'https://script.google.com.attacker.invalid', 'http://script.google.com']) request(app, origin);
  request(app, 'https://script.google.com', { nonce: 'wrong' });
  assert.deepEqual(app.outgoing, []);
  request(app, 'https://a-script.googleusercontent.com');
  assert.equal(app.outgoing.length, 1);
  assert.equal(app.outgoing[0].target, 'https://a-script.googleusercontent.com');
  assert.equal(app.outgoing[0].data.initData, 'valid-test-signed-initdata');
});
