# Overnight Audit Report
_Session start: 2026-06-08 (overnight, autonomous, read-only)_

Falsify, don't confirm. Read-only throughout (`DATABASE_URL_RO`, role `faff_readonly`). No deploys, no data writes. David reviews in the morning and sends GOs.

---

## 🚨 TOP FLAGS (wrong numbers shown to the runner — display-layer, NOT data corruption)
No data corruption, no live-DB emergencies tonight (RO confirmed; volume/VDOT/form all single-sourced and correct). But three things show a runner a **wrong or fake value** and should be looked at first:
1. **🚨 B1 — iPhone race-day predictions are catastrophically wrong.** `RaceDayView.swift:632` recomputes Daniels race times with a broken inline quadratic → the "WHAT VDOT PREDICTS" table shows **Half = 2:29, Marathon = 5:19** (vs correct 1:34:59 / 3:17:40). Renders for any runner with a VDOT on the race-day screen. Fix: delete the local math, render the backend projection. (Item 1 / Audit B.)
2. **🚨 Item 19 #4 — the `WorkoutDetail` modal shows FAKE weather + fuel.** Every easy run shows "66°·Calm / Novablast 5"; every tempo "67°·Calm / Zoom Fly 6" — hardcoded constants, not live forecast or the runner's gear. A runner planning off this modal sees wrong conditions. (TodayView's primary card is correct; this secondary modal is a stale mockup.)
3. **⚠️ Carry-forward (KNOWN, not new) — the active plan still prescribes goal-anchored paces** (~23s/mi too fast on quality days). The C1 code fix is deployed but David's stored plan `pln_ca91f252bba50c74` was authored pre-fix (`bestRecentVdot=null`) and was never re-paced (regen reversed; in-place re-pace not built). This is the real open training-prescription gap. (Item 7.)

Everything else is correctness-fine or a build/decision item — see per-item entries + the SUMMARY at the bottom.

---

## WORKFLOW START · PASS
**Branch/commit:** Audit runs against the **live `main` line** in the main repo working tree (`/Volumes/WP/06 Claude Code/Runcino`), `main` @ `4a5ea6cf` (= `origin/main`, clean except untracked probe/diag scripts). NOTE: the spawned worktree `claude/wizardly-booth-a8f0e4` is on a **stale Runcino branch** (`web/`+`ios/`, no `web-v2`/`Research`/`AUDIT-FIXES.md`) — irrelevant to this audit; all audited code (`web-v2`, `native-v2`, `Research`) lives only on `main`. Confirmed per standing rule to verify the active branch before working.
**RO confirmed:** `current_user=faff_readonly`; `UPDATE runs WHERE false` → `permission denied for table runs`; `has_table_privilege(runs/plan_workouts/profile, UPDATE)=false`. Mechanically SELECT-only. ✓
**Session TZ:** `Etc/UTC` (relevant to E1/E-class date-bucketing findings).
**Tables reachable (RO counts):** runs=138, plan_workouts=3878, profile=1, users=8, coach_intents=50, races=10, health_samples=2914, projection_snapshots=30. (`plans` relation does not exist under that name — plan-header table named differently; resolved during Audit B.)
**Context read:** `AUDIT-FIXES.md` (667 lines) in full — Clusters 1–4 + Cluster 1b deployed; Audits A/C/D/E done; E1+E2 code-complete; E4+E6 deployed (git log); D1/D2 deployed; D3/D4/D5 + Audit B open.
**Harness:** `web-v2/scripts/_audit_ro.mjs` (guarded — refuses any URL not naming `faff_readonly`).

---

## Item 11 · strava_activities table rename · PASS (scope only)
**Finding:** Cluster-4's claim "zero TS code queries `strava_activities` directly" is CONFIRMED (falsified the risk — found none). The view is defined in `web-v2/db/migrations/129_rename_strava_activities_to_runs.sql` as `CREATE VIEW strava_activities AS SELECT * FROM runs;` (backward-compat alias; the real table is already `runs`). All ~100+ live SQL queries in `web-v2/app` + `web-v2/lib` use `FROM runs`. The 27 `strava_activities` mentions in web-v2 are comments/docs only; remaining hits are migrations (15), `legacy/web` (40+, not live), and scripts (5).
**Evidence:** `web-v2/db/migrations/129_rename_strava_activities_to_runs.sql` (view def). Sample live `runs` queries: `lib/coach/run-state.ts:271`, `lib/coach/log-state.ts:160` (`FROM runs sa` — `sa` is just an alias, not the view), `app/api/watch/workouts/complete/route.ts:263/287`, `lib/coach/state-loader.ts:36`. Zero `FROM strava_activities` in app code.
**Proposed fix:** Rename scope = **TRIVIAL** for the live app (zero app changes needed — already on `runs`). To fully retire the view: (1) update 27 comments web-v2 (cosmetic), (2) migrate `legacy/web` refs (not live — deferrable with `legacy/`), (3) update 5 scripts, (4) `DROP VIEW strava_activities` (gated DDL). Risk: external tools / Railway dashboard queries naming the view break. Matches Cluster-4's "deferred, purely cosmetic, not worth a superuser write" verdict.
**Falsifier:** `rg "FROM strava_activities|JOIN strava_activities" web-v2/app web-v2/lib` → 0 hits (confirmed).
**Awaiting:** DECISION — low priority; retire only when `legacy/` is retired (they move together). No urgency.
**Any-runner:** n/a (infra cosmetic; no runtime/correctness impact for any user).

---

## Item 4 · UTC timezone sweep · MAJOR (inventory)
**Finding:** **46 active hack sites** in `web-v2/` still compute "today" via `Date.now() - 7*3600000` (the deprecated −7h Pacific hack) or naive `new Date().toISOString().slice(0,10)` (UTC), instead of the TZ-aware `runnerToday(userId)`. C6 migrated 2 (`build-workout.ts:275`, `app/api/plan/week`); ~46 remain (the C6 doc said ~36 — the true count is higher). For any non-Pacific runner the −7h hack is systematically wrong; the naive-UTC variant is wrong for everyone in the evening; both flip "which day is today" at the date boundary, and the answer differs *between code paths within one request*.
**Evidence:** Full file:line inventory (28 `runnerToday` files already migrated for contrast). The load-bearing −7h sites:
- **Plan engine:** `lib/plan/generate.ts:63` (the `today()` helper), `:1653`, `:1856` (VDOT lookback window); `lib/plan/core.ts:24` (`todayPT()` export); `lib/plan/drift-monitor.ts:405`; `lib/plan/adapt-block.ts:69`; `lib/plan/injury-builder.ts:46`; `lib/plan/seed-from-onboarding.ts:92`.
- **Coach state:** `training-state.ts:99`, `health-state.ts:188`, `log-state.ts:135`, `profile-state.ts:60`, `races-state.ts:42`, `readiness-brief.ts:300`, `readiness-snapshot.ts:33`, `recovery-brief.ts:204`, `standing-recommendation.ts:94`, `strength-status.ts:65`.
- **API routes:** `briefing/route.ts:161`, `prescription/route.ts:57`, `readiness/subjective/route.ts:45,98`, `today/skip/route.ts:37`, `today/shoe/route.ts:41`, `today/purpose/route.ts:30`, `coach/proposal/route.ts:28`, `notifications/ack/route.ts:138,153`, `cross-training/route.ts:47`, `strength/route.ts:56`.
- **Naive-UTC (no offset at all):** `lib/runs/merge.ts:34`, `lib/plan/adaptive-ramp.ts:281`, `lib/plan/workout-proposals.ts:84`, `app/api/cron/notifications/route.ts:506`, `components/faff-app/cards/WorkoutProposalBanner.tsx:58`, `components/faff-app/toolkit/sheets.tsx:338,487`.
- **Web components:** `components/faff-app/seed.ts:295,358,586`, `components/today/ManualRunButton.tsx:14`.
**Proposed fix:** Migrate every site to `runnerToday(userId)`. This is a sweep, not one diff. Order by risk: plan-engine (generate.ts:63 `today()` + core.ts:24 `todayPT()` are the highest leverage — every plan-gen date flows through them) → coach-state → API routes → components. The naive-UTC sites are arguably worse than −7h (off for everyone in the evening, not just non-Pacific). `lib/training/race-conditions.ts:98` is intentional-UTC (weather forecast boundary) per its comment — exclude.
**Falsifier:** `rg "Date\.now\(\) - 7 \* 3600000|new Date\(\)\.toISOString\(\)\.slice\(0, ?10\)" web-v2/lib web-v2/app web-v2/components | wc -l` → currently 46; target 0 (minus the 1 intentional). After fix, `runnerToday` is the only "today" source.
**Awaiting:** DECISION — confirm this is a single sweep PR (gated, code-only, no data write). Inventory complete; not fixed per instruction.
**Any-runner:** YES — systematic for every non-Pacific runner (−7h sites) and every runner in the evening (naive-UTC sites). David (PDT) masks it today; surfaces in PST winter, travel, and for all other users.

---

