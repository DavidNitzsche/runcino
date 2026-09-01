#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# check-coercion.sh · a measured zero is not an absence (2026-08-30, COERCION-1)
#
# Seventeenth sibling of check-palette-sync.sh / check-doctrine.sh /
# check-swallowed-failure.sh, wired the same way (web-v2 prebuild → Railway
# build).
#
# check-swallowed-failure stops a FAILED READ being served as a FACT.
# This one stops a REAL READING being thrown away as a NON-ANSWER — and covers
# the failures that live one indirection outside that scanner's reach.
#
# ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
#
# CLAUDE.md Rule 11 says "don't know", "measured zero" and "the read failed"
# are three facts, never one, and its own enforcement paragraph says only half
# of it is gated:
#
#   > `check-swallowed-failure.sh` and its ratcheted `EMPTIED_BASELINE` cover
#   > the catch-and-return-empty half. The coercion half — `x > 0 ? x :
#   > undefined` over a legitimately-zero measurement — is not yet gated and
#   > should be.
#
# This is that half. The incident it is named for: `recentQualityPerWeek`
# returned a correct, measured ZERO — the runner was in a prescribed recovery
# block and had genuinely done no quality work — and `x > 0 ? x : undefined`
# turned it into "no signal", which the caller answered with FULL quality
# density. THE SAFEST POSSIBLE READING OF THE DATA PRODUCED THE MOST AGGRESSIVE
# PLAN.
#
# ── WHAT IT CANNOT CATCH · Rule 22 ──────────────────────────────────────────
#
# Stated in full in lib/audit/coercion-scan.ts's header and in the test's. The
# short version, because a green run from this script proves less than it looks:
#
#   · it sees READERS, never CONSUMERS — whether an erased zero disables a
#     safety mechanism or blanks a caption is not a syntactic property, and the
#     load-bearing / peripheral split is a proxy for blast radius, not a
#     measurement of it;
#   · it sees TWO states, not three — nothing here tells "the read failed" from
#     "there is no data"; both arrive as null;
#   · it sees EXPRESSIONS, not statements — `let x = null; if (n > 0) x = n;`
#     is invisible, and so is a PARENTHESISED test, because the matcher anchors
#     on an identifier;
#   · it is ONE-SIDED — every assertion fires on the engine being too
#     confident, and none fires on it refusing too readily. Over-refusal is a
#     real failure mode and this gate would not catch it.
#
# ── FOUR GUARDS, exit 1 on any violation ────────────────────────────────────
#
#   1 · SCANNER    · the scanner, the registry and the gate test all exist and
#       PRESENT      still export the entry points the gate drives them
#                    through. This file cannot be made to pass by deleting the
#                    thing it runs.
#
#   2 · REGISTRY   · coercion-registry.ts parses, is not empty, has one
#       SHAPE        single-line `id:` and one `reason:` per argued entry, no
#                    duplicates, every id shaped `path::symbol::expr` (never a
#                    line number — those rot), every reason long enough to be
#                    an argument, and numeric baselines. Pure sed and grep, so
#                    it runs on a cold container with no TypeScript toolchain.
#
#   3 · HANDED     · every HANDED_BACK entry is printed, itemised, on every
#       BACK         single run. These are real violations in files their
#                    session could not edit — NOT exemptions. See the argument
#                    in the registry, and flip HANDED_BACK_FAILS once routed.
#
#   4 · FULL GATE  · the scanner itself, via vitest: the named ratchet in both
#                    directions, the peripheral count ratchet with no slack,
#                    every argued exemption still naming a real site, and —
#                    GUARD 0 — liveness floors on files, conditionals and catch
#                    handlers actually parsed, plus positive controls over
#                    nested ternaries, comments, template literals and optional
#                    chaining, and NEGATIVE controls proving an arithmetic
#                    guard is not reported.
#
# GUARD 0 IS THE POINT, and it is the same point its sibling makes. A scanner
# that opens no files and reports clean is exactly the bug being hunted, one
# level up: a broken parser rendered as a clean codebase, reporting CONFIDENCE
# while it does it. This repo has shipped a gate that ran `mkdir -p` on the
# directory it audited and passed three guards over zero files.
#
# ── IF THE GATE FIRES ───────────────────────────────────────────────────────
#
# Three fixes, in order of preference. Do not reach for the third first.
#
#   1 · Return the three states distinguishably. The model is
#       `lib/training/normal-window.ts`'s `NormalReading<T>`: a discriminated
#       union whose refusal branch carries NO `value` field, so `reading.value`
#       does not compile until the caller has branched on `reading.ok`. That
#       converts Rule 11 from a discipline into a TYPE ERROR, which is the
#       strongest enforcement available and the reason to prefer it over a
#       convention, a comment, or a nullable.
#   2 · Fail CLOSED. If a guard cannot run, assume the thing it guards against
#       happened. A missing input must never silently disable a safety
#       mechanism.
#   3 · Argue it in COERCION_ARGUED, finishing this sentence honestly:
#       "absent, measured-zero and failed lead to the same outcome for every
#       consumer, because ___". Not every zero is a refusal — a count of zero
#       races IS zero races — and over-applying this rule makes the engine
#       refuse to answer questions it can answer, which is its own failure.
#
# NEVER widen the classifier to swallow a real violation. That is the same move
# as the ternary that started this.
#
# ── SHELL NOTES, inherited from check-swallowed-failure.sh ──────────────────
#
#   · `set -uo pipefail` WITHOUT -e, and no early-exiting consumer (`grep -q`,
#     `head`) at the end of a pipe: pipefail turns a SIGPIPE into a failure,
#     and only on large inputs — a gate that passes in testing and fails in CI.
#   · sed rather than awk: BSD awk (macOS) and mawk (most Linux images) both
#     lack gawk's 3-argument match().
#   · Run as `bash scripts/check-coercion.sh`. Inside a Claude Code shell
#     `grep` is a function shim that false-negatives on a leading `(^|[^...])`
#     group; a script invoked with bash gets the real /usr/bin/grep.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGISTRY="$ROOT/web-v2/lib/audit/coercion-registry.ts"
SCANNER="$ROOT/web-v2/lib/audit/coercion-scan.ts"
GATE_TEST="$ROOT/web-v2/lib/audit/_coercion_scan.test.ts"
SIBLING="$ROOT/web-v2/lib/audit/swallow-scan.ts"
NORMAL="$ROOT/web-v2/lib/training/normal-window.ts"

