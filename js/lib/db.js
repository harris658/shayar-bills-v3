(function () {
  'use strict';
  globalThis.STB = globalThis.STB || {};

  // Read lazily so tests can swap fetch between cases.
  function doFetch(url, opts) {
    return ((STB.env && STB.env.fetch) || globalThis.fetch)(url, opts);
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * One POST to the Apps Script web app.
   *
   * text/plain is required, not incidental: Apps Script does not answer CORS
   * preflight OPTIONS, and text/plain is one of the three types a browser may
   * send without preflighting.
   *
   * Apps Script cannot set meaningful status codes, so every response is a 200
   * carrying {ok, data} or {ok, error}. Throwing on ok:false keeps the existing
   * try/catch in every screen working unchanged.
   */
  async function rpc(action, args) {
    const token = await STB.auth.ensureFresh();

    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await doFetch(STB.config.APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: action, args: args || {}, idToken: token })
      });
      // A misconfigured deployment (a /dev URL, a stale deployment, or one
      // not set to "Anyone") still answers 200, but with an HTML login page
      // instead of {ok, data}. res.json() then throws a bare SyntaxError
      // that AUTH_DEAD_RE (js/app.js) does not match, so the owner sees
      // "check connection" with nothing to act on. Naming the real cause
      // here — before that generic parse error escapes — is the only way
      // to get a useful message onto screen.
      let out;
      try {
        out = await res.json();
      } catch (parseErr) {
        out = undefined;
      }
      if (res.ok === false || out === undefined || typeof out !== 'object') {
        throw new Error(
          'Backend did not return JSON — check APPS_SCRIPT_URL and that the ' +
          'deployment is set to "Anyone" (HTTP ' + res.status + ')'
        );
      }
      if (out.ok) return out.data;
      // Another user holds the write lock — one retry, then give up.
      if (out.error === 'busy' && attempt === 0) {
        await sleep(600);
        continue;
      }
      throw new Error(out.error || 'request failed');
    }
  }

  STB.db = {
    rpc: rpc,

    // --- session (client-local; no network) ---
    signIn(el) { return STB.auth.renderButton(el); },
    signOut() { STB.auth.signOut(); },
    async getSession() { return STB.auth.session(); },

    // --- reads ---
    snapshot() { return rpc('snapshot'); },
    listParties() { return rpc('listParties'); },
    listBills() { return rpc('listBills'); },
    listInvoices() { return rpc('listInvoices'); },
    listBankTxns() { return rpc('listBankTxns'); },

    // --- writes ---
    createParty(name) { return rpc('createParty', { name: name }); },
    createBill(bill) { return rpc('createBill', { bill: bill }); },
    markPaid(id, opts) {
      return rpc('markPaid', {
        id: id,
        payment_ref: (opts && opts.payment_ref) || '',
        payment_date: (opts && opts.payment_date) || ''
      });
    },
    // Amount only, and the server refuses it on a bill already marked paid.
    updateBillAmount(id, amount, amountExpr) {
      return rpc('updateBillAmount', {
        id: id, amount: amount, amount_expr: amountExpr || ''
      });
    },
    deleteBill(id) { return rpc('deleteBill', { id: id }); },

    // --- invoices (GRC PIs) ---
    createInvoice(invoice) { return rpc('createInvoice', { invoice: invoice }); },
    // Refused by the server once the invoice is on a voucher.
    updateInvoice(id, patch) { return rpc('updateInvoice', { id: id, patch: patch }); },
    deleteInvoice(id) { return rpc('deleteInvoice', { id: id }); },

    /**
     * Turns a selection of invoices into one debit voucher. The total, the
     * narration and the printed breakdown are all computed server-side — this
     * call deliberately sends no amount, so a stale tab cannot voucher a
     * selection for the wrong figure.
     */
    createVoucherFromInvoices(partyId, invoiceIds, billDate) {
      return rpc('createVoucherFromInvoices', {
        party_id: partyId, invoice_ids: invoiceIds || [], bill_date: billDate || ''
      });
    },
    // Records what the bank actually debited; the deduction is derived server-side.
    adjustVoucherAmount(id, amount) {
      return rpc('adjustVoucherAmount', { id: id, amount: amount });
    },

    // Wipes bills AND imported bank txns. The txns reference bills and, kept
    // alone, would dedupe-block re-importing old statements. Parties stay.
    deleteAllBills() { return rpc('deleteAllBills'); },

    applyImport(payload) {
      return rpc('applyImport', {
        matches: payload.matches || [],
        unmatchedTxns: payload.unmatchedTxns || []
      });
    }
  };
})();
