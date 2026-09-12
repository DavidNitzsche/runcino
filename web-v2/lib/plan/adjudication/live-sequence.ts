/**
 * lib/plan/adjudication/live-sequence.ts · THE SEQUENCE GATE, ON A REAL BLOCK.
 *
 * ── WHY THIS FILE IS THE POINT ─────────────────────────────────────────────
 *
 * The adjudication layer was written because an outside review found
 * sequence-level problems this engine passes: it "can quote the correct
 * doctrine and evaluate individual workouts while still potentially assembling
 * an incoherent overall sequence." Every other gate samples the plan at POINTS.
 * This layer samples the SEQUENCE.
 *
 * And then it had no caller. `_generated_content_gate` recorded it honestly —
 * "the layer still reaches no live entry point" — which makes it the largest
 * instance of this codebase's signature failure: wired, tested and inert. A
 * sequence checker that never sees a real sequence has told nobody anything.
 *
 * This is the entry point. It READS a runner's authored block, runs the
 * one-stressor-at-a-time detector across it, and RAISES A CARD for the first
 * future week that breaks it. It writes no plan row, and it cannot: the only
 * writer it knows about is `writeWorkoutProposals`.
 *
 * ── WHAT IT CANNOT DO (Rule 22) ────────────────────────────────────────────
 *
 * · It checks ONE sequence rule, not the whole layer. `checkPromotion` grades
 *   eleven dimensions and this spends one of them. Naming that is the point:
 *   "the adjudicator is wired" would be false, and "one of its findings now
 *   reaches the runner" is true.
 * · It cannot make the plan harder or easier by itself. It asks.
 * · It reads the plan as AUTHORED. A week the runner has already changed by
 *   hand is read as it now stands, which is correct, but it means a finding can
 *   disappear because he fixed it himself — and that is a good outcome the
 *   ledger should record rather than a bug.
 */

import { pool } from '@/lib/db/pool';
import { rowsOrNull } from '@/lib/db/read';
import { planVersionOf } from '@/lib/plan/plan-version';
import { weekContainsRace } from '@/lib/plan/race-week';
import {
  type PlannedWeek,
  detectSimultaneousStressAddition,
} from './adjudicate';

/** A stressor is a session that carries hard physiological load. */
const STRESSOR_TYPES = new Set(['tempo', 'interval', 'intervals', 'repetition', 'race']);

/**
 * Is this session a named stressor, and what is it called?
 *
 * ── THE LONG RUN COUNTS, AND GETTING THIS WRONG MADE THE GATE FIND NOTHING ──
 *
 * My first cut excluded an ordinary long run on the reasoning that "the length
 * is volume, the finish is intensity". That is a defensible sentence and it is
 * NOT this layer's semantics: `_cim_trace.test.ts` builds the very week this
 * gate exists for as `['Dodgers 10k', 'tempo', '17 mi long']` — three — and its
 * predecessor as `['threshold', '16.5 mi long']` — two. The detector's
 * thresholds were chosen against that counting.
 *
 * Run against the owner's live block, my version counted 2 and 2, so the step
 * from one to the other added no intensity and the gate reported NO FINDING on
 * the one week the whole document is about. A checker that counts differently
 * from the rule it enforces does not disagree loudly; it reports clean, which
 * is the worst outcome available because it also reports confidence.
 *
 * So the count is: anything the plan marks a long run, plus the hard session
 * types, plus anything else flagged quality. One counting, and it is the
 * layer's own.
 */
export function stressorNameOf(
  type: string,
  subLabel: string | null,
  isQuality: boolean | null,
  isLong: boolean | null,
): string | null {
  const t = (type ?? '').toLowerCase();
  if (STRESSOR_TYPES.has(t)) return t === 'intervals' ? 'interval' : t;
  if (isLong === true || t === 'long') {
    const s = (subLabel ?? '').toUpperCase();
    return s.includes('FAST') || s.includes('MP') || s.includes('PROGRESS')
      ? 'fast-finish long' : 'long';
  }
  if (isQuality === true && t !== 'easy' && t !== 'recovery' && t !== 'rest') {
    return t || 'quality';
  }
  return null;
}

export interface LiveWeek extends PlannedWeek {
  /** The rows behind the week, so a proposal can name the session it means. */
  readonly rows: readonly {
    readonly id: string;
    readonly dateISO: string;
    readonly type: string;
    readonly distanceMi: number;
    readonly stressor: string | null;
  }[];
}

