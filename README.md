# Shayar Tex — Bills (v3)

Desktop-first bill-book web app for Shayar Tex. Static HTML/JS (no build step)
backed by a Google Sheet through a bound Apps Script web app.

## Run

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000

## Test

```bash
node --test
```

(run from the app root — `node --test tests/` does not work on this machine's
Node version)

## Backend

The server is the Apps Script project bound to the **Shayar Tex — Bills**
spreadsheet. Source of truth for those files is `apps-script/` in this repo —
edit here, then paste into the script editor and publish a new version of the
existing deployment. See `apps-script/README.md`.

Access is controlled by the `allowed_users` tab: one row per person, `active`
set to `TRUE`. Staff never get access to the spreadsheet file itself.

## Backups

`Backup.gs` copies the spreadsheet to a Drive folder once per calendar day —
a same-day re-run replaces that day's copy rather than duplicating it — pinned
to a folder ID stored in the `BACKUP_FOLDER_ID` script property (written
automatically on first run), pruned to the newest 30 days by matching only
files shaped `bills-YYYY-MM-DD`. Details in `apps-script/README.md`.

## Scripts

`scripts/backup-to-sheet.mjs` converts the app's old JSON backup into three
CSVs matching the Sheet tabs, preserving row IDs so cross-references still
resolve. One-time migration tool, not part of the running app — it refuses to
write any output rather than emit data the Sheet can't render cleanly.

## Live URL

https://harris658.github.io/shayar-bills-v3/

Login works once `js/config.js` carries the real `APPS_SCRIPT_URL` and
`GOOGLE_CLIENT_ID`, and `clientId_()` in `apps-script/Auth.gs` returns that
same client ID. It is a hardcoded literal, not a script property — the Apps
Script REST API cannot set script properties from outside the editor, so
hardcoding it keeps the deploy fully scriptable. A mismatch between the two
is the most likely first-setup failure, and it surfaces as `token not for
this app`.

Both values are already filled in and verified live as of 2026-07-30.

## Known limitation: mid-session auth failures are briefly misleading

The app only routes to the sign-in screen on a refresh
(`STB.refresh` in `js/app.js`, which runs on load and on window focus — there
is no polling timer), so if a user is removed from `allowed_users`
mid-session, a write they attempt fails with a generic "check connection"
toast, not a clear "you've been signed out" message — the bounce to sign-in
only happens once the next window-focus refresh runs. It self-heals within
one focus event; it's a known rough edge, not a bug.
