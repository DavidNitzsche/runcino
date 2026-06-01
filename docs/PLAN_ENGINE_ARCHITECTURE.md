# Plan Engine Architecture

**Status:** active build · phase 1 in progress
**Owner:** backend / coach-engine
**Last updated:** 2026-06-01

---

## What this doc is

The single source of truth for how the Faff/Runcino plan engine is
supposed to work. Every plan-engine commit cites back to this doc.
Every architectural change updates this doc first, then ships code.

If something in the codebase contradicts this doc, the doc is right
and the code is wrong.

---

## The problem we're solving

A running plan engine must do three things together:

1. **Get the runner to a specific outcome** — not just author workouts,
   but project whether the plan actually serves the goal.
2. **Reflect reality** — runner's actual training, fatigue, recovery,
   and life — not template prose.
3. **Be honest** — when the goal is closing, say so. When it's
   slipping, say so. When it's unreachable, surface the alternative
   without burying it.

Today we have pieces (generator, adapter, drift monitor, readiness
brief, projection snapshots) but **no closed loop**. The planner
doesn't know what the projection says. The projection doesn't know
what the planner did yesterday. The adapter doesn't know whether
its downgrade puts the goal at risk.

That's the architectural debt this rebuild closes.

---

## The closed loop (the keystone)

```
                  ┌──────────────────────────┐
                  │   RUNNER CALIBRATION     │ ← weekly update from
                  │  (per-user state vector) │   completed workouts
                  └──────┬───────────────────┘
                         │
                         ▼
   ┌─────────────────────────────────────────────────┐
   │              PLAN GENERATOR                      │
   │  reads: calibration, race, goal, history         │
   │  writes: 26-week plan (template + reality-       │
   │           anchored per-day-type baselines)       │
   └──────┬──────────────────────────────────────────┘
          │
          ▼
   ┌──────────────────────┐         ┌────────────────────┐
   │   PLAN SIMULATOR     │ ──────▶│  GAP REPORT        │
   │  (plan → trajectory) │         │  (trajectory vs    │
   │                       │         │   goal, what       │
   │                       │         │   closes it)       │
   └──────┬───────────────┘         └────────┬───────────┘
          │                                   │
          │                                   ▼
          │                          ┌────────────────────┐
          │                          │  MORNING BRIEF     │
          │                          │  (renders gap +    │
          │                          │   what to do)      │
          │                          └────────────────────┘
          ▼
   ┌──────────────────────┐
   │  PROJECTION SNAPSHOT │ ← daily cron, also runner-state input
   │  (today's trajectory) │
   └──────┬───────────────┘
          │
          ▼
   ┌──────────────────────┐
   │   GOAL-GAP ENGINE    │ ← continuous (not just drift)
   │   (closing/static/   │
   │    widening/         │
   │    unclosable)       │
   └──────┬───────────────┘
          │
          ▼
   ┌──────────────────────┐
   │   BLOCK ADAPTER      │ ← 3-day forward reasoning
   │   (downgrade Tue?    │
   │    shift Thu?        │
   │    cutback now?)     │
   └──────┬───────────────┘
          │
          ▼
   ┌──────────────────────┐
   │   PLAN MUTATION      │ ← every change cites Research/
   │   (with citation)    │
   └──────────────────────┘
                │
                └──── loops back to RUNNER CALIBRATION
                       on next weekly update
```

Every box reads from and writes to the same shared state. No silent
divergence between projection and planner.

---

## Doctrine — the non-negotiables

Five rules every plan-engine surface must follow. These are locked.

### 1. Honest projection over heroic prescription

The plan never pretends the runner is on track when they're not.
Daniels VDOT says your realistic outcome is your current VDOT — we
make that continuous and visible, not a one-time pre-race ego check.

When the gap is closing: encouragement + "here's what we need to see."
When the gap is widening: shift training emphasis + tell the runner.
When the gap is unclosable: surface goal renegotiation. The runner
picks, never the engine alone.

### 2. Reality-anchored, not template-derived

Every parameter that's hardcoded — volume floor, easy-day distance,
long-run share, taper depth — must have a per-runner reality anchor
that overrides the template when the runner has ≥14 days of history.