export type SequenceRead =
  | {
    readonly ok: true;
    readonly weeks: readonly LiveWeek[];
    /** The plan the weeks were read from, and its version — so a caller that
     *  schedules or proposes against them names the same plan (Rule 16). */
    readonly planId: string;
    readonly planVersion: string;
  }
  | { readonly ok: false; readonly why: string };

/**
 * The runner's ACTIVE block, as weeks.
 *
 * Rule 14 · the scope is stated and narrow. `archived_iso IS NULL` matters:
 * the owner has 47 plan versions and a join on `user_uuid` alone reads all of
 * them, which is exactly the omission that once counted 59 quality sessions in
 * a single week.
 *
 * Weeks are Monday-anchored here rather than long-run-anchored, because the
 * doctrine rule this feeds — "either add mileage OR add intensity in a given
 * week" — is about a training week's total load, and the detector compares one
 * week's totals against the trailing three. A boundary shifted by a day moves
 * miles between adjacent weeks and changes neither comparison materially. Where
 * the boundary DOES matter is anything the runner reads about "this week", and
 * that has its own owner in `week-loader.ts`.
 */
/**
 * RACEWEEK-CONSOLIDATION-1 (2026-09-11) · this loader used to populate
 * `LiveWeek.isRaceWeek` purely from the raw `plan_weeks.is_race_week` column
 * — the GOAL race's week and nothing else (`race-week.ts`'s own header) —
 * and that was the ONLY race signal `adjudicate.ts`'s functions ever saw for
 * a real, live block: a B/C tune-up race embedded mid-block was invisible to
 * `detectStackedStress`'s "a race is not a training long run" null-out and
 * to `checkPromotion`'s `executionIdentity` gate, both of which read
 * `PlannedWeek.isRaceWeek` before this pass added `containsRace`.
 *
 * Fixed by computing `containsRace` per week via the shared
 * `weekContainsRace` detector (`race-week.ts`) over the week's own rows —
 * exactly the day-level `type === 'race'` check `v5-block.ts`'s `weekFlag`
 * already uses for the same question — rather than growing a second
 * definition here. `isRaceWeek` itself is untouched and stays goal-only,
 * because several `adjudicate.ts` sites (the window-filter refusal, the
 * PRESCRIBED_RECOVERY free pass, taper integrity) deliberately need THAT
 * narrower answer.
 */
export function withContainsRace<T extends LiveWeek>(wk: T): T {
  return {
    ...wk,
    containsRace: weekContainsRace({
      isRaceWeek: wk.isRaceWeek,
      days: wk.rows.map((r) => ({ type: r.type })),
    }),
  };
}

export async function loadPlannedWeeks(userUuid: string): Promise<SequenceRead> {
  const rows = await rowsOrNull<{
    id: string;
    date_iso: string;
    type: string;
    distance_mi: string | number | null;
    sub_label: string | null;
    is_quality: boolean | null;
    is_long: boolean | null;
    is_race_week: boolean | null;
    is_cutback: boolean | null;
    phase_label: string | null;
    plan_id: string;
    last_adapted_at: Date | null;
  }>(
    'adjudication/live-sequence · active block',
    pool.query(
      `SELECT pw.id::text AS id, pw.date_iso::text AS date_iso, pw.type,
              pw.distance_mi, pw.sub_label, pw.is_quality, pw.is_long,
              w.is_race_week, w.is_cutback, ph.label AS phase_label
         FROM plan_workouts pw
         JOIN training_plans tp ON tp.id = pw.plan_id
    LEFT JOIN plan_weeks w ON w.id = pw.week_id
    LEFT JOIN plan_phases ph ON ph.id = w.phase_id
        WHERE tp.user_uuid = $1::uuid
          AND tp.archived_iso IS NULL
        ORDER BY pw.date_iso ASC`,
      [userUuid],
    ),
  );

  // Rule 11 · three facts. A failed read is not an empty block, and an empty
  // block is not a block with no findings.
  if (rows === null) return { ok: false, why: 'the plan read failed' };
  if (rows.length === 0) return { ok: false, why: 'no active plan' };

  const byWeek = new Map<string, LiveWeek & { rows: LiveWeek['rows'][number][] }>();
  for (const r of rows) {
    const start = mondayOf(r.date_iso);
    if (start === null) continue;
    const mi = r.distance_mi === null ? 0 : Number(r.distance_mi);
    const stressor = stressorNameOf(r.type, r.sub_label, r.is_quality, r.is_long);
    let wk = byWeek.get(start);
    if (!wk) {
      wk = {
        weekStartISO: start,
        weeklyMi: 0,
        longestMi: 0,
        stressors: [],
        mpMi: 0,
        isTaper: (r.phase_label ?? '').toLowerCase().includes('taper'),
        isRaceWeek: r.is_race_week === true,
        rows: [],
      } as LiveWeek & { rows: LiveWeek['rows'][number][] };
      byWeek.set(start, wk);
    }
    const mutable = wk as unknown as {
      weeklyMi: number; longestMi: number; stressors: string[];
      isTaper: boolean; isRaceWeek: boolean; rows: LiveWeek['rows'][number][];
    };
    mutable.weeklyMi = Math.round((mutable.weeklyMi + mi) * 10) / 10;
    if (mi > mutable.longestMi) mutable.longestMi = mi;
    if (stressor) mutable.stressors.push(stressor);
    if (r.is_race_week === true) mutable.isRaceWeek = true;
    if ((r.phase_label ?? '').toLowerCase().includes('taper')) mutable.isTaper = true;
    mutable.rows.push({
      id: r.id, dateISO: r.date_iso, type: r.type, distanceMi: mi, stressor,
    });
  }

  return {
    ok: true,
    weeks: [...byWeek.values()].map(withContainsRace)
      .sort((a, b) => a.weekStartISO.localeCompare(b.weekStartISO)),
    planId: rows[0].plan_id,
    planVersion: planVersionOf({ id: rows[0].plan_id, last_adapted_at: rows[0].last_adapted_at }),
  };
}

