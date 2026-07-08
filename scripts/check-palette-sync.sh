#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# check-palette-sync.sh · brief v2 §1 build enforcement (AFC 2026-06-09)
#
# Two guards, exit 1 on any violation:
#
#   1. LOCK CHECK   · every semantic slot of the locked ten-color palette is
#                     present with the exact expected hex in each surface's
#                     token file (web globals.css / constants.ts, iPhone
#                     Theme.swift, watch WatchTheme.swift + FaceKit.swift).
#                     The table below IS the lock — change the palette by
#                     changing brief v2 first, then this file.
#
#   2. RETIRED-HEX  · hexes deleted by the AFC palette cutover may not
#      TRIPWIRE      reappear in live code. Comment lines that reference
#                     them historically are excluded by keyword filter
#                     (tripwire, not a parser — keep historical mentions
#                     on lines with "deleted/retired/was/were/old").
#
# Exemptions (by design · see brief v2 ADDENDUM for the rulings):
#   · Mesh gradient stop tables (constants.ts EFF/MESH, Theme.swift FaffMesh)
#     are gradient ingredients, not semantics — not scanned for membership.
#   · Brandmark sweep stops (logo identity) — untouched by the lock.
#   · TweakAccent violet/cool — RULED EXEMPT 2026-06-09 (user-preference
#     opt-in recolors; ember default must equal the locked palette and the
#     variant values must match web↔iPhone — both asserted below).
#   · Phase-identity palette — RULED ADOPTED 2026-06-09 as a categorical
#     group (phase visualizations only) — four hexes asserted below.
#
# Wire-up: run from CI before web deploy and as an Xcode build phase.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB_CSS="$ROOT/web-v2/app/globals.css"
WEB_CONST="$ROOT/web-v2/components/faff-app/constants.ts"
IOS_THEME="$ROOT/native-v2/Faff/Faff/Theme.swift"
WATCH_THEME="$ROOT/legacy/native/Faff/FaffWatch Watch App/WatchTheme.swift"
WATCH_FACEKIT="$ROOT/legacy/native/Faff/FaffWatch Watch App/FaceKit.swift"

fail=0

need() { # $1=file  $2=grep -E pattern (case-insensitive)  $3=label
  # -e protects patterns that start with "--" (CSS custom properties).
  if ! grep -qiE -e "$2" "$1"; then
    echo "PALETTE LOCK FAIL · $3"
    echo "  expected /$2/ in ${1#"$ROOT"/}"
    fail=1
  fi
}

# ── 1 · LOCK CHECK · the ten colors, per surface ────────────────────────────
# Web tokens
need "$WEB_CSS" '\-\-race:#D03F3F'        'web --race = #D03F3F (Race/Tempo · Redish · orange retired, reads Strava)'
need "$WEB_CSS" '\-\-goal:#F3AD38'        'web --goal = #F3AD38 (Long)'
need "$WEB_CSS" '\-\-green:#3EBD41'       'web --green = #3EBD41 (Good state)'
need "$WEB_CSS" '\-\-over:#FC4D64'        'web --over = #FC4D64 (Off/warn)'
need "$WEB_CSS" '\-\-dist:#27B4E0'        'web --dist = #27B4E0 (Recovery)'
need "$WEB_CSS" '\-\-intervals:#FC4D64'   'web --intervals = #FC4D64 (Intervals · = Warning red, ceiling)'
need "$WEB_CSS" '\-\-watch:#F3AD38'       'web --watch = #F3AD38 (Watch attention)'
need "$WEB_CSS" '\-\-gold:#F0DF47'        'web --gold = #F0DF47 (PR gold · Light Yellow)'
need "$WEB_CSS" '\-\-eyebrow:#F3AD38'     'web --eyebrow = #F3AD38 (Eyebrow · = Attention amber)'
need "$WEB_CSS" '\-\-eff-easy:#3EBD41'    'web --eff-easy = #3EBD41 (Easy)'
need "$WEB_CSS" '\-\-eff-tempo:#D03F3F'   'web --eff-tempo = #D03F3F'
need "$WEB_CSS" '\-\-eff-intervals:#FC4D64' 'web --eff-intervals = #FC4D64'
need "$WEB_CSS" '\-\-eff-race:#D03F3F'    'web --eff-race = #D03F3F'
# Consolidation tokens · bright text-on-dark siblings + Strava brand. Not
# part of the locked ten. The 2026-06-17 palette pass (David's canonical
# palette) collapsed --warn-text -> Attention #F3AD38 and --over-text ->
# Warning #FC4D64 (the bright #FFB24D / #FF6A6A siblings retired; the same
# hue at full strength already reads bright on dark). Strava lock-exempt.
need "$WEB_CSS" '\-\-warn-text:#F3AD38'   'web --warn-text = #F3AD38 (= Attention amber)'
need "$WEB_CSS" '\-\-over-text:#FC4D64'   'web --over-text = #FC4D64 (= Warning red)'
need "$WEB_CSS" '\-\-strava:#FC4C02'      'web --strava = #FC4C02 (Strava brand, lock-exempt)'

