import test from 'node:test';
import assert from 'node:assert/strict';
import '../js/lib/util.js';

const U = globalThis.STB.util;

test('money formats en-IN', () => {
  assert.equal(U.money(1234567), '₹12,34,567');
  assert.equal(U.fmtAmount(1234567.5), '12,34,567.5');
});

test('fmtDate', () => {
  assert.equal(U.fmtDate('2026-07-17'), '17 Jul 26');
});

test('safeEval', () => {
  assert.equal(U.safeEval('1200+850'), 2050);
  assert.equal(U.safeEval('100*3-50'), 250);
  assert.equal(U.safeEval('100+'), 100);        // trailing op ignored
  assert.ok(Number.isNaN(U.safeEval('alert(1)')));
  assert.ok(Number.isNaN(U.safeEval('')));
});

test('todayStr is the local calendar date', () => {
  assert.equal(U.todayStr(), new Date().toLocaleDateString('en-CA'));
});

test('paise that round to 100 carry into rupees', () => {
  assert.equal(U.amountInWords(4.999), 'Five');
});

test('amountInWords Indian grouping', () => {
  assert.equal(U.amountInWords(0), 'Zero');
  assert.equal(U.amountInWords(5), 'Five');
  assert.equal(U.amountInWords(45), 'Forty Five');
  assert.equal(U.amountInWords(12500), 'Twelve Thousand Five Hundred');
  assert.equal(U.amountInWords(123456), 'One Lakh Twenty Three Thousand Four Hundred Fifty Six');
  assert.equal(U.amountInWords(30000007), 'Three Crore Seven');
  assert.equal(U.amountInWords(1250.5), 'One Thousand Two Hundred Fifty and Fifty Paise');
});
