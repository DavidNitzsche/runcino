# Brief · `plan_workouts.type` vs `sub_label` alignment

**For:** backend / training-plan agent
**From:** frontend (faff-web)
**Date:** 2026-06-01
**Status:** Discovery + fix

---

## What surfaced

While unifying plan-data sources across the frontend (week strip on Today, FULL PLAN month calendar, hero, modal, THIS WEEK list, missed-yesterday pill, strength placement), we hit a row where the two columns disagree.

David's training plan, week 1 Tue (Americas Finest City, sub 1:30 HM block):

| Column | Value |
|---|---|
| `plan_workouts.distance_mi` | 6.0 |
| `plan_workouts.pace_target_s_per_mi` | 407 (6:47/mi · threshold pace) |
| `plan_workouts.sub_label` | `"Cruise Intervals"` |
| `plan_workouts.type` | (suspected) `'easy'` |

The frontend's `mapType()` reads `type` and buckets to `EffortKey` (`easy` | `recovery` | `long` | `tempo` | `intervals` | `rest`). It maps:
- `'tempo'` or `'threshold'` → `'tempo'`
- `'interval'` / `'vo2'` / `'track'` → `'intervals'`
- `'long'` → `'long'`
- `'recovery'` / `'shake'` → `'recovery'`
- `'rest'` → `'rest'`
- everything else → `'easy'`

Because the week strip is rendering Tue as the `'easy'` bucket (we verified — generic "Easy" tag, not "Tempo" or "Intervals"), `plan_workouts.type` for that row must be a value that falls through `mapType` to `'easy'`. That contradicts the sub_label and the pace target.

The frontend was further compounding this by hardcoding the label to `humanName(eff, mi)` in `adaptWeek` (seed.ts:303) — discarding the rich `sub_label`. **That frontend bug is being fixed in this same commit** (mirrors the working `adaptSeason` pattern at seed.ts:506). After the fix, the chip will display "Cruise Intervals" regardless of what `type` says.

But the underlying `type` column being wrong (or coarse) has real downstream consequences described below.

---

## What we need backend to confirm

### 1. Audit the values written to `plan_workouts.type`

Run a sanity sweep:

```sql
SELECT DISTINCT type, sub_label, COUNT(*) AS n
FROM plan_workouts
WHERE sub_label IS NOT NULL
GROUP BY 1, 2
ORDER BY 1, 2;
```

Specifically check whether any of these mismatches exist:
- `type='easy'` rows where `sub_label` matches `~* 'tempo|threshold|cruise|interval|vo2|repeat|ladder|hill'`
- `type='long'` rows where `sub_label` matches `~* 'easy|recovery'`
- `type='rest'` rows where `sub_label` carries a workout name
- Any `type` value that's NOT in our `mapType` switch list (so it's silently falling through to 'easy')

### 2. Decide which column owns workout intent

Two valid architectures, frontend can adapt to either:

**Option A · `type` is the source of truth.** Tighten the plan generator so `type` always matches what the workout actually is. `'cruise_intervals'` workouts get `type='threshold'`, hill repeats get `type='intervals'`, etc. `sub_label` becomes a human-readable display name layered on top of a correct bucket.

**Option B · `sub_label` is the source of truth.** Loosen the contract on `type` (could even drop it), and frontend infers effort bucket from `sub_label` keywords + pace zone. `type` is at best a coarse rollup for reporting.

Either is fine for the frontend, we just need to know which to trust.

**Default if you don't answer:** we'll go with B at the frontend layer (sub_label + pace zone as the authority) and treat `type` as a coarse hint. That keeps current data flowing without requiring you to backfill. But A is structurally cleaner if you want to commit to it.

### 3. Backfill if Option A

If you pick A, write a migration that walks `plan_workouts`, reads `sub_label`, and rewrites `type` to the correct bucket. The frontend's `mapType` keyword set is a reasonable starting taxonomy:

| sub_label contains | type should be |
|---|---|
| `long`, `long run` | `long` |
| `tempo`, `threshold`, `cruise` | `threshold` (or `tempo` if you prefer) |
| `interval`, `vo2`, `repeats`, `ladder`, `track` | `intervals` |
| `hill repeats` | `intervals` |
| `recovery`, `shakeout` | `recovery` |
| `rest`, `off` | `rest` |
| `easy`, default | `easy` |

Add a CHECK constraint or enum to lock the type column going forward.

---

## Downstream consumers of `plan_workouts.type` on the frontend (so backend knows the blast radius)

| Consumer | What it does with type |
|---|---|
| `seed.ts:adaptWeek` → `mapType` → `EffortKey` | Drives effort-color on chips, hero gradient, watch face mesh |
| `seed.ts:adaptSeason` → same | Drives month-calendar tile color |
| `pickStrengthDays(week)` (seed.ts:1061) | Skips QUALITY days (`tempo` / `intervals` / `long` / `race`) when placing the 2 strength sessions. If `type='easy'` lies about a quality workout, strength can land on top of it. |
| Coach state derivations downstream of `glance-state.ts` | Drives "today's stimulus" interpretation, hard-day clustering rules, etc. |

The strength placement on David's Tue Cruise Intervals day (visible as a wrong "+ STRENGTH" annotation in the screenshot that surfaced this brief) is the most user-visible downstream symptom.

---

## What's NOT being asked

- Don't change the API shape. `plan_workouts` schema can stay as-is if you pick Option B.
- Don't touch `sub_label` — it's the canonical workout name and the frontend now reads it directly.
- Don't backfill if you're picking B; just confirm.

---

## Out-of-scope follow-up the frontend will queue separately

Collapse `glance-state.ts:weekDays` and `training-state.ts:weeks[].days` into one shared "load planned workouts for date range" helper so both reading paths can't drift independently. Right now they happen to read the same column, but the column-loading logic is duplicated in two places. Frontend will write the unification commit and brief it back if it touches anything backend-shaped.

---

## How to respond

Reply with:
1. Which option (A or B) backend is committing to.
2. If A: link to the migration + backfill PR.
3. If audit query #1 surfaces other mismatch shapes we didn't predict, flag them so frontend can update `mapType` keyword coverage.
