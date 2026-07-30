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
  appendRowSafe_(t, party);
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
  appendRowSafe_(t, row);
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
 * One locked call does the whole statement import: insert every new txn and
 * mark every matched bill paid.
 *
 * Ordering matters for partial-failure recovery: every bank_txns write
 * happens before any bill is marked, so a mid-run timeout leaves recorded-
 * but-unmarked state — safe, and finishable by calling this function again
 * with the same matches (see below for how) — rather than marked-but-
 * unrecorded state (which looks, from applied/txns, like nothing happened
 * at all).
 *
 * A (ref, amount, txn_date) triple already present — in the sheet, or
 * repeated within this payload — is never re-inserted. If that triple shows
 * up again inside `matches`, its bill is still marked paid and the existing
 * txn row's matched_bill_id is corrected; the match is not silently dropped.
 *
 * This "recorded-but-unmarked" state can only be finished by calling
 * applyImport_ again directly with the same matches (as Tests.gs's
 * re-import case does) — it is NOT reachable by re-running the import
 * screen. js/screens/import.js dedupes the parsed statement against
 * listBankTxns() on the client, before it ever builds `matches`, so an
 * already-inserted txn is filtered out client-side and its bill's
 * `matches` entry never gets rebuilt or resent. Recovering a partial run
 * today means calling applyImport with the original matches from outside
 * the app (the script editor, or a one-off request) — there is no UI path
 * to it.
 */
function applyImport_(matches, unmatchedTxns) {
  matches = matches || [];
  unmatchedTxns = unmatchedTxns || [];

  const txT = table_('bank_txns');
  const seen = {}; // key -> existing row's id, or true once queued/handled this call
  txT.rows.forEach(function (r) {
    seen[txnKey_(r[txT.index.ref], r[txT.index.amount], r[txT.index.txn_date])] = r[txT.index.id];
  });

  const billT = table_('bills');
  const newRows = [];
  const billPatches = [];
  let applied = 0;

  matches.forEach(function (m) {
    const key = txnKey_(m.txn.ref, m.txn.amount, m.txn.txn_date);
    const existing = seen[key];
    if (existing === undefined) {
      seen[key] = true;
      newRows.push(txnRow_(txT, m.txn, m.bill_id));
    } else if (existing !== true) {
      // Already sitting in the sheet from a previous import — this call is
      // correcting or adding its match, not re-inserting the row.
      const existingRowNum = findRow_(txT, existing);
      if (existingRowNum > 0) setCells_(txT, existingRowNum, { matched_bill_id: m.bill_id });
      seen[key] = true;
    }

    // Runs for every match, dedupe hit or not — a re-matched txn must still
    // pay its bill, not vanish into {applied: 0, txns: 0}.
    const billRowNum = findRow_(billT, m.bill_id);
    if (billRowNum > 0) {
      billPatches.push({
        rowNum: billRowNum,
        patch: {
          status: 'paid',
          payment_ref: String(m.txn.ref || ''),
          payment_date: isoDate_(m.txn.txn_date)
        }
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
    const startRow = txT.sheet.getLastRow() + 1;
    // Force plain text on ref AND txn_date before writing — see TEXT_FIELDS_
    // in Sheets.gs. A digits-only ref (e.g. "007123456") would otherwise be
    // stored as a number, and String()-ing it back on the next import no
    // longer equals the incoming ref: txnKey_ silently stops matching and the
    // dedupe defence that replaced Postgres's unique constraint breaks.
    // txn_date is equally at risk and used to be missed here.
    forceTextCols_(txT, startRow, newRows.length);
    txT.sheet.getRange(startRow, 1, newRows.length, txT.headers.length).setValues(newRows);
  }

  // Batched, and only after every txn-table write above has landed.
  setCellsBatch_(billT, billPatches);

  return { applied: applied, txns: newRows.length };
}
