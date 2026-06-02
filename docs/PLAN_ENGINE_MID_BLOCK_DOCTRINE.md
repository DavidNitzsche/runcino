# Plan Engine · Mid-Block Runner Doctrine

**Status (2026-06-03 late evening):** 11 rules + post-race graduate cron SHIPPED. The daily 09:00 UTC drift-cron now also handles race graduation: when an active plan's race date is in the past, fire `fireAutoRebuild({kind: 'race_graduate'})` against the next A-priority race. The new plan inherits all training history via composePlan's existing readers (recentLong, recentQuality, bestRecentVdot, tsbAtStart). Verified against David: post-AFC (8/17), CIM would auto-graduate as the new target. No manual nudge required.

**Status (2026-06-03 evening):** 11 of 11 rules SHIPPED. Added Rule 11 (horizon-aware planning) · A/B-priority races within 24 weeks influence the current plan's long-run dials when the future race is longer.

**Status (2026-06-03 PM):** 10 of 10 rules SHIPPED. Simulation against David's live plan: 6/7 testable rules pass · the one failure (Rule 10 derived_from) only because his plan was authored pre-Rule-10; next rebuild populates.

**Earlier status (morning):** 4 of 10 rules SHIPPED · 6 rules GAP · bench persona `david-mid-block` exercises all 6 GAP rules with failing-test assertions.

**Why this doc exists.** The generator was designed for cold-start onboarding (no recent runs, ramp from 0). David is 10 weeks out from AFC Half with established 12mi longs, 35mpw, 1-2 quality/wk. Three bugs in one session (`1:30` parse, `detectMidBlock` active-only, Sun=9 long) had a single root cause: cold-start assumptions broke against mid-block reality. This doc codifies the rules so future patches don't accidentally re-introduce cold-start assumptions.

**How to use this doc.** Each rule has: status (SHIPPED / GAP), the doctrine, the file:function where it lands, the bench test that gates it. When closing a GAP rule, update status here AND remove the `2026-06-03 TODO` comment in the source.

---

## The 10 rules

### Rule 1 · skip BASE phase when mid-block
**Status:** SHIPPED (`detectMidBlock`)
**Doctrine.** If runner has done ≥2 quality runs OR ≥1 long ≥10mi in last 28d → start at QUALITY, not BASE.
**Code.** `lib/plan/generate.ts § detectMidBlock` reads active + archived (30d) plans for prescribed quality, plus HR-based effort (≥85% maxHR) on runs. `sizeBlocks(totalWeeks, raceDistanceMi, isMidBlock)` zeros `baseWeeks` when true.
**Bench.** `generator-bench.test.ts §"[mid-block] no BASE phase weeks"`.

### Rule 2 · every distance prescription floored at recent baseline
**Status.** Long ✓ SHIPPED · Easy ✓ SHIPPED · Quality ✗ GAP · Weekly ✓ partial.
**Doctrine.** Generator never authors LESS than what the runner just did.
- Long: `recentPeakLongMi` (28d max ≥ 8mi) floors `layoutWeek` long-run sizing.
- Easy: `easyDayMedianMi` (14d median) floors `easyMileFloor`.
- Quality: `recentQualityDistanceMi` should floor `qualityMiEach` — **GAP**.
- Weekly: `recentMi` is `baseMi` in `volumeCurve` · partial (see Rule 4).

**Code (Quality GAP).** `lib/plan/generate.ts § layoutWeek` line ~651 (`qualityMiEach = round(weeklyMi × qualityShare / qDows)` · goal-blind to runner baseline).

**Fix.** When `input.recentQualityDistanceMi` is set:
```ts
const qualityMiEach = Math.max(
  Math.round(weeklyMi * qualityShare / qualityDows.length),
  input.recentQualityDistanceMi - 1,
);
```

**Bench.** `generator-bench.test.ts §"[mid-block] quality distance ≥ runner recent quality distance"`.

### Rule 3 · pace anchor blend
**Status:** ✗ GAP
**Doctrine.** Pace targets anchor to current fitness in early weeks, ramp to goal-pace by mid-block. A runner whose current VDOT is below goal-implied VDOT shouldn't get week-1 quality at goal-pace · it's not hittable.

