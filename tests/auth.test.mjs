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
