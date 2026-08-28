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
import { classifyGoalTier, TIER_TARGETS, distanceCategoryOf } from './goal-tiers';
import { ULTRA_UNSUPPORTED_REASON } from './supported-distances';
import { predictRaceTime } from '@/lib/training/vdot';

// The archetype corpus lives in `./sim-matrix` (extracted 2026-08-28) so the
// dosing gate (`_dosing_sweep_gate.test.ts`) can drive the IDENTICAL matrix
// without importing this test file. Add arcs THERE; every gate sweeps them.
import { matrix, isUltra, arcStr, type Arc } from './sim-matrix';

const catOfMi = (mi: number) => distanceCategoryOf(mi);

const FIRM: Record<string, number> = {};
const WARN: Record<string, number> = {};
const examples: Record<string, string> = {};
const firm = (k: string, a: Arc) => { FIRM[k] = (FIRM[k] || 0) + 1; if (!examples[k]) examples[k] = arcStr(a); };
const warn = (k: string, a: Arc) => { WARN[k] = (WARN[k] || 0) + 1; if (!examples[k]) examples[k] = arcStr(a); };

function grade(a: Arc) {
  const built = buildSimPlan({
    ...a, startDateISO: '2026-07-06', raceDateISO: a.raceDateISO ?? '', lastRaceFinishedDaysAgo: 0, lastRaceDistance: null,
    raceHistory: [], longRunDay: 'sun', availableDays: a.availableDays ?? [],
  } as any);
  // ULTRA-OUT-1 (2026-08-19) · ultra archetypes are graded on the REFUSAL, not on
  // the plan. The owner removed ultra authorship ("lets remove ultra plans and
  // training for now"), so for these the only correct outcome is a clean, honest
  // decline carrying the runner-facing reason. They stay in the matrix precisely
  // so this stays asserted: a sweep that simply dropped 50K and 100K would go
  // quiet the moment authorship re-opened by accident.
  //
  // `justRun` is deliberately NOT in scope. That archetype has no target at
  // all — the engine plans a generic consistency block off the half-marathon
  // reference, and the '50k' on the arc is a label the sweep carries, not an
  // event anyone is training for. Refusing it would deny a plan to a runner
  // who never asked for an ultra one.
  if (isUltra(a.distance) && a.goalMode !== 'justRun') {
    if (built.ok) firm(`ULTRA_AUTHORED ${a.distance}`, a);
    else if (built.reason !== ULTRA_UNSUPPORTED_REASON) {
      firm(`ULTRA_WRONG_REFUSAL: ${String(built.reason).slice(0, 40)}`, a);
    }
    return;
  }
  // And the invariant behind that check, asserted for EVERY archetype rather
  // than only the ones the matrix labels ultra: whatever the engine decided to
  // plan for, it is never an ultra distance.
  if (built.ok && catOfMi(built.raceDistanceMi) === 'ultra') {
    firm(`ULTRA_AUTHORED_VIA ${a.goalMode}/${a.distance}`, a); return;
  }
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
  // COLD-1 · grade against the SAME evidence the engine saw. `bestRecentVdotOverride` is
  // the only measured-fitness signal in the matrix; without it a NULL-level archetype is
  // capped at intermediate, which is exactly the rung this sweep was blind to.
  const demonstratedPaceSec = built.derived.bestRecentVdot != null
    ? (() => { const t = predictRaceTime(built.derived.bestRecentVdot, built.raceDistanceMi); return t != null ? Math.round(t / built.raceDistanceMi) : null; })()
    : null;
  const tier = classifyGoalTier(a.goalTimeSec ? Math.round(a.goalTimeSec / built.raceDistanceMi) : null, built.raceDistanceMi, a.experienceLevel as any, demonstratedPaceSec);
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
    // SIM-COH-1 exemption: skip underreach checks when the archetype's inputs are inherently
    // inconsistent (weekly mileage × frequency implies an average run longer than the longest-run
    // bucket allows). These archetypes represent impossible self-reports; the engine now caps the
    // long at the bucket ceiling (correct), so the plan legitimately underreaches — that's expected
    // behaviour, not a defect. Consistent inputs still trigger underreach as before.
    const BUCKET_CEIL: Record<string, number> = { '0-3': 3, '3-6': 6, '6-10': 10, '10+': 999 };
    // SIM-COH-2 (2026-08-19) · the implied average run is over the days the
    // runner can ACTUALLY run, which is their stated frequency capped by their
    // available days — not the stated frequency alone.
    //
    // The `availableDays` archetypes are where this bit. `f5` with only Sat and
    // Sun available is a TWO-day plan; measuring its 30 mi/wk self-report over
    // five days implies a 6-mile average and looks consistent, while over the
    // two days it can be run it implies FIFTEEN miles a run and busts the very
    // '6-10' longest-run bucket the archetype also claims. That is precisely
    // the impossible self-report SIM-COH-1 was written to exempt; it was just
    // measuring against the wrong denominator to see it.
    const schedulableDays = Math.min(a.weeklyFrequency || 7, a.availableDays?.length || 7);
    const impliedAvgRun = recentWeekly / Math.max(1, schedulableDays);
    const inputsConsistent = impliedAvgRun <= (BUCKET_CEIL[a.longestRunBucket] ?? 999);
    if (inputsConsistent) {
      // The long run is a per-SESSION quantity · a plan running fewer days does
      // not get a smaller long run, so this band is compared as published.
      if (recentLong >= band.peakLongMiBand[0] && peakLong < band.peakLongMiBand[0] * 0.75) warn(`LONG_UNDERREACH ${cat}/${tier}`, a);

      /* WK-FREQ-1 (2026-08-19) · WEEKLY VOLUME IS A PER-WEEK QUANTITY, SO THE
       * BAND ONLY MEANS ANYTHING ALONGSIDE THE DAY COUNT IT WAS PUBLISHED FOR.
       *
       * Research/22 never states a peak weekly volume on its own. Every plan
       * table prints `| Days/week |` directly above `| Peak weekly volume |`:
       * 5K-Advanced is "40-70 mi" at "6-7" days, 10K-Intermediate "30-40 mi" at
       * "5". `TIER_TARGETS[cat][tier].daysPerWeek` is the engine's read of that
       * row, and generate.ts overrides it with the runner's own stated
       * frequency — deliberately, because a 3-day runner gets a 3-day plan.
       *
       * Grading that 3-day plan against a 5-day plan's weekly total asks the
       * engine to deliver five days of volume in three sessions. It cannot,
       * and it should not want to: `peakLongMiBand` caps the long run and
       * `longRunShare` caps what fraction of the week it may be, both of them
       * doctrine-gated. The engine already sits at the TOP of the long-run
       * band in every one of the archetypes this used to flag — a 5K-Advanced
       * 3-day peak week is `long 12 + intervals 7 + easy 10`, with the 12 the
       * ceiling of the published `[8, 12]`. Reaching the unscaled floor would
       * take two more runs of eleven-plus miles each, i.e. three long runs a
       * week for a 5K goal. The plan is right; the expectation was wrong.
       *
       * So the floor is scaled by the days the plan actually runs against the
       * days the band's plan runs, capped at 1 so a plan running MORE days than
       * doctrine's is never given a discount. The precondition scales too,
       * which makes the check apply to strictly MORE archetypes than before,
       * not fewer — a low-frequency runner is now graded rather than skipped. */
      const peakWeek = train.find((w: any) => w.weeklyMi === peakWk);
      const peakWeekRunDays = peakWeek
        ? peakWeek.days.filter((d: any) => d.distanceMi > 0).length
        : band.daysPerWeek;
      const dayScale = Math.min(1, peakWeekRunDays / Math.max(1, band.daysPerWeek));
      const wkFloor = band.peakWeeklyMileageBand[0] * dayScale;
      if (recentWeekly >= wkFloor && peakWk < wkFloor * 0.75) warn(`WK_UNDERREACH ${cat}/${tier}`, a);
    }
    if (a.goalTimeSec && peakLong === 0) warn('NO_LONG', a);
  }
}

describe('ALL-USER conformance sweep', () => {
  // Composing 9294 plans takes ~2s alone and several times that when the whole
  // suite is running in parallel around it, against vitest's 5s default. A gate
  // that goes red because the machine was busy teaches people to re-run it
  // until it passes, which is how a real regression gets waved through. The
  // timeout is generous on purpose; nothing about the assertions changes.
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
  }, 60_000);
});
