# Backend response to iphone-hk-splits-regression-RESOLVED + sleep bucketing fix

**Status**: SHIPPED · commit 97b6f6f0 · live on Railway after deploy
**Closes**: alignment gap David flagged after iPhone build 162 (sleep bucketing fix bb0671c1)
**Splits**: confirmed aligned — observability hook in place, no backend change needed
**Sleep**: real bug found and fixed — the ingest route was silently dropping every re-sync correction

---

## Splits (your auto-pause fix · build 162)

Everything in `designs/briefs/iphone-hk-splits-regression-RESOLVED-2026-06-05.md` lines up with what the backend should see post-fix. No code change needed on this side.

**Backend already does what you described:**

- `splits_unreliable=true/false` lives on `runs.data->>'splits_unreliable'` (set in `app/api/ingest/workout/route.ts:191-198` per the validator from round 71)
- `splits_validation.{deltaS, splitsSumS, durationS, droppedCount}` lives on `runs.data->'splits_validation'`
- The 5s reconciliation tolerance is the gate at line 504 (`reliable = Math.abs(deltaS) <= 5`)
- `source` stays `apple_watch` for the HK row, `watch` for the Faff watch row

**Confirmed your hypothesis on the negative-delta row:** the 2026-05-29 row with `n=1, deltaS=-66` is the watch-source row (NOT the HK row), and it's the legacy single-phase stub from before `fe6ef28b`. The HK loser for that night had `splits_unreliable=true` with positive delta, same as the others — got absorbed into the canonical watch row carrying its unreliable flag forward. Pre-fix, n=1 was the watch's stub; post-`fe6ef28b` writes the same shape lands without that stub. Both stories now agree.

**Probe to confirm on production**, slightly tightened against the columns we actually have:

```sql
SELECT
  data->>'source'                                AS source,
  jsonb_array_length(data->'splits')             AS n_splits,
  data->'splits_validation'->>'deltaS'           AS delta_s,
  data->>'splits_unreliable'                     AS unreliable,
  data->>'date'                                  AS run_date,
  data->>'startLocal'                            AS started_at
FROM runs
WHERE COALESCE(user_uuid, user_id) = $1::uuid
  AND data->>'source' = 'apple_watch'
  AND (data->>'date')::date >= '2026-06-05'
ORDER BY (data->>'date')::date DESC, data->>'startLocal' DESC
LIMIT 10;
```

(Web-v2 stores Strava-tied identifiers in `data`, not promoted columns · `started_at` / `source` aren't top-level columns on `runs` so the brief's example query 500s as written.)

---

## Sleep (your bucketing fix · build 162) · backend was broken too

Reading the bucketing-fix commit (bb0671c1) prompted a direct DB probe of David's sleep_hours and stage minutes. Here's what I found:

**Today's row, post-fix-deploy but pre-runner-re-sync:**

```
2026-06-05  sleep_hours = 6.8h   src=apple_health  recorded_at=2026-06-05 06:37:51Z
2026-06-05  stage minutes:
              sleep_light_minutes  280   (n=1)
              sleep_rem_minutes    119   (n=1)
              sleep_deep_minutes    10   (n=1)
              sleep_unspecified     0    (n=1)
              sleep_awake_minutes   34   (n=1)
            sum = 443 active sleep min = 7.38h
            (or 409 excluding awake = 6.82h · matches the 6.8h headline)
```

That sync at 06:37 UTC = 23:37 PT (Thursday night) landed BEFORE build 162 shipped at 10:42 PT Friday. So the value above is still the old-bucketing one.

**The real backend bug your sleep fix surfaced:**

`app/api/ingest/health/route.ts` had a `WHERE NOT EXISTS` check followed by an `INSERT`. The underlying UNIQUE INDEX is on `(user_id, sample_type, sample_date)` — three columns, not four (recorded_at is NOT in the index despite being in the existence check). When the iPhone re-syncs the SAME night with a CORRECTED value:

1. `WHERE NOT EXISTS` was checking 4 keys including recorded_at → check passes (new recorded_at differs)
2. INSERT fires
3. UNIQUE INDEX (3 keys) trips constraint violation 23505
4. Catch block treated 23505 as "idempotent dedup" and incremented `skipped`
5. **The corrected value was silently dropped**

This affected every nightly-aggregate sample type, not just sleep_hours:

> sleep_hours, sleep_deep_minutes, sleep_rem_minutes, sleep_light_minutes,
> sleep_awake_minutes, sleep_unspecified_minutes, sleep_in_bed_minutes,
> hrv, resting_hr, hr_recovery, vo2_max, max_hr, body_mass, body_fat_pct,
> lean_mass, cadence, spo2, respiratory_rate, wrist_temp, active_energy,
> ground_contact_time, vertical_oscillation, vertical_ratio, stride_length,
> run_power, menstrual_cycle_day, menstrual_cycle_phase

Every iPhone-side correction to any of these would have been silently dropped on the runner's next re-sync. Your bucketing fix was correct end-to-end; the backend just wouldn't accept the new value.

## The backend fix (shipped commit 97b6f6f0)

Replaced the WHERE-NOT-EXISTS + catch-23505 pattern with proper UPSERT:

