/**
 * scripts/adaptation-real-replay/_asof_typecheck.ts · THE FALSIFIER FOR A GATE
 * THAT LIVES IN THE TYPE SYSTEM.
 *
 * Rule 18: a gate is not trusted until it has been made to fail. A type-level
 * gate cannot be made to fail at run time, so it is made to fail at COMPILE
 * time, and this file is how.
 *
 * Every block below is a lookahead this fence is supposed to make impossible,
 * written out, with `@ts-expect-error` above it. TypeScript treats an UNUSED
 * `@ts-expect-error` as an error of its own, so:
 *
 *   · the fence holding  → each line errors → each directive is used → clean.
 *   · the fence weakened → the line compiles → the directive is unused →
 *     `tsc` reports TS2578 and `_asof_fence.test.ts` fails, naming the line.
 *
 * This is the inverse of the usual test and it is deliberately so. An ordinary
 * assertion proves the good path works; these prove the BAD path is
 * unavailable, which is the only thing a fence is for.
 *
 * ── FALSIFIED, NOT ASSUMED ─────────────────────────────────────────────────
 *
 * Run against a deliberately weakened `asof.ts` before being trusted. Adding
 * `readonly rows: readonly T[]` back onto `SealedEvidence` and re-running
 * `tsc --noEmit -p scripts/adaptation-real-replay` reported:
 *
 *     _asof_typecheck.ts(NN,1): error TS2578: Unused '@ts-expect-error'
 *
 * on the array-surface blocks, and the fence was restored. The same was done
 * for the brand disjointness (deleting `[AUTHORED_BRAND]` from `Authored`) and
 * for the race projection (widening it to the whole `SnapRace`).
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ────────────────────────────────
 *
 * · A leak that is not one of the shapes written here. It enumerates; it does
 *   not reason. A future author who invents a new way around the fence gets no
 *   error from this file until somebody adds the block for it.
 * · Anything at run time. Every expression below is dead code that is never
 *   executed; the file exists to be compiled, not to be run.
 * · A gate that is deleted outright. If somebody removes this file, nothing
 *   here objects. `_asof_fence.test.ts` asserts the file exists and that its
 *   directive COUNT has not dropped, which is that gate's own ratchet.
 */
import type { AsOf, Authored, Evidence } from './asof';
import { asOf } from './asof';
import { sealedHistory } from './sealed-history';
import type { SnapRun, SnapWorkout } from './snapshot';
import { realHistory } from './snapshot';
import { buildInputAt } from './build-input';

const H = sealedHistory();
const A: AsOf = asOf('2026-07-01');

/* ── 1 · A SEALED COLLECTION HAS NO ARRAY SURFACE ───────────────────────────
 *
 * The whole mechanism. If any of these compile, the fence is decorative,
 * because the old hand-written `before()` convention is available again.
 */

// @ts-expect-error · `filter` on the sealed collection: the exact expression the
// fence exists to remove. Nothing may read runs without naming a moment.
export const t1 = H.runs.filter((r) => r.date < '2026-07-01');

// @ts-expect-error · index access is the same leak with different syntax.
export const t2 = H.runs[0];

// @ts-expect-error · so is `length`, which is how a caller probes then reaches.
export const t3 = H.runs.length;

// @ts-expect-error · and iteration.
export const t4 = [...H.runs];

// @ts-expect-error · `find` on the sealed race collection.
export const t5 = H.races.find((r) => r.slug === 'cim-2026');

/* ── 2 · A RUN HAS NO FORWARD DOOR ──────────────────────────────────────────
 *
 * Not narrowed. Absent. A run cannot be known before it is run, so there must
 * be no expression at all that asks for future runs.
 */

// @ts-expect-error · `fromInclusive` is not on `SealedEvidence`, only on a
// calendar. A future run is not a thing this fence can be asked for.
export const t6 = H.runs.fromInclusive(A, 'PRESCRIPTION_IS_AUTHORED_IN_ADVANCE');

/* ── 3 · A FUTURE RACE CARRIES NO RESULT ────────────────────────────────────
 *
 * The subtler leak: not a mixed-up collection, but a real field read off a real
 * future row. The projection is what removes it, and this is the proof that it
 * removed the right ones.
 */

const scheduled = H.races.fromInclusive(A, 'RACE_DATE_IS_PUBLISHED_IN_ADVANCE');

// @ts-expect-error · a race that has not been run has no finish time.
export const t7 = scheduled[0]?.finishS;

// @ts-expect-error · nor an average heart rate.
export const t8 = scheduled[0]?.avgHr;

// @ts-expect-error · nor a finish pace.
export const t9 = scheduled[0]?.paceSPerMi;

// The identity and the date ARE knowable, and must stay knowable — a fence that
// blocks this would be worked around within a week. Compiles on purpose.
export const t10: string | null | undefined = scheduled[0]?.dateISO;

/* ── 4 · THE TWO BRANDS SHARE NO MEMBER ─────────────────────────────────────
 *
 * S1.3's pattern. An artifact must never be spendable as an outcome.
 */

declare function needsEvidence(x: Evidence<SnapWorkout>): void;
declare function needsArtifacts(x: Authored<SnapWorkout>): void;

const artifacts: Authored<SnapWorkout> = H.planWorkouts.ofAnyVisiblePlan(
  [], 'PRESCRIPTION_IS_AUTHORED_IN_ADVANCE',
);
const outcomes: Evidence<SnapRun> = H.runs.before(A);

// @ts-expect-error · a prescription is not a result, whatever its row type.
needsEvidence(artifacts);

// @ts-expect-error · and the substitution is blocked in both directions.
needsArtifacts(outcomes);

// @ts-expect-error · a bare array is neither. This is what stops a caller
// rebuilding an `Evidence` by hand out of rows it filtered itself.
export const t11: Evidence<SnapRun> = [] as SnapRun[];

/* ── 5 · THE MOMENT IS UNFORGEABLE ──────────────────────────────────────────
 *
 * So a caller cannot pass a date computed from a row it should not have read.
 */

// @ts-expect-error · a plain string is not an `AsOf`.
export const t12 = H.runs.before('2026-07-01');

/* ── 6 · AN ARTIFACT IS GATED BY ITS PLAN, NOT BY ITS DATE ──────────────────
 *
 * The axis the first draft got wrong. Prescriptions come out against a
 * `VisiblePlan` token, and a token cannot be minted from a plan id.
 */

// @ts-expect-error · a plan id read off a row is not a token.
export const t13 = H.planWorkouts.ofPlan({ planId: 'pln_9a57561debb776e5' }, 'PRESCRIPTION_IS_AUTHORED_IN_ADVANCE');

/* ── 7 · THE DOOR INTO THE ENGINE TAKES THE SEALED HISTORY ──────────────────
 *
 * The regression this whole file protects: `buildInputAt` accepting the raw
 * extract again would restore the old convention wholesale, and every check
 * above would still pass while doing nothing.
 */

export const t14 = buildInputAt(
  { asOfISO: '2026-07-01', boundary: 'WEEKLY_BOUNDARY', belief: null as never },
  // @ts-expect-error · the raw extract is not a `SealedHistory`. The directive
  // sits on the ARGUMENT rather than on the call, because it suppresses the
  // next line only and the error is reported where the argument is.
  realHistory(),
);
