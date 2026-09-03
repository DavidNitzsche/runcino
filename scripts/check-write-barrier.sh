#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# check-write-barrier.sh · VERIFICATION TOOLING CANNOT WRITE PRODUCTION
#
# Sibling of check-doctrine.sh / check-normal-window.sh / check-automatic-
# mutations.sh, wired the same way (web-v2 prebuild → Railway build).
#
#   check-doctrine            stops a bad NUMBER reaching a runner's legs.
#   check-swallowed-failure   stops a FAILED READ being served as a FACT.
#   check-automatic-mutations stops a JOB CHANGING TRAINING without saying so.
#   check-normal-window       stops the engine calling a taper his normal.
#   this one                  stops A TEST, A SCRIPT OR A SIMULATOR WRITING
#                             THE RUNNER'S REAL TRAINING HISTORY.
#
# ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
#
# An agent ran a live iOS-simulator session signed in as the owner's production
# account. It posted two junk activities — `sim-recovery-live`, 0.27 mi each,
# `status=partial` — into his actual training history, through the app's own
# `/api/ingest/workout` endpoint. They were found, measured (two such rows in
# the entire database) and deleted only after he approved it. His ruling:
#
#   "The production simulator write was a serious process failure. Prevent
#    recurrence technically: production-derived verification must be genuinely
#    read-only. Simulator and automated test clients must be unable to post
#    activities, complete workouts, or mutate my production account.
#    ENVIRONMENT LABELLING OR CONNECTION-STRING POLICY ALONE IS INSUFFICIENT.
#    Add a hard mutation barrier with a test proving production writes are
#    refused during verification."
#
# The instruction that failed was a CONVENTION. Rule 20: a product rule with no
# gate is a hypothesis. This file is the gate.
#
# ── FOUR GUARDS, exit 1 on any violation ────────────────────────────────────
#
#   1 · SHAPE     · both barrier modules exist, still export what the rest of
#                   the app imports, and STILL HAVE NO OPT-OUT. A barrier with
#                   an escape hatch is a convention again.
#   2 · WIRING    · the barrier is actually armed where it has to be —
#                   vitest.setup.ts, lib/db/pool.ts, middleware.ts — and the iOS
#                   client still stamps simulator builds at compile time. Rule
#                   20's corollary: gate the wiring, not just the logic. A
#                   correct barrier that nothing installs is decoration.
#   3 · ENUMERATE · every script that builds its own `pg.Pool` outside the
#                   barrier's reach, counted and RATCHETED. This is the gap the
#                   barrier cannot close by itself, so the gate's job is to keep
#                   it visible and shrinking instead of invisible and growing.
#   4 · PROOF     · run the proof test. It has been falsified in both
#                   directions: removing the install makes it name the missing
#                   patch AND report the INSERT reaching the real production
#                   host; making the target classifier fail open makes it name
#                   the guess.
#   5 · REACH     · no served code imports the scratch-database tooling. The
#                   `lib/adaptation-harness` modules TRUNCATE and rewrite every
#                   table they touch, and `fence.ts` is the predicate that
#                   decides whether that is allowed. A fence something in
#                   production consults is a fence something in production can
#                   be made to answer differently. Verification tooling under
#                   `web-v2/scripts` may import them; `app/` and `components/`
#                   may not. Added 2026-09-03: this invariant used to be held
#                   incidentally by fence.ts having NO importer at all, and
#                   `scripts/walk-substrate.ts` reusing its predicate ended
#                   that. Rule 20 — the property did not change, so the check
#                   had to become explicit rather than quietly lapse.
#
# ── WHAT THIS GATE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
#
#   · A human, or the real application, writing production. Deliberate. The app
#     must keep working for the runner.
#   · An HTTP write from a client that does not stamp itself. The stamp is
#     trusted, not verified.
#   · A write from a process that loads none of this — psql, the Railway
#     console, a workflow calling the live API. Guard 3 keeps the local half of
#     that set enumerated; the rest is outside any check in this repo.
#   · Whether the barrier is DEPLOYED. Rule 19: green is not deployed.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CORE="$ROOT/web-v2/lib/verify/production-barrier.ts"
HTTPC="$ROOT/web-v2/lib/verify/client-attestation.ts"
INSTALL="$ROOT/web-v2/lib/verify/install-barrier.ts"
PROOF="$ROOT/web-v2/lib/verify/_production_write_barrier.test.ts"
SETUP="$ROOT/web-v2/vitest.setup.ts"
POOL="$ROOT/web-v2/lib/db/pool.ts"
MW="$ROOT/web-v2/middleware.ts"
SWIFT="$ROOT/native-v2/Faff/Faff/API.swift"
MJS_FENCE="$ROOT/web-v2/scripts/_verification-fence.mjs"

