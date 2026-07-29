/** Web app entry point and action dispatch. */

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    const user = verifyToken_(req.idToken);
    return json_({ ok: true, data: dispatch_(req.action, req.args || {}, user) });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function dispatch_(action, args, user) {
  switch (action) {
    case 'ping': return { pong: true, email: user.email };

    // Reads — no lock.
    case 'snapshot': return { parties: listParties_(), bills: listBills_() };
    case 'listParties': return listParties_();
    case 'listBills': return listBills_();
    case 'listBankTxns': return readAll_('bank_txns');

    // Writes — all serialised.
    case 'createParty':
      return withLock_(function () { return createParty_(args.name); });
    case 'createBill':
      return withLock_(function () { return createBill_(args.bill, user); });
    case 'markPaid':
      return withLock_(function () {
        return markPaid_(args.id, args.payment_ref, args.payment_date);
      });
    case 'deleteBill':
      return withLock_(function () { return deleteBill_(args.id); });
    case 'deleteAllBills':
      return withLock_(function () { return deleteAllBills_(); });
    case 'applyImport':
      return withLock_(function () {
        return applyImport_(args.matches, args.unmatchedTxns);
      });

    default: throw new Error('unknown action: ' + action);
  }
}

function listParties_() {
  return readAll_('parties').sort(function (a, b) {
    return String(a.name).localeCompare(String(b.name));
  });
}

/** Newest first — bill_date desc, then created_at desc. Mirrors the old SQL order. */
function listBills_() {
  return readAll_('bills').sort(function (a, b) {
    if (a.bill_date !== b.bill_date) return a.bill_date < b.bill_date ? 1 : -1;
    return String(a.created_at) < String(b.created_at) ? 1 : -1;
  });
}

function createParty_(name) {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('party name required');
  const t = table_('parties');
  const lower = clean.toLowerCase();
  for (let i = 0; i < t.rows.length; i++) {
    if (String(t.rows[i][t.index.name]).trim().toLowerCase() === lower) {
      throw new Error('party already exists: ' + clean);
    }
  }
  const party = {
    id: Utilities.getUuid(),
    name: clean,
    phone: '',
    notes: '',
    created_at: nowIso_()
  };
  t.sheet.appendRow(objToRow_(t, party));
  return party;
}

function createBill_(bill, user) {
  if (!bill) throw new Error('bill required');
  const type = bill.type === 'received' ? 'received' : 'paid';
  const amount = Number(bill.amount);
  if (!(amount > 0)) throw new Error('amount must be greater than zero');
  if (!String(bill.party_id || '').trim()) throw new Error('party_id required');

  const row = {
    id: Utilities.getUuid(),
    party_id: String(bill.party_id),
    type: type,
    amount: amount,
    bill_date: isoDate_(bill.bill_date),
    note: String(bill.note || ''),
    amount_expr: String(bill.amount_expr || ''),
    status: bill.status === 'paid' ? 'paid' : 'pending',
    payment_ref: String(bill.payment_ref || ''),
    payment_date: bill.payment_date ? isoDate_(bill.payment_date) : '',
    created_by: user.email,
    created_at: nowIso_()
  };
  const t = table_('bills');
  t.sheet.appendRow(objToRow_(t, row));
  return row;
}

function markPaid_(id, paymentRef, paymentDate) {
  const t = table_('bills');
  const rowNum = findRow_(t, id);
  if (rowNum < 0) throw new Error('bill not found');
  setCells_(t, rowNum, {
    status: 'paid',
    payment_ref: String(paymentRef || ''),
    payment_date: paymentDate ? isoDate_(paymentDate) : ''
  });
  return { ok: true };
}

function deleteBill_(id) {
  const t = table_('bills');
  const rowNum = findRow_(t, id);
  if (rowNum < 0) throw new Error('bill not found');
  t.sheet.deleteRow(rowNum);
  return { ok: true };
}

/**
 * Wipes bills AND imported bank txns. The txns reference bills and, kept
 * alone, would dedupe-block re-importing old statements. Parties stay.
 */
function deleteAllBills_() {
  clearRows_('bank_txns');
  clearRows_('bills');
  return { ok: true };
}

function txnKey_(ref, amount, txnDate) {
  return String(ref == null ? '' : ref).trim() + '|' +
    Number(amount) + '|' +
    isoDate_(txnDate);
}

function txnRow_(t, txn, matchedBillId) {
  return objToRow_(t, {
    id: Utilities.getUuid(),
    txn_date: isoDate_(txn.txn_date),
    amount: Number(txn.amount),
    ref: String(txn.ref || ''),
    description: String(txn.description || ''),
    matched_bill_id: matchedBillId || '',
    imported_at: nowIso_()
  });
}

/**
 * One locked call does the whole statement import: insert every txn and mark
 * every matched bill paid. Replaces the old two-requests-per-match loop.
 */
function applyImport_(matches, unmatchedTxns) {
  matches = matches || [];
  unmatchedTxns = unmatchedTxns || [];

  const txT = table_('bank_txns');
  const seen = {};
  txT.rows.forEach(function (r) {
    seen[txnKey_(r[txT.index.ref], r[txT.index.amount], r[txT.index.txn_date])] = true;
  });

  const billT = table_('bills');
  const newRows = [];
  let applied = 0;

  matches.forEach(function (m) {
    const key = txnKey_(m.txn.ref, m.txn.amount, m.txn.txn_date);
    if (seen[key]) return;
    seen[key] = true;
    newRows.push(txnRow_(txT, m.txn, m.bill_id));
    const rowNum = findRow_(billT, m.bill_id);
    if (rowNum > 0) {
      setCells_(billT, rowNum, {
        status: 'paid',
        payment_ref: String(m.txn.ref || ''),
        payment_date: isoDate_(m.txn.txn_date)
      });
      applied++;
    }
  });

  unmatchedTxns.forEach(function (txn) {
    const key = txnKey_(txn.ref, txn.amount, txn.txn_date);
    if (seen[key]) return;
    seen[key] = true;
    newRows.push(txnRow_(txT, txn, ''));
  });

  if (newRows.length) {
    txT.sheet
      .getRange(txT.sheet.getLastRow() + 1, 1, newRows.length, txT.headers.length)
      .setValues(newRows);
  }
  return { applied: applied, txns: newRows.length };
}
