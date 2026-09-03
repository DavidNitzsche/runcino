#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# check-watch.sh · watch app conformance gate (2026-08-24)
#
# Third sibling of check-palette-sync.sh and check-doctrine.sh. Those two stop
# a bad colour and a bad number reaching production. This one stops a watch
# board that has never been executed or never been looked at.
#
# The incident it generalises: the watch engine's tests lived under legacy/,
# whose xcodeproj has no widget target and therefore cannot compile the watch
# app at all. 33 tests sat in a target no buildable project contained. They had
# NEVER run. When they were finally wired into native-v2 and executed, one was
# failing on a real product defect. Tests that never run are worse than no
# tests — they read as coverage.
#
# WHY THIS IS NOT WIRED INTO web-v2's prebuild, where the other two live.
# Railway's build container has no Xcode, no simulators and no watchOS SDK.
# Hanging this off `prebuild` would mean one of two outcomes and both are bad:
# the build breaks on every deploy, or the script learns to skip itself when
# Xcode is absent — which is every Railway build, so it would never once run
# where it was wired. A gate that always skips is the failure this file exists
# to fix, dressed as CI. So it is wired to the one automated thing this repo
# already has that runs on a Mac: the pre-push hook (.githooks/pre-push, the
# same hook that typechecks web-v2). See docs/design/watch-0821/FACE-QC.md.
#
# Four guards, exit 1 on any violation:
#
#   1. PROJECT       · `xcodegen generate` before anything else. native-v2's
#      FRESHNESS       project.yml is the ONLY file that knows which sources
#                      belong to the watch targets. A stale checked-in pbxproj
#                      is exactly how 33 tests ran where 165 exist — and
#                      xcodebuild reports that as ** TEST SUCCEEDED **.
#
#   2. ENGINE        · the whole suite, run SERIALLY, plus a count floor
#      TESTS           derived from the source: every `@Test` declaration in
#                      the test directory must have a case that executed. An
#                      exit code alone cannot tell "165 passed" from "0 ran".
#
#   3. BOARD         · a representative set of boards rendered on a booted
#      GEOMETRY        watch simulator and audited pixel-by-pixel by
#                      scripts/watch/geom.py against Apple's content box.
#                      Skipped by --fast, and skipped honestly (not failed)
#                      when no watch simulator is booted.
#
#   4. THE RUN IS  · every board the reveal gesture can land on must be one
#      ENDABLE       the runner can end the run from. Source-level, because
#                    the decision lives in private SwiftUI view members that
#                    no test in the suite can reach.
#
#                    TWICE NOW. The fuel takeover (WMomentFuel) swallowed the
#                    controls gesture on an opaque persistent board — "could
#                    not pause, could not end the run ... forever on a
#                    single-phase race". Then on 2026-09-02 the recovery board
#                    did the same thing by a different route: `controlsShowing`
#                    drove both boards and the controls layer excluded
#                    `.recovery`, so every strides session ended on a "Walk
#                    back" with three dead verbs and no fourth. David force-quit
#                    and 0.43 mi of his run died with the process.
#
#                    A rule with no gate is a hypothesis (CLAUDE.md rule 20),
#                    and a comment saying "controls are always reachable" is
#                    documentation, not enforcement. This is the enforcement.
#
# Usage:
#   bash scripts/check-watch.sh            # all three guards
#   bash scripts/check-watch.sh --fast     # guards 1-2 only, no simulator
#
# Env overrides: WATCH_SIM (render), WATCH_TEST_SIM (tests), WATCH_TEST_DD,
# WATCH_FACES_OUT.
#
# ─────────────────────────────────────────────────────────────────────────────
# THE VERDICT, AND WHY IT IS THREE WORDS AND NOT TWO  (2026-09-03)
#
# Until this change the last line of a green run said `watch OK` whether or not
# guard 3 had rendered a single board, and a machine with no `xcodebuild` at all
# printed `SKIPPED` and exited 0 — which `verify-commit.sh` records verbatim as
#
#     PASS  check-watch.sh
#
# So the two ways this gate can fail to RUN were indistinguishable, on the
# summary line, from the way it passes. That is the exact failure the file's own
# header calls "a gate that always skips ... dressed as CI", pointed at itself,
# and Rule 18's worst outcome: reporting clean because it looked at nothing
# reports confidence along with the emptiness.
#
# There are now four verdicts and they are not interchangeable:
#
#   OK          every guard that exists ran and passed.
#   PARTIAL     everything that ran passed, and at least one guard did NOT run.
#               Exit 0 — a missing watch simulator must not block a push, or
#               the gate becomes the unpassable kind instead. The line NAMES
#               the guard that was skipped and why, so the skip cannot be read
#               as coverage.
#   UNRUNNABLE  the toolchain this gate needs is absent, so NOTHING was checked.
#               Exit 3. Non-zero on purpose: `verify-commit.sh` and
#               `.githooks/pre-push` both branch on `if ! bash ...`, so this
#               surfaces as a loud failure rather than as a PASS over a run
#               that executed no guard at all. It was exit 0 before, and that
#               is how the watch gate could report confidence about a commit on
#               a machine that had never compiled it.
#   FAIL        a guard ran and found something. Exit 1.
#
# Every run ends with one `WATCH-GATE:` line carrying the verdict and the
# per-guard state, so a caller that only keeps the last line of stdout still
# knows which guards executed.
#
# WHAT THIS GATE CANNOT FAIL ON  (Rule 22)
#
#   · It cannot see the PHONE. Nothing here compiles, runs or renders the iOS
#     target; a watch-only green says nothing about the app that pairs with it.
#   · It cannot see a real WRIST. Guard 3 renders the `_FacePreview` harness on
#     a simulator, so a board that is correct in the harness and wrong against
#     live engine state passes here. Rule 13's "render it with real data" is
#     not satisfied by this gate and never has been.
#   · It cannot see SERVER PARITY. The wrist's own answers are asserted by the
#     Swift suite; whether the server agrees is `_watch_grader_parity.test.ts`.
#   · It cannot see a payload key the watch never decodes. A field the server
#     adds and the watch ignores compiles, tests green, and renders fine —
#     `coverage` shipped that way for days. `scripts/check-wire-keys.sh` owns
#     that question, not this file.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

