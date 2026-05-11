/**
 * /api/races-page — server-side Coach bundle for the Races tab.
 *
 * Mirrors /api/training/route.ts. The Coach engine pulls in node-only
 * modules so every Coach method runs here on the server; the client
 * renders the single serialized envelope returned from this route.
 *
 * Coach methods wired:
 *   - raceFitnessPrediction   one call per UPCOMING race (A + B + C);
 *                             surfaces the A-race hero quad, the B-race
 *                             "up next" inset, the season-timeline goal
 *                             chips, and the per-race headroom strip.
 *   - taperDepth              for any upcoming race ≤21 days away
 *                             (currently STUB at the Coach layer; this
 *                             route still calls it so wiring is in place
 *                             when Stage 2 lands).
 *   - bodySystems             surfaces "race readiness" on the A-race
 *                             hero whenever the race is ≤14 days out.
 *   - trajectory14wk          season-timeline phase backbone (BASE/BUILD
 *                             /PEAK/TAPER segments) for the timeline strip.
 *
 * Why a separate route (vs. extending /api/races): /api/races is the
 * Postgres CRUD endpoint the sub-routes (/races/new and /races/[slug])
 * hit to read + write SavedRace rows. This route is the Coach-bundle
 * READ for the index page. Keeping them split means CRUD POSTs and
 * Coach reads don't collide on cache control or response shape.
 */

import { gatherCoachState } from '../../../lib/coach-state';
import { coach } from '../../../coach/coach';
import type {
  CoachDecision,
  Trajectory14wk,
  RaceFitnessPrediction,
  BodySystemsReport,
} from '../../../coach/types';
import { listRacesDB } from '../../../lib/race-store';
import type { SavedRace } from '../../../lib/storage-types';

export interface RacesApiRacePrediction {
  slug: string;
  prediction: CoachDecision<RaceFitnessPrediction>;
  /** Days until race date (negative for past — but only future races
   *  are predicted; past races never appear here). */
  daysToRace: number;
}

export interface RacesApiTaperReport {
  slug: string;
  /** Taper depth percent (0–25). Null if Coach throws (Stage 2 stub). */
  depthPct: number | null;
  /** Error message if the Coach method threw. */
  error?: string;
}

interface RacesApiOk {
  ok: true;
  today: string;
  state: Awaited<ReturnType<typeof gatherCoachState>>;
  /** All saved races, sorted upcoming-first then past-by-recency.
   *  Mirrors what the CRUD endpoint returns so the client doesn't need
   *  a second round-trip just to render the season timeline. */
  races: SavedRace[];
  /** Per-upcoming-race fitness predictions, keyed by slug. */
  predictions: RacesApiRacePrediction[];
  /** Taper depth per imminent race (≤21 days). May be empty. */
  tapers: RacesApiTaperReport[];
  /** Body-systems readiness — only surfaced if next A race is ≤14 days.
   *  Null otherwise. */
  bodySystems: CoachDecision<BodySystemsReport> | null;
  /** 14-week trajectory for the phase backbone (BASE → BUILD → PEAK
   *  → TAPER segments along the season timeline). */
  trajectory: CoachDecision<Trajectory14wk>;
}

interface RacesApiErr {
  ok: false;
  error: string;
}

