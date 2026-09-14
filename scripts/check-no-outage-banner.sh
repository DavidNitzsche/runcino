#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# check-no-outage-banner.sh · F022/F024 regression gate (2026-09-14)
#
# David, urgent, OD-20260914-003 / ER-20260914-F024, on the global stale/
# connection banner:
#
#   "If I see the banner again I'm going to lose it. This was never happening
#   before. There is no reason that these issues should be happening."
#
# And OD-20260914-001 / ER-20260914-F022, on Today/Block becoming full-surface
# read-outage screens on a failed background refresh:
#
#   "I hate this shit and there is no reason to ever see this."
#
# Both rejections are about the BEHAVIOR AND PLACEMENT, not the wording — no
# rename, recolor, relocate, or rephrase of either mechanism is permitted to
# come back under a different name. This gate is the source-level half of
# that guarantee (F022 §9 / F024's own "source and rendered-UI regression
# gate" requirement); `ScrollHeaderStatusBarCollisionUITests.swift`'s deleted
# banner tests were the rendered-UI half before the banner itself was deleted
# — see that file's own note on why a banner-only UI test cannot survive the
# banner it tested.
#
# ── FOUR GUARDS, EXIT 1 ON ANY VIOLATION ────────────────────────────────────
#
#   1. THE BANNER TYPES ARE GONE, NOT DORMANT. `StaleBannerV5`,
#      `V5StaleBannerModifier`, and the `v5StaleBanner(...)` modifier function
#      itself may never be declared again anywhere in the app.
#   2. NO LIVE CALL SITE. `.v5StaleBanner(` may only appear in the app as the
#      literal documented placeholder `.v5StaleBanner(...)` inside a comment
#      (the exact string every surviving historical reference already uses) —
#      any other occurrence is a real modifier attachment reintroducing the
#      banner over a screen.
#   3. TODAY AND BLOCK NEVER REACH `OutageBodyV5`. `OutageBodyV5(` may not
#      appear anywhere inside `TodayHostV5`'s or `BlockHostV5`'s own struct
#      body in `HostsV5.swift` — the full skeleton+Retry+reassurance
#      composition is confirmed-rejected for exactly these two surfaces, and
#      each now owns its own `PlanSnapshotStore`-first fallback
#      (`snapshotOnlyCard`/`snapshotOnlyBody`) instead.
#   4. THE DELETED COPY DOES NOT COME BACK. `V5OutageCopy.today` and
#      `V5OutageCopy.block` were David's exact rejected Today/Block outage
#      sentences (screen 16a) and are deleted along with their last callers —
#      a `static let today =`/`static let block =` reappearing in
#      `V5OutageCopy` means a call site reached for the old default again.
#
# Deliberately no `set -e`: every guard reports ALL of its findings before
# exiting, matching every other check-*.sh gate in this repo (see
# check-panel-ink.sh, check-surface-sweep.sh). No `grep | head` either, for
# the same pipefail reason those files give.
#
# ── FALSIFICATION (Rule 18) ─────────────────────────────────────────────────
#
# Run against the PRE-fix tree (before F022/F024 landed): guard 1 fails on
# `StaleBannerV5`/`V5StaleBannerModifier`'s real declarations in
# `StaleStateV5.swift`; guard 2 fails on the three real `.v5StaleBanner(...)`
# call sites in `HostsV5.swift` (Today/Block/Races) plus `StateScreensV5.swift`'s
# scaffold call; guard 3 fails on `OutageBodyV5(onRetry: ...)` inside
# `TodayHostV5` and `OutageBodyV5(copy: .block, ...)` inside `BlockHostV5`;
# guard 4 fails on `V5OutageCopy.today`/`.block`'s own declarations. Restore
# this repo's actual current (fixed) tree and every guard passes. Both
# directions were run by hand before this script was added to CI — see the
# implementer's own report for the exact transcript.
#
# ── WHAT THIS GATE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
#
#   · a NEW screen inventing its own differently-named banner/outage
#     component that does not reuse these exact symbols. Source-grepping for
#     known names cannot see a fresh implementation of the same idea — that is
#     a rendered-UI question (screenshot review), which is why the owner-
#     direction doc also asks for render evidence, not only this gate.
#   · Races/Paces/RaceDetail/ReturnLadder/RunLog/RunDetail/Decisions/Tomorrow
#     still routing to `OutageBodyV5` on a genuine outage — that is IN SCOPE
#     per this pass's explicit audit-not-fix boundary and is not a violation.
#   · a `.v5StaleBanner(` mention inside a comment that does NOT use the
#     exact `(...)` placeholder this repo's surviving historical comments all
#     use — a comment written any other way (e.g. spelling out real argument
#     labels) trips guard 2 as a false positive. Write new historical comments
#     the same way the surviving ones already do.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NATIVE="$ROOT/native-v2/Faff/Faff"

fail=0
scanned=0

if [ ! -d "$NATIVE" ]; then
  echo "check-no-outage-banner: $NATIVE not found — the native tree moved, this guard is dead"
  exit 1
fi

swift_files=()
while IFS= read -r f; do
  swift_files+=("$f")
