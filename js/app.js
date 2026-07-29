(function () {
  'use strict';
  globalThis.STB = globalThis.STB || {};
  STB.screens = STB.screens || {};

  const root = document.getElementById('screen-root');
  const topbar = document.getElementById('topbar');

  let toastTimer = null;
  STB.toast = function (msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
  };

  STB.store = { parties: [], bills: [], loaded: false };
  STB.partyById = (id) => STB.store.parties.find((p) => p.id === id);

  // Matches every hard auth failure the Apps Script server throws (see
  // apps-script/Auth.gs): a missing/expired token, a token minted for a
  // different client, an unverified email, and an allowlist rejection.
  const AUTH_DEAD_RE = /session expired|not signed in|not authorised|token not for this app|email not verified/i;

  STB.refresh = async function () {
    try {
      const { parties, bills } = await STB.db.snapshot();
      STB.store.parties = parties;
      STB.store.bills = bills;
      STB.store.loaded = true;
      STB.renderRoute();
    } catch (e) {
      console.error('refresh failed', e);
      // A dead session must land on the sign-in screen, not a toast that
      // leaves a stale ledger on screen looking live.
      if (AUTH_DEAD_RE.test(e.message || '')) {
        // The token can still be locally valid (e.g. an allowlist
        // rejection) — clear it so getSession() stops reporting a session
        // that the server has already refused, and so a stale route change
        // (hashchange) can't render data screens over it. signOut() (not
        // clear()) also disables auto-select, so a reload doesn't silently
        // re-mint the same rejected identity and flash the app chrome
        // before bouncing back to login.
        STB.auth.signOut();
        STB.store.loaded = false;
        topbar.hidden = true;
        renderedRoute = null;
        STB.screens.login.render(root, e.message || true);
        return;
      }
      STB.toast('Could not refresh data — check connection');
    }
  };

  window.addEventListener('focus', () => {
    if (!topbar.hidden) STB.refresh();
  });

  STB.nav = function (hash) { location.hash = hash; };

  function route() {
    // '#/party/<id>' → { name: 'party', param: '<id>' }
    const parts = (location.hash || '#/dashboard').slice(2).split('/');
    return { name: parts[0] || 'dashboard', param: parts[1] || null };
  }

  let renderedRoute = null; // route name currently reflected in #screen-root

  function renderRoute() {
    const r = route();
    // Typing in the entry form? A background refresh must not rebuild it.
    if (r.name === 'new' && root.contains(document.activeElement)
        && document.activeElement.tagName === 'INPUT') return;
    // Import mid-flow (mapping/review)? A same-route background refresh must
    // not discard tick/dropdown state — but genuine navigation TO import
    // (hash just changed from something else) must still render normally.
    if (r.name === 'import' && renderedRoute === 'import'
        && STB.screens.import && STB.screens.import.inProgress
        && STB.screens.import.inProgress()) return;
    const screen = STB.screens[r.name] || STB.screens.dashboard;
    document.querySelectorAll('#main-nav a').forEach((a) => {
      a.classList.toggle('active', a.dataset.nav === r.name);
    });
    root.innerHTML = '';
    screen.render(root, r.param);
    renderedRoute = r.name;
  }
  STB.renderRoute = renderRoute;

  function configPlaceholderPending() {
    const c = STB.config;
    if (!c) return true; // config.js failed to load entirely
    return String(c.APPS_SCRIPT_URL || '').indexOf('<PASTE') === 0
      || String(c.GOOGLE_CLIENT_ID || '').indexOf('<PASTE') === 0;
  }

  STB.boot = async function (opts) {
    opts = opts || {};
    if (configPlaceholderPending()) {
      topbar.hidden = true;
      renderedRoute = null;
      root.innerHTML = `
        <div class="card" style="max-width:380px;margin:60px auto;text-align:center">
          <h2 style="margin-top:0">Shayar Tex — Bills</h2>
          <p class="hint">Configuration not filled in yet — set APPS_SCRIPT_URL and
          GOOGLE_CLIENT_ID in js/config.js.</p>
        </div>`;
      return;
    }
    const session = await STB.db.getSession();
    if (!session) {
      // Only attempt a silent renewal when there is something to renew — a
      // stored (if expired) token — and only once per boot cycle (a skewed
      // device clock could otherwise hand back a credential valid() always
      // rejects, looping forever). A brand-new visitor has no stored token,
      // so this never runs and the sign-in button paints immediately with
      // no 8s timer anywhere near it.
      //
      // Awaiting renew() fully (success or failure) before ever rendering
      // the button, rather than racing the two, matters because
      // google.accounts.id.initialize is a global singleton: rendering the
      // button first and then calling renew() re-initializes it underneath
      // an already-visible button and silently rewires its callback (see
      // task-6 review round 2). Sequential ordering means the button's own
      // callback is always the last one registered, so a tap always works
      // regardless of when it happens.
      if (!opts.skipRenew && !opts.renewed && STB.auth.get()) {
        try { await STB.auth.renew(); } catch (e) { /* fall through to login below */ }
        return STB.boot({ renewed: true });
      }
      topbar.hidden = true;
      renderedRoute = null;
      STB.screens.login.render(root, false);
      return;
    }
    topbar.hidden = false;
    if (!location.hash || location.hash === '#/') location.hash = '#/dashboard';
    renderRoute();
    STB.refresh();
  };

  window.addEventListener('hashchange', () => {
    STB.db.getSession().then((s) => { if (s) renderRoute(); });
  });

  document.getElementById('signout-btn').addEventListener('click', async () => {
    await STB.db.signOut();
    location.hash = '';
    STB.boot({ skipRenew: true });
  });

  STB.boot();
})();
