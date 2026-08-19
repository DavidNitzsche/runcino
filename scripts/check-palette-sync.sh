#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# check-palette-sync.sh · brief v2 §1 build enforcement (AFC 2026-06-09)
#
# Two guards, exit 1 on any violation:
#
#   1. LOCK CHECK   · every semantic slot of a surface's locked palette is
#                     present with the exact expected hex in that surface's
#                     token file (web globals.css / constants.ts, iPhone
#                     ThemeV5.swift + Theme.swift, watch WatchTheme.swift +
#                     FaceKit.swift). The tables below ARE the lock.
#
#                     WHICH DOCUMENT RULES WHICH SURFACE (2026-08-19):
#                       · iPhone → design/0819/design_handoff_faff_iphone_app v5
#                         (README.md + Faff-iPhone-App.dc.html). That handoff is
#                         the approved product. `Design/running-app-design-brief-v2.md`
#                         is SUPERSEDED for the phone — most visibly, brief v2
#                         retired orange app-wide and the phone's primary accent
#                         is now Signal orange #FF5A1F. Change a phone token by
#                         changing the v5 handoff first, then ThemeV5.swift,
#                         then this file. Do NOT reconcile a phone value against
#                         brief v2.
#                       · web + watch → brief v2, unchanged. Neither surface is
#                         being redesigned into v5, and the cross-surface drift
#                         this gate exists to prevent is still real between them.
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
#
# WEB EXEMPTED 2026-08-18 (David: "iphone doesnt matter right now until we
# update design and implementation"). Web is implementing a full site-wide
# redesign (outside-studio brief, docs/design/DESIGN-BRIEF-site-wide-redesign.md)
# with a different palette — warm paper ground, its own 7-color state system —
# while iPhone/watch stay on the locked ten-color palette below, untouched,
# for now. Every web-only assertion (globals.css / constants.ts / TrainView.tsx)
# is commented out, not deleted — re-enable once web's new palette is itself
# locked and iPhone/watch are redesigned to match it, per brief v2's own
# "byte-for-byte across all three surfaces" intent. iPhone↔watch checks below
# are untouched: neither surface is changing, so keeping them honest costs
# nothing. The RETIRED-HEX tripwire and the Z2-ladder assertion are scoped to
# exclude web-v2 for the same reason — a hex "retired" under the OLD web
# palette is not necessarily banned from the NEW one, and re-litigating that
# per-hex is exactly the busywork this exemption exists to avoid.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB_CSS="$ROOT/web-v2/app/globals.css"
WEB_CONST="$ROOT/web-v2/components/faff-app/constants.ts"
IOS_THEME="$ROOT/native-v2/Faff/Faff/Theme.swift"
IOS_THEME_V5="$ROOT/native-v2/Faff/Faff/ThemeV5.swift"
IOS_FONTS_V5="$ROOT/native-v2/Faff/Faff/FontsV5.swift"
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
# Web tokens — DISABLED (redesign 2026-08-18): web's palette is being fully
# replaced; see the exemption note above. Re-enable once web's new palette
# is locked and these hexes are updated to match it (or iPhone/watch adopt
# web's new palette instead — that ruling hasn't happened yet).
# need "$WEB_CSS" '\-\-race:#D03F3F'        'web --race = #D03F3F (Race/Tempo · Redish · orange retired, reads Strava)'
# need "$WEB_CSS" '\-\-goal:#F3AD38'        'web --goal = #F3AD38 (Long)'
# need "$WEB_CSS" '\-\-green:#3EBD41'       'web --green = #3EBD41 (Good state)'
# need "$WEB_CSS" '\-\-over:#FC4D64'        'web --over = #FC4D64 (Off/warn)'
# need "$WEB_CSS" '\-\-dist:#27B4E0'        'web --dist = #27B4E0 (Recovery)'
# need "$WEB_CSS" '\-\-intervals:#FC4D64'   'web --intervals = #FC4D64 (Intervals · = Warning red, ceiling)'
# need "$WEB_CSS" '\-\-watch:#F3AD38'       'web --watch = #F3AD38 (Watch attention)'
# need "$WEB_CSS" '\-\-gold:#F0DF47'        'web --gold = #F0DF47 (PR gold · Light Yellow)'
# need "$WEB_CSS" '\-\-eyebrow:#F3AD38'     'web --eyebrow = #F3AD38 (Eyebrow · = Attention amber)'
# need "$WEB_CSS" '\-\-eff-easy:#3EBD41'    'web --eff-easy = #3EBD41 (Easy)'
# need "$WEB_CSS" '\-\-eff-tempo:#D03F3F'   'web --eff-tempo = #D03F3F'
# need "$WEB_CSS" '\-\-eff-intervals:#FC4D64' 'web --eff-intervals = #FC4D64'
# need "$WEB_CSS" '\-\-eff-race:#D03F3F'    'web --eff-race = #D03F3F'
# need "$WEB_CSS" '\-\-warn-text:#F3AD38'   'web --warn-text = #F3AD38 (= Attention amber)'
# need "$WEB_CSS" '\-\-over-text:#FC4D64'   'web --over-text = #FC4D64 (= Warning red)'
# need "$WEB_CSS" '\-\-strava:#FC4C02'      'web --strava = #FC4C02 (Strava brand, lock-exempt)'

