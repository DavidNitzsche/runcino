# COACHING INTELLIGENCE AUDIT

**Date:** 2026-06-09
**Scope:** Does this app give *correct, safe, and honest* coaching advice to **any** runner — beginner, elite, no-race, injured, post-race, cold-start — not just David?
**Method:** Read-only (`DATABASE_URL_RO`). Static read of the engine + numerical verification of every formula I could compute. Falsify-not-confirm.
**Legend:** 🚨 WRONG · ⚠️ MISSING/RISK · ✅ PASS · 🔵 DECISION (defensible but a judgment call worth surfacing)

---

## BOTTOM LINE (read this first)

**The math cores are correct and the safety direction is right.** I tried hard to find advice that would injure a runner and the engine consistently fails *safe*: every recovery prescription is "skip / easy / trim / rest," never "push through." The Daniels VDOT formula, the Maughan heat table, the Coggan TSB model, and the Daniels pace tables are all implemented correctly — verified numerically, not just read.

**The real risks live at the edges, and they all share one root cause: what happens when there is no measured fitness signal.** A runner *with* history and a watch (David) gets correct, safe coaching. A runner *without* one — cold-start, casual jogger, optimistic beginner — can get paces anchored to an unvalidated goal, a confident-looking readiness band built on zero data, and a fitness number set by a single 180-day-old run.

**For David specifically (VDOT 47.9, real data, AFC in 68 days): the system is in good shape.** His paces are VDOT-anchored and land within ~7 s/mi of canonical Daniels. The items that touch him are minor (a 7 s/mi-fast threshold anchor) or conditional (extreme-heat messaging if AFC morning is hot).

### The three most important fixes before AFC

1. **🚨 Cold-start pace anchoring has no fitness floor and no goal-realism guard** (`generate.ts:1124-1136`). When a runner has no VDOT signal, *all* paces — easy through intervals — anchor to their entered goal. An optimistic goal (sub-20 5K from a 28-min runner) produces unrunnable "easy" paces and genuinely dangerous interval paces. This is the one path in the app that can actively hurt a beginner. Fix: estimate a conservative current VDOT at onboarding and floor the anchor there; clamp goal realism.
2. **⚠️ Readiness band renders confidently on zero data** (`HealthView.tsx:507-512`). `readiness.ts` correctly returns `band:'unknown'` for cold-start, but the view throws it away and recomputes from a null score, which falls through to **PULL-BACK (red)**. A brand-new user is told to back off before they've logged anything. Fix: add the `unknown` branch.
3. **⚠️ No heat-*safety* messaging at dangerous temperatures** (`race-conditions.ts:185`, `heat-adjustment.ts`). Above 85°F the app predicts a slower *time* but never warns about heat illness, hydration, or backing off effort. For AFC (San Diego, August) and for any runner in a heatwave, a pace delta is not a safety message.

A certified RRCA/USATF coach would sign off on the **methodology** here without hesitation — the doctrine is sound and well-cited. They would object to the **cold-start pace path** as the one place the app could prescribe an injury, and to the **readiness-on-no-data** display as dishonest.

---

## 1. READINESS SYSTEM — `readiness.ts`, `readiness-brief.ts`, `health-actions.ts`

### ✅ Cold-start returns honest null, not a fake 70 — `readiness.ts:224-226`
When every pillar is "no data" / "building history," the function returns `{ score: null, band: 'unknown', label: 'UNKNOWN' }`. This is exactly right — no fabricated confidence. The engine layer is honest.

