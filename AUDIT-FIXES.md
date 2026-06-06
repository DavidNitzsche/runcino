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

---

## Audit A — Run Lifecycle Integrity (plan → watch → run → back)  [NOT STARTED · FIRST audit]
**Highest-value audit for David as a runner.** A planned workout's data must stay true all the way around the loop, and plan vs actual must be comparable. Three legs, each verified end-to-end with real records.

- **LEG 1 — Plan → Watch (outbound):** `build-workout.ts` → `/api/watch/today` → `WatchSync` → watch face. The FULL prescribed workout — intervals, target paces, distances, rep structure, HR targets — arrives and executes on the watch exactly as the backend built it (not just the HR ceiling, already checked). "Plan says 6×800 @ 6:20" → watch runs exactly that.
- **LEG 2 — Watch → Backend (run comes back):** every field of what David ACTUALLY did survives the relay intact — splits, lap times, miles, per-split pace, per-split/per-rep HR, cadence, duration. KNOWN RISK: the watch row currently writes NO splits (Cluster 1 found this; Fix 4a forces split absorption) → per-mile/per-rep data is the most fragile field in the loop. Prove it makes it back, field by field, on a real run, AFTER Cluster 1 ships.
- **LEG 3 — Backend → display + reconciliation:** the completed run reads back correctly on web AND phone (same canonical numbers), AND actual-vs-planned is computable (did I hit the workout?). Verify plan target and actual result are stored in comparable units so "planned 6:20, ran 6:24" is computable.

**Falsifier standard:** take a REAL planned interval workout David ran; trace ONE rep's target pace from `build-workout` all the way to its actual recorded split back in the DB and on both display surfaces — every number accounted for.

**Depends on:** Cluster 1 (split absorption) + Cluster 3 (Watch Codable contract single-sourced) — both change legs 2 and 3.

## Audit B — Architectural source-of-truth sweep  [NOT STARTED]
Enumerate EVERY value every surface (web/iPhone/Watch) displays or writes; prove each reads from backend, not local recompute/store. Flag every local recompute + bypassing write. Fresh session, Phase 0 pre-flight, read-only, falsify-don't-confirm. Depends on Cluster 1 done (consumes volume + VDOT).

## Audit C — Plan generation correctness  [NOT STARTED]
`training_plans` / `plan_workouts`: pace targets track canonical VDOT? plan adapts correctly to missed/moved workouts? taper lands for CIM Dec 6? "what's today's workout" single-sourced across surfaces?

---

## Deferred (not in any cluster)
- **Watch-source consolidation + retire `legacy/`** — LAST cutover step, on a Mac that can build/archive a clean `.ipa`. `legacy/` not retirable until then (watch bundle compiles from it via symlink). Preserve `.asc.build`.
- **P3-1 timezone — HK importer hardcodes PT.** TRAVEL RESIDUAL (specific): an HK+Strava dupe of the SAME run wrong-rejects → new double-count when the run is done OUTSIDE PT, because the importer hardcodes `America/Los_Angeles` while Strava stores true local. Fine for in-PT races (CIM). **Acceptance criterion for the P3-1 fix: an out-of-zone run recorded by both HK and Strava must still merge to one canonical run.** Fix before racing out of zone.
  - **Concrete acceptance case (observed 2026-05-26 · David-confirmed ONE 5.90mi run):** `apple_watch` `11:22:17` bare→PT (7.61mi) + `strava` `11:22:17Z` UTC-mislabel of the same local time (5.91mi) — same run, recorded twice, divergent distance. `isSameRun` MISSES it (trusts the `Z` literally → spans land 7h apart → no overlap). P3-1 fix must (a) auto-merge this pair despite the frame mismatch, AND (b) pick the CORRECT distance (strava 5.91, not the long apple_watch 7.61). Hand-backfilled now with strava canonical; the *mechanism* is P3-1.
- **MINOR (out of Cluster 1) — volume rounding:** `mileageByDay` sums per-day-rounded day totals (763.2) vs the raw-summed 762.76 — a 0.44 mi **pre-existing** rounding artifact, identical old→new. Follow-up: sum raw canonical distances and round once so by-day and raw-sum readers reconcile exactly. Not a regression; do not bundle into Cluster 1.
- **Separate WRITE Postgres role (infra · Cluster 2)** — `.env.local` has only `faff_readonly` (RO) + `DATABASE_URL` (superuser). Both backfills ran via superuser (reviewed/reversible/approved/shown one-at-a-time). Clean end state needs a dedicated **non-superuser WRITE role** so write sessions never default to superuser. Provision before Cluster 2 writes.
- **`pickCanonical` · trustworthy-timestamp wins when equal (Cluster 2-ish)** — when Δdist/Δdur/Δsplits ≈ 0, prefer the `isTrustworthy` row over the tier-winner. Currently tier-first; GUARD-A only flips at ≥4h gap. David made this call manually **twice** (05-29 HK-over-watch, 06-04 apple_watch-over-watch) → twice = it should be the engine default, not a repeated override. Small `pickCanonical` change, out of Cluster 1.
