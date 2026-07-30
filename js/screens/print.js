(function () {
  'use strict';
  globalThis.STB = globalThis.STB || {};
  STB.screens = STB.screens || {};

  /**
   * The voucher reproduces Shayar Tex's own pre-printed debit voucher pad —
   * heading, address block, labels, dotted rules and the Rs./P. column — so it
   * prints onto blank paper and reads as the same document the shop has always
   * used. Two fit an A4 portrait sheet; see the .dv rules in css/app.css.
   *
   * Deliberately always "DEBIT VOUCHER", including for a received bill: the
   * pad has one form, and Harshit only ever hands out the debit side.
   */

  // The form has three item lines between "Being the" and TOTAL.
  const ITEM_LINES = 3;

  /** Splits an amount into whole rupees and two-digit paise for the Rs./P. column. */
  function rsP(n) {
    // Via integer paise — 0.1 + 0.2 arithmetic on rupees would put 71 in the
    // paise column often enough to matter on a document people sign.
    const paise = Math.round(Number(n) * 100);
    return {
      rs: STB.util.fmtAmount(Math.floor(paise / 100)),
      p: String(paise % 100).padStart(2, '0')
    };
  }

  /**
   * Turns "1200+850" into one Rs./P. line per term, which is exactly what the
   * pad's item column is for. Anything else — a bare number, or an expression
   * using − × ÷, or more terms than the form has lines — yields no items and
   * only the TOTAL row is filled, matching how the pad is written by hand.
   */
  function itemAmounts(expr) {
    const raw = String(expr || '').replace(/\s+/g, '');
    if (!/^\d+(\.\d+)?(\+\d+(\.\d+)?)+$/.test(raw)) return [];
    const terms = raw.split('+');
    return terms.length <= ITEM_LINES ? terms.map(Number) : [];
  }

  function voucherHTML(b) {
    const U = STB.util;
    const p = STB.partyById(b.party_id);
    const total = rsP(b.amount);
    const items = itemAmounts(b.amount_expr);

    // Row 1 carries the "Being the" narration and the Rs./P. column headings,
    // as on the pad. Rows 2..n are the continuation rules and the item amounts.
    const itemRows = [];
    for (let i = 0; i < ITEM_LINES; i++) {
      const a = items[i] === undefined ? null : rsP(items[i]);
      itemRows.push(`
            <tr>
              <td class="dv-narr"><span class="dv-dots"></span></td>
              <td class="dv-rs">${a ? a.rs : ''}</td>
              <td class="dv-p">${a ? a.p : ''}</td>
            </tr>`);
    }

    return `
      <div class="dv">
        <div class="dv-head">
          <div class="dv-kind">DEBIT VOUCHER</div>
          <div class="dv-brand">SHAYAR TEX</div>
          <div class="dv-sub">ZOIS</div>
          <div class="dv-addr">17/1D, Alipore Road,<br>Nandan Market, 1st Floor,<br>
            Kolkata - 27, Phone : (033) 4006 5237</div>
        </div>

        <div class="dv-fields">
          <div class="dv-line">
            <span class="dv-lbl">Rs.</span>
            <!-- Always two decimals here, unlike U.money elsewhere in the app:
                 this is the formal amount field on a signed voucher, and
                 "2,050.5" invites a disputed reading of the paise. -->
            <span class="dv-val dv-val-rs">${total.rs}.${total.p}</span>
            <span class="dv-lbl dv-lbl-date">Date</span>
            <span class="dv-val dv-val-date">${U.fmtDate(b.bill_date)}</span>
          </div>
          <div class="dv-line">
            <span class="dv-lbl">DEBIT</span>
            <span class="dv-val">${U.escapeHTML(p ? p.name : '?')}</span>
          </div>
          <div class="dv-line">
            <span class="dv-lbl">Pay to</span>
            <span class="dv-val"></span>
            <span class="dv-tail">A/c.</span>
          </div>
          <div class="dv-line">
            <span class="dv-lbl">the sum of Rupees</span>
            <!-- dv-val-wrap, because this is the legally operative amount: it
                 must wrap onto a second line rather than be cut off with an
                 ellipsis the way the other fields are. A crore-scale figure
                 does not fit one line. -->
            <span class="dv-val dv-val-wrap">${U.escapeHTML(U.amountInWords(Number(b.amount)))} Only</span>
          </div>
          <div class="dv-line">
            <span class="dv-lbl dv-lbl-by">by</span>
            <span class="dv-stack"><em>Cheque No.</em><em>Cash</em></span>
            <span class="dv-val">${U.escapeHTML(b.payment_ref || '')}</span>
            <span class="dv-lbl dv-lbl-on">on</span>
            <span class="dv-val dv-val-on">${b.payment_date ? U.fmtDate(b.payment_date) : ''}</span>
          </div>
        </div>

        <table class="dv-items">
          <tbody>
            <tr>
              <td class="dv-narr">
                <span class="dv-being">Being the</span>
                <span class="dv-narr-txt">${U.escapeHTML(b.note || '')}</span>
              </td>
              <th class="dv-rs">Rs.</th>
              <th class="dv-p">P.</th>
            </tr>${itemRows.join('')}
            <tr class="dv-total">
              <td class="dv-narr"><span class="dv-total-lbl">TOTAL</span></td>
              <td class="dv-rs">${total.rs}</td>
              <td class="dv-p">${total.p}</td>
            </tr>
          </tbody>
        </table>

        <div class="dv-sign">
          <span>Manager</span><span>Accountant</span><span>Receiver's Signature</span>
        </div>
      </div>`;
  }

  STB.screens.print = {
    render(root, mode) {
      const U = STB.util;
      let inner = '', title = '';

      if (mode === 'statement' && STB.printParty) {
        const p = STB.partyById(STB.printParty);
        const bills = STB.store.bills.filter((b) => b.party_id === STB.printParty);
        const rows = STB.ledger.buildLedger(bills);
        title = 'Statement — ' + U.escapeHTML(p ? p.name : '');
        inner = `
          <div class="stmt">
            <div class="v-head"><b>SHAYAR TEX</b><span>Party Statement</span></div>
            <h3>${U.escapeHTML(p ? p.name : '?')} — as of ${U.fmtDate(U.todayStr())}</h3>
            <div class="tbl-wrap">
              <table class="tbl">
                <thead><tr><th>Date</th><th>Note</th><th>Ref</th>
                  <th class="num">Amount</th><th class="num">Balance</th></tr></thead>
                <tbody>${rows.map(({ bill: b, delta, running }) => `
                  <tr><td>${U.fmtDate(b.bill_date)}</td><td>${U.escapeHTML(b.note || '')}</td>
                    <td>${U.escapeHTML(b.payment_ref || '')}</td>
                    <td class="num">${delta > 0 ? '+' : '−'}${U.money(Math.abs(delta))}</td>
                    <td class="num">${running < 0 ? '−' : ''}${U.money(Math.abs(running))}</td></tr>`).join('')}
                </tbody></table>
            </div>
          </div>`;
      } else {
        const ids = STB.printSelection || [];
        const bills = STB.store.bills.filter((b) => ids.includes(b.id));
        title = `${bills.length} voucher(s)`;
        // Joined with nothing between them on purpose: the print rules pair
        // vouchers onto a sheet with .dv:nth-of-type(2n), and nth-of-type counts
        // elements by tag, not by class — any separator div interleaved here
        // would shift every .dv to an odd position and the page breaks would
        // silently never fire.
        inner = bills.map(voucherHTML).join('');
        if (!bills.length) inner = '<p class="hint">Nothing selected — go to Bills, tick rows, then Print vouchers.</p>';
      }

      root.innerHTML = `
        <div class="no-print" style="display:flex;gap:10px;margin-bottom:14px">
          <button class="btn" id="do-print">Print — ${title}</button>
          <button class="btn ghost" onclick="history.back()">Back</button>
        </div>
        <div class="print-area">${inner}</div>`;
      root.querySelector('#do-print').addEventListener('click', () => window.print());
    }
  };
})();
