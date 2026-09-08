#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# check-panel-ink.sh · a screen that owns a day-state fill must not hard-code
# its ink. (2026-08-21 accessibility audit)
#
# THE BUG THIS CATCHES, WHICH HAS NOW LANDED TWICE
#
# `DayPanel` publishes the ink its own fill requires through `\.v5PanelInk`.
# That reaches everything drawn INSIDE the panel — `PanelStatPlate`,
# `WeekStripV5`, `HeaderDiscV5` — because environment values travel down.
#
# It does NOT reach the screen that renders the panel. `TodayBeforeV5` builds
# its header and lede inside its OWN body, which sits ABOVE `DayPanel` in the
# view tree, so its `@Environment` resolves to the default white set no matter
# what the panel publishes underneath it. A view cannot read what its own child
# sets. Screens that own the fill must compute the ink from that fill:
#
#     private var panelInk: V5.PanelInk { model.panel.fill.ink }
#
# Two of the six such screens never did. `RacesV5` and `BlockV5` drew their
# place label, date, week line, kicker, name and dose from `V5.OnPanel.*` —
# hard-coded WHITE — while the `PanelStatPlate` below them (a child, so the
# environment reaches it) correctly drew dark. One panel, two inks.
#
# `RacesV5`'s own sample carries `dayState: "race"`, one of the two LIGHT
# ramps. Measured on device: 2.47:1 to 2.68:1 against the 3:1 that display type
# needs and the 4.5:1 its 13pt lines need. `BlockV5` looked fine only because
# its sample is `phase`; `dayStateWordFor` in web-v2/lib/faff/v5-today.ts
# returns `quality` for every threshold / tempo / interval session.
#
# The rule is mechanical, so it is checked mechanically rather than remembered.
#
# ─────────────────────────────────────────────────────────────────────────────
# GUARD 2 · A VALUE DRAWN ON A PANEL THREADS **BOTH** OF ITS OFF-INK COLOURS
#
# `FaffValueText` draws three things whose colour is NOT the panel's primary
# ink: the modelled tilde (`mark:`) and, since SKIPPROJ-CONTRAST-1, the
# unreadable dash (`fault:`). Both default to a locked palette hex that is
# correct on the black page and invisible on a gradient:
#
#     mark   V5.attention #F2B03C   amber on the amber race ramp   1.45:1
#     fault  V5.fault     #FF4438   red on the same ramp's plate   1.02:1
#
# The amber half was fixed in 2026-08-21 by adding `mark:` and threading
# `panelInk.mark` at every on-panel call site. The red half was left behind,
# and a Product Experience reviewer found it by fault-injecting the state and
# MEASURING what rendered: the "Projected finish" stat only ever appears on a
# race day, a race day is always the `race` ramp, so the one slot whose entire
# content is that dash was systematically the least legible thing on screen.
#
# The two are the same discipline and the same failure mode, so they are
# checked together: within a file, every `mark: panelInk.mark` must be matched
# by a `fault: panelInk.fault`. Add one without the other and the counts
# diverge.
#
# WHAT THIS GUARD CANNOT FAIL ON (Rule 22). It counts per FILE, not per CALL:
# a file with two `FaffValueText`s, one carrying `mark:` twice and the other
# carrying `fault:` twice, balances and passes. It also cannot see a NEW
# on-panel call site that threads neither — nothing tells this script which
# calls are inside a `DayPanel`. What it does catch is the actual historical
# shape, which is one of the pair being added or removed alone. The contrast
# arithmetic itself is `V5ContrastTests`, not here.
#
# ─────────────────────────────────────────────────────────────────────────────
# GUARD 3 · `FaffValueText` DOES NOT HARD-CODE THE DASH AGAIN
#
# Guard 2 is worthless if the parameter it counts is ignored by the view. The
# `.unreadable` case must paint from `fault`, never from `V5.fault` — that
# literal is exactly what the reviewer measured at 1.08:1.
#
# ─────────────────────────────────────────────────────────────────────────────
# ─────────────────────────────────────────────────────────────────────────────
# AND IT NOW ACTUALLY RUNS (2026-09-08)
#
# This script called itself "a sibling of check-palette-sync.sh" from the day
# it was written and was never wired into `web-v2`'s `prebuild` beside it. So
# for two and a half weeks guard 1 was a hypothesis, in the exact sense Rule 20
# names: a rule everyone believed was holding, enforced by nothing. It is in
# the chain now, immediately after the palette lock.
#
# Exit 1 on any violation. Sibling of check-palette-sync.sh.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VIEWS="$ROOT/native-v2/Faff/Faff/ViewsV5"
DESIGN="$ROOT/native-v2/Faff/Faff/DesignV5"

if [ ! -d "$VIEWS" ]; then
  echo "check-panel-ink: $VIEWS not found · skipping"
  exit 0
fi

fail=0

