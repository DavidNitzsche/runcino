# Brief · Backend wiring for the Targets GapPanel

**Audience.** Backend data agent.
**Surface.** `web-v2/components/faff-app/views/GapPanel.tsx` — the "Closing the gap" panel that landed Saturday under the goal hero on Targets.
**Why this brief exists.** The panel ships with mode selection + Fitness chunk + VDOT pill + held-days + status chip all reading real backend data. Four pieces still use doctrine placeholders and need to be wired to honest, per-runner-per-race numbers before the panel earns its claim. This brief packages all four in one place.

---

## 1. What the panel does · 30-second context

GapPanel replaces the flat projection sparkline. On a steady-state runner it renders:

- A **truth headline** that calls out *why* the projection is flat ("VDOT only re-rates on a real signal").
- A **gap decomposition bar** + 4-cell legend splitting the total `projected − goal` delta into four buckets: **Fitness · Conditions · Course · Execution**, each tappable for doctrine.
- A **hit list** of 2–3 levers that would actually move the projection, each with a projected time + delta.

Mode is auto-derived from real seed data:
- `projectionSec == null` → `cold` (honest empty)
- `daysAway ≤ 7` → `raceweek` (A/B + cues, no gap chart)
- `projSec / goalSec > 1.08` → `offtrack` (red status, B-target recommendation)
- else → `steady` (default)

The four placeholders below all live inside the steady / offtrack modes. Cold + raceweek render fine as-is.

---

## 2. The four backend pieces to wire

For each piece, the panel currently reads a hardcoded doctrine default. The work is to make those numbers honest per-race-per-runner, and to thread the value through the existing seed pipeline so `GapPanel` can read it from `seed.goalRace` (or a new sibling field).

### 2.1 Conditions chunk · expected race-day weather impact, in seconds

**Today:** hardcoded `~1.8% of goalSec` (≈90s for a 1:30 half). Doesn't know if the race is in San Diego or Anchorage.

**Target:** per-race, per-distance seconds estimate based on the actual race-day forecast (or a climate normal beyond the forecast horizon).

**Backend approach:**

- **New helper:** `web-v2/lib/training/race-conditions.ts`
  - Input: `{ raceSlug, raceDateISO, raceLat, raceLng, distanceMi, goalSec }`
  - Output: `{ seconds: number, source: 'forecast' | 'climate', heatBand: 'neutral'|'warm'|'hot'|'extreme', tempF: number, dewF: number, summary: string }`
  - Logic:
    1. If `dateISO - today ≤ 16d` AND we have a lat/lng → call `loadForecast(raceLat, raceLng, raceDateISO)` (uses Open-Meteo, same writer the daily forecast cron uses).
    2. Else fall back to climate normals: a small `lib/training/climate-normals.ts` table keyed by (US state OR country code) × month, returning a typical AM tempF + humidity. 50 states + ~30 countries is fine for the doctrine pass.
    3. Apply Maughan/Ely heat-impact model — same one already used by `lib/weather/heat-adjustment.ts`. Convert the projected pace adjustment back to total seconds.
- **Seed wiring:** add `goalRace.conditionsImpactSec: number | null` + `goalRace.conditionsSource: 'forecast' | 'climate' | null`. Populate in `web-v2/components/faff-app/seed.ts` next to `adaptGoalRace` (or wherever goal race resolution happens).

**Doctrine citation:** `Research/03 · heat-and-pace model`. The existing `lib/weather/heat-adjustment.ts` is the production implementation — race-conditions.ts should call it, not re-derive.

**Fallback:** null when no lat/lng on the race AND no editorial location-month tuple. Panel hides the chunk gracefully when null.

---

### 2.2 Course chunk · expected elevation impact, in seconds

**Today:** hardcoded 24s. Doesn't know if it's Big Sur or a track.

**Target:** per-race seconds estimate based on the course's net + gross elevation profile.

**Backend approach:**

- **New helper:** `web-v2/lib/training/course-impact.ts`
  - Input: `{ raceSlug, distanceMi, goalSec, elevationGainFt, netElevationFt, courseSource }`
  - Output: `{ seconds: number, source: 'editorial' | 'crowd' | 'stub', elevGainFtPerMi: number }`
  - Logic:
    1. Read `course_library` row for `raceSlug` if present (we already pull `source`, `contributor_count`, `start_label`, `finish_label`, `notes` — extend to also pull `elevation_gain_ft`, `net_elevation_ft`).
    2. Apply Daniels' elevation correction: roughly +10s/mi per 100ft of net climb and −7s/mi per 100ft of net drop, scaled to the goal pace. Gross gain matters for fatigue cost; net matters for time impact.
    3. Floor at 0 (a net-downhill course never makes the chunk negative on the panel — we report it as 0 and surface the upside in the doctrine drawer copy).
