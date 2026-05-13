# Plan-as-Artifact · Architecture

This document describes the rewrite that replaces "engine answers what should today be?" with "coach authors a real plan, then adapts it as reality unfolds."

This is the architecture the user signed off on after reviewing the bullet points in chat. Source of truth for the build that follows.

## What the plan must feel like (from the user)

A real coach gives you a plan. You can see the whole arc. The plan adapts — but only when doctrine says it should. One bad sleep doesn't move a workout; three consecutive poor check-ins does. The plan transitions automatically: when an A-race date passes, the next plan starts toward the next A-race, or shifts to maintenance if there's nothing on the calendar.

## Two modes

The plan is always one of:

**`race-prep`** — there's an A-race within the next ~16 weeks. The plan is a periodized arc that ends on race day. Phase structure derived from Daniels' chapter on plan skeletons (`Research/00a-distance-running-training.md §"Plan skeletons"` — verify exact heading at build time). For a 12-week half-marathon: 4 weeks base → 4 weeks build → 3 weeks peak → 1 week taper → race week. Marathon plans are 16 weeks with longer base/build. Shorter blocks (under 8 weeks) compress phases but never skip them.

**`maintenance`** — no A-race within the window. Plan is a steady aerobic baseline with one quality session per week to hold fitness. No periodization arc. Long runs hold at a sensible distance for the runner's current base. Cited: `Research/00a §"Maintenance running"` (verify exact heading; if it doesn't exist, find the closest passage on aerobic baseline maintenance for trained runners).

Mode is determined every time `buildPlan` runs. The plan stores its mode so the UI can render the right header.

## Core entities

```ts
type Plan = {
  id: string;                          // uuid
  mode: 'race-prep' | 'maintenance';
  raceId: string | null;               // FK to races table; null in maintenance mode
  goalISO: string;                     // race date, OR (maintenance) plan-end date 16wk out
  authoredISO: string;                 // when this plan was first written
  authoredFromState: CoachStateSnapshot; // the state used to author it (for audit)
  phases: PlanPhase[];                 // ordered
  weeks: PlanWeek[];                   // ordered; one per Mon-Sun week
};

type PlanPhase = {
  id: string;
  label: 'BASE' | 'BUILD' | 'PEAK' | 'TAPER' | 'RACE_WEEK' | 'MAINTENANCE';
  startWeekIdx: number;                // index into Plan.weeks
  endWeekIdx: number;                  // inclusive
  rationale: string;                   // plain-English why this phase exists here
  citation: string;                    // Research/ path + section
};

type PlanWeek = {
  id: string;
  weekStartISO: string;                // Monday of the week
  phaseId: string;                     // FK
  isCutback: boolean;                  // every ~3rd week per doctrine
  isPeak: boolean;                     // true on the peak-mileage week
  isRaceWeek: boolean;                 // race day falls in this week
  rationale: string;                   // "fourth week of build · peak so far"
  workouts: PlanWorkout[];             // 7 entries, one per day Mon-Sun
};

type PlanWorkout = {
  id: string;
  dateISO: string;                     // actual calendar date
  dow: number;                         // 0=Sun ... 6=Sat — useful for queries
  type: WorkoutType;                   // rest | easy | long | threshold | interval | mp | race | shakeout | recovery
  distanceMi: number;                  // 0 if rest
  paceTargetSPerMi: number | null;
  durationMin: number | null;
  isQuality: boolean;
  isLong: boolean;
  notes: string;                       // optional coach-voice line
  // As-planned snapshot, frozen at authoring time:
  originalDateISO: string;
  originalType: WorkoutType;
  originalDistanceMi: number;
  // Mutation history:
  mutations: PlanMutation[];           // empty when never adapted
};

type PlanMutation = {
  id: string;
  ts: string;                          // when the adaptation applied
  reason: string;                      // plain-English why
  citation: string;                    // Research/ path + section that triggered it
  trigger: TriggerKind;                // see triggers section below
  signalSnapshot: SignalSnapshot;      // what state looked like when it fired
  changedFields: Partial<PlanWorkout>; // delta from previous state
};
```

## Adaptation triggers — doctrine-grounded only

