/**
 * Runs apps-script/Tests.gs — the REAL server source — in Node, against a
 * simulated Sheets backend.
 *
 * Why this exists: `runTests()` is documented as a manual run from the Apps
 * Script editor, and the REST API's scripts.run is 403 for this project (the
 * script is not linked to a standalone GCP project). That left the server the
 * one part of the app whose tests nobody could execute without a browser and a
 * scratch spreadsheet — so in practice they were read, not run.
 *
 * The simulation is deliberately hostile in the two ways Sheets actually is,
 * because those are the bugs this code exists to prevent:
 *
 *   - a yyyy-mm-dd string written into a cell that is NOT plain text comes back
 *     as a Date, exactly as Sheets re-infers it;
 *   - a digits-only string written into a cell that is NOT plain text comes
 *     back as a Number, dropping leading zeros.
 *
 * So forceTextCols_/textFields_ are genuinely exercised: remove them and this
 * harness fails, as the live Sheet would.
 *
 * It does NOT replace the editor run. It cannot see quota, locking across
 * processes, timezone configuration, or anything about the real spreadsheet's
 * contents. It answers one question — does this code do what it claims on a
 * sheet shaped like ours — and it answers it before the live deploy.
 *
 *   node scripts/run-appsscript-tests.mjs
 */
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const gs = (f) => readFileSync(join(here, '..', 'apps-script', f), 'utf8');

const SCHEMA = {
  parties: ['id', 'name', 'phone', 'notes', 'created_at'],
  bills: ['id', 'party_id', 'type', 'amount', 'bill_date', 'note', 'amount_expr',
    'status', 'payment_ref', 'payment_date', 'created_by', 'created_at',
    'invoice_total', 'adjustment', 'invoice_ids'],
  invoices: ['id', 'party_id', 'invoice_no', 'amount', 'invoice_date', 'note',
    'status', 'bill_id', 'created_by', 'created_at'],
  bank_txns: ['id', 'txn_date', 'amount', 'ref', 'description', 'matched_bill_id',
    'imported_at']
};

const pad2 = (n) => String(n).padStart(2, '0');

/** Sheets' own type re-inference, which is what textFields_ defends against. */
function coerce(value, format) {
  if (format === '@') return value;
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(value + 'T00:00:00Z');
    if (/^\d+$/.test(value)) return Number(value);
  }
  return value;
}

function makeSheet(name, headers) {
  const values = [headers.slice()];
  const formats = [headers.map(() => '')];
  const width = () => Math.max(...values.map((r) => r.length), headers.length);

  function ensure(row, col) {
    while (values.length < row) { values.push([]); formats.push([]); }
    const r = values[row - 1], f = formats[row - 1];
    while (r.length < col) r.push('');
    while (f.length < col) f.push('');
  }

  const sheet = {
    getName: () => name,
    getLastRow() {
      for (let i = values.length; i > 0; i--) {
        if (values[i - 1].some((c) => c !== '' && c !== undefined && c !== null)) return i;
      }
      return 0;
    },
    getDataRange() {
      return sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 1), width());
    },
    getRange(row, col, numRows = 1, numCols = 1) {
      return {
        getValues() {
          const out = [];
          for (let r = 0; r < numRows; r++) {
            ensure(row + r, col + numCols - 1);
            out.push(values[row + r - 1].slice(col - 1, col - 1 + numCols)
              .map((v) => (v === undefined ? '' : v)));
          }
          return out;
        },
        setValues(vals) {
          if (vals.length !== numRows) throw new Error('setValues: row count mismatch');
          for (let r = 0; r < numRows; r++) {
            if (vals[r].length !== numCols) throw new Error('setValues: col count mismatch');
            ensure(row + r, col + numCols - 1);
            for (let c = 0; c < numCols; c++) {
              const fmt = formats[row + r - 1][col - 1 + c];
              values[row + r - 1][col - 1 + c] = coerce(vals[r][c], fmt);
            }
          }
        },
        getValue() { return this.getValues()[0][0]; },
        setValue(v) { this.setValues([[v]]); },
        setNumberFormat(fmt) {
          for (let r = 0; r < numRows; r++) {
            ensure(row + r, col + numCols - 1);
            for (let c = 0; c < numCols; c++) formats[row + r - 1][col - 1 + c] = fmt;
          }
          return this;
        },
        getNumberFormat() {
          ensure(row, col);
          return formats[row - 1][col - 1] || '';
        }
      };
    },
    deleteRow(n) { values.splice(n - 1, 1); formats.splice(n - 1, 1); },
    deleteRows(start, count) { values.splice(start - 1, count); formats.splice(start - 1, count); }
  };
  return sheet;
}

const sheets = {};
Object.keys(SCHEMA).forEach((n) => { sheets[n] = makeSheet(n, SCHEMA[n]); });

let uuidN = 0;
const logs = [];

const sandbox = {
  SpreadsheetApp: {
    getActive: () => ({
      getSheetByName: (n) => sheets[n] || null,
      getSpreadsheetTimeZone: () => 'Asia/Kolkata'
    })
  },
  Utilities: {
    getUuid: () => 'uuid-' + (++uuidN),
    formatDate(date, tz, fmt) {
      if (fmt !== 'yyyy-MM-dd') throw new Error('sim only formats yyyy-MM-dd');
      // The real call is timezone-aware; the sim stores midnight UTC, so UTC
      // getters reproduce the same calendar day without pulling in a tz table.
      return date.getUTCFullYear() + '-' + pad2(date.getUTCMonth() + 1) + '-' +
        pad2(date.getUTCDate());
    }
  },
  LockService: {
    getScriptLock: () => ({ tryLock: () => true, releaseLock() {} })
  },
  Logger: { log: (m) => logs.push(String(m)) },
  console
};
sandbox.globalThis = sandbox;
createContext(sandbox);

for (const f of ['Sheets.gs', 'Code.gs', 'Tests.gs']) {
  runInContext(gs(f), sandbox, { filename: f });
}

let failed = false;
try {
  runInContext('runTests()', sandbox, { filename: 'runTests' });
} catch (e) {
  failed = true;
  console.error('\n' + String(e.message || e));
}

const passes = logs.filter((l) => l.startsWith('pass: '));
passes.forEach((l) => console.log('  ' + l));
console.log('\n' + '='.repeat(64));
if (failed || !logs.includes('ALL TESTS PASSED')) {
  console.log(`FAILED after ${passes.length} passing assertions`);
  process.exit(1);
}
console.log(`ALL TESTS PASSED — ${passes.length} assertions`);
