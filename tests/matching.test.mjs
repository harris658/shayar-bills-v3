import test from 'node:test';
import assert from 'node:assert/strict';
import '../js/lib/matching.js';

const M = globalThis.STB.matching;
const T = (txn_date, amount, ref) => ({ txn_date, amount, ref, description: '' });
const B = (id, amount, bill_date) => ({ id, amount, bill_date, status: 'pending' });

test('confident: equal amount within 5 days, nearest date wins', () => {
  const txns = [T('2026-07-17', 5000, 'U1')];
  const bills = [B('b-far', 5000, '2026-07-10'), B('b-near', 5000, '2026-07-16')];
  const r = M.proposeMatches(txns, bills);
  assert.equal(r.confident.length, 1);
  assert.equal(r.confident[0].bill.id, 'b-near');
  assert.deepEqual(r.suggested, []);
  assert.equal(r.unmatchedBills.length, 1);   // b-far: 7 days off, amount taken
});

test('suggested: equal amount outside window', () => {
  const r = M.proposeMatches([T('2026-07-17', 900, 'U2')], [B('b1', 900, '2026-05-01')]);
  assert.equal(r.confident.length, 0);
  assert.equal(r.suggested.length, 1);
  assert.equal(r.suggested[0].bill.id, 'b1');
});

test('each txn and bill used once; leftovers reported', () => {
  const txns = [T('2026-07-17', 100, 'U3'), T('2026-07-17', 100, 'U4'), T('2026-07-17', 77, 'U5')];
  const bills = [B('b1', 100, '2026-07-17')];
  const r = M.proposeMatches(txns, bills);
  assert.equal(r.confident.length, 1);
  assert.equal(r.unmatchedTxns.length, 2);    // second 100 + the 77
  assert.equal(r.unmatchedBills.length, 0);
});
