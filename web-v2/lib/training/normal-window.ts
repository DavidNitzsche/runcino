/**
 * lib/training/normal-window.ts · RULE 8 · a taper or a recovery window is
 * never the runner's normal.
 *
 * THE RULE (CLAUDE.md, locked 2026-08-30, at the owner's explicit instruction
 * given twice, the second time as an absolute): any reader that answers "what
 * does this runner NORMALLY do" MUST exclude days the engine itself prescribed
 * as taper, race week, or post-race recovery. Not "should where convenient".
 * Never, in any reader, for any runner.
 *
 * THE BUG CLASS. The engine measures the runner during a period IT told him to
 * go easy, and reports the result as his training identity. The plan then sizes
 * his next block off his own taper. Every number is arithmetically correct
 * against its window; the WINDOW is the defect, which is why none of the six
 * known instances failed a gate — every output was well-formed:
 *
 *   · `recentWeeklyMi` read 31.6 mi/wk against a sustained 43.5 → a marathon
 *     block opened at 31 mi/wk.
 *   · `easyDayMedianMi` read 4.0 mi against a 90-day median of 6.0 → four-mile
 *     easy days for a runner whose easy days are 3-7.8.
 *   · `recentQualityPerWeek` read 0/wk against a habit of 2/wk.
 *   · `recentLongMi` read a 13.5 mi taper long against 18.0 on 2026-07-25.
 *   · `resolveRampBase`'s mean was depressed → the return-to-volume ladder
 *     switched off entirely.
 *   · the `weekly_frequency` derivation read a median of 5 for a runner who
 *     runs 6.
 *
 * ── TWO CLAUSES THAT ARE EASY TO GET WRONG ──────────────────────────────────
 *
 * 1 · EXCLUDE, DO NOT DILUTE. A longer window still contains the taper; a
 *     reader "fixed" by averaging over 90 days instead of 14 has the wrong
 *     shape even when the number improves. It is also why the denominator here
 *     is `representativeDays`, never the nominal window length: see
 *     `weeklyRateFromRepresentative`. Excluding a third of a window and then
 *     dividing by the whole window is the same lie with an extra step.
 *
 *     THE ONE THING THIS CLAUSE DOES NOT FORBID, added 2026-08-31 at the
 *     owner's explicit instruction and separated from the clause above because
 *     the two are one word apart and opposite in effect: REACHING FURTHER BACK
 *     FOR REPRESENTATIVE DAYS. See `extendLookback`. Diluting admits taper days
 *     into the answer; extending admits none — every width runs the same
 *     exclusion, the denominator is still `representativeDays`, and the only
 *     thing that grows is how many days of ORDINARY training the reader got to
 *     look at. The owner's words: "I would rather have a confidence-weighted
 *     lookback that can extend backward when the intervening period contains
 *     little opportunity for relevant evidence than a hard cliff where day 28
 *     counts and day 29 disappears."
 *
 * 2 · IF EXCLUDING LEAVES TOO LITTLE DATA, REFUSE. A refusal is a correct
 *     answer; a confident number measured off a taper is not. Crucially the
 *     refusal must stay DISTINGUISHABLE from a measured zero downstream — a
 *     zero because the plan prescribed recovery and a zero because the runner
 *     is detrained are OPPOSITE FACTS, and the code that collapsed them is what
 *     produced the one-quality-day defect. `NormalReading<T>` is a discriminated
 *     union for exactly this reason: a refusal carries no `value` field at all,
 *     so `reading.value` does not typecheck until the caller has branched.
 *
 * ── WHERE THE NUMBERS COME FROM ─────────────────────────────────────────────
 *
 * The excluded range for each race the runner actually ran is its taper lead-in
 * through its post-race recovery window:
 *
 *     [ raceDate − taperWeeks·7 , raceDate + recoveryWeeks·7 ]
 *
 * Both halves are doctrine-bound and BOTH ARE REUSED, not re-derived — a second
 * copy of a doctrine table is the drift this project keeps paying for, and
 * Rule 7's lint flags a distance-keyed table with no claim watching it.
 *
 *   · taper — `TAPER_WEEKS_BY_DISTANCE` (lib/training/fitness-trajectory.ts).
 *     This is NOT a second copy of `BLOCK_SHAPE[cat].taperWeeks`: the doctrine
 *     claim `TAPER.trajectory-build-weeks` reads the generator's own literal
 *     out of `lib/plan/generate.ts` and fails the build if the two disagree for
 *     any category, and it independently checks both against `Research/08`
 *     §9.1's taper-length table. It is the generate-free handle on the same
 *     number, and it exists because the generator imports `pg` and this side of
 *     the app cannot. Reaching into `generate.ts` from here would also close an
 *     import cycle, since the generator reads `lib/runs/volume.ts`.
 *   · recovery — `postRaceRecoveryWeeks(cat, priority)` (lib/plan/goal-tiers.ts),
 *     imported directly. That is the same function `allowedInterruptionWeeksFor`
 *     spends, so the window this module excludes and the interruption the ramp
 *     base reads through are the same window by construction.
 *
 * These are the two terms of `allowedInterruptionWeeksFor`'s `mandated`, which
 * is what Rule 8 names. That function answers "how long an interruption may I
 * read THROUGH" for ONE race — the last one — because that is all a ramp base
 * needs. This module answers "which days are not this runner's normal" for
 * EVERY race in the history, because a 90-day habit median walks over several.
 *
 * TAPER IS NOT PRIORITY-SCALED HERE, matching `allowedInterruptionWeeksFor`,
 * which adds an unscaled `BLOCK_SHAPE[cat].taperWeeks` whatever the race's
 * priority. A C-priority tune-up embedded mid-block does not really get a
 * two-week taper, so this over-excludes for tune-ups. That is the safe
 * direction and it is chosen on purpose: dropping a real training day costs one
 * datum and can only push this module toward a REFUSAL, which is an honest
 * answer, whereas admitting one taper day corrupts the identity silently. An
 * unrecognised priority string likewise falls back to the full A-race recovery
 * (`recoveryEffortScale`), over-excluding rather than under-excluding.
 *
 * WHAT COUNTS AS "A RACE THE RUNNER ACTUALLY RAN": a past-dated `races` row
 * carrying a non-empty `actual_result`. Not the A/B filter `loadLastRaceFinished`
 * uses — a C-priority half still has a taper and a recovery block the engine
 * prescribed, and excluding it is the whole point. A future race is excluded
 * because its taper has not been run yet; a DNS carries no result and so opens
 * no window, which under-excludes its taper lead-in and is the one known gap
 * (recorded rather than papered over).
 *
 * ── HOW TO USE IT ───────────────────────────────────────────────────────────
 *
 * Readers come in two shapes and both are served, because a reader forced to
 * re-implement the predicate is a reader that will get it wrong:
 *
 *   · already holding the rows → `loadPrescribedWindows` + `excludePrescribedDays`
 *     (or `isPrescribedNonNormal` for a single date).
 *   · filtering in SQL → `NORMAL_TRAINING_DAY_SQL` via `normalTrainingDaySql`,
 *     with `normalWindowParams` supplying the two bound arrays. One exported
 *     constant with a doc comment, so there is one authority and greps find it —
 *     modelled on `CANONICAL_ROW_SQL` in lib/runs/volume.ts.
 *
 * WHAT IS *NOT* A HABIT READER, and must NOT use this. Rule 8's corollary:
 * FILTER A READER THAT ASKS WHAT THE RUNNER CAN DO; DO NOT FILTER ONE THAT ASKS
 * WHAT HE HAS RECENTLY ABSORBED. Habit and capability are Rule 8 questions;
 * tissue load and injury exposure are not, and over-applying the rule makes a
 * safety guard MORE permissive in exactly the case it exists for. So:
 *
 *   · execution / adherence ("what did he actually run") — a taper day is a
 *     real day he really ran, and hiding it would understate his own history.
 *   · acute load, freshness and readiness baselines — those are SUPPOSED to
 *     move with recent load; that is what makes them acute.
 *   · race-recency and taper detectors — they exist to look at race weeks.
 *   · injury guards. A ramp check measured against a pre-taper self waves
 *     through a jump the legs have not been prepared for. `recentPeakLongMi` is
 *     the worked example of a reader that was BOTH questions under one name:
 *     its habit half is filtered, its spike anchor stays literal.
 *
 * KNOWN GRANULARITY GAP, settled 2026-08-30 and recorded rather than papered
 * over. This module inherits WHOLE-WEEK doctrine tables, while
 * `lib/coach/easy-discipline.ts` reads the day-granular columns of the same two
 * sources. They agree on three of five distances either side. The engine's
 * rounding goes UP at 10K pre-race (7-10 days → 2 weeks), which over-excludes
 * by 4 days — the safe direction here. It floors DOWN at 5K post-race (3-5 days
 * → 0 weeks), which UNDER-excludes: a runner's post-5K no-quality days
 * currently count as his normal. Closing that means changing
 * `POST_RACE_RECOVERY_WEEKS['5k']`, which also moves plan composition, so it is
 * a call for that table's owner and not a patch to make here.
 *
 * See `lib/audit/normal-window-exemptions.ts` for the argued exceptions and
 * `lib/audit/_normal_window_scan.test.ts` for the gate that keeps this honest.
 */
