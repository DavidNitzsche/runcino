# Backend landed · what the next agent inherits

**Companion to** `targets-gap-panel-backend-brief.md` (the brief).
**Surface** · `web-v2/components/faff-app/views/GapPanel.tsx` ·
"Closing the gap" panel under the Targets goal hero.

This doc is the **drop-in for the next agent picking up GapPanel work**.
It says what shipped, where the data lives, what's null vs
always-populated, what's still placeholder, and what to verify when
making changes. Read this first; reach for the brief only when you
need the deeper "why."

---

## What shipped · 4 pieces · 4 commits

| Brief § | Chunk | Helper file | Commit |
|---|---|---|---|
| §2.2 | Course (elevation impact) | `lib/training/course-impact.ts` | `ce9fcfde` |
| §2.1 | Conditions (heat impact) | `lib/training/race-conditions.ts` + `climate-normals.ts` | `37d950f9` |
| §2.3 | Execution (pacing buffer) | `lib/coach/pacing-discipline.ts` | `89c8f120` |
| §2.4 | Hit list (levers) | `lib/coach/projection-levers.ts` | `8753b26b` |

All four are pure functions / DB-only readers. No external services
beyond Open-Meteo (which the Conditions chunk wraps).

---

## The contract the panel reads · `GoalRace`

```ts
// web-v2/components/faff-app/types.ts (lines 132-204)
export type GoalRace = {
  // ... existing fields (slug, name, date, goal, projected, etc.) ...

  // §2.2 Course
  courseImpactSec?: number | null;          // null = stub course, panel hides chunk
  courseSource?: 'editorial' | 'crowd' | 'stub' | null;
  courseElevGainFtPerMi?: number;            // for doctrine drawer copy

  // §2.1 Conditions
  conditionsImpactSec?: number | null;       // null = no forecast + no climate match
  conditionsSource?: 'forecast' | 'climate' | null;

  // §2.3 Execution
  executionBufferSec?: number;               // ALWAYS populated (30s default)
  executionSource?: 'observed' | 'default';

  // §2.4 Hit list
  levers?: Array<{
    icon: 'flag' | 'bolt' | 'clock' | 'shield' | 'spark';
    kind: 'tune_up_race' | 'threshold_block' | 'vo2_block' | 'cooler_corral'
        | 'goal_pace_block' | 'hold_fitness' | 'set_b_target' | 'sharpen';
    title: string;
    detail: string;
    projectedTime: string;
    deltaSec: number;             // negative = faster
    controllability: 'Trainable' | 'Logistics' | 'Smart';
    linkTo?: string;
    lvtag: string;
  }>;                                         // empty = no levers, panel hides hit list
};
```

---

## Null vs always-populated · per chunk

| Field | When null/empty | Panel behavior |
|---|---|---|
| `courseImpactSec` | course_library row is `source = 'stub'` (no editorial elevation data yet) | Course chunk falls back to a 24s doctrine placeholder · doctrine drawer says "course_library editorial annotations will tighten this number" |
| `conditionsImpactSec` | race is >14d out AND has no parseable location string (e.g. unfamiliar foreign race) | Conditions chunk falls back to `goalSec × 1.8%` doctrine placeholder · doctrine drawer says "Heat above ~60°F costs 1-2% on pace" |
| `executionBufferSec` | **always populated** · 30s default when runner has <2 typed race/tempo/threshold runs in 90-day window | Panel renders the value · `executionSource = 'default'` vs `'observed'` controls drawer copy |
| `levers` | empty array when no rules fire (rare · means runner is at goal, no plan, no upcoming races, conditions chunk small) | Hit-list section hides entirely |

**Doctrine** · the brief explicitly allows partial wiring. None of these
null cases should break the panel · only soften the claim.

---

## Where the seed gets enriched

`web-v2/components/faff-app/seed.ts` around line 1185, right after
`const goalRace = adaptGoalRace(...)`. The enrichment block:

1. Queries `course_library` + `races.course_geometry.bbox` (one parallel
   call) — provides elevation + race lat/lng
2. Calls `computeCourseImpact` (sync)
3. Calls `computeRaceConditions` (async · forecast or climate)
4. Calls `computePacingDiscipline` (DB query against `runs`)
5. Computes residual fitness gap = `projSec - goalSec - course - conditions - execution`
6. Calls `computeProjectionLevers` (queries races + plan_workouts)
7. Stamps all four fields onto `goalRace` in place

The whole block is wrapped in try/catch · enrichment is best-effort.
The page renders fine with the placeholder fallbacks if anything throws.

---

## What's still placeholder / legacy fallback in GapPanel