- **Seed wiring:** add `goalRace.courseImpactSec: number | null` + reuse the existing `goalRace.courseSource` (already on the seed).

**Doctrine citation:** Daniels' Running Formula §elevation correction. A short writeup in `learn_articles` slug=`doctrine-elevation-correction` so the doctrine drawer can deep-link.

**Fallback:** null when `course_library` has no elevation data for this race. Panel hides the chunk gracefully.

---

### 2.3 Execution chunk · runner-specific pacing-discipline buffer, in seconds

**Today:** hardcoded 30s. Defensible as a doctrine default but doesn't reflect this runner's actual pacing.

**Target:** seconds estimate sized to the runner's recent split-variance. A tight pacer at 15s, a typical runner at 30s, a loose one at 60s.

**Backend approach:**

- **New helper:** `web-v2/lib/coach/pacing-discipline.ts`
  - Input: `userUuid`, optional `windowDays = 90`
  - Output: `{ bufferSec: number, n: number, cv: number | null, source: 'observed' | 'default' }`
  - Logic:
    1. Pull the runner's last 4 race-effort runs (`type IN ('race', 'tempo', 'threshold')`) over the last 90 days from `runs`.
    2. For each, compute the coefficient of variation across mile splits (`std / mean`). Median those.
    3. Map: CV < 0.02 → 15s buffer, < 0.04 → 30s, ≥ 0.04 → 60s. Source = 'observed'.
    4. With fewer than 2 qualifying runs → return 30s, source = 'default'.
- **Seed wiring:** add `goalRace.executionBufferSec: number` + `goalRace.executionSource: 'observed' | 'default'`. Always populated (30s is the default).

**Doctrine citation:** `Research/04 · pacing discipline`. Already exists as a doctrine source.

**Fallback:** 30s default is the fallback. No null state needed.

---

### 2.4 Hit list · cheapest 2-3 levers that would actually move the projection

**Today:** static patterns sized to which gap bucket is dominant (e.g. fitness > 60s → "tune-up race" + "threshold block"). Doesn't check if a tune-up race actually exists in the user's window, doesn't check if threshold work is already in the plan, doesn't check if the race has wave options for the "cooler corral" lever.

**Target:** per-runner, per-race personalized levers with real linked surfaces.

**Backend approach:**

- **New helper:** `web-v2/lib/coach/projection-levers.ts`
  - Input: `{ userUuid, goalRace: GoalRace, gap: { fitness: number, conditions: number, course: number, execution: number } }`
  - Output: `Array<Lever>` where Lever is:
    ```ts
    {
      icon: 'flag' | 'bolt' | 'clock' | 'shield' | 'spark';
      kind: 'tune_up_race' | 'threshold_block' | 'vo2_block' | 'cooler_corral'
          | 'goal_pace_block' | 'hold_fitness' | 'set_b_target' | 'sharpen';
      title: string;        // "Drop a tune-up 10K"
      detail: string;       // "Carlsbad 10K Jun 22 re-rates VDOT 49+"
      projectedTime: string;// "1:32:30"
      deltaSec: number;     // -144 (negative = faster)
      controllability: 'Trainable' | 'Logistics' | 'Smart';
      linkTo?: string;      // "/races/carlsbad-10k" if applicable
      lvtag: string;        // sub-label for the row
    }
    ```
  - Logic:
    1. Read `races` table for user's upcoming races within 12 weeks. If any qualifying-distance race exists at the right phase distance from the goal race (rough rule: 4–10 weeks out, ≤ goal race's distance), emit a `tune_up_race` lever pointing at it.
    2. Read the user's active `plan_workouts` for the next 4 weeks. If no threshold work is scheduled AND fitness gap > 60s → emit `threshold_block` lever. Else `sharpen`.
    3. Read `races.meta.waveOptions` (when populated by the race editorial layer — for now, hardcode the lever copy when goalRace location matches a known-multi-wave race like Big Sur or AFC, otherwise skip).
    4. If `gap.fitness ≤ 30s` → lead with `hold_fitness`. The runner is already there; protect what they've got.
    5. If `projSec / goalSec > 1.08` → always include `set_b_target` lever pointing at the editable B-target on `/races/[slug]`.
    6. Rank by (impact desc, controllability=Trainable first, logistics=cheap) and cap at 3.
