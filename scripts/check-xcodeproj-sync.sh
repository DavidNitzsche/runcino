#!/usr/bin/env bash
#
# The generated project file must agree with the disk.
#
# `native-v2/Faff.xcodeproj/project.pbxproj` is xcodegen output AND is tracked
# in git. That combination has two failure modes, and until this script existed
# only one of them was caught:
#
#   1. pbxproj references a file that is GONE.  The build fails loudly with
#      "Build input files cannot be found". check-release-build.sh catches it,
#      but only on a machine that can run xcodebuild.
#
#   2. A file EXISTS on disk and pbxproj does not reference it.  Nothing caught
#      this. The file compiles to nothing, the symbol is absent, and xcodebuild
#      reports ** BUILD SUCCEEDED **. The feature is simply missing from the
#      binary — which is indistinguishable, from the outside, from a feature
#      that was never written. A screenshot of the running app is the only
#      evidence, and by then the commit is on main.
#
# Direction 2 is the dangerous one precisely because it is silent, and it is
# the one that fires when someone adds a Swift file without re-running
# xcodegen. Both directions are checked here, with no Xcode and no toolchain,
# so a cold container catches the drift before an archive ever starts.
#
# This is not a substitute for regenerating. It is the thing that tells you
# that you forgot to.

set -uo pipefail   # NOT -e: this script reports, it does not abort mid-report.
                   # NOT `set -o pipefail` with an early-exiting consumer
                   # anywhere below — grep -q / head under pipefail turn a
                   # MATCH into a non-zero exit on large inputs. Every pipe
                   # here terminates in a full-consuming command.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NATIVE="$ROOT/native-v2"
PROJ="$NATIVE/Faff.xcodeproj/project.pbxproj"
YML="$NATIVE/project.yml"

fail=0
note() { printf '%s\n' "$*"; }

# NO NATIVE TREE, NO OPINION.
#
# This gate runs in web-v2's `prebuild`, which is what Railway executes to
# deploy the SERVER. A checkout without `native-v2/` is a perfectly valid web
# build, and failing it there would take the whole site down over an Xcode
# project file — a native gate holding the deploy hostage.
#
# This is NOT the silent-skip failure mode. It says which half is absent and
# why it is not judging it, and it only ever skips when BOTH the generated
# project and its source-of-truth are missing together. A tree with one and
# not the other is drift, and drift is exactly what this exists to catch.
if [ ! -f "$PROJ" ] && [ ! -f "$YML" ]; then
  note "check-xcodeproj-sync: SKIP — no native-v2 tree in this checkout."
  note "  Nothing to compare. A web-only build has no Xcode project to drift from."
  exit 0
fi
if [ ! -f "$PROJ" ]; then
  note "check-xcodeproj-sync: FAIL — $YML exists but $PROJ does not."
  note "  The generator's source is here and its output is not. Run: cd native-v2 && xcodegen generate"
  exit 1
fi
if [ ! -f "$YML" ]; then
  note "check-xcodeproj-sync: FAIL — $PROJ exists but $YML does not."
  note "  A generated project with no generator. Something deleted the source of truth."
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# ---- every basename the project file references -----------------------------
# Both quoted and bare forms: `path = Foo.swift;` and `path = "Foo Bar.swift";`
sed -n 's/.*path = "\([^"]*\.swift\)".*/\1/p;s/.*path = \([^" ][^ ;]*\.swift\)[ ;].*/\1/p' \
  "$PROJ" | sed 's#.*/##' | sort -u > "$tmp/in_proj"

# ---- every source directory the project.yml globs ---------------------------
# `- path: Faff/Faff` under a `sources:` key. Paths may contain spaces and are
# relative to native-v2/.
sed -n 's/^[[:space:]]*-[[:space:]]*path:[[:space:]]*\(.*\)$/\1/p' "$YML" \
  | sed 's/[[:space:]]*$//' | sed 's/^"\(.*\)"$/\1/' | sort -u > "$tmp/src_dirs"

: > "$tmp/on_disk"
while IFS= read -r d; do
  [ -z "$d" ] && continue
  full="$NATIVE/$d"
  [ -d "$full" ] || continue
  # -L: the watch sources reach the iOS project through a symlinked directory.
  # `! -name '._*'` is load-bearing, not tidiness. This repo lives on an
  # exFAT volume that writes an AppleDouble sidecar beside every file, so
  # `Foo.swift` acquires a `._Foo.swift` that matches `*.swift` and is not
  # source. One agent's worktree carried 207 of them and this gate failed
  # there while passing here — a gate whose result depends on whose disk it
  # runs on is worse than no gate, because the first false alarm is what
  # teaches everyone to ignore the next true one. The same sidecars have
  # already corrupted git packs and broken find-driven swiftc on this volume.
  find -L "$full" -name '*.swift' ! -name '._*' -type f -print0 2>/dev/null \
    | while IFS= read -r -d '' f; do basename "$f"; done >> "$tmp/on_disk"
