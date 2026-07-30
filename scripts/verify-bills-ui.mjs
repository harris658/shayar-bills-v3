/**
 * Drives harness.html to verify the Bills screen: tick-target size, select-all
 * scoped to the filters, and the amount edit (including its rollback and the
 * server's refusal on a paid bill).
 *
 * Serve the app root first:  python3 -m http.server 8791
 * Then:                      node scripts/verify-bills-ui.mjs
 */
const PW = process.env.PLAYWRIGHT_PATH
  || '/Users/haru/Haru Cowork OS/my-moodboard/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const URL = process.env.HARNESS_URL || 'http://localhost:8791/harness.html';
const OUT = process.env.SHOT_DIR || '.';

const pass = [], fail = [];
function check(name, ok, detail) {
  (ok ? pass : fail).push(name + (detail ? '  — ' + detail : ''));
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '\n        ' + detail : ''));
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.STB && STB.store.loaded, null, { timeout: 8000 });
await page.evaluate(() => document.getElementById('hz').remove());

// A ledger with two parties and a paid row, so the party filter has something
// to narrow to and the paid-row rules can be checked.
await page.evaluate(() => {
  const mk = (o) => Object.assign({
    type: 'paid', bill_date: '2026-07-25', note: '', amount_expr: '', status: 'pending',
    payment_ref: '', payment_date: '', created_by: 'x', created_at: '2026-07-25T00:00:00Z'
  }, o);
  window.HZ.server.bills = [
    mk({ id: 'a1', party_id: 'p-1', amount: 1000, note: 'alpha one' }),
    mk({ id: 'a2', party_id: 'p-1', amount: 2000, note: 'alpha two', amount_expr: '1200+800' }),
    mk({ id: 'a3', party_id: 'p-1', amount: 3000, note: 'alpha three' }),
    mk({ id: 'b1', party_id: 'p-2', amount: 4000, note: 'beta one' }),
    mk({ id: 'b2', party_id: 'p-2', amount: 5000, note: 'beta two',
      status: 'paid', payment_ref: 'UTR-OLD', payment_date: '2026-07-26' })
  ];
  return STB.refresh();
});
await page.waitForTimeout(2500);
await page.evaluate(() => { location.hash = '#/bills'; });
await page.waitForTimeout(300);

// ---------- 1. tick target size ----------
const box = await page.evaluate(() => {
  const cb = document.querySelector('tbody .sel');
  const label = cb.closest('.sel-box');
  const cell = cb.closest('td');
  const r = (el) => { const b = el.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; };
  return { cb: r(cb), label: r(label), cell: r(cell) };
});
check('checkbox is no longer squashed by the global input width:100%',
  box.cb.w >= 16 && box.cb.w <= 24 && box.cb.h >= 16,
  'checkbox ' + box.cb.w + '×' + box.cb.h + 'px (was a few px wide)');
// Box maths is not enough here: an absolutely positioned label reported a
// plausible-looking rect while the top 12px of the cell were still dead. Assert
// on real behaviour instead — click each corner of the cell and see if the row
// actually ticks. Uses a tall row (wrapped note) because that is where the
// dead space appeared.
const cellBox = await page.locator('tbody tr:first-child td.col-sel').boundingBox();
const corners = [
  ['top-left', 3, 3], ['top-right', cellBox.width - 3, 3],
  ['bottom-left', 3, cellBox.height - 3], ['bottom-right', cellBox.width - 3, cellBox.height - 3],
  ['centre', cellBox.width / 2, cellBox.height / 2]
];
const dead = [];
for (const [name, dx, dy] of corners) {
  await page.evaluate(() => { const c = document.querySelector('tbody .sel'); c.checked = false; });
  await page.mouse.click(cellBox.x + dx, cellBox.y + dy);
  await page.waitForTimeout(120);
  if (!(await page.evaluate(() => document.querySelector('tbody .sel').checked))) dead.push(name);
}
check('every corner of the tick cell ticks the row', dead.length === 0,
  dead.length ? 'dead spots: ' + dead.join(', ') : 'all 5 probe points live');

const headBox = await page.locator('thead th.col-sel').boundingBox();
await page.evaluate(() => { const c = document.querySelector('#clear-sel'); if (c) c.click(); });
await page.waitForTimeout(150);
await page.mouse.click(headBox.x + 3, headBox.y + 3);
await page.waitForTimeout(200);
check('the header cell corner also selects all',
  await page.evaluate(() =>
    [...document.querySelectorAll('tbody .sel')].every((c) => c.checked)));

