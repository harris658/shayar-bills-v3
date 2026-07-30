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
| `bills` | id, party_id, type, amount, bill_date, note, amount_expr, status, payment_ref, payment_date, created_by, created_at |
| `bank_txns` | id, txn_date, amount, ref, description, matched_bill_id, imported_at |
| `allowed_users` | email, name, active |

`allowed_users` is the one tab `scripts/backup-to-sheet.mjs` does not touch —
it's maintained by hand, one row per person, `active` set to `TRUE`/`FALSE`.
It's also the one tab allowed to have no `id` column (`table_()` in
`Sheets.gs` special-cases it).

**Columns that must be formatted as plain text** (select the column → Format
→ Number → Plain text, before any data goes in):

- `bills!E` (bill_date), `bills!J` (payment_date), `bank_txns!B` (txn_date) —
  otherwise Sheets can silently reinterpret a date near midnight and evening
  entries land on the wrong day.
- `bank_txns!D` (ref) — otherwise a zero-padded ref (e.g. `007123456`) is
  stored as the number `7123456`, and the next import of the same statement
  no longer recognises it as already-seen: the duplicate guard fails and the
  whole statement re-imports.
- `bills!I` (payment_ref) — otherwise a UTR like `007123456` loses its
  leading zeros and prints wrong on the voucher.

## OAuth client ID

`clientId_()` in `Auth.gs` hardcodes the web-app OAuth client ID rather than
reading a Script Property — the Apps Script REST API has no endpoint to set
script properties from outside the editor, so hardcoding avoids a manual
post-push step. Update that literal directly if the client ID ever changes.

## Deploying

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
