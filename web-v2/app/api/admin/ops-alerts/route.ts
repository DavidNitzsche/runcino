/**
 * GET  /api/admin/ops-alerts   — unacked ops alerts, newest first.
 * POST /api/admin/ops-alerts   — { ack_ids: number[] } or { ack_kind: string }
 *
 * ── Why this exists ──────────────────────────────────────────────────
 * raiseAlert() has been writing to `ops_alerts` since P37. By 2026-08-17
 * the table held 75 rows, 0 acked, and NOTHING rendered them: /admin had
 * one page (access requests), and `recentUnackedAlerts()` in
 * lib/ops/alerts.ts had zero callers anywhere in the repo.
 *
 * The cost was not theoretical. 68 of those rows were webhook_failure —
 * the Strava real-time sync dying on 2026-05-29 announced itself, once
 * per rejected run, for eleven weeks, into a table nobody read. The
 * alerting worked perfectly; the last hop was missing.
 *
 * An alert nobody can see is worse than no alert, because it lets the
 * system look instrumented. Either the alerts get a reader or they stop
 * being raised — this route is the reader.
 *
 * Acking matters as much as listing: `recentUnackedAlerts` filters on
 * `acked_at IS NULL`, and with no writer for that column every alert is
 * unacked forever. A list that only ever grows gets ignored within a
 * week, which is how it ended up here in the first place.
 *
 * Auth: requireAdmin — session + users.is_admin, same gate as the rest
 * of /api/admin.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/session';
import { pool } from '@/lib/db/pool';
import { recentUnackedAlerts } from '@/lib/ops/alerts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const alerts = await recentUnackedAlerts(100).catch(() => []);

  // Rollup by kind so a burst of one failure reads as one problem rather
  // than fifty rows. The webhook outage was a single fault repeated 68
  // times; a flat list buries that under its own volume.
  const byKind = new Map<string, { kind: string; count: number; severity: string; latest: string; message: string }>();
  for (const a of alerts) {
    const prev = byKind.get(a.kind);
    if (!prev) {
      byKind.set(a.kind, {
        kind: a.kind,
        count: 1,
        severity: a.severity,
        latest: a.created_at,
        message: a.message,
      });
    } else {
      prev.count++;
      // Alerts arrive newest-first, so the first message seen is the latest.
      if (severityRank(a.severity) > severityRank(prev.severity)) prev.severity = a.severity;
    }
  }

  return NextResponse.json({
    ok: true,
    total_unacked: alerts.length,
    kinds: Array.from(byKind.values()).sort(
      (a, b) => severityRank(b.severity) - severityRank(a.severity) || b.count - a.count,
    ),
    alerts,
  });
}

function severityRank(s: string): number {
  return s === 'critical' ? 4 : s === 'error' ? 3 : s === 'warn' ? 2 : 1;
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => null);
  const ids: unknown = body?.ack_ids;
  const kind: unknown = body?.ack_kind;

  if (Array.isArray(ids) && ids.length > 0) {
    const clean = ids.map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (clean.length === 0) {
      return NextResponse.json({ error: 'ack_ids must be positive integers' }, { status: 400 });
    }
    const r = await pool.query(
      `UPDATE ops_alerts SET acked_at = NOW() WHERE id = ANY($1::bigint[]) AND acked_at IS NULL`,
      [clean],
    );
    return NextResponse.json({ ok: true, acked: r.rowCount ?? 0 });
  }

  if (typeof kind === 'string' && kind.trim() !== '') {
    const r = await pool.query(
      `UPDATE ops_alerts SET acked_at = NOW() WHERE kind = $1 AND acked_at IS NULL`,
      [kind.trim()],
    );
    return NextResponse.json({ ok: true, acked: r.rowCount ?? 0 });
  }

  return NextResponse.json({ error: 'provide ack_ids: number[] or ack_kind: string' }, { status: 400 });
}
