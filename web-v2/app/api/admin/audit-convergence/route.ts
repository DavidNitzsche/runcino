/**
 * GET /api/admin/audit-convergence?days=90
 *
 * READ-ONLY diagnostic · replays `gradeConvergence()` over the runner's own
 * history, one day at a time, and reports how often readiness actually graded
 * green / amber / red — and, for the red days, whether a quality session was
 * scheduled (which is what decides whether a red morning would have been a
 * plan DOWNGRADE or merely a recorded note).
 *
 * WHY THIS EXISTS (2026-08-29): the auto-apply lane's convergent-red pullback
 * is the one adaptation that changes today's session without asking. Deciding
 * whether that is the right posture is a judgement about frequency — a rule
 * that fires twice a season reads very differently from one that fires weekly
 * — and nothing in the app could answer "how often would this have fired".
 * This answers it from real data instead of from the thresholds on paper.
 *
 * It is a REPLAY, not a reimplementation. Every number comes from the same
 * three production functions the nightly cron uses:
 *   · `loadConvergenceSeries`  (lib/coach/convergence-loader.ts)
 *   · `loadConvergenceContext` (lib/coach/convergence-loader.ts)
 *   · `gradeConvergence`       (lib/coach/convergence.ts)
 * all three of which take the as-of date as a parameter, so asking them about
 * 2026-06-01 gives exactly the verdict the cron would have reached that
 * morning. The subjective domain replays too: `loadYesterdaySignals` takes the
 * same optional as-of date, so all five domains are honest rather than four
 * honest and one held at false.
 *
 * NON-MUTATING. No writes, no plan changes, no coach_intents rows — it only
 * reads. Per CLAUDE.md's operational doctrine this is an agent-built,
 * caller-scoped, read-only diagnostic: self-execute, surface the result.
 *
 * Caveats worth reading before trusting a count:
 *   · The scheduled-quality check reads TODAY'S plan rows. A past day whose
 *     plan has since been edited (or whose plan was archived after a race)
 *     reports against what the plan says now, not what it said that morning.
 *     Grades themselves are unaffected — only the would-downgrade-vs-note
 *     split is. Reported as `qualityScheduledKnown: false` where the day has
 *     no live plan row to read at all.
 *   · Days before the account had `minBaselineDays` (14) of history grade
 *     green by construction (cold start), and are counted separately so they
 *     do not read as "calm".
 */

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireAdmin } from '@/lib/auth/session';
import { runnerToday } from '@/lib/runtime/runner-tz';
import {
  loadConvergenceSeries,
  loadConvergenceContext,
  dateAxis,
} from '@/lib/coach/convergence-loader';
import { gradeConvergence, CONVERGENCE, type ConvergenceGrade } from '@/lib/coach/convergence';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Window bounds. 90 days answers "this season"; 365 is the whole year. */
const DEFAULT_DAYS = 90;
const MAX_DAYS = 365;

/** Days replayed at once. Each day is several queries; unbounded
 *  Promise.all over a year would open hundreds of connections at once. */
const CONCURRENCY = 6;

/** The quality types the red branch looks for — kept identical to
 *  `adapt.ts`'s `todayKey` query so the split reported here matches the
 *  branch it is describing. */
const QUALITY_TYPES = ['threshold', 'tempo', 'intervals', 'vo2max', 'long'];

interface DayVerdict {
  date: string;
  grade: ConvergenceGrade;
  converging: string[];
  /** Domains that met threshold but were filtered out, with the reason. */
  suppressed: Array<{ domain: string; by: string }>;
  coldStart: boolean;
  rationale: string;
  /** Null when the day has no live plan row at all (see caveats). */
  qualityScheduled: boolean | null;
  /** What the red branch would have emitted, per adapt.ts:4227-4283. */
  wouldHaveDone: 'downgrade' | 'note' | null;
}

