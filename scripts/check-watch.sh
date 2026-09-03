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
  raceugly threshold m4band             # phases · race, steady, graded band
  controls controlsrep endconfirm       # controls · three verbs, rep variant, confirm
  gps waterlock ceilingoverride         # faults · sensor names, lock, override
  msplit mphaselong                     # moments · split, longest phase copy
  lobbyintervals lobbyweek              # lobby · structured session, week strip
  summary racecomplete firstlaunch      # finish · summary, race finish, cold start
)

fail=0
note() { printf '%s\n' "$*"; }

# Human-readable model for whatever UDID is configured, so the "boot it" hint
# names a watch rather than a hex string.
sim_name() {
  xcrun simctl list devices 2>/dev/null | grep -F "$SIM" \
    | sed -E 's/^[[:space:]]*(.*) \('"$SIM"'\).*$/\1/' | head -1
}

# ── 0 · TOOLCHAIN ────────────────────────────────────────────────────────────
if ! command -v xcodebuild >/dev/null 2>&1; then
  note "watch · SKIPPED · no xcodebuild on this machine."
  note "  This gate needs a Mac with Xcode. It is a pre-push hook for exactly"
  note "  that reason — Railway's build container could never run it."
  exit 0
fi

if ! command -v xcodegen >/dev/null 2>&1; then
  note "WATCH FAIL · xcodegen is not installed (brew install xcodegen)"
  note "  Without it the gate would test whatever the checked-in pbxproj happens"
  note "  to contain, which is the precise defect this gate exists to catch."
  note "  Skipping the gate is not an option here — install it, or push with"
  note "  --no-verify and say so."
  exit 1
fi

if [ ! -d "$TESTS_DIR" ]; then
  note "WATCH FAIL · test sources missing at legacy/native/Faff/FaffWatch Watch AppTests"
  note "  The watch gate cannot be deleted to make a push pass."
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
  exit 1
fi

# Two different questions, and only the second one survives a second run:
#   · did THIS run change the file?   (before != after)
#   · does the file differ from HEAD? (git)
# The first is silent the moment anyone has already run xcodegen locally, which
# is exactly when the committed project is still stale. So ask git.
after="$(shasum "$PBX" | cut -d' ' -f1)"
if ! git -C "$ROOT" diff --quiet -- "$PBX" 2>/dev/null; then
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

if [ "$FAST" = "1" ]; then
  render_note="render skipped (--fast)"
elif ! xcrun simctl list devices booted 2>/dev/null | grep -q "$SIM"; then
  # Degrade, do not fail. Booting a watch simulator takes a minute and a push
  # is not the moment to do it silently. Say what is not being checked.
  render_note="render SKIPPED · watch simulator $SIM is not booted"
  note "watch · $render_note"
  note "  Board geometry was NOT checked on this run. To include it:"
  note "    xcrun simctl boot $SIM   # $(sim_name)"
  note "    bash scripts/check-watch.sh"
elif ! python3 -c "import PIL" >/dev/null 2>&1; then
  render_note="render SKIPPED · python3 has no Pillow (pip3 install Pillow)"
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

if [ "$fail" -eq 0 ]; then
  echo "watch OK · ${tests_line:-tests passed}; ${render_note}; run endable (${endable_read} router lines read)"
fi
exit $fail
