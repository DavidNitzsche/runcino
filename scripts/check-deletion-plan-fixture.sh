#!/usr/bin/env bash
#
# check-deletion-plan-fixture · the account-deletion refusal floor must be
# sized against a schema that still exists.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHY THIS EXISTS
#
# POST /api/account/delete does not carry a hardcoded table list — it
# enumerates user-keyed tables from pg_catalog at runtime, precisely so the
# list cannot go stale and orphan PII. But it refuses to delete anything if
# that enumeration comes back below MIN_USER_KEYED_TABLES
# (lib/account/deletion-plan.ts). That floor is the route's only defense
# against a transient or privilege-truncated enumeration, because
# buildDeletionPlan([], []) is a VALID one-step plan that deletes the users
# row and orphans everything else, and the route's other integrity check
# (counts['users'] === 1) is satisfied by it.
#
# A floor is only a floor relative to a real count. On 2026-07-06 the floor
# was 40 against a real 49 — nine tables of headroom. By 2026-08-24 prod held
# 44 and the headroom was 4, and nothing anywhere said so. The test fixture
# claiming to mirror prod had drifted further still: it listed six tables prod
# no longer has (briefings, coach_intent, daily_checkin, recovery_sessions,
# runner_notes, skipped_workouts) and had personal_goals down as user_id +
# user_uuid when it is uuid-only.
#
# None of that broke at runtime, which is the point: it was a guard and a
# document quietly ceasing to describe reality, with no moment at which
# anyone would find out. This script is that moment.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHAT IT CHECKS
#
#   1. The fixture in web-v2/lib/account/deletion-plan.test.ts parses at all —
#      an extractor floor fails the run rather than silently reading fewer
#      rows if the one-entry-per-line format contract is broken.
#   2. The fixture's user-keyed table list — names AND owner columns — equals
#      what prod pg_catalog returns for the route's own query.
#   3. The fixture's FK edge list equals prod's distinct child->parent pairs.
#   4. PROD_TABLE_COUNT_AT_LAST_PROBE in deletion-plan.ts equals the live
#      count, and MIN_USER_KEYED_TABLES is still that count minus the stated
#      FLOOR_MARGIN — so the floor cannot drift toward (or above) reality.
#   5. FLOOR_MARGIN is neither vanishing (a floor with no headroom trips on
#      ordinary schema churn) nor so large it stops refusing a collapsed
#      enumeration.
#
# Any failure prints the regenerated fixture blocks, so the fix is a paste.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHERE IT RUNS, AND WHY NOT IN prebuild
#
# .github/workflows/deletion-plan-fixture.yml — weekly, plus every PR that
# touches the planner, the route or this script. Deliberately NOT in web-v2's
# `prebuild` beside check-doctrine.sh and friends: those must pass on a cold
# Railway container with no database, and a gate that needs prod would either
# fail every deploy or skip itself on every deploy. Skipping silently is the
# exact failure mode this script was written to end.
#
# ─────────────────────────────────────────────────────────────────────────────
# USAGE
#
#   bash scripts/check-deletion-plan-fixture.sh            # verify
#   bash scripts/check-deletion-plan-fixture.sh --print    # regenerate blocks
#
# Connection, first hit wins: $FAFF_DELETION_FIXTURE_DB, $DATABASE_URL_RO,
# $DATABASE_URL, then DATABASE_URL_RO / DATABASE_URL out of web-v2/.env.local.
# Read-only throughout — the queries are two SELECTs against pg_catalog.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_FILE="$ROOT/web-v2/lib/account/deletion-plan.test.ts"
PLAN_FILE="$ROOT/web-v2/lib/account/deletion-plan.ts"

PRINT_ONLY=0
[ "${1:-}" = "--print" ] && PRINT_ONLY=1

fail=0
bad() { echo "  ✗ $*" >&2; fail=1; }

