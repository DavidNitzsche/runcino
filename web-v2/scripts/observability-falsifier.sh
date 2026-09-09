#!/usr/bin/env bash
#
# scripts/observability-falsifier.sh · falsify the 502-incident observability
# mechanism (CLAUDE.md Rule 18: "a gate is not trusted until it has been made
# to fail") against a LOCAL SCRATCH DATABASE, never production.
#
#   bash scripts/observability-falsifier.sh            # create/apply + run
#   bash scripts/observability-falsifier.sh --reset     # drop and recreate first
#
# This is the ONLY supported entry point for
# lib/observability/harness/*.harness.test.ts. It exports DATABASE_URL to the
# local scratch database before vitest starts — `vitest.observability.config.ts`
# loads no `.env.local` at all, and `lib/observability/harness/fence.ts`
# re-checks at run time and throws if DATABASE_URL is anything else. Same
# two-fence shape as scripts/adapt-harness.sh.
#
# Applies db/migrations/170_request_failures.sql to the SCRATCH database only
# (idempotent — CREATE TABLE IF NOT EXISTS). Migration 170 remains UNAPPLIED
# to production; nothing here touches Railway.
set -euo pipefail
cd "$(dirname "$0")/.."

DB="${FAFF_OBSERVABILITY_SCRATCH_DB:-faff_observability_scratch}"
export PATH="/usr/local/opt/postgresql@18/bin:/opt/homebrew/opt/postgresql@18/bin:$PATH"

if [ "${1:-}" = "--reset" ]; then
  dropdb --if-exists "$DB"
fi

if ! psql -lqt | cut -d'|' -f1 | grep -qw "$DB"; then
  createdb "$DB"
fi
psql -d "$DB" -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;" >/dev/null
psql -d "$DB" -v ON_ERROR_STOP=1 -f db/migrations/170_request_failures.sql >/dev/null

# THE ENVIRONMENT FENCE. Set here, before vitest, so nothing downstream has to
# remember to. Explicitly NOT read from .env.local — that file holds production.
export DATABASE_URL="postgresql://localhost:5432/$DB"
export NODE_ENV="test"

echo "observability falsifier → $DATABASE_URL"
exec node_modules/.bin/vitest run --config vitest.observability.config.ts
