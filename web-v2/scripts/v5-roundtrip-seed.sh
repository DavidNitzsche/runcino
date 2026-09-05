#!/usr/bin/env bash
#
# scripts/v5-roundtrip-seed.sh · the supported entry point for the six-direction
# proposal seed. Read the header of `scripts/v5-roundtrip-seed.ts` for what it
# writes and — more importantly — what it deliberately cannot prove.
#
#   bash scripts/walk-substrate.sh        # FAFF_WALK_DB=faff_v5_roundtrip
#   bash scripts/v5-roundtrip-seed.sh
#   bash scripts/walk-server.sh
#
# The exports happen BEFORE the TypeScript half loads, because `lib/db/pool.ts`
# constructs its pool at module evaluation and `lib/verify/install-barrier.ts`
# classifies the process at the same moment. Setting either afterwards is too
# late — the same reason `walk-substrate.sh` does it here.
#
# FALSIFYING THE FENCE (Rule 18). `DATABASE_URL` is exported only when the
# caller has not already set one, so the fence can be aimed at something it must
# refuse:
#
#   DATABASE_URL=postgresql://u:p@crossover.proxy.rlwy.net:20769/railway \
#     bash scripts/v5-roundtrip-seed.sh
#
# expected: "[seed] REFUSING TO RUN · ... which is not loopback", exit 2, before
# any connection is opened.
set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="/usr/local/opt/postgresql@18/bin:/opt/homebrew/opt/postgresql@18/bin:$PATH"

SEED_DB="${FAFF_WALK_DB:-faff_v5_roundtrip}"

export DATABASE_URL="${DATABASE_URL:-postgresql://localhost:5432/$SEED_DB}"
export FAFF_DB_TARGET=local
export FAFF_WALK_DB="$SEED_DB"
# Nothing here talks to a third party, and a live key in a seeding process is a
# blast radius with no upside.
export RESEND_API_KEY=""
export ANTHROPIC_API_KEY=""

exec node scripts/_bundle-script.mjs scripts/v5-roundtrip-seed.ts
