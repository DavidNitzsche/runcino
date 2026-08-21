#!/usr/bin/env bash
# Creates five throwaway accounts, one per onboarding mode, and captures a
# session cookie for each so the QA pass can drive the flows without ever
# handling your password.
#
#   bash scripts/qa/create-onboarding-test-accounts.sh
#
# Finds the local dev server itself and prompts for a password. Writes
# scripts/qa/.sessions.json (gitignored). Deletes nothing, ever.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/.sessions.json"
STAMP="$(date +%Y%m%d-%H%M)"

probe() {  # $1 = base url · echoes the HTTP code for an empty signup body
  curl -sS -o /dev/null -w '%{http_code}' --max-time 8 \
    -X POST "$1/api/auth/signup" -H 'Content-Type: application/json' -d '{}' 2>/dev/null
}

BASE="${FAFF_BASE_URL:-}"
if [ -z "$BASE" ]; then
  echo "Looking for the local dev server…"
  for port in $(lsof -iTCP -sTCP:LISTEN -P -n 2>/dev/null | awk '/node|next/ {print $9}' \
                 | sed 's/.*://' | sort -un) 3000; do
    [ -z "$port" ] && continue
    code=$(probe "http://localhost:$port")
    if [ "$code" = "400" ]; then BASE="http://localhost:$port"; break; fi
    if [ "$code" = "403" ]; then
      echo "  port $port is the app but signup is locked (403)." >&2
      echo "  ALLOW_OPEN_SIGNUP=true must be in web-v2/.env.local and the server restarted." >&2
      exit 1
    fi
  done
fi

if [ -z "$BASE" ]; then
  echo "Could not find a dev server with signup open. Ask Claude to restart it." >&2
  exit 1
fi
echo "Using $BASE"

if [ -z "${FAFF_TEST_PASSWORD:-}" ]; then
  printf 'Throwaway password for the five test accounts: '
  read -rs FAFF_TEST_PASSWORD
  echo
fi
if [ -z "$FAFF_TEST_PASSWORD" ]; then echo "No password entered." >&2; exit 1; fi

MODES=(race goal justrun coached beginner)
echo "{" > "$OUT"
first=1
ok=0

for mode in "${MODES[@]}"; do
  email="qa-${mode}-${STAMP}@faff.run"
  jar="$(mktemp)"
  body="$(printf '{"name":"QA %s","email":"%s","password":"%s"}' "$mode" "$email" "$FAFF_TEST_PASSWORD")"

  code=$(curl -sS -o /tmp/qa_signup_body -w '%{http_code}' --max-time 30 \
    -c "$jar" -X POST "$BASE/api/auth/signup" \
    -H 'Content-Type: application/json' -d "$body")

  cookie=$(awk '$6 == "faff_session" {print $6"="$7}' "$jar" 2>/dev/null)
  rm -f "$jar"

  case "$code" in
    200|201) status=created;  ok=$((ok+1)) ;;
    409)     status=already-exists ;;
    *)       status="FAILED-$code"
             echo "  ! $mode -> HTTP $code: $(head -c 300 /tmp/qa_signup_body)" >&2 ;;
  esac

  printf '  %-9s %-40s %s%s\n' "$mode" "$email" "$status" \
    "$([ -n "$cookie" ] && echo ' (session captured)')"

  [ $first -eq 1 ] || echo "," >> "$OUT"
  first=0
  printf '  "%s": {"email": "%s", "status": "%s", "cookie": "%s"}' \
    "$mode" "$email" "$status" "$cookie" >> "$OUT"
done

echo "" >> "$OUT"; echo "}" >> "$OUT"
rm -f /tmp/qa_signup_body
echo
echo "$ok/5 created · sessions in $OUT"
echo "Tell Claude it's done."