async function verdictFor(userId: string, dateISO: string): Promise<DayVerdict> {
  // The subjective domain, replayed as of this date rather than held false.
  let subjectiveWreckedOnEasy = false;
  try {
    const { loadYesterdaySignals, subjectivePullbackSignal } =
      await import('@/lib/coach/acknowledge');
    subjectiveWreckedOnEasy =
      subjectivePullbackSignal(await loadYesterdaySignals(userId, dateISO)).fired;
  } catch { /* objective domains still decide · same posture as adapt.ts */ }

  const [series, context] = await Promise.all([
    loadConvergenceSeries(userId, dateISO, { subjectiveWreckedOnEasy }),
    loadConvergenceContext(userId, dateISO),
  ]);
  const v = gradeConvergence(series, context);

  // Was a hard session on the calendar that day? Same predicate as the red
  // branch's `todayKey`. `rowCount === 0` is ambiguous between "rest day" and
  // "plan no longer covers this date", so distinguish: if the runner has NO
  // active plan row anywhere near this date, report unknown rather than false.
  //
  // SWALLOW-1 (2026-08-29) · a failed query is UNKNOWN, never "no".
  //
  // Both reads used to end `.catch(() => ({ rows: [] }))`, and an empty result
  // is not what a failure means here. If the quality probe threw while the
  // any-row probe succeeded, the expression below read "the runner had a
  // session that day and it was not a quality one" — a fabricated false, from
  // a query that never answered. `lib/audit/_swallow_scan.test.ts` names this
  // shape and asks for the honest sentence; the honest sentence is that this
  // route cannot tell, which the return type already has a value for.
  const scheduled = async (): Promise<boolean | null> => {
    const q = await pool.query<{ id: string }>(
      `SELECT pw.id FROM plan_workouts pw
         JOIN training_plans tp ON tp.id = pw.plan_id
        WHERE tp.user_uuid = $1 AND tp.archived_iso IS NULL
          AND pw.type = ANY($3::text[])
          AND pw.date_iso = $2::text
        LIMIT 1`,
      [userId, dateISO, QUALITY_TYPES],
    );
    if (q.rows.length > 0) return true;
    // `rowCount === 0` is ambiguous between "rest day" and "plan no longer
    // covers this date", so distinguish: if the runner has NO active plan row
    // anywhere near this date, report unknown rather than false.
    const anyRow = await pool.query<{ id: string }>(
      `SELECT pw.id FROM plan_workouts pw
         JOIN training_plans tp ON tp.id = pw.plan_id
        WHERE tp.user_uuid = $1 AND tp.archived_iso IS NULL
          AND pw.date_iso = $2::text
        LIMIT 1`,
      [userId, dateISO],
    );
    return anyRow.rows.length > 0 ? false : null;
  };
  const qualityScheduled: boolean | null = await scheduled().catch(() => null);

  return {
    date: dateISO,
    grade: v.grade,
    converging: v.converging,
    suppressed: v.domains
      .filter((d) => d.dragging && d.suppressedBy != null)
      .map((d) => ({ domain: d.domain, by: d.suppressedBy as string })),
    coldStart: series.baselineDays < CONVERGENCE.minBaselineDays,
    rationale: v.rationale,
    qualityScheduled,
    wouldHaveDone: v.grade !== 'red' ? null : (qualityScheduled ? 'downgrade' : 'note'),
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const url = new URL(req.url);
  const raw = Number(url.searchParams.get('days') ?? DEFAULT_DAYS);
  const days = Math.max(1, Math.min(MAX_DAYS, Number.isFinite(raw) ? Math.floor(raw) : DEFAULT_DAYS));

  try {
    const today = await runnerToday(userId);
    const axis = dateAxis(today, days);

    const results: DayVerdict[] = [];
    for (let i = 0; i < axis.length; i += CONCURRENCY) {
      const batch = axis.slice(i, i + CONCURRENCY);
      results.push(...await Promise.all(batch.map((d) => verdictFor(userId, d))));
    }

    const warm = results.filter((r) => !r.coldStart);
    const red = warm.filter((r) => r.grade === 'red');
    const amber = warm.filter((r) => r.grade === 'amber');
    const wouldDowngrade = red.filter((r) => r.wouldHaveDone === 'downgrade');

    // How often each domain actually carried a vote, and how often one was
    // filtered out — the per-finding context filters doing visible work.
    const domainCounts: Record<string, number> = {};
    const suppressionCounts: Record<string, number> = {};
    for (const r of warm) {
      for (const d of r.converging) domainCounts[d] = (domainCounts[d] ?? 0) + 1;
      for (const s of r.suppressed) {
        const k = `${s.domain} · ${s.by}`;
        suppressionCounts[k] = (suppressionCounts[k] ?? 0) + 1;
      }
    }

    return NextResponse.json({
      userId,
      window: { days, from: axis[0], to: axis[axis.length - 1] },
      thresholds: {
        redMinDomains: CONVERGENCE.redMinDomains,
        amberMinDomains: CONVERGENCE.amberMinDomains,
        minBaselineDays: CONVERGENCE.minBaselineDays,
      },
      summary: {
        daysReplayed: results.length,
        coldStartDays: results.length - warm.length,
        gradedDays: warm.length,
        green: warm.filter((r) => r.grade === 'green').length,
        amber: amber.length,
        red: red.length,
        // The number the auto-apply question actually turns on.
        wouldHaveAutoDowngraded: wouldDowngrade.length,
        wouldHaveBeenNoteOnly: red.length - wouldDowngrade.length,
      },
      domainVoteCounts: domainCounts,
      suppressionCounts,
      redDays: red,
      amberDays: amber,
      // Full series last · the summary is the answer, this is the working.
      allDays: results,
      legend: {
        wouldHaveAutoDowngraded:
          "red convergence WITH a quality session scheduled · adapt.ts's downgrade branch, " +
          'the only readiness action that changes a session without asking',
        wouldHaveBeenNoteOnly:
          'red convergence on a day with nothing hard scheduled · recorded, no plan change',
        coldStartDays:
          `fewer than ${CONVERGENCE.minBaselineDays} baseline days · graded green by construction, ` +
          'counted separately so they do not read as calm',
        suppressionCounts:
          'domain met its threshold but a context filter (travel, illness, post-race, alcohol, heat) ' +
          'disqualified its vote · per-finding filters, CLAUDE.md locked 2026-05-19 round 4',
      },
    }, {
      headers: { 'Cache-Control': 'private, no-cache, must-revalidate' },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
