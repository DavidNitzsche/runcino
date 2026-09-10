/**
 * GET /api/admin/observability-summary
 *
 * READ-ONLY diagnostic over `request_failures` (migration 170 · NOT applied
 * to production as of authoring, see that migration's header). Built for the
 * real, unresolved 502/~13-second-timeout incident David named: "no durable,
 * queryable log of 5xx/timeout events that would let anyone diagnose the NEXT
 * occurrence." This is what closes that gap — the summary an operator reads
 * when the incident happens again.
 *
 * Same agent-built, self-execute, non-mutating posture as the other
 * `/api/admin/audit-*` routes (audit-races, audit-weather, audit-coach-
 * intents) per CLAUDE.md's "operational vs decision vs external" section:
 * a read-only diagnostic endpoint the agent built is safe to run itself.
 *
 * Query params:
 *   hours          · lookback window, default 24, clamped to [1, 720] (30 days)
 *   route          · optional exact `route_path` filter, for "is this the
 *                    endpoint that's been 502ing" triage
 *   correlationId  · optional exact match — reconstructs one request's full
 *                    path across every row that shares its id (the reason
 *                    the id is threaded through downstream calls at all)
 *
 * Response shape:
 *   { windowHours, totalFailures, byClass: [{failureClass, count, p50DurationMs,
 *     p95DurationMs, firstSeen, lastSeen}], recentByClass: {[class]: [...rows]},
 *     tableApplied: boolean }
 *
 * `tableApplied: false` (with an explanatory `note`) is the HONEST response
 * when migration 170 has not landed yet — Rule 11 applies here as much as
 * anywhere else: "the table doesn't exist yet" and "the table exists and is
 * empty" are different facts, and this route never reports the first as the
 * second's zero.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireAdmin } from '@/lib/auth/session';
import { ALL_FAILURE_CLASSES } from '@/lib/observability/types';

export const dynamic = 'force-dynamic';

interface ClassRollupRow {
  failure_class: string;
  count: string;
  p50_duration_ms: number | null;
  p95_duration_ms: number | null;
  first_seen: string;
  last_seen: string;
}

interface RecentRow {
  id: string;
  correlation_id: string;
  route_path: string;
  http_method: string;
  failure_class: string;
  http_status: number | null;
  duration_ms: number | null;
  error_message: string | null;
  upstream_service: string | null;
  client_reported: boolean;
  created_at: string;
}

/** Postgres error 42P01 = undefined_table. The honest "migration 170 has not
 *  been applied yet" case, distinguished from every other query failure so
 *  this route never reports a DB outage as a clean empty result. */
function isUndefinedTable(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { code?: unknown }).code === '42P01';
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const hoursParam = Number(url.searchParams.get('hours'));
  const hours = Number.isFinite(hoursParam) && hoursParam > 0 ? Math.min(hoursParam, 24 * 30) : 24;
  const routeFilter = url.searchParams.get('route');
  const correlationFilter = url.searchParams.get('correlationId');

  try {
    const whereParts = [`created_at > now() - ($1 || ' hours')::interval`];
    const params: unknown[] = [String(hours)];
    if (routeFilter) {
      params.push(routeFilter);
      whereParts.push(`route_path = $${params.length}`);
    }
    if (correlationFilter) {
      params.push(correlationFilter);
      whereParts.push(`correlation_id = $${params.length}`);
    }
    const where = whereParts.join(' AND ');

    const rollup = (await pool.query<ClassRollupRow>(
      `SELECT failure_class,
              count(*)::text AS count,
              percentile_disc(0.5) WITHIN GROUP (ORDER BY duration_ms) AS p50_duration_ms,
              percentile_disc(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_duration_ms,
              min(created_at)::text AS first_seen,
              max(created_at)::text AS last_seen
         FROM request_failures
        WHERE ${where}
        GROUP BY failure_class
        ORDER BY count(*) DESC`,
      params,
    )).rows;

    const totalFailures = rollup.reduce((sum, r) => sum + Number(r.count), 0);

    // Five most recent rows per class actually present, so an operator sees
    // real examples rather than just counts — sanitized fields only, per
    // this table's write-time sanitization (sanitize.ts).
    const recentByClass: Record<string, RecentRow[]> = {};
    for (const r of rollup) {
      const recentParams = [...params, r.failure_class];
      const recent = (await pool.query<RecentRow>(
        `SELECT id, correlation_id, route_path, http_method, failure_class, http_status,
                duration_ms, error_message, upstream_service, client_reported, created_at::text
           FROM request_failures
          WHERE ${where} AND failure_class = $${params.length + 1}
          ORDER BY created_at DESC
          LIMIT 5`,
        recentParams,
      )).rows;
      recentByClass[r.failure_class] = recent;
    }

    // Classes present in the taxonomy but with zero rows in this window are
    // named explicitly at zero, not omitted — an operator asking "has this
    // ever fired" needs to see EDGE at 0 as distinctly as DATABASE_POOL at 12,
    // not infer the zero from the class's absence from the list.
    const seenClasses = new Set(rollup.map((r) => r.failure_class));
    const byClass = [
      ...rollup.map((r) => ({
        failureClass: r.failure_class,
        count: Number(r.count),
        p50DurationMs: r.p50_duration_ms,
        p95DurationMs: r.p95_duration_ms,
        firstSeen: r.first_seen,
        lastSeen: r.last_seen,
      })),
      ...ALL_FAILURE_CLASSES.filter((c) => !seenClasses.has(c)).map((c) => ({
        failureClass: c, count: 0, p50DurationMs: null, p95DurationMs: null, firstSeen: null, lastSeen: null,
      })),
    ];

    return NextResponse.json({
      windowHours: hours,
      totalFailures,
      byClass,
      recentByClass,
      tableApplied: true,
    });
  } catch (e: unknown) {
    if (isUndefinedTable(e)) {
      return NextResponse.json({
        windowHours: hours,
        totalFailures: 0,
        byClass: ALL_FAILURE_CLASSES.map((c) => ({ failureClass: c, count: 0, p50DurationMs: null, p95DurationMs: null, firstSeen: null, lastSeen: null })),
        recentByClass: {},
        tableApplied: false,
        note: 'request_failures does not exist yet — migration 170_request_failures.sql has not been applied to this database. This is NOT the same fact as "zero failures"; see CLAUDE.md Rule 11.',
      });
    }
    console.error('[admin/observability-summary] query failed:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'query failed', detail: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