# Resolve repo root the same way check-web-build.sh does. When invoked from a
# git hook, $0 lives in the hooks directory and dirname math lands on .git —
# not the repo root — so the gate would silently no-op on every push.
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "$0")/.." && pwd))"
PROJ="$ROOT/native-v2"
TESTS_DIR="$ROOT/legacy/native/Faff/FaffWatch Watch AppTests"

# Series 11 46mm. geom.py's margins are the 46mm content box (x=15 y=18 w=178
# h=212), so the render half is only meaningful on this device. Auditing a
# 42mm screenshot against 46mm guides reports overflow on every board.
SIM="${WATCH_SIM:-DC794E30-23E7-475B-AECD-05DC44E39A75}"

# ...and a DIFFERENT watch for the tests, because the two halves fight over one
# simulator's app container. shoot.sh installs a plain app build under the same
# bundle id the test host runs as (run.faff.app.watchkitapp), and that build
# has no PlugIns/FaffWatch Watch AppTests.xctest inside it. Render, then test,
# and the run dies with "Failed to load test bundle … Check that the bundle
# exists on disk" while xcodebuild's summary names whichever test happened to
# be in flight — a healthy test reported as a product failure. Reproduced twice
# on consecutive full runs; an uninstall between them was not enough.
#
# The engine tests are pure logic, so the device model is irrelevant to them;
# only the RENDER half needs the 46mm. Resolved by search rather than hardcoded
# so this works on a machine with a different set of simulators.
resolve_test_sim() {
  [ -n "${WATCH_TEST_SIM:-}" ] && { printf '%s' "$WATCH_TEST_SIM"; return; }
  local found
  found="$(xcrun simctl list devices available 2>/dev/null \
           | awk '/^-- watchOS/{w=1;next} /^-- /{w=0} w' \
           | grep -oE '\([0-9A-F]{8}-[0-9A-F-]{27}\)' | tr -d '()' \
           | grep -v "^$SIM$" | head -1)"
  printf '%s' "${found:-$SIM}"
}
TEST_SIM="$(resolve_test_sim)"

# Deliberately NOT /tmp/faff-watch-dd, which scripts/watch/shoot.sh owns. Two
# xcodebuild invocations sharing one derived-data path collide on the build
# database ("database is locked"), and a human running shoot.sh by hand while
# the hook fires should not fail the push.
DD="${WATCH_TEST_DD:-/tmp/faff-wtest}"
OUT="${WATCH_FACES_OUT:-/tmp/faff-gate-faces}"
LOG="/tmp/faff-watch-gate.log"

FAST=0
for arg in "$@"; do
  case "$arg" in
    --fast) FAST=1 ;;
    -h|--help) sed -n '2,50p' "$0"; exit 0 ;;
    *) echo "check-watch: unknown argument '$arg' (expected --fast)"; exit 2 ;;
  esac
done

# ── The representative set ───────────────────────────────────────────────────
# One board from each of the eight categories in _FacePreview, biased toward
# the worst case in each: the longest string, the widest number, the most rows.
# FACE-QC rule 19 — round numbers hide width bugs, so `p1ugly` (10:59 /
# 5:59:59 / 100.0 / 204) earns its place over `p1`, and `raceugly` over `race`.
# FACE-QC rule 20 says re-check EVERY board after touching a shared component;
# this set is the cheap always-on floor under that, not a replacement for it.
BOARDS=(
  p1ugly p1nohr alwayson p2min          # running · widest values, no-HR, AOD
  p1hrceiling                           # running · pace in band, HR amber on
                                        #   its ceiling — the Q41 disagreement,
                                        #   and the only board in the set that
                                        #   carries two grades at once.
  raceugly threshold m4band             # phases · race, steady, graded band
  controls controlsrep endconfirm       # controls · three verbs, rep variant, confirm
  gps waterlock ceilingoverride         # faults · sensor names, lock, override
  ceiling                               # faults · breach + the pace/HR conflict line
                                        #   Added 2026-09-03 with that line (Q41).
                                        #   The board gained a fourth row and was
                                        #   in no QC set, so nothing would have
                                        #   measured it against the content box.
  msplit mphaselong                     # moments · split, longest phase copy
  lobbyintervals lobbyweek              # lobby · structured session, week strip
  summary racecomplete firstlaunch      # finish · summary, race finish, cold start
)

