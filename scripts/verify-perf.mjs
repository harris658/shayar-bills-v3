/**
 * Drives harness.html and asserts the perceived-latency behaviour that
 * `node --test` cannot see: the offline snapshot cache, the focus staleness
 * gate, and every optimistic write plus its rollback.
 *
 * Serve the app root first:  python3 -m http.server 8791
 * Then:                      node scripts/verify-perf.mjs
 *
 * There is no package.json here, so playwright is imported from wherever it
 * already lives on this machine. Override with PLAYWRIGHT_PATH if it moves.
 */
const PW = process.env.PLAYWRIGHT_PATH
  || '/Users/haru/Haru Cowork OS/my-moodboard/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);

const URL = process.env.HARNESS_URL || 'http://localhost:8791/harness.html';
const pass = [], fail = [];
function check(name, ok, detail) {
  (ok ? pass : fail).push(name + (detail ? '  — ' + detail : ''));
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '\n        ' + detail : ''));
}

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const store = () => page.evaluate(() => window.HZ.storeSummary());
const dash = () => page.evaluate(() => document.getElementById('screen-root').innerText.replace(/\s+/g, ' ').trim());
const toast = () => page.evaluate(() => {
  const t = document.getElementById('toast');
  return t.hidden ? '' : t.textContent;
});

// ============ 1. cold load: no cache, dashboard must wait on the network ====
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.HZ && window.STB, null, { timeout: 5000 });

const coldEarly = await dash();
check('cold load shows no ledger before the network answers',
  !/12,500/.test(coldEarly), 'early dashboard: ' + coldEarly.slice(0, 90));
// ITEM (empty-state bug): store.loaded is false here — this is exactly the
// window that used to render "Nothing pending 🎉" / "No bills yet." / a
// confident ₹0 over a ledger that (per HZ.server above) actually holds two
// bills. Assert the loading state instead, not the empty-state copy.
check('ITEM 1b — not-loaded dashboard shows a loading state, not the empty-state copy',
  !/Nothing pending/.test(coldEarly) && !/No bills yet\./.test(coldEarly) && /Loading/.test(coldEarly),
  'early dashboard: ' + coldEarly.slice(0, 120));
check('ITEM 1b — not-loaded dashboard does not show a confident ₹0 KPI',
  !/₹0(?!\S)/.test(coldEarly.replace(/&nbsp;| /g, ' ')), coldEarly.slice(0, 120));

await page.waitForFunction(() => STB.store.loaded === true, null, { timeout: 8000 });
await page.waitForTimeout(150);
const coldLoaded = await dash();
check('after snapshot the real ledger is on screen', /12,500|16,800/.test(coldLoaded.replace(/\s/g, '')) || /₹/.test(coldLoaded),
  coldLoaded.slice(0, 120));
check('ITEM 1b — once the snapshot lands the loading state is gone',
  !/Loading/.test(coldLoaded), coldLoaded.slice(0, 120));

const rawCache = await page.evaluate(() => window.HZ.cacheRaw());
check('ITEM 1 — snapshot was written to localStorage',
  !!rawCache && JSON.parse(rawCache).bills.length === 2,
  rawCache ? 'bills cached: ' + JSON.parse(rawCache).bills.length + ', email: ' + JSON.parse(rawCache).email : 'nothing cached');

// ============ 2. warm reload: ledger must paint BEFORE the network ==========
const t0 = Date.now();
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.HZ && window.STB && STB.store.loaded === true, null, { timeout: 5000 });
const paintMs = Date.now() - t0;
const warmEarly = await dash();
check('ITEM 1 — warm reload paints a real ledger in well under one round trip',
  paintMs < 1500, 'store.loaded at +' + paintMs + 'ms (backend latency is 2000ms)');
check('ITEM 1 — the pre-network paint is the cached ledger, not zeros',
  /₹/.test(warmEarly) && !/^0/.test(warmEarly.replace(/[^0-9]/g, '')),
  warmEarly.slice(0, 120));

// wait out the background refresh so the store is server-fresh
await page.waitForTimeout(2600);

