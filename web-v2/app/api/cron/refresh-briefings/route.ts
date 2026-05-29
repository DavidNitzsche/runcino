/**
 * POST /api/cron/refresh-briefings
 *
 * LEGACY ROUTE — kept so Railway / cron-job.org doesn't 404 when the
 * day-rollover schedule fires. Now a no-op.
 *
 * 2026-05-28 · Cardinal Rule #1 (PROJECT.md, locked 2026-05-28): "Zero
 * LLM · anywhere · ever." The old job pre-warmed a Postgres-backed LLM
 * briefing cache so the first /today open of a new day wouldn't pay
 * the 15-20 s LLM tail. The cache is dead and so is the warm. Every
 * surface now recomputes facts deterministically from current DB state
 * on each request (cheap pg queries only, typically <300 ms).
 *
 * Auth is preserved so a misconfigured cron-job.org caller still 401s
 * loudly rather than hitting an open endpoint. You can stop scheduling
 * this whenever — leaving it in place hurts nothing.
 */
import { NextRequest, NextResponse } from 'next/server';

// No LLM, no DB writes — this is a milliseconds-tight endpoint now.
export const maxDuration = 10;

export async function POST(req: NextRequest) {
  // ── auth (preserved) ──
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({
      ok: false,
      note: 'CRON_SECRET not configured. Set it in env, or stop scheduling this route — it is a no-op since the 2026-05-28 LLM rip.',
    }, { status: 503 });
  }
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (token !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    deprecated: true,
    note: 'Briefing cache retired with the 2026-05-28 LLM rip. /api/coach/facts is now deterministic and needs no warming.',
    timestamp: new Date().toISOString(),
  });
}

// Allow GET for health probes — returns 200 with metadata so an
// operator can confirm the endpoint exists.
export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/cron/refresh-briefings',
    deprecated: true,
    note: 'No-op since 2026-05-28 LLM rip.',
    secret_configured: Boolean(process.env.CRON_SECRET),
  });
}