fail=0
note() { printf '%s\n' "$*"; }

# ── The verdict ledger ───────────────────────────────────────────────────────
#
# Every guard records what it actually DID here, and the final line is built
# from these rather than from the exit code. `skipped` is the list of guards
# that did not run: non-empty means the verdict is PARTIAL at best, however
# green everything else came back.
skipped=""
skip() { skipped="${skipped}${skipped:+, }$1"; }

# One line, always, machine-readable, last. A caller that keeps only the tail of
# stdout still learns which guards ran — which is the whole point: a skip that
# does not reach the summary is a skip that reads as coverage.
declare_verdict() {
  local verdict="$1" detail="$2"
  printf 'WATCH-GATE: %s · %s\n' "$verdict" "$detail"
}

# NOTHING was checked. Exit 3, not 0 — see the header. The caller must be able
# to tell "the watch is fine" from "no machine here can answer that".
unrunnable() {
  declare_verdict "UNRUNNABLE" "no guard executed — $1"
  exit 3
}

# Human-readable model for whatever UDID is configured, so the "boot it" hint
# names a watch rather than a hex string.
sim_name() {
  xcrun simctl list devices 2>/dev/null | grep -F "$SIM" \
    | sed -E 's/^[[:space:]]*(.*) \('"$SIM"'\).*$/\1/' | head -1
}

# ── 0 · TOOLCHAIN ────────────────────────────────────────────────────────────
if ! command -v xcodebuild >/dev/null 2>&1; then
  note "WATCH UNRUNNABLE · no xcodebuild on this machine."
  note "  This gate needs a Mac with Xcode. It is a pre-push hook for exactly"
  note "  that reason — Railway's build container could never run it."
  note ""
  note "  This used to exit 0, which verify-commit.sh records as 'PASS"
  note "  check-watch.sh' — a green line over a run that compiled nothing. It"
  note "  now exits 3 so the caller aborts loudly instead. If you genuinely"
  note "  intend to push watch code from a machine that cannot build it, say so"
  note "  explicitly with --no-verify; do not let a gate claim it checked."
  unrunnable "xcodebuild absent"
fi

if ! command -v xcodegen >/dev/null 2>&1; then
  note "WATCH FAIL · xcodegen is not installed (brew install xcodegen)"
  note "  Without it the gate would test whatever the checked-in pbxproj happens"
  note "  to contain, which is the precise defect this gate exists to catch."
  note "  Skipping the gate is not an option here — install it, or push with"
  note "  --no-verify and say so."
  unrunnable "xcodegen absent"
fi

if [ ! -d "$TESTS_DIR" ]; then
  note "WATCH FAIL · test sources missing at legacy/native/Faff/FaffWatch Watch AppTests"
  note "  The watch gate cannot be deleted to make a push pass."
  declare_verdict "FAIL" "test sources missing — the gate cannot be deleted to make a push pass"
  exit 1
fi

# ── 0 · THE PREREQUISITE xcodegen NEEDS AND THE REPO DOES NOT TRACK ──────────
#
# `project.yml` names Secrets.xcconfig as the base configuration for both
# Debug and Release, and Secrets.xcconfig is gitignored (`.gitignore:43`). So
# xcodegen refuses with "Invalid config file" wherever the file is absent:
#
#   · a fresh clone, and any cold CI container
#   · EVERY verify-commit run, on every commit that touches a native path.
#     `scripts/verify-commit.sh` runs `git clean -fdx` on its reusable
#     worktree before each verification, and `-x` deletes ignored files, so
#     the file is removed immediately before this gate needs it. That made
#     this gate unpassable there rather than merely unreliable, which is the
#     inverse of the failure Rule 18 warns about and just as bad: a check
#     nobody can get green stops being read.
#
# Seeded from the tracked example, which is exactly what the file is for and
# what the README tells a human to do by hand. Never overwrites a real one.
if [ ! -f "$PROJ/Secrets.xcconfig" ] && [ -f "$PROJ/Secrets.example.xcconfig" ]; then
  cp "$PROJ/Secrets.example.xcconfig" "$PROJ/Secrets.xcconfig"
  note "watch · seeded native-v2/Secrets.xcconfig from the example (it is gitignored)"
fi

# ── 1 · PROJECT FRESHNESS ────────────────────────────────────────────────────
PBX="$PROJ/Faff.xcodeproj/project.pbxproj"
before=""
[ -f "$PBX" ] && before="$(shasum "$PBX" | cut -d' ' -f1)"

if ! (cd "$PROJ" && xcodegen generate) > "$LOG" 2>&1; then
  note "WATCH FAIL · xcodegen could not generate native-v2/Faff.xcodeproj"
  sed -n '1,20p' "$LOG"
  declare_verdict "FAIL" "guard 1 (project freshness) — xcodegen could not generate the project"
  exit 1
