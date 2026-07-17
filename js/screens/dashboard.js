(function () {
  'use strict';
  globalThis.STB = globalThis.STB || {};
  STB.screens = STB.screens || {};

  STB.screens.dashboard = {
    render(root) {
      const U = STB.util;
      const bills = STB.store.bills;
      const month = U.todayStr().slice(0, 7);
      const t = STB.ledger.totals(bills, month);
      const out = STB.ledger.outstandingByParty(bills);
      const recent = bills.slice(0, 8);

      const outRows = out.map((o) => {
        const p = STB.partyById(o.party_id);
        return `<tr>
          <td><a href="#/party/${o.party_id}">${U.escapeHTML(p ? p.name : '?')}</a></td>
          <td class="num text-neg">${o.toPay ? U.money(o.toPay) : ''}</td>
          <td class="num text-pos">${o.toReceive ? U.money(o.toReceive) : ''}</td>
        </tr>`;
      }).join('');

      const recentRows = recent.map((b) => {
        const p = STB.partyById(b.party_id);
        const sign = b.type === 'received' ? '+' : '−';
        const cls = b.type === 'received' ? 'text-pos' : 'text-neg';
        return `<tr>
          <td>${U.fmtDate(b.bill_date)}</td>
          <td><a href="#/party/${b.party_id}">${U.escapeHTML(p ? p.name : '?')}</a></td>
          <td><span class="badge ${b.status}">${b.status}</span></td>
          <td class="num ${cls}">${sign}${U.money(b.amount)}</td>
        </tr>`;
      }).join('');

      root.innerHTML = `
        <div class="stat-row">
          <div class="card stat"><div class="hint">To pay (pending)</div>
            <div class="stat-num text-neg">${U.money(t.toPay)}</div></div>
          <div class="card stat"><div class="hint">To receive (pending)</div>
            <div class="stat-num text-pos">${U.money(t.toReceive)}</div></div>
          <div class="card stat"><div class="hint">Paid this month</div>
            <div class="stat-num">${U.money(t.monthPaid)}</div></div>
          <div class="card stat"><div class="hint">Received this month</div>
            <div class="stat-num">${U.money(t.monthReceived)}</div></div>
        </div>
        <div class="dash-cols">
          <div class="card">
            <h3 style="margin-top:0">Outstanding by party</h3>
            <div class="tbl-wrap">
              <table class="tbl"><thead><tr><th>Party</th><th class="num">To pay</th>
                <th class="num">To receive</th></tr></thead>
                <tbody>${outRows || '<tr><td colspan="3" class="hint">Nothing pending 🎉</td></tr>'}</tbody></table>
            </div>
          </div>
          <div class="card">
            <h3 style="margin-top:0">Recent bills</h3>
            <div class="tbl-wrap">
              <table class="tbl"><tbody>${recentRows || '<tr><td class="hint">No bills yet.</td></tr>'}</tbody></table>
            </div>
          </div>
        </div>`;
    }
  };
})();
