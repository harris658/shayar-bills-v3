/**
 * Local verification harness. Replaces STB.auth's Google dependency and
 * STB.db's network with an in-memory server that answers on a deliberate
 * 2000ms delay — the measured Apps Script floor. Not loaded by index.html.
 *
 * Serve bills-v3 over http and open /harness.html. Drive it from the console
 * via window.HZ (see the methods at the bottom).
 */
(function () {
  'use strict';
  const LATENCY = 2000;
  const log = [];

  function say(msg) {
    log.unshift(new Date().toISOString().slice(11, 23) + '  ' + msg);
    const el = document.getElementById('hz');
    if (el) el.innerHTML = log.slice(0, 40).join('<br>');
    console.log('[HZ] ' + msg);
  }
  window.HZ = { say: say, log: log };

  // --- fake identity -------------------------------------------------------
  const EMAIL = 'contact@shayartex.com';
  let signedIn = true;
  STB.auth.session = () => (signedIn ? { email: EMAIL, name: 'Test' } : null);
  STB.auth.get = () => (signedIn ? 'fake-token' : null);
  STB.auth.valid = () => signedIn;
  STB.auth.ensureFresh = () => Promise.resolve('fake-token');
  STB.auth.signOut = () => { signedIn = false; };
  STB.auth.renderButton = (el) => {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = 'Fake Google sign-in';
    b.onclick = () => { signedIn = true; STB.boot({ skipRenew: true }); };
    el.appendChild(b);
    return new Promise(() => {});
  };

  // --- fake server ---------------------------------------------------------
  const server = {
    parties: [
      { id: 'p-1', name: 'Alpha Fabrics', phone: '', notes: '', created_at: '2026-01-01T00:00:00Z' },
      { id: 'p-2', name: 'Beta Textiles', phone: '', notes: '', created_at: '2026-01-02T00:00:00Z' }
    ],
    bills: [
      { id: 'b-1', party_id: 'p-1', type: 'paid', amount: 12500, bill_date: '2026-07-20',
        note: 'silk lot', amount_expr: '', status: 'pending', payment_ref: '', payment_date: '',
        created_by: EMAIL, created_at: '2026-07-20T05:00:00Z' },
      { id: 'b-2', party_id: 'p-2', type: 'paid', amount: 4300, bill_date: '2026-07-18',
        note: 'buttons', amount_expr: '', status: 'pending', payment_ref: '', payment_date: '',
        created_by: EMAIL, created_at: '2026-07-18T05:00:00Z' }
    ]
  };
  let failNext = null; // action name to reject once
  window.HZ.failNext = (action) => { failNext = action; say('<b>next ' + action + ' will FAIL</b>'); };
  window.HZ.server = server;

  function respond(action, fn) {
    const t0 = performance.now();
    say('→ ' + action);
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (failNext === action) {
          failNext = null;
          say('← ' + action + ' FAILED after ' + Math.round(performance.now() - t0) + 'ms');
          reject(new Error('simulated backend failure'));
          return;
        }
        let out;
        try { out = fn(); } catch (e) { reject(e); return; }
        say('← ' + action + ' ok in ' + Math.round(performance.now() - t0) + 'ms');
        resolve(out);
      }, LATENCY);
    });
  }

  const clone = (o) => JSON.parse(JSON.stringify(o));

  STB.db.snapshot = () => respond('snapshot', () => ({
    parties: clone(server.parties),
    bills: clone(server.bills).sort((a, b) =>
      a.bill_date === b.bill_date
        ? (a.created_at < b.created_at ? 1 : -1)
        : (a.bill_date < b.bill_date ? 1 : -1))
  }));
  STB.db.listParties = () => respond('listParties', () => clone(server.parties));
  STB.db.listBills = () => respond('listBills', () => clone(server.bills));
  STB.db.listBankTxns = () => respond('listBankTxns', () => []);

  STB.db.createParty = (name) => respond('createParty', () => {
    const p = { id: 'p-' + Date.now(), name: name, phone: '', notes: '',
      created_at: new Date().toISOString() };
    server.parties.push(p);
    return clone(p);
  });

  STB.db.createBill = (bill) => respond('createBill', () => {
    const row = Object.assign({
      id: 'srv-' + Date.now(), status: 'pending', payment_ref: '', payment_date: '',
      amount_expr: '', created_by: EMAIL, created_at: new Date().toISOString()
    }, bill);
    server.bills.push(row);
    return clone(row);
  });

  STB.db.markPaid = (id, opts) => respond('markPaid', () => {
    const b = server.bills.find((x) => x.id === id);
    if (!b) throw new Error('bill not found');
    b.status = 'paid';
    b.payment_ref = (opts && opts.payment_ref) || '';
    b.payment_date = (opts && opts.payment_date) || '';
    return { ok: true };
  });

  STB.db.deleteBill = (id) => respond('deleteBill', () => {
    const i = server.bills.findIndex((x) => x.id === id);
    if (i < 0) throw new Error('bill not found');
    server.bills.splice(i, 1);
    return { ok: true };
  });

  STB.db.deleteAllBills = () => respond('deleteAllBills', () => {
    server.bills.length = 0;
    return { ok: true };
  });
  STB.db.applyImport = () => respond('applyImport', () => ({ applied: 0, txns: 0 }));

  STB.db.signOut = () => STB.auth.signOut();
  STB.db.getSession = () => Promise.resolve(STB.auth.session());
  STB.db.signIn = (el) => STB.auth.renderButton(el);

  window.HZ.cacheRaw = () => localStorage.getItem('stb.snapshot.v1');
  window.HZ.storeSummary = () => ({
    loaded: STB.store.loaded,
    parties: STB.store.parties.length,
    bills: STB.store.bills.length,
    ids: STB.store.bills.map((b) => b.id),
    statuses: STB.store.bills.map((b) => b.id + ':' + b.status)
  });
  window.HZ.dashText = () => document.getElementById('screen-root').innerText.replace(/\n+/g, ' | ');

  say('harness ready — LATENCY=' + LATENCY + 'ms');
})();
