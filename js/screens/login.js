(function () {
  'use strict';
  globalThis.STB = globalThis.STB || {};
  STB.screens = STB.screens || {};

  STB.screens.login = {
    render(root) {
      root.innerHTML = `
        <div class="card" style="max-width:380px;margin:60px auto">
          <h2 style="margin-top:0">Shayar Tex — Bills</h2>
          <label>Email <input id="l-email" type="email" autocomplete="username"></label>
          <label>Password <input id="l-pass" type="password" autocomplete="current-password"></label>
          <p class="hint" id="l-err"></p>
          <button class="btn" id="l-btn" style="width:100%">Sign in</button>
        </div>`;
      const email = root.querySelector('#l-email');
      const pass = root.querySelector('#l-pass');
      const err = root.querySelector('#l-err');
      const go = async () => {
        err.textContent = '';
        try {
          await STB.db.signIn(email.value.trim(), pass.value);
          location.hash = '#/dashboard';
          STB.boot();
        } catch (e) {
          err.textContent = 'Sign-in failed: ' + (e.message || e);
        }
      };
      root.querySelector('#l-btn').addEventListener('click', go);
      pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      email.focus();
    }
  };
})();
