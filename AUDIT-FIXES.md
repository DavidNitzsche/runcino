# Faff Backend Audit & Fixes
_Last updated: 2026-06-05_

Cross-session roadmap for the Faff backend correctness pass. **One cluster/leg per session, no-bundle.**

## Doctrine (applies to every item)
- Backend (Railway Postgres) is the single source of truth. No surface recomputes or locally stores a canonical value.
- Read-only by default via `DATABASE_URL_RO` (role `faff_readonly`, mechanically SELECT-only — verified: `UPDATE`/`CREATE` → permission denied). Superuser/write access only with explicit per-action go from David.
- "Done" = named falsifiers passing AND results shown to David. Never self-approve a deploy.
- **Build for any runner, not one runner.** Every architectural decision must be correct for any user. Personal data (David's HR, mileage, etc.) is used as a falsifier to VERIFY the architecture works — it is never the reason to make a design decision.
- **Cold-start = graceful empty state + guidance, never a crash or wrong value.** Any surface that displays a computed value (VDOT, max HR, LTHR, etc.) must degrade correctly when the user has no data. Template: show `'·'` (or equivalent empty marker) with a guidance message pointing the runner toward what action will populate it ("Run a race to anchor this." / "Connect a source for daily RHR."). Confirmed in Cluster 3 Item 2 — the first explicit any-runner cold-start validation in this audit. Apply to every new surface.
- **Falsifiers must verify data structures, not raw text.** Grep/regex against source code must target the actual data structure (set literal, array, SQL SELECT column list) — not raw file text. Comment text fools naive search (proved in Cluster 3 Item 4: `hrmax_observed` in a comment matched as if it were still in the ALLOWED set). Build AST-aware checks or scope regex to the exact structure being tested.
- **Deployment doctrine — approved fixes go to `main` (Claude executes the git, not David).** When a fix is approved (falsifiers passed, David reviewed, explicit go given): (1) commit immediately to the working branch with a clear message; (2) push the branch to origin; (3) merge to `main` and push `origin/main`; (4) confirm Railway deploys (the pipeline fires automatically on push to `main`); (5) run the cluster's smoke-check falsifiers **against prod** and report results. "Deploy through the normal pipeline" means **Claude does steps 1–5**, not David — David approves the fix + falsifiers, never the git push. An approved fix that isn't committed and pushed is NOT deployed: it's at risk of loss and prod runs the old code. **Never leave approved work uncommitted.** EXCEPTION — DDL / data writes (direct DB changes) still require David's explicit per-statement go before execution. Code deploys on approval; data writes need a separate explicit go.

## Report format (end every report with this block; full detail above it)
> **SUMMARY**
> - **WHAT CHANGED** — …
> - **FALSIFIERS** — pass/fail, one line each
> - **WHAT'S LEFT IN THIS LEG** — …
> - **WHAT I NEED FROM YOU** — approve / decide X / nothing

Update this file at the end of each leg.

---

## Cluster 1 — Volume source-of-truth  [CODE-COMPLETE + BACKFILL DONE 2026-06-05 · code deploys via normal pipeline]
- [x] **Backfill #1** — May 29 / May 31 dupes merged. 782.83 → **762.76**. VDOT 47.9 unchanged. 05-29 canonical = HK row (correct timestamp). DONE + verified.
- [x] **Backfill #2 (live-generated via isSameRun · 3 reviewed UPDATEs, superuser, verify-before-commit)** — 06-04 / 06-05 / 05-26 flagged. **762.76 → 755.15**; identity == fragile == **755.15 mi · 101 runs** (both readers, measured RO). 762.76 was NOT fully correct — it still counted the **05-26 P3-1 dupe** (apple_watch 7.61 over-measure, run count 102→101). Canonicals: 06-05 watch · 06-04 apple_watch (trust-flip) · 05-26 strava (correct 5.91). No unflagged dupes remain. Reversal: `data - 'mergedIntoId'` on the 3 loser ids. DONE + verified.
- [x] **isTrustworthy(3)** finalized against real per-source shapes → `{apple_watch, strava_webhook}` (apple_health/strava/legacy carry `Z` → covered by (1)).
- [~] **Fixes 1-4 diff** on branch `cluster1-volume-sot` (written; `tsc` 0 errors; 325/330 vitest — 5 fails pre-existing in `weather-adjust.test.ts`):
  - F1 autoMerge date from `startLocal` (watch/complete) — verified (evening-PT no-strand).
  - F2 `isSameRun` + `pickCanonical` in new `lib/runs/identity.ts`. **Falsifiers caught 2 bugs in the window-based start logic → REDESIGN to DST-aware UTC time-span OVERLAP (both-trustworthy) + tight dist+dur fallback (untrustworthy). Deletes the 10-min window + 30-min guard. Falsifiers GREEN (762.76 all readers · isSameRun 5/5 · tsc 0); awaiting David's review of the Phase-A diff.**
  - F3 one `mileageByDay` reader (`volume.ts`); `canonicalMileageByDay` + `recentMileageMi` now wrap it (Phase A).
  - F4a splits always-absorbed (tier-independent); F4b whole-run avgHr from phase samples.
  - DONE = falsifiers green (evening-PT no-strand · three readers @762.76 · constructed double not merged · isTrustworthy test · tsc/vitest) + diff reviewed by David + go to deploy.
- [x] **Phase B** — DONE (awaiting review). `getCanonicalRunIds` + `isoDaysBefore` added to `volume.ts`; **12 readers** swapped `NOT mergedIntoId` → `id = ANY(canonical-ids)`, each scoped to its existing window: log-state, voice-band, adapt, goal-projection, runner-calibration (counts+median), health-state, heat-acclimatization, decoupling-trend, pacing-discipline, recovery-phase (after/before), run-state:1156, training-state.
  - **Read-before-edit caught 2 mis-labels:** log-state has its own `bestByKey` dedup (was already 762.76, never 776.53) → drop-in proof required + passed; voice-band's `deduped` is for *races* not runs (its run-count is raw → plain migrate). Idempotent sub-queries left alone: recovery-phase anchor, training-state MAX-per-day, runner-calibration peakWeek.
  - **Skipped (provably idempotent, untouched in diff):** state-loader/glance-state/plan-week (canonicalMileageByDay), race-header/profile-state (MAX vdot), strength-recommender/training-form (MAX-per-day GROUP BY), recovery-brief/calibration/readiness-brief/state-loader (single most-recent), races-state (longest, MAX), run-state detail (by-id), pullSync/push (ingest/single).
  - **Falsifiers:** `tsc` 0 · vitest 325/330 (5 pre-existing weather) · log-state drop-in OLD `bestByKey` = NEW canonical = **102 runs / 762.76 mi**, 0 day-diffs · raw-count readers drop **104 → 102** (the 2 unflagged dupes count once) · identity reader 762.76 + isSameRun 7/7 unchanged.
  - **Deploy backfill — generated LIVE, not hardcoded.** At deploy, compute the dupe set fresh via the proven `isSameRun`: find ALL currently-unflagged dupes (May 29/31, Jun 4/5, + anything new run before deploy). Show David the full list + exact `UPDATE`s → approve → write via the write role. Same gated pattern as the first backfill, just computed live.
  - **⏱ Time-sensitive-ish.** New dupes accrue in prod every day undeployed — fragile readers now **776.53** vs correct **762.76** and drifting up. NOT an emergency (the identity reader is already correct), but each undeployed day adds another stray for the backfill to sweep. Deploy Fixes 1-4 reasonably promptly. **Dupe-rate caveat:** the unflagged-dupe frequency in this window (May–Jun 2026) is inflated by watch-app testing — NOT a normal-use signal. The *mechanism* is real (05-26 proves divergent-distance dupes occur), but the *frequency* is not representative; don't size normal-use dedup load off it.

## Cluster 2 — HR source-of-truth (display)  [CODE-COMPLETE + DDL DONE 2026-06-05 · code deploys via normal pipeline]
`loadEffectiveMaxHr` is authoritative for every user. `profile.hrmax_observed` was bypassing it — a bug for any user with that field set. Fixed:
- [x] **Fix A** — `profile-state.ts:348`: removed `p?.hrmax_observed ??` prefix + its `max_hr_source` branch; removed `hrmax_observed` from SELECT. `effMaxHr.bpm` is now first preference (as in every other caller). Note: `profile.hrmax_observed` still writeable/readable via `PATCH/GET /api/profile` — column survives, just no longer bypasses the resolver. Future Cluster 4 cleanup: remove from API contract if the column has no legitimate future use.
- [x] **Fix B** — `generate.ts:316`: replaced broken `SELECT max_hr FROM profile` (column doesn't exist → silent crash → LTHR-derived 176 fallback) with `loadEffectiveMaxHr`. Quality gate: 85%×176=150 → 85%×181=**154 bpm**. 6 gap runs (easy + aerobic long runs) correctly no longer auto-qualify.
- [x] **Fix C** — `state-loader.ts:24`: removed `hrmax_observed` from SELECT. Grep-confirmed: nothing in the coach state bag reads it downstream (fact-reciter reads `physiology.max_hr`, already resolved).
- [x] **Fix E** (carried from Cluster 1) — `identity.ts pickCanonical`: trustworthy-timestamp wins when dist/dur/splits equal. Dropped GUARD-A's ≥4h gap + `avgHr != null` requirements. The general rule: untrustworthy tier-winner + equivalent trustworthy alt → promote trustworthy. Applied to `cluster1-volume-sot` branch (where identity.ts lives; ships with Cluster 1). isSameRun 7/7 + identity reader 755.15 unchanged.
- [x] **Data/DDL** (executed 2026-06-05, superuser, snapshot-first, gated):
  - `UPDATE profile SET hrmax_observed = NULL WHERE hrmax_observed IS NOT NULL` — UPDATE 1 (pre-image: 0645f40c hrmax_observed=188). Reversal: `UPDATE profile SET hrmax_observed = 188 WHERE user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'`.
  - `DROP TABLE runner_profile` — FK refs 0, gone. Reversal: restore from backup if ever needed (no live data was in it beyond a single seed row).
- **Ratchet cron status — RUNNING correctly.** `users.max_hr=181` written 2026-05-31 by the nightly `snapshot-projections` cron (which calls `ratchetUsersMaxHr` inline). Dedicated fallback at `.github/workflows/max-hr-ratchet.yml` (`cron: 30 8 * * *`) also wired and deployed to `https://www.faff.run`. `projection_snapshots.last_run=2026-06-05` (ran today), 26 rows. `users.max_hr` stays 181 because `GREATEST(181, 181)` is a no-op — not silence. After Fix B deploys, `generate.ts` joins the chain; auto-update loop is complete. **Post-deploy verification item:** after David's next hard effort, confirm `users.max_hr` ratchets up to the new peak within 24h. If still 181 after a run that should have pushed it higher, investigate the ratchet cron. Note: my earlier "users.max_hr null for all users" was wrong — it was a LIMIT 5 query that didn't include David's row.
- **Falsifiers**: `tsc 0` (main + cluster1) · F1: resolver wins every user (bypass gone) · F2: gate=154 (correct, was 150) · F3: 6 gap runs 6/6 do not auto-qualify · isSameRun 7/7 + identity 755.15 unchanged

## Cluster 3 — Contract + endpoint + cadence  [CODE-COMPLETE 2026-06-06 · deploys via normal pipeline]
- [x] **Item 1 — Watch Codable contract:** iPhone `Models/Watch.swift` updated to match watch `WatchWorkoutModels.swift` exactly (added `kcal`, per-phase `actualDistanceMi`/`maxHr`/`avgCadence`, all Tier-1 fields `paceSamples`/`hrSamples`/`timeInToleranceSec`/`timeOutOfToleranceSec`/`verdict`, Tier-2 `repRpe`/`repRpeTag`). Added `WatchPaceSample`/`WatchHRSample` types. **Field diff = zero missing.** Backend `watch/workouts/complete` upgraded from `body: any` to typed `WatchCompletionBody` + `WatchCompletionPhaseBody` TypeScript interfaces. Note: iPhone structs are dead code for the relay path (raw bytes pass through); treadmill uses its own raw dict. Struct correctness matters for future iPhone-generated completions.
- [x] **Item 2 — Web VDOT + HRmax blank:** `PhysiologyBlock` switched from `/api/profile` (raw profile table — no vdot, no resolved max_hr) to `/api/profile/state` (computed values). `lthr_method` + `lthr_set_at` added to `/api/profile/state` response. `hrmaxLabel` updated to use `max_hr_source`. **Both VDOT and HRmax now show real values** (47.9 and 181 respectively, were blank). Cold-start: all tiles degrade gracefully to `·` with guidance messages — no crash, no wrong value.
- [x] **Item 3 — Stale cadence store:** `state-loader.ts` + `glance-state.ts` migrated from direct `health_samples.cadence` query (writing stopped 2026-05-25; would go null ~49 days from now) to the COALESCE pattern from `health-state.ts` (prefer `runs.avgCadence`, fall back to `health_samples.cadence`). NEW returns 160spm from live run data; OLD was returning stale 159spm and would eventually return null.
- [x] **Item 4 — hrmax_observed API cleanup:** removed `'hrmax_observed'` from PATCH ALLOWED set and `hrmax_observed` from GET SELECT in `/api/profile/route.ts`. iPhone `decodeIfPresent` → silent nil, no breaking change.
- **Falsifiers**: `tsc 0` (all 4 items) · iPhone struct field diff = zero · Tier-1 payload carry-through 8/8 · VDOT=47.9 + HRmax=181 both live (were blank) · lthr_method/lthr_set_at in /api/profile/state ✓ · cold-start degrades gracefully ✓ · cadence NEW=160spm (runs, live) vs OLD=159spm (stale health_samples) · hrmax_observed removed from ALLOWED + SELECT ✓

## Cluster 4 — Naming + dead code  [CODE-COMPLETE 2026-06-06 · deploys via normal pipeline]
- [x] **`deriveSplitsFromPhases` removed** — dead function in `app/api/watch/workouts/complete/route.ts`, never called after the 2026-06-04 decision to not write splits from phases. Replaced with a tombstone comment. `tsc 0`.
- [x] **`runner_profile` comment updated** — `lib/coach/biological-sex.ts` stale comment updated to note the table was dropped (Cluster 2 DDL 2026-06-05). Zero code impact.
- [~] **`strava_activities` VIEW rename — DEFERRED.** Zero TypeScript code queries `strava_activities` directly (confirmed: all SQL uses `runs`); the view is never hit by the application. Renaming is purely cosmetic — no correctness gain, no runtime impact. Risk: external tools / Railway dashboard queries that name the view would break. Logged as deferred infra cleanup; not worth a superuser write this session.
- **Falsifiers**: `tsc 0` · `deriveSplitsFromPhases` absent from codebase (grep: 0 call sites, definition deleted) · `runner_profile` comment updated · no live `strava_activities` SQL in application code confirmed.

## Cluster 1b — HK ingest durability (preserve `mergedIntoId`)  [DEPLOYED 2026-06-06 · commit e18c6659 · Railway auto-deploy fired · live falsifier PASS ✓]
**HK ingest durability — MAJOR:** HK re-sync does a full-replace of `data` jsonb (Rule 6 violation), wiping `mergedIntoId`. `autoMerge` re-fires on next cron/ingest and re-flags, but this creates a convergence window where fragile readers double-count and coaching signals see inflated run counts. **Durable fix:** HK ingest must do a field-level jsonb update preserving `mergedIntoId` (and any other backfill flags), not full-replace. This eliminates the window entirely. **Acceptance test:** a HK re-sync of a flagged run must leave `mergedIntoId` intact on the re-ingested row.
- **Severity: MAJOR** — not CRITICAL (the identity reader is correct throughout the window) but a real user-facing wrong-number period between re-sync and cron.
- **Self-heal confirmed — NO manual backfill (David, 2026-06-06).** The nightly `dedupe-runs` cron re-flags 05-31/06-01/06-02 on its next run with the deployed `isSameRun` + `autoMergeForDate(userId, body.date)` + `jsonb_set` (field-level). The 06-06 02:31 re-sync missed them only because it ran *pre-C1* `isSameRun`. Let it self-heal; the cron is the live test (re-check that fragile rejoins identity at 755.15 after it fires).
- **Evidence:** the 3 wiped rows all carry `ingestedAt=2026-06-06T02:31`; fragile reader 755.15 → 779.98 (+24.83 mi = 12.36+5.06+7.41), identity reader stayed 755.15 (read-time dedup robust — C1 thesis proven).
- **DEPLOYED 2026-06-06.** `ingest/workout/route.ts:272` — copy `existing.mergedIntoId` into `data` before DELETE-INSERT. tsc clean ✓. Live falsifier: SET flag → simulate DELETE+INSERT → verify survived: **PASS ✓** (mergedIntoId=-71141805277248 preserved end-to-end).
- **P3-2 (DONE — see below).**
- **P3-3 (logged — see below).**

## P3-2 — Weather enrichment wipes mergedIntoId (Rule 6 #2)  [DEPLOYED + BACKFILL DONE 2026-06-06 · commit b8ce2ea9]

**Root cause (REVISED — isSameRun is NOT the bug):** `isSameRun(apple_watch, watch)` returns `true` correctly for all pairs. `startUtcMs` uses `Intl.DateTimeFormat` with `DEFAULT_TZ='America/Los_Angeles'` — server timezone (UTC on Railway) is irrelevant. Initial isSameRun hypothesis was wrong.

**Actual bug:** `ingest/workout/route.ts` weather enrichment UPDATEs (Tier 1 line 370, Tier 2 line 398) fire **after** `autoMergeForDate` (line 296) sets `mergedIntoId` in the DB. Both used `SET data = $1` (full-replace) with the in-memory payload (no `mergedIntoId`). Overwrites the just-set flag. Rule 6 violation #2, same route.

**Cross-tab proof:** `weather_enriched=true + is_merged=false` = 7 rows (100% unmerged); `weather_enriched=true + is_merged=true` = 0 rows before fix.

**Fix:** `SET data = data || $1::jsonb` in both weather UPDATEs. `$1` never carries `mergedIntoId` as null (C1b guard ensures it's a valid BIGINT or absent). `||` is idempotent when C1b preserved the flag, and preserves DB-written flag when absent from `$1`. tsc clean ✓. Falsifier: autoMerge→weather||→flag survived PASS ✓.

**Backfill (4 statements, per-statement approved 2026-06-06):**
| date | loser | canonical | result |
|---|---|---|---|
| 06-05 | -2142575830045023 | watch -102539783518325 | merged via falsifier |
| 06-04 | -1483290537416636 | watch -271531781519189 | mergedIntoId set ✓ |
| 06-03 | -3858000542489904 | watch -99303583875384 | mergedIntoId set ✓ |
| 05-31 | -1466010895152803 | watch -16421550262950 | mergedIntoId set ✓ |
| 05-26 | -573194905917117 | strava 18690124384 | mergedIntoId set ✓ |
| 05-24 | -2045716995500221 | none | no peer — single-source, no merge |
| 05-20 | -3363396946462586 | none | no peer — single-source, no merge |

**Final cross-tab:** `weather_enriched=true + is_merged=false` = **2** (05-24, 05-20 — no peer, not a bug). `weather_enriched=true + is_merged=true` = **5**. Cross-tab target "drops 7→0" revised to "drops 7→2" because 2 are single-source runs with no pair to merge.

**Splits absorbed:** 05-31 (12 real GPS splits on watch canonical ✓), 06-03 (6 real splits ✓), 05-26 (1 split absorbed from apple_watch onto strava canonical ✓). 06-04 and 06-05 watch canonicals already had real splits or phase telemetry only — see P3-3.

**Rule 6 grep (post-fix):** `canonical.ts:243` + `pullSync.ts:388` both start with `{ ...canonicalData }` (read-modify-write) — NOT violations. No further Rule 6 instances in ingest paths.

## P3-3 — GPS per-mile splits absent on easy/long/recovery canonical rows  [LOGGED · depends on P3-2 + backfill]

**Symptom:** easy/long runs show "No mile splits available" even after P3-2 fix + backfill. Example: 06-04 canonical (watch) has 3 phase-telemetry splits with no `pace` field; apple_watch loser had 0 splits. Neither row carried real GPS splits.

**Root cause:** the iPhone's HK ingest (`/api/ingest/workout`) carries GPS per-mile splits from HKWorkoutRoute when the iPhone includes `route_polyline` AND the watch completion (`/api/watch/workouts/complete`) carries per-phase telemetry only. For some runs (easy/recovery/single-phase), the apple_watch row was re-ingested without splits (empty `splits: []`). Whether this is a gap in `HealthKitManager.buildRoutePayload` on the iPhone or a splits-validation drop needs investigation.

**What P3-2 fixed:** pairs now correctly merge → `enhanceCanonicalFromAbsorbed` can absorb real GPS splits when the loser has them. P3-3 is the remaining case where the loser also lacks GPS splits.

**Root cause confirmed 2026-06-06 (rounds 88–92):** The iPhone's `perMileSplits` reconciliation guard was the cause. The guard compared `sum(GPS-derived per-mile times) + leftover` vs `workout.duration`, but these two quantities measure different things: GPS uses `CLLocation.distance(from:)` (Haversine on raw GPS coordinates); the watch uses GPS+pedometer CoreMotion fusion. GPS drift of 1–3% on a 50-min run causes the GPS loop to complete N+1 full miles (e.g., the GPS 6-mile boundary falls at the watch's 5.89mi point), inflating `leftoverS` from ~5s to ~60s and producing a delta of ~55s — far outside any reasonable tolerance. All nine of David's runs from 2026-05-29 → 2026-06-06 landed with `split_count=0` due to this guard.

**Fix applied — round 92 (build 166):** Reconciliation guard removed entirely from `HealthKitImporter.swift:perMileSplits`. Two backstops remain: (1) per-mile pace gate `120s ≤ secs ≤ 3600s` inside the mile-emit loop; (2) server-side `validateSplitsAgainstDuration` in `/api/ingest/workout` which uses parsed pace strings (GPS-distance-independent) rather than raw GPS timestamps.

**Future improvement (not urgent):** GPS-distance normalization — scale `CLLocation.distance` accumulator by `workout.totalDistance / gpsTotal` before mile-marking so GPS drift doesn't shift where mile boundaries fall. This would make `leftoverS` accurate and would allow re-introducing a tighter reconciliation guard if desired. The current per-mile pace gate is sufficient without it.

---

## Audit A — Run Lifecycle Integrity (plan → watch → run → back)  [DONE · audit-only 2026-06-06 · 7 findings, 0 CRITICAL, 0 code/data writes]
**Highest-value audit for David as a runner.** A planned workout's data must stay true all the way around the loop, and plan vs actual must be comparable. Three legs, each verified end-to-end with real records.

- **LEG 1 — Plan → Watch (outbound):** `build-workout.ts` → `/api/watch/today` → `WatchSync` → watch face. The FULL prescribed workout — intervals, target paces, distances, rep structure, HR targets — arrives and executes on the watch exactly as the backend built it (not just the HR ceiling, already checked). "Plan says 6×800 @ 6:20" → watch runs exactly that.
- **LEG 2 — Watch → Backend (run comes back):** every field of what David ACTUALLY did survives the relay intact — splits, lap times, miles, per-split pace, per-split/per-rep HR, cadence, duration. KNOWN RISK: the watch row currently writes NO splits (Cluster 1 found this; Fix 4a forces split absorption) → per-mile/per-rep data is the most fragile field in the loop. Prove it makes it back, field by field, on a real run, AFTER Cluster 1 ships.
- **LEG 3 — Backend → display + reconciliation:** the completed run reads back correctly on web AND phone (same canonical numbers), AND actual-vs-planned is computable (did I hit the workout?). Verify plan target and actual result are stored in comparable units so "planned 6:20, ran 6:24" is computable.

**Falsifier standard:** take a REAL planned interval workout David ran; trace ONE rep's target pace from `build-workout` all the way to its actual recorded split back in the DB and on both display surfaces — every number accounted for.

**Depends on:** Cluster 1 (split absorption) + Cluster 3 (Watch Codable contract single-sourced) — both change legs 2 and 3.

### RESULT — 2026-06-06 (read-only via `DATABASE_URL_RO` as `faff_readonly`; no code/data writes; on `main`=49cd69f9 = 72cb69ae+1 doc commit)
**The loop holds. Plan-vs-actual IS computable + displayed per-rep.** No CRITICAL findings (nothing wrong/lost). 7 findings: 5 MAJOR (all in the *display/recap* layer, not the data relay), 2 MINOR.

**Falsifier — Rep 3 of the 2026-06-02 `4×1mi @ I` (target 389 s/mi = 6:29/mi), every hop:**
`plan_workouts.workout_spec.rep_pace_s_per_mi=389` → `expandReps` phase[5] `targetPaceSPerMi=389` → `/api/watch/today` workout.phases[5]=389 *(UNVERIFIED-by-exec; deterministic from code+DB)* → WatchSync lossless `JSONSerialization` round-trip *(UNVERIFIED-by-exec; source-confirmed)* → `WatchWorkoutModels` decode 389 *(UNVERIFIED-by-exec)* → **WatchCompletion phase[5] {target=389, actual=418, verdict=missed}** → **`coach_intents.value.phases[5]` (VERIFIED in DB)** → `loadPhaseBreakdown` → `phase_breakdown` {target_pace **6:29**, actual_pace **6:58**, status **slow**} on web+phone PLAN VS ACTUAL. "Planned 6:29, ran 6:58" is computable + shown per rep. The per-mile split that covers the same ground (mile 3 = 8:21) is NOT the rep pace → the per-mile layer can't reconcile reps; the coach_intents phase layer can.

**Leg verdicts:**
- **LEG 1 (outbound) — PASS w/ defects.** 9 phases reconstruct exactly (WU 1.5mi@502 → 4×[1mi@389 + 180s jog@540] → CD 1mi@502); distances, rep structure, rest intervals, paces all reach the watch. WatchSync forwards faithfully (JSON round-trip, not typed re-encode → no field drop). Cold-start graceful end-to-end (no plan → `{message:"No active plan."}` → `PhoneSync.apply` routes `noWorkout`, no crash). **HR target NOT forwarded for intervals** (hrCeilingBpm null for non-easy/long; `WatchPhase` has no HR field; spec `lthr_bpm=162` dropped — by design, pace-driven; flagged not filed). UNVERIFIED-by-exec: on-watch pixels, WatchSync forward, live authenticated HTTP (no token).
- **LEG 2 (inbound) — PASS, Fix 4a PROVEN.** Watch canonical (`-71141805277248`) carries the 7 real per-mile splits with `provenance.splits=apple_watch` → absorbed tier-independent from the HK loser exactly as Fix 4a intends. The `mergedIntoId`/`absorbed` disagreement (Cluster 1b) **self-healed live during the audit**: apple_watch row re-ingested `05:54:56` (`fetched_at`=`absorbed_at`) → `autoMergeForDate` set `mergedIntoId→watch` + re-absorbed; at my Phase 0 read it was still `merged=null, absorbed=02:31`. Confirms C1b "let it self-heal" + the deployed C1-aware `isSameRun`. Per-rep actuals are NOT on `runs` (by design, Cluster 4) — they live in `coach_intents`.
- **LEG 3 (display + reconciliation) — COMPUTABLE, but the headline layer is weak.** `phase_breakdown` (loadPhaseBreakdown ← coach_intents, by date) gives exact per-rep target/actual/status on **both** web + phone — self-contained (targets ride in the completion; no `planWorkoutId` FK needed, so `planWorkoutId=null` is not fatal). The `/recap` HEADLINE path is the soft spot (A3/A4). per-mile(7, unreliable) vs per-rep(9, clean) resolved: two separate primitives; the breakdown uses per-rep (right), the recap + MILE SPLITS use per-mile (A4/A5).

**Findings (any-runner lens; all MAJOR are display-layer, not data-loss):**
- **A1 · MAJOR · no stored outbound payload.** `/api/watch/today` builds live; `coach_today_cache` dead since 05-25. Zero server-side record of what was sent to the watch → no debugging artifact when the plan→watch handoff is wrong for ANY user. (`build-workout.ts`, `app/api/watch/today/route.ts`)
- **A2 · MAJOR · spec-driven payload ships wrong per-phase haptics.** `build-workout.ts:385` hardcodes `haptic:'start'` on every phase; patch at `:407-413` only fixes index 0 + final cooldown → all 4 reps + 3 recoveries ship `'start'`. Watch consumes it (`WorkoutEngine.swift:406/841`→`Haptics.swift`): plays identical `.start` buzz instead of `directionUp`(work)/`directionDown`(recovery). Primary path = EVERY spec'd quality workout, any runner. The fallback path (`stepToPhases`) sets haptics correctly.
- **A3 · MAJOR · recap reads the wrong planned-pace key.** `recap/route.ts:102` reads `workout_spec->>'pace_target_s_per_mi'`; structured specs store `rep_pace_s_per_mi`/`tempo_pace_s_per_mi` → `plannedPaceSPerMi` null for all intervals/tempo/threshold in the recap (the `plan_workouts.pace_target_s_per_mi` COLUMN=389 sits unread). Kills `winTempo` "held the line" + recap pace comparison. `phase_breakdown` unaffected (targets ride in the completion). Any runner, any structured workout.
- **A4 · MAJOR · win line fabricated from unreliable per-mile splits.** `deriveWin→winIntervals` runs `workSplitPaces` on `data.splits` (7 HK per-mile, system-flagged `splits_unreliable:true`) → "5 reps delivered" for a 4-rep session where 2 reps missed by ~30s. `/recap.win` ships to web CompletedHero + iPhone post-run card (CoachPayloads.swift:94) → contradicts the PLAN VS ACTUAL section on the same screen.
- **A5 · MAJOR · `splits_unreliable` set but never consumed by display.** `ingest/workout/route.ts:192` stamps `splits_unreliable`+`splits_validation` (06-02: deltaS=315, droppedCount=7, sum 3940s vs 3625s run); NO web display/recap/win path checks it. MILE SPLITS chart (web+phone) renders the known-bad per-mile splits as truth, and they feed `detectHrDrift`/`detectPaceFade`/`workSplitPaces`. Any noisy-GPS run.
- **A6 · MINOR · recap plan-match lacks archived filter.** `recap/route.ts:107-109` matches `plan_workouts` by date `ORDER BY authored_iso DESC` with NO `archived_iso IS NULL` (build-workout filters it). Latent: a more-recently-authored archived plan would mis-match. Not biting now (1 non-archived plan).
- **A7 · MINOR · `coach_today_cache` dead + no user column.** integer PK, no `user_uuid`, 0 readers, last write 05-25. Dead; if ever re-read it would be cross-user. Drop or ignore (confirmed dead per the user's instruction).

**WHAT'S LEFT:** nothing for the audit. Fix queue:
- **[DONE 2026-06-06] — A3+A4+A5 (recap layer):** See section below.
- **[DONE 2026-06-06] — A2 + HR-target-for-intervals:** deployed bead89bb. 9/9 prod smoke ✓. See section below.
- **DEFERRED — A1:** persist outbound payload for debuggability. Real but not urgent.

## Audit A — Fixes A3+A4+A5 (recap layer)  [CODE-COMPLETE 2026-06-06 · awaiting David's review + go to deploy]

**A3 — Planned-pace key fixed** · `app/api/runs/[id]/recap/route.ts:102`
- Was: `(pw.workout_spec->>'pace_target_s_per_mi')::int AS pace_target_s` — this key is NULL for all structured workouts (intervals/tempo/threshold store `rep_pace_s_per_mi` / `tempo_pace_s_per_mi` inside the spec, not `pace_target_s_per_mi`)
- Now: `COALESCE(pw.pace_target_s_per_mi, (spec->>'rep_pace_s_per_mi')::int, (spec->>'tempo_pace_s_per_mi')::int, (spec->>'pace_target_s_per_mi')::int) AS pace_target_s` — reads the column first (any-runner safe), then falls back through spec keys
- Also added `AND p.archived_iso IS NULL` to the plan match (A6 minor fix, matches `build-workout.ts` behavior)
- **Falsifier**: old=NULL, column_value=389, new=389 ✓

**A4 — Win line from phase data, not per-mile splits** · `lib/coach/run-win.ts` + `recap/route.ts`
- Was: `winIntervals` called `workSplitPaces(perMileSplits)` → took 5 fastest of 7 GPS miles → "5 reps delivered" for a 4-rep, 2-missed session
- Now: `recap/route.ts` loads `coach_intents.value.phases` for the run date (same query as `loadPhaseBreakdown`); `WinInput` gains optional `phases` field; `winIntervals` routes to `winIntervalsFromPhases` when phases are present, falls back to per-mile heuristic for non-Faff-watch runs (cold-start safe)
- `winIntervalsFromPhases`: majority-missed → null; clean sweep → "N on the rail"; near-miss majority → "N of M reps on target"
- **Falsifier**: 4 work phases (drifted/drifted/missed/missed), hits=0 drifted=2 missed=2, majority_missed=true → null ✓ (was "5 reps delivered")

**A5 — splits_unreliable gates recap heuristics + MILE SPLITS display**
- `recap/route.ts`: when `data.splits_unreliable === true`, passes `splits: undefined` to both `deriveRecap` and `deriveWin` → `detectHrDrift`/`detectPaceFade`/`winIntervals` fallback cannot fire on bad GPS data
- `lib/coach/run-state.ts`: `splits_unreliable` added to `RunDetail` interface and `loadRunDetail` return value
- `components/faff-app/overlays/RunDetailModal.tsx`: MILE SPLITS section gated on `!data.splits_unreliable`
- `components/faff-app/views/TodayView.tsx`: `RunSummary` type + MILE SPLITS fallback section gated — shows "GPS splits not available for this run." when flag set
- **Falsifier**: 06-02 canonical (id=-71141805277248 src=watch) has `splits_unreliable=true` + 7 splits in DB; `splitsReliable=false` → `splitsForRecap=undefined` → heuristics cannot fire; MILE SPLITS shows correct message ✓

**Files changed:** `app/api/runs/[id]/recap/route.ts` · `lib/coach/run-win.ts` · `lib/coach/run-state.ts` · `components/faff-app/overlays/RunDetailModal.tsx` · `components/faff-app/views/TodayView.tsx`
**tsc**: pre-push hook ran tsc on push to main → clean ✓
**Any-runner lens**: A3 COALESCE falls back through all known spec-key shapes; A4 falls back to per-mile heuristic for non-Faff-watch runs; A5 gates are boolean guards on optional field (falsy default = no gate for runs that never hit the ingest validator).
**Cold-start**: A4 → winPhases=[] → phases=undefined → legacy path. A5 → flag absent → splitsReliable=true → normal path. No crashes, no wrong values.
**DEPLOYED 2026-06-06** · commit `e9486282` on main · Railway auto-deploy fired ✓
**Prod smoke checks:** A3 plannedPace=389 non-null ✓ · A4 majority_missed→null (not "5 reps delivered") ✓ · A5 splits_unreliable gated ✓
**Display (Confirm 3):** TodayView: no MILE SPLITS card — note only: "GPS pacing not shown — splits couldn't be verified for this run." RunDetailModal: section hidden; same note inline. ✓

## Audit A — Fixes A2 + HR-target-for-intervals  [DEPLOYED 2026-06-06 · commit bead89bb on main · Railway auto-deploy fired · prod smoke 9/9 ✓]

**A2 — Haptic patch** · `web-v2/lib/watch/build-workout.ts`
- Was: `haptic: 'start'` unconditionally on every expanded spec phase; patch block only fixed index 0 and last cooldown → all 4 work reps + 3 recoveries shipped `'start'` → watch fired `.start` buzz for every interior transition
- Now: loop assigns haptic from `p.type` directly — warmup→`'start'`, work→`'transition-work'`, recovery→`'transition-recovery'`, cooldown→`'transition-cooldown'`. Patch block stays as idempotent guard.
- Fallback path (`stepToPhases`): unaffected — already assigns haptics correctly.
- **Falsifier:** 06-02 4×1mi session phases[1,3,5,7] (work) = `'transition-work'`; phases[2,4,6] (recovery) = `'transition-recovery'` ✓

**HR target for intervals** · `build-workout.ts` + `WatchWorkoutModels.swift` + `native-v2/Faff/Faff/Models/Watch.swift`
- Added `hrTargetBpm?: number | null` to `WatchPhase` TypeScript interface
- For `intervals/threshold/tempo` work phases: `workHrTargetBpm = workout_spec.lthr_bpm ?? profile.lthr ?? null`
- Easy/long work phases: `workHrTargetBpm = null` (those sessions use workout-level `hrCeilingBpm`)
- Warmup/recovery/cooldown: always `null`
- Both Swift structs (watch + iPhone) updated: `hrTargetBpm: Int?`, decodeIfPresent, encodeIfPresent, re-stamp pass-through
- **Falsifier:** 06-02 workout (DB: `lthr_bpm=162`, `profile.lthr=162`) → work phases `hrTargetBpm=162`; warmup/rec/CD `hrTargetBpm=null` ✓
- **Cold-start:** `lthr=null`, `spec.lthr_bpm=null` → all phases `hrTargetBpm=null` → nothing shown, no crash ✓

**Files changed:** `web-v2/lib/watch/build-workout.ts` · `legacy/native/Faff/FaffWatch Watch App/WatchWorkoutModels.swift` · `native-v2/Faff/Faff/Models/Watch.swift`
**tsc:** 0 new errors in changed files (pre-existing `process.env` node-types error on line 25 unchanged)
**Swift:** backward-compat via `hrTargetBpm: Int? = nil` default + `decodeIfPresent`; all existing fixture call sites unchanged

## Audit B — Architectural source-of-truth sweep  [NOT STARTED]
Enumerate EVERY value every surface (web/iPhone/Watch) displays or writes; prove each reads from backend, not local recompute/store. Flag every local recompute + bypassing write. Fresh session, Phase 0 pre-flight, read-only, falsify-don't-confirm. Depends on Cluster 1 done (consumes volume + VDOT).

## Audit C — Plan generation correctness  [AUDIT DONE · 2026-06-06 · read-only `DATABASE_URL_RO` · on main=2a2b7f42 · 0 code/data writes]
_(David referred to this as "Audit B" in the session prompt; filed here as Audit C per the doc taxonomy. Doc's old one-liner said "taper lands for CIM Dec 6" — stale; the active goal is AFC Half Aug 16. CIM has no active plan.)_

**Subject:** active plan `pln_ca91f252bba50c74` (race-prep · AFC Half · goal_iso 2026-08-16 · 77 workouts · canonical VDOT 47.9 · goal 1:30). Falsify-don't-confirm; every finding verified against real records.

**Headline:** the loop generates without crashing, the data is single-sourced (one `plan_workouts` table, one active plan, identical plan selectors), and the race anchor date is correct. But **pace prescription is wrong for every user**: the plan is anchored to GOAL pace, not current VDOT, because the current-fitness blend (Rule 3) is fed by two broken VDOT queries and silently no-ops. Six findings: 1 CRITICAL, 5 MAJOR, 3 MINOR.

### C1 · CRITICAL · paces track GOAL pace, not canonical VDOT — Rule 3 blend is structurally inert (any-runner)
All 77 rows derive from a single `tPaceSec` via fixed offsets (`spec-builder.ts`: easy T+60/+110, long T+55/+90→hdln 480, tempo T+12, threshold T, interval T−18). Every stored pace reconciles **exactly to T=407 = `tPaceFromGoal(1:30 HM)`** (race row 407; interval 389=T−18; tempo 419=T+12; easy 467–517; long 480). Current fitness `tPaceFromVdot(47.9)=430` (HM 1:34:54 → T 7:10) is **never used** → quality days are **~23 s/mi too fast** (interval 6:29 vs current-fit 6:52; tempo 6:59 vs 7:22; threshold 6:47 vs 7:10).
**Root cause:** `generate.ts` recomputes its OWN `bestRecentVdot` instead of reading canonical 47.9, and both candidate sources are dead:
- Race query `loadGeneratorInputs`→line 1773 `SELECT date_iso, distance_mi, finish_seconds FROM races` — **those columns don't exist** (races has `meta`/`actual_result` jsonb). Reproduced live: `column "date_iso" does not exist`. Wrapped in `.catch(()=>({rows:[]}))` → silently empty.
- Run query (line 1780) filters `workoutType IN (QUALITY_RUN_TYPES strings)`, but ingested runs carry **numeric/null** `workoutType` (David: 63×null, 22×'0', 2×'1') → never matches; and `max_hr` hardcoded `null` (line 1809) disables the HR fallback in `vdotFromRun`. Reproduced live: returns `[]`.
- Net: `bestRecentVdot=undefined` → `currentT=null` → `tPaceForWeek` returns `goalT` for all 11 weeks (proof: week-0 stored interval is 389=goalT−18, not 412=currentT−18 → blend never fired). `generate.ts` reads no other VDOT (no `projection_snapshots`, no `vdot_manual_override`).
**Contrast:** `cron/snapshot-projections/route.ts:54` reads `SELECT slug, meta, actual_result FROM races` (correct) and calls the SAME `bestRecentVdot()` → 47.9. The generator just feeds it broken inputs.
**Any-runner:** the broken races query throws for everyone; the numeric/null `workoutType` is what ingest writes for everyone → Rule 3 is inert for ALL users → every plan anchored to goal pace. **Threatens:** systematic over-prescription on every quality day (worse the further a runner is from goal — a beginner targeting an aggressive time gets wildly fast reps), and it manufactures the "missed reps" in C4.

### C2 · MAJOR · race week has no tune-up; last intensity 10 days out (any-runner)
Doctrine `Research/08 §9.3` HM race-week template prescribes **Tue: 4–5 mi w/ 4×1K @ HMP**; §9.1 "intensity is preserved through the taper"; §18.2 names "cutting all intensity in taper → sluggish legs." But `layoutWeek` race-week branch (`generate.ts:682–707`) hardcodes only race + shakeout + rest + easy ("strides optional"). Race week (Aug 10–16): easy 4/3/4/3 · rest · shakeout 2 · RACE. **Last fast running = Aug 6 tempo (10 days pre-race)** vs the doctrinal ~5. `spec-builder` has a `race_week_tuneup` type (2×0.5mi @ T−5) that `layoutWeek` **never schedules** (dead). Volume taper itself is fine (peak 64 → 54.5 → 46 → 29 incl. race). **Any-runner:** hardcoded → every plan, every distance. **Threatens:** flat legs on race day for a goal race.

### C3 · MAJOR · `last_adapted_at` is a no-op cron stamp — "adapted" doesn't mean changed (any-runner)
`run-adaptations/route.ts:114–120` stamps `last_adapted_at = NOW()` even when `applied === 0` ("the only cron-fire proof"). Active plan: `last_adapted_at=2026-06-06 06:32` but `adaptation_log=[]`, **zero `plan_mutations`** for its workouts, and all 76 `original_*` equal their authored values (no divergence). So "adapted today" = the cron ran and did nothing. **Threatens:** any surface showing "adapted X ago" misrepresents reactivity; masks adaptation gaps.

### C4 · MAJOR · no adaptation for completed-but-underperformed quality (any-runner)
The 06-02 `4×1mi @ I` (reps 3,4 missed by ~30s, per Audit A) triggered nothing. `detectMissedKeyWorkout` (`adapt.ts:566–584`) flags a key workout missed **only if no completed ≥4mi run exists within ±1 day** — 06-02 was completed (7.5mi) → not missed. The engine never inspects rep pace; there is no "underperformed" trigger (consistent with the gutted reactive coach layer). The actual 06-02 adaptation activity was for a **different reason**: 2 `plan_proposals`, both `volume_drift` (32.6 vs 20.1 mi/wk) + a goal-time string patch (`drift_cron_auto` / `race_patch_hook`) → superseded → rebuilds. **Consequence:** 06-16 + 06-30 re-prescribe the identical 389 target; the plan is static against repeated underperformance. Combined with C1 this is a closed loop: goal-pace targets → reps missed → no response → same targets re-issued.

### C5 · MAJOR · cold-start (any-runner; 7 real plan-less accounts as falsifiers)
The 7 non-David accounts: `onboarding_complete=false`, 0 races/runs/profile, level defaults `intermediate`.
- **With a goal time:** generates without crashing — volume from `max(VOLUME_FLOOR_MPW.intermediate, 0)`, paces at GOAL pace. But `bestRecentVdot` is structurally undefined (no history) and canonical VDOT isn't read → a brand-new runner is prescribed goal race pace blind (C1 at its most dangerous).
- **Without a goal time (latent, reachable):** `goalSec = parseGoalSeconds(meta.goalDisplay)` only (line 1738); **no 480 fallback** (line 1880), **no missing-goal guard**. `tPaceSec=null` → `buildWorkoutSpec` null-coercion → garbage paces (easy 60–110 s/mi, interval −18, tempo 12, race −10..5). `spec-builder.tPaceFromGoal` doc says callers "should fall back to a default (e.g. 480s/mi)" — `generate.ts` doesn't. Violates the cold-start doctrine (never a wrong value). **Reachability confirmed (2026-06-06 follow-up):** the race save route `app/api/races/route.ts` has **no goal requirement** (zero `goalDisplay`/`goalTime` references → stores client `meta` as-is), so a goal-less race is savable via the API; empirically 0/10 races lack a goal today → latent, reachable, not-yet-triggered.

### C6 · MAJOR · "today's workout" date math diverges across surfaces (any non-Pacific runner)
Data IS single-sourced: all three resolve the same active plan (build-workout `:280` and `loadActivePlan` use the identical `archived_iso IS NULL ORDER BY authored_iso DESC LIMIT 1`) and the same `plan_workouts` rows; iPhone and Watch share `GET /api/watch/today`. **But "which row is today" is computed two ways:** web (`state-loader`/`glance-state`) uses `runnerToday(userId)` → `profile.timezone` (DST/travel-aware); watch+iPhone (`build-workout.ts:275`) use `Date.now() − 7*3600000` — the **deprecated −7h Pacific hack**. `runner-tz.ts:4–14` documents that exact hack as the bug it fixed (off-by-one recovery/streak/today); web migrated 2026-06-03, build-workout did not. David is Pacific (PDT now) so they agree today; diverges in PST winter (off-by-1h at the date boundary), for any non-Pacific runner (systematic), and during travel (cold-start users with no profile → web=UTC vs watch −7h = 7h apart). **Threatens:** same question, different answer between web and watch/iPhone.

### MINOR
- **C7 · race anchor verified CLEAN (not a defect):** AFC Half 2026 = Sun **Aug 16** (49th annual, third Sunday; multiple official sources). DB `goal_iso`/`meta.date` = 2026-08-16 ✓.
- **C8 · iPhone `/api/watch/today` "fabricates phases":** iPhone code (`API.swift:847–899`) acknowledges this and notes an unfinished plan to expose the authored `plannedSpec` on `/api/plan/week`. Tier-2 architectural debt; build-workout currently prefers `workout_spec`, so not a live row divergence.
- **C9 · hygiene:** 06-04 plan_workout is the lone row of 77 with NULL `original_*` (snapshot gap); `generate.ts:900` comment says VDOT window "60d" but code uses 180d (doc drift).

**Falsifiers run (all read-only):** races-column query throws live ✓ · run-candidate query returns `[]` live ✓ · 77 rows reconcile to T=407=goalT, not 430=VDOT-T ✓ · week-0 interval 389 (goalT) proves blend never fired ✓ · `snapshot-projections` reads correct columns ✓ · AFC date Aug 16 confirmed vs official calendar ✓ · `plan_mutations`=∅ for plan, `adaptation_log`=[], `original_*` zero-divergence ✓ · run-adaptations stamps last_adapted on 0 actions (source) ✓ · `detectMissedKeyWorkout` completed-run guard (source) ✓ · null-tPace → garbage paces (computed) ✓ · web `runnerToday` vs build-workout −7h (source, both confirmed) ✓ · active-plan selectors identical across 3 paths ✓.

**C6 finding — correction (2026-06-06 follow-up):** my first writeup framed C6 as "web TZ-aware vs watch/iPhone −7h hack." That over-credited the web side. The −7h hack (`Date.now() - 7*3600000`) is the **prevailing** "today" implementation — **36 call sites** across web coach modules (`log-state`, `health-state`, `training-state`, `profile-state`, `races-state`, `standing-recommendation`, `strength-status`, …), the plan engine (`generate.ts:62/1592/1772`), and API routes (`/api/plan/week`, `/api/briefing`, `/api/today/*`, …). Only ~10 sites use `runnerToday` (incl. `state-loader`, `glance-state`). So "today" is inconsistent **system-wide**, often interleaved within a single file/flow — not a clean web-vs-watch split.

## Audit C — Fixes C1 / C3 / C5 / C6  [CODE-COMPLETE 2026-06-06 · deploying via normal pipeline · active-plan regeneration GATED, proposed separately]

**C1 (CRITICAL) — `generate.ts` now reads current VDOT; Rule 3 blends current→goal.**
- **1a** races query → `SELECT slug, meta, actual_result` (was non-existent columns `date_iso/distance_mi/finish_seconds` → threw → empty), mirroring `snapshot-projections`. Reuses `distanceMiOf` + `parseRaceTime`; `meta->>'priority' IN ('A','B')`; window via existing `todayISO`.
- **1b** run `workoutType` → map Strava numeric enum (`1`→race, `3`→tempo); `0/2/null` non-quality.
- **1c** run `max_hr` → `loadEffectiveMaxHr(userId)` (hoisted above the candidate map; was hardcoded `null` → HR gate dead).
- **1d (DISCOVERED during fix-prep)** run duration field → `COALESCE(durationSec, movingTimeS, movingSec, elapsedTimeS)`. The prior `movingTimeSec` (generate) and `movingTimeS` (snapshot) **don't exist** on `runs.data` (real field is `durationSec`) → `finish_seconds` was always null → run candidates never produced VDOT. **generate.ts only** this round (David: races win, no change to his 47.9). **Follow-up:** `snapshot-projections:125` has the same dead field; fixing it there can shift the **canonical** VDOT for run>race runners → separate validated change (logged below).
- **For David:** load-bearing fix is 1a — Disney Half (5694s/13.109mi) = VDOT 47.9 → `currentT=430` → blend.

**C5 — 480 s/mi fallback.** `generate.ts:1880` `tPaceFromGoal(...) ?? 480` (was null → `buildWorkoutSpec` null-coercion → easy 60–110/interval −18 garbage).

**C6 — runner-TZ for "today's workout" (scoped: 2 sites).** `build-workout.ts:275` and `app/api/plan/week` both → `runnerToday(userId)` (was −7h Pacific hack). Keeps watch + iPhone today-card and week-strip consistent and TZ-correct. **Follow-up:** the remaining ~34 −7h sites are a separate sweep (logged below).

**C3 (Option C — no DDL) — truthful change record.** `adapt.ts applyAdaptations` appends `{ts, n}` to `adaptation_log` only when `touched > 0`. `last_adapted_at` stays "cron evaluated"; "last changed" = `max(adaptation_log.ts)`. Fixes the empty-log finding. **iPhone display switch** (show last-changed, not last-adapted) is queued for TestFlight (sync ledger). Option A (named `last_changed_at` column) deferred to a future schema-cleanup pass.

**Falsifiers (pre-commit, all green):** `tsc 0` · vitest 4/4 Audit-C asserts + **223/223** plan-suite regression · 1a RO query returns Disney/Rose Bowl/LA · `bestRecentVdot([those])=47.9` · `tPaceFromVdot(47.9)=430` · `composePlan` ramp **430→425→421→416→412→407**→RACE-SPECIFIC/TAPER 407 (week-1 interval **412/6:52**, not 389/6:29) · `buildWorkoutSpec('intervals',·,430)=412` vs `(·,407)=389` · `tPaceFromGoal(null,13.1) ?? 480 = 480`, easy 540–590.

**Files:** `web-v2/lib/plan/generate.ts` · `web-v2/lib/watch/build-workout.ts` · `web-v2/app/api/plan/week/route.ts` · `web-v2/lib/plan/adapt.ts`.

**Follow-ups (logged, NOT done this session):**
- **C2** — race-week tune-up (doctrinal HM Tue 4×1K @ HMP / wire `race_week_tuneup`). Deferred per David: fix C1 first, let the plan rebuild, then address the taper.
- **C4** — respond to completed-but-underperformed quality. **Feature requirement (needs design before code)** per David; engine currently only reschedules fully-skipped key workouts.
- **snapshot-projections run-path (1d)** — same dead duration field; fixing changes canonical VDOT for run>race runners → separate validated change.
- **36-site −7h `today` sweep** — finish the `runnerToday` migration across the remaining ~34 sites.
- **iPhone (TestFlight)** — switch "adapted" display to last-changed (C3); week-strip already consistent once `/api/plan/week` deploys (C6).

**GATED — active-plan regeneration (data write):** the fix re-paces only on regeneration. Approach proposed separately for David's explicit per-write go (same gated pattern). Until then prod runs corrected CODE but David's stored plan keeps the old 389 targets.

### C1-1e — exclude race-day Strava runs (deployed `4ba9b0b2`)
`generate.ts` run-candidate query lacked the race-day exclusion `cron/snapshot-projections` has. Every race is also a Strava activity at GPS-over-measured distance (Disney 13.38mi vs curated 13.109mi → same 5694s → phantom VDOT **49.2** vs 47.9). C1-1d activated the run-path and exposed this. Added `NOT EXISTS (race within ±1 day)`. Any-runner (everyone's races are also Strava runs). Falsifier: bestRecentVdot 49.2→47.9.

### C1-1f — pass per-week tPaceSec through to persistPlan (deployed `35001afb`) · **the keystone bug**
`generatePlan:1650` mapped `composed.weeks → persistPlan` but **stripped `tPaceSec`**, so `persistPlan:1519` (`weekT = w.tPaceSec ?? args.tPaceSec`) fell back to plan-wide goalT (407) for every week → **flat goal-pace plan**. The Rule 3 ramp was computed in composePlan then discarded at the persist boundary. Added `tPaceSec` to the map + `persistPlan` param type. **Lesson:** composePlan-direct dry-runs showed 412 while stored rows were 389 — they bypassed the broken persist map. **Verify plan generation through the PERSIST PATH (weekT + buildWorkoutSpec), never composePlan-direct.** Two regen writes (`pln_35b2…`, `pln_0968…`) stored flat 389 before this was found; both reversed (archived, not deleted).

### REGENERATED + VERIFIED — active plan `pln_c0ff77ee065b8fe4` (2026-06-07)
Regenerated from clean worktree @`35001afb` (real node_modules, no symlink), write DB. **8/8 stored-row checks pass:** wk1 interval **412**, wk3 **403**, wk5 **394**; wk1 tempo **442**, wk6 tempo **419**; old plan archived; exactly 1 active; `authored_state.derived_from.bestRecentVdot=47.9`. Plan well-formed (77 workouts, 06-01→08-16, race row 407). Stored ramp real on intervals (412→403→394) AND tempos (442→433→424→419). Past already-run days retain prior bands via Rule 15 sealed-day overlay (06-05 easy 467–517) — pre-existing, past-only, doesn't affect future training.

**C1 CLOSED (1a–1f deployed + plan regenerated).** Remaining follow-ups unchanged: C2 (race-week tune-up), C4 (underperformance-adaptation design), snapshot-projections 1d (race-day exclusion + duration field — same fixes, separate validated change since it shifts canonical VDOT), 36-site −7h `today` sweep, iPhone TF display switches (C3/C6). New minor: Rule-15 sealed-day overlay was inconsistent across past days (06-02 took new pace, 06-05 kept old) — pre-existing, only affects already-run days.

### OPEN — regeneration re-rolls distances (found 2026-06-07 · gated · NOT fixed)
Re-pacing via full `generatePlan` ALSO rebuilds the volume curve from *current* inputs, not just paces. The 06-07 regen read `recentWeeklyMi=27.5` vs the original's **39.1** (06-03) — a 30% drop from a 4-week-window shift — scaling every long down: peak **19→15mi**, and a choppy progression (11,11,11,9,11,12,13,11,15,11) vs the original clean build (12→…→19). Both plans still terminate cleanly at AFC 08-16 (77 workouts, nothing past). **Two problems:** (a) a re-pace must NOT re-roll distances → the right tool is an **in-place re-pace** (`UPDATE pace_target_s_per_mi` + `workout_spec` paces on the existing rows, keep distances/structure), NOT a regen; (b) investigate whether `recentWeeklyMi=27.5` is a real training dip or a data/window artifact (dedup / HK-sync) before trusting any volume-derived distance. **Action pending:** reverse to `pln_ca91f252bba50c74` (original — correct distances, wrong-but-easy paces) on David's go; then design the in-place re-pace.

### OPEN — race-calendar awareness (any-runner architectural requirement · logged 2026-06-07)
The generator must respect a user's FULL race calendar, not just the active race. **Current state:** Rule 11 `horizon_raise` reads only a *subset* of future races (priority A/B, longer distance, within 168 days) and uses them solely to raise the long-run **CAP** (David: CIM Dec 6 marathon → cap 17→22mi in `authored_state.horizon_raise`). It is NOT a bridge plan, does NOT read all races, and here the cap raise was nullified by the volume drop (actual peak 15 < 22). **Requirement:** a plan must either (1) end cleanly at the active race with correct structure, OR (2) recognize a higher-priority/longer race follows (e.g., AFC → CIM) and build the bridge accordingly. A plan that ends mid-air or ignores the calendar is wrong for any runner with >1 goal. **Fix scope:** read all races; decide terminate-vs-bridge from the next race's date/priority/distance; make horizon handling produce real structure, not just a cap.

---

## PLAN GENERATION — CRITICAL architectural requirements (locked 2026-06-07, David)
Surfaced by the C1 re-pace saga: regen produced a structurally-worse plan (peak 19→15mi, choppy progression) off a corrupted volume signal. Reversed to original `pln_ca91f252bba50c74` (verified: only active plan, June 7 long = 12mi). **Do NOT attempt another regeneration until #1 and #2 are implemented + tested.**

### CRITICAL #1 — PACE-ONLY in-place re-pace (never full generatePlan to re-pace)
Full `generatePlan` recalculates **distances** from current volume signals, which drift significantly in days (here −30% in 4 days). Re-pacing an existing plan must be an **in-place update**: `UPDATE pace_target_s_per_mi + workout_spec` paces on the existing rows, **preserving distances and structure**. Build this before any future re-pacing. This is THE mechanism going forward.

### CRITICAL #2 — Plan validation layer (gate between generation and persistPlan)
A validation layer must sit between plan build and `persistPlan` and **throw (never write)** if the plan violates:
- Long-run distances appropriate for race type (HM peak ≤ ~14mi)
- Progressive-overload curve sane (no >10% week-over-week spike; monotonic build with cutbacks)
- Taper structure present + correct
- Race week structured per doctrine (C2 tune-up present)
- Volume arc follows expected progression
Same posture as the falsifier gate: invalid plan → throw, no write. (Would have caught the choppy 11,11,11,9,11,12,13,11,15,11 regen.)

### CRITICAL #3 — Race-calendar awareness, volume-aware (not just cap-aware)
Generator must read **all** of a user's races and respect the full calendar (AFC Aug 16 → CIM Dec 6). **Correction to earlier finding:** the generator DOES read future races via Rule 11 `horizon_raise` — it raised the long cap 17→22 to bridge toward CIM. Two gaps: **(a) cap-only, not volume-driven** — actual peak = `volume × longShare`, so the cap is irrelevant when `recentWeeklyMi` is low (bridge intent existed, never manifested — peak landed 15, not 22); **(b) subset only** — reads future A/B races within 168 days, not all races / full sequencing. Requirement: Rule 11 must be **volume-aware**; if volume can't support the bridge, the plan should **explain why the bridge isn't firing**, not silently produce a 15mi peak when 22 was intended. Terminate-cleanly vs bridge is an any-runner requirement (>1 goal).

### CRITICAL #4 — Volume signal corruption: CIRCULAR MERGE bug (ROOT CAUSE FOUND, read-only 2026-06-07)
Why `recentWeeklyMi` read **27.5 (06-07)** vs **39.1 (06-03)**: NOT a training dip — a **dedup data-integrity bug**. The 06-07 03:49–03:52 HK re-sync re-ingested apple_watch dupes for 05-31..06-04, and the merge logic produced **circular `mergedIntoId` pairs**: e.g. 06-02 row `-3558250452245243`→`-71141805277248` AND `-71141805277248`→`-3558250452245243` (each points at the other). Both flagged merged → **no canonical winner** → the day contributes 0 to canonical mileage. Confirmed: only 05-29 + 06-05 have a canonical run in 05-29..06-05; **5 days / ~38.7mi (12.36+5.06+7.41+6.08+7.76) zeroed out**. `recentMileageMi(28d)/4` → 27.5. True recent volume ≈ **39mi/wk** (the original plan's value; the runs exist, they're just circular-merged). **This is a NEW C1b-family failure mode** (over-merge/circular, vs the earlier wipe→double-count). Bug: `autoMerge`/`pickCanonical` can create circular `mergedIntoId` under HK re-sync. Fix needed (separate, gated): merge logic must guarantee exactly one canonical per dupe set (no circular refs); + a DATA fix to un-circular the affected rows (gated DB write — David's per-statement go). Impacts every volume-based signal, not just plan-gen, whenever a circular merge exists. David's plan is on the original (correct distances), so not currently affected.

#### CRITICAL #4 — FIX (P1 · 2026-06-07 · CODE COMPLETE + UNIT-TESTED · data write GATED)
**Root cause pinned in code (not just the symptom): the circular ref is created by the ingest WEATHER UPDATE, not by autoMerge.** Sequence on a HK re-sync of an apple_watch row whose canonical flips (the trust-flip, `identity.ts:140`):
1. C1b copies the existing `mergedIntoId` into the in-memory `data` (`ingest/workout/route.ts:279`).
2. DELETE+INSERT writes the row.
3. `autoMergeForDate` flips the canonical to the re-ingested row → correctly CLEARS its flag in the DB and points the other row at it. DB consistent.
4. The weather UPDATE `SET data = data || $1::jsonb` with `$1 = the full stale in-memory data` **re-applies the just-cleared `mergedIntoId`** → A→B AND B→A → both flagged → `volume.ts` `NOT (data ? 'mergedIntoId')` excludes both → day zeroes.

The trust-flip's Δdist≤0.05 / Δdur≤120 gate equals `isSameRun`'s gate for a watch+apple_watch pair, so these pairs always cluster — i.e. the existing autoMerge would self-heal them once the weather write stops re-breaking them.

**Code fix (3 files + tests · no DB):**
- `app/api/ingest/workout/route.ts` (ROOT) — both weather UPDATEs (Tier 1 HK-temp + Tier 2 Open-Meteo) now patch ONLY `{weather, tempF}` via `data || $1`, never the full stale `data`. Stops creation; also stops clobbering absorber-merged fields (splits).
- `lib/runs/identity.ts` — new pure `planMergeOps(rows)`: derives the per-cluster invariant (exactly one canonical, losers→canonical, **canonical/orphan flags cleared FIRST** → cycle-free + self-healing). Single source for runtime + repair.
- `lib/runs/merge.ts` — `autoMergeForDate` loads rows UNFILTERED and applies `planMergeOps` (clears-before-sets). Now heals circular pairs AND lone orphaned-flag rows on the next cron, not just fresh dupes.
- `lib/runs/identity.test.ts` — 11 unit tests incl. the circular A↔B → one-canonical falsifier + idempotency. **tsc 0 · identity 11/11 · full suite 336 pass (only the 5 pre-existing `weather-adjust` fails remain).**

**DECISION FLAGGED (any-runner):** `planMergeOps` also clears flags on lone singleton rows (heals orphans left by deleted partners / unstable clustering). Trade-off — if `isSameRun` ever false-negatives a real dupe, this yields a VISIBLE double-count instead of a SILENT zero. Judged visible>silent; say the word to leave singletons untouched.

**Data write (GATED — needs `DATABASE_URL_RO` + per-statement go):** read-only audit `lib/runs/circular-merge-repair.audit.test.ts` (skipped unless `DATABASE_URL_RO` set) imports the real `planMergeOps`, emits the exact repair SQL (clears+sets, byte-identical to `merge.ts`) + before/after canonical mileage per day. For a circular pair the repair is ONE `UPDATE … SET data = data - 'mergedIntoId'` per pair (clear the canonical; the loser already points correctly). Run when creds land → present statements → David's go → write. Falsifier: `recentWeeklyMi` → ~39, each affected day exactly one canonical.

---

## Read-only investigations (2026-06-07 · no code)

### coach_intents value storage — NO char-by-char issue (RESOLVED)
Checked all 34 coach_intents rows: **0** use the char-indexed `{"0":..,"1":..}` pattern. Watch-completion bodies store proper JSON (06-05: `{"kcal":734,"status":"completed","totalDistanceMi":6.01,…,"phases":[…]}`). `value` is a TEXT column holding either JSON (structured intents, 20 rows) or plain prose (coach messages, 14 rows); `value::jsonb` fails only on the prose rows, by design. **No fix needed — neither systematic nor isolated; it doesn't occur.**

### Splits via paceSample — CONFIRMED working server-side (proposal · no code)
Watch completions carry per-phase `paceSamples` (cumulative `{tSec, distMi, paceSPerMi}`, ~every 5s). **Present on EASY runs** (June 5: single phase, **594 samples**), not just intervals. Source: `coach_intents` reason=`watch_completion` → `value.phases[].paceSamples` (NOT on `runs.data`, NOT top-level on the completion).
**Derivation proven (June 5 easy, RO):** interpolate `tSec` at each integer-mile crossing → per-mile splits **8:28 / 8:10 / 8:15 / 8:13 / 8:26**, final 1.00mi @ 8:34 (6.01mi / 50:12, avg 8:21 — splits bracket correctly). Clean, real-pace.
**Key structural fact:** per-phase paceSamples are **PHASE-RELATIVE** (each phase resets `tSec:0/distMi:0` — proven on 06-02 intervals: warmup 0→729s, work 0→385s, …). Single-phase (easy) runs derive trivially; **multi-phase (intervals) require concatenation with running tSec/distMi offsets** before mile-crossing.
**Proposal:** server-side helper (e.g. `lib/coach/derive-mile-splits.ts`): concat phases with offsets → whole-run cumulative series → interpolate mile crossings → per-mile splits + trailing partial. Consumed by run-detail/recap, **replacing the iPhone GPS per-mile splits** — fixes the A4/A5/P3-3 `splits_unreliable` saga at the source (watch GPS+pedometer-fused distance beats raw GPS Haversine; bypasses the iPhone GPS round-trip entirely). Caveats: Faff-watch runs only (Strava/manual/HK → fallback); abandoned runs partial; validate vs `totalDistanceMi`. **No code until reviewed.**

---

## Deferred (not in any cluster)
- **Watch-source consolidation + retire `legacy/`** — LAST cutover step, on a Mac that can build/archive a clean `.ipa`. `legacy/` not retirable until then (watch bundle compiles from it via symlink). Preserve `.asc.build`.
- **P3-1 — Strava-local-as-UTC mislabel · isSameRun fix. DEPLOYED 2026-06-06 (commit 40db83b2 · `identity.ts`).** The 05-26 apple_watch phantom (`-573194905917117`, 7.61mi) cycles on every HK re-sync because isSameRun returned false for the strava+apple_watch pair. Fixed.
  - **Root cause:** Strava's `start_date_local` carries a spurious `Z` — local wall time, not UTC (Strava API quirk). `isTrustworthy(strava)=true` (via `hasOffset`) + `startUtcMs` treated Z as UTC → strava span at 11:22Z, apple_watch at 18:22Z → 7h apart → `spansOverlap=false`.
  - **Fix:**
    - `startUtcMs`: strips Z from strava rows → treats as local PT → both rows = 18:22:17Z → spans overlap → `isSameRun=true`.
    - `pickCanonical`: GPS-mislabel distance preference — tier-winner ≥10% more distance than strava-mislabel alt → prefer strava (GPS drift inflates, never reduces). Strava 5.91mi wins over apple_watch 7.61mi.
  - **Falsifiers 9/9 green:** P3-1 pair merges + strava canonical (✓); F1-F5 watch+apple_watch unchanged (✓); F6-F7 no-merge negatives (✓).
  - **Post-deploy verification (RO, 2026-06-06):** Identity reader on fragile rows → **101 runs / 755.15mi** ✓. 05-26 cluster: 2 rows, canonical=strava 5.91mi ✓. Fragile reader (mergedIntoId-based) will match 755.15mi / 101 runs after the next nightly dedupe-runs cron fires (05-26 is within the 14-day window).
  - **C1b guard still needed:** until C1b ships, every HK re-sync wipes mergedIntoId on apple_watch and restores the phantom. The cron re-merges it within 24h. The 24h convergence window is acceptable short-term. C1b is P0 next.
  - **Side finding (scope outside P3-1):** legacy null-source rows (old Strava data before source field was added) have the same Z-mislabel pattern. They cluster apart from their apple_health pairs, inflating the all-rows identity reader. Not in the 14-day cron window — separate cleanup needed.
- **MINOR (out of Cluster 1) — volume rounding:** `mileageByDay` sums per-day-rounded day totals (763.2) vs the raw-summed 762.76 — a 0.44 mi **pre-existing** rounding artifact, identical old→new. Follow-up: sum raw canonical distances and round once so by-day and raw-sum readers reconcile exactly. Not a regression; do not bundle into Cluster 1.
- **Separate WRITE Postgres role (infra · Cluster 2)** — `.env.local` has only `faff_readonly` (RO) + `DATABASE_URL` (superuser). Both backfills ran via superuser (reviewed/reversible/approved/shown one-at-a-time). Clean end state needs a dedicated **non-superuser WRITE role** so write sessions never default to superuser. Provision before Cluster 2 writes.
- **`pickCanonical` · trustworthy-timestamp wins when equal (Cluster 2-ish)** — when Δdist/Δdur/Δsplits ≈ 0, prefer the `isTrustworthy` row over the tier-winner. Currently tier-first; GUARD-A only flips at ≥4h gap. David made this call manually **twice** (05-29 HK-over-watch, 06-04 apple_watch-over-watch) → twice = it should be the engine default, not a repeated override. Small `pickCanonical` change, out of Cluster 1.

---

## Future audit — Coaching Doctrine Generalization (logged 2026-06-07, David)

**Schedule:** after the current fix queue (Audit C P1–P4) is closed and the system is stable.

**Scope:** a dedicated product + research audit verifying every coaching rule is:

1. **Grounded in exercise science / established training doctrine** (Daniels, Pfitzinger, etc.) — not empirically tuned for one runner. Every rule should cite a source in `Research/`. If a rule has no citation, that is a finding.
2. **Parameterized correctly for runner type** — beginner vs intermediate vs advanced, 5K vs HM vs marathon, low base vs high base. Rules that work for David (advanced, ~50 mpw, sub-1:30 HM target) must degrade gracefully for a beginner at 15 mpw.
3. **Tested against cold-start users at different experience levels** — does a beginner get a sane plan (not 12 × 400m at 5:30/mi in week 1)? Does an elite get appropriately aggressive targets? Persona-driven bench tests in `generator-bench.test.ts` are the vehicle for this.
4. **Documented with source + rationale** so future changes can be evaluated against doctrine, not vibes. Format: each rule in `generate.ts` / `spec-builder.ts` / `goal-tiers.ts` cites the `Research/` section that justifies its threshold. Missing citations = gaps, not style issues.

**Method:** session with coaching logic, `Research/` docs, and real test cases across runner types. Not a code-coverage audit — a doctrine-coverage audit. Output: findings per rule (grounded / ungrounded / needs parameterization / missing citation), fixes for any ungrounded rules, new bench personas for beginner + intermediate + elite.

**AFC→CIM bridge — specific product flow requiring design (logged 2026-06-07):** When a race result is logged: (1) update VDOT from the actual result, (2) archive the completed plan, (3) generate or prompt to generate the next race's plan starting from post-race fitness. The AFC→CIM bridge specifically: after AFC on Aug 16, the CIM plan should start from demonstrated AFC fitness (not the pre-AFC VDOT) and build appropriately for a full marathon over the remaining ~16 weeks. This is a product flow, not just a code fix — needs design. Requirements: (a) race-result trigger → VDOT update, (b) archive-and-propose-next UI surface, (c) CIM plan generation uses post-AFC VDOT as base, (d) HM→M transition adjusts long-run ramp (can't jump from 13-mi HM long to marathon-distance long in one week). Log as a feature requirement in `APP_FEATURE_SPEC.md` under post-race flow.

---

## Plan generation — HM race-specific doctrine gap · DEPLOYED + ACTIVE PLAN CORRECTED (2026-06-07)

**Finding:** `generate.ts` line 781 had `cat === 'hm' ? ['threshold', 'tempo']` for the `RACE-SPECIFIC` phase. Research/22 §3 explicitly shows `['threshold', 'intervals']` for HM race-specific — one T session + one I session per week (intermediate sample peak week: Tue WU + 5mi @ T, Thu WU + 4×1200m @ I). The HM advanced plan phases column states "VO2max + race-specific HMP" as the penultimate phase, meaning interval work continues concurrent with HMP work, not before it. The current generator dropped VO2max sharpening entirely in the final build phase, contradicting the doctrine.

**Task 1 (code) — DEPLOYED on `main` at commit `9223789`:**
```diff
- : cat === 'hm'   ? ['threshold', 'tempo']
+ : cat === 'hm'   ? ['threshold', 'intervals']
```
Affects future plan regenerations. Active plan unaffected by code change alone.

**Task 2 (active-plan data correction) — DONE 2026-06-07 · 3 gated UPDATEs · superuser · verified RO:**

Actual DB state differed from the handoff premise: the RACE-SPECIFIC phase had **6 tempo rows** (both quality days every RS week were tempo — no intervals at all). Fix: converted the **Thursday slot** in each RS week to intervals, matching Research/22 §3 doctrine (Tue @ T + Thu @ I). Tuesday rows unchanged.

3 rows updated — `wko_954737275cee4fc8` (Jul 16) · `wko_0f8914eb45371a70` (Jul 23) · `wko_b939d617118c3849` (Jul 30):
- `type`: `tempo` → `intervals`
- `pace_target_s_per_mi`: 419 → **389** (weekT=407 − 18; pace-neutral, anchored from existing tempo spec)
- `distance_mi`: 6.5 / 7.0 / 6.5 → **7.5** (spec-derived: 1.5 WU + 4×1mi + 3×180s jog + 1.0 CD)
- `sub_label`: continuous-tempo string → **"4×1 mi @ I · 3 min jog"** (matching weeks 1/3/5 of same plan)
- `workout_spec`: tempo spec → `{kind:'intervals', warmup_mi:1.5, rep_count:4, rep_distance_mi:1, rep_pace_s_per_mi:389, rep_rest_s:180, cooldown_mi:1, lthr_bpm:162}`
- `original_type` / `original_sub_label` / `original_distance_mi`: **synced to new values** (Option B — prevents phantom wasAdapted badge in adaptation-info.ts + readiness-brief.ts)

**Falsifiers (7/7 PASS, RO, post-write):**
- Thu rows (3): all intervals ✓ · pace=389 ✓ · sub="4×1 mi @ I · 3 min jog" ✓ · dist=7.5 ✓ · original_type synced ✓
- Tue rows (3): still tempo ✓ · pace=419 unchanged ✓

**Reversal:** restore `type='tempo', workout_spec=<tempo spec>, pace_target_s_per_mi=419, sub_label=<original tempo label>, distance_mi=<original>` on the 3 row ids above.

**Task 3 (circular-merge repair audit) — DONE 2026-06-07 · NO WRITES NEEDED:**

The CRITICAL #4 circular pairs (05-31..06-04) were **fully self-healed by the nightly dedupe-runs cron** before this session ran. `recentWeeklyMi = 37.5` (≈39 expected — minor window-math difference, not a bug). Circular-pairs test: **PASS (0 A↔B cycles)**. The audit emitted 10 repair statements, but all cover out-of-scope issues:
- 05-15..05-24: Legacy `?`-source Strava rows (pre-source-field data, Z-mislabel) — the AUDIT-FIXES "side finding." Outside 14-day cron window. Current merged state is correct; running repair would un-merge and inflate volume.
- 05-26: Proposed repair would reverse the P3-1 fix (strava canonical). Do not apply.

---

## Test health — weather-adjust failures FIXED (2026-06-07)
- [x] **All 5 `lib/coach/weather-adjust.test.ts` failures resolved.** Root cause: `bandFor()` had a temperature gate added 2026-06-03 (`if (tempF < 75) return 'warm'`) that hard-capped the band regardless of slowdown percentage, contradicting the doctrine the tests encode. The tests were written against David's explicitly stated doctrine (documented May 31, test comment: "This is the explicit doctrine the user called out"): pure slowdown-based bands — neutral <2%, warm 2–6%, hot 6–12%, extreme ≥12%. The code drifted from that on June 3.

  **Fix:** `bandFor()` reverted to pure slowdown-only classification. Temperature gate removed entirely; `tempF` parameter dropped from signature. The 2026-06-03 gate was well-intentioned (softening the "hot" label for cool-but-humid conditions where pace cost is real but temperature feels mild) but contradicted the documented doctrine. The correct UX fix for unexpected labels is coach-voice explanation, not classification softening — e.g. "65°F but humid: costs you 9% on pace" is honest; labeling it "warm" when the pace tax is in the hot range is not.

  **Result:** 351 pass / 0 fail / 3 skipped. Full suite green for the first time since 2026-06-03.

---

## Audit D — Fixes D1 + D2  [DEPLOYED 2026-06-07 · commits 1394addb (D2) + 38cb7a3f (D1) on main · Railway auto-deploy fired]

**D2 (MAJOR) — DEPLOYED 2026-06-07 · commit `1394addb`** — `build-workout.ts` read only `lthr_bpm` for quality HR target; tempo specs store `hr_target_bpm` (=149) and have no `lthr_bpm`, so watch showed 162 (profile LTHR) while iPhone glance/web seed/recap all showed 149. COALESCE `lthr_bpm ?? hr_target_bpm` — watch now matches every other consumer. tsc 0. Any-runner.

**D1 (CRITICAL) — code DEPLOYED 2026-06-07 · commit `38cb7a3f` · 6 DB rows patched 2026-06-07:**

Root cause confirmed: `buildWorkoutSpec` long branch ignored its `prescription` arg; `expandLong` emitted one flat easy phase; the 144 HR ceiling red-alarmed through the HM finish ("coaching the opposite of the prescription"). Three files fixed:
- `spec-builder.ts` — `extractFinishSegment()` parses `@ HM`/`@ M`/`@ MP`; long branch populates `finish_mi` + `finish_pace_s_per_mi` (HM=T+5, M=T+18) + `finish_label`
- `expand-spec.ts` — `expandLong` emits `[easy-build, finish]` when `finish_mi` present (finish tol ≤12 s/mi); `subLabelFromSpec` derives `LONG · Nmi @ HM/M` from spec (no more label/spec drift on regen)
- `build-workout.ts` — `longHasFinish` gate suppresses `hrCeilingBpm` (was 144) + switches `displayHint` `hr→pace`

**12 unit falsifiers: 363/363 pass (0 regressions).**

**6 in-place UPDATEs (per-statement, superuser, jsonb `||` additive — preserves all existing spec fields):**

| date | id | finish_mi | finish_pace | finish_label | sub_label / notes |
|---|---|---|---|---|---|
| 2026-06-28 (wk3) | `wko_bfb3e91b38a7d832` | 4 | 434 (M) | M | "LONG · 4mi @ M" / "Steady 10mi, then 4mi at marathon pace." |
| 2026-07-05 (wk4) | `wko_5995ef36dbe141fe` | 5 | 430 (M) | M | "LONG · 5mi @ M" / "Steady 11mi, then 5mi at marathon pace." |
| 2026-07-12 (wk5) | `wko_05e1b73b9c42840e` | 4 | 412 (HM) | HM | "LONG · 4mi @ HM" / "Steady 9mi, then 4mi at half-marathon pace." |
| 2026-07-19 (wk6) | `wko_9dcc3044b166b9a6` | 7 | 412 (HM) | HM | (sub_label/notes already correct) |
| 2026-07-26 (wk7) | `wko_0ca0d4b97889cbf5` | 8 | 412 (HM) | HM | (sub_label/notes already correct) |
| 2026-08-02 (wk8) | `wko_6bd64043882cb9c8` | 6 | 412 (HM) | HM | (sub_label/notes already correct) |

**Reversal:** `workout_spec - 'finish_mi' - 'finish_pace_s_per_mi' - 'finish_label'` on all 6 ids; restore `sub_label='LONG', original_sub_label='LONG', notes='Conversational throughout. Build the engine.'` on wk3–5.

**Live falsifiers (prod DB, RO, post-write):**
- **Jul 19 (HM):** 2 phases `[10.0mi easy @ 8:00, 7.0mi @ HM pace 6:52]` · `hrCeilingBpm=null` · `displayHint='pace'` ✓
- **Jun 28 (M):** 2 phases `[10.0mi easy @ 8:00, 4.0mi @ M pace 7:14]` · `hrCeilingBpm=null` · `displayHint='pace'` ✓
- **Jun 14 plain LONG regression:** `finish_mi=null` · single flat phase · backward-compat preserved ✓

---

## Generator follow-up: emit M→HMP labels for late-QUALITY long runs  [DEPLOYED 2026-06-07 · commit `3c691d91` on main · Railway auto-deploy fired · post-deploy smoke PASS · CLOSED]

The 6 in-place UPDATEs above fixed the **active plan** for David. This closes the generator side: `layoutWeek` now emits M/HMP finish labels for late-QUALITY long runs, so `buildWorkoutSpec`'s `extractFinishSegment` encodes the finish for every future regen + new runner — not just David's hand-patched rows. Before this, `generate.ts` emitted plain `'LONG'` for all QUALITY-phase longs → flat easy spec under a label that promised nothing → no specific-endurance stimulus (the D1 gap, generator side).

**Implemented (`web-v2/lib/plan/generate.ts`, code-only, no data write):**
- New pure helper `longFinishSegment(phase, weeksToPhaseEnd, racePaceTag)` → `{pct, tag}` | null. Derived from **phase position** (weeks from the end of the phase), NOT absolute week number, so it holds for any plan length:
  - RACE-SPECIFIC (every wk): 40% @ {HM|MP} — byte-identical to the prior inline code (routed through the helper now)
  - QUALITY last wk: 33% @ {HM|MP}  (HMP step for HM)
  - QUALITY 2nd-from-last: 33% @ {M|MP}  (M-pace warm-in for HM)
  - QUALITY 3rd-from-last: 30% @ {M|MP}
  - earlier QUALITY / BASE / TAPER: null (plain long)
  - 5K/10K (`racePaceTag` null): null everywhere — no long-run pace insert (per David's scope)
- Plumbed `weeksToPhaseEnd = phaseWkRemaining - 1` from the composePlan loop into `layoutWeek` (0 = last week of the phase).
- Long-run slot routes BOTH RACE-SPECIFIC and QUALITY through the helper (single doctrine source); `hasFinish` guard mirrors `expandLong`'s `finishMi < totalMi`.
- Cite: Research/22 §3 (HM "LR with HMP segments" → "race-specific HMP"; M "LR w/ last N @ M").

**Falsifiers (all green; run via node_modules symlinked from the main checkout, on `main`-current base):**
- `tsc --noEmit` → **0 errors** (0 in changed files).
- Plan suite → **249/249** (6 files): generator-bench (incl. new assertion), spec-completeness 12/12, plan-engine, adapter-bench, adaptive-ramp, validate.
- New bench assertion `late-QUALITY HM long runs carry the M→HMP finish progression` runs for all 5 HM personas (early-returns for 5K/M/ultra) — asserts last-3 QUALITY longs = `@ M` / `@ M` / `@ HM` and earlier QUALITY longs stay plain.
- Live `composePlan` label dump (4 plan shapes · the concrete any-runner falsifier):
  - David 11wk HM (QUALITY 6): wk3/4/5 = `@ M`/`@ M`/`@ HM`; wk6-8 RS `@ HM`; earlier QUALITY + taper plain → matches the approved patch structure.
  - Advanced 8wk HM (QUALITY 4): last 3 = `@ M`/`@ M`/`@ HM`.
  - Beginner 16wk HM (QUALITY 6): ONLY wk8/9/10 (last 3) get finishes; earlier QUALITY plain → phase-position derivation confirmed (not hardcoded weeks).
  - Advanced 16wk Marathon (QUALITY 5): `@ MP` throughout late-QUALITY + RS (race pace == marathon pace).

**Scope:** future generations only. Does NOT regenerate David's active plan (regen re-rolls distances — separate gated issue, logged above).

**DEPLOYED 2026-06-07** · commit `3c691d91` on `main` (cherry-picked onto `c0f2bb33` after a concurrent main push; clean, no overlap — frontend-only date-helper change). Railway auto-deploy fired on push. **Post-deploy smoke (read-only, composePlan only, no regen):** fresh HM plan against deployed `3c691d91` → QUALITY(6)/RACE-SPECIFIC(3)/TAPER(2); last-3 QUALITY longs = `LONG · 3mi @ M` / `LONG · 4mi @ M` / `LONG · 4mi @ HM`; RACE-SPECIFIC all `@ HM`; early QUALITY + TAPER plain. PASS. Site live (HTTP 307 auth redirect). **Generator follow-up CLOSED.**

### Follow-up (logged, deferred per David — out of scope this session)
- **10K long-run M-pace finish gap.** Research/22 §2 (10K Intermediate) prescribes "9-10 mi E w/ last 2 mi @ M", but the generator gives 10K plans plain long runs: `racePaceTag` is null for `<12`mi (`generate.ts:756`), so `longFinishSegment` correctly returns null and no finish is emitted. Intentional for this fix (David scoped 5K/10K out: "no long-run inserts"), but the 10K doctrine does support a short M-pace finish. To wire later: extend `racePaceTag` to return `'M'` for the 10K band (≈6-11mi) and add a 10K branch to `longFinishSegment` (smaller pct, `@ M`). Deferred.

---

## Audit D — Plan Spec Completeness (label ↔ spec ↔ watch-execution)  [AUDIT DONE · read-only 2026-06-07 · `DATABASE_URL_RO` as `faff_readonly` · 0 code/data writes]

**Goal:** for every workout type in the active plan, prove `sub_label` (what the runner sees) == `workout_spec` (what the watch executes) == what `expandSpecToPhases` actually ships to the watch. Falsify, don't confirm.

**Subject:** active plan `pln_ca91f252bba50c74` (single non-archived plan; AFC Half; goal_iso 2026-08-16; 77 workouts; VDOT 47.9; LTHR 162). RO verified: `UPDATE plan_workouts` → permission denied; `current_user=faff_readonly`.

**Headline:** the loop is mostly faithful. **The one structural mismatch is the known LONG/HMP gap — and it is worse than cosmetic: the watch not only omits the HM-pace finish, its HR guardrail (ceiling 144) actively red-alerts during the would-be HM miles, coaching the opposite of the label.** One additional watch-execution bug found (tempo HR target reads the wrong spec field). 1 CRITICAL, 1 MAJOR, 3 MINOR.

### Inventory — every type present (real rows, RO)
| type | n | sub_label (runner sees) | workout_spec (watch executes) | agree? |
|---|---|---|---|---|
| easy | 34 | `EASY` | `{kind:easy, band 467–517, hr_cap 144, fuel[]}` | ✓ (1 past row hr_cap 130) |
| tempo | 14 | `2 mi WU · 4 mi @ T · 2 mi CD` (+3.5/5mi variants) | `{kind:tempo, wu/tempo/cd, tempo_pace, hr_target_bpm 149}` | structure ✓ · **HR field bug D2** |
| rest | 11 | `REST` | null (no spec) | ✓ (watch → "Rest day.") |
| long | 7 | `LONG` | `{kind:long, band 462–497, hr_cap 144, fuel}` | ✓ (flat easy long) |
| long | 3 | `LONG · 7mi @ HM` / `8mi @ HM` / `6mi @ HM` | **identical flat `{kind:long, band 462–497, hr_cap 144}` — no HMP** | **✗ D1** |
| intervals | 6 | `4×1 mi @ I · 3 min jog` | `{kind:intervals, rep_count 4, rep_distance_mi 1, rep_rest_s 180, wu 1.5, cd 1, rep_pace, lthr_bpm 162}` | ✓ |
| race | 1 | `RACE` | `{kind:long (stash), band 397–412, hr_cap 154, fuel}` | ✓ (D5 internal phase label only) |
| shakeout | 1 | `SHAKEOUT` | `{kind:easy, band 517–547, hr_cap 144}` | ✓ (D5) |

**Types the prompt named but NOT in this plan:** `threshold`, `race_week_tuneup`, `recovery`. Builder (`spec-builder.ts`) + expander (`expand-spec.ts`) fully support all three; they're simply never scheduled by `layoutWeek` for this HM plan. `race_week_tuneup` is dead per Audit C **C2** (race-week branch hardcodes race/shakeout/rest/easy); if wired its spec is exactly the prompt's expected `WU 1.5mi · 2×0.5mi @ T−5 · CD 1mi` (`spec-builder.ts:276-289`). RACE-SPECIFIC Tuesdays are `tempo` not `threshold` — plan-correctness (Audit C / the 2026-06-07 doctrine-gap fix), NOT a label/spec mismatch (label `@ T` + tempo spec agree).

### D1 · CRITICAL · long-run HM-pace finish is in the label + notes but absent from the spec and every execution surface (any HM/M runner)
Three rows, all RACE-SPECIFIC peak weeks: `2026-07-19` "LONG · 7mi @ HM" (notes "Steady 10mi, then 7mi at half-marathon pace"), `2026-07-26` "8mi @ HM", `2026-08-02` "6mi @ HM". Every long spec — plain AND HMP-labelled — is the **identical flat shape** `{kind:long, pace_target_s_per_mi_lo:462, _hi:497, hr_cap_bpm:144, fuel_mi}`. Band 462–497 = T+55/+90 = the **easy-long** range (7:42–8:17/mi); HM pace ≈ 407 (goal) / 430 (current VDOT). No HMP field exists in the spec.
- **Watch executes flat:** `expandLong` (`expand-spec.ts:198-215`) reads only `pace_target_s_per_mi_lo/hi` → emits ONE work phase "17.0 mi long run" @ mid 480 (8:00/mi). The watch `name` = `sub_label` = "LONG · 7mi @ HM" (`build-workout.ts:451`) over a single flat phase.
- **Root cause:** `buildWorkoutSpec` long branch (`spec-builder.ts:173-188`) **ignores its `prescription` argument** (which carries "LONG · 7mi @ HM"); a misleading comment claims it "carries an MP segment · pace_target reflects that mid-effort prescription" — it does not. `subLabelFromSpec` (`expand-spec.ts:298-306`) already documents the gap: "`long · 'LONG · 5mi @ HM' race-pace insert isn't in spec`".
- **AGGRAVATOR (why CRITICAL, not just a missing phase):** long runs ship `hrCeilingBpm = round(LTHR×0.89) = 144` + `displayHint:'hr'` (`build-workout.ts:443,470`). `WorkoutEngine.swift:608-612` (legacy real build) sets `hrOverCeiling = hr > ceiling` and the face "snaps the guardrail row to a red HR and holds it until HR drops back below." Running 7mi at HM effort (HR ~155–165) > 144 → the watch **red-alerts "too hard" for the entire HM segment** — actively coaching the opposite of the label, for ~40% of the run.
- **Capability exists but is shadowed:** the fallback `prescriptionFor('long')` (`prescriptions.ts:293-315`) builds `Easy build` + `Marathon-pace finish` (@ Z3) when `weeklyMi ≥ 35`. But the flat `workout_spec` is always present and **wins** (`build-workout.ts:376` prefers spec over prescription). The 2026-06-02 "spec is source of truth" migration silently dropped the fast-finish for long runs because the `long` spec schema has no field to carry it.
- **Any-runner:** fires for every HM (`racePaceTag='HM'`) and marathon (`'MP'`) plan's race-specific long runs (`generate.ts:756-768`). A watch-reliant runner does the wrong (easier) session and is told to slow down during the one quality block.
- **Severity note:** workout TYPE, distance, and NAME are correct, so this is readable as MAJOR. Landed CRITICAL because the HR guardrail makes the watch execute *against* the prescription, not merely omit structure. David to recalibrate if desired.
- **Threatens:** the peak-phase specific-endurance stimulus (the entire point of these 3 sessions) is dropped on every surface; HR guardrail fights the prescription.

### D2 · MAJOR · watch shows the wrong tempo HR target — reads `lthr_bpm`, but tempo writes `hr_target_bpm` (any runner with LTHR)
All 14 tempo specs store `hr_target_bpm` (=round(LTHR×0.92)=149) and have **no** `lthr_bpm`. The watch payload (`build-workout.ts:389-393`) reads only `lthr_bpm` for `hrTargetBpm`; tempo has none → `specLthrBpm=null` → falls back to `profile.lthr=162`. So the **watch shows 162** for tempo work phases while **iPhone glance** (`glance-adapter.ts:278`), **web seed** (`seed.ts:486`), and **recap** (`recap/route.ts:99`) all read `hr_target_bpm` → **149**. Pace is correct on all surfaces (`tempo_pace_s_per_mi` read fine). Threatens: watch HR reference 13 bpm high (threshold HR vs intended sub-threshold tempo) → cross-surface inconsistency; if the runner chases HR the tempo runs too hard. Fix is one COALESCE in `build-workout.ts` (read `hr_target_bpm ?? lthr_bpm`), matching the other three readers.

### MINOR
- **D3 · MINOR · one tempo (`2026-06-04`) has `hr_target_bpm:null`** while the other 13 have 149. Past (already-run) row; likely authored before LTHR resolved or via a sealed-day overlay. Cosmetic now. Any-runner if re-authored with null LTHR.
- **D4 · MINOR · race spec `hr_cap_bpm:154` is dead on the watch.** `build-workout.ts:443` sets workout-level `hrCeilingBpm` only for easy/long → race ships null; the watch recomputes hrCeiling from LTHR (×0.89) and ignores `spec.hr_cap_bpm` entirely (they coincide for easy/long only because both use 89% LTHR). Not a label mismatch (you don't HR-cap a race); phone glance still reads it. Logged for completeness.
- **D5 · MINOR (cosmetic) · race + shakeout internal phase labels are generic.** `expandLong`/`expandEasy` label the single phase "13.1 mi long run" (race) / "2.0 mi easy" (shakeout). The workout NAME (sub_label) is correct ("RACE"/"SHAKEOUT"); only the internal phase label is generic. Harmless.

### Cold-start (new user, no history) — degrades gracefully ✓
Every `kind` `buildWorkoutSpec` can emit (easy/recovery/long/tempo/threshold/intervals/long-for-race/easy-for-shakeout/threshold-for-tuneup) is handled by `expandSpecToPhases`; none falls through to the null fallback. With `tPace=480` (C5 fallback), `lthr=null`, `maxHr=null` → specs build with null HR caps + generic pace bands; expanders emit valid phases; no crash, no empty spec; rest → "Rest day."; no plan → "No active plan." The ONE cold-start defect is the same **D1** — a brand-new HM runner in race-specific weeks still gets flat-spec longs under HMP labels (HR guardrail won't fire without LTHR, but the stimulus is still missing).

### Complete list of label/spec mismatches
1. **D1** — `LONG · {6,7,8}mi @ HM` (3 rows) → flat `kind:long` easy spec, no HM segment; watch executes flat + HR guardrail fights it. **CRITICAL.**
2. **D2** — tempo (14 rows) → watch HR target 162 vs spec/phone/web 149 (`lthr_bpm` vs `hr_target_bpm` field mismatch). **MAJOR.**
3. **D3/D4/D5** — minor (one null tempo HR; dead race hr_cap on watch; generic internal phase labels).

### Proposed fix order (NOT executed — audit only)
1. **D1 (code, highest value):** add an HM/MP-finish field to the `long` spec schema; populate it in `buildWorkoutSpec`'s long branch from the RACE-SPECIFIC prescription (or compute `round(longMi×0.4)` @ T−5 HM / T+18 M); teach `expandLong` to emit `Easy build` + `HM/MP finish` phases with the finish carrying its own (higher) HR reference and the easy portion keeping the 144 ceiling so the guardrail stops firing during the finish. Mirror the threshold→tempo remap already at `generate.ts:807-812`. Affects future regens only; the 3 active rows then need an **in-place re-spec** (gated DB write per PLAN-GEN CRITICAL #1 — never a full regen, which re-rolls distances).
2. **D2 (code, no data write):** `build-workout.ts:389-393` read `hr_target_bpm ?? lthr_bpm`, matching glance/seed/recap. Any-runner.
3. **D3/D4/D5:** bundle or defer; D4 = decide whether the watch should honor `spec.hr_cap_bpm` generally vs recompute.

**Falsifiers run (all read-only):** RO write-denied (`UPDATE plan_workouts` → permission denied) ✓ · single active plan = `pln_ca91f252bba50c74` ✓ · 3 HMP long sub_labels carry `@ HM` while all 10 long specs are byte-identical flat `kind:long` band 462–497 ✓ · `expandLong` reads only pace_lo/hi (source) ✓ · `buildWorkoutSpec` long branch ignores `prescription` (source) ✓ · `prescriptionFor('long')` builds MP-finish at weeklyMi≥35 but spec wins (source) ✓ · tempo specs have `hr_target_bpm` not `lthr_bpm`; watch reads `lthr_bpm` → profile.lthr=162 vs spec 149 ✓ · `profile.lthr=162` (RO) ✓ · `WorkoutEngine.swift` red-alerts hr>ceiling (legacy + design-pass) ✓ · intervals/tempo/easy/shakeout/race label↔spec agree ✓ · every emit-able kind handled by `expandSpecToPhases` (cold-start) ✓.

> **SUMMARY**
> - **WHAT CHANGED** — nothing (read-only audit). AUDIT-FIXES.md updated with Audit D.
> - **FALSIFIERS** — all green (above); RO write-denied confirmed.
> - **WHAT'S LEFT IN THIS LEG** — nothing for the audit. Fix queue: D1 (CRITICAL, code + gated in-place re-spec), D2 (MAJOR, code), D3/D4/D5 (minor).
> - **WHAT I NEED FROM YOU** — review findings; decide D1 severity (CRITICAL vs MAJOR) + whether to proceed to fixes. No fixes applied per instruction.

---

## Audit E — Post-Run Experience  [AUDIT DONE · read-only 2026-06-08 · `DATABASE_URL_RO` as `faff_readonly` · on `7d70e074` (=origin/main) · 0 code/data writes]

**Subject:** the full post-run display layer for 4 completed run types — easy (Jun 5, 6.0mi), interval (Jun 2, 7.5mi 4×1mi @ I), tempo (Jun 4, 8.0mi), long (Jun 7, 12.6mi). Falsify-don't-confirm; every finding verified against real rows. RO write-denied confirmed (`has_table_privilege(faff_readonly,'runs','UPDATE')=false`).

**Headline:** the run-detail data layer is largely sound (distance/pace/HR/zones/splits read from the canonical row correctly), **but the per-phase recap layer is fed by a broken date key**. `loadPhaseBreakdown` + the recap route match watch completions on `ts::date` (evaluated in **UTC**, session TZ=`Etc/UTC`) instead of the run's date. Evening-PT runs roll to the next UTC day, and late-posted completions (the new background-URLSession backlog) carry a post-time `ts`, not a run-time one — so **the Jun 7 long run is served the Jun 5 easy run's phases**. That, plus a `LongMpPanel` gate that misfires on plain longs, is the root cause of "MARATHON SHIFT / AEROBIC BASE 0 MI." 2 CRITICAL, 5 MAJOR, 3 MINOR.

**The known bug, root-caused (2 compounding defects):**
- **E1 (CRITICAL):** `coach_intents` read queries key on `ts::date=$date`. Session TZ is `Etc/UTC`. Reproduced live: query `2026-06-07` → intent **id=207** (`field=…2026-06-05`, dist **6.01**, single `work` phase "6.0 mi easy") = **the Jun 5 easy run**. The real Jun 7 long (id 209, 12.55mi, 1151 paceSamples) has `ts` 23:53 PT → `ts::date`=**Jun 8 UTC** → excluded. The Jun 5 easy was posted **two days late** (`ts` Jun 7 15:36 PT, via the background-sync backlog) → `ts::date`=Jun 7 → collides with the long. The payload `field` (`<uuid>-YYYY-MM-DD`) and `startedAt`/`completedAt` carry the true run date but are ignored. **Affects every surface reading phase_breakdown by date (web TodayView panels, web RunDetailModal, iPhone RunDetailView, work-averages, recap winPhases).** Any-runner: systematic for anyone behind UTC running in the evening, or any late-posted completion.
- **E2 (CRITICAL):** `TodayView.tsx:2193` selects `LongMpPanel` when `d.type==='long' && phase_breakdown.some(p=>p.type==='work')`. The watch emits a **single `type=work` phase even for a plain long** (real id 209 = "12.0 mi long run", `type=work`). `LongMpPanel:3418-3422` does `basePhases=phases.slice(0,workIdx)` → `workIdx=0` → `basePhases=[]` → **AEROBIC BASE 0 MI**, single work phase → **MARATHON SHIFT**. Independent of E1: even with correct attribution, every plain Faff-watch long misfires this. Gate should require an easy/warmup phase *preceding* the work phase (`basePhases.length>0`) or read the plan's `finish_mi`.

**Training form (35 / 59 / -24) — CORRECT, not double-counting.** Reproduced `computeTrainingForm` against the real 60-day series: today=Jun7 → CTL=**35** ATL=**59** TSB=**-24** (exact match), label **LOADED** (correct per recalibrated bands, not OVERREACH). Every day in the window shows exactly **one** non-merged run row → MAX-per-day dedupe works, **no double-count**. -24 is the honest Banister output for a genuine load week (4 quality/long efforts + easies, 1 rest day). On Jun 8 it reads -18 as ATL decays. (MINOR E9: intensity factor defaults to `easy` 0.85 for unplanned/long-as-easy days — 05-31 12.36mi long counted at 0.85 not 0.95; slight undercount, not the question.)

**Leads, answered:**
- **(a) workoutType null → wrong recap default — FALSIFIED.** `workoutType` IS null on all 4 runs (confirmed), BUT the recap classifier is **plan-first** (`recap/route.ts:122` `planRow?.type ?? data.workoutType ?? 'unplanned'`), so it resolves to `long` via the plan match — the recap *text* verdict is correct ("Long run done."). MARATHON SHIFT is **not** caused by workoutType null; it's E1+E2. (Latent: null workoutType only bites for off-plan runs with no plan_workouts match → recap falls to `unplanned`/"Logged.")
- **(b) Jun 7 GPS/paceSamples after HK re-sync — populates automatically.** Jun 7 canonical (watch-only, no pair yet): `route_polyline=null`, `elevGainFt=null`, `weather=null`. The other 3 runs' canonical=apple_watch carry all three. When the iPhone HealthKit sync delivers the apple_watch sibling, `autoMergeForDate`→`enhanceCanonicalFromAbsorbed` (canonical.ts:178-186) copies every field the canonical lacks (route/elev/weather), or canonical flips to apple_watch (as on Jun 2/4/5). Automatic on next HK ingest — no manual trigger. paceSamples (1151) are already in `coach_intents` id 209 but **date-mis-bucketed (E1)** — HK sync fixes GPS/elev/weather but NOT the phase attribution. (MINOR E7-caveat: `weather_enriched_at` was stamped Jun 8 with no GPS → no weather; the lazy-enrich guard `!weather_enriched_at` won't retry → relies on absorb/canonical-flip or a nightly version bump.)
- **(c) Jun 2 splits_unreliable=true — phases still accessible.** `splits_validation={deltaS:+315, splitsSumS:3940 > durationS:3625}` → per-mile GPS sum exceeds run duration by 315s (recovery-jog GPS distance inflates mile times) → flag set, correctly. **The 9 per-rep phases are fully accessible** (id 180, ts Jun 2 → matches): `splits_unreliable` only gates per-MILE splits + drift/fade heuristics (A5), NOT `phase_breakdown`. The interval routes to `RepsRail` (TodayView:2165, first branch) with all 9 phases. Lead answered: phases are independent of the GPS-splits gate.

| # | Finding | Sev | Evidence | Threatens | Any-runner |
|---|---|---|---|---|---|
| **E1** | Phase data keyed on `ts::date` (UTC), not run date → Jun 7 long shows Jun 5 easy's phases | **CRITICAL** | `run-state.ts:807`, `recap/route.ts:137`; session TZ `Etc/UTC`; query Jun7→id207(6.01,easy); real long id209 at Jun8 UTC | Wrong run's per-rep/phase data on every phase-reading surface | Systematic: anyone behind UTC running PM, or any late-posted completion |
| **E2** | `LongMpPanel` fires for plain longs (single `work` phase) → AEROBIC BASE 0 MI | **CRITICAL** | `TodayView.tsx:2193` gate + `:3418-3422`; real long id209 single `type=work` phase | Plain aerobic long shown as a marathon-pace workout with 0 base | Every Faff-watch plain long, any distance |
| **E3** | Plan-vs-actual uses two divergent targets; per-rep "missed" computed vs a stale frozen target | MAJOR | Jun2 phase tgt **389** vs plan_workouts **412**; Jun4 phase **419** vs plan **442**; recap reads plan row, RepsRail reads frozen phase; loadPhaseBreakdown also re-derives heat-adjusted `status` vs frozen tgt | Runner told they missed reps they hit vs the live plan; cross-surface contradictions | Any plan re-pace/re-author after a completed quality run |
| **E4** | `/recap` drops pace + pace-gated wins — reads `data.paceSPerMi` (null), not `avgPaceMinPerMi` | MAJOR | `recap/route.ts:171`; all 4 runs `paceSPerMi=null`, only string set; run-state.ts:614 falls back, recap doesn't | Recap facts lose pace; winTempo/winLong can't fire | Every watch/HK run (the dominant pace shape) |
| **E5** | iPhone /today done-state hardcodes "NAILED IT / ✓ PLAN HIT" for every completed run | MAJOR | `glance-adapter.ts:90-95`; Jun2 (2/4 reps missed) + Jun4 (abandoned) both → done_nailed | Missed/abandoned session reads as a clean hit on the daily companion | Every completed run on the iPhone glance |
| **E6** | Conditions tip is pace-centric + workout-type-blind | MAJOR | `weather-adjust.ts` judgeWeather takes no type; summary always "Costs you ~X% on pace"; tip "don't chase pace" | Easy-run heat coaching frames pace cost where HR/effort is the axis | Every easy/recovery run flagged warm+ |
| **E7** | Jun 7 long detail: no GPS track, no elevation, no weather (watch-only, HK pair unsynced) | MAJOR | dump: `has_route_poly=false`, `elevGainFt=null`, `weather=null`; others (apple_watch) have all 3 | Run-detail card blank on GPS/elev/weather until HK sync | Every watch-direct run before its HK pair lands (PM runs especially) |
| **E8** | `splits_unreliable` not validated on watch-direct rows (Jun 7 = null) | MINOR | Jun7 `splits_unreliable=null`, no `splits_validation`; Jun2=true, Jun4/5=false | Watch-direct splits render ungated until the HK row validates | Watch-direct runs pre-HK-pair |
| **E9** | training-form intensity factor defaults to `easy` (0.85) on no-plan-match days | MINOR | `training-form.ts:168` `?? 'easy'` (no distance inference despite comment); 05-31 12.36mi long @ 0.85 | Slight CTL/ATL undercount on unplanned long/quality days | Any day with a run but no matching plan_workouts row |
| **E10** | Tempo Jun 4 payload `status='abandoned'` (cooldown cut short) | MINOR | id191 `status=abandoned`, cooldown `completed=false`; work phase completed | If any surface reads `status`, a completed tempo mislabels as abandoned (none does prominently today) | Any run where the runner ends during cooldown |

**Per-run × per-question coverage (compact):**
- **Q1 Run Detail Card:** Jun5/4/2 correct (dist/pace/HR/cadence/zones/weather/elev/route all from canonical row, barometric elev sanity OK: Jun2 543ft/7.41mi=73ft/mi). Jun7 missing GPS/elev/weather (**E7**). Shoe unassigned on all 4 (cosmetic). Pace numeric absent everywhere but the string renders on detail (**E4** only bites /recap).
- **Q2 Recap Panel:** Jun2→RepsRail (correct per-rep). Jun4→TempoPanel (phases id191). Jun5→EasyPanel (KEPT IT EASY + HR drift from splits; its 594 paceSamples orphaned to Jun7 by E1). Jun7→**LongMpPanel wrong** (E1+E2). Recap TEXT verdict plan-correct on all.
- **Q3 Mile Splits:** present on all; Jun2 per-mile gated off (unreliable, correct) but per-rep phases shown; no standalone `derive-mile-splits.ts` exists — splits read from `runs.data.splits` (watch/HK per-mile), not paceSample-derived. `splits_unreliable` NOT false on all (Jun2=true, Jun7=null — **E8**).
- **Q4 Plan Comparison:** plan match works for all 4 (active plan `pln_ca91f252bba50c74`). Completion/"done" keyed on `run.data.date` (correct) — day marked done with right mileage. BUT target source diverges (**E3**) and iPhone done-state is always "nailed" (**E5**).
- **Q5 Conditions Tip:** pace-centric + type-blind (**E6**). Jun7 has no weather → no tip.
- **Q6 Training Form:** 35/59/-24 reproduced exactly, no double-count (**correct**); MINOR E9.

**Falsifiers run (all read-only):** RO write-denied ✓ · `loadPhaseBreakdown` query reproduced: Jun7→id207(Jun5 easy 6.01) WRONG, Jun5→empty, Jun4→id191 OK, Jun2→id180 OK ✓ · session TZ `Etc/UTC` ✓ · real Jun7 long = id209 (12.55, single `type=work`, 1151 paceSamples) ✓ · `computeTrainingForm` → 35/59/-24 + every day rows=1 (no double-count) ✓ · `LongMpPanel` `basePhases=slice(0,0)=[]`→0 MI for single-work-phase (source) ✓ · recap reads `data.paceSPerMi`=null for all 4 (source + dump) ✓ · glance `done_nailed` unconditional (source) ✓ · `judgeWeather` type-less, pace-framed (source) ✓ · `enhanceCanonicalFromAbsorbed` populates missing route/elev/weather (source) ✓ · Jun2 `splits_unreliable=true` + 9 phases intact (dump) ✓.

> **SUMMARY (audit only)**
> - **WHAT CHANGED** — nothing (read-only audit). AUDIT-FIXES.md updated with Audit E. RO harness scripts left in the worktree (`web-v2/scripts/_e_*.mjs`, untracked).
> - **FALSIFIERS** — all green (above); RO write-denied confirmed.
> - **WHAT'S LEFT IN THIS LEG** — nothing for the audit. Fix queue logged below.

## Audit E — Fixes E1 + E2  [CODE COMPLETE 2026-06-08 · tsc 0 · 371/371 · awaiting David's go to deploy]

**E1 — Phase reads keyed on field-date, not `ts::date` (UTC)**

**Root cause:** `loadPhaseBreakdown` (`run-state.ts:806`) and the recap route's winPhases query (`recap/route.ts:134`) both matched watch completions on `ts::date` evaluated in session TZ `Etc/UTC`. Evening-PT runs roll to the next UTC day; late-posted background-sync completions carry a post-time `ts` that may be days after the run. The `field` column encodes the run's local date as `<user_uuid>-YYYY-MM-DD` (set by the iPhone relay when it posts the watch completion) — reliable, TZ-safe, delay-immune.

**Fix (same change in both files):**
```diff
- AND ts::date = $2::date
+ AND (
+   CASE WHEN field LIKE '%-____-__-__'
+        THEN RIGHT(field, 10) = $2
+        ELSE ts::date = $2::date
+   END
+ )
```
- Modern entries (all post-May 2026): matched on `RIGHT(field, 10)` = the runner's local run date. TZ-safe for any runner, any posting delay.
- Legacy hex entries (e.g. `862980CB58`): fall back to `ts::date` (same as before — acceptable for historical data).
- **Files changed:** `lib/coach/run-state.ts` · `app/api/runs/[id]/recap/route.ts`

**E2 — `LongMpPanel` gated on `spec.finish_mi`, not phase presence**

**Root cause:** `TodayView.tsx:2193` selected `LongMpPanel` whenever `phase_breakdown.some(p.type==='work')`. The watch emits a single `type=work` phase for plain longs → `basePhases=[]` → AEROBIC BASE 0 MI + MARATHON SHIFT on every plain long. `WorkoutSpecLong.finish_mi` is only set on spec-authored HMP/M-finish longs.

**Fix:**
```diff
- } : d.type === 'long' && runData?.phase_breakdown && runData.phase_breakdown.some(p => p.type === 'work') ? (
-   // Long-run WITH a work phase = MP-finish variant · "THE BUILD".
+ } : d.type === 'long' && runData?.phase_breakdown && runData.phase_breakdown.length > 0 &&
+     (d.workoutSpec as { finish_mi?: number | null } | null)?.finish_mi != null ? (
+   // Long-run with a spec finish segment (HMP/M-pace finish in workout_spec).
+   // Plain longs (single work phase, no finish_mi) fall through to LongPanel.
```
- **File changed:** `components/faff-app/views/TodayView.tsx`

**tsc:** 0 errors · **vitest:** 371 pass / 3 skipped (pre-existing) / 0 fail

**Post-deploy falsifiers (run RO against prod after Railway auto-deploy):**
1. `loadPhaseBreakdown` query for `2026-06-07` → returns id 209 (12.55mi, plain long phases) — not id 207 (Jun5 easy)
2. `loadPhaseBreakdown` query for `2026-06-05` → returns id 207 (Jun5 easy, 6.01mi) — previously returned nothing
3. Jun 7 web display: `LongPanel` (not `LongMpPanel`), correct long-run coaching, no MARATHON SHIFT, no AEROBIC BASE 0 MI
4. Jul 19 HMP-finish long (`finish_mi=7` in spec): still routes to `LongMpPanel` ✓

---

## Audit E — Fix Queue (logged 2026-06-08)

### MAJOR — own session after E1+E2 (E3–E6)
- **E3** — Plan-vs-actual uses two divergent targets: `RepsRail`/`loadPhaseBreakdown` reads the frozen phase target (from the watch completion at time of run), while `recap/route.ts` reads the live `plan_workouts` row. After a plan re-pace, a runner sees "missed" on reps they hit vs the live plan and "hit" against a stale target. Fix: decide canonical source (live plan row wins; phase target is stored execution context only, not the evaluation criterion). Files: `run-state.ts:loadPhaseBreakdown`, `TodayView.tsx:RepsRail`.
- **E4** — `/recap` drops pace for watch/HK runs. `recap/route.ts:171` reads `data.paceSPerMi` (null on all watch/HK rows); `avgPaceMinPerMi` string is always set. COALESCE both fields: `Number(data.paceSPerMi) || parseAvgPaceMinPerMi(data.avgPaceMinPerMi)`. Files: `app/api/runs/[id]/recap/route.ts`.
- **E5** — iPhone /today done-state hardcodes "NAILED IT / ✓ PLAN HIT" for every completed run regardless of execution. `glance-adapter.ts:90-95` ease_off heuristic explicitly deferred ("v1 routes all completed runs to nailed"). Fix: compare `doneMi vs plannedMi` and check `phase_breakdown` verdict distribution (majority missed → `done_ease_off`). Files: `lib/faff/glance-adapter.ts`.
- **E6** — Conditions tip is pace-centric + type-blind. `judgeWeather` returns a single `summary`/`coachTipForNextTime` regardless of workout type. Easy runs in heat should reference HR/effort, not pace cost. Add `workoutType?: WorkoutType` to `WeatherInput`; branch summary/tip copy on easy/recovery vs quality. Files: `lib/coach/weather-adjust.ts`, all callers.

### MINOR — bundle when convenient (E7–E10)
- **E7** — Jun 7 long (watch-only pre-HK-sync): no GPS route, no elevation, no weather. Resolves automatically on HK re-sync via `enhanceCanonicalFromAbsorbed`. One latent issue: `weather_enriched_at` stamped pre-GPS means lazy-enrich won't retry without a version bump. Tracked; self-heals on nightly version bump or next absorb.
- **E8** — `splits_unreliable` is null (not false) on watch-direct rows pre-HK-pair (e.g. Jun 7). Gate reads `=== true` so null rows pass through unvalidated. Fix: add `splits_unreliable` validation at watch completion ingest path (or treat null as "needs validation" at display layer).
- **E9** — `computeTrainingForm` intensity factor defaults to `easy` (0.85) when `inferred_type` is null (no matching `plan_workouts` row). A 12mi long run on a no-plan day gets 0.85 not 0.95 — slight CTL/ATL undercount. Fix: infer type from distance (≥ 8mi → `long`). Files: `lib/coach/training-form.ts`.
- **E10** — Tempo Jun 4 payload `status='abandoned'` (cooldown cut short, work phase completed). No surface reads `status` prominently today, but if a future surface exposes it a completed tempo would mislabel. Fix: treat `status='abandoned'` as completed when the work phase(s) completed. Files: `app/api/watch/workouts/complete/route.ts` or display layer.
