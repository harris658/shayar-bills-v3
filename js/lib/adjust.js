(function () {
  'use strict';
  globalThis.STB = globalThis.STB || {};

  const round2 = (n) => Math.round(n * 100) / 100;

  /**
   * A bill counts as adjusted only when the server stamped it.
   *
   * Deliberately NOT derived from a minus in amount_expr: a bill first entered
   * as "1200-50" is a breakdown someone typed, not a later edit, and flagging
   * it would train everyone to ignore the badge.
   */
  function isAdjusted(b) {
    return !!(b && String(b.adjusted_at || '').trim());
  }

  /** One line per adjustment, "YYYY-MM-DD: text", oldest first. */
  function parseReasons(text) {
    return String(text == null ? '' : text)
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .map((l) => {
        const m = /^(\d{4}-\d{2}-\d{2})\s*:\s*([\s\S]*)$/.exec(l);
        return m ? { date: m[1], text: m[2].trim() } : { date: '', text: l };
      });
  }

  /**
   * Appends a reason without disturbing the ones already there — the log is
   * what makes a third adjustment legible after the first two are forgotten.
   * A blank reason is allowed and simply adds no line, so the reason field can
   * never block a quick edit.
   */
  function appendReason(existing, dateStr, text) {
    const t = String(text == null ? '' : text).trim();
    const prev = String(existing == null ? '' : existing);
    if (!t) return prev;
    const line = dateStr + ': ' + t;
    return prev ? prev + '\n' + line : line;
  }

  function summary(b) {
    if (!isAdjusted(b)) return null;
    const current = Number(b.amount) || 0;
    // A bill adjusted before original_amount existed, or one whose cell was
    // cleared by hand, reports no movement rather than a nonsense delta.
    const rawOriginal = Number(b.original_amount);
    const original = Number.isFinite(rawOriginal) && String(b.original_amount).trim() !== ''
      ? rawOriginal
      : current;
    return {
      original: original,
      current: current,
      delta: round2(current - original),
      expr: String(b.amount_expr || ''),
      at: String(b.adjusted_at || ''),
      by: String(b.adjusted_by || ''),
      reasons: parseReasons(b.adjustment_reason)
    };
  }

  function badgeHTML(b) {
    if (!isAdjusted(b)) return '';
    return '<button type="button" class="badge adjusted adj-toggle" data-id="' +
      STB.util.escapeHTML(String(b.id)) +
      '" title="Show what changed">adjusted</button>';
  }

  /**
   * The row that opens under an adjusted bill. Rendered hidden and revealed by
   * wireToggles, so a screen only has to concatenate it after its own <tr>.
   */
  function detailRowHTML(b, colspan, invoices) {
    const s = summary(b);
    if (!s) return '';
    const U = STB.util;
    const sign = s.delta < 0 ? '−' : '+';
    const cls = s.delta < 0 ? 'text-neg' : 'text-pos';

    const reasons = s.reasons.length
      ? '<ul class="adj-reasons">' + s.reasons.map((r) =>
        '<li>' + (r.date ? '<span class="hint">' + U.escapeHTML(r.date) + '</span> ' : '') +
        U.escapeHTML(r.text) + '</li>').join('') + '</ul>'
      : '<p class="hint">No reason recorded.</p>';

    const invList = (invoices && invoices.length)
      ? '<div class="adj-invoices"><div class="hint">Invoices on this voucher</div><ul>' +
        invoices.map((i) => '<li>' + U.escapeHTML(String(i.invoice_no || '')) +
          ' <span class="hint">' + U.money(i.amount) + '</span></li>').join('') +
        '</ul></div>'
      : '';

    return '<tr class="adj-detail" data-for="' + U.escapeHTML(String(b.id)) + '" hidden>' +
      '<td colspan="' + colspan + '">' +
        '<div class="adj-body">' +
          '<div class="adj-figures">' +
            '<span>' + U.money(s.original) + '</span>' +
            '<span class="hint">→</span>' +
            '<span>' + U.money(s.current) + '</span>' +
            '<strong class="' + cls + '">' + sign + U.money(Math.abs(s.delta)) + '</strong>' +
          '</div>' +
          (s.expr ? '<div class="hint adj-expr">' + U.escapeHTML(s.expr) + '</div>' : '') +
          '<div class="hint">Last adjusted ' + U.escapeHTML(String(s.at).slice(0, 10)) +
            (s.by ? ' by ' + U.escapeHTML(s.by) : '') + '</div>' +
          reasons + invList +
        '</div>' +
      '</td></tr>';
  }

  /** Every screen wires its badges the same way; do it once. */
  function wireToggles(root) {
    root.querySelectorAll('.adj-toggle').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const row = root.querySelector('.adj-detail[data-for="' + btn.dataset.id + '"]');
        if (row) row.hidden = !row.hidden;
      });
    });
  }

  STB.adjust = {
    isAdjusted, parseReasons, appendReason, summary,
    badgeHTML, detailRowHTML, wireToggles
  };
})();
