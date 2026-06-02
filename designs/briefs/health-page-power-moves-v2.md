# Brief · Health page · power moves v2 · ALL 15 features + post-session recovery

**For:** design agent
**From:** backend
**Date:** 2026-06-01
**Status:** David approved ALL 15 power moves · backend is executing
in waves · this brief is the contract for what's on the seed when
each wave lands. Use to design once across the full feature set.

---

## What changed from v1

David said "I want all of them." Added a 15th feature based on his
follow-up: **post-session recovery tracking** — show how the body is
recovering after races, long runs, and intervals, including
muscle-specific signals.

Backend is shipping these in waves. Each wave commit will note which
seed fields became populated. This brief is the master spec.

---

## The 15 moves · prioritized build order

### WAVE 1 · Foundation (existing data, surface only · ~2 hrs)

These add zero new computation · they just surface fields that
already flow on the seed and have for weeks. Wave 1 is mostly a
render task on your side, plus minor wiring on mine to ensure clean
shapes.

#### #1 · Synthesis card (NEW) · 2-3 sentence story
- **Where:** Top of the page, between the 42 gauge and the BODY grid
- **Seed field:** `seed.readinessBrief.synthesis: string | null`
- **Content:** Engine-authored coach-voice paragraph each morning.
  Pulls the dominant pillar movement + confounder hints + illness
  watch + recovery debt into 2-3 sentences.
- **Example:**
  > Sleep is the story. 5.9h with HRV down 10 and RHR up 3 · these
  > three move together when undersleep-stressed. Wrist temp is
  > normal so this isn't illness · it's a deficit you can close
  > tonight.
- **Why it matters:** This is the page's intelligence layer. Right
  now the runner sees five red bars and has to do the synthesis
  themselves.

#### #2 · Streaks banner (already built, render only)
- **Where:** Below synthesis card, dismissible chip strip
- **Seed field:** `seed.readinessBrief.streaks[]` (live since
  2026-05-31 · I built this weeks ago)
- **Content:** Persistent multi-day patterns per pillar. 3-day
  threshold (Plews doctrine).
- **Example:**
  > HRV BELOW BASELINE 3 DAYS · early functional overreach signal.
  > Pull back today regardless of how the run feels.

#### #3 · Watching tomorrow (already built, render only)
- **Where:** Below BODY grid, small section
- **Seed field:** `seed.readinessBrief.watchTomorrow[]` (live)
- **Content:** Forward-looking "what to verify if it persists"
  callouts.

#### #4 · Confounder list per pillar (already built, render only)
- **Where:** Expandable under each pillar in "WHAT IS DRIVING IT"
- **Seed field:** `seed.readinessBrief.pillars[].confounders[]`
  (live)
- **Content:** Plausible explanations per pillar drop.

#### #5 · Subjective check-in surface (already built, render only)
- **Where:** Either prompt top of page (when unanswered) OR display
  the answer near the readiness gauge (when answered)
- **Seed fields:**
  - `seed.readinessBrief.subjectiveCheckin` (state)
  - `seed.readinessBrief.subjectiveOverride` (if disagrees ≥15pts)
- **Content:** "How do you feel today?" 1-10 slider. When subjective
  disagrees with objective per Saw et al. doctrine, surface the
  override message.

---

### WAVE 2 · New computations using existing data (~5 hrs)

#### #6 · Sleep architecture vs quantity framing
- **Where:** Sleep stages section header or sleep tile
- **Seed field:** `seed.health.sleepStages.architectureFraming: {
    deepPct: number;
    remPct: number;
    verdict: 'healthy_architecture' | 'architecture_off';
    hours_total: number;
    framing: string;
  } | null`
- **Content:** Distinguishes "architecture is fine but you slept too
  short" from "architecture is also off."
- **Example:**
  > Architecture is healthy (19% deep, 24% REM). The issue is hours.
  > Push bedtime 30 min tonight.