import { pool } from '@/lib/db/pool';
import { distanceCategoryOrNull, type DistanceCategory } from '@/lib/race/distance-category';
import { distanceMiOfMeta } from '@/lib/race/distance';
import { postRaceRecoveryWeeks } from '@/lib/plan/goal-tiers';
import { TAPER_WEEKS_BY_DISTANCE } from '@/lib/training/fitness-trajectory';

/* NOTE ON IMPORT DIRECTION. Every static import above is a leaf: none of them
 * reads the plan generator or `lib/runs/volume.ts`, so this module can be
 * imported from anywhere without closing a cycle. `mileageByDay` is reached
 * through a dynamic import in `normalWeeklyMileage` alone, and `volume.ts` must
 * never import this module back — if a volume reader needs the filter, the
 * CALLER applies it. That is the correct layering anyway: `mileageByDay` is
 * also the truth for "how much did he run", which must keep every taper day. */

const DAY_MS = 86400000;

/** ISO date `days` after `isoDate` (noon-anchored → DST-safe). */
function isoShift(isoDate: string, days: number): string {
  return new Date(Date.parse(isoDate + 'T12:00:00Z') + days * DAY_MS)
    .toISOString().slice(0, 10);
}

/** Whole days from `a` to `b`, negative when `b` precedes `a`. */
function daySpan(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / DAY_MS);
}

