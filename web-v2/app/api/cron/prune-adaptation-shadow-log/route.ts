/**
 * POST /api/cron/prune-adaptation-shadow-log
 *
 * Retention for `adaptation_shadow_log` (`db/migrations/
 * 160_adaptation_shadow_log.sql`) — see that file's header and
 * `lib/adaptation/shadow-log-retention.ts` for the full policy: rows older
 * than 180 days are deleted, and a 400-row-per-user cap backstops a
 * double-insert bug. Both are DELETE-only, scoped to this one table, and
 * idempotent — a second run after the first has caught up deletes nothing.
 *
 * Housekeeping only. Nothing downstream reads this table, so a late or
 * missed run costs a slightly larger table for a day, never a wrong answer
 * — this is why the job is listed in `lib/ops/cron-ledger.ts`'s
 * `EXCLUDED_FROM_TICK` rather than driven by the catch-up scheduler.
 *
 * Auth: CRON_SECRET, same as every other cron route.
 * Schedule: `.github/workflows/prune-adaptation-shadow-log.yml`, nightly.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pruneAdaptationShadowLog } from '@/lib/adaptation/shadow-log-retention';
import { recordCronSuccess } from '@/lib/ops/cron-ledger';

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'CRON_SECRET not configured.' }, { status: 503 });
  }
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (token !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const result = await pruneAdaptationShadowLog();
    // 2026-09-01 · scheduler ledger (lib/ops/cron-ledger.ts). This job sits in
    // EXCLUDED_FROM_TICK (it isn't due-gated or catch-up-driven), but it still
    // needs to stamp its own completion — otherwise the ledger has no record
    // this job has ever run, regardless of whether the GitHub Actions schedule
    // is actually firing it. Confirmed empirically: zero ops_alerts rows for
    // cron/prune-adaptation-shadow-log before this fix.
    await recordCronSuccess('prune-adaptation-shadow-log', { ...result });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