fail=0

# ── 1 · SCANNER PRESENT (checked first — everything else depends on it) ──────
for f in "$REGISTRY" "$SCANNER" "$GATE_TEST" "$SIBLING" "$NORMAL"; do
  if [ ! -f "$f" ]; then
    echo "COERCION FAIL · missing ${f#"$ROOT/"}"
    echo "  This gate cannot be deleted to make a build pass."
    exit 1
  fi
done

# The scanner must still export what the gate drives it through. Anchored on
# the opening paren, NOT a fixed-string prefix: `grep -F "scanTree"` happily
# matches `scanTreeX`, so a rename slipped straight through the first version
# of the sibling gate. A guard a rename defeats is not a guard.
for sym in scanSource scanTree isArithmeticGuard crossesBoundary findBlindIndirect ternaryColon; do
  n=$(grep -cE "^export function ${sym}[[:space:]]*(<|\()" "$SCANNER")
  if [ "$n" -eq 0 ]; then
    echo "COERCION FAIL · $SCANNER no longer exports \`${sym}()\`"
    echo "  The gate test drives the scanner through these. Restore it, or update both"
    echo "  the test and this list — never just one."
    fail=1
  fi
done

# The scanner is deliberately built ON its sibling's parser rather than forking
# it — masking, brace matching and symbol resolution are the same problem and
# were solved once, painfully. If that import goes, the two have diverged and
# one of them is about to start lying.
if ! grep -qE "from '\./swallow-scan'" "$SCANNER"; then
  echo "COERCION FAIL · $SCANNER no longer imports its sibling's parser"
  echo "  maskSource / matchParen / enclosingSymbol are shared on purpose. A fork of them"
  echo "  drifts, and a drifted parser reports clean."
  fail=1
fi

# Rule 22 requires a gate to state what it CANNOT fail on. Check the sentence
# is actually there rather than trusting that somebody wrote it.
if ! grep -q "CANNOT CATCH" "$SCANNER"; then
  echo "COERCION FAIL · $SCANNER has no 'WHAT THIS SCANNER CANNOT CATCH' section"
  echo "  Rule 22: a gate inherits the bias of whoever wrote it. State what it is"
  echo "  structurally incapable of catching, or the next reader will over-trust it."
  fail=1