/** A race the runner actually ran, as this module needs it. */
export interface RanRace {
  slug: string;
  /** `meta.date`, YYYY-MM-DD. */
  dateISO: string;
  /** Resolved miles — `distanceMiOfMeta`, never a raw `meta.distanceMi`. */
  distanceMi: number;
  /** `meta.priority`. Unrecognised values scale as an A race. */
  priority: string | null;
}

/**
 * One contiguous stretch the engine itself prescribed, and which therefore
 * cannot be read as this runner's normal. Inclusive at both ends.
 */
export interface PrescribedWindow {
  raceSlug: string;
  raceDateISO: string;
  raceDistanceMi: number;
  category: DistanceCategory;
  priority: string | null;
  taperWeeks: number;
  recoveryWeeks: number;
  /** First excluded day · the taper lead-in begins. */
  fromISO: string;
  /** Last excluded day · post-race recovery ends. */
  toISO: string;
}

/**
 * The window one raced event opens. Null for a distance the categoriser cannot
 * read — a race whose distance we do not know explains no mandated
 * interruption, the same refusal `allowedInterruptionWeeksFor` makes, and
 * inventing a half marathon for it is the defect this codebase already refuses
 * everywhere else.
 */
export function prescribedWindowFor(race: RanRace): PrescribedWindow | null {
  const cat = distanceCategoryOrNull(race.distanceMi);
  if (cat == null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(race.dateISO)) return null;
  const taperWeeks = TAPER_WEEKS_BY_DISTANCE[cat];
  const recoveryWeeks = postRaceRecoveryWeeks(cat, race.priority);
  return {
    raceSlug: race.slug,
    raceDateISO: race.dateISO,
    raceDistanceMi: race.distanceMi,
    category: cat,
    priority: race.priority,
    taperWeeks,
    recoveryWeeks,
    fromISO: isoShift(race.dateISO, -taperWeeks * 7),
    toISO: isoShift(race.dateISO, recoveryWeeks * 7),
  };
}

/** Pure · every window a set of raced events opens, oldest first. */
export function prescribedWindowsFrom(races: readonly RanRace[]): PrescribedWindow[] {
  const out: PrescribedWindow[] = [];
  for (const r of races) {
    const w = prescribedWindowFor(r);
    if (w) out.push(w);
  }
  out.sort((a, b) => (a.fromISO < b.fromISO ? -1 : a.fromISO > b.fromISO ? 1 : 0));
  return out;
}

/**
 * Every window this runner's raced history opens, up to `todayISO`.
 *
 * Not swallowed to `[]`. An empty window list is indistinguishable from "this
 * runner has never raced", and a failed read that answers `[]` puts every habit
 * reader straight back on the contaminated window — which is the entire defect
 * this module exists to stop. A caller that genuinely wants to proceed without
 * the filter has to say so at its own site, in writing.
 */
