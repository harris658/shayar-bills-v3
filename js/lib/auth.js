(function () {
  'use strict';
  globalThis.STB = globalThis.STB || {};

  const KEY = 'stb.idToken';
  // Renew a minute early rather than racing the expiry mid-request.
  const SKEW_MS = 60000;

  // Read lazily so tests can swap the storage between cases.
  function storage() {
    return (STB.env && STB.env.storage) || globalThis.localStorage;
  }

  // Same seam for the Google SDK, so tests can fake google.accounts.id
  // instead of loading the real script.
  function google() {
    return (STB.env && STB.env.google) || globalThis.google;
  }

  // Injectable so tests don't have to wait out a real timer. prompt() either
  // surfaces quickly or not at all, so the default is kept short — every
  // extra second here is dead time on the exact path a returning user
  // notices (see task-6 review round 3).
  function renewTimeoutMs() {
    return (STB.env && STB.env.renewTimeoutMs) || 3000;
  }

  function claims(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    try {
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(b64));
    } catch (e) {
      return null;
    }
  }

  let renewing = null;

  STB.auth = {
    claims: claims,

    get() { return storage().getItem(KEY); },
    set(token) { storage().setItem(KEY, token); },
    clear() { storage().removeItem(KEY); },

    valid(token) {
      const t = token === undefined ? this.get() : token;
      const c = claims(t);
      if (!c || !c.exp) return false;
      return c.exp * 1000 - SKEW_MS > Date.now();
    },

    session() {
      const t = this.get();
      if (!this.valid(t)) return null;
      const c = claims(t);
      return { email: c.email || '', name: c.name || '' };
    },

    /** Resolves to a usable token, renewing silently if needed. */
    ensureFresh() {
      if (this.valid()) return Promise.resolve(this.get());
      return this.renew();
    },

    /**
     * Google ID tokens last an hour. Silent renewal works when the user has
     * one Google account signed into this browser and has consented before.
     * It fails with multiple accounts or blocked third-party cookies — the
     * caller falls back to showing the sign-in button.
     */
    renew() {
      if (renewing) return renewing;
      renewing = new Promise((resolve, reject) => {
        const g = google();
        const gsi = g && g.accounts && g.accounts.id;
        if (!gsi) { reject(new Error('session expired')); return; }
        const timer = setTimeout(() => reject(new Error('session expired')), renewTimeoutMs());
        gsi.initialize({
          client_id: STB.config.GOOGLE_CLIENT_ID,
          auto_select: true,
          callback: (res) => {
            clearTimeout(timer);
            if (res && res.credential) {
              STB.auth.set(res.credential);
              resolve(res.credential);
            } else {
              reject(new Error('session expired'));
            }
          }
        });
        gsi.prompt();
      }).finally(() => { renewing = null; });
      return renewing;
    },

    /** Renders Google's own sign-in button into el and resolves when signed in. */
    renderButton(el) {
      return new Promise((resolve, reject) => {
        const g = google();
        const gsi = g && g.accounts && g.accounts.id;
        if (!gsi) { reject(new Error('Google sign-in failed to load')); return; }
        gsi.initialize({
          client_id: STB.config.GOOGLE_CLIENT_ID,
          callback: (res) => {
            if (res && res.credential) {
              STB.auth.set(res.credential);
              resolve(res.credential);
            } else {
              reject(new Error('sign-in cancelled'));
            }
          }
        });
        gsi.renderButton(el, { theme: 'outline', size: 'large', width: 320 });
      });
    },

    signOut() {
      this.clear();
      const g = google();
      const gsi = g && g.accounts && g.accounts.id;
      if (gsi) gsi.disableAutoSelect();
    }
  };
})();
