import test from 'node:test';
import assert from 'node:assert/strict';

// Seed the globals cache.js reads before importing it — static `import` is
// hoisted and would run the module first, so this file loads it dynamically.
function fakeStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k)
  };
}

let store = fakeStorage();
globalThis.STB = { env: { storage: null } };
Object.defineProperty(globalThis.STB.env, 'storage', { get: () => store });

await import('../js/lib/cache.js');
const C = globalThis.STB.cache;

const KEY = 'stb.snapshot.v1';
const parties = [{ id: 'p1', name: 'Acme' }];
const bills = [{ id: 'b1', party_id: 'p1', amount: 100, status: 'pending' }];

function reset() { store = fakeStorage(); }

test('write then read round-trips the snapshot', () => {
  reset();
  assert.equal(C.write('a@b.com', parties, bills), true);
  const got = C.read('a@b.com');
  assert.deepEqual(got.parties, parties);
  assert.deepEqual(got.bills, bills);
  assert.ok(got.at > 0);
});

test('read returns null for a different signed-in user', () => {
  reset();
  C.write('a@b.com', parties, bills);
  assert.equal(C.read('other@b.com'), null);
});

test("a foreign cache is left in place, not cleared", () => {
  reset();
  C.write('a@b.com', parties, bills);
  C.read('other@b.com');
  // The other user's own read must still work — this is a shared device.
  assert.deepEqual(C.read('a@b.com').bills, bills);
});

test('read returns null with no email', () => {
  reset();
  C.write('a@b.com', parties, bills);
  assert.equal(C.read(''), null);
  assert.equal(C.read(undefined), null);
});

test('write is refused with no email', () => {
  reset();
  assert.equal(C.write('', parties, bills), false);
  assert.equal(store.getItem(KEY), null);
});

test('read returns null on an empty cache', () => {
  reset();
  assert.equal(C.read('a@b.com'), null);
});

test('malformed JSON is discarded, not thrown', () => {
  reset();
  store.setItem(KEY, 'not json {');
  assert.equal(C.read('a@b.com'), null);
  assert.equal(store.getItem(KEY), null, 'unparseable cache should be cleared');
});

test('a snapshot missing its arrays is discarded', () => {
  reset();
  store.setItem(KEY, JSON.stringify({ email: 'a@b.com', at: 1, parties: 'nope' }));
  assert.equal(C.read('a@b.com'), null);
  assert.equal(store.getItem(KEY), null);
});

test('clear removes the snapshot', () => {
  reset();
  C.write('a@b.com', parties, bills);
  C.clear();
  assert.equal(C.read('a@b.com'), null);
});

test('a write failure is reported, not thrown', () => {
  reset();
  store.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.equal(C.write('a@b.com', parties, bills), false);
});

test('a read against unusable storage returns null, not a throw', () => {
  reset();
  store.getItem = () => { throw new Error('SecurityError'); };
  assert.equal(C.read('a@b.com'), null);
});

test('at survives the round trip so staleness can be judged', () => {
  reset();
  const before = Date.now();
  C.write('a@b.com', parties, bills);
  const { at } = C.read('a@b.com');
  assert.ok(at >= before && at <= Date.now());
});
