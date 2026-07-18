(function () {
  'use strict';
  globalThis.STB = globalThis.STB || {};
  STB.screens = STB.screens || {};

  function voucherHTML(b) {
    const U = STB.util;
    const p = STB.partyById(b.party_id);
    return `
      <div class="voucher">
        <div class="v-head"><b>SHAYAR TEX</b>
          <span>${b.type === 'paid' ? 'Debit Voucher' : 'Receipt Voucher'}</span></div>
        <div class="v-grid">
          <span>Date</span><b>${U.fmtDate(b.bill_date)}</b>
          <span>Party</span><b>${U.escapeHTML(p ? p.name : '?')}</b>
          <span>Amount</span><b>${U.money(b.amount)}</b>
          <span>In words</span><b>Rupees ${U.amountInWords(Number(b.amount))} Only</b>
          <span>Ref No.</span><b>${U.escapeHTML(b.payment_ref || '—')}</b>
          <span>Note</span><b>${U.escapeHTML(b.note || '—')}</b>
        </div>
        <div class="v-sign"><span>Prepared by</span><span>Authorised</span><span>Receiver</span></div>
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
