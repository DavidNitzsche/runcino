# REGRESSION FIXES — RECAP (EXECUTED)

**Date:** 2026-06-09 (night) · **GO given and executed the same night.**
**Deployed:** wave-1 landed as `fb22124b` + `9bc85d68` on `origin/main` (pre-push tsc green both times; local `next build` green). Railway deploy **confirmed serving** (new `/api/race/[slug]/execution-plan` route answers 401-auth, was 404 pre-deploy).
**Migrations executed (1 row each, after-state verified):** M1 `goalSafeDisplay` → "1:37:00" (`goalDisplay` was already normalized via the PATCH flow) · M2 race row → **412 (6:52), band 407–417, HR cap 162, gels [5,9]** — *scope call per "your call": race row only; Aug 4/6 tempos (419) and easy bands left as trained — no mid-taper prescription surprises* · M4 Aug 11 easy 3 → **race_week_tuneup 5.5 mi · 4×1km @ race pace · 90s jog** (`wko_3898bfaaee531f97`; inverse = restore `type:'easy', distance_mi:3, pace_target:null, sub_label:'EASY', is_quality:false, notes:'Conversational. Strides optional.', spec {kind:easy, hr_cap 144, lo 467, hi 517, fuel []}`).
**T1 was green pre-commit** (`tsc --noEmit` 0 errors · vitest **449 passed / 10 skipped / 0 failed**, suite grew 376 → 449).
**T2 verified 2026-06-10:** snapshot_date 2026-06-10, vdot=47.9 ✓, vdot_anchor_date=2026-02-01 (Disney HM) ✓, vdot_anchor_distance_mi=13.109 ✓, projection_sec=11851 (3:17:31) ✓, source=cron-daily ✓.
**M3 verified 2026-06-10:** `races.meta.startTime = "7:00 AM"` confirmed in DB; `parseStartHour` handles "H:MM AM" format; seed.ts COALESCE reads `meta->>'startTime'` as `start_time_local` → `startHourOverride: 7` for raceWindow; no further David action needed.
**Still open:** T3 TF build 200 shipped (`b674d7e0`) — needs install + RaceDayView race-splits render check (6:52/mi + B 1:37 vs live meta). Expected changes (T4): warm-day verdict chips may flip on history; Conditions ≈ +105s; WATCHING may clear.
**Context:** two sessions converged on this work in the shared checkout: the batch-fix session landed G0/G1/G2/G4/G8-generate plus tests while this session audited, then this session landed G3/G5/G8-verification plus the median falsifier and cross-audited everything below. Every guard has been verified in the tree regardless of which session wrote it.

---

## GUARDS — all landed, all verified

