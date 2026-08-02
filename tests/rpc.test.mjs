import test from 'node:test';
import assert from 'node:assert/strict';

const calls = [];
let nextResponses = [];

function fakeFetch(url, opts) {
  calls.push({ url, opts });
  const body = nextResponses.shift();
  if (body === undefined) throw new Error('fakeFetch: no queued response');
  return Promise.resolve({ json: () => Promise.resolve(body) });
}

// A misconfigured deployment answers 200 with an HTML login page, not JSON —
// this fake mirrors that: .json() throws, exactly like the real body's
// SyntaxError on '<html>...'.
function fakeFetchNonJson(url, opts) {
  calls.push({ url, opts });
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON at position 0'))
  });
}

globalThis.STB = {
  env: { fetch: fakeFetch },
  config: { APPS_SCRIPT_URL: 'https://script.example/exec' },
  auth: {
    _token: 'tok-123',
    ensureFresh() { return Promise.resolve(this._token); },
    get() { return this._token; }
  }
};
await import('../js/lib/db.js');
const db = globalThis.STB.db;

function reset(...responses) {
  calls.length = 0;
  nextResponses = responses;
}

test('a call posts action and args as text/plain', async () => {
  reset({ ok: true, data: { id: 'p1', name: 'Rajesh' } });
  const out = await db.createParty('Rajesh');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://script.example/exec');
  assert.equal(calls[0].opts.method, 'POST');
  // Apps Script does not answer CORS preflight; application/json fails every call.
  assert.equal(calls[0].opts.headers['Content-Type'], 'text/plain;charset=utf-8');

  const sent = JSON.parse(calls[0].opts.body);
  assert.equal(sent.action, 'createParty');
  assert.deepEqual(sent.args, { name: 'Rajesh' });
  assert.equal(sent.idToken, 'tok-123');
  assert.deepEqual(out, { id: 'p1', name: 'Rajesh' });
});

test('an ok:false response throws with the server error', async () => {
  reset({ ok: false, error: 'party already exists: Rajesh' });
  await assert.rejects(() => db.createParty('Rajesh'), /party already exists/);
});

test('a busy error retries exactly once and then succeeds', async () => {
  reset({ ok: false, error: 'busy' }, { ok: true, data: { ok: true } });
  const out = await db.deleteBill('b1');
  assert.equal(calls.length, 2);
  assert.deepEqual(out, { ok: true });
});

test('a second busy error gives up rather than looping', async () => {
  reset({ ok: false, error: 'busy' }, { ok: false, error: 'busy' });
  await assert.rejects(() => db.deleteBill('b1'), /busy/);
  assert.equal(calls.length, 2);
});

test('markPaid sends id, ref and date in one call', async () => {
  reset({ ok: true, data: { ok: true } });
  await db.markPaid('b7', { payment_ref: 'UTR9', payment_date: '2026-02-05' });
  const sent = JSON.parse(calls[0].opts.body);
  assert.equal(sent.action, 'markPaid');
  assert.deepEqual(sent.args, { id: 'b7', payment_ref: 'UTR9', payment_date: '2026-02-05' });
});

test('updateBillAmount sends id, amount and expression in one call', async () => {
  reset({ ok: true, data: { ok: true, id: 'b7', amount: 2050, amount_expr: '1200+850' } });
  await db.updateBillAmount('b7', 2050, '1200+850');
  const sent = JSON.parse(calls[0].opts.body);
  assert.equal(calls.length, 1);
  assert.equal(sent.action, 'updateBillAmount');
  assert.deepEqual(sent.args, { id: 'b7', amount: 2050, amount_expr: '1200+850', reason: '' });
});

test('updateBillAmount sends an empty expression rather than undefined', async () => {
  reset({ ok: true, data: { ok: true } });
  await db.updateBillAmount('b7', 500);
  // undefined would drop the key from the JSON entirely and the server would
  // write "undefined" into amount_expr via String().
  assert.deepEqual(JSON.parse(calls[0].opts.body).args,
    { id: 'b7', amount: 500, amount_expr: '', reason: '' });
});

test('updateBillAmount surfaces the server refusing a paid bill', async () => {
  reset({ ok: false, error: 'bill is already marked paid — delete and re-enter it' });
  await assert.rejects(() => db.updateBillAmount('b7', 100), /already marked paid/);
});

test('applyImport is one call carrying every match and unmatched txn', async () => {
  reset({ ok: true, data: { applied: 2, txns: 3 } });
  const payload = {
    matches: [
      { txn: { ref: 'A', amount: 10, txn_date: '2026-01-01' }, bill_id: 'b1' },
      { txn: { ref: 'B', amount: 20, txn_date: '2026-01-02' }, bill_id: 'b2' }
    ],
    unmatchedTxns: [{ ref: 'C', amount: 30, txn_date: '2026-01-03' }]
  };
  await db.applyImport(payload);
  assert.equal(calls.length, 1, 'one round trip, not two per match');
  const sent = JSON.parse(calls[0].opts.body);
  assert.equal(sent.action, 'applyImport');
  assert.equal(sent.args.matches.length, 2);
  assert.equal(sent.args.unmatchedTxns.length, 1);
});

