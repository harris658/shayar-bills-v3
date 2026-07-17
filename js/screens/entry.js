(function () {
  'use strict';
  globalThis.STB = globalThis.STB || {};
  STB.screens = STB.screens || {};
  const U = () => STB.util;

  STB.screens.new = {
    render(root) {
      const U$ = U();
      root.innerHTML = `
        <div class="card" style="max-width:520px;margin:0 auto">
          <h2 style="margin-top:0">New Bill</h2>
          <div class="type-row">
            <button class="type-btn active" data-type="paid">Paid</button>
            <button class="type-btn" data-type="received">Received</button>
          </div>
          <label>Party
            <input id="f-party" autocomplete="off" placeholder="Type 2 letters…">
          </label>
          <div id="party-drop" class="drop" hidden></div>
          <label>Amount
            <input id="f-amount" autocomplete="off" inputmode="decimal"
                   placeholder="12500  or  1200+850">
          </label>
          <div class="hint" id="amount-preview">&nbsp;</div>
          <label>Date <input id="f-date" type="date" value="${U$.todayStr()}"></label>
          <label>Note <input id="f-note" autocomplete="off"></label>
          <div style="display:flex;gap:10px;margin-top:18px">
            <button class="btn" id="save-btn">Save</button>
            <button class="btn secondary" id="save-add-btn">Save &amp; add another (Ctrl+Enter)</button>
          </div>
        </div>`;

      const $ = (s) => root.querySelector(s);
      const party = $('#f-party'), amount = $('#f-amount'), date = $('#f-date'),
        note = $('#f-note'), drop = $('#party-drop'), preview = $('#amount-preview');
      let type = 'paid';
      let hi = 0; // highlighted dropdown index

      root.querySelectorAll('.type-btn').forEach((b) => {
        b.addEventListener('click', () => {
          type = b.dataset.type;
          root.querySelectorAll('.type-btn').forEach((x) =>
            x.classList.toggle('active', x === b));
        });
      });

      function matches() {
        const q = party.value.trim().toLowerCase();
        if (!q) return [];
        return STB.store.parties.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 6);
      }
      function exact() {
        const q = party.value.trim().toLowerCase();
        return STB.store.parties.find((p) => p.name.toLowerCase() === q) || null;
      }
      function renderDrop() {
        const m = matches();
        const canCreate = party.value.trim() && !exact();
        const items = m.map((p, i) =>
          `<div class="drop-item${i === hi ? ' hi' : ''}" data-i="${i}">${U$.escapeHTML(p.name)}</div>`);
        if (canCreate) items.push(
          `<div class="drop-item create${hi === m.length ? ' hi' : ''}" data-i="${m.length}">+ Create “${U$.escapeHTML(party.value.trim())}”</div>`);
        drop.innerHTML = items.join('');
        drop.hidden = items.length === 0;
      }
      let picking = false;
      async function pick(i) {
        if (picking) return;
        const m = matches();
        if (i < m.length) { party.value = m[i].name; }
        else {
          picking = true;
          try {
            const p = await STB.db.createParty(party.value.trim());
            STB.store.parties.push(p);
            STB.store.parties.sort((a, b) => a.name.localeCompare(b.name));
            STB.toast('Party created ✓');
          } catch (e) {
            console.error('createParty failed', e);
            STB.toast('Could not create party — check connection');
            return;
          } finally {
            picking = false;
          }
        }
        drop.hidden = true;
        amount.focus();
      }
      party.addEventListener('input', () => { hi = 0; renderDrop(); });
      party.addEventListener('keydown', (e) => {
        const total = matches().length + (party.value.trim() && !exact() ? 1 : 0);
        if (e.key === 'ArrowDown') { hi = Math.min(hi + 1, total - 1); renderDrop(); e.preventDefault(); }
        else if (e.key === 'ArrowUp') { hi = Math.max(hi - 1, 0); renderDrop(); e.preventDefault(); }
        else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          if (exact()) { drop.hidden = true; amount.focus(); }
          else if (total > 0) pick(hi);
        }
      });
      drop.addEventListener('mousedown', (e) => {
        const item = e.target.closest('.drop-item');
        if (item) { e.preventDefault(); pick(Number(item.dataset.i)); }
      });
      party.addEventListener('blur', () => setTimeout(() => { drop.hidden = true; }, 150));

      amount.addEventListener('input', () => {
        const v = U$.safeEval(amount.value.trim());
        preview.innerHTML = Number.isNaN(v) ? '&nbsp;' : '= ' + U$.money(Math.round(v * 100) / 100);
      });
      amount.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); date.focus(); }
      });
      date.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); note.focus(); }
      });

      let saving = false;
      async function save(addAnother) {
        if (saving) return;
        const name = party.value.trim();
        const v = U$.safeEval(amount.value.trim());
        const amt = Number.isNaN(v) ? 0 : Math.round(v * 100) / 100;
        if (!name) { STB.toast('Party is required'); party.focus(); return; }
        if (!(amt > 0)) { STB.toast('Amount must be more than 0'); amount.focus(); return; }
        saving = true;
        try {
          let p = exact();
          if (!p) {
            p = await STB.db.createParty(name);
            STB.store.parties.push(p);
          }
          await STB.db.createBill({
            party_id: p.id, type, amount: amt,
            bill_date: date.value || U$.todayStr(), note: note.value.trim()
          });
        } catch (e) {
          console.error('save failed', e);
          STB.toast('Could not save — check connection');
          return;
        } finally {
          saving = false;
        }
        STB.toast('Bill saved ✓');
        if (addAnother) {
          party.value = ''; amount.value = ''; note.value = '';
          preview.innerHTML = '&nbsp;';
          STB.refresh();           // background; form keeps focus
          party.focus();
        } else {
          await STB.refresh();
          STB.nav('#/bills');
        }
      }
      $('#save-btn').addEventListener('click', () => save(false));
      $('#save-add-btn').addEventListener('click', () => save(true));
      root.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(true); }
      });

      party.focus();
    }
  };
})();