// ============ 3. focus/visibility refresh, always (no staleness gate) ======
// Harshit's chosen fix for "the other person's open tab never updates":
// every return-to-tab refreshes, full stop. The old staleness gate (skip a
// focus refresh when the snapshot was under 60s old) is gone entirely —
// otherwise the two-person ledger can sit stale in an already-open tab
// indefinitely after the other person edits it.
async function focusCycle() {
  const before = await page.evaluate(() => window.HZ.log.filter((l) => l.includes('→ snapshot')).length);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(2400); // let the (now real) refresh land
  const after = await page.evaluate(() => window.HZ.log.filter((l) => l.includes('→ snapshot')).length);
  return after - before;
}
check('ITEM 2 — a focus on fresh data now DOES fire exactly one snapshot', (await focusCycle()) === 1);

async function visibilityCycle() {
  const before = await page.evaluate(() => window.HZ.log.filter((l) => l.includes('→ snapshot')).length);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(2400);
  const after = await page.evaluate(() => window.HZ.log.filter((l) => l.includes('→ snapshot')).length);
  return after - before;
}
check('ITEM 2 — visibilitychange (visible) also fires a snapshot', (await visibilityCycle()) === 1);

// The two listeners routinely both fire for one real tab switch. Without the
// in-flight guard on STB.refresh, that used to cost two backend round trips
// per switch instead of one.
check('ITEM 2 — focus + visibilitychange fired together collapse into ONE backend call',
  await page.evaluate(async () => {
    const before = window.HZ.log.filter((l) => l.includes('→ snapshot')).length;
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 2400));
    const after = window.HZ.log.filter((l) => l.includes('→ snapshot')).length;
    return after - before === 1;
  }));

// ============ 4. optimistic markPaid =======================================
await page.evaluate(() => { location.hash = '#/bills'; });
await page.waitForTimeout(200);
page.on('dialog', (d) => d.accept('UTR-999'));

const mpStart = Date.now();
await page.click('.mark-paid[data-id="b-1"]');
await page.waitForFunction(
  () => STB.store.bills.some((b) => b.id === 'b-1' && b.status === 'paid'), null, { timeout: 1500 });
const mpMs = Date.now() - mpStart;
const badge = await page.evaluate(() =>
  document.querySelector('tr[data-id="b-1"]').innerText.replace(/\s+/g, ' '));
check('ITEM 3 — markPaid flips the row before the server answers',
  mpMs < 1000 && /Paid/.test(badge), mpMs + 'ms; row now: ' + badge);
check('ITEM 3 — the optimistic markPaid was persisted to the cache',
  await page.evaluate(() => JSON.parse(window.HZ.cacheRaw()).bills
    .some((b) => b.id === 'b-1' && b.status === 'paid')));

await page.waitForTimeout(2400);
check('ITEM 3 — markPaid reached the server (state agrees after settle)',
  await page.evaluate(() => window.HZ.server.bills.find((b) => b.id === 'b-1').status === 'paid'));
check('ITEM 3 — markPaid fires no follow-up snapshot',
  await page.evaluate(() => !window.HZ.log.slice(0, 3).some((l) => l.includes('→ snapshot'))),
  (await page.evaluate(() => window.HZ.log.slice(0, 3).join(' / '))));

// ============ 5. markPaid rollback on failure ==============================
await page.evaluate(() => window.HZ.failNext('markPaid'));
await page.click('.mark-paid[data-id="b-2"]');
await page.waitForFunction(
  () => STB.store.bills.some((b) => b.id === 'b-2' && b.status === 'paid'), null, { timeout: 1500 });
check('ITEM 3 — a doomed markPaid still shows paid immediately', true);
await page.waitForTimeout(2500);
const rolled = await page.evaluate(() => {
  const b = STB.store.bills.find((x) => x.id === 'b-2');
  return { status: b.status, ref: b.payment_ref, date: b.payment_date };
});
check('ITEM 3 — a failed markPaid rolls the row back to pending',
  rolled.status === 'pending' && !rolled.ref && !rolled.date, JSON.stringify(rolled));
check('ITEM 3 — the rollback is visible in the DOM',
  /Pending/.test(await page.evaluate(() =>
    document.querySelector('tr[data-id="b-2"]').innerText)));
