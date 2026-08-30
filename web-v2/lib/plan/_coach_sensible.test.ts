/**
 * COACH-SENSIBLE GATE (2026-08-30) · is this week one a coach would hand over?
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * The plan apparatus is large and it was all green on the night it authored a
 * marathon build that opened with three-mile easy days for a runner whose own
 * fourteen-day easy median is four miles and whose third-highest week in the
 * look-back is 44.9. `_sweep_allusers` graded 11,598 archetypes, `_maint_
 * invariants` graded placement and junk-run allocation, `_dosing_sweep_gate`
 * graded weekly dosing, and ~298 doctrine claims graded the constants. Not one
 * of them looked at the plan and asked whether a coach would sign it.
 *
 * The reason is structural, and it is worth stating plainly because it is the
 * whole finding. `sim-matrix.ts`'s `Arc` type carries no `dailyMiMostRecentFirst`,
 * no `easyDayMedianMi`, no `recentQualityPerWeek` and no `isMidBlock`. So for
 * every archetype in the corpus `hist` is null, which means:
 *
 *   · `resolveRampBase` is never called          → `lifted` is never exercised
 *   · `rampBaseEvidence` is null                 → `baseRebuilt` short-circuits true
 *   · `easyDayMedianMi` is 0                     → the easy-day floor never binds
 *   · `recentQualityPerWeek` is undefined        → the density ramp never fires
 *
 * Four doctrine mechanisms, dark across the entire corpus. The sweep is a gate
 * over runners who cannot have a past. Every defect that lives in how the
 * engine reads a runner's history was therefore invisible to it by construction,
 * and no amount of adding archetypes to that matrix would have helped.
 *
 * ── WHAT THIS FILE ASSERTS ──────────────────────────────────────────────────
 *
 * Four properties, each measured against a runner WITH a history. The fixture
 * is the owner's real logged mileage (read from prod on 2026-08-30, RO creds,
 * 112 days ending 2026-08-30) because a gate written against invented numbers
 * would have been just as blind as the one it replaces.
 *
 *   1. EASY-RUN DURATION · an easy day is long enough, at the runner's own easy
 *      pace, to be the run `Research/00a` describes.
 *   2. DEMONSTRATED EASY · the engine's own `easyMileFloor` actually binds.
 *   3. RESUME LADDER     · a return to volume takes the three weeks `Research/22`
 *      gives it, not eight.
 *   4. CONTINUITY        · walking a runner across a doctrine threshold in small
 *      steps moves the plan in small steps. No phase appears or disappears on a
 *      third of a mile, and more training never buys a smaller week one.
 *
 * (4) is the one that matters most and the one whose absence let an infinitely
 * sharp cliff survive 11,598 archetypes. Every other gate here samples the
 * output space at points; only this one samples the DERIVATIVE.
 *
 * ── THIS GATE IS RED ON PURPOSE ─────────────────────────────────────────────
 *
 * It is red today, against the plan the engine authors for the owner tonight.
 * That is the gate working. Per CLAUDE.md Rule 7: a claim that reveals a real
 * violation is never loosened to get green — the engine is fixed, or the
 * violation is carried as an honest, named exemption. Nothing here is exempted,
 * because all four failures are live defects with owners.
 *
 * It deliberately does NOT sit in `prebuild` (that chain runs shell scripts and
 * `vitest run lib/doctrine` only), so a red here does not block a deploy. It
 * blocks `npm test`, which is where a human is looking.
 *
 * Run: ./node_modules/.bin/vitest run lib/plan/_coach_sensible.test.ts --disable-console-intercept
 */
import { describe, it, expect } from 'vitest';
import { buildSimPlan } from './sim-inputs';
import { resolveCitation, parseBand, sourceOf, matchLiteral } from '@/lib/doctrine/resolve';

