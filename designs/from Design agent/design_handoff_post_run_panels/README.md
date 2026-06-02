# Handoff: Post-Run Hero · right-card panels by workout type

## Overview
Four workout-type variants of the post-run hero's **right column** ("HOW IT WENT" card), for TodayView (`/today` when the day is DONE). The 3-column hero **shell is already locked and shipped** — this handoff is **only the right card's inner content** (verdict, status badge, recap, the workout-shaped panel, and the bottom summary). Variants: **Easy, Long (all-easy), Long + MP finish, Tempo.** The Intervals variant ("THE REPS") already shipped separately and is the reference for the pattern.

> **Scope note from the requester:** "It's all about the right card / column." The left column (title, stats, time-in-zones, running form, conditions), the route map, and the week strip are the **locked shell** — do not rebuild them from this bundle. They already exist in the app. The week strip in the reference file is context only; ignore it for implementation.

## About the design files
`Faff Post-Run Hero (by type).html` + `faff-hero.css` + `faff-hero.js` are a **design reference**, not production code. The file includes a **RUN TYPE switcher** (Easy / Long / Long·MP / Tempo) — that switcher is a **review affordance only**, not part of the product. In the app, the run's type selects which panel renders.

Recreate the panels in the existing codebase (Faff web is React/TSX — see `WorkoutDetail`/`CompletedHeroV2`) using its components and tokens. Treat the HTML/CSS as the exact spec for layout, type, color, and copy.

`image-slot.js` is a prototype-only map placeholder — not for production.

## Fidelity
**High-fidelity.** Final colors, type, spacing, and the data visualizations are all specified. The only stub is the center map (already a real route component in the shell).

---

## Right card · shared anatomy (all types)
The card (`.wcard`, locked) is a vertical flex column. Top to bottom:

1. **`.vhead`** — a flex row: **verdict** (left) + **status badge** (right).
   - **Verdict**: Oswald `27px / 600`, **one line** (`white-space:nowrap`). Short headline, 2–4 words.
   - **Badge** (`.ok`): `11px / 700 / ls 2px`, check icon + label. Tone classes: `ok` = green `#8af0a6` (ON PLAN), `.warn` amber (DRIFTED / LATE FADE / SOFT FINISH), `.hot` `#ff8a5c` (HOT DAY), `.off` `#ff6a6a` (OFF PLAN).
2. **`.recap`** — coach line, `13.5px / 500 / lh 1.55`, `rgba(255,255,255,.88)`.
3. **`.divider`** — 1px hairline.
4. **`.panelbody`** — the **type-specific panel** (this is the new work). It is the scroll region: `flex:1; min-height:0; overflow-y:auto`, with a bottom fade mask when scrollable (`.scrollable`). The summary below stays pinned, so the card never grows the page.
5. **`.repsum`** — pinned bottom summary: signature stat label (left) + value with a goal-relative delta (right). Delta tone: `.delta.good` green, `.warn` amber, `.bad` coral.

Each panel opens with a **`.phead`** section title (Oswald `15px`, e.g. "AEROBIC STAMP", "THE LONG", "THE BUILD", "THE TEMPO") with an optional right sublabel.

---

## Shared panel kit (reuse across types)
These are the building blocks the panels compose. All defined in `faff-hero.css`; JS builders in `faff-hero.js`.

