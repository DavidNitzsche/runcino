# faff.run Design Brief v2

**Date:** 2026-06-09 · **Status:** Locked · **Enforced from:** Build 200+ 

---

## CORE DOCTRINE

**One color authority: effort temperature.**

Every color in faff.run encodes one semantic: the effort intensity of a workout, the state of a training metric, or the status of a decision. There is one palette. There is one hex per meaning. That hex is identical on web, iPhone, and watch. No exceptions.

---

## THE TEN-COLOR PALETTE

This is the entire permitted semantic color set. Every pixel outside this table is a neutral (charcoal, white, border gray).

| Semantic | Hex | Usage |
|----------|-----|-------|
| **Race/Tempo** | `#D03F3F` | Race-day celebrate, tempo pace, race-morning hero, race mesh (Redish · 2026-06-18: David ruled ANY orange reads "Strava", so race/tempo is the deep race-red — distinct from the brighter Warning red on intervals) |
| **Long** | `#F3AD38` | Long-run effort, long mesh, goal-distance thinking |
| **Easy** | `#3EBD41` | Easy-effort dot and label · = Good-state green (palette consolidation 2026-06-17, David's canonical palette: one green) |
| **Recovery** | `#27B4E0` | Recovery effort, detraining signal (cool/info), recovery mesh |
| **Intervals** | `#FC4D64` | Interval/quality effort, quality mesh, VO₂ work (= the ceiling/Warning red · 2026-06-17 merged the Zone + ZoneSplit ladders into one; intervals is the hottest rung, differentiated from off/warn by context not a second near-red) |
| **Good state** | `#3EBD41` | On-track, readiness "good", execution ≥95%, strength-done badge |
| **Off/warn** | `#FC4D64` | Behind goal, off-track, warning signal, VO₂ MAX ceiling breach |
| **Watch attention** | `#F3AD38` | Watch hero numbers, in-run pace alerts, emphasis |
| **PR gold** | `#F0DF47` | Personal record, milestone unlock, peak achievement (Light Yellow · palette pass 2026-06-17) |
| **Eyebrow** | `#F3AD38` | Inline annotation, time-of-day label, secondary metadata (= Attention amber, dialed back via alpha where it reads loud · palette pass 2026-06-17) |

**Retired tokens from v1:** `#FF8847`, `#14C08C` (easy → `#3EBD41`), `#4F8FF7` — all merge into the table above. `#14C08C` is retired **without exception** outside the brandmark sweep, and is on the CI retired-hex tripwire in both its hex and `rgba(20,192,140,…)` decimal forms. See ADDENDUM ruling 3.

**Retired in the 2026-06-17 canonical-palette pass** (David handed the full brand palette: "every color from this; only rule is never Aquamarine `#27E087`"). The effort + zone scale now reads as a single temperature line — Recovery `#27B4E0` → Easy `#3EBD41` → Long `#F3AD38` → Tempo/Race `#D03F3F` → Intervals `#FC4D64`:

- `#FF5722` / `#FF7A45` / `#E88021` (race/tempo · orange retired 2026-06-18 — David ruled any orange reads "Strava") → **`#D03F3F`** Redish (deep race-red, distinct from the brighter Warning red on intervals)
- `#F43F5E` (intervals) → **`#FC4D64`** Warning red
- `#F5C518` / `#F5A518` (PR gold + gold tweak) → **`#F0DF47`** Light Yellow
- `#FFCE8A` (eyebrow) · `#FFB24D` (bright warn text) → **`#F3AD38`** Attention
- `#FF6A6A` (bright over text) · `#FF5A52` (live pulse) → **`#FC4D64`** Warning

Depth comes from alpha steps of these hues, not new hexes. The brand gradient is XP→Corporate (`#9013FE`→`#008FEC`), reserved for gate / launch / brandmark only.

---

## NEUTRALS

- **Page/canvas:** charcoal (`#1a1a1a` or theme-driven dark)
- **Border/divider:** `#333333` or theme `rgba(255,255,255,.08)`
- **Text/primary:** white (`#ffffff`)
- **Text/secondary:** `#999999` or `rgba(255,255,255,.6)`
- **Surface/glass:** none — use dark neutrals only. No frosted glass, no blur, no shadows on chrome.

---

## MESH AND GRADIENTS

Effort-temperature meshes (Today view, iPhone tab backgrounds) derive from the effort scale as *gradient ingredients*, not semantic colors:

- **Race mesh:** race orange → long → white (hero celebration)
- **Tempo/intervals mesh:** race orange → intervals → race orange (quality intensity)
- **Long mesh:** long → easy → white (endurance scale)
- **Health/recovery mesh:** recovery → easy → white (restoration)

Web uses charcoal-neutral mesh on all views except dedicated race (race mesh) and Profile/Spectator (recovery mesh) — per Shell.tsx:134-164 as of 2026-06-04. iPhone aligns: same charcoal baseline, race hero on race-day, recovery on Profile.

Mesh gradient tables live **only** in constants.ts (web) and Theme.swift/FaceKit.swift (iOS/watch). No hardcoded mesh colors anywhere else.

---

## TYPOGRAPHY

**One typeface family per role:**

- **Display/numbers:** Oswald (all caps, numbers, hero stats, big data)
- **Body/UI:** Inter (labels, buttons, prose, metadata)

**No other typefaces.** (Retire any lingering system font fallbacks, Avenir, or other single-use faces.)

**Font-size minimum:** Oswald at 16pt minimum for display use. Below that, use Inter.

---

## CRITICAL RULES

### 1. Cross-Surface Sync
Every hex in the table above must be byte-for-byte identical on web (globals.css), iPhone (Theme.swift), and watch (WatchTheme.swift, FaceKit.swift). No "interpretation" per device. If the brief says `#3EBD41`, every surface renders `#3EBD41`.

**CI Check Required:** Add a grep-and-diff script that fails the build if:
- A hex appears outside the ten-color table or neutrals
- A semantic color (e.g., easy-dot, race-dot) has different hex on web vs iOS vs watch

### 2. Semantic Purity
- One color = one meaning. If an effort-state needs a different color, it's a *different state*, not a shade.
- Off-track/behind-goal = `#FC4D64` (warn), never race orange.
- DETRAINING (too little stress) = `#27B4E0` (recovery/info), not `#F3AD38` (long/attention). The cool hue reads "too fresh" semantically.
- LOADED (too much stress) = `#F3AD38` (long/caution), distinct from DETRAINING by meaning + treatment (filled vs outline, if needed).
- If you're tempted to invent a 24th orange, stop and ask: is this a *different effort*, or does it belong to an existing effort? If different, propose a palette change. If same, use the canonical hex.

### 3. Glass Is Retired
No frosted glass, no shadows, no blur on:
- Tab bars
- Nav chrome
- Surface overlays

Use dark neutrals + sharp edges. (This aligns with the original brief v1 intent; the shipped product drifted into glass during execution. We're correcting course.)

### 4. Empty States and Cold Starts
- iPhone cold-start (before data loads): show the Faff brandmark (animated wordmark, centered). Never a black void.
- Empty view states: use "WHAT TO DO" (Web Health hero), not generic "no data." Offer a next action.

### 5. Label Grammar
Training status, readiness state, and effort labels use **one-word + optional context**:
- "SHARP" (not "sharp edge")
- "LOADED" (not "you are loaded")
- Use caps for all training-state labels on web and watch for visual consistency.

### 6. Banners and Pre-Hero Alerts
- Max one banner above the hero on any view.
- On race morning (< 24h to goal race), hide the week strip and other secondary context. Hero only.

### 7. Mesh Assignment (Web)
- **Charcoal neutral:** Today, Train, Health, Activity, Goals
- **Race mesh:** Race-day view (after Aug 16, or when in race-day hero state)
- **Recovery mesh:** Profile, Spectator, passive review views
- Per-tab mesh colors are retired. One mesh rule per view purpose.

### 8. Mesh Assignment (iPhone)
- **Charcoal neutral:** Today tab (default state)
- **Race mesh:** Today tab (race-day hero state)
- **Effort-specific mesh:** Train tab per effort type, Health tab recovery mesh, Targets tab — use charcoal, not red intervals mesh
- iPhone Targets red intervals mesh (killed on web 2026-06-04 for contrast failure) does not ship.

### 9. Watch In-Run Design
- NumberFace: number + role-color role-label grammar. No changes needed — this is world-class.
- TempoFace: add signed delta row (pace delta vs goal, ±format, same role color as number).
- Verdict row (post-run summary): state (on-pace / under / over), plus one-word verdict (good / steady / sharp / loaded). Use effort-scale color for state, `#3EBD41` for good verdicts.
- All watch hex values mirror web/iOS byte-for-byte.

### 10. If Research Surfaces a Real Reason to Change
Propose the change, document it, and update this brief. Don't silently drift to a 25th orange. Brief v2 is the source of truth now.

---

## COMPETITIVE POSITION

**What makes faff.run unique:**
- The effort-temperature system (one hue family per effort intensity)
- The skip-grayscale moment (color as data, not decoration)
- The coach-voice verdict on every surface ("Your goal is 1:30 · a 4:12 gap" — Goal page)
- The watch role-color number grammar (number + color + one-word label, no chrome)

Everything else in the design — layout, motion, empty states, copy — serves those four things. Consistency in color and typography is how we protect them.

---

## BUILD ENFORCEMENT

Starting from build 200:
- Hex-lint CI check (blocks merge if hex appears outside the table)
- Cross-surface grep-and-diff (fails if web and iOS hex diverge for same semantic)
- tsc 0 on web changes; xcodebuild clean on iOS changes
- Every color change shows diff + waits for explicit GO before landing on main

---

## TRANSITION (Build 200–201)

- Brief v2 replaces v1 as the locked design source
- v1 file archived (Design/running-app-design-brief.md.archived)
- All color-lock fixes land as a unit (AFC fixes 1–7) to avoid cross-surface drift during the cutover
- No partial deployments; web and iOS move together on the palette

---

**Authored by:** UI Audit (Opus, 2026-06-09)  
**Locked by:** David Nitzsche  
**Enforced from:** Build 200+

---

## ADDENDUM · RULINGS (2026-06-09, ruled by David during the queued-task pass)

**1. TweakAccent (Settings → Tweaks accent recolors) — EXEMPT as user preference.**
The opt-in accent variants (gold `#F5C518/#F5A518`, violet `#A78BFA/#B794F4`, cool `#27B4E0/#3AA0E0`) sit outside the ten-color table by design: they are a deliberate personalization feature, not product semantics. Rules: the **default (ember) must always equal the locked palette** (`#F3AD38` goal / `#FF5722` race); variant values are byte-for-byte identical on web (`globals.css [data-accent=…]`) and iPhone (`Theme.TweakAccent`) — verified in CI.

**2. Phase-identity palette — ADOPTED as a sanctioned categorical group.**
BASE `#5BD8D2` · BUILD `#FFCB47` · PEAK `#FF7733` · TAPER `#56E0B0` (+ maintenance/recovery cousins in `TrainView.phaseMeshGradient`). Same standing as brief v1's course-phase palette: these colors appear **only** in phase visualizations (Train ramp bars, phase cards, phase axis) and never substitute for the ten semantic accents. Currently web-only; if iPhone ever renders phase-colored elements, the hexes mirror byte-for-byte. CI asserts the four hexes in `TrainView.tsx`.

---

**3. Ladder green `#14C08C` — RETIRED WITHOUT EXCEPTION. The Z2 rung is `#3EBD41` on every surface (ruled 2026-08-17, David).**

David's words: *"I want both to match, so use whatever is best for the use/implementation."*

**This supersedes the earlier same-day entry** which had adopted `#14C08C` as a sanctioned web categorical for ordered ladders (web recomposition deck Decision 7, Option A). That entry stood for a matter of hours and is withdrawn, not amended — the brief records one ruling on this, and it is this one.

**Why the first ruling did not survive.** The deck sold Option A on the premise "no code changes, iPhone stays byte-synced." The premise was false. iPhone had **already** migrated its ladder: `Theme.swift` `Zone.z2` and `ZoneSplit.z2` read `0x3EBD41`, and `RouteMapView.swift` bucket colors carry `0x3EBD41` with the comment "was #14C08C teal". Sanctioning the teal on web would therefore have *created* a cross-surface split rather than preserved one — the exact opposite of the argument made for it. Matching means moving web to the phone: no native change, no TestFlight build.

**The ruling.** `#14C08C` is retired everywhere. The Z1–Z5 zone scale, the season/phase workout-type maps, the pace-quintile route palette and the race-effort ramps all take `#3EBD41` at the Z2 / easy rung, byte-for-byte with iPhone.

**The one-hex-per-meaning objection, answered.** The earlier entry argued that `#3EBD41` already carries two meanings (Easy effort, Good state) and a five-rung ladder makes the collision visible. It reads the other way round: **Zone 2 IS easy.** The zone-ladder green and the easy-effort green being one color is the doctrine working, not a loss of resolution. Status-vs-effort is separated by treatment and context — a chip is not a rung — which is how the palette already handles `#F3AD38` (Long / Watch attention / Eyebrow) and `#FC4D64` (Intervals / Off-warn).

**Migrated to `#3EBD41` on 2026-08-17** (the sites the withdrawn entry had exempted): `constants.ts` `ZC`; `session-shape.ts` `ZONE_COLOR`; `components/runs/RunDetailModal.tsx` `ZONE_COLOR` and the zone-trace gradient; `TodayView.tsx` `zoneColors`; `globals.css` `.etrack` · `.hero-v2 .effort-band .etrack` · `.gate-tempbar` · `.rp-ftrack`; `constants.ts` `SEASON_TYPE_COLOR`; `TrainView.tsx` `PHASE_TYPE_COLOR`; `RouteMap.tsx` `BUCKET_COLORS`; `race-detail-pacing.ts` opening span. Plus the route-map dev mockups and the telemetry report's `--good`.

**One collision the merge created, and how it was resolved.** `SEASON_TYPE_COLOR` had `sharp: '#3EBD41'` already, so moving `easy` onto the locked green made the two identical — and a taper week renders `sharp` on Saturday next to `easy` on Sunday. `sharp` (Sharpener, 6:20, between intervals 6:05 and tempo 6:38) moved to the intervals rung `#FC4D64`, from the locked ten. That matches the grouping the map already uses (`mp` shares `long`'s amber, `vo2` shares `intervals`' red) and keeps it distinct from tempo, the other quality type in a taper week. No other ladder collides: every zone rail, the route quintiles and both race ramps stay five distinct hues.

**Brandmark exemption unchanged.** The `#14C08C` stop at 55% of the brandmark sweep (`globals.css .brandmark` / `.gate-mark`, `Theme.swift Brand.sweepStops`) is logo identity, exempt under the header rules, and is byte-identical across web and iPhone. It is the only place the hex may appear.

**Enforcement.** `#14C08C` is now on the `scripts/check-palette-sync.sh` RETIRED-HEX tripwire — the list it was missing from, which is exactly why ~36 call sites survived the original AFC cutover unguarded. The tripwire also scans the `rgba(20,192,140,…)` decimal form: the audit found retired hexes surviving in decimal notation precisely because the guard only ever looked for hex literals.
