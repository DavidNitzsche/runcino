/**
 * lib/brain/ledger/outcome-sweep.ts · STEP 16, ON THE NIGHTLY PATH.
 *
 * Reads decisions whose observation window has closed and which carry no
 * verdict yet, judges each with `assessOutcome`, and records the answer.
 *
 * ── RULE 23 ────────────────────────────────────────────────────────────────
 *
 * Due-ness is a DATE COMPARISON, never a clock hour, so a sweep that runs ten
 * hours late finds the same set and does the same work. The idempotency key is
 * the decision plus its window, so running twice in one night updates one row
 * rather than growing two.
 *
 * ── RULE 11 ────────────────────────────────────────────────────────────────
 *
 * Three answers, and the caller branches. `table_absent` is the honest state
 * while migrations 166 and 168 are unapplied — it is neither an empty queue nor
 * a failure, and reporting it as either would make the loop look closed when it
 * is not.
 */

import { pool } from '@/lib/db/pool';
import { attempt } from '@/lib/db/read';
import { assessOutcome, type DecisionPrediction, type ObservedAftermath } from './outcome';

export const PLAN_DECISION_OUTCOME_TABLE = 'plan_decision_outcome';

/** How long after a decision its result becomes readable. */
export const OUTCOME_WINDOW_DAYS = 14;

export type SweepResult =
  | { readonly state: 'ok'; readonly evaluated: number; readonly byVerdict: Record<string, number> }
  | { readonly state: 'table_absent'; readonly why: string }
  | { readonly state: 'failed'; readonly why: string };

interface DueDecision {
  readonly id: string;
  readonly user_uuid: string;
  readonly plan_lineage_id: string;
  readonly lever: string;
  readonly decision: string;
  readonly direction: 'UP' | 'DOWN' | 'NEUTRAL' | 'UNKNOWN';
  readonly runner_response: string | null;
  readonly mutation_outcome: string | null;
  readonly at: Date;
}

/**
 * Judge every decision old enough to have an answer.
 *
 * `observe` is injected so the sweep can be exercised without a plan reader,
 * and so the aftermath reader has ONE owner rather than this file growing its
 * own (Rule 16). A reader that cannot answer returns nulls, and the classifier
 * turns those into UNRESOLVED with a stated reason rather than a verdict.
 */
