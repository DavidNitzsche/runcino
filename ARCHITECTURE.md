# faff — architecture and landmines

**Read this before writing code against the data layer.** It is not a tour of the
codebase; it is the set of things that are *not obvious from reading the code* and that have
each caused a real bug. Written 2026-08-17 after five bugs in one afternoon, all of the same
shape: code that read a field, a scope, or a rule that was not what it looked like.

The rule for keeping this file useful: **an entry earns its place by having caused an
incident.** If nothing has gone wrong there, it belongs in a code comment, not here.

---

## 1 · The coaching engine is three models, not one

`Design/adaptive-progression-engine.md` is canonical. The split exists because one number
was doing three jobs and they contradict each other.

| Model | Question | Where | May move |
|---|---|---|---|
| **Fitness** | What can this athlete race today? | `lib/fitness/fitness-model.ts`, `lib/training/vdot.ts` | Only on evidence |
| **Adaptation** | How well are they absorbing training? | `lib/adaptation/` | Faster than fitness |
| **Prescription** | What should we prescribe next? | `lib/prescription/levers.ts`, `lib/plan/` | Beyond demonstrated fitness, deliberately |

Supporting: `lib/coach/limiter.ts` (what is holding the goal back),
`lib/race/representativeness.ts` (how much authority a race result earns),
`lib/coach/recommendation.ts` (how any of it reaches the runner).

**The non-negotiables** are in the doctrine file. The two that get violated most:

- Time passing, plan completion, or scheduled progression alone cannot change demonstrated
  fitness.
- Training progression is not pace progression. Pace is the ninth of eleven levers.

`GET /api/coach/read` returns all of it in one call. Surfaces should consume that rather than
re-deriving.

---

## 2 · Data-layer landmines

Each of these has caused a bug. None is visible from the type system today — closing that gap
is the active foundations workstream.

### `runs.data` is untyped jsonb with two eras of shape

~70 keys, accessed by raw string literal across dozens of files. The keys that are *not* what
you would guess:

| You will write | It is actually |
|---|---|
| `start_date_local` | `date` (`YYYY-MM-DD`), with `startLocal` as fallback — use `COALESCE(data->>'date', LEFT(data->>'startLocal',10))` |
| `distance` in metres | `distanceMi`, already in miles |
| `average_heartrate` | `avgHr` / `maxHr` |
| `data->'faff'->>'…'` | **does not exist at all** |

**`data->'splits'` carries two incompatible shapes.** Strava-raw (`split`, `distance`,
`moving_time`, `average_speed`, *no HR*) and faff-normalised (`hr`, `mile`, `pace`,
`paceSecPerMi`). Both can exist for the same run on the same day. Code assuming one silently
gets nothing from the other — and the canonical run picker optimises for mileage truth, not
signal richness, so it can hand you the HR-less row and take a whole signal dark.

### A runner has many plans covering the same dates

`plan_workouts` holds every plan the user has ever had — 45 plans / 3904 rows for one runner —
because every rebuild writes a new plan over the same dates. An unscoped 42-day window counted
**431 quality sessions**.

Scoping to the active plan is the obvious fix **and it is wrong**: the day after a goal race
the active plan is a fresh recovery block, so the block the runner just executed vanishes into
an archived row and they read as having done nothing. The body does not know the plan was
archived.

Correct: for each *date*, take the workout from the most recently authored plan covering that
date. Reference implementation in `lib/adaptation/load.ts` (`OWNED_DAYS`).

### `races` is per-user, and slugs are shared between athletes

A slug like `cim` names the *event*, not one runner's entry. Every athlete
racing it has their own row under the same slug. So an `UPDATE races SET … WHERE
slug = $1` overwrites every other user's result with this one's — the same shape
as the cross-user leak in the 2026-05-30 audit. Always scope by `user_uuid`.

Caught in a 2026-08-17 backfill before it ran, alongside a second hazard in the
same script worth stating separately: **a Strava token refresh must persist, or
it silently kills the integration.** Strava invalidates the old refresh token
the instant it issues a new one, so a read-only connection that refreshes and
cannot write leaves a dead connection with no error — the failure surfaces at
the next sync, far from its cause. Any script that may refresh needs write
access and must fail loudly if the rotated triple does not save.

### Runs multi-ingest

Watch, Strava and HealthKit can all produce a row for one run. `getCanonicalRunIds`
(`lib/runs/volume.ts`) is the single source of truth for which row is real. Hand-rolling
`NOT (data ? 'mergedIntoId')` is how counts and sums get inflated.

### `runs.id` is bigint

`getCanonicalRunIds` returns strings. `r.id = ANY($1::text[])` throws
`operator does not exist: bigint = text`. Cast: `r.id::text = ANY(...)`.

### Silent degradation hides bugs

Readers that swallow failures and return null are correct — a runner we cannot see must not
read as a runner doing badly. But a swallowed error is indistinguishable from absent data.
**Always log in the catch.** That log is the only reason the bigint bug above was found.

---

### Every race is a VDOT candidate · authority scales weight, not membership

**Resolved 2026-08-17.** The A/B filter is gone. What follows is why it existed,
because the two hazards it was accidentally covering are now covered by rules
that a future change could quietly undo.

