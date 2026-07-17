import test from 'node:test';
import assert from 'node:assert/strict';
import '../js/lib/ledger.js';

const L = globalThis.STB.ledger;
const B = (party_id, type, amount, bill_date, status, extra = {}) =>
  ({ party_id, type, amount, bill_date, status, created_at: bill_date + 'T00:00:00Z', ...extra });

const bills = [
  B('p1', 'paid', 1000, '2026-07-01', 'pending'),
  B('p1', 'paid', 500, '2026-07-05', 'paid'),
  B('p2', 'paid', 2000, '2026-06-20', 'pending'),
  B('p2', 'received', 750, '2026-07-10', 'pending'),
];

test('totals', () => {
  const t = L.totals(bills, '2026-07');
  assert.equal(t.toPay, 3000);          // 1000 + 2000 pending paid-type
  assert.equal(t.toReceive, 750);
  assert.equal(t.monthPaid, 1500);      // July paid-type: 1000 + 500
  assert.equal(t.monthReceived, 750);
});

test('outstandingByParty sorted by toPay desc', () => {
  const o = L.outstandingByParty(bills);
  assert.deepEqual(o.map((x) => x.party_id), ['p2', 'p1']);
  assert.equal(o[0].toPay, 2000);
  assert.equal(o[0].toReceive, 750);
});

test('buildLedger running balance chronological', () => {
  const rows = L.buildLedger(bills.filter((b) => b.party_id === 'p1'));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].delta, -1000);
  assert.equal(rows[1].running, -1500);
});
