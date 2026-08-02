# Apps Script backend

The four `.gs` files are the server for the bills app. They live in a script
project **bound to** the Shayar Tex — Bills spreadsheet (Extensions → Apps
Script from inside the Sheet), not a standalone project — `SpreadsheetApp.getActive()`
only resolves for a bound script.

## Files

| File | Contents |
| --- | --- |
| `Sheets.gs` | Header-mapped reads/writes, row lookup, `withLock_` |
| `Auth.gs` | ID token verification, allowlist |
| `Code.gs` | `doPost`, dispatch, data actions |
| `Backup.gs` | Nightly Drive copy + 30-day prune |
| `Tests.gs` | `runTests()` — run manually against a scratch copy |
| `appsscript.json` | Manifest: web app access, timezone, runtime |

The project was created and deployed through the Apps Script REST API via the
`gws` CLI (`script projects create --parentId <sheet id>`, then
`updateContent`, `versions create`, `deployments update`). Copy-paste into the
editor also works, but keep `appsscript.json` in sync either way — it carries
the web app access mode, which is load-bearing (see below).

Two steps have no API and must be done by hand, once, as the owner:

1. Enable the Apps Script API for the account at
   <https://script.google.com/home/usersettings> — a per-account toggle,
   unrelated to any GCP project setting.
2. Run any function once from the editor and click through the OAuth consent
   ("Advanced" → "Go to … (unsafe)" → "Allow"). Until then every request to
   the deployment answers 401. The editor's function dropdown only populates
   for the file currently open, and may stay empty for `Sheets.gs`; open
   `Code.gs` and run `doPost` — the consent prompt covers the whole project.

## Spreadsheet layout

Columns are located by header text (`table_()` in `Sheets.gs`), not position —
but the header text itself is load-bearing: rename or misspell one and the
tab silently stops working. This list is the only copy of the schema in this
repo; it is cross-checked against `Sheets.gs`, `Code.gs`, `Auth.gs`, and
`scripts/backup-to-sheet.mjs`'s `HEADERS` constant, which must always agree
with it.

| Tab | Columns (A → …), in order |
| --- | --- |
| `parties` | id, name, phone, notes, created_at |
| `bills` | id, party_id, type, amount, bill_date, note, amount_expr, status, payment_ref, payment_date, created_by, created_at, invoice_total, adjustment, invoice_ids, original_amount, adjusted_at, adjusted_by, adjustment_reason |
| `invoices` | id, party_id, invoice_no, amount, invoice_date, note, status, bill_id, created_by, created_at |
| `bank_txns` | id, txn_date, amount, ref, description, matched_bill_id, imported_at |
| `allowed_users` | email, name, active |

`invoices` holds GRC PIs as they are raised, before anyone knows which will be
paid. `status` is `unallocated` until some of them are turned into one debit
voucher, at which point each carries the `bill_id` of that voucher and the
voucher carries their ids in `invoice_ids`. The `invoice_total`, `adjustment`,
`invoice_ids` columns are blank on every row that predates the feature and on
every bill entered by hand — that blank *is* the "not invoice-derived" state,
and nothing backfills it.

The last four `bills` columns — `original_amount`, `adjusted_at`,
`adjusted_by`, `adjustment_reason` — are written by the adjustment trail:
whenever someone edits a bill's `amount` after creation. `original_amount` is
written once, on the first edit, and never overwritten again; it preserves the
value the bill was created with.

`allowed_users` is the one tab `scripts/backup-to-sheet.mjs` does not touch —
it's maintained by hand, one row per person, `active` set to `TRUE`/`FALSE`.
It's also the one tab allowed to have no `id` column (`table_()` in
`Sheets.gs` special-cases it).

### Spreadsheet timezone

File → Settings → Time zone must be **(GMT+5:30) India Standard Time**.