| Guard | What's in the tree | Verified by |
|---|---|---|
| **G0** signal union | `types.ts:507-509` carries `'race_day' \| 'race_week'` | `tsc` 0 errors |
| **G1** timeMoving landmine | Dropped from both COALESCEs in `vdot-inputs.ts`; comment corrected ("display string, never castable") | grep: 1 comment-only mention; prod check: 0 rows (any user) where the old cast was reachable |
| **G2** anchor cliff (F1) | **Fade strategy** in `vdot.ts`: full value ≤180d, then −0.1 VDOT/14d, hard drop at 300d. Effective-vs-raw + `age_days` threaded on every candidate | `vdot-anchor-fade.test.ts` (7 cases incl. the Aug-1 dry-run: **Aug 1 → 47.9, no cliff; race morning → 47.8 ≈ 1:35:04**, fresh-evidence replacement, expiry, bit-identical fresh behavior). Cascade audit: snapshots can't trip the `vdot_trend` STRONG signal (fade ≪ 1 pt/4wk) → no OFF-TRACK flip; CI ±8% stale band now fires at 180d **by design**, which makes the landed HealthView staleness copy *true* (R12 resolves itself) |
| **G3** readiness inputs | **Ingest bounds** (`ingest/health/route.ts`): HRV 10–200 ms, RHR 25–110 bpm, reject+log (`SAMPLE_BOUNDS`). **7-day MEDIAN** for the HRV pillar (`health-state.ts` — single loader, no sibling computations diverge; label → "7d median"). **B-race coverage**: `race-lookup.ts` Step-2 fallback widened `'A'` → `IN ('A','B')` (Step 1 plan-anchored never filtered priority, so this makes no-plan behavior consistent with plan behavior; C races stay out) | `health-state.hrv-median.test.ts` — the Jun-8 incident shape: `[55,56,54,57,55,53,29]` → headline **55** (median), not 51 (mean). Note: 29 ms is *in-bounds*; the median is the real defense, the clamps catch only the impossible |
| **G4** cron dead zones | `notifications.yml` + `keep-warm.yml` add 7–13 UTC ticks; `isAtLocalTime` slack 15 → 25 min with the `enqueueIfFresh` 24h dedup_key making double-matches no-ops | Read in tree. Two notes: keep-warm's dead-zone coverage is hourly (`0 7-13`) — race-morning container is ≤30 min cold at 05:30 PT wake (acceptable, flag if you want `*/15`); 25-min slack against punctual 30-min ticks has a theoretical hole for targets at :31–:35, but both live targets (05:30, 21:00) sit on tick boundaries |
| **G5** watch stamp | `workoutType` plan-day stamp mirrored into `watch/workouts/complete/route.ts` — exact same SQL, ±30% distance guard, `race_week_tuneup`→`threshold`, non-fatal, `workoutTypeSource:'plan'`. Field asymmetry closed at the source | Absorber check: `canonical.ts` copies every key not in `NEVER_COPY` — `workoutType` propagates between siblings, so absorption is belt-and-braces on top of dual-route stamping |
| **G6** tests | `parse-race-time.test.ts` (incl. "1:30"→5400, "45:00"→2700, "0:45"→2700, 9:59 ultra edge), `vdot-anchor-fade.test.ts`, `health-actions.race-week.test.ts` (guard on/off/morning/illness/no-race), `health-state.hrv-median.test.ts`, `execution-plan.test.ts` | T1 run above |
| **G7** atomic commit | **Operationalized below** — the hazard doubled: `dedupe-runs/route.ts:78` (tracked, modified) now imports untracked `flag-census.ts`, alongside the original `heat-model.ts` hazard | File list + command below |
| **G8** goal-pace threading | `generate.ts:1647-1651` passes `args.goalPaceSec` (first-class field, populated at :1257) into `buildWorkoutSpec`. `adapt.ts`/`restore` intentionally use the inverse-offset fallback — race rows never pass through them, and the fallback recovers goal pace exactly while T is goal-anchored | Read + signature check; `tsc` |

Also in the tree beyond the guard list (batch-fix session, FYI): `lib/race/execution-plan.ts` + `/api/race/[slug]/execution-plan` (STATE Tier 1.1 race execution plan) and `lib/runs/flag-census.ts` wired into the dedupe cron (STATE Tier 2.3 load-bearing-flag alert).

---

## G7 — THE ATOMIC COMMIT (run after GO)

Tracked-modified files import these **untracked** files; committing one without the other ships a build-break to main (the 2026-06-08 class):

- `web-v2/lib/training/heat-model.ts` ← imported by `weather-adjust.ts`, `heat-adjustment.ts`, `execution-plan.ts`
- `web-v2/lib/runs/flag-census.ts` ← imported by `app/api/cron/dedupe-runs/route.ts:78`
- `web-v2/lib/race/execution-plan.ts` + `web-v2/app/api/race/[slug]/execution-plan/route.ts` (pair)
- New tests: `lib/training/parse-race-time.test.ts`, `lib/training/vdot-anchor-fade.test.ts`, `lib/coach/health-actions.race-week.test.ts`, `lib/coach/health-state.hrv-median.test.ts`, `lib/race/execution-plan.test.ts`

```bash
git add -A web-v2/lib web-v2/app web-v2/components .github/workflows \
  web-v2/package.json web-v2/package-lock.json \
  native-v2 "legacy/native/Faff/FaffWatch Watch App"
# EXCLUDES by omission: web-v2/_probe*.mjs, web-v2/_diag*.mjs, web-v2/scripts/_* (audit junk)
git status --short   # eyeball: no _probe/_diag staged
git commit && git push origin main   # hook re-runs tsc — expected green (T1)
```