### ⚠️ …but the view discards it and renders a confident band on zero data — `HealthView.tsx:507-512`
```ts
const band = brief?.band ?? (
  readiness.score >= 85 ? 'sharp'
  : readiness.score >= 70 ? 'ready'
  : readiness.score >= 55 ? 'moderate'
  : 'pull-back'
);
```
`app/api/readiness/brief/route.ts:37` returns `brief: null` for brand-new users, so `brief?.band` is undefined and this ladder fires. It has **no `unknown` branch**. A cold-start `readiness.score` (null) makes every comparison false → **`'pull-back'` (red)**. Result: a runner with zero recovery data is shown a confident "PULL BACK." The fix is one line — fall back to `readiness.band` (already `'unknown'`) instead of re-deriving from the score. *(Even if the seed defaults score to 70 instead of null, this ladder then renders a false "READY" — either way the honest `unknown` is unreachable.)*

### ⚠️ Single-pillar over-confidence — `readiness.ts:73-110`
Pillars are additive deltas off baseline 70; a missing pillar contributes 0 (neutral), not reduced confidence. A runner with **only** HRV data and a good reading gets `+18 → 88 → SHARP` ("green light for hard work") off one signal, with sleep/RHR/load/HR-recovery all blind. The breakdown rows honestly show "no data," but the headline score/band do not down-weight for missing pillars. A single overnight HRV reading should not produce a confident "go hard." Consider gating SHARP behind ≥3 live pillars, or widening toward MODERATE when coverage is thin.

### 🔵 Pillar weights diverge from the app's own cited research — `readiness.ts:7-16` vs `BuildResearch/D1-recovery-score-methodology.md:107-116`
The header cites "§8.3 doctrine." That doctrine (D1) weights **HRV 40% / RHR 18% / Sleep 22% / Load 15% / Temp 5%**. The code uses **Sleep 28% / HRV 28% / RHR 24% / Load 15% / HR-recovery 5%**, and custom bands (`<50 PULL BACK / 50-65 MODERATE / 65-85 READY / >85 SHARP`) vs the research's `0-32 Strained / 33-66 Steady / 67-100 Recovered`. HRV is the single most-validated overnight recovery signal and the code **down-weights it** from 40% to 28% while up-weighting sleep and RHR. The 2026-05-30 comment ("renormalized to objective signals only") explains *why* it changed but not why HRV specifically dropped below sleep. Not unsafe — but the code no longer matches the doctrine it cites. Decide: update the code to the doctrine, or update the doctrine to the code.

### ✅ Pull-back threshold is research-grounded and safe — `readiness.ts:135-168`, `health-actions.ts`
LOAD pillar uses Gabbett ACWR with the correct bands (verified against `Research/15-wearable-data.md:213-220`: `<0.8` detraining, `1.0-1.3` sweet spot, `1.3-1.5` caution, `>1.5` danger). PULL-BACK band (<50) plus the `health-actions` prescriptions are uniformly safe-direction (see §6/§8).

### ✅ Sick / luteal / load handled correctly
- **Luteal HRV adjustment** (`readiness.ts:80-83`): subtracts 5 ms from baseline for female + luteal so biology isn't penalized. Cited to `Research/13`. Good, rarely-seen detail.
- **Sick / niggle:** routed through `health-actions` hard rules (skip/walk), and the voice band soft-caps so SHARP can't fire while sick (see §6).

### ⚠️ Doc drift (cosmetic, not user-facing)
Inline comments say "SLEEP (30%) / HRV (30%) / RHR (25%)" (`readiness.ts:42,73,112`) while the user-facing labels say 28/28/24. Harmless but should be reconciled.

---

## 2. TRAINING FORM / TSB — `training-form.ts`

### ✅ CTL/ATL/TSB model is the correct Banister/Coggan one — `training-form.ts:72-75, 190-192`
CTL = 42-day EWMA, ATL = 7-day EWMA, `today = yesterday·(1−α) + stress·α` with α = 1/window. This is the standard operationalization (verified against `Research/15-wearable-data.md:434-446`). The linear-decay α (1/42, 1/7) vs the exponential `1−e^(−1/τ)` differs by <0.3% at CTL and ~7% at ATL — immaterial.