export async function loadPrescribedWindows(
  userUuid: string,
  todayISO: string,
): Promise<PrescribedWindow[]> {
  const rows = (await pool.query<{ slug: string; meta: unknown; priority: string | null }>(
    `SELECT slug, meta, meta->>'priority' AS priority
       FROM races
      WHERE user_uuid = $1::uuid
        AND meta->>'date' IS NOT NULL
        AND (meta->>'date')::date <= $2::date
        AND actual_result IS NOT NULL
        AND actual_result::text <> '{}'
      ORDER BY (meta->>'date')::date`,
    [userUuid, todayISO],
  )).rows;
  const races: RanRace[] = [];
  for (const r of rows) {
    const meta = (r.meta ?? {}) as Record<string, unknown>;
    const mi = distanceMiOfMeta(meta);
    const dateISO = String(meta.date ?? '').slice(0, 10);
    if (mi == null || !dateISO) continue;
    races.push({ slug: r.slug, dateISO, distanceMi: mi, priority: r.priority });
  }
  return prescribedWindowsFrom(races);
}

/** True when this date sits inside a taper, a race week, or a post-race
 *  recovery block the engine prescribed. */
export function isPrescribedNonNormal(
  iso: string,
  windows: readonly PrescribedWindow[],
): boolean {
  for (const w of windows) if (iso >= w.fromISO && iso <= w.toISO) return true;
  return false;
}

/**
 * WHICH prescribed window today itself sits inside, and whether today is
 * still counting down to the race (`'taper'`) or counting up from it
 * (`'post_race_recovery'`). `isPrescribedNonNormal` only answers yes/no; a
 * caller that wants to STATE an honest reason for a habit-facing verdict
 * needs to say which race and which side of race day today falls on, not
 * just that today is excluded.
 *
 * Built for `readExecution`'s `representative_execution` reader
 * (2026-09-01, `docs/reports/adaptation-reason-honesty-fix-2026-09-01.md`):
 * a widened, filtered lookback can end up explaining a HOLD by citing
 * sessions weeks old, when the truer, more proximate reason is sitting in
 * plain sight — the runner is still inside the very window the lookback had
 * to reach past. This is that reason, named.
 *
 * When more than one window covers today (a compound block — see
 * `normal-window.ts`'s own header on chained races), the window with the
 * LATEST `fromISO` wins: the most recently opened window is the one whose
 * race the runner would actually name if asked "what's going on this week".
 *
 * Pure — no I/O, so falsifiable without a database (Rule 18).
 */
export interface ActivePrescribedWindow {
  window: PrescribedWindow;
  kind: 'taper' | 'post_race_recovery';
  /** `daySpan(window.raceDateISO, todayISO)` — negative while still tapering
   *  toward the race, 0 on race day, positive during recovery. */
  daysSinceRace: number;
}

export function activePrescribedWindow(
  todayISO: string,
  windows: readonly PrescribedWindow[],
): ActivePrescribedWindow | null {
  let best: PrescribedWindow | null = null;
  for (const w of windows) {
    if (todayISO < w.fromISO || todayISO > w.toISO) continue;
    if (!best || w.fromISO > best.fromISO) best = w;
  }
  if (!best) return null;
  const daysSinceRace = daySpan(best.raceDateISO, todayISO);
  return { window: best, kind: daysSinceRace >= 0 ? 'post_race_recovery' : 'taper', daysSinceRace };
}

/** The in-memory half of the filter · drop every row landing on a prescribed
 *  taper / race / recovery day. `dateOf` returns YYYY-MM-DD. */
export function excludePrescribedDays<T>(
  rows: readonly T[],
  dateOf: (row: T) => string | null | undefined,
  windows: readonly PrescribedWindow[],
): T[] {
  if (windows.length === 0) return rows.slice();
  const out: T[] = [];
  for (const r of rows) {
    const d = dateOf(r);
    if (!d) continue;
    if (!isPrescribedNonNormal(d.slice(0, 10), windows)) out.push(r);
  }
  return out;
}

/**
 * How many days of `[fromISO, toISO]` (inclusive) survive the filter.
 *
 * This is the honest denominator, and using it rather than the nominal window
 * length is clause 1 of the rule made structural: a 28-day window with 20 days
 * of taper in it is a 8-day sample, not a 28-day sample with a low total.
 */
export function representativeDayCount(
  fromISO: string,
  toISO: string,
  windows: readonly PrescribedWindow[],
): number {
  const span = daySpan(fromISO, toISO);
  if (!Number.isFinite(span) || span < 0) return 0;
  let n = 0;
  for (let i = 0; i <= span; i++) {
    if (!isPrescribedNonNormal(isoShift(fromISO, i), windows)) n++;
  }
  return n;
}