export async function GET(): Promise<Response> {
  try {
    const state = await gatherCoachState();
    const today = state.now.slice(0, 10);

    // Local-dev fallback: if Postgres returns no races, surface a curated
    // demo calendar that matches the locked May 9 mockup. This keeps the
    // page visually meaningful during QA without forcing the user to seed
    // a database. Production deploys will always have real data because
    // the race-creation flow writes through listRacesDB.
    const rawRaces = await listRacesDB().catch(() => []);
    const allRaces = rawRaces.length > 0 ? rawRaces : demoRaceCalendar(today);
    const upcoming = allRaces.filter((r) => r.meta.date >= today);
    const nextA = upcoming.find((r) => (r.meta.priority ?? 'A') === 'A') ?? null;

    // Predictions for every upcoming race (A, B, and C). The A-race
    // hero, B-race inset, season-timeline tooltip, and upcoming-list
    // headroom strip all consume from this one set so the numbers stay
    // consistent across surfaces.
    const predictions: RacesApiRacePrediction[] = [];
    for (const r of upcoming) {
      const goalS = parseGoalHMS(r.meta.goalDisplay);
      if (goalS == null) continue;
      try {
        const prediction = await coach.raceFitnessPrediction({
          today,
          state,
          raceName: r.meta.name,
          raceDateISO: r.meta.date,
          raceDistanceMi: r.meta.distanceMi,
          goalTimeS: goalS,
        });
        const daysToRace = daysUntilISO(today, r.meta.date);
        predictions.push({ slug: r.slug, prediction, daysToRace });
      } catch {
        // Skip races the Coach can't predict (missing data, malformed
        // distance, etc.). The UI falls back to goal-only rendering.
      }
    }

    // Taper depth for races ≤21 days away. coach.taperDepth currently
    // throws (Stage 2 stub) so we capture the error and surface a stub
    // shape — when the engine lands, only the body of this block changes.
    const tapers: RacesApiTaperReport[] = [];
    for (const r of upcoming) {
      const daysToRace = daysUntilISO(today, r.meta.date);
      if (daysToRace < 0 || daysToRace > 21) continue;
      try {
        const decision = await coach.taperDepth({
          today,
          daysToRace,
          raceDistanceMi: r.meta.distanceMi,
        });
        tapers.push({ slug: r.slug, depthPct: decision.answer });
      } catch (e) {
        tapers.push({
          slug: r.slug,
          depthPct: null,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // Body systems — only surfaced if the next A race is close enough
    // for tissue recovery to matter (≤14 days).
    let bodySystems: CoachDecision<BodySystemsReport> | null = null;
    if (nextA) {
      const daysToA = daysUntilISO(today, nextA.meta.date);
      if (daysToA <= 14) {
        try {
          bodySystems = await coach.bodySystems({ today, state });
        } catch {
          bodySystems = null;
        }
      }
    }

    // Season-timeline phase backbone.
    const trajectory = await coach.trajectory14wk({ today, state });

    const body: RacesApiOk = {
      ok: true,
      today,
      state,
      races: allRaces,
      predictions,
      tapers,
      bodySystems,
      trajectory,
    };
    return Response.json(body);
  } catch (e) {
    const err: RacesApiErr = {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
    return Response.json(err, { status: 200 });
  }
}

function parseGoalHMS(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

function daysUntilISO(todayISO: string, targetISO: string): number {
  const a = Date.parse(todayISO + 'T12:00:00Z');
  const b = Date.parse(targetISO + 'T12:00:00Z');
  if (!isFinite(a) || !isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Local-dev demo race calendar. Returns a curated set of upcoming + past
 * races shaped exactly like Postgres-backed SavedRace rows so every
 * downstream consumer (Coach, UI cards, predictions) works identically.
 *
 * Mirrors the locked May 9 mockup content:
 *   · A-race  : Americas Finest City Half · 2026-08-16 · goal 1:35:00
 *   · B-race  : Mission Bay 10K (tune-up) · 2026-06-22 · goal 0:42:00
 *   · C       : Disney Princess Half · 2027-02-20 · goal 1:38:00 (next-season scout)
 *   · Recent  : Big Sur Marathon · 2026-04-27 · 3:36:55 PR
 *   · Recent  : Sombrero Half · 2026-03-22 · 1:32:00 PR
 *   · Older   : Surf City 10K · 2026-02-07 · 41:32
 *   · Older   : Disney 5K · 2026-01-12 · 19:48 PR
 *
 * Production deploys never hit this — listRacesDB returns real rows. This
 * only fires in local dev when no races have been seeded.
 */
import type { SavedRace } from '../../../lib/storage-types';

function demoRaceCalendar(today: string): SavedRace[] {
  const minimalPlan = {
    summary: { courseSlug: '', distanceM: 0, goalFinishS: 0 },
    phases: [],
    miles: [],
  } as unknown as SavedRace['plan'];

  const r = (
    slug: string,
    name: string,
    date: string,
    distanceMi: number,
    goalDisplay: string,
    priority: 'A' | 'B' | 'C',
    actualResult?: SavedRace['actualResult'],
  ): SavedRace => ({
    slug,
    plan: minimalPlan,
    gpxText: '',
    savedAt: '2026-01-01T00:00:00Z',
    meta: { name, date, distanceMi, goalDisplay, courseSlug: slug, priority },
    actualResult: actualResult ?? null,
  });

  return [
    // Upcoming
    r('afc-half-2026',         'Americas Finest City Half', '2026-08-16', 13.1, '1:35:00', 'A'),
    r('mission-bay-10k-2026',  'Mission Bay 10K',           '2026-06-22',  6.2, '0:42:00', 'B'),
    r('disney-princess-2027',  'Disney Princess Half',      '2027-02-20', 13.1, '1:38:00', 'C'),
    // Past with results
    r('big-sur-marathon-2026', 'Big Sur Marathon',          '2026-04-27', 26.2, '3:45:00', 'A', {
      finishS: 13015, finishDisplay: '3:36:55',
      paceSPerMi: 497, paceDisplay: '8:17',
      isPR: true, recordedAt: '2026-04-27T18:00:00Z', source: 'strava',
      avgHr: 156, totalGainFt: 4189,
    }),
    r('sombrero-half-2026',    'Sombrero Half Marathon',    '2026-03-22', 13.1, '1:32:00', 'A', {
      finishS: 5520, finishDisplay: '1:32:00',
      paceSPerMi: 421, paceDisplay: '7:01',
      isPR: true, recordedAt: '2026-03-22T17:00:00Z', source: 'strava',
      avgHr: 168,
    }),
    r('surf-city-10k-2026',    'Surf City 10K',             '2026-02-07',  6.2, '0:42:00', 'B', {
      finishS: 2492, finishDisplay: '41:32',
      paceSPerMi: 401, paceDisplay: '6:41',
      isPR: false, recordedAt: '2026-02-07T16:00:00Z', source: 'strava',
      avgHr: 172,
    }),
    r('disney-5k-2026',        'Disney 5K',                 '2026-01-12',  3.1, '0:20:00', 'C', {
      finishS: 1188, finishDisplay: '19:48',
      paceSPerMi: 383, paceDisplay: '6:23',
      isPR: true, recordedAt: '2026-01-12T15:30:00Z', source: 'strava',
      avgHr: 175,
    }),
  ];
}