export interface SequenceFinding {
  readonly weekStartISO: string;
  readonly why: string;
  readonly volumeStep: number;
  readonly stressorsBefore: number;
  readonly stressorsAfter: number;
  /** The session a proposal would change, and why that one. */
  readonly targetRowId: string;
  readonly targetDateISO: string;
  readonly targetType: string;
}

/**
 * Every FUTURE week that adds mileage and intensity at once.
 *
 * Past weeks are excluded deliberately, and not to be tidy: a finding about a
 * week the runner has already run is not a decision, it is a complaint. The
 * whole layer exists to change what happens next.
 */
export function findSequenceFindings(
  weeks: readonly LiveWeek[],
  todayISO: string,
): readonly SequenceFinding[] {
  const out: SequenceFinding[] = [];
  for (let i = 0; i < weeks.length; i += 1) {
    const wk = weeks[i];
    if (wk.weekStartISO <= todayISO) continue;
    const hit = detectSimultaneousStressAddition(wk, weeks.slice(0, i));
    if (hit == null) continue;

    /* WHICH SESSION TO NAME.
     *
     * The cheapest arithmetic fix is to shave easy miles until the volume step
     * falls under the bar. That is rejected on doctrine, not on taste:
     * CLAUDE.md Rule 12 says easy running is sized FIRST and quality fits into
     * what remains, so taking miles out of the aerobic base to protect a
     * quality session is backwards. It also leaves the one-at-a-time violation
     * exactly where it was — it fixes the number the check measures rather than
     * the thing the check is about.
     *
     * So the target is a STRESSOR, and of the stressors it is the one whose
     * removal costs the block least: never a race the runner entered, never the
     * long run — that is the aerobic spine of a marathon block and cutting it to
     * satisfy an intensity check would be Rule 12's mistake in a second costume
     * — and among what remains the largest, since that is the session
     * contributing most to both halves of the violation at once. */
    const candidates = wk.rows
      .filter((r) => r.stressor != null
        && r.stressor !== 'race'
        && r.stressor !== 'long'
        && r.stressor !== 'fast-finish long')
      .sort((a, b) => b.distanceMi - a.distanceMi);
    const target = candidates[0];
    if (!target) continue;   // every stressor is a race · not ours to move

    out.push({
      weekStartISO: wk.weekStartISO,
      why: hit.why,
      volumeStep: hit.volumeStep,
      stressorsBefore: hit.stressorsBefore,
      stressorsAfter: hit.stressorsAfter,
      targetRowId: target.id,
      targetDateISO: target.dateISO,
      targetType: target.type,
    });
  }
  return out;
}

/** Monday of the week containing `iso`, or null when it will not parse. */
function mondayOf(iso: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const shift = (d.getUTCDay() + 6) % 7;   // Monday = 0
  d.setUTCDate(d.getUTCDate() - shift);
  return d.toISOString().slice(0, 10);
}
