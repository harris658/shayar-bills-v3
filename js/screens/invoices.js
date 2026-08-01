(function () {
  'use strict';
  globalThis.STB = globalThis.STB || {};
  STB.screens = STB.screens || {};

  /**
   * Invoices (GRC PIs) — recorded when they are raised, spent later.
   *
   * Two cards, one job each. The top one records an invoice as it comes in,
   * which is the whole point of the screen: the details get typed once, at the
   * time they are already in hand, instead of being re-typed from paper weeks
   * later when the voucher is built. The bottom one turns a selection of them
   * into one debit voucher.
   *
   * They keep separate party pickers deliberately. Recording this week's
   * invoices for one vendor and building a voucher for another is normal, and a
   * single shared picker would silently retarget one card when you set up the
   * other.
   */

  // Module-level so a re-render (after every save) does not empty the form
  // under the person typing, and so ticks survive the list rebuilding.
  const form = { party_id: '', invoice_no: '', amount: '', invoice_date: '', note: '',
    newParty: false, newPartyName: '' };

  // Sentinel option value. A party id is a UUID, so this cannot collide.
  const NEW_PARTY = '__new';
  const ui = { party: '', showAll: false, editing: null, billDate: '' };
  const selected = new Set();
  let busy = false;

  function partyOptions(sel, placeholder) {
    return [`<option value="">${placeholder}</option>`]
      .concat(STB.store.parties.map((p) =>
        `<option value="${p.id}"${sel === p.id ? ' selected' : ''}>${
          STB.util.escapeHTML(p.name)}</option>`))
      .join('');
  }

  STB.screens.invoices = {
    render(root) {
      const U = STB.util;
      const all = STB.store.invoices || [];
      if (!ui.billDate) ui.billDate = U.todayStr();
      if (!form.invoice_date) form.invoice_date = U.todayStr();

      // Ticks are only ever valid for one party — the server refuses a mixed
      // selection, and silently carrying ticks across a party change would
      // build the wrong voucher.
      const pool = all.filter((inv) =>
        inv.party_id === ui.party && (ui.showAll || inv.status !== 'allocated'));

      const tickable = pool.filter((inv) =>
        inv.status !== 'allocated' && !STB.isPending(inv.id));
      const ticked = tickable.filter((inv) => selected.has(inv.id));
      const total = STB.voucher.voucherTotal(ticked);

      const rows = pool.map((inv) => {
        const spent = inv.status === 'allocated';
        const provisional = STB.isPending(inv.id);
        if (ui.editing === inv.id) {
          return `
          <tr data-id="${inv.id}" class="inv-editing">
            <td class="col-sel"></td>
            <td><input class="e-date" type="date" value="${U.escapeHTML(inv.invoice_date || '')}"></td>
            <td><input class="e-no" value="${U.escapeHTML(inv.invoice_no || '')}"></td>
            <td><input class="e-note" value="${U.escapeHTML(inv.note || '')}"></td>
            <td class="num"><input class="e-amount" inputmode="decimal" value="${
              U.escapeHTML(String(inv.amount))}" style="max-width:110px;text-align:right"></td>
            <td class="row-actions">
              <button class="btn ghost e-save" data-id="${inv.id}">Save</button>
              <button class="btn ghost e-cancel">Cancel</button>
            </td>
          </tr>`;
        }
        return `
        <tr data-id="${inv.id}">
          <td class="col-sel">${spent || provisional ? '' : `<label class="sel-box">
            <input type="checkbox" class="sel" data-id="${inv.id}"${
              selected.has(inv.id) ? ' checked' : ''}>
          </label>`}</td>
          <td>${U.fmtDate(inv.invoice_date)}</td>
          <td>${U.escapeHTML(inv.invoice_no || '')}</td>
          <td>${U.escapeHTML(inv.note || '')}</td>
          <td class="num">${U.money(inv.amount)}</td>
          <td class="row-actions">${
            spent ? '<span class="badge paid">On voucher</span>'
              : provisional ? '<span class="hint">Saving…</span>'
                : `<button class="btn ghost inv-edit" data-id="${inv.id}">Edit</button>
                   <button class="btn ghost inv-del" data-id="${inv.id}" title="Delete">✕</button>`
          }</td>
        </tr>`;
      }).join('');

      const emptyMsg = !STB.store.loaded ? 'Loading…'
        : !ui.party ? 'Pick a party to see its invoices.'
          : ui.showAll ? 'No invoices for this party yet.'
            : 'Nothing waiting — every invoice for this party is on a voucher.';

      root.innerHTML = `
        <div class="card" style="max-width:640px;margin:0 auto 18px">
          <h2 style="margin-top:0">Record invoice</h2>
          <p class="hint" style="margin-top:0">
            Enter it when you raise the GRC PI. Pick them off the list below when
            it is time to pay.
          </p>
          <label>Party
            <select id="f-party">${partyOptions(form.party_id, 'Select a party…')
              }<option value="${NEW_PARTY}">+ New party…</option></select>
          </label>
          ${form.newParty ? `
          <div class="filters" style="margin:-4px 0 10px;align-items:center">
            <input id="f-newparty" autocomplete="off" placeholder="New party name"
                   value="${U.escapeHTML(form.newPartyName)}" style="max-width:260px">
            <button class="btn secondary" id="f-addparty">Add party</button>
            <button class="btn ghost" id="f-cancelparty">Cancel</button>
          </div>` : ''}
          <label>Invoice number
            <input id="f-no" autocomplete="off" placeholder="JFPS26-27-000168"
                   value="${U.escapeHTML(form.invoice_no)}">
          </label>
          <label>Amount
            <input id="f-amount" autocomplete="off" inputmode="decimal"
                   placeholder="12500" value="${U.escapeHTML(form.amount)}">
          </label>
          <label>Invoice date
            <input id="f-date" type="date" value="${U.escapeHTML(form.invoice_date)}">
          </label>
          <label>Note <input id="f-note" autocomplete="off" value="${
            U.escapeHTML(form.note)}"></label>
          <div style="display:flex;gap:10px;margin-top:18px">
            <button class="btn" id="inv-save">Save invoice (Ctrl+Enter)</button>
          </div>
        </div>

        <div class="card">
          <h2 style="margin-top:0">Build debit voucher</h2>
          <div class="filters">
            <select id="v-party">${partyOptions(ui.party, 'Select a party…')}</select>
            <label class="hint" style="display:flex;align-items:center;gap:6px">
              <input type="checkbox" id="v-showall"${ui.showAll ? ' checked' : ''}>
              Show ones already on a voucher
            </label>
          </div>
          <div class="tbl-wrap">
            <table class="tbl">
              <thead><tr>
                <th class="col-sel"><label class="sel-box" title="Select all ${tickable.length}">
                  <input type="checkbox" id="sel-all">
                </label></th>
                <th>Date</th><th>Invoice no.</th><th>Note</th>
                <th class="num">Amount</th><th></th></tr></thead>
              <tbody>${rows || `<tr><td colspan="6" class="hint">${emptyMsg}</td></tr>`}</tbody>
            </table>
          </div>
          <div class="filters" style="margin-top:14px;align-items:center">
            <span><b>${ticked.length}</b> selected — <b>${U.money(total)}</b></span>
            <label class="hint" style="display:flex;align-items:center;gap:6px">
              Voucher date
              <input id="v-date" type="date" value="${ui.billDate}">
            </label>
            <button class="btn" id="v-create"${
              ticked.length && !busy ? '' : ' disabled'}>${
              busy ? 'Creating…' : 'Create debit voucher'}</button>
          </div>
        </div>`;

      const $ = (s) => root.querySelector(s);
      const rerender = () => this.render(root);

      // --- record form ------------------------------------------------------
      const bindForm = (sel, key) => $(sel).addEventListener('input', (e) => {
        form[key] = e.target.value;
      });
      bindForm('#f-no', 'invoice_no');
      bindForm('#f-amount', 'amount');
      bindForm('#f-note', 'note');
      $('#f-date').addEventListener('change', (e) => { form.invoice_date = e.target.value; });
      $('#f-party').addEventListener('change', (e) => {
        if (e.target.value === NEW_PARTY) {
          // Keep whatever party was already chosen selected underneath, so
          // cancelling puts the form back exactly where it was.
          form.newParty = true;
          rerender();
          const el = root.querySelector('#f-newparty');
          if (el) el.focus();
          return;
        }
        form.party_id = e.target.value;
      });

      const newPartyInput = $('#f-newparty');
      if (newPartyInput) {
        newPartyInput.addEventListener('input', (e) => { form.newPartyName = e.target.value; });
        newPartyInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); addParty(); }
        });
        $('#f-cancelparty').addEventListener('click', () => {
          form.newParty = false; form.newPartyName = ''; rerender();
        });
        $('#f-addparty').addEventListener('click', addParty);
      }

      let addingParty = false;
      async function addParty() {
        if (addingParty) return;
        const name = form.newPartyName.trim();
        if (!name) { STB.toast('Party name is required'); return; }

        // If it already exists, just pick it. The server would refuse the
        // duplicate anyway, and a round trip to be told "already exists" when
        // the right answer is "here it is" helps nobody.
        const existing = STB.store.parties.find(
          (p) => p.name.trim().toLowerCase() === name.toLowerCase());
        if (existing) {
          form.party_id = existing.id;
          form.newParty = false; form.newPartyName = '';
          STB.toast('Party already exists — selected it');
          rerender();
          root.querySelector('#f-no').focus();
          return;
        }

        addingParty = true;
        const btn = root.querySelector('#f-addparty');
        if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }
        try {
          // Awaited, not optimistic: the invoice needs the server's party id,
          // and a temporary one would have to be threaded through the invoice
          // and fixed up on both afterwards — two reconciliations racing each
          // other. Same call the New Bill form makes, for the same reason.
          const p = await STB.db.createParty(name);
          STB.store.parties.push(p);
          STB.store.parties.sort((a, b) => a.name.localeCompare(b.name));
          form.party_id = p.id;
          form.newParty = false; form.newPartyName = '';
          STB.toast('Party created ✓');
          STB.commitStore();
          const no = root.querySelector('#f-no');
          if (no) no.focus();
        } catch (e) {
          console.error('createParty failed', e);
          // Surface the server's own reason — "party already exists" is a real
          // outcome (someone added it from another device) and is not a
          // connection problem.
          STB.toast(String(e.message || e));
          if (btn) { btn.disabled = false; btn.textContent = 'Add party'; }
        } finally {
          addingParty = false;
        }
      }

      let saving = false;
      function saveInvoice() {
        if (saving) return;
        const amt = Number(String(form.amount).trim());
        if (!form.party_id) { STB.toast('Pick a party'); $('#f-party').focus(); return; }
        if (!form.invoice_no.trim()) { STB.toast('Invoice number is required'); $('#f-no').focus(); return; }
        if (!(amt > 0)) { STB.toast('Amount must be more than 0'); $('#f-amount').focus(); return; }
        if (!form.invoice_date) { STB.toast('Invoice date is required'); return; }
        saving = true;

        const invoice = {
          party_id: form.party_id,
          invoice_no: form.invoice_no.trim(),
          amount: Math.round(amt * 100) / 100,
          invoice_date: form.invoice_date,
          note: form.note.trim()
        };
        // Shown immediately and reconciled behind, as everywhere else in the
        // app. The provisional row mirrors what createInvoice_ writes, so the
        // swap is invisible; it cannot be ticked onto a voucher until the
        // server has acknowledged it (see STB.isPending above).
        const provisional = Object.assign({
          id: STB.pendingId(), status: 'unallocated', bill_id: '',
          created_at: new Date().toISOString()
        }, invoice);
        STB.store.invoices.unshift(provisional);

        STB.db.createInvoice(invoice).then((row) => {
          const i = STB.store.invoices.indexOf(provisional);
          if (i >= 0) {
            STB.store.invoices[i] = row;
            STB.commitStore();
          }
          STB.toast('Invoice saved ✓');
        }).catch((err) => {
          console.error('createInvoice failed', err);
          const i = STB.store.invoices.indexOf(provisional);
          if (i >= 0) {
            STB.store.invoices.splice(i, 1);
            STB.commitStore();
          }
          STB.toast('Could not save — the invoice was NOT recorded');
        });

        // Party and date stay: the next invoice is usually the same vendor on
        // the same day. Only what changes per invoice is cleared.
        form.invoice_no = ''; form.amount = ''; form.note = '';
        // Show it in the list below straight away when it belongs to the party
        // the builder is pointed at.
        saving = false;
        rerender();
        root.querySelector('#f-no').focus();
      }
      $('#inv-save').addEventListener('click', saveInvoice);
      root.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveInvoice(); }
      });

      // --- builder ----------------------------------------------------------
      $('#v-party').addEventListener('change', (e) => {
        ui.party = e.target.value;
        // A voucher is one party's — ticks never survive a party change.
        selected.clear();
        ui.editing = null;
        rerender();
      });
      $('#v-showall').addEventListener('change', (e) => {
        ui.showAll = e.target.checked; rerender();
      });
      $('#v-date').addEventListener('change', (e) => { ui.billDate = e.target.value; });

      root.querySelectorAll('.sel').forEach((cb) => cb.addEventListener('change', (e) => {
        if (e.target.checked) selected.add(e.target.dataset.id);
        else selected.delete(e.target.dataset.id);
        rerender();
      }));

      const selAll = $('#sel-all');
      const tickedCount = tickable.filter((inv) => selected.has(inv.id)).length;
      selAll.checked = tickable.length > 0 && tickedCount === tickable.length;
      selAll.indeterminate = tickedCount > 0 && tickedCount < tickable.length;
      selAll.disabled = tickable.length === 0;
      selAll.addEventListener('change', () => {
        tickable.forEach((inv) => {
          if (selAll.checked) selected.add(inv.id); else selected.delete(inv.id);
        });
        rerender();
      });

      // Whole-cell hit target, matching the bills list (see .col-sel in app.css).
      root.querySelectorAll('.col-sel').forEach((cell) => {
        cell.addEventListener('click', (e) => {
          if (e.target.closest('.sel-box')) return;
          const cb = cell.querySelector('input[type="checkbox"]');
          if (!cb || cb.disabled) return;
          cb.checked = !cb.checked;
          cb.dispatchEvent(new Event('change', { bubbles: true }));
        });
      });

      // --- edit / delete an invoice ----------------------------------------
      root.querySelectorAll('.inv-edit').forEach((btn) => btn.addEventListener('click', () => {
        ui.editing = btn.dataset.id; rerender();
      }));
      const cancel = $('.e-cancel');
      if (cancel) cancel.addEventListener('click', () => { ui.editing = null; rerender(); });

      const eSave = $('.e-save');
      if (eSave) eSave.addEventListener('click', () => {
        const id = eSave.dataset.id;
        const inv = STB.store.invoices.find((x) => x.id === id);
        if (!inv) return;
        const patch = {
          invoice_no: $('.e-no').value.trim(),
          amount: Number($('.e-amount').value.trim()),
          invoice_date: $('.e-date').value,
          note: $('.e-note').value.trim()
        };
        if (!patch.invoice_no) { STB.toast('Invoice number is required'); return; }
        if (!(patch.amount > 0)) { STB.toast('Amount must be more than 0'); return; }
        if (!patch.invoice_date) { STB.toast('Invoice date is required'); return; }

        const before = { invoice_no: inv.invoice_no, amount: inv.amount,
          invoice_date: inv.invoice_date, note: inv.note };
        Object.assign(inv, patch);
        ui.editing = null;
        STB.commitStore();

        STB.db.updateInvoice(id, patch).catch((err) => {
          console.error('updateInvoice failed', err);
          Object.assign(inv, before);
          STB.commitStore();
          STB.toast(String(err.message || err));
        });
      });

      root.querySelectorAll('.inv-del').forEach((btn) => btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const i = STB.store.invoices.findIndex((x) => x.id === id);
        if (i < 0) return;
        const inv = STB.store.invoices[i];
        if (!confirm(`Delete invoice ${inv.invoice_no}?`)) return;
        STB.store.invoices.splice(i, 1);
        selected.delete(id);
        STB.commitStore();
        STB.db.deleteInvoice(id).catch((err) => {
          console.error('deleteInvoice failed', err);
          STB.store.invoices.splice(i, 0, inv);
          STB.commitStore();
          STB.toast(String(err.message || err));
        });
      }));

      // --- create the voucher ----------------------------------------------
      $('#v-create').addEventListener('click', async () => {
        if (busy || !ticked.length) return;
        // Awaited rather than optimistic, unlike every other write here. This
        // one spends rows in two tables at once and the server owns the total,
        // the narration and the id — there is nothing honest to paint before it
        // answers. It also runs once a month per party, so the ~2.5s is not the
        // latency that matters.
        busy = true;
        rerender();
        try {
          const bill = await STB.db.createVoucherFromInvoices(
            ui.party, ticked.map((inv) => inv.id), ui.billDate || STB.util.todayStr()
          );
          STB.store.bills.unshift(bill);
          ticked.forEach((inv) => {
            const live = STB.store.invoices.find((x) => x.id === inv.id);
            if (live) { live.status = 'allocated'; live.bill_id = bill.id; }
          });
          selected.clear();
          busy = false;
          STB.persistStore();
          STB.toast('Voucher created ✓');
          STB.nav('#/bills');
        } catch (err) {
          console.error('createVoucherFromInvoices failed', err);
          busy = false;
          // Nothing was written — the server refuses the whole selection if any
          // one invoice is stale. Re-fetch rather than guess which: the likely
          // cause is that someone else vouchered one of these first, and the
          // ticks on screen are describing a pool that no longer exists.
          selected.clear();
          STB.toast(String(err.message || err));
          STB.refresh();
        }
      });
    }
  };
})();