- **`cmpBar(actualSec, goalSec, maxdev)`** — the **center-anchored comparison bar**. Target = white center tick; **faster extends right (green `--good`), slower extends left (amber `--warn`)**, magnitude `= clamp(|Δ|/maxdev,0,1)·50%`, min 5% so it's never invisible. Includes a `◂ SLOWER · TARGET · FASTER ▸` legend. Used by MP block and Tempo block. (Same logic as the shipped Intervals rep bar.)
- **`driftBar(label, bpm, hi)`** — one row of the **heart-rate drift** comparison: label + a bpm bar (HR window 120–170 → width) + the bpm value. Two stacked rows (first vs second half / first vs final third) make the drift legible in plain bpm. Used by Easy + Long.
- **`.thirds` / `third(label, big, sub, warn)`** — three mini cards (33% each). Used for Long's pace/HR thirds and Tempo's HR-across-the-block. `warn` variant tints the card amber.
- **`.gauge`** — labeled full-width bar (label + value + track + caption). Used by Easy's "kept it easy" share.
- **`footprint(secs[], avgSec, avgLabel)`** — **mile-pace bars**, taller = faster, with a dashed **avg reference line** (label parked in a right gutter) and **mile-number ticks** beneath. Used by Easy.
- **`.blockhd` + `.blockmeta`** — a workout block header (NAME · DIST left, pace right) + a meta row (target / HR). Used by MP + Tempo. Names are `white-space:nowrap`.
- **`.ribbon`** — a thin one-tone accent bar for an all-easy block. Used by MP base block.
- **`.shift`** — the MP transition row (↓ MP SHIFT · last-easy→first-MP · signed gear-change delta).
- **`.permile`** — small per-mile pace chips (`mi 9 · 7:48`). Visual context only (not tappable — drill-in lives in RunDetailModal).

---

## Variant 1 · EASY — panel "AEROBIC STAMP"
*The question: was it actually easy, or did you drift?*

- **Verdict** "Engine parked." · badge **ON PLAN**.
- **Recap**: "Held Zone 2 the whole way and never let the pace creep, even late. The quiet aerobic work that builds the engine."
- **Panel:**
  1. **KEPT IT EASY** gauge — `94%`, green fill, caption "Z1–Z2 share of moving time". (Green ≥85%, amber 70–85%, coral <70%.)
  2. **HEART RATE DRIFT** — header + tag `STAYED FLAT` (green); two `driftBar` rows: FIRST HALF `142 bpm`, SECOND HALF `145 bpm`; caption "Same pace throughout, but your heart only beat **+3 bpm** faster in the back half. The engine stayed flat · a genuinely easy run." (Tag bands by bpm rise: ≤4 flat/green, 5–8 amber, >8 coral.)
  3. **MILE PACE** — `footprint` of 8 mile paces with dashed `8:31 avg` line + mile ticks; caption "8 miles · fastest 8:22 · slowest 8:52 · only 30s spread".
- **Summary**: `AVG HR  143 bpm · −12 vs threshold` (good).

> Note: we removed the original "+2.4% decoupling" hero number — runners couldn't parse it. Drift is now shown as a plain first-vs-second-half **bpm** comparison.

## Variant 2 · LONG (all easy) — panel "THE LONG"
*The question: did the engine hold for the whole distance?*

- **Verdict** "Engine held." · badge **ON PLAN**.
- **Recap**: "Two thirds clean, then HR drifted up over the final 5K while pace stayed put. Normal long-run fade · fuel a touch earlier next time."
- **Panel:**
  1. **Thirds** cards — FIRST 3 `8:54 / 142♥`, MIDDLE 3 `8:58 / 148♥`, FINAL 3 `9:12 / 154♥` (final card amber when HR drift vs first third exceeds target, e.g. >8 bpm).
  2. **HEART RATE DRIFT** — tag `LATE FADE` (amber); two `driftBar` rows: FIRST THIRD `142`, FINAL THIRD `154`; caption "Pace held, but your heart climbed **+12 bpm** from the first third to the last. Normal late-run fade · the engine worked harder to hold the same speed."
- **Summary**: `AVG PACE  8:58/mi · held to mi 9` (good).

> The **fueling tile from the brief was cut** — the app has no way to track gels logged-vs-prescribed. Re-add only if/when that data exists.

## Variant 3 · LONG + MP FINISH — panel "THE BUILD"
*The marathon-rehearsal question: did you nail the gear change?* (8 easy + 4 at MP.)

