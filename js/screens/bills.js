(function () {
  'use strict';
  globalThis.STB = globalThis.STB || {};
  STB.screens = STB.screens || {};

  // Screen-local UI state survives re-renders within the session.
  const ui = { status: 'all', type: 'all', party: 'all', q: '', from: '', to: '' };
  // Print-selection ticks survive re-renders (focus refresh, filter/search
  // changes) within a visit. Cleared once "Print vouchers" hands off.
  const selected = new Set();

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

      // Ids currently visible under the filters — what "select all" acts on.
      const shownIds = bills.map((b) => b.id);
      const shownSelected = shownIds.filter((id) => selected.has(id)).length;

      const rows = bills.map((b) => {
        const p = STB.partyById(b.party_id);
        const sign = b.type === 'received' ? '+' : '−';
        const cls = b.type === 'received' ? 'text-pos' : 'text-neg';
        return `
        <tr data-id="${b.id}">
          <td class="col-sel"><label class="sel-box">
            <input type="checkbox" class="sel" data-id="${b.id}"${selected.has(b.id) ? ' checked' : ''}>
          </label></td>
          <td>${U.fmtDate(b.bill_date)}</td>
          <td><a href="#/party/${b.party_id}">${U.escapeHTML(p ? p.name : '?')}</a></td>
          <td>${U.escapeHTML(b.note || '')}</td>
          <td class="num ${cls}">${sign}${U.money(b.amount)}</td>
          <td>${b.status === 'paid'
            ? `<span class="badge paid">Paid</span> <span class="hint">${U.escapeHTML(b.payment_ref || '')}</span>`
            : `<span class="badge pending">Pending</span>
               <button class="btn ghost mark-paid" data-id="${b.id}">Mark paid</button>`}</td>
          <td class="row-actions">${b.status === 'paid' ? '' :
            `<button class="btn ghost edit" data-id="${b.id}" title="Edit amount">Edit</button> `
            }<button class="btn ghost del" data-id="${b.id}" title="Delete">✕</button></td>
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
            <button class="btn secondary" id="print-sel">Print vouchers${
              selected.size ? ` (${selected.size})` : ''}</button>
            ${selected.size
              ? `<button class="btn ghost" id="clear-sel">Clear selection</button>`
              : ''}
          </div>
          <div class="tbl-wrap">
            <table class="tbl">
              <thead><tr>
                <th class="col-sel"><label class="sel-box" title="Select all ${shownIds.length} shown">
                  <input type="checkbox" id="sel-all">
                </label></th>
                <th>Date</th><th>Party</th><th>Note</th>
                <th class="num">Amount</th><th>Status</th><th></th></tr></thead>
              <tbody>${rows || `<tr><td colspan="7" class="hint">${
                // "No bills match." is a claim about the filters, made against
                // a loaded store. Before the first snapshot lands, the store
                // is empty for the same reason every row is missing, and
                // saying so would look identical to a genuinely empty ledger
                // (see dashboard.js / party.js for the same distinction).
                STB.store.loaded ? 'No bills match.' : 'Loading…'
              }</td></tr>`}</tbody>
            </table>
          </div>
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

      root.querySelectorAll('.sel').forEach((cb) => cb.addEventListener('change', (e) => {
        if (e.target.checked) selected.add(e.target.dataset.id);
        else selected.delete(e.target.dataset.id);
        // Re-render so the header tick, the count on Print vouchers and the
        // Clear button all follow along.
        rerender();
      }));

      // Select-all covers exactly the rows the filters are showing, never the
      // whole ledger — the point is "everything on this page". Ticks already set
      // on rows the filters hide are left alone, which is why the Print button
      // carries the full count and a Clear selection button appears next to it:
      // otherwise a selection you cannot see would silently print.
      const selAll = root.querySelector('#sel-all');
      selAll.checked = shownIds.length > 0 && shownSelected === shownIds.length;
      selAll.indeterminate = shownSelected > 0 && shownSelected < shownIds.length;
      selAll.disabled = shownIds.length === 0;
      selAll.addEventListener('change', () => {
        if (selAll.checked) shownIds.forEach((id) => selected.add(id));
        else shownIds.forEach((id) => selected.delete(id));
        rerender();
      });

      // Make every pixel of the tick cell count, header included. The label
      // handles clicks that land on it; this covers the dead space around it,
      // which CSS cannot reach inside a table cell (see .col-sel in app.css).
      root.querySelectorAll('.col-sel').forEach((cell) => {
        cell.addEventListener('click', (e) => {
          if (e.target.closest('.sel-box')) return; // label already toggles it
          const cb = cell.querySelector('input[type="checkbox"]');
          if (!cb || cb.disabled) return;
          cb.checked = !cb.checked;
          cb.dispatchEvent(new Event('change', { bubbles: true }));
        });
      });

      const clearSel = root.querySelector('#clear-sel');
      if (clearSel) clearSel.addEventListener('click', () => {
        selected.clear();
        rerender();
      });

      // Both handlers below update the store first and send the request
      // behind it, rolling back on failure. Waiting for Apps Script instead
      // costs ~3.2s (markPaid) or ~2.3s (deleteBill) of dead UI before the row
      // visibly changes, and the local mutation mirrors exactly what the
      // server writes (see markPaid_/deleteBill_ in apps-script/Code.gs), so
      // the follow-up snapshot that used to be required is now redundant.
      root.querySelectorAll('.mark-paid').forEach((btn) => btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        // A provisional row has no Sheet row yet — the server would answer
        // 'bill not found' and the rollback would undo a paid state the user
        // just watched appear.
        if (STB.isPending(id)) { STB.toast('Still saving — try again in a moment'); return; }
        const b = STB.store.bills.find((x) => x.id === id);
        if (!b) { STB.toast('Bill no longer exists'); return; }
        const ref = prompt('Bank ref number (leave empty for cash/none):');
        if (ref === null) return;

        const before = { status: b.status, payment_ref: b.payment_ref, payment_date: b.payment_date };
        const after = { status: 'paid', payment_ref: ref.trim(), payment_date: STB.util.todayStr() };
        Object.assign(b, after);
        STB.toast('Marked paid ✓');
        STB.commitStore();

        STB.db.markPaid(id, after).catch((e) => {
          console.error('markPaid failed', e);
          // Re-find rather than reusing `b`: a background refresh may have
          // replaced the array, leaving `b` an orphan whose mutation nothing
          // would render.
          const cur = STB.store.bills.find((x) => x.id === id);
          if (cur) Object.assign(cur, before);
          STB.toast('Could not mark paid — reverted to pending');
          STB.commitStore();
        });
      }));

      // Amount only. A wrong party or direction means the bill is really a
      // different bill, so that stays delete-and-re-enter; and the Edit button
      // is not rendered at all on a paid row (the server refuses those too).
      root.querySelectorAll('.edit').forEach((btn) => btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        if (STB.isPending(id)) { STB.toast('Still saving — try again in a moment'); return; }
        const b = STB.store.bills.find((x) => x.id === id);
        if (!b) { STB.toast('Bill no longer exists'); return; }
        if (b.status === 'paid') { STB.toast('Already paid — delete and re-enter instead'); return; }

        // Seed with the typed breakdown when there is one, so "1200+850" comes
        // back editable as "1200+850" rather than as 2050.
        const raw = prompt('Amount for ' + (STB.partyById(b.party_id) || {}).name +
          ' — a number, or a sum like 1200+850:', b.amount_expr || String(b.amount));
        if (raw === null) return;
        const typed = raw.trim();
        const v = STB.util.safeEval(typed);
        if (Number.isNaN(v)) { STB.toast('Could not read that amount'); return; }
        const amt = Math.round(v * 100) / 100;
        if (!(amt > 0)) { STB.toast('Amount must be more than 0'); return; }
        // Same rule as the entry form: keep the breakdown only when one was
        // actually typed. Operator anywhere, or a minus past the first char.
        const expr = /[+*/]|(?!^)-/.test(typed) ? typed : '';
        if (amt === Number(b.amount) && expr === (b.amount_expr || '')) return;

        const before = { amount: b.amount, amount_expr: b.amount_expr };
        b.amount = amt;
        b.amount_expr = expr;
        STB.toast('Amount updated ✓');
        STB.commitStore();

        STB.db.updateBillAmount(id, amt, expr).catch((e) => {
          console.error('updateBillAmount failed', e);
          const cur = STB.store.bills.find((x) => x.id === id);
          if (cur) Object.assign(cur, before);
          // Surface the server's reason — "already marked paid" is a real
          // outcome here (someone else settled it from another device), not a
          // connection problem, and "check connection" would send Harshit
          // looking in the wrong place.
          STB.toast('Could not update — ' + (e.message || 'reverted'));
          STB.commitStore();
        });
      }));

      root.querySelectorAll('.del').forEach((btn) => btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        if (STB.isPending(id)) { STB.toast('Still saving — try again in a moment'); return; }
        const i = STB.store.bills.findIndex((x) => x.id === id);
        if (i < 0) { STB.toast('Bill no longer exists'); return; }
        const b = STB.store.bills[i];
        const p = STB.partyById(b.party_id);
        if (!confirm(`Delete bill — ${p ? p.name : '?'}, ${STB.util.money(b.amount)}?`)) return;

        STB.store.bills.splice(i, 1);
        selected.delete(id);
        STB.toast('Bill deleted');
        STB.commitStore();

        STB.db.deleteBill(id).catch((e) => {
          console.error('deleteBill failed', e);
          // Only restore into the array the row was removed from; if a refresh
          // swapped it out, the server's copy is authoritative either way.
          if (!STB.store.bills.some((x) => x.id === id)) {
            STB.store.bills.splice(Math.min(i, STB.store.bills.length), 0, b);
          }
          STB.toast('Could not delete — the bill is still there');
          STB.commitStore();
        });
      }));

      root.querySelector('#print-sel').addEventListener('click', () => {
        // Iterate STB.store.bills (not the Set) so the resulting array keeps
        // the original table/store order — matches the pre-fix .sel:checked
        // behaviour — and naturally drops any ticked id no longer in the store.
        const ids = STB.store.bills.filter((b) => selected.has(b.id)).map((b) => b.id);
        if (!ids.length) { STB.toast('Tick some bills first'); return; }
        STB.printSelection = ids;
        selected.clear();
        STB.nav('#/print/vouchers');
      });
    }
  };
})();
