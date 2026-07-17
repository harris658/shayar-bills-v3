(function () {
  'use strict';
  globalThis.STB = globalThis.STB || {};

  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
      '-' + String(d.getDate()).padStart(2, '0');
  }

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function fmtDate(iso) {
    const [y, m, d] = String(iso).split('-');
    const mi = parseInt(m, 10) - 1;
    if (!y || !MONTHS[mi]) return String(iso);
    return `${parseInt(d, 10)} ${MONTHS[mi]} ${y.slice(2)}`;
  }

  function fmtAmount(n) {
    return Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }
  function money(n) { return '₹' + fmtAmount(n); }

  function escapeHTML(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function safeEval(str) {
    if (!str) return NaN;
    if (!/^[0-9+\-*/.]+$/.test(str)) return NaN;
    if (/[+\-*/.]$/.test(str)) str = str.slice(0, -1);
    if (!str) return NaN;
    try {
      const v = Function('"use strict";return (' + str + ')')();
      return typeof v === 'number' && isFinite(v) ? v : NaN;
    } catch (e) { return NaN; }
  }

  const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight',
    'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen'];
  const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy',
    'Eighty', 'Ninety'];
  function two(n) {
    return n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
  }
  function three(n) {
    const h = Math.floor(n / 100), r = n % 100;
    return (h ? ONES[h] + ' Hundred' + (r ? ' ' : '') : '') + (r ? two(r) : '');
  }
  function amountInWords(amount) {
    let rupees = Math.floor(amount);
    let paise = Math.round((amount - rupees) * 100);
    if (paise === 100) { rupees += 1; paise = 0; }
    const parts = [];
    const crore = Math.floor(rupees / 1e7); rupees %= 1e7;
    const lakh = Math.floor(rupees / 1e5); rupees %= 1e5;
    const thousand = Math.floor(rupees / 1e3); rupees %= 1e3;
    if (crore) parts.push(three(crore) + ' Crore');
    if (lakh) parts.push(two(lakh) + ' Lakh');
    if (thousand) parts.push(two(thousand) + ' Thousand');
    if (rupees) parts.push(three(rupees));
    let words = parts.join(' ');
    if (paise) words += (words ? ' and ' : '') + two(paise) + ' Paise';
    return words || 'Zero';
  }

  STB.util = { todayStr, fmtDate, fmtAmount, money, escapeHTML, safeEval, amountInWords };
})();
