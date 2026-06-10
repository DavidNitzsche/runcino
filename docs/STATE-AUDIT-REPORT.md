# STATE AUDIT — faff.run

**Date:** 2026-06-09 (evening) · **Auditor:** full-codebase + read-only DB audit (`DATABASE_URL_RO`)
**Subject:** David, 68 days from AFC Half (San Diego, 2026-08-16, goal 1:30:00)
**Method:** every number below was either queried live from prod (queries shown) or traced through the actual code path that produces it (file:line cited). Nothing is assumed from docs or memory.

---

## Executive summary

The foundation is solid: canonical volume is clean to the mile, VDOT is reading from the right source, TSB replicates exactly, readiness math checks, and the plan's architecture (phases, taper shape, race week, long-run progression) is doctrinally sound. The app is not lying to David about what he did.

Where it can lie to him is about **what his fitness is becoming and what race day will cost**. Three independent defects stack in the same optimistic direction:

1. **Run-derived VDOT is structurally dead for his runs** — `vdot-inputs.ts:205` requires `movingTimeS > 60`, a field watch-source rows don't carry (they carry `timeMoving`/`durationSec`). His Jun 9 tempo (avgHr 150 ≥ 80% of maxHr 181, 8.02 mi) is exactly the run the gate was built for, and it is excluded before the gate runs.
2. **The tempo-pace-drift detector can never fire** — it reads `runs.data->>'workoutType' IN ('tempo','threshold')` (`goal-projection.ts:726`), but that field holds `null` (74 rows), `'0'` (28), `'1'` (2). No run in the database has ever carried a string workout type.
3. **Warm-day pace verdicts use a heat table ~2× the cited doctrine** — `weather-adjust.ts:113-128` claims Research/06 mid-pack but stores roughly double every value (70°F: 8% vs doctrine 4%; 80°F: 17% vs 7.5%). Every "ON" verdict on a warm tempo is graded against an allowance the research doesn't support.

Meanwhile the **race-day projection halves the doctrine heat cost** (HM distance-scale 0.5× in `heat-adjustment.ts:50-56`, a scaling Research/06 does not contain), and the **race-day prescribed pace is 6:47/mi — 5 s/mi faster than the 1:30:00 goal requires** (6:52/mi), because the race target inherits T-pace (goal pace − 5) from `spec-builder.ts:303-312`.

Net effect: the app will tell David he's on track slightly longer than the evidence supports, understate what an August race morning costs, and then hand him a race-day number that front-loads a 66-second over-commitment. None of these is hard to fix. All of them matter at exactly his margin — the CI already says 1:30 is at the edge of the band.

Verdict scores and the full reasoning are in Part 6. Top-3 pre-race fixes, in order: (1) race-day pace prescription, (2) unify the two heat engines onto the doctrine table, (3) un-dead the training-VDOT pipeline (movingTimeS + workoutType).

---

# PART 1 — DATA INTEGRITY

## 1.1 Canonical volume — 30/60/90 days

