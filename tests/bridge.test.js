const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script id="bridge-code">([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, 'bridge inline code exists');

function browser(search = '?session=opaque-token') {
  const handlers = {};
  const outgoing = [];
  const frameSource = { postMessage: (value, origin) => outgoing.push({ value, origin }) };
  const frame = { style: { display: 'none' }, contentWindow: frameSource, src: '' };
  const message = { style: {}, textContent: '', classList: { add: () => {} } };
  const status = { ready: 0, expanded: 0, hidden: 0, closed: 0 };
  const window = {
    location: { search }, Telegram: null,
    addEventListener: (type, callback) => { handlers[type] = callback; }
  };
  const document = {
    getElementById: id => ({ 'gas-frame': frame, message })[id]
  };
  const crypto = {
    getRandomValues: bytes => { for (let i = 0; i < bytes.length; i++) bytes[i] = i; }
  };
  vm.runInNewContext(script, { window, document, crypto, URLSearchParams });
  const sdk = initData => {
    window.Telegram = { WebApp: {
      initData,
      ready: () => status.ready++,
      expand: () => status.expanded++,
      close: () => status.closed++,
      MainButton: { hide: () => status.hidden++ }
    } };
  };
  return { window, handlers, outgoing, frameSource, frame, message, status, sdk };
}

test('load the Apps Script iframe before deferred Telegram SDK, not serially', () => {
  assert.match(html, /telegram-web-app\.js\?64"\s+defer/);
  const b = browser();
  assert.match(b.frame.src, /script\.google\.com\/macros\/s\/.*\/exec\?session=opaque-token&bridgeNonce=[0-9a-f]{64}/);
  assert.equal(b.window.Telegram, null);
  assert.equal(b.status.ready, 0);
  assert.equal(b.outgoing.length, 0);
  assert.ok(b.handlers.DOMContentLoaded, 'Telegram SDK initialization waits for deferred script');
});

test('early iframe auth request waits for Telegram SDK and retains origin, nonce, source validation', () => {
  const b = browser();
  const nonce = new URL(b.frame.src).searchParams.get('bridgeNonce');
  const origin = 'https://script.googleusercontent.com';
  const request = { type: 'TCG_BRIDGE_AUTH_REQUEST', nonce };
  b.handlers.message({ source: {}, origin, data: request });
  b.handlers.message({ source: b.frameSource, origin: 'https://attacker.invalid', data: request });
  b.handlers.message({ source: b.frameSource, origin, data: { ...request, nonce: 'bad' } });
  assert.equal(b.outgoing.length, 0);
  b.handlers.message({ source: b.frameSource, origin, data: request });
  assert.equal(b.outgoing.length, 0, 'not authorized until Telegram initData exists');
  b.sdk('signed-telegram-test-data');
  b.handlers.DOMContentLoaded();
  assert.equal(b.status.ready, 1);
  assert.equal(b.status.expanded, 1);
  assert.equal(b.status.hidden, 1);
  assert.equal(b.outgoing.length, 1);
  assert.equal(b.outgoing[0].value.initData, 'signed-telegram-test-data');
  assert.equal(b.outgoing[0].value.nonce, nonce);
  assert.equal(b.outgoing[0].origin, origin);
  b.handlers.message({ source: b.frameSource, origin, data: request });
  assert.equal(b.outgoing.length, 1, 'signed data is never resent on duplicate auth');
  assert.doesNotMatch(b.frame.src, /initData|signed-telegram/i);
});

test('late iframe auth request is delivered immediately after SDK initialization', () => {
  const b = browser();
  const nonce = new URL(b.frame.src).searchParams.get('bridgeNonce');
  b.sdk('signed-late');
  b.handlers.DOMContentLoaded();
  assert.equal(b.outgoing.length, 0);
  b.handlers.message({ source: b.frameSource, origin: 'https://script.google.com',
    data: { type: 'TCG_BRIDGE_AUTH_REQUEST', nonce } });
  assert.equal(b.outgoing.length, 1);
  assert.equal(b.outgoing[0].value.initData, 'signed-late');
});

test('fails safely if Telegram SDK or signed initData is unavailable', () => {
  const b = browser();
  const nonce = new URL(b.frame.src).searchParams.get('bridgeNonce');
  b.handlers.message({ source: b.frameSource, origin: 'https://script.google.com',
    data: { type: 'TCG_BRIDGE_AUTH_REQUEST', nonce } });
  b.sdk('');
  b.handlers.DOMContentLoaded();
  assert.equal(b.outgoing.length, 0);
  assert.equal(b.frame.style.display, 'none');
  assert.match(b.message.textContent, /Sessione non disponibile/);
});

test('invalid session token never launches iframe or signs anything', () => {
  const b = browser('?session=invalid%20token');
  assert.equal(b.frame.src, '');
  assert.equal(b.outgoing.length, 0);
  assert.match(b.message.textContent, /Sessione non disponibile/);
});

test('only the authenticated frame can request a close', () => {
  const b = browser();
  const nonce = new URL(b.frame.src).searchParams.get('bridgeNonce');
  b.sdk('signed-data');
  b.handlers.DOMContentLoaded();
  b.handlers.message({ source: {}, origin: 'https://script.google.com',
    data: { type: 'TCG_BRIDGE_CLOSE', nonce } });
  assert.equal(b.status.closed, 0);
  b.handlers.message({ source: b.frameSource, origin: 'https://script.google.com',
    data: { type: 'TCG_BRIDGE_CLOSE', nonce } });
  assert.equal(b.status.closed, 1);
});