fi

# Two different questions, and only the second one survives a second run:
#   · did THIS run change the file?   (before != after)
#   · does the file differ from HEAD? (git)
# The first is silent the moment anyone has already run xcodegen locally, which
# is exactly when the committed project is still stale. So ask git.
after="$(shasum "$PBX" | cut -d' ' -f1)"
# ...and ignore the identifiers xcodegen re-mints on every run.
#
# The Secrets.xcconfig seeded above is UNTRACKED, so xcodegen has no stable
# identity to hash for it and emits a fresh `TEMP_<uuid>` file reference each
# time. Every run therefore changed the pbxproj, so this NOTE fired on every
# run — including runs where the committed project was perfectly current.
#
# A warning that always fires is a warning nobody reads, which is the same
# failure as a gate that always skips (rule 18) wearing the opposite costume:
# it trains the reader to scroll past the one time it means something. So the
# question is asked about the SOURCES, not about a random identifier: strip the
# TEMP_ lines and see whether any real difference is left.
pbx_diff="$(git -C "$ROOT" diff -U0 -- "$PBX" 2>/dev/null \
            | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' \
            | grep -v 'TEMP_[0-9A-F-]\{36\}')"
if [ -n "$pbx_diff" ]; then
  note "watch · NOTE · native-v2/Faff.xcodeproj/project.pbxproj differs from the"
  note "  version in git. The tests below ran against the project xcodegen just"
  note "  built from project.yml, so this run is honest — the committed one is not."
  note "  Stage it, or the next person to clone gets a project that compiles a"
  note "  different set of sources than the one you tested."
  [ "$before" != "$after" ] && note "  (this run is what changed it)"
fi

# ── 2 · ENGINE TESTS ─────────────────────────────────────────────────────────
# Serially, always. Under xcodebuild's default parallel testing the suite is
# split across cloned simulators, and HostileInputTests — which drives the
# engine through a hand-rolled clock on the main actor — reported 11 spurious
# expectation failures (elapsed 15 where 2400 was asked). Same tree, same
# commit, green when serialised. A gate that cries wolf gets switched off.
#
# The uninstall covers the fallback case where this machine has only one watch
# simulator, so TEST_SIM and the render's SIM are the same device and a
# previous render has left a plain app build — no test bundle inside it — under
# run.faff.app.watchkitapp. See the TEST_SIM comment at the top; separating the
# two devices is the real fix, this is the seatbelt for when it cannot.
run_tests() {
  xcrun simctl uninstall "$TEST_SIM" run.faff.app.watchkitapp >/dev/null 2>&1
  (cd "$PROJ" && xcodebuild test \
      -project Faff.xcodeproj \
      -scheme "FaffWatch Watch AppTests" \
      -destination "id=$TEST_SIM" \
      -derivedDataPath "$DD" \
      -parallel-testing-enabled NO) > "$LOG" 2>&1
}

run_tests
rc=$?

# One retry, and only when the test HOST died rather than a test failing.
#
# The test host's bundle id is run.faff.app.watchkitapp — the same id
# scripts/watch/shoot.sh terminates and relaunches to take a screenshot. Anyone
# shooting boards on this simulator while the suite runs kills the test host
# mid-run, and xcodebuild reports it as "Test crashed with signal kill" or
# "Restarting after unexpected exit" with a test name attached, which is
# indistinguishable from a genuine crash in that test.
#
# Retrying is safe because a genuine crash reproduces. What it costs is one
# extra minute on a real crash that only fires intermittently — worth it
# against a gate that flakes every time someone renders a board.
if [ $rc -ne 0 ] && grep -qE "never finished bootstrapping|Restarting after unexpected exit|crashed with signal|Failed to load test bundle" "$LOG"; then
  note "watch · test host died rather than a test failing · retrying once"
  note "  (usual cause: something else drove $TEST_SIM — shoot.sh terminates and"
  note "   relaunches the same bundle id the test host runs under.)"
  run_tests
  rc=$?
fi

# Compile/link errors specifically, and only when nothing ran — a passing log
# can still contain the word "error" in a simulator diagnostic.
if ! grep -q "Test run with" "$LOG" \
   && grep -qE "\.swift:[0-9]+:[0-9]+: error:|^error: |ld: error:" "$LOG"; then
  note "WATCH FAIL · the watch test target did not compile"
  grep -E "\.swift:[0-9]+:[0-9]+: error:|^error: |ld: error:" "$LOG" | head -20 | sed 's/^/  /'
  note "  full log: $LOG"
  declare_verdict "FAIL" "guard 2 (engine tests) — the watch test target did not compile"
  exit 1
fi

# Executed count, from the Swift Testing summary line:
#   ✔ Test run with 165 tests in 8 suites passed after 20.8 seconds.
executed="$(grep -oE "Test run with [0-9]+ tests" "$LOG" | tail -1 | grep -oE "[0-9]+")"

