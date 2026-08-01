#!/usr/bin/env bash
#
# Adds the `invoices` tab and the three new `bills` columns to a bills-v3
# spreadsheet, then verifies what it did.
#
#   bash scripts/migrate-invoices-schema.sh <spreadsheetId>
#
# Additive only: it creates a tab and appends columns. It never writes to,
# reorders, renames or deletes an existing column, so the live ledger is not at
# risk from a re-run — every step checks first and skips if already done.
#
# Column headers are load-bearing (table_() in apps-script/Sheets.gs locates
# columns by header text), so the header strings here must match
# apps-script/README.md exactly.
set -euo pipefail

SS="${1:?usage: migrate-invoices-schema.sh <spreadsheetId>}"

INV_HEADERS='["id","party_id","invoice_no","amount","invoice_date","note","status","bill_id","created_by","created_at"]'
BILL_NEW='["invoice_total","adjustment","invoice_ids"]'

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

meta() { gws sheets spreadsheets get --params \
  "{\"spreadsheetId\":\"$SS\",\"fields\":\"sheets.properties(title,sheetId,gridProperties(columnCount))\"}" \
  2>/dev/null | grep -v keyring; }

say "1/5  Reading current layout"
meta > /tmp/mig-meta.json
python3 - "$SS" <<'PY'
import json,sys
d=json.load(open('/tmp/mig-meta.json'))
for s in d['sheets']:
    p=s['properties']
    print(f"     {p['title']:<14} {p['gridProperties']['columnCount']} cols  (id {p['sheetId']})")
PY

