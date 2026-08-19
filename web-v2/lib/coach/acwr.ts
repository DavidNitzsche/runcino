/**
 * lib/coach/acwr.ts · THE Acute:Chronic Workload Ratio. One implementation.
 *
 * ── Why this file exists (2026-08-17 cold-start audit) ───────────────────────
 *
 * There were five. `state-loader.ts`, `glance-state.ts`, `training-form.ts`,
 * `strength-recommender.ts` and `/api/niggle/history` each computed the ratio
 * their own way, behind three different guards. The guards were the problem,
 * not the arithmetic.
 *
 * For a runner whose entire history fits inside the acute window, the two legs
 * sum THE SAME RUNS:
 *
 *     acute7    = sum / 7
 *     chronic28 = sum / 28
 *     ratio     = (sum / 7) / (sum / 28) = 28 / 7 = 4.00   ← for any sum
 *
 * That is an algebraic identity, not a measurement. It does not vary with what
 * the runner did; it cannot. And the guard that was supposed to catch it —
 * `runs28 >= 3` — counts RUNS, not window coverage, so a runner who ran four
 * times in their first five days sails straight through it. The guard failed
 * open for precisely the runner it was written for.
 *
 * What it drove: an `urgent` injury card ("load is in the injury-risk band"),
 * a 12% readiness haircut, a strength-session cap, and a red LOAD tile — all
 * on week one, all from a constant.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 *
 * The chronic leg divides by a FIXED 28 days. Every day the account did not
 * exist enters that denominator as a real zero and deflates the baseline, so
 * a normal week presents as an acute spike. The deflation is total at 7 days
 * (the identity above) and decays to nothing at 28. Below a fully observable
 * chronic window the honest answer is **null**, not a number.
 *
 * This is a data-sufficiency rule, not a physiological one — the same shape as
 * `MIN_COVERAGE_DAYS` in `lib/runs/volume.ts`, and it reuses that module's
 * coverage arithmetic rather than inventing a second notion of "how much
 * history could this account possibly have".
 *
 * Null here is not a degraded number. `hasLoadSignal` (`state-presence.ts`)
 * already returns false when the ratio is absent, the readiness LOAD pillar
 * already renders "building history", and `loadContextMultiplier` already
 * returns neutral. Every consumer had an honest branch waiting; the identity
 * was keeping them out of it.
 *
 * ── Epistemic status ────────────────────────────────────────────────────────
 *
 * Research/15 calls ACWR "a directional sanity check, not a stop-light". It is
 * a training-load FACT (mileage this week against mileage this month), which
 * is why it survives the "readiness informs, never acts" ruling while recovery
 * scores do not. It is not, and must not become, a verdict on the runner.
 *
 * Cite: ARCHITECTURE §5 · absence of evidence is not evidence of a problem.
 */

import { canonicalMileageByDay } from '@/lib/runs/merge';
import {
  coverageDaysFrom,
  firstRunISO,
  isoDaysBefore,
} from '@/lib/runs/volume';

/** Acute window · the 7 days ending today, inclusive. */
export const ACWR_ACUTE_DAYS = 7;

/** Chronic window · the 28 days ending today, inclusive. */
export const ACWR_CHRONIC_DAYS = 28;

/**
 * Observable history required before the ratio means anything · a full chronic
 * window. Below this the fixed-28 denominator is counting days the account did
 * not exist. See the identity in the module docblock.
 */
export const ACWR_MIN_COVERAGE_DAYS = ACWR_CHRONIC_DAYS;

/**
 * ── RULE 7 (2026-08-19) · THE THREE SAMPLING GUARDS ARE CONVENTIONS ────────
 *
 * The WINDOWS above are doctrine and are bound:
 * SAMPLING.acwr-needs-a-full-chronic-window parses `acute_load_7d` and
 * `chronic_load_28d` straight out of Research/15's own formula line, so a doc
 * edit to either window moves the engine.
 *
 * The three constants below are not. Research/15 defines the ratio and states
 * its bands; it says nothing about how much data must be present before the
 * ratio is honest, because that is a question about our data pipeline rather
 * than about physiology. They are OURS, and CONVENTION.acwr-sampling-guards
 * binds them to the only properties they can honestly claim: that each one
 * only ever SUPPRESSES a reading (never fabricates or inflates one), and that
 * none of them can be loosened to the point where the algebraic identity the
 * coverage guard exists to stop — both legs summing the same runs, giving a
 * constant 28/7 = 4.00 — can reappear.
 *
 * Note the trap that was NOT taken here: Research/15 does carry a "3" —
 * "3 valid readings per week is sufficient for trend assessment" (Plews /
 * Laursen). That is three HRV READINGS, not three run days. Binding
 * ACWR_MIN_RUN_DAYS to it would be the two-adjacent-columns misread that Rule
 * 7 exists to prevent, with a citation that resolved and a claim that was
 * still wrong. Left as a labelled convention instead.
 */

/**
 * Secondary guard, retained from the pre-audit implementations: days carrying
 * real mileage inside the chronic window. Coverage does the real work now, but
 * a runner with 28 days of history and two runs in it still divides by a
 * near-zero baseline. CONVENTION.
 */