- **Seed wiring:** add `goalRace.levers: Lever[]`. Populated in `adaptGoalRace`.

**Doctrine citation:** none new — composes existing pieces. The `tune_up_race` projection math reuses `predictRaceTime(vdot + 1, distanceMi)` from `lib/training/vdot.ts`.

**Fallback:** empty array. Panel renders the hit-list section only when `levers.length > 0`.

---

## 3. The seed contract · what GapPanel reads after wiring

```ts
// In web-v2/components/faff-app/types.ts — extend GoalRace:
export type GoalRace = {
  // ... existing fields ...

  // 2.1 · Conditions
  conditionsImpactSec: number | null;          // seconds added by race-day weather
  conditionsSource: 'forecast' | 'climate' | null;

  // 2.2 · Course
  courseImpactSec: number | null;              // seconds added by elevation profile

  // 2.3 · Execution
  executionBufferSec: number;                   // always populated (default 30)
  executionSource: 'observed' | 'default';

  // 2.4 · Hit list
  levers: Array<{
    icon: 'flag' | 'bolt' | 'clock' | 'shield' | 'spark';
    kind: 'tune_up_race' | 'threshold_block' | 'vo2_block' | 'cooler_corral'
        | 'goal_pace_block' | 'hold_fitness' | 'set_b_target' | 'sharpen';
    title: string;
    detail: string;
    projectedTime: string;
    deltaSec: number;
    controllability: 'Trainable' | 'Logistics' | 'Smart';
    linkTo?: string;
    lvtag: string;
  }>;
};
```

`GapPanel.tsx` will be updated to read these four fields directly. The helper functions `deriveSegs()` and `deriveHits()` in GapPanel will be replaced by simple field reads. The hardcoded doctrine numbers + lever patterns get dropped.

---

## 4. Acceptance criteria

For each piece the brief should produce:

1. **Conditions** — render different numbers for David's Aug 15 AFC Half (San Diego summer · warm) vs a hypothetical Mar 1 Anchorage Half (cold). The seconds field carries a meaningful delta. When neither forecast nor climate normals exist (foreign race, no location), field is null and the panel hides the chunk.
2. **Course** — Big Sur Marathon's course chunk reads materially larger than Carlsbad 5K's, driven by `course_library.elevation_gain_ft`. When `course_library` has no elevation data, field is null and the panel hides the chunk.
3. **Execution** — David's actual races show his real CV. A runner with 2 sloppy efforts gets a larger buffer than David's. Source field flips from 'default' to 'observed' as soon as 2 qualifying runs land.
4. **Hit list** — for David (has a Carlsbad 10K already in his races table 22 days out), the `tune_up_race` lever populates with `linkTo = '/races/carlsbad-10k'`. For a runner with no upcoming races, that lever is omitted and `threshold_block` takes its place. For runners with threshold work already in the plan this week, `threshold_block` is replaced by `sharpen`.

Each piece can ship independently. Suggested order if doing them serially: **Course → Conditions → Execution → Hit list** (course is the cleanest single field write, conditions is medium, execution needs a query against runs, hit list is the most composition-heavy).

---

## 5. Files the backend agent should read first

- **The panel that consumes this data:** `web-v2/components/faff-app/views/GapPanel.tsx` (especially `deriveSegs()` and `deriveHits()` — those will be deleted after wiring).
- **Where goal race is built today:** `web-v2/components/faff-app/seed.ts` → `adaptGoalRace`. This is where the new fields populate.
- **Existing weather/heat infrastructure to reuse:**
  - `web-v2/lib/weather/openmeteo.ts` (forecast reader)
  - `web-v2/lib/weather/heat-adjustment.ts` (Maughan model — DO NOT re-derive, reuse)
  - `web-v2/app/api/forecast/[date]/route.ts` (the existing API)
- **Existing race/course data:**
  - `web-v2/lib/coach/races-state.ts` (the goal race row)
  - `web-v2/components/faff-app/raceDetail.ts` (the course_library read we lifted Saturday — extend to also fetch elevation fields)
  - `db/migrations/127_course_library.sql` (or whatever migration created the editorial fields)
- **VDOT + projection:**
  - `web-v2/lib/training/vdot.ts` (`predictRaceTime`, `bestRecentVdot`)
  - `web-v2/lib/training/projection-snapshots.ts`
- **Plan adjacency for the hit list:**
  - `web-v2/lib/coach/training-state.ts` (active plan + upcoming workouts)

Brief authored 2026-05-31 · web agent · after David asked for the four placeholder pieces to be wired to honest backend data.
