(function () {
  'use strict';
  globalThis.STB = globalThis.STB || {};
  STB.screens = STB.screens || {};

  // step: 'pick' | 'map' | 'review'
  const st = { step: 'pick', rows: [], mapping: null, proposal: null, fileName: '' };

  STB.screens.import = {
    // Mid-flow = mapping or review step, where tick/dropdown state would be
    // silently lost if a background refresh rebuilt the DOM from scratch.
    inProgress() { return st.step !== 'pick'; },
    render(root) {
      const U = STB.util;

      if (st.step === 'pick') {
        root.innerHTML = `
          <div class="card" style="max-width:560px;margin:0 auto">
            <h2 style="margin-top:0">Import bank statement</h2>
            <p class="hint">CSV or XLSX exported from the bank portal. Nothing is saved
            until you confirm on the review screen.</p>
            <input type="file" id="stmt-file" accept=".csv,.txt,.xls,.xlsx">
          </div>`;
        root.querySelector('#stmt-file').addEventListener('change', async (e) => {
          const file = e.target.files[0];
          if (!file) return;
          try {
            st.rows = await STB.statement.fileToRows(file);
            st.fileName = file.name;
            st.mapping = STB.statement.loadMapping() ||
              { dateCol: 0, descCol: 1, refCol: 2, amountCol: 3, headerRows: 1 };
            st.step = 'map';
            this.render(root);
          } catch (err) {
            console.error('fileToRows failed', err);
            STB.toast('Could not read file — is it a valid CSV/XLSX?');
          }
        });
        return;
      }

      if (st.step === 'map') {
        const header = st.rows[0] || [];
        const colOpts = (sel) => header.map((h, i) =>
          `<option value="${i}"${i === sel ? ' selected' : ''}>${i + 1}: ${U.escapeHTML(String(h).slice(0, 28))}</option>`).join('');
        const m = st.mapping;
        const preview = STB.statement.applyMapping(st.rows, m).slice(0, 3);
        root.innerHTML = `
          <div class="card" style="max-width:680px;margin:0 auto">
            <h2 style="margin-top:0">Map columns — ${U.escapeHTML(st.fileName)}</h2>
            <div class="map-grid">
              <label>Date column <select id="m-date">${colOpts(m.dateCol)}</select></label>
              <label>Amount column (debit) <select id="m-amount">${colOpts(m.amountCol)}</select></label>
              <label>Ref/UTR column <select id="m-ref">${colOpts(m.refCol)}</select></label>
              <label>Description column <select id="m-desc">${colOpts(m.descCol)}</select></label>
              <label>Header rows to skip <input id="m-header" type="number" min="0" value="${m.headerRows}"></label>
            </div>
            <h4>Preview (first 3 parsed)</h4>
            <div class="tbl-wrap">
              <table class="tbl"><tbody>${preview.map((t) =>
                `<tr><td>${U.fmtDate(t.txn_date)}</td><td>${U.escapeHTML(t.description)}</td>
                 <td>${U.escapeHTML(t.ref)}</td><td class="num">${U.money(t.amount)}</td></tr>`).join('')
                || '<tr><td class="hint">Nothing parses yet — adjust the columns.</td></tr>'}</tbody></table>
            </div>
            <div style="display:flex;gap:10px;margin-top:14px">
              <button class="btn" id="run-match">Run matching</button>
              <button class="btn ghost" id="cancel">Start over</button>
            </div>
          </div>`;
        const remap = () => {
          st.mapping = {
            dateCol: Number(root.querySelector('#m-date').value),
            amountCol: Number(root.querySelector('#m-amount').value),
            refCol: Number(root.querySelector('#m-ref').value),
            descCol: Number(root.querySelector('#m-desc').value),
            headerRows: Number(root.querySelector('#m-header').value) || 0
          };
          this.render(root);
        };
        ['#m-date', '#m-amount', '#m-ref', '#m-desc', '#m-header'].forEach((id) =>
          root.querySelector(id).addEventListener('change', remap));
        root.querySelector('#cancel').addEventListener('click', () => {
          st.step = 'pick'; this.render(root);
        });
        root.querySelector('#run-match').addEventListener('click', async (e) => {
          const btn = e.currentTarget;
          if (btn.disabled) return;
          btn.disabled = true;
          try {
            const parsed = STB.statement.applyMapping(st.rows, st.mapping);
            const existing = await STB.db.listBankTxns();
            const fresh = STB.statement.dedupe(parsed, existing);
            const pending = STB.store.bills.filter((b) => b.status === 'pending' && b.type === 'paid');
            st.proposal = STB.matching.proposeMatches(fresh, pending);
            st.skipped = parsed.length - fresh.length;
            st.step = 'review';
            this.render(root);
          } catch (err) {
            console.error('listBankTxns failed', err);
            STB.toast('Could not run matching — check connection');
            btn.disabled = false;
          }
        });
        return;
      }

      // review
      const pr = st.proposal;
      const line = (m, i, kind, checked) => {
        const p = STB.partyById(m.bill.party_id);
        return `<label class="match-line">
          <input type="checkbox" class="m-${kind}" data-i="${i}" ${checked ? 'checked' : ''}>
          <span>${U.fmtDate(m.txn.txn_date)} · ${U.money(m.txn.amount)} ·
            ref <b>${U.escapeHTML(m.txn.ref)}</b></span>
          <span>→ ${U.escapeHTML(p ? p.name : '?')} bill of ${U.fmtDate(m.bill.bill_date)}</span>
        </label>`;
      };
      root.innerHTML = `
        <div class="card" style="max-width:760px;margin:0 auto">
          <h2 style="margin-top:0">Review matches</h2>
          ${st.skipped ? `<p class="hint">${st.skipped} row(s) skipped — already imported or duplicate.</p>` : ''}
          <h4>Confident (${pr.confident.length}) — pre-ticked</h4>
          ${pr.confident.map((m, i) => line(m, i, 'conf', true)).join('') || '<p class="hint">None.</p>'}
          <h4>Suggested (${pr.suggested.length}) — amount matches, date far — tick to accept</h4>
          ${pr.suggested.map((m, i) => line(m, i, 'sugg', false)).join('') || '<p class="hint">None.</p>'}
          <h4>Statement rows with no matching bill (${pr.unmatchedTxns.length})</h4>
          ${pr.unmatchedTxns.map((t) =>
            `<div class="match-line hint">${U.fmtDate(t.txn_date)} · ${U.money(t.amount)} ·
             ${U.escapeHTML(t.ref)} · ${U.escapeHTML(t.description)}</div>`).join('') || '<p class="hint">None.</p>'}
          <h4>Pending bills untouched by this statement (${pr.unmatchedBills.length})</h4>
          ${pr.unmatchedBills.map((b) => {
            const p = STB.partyById(b.party_id);
            return `<div class="match-line hint">${U.fmtDate(b.bill_date)} ·
              ${U.escapeHTML(p ? p.name : '?')} · ${U.money(b.amount)}</div>`;
          }).join('') || '<p class="hint">None.</p>'}
          <div style="display:flex;gap:10px;margin-top:16px">
            <button class="btn" id="confirm">Confirm import</button>
            <button class="btn ghost" id="back">Back</button>
          </div>
        </div>`;

      root.querySelector('#back').addEventListener('click', () => {
        st.step = 'map'; this.render(root);
      });
      root.querySelector('#confirm').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        if (btn.disabled) return;
        btn.disabled = true;
        const ticked = (kind, list) =>
          Array.from(root.querySelectorAll('.m-' + kind))
            .map((c, i) => (c.checked ? list[i] : null)).filter(Boolean);
        const accepted = ticked('conf', pr.confident).concat(ticked('sugg', pr.suggested));
        const acceptedTxnKeys = new Set(accepted.map((m) => m.txn.ref + '|' + m.txn.amount + '|' + m.txn.txn_date));
        const allTxns = pr.confident.concat(pr.suggested).map((m) => m.txn).concat(pr.unmatchedTxns);
        const unmatched = allTxns.filter((t) =>
          !acceptedTxnKeys.has(t.ref + '|' + t.amount + '|' + t.txn_date));
        try {
          await STB.db.applyImport({
            matches: accepted.map((m) => ({ txn: m.txn, bill_id: m.bill.id })),
            unmatchedTxns: unmatched
          });
          STB.statement.saveMapping(st.mapping);
          st.step = 'pick'; st.proposal = null;
          STB.toast(`Imported — ${accepted.length} bill(s) marked paid ✓`);
          await STB.refresh();
          STB.nav('#/bills');
        } catch (err) {
          console.error('applyImport failed', err);
          STB.toast('Could not complete import — check connection');
          btn.disabled = false;
        }
      });
    }
  };
})();