fi

# ── 2 · REGISTRY SHAPE ───────────────────────────────────────────────────────
# Both lists carry the same `id:` / `reason:` shape and both are validated
# below. The COUNT is taken per-list, because reporting "35 argued exemptions"
# when 28 were argued and 7 were handed back is exactly the kind of number that
# gets quoted later as evidence of something it is not.
ids=$(sed -n "s/^[[:space:]]*id:[[:space:]]*'\([^']*\)',[[:space:]]*$/\1/p" "$REGISTRY")
n_id=$(sed -n '/^export const COERCION_ARGUED/,/^\];/p' "$REGISTRY" \
  | grep -cE "^[[:space:]]*id:[[:space:]]*'")
n_reason=$(grep -cE "^[[:space:]]*reason:[[:space:]]*'" "$REGISTRY")
n_all_id=$(printf '%s\n' "$ids" | sed '/^$/d' | wc -l | tr -d ' ')

if [ "$n_id" -eq 0 ]; then
  echo "COERCION FAIL · registry has no entries"
  echo "  Either the format contract broke or the registry was emptied. Both are findings —"
  echo "  an empty exemption list with a non-empty codebase means nothing is being checked."
  exit 1
fi

if [ "$n_all_id" -ne "$n_reason" ]; then
  echo "COERCION FAIL · registry format contract broken"
  echo "  found $n_all_id id: lines and $n_reason reason: lines"
  echo "  Every entry needs exactly one of each, single-line and single-quoted, so this"
  echo "  guard can run with no TypeScript toolchain. Fix the entry you just added."
  fail=1
fi

# `path/to/file.ts::symbolName::testExpression`. Never a line number. Bracket
# expression order matters: `]` first, `-` last, or the class silently means
# something else. Route paths carry `[id]` segments, hence both brackets.
malformed=$(printf '%s\n' "$ids" | sed '/^$/d' \
  | grep -vE '^[]A-Za-z0-9_./[-]+\.tsx?::[A-Za-z_$<][A-Za-z0-9_$>]*::[^:]+$' || true)
if [ -n "$malformed" ]; then
  echo "COERCION FAIL · id(s) that are not <file>::<symbol>::<expr>:"
  printf '    %s\n' $malformed
  echo "  Anchor on the enclosing function name and the tested expression, never a line."
  fail=1
fi

dupes=$(printf '%s\n' "$ids" | sed '/^$/d' | sort | uniq -d || true)
if [ -n "$dupes" ]; then
  echo "COERCION FAIL · duplicate id(s):"
  printf '    %s\n' $dupes
  echo "  One of the two entries is never read."
  fail=1
fi

thin=$(sed -n "s/^[[:space:]]*reason:[[:space:]]*'\(.\{0,59\}\)',[[:space:]]*$/\1/p" "$REGISTRY")
if [ -n "$thin" ]; then
  echo "COERCION FAIL · reason(s) too short to be an argument:"
  printf '    %s\n' "$thin"
  echo "  An exemption with no reason is not an exemption, it is a site nobody looked at."
  fail=1
fi

baseline=$(sed -n 's/^export const PERIPHERAL_BASELINE = \([0-9][0-9]*\);.*$/\1/p' "$REGISTRY")
if [ -z "$baseline" ]; then
  echo "COERCION FAIL · PERIPHERAL_BASELINE missing or not a plain integer"
  echo "  The ratchet needs a number this script can read with no TypeScript toolchain."
  fail=1
fi

# The named ratchet must be non-trivial. An empty LOAD_BEARING_KNOWN with a
# non-empty codebase means the list was wiped rather than earned.
n_known=$(sed -n '/^export const LOAD_BEARING_KNOWN/,/^\];/p' "$REGISTRY" \
  | grep -cE "^  '[^']+',$")
if [ "${n_known:-0}" -lt 1 ]; then
  echo "COERCION FAIL · LOAD_BEARING_KNOWN is empty or unparseable"
  echo "  A ratchet with nothing on it does not fail when a site is added; it just"
  echo "  silently accepts the whole tree. If the codebase really is clean, say so"
  echo "  in a comment and leave the list empty deliberately — but check first."
  fail=1
fi

# ── 3 · HANDED BACK · printed on EVERY run, never buried ─────────────────────
n_handed=$(sed -n '/^export const HANDED_BACK:/,/^\];/p' "$REGISTRY" \
  | grep -cE "^[[:space:]]*id:[[:space:]]*'")
