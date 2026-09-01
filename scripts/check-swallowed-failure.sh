#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# check-swallowed-failure.sh · a failure is not an answer (2026-08-24)
#
# Tenth sibling of check-palette-sync.sh / check-doctrine.sh /
# check-generated-content.sh, wired the same way (web-v2 prebuild → Railway
# build). check-doctrine stops a bad NUMBER reaching a runner's legs.
# check-generated-content stops a good SENTENCE never reaching their eyes.
# This one stops a FAILED READ being served to them as a FACT.
#
# ── THE INCIDENT ────────────────────────────────────────────────────────────
#
# `plan_workouts.date_iso` is a TEXT day key. Four shipped queries compared it
# against a `date` or a `timestamp`. Postgres refuses that outright —
# `operator does not exist: text >= timestamp with time zone` — and all four
# wrapped the call in `.catch(() => empty)`.
#
# So a hard type error became an empty result, and an empty result is a
# perfectly good answer:
#
#   · the drift monitor's entire pace axis had NEVER fired for any runner, and
#     reported that as "no drift";
#   · two per-day-type baselines were permanently null;
#   · `runner_calibration.data_quality` sat at `cold-start` for every runner,
#     because the `>= 3 → building` gate counted a number that was an error.
#
# Nobody noticed for months, because A SWALLOWED FAILURE AND AN HONEST NOTHING
# ARE THE SAME VALUE. Every test passed. Every gate was green. The sweep that
# produced this script found seventeen more of the same shape, including a
# password change that had never once ended another session while reporting
# `other_sessions_ended: 0` as though it were a count.
#
# ── THREE GUARDS, exit 1 on any violation ───────────────────────────────────
#
#   1 · REGISTRY   · swallowed-failure-registry.ts parses, is not empty, has
#       SHAPE        one single-line `id:` and one `reason:` per entry, no
#                    duplicate ids, every id shaped `path::symbol` (never a
#                    line number — those rot), every reason long enough to be
#                    an argument, and a numeric EMPTIED_BASELINE. Pure sed and
#                    grep, so it runs on a cold container with no TypeScript
#                    toolchain — the same posture as check-doctrine.sh.
#
#   2 · SCANNER    · the scanner and its test still exist and still export the
#       PRESENT      entry points the gate depends on. This file cannot be made
#                    to pass by deleting the thing it runs.
#
#   3 · FULL GATE  · the scanner itself, via vitest: every fabricated-value site
#                    argued, no exemption outliving its bug, the empty-result
#                    ratchet neither slipped nor left slack, and — GUARD 0 —
#                    floors on files and database statements actually parsed,
#                    plus positive controls over multi-line SQL, a `.catch` on
#                    a different line from its query, a brace inside a SQL
#                    string, and SQL-shaped prose in a comment.
#
# GUARD 0 IS THE POINT. A scanner that opens no files and reports clean is
# exactly the bug being hunted, one level up: a broken parser rendered as a
# clean codebase. It must refuse to pass on nothing.
#
# ── IF THE GATE FIRES ───────────────────────────────────────────────────────
#
# Do not add a registry entry to make it pass unless you can honestly finish:
#   "absent and failed lead to the same outcome for every consumer, because ___"
# Otherwise pick one:
#   · return null (lib/db/read.ts · rowsOrNull / rowOrNull / attempt);
#   · fail CLOSED — for a guard, assume the thing it guards against happened;
#   · outage() (lib/route/failure.ts) — for a route, say you could not read.
#
# ── SHELL NOTES, learned the hard way in this repo ──────────────────────────
#
#   · `set -uo pipefail` WITHOUT -e, and no early-exiting consumer (`grep -q`,
#     `head`) at the end of a pipe: pipefail turns a SIGPIPE from an early exit
#     into a failure, and only on large inputs, which is a gate that passes in
#     testing and fails in CI.
#   · sed rather than awk: BSD awk (macOS) and mawk (most Linux images) both
#     lack gawk's 3-argument match(), and a gate with two code paths is a gate
#     only ever tested on one of them.
#   · Run this as `bash scripts/check-swallowed-failure.sh`. Inside a Claude
#     Code shell `grep` is a function shim that false-negatives on a leading
#     `(^|[^...])` group; a script invoked with bash gets the real /usr/bin/grep.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGISTRY="$ROOT/web-v2/lib/audit/swallowed-failure-registry.ts"
SCANNER="$ROOT/web-v2/lib/audit/swallow-scan.ts"
GATE_TEST="$ROOT/web-v2/lib/audit/_swallow_scan.test.ts"
READ_HELPER="$ROOT/web-v2/lib/db/read.ts"