A hand-created Sheet inherits the creator's timezone, so this is usually right
by accident. A Sheet created through the API defaults to `Etc/GMT`, which is
wrong twice over: `Utilities.formatDate` rejects `Etc/GMT` outright, so
`isoDate_` throws `Invalid argument: timeZone` the moment it meets a real Date
cell; and `nightlyBackup` stamps its filename from the spreadsheet timezone, so
a 2am IST run would be dated the previous day. Verify with:

```
gws sheets spreadsheets get --params '{"spreadsheetId":"<id>","fields":"properties(timeZone)"}'
```

Google stores it as the equivalent `Asia/Calcutta`; that is the same zone as
`Asia/Kolkata`, not a mistake.

### Plain-text columns

**`Sheets.gs` enforces this in code** — `TEXT_FIELDS_` and `forceTextCols_`
re-apply plain text on every write, because `appendRow`/`setValues` otherwise
stamp their own inferred format over the column's. Formatting the columns by
hand is still worth doing (it keeps anything typed directly into the Sheet
consistent), but the code no longer depends on it.

Columns that must be plain text (select the column → Format → Number → Plain
text, before any data goes in):

- `bills!E` (bill_date), `bills!J` (payment_date), `bank_txns!B` (txn_date) —
  otherwise Sheets can silently reinterpret a date near midnight and evening
  entries land on the wrong day.
- `bank_txns!D` (ref) — otherwise a zero-padded ref (e.g. `007123456`) is
  stored as the number `7123456`, and the next import of the same statement
  no longer recognises it as already-seen: the duplicate guard fails and the
  whole statement re-imports.
- `bills!I` (payment_ref) — otherwise a UTR like `007123456` loses its
  leading zeros and prints wrong on the voucher.
- `invoices!E` (invoice_date) — same risk as `bill_date`.

## OAuth client ID

`clientId_()` in `Auth.gs` hardcodes the web-app OAuth client ID rather than
reading a Script Property — the Apps Script REST API has no endpoint to set
script properties from outside the editor, so hardcoding avoids a manual
post-push step. Update that literal directly if the client ID ever changes.

## Deploying

### The two IDs

`scripts/deploy-backend.sh` takes both, and neither is discoverable from any
API — the Apps Script API has no endpoint that lists projects, and a
container-bound script does not appear in a Drive file listing. Recorded here
because the alternative is fishing the scriptId out of the editor URL every
time.

| | |
| --- | --- |
| `scriptId` | `1KApp9mI7Z7XpyMhzJa-2sDDyD_43wvR3P3d3ULeXeBJKbIlR95jVnYBk` |
| `deploymentId` | `AKfycbxti1NBzV5kAf0VU4gP0LWJZWSj0K28kxLemw0uAxT60_Gc-wHleqlUXF9fk5Z6rlOJ` |

The project is `Shayar Bills Backend`, bound to the `Shayar Tex — Bills`
spreadsheet (`1WDW0V_CVW5CZeUMpVy6ZHQiXFioSdLjbjGA0J0Fsugg`).

The `deploymentId` is also the segment after `/macros/s/` in the `/exec` URL in
`js/config.js` — if the two ever disagree, `js/config.js` is the authority on
which deployment the app actually talks to, and the mismatch means a past
deploy minted a new URL instead of updating this one.

Two other deployments exist and are **not** the live one: an `@HEAD` deployment
the editor always keeps, and `AKfycbz3UG…` (version 1, "v1 web app"). Updating
either of those ships nothing to users.

So the full command is:

```bash
bash scripts/deploy-backend.sh \
  1KApp9mI7Z7XpyMhzJa-2sDDyD_43wvR3P3d3ULeXeBJKbIlR95jVnYBk \
  AKfycbxti1NBzV5kAf0VU4gP0LWJZWSj0K28kxLemw0uAxT60_Gc-wHleqlUXF9fk5Z6rlOJ
```

**Passing the scriptId alone is not a partial success.** With no
`deploymentId` the script pushes the source and cuts a version but updates no
deployment — the `/exec` URL keeps serving the old code, and every visible
signal says the deploy worked.

### Editor equivalent

Deploy → New deployment → Web app:

