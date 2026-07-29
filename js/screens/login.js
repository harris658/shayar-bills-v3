(function () {
  'use strict';
  globalThis.STB = globalThis.STB || {};
  STB.screens = STB.screens || {};

  // google.accounts.id.initialize/renderButton is a global singleton — a
  // second render() call overwrites the first's callback. Guard so a stale
  // callback from a superseded render is ignored instead of acting on a
  // detached screen.
  let renderGen = 0;

  STB.screens.login = {
    // `expiredOrMessage`: true for the generic "session expired" copy, a
    // string to show the server's actual error, or falsy for a cold-start
    // greeting.
    render(root, expiredOrMessage) {
      const gen = ++renderGen;
      const message = typeof expiredOrMessage === 'string'
        ? expiredOrMessage
        : (expiredOrMessage
            ? 'Session expired — sign in again to continue.'
            : 'Sign in with your Google account.');
      root.innerHTML = `
        <div class="card" style="max-width:380px;margin:60px auto;text-align:center">
          <h2 style="margin-top:0">Shayar Tex — Bills</h2>
          <p class="hint" id="l-msg"></p>
          <div id="l-btn" style="display:flex;justify-content:center;margin:16px 0"></div>
          <p class="hint" id="l-err"></p>
        </div>`;
      root.querySelector('#l-msg').textContent = message;
      const err = root.querySelector('#l-err');
      STB.db.signIn(root.querySelector('#l-btn'))
        .then(() => {
          if (gen !== renderGen) return; // superseded by a later render
          location.hash = '#/dashboard'; STB.boot();
        })
        .catch((e) => {
          if (gen !== renderGen) return;
          err.textContent = 'Sign-in failed: ' + (e.message || e);
        });
    }
  };
})();
