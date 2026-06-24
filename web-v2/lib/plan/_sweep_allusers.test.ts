/**
 * EXHAUSTIVE all-user conformance sweep (2026-06-23).
 *
 * Generates a plan for every meaningful user archetype across the full onboarding input matrix
 * and grades each against the research answer key (TIER_TARGETS bands + validateComposedPlan +
 * structural/pace/ramp invariants). Every failure is a bug. The bar: ZERO firm failures, every
 * archetype, no exceptions — then this becomes a permanent CI gate.
 *
 * Run: ./node_modules/.bin/vitest run lib/plan/_sweep_allusers.test.ts --disable-console-intercept 2>&1 | tail -60
 */
import { describe, it, expect } from 'vitest';
import { buildSimPlan } from './sim-inputs';
import { validateComposedPlan, PlanValidationError } from './validate';
import { classifyGoalTier, TIER_TARGETS, distanceCategoryOf, BUILD_WINDOW_WEEKS } from './goal-tiers';
import { recentWeeklyMiFromBucket, recentLongMiFromBucket, SIM_DISTANCE_MI, type SimDistance } from './sim-constants';

const DISTANCES: SimDistance[] = ['5k', '10k', 'half', 'marathon', '50k', '100k'];
const EXPERIENCE = ['beginner', 'intermediate', 'advanced', 'advanced_plus'];
const FREQ = [3, 4, 5, 6];
// CC2-2 (2026-06-23) · bucket 0 = true-zero base. The refuse-vs-plan boundary (where BRK-2/CC2-1 live)
// was untested — lowest fed was recentWeeklyMiFromBucket(5)=10. Split-graded in grade().
const MILEAGE = [0, 5, 15, 25, 35, 45];
const LONGEST = ['0-3', '3-6', '6-10', '10+'];
// representative goal times that, with the experience clamp, exercise tiers
const GOAL_SEC: Record<SimDistance, number> = { '5k': 1350, '10k': 2700, half: 6300, marathon: 13500, '50k': 18000, '100k': 43200 };
const catOf: Record<SimDistance, '5k' | '10k' | 'hm' | 'm' | 'ultra'> = { '5k': '5k', '10k': '10k', half: 'hm', marathon: 'm', '50k': 'ultra', '100k': 'ultra' };
const WEEKS: Record<SimDistance, number> = { '5k': 10, '10k': 12, half: 14, marathon: 18, '50k': 22, '100k': 24 };

type Arc = { goalMode: 'goal' | 'justRun' | 'race'; distance: SimDistance; experienceLevel: string; weeklyFrequency: number; weeklyMileageBucket: number; longestRunBucket: string; goalTimeSec: number | null; planWeeks: number; raceDateISO?: string; availableDays?: string[]; bestRecentVdotOverride?: number };

function* matrix(): Generator<Arc> {
  for (const distance of DISTANCES)
    for (const experienceLevel of EXPERIENCE)
      for (const weeklyFrequency of FREQ)
        for (const weeklyMileageBucket of MILEAGE)
          for (const longestRunBucket of LONGEST) {
            const common = { distance, experienceLevel, weeklyFrequency, weeklyMileageBucket, longestRunBucket };
            // goal mode (race-prep) — with a goal time and by-feel
            for (const goal of [GOAL_SEC[distance], null])
              yield { ...common, goalMode: 'goal', goalTimeSec: goal, planWeeks: WEEKS[distance] };
            // just-run (maintenance / consistency block)
            yield { ...common, goalMode: 'justRun', goalTimeSec: null, planWeeks: 0 };
            // far-out race (≥26 weeks → maintenance until the build window opens)
            yield { ...common, goalMode: 'race', goalTimeSec: GOAL_SEC[distance], planWeeks: 0, raceDateISO: '2027-03-01' };
          }
  // GOAL-1 · available_days geometry (the scheduler↔validator dead-end that left a saved goal with
  // NO plan). Purely geometric, so a reduced cross over distance × constraining set × freq suffices:
  // adjacent pairs (NOQ-mode fold), tight pairs (GAP-mode downgrade), weekday-only, full-week.
  const AVAIL_SETS = [['sat', 'sun'], ['mon', 'fri'], ['sun', 'fri'], ['tue', 'thu', 'sat'], ['mon', 'tue', 'wed', 'thu', 'fri']];
  for (const distance of DISTANCES)
    for (const availableDays of AVAIL_SETS)
      for (const weeklyFrequency of [3, 5])
        yield { goalMode: 'goal', distance, experienceLevel: 'intermediate', weeklyFrequency, weeklyMileageBucket: 25, longestRunBucket: '6-10', goalTimeSec: GOAL_SEC[distance], planWeeks: WEEKS[distance], availableDays };
  // CC-5 · elite-tier coverage — the 5 elite (cat,tier) rows are otherwise never instantiated (a single
  // moderate GOAL_SEC + by-feel only reaches intermediate/advanced). Elite goal × advanced experience
  // (so the clamp doesn't fight) × high mileage so the band is reachable.
  const ELITE_GOAL: Record<SimDistance, number> = { '5k': 1000, '10k': 2050, half: 4650, marathon: 9300, '50k': 16200, '100k': 39000 };
  for (const distance of DISTANCES)
    yield { goalMode: 'goal', distance, experienceLevel: 'advanced', weeklyFrequency: 6, weeklyMileageBucket: 45, longestRunBucket: '10+', goalTimeSec: ELITE_GOAL[distance], planWeeks: WEEKS[distance] };
  // CC-4 · PR-seeded pace path (bestRecentVdotOverride) — the matrix otherwise always passes the empty
  // raceHistory, so the fitness-anchored pace path ships ungraded. A slow + a fast fitness signal: a
  // fast PR on a low base must not push peak above the safe ramp, and paces must stay sane.
  for (const distance of DISTANCES)
    for (const bestRecentVdotOverride of [38, 55])
      yield { goalMode: 'goal', distance, experienceLevel: 'intermediate', weeklyFrequency: 5, weeklyMileageBucket: 25, longestRunBucket: '6-10', goalTimeSec: GOAL_SEC[distance], planWeeks: WEEKS[distance], bestRecentVdotOverride };
}

