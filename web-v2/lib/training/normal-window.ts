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
 * 1 · EXCLUDE, DO NOT WIDEN. A longer window still contains the taper; it only
 *     dilutes it. A reader "fixed" by reaching for 90 days instead of 14 has
 *     the wrong shape even when the number improves. This module has NO
 *     widen-until-sufficient path, and that is deliberate — the only knob it
 *     offers is which days to drop. It is also why the denominator here is
 *     `representativeDays`, never the nominal window length: see
 *     `weeklyRateFromRepresentative`. Excluding a third of a window and then
 *     dividing by the whole window is the same lie with an extra step.
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
 * `windowDays` is FIXED by the caller and this function will not grow it. There
 * is no widen-until-sufficient path anywhere in this module, by design: a wider
 * average still contains the taper, it only dilutes it, so a reader that
 * "improves" by reaching further back has changed its number without fixing its
 * defect. When the filtered window is too thin the answer is a refusal.
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
