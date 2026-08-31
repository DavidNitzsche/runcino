#!/usr/bin/env bash
#
# scripts/adapt-harness.sh · run the adaptation harness.
#
#   bash scripts/adapt-harness.sh                 # run the three worlds
#   bash scripts/adapt-harness.sh --refresh       # re-copy production first
#   bash scripts/adapt-harness.sh --falsify       # run the falsifiers too
#
# This is the ONLY supported entry point. It exports DATABASE_URL to the local
# scratch database before vitest starts — `vitest.setup.ts` is not loaded by
# `vitest.harness.config.ts` at all, and `lib/adaptation-harness/fence.ts`
# re-checks at run time and throws if DATABASE_URL is anything else.
#
# Nothing here can reach production. The only production connection the whole
# harness ever opens is the read-only role used by
# `scripts/adapt-harness-substrate.sh` to copy the substrate.
set -euo pipefail
cd "$(dirname "$0")/.."

DB="${FAFF_HARNESS_DB:-faff_adapt_harness}"
export PATH="/usr/local/opt/postgresql@18/bin:/opt/homebrew/opt/postgresql@18/bin:$PATH"

MODE="${1:-}"
if [ "$MODE" = "--refresh" ]; then
  bash scripts/adapt-harness-substrate.sh --refresh
else
  bash scripts/adapt-harness-substrate.sh
fi

# THE ENVIRONMENT FENCE. Set here, before vitest, so nothing downstream has to
# remember to. Explicitly NOT read from .env.local — that file holds production.
export DATABASE_URL="postgresql://localhost:5432/$DB"
export DATABASE_URL_RO="$DATABASE_URL"
export NODE_ENV="test"
export CRON_SECRET="harness-local-secret"
# Any live key would be a live key pointed at scenarios that write. None here.
export RESEND_API_KEY=""
export ANTHROPIC_API_KEY=""

echo "adaptation harness → $DATABASE_URL"

if [ "$MODE" = "--falsify" ]; then
  export FAFF_HARNESS_FALSIFY=1
fi

npx vitest run --config vitest.harness.config.ts "${@:2}"
