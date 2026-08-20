/**
 * lib/plan/pace-drop-event.ts · the durable record of the last pace re-anchor.
 *
 * `GET /api/v5/paces` (design 18a) has to answer "did the runner's paces just
 * move, and why" on a read days after the re-anchor actually happened — the
 * daily self-heal (`lib/plan/reanchor-plan.ts`) and the race-authority
 * fallback (`lib/race/next-best-anchor.ts` via `app/api/v5/race-authority`)
 * both run out of band from any phone request. Nothing in the codebase
 * persisted that event before this file: `reanchorActivePlan`'s result was
 * only ever surfaced in the cron's own JSON response for observability
 * (`app/api/cron/snapshot-projections/route.ts`), never written anywhere the
 * phone could read it back later.
 *
 * NO DDL. This is one additive field — `pace_zone_event` — inside
 * `training_plans.authored_state`, the SAME jsonb column `pace_blend`,
 * `anchorVdot` and `pace_recompute` already live in. Rule 6 (CLAUDE.md):
 * `authored_state` is a multi-writer column, so every write here is a
 * field-level `jsonb_set` / `||` merge, never a full-column replace — the
 * existing anchor fields must survive a pace-drop-event write and vice versa.
 */
import { pool } from '@/lib/db/pool';

export type PaceZoneEventDirection = 'slower' | 'faster';
export type PaceZoneEvidenceSource = 'race' | 'training' | null;

export interface PaceZoneEvent {
  direction: PaceZoneEventDirection;
  fromVdot: number;
  toVdot: number;
  /** ISO instant the re-anchor happened. */
  atISO: string;
  /** What licensed the move · a race result vs. training-derived evidence.
   *  Null when the caller genuinely does not know (kept dismiss-only on read). */
  evidenceSource: PaceZoneEvidenceSource;
  /** Race slug, when `evidenceSource === 'race'`. */
  evidenceRaceSlug: string | null;
  /** Set once the runner has acted on the card — dismissed a modelled read,
   *  or answered the race-representativeness question. Null while pending. */
  acknowledgedAt: string | null;
}

type QueryFn = typeof pool.query;

/**
 * Stamp a new pace-drop event. Field-level merge (Rule 6): only the
 * `pace_zone_event` key of `authored_state` is touched, so `pace_blend`,
 * `anchorVdot` and every other writer's fields survive untouched.
 *
 * Silent no-op when `fromVdot === toVdot` (rounds to the same second) —
 * nothing moved, so nothing is worth surfacing as "your paces changed".
 */
export async function recordPaceZoneEvent(
  q: { query: QueryFn },
  planId: string,
  args: {
    fromVdot: number | null;
    toVdot: number;
    evidenceSource?: PaceZoneEvidenceSource;
    evidenceRaceSlug?: string | null;
    atISO?: string;
  },
): Promise<void> {
  if (args.fromVdot == null || !Number.isFinite(args.fromVdot)) return; // no "before" to show
  if (Math.round(args.fromVdot * 10) === Math.round(args.toVdot * 10)) return; // no real move

  const event: PaceZoneEvent = {
    direction: args.toVdot > args.fromVdot ? 'faster' : 'slower',
    fromVdot: args.fromVdot,
    toVdot: args.toVdot,
    atISO: args.atISO ?? new Date().toISOString(),
    evidenceSource: args.evidenceSource ?? null,
    evidenceRaceSlug: args.evidenceRaceSlug ?? null,
    acknowledgedAt: null,
  };

  await q.query(
    `UPDATE training_plans
        SET authored_state = COALESCE(authored_state, '{}'::jsonb)
            || jsonb_build_object('pace_zone_event', $2::jsonb)
      WHERE id = $1`,
    [planId, JSON.stringify(event)],
  );
}

/** Read the plan's current pace-drop event, if any. */
export async function loadPaceZoneEvent(planId: string): Promise<PaceZoneEvent | null> {
  const row = (await pool.query<{ authored_state: Record<string, unknown> | null }>(
    `SELECT authored_state FROM training_plans WHERE id = $1`,
    [planId],
  ).catch(() => ({ rows: [] }))).rows[0];
  const raw = (row?.authored_state as Record<string, unknown> | undefined)?.pace_zone_event;
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Partial<PaceZoneEvent>;
  if (e.direction !== 'slower' && e.direction !== 'faster') return null;
  if (typeof e.fromVdot !== 'number' || typeof e.toVdot !== 'number') return null;
  return {
    direction: e.direction,
    fromVdot: e.fromVdot,
    toVdot: e.toVdot,
    atISO: typeof e.atISO === 'string' ? e.atISO : new Date().toISOString(),
    evidenceSource: e.evidenceSource === 'race' || e.evidenceSource === 'training' ? e.evidenceSource : null,
    evidenceRaceSlug: typeof e.evidenceRaceSlug === 'string' ? e.evidenceRaceSlug : null,
    acknowledgedAt: typeof e.acknowledgedAt === 'string' ? e.acknowledgedAt : null,
  };
}

/** Mark the current pace-drop event acknowledged — a dismiss, or an answered
 *  race-representativeness question. `jsonb_set` on the one nested key so a
 *  concurrent write to a SIBLING `authored_state` field is untouched. */
export async function acknowledgePaceZoneEvent(planId: string, atISO?: string): Promise<void> {
  await pool.query(
    `UPDATE training_plans
        SET authored_state = jsonb_set(
              COALESCE(authored_state, '{}'::jsonb),
              '{pace_zone_event,acknowledgedAt}',
              to_jsonb($2::text)
            )
      WHERE id = $1
        AND authored_state ? 'pace_zone_event'`,
    [planId, atISO ?? new Date().toISOString()],
  );
}