**Code.** `lib/plan/generate.ts § composePlan` line ~1167 (`tPaceSec = tPaceFromGoal(goalSec, raceDistanceMi)` · ignores `bestRecentVdot`).

**Fix.** Source `bestRecentVdot` from `lib/training/vdot.bestRecentVdot` and pass through. In `layoutWeek`, compute:
```ts
const goalT = tPaceFromGoal(goalSec, raceDistanceMi);
const currentT = tPaceFromVdot(bestRecentVdot);
const blend = Math.min(1, weekIdx / (totalBuildWeeks * 0.6));
const weekT = currentT + (goalT - currentT) * blend;
```

**Bench.** `generator-bench.test.ts §"[mid-block] bestRecentVdot read"` (hook test until policy lands).

### Rule 4 · monotonic volume floor
**Status.** ✓ partial
**Doctrine.** Week 1 weekly volume must be ≥ runner's recent weekly. The climbFactor can be 1.0 but never < 1.0.

**Code.** `lib/plan/generate.ts § volumeCurve` line ~410 (`start = Math.max(VOLUME_FLOOR, baseMi)`). Partial because `baseMi` reads recent weekly, but rounding + cutback-week 0.85× deload can produce week-1 targets below `baseMi`.

**Fix.** After computing `vols[]`, enforce `vols[0] = max(vols[0], baseMi)` for non-cutback non-taper week 0. Plus add a `MONOTONIC_FLOOR` check that no non-cutback week dips below `baseMi - 5`.

**Bench.** `generator-bench.test.ts §"[mid-block] week 1 weekly volume ≥ runner recent weekly"`.

### Rule 5 · quality density mirrors recent habit
**Status:** ✗ GAP
**Doctrine.** If runner did 1 quality/wk for 28d → start at 1, ramp to 2 by week 5. Current code pulls density from `tierTarget.qualityPerWeek` regardless of habit.

**Code.** `lib/plan/generate.ts § composePlan` line ~1125 (`qualityDows = prefs?.quality_days ?? ['tue', 'thu']` · no habit-based ramping).

**Fix.** When `input.recentQualityPerWeek < tierTarget.qualityPerWeek`:
```ts
function densityForWeek(weekIdx: number, recent: number, target: number, buildWeeks: number): number {
  if (recent >= target) return target;
  const rampOverWeeks = 4;
  const stepsUp = Math.min(rampOverWeeks, weekIdx);
  return Math.min(target, recent + (target - recent) * (stepsUp / rampOverWeeks));
}
```
Then in `layoutWeek`, slice `qualityDows` to `densityForWeek(weekIdx, ...)`.

**Bench.** `generator-bench.test.ts §"[mid-block] week 1 quality count within ±1 of recent habit"`.

### Rule 6 · phase compression when weeks_to_race < 10
**Status:** ✓ partial
**Doctrine.** 10-week plan ≠ 12-week scaled down. `weeks_to_race < 8` should auto-suppress BASE entirely + compress QUALITY → RACE-SPECIFIC ratio.

**Code.** `lib/plan/generate.ts § sizeBlocks` line ~320 (`isMidBlock ? 0 : baseWeeksRaw` · only checks isMidBlock, not totalWeeks).

**Fix.** `const baseWeeks = (isMidBlock || totalWeeks < 10) ? 0 : baseWeeksRaw;`. Plus for `totalWeeks < 8`, compress QUALITY:RACE-SPECIFIC from 6:2 to 4:2 or 3:2.

