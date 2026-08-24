#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# check-client-sweep · the SWIFT side is swept, and the sweep still has teeth.
#
# WHY THIS EXISTS
#
# The TypeScript side has a surface sweep, a conservation harness, a reader
# lint and a swallowed-failure scanner. Between them they cover three of the
# four defect classes the owner found on his own screen. The fourth — a
# staleness that appeared only after backgrounding — lives in SwiftUI and is
# unreachable from TypeScript. `native-v2` decodes the wire and re-formats
# every number in it, so a value that leaves the server correct can still reach
# the runner wrong, and nothing would have known.
#
# `native-v2/Faff/FaffTests/ClientSweep/` is that harness. This script is its
# build-side half, and it exists because the harness has one failure mode worse
# than any bug it hunts: RUNNING NOTHING AND REPORTING CLEAN. That has already
# happened twice in this repo — check-wire-keys passed cleanly and every time
# over a watch wire it had never read, and check-xcodeproj-sync now carries
# "a check that inspects nothing must never report clean" for the same reason.
#
# So the guards below are aimed at the harness, not at the app. They ask
# whether the thing that would catch a defect is still capable of catching one.
#
# SEVEN GUARDS, exit 1 on any violation.
#
#   1 · every sweep file is present
#   2 · every sweep file is compiled (referenced by the generated pbxproj)
#   3 · no floor has been quietly lowered to nothing
#   4 · the generated format vectors are populated
#   5 · the generated format vectors are IN SYNC with the server formatters
#   6 · every recorded violation carries an honest reason
#   7 · the positive controls are still there
#
# Sibling of check-palette-sync.sh, check-doctrine.sh, check-wire-keys.sh and
# check-xcodeproj-sync.sh. Like them it is a NET, not a proof: it cannot tell
# you the sweep found everything, only that the sweep is still switched on.
# Running the sweep itself needs Xcode and a simulator; guard 8 does that when
# they are available and says so plainly when they are not, rather than
# implying coverage it did not get.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SWEEP="$ROOT/native-v2/Faff/FaffTests/ClientSweep"
PROJ="$ROOT/native-v2/Faff.xcodeproj/project.pbxproj"
VECTORS="$SWEEP/FormatVectors.generated.swift"

fail=0
note() { printf '%s\n' "$*"; }
bad() { note "check-client-sweep: FAIL — $*"; fail=1; }

# ── 1 · every sweep file is present ──────────────────────────────────────────
EXPECTED=(
  SweepLedger.swift
  WireMutator.swift
  WireProbe.swift
  WireCorpus.swift
  DecodeSweepTests.swift
  FormatConformanceTests.swift
  LifecycleSweepTests.swift
  RegisterSweepTests.swift
  SweepPositiveControlTests.swift
  FormatVectors.generated.swift
)

if [ ! -d "$SWEEP" ]; then
  bad "$SWEEP does not exist. The client sweep has been deleted wholesale."
  exit 1
fi

for f in "${EXPECTED[@]}"; do
  [ -f "$SWEEP/$f" ] || bad "$f is missing from ClientSweep/"
done

# ── 2 · every sweep file is actually compiled ────────────────────────────────
# A test file on disk but not in the project is a test that never runs, and it
# looks exactly like a test that passes. check-xcodeproj-sync catches this
# repo-wide; named here too because for THIS directory it is the whole point.
for f in "${EXPECTED[@]}"; do
  [ -f "$SWEEP/$f" ] || continue
  if ! grep -qF "$f" "$PROJ"; then
    bad "$f is on disk but not referenced by project.pbxproj — it never runs.
    Fix: cd native-v2 && xcodegen generate, then commit the result."
  fi
done

# ── 3 · no floor lowered to nothing ──────────────────────────────────────────
# Every sweep books its cases against a floor. A floor of zero turns the whole
# ledger back into a green light above an unwatched road.
floors=$(grep -rhoE 'floor: *[0-9_]+' "$SWEEP" | grep -oE '[0-9_]+' | tr -d '_' | sort -n)
if [ -z "$floors" ]; then
  bad "no floors found in ClientSweep/. The ledger's tripwire has been removed."
else
  lowest=$(printf '%s\n' "$floors" | head -1)
  count=$(printf '%s\n' "$floors" | wc -l | tr -d ' ')
  # `floor: 1` is legitimate inside the positive controls, which deliberately
  # build tiny ledgers. Everything else must be a real number.
  real=$(printf '%s\n' "$floors" | awk '$1 > 1' | wc -l | tr -d ' ')
  [ "$real" -ge 5 ] || bad "only $real meaningful floors across $count ledgers — floors are being zeroed out (lowest $lowest)"