check('ITEM 3 — the rollback toast names the outcome', /revert/i.test(await toast()), await toast());
check('ITEM 3 — the rollback was persisted to the cache',
  await page.evaluate(() => JSON.parse(window.HZ.cacheRaw()).bills
    .find((b) => b.id === 'b-2').status === 'pending'));

// ============ 6. optimistic delete + rollback ==============================
const delStart = Date.now();
await page.click('.del[data-id="b-2"]');
await page.waitForFunction(() => !STB.store.bills.some((b) => b.id === 'b-2'), null, { timeout: 1500 });
check('ITEM 3 — delete removes the row before the server answers', Date.now() - delStart < 1000,
  (Date.now() - delStart) + 'ms');
await page.waitForTimeout(2400);
check('ITEM 3 — the delete reached the server',
  await page.evaluate(() => !window.HZ.server.bills.some((b) => b.id === 'b-2')));

await page.evaluate(() => {
  window.HZ.server.bills.push({ id: 'b-3', party_id: 'p-1', type: 'paid', amount: 700,
    bill_date: '2026-07-19', note: 'restore me', amount_expr: '', status: 'pending',
    payment_ref: '', payment_date: '', created_by: 'x', created_at: '2026-07-19T00:00:00Z' });
  return STB.refresh();
});
await page.waitForTimeout(2500);
await page.evaluate(() => window.HZ.failNext('deleteBill'));
await page.click('.del[data-id="b-3"]');
await page.waitForFunction(() => !STB.store.bills.some((b) => b.id === 'b-3'), null, { timeout: 1500 });
await page.waitForTimeout(2500);
check('ITEM 3 — a failed delete puts the bill back',
  await page.evaluate(() => STB.store.bills.some((b) => b.id === 'b-3')));
check('ITEM 3 — the restored bill is back in the DOM',
  await page.evaluate(() => !!document.querySelector('tr[data-id="b-3"]')));

// ============ 7. optimistic createBill (existing party) ====================
await page.evaluate(() => { location.hash = '#/new'; });
await page.waitForTimeout(250);
await page.fill('#f-party', 'Alpha Fabrics');
await page.fill('#f-amount', '1200+850');
await page.fill('#f-note', 'optimistic test');
const cbStart = Date.now();
await page.click('#save-btn');
await page.waitForFunction(() => location.hash === '#/bills', null, { timeout: 1500 });
const navMs = Date.now() - cbStart;
await page.waitForTimeout(150);
const provisional = await page.evaluate(() => {
  const b = STB.store.bills.find((x) => STB.isPending(x.id));
  return b ? { id: b.id, amount: b.amount, note: b.note, expr: b.amount_expr, status: b.status } : null;
});
check('ITEM 3 — saving against a known party lands on the bills list immediately',
  navMs < 1000, navMs + 'ms (was ~4.8s: createBill + snapshot)');
check('ITEM 3 — a provisional row is on screen with the right numbers',
  provisional && provisional.amount === 2050 && provisional.expr === '1200+850'
    && provisional.status === 'pending', JSON.stringify(provisional));
check('ITEM 3 — server actions are refused on a provisional row',
  await page.evaluate(async () => {
    const id = STB.store.bills.find((x) => STB.isPending(x.id)).id;
    const row = document.querySelector('tr[data-id="' + id + '"]');
    row.querySelector('.mark-paid').click();
    await new Promise((r) => setTimeout(r, 100));
    return /Still saving/.test(document.getElementById('toast').textContent);
  }));

await page.waitForTimeout(2500);
const reconciled = await page.evaluate(() => ({
  anyPending: STB.store.bills.some((b) => STB.isPending(b.id)),
  srv: STB.store.bills.filter((b) => String(b.id).startsWith('srv-')).length,
  serverHas: window.HZ.server.bills.filter((b) => b.amount === 2050).length
}));
check('ITEM 3 — the provisional row is swapped for the server row',
  reconciled.anyPending === false && reconciled.srv === 1 && reconciled.serverHas === 1,
  JSON.stringify(reconciled));

// ============ 8. createBill rollback ======================================
await page.evaluate(() => { location.hash = '#/new'; });
await page.waitForTimeout(250);
await page.evaluate(() => window.HZ.failNext('createBill'));
await page.fill('#f-party', 'Alpha Fabrics');
await page.fill('#f-amount', '4444');
await page.click('#save-btn');
await page.waitForFunction(() => location.hash === '#/bills', null, { timeout: 1500 });
await page.waitForTimeout(2600);
check('ITEM 3 — a failed save removes the provisional row',
  await page.evaluate(() => !STB.store.bills.some((b) => b.amount === 4444)));