BILLS_ID=$(python3 -c "
import json
d=json.load(open('/tmp/mig-meta.json'))
print(next(s['properties']['sheetId'] for s in d['sheets'] if s['properties']['title']=='bills'))")
HAS_INV=$(python3 -c "
import json
d=json.load(open('/tmp/mig-meta.json'))
print('yes' if any(s['properties']['title']=='invoices' for s in d['sheets']) else 'no')")

say "2/5  invoices tab"
if [ "$HAS_INV" = "yes" ]; then
  echo "     already present — skipping"
else
  gws sheets spreadsheets batchUpdate --json "{\"requests\":[{\"addSheet\":{\"properties\":{\"title\":\"invoices\",\"gridProperties\":{\"rowCount\":2000,\"columnCount\":10}}}}]}" \
    --params "{\"spreadsheetId\":\"$SS\"}" > /dev/null 2>&1
  echo "     created"
fi

say "3/5  bills columns"
gws sheets +read --spreadsheet "$SS" --range 'bills!1:1' 2>/dev/null | grep -v keyring > /tmp/mig-bills-hdr.json
NEED_COLS=$(python3 -c "
import json
d=json.load(open('/tmp/mig-bills-hdr.json'))
hdr=(d.get('values') or [[]])[0]
print('no' if 'invoice_total' in hdr else 'yes')")
if [ "$NEED_COLS" = "no" ]; then
  echo "     invoice_total/adjustment/invoice_ids already present — skipping"
else
  NCOLS=$(python3 -c "
import json
d=json.load(open('/tmp/mig-meta.json'))
print(next(s['properties']['gridProperties']['columnCount'] for s in d['sheets'] if s['properties']['title']=='bills'))")
  HDRLEN=$(python3 -c "
import json
d=json.load(open('/tmp/mig-bills-hdr.json'))
print(len((d.get('values') or [[]])[0]))")
  # Only widen the grid when the existing columns leave no room.
  if [ "$NCOLS" -lt $((HDRLEN + 3)) ]; then
    gws sheets spreadsheets batchUpdate \
      --json "{\"requests\":[{\"appendDimension\":{\"sheetId\":$BILLS_ID,\"dimension\":\"COLUMNS\",\"length\":3}}]}" \
      --params "{\"spreadsheetId\":\"$SS\"}" > /dev/null 2>&1
    echo "     grid widened by 3 columns"
  fi
  START=$(python3 -c "
import json
d=json.load(open('/tmp/mig-bills-hdr.json'))
n=len((d.get('values') or [[]])[0])
# 0-based -> A1 letter for the first free column
print(chr(ord('A')+n) if n < 26 else 'A'+chr(ord('A')+n-26))")
  gws sheets spreadsheets values update \
    --params "{\"spreadsheetId\":\"$SS\",\"range\":\"bills!${START}1\",\"valueInputOption\":\"RAW\"}" \
    --json "{\"values\":[$BILL_NEW]}" > /dev/null 2>&1
  echo "     appended invoice_total, adjustment, invoice_ids at ${START}1"
fi

say "4/5  invoices headers + plain-text invoice_date"
gws sheets spreadsheets values update \
  --params "{\"spreadsheetId\":\"$SS\",\"range\":\"invoices!A1\",\"valueInputOption\":\"RAW\"}" \
  --json "{\"values\":[$INV_HEADERS]}" > /dev/null 2>&1
INV_ID=$(meta | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(next(s['properties']['sheetId'] for s in d['sheets'] if s['properties']['title']=='invoices'))")
# invoice_date is column E. Plain text for the same reason as bill_date: Sheets
# otherwise re-infers a date near midnight onto the wrong day, and isoDate_
# cannot tell the difference on the way back out.
gws sheets spreadsheets batchUpdate --params "{\"spreadsheetId\":\"$SS\"}" --json "{\"requests\":[{\"repeatCell\":{\"range\":{\"sheetId\":$INV_ID,\"startColumnIndex\":4,\"endColumnIndex\":5},\"cell\":{\"userEnteredFormat\":{\"numberFormat\":{\"type\":\"TEXT\"}}},\"fields\":\"userEnteredFormat.numberFormat\"}}]}" > /dev/null 2>&1
echo "     headers written, column E set to plain text"

say "5/5  Verifying"
FAIL=0
gws sheets +read --spreadsheet "$SS" --range 'bills!1:1' 2>/dev/null | grep -v keyring > /tmp/mig-v-bills.json
gws sheets +read --spreadsheet "$SS" --range 'invoices!1:1' 2>/dev/null | grep -v keyring > /tmp/mig-v-inv.json
python3 <<'PY' || FAIL=1
import json,sys
want_bills=['id','party_id','type','amount','bill_date','note','amount_expr','status',
            'payment_ref','payment_date','created_by','created_at',
            'invoice_total','adjustment','invoice_ids']
want_inv=['id','party_id','invoice_no','amount','invoice_date','note','status',
          'bill_id','created_by','created_at']
b=(json.load(open('/tmp/mig-v-bills.json')).get('values') or [[]])[0]
i=(json.load(open('/tmp/mig-v-inv.json')).get('values') or [[]])[0]
ok=True
if b!=want_bills:
    ok=False; print('     FAIL bills headers:\n       got  '+str(b)+'\n       want '+str(want_bills))
else: print('     ok   bills headers match the schema, in order')
if i!=want_inv:
    ok=False; print('     FAIL invoices headers:\n       got  '+str(i)+'\n       want '+str(want_inv))
else: print('     ok   invoices headers match the schema, in order')
sys.exit(0 if ok else 1)
PY

FMT=$(gws sheets spreadsheets get --params "{\"spreadsheetId\":\"$SS\",\"ranges\":\"invoices!E2\",\"fields\":\"sheets(data(rowData(values(userEnteredFormat(numberFormat)))))\",\"includeGridData\":true}" 2>/dev/null | grep -v keyring | grep -c TEXT || true)
if [ "$FMT" -ge 1 ]; then
  echo "     ok   invoices!E is plain text"
else
  echo "     FAIL invoices!E is not plain text"; FAIL=1
fi

if [ "$FAIL" -ne 0 ]; then
  printf '\n\033[31mMIGRATION INCOMPLETE — do not deploy the backend yet.\033[0m\n'; exit 1
fi
printf '\n\033[32mSchema ready.\033[0m The backend can be deployed now.\n'