### ✅ Cold-start and injury-return handled — `training-form.ts:173, 240`
- No history → returns `null` → caller uses STEADY/cold-start defaults (not a fake number).
- `CTL < 10 → BUILDING` so a runner without chronic load can't be labeled OVERREACH or DETRAINING off noise. Correct.
- Injury return (sudden load drop): ATL falls fast, CTL slow → TSB goes positive → label moves toward RACE-READY/DETRAINING, not OVERREACH. Behaves correctly.

### 🔵 TSB labels are absolute, but the scale is volume-dependent — `training-form.ts:200-203, 239-245`
Raw EWMA is tiny (CTL ~3-6 for a 30-50 mpw runner); the code multiplies by `SCALE = 10` for display, then applies fixed labels (`>25 DETRAINING / >10 RACE-READY / >-10 PRODUCTIVE / >-30 LOADED / ≤-30 OVERREACH`). Because the magnitude tracks weekly mileage, the same *relative* overreach produces a **smaller absolute TSB for a low-volume runner**. A beginner doing a genuinely reckless 15→25 mpw jump may show LOADED while a higher-volume runner doing a safer ramp shows OVERREACH. Injury risk is actually carried by ACWR (which *is* relative and *is* used in readiness/health-actions), so this is a labeling nuance, not a safety hole — but the OVERREACH label means less for beginners than its wording implies.

### ⚠️ MAX-per-day dedup undercounts doubles — `training-form.ts:143-151`
`MAX((data->>'distanceMi'))` per day collapses two runs on the same day into the larger one (a deliberate workaround for duplicate source rows). A runner who does AM+PM doubles has the smaller run dropped → CTL/ATL understate true load → the system could green-light quality when the runner is actually loaded. Fine for single-session runners; under-protective for double-day runners. Also pairs `MAX(distance)` with `MAX(avgHr)` independently, which can fuse fields from different source rows.

### ⚠️ Stale header comment — `training-form.ts:34-39`
Header band table says LOADED `-20..-10` / OVERREACH `<-20`; the actual `labelForTsb` uses `-30`. Code is internally consistent (health-actions also fires at -30); only the header is wrong.

---

## 3. PLAN GENERATION — `generate.ts`, `spec-builder.ts`

### ✅ Daniels pace tables implemented correctly — verified numerically
For VDOT 47.9 the app produces (via `tPaceFromVdot` + `spec-builder` offsets) vs canonical Daniels (audit-supplied E 8:12 / M 7:31 / T 7:17 / I 6:47):

| Pace | App | Canonical | Δ (s/mi) | Direction |
|---|---|---|---|---|
| Easy (lo) | 8:30 | 8:12 | **+18** | slower = safe |
| Tempo (T+12) | 7:22 | T 7:17 | +5 | ~correct |
| Interval (T−18) | 6:52 | I 6:47 | +5 | slower = safe (documented) |
| Marathon (T+18) | 7:28 | M 7:31 | −3 | negligible |
| T-anchor | 7:10 | 7:17 | **−7** | faster = mildly hot |

Spot-checked VDOT 35/42/55/60 — same shape, all within band. **The pace structure is correct and the deviations are almost entirely in the safe (slower) direction.**

### 🔵 The T-anchor is ~7 s/mi fast — `vdot.ts:108-116`
`tPaceFromVdot` derives T as `HM-pace − 5`. But for these VDOTs **HM race pace ≈ true T pace** (within 2 s); subtracting 5 pushes the anchor ~7 s/mi fast, so threshold *reps* (which use the anchor directly, `spec-builder.ts:272`) run slightly hot. 7 s/mi on threshold is within day-to-day noise — minor, but it's a systematic error in the aggressive direction. The cleaner mapping is T ≈ HM-pace (drop the −5) or anchor T off the 60-min-race velocity.

### ✅ Volume ramp is safe — `generate.ts:481-577`
- Per-week growth capped at **10%/wk** (`climbFactor = min(1.10, idealFactor)`, line 529). This is the key safety mechanism and it is correct.
- Deload every 4th non-taper week to 85% (every 3rd if TSB < −10). Correct periodization.
- Floors by level (beginner 10 / int 15 / adv 20 / adv+ 25 mpw) prevent a meaningless sub-floor plan.

