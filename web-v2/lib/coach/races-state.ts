/**
 * races-state.ts
 * Loads the season-of-races view: the A-race amplified, upcoming Bs/Cs, past races.
 */
import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';

export interface RaceRow {
  slug: string;
  name: string;
  date: string;
  priority: 'A' | 'B' | 'C' | null;
  goal: string | null;
  distance_label: string | null;
  distance_mi: number | null;
  location: string | null;
  is_past: boolean;
  days: number;          // negative if past
  finishTime: string | null;
  // #29 · true when finishTime did NOT come from a curated result
  // (races.actual_result.finishS or meta.finishTime) but was auto-filled
  // from a date+distance-matched Strava/HK run's raw moving/elapsed time.
  // Per CLAUDE.md Race-data Rule 3 (Strava-source data must never display
  // as authoritative race performance) + Rule 4 (a matched run can be a
  // GPS over/under-measured activity), consumers must NOT render a
  // provisional finish as an authoritative PR / personal record.
  finishProvisional: boolean;
  pb: boolean | null;
  // Race-morning logistics — read from races.meta (camelCase writer) with
  // snake_case fallbacks for older rows written before the naming settled.
  gun_time: string | null;   // '7:00 AM' / '7:00' / null if not entered
  wave: string | null;       // 'Wave A' / 'Corral 1' / null
  bib: string | null;        // bib number once assigned
  website: string | null;    // official race site (meta.officialUrl)
  packet_pickup: string | null; // packet pickup · where + when
  shuttle: string | null;    // shuttle info
  parking: string | null;    // parking info
  notes: string | null;      // general race-day notes
  aid_stations: string | null; // on-course water / aid / support
  summary: string | null;    // AI "what to expect" blurb (terrain-grounded)
  notable_miles: string | null; // landmark/terrain callouts by mile
  weather_norms: string | null; // typical conditions for the date + place
  time_limit: string | null; // course time limit / cutoffs
  gear_check: string | null; // bag/gear check
  pacers: string | null;     // official pace groups
  spectators: string | null; // viewing spots / crowd support
  // Past-race enrichment from the matching run in the log:
  matchedRun?: {
    activity_id: string;
    pace: string | null;
    avg_hr: number | null;
    cadence: number | null;
    elev_gain_ft: number | null;
  } | null;
}

export interface RacesState {
  today: string;
  aRaces: RaceRow[];          // ALL upcoming A-races (CIM, LA Marathon, etc)
  aRace: RaceRow | null;       // the next one · kept for backward compat
  upcomingBs: RaceRow[];
  upcomingCs: RaceRow[];
  past: RaceRow[];
  totalUpcoming: number;
  totalPast: number;
}

/** Keep only the headline clause (before the first ";"). Drops verbose tails —
 *  the time limit's "; chip time … cutoff …" and the aid line's "; confirmed
 *  locations near Dupont & …" address list — that the runner does not need and
 *  that truncated mid-line on the card. Cleans stored values on read, so no
 *  re-crawl is needed (David 2026-06-17). */
function firstClause(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.split(';')[0].trim();
  return s || null;
}