// ── the fixture ─────────────────────────────────────────────────────────────
//
// The owner's real logged daily mileage, most-recent-first from 2026-08-30,
// 112 days (16 weeks · one full `RAMP_BASE_LOOKBACK_WEEKS` window). Pulled from
// prod with DATABASE_URL_RO, `runs` where NOT (data ? 'mergedIntoId').
//
// It is checked in rather than fetched because a gate that needs a database is
// a gate that gets skipped on the machine where it matters. What it must stay
// is REAL: these numbers produce mean28 = 31.5 against a rank-3 sustained week
// of 44.9, i.e. 70.16% — a tenth of a mile above `RAMP_BASE_RESUME_FRACTION`.
// That is not a contrived number. It is where a real marathoner actually sat on
// the night the engine authored his build, and it is why he is the right
// fixture for a gate about boundaries.
const OWNER_DAILY_MI: readonly number[] = [
  13.49, 0, 6.32, 3.14, 7.78, 0, 4.02, 11.01, 0, 9.14, 4.26, 0, 4.01, 0,
  13.2, 0, 0, 0, 0, 5.97, 4.02, 12.37, 0, 6.02, 4.86, 6.02, 4.77, 5.77,
  0, 4.16, 0, 0, 0, 0, 0, 0, 18, 0, 5.06, 7.21, 7.52, 9.69, 0, 0,
  7.9, 5.73, 9.01, 8.02, 9.09, 12.6, 0, 4.96, 5.86, 6.16, 7.56, 6.01, 0, 0,
  0, 0, 0, 0, 0, 0, 14.02, 0, 5.83, 0, 8.12, 0, 13.15, 0, 6.45, 8.15,
  6.03, 7.5, 6.01, 13.13, 0, 0, 6.9, 6.02, 8.02, 6.01, 12.55, 0, 6.01, 7.76,
  6.08, 7.41, 5.06, 12.36, 0, 7.71, 0, 5.86, 7.61, 6.16, 12.12, 0, 7.78, 7.17,
  5.08, 2.44, 5.95, 11.02, 0, 5.01, 11.22, 5.59, 4.71, 0,
];

/** The owner's own 14-day easy-day median, derived the way `easyDayMedianMi`
 *  derives it (3-9 mi runs, median, rounded to 0.5). Asserted below rather
 *  than hardcoded downstream, so a fixture edit cannot quietly move the bar. */
const OWNER_EASY_MEDIAN_MI = 4.0;

/** The owner's goal: CIM, 2026-12-06, sub-3. */
function buildOwnerBlock(daily: readonly number[] = OWNER_DAILY_MI) {
  return buildSimPlan({
    goalMode: 'race', distance: 'marathon', experienceLevel: 'advanced',
    weeklyFrequency: 6, weeklyMileageBucket: 45, longestRunBucket: '10+',
    longRunDay: 'sun', restDay: 'fri',
    startDateISO: '2026-08-30', raceDateISO: '2026-12-06',
    goalTimeSec: 10800, planWeeks: 0,
    lastRaceFinishedDaysAgo: 0, lastRaceDistance: null, raceHistory: [],
    availableDays: [], dailyMiMostRecentFirst: [...daily], isMidBlock: true,
  } as unknown as Parameters<typeof buildSimPlan>[0]);
}

// ── doctrine readers · every number below is parsed out of Research/ ────────
//
// Rule 7: "A check that hardcodes both sides only proves the test agrees with
// itself." So the minute bands, the resume sequence and the easy-band offset
// are all read at run time — from the docs for the first two, from the engine
// source for the third (it is module-local, so `sourceOf` is the honest
// binding; prefer exporting it and importing the symbol if that ever changes).

/** `Research/00a` §"1. Recovery run" · the shortest run doctrine still calls a
 *  session. Below this floor a prescription is not a training stimulus of any
 *  described kind — it is a number that fits a budget. */
function recoveryMinutesBand(): [number, number] {
  const c = resolveCitation('Research/00a-distance-running-training.md', '### 1. Recovery run');
  return parseBand(c.table().cell('Duration', 'Specification'));
}

/** `Research/00a` §"2. General aerobic (easy run)" · "staple of weekly volume",
 *  "bulk of weekly Z1". Its published floor is what a typical easy day owes. */
function generalAerobicMinutesBand(): [number, number] {
  const c = resolveCitation(
    'Research/00a-distance-running-training.md',
    '### 2. General aerobic (easy run)',
  );
  return parseBand(c.table().cell('Duration', 'Specification'));
}

