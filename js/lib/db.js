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
    }
  };
})();
