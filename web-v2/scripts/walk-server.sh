#!/usr/bin/env bash
#
# scripts/walk-server.sh · serve the visual walk substrate on :3111, which is
# the host the iPhone app already points at.
#
#   bash scripts/walk-substrate.sh     # build it first
#   bash scripts/walk-server.sh        # then this
#
# WHY THE EXPORTS ARE HERE AND NOT IN .env.local
#
# `.env.local` holds the PRODUCTION connection string, and `next dev` loads it.
# `@next/env` does not overwrite a variable that is already in `process.env`, so
# exporting here wins — but "wins by a library's precedence rule" is a claim,
# and Rule 20 says a claim with no check is a hypothesis. So the check is the
# session token: it exists only in the scratch database, so an authenticated
# 200 from this server is proof of which database it is reading. Run the curl
# below before trusting a single screenshot.
#
# The loopback assertion below is this script's own fence. It is deliberately
# not a comment.
set -euo pipefail
cd "$(dirname "$0")/.."

WALK_DB="${FAFF_WALK_DB:-faff_visual_walk}"
WALK_PORT="${FAFF_WALK_PORT:-3111}"
URL="postgresql://localhost:5432/$WALK_DB"

case "$URL" in
  postgresql://localhost:*|postgresql://127.0.0.1:*) ;;
  *) echo "REFUSING: the walk server would point at '$URL', which is not loopback."; exit 2 ;;
esac

if ! psql "$URL" -At -c 'select 1' >/dev/null 2>&1; then
  echo "REFUSING: $WALK_DB is not reachable. Build it first:  bash scripts/walk-substrate.sh"
  exit 2
fi

export DATABASE_URL="$URL"
export DATABASE_URL_RO="$URL"
export FAFF_DB_TARGET=local
# Deliberately NOT FAFF_VERIFICATION=1. The walk exercises the app's real write
# paths against a local copy, and the barrier's job is to stop a verification
# process writing something REMOTE, which this one cannot reach anyway.

echo "walk server → $URL on :$WALK_PORT"
echo "prove it with:"
echo "  curl -sS -o /dev/null -w '%{http_code}\\n' -H \"Authorization: Bearer \$(cat .walk-session-token)\" http://localhost:$WALK_PORT/api/v5/today"
echo

exec npx next dev -p "$WALK_PORT"