#### #7 · Training Form tile on Health
- **Where:** New tile in BODY section OR paired card with readiness
- **Seed field:** `seed.readinessBrief.trainingForm: {
    tsb: number;
    ctl: number;
    atl: number;
    band: 'detraining' | 'race-ready' | 'productive' | 'loaded' | 'overreach';
    label: string;
  } | null`
- **Content:** Banister TSB · already computed in
  `lib/coach/training-form.ts` for Train page. Lift onto Health.
- **Example:** "Training Form: −8 · LOADED but productive."

#### #8 · Aerobic decoupling trend across the block
- **Where:** New section "AEROBIC FITNESS" below FORM
- **Seed field:** `seed.health.aerobicFitness: {
    currentDriftPct: number;
    blockStartDriftPct: number;
    weeksTracked: number;
    direction: 'improving' | 'flat' | 'declining';
    summary: string;
  } | null`
- **Content:** Aggregate per-run decoupling across the last 8 long
  runs. SINGLE best aerobic-base trajectory marker available from
  per-mile splits.
- **Example:** "Aerobic decoupling 9.2% → 6.1% this block · the
  engine is getting more efficient. On pace for race-ready by
  week 8."

#### #9 · Forecasts · slope detection + band crossing (KILLER)
- **Where:** Per-pillar chip OR a forecast section
- **Seed field:** `seed.readinessBrief.forecasts[]: {
    pillar: 'sleep' | 'hrv' | 'rhr' | 'load' | 'hrv_cv' | 'wrist_temp';
    days_until_band_change: number | null;
    projected_band: string;
    message: string;
    confidence: 'high' | 'medium' | 'low';
  }`
- **Content:** Slope detection on the time-series, projects when each
  metric crosses into a new band.
- **Example:**
  > "HRV CV rising at +0.4%/day · projected to cross 7% destabilizing
  > band by Thursday if trajectory continues."
- **Why this is the killer:** Whoop/HRV4T/Garmin all say "this is
  bad." None of them say "AND here's what will happen if it
  persists." That's descriptive → predictive.

---

### WAVE 3 · Post-session recovery tracking (NEW · #15 · ~6 hrs)

This is the biggest feature in the v2 plan. David asked specifically
for: "how the body is recovering after races, long runs, intervals,
muscles, etc."

#### #15 · Recovery Phase Tracker
- **Where:** New dedicated section above BODY · "RECOVERY FROM
  [LAST HARD SESSION]"
- **Seed field:** `seed.health.recoveryPhase: {
    anchor: {
      run_id: string;
      date: string;
      type: 'race' | 'long' | 'intervals' | 'tempo' | 'threshold';
      label: string;          // "Sunday's 14mi long run"
      distance_mi: number;
      moving_time_s: number;
    };
    daysSince: number;
    expectedDaysToRecover: number;
    percentRecovered: number;            // 0-100
    pillars: Array<{
      key: 'hrv' | 'rhr' | 'sleep' | 'hr_recovery' | 'wrist_temp' | 'resp_rate';
      label: string;
      day0Value: number | null;          // value the day of the session
      currentValue: number | null;
      baselineValue: number;
      pct_recovered: number;             // 0-100 per pillar
    }>;
    muscleSignals: {
      cadenceSpm: number | null;        // most recent easy-run cadence
      cadenceDelta: number | null;       // vs typical easy
      gctMs: number | null;
      gctDelta: number | null;
      strideM: number | null;
      strideDelta: number | null;
      runPowerW: number | null;
      runPowerDelta: number | null;
      summary: string;                   // "Stride 4% shorter than typical · classic eccentric load signal"
    } | null;
    nextQualityGreenLight: {
      date: string;                      // best-guess earliest date
      reason: string;
    };
    message: string;                     // coach-voice 1-line summary
  } | null`
