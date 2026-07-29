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
  const stamp = Date.now();
  let p = null;
  const billIds = [];

  try {
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
    const name = 'ZZ Test Party ' + stamp;
    p = createParty_(name);
    let threw = false;
    let errMsg = '';
    try { createParty_(name.toUpperCase()); } catch (e) { threw = true; errMsg = e.message; }
    assert_(threw, 'duplicate party name rejected case-insensitively');
    assert_(errMsg.indexOf('already exists') >= 0,
      'rejection message mentions "already exists", got: ' + errMsg);

    // --- dates round-trip as yyyy-mm-dd, not drifted by a day
    const bill = createBill_({
      party_id: p.id, type: 'paid', amount: 1234.5,
      bill_date: '2026-01-31', note: 'test', amount_expr: '1200+34.5'
    }, user);
    billIds.push(bill.id);
    const readBack = readAll_('bills').filter(function (b) { return b.id === bill.id; })[0];
    assert_(readBack, 'created bill reads back');
    assert_(readBack.bill_date === '2026-01-31',
      'bill_date round-trips as 2026-01-31, got ' + readBack.bill_date);
    assert_(typeof readBack.amount === 'number' && readBack.amount === 1234.5,
      'amount round-trips as a number, got ' + typeof readBack.amount + ' ' + readBack.amount);
    assert_(readBack.created_by === user.email, 'created_by records the signed-in email');

    // --- amount validation
    threw = false;
    errMsg = '';
    try { createBill_({ party_id: p.id, type: 'paid', amount: 0 }, user); }
    catch (e) { threw = true; errMsg = e.message; }
    assert_(threw, 'zero amount rejected');
    assert_(errMsg.indexOf('greater than zero') >= 0,
      'rejection message mentions "greater than zero", got: ' + errMsg);

    // --- markPaid patches the right row
    markPaid_(bill.id, 'UTR-' + stamp + '-A', '2026-02-05');
    const paid = readAll_('bills').filter(function (b) { return b.id === bill.id; })[0];
    assert_(paid.status === 'paid', 'markPaid sets status');
    assert_(paid.payment_ref === 'UTR-' + stamp + '-A', 'markPaid sets ref');
    assert_(paid.payment_date === '2026-02-05', 'markPaid date round-trips');

    // --- the bank-txn triple blocks a re-import
    const txn = { txn_date: '2026-02-05', amount: 1234.5, ref: 'UTR-' + stamp + '-A', description: 'x' };
    const first = applyImport_([], [txn]);
    assert_(first.txns === 1, 'first import inserts the txn');
    const second = applyImport_([], [txn]);
    assert_(second.txns === 0, 're-importing the same txn inserts nothing');

    // --- a digits-only, zero-padded ref still dedupes a re-import. Without
    // applyImport_'s setNumberFormat('@') guard on the ref column, Sheets
    // would store '00<stamp>' as the number <stamp>, String()-ing it back
    // would drop the leading zeros, txnKey_ would no longer match on
    // re-import, and the whole statement would re-import — re-marking every
    // matched bill paid. This is the highest-consequence path on the branch.
    const digitsRef = '00' + stamp;
    const digitsTxn = { txn_date: '2026-02-10', amount: 42, ref: digitsRef, description: 'digits-only ref' };
    const digitsFirst = applyImport_([], [digitsTxn]);
    assert_(digitsFirst.txns === 1, 'digits-only ref: first import inserts the txn');
    const digitsSecond = applyImport_([], [digitsTxn]);
    assert_(digitsSecond.txns === 0,
      'digits-only, zero-padded ref still dedupes a re-import, got txns=' + digitsSecond.txns);

    // --- a matched import inserts the txn and marks the bill paid in one call
    const bill2 = createBill_({
      party_id: p.id, type: 'paid', amount: 500,
      bill_date: '2026-02-01', note: 'test2', amount_expr: ''
    }, user);
    billIds.push(bill2.id);
    const txn2 = { txn_date: '2026-02-06', amount: 500, ref: 'UTR-' + stamp + '-B', description: 'y' };
    const matchResult = applyImport_([{ txn: txn2, bill_id: bill2.id }], []);
    assert_(matchResult.txns === 1, 'matched import inserts the txn');
    assert_(matchResult.applied === 1, 'matched import counts the bill as applied');
    const paid2 = readAll_('bills').filter(function (b) { return b.id === bill2.id; })[0];
    assert_(paid2.status === 'paid', 'matched import marks the bill paid');
    assert_(paid2.payment_ref === 'UTR-' + stamp + '-B', 'matched import sets payment_ref from the txn');
    assert_(paid2.payment_date === '2026-02-06', 'matched import sets payment_date from the txn');

    // --- the same txn in both matches and unmatchedTxns inserts exactly once,
    // and the matches-side copy still pays its bill
    const bill3 = createBill_({
      party_id: p.id, type: 'paid', amount: 250,
      bill_date: '2026-02-02', note: 'test3', amount_expr: ''
    }, user);
    billIds.push(bill3.id);
    const txn3 = { txn_date: '2026-02-07', amount: 250, ref: 'UTR-' + stamp + '-C', description: 'z' };
    const crossListResult = applyImport_([{ txn: txn3, bill_id: bill3.id }], [txn3]);
    assert_(crossListResult.txns === 1,
      'same txn in matches and unmatchedTxns inserts exactly once, got ' + crossListResult.txns);
    assert_(crossListResult.applied === 1, 'the matches-side copy still marks its bill applied');
    const paid3 = readAll_('bills').filter(function (b) { return b.id === bill3.id; })[0];
    assert_(paid3.status === 'paid',
      'the matched copy still pays its bill even with a duplicate in unmatchedTxns');

    // --- the same txn twice within one list inserts exactly once
    const txn4 = { txn_date: '2026-02-08', amount: 75, ref: 'UTR-' + stamp + '-D', description: 'w' };
    const dupWithinListResult = applyImport_([], [txn4, txn4]);
    assert_(dupWithinListResult.txns === 1,
      'the same txn twice in one list inserts exactly once, got ' + dupWithinListResult.txns);

    // --- a txn imported unmatched can later be paired to a bill without
    // re-inserting it, and the bill ends up paid
    const bill5 = createBill_({
      party_id: p.id, type: 'paid', amount: 999,
      bill_date: '2026-02-03', note: 'test5', amount_expr: ''
    }, user);
    billIds.push(bill5.id);
    const txn5 = { txn_date: '2026-02-09', amount: 999, ref: 'UTR-' + stamp + '-E', description: 'v' };
    const firstPass = applyImport_([], [txn5]);
    assert_(firstPass.txns === 1, 'unmatched txn inserts once');
    const secondPass = applyImport_([{ txn: txn5, bill_id: bill5.id }], []);
    assert_(secondPass.txns === 0,
      'the already-present txn is not re-inserted on the correcting pass');
    assert_(secondPass.applied === 1,
      'the correcting pass still marks the bill paid, got applied=' + secondPass.applied);
    const paid5 = readAll_('bills').filter(function (b) { return b.id === bill5.id; })[0];
    assert_(paid5.status === 'paid',
      'a txn imported unmatched can later be paired to a bill and pay it');

    Logger.log('ALL TESTS PASSED');
  } finally {
    // --- cleanup: only what this run created. Bill ids are tracked
    // explicitly; bank_txns rows are found by the stamp baked into every
    // test ref above, so a scratch sheet's other rows are left untouched.
    billIds.forEach(function (id) {
      try { deleteBill_(id); } catch (e) { /* already gone, or never committed — fine */ }
    });
    if (p) {
      const pT = table_('parties');
      const pRow = findRow_(pT, p.id);
      if (pRow > 0) pT.sheet.deleteRow(pRow);
    }
    readAll_('bank_txns').forEach(function (r) {
      if (String(r.ref).indexOf(String(stamp)) >= 0) {
        const n = findRow_(table_('bank_txns'), r.id);
        if (n > 0) sheet_('bank_txns').deleteRow(n);
      }
    });
  }
}
