/**
 * Manual test suite. Run from the Apps Script editor against a SCRATCH COPY
 * of the spreadsheet — it appends and deletes rows.
 *
 * Select runTests in the function dropdown, click Run, read the execution log.
 */

function assert_(cond, label) {
  if (!cond) throw new Error('FAIL: ' + label);
  Logger.log('pass: ' + label);
}

function runTests() {
  const user = { email: 'test@example.com', name: 'Test' };
  const created = [];

  // --- columns are located by header text, not by position.
  // This asserts the mechanism, not a live reorder — actually shuffling
  // columns mid-test is destructive. To verify the reorder case for real,
  // swap two columns in the scratch sheet by hand and re-run.
  const t = table_('bills');
  ['id', 'party_id', 'type', 'amount', 'bill_date', 'note', 'amount_expr',
    'status', 'payment_ref', 'payment_date', 'created_by', 'created_at']
    .forEach(function (h) {
      assert_(t.index[h] !== undefined, 'bills column located by header: ' + h);
    });

  // --- duplicate party names are rejected
  const name = 'ZZ Test Party ' + Date.now();
  const p = createParty_(name);
  created.push(p.id);
  let threw = false;
  try { createParty_(name.toUpperCase()); } catch (e) { threw = true; }
  assert_(threw, 'duplicate party name rejected case-insensitively');

  // --- dates round-trip as yyyy-mm-dd, not drifted by a day
  const bill = createBill_({
    party_id: p.id, type: 'paid', amount: 1234.5,
    bill_date: '2026-01-31', note: 'test', amount_expr: '1200+34.5'
  }, user);
  const readBack = readAll_('bills').filter(function (b) { return b.id === bill.id; })[0];
  assert_(readBack, 'created bill reads back');
  assert_(readBack.bill_date === '2026-01-31',
    'bill_date round-trips as 2026-01-31, got ' + readBack.bill_date);
  assert_(Number(readBack.amount) === 1234.5, 'amount round-trips as a number');
  assert_(readBack.created_by === user.email, 'created_by records the signed-in email');

  // --- amount validation
  threw = false;
  try { createBill_({ party_id: p.id, type: 'paid', amount: 0 }, user); }
  catch (e) { threw = true; }
  assert_(threw, 'zero amount rejected');

  // --- markPaid patches the right row
  markPaid_(bill.id, 'UTR123', '2026-02-05');
  const paid = readAll_('bills').filter(function (b) { return b.id === bill.id; })[0];
  assert_(paid.status === 'paid', 'markPaid sets status');
  assert_(paid.payment_ref === 'UTR123', 'markPaid sets ref');
  assert_(paid.payment_date === '2026-02-05', 'markPaid date round-trips');

  // --- the bank-txn triple blocks a re-import
  const txn = { txn_date: '2026-02-05', amount: 1234.5, ref: 'UTR123', description: 'x' };
  const first = applyImport_([], [txn]);
  assert_(first.txns === 1, 'first import inserts the txn');
  const second = applyImport_([], [txn]);
  assert_(second.txns === 0, 're-importing the same txn inserts nothing');

  // --- cleanup
  deleteBill_(bill.id);
  const pT = table_('parties');
  const pRow = findRow_(pT, p.id);
  if (pRow > 0) pT.sheet.deleteRow(pRow);
  const txT = table_('bank_txns');
  readAll_('bank_txns').forEach(function (r) {
    if (r.ref === 'UTR123') {
      const n = findRow_(table_('bank_txns'), r.id);
      if (n > 0) sheet_('bank_txns').deleteRow(n);
    }
  });

  Logger.log('ALL TESTS PASSED');
}
