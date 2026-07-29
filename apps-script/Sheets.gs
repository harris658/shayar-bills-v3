/** Sheet access. Knows about the spreadsheet; knows nothing about auth or actions. */

function ss_() {
  return SpreadsheetApp.getActive();
}

function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('missing tab: ' + name);
  return sh;
}

/**
 * Reads a whole tab into a header-mapped table.
 * Columns are located by header text, so reordering columns in the Sheet
 * does not break reads.
 */
function table_(name) {
  const sh = sheet_(name);
  const values = sh.getDataRange().getValues();
  const headers = (values.shift() || []).map(function (h) { return String(h).trim(); });
  const index = {};
  headers.forEach(function (h, i) { if (h) index[h] = i; });
  if (index.id === undefined && name !== 'allowed_users') {
    throw new Error('tab ' + name + ' has no "id" header');
  }
  return { name: name, sheet: sh, headers: headers, index: index, rows: values };
}

/** Sheets may hand back a Date despite plain-text formatting. Normalise on read. */
function isoDate_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, ss_().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  }
  return String(v == null ? '' : v).trim();
}

const DATE_FIELDS_ = ['bill_date', 'payment_date', 'txn_date'];

function rowToObj_(t, row) {
  const o = {};
  t.headers.forEach(function (h, i) {
    if (!h) return;
    o[h] = DATE_FIELDS_.indexOf(h) >= 0 ? isoDate_(row[i]) : row[i];
  });
  return o;
}

function readAll_(name) {
  const t = table_(name);
  return t.rows
    .filter(function (r) { return String(r[t.index.id] || '').length > 0; })
    .map(function (r) { return rowToObj_(t, r); });
}

function objToRow_(t, obj) {
  return t.headers.map(function (h) {
    return h && obj[h] !== undefined && obj[h] !== null ? obj[h] : '';
  });
}

/** Returns the 1-based sheet row number for an id, or -1. */
function findRow_(t, id) {
  const want = String(id);
  for (let i = 0; i < t.rows.length; i++) {
    if (String(t.rows[i][t.index.id]) === want) return i + 2; // +1 header, +1 one-based
  }
  return -1;
}

function setCells_(t, rowNum, patch) {
  Object.keys(patch).forEach(function (k) {
    if (t.index[k] === undefined) return;
    t.sheet.getRange(rowNum, t.index[k] + 1).setValue(patch[k]);
  });
}

function clearRows_(name) {
  const sh = sheet_(name);
  const last = sh.getLastRow();
  if (last > 1) sh.deleteRows(2, last - 1);
}

/** Serialises every write across all users and devices. */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('busy');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function nowIso_() {
  return new Date().toISOString();
}