`lib/training/vdot-inputs.ts` used to admit only `meta->>'priority' IN ('A','B')`
and `vdot.ts` dropped `'C'` again at selection. That read like data hygiene. It
was the only thing standing between the candidate pool and a jogged C race,
because **`assessRaceRepresentativeness` was not consulted on the selection path
at all** — its only callers are still the two re-anchor detectors in
`lib/plan/adapt.ts`. Selection is max-wins, so it keeps the aided read and
discards the hilly one. Two things would have broken together:

1. A low-effort or heavily-aided race becoming the anchor that sets every
   prescribed pace.
2. `supersededLead` (`EVIDENCE.race-supersedes-earlier-leads`) keyed on the
   freshest race's DATE with no authority predicate, so a jogged C race becomes
   "the field test" and demotes every legitimate training lead behind it.

Both are closed in `bestRecentVdot`, and only then was the filter opened:

- Each race candidate carries an `authority` from
  `lib/race/effort-authority.ts#selectionAuthority` — `Research/00b`'s effort
  table, A 1.0 · B 0.65 · C 0.35. A race below the B floor ranks below every
  better-graded race, is excluded from the training soft-cap ceiling, and cannot
  supersede a training lead. With no better-graded race in the window it is not
  demoted at all: a floor you have beats a guess you don't.
- **Authority scales RANK, never the VDOT.** A candidate's `vdot` is a statement
  about a performance that happened, read by display surfaces and by
  `predictRaceTime`. Scaling it would invent a finish time nobody ran — the
  neutral-equivalent lever `Research/06` §10 offers and rule 8 declines.

Two things it deliberately does not do. Selection cannot price CONDITIONS —
every conditions factor is a share of the shortfall against the anchor, and at
selection the anchor is what is being chosen; a materially net-downhill course
therefore enters unpriced, and is priced at re-anchor time where an anchor
exists. And an UNGRADED priority (`hilly_excluded`, `training_run`) is graded at
the C row, not A: `recoveryEffortScale` defaults unknown→A because over-resting
is the safe error for recovery duration, and that default is exactly backwards
for authority.

## 3 · The gates

CI mechanisms that make a bug class structurally impossible. This is the pattern the project
leans on, and no class covered by a gate has recurred.

| Gate | Prevents | Entry point |
|---|---|---|
| **Palette** | Colour drift across web / iPhone / watch | `scripts/check-palette-sync.sh` |
| **Doctrine** | Physiological constants that no research supports, and citations that no longer resolve | `scripts/check-doctrine.sh` — registry at `web-v2/lib/doctrine/registry.ts` |
| **Plan invariants** | Malformed plans — placement, distance, alignment, counts | `web-v2/lib/plan/_maint_invariants.test.ts` |
| **All-user sweep** | Archetypes graded against a research answer key | `web-v2/lib/plan/_sweep_allusers.test.ts` |

Both shell gates run in `web-v2` `prebuild`, so they fire on every Railway build.

**Doctrine claims can bind rules, not only constants.** The engine can agree with research on
a number and disagree on what the number *means* — a training-derived VDOT was correctly
capped at "+1 above the last race" per `Research/01`, and then allowed to outrank the race,
even though the same passage calls it a lead awaiting a field test. The doctrine was stated
correctly in a comment directly above the code violating it. See
`EVIDENCE.race-supersedes-earlier-leads` for the shape of a rule claim.

---

## 4 · Canonical documents

Ordered by how often they settle an argument.

| Document | What it governs |
|---|---|
| `CLAUDE.md` | Operating rules — branching, deploy doctrine, what needs a human's go |
| `Design/adaptive-progression-engine.md` | The coaching engine. Three models, eleven levers, the control loop |
| `Design/coach-voice-brief.md` | How the coach speaks, and the situation library |
| `Design/goal-pursuit-doctrine.md` | Goal feasibility, trajectory, renegotiation |
| `Faff/design/0819/design_handoff_faff_iphone_app v5/` | **iPhone** visual language. Supersedes brief v2 for the phone |
| `Design/running-app-design-brief-v2.md` | Visual language for **web and watch only** — palette, type, composition |
| `Research/` | The training science every constant cites. `Research/INDEX.md` is the map |

`Design/engine-doctrine-evidence-and-levers.md` was absorbed into the progression engine doc
and is kept for history. `running-app-design-brief.md.archived` is superseded by v2.

---

## 5 · Rules that outrank code

Locked decisions that a reasonable-looking change would otherwise quietly undo.

- **Readiness informs, it never acts.** It may observe fatigue; it may not change the plan.
  The detector fired on 23% of days and was measuring ordinary life, not overreaching.
- **Race results read from `races.actual_result` first.** Strava fallbacks must be labelled
  provisional. Auto-detected best-effort segments are not races — see CLAUDE.md for the
  four-question checklist and the bugs that motivated it.
- **Multi-writer jsonb columns need field-level updates**, never full-replace upserts. Two
  known instances erased fields the active writer did not know about.
- **Absence of evidence is not evidence of a problem.** A runner without an HR strap is not
  a runner adapting badly. Unknown inputs are excluded, never defaulted to zero.
- **Strength and cross-training are removed from all surfaces.** Data and HealthKit ingest
  continue so the decision stays reversible.