Hardcoded defaults are for cold start only.

### 3. Every decision cites doctrine

Every plan mutation (downgrade, shave, rebuild, taper adjustment)
carries a `citation` field pointing to `Research/XX-foo.md §Section`.
If no citation exists, the mutation is rejected at the composer
layer. No silent prescriptions.

### 4. Closed-loop validation before ship

No plan ships without passing the simulator. Initial generation,
drift rebuild, goal renegotiation — all run through the simulator
first. The output is not a binary ship/reject; it's a gap report
that tells the runner what to expect.

### 5. Cross-runner tested

Every plan-engine commit runs through 6 synthetic runner personas
spanning beginner→advanced+, 5K→marathon, including 2 edge cases
(returning-from-injury, sleep-debt-prone). If any persona's plan
breaks integrity, the commit fails CI.

---

## Phase 1 · close the loop

Goal: the generator, adapter, and projection start talking to each
other. Continuous goal-gap detection replaces discrete drift checks.
Block-level reasoning replaces day-by-day reactivity.

### 1.1 · `lib/plan/goal-gap.ts`

Continuous projection-vs-goal computation. Reads:
- Latest `projection_snapshots` row (today's trajectory)
- Active plan's `goal_time_sec` (the target)
- Weeks remaining until race date

Returns:
```ts
type GoalGap = {
  trajectorySec: number;       // current projected finish time
  goalSec: number;             // target
  gapSec: number;              // signed · negative = ahead
  confidence: number;          // 0..1 based on data density
  status: 'closing' | 'static' | 'widening' | 'unclosable';
  weeksRemaining: number;
  whatClosesIt: string[];      // 1-3 specific actions
  citation: string;            // Research/22-plan-templates.md §projection
};
```

Wired into:
- `app/api/cron/plan-drift/route.ts` — fires rebuild when status =
  'widening' for 3+ consecutive days
- `lib/coach/readiness-brief.ts` — populates the new `goalGap` field
- `lib/plan/simulator.ts` — sanity-checks simulator output against
  real projection trajectory

### 1.2 · per-day-type drift detection

The current 40% volume_drift threshold is too coarse. Replace with
three independent checks:

```ts
type DriftKind = 'easy_drift' | 'long_drift' | 'quality_drift';
// each fires at 20% deviation (not 40%)
// each triggers a TARGETED rebuild, not a full plan refresh
```

`easy_drift` = `easyDayMedianMi(userId)` deviates >20% from authored
easy-day distance. Triggers easy-day-only rebuild (keeps quality
+ long structure, refloors easy).

`long_drift` = recent long-run median deviates >20% from authored
long-run distances. Triggers long-run progression rebuild.

`quality_drift` = recent quality-workout median pace deviates >5%
from prescribed pace targets. Triggers VDOT recalibration + quality
prescription rebuild.

Citation: `Research/15-plan-adaptation.md §per-axis-drift`

### 1.3 · `lib/plan/adapt-block.ts`

Wraps day-of adapter with 3-day forward reasoning. Before any
downgrade:

1. Read the next 3 days of planned workouts
2. Simulate: "if I downgrade today, does the next quality day land
   on a recovery deficit?"
3. If yes → either (a) propose a multi-day shift instead, or (b)
   downgrade today AND auto-shift the next quality day, audited.
4. If goal-gap status is 'widening' or 'unclosable', surface the
   adapter decision in the brief: "Downgraded Tue because sleep
   debt + goal slipping — we'll need to make this up Thu."

Returns either a `DayAdaptation` (today only) or a `BlockAdaptation`
(today + N days). All carry citations.

### 1.4 · doctrine citation enforcement

Composer pattern. Every adapter/generator call site uses a typed
wrapper:

```ts
type PlanMutation<K extends MutationKind> = {
  kind: K;
  field: string;                    // plan_workouts.id
  changes: Partial<PlanWorkoutRow>;
  citation: ResearchCitation;       // REQUIRED, typed enum
  reason: string;                   // plain English
};

function applyMutation<K>(m: PlanMutation<K>): Promise<void>;
// throws at the type layer if citation is missing
```

Backfill citations across existing adapter call sites. Build a
codified `ResearchCitation` enum from `system_doctrine` rows so the
type system enforces "real citation, not freeform string."

---

## Phase 2 · simulator + calibration + honest goal handling

Goal: the engine validates plans before they ship, learns each
runner's actual training response, and tells the runner the truth
about their trajectory continuously.

### 2.1 · `lib/plan/simulator.ts`

Takes a `TrainingPlan` + `RunnerCalibration` and returns:

```ts
type SimulationResult = {
  weeklyTrajectory: Array<{
    weekIdx: number;
    projectedVdot: number;
    projectedRaceTime: number;
    confidence: number;
  }>;
  finalProjection: {
    medianSec: number;
    p25Sec: number;        // 25th percentile (faster)
    p75Sec: number;        // 75th percentile (slower)
  };
  riskFlags: string[];     // 'volume_ramp_too_steep' etc.
  citation: string;
};
```

Models:
- **VDOT progression** from threshold/interval volume (Daniels
  Running Formula §VDOT response curves)
- **Endurance** from long-run progression (Pfitzinger ADM)
- **Recovery cost** from quality density per week
- **Plateau detection** when calibrated response curve flattens

Validated against published Daniels/Pfitzinger plan progressions
for canonical 5K/10K/HM/marathon goal times. Sim should match within
±10% on these known plans.

### 2.2 · `lib/coach/runner-calibration.ts`

Per-runner state vector, updates weekly from completed workouts:

```ts
type RunnerCalibration = {
  userUuid: string;
  asOf: string;                    // ISO

  volumeCeiling: number;            // weekly mi at which load fails
  recoveryRate: number;             // hours to baseline after quality
  thresholdResponse: number;        // VDOT pts per 4-week threshold block
  easyTolerance: number;            // per-day-type baselines
  longTolerance: number;
  qualityTolerance: number;

  acwrSlope: number;                // weekly ACWR change tolerated
  rhrSensitivity: number;           // RHR delta per overreach unit

  dataQuality: 'cold-start' | 'building' | 'calibrated';
  citation: string;
};
```

Schema: `runner_calibration` table, one row per user per week.
Composer reads latest row, falls back to experience_level bucket
when `dataQuality === 'cold-start'`.

Updated by `lib/coach/cron/calibration-refresh.ts` (weekly Sunday
night, after long-run completion).

### 2.3 · `lib/plan/gap-report.ts`

Composes the morning-brief gap card from `GoalGap` + `SimulationResult`:

```ts
type GapReport = {
  trajectorySec: number;
  goalSec: number;
  gapSec: number;
  status: 'closing' | 'static' | 'widening' | 'unclosable';
  confidenceBand: { p25Sec: number; medianSec: number; p75Sec: number };
  whatClosesIt: string[];          // 1-3 specific actions
  alternativeRanges: {             // populated when status != 'closing'
    a: { sec: number; label: 'A-goal' };
    b: { sec: number; label: 'B-goal' };
    c: { sec: number; label: 'C-goal' };
  } | null;
  weeksRemaining: number;
  daysToRenegotiate: number | null; // when we'll surface renegotiation card
};
```

Wired into `ReadinessBrief` + Today seed. Renders as a daily card
in the morning brief above the per-pillar tiles.

### 2.4 · goal renegotiation surface

When `gap-report.status === 'unclosable'` AND `weeksRemaining < N`
(where N scales with race distance), surface a renegotiation card:

```
Your goal · 1:30:00
Current trajectory · 1:32:30
Realistic outcomes based on training:
  A · 1:31:00 (stretch but possible)
  B · 1:32:30 (where you're tracking)
  C · 1:33:30 (safe + executable)

[Adjust target] [Hold goal, aim for execution]
```

POST `/api/race/goal` accepts the new target. Triggers:
1. Re-simulate the plan with new goal
2. Refresh per-day-type prescriptions (T/I/M paces shift)
3. Bust the brief cache
4. Audit row in `coach_intents` (kind=`goal_renegotiated`)

Engine NEVER chooses for the runner. Renegotiation is always a
human-in-the-loop moment.

---

## Phase 3 · cross-runner test bench

Goal: every plan-engine commit is validated against 6 personas
covering the full runner population. No more "patched for David,
hope it generalizes."

### 3.1 · synthetic runner personas

`tests/synthetic-runners/` directory. Each persona = a TypeScript
file that exports:

```ts
type Persona = {
  name: string;
  profile: ProfileRow;
  initialHealthSignals: HealthSamples[];   // 60d of priors
  weeklySignalStream: HealthSamples[];     // future weeks
  race: RaceRow;
  expectedPlanShape: {
    weeklyMileageBand: [number, number];
    qualityWorkoutsPerWeek: number;
    longRunShare: number;
    taperDepth: 'shallow' | 'medium' | 'deep';
  };
};
```

Personas:
1. **Beginner 5K** — first race ever, 12 mpw base
2. **Intermediate HM** — David's profile, 35-40 mpw, history of 1:32
3. **Advanced marathon** — 60+ mpw, sub-3 goal
4. **Advanced+ ultra** — 80+ mpw, 50K goal
5. **Returning from injury** — 20 mpw base, ramping back, no quality
6. **Sleep-debt-prone** — chronic 6.5h sleep, RHR sensitive

### 3.2 · `tests/plan-engine.test.ts`

For each persona, runs the full cycle:
1. Generate plan from race + profile
2. Simulate plan → assert trajectory hits expected band
3. Stream health signals week-by-week
4. Run weekly drift detection → assert no false-positive rebuilds
5. Run readiness adapter → assert downgrades land within doctrine
6. After 8 weeks, check calibration → assert convergence to true state
7. Verify every mutation has a citation
8. Verify no stale fields (sub_label, pace, workout_spec all in sync)

Pass/fail per persona, reported as a matrix.

### 3.3 · GitHub Actions wiring

`.github/workflows/plan-engine-bench.yml` runs on every push that
touches `lib/plan/**` or `lib/coach/readiness*`. Required check
before merge to main.

Caches `node_modules` + test fixtures so the bench runs in <2 min.

---

## Citation discipline

Every Research/ source we cite must:
1. Live in `/Volumes/WP/06 Claude Code/Runcino/Research/`
2. Have a corresponding `system_doctrine` row
3. Be referenced by enum, not freeform string

Existing doctrine inventory (`docs/SYSTEM_AUDIT_2026-05-30.md` §21
rows) covers most cases. New citations get added to both the
research directory AND `system_doctrine` in the same PR.

---

## Migration notes

Phase 1 lands incrementally. Old code paths stay until the new path
is wired + tested:

- `volumeCurve()` stays · `runner-calibration.ts` reads it for
  cold-start defaults
- `recentWeeklyMileage()` stays · `easyDayMedianMi()` is additive
- `applyAdaptations()` stays · `adapt-block.ts` wraps it
- `detectDrift()` stays · per-axis drift adds three new check
  functions alongside the existing volume check

Once the simulator (Phase 2) and bench (Phase 3) are green,
deprecate the old paths in a single cleanup commit.

---

## Open questions

(Tracked here so they don't get lost in PR comments.)

- Goal-renegotiation timing — at what `weeksRemaining` do we surface
  the renegotiation card? Plan: scale with race distance (5K = 2 weeks,
  HM = 3 weeks, marathon = 4 weeks). Confirm with David before shipping
  Phase 2.4.

- Calibration cold-start handoff — when do we declare a runner
  "calibrated" and switch off the experience_level fallback? Plan:
  14 days OR 4 completed quality workouts, whichever comes first.

- Goal-time storage when runner has multiple races — current schema
  has one `goal_time_sec` per race. Multi-race calibration may need
  per-race trajectory tracking. Defer to Phase 2.

---

## Doc maintenance

This doc is updated FIRST when architecture changes. PR template
will be updated to require a checkbox: "Did you update
`PLAN_ENGINE_ARCHITECTURE.md`?"

Last sections updated:
- 2026-06-01 · initial doc · phase plans, doctrine, architecture