/** `Research/22` §14 · "70% of pre-layoff volume for 1 wk, 85% for wk 2, full
 *  for wk 3". Parsed as a sequence of shares out of the doc's own cell. */
function resumeSharesFromDoctrine(): number[] {
  const c = resolveCitation('Research/22-plan-templates.md', '### Return from Short Layoff (1-2 weeks off)');
  const cell = c.table().cell('8-14 days', 'Restart approach');
  const pcts = [...cell.matchAll(/(\d+)%/g)].map((m) => Number(m[1]) / 100);
  const full = /\bfull\b/i.test(cell) ? [1.0] : [];
  const seq = [...pcts, ...full];
  if (seq.length < 3) {
    throw new Error(
      `COACH-SENSIBLE · could not read the resume sequence out of Research/22 §14.\n` +
      `  cell: ${cell}\n` +
      '  The passage was reworded. Re-read it and re-derive the ladder — do not hardcode it.',
    );
  }
  return seq;
}

/** How much slower than threshold the engine prices an easy mile. Module-local
 *  in generate.ts, so bound by text; the claim fails loudly if it is renamed. */
function easyBandOffsetSec(): number {
  const src = sourceOf('web-v2/lib/plan/generate.ts');
  const m = matchLiteral(
    src,
    /const EASY_BAND_SLOW_OFFSET_SEC\s*=\s*(\d+)\s*;/,
    'COACH-SENSIBLE · easy-pace offset',
  );
  return Number(m[1]);
}

/** Minutes a run of `mi` takes at the runner's own easy pace. */
const minutesAt = (mi: number, easySecPerMi: number) => (mi * easySecPerMi) / 60;

/** A week the runner is meant to be TRAINING in — not tapering, not deloading,
 *  not racing. Doctrine lets those step down (`Research/00a` §"Volume
 *  progression rules": "| Down weeks | Every 3-4 wk, reduce by 20-30% |"), so
 *  a short easy day inside one is a design, not a defect. Every other week is
 *  a week a coach is accountable for. */
const isTrainingWeek = (w: { isRaceWeek: boolean; isCutback?: boolean; phase: string }) =>
  !w.isRaceWeek && !w.isCutback && w.phase !== 'TAPER' && w.phase !== 'BASE';

const EASY_TYPES = new Set(['easy', 'recovery']);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

interface WeekLike { phase: string; weeklyMi: number; isRaceWeek: boolean; isCutback?: boolean; days: DayLike[] }
interface DayLike { type: string; distanceMi: number; isLong?: boolean }