# Web effort dots (constants.ts) — DISABLED (redesign 2026-08-18), same reason.
# need "$WEB_CONST" "easy:.*dot: '#3EBD41'"      'web EFF.easy.dot = #3EBD41'
# need "$WEB_CONST" "tempo:.*dot: '#D03F3F'"     'web EFF.tempo.dot = #D03F3F'
# need "$WEB_CONST" "intervals:.*dot: '#FC4D64'" 'web EFF.intervals.dot = #FC4D64'
# need "$WEB_CONST" "race:.*dot: '#D03F3F'"      'web EFF.race.dot = #D03F3F'
# need "$WEB_CONST" "recovery:.*dot: '#27B4E0'"  'web EFF.recovery.dot = #27B4E0'
# need "$WEB_CONST" "long:.*dot: '#F3AD38'"      'web EFF.long.dot = #F3AD38'

# ── 1a · iPhone · THE v5 PALETTE (authoritative, 2026-08-19) ───────────────
# Source: design/0819/design_handoff_faff_iphone_app v5. The six day-state
# ramps are read out of that bundle's own token block (the `:root { --g-*-panel }`
# in Faff-iPhone-App.dc.html), which is the only machine-readable token
# declaration the handoff ships; every hex below that also appears there is
# byte-identical to it. The rest come from the handoff README, which states its
# hexes are exact.
need "$IOS_THEME_V5" 'ground *= Color\(hex: 0x000000\)'    'v5 phone ground = #000000 (pure black page)'
need "$IOS_THEME_V5" 'surface1 *= Color\(hex: 0x0F1011\)'  'v5 phone surface step 1 = #0F1011'
need "$IOS_THEME_V5" 'surface2 *= Color\(hex: 0x17191B\)'  'v5 phone surface step 2 = #17191B'
need "$IOS_THEME_V5" 'surface3 *= Color\(hex: 0x212427\)'  'v5 phone surface step 3 = #212427'
need "$IOS_THEME_V5" 'surface4 *= Color\(hex: 0x2A2E32\)'  'v5 phone surface step 4 = #2A2E32'
need "$IOS_THEME_V5" 'signal *= Color\(hex: 0xFF5A1F\)'    'v5 phone Signal orange = #FF5A1F (position/primary action · never "good")'
need "$IOS_THEME_V5" 'attention *= Color\(hex: 0xF2B03C\)' 'v5 phone Attention amber = #F2B03C (out of range / stale / modelled tilde · never "error")'
need "$IOS_THEME_V5" 'fault *= Color\(hex: 0xFF4438\)'     'v5 phone Fault red = #FF4438 (could not read · never renders a real value)'