handed_fails=$(sed -n 's/^export const HANDED_BACK_FAILS = \([a-z]*\);.*$/\1/p' "$REGISTRY")
# 2026-09-01 · every handed-back entry now carries an `owner:`. Before it did,
# "awaiting an owner" was equally true of all seven forever and nothing told a
# routed entry apart from an abandoned one. Counted here as well as asserted in
# the vitest stage, so a cold container still catches a missing one.
n_handed_owner=$(sed -n '/^export const HANDED_BACK:/,/^\];/p' "$REGISTRY" \
  | grep -cE "^[[:space:]]*owner:[[:space:]]*'")
if [ "${n_handed:-0}" -ne "${n_handed_owner:-0}" ]; then
  echo "COERCION FAIL · ${n_handed} handed-back entries but ${n_handed_owner} owner: lines"
  echo "  A handed-back collapse with no owner is not staged, it is abandoned. Name the"
  echo "  system that owns the decision (docs/BRAIN_CONSTITUTION.md's ownership table)."
  fail=1
fi
# The ratchet the vitest stage enforces. Counted here so a cold container can
# still see the two lists disagree.
n_handed_known=$(sed -n '/^export const HANDED_BACK_KNOWN:/,/^\];/p' "$REGISTRY" \
  | grep -cE "^[[:space:]]*'[^']*',")
if [ "${n_handed:-0}" -ne "${n_handed_known:-0}" ]; then
  echo "COERCION FAIL · ${n_handed} handed-back entries but ${n_handed_known} on HANDED_BACK_KNOWN"
  echo "  The ratchet and the list must agree. An entry off the ratchet is a NEW collapse;"
  echo "  a ratchet id with no entry is stale and must be deleted."
  fail=1
fi
if [ "${n_handed:-0}" -gt 0 ]; then
  echo ""
  echo "COERCION · ${n_handed} known collapse(s) still open (HANDED_BACK_FAILS=${handed_fails:-?}):"
  sed -n '/^export const HANDED_BACK:/,/^\];/p' "$REGISTRY" \
    | sed -n "s/^[[:space:]]*id:[[:space:]]*'\([^']*\)',[[:space:]]*$/    · \1/p"
  echo "  These are NOT exemptions. They are LIVE Rule 11 collapses, each with a named"
  echo "  owner in the registry. Fix them, delete the entry AND its HANDED_BACK_KNOWN"
  echo "  line, and set HANDED_BACK_FAILS = true once the list is empty."
  echo ""
fi

# ── 4 · FULL GATE ────────────────────────────────────────────────────────────
VITEST="$ROOT/web-v2/node_modules/.bin/vitest"
if [ "${COERCION_SKIP_VITEST:-}" = "1" ]; then
  echo "coercion · vitest stage skipped (COERCION_SKIP_VITEST=1)"
elif [ -x "$VITEST" ]; then
  if ! (cd "$ROOT/web-v2" && "$VITEST" run lib/audit/_coercion_scan.test.ts --silent); then
    echo "COERCION FAIL · a measured zero can still reach a caller as an absence (see above)."
    echo "  Fix the reader, fail closed, or argue the exemption. Never widen the classifier."
    fail=1
  fi
else
  # ── RULE 18 point 2 · A GATE THAT CHECKS NOTHING MAY NOT REPORT OK ────────
  #
  # Until 2026-09-01 this branch printed a caveat and then fell through to
  # `exit 0` with "coercion OK · N argued exemptions, N on the named ratchet". Four gate stages did the
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
    echo "COERCION FAIL · node_modules is present but $VITEST is not executable"
    echo "  devDependencies were pruned. The shape checks above ran; the SCANNER did not,"
    echo "  and this stage will not report OK over a check it did not perform."
    echo "  Install devDependencies, or set COERCION_SKIP_VITEST=1 to skip it deliberately."
    fail=1
  else
    echo "coercion · no node_modules (cold container) · ran the shape check only"
  echo "  ($n_id argued exemptions, $n_known named ratchet entries, peripheral baseline ${baseline:-?})"
  fi
fi

if [ "$fail" -eq 0 ]; then
  echo "coercion OK · $n_id argued exemptions, $n_known on the named ratchet, peripheral baseline ${baseline:-?}"
fi
exit $fail
