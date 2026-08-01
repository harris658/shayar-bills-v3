(function () {
  'use strict';
  globalThis.STB = globalThis.STB || {};

  /**
   * The party type-ahead: filter as you type, arrow keys, and "+ Create …" when
   * what you typed is not a party yet.
   *
   * Lifted out of the New Bill form so the invoice form can have the same
   * field. One implementation, two call sites — a second copy would look
   * identical on the day it was written and drift the first time either screen
   * changed.
   */

  const MAX_SUGGESTIONS = 6;

  /** Substring match, capped. Empty query offers nothing — the list is long. */
  function filterParties(parties, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    return parties.filter((p) => p.name.toLowerCase().includes(q)).slice(0, MAX_SUGGESTIONS);
  }

  /** The party whose name is exactly what was typed, ignoring case, or null. */
  function exactParty(parties, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return null;
    return parties.find((p) => p.name.trim().toLowerCase() === q) || null;
  }

  /**
   * Wires an <input> and a dropdown container together.
   *
   * opts.input    — the text input
   * opts.drop     — empty container the suggestions render into
   * opts.onPick   — called with the party once chosen or created
   * opts.onEnter  — optional; called when Enter is pressed on an exact match
   *
   * Returns { exact() } so a caller's save path can ask what is currently
   * typed without reaching back into the DOM.
   */
  function attach(opts) {
    const input = opts.input;
    const drop = opts.drop;
    const U = STB.util;
    let hi = 0;        // highlighted suggestion
    let picking = false;

    const parties = () => STB.store.parties;
    const matches = () => filterParties(parties(), input.value);
    const exact = () => exactParty(parties(), input.value);
    const canCreate = () => Boolean(input.value.trim()) && !exact();

    function renderDrop() {
      const m = matches();
      const items = m.map((p, i) =>
        `<div class="drop-item${i === hi ? ' hi' : ''}" data-i="${i}">${
          U.escapeHTML(p.name)}</div>`);
      if (canCreate()) items.push(
        `<div class="drop-item create${hi === m.length ? ' hi' : ''}" data-i="${m.length}">+ Create “${
          U.escapeHTML(input.value.trim())}”</div>`);
      drop.innerHTML = items.join('');
      drop.hidden = items.length === 0;
    }

    async function pick(i) {
      if (picking) return;
      const m = matches();
      let party;
      if (i < m.length) {
        party = m[i];
        input.value = party.name;
      } else {
        picking = true;
        try {
          // Not optimistic: whatever is being saved needs the server's party
          // id, and a temporary one would have to be threaded through and
          // fixed up on both records afterwards — two reconciliations racing.
          party = await STB.db.createParty(input.value.trim());
          STB.store.parties.push(party);
          STB.store.parties.sort((a, b) => a.name.localeCompare(b.name));
          input.value = party.name;
          STB.toast('Party created ✓');
        } catch (e) {
          console.error('createParty failed', e);
          // The server's own reason — "party already exists" is a real outcome
          // (added from another device) and is not a connection problem.
          STB.toast(String((e && e.message) || 'Could not create party'));
          return;
        } finally {
          picking = false;
        }
      }
      drop.hidden = true;
      if (opts.onPick) opts.onPick(party);
    }

    input.addEventListener('input', () => { hi = 0; renderDrop(); });
    input.addEventListener('keydown', (e) => {
      const total = matches().length + (canCreate() ? 1 : 0);
      if (e.key === 'ArrowDown') { hi = Math.min(hi + 1, total - 1); renderDrop(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { hi = Math.max(hi - 1, 0); renderDrop(); e.preventDefault(); }
      else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const hit = exact();
        if (hit) {
          drop.hidden = true;
          if (opts.onPick) opts.onPick(hit);
          if (opts.onEnter) opts.onEnter(hit);
        } else if (total > 0) {
          pick(hi);
        }
      }
    });
    // mousedown, not click: blur fires first on a click and would hide the
    // dropdown before the selection registered.
    drop.addEventListener('mousedown', (e) => {
      const item = e.target.closest('.drop-item');
      if (item) { e.preventDefault(); pick(Number(item.dataset.i)); }
    });
    input.addEventListener('blur', () => setTimeout(() => { drop.hidden = true; }, 150));

    return { exact: exact };
  }

  STB.partyPicker = { attach, filterParties, exactParty };
})();