```sql
INSERT INTO health_samples (user_id, user_uuid, sample_type, value, sample_date, recorded_at)
VALUES ($1, $1, $2, $3, $4::date, $5)
ON CONFLICT (user_id, sample_type, sample_date) DO UPDATE
   SET value       = EXCLUDED.value,
       recorded_at = EXCLUDED.recorded_at,
       user_uuid   = COALESCE(health_samples.user_uuid, EXCLUDED.user_uuid)
   WHERE health_samples.source IS DISTINCT FROM 'manual'
RETURNING id, (xmax = 0) AS was_insert;
```

Two policy layers in one statement:

1. **HK re-sync wins** for `source='apple_health'` rows · last write is authoritative · runner's iPhone is the source of truth for HK-derived aggregates.
2. **Manual entries are protected** via `WHERE source IS DISTINCT FROM 'manual'` · `/api/health/manual` writes `source='manual'`, those rows survive HK re-syncs (runner's explicit override sticks).

`RETURNING (xmax = 0) AS was_insert` lets the response metrics separate new INSERT (`inserted++`) from re-sync UPDATE (`skipped++`). Only true INSERTs count toward `insertedSignal` so nightly re-syncs don't trigger an LLM regen.

## What you should see post-fix

For David's 2026-06-05 sleep_hours specifically, on next iPhone HK re-sync from build 162:

1. **sleep_hours** flips from 6.8 → ~7.92 (matches HK Apple Health "Time Asleep" 7:55)
2. **sleep_deep_minutes** picks up the 10pm–12am Core block David QC'd → likely jumps from 10 → 29
3. **sleep_light_minutes** picks up most of the pre-midnight Core → likely jumps from 280 → 309
4. **sleep_rem_minutes** likely jumps from 119 → 137
5. All four rows have `recorded_at` updated to the re-sync timestamp

The probe to confirm:

```sql
SELECT sample_date::text AS night,
       sample_type,
       value,
       source,
       recorded_at::text AS synced_at
  FROM health_samples
 WHERE COALESCE(user_uuid, user_id) = $1::uuid
   AND sample_type LIKE 'sleep_%'
   AND sample_date = '2026-06-05'
 ORDER BY sample_type;
```

Pre-fix today's row: `sleep_hours=6.8`, stage sums to 443min, mismatch with HK.
Post-re-sync: `sleep_hours≈7.92`, stage sums to 475min, matches HK Time Asleep 7:55, `synced_at` reflects the build-162 re-sync.

## Suggested iPhone-side action

After your runner re-syncs on build 162, the corrected values land automatically — no separate backfill cron needed.

If you want belt + suspenders: when build 162 first launches for a runner, fire one explicit re-import of the last 14 days of sleep + per-stage samples. That guarantees the entire visible 14-day Health chart picks up the corrected bucketing on day one of the new build instead of trickling in night by night. Same shape as your splits re-walk (`importIfConnected(daysBack: 3)`) but extended to 14 for sleep history.

I'd recommend the explicit re-import — David noticed the discrepancy on a single night, but the same off-by-one bucketing was running on every night in his history. One-time re-walk gets the chart fully clean.

## Doctrine for the iPhone sync ledger

You've already proposed a row for the splits fix. Adding parallel rows for the sleep fix would make this a clean entry:

```
| 162 | bb0671c1 | HK sleep bucketing attributes samples by startDate's PT
                  wall-clock hour (>=18 PT → next morning, <18 PT → same
                  morning) instead of by endDate's calendar day. Pre-fix,
                  pre-midnight Core/Deep blocks were attributed to YESTERDAY's
                  morning bucket; iPhone saw only the post-midnight half of
                  every night. Aligns with backend upsert fix 97b6f6f0
                  (route accepts corrected nightly values on re-sync). |
| backend | 97b6f6f0 | /api/ingest/health UPSERT semantics · ON CONFLICT DO
                  UPDATE WHERE source IS DISTINCT FROM 'manual'. Was: silent
                  23505 catch dropped every re-sync correction. Now: HK
                  corrections land, manual overrides stick. |
```

And the doctrine principle for the SYNC LEDGER's DOCTRINE section, since this is the same pattern as splits ("missing data hidden by fallbacks"):

```
Nightly aggregate samples (sleep_hours, sleep_*_minutes, hrv, resting_hr,
vo2_max, etc · anything with a `sample_date` and not a sub-day time
component) MUST be ingested via UPSERT keyed on (user_id, sample_type,
sample_date). HK re-syncs deliver CORRECTIONS, not just replays — silent
dedup-on-23505 is the wrong semantics. The corrected value wins;
source='manual' rows are the explicit protected override.
```

## Cross-cite

Closes the same Pattern 1 ("missing data hidden by fallbacks") for sleep, same as your splits brief closed it for per-mile data. Two independent symptoms of the same anti-pattern, both surfaced by your `splits_unreliable=true` observability instinct — keep flagging signals when something feels off, the hook earns its keep.

---

**Pinging Pattern 1 doctrine for the audit ledger**: nightly aggregates now use UPSERT, splits surface `splits_unreliable=true`, the same observability + corrigibility doctrine applies to any future per-day-per-type sample the iPhone learns to derive.
