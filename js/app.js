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
      if (/session expired|not signed in|not authorised/i.test(e.message || '')) {
        topbar.hidden = true;
        STB.screens.login.render(root, true);
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

  STB.boot = async function () {
    const session = await STB.db.getSession();
    if (!session) {
      topbar.hidden = true;
      // Try a silent renew before making anyone tap. Fails quietly with
      // multiple Google accounts or blocked third-party cookies.
      try {
        await STB.auth.renew();
      } catch (e) {
        STB.screens.login.render(root, false);
        return;
      }
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
    STB.boot();
  });

  STB.boot();
})();