# The six day-state gradients · three stops each, exact, one line per state.
need "$IOS_THEME_V5" 'easy: *\[Color\] = \[Color\(hex: 0x3EBD41\), Color\(hex: 0x1F8A52\), Color\(hex: 0x0F4A3A\)\]'    'v5 day-state EASY = #3EBD41 → #1F8A52 → #0F4A3A'
need "$IOS_THEME_V5" 'rest: *\[Color\] = \[Color\(hex: 0x008FEC\), Color\(hex: 0x4A3A8E\), Color\(hex: 0x1C1A3A\)\]'    'v5 day-state REST = #008FEC → #4A3A8E → #1C1A3A'
need "$IOS_THEME_V5" 'quality: *\[Color\] = \[Color\(hex: 0xF3AD38\), Color\(hex: 0xE85D26\), Color\(hex: 0x7A2828\)\]' 'v5 day-state THRESHOLD/QUALITY = #F3AD38 → #E85D26 → #7A2828'
need "$IOS_THEME_V5" 'race: *\[Color\] = \[Color\(hex: 0xFF8847\), Color\(hex: 0xE85D26\), Color\(hex: 0x7A2828\)\]'    'v5 day-state RACE = #FF8847 → #E85D26 → #7A2828'
need "$IOS_THEME_V5" 'phase: *\[Color\] = \[Color\(hex: 0xB084FF\), Color\(hex: 0x6A4ACE\), Color\(hex: 0x2A1A5A\)\]'   'v5 day-state BLOCK PHASE = #B084FF → #6A4ACE → #2A1A5A'
need "$IOS_THEME_V5" 'long: *\[Color\] = \[Color\(hex: 0x27B4E0\), Color\(hex: 0x1A6A9E\), Color\(hex: 0x0C2A5E\)\]'    'v5 day-state LONG RUN = #27B4E0 → #1A6A9E → #0C2A5E'

# NO GREEN AS A VERDICT. The v5 palette has no "good" colour: Signal orange is
# explicitly "never means good", and the only green in the system is the EASY
# day-state ramp (which says what kind of day it is, not that it went well).
# Nothing to assert positively — this note exists so the next person adding a
# "success green" to the phone reads why there isn't one.

# v5 typography · the two families, and the display register's exact axes.
# Both faces are variable fonts; the display instance (Archivo wght 800 at
# wdth 112) is NOT a named instance in the file, so it is only reachable by
# setting axes. See FontsV5.swift.
need "$IOS_FONTS_V5" 'textFamily *= "Instrument Sans"'  'v5 phone text face = Instrument Sans'
need "$IOS_FONTS_V5" 'displayFamily *= "Archivo"'       'v5 phone display face = Archivo'
need "$IOS_FONTS_V5" 'displayWeight: Double *= 800'     'v5 phone display weight = 800'
need "$IOS_FONTS_V5" 'displayWidth: *Double *= 112'     'v5 phone display width = 112'
need "$ROOT/native-v2/project.yml" 'InstrumentSans-Variable\.ttf' 'Instrument Sans registered in UIAppFonts'
need "$ROOT/native-v2/project.yml" 'Archivo-Variable\.ttf'        'Archivo registered in UIAppFonts'

# ── 1b · iPhone · the LEGACY ten-colour palette, asserted while it is used ──
# The v5 build session rewires call sites off these tokens. Until the last one
# is gone they must stay correct — a half-migrated palette on a device is the
# outcome worth avoiding, and TestFlight is still serving the legacy skin.
#
# THIS BLOCK EXPIRES ON ITS OWN. When no file under native-v2 outside
# Theme.swift references a legacy token any more, the branch below inverts: it
# stops asserting the values and starts requiring the declarations be DELETED.
# Nobody has to remember to come back and remove it.
LEGACY_PHONE_TOKEN_RE='Theme\.(green|goal|over|dist|rest|race|intervals|warnText|overText)\b|TweakAccent|Theme\.Zone|Theme\.Phase|FaffEffort'
legacy_phone_files=$(grep -rlE "$LEGACY_PHONE_TOKEN_RE" "$ROOT/native-v2/Faff/Faff" \
  --include='*.swift' 2>/dev/null \
  | grep -v '/\._' | grep -v '/Theme\.swift$' | grep -v '/ThemeV5\.swift$' || true)
legacy_phone_count=$(printf '%s' "$legacy_phone_files" | grep -c . || true)

