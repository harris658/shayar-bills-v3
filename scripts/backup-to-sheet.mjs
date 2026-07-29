#!/usr/bin/env node
/**
 * One-time migration: the app's JSON backup → three CSVs matching the Sheet tabs.
 *
 * Preserves every UUID, so party_id and matched_bill_id still resolve after
 * the import. This is deliberately NOT the app's "import v2 backup" button,
 * which matches parties by name, discards ids, and forces status to 'paid'.
 *
 * Usage: node scripts/backup-to-sheet.mjs <backup.json> [outDir]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const HEADERS = {
  parties: ['id', 'name', 'phone', 'notes', 'created_at'],
  bills: ['id', 'party_id', 'type', 'amount', 'bill_date', 'note', 'amount_expr',
    'status', 'payment_ref', 'payment_date', 'created_by', 'created_at'],
  bank_txns: ['id', 'txn_date', 'amount', 'ref', 'description', 'matched_bill_id',
    'imported_at']
};

function cell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCsv(headers, rows) {
  return [headers.join(',')]
    .concat(rows.map((r) => headers.map((h) => cell(r[h])).join(',')))
    .join('\n');
}

// Matches js/lib/util.js's money()/fmtAmount() exactly, so the printed figure
// is a literal string match against the Dashboard tile, not a raw JS number.
function fmtINR(n) {
  return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

// Flags cells that a spreadsheet may parse as a formula on import (leading
// =, +, - or @). Reported, never rewritten — altering the data silently
// would be worse than leaving a warning for a manual check.
function findFormulaRisk(tab, headers, rows) {
  const risky = [];
  rows.forEach((r, i) => {
    for (const h of headers) {
      const v = r[h];
      if (v === null || v === undefined) continue;
      const s = String(v);
      if (/^[=+\-@]/.test(s)) risky.push({ tab, id: r.id, index: i, field: h, value: s });
    }
  });
  return risky;
}

const [, , inPath, outDir = 'migration-out'] = process.argv;
if (!inPath) {
  console.error('usage: node scripts/backup-to-sheet.mjs <backup.json> [outDir]');
  process.exit(1);
}

let raw;
try {
  raw = readFileSync(inPath, 'utf8');
} catch (err) {
  console.error(`could not read ${inPath}: ${err.message}`);
  process.exit(1);
}

let data;
try {
  data = JSON.parse(raw);
} catch (err) {
  console.error(`${inPath} is not valid JSON: ${err.message}`);
  process.exit(1);
}

if (!data || typeof data !== 'object') {
  console.error(`${inPath} does not contain a backup object`);
  process.exit(1);
}

for (const tab of Object.keys(HEADERS)) {
  if (tab in data && !Array.isArray(data[tab])) {
    console.error(`${inPath}: "${tab}" is present but is not an array — refusing to guess`);
    process.exit(1);
  }
}

// Every row must itself be an object — a null/array/primitive entry means the
// backup is corrupt, and we'd rather name the offending index than crash
// deep inside a .map() after some files are already on disk.
for (const tab of Object.keys(HEADERS)) {
  const rows = data[tab] || [];
  rows.forEach((row, i) => {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      console.error(`${inPath}: "${tab}[${i}]" is not an object — refusing to write any output`);
      process.exit(1);
    }
  });
}

// This is the only gate before an unrepeatable import: refuse to produce
// output the app cannot render back correctly. js/lib/ledger.js computes
// monthPaid/monthReceived from every bill regardless of status, and
// statement.js/matching.js do arithmetic on every bank txn — so a
// non-numeric amount anywhere in either array, not just on pending bills,
// would render as ₹NaN on a Dashboard tile after import. `Number(null)` is
// `0` (same coercion ledger.js uses) and must keep passing, as must a
// legitimately negative amount or a zero amount.
const badBillAmounts = [];
for (const b of data.bills || []) {
  if (!Number.isFinite(Number(b.amount))) badBillAmounts.push(b.id);
}
const badTxnAmounts = [];
for (const t of data.bank_txns || []) {
  if (!Number.isFinite(Number(t.amount))) badTxnAmounts.push(t.id);
}
if (badBillAmounts.length || badTxnAmounts.length) {
  console.error(`\nrefusing to write output — non-numeric amount(s) found:`);
  if (badBillAmounts.length) console.error(`  bills: ${badBillAmounts.join(', ')}`);
  if (badTxnAmounts.length) console.error(`  bank_txns: ${badTxnAmounts.join(', ')}`);
  process.exit(1);
}

let toPay = 0;
let toReceive = 0;
for (const b of data.bills || []) {
  if (b.status !== 'pending') continue;
  const amt = Number(b.amount);
  if (b.type === 'paid') toPay += amt; else toReceive += amt;
}

mkdirSync(outDir, { recursive: true });

const riskyCells = [];
for (const [tab, headers] of Object.entries(HEADERS)) {
  const rows = data[tab] || [];
  writeFileSync(join(outDir, tab + '.csv'), toCsv(headers, rows) + '\n');
  console.log(`${tab}: ${rows.length} rows → ${join(outDir, tab + '.csv')}`);
  riskyCells.push(...findFormulaRisk(tab, headers, rows));
}

console.log(`\nVerification figures — these must match the new app after import:`);
console.log(`  parties:               ${(data.parties || []).length}`);
console.log(`  bills:                 ${(data.bills || []).length}  (matches the "Delete ALL N bill(s)" count on More)`);
console.log(`  bank_txns:             ${(data.bank_txns || []).length}  (informational — no screen shows this count)`);
console.log(`  To pay (pending):      ${fmtINR(toPay)}`);
console.log(`  To receive (pending):  ${fmtINR(toReceive)}`);

if (riskyCells.length) {
  console.log(`\nCheck these cells after import — a spreadsheet may read a leading =, +, - or @ as a formula:`);
  for (const r of riskyCells) {
    const label = r.id !== undefined && r.id !== null ? `id ${r.id}` : `row ${r.index} (no id)`;
    console.log(`  ${r.tab}.csv, ${label}, ${r.field}: ${r.value}`);
  }
}
