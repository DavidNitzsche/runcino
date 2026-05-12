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

    // No races yet → empty array. The /races page handles the empty case
    // with a "NO RACES YET — ADD ONE" CTA; we never synthesize fake races.
    const rawRaces = await listRacesDB().catch(() => []);
    const allRaces = rawRaces;
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

