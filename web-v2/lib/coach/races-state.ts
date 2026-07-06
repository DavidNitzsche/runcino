/**
 * races-state.ts
 * Loads the season-of-races view: the A-race amplified, upcoming Bs/Cs, past races.
 */
import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { distanceMiFromLabel } from '@/lib/race/distance';

/** The one provisional-finish label every surface renders verbatim.
 *  Wording is the CLAUDE.md race-data Rule 3 canonical example. */
export const PROVISIONAL_FINISH_LABEL = 'Training effort · race to lock in';

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
  // 2026-07-06 · P1-19 · where finishTime came from, so surfaces can label
  // provenance without re-deriving it:
  //   'actual_result' — races.actual_result.finishS (canonical chip time)
  //   'meta'          — races.meta.finishTime (curated retro entry)
  //   'run_match'     — auto-filled from a date+distance-matched training
  //                     run (ALWAYS provisional · Rule 3)
  finishSource: 'actual_result' | 'meta' | 'run_match' | null;
  // Non-null exactly when finishProvisional — the render-ready caption
  // ('Training effort · race to lock in'). Surfaces show it verbatim next
  // to the time instead of inventing their own wording.
  finishProvisionalLabel: string | null;
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
    //
    // 2026-07-06 · P1-19 fix · the code had the ladder INVERTED vs its own
    // comment: meta.finishTime was read first, so a stale meta entry beat
    // the canonical chip time. actual_result.finishS now wins, per the
    // CLAUDE.md race-data lock ("curated chip times beat raw" — and beat
    // stale meta too). finishSource records which rung supplied the value.
    let finishTime: string | null = null;
    let finishSource: RaceRow['finishSource'] = null;
    if (ar?.finishS && Number(ar.finishS) > 0) {
      const secs = Math.round(Number(ar.finishS));
      const h = Math.floor(secs / 3600);
      const mm = Math.floor((secs % 3600) / 60);
      const ss = secs % 60;
      finishTime = h > 0
        ? `${h}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`
        : `${mm}:${String(ss).padStart(2,'0')}`;
      finishSource = 'actual_result';
    } else if (m.finishTime) {
      finishTime = m.finishTime;
      finishSource = 'meta';
    }
    return {
      slug: r.slug,
      name: m.name ?? r.slug,
      date: date ?? '',
      priority: m.priority ?? null,
      goal: m.goalDisplay ?? null,
      distance_label: m.distanceLabel ?? null,
      // 2026-07-06 · P1-17 · read-time backfill: rows created by POST
      // /api/race + onboarding before this date carry distanceLabel only.
      // Deriving here (no DB write) lights up pacing/fueling/execution-plan
      // for every existing race immediately. New writes set meta.distanceMi.
      distance_mi: m.distanceMi ? Number(m.distanceMi) : distanceMiFromLabel(m.distanceLabel ?? null),
      location: m.location ?? null,
      is_past,
      days,
      finishTime,
      // #29 · finishTime here is curated (actual_result.finishS or
      // meta.finishTime). The Strava-match path below flips this to true.
      finishProvisional: false,
      finishSource,
      finishProvisionalLabel: null,
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
  // Match rule: within ±1 day AND distance within 10% of the race distance
  // (floor 0.31 mi, cap 2.0 mi — see the P1-19 note in the loop).
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
      const targetMi = race.distance_mi; // label fallback already applied at row build
      // 2026-07-06 · P1-19 · distance tolerance is PROPORTIONAL to the race
      // distance, not a flat 2.0 mi. The flat window let a 4-mi easy jog
      // (miDelta 0.9) or a 2.6-mi shakeout (0.5) match a 5K and headline as
      // its finish time. 10% of race distance (floor 0.31 mi ≈ GPS wobble on
      // a 5K, cap 2.0 mi so the marathon window never WIDENS vs the old rule)
      // keeps real matches — a 26.5-mi marathon file, a 13.3-mi half — while
      // rejecting adjacent training runs. dayDelta ±1 stays: race files can
      // land on the neighbor calendar day via the known startLocal→UTC drift.
      const miTolerance = targetMi != null ? Math.min(2.0, Math.max(0.31, targetMi * 0.10)) : null;
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
        if (miTolerance != null && miDelta > miTolerance) continue;
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
        // present — actual_result ALWAYS wins, then meta — stays authoritative.
        // 2026-07-06 · P1-19 · provisional fills now carry the render-ready
        // label + source so every surface (iPhone RaceDayView hero included)
        // can show 'Training effort · race to lock in' instead of presenting
        // a matched training run as the authoritative result (Rule 3).
        const wasCurated = race.finishTime != null;
        const finish = race.finishTime ?? fmtDuration(movingSec);
        race.finishTime = finish;
        if (!wasCurated && finish != null) {
          race.finishProvisional = true;
          race.finishSource = 'run_match';
          race.finishProvisionalLabel = PROVISIONAL_FINISH_LABEL;
        }
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

  // (local distanceMiFromLabel fork removed 2026-07-06 · P1-17 — the shared
  // lib/race/distance.ts parser is applied at row build, so distance_mi is
  // already label-backfilled by the time the match loop reads it.)
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
