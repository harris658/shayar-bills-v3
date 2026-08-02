import test from 'node:test';
import assert from 'node:assert/strict';
import '../js/lib/util.js';
import '../js/lib/adjust.js';

const A = globalThis.STB.adjust;

const plain = { id: 'b1', amount: 1000, amount_expr: '' };
const once = {
  id: 'b2', amount: 41234, amount_expr: '80614+18900+3938+18396-80614',
  original_amount: 121848, adjusted_at: '2026-08-02T10:00:00.000Z',
  adjusted_by: 'harshit@example.com', adjustment_reason: '2026-08-02: short delivery'
};
const thrice = {
  id: 'b3', amount: 900, amount_expr: '1000-50-30-20',
  original_amount: 1000, adjusted_at: '2026-08-04T10:00:00.000Z',
  adjusted_by: 'hussain@example.com',
  adjustment_reason: '2026-08-02: short delivery\n2026-08-03: damages\n2026-08-04: rate difference'
};

test('isAdjusted is false without adjusted_at', () => {
  assert.equal(A.isAdjusted(plain), false);
  assert.equal(A.isAdjusted({ ...plain, adjusted_at: '' }), false);
  assert.equal(A.isAdjusted({ ...plain, adjusted_at: '   ' }), false);
  assert.equal(A.isAdjusted(null), false);
});

test('isAdjusted is true with adjusted_at', () => {
  assert.equal(A.isAdjusted(once), true);
});

test('summary is null for a bill never adjusted', () => {
  assert.equal(A.summary(plain), null);
});

test('summary reports original, current and a negative delta for a deduction', () => {
  const s = A.summary(once);
  assert.equal(s.original, 121848);
  assert.equal(s.current, 41234);
  assert.equal(s.delta, -80614);
  assert.equal(s.expr, '80614+18900+3938+18396-80614');
  assert.equal(s.by, 'harshit@example.com');
  assert.deepEqual(s.reasons, [{ date: '2026-08-02', text: 'short delivery' }]);
});

test('summary reports a positive delta when an amount was raised', () => {
  const s = A.summary({ ...once, amount: 130000, original_amount: 121848 });
  assert.equal(s.delta, 8152);
});

test('summary parses a multi-adjustment reason log in order', () => {
  const s = A.summary(thrice);
  assert.deepEqual(s.reasons.map((r) => r.text),
    ['short delivery', 'damages', 'rate difference']);
  assert.equal(s.reasons[2].date, '2026-08-04');
});

test('summary tolerates a missing original_amount', () => {
  const s = A.summary({ ...once, original_amount: '' });
  assert.equal(s.original, 41234);
  assert.equal(s.delta, 0);
});

test('summary rounds delta to 2 decimals', () => {
  const s = A.summary({ ...once, original_amount: 660.8, amount: 661 });
  assert.equal(s.delta, 0.2);
});

test('parseReasons keeps an unlabelled line as text with no date', () => {
  assert.deepEqual(A.parseReasons('bare line'), [{ date: '', text: 'bare line' }]);
  assert.deepEqual(A.parseReasons(''), []);
  assert.deepEqual(A.parseReasons(null), []);
});

test('appendReason writes the first line', () => {
  assert.equal(A.appendReason('', '2026-08-02', 'short delivery'),
    '2026-08-02: short delivery');
});

test('appendReason appends newest last', () => {
  assert.equal(A.appendReason('2026-08-02: short delivery', '2026-08-03', 'damages'),
    '2026-08-02: short delivery\n2026-08-03: damages');
});

test('appendReason leaves the log untouched when no reason was typed', () => {
  assert.equal(A.appendReason('2026-08-02: short delivery', '2026-08-03', '  '),
    '2026-08-02: short delivery');
  assert.equal(A.appendReason('', '2026-08-03', ''), '');
});

test('badgeHTML is empty for an unadjusted bill and carries the id otherwise', () => {
  assert.equal(A.badgeHTML(plain), '');
  const html = A.badgeHTML(once);
  assert.match(html, /class="badge adjusted adj-toggle"/);
  assert.match(html, /data-id="b2"/);
  assert.match(html, /adjusted/);
});

test('detailRowHTML is empty for an unadjusted bill', () => {
  assert.equal(A.detailRowHTML(plain, 5, []), '');
});

test('detailRowHTML shows original, current, delta, expression and reasons', () => {
  const html = A.detailRowHTML(once, 7, []);
  assert.match(html, /class="adj-detail"/);
  assert.match(html, /data-for="b2"/);
  assert.match(html, /colspan="7"/);
  assert.match(html, /hidden/);
  assert.match(html, /80614\+18900\+3938\+18396-80614/);
  assert.match(html, /short delivery/);
  assert.match(html, /harshit@example\.com/);
});

test('detailRowHTML lists linked invoices when the bill is a voucher', () => {
  const html = A.detailRowHTML(once, 7, [
    { id: 'i1', invoice_no: 'GRC/26-27/001', amount: 5000 },
    { id: 'i2', invoice_no: 'GRC/26-27/002', amount: 3000 }
  ]);
  assert.match(html, /GRC\/26-27\/001/);
  assert.match(html, /GRC\/26-27\/002/);
});

test('detailRowHTML escapes a reason containing markup', () => {
  const html = A.detailRowHTML(
    { ...once, adjustment_reason: '2026-08-02: <img src=x onerror=1>' }, 7, []);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});