if [ "$legacy_phone_count" -gt 0 ]; then
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
else
  if grep -qE 'green *= Color\(hex: 0x3EBD41\)|goal *= Color\(hex: 0xF3AD38\)' "$IOS_THEME"; then
    echo "PALETTE LOCK FAIL · legacy phone palette has no consumers left but is still declared"
    echo "  Nothing under native-v2 references Theme.green / .goal / .over / .dist /"
    echo "  .race / .intervals / TweakAccent / Theme.Zone / Theme.Phase / FaffEffort"
    echo "  any more. The v5 migration is complete, so the old palette must go:"
    echo "    1. delete the legacy token block from native-v2/Faff/Faff/Theme.swift"
    echo "    2. delete section 1b of this script (this whole if/else)"
    echo "  Two palettes in one app is how a half-migrated skin ships."
    fail=1
  fi
fi
# Web accent assertions — DISABLED (redesign 2026-08-18): web↔iPhone accent
# parity is moot while web's whole palette is being replaced.
# need "$WEB_CSS" 'data-accent="gold"\]\{--goal:#F0DF47;--race:#F0DF47;\}'   'web gold accent = iPhone gold (Light Yellow)'
# need "$WEB_CSS" 'data-accent="violet"\]\{--goal:#A78BFA;--race:#B794F4;\}' 'web violet accent = iPhone violet'
# need "$WEB_CSS" 'data-accent="cool"\]\{--goal:#27B4E0;--race:#3AA0E0;\}'   'web cool accent = iPhone cool'
# TweakAccent variants · legacy phone palette, so they live and die with
# section 1b's reference count (v5 has one accent, Signal orange, and no
# user-preference recolour).
if [ "$legacy_phone_count" -gt 0 ]; then
  need "$IOS_THEME" 'case \.gold: *return Color\(hex: 0xF0DF47\)' 'iPhone gold accent = #F0DF47 (Light Yellow)'
  need "$IOS_THEME" 'return Color\(hex: 0xB794F4\)' 'iPhone violet.race = #B794F4'
  need "$IOS_THEME" 'return Color\(hex: 0x3AA0E0\)' 'iPhone cool.race = #3AA0E0'
fi

