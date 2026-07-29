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

Paste each file's contents into a file of the same name in the script editor.
There is no automated deploy; this is a copy-paste project by design.

## Script properties

Project Settings → Script Properties:

| Key | Value |
| --- | --- |
| `GOOGLE_CLIENT_ID` | The OAuth client ID, ending `.apps.googleusercontent.com` |

## Deploying

Deploy → New deployment → Web app:

- Execute as: **Me**
- Who has access: **Anyone**

"Anyone" sounds alarming and is correct: the script itself verifies every
caller's Google token against the `allowed_users` tab. It is what lets staff
use the app without being given access to the spreadsheet file.

Copy the `/exec` URL into `js/config.js` as `APPS_SCRIPT_URL`.

**After every code change, use Deploy → Manage deployments → edit → New
version.** Creating a *new deployment* mints a different URL and the app will
keep talking to the old code.

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
