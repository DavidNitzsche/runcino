/**
 * GET    /api/injuries/[id]  — fetch one runner_injuries row.
 * PATCH  /api/injuries/[id]  — update fields. Body any of:
 *                                { severity, notes, return_protocol,
 *                                  expected_return_iso, resolved_iso }
 *                              The common case is setting resolved_iso to
 *                              today to mark an injury healed — PATCH is
 *                              preferred over DELETE for that.
 * DELETE /api/injuries/[id]  — hard delete. Rare; mostly used to undo an
 *                              accidentally-created row. Use PATCH with
 *                              resolved_iso to mark healed.
 *
 * Auth: requireUserId(req). The query scopes by user_uuid so a runner
 * can't peek at or mutate another runner's injury rows by guessing id.
 *
 * Severity input accepts both the DB enum strings ('minor'/'moderate'/
 * 'major') and the runner-facing 1-10 pain scale — normalizeSeverity()
 * in ../route.ts handles both. Inlined here to keep the pair of route
 * files self-contained; the logic is small enough that import-from-
 * sibling-route would just couple two files for one helper.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';

type Params = { params: Promise<{ id: string }> };

type SeverityEnum = 'minor' | 'moderate' | 'major';

function normalizeSeverity(s: unknown): SeverityEnum | null {
  if (typeof s === 'string') {
    const t = s.trim().toLowerCase();
    if (t === 'minor' || t === 'moderate' || t === 'major') return t;
    const n = Number(t);
    if (Number.isFinite(n)) return bucketFromScore(n);
  }
  if (typeof s === 'number' && Number.isFinite(s)) return bucketFromScore(s);
  return null;
}
function bucketFromScore(n: number): SeverityEnum {
  if (n <= 3) return 'minor';
  if (n <= 6) return 'moderate';
  return 'major';
}

function isISODate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

const SELECT_INJURY_COLS = `
  id, site, severity, return_protocol, notes,
  start_date::text AS start_date,
  expected_return_date::text AS expected_return_date,
  resolved_date::text AS resolved_date,
  created_at
`;

export async function GET(req: NextRequest, { params }: Params) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isFinite(numericId) || numericId <= 0) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  const row = (await pool.query(
    `SELECT ${SELECT_INJURY_COLS}
       FROM runner_injuries
      WHERE id = $1 AND user_uuid = $2`,
    [numericId, userId],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!row) return NextResponse.json({ error: 'injury not found' }, { status: 404 });
  return NextResponse.json({ injury: row });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isFinite(numericId) || numericId <= 0) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'body must be an object' }, { status: 400 });
  }

  // Build the SET clause from whitelisted fields. Each field validates
  // independently and returns a precise 400 on bad shape — never 500 on
  // a partial payload.
  const setClauses: string[] = [];
  const vals: any[] = [numericId, userId];

  if ('severity' in body && body.severity != null) {
    const sev = normalizeSeverity(body.severity);
    if (!sev) {
      return NextResponse.json(
        { error: 'severity must be 1-10 or one of minor/moderate/major' },
        { status: 400 },
      );
    }
    setClauses.push(`severity = $${vals.length + 1}`);
    vals.push(sev);
  }
  if ('notes' in body) {
    const notes = body.notes == null
      ? null
      : (typeof body.notes === 'string' ? body.notes.trim() || null : null);
    setClauses.push(`notes = $${vals.length + 1}`);
    vals.push(notes);
  }
  if ('return_protocol' in body) {
    const rp = body.return_protocol == null
      ? null
      : (typeof body.return_protocol === 'string' ? body.return_protocol.trim() || null : null);
    setClauses.push(`return_protocol = $${vals.length + 1}`);
    vals.push(rp);
  }
  if ('expected_return_iso' in body) {
    if (body.expected_return_iso != null && !isISODate(body.expected_return_iso)) {
      return NextResponse.json(
        { error: 'expected_return_iso must be YYYY-MM-DD or null' },
        { status: 400 },
      );
    }
    setClauses.push(`expected_return_date = $${vals.length + 1}::date`);
    vals.push(body.expected_return_iso ?? null);
  }
  if ('resolved_iso' in body) {
    if (body.resolved_iso != null && !isISODate(body.resolved_iso)) {
      return NextResponse.json(
        { error: 'resolved_iso must be YYYY-MM-DD or null' },
        { status: 400 },
      );
    }
    setClauses.push(`resolved_date = $${vals.length + 1}::date`);
    vals.push(body.resolved_iso ?? null);
  }
  // Convenience: { resolved: true } shortcut for the "mark healed today"
  // tap on the iPhone — saves the client from computing today's ISO in
  // the runner's TZ. Skipped when resolved_iso was explicit above.
  if (!('resolved_iso' in body) && body.resolved === true) {
    setClauses.push(`resolved_date = CURRENT_DATE`);
  }

  if (setClauses.length === 0) {
    return NextResponse.json(
      { error: 'no recognized fields', allow: ['severity', 'notes', 'return_protocol', 'expected_return_iso', 'resolved_iso', 'resolved'] },
      { status: 400 },
    );
  }

  try {
    const r = await pool.query(
      `UPDATE runner_injuries
          SET ${setClauses.join(', ')}
        WHERE id = $1 AND user_uuid = $2
        RETURNING ${SELECT_INJURY_COLS}`,
      vals,
    );
    if (r.rowCount === 0) {
      return NextResponse.json({ error: 'injury not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, injury: r.rows[0] });
  } catch (err: any) {
    return NextResponse.json({
      error: 'injury update failed',
      detail: err?.message ?? String(err),
    }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isFinite(numericId) || numericId <= 0) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  try {
    const r = await pool.query(
      `DELETE FROM runner_injuries WHERE id = $1 AND user_uuid = $2 RETURNING id`,
      [numericId, userId],
    );
    if (r.rowCount === 0) {
      return NextResponse.json({ error: 'injury not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, deleted: r.rows[0].id });
  } catch (err: any) {
    return NextResponse.json({
      error: 'injury delete failed',
      detail: err?.message ?? String(err),
    }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
