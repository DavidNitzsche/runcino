/* READ-ONLY. Replay the wave-2 cross-check across a real 45-day window.
 *
 * The prior pass validated ONE day (2026-09-13) and reported "agrees within
 * threshold". This asks the question that day cannot answer: how STABLE is the
 * cross-check, and how often would it refuse, against a legacy anchor that is
 * mechanically frozen? It also measures evidence-set churn, which is the input
 * an evidence-identity dedup key would hash. */
import { pool } from '@/lib/db/pool';

const USER = '0645f40c-951d-4ccc-b86e-9979cd26c795';

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const cols = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'coach_intents' ORDER BY ordinal_position`,
  );
  console.log('coach_intents columns:', cols.rows.map((r) => r.column_name).join(', '));

  const reasons = await pool.query<{ reason: string; n: string }>(
    `SELECT reason, count(*)::text AS n FROM coach_intents WHERE user_uuid = $1::uuid
      GROUP BY reason ORDER BY 2 DESC LIMIT 30`, [USER],
  ).catch(() => ({ rows: [] as { reason: string; n: string }[] }));
  console.log('\n--- coach_intents reasons ---');
  for (const r of reasons.rows) console.log(`${r.n.padStart(5)}  ${r.reason}`);

  const { resolveThresholdCapacity } = await import('@/lib/training/capacity-resolver');
  const { decideCurrentFitness } = await import('@/lib/training/resolve-current-fitness');
  const { anchorVdotFromState } = await import('@/lib/training/pace-anchor');

  const anchorRow = (await pool.query<{ reviewed: string | null; authored_state: Record<string, unknown> | null }>(
    `SELECT (SELECT vdot_last_reviewed::numeric::text FROM users WHERE id = $1::uuid) AS reviewed,
            tp.authored_state
       FROM training_plans tp
      WHERE tp.user_uuid = $1::uuid AND tp.archived_iso IS NULL
      ORDER BY tp.authored_iso DESC LIMIT 1`, [USER],
  )).rows[0];
  const cascade = anchorVdotFromState(anchorRow.reviewed, anchorRow.authored_state);
  console.log(`\nlegacy cascade (frozen) = ${cascade}  [reviewed=${anchorRow.reviewed}]`);

  const start = '2026-07-31';
  let prevIds = '';
  let refusals = 0; let answers = 0; let churn = 0; let days = 0;
  console.log('\ndate        vdot   pace  conf   mode          delta   verdict   evidence-set');
  for (let i = 0; i <= 44; i++) {
    const day = addDays(start, i);
    let est;
    try { est = await resolveThresholdCapacity(USER, day); } catch (e) {
      console.log(`${day}  RESOLVER THREW: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    days++;
    const r = decideCurrentFitness(
      {
        vdot: est.vdot, paceSecPerMi: est.paceSecPerMi, confidence: est.confidence,
        sourceMode: est.sourceMode, reasons: est.reasons, evidenceIds: est.evidenceIds,
        resolvedAt: est.resolvedAt,
      },
      { status: 'ok', snapshot: { reviewedVdot: Number(anchorRow.reviewed), authoredStateVdot: null, cascadeVdot: cascade } },
    );
    const ids = [...est.evidenceIds].sort().join(',');
    const changed = prevIds !== '' && ids !== prevIds;
    if (changed) churn++;
    prevIds = ids;
    if (r.ok) answers++; else refusals++;
    const delta = r.provenance.deltaVdot;
    console.log(
      `${day}  ${String(est.vdot ?? 'null').padStart(5)}  ${String(est.paceSecPerMi).padStart(4)}  `
      + `${est.confidence.toFixed(2)}  ${est.sourceMode.padEnd(12)}  `
      + `${(delta == null ? 'n/a' : delta.toFixed(2)).padStart(6)}  `
      + `${(r.ok ? 'ok' : `REFUSE:${r.reason}`).padEnd(32)}  `
      + `${est.evidenceIds.length}${changed ? ' *CHANGED*' : ''}`,
    );
  }
  console.log(`\nSUMMARY over ${days} days: ok=${answers}  refuse=${refusals}  evidence-set changes=${churn}`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