fi

# ── 4 · the generated vectors are populated ──────────────────────────────────
if [ -f "$VECTORS" ]; then
  rows=$(grep -c 'V(fn:' "$VECTORS" || true)
  [ "${rows:-0}" -ge 120 ] \
    || bad "FormatVectors.generated.swift holds ${rows:-0} rows, below 120.
    Regenerate: cd web-v2 && UPDATE_FORMAT_VECTORS=1 npx vitest run lib/wire-format/"
  types=$(grep -c 'T(wire:' "$VECTORS" || true)
  [ "${types:-0}" -ge 15 ] \
    || bad "the workout-type vocabulary holds ${types:-0} entries, below 15"
fi

# ── 5 · vectors in sync with the server ──────────────────────────────────────
# The vectors are the contract. If someone edits the server formatter and does
# not regenerate, the Swift side goes on asserting yesterday's answers.
if [ -d "$ROOT/web-v2/node_modules" ]; then
  if ! (cd "$ROOT/web-v2" && npx vitest run lib/wire-format/ >/dev/null 2>&1); then
    bad "the format vectors have drifted from lib/wire-format/format.ts.
    Regenerate and READ THE DIFF: cd web-v2 && UPDATE_FORMAT_VECTORS=1 npx vitest run lib/wire-format/
    A regeneration run to make a test go green is exactly what this guards against."
  fi
else
  note "check-client-sweep: SKIPPED guard 5 (vector sync) — web-v2/node_modules absent."
fi

# ── 6 · every recorded violation carries a reason ────────────────────────────
# WireCorpus records known decode violations rather than silencing them, on the
# Rule 7 pattern. An entry with an empty reason is a silence with paperwork.
if [ -f "$SWEEP/WireCorpus.swift" ]; then
  if grep -nE '"(identity|list|zero|collapse)\|[^"]*" *: *""' "$SWEEP/WireCorpus.swift"; then
    bad "an exemption above carries an empty reason. Say what the runner would see, or delete the entry."
  fi
  # The staleness check lives in the test itself; this just proves the concept
  # has not been quietly removed.
  grep -q 'no longer fire' "$SWEEP/DecodeSweepTests.swift" \
    || bad "the exemption staleness check is gone from DecodeSweepTests — the known-violations list can now only grow."
fi

# ── 7 · the positive controls are still there ────────────────────────────────
# These are the only thing standing between "the sweep found nothing" and "the
# sweep cannot see". Each plants a known corruption and asserts it is caught.
if [ -f "$SWEEP/SweepPositiveControlTests.swift" ]; then
  for probe in FragileProbe DefaultingProbe testLedgerFailsWhenItExercisedNothing; do
    grep -q "$probe" "$SWEEP/SweepPositiveControlTests.swift" \
      || bad "positive control '$probe' has been removed. Without it a green sweep means nothing."
  done
fi

# ── 8 · run it, when the toolchain is here ───────────────────────────────────
# NAMED RATHER THAN SKIPPED SILENTLY. An unrun sweep reported as clean is the
# failure this whole directory exists to correct.
if [ "${CLIENT_SWEEP_RUN:-0}" = "1" ] && command -v xcodebuild >/dev/null 2>&1; then
  dest="${CLIENT_SWEEP_DEST:-}"
  if [ -z "$dest" ]; then
    note "check-client-sweep: CLIENT_SWEEP_RUN=1 but CLIENT_SWEEP_DEST is unset."
    note "  Set it to a simulator you own, e.g. CLIENT_SWEEP_DEST='id=<UDID>'."
    fail=1
  else
    note "check-client-sweep: running the sweep on $dest ..."
    (cd "$ROOT/native-v2" && xcodebuild -project Faff.xcodeproj -scheme Faff \
       -destination "$dest" \
       -only-testing:FaffTests/DecodeSweepTests \
       -only-testing:FaffTests/FormatConformanceTests \
       -only-testing:FaffTests/LifecycleSweepTests \
       -only-testing:FaffTests/RegisterSweepTests \
       -only-testing:FaffTests/SweepPositiveControlTests \
       test >/dev/null 2>&1) || bad "the client sweep itself failed. Run it directly to read the findings."
  fi
else
  note "check-client-sweep: NOT RUN — this pass checked only that the harness is"
  note "  intact and switched on, not that the app is clean. Set CLIENT_SWEEP_RUN=1"
  note "  and CLIENT_SWEEP_DEST='id=<simulator-udid>' to actually execute it."
fi

if [ "$fail" -ne 0 ]; then
  exit 1
fi

note "check-client-sweep: OK — harness intact (${#EXPECTED[@]} files, floors set, controls present)."
