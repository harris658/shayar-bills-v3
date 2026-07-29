import test from 'node:test';
import assert from 'node:assert/strict';

// Seed the globals auth.js reads before importing it. Static `import` is
// hoisted and would run the module first, so this file loads it dynamically.
function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k)
  };
}

globalThis.STB = { env: { storage: fakeStorage() }, config: { GOOGLE_CLIENT_ID: 'test-client' } };
await import('../js/lib/auth.js');
const A = globalThis.STB.auth;

/** Builds an unsigned JWT with the given payload. Only the payload is ever read. */
function jwt(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return b64({ alg: 'none' }) + '.' + b64(payload) + '.sig';
}

const inSeconds = (s) => Math.floor(Date.now() / 1000) + s;

test('claims decodes the payload', () => {
  const t = jwt({ email: 'a@b.com', name: 'A', exp: inSeconds(3600) });
  assert.equal(A.claims(t).email, 'a@b.com');
});

test('claims returns null for junk', () => {
  assert.equal(A.claims('not-a-jwt'), null);
  assert.equal(A.claims(''), null);
});

test('a token expiring in an hour is valid', () => {
  assert.equal(A.valid(jwt({ exp: inSeconds(3600) })), true);
});

test('an expired token is not valid', () => {
  assert.equal(A.valid(jwt({ exp: inSeconds(-10) })), false);
});

test('a token inside the 60s skew is already treated as expired', () => {
  // Renew a minute early rather than racing the expiry mid-request.
  assert.equal(A.valid(jwt({ exp: inSeconds(30) })), false);
});

test('set, get and clear round-trip through storage', () => {
  const t = jwt({ email: 'a@b.com', exp: inSeconds(3600) });
  A.set(t);
  assert.equal(A.get(), t);
  assert.equal(A.valid(), true);
  A.clear();
  assert.equal(A.get(), null);
  assert.equal(A.valid(), false);
});

test('session returns email and name from the stored token', () => {
  A.set(jwt({ email: 'harshit@example.com', name: 'Harshit', exp: inSeconds(3600) }));
  assert.deepEqual(A.session(), { email: 'harshit@example.com', name: 'Harshit' });
  A.clear();
});

test('session is null with no token', () => {
  A.clear();
  assert.equal(A.session(), null);
});

test('session is null when the token has expired', () => {
  A.set(jwt({ email: 'a@b.com', name: 'A', exp: inSeconds(-10) }));
  assert.equal(A.session(), null);
  A.clear();
});

// --- ensureFresh --------------------------------------------------------

test('ensureFresh resolves to the stored token without renewing when valid', async () => {
  const t = jwt({ exp: inSeconds(3600) });
  A.set(t);
  // No google fake installed: if ensureFresh tried to renew, renew() would
  // reject with 'session expired' because the SDK is absent, and this
  // assertion would fail — proving the valid branch skips renewal.
  STB.env.google = undefined;
  assert.equal(await A.ensureFresh(), t);
  A.clear();
});

test('ensureFresh delegates to renew() when the token is absent or invalid', async () => {
  A.clear();
  const fake = makeGsi();
  STB.env.google = fake.google;
  const p = A.ensureFresh();
  fake.trigger({ credential: 'tok-ensure' });
  assert.equal(await p, 'tok-ensure');
  A.clear();
  STB.env.google = undefined;
});

// --- renew / renderButton / signOut, via a fake google.accounts.id -----

/** A stand-in for google.accounts.id that records calls and lets the test
 *  fire the captured callback whenever it likes. */
function makeGsi() {
  const calls = { initialize: 0, prompt: 0, renderButton: 0, disableAutoSelect: 0 };
  let cb = null;
  let renderButtonArgs = null;
  const id = {
    initialize(cfg) { calls.initialize++; cb = cfg.callback; },
    prompt() { calls.prompt++; },
    renderButton(el, opts) { calls.renderButton++; renderButtonArgs = { el, opts }; },
    disableAutoSelect() { calls.disableAutoSelect++; }
  };
  return {
    google: { accounts: { id } },
    calls,
    get renderButtonArgs() { return renderButtonArgs; },
    trigger(res) { cb && cb(res); }
  };
}

test('renew resolves with the credential and stores it', async () => {
  const fake = makeGsi();
  STB.env.google = fake.google;
  const p = A.renew();
  fake.trigger({ credential: 'tok-renew' });
  assert.equal(await p, 'tok-renew');
  assert.equal(A.get(), 'tok-renew');
  A.clear();
  STB.env.google = undefined;
});

test('renew rejects with session expired when the callback has no credential', async () => {
  const fake = makeGsi();
  STB.env.google = fake.google;
  const p = A.renew();
  fake.trigger({});
  await assert.rejects(p, { message: 'session expired' });
  STB.env.google = undefined;
});

test('renew rejects with session expired when the SDK is absent entirely', async () => {
  STB.env.google = undefined;
  await assert.rejects(A.renew(), { message: 'session expired' });
});

test('renew rejects with session expired when the injected timeout elapses', async () => {
  const fake = makeGsi();
  STB.env.google = fake.google;
  STB.env.renewTimeoutMs = 20;
  // Never trigger the callback — the timeout must fire instead.
  await assert.rejects(A.renew(), { message: 'session expired' });
  delete STB.env.renewTimeoutMs;
  STB.env.google = undefined;
});

test('concurrent renew() calls share one in-flight promise', async () => {
  const fake = makeGsi();
  STB.env.google = fake.google;
  const p1 = A.renew();
  const p2 = A.renew();
  assert.equal(fake.calls.initialize, 1);
  fake.trigger({ credential: 'tok-shared' });
  const [t1, t2] = await Promise.all([p1, p2]);
  assert.equal(t1, 'tok-shared');
  assert.equal(t2, 'tok-shared');
  A.clear();
  STB.env.google = undefined;
});

test('the renew guard clears after a rejection so a later renewal can succeed', async () => {
  const failing = makeGsi();
  STB.env.google = failing.google;
  const p1 = A.renew();
  failing.trigger({});
  await assert.rejects(p1, { message: 'session expired' });

  const succeeding = makeGsi();
  STB.env.google = succeeding.google;
  const p2 = A.renew();
  succeeding.trigger({ credential: 'tok-after-hiccup' });
  assert.equal(await p2, 'tok-after-hiccup');
  A.clear();
  STB.env.google = undefined;
});

test('renderButton calls the SDK renderButton with the passed element and resolves with the credential', async () => {
  const fake = makeGsi();
  STB.env.google = fake.google;
  const el = { id: 'signin-btn' };
  const p = A.renderButton(el);
  assert.equal(fake.calls.renderButton, 1);
  assert.equal(fake.renderButtonArgs.el, el);
  fake.trigger({ credential: 'tok-button' });
  assert.equal(await p, 'tok-button');
  assert.equal(A.get(), 'tok-button');
  A.clear();
  STB.env.google = undefined;
});

test('signOut clears the token and calls disableAutoSelect when the SDK is present', () => {
  A.set(jwt({ exp: inSeconds(3600) }));
  const fake = makeGsi();
  STB.env.google = fake.google;
  A.signOut();
  assert.equal(A.get(), null);
  assert.equal(fake.calls.disableAutoSelect, 1);
  STB.env.google = undefined;
});

test('signOut does not throw when the SDK is absent', () => {
  A.set(jwt({ exp: inSeconds(3600) }));
  STB.env.google = undefined;
  assert.doesNotThrow(() => A.signOut());
  assert.equal(A.get(), null);
});
