(function () {
  'use strict';
  globalThis.STB = globalThis.STB || {};

  /**
   * The amount edit, as a real dialog rather than a native prompt().
   *
   * Two reasons it is not a prompt: the prior-adjustment warning is the whole
   * point of the feature and a prompt cannot render it legibly, and a native
   * prompt blocks the page so hard that browser automation cannot drive it —
   * which is why this flow went unverified for so long.
   */
  function open(opts) {
    const U = STB.util;
    const o = opts || {};
    return new Promise((resolve) => {
      const back = document.createElement('div');
      back.className = 'modal-back';
      back.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true" aria-label="${U.escapeHTML(o.title || 'Edit amount')}">
          <h3>${U.escapeHTML(o.title || 'Edit amount')}</h3>
          ${o.party ? `<p class="hint modal-party">${U.escapeHTML(o.party)}</p>` : ''}
          ${o.warning ? `<div class="modal-warn">${U.escapeHTML(o.warning)}</div>` : ''}
          ${o.hint ? `<p class="hint">${U.escapeHTML(o.hint)}</p>` : ''}
          <label for="m-amt">Amount — a number, or a sum like 1200+850</label>
          <input id="m-amt" type="text" value="${U.escapeHTML(String(o.value == null ? '' : o.value))}">
          <label for="m-reason">Reason (optional)</label>
          <input id="m-reason" type="text" placeholder="short delivery, damages, rate difference…">
          <div class="modal-actions">
            <button type="button" class="btn secondary" id="m-cancel">Cancel</button>
            <button type="button" class="btn" id="m-save">Save</button>
          </div>
        </div>`;
      document.body.appendChild(back);

      const amt = back.querySelector('#m-amt');
      const reason = back.querySelector('#m-reason');
      let done = false;

      function close(result) {
        if (done) return;
        done = true;
        document.removeEventListener('keydown', onKey);
        back.remove();
        resolve(result);
      }
      function save() {
        close({ raw: amt.value.trim(), reason: reason.value.trim() });
      }
      function onKey(e) {
        if (e.key === 'Escape') close(null);
        if (e.key === 'Enter' && (e.target === amt || e.target === reason)) save();
      }

      back.querySelector('#m-cancel').addEventListener('click', () => close(null));
      back.querySelector('#m-save').addEventListener('click', save);
      // Backdrop only — a click inside the card must not dismiss a half-typed edit.
      back.addEventListener('click', (e) => { if (e.target === back) close(null); });
      document.addEventListener('keydown', onKey);

      amt.focus();
      amt.select();
    });
  }

  STB.adjustModal = { open };
})();
