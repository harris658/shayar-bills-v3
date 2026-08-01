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

test('unallocatedInvoiceTotal counts only invoices not yet on a voucher', () => {
  const invoices = [
    { id: 'i1', amount: 10, status: 'unallocated' },
    { id: 'i2', amount: 20, status: 'allocated' },   // already spent on a voucher
    { id: 'i3', amount: 30, status: 'unallocated' }
  ];
  assert.equal(L.unallocatedInvoiceTotal(invoices), 40);
});

test('unallocatedInvoiceTotal is 0 for an empty or missing pool', () => {
  assert.equal(L.unallocatedInvoiceTotal([]), 0);
  assert.equal(L.unallocatedInvoiceTotal(undefined), 0);
});

test('the two dashboard figures never count the same money twice', () => {
  // An invoice leaves the unallocated pool at the moment its voucher joins
  // "to pay" — the sums read different arrays, so nothing can be in both.
  const invoices = [
    { id: 'i1', amount: 300, status: 'allocated', bill_id: 'v1' },
    { id: 'i2', amount: 700, status: 'unallocated' }
  ];
  const voucher = [{ id: 'v1', type: 'paid', status: 'pending', amount: 300 }];
  assert.equal(L.unallocatedInvoiceTotal(invoices), 700);
  assert.equal(L.totals(voucher, null).toPay, 300);
});