export async function loadRacesState(userId: string): Promise<RacesState> {
  const today = await runnerToday(userId);

  const rows = (await pool.query(
    `SELECT slug, meta, actual_result FROM races
      WHERE user_uuid = $1
      ORDER BY (meta->>'date') NULLS LAST`,
    [userId]
  )).rows;

  const all: RaceRow[] = rows.map((r: any) => {
    const m = r.meta ?? {};
    const ar = r.actual_result ?? {};
    const date = m.date ?? null;
    const is_past = date ? date < today : false;
    const days = date
      ? Math.round((Date.parse(date + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86400000)
      : 0;
    // 2026-06-04 · finishTime ladder · runners log race results via
    // actual_result.finishS (the canonical write from /results endpoint);
    // meta.finishTime is the older convention. Prefer actual_result · it's
    // the explicit "I ran this in X" log, vs meta.finishTime which can
    // be stale. Falls back to the Strava-match path below when both null.
    let finishTime: string | null = m.finishTime ?? null;
    if (!finishTime && ar?.finishS && Number(ar.finishS) > 0) {
      const secs = Math.round(Number(ar.finishS));
      const h = Math.floor(secs / 3600);
      const mm = Math.floor((secs % 3600) / 60);
      const ss = secs % 60;
      finishTime = h > 0
        ? `${h}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`
        : `${mm}:${String(ss).padStart(2,'0')}`;
    }
    return {
      slug: r.slug,
      name: m.name ?? r.slug,
      date: date ?? '',
      priority: m.priority ?? null,
      goal: m.goalDisplay ?? null,
      distance_label: m.distanceLabel ?? null,
      distance_mi: m.distanceMi ? Number(m.distanceMi) : null,
      location: m.location ?? null,
      is_past,
      days,
      finishTime,
      // #29 · finishTime here is curated (actual_result.finishS or
      // meta.finishTime). The Strava-match path below flips this to true.
      finishProvisional: false,
      pb: m.pb ?? null,
      gun_time: m.startTime ?? m.gun_time ?? m.start_time ?? null,
      wave: m.wave ?? null,
      bib: m.bib ?? null,
      website: m.officialUrl ?? m.website ?? null,
      packet_pickup: m.packetPickup ?? m.packet_pickup ?? null,
      shuttle: m.shuttle ?? null,
      parking: m.parking ?? null,
      notes: m.notes ?? null,
      aid_stations: firstClause(m.aidStations ?? m.aid_stations),
      summary: m.summary ?? null,
      notable_miles: m.notableMiles ?? m.notable_miles ?? null,
      weather_norms: m.weatherNorms ?? m.weather_norms ?? null,
      time_limit: firstClause(m.timeLimit ?? m.time_limit),
      gear_check: m.gearCheck ?? m.gear_check ?? null,
      pacers: m.pacers ?? null,
      spectators: m.spectators ?? null,
    };
  });

  const upcoming = all.filter((r) => !r.is_past && r.date).sort((a, b) => a.date.localeCompare(b.date));
  const past     = all.filter((r) => r.is_past).sort((a, b) => b.date.localeCompare(a.date));

  // Enrich past races by matching each to a real run from the log.
  // Match rule: same date OR within 1 day AND distance within 1 mile.
  // Then pull finish time + pace + avg HR off that run.
  if (past.length > 0) {
    const earliestPast = past[past.length - 1].date;
    const candidates = (await pool.query(
      `SELECT data FROM runs
        WHERE user_uuid = $1
          AND NOT (data ? 'mergedIntoId')
          AND (data->>'distanceMi')::numeric > 2.5
          AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) >= $2
          AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) <= $3
        ORDER BY (data->>'distanceMi')::numeric DESC`,
      [userId, earliestPast, today]
    ).catch(() => ({ rows: [] }))).rows;

    for (const race of past) {
      if (!race.date) continue;
      const targetMi = race.distance_mi ?? distanceMiFromLabel(race.distance_label);
      let best: any = null;
      let bestScore = Infinity;
      for (const c of candidates) {
        const d = c.data;
        const day = d.date || (d.startLocal ?? '').slice(0, 10);
        if (!day) continue;
        const dayDelta = Math.abs(
          (Date.parse(day + 'T12:00:00Z') - Date.parse(race.date + 'T12:00:00Z')) / 86400000
        );
        if (dayDelta > 1) continue;
        const mi = Number(d.distanceMi);
        const miDelta = targetMi != null ? Math.abs(mi - targetMi) : 0;
        if (targetMi != null && miDelta > 2.0) continue;
        // Lower score = better match. Same day + close distance wins.
        const score = dayDelta * 10 + miDelta;
        if (score < bestScore) { best = d; bestScore = score; }
      }
      if (best) {
        // Auto-fill finish time + pace from the matched run if not already set.
        // #2 · COALESCE the moving-time key — webhook-ingested runs carry
        // movingSec/durationSec, not movingTimeS, so a strict movingTimeS read
        // returns null for them. Order: movingTimeS (pullSync/watch/HK) →
        // movingSec (webhook) → elapsedTimeS (last resort).
        const movingSec = Number(best.movingTimeS) || Number(best.movingSec) || Number(best.elapsedTimeS) || null;
        // #29 · only mark provisional when we actually fall back to the matched
        // run's raw time (race.finishTime was null). A curated finish already
        // present stays authoritative.
        const wasCurated = race.finishTime != null;
        const finish = race.finishTime ?? fmtDuration(movingSec);
        race.finishTime = finish;
        if (!wasCurated && finish != null) race.finishProvisional = true;
        race.matchedRun = {
          activity_id: best.id ?? best.activityId ?? `${best.date}-${Number(best.distanceMi).toFixed(2)}`,
          pace: best.avgPaceMinPerMi ?? fmtPace(Number(best.paceSPerMi) || null),
          avg_hr: Number(best.avgHr) || null,
          cadence: Number(best.avgCadence) || null,
          elev_gain_ft: Number(best.elevGainFt) || null,
        };
      }
    }
  }

  function distanceMiFromLabel(label: string | null): number | null {
    if (!label) return null;
    const l = label.toLowerCase();
    if (l.includes('marathon') && !l.includes('half')) return 26.2;
    if (l.includes('half') || l.includes('21k')) return 13.1;
    if (l.includes('10k')) return 6.2;
    if (l.includes('5k')) return 3.1;
    return null;
  }
  function fmtPace(s: number | null): string | null {
    if (!s || s <= 0) return null;
    const m = Math.floor(s / 60);
    return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  }
  function fmtDuration(secs: number | null): string | null {
    if (!secs || secs <= 0) return null;
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.round(secs % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  const aRaces = upcoming.filter((r) => r.priority === 'A');
  const aRace = aRaces[0] ?? null;
  const upcomingBs = upcoming.filter((r) => r.priority === 'B');
  const upcomingCs = upcoming.filter((r) => r.priority === 'C' || r.priority == null);

  return {
    today,
    aRaces,
    aRace,
    upcomingBs,
    upcomingCs,
    past,
    totalUpcoming: upcoming.length,
    totalPast: past.length,
  };
}