# Declared count, from the sources. Deriving the floor instead of hardcoding it
# means adding a test file raises the bar automatically — and a test file the
# project stops compiling drops the executed count below it. `._*` are the
# AppleDouble sidecars this exFAT volume mints beside every file; they are not
# Swift.
declared=0
while IFS= read -r f; do
  declared=$(( declared + $(grep -cE '^[[:space:]]*@Test' "$f") ))
done < <(find "$TESTS_DIR" -maxdepth 1 -name '*.swift' -not -name '._*')

if [ -z "$executed" ]; then
  note "WATCH FAIL · the test run produced no summary line at all"
  note "  xcodebuild exit code was $rc. This is the shape that reads as a pass:"
  note "  ** TEST SUCCEEDED ** over 'Executed 0 tests'. Do not trust the exit code."
  note "  full log: $LOG"
  fail=1
elif [ "$executed" -lt "$declared" ]; then
  note "WATCH FAIL · $executed test cases ran, but $declared @Test declarations exist"
  note "  A test that does not run is not coverage. Two causes, in order of odds:"
  note "    · a test file is not in the FaffWatch Watch AppTests target — check"
  note "      the sources list in native-v2/project.yml, then re-run."
  note "    · a test is .disabled or the run was filtered."
  note "  full log: $LOG"
  fail=1
fi

if [ $rc -ne 0 ]; then
  note "WATCH FAIL · watch engine tests failed"
  # Name every failing test and quote the expectation that broke, so the push
  # message alone is enough to know where to look.
  issues="$(grep -E "^✘ Test .* recorded an issue" "$LOG" \
            | sed -E 's/^✘ Test /  /; s/ recorded an issue at /\n      /; s/: Expectation failed: /\n      /')"
  if [ -n "$issues" ]; then
    printf '%s\n' "$issues" | head -60
  else
    # No expectation was recorded, so nothing failed an assertion — the test
    # process died inside these. xcodebuild's own "Failing tests:" block is the
    # only place their names appear.
    note "  no expectation failed — the test process died inside:"
    grep -E "^[[:space:]]*[A-Za-z_]+\.[A-Za-z_]+\(\)$" "$LOG" | sort -u | head -20 | sed 's/^[[:space:]]*/    /'
  fi
  note "  full log: $LOG"
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  tests_line="$executed test cases ($declared @Test declarations)"
fi

# ── 3 · BOARD GEOMETRY ───────────────────────────────────────────────────────
render_note=""

# Degrade, do not fail — booting a watch simulator takes a minute and a push is
# not the moment to do it silently. But every branch below MUST call `skip`, so
# the run's verdict drops to PARTIAL and the last line names the guard that did
# not execute. Before 2026-09-03 these branches only wrote `render_note`, which
# was interpolated into a line that still began `watch OK`.
if [ "$FAST" = "1" ]; then
  render_note="render SKIPPED · --fast"
  skip "guard 3 board geometry (--fast)"
elif ! xcrun simctl list devices booted 2>/dev/null | grep -q "$SIM"; then
  render_note="render SKIPPED · watch simulator $SIM is not booted"
  skip "guard 3 board geometry (no booted 46mm simulator)"
  note "watch · $render_note"
  note "  Board geometry was NOT checked on this run. To include it:"
  note "    xcrun simctl boot $SIM   # $(sim_name)"
  note "    bash scripts/check-watch.sh"
elif ! python3 -c "import PIL" >/dev/null 2>&1; then
  render_note="render SKIPPED · python3 has no Pillow (pip3 install Pillow)"
  skip "guard 3 board geometry (no Pillow)"
  note "watch · $render_note"
  note "  Board geometry was NOT checked on this run."
else
  mkdir -p "$OUT"
  rm -f "$OUT"/*.png

  if ! OUT="$OUT" SIM="$SIM" bash "$ROOT/scripts/watch/shoot.sh" "${BOARDS[@]}" > "$LOG.render" 2>&1; then
    note "WATCH FAIL · could not render the boards"
    sed -n '1,20p' "$LOG.render" | sed 's/^/  /'
    fail=1
  else
    # A board that produced no PNG is a board nobody looked at. shoot.sh's own
    # loop does not check that simctl actually wrote the file.
    missing=""
    for b in "${BOARDS[@]}"; do
      [ -s "$OUT/$b.png" ] || missing="$missing $b"
    done
    if [ -n "$missing" ]; then
      note "WATCH FAIL · no screenshot was written for:$missing"
      fail=1
    else
      pngs=()
      for b in "${BOARDS[@]}"; do pngs+=("$OUT/$b.png"); done

      geom_out="$(python3 "$ROOT/scripts/watch/geom.py" "${pngs[@]}" 2>&1)"
      geom_rc=$?

      # geom.py prints EMPTY for a board with no foreground and moves on — it
      # is not counted as an overflow, so it does not affect its exit code. An
      # empty board IS a failure here, but it is also the one flake this rig
      # has: simctl can screenshot before the board has finished drawing. So
      # re-shoot only the empty ones, against the binary already installed,
      # and believe the second answer.
      empties="$(printf '%s\n' "$geom_out" | awk '/EMPTY/ {print $1}')"
      if [ -n "$empties" ]; then
        note "watch · re-shooting board(s) that came back blank: $(echo $empties)"
        # shellcheck disable=SC2086
        OUT="$OUT" SIM="$SIM" SKIP_BUILD=1 bash "$ROOT/scripts/watch/shoot.sh" $empties >/dev/null 2>&1
        geom_out="$(python3 "$ROOT/scripts/watch/geom.py" "${pngs[@]}" 2>&1)"
        geom_rc=$?
        empties="$(printf '%s\n' "$geom_out" | awk '/EMPTY/ {print $1}')"
      fi

      if [ -n "$empties" ]; then
        note "WATCH FAIL · board(s) rendered blank:$(printf ' %s' $empties)"
        note "  Nothing was drawn inside the content box. Launch it by hand:"
        note "    xcrun simctl launch $SIM run.faff.app.watchkitapp -face ${empties%% *}"
        fail=1
      fi

      if [ $geom_rc -ne 0 ]; then
        note "WATCH FAIL · board(s) outside Apple's content box (46mm: x 15..193, y 18..230)"
        printf '%s\n' "$geom_out" | grep -E "OVERFLOW" | sed 's/^ */  /'
        note "  Screenshots are in $OUT. FACE-QC.md rules 14 and 28: usable content is"
        note "  196pt on a 46mm, and a line pinned to the foot is measured from the"
        note "  bezel (Guides.bottomInset), never from a fixed offset."
        fail=1
      fi

      render_note="${#BOARDS[@]} boards inside Apple's content box"
    fi
  fi
