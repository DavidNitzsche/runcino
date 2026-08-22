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
# Exit 1 on any violation. Sibling of check-palette-sync.sh.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VIEWS="$ROOT/native-v2/Faff/Faff/ViewsV5"

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

if [ "$fail" -ne 0 ]; then
  echo
  echo "check-panel-ink: FAILED"
  exit 1
fi

echo "check-panel-ink: ok · every screen owning a day-state fill computes its own ink"
exit 0