for f in "$VIEWS"/*.swift; do
  base="$(basename "$f")"

  # Does this file render a DayPanel with a STATE fill? A `.quiet` panel is
  # surface-2, which is dark, so it legitimately keeps the white set.
  if ! grep -q 'DayPanel(fill:' "$f"; then continue; fi
  if ! grep 'DayPanel(fill:' "$f" | grep -qv 'fill: \.quiet'; then continue; fi

  # Does it paint from the hard-coded white set? A comment mentioning the token
  # is not a call site, so only lines that actually use it as a value count.
  hits="$(grep -n 'V5\.OnPanel\.\(primary\|secondary\|quiet\|plate\|control\)' "$f" \
          | grep -v '^\s*[0-9]*:\s*//' | grep -v '///' || true)"

  if [ -n "$hits" ]; then
    echo "check-panel-ink: $base renders a day-state DayPanel and hard-codes its ink."
    echo "  A screen sits ABOVE its own panel, so it must compute the ink from the fill:"
    echo "      private var panelInk: V5.PanelInk { model.panel.fill.ink }"
    echo "  then paint from panelInk.* instead of V5.OnPanel.*"
    echo "$hits" | sed 's/^/    /'
    fail=1
  fi
done

# ── GUARD 2 · mark: and fault: are threaded in pairs ─────────────────────────
#
# Both directories, because `PanelV5.swift` (DesignV5) holds the two shared
# on-panel components — `HeroDayPanelContentV5` and `PanelStatPlate` — and they
# are the call sites the race-day "Projected finish" dash actually renders
# through. Scoping this guard to ViewsV5 the way guard 1 is scoped would have
# missed the defect it exists for.
paired_scanned=0
paired_sites=0
for f in "$VIEWS"/*.swift "$DESIGN"/*.swift; do
  [ -f "$f" ] || continue
  paired_scanned=$((paired_scanned + 1))
  base="$(basename "$f")"

  marks="$(grep -c 'mark: panelInk\.mark' "$f" || true)"
  faults="$(grep -c 'fault: panelInk\.fault' "$f" || true)"
  paired_sites=$((paired_sites + marks))

  if [ "$marks" -ne "$faults" ]; then
    echo "check-panel-ink: $base threads $marks panel mark(s) and $faults panel fault(s)."
    echo "  A FaffValueText drawn inside a DayPanel must hand it BOTH off-ink colours:"
    echo "      FaffValueText(v, font: f, color: panelInk.primary,"
    echo "                    mark: panelInk.mark, fault: panelInk.fault)"
    echo "  The defaults (#F2B03C amber, #FF4438 red) are palette colours for the"
    echo "  black page. On the race ramp they measure 1.45:1 and 1.02:1."
    fail=1
  fi
done

# LIVENESS (Rule 18 §2). A guard that scanned nothing, or that found no call
# sites because the parameter was renamed, must say so rather than report clean.
if [ "$paired_scanned" -eq 0 ]; then
  echo "check-panel-ink: guard 2 scanned ZERO files · the tree moved, this guard is dead"
  fail=1
fi
if [ "$paired_sites" -eq 0 ]; then
  echo "check-panel-ink: guard 2 found NO 'mark: panelInk.mark' call sites in $paired_scanned files."
  echo "  Either every on-panel value stopped threading its ink, or the parameter was"
  echo "  renamed and this guard now matches nothing. Both are failures, not clean runs."
  fail=1
fi

# ── GUARD 3 · the view honours the parameter guard 2 counts ──────────────────
VALUES="$DESIGN/ValuesV5.swift"
if [ ! -f "$VALUES" ]; then
  echo "check-panel-ink: $VALUES not found · guard 3 cannot run"
  fail=1
else
  if ! grep -q '\.foregroundStyle(fault)' "$VALUES"; then
    echo "check-panel-ink: ValuesV5.swift no longer paints the unreadable dash from \`fault\`."
    echo "  Guard 2 counts a parameter this view must actually use. Expected:"
    echo "      case .unreadable: Text(value.text).font(font).foregroundStyle(fault)"
    fail=1
  fi
  # The literal that measured 1.08:1 on the race-day card. A doc comment naming
  # it is fine; a `.foregroundStyle(V5.fault)` is the defect coming back.
  if grep -q 'foregroundStyle(V5\.fault)' "$VALUES"; then
    echo "check-panel-ink: ValuesV5.swift hard-codes V5.fault as an ink again."
    grep -n 'foregroundStyle(V5\.fault)' "$VALUES" | sed 's/^/    /'
    fail=1
  fi
fi

if [ "$fail" -ne 0 ]; then
  echo
  echo "check-panel-ink: FAILED"
  exit 1
fi

echo "check-panel-ink: ok · every screen owning a day-state fill computes its own ink"
echo "check-panel-ink: ok · $paired_sites on-panel value(s) across $paired_scanned files thread both mark and fault"
exit 0