# Phase-identity categorical group · ruled adopted 2026-06-09 · phase
# visualizations only (web TrainView today).
# DISABLED (redesign 2026-08-18): TrainView itself is in scope for the
# redesign and its phase colors will change with everything else.
# WEB_TRAIN="$ROOT/web-v2/components/faff-app/views/TrainView.tsx"
# need "$WEB_TRAIN" "return '#5BD8D2'" 'phase BASE = #5BD8D2'
# need "$WEB_TRAIN" "return '#FFCB47'" 'phase BUILD = #FFCB47'
# need "$WEB_TRAIN" "return '#FF7733'" 'phase PEAK = #FF7733'
# need "$WEB_TRAIN" "return '#56E0B0'" 'phase TAPER = #56E0B0'

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
# 2026-08-17 · LADDER GREEN RETIRED FOR REAL (David: "I want both to match,
# so use whatever is best for the use/implementation" · brief v2 ADDENDUM 3,
# superseding the same-day entry that had sanctioned it as a web categorical).
#   14C08C · easy + the Z2 ladder rung -> locked green #3EBD41. This is the
#            one hex the AFC cutover retired but never added here, which is
#            exactly why ~36 web call sites shipped it unguarded. iPhone had
#            already migrated (Theme.swift Zone.z2 / ZoneSplit.z2), so web
#            moved to the phone: no native change, no TestFlight build.
RETIRED='FF8847|48B3B5|008FEC|9013FE|2CA82F|D4900A|E85D26|D63E4E|EE6038|FF8870|34D058|5FD06A|27E087|FF5722|FF7A45|E88021|F43F5E|F5C518|F5A518|FFCE8A|FFB24D|FF6A6A|FF5A52|14C08C'
# Decimal-RGB forms of the retired hexes. A hex-only grep is blind to these:
# rgba(20,192,140,.18) is the same dead teal as #14C08C, and the 2026-08-17
# audit found exactly that shape surviving. Add the decimal triple here
# whenever a hex goes on the RETIRED list above — a retired colour that
# survives in decimal notation is just as dead and twice as invisible.
#
# 2026-08-17 · DECIMAL BACKLOG CLEARED (20 of the 24 retirees). The previous
# pass wired up 14C08C only and left the rest documented-but-unguarded; those
# call sites are now migrated to their locked replacement, so the triples can
# be locked with them:
#   245,197,24  F5C518 -> PR gold #F0DF47      · toolkit --status-pr-border /
#                        .fa-reply / .fa-toast / .fa-result.is-pr · globals
#                        .lr .lb.pr / .pfpro / .prcta (each already inked
#                        #F0DF47 — the wash was the last stale half)
#   95,208,106  5FD06A -> --green #3EBD41      · globals .onpath-trans-up /
#                        .wpb-done / .haero-chip-* / .hfc-ic-good /
#                        .hact-pri-on-course · toolkit sheets saved-tick
#   244,63,94   F43F5E -> Warning #FC4D64      · HealthView sleep-flag border
#                        (COLOR_BAD on the eyebrow beside it is already FC4D64)
#   255,87,34   FF5722 -> Redish #D03F3F       · globals .pjtick.proj glow
#                        (its fill was already var(--race))
#   255,136,71  FF8847 -> per-site, no single mapping (a v1 retiree that
#                        "merges into the table"; brief v2 line 32):
#                        · .wc.today ring/border -> #D03F3F, matching
#                          `.wc.today .wc-dw{color:var(--race)}` right below it
#                        · PhaseStrip/PlanArc PHASE_FILL.RACE -> #D03F3F, per
#                          PlanArc's own legend "RACE = var(--race)"
#                        · .fa-callout--cond (flame/Conditions, sibling of the
#                          teal --tip) -> Attention #F3AD38, matching
#                          .fa-heat--warm in the same file; its #FFB07A ink
#                          collapsed to #F3AD38 too, the same bright-sibling
#                          merge the 2026-06-17 pass did to #FFB24D
#                        · .pay-left / .upsell warm->hot gradients -> #F3AD38.
#                          NOT #D03F3F: the second stop is already #FC4D64, so
#                          the race red would flatten both gradients into one
#                          near-uniform wash. Amber keeps the temperature ramp
#                          and matches .pay-mark, already #F3AD38.
# The rest had zero live decimal sites and are locked pre-emptively.
#
# NOTE · FOUR retirees still have live decimal call sites and are deliberately
# NOT in the list below — adding them today would only turn CI red:
#   255,206,138 FFCE8A · ~36 sites (globals eyebrow/annotation washes, Shell,
#                        PlanProposalCard, RunDetailModal, WorkoutDetail,
#                        TodayView, TrainView) -> Attention #F3AD38
#   255,178,77  FFB24D · ~7 sites (globals .drv-bar/.reachbn, TodayView warn
#                        cards) -> Attention #F3AD38
#   0,143,236   008FEC · 4 sites · brand-gradient blue. .fa-gate is plausibly
#                        the sanctioned gate/launch use (brief v2 "reserved for
#                        gate / launch / brandmark only"); the RunDetailModal /
#                        SimpleCards uses read as a Recovery rung and want
#                        --dist #27B4E0. Needs a ruling, not a sed.
#   72,179,181  48B3B5 · 4 sites (PlanProposalCard, RaceView) -> needs the same
#                        per-site read as FF8847 got.
# Migrate those, then move their triples into the list.
RETIRED_RGB_TRIPLES='20,192,140 39,224,135 44,168,47 52,208,88 95,208,106 144,19,254 212,144,10 214,62,78 232,93,38 232,128,33 238,96,56 244,63,94 245,165,24 245,197,24 255,87,34 255,90,82 255,106,106 255,122,69 255,136,71 255,136,112'
# Expand "r,g,b" -> "r *, *g *, *b" so CSS/JSX spacing variants are caught
# too: rgba(95, 208, 106, .18) is the same dead green as rgba(95,208,106,.18).
RETIRED_RGBA=''
for _t in $RETIRED_RGB_TRIPLES; do
  RETIRED_RGBA="${RETIRED_RGBA:+$RETIRED_RGBA|}${_t//,/ *, *}"
