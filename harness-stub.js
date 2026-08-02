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
    ],
    invoices: [
      { id: 'i-1', party_id: 'p-1', invoice_no: 'JFPS26-27-000168', amount: 10000,
        invoice_date: '2026-07-10', note: '', status: 'unallocated', bill_id: '',
        created_by: EMAIL, created_at: '2026-07-10T05:00:00Z' },
      { id: 'i-2', party_id: 'p-1', invoice_no: 'JFPS26-27-000154', amount: 10000,
        invoice_date: '2026-07-12', note: '', status: 'unallocated', bill_id: '',
        created_by: EMAIL, created_at: '2026-07-12T05:00:00Z' },
      { id: 'i-3', party_id: 'p-2', invoice_no: 'BT-9001', amount: 2500,
        invoice_date: '2026-07-14', note: '', status: 'unallocated', bill_id: '',
        created_by: EMAIL, created_at: '2026-07-14T05:00:00Z' }
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
        : (a.bill_date < b.bill_date ? 1 : -1)),
    invoices: clone(server.invoices)
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

  // Mirrors stampAdjustment_ in apps-script/Code.gs: original_amount is written
  // only once, and reasons accumulate rather than replace.
  function stampAdjustment(b, prevAmount, reason) {
    const at = new Date().toISOString();
    const existingOrig = String(b.original_amount == null ? '' : b.original_amount).trim();
    b.original_amount = existingOrig === '' ? prevAmount : Number(b.original_amount);
    b.adjusted_at = at;
    b.adjusted_by = EMAIL;
    const t = String(reason == null ? '' : reason).trim();
    if (t) {
      const line = at.slice(0, 10) + ': ' + t;
      b.adjustment_reason = b.adjustment_reason ? b.adjustment_reason + '\n' + line : line;
    }
    return b;
  }

  // Mirrors updateBillAmount_ in apps-script/Code.gs, including its refusal on a
  // bill already marked paid — that rejection is a path the UI has to handle.
  STB.db.updateBillAmount = (id, amount, amountExpr, reason) => respond('updateBillAmount', () => {
    const amt = Number(amount);
    if (!(amt > 0)) throw new Error('amount must be greater than zero');
    const b = server.bills.find((x) => x.id === id);
    if (!b) throw new Error('bill not found');
    if (b.status === 'paid') throw new Error('bill is already marked paid — delete and re-enter it');
    const prevAmount = Number(b.amount);
    b.amount = amt;
    b.amount_expr = String(amountExpr || '');
    stampAdjustment(b, prevAmount, reason);
    return {
      ok: true, id: id, amount: amt, amount_expr: b.amount_expr,
      original_amount: b.original_amount, adjusted_at: b.adjusted_at,
      adjusted_by: b.adjusted_by, adjustment_reason: b.adjustment_reason
    };
  });

  STB.db.deleteBill = (id) => respond('deleteBill', () => {
    const i = server.bills.findIndex((x) => x.id === id);
    if (i < 0) throw new Error('bill not found');
    server.bills.splice(i, 1);
    return { ok: true };
  });

  STB.db.deleteAllBills = () => respond('deleteAllBills', () => {
    server.bills.length = 0;
    // Invoices survive and go back to the pool — see deleteAllBills_ in Code.gs.
    server.invoices.forEach((inv) => { inv.status = 'unallocated'; inv.bill_id = ''; });
    return { ok: true };
  });
  STB.db.applyImport = () => respond('applyImport', () => ({ applied: 0, txns: 0 }));

  // --- invoices -----------------------------------------------------------
  // Mirrors the invoice actions in apps-script/Code.gs, refusals included: the
  // "already on a voucher" rejection is the two-people race the UI has to
  // recover from, so the harness has to be able to produce it.
  STB.db.listInvoices = () => respond('listInvoices', () => clone(server.invoices));

  STB.db.createInvoice = (invoice) => respond('createInvoice', () => {
    if (!server.parties.some((p) => p.id === invoice.party_id)) throw new Error('party not found');
    if (!(Number(invoice.amount) > 0)) throw new Error('amount must be greater than zero');
    const row = Object.assign({
      id: 'i-' + Date.now(), status: 'unallocated', bill_id: '',
      created_by: EMAIL, created_at: new Date().toISOString()
    }, invoice);
    server.invoices.push(row);
    return clone(row);
  });

  STB.db.updateInvoice = (id, patch) => respond('updateInvoice', () => {
    const inv = server.invoices.find((x) => x.id === id);
    if (!inv) throw new Error('invoice not found');
    if (inv.status === 'allocated') {
      throw new Error('invoice is on a voucher — delete the voucher to free it');
    }
    Object.assign(inv, patch);
    return { ok: true, id: id };
  });

  STB.db.deleteInvoice = (id) => respond('deleteInvoice', () => {
    const i = server.invoices.findIndex((x) => x.id === id);
    if (i < 0) throw new Error('invoice not found');
    if (server.invoices[i].status === 'allocated') {
      throw new Error('invoice is on a voucher — delete the voucher to free it');
    }
    server.invoices.splice(i, 1);
    return { ok: true };
  });

  STB.db.createVoucherFromInvoices = (partyId, ids, billDate) =>
    respond('createVoucherFromInvoices', () => {
      const picked = [];
      (ids || []).forEach((id) => {
        const inv = server.invoices.find((x) => x.id === id);
        if (!inv) throw new Error('invoice not found: ' + id);
        if (inv.status === 'allocated') {
          throw new Error('invoice is already on a voucher: ' + inv.invoice_no);
        }
        if (inv.party_id !== partyId) {
          throw new Error('invoice belongs to a different party: ' + inv.invoice_no);
        }
        picked.push(inv);
      });
      if (!picked.length) throw new Error('select at least one invoice');
      const total = picked.reduce((n, inv) => n + Math.round(inv.amount * 100), 0) / 100;
      const bill = {
        id: 'srv-' + Date.now(), party_id: partyId, type: 'paid', amount: total,
        bill_date: billDate, status: 'pending', payment_ref: '', payment_date: '',
        note: 'INVOICE NO.- ' + picked.map((i) => i.invoice_no).join(', '),
        amount_expr: picked.length > 1 ? picked.map((i) => String(i.amount)).join('+') : '',
        created_by: EMAIL, created_at: new Date().toISOString(),
        invoice_total: total, adjustment: 0, invoice_ids: picked.map((i) => i.id).join(',')
      };
      server.bills.push(bill);
      picked.forEach((inv) => { inv.status = 'allocated'; inv.bill_id = bill.id; });
      return clone(bill);
    });

  STB.db.adjustVoucherAmount = (id, amount, reason) => respond('adjustVoucherAmount', () => {
    const amt = Number(amount);
    if (!(amt > 0)) throw new Error('amount must be greater than zero');
    const b = server.bills.find((x) => x.id === id);
    if (!b) throw new Error('bill not found');
    if (b.status === 'paid') throw new Error('bill is already marked paid — delete and re-enter it');
    if (b.invoice_total === undefined || String(b.invoice_total).trim() === '') {
      throw new Error('not an invoice-derived voucher — edit its amount instead');
    }
    const prevAmount = Number(b.amount);
    b.amount = amt;
    b.adjustment = (Math.round(b.invoice_total * 100) - Math.round(amt * 100)) / 100;
    stampAdjustment(b, prevAmount, reason);
    return {
      ok: true, id: id, amount: amt, adjustment: b.adjustment,
      original_amount: b.original_amount, adjusted_at: b.adjusted_at,
      adjusted_by: b.adjusted_by, adjustment_reason: b.adjustment_reason
    };
  });

  STB.db.signOut = () => STB.auth.signOut();
  STB.db.getSession = () => Promise.resolve(STB.auth.session());
  STB.db.signIn = (el) => STB.auth.renderButton(el);

  // Must track KEY in js/lib/cache.js — bumped to v2 when invoices joined the
  // snapshot. A stale key here reads null and every cache assertion fails on
  // the probe rather than on the app.
  window.HZ.cacheRaw = () => localStorage.getItem('stb.snapshot.v2');
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