check('ITEM 3 — the failure toast says the bill was not recorded',
  /NOT recorded/.test(await toast()), await toast());

// ============ 9. sign-out clears the cache ================================
await page.click('#signout-btn');
await page.waitForTimeout(400);
check('sign-out clears the cached ledger',
  (await page.evaluate(() => window.HZ.cacheRaw())) === null);
check('sign-out empties the store',
  await page.evaluate(() => STB.store.bills.length === 0 && STB.store.loaded === false));

// ============ 9b. a loaded store that is genuinely empty shows the real
// empty-state copy — the regression the loading-state fix could reintroduce
// in reverse if it hid the empty-state copy unconditionally instead of only
// while !loaded. ========================================================
await page.evaluate(() => { window.HZ.server.bills = []; });
await page.evaluate(() => document.querySelector('#l-btn button').click());
await page.waitForFunction(() => window.STB && STB.store.loaded === true, null, { timeout: 8000 });
await page.evaluate(() => { location.hash = '#/dashboard'; });
await page.waitForTimeout(150);
const emptyLoadedDash = await dash();
check('ITEM 1b — a genuinely empty, LOADED store still shows the real empty-state copy',
  /Nothing pending/.test(emptyLoadedDash) && /No bills yet\./.test(emptyLoadedDash),
  emptyLoadedDash.slice(0, 160));

// ============ 10. cache is scoped to the signed-in user ==================
await page.evaluate(() => {
  STB.cache.write('someone.else@example.com', [{ id: 'x', name: 'Ghost' }],
    [{ id: 'g', party_id: 'x', amount: 99, status: 'pending', bill_date: '2026-01-01' }]);
});
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.HZ && window.STB, null, { timeout: 5000 });
await page.waitForTimeout(300);
check("another user's cached ledger is never painted",
  await page.evaluate(() => !STB.store.bills.some((b) => b.id === 'g')),
  await page.evaluate(() => JSON.stringify(STB.store.bills.map((b) => b.id))));

// ============ 10. party detail on a cold load ==============================
// A bookmarked #/party/<id> is rendered by boot() before the first snapshot
// lands. partyById() misses against an empty store, so this route claimed
// "Party not found." for a party that demonstrably exists — a worse lie than
// the dashboard's, because it reads as data loss rather than an empty ledger.
await page.evaluate(() => {
  localStorage.removeItem('stb.snapshot.v1');
  location.hash = '#/party/p-1';
});
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.HZ && window.STB, null, { timeout: 5000 });
const partyEarly = await dash();
check('ITEM 1b — cold #/party/<id> shows Loading, not "Party not found."',
  /Loading/.test(partyEarly) && !/Party not found/.test(partyEarly),
  'early party detail: ' + partyEarly.slice(0, 120));

await page.waitForFunction(() => STB.store.loaded === true, null, { timeout: 8000 });
await page.waitForTimeout(150);
const partyLoaded = await dash();
check('ITEM 1b — party detail renders the real party once the snapshot lands',
  /Alpha Fabrics/.test(partyLoaded) && !/Party not found/.test(partyLoaded),
  partyLoaded.slice(0, 120));

// The three rollback cases deliberately reject, and the handlers are supposed
// to console.error them — those are expected. Anything else is not.
const expected = /simulated backend failure/;
const unexpected = errors.filter((e) => !expected.test(e));
check('every logged error is one of the 3 deliberate failures',
  errors.filter((e) => expected.test(e)).length === 3,
  'deliberate: ' + errors.filter((e) => expected.test(e)).length);
check('no unexpected page errors throughout', unexpected.length === 0,
  unexpected.slice(0, 4).join(' | '));

console.log('\n' + '='.repeat(64));
console.log('PASS ' + pass.length + '   FAIL ' + fail.length);
if (fail.length) { console.log('\nFAILURES:'); fail.forEach((f) => console.log('  ✖ ' + f)); }
await browser.close();
process.exit(fail.length ? 1 : 0);
