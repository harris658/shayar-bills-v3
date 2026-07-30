(function () {
  'use strict';
  globalThis.STB = globalThis.STB || {};

  /**
   * Last-known-good snapshot, kept in localStorage so the app can paint a real
   * ledger before the network is touched.
   *
   * Apps Script answers every request in ~1.5-3s regardless of how little it
   * reads — a no-op `ping` costs 1.4s, because every POST to /exec is a 302 to
   * googleusercontent.com (two round trips) plus a fresh V8 container start.
   * That floor cannot be tuned away server-side, so the only lever left is not
   * making the user wait behind it. Without this cache the dashboard renders
   * zeros for 2.5s on every load, which is indistinguishable from an empty
   * ledger (a real bug this project shipped once already).
   *
   * The cache is an optimisation and never a source of truth: STB.refresh()
   * overwrites it with the server's copy on every successful snapshot, and
   * every read is defensive — malformed, foreign, or unreadable storage
   * returns null rather than throwing into boot.
   */

  const KEY = 'stb.snapshot.v1';

  // Same seam auth.js uses, so tests can swap storage between cases.
  function storage() {
    return (STB.env && STB.env.storage) || globalThis.localStorage;
  }

  STB.cache = {
    /**
     * Returns {parties, bills, at} written by `email`, or null.
     *
     * Scoped by email deliberately: two allowed users share this app, and
     * signing in as the second must never paint the first one's ledger. A
     * mismatch is left in place rather than cleared — it is that other user's
     * cache, and this user's first refresh overwrites it anyway.
     */
    read(email) {
      if (!email) return null;
      let raw;
      try {
        raw = storage().getItem(KEY);
      } catch (e) {
        return null; // storage disabled entirely (Safari private mode)
      }
      if (!raw) return null;

      let o;
      try {
        o = JSON.parse(raw);
      } catch (e) {
        this.clear();
        return null;
      }
      if (!o || typeof o !== 'object' || o.email !== email) return null;
      if (!Array.isArray(o.parties) || !Array.isArray(o.bills)) {
        this.clear();
        return null;
      }
      return { parties: o.parties, bills: o.bills, at: Number(o.at) || 0 };
    },

    /** Returns true when the snapshot was stored. Failure is never fatal. */
    write(email, parties, bills) {
      if (!email) return false;
      try {
        storage().setItem(KEY, JSON.stringify({
          email: email,
          at: Date.now(),
          parties: parties || [],
          bills: bills || []
        }));
        return true;
      } catch (e) {
        // Over quota, or storage unavailable. Losing the cache must never
        // break the save that triggered the write.
        return false;
      }
    },

    clear() {
      try {
        storage().removeItem(KEY);
      } catch (e) { /* nothing to clean up */ }
    }
  };
})();
