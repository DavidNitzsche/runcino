# Post-run hero · right panel by workout type · brief for design

**Date:** 2026-06-02
**Context:** The post-run hero on TodayView (`/today` when day is DONE) has a 3-column body. The right column ("HOW IT WENT") was a generic mile-splits list. We just shipped **THE REPS** for intervals (handoff at `designs/from Design agent/design_handoff_run_detail_intervals`). This brief asks design to spec the equivalent for the other workout types · easy, long all-easy, long with MP finish, tempo.

**Same shell for every type:**
- Header: `HOW IT WENT` · status badge (`✓ ON PLAN` / `HOT DAY` / `OFF PLAN`)
- Verdict: short Oswald headline (one or two words)
- Recap: 1-2 sentence coach line
- Divider
- **Workout-shaped panel** · this is what changes by type
- Bottom summary line · one signature stat with a goal-relative delta

**What design needs to do:** mockup the workout-shaped panel + bottom summary for the four variants below. Type, color, glass treatment, and outer card already locked. The new shape is the inner content.

---

## Variant 1 · INTERVALS (already shipped, reference only)

Panel: THE REPS rail. See `designs/from Design agent/design_handoff_run_detail_intervals`.
Summary: `AVG WORK PACE 6:26/mi · -4 vs goal`.

---

## Variant 2 · EASY (short, mid-week)

The aerobic-stamp question: was it actually easy, or did you drift?

### What matters
- Time spent below Z3 (the "kept it easy" share)
- HR drift across the run (decoupling % · early-half avgHR vs late-half avgHR at similar pace)
- Pace consistency (standard deviation across miles, expressed loosely)
- Did the engine stay parked?

### Suggested panel · "AEROBIC STAMP"
A 3-row vertical stack inside the right column:

**Row 1 · The discipline gauge**
```
KEPT IT EASY               94%
[================ . . ]
Z1-Z2 share of moving time
```
- Single horizontal bar, full width.
- Green when ≥85%, amber when 70-85%, coral when <70%.
- Value to the right (Oswald 17px).

**Row 2 · The drift number**
```
ENGINE DRIFT               +2.4%
First half 142 bpm · Second half 145 bpm
```
- Big number Oswald 19px (signed, with color: green ≤3%, amber 3-5%, coral >5%).
- Two-line caption below in 10.5px.
- This is the "aerobic decoupling" signal · the long-run-specific tell. Easy runs should hold near-flat.

**Row 3 · The shape**
```
PACE FOOTPRINT
[mile1 mile2 mile3 ... mile7] sparkline
fastest 8:42 · slowest 9:18 · spread 36s
```
- Tiny sparkline of mile paces, slow on top vs fast on bottom.
- Spread number in the caption.

### Summary
`AVG HR 143 bpm · 12 bpm below threshold`

### Verdict copy library (coach picks one)
- ON PLAN · "Easy stayed easy."
- ON PLAN · "Engine parked."
- DRIFTED · "Started easy, got harder. Watch the back half."
- HOT DAY · "Heat pushed HR. Pace was right."

---

## Variant 3 · LONG (all-easy, no MP finish)

The endurance-and-stability question: did the engine hold for the whole distance?

### What matters
- Decoupling across thirds (not halves · long runs need finer resolution)
- Fueling adherence (gels logged vs the prescribed cadence)
- Pace stability across thirds
- Late-run survival vs cratering

### Suggested panel · "THE LONG"
A 3-segment block + a fueling tile:

**The arc · 3 thirds, side by side**
```
┌──────────┬──────────┬──────────┐
│ FIRST 3  │ MIDDLE 3 │ FINAL 3  │
│  8:54    │  8:58    │  9:12    │
│  142 ♥   │  148 ♥   │  154 ♥   │
└──────────┴──────────┴──────────┘
```
- 3 vertical cards inside the right column, each ~33% width.
- Top: third label (10px ls 1px).
- Middle: avg pace Oswald 19px.
- Bottom: avg HR with small heart glyph.
- Final third's pace/HR colored amber if drift > target (e.g. >8 bpm vs first third), green if held.

**Decoupling readout · below the 3 cards**
```
AEROBIC DECOUPLING         +5.8%
Pace held but HR rose. Late-run aerobic fade.
```
- Number colored by band: ≤3% green, 3-7% amber, >7% coral.

**Fueling tile (optional, when prescribed)**
```
FUELING       3 of 4 gels at planned miles
```
- Subtle row, no chart. Just adherence.

### Summary
`12.4 mi · 8:58 avg · engine held through mi 9, drifted last 3`

### Verdict copy library
- ON PLAN · "Distance covered. Engine held."
- ON PLAN · "Long miles banked."
- LATE FADE · "First two thirds clean. Survived the last."
- ON PLAN · "Steady all the way."

---

## Variant 4 · LONG with MP FINISH (e.g. 12mi total · 8 easy + 4 at MP)

The marathon-rehearsal question: did you nail the gear change?

This is the variant David called out · 8 mile easy + 4 mile MP. The panel needs to clearly separate the two blocks.

### What matters
- Did the easy block stay easy? (no front-loaded effort that tanks the MP block)
- Did the MP block hit goal? (avg pace vs target MP)
- Was the transition clean? (last easy mile pace vs first MP mile pace · big gap = sharp gear change)
- HR pattern · MP block should sit at marathon HR, not threshold HR

