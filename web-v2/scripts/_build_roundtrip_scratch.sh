#!/usr/bin/env bash
#
# scripts/_build_roundtrip_scratch.sh · build the LOCAL round-trip scratch DB.
#
# READS production over the READ-ONLY role (schema only, no data). WRITES only
# to a local loopback database. It never writes to production and never issues
# production DDL — `"$PGDUMP" --schema-only` takes no locks that change anything
# and the read-only role could not write even if it tried.
#
# Idempotent: drops and recreates the LOCAL database each run.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE/.."

SCRATCH="${SCRATCH_DB:-faff_roundtrip_scratch}"

# Production runs PostgreSQL 18; a v17 pg_dump refuses a v18 server outright.
# Prefer the v18 client when the machine has it (it does, via Homebrew) and say
# so rather than failing with a version-mismatch error nobody can act on.
PGBIN18=/opt/homebrew/Cellar/postgresql@18/18.4/bin
if [ -x "$PGBIN18/pg_dump" ]; then
  PGDUMP="$PGBIN18/pg_dump"; PSQL="$PGBIN18/psql"
else
  PGDUMP=pg_dump; PSQL=psql
fi
echo "== using $($PGDUMP --version) =="


RO="$(grep -E '^DATABASE_URL_RO=' .env.local | sed 's/^DATABASE_URL_RO=//')"
if [ -z "$RO" ]; then
  echo "FATAL · DATABASE_URL_RO is not set in web-v2/.env.local" >&2
  exit 1
fi

echo "== dumping production SCHEMA (read-only role, no data) =="
"$PGDUMP" --schema-only --no-owner --no-privileges --no-comments \
  --exclude-schema=information_schema --exclude-schema='pg_*' \
  "$RO" > /tmp/faff-schema.sql

echo "== schema dumped: $(wc -l < /tmp/faff-schema.sql) lines =="

echo "== rebuilding LOCAL $SCRATCH =="
"$PSQL" -q postgresql://localhost/postgres -c "DROP DATABASE IF EXISTS $SCRATCH" >/dev/null
"$PSQL" -q postgresql://localhost/postgres -c "CREATE DATABASE $SCRATCH" >/dev/null

# The dump carries extensions and role grants the local cluster may not have.
# Errors on those are expected and harmless; the tables are what matter.
"$PSQL" -q "postgresql://localhost/$SCRATCH" -f /tmp/faff-schema.sql >/dev/null 2>/tmp/faff-schema-errors.txt || true
echo "== schema load finished ($(wc -l < /tmp/faff-schema-errors.txt) stderr lines, mostly extension/role noise) =="

echo "== applying migrations 166 and 167 (the ledger and the scheduler) =="
"$PSQL" -q "postgresql://localhost/$SCRATCH" -f db/migrations/166_plan_decision_ledger.sql >/dev/null
"$PSQL" -q "postgresql://localhost/$SCRATCH" -f db/migrations/167_reassessment_schedule.sql >/dev/null

echo "== tables present =="
"$PSQL" -tA "postgresql://localhost/$SCRATCH" -c \
  "SELECT count(*) || ' tables' FROM information_schema.tables WHERE table_schema='public'"
for t in training_plans plan_workouts plan_weeks plan_phases plan_decision_ledger reassessment_schedule; do
  n=$("$PSQL" -tA "postgresql://localhost/$SCRATCH" -c "SELECT to_regclass('public.$t')" || true)
  printf '  %-28s %s\n' "$t" "${n:-MISSING}"
done

echo "== $SCRATCH ready =="
