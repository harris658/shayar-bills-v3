/**
 * Drives harness.html through the whole invoice → voucher → adjustment path:
 * recording an invoice, turning a selection into one debit voucher, what that
 * voucher prints, the deduction Avinash makes at payment time, and the two
 * dashboard figures staying independent.
 *
 * Also covers the race that matters with two people on one Sheet: an invoice
 * vouchered elsewhere while these ticks were sitting on screen.
 *
 * Serve the app root first:  python3 -m http.server 8791
 * Then:                      node scripts/verify-invoices-ui.mjs
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
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 }, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

const SETTLE = 2400; // one harness round trip (2000ms) plus slack

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.STB && STB.store.loaded, null, { timeout: 8000 });
await page.evaluate(() => document.getElementById('hz').remove());

const go = async (hash) => {
  await page.evaluate((h) => STB.nav(h), hash);
  await page.waitForTimeout(250);
};

// ---------------------------------------------------------------- record ---
await go('#/invoices');
check('the invoices screen renders both cards',
  (await page.locator('#inv-save').count()) === 1 &&
  (await page.locator('#v-create').count()) === 1);

await page.fill('#f-party', 'Alpha Fab');
await page.waitForTimeout(200);
check('typing filters the party list', (await page.locator('.drop-item').count()) >= 1);
await page.locator('.drop-item').first().click();
await page.waitForTimeout(200);
check('picking a party fills the field and moves to the invoice number',
  (await page.inputValue('#f-party')) === 'Alpha Fabrics');
await page.fill('#f-no', 'JFPS26-27-000999');
await page.fill('#f-amount', '5000');
await page.fill('#f-date', '2026-07-30');
await page.click('#inv-save');

const optimistic = await page.evaluate(() => {
  const inv = STB.store.invoices.find((i) => i.invoice_no === 'JFPS26-27-000999');
  return inv ? { status: inv.status, pending: STB.isPending(inv.id) } : null;
});
check('a new invoice appears immediately, before the server answers',
  optimistic && optimistic.status === 'unallocated' && optimistic.pending === true,
  JSON.stringify(optimistic));

check('the form keeps the party and clears what changes per invoice',
  (await page.inputValue('#f-no')) === '' &&
  (await page.inputValue('#f-amount')) === '' &&
  (await page.inputValue('#f-party')) !== '');

await page.waitForTimeout(SETTLE);
check('the invoice reached the server',
  await page.evaluate(() => window.HZ.server.invoices
    .some((i) => i.invoice_no === 'JFPS26-27-000999' && i.amount === 5000)));
check('the provisional row was swapped for the server row',
  await page.evaluate(() => {
    const inv = STB.store.invoices.find((i) => i.invoice_no === 'JFPS26-27-000999');
    return inv && !STB.isPending(inv.id);
  }));

// --------------------------------------------------------- new party inline ---
// A new vendor's first invoice has to be enterable without leaving the screen.
await page.fill('#f-party', 'Gamma Mills');
await page.waitForTimeout(200);
const createLabel = await page.locator('.drop-item.create').innerText();
check('an unknown name offers "+ Create", exactly as New Bill does',
  /\+ Create/.test(createLabel) && createLabel.includes('Gamma Mills'), createLabel);
await page.locator('.drop-item.create').click();
await page.waitForTimeout(SETTLE);
check('the party is created on the server',
  await page.evaluate(() => window.HZ.server.parties.some((p) => p.name === 'Gamma Mills')));
check('the new party ends up in the field with the dropdown closed',
  await page.evaluate(() => {
    const p = STB.store.parties.find((x) => x.name === 'Gamma Mills');
    return !!p && document.querySelector('#f-party').value === 'Gamma Mills' &&
      document.querySelector('#party-drop').hidden;
  }));

// An invoice against the brand-new party must save like any other.
await page.fill('#f-no', 'GM-0001');
await page.fill('#f-amount', '1500');
await page.click('#inv-save');
await page.waitForTimeout(SETTLE);
check('an invoice saves against the newly created party',
  await page.evaluate(() => {
    const p = window.HZ.server.parties.find((x) => x.name === 'Gamma Mills');
    return window.HZ.server.invoices.some((i) => i.invoice_no === 'GM-0001' && i.party_id === p.id);
  }));

// Typing a name that already exists should pick it, not round-trip to be told off.
const partiesBefore = await page.evaluate(() => window.HZ.server.parties.length);
await page.fill('#f-party', 'alpha fabrics');   // different case on purpose
await page.waitForTimeout(250);
check('an existing name offers no "+ Create", so no duplicate can be made',
  (await page.locator('.drop-item.create').count()) === 0);
await page.fill('#f-no', 'DUP-CHECK');
await page.fill('#f-amount', '1');
await page.click('#inv-save');
await page.waitForTimeout(SETTLE);
check('saving on a typed existing name reuses that party, case and all',
  await page.evaluate((n) => {
    const alpha = STB.store.parties.find((x) => x.name === 'Alpha Fabrics');
    const inv = window.HZ.server.invoices.find((i) => i.invoice_no === 'DUP-CHECK');
    return window.HZ.server.parties.length === n && inv && inv.party_id === alpha.id;
  }, partiesBefore));

// Drop the probe invoice again so the counts below describe the pool this test
// actually set up, rather than carrying a ₹1 artefact through every later sum.
await page.evaluate(async () => {
  const inv = STB.store.invoices.find((i) => i.invoice_no === 'DUP-CHECK');
  await STB.db.deleteInvoice(inv.id);
  await STB.refresh();
});
await page.waitForTimeout(SETTLE);

// Leave the field on Alpha Fabrics for the builder section below.
await page.fill('#f-party', 'Alpha Fabrics');

// ------------------------------------------------------------ build a voucher
await page.selectOption('#v-party', { label: 'Alpha Fabrics' });
await page.waitForTimeout(150);
check('the builder lists only that party\'s unallocated invoices',
  (await page.locator('#v-create').isDisabled()) === true &&
  (await page.locator('tbody tr[data-id]').count()) === 3,
  'rows: ' + (await page.locator('tbody tr[data-id]').count()));

// Tick the two ₹10,000 invoices, leaving the ₹5,000 one behind — the point of
// the screen is that only some invoices are paid this month.
await page.locator('input.sel[data-id="i-1"]').check();
await page.locator('input.sel[data-id="i-2"]').check();
await page.waitForTimeout(150);
const totalText = await page.locator('#v-create').locator('xpath=..').innerText();
check('the running total sums only the ticked invoices',
  /2\s*selected/.test(totalText) && /₹20,000/.test(totalText),
  totalText.replace(/\n/g, ' | '));

await page.fill('#v-date', '2026-08-01');
await page.click('#v-create');
check('the create button locks while the voucher is being written',
  (await page.locator('#v-create').isDisabled()) === true);
await page.waitForTimeout(SETTLE);

const voucher = await page.evaluate(() => {
  const b = STB.store.bills.find((x) => x.invoice_ids && x.invoice_ids.split(',').length === 2);
  return b || null;
});
check('the voucher totals the invoices server-side',
  voucher && voucher.amount === 20000 && voucher.invoice_total === 20000,
  JSON.stringify(voucher && { amount: voucher.amount, total: voucher.invoice_total }));
check('the narration is the invoice numbers, comma separated',
  voucher && voucher.note === 'INVOICE NO.- JFPS26-27-000168, JFPS26-27-000154',
  voucher && voucher.note);
check('the breakdown is a + chain the pad can itemise',
  voucher && voucher.amount_expr === '10000+10000', voucher && voucher.amount_expr);
check('the spent invoices are marked allocated, the untouched one is not',
  await page.evaluate(() => {
    const s = window.HZ.server.invoices;
    const spent = s.filter((i) => i.status === 'allocated').map((i) => i.id).sort();
    const free = s.find((i) => i.invoice_no === 'JFPS26-27-000999');
    return JSON.stringify(spent) === JSON.stringify(['i-1', 'i-2']) && free.status === 'unallocated';
  }));
check('the app lands on the bills list', page.url().includes('#/bills'));

// ------------------------------------------------------------------- print ---
await page.evaluate((id) => { STB.printSelection = [id]; STB.nav('#/print/vouchers'); }, voucher.id);
await page.waitForTimeout(300);
const itemLines = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.dv-items tr'))
    .map((tr) => tr.querySelector('.dv-rs') && tr.querySelector('.dv-rs').textContent.trim())
    .filter((t) => t && /\d/.test(t)));
check('the printed voucher itemises both invoice amounts and totals them',
  itemLines.join('|') === '10,000|10,000|20,000', itemLines.join('|'));
check('the printed narration carries both invoice numbers',
  (await page.locator('.dv-narr-txt').first().innerText())
    .includes('JFPS26-27-000168, JFPS26-27-000154'));

// -------------------------------------------------------------- adjustment ---
// The voucher amount edit is a real dialog now (js/lib/adjust-modal.js), not a
// prompt() — drive it the same way a person would: click Edit, wait for the
// backdrop, read the hint and the seeded amount, fill, Save.
await go('#/bills');
await page.locator(`.edit[data-id="${voucher.id}"]`).click();
await page.waitForSelector('.modal-back', { timeout: 3000 });
const adjust = await page.evaluate(() => ({
  hint: (document.querySelector('.modal-back p.hint:not(.modal-party)') || {}).textContent || '',
  def: document.querySelector('#m-amt').value
}));
check('the adjustment modal shows what the invoices came to',
  /Invoices total/.test(adjust.hint) && /₹20,000/.test(adjust.hint) &&
  adjust.def === '20000', JSON.stringify(adjust));
await page.locator('#m-amt').fill('19500');
await page.locator('#m-save').click();
await page.waitForTimeout(150);

const afterAdjust = await page.evaluate((id) => {
  const b = STB.store.bills.find((x) => x.id === id);
  const row = document.querySelector(`tr[data-id="${id}"]`);
  return { amount: b.amount, adjustment: b.adjustment, shown: row ? row.innerText : '' };
}, voucher.id);
check('the deduction is derived, not typed',
  afterAdjust.amount === 19500 && afterAdjust.adjustment === 500,
  JSON.stringify({ amount: afterAdjust.amount, adjustment: afterAdjust.adjustment }));
check('the row shows what was billed against what was paid',
  /19,500/.test(afterAdjust.shown) && /20,000 less ₹500/.test(afterAdjust.shown),
  afterAdjust.shown.replace(/\n/g, ' | '));

await page.waitForTimeout(SETTLE);
check('the adjustment reached the server with all three figures intact',
  await page.evaluate((id) => {
    const b = window.HZ.server.bills.find((x) => x.id === id);
    return b.amount === 19500 && b.invoice_total === 20000 && b.adjustment === 500;
  }, voucher.id));

// -------------------------------------------------------------- dashboard ---
await go('#/dashboard');
const tiles = await page.evaluate(() => Array.from(document.querySelectorAll('.stat'))
  .map((el) => el.innerText.replace(/\n/g, ' ')));
check('the dashboard shows both figures, separately',
  tiles.some((t) => /To pay/.test(t)) && tiles.some((t) => /Awaiting voucher/.test(t)),
  tiles.join('  //  '));
const figures = await page.evaluate(() => ({
  toPay: STB.ledger.totals(STB.store.bills, null).toPay,
  awaiting: STB.ledger.unallocatedInvoiceTotal(STB.store.invoices)
}));
// Awaiting = ₹2,500 (the other party's seeded invoice) + ₹5,000 (left unticked)
// + ₹1,500 (entered against the newly created party). The ₹20,000 that became a
// voucher is in toPay instead, which is the whole point of keeping them apart.
check('vouchered money left the awaiting pool and none of it is counted twice',
  figures.awaiting === 9000 && figures.toPay === 36300,
  JSON.stringify(figures));

// ------------------------------------------------- editing / locking an invoice
await go('#/invoices');
await page.selectOption('#v-party', { label: 'Alpha Fabrics' });
await page.waitForTimeout(150);
const freeId = await page.evaluate(() =>
  STB.store.invoices.find((i) => i.invoice_no === 'JFPS26-27-000999').id);
await page.locator(`.inv-edit[data-id="${freeId}"]`).click();
await page.fill('.e-amount', '5500');
await page.click('.e-save');
await page.waitForTimeout(SETTLE);
check('an invoice not yet on a voucher can be corrected in place',
  await page.evaluate((id) => window.HZ.server.invoices.find((i) => i.id === id).amount === 5500,
    freeId));

await page.check('#v-showall');
await page.waitForTimeout(150);
check('an invoice already on a voucher offers no edit or delete',
  (await page.locator('.inv-edit[data-id="i-1"]').count()) === 0 &&
  (await page.locator('input.sel[data-id="i-1"]').count()) === 0);

// ------------------------------------------------------- the two-people race ---
await page.uncheck('#v-showall');
await page.waitForTimeout(150);
await page.locator(`input.sel[data-id="${freeId}"]`).check();
await page.waitForTimeout(150);
// Someone else vouchers it from another device while these ticks sit on screen.
await page.evaluate((id) => {
  const inv = window.HZ.server.invoices.find((i) => i.id === id);
  inv.status = 'allocated'; inv.bill_id = 'elsewhere';
}, freeId);
await page.click('#v-create');
await page.waitForTimeout(SETTLE);
const toast = await page.evaluate(() => {
  const t = document.getElementById('toast');
  return t && !t.hidden ? t.textContent : '';
});
check('a stale selection is refused with the real reason, not "check connection"',
  /already on a voucher/.test(toast), toast);
check('nothing was written for the refused selection',
  await page.evaluate(() => !window.HZ.server.bills.some((b) => b.bill_date === '2026-08-02')));
await page.waitForTimeout(SETTLE);
check('the ticks are dropped and the pool re-fetched, not left describing stale rows',
  await page.evaluate(() =>
    document.querySelectorAll('input.sel:checked').length === 0 &&
    STB.store.invoices.find((i) => i.bill_id === 'elsewhere').status === 'allocated'));

// The stale-selection case above logs its refusal on purpose — that console
// error IS the behaviour under test. Everything else must be silent.
const deliberate = errs.filter((e) => /already on a voucher/.test(e));
check('the refusal was logged for debugging, once', deliberate.length === 1);
check('no unexpected page errors', errs.length === deliberate.length,
  errs.filter((e) => !/already on a voucher/.test(e)).join(' | '));

console.log('\n' + '='.repeat(64));
console.log(`PASS ${pass.length}   FAIL ${fail.length}`);
await browser.close();
process.exit(fail.length ? 1 : 0);