Every trigger in `adaptPlan` MUST cite a real `Research/` passage that defines the threshold. No engine-author hunches. No "this seems reasonable." If doctrine doesn't define it, the engine doesn't trigger on it.

The complete list of triggers (every one cites doctrine):

| Trigger | Threshold | Citation |
|---|---|---|
| `checkin-yellow` | `state.checkin.poorDaysCount >= 3` (energy ≤4 OR soreness ≥7 OR stress ≥7) | `Research/00b §Decision Matrix` |
| `checkin-red` | `state.checkin.poorDaysCount >= 5` | `Research/00b §Decision Matrix` |
| `volume-crater` | `state.volume.last7Mi < 0.7 × state.volume.weeklyAvg4w` AND not in deliberate cutback | `Research/00a §Volume progression rules` + `Research/05 §1.4 Return-to-Volume Guidelines` |
| `rebuild-after-break` | `state.flags.rebuildAfterBreak === true` | `Research/05 §1.5 Volume before intensity` |
| `injury-return` | `state.flags.injuryReturning === true` | `Research/05 §1.4 Volume before intensity` |
| `b-race-in-window` | `state.races.inWindow` contains a B-race within ±2 days of a planned quality workout | `Research/00b §Recovery by Effort (A vs B vs C Race)` |
| `heat-disruption` | (deferred — requires env signal not yet wired) | flag |
| `illness` | (deferred — requires illness signal not yet wired) | flag |
| `bad-race-result` | post-race actual > predicted by ≥15s/mi for B+ races | `Research/02 §2. Riegel Formula` for the prediction baseline |
| `good-race-result` | post-race actual < predicted by ≥15s/mi | same |
| `vdot-upgrade-dampening` | new VDOT signal > current by ≥2 points | `Research/01 §Dosing rules — Daniels' caps` |

What happens when a trigger fires:

- **`checkin-yellow`**: suppress quality work until the count drops below threshold. Today's quality workout → easy/recovery. Subsequent quality slots stay scheduled but are gated by re-evaluation each day.
- **`checkin-red`**: suppress everything except easy/recovery for 2-3 days. Long run pushed by 1 day or shortened by ~30% if it falls within the window.
- **`volume-crater`**: next week's baseEasy ramps from `last7Mi × 1.10` (10% rule), not from `weeklyAvg4w`. No catch-up doubles.
- **`rebuild-after-break`**: ~3-5 days suppressed quality, ramp gradual.
- **`b-race-in-window`**: B-race day → race workout. ±1 day → recovery. ±2 days → no quality.
- **`bad-race-result`**: next mesocycle's VDOT-anchored paces shift to the actual result, not the prediction.
- **`good-race-result`**: next mesocycle's VDOT shifts up, capped at +1.0 per cycle.

What does NOT trigger adaptation:
- One bad sleep night. (Doctrine: count, not single-day.)
- One missed run. (Doctrine: pattern, not single event.)
- A "feel" signal that isn't backed by a numeric threshold in research.

## Lifecycle

```
buildPlan(state, prefs, race?) → Plan
```
- Called when: an A-race is set, or when the existing plan's `goalISO` has passed, or on first profile setup.
- Writes a new `Plan` row + cascading `PlanPhase` / `PlanWeek` / `PlanWorkout` rows.
- Uses `state` for the runner's current fitness baseline (VDOT, weekly volume, recovery state).
- Uses `prefs` for day-of-week assignments.
- Uses `race` (if provided) for the goal posture; otherwise authors a maintenance plan.

```
adaptPlan(plan, state, today) → Plan'
```
- Called every time `gatherCoachState` runs (effectively once per request).
- Reads `state.checkin`, `state.volume`, `state.flags`, `state.races`.
- Evaluates every trigger in the table above; for each that fires, computes the mutation per doctrine.
- Applies mutations as `PlanMutation` rows on the affected `PlanWorkout`s.
- Returns the mutated plan. Persists mutations.
- Idempotent — running it twice in a row with the same state produces the same result.

```
getCurrentPlan(userId) → Plan
```
- Reads the current plan from DB.
- Runs `adaptPlan` against fresh state before returning.
- This is what API routes call.

