# Brief · iPhone · ship calories on watch payload + fix HK active_energy time-series ingest

**For:** iPhone / watch app agent
**From:** backend
**Date:** 2026-06-01
**Status:** Ask · backend already has read-time fallback (estimator) but
real source data would replace it

---

## TL;DR

Today's run shows calories `·` (empty) on the Today/EASY card. Root
cause: **no source in the system is shipping calories**.

- Watch payload doesn't carry `kcal`
- HK ingest sent **1 active_energy sample in 7 days** (should be ~180
  per run · HK ships per-15s buckets)
- Strava ingest works but isn't pulling Apple-Watch-only runs

Backend just shipped an estimator fallback (`distance × weight × 1.04
× hr_multiplier`) so the card won't be empty going forward · but real
on-device numbers would replace the estimate and be more accurate.

---

## Two fixes needed

### 1 · Watch payload should ship `kcal`

The Faff watch app writes runs via `POST /api/watch`. Add a `kcal`
field to the payload:

```ts
kcal: number  // total active calories from HK during the run
```

HealthKit computes `HKQuantityTypeIdentifierActiveEnergyBurned` for
every workout. The watch app already reads from HK · just include
the total in the payload.

When backend sees a `kcal` field on the payload, it skips the
estimator fallback and uses the real number.

### 2 · HK ingest should write `active_energy` as a time series

`POST /api/ingest/health` is the bulk health-sample sync endpoint.
Current state (from prod query):

```
sample_type           samples in last 7d
─────────────────     ─────────────────
hrv                   8     (1/day · correct)
resting_hr            8     (1/day · correct)
sleep_hours           8     (1/day · correct)
spo2                  8
respiratory_rate      8
max_hr                8
hr_recovery           3
active_energy         1     ← BUG · should be ~180 per run
```

`active_energy` is a time-series, not a daily scalar. HK ships
~15-second buckets. A runner who does 5 runs/week + walks should
have 1000+ active_energy samples in 7 days.

The fix is on the iPhone HK reader · when querying
`HKQuantityTypeIdentifierActiveEnergyBurned`, use a discrete-sample
query, not a statistics query that returns one aggregated sum:

```swift
// WRONG · gives one summed sample per day
let stats = HKStatisticsQuery(quantityType: .activeEnergyBurned, ...)

// RIGHT · gives every bucket as a separate sample
let samples = HKAnchoredObjectQuery(type: .activeEnergyBurned, ...)
// OR
let samples = HKSampleQuery(sampleType: .activeEnergyBurned, ...)
```

Each per-bucket sample should land in `health_samples` with:

```
sample_type     = 'active_energy'
value           = kcal in that bucket (e.g. 4.3)
sample_date     = bucket start date (YYYY-MM-DD)
recorded_at     = bucket start timestamp (millisecond precision)
```

Backend's `resolveCalories()` falls back to summing these in the
run's time window · so once buckets land, calories resolve via this
path even when the watch payload doesn't carry `kcal`.

---

## Priority ordering

If only one: **#1 (watch payload kcal)** is higher-leverage. One
field per run, one place to change. Solves the Faff-watch case
immediately.

#2 is needed for non-Faff-watch runs (Apple-Watch-only Workouts app,
treadmill, etc.) plus powers other features (calorie deficit, fueling
recommendations).

---

## What's already on the backend side

- `resolveCalories()` tier 3 estimator · `lib/coach/run-state.ts:810`
- Seed enrichment for Today card · `components/faff-app/seed.ts:enrichResultsWithRunData`
  (commit `c541cc13`)
- Validated formula · `distance_mi × weight_kg × 1.04 × hr_multiplier`
  matches Strava within ~5% on past runs

---

## What's NOT in this brief

- Weather absorption (canonical absorber not auto-firing on ingest)
  is a **backend** bug · not iPhone. Don't touch it.
- Estimator stays as cold-start fallback even after these fixes ·
  runners without weight in HK / new runners with no history use it.

---

## How to respond

1. Confirm payload shape change for `kcal` + ETA.
2. Confirm time-series fix for `active_energy` + ETA.
3. PR link when shipped · backend will verify by querying
   `health_samples WHERE sample_type='active_energy'` count goes up.

---

## Related

- `web-v2/lib/coach/run-state.ts` · `resolveCalories()` (tier 1/2/3 logic)
- `web-v2/components/faff-app/seed.ts` · `enrichResultsWithRunData`
- `web-v2/app/api/watch/route.ts` · where the watch payload lands
- `web-v2/app/api/ingest/health/route.ts` · where HK samples land