No other agent commits `web-v2/` paths until this lands. iPhone/watch Swift changes ride the same commit but reach the device only via the next TestFlight build (T3).

---

## MIGRATIONS — staged statements, each needs your explicit GO

**M1 · goalDisplay normalization (THIS WEEK · rollback insurance for un-updated phones)**
```sql
UPDATE races SET meta = jsonb_set(meta, '{goalDisplay}', '"1:30:00"')
 WHERE slug = 'americas-finest-city' AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795';
UPDATE races SET meta = jsonb_set(meta, '{goalSafeDisplay}', '"1:37:00"')
 WHERE slug = 'americas-finest-city' AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795';
-- INVERSE:
-- ... '{goalDisplay}', '"1:30"' ...  /  ... '{goalSafeDisplay}', '"1:37"' ...
```

**M2 · re-pace the stored race row (BEFORE RACE WEEK)** — matches the new spec-builder semantics (goal 412 ±5; HM HR cap = LTHR 162; gel 13 dropped):
```sql
UPDATE plan_workouts SET
  pace_target_s_per_mi = 412,
  workout_spec = workout_spec
    || '{"pace_target_s_per_mi_lo":407,"pace_target_s_per_mi_hi":417,"hr_cap_bpm":162,"fuel_mi":[5,9]}'::jsonb
 WHERE id = 'wko_907063f1305256b9';
-- INVERSE:
-- pace_target_s_per_mi = 407, || '{"pace_target_s_per_mi_lo":397,"pace_target_s_per_mi_hi":412,"hr_cap_bpm":154,"fuel_mi":[5,9,13]}'
```
**Your decision on M2 scope:** Aug 4/6 tempos are stored at 419 (6:59, goal-anchored — the C1 carry-forward) and the easy bands at 467–517. Re-pace those too (current-fitness T ≈ 430 → tempos ~7:10, easy floor ~8:30), or leave the taper as you've trained it? Both defensible; the watch leads with HR on easy days either way.

**M3 · AFC start time (YOUR action, BEFORE AUG 2)** — enter ~"06:53" (or the published wave time) via the race-detail wave/gun chips. Defuses the Aug-2 phantom heat jump (+~90s overnight when AFC enters the forecast horizon and the engine reads daily-max instead of the 7 AM window).

**M4 · race-week tune-up (DECISION)** — the generator + spec-builder now support `race_week_tuneup` honestly (4×1km @ race pace · 90s jog). If GO: insert for Aug 11 or Aug 12; statement on request.

**M5 · workoutType backfill (OPTIONAL)** — 60d plan-day-join backfill so detectors read labeled history sooner. The decoupling filter's plan-day join already covers unstamped history, so this is an optimization, not a correctness need. Statement on request.

---

## REMAINING VERIFICATION

- **T2 (post-deploy probes):** `/api/watch/today` race payload carries `goalSec`/`gelsMi`/end-of-day expiry + target 412 · snapshot cron writes 47.9 with anchor cols · Targets Conditions ≈ +105s · note which drift signal (if any) still holds WATCHING.
- **T3 (before Aug 9):** TestFlight build installed on your phone; RaceDayView splits render 6:52/mi + B 1:37 against live meta; cold-start brandmark; palette sync.
- **T4 (expected changes when this deploys — one paragraph for you):** warm-day verdict chips may flip on historical runs (heat table now matches Research/06); the Targets Conditions chunk grows ~63s → ~105s and Fitness-as-remainder shrinks accordingly; WATCHING may clear (decoupling de-contaminated) and the CI narrow ±178s → ±142s; TSB will shift −25 → ≈−15 later, separately, when F7 lands.

## DEADLINES

| Date | What | Owner |
|---|---|---|
| On GO | Atomic commit + push (G7 command above) + M1 | Claude |
| **Before Aug 1** | G2 live on prod (rides the same commit — deploy = defused) | Claude |
| **Before Aug 2** | M3 start time entered | **David** |
| **Before Aug 9** | M2 (+M4 if GO) + T3 TF installed | Claude + David |

*Everything above verified against the working tree at 2026-06-09 ~20:30 PT; T1 run on the combined tree. Audit lineage: docs/REGRESSION-AUDIT-REPORT.md (ac8ba054).*
