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
# WORKTREE-RENDER-2 (2026-09-03) · WORKTREE-RENDER-1 WAS FALSE IN THE ONE
# CONTEXT THAT MATTERS: A GIT HOOK.
#
# The fix above resolved ROOT with `git -C "$(dirname "$0")" rev-parse
# --show-toplevel`. Correct when a human runs the script. But `git push` EXPORTS
# `GIT_DIR` into the hook environment, and an exported GIT_DIR outranks `-C`, so
# inside the pre-push hook that same command returns
#
#     …/scripts/watch          ← the script's own directory, not the repo root
#
# `$ROOT/native-v2` is not a directory there, so the guard below fired and ROOT
# silently became the HARDCODED MAIN CHECKOUT. The seventh way to judge a
# screenshot of the wrong binary, and the same wrong-TREE bug WORKTREE-RENDER-1
# was written to kill, walking back in through the git-hook door.
#
# It is not theoretical and it is not rare: it is what happens on EVERY pre-push
# from a linked worktree, which is how every agent session in this repo works.
# Measured 2026-09-03 — a board added in a worktree rendered blank 6 times out
# of 6 under the hook and correctly every time when run by hand, because the
# hook was building a tree that did not contain it. The staleness assert cannot
# see this: it compares the binary against the SAME wrong tree's sources, which
# are perfectly self-consistent.
#
# `check-watch.sh` is unaffected — its expression is a BARE `git rev-parse
# --show-toplevel` with the pushing worktree as cwd, which GIT_DIR resolves
# correctly. So the gate's tests and source guards were always honest about the
# pushed commit and only the RENDER half was looking elsewhere, under one green
# line. Verified both expressions under a hook-shaped GIT_DIR before writing
# this.
#
# The fix uses no git at all, so there is nothing for GIT_DIR to redirect: walk
# up from this file's own real location to the first directory that carries the
# two things a render needs. And FAIL rather than fall back — a hardcoded path
# is a guess, and this file's entire subject is not guessing about which binary
# you are looking at.
SELF="${BASH_SOURCE[0]}"
while [ -L "$SELF" ]; do
  LINK="$(readlink "$SELF")"
  case "$LINK" in
    /*) SELF="$LINK" ;;
    *)  SELF="$(cd "$(dirname "$SELF")" && pwd)/$LINK" ;;
  esac
done
ROOT="$(cd "$(dirname "$SELF")" && pwd)"
while [ "$ROOT" != "/" ]; do
  if [ -d "$ROOT/native-v2" ] && [ -d "$ROOT/legacy/native/Faff" ]; then break; fi
  ROOT="$(dirname "$ROOT")"
done
if [ "$ROOT" = "/" ]; then
  echo "shoot.sh: could not find the repo root above $(dirname "$SELF")." >&2
  echo "  Looked for a directory holding BOTH native-v2/ and legacy/native/Faff/." >&2
  echo "  Refusing to guess: rendering the wrong tree is the defect this file exists" >&2
  echo "  to prevent, and a fallback path is a guess wearing a default's clothes." >&2
  exit 1
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
