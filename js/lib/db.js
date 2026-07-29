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
      const out = await res.json();
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
    deleteBill(id) { return rpc('deleteBill', { id: id }); },

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
