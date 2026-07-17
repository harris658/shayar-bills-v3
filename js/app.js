(function () {
  'use strict';
  globalThis.STB = globalThis.STB || {};
  STB.screens = STB.screens || {};

  STB.screens.dashboard = STB.screens.dashboard || {
    render(root) { root.innerHTML = '<div class="card">Signed in ✓ — dashboard comes in Task 6.</div>'; }
  };

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
      const [parties, bills] = await Promise.all([STB.db.listParties(), STB.db.listBills()]);
      STB.store.parties = parties;
      STB.store.bills = bills;
      STB.store.loaded = true;
      STB.renderRoute();
    } catch (e) {
      console.error('refresh failed', e);
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

  function renderRoute() {
    const r = route();
    const screen = STB.screens[r.name] || STB.screens.dashboard;
    document.querySelectorAll('#main-nav a').forEach((a) => {
      a.classList.toggle('active', a.dataset.nav === r.name);
    });
    root.innerHTML = '';
    screen.render(root, r.param);
  }
  STB.renderRoute = renderRoute;

  STB.boot = async function () {
    const session = await STB.db.getSession();
    if (!session) {
      topbar.hidden = true;
      STB.screens.login.render(root);
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
    STB.boot();
  });

  STB.boot();
})();
