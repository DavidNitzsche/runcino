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
need "$WEB_CSS" '\-\-race:#FF5722'        'web --race = #FF5722 (Race/Tempo)'
need "$WEB_CSS" '\-\-goal:#F3AD38'        'web --goal = #F3AD38 (Long)'
need "$WEB_CSS" '\-\-green:#3EBD41'       'web --green = #3EBD41 (Good state)'
need "$WEB_CSS" '\-\-over:#FC4D64'        'web --over = #FC4D64 (Off/warn)'
need "$WEB_CSS" '\-\-dist:#27B4E0'        'web --dist = #27B4E0 (Recovery)'
need "$WEB_CSS" '\-\-intervals:#F43F5E'   'web --intervals = #F43F5E (Intervals)'
need "$WEB_CSS" '\-\-watch:#F3AD38'       'web --watch = #F3AD38 (Watch attention)'
need "$WEB_CSS" '\-\-gold:#F5C518'        'web --gold = #F5C518 (PR gold)'
need "$WEB_CSS" '\-\-eyebrow:#FFCE8A'     'web --eyebrow = #FFCE8A (Eyebrow)'
need "$WEB_CSS" '\-\-eff-easy:#14C08C'    'web --eff-easy = #14C08C (Easy)'
need "$WEB_CSS" '\-\-eff-tempo:#FF5722'   'web --eff-tempo = #FF5722'
need "$WEB_CSS" '\-\-eff-intervals:#F43F5E' 'web --eff-intervals = #F43F5E'
need "$WEB_CSS" '\-\-eff-race:#FF5722'    'web --eff-race = #FF5722'
# Consolidation tokens (web color pass 2026-06-16) · bright text-on-dark
# siblings + Strava brand. Not part of the locked ten — these are
# accent/brand-chrome tokens the consolidation standardized on so the
# rogue spellings (#5fd06a / #ff9aa8 / loose Strava hexes) can't return.
need "$WEB_CSS" '\-\-warn-text:#FFB24D'   'web --warn-text = #FFB24D (bright warn text)'
need "$WEB_CSS" '\-\-over-text:#FF6A6A'   'web --over-text = #FF6A6A (bright miss text)'
need "$WEB_CSS" '\-\-strava:#FC4C02'      'web --strava = #FC4C02 (Strava brand, lock-exempt)'

# Web effort dots (constants.ts)
need "$WEB_CONST" "easy:.*dot: '#14C08C'"      'web EFF.easy.dot = #14C08C'
need "$WEB_CONST" "tempo:.*dot: '#FF5722'"     'web EFF.tempo.dot = #FF5722'
need "$WEB_CONST" "intervals:.*dot: '#F43F5E'" 'web EFF.intervals.dot = #F43F5E'
need "$WEB_CONST" "race:.*dot: '#FF5722'"      'web EFF.race.dot = #FF5722'
need "$WEB_CONST" "recovery:.*dot: '#27B4E0'"  'web EFF.recovery.dot = #27B4E0'
need "$WEB_CONST" "long:.*dot: '#F3AD38'"      'web EFF.long.dot = #F3AD38'

# iPhone tokens (Theme.swift)
need "$IOS_THEME" 'green *= Color\(hex: 0x3EBD41\)'     'iOS Theme.green = #3EBD41'
need "$IOS_THEME" 'goal *= Color\(hex: 0xF3AD38\)'      'iOS Theme.goal = #F3AD38'
need "$IOS_THEME" 'over *= Color\(hex: 0xFC4D64\)'      'iOS Theme.over = #FC4D64'
need "$IOS_THEME" 'dist *= Color\(hex: 0x27B4E0\)'      'iOS Theme.dist = #27B4E0'
need "$IOS_THEME" 'race *= Color\(hex: 0xFF5722\)'      'iOS Theme.race = #FF5722'
need "$IOS_THEME" 'intervals *= Color\(hex: 0xF43F5E\)' 'iOS Theme.intervals = #F43F5E'
need "$IOS_THEME" 'case \.easy: *return Color\(hex: 0x14C08C\)'      'iOS easy dot = #14C08C'
need "$IOS_THEME" 'case \.tempo: *return Color\(hex: 0xFF5722\)'     'iOS tempo dot = #FF5722'
need "$IOS_THEME" 'case \.intervals: *return Color\(hex: 0xF43F5E\)' 'iOS intervals dot = #F43F5E'
need "$IOS_THEME" 'case \.race: *return Color\(hex: 0xFF5722\)'      'iOS race dot = #FF5722'