# Floor, not a ceiling. The verification scripts that were found reaching the
# owner's own account with a write, and fenced. It may only GROW. If it drops,
# a fence was removed from a script that had one, which is the exact regression
# this line exists to catch.
FENCED_SCRIPT_MIN=16

# Ratchet. The number of files under web-v2/scripts that construct their own
# `pg.Pool` and therefore sit outside the barrier unless they opt in. It may
# SHRINK, never grow. When you convert one, lower this number in the same
# commit — that is what makes the allowlist a ratchet rather than a wish.
UNFENCED_SCRIPT_MAX=122

fail=0
say() { printf '%s\n' "$*"; }
bad() { printf '  FAIL · %s\n' "$*"; fail=1; }

say "check-write-barrier · verification tooling cannot write production"

# ── GUARD 1 · shape ─────────────────────────────────────────────────────────
say "guard 1 · barrier modules"

if [ ! -f "$CORE" ]; then
  bad "core module missing: $CORE · there is no barrier to install"
else
  for sym in \
    "export class ProductionWriteRefused" \
    "export function classifyProcess" \
    "export function classifyStatement" \
    "export function classifyDatabaseTarget" \
    "export function targetPermitsWrites" \
    "export function judge" \
    "export function productionWriteLedger" \
    "export function installProductionWriteBarrier" \
    "export function barrierIsInstalled"
  do
    grep -q "$sym" "$CORE" || bad "core module lost '$sym'"
  done

  # Rule 11 · three answers. A classifier that can only say production/local has
  # lost the one that matters, because "I cannot tell" is what a barrier that
  # fails open answers right before it fails open.
  grep -q "'indeterminate'" "$CORE" \
    || bad "target classifier no longer has an INDETERMINATE state · it can only guess"

  # The structural property: no configuration may promote a remote host.
  if grep -qE "FAFF_DB_TARGET[^\n]*(production|remote)" "$CORE"; then
    bad "FAFF_DB_TARGET appears to be able to name a remote target · that is an opt-out"
  fi
  # And no new escape hatch by any other name.
  for hatch in "ALLOW_PRODUCTION_WRITE" "SKIP_WRITE_BARRIER" "DISABLE_WRITE_BARRIER" "FAFF_BARRIER_OFF" "BARRIER_DISABLED"; do
    grep -q "$hatch" "$CORE" && bad "core module reads '$hatch' · an opt-out makes this a convention again"
  done

  # The barrier must not be a silent no-op. A swallowed refusal and a completed
  # write are the same value to a caller that ignores the result (lib/db/read.ts
  # is this repo's monument to that mistake).
  grep -q "console.error" "$CORE" || bad "core module no longer logs its refusal · a silent barrier is unfalsifiable"
  grep -q "attempted, " "$CORE" || bad "core module lost the 'N attempted, M issued' ledger sentence"
fi

if [ ! -f "$HTTPC" ]; then
  bad "endpoint classifier missing: $HTTPC · the path the incident actually took is unguarded"
else
  for sym in \
    "export const CLIENT_ENV_HEADER" \
    "export const VERIFICATION_HEADER" \
    "export function classifyServerPosture" \
    "export function judgeRequest"
  do
    grep -q "$sym" "$HTTPC" || bad "endpoint classifier lost '$sym'"
  done
  # It must stay pure: middleware runs on the edge runtime, and Rule 19 was
  # earned by exactly one module dragging `pg` somewhere it could not go.
  grep -qE "^import .*from 'pg'" "$HTTPC" && bad "endpoint classifier imports pg · it runs in edge middleware"
  grep -q "from './production-barrier'" "$HTTPC" \
    || bad "endpoint classifier no longer reuses classifyDatabaseTarget · two definitions of 'production'"
fi

[ -f "$INSTALL" ] || bad "install shim missing: $INSTALL"

# The `.mjs` fleet cannot import TypeScript, so `scripts/_verification-fence.mjs`
# carries COPIES of the four decisive literals. Where one definition cannot be
# shared, the next best thing is a check that fails the moment the two disagree
# — the posture check-palette-sync.sh already takes. Compare them verbatim.
if [ ! -f "$MJS_FENCE" ]; then
  bad "script fence missing: $MJS_FENCE · 122 .mjs scripts have no barrier available to them"
else
  for lit in "const LOOPBACK = " "const KNOWN_PRODUCTION_HOST = " "const READ_ONLY_LEAD = " "const DML_ANYWHERE = "; do
    a=$(grep -F "$lit" "$CORE" | head -1 | sed 's/^[[:space:]]*//')
    b=$(grep -F "$lit" "$MJS_FENCE" | head -1 | sed 's/^[[:space:]]*//')
    if [ -z "$a" ] || [ -z "$b" ]; then
      bad "literal '$lit' is missing from one of the two barriers · they can no longer be compared"
    elif [ "$a" != "$b" ]; then
      bad "DRIFT · '$lit' differs between the TS barrier and the .mjs fence"
      printf '        ts : %s\n' "$a"
      printf '        mjs: %s\n' "$b"
    fi
  done
  grep -q "X-Faff-Verification" "$MJS_FENCE" \
    || bad "script fence no longer stamps outgoing requests · a script driving the live API would look like the phone"