/**
 * The SQL half of the filter · the query-side twin of `isPrescribedNonNormal`.
 *
 * ONE exported constant with a doc comment, so there is one authority and greps
 * find it — the shape `CANONICAL_ROW_SQL` in lib/runs/volume.ts set. It cannot
 * be a bare constant like that one, because the excluded ranges are per-runner
 * data rather than a fixed predicate, so the three holes are filled by
 * `normalTrainingDaySql` and the ranges arrive as two BOUND date arrays. No
 * date is ever interpolated into the string.
 *
 * With no windows the arrays are empty, `unnest` yields no rows, `NOT EXISTS`
 * is true, and every day counts as normal — which is the right answer for a
 * runner who has never raced.
 */
export const NORMAL_TRAINING_DAY_SQL =
  `NOT EXISTS (SELECT 1 FROM unnest(:LO::date[], :HI::date[]) AS _nw(lo, hi) ` +
  `WHERE (:DATE)::date BETWEEN _nw.lo AND _nw.hi)`;

/**
 * `NORMAL_TRAINING_DAY_SQL` with its three holes filled.
 *
 * @param dateExpr  the SQL expression holding the row's date, e.g.
 *                  `COALESCE(data->>'date', LEFT(data->>'startLocal', 10))`.
 * @param loParam   1-based placeholder index bound to the window lower bounds.
 * @param hiParam   1-based placeholder index bound to the window upper bounds.
 */
export function normalTrainingDaySql(
  dateExpr: string,
  loParam: number,
  hiParam: number,
): string {
  return NORMAL_TRAINING_DAY_SQL
    .replace(':LO', `$${loParam}`)
    .replace(':HI', `$${hiParam}`)
    .replace(':DATE', dateExpr);
}

/** The two arrays `normalTrainingDaySql`'s placeholders bind to. */
export function normalWindowParams(
  windows: readonly PrescribedWindow[],
): { lo: string[]; hi: string[] } {
  return { lo: windows.map((w) => w.fromISO), hi: windows.map((w) => w.toISO) };
}

/**
 * The minimum representative days before a habit answer means anything.
 *
 * Deliberately the SAME NUMBER as `MIN_COVERAGE_DAYS` in lib/runs/volume.ts
 * rather than a second floor invented here: that is the app's existing
 * data-sufficiency rule ("below one full week there is no week to average"),
 * it is not physiological, and the question this module asks — is the
 * surviving sample big enough to speak from — is the same question with a
 * different reason for the days being missing.
 *
 * Bound by ASSERTION, not by import, which is the same move
 * `TAPER_WEEKS_BY_DISTANCE` makes against the generator's `BLOCK_SHAPE`:
 * `_normal_window.test.ts` fails if the two ever diverge. The import was tried
 * first and was wrong — this module is reached from `lib/plan/adapt.ts`, and a
 * test that partially mocks `@/lib/runs/volume` then leaves this constant
 * undefined at module load, taking an unrelated suite down with it. A gate that
 * proves equality costs one assertion and cannot be broken by a mock.
 */
export const MIN_REPRESENTATIVE_DAYS = 7;

/** Why a habit reader refused. Never a number, and never a zero. */
export interface NormalRefusal {
  code: 'not-enough-representative-training';
  /** Coach-voice, safe to surface. */
  message: string;
  windowFromISO: string;
  windowToISO: string;
  needDays: number;
}

/**
 * A habit answer, or an argued refusal to give one.
 *
 * A discriminated union on purpose. The refusal branch carries NO `value`
 * field, so `reading.value` does not compile until the caller has checked
 * `reading.ok` — which is the difference between "he ran zero quality sessions"
 * and "the only weeks I can see are weeks I told him to rest", and the whole of
 * why this type exists rather than `number | null`.
 */
export type NormalReading<T> =
  | { ok: true; value: T; representativeDays: number; excludedDays: number }
  | { ok: false; refusal: NormalRefusal; representativeDays: number; excludedDays: number };

/** The filtered view of one lookback window, and whether it can be spoken from. */
export interface NormalWindow {
  fromISO: string;
  toISO: string;
  windows: PrescribedWindow[];
  representativeDays: number;
  excludedDays: number;
  /** False → every habit reading off this window must refuse. */
  sufficient: boolean;
}

/**
 * Resolve the filtered lookback a habit reader should measure over.
 *
 * `windowDays` is FIXED by the caller and this function will not grow it. A
 * reader that wants to reach further back for REPRESENTATIVE days — never for
 * more taper days — asks `representativeLookback` instead, which is a separate
 * entry point precisely so that widening is a decision a call site takes on
 * purpose rather than a fallback this one performs on its behalf.
 */