fail=0

# ── 2 · SCANNER PRESENT (checked first — the others depend on it) ────────────
for f in "$REGISTRY" "$SCANNER" "$GATE_TEST" "$READ_HELPER"; do
  if [ ! -f "$f" ]; then
    echo "SWALLOWED-FAILURE FAIL · missing ${f#"$ROOT/"}"
    echo "  This gate cannot be deleted to make a build pass."
    exit 1
  fi
done

# The scanner must still export what the gate drives it through. A rename that
# silently orphans the test would leave a green build and no scanning at all.
# Anchored on the opening paren, NOT a fixed-string prefix: `grep -F "…scanTree"`
# happily matches `scanTreeX`, so a rename slipped straight through the first
# version of this check. A guard that a rename defeats is not a guard.
for sym in scanSource scanTree classifyFallback maskSource; do
  n=$(grep -cE "^export function ${sym}[[:space:]]*\(" "$SCANNER")
  if [ "$n" -eq 0 ]; then
    echo "SWALLOWED-FAILURE FAIL · $SCANNER no longer exports \`${sym}()\`"
    echo "  The gate test drives the scanner through these. Restore it, or update both"
    echo "  the test and this list — never just one."
    fail=1
  fi
done

# ── 1 · REGISTRY SHAPE ───────────────────────────────────────────────────────
ids=$(sed -n "s/^[[:space:]]*id:[[:space:]]*'\([^']*\)',[[:space:]]*$/\1/p" "$REGISTRY")
n_id=$(printf '%s\n' "$ids" | sed '/^$/d' | wc -l | tr -d ' ')
n_reason=$(grep -cE "^[[:space:]]*reason:[[:space:]]*'" "$REGISTRY")

if [ "$n_id" -eq 0 ]; then
  echo "SWALLOWED-FAILURE FAIL · registry has no entries"
  echo "  Either the format contract broke or the registry was emptied. Both are findings —"
  echo "  an empty exemption list with a non-empty codebase means nothing is being checked."
  exit 1
fi

if [ "$n_id" -ne "$n_reason" ]; then
  echo "SWALLOWED-FAILURE FAIL · registry format contract broken"
  echo "  found $n_id id: lines and $n_reason reason: lines"
  echo "  Every entry needs exactly one of each, single-line and single-quoted, so this"
  echo "  guard can run with no TypeScript toolchain. Fix the entry you just added."
  fail=1
fi

# `path/to/file.ts::symbolName`. Never a line number — the incident's own bug
# report cites `00b:196-204`, which was already fragile when it was written.
# Bracket-expression order matters: `]` first, `-` last, or the class silently
# means something else. Route paths carry `[id]` segments, hence both brackets.
malformed=$(printf '%s\n' "$ids" | sed '/^$/d' \
  | grep -vE '^[]A-Za-z0-9_./[-]+\.tsx?::[A-Za-z_$<][A-Za-z0-9_$>]*$' || true)
if [ -n "$malformed" ]; then
  echo "SWALLOWED-FAILURE FAIL · id(s) that are not <file>::<symbol>:"
  printf '    %s\n' $malformed
  echo "  Anchor on the enclosing function name, never on a line number."
  fail=1
fi