- **Verdict** "Hit the shift." · badge **ON PLAN**.
- **Recap**: "Banked eight honest easy miles, then dropped 1:14 into marathon pace and held it for four. The gear change the plan wanted."
- **Panel:**
  1. **AEROBIC BASE · 8 MI** block — `.blockhd` (right pace `8:54/mi`), `.ribbon` (one-tone easy), `.blockmeta` ("Held easy through the build." · `142 bpm`).
  2. **`.shift`** transition — `↓ MP SHIFT` · "Last easy **9:02** → first MP **7:48**" · **−1:14 gear change** (green if drop ≥45s, amber if <30s).
  3. **MARATHON SHIFT · 4 MI** block — `.blockhd` (`7:42/mi`), `.blockmeta` (`TARGET 7:50/mi` · `161 bpm`), `cmpBar(462, 470, 18)` (beat goal → green right), `.permile` chips mi 9–12.
- **Summary**: `MP BLOCK  7:42/mi · −8 vs goal` (good).

## Variant 4 · TEMPO — panel "THE TEMPO"
*The threshold-control question: did you sit on the line without going over?*

- **Verdict** "Sat on the line." · badge **ON PLAN**.
- **Recap**: "Locked onto threshold and parked there. HR crept just four beats across the block. Controlled, never reckless."
- **Panel:**
  1. **TEMPO BLOCK · 20 MIN** block — `.blockhd` (`7:08/mi`), `.blockmeta` (`TARGET 7:12/mi` · `167 bpm`), `cmpBar(428, 432, 14)`.
  2. **HR ACROSS THE BLOCK** — three `third` cards: EARLY `165`, MIDDLE `167`, LATE `169` bpm (tint amber if drift >8 bpm across thirds).
  3. **`.wucd`** — subtle warm-up / cool-down row (`1.0 mi · 9:24` / `1.0 mi · 9:40`).
- **Summary**: `TEMPO  7:08/mi · −4 vs goal` (good).

---

## Color decision (brief Q4)
- **Status palette is consistent across all types**: green `#3ED06a` (on/good), amber `#ffb24d` (watch/fade), coral `#ff6a6a` (off). Use this for bars, deltas, tags, and the comparison fills regardless of run type.
- **Each run type carries its own mesh/identity accent** (`--accent`, set by a theme class on `.pr`): Easy teal `#37c98f` · Long amber `#F3AD38` · MP `#ff9f5a` · Tempo `#ff8a47` · Intervals coral `#ec3a54`. Accent drives the mesh, the week dot, and one-tone elements (ribbon, sparkline/footprint bars). It does **not** override status colors.

## Other brief decisions adopted
- **Per-mile strips**: visual context only, not tappable (drill-in = RunDetailModal).
- **MP transition**: numeric delta only, no step graphic.
- **Fueling tile**: cut (no tracking data).

## Data model (already on `runData` from `/api/runs/[id]`)
- `phase_breakdown[]` (target/actual/status per phase) → MP block, tempo block, intervals.
- `splits[]` (per-mile pace/hr) → mile-pace footprint, per-mile chips, thirds aggregation.
- `hrZonePcts` → time-in-zones (shell) + the "kept it easy" gauge.
- HR halves/thirds → the drift bars. (Aerobic-decoupling helper exists at `lib/training/aerobic-decoupling.ts`; we now surface it as a **bpm delta**, not a %.)
- `weather_context` → HOT DAY badge variant.

## Files
- `Faff Post-Run Hero (by type).html` — reference shell + RUN TYPE switcher (switcher is review-only).
- `faff-hero.css` — shell + the shared panel kit (themes, comparison bar, drift bars, thirds, gauge, footprint, blocks).
- `faff-hero.js` — `TYPES` data per variant, `PANELS[type]()` builders, and the kit builders (`cmpBar`, `driftBar`, `footprint`, `third`, `permile`). Read these for exact data + copy.
- `image-slot.js` — prototype-only map placeholder (not for production).