# Web effort dots (constants.ts)
need "$WEB_CONST" "easy:.*dot: '#3EBD41'"      'web EFF.easy.dot = #3EBD41'
need "$WEB_CONST" "tempo:.*dot: '#D03F3F'"     'web EFF.tempo.dot = #D03F3F'
need "$WEB_CONST" "intervals:.*dot: '#FC4D64'" 'web EFF.intervals.dot = #FC4D64'
need "$WEB_CONST" "race:.*dot: '#D03F3F'"      'web EFF.race.dot = #D03F3F'
need "$WEB_CONST" "recovery:.*dot: '#27B4E0'"  'web EFF.recovery.dot = #27B4E0'
need "$WEB_CONST" "long:.*dot: '#F3AD38'"      'web EFF.long.dot = #F3AD38'

# iPhone tokens (Theme.swift)
need "$IOS_THEME" 'green *= Color\(hex: 0x3EBD41\)'     'iOS Theme.green = #3EBD41'
need "$IOS_THEME" 'goal *= Color\(hex: 0xF3AD38\)'      'iOS Theme.goal = #F3AD38'
need "$IOS_THEME" 'over *= Color\(hex: 0xFC4D64\)'      'iOS Theme.over = #FC4D64'
need "$IOS_THEME" 'dist *= Color\(hex: 0x27B4E0\)'      'iOS Theme.dist = #27B4E0'
need "$IOS_THEME" 'race *= Color\(hex: 0xD03F3F\)'      'iOS Theme.race = #D03F3F'
need "$IOS_THEME" 'intervals *= Color\(hex: 0xFC4D64\)' 'iOS Theme.intervals = #FC4D64'
need "$IOS_THEME" 'case \.easy: *return Color\(hex: 0x3EBD41\)'      'iOS easy dot = #3EBD41'
need "$IOS_THEME" 'case \.tempo: *return Color\(hex: 0xD03F3F\)'     'iOS tempo dot = #D03F3F'
need "$IOS_THEME" 'case \.intervals: *return Color\(hex: 0xFC4D64\)' 'iOS intervals dot = #FC4D64'
need "$IOS_THEME" 'case \.race: *return Color\(hex: 0xD03F3F\)'      'iOS race dot = #D03F3F'

# TweakAccent · ruled exempt 2026-06-09 · ember default = locked palette,
# variant values byte-synced web↔iPhone.
need "$IOS_THEME" 'case \.ember: *return Color\(hex: 0xF3AD38\)' 'TweakAccent ember.goal = locked #F3AD38'
need "$IOS_THEME" 'case \.ember: *return Color\(hex: 0xD03F3F\)' 'TweakAccent ember.race = locked #D03F3F'
need "$WEB_CSS" 'data-accent="gold"\]\{--goal:#F0DF47;--race:#F0DF47;\}'   'web gold accent = iPhone gold (Light Yellow)'
need "$WEB_CSS" 'data-accent="violet"\]\{--goal:#A78BFA;--race:#B794F4;\}' 'web violet accent = iPhone violet'
need "$WEB_CSS" 'data-accent="cool"\]\{--goal:#27B4E0;--race:#3AA0E0;\}'   'web cool accent = iPhone cool'
need "$IOS_THEME" 'case \.gold: *return Color\(hex: 0xF0DF47\)' 'iPhone gold accent = #F0DF47 (Light Yellow)'
need "$IOS_THEME" 'return Color\(hex: 0xB794F4\)' 'iPhone violet.race = #B794F4'
need "$IOS_THEME" 'return Color\(hex: 0x3AA0E0\)' 'iPhone cool.race = #3AA0E0'

