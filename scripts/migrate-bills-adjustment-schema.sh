#!/usr/bin/env bash
#
# Adds the four adjustment-trail columns to a bills-v3 spreadsheet, then
# verifies what it did.
#
#   bash scripts/migrate-bills-adjustment-schema.sh <spreadsheetId>
#
# Additive only: it appends columns after invoice_ids. It never writes to,
# reorders, renames or deletes an existing column, so the live ledger is not at
# risk from a re-run — every step checks first and skips if already done.
#
# Column headers are load-bearing (table_() in apps-script/Sheets.gs locates
# columns by header text), so the header strings here must match
# apps-script/README.md and SCHEMA in scripts/run-appsscript-tests.mjs exactly.
set -euo pipefail

SS="${1:?usage: migrate-bills-adjustment-schema.sh <spreadsheetId>}"

BILL_NEW='["original_amount","adjusted_at","adjusted_by","adjustment_reason"]'

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

meta() { gws sheets spreadsheets get --params \
  "{\"spreadsheetId\":\"$SS\",\"fields\":\"sheets.properties(title,sheetId,gridProperties(columnCount))\"}" \
  2>/dev/null | grep -v keyring; }

say "1/3  Reading current layout"
meta > /tmp/adj-meta.json
BILLS_ID=$(python3 -c "
import json
d=json.load(open('/tmp/adj-meta.json'))
print(next(s['properties']['sheetId'] for s in d['sheets'] if s['properties']['title']=='bills'))")
gws sheets +read --spreadsheet "$SS" --range 'bills!1:1' 2>/dev/null | grep -v keyring > /tmp/adj-hdr.json
python3 -c "
import json
d=json.load(open('/tmp/adj-hdr.json'))
hdr=(d.get('values') or [[]])[0]
print('     bills has %d columns: %s' % (len(hdr), ', '.join(hdr)))"

say "2/3  bills columns"
HAVE=$(python3 -c "
import json
d=json.load(open('/tmp/adj-hdr.json'))
hdr=(d.get('values') or [[]])[0]
print('yes' if 'adjusted_at' in hdr else 'no')")
if [ "$HAVE" = "yes" ]; then
  echo "     original_amount/adjusted_at/adjusted_by/adjustment_reason already present — skipping"
else
  NCOLS=$(python3 -c "
import json
d=json.load(open('/tmp/adj-meta.json'))
print(next(s['properties']['gridProperties']['columnCount'] for s in d['sheets'] if s['properties']['title']=='bills'))")
  HDRLEN=$(python3 -c "
import json
d=json.load(open('/tmp/adj-hdr.json'))
print(len((d.get('values') or [[]])[0]))")
  # Only widen the grid when the existing columns leave no room.
  if [ "$NCOLS" -lt $((HDRLEN + 4)) ]; then
    gws sheets spreadsheets batchUpdate \
      --json "{\"requests\":[{\"appendDimension\":{\"sheetId\":$BILLS_ID,\"dimension\":\"COLUMNS\",\"length\":4}}]}" \
      --params "{\"spreadsheetId\":\"$SS\"}" > /dev/null 2>&1
    echo "     grid widened by 4 columns"
  fi
  START=$(python3 -c "
import json
d=json.load(open('/tmp/adj-hdr.json'))
n=len((d.get('values') or [[]])[0])
print(chr(ord('A')+n) if n < 26 else 'A'+chr(ord('A')+n-26))")
  gws sheets spreadsheets values update \
    --params "{\"spreadsheetId\":\"$SS\",\"range\":\"bills!${START}1\",\"valueInputOption\":\"RAW\"}" \
    --json "{\"values\":[$BILL_NEW]}" > /dev/null 2>&1
  echo "     appended the four adjustment columns at ${START}1"
fi

say "3/3  Verifying"
FAIL=0
gws sheets +read --spreadsheet "$SS" --range 'bills!1:1' 2>/dev/null | grep -v keyring > /tmp/adj-v.json
python3 <<'PY' || FAIL=1
import json,sys
want=['id','party_id','type','amount','bill_date','note','amount_expr','status',
      'payment_ref','payment_date','created_by','created_at',
      'invoice_total','adjustment','invoice_ids',
      'original_amount','adjusted_at','adjusted_by','adjustment_reason']
b=(json.load(open('/tmp/adj-v.json')).get('values') or [[]])[0]
if b!=want:
    print('     FAIL bills headers:\n       got  '+str(b)+'\n       want '+str(want))
    sys.exit(1)
print('     ok   bills headers match the schema, in order (19 columns)')
PY

if [ "$FAIL" -ne 0 ]; then
  printf '\n\033[31mMIGRATION INCOMPLETE — do not deploy the backend yet.\033[0m\n'; exit 1
fi
printf '\n\033[32mSchema ready.\033[0m The backend can be deployed now.\n'