done < <(find "$NATIVE" -name '*.swift' -not -name '._*')
scanned=${#swift_files[@]}

if [ "$scanned" -eq 0 ]; then
  echo "check-no-outage-banner: scanned ZERO Swift files under ${NATIVE#$ROOT/} — this guard is dead"
  exit 1
fi

# ── GUARD 1 · the banner types are gone, not dormant ────────────────────────
for f in "${swift_files[@]}"; do
  if grep -qE '(struct[[:space:]]+StaleBannerV5|struct[[:space:]]+V5StaleBannerModifier|func[[:space:]]+v5StaleBanner\()' "$f"; then
    echo "check-no-outage-banner: GUARD 1 FAIL · ${f#$ROOT/} declares the deleted stale-banner type/function."
    grep -nE '(struct[[:space:]]+StaleBannerV5|struct[[:space:]]+V5StaleBannerModifier|func[[:space:]]+v5StaleBanner\()' "$f" | sed 's/^/    /'
    echo "  OD-20260914-003 / F024: David rejected this outright. It was deleted, not hidden."
    fail=1
  fi
done

# ── GUARD 2 · no live call site ──────────────────────────────────────────────
for f in "${swift_files[@]}"; do
  hits="$(grep -n '\.v5StaleBanner(' "$f" | grep -v '\.v5StaleBanner(\.\.\.)' || true)"
  if [ -n "$hits" ]; then
    echo "check-no-outage-banner: GUARD 2 FAIL · ${f#$ROOT/} attaches the deleted \`.v5StaleBanner(...)\` modifier."
    echo "$hits" | sed 's/^/    /'
    echo "  Every current historical mention in this app spells it \`.v5StaleBanner(...)\`"
    echo "  as a comment placeholder — this line does not, so it is a real attachment."
    fail=1
  fi
done

# ── GUARD 3 · Today/Block never reach OutageBodyV5 ──────────────────────────
HOSTS="$NATIVE/ViewsV5/HostsV5.swift"
if [ ! -f "$HOSTS" ]; then
  echo "check-no-outage-banner: $HOSTS not found — guard 3 cannot run"
  fail=1
else
  # Extract each struct's own body by LINE RANGE: from its `struct <Name>`
  # declaration to the line before the NEXT top-level `struct `/`// MARK:`
  # boundary. Plain line-number extraction, not a real parser — the same
  # convention this repo's other check-*.sh gates already use (see
  # check-panel-ink.sh, check-surface-sweep.sh) — and every host in this file
  # is a single top-level struct with no nested struct of the same shape.
  extract_struct() {
    local name="$1"
    local start next
    start="$(grep -n "^struct ${name}\\b" "$HOSTS" | head -1 | cut -d: -f1)"
    if [ -z "$start" ]; then return 1; fi
    next="$(awk -v s="$start" '/^struct [A-Za-z0-9_]+/ || /^\/\/ MARK: -/ { if (NR > s) { print NR; exit } }' "$HOSTS")"
    if [ -z "$next" ]; then next=$(($(wc -l < "$HOSTS") + 1)); fi
    sed -n "${start},$((next - 1))p" "$HOSTS"
  }

  for host in TodayHostV5 BlockHostV5; do
    body="$(extract_struct "$host")"
    if [ -z "$body" ]; then
      echo "check-no-outage-banner: GUARD 3 FAIL · could not locate \`struct ${host}\` in ${HOSTS#$ROOT/}."
      echo "  The host moved or was renamed — this guard cannot verify it without the boundary."
      fail=1
      continue
    fi
    # A HERE-STRING, NOT `printf ... | grep -q`. `grep -q` exits the instant
    # it sees its first match, and a ~140KB struct body piped in from a
    # separate writer (`printf`) then gets SIGPIPE on the next write — under
    # `pipefail` bash reports THAT (141), not grep's own 0-for-a-match, so
    # `if printf ... | grep -q ...; then` silently evaluated FALSE on a
    # struct that unambiguously contained the match (caught live: `grep -c`
    # on the same body correctly counted 1, `grep -q` right after it did not
    # trip `if`). A here-string has no second process racing to write past a
    # closed read end, so there is nothing left to SIGPIPE.
    if grep -q 'OutageBodyV5(' <<< "$body"; then
      echo "check-no-outage-banner: GUARD 3 FAIL · ${host} calls OutageBodyV5(...) again."
      grep -n 'OutageBodyV5(' <<< "$body" | sed 's/^/    /'
      echo "  OD-20260914-001 / F022: David rejected this exact composition for Today/Block"
      echo "  outright. A failed refresh must check PlanSnapshotStore first — see"
      echo "  TodayHostV5.snapshotOnlyCard / BlockHostV5.snapshotOnlyBody."
      fail=1
    fi
  done
fi

# ── GUARD 4 · the deleted copy does not come back ───────────────────────────
SURFACESTORE="$NATIVE/ViewsV5/SurfaceStoreV5.swift"
if [ ! -f "$SURFACESTORE" ]; then
  echo "check-no-outage-banner: $SURFACESTORE not found — guard 4 cannot run"
  fail=1
else
  if grep -qE 'static let (today|block) = V5OutageCopy\(' "$SURFACESTORE"; then
    echo "check-no-outage-banner: GUARD 4 FAIL · V5OutageCopy.today/.block reappeared in ${SURFACESTORE#$ROOT/}."
    grep -nE 'static let (today|block) = V5OutageCopy\(' "$SURFACESTORE" | sed 's/^/    /'
    echo "  These were David's exact rejected Today/Block outage sentences (screen 16a)."
    fail=1
  fi
fi

if [ "$fail" -ne 0 ]; then
  echo
  echo "check-no-outage-banner: FAILED"
  exit 1
fi

echo "check-no-outage-banner: ok · guard 1/2 scanned $scanned Swift files, no stale-banner type or call site"
echo "check-no-outage-banner: ok · guard 3 confirmed TodayHostV5/BlockHostV5 never call OutageBodyV5"
echo "check-no-outage-banner: ok · guard 4 confirmed V5OutageCopy.today/.block stay deleted"
exit 0