### ⚠️ The floor can exceed the 10% rule in week 1 for sub-floor runners — `generate.ts:498, 451-456`
`start = max(floor, baseMi)`. A beginner actually running 5 mpw is started at the **10 mpw floor — a 100% week-1 jump**. Worse for returns-from-layoff: an `advanced_plus` runner currently at 15 mpw is started at **25 mpw (+67%)**. Absolute volumes are low so injury risk is modest, but the floor overrides the runner's real base and breaks the very 10% rule the file cites. Connects to edge case **H** (missed 2 weeks). Consider capping week 1 at `baseMi × 1.5` (or similar) when `baseMi < floor`.

### ✅ Taper structure is distance-correct — `generate.ts:370-374, 559`
`BLOCK_SHAPE`: 5K taper 1 wk, 10K 2 wk, HM 2 wk, M 3 wk. Taper factors 0.82 / 0.60 / 0.45 of peak land inside the `Research/08 §9.2` bands (80-90 → 60-70 → 40-50%). Marathon gets the longest taper, 5K the shortest. Correct.

### ✅ Block composition scales with distance and runway — `generate.ts:377-435`
`sizeBlocks` allocates base/quality/race-specific/taper by distance category and total weeks, with race-specific capped per distance. Different races produce structurally different plans, not the same template with new numbers.

### 🚨 Cold-start / no-VDOT pace anchoring is unguarded — `generate.ts:1124-1136` *(highest-severity finding)*
```ts
const goalT = tPaceFromGoal(input.goalSec, input.raceDistanceMi) ?? input.tPaceSec;
const currentT = tPaceFromVdot(input.bestRecentVdot);   // null when no race AND no quality run
function tPaceForWeek(weekIdx, phase) {
  if (goalT == null) return null;
  if (currentT == null || currentT <= goalT) return goalT;   // ← anchors EVERYTHING to the goal
  ...blend currentT → goalT...
}
```
The Rule-3 blend (anchor early weeks to *current* fitness, ramp toward goal) only works when `currentT` exists. When it's null — **brand-new user, or any runner with no race and no qualifying quality run in 180 days (e.g. a casual jogger with no watch)** — every pace anchors to `goalT`, and `goalT` is derived from the runner's *entered goal* with **no realism check** (`goal-gap.ts` computes a gap but never clamps the prescribed pace). Concretely, a 28-min-5K runner who enters a sub-20 goal gets:
- "Easy" prescribed at **8:02–8:42/mi** (their real easy is ~11:00) → every easy run becomes a max effort,
- Intervals at **~6:24/mi**, a pace they cannot physically hold.

This is the one place the engine can prescribe an injury. It is *honest* (it never fabricates a VDOT number) but the paces are unsafe. Fix: derive a conservative current VDOT at onboarding (recent run pace, or a self-reported recent effort) and floor the anchor; and/or gate goal realism (reject/soften a goal more than ~1 VDOT-implied tier above any evidence).

### ⚠️ No VDOT < 30 floor — `vdot.ts:61`, `generate.ts:1125-1128`
`vdotFromRace` returns null below 30, so a true sub-30 beginner is indistinguishable from "no data" and falls into the goal-anchored path above. No special-case conservative handling. Same fix as the cold-start item.

### ✅ Quality-rep lengths are sane — `spec-builder.ts:284-285`
Default VO2/interval rep = 0.62 mi (~1000 m), the canonical Daniels I-rep (≤5 min for trained runners); threshold rep = 1.0 mi. Within doctrine. *(At very slow paces a 1000 m rep exceeds 5 min, but slow beginners are prescribed tempo/threshold, not true VO2 intervals, so this rarely bites.)*