const FIRM: Record<string, number> = {};
const WARN: Record<string, number> = {};
const examples: Record<string, string> = {};
const firm = (k: string, a: Arc) => { FIRM[k] = (FIRM[k] || 0) + 1; if (!examples[k]) examples[k] = arcStr(a); };
const warn = (k: string, a: Arc) => { WARN[k] = (WARN[k] || 0) + 1; if (!examples[k]) examples[k] = arcStr(a); };
const arcStr = (a: Arc) => `${a.distance}/${a.experienceLevel}/f${a.weeklyFrequency}/m${a.weeklyMileageBucket}/L${a.longestRunBucket}/${a.goalTimeSec ? 'goal' : 'byfeel'}`;

function grade(a: Arc) {
  const built = buildSimPlan({
    ...a, startDateISO: '2026-07-06', raceDateISO: a.raceDateISO ?? '', lastRaceFinishedDaysAgo: 0, lastRaceDistance: null,
    raceHistory: [], longRunDay: 'sun', availableDays: a.availableDays ?? [],
  } as any);
  if (!built.ok) {
    // CC2-2 · a true-zero base (bucket 0) legitimately REFUSES an aggressive or long goal (couch→marathon
    // in 18wk isn't safe) — a clean friendly refusal there is correct, not a failure. But a short BY-FEEL
    // runner must still get a gentle plan (this is what BRK-2/CC2-1 guarantee), and any non-zero base must
    // always plan.
    const zeroBase = a.weeklyMileageBucket === 0;
    const shortByFeel = (a.distance === '5k' || a.distance === '10k' || a.distance === 'half') && a.goalTimeSec == null;
    if (zeroBase && !shortByFeel) return; // graceful refusal is the correct outcome
    firm(`GEN_FAIL: ${built.reason}`.slice(0, 60), a); return;
  }

  // Grade BOTH connection states a new runner can be in: a COLD-START signup (no Strava → prod sets
  // trailingAvgWeeklyMi null, the peak-vs-trailing ramp check is skipped) AND a STRAVA-CONNECTED
  // runner (trailingAvg = their recent volume → the ramp check applies). Both must produce a valid
  // plan — a low-base runner who connects Strava must not be DENIED a plan.
  const recentWk = built.derived.recentWeeklyMi;
  for (const [conn, trailing] of [['cold', null], ['strava', recentWk > 0 ? recentWk : null]] as [string, number | null][]) {
    const ctx = { ...built.validateCtx, trailingAvgWeeklyMi: trailing };
    try { validateComposedPlan(built.composed, built.raceDistanceMi, built.mode, ctx); }
    catch (e) { if (e instanceof PlanValidationError) for (const v of e.violations) firm(`VALIDATOR[${conn}]: ${v.replace(/Week \S+/, 'Week X').replace(/\d+(\.\d+)?mi/g, 'Nmi').slice(0, 64)}`, a); else throw e; }
  }

  const cat = distanceCategoryOf(built.raceDistanceMi); // engine's actual distance (justRun → hm reference)
  const tier = classifyGoalTier(a.goalTimeSec ? Math.round(a.goalTimeSec / built.raceDistanceMi) : null, built.raceDistanceMi, a.experienceLevel as any);
  const band = TIER_TARGETS[cat][tier];
  const recentLong = built.derived.recentLongMi;       // ENGINE-derived (post coherence-clamp)
  const recentWeekly = built.derived.recentWeeklyMi;

  const weeks = built.composed.weeks;
  const train = weeks.filter((w: any) => !w.isRaceWeek);
  const peakWk = Math.max(0, ...train.map((w: any) => w.weeklyMi));
  const longs = weeks.flatMap((w: any) => w.days.filter((d: any) => d.isLong && d.type !== 'race').map((d: any) => d.distanceMi));
  const peakLong = Math.max(0, ...longs);

  // ── FIRM research-conformance ── (band overshoot is a RACE-PREP concept; maintenance/recovery
  // hold a base-proportional long, not a band-bound one — SP-6, validated separately)
  if (built.mode === 'race-prep' && peakLong > band.peakLongMiBand[1] + 3) firm(`LONG_OVERSHOOT ${cat}/${tier} peak>${band.peakLongMiBand[1]}+3`, a);
  // overshoot only if the peak exceeds BOTH the band ceiling AND a safe ramp from the reported
  // base — a runner who genuinely reports 45mpw legitimately builds to ~base×1.15 even if their
  // experience tier's band is lower (respecting the base is correct, not over-building).
  if (peakWk > band.peakWeeklyMileageBand[1] * 1.25 && peakWk > recentWeekly * 1.20) firm(`WK_OVERSHOOT ${cat}/${tier} peak>band×1.25 & base×1.20`, a);
  for (const w of weeks) {
    if (w.isRaceWeek) continue;
    const realized = w.days.filter((d: any) => d.type !== 'race').reduce((s: number, d: any) => s + d.distanceMi, 0);
    if (Math.abs(realized - w.weeklyMi) > 0.3) { firm('WEEKLY_NEQ_REALIZED', a); break; }
  }
  for (const w of weeks) {
    if (w.isRaceWeek || w.phase === 'TAPER') continue;
    if (w.days.every((d: any) => d.type === 'rest' || d.distanceMi === 0)) { firm(`EMPTY_WEEK ${w.phase}`, a); break; }
  }
  for (const w of weeks) {
    if (w.tPaceSec != null && (w.tPaceSec < 200 || w.tPaceSec > 1000)) { firm(`PACE_INSANE ${w.tPaceSec}`, a); break; }
  }
  // ramp: week-0 long must be ≤110% of recent (+1mi rounding) when recent is meaningful
  if (recentLong >= 6 && longs.length && longs[0] > recentLong * 1.10 + 1.0) firm('RAMP_HOT_WK1', a);

  // ── WARN (band-reaching, race-prep only — maintenance/recovery hold BELOW the band by design) ──
  if (built.mode === 'race-prep') {
    if (recentLong >= band.peakLongMiBand[0] && peakLong < band.peakLongMiBand[0] * 0.75) warn(`LONG_UNDERREACH ${cat}/${tier}`, a);
    if (recentWeekly >= band.peakWeeklyMileageBand[0] && peakWk < band.peakWeeklyMileageBand[0] * 0.75) warn(`WK_UNDERREACH ${cat}/${tier}`, a);
    if (a.goalTimeSec && peakLong === 0) warn('NO_LONG', a);
  }
}

describe('ALL-USER conformance sweep', () => {
  it('every archetype is research-conformant', () => {
    let n = 0;
    for (const a of matrix()) { grade(a); n++; }
    const firmTotal = Object.values(FIRM).reduce((s, v) => s + v, 0);
    const warnTotal = Object.values(WARN).reduce((s, v) => s + v, 0);
    console.log(`\n=== SWEPT ${n} archetypes ===`);
    console.log(`FIRM failures: ${firmTotal} across ${Object.keys(FIRM).length} types`);
    for (const [k, v] of Object.entries(FIRM).sort((a, b) => b[1] - a[1])) console.log(`  [${v}] ${k}  e.g. ${examples[k]}`);
    console.log(`WARN: ${warnTotal} across ${Object.keys(WARN).length} types`);
    for (const [k, v] of Object.entries(WARN).sort((a, b) => b[1] - a[1])) console.log(`  [${v}] ${k}  e.g. ${examples[k]}`);
    // THE GATE · every archetype must be research-conformant. If this fails, an engine change
    // regressed some user segment — read the FIRM list above for the exact archetypes + violations.
    expect(firmTotal, `${firmTotal} firm conformance failures across the user matrix — see log`).toBe(0);
  });
});
