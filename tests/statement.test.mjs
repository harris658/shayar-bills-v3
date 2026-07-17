import test from 'node:test';
import assert from 'node:assert/strict';
import '../js/lib/statement.js';

const S = globalThis.STB.statement;

test('parseCSV handles quotes and CRLF', () => {
  const rows = S.parseCSV('a,"b,1",c\r\nd,"say ""hi""",f\n');
  assert.deepEqual(rows, [['a', 'b,1', 'c'], ['d', 'say "hi"', 'f']]);
});

test('parseDate formats', () => {
  assert.equal(S.parseDate('17/07/2026'), '2026-07-17');
  assert.equal(S.parseDate('17-07-2026'), '2026-07-17');
  assert.equal(S.parseDate('2026-07-17'), '2026-07-17');
  assert.equal(S.parseDate('17/07/26'), '2026-07-17');
  assert.equal(S.parseDate('17 Jul 2026'), '2026-07-17');
  assert.equal(S.parseDate('junk'), null);
});

test('parseAmount', () => {
  assert.equal(S.parseAmount('₹1,200.50'), 1200.5);
  assert.equal(S.parseAmount(' 12,500 '), 12500);
  assert.ok(Number.isNaN(S.parseAmount('abc')));
});

test('parseAmount rejects parenthesised negatives', () => {
  assert.ok(Number.isNaN(S.parseAmount('(1,200)')));
});

test('applyMapping skips header and bad rows', () => {
  const rows = [
    ['Date', 'Narration', 'Ref', 'Debit'],
    ['17/07/2026', 'NEFT ACME TEXTILES', 'UTR001', '12,500'],
    ['bad-date', 'x', 'y', '100'],
    ['18/07/2026', 'IMPS RAM FABRICS', 'UTR002', ''],
  ];
  const txns = S.applyMapping(rows, { dateCol: 0, descCol: 1, refCol: 2, amountCol: 3, headerRows: 1 });
  assert.equal(txns.length, 1);
  assert.deepEqual(txns[0], {
    txn_date: '2026-07-17', amount: 12500, ref: 'UTR001', description: 'NEFT ACME TEXTILES'
  });
});

test('applyMapping drops zero and negative amounts', () => {
  const rows = [
    ['17/07/2026', 'x', 'UTR010', '0'],
    ['17/07/2026', 'x', 'UTR011', '-500'],
    ['17/07/2026', 'x', 'UTR012', '500'],
  ];
  const txns = S.applyMapping(rows, { dateCol: 0, descCol: 1, refCol: 2, amountCol: 3, headerRows: 0 });
  assert.deepEqual(txns.map((t) => t.ref), ['UTR012']);
});

test('dedupe by ref|amount|date', () => {
  const a = [{ txn_date: '2026-07-17', amount: 100, ref: 'R1', description: '' },
             { txn_date: '2026-07-18', amount: 200, ref: 'R2', description: '' }];
  const existing = [{ txn_date: '2026-07-17', amount: 100, ref: 'R1' }];
  assert.deepEqual(S.dedupe(a, existing).map((t) => t.ref), ['R2']);
});

test('dedupe also removes intra-batch duplicates', () => {
  const a = [{ txn_date: '2026-07-17', amount: 100, ref: 'R1', description: 'first' },
             { txn_date: '2026-07-17', amount: 100, ref: 'R1', description: 'dup' },
             { txn_date: '2026-07-18', amount: 200, ref: 'R2', description: '' }];
  const out = S.dedupe(a, []);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((t) => t.ref), ['R1', 'R2']);
});