done < "$tmp/src_dirs"
sort -u "$tmp/on_disk" -o "$tmp/on_disk"

if [ ! -s "$tmp/on_disk" ]; then
  note "check-xcodeproj-sync: FAIL — found no Swift files at all under the"
  note "  paths project.yml globs. Either the parse broke or the tree is empty."
  note "  A check that inspects nothing must never report clean."
  exit 1
fi

# A floor. If the sweep silently stops finding files, this is what says so
# rather than printing a reassuring green.
count_disk=$(wc -l < "$tmp/on_disk" | tr -d ' ')
count_proj=$(wc -l < "$tmp/in_proj" | tr -d ' ')
MIN_FILES=120
if [ "$count_disk" -lt "$MIN_FILES" ]; then
  note "check-xcodeproj-sync: FAIL — only $count_disk Swift files found on disk,"
  note "  below the floor of $MIN_FILES. This project has never been that small;"
  note "  the glob is probably broken. Lower the floor deliberately if it is not."
  exit 1
fi

# ---- known drift, owned elsewhere, self-expiring -----------------------------
# These are on disk, tracked on main, and not compiled. They are NOT waived
# because they are acceptable — an uncompiled test reads as coverage while
# proving nothing, which the project.yml comment above this very target already
# says out loud. They are waived because the watch build wiring is in flight in
# another pair of hands, and a regeneration from here would capture that work
# mid-change.
#
# The exemption is checked for staleness below: once a file here is compiled,
# the gate FAILS until the line is deleted. A waiver that outlives its reason is
# the same silence it was meant to replace.
#
# Owner: the watch build wiring. Remedy: xcodegen generate, committed.
# EMPTY, and it should stay that way. It briefly held four watch files while
# the project file was stale. Waiving `_SessionSim.swift` turned out to be
# unsafe in a way the waiver could not see: `WorkoutRootView.body` references
# `SessionSim` unguarded, so an uncompiled `_SessionSim.swift` broke the
# RELEASE build outright — a TestFlight archive would have failed. The gate
# above only asks whether a file is compiled; it cannot know who depends on it.
#
# The lesson is the waiver's, not the gate's: a file can only be waived when
# nothing references it, and checking that is more work than regenerating.
# Regenerate instead.
EXEMPT_ORPHANS=""

printf '%s\n' $EXEMPT_ORPHANS | sed '/^$/d' | sort -u > "$tmp/exempt"

# Stale-waiver check FIRST: an exempted file that is now referenced must lose
# its line, or the list quietly grows into a permanent blind spot.
comm -12 "$tmp/exempt" "$tmp/in_proj" > "$tmp/stale"
if [ -s "$tmp/stale" ]; then
  fail=1
  note ""
  note "check-xcodeproj-sync: FAIL — stale exemptions. These are compiled now;"
  note "  delete them from EXEMPT_ORPHANS in this script."
  while IFS= read -r s; do note "    no longer orphaned: $s"; done < "$tmp/stale"
fi

# ---- direction 1: referenced but absent -------------------------------------
comm -23 "$tmp/in_proj" "$tmp/on_disk" > "$tmp/ghosts"
if [ -s "$tmp/ghosts" ]; then
  fail=1
  note ""
  note "check-xcodeproj-sync: FAIL — project.pbxproj references files that do not exist."
  note "  An archive fails on these with 'Build input files cannot be found'."
  while IFS= read -r g; do note "    referenced, missing: $g"; done < "$tmp/ghosts"
fi

# ---- direction 2: present but unreferenced ----------------------------------
comm -13 "$tmp/in_proj" "$tmp/on_disk" | comm -23 - "$tmp/exempt" > "$tmp/orphans"
if [ -s "$tmp/orphans" ]; then
  fail=1
  note ""
  note "check-xcodeproj-sync: FAIL — Swift files on disk that the project never compiles."
  note "  These build clean and are absent from the binary. That is the silent one."
  while IFS= read -r o; do note "    on disk, uncompiled: $o"; done < "$tmp/orphans"
fi

if [ "$fail" -ne 0 ]; then
  note ""
  note "  Fix: cd native-v2 && xcodegen generate  — then commit the regenerated"
  note "  project.pbxproj. It is generated output, but it is tracked, so a"
  note "  regeneration that stays uncommitted leaves main broken while every"
  note "  local gate (which builds the working tree, not HEAD) reports green."
  exit 1
fi

count_exempt=$(wc -l < "$tmp/exempt" | tr -d ' ')
note "check-xcodeproj-sync: OK — $count_disk Swift files on disk, $count_proj references, all resolve."
if [ "$count_exempt" -gt 0 ]; then
  note "  $count_exempt file(s) waived as known drift — see EXEMPT_ORPHANS. Green here does NOT mean zero drift."
fi