- **Content sections to design:**
  1. **Anchor session** · "Sunday · 14.0 mi long run · 1h 56m"
  2. **Recovery timeline** · "Day 2 of 4 expected · 60% recovered"
  3. **Per-pillar bounce-back** · small grid showing HRV trajectory
     day-0 → today, same for RHR, sleep, HR Recovery, wrist temp, RR
  4. **Muscle signals** · derived from form metrics on easy runs in
     the recovery window
     - "Cadence on Monday's easy was 168 spm vs your typical 172 ·
       legs still neuromuscular-fatigued"
     - "Stride length 1.14m vs typical 1.18m · −3% · eccentric muscle
       damage signal"
     - "Run power 245W vs typical 268W · muscle output degraded"
  5. **Next quality green-light** · "Earliest hard session: Thursday"
- **Doctrine timeline:**
  - Marathon: 1 day per mile (Friel)
  - Half: 5-7 days
  - Long run 15+ mi: 36-48h glycogen · 3-5 days muscles
  - Intervals/threshold: 24-72h
  - DOMS peaks 24-48h post-eccentric
- **Anchor detection:** backend picks the most recent run that's
  EITHER race/race-priority OR distanceMi ≥ 12 OR has structured
  intervals/tempo within the last 7 days.
- **Recovery % math:** weighted avg of per-pillar recovery percent,
  weighted by Plews-style importance (HRV 30%, sleep 28%, RHR 24%,
  HR Recovery 10%, wrist temp 5%, RR 3%).

---

### WAVE 4 · Cross-domain pattern detection (~10 hrs)

#### #10 · Heat acclimatization tracker
- **Where:** New "ENVIRONMENT" section
- **Seed field:** `seed.health.heatAcclim: {
    daysInWindow: number;
    avgTempF: number;
    rhrTrend: 'rising' | 'plateauing' | 'falling';
    expectedHRPenaltyBpm: number;
    daysToFullAcclim: number;
    message: string;
  } | null`
- **Content:** Detect a heat exposure window (≥ 7 day rolling avg
  high temp > 75°F). Track RHR climb pattern + drop pattern as the
  body adapts. Surface expected HR penalty trajectory.

#### #11 · Block-over-block comparison
- **Where:** Bottom of page, "VS LAST BUILD"
- **Seed field:** `seed.health.blockComparison: {
    currentBlock: { weeks: number; avgSleep: number; avgHrv: number; avgRhr: number; };
    referenceBlock: { label: string; avgSleep: number; avgHrv: number; avgRhr: number; };
    deltas: { sleep_h: number; hrv_ms: number; rhr_bpm: number; };
    message: string;
  } | null`
- **Content:** Compare current block (last 4-8 wks) to a reference
  block (peak-fitness build or last race build).
- **Example:** "Sleep avg 7.4h this block vs 6.8h before Berlin ·
  recovering noticeably better."

#### #12 · Day-of-week patterns
- **Where:** Expandable strip under the 7-day readiness chart
- **Seed field:** `seed.health.dowPatterns: {
    sleep: Array<{ dow: 0-6; avg: number; }>;
    hrv: Array<{ dow: 0-6; avg: number; }>;
    rhr: Array<{ dow: 0-6; avg: number; }>;
    insights: string[];   // ["HRV consistently lowest Monday · Sunday recovery problem"]
  } | null`

#### #13 · Cycle-phase performance pattern (female users only)
- **Where:** Below cycle phase tile, when female
- **Seed field:** `seed.health.cyclePerformance: {
    follicular: { runCount: number; avgVdotEffort: number; topQuartileRate: number; };
    ovulatory: { ... };
    luteal: { ... };
    insights: string[];   // ["Peak power efforts land best ovulation week"]
  } | null`

#### #14 · Run-quality vs recovery correlation
- **Where:** Bottom of page, "WHAT PREDICTS YOUR BEST RUNS"
- **Seed field:** `seed.health.qualityPredictors: {
    topPredictor: {
      metric: string;        // "Deep sleep"
      threshold: number;     // 70
      unit: string;          // "min"
      correlation: number;   // 0-1 (lift in top-quartile rate)
      message: string;       // "Your top-quartile runs follow nights with deep sleep > 70min · 3× more likely"
    };
    allCorrelations: Array<{ metric: string; correlation: number; }>;
  } | null`