# Phase-identity categorical group · ruled adopted 2026-06-09 · phase
# visualizations only (web TrainView today).
WEB_TRAIN="$ROOT/web-v2/components/faff-app/views/TrainView.tsx"
need "$WEB_TRAIN" "return '#5BD8D2'" 'phase BASE = #5BD8D2'
need "$WEB_TRAIN" "return '#FFCB47'" 'phase BUILD = #FFCB47'
need "$WEB_TRAIN" "return '#FF7733'" 'phase PEAK = #FF7733'
need "$WEB_TRAIN" "return '#56E0B0'" 'phase TAPER = #56E0B0'

# Watch tokens
need "$WATCH_THEME"   'green *= Color\(hex: 0x3EBD41\)'  'watch C.green = #3EBD41'
need "$WATCH_THEME"   'amber *= Color\(hex: 0xF3AD38\)'  'watch C.amber = #F3AD38'
need "$WATCH_THEME"   'orange *= Color\(hex: 0xD03F3F\)' 'watch C.orange = #D03F3F (Redish · race/now · token name kept)'
need "$WATCH_THEME"   'warn *= Color\(hex: 0xFC4D64\)'   'watch C.warn = #FC4D64'
need "$WATCH_FACEKIT" 'live *= Color\(hex: 0x3EBD41\)'   'watch Faff.live = #3EBD41'
need "$WATCH_FACEKIT" 'goal *= Color\(hex: 0xF3AD38\)'   'watch Faff.goal = #F3AD38'
need "$WATCH_FACEKIT" 'over *= Color\(hex: 0xFC4D64\)'   'watch Faff.over = #FC4D64'
need "$WATCH_FACEKIT" 'dist *= Color\(hex: 0x27B4E0\)'   'watch Faff.dist = #27B4E0'
need "$WATCH_FACEKIT" 'bonus *= Color\(hex: 0xF0DF47\)'  'watch Faff.bonus = #F0DF47 (Light Yellow)'

# ── 2 · RETIRED-HEX TRIPWIRE ────────────────────────────────────────────────
# Dead by the AFC cutover. Historical comment mentions are filtered by
# keyword; a retired hex on a live code line fails the build.
# Dropped from the retired list (legitimately alive outside semantics):
#   2FAF7C · time-of-day morning mesh stop (gradient ingredient, exempt)
#   56E0B0 · TrainView phase-identity taper color (categorical phase
#            palette · pending brief-v2 ruling, tracked in the AFC recap)
# 5FD06A · the rogue 4th green, fully eliminated in the 2026-06-16 web
#          color consolidation (snapped to --green #3EBD41). Tripwire so
#          it can never return.
# 27E087 · "Aquamarine" — David BANNED it outright 2026-06-17 ("do not use
#          this color anywhere ever"). Never to appear in any surface.
# 2026-06-17 PALETTE PASS retirees (David's canonical palette · the design
# finesse pass collapsed each off-palette hue to its one canonical value):
#   F43F5E           · intervals -> Warning #FC4D64 (the ceiling red; merges
#                      the two divergent Zone/ZoneSplit ladders into one)
#   F5C518 / F5A518  · PR gold + gold tweak -> Light Yellow #F0DF47
#   FFCE8A           · eyebrow -> Attention #F3AD38
#   FFB24D           · bright warn text -> Attention #F3AD38
#   FF6A6A / FF5A52  · bright over text + live pulse -> Warning #FC4D64
# 2026-06-18 · ORANGE RETIRED. race/tempo went #FF5722 -> #E88021 (Dark
# Orange) on the 17th, but David ruled ANY orange reads "Strava" regardless
# of shade. race/tempo is now Redish #D03F3F (un-retired below; it is the
# deep race-red, distinct from the brighter Warning #FC4D64 on intervals).
# #E88021 retired app-wide; no orange anywhere.
#   FF5722 / FF7A45 / E88021 · race+tempo -> Redish #D03F3F
RETIRED='FF8847|48B3B5|008FEC|9013FE|2CA82F|D4900A|E85D26|D63E4E|EE6038|FF8870|34D058|5FD06A|27E087|FF5722|FF7A45|E88021|F43F5E|F5C518|F5A518|FFCE8A|FFB24D|FF6A6A|FF5A52'
# gstop · hero gradient stop ingredient (FaffEffort.heroGradient 2026-06-18).
# Same exemption logic as FaffMesh: blend ingredients, not semantic colors.
HIST_FILTER='deleted|retired|was |were |old |previously|killed|AFC fix|→|gstop'

