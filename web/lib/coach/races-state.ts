/**
 * races-state · state for the /races coach layer.
 *
 * Lighter than today-state — focused on the multi-race arc:
 *  - All races on the calendar (past + future)
 *  - The active plan + its race_id
 *  - Per-race trajectory (when computable)
 *  - VDOT snapshot for fitness context
 */

import { query } from '../db';

export interface RaceCalendarItem {
  slug: string;
  name: string;
  date: string;
  daysAway: number;          // negative for past
  priority: 'A' | 'B' | 'C' | null;
  kind: '5K' | '10K' | 'half' | 'marathon' | 'other' | null;
  distanceMi: number | null;
  isCompleted: boolean;
  actualResult: { time: string; goalTime: string | null } | null;
}

export interface RacesState {
  today: string;
  runner: { id: string; firstName: string };
  /** All races on the calendar, sorted ascending by date. */
  races: RaceCalendarItem[];
  /** The race the active plan is built for. */
  activePlanRace: RaceCalendarItem | null;
  /** The next race chronologically after today (any priority). */
  nextRace: RaceCalendarItem | null;
  /** The next A-priority race after today. */
  nextARace: RaceCalendarItem | null;
  /** Most recently completed race (within 30 days). */
  recentRace: RaceCalendarItem | null;
  /** Current fitness signal — coarse, for trajectory framing. */
  vdotSnapshot: { value: number | null; source: string } | null;
}

function localTodayISO(tzOffsetH: number = -7): string {
  return new Date(Date.now() + tzOffsetH * 3600000).toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
}

function classifyKind(distanceMi: number | null, name: string): RaceCalendarItem['kind'] {
  if (distanceMi == null) {
    const n = name.toLowerCase();
    if (n.includes('5k')) return '5K';
    if (n.includes('10k')) return '10K';
    if (n.includes('half')) return 'half';
    if (n.includes('marathon')) return 'marathon';
    return 'other';
  }
  if (distanceMi < 3.5) return '5K';
  if (distanceMi < 7.5) return '10K';
  if (distanceMi < 14.5) return 'half';
  if (distanceMi < 27) return 'marathon';
  return 'other';
}

export async function loadRacesState(userUuid: string): Promise<RacesState> {
  const today = localTodayISO();

  // Runner identity
  const prof = await query<{ full_name: string | null }>(
    `SELECT full_name FROM profile
      WHERE user_uuid = $1 OR (user_uuid IS NULL AND user_id = 'me')
      ORDER BY (user_uuid = $1) DESC LIMIT 1`,
    [userUuid],
  );
  const firstName = (prof[0]?.full_name ?? '').trim().split(/\s+/)[0] || 'Runner';

  // All races for the user
  const raceRows = await query<{ slug: string; meta: any; actual_result: any }>(
    `SELECT slug, meta, actual_result FROM races WHERE user_uuid = $1 OR user_uuid IS NULL`,
    [userUuid],
  );
  const races: RaceCalendarItem[] = raceRows
    .map((r) => {
      const m = r.meta ?? {};
      const date = (m.date as string) ?? null;
      if (!date) return null;
      const distanceMi = m.distanceMi != null ? Number(m.distanceMi) : null;
      const priorityRaw = (m.priority as string) ?? null;
      const priority = (priorityRaw === 'A' || priorityRaw === 'B' || priorityRaw === 'C') ? priorityRaw : null;
      const completed = Boolean(r.actual_result);
      return {
        slug: r.slug,
        name: m.name ?? r.slug,
        date,
        daysAway: daysBetween(today, date),
        priority,
        kind: classifyKind(distanceMi, m.name ?? r.slug),
        distanceMi,
        isCompleted: completed,
        actualResult: completed ? { time: r.actual_result.time ?? '?', goalTime: r.actual_result.goalTime ?? null } : null,
      } as RaceCalendarItem;
    })
    .filter((r): r is RaceCalendarItem => r != null)
    .sort((a, b) => a.date.localeCompare(b.date));

  // Active plan's race
  const planRows = await query<{ race_id: string | null }>(
    `SELECT race_id FROM training_plans
      WHERE (user_uuid = $1 OR (user_uuid IS NULL AND user_id = 'me'))
        AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userUuid],
  );
  const activeRaceId = planRows[0]?.race_id ?? null;
  const activePlanRace = activeRaceId ? races.find((r) => r.slug === activeRaceId) ?? null : null;

  const upcoming = races.filter((r) => r.daysAway >= 0);
  const nextRace = upcoming[0] ?? null;
  const nextARace = upcoming.find((r) => r.priority === 'A') ?? null;
  const recentRace = races
    .filter((r) => r.isCompleted && r.daysAway >= -30)
    .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;

  // VDOT snapshot — coarse fitness anchor. Try to read from a recent
  // result-based computation if available.
  let vdotSnapshot: RacesState['vdotSnapshot'] = null;
  try {
    const vRows = await query<{ vdot: string | null; source: string | null }>(
      `SELECT vdot::text AS vdot, 'aggregate'::text AS source FROM (
         SELECT MAX((data->>'vdot')::numeric) AS vdot
           FROM strava_activities WHERE (user_uuid = $1 OR user_uuid IS NULL)
       ) t WHERE vdot IS NOT NULL`,
      [userUuid],
    );
    if (vRows[0]?.vdot) vdotSnapshot = { value: Number(vRows[0].vdot), source: vRows[0].source ?? 'unknown' };
  } catch { /* swallow — vdot is optional */ }

  return {
    today,
    runner: { id: userUuid, firstName },
    races,
    activePlanRace,
    nextRace,
    nextARace,
    recentRace,
    vdotSnapshot,
  };
}