`web-v2/components/faff-app/views/GapPanel.tsx` keeps the doctrine-static
math as a fallback path:

- `deriveSegs()` reads `goal.courseImpactSec` first, falls back to 24s
  hardcoded when null
- Same pattern for `goal.conditionsImpactSec` (1.8% goalSec fallback)
- `goal.executionBufferSec` is always set so no fallback needed
- `deriveHits()` reads `goal.levers` first, falls back to the original
  static `fitness ≥ 60 → tune-up + threshold` composition when empty

**Don't delete the fallbacks** unless you also handle the cold path
(new user, no goal race resolved, seed enrichment skipped). The brief's
acceptance criteria explicitly require graceful degradation.

---

## Doctrine articles seeded

`learn_articles` table · doctrine drawer can deep-link via
`/learn/[slug]` (or wherever the Learn route lands):

| Slug | What |
|---|---|
| `doctrine-elevation-correction` | Daniels rule of thumb · seeded by Course commit `ce9fcfde` |

The other three pieces cite existing research/* sources (Research/03
heat, Research/04 pacing) — no new editorial doctrine articles needed
since those are foundational.

---

## How to verify a change

If you're changing one of the four chunks, the smoke tests live in
the commit history (see `web-v2/scripts/_test_course_impact.mjs`,
`_test_conditions.mjs`, `_test_pacing.mjs` patterns). They're
temporary inline scripts that delete after running · grep prior
commits for examples.

Acceptance per brief §4:

1. **Conditions** · two races in different climates produce different
   numbers · null when no signal. ✓ shipped.
2. **Course** · Big Sur reads materially larger than a flat half ·
   null when stub. ✓ shipped.
3. **Execution** · runner with real race-effort runs gets observed CV ·
   default 30s when fewer than 2 typed runs. ✓ shipped (David is on
   default 30s today · lights up as ingest adds tempo type labels).
4. **Hit list** · per-runner levers, tune-up linkTo is real, threshold
   replaced by sharpen when plan has threshold scheduled. ✓ shipped.

---

## Open questions / next-agent decisions

These didn't block shipping but are worth knowing:

1. **`courseSource` propagation** · the existing `goalRace` type didn't
   have `courseSource` before this brief · I added it alongside
   `courseImpactSec`. If a different surface (RaceView?) was already
   using a different `courseSource` shape, reconcile.

2. **Tune-up race window** · I implemented "4-10 weeks before goal
   race" per the brief's "rough rule". If the user-research suggests
   2-12 weeks or some other band, the constant lives at the top of
   `lib/coach/projection-levers.ts` (`findTuneUpCandidates`).

3. **Multi-wave race set** · hardcoded list of 7 famous slugs in
   `projection-levers.ts`. The brief says this is a stub until
   `races.meta.waveOptions` is editorialized. The hardcoded list is
   easy to extend or replace.

4. **Threshold-detection regex** · `LOWER(pw.type) LIKE '%threshold%'
   OR '%tempo%' OR '%cruise%'`. Plan generator uses these inconsistently.
   If a new plan generator adds more aliases (e.g. 'lactate'), update.

5. **VDOT bump constants** in `projection-levers.ts`:
   - tune-up race ≈ +1 VDOT
   - threshold block ≈ +0.5
   - sharpen ≈ +0.3
   These are doctrine estimates · adjust if research disagrees.

6. **Climate normals coverage** · 50 US states + ~30 countries.
   `lib/training/climate-normals.ts`. Adding a new country = adding a
   row to `CLIMATE_NORMALS_INTL` + (optionally) an alias to
   `countryAlias`. No migration needed.

7. **Course library net_elevation_ft** · migration 130 added the
   column + seeded 4 editorial values. As more races get editorial
   coverage, INSERT/UPDATE values · no schema change needed.

---

## Hand back to the brief author (web agent)

The seed contract in `types.ts GoalRace` is the wire format. Phone
+ web both consume `goalRace` the same way (the iPhone's view layer
isn't yet on this brief but the seed is shared). When the iPhone
agent picks up GapPanel-equivalent work, they read the same fields.

Brief shipped at `acc725da`. Backend pieces at `ce9fcfde` / `37d950f9`
/ `89c8f120` / `8753b26b`. All on main, typecheck-clean.

---

**TL;DR for a fresh Sonnet agent** · Open `GapPanel.tsx`. Look at
`deriveSegs()` and `deriveHits()` · they show what fields are read off
`goal`. Cross-reference the field doc in `types.ts GoalRace`. If you
need to know HOW a field is computed, the helper paths are in the
table at the top of this doc. The brief explains WHY.
