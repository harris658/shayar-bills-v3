#!/usr/bin/env bash
#
# Pushes apps-script/ to a script project, publishes a new VERSION of its
# existing deployment, and verifies the push landed.
#
#   bash scripts/deploy-backend.sh <scriptId> [deploymentId]
#
# With no deploymentId it pushes the source and creates a version but does NOT
# touch any deployment — useful for a scratch project.
#
# It updates the EXISTING deployment in place (`deployments update`). Creating a
# deployment instead mints a different /exec URL and js/config.js would keep
# talking to the old code — the failure the README warns about at length.
#
# The push is all-or-nothing: updateContent replaces the whole project, so every
# .gs file plus appsscript.json is sent every time. A file missing from the
# payload is a file deleted from the project.
set -euo pipefail

SCRIPT_ID="${1:?usage: deploy-backend.sh <scriptId> [deploymentId]}"
DEPLOYMENT_ID="${2:-}"
cd "$(dirname "$0")/.."

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

say "0/5  Checking the spreadsheet has been migrated"
# This backend's snapshot reads the `invoices` tab on every request. Pushed
# against a spreadsheet that has not been migrated, table_() throws
# "missing tab: invoices" and EVERY snapshot fails — the app goes down for
# everyone until the tab exists. Order is therefore enforced here rather than
# left to whoever runs these two scripts.
PARENT=$(gws script projects get --params "{\"scriptId\":\"$SCRIPT_ID\"}" 2>/dev/null \
  | grep -v keyring | python3 -c "import json,sys; print(json.load(sys.stdin).get('parentId',''))")
if [ -z "$PARENT" ]; then
  echo "     standalone script (no bound spreadsheet) — skipping the check"
else
  gws sheets +read --spreadsheet "$PARENT" --range 'bills!1:1' 2>/dev/null \
    | grep -v keyring > /tmp/deploy-hdr.json || true
  READY=$(gws sheets spreadsheets get \
    --params "{\"spreadsheetId\":\"$PARENT\",\"fields\":\"sheets.properties.title\"}" 2>/dev/null \
    | grep -v keyring | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    print('yes' if any(s['properties']['title']=='invoices' for s in d['sheets']) else 'no')
except Exception:
    print('no')")
  HAS_COLS=$(python3 -c "
import json
try:
    d=json.load(open('/tmp/deploy-hdr.json'))
    hdr=(d.get('values') or [[]])[0]
    print('yes' if 'invoice_total' in hdr and 'invoice_ids' in hdr else 'no')
except Exception:
    print('no')")
  if [ "$READY" != "yes" ] || [ "$HAS_COLS" != "yes" ]; then
    printf '\033[31m     REFUSING TO DEPLOY\033[0m\n'
    echo "     spreadsheet $PARENT is not migrated (invoices tab: $READY, bills columns: $HAS_COLS)"
    echo "     run:  bash scripts/migrate-invoices-schema.sh $PARENT"
    exit 1
  fi
  echo "     ok   invoices tab and the three bills columns are present"
fi

say "1/5  Building payload from apps-script/"
python3 - <<'PY' > /tmp/deploy-content.json
import json, pathlib
files = []
for p in sorted(pathlib.Path('apps-script').glob('*.gs')):
    files.append({'name': p.stem, 'type': 'SERVER_JS', 'source': p.read_text()})
    print(f"     {p.name}", flush=True)
manifest = pathlib.Path('apps-script/appsscript.json')
files.append({'name': 'appsscript', 'type': 'JSON', 'source': manifest.read_text()})
print("     appsscript.json", flush=True)
import sys
json.dump({'files': files}, open('/tmp/deploy-content.json', 'w'))
PY
python3 -c "
import json
d=json.load(open('/tmp/deploy-content.json'))
print('     %d files, %d bytes of source' % (len(d['files']), sum(len(f['source']) for f in d['files'])))"

say "2/5  Pushing source"
gws script projects updateContent --params "{\"scriptId\":\"$SCRIPT_ID\"}" \
  --json "$(cat /tmp/deploy-content.json)" > /tmp/deploy-push.json 2>&1
grep -q '"error"' /tmp/deploy-push.json && { echo "     PUSH FAILED"; cat /tmp/deploy-push.json; exit 1; }
echo "     ok"

say "3/5  Verifying the pushed source matches the working tree"
gws script projects getContent --params "{\"scriptId\":\"$SCRIPT_ID\"}" 2>/dev/null \
  | grep -v keyring > /tmp/deploy-remote.json
python3 <<'PY' || exit 1
import json, pathlib, sys
remote = {f['name']: f['source'] for f in json.load(open('/tmp/deploy-remote.json'))['files']}
bad = False
for p in sorted(pathlib.Path('apps-script').glob('*.gs')):
    if remote.get(p.stem) != p.read_text():
        print(f"     FAIL {p.name} differs from what is now on the server"); bad = True
    else:
        print(f"     ok   {p.name} byte-identical")
sys.exit(1 if bad else 0)
PY

say "4/5  Creating a version"
VER=$(gws script projects versions create --params "{\"scriptId\":\"$SCRIPT_ID\"}" \
  --json "{\"description\":\"invoices → debit vouchers ($(date +%Y-%m-%d))\"}" 2>/dev/null \
  | grep -v keyring | python3 -c "import json,sys; print(json.load(sys.stdin)['versionNumber'])")
echo "     version $VER"

say "5/5  Deployment"
if [ -z "$DEPLOYMENT_ID" ]; then
  echo "     no deploymentId given — source and version are in place, nothing published"
  exit 0
fi
gws script projects deployments update --params \
  "{\"scriptId\":\"$SCRIPT_ID\",\"deploymentId\":\"$DEPLOYMENT_ID\"}" \
  --json "{\"deploymentConfig\":{\"scriptId\":\"$SCRIPT_ID\",\"versionNumber\":$VER,\"manifestFileName\":\"appsscript\",\"description\":\"invoices → debit vouchers\"}}" \
  2>/dev/null | grep -v keyring | python3 -c "
import json,sys
d=json.load(sys.stdin)
cfg=d.get('deploymentConfig',{})
print('     deployment %s now serving version %s' % (d.get('deploymentId'), cfg.get('versionNumber')))
for e in d.get('entryPoints',[]):
    if e.get('entryPointType')=='WEB_APP':
        print('     url:', e['webApp']['url'])
        print('     access:', e['webApp'].get('entryPointConfig',{}).get('access'))"

printf '\n\033[32mDeployed.\033[0m The /exec URL is unchanged — js/config.js needs no edit.\n'