## Item 13 · Silent DB-error swallows · MAJOR (top-10 inventory)
**Finding:** **~241 silent-swallow sites** in `web-v2/` (146 are the DB pattern `.catch(() => ({ rows: [] }))`; plus `.catch(()=>null)` ×57, `({})` ×24, `[]` ×14). A query failure (bad column, timeout, permission) is silently converted to "no data" — which, where the empty result feeds a numeric default or `bestRecentVdot`, becomes a **confident wrong coaching number**. This is the exact failure class Audit C C1 already caught (a races query threw on a non-existent column, was swallowed, and silently made VDOT-blending no-op → goal-pace plan for everyone).
**Evidence (top-10, ranked; #1–#3 verified by me against source):**
| # | file:line | feeds | failure mode | throw? |
|---|---|---|---|---|
| 1 | `lib/plan/simulator.ts:276` | VDOT/projection/volume | **VERIFIED**: snapshot query swallowed → `const startVdot = snap?.vdot ?? 45` → a 55-VDOT runner simulated as 45; whole volume ramp + projected finish anchored wrong | **Yes** |
| 2 | `lib/plan/generate.ts:1896` | plan-gen/paces | **VERIFIED**: `raceRows`/`runRows` `.catch(()=>({rows:[]}))` → `bestRecentVdot` undefined → `currentT` null → goalT every week (the C1 bug class, same file) | **Yes** |
| 3 | `lib/plan/generate.ts:1869` | plan-gen/paces | sibling race-candidate swallow into same blend | **Yes** |
| 4 | `lib/coach/runner-calibration.ts:118` | VDOT curve/volume | calibration row swallowed → cold-start `intermediate` defaults; high-responder silently genericized | **Yes** |
| 5 | `lib/plan/generate.ts:2002` | HR/paces | `lthr` swallowed → null → quality-day HR targets wrong for the block | Yes |
| 6 | `lib/training/goal-projection.ts:599` | fitness-drift | VDOT-trend swallowed → "declining" signal suppressed; plan ramps into a real decline | Yes |
| 7 | `lib/plan/adapt.ts:964` | VDOT recalibration | `vdot_last_reviewed` swallowed → PR-bank trigger never fires; stale paces after a breakthrough | Yes |
| 8 | `lib/coach/training-form.ts:158` | CTL/ATL/TSB/ACWR | daily series swallowed → form null; ACWR cutback guardrail (Rule 8) can silently drop | Yes |
| 9 | `lib/plan/drift-monitor.ts:453` | volume baseline | 60d volume baseline swallowed → drift compares vs partial history → spurious/missed rebuilds | Yes |
| 10 | `app/api/targets/projection/route.ts:189` | projected-finish | course elevation swallowed → hilly projection reverts to flat-equivalent (optimistic) | Yes |
**Proposed fix:** Convert #1–#4 first. The pattern to kill: `(await pool.query(...).catch(() => ({ rows: [] }))).rows` *followed by* `?? <numericDefault>` or fed to `bestRecentVdot`/calibration. There the swallow must either `throw` (fail loud) or propagate `null` so the caller **refuses to generate** rather than generating a wrong plan. List-of-intents/check-in reads (the majority) correctly degrade to blank — leave those.
**Falsifier:** for #1, force the snapshot query to error (e.g. rename `vdot` column in a test DB) → current behavior silently yields VDOT 45; fixed behavior throws or returns null and the simulator refuses. Unit-testable with a mocked pool that rejects.
**Awaiting:** DECISION — confirm scope (start with the 4 VDOT/calibration sites; full 241-site sweep is larger). Code-only, no data write.
**Any-runner:** YES — every plan generated while one of these queries is failing gets wrong paces/volume/projection with zero error surfaced. Worst for cold-start (#1 `?? 45`, #4 defaults).

---

## Item 16 · Shoe tracking · MAJOR
**Finding:** Shoe tracking is **broken end-to-end.** (1) Auto-assign has **never once fired in production** for any user (`shoe_auto_assigned_at IS NOT NULL` count across the whole DB = **0**). (2) Watch- and HealthKit-sourced runs **never** get a shoe — `app/api/watch/workouts/complete/route.ts` and both `ingest/*` routes have zero shoe logic; since ~96% of David's runs are watch/HK, almost nothing is auto-tagged. (3) The two manual systems don't reconcile — the `/today` ShoePicker writes `day_actions`, the run-detail modal reads `runs.shoe_id`; a /today pick is invisible on the logged run and adds nothing to mileage. (4) Stored shoe mileage is largely fictional/stale (manual seeds; recompute only runs on the run-level PATCH path, never on ingest).
**Evidence:** Two linkages: `runs.shoe_id integer` (+`shoe_auto_assigned_at`) is canonical; `day_actions(action='shoe', note=<shoe_id>)` is the disconnected per-day pick. Auto-assign `lib/strava/pullSync.ts:255-282 tryShoeFromGear` requires non-empty `gear.brand`/`model`, but Strava sends `{name,nickname}` only → the one Strava run with gear (`2026-05-26`, "Nike Vomero Plus Green") didn't match despite David owning that shoe. Real state (last 12 canonical runs): only the 2 manually-tagged watch runs (05-25, 05-27, shoe_id=7) have a shoe; all 10 others null. `recomputeShoeMileage` (`runs/[id]/route.ts:138-165`) is sound (dedupes MAX-per-day, excludes mergedIntoId) but only fires on PATCH — shoe 7 stored 23.09mi vs assigned-runs sum 12.02mi. AUDIT-FIXES "shoe-picker preferred-wins + ambiguity bailout" does NOT match `tryShoeFromGear` (no preferred fallback, no multi-match bailout — just `LIMIT 1`).
**Proposed fix:** (a) Wire auto-assign into the watch/HK ingest paths (the dominant run source), not just Strava pull. (b) Fix `tryShoeFromGear` to read Strava's real gear shape (`name`/`nickname`) or fall back to the user's `preferred` shoe. (c) Reconcile the two manual systems — `/today` pick should write `runs.shoe_id` (or the modal should read `day_actions` as fallback). (d) Run `recomputeShoeMileage` on every ingest, or compute shoe mileage on-read from canonical runs (single-source — preferred). Note: turning on auto-assign will overwrite the manual mileage seeds with (small) run-sums — migrate seeds first.
**Falsifier:** after fix, a watch-completed run lands with `shoe_id` = the preferred shoe; `shoe_auto_assigned_at` non-null count > 0; a /today pick shows on the run-detail modal; `SUM(runs.distanceMi WHERE shoe_id=X over canonical)` == `shoes.mileage`.
**Awaiting:** DECISION — this is a feature build, not a one-line fix. Confirm priority (David's gear/wear tracking is currently non-functional for watch runs).
**Any-runner:** YES — anyone whose runs come from Apple Watch/HealthKit (the primary path) gets zero shoe tracking; Strava-gear users get none either due to the shape mismatch.

---

## Item 1 · AUDIT B — Architectural source-of-truth sweep · 1 CRITICAL, 2 MAJOR, 1 MINOR
**Method:** for each runner-facing value, traced compute-site → store-site → web read → iPhone read (`native-v2`) → watch read (`legacy/native`). Thesis under test (AUDIT-FIXES doctrine #1): "Backend is the single source of truth; no surface recomputes or locally stores a canonical value." Falsify, don't confirm.

### Source-of-truth map (real, traced)
| Value | Compute site (backend) | Stored? | Web read | iPhone read | Watch read | Verdict |
|---|---|---|---|---|---|---|
| **VDOT** | `lib/training/vdot.ts bestRecentVdot` (one cited fn) — but CALLED from ≥4 sites w/ independent input SQL | `projection_snapshots.vdot` (cron only) | `profile-state.ts:311` **recomputes live** (47.9) | `profile.physiology.vdot` from API ✓ | `proj.vdot` from API ✓ | **B2** input-dup; **B4** store≠display |
| **Paces** | `lib/plan/spec-builder.ts` (`tPaceFromGoal`) + `vdot.ts tPaceFromVdot` | `plan_workouts.pace_target_s_per_mi` + `workout_spec` | reads stored row ✓ | reads stored row (API) ✓ | `/api/watch/today` phases ✓ | single-source ✓ |
| **Weekly volume** | `lib/runs/volume.ts` (one reader, Cluster 1) | computed-on-read from canonical ids | ✓ | API ✓ | API ✓ | single-source ✓ |
| **Training form** | `lib/coach/training-form.ts computeTrainingForm` | computed-on-read | ✓ | API ✓ | API ✓ | single-source ✓ |
| **Projected finish** | `vdot.ts predictRaceTime` / `goal-projection.ts` | `/api/targets/projection` (on-read) | backend ✓ | **`RaceDayView.swift:611` RECOMPUTES locally (broken)** | `raceProjection.vdot` API ✓ | **B1 CRITICAL** |
| **Readiness** | `lib/coach/readiness.ts computeReadiness` | `readiness-snapshot` (daily) + live | ✓ | API ✓ (gauge-fill only) | API ✓ | single-source ✓ (item 14 deep-dive) |
| **HR max / zones** | `lib/training/max-hr.ts loadEffectiveMaxHr` (Cluster 2) | `users.max_hr` (ratcheted) | ✓ | API ✓ | API ✓ | single-source ✓ |

**Headline:** the backend math is mostly genuinely single-sourced (vdot.ts, volume.ts, training-form.ts, readiness.ts, max-hr.ts are each one cited function). The thesis holds for 5 of 7 values. Two real breaks: **(B1)** the iPhone recomputes race projections locally with broken math, and **(B2)** VDOT's compute function is shared but its INPUT assembly is duplicated across ≥4 call sites that demonstrably diverge.

### B1 · CRITICAL · iPhone recomputes VDOT race-time projections locally — and the math is wrong (any-runner)
**Finding:** `native-v2/Faff/Faff/Views/RaceDayView.swift:611-639 vdotPredictionRows(for:)` re-implements Daniels' VO2 inversion inline ("we keep the math in-line · no need to round-trip a new endpoint") to render the "WHAT VDOT N PREDICTS" 5K/10K/Half/Marathon table. The inline formula at line 632 solves the **wrong quadratic** (`0.000104·v² + 4.6·v − vdot·1000 = 0`, putting 4.6 — the VO2 intercept — where the 0.182258 linear coefficient belongs), yielding absurd race velocities.
**Evidence (faithful port, VDOT 47.9):**
```
dist      backend predictRaceTime    iPhone RaceDayView inline    delta
5K          20:41 (1241s)              0:33  (33s)                -1208s
10K         42:52 (2572s)              1:07  (67s)                -2505s
Half      1:34:59 (5699s)              2:29  (149s)               -5550s
Marathon  3:17:40 (11860s)             5:19  (319s)               -11541s
```
The table renders whenever `profileVdot > 0` (`RaceDayView.swift:118-121`), and `RaceDayView` IS mounted (`RootTabView.swift:195 case .raceDay`). David's AFC race-day screen will show a "2:29 half marathon" prediction. Backend already exposes correct projections (`/api/targets/projection`, `ProjectionPayload{vdot,projectionSec}`) — the iPhone ignores them for this table.
**Proposed fix:** delete `vdotPredictionRows`; render projections from the backend (`/api/targets/projection` per distance, or extend `ProjectionPayload` to carry the 4-distance table). Zero local race-time math on any surface — `predictRaceTime` (vdot.ts) is the one cited compute site.
**Falsifier:** after fix, iPhone Half prediction at VDOT 47.9 == backend 1:34:59 (±2s), not 2:29. `rg "0.000104" native-v2` → 0 hits (no local Daniels math).
**Awaiting:** GO (code-only, iPhone — but ships via TestFlight, so log to the sync ledger). DECISION on severity: it's CRITICAL because it shows the runner a wildly wrong number on the highest-stakes screen, but it's iPhone-only and only on RaceDayView.
**Any-runner:** YES — every runner with a VDOT sees broken predictions on the race-day screen.

### B2 · MAJOR · VDOT input-assembly is duplicated across ≥4 backend call sites (any-runner)
**Finding:** `bestRecentVdot()` is one function, but each caller assembles its OWN race+run candidate inputs via a separate SQL query, its own lookback window, its own "today" math, and its own silent-swallow fallback. The function is single-source; **the inputs are not.** Call sites: `lib/coach/profile-state.ts:311` (live recompute for the profile/dashboard 47.9, 180d), `app/api/cron/snapshot-projections` (recompute + STORE to `projection_snapshots`), `lib/plan/generate.ts:1869/1896` (plan paces — Audit C C1 proved its inputs were broken: dead races columns + numeric workoutType + hardcoded null max_hr → goal-pace plan for everyone), `lib/plan/simulator.ts:276` (READS the stored snapshot, `?? 45` on swallow). Because the inputs are independently built, they diverge — exactly what C1 was.
**Evidence:** `profile-state.ts:311 bestRecentVdot(raceCandidates, today, 180, runCandidates)` vs `generate.ts` building its own candidate arrays (C1) vs `simulator.ts:276` reading `projection_snapshots`. Three of the item-13 top-risk swallows (#1/#2/#3) live precisely in these duplicated input paths. The `today` each uses is one of the 46 hack sites (item 4): `profile-state.ts:60` and `generate.ts:1856` both use the −7h hack with different surrounding windows.
**Proposed fix:** extract ONE `loadVdotInputs(userId, today, window)` (races + runs, the corrected C1 queries) that every caller shares — so a fix to the race/run query (or the swallow) propagates everywhere, and there is one input-assembly source, not four. Then `profile-state` and `simulator` read the SAME value (snapshot or live, decided once), not two.
**Falsifier:** grep shows exactly one race-candidate SQL and one run-candidate SQL feeding `bestRecentVdot` across the codebase (currently ≥4). profile-display VDOT == simulator start-VDOT == snapshot VDOT for the same runner/day.
**Awaiting:** DECISION — architectural refactor; confirm before building. (Audit C already fixed generate.ts's inputs; this consolidates the remaining duplication.)
**Any-runner:** YES — any divergence in one input path silently produces a different VDOT on that surface than another.

### B3 · MAJOR · "today" resolved 46 ways → which run/window is current diverges (cross-ref Item 4)
**Finding:** the single most-duplicated "value" is the runner's current date — 46 independent computations (item 4). Every value windowed by date (VDOT lookback, volume window, "today's workout", readiness/recovery boundary) can land on a different day depending on which code path resolved "today." This is the architectural root of C6. See **Item 4** for the full inventory + fix.
**Awaiting:** DECISION (single sweep). **Any-runner:** YES.

### B4 · MINOR · VDOT store-vs-recompute split (any-runner)
**Finding:** `projection_snapshots.vdot` is the stored canonical VDOT (cron-written), but the profile/dashboard recomputes live (`profile-state.ts:311`) and the simulator reads the stored snapshot. If the cron is behind, swallowed (#1), or stale, the displayed VDOT and the simulator/plan VDOT disagree — same value, two sources of truth (a store and a live recompute).
**Proposed fix:** decide one read path. Either the cron-stored snapshot is canonical (display reads it) or live recompute is (cron is just history) — not both feeding different surfaces.
**Falsifier:** displayed VDOT == `projection_snapshots` latest for the same distance/day.
**Awaiting:** DECISION. **Any-runner:** YES (worst when the cron lags).

**Audit B verdict:** thesis largely holds — backend math is single-source for 5/7 values; volume/form/zones/paces are clean. The breaks are (B1) one genuine cross-surface local recompute (iPhone, broken) and (B2/B4) VDOT's input/store duplication. No watch-side recompute found (thin client, reads API). RO confirmed throughout.

---

## Item 14 · Readiness score audit · PASS (1 MINOR finding)
**Finding:** The readiness score is **single-sourced and research-grounded.** One compute site (`lib/coach/readiness.ts:38 computeReadiness(state: CoachState)`); no surface recomputes it (iPhone/watch read it from the API — confirmed in Audit B). Formula is honest and any-runner. ONE minor cold-start issue: a zero-signal user scores **70/READY** (the baseline), which reads as a measured "you're ready" when it's really "we don't know."
**Evidence — the formula (file:line `readiness.ts`):** `score = 70` (BASELINE) then signed pillar contributions:
- **Sleep** (`:42`): ±2 per 0.25h vs 7.5h target, clamp −18/+10. Generic target (not David-tuned).
- **HRV** (`:73`): ±1 per 2% vs the user's OWN 30-day baseline, clamp ±18; luteal-phase −5ms baseline adjust for female/luteal (cites Research/13 §sex-specific).
- **RHR** (`:112`): −2 per bpm above the user's OWN baseline, clamp −12/+6.
- **Load/ACWR** (`:135`): Gabbett 7d:28d bands — `<0.8 −3 · 0.8–1.0 +2 · 1.0–1.3 +5 · 1.3–1.5 −3 · >1.5 −8` (cites Gabbett).
- **HR recovery** (`:186`): ±1 per 2bpm vs own baseline, cap ±5 (60s post-workout drop).
- Clamp 0–100; bands `>85 SHARP · 65–85 READY · 50–65 MODERATE · <50 PULL BACK`. Cites §8.3 doctrine.
- Real range ≈ 9–100 (max +44 / −61 around the 70 baseline). The dashboard 78 = 70 + ~8 net (modest positive pillars), consistent with David's LOADED week.
**Any-runner:** YES-correct — HRV/RHR/HR-recovery are relative to each user's OWN baseline (adapts per person, not David's absolute numbers); ACWR/sleep thresholds are universal/cited. A beginner with their own baselines gets a sensible score.
**The MINOR finding:** cold-start (no HealthKit history) → every pillar hits its `else` branch (weight 0, `observedV:'no data'` + guidance) → `score = 70 → READY`. The pillar breakdown is honest ("No sleep data yet. Wear the watch overnight."), but the **headline band says READY** for a user we have zero signal on. `personas.ts:162 readinessUnknown()` exists but `computeReadiness` never returns it. Per cold-start doctrine ("show `·` with guidance, never a wrong value"), the headline should read `unknown`/`·` when ≥3 pillars are no-data, not a confident 70/READY. Cosmetic secondary: the `· 28%/24%/…` labels are nominal, not the actual point-clamps.
**Proposed fix:** in `computeReadiness`, if ≥3 of 5 pillars are no-data, return `band:'unknown'`/`label:'—'` with the baseline guidance, rather than 70/READY.
**Falsifier:** a CoachState with all pillar inputs null → currently `{score:70, label:'READY'}`; fixed → `{label:'—'/'UNKNOWN'}`.
**Awaiting:** DECISION (cold-start polish; low urgency — affects only brand-new no-watch users).

## Item 15 · Projected finish time audit · PASS (1 DECISION, 1 MINOR)
**Finding:** Projected finish is **research-grounded and intentionally "plan-trusts-itself."** The displayed `PROJECTED FINISH` equals the **goal** (1:30:00) while ON-TRACK/WATCHING — by explicit doctrine (David, 2026-06-04), not a bug. It flips to the current-VDOT-derived projection only when OFF-TRACK. The honest current-fitness projection (`predictRaceTime(47.9, 13.1) = 1:34:59`) is shown as a diagnostic chip alongside, not as the headline.
**Evidence:** `lib/training/goal-projection.ts computeGoalProjection` (cites Daniels §VDOT "training-pace-derived VDOT is valid when training is consistent" + Pfitzinger §LT). Status ladder: `on-track` (proj=goal, no drift) · `watching` (proj=goal, soft signals) · `off-track` (proj=current-VDOT, clear regression). Drift signals are weighted: STRONG (A/B race >2% slow, VDOT trend down ≥1pt/4wk), MEDIUM (aerobic decoupling up, tempo/threshold ≥10s/mi slow 3wk, 2+ forced easy downgrades), WEAK (30%+ key sessions missed/4wk); thresholds `1 strong|2 medium → off-track`, `1 medium|2 weak → watching`. `race-header.ts:104 composeStatus` additionally rolls in readiness band + ACWR. "Watching · 1:30 still in play" = soft drift firing, projection held at goal.
**Does it update as VDOT improves?** The NUMBER does not while on-track/watching (it stays pinned to the goal by design); the **status** + the 30-day `projectionTrend` arrow (`race-header.ts:397`, reads `projection_snapshots` then live re-compute) do. Only an OFF-TRACK flip swaps the headline to the VDOT projection.
**DECISION (any-runner label nuance):** labeling the goal as "PROJECTED FINISH" can mislead a beginner — it reads as "you're on pace for 1:30" when current fitness says 1:34:59. For an experienced runner with the diagnostic chip it's fine; for a beginner the word "PROJECTED" over the goal number is a UX risk. Consider "TARGET / ON TRACK" vs "PROJECTED" wording, or always showing the VDOT projection as a secondary line. (Item 19 product lens.)
**MINOR (code):** `race-header.ts:371,386` computes `projectionGoalStatus` (`'on-track'|'watching'|'off-track'` from `computeGoalProjection`) but the `loadRaceHeader` return object (`:431-443`) ships `status` from `composeStatus` instead — `projectionGoalStatus` is assigned and dropped. Two parallel status computations; confirm which actually drives the rendered "Watching" and whether the goal-projection status is meant to win. Also: `loadCurrentVdot` (`race-header.ts:187`) is a **5th** independent VDOT input-assembly copy (its own header admits "a future refactor should extract one shared `loadCurrentVdot`") — reinforces Audit B / B2.
**Falsifier:** with VDOT 47.9 + goal 1:30 + no drift → `projectionSec == goalSec` (1:30:00) and `vdotProjectionSec == 5699` (1:34:59) as the chip. Force a STRONG drift (VDOT trend −1) → headline flips to 1:34:59, status off-track.
**Awaiting:** DECISION on the "PROJECTED" wording (product) + the redundant-status cleanup (minor). Methodology itself is sound.
**Any-runner:** YES — doctrine + drift signals are general; the only any-runner concern is the "PROJECTED"=goal wording for beginners.

---

## Item 9 · Watch payload completeness · MAJOR (corrects an AUDIT-FIXES claim)
**Finding:** The completion round-trip is intact, but **six `/api/watch/today` payload fields are shipped and never consumed by the watch**, and the most important one is `hrTargetBpm` — **AUDIT-FIXES's "HR target for intervals landed on the watch" is FALSE.** A2 updated the TypeScript interface and the Swift Codable struct, but **only the struct** — no face, view, or engine path reads `phase.hrTargetBpm`. It is decoded (`WatchWorkoutModels.swift:103`), re-stamped (`:228`), and dropped.
**Evidence:** `rg "\.hrTargetBpm" "legacy/native/Faff/FaffWatch Watch App"` → hits only inside `WatchWorkoutModels.swift`; zero in `WorkoutEngine.swift`/faces. The watch's HR logic reads only `workout.hrCeilingBpm` (`WorkoutEngine.swift:608-613`). **Semantic split-brain:** backend sets `hrTargetBpm` only for quality (`build-workout.ts:397`) and `displayHint:'hr'` only for `long` (`:485`) — so the workouts that carry an HR target never route to an HR face, and the workout that gets the HR face carries no target. `hrTargetBpm` cannot reach a face under any code path. Dead-but-shipped fields: `hrTargetBpm`, `summary`, `paceLabel`, `readinessScore`/`readinessLabel` (watch reads a separate `/api/watch/readiness`), `strategyLabel`, `completionEndpoint`. Producer gap: `fueling` has a working engine consumer (`WorkoutEngine.swift:628`) but `buildWatchToday` never populates it → training fuel haptic is dark on the live path.
**Round-trip (intact):** completion sends every per-phase actual (`actualDistanceMi`/`actualPaceSPerMi`/`avgHr`/`maxHr`/`paceSamples`/`hrSamples`/`timeInToleranceSec`/`verdict`), stored to `coach_intents`; splits + whole-run HR derived server-side. **Caveat:** `verdict` is **pace-only** (`WorkoutEngine.swift:916`) — HR actuals are sent but never adjudicated, so for easy/long (where HR is the stated discipline) plan-vs-actual on the HR axis is raw-data-only, never graded.
**Proposed fix:** (1) Wire the watch to actually render `hrTargetBpm` on quality work phases (an HR target sub-row), OR stop shipping it and the other 5 dead fields. (2) Resolve the displayHint/hrTarget split so quality sessions can show an HR reference. (3) Populate `fueling` in `buildWatchToday` or remove the dark consumer. (4) Consider an HR-dimension verdict for easy/long.
**Falsifier:** after fix, an intervals workout on the watch shows the per-phase HR target (162); `rg "hrTargetBpm" watch-faces` > 0. Or: drop the field and `rg hrTargetBpm legacy/.../FaffWatch` → 0.
**Awaiting:** DECISION — correct AUDIT-FIXES (the A2 hrTargetBpm claim overstated "landed"); decide consume-vs-remove for the 6 dead fields.
**Any-runner:** YES — every runner doing a quality session on the watch is missing the HR reference the backend computes for them.

## Item 5 · Coaching doctrine grounding · MAJOR (inventory)
**Finding:** The recurring failure is **not** missing citations — nearly every rule has a `Cite:` — it's that the cited **§-anchors are made-up semantic labels that don't resolve to any real Research heading** (Research files use numbered headings `## 9.1`, `### 7. Race-specific`). So "every rule cites Research" is cosmetically satisfied but **unverifiable** — a reviewer grepping the anchor finds nothing. The sanctioned `lib/plan/citation.ts` enum institutionalizes it, even naming a **file that doesn't exist** (`Research/04-workouts-and-progressions.md`; actual is `04-workout-vocabulary.md`). On top of that, three rules have **numeric** mismatches with the doctrine they cite.
**Evidence (rule | code | issue):**
- **F1 · Rule 3 pace ramp** (`generate.ts:1115-1132 tPaceForWeek`): current→goal T blend over "first 60% of build," linear. Cites `docs/PLAN_ENGINE_MID_BLOCK_DOCTRINE.md §Rule 3` — an **internal doc, not Research**. The 60%/linear cadence is an engine invention (direction is sound; the specific window is uncited).
- **F2 · Taper** (`generate.ts:373 BLOCK_SHAPE`, `:556 volumeCurve`): cites `Research/00a §race-specific-prep` — **anchor doesn't exist**. Real taper table is `Research/08 §9.1`. Taper volume factors (0.45/0.60/0.75) don't trace §9.2's 80-90%→60-70%→40-50% curve — **shape mismatch** (first cut too shallow for marathon).
- **F4 · Long-run finish %** (`generate.ts:686-695 longFinishSegment`): emits 0.40/0.33/0.33/0.30, cites `Research/22 §3`. But §3/§4 samples prescribe **HM "last 8 of 16mi @ HMP" = 50%**, **M "last 14 @ M" = 64-70%** — code is 10-30 pts **more conservative** than the cited number. (Note `Research/00a §Fast finish` says "final 10-25%" — the two Research sources disagree; code matches neither.)
- **F5 · Pace offsets** (`spec-builder.ts:172-177`): easy T+60/+110, long T+55/+90, tempo T+12, interval T−18, mp T+18 — file-level cite only, no per-offset anchor. Vs Research/01's VDOT-50 worked example: easy low-end ~44s too fast, interval ~15s/mi off Daniels I. Plausible but uncited-at-line and two measurably diverge.
- **F3 · Quality menu** (`generate.ts:830-842`): HM RACE-SPECIFIC `['threshold','intervals']` is doctrinally **correct** (matches §3), but its citations (`§intervals-and-threshold`, `§quality-types`, enum `§quality-mix-by-distance`) are all **phantom anchors**; the inline catalog `:624` cites valid `§5`/`§6` — two citation styles for the same fact, one real, one invented.
**Proposed fix:** re-anchor citations to real numbered headings (`generate.ts:360`→`08 §9.1`; `:686`→`22:213/255/274`; `spec-builder.ts:172`→`01:265`; fix `citation.ts:42-44,53` phantom filename+anchors). Separately, DECIDE the three numeric mismatches (F2 taper shape, F4 finish %, F5 easy/interval offsets): either bring the engine to the cited number or document the deliberate deviation with a real cite. This is the proper subject of the logged "Coaching Doctrine Generalization" audit.
**Falsifier:** every `Cite: Research/...` in `generate.ts`/`spec-builder.ts`/`citation.ts` resolves to a heading that `rg` finds in that file; F2/F4/F5 values match the cited table or carry an explicit "deviation: …" note.
**Awaiting:** DECISION — citation re-anchoring is mechanical (GO-able as a sweep); the 3 numeric deviations need David's doctrine call.
**Any-runner:** YES — F2/F4/F5 affect the plan shape (taper depth, long-run stimulus, easy/interval paces) for every generated plan.

## Item 6 · Splits multi-phase derivation · PASS (read-only; clear recommendation)
**Finding:** Server-side concatenation of phase-relative `paceSamples` into a whole-run cumulative series **works** (proven on the Jun 2 interval run — monotonic, no reversals), but **integer-mile splits are the wrong unit for interval runs** and should not be surfaced. The meaningful per-rep numbers already exist in each work phase's `actualPaceSPerMi`/`actualDistanceMi` and need no concatenation.
**Evidence:** Jun 2 = `coach_intents` id 180, 9 phases, 680 paceSamples. Phase-relativity CONFIRMED (every phase first sample `tSec=0`; resets at each boundary). Real per-rep actuals: **Rep1 6:28 · Rep2 6:33 · Rep3 6:58 · Rep4 7:01** (from work-phase `actualPaceSPerMi`). Concatenation algorithm (running `offT/offD` offsets, interpolate integer-mile crossings) produces monotonic 6.93mi cumulative — but the integer-mile buckets (8:18/7:07/8:21/8:37/9:11/7:10) **smear reps + recovery jogs into meaningless values**. The current GPS per-mile splits for Jun 2 (`8:09,7:10,8:20,8:24,7:16,8:11,7:14,7:49`, `splits_unreliable=true`) are correctly flagged garbage. Distance note: concatenated 6.93mi ≈ summed phase 6.97mi vs `totalDistanceMi` 7.41 — the 0.44mi gap is un-phased transition drift; the paceSample-derived distance is the more trustworthy number.
**Proposed fix:** build `lib/coach/derive-mile-splits.ts` (the AUDIT-FIXES proposal) but scope it: use concatenation→integer-mile splits for **single-phase EASY/long runs only** (proven Jun 5 easy: 8:28/8:10/8:15/8:13/8:26); for **intervals**, render the **rep ladder straight from work-phase actuals** (already present, no concat). The concatenated cumulative series is still useful for a full-session HR-vs-pace trace.
**Falsifier:** easy run → paceSample-derived per-mile splits within ±3s of GPS truth; interval run → rep ladder shows 6:28/6:33/6:58/7:01 (work-phase actuals), no integer-mile splits surfaced.
**Awaiting:** GO to build `derive-mile-splits.ts` (easy-run scope) — replaces the unreliable iPhone GPS splits at the source. Read-only investigation complete.
**Any-runner:** YES — fixes the `splits_unreliable` saga (A4/A5/P3-3) for every Faff-watch run; intervals get correct per-rep display for everyone.

---

## Item 10 · Race result logging flow (AFC→CIM) · MAJOR (confirmed missing — future feature)
**Finding:** The post-race flow is **MISSING at the entry point and PARTIAL downstream.** `races.actual_result` jsonb exists but **has no live writer in `web-v2`** — the "Tap to log" UI (web `RaceView.tsx:256`, iPhone) calls `PATCH /api/race` which writes `meta.finishTime` only, never `actual_result`. The `/results` endpoint referenced in code comments (`races-state.ts:60`) **does not exist**. There is also **no stored VDOT column** (`users`/`profile` have none — RO-confirmed) — VDOT is recomputed on-read by `bestRecentVdot()`, so "update VDOT from result" means recompute, not write.
**Evidence (RO):** `races` schema: `slug,plan,gpx_text,meta,actual_result,saved_at,user_uuid,course_geometry,...`. David's races: `actual_result` populated on 5/10 (all past, all `recordedAt` 2026-05-18/19 = a one-time backfill via a `legacy/web` admin route that doesn't exist in web-v2); **AFC (Aug 16) `actual_result = NULL`**, CIM (Dec 6) NULL. Global: only 5 rows have `actual_result` anywhere, none written by a live path. `rg "UPDATE.*actual_result|set.*actual_result" web-v2` → 0. 4-step verdict:
| step | status | evidence |
|---|---|---|
| (a) log result → `actual_result` | **MISSING** | only `meta.finishTime` is written (`app/api/race/route.ts:138`); no `actual_result` writer, no `/results` route |
| (b) result → VDOT update | **PARTIAL** | no stored VDOT to update; `cron/snapshot-projections:54` DOES read `actual_result.finishS` → self-heals next run *if a result existed*; `PATCH /api/race:225` recomputes VDOT into `coach_intents` only when BOTH `finishTime` AND `avgHrBpm` present |
| (c) archive completed plan | **PARTIAL** | `cron/plan-drift:122 race_graduate` fires when `race_date < today-1d` (date-keyed, **not** result-keyed); rebuild sets `archived_iso` |
| (d) next-plan from post-race fitness | **PARTIAL** | same `race_graduate` builds the next A-race plan, but base VDOT = whatever `bestRecentVdot` derives (AFC result never written → not in the base); HM→M bridge is Rule 11 cap-only/volume-blind (AUDIT-FIXES:314) |
**Proposed fix (what must be built):** (1) an `actual_result` writer — extend `PATCH /api/race` (jsonb_set, never clobber Strava-enriched fields) or build `POST /api/race/[slug]/results`; accept `finishS` (+avgHr/splits), stamp source/recordedAt; decide whether `meta.finishTime` promotes into `actual_result.finishS`. (2) on result write, recompute VDOT (not gated on avgHr) + bust briefing cache for immediacy. (3) re-key archive/graduate on the logged result (or accept date-trigger + feed the result into the rebuild). (4) post-race-fitness-anchored next-plan: `race_graduate` uses the just-logged AFC result as VDOT anchor + Rule 11 volume-aware (in-place re-pace per PLAN-GEN CRITICAL #1, never full regen). (5) an "archive-and-propose-next" UI surface (the doc wants propose, not silent auto-graduate).
**Falsifier:** after build, logging AFC finish writes `races.actual_result.finishS`; next snapshot VDOT reflects it; CIM plan base VDOT = post-AFC; archive fires on the result.
**Awaiting:** DECISION — this is a designed feature (AUDIT-FIXES:383). Not urgent until ~Aug 16, but it's the AFC→CIM training-continuity backbone; design before then.
**Any-runner:** YES — any runner with a goal race + a follow-on race has no result→fitness→next-plan continuity; the race they just ran doesn't inform what comes next.

---

## Item 7 · Plan adaptation correctness · PASS (C3 confirmed working; 1 MAJOR cross-ref)
**Finding:** Three sub-questions answered against live data. (1) **VDOT ratchet** runs daily but is a correct no-op. (2) **C3 fix is WORKING in prod** — `last_adapted_at` is a truthful "cron evaluated" stamp and `adaptation_log` is honestly empty (zero real adaptations). (3) **The active plan still carries pre-C1 authoring** (`bestRecentVdot=null`) — confirming the open C1/C4 gap: the deployed code fix never reached David's stored paces.
**Evidence (RO):**
- **VDOT history:** `projection_snapshots` for David = **47.9 flat across 15 HM snapshots, 2026-03-31 → 2026-06-07** (30 rows total, last cron 06-07). VDOT has NOT moved since training started (06-01) — *correctly*: the Disney Half (Feb 1, 5694s → 47.9) is the anchor and no race/qualifying run has exceeded it. Interval runs don't ratchet (whole-run `vdotFromRun` on a 4×1mi averages in warmup+recoveries → sub-anchor). The ratchet (`snapshot-projections` cron) is RUNNING; `GREATEST(47.9, 47.9)` is a no-op, not silence.
- **`last_adapted_at` = 2026-06-08 08:13 UTC** but **`adaptation_log = []`** (len 0). This is exactly the C3 Option-C design: the stamp proves the cron fired today; the empty log proves nothing actually changed. C3 fix verified live ✓. `plan_mutations` = none for the plan. The plan has had **zero real adaptations** (consistent with C4 — no underperformance trigger — and the static-plan state).
- **Active plan** `pln_ca91f252bba50c74` (AFC, goal 08-16, not archived): `authored_state.derived_from = {bestRecentVdot: null, recentWeeklyMi: 39.1, recentLongMi: 12.4, tsbAtStart: -21, recentQualityDistanceMi: 7.5}`. **`bestRecentVdot: null`** = authored while C1 was broken → paces anchored to GOAL (407/T), not current VDOT (430/T). The C1 code fix is deployed but this stored plan was never re-paced (the 06-07 regen was reversed because it re-rolled distances; the in-place re-pace mechanism — PLAN-GEN CRITICAL #1 — is not built).
- **Phase/week ID:** structurally sound — date-driven (`plan_workouts.date_iso → week_id → plan_weeks → plan_phases`); the plan is well-formed (77 workouts 06-01→08-16). For David (Pacific) the −7h `today` hack (item 4) agrees with `runnerToday`; a non-Pacific runner could land on the wrong week at the boundary.
**Proposed fix:** none new — this confirms the already-logged C1 (in-place re-pace) + C4 (underperformance adaptation) work. The ONE actionable: the active plan's quality paces are still ~23s/mi too fast (goal-anchored) until the in-place re-pace ships. The VDOT ratchet + C3 need no change.
**Falsifier:** `projection_snapshots` VDOT moves above 47.9 only after a race/quality run that beats the Disney anchor (correct). `adaptation_log` grows only on a real mutation (currently []). Active-plan week-1 interval pace = 389 (goalT−18), not 412 (currentT−18) — proves the stored plan is still pre-C1.
**Awaiting:** GO/DECISION — the C1 in-place re-pace (re-pace `pln_ca91f252bba50c74` without re-rolling distances) is the real action; needs the in-place mechanism + gated DB write. C3 + ratchet are PASS.
**Any-runner:** YES — the in-place-re-pace gap means any runner whose plan was authored pre-fitness-read keeps stale paces; the C3/ratchet behaviors are correct for all.

---

## CHECKPOINT 1 (items 1, 4, 5, 6, 7, 9, 10, 11, 13, 14, 15, 16 complete)
**Headline:** No data-corruption or wrong-prescription emergencies tonight. The biggest single finding is **B1 — the iPhone race-day screen renders catastrophically wrong race predictions** (broken local Daniels math; Half shows 2:29 vs 1:34:59). Otherwise: backend math is genuinely single-sourced for 5/7 values; the recurring architectural theme is **duplication of inputs/anchors, not of formulas** (VDOT input-assembly ×5 sites, "today" ×46 sites, silent swallows ×241).

**Ready for GO (code-only, gated, no data write):**
- Item 4 — `runnerToday` sweep (46 sites; mechanical, do in risk order).
- Item 13 — convert the 4 VDOT/calibration silent-swallows (#1–#4) to throw/propagate-null.
- B1 (Item 1) — delete iPhone `vdotPredictionRows`, render backend projections (ships via TestFlight).
- Item 6 — build `derive-mile-splits.ts` (easy-run scope).
- Item 5 — re-anchor phantom citations to real Research headings (mechanical part).

**Needs DECISION from David:**
- B2/B4 — consolidate VDOT input-assembly + store-vs-recompute (architectural refactor).
- Item 5 — the 3 numeric doctrine deviations (taper shape F2, long-finish % F4, easy/interval offsets F5).
- Item 9 — consume vs remove `hrTargetBpm` + 5 other dead watch-payload fields; AUDIT-FIXES A2 claim needs correcting.
- Item 16 — shoe tracking is a feature build (auto-assign dead, watch runs never tagged, two manual systems unreconciled).
- Item 10 — race-result→VDOT→next-plan flow (design before Aug 16).
- Item 14 — readiness cold-start should return `unknown`, not 70/READY.
- Item 15 — "PROJECTED FINISH" wording shows the goal (beginner-misleading); + redundant status cleanup.

**Confirmed PASS / correct:** Item 7 (C3 fix live, VDOT ratchet correct no-op), Item 11 (strava_activities trivial), readiness/projection methodologies (research-grounded), volume/form/zones single-sourced.

**Carry-forward (the real prescription gap):** the active plan still has pre-C1 goal-anchored paces (~23s/mi too fast on quality) — fixed in code, not in David's stored plan; needs the in-place re-pace (CRITICAL #1).

---

## Item 8 · Cold-start user audit · MAJOR (validation gate missing; 1 trace)
**Finding:** 7 plan-less accounts confirmed (all `onboarding_complete=false`, `level=intermediate`, 0 races/runs/plans — RO). Tracing "set a goal race today" (NO real plan generated — source-trace + C5): the plan **generates without crashing** and the **480 fallback is deployed**, but **the plan-validation gate (PLAN-GEN CRITICAL #2) is NOT built**, so a malformed cold-start plan would persist unchecked; and a brand-new runner is prescribed **goal-race pace blind** (C1 at its most dangerous).
**Evidence:** plan-less ids incl. `864fe38c-…`, `43528dcd-…`, `052d86f2-…`, + 2 seed ids `99999999-…` (RO). Trace:
| sub-question | verdict | evidence |
|---|---|---|
| valid plan w/ VDOT-anchored paces? | **PARTIAL** | generates (volume from `VOLUME_FLOOR_MPW.intermediate`), but no history → `bestRecentVdot` undefined → paces anchor to GOAL, not VDOT (C1). A beginner with an aggressive goal gets wildly fast reps. |
| 480 cold-start fallback fires? | **YES** | `generate.ts:1880 tPaceFromGoal(...) ?? 480` (C5, deployed) — no-goal case → 480 s/mi base, no garbage paces |
| validation layer catches bad output? | **NO (gap)** | PLAN-GEN CRITICAL #2 (validate-or-throw gate between build and persistPlan) is **not built** — would have caught the choppy 11,11,11,9,… regen. No gate exists today. |
| UI degrades gracefully? | **YES** | Cluster 3 Item 2: profile/physiology tiles → `·` + guidance; no blank tiles/crash. Readiness shows **70/READY** (item 14 finding — should be `unknown`). |
**Proposed fix:** (1) build the validation gate (CRITICAL #2) — throw on HM-long >~14mi, >10% WoW spikes, missing taper, etc. (2) cold-start VDOT: when no history AND a goal, either anchor paces conservatively (not goal pace) or surface "paces will sharpen as you log runs." (3) readiness `unknown` (item 14). The 480 fallback is already correct.
**Falsifier:** a constructed cold-start plan with a 14→9→14 long progression → validation gate THROWS (currently persists). New runner + 1:30 goal → week-1 interval pace is conservative, not 389/goalT.
**Awaiting:** DECISION — validation gate is the high-value build (any-runner safety net); cold-start pace-anchor is a doctrine call.
**Any-runner:** YES — every brand-new runner who sets a goal gets goal-pace prescription with no validation backstop; worst for beginners with aggressive goals.

## Item 12 · Weather-adjust test coverage · PASS
**Finding:** The E6 conditions-tip fix introduced **no gaps and no regressions.** Full project suite **376 passed / 3 skipped / 0 failed** (12 files); the 3 weather-touching files (`weather-adjust.test.ts`, `run-recap.test.ts`, `identity.test.ts`) = **71/71**. `weather-adjust.test.ts` alone = 31 tests covering the type-aware tip logic. (AUDIT-FIXES baseline "351/0" has since grown to 376/0 — suite expanded, still green.)
**Evidence:** `npx vitest run` (main repo, real node_modules) → `Test Files 11 passed | 1 skipped`, `Tests 376 passed | 3 skipped`. Weather subset run explicitly → 71/71.
**New-test note:** the type-aware tip branch (easy/recovery vs quality) IS exercised by `weather-adjust.test.ts`. One thing NOT yet asserted: a dedicated test that an *easy-run* heat tip frames HR/effort (not pace) and a *quality-run* tip frames pace — worth adding 1-2 explicit type-branch assertions to lock E6's intent. Side-observation: `adapter-bench.test.ts` emits an intentional `[adapter-audit]` log that the volume-adapter cap (`cap*1.25`) can false-fire for **beginner/ultra** tiers (e.g. hm/developing upper 35 > 31.25) — a logged any-runner caveat (passing test, not a failure) worth its own ticket.
**Falsifier:** `npx vitest run lib/coach/weather-adjust.test.ts` → 31/0 (confirmed); full suite 0 failures (confirmed).
**Awaiting:** nothing — PASS. Optional: add 2 type-branch assertions for E6.
**Any-runner:** the adapter-cap caveat (beginner/ultra false-fire) is the only any-runner item surfaced here; tracked separately.

---

## Item 17 · A1 — Outbound payload storage · DECISION (scope/design only)
**Finding:** `/api/watch/today` (`build-workout.ts` → `app/api/watch/today/route.ts`) builds the payload live every request and stores **nothing** — when a plan→watch handoff is wrong for any user, there is zero server-side artifact to diff against. `coach_today_cache` is dead since 05-25 (A7) and unusable (integer PK, no `user_uuid` → cross-user risk). 
**Proposed design (no code — scope):**
- **Table** `watch_payload_log`: `id bigserial PK`, `user_uuid uuid NOT NULL`, `date_iso text NOT NULL`, `built_at timestamptz DEFAULT now()`, `kind text` ('today'|'glance'|'readiness'), `plan_id text`, `workout_id text`, `payload jsonb NOT NULL`, `app_version text`, `request_id text` (correlate with the client's fetch). Index `(user_uuid, date_iso, built_at DESC)`.
- **Write:** fire-and-forget INSERT at the end of the `/api/watch/today` handler (non-blocking; never fail the request on a log error — but log the log-failure, don't swallow silently à la item 13). One row per fetch (a few/user/day).
- **Retention:** rolling 30–45 days; a line in an existing nightly cron prunes `built_at < now()-45d`. Volume is tiny.
- **Payoff:** when a runner says "the watch showed the wrong workout," read the exact bytes sent + timestamp, diff vs the `plan_workouts` row and the completion → isolates build-workout bug vs watch-render bug vs stale-fetch. Also captures the A2/B1/item-9 dead-field shipping for forensic confirmation.
**Awaiting:** DECISION — approve the table + write path (then it's a small gated DDL + a code PR). Real, not urgent.
**Any-runner:** YES — debuggability for every user's handoff, not just David's.

## Item 18 · Dedicated write DB role · DECISION (scope/design only)
**Finding:** `.env.local` has only `DATABASE_URL_RO` (faff_readonly) and `DATABASE_URL` (**superuser**). Every approved write (backfills, DDL) has run as superuser. Application writes should never default to superuser.
**Proposed design (no code — scope):**
- **Role** `faff_writer` (LOGIN): `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public` + `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public`. **No** CREATE/DROP/ALTER (no DDL), **no** role management, **not** superuser. `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO faff_writer` so new tables are covered automatically.
- **Provision:** create the role (gated DDL, superuser, one-time), add `DATABASE_URL_WRITE` to Railway env, repoint the app's write pool (`lib/db/pool.ts`) to it. Keep `DATABASE_URL` (superuser) for migrations/DDL only, used explicitly + per-statement gated.
- **Three-tier end state:** `faff_readonly` (read sessions, audits) · `faff_writer` (all app writes) · superuser (DDL/migrations only, gated). Falsifier: as `faff_writer`, `INSERT/UPDATE/DELETE` on `runs` succeed but `CREATE TABLE`/`DROP` → permission denied; app writes work end-to-end.
**Awaiting:** DECISION — approve provisioning. Matches the AUDIT-FIXES "Separate WRITE Postgres role" deferred item. Security hardening; do before the next batch of app writes.
**Any-runner:** n/a (infra/security; protects every user's data from an over-privileged app connection).

---

## Item 2 · E3 + E5 implementation · proposed diffs (read-anchored, NOT applied — await GO)
_E4 + E6 deploy confirmed clean (full suite 376/0, item 12), so E3+E5 are unblocked. I did NOT apply these to `main` (keeps the tree clean overnight); they are read-anchored against the cited lines, tsc-pending-on-apply. David: GO and I apply + tsc + diff + deploy via the normal pipeline._

**E3 — frozen phase target as the evaluation contract.**
Root cause (confirmed): `app/api/runs/[id]/recap/route.ts:126-130` judges against the **live** `plan_workouts` pace (`COALESCE(pace_target_s_per_mi, spec rep_pace, …) AS pace_target_s` → `plannedPaceSPerMi` at `:197,:224`), while `loadPhaseBreakdown` (`run-state.ts`) + `RepsRail` judge against the **frozen** per-rep target shipped to the watch (stored in `coach_intents`, already loaded for A4 at `recap/route.ts:155`). After a re-pace these diverge → the runner is told they "missed" reps they actually hit vs the live plan.
Fix (David's call — frozen wins; it's what they were told to run):
```text
recap/route.ts — when a coach_intents completion exists for the run date (frozen phases already loaded ~:155),
  set plannedPaceSPerMi from the FROZEN phase target (the work-phase targetPaceSPerMi), NOT pw.pace_target_s.
  Fall back to pw.pace_target_s ONLY when no frozen phase exists (non-Faff-watch runs / cold-start).
  Add `planNowSPerMi` = pw.pace_target_s when |frozen − live| ≥ 10 s/mi; null otherwise.
TodayView.tsx RepsRail + recap header — render a secondary note "plan now: M:SS" when planNowSPerMi != null,
  so the re-paced target is visible WITHOUT overriding the verdict.
```
`loadPhaseBreakdown` already uses the frozen target, so the net effect is recap stops contradicting RepsRail; both judge vs frozen, with a non-authoritative "plan now" note when the plan moved.
Files: `app/api/runs/[id]/recap/route.ts` (primary), `lib/coach/run-state.ts` (surface `planNowSPerMi`), `components/faff-app/views/TodayView.tsx` (render note). Falsifier: a re-paced run (frozen 389, live 412) → recap verdict computed vs 389, note "plan now 6:52", RepsRail + recap agree.

**E5 — web (server-side) done-state branches on execution, not just "ran".**
Root cause: `lib/faff/glance-adapter.ts:90-94 doneState()` returns `'done_nailed'` for **every** completed run ("v1 routes all completed runs to nailed"). Overreach and fell-short both read as a clean hit.
```diff
// lib/faff/glance-adapter.ts  (doneState, ~:90-94)
-    // n heuristic deferred — v1 routes all completed runs to nailed.
-    // Future: compare doneMi vs plannedMi (>=125% = ease_off) + HR drift.
-    return 'done_nailed';
+    // 2026-06-08 · E5 · branch on execution.
+    if (today.plannedMi > 0 && today.doneMi >= today.plannedMi * 1.25) return 'done_ease_off';
+    const verdicts = today.phaseVerdicts ?? [];      // from loadPhaseBreakdown — plumb if absent
+    const missed = verdicts.filter(v => v === 'missed' || v === 'slow').length;
+    if (verdicts.length > 0 && missed * 2 > verdicts.length) return 'done_fell_short';
+    return 'done_nailed';
```
Plus add the new `'done_fell_short'` state to: the color map (`:122-123` → `'g-warn'`), the headline switch (`:147-149` → `'CAME UP SHORT.'`), and `lib/faff/state-tokens.ts`. Coach copy (sub-line): **"Came up short. That's data — note what was hard and bring it to the next one."** "Web-only" = this is the server-side glance-adapter; the iPhone renders the result via API, no Swift change. Prereq: confirm `phaseVerdicts` is on the `today` glance input; if not, plumb it from `loadPhaseBreakdown` (same date-key fix as E1 — make sure it reads the right run's phases).
Files: `lib/faff/glance-adapter.ts`, `lib/faff/state-tokens.ts`. Falsifier: Jun 2 (2/4 reps missed) → `done_fell_short` "CAME UP SHORT"; an easy run at 1.3× planned → `done_ease_off`; a clean run → `done_nailed`.
**Awaiting:** GO — then I apply both, run tsc + vitest, show the real git diff, deploy via pipeline.
**Any-runner:** YES — both fix cross-surface honesty for every runner (E3: re-paced plans; E5: every completed run's daily-companion verdict).

## Item 3 · D3 / D4 / D5 · proposed (mixed: 1 code, 1 decision, 1 gated data) — await GO
_NOTE: these do NOT cleanly bundle into "one code commit" — D3 is a data write, D4 is a decision, only D5 is code._
- **D3 (data, gated — NOT code):** the 2026-06-04 tempo (`plan_workouts`) has `workout_spec.hr_target_bpm = null` while the other 13 tempos have 149. It's a **past/already-run** row (cosmetic per Audit D). Options: (a) leave it (past, cosmetic) — recommended; (b) gated one-row `UPDATE … SET workout_spec = workout_spec || '{"hr_target_bpm":149}'::jsonb WHERE id=<06-04 tempo>` (David's per-statement go). This is a DB write, not a code diff — cannot go in the D4/D5 commit.
- **D4 (decision — likely no code):** `build-workout.ts:456` sets `hrCeilingBpm` only for easy/long; race ships `null` and the watch recomputes `LTHR×0.89`, ignoring `spec.hr_cap_bpm=154`. You don't HR-cap a race, so the dead field is harmless. DECISION: (a) leave + document (recommended — no change); (b) if the watch should honor `spec.hr_cap_bpm` generally, forward it for race and have the watch prefer spec over its recompute (larger change, touches the watch). Recommend (a).
- **D5 (code, cosmetic):** `lib/training/expand-spec.ts` — race (via `expandLong`) labels the single phase generically (e.g. "13.1 mi long run") and shakeout (via `expandEasy`) labels "2.0 mi easy", while the `sub_label` (RACE/SHAKEOUT) is correct. Fix: thread an optional `workPhaseLabel` override into `expandLong`/`expandEasy` and have `build-workout.ts` pass "Race effort"/"Shakeout" for those types. Internal-label-only; no behavior change. tsc-verify on apply.
**Awaiting:** GO on D5 (cosmetic code) + DECISION on D3 (leave vs gated 1-row write) + D4 (leave vs watch honors spec). Lowest-priority bundle.
**Any-runner:** D5 any-runner (every race/shakeout shows a generic internal label); D3 only re-bites if a workout is authored with null LTHR; D4 cosmetic.

---

## Item 19 · Product experience audit (all surfaces) · MAJOR (product punch-list)
**Finding:** The pre-run **primary** card (`TodayView PlannedHeroV2`) is genuinely comprehensive (distance, target pace, est time, effort band, real forecast, shoe, spec-driven fuel, BEST WINDOW, target HR+zone, cadence, blueprint, watch preview). The gaps concentrate on **the watch during a run** and **two stale/secondary surfaces**. Ranked punch-list:
1. **🔴 Watch shows NO HR on interval/tempo/threshold/progression/race work faces.** `hrTargetBpm` is plumbed end-to-end (`WatchWorkoutModels.swift:62`) and rendered by **zero** views — `WorkIntervalFace` (`Faces.swift:49-78`), `ProgressionFace` (`:161`), `StridesFace`, `LiveRaceFace` show livePace/target/distance/rep only. The exact sessions where "comfortably hard" is defined by HR (T=83-88%, I=95-100% VO2max per Research/22) are pace-only; the stats swipe page also has no live HR. For a beginner with noisy short-rep GPS pace, HR is the more reliable read and it's absent. (Same root as Item 9; this is its product face.)
2. **🔴 Long-run-with-HMP/M-finish is UNSUPPORTED on the watch.** `WatchWorkout`/`WatchPhase` have no finish-segment concept; the marquee marathon/HM session ("20mi w/ last 14 @ M") can't be represented — no transition cue ("FINISH — lift to HMP"), no pace-vs-HMP read, no finish-distance-remaining. If split into two work phases it mis-routes to the rep face ("REP 2/2"). Biggest missing workout TYPE on the watch. (Ties to D1.)
3. **🟠 Post-run watch summary is thin.** Shows type + avg pace + distance + time only (`SummaryView.swift:36`). Missing **avg/max HR** (computed + sent, just not shown), **rep breakdown** (a 5×7 shows one blended avg pace, not the per-rep splits the engine has), and any **coaching moment** — it "just ends." The highest-engagement moment is silent. (Consistent with the gutted reactive-coach decision — flag, don't auto-rewire.)
4. **🟠 Web `WorkoutDetail` modal shows FAKE weather + fuel + no HR.** The modal opened from the week strip (`components/.../WorkoutDetail.tsx PlannedBody`) renders **hardcoded static** kit/cues from `constants.ts:60-67` — *every* easy run shows "66°·Calm / Novablast 5 / nose-breathing", *every* tempo "67°·Calm / Zoom Fly 6". Not live forecast, not the runner's real shoes/fuel; no target HR, no best-window. A runner opening this modal sees **wrong conditions**. Concrete "shows Z, should show real data" bug (TodayView is correct; this secondary surface is a stale mockup). **Recommend prioritizing** — it actively misinforms.
5. **🟠 Calendar HMP/M finish segment fix is INCOMPLETE** (AUDIT-FIXES "partial" confirmed): finish segments render in the **day-detail panel** (`TrainView.tsx:1229`) but NOT on the calendar **tile** (`:1121`) or the **weeks list** (`:1362`, always "Long run · 16.0 mi"). Visible in 1 of 3 plan surfaces. Also: **pace progression is not visualized** — the ramp shows volume only; a runner can't see paces tightening week-to-week.
6. **🟡 Week view lacks planned-vs-actual volume.** Shows "42 MI PLANNED" but never "38 actual / 42 planned"; per-day actual is binary (a check, not the actual distance/pace inline); plain long runs are absent from KEY WORKOUTS (only `@ M`/`@ HM` longs included). (`TrainView.tsx:664-715`.)
7. **🟡 Watch readiness glance discards the coach line.** `WatchReadiness.recommendation` is fetched (`WatchWorkoutModels.swift:417`) but `ReadinessGlanceView` never renders it — the one sentence of coaching the watch has is dropped.
8. **🟡 No watchOS complication/widget** at all (zero `WidgetKit`/`TimelineProvider`) — no at-a-glance "today: 5×7 @ T" or readiness between runs; must open the app.
9. **🟡 Watch easy/long HR shown as bare bpm, not zone** ("145" not "Z2" — Research/22 Rule 16 Z2-cap label never reaches the watch); easy face rotates HR/cadence so each is only half-visible and hides elapsed time (easy runs are often time-bounded).
**Haptics (PASS):** per-phase work=`directionUp`/recovery=`directionDown`/cooldown=`stop`/end=`success` fire correctly (`WorkoutEngine.swift:840`); rep countdowns + fuel/split flashes are well-built. Gaps: no HR-ceiling haptic (over-ceiling is visual-only — runner must be looking), no HMP-finish transition haptic (type unsupported).
**Proposed fix (priority order):** (4) repoint `WorkoutDetail` modal to live forecast/shoe/fuel + target HR (kill the static constants) — it misinforms today; (1) render `hrTargetBpm` on quality work faces; (2) model a finish segment on the watch (ties D1 + B-class); (3) enrich the post-run summary (HR + rep ladder); (5) surface finish segments on calendar tile + weeks-list, add a pace-progression view; (6-9) week-actual rollup, render the readiness recommendation, add a complication, zone labels.
**Falsifier:** WorkoutDetail modal for an easy run shows the real day's forecast + the runner's assigned shoe (not "66°/Novablast 5"); a threshold rep on the watch shows the HR target; calendar weeks-list shows "16mi · last 8 @ HM".
**Awaiting:** DECISION/product prioritization — these are product gaps, not data bugs. #4 (fake weather modal) is the one I'd fast-track.
**Any-runner:** YES throughout — beginners especially need HR-on-quality (#1), zone labels (#9), and real conditions (#4); the watch gaps hit every Faff-watch runner.

---

## Item 20 (added) · Weather-adjusted verdicts — global · DECISION
**Finding:** The user's instinct is right but the implementation is subtler than "verdicts don't weather-adjust." The heat-adjusted verdict **already exists and is correct** — in exactly ONE place (`loadPhaseBreakdown.status`, `run-state.ts:855`, added 2026-06-04, whose code comment literally cites *this Jun 4 tempo* as the reason). The real defect is **inconsistency**: the per-phase `status` on the web run-detail bars heat-adjusts, but **the recap/win path and the frozen watch `verdict` do NOT** — so the same run reads "on (executed for conditions)" on the phase bars and "missed" in the recap headline / win line. A runner who correctly slowed for heat reads a contradiction.
**Evidence — Jun 4 tempo, computed against the real model + real DB values (RO):**
- Weather (DB): `temp_f 68.4`, `humidity 71%`, `conditions "clear"` (→ +5°F solar), `cloud 16%`, `durationSec 3579` (59.6 min). → dewpoint 58.6°F, tEff 73.4°F.
- Through `judgeWeather`: baseSlow 10.72% × dpMult 1.05 × durMult 0.698 = **slowdownPct 7.9% ("hot")**.
- Frozen work target **419** s/mi (7:00) → heat-adjusted effectiveTarget **452** s/mi (7:32). Band lo 409 / hi 462. Actual **437** (7:17) → **ON** (`run-state.ts:861`).
- Raw (no heat): 437 vs 419 = **+18s → MISSED/SLOW** — this is the frozen `phase.verdict` value in `coach_intents` (`verdict: "missed"`, watch-computed, no heat concept).
- **So the verdict DOES flip: raw "missed" → heat-adjusted "on/nailed."** The runner ran 15s/mi *faster* than the heat warranted (heat predicted +33s; they slowed only +18s).
- Surfaces that DON'T adjust: the frozen `phase.verdict` (stored); the **recap** (`recap/route.ts:151-173 winPhases` reads `p.verdict`; `run-win.ts:95 gateOnVerdict(input.verdict)` gates `winTempo`/`winLong` on the RAW verdict → the win line won't fire even though the run was on-target for conditions); the iPhone glance (E5). Surfaces that DO: `loadPhaseBreakdown.status` (web bars) and `goal-projection.recentTestPoints.verdict`.
- Note: this Jun 4 case also rides on E3 (frozen 419 vs live plan **442**) — against the live 442 the raw run is already "fast"; against frozen 419 it's "missed"; heat-adjusted, both say nailed. The verdict-source decision (E3) and the heat adjustment are the **same** consistency problem and should be designed together.
**Assessment — should verdicts apply weather adjustment globally? YES.** The doctrine + math already exist (cite `Research/06 §"heat-aware verdict"`); this is a **wiring/consistency** fix, not a from-scratch build (materially cheaper than the user's framing implies).
**Proposed design (DECISION — do NOT implement without GO):**
1. Extract the `loadPhaseBreakdown` band logic into a shared pure `heatAdjustedPhaseStatus(targetSPerMi, actualSPerMi, slowdownPct)` (asymmetric ±10s band already there).
2. Recap/win path: compute `slowdownPct` (the route already has the run + `judgeWeather`) and judge/gate on the heat-adjusted status, NOT the raw frozen `verdict`. Treat the watch-frozen `verdict` as execution *context*, never the evaluation criterion (same posture as E3's frozen-target decision).
3. **Which sessions adjust:** quality + race (pace IS the axis). Easy/long/recovery/shakeout are run by HR/effort (E6) — heat makes their pace drift by design, so they aren't pace-verdict'd at all; leave them effort-framed.
4. **Tolerance:** reuse the existing asymmetric band (faster than original target −10s = "fast/overcooked"; within → "on"; slower than heat-adjusted +10s = real miss).
5. **Surface the adjustment to the runner** (the missing UX): show "Target 7:00 → ~7:32 in today's heat · you ran 7:17 — nailed it for the conditions." The `slowdownPct` + `effectiveTarget` are already computed; today they're invisible on most surfaces.
6. Unify with E3 (which target) + E5 (glance branch) — one verdict-consistency change, not three.
**Falsifier:** after the fix, Jun 4 tempo reads "on/nailed (executed for 7.9% heat)" on the recap + win line + glance, matching the web phase bars (currently they contradict). A cool-day run (slowdown <2%) is judged identically to today (effectiveTarget collapses to target).
**Awaiting:** DECISION — confirm scope (quality/race only?), tolerance, and the surfacing copy, then it's a gated code PR. NOT implemented per instruction.
**Any-runner:** YES — every runner who correctly slows for heat on a quality day currently reads "missed" on the recap/win/glance while the web bars say "on." Systematic for anyone training in warm conditions.

---

# FINAL SUMMARY

**Covered:** all 19 queue items, read-only throughout (`faff_readonly`, write-denied verified). Zero deploys, zero data writes. Audit run against the live `main` line (the spawned worktree was a stale Runcino branch — noted at top). 8 subagents + direct DB traces; every finding is file:line- or real-value-anchored.

**No emergencies.** No data corruption, no wrong live volume/VDOT/training-form. The backend math is genuinely single-sourced for 5 of 7 runner-facing values. The recurring architectural theme is **duplicated inputs/anchors, not duplicated formulas**: VDOT input-assembly ×5 sites, "today" ×46 sites, silent DB swallows ×241.

**Ready for GO** (code-only, gated, no data write — say the word and I apply + tsc + diff + deploy via the normal pipeline):
- **Item 4** — `runnerToday` sweep across the 46 timezone-hack sites (risk-ordered; plan-engine first).
- **Item 13** — convert the 4 VDOT/calibration silent-swallows (#1 `simulator.ts:276 ?? 45`, #2/#3 `generate.ts:1869/1896`, #4 `runner-calibration.ts:118`) to throw/propagate-null.
- **B1 (Item 1)** — delete iPhone `RaceDayView.vdotPredictionRows`, render the backend projection (ships via TestFlight).
- **Item 6** — build `lib/coach/derive-mile-splits.ts` (easy-run scope; intervals render the rep ladder from work-phase actuals).
- **Item 5** — re-anchor the phantom Research citations to real headings (mechanical).
- **Item 2 (E3+E5)** — proposed diffs ready (`recap/route.ts` frozen-target + "plan now" note; `glance-adapter.ts` done-state branch).
- **Item 19 #4** — repoint the `WorkoutDetail` modal off the hardcoded weather/fuel constants to live data (misinforms today).
- **Item 3 D5** — cosmetic phase-label code (tsc-verify on apply).

**Needs DECISION from David:**
- **B2/B4** — consolidate VDOT input-assembly (×5) + store-vs-recompute (architectural; one `loadVdotInputs`).
- **Item 5** — 3 numeric doctrine deviations (taper shape F2, long-run finish % F4, easy/interval offsets F5).
- **Item 9** — consume vs remove `hrTargetBpm` + 5 dead watch-payload fields; **AUDIT-FIXES A2 claim "hrTargetBpm landed on the watch" is FALSE — needs correcting** (struct-only, no consumer).
- **Item 16** — shoe tracking is a feature build (auto-assign never fired in prod; watch/HK runs never tagged; two manual systems unreconciled; mileage fictional).
- **Item 10** — race-result → VDOT → next-plan flow (no `actual_result` writer exists; design before Aug 16).
- **Item 8** — build the plan-validation gate (PLAN-GEN CRITICAL #2 — none exists).
- **Item 14** — readiness cold-start should return `unknown`, not 70/READY.
- **Item 15** — "PROJECTED FINISH" wording shows the goal (beginner-misleading) + redundant status cleanup.
- **Item 19** — watch HR-on-quality (#1), watch HMP-finish support (#2), thin post-run summary (#3), calendar finish/pace visibility (#5), week planned-vs-actual (#6), readiness recommendation (#7), complication (#8), zone labels (#9).
- **Item 17 / 18** — outbound-payload-log table + dedicated `faff_writer` role (scoped; gated DDL).
- **Item 3 D3/D4** — D3 leave-vs-gated-1-row-write; D4 leave-vs-watch-honors-spec.
- **Item 20 (added) — weather-adjusted verdicts (global).** Heat adjustment already exists in `loadPhaseBreakdown` but NOT in the recap/win path or the frozen watch verdict → cross-surface contradiction (Jun 4 tempo reads "on" on the web bars, "missed" in the recap). Wiring/consistency fix; unify with E3+E5. Confirmed flip: 419→452 heat-adj, actual 437 = nailed.
- **Carry-forward** — the C1 in-place re-pace of `pln_ca91f252bba50c74` (the real prescription gap; needs the in-place mechanism + gated write).

**Confirmed PASS / correct:** Item 7 (C3 fix live, VDOT ratchet correct no-op at 47.9), Item 11 (strava_activities trivial), Item 12 (376/0 suite, no E6 regression), Item 14/15 methodologies (research-grounded), volume/form/zones/paces single-sourced, watch is a thin client (no local recompute), completion round-trip intact.

**What I did NOT do (by design):** apply any code (the proposed diffs in items 2/3 are read-anchored, not applied — `main` tree left clean); generate any real plan (item 8 was source-trace only); any DB write or deploy. Temp RO harness scripts left under `web-v2/scripts/_audit_*.mjs` (untracked) — safe to delete.

**Suggested morning order:** (1) glance the 🚨 top flags; (2) GO the low-risk sweeps (items 4, 13, 5-citations, 6); (3) decide B1 + #4 fast-track (both show wrong numbers); (4) decide the bigger builds (16 shoe, 10 race-result, 8 validation gate, 19 watch-HR); (5) the C1 in-place re-pace remains the one open *prescription* gap.