fi

# ── 4 · THE RUN IS ENDABLE ───────────────────────────────────────────────────
#
# Liveness first (rule 18): a scanner that reports clean because it read
# nothing is the worst outcome available, since it also reports confidence.
ROUTER="$ROOT/legacy/native/Faff/FaffWatch Watch App/WatchRouterV5.swift"
if [ ! -f "$ROUTER" ]; then
  note "WATCH FAIL · WatchRouterV5.swift not found at $ROUTER"
  note "  This guard cannot be deleted by moving the file it watches."
  fail=1
else
  endable_read=$(wc -l < "$ROUTER" | tr -d ' ')
  if [ "$endable_read" -lt 100 ]; then
    note "WATCH FAIL · WatchRouterV5.swift is only $endable_read lines — guard 4 read nothing useful."
    fail=1
  fi

  # 4a · the controls layer may not be gated on the phase type.
  #
  # `controlsLayer` is the ONLY board carrying Pause and End run. Any condition
  # that suppresses it for a KIND of phase re-creates 2026-09-02 exactly. The
  # window scanned is the `if router.controlsShowing` block in `body`.
  ctrl_block=$(awk '/if router\.controlsShowing,/{f=1} f{print} f&&/controlsLayer/{exit}' "$ROUTER")
  if [ -z "$ctrl_block" ]; then
    note "WATCH FAIL · guard 4a found no 'if router.controlsShowing, ... controlsLayer' block."
    note "  Either the controls layer moved or its condition was rewritten. Both need"
    note "  a human to confirm End run is still reachable from every face."
    fail=1
  elif printf '%s' "$ctrl_block" | grep -q 'currentPhase?\.type'; then
    note "WATCH FAIL · the controls board is suppressed for a phase TYPE:"
    printf '%s\n' "$ctrl_block" | grep -n 'currentPhase?\.type' | sed 's/^/    /'
    note "  Pause and End run live on that board and nowhere else, so this makes the"
    note "  run unendable for the whole of that phase. That is the 2026-09-02 defect"
    note "  (a strides session ending on a 'Walk back') and the fuel-takeover defect"
    note "  before it. If a phase needs its own board, draw it as the FACE and let"
    note "  the reveal gesture open controls over it — see showsExtendRecovery."
    fail=1
  fi

  # 4b · a face-owning predicate must exclude overtime.
  #
  # `advance()` sets planComplete and does NOT move currentIndex, so the last
  # phase answers its own type forever afterwards while every verb that acts on
  # it guards `!planComplete`. A board drawn there is a board of dead buttons.
  if ! grep -q 'private var showsExtendRecovery' "$ROUTER"; then
    note "WATCH FAIL · showsExtendRecovery is gone. It is the single predicate that"
    note "  decides whether the recovery board owns the face; without it the two"
    note "  boards can disagree again (CLAUDE.md rule 16)."
    fail=1
  else
    pred=$(awk '/private var showsExtendRecovery/{f=1} f{print} f&&/^    }/{exit}' "$ROUTER")
    if ! printf '%s' "$pred" | grep -q '!engine\.planComplete'; then
      note "WATCH FAIL · showsExtendRecovery no longer excludes overtime (!engine.planComplete):"
      printf '%s\n' "$pred" | sed 's/^/    /'
      note "  In overtime endCurrentPhase() and recordRecoveryExtension() are both"
      note "  no-ops, so this board would draw two buttons that do nothing."
      fail=1
    fi
  fi

  # 4c · the summary boards keep a DRAWN way off.
  #
  # Both ended a run on tap-anywhere alone. David, 2026-09-02: "there is not
  # done or save or anything button."
  if ! grep -q 'var onDone: (() -> Void)? = nil' "$ROOT/legacy/native/Faff/FaffWatch Watch App/FacesFinishV5.swift"; then
    note "WATCH FAIL · FinishSummaryBoard lost its drawn onDone control."
    note "  Tap-anywhere is not an affordance on the last screen of a run."
    fail=1
  fi