### ⚠️ No explicit hard-day spacing guard — `generate.ts:703, 850, 1159`
Quality days come from runner prefs (default `tue/thu`, well-spaced; long on `sat/sun`). I found no validator preventing adverse configs (quality the day before the long run, or adjacent quality days). Defaults are safe; user-chosen bad spacing appears ungated. The audit asks for back-to-back-quality flagging — it isn't present.

---

## 4. VDOT SYSTEM — `vdot.ts`

### ✅ The Daniels-Gilbert formula is exactly correct — verified numerically — `vdot.ts:31-39`
```
VO2  = -4.6 + 0.182258·v + 0.000104·v²        (v = m/min)
%max = 0.8 + 0.1894393·e^(-0.012778·t) + 0.2989558·e^(-0.1932605·t)   (t = min)
VDOT = VO2 / %max
```
These are the canonical Daniels-Gilbert constants. Round-trip test against known table anchors:

| Input | Returns | Expected |
|---|---|---|
| 5K 19:57 | 49.95 | 50 ✅ |
| 10K 41:21 | 49.97 | 50 ✅ |
| HM 1:31:35 | 49.96 | 50 ✅ |
| M 3:10:49 | 49.95 | 50 ✅ |
| 5K 30:40 | 30.02 | 30 ✅ |

All distances handled correctly (mile→marathon). The `predictRaceTime` binary-search inversion is monotone and converges. ✅

### ⚠️ Known polynomial divergence at the elite extreme — `vdot.ts`
5K 14:42 returns **71.25** where the table says 70 (~1.8% high). This is the documented Daniels-Gilbert artifact above ~VDOT 70 and the [30,85] clamp keeps it bounded, but an elite's projected paces will read marginally fast. Acceptable; worth a comment.

### ⚠️ VDOT = MAX over 180 days of races **and training runs**, with no decay or outlier rejection — `vdot.ts:245-301`, called at `generate.ts:1871`
`bestRecentVdot` is invoked with `runCandidates`, takes the single highest value across 180 days, and applies only a −1 tie-break penalty to runs. The quality gate (`≥4 mi` AND quality-typed-or-HR≥80%max) is reasonable, but:
- **No GPS-distance sanity check.** A watch that records 4.0 mi as 3.6 mi inflates pace ~10% → a meaningful VDOT bump that then governs prescribed paces for 6 months.
- **No decay / recency weighting.** One peak (or one downhill tempo) sets fitness for 180 days even as the runner detrains.
- The audit asks specifically "is there protection against a single outlier run inflating VDOT?" — the gate limits *gross* outliers, but a single fast-reading qualifying run is taken at face value as the max. Consider a small smoothing (e.g. 2nd-best, or a recency half-life) and a pace-plausibility bound.

### ✅ Cold-start VDOT is honest (no fabrication), but see §3 for the consequence
A user with no race/quality run gets `bestRecentVdot = undefined` — the system never invents a fitness number. Good. The problem isn't a fabricated VDOT; it's that the *absence* routes into goal-anchored paces (§3 🚨).

---

## 5. HEAT / CONDITIONS — `race-conditions.ts`, `heat-adjustment.ts`

### ✅ Maughan/Ely table is an exact port of the cited research — `heat-adjustment.ts:32-41` vs `Research/06-weather-adjustments.md:39-49`
The marathon-slowdown-% table by air temp × ability tier matches the research line-for-line (70°F → elite 1.5 / mid 4.0 / slow 6.0; 80°F → 3.5 / 7.5 / 11.5). ✅

### ✅ Fitness and distance scaling are correct per the research
- **Faster runners slow less:** elite < mid < slow at every temperature — matches Ely et al. (slower runners accumulate more heat load). ✅
- **Distance scaling** (`heat-adjustment.ts:50-56`): ultra 1.5× / marathon 1.0× / half 0.5× / 10K 0.3× / 5K 0.2×. Physiologically sound (cumulative heat load scales with duration); the half/short factors are heuristic and acknowledged as such.

