/**
 * GET /api/coach/intents
 *
 * Returns recent coach_intents rows for the authenticated user, in plain
 * shape suitable for the toolkit's CoachActivityTimeline / WhatChangedExpander /
 * AdaptationCard family (toolkit family C).
 *
 * Closes coverage rows · WEB-applicable:
 *   · Today / Adaptation events (line 238)
 *   · Plan / mutation history (line 487)
 *   · Plan / 9 adaptation trigger types (line 580)
 *   · Cross-cutting / coach_intents activity log (line 1999)
 *
 * Query params:
 *   ?limit=N         (default 30, capped at 100)
 *   ?since=ISO       (default 30 days ago)
 *   ?reason_prefix=X (filter reason LIKE 'X%'; e.g. 'plan_adapt' to only
 *                    surface plan-adaptation events on the Plan surface)
 *
 * Output shape:
 *   { ok, rows: [{ ts, reason, severity, summary, field, value }] }
 *
 * `severity` is derived from the reason prefix:
 *   plan_adapt_override*  → 'override'
 *   plan_adapt_*          → 'warn'
 *   vdot_auto_recalc      → 'info'
 *   anything else         → 'info'
 *
 * `summary` is a plain-English narration of (reason, field, value) so the
 * client doesn't have to learn every reason key. Falls back to the raw
 * reason string when no narration exists.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

type Severity = 'info' | 'warn' | 'override';

interface IntentRow {
  ts: string;
  reason: string;
  field: string | null;
  value: unknown;
}

interface RenderedRow {
  ts: string;
  reason: string;
  severity: Severity;
  summary: string;
  field: string | null;
  value: unknown;
}

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '30', 10) || 30, 100);
  const sinceIso = url.searchParams.get('since') ||
    new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const reasonPrefix = url.searchParams.get('reason_prefix');
  // 2026-06-03 · banner surfaces (AdaptationCard) pass unacked_only=true
  // so once an intent is marked acknowledged (engine-side via
  // autoMergeForDate, or runner-side via dismiss) it stops banner-
  // rendering. Timeline / history surfaces leave it false to keep
  // the audit log complete.
  const unackedOnly = url.searchParams.get('unacked_only') === 'true';

  const params: unknown[] = [userId, sinceIso];
  // BOTH columns cast to text · the writer at lib/plan/adapt.ts:292
  // populates user_id (uuid col) and user_uuid (uuid col) from the
  // same $1 string. Without ::text on user_id, PG errors with
  // "COALESCE types text and uuid cannot be matched" because the
  // first arg (user_uuid::text) is text and the second arg (user_id)
  // is uuid · they need a common type. Diagnosed 2026-06-01 by
  // /api/admin/audit-coach-intents · the rows ARE in the table but
  // the query was throwing and the silent .catch below was returning
  // [] (so the WhatChangedExpander + CoachActivityTimeline showed
  // empty for runners who actually had adapter activity).
  let where = `COALESCE(user_uuid::text, user_id::text) = $1 AND ts >= $2`;
  if (reasonPrefix) {
    params.push(`${reasonPrefix}%`);
    where += ` AND reason LIKE $${params.length}`;
  }
  if (unackedOnly) {
    where += ` AND acknowledged_at IS NULL`;
  }

  const q = await pool.query<IntentRow>(
    `SELECT ts, reason, field, value
       FROM coach_intents
       WHERE ${where}
       ORDER BY ts DESC
       LIMIT ${limit}`,
    params,
  ).catch((e: unknown) => {
    // Log the underlying error · was silently swallowed before, which
    // hid the COALESCE type mismatch above. Still degrade to empty so
    // the UI doesn't crash, but the error is visible in Railway logs.
    console.error('[api/coach/intents] query failed:', e instanceof Error ? e.message : String(e));
    return { rows: [] as IntentRow[] };
  });

  const rendered: RenderedRow[] = q.rows.map((r) => ({
    ts: r.ts,
    reason: r.reason,
    severity: severityOf(r.reason),
    summary: summarize(r.reason, r.field, r.value),
    field: r.field,
    value: r.value,
  }));

  return NextResponse.json({ ok: true, rows: rendered });
}

function severityOf(reason: string): Severity {
  if (!reason) return 'info';
  if (reason.startsWith('plan_adapt_override') || reason === 'injury_active' || reason === 'sick_episode_active') {
    return 'override';
  }
  if (reason.startsWith('plan_adapt_') || reason === 'rhr_spike' || reason === 'sleep_crater' || reason === 'niggle_reported') {
    return 'warn';
  }
  return 'info';
}

/* Plain-English narration. Keeps the doc-driven copy in one place so the
   timeline UI never has to know reason-string semantics. */
function summarize(reason: string, field: string | null, value: unknown): string {
  switch (reason) {
    case 'vdot_auto_recalc':
      return `VDOT recalculated from a race result${field ? ` · from ${field}` : ''}.`;
    case 'lthr_auto_calibrated':
      return `LTHR re-calibrated from a recent race.`;
    case 'swap_accepted':
      return `You accepted a workout swap${field ? ` for ${field}` : ''}.`;
    case 'swap_declined':
      return `You declined a workout swap${field ? ` for ${field}` : ''}.`;
    case 'proposal_declined':
      return `You declined a coach proposal.`;
    case 'watch_completion':
      return `A workout finished on the watch.`;
    case 'illness_acknowledged':
      return `Illness logged · plan paused.`;
    case 'injury_plan_built':
      return `Injury plan scaffolded · return-to-run sequence active.`;
    case 'plan_adapt_volume_overshoot':
      return `Volume ran hot · the next quality day was eased.`;
    case 'plan_adapt_rhr_spike':
      return `Resting HR spiked · tomorrow's effort dropped one notch.`;
    case 'plan_adapt_sleep_crater':
      return `Sleep was short · the coach softened tomorrow's load.`;
    case 'plan_adapt_missed_key_workout':
      return `A key workout was missed · the coach reshaped the week.`;
    case 'plan_adapt_niggle_reported':
      return `Niggle logged · plan now favors lower impact.`;
    case 'plan_adapt_pr_bank':
      return `Race banked · adjacent paces re-anchored.`;
    case 'plan_adapt_goal_changed':
      return `Goal changed · plan re-anchored.`;
    case 'plan_adapt_sick_episode_active':
      return `Illness active · plan paused with a return gate.`;
    case 'plan_adapt_injury_active':
      return `Injury active · plan paused with a return gate.`;
    default:
      if (reason.startsWith('plan_adapt_')) {
        return `Plan adapted · ${reason.replace('plan_adapt_', '').replace(/_/g, ' ')}.`;
      }
      // Generic value-aware fallback
      const v = field && value !== null && value !== undefined
        ? ` · ${field}: ${String(value).slice(0, 60)}`
        : '';
      return `${reason.replace(/_/g, ' ')}${v}.`;
  }
}