export const ACWR_MIN_RUN_DAYS = 3;

/** Chronic mi/day below which the division is noise. CONVENTION. */
export const ACWR_MIN_CHRONIC_MI_PER_DAY = 0.1;

/**
 * A day under this many miles is not a run day. CONVENTION · carried forward
 * verbatim from `state-loader.ts` / `glance-state.ts`, which both filtered
 * `info.mi <= 0.3`.
 */
export const RUN_DAY_MIN_MI = 0.3;

export type AcwrAbsentReason =
  /** Fewer than a full chronic window of observable history. */
  | 'insufficient_coverage'
  /** Enough history, too few days with mileage in it. */
  | 'insufficient_runs'
  /** Enough history and run days, chronic baseline still ~zero. */
  | 'no_chronic_load';

export interface AcwrResult {
  /** The ratio, or null when it cannot honestly be computed. */
  acwr: number | null;
  /** Mean mi/day across the acute window. Null whenever `acwr` is. */
  acute7: number | null;
  /** Mean mi/day across the chronic window. Null whenever `acwr` is. */
  chronic28: number | null;
  /** How many of the last `ACWR_CHRONIC_DAYS` this account could have run in. */
  coverageDays: number;
  /** Why `acwr` is null. Null when the ratio is real. */
  reason: AcwrAbsentReason | null;
}

const ABSENT = (coverageDays: number, reason: AcwrAbsentReason): AcwrResult => ({
  acwr: null,
  acute7: null,
  chronic28: null,
  coverageDays,
  reason,
});

/**
 * The ratio from a day → miles map. Pure · every window bound is derived from
 * `todayISO` here rather than trusted from the caller's fetch range, so an
 * over-wide or under-wide query cannot silently change the definition.
 *
 * `coverageDays` comes from `coverageDaysFrom` (`lib/runs/volume.ts`).
 */
export function acwrFromDailyMileage(
  byDay: Iterable<readonly [string, number]>,
  todayISO: string,
  coverageDays: number,
): AcwrResult {
  if (coverageDays < ACWR_MIN_COVERAGE_DAYS) {
    return ABSENT(coverageDays, 'insufficient_coverage');
  }

  const acuteFrom = isoDaysBefore(todayISO, ACWR_ACUTE_DAYS - 1);
  const chronicFrom = isoDaysBefore(todayISO, ACWR_CHRONIC_DAYS - 1);

  let acuteSum = 0;
  let chronicSum = 0;
  let runDays = 0;
  for (const [day, mi] of byDay) {
    if (!(mi > RUN_DAY_MIN_MI)) continue;
    if (day < chronicFrom || day > todayISO) continue;
    chronicSum += mi;
    runDays += 1;
    if (day >= acuteFrom) acuteSum += mi;
  }

  if (runDays < ACWR_MIN_RUN_DAYS) {
    return ABSENT(coverageDays, 'insufficient_runs');
  }

  const acute7 = +(acuteSum / ACWR_ACUTE_DAYS).toFixed(2);
  const chronic28 = +(chronicSum / ACWR_CHRONIC_DAYS).toFixed(2);
  if (chronic28 < ACWR_MIN_CHRONIC_MI_PER_DAY) {
    return ABSENT(coverageDays, 'no_chronic_load');
  }

  return {
    acwr: +(acute7 / chronic28).toFixed(2),
    acute7,
    chronic28,
    coverageDays,
    reason: null,
  };
}

/**
 * The ratio for a runner, as of `todayISO`. Reads through
 * `canonicalMileageByDay` so un-merged duplicate rows cannot inflate it —
 * David's ratio once read 1.80 off phantom sibling rows, and three surfaces
 * showed three different numbers before the dedupe landed.
 */
export async function computeAcwr(userId: string, todayISO: string): Promise<AcwrResult> {
  const from = isoDaysBefore(todayISO, ACWR_CHRONIC_DAYS - 1);
  const [byDay, firstISO] = await Promise.all([
    canonicalMileageByDay(userId, from, todayISO).catch(() => new Map<string, { mi: number; canonicalIds: string[] }>()),
    firstRunISO(userId).catch(() => null),
  ]);
  const mi = new Map<string, number>();
  for (const [day, info] of byDay) mi.set(day, info.mi);
  return acwrFromDailyMileage(mi, todayISO, coverageDaysFrom(firstISO, todayISO, ACWR_CHRONIC_DAYS));
}

/**
 * One sentence naming why the ratio is absent, for surfaces that show a
 * pillar row whether or not the number exists. Deliberately says what is
 * missing and when it arrives — never a number, never a verdict.
 */
export function acwrAbsentCopy(reason: AcwrAbsentReason | null): string {
  switch (reason) {
    case 'insufficient_coverage':
      return `Weekly-against-monthly load needs ${ACWR_MIN_COVERAGE_DAYS} days of history to mean anything. Building it.`;
    case 'insufficient_runs':
      return `Needs at least ${ACWR_MIN_RUN_DAYS} run days in the last ${ACWR_CHRONIC_DAYS} to be meaningful.`;
    case 'no_chronic_load':
      return 'Not enough recent mileage to compare this week against.';
    default:
      return '';
  }
}