fi

# ── GUARD 2 · wiring ────────────────────────────────────────────────────────
say "guard 2 · armed where it has to be"

grep -q "verify/install-barrier" "$SETUP" \
  || bad "vitest.setup.ts does not arm the barrier · every test process is unfenced"
grep -q "verify/install-barrier" "$POOL" \
  || bad "lib/db/pool.ts does not arm the barrier"

if [ ! -f "$MW" ]; then
  bad "middleware.ts missing · the ingest endpoint the incident used is unguarded"
else
  grep -q "judgeRequest" "$MW" || bad "middleware.ts no longer calls the classifier"
  grep -q "'/api/:path\*'" "$MW" || bad "middleware.ts no longer matches /api · new routes would be uncovered"
fi

if [ ! -f "$SWIFT" ]; then
  say "  note · native-v2 not present in this checkout · the iOS stamp was not checked"
else
  grep -q "#if targetEnvironment(simulator)" "$SWIFT" \
    || bad "iOS client no longer stamps simulator builds at compile time"
  grep -q "X-Faff-Client-Env" "$SWIFT" \
    || bad "iOS client no longer sends X-Faff-Client-Env"
  grep -q "API.stampClientEnvironment(&req)" "$SWIFT" \
    || bad "authedSend no longer stamps the request · the stamp exists but nothing sends it"
fi

# ── GUARD 3 · what is still outside the fence, counted ──────────────────────
say "guard 3 · scripts outside the barrier (ratchet)"

SCRIPTS_DIR="$ROOT/web-v2/scripts"
if [ ! -d "$SCRIPTS_DIR" ]; then
  bad "web-v2/scripts missing · this guard scanned nothing"
else
  scanned=$(find "$SCRIPTS_DIR" -type f ! -name '._*' \( -name '*.mjs' -o -name '*.ts' -o -name '*.js' \) | wc -l | tr -d ' ')
  # Liveness. A scanner that reports clean because it read zero files is the
  # worst outcome available, since it also reports confidence (Rule 18).
  if [ "$scanned" -lt 50 ]; then
    bad "only $scanned script files scanned · the scanner is not reading the tree it claims to"
  fi
  unfenced=0
  while IFS= read -r f; do
    grep -qE "new (pg\.)?Pool\(" "$f" || continue
    grep -qE "_verification-fence|verify/install-barrier|FAFF_VERIFICATION|adaptation-harness/fence" "$f" && continue
    unfenced=$((unfenced + 1))
  done < <(find "$SCRIPTS_DIR" -type f ! -name '._*' \( -name '*.mjs' -o -name '*.ts' -o -name '*.js' \))

  fenced=$(grep -rl "_verification-fence" "$SCRIPTS_DIR" 2>/dev/null | grep -v "_verification-fence.mjs" | wc -l | tr -d ' ')
  say "  scanned $scanned script files · $unfenced construct their own pool outside the barrier · $fenced explicitly fenced"
  if [ "$fenced" -lt "$FENCED_SCRIPT_MIN" ]; then
    bad "$fenced fenced scripts, floor is $FENCED_SCRIPT_MIN · a fence was REMOVED from a verification script"
  fi
  if [ "$unfenced" -gt "$UNFENCED_SCRIPT_MAX" ]; then
    bad "$unfenced unfenced scripts, ratchet is $UNFENCED_SCRIPT_MAX · a NEW script was added outside the barrier."
    bad "  Either import lib/verify/install-barrier, or run it with FAFF_VERIFICATION=1, or"
    bad "  raise this number deliberately and say in the commit why that script must write."
  elif [ "$unfenced" -lt "$UNFENCED_SCRIPT_MAX" ]; then
    bad "$unfenced unfenced scripts but the ratchet still says $UNFENCED_SCRIPT_MAX · lower it (a stale ratchet stops meaning anything)"
  fi
fi

# ── GUARD 4 · the proof ─────────────────────────────────────────────────────
say "guard 4 · the proof test"

if [ ! -f "$PROOF" ]; then
  bad "proof test missing: $PROOF · this check cannot be satisfied by deleting it"
