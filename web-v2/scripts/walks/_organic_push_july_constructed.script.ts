/**
 * scripts/walks/_organic_push_july_constructed.script.ts
 *
 * A CONSTRUCTED, PRODUCTION-SHAPED TEST CASE. NOT HISTORY.
 * =======================================================
 *
 * READ THIS BEFORE QUOTING ANY NUMBER OUT OF THIS FILE.
 *
 * Phase A of this walk replays a REAL historical decision: week 2026-07-06,
 * evaluated as of 2026-07-05, against a scratch copy of the owner's real
 * production rows restricted to the state that genuinely existed on that date
 * (`faff_push_walk_jul`, built in the round-3 pass). Phase A's outcome is a
 * real fact about the owner's real training history.
 *
 * Phase B is NOT. Phase B inserts ONE synthetic run row on 2026-07-01 — a day
 * the owner did not run — and re-runs the same decision. Nothing in Phase B
 * happened. It exists to answer one narrow, mechanical question:
 *
 *     Is the PUSH path DORMANT, or is it BROKEN?
 *
 * Rule 21 measured zero upward adaptations in 309 real production intents, and
 * "wired, tested and inert" is this codebase's signature failure. A mechanism
 * that never fires and a mechanism that CANNOT fire are different defects with
 * different fixes, and nothing in the owner's real history separates them.
 * One deliberately-crossed threshold does.
 *
 * WHAT IS ADJUSTED, AND WHY IT IS EXACTLY ONE THING
 * ------------------------------------------------
 * The owner ran on 2026-06-27 and then not again until 2026-07-06. Counting the
 * days between them, and excluding prescribed taper/race/post-race days per
 * Rule 8, `readDisruption` (lib/safety/load-safety.ts) counts EIGHT no-run days.
 * `DISRUPTION_MIN_GAP_DAYS` is 8. The signal fires at exactly its own edge.
 *
 * Phase B inserts one run on 2026-07-01, which splits that eight-day gap into a
 * three-day gap and a four-day gap. Both are below 8. Nothing else is touched:
 * no threshold is moved, no guard is weakened, no verdict is seeded, no belief
 * is written. The inserted row is a byte-for-byte clone of the owner's own real
 * 2026-06-25 run — real distance, real heart rate, real phases — re-dated. It is
 * a realistic run, not a magic one.
 *
 * WHAT THIS CANNOT PROVE (Rule 22)
 * --------------------------------
 * · It cannot prove the owner would ever organically reach a PUSH. It proves
 *   only that the code path completes when the input crosses the real threshold.
 * · It cannot prove anything about the OTHER two push axes (`tryAdaptiveBump`,
 *   `progression-pass`). It exercises the option lane's volume axis only.
 * · Phase A passing does not validate the substrate beyond the boundary and
 *   option-lane reads; the substrate is a partial copy, not production.
 *
 * SAFETY
 * ------
 * Loopback scratch database only. `vitest.setup.ts` arms the production write
 * barrier, and `DATABASE_URL` must be exported to the scratch database BEFORE
 * this runs or the setup's `.env.local` load would supply production.
 *
 *   DATABASE_URL=postgresql://127.0.0.1:5432/faff_push_walk_jul \
 *   DATABASE_URL_RO=postgresql://127.0.0.1:5432/faff_push_walk_jul \
 *   FAFF_VERIFICATION=1 FAFF_DB_TARGET=local \
 *     npx vitest run --config vitest.july-constructed.config.ts --disable-console-intercept
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { pool } from '@/lib/db/pool';

const UID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const WEEK = '2026-07-06';
const AS_OF = new Date('2026-07-05T19:00:00Z'); // midday PDT on 2026-07-05

/** Deliberately out of the real id range so it is unmistakably synthetic and
 *  one DELETE removes it completely. */
const SYNTHETIC_RUN_ID = 999_000_000_001;
const CLONE_SOURCE_DATE = '2026-06-25';
const SYNTHETIC_DATE = '2026-07-01';

function refuseIfNotLoopback(): void {
  const url = process.env.DATABASE_URL ?? '';
  if (!/(^|@|\/\/)(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url)) {
    throw new Error(
      `[july-constructed] REFUSING TO RUN · DATABASE_URL is not loopback: ${url.replace(/:[^:@/]*@/, ':***@')}`,
    );
  }
}

async function resetLaneOutput(): Promise<void> {
  await pool.query(`DELETE FROM reassessment_schedule WHERE payload->>'weekStartISO' = $1`, [WEEK]);
  await pool.query(`DELETE FROM plan_decision_ledger WHERE idempotency_key LIKE '%OPTION_LANE%'`);
  await pool.query(`DELETE FROM plan_workout_proposals WHERE evidence ? 'decision_id'`);
}

async function fireCron(): Promise<Record<string, unknown>> {
  const { POST } = await import('@/app/api/cron/run-adaptations/route');
  const { NextRequest } = await import('next/server');
  const req = new NextRequest('http://localhost/api/cron/run-adaptations', {
    method: 'POST', headers: { authorization: 'Bearer probe-secret' },
  });
  return await (await POST(req)).json() as Record<string, unknown>;
}

type LaneOutcome = {
  chosen: string | null;
  because: string | null;
  withheld: string[];
  boundary: string | null;
};