test('snapshot fetches parties and bills in a single request', async () => {
  reset({ ok: true, data: { parties: [{ id: 'p1' }], bills: [{ id: 'b1' }] } });
  const out = await db.snapshot();
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0].opts.body).action, 'snapshot');
  assert.equal(out.parties.length, 1);
  assert.equal(out.bills.length, 1);
});

test('a non-JSON response names the URL/deployment instead of a raw SyntaxError', async () => {
  reset();
  const saved = STB.env.fetch;
  STB.env.fetch = fakeFetchNonJson;
  await assert.rejects(
    () => db.listBills(),
    (err) => {
      assert.ok(!(err instanceof SyntaxError), 'must not leak the raw SyntaxError');
      assert.match(err.message, /APPS_SCRIPT_URL/);
      assert.match(err.message, /deployment/i);
      return true;
    }
  );
  STB.env.fetch = saved;
});

test('an unrenewable session rejects without hitting the network', async () => {
  reset();
  const saved = STB.auth.ensureFresh;
  STB.auth.ensureFresh = () => Promise.reject(new Error('session expired'));
  await assert.rejects(() => db.listBills(), /session expired/);
  assert.equal(calls.length, 0);
  STB.auth.ensureFresh = saved;
});

test('createInvoice sends the invoice under its own key', async () => {
  reset({ ok: true, data: { id: 'i1' } });
  const invoice = {
    party_id: 'p1', invoice_no: 'JFPS26-27-000168',
    amount: 1200, invoice_date: '2026-07-29', note: ''
  };
  await db.createInvoice(invoice);
  const sent = JSON.parse(calls[0].opts.body);
  assert.equal(sent.action, 'createInvoice');
  assert.deepEqual(sent.args, { invoice });
});

test('updateInvoice sends only the patched fields', async () => {
  reset({ ok: true, data: { ok: true } });
  await db.updateInvoice('i1', { amount: 99 });
  const sent = JSON.parse(calls[0].opts.body);
  assert.equal(sent.action, 'updateInvoice');
  assert.deepEqual(sent.args, { id: 'i1', patch: { amount: 99 } });
});

test('deleteInvoice sends the id', async () => {
  reset({ ok: true, data: { ok: true } });
  await db.deleteInvoice('i1');
  const sent = JSON.parse(calls[0].opts.body);
  assert.equal(sent.action, 'deleteInvoice');
  assert.deepEqual(sent.args, { id: 'i1' });
});

test('createVoucherFromInvoices sends no amount at all', async () => {
  reset({ ok: true, data: { id: 'b9', amount: 30 } });
  await db.createVoucherFromInvoices('p1', ['i1', 'i2', 'i3'], '2026-08-01');
  const sent = JSON.parse(calls[0].opts.body);
  assert.equal(sent.action, 'createVoucherFromInvoices');
  assert.deepEqual(sent.args, {
    party_id: 'p1', invoice_ids: ['i1', 'i2', 'i3'], bill_date: '2026-08-01'
  });
  // The server totals the invoice rows itself. Sending a client-computed
  // amount would let a stale tab voucher a selection for the wrong figure.
  assert.equal('amount' in sent.args, false);
  assert.equal('note' in sent.args, false);
});

test('createVoucherFromInvoices defaults a missing selection to empty', async () => {
  reset({ ok: false, error: 'select at least one invoice' });
  await assert.rejects(
    db.createVoucherFromInvoices('p1', undefined, ''),
    /select at least one invoice/
  );
  assert.deepEqual(JSON.parse(calls[0].opts.body).args.invoice_ids, []);
});

test('adjustVoucherAmount sends the paid figure and never the deduction', async () => {
  reset({ ok: true, data: { ok: true, amount: 29500, adjustment: 500 } });
  const out = await db.adjustVoucherAmount('b9', 29500);
  const sent = JSON.parse(calls[0].opts.body);
  assert.equal(sent.action, 'adjustVoucherAmount');
  assert.deepEqual(sent.args, { id: 'b9', amount: 29500, reason: '' });
  // adjustment is derived from invoice_total server-side, never sent.
  assert.equal('adjustment' in sent.args, false);
  assert.equal(out.adjustment, 500);
});

test("the server's refusal to edit a spent invoice surfaces as a throw", async () => {
  reset({ ok: false, error: 'invoice is on a voucher — delete the voucher to free it' });
  await assert.rejects(db.updateInvoice('i1', { amount: 5 }), /on a voucher/);
});