```
plan_lifecycle_check(state, plan) → 'continue' | 'transition' | 'rewrite'
```
- Run at the top of every `getCurrentPlan` call.
- `'continue'`: plan is still valid.
- `'transition'`: race day passed OR A-race was added/changed. Author a new plan automatically. Old plan archived (kept for history).
- `'rewrite'`: state diverged dramatically (e.g., 4 weeks of completely-off-plan running with no adaptations applied). Author a fresh plan from current state. Old plan archived.

## Database schema

```sql
CREATE TABLE IF NOT EXISTS training_plans (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL DEFAULT 'me',
  mode            TEXT NOT NULL CHECK (mode IN ('race-prep','maintenance')),
  race_id         TEXT,                             -- FK soft-ref to races
  goal_iso        TEXT NOT NULL,
  authored_iso    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  authored_state  JSONB NOT NULL,                   -- snapshot for audit
  archived_iso    TIMESTAMPTZ                       -- non-null when superseded
);
CREATE INDEX IF NOT EXISTS training_plans_active
  ON training_plans (user_id) WHERE archived_iso IS NULL;

CREATE TABLE IF NOT EXISTS plan_phases (
  id              TEXT PRIMARY KEY,
  plan_id         TEXT NOT NULL REFERENCES training_plans(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  start_week_idx  INTEGER NOT NULL,
  end_week_idx    INTEGER NOT NULL,
  rationale       TEXT NOT NULL,
  citation        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plan_weeks (
  id              TEXT PRIMARY KEY,
  plan_id         TEXT NOT NULL REFERENCES training_plans(id) ON DELETE CASCADE,
  week_idx        INTEGER NOT NULL,
  week_start_iso  TEXT NOT NULL,
  phase_id        TEXT NOT NULL REFERENCES plan_phases(id) ON DELETE CASCADE,
  is_cutback      BOOLEAN NOT NULL DEFAULT FALSE,
  is_peak         BOOLEAN NOT NULL DEFAULT FALSE,
  is_race_week    BOOLEAN NOT NULL DEFAULT FALSE,
  rationale       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plan_workouts (
  id                    TEXT PRIMARY KEY,
  plan_id               TEXT NOT NULL REFERENCES training_plans(id) ON DELETE CASCADE,
  week_id               TEXT NOT NULL REFERENCES plan_weeks(id) ON DELETE CASCADE,
  date_iso              TEXT NOT NULL,
  dow                   INTEGER NOT NULL CHECK (dow BETWEEN 0 AND 6),
  type                  TEXT NOT NULL,
  distance_mi           NUMERIC NOT NULL,
  pace_target_s_per_mi  INTEGER,
  duration_min          INTEGER,
  is_quality            BOOLEAN NOT NULL DEFAULT FALSE,
  is_long               BOOLEAN NOT NULL DEFAULT FALSE,
  notes                 TEXT NOT NULL DEFAULT '',
  -- As-planned snapshot (frozen at authoring):
  original_date_iso     TEXT NOT NULL,
  original_type         TEXT NOT NULL,
  original_distance_mi  NUMERIC NOT NULL
);
CREATE INDEX IF NOT EXISTS plan_workouts_date
  ON plan_workouts (plan_id, date_iso);

CREATE TABLE IF NOT EXISTS plan_mutations (
  id                TEXT PRIMARY KEY,
  workout_id        TEXT NOT NULL REFERENCES plan_workouts(id) ON DELETE CASCADE,
  ts                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason            TEXT NOT NULL,
  citation          TEXT NOT NULL,
  trigger_kind      TEXT NOT NULL,
  signal_snapshot   JSONB NOT NULL,
  changed_fields    JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS plan_mutations_by_ts
  ON plan_mutations (ts DESC);
```

## What the existing engine becomes

