# Brief · iPhone · Form metrics ingest regression (BUG)

**For:** iPhone agent
**From:** backend
**Date:** 2026-06-03
**Status:** Bug · iPhone regression on or around 2026-05-25
**Priority:** P1 · runner-visible · GCT/Vert Osc/Vert Ratio/Cadence/Stride/Power tiles all dependent

---

## Symptom

David's Health page shows GROUND CONTACT, VERTICAL OSC, VERT RATIO as
populated *but* the values are stale. The Apple Health app on his
phone shows fresh data (yesterday avg 9.7cm, today avg 10cm for
vertical oscillation). The backend has 0 samples for these types
after 2026-05-25.

The fix backend-side (the SQL bug in `seed.ts` that was silently
catching a `text = uuid` mismatch) shipped in commit `843833d3` and
got the existing data to render again. But the data itself stopped
flowing six runs ago.

## Confirmed pattern

```
sample_type            | n   | last_seen
────────────────────────┼─────┼─────────────
ground_contact_time    | 135 | 2026-05-25
vertical_oscillation   | 135 | 2026-05-25
vertical_ratio         | 135 | 2026-05-25
stride_length          | 135 | 2026-05-25
run_power              | 177 | 2026-05-25
cadence                | 135 | 2026-05-25
```

All six form metrics stopped on the same calendar day. Everything
else (HRV, sleep, RHR, max_hr, hr_recovery, wrist_temp, spo2,
vo2_max, active_energy, body_mass, sleep stages, etc.) is still
flowing every day. So this is a regression in the form-metrics
ingest path specifically · not a global HK auth or sync break.

David's workouts since May 25 are tagged via Strava + watch (cadence
on the run-row itself is still populated · 162 spm visible in the
runs.data->>'avgCadence' field). HK form samples just aren't being
written.

## What we need

1. Open the iPhone build deployed around 2026-05-25 (commit history
   on the iOS repo). Diff the form-metrics ingest code path against
   the build before it.

2. Most likely culprits:
   - The HK query for these sample types was removed or moved behind
     a feature flag that's off
   - A renamed Swift symbol broke a query (HKQuantityTypeIdentifier
     name changes between iOS versions occasionally)
   - The query is firing but the payload's `sample_type` string
     doesn't match what backend expects · backend's allowlist is:
     `ground_contact_time`, `vertical_oscillation`, `vertical_ratio`,
     `stride_length`, `run_power`, `cadence`. If iPhone is sending
     `verticalOscillation` (camelCase) or `HKQuantityTypeIdentifier-
     RunningVerticalOscillation` (raw HK identifier), backend silently
     skips them. Worth grepping the iOS code.

3. Run the watch + iPhone for a run today → check the `POST
   /api/ingest/health` payload in your console / Charles Proxy logs ·
   does the `samples` array include any of the six types? If yes, what
   `sample_type` string are they using?

## Backend reference

Allowlist lives at `web-v2/app/api/ingest/health/route.ts` lines
34-51. Any `sample_type` not in that set is silently skipped (the
endpoint returns `inserted` + `skipped` counts in the response · if
the iPhone is logging the response on each sync, the `skipped > 0`
case would have surfaced this).

If iOS naming changed and you'd rather rename backend than iPhone,
add the new strings to that allowlist (backend deploys faster). If
you'd rather match what backend expects, send the kebab/snake names
above.

## Test plan

- Force-sync HK after the fix · check `health_samples` for any of the
  six types with `sample_date >= '2026-06-03'`
- Confirm Health page tiles render fresh values (currently stuck on
  the last May-25 sample)
- Diff today's HK ingest payload (iPhone-side log) vs the May-22 build
  to catch the regression directly

---

## Citation

DB probe `web-v2/probe-form-last.mjs` (one-off, run 2026-06-03). Spec:
backend allowlist + the SQL fix in `843833d3`.
