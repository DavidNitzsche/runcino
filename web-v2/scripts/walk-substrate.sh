#!/usr/bin/env bash
#
# scripts/walk-substrate.sh · the supported entry point for the visual walk
# substrate. Read the header of `scripts/walk-substrate.ts` for what it builds
# and what it deliberately cannot prove.
#
#   bash scripts/walk-substrate.sh
#
# It exports the environment the TypeScript half depends on BEFORE that half
# loads, because `lib/db/pool.ts` constructs its pool at module evaluation and
# `lib/verify/install-barrier.ts` classifies the process at the same moment.
# Setting either one after the import would be too late.
#
#   DATABASE_URL        the local scratch database. Deliberately NOT read from
#                       .env.local, which holds production.
#   DATABASE_URL_RO     left alone. walk-substrate.ts reads it from the
#                       environment or from web-v2/.env.local, and refuses if
#                       neither carries it.
#   FAFF_VERIFICATION   arms the production write barrier for this process.
#   FAFF_DB_TARGET      confirms loopback. It can only ever CONFIRM; there is no
#                       value of it that makes a remote database writable.
#
# FALSIFYING THE REFUSAL (Rule 18). `DATABASE_URL` is exported only when the
# caller has not already set one, so the fence can be aimed at something it must
# refuse:
#
#   DATABASE_URL=postgresql://u:p@crossover.proxy.rlwy.net:20769/railway \
#     bash scripts/walk-substrate.sh
#
# expected: "[walk] REFUSING TO RUN · ... which is not loopback", exit 2, before
# any credential is read and before any connection is opened.
set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="/usr/local/opt/postgresql@18/bin:/opt/homebrew/opt/postgresql@18/bin:$PATH"

WALK_DB="${FAFF_WALK_DB:-faff_visual_walk}"

export DATABASE_URL="${DATABASE_URL:-postgresql://localhost:5432/$WALK_DB}"
export FAFF_VERIFICATION=1
export FAFF_DB_TARGET=local
# No live key may be present in a process that is about to open production.
export RESEND_API_KEY=""
export ANTHROPIC_API_KEY=""

exec node scripts/_bundle-script.mjs scripts/walk-substrate.ts
