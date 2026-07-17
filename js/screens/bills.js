(function () {
  'use strict';
  globalThis.STB = globalThis.STB || {};
  STB.screens = STB.screens || {};

  // Screen-local UI state survives re-renders within the session.
  const ui = { status: 'all', type: 'all', party: 'all', q: '', from: '', to: '' };

  STB.screens.bills = {
    render(root) {
      const U = STB.util;
      const bills = STB.store.bills.filter((b) => {
        if (ui.status !== 'all' && b.status !== ui.status) return false;
        if (ui.type !== 'all' && b.type !== ui.type) return false;
        if (ui.party !== 'all' && b.party_id !== ui.party) return false;
        if (ui.from && b.bill_date < ui.from) return false;
        if (ui.to && b.bill_date > ui.to) return false;
        if (ui.q) {
          const p = STB.partyById(b.party_id);
          const hay = ((p ? p.name : '') + ' ' + (b.note || '') + ' ' + (b.payment_ref || '')).toLowerCase();
          if (!hay.includes(ui.q.toLowerCase())) return false;
        }
        return true;
      });

      const partyOpts = ['<option value="all">All parties</option>']
        .concat(STB.store.parties.map((p) =>
          `<option value="${p.id}"${ui.party === p.id ? ' selected' : ''}>${U.escapeHTML(p.name)}</option>`))
        .join('');

      const rows = bills.map((b) => {
        const p = STB.partyById(b.party_id);
        const sign = b.type === 'received' ? '+' : '−';
        const cls = b.type === 'received' ? 'text-pos' : 'text-neg';
        return `
        <tr data-id="${b.id}">
          <td><input type="checkbox" class="sel" data-id="${b.id}"></td>
          <td>${U.fmtDate(b.bill_date)}</td>
          <td><a href="#/party/${b.party_id}">${U.escapeHTML(p ? p.name : '?')}</a></td>
          <td>${U.escapeHTML(b.note || '')}</td>
          <td class="num ${cls}">${sign}${U.money(b.amount)}</td>
          <td>${b.status === 'paid'
            ? `<span class="badge paid">Paid</span> <span class="hint">${U.escapeHTML(b.payment_ref || '')}</span>`
            : `<span class="badge pending">Pending</span>
               <button class="btn ghost mark-paid" data-id="${b.id}">Mark paid</button>`}</td>
          <td><button class="btn ghost del" data-id="${b.id}" title="Delete">✕</button></td>
        </tr>`;
      }).join('');

      root.innerHTML = `
        <div class="card">
          <div class="filters">
            <input id="q" placeholder="Search party / note / ref" value="${U.escapeHTML(ui.q)}" style="max-width:220px">
            <select id="f-status">
              <option value="all"${ui.status === 'all' ? ' selected' : ''}>All statuses</option>
              <option value="pending"${ui.status === 'pending' ? ' selected' : ''}>Pending</option>
              <option value="paid"${ui.status === 'paid' ? ' selected' : ''}>Paid</option>
            </select>
            <select id="f-type">
              <option value="all"${ui.type === 'all' ? ' selected' : ''}>Paid + Received</option>
              <option value="paid"${ui.type === 'paid' ? ' selected' : ''}>Paid only</option>
              <option value="received"${ui.type === 'received' ? ' selected' : ''}>Received only</option>
            </select>
            <select id="f-party">${partyOpts}</select>
            <input id="f-from" type="date" value="${ui.from}">
            <input id="f-to" type="date" value="${ui.to}">
            <button class="btn secondary" id="print-sel">Print vouchers</button>
          </div>
          <table class="tbl">
            <thead><tr><th></th><th>Date</th><th>Party</th><th>Note</th>
              <th class="num">Amount</th><th>Status</th><th></th></tr></thead>
            <tbody>${rows || '<tr><td colspan="7" class="hint">No bills match.</td></tr>'}</tbody>
          </table>
        </div>`;

      const rerender = () => this.render(root);
      const bind = (id, key) => root.querySelector(id).addEventListener('change', (e) => {
        ui[key] = e.target.value; rerender();
      });
      bind('#f-status', 'status'); bind('#f-type', 'type'); bind('#f-party', 'party');
      bind('#f-from', 'from'); bind('#f-to', 'to');
      root.querySelector('#q').addEventListener('input', (e) => {
        ui.q = e.target.value; rerender();
        const q = root.querySelector('#q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length);
      });

      root.querySelectorAll('.mark-paid').forEach((btn) => btn.addEventListener('click', async () => {
        const ref = prompt('Bank ref number (leave empty for cash/none):');
        if (ref === null) return;
        try {
          await STB.db.markPaid(btn.dataset.id, {
            payment_ref: ref.trim(), payment_date: STB.util.todayStr()
          });
          STB.toast('Marked paid ✓');
          STB.refresh();
        } catch (e) {
          console.error('markPaid failed', e);
          STB.toast('Could not mark paid — check connection');
        }
      }));

      root.querySelectorAll('.del').forEach((btn) => btn.addEventListener('click', async () => {
        const b = STB.store.bills.find((x) => x.id === btn.dataset.id);
        const p = b && STB.partyById(b.party_id);
        if (!confirm(`Delete bill — ${p ? p.name : '?'}, ${STB.util.money(b.amount)}?`)) return;
        try {
          await STB.db.deleteBill(btn.dataset.id);
          STB.toast('Bill deleted');
          STB.refresh();
        } catch (e) {
          console.error('deleteBill failed', e);
          STB.toast('Could not delete — check connection');
        }
      }));

      root.querySelector('#print-sel').addEventListener('click', () => {
        const ids = Array.from(root.querySelectorAll('.sel:checked')).map((c) => c.dataset.id);
        if (!ids.length) { STB.toast('Tick some bills first'); return; }
        STB.printSelection = ids;
        STB.nav('#/print/vouchers');
      });
    }
  };
})();
