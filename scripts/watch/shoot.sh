#!/bin/bash
# Render one board on a booted watch simulator and save a screenshot.
#
# Exists because of four ways this went wrong before:
#   · built with -target and no -derivedDataPath, then installed a STALE .app
#     from somewhere else and judged a screenshot of the wrong binary
#   · xcodebuild failed but the previous .app was still installed, so the
#     screenshot looked plausible
#   · pbxproj went stale after a file was added, so a new file was never
#     compiled and the build still said SUCCEEDED
#   · read the exit code instead of looking at the artefact
#   · pointed at legacy/native/Faff/Faff.xcodeproj, which is a STALE DUPLICATE
#     with no widget target and no project.yml. The watch app is shipped from
#     native-v2, which symlinks "FaffWatch Watch App" and "FaffWatch Widgets"
#     in from legacy. native-v2/project.yml is the only file that knows
#     FaffWidgetSnapshot.swift belongs to the watch target, so the legacy
#     project cannot compile the watch app at all.
#
# So: regenerate the project, build to a KNOWN path, assert the binary is newer
# than the newest source file, and only then install and shoot.
set -euo pipefail

# WORKTREE-RENDER-1 (2026-08-25) · this was a hardcoded absolute path to the
# main checkout, and that is a sixth way to judge a screenshot of the wrong
# binary — the five above are all about building the wrong thing, and this one
# builds the right thing in the wrong TREE.
#
# Several sessions run in `.claude/worktrees/*` at once. `check-watch.sh`
# resolves its own root with `git rev-parse --show-toplevel` and says why in a
# comment: without it "the gate would silently no-op". It then invokes THIS
# script by its resolved path — so the gate correctly ran the worktree's tests
# and then rendered the MAIN checkout's boards, in one run, reporting both
# under one green line. An agent verifying a face change by rendering it saw
# somebody else's code and had no way to tell.
#
# Same resolution as the gate, with the literal kept as the fallback for the
# case it was written for: invocation from somewhere that is not a git tree.
# Anchored on THIS FILE, not on the caller's cwd — the gate invokes this by
# absolute path from wherever the push happened, and a cwd-relative answer
# would reintroduce the same wrong-tree bug through a different door.
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$ROOT" ] || [ ! -d "$ROOT/native-v2" ]; then
  ROOT="/Volumes/WP/06 Claude Code/Runcino"
fi
PROJ="$ROOT/native-v2"
WATCH="$ROOT/legacy/native/Faff/FaffWatch Watch App"
# WORKTREE-RENDER-1 · overridable, because two TREES sharing one derived-data
# path is the same collision the gate already avoids between two xcodebuilds.
# The staleness assert below compares the binary against THIS tree's sources,
# so a cross-tree reuse is caught rather than shot — but caught is a failed
# run, and a per-tree path is simply correct.
DD="${WATCH_SHOOT_DD:-/tmp/faff-watch-dd}"
SIM="${SIM:-DC794E30-23E7-475B-AECD-05DC44E39A75}"   # Series 11 46mm
OUT="${OUT:-/tmp/faces}"
FACE="${1:?usage: shoot.sh <face-name> [more names...]}"

mkdir -p "$OUT"

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  cd "$PROJ"
  xcodegen generate >/dev/null || { echo "xcodegen failed"; exit 1; }

  xcodebuild -project Faff.xcodeproj \
    -scheme "FaffWatch Watch App" \
    -destination "id=$SIM" \
    -derivedDataPath "$DD" \
    -configuration Debug \
    build > /tmp/faff-watch-build.log 2>&1 || {
      echo "BUILD FAILED"; grep -E "error:" /tmp/faff-watch-build.log | head -20; exit 1; }

  APP=$(find "$DD/Build/Products" -name "FaffWatch Watch App.app" -maxdepth 3 | head -1)
  [ -n "$APP" ] || { echo "no .app in $DD"; exit 1; }

  # ARTEFACT CHECK, not exit code: is the binary newer than every source file?
  BIN="$APP/FaffWatch Watch App"
  NEWEST_SRC=$(find "$WATCH" -name '*.swift' -newer "$BIN" | head -3)
  if [ -n "$NEWEST_SRC" ]; then
    echo "STALE BINARY — these are newer than the built product:"; echo "$NEWEST_SRC"; exit 1
  fi
  echo "app: $APP  (binary $(date -r "$BIN" '+%H:%M:%S'))"
  echo "$APP" > /tmp/faff-watch-app-path
fi

APP=$(cat /tmp/faff-watch-app-path)
xcrun simctl install "$SIM" "$APP" >/dev/null

for f in "$@"; do
  xcrun simctl terminate "$SIM" run.faff.app.watchkitapp >/dev/null 2>&1 || true
  xcrun simctl launch "$SIM" run.faff.app.watchkitapp -face "$f" >/dev/null
  sleep 2.2
  xcrun simctl io "$SIM" screenshot "$OUT/$f.png" >/dev/null 2>&1
  echo "  $f -> $OUT/$f.png"
done