### Suggested panel · "THE BUILD"
Two stacked blocks inside the right column, with a transition arrow between them.

**Block 1 · AEROBIC BASE (the easy portion)**
```
AEROBIC BASE · 8 MI                          8:54/mi
[================================] 100%      142 bpm
Held easy through the build.
```
- Header: name · distance · right-aligned avg pace.
- Below: a thin pace ribbon (same shape as the existing zone bar but for pace), all in one easy color (mint/teal).
- One-line coach micro-recap.

**Transition row**
```
                  ↓ MP SHIFT
        Last easy 9:02 → first MP 7:48
                  −1:14 gear change
```
- Small, centered, between the two blocks.
- Pace delta colored: green if the shift was clean (≥45s drop), amber if sluggish (<30s drop).

**Block 2 · MARATHON SHIFT (the MP portion)**
```
MARATHON SHIFT · 4 MI                        7:42/mi
TARGET 7:50  [=========●=======]             161 bpm
                       ↑ goal
mi 9: 7:48  mi 10: 7:45  mi 11: 7:39  mi 12: 7:36
```
- Header: name · distance · right-aligned avg pace.
- A single comparison bar (same shape as the intervals THE REPS bar) showing actual avg vs goal MP, with the goal tick.
- Per-mile pace strip below in small text · shows whether you held or drifted within the MP block.
- HR right side: avg HR for the block.

### Summary
`MP BLOCK 7:42/mi · -8 vs goal · HR held marathon zone`

### Verdict copy library
- ON PLAN · "Banked the build. Hit the shift."
- ON PLAN · "Clean transition. MP miles locked."
- SOFT FINISH · "MP block under goal. Could have pushed."
- OFF PLAN · "Easy block too hot. MP block fell off."

---

## Variant 5 · TEMPO (sustained · e.g. 6mi total with 20-min @ tempo)

The threshold-control question: did you sit on the line without going over?

### What matters
- Avg tempo pace vs target
- HR drift across the tempo block (going over = drift up, staying flat = nailed it)
- Tempo block as a portion of the workout

### Suggested panel · "THE TEMPO"
Single-block layout, similar in shape to the MP block above but standalone:

**Header strip**
```
TEMPO BLOCK · 20 min                         7:08/mi
TARGET 7:12  [===========●====]              167 bpm
                         ↑ goal
```
- Same comparison bar as MP block.

**HR shape · 3-mini bars below the strip**
```
  EARLY    MIDDLE    LATE
  165 ♥    167 ♥     169 ♥
```
- Three thirds of the tempo block.
- Colored green if drift ≤4 bpm, amber if 4-8, coral if >8.

**Warmup + cooldown context · subtle row**
```
WARM-UP 1.0 mi · 9:24    COOL-DOWN 1.0 mi · 9:40
```
- Two columns, very small text, low contrast.
- Anchors the tempo block in the workout structure.

### Summary
`TEMPO 7:08/mi · -4 vs goal · drift +4 bpm`

### Verdict copy library
- ON PLAN · "Sat on the line."
- ON PLAN · "Tempo locked."
- DRIFTED · "Started right, climbed late. Watch the negative split next time."
- HOT DAY · "Held effort despite the heat."

---

## Open questions for design

1. **Per-mile pace strips in the LONG-with-MP variant** · should they be tappable to drill into a single mile, or just visual context? (My take: visual only · the drill-into is what RunDetailModal is for.)

2. **The transition arrow + delta in LONG-with-MP** · is the arrow + numeric delta enough, or do we want a small visual cue like a step graphic? (My take: numeric is clearer · graphic adds noise.)

3. **Fueling tile in LONG** · should it appear only when the runner actually logged gels, or always (so the absence reads as a gentle nudge)? (My take: only when prescribed AND logged · don't shame.)

4. **Color tokens** · all variants assume the same green/amber/coral verdict palette. Confirm this stays consistent across workout types, OR if each workout type should pull its own accent (intervals = coral, easy = teal, long = amber, tempo = orange).

## Implementation notes (so design knows what data is available)

All the data needed for these panels is already on `runData` returned by `/api/runs/[id]`:

- `phase_breakdown[]` · per-phase rows with target_pace, actual_pace, status. Used by intervals, MP block, tempo block.
- `splits[]` · per-mile rows with pace, hr, cadence, elev_change_ft. Used for the per-mile pace strips and sparklines.
- `hrZonePcts` · for the easy-share gauge.
- `weather_context` · for HOT DAY badge.
- `hr_avg`, `hr_max`, `pace`, `time_moving`, `distance_mi` · headline stats.

The aerobic decoupling % isn't directly exposed yet · `computeAerobicDecoupling` exists in `lib/training/aerobic-decoupling.ts` and ships under `runData.aerobic_decoupling_pct` (need to verify · or wire it through if it's not yet on the API response). If absent, design can mockup with a placeholder and we'll add the backend field.

---

## What to ship back

Per design's usual handoff format · self-contained HTML at hero scale with real brand fonts (Oswald, Inter), real palette, real data. One file per variant. Drop them under `designs/from Design agent/post_run_hero_<variant>` and I'll wire each one.
