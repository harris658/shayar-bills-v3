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
    case 'snapshot':
      return { parties: listParties_(), bills: listBills_(), invoices: listInvoices_() };
    case 'listParties': return listParties_();
    case 'listBills': return listBills_();
    case 'listInvoices': return listInvoices_();
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
    case 'updateBillAmount':
      return withLock_(function () {
        return updateBillAmount_(args.id, args.amount, args.amount_expr);
      });
    case 'deleteBill':
      return withLock_(function () { return deleteBill_(args.id); });
    case 'createInvoice':
      return withLock_(function () { return createInvoice_(args.invoice, user); });
    case 'updateInvoice':
      return withLock_(function () { return updateInvoice_(args.id, args.patch); });
    case 'deleteInvoice':
      return withLock_(function () { return deleteInvoice_(args.id); });
    case 'createVoucherFromInvoices':
      return withLock_(function () {
        return createVoucherFromInvoices_(args.party_id, args.invoice_ids, args.bill_date, user);
      });
    case 'adjustVoucherAmount':
      return withLock_(function () { return adjustVoucherAmount_(args.id, args.amount); });
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

/** Newest first, same convention as listBills_. */
function listInvoices_() {
  return readAll_('invoices').sort(function (a, b) {
    if (a.invoice_date !== b.invoice_date) return a.invoice_date < b.invoice_date ? 1 : -1;
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

/**
 * setCellsBatch_ rather than setCells_ deliberately: setCells_ costs one
 * setValue round trip per field, and at three fields that made markPaid the
 * slowest action in the app (~3.2s) — all of it inside the held lock, so it
 * also blocks the other user for that long. status/payment_ref/payment_date are
 * adjacent columns, so the batch collapses them into a single range write.
 */
function markPaid_(id, paymentRef, paymentDate) {
  const t = table_('bills');
  const rowNum = findRow_(t, id);
  if (rowNum < 0) throw new Error('bill not found');
  setCellsBatch_(t, [{
    rowNum: rowNum,
    patch: {
      status: 'paid',
      payment_ref: String(paymentRef || ''),
      payment_date: paymentDate ? isoDate_(paymentDate) : ''
    }
  }]);
  return { ok: true };
}

/**
 * Corrects a mistyped amount. Amount only — party, date, note and direction are
 * not editable, because a bill with a different party or direction is a
 * different bill and should be deleted and re-entered.
 *
 * Refuses a bill already marked paid: its voucher may be signed and filed, and
 * the payment it was matched against is recorded at the old figure. Enforced
 * here rather than only in the UI — the client is not the authority on this, and
 * a stale client could otherwise send an edit for a bill someone else just
 * settled from another device.
 *
 * setCells_ rather than setCellsBatch_ on purpose: the batch would span
 * amount..amount_expr, sweeping bill_date and note through a getValues/setValues
 * round trip they have no reason to make.
 */
function updateBillAmount_(id, amount, amountExpr) {
  const amt = Number(amount);
  if (!(amt > 0)) throw new Error('amount must be greater than zero');
  const t = table_('bills');
  const rowNum = findRow_(t, id);
  if (rowNum < 0) throw new Error('bill not found');
  const row = t.rows[rowNum - 2]; // -1 header, -1 back to zero-based
  if (String(row[t.index.status]).trim().toLowerCase() === 'paid') {
    throw new Error('bill is already marked paid — delete and re-enter it');
  }
  setCells_(t, rowNum, { amount: amt, amount_expr: String(amountExpr || '') });
  return { ok: true, id: String(id), amount: amt, amount_expr: String(amountExpr || '') };
}

/**
 * Deleting a voucher frees the invoices it consumed, so they can go onto the
 * next one.
 *
 * The row is deleted BEFORE the invoices are released, and the order is
 * load-bearing. Released-then-failed would leave invoices marked unallocated
 * while the voucher that already claimed them still exists — they could be
 * vouchered a second time, and the shop would pay twice. Deleted-then-failed
 * leaves invoices pointing at a voucher that is gone: visible, harmless, and
 * fixable, because nothing can spend them again while they read as allocated.
 */
function deleteBill_(id) {
  const t = table_('bills');
  const rowNum = findRow_(t, id);
  if (rowNum < 0) throw new Error('bill not found');
  const row = t.rows[rowNum - 2]; // -1 header, -1 back to zero-based
  const ids = t.index.invoice_ids === undefined
    ? [] : splitIds_(row[t.index.invoice_ids]);

  t.sheet.deleteRow(rowNum);
  if (ids.length) releaseInvoices_(ids);
  return { ok: true };
}

/** "a,b,c" -> ['a','b','c']; blank -> []. Tolerates spaces and trailing commas. */
function splitIds_(v) {
  return String(v == null ? '' : v)
    .split(',')
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s.length > 0; });
}

/** Marks the given invoices unallocated. Ignores ids that no longer exist. */
function releaseInvoices_(ids) {
  const t = table_('invoices');
  const patches = [];
  ids.forEach(function (id) {
    const rowNum = findRow_(t, id);
    if (rowNum > 0) {
      patches.push({ rowNum: rowNum, patch: { status: 'unallocated', bill_id: '' } });
    }
  });
  setCellsBatch_(t, patches);
}

/* ---------------------------------------------------------------------------
   Invoices (GRC PIs)

   Recorded by hand when the invoice is raised in the ERP, long before anyone
   knows whether it will be paid this month. Later some of them are selected
   and become one debit voucher — a `bills` row — which is why an invoice is a
   separate record rather than a line typed into the voucher: it exists first,
   and only some of them are ever spent.
   ------------------------------------------------------------------------- */

/** Money is summed in integer paise — 0.1 + 0.2 on rupees puts 71 in the paise column. */
function toPaise_(v) {
  return Math.round(Number(v) * 100);
}

function partyExists_(partyId) {
  const t = table_('parties');
  return findRow_(t, partyId) > 0;
}

function createInvoice_(inv, user) {
  if (!inv) throw new Error('invoice required');
  const partyId = String(inv.party_id || '').trim();
  if (!partyId) throw new Error('party_id required');
  // Checked, unlike createBill_: an invoice whose party does not exist would be
  // invisible in the voucher builder, which lists strictly by party.
  if (!partyExists_(partyId)) throw new Error('party not found');
  const amount = Number(inv.amount);
  if (!(amount > 0)) throw new Error('amount must be greater than zero');
  const invoiceNo = String(inv.invoice_no || '').trim();
  if (!invoiceNo) throw new Error('invoice number required');
  const invoiceDate = isoDate_(inv.invoice_date);
  if (!invoiceDate) throw new Error('invoice date required');

  // Deliberately no duplicate invoice_no check. The numbers come from another
  // system this app cannot see, and refusing a legitimate re-entry over a
  // suspected duplicate is worse than an accidental one Hussain can delete.
  const row = {
    id: Utilities.getUuid(),
    party_id: partyId,
    invoice_no: invoiceNo,
    amount: amount,
    invoice_date: invoiceDate,
    note: String(inv.note || ''),
    status: 'unallocated',
    bill_id: '',
    created_by: user.email,
    created_at: nowIso_()
  };
  appendRowSafe_(table_('invoices'), row);
  return row;
}

/**
 * Corrects a mis-entered invoice — everything is editable, unlike a bill,
 * because an invoice is a transcription of a document that exists elsewhere and
 * a typo in it means nothing more than a typo.
 *
 * Refused once the invoice is on a voucher: that voucher's amount, narration
 * and printed item lines were derived from these values, and editing underneath
 * it would leave a signed document that no longer matches its own source rows.
 */
function updateInvoice_(id, patch) {
  const t = table_('invoices');
  const rowNum = findRow_(t, id);
  if (rowNum < 0) throw new Error('invoice not found');
  const row = t.rows[rowNum - 2];
  if (isAllocated_(t, row)) {
    throw new Error('invoice is on a voucher — delete the voucher to free it');
  }
  patch = patch || {};
  const clean = {};
  if (patch.invoice_no !== undefined) {
    const n = String(patch.invoice_no).trim();
    if (!n) throw new Error('invoice number required');
    clean.invoice_no = n;
  }
  if (patch.amount !== undefined) {
    const a = Number(patch.amount);
    if (!(a > 0)) throw new Error('amount must be greater than zero');
    clean.amount = a;
  }
  if (patch.invoice_date !== undefined) {
    const d = isoDate_(patch.invoice_date);
    if (!d) throw new Error('invoice date required');
    clean.invoice_date = d;
  }
  if (patch.note !== undefined) clean.note = String(patch.note);
  // party_id and status are not patchable: moving an invoice to another party
  // is a different invoice, and status is owned by the voucher lifecycle.
  if (!Object.keys(clean).length) throw new Error('nothing to update');
  setCells_(t, rowNum, clean);
  return Object.assign({ ok: true, id: String(id) }, clean);
}

function deleteInvoice_(id) {
  const t = table_('invoices');
  const rowNum = findRow_(t, id);
  if (rowNum < 0) throw new Error('invoice not found');
  if (isAllocated_(t, t.rows[rowNum - 2])) {
    throw new Error('invoice is on a voucher — delete the voucher to free it');
  }
  t.sheet.deleteRow(rowNum);
  return { ok: true };
}

function isAllocated_(t, row) {
  return String(row[t.index.status]).trim().toLowerCase() === 'allocated';
}

/** Prefix on the printed narration, matching what was written on the pad by hand. */
const NARRATION_PREFIX_ = 'INVOICE NO.- ';

/**
 * Turns a selection of invoices into one debit voucher.
 *
 * Everything that matters is computed here rather than accepted from the
 * client: the total, the narration and the printed breakdown. The client's own
 * arithmetic is a preview, nothing more — a stale tab could otherwise voucher
 * ₹30,000 worth of invoices for ₹20,000 and the paperwork would be internally
 * consistent while being wrong.
 *
 * All-or-nothing by design. One bad id — already spent, wrong party, deleted
 * out from under the tab — aborts the whole call before a single write, so two
 * people building vouchers at the same time can never half-spend a selection.
 */
function createVoucherFromInvoices_(partyId, invoiceIds, billDate, user) {
  const party = String(partyId || '').trim();
  if (!party) throw new Error('party_id required');

  // Deduped: the same id twice in one payload would otherwise be counted twice
  // in the total while being allocated once.
  const ids = [];
  (invoiceIds || []).forEach(function (raw) {
    const id = String(raw).trim();
    if (id && ids.indexOf(id) < 0) ids.push(id);
  });
  if (!ids.length) throw new Error('select at least one invoice');

  const invT = table_('invoices');
  const picked = [];
  ids.forEach(function (id) {
    const rowNum = findRow_(invT, id);
    if (rowNum < 0) throw new Error('invoice not found: ' + id);
    const row = invT.rows[rowNum - 2];
    if (isAllocated_(invT, row)) {
      throw new Error('invoice is already on a voucher: ' +
        String(row[invT.index.invoice_no]));
    }
    if (String(row[invT.index.party_id]).trim() !== party) {
      throw new Error('invoice belongs to a different party: ' +
        String(row[invT.index.invoice_no]));
    }
    picked.push({
      id: id,
      rowNum: rowNum,
      invoice_no: String(row[invT.index.invoice_no]),
      amount: Number(row[invT.index.amount])
    });
  });

  let paise = 0;
  picked.forEach(function (p) {
    if (!(p.amount > 0)) throw new Error('invoice has no amount: ' + p.invoice_no);
    paise += toPaise_(p.amount);
  });
  const total = paise / 100;

  // amount_expr is what print.js turns into the voucher's Rs./P. item lines. It
  // only itemises a plain '+' chain of at most three terms; a single invoice or
  // more than three prints the TOTAL alone, which is how the pad is filled in by
  // hand in exactly those cases. Storing '' for one invoice matches what the
  // manual entry form stores for a bare amount.
  const expr = picked.length > 1
    ? picked.map(function (p) { return String(p.amount); }).join('+')
    : '';

  const bill = {
    id: Utilities.getUuid(),
    party_id: party,
    type: 'paid',
    amount: total,
    bill_date: isoDate_(billDate),
    note: NARRATION_PREFIX_ + picked.map(function (p) { return p.invoice_no; }).join(', '),
    amount_expr: expr,
    status: 'pending',
    payment_ref: '',
    payment_date: '',
    created_by: user.email,
    created_at: nowIso_(),
    invoice_total: total,
    adjustment: 0,
    invoice_ids: ids.join(',')
  };
  appendRowSafe_(table_('bills'), bill);

  setCellsBatch_(invT, picked.map(function (p) {
    return { rowNum: p.rowNum, patch: { status: 'allocated', bill_id: bill.id } };
  }));

  return bill;
}

/**
 * Records what was actually paid after Avinash deducts a discount or an
 * adjustment on the printed voucher.
 *
 * Separate from updateBillAmount_ rather than a flag on it. That call rewrites
 * amount_expr as well, so routing an adjustment through it would mean the
 * client resending the breakdown it did not change — and a client that sends ''
 * would silently wipe the itemisation off a voucher that has already been
 * printed and signed. This one touches amount and adjustment, nothing else.
 *
 * `adjustment` is derived, never sent: Hussain types only the figure the bank
 * debited, and what was deducted falls out of invoice_total − amount. Negative
 * is legal — charges added on top are an adjustment too.
 */
function adjustVoucherAmount_(id, amount) {
  const amt = Number(amount);
  if (!(amt > 0)) throw new Error('amount must be greater than zero');
  const t = table_('bills');
  const rowNum = findRow_(t, id);
  if (rowNum < 0) throw new Error('bill not found');
  const row = t.rows[rowNum - 2];
  if (String(row[t.index.status]).trim().toLowerCase() === 'paid') {
    throw new Error('bill is already marked paid — delete and re-enter it');
  }
  const rawTotal = t.index.invoice_total === undefined ? '' : row[t.index.invoice_total];
  if (String(rawTotal).trim() === '') {
    throw new Error('not an invoice-derived voucher — edit its amount instead');
  }
  const adjustment = (toPaise_(rawTotal) - toPaise_(amt)) / 100;
  setCells_(t, rowNum, { amount: amt, adjustment: adjustment });
  return { ok: true, id: String(id), amount: amt, adjustment: adjustment };
}

/**
 * Wipes bills AND imported bank txns. The txns reference bills and, kept
 * alone, would dedupe-block re-importing old statements. Parties stay.
 *
 * Invoices are kept too, but every one of them is released back to the
 * unallocated pool: the vouchers that spent them no longer exist, and an
 * invoice left pointing at a deleted bill could never be vouchered again. They
 * are not deleted because the confirmation the user answers promises bills and
 * bank transactions, and destroying a pool of hand-entered invoices nobody was
 * warned about is not a thing to do quietly.
 */
function deleteAllBills_() {
  clearRows_('bank_txns');
  clearRows_('bills');
  const invT = table_('invoices');
  const patches = [];
  // Row number comes from the unfiltered index — filtering first and using the
  // survivor's position would patch the wrong rows the moment a blank row exists.
  invT.rows.forEach(function (r, i) {
    if (!String(r[invT.index.id] || '').length) return;
    patches.push({ rowNum: i + 2, patch: { status: 'unallocated', bill_id: '' } });
  });
  setCellsBatch_(invT, patches);
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
    // Force plain text on ref AND txn_date before writing — see textFields_()
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
