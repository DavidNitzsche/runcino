#!/usr/bin/env bash
#
# scripts/probe-snapshot-flicker.sh · entry point for
# `scripts/_probe_snapshot_flicker.script.ts`. Read that file's header.
#
# Points the process at a LOCAL scratch substrate (built by
# `scripts/adapt-harness-substrate.sh`) and arms the same fences
# `scripts/walk-substrate.sh` arms, for the same reason: `lib/db/pool.ts`
# builds its pool at module evaluation, so DATABASE_URL has to be set before
# the import, and `.env.local` (which holds production) must never win.
#
#   FAFF_HARNESS_DB=faff_followup_skipproj bash scripts/probe-snapshot-flicker.sh
#
# Exit 0 = every load agreed. Exit 1 = the loads disagreed (the defect).
set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="/usr/local/opt/postgresql@18/bin:/opt/homebrew/opt/postgresql@18/bin:$PATH"

PROBE_DB="${FAFF_HARNESS_DB:-faff_followup_skipproj}"
export DATABASE_URL="${DATABASE_URL:-postgresql://localhost:5432/$PROBE_DB}"
export FAFF_VERIFICATION=1
export FAFF_DB_TARGET=local
export RESEND_API_KEY=""
export ANTHROPIC_API_KEY=""
unset DATABASE_URL_RO

exec node scripts/_bundle-script.mjs scripts/_probe_snapshot_flicker.script.ts