# TweakAccent · ruled exempt 2026-06-09 · ember default = locked palette,
# variant values byte-synced web↔iPhone.
need "$IOS_THEME" 'case \.ember: *return Color\(hex: 0xF3AD38\)' 'TweakAccent ember.goal = locked #F3AD38'
need "$IOS_THEME" 'case \.ember: *return Color\(hex: 0xFF5722\)' 'TweakAccent ember.race = locked #FF5722'
need "$WEB_CSS" 'data-accent="gold"\]\{--goal:#F5C518;--race:#F5A518;\}'   'web gold accent = iPhone gold'
need "$WEB_CSS" 'data-accent="violet"\]\{--goal:#A78BFA;--race:#B794F4;\}' 'web violet accent = iPhone violet'
need "$WEB_CSS" 'data-accent="cool"\]\{--goal:#27B4E0;--race:#3AA0E0;\}'   'web cool accent = iPhone cool'
need "$IOS_THEME" 'return Color\(hex: 0xF5A518\)' 'iPhone gold.race = #F5A518'
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
need "$WATCH_THEME"   'orange *= Color\(hex: 0xFF5722\)' 'watch C.orange = #FF5722'
need "$WATCH_THEME"   'warn *= Color\(hex: 0xFC4D64\)'   'watch C.warn = #FC4D64'
need "$WATCH_FACEKIT" 'live *= Color\(hex: 0x3EBD41\)'   'watch Faff.live = #3EBD41'
need "$WATCH_FACEKIT" 'goal *= Color\(hex: 0xF3AD38\)'   'watch Faff.goal = #F3AD38'
need "$WATCH_FACEKIT" 'over *= Color\(hex: 0xFC4D64\)'   'watch Faff.over = #FC4D64'
need "$WATCH_FACEKIT" 'dist *= Color\(hex: 0x27B4E0\)'   'watch Faff.dist = #27B4E0'
need "$WATCH_FACEKIT" 'bonus *= Color\(hex: 0xF5C518\)'  'watch Faff.bonus = #F5C518'

# ── 2 · RETIRED-HEX TRIPWIRE ────────────────────────────────────────────────
# Dead by the AFC cutover. Historical comment mentions are filtered by
# keyword; a retired hex on a live code line fails the build.
# Dropped from the retired list (legitimately alive outside semantics):
#   2FAF7C · time-of-day morning mesh stop (gradient ingredient, exempt)
#   56E0B0 · TrainView phase-identity taper color (categorical phase
#            palette · pending brief-v2 ruling, tracked in the AFC recap)
# 5FD06A · the rogue 4th green, fully eliminated in the 2026-06-16 web
#          color consolidation (snapped to --green #3EBD41). Tripwire so
#          it can never return. NOTE: FFB24D / FF6A6A are NOT retired —
#          they're now the legit --warn-text / --over-text token values.
RETIRED='FF8847|48B3B5|008FEC|9013FE|2CA82F|D4900A|E85D26|D03F3F|D63E4E|EE6038|FF8870|34D058|5FD06A'
HIST_FILTER='deleted|retired|was |were |old |previously|killed|AFC fix|→'

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

if [ "$fail" -eq 0 ]; then
  echo "palette-sync OK · ten-color lock verified across web / iPhone / watch"
fi
exit $fail
