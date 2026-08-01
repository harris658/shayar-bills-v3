import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.STB = {};
await import('../js/lib/voucher.js');
const V = globalThis.STB.voucher;

const inv = (invoice_no, amount) => ({ invoice_no, amount });

test('total sums the selected invoices', () => {
  assert.equal(V.voucherTotal([inv('A', 10), inv('B', 10), inv('C', 10)]), 30);
});

test('total is exact on amounts that break float addition', () => {
  // 0.1 + 0.2 === 0.30000000000000004; on a voucher that is 4 paise nobody can
  // account for, printed next to a signature.
  assert.equal(V.voucherTotal([inv('A', 0.1), inv('B', 0.2)]), 0.3);
  assert.equal(V.voucherTotal([inv('A', 1200.55), inv('B', 850.45)]), 2051);
});

test('total of one invoice is that invoice', () => {
  assert.equal(V.voucherTotal([inv('A', 121848)]), 121848);
});

test('narration is the invoice numbers, comma separated, under the pad prefix', () => {
  assert.equal(
    V.buildVoucherNote([inv('JFPS26-27-000168', 1), inv('JFPS26-27-000154', 2)]),
    'INVOICE NO.- JFPS26-27-000168, JFPS26-27-000154'
  );
});

test('narration trims what was typed', () => {
  assert.equal(V.buildVoucherNote([inv('  A-1 ', 1)]), 'INVOICE NO.- A-1');
});

test('breakdown is a plain + chain print.js can itemise', () => {
  const expr = V.buildVoucherExpr([inv('A', 10), inv('B', 20), inv('C', 30)]);
  assert.equal(expr, '10+20+30');
  // The exact shape print.js's itemAmounts() requires — if this regex stops
  // matching, the voucher silently prints with no item lines.
  assert.match(expr, /^\d+(\.\d+)?(\+\d+(\.\d+)?)+$/);
});

test('a single invoice stores no breakdown', () => {
  // Matches what the manual entry form stores for a bare amount, and prints as
  // a TOTAL row alone — which is how the pad is filled in for one invoice.
  assert.equal(V.buildVoucherExpr([inv('A', 500)]), '');
});

test('four invoices still produce the whole chain', () => {
  // print.js will decline to itemise this (its form has three lines) and print
  // the TOTAL alone — the confirmed behaviour. The data keeps the breakdown
  // even though the paper cannot show it.
  const expr = V.buildVoucherExpr([inv('A', 1), inv('B', 2), inv('C', 3), inv('D', 4)]);
  assert.equal(expr, '1+2+3+4');
  assert.equal(expr.split('+').length, 4);
});

test('decimal amounts survive into the breakdown', () => {
  assert.equal(V.buildVoucherExpr([inv('A', 2050.5), inv('B', 10)]), '2050.5+10');
});