export async function sweepDecisionOutcomes(
  todayISO: string,
  observe: (d: DueDecision, fromISO: string, toISO: string) => Promise<ObservedAftermath>,
  limit = 50,
): Promise<SweepResult> {
  const probe = await attempt(
    'ledger/outcome-sweep · table probe',
    pool.query<{ reg: string | null }>(
      `SELECT to_regclass('public.${PLAN_DECISION_OUTCOME_TABLE}')::text AS reg`,
    ),
  );
  if (!probe.ok) {
    return { state: 'failed', why: 'the outcome table could not be checked for' };
  }
  if (probe.value.rows[0]?.reg == null) {
    return {
      state: 'table_absent',
      why: `${PLAN_DECISION_OUTCOME_TABLE} does not exist on this database, so no decision has `
        + 'been judged. Migration 168 has not been applied here. That is not a sweep that found '
        + 'nothing to do.',
    };
  }

  const due = await attempt(
    'ledger/outcome-sweep · due decisions',
    pool.query<DueDecision>(
      `SELECT l.id, l.user_uuid::text AS user_uuid, l.plan_lineage_id, l.lever,
              l.decision, l.direction, l.runner_response, l.mutation_outcome, l.at
         FROM plan_decision_ledger l
    LEFT JOIN plan_decision_outcome o
           ON o.decision_id = l.id
          AND o.idempotency_key = 'w' || $2::text
        WHERE l.at::date <= ($1::date - $2::int)
          AND l.undone_at IS NULL
          AND o.id IS NULL
        ORDER BY l.at ASC
        LIMIT $3`,
      [todayISO, OUTCOME_WINDOW_DAYS, limit],
    ),
  );
  if (!due.ok) return { state: 'failed', why: 'the due-decision read failed' };

  const byVerdict: Record<string, number> = {};
  let evaluated = 0;

  for (const d of due.value.rows) {
    const fromISO = d.at.toISOString().slice(0, 10);
    const toISO = addDays(fromISO, OUTCOME_WINDOW_DAYS);
    const aftermath = await observe(d, fromISO, toISO);

    const prediction: DecisionPrediction = {
      lever: d.lever,
      chosenOption: d.decision,
      rejectedOptions: [],
      expectedDirection: d.direction,
      beforeValue: null,
      afterValue: null,
      // Applied means the plan actually moved. A declined proposal, an expired
      // one, or a mutation the boundary refused all read as not applied.
      applied: d.mutation_outcome === 'applied',
    };

    const a = assessOutcome(prediction, aftermath);
    const w = await attempt(
      'ledger/outcome-sweep · write verdict',
      pool.query(
        `INSERT INTO plan_decision_outcome (
           decision_id, user_uuid, plan_lineage_id, lever, chosen_option,
           rejected_options, expected_direction, prediction,
           observed_from_iso, observed_to_iso,
           subsequent_execution, verdict, verdict_because, unresolved_reason,
           confidence, idempotency_key
         ) VALUES (
           $1::uuid, $2::uuid, $3, $4, $5,
           $6::jsonb, $7, $8::jsonb,
           $9::date, $10::date,
           $11::jsonb, $12, $13, $14,
           $15, $16
         )
         ON CONFLICT (decision_id, idempotency_key) DO UPDATE SET
           verdict = EXCLUDED.verdict,
           verdict_because = EXCLUDED.verdict_because,
           unresolved_reason = EXCLUDED.unresolved_reason,
           confidence = EXCLUDED.confidence,
           evaluated_at = now()`,
        [
          d.id, d.user_uuid, d.plan_lineage_id, d.lever, d.decision,
          JSON.stringify(prediction.rejectedOptions), d.direction, JSON.stringify(prediction),
          fromISO, toISO,
          JSON.stringify(aftermath), a.verdict, a.because, a.unresolvedReason,
          a.confidence, `w${OUTCOME_WINDOW_DAYS}`,
        ],
      ),
    );
    if (!w.ok) {
      // Rule 11 · one failed write is not a clean sweep. Reported, not counted.
      console.error(`[outcome-sweep] verdict write failed for decision ${d.id}`);
      continue;
    }
    evaluated += 1;
    byVerdict[a.verdict] = (byVerdict[a.verdict] ?? 0) + 1;
  }

  return { state: 'ok', evaluated, byVerdict };
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * THE MEASUREMENT PATH'S OWN REPORT · how its decisions turned out.
 *
 * The reason `verdict` is a column and not a log line. Rule 21's census had to
 * be reconstructed sideways out of `coach_intents` because nothing recorded
 * what the engine had decided; this is the same question one level further on —
 * not "did it push" but "was it right to".
 *
 * Read, not acted on. Nothing tunes off it, by instruction.
 */
export type OutcomeCensus =
  | { readonly state: 'ok'; readonly byVerdict: Record<string, number>; readonly total: number }
  | { readonly state: 'table_absent'; readonly why: string }
  | { readonly state: 'failed'; readonly why: string };

export async function outcomeCensus(userUuid: string | null = null): Promise<OutcomeCensus> {
  const r = await attempt(
    'ledger/outcome-census',
    userUuid === null
      ? pool.query<{ verdict: string; n: string }>(
        `SELECT verdict, count(*)::text AS n FROM plan_decision_outcome GROUP BY verdict`,
      )
      : pool.query<{ verdict: string; n: string }>(
        `SELECT verdict, count(*)::text AS n FROM plan_decision_outcome
          WHERE user_uuid = $1::uuid GROUP BY verdict`,
        [userUuid],
      ),
  );
  if (!r.ok) {
    // Rule 11 · a census that could not run is not a census of zero. The
    // distinction matters most here: "no decision has been judged" and "the
    // judgements could not be read" would both print as an empty table.
    return { state: 'failed', why: 'the outcome census read failed' };
  }
  const byVerdict: Record<string, number> = {};
  let total = 0;
  for (const row of r.value.rows) {
    const n = Number(row.n);
    byVerdict[row.verdict] = n;
    total += n;
  }
  return { state: 'ok', byVerdict, total };
}