else
  # Demand the real describe/it blocks, not prose mentioning them. A tamper
  # check that any comment satisfies is not a tamper check (GATEAUDIT-4).
  grep -qE "describe\(['\"]WRITE BARRIER · a production write is REFUSED" "$PROOF" \
    || bad "proof test lost the headline describe block"
  grep -qE "describe\.skipIf\(!HAS_DATABASE\)" "$PROOF" \
    || bad "proof test lost its live section, or stopped skipping cleanly without credentials"
  grep -q "sim-recovery-live" "$PROOF" \
    || bad "proof test no longer reconstructs the incident's own payload"
  grep -q "1 write attempted, 0 issued" "$PROOF" \
    || bad "proof test no longer asserts the ledger sentence"

  # Regression case (2026-09-03 · walk-substrate incident): the barrier used to
  # judge every statement against process.env.DATABASE_URL regardless of which
  # connection issued it, so a verification process holding a loopback scratch
  # DB plus a SEPARATE client pointed at production had that second client's
  # writes pass straight through. Demand the case and the fix it proves stay
  # present, not just prose that mentions them (GATEAUDIT-4).
  grep -q "even while DATABASE_URL is loopback" "$PROOF" \
    || bad "proof test lost the per-connection target-resolution case (the walk-substrate incident) · the target must be judged per-connection, not against process.env"
  grep -q "export function connectionStringFromPgInstance" "$CORE" \
    || bad "core module lost connectionStringFromPgInstance · the barrier may be back to judging process.env instead of the connection issuing the statement"
fi

# ── GUARD 5 · the scratch-database tooling is out of the served graph ───────
say "guard 5 · no served code imports the scratch-database tooling"

# An ARRAY, not a space-joined string: this repo lives under a path with spaces
# in it, and word-splitting made `find` read zero files on the first run. The
# liveness assertion below is what caught that, which is the entire argument for
# having one (Rule 18 guard 2).
SERVED_DIRS=()
for d in "$ROOT/web-v2/app" "$ROOT/web-v2/components"; do
  [ -d "$d" ] && SERVED_DIRS+=("$d")
done
if [ ${#SERVED_DIRS[@]} -eq 0 ]; then
  bad "neither web-v2/app nor web-v2/components exists · this guard scanned nothing"
else
  # Liveness first. Reporting clean because the scan read no files is the worst
  # outcome available, since it also reports confidence.
  served_files=$(find "${SERVED_DIRS[@]}" -type f ! -name '._*' \( -name '*.ts' -o -name '*.tsx' \) | wc -l | tr -d ' ')
  if [ "$served_files" -lt 100 ]; then
    bad "only $served_files served files scanned · the scanner is not reading the tree it claims to"
  fi
  reach=$(grep -rlE "['\"][^'\"]*adaptation-harness/" "${SERVED_DIRS[@]}" \
            --include='*.ts' --include='*.tsx' 2>/dev/null || true)
  if [ -n "$reach" ]; then
    bad "served code imports lib/adaptation-harness · these modules truncate and rewrite tables:"
    echo "$reach" | while IFS= read -r f; do bad "    ${f#"$ROOT"/}"; done
    bad "  Verification tooling under web-v2/scripts may import them. Served code may not."
  else
    say "  scanned $served_files served files · 0 import the scratch-database tooling"
  fi
fi

if [ ! -d "$ROOT/web-v2/node_modules" ]; then
  say "  skip · no node_modules (cold container) · guards 1-3 and 5 stand"
else
  # BUILD SAFETY (2026-09-03). This gate runs inside `prebuild`, which Railway
  # executes during a production build with the app's own DATABASE_URL set. The
  # proof test's live section would then open a connection to the production
  # database from a build container — which is the wrong place to do it even
  # when it works, and a build that depends on database reachability is a build
  # that fails for reasons unrelated to the code. `DATABASE_URL` is stripped for
  # this invocation only, so `describe.skipIf(!HAS_DATABASE)` skips cleanly (the
  # behaviour guard 3 above already asserts) and all pure guards still run. The
  # live section still runs in `test-full` and in a local verify where
  # credentials are present.
  if ( cd "$ROOT/web-v2" && env -u DATABASE_URL -u DATABASE_URL_RO npx vitest run lib/verify/_production_write_barrier.test.ts >/tmp/_writebarrier.log 2>&1 ); then
    say "  ok · $(grep -oE 'Tests  [0-9]+ passed[^)]*' /tmp/_writebarrier.log | tail -1)"
  else
    bad "proof test failed · output follows"
    tail -40 /tmp/_writebarrier.log
  fi
fi

if [ "$fail" != "0" ]; then
  say ""
  say "FAILED · read the header of this file before changing anything."
  say "Do NOT weaken the barrier to make this pass. If a verification job needs to"
  say "write, point it at a LOOPBACK database it owns — lib/adaptation-harness/fence.ts"
  say "is the worked example, and it is why those harnesses still run."
  exit 1
fi
say "PASS"
