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

mkdirSync(outDir, { recursive: true });

for (const [tab, headers] of Object.entries(HEADERS)) {
  const rows = data[tab] || [];
  writeFileSync(join(outDir, tab + '.csv'), toCsv(headers, rows) + '\n');
  console.log(`${tab}: ${rows.length} rows → ${join(outDir, tab + '.csv')}`);
}

const pending = (data.bills || [])
  .filter((b) => b.status === 'pending')
  .reduce((sum, b) => sum + Number(b.amount), 0);
console.log(`\nVerification figures — these must match the new app after import:`);
console.log(`  parties:        ${(data.parties || []).length}`);
console.log(`  bills:          ${(data.bills || []).length}`);
console.log(`  bank_txns:      ${(data.bank_txns || []).length}`);
console.log(`  pending total:  ${pending}`);