describe('COACH-SENSIBLE · would a coach hand this week to this runner?', () => {
  it('the fixture is the runner it claims to be', () => {
    const built = buildOwnerBlock();
    expect(built.ok, `the owner fixture no longer composes: ${built.ok ? '' : built.reason}`).toBe(true);
    if (!built.ok) return;
    const ev = built.derived.rampBase;
    expect(ev, 'the fixture produced no ramp evidence — history is not reaching resolveRampBase').not.toBeNull();
    // The boundary this whole file is about. If a fixture edit moves the runner
    // off it, the continuity walk below is walking the wrong ground.
    const ratio = ev!.meanMi / ev!.sustainedMi;
    console.log(
      `\nFIXTURE · mean28=${ev!.meanMi} sustained(rank3)=${ev!.sustainedMi} ` +
      `ratio=${(ratio * 100).toFixed(2)}% lifted=${ev!.lifted} interruption=${ev!.interruptionWeeks} ` +
      `peak=${ev!.peakMi} easyMedian=${OWNER_EASY_MEDIAN_MI}mi tPace=${built.composed.tPaceSec}s/mi`,
    );
    expect(ratio).toBeGreaterThan(0.69);
    expect(ratio).toBeLessThan(0.72);
  });

  // ── 1 · EASY-RUN DURATION ─────────────────────────────────────────────────
  //
  // The complaint that started the audit, stated as a property instead of a
  // mileage. Distance is the wrong unit: two miles is a real run for a
  // twelve-minute-mile runner and a warm-up for this one. Doctrine states the
  // easy run in MINUTES, so the gate prices it in minutes, at the runner's own
  // easy pace — the same conversion `layoutWeek` already does for the long
  // run's absolute-time cap (DOCTRINE-3), so the two agree by construction.
  it('an easy day is long enough to be the run doctrine describes', () => {
    const built = buildOwnerBlock();
    if (!built.ok) throw new Error(built.reason);
    const [recoveryFloorMin] = recoveryMinutesBand();
    const [aerobicFloorMin] = generalAerobicMinutesBand();
    const easySec = (built.composed.tPaceSec ?? 0) + easyBandOffsetSec();
    expect(easySec, 'no composed T-pace — cannot price the runner\'s easy mile').toBeGreaterThan(0);

    const belowRecovery: string[] = [];
    const medianBelowAerobic: string[] = [];
    for (const w of built.composed.weeks as unknown as WeekLike[]) {
      if (!isTrainingWeek(w)) continue;
      const easies = w.days.filter((d) => EASY_TYPES.has(d.type) && d.distanceMi > 0).map((d) => d.distanceMi);
      if (easies.length === 0) continue;
      for (const mi of easies) {
        const min = minutesAt(mi, easySec);
        if (min < recoveryFloorMin) {
          belowRecovery.push(`${w.phase} wk=${w.weeklyMi} easy=${mi}mi = ${min.toFixed(0)}min < ${recoveryFloorMin}min`);
        }
      }
      const medMin = minutesAt(median(easies), easySec);
      if (medMin < aerobicFloorMin) {
        medianBelowAerobic.push(
          `${w.phase} wk=${w.weeklyMi} easies=[${easies.join(',')}] median=${median(easies)}mi = ${medMin.toFixed(0)}min < ${aerobicFloorMin}min`,
        );
      }
    }
    console.log(
      `\nEASY_DURATION · easy pace ${Math.floor(easySec / 60)}:${String(easySec % 60).padStart(2, '0')}/mi · ` +
      `recovery floor ${recoveryFloorMin}min (${(recoveryFloorMin * 60 / easySec).toFixed(1)}mi) · ` +
      `general-aerobic floor ${aerobicFloorMin}min (${(aerobicFloorMin * 60 / easySec).toFixed(1)}mi)`,
    );
    for (const s of medianBelowAerobic) console.log(`  MEDIAN_SHORT  ${s}`);
    for (const s of belowRecovery) console.log(`  BELOW_RECOVERY ${s}`);

    // Research/00a §"1. Recovery run" · "| Duration | 20-45 min |". Nothing in
    // the seven categories is shorter. A training-week prescription below it is
    // not a lighter session; it is not one of the sessions doctrine has.
    expect(
      belowRecovery.length,
      `${belowRecovery.length} easy day(s) in a TRAINING week are shorter than the shortest ` +
      'run Research/00a describes — see BELOW_RECOVERY above',
    ).toBe(0);

    // Research/00a §"2. General aerobic (easy run)" · "| Duration | 40-75 min |",
    // "bulk of weekly Z1". A week whose TYPICAL easy day is under that floor has
    // swapped its aerobic staple for recovery jogs, which is the "why is the plan
    // asking for so little" complaint stated in doctrine's own terms.
    expect(
      medianBelowAerobic.length,
      `${medianBelowAerobic.length} TRAINING week(s) have a median easy day below the ` +
      'general-aerobic floor — easy running has been reduced to whatever the quality ' +
      'sessions left over. See MEDIAN_SHORT above',
    ).toBe(0);
  });

  // ── 2 · DEMONSTRATED EASY ─────────────────────────────────────────────────
  //
  // CONVENTION, not doctrine, and named as such: no Research/ file says a plan
  // must respect a runner's own recent habit. The engine says it — `easyMileFloor`
  // exists, is documented as closing exactly this gap ("my easy runs are usually
  // 5-6 miles · why is the plan asking for 4.5?"), is computed correctly, and is
  // then discarded by `Math.min(effectiveFloor, perEasyBudgetCap)` whenever the
  // week's leftover budget is smaller than the floor. A floor that yields to the
  // budget is not a floor; it is a preference. This asserts that the engine's own
  // stated contract binds.
  it('the runner\'s demonstrated easy day is a floor, not a preference', () => {
    const built = buildOwnerBlock();
    if (!built.ok) throw new Error(built.reason);
    const below: string[] = [];
    for (const w of built.composed.weeks as unknown as WeekLike[]) {
      if (!isTrainingWeek(w)) continue;
      const easies = w.days.filter((d) => EASY_TYPES.has(d.type) && d.distanceMi > 0).map((d) => d.distanceMi);
      for (const mi of easies) {
        if (mi < OWNER_EASY_MEDIAN_MI) {
          below.push(`${w.phase} wk=${w.weeklyMi} easy=${mi}mi < demonstrated median ${OWNER_EASY_MEDIAN_MI}mi`);
        }
      }
    }
    console.log(`\nDEMONSTRATED_EASY · ${below.length} authored easy days below the runner's own median`);
    for (const s of below.slice(0, 12)) console.log(`  ${s}`);
    expect(
      below.length,
      `${below.length} easy day(s) in a TRAINING week are shorter than what this runner ` +
      'has actually been running. easyMileFloor computed the right number and the budget ' +
      'cap in layoutWeek discarded it',
    ).toBe(0);
  });

  // ── 3 · RESUME LADDER ─────────────────────────────────────────────────────
  //
  // Research/22 §14 states the whole ladder, and `RESUME_SEQUENCE` encodes it
  // correctly — but its only consumer is guarded `evidence?.lifted && ...`, so
  // the ladder is spent only for a runner the `lifted` boolean happens to
  // select. The runner sitting a tenth of a mile on the wrong side of that
  // boolean gets the geometric climb instead, and takes five weeks to reach a
  // level doctrine restores in three. That is the WKRESUME-1 defect its own
  // header says was fixed, still live for exactly the boundary case.
  it('a return to volume takes the three weeks doctrine gives it', () => {
    const built = buildOwnerBlock();
    if (!built.ok) throw new Error(built.reason);
    const ev = built.derived.rampBase!;
    const shares = resumeSharesFromDoctrine();
    const sustained = ev.sustainedMi;
    // Only meaningful for a runner whose recent mean sits BELOW their sustained
    // level — i.e. one who has something to return to.
    if (!(sustained > 0) || ev.meanMi >= sustained) return;
    const vols = (built.composed.weeks as unknown as WeekLike[])
      .filter((w) => !w.isRaceWeek).map((w) => w.weeklyMi);
    const target = Math.round(sustained * shares[shares.length - 1] * 10) / 10;
    const weekReached = vols.findIndex((v) => v >= target * 0.95);
    console.log(
      `\nRESUME_LADDER · doctrine ladder [${shares.map((s) => `${Math.round(s * 100)}%`).join(' · ')}] ` +
      `off sustained ${sustained}mi → ${shares.map((s) => (sustained * s).toFixed(1)).join(' · ')}\n` +
      `  authored: ${vols.slice(0, 8).join(' · ')}\n` +
      `  reaches ${target}mi in week ${weekReached < 0 ? 'NEVER' : weekReached + 1} ` +
      `(doctrine: week ${shares.length})  ·  lifted=${ev.lifted} interruption=${ev.interruptionWeeks}`,
    );
    expect(
      weekReached >= 0 && weekReached + 1 <= shares.length,
      `the block reaches the runner's own sustained volume (${target}mi) in week ` +
      `${weekReached < 0 ? 'never' : weekReached + 1}; Research/22 §14 restores it by week ${shares.length}. ` +
      `RESUME_SEQUENCE is gated on \`evidence.lifted\`, which is false for this runner by ` +
      `${(ev.meanMi - 0.7 * sustained).toFixed(2)} mi`,
    ).toBe(true);
  });

  // ── 4 · CONTINUITY · the test the apparatus never had ─────────────────────
  //
  // Every other gate in this repo samples the output space at points and asks
  // whether each point is legal. That is exactly the shape of check an
  // infinitely sharp cliff passes: both sides of the discontinuity are legal
  // plans. What is illegal is the STEP between them, and you cannot see a step
  // by looking at one point at a time.
  //
  // So: take one runner, move one input in small increments across a doctrine
  // threshold, compose a full plan at every increment, and assert the output
  // vector moves smoothly. Two walks, because the engine has two different ways
  // to fall off the same 70%:
  //
  //   A · the 28-day mean crosses 0.70 x sustained  (the `lifted` / `baseRebuilt` pair)
  //   B · a depressed recent block crosses the resume level, stepping
  //       `interruptionWeeks` over `allowedInterruptionWeeks` (an INTEGER count
  //       gating a whole phase)
  //
  // The properties asserted are the ones a coach would state:
  //   · the phase sequence does not appear or disappear on a fraction of a mile
  //   · week one does not jump
  //   · MORE recent training never buys a SMALLER plan (the perverse direction —
  //     this is the one that says the discontinuity is not merely sharp but
  //     backwards)

  interface Vec { input: number; mean: number; sustained: number; lifted: boolean; interruption: number; phases: string; wk1: number; peak: number; nWeeks: number; restoreWk: number }

  function vectorFor(input: number, daily: readonly number[]): Vec | null {
    const built = buildOwnerBlock(daily);
    if (!built.ok) return null;
    const weeks = built.composed.weeks as unknown as WeekLike[];
    const train = weeks.filter((w) => !w.isRaceWeek);
    const ev = built.derived.rampBase;
    const sustained = ev?.sustainedMi ?? 0;
    // The week the block first carries the runner back to their own sustained
    // level. This is the number the `lifted` boolean really decides, and the
    // one that shows the discontinuity is BACKWARDS: doctrine restores it in
    // three weeks, and the runner who trained MORE is the one who waits.
    const idx = train.findIndex((w) => w.weeklyMi >= sustained * 0.95);
    return {
      input,
      mean: ev?.meanMi ?? 0,
      sustained,
      lifted: !!ev?.lifted,
      interruption: ev?.interruptionWeeks ?? 0,
      phases: [...new Set(weeks.map((w) => w.phase))].join('>'),
      wk1: train[0]?.weeklyMi ?? 0,
      peak: Math.max(0, ...train.map((w) => w.weeklyMi)),
      nWeeks: weeks.length,
      restoreWk: idx < 0 ? 99 : idx + 1,
    };
  }

  /** Shared assertion body for a walk. `label` names the boundary being crossed. */
  function assertContinuous(label: string, vecs: Vec[]) {
    const phaseSteps: string[] = [];
    const volSteps: string[] = [];
    const perverse: string[] = [];
    console.log(`\nCONTINUITY WALK · ${label}`);
    for (const v of vecs) {
      console.log(
        `  in=${v.input.toFixed(3)} mean=${v.mean.toFixed(1)} ratio=${((v.mean / v.sustained) * 100).toFixed(1)}%` +
        ` lifted=${String(v.lifted).padEnd(5)} intr=${v.interruption} wk1=${v.wk1} peak=${v.peak}` +
        ` restoredWk=${v.restoreWk === 99 ? '--' : v.restoreWk} n=${v.nWeeks} ${v.phases}`,
      );
    }
    for (let i = 1; i < vecs.length; i++) {
      const a = vecs[i - 1], b = vecs[i];
      const dMean = Math.abs(b.mean - a.mean);
      if (a.phases !== b.phases) {
        phaseSteps.push(
          `${a.phases}  →  ${b.phases}  on a ${dMean.toFixed(2)} mi/wk change ` +
          `(mean ${a.mean}→${b.mean}, lifted ${a.lifted}→${b.lifted}, interruption ${a.interruption}→${b.interruption})`,
        );
      }
      // A week-one volume step must be proportionate to the input step. The
      // allowance is generous — a full mile plus three times the input change —
      // so ordinary rounding never trips it and only a genuine cliff does.
      const allowed = 1.0 + 3 * dMean;
      if (Math.abs(b.wk1 - a.wk1) > allowed) {
        volSteps.push(
          `week-1 volume ${a.wk1} → ${b.wk1} (${(b.wk1 - a.wk1).toFixed(1)}mi) on a ` +
          `${dMean.toFixed(2)} mi/wk change · allowed ${allowed.toFixed(2)}mi`,
        );
      }
      // The perverse direction. More recent volume must never produce a smaller
      // opening week or a shorter block. This is what makes the cliff a defect
      // rather than merely a threshold.
      if (b.mean > a.mean && b.wk1 < a.wk1 - 0.001) {
        perverse.push(
          `mean ${a.mean} → ${b.mean} (MORE training) but week-1 ${a.wk1} → ${b.wk1} (SMALLER plan)`,
        );
      }
      if (b.mean > a.mean && b.nWeeks < a.nWeeks) {
        perverse.push(`mean ${a.mean} → ${b.mean} (MORE training) but block ${a.nWeeks} → ${b.nWeeks} weeks (SHORTER)`);
      }
      // The sharpest form. Two runners with the same sustained level, one
      // training marginally more than the other, and the one who trained MORE
      // waits LONGER to be restored to it.
      if (b.mean > a.mean && b.restoreWk > a.restoreWk) {
        perverse.push(
          `mean ${a.mean} → ${b.mean} (MORE training) but restored to ${a.sustained}mi in week ` +
          `${a.restoreWk} → week ${b.restoreWk} (LATER) · lifted ${a.lifted}→${b.lifted}`,
        );
      }
    }
    for (const s of phaseSteps) console.log(`  PHASE_STEP    ${s}`);
    for (const s of volSteps) console.log(`  VOLUME_STEP   ${s}`);
    for (const s of perverse) console.log(`  PERVERSE      ${s}`);

    expect(vecs.length, `${label} · the walk composed no plans`).toBeGreaterThan(5);
    expect(
      phaseSteps.length,
      `${label} · ${phaseSteps.length} phase-structure discontinuity(ies). An entire training ` +
      'phase appears or disappears between two adjacent inputs — see PHASE_STEP above',
    ).toBe(0);
    expect(
      volSteps.length,
      `${label} · ${volSteps.length} week-1 volume discontinuity(ies) — see VOLUME_STEP above`,
    ).toBe(0);
    expect(
      perverse.length,
      `${label} · ${perverse.length} case(s) where MORE recent training produced a WORSE plan. ` +
      'A threshold that inverts the ordering is not a threshold, it is a bug — see PERVERSE above',
    ).toBe(0);
  }

  it('walk A · the 28-day mean crosses 0.70 x sustained', () => {
    // Scale only the most recent 28 days, so `mean` moves and the rank-3
    // `sustained` (which comes from weeks 5-16) stays put. 0.90 → 1.10 in
    // hundredths is roughly 0.3 mi/wk per step around the boundary.
    const vecs: Vec[] = [];
    for (let m = 0.90; m <= 1.1001; m += 0.01) {
      const daily = OWNER_DAILY_MI.map((v, i) => (i < 28 ? Math.round(v * m * 100) / 100 : v));
      const v = vectorFor(m, daily);
      if (v) vecs.push(v);
    }
    assertContinuous('mean crosses 0.70 x sustained', vecs);
  }, 60_000);

  it('walk B · a depressed recent block crosses the resume level', () => {
    // Depress the most recent 21 days only. As the depth deepens, each of the
    // three most recent 7-day blocks drops below `sustained x 0.70` in turn,
    // stepping `interruptionWeeks` 0 → 1 → 2 → 3 against an
    // `allowedInterruptionWeeks` of 2. An integer count, gating a phase.
    const vecs: Vec[] = [];
    for (let d = 1.00; d >= 0.849; d -= 0.01) {
      const daily = OWNER_DAILY_MI.map((v, i) => (i < 21 ? Math.round(v * d * 100) / 100 : v));
      const v = vectorFor(d, daily);
      if (v) vecs.push(v);
    }
    // Walked from most-depressed to least so "input increases" means "more
    // training", which is what the perverse-direction check reads.
    assertContinuous('recent block crosses the resume level', vecs.reverse());
  }, 60_000);
});
