#!/usr/bin/env bash
#
# scripts/adapt-harness-substrate.sh · build the adaptation harness's substrate.
#
# WHY THIS EXISTS
#
# CLAUDE.md Rule 21: "Prove it fires, on real history." And Rule 15: a corpus
# that cannot express a runner with a history cannot reach the mechanisms that
# read one. The 11,598-archetype sweep has no history fields at all, so four
# doctrine mechanisms are dark across the whole of it. This harness does not
# build a second corpus with the same blindness — it drives the real engine
# against the OWNER'S REAL ROWS, copied out of production.
#
# ─────────────────────────────────────────────────────────────────────────────
# HOW PRODUCTION IS PROTECTED. Three independent fences, any one of which is
# sufficient:
#
#   1. The only production connection this whole harness ever opens is
#      `DATABASE_URL_RO`, whose role is `faff_readonly`. It has no write
#      privilege. A write attempt through it is refused by Postgres, not by our
#      discipline.
#   2. Everything the harness runs — every engine call, every mutation — is
#      pointed at a LOCAL Postgres database (`faff_adapt_harness`) by
#      `scripts/adapt-harness.sh`, which exports DATABASE_URL before vitest
#      starts. `vitest.setup.ts` never overrides an already-set variable, so a
#      `.env.local` holding the production URL cannot win.
#   3. `lib/adaptation-harness/fence.ts` re-checks at run time and throws before
#      the first query if DATABASE_URL is not a localhost URL naming this exact
#      database. The harness aborts rather than degrading.
#
# Nothing here writes to production. Nothing here can.
# ─────────────────────────────────────────────────────────────────────────────
#
# USAGE
#   bash scripts/adapt-harness-substrate.sh            # build if absent
#   bash scripts/adapt-harness-substrate.sh --refresh  # drop and rebuild
#
# WHAT IT BUILDS
#   · database `faff_adapt_harness` on localhost
#   · schema `public` — production's schema, structure only
#   · the owner's own rows, and the global reference tables the engine reads
#   · schema `base`  — a pristine copy of every public table, so the harness can
#     restore between worlds. Each scenario starts from the same substrate;
#     one world's mutations can never leak into the next one's verdict.
set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="/usr/local/opt/postgresql@18/bin:/opt/homebrew/opt/postgresql@18/bin:$PATH"

DB="${FAFF_HARNESS_DB:-faff_adapt_harness}"
OWNER="${FAFF_HARNESS_OWNER_UUID:-0645f40c-951d-4ccc-b86e-9979cd26c795}"
REFRESH="${1:-}"

command -v pg_dump >/dev/null || { echo "postgresql@18 not installed (brew install postgresql@18)"; exit 1; }

RO_URL="${DATABASE_URL_RO:-}"
if [ -z "$RO_URL" ] && [ -f .env.local ]; then
  RO_URL=$(grep '^DATABASE_URL_RO=' .env.local | cut -d= -f2- | tr -d '"')
fi
[ -n "$RO_URL" ] || { echo "DATABASE_URL_RO not set and not in web-v2/.env.local"; exit 1; }

# Refuse to read production through anything but the read-only role. This is
# belt-and-braces: the URL is named _RO, but a mistyped .env.local should stop
# the harness rather than hand it a writable production connection.
RO_ROLE=$(psql "$RO_URL" -At -c "select current_user")
case "$RO_ROLE" in
  *readonly*|*read_only*|*_ro) ;;
  *) echo "REFUSING: DATABASE_URL_RO connects as '$RO_ROLE', which is not a read-only role."; exit 1 ;;
esac
echo "→ production read as '$RO_ROLE' (read-only)"

pg_isready -h localhost -p 5432 >/dev/null 2>&1 || {
  echo "starting postgresql@18 via brew services…"
  brew services start postgresql@18
  for _ in $(seq 1 20); do pg_isready -h localhost -p 5432 >/dev/null 2>&1 && break; sleep 1; done
}

EXISTS=$(psql -h localhost -d postgres -At -c "select 1 from pg_database where datname='$DB'" || true)
if [ "$EXISTS" = "1" ]; then
  if [ "$REFRESH" != "--refresh" ]; then
    echo "$DB already exists — reusing it. (pass --refresh to rebuild from production)"
    exit 0
  fi
  psql -h localhost -d postgres -q -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$DB' AND pid <> pg_backend_pid()" >/dev/null
  dropdb -h localhost "$DB"
fi
createdb -h localhost "$DB"
LOCAL="postgresql://localhost:5432/$DB"

echo "→ cloning production schema (structure only)…"
pg_dump "$RO_URL" --schema-only --no-owner --no-privileges 2>/dev/null \
  | psql -q "$LOCAL" >/dev/null

# Tables whose rows are shared training knowledge rather than anyone's data.
GLOBAL_TABLES="course_library learn_articles niggle_recovery workout_weather_cache"

