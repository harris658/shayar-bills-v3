(function () {
  'use strict';
  globalThis.STB = globalThis.STB || {};
  const client = supabase.createClient(STB.config.SUPABASE_URL, STB.config.SUPABASE_ANON_KEY);

  STB.db = {
    client,
    async signIn(email, password) {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return data.session;
    },
    async signOut() { await client.auth.signOut(); },
    async getSession() {
      const { data } = await client.auth.getSession();
      return data.session || null;
    },
    async listParties() {
      const { data, error } = await client.from('parties').select('*').order('name');
      if (error) throw error;
      return data;
    },
    async createParty(name) {
      const { data, error } = await client.from('parties')
        .insert({ name: name.trim() }).select().single();
      if (error) throw error;
      return data;
    },
    async listBills() {
      const { data, error } = await client.from('bills').select('*')
        .order('bill_date', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    async createBill(bill) {
      const { data, error } = await client.from('bills').insert(bill).select().single();
      if (error) throw error;
      return data;
    },
    async markPaid(id, { payment_ref, payment_date }) {
      const { error } = await client.from('bills')
        .update({ status: 'paid', payment_ref: payment_ref || '', payment_date })
        .eq('id', id);
      if (error) throw error;
    },
    async deleteBill(id) {
      const { error } = await client.from('bills').delete().eq('id', id);
      if (error) throw error;
    },
    async listBankTxns() {
      const { data, error } = await client.from('bank_txns').select('*');
      if (error) throw error;
      return data;
    },
    async applyImport({ matches, unmatchedTxns }) {
      for (const m of matches) {
        const { error } = await client.from('bank_txns')
          .insert({ ...m.txn, matched_bill_id: m.bill_id });
        if (error) throw error;
        await this.markPaid(m.bill_id, {
          payment_ref: m.txn.ref, payment_date: m.txn.txn_date
        });
      }
      if (unmatchedTxns.length) {
        const { error } = await client.from('bank_txns')
          .insert(unmatchedTxns.map((t) => ({ ...t, matched_bill_id: null })));
        if (error) throw error;
      }
    }
  };
})();