export async function normalTrainingWindow(
  userUuid: string,
  todayISO: string,
  windowDays: number,
): Promise<NormalWindow> {
  const fromISO = isoShift(todayISO, -windowDays);
  const windows = await loadPrescribedWindows(userUuid, todayISO);
  const representativeDays = representativeDayCount(fromISO, todayISO, windows);
  const total = daySpan(fromISO, todayISO) + 1;
  return {
    fromISO,
    toISO: todayISO,
    windows,
    representativeDays,
    excludedDays: Math.max(0, total - representativeDays),
    sufficient: representativeDays >= MIN_REPRESENTATIVE_DAYS,
  };
}

/**
 * Wrap a computed habit value in the refusal contract.
 *
 * Call it with the value measured over the FILTERED rows. If the surviving
 * sample is too thin the value is discarded and a refusal is returned in its
 * place — never coerced to zero, which is the collapse that produced the
 * one-quality-day defect.
 */
export function readNormal<T>(w: NormalWindow, value: T): NormalReading<T> {
  const common = { representativeDays: w.representativeDays, excludedDays: w.excludedDays };
  if (!w.sufficient) {
    return {
      ok: false,
      ...common,
      refusal: {
        code: 'not-enough-representative-training',
        message:
          `Not enough representative training to answer. Of the ${w.excludedDays + w.representativeDays} ` +
          `days from ${w.fromISO}, ${w.excludedDays} were taper, race or prescribed recovery, ` +
          `leaving ${w.representativeDays} — under the ${MIN_REPRESENTATIVE_DAYS} needed.`,
        windowFromISO: w.fromISO,
        windowToISO: w.toISO,
        needDays: MIN_REPRESENTATIVE_DAYS,
      },
    };
  }
  return { ok: true, value, ...common };
}

/** Narrowing helper, so call sites read as a decision rather than a null check. */
export function isRefusal<T>(
  r: NormalReading<T>,
): r is Extract<NormalReading<T>, { ok: false }> {
  return !r.ok;
}

/**
 * Miles per week from a filtered total · clause 1 of the rule, structurally.
 *
 * The divisor is the REPRESENTATIVE days, not the nominal window. Excluding a
 * third of a window and then dividing by the whole window is the same lie with
 * an extra step: it reports the taper as a volume collapse instead of reporting
 * it as absent. Compare `weeklyAvgFromWindow` in lib/runs/volume.ts, which
 * makes the same move for a different reason (a young account's uncovered
 * days).
 */
export function weeklyRateFromRepresentative(
  totalMi: number,
  w: NormalWindow,
): NormalReading<number> {
  if (!w.sufficient) return readNormal(w, 0) as NormalReading<number>;
  const rate = Math.round((totalMi / (w.representativeDays / 7)) * 10) / 10;
  return readNormal(w, rate);
}

/**
 * THE habit answer to "what does this runner normally run in a week", filtered.
 *
 * The Rule 8 counterpart to `recentWeeklyMileageMi` (lib/runs/volume.ts), which
 * is the same 28-day mean with the taper still in it. That reader is NOT wrong
 * — it is the honest answer to "how much did he run", which is what a drift or
 * adherence check needs and which must keep every taper day. This one answers a
 * different question, and the two are kept as separate functions so a call site
 * has to say which question it is asking.
 *
 * The owner on 2026-08-30 is the worked example: a 28-day window ending today
 * is 2026-08-03 → 2026-08-30, and his Americas Finest City half (2026-08-16,
 * A, 13.1 mi) opens a window of 2026-08-02 → 2026-08-30. Every single day of
 * the lookback is prescribed. `recentWeeklyMileageMi` answers 31.6 mi/wk with
 * no caveat; this function refuses, which is the only true thing available.
 */
