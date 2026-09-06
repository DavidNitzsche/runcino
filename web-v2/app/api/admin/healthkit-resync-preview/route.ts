/**
 * POST /api/admin/healthkit-resync-preview
 *
 * DECISION 3 (2026-09-06) · a HealthKit active-energy resync PREVIEW, and
 * never the resync itself. Read-only against `health_samples` — this route
 * writes nothing, ever, no matter what it is called with.
 *
 * David's ruling, verbatim: "Do not patch values with SQL. Prepare a
 * HealthKit resync preview showing: Every affected date. Current stored
 * total. On-device recomputed total. Delta. Source sample count. Upsert
 * identity. Rows that would change. Rows that would remain untouched. Do not
 * trigger the production resync until approved."
 *
 * ── WHAT THIS ROUTE CANNOT DO, SAID PLAINLY (Rule 22) ──────────────────────
 *
 * It cannot read HealthKit. The corrupted historical days (REQUESTSTORM-2,
 * `lib/health/active-energy-batch.ts`) lost their raw per-bucket samples the
 * moment the old ingest upsert overwrote them — there is no query against
 * this database that recovers a correct historical total. The caller
 * supplies `candidates`: per-date totals and sample counts AS IF freshly
 * summed from the phone's own HealthKit store. Producing that payload for
 * real needs a native dry-run flow (the app reads its own HealthKit history
 * and POSTs here instead of the live ingest endpoint) that does not exist
 * yet — this route is the server half, ready for it, not a claim that the
 * native half is built.
 *
 * It cannot decide anything. It reports a diff. Whether to actually apply a
 * resync is the owner's explicit approval, per statement, exactly like every
 * other data write in this repo's deployment doctrine.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireAdmin } from '@/lib/auth/session';
import { buildResyncPreview, type ResyncCandidate, type CurrentStoredRow } from '@/lib/health/resync-preview';

export const dynamic = 'force-dynamic';

interface RequestBody {
  candidates?: Array<{ dateISO?: unknown; recomputedTotalKcal?: unknown; sourceSampleCount?: unknown }>;
}

function parseCandidates(body: RequestBody): ResyncCandidate[] | null {
  if (!Array.isArray(body.candidates) || body.candidates.length === 0) return null;
  const out: ResyncCandidate[] = [];
  for (const c of body.candidates) {
    if (typeof c.dateISO !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(c.dateISO)) return null;
    if (typeof c.recomputedTotalKcal !== 'number' || !Number.isFinite(c.recomputedTotalKcal)) return null;
    if (typeof c.sourceSampleCount !== 'number' || !Number.isInteger(c.sourceSampleCount) || c.sourceSampleCount < 0) {
      return null;
    }
    out.push({
      dateISO: c.dateISO,
      recomputedTotalKcal: c.recomputedTotalKcal,
      sourceSampleCount: c.sourceSampleCount,
    });
  }
  return out;
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const candidates = parseCandidates(body);
  if (candidates == null) {
    return NextResponse.json({
      error: 'candidates must be a non-empty array of { dateISO: "YYYY-MM-DD", recomputedTotalKcal: number, '
        + 'sourceSampleCount: integer >= 0 }',
    }, { status: 400 });
  }

  const dates = candidates.map((c) => c.dateISO);
  const currentRows = (await pool.query<{ sample_date: string; value: string | number }>(
    `SELECT sample_date::text AS sample_date, value
       FROM health_samples
      WHERE COALESCE(user_uuid, user_id) = $1
        AND sample_type = 'active_energy'
        AND sample_date = ANY($2::date[])`,
    [userId, dates],
  )).rows;

  const current = new Map<string, CurrentStoredRow>();
  for (const r of currentRows) {
    current.set(r.sample_date, { dateISO: r.sample_date, storedTotalKcal: Number(r.value) });
  }

  const report = buildResyncPreview(userId, candidates, current, new Date().toISOString());

  return NextResponse.json({
    ok: true,
    ...report,
    summary: {
      datesChecked: report.rows.length,
      wouldChange: report.wouldChange.length,
      unchanged: report.unchanged.length,
    },
  });
}