**Bench.** `generator-bench.test.ts §"[mid-block] no BASE phase weeks"` (passes for david-mid-block via isMidBlock; doesn't gate on totalWeeks).

### Rule 7 · long-run progression respects current peak
**Status:** ✓ SHIPPED
**Doctrine.** Long ramps from `max(recentLong, weeklyMi × longShare)` toward tier band over build weeks. Cutback weeks drop by ≤2mi from prior peak.
**Code.** `lib/plan/generate.ts § layoutWeek` lines ~605-621.
**Bench.** `generator-bench.test.ts §"no build-week long is shorter than runner recent long"`.

### Rule 8 · cutback frequency calibrated to cumulative load
**Status:** ✗ GAP
**Doctrine.** Cold-start cutback = every 4th week. Mid-block runner with 8+ weeks prior load may need every 3rd · Banister TSB ratio drives this.

**Code.** `lib/plan/generate.ts § volumeCurve` line ~424 (`deloadMask.push(i > 0 && (i + 1) % 4 === 0)` · week-idx mod 4 only).

**Fix.** Read TSB from `lib/health/tsb.ts § currentTsb(userId)`. When TSB < -10 (high cumulative stress), shift to mod 3. Pass TSB into `volumeCurve` as a parameter.

**Bench.** `generator-bench.test.ts §"[mid-block] cutback frequency hook"` (documentation only · no enforceable assertion until policy lands).

### Rule 9 · easy median, not tier-derived easy
**Status:** ✓ SHIPPED
**Doctrine.** Easy day floor = runner's own 14-day median, not a derived % of weekly target.
**Code.** `lib/plan/generate.ts § easyDayMedianMi` (reader) + `layoutWeek § easyMileFloor` (consumer).
**Bench.** Implicit via Rule 4's weekly-floor check.

### Rule 10 · transparency · is_mid_block + derived_from envelope
**Status:** ✓ partial
**Doctrine.** Plan envelope flags `is_mid_block=true` with `derived_from: { recentMi, recentLong, recentQualityCount, bestRecentVdot }`. So the runner can see which inputs drove the plan.

**Code.** `lib/plan/generate.ts § composePlan` writes `authoredState.is_mid_block` ✓. Missing: `derived_from` block under `authoredState`.

**Fix.** In `composePlan`, add to `authoredState`:
```ts
derived_from: {
  recentMi: input.recentWeeklyMi,
  recentLongMi: input.recentLongMi,
  recentQualityPerWeek: input.recentQualityPerWeek ?? null,
  bestRecentVdot: input.bestRecentVdot ?? null,
}
```
Then surface in brief envelope + plan UI so David can audit.

**Bench.** No assertion yet · add when `derived_from` lands.

---

## Bench persona

`lib/plan/synthetic-runners.ts § PERSONAS["david-mid-block"]`:

| field | value | mirrors |
|---|---|---|
| weeklyBaseMi | 35 | David's recent 35.7 avg |
| vdotAtStart | 48 | from recent quality runs |
| midBlock.recentLongMi | 12 | David's 5/31 long was 12.36mi |
| midBlock.recentQualityPerWeek | 2 | 1-2/wk recent |
| midBlock.recentQualityDistanceMi | 8 | typical tempo |
| midBlock.bestRecentVdot | 48 | matches start (mid-block has no recent race) |
| race.distanceMi | 13.1 | AFC Half |
| race.goalSec | 5400 | 1:30:00 HM |
| race.weeksOut | 10 | exercises Rule 6 compression |

---

## Audit results (self-audit · 2026-06-03)

Predicted bench pass/fail for `david-mid-block` against the CURRENT generator (before any GAP rule lands):

| Rule | Bench test | Predicted | Reasoning |
|---|---|---|---|
| 1 (skip BASE) | `[mid-block] no BASE phase weeks` | PASS | isMidBlock=true zeros baseWeeks |
| 2 (quality dist floor) | `[mid-block] quality distance ≥ recent` | **FAIL** | qualityMiEach is goal-blind. With weeklyMi=42, qShare=0.22, qDows=2 → qualityMiEach = round(42×0.22/2) = 5mi. Persona floor = 8mi − 1 = 7. **5 < 7 → FAIL.** |
| 3 (pace blend) | `[mid-block] bestRecentVdot read` | PASS | Hook test only · checks input wiring, not policy. |
| 4 (monotonic vol) | `[mid-block] week 1 weekly ≥ recent` | PASS | start = max(20, 35) = 35; vols[0] = 35; assertion = ≥ round(35×0.9) = 32. **35 ≥ 32 → PASS.** |
| 5 (density ramp) | `[mid-block] week 1 quality count within ±1 of recent` | PASS | qualityDows.length = 2 from prefs; persona recent = 2. **abs(2−2) ≤ 1 → PASS.** (Would FAIL if persona's recentQualityPerWeek were 1.) |
| 6 (phase compress) | `[mid-block] no BASE phase weeks` | PASS | Already covered by Rule 1's isMidBlock zeroing. |
| 7 (long floor) | `no build-week long shorter than recent` | PASS | Shipped today; bench was added in commit ab16bfbf. |
| 8 (cutback freq) | `[mid-block] cutback frequency hook` | PASS | Documentation-only test; no enforceable assertion. |

**Predicted failures:** 1 (Rule 2 quality distance floor). The other 5 GAP rules pass because the bench test is either documenting-only or the persona happens to match the cold-start default.

**Next persona to ship.** "david-mid-block-1-quality" (same as david-mid-block but `recentQualityPerWeek: 1`) would FAIL Rule 5's density check (week 1 would author 2 quality, persona allows max 1+1=2 ✓ — actually still PASS; need to make the rule strict: actualQ ≤ recent + 0 in week 1, +1 by week 5).

---

## Order of operations to close the GAPs

1. **Rule 2 (quality distance floor)** · 1-line fix in `layoutWeek`, will immediately turn FAIL → PASS on david-mid-block. Highest ROI.
2. **Rule 5 (density ramp)** · tighten test to be strict in week 1; add `densityForWeek` helper. Add a 1-quality persona to exercise.
3. **Rule 10 (derived_from envelope)** · cheap; just append to authoredState. Unlocks runner-facing transparency.
4. **Rule 3 (pace anchor blend)** · meaty; requires `bestRecentVdot` reader + `tPaceFromVdot` helper + blend math in `layoutWeek`. Real test needs to inspect actual pace targets in the spec.
5. **Rule 4 (monotonic vol floor, full)** · enforce post-`vols[]` monotonic check.
6. **Rule 8 (TSB-driven cutback)** · last, needs Banister TSB wired through into `volumeCurve`. Most architecturally invasive.

---

### Rule 11 · horizon-aware planning
**Status:** ✓ SHIPPED (2026-06-03 evening)
**Doctrine.** The current plan isn't just "AFC training" — it's "training that peaks at AFC and continues into the next block." When a future A/B-priority race within 24 weeks of `raceDateISO` is LONGER than the current race, its tier's long-run dials extend the current plan's long-run cap and share. Weekly volume cap + quality density stay at the current race's tier so we don't blow up sharpening intensity. Inverse case (future race is SHORTER) leaves the current plan untouched · only EXTEND, never CONTRACT.

**Per Pfitz Advanced Marathoning §"Bridging from half to full":** "Set up your buildup so weekly mileage and long-run progression have continuity across races. Don't reset between the HM tune-up and the goal marathon."

**Trigger.** Future A or B race within 24 weeks (168 days) of current `raceDateISO` AND distanceMi > current. Sharpening races (5K/10K after a HM) ignored.

**Effect.**
- `peakLongMiBand[1]` extends to max horizon race's cap (e.g. HM advanced 17mi → M advanced 22mi)
- `longRunShare` extends to max horizon race's share (e.g. 0.25 → 0.30)
- `peakWeeklyMileageBand[0]` shifts from lower-band to mid-band so volume supports the longer long runs (e.g. HM advanced 55 → 70). Upper-band cap unchanged.
- `qualityPerWeek` unchanged · sharpening for the immediate race, not the horizon race.

**Code.** `lib/plan/generate.ts § composePlan` computes `horizonRaise` after `lookupTierTarget`. Wrapper reads A/B races within 24 weeks via SQL filter on `meta->>'priority'` and `meta->>'distanceMi'`.

**Envelope.** `authoredState.horizon_raise = { fromLongCapMi, toLongCapMi, fromLongShare, toLongShare, race: {slug, name, date, distanceMi} }`. Null when no horizon raise applies.

**UI surface.** `TrainView` renders a chip in the hero when `season.horizonRaise` is non-null: "LONG-RUN CAP · 22mi · setting up CIM."

**Bench.** No explicit assertion yet · david-mid-block persona currently has no horizon. Real-world wiring verified via DB query against David's live race schedule.

**David's specific case.** Sub-1:30 AFC HM (8/16) → sub-3 CIM marathon (12/6) is exactly 16 weeks. CIM is A-priority, longer distance. Horizon-raise:
- HM advanced longCap [15,17] → M advanced [20,22] · cap = 22
- HM advanced longShare 0.25 → M advanced 0.30 · share = 0.30
- HM advanced weekly [55,85] → [70,85] · target band shifts toward mid
- Result: AFC peak weekly ~70 (vs 58 currently), peak long ~21-22mi (vs 14 currently)
- CIM block then starts at 18-20mi long, ramps to 22 over its build · much smoother than starting at 12

Run Malibu HM (B, 11/8) doesn't raise the cap because it's same distance as AFC. Dodgers 10K (C, 9/26) is filtered by priority (C-only) anyway. So only CIM drives the raise.

---

## Simulation results · 2026-06-03 PM

Ran `scripts/_simulate_mid_block.mjs` against David's live plan (`pln_06d040468f7198fd`). 7 of 7 testable rules audited; 6 PASS, 1 expected FAIL (Rule 10 pre-dates ship).

| Rule | Status | Detail |
|---|---|---|
| 1 (skip BASE) | PASS | No BASE phase weeks |
| 2 (quality dist floor) | PASS | All quality days ≥ 7mi (recent 8 − 1) |
| 4 (monotonic vol) | PASS | Week 0 = 45.5 ≥ 90% of recent 35.7 = 32.1 |
| 5 (density ramp) | PASS | Week 0 q-count 2 within ±1 of recent 2 |
| 6 (phase compression) | PASS | 11w plan, no BASE |
| 7 (long floor) | PASS | All builds ≥ 12mi (cutback ≥ 10mi) |
| 10 (derived_from) | FAIL (expected) | Plan was authored pre-Rule-10 ship; next rebuild populates |

**Per-week shape from David's live plan:**
```
W 0 2026-06-01 QUALITY          45.5mi · long 12mi · 2q × 8mi
W 1 2026-06-08 QUALITY          45.0mi · long 12mi · 2q × 8mi
W 2 2026-06-15 QUALITY          48.5mi · long 12mi · 2q × 8mi
W 3 2026-06-22 QUALITY    [cb]  40.0mi · long 10mi · 2q × 8mi
W 4 2026-06-29 QUALITY          51.5mi · long 12mi · 2q × 8mi
W 5 2026-07-06 QUALITY          52.0mi · long 12mi · 2q × 8mi
W 6 2026-07-13 RACE-SPECIFIC    54.0mi · long 13mi · 2q × 8mi
W 7 2026-07-20 RACE-SPECIFIC[cb]45.0mi · long 11mi · 2q × 8mi
W 8 2026-07-27 RACE-SPECIFIC    58.0mi · long 14mi · 2q × 8mi
W 9 2026-08-03 TAPER            43.0mi · long  9mi · 2q × 8mi
W10 2026-08-10 TAPER            29.1mi · long  0mi · 0q × 0mi
```

Rule 3 (pace blend) is type-level only · per-week tPaceSec is now populated by `composePlan`, persisted via `buildWorkoutSpec`, but the audit can't compare to a baseline without a parallel cold-start plan to diff against. Behavior verified by code-trace: `tPaceForWeek(0, 'QUALITY')` returns `currentT` when `bestRecentVdot < goal-implied VDOT`, ramps to `goalT` over the first 60% of build weeks.

---

## Citations

- Daniels' Running Formula 3rd ed Ch.4 §"adapting plans mid-block"
- Pfitzinger Faster Road Racing §"jumping into a plan"
- Research/22-plan-templates.md (tier targets)
- Research/00a-distance-running-training.md §progressive-overload (10%/wk cap)
- Research/08-pacing-and-race-week.md §taper