// ---------- 2. select all, scoped to the filters ----------
await page.evaluate(() => { const c = document.querySelector('#clear-sel'); if (c) c.click(); });
await page.waitForTimeout(150);
const rowCount = () => page.evaluate(() => document.querySelectorAll('tbody tr[data-id]').length);
const selCount = () => page.evaluate(() =>
  [...document.querySelectorAll('tbody .sel')].filter((c) => c.checked).length);
const printLabel = () => page.evaluate(() => document.querySelector('#print-sel').textContent.trim());

check('all 5 rows are shown with nothing selected', await rowCount() === 5 && await selCount() === 0);
check('the Print button carries no count when nothing is selected',
  !/\(/.test(await printLabel()), await printLabel());

await page.click('#sel-all');
await page.waitForTimeout(200);
check('select-all ticks every shown row', await selCount() === 5);
check('the Print button shows the count', /\(5\)/.test(await printLabel()), await printLabel());
check('the header tick is checked, not indeterminate',
  await page.evaluate(() => { const s = document.querySelector('#sel-all');
    return s.checked && !s.indeterminate; }));

// Narrow to one party. Select-all must act on the filtered rows only.
await page.evaluate(() => { const c = document.querySelector('#clear-sel'); if (c) c.click(); });
await page.waitForTimeout(150);
await page.selectOption('#f-party', { label: 'Beta Textiles' });
await page.waitForTimeout(200);
check('the party filter narrows to 2 rows', await rowCount() === 2, 'rows: ' + await rowCount());
await page.click('#sel-all');
await page.waitForTimeout(200);
check('select-all under a filter selects only the filtered rows',
  await selCount() === 2 && /\(2\)/.test(await printLabel()),
  'shown selected ' + await selCount() + ', button ' + await printLabel());

// Widen back: the 2 stay selected, and the header goes indeterminate.
await page.selectOption('#f-party', { label: 'All parties' });
await page.waitForTimeout(200);
check('selections survive a filter change', await selCount() === 2);
check('the header tick is indeterminate when only some rows are selected',
  await page.evaluate(() => { const s = document.querySelector('#sel-all');
    return s.indeterminate && !s.checked; }));

// Off-filter selections must stay visible in the count, so nothing prints unseen.
await page.selectOption('#f-party', { label: 'Alpha Fabrics' });
await page.waitForTimeout(200);
check('a selection hidden by the filter is still counted on the Print button',
  /\(2\)/.test(await printLabel()) && await selCount() === 0,
  'button ' + await printLabel() + ' with 0 of the shown rows ticked');
check('Clear selection is offered whenever anything is selected',
  await page.evaluate(() => !!document.querySelector('#clear-sel')));
await page.click('#clear-sel');
await page.waitForTimeout(200);
check('Clear selection empties everything, on-filter and off',
  !/\(/.test(await printLabel()) && await page.evaluate(() => !document.querySelector('#clear-sel')));

// Unticking the header clears just the shown rows.
await page.selectOption('#f-party', { label: 'All parties' });
await page.waitForTimeout(200);
await page.click('#sel-all');
await page.waitForTimeout(200);
await page.click('#sel-all');
await page.waitForTimeout(200);
check('unticking the header clears the shown rows', await selCount() === 0);

// ---------- 3. edit the amount ----------
check('a paid row offers no Edit button',
  await page.evaluate(() => !document.querySelector('tr[data-id="b2"] .edit')));
check('a pending row does offer Edit',
  await page.evaluate(() => !!document.querySelector('tr[data-id="a1"] .edit')));

let dialogSeen = null;
page.on('dialog', async (d) => { dialogSeen = d.defaultValue; await d.accept(dialogSeen === null ? '' : window.__reply); });
// Playwright dialogs cannot read page vars; drive prompt() directly instead.
await page.evaluate(() => { window.__prompts = []; });
async function editAmount(id, reply) {
  await page.evaluate((r) => {
    window.__realPrompt = window.prompt;
    window.prompt = (msg, def) => { window.__prompts.push({ msg: msg, def: def }); return r; };
  }, reply);
  await page.click(`tr[data-id="${id}"] .edit`);
  await page.waitForTimeout(150);
  return page.evaluate(() => {
    window.prompt = window.__realPrompt;
    return window.__prompts[window.__prompts.length - 1];
  });
}

const seeded = await editAmount('a2', '1500+700');
check('the edit prompt is seeded with the typed breakdown, not the total',
  seeded.def === '1200+800', 'prompt default: ' + seeded.def);
const optimistic = await page.evaluate(() => {
  const b = STB.store.bills.find((x) => x.id === 'a2');
  return { amount: b.amount, expr: b.amount_expr,
    shown: document.querySelector('tr[data-id="a2"] .num').textContent.trim() };
});
check('the new amount appears immediately, before the server answers',
  optimistic.amount === 2200 && optimistic.expr === '1500+700' && /2,200/.test(optimistic.shown),
  JSON.stringify(optimistic));
await page.waitForTimeout(2400);
check('the edit reached the server',
  await page.evaluate(() => window.HZ.server.bills.find((b) => b.id === 'a2').amount === 2200));
check('the edit was persisted to the cache',
  await page.evaluate(() => JSON.parse(window.HZ.cacheRaw()).bills
    .find((b) => b.id === 'a2').amount === 2200));

// A plain number must clear the stored breakdown.
const seeded2 = await editAmount('a2', '1900');
check('re-editing seeds with the current breakdown', seeded2.def === '1500+700');
await page.waitForTimeout(2400);
check('typing a plain number clears amount_expr',
  await page.evaluate(() => {
    const b = STB.store.bills.find((x) => x.id === 'a2');
    return b.amount === 1900 && b.amount_expr === '';
  }));

// Validation.
await editAmount('a1', 'abc');
check('a nonsense amount is rejected without touching the bill',
  await page.evaluate(() => STB.store.bills.find((b) => b.id === 'a1').amount === 1000));
await editAmount('a1', '0');
check('zero is rejected',
  await page.evaluate(() => STB.store.bills.find((b) => b.id === 'a1').amount === 1000));
await editAmount('a1', '-50');
check('a negative amount is rejected',
  await page.evaluate(() => STB.store.bills.find((b) => b.id === 'a1').amount === 1000));

// Cancelling the prompt, and re-entering the same value, must not send anything.
const before = await page.evaluate(() => window.HZ.log.filter((l) => l.includes('→ updateBillAmount')).length);
await editAmount('a1', null);
await editAmount('a1', '1000');
await page.waitForTimeout(300);
check('cancel and an unchanged amount both send nothing',
  await page.evaluate(() => window.HZ.log.filter((l) => l.includes('→ updateBillAmount')).length) === before);

// Rollback on failure.
await page.evaluate(() => window.HZ.failNext('updateBillAmount'));
await editAmount('a3', '7777');
check('a doomed edit still shows the new amount immediately',
  await page.evaluate(() => STB.store.bills.find((b) => b.id === 'a3').amount === 7777));
await page.waitForTimeout(2500);
check('a failed edit rolls the amount back',
  await page.evaluate(() => STB.store.bills.find((b) => b.id === 'a3').amount === 3000));
check('the rollback is visible in the DOM',
  await page.evaluate(() => /3,000/.test(document.querySelector('tr[data-id="a3"] .num').textContent)));
check('the rollback was persisted to the cache',
  await page.evaluate(() => JSON.parse(window.HZ.cacheRaw()).bills
    .find((b) => b.id === 'a3').amount === 3000));

// The server's own refusal of a paid bill must surface as its reason. Reach it
// past the UI guard, the way a second device settling the bill would.
await page.evaluate(() => {
  window.HZ.server.bills.find((b) => b.id === 'a1').status = 'paid';
});
await editAmount('a1', '4321');
await page.waitForTimeout(2500);
const refusal = await page.evaluate(() => ({
  amount: STB.store.bills.find((b) => b.id === 'a1').amount,
  toast: document.getElementById('toast').textContent
}));
check('a server refusal rolls back and reports the real reason, not "check connection"',
  refusal.amount === 1000 && /already marked paid/.test(refusal.toast),
  JSON.stringify(refusal));

await page.screenshot({ path: OUT + '/bills-screen.png', fullPage: false });

const unexpected = errs.filter((e) => !/simulated backend failure|already marked paid/.test(e));
check('no unexpected page errors', unexpected.length === 0, unexpected.slice(0, 4).join(' | '));

console.log('\n' + '='.repeat(64));
console.log('PASS ' + pass.length + '   FAIL ' + fail.length);
if (fail.length) { console.log('\nFAILURES:'); fail.forEach((f) => console.log('  ✖ ' + f)); }
await browser.close();
process.exit(fail.length ? 1 : 0);