hits=$(grep -rinE "(#|0x)($RETIRED)" \
  "$ROOT/web-v2/app" "$ROOT/web-v2/components" "$ROOT/web-v2/lib" \
  "$ROOT/native-v2/Faff/Faff" \
  "$ROOT/legacy/native/Faff/FaffWatch Watch App" \
  --include='*.css' --include='*.ts' --include='*.tsx' --include='*.swift' \
  2>/dev/null | grep -viE "$HIST_FILTER" | grep -v '/\._' \
  | grep -v '/app/dev/' | grep -v 'components/today/WeekStrip.tsx' || true)
# Exclusions: /app/dev/ = design mockup routes (not product surface);
# components/today/WeekStrip.tsx = dead file, zero importers (queued for
# deletion in the CIM sweep).

if [ -n "$hits" ]; then
  echo "RETIRED HEX FOUND IN LIVE CODE:"
  echo "$hits"
  fail=1
fi

# ── 3 · WATCH-FACE HEX ALLOWLIST (P2-61, 2026-07-07) ────────────────────────
# The RETIRED-HEX tripwire above only catches hexes that were ONCE canonical
# and got deleted — it can't see a hex that was never locked in the first
# place. That gap let ~10 off-palette wash/ink literals (0x0C2A14, 0x3A2B08,
# 0x06243F, 0x0A0D12, 0x11151C, 0xCFD2D8, 0x06210C, 0xAAB0BF, 0x2C2F35 —
# undocumented takeover-face backgrounds and on-color inks) ship silently in
# FaceKit.swift / Faces.swift / SummaryView.swift / WatchFixtures.swift /
# WorkoutRootView.swift. They're gone now, replaced by alpha-step tokens on
# Faff.* (liveWash/goalWash/distWash/grayWash/pauseWash/inkDim/onLive — brief
# v2 §1: "depth comes from alpha steps of these hues, not new hexes"). This
# guard is a positive allowlist so the NEXT ad-hoc hex fails CI instead of
# quietly shipping: every `Color(hex: 0x......)` literal anywhere under the
# watch app target must be one of the ten locked hexes or a sanctioned
# neutral (near-white ink / mid-gray mute / dim / progress-track gray).
WATCH_ALLOWED_HEX='3EBD41|F3AD38|D03F3F|27B4E0|FC4D64|F0DF47|F6F7F8|8A90A0|646464|2C2F35'
watch_hex_hits=$(grep -rinoE 'Color\(hex: *0x[0-9A-Fa-f]{6}\)' \
  "$ROOT/legacy/native/Faff/FaffWatch Watch App" \
  --include='*.swift' 2>/dev/null \
  | grep -viE "($WATCH_ALLOWED_HEX)" \
  | grep -v '/\._' || true)

if [ -n "$watch_hex_hits" ]; then
  echo "WATCH HEX-LINT FAIL · off-palette literal outside the allowlist:"
  echo "$watch_hex_hits"
  echo "  Fix: use a Faff.* token (WatchTheme.swift / FaceKit.swift) — an"
  echo "  alpha step of a locked hue over black, not a new hex. If this is"
  echo "  a deliberate new semantic, propose the brief v2 change first,"
  echo "  then add its hex to WATCH_ALLOWED_HEX here."
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "palette-sync OK · ten-color lock verified across web / iPhone / watch"
fi
exit $fail