dupes=$(printf '%s\n' "$ids" | sed '/^$/d' | sort | uniq -d || true)
if [ -n "$dupes" ]; then
  echo "SWALLOWED-FAILURE FAIL · duplicate id(s):"
  printf '    %s\n' $dupes
  echo "  One of the two entries is never read."
  fail=1
fi

# A one-word reason is not an argument. 60 characters is roughly a clause with
# a "because" in it, which is the bar.
thin=$(sed -n "s/^[[:space:]]*reason:[[:space:]]*'\(.\{0,59\}\)',[[:space:]]*$/\1/p" "$REGISTRY")
if [ -n "$thin" ]; then
  echo "SWALLOWED-FAILURE FAIL · reason(s) too short to be an argument:"
  printf '    %s\n' "$thin"
  echo "  An exemption with no reason is not an exemption, it is a site nobody looked at."
  fail=1
fi

baseline=$(sed -n 's/^export const EMPTIED_BASELINE = \([0-9][0-9]*\);.*$/\1/p' "$REGISTRY")
if [ -z "$baseline" ]; then
  echo "SWALLOWED-FAILURE FAIL · EMPTIED_BASELINE missing or not a plain integer"
  echo "  The ratchet needs a number this script can read without a TypeScript toolchain."
  fail=1
fi

# ── 3 · FULL GATE ────────────────────────────────────────────────────────────
VITEST="$ROOT/web-v2/node_modules/.bin/vitest"
if [ "${SWALLOW_SKIP_VITEST:-}" = "1" ]; then
  echo "swallowed-failure · vitest stage skipped (SWALLOW_SKIP_VITEST=1)"
elif [ -x "$VITEST" ]; then
  if ! (cd "$ROOT/web-v2" && "$VITEST" run lib/audit/_swallow_scan.test.ts --silent); then
    echo "SWALLOWED-FAILURE FAIL · a database failure can still reach a runner as an answer (see above)."
    echo "  Fix the read, or argue the exemption. Never widen the classifier to swallow a"
    echo "  real violation — that is the same move as the .catch that started this."
    fail=1
  fi
else
  # ── RULE 18 point 2 · A GATE THAT CHECKS NOTHING MAY NOT REPORT OK ────────
  #
  # Until 2026-09-01 this branch printed a caveat and then fell through to
  # `exit 0` with "swallowed-failure OK · N argued exemptions, empty-result baseline N". Four gate stages did the
  # same. Railway builds with `npm install` and vitest is a devDependency, so
  # any environment that omits devDeps turned four gates into registry-SHAPE
  # checks that still announced confidence — reporting clean because they
  # looked at nothing, which is the worst outcome available.
  #
  # The COLD-CONTAINER case is real and stays honest: with no `node_modules`
  # at all, the shape checks above genuinely stand on their own (that is what
  # the sed-and-grep format contract is FOR) and the newer gates
  # (check-normal-window, check-client-graph, check-automatic-mutations,
  # check-goal-immutability) say exactly this. But `node_modules` PRESENT and
  # vitest missing is a pruned install, not a cold container, and the two must
  # not report the same way.
  if [ -d "$ROOT/web-v2/node_modules" ]; then
    echo "SWALLOWED-FAILURE FAIL · node_modules is present but $VITEST is not executable"
    echo "  devDependencies were pruned. The shape checks above ran; the SCANNER did not,"
    echo "  and this stage will not report OK over a check it did not perform."
    echo "  Install devDependencies, or set SWALLOW_SKIP_VITEST=1 to skip it deliberately."
    fail=1
  else
    echo "swallowed-failure · no node_modules (cold container) · ran the shape check only"
  echo "  ($n_id argued exemptions, empty-result baseline ${baseline:-?})"
  fi
fi

if [ "$fail" -eq 0 ]; then
  echo "swallowed-failure OK · $n_id argued exemptions, empty-result baseline ${baseline:-?}"
fi
exit $fail
