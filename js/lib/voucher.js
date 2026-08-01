(function () {
  'use strict';
  globalThis.STB = globalThis.STB || {};

  /**
   * Derives a debit voucher's total, narration and printed breakdown from the
   * invoices it settles.
   *
   * These three functions are a mirror of createVoucherFromInvoices_ in
   * apps-script/Code.gs, and the duplication is deliberate: the server is the
   * authority and recomputes all of it from the invoice rows it reads under the
   * lock, so a stale tab cannot voucher a selection for the wrong figure. This
   * copy exists only to show Hussain what he is about to create before he
   * commits to it. If the two ever disagree, the server is right — but they
   * must not disagree, so any change here needs the same change there.
   */

  /** Integer paise — 0.1 + 0.2 on rupees puts 71 in a voucher's paise column. */
  function toPaise(v) {
    return Math.round(Number(v) * 100);
  }

  function voucherTotal(invoices) {
    let paise = 0;
    for (const inv of invoices) paise += toPaise(inv.amount);
    return paise / 100;
  }

  const NARRATION_PREFIX = 'INVOICE NO.- ';

  function buildVoucherNote(invoices) {
    return NARRATION_PREFIX +
      invoices.map((inv) => String(inv.invoice_no || '').trim()).join(', ');
  }

  /**
   * The Rs./P. item lines on the printed pad, as an expression print.js can
   * parse. Empty for a single invoice: print.js itemises only a '+' chain, and
   * a lone amount belongs on the TOTAL row alone — which is also what the
   * manual entry form stores for a bare number.
   *
   * Above three invoices this still returns the full chain even though print.js
   * will decline to itemise it (its form has three lines) and print the TOTAL
   * alone. That is the intended output for a long voucher, and keeping the
   * whole expression means the breakdown survives in the data even when the
   * paper cannot show it.
   */
  function buildVoucherExpr(invoices) {
    if (invoices.length < 2) return '';
    return invoices.map((inv) => String(Number(inv.amount))).join('+');
  }

  STB.voucher = { voucherTotal, buildVoucherNote, buildVoucherExpr };
})();