/** Two nightly passes, exactly as production does it: one schedules the
 *  boundary, the next resolves it and decides. */
async function decideOrganically(): Promise<LaneOutcome> {
  await fireCron();
  const body = await fireCron();
  const lane = body.option_lane as { reports?: Array<Record<string, unknown>> } | undefined;
  const r = lane?.reports?.[0] ?? {};
  const trace = r.trace as { chosen?: string; because?: string } | null;
  const rb = body.rolling_boundaries as unknown;
  return {
    chosen: trace?.chosen ?? null,
    because: trace?.because ?? null,
    withheld: (r.withheld as string[]) ?? [],
    boundary: rb === undefined ? null : JSON.stringify(rb).slice(0, 600),
  };
}

/** Read the safety chain the same way production's option lane does. */
async function safetyLine(): Promise<string> {
  const { resolveSafety } = await import('@/lib/safety/load-safety');
  const { resolveTrainingSafety } = await import('@/lib/safety/training-safety');
  const res = await resolveSafety(UID, { todayISO: '2026-07-05' });
  const ts = resolveTrainingSafety(res);
  const gap = res.known && res.disruption
    ? `gapDays=${res.disruption.gapDays}`
    : 'no disruption signal';
  return `${ts.posture} · ${gap} · ${res.explain}`;
}

async function insertSyntheticRun(): Promise<void> {
  const r = await pool.query<{ n: string }>(
    /* The clone carries no per-stream detail: it is NULL on the source row, so
     * copying it would move nothing, and NOT naming that column keeps this
     * script out of `_generated_content_gate.test.ts` GUARD 1's writer set —
     * a script that writes an authored-content column would owe the registry
     * an entry, and inventing one to pass a gate is exactly what Rule 18
     * forbids. */
    `INSERT INTO runs (id, data, fetched_at, user_uuid, provenance)
     SELECT $1::bigint,
            jsonb_set(
              jsonb_set(data, '{date}', to_jsonb($2::text)),
              '{id}', to_jsonb(($3::text || '-' || $2::text))
            ) - 'startLocal' - 'mergedIntoId',
            fetched_at, user_uuid, provenance
       FROM runs
      WHERE user_uuid = $3::uuid
        AND data->>'date' = $4
        AND NOT (data ? 'mergedIntoId')
      LIMIT 1
     RETURNING id::text AS n`,
    [SYNTHETIC_RUN_ID, SYNTHETIC_DATE, UID, CLONE_SOURCE_DATE],
  );
  if (r.rows.length !== 1) throw new Error('[july-constructed] clone source row not found');
}

async function removeSyntheticRun(): Promise<void> {
  await pool.query('DELETE FROM runs WHERE id = $1::bigint', [SYNTHETIC_RUN_ID]);
}

describe('July 6 · constructed production-shaped PUSH case', () => {
  const log: string[] = [];

  beforeAll(async () => {
    refuseIfNotLoopback();
    await removeSyntheticRun(); // idempotent: never start on a dirty substrate
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AS_OF);
    process.env.CRON_SECRET = 'probe-secret';
  });

  afterAll(async () => {
    vi.useRealTimers();
    // eslint-disable-next-line no-console
    console.log(`\n===== July 6 constructed case =====\n${log.join('\n')}\n`);
  });

  it('PHASE A (REAL HISTORY) · the unmodified substrate reproduces HOLD', async () => {
    const safety = await safetyLine();
    await resetLaneOutput();
    const out = await decideOrganically();
    log.push(`PHASE A · REAL · safety ${safety}`);
    log.push(`PHASE A · REAL · chosen=${out.chosen} withheld=${JSON.stringify(out.withheld)}`);
    log.push(`PHASE A · REAL · because=${out.because}`);

    expect(safety).toContain('CONSTRAINED');
    expect(safety).toContain('gapDays=8');
    expect(out.chosen).toBe('HOLD');
  }, 600_000);

  it('PHASE B (CONSTRUCTED, NOT HISTORY) · one run inside the gap flips it to PUSH', async () => {
    await insertSyntheticRun();
    const safety = await safetyLine();
    await resetLaneOutput();
    const out = await decideOrganically();
    log.push('');
    log.push(`PHASE B · CONSTRUCTED · safety ${safety}`);
    log.push(`PHASE B · CONSTRUCTED · chosen=${out.chosen} withheld=${JSON.stringify(out.withheld)}`);
    log.push(`PHASE B · CONSTRUCTED · because=${out.because}`);

    // The ONE adjusted input did what it was adjusted to do, and nothing else.
    expect(safety).toContain('NORMAL');
    expect(safety).toContain('no disruption signal');
    expect(out.chosen).toBe('PUSH');
  }, 600_000);

  it('PHASE C (FALSIFICATION) · removing the synthetic run restores HOLD', async () => {
    await removeSyntheticRun();
    const safety = await safetyLine();
    await resetLaneOutput();
    const out = await decideOrganically();
    log.push('');
    log.push(`PHASE C · RESTORED · safety ${safety}`);
    log.push(`PHASE C · RESTORED · chosen=${out.chosen} withheld=${JSON.stringify(out.withheld)}`);

    expect(safety).toContain('CONSTRAINED');
    expect(out.chosen).toBe('HOLD');
  }, 600_000);
});
