(function () {
  'use strict';
  globalThis.STB = globalThis.STB || {};
  STB.screens = STB.screens || {};

  // Screen-local UI state survives re-renders within the session.
  const ui = { status: 'all', type: 'all', party: 'all', q: '', from: '', to: '' };
  // Print-selection ticks survive re-renders (focus refresh, filter/search
  // changes) within a visit. Cleared once "Print vouchers" hands off.
  const selected = new Set();

  /**
   * The line shown at the top of the modal when this bill has been adjusted
   * before. This is the feature: without it, a second deduction against an
   * already-deducted bill looks exactly like a first one, and the shop
   * underpays a supplier with nothing to catch it.
   */
  function priorWarning(b) {
    const s = STB.adjust.summary(b);
    if (!s) return '';
    const U = STB.util;
    const when = String(s.at).slice(0, 10);
    const move = s.delta === 0 ? '' :
      ' (' + (s.delta < 0 ? '−' : '+') + U.money(Math.abs(s.delta)) + ')';
    const why = s.reasons.length ? ' — ' + s.reasons[s.reasons.length - 1].text : '';
    return 'Already adjusted ' + when + (s.by ? ' by ' + s.by : '') + ': ' +
      U.money(s.original) + ' → ' + U.money(s.current) + move + why;
  }

  /**
   * True for a voucher built from invoices. Blank on every bill entered by hand
   * and on every row that predates the invoice feature, which is exactly the
   * distinction wanted — those keep the plain amount edit.
   */
  function isVoucher(b) {
    return b && b.invoice_total !== undefined &&
      String(b.invoice_total).trim() !== '';
  }

  /**
   * Records what the bank actually debited after Avinash deducted a discount or
   * an adjustment on the printed voucher.
   *
   * Only the amount is asked for. What was deducted is derived from the
   * invoices' own total server-side, so the voucher ends up holding all three
   * figures — billed, deducted, paid — without anyone typing the middle one.
   * The breakdown is deliberately not touched: it describes the invoices
   * underneath, which the deduction did not change.
   */
  function adjustVoucher(b) {
    const U = STB.util;
    const billed = Number(b.invoice_total);
    STB.adjustModal.open({
      title: 'Amount actually paid',
      party: (STB.partyById(b.party_id) || {}).name || '',
      warning: priorWarning(b),
      hint: 'Invoices total ' + U.money(billed) + ' — enter what the bank debited.',
      value: String(b.amount)
    }).then((res) => {
      if (!res) return;
      const v = U.safeEval(res.raw);
      if (Number.isNaN(v)) { STB.toast('Could not read that amount'); return; }
      const amt = Math.round(v * 100) / 100;
      if (!(amt > 0)) { STB.toast('Amount must be more than 0'); return; }

      // Re-find rather than reusing `b`: the modal can sit open indefinitely
      // while typing, and a background refresh may have replaced the array in
      // that window, leaving `b` an orphan whose mutation nothing would render.
      const cur = STB.store.bills.find((x) => x.id === b.id);
      if (!cur) { STB.toast('Bill no longer exists'); return; }
      if (amt === Number(cur.amount) && !res.reason) return;

      const before = {
        amount: cur.amount, adjustment: cur.adjustment,
        original_amount: cur.original_amount, adjusted_at: cur.adjusted_at,
        adjusted_by: cur.adjusted_by, adjustment_reason: cur.adjustment_reason
      };
      cur.amount = amt;
      cur.adjustment = Math.round((billed - amt) * 100) / 100;
      STB.toast(cur.adjustment > 0
        ? 'Paid ' + U.money(amt) + ' — ' + U.money(cur.adjustment) + ' deducted ✓'
        : 'Amount updated ✓');
      STB.commitStore();

      STB.db.adjustVoucherAmount(cur.id, amt, res.reason).then((r) => {
        // The server owns the stamp — copy back what it wrote so the badge and
        // the next warning show the real timestamp, not an optimistic guess.
        const c2 = STB.store.bills.find((x) => x.id === cur.id);
        if (c2 && r) {
          c2.original_amount = r.original_amount;
          c2.adjusted_at = r.adjusted_at;
          c2.adjusted_by = r.adjusted_by;
          c2.adjustment_reason = r.adjustment_reason;
          STB.commitStore();
        }
      }).catch((e) => {
        console.error('adjustVoucherAmount failed', e);
        const c2 = STB.store.bills.find((x) => x.id === cur.id);
        if (c2) Object.assign(c2, before);
        STB.toast('Could not update — ' + (e.message || 'reverted'));
        STB.commitStore();
      });
    });
  }

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
        // What the invoices came to, when that is not what was paid. Shown on
        // the row rather than behind a click: a deduction is the one thing
        // about a settled voucher anyone goes looking for later.
        const adj = Number(b.adjustment) || 0;
        const adjHint = isVoucher(b) && adj !== 0
          ? `<div class="hint">${U.money(b.invoice_total)} ${
            adj > 0 ? 'less' : 'plus'} ${U.money(Math.abs(adj))}</div>`
          : '';
        return `
        <tr data-id="${b.id}">
          <td class="col-sel"><label class="sel-box">
            <input type="checkbox" class="sel" data-id="${b.id}"${selected.has(b.id) ? ' checked' : ''}>
          </label></td>
          <td>${U.fmtDate(b.bill_date)}</td>
          <td><a href="#/party/${b.party_id}">${U.escapeHTML(p ? p.name : '?')}</a></td>
          <td>${U.escapeHTML(b.note || '')}</td>
          <td class="num ${cls}">${sign}${U.money(b.amount)}${adjHint}</td>
          <td>${b.status === 'paid'
            ? `<span class="badge paid">Paid</span> <span class="hint">${U.escapeHTML(b.payment_ref || '')}</span>`
            : `<span class="badge pending">Pending</span>
               <button class="btn ghost mark-paid" data-id="${b.id}">Mark paid</button>`}
            ${STB.adjust.badgeHTML(b)}</td>
          <td class="row-actions">${b.status === 'paid' ? '' :
            `<button class="btn ghost edit" data-id="${b.id}" title="Edit amount">Edit</button> `
            }<button class="btn ghost del" data-id="${b.id}" title="Delete">✕</button></td>
        </tr>${STB.adjust.detailRowHTML(b, 7,
          STB.store.invoices.filter((i) => i.bill_id === b.id))}`;
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

        // A voucher built from invoices takes a different edit entirely: its
        // amount is the figure the bank debited after Avinash's deduction, and
        // its breakdown belongs to the invoices underneath it, which this must
        // not touch. See adjustVoucher below.
        if (isVoucher(b)) { adjustVoucher(b); return; }

        STB.adjustModal.open({
          title: 'Edit amount',
          party: (STB.partyById(b.party_id) || {}).name || '',
          warning: priorWarning(b),
          value: b.amount_expr || String(b.amount)
        }).then((res) => {
          if (!res) return;
          const typed = res.raw;
          const v = STB.util.safeEval(typed);
          if (Number.isNaN(v)) { STB.toast('Could not read that amount'); return; }
          const amt = Math.round(v * 100) / 100;
          if (!(amt > 0)) { STB.toast('Amount must be more than 0'); return; }
          // Same rule as the entry form: keep the breakdown only when one was
          // actually typed. Operator anywhere, or a minus past the first char.
          const expr = /[+*/]|(?!^)-/.test(typed) ? typed : '';

          // Re-find rather than reusing `b`: the modal can sit open indefinitely
          // while typing, and a background refresh may have replaced the array in
          // that window, leaving `b` an orphan whose mutation nothing would render.
          const cur = STB.store.bills.find((x) => x.id === id);
          if (!cur) { STB.toast('Bill no longer exists'); return; }
          if (amt === Number(cur.amount) && expr === (cur.amount_expr || '') && !res.reason) return;

          const before = {
            amount: cur.amount, amount_expr: cur.amount_expr,
            original_amount: cur.original_amount, adjusted_at: cur.adjusted_at,
            adjusted_by: cur.adjusted_by, adjustment_reason: cur.adjustment_reason
          };
          cur.amount = amt;
          cur.amount_expr = expr;
          STB.toast('Amount updated ✓');
          STB.commitStore();

          STB.db.updateBillAmount(id, amt, expr, res.reason).then((r) => {
            const c2 = STB.store.bills.find((x) => x.id === id);
            if (c2 && r) {
              c2.original_amount = r.original_amount;
              c2.adjusted_at = r.adjusted_at;
              c2.adjusted_by = r.adjusted_by;
              c2.adjustment_reason = r.adjustment_reason;
              STB.commitStore();
            }
          }).catch((e) => {
            console.error('updateBillAmount failed', e);
            const c2 = STB.store.bills.find((x) => x.id === id);
            if (c2) Object.assign(c2, before);
            // Surface the server's reason — "already marked paid" is a real
            // outcome here (someone else settled it from another device), not a
            // connection problem, and "check connection" would send Harshit
            // looking in the wrong place.
            STB.toast('Could not update — ' + (e.message || 'reverted'));
            STB.commitStore();
          });
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

      STB.adjust.wireToggles(root);

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