# ── connection ───────────────────────────────────────────────────────────────
env_from_dotenv() {
  local key="$1" f="$ROOT/web-v2/.env.local"
  [ -f "$f" ] || return 1
  sed -n "s/^${key}=//p" "$f" | head -1 | tr -d '"'"'"
}
PGURL="${FAFF_DELETION_FIXTURE_DB:-${DATABASE_URL_RO:-${DATABASE_URL:-}}}"
[ -z "$PGURL" ] && PGURL="$(env_from_dotenv DATABASE_URL_RO || true)"
[ -z "$PGURL" ] && PGURL="$(env_from_dotenv DATABASE_URL || true)"
if [ -z "$PGURL" ]; then
  echo "check-deletion-plan-fixture: no database URL." >&2
  echo "  Set FAFF_DELETION_FIXTURE_DB / DATABASE_URL_RO / DATABASE_URL," >&2
  echo "  or put one in web-v2/.env.local. This gate does not skip: a" >&2
  echo "  silently-skipped schema check is what it exists to prevent." >&2
  exit 1
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "check-deletion-plan-fixture: psql not on PATH — cannot probe." >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ── live prod, via the route's own two queries ───────────────────────────────
if ! psql "$PGURL" -At -F'|' -v ON_ERROR_STOP=1 -c "
SELECT c.relname, string_agg(DISTINCT a.attname, ',' ORDER BY a.attname)
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid
 WHERE n.nspname = 'public' AND c.relkind = 'r'
   AND a.attname IN ('user_uuid', 'user_id')
   AND a.attnum > 0 AND NOT a.attisdropped
 GROUP BY c.relname ORDER BY c.relname;" > "$TMP/live_tables_raw" 2>"$TMP/err"; then
  echo "check-deletion-plan-fixture: table probe failed:" >&2
  sed 's/^/    /' "$TMP/err" >&2
  exit 1
fi

if ! psql "$PGURL" -At -F'|' -v ON_ERROR_STOP=1 -c "
SELECT DISTINCT child.relname, parent.relname
  FROM pg_constraint con
  JOIN pg_class child  ON child.oid  = con.conrelid
  JOIN pg_class parent ON parent.oid = con.confrelid
  JOIN pg_namespace n  ON n.oid = child.relnamespace
 WHERE con.contype = 'f' AND n.nspname = 'public'
 ORDER BY 1, 2;" > "$TMP/live_edges" 2>"$TMP/err"; then
  echo "check-deletion-plan-fixture: FK probe failed:" >&2
  sed 's/^/    /' "$TMP/err" >&2
  exit 1
fi

# name|both|uuidOnly|idOnly — the fixture's vocabulary, not postgres'.
awk -F'|' '{
  k = ($2 == "user_id,user_uuid") ? "both" : (($2 == "user_uuid") ? "uuidOnly" : "idOnly");
  print $1 "|" k
}' "$TMP/live_tables_raw" | sort > "$TMP/live_tables"

live_table_count=$(wc -l < "$TMP/live_tables" | tr -d ' ')
live_edge_count=$(wc -l < "$TMP/live_edges" | tr -d ' ')

# ── --print · regenerate the two blocks verbatim ─────────────────────────────
if [ "$PRINT_ONLY" = "1" ]; then
  echo "  // >>> PROD-TABLES"
  awk -F'|' "{ printf \"  ['%s', %s],\\n\", \$1, \$2 }" "$TMP/live_tables"
  echo "  // <<< PROD-TABLES"
  echo ""
  echo "  // >>> PROD-EDGES"
  awk -F'|' "{ printf \"  e('%s', '%s'),\\n\", \$1, \$2 }" "$TMP/live_edges"
  echo "  // <<< PROD-EDGES"
  echo ""
  echo "  # $live_table_count tables · $live_edge_count distinct FK edges" \
       "· probed $(date -u +%Y-%m-%d)" >&2
  exit 0
fi

# ── fixture · read the marked blocks with no TypeScript toolchain ────────────
block() { sed -n "/>>> $1/,/<<< $1/p" "$TEST_FILE" | sed '1d;$d'; }

block PROD-TABLES > "$TMP/fx_tables_lines"
block PROD-EDGES  > "$TMP/fx_edges_lines"

sed -n "s/^ *\['\([a-z0-9_]*\)', *\([a-zA-Z]*\)\],\{0,1\} *$/\1|\2/p" \
  "$TMP/fx_tables_lines" | sort > "$TMP/fx_tables"
sed -n "s/^ *e('\([a-z0-9_]*\)', *'\([a-z0-9_]*\)'),\{0,1\} *$/\1|\2/p" \
  "$TMP/fx_edges_lines" | sort > "$TMP/fx_edges"

fx_table_lines=$(grep -c '[^[:space:]]' "$TMP/fx_tables_lines" || true)
fx_edge_lines=$(grep -c '[^[:space:]]' "$TMP/fx_edges_lines" || true)
fx_table_count=$(wc -l < "$TMP/fx_tables" | tr -d ' ')
fx_edge_count=$(wc -l < "$TMP/fx_edges" | tr -d ' ')

# Extractor floor · a parser that reads fewer rows than are there is worse
# than one that cannot read at all, because it still reports a clean diff.
if [ "$fx_table_count" -ne "$fx_table_lines" ] || [ "$fx_edge_count" -ne "$fx_edge_lines" ]; then
  echo "check-deletion-plan-fixture: FORMAT CONTRACT BROKEN in $TEST_FILE" >&2
  echo "    tables: $fx_table_count of $fx_table_lines lines parsed" >&2
  echo "    edges:  $fx_edge_count of $fx_edge_lines lines parsed" >&2
  echo "  One entry per line: ['<name>', <both|uuidOnly|idOnly>], and e('<child>', '<parent>')," >&2
  exit 1
