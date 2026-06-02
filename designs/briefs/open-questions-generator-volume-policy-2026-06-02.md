# Open question · plan generator volume + long-run policy

**Filed:** backend agent · 2026-06-02
**Severity:** High · the generator produces plans that don't match
the runner's goal-pace tier. For 1:30 HM specifically, peak long
runs land at 13mi (should be 14-17mi per Daniels / Pfitzinger HM
canon). For lower goals the math may be too aggressive.
**Owner:** backend agent (plan generator)
**Source:** David flagged 2026-06-02 · "we can't be hardcoding stuff
if it wasn't right from the beginning."

---

## The bug

David's plan for AFC Half (1:30 goal · 8/16) has:
- Peak weekly: 46.5 mi/wk (decent for 1:30)
- Peak long: 13 mi (low · should be 14-17)
- Volume oscillates 40-46 instead of building 36→50
- No clean "build" curve

Standard 1:30 HM block (Daniels A-plan or Pfitzinger Faster Road
Racing 12wk for sub-1:30):
- Peak: 45-55 mi/wk
- Long peak: 14-16 mi · with 8-10 mi at HM pace
- Clear progression: baseline → +30% → cutback → +30% over 8-10 weeks

Our generator delivers the volume but not the progression or the
long-run depth.

---

## Root cause · two interacting policies

### 1. `easyMileFloor` overrides the ramp

`generate.ts:575` ·
```ts
const perEasy = Math.max(effectiveFloor, perEasyRaw);
```

When the runner's recent easy median is 6 mi and the ramp math says
3.9 mi/easy, the floor wins. Total volume becomes:

```
weekly = long + quality + (easyMileFloor × 4 days)
       = 12 + 8 + (6 × 4)
       = 44 mi
```

The volume-curve ramp (line 325 · `weekVol *= 1.07`) is silently
discarded · weekly stays flat at ~44 because the easyFloor dominates
in every week.

**Why this was added** · doctrine note line 553-560: "the
volume_drift cron only fires at >40% deviation · this floor catches
the silent 20-30% gap." Worked when MAX-per-day was undercounting
(reading 32.6 when actual was 35.7). Now that smart-dedup fixed the
read (commit `45428cf7`), the floor's reason-to-exist is half gone.

**Better policy** · floor the WEEKLY target (not per-easy), then let
share math fill in. If runner's history says they do 6mi easies,
that's a signal their weekly target should be `easyFloor × 4 + long
+ quality`, not the raw historical avg. Then ramp THAT target.

### 2. `longShare = 0.34` is goal-blind

`generate.ts:476` ·
```ts
const longShare = phase === 'BASE' ? 0.30
                : phase === 'TAPER' ? 0.28
                : 0.34;
```

Long = 34% of weekly across all RACE-SPECIFIC and QUALITY phases.
For a 1:30 HM runner doing 50 mi/wk peak, that's a 17mi long peak.
For a 1:45 HM runner doing 35 mi/wk peak, that's a 12mi long peak.

The current weekly never hits 50 (the easyFloor cap), so the long
never hits 17.

**Better policy** · long-run-target scales with GOAL-PACE TIER,
not just current weekly. A 1:30 HM runner should aim for a 15mi
peak long REGARDLESS of recent baseline · that's the standard
threshold to run a sub-1:30. Goal-driven, not history-driven.

### 3. Race-pace label was "MP" for all races

`generate.ts:486` · `LONG · ${Math.round(longMi * 0.4)}mi @ MP`
fixed today (`<this commit>`) · the label varies by race distance
now: HM → "HM", M → "MP", 5K/10K → no MP insert.

---

## Proposed fix · goal-tiered policy

### Step 1 · GoalTier from goal pace

```ts
type GoalTier = 'elite' | 'advanced' | 'intermediate' | 'developing';

function tierFromGoalPace(secPerMi: number, raceDistMi: number): GoalTier {
  if (raceDistMi >= 12 && raceDistMi <= 14) {
    // Half marathon tiers
    if (secPerMi <= 360) return 'elite';        // sub-1:18 (5:30 pace)
    if (secPerMi <= 420) return 'advanced';     // sub-1:30 (6:25-6:52)
    if (secPerMi <= 480) return 'intermediate'; // sub-1:45 (~8:00)
    return 'developing';                        // 2:00+ HM
  }
  // ... similar for 5K, 10K, Marathon
}
```

David's plan would resolve to `advanced` (6:52 pace = sub-1:30).

### Step 2 · Tier-driven targets

```ts
const TIER_TARGETS = {
  half_advanced: { peakWeeklyMi: 50, peakLongMi: 16, hmPaceInsertMaxMi: 10 },
  half_intermediate: { peakWeeklyMi: 38, peakLongMi: 13, hmPaceInsertMaxMi: 6 },
  // ...
};
```

Targets come from doctrine (Research/22-plan-templates.md), not
from the runner's recent average. Recent average sets the STARTING
point of the ramp; the tier target sets the PEAK.

### Step 3 · Ramp baseline → tier target

```ts
const weeks = totalWeeks - taperWeeks;
const start = Math.max(easyMileFloor * 4 + 10, recentWeeklyMi);
const peak = TIER_TARGETS[tier].peakWeeklyMi;
const weeklyRamp = Math.pow(peak / start, 1 / (weeks - 1));  // geometric
// e.g. 35.7 → 50 over 8 weeks · 4.3%/wk · safer than 7%/wk
```

Easy floor still applies but doesn't dominate · the share math grows
each week.

### Step 4 · Long ramps to tier peak

Already works if shares are honest · long = weeklyMi × longShare,
and weeklyMi now actually grows.

---

## Estimated work

- ~150 LOC change in `lib/plan/generate.ts`
- New `TIER_TARGETS` table sourced from Research/22
- Backfill cron to re-author existing plans against new policy
- Synthetic-runner test (lib/faff/personas.ts) coverage for each tier

Estimate · 4-6 hours of focused work for a complete pass. Worth
running plans through `lib/plan/simulator.ts` after the change to
confirm projection trajectories are correct.

---

## Why not fix now

I started touching `generate.ts` for the MP→HM label (small, safe).
Adding goal-tier policy in the same session would mix a contained
fix with an architectural redesign · higher risk of breaking the
generator's existing personas (advanced_plus, beginner, etc.).

Better to:
1. Land MP→HM today
2. File this brief
3. Set aside dedicated time for the tier redesign · with bench
   tests to confirm each tier produces a sane plan

---

## Related

- `web-v2/lib/plan/generate.ts:325-355` · `volumeCurve` (the ramp
  that gets silently overridden)
- `web-v2/lib/plan/generate.ts:474-490` · `layoutWeek` long-run
  policy
- `web-v2/lib/plan/generate.ts:555-583` · `easyMileFloor` defense
  that breaks the ramp
- `web-v2/lib/plan/simulator.ts` · the bench-test harness for
  verifying generator output
- `web-v2/lib/faff/personas.ts` · synthetic-runner fixtures · need
  a `david_1_30_hm` persona for the tier test
- `Research/22-plan-templates.md` · canonical doctrine for tier
  targets (peak weekly, peak long, HM-pace inserts)