**Method:** 1:1 port of `lib/runs/identity.ts` clustering + `lib/runs/volume.ts` `mileageByDay` (the app's real reader), run against prod, compared with naive sums. Script: `web-v2/scripts/_audit_state_03_volume.mjs`.

| Window | Canonical (app logic) | Naive non-merged rows | Naive ALL rows |
|---|---|---|---|
| 30d (05-10 → 06-09) | **176.9 mi · 27 runs** | 176.7 mi · 27 rows | 357.9 mi · 56 rows |
| 60d | **299.6 mi · 42 runs** | 299.2 mi · 42 rows | 549.5 mi · 79 rows |
| 90d | **425.0 mi · 61 runs** | 424.8 mi · 61 rows | 675.1 mi · 98 rows |

- Zero days in any window where identity-clustering had to collapse an unflagged duplicate (`days-with-extra-rows-collapsed: 0`). The ±0.2 mi deltas are per-day 0.1-mi rounding inside `mileageByDay`, not dupes.
- All-time: 142 rows, 38 carry `mergedIntoId`, 39 absorbed.

**VERDICT: CLEAN.** No double counts. But note the shape of the protection: raw rows are 2× canonical. The dedup flags carry the entire load. See Part 4.1 for what happens if they're wiped (answer: 8 rows, 49.6 mi, would NOT self-heal).

## 1.2 VDOT source

**Query:** `projection_snapshots` last 12 rows.

```
snapshot_date  distance_mi  vdot   projection_sec  source       vdot_anchor_date  vdot_anchor_distance_mi
2026-06-09     13.1         47.9   5694            cron-daily   2026-02-01        13.109
2026-06-09     26.2         47.9   11851           cron-daily   2026-02-01        13.109
(… identical 47.9/5694 back through 06-04; anchor cols null before 06-09 — migration 125 backfilled only the newest)
```

- 47.9 = `vdotFromRace(5694, 13.109)` from **Disney Half 2026-02-01, races.actual_result.finishS = 5694** (1:34:54). Verified by recomputing the Daniels formula in `vdot.ts:31-63`: VO2 41.06 / pct 0.8563 = 47.95 → 47.9. ✓
- Source-of-truth ladder respected: `vdot-inputs.ts:138-161` reads `actual_result.finishS` first, `meta.finishTime` second, Strava match third. The phantom-5K class of bug is dead — run candidates exclude race-day±1 rows (`vdot-inputs.ts:210-217`).
- Sombrero Half (May 3, priority C) finished in **6057s = 1:40:57 at 13.16 mi** (avgHr 162.7 — honest effort, hot day). Its implied VDOT ≈ 45 would be *lower* anyway; exclusion changes nothing today.
- Big Sur (Apr 26): priority `'hilly-excluded'` — a clever non-A/B/C value that drops it from the A/B filter. Works, but it's a magic string; nothing validates it.

**VERDICT: CORRECT SOURCE, STALE ANCHOR.** The number is right and read from the right place. But the anchor is a 128-day-old race. Daniels freshness doctrine (Research/01 §recalibrate, 0–8 week window) would call this stale; the engine's own stale-input CI override fires only at >180d. Between "fresh" and "stale" there is a 4-month-old number wearing a today badge. The honest fix isn't widening the CI — it's making training-derived VDOT actually work (see 1.6/2.x): the pipeline that should refresh the anchor between races is dead at two separate points.

## 1.3 Training form — TSB / CTL / ATL

**Method:** exact port of `computeTrainingForm` (`lib/coach/training-form.ts:102-223`) against prod.

```
COMPUTED: CTL=41  ATL=66  TSB=-25  → label LOADED  (bands: PRODUCTIVE > -10 ≥ LOADED > -30 ≥ OVERREACH)
```

- **TSB −25 confirmed.** Decay math is canonical Coggan (42d/7d EWMA, `CTL_DECAY=1/42`, `ATL_DECAY=1/7`), presentation-scaled ×10 (`training-form.ts:200-203`).
- **But the day-stress series is NOT the canonical volume reader.** It uses `MAX-per-day` dedupe (`training-form.ts:143-151`, comment admits "canonical absorber is not firing reliably" — a stale claim; the absorber works now). Three days in the 60d window had a second real run silently dropped:
  - 05-14: 2 rows, max 6.86, sum 11.22 → **4.36 mi of real load invisible**
  - 05-21: max 6.0, sum 7.17 → 1.17 mi dropped
  - 05-24: max 11.12, sum 12.12 → 1.0 mi dropped
- Volume (`volume.ts`) counts those doubles; training form doesn't. Two engines, two answers for "what did May 14 cost you." ~6.5 mi of load missing over 60d ≈ CTL understated ~1 point today; worse for anyone who doubles regularly.
- Intensity inference: plan-type wins, else HR vs LTHR (162), else distance. With `workoutType` garbage (1.6) the plan join is doing all the work. On days with no plan row and no HR, a 9.9 mi hard run scores as `easy ×0.85`.

**VERDICT: TSB −25 CORRECT as implemented; implementation diverges from the canonical dedup and drops real doubles.** Migrate `daily_runs` to `mileageByDay` (sum per day) — it's a ~10-line change.

## 1.4 Plan workouts — are the paces right for VDOT 47.9?

Full dump of active plan `pln_ca91f252bba50c74` (authored Jun 3, race-prep, 11 weeks Jun 1 → Aug 16) in 2.1. Pace-correctness summary against the canonical paces in the brief (E=8:12, M=7:31, T=7:17, I=6:47):

| Type | Stored (this week) | Expected @47.9 | Verdict |
|---|---|---|---|
| Tempo target | **437 s = 7:17** (Jun 9, Jun 11) | T ≈ 7:16 (Daniels 48) / 7:17 asked | ✓ exact |
| Intervals | 6:43 (Jun 16) | I = 6:47 asked | ✓ 4s hot, inside tolerance — but see ramp note |
| Long | 8:00 flat | ~E−something; reasonable | ✓ acceptable |
| Easy band (workout_spec) | **467–517 s = 7:47–8:37** | E = 8:12 *center* asked; Daniels E for 47.9 ≈ 8:30–9:10 | ✗ **band is ~45 s/mi too fast at the floor** |
| Race day | **6:47/mi** | goal pace = **6:52/mi** | ✗ **5 s/mi over-commitment** |

The easy-band defect, precisely: stored spec `pace_target_s_per_mi_lo=467, hi=517` matches an **older builder formula (T+30..T+80 at week-1 T=437)**. Current code (`spec-builder.ts:173-174`) is `easyLo = T+80, easyHi = T+120` — which at the goal-anchored T it receives would store 487–527, and at *current-fitness* T (430) would store 510–550 (8:30–9:10, the doctrinally right band). The locked plan's specs predate the fix and nothing recomputes them (seal protects completed days; future days just never get touched — `adapt.ts` marks paces stale only on VDOT-jump/goal-change). **Every easy day David will run for the next 10 weeks displays a pace window whose floor (7:47/mi) is threshold-adjacent for his current fitness.** Mitigation: the HR cap 144 (= 0.89 × LTHR 162, Rule 16) is also displayed and the watch leads with HR on easy days. The cap is the only honest number on the card.

**VERDICT: QUALITY PACES CORRECT; EASY BANDS STALE-FAST; RACE PACE WRONG (Part 2.6).**

## 1.5 Readiness — built from real data?

**Query:** `readiness_snapshots` + `health_samples` freshness.

```
06-09: 60 moderate · 06-08: 38 pull-back · 06-07: 55 · 06-06: 61 · 06-05: 41 · 06-04: 49 · 06-03: 76
Latest pillars (06-09): sleep −9 (6.4h 7-night avg) · hrv −1 (55 vs 56 baseline) · rhr −2 (49 vs 48) · load +2 (ACWR 0.89) · hr_recovery 0 (44 vs 45)
70 − 9 − 1 − 2 + 2 + 0 = 60 ✓
health_samples: hrv 379 samples (latest 06-09) · resting_hr 377 (06-09) · sleep 268 (06-09) · hr_recovery 9 (latest 06-04 — 5 days stale) · vo2_max 17 (06-09)
```

- Score arithmetic verified by hand against `readiness.ts` weights. Real HealthKit data, fresh same-day for HRV/RHR/sleep.
- Two honest dings: **hr_recovery pillar is reading a 5-day-old sample** as if current (its baseline comparison hides this); and the **load pillar (ACWR) reads the volume path**, while TSB (1.3) reads MAX-per-day — readiness and training form can disagree about the same week.
- The real signal in this table for a coach: **6.4h average sleep and four sub-56 scores in six days during a 45-mile week.** The data is right; Part 5 covers what the app does (and doesn't do) with it.

**VERDICT: REAL DATA, CORRECT MATH.** One stale pillar input, one cross-engine inconsistency.

## 1.6 HR data — the avgHr chimera and what HR feeds

- The historical chimera (avgHr absorbed across sources mid-merge) is **labeled** (`provenance.avgHr` present on 15 recent rows) and current watch/HK pairs carry identical values — no live distortion found in the last 3 weeks of runs.
- `users.max_hr = 181` (ratchet cron working; `max_hr_override` null; `profile.hrmax` is a different, dead column — confusing but harmless… except anything still reading `profile.hrmax` sees null).
- **What's actually broken:** the two consumers that HR was supposed to unlock are dead for other reasons:
  - `vdotFromRun` HR gate (≥80% of 181 = 144.8): the Jun 9 tempo (avgHr 150) passes the gate but **never reaches it** — `vdot-inputs.ts:205` `AND (sa.data->>'movingTimeS')::numeric > 60` excludes every watch-source row (they carry `timeMoving`, not `movingTimeS`). Prod check: of 42 non-merged rows since Apr 10, watch rows have movingTimeS only when absorption happened to copy it from a Strava/HK loser (7/14 apple_watch, 1/6 watch).
  - `workoutType`: 74 null / 28 `'0'` / 2 `'1'` — never a string type. The Strava numeric mapping (`'1'→race`, `'3'→tempo`, vdot-inputs.ts:56) handles Strava rows, but watch ingest (`api/ingest/workout`) **never writes a workoutType at all**, and nothing back-labels it from the plan.

**VERDICT: NO ACTIVE CHIMERA; BUT THE HR-GATED VDOT PIPELINE IS DEAD AT TWO INDEPENDENT POINTS.** Fix is small: `COALESCE(movingTimeS, timeMoving, durationSec) > 60`, and stamp `workoutType` from the matched plan day at ingest.

## 1.7 Splits — stored correctly?

Last 12 runs (values, not key-existence):

```
06-09  watch  8.02mi  7 splits  unreliable=false  (splits sum 3324s vs duration 3859s — 8th mile missing, NOT flagged)
06-08  watch  6.01mi  5 splits  unreliable=false  (6 mi, 5 splits — last mile missing, NOT flagged)
06-07  watch 12.55mi 11 splits  (no flag key)     (12 expected)
06-05  aw    6.01mi  7 splits  false
06-04  aw    7.76mi  8 splits  false (validation present: deltaS −464!)
06-03  aw    6.08mi  7 splits  TRUE  (deltaS +126)
06-02  aw    7.41mi  8 splits  TRUE  (deltaS +315)
06-01  aw    5.06mi  6 splits  TRUE  (deltaS +269)
05-31  aw   12.36mi 13 splits  TRUE  (deltaS +61)
05-29  watch 7.71mi  1 split   TRUE  · 05-27 watch 5.86mi 1 split false · 05-26 aw 7.61mi 1 split false
```

- **Inconsistent flagging.** Jun 4 carries a stored validation showing splits sum 464s short of duration, yet `splits_unreliable='false'`. Jun 9 is missing its final mile split (535s of run not covered) and is unflagged. Three runs (May 26/27/29) have a single split for 5.9–7.7 mi runs.
- Consumers don't read the flag anyway: `pacing-discipline.ts` (execution buffer), recap split rails, and run-detail phase bars all consume `splits` without checking `splits_unreliable`. The label exists; nothing honors it — same shape as the avgHr-chimera lesson already in project memory.

**VERDICT: NO — splits are not stored correctly for all recent runs, the unreliable flag misses real defects (missing-final-split case), and no consumer reads the flag.** Pacing-CV-derived numbers (execution buffer 30s default vs observed) are currently computed from the default because qualifying runs are scarce — which is accidentally the safe outcome.

## 1.8 Strava pushes

**Query:** `strava_pushes` all rows.

```
id 8  run 06-09  uploaded  activity 18856408342  pushed 20:58:16  completed 20:58:19  ✓ (today, 2.2s round-trip — Fix 1+2 working)
id 5  run 06-08  FAILED   'unresolved after 24h (upload id expired)'  pushed 06-08 23:10  swept 06-09 23:49
id 4  run 05-31  FAILED   same  · id 3  run 05-31  FAILED  same
```

- The prompt's premise ("3 failed, 1 pending — will Jun 8 sweep tonight?") is already resolved: **the Jun 8 pending row swept to FAILED tonight at 23:49 UTC**, per the 24h rule in `strava-push-poll/route.ts:39-47`.
- The three failures are pre-fix casualties (close-the-loop poll deployed Jun 9, `0f271d98`). `failed` is terminal — **there is no retry path and no UI surfacing**; those two runs (May 31 12.4 mi long, Jun 8 hill run) are simply not on Strava and nothing will ever tell David.

**VERDICT: PIPELINE NOW WORKS (Jun 9 proves it end-to-end); 2 runs silently lost to history; failed-state needs a re-push affordance or a one-time manual re-push.**

## 1.9 Shoe mileage

**Query:** `shoes` vs runs-computed mileage (non-merged rows by `shoe_id`).

```
id 1 NB SC Trainer v3   stored 15.17 · runs 12.4 (1 run)     baseline 0
id 2 Asics Superblast 3 stored 12.03 · runs 12.0 (2 runs)    ✓ close
id 3 Asics Novablast 5  stored 11.12 · runs 6.0 (1 run)      Δ 5.1
id 4 Nike Zoom Fly 6    stored 150   · runs 8.0 (1 run)      Δ 142 — manual 150 typed into mileage, baseline_mi left 0
id 5 Nike Vomero Plus   stored 13.64 · runs 0  (0 runs)      orphan mileage
id 6 NB SC Trainer v3   stored 79.71 · runs 15.2 (2 runs)    DUPLICATE of id 1 (same brand+model)
id 7 Nike Vomero Prem.  stored 23.09 · runs 18.0 (3 runs)
```

- Only **10 runs total** carry a `shoe_id`, against 27 canonical runs in the last 30 days alone. Auto-assign shipped Jun 8 (`7059205b`) — the falsifier ("auto-assign count > 0 on next run") presumably passed for Jun 9, but the backlog (Item 16-B, ~10 null watch runs) is still unassigned, and historical runs before that are mostly bare.
- `stored_mileage ≠ baseline_mi + runs_mi` for 5 of 7 shoes; two SC Trainer v3 rows split one physical shoe's history; the Zoom Fly's 150 is a baseline entered in the wrong field.

**VERDICT: NOT COMPUTING CORRECTLY YET.** The write path is fixed going forward; the data at rest is wrong for 5/7 shoes. Needs the deferred backfill plus a merge of shoe 1/6 and a `baseline_mi` correction for shoe 4 (all gated writes for David's per-statement go).

## 1.10 Race meta — AFC

```
slug americas-finest-city · "Americas Finest City" · 2026-08-16 · priority A · 13.1 mi
goalDisplay "1:30" (parses to 5400s via vdot.ts:145-157 H:MM heuristic ✓)
goalSafeDisplay "1:37" (B-goal present)
courseSlug set · course_geometry present (uploaded GPX) · promoted to library ✓
MISSING: startTimeLocal · waveTime · gunTimeIso — all null
```

**VERDICT: goal + B-goal + course set correctly; start/wave/gun time absent.** That's not cosmetic: AFC starts ~7:00 AM; the conditions model uses the **daily max** once inside the 14-day forecast window (`race-conditions.ts:` forecast path reads `temp_max_f`) and a 6–9 AM climate normal outside it. On Aug 2 the Conditions chunk will silently jump from "65°F typical race-morning" to "~75–78°F forecast daily max" — a phantom +90s of projected heat cost born purely from the source switch, two weeks before the race, exactly when David is calibrating goal pace. Store the start time and read the start-hour forecast.

---

# PART 2 — COACHING CORRECTNESS

## 2.1 The next 10 weeks, week by week (as stored in `plan_workouts`)

Source: full dump of `pln_ca91f252bba50c74` (script `_audit_state_07_plan_detail.mjs`). Weekly rollup:

| Wk | Start | Phase | Vol (mi) | Long | Quality | Tempo target |
|---|---|---|---|---|---|---|
| 0 | Jun 1 | QUALITY | 44.6 | 12 | 2 | 7:17 |
| 1 | Jun 8 | QUALITY | 45.5 | 13 (flat) | tempo 8 (4@T) ×2-ish | 7:17 |
| 2 | Jun 15 | QUALITY | 45.5 | 12 (flat) | 4×1mi @ 6:43 + tempo | 7:13 |
| 3 | Jun 22 | QUALITY | 49.5 | 14 = 10 + **4 @ M** | tempo ×2 | 7:08 |
| 4 | Jun 29 | QUALITY | 55.5 | 16 = 11 + **5 @ M** | 4×1mi @ 6:34 + tempo | 7:04 |
| 5 | Jul 6 | QUALITY (cutback-by-volume) | 45.5 | 13 = 9 + **4 @ HM** | tempo ×2 | 6:59 |
| 6 | Jul 13 | RACE-SPECIFIC | 59.5 | 17 = 10 + **7 @ HM** → adapted **9 @ HM** | 4×1mi @ 6:29 + tempo | 6:59 |
| 7 | Jul 20 | RACE-SPECIFIC (peak) | **64.5** | **19 = 11 + 8 @ HM** → adapted **10 @ HM** | 4×1mi + tempo | 6:59 |
| 8 | Jul 27 | RACE-SPECIFIC | 55.5 | 16 = 10 + 6 @ HM → adapted **8 @ HM** | 4×1mi + tempo | 6:59 |
| 9 | Aug 3 | TAPER | 46.0 | 12 easy | tempo 8 ×2 (Aug 4, Aug 6) | 6:59 |
| 10 | Aug 10 | TAPER/race | 29.1 (incl. race) | 13.1 race | race | 6:47 race |

**Aug 14/15/16 exactly as stored:** Aug 14 `rest` ("Off feet. Hydrate.") · Aug 15 `shakeout` 2 mi + 4×20s strides · Aug 16 `race` 13.1 mi @ **6:47/mi** target.

## 2.2 Are the paces correct for VDOT 47.9?

Covered in 1.4 — week-1 quality paces are exact (T 7:17 ✓, I 6:43 vs 6:47 asked ✓). Two structural issues:

- **The pace ramp is goal-anchored, not fitness-anchored, from Jul 7 onward.** Tempo parks at 6:59 (= goal-T 407 + 12) for six straight weeks, and intervals at 6:29 (= goal-T − 18). That presumes VDOT ~50.4 fitness David hasn't demonstrated. Rule 3's blend (current→goal over the early weeks) is the right idea, but with the training-VDOT pipeline dead (1.6), **nothing re-anchors the back half if fitness doesn't arrive on schedule**. He'll either rise to it or quietly fail six weeks of tempos — and the failure detector that should catch it is the dead one.
- Easy bands stale-fast (1.4).

## 2.3 Long run structure

The progression (flat → M-pace finishes → HM-pace finishes growing 4→9→10→8 mi, then flat easy 12 before race) is textbook race-specific HM design and matches Research/22's "LR with HMP segments." Two cautions:

- **10 mi @ HM inside a 19 mi long (Jul 26) is a monster session** — 1:09 continuous at threshold-adjacent effort at the end of 2:30+ of running. Daniels caps T-volume per session around 8% of weekly miles; this is ~15% of that week at near-T. David approved the bump (it was the sub_label fix), so it stands as a deliberate stretch — but the plan offers no fallback prescription ("if HR > X by mile 6 of the finish, cut to 6 @ HM") and the watch will enforce pace, not effort, on that segment.
- Long-run pace stored flat 8:00 for every long regardless of week — fine for the easy portion, but the HM-finish segments' pace lives only in `workout_spec`/sub_label. Any consumer reading `pace_target_s_per_mi` alone (e.g. simple calendar views) sees an 8:00 long and no hint of the 10 @ 6:52 inside it.

## 2.4 Volume ramp safety

Week-over-week: 44.6 → 45.5 (+2%) → 45.5 (0) → 49.5 (+8.8%) → **55.5 (+12.1%)** → 45.5 (−18%, de-facto cutback) → **59.5 (+30.8% vs cutback / +7.2% vs pre-cutback)** → 64.5 (+8.4%) → 55.5 → 46.0 → 29.1.

- One week violates the 10% rule outright (+12.1% into Jun 29) — and violates the generator's own `RAMP_PCT` (7% advanced) and its 1.10 climbFactor cap, meaning post-generation adjustments (quality-floor, long-run bumps) inflated a week the curve had set lower. `validate.ts` checks week-over-week at 150% — far too loose to catch this.
- The +30.8% cutback rebound is conventionally fine (rebound to prior trajectory), but ACWR math doesn't care about convention: acute week 59.5 against a 49–55 chronic puts ACWR ≈ 1.15–1.2 — acceptable, not flagged.
- **Peak 64.5 mi:** David's actual last-4-week average is 176.9/4.3 ≈ 41 mi/wk (and the engine's `recentWeeklyMileageMi` will say the same). Peaking at 64.5 = **157% of current chronic volume within 7 weeks**. Doctrine for HM-intermediate peaks 35–45; this plan is Pfitz-marathon-shaped (justified by CIM Dec 6 via Rule 11 horizon-extension). It's coherent *as a CIM-feeder*, but as AFC preparation it concentrates injury risk in exactly the weeks (Jul 13–27) that decide the race. `is_cutback`/`is_peak` flags: **all false in plan_weeks** — the schema supports marking them; the generator never set them (w5 is a cutback by volume only; w7 is the peak by volume only).

**VERDICT: AGGRESSIVE BUT COHERENT; one hard 10%-rule violation; metadata flags unset; no per-session bail-out prescriptions on the big sessions.**

## 2.5 Taper + race week

- Taper = 2 weeks (46.0 = 71% of peak, then 16.0 pre-race miles ≈ 45–55% depending on accounting) — matches BLOCK_SHAPE HM=2wk and Research/22's implied 2–3wk. ✓
- Race week day-by-day (4/3/4/3 easy → rest Aug 14 → 2 mi shakeout Aug 15 → race) matches Research/08 §9.3's rest-2-days-out + shakeout-day-before pattern. ✓
- **Missing: the race-week tune-up.** Research/08 §9.3 prescribes "4–5 mi w/ 4×1K at HMP, 90s recovery" ~5 days out (Tue). The plan's Aug 11 is `easy 3 · Strides optional`. A `race_week_tuneup` spec type EXISTS in the codebase (`spec-builder.ts:325+`) — the generator simply never schedules it. Last quality touch is Aug 6, then nine days of easy/rest into the gun: legs go flat. This is the kind of thing a USATF coach would actually red-pen.

## 2.6 Race day prescription — the 6:47 problem

`plan_workouts` race row: `pace_target_s_per_mi = 407` (6:47). Spec band 397–412 (6:37–6:52), HR cap 154 (0.95×LTHR — doesn't reach the watch; `build-workout.ts:478` only sends ceilings for easy/long).

- 1:30:00 at 13.109 mi = **411.9 s/mi = 6:52/mi**. The stored 6:47 is `tPaceFromGoal` (goal pace − 5, `spec-builder.ts:418-428`) leaking through `case 'race': paceTargetSPerMi: tPaceSec` (`spec-builder.ts:303-312`).
- If David executes the watch number, he runs 1:28:55 pace — **66 seconds of unbudgeted aggression** for a runner whose own app says the goal itself is "doable, not banked" (MEDIUM) with a CI whose fast edge barely kisses 1:30. Going out 5 s/mi hot is the canonical HM blow-up per Research/08 §18.2.
- The spec *band* even allows 6:37/mi. There is no negative-split structure, no first-mile +10–15s guidance (Research/08 §3.4), no wave/corral logic — "Pacing in race-week briefing" is a promise (the briefing is LLM-composed at race week; the structured pace plan doesn't exist anywhere in the DB today).

**VERDICT: WRONG, and it's the single most consequential wrong number in the app.** Fix: race pace = goalSec/distance with an explicit first-mile allowance, and a real pacing-plan artifact for race week.

## 2.7 Heat adjustment — Maughan for San Diego, Aug 16

Engine path (Targets/GapPanel → `race-conditions.ts` → `applyHeatToPace`, heat-adjustment.ts:91-104): goal pace 412.2 s/mi, mid_pack tier (VDOT 47.9 ∈ [45,60)), HM distance-scale **0.5×**.

| Temp | Doctrine mid-pack (marathon) | Engine (×0.5 HM scale) | Engine pace penalty | Engine total |
|---|---|---|---|---|
| 65°F | 2.5% | 1.25% | +5 s/mi | **+63s** |
| 70°F | 4.0% | 2.0% | +8 s/mi | **+102s** |
| 75°F | 5.5% | 2.75% | +12 s/mi | **+154s** |
| 80°F | 7.5% | 3.75% | +16 s/mi | **+207s** |

- Today's CONDITIONS chunk: climate normal for "San Diego, CA" Aug = `CA: row(45,55,65,60)` → Aug ≈ 64–65°F morning → **+63s ✓ — the "~63s" on the Goal tab is real and mechanically correct.**
- **But the 0.5× HM scale is engine-invented.** Research/06 §1 contains no distance scaling for continuous racing (its only halving rule is for *interval workouts with ≥1:1 rest*, §2). Ely/Maughan data says shorter races degrade somewhat less, not 50% less. If Aug 16 dawns at 70°F (entirely plausible — and likelier than normal in an El Niño August), doctrine says ~+13 s/mi (+170s); the app will claim +8 s/mi (+102s).
- Meanwhile the *post-run* engine (`weather-adjust.ts:slowdownFromTemp`) stores **double** doctrine (70°F→8%, 80°F→17%, comment claims "Research/06 mid-pack column" — it is not that column), then multiplies by dewpoint (≤1.75×) and duration (0.4–1.0×). Jun 8's run logged `slowdownPct 14.5` at 78°F; the doctrine table says ~6.9% marathon-equivalent *before* down-scaling for a 50-minute run. Verdict bands (`heatAdjustedStatus`) widen the slow side by this inflated number — a tempo run 50 s/mi off target at 78°F can grade "ON."

**VERDICT: the projection-side number (+63s) is computed correctly per the engine's table, but the app runs TWO heat models that disagree with each other by ~4× and with the cited research by ~2× in opposite directions.** Race projection under-budgets heat; training verdicts over-forgive it. Both errors flatter David. Unify on the Research/06 table with the duration-scaling factor as the only engine-documented modifier.

## 2.8 Confidence interval — the math behind 1:31:56–1:37:52

`computeConfidenceInterval` (goal-projection.ts:875-927): center = vdotProjectionSec = **5694** (predictRaceTime(47.9, 13.1)). Anchor (Feb 1) is 128d old < 180 → no stale override. Pacing CV: source `default` (not enough qualifying split runs) → research-span table → HM (≤16 mi) base ±2.5%. Status multiplier: **±2.5% × 1.25 (WATCHING) = ±3.125% → half-width = round(5694 × 3.125%) = 178s**:

- lo = 5694 − 178 = 5516 = **1:31:56** ✓ · hi = 5694 + 178 = 5872 = **1:37:52** ✓

The arithmetic is exact and matches Research/02 §13.7 (10K→half ±2.5%) with the engine's documented status overlay. Two honest caveats: (a) the band is around *current-fitness projection*, and its fast edge (1:31:56) already excludes 1:30:00 — the UI must never let that read as "1:30 is in range"; (b) the WATCHING ×1.25 means the displayed precision depends on drift detectors, two of which are dead (1.6) — the band is likely *narrower* than honest right now, not wider.

`computeConfidenceLabel`: goalVdot = vdotFromRace(5400, 13.1) ≈ 50.9 → gap 3.0 VDOT · runway 9.7 wk · closable = 9.7 × 0.35 = 3.4 → ratio 0.88 → MEDIUM, "doable, not banked", "4:54 to find · 10 weeks to do it." Math verified. The 0.35 VDOT/wk build rate is the optimistic half of the cited 0.25–0.4 band — defensible, but know that MEDIUM is sitting 12% from LOW.

## 2.9 Gap decomposition — Fitness + Conditions + Course + Execution = 4:54?

GapPanel (`GapPanel.tsx:142-217`): totalGap = 5694 − 5400 = **294s = 4:54 ✓**. Segments:

- **Conditions = 63s** (2.7, climate normal 65°F — correct per engine, understated per doctrine)
- **Course = ~4s, computed from wrong data.** Verified the actual path: `seed.ts:2246-2280` reads **course_library only** — for AFC that row is `editorial · 210 ft gain · 0 ft net`. `computeCourseImpact`: paceFactor 0.859, gross 16 ft/mi → fatigue ≈ 3.6s, net 0 → **≈ 4s**. Two problems: (a) the editorial numbers are wrong — AFC is a point-to-point **net-downhill** course (~300+ ft gain incl. the mile-11/12 climb, roughly −250 to −350 ft net) — and (b) **David uploaded the actual GPX** (`races.course_geometry`, course_source='upload'), which the seed uses *only* for a weather bbox; its elevation profile never reaches the course math. The app is computing course cost from a stub while holding the real answer in the next column. (With true numbers the chunk is ≈ 0s — net-drop credit cancels the climb fatigue — so the displayed total is luckily close, by accident, and the famous hill never gets a mention in pacing guidance.) GapPanel's `?? 24` fallback (`GapPanel.tsx:149`) is a third value this chunk can silently show; measured/derived/defaulted are visually identical.
- **Execution = 30s** (pacing CV default — David has <2 qualifying split-runs, partly because splits are missing/unreliable per 1.7)
- **Fitness = 294 − 63 − 4 − 30 = 197s** (derived as remainder)

Decomposition sums by construction; the question is whether the chunks are honest. Conditions: engine-correct/doctrine-light. Course: computed from a stub while the uploaded GPX goes unread. Execution: a default dressed as measurement. Fitness-as-remainder inherits every other chunk's error. Good narrative device; not measurement-grade yet, and the UI doesn't distinguish measured chunks from defaulted ones.

---

# PART 3 — PRODUCT EXPERIENCE: Tuesday June 10, 2026, ~6:30 AM PT

Ground truth for the morning (queried): today's plan day = `easy 6 mi · hr_cap 144 · band 7:47–8:37`. Yesterday = tempo 8 mi, target 7:17, **done**: 8.02 mi, 1:04:19, avgHr 150, work-phase splits 7:21/7:12/7:20/7:20 (avg ≈ 7:18). Week so far: 14.0 of 45.5 mi. Readiness Jun 9 = 60 MODERATE (Jun 10's score lands ~4:30 AM from overnight HRV/RHR/sleep). TSB −25 LOADED. No niggles (table empty ✓), no active illness, no strength logged.

## 3.1 Web Today

Render order verified in `TodayView.tsx` (hero is workout-driven on an easy day; readiness lives in the header ring — correct hierarchy for a training morning per the C1 conditional layouts):

1. **Header** — "Wednesday Jun 10" + readiness ring. *(Calendar note: the brief says "Tuesday June 10," but 2026-06-08 is a Monday — plan `dow` confirms — so June 10 is a **Wednesday**. The walkthrough premise holds: it's an easy 6 day either way; the app will correctly render Wednesday.)*
2. **Week strip** — MON easy 6.0 ✓ done · TUE tempo 8.0 ✓ done · **WED easy 6 ← today, highlighted** · THU tempo 6.5 · FRI easy 6 · SAT rest · SUN long 13. Week runs Mon Jun 8 → Sun Jun 14; today is day 3, 14.0 of 45.5 mi banked.
3. **Hero (PlannedHeroV2)** — "EASY · 6 mi", stats grid: distance, pace **7:47–8:37 band (the stale-fast spec — see 1.4)**, HR cap 144, est time, shoe rec, conditions chip. The one number a coach would actually want enforced (HR ≤ 144) renders; the pace band shown is ~45 s/mi too generous at the floor.
4. **Yesterday's recap** (results row / completed tile): 8.02 mi · 8:01 overall · work phase ≈ **7:18 vs 7:17 target → verdict ON** (`heatAdjustedStatus`: 64.8–69.3°F, slowdown band ~8% after the inflated table + clear-sky bump + 0.72 duration scale → tolerance window stretched to ≈ [7:07–8:03] — the verdict happens to be earned at 7:18, but the band would have blessed a 7:55 tempo too. See 2.7.)

**Are the numbers right?** Volume, verdicts, HR, recap stats: yes. Pace band: stale. The page passes the three-question test for an easy day; its honesty depends on the HR cap carrying the message, which it does.

## 3.2 iPhone Today

From the native walkthrough (TodayView.swift:135-154 race gate correctly does NOT fire — effort `.easy`): mesh greeting, week strip, readiness ring **with formLine "Form −25 · loaded"** (new TF, server-computed from the same TSB verified in 1.3), WHY pillar strip (sleep −9 will lead), stat chips (LAST NIGHT sleep, THIS WEEK 14.0 mi, VO₂ 62.3?? — see note), collapsed peek "EASY · 6 mi" + pace, drag-up sheet with CONDITIONS & KIT (forecast, best window, shoe, fuel), SESSION phases, CUE line, SKIP footer.

- **HR target: the workout card shows the ceiling chip only when `hrCeilingBpm > 0` — server sends 144 (0.89 × LTHR 162) for easy days (`build-workout.ts:478`). So yes: "<144 bpm" renders, from the right source (not hardcoded — prior audit's claim is fixed/stale).**
- **VO₂ chip caution:** `health_samples.vo2_max` holds daily apple_health values 62.0–62.4 (verified Jun 1–9, 17 samples, near-zero variance — characteristic of Apple's estimator, so this is a real synced stream, not a mislabel). But 62 is not a plausible VO₂max for a 1:34:54 half-marathoner (race-implied ~48–52; a true 62 runs ~1:17). Apple's estimate is broken for him — likely a wrong HRmax/demographic input on the Apple side — and the chip prints it uncritically next to VDOT 47.9. Either sanity-clamp it against race-implied VO₂ (the app has both numbers) or label it "Apple estimate."
- Readiness score on the ring is the server snapshot — same number web shows. One source ✓.

## 3.3 Web Goal (Targets) tab

- **Projection: status currently WATCHING** (CI half-width 178s = base 2.5% × 1.25 exactly — the multiplier only takes 1.25 when status is watching). Therefore the headline shows **goal 1:30:00 held as the projection** ("plan is the path"), with current-fitness marker **1:34:54** and CI band **1:31:56–1:37:52 ✓** (math verified in 2.8), confidence label **MEDIUM · "doable, not banked" · "4:54 to find · 10 weeks to do it" ✓**.
- **Which signal makes it WATCHING:** not the adapter (1 adapt-week in 28d < 2), not missed-keys (3/3 key workouts hit in window), not races/VDOT-trend (frozen flat). The only live candidate is **aerobic_decoupling** — and its input query (`decoupling-trend.ts:60-76`) filters "steady-state" runs by `data->>'type'`, *a field runs never carry* (`COALESCE(type,'')=''` passes everything ≥ 6 mi). `computeAerobicDecoupling` has no internal effort-variance guard (verified: it splits halves and compares HR/pace, `aerobic-decoupling.ts`). So **Jun 9's tempo contaminates the series as a fake decoupling point**: first half ≈ 8:04 pace @ ~142 bpm (warm-up + early tempo), second half ≈ 7:48 @ ~159 — HR +12% at faster pace reads as double-digit "drift" on a "steady run." The WATCHING status may be real or may be tempo-contamination; the runner can't tell, and neither can the engine. Third casualty of the missing workout-type field (see 1.6).
- **Gap breakdown: Fitness ~197s + Conditions 63s + Course ~4s + Execution 30s = 4:54 ✓** renders (sums by construction). Conditions 63s is engine-correct for a 65°F climate-normal morning (2.7) — likely understated by the 0.5× HM scale. Course ~4s is computed from a wrong editorial stub while David's uploaded GPX goes unread for elevation (2.9). Execution 30s is the no-data default dressed as a measurement.
- **VDOT sparkline: a flat line at 47.9.** Every snapshot since the table began says 47.9 — "the right trend" only in the sense that nothing has updated it. With run-derived VDOT dead (1.6), this sparkline cannot move until AFC itself. A flat fitness line during the hardest 10 weeks of the year is the loudest symptom of the dead pipeline, displayed daily.

## 3.4 Web Train tab

- **Phase: QUALITY ✓** (plan_phases w0–5; today = week idx 1). Header "ROAD TO · Americas Finest City", countdown 67–68 days.
- **Execution strip / week list:** Jun 8 easy done ✓, Jun 9 tempo done with verdict, rest of week prescribed — renders from `seed.week`, the dedup-aware reader. Numbers will match 3.1.
- **Week 7 (peak):** Jul 20–26 · 64.5 mi · long 19 = 11 + 8→10 @ HM · 4×1 mi @ 6:29 + tempo 8 @ 6:59. Rendered in the 11-bar ramp.
- **PEAK chip: on the right bar — but by accident of design.** `TrainView.tsx:544-545` computes `peakIdx` at render time as the max-volume week because "`is_peak` is never written by persistPlan" (their own comment). Max volume = w7 = the true peak ✓. The DB flags (`is_peak`, `is_cutback`) are all false (1.4/2.4); if a future adaptation shaved w7 below w6, the chip would silently migrate. Derived-at-render works today; it isn't a contract.

## 3.5 Web Health tab

- **Readiness right now: 60 · MODERATE** (snapshot 06-09 11:31 UTC), pillars as in 1.5 — sleep −9 is the dominant driver and will lead the drivers list.
- **WHAT TO DO** (`health-actions.ts`, trigger-gated, max 3): with no niggle/illness, ACWR 0.89, and only one sub-40 day in the last three (Jun 8's 38), the forced-pullback and load triggers don't fire; the sleep-debt trigger does (≈ 7.7h short of 7.5h × 7). Expect a sleep-first action ("protect tonight's sleep — you're an hour under target nightly") and possibly an informational easy-day confirmation. **Correctly quiet** — no invented urgency. ✓
- **Training form: TSB −25 ✓ LOADED** — chart matches 1.3's replication. The honest caveat from 1.3 applies (doubles dropped from the stress series).
- **Niggle history: empty ✓** — `niggles` table has zero rows for David; the test data really is gone.

---

# PART 4 — TECHNICAL DEBT AND RISK

## 4.1 The dedup pipeline and the 8 flag-protected rows

**Simulation run (script `_audit_state_04_flags_vdot.mjs`): of 38 `mergedIntoId` flags, exactly 8 are load-bearing** — if wiped, identity clustering would NOT re-merge them, and **49.6 mi would double-count**:

```
05-22 apple_health 7.78mi → apple_watch canonical (same wall-clock; both "trustworthy" → spansOverlap on Z-mislabeled legacy timestamps fails)
05-21 apple_health 1.17mi + 6.0mi → same shape
05-20 null-source 5.08mi → apple_watch · 05-24 null 11.12mi · 05-19 null 2.43mi (Δdist 0.01mi but isSameRun still false)
05-17 null 11.02mi → apple_health (16:23 vs 23:23 — the 7h PT/UTC mislabel)
05-15 null 5.01mi → apple_health (same 7h offset)
```

- **Exact trigger risk:** any writer that full-replaces `runs.data` without the Rule-6 field-preservation guard (the Cluster 1b HK-ingest full-replace class) wipes `mergedIntoId` on re-ingest. For these 8, the nightly `dedupe-runs` cron **cannot repair** (its sweep is `autoMergeRecent(u, 14)` — 14 days; these rows are May 15–24 and aging out ever further). The protection is now *only* the flag bytes themselves.
- **How we'd know:** 30/60/90d canonical totals jumping ~25–50 mi overnight; TSB jumping ~10–20 fake points (MAX-per-day would dampen but not absorb multi-row days); `audit-races`-style drift checks don't cover this. **There is no alert on "flagged row count dropped."** Cheap fix: a daily count of load-bearing flags (the simulation above is ~80 lines and RO) + ops alert on decrease. Real fix remains the deferred startLocal→true-UTC canonicalization backfill (already in AUDIT-FIXES as gated work).

## 4.2 VDOT anchor columns

`projection_snapshots.vdot_anchor_date/distance` exist (migration 125) and are **populated only on the 2026-06-09 rows** (`2026-02-01 / 13.109` ✓ Disney). All earlier rows: null. The stale-input CI override (`goal-projection.ts:896-907`) reads the anchor **threaded from the seed at compute time**, not from snapshot history, so the nulls are cosmetic for now — but any future "anchor age" trend chart reading history will see a wall of nulls. The anchor flips stale (>180d) on **2026-07-31**, 16 days before the race — at which point the CI silently balloons to ±8% (±455s — a 15-minute window) **during taper**, unless a tune-up race or the (currently dead) run-VDOT path refreshes it first. Flagging now: that staleness cliff lands at the worst psychological moment, and the only thing that prevents it is fixing 1.6 or racing the Dodgers 10K… which is Sep 26, after AFC. **Plan a fitness re-anchor: either a 10K/5K tune-up in early August, or ship the movingTimeS fix so the Aug 4/6 tempos re-anchor the math.**

## 4.3 Plan lock, VDOT jump, and the CIM handoff

- **Lock semantics:** "locked" = active + seal guard. Seal (`seal.ts:31-33`) freezes only *completed* days; future days are mutable by adapt (downgrades) but **paces are never recomputed** except via the `pr_bank`/`goal_changed` triggers (`adapt.ts:1165-1186`), which only *mark* the next 14 days "[paces stale - recompute]" for manual acceptance.
- **If VDOT jumps after AFC:** `race_graduate` auto-rebuild (`auto-rebuild.ts:36-37,84-94`) fires on the race-result write, archives `pln_ca91f252bba50c74`, and generates the CIM plan from post-AFC inputs — `generatePlan` re-reads `loadVdotInputs`, and a logged AFC result (actual_result.finishS) **is** the new anchor. The handoff exists and is wired to the result write. ✓ Two caveats: (a) the three same-day-archived Jun 7 plans (1.2 table) show the rebuild path has produced rapid-fire regenerations before — archive_reason is null on all of them, so nobody can say why; write the reason. (b) POST_RACE_RECOVERY_WEEKS = 1 for HM → CIM plan will start with a recovery week — correct.
- **Residual risk:** if David runs 1:31:30 at AFC (B-goal territory), graduation still rebuilds toward CIM 3:00:00 — whose goal-VDOT (≈53.5) the new anchor (≈49.5) won't support. `goal-gap` will say unclosable-ish; nothing forces the conversation. The handoff moves the *plan*; nobody owns moving the *goal*.

## 4.4 Watch sync reliability — last 5 completions

Last 5 watch-source ingests (Jun 9, 8, 7, 5, 4): **all ingested** ✓, all carry HR + cadence + splits. Defects within them:

```
Jun 9  GPS ✓ elev 56ft(raw) ✓ weather ✓ splits 7/8 (final mile missing, unflagged)
Jun 8  GPS ✓ elev 538ft(raw) ✓ weather ✓ splits 5/6 (same defect)
Jun 7  12.55mi long: NO GPS · NO elevation · NO weather · 11/12 splits — the biggest run of the week is the data-poorest
Jun 5  GPS ✓ elev 17ft ✓ weather ✓ splits 7 for 6.01mi (extra split — WU/CD lap boundary?)
Jun 4  GPS ✓ elev 187ft(gps_derived) ✓ weather ✓ splits sum 464s short, unreliable=false
```

Jun 7 is the worry: a polyline-less watch row means no weather enrichment (Tier-2 needs route coords) and no GPS elevation — and watch rows have no flat lat/lng fallback (wire contract). If watch GPS drops on *race day*, the same blackout hits the AFC completion. The splits final-mile gap is systematic (3 of 5) — looks like the watch finalizes the workout before the last partial/full split flushes; worth a watch-side look before race day.

## 4.5 Strava push state

Covered in 1.8: Jun 9 uploaded end-to-end in 2.2s (pipeline healthy post-fix); Jun 8 + May 31×2 are terminal `failed` with no retry affordance and no user-visible surface. The "pending sweeps tonight" question is already answered — it swept to failed at 23:49 UTC. Action: one-time re-push of the two lost runs (operational, reversible), and a "push failed · retry" chip on the run card (product).

---

# PART 5 — THE GAPS (what doesn't exist)

Ranked by what a $500/month human coach would actually do for David in the next 68 days that this app doesn't:

1. **Nobody is coaching the sleep.** The single loudest signal in his data — 6.4h nightly average through a 45-mile LOADED week, four sub-56 readiness days in six — produces a −9 pillar weight and (today) one WHAT-TO-DO line. A human coach would have had a direct conversation two weeks ago: bedtime, caffeine cutoff, the explicit trade ("you can have the 64-mile peak week OR the 6-hour nights — not both"). The app grades sleep; it doesn't *fight* for it. There is no trend-level escalation ("14 straight days under target"), no connection drawn between tonight's sleep and Thursday's tempo quality, no taper-time sleep-banking protocol (Research/08 has one).
2. **No race-execution product.** The pacing plan is one number (and currently the wrong one — 2.6). No first-mile guardrail, no corral strategy, no mile-by-mile splits card built from CI + course + heat, no fueling/caffeine timeline for a 7 AM start, no warm-up protocol (Research/08 §12.1 has the exact prescription), no "what if it's 72°F at the gun" decision tree (the B-goal exists in meta and appears nowhere in guidance). Race-day mode on the phone routes correctly and then has nearly nothing race-specific to say. **This is the single most important missing feature for AFC.** The knowledge base already contains everything needed; the product never composes it.
3. **Bad-week handling is one-directional.** Adaptation can downgrade today (readiness), shave 7 days (volume overshoot), reschedule a missed key +2d. But: travel? illness mid-build? three missed days? There is no "I'm sick, re-plan my week" interaction, no Research/05-grade return-to-run laddering after a flu (sick_episodes gates exist, but re-entry is "easy until cleared"), no replanning of the *remaining* block after a lost week (the plan never re-flows; it just keeps prescribing as if the week happened). A human coach's core value — re-sequencing after life intervenes — is absent. If David gets a 3-day work trip + a cold in July, the plan and reality diverge permanently and only the adapter's daily downgrades paper over it.
4. **No workout-level contingency.** The 19 mi / 10 @ HM session has no bail-out rule, no B-version, no "if HR > 165 by finish-mile 4, cut to 6" — the watch enforces the full prescription or David freelances. Same for race day (no positive-split abort plan).
5. **Strength is prescribed nowhere and skipped everywhere.** 17 `strength_skip` intents in 28 days, zero strength sessions logged, zero strength rows in the plan. Research/07 exists; the plan_workouts schema has no strength type rows for this plan. For a masters-adjacent runner peaking at 64 miles, two 20-minute strength touches a week is cheap injury insurance the app knows about (the recommender exists!) and doesn't schedule.
6. **The "watching" state isn't actionable.** Status flips to WATCHING and the prescribed response is a vibe ("the next quality run will tell us more"). A coach would name the test: "Thursday's 3.5 @ T at 7:17 — if you hold ≤ 7:20 at avgHr ≤ 158, we're fine." The nextTestPoints machinery exists and lists the workout; it doesn't state the pass/fail criteria that the engine itself would use afterward.
7. **No environment-aware scheduling.** The app judges heat after the run and forecasts it for race day, but never says "Thursday looks 78°F by 8 AM — move the tempo to 6 AM or swap with Friday." The forecast endpoint and best-window data exist on the iPhone sheet; the *plan* never consumes them.

What decisions is David making without data support right now? Whether 1:30 is still the right goal vs the 1:37 B (the app holds both, reasons about neither); whether to do a tune-up race (4.2 shows the math is begging for one; no surface suggests it); what to do about sleep; whether the Jul 26 monster long is a go given how the prior two weekends landed.

---

# PART 6 — THE HONEST VERDICT

**1. Is this app ready to coach David through the next 68 days?**

**No — not unattended.** It is ready to *measure* him through 68 days: volume, HR, readiness, TSB, and execution verdicts are real, sourced correctly, and mostly exact. It is not yet ready to *coach* him: the fitness-update loop is severed (dead run-VDOT pipeline, dead tempo-drift detector, contaminated decoupling signal), so the projection layer is running open-loop on a February race; the heat models disagree with the research in whichever direction is most flattering; and the race itself — the thing the 68 days are for — has a wrong pace number and no execution plan. With the Part-6.3 fixes landed, the answer flips to yes-with-supervision.

**2. If David follows this app's guidance exactly, will he run 1:30 at AFC?**

The app's own honest numbers say: **probably not, narrowly.** Current fitness 1:34:54 (CI 1:31:56–1:37:52 — 1:30 is outside the band's fast edge), 3.0 VDOT to find in 9.7 weeks at a plausible-but-optimistic 0.35/wk build rate, on 6.4h of sleep, into a morning that costs 63–150s of heat. 1:31–1:33 is the probability mass; 1:30:00 requires the peak block to land perfectly *and* a cool morning *and* even-split execution. **The single biggest risk is not fitness — it's that the app tells him to open at 6:47/mi.** That number converts a near-miss 1:31:30 into a positive-split 1:34 on a warm day. Second risk: the Jul 13–27 peak (59.5/64.5 mi at 157% of current chronic volume on chronic sleep debt) is where the injury/illness dice get rolled.

**3. The 3 most important things to verify or fix before Aug 16:**

1. **Race-day pacing: fix the 6:47 → 6:52 prescription and build the execution plan** (first-mile +10s, B-goal trigger conditions, heat decision tree, fueling/warm-up timeline). One day of work; it's the difference between executing and freelancing.
2. **Unify the heat engines on the Research/06 table** (judgeWeather ÷2, drop or evidence the 0.5× HM race scale) and store the AFC start time so the forecast path reads start-hour temps, not daily max. Otherwise every August verdict and the race-day briefing are systematically mis-calibrated.
3. **Reconnect the fitness loop**: `COALESCE(movingTimeS, timeMoving, durationSec)` in vdot-inputs, stamp `workoutType` from the matched plan day at ingest, and re-check the decoupling filter. Then the VDOT sparkline, drift detectors, CI width, and the staleness cliff (4.2) all start telling the truth in time for taper decisions.

(Honorable mentions, same week if possible: re-push the 2 lost Strava runs; add the race-week tune-up workout; alert on load-bearing-flag count; shoe data repair.)

**4. What would make this app genuinely world-class?**

The measurement layer already rivals anything on the market — single-source-of-truth dedup with write/read symmetry, per-observation context filters, citation-gated coaching rules. What separates it from "a professional athlete would pay for this" is **closing loops**: every signal should change a future prescription, and every prescription should name its own test. Concretely: (a) plans that re-flow when life happens (sick week → re-sequenced block, not 7 daily downgrades); (b) workouts that carry their own pass/fail criteria and bail-out rules onto the watch; (c) environment-aware scheduling (move the tempo before the heat arrives, not apologize after); (d) a race-execution product composed from the research it already owns; (e) behavioral coaching on the one input that gates everything else (sleep) with the same seriousness it brings to pace math. None of that is new data — it's the coach acting on what the analyst already knows.

**5. Scores (1–10):**

| Axis | Score | One line |
|---|---|---|
| **Data integrity** | **7.5** | Volume/TSB/readiness/VDOT-source verified exact; splits unreliable-and-unread, shoes wrong at rest, two heat tables, one dead field (workoutType) poisoning three consumers. |
| **Coaching correctness** | **6** | Plan architecture and quality paces are genuinely good; race pace wrong, easy bands stale, heat double-standard, fitness loop severed, no tune-up, one 12% ramp violation. |
| **Product experience** | **7** | Three surfaces coherent, race-day routing real, hierarchy honest; flat sparkline, default-vs-measured chunks indistinguishable, failed pushes invisible. |
| **Race readiness** | **4** | 68 days out with no execution plan, a hot pace number, an anchor going stale 16 days before the gun, and the heaviest weeks ahead on 6.4h of sleep. This is the score the next 4 weeks of work should move. |

---

*Diagnostic scripts for every number in this report: `web-v2/scripts/_audit_state_01…07*.mjs` (all read-only). Verified against code at `main` ce85abab, prod DB 2026-06-09 evening PT.*