fi
if [ "$fx_table_count" -lt 20 ] || [ "$fx_edge_count" -lt 20 ]; then
  echo "check-deletion-plan-fixture: extractor read $fx_table_count tables /" \
       "$fx_edge_count edges — far too few to be the real fixture. Markers moved?" >&2
  exit 1
fi

# ── 1 · table list ───────────────────────────────────────────────────────────
if ! diff -q "$TMP/fx_tables" "$TMP/live_tables" >/dev/null; then
  bad "FIXTURE TABLE LIST ≠ PROD ($fx_table_count fixture vs $live_table_count live)"
  comm -23 "$TMP/fx_tables" "$TMP/live_tables" | sed 's/^/      in fixture, NOT in prod: /' >&2
  comm -13 "$TMP/fx_tables" "$TMP/live_tables" | sed 's/^/      in prod, NOT in fixture: /' >&2
  echo "      (a row differing only after the | is an owner-column change —" >&2
  echo "       it changes the WHERE clause the planner emits for that table)" >&2
fi

# ── 2 · FK edges ─────────────────────────────────────────────────────────────
if ! diff -q "$TMP/fx_edges" "$TMP/live_edges" >/dev/null; then
  bad "FIXTURE FK EDGES ≠ PROD ($fx_edge_count fixture vs $live_edge_count live)"
  comm -23 "$TMP/fx_edges" "$TMP/live_edges" | sed 's/^/      in fixture, NOT in prod: /' >&2
  comm -13 "$TMP/fx_edges" "$TMP/live_edges" | sed 's/^/      in prod, NOT in fixture: /' >&2
fi

# ── 3 · the floor and its margin ─────────────────────────────────────────────
num_of() { sed -n "s/^const $1 = \([0-9]\{1,\}\);.*$/\1/p" "$PLAN_FILE" | head -1; }
probe_count="$(num_of PROD_TABLE_COUNT_AT_LAST_PROBE)"
margin="$(num_of FLOOR_MARGIN)"

if [ -z "$probe_count" ] || [ -z "$margin" ]; then
  bad "could not read PROD_TABLE_COUNT_AT_LAST_PROBE / FLOOR_MARGIN from $PLAN_FILE"
  echo "      (both must stay single-line \`const NAME = <int>;\` declarations)" >&2
else
  floor=$(( probe_count - margin ))
  if [ "$probe_count" -ne "$live_table_count" ]; then
    bad "PROD_TABLE_COUNT_AT_LAST_PROBE is $probe_count, prod has $live_table_count"
    echo "      The floor is derived from this number. Left stale, the margin" >&2
    echo "      drifts silently — 40-vs-49 became 40-vs-44 exactly this way." >&2
  fi
  if [ "$floor" -ge "$live_table_count" ]; then
    bad "FLOOR $floor is at or above prod's $live_table_count — the route would refuse EVERY deletion"
  fi
  if [ "$margin" -lt 5 ]; then
    bad "FLOOR_MARGIN $margin is too thin — ordinary schema churn will trip the floor"
  fi
  if [ "$margin" -gt $(( live_table_count / 2 )) ]; then
    bad "FLOOR_MARGIN $margin exceeds half of prod's $live_table_count — the floor stops catching a collapsed enumeration"
  fi
fi

if [ "$fail" -ne 0 ]; then
  echo "" >&2
  echo "  TO FIX — regenerate both blocks and paste them between the markers" >&2
  echo "  in web-v2/lib/account/deletion-plan.test.ts:" >&2
  echo "" >&2
  echo "      bash scripts/check-deletion-plan-fixture.sh --print" >&2
  echo "" >&2
  echo "  Then set PROD_TABLE_COUNT_AT_LAST_PROBE = $live_table_count in" >&2
  echo "  web-v2/lib/account/deletion-plan.ts (FLOOR_MARGIN stays unless you" >&2
  echo "  have a reason), update the '44' and the margin assertion in the test," >&2
  echo "  and the 'currently N vs. prod's real N' line in the route header." >&2
  exit 1
fi

echo "check-deletion-plan-fixture OK"
echo "  $live_table_count user-keyed tables · $live_edge_count distinct FK edges · fixture matches prod"
echo "  floor $(( probe_count - margin )) = $probe_count − $margin margin" \
     "($(( 100 * margin / live_table_count ))% headroom)"
echo ""
echo "  NOTE: this gate proves the FIXTURE and the FLOOR still describe prod."
echo "  It does not exercise the deletion path — that is the pure-planner"
echo "  suite in lib/account/deletion-plan.test.ts, which runs without a"
echo "  database and is what actually asserts FK-safe ordering."
