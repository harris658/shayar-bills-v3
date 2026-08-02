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
  const invoiceIds = [];
  const parties2 = [];

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

    // --- bill_date is stored as TEXT, not as a coerced date serial.
    // readAll_ runs every date field through isoDate_, which formats a Date
    // back into yyyy-mm-dd — so the round-trip assertion above passes even
    // when the cell holds a date serial. That masked a real bug: appendRow
    // and setValues re-infer type and stamp their own format over the
    // column's, so the value became 46233 wearing a yyyy-mm-dd mask, one
    // timezone shift away from reading as the previous day. Assert the stored
    // type directly, which is the only way to see it.
    const bT = table_('bills');
    const bRow = findRow_(bT, bill.id);
    assert_(bRow > 0, 'created bill row is locatable for the format check');
    const dateCell = bT.sheet.getRange(bRow, bT.index.bill_date + 1);
    assert_(dateCell.getNumberFormat() === '@',
      'bill_date cell is plain text, got format ' + dateCell.getNumberFormat());
    assert_(typeof dateCell.getValue() === 'string',
      'bill_date is stored as a string, got ' + typeof dateCell.getValue() +
      ' (' + dateCell.getValue() + ')');

    // --- markPaid writes through setCellsBatch_, which round-trips a whole
    // range: it reads status..payment_date, patches in memory, and writes the
    // block back. The '@' format has to be re-forced inside that span or
    // payment_date lands as a date serial again, and any column swept into a
    // widened span gets rewritten with whatever getValues() handed back.
    markPaid_(bill.id, '00' + stamp, '2026-03-01');
    const payCell = bT.sheet.getRange(bRow, bT.index.payment_date + 1);
    assert_(typeof payCell.getValue() === 'string',
      'payment_date is stored as a string, got ' + typeof payCell.getValue());
    const refCell = bT.sheet.getRange(bRow, bT.index.payment_ref + 1);
    assert_(refCell.getValue() === '00' + stamp,
      'zero-padded payment_ref keeps its leading zeros, got ' + refCell.getValue());

    const payFormat = bT.sheet.getRange(bRow, bT.index.payment_date + 1);
    assert_(payFormat.getNumberFormat() === '@',
      'payment_date cell is plain text after the batched write, got format ' +
      payFormat.getNumberFormat());

    // --- fields markPaid does NOT patch must survive its range round trip
    const afterPaid = readAll_('bills').filter(function (b) { return b.id === bill.id; })[0];
    assert_(afterPaid.bill_date === '2026-01-31',
      'markPaid leaves bill_date alone, got ' + afterPaid.bill_date);
    assert_(afterPaid.amount_expr === '1200+34.5',
      'markPaid leaves amount_expr alone, got ' + afterPaid.amount_expr);
    assert_(afterPaid.note === 'test', 'markPaid leaves note alone, got ' + afterPaid.note);

    // --- amount must stay numeric — the text guard must not overreach
    assert_(typeof bT.sheet.getRange(bRow, bT.index.amount + 1).getValue() === 'number',
      'amount is still stored as a number');

    // --- amount validation
    threw = false;
    errMsg = '';
    try { createBill_({ party_id: p.id, type: 'paid', amount: 0 }, user); }
    catch (e) { threw = true; errMsg = e.message; }
    assert_(threw, 'zero amount rejected');
    assert_(errMsg.indexOf('greater than zero') >= 0,
      'rejection message mentions "greater than zero", got: ' + errMsg);

    // --- updateBillAmount edits the figure and nothing else. Runs BEFORE the
    // markPaid below, because a paid bill is not editable (asserted after).
    const edited = createBill_({
      party_id: p.id, type: 'paid', amount: 100,
      bill_date: '2026-01-15', note: 'edit me', amount_expr: ''
    }, user);
    billIds.push(edited.id);
    updateBillAmount_(edited.id, 2050.5, '1200+850+0.5');
    let after = readAll_('bills').filter(function (b) { return b.id === edited.id; })[0];
    assert_(after.amount === 2050.5, 'updateBillAmount sets the amount, got ' + after.amount);
    assert_(typeof after.amount === 'number',
      'edited amount is still stored as a number, got ' + typeof after.amount);
    assert_(after.amount_expr === '1200+850+0.5',
      'updateBillAmount stores the breakdown, got ' + after.amount_expr);
    assert_(after.bill_date === '2026-01-15',
      'updateBillAmount leaves bill_date alone, got ' + after.bill_date);
    assert_(after.note === 'edit me', 'updateBillAmount leaves note alone, got ' + after.note);
    assert_(after.status === 'pending', 'updateBillAmount leaves status alone');

    // Clearing the breakdown (a plain number typed over a sum) must blank the
    // column, not leave the old expression behind contradicting the amount.
    updateBillAmount_(edited.id, 900, '');
    after = readAll_('bills').filter(function (b) { return b.id === edited.id; })[0];
    assert_(after.amount === 900, 'second edit applies, got ' + after.amount);
    assert_(!after.amount_expr, 'an empty expression clears amount_expr, got ' + after.amount_expr);

    threw = false; errMsg = '';
    try { updateBillAmount_(edited.id, 0); } catch (e) { threw = true; errMsg = e.message; }
    assert_(threw && errMsg.indexOf('greater than zero') >= 0,
      'a zero amount is rejected, got: ' + errMsg);
    threw = false;
    try { updateBillAmount_('no-such-id', 500); } catch (e) { threw = true; }
    assert_(threw, 'an unknown bill id is rejected');
    after = readAll_('bills').filter(function (b) { return b.id === edited.id; })[0];
    assert_(after.amount === 900, 'a rejected edit leaves the amount untouched');

    // A settled bill is not editable — its voucher may be signed and filed.
    markPaid_(edited.id, 'UTR-' + stamp + '-EDIT', '2026-02-01');
    threw = false; errMsg = '';
    try { updateBillAmount_(edited.id, 111); } catch (e) { threw = true; errMsg = e.message; }
    assert_(threw && errMsg.indexOf('already marked paid') >= 0,
      'editing a paid bill is refused server-side, got: ' + errMsg);
    after = readAll_('bills').filter(function (b) { return b.id === edited.id; })[0];
    assert_(after.amount === 900, 'the refused edit did not change the paid amount');

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

    // ------------------------------------------------------------------
    // Invoices → debit voucher
    // ------------------------------------------------------------------

    const invT = table_('invoices');
    ['id', 'party_id', 'invoice_no', 'amount', 'invoice_date', 'note',
      'status', 'bill_id', 'created_by', 'created_at'].forEach(function (h) {
      assert_(invT.index[h] !== undefined, 'invoices column located by header: ' + h);
    });
    ['invoice_total', 'adjustment', 'invoice_ids'].forEach(function (h) {
      assert_(table_('bills').index[h] !== undefined,
        'bills column located by header: ' + h);
    });

    const mkInv = function (no, amount, partyId) {
      const row = createInvoice_({
        party_id: partyId || p.id, invoice_no: no + '-' + stamp,
        amount: amount, invoice_date: '2026-03-01', note: 'test inv'
      }, user);
      invoiceIds.push(row.id);
      return row;
    };

    const i1 = mkInv('INV-A', 10);
    const i2 = mkInv('INV-B', 20);
    assert_(i1.status === 'unallocated', 'a new invoice starts unallocated');
    const i1Read = readAll_('invoices').filter(function (r) { return r.id === i1.id; })[0];
    assert_(i1Read.invoice_date === '2026-03-01',
      'invoice_date round-trips as text, got ' + i1Read.invoice_date);
    assert_(sheet_('invoices')
      .getRange(findRow_(table_('invoices'), i1.id), table_('invoices').index.invoice_date + 1)
      .getNumberFormat() === '@',
      'invoice_date cell is plain text, not a coerced date serial');

    // --- the voucher's total is the server's arithmetic, not the caller's
    const v1 = createVoucherFromInvoices_(p.id, [i1.id, i2.id], '2026-03-05', user);
    billIds.push(v1.id);
    assert_(v1.amount === 30, 'voucher totals its invoices, got ' + v1.amount);
    assert_(v1.invoice_total === 30, 'invoice_total records what was billed');
    assert_(v1.adjustment === 0, 'a fresh voucher has no adjustment');
    assert_(v1.amount_expr === '10+20', 'breakdown is a + chain, got ' + v1.amount_expr);
    assert_(v1.note.indexOf('INVOICE NO.- ') === 0 &&
      v1.note.indexOf(i1.invoice_no) >= 0 && v1.note.indexOf(i2.invoice_no) >= 0,
      'narration carries both invoice numbers, got ' + v1.note);
    const spent = readAll_('invoices').filter(function (r) {
      return r.id === i1.id || r.id === i2.id;
    });
    assert_(spent.length === 2 && spent[0].status === 'allocated' &&
      spent[1].status === 'allocated' && spent[0].bill_id === v1.id,
      'both invoices are marked allocated against the new voucher');

    // --- the same id twice must not be counted twice
    const i3 = mkInv('INV-C', 7);
    const v2 = createVoucherFromInvoices_(p.id, [i3.id, i3.id], '2026-03-05', user);
    billIds.push(v2.id);
    assert_(v2.amount === 7, 'a duplicated id is deduped, not double-counted, got ' + v2.amount);
    assert_(v2.amount_expr === '', 'a single invoice stores no breakdown');

    // --- refusals abort the WHOLE call, leaving nothing half-spent
    const i4 = mkInv('INV-D', 5);
    threw = false;
    try {
      createVoucherFromInvoices_(p.id, [i4.id, i1.id], '2026-03-06', user);
    } catch (e) { threw = true; errMsg = e.message; }
    assert_(threw && errMsg.indexOf('already on a voucher') >= 0,
      'an already-spent invoice is refused, got: ' + errMsg);
    const i4After = readAll_('invoices').filter(function (r) { return r.id === i4.id; })[0];
    assert_(i4After.status === 'unallocated',
      'the OTHER invoice in a refused call is left untouched — no partial spend');

    // --- an invoice cannot be pulled onto another party's voucher
    const p2 = createParty_('ZZ Test Party B ' + stamp);
    parties2.push(p2);
    threw = false;
    try {
      createVoucherFromInvoices_(p2.id, [i4.id], '2026-03-06', user);
    } catch (e) { threw = true; errMsg = e.message; }
    assert_(threw && errMsg.indexOf('different party') >= 0,
      'an invoice belonging to another party is refused, got: ' + errMsg);

    threw = false;
    try { createVoucherFromInvoices_(p.id, ['no-such-id'], '2026-03-06', user); }
    catch (e) { threw = true; errMsg = e.message; }
    assert_(threw && errMsg.indexOf('not found') >= 0,
      'an unknown invoice id is refused, got: ' + errMsg);

    // --- an allocated invoice is frozen
    threw = false;
    try { updateInvoice_(i1.id, { amount: 99 }); } catch (e) { threw = true; errMsg = e.message; }
    assert_(threw && errMsg.indexOf('on a voucher') >= 0,
      'a spent invoice cannot be edited, got: ' + errMsg);
    threw = false;
    try { deleteInvoice_(i1.id); } catch (e) { threw = true; errMsg = e.message; }
    assert_(threw && errMsg.indexOf('on a voucher') >= 0,
      'a spent invoice cannot be deleted, got: ' + errMsg);
    updateInvoice_(i4.id, { amount: 6 });
    assert_(readAll_('invoices').filter(function (r) { return r.id === i4.id; })[0].amount === 6,
      'an unallocated invoice can still be corrected');

    // --- the adjustment is derived from invoice_total, and can go either way
    const adj = adjustVoucherAmount_(v1.id, 29.5);
    assert_(adj.adjustment === 0.5,
      'adjustment = invoice_total - amount, got ' + adj.adjustment);
    const v1Read = readAll_('bills').filter(function (b) { return b.id === v1.id; })[0];
    assert_(v1Read.amount === 29.5 && v1Read.invoice_total === 30,
      'the voucher keeps what was billed AND what was paid');
    assert_(v1Read.amount_expr === '10+20',
      'adjusting the amount leaves the printed breakdown alone');
    const adjUp = adjustVoucherAmount_(v1.id, 31);
    assert_(adjUp.adjustment === -1, 'a charge added on top is a negative adjustment');

    // A fresh PENDING hand-entered bill: the paid check runs first, so reusing
    // an already-settled one would prove nothing about invoice_total.
    const plain = createBill_({
      party_id: p.id, type: 'paid', amount: 42,
      bill_date: '2026-03-08', note: 'hand entered', amount_expr: ''
    }, user);
    billIds.push(plain.id);
    threw = false;
    try { adjustVoucherAmount_(plain.id, 5); } catch (e) { threw = true; errMsg = e.message; }
    assert_(threw && errMsg.indexOf('not an invoice-derived voucher') >= 0,
      'a hand-entered bill is refused by the voucher adjustment, got: ' + errMsg);
    // ...and the legacy path still works on it, blank new columns and all.
    updateBillAmount_(plain.id, 43, '');
    assert_(readAll_('bills').filter(function (b) { return b.id === plain.id; })[0].amount === 43,
      'a bill predating the invoice columns still edits normally');

    markPaid_(v2.id, 'UTR-' + stamp + '-F', '2026-03-07');
    threw = false;
    try { adjustVoucherAmount_(v2.id, 6); } catch (e) { threw = true; errMsg = e.message; }
    assert_(threw && errMsg.indexOf('already marked paid') >= 0,
      'a paid voucher refuses an adjustment, same rule as a bill edit, got: ' + errMsg);

    // --- deleting a voucher hands its invoices back
    deleteBill_(v1.id);
    billIds.splice(billIds.indexOf(v1.id), 1);
    const freed = readAll_('invoices').filter(function (r) {
      return r.id === i1.id || r.id === i2.id;
    });
    assert_(freed[0].status === 'unallocated' && freed[0].bill_id === '' &&
      freed[1].status === 'unallocated',
      'deleting a voucher releases every invoice it had spent');

    // --- adjustment trail ---------------------------------------------------
    const adjBill = createBill_({
      party_id: p.id, type: 'paid', amount: 1000, bill_date: '2026-08-02',
      note: 'adjust me', amount_expr: ''
    }, user);
    billIds.push(adjBill.id);

    const a1 = updateBillAmount_(adjBill.id, 900, '1000-100', 'short delivery', user);
    assert_(Number(a1.original_amount) === 1000,
      'first adjustment records original_amount 1000, got: ' + a1.original_amount);
    assert_(String(a1.adjusted_by) === user.email, 'adjusted_by is the signed-in user');
    assert_(String(a1.adjusted_at).length > 0, 'adjusted_at is stamped');
    assert_(a1.adjustment_reason.indexOf('short delivery') >= 0,
      'first reason recorded, got: ' + a1.adjustment_reason);

    const a2 = updateBillAmount_(adjBill.id, 850, '1000-100-50', 'damages', user);
    assert_(Number(a2.original_amount) === 1000,
      'second adjustment leaves original_amount at 1000, got: ' + a2.original_amount);
    assert_(a2.adjustment_reason.split('\n').length === 2,
      'reasons append rather than replace, got: ' + a2.adjustment_reason);
    assert_(a2.adjustment_reason.indexOf('short delivery') >= 0 &&
      a2.adjustment_reason.indexOf('damages') >= 0, 'both reasons survive');

    const a3 = updateBillAmount_(adjBill.id, 800, '1000-100-50-50', '', user);
    assert_(a3.adjustment_reason.split('\n').length === 2,
      'a blank reason adds no line, got: ' + a3.adjustment_reason);
    assert_(String(a3.adjusted_at).length > 0,
      'a blank reason still stamps adjusted_at');

    const reread = readAll_('bills').filter(function (b) { return b.id === adjBill.id; })[0];
    assert_(Number(reread.original_amount) === 1000,
      'original_amount round-trips through the sheet');
    assert_(Number(reread.amount) === 800, 'amount round-trips as 800');

    // a paid bill is still refused, and refusing must not stamp anything
    const paidBill = createBill_({
      party_id: p.id, type: 'paid', amount: 500, bill_date: '2026-08-02',
      note: 'already paid', status: 'paid'
    }, user);
    billIds.push(paidBill.id);
    let adjThrew = false;
    try { updateBillAmount_(paidBill.id, 400, '', 'nope', user); }
    catch (e) { adjThrew = true; }
    assert_(adjThrew, 'a paid bill still refuses an amount edit');
    const paidReread = readAll_('bills').filter(function (b) {
      return b.id === paidBill.id;
    })[0];
    assert_(String(paidReread.adjusted_at || '') === '',
      'a refused edit leaves adjusted_at empty');

    Logger.log('ALL TESTS PASSED');
  } finally {
    // --- cleanup: only what this run created. Bill ids are tracked
    // explicitly; bank_txns rows are found by the stamp baked into every
    // test ref above, so a scratch sheet's other rows are left untouched.
    billIds.forEach(function (id) {
      try { deleteBill_(id); } catch (e) { /* already gone, or never committed — fine */ }
    });
    // After the bills, so deleteBill_ has already released whatever it held —
    // an invoice still marked allocated refuses its own delete.
    invoiceIds.forEach(function (id) {
      try {
        const n = findRow_(table_('invoices'), id);
        if (n > 0) sheet_('invoices').deleteRow(n);
      } catch (e) { /* already gone — fine */ }
    });
    parties2.forEach(function (party) {
      const n = findRow_(table_('parties'), party.id);
      if (n > 0) sheet_('parties').deleteRow(n);
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