### ✅ Cold handled honestly
Below 50°F the model returns 0 adjustment (no fake speed-up), and `race-conditions.ts:151` clamps the penalty at ≥0. A 35°F race correctly reads "neutral." No cold *penalty* is modeled (<40°F effects are small and the research is thin) — acceptable.

### ⚠️ No heat-*safety* messaging at dangerous temperatures — `race-conditions.ts:160-187`, `heat-adjustment.ts:21`
At "extreme" the copy is purely about pace: *"extreme heat. Maughan adds about Xs · race-day reality check, not a stall."* Above ~85°F (and especially with humidity, which **isn't modeled at all** — `heat-adjustment.ts:21` defers dewpoint/WBGT) the coaching priority shifts from *time* to *heat illness*: hydration, electrolytes, earlier start, and a willingness to abandon the time goal. The file notes "race-day bail triggers" live in legacy and "will port when needed" — for AFC (San Diego, August) and for any runner in a heatwave (edge case **J**), that's needed now. A pace delta is not a safety warning.

### ⚠️ Extrapolation flat above 90°F — `heat-adjustment.ts:72`
`interpolatePct` returns the 90°F value for anything ≥90°F, so 95°F and 100°F read identical to 90°F. Combined with the missing humidity term, the model *understates* danger exactly where danger is highest.

---

## 6. COACH VOICE — `voice-band.ts`, `checkin-reply-canned.ts`, `readiness-brief.ts`, `run-recap.ts`, `run-win.ts`

### ✅ Consistently safe and well-gated — no "push through" reaches a runner
A full read of the voice surfaces plus a codebase grep for risky patterns (`push through`, `fight through`, `ignore`, `run faster`, `grind it out`, `power through`, `send it`, …) found **zero unsafe runner-facing strings**.

- **The only assertive line, "Send it"** (`readiness-brief.ts:640-641`), fires *only* on SHARP band + a quality/long day. `voice-band.ts:234-243` soft-caps the band at `guided` whenever there's an active niggle, active illness, ≥5-day subjective/objective disagreement, or goal ≥14 days off projection — so a sick, injured, or fatigued runner can **never** see "Send it." ✅
- **Hard rules are unconditional** (`health-actions.ts:280-327`): active illness → "Skip running · easy walk only"; niggle flare → "Skip until it clears · don't run through a flare"; wrist temp +0.4°C → illness watch; ACWR ≥ 2.0 → trim; 7-day pull-back → take 2-3 easy days. These fire for every tier, including elites. ✅
- **Post-run recap is heat-aware and honest** (`run-recap.ts`): when heat explains a slow tempo it names the heat ("go by effort") instead of blaming the runner; win lines only fire on genuine positive verdicts and return null for "off plan / struggled / DNF." No fabricated wins. ✅

### 🔵 Voice band carries no explicit race-recency filter
Post-race suppression is delegated to the plan adapter and to TSB/readiness being low after a race (they will be). In practice a runner who raced yesterday won't be SHARP, so "Send it" won't fire — but the protection is *emergent*, not asserted. Low risk; worth an explicit race-recency cap for robustness, consistent with the CLAUDE.md "per-finding context filters" doctrine.

### ✅ Beginner vs competitive tone is handled — `tier-rules.ts:81-126`
`tone: prescriptive` (beginner/intermediate) gives "Tomorrow easy · let HRV recover"; `informational` (advanced) gives "HRV down 5 days · pattern worth noting"; `red-flag-only` (advanced_plus) surfaces only hard rules. Appropriate across the population.

---

## 7. WORKOUT PRESCRIPTION — `spec-builder.ts`, `build-workout.ts`

### ✅ HR caps are safe and research-grounded — `spec-builder.ts:84-91`
Easy/long cap = `max(0.89×LTHR, 0.78×maxHR)` = top of Friel Z2 / top of Daniels E (verified vs `Research/03-heart-rate-zones.md:212-222`). The 2026-06-03 fix that raised the easy cap from `0.80×LTHR` (recovery zone, far too tight — tripped every honest easy run "off plan") to `0.89×LTHR` is correct. Tempo HR = 0.92×LTHR (mid Z3). All universal math, no per-user carve-outs. ✅

### ✅ Pace targets derive correctly from VDOT — see §3/§4 (within 5-18 s/mi of Daniels, safe direction).

### ✅ Easy is genuinely easy — `spec-builder.ts:174`
Easy band T+80..+120 runs *slower* than Daniels E (+18..+58 s/mi). Combined with the Z2 HR cap, this is conversational. The conservative-slow easy is the correct call (most runners run easy too fast).

### ⚠️ Fallback HR targets when LTHR is absent
When `lthr` is null, `hr_cap_bpm`/`lthr_bpm`/`hr_target_bpm` are emitted as **null** rather than a maxHR-derived or %-of-estimated-max fallback (`spec-builder.ts:192, 254, 275`). The runner then has a *pace* target but no HR ceiling — for a beginner without a lab LTHR, the easy run loses its primary "keep it easy" guardrail. The `hrCapEasy` function already accepts `maxHr` and will use `0.78×maxHR` *if maxHr is threaded*, but several call sites pass only `lthr`. Thread `maxHr` (or an age-estimated max) everywhere so the HR guardrail survives a missing LTHR.

### ⚠️ Overtraining prevention is indirect
Back-to-back quality is prevented by *default* day spacing, not by an explicit guard (§3). The strongest overtraining brakes are the readiness/ACWR/TSB layer (which downgrades or shaves the plan) — those are good — but the *generator* itself doesn't assert hard-day separation.

---

## 8. EDGE CASES

| # | Scenario | What the app does | Verdict |
|---|---|---|---|
| **A** | New user, no data, no race | `readiness → UNKNOWN` (engine) but **HealthView renders red PULL-BACK** (§1); no VDOT fabricated; seed = 8 mpw maintenance plan (`seed-from-onboarding.ts:84,413`) | ⚠️ display dishonest; plan safe |
| **B** | No run logged in 30 days | CTL decays, ATL→0, TSB positive → DETRAINING/RACE-READY (not OVERREACH); ACWR detraining nudge "add a few easy miles" | ✅ correct & safe |
| **C** | Just raced | `recovery-phase.ts` tracks biometric recovery (DOMS 24-48h, baseline-excluding window); TSB negative → "two easy days"; **no auto recovery-week inserted** (plan ends at race) | ✅ tracked; ⚠️ no prescribed post-race block |
| **D** | Logged a niggle | Hard rule: flare → "skip until it clears"; moderate → "easy only until it settles"; voice band soft-capped | ✅ safe |
| **E** | VDOT < 30 (beginner) | `vdotFromRace` → null → goal-anchored paces, no floor (§3 🚨) | 🚨 unsafe paces possible |
| **F** | VDOT > 65 (elite) | Formula slightly high (~1.8% at 70, §4); `red-flag-only` tier; hard rules still apply | ✅ acceptable |
| **G** | 1 day before race | Race week → deep taper + `race_week_tuneup` (2×0.5 mi @ T−5); race-day pace ≈ T (HM) | ✅ correct |
| **H** | Missed 2 weeks | Re-gen starts at `max(floor, baseMi)` → can jump +67% to tier floor (§3 ⚠️) | ⚠️ floor over-rides depressed base |
| **I** | Tapering, TSB → + | Taper factors 0.82/0.60/0.45; TSB rising → RACE-READY; "you're sharp, don't add volume" | ✅ correct |
| **J** | Heatwave (>90°F) | Pace penalty computed (flat ≥90°F, no humidity); **no heat-illness safety copy** (§5 ⚠️) | ⚠️ predicts time, not danger |

The standouts are **A** (dishonest cold-start display), **E** (unsafe beginner paces), and **J** (no heat-safety messaging). **B, D, G, I** are handled the way a coach would want.

---

## 9. RESEARCH CITATIONS

Verified each cited constant against the actual `Research/` / `BuildResearch/` source:

| Constant | Code | Research source | Status |
|---|---|---|---|
| Gabbett ACWR 0.8 / 1.3 / 1.5 | `readiness.ts:153-167` | `Research/15:213-220` | ✅ exact (research itself flags ACWR is contested — code uses it as a modifier, not a hard stop) |
| Maughan heat table | `heat-adjustment.ts:32-41` | `Research/06:39-49` | ✅ exact |
| Daniels pace offsets | `spec-builder.ts:172-183` | `Research/01:140-146,265-274` | ✅ within bounds |
| Friel HR zones (0.89 / 0.92 / 0.78) | `spec-builder.ts:84-91,254` | `Research/03:212-222` | ✅ doctrinal |
| Plews HRV CV > 7% | `health-actions.ts:454` | `Research/15:102,551` | ✅ conservative (research clear-signal is 10-14%) |
| Coggan TSB −30, CTL 42d / ATL 7d | `training-form.ts:239-245` | `Research/15:434-456` | ✅ exact |
| Wrist temp +0.4 / +0.2 / +0.3°C | `tier-rules.ts:76,88-89` | `Research/15:535` | ✅ (watch bands more conservative) |
| **Readiness weights / bands (§8.3)** | `readiness.ts:7-16` | `BuildResearch/D1:107-116` | 🚨 **MISMATCH** — code HRV 28% vs research 40%; custom bands (see §1 🔵) |

**Two citation-hygiene items the code itself flags:**
- `generate.ts:448` — `Research/22 §minimum-base-by-level` cited but the heading "no matching anchor" (TODO in code).
- `generate.ts:472,477` — section renamed; comment notes the drift.

**Net:** citations are unusually honest and overwhelmingly accurate — every safety-critical constant traces to a real source with the right number. The one substantive mismatch (readiness §8.3) is a documented design divergence, not a fabricated citation. No "wrong citation creating false confidence" cases found.

---

## 10. BOTTOM LINE — would a runner get hurt, and what would a certified coach say?

**Could any advice get a runner injured?** One path: **§3 🚨 cold-start goal-anchored paces.** A beginner with an optimistic goal and no fitness history is prescribed easy and interval paces they cannot safely run. Everywhere else the engine fails safe — recovery prescriptions are conservative, volume is 10%-capped, HR caps are honest, and the voice never says "push through."

**Anything demonstrably wrong (vs imprecise)?**
- The **HealthView cold-start band** (§1) is demonstrably dishonest — it shows red PULL-BACK on zero data while the engine correctly computed UNKNOWN.
- The **T-anchor is ~7 s/mi fast** (§3) — small and verifiable.
- The **readiness weights don't match the cited §8.3 doctrine** (§9) — verifiable mismatch.
Nothing else rises to "wrong"; the rest is correct or conservatively imprecise.

**The three fixes before AFC** (restated): (1) floor cold-start paces to a conservative current-fitness estimate + guard goal realism; (2) add the `unknown` band branch in HealthView; (3) add heat-*safety* messaging (and humidity) above the danger threshold.

**What a USATF/RRCA coach would say:**
> "The methodology is legitimate — real Daniels VDOT, real Banister/Coggan load, real Maughan heat, honest Friel HR caps, and a recovery layer that errs toward rest. I'd trust this to coach a runner who already trains with a watch and a sane goal. My objections are all about the runner who *doesn't*: don't hand a beginner goal-pace intervals they can't run, don't show a confident readiness score on no data, and when it's 90°F tell them about heat illness, not just their finish time. Fix those three and this is a system I'd put my name on."

For **David** — real data, sane goal, 68 days out — the system already coaches him correctly. The work above is what makes it correct for *everyone else*.

---

*Read-only audit. No code, data, or schema was modified. Numerical verification of VDOT, pace tables, and heat scaling performed in an isolated Python session against the formulas as written in the source.*
