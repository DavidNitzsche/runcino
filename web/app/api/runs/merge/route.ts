/**
 * POST /api/runs/merge — force a set of source runs to fold into a target.
 *
 * Body: { targetId: number, sourceIds: number[], confirm?: boolean }
 *
 * Use case: auto-dedup didn't catch all the dupes for a session (e.g. a
 * paused/resumed run uploaded as four fragments with start times spread
 * across a 30+ min window). The user multi-selects rows on /log, picks one
 * to be canonical, and the rest get pinned with mode='merge-into' so the
 * next dedup pass collapses them into the chosen canonical.
 *
 * Guardrails (return 400 unless body.confirm === true):
 *   - distance ratio (min / max) < 0.5 — likely different sessions
 *     (e.g. a 1mi AH "Run" being folded into an 11mi morning long run)
 *   - absolute time gap > 4h — likely different sessions
 *
 * Stores manual overrides in run_merge_overrides; no rows are deleted or
 * mutated. To undo, hit /api/runs/[id]/unmerge on a source — it flips that
 * source to 'keep-separate' which overrides the force-merge.
 */

import { NextResponse } from 'next/server';
import { requireActiveUser } from '@/lib/auth';
import { setForceMerge } from '@/lib/run-merge-overrides';
import { query } from '@/lib/db';

interface Body {
  targetId?: unknown;
  sourceIds?: unknown;
  confirm?: unknown;
}

interface RunRow {
  id: number;
  distanceMi: number;
  startMs: number;
  startLocal: string;
}

const MAX_TIME_GAP_MS = 4 * 60 * 60 * 1000;
const MIN_DISTANCE_RATIO = 0.5;

async function loadRuns(userId: string, ids: number[]): Promise<RunRow[]> {
  if (ids.length === 0) return [];
  const rows = await query<{ id: string; distance_mi: string | null; start_local: string | null }>(
    `SELECT id::text AS id,
            (data->>'distanceMi')::TEXT AS distance_mi,
            data->>'startLocal' AS start_local
       FROM strava_activities
      WHERE id = ANY($1::BIGINT[])
        AND (user_uuid = $2 OR user_uuid IS NULL)`,
    [ids, userId],
  );
  const out: RunRow[] = [];
  for (const r of rows) {
    const startMs = r.start_local ? Date.parse(r.start_local) : NaN;
    out.push({
      id: Number(r.id),
      distanceMi: Number(r.distance_mi ?? 0) || 0,
      startMs: Number.isFinite(startMs) ? startMs : NaN,
      startLocal: r.start_local ?? '',
    });
  }
  return out;
}

export async function POST(req: Request) {
  let user;
  try {
    user = await requireActiveUser();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Bad JSON' }, { status: 400 });
  }

  const targetId = Number(body.targetId);
  if (!Number.isFinite(targetId)) {
    return NextResponse.json({ error: 'targetId required' }, { status: 400 });
  }
  const sourceIds = Array.isArray(body.sourceIds)
    ? body.sourceIds.map(Number).filter((n) => Number.isFinite(n) && n !== targetId)
    : [];
  if (sourceIds.length === 0) {
    return NextResponse.json({ error: 'sourceIds required' }, { status: 400 });
  }
  const confirmed = body.confirm === true;

  // Guardrail check — load target + sources and verify the user isn't
  // accidentally folding a 1mi AH "Run" into an 11mi morning long run
  // (real reported bug). Bypass only with explicit confirm:true so the
  // UI can re-prompt.
  if (!confirmed) {
    try {
      const rows = await loadRuns(user.id, [targetId, ...sourceIds]);
      const target = rows.find((r) => r.id === targetId);
      if (target) {
        for (const src of rows) {
          if (src.id === targetId) continue;
          const distMin = Math.min(target.distanceMi, src.distanceMi);
          const distMax = Math.max(target.distanceMi, src.distanceMi);
          const ratio = distMax > 0 ? distMin / distMax : 0;
          if (ratio < MIN_DISTANCE_RATIO) {
            return NextResponse.json(
              {
                error: 'distance ratio too low',
                guard: 'distance_ratio',
                ratio: Math.round(ratio * 100) / 100,
                target: { id: target.id, distanceMi: target.distanceMi },
                source: { id: src.id, distanceMi: src.distanceMi },
                hint: 'These look like different sessions. Pass { confirm: true } to override.',
              },
              { status: 400 },
            );
          }
          if (Number.isFinite(target.startMs) && Number.isFinite(src.startMs)) {
            const gapMs = Math.abs(target.startMs - src.startMs);
            if (gapMs > MAX_TIME_GAP_MS) {
              return NextResponse.json(
                {
                  error: 'time gap too large',
                  guard: 'time_gap',
                  gapHours: Math.round((gapMs / 3_600_000) * 10) / 10,
                  target: { id: target.id, startLocal: target.startLocal },
                  source: { id: src.id, startLocal: src.startLocal },
                  hint: 'These look like different sessions. Pass { confirm: true } to override.',
                },
                { status: 400 },
              );
            }
          }
        }
      }
    } catch {
      /* guard load failed — fall through and let the merge attempt run.
       * The override DOES NOT delete data, so a wrong merge is recoverable
       * via /api/runs/[id]/unmerge. */
    }
  }

  try {
    await Promise.all(sourceIds.map((sid) => setForceMerge(user.id, sid, targetId)));
    return NextResponse.json({ ok: true, merged: sourceIds.length });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'merge failed' },
      { status: 500 },
    );
  }
}
