# Plan-engine re-audit — VERDICT (2026-06-23)

**Verified against committed HEAD `85f5265c` (web-v2, all source files clean). Baseline: all 34 plan test files / 902 tests pass, incl. the 120,960-combo structural sweep and the 7,758-archetype `_sweep_allusers` gate (0 firm). Every defect below is invisible to that green gate.**

---

## BOTTOM LINE

**There are remaining real issues. NOT zero.** I reproduced all 18 prior-audit findings against committed code (none refuted) and found **1 new defect** the prior two audits explicitly mis-scoped as clean. **19 total.**

- **1 critical cluster** (BRK-1 ≡ NS-1 ≡ RC2-1, one root cause, 3 IDs): soft-goal pace inversion — quality (incl. VO2max) and MP/HM long-finish prescribed SLOWER than easy. **Regression of PACE-E-1.** Reproduces both connection states.
- **1 critical** (PP-1): persisted quality realizes past the composer clamp AND past the long run inside the gate's own matrix (36 quality>long, max +2.2mi/day / +3.4mi/week). Gate grades composed, ships realized. **Regression (capSpecToDistance floor).**
- **1 NEW major** (NEW-A): the SAME soft-goal inversion fires in **maintenance mode** (far-out race + soft goal). Prior audits asserted maintenance "is NOT affected" — **wrong**; `tPaceFromGoal(softGoal)` is non-null so `tPaceSec` is the slow goal pace. Reachable in prod loader (`generate.ts:3230`).
- **6 major**: BRK-2/CC2-1 (bucket-0 false-reject → saved-goal-no-plan dead-end), LSP2-1 (goal race-week collapse, prod-only), PP-2 (tune-up cap moot, −0.5..−1.4mi/wk taper shortfall), RC2-2 (HM-advanced peak long stranded at 14 < band [15,17]). 
- **9 minor**: BRK-3, PP-3≡RC2-3, RC2-4, NS-2, LSP2-2, CC2-2, CC2-3, CC2-4 (latent), and the maintenance-NS-2 long-floor.

**Session-fix regressions: 4** — PACE-E-1 (BRK-1/NS-1/RC2-1 + NEW-A), capSpecToDistance round-2 (PP-1), CC-1 (PP-2), RECOVERY-1 (BRK-3).

**Clean dimensions (zero is real):** the race-day row pace is correctly sourced from `goalPaceSPerMi` (a soft goal does NOT corrupt it); the ambitious-goal direction (`currentT>goalT`) and by-feel (`goalSec=null`) are inversion-free (verified controls); David's frozen periodization snapshot is byte-safe under the BRK-1 + CC2-1 fixes; the cold-start `conservativeVdotFromMileage` path does not invert; horizon happy-path (marathon-band) + the corruption branch validate correctly.

---

## REPRODUCTION EVIDENCE (how each was confirmed)

All probes used `buildSimPlan` + a byte-faithful replica of `persistPlan`'s per-day spec realization (`generate.ts:2412-2454`: `weekT=w.tPaceSec`, `easyAnchorTSec=tPaceFromVdot(bestRecentVdot ?? conservativeVdotFromMileage(recentWeeklyMi))`, `buildWorkoutSpec → capSpecToDistance → totalDistanceMiFromSpec`). Scratch tests deleted; source confirmed clean.

