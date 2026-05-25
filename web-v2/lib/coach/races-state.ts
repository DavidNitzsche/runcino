/**
 * races-state.ts
 * Loads the season-of-races view: the A-race amplified, upcoming Bs/Cs, past races.
 */
import { pool } from '@/lib/db/pool';

export interface RaceRow {
  slug: string;
  name: string;
  date: string;
  priority: 'A' | 'B' | 'C' | null;
  goal: string | null;
  distance_label: string | null;
  location: string | null;
  is_past: boolean;
  days: number;          // negative if past
  finishTime: string | null;
  pb: boolean | null;
}

export interface RacesState {
  today: string;
  aRace: RaceRow | null;
  upcomingBs: RaceRow[];
  upcomingCs: RaceRow[];
  past: RaceRow[];
  totalUpcoming: number;
  totalPast: number;
}

export async function loadRacesState(userId: string): Promise<RacesState> {
  const today = new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);

  const rows = (await pool.query(
    `SELECT slug, meta FROM races
      WHERE user_uuid = $1 OR user_uuid IS NULL
      ORDER BY (meta->>'date') NULLS LAST`,
    [userId]
  )).rows;

  const all: RaceRow[] = rows.map((r: any) => {
    const m = r.meta ?? {};
    const date = m.date ?? null;
    const is_past = date ? date < today : false;
    const days = date
      ? Math.round((Date.parse(date + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86400000)
      : 0;
    return {
      slug: r.slug,
      name: m.name ?? r.slug,
      date: date ?? '',
      priority: m.priority ?? null,
      goal: m.goalDisplay ?? null,
      distance_label: m.distanceLabel ?? null,
      location: m.location ?? null,
      is_past,
      days,
      finishTime: m.finishTime ?? null,
      pb: m.pb ?? null,
    };
  });

  const upcoming = all.filter((r) => !r.is_past && r.date).sort((a, b) => a.date.localeCompare(b.date));
  const past     = all.filter((r) => r.is_past).sort((a, b) => b.date.localeCompare(a.date));

  const aRace = upcoming.find((r) => r.priority === 'A') ?? null;
  const upcomingBs = upcoming.filter((r) => r.priority === 'B');
  const upcomingCs = upcoming.filter((r) => r.priority === 'C' || r.priority == null);

  return {
    today,
    aRace,
    upcomingBs,
    upcomingCs,
    past,
    totalUpcoming: upcoming.length,
    totalPast: past.length,
  };
}
