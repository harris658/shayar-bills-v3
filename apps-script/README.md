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