export async function normalWeeklyMileage(
  userUuid: string,
  todayISO: string,
  windowDays = 28,
): Promise<NormalReading<number>> {
  const { mileageByDay } = await import('@/lib/runs/volume');
  const w = await normalTrainingWindow(userUuid, todayISO, windowDays);
  if (!w.sufficient) return readNormal(w, 0) as NormalReading<number>;
  const byDay = await mileageByDay(userUuid, w.fromISO, w.toISO);
  let total = 0;
  for (const [iso, { mi }] of byDay) {
    if (!isPrescribedNonNormal(iso, w.windows)) total += mi;
  }
  return weeklyRateFromRepresentative(Math.round(total * 10) / 10, w);
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE CONFIDENCE-WEIGHTED LOOKBACK · locked 2026-08-31 at the owner's request
 *
 * The distinction this exists to preserve, in his words: "we haven't seen
 * enough evidence because this runner is new or inconsistent" is NOT the same
 * fact as "we haven't seen much recent evidence because the training phase
 * deliberately stopped generating it". A gate that hard-cliffs at day 28 says
 * the same thing about both, and it says it loudest exactly when the engine
 * itself is the reason the window is empty.
 *
 * The worked case, measured on the owner's own account on 2026-08-31. His
 * Americas Finest City half (2026-08-16, A, 13.1 mi) opens a prescribed window
 * of 2026-08-02 → 2026-08-30. A 28-day evidence window ending today therefore
 * holds ONE representative day. Inside it: one threshold session. In the 32
 * representative days immediately before it: five — 2026-07-07, 07-09, 07-14,
 * 07-16 and 07-21. The evidence exists, it is his, and the only thing standing
 * between the gate and it is a fixed window number.
 *
 * ── WHY THIS IS NOT CLAUSE 1'S "WIDEN" ─────────────────────────────────────
 *
 * Clause 1 forbids widening INSTEAD of excluding — reaching for 90 days so the
 * taper is averaged away. This path widens AFTER excluding, and every candidate
 * width runs the identical exclusion: a prescribed day is never admitted at any
 * width, and `representativeDays` remains the denominator. The only quantity
 * that grows is how many days of ORDINARY training the reader is allowed to
 * see. Compare the two failure modes:
 *
 *   DILUTE (forbidden)  · 28d holds 1 normal day + 27 taper days
 *                       → answer over 28 days · the taper IS the answer.
 *   EXTEND (this)       · 28d holds 1 normal day
 *                       → reach back to 60d, which holds 32 normal days
 *                       → answer over 32 REPRESENTATIVE days, taper still out,
 *                         confidence discounted for how old they are.
 *
 * ── AND WHY IT IS DISCOUNTED RATHER THAN FREE ───────────────────────────────
 *
 * Older evidence is real evidence and it is not current evidence. The discount
 * is a half-life on the MEDIAN AGE of the observations that actually mattered,
 * over the same `CAPACITY_CONFIDENCE_HALF_LIFE_DAYS` the confidence model
 * already ages capacity by — so a belief cannot be more confident here than the
 * layer that owns confidence would be about the same runs. It is exactly 1.0
 * whenever the evidence sits inside the base window, which makes this whole
 * mechanism a NO-OP for any runner whose recent window is representative.
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The outer bound. A lookback may never reach past this, however thin the
 * representative sample is.
 *
 * 120 DAYS, and the argument is the doctrine tables' own arithmetic rather than
 * a round number: the longest prescribed non-normal stretch this module can
 * open is a marathon at A priority — `TAPER_WEEKS_BY_DISTANCE.m` (3) plus
 * `postRaceRecoveryWeeks('m','A')` (4) = 7 weeks = 49 days. A 28-day base
 * window sitting entirely inside one needs 49 + 28 = 77 days to clear it, and
 * a runner can have a second race inside the reach. 120 leaves that headroom
 * and stops well short of half a year, past which "this is the runner" stops
 * being true of a training block at all.
 *
 * The bound BINDS: when it is reached with too few representative days the
 * answer is still a refusal. Extending is not a promise of an answer.
 */
export const REPRESENTATIVE_LOOKBACK_MAX_DAYS = 120;

/** How much further back one widening step reaches. One training week, so a
 *  step can only ever add whole weeks of ordinary training. */
export const REPRESENTATIVE_LOOKBACK_STEP_DAYS = 7;

/**
 * The half-life the staleness discount uses.
 *
 * THE SAME NUMBER as `CAPACITY_CONFIDENCE_HALF_LIFE_DAYS` in
 * `lib/training/capacity-resolver.ts`. Written out rather than imported because
 * that module reads this one's siblings and a value import here would close a
 * cycle — the same posture `REEXAMINATION_WINDOW_DAYS` takes, and held the same
 * way: `_normal_window.test.ts` imports both and fails if they ever diverge.
 * Do not "fix" this by importing it; fix it by deleting the assertion, and the
 * divergence arrives silently the next time either number moves.
 */
export const REPRESENTATIVE_STALENESS_HALF_LIFE_DAYS = 28;

/** The widened lookback, and everything a caller needs to explain it. */
export interface RepresentativeLookback extends NormalWindow {
  /** The window the caller asked for before any extension. */
  baseWindowDays: number;
  /** The window actually used. */
  windowDays: number;
  /** `windowDays - baseWindowDays`. Zero on the common path. */
  extendedByDays: number;
  /** How many representative days the extension was trying to reach. */
  targetRepresentativeDays: number;
  /** True when the outer bound was hit before the target was met. */
  reachedOuterBound: boolean;
}

/**
 * Choose the smallest window, at or past `baseWindowDays`, that holds
 * `targetRepresentativeDays` of ordinary training.
 *
 * PURE, so the whole widening rule is falsifiable without a database (Rule 18).
 * Returns the base window untouched whenever it already clears the target,
 * which is what makes this a no-op for a runner with a clean recent window.
 */
export function extendLookback(args: {
  todayISO: string;
  windows: readonly PrescribedWindow[];
  baseWindowDays: number;
  /** Defaults to `baseWindowDays` — reach back until you have as many
   *  representative days as the caller originally budgeted for. */
  targetRepresentativeDays?: number;
  maxWindowDays?: number;
  stepDays?: number;
}): {
  windowDays: number;
  fromISO: string;
  representativeDays: number;
  reachedOuterBound: boolean;
  targetRepresentativeDays: number;
} {
  const {
    todayISO, windows, baseWindowDays,
    maxWindowDays = REPRESENTATIVE_LOOKBACK_MAX_DAYS,
    stepDays = REPRESENTATIVE_LOOKBACK_STEP_DAYS,
  } = args;
  const target = args.targetRepresentativeDays ?? baseWindowDays;

  let windowDays = Math.max(0, Math.min(baseWindowDays, maxWindowDays));
  let fromISO = isoShift(todayISO, -windowDays);
  let representativeDays = representativeDayCount(fromISO, todayISO, windows);

  // Monotone by construction: every step only ADDS days, and a day either is or
  // is not prescribed, so `representativeDays` can never fall as the window
  // grows. That is what makes this loop terminate and what makes the result
  // continuous in the runner's history rather than cliff-edged (Rule 9).
  while (representativeDays < target && windowDays < maxWindowDays) {
    windowDays = Math.min(maxWindowDays, windowDays + Math.max(1, stepDays));
    fromISO = isoShift(todayISO, -windowDays);
    representativeDays = representativeDayCount(fromISO, todayISO, windows);
  }

  return {
    windowDays,
    fromISO,
    representativeDays,
    reachedOuterBound: representativeDays < target && windowDays >= maxWindowDays,
    targetRepresentativeDays: target,
  };
}

/**
 * The database shell for `extendLookback` — one read of the runner's races,
 * then the pure decision.
 */
export async function representativeLookback(
  userUuid: string,
  todayISO: string,
  baseWindowDays: number,
  opts: { targetRepresentativeDays?: number; maxWindowDays?: number } = {},
): Promise<RepresentativeLookback> {
  const windows = await loadPrescribedWindows(userUuid, todayISO);
  const ext = extendLookback({
    todayISO, windows, baseWindowDays,
    targetRepresentativeDays: opts.targetRepresentativeDays,
    maxWindowDays: opts.maxWindowDays,
  });
  const total = daySpan(ext.fromISO, todayISO) + 1;
  return {
    fromISO: ext.fromISO,
    toISO: todayISO,
    windows,
    representativeDays: ext.representativeDays,
    excludedDays: Math.max(0, total - ext.representativeDays),
    sufficient: ext.representativeDays >= MIN_REPRESENTATIVE_DAYS,
    baseWindowDays,
    windowDays: ext.windowDays,
    extendedByDays: Math.max(0, ext.windowDays - baseWindowDays),
    targetRepresentativeDays: ext.targetRepresentativeDays,
    reachedOuterBound: ext.reachedOuterBound,
  };
}

/**
 * How much to discount a belief for the age of the evidence that carried it.
 *
 * 1.0 — no discount at all — whenever the median observation sits inside the
 * base window, which is every runner whose recent training is representative.
 * Past that it is a half-life on the EXCESS age only, so an observation is
 * never penalised for being 27 days old when the window was 28.
 *
 * The MEDIAN rather than the mean, on purpose: one very old corroborating
 * session should not drag down a belief carried by three recent ones, and one
 * very recent session should not rescue a belief carried by three old ones.
 *
 * PURE, and returns 1 for an empty list: nothing to age is not "infinitely
 * stale", it is a caller with no evidence, and that caller's own gate is what
 * should refuse (Rule 11).
 */
export function evidenceStalenessFactor(
  evidenceDatesISO: readonly string[],
  todayISO: string,
  baseWindowDays: number,
): number {
  const ages = evidenceDatesISO
    .map((d) => daySpan(String(d).slice(0, 10), todayISO))
    .filter((n) => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b);
  if (ages.length === 0) return 1;
  const mid = Math.floor(ages.length / 2);
  const median = ages.length % 2 === 1 ? ages[mid] : (ages[mid - 1] + ages[mid]) / 2;
  const excess = Math.max(0, median - baseWindowDays);
  if (excess === 0) return 1;
  return Math.pow(0.5, excess / REPRESENTATIVE_STALENESS_HALF_LIFE_DAYS);
}