fi

# ── 5 · THE RUNNER-EXPERIENCE CONTRACT, Q41-Q43 ──────────────────────────────
#
# `docs/RUNNER_EXPERIENCE_CONTRACT.md` § Watch is a product rule, and rule 20
# says a product rule with no gate is a hypothesis. These four clauses were all
# decided, written down, and three of them were violated anyway, because nothing
# could tell:
#
#   · the HR ceiling was to be a guardrail turning amber. The HR row was built
#     with no `grade:` argument at all and was white for the whole of every run.
#   · the disagreement instruction did not exist; the breach board stated a
#     number and offered nothing to do about it.
#   · the plan-done cue said "Session complete." and never named the choice,
#     which is the exact moment the 2026-09-02 truncation happened at.
#
# Source-level, for the same reason guard 4 is: these live in private SwiftUI
# view members that no test in the suite can construct. Liveness first — a
# scanner that reads nothing must fail rather than report clean.
FOUNDATION="$ROOT/legacy/native/Faff/FaffWatch Watch App/WorkoutFoundation.swift"
ENGINE="$ROOT/legacy/native/Faff/FaffWatch Watch App/WorkoutEngine.swift"
PHONESYNC="$ROOT/legacy/native/Faff/FaffWatch Watch App/PhoneSync.swift"

contract_read=0
for f in "$ROUTER" "$FOUNDATION" "$ENGINE" "$PHONESYNC"; do
  if [ ! -f "$f" ]; then
    note "WATCH FAIL · guard 5 cannot find $(basename "$f")."
    note "  This guard cannot be deleted by moving the file it watches."
    fail=1
  else
    contract_read=$(( contract_read + $(wc -l < "$f" | tr -d ' ') ))
  fi
done
if [ "$contract_read" -lt 1000 ]; then
  note "WATCH FAIL · guard 5 read only $contract_read lines across four files — it read nothing useful."
  fail=1
fi

# 5a · NO RED. `MetricGrade` is the type every live metric's colour comes from,
# and the contract's "no red failure state from a momentary excursion" holds
# structurally only while that enum has no red case to reach for. If someone
# adds one, the guardrail can go red without a single call site changing.
if grep -qE 'case (neutral|onTarget|drifting)' "$FOUNDATION"; then
  if grep -n 'WatchV5\.fault' "$FOUNDATION" | grep -q 'MetricGrade' \
     || sed -n '/^enum MetricGrade/,/^}/p' "$FOUNDATION" | grep -qE 'fault|\.red|failed'; then
    note "WATCH FAIL · MetricGrade gained a red/fault case."
    sed -n '/^enum MetricGrade/,/^}/p' "$FOUNDATION" | sed 's/^/    /'
    note "  Q41: 'no red failure state from a momentary excursion'. A live metric"
    note "  may be white or amber. Red on a running board is a fault (a dead"
    note "  sensor), never a judgement of the runner."
    fail=1
  fi
else
  note "WATCH FAIL · guard 5a could not find MetricGrade's cases in WorkoutFoundation.swift."
  note "  The enum moved or was renamed; re-point this guard rather than deleting it."
  fail=1
fi

# 5b · the HR row is GRADED, and there is exactly ONE place that builds it.
#
# Written as two questions rather than one regex over the constructor, because
# the constructor spans two lines and a line-oriented "does this line say
# grade:" reports the helper itself as the violation — which it did, on this
# guard's first run. A check that cannot pass on correct code is the unpassable
# kind (rule 18), so it asks what it actually means instead:
#
#   i.  the one builder grades the row; and
#   ii. nothing else builds one, because a second builder is where an ungraded
#       row would come back — five call sites drew this row before hrMetric,
#       and a grade added to four of them is the rule-16 split exactly.
if ! sed -n '/private var hrMetric: WorkoutMetric?/,/^    }/p' "$ROUTER" \
     | grep -q 'grade: hrCeilingGrade'; then
  note "WATCH FAIL · hrMetric no longer grades the heart-rate row."
  sed -n '/private var hrMetric: WorkoutMetric?/,/^    }/p' "$ROUTER" | sed 's/^/    /'
  note "  Q41 asks the HR ceiling to be a secondary guardrail turning amber on"
  note "  approach or excess. An ungraded row is white for the whole run and"
  note "  says nothing at all about the limit the plan set."
  fail=1
fi
# Comment lines excluded — this guard's own explanation names the row.
hr_builders=$(grep -E 'role: "Heart rate"' "$ROUTER" | grep -cv '^[[:space:]]*//')
if [ "$hr_builders" -ne 1 ]; then
  note "WATCH FAIL · $hr_builders places build a heart-rate row in WatchRouterV5 (expected 1):"
  grep -nE 'role: "Heart rate"' "$ROUTER" | grep -v '[0-9]*:[[:space:]]*//' | sed 's/^/    /'
  note "  hrMetric is the only builder on purpose. A second one is how the phase"
  note "  board and the running face come to answer the same question two ways."
  fail=1