# CHECK constraints, dropped for the load and restored NOT VALID afterwards.
#
# Production carries rows that predate its own constraints — `workout_spec_required`
# is the live case, and 3,918 of the owner's plan_workouts fail it. In production
# the constraint is NOT VALID, so those rows are legal history and only new
# writes are checked. `pg_dump --schema-only` re-creates it as fully validated,
# which would reject the very rows we are copying. Restoring it NOT VALID
# reproduces production's actual posture: the harness's own engine writes are
# still checked, the owner's history is still admitted.
echo "→ deferring CHECK constraints for the load…"
psql -At "$LOCAL" -c "
  select format('ALTER TABLE %I DROP CONSTRAINT %I;', rel.relname, con.conname)
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace n on n.oid = rel.relnamespace and n.nspname='public'
   where con.contype = 'c'" > /tmp/.faff_harness_drop.sql
psql -At "$LOCAL" -c "
  select format('ALTER TABLE %I ADD CONSTRAINT %I %s NOT VALID;', rel.relname, con.conname, pg_get_constraintdef(con.oid))
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace n on n.oid = rel.relnamespace and n.nspname='public'
   where con.contype = 'c'" > /tmp/.faff_harness_restore.sql
psql -q "$LOCAL" -f /tmp/.faff_harness_drop.sql >/dev/null

echo "→ copying the owner's rows…"
TABLES=$(psql "$RO_URL" -At -c "
  select table_name from information_schema.tables
   where table_schema='public' and table_type='BASE TABLE' order by 1")

# FKs are satisfied by the production data as a whole; copying table by table
# visits them in alphabetical order, which is not topological. Replica mode
# suspends FK triggers for the load and is restored implicitly at disconnect.
COPIED=0
for t in $TABLES; do
  HAS_UUID=$(psql "$RO_URL" -At -c "
    select 1 from information_schema.columns
     where table_schema='public' and table_name='$t' and column_name='user_uuid'" || true)

  # Rule 14 · every query states the population it reads. Never `user_id='me'`
  # — that sentinel is shared and returns other accounts' rows.
  if [ "$t" = "users" ]; then
    WHERE="WHERE id = '$OWNER'::uuid"
  elif [ "$t" = "coach_intents" ]; then
    WHERE="WHERE user_uuid = '$OWNER'::uuid OR (user_uuid IS NULL AND user_id = '$OWNER'::uuid)"
  elif [ "$HAS_UUID" = "1" ]; then
    WHERE="WHERE user_uuid = '$OWNER'::uuid"
  elif echo "$GLOBAL_TABLES" | grep -qw "$t"; then
    WHERE=""
  else
    continue
  fi

  if psql "$RO_URL" -q -c "\\copy (SELECT * FROM $t $WHERE) TO STDOUT" 2>/dev/null \
      | psql -q "$LOCAL" -c "SET session_replication_role = replica" -c "\\copy $t FROM STDIN" >/dev/null 2>&1; then
    N=$(psql -At "$LOCAL" -c "select count(*) from $t")
    [ "$N" != "0" ] && echo "   $t · $N"
    COPIED=$((COPIED + 1))
  else
    echo "   (skipped $t)"
  fi
done

echo "→ restoring CHECK constraints (NOT VALID · production's own posture)…"
psql -q "$LOCAL" -f /tmp/.faff_harness_restore.sql >/dev/null
rm -f /tmp/.faff_harness_drop.sql /tmp/.faff_harness_restore.sql

# Rule 18 guard 2 · assert liveness. A substrate builder that copied nothing and
# reported success is the worst outcome available, because the harness would
# then run green against an empty database.
[ "$COPIED" -ge 20 ] || { echo "REFUSING: only $COPIED tables copied — the substrate is not real."; exit 1; }
RUNS=$(psql -At "$LOCAL" -c "select count(*) from runs")
PW=$(psql -At "$LOCAL" -c "select count(*) from plan_workouts")
[ "$RUNS" -gt 50 ] || { echo "REFUSING: $RUNS runs copied — expected the owner's real history."; exit 1; }
[ "$PW" -gt 200 ] || { echo "REFUSING: $PW plan_workouts copied — expected the owner's real plans."; exit 1; }

# Sequences: the copy carries ids but not sequence state, so the first local
# insert would collide. Advance every serial past its table's max.
psql -q "$LOCAL" >/dev/null <<'SQL'
DO $$
DECLARE r record; mx bigint;
BEGIN
  FOR r IN
    SELECT c.relname AS tbl, a.attname AS col, pg_get_serial_sequence(c.relname, a.attname) AS seq
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0
     WHERE c.relkind = 'r' AND pg_get_serial_sequence(c.relname, a.attname) IS NOT NULL
  LOOP
    EXECUTE format('SELECT COALESCE(MAX(%I),0) FROM %I', r.col, r.tbl) INTO mx;
    PERFORM setval(r.seq, GREATEST(mx, 1));
  END LOOP;
END $$;
SQL

echo "→ snapshotting schema 'base' (the per-world restore point)…"
psql -q "$LOCAL" >/dev/null <<'SQL'
DROP SCHEMA IF EXISTS base CASCADE;
CREATE SCHEMA base;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('CREATE TABLE base.%I AS TABLE public.%I', r.tablename, r.tablename);
  END LOOP;
END $$;
SQL

echo
echo "Substrate ready: $LOCAL"
echo "  owner        $OWNER"
echo "  runs         $RUNS"
echo "  plan_workouts $PW"
echo "Run the harness:  bash scripts/adapt-harness.sh"
