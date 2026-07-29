(function () {
  'use strict';
  globalThis.STB = globalThis.STB || {};
  STB.screens = STB.screens || {};

  STB.screens.login = {
    render(root, expired) {
      root.innerHTML = `
        <div class="card" style="max-width:380px;margin:60px auto;text-align:center">
          <h2 style="margin-top:0">Shayar Tex — Bills</h2>
          <p class="hint" id="l-msg">${expired
            ? 'Session expired — sign in again to continue.'
            : 'Sign in with your Google account.'}</p>
          <div id="l-btn" style="display:flex;justify-content:center;margin:16px 0"></div>
          <p class="hint" id="l-err"></p>
        </div>`;
      const err = root.querySelector('#l-err');
      STB.db.signIn(root.querySelector('#l-btn'))
        .then(() => { location.hash = '#/dashboard'; STB.boot(); })
        .catch((e) => { err.textContent = 'Sign-in failed: ' + (e.message || e); });
    }
  };
})();