fi
if ! grep -q 'private var hrCeilingGrade: MetricGrade' "$ROUTER"; then
  note "WATCH FAIL · hrCeilingGrade is gone — the single resolver for how close"
  note "  the runner is to the prescribed HR ceiling. Without it the phase board"
  note "  and the running face can answer that question differently (rule 16)."
  fail=1
fi
# ...and it must still DEFER to the engine for 'is he over it', rather than
# re-deriving the comparison. Two copies of that answer is the rule-16 split.
if ! sed -n '/private var hrCeilingGrade: MetricGrade/,/^    }/p' "$ROUTER" \
     | grep -q 'engine.hrOverCeiling'; then
  note "WATCH FAIL · hrCeilingGrade no longer reads engine.hrOverCeiling."
  note "  The engine owns 'over the ceiling'. The row may add an APPROACH band"
  note "  on top of it; it may not answer the same question a second way."
  fail=1
fi

# 5c · the pace/HR disagreement instruction exists and is still gated on the
# measurement. An ungated version would print 'pace is on target' over a run
# that is off the band, which is rule 16's other half.
if ! grep -q 'private var paceHrConflictLine' "$ROUTER"; then
  note "WATCH FAIL · paceHrConflictLine is gone."
  note "  Q41: 'a concise instruction when they disagree — protect the effort"
  note "  rather than forcing pace.' Without it the breach board states a number"
  note "  and gives the runner nothing to do with it."
  fail=1
elif ! sed -n '/private var paceHrConflictLine/,/^    }/p' "$ROUTER" | grep -q 'paceGrade == .inBand'; then
  note "WATCH FAIL · paceHrConflictLine is no longer gated on the pace being in band."
  note "  It says 'Pace is on target'. Said over an off-band rep that is false,"
  note "  and there is no disagreement to resolve — the two agree it is too hard."
  fail=1
fi

# 5d · the plan-done cue names BOTH options.
#
# Q42, verbatim: "Workout complete. Continue running or finish recording." The
# cue said only the first clause. A runner told the workout is complete and not
# told the watch is still recording is the 2026-09-02 truncation.
if ! grep -q 'Continue running or finish recording' "$ENGINE"; then
  note "WATCH FAIL · the plan-done cue no longer names both options."
  grep -n 'SpokenCues.shared.say(' "$ENGINE" | sed 's/^/    /'
  note "  Q42: on finishing structured work, say 'Workout complete. Continue"
  note "  running or finish recording.' Stating the fact without the choice is"
  note "  how 'the plan is over' gets heard as 'the run is over'."
  fail=1
fi

# 5e · the watch test host cannot reach production.
#
# Not a Q41-Q43 clause — a process one, and the most expensive failure this
# programme has had. The test host IS the watch app, whose completion POST goes
# out over a BACKGROUND URLSession that no URLProtocol fence can intercept, so
# the barrier has to move the base URL.
if ! grep -q 'isHostingTests' "$PHONESYNC"; then
  note "WATCH FAIL · PhoneSync lost its test-host fence."
  note "  FaffWatch Watch AppTests runs INSIDE the watch app, whose apiBase was"
  note "  https://www.faff.run and whose POST paths mint real rows in the"
  note "  owner's training history. The iPhone target has been fenced since the"
  note "  2026-08-21 phantom-run incident; this is the watch's equivalent."
  fail=1
elif ! sed -n '/private var apiBase: URL/,/^    }/p' "$PHONESYNC" | grep -q 'isHostingTests'; then
  note "WATCH FAIL · apiBase no longer consults the test-host fence."
  sed -n '/private var apiBase: URL/,/^    }/p' "$PHONESYNC" | sed 's/^/    /'
  note "  The constant existing is not the same as it being read."
  fail=1
fi

# ── THE VERDICT ──────────────────────────────────────────────────────────────
#
# OK only when nothing was skipped. `watch OK` over a run that never rendered a
# board is the sentence this section exists to stop being printed: it is true
# about the guards that ran and silent about the one that did not, and silence
# on a summary line reads as coverage.
if [ "$fail" -ne 0 ]; then
  declare_verdict "FAIL" "see the WATCH FAIL lines above"
elif [ -n "$skipped" ]; then
  echo "watch PARTIAL · ${tests_line:-tests passed}; ${render_note}; run endable (${endable_read} router lines read)"
  echo "  NOT CHECKED on this run: ${skipped}."
  echo "  Everything that ran passed. That is not the same as the watch being clean,"
  echo "  and this line is deliberately not the word OK."
  declare_verdict "PARTIAL" "passed what ran; NOT checked: ${skipped}"
else
  echo "watch OK · ${tests_line:-tests passed}; ${render_note}; run endable (${endable_read} router lines read)"
  declare_verdict "OK" "all guards executed — ${tests_line:-tests passed}; ${render_note}; run endable"
fi
exit $fail
