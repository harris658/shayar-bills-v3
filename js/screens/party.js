(function () {
  'use strict';
  globalThis.STB = globalThis.STB || {};
  STB.screens = STB.screens || {};

  STB.screens.parties = {
    render(root) {
      const U = STB.util;
      const pend = new Map(STB.ledger.outstandingByParty(STB.store.bills)
        .map((o) => [o.party_id, o]));
      const rows = STB.store.parties.map((p) => {
        const count = STB.store.bills.filter((b) => b.party_id === p.id).length;
        const o = pend.get(p.id);
        return `<tr>
          <td><a href="#/party/${p.id}">${U.escapeHTML(p.name)}</a></td>
          <td class="hint">${count} bill${count === 1 ? '' : 's'}</td>
          <td class="num text-neg">${o && o.toPay ? U.money(o.toPay) : ''}</td>
          <td class="num text-pos">${o && o.toReceive ? U.money(o.toReceive) : ''}</td>
        </tr>`;
      }).join('');
      root.innerHTML = `
        <div class="card">
          <h2 style="margin-top:0">Parties</h2>
          <div class="tbl-wrap">
            <table class="tbl"><thead><tr><th>Party</th><th></th>
              <th class="num">To pay</th><th class="num">To receive</th></tr></thead>
              <tbody>${rows || '<tr><td class="hint">No parties yet — add one from New Bill.</td></tr>'}</tbody></table>
          </div>
        </div>`;
    }
  };

  STB.screens.party = {
    render(root, partyId) {
      const U = STB.util;
      const p = STB.partyById(partyId);
      if (!p) { root.innerHTML = '<div class="card">Party not found.</div>'; return; }
      const bills = STB.store.bills.filter((b) => b.party_id === partyId);
      const rows = STB.ledger.buildLedger(bills);
      const t = STB.ledger.totals(bills, null);

      const body = rows.map(({ bill: b, delta, running }) => `
        <tr>
          <td>${U.fmtDate(b.bill_date)}</td>
          <td>${U.escapeHTML(b.note || '')}</td>
          <td><span class="badge ${b.status}">${b.status}</span>
              <span class="hint">${U.escapeHTML(b.payment_ref || '')}</span></td>
          <td class="num ${delta > 0 ? 'text-pos' : 'text-neg'}">
            ${delta > 0 ? '+' : '−'}${U.money(Math.abs(delta))}</td>
          <td class="num">${running < 0 ? '−' : ''}${U.money(Math.abs(running))}</td>
        </tr>`).join('');

      root.innerHTML = `
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
            <h2 style="margin:0">${U.escapeHTML(p.name)}</h2>
            <div style="display:flex;gap:8px">
              <span class="badge pending">To pay ${U.money(t.toPay)}</span>
              <span class="badge paid">To receive ${U.money(t.toReceive)}</span>
              <button class="btn secondary" id="print-stmt">Print statement</button>
            </div>
          </div>
          <div class="tbl-wrap">
            <table class="tbl" style="margin-top:14px">
              <thead><tr><th>Date</th><th>Note</th><th>Status / Ref</th>
                <th class="num">Amount</th><th class="num">Balance</th></tr></thead>
              <tbody>${body || '<tr><td colspan="5" class="hint">No bills for this party.</td></tr>'}</tbody>
            </table>
          </div>
        </div>`;

      root.querySelector('#print-stmt').addEventListener('click', () => {
        STB.printParty = partyId;
        STB.nav('#/print/statement');
      });
    }
  };
})();
