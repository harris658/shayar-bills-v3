(function () {
  'use strict';
  globalThis.STB = globalThis.STB || {};
  STB.screens = STB.screens || {};

  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }
  const csvCell = (s) => {
    s = String(s == null ? '' : s);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  STB.screens.more = {
    render(root) {
      root.innerHTML = `
        <div class="card" style="max-width:520px;margin:0 auto">
          <h2 style="margin-top:0">More</h2>
          <div style="display:grid;gap:10px">
            <button class="btn secondary" id="exp-csv">Export bills CSV</button>
            <button class="btn secondary" id="exp-json">Download JSON backup</button>
            <button class="btn ghost" id="imp-v2">Import v2 backup file…</button>
          </div>
          <p class="hint" style="margin-top:14px">v2 import: use the file from the old
          app's More → Backup. All v2 bills come in as PAID history. Run once only —
          running twice duplicates them.</p>
        </div>`;

      root.querySelector('#exp-csv').addEventListener('click', () => {
        const U = STB.util;
        const head = 'date,party,type,status,amount,ref,note';
        const lines = STB.store.bills.map((b) => {
          const p = STB.partyById(b.party_id);
          return [b.bill_date, p ? p.name : '', b.type, b.status,
            Number(b.amount), b.payment_ref, b.note].map(csvCell).join(',');
        });
        download(`shayar-bills-${U.todayStr()}.csv`,
          head + '\n' + lines.join('\n'), 'text/csv');
      });

      const expJsonBtn = root.querySelector('#exp-json');
      expJsonBtn.addEventListener('click', async () => {
        if (expJsonBtn.disabled) return;
        expJsonBtn.disabled = true;
        try {
          const bank_txns = await STB.db.listBankTxns();
          download(`shayar-bills-backup-${STB.util.todayStr()}.json`, JSON.stringify({
            parties: STB.store.parties, bills: STB.store.bills, bank_txns,
            exportedAt: new Date().toISOString()
          }, null, 2), 'application/json');
        } catch (e) {
          console.error('listBankTxns failed', e);
          STB.toast('Could not build backup — check connection');
        } finally {
          expJsonBtn.disabled = false;
        }
      });

      const impBtn = root.querySelector('#imp-v2');
      impBtn.addEventListener('click', () => {
        if (impBtn.disabled) return;
        document.getElementById('v2-file-input').click();
      });
      document.getElementById('v2-file-input').onchange = async (e) => {
        if (impBtn.disabled) return;
        const file = e.target.files[0];
        if (!file) return;
        if (!confirm('Import v2 backup? Run this ONCE only.')) { e.target.value = ''; return; }
        impBtn.disabled = true;
        let created = 0, imported = 0;
        try {
          const data = JSON.parse(await file.text());
          const byName = new Map(STB.store.parties.map((p) => [p.name.toLowerCase(), p]));
          for (const raw of (data.parties || [])) {
            const name = typeof raw === 'string' ? raw : raw && raw.name;
            if (!name || byName.has(name.toLowerCase())) continue;
            const p = await STB.db.createParty(name);
            byName.set(name.toLowerCase(), p); created++;
          }
          for (const b of (data.bills || [])) {
            if (!b || !b.party || !(Number(b.amount) > 0)) continue;
            let p = byName.get(String(b.party).toLowerCase());
            if (!p) { p = await STB.db.createParty(String(b.party)); byName.set(p.name.toLowerCase(), p); created++; }
            await STB.db.createBill({
              party_id: p.id,
              type: b.type === 'received' ? 'received' : 'paid',
              amount: Number(b.amount),
              bill_date: b.date || STB.util.todayStr(),
              note: b.note || '',
              status: 'paid',
              payment_ref: '',
              payment_date: b.date || STB.util.todayStr()
            });
            imported++;
          }
          STB.toast(`v2 import done — ${imported} bills, ${created} new parties`);
          STB.refresh();
        } catch (err) {
          console.error('v2 import failed', err);
          STB.toast(`Import failed — ${imported} bill(s) imported before the error. Check connection.`);
        } finally {
          e.target.value = '';
          impBtn.disabled = false;
        }
      };
    }
  };
})();
