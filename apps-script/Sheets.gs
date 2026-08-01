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

const DATE_FIELDS_ = ['bill_date', 'payment_date', 'txn_date', 'invoice_date'];

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

/**
 * Fields Sheets must never type-coerce.
 *
 * Formatting these columns as plain text in the spreadsheet is NOT enough:
 * `appendRow` and `setValues` re-infer the type of what they write and stamp
 * their own format over the column's, so a `yyyy-mm-dd` string lands as a date
 * serial (46233) wearing a `yyyy-mm-dd` mask — it reads back correctly right
 * up until a timezone shifts it a day, and `isoDate_` cannot tell the
 * difference. A digits-only `ref` is worse: it becomes a number, drops its
 * leading zeros, and silently breaks the import dedupe that replaced
 * Postgres's unique constraint.
 *
 * Every write path therefore forces '@' on these columns immediately before
 * writing. Bare dates and refs are the only values at risk — ISO timestamps
 * (`created_at`, with its `Z`) and amounts are left alone deliberately;
 * amounts must stay numeric.
 */
function textFields_() {
  return ['bill_date', 'payment_date', 'txn_date', 'ref', 'payment_ref', 'invoice_date'];
}

/** Forces plain text on every textFields_() column across `rowCount` rows from `startRow`. */
function forceTextCols_(t, startRow, rowCount) {
  textFields_().forEach(function (f) {
    const c = t.index[f];
    if (c === undefined) return;
    t.sheet.getRange(startRow, c + 1, rowCount, 1).setNumberFormat('@');
  });
}

/** appendRow that survives Sheets' type inference. Returns the row number written. */
function appendRowSafe_(t, obj) {
  const row = objToRow_(t, obj);
  const startRow = t.sheet.getLastRow() + 1;
  forceTextCols_(t, startRow, 1);
  t.sheet.getRange(startRow, 1, 1, t.headers.length).setValues([row]);
  return startRow;
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
    const cell = t.sheet.getRange(rowNum, t.index[k] + 1);
    // setValue re-infers type just like appendRow — see textFields_().
    if (textFields_().indexOf(k) >= 0) cell.setNumberFormat('@');
    cell.setValue(patch[k]);
  });
}

/**
 * Batched multi-row patch for cases where setCells_'s one-setValue-per-field
 * cost is too slow (e.g. marking 150 bills paid from a single statement
 * import inside a held lock). Merges duplicate rowNums (last patch wins per
 * field), groups contiguous rows into a single range read+write, and touches
 * only the span of columns actually patched. Does not change setCells_ or
 * its behaviour for existing single-row callers.
 */
function setCellsBatch_(t, patches) {
  if (!patches || !patches.length) return;

  const byRow = {};
  const order = [];
  patches.forEach(function (p) {
    if (!byRow[p.rowNum]) {
      byRow[p.rowNum] = { rowNum: p.rowNum, patch: {} };
      order.push(p.rowNum);
    }
    Object.keys(p.patch).forEach(function (k) {
      byRow[p.rowNum].patch[k] = p.patch[k];
    });
  });
  const merged = order
    .sort(function (a, b) { return a - b; })
    .map(function (r) { return byRow[r]; });

  const cols = [];
  merged.forEach(function (p) {
    Object.keys(p.patch).forEach(function (k) {
      if (t.index[k] !== undefined) cols.push(t.index[k]);
    });
  });
  if (!cols.length) return;
  const minCol = Math.min.apply(null, cols);
  const maxCol = Math.max.apply(null, cols);
  const width = maxCol - minCol + 1;

  let i = 0;
  while (i < merged.length) {
    let j = i;
    while (j + 1 < merged.length && merged[j + 1].rowNum === merged[j].rowNum + 1) j++;
    const startRow = merged[i].rowNum;
    const rowCount = j - i + 1;
    const range = t.sheet.getRange(startRow, minCol + 1, rowCount, width);
    const values = range.getValues();
    for (let r = i; r <= j; r++) {
      const rowValues = values[r - i];
      Object.keys(merged[r].patch).forEach(function (k) {
        if (t.index[k] !== undefined) rowValues[t.index[k] - minCol] = merged[r].patch[k];
      });
    }
    // setValues re-infers type — force '@' on any textFields_() column inside
    // this span before writing. payment_date/payment_ref reach this path when
    // applyImport_ marks a statement's worth of bills paid in one batch.
    textFields_().forEach(function (f) {
      const c = t.index[f];
      if (c === undefined || c < minCol || c > maxCol) return;
      t.sheet.getRange(startRow, c + 1, rowCount, 1).setNumberFormat('@');
    });
    range.setValues(values);
    i = j + 1;
  }
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
