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

## Cluster 1b — HK ingest durability (preserve `mergedIntoId`)  [AWAITING DAVID'S GO · diff ready · 2026-06-06]
**HK ingest durability — MAJOR:** HK re-sync does a full-replace of `data` jsonb (Rule 6 violation), wiping `mergedIntoId`. `autoMerge` re-fires on next cron/ingest and re-flags, but this creates a convergence window where fragile readers double-count and coaching signals see inflated run counts. **Durable fix:** HK ingest must do a field-level jsonb update preserving `mergedIntoId` (and any other backfill flags), not full-replace. This eliminates the window entirely. **Acceptance test:** a HK re-sync of a flagged run must leave `mergedIntoId` intact on the re-ingested row.
- **Severity: MAJOR** — not CRITICAL (the identity reader is correct throughout the window) but a real user-facing wrong-number period between re-sync and cron.
- **Self-heal confirmed — NO manual backfill (David, 2026-06-06).** The nightly `dedupe-runs` cron re-flags 05-31/06-01/06-02 on its next run with the deployed `isSameRun` + `autoMergeForDate(userId, body.date)` + `jsonb_set` (field-level). The 06-06 02:31 re-sync missed them only because it ran *pre-C1* `isSameRun`. Let it self-heal; the cron is the live test (re-check that fragile rejoins identity at 755.15 after it fires).
- **Evidence:** the 3 wiped rows all carry `ingestedAt=2026-06-06T02:31`; fragile reader 755.15 → 779.98 (+24.83 mi = 12.36+5.06+7.41), identity reader stayed 755.15 (read-time dedup robust — C1 thesis proven).
- **Fix (diff ready, awaiting go):** `ingest/workout/route.ts:272` — copy `existing.mergedIntoId` into `data` before DELETE-INSERT, same pattern as `warmupAddedManually`. The `existing` read is already there (line 235). Zero new tsc errors. Falsifier: before=lost, after=preserved, cold-start=null ✓
- **NEW FINDING — P3-2:** 06-02 apple_watch + watch pair both have `mergedIntoId=null` even after the 15:25 re-ingest's autoMerge call — because `isSameRun` returns false for this pair (apple_watch `startLocal` is bare local time, Node/Railway interprets it as UTC, span is 7h off from watch's real start). Same root cause as P3-1 (Strava-local-as-UTC mislabel) but for apple_watch source instead of strava. P3-1 fix stripped Z from strava rows; P3-2 needs equivalent treatment for apple_watch rows in `startUtcMs`. SEPARATE fix, not in this cluster.

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

## Audit C — Plan generation correctness  [NOT STARTED]
`training_plans` / `plan_workouts`: pace targets track canonical VDOT? plan adapts correctly to missed/moved workouts? taper lands for CIM Dec 6? "what's today's workout" single-sourced across surfaces?

---

## Deferred (not in any cluster)
- **Watch-source consolidation + retire `legacy/`** — LAST cutover step, on a Mac that can build/archive a clean `.ipa`. `legacy/` not retirable until then (watch bundle compiles from it via symlink). Preserve `.asc.build`.
- **P3-1 — Strava-local-as-UTC mislabel · isSameRun fix. ⚠️ ACTIVE PHANTOM — AWAITING DAVID'S GO TO DEPLOY (2026-06-05 session).** The 05-26 apple_watch phantom (`-573194905917117`, 7.61mi) was hand-backfilled in C1 but C1b HK re-sync wiped `mergedIntoId` — restoring it. The nightly cron **cannot** fix it because `isSameRun` returns false for this pair.
  - **Root cause:** Strava's `start_date_local` API field always carries a spurious `Z` — it's the athlete's local wall time, not UTC (Strava API quirk; `pullSync.ts:134` stores verbatim). `isTrustworthy(strava)=true` (via `hasOffset`) + `startUtcMs` interprets the Z as UTC → strava span placed at 11:22Z, apple_watch at 18:22Z → 7h apart → `spansOverlap=false`.
  - **Fix (diff reviewed, falsifiers 9/9 green — awaiting deploy go):**
    - `startUtcMs` in `identity.ts`: strip Z from strava rows before interpreting. After strip, strava `11:22:17` → PT (+7h) → 18:22:17Z = apple_watch's UTC → spans overlap → `isSameRun=true`. 3-line change.
    - `pickCanonical` in `identity.ts`: GPS-mislabel distance preference — when tier-winner has ≥10% more distance than a strava-mislabel alt (strava + Z + no IANA tz), GPS-overcounting likely; prefer the lower (strava) distance. Ensures strava 5.91mi wins over apple_watch 7.61mi, giving 755.15mi / 101 runs. 12-line block.
  - **Falsifiers 9/9:** P3-1 pair merges + strava canonical (✓); existing F1-F5 (watch+apple_watch untrustworthy-fallback pairs) unchanged (✓); F6 same-day different-time no-merge (✓); F7 different-date no-merge (✓).
  - **After deploy:** autoMerge/dedupe-runs cron re-merges 05-26 pair automatically (within 24h). No manual backfill needed. C1b guard (preserve `mergedIntoId` on HK re-sync) must follow — until then, phantom recurs on every HK re-sync but self-corrects within 24h.
  - **Concrete acceptance case:** `apple_watch` `11:22:17` bare→PT (7.61mi) + `strava` `11:22:17Z` UTC-mislabel of the same local time (5.91mi) — same run, recorded twice, divergent distance. P3-1 fix must (a) auto-merge this pair despite the frame mismatch, AND (b) pick CORRECT distance (strava 5.91, not apple_watch 7.61). **Full acceptance: fragile reader = 755.15mi / 101 runs after fix+backfill AND a subsequent HK re-sync of either row leaves `mergedIntoId` intact (C1b guard must land first or simultaneously).**
- **MINOR (out of Cluster 1) — volume rounding:** `mileageByDay` sums per-day-rounded day totals (763.2) vs the raw-summed 762.76 — a 0.44 mi **pre-existing** rounding artifact, identical old→new. Follow-up: sum raw canonical distances and round once so by-day and raw-sum readers reconcile exactly. Not a regression; do not bundle into Cluster 1.
- **Separate WRITE Postgres role (infra · Cluster 2)** — `.env.local` has only `faff_readonly` (RO) + `DATABASE_URL` (superuser). Both backfills ran via superuser (reviewed/reversible/approved/shown one-at-a-time). Clean end state needs a dedicated **non-superuser WRITE role** so write sessions never default to superuser. Provision before Cluster 2 writes.
- **`pickCanonical` · trustworthy-timestamp wins when equal (Cluster 2-ish)** — when Δdist/Δdur/Δsplits ≈ 0, prefer the `isTrustworthy` row over the tier-winner. Currently tier-first; GUARD-A only flips at ≥4h gap. David made this call manually **twice** (05-29 HK-over-watch, 06-04 apple_watch-over-watch) → twice = it should be the engine default, not a repeated override. Small `pickCanonical` change, out of Cluster 1.