- **Content:** Pearson correlations between each recovery metric and
  next-day run quality (VDOT equivalent, perceived effort, splits
  consistency). Surface the top predictor.

---

## Visual hierarchy suggestion

```
┌─────────────────────────────────────────────────────┐
│ TOP                                                 │
│   42 gauge + WHAT'S DRIVING IT + 7-day chart       │
│                                                     │
│ SYNTHESIS CARD (#1)                                 │
│   "Sleep is the story…"                             │
│                                                     │
│ STREAKS (#2) · WATCHING TOMORROW (#3) · chips      │
│                                                     │
│ RECOVERY PHASE (#15) ← new prominent section       │
│   "Sunday's 14mi · day 2 of 4 · 60% recovered"     │
│   Per-pillar bounce-back grid                       │
│   Muscle signals                                    │
│   Next quality green-light                          │
│                                                     │
│ FORECASTS (#9) — chips OR section                  │
│                                                     │
│ BODY (existing 11 tiles + Training Form #7)        │
│                                                     │
│ SLEEP STAGES (existing) + Architecture (#6)        │
│                                                     │
│ FORM (existing 6 tiles)                             │
│                                                     │
│ AEROBIC FITNESS (#8)                                │
│   "Decoupling 9.2% → 6.1%"                          │
│                                                     │
│ ENVIRONMENT (#10 heat) — when relevant             │
│                                                     │
│ VS LAST BUILD (#11) — when reference block exists  │
│                                                     │
│ PATTERNS (#12 DOW · #14 quality predictors)        │
│                                                     │
│ CYCLE PERFORMANCE (#13) — female users only        │
│                                                     │
│ SUBJECTIVE CHECK-IN (#5) — floating or prompt      │
└─────────────────────────────────────────────────────┘
```

---

## Shipping cadence + commits

Backend will commit in WAVES and notify the brief which seed fields
landed:

- **Wave 1 commit:** synthesis + sleep-arch + training-form + streaks
  surface wiring · ~3 hrs
- **Wave 2 commit:** aerobic-decoupling-trend + forecasts · ~3 hrs
- **Wave 3 commit:** recovery-phase tracker (#15) · ~4 hrs
- **Wave 4 commit:** heat-acclim + block-comparison + DOW +
  cycle-performance + quality-predictors · ~6 hrs

Total: ~16 hrs of backend work. Will commit at each wave boundary so
you can start designing Wave 1 while I'm building Wave 2.

---

## What stays NOT shipping today

- Manual mood/soreness log surface (would need a settings UI)
- Cardiac decoupling for non-long runs (we filter to >= 6mi)
- Per-leg / per-muscle group signals (no L/R asymmetry data source)
- Time-zone change detection (waiting on iPhone tz ingest brief)

---

## How to respond

1. If the visual hierarchy doesn't make sense, propose a different
   layout · backend will adapt the field shapes.
2. If any tile shape needs different data (e.g. you want trend
   sparklines instead of single-value tiles), say so · backend can
   compute series for any of these.
3. Backend will note in each wave commit which seed fields landed so
   you can iterate alongside the build.

---

## Files referenced

- `lib/coach/readiness-brief.ts` · composer
- `lib/coach/training-form.ts` · TSB
- `lib/training/aerobic-decoupling.ts` · per-run helper
- `lib/coach/health-state.ts` · loaders
- `components/faff-app/seed.ts` · the seed composer

---

## The promise

When all 15 ship, Faff has no peer in the running app market. The
doctrine layer (Plews + Friel + Banister + Saw + cycle phase) plus
this synthesis layer means the runner gets a system that THINKS,
not a dashboard that DISPLAYS.

Going.