| Finding | Probe result (HEAD) |
|---|---|
| BRK-1/NS-1/RC2-1 | CASE A (adv V62 / 4:00 M): 20 quality + 7 long-finish inversions (threshold 531 > easyLo 423; MP finish 549 > longHi 433). CASE B (adv V62 / 25:00 5K): **VO2max intervals 462 > easyLo 423**. NS-1 (V50 / 2:10 HM): 20+6. ALL controls (ambitious, by-feel, cold-realistic) = **0**. Fix `tPaceForWeek: currentT<=goalT → return currentT` + `finish = min(tPaceSec,easyAnchorT)+offset` → ALL→0, sweep stays 0-firm, David snapshot green. |
| NEW-A | far-out M race + soft 4:00 goal + V55 → mode=maintenance, tPaceSec=531, easyAnchorT=381 → 4 threshold days 70 s/mi slower than easy. Fix (floor tPaceSec at currentT) → 0, sweep 0-firm. |
| PP-1 | gate-matrix sweep (MILEAGE=[5,15,25,35,45], non-race wks): 1660 day Δ>0.5, 2896 week Δ>0.5, **36 persisted-quality>persisted-long**. Exact: half/intermediate/f5/m5/L0-3 wk4 threshold composed=1 → **3.20mi > 3.00mi long**. |
| BRK-2/CC2-1 | bucket-0 (recentWeeklyMi=3): 10K/12wk THROW (but 10K/14wk PASS), HALF/16 THROW, M/18 THROW — cold===strava. Conditional `rampBase` floor-of-6 → all PASS, validate.test.ts 10/10 green. |
| LSP2-1 | Monday-start 16wk HM goal: PROD final wk `{trMi:0,nDays:1,"race"}` vs SIM `{trMi:14,nDays:5,"...tuneup...shakeout...race"}`. **All 7 start weekdays collapse** in prod. |
| LSP2-2 | 1-2yr 5K PR: sim VDOT 49.8 (currentT 415) vs prod undefined→563. **gap 148 s/mi** (> headline's 88). Control <6mo: 49.8=49.8. |
| PP-2 | M-adv taper non-RW tune-up composed=4 → persisted **3.50** (Δ−0.5); race-week tune-up `4×1km` composed=5 → 5.00 (exact). |
| PP-3≡RC2-3 | both non-race TAPER weeks carry qualityCount=2 `[race_week_tuneup,race_week_tuneup]`; race-week correctly 1. |
| RC2-2 | HM advanced peakLong **14** (band [15,17]); elite 18∈[16,20]; 10k-adv 13∈band, 5k-adv 12∈band. |
| RC2-4 | 18wk M-adv deloads −14.0% / −15.1% / −16.4% (all < Research 20% floor). |
| BRK-3 | M recovery = 4 flat all-easy weeks `[10,20,30,40]`, **hasLong=false every week** (0 `isLong:true` in `composeRecoveryPlan` body 2114-2240). |
| NS-2 | justRun beginner bucket-0: wk0 16mi(f5)/10mi(f3), **long=4=200% of recentLong 2**; goal-mode control ramps from 4mi. |
| CC2-2 | gate MILEAGE omits 0; lowest fed is `recentWeeklyMiFromBucket(5)=10`. Confirmed. |
| CC2-3 | adv vs advanced_plus composed plans **byte-identical** (12/12 distance×goalset); `void floor` (gen:712) + `RAMP_PCT` dead; reachable via iPhone Settings 'Elite'. |
| CC2-4 | builder `horizonRaise` fires for HM long-extend at category-M boundary (d>17); validator flag `isSteppingStoneToMarathon` at `distanceMi>=20` → **(17,20) gap** persist-aborts. Latent (distanceMiOf doesn't map 30K; 0 DB races in band). |

---

## ORDERED FIX LIST (by severity)

### CRITICAL

**1. Soft-goal pace inversion — BRK-1 ≡ NS-1 ≡ RC2-1 (race-prep) + NEW-A (maintenance). Regression of PACE-E-1. connection: both.**
- **Root cause:** PACE-E-1 anchored easy/long/recovery to `easyAnchorTSec=currentT` (`spec-builder.ts:233-235`) but left ALL quality on the goal-blended `weekT`. For a soft goal, `tPaceForWeek` (`generate.ts:1704`) returns the slow `goalT` (`currentT<=goalT → return goalT`), and the long finish (`spec-builder.ts:283`) is `tPaceSec+18/+5`. No clamp keeps quality faster than easy. GOAL-2 (`generate.ts:1678-1680`) only floors goalT UP for over-ambitious goals.
- **Research:** Research/01:124-133 (E 59-74% < M 75-84% < T 83-88% < I — easy is the slowest zone by definition); Research/04:85-87 (long finishes are at MP or FASTER, never slower than easy); Research/04:159/§5.2 (continuous tempo = T). A VO2max session or "MP finish" slower than easy violates the foundational Daniels ordering.
- **Fix (3 parts, all byte-safe for ambitious + by-feel + David, sweep stays 0-firm — verified):**
  - `generate.ts:1704` — split: `if (currentT == null) return goalT;` then `if (currentT <= goalT) return currentT;` (soft goal trains at current fitness; the soft time stays the race-day target because the race row reads `goalPaceSPerMi` first).
  - `spec-builder.ts:283` — `const finishAnchorT = Math.min(tPaceSec, easyAnchorT);` then `finish_pace_s_per_mi: finish.tag==='HM' ? finishAnchorT+5 : finishAnchorT+18`. (Unthreaded callers pass `easyAnchorTSec=null → easyAnchorT=tPaceSec` ⇒ `min(tPaceSec,tPaceSec)` ⇒ byte-identical.) Also delete the dead `const mp` at `spec-builder.ts:247` (referenced only in comments).
  - **NEW-A (maintenance):** floor the `tPaceSec` source so the maintenance/recovery composers (which read `input.tPaceSec`, not `tPaceForWeek`) can't inherit the slow goal: at `generate.ts:3230` (loader) AND `sim-inputs.ts:196` (sim parity) change `tPaceFromGoal(...) ?? currentT ?? 480` to floor the goal pace at currentT: `const goalTp = tPaceFromGoal(goalSec, raceDistanceMi); const tPaceSec = (goalTp != null && currentT != null ? Math.min(goalTp, currentT) : goalTp) ?? currentT ?? 480;`. Verified: maintenance inversion 4→0, sweep 0-firm. (Independent of the `tPaceForWeek` fix — `goalT` derives from `input.goalSec`, not `input.tPaceSec`, so race-prep is unaffected.)
- **Gate guard:** add to `_sweep_allusers.test.ts` — for one quality day + one long-with-finish per archetype, build the spec (same `weekT` + `easyAnchorTSec` persistPlan passes) and assert every quality work-pace `< easyLo (easyAnchorT+80)` and `finish_pace < longHi (easyAnchorT+90)`. Add bestRecentVdot×soft-goal archetypes (gate currently pairs the override only with the FAST standard goal).

**2. PP-1 — persisted rep-quality inflates past the clamp AND the long. Regression (capSpecToDistance round-2). connection: both.**
- **Root cause:** `capSpecToDistance` (`spec-builder.ts:598-628`) and `buildWorkoutSpec` floor rep-based kinds at 2 reps + WU/CD 0.5 each; the `while(reps>2)` guard (618) is a no-op at reps=2, so a `3×1mi` threshold realizes ~3.1mi and an intervals `5×800m` ~2.2mi regardless of a `maxMi=1` clamp. `layoutWeek` clamps the quality day small for INV3/SP-7 (`generate.ts:1165-1166`) but `persistPlan` (2453-2454) re-realizes to the floor. Tempo scales correctly — only threshold/intervals break.
- **Research:** SP-7 / long-primacy is the codebase's OWN invariant (`validate.ts:362-378`, enforced on composed but not realized); Research/22 templates list peak long as a distinct larger row than quality.
- **Fix:** (a) **persist-realization parity gate** (load-bearing) — in `_sweep_allusers.test.ts`, replicate the realize path per quality day and assert `|persisted−composed|<0.5` AND `persisted ≤ persistedLong+0.15`; add bucket 0 to MILEAGE. (b) **engine:** let rep-based quality realize small — drop to 1 rep + shrink `rep_distance_mi` (`k=available/repMi`, mirroring tempo's scaling) when budget < the 2-rep floor; change `capSpecToDistance` `while(reps>2)` → `while(reps>1)` and add the rep-scale path. Byte-safe (only engages when realized>maxMi+0.05 at a tiny budget). (b-alt) refuse to clamp a quality day below its kind's irreducible floor at `layoutWeek` (raise the long, or demote to tempo/easy).

### MAJOR

**3. BRK-2 / CC2-1 — bucket-0 false-reject → saved-goal-no-plan. Regression (VAR-06 floor vs validator base). connection: both.**
- **Root cause:** `volumeCurve` floors curve start to `max(6,baseMi)` (`generate.ts:711-713`) but `validate.ts:241` `rampBase=max(recentWeeklyMi,trailing)` uses the RAW base (3) with no matching floor → the curve's own ramp exceeds its base-3 ceiling. 10K/HALF reject (research-wrong: sub-band, gentle ramp); marathon is a design call.
- **Research:** Research/22 §Half-Beginner / Higdon-Novice (3mi→10mi long ~15-20mpw is standard); Research/00a:200-201 (5K 10-20, 10K 15-25 — engine refuses below its OWN beginner band).
- **Fix:** `validate.ts:241` → `const rawRampBase = Math.max(recentWeeklyMi??0, trailing??0); const rampBase = rawRampBase>0 && rawRampBase<6 ? 6 : rawRampBase;` (conditional — byte-identical for base≥6 and absent base; the unconditional `Math.max(6,…)` breaks 5 validate.test.ts fixtures — do NOT use; drop the finding's `level==='beginner'` clause — the curve floors all levels). **Verified: bucket-0 10K/HALF/M all PASS, validate.test.ts 10/10 green.** Marathon-as-pass is David's call (refuse-with-reason vs build). **Also close the dead-end regardless** (`onboarding/complete/route.ts:569-581`): on `ok:false`, fall back to a base-building maintenance plan OR surface the refusal reason, instead of `success:true` with `plan:{ok:false}` and no UI signal.

**4. LSP2-1 — goal-mode race-week collapses to a bare race day (prod-only). connection: no-strava.**
- **Root cause:** `profile/goal/route.ts:118` builds `raceDateISO=start+weeks*7` with NO weekday snap; the loader (`generate.ts:2958-2959`) reads it verbatim; SP-4 (`generate.ts:1779`, `daysBetween(raceDateISO,dayDate)>0`) strips every day after the race. Because `raceDow==startDow` and `startMondayISO=startDateISO` (literal, 3091-3093), the race lands on day-0 of its window → tune-up/easy/shakeout wrap onto post-race days → stripped. Auto-rebuild bails on `race_id=null`. The sim's Saturday snap (sim-inputs.ts:164-166) hides it.
- **Research:** Research/08 §9.3 race-week day-by-day templates.
- **Fix (single-source, in the loader, goalTarget ONLY — never the real-race path which honors a chosen date):** after `startMondayISO` is computed, snap `raceDateISO` to the LAST day of its START-anchored window: `const startDow=…getUTCDay(); const raceDow0=…; const toEndOfWindow=((startDow-1-raceDow0)%7+7)%7; raceDateISO=addDays(raceDateISO,toEndOfWindow);`. **The Saturday snap (Option A) and longRunDow snap (Option B) are both wrong — they only work for Monday/Sunday starts** (a Saturday start + Sat-snap still collapses). Verified: the start-window-end snap yields trMi=18/nDays=6 for all 7 start weekdays. Gate: add the REAL loader/composePlan goalTarget path (not just `buildSimPlan`) asserting final-week trainingMi>0 + a `race_week_tuneup` across all 7 start weekdays.

**5. PP-2 — non-race-week TAPER tune-up cap is moot (−0.5..−1.4mi/wk taper shortfall). Regression (CC-1). connection: both.**
- **Root cause:** non-RW taper tune-up subLabel hardcoded `'WU 1.5mi · 2×0.5mi @ T-pace · CD 1mi'` (`generate.ts:1252`) → `spec-builder.ts:496-498` caps WU 1.5 / CD 1.0 → realizes max ~3.6mi regardless of CC-1's 5/4 cap. The race-WEEK path already uses the doctrinal `4×1km @ race pace` (`generate.ts:997`) which realizes to the budget exactly.
- **Research:** Research/08:411 (HM race-week = `4×1K @ HMP, 90s`); 3-5mi rehearsal intent (so 3.5 is fine — the defect is composed≠persisted + wrong shape).
- **Fix:** change `generate.ts:1252` non-RW tune-up subLabel to `'4×1km @ race pace · 90s jog'` for hm/m (mirror the race-week branch keyed on raceDistanceMi≥12), keep the short `2×0.5mi @ T · 60s` for 5k/10k. **Verified: `4×1km` realizes to the budget exactly at every value 2.5→5.0** (vs `2×0.5mi` diverging at every budget ≥3.5). Keep CC-1's cap (now reachable). Race pace resolves correctly (persist `race_week_tuneup` sets repPace=goalPaceSPerMi on `/race pace/`).

**6. RC2-2 — HM advanced peak long stranded at 14 (band [15,17]). connection: both.**
- **Root cause:** DIST-1 distance-driven long sizing (`generate.ts:1103-1105`) is gated to `m||ultra`; HM falls to `round(weeklyMi*longShare)`. For HM advanced (longShare 0.25, volume peak ~56) that's 14<15. The comment at 1095-1096 ("share already lands in band") is false for HM advanced.
- **Research:** Research/22:205/213 (HM-Advanced peak long 15-17, "16mi LR w/ last 8mi @ HMP"); engine's own `goal-tiers.ts:198` band [15,17].
- **Fix (byte-safe — only lift when the share underreaches band[0]):** `generate.ts:1103` — `const drivenRaw = peakWeeklyMi>0 ? round(weeklyMi*(longCap/peakWeeklyMi)) : 0; const shareRaw = round(weeklyMi*longShare); longMiRaw = (m||ultra)&&peakWeeklyMi>0 ? drivenRaw : Math.max(shareRaw, round(peakWeeklyMi*longShare) < band[0] ? drivenRaw : 0);`. **Verified: HM-adv 14→17, elite/int/dev stay in-band.** (Side-observation, separate: HM-developing came out 13 vs band[1]=12 — a 1mi over-band overshoot; not blocking.) Harden the gate's LONG_UNDERREACH from WARN to a FIRM `peakLong >= band[0]` floor for race-prep.

### MINOR

**7. BRK-3 — 4-week M recovery is 4 flat all-easy weeks, no long. Regression (RECOVERY-1). connection: both.**
- `composeRecoveryPlan` (`generate.ts:2114-2234`) authors zero `isLong:true`; only EASY(MEDIUM)+EASY. RECOVERY-1 extended wkPctSeq to `[0.15,0.35,0.55,0.75]` so the back weeks are high-volume flat. Research/00b:256-263 prescribes a building-back long from week 2 + light quality at wk3-4. **Fix:** author a recovery long from gwk≥1 for m/ultra, sized `clamp(round(recentLongMi*wkPct), 6, ~10)` (the 75-90min ceiling) AND `≤round(wkWeekly*0.40)`, on longRunDow, clamp easies below it; keep week 1 flat. (Quality re-intro is a separate larger enhancement.)

**8. PP-3 ≡ RC2-3 — TAPER weeks carry TWO identical tune-ups (one finding, two IDs). connection: both.**
- `generate.ts:1648` `densityForWeek` returns full `desiredDensity` for TAPER; the 1-element `['race_week_tuneup']` (1222) folds onto both quality dows via `i%len`. Research/08 §9.2 = ONE quality per taper week. **Fix:** `densityForWeek` → split BASE from TAPER: `if(phase==='BASE') return desiredDensity; if(phase==='TAPER') return Math.min(1,desiredDensity);` and (per §9.2 "intensity preserved") make the single taper quality a `threshold`, not the tiny `race_week_tuneup` freshener (the freshener stays solely in the isRaceWeek branch). **BLOCKER:** this breaks David's FROZEN INV-12 snapshot (`_audit_periodization.test.ts:501` pins 2 tune-ups/taper-week). Present the before/after taper fingerprint, get David's sign-off, re-baseline the snapshot. Not a silent change.

**9. RC2-4 — cutback depth ~15% below the Research 20-30% band. connection: both.**
- `generate.ts:752` deload = `round(lastClimb*0.85)` → realized 4-16% (David's wk8 only 4.3%). Research/00a:753 + 00b:160-165 = 20-30% (40-60mpw), measured vs the realized preceding-block peak. **Fix:** a budget-level 0.85→~0.75 alone is insufficient (VOL-1 reconciles the realized drop shallower); add a POST-reconcile deload-depth enforcement pass (mirror the COH-4 taper-descent enforcement at `generate.ts:2651-2675`) targeting tier mid-band (~0.75 <60, 0.72 60-80, 0.70 80+) vs the realized peak. Flips David's `david-marathon-structure` snapshot → needs sign-off.

**10. NS-2 — maintenance over-prescribes a true-beginner (3mpw→16mpw, long=200% of recent). connection: no-strava.**
- The CITED violation is the LONG (not the easy floor): `generate.ts:1938-1941` `Math.max(4,…)` forces a 4mi long onto a 2mi recent longest. validate.ts:184-191 exempts maintenance from the long-cap so it persists. **Fix:** replace the hard `4` with a 110%-coherence floor: `targetLong = max(min(3, round(recentLongMi*1.10)), min(round(recentLongMi*1.10), round(targetWeekly*0.30)))` (recentLong=2 → 2mi long; recentLong≥4 unchanged). Separately, to stop the 5.3x weekly leap, hold a sub-8mpw beginner near their reported week + use a small easy sanity floor (mirror recovery's MIN_EASY=2) instead of `max(3,median||5)` at `generate.ts:2000`. Narrow prod reach (true-beginner + far-out race → maintenance).

**11. LSP2-2 — sim `bestVdotFromHistory` ignores the 365-day recency gate prod applies. connection: no-strava.**
- `sim-inputs.ts:57-65` loops raw `vdotFromRace` with no `whenRaced` gate; prod `generate.ts:3143` calls `bestVdotFromRaceHistory(...,365)` (skips daysAgo>365). gap 148 s/mi for a 1-2yr PR (by-feel mode only; goal mode converges on the seeded goal time). DB: 0 live profiles with race_history → sim-fidelity only. **Fix (Part A, do now):** swap `sim-inputs.ts:56-65` for the shared `bestVdotFromRaceHistory(sim.raceHistory, 365)` (fixes recency + the ±0.1-VDOT SIM_DISTANCE_MI drift). **Do NOT change `page.tsx`'s goal-time seeder** (correctly ungated, mirrors native onboarding). **Part B (flag to David, decision):** Research/01:659-675,714 makes ≤56d the canonical freshness window and calls 12+wk "Expired"; prod's 365 keeps a ~38wk-stale 6-12mo bucket. Options: keep 365 (parity) vs treat any onboarding PR >8-12wk as a FLOOR not an anchor. Default keep-365; David picks.

**12. CC2-2 — gate MILEAGE omits bucket-0. connection: both.** `_sweep_allusers.test.ts:20` `[5,15,25,35,45]`; lowest fed is 10. The true-beginner refuse-vs-plan boundary (where BRK-2/CC2-1 live) is untested. **Fix:** add 0; split grading — bucket-0 by-feel 5K/10K/half beginner must produce a VALID plan; bucket-0 aggressive M/ultra must surface the graceful refusal (`toFriendlyPlanError`). Guards the CC2-1 fix.

**13. CC2-3 — advanced_plus swept but onboarding-unreachable AND dead tuning. connection: n/a.** adv vs advanced_plus byte-identical; `void floor` + `RAMP_PCT` dead. BUT reachable via iPhone Settings 'Elite' (`SettingsView.swift:676`) → a user who picks Elite silently gets an 'advanced' plan. **Fix — pick one (do not leave half-wired):** (A) make it real WITHOUT re-introducing the floor (VAR-06-safe): make `volumeCurve`'s ramp cap level-aware (read RAMP_PCT into `generate.ts:742`), add a distinct TIER_TARGETS band, cite Research/22 §10 (85-110mpw doubles); OR (B) defer: delete dead RAMP_PCT + `void floor`, comment the alias-fold, drop advanced_plus from the gate AND remove the Settings 'Elite' option. Recommend A (Settings + adapt.ts:132 + templates already commit to it).

**14. CC2-4 — horizon stepping-stone builder/validator threshold mismatch (latent). connection: strava.** Builder `horizonRaise` (`generate.ts:1581`) extends the HM long for a category-M horizon (d>17); validator flag `isSteppingStoneToMarathon` (`generate.ts:2778`) fires at `distanceMi>=20` → a (17,20) horizon (30K=18.64mi) makes the builder author 21mi while the flag stays false → HM cap 20 → **persist-abort**. Latent: `distanceMiOf` doesn't map "30K", standard writes store label-only, 0 DB races in band. **Fix (primary, code):** key the validator flag to the same category boundary as the builder — hoist a shared `isMarathonBridgeHorizon(horizonRaces)` used by both. **Secondary:** thread `horizonRaces`/`priorPlanPeakLongMi`/`isSteppingStoneToMarathon` into `buildSimPlan` (currently hardcoded undefined/false/null at `sim-inputs.ts:217,248`) + add a gate block (30K horizon validates; label-only marathon fires HORIZON-1; same-goal regen exercises the corruption branch). Do the 30K `distanceMiOf` parity ONLY after the threshold fix lands (it would otherwise activate the latent bug).

---

## What was checked and is genuinely CLEAN

- **Race-day row pace under a soft goal:** the `race` branch reads `goalPaceSPerMi` first (`spec-builder.ts:~432`), so the soft goal stays the race-day target — the BRK-1 `tPaceForWeek` fix does NOT corrupt it (verified).
- **Ambitious-goal + by-feel directions:** controls show 0 inversions (`currentT>goalT` falls to the blend; `goalSec=null` → currentT). The fixes are no-ops here.
- **David byte-safety:** periodization + persisted-quality snapshots pass (0 violations) under both the BRK-1 and CC2-1 fixes (David is the ambitious branch / base≥6).
- **Cold-start `conservativeVdotFromMileage`:** the "realistic" cold 3:45-marathon control = 0 inversions (the mileage-estimate makes currentT≈goalT).
- **Horizon happy-path + corruption branch:** marathon-band horizon extends + validates cleanly; the <80% corruption check fires correctly and doesn't false-positive ≥80%.
- **Structural integrity:** 120,960-combo structural sweep = 0 bad/structural throws at HEAD.

---

## EXECUTIVE SUMMARY (≤12 lines)

```
NOT ZERO — 19 real defects (18 prior all reproduced against HEAD 85f5265c + 1 NEW).
By severity:  CRITICAL 2  ·  MAJOR 6  ·  MINOR 11.
Session-fix regressions: 4 — PACE-E-1 (soft-goal inversion, both modes), capSpecToDistance (PP-1), CC-1 (PP-2), RECOVERY-1 (BRK-3).
NEW (audits mis-scoped as clean): NEW-A — soft-goal inversion ALSO fires in MAINTENANCE (far-out race + soft goal), tPaceFromGoal non-null → slow tPaceSec; prod-reachable (generate.ts:3230).
Clean (zero is real): race-day row pace under soft goal · ambitious + by-feel directions · David byte-safe under fixes · cold-start conservativeVdot · horizon happy-path + corruption branch · 120,960 structural.
FIX ORDER:
  1 (CRIT) Soft-goal inversion — gen:1704 currentT-floor + spec:283 finish min(tPaceSec,easyAnchorT) + NEW-A gen:3230/sim:196 tPaceSec floor [PACE-E-1 regression, byte-safe, sweep 0-firm verified]
  2 (CRIT) PP-1 persist-realization — capSpecToDistance reps→1 + rep-scale; ADD persist-parity gate + bucket-0 [capSpecToDistance regression]
  3 (MAJ)  BRK-2/CC2-1 bucket-0 — validate:241 conditional rampBase floor-of-6 + close the saved-goal-no-plan dead-end [VAR-06 regression]
  4 (MAJ)  LSP2-1 goal race-week — snap goalTarget to START-window end in loader (NOT Saturday/longRunDow) [prod-only]
  5 (MAJ)  PP-2 tune-up shape — gen:1252 non-RW tune-up → '4×1km @ race pace' for hm/m [CC-1 regression]
  6 (MAJ)  RC2-2 HM-adv long — gen:1103 extend DIST-1 to HM when share underreaches band[0]
  7-17 (MIN) BRK-3 · PP-3≡RC2-3* · RC2-4* · NS-2 · LSP2-2(+David decision) · CC2-2 · CC2-3 · CC2-4(latent)   (*flip David's frozen snapshot → needs sign-off)
```

---

## RESOLUTION (2026-06-23) — 16 fixed + deployed, 3 flagged for David

Deployed to main in 4 batches: `9f8d1744` (critical+major), `03f9dbf1` (gate guard + BRK-3 + NS-2),
`569933e0` (CC2-4 + CC2-2). Suite 903 green; sweep 9294 archetypes / 0 firm.

**FIXED (16):**

| ID | What | David impact |
|---|---|---|
| BRK-1/NEW-A | Soft-goal pace inversion — above-goal runner's quality shipped SLOWER than easy. `tPaceForWeek` trains a soft goal at CURRENT fitness; long finish = min(tPaceSec, easyAnchorT)+offset; loader+sim floor maintenance/recovery tPaceSec at currentT. | byte-safe (sub-fitness/ambitious) |
| PP-1 | Clamped rep-quality realized ~3.1mi OVER the long. `capSpecToDistance` drops to 1 rep + shrinks rep distance → realizes ≤ budget. | byte-safe (tiny budgets only) |
| BRK-2/CC2-1 | bucket-0 10K/HALF/M false-rejected → saved-goal-no-plan. `validate` rampBase floors at 6 (conditional). | byte-safe (base≥6) |
| LSP2-1 | goalTarget race landed day-0 of its week → SP-4 collapsed the final week. Loader snaps to week-END. | no-op (real race) |
| PP-2 | hm/m taper tune-up `2×0.5mi @ T` capped ~3.6 → doctrinal `4×1km @ race pace`. | **re-baselined frozen** |
| RC2-2 | HM-advanced peak long stranded at 14 < band[15,17]. Distance-driven into band when share underreaches band[0]. | byte-safe (horizon HM in-band) |
| BRK-3 | RECOVERY-1 reverse taper ended long-less. Final recovery week reintroduces a LONG. | no-op (race-prep active) |
| NS-2 | Maintenance 4mi long floor forced ~2× jump on true beginner. Floor caps at recent long. | byte-safe (recent long ~13) |
| CC2-4 | Stepping-stone validator flag (≥20) mismatched builder's extend boundary (>17) → (17,20] persist-abort. Aligned to >17. | no-op (CIM 26.22) |
| CC2-2 | Gate omitted bucket-0. Added with split grading (short/by-feel must plan; aggressive-long may refuse). | n/a (gate) |
| **Gate guard** | `_audit_persist_realization.test.ts` — replicates persistPlan's per-day spec math across the matrix incl. soft-goal; asserts no inversion + persist≤long. **Closes the blind spot that hid BRK-1/PP-1.** | n/a (gate) |
| CC2-3 | advanced_plus/Settings 'Elite' — RESOLVED as decision B (floor advanced + pace-driven elite ceiling, already implemented). No change. | n/a |

**FLAGGED for David's sign-off (3 — each changes his live plan or needs a window call):**

- **PP-3≡RC2-3** — both non-race TAPER weeks carry 2 `race_week_tuneup` quality slots. Research/08 taper
  doctrine ≈ 1 quality session per taper week (reduce volume, hold intensity). Fix changes his taper → sign-off.
- **RC2-4** — cutback/down weeks deload ~14-16%, below the Research 20-30% band. Deeper cutbacks change his
  cutback weeks → sign-off (consistent with the taper-deepening he approved 70→55→40).
- **LSP2-2** — sim `bestVdotFromHistory` ignores the 365-day recency gate prod applies (sim-fidelity only;
  prod is correct). Part B = David's call on the PR window (365 vs 8-12wk). Sim preview only.

**CC2-4 secondary (deferred, latent):** thread horizonRaces/priorPlanPeakLongMi/isSteppingStoneToMarathon
into buildSimPlan + a 30K-horizon gate block, then the 30K `distanceMiOf` parity — ONLY after the >17
alignment is live (the parity would otherwise activate the latent bug).