- Execute as: **Me** (`executeAs: USER_DEPLOYING`)
- Who has access: **Anyone** — the option that does *not* say "with a Google
  account" (`access: ANYONE_ANONYMOUS`)

That distinction is load-bearing and easy to get wrong. The manifest has two
similar values:

| Manifest value | Editor label | Behaviour |
| --- | --- | --- |
| `ANYONE` | "Anyone with a Google account" | Caller must be signed in **to Google in that request**. |
| `ANYONE_ANONYMOUS` | "Anyone" | Truly public. **This is the one we need.** |

`ANYONE` looks correct and fails in a way that hides its own cause. A
cross-origin `fetch()` sends no cookies unless asked to, so every RPC from the
app arrives unauthenticated, Apps Script rejects it with a 401 carrying no CORS
headers, and the browser — unable to read a cross-origin error — reports only
`TypeError: Failed to fetch`. Nothing in that message points at the deployment
setting. Worse, the app still *loads*: sign-in is a Google-hosted flow that
never touches this endpoint, so you land on a dashboard that renders zeroes,
which is indistinguishable from a genuinely empty ledger.

Anonymous at the platform layer is correct: the script verifies every caller's
Google ID token against the `allowed_users` tab itself (`verifyToken_` in
`Auth.gs`), including checking `aud` so a token minted for another app cannot
be replayed. Platform-level anonymity is what lets staff use the app without
being given access to the spreadsheet file.

Copy the `/exec` URL into `js/config.js` as `APPS_SCRIPT_URL`.

**After every code change, use Deploy → Manage deployments → edit → New
version.** Creating a *new deployment* mints a different URL and the app will
keep talking to the old code. Via the API the equivalent is
`versions create` then `deployments update` on the existing `deploymentId` —
`deployments create` is what mints a new URL.

### Verifying a deployment

From the browser console on the app's own origin (not `curl` — see below):

```js
await fetch(STB.config.APPS_SCRIPT_URL, {
  method: 'POST',
  headers: {'Content-Type': 'text/plain;charset=utf-8'},
  body: JSON.stringify({action: 'ping'})
}).then(r => r.text());
```

Expected: `{"ok":false,"error":"not signed in"}` — HTTP 200 with parseable
JSON. Sending `idToken: 'not-a-real-token'` should give
`{"ok":false,"error":"session expired"}`. A `TypeError: Failed to fetch`
instead means the deployment is on `ANYONE`, not `ANYONE_ANONYMOUS`.

`curl` is not a usable check here: it rewrites POST to GET when following
Apps Script's 302 to `googleusercontent.com`, so it reports 405 against a
correctly working deployment (`--post302` does not reliably prevent this).
Verify from a browser on the real origin.

## Nightly backups

`Backup.gs` copies the whole spreadsheet to a `Bills Backups` folder in Drive
each night around 2am, keeping one copy per calendar day (`bills-yyyy-MM-dd`)
and trashing anything beyond the newest 30 days. A same-day re-run (e.g. you
trigger `nightlyBackup` manually to test it) replaces that day's copy instead
of piling up a second file for the same date.

The folder is pinned by ID, not by name: the first run finds-or-creates
"Bills Backups" and writes its ID to the `BACKUP_FOLDER_ID` script property
(added automatically — nothing for you to set by hand). Every later run reads
that ID directly, so a second Drive folder that happens to also be named
"Bills Backups" can never silently steal future backups. If the stored ID
ever stops resolving (folder deleted or trashed), the script falls back to
find-or-create-by-name and re-pins the ID rather than failing the run. If it
ever finds more than one folder named "Bills Backups" on that fallback path,
it logs a warning naming which one it picked — check the Executions log if
you're unsure where backups are landing.

Run `installBackupTrigger` once by hand from the editor after the first
deploy. It is safe to re-run — it removes its own duplicate triggers first.

Verify it worked: Triggers (the clock icon in the left rail) should list one
time-driven `nightlyBackup`. Check the Drive folder the next morning.