done
# gstop · hero gradient stop ingredient (FaffEffort.heroGradient 2026-06-18).
# Same exemption logic as FaffMesh: blend ingredients, not semantic colors.
# v5stop · day-state gradient stop in ThemeV5.swift (2026-08-19). Three hexes
# the OLD phone palette retired — #FF8847 and #E85D26 (race/tempo, retired when
# David ruled orange reads "Strava") and #008FEC (corporate blue, deleted when
# rest folded into recovery) — are restored by the v5 handoff as ramp stops in
# the race / quality / rest gradients. They are approved there and nowhere else,
# which is why this is a marker on those specific lines rather than a deletion
# from the RETIRED list: a bare #FF8847 anywhere else on the phone still fails.
HIST_FILTER='deleted|retired|was |were |old |previously|killed|AFC fix|→|gstop|v5stop'
# Brandmark sweep · logo identity, exempt under the header rules and byte-
# identical web↔iPhone. It is the ONLY sanctioned home of #14C08C. Matched by
# the sweep's own signature: the 95deg CSS gradient and Theme.swift's stop
# table comment. Everything else on the RETIRED list is banned outright.
BRAND_SWEEP_EXEMPT='linear-gradient\( *95deg|// *55% +emerald'

# web-v2 excluded (redesign 2026-08-18): a hex "retired" under the OLD web
# palette is not a claim about the NEW one, and web is expected to introduce
# hexes this tripwire would otherwise flag as resurrected. native-v2/legacy
# paths unchanged — neither surface is being touched, so the tripwire still
# does real work there.
hits=$(grep -rinE "(#|0x)($RETIRED)|rgba?\( *($RETIRED_RGBA) *[,)]" \
  "$ROOT/native-v2/Faff/Faff" \
  "$ROOT/legacy/native/Faff/FaffWatch Watch App" \
  --include='*.css' --include='*.ts' --include='*.tsx' --include='*.swift' \
  2>/dev/null | grep -viE "$HIST_FILTER" | grep -vE "$BRAND_SWEEP_EXEMPT" \
  | grep -v '/\._' \
  | grep -v '/app/dev/' || true)
# Exclusions: /app/dev/ = design mockup routes (not product surface).
# The components/today/WeekStrip.tsx carve-out that used to live here is
# gone — that file was the dead-code exemption it describes, and the CIM
# sweep deleted it (2026-08-17). No live surface needs an exemption.

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

# ── 4 · Z2 LADDER RUNG · one green, both surfaces ───────────────────────────
# Ruled 2026-08-17 (David: "I want both to match, so use whatever is best for
# the use/implementation" · brief v2 ADDENDUM 3). The retired teal #14C08C is
# banned outright — enforced by the RETIRED tripwire in section 2, hex and
# rgba() decimal forms both. What remains here is the positive half: the Z2
# rung must actually BE the locked green on every surface, so a future
# "restore the teal ladder" pass fails instead of quietly re-splitting the
# surfaces. Zone 2 IS easy; the rung and the easy-effort green are one color
# by design, not by accident.
# Web ladder assertions — DISABLED (redesign 2026-08-18), same reason as
# section 1. iOS keeps its own check below since it isn't changing.
# need "$WEB_CONST" "ZC = \['#27B4E0','#3EBD41'" 'ladder ZC Z2 = #3EBD41 (brief v2 ADDENDUM 3)'
# need "$ROOT/web-v2/components/faff-app/session-shape.ts" \
#   "2: '#3EBD41'" 'ladder session-shape ZONE_COLOR z2 = #3EBD41'
# Legacy phone ladder · gated on the same reference count as section 1b.
if [ "$legacy_phone_count" -gt 0 ]; then
  need "$IOS_THEME" 'z2 = Color\(hex: 0x3EBD41\)' \
    'iPhone ladder z2 = #3EBD41 (web comparison suspended, see redesign exemption above)'
fi

if [ "$fail" -eq 0 ]; then
  echo "palette-sync OK · iPhone v5 palette + typography locked; watch ten-color lock verified (web exempted for redesign, see header)"
  if [ "$legacy_phone_count" -gt 0 ]; then
    echo "  · legacy phone palette still asserted — $legacy_phone_count file(s) under native-v2 reference it."
    echo "    When that reaches 0, this gate flips and requires the legacy block deleted from Theme.swift."
  fi
fi
exit $fail