The current `pickRun(state, dateISO) → workout` becomes a strict fallback only used when:
- A user has no `profile` row and no `races` (so we can't author a plan yet).
- Or when explicitly invoked by debugging tools.

For all normal use, `getCurrentPlan(userId).workouts.find(w => w.dateISO === today)` is the new prescription path.

The existing `simulateRange` becomes the implementation of `buildPlan`'s workout-authoring loop (with state-advancement fixed by Wave T). It's still useful — it's just now called once at authoring time, not 120 times at view time.

## What the UI reads from the plan

- **/overview TodayCard**: today's `PlanWorkout`. If `mutations.length > 0`, show the `▾ COACH ADJUSTED` pin + the most-recent mutation's `reason`.
- **/training plan view (the calendar)**: full plan, all weeks, color-coded by phase. Mutations visible inline as small chips on each affected workout (`MOVED FROM TUE · poor sleep flagged`).
- **PLAN ADAPTED card**: queries `plan_mutations` for the last 7 days. Each item is a real DB row. Empty list → "Plan held steady — Coach didn't need to move anything this week."
- **PATH TO RACE hero**: `Plan.goalISO` + `Plan.phases` give the structure. Current fitness + gap come from existing `vdotSnapshot` + Riegel.
- **NEXT PUSH card**: reads upcoming `PlanWorkout`s within the next 7 days, looks for ones the runner hasn't satisfied recently. The pushes come from the plan itself, not from a separate signal engine.
- **Coach narrative line**: same engine as today, but now it can also fire on plan-relative signals ("two weeks into your build block — first peak long this Saturday").

## Migration phases

The build is staged so nothing breaks:

**Phase 1 — Schema + authoring (no UI changes)**
- Add the four DB tables.
- Implement `buildPlan` using the existing `simulateRange` for workout authoring.
- Add tests covering: race-prep half plan, race-prep marathon plan, maintenance plan, plan with no race + no profile (returns null cleanly).
- Add a hidden `/api/plan/active` route that returns the active plan but isn't consumed by any UI yet.

**Phase 2 — Adaptation engine**
- Implement `adaptPlan` with every trigger in the doctrine table.
- Add tests covering each trigger firing + not-firing on the fence cases.
- `getCurrentPlan` becomes the single entry point.

**Phase 3 — UI migration**
- `/overview` TodayCard switches to `getCurrentPlan().today`.
- `/training` plan view switches to `getCurrentPlan().weeks` for the calendar.
- PLAN ADAPTED card reads `plan_mutations` table.
- The existing per-day engine path is still alive as fallback.

**Phase 4 — Lifecycle**
- `plan_lifecycle_check` runs on every `getCurrentPlan`. Auto-transitions when A-race passes, auto-rewrites when state diverges.
- Cleanup: old `simulateRange`-based projection paths get retired; `pickRun` becomes the explicit fallback only.

## Test contract

Every phase must pass before the next ships:

- Race-prep plan for a 12-week half marathon: phases land at base[1-4]/build[5-8]/peak[9-11]/taper[12]. Long-run progression climbs sensibly (10→11→12→13 with a cutback at week 3). No quality on rest day. Long run on prefs.longRunDow.
- Maintenance plan: 16 weeks, 1 quality per week, long run on prefs.longRunDow at ~50% of historical longest training run. No phase arc visible.
- `adaptPlan` with `checkin.poorDaysCount = 4` mutates today's quality → recovery, adds a citation, leaves tomorrow alone.
- `adaptPlan` with `checkin.poorDaysCount = 1` does NOT mutate (single-day signal doesn't fire — doctrine threshold).
- Plan lifecycle transition: when `Plan.goalISO < today`, calling `getCurrentPlan` archives the old plan and authors a new one (race-prep if another A-race exists, maintenance otherwise).

## Open questions for future passes (don't block the build)

- Persistence of multi-runner plans (multi-tenancy). Current scope is `user_id = 'me'`.
- LLM-augmented coach narrative on top of the plan (vs current template-based notes).
- Plan-vs-actual comparison view (planned 10mi, ran 7mi, gap visualization).
- Coach-suggested goal time when the user sets a race without a target.

## What lands first

Build phases 1-4 in order. Estimated 6-8 commits across schema, authoring, adaptation, API, and views. The existing in-flight fixes (Q, T, U) close their bugs in the legacy engine — that engine stays alive as the fallback during migration, so closing those bugs is still useful work even after the rewrite ships.
