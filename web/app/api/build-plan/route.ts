/**
 * /api/build-plan — run the full pacing pipeline and return a __KEEP_DOT_FAFF.RUN_JSON__
 * payload plus a summary for UI display.
 */

import { parseGpx } from '../../../lib/gpx';
import { buildSegments } from '../../../lib/pacing';
import { groupPhases } from '../../../lib/grouping';
import { planFueling } from '../../../lib/fueling';
import { planFuelingWithClaude } from '../../../lib/fueling-claude';
import { assemblePlan } from '../../../lib/export';
import {
  getCourseFacts,
  shippableLandmarks,
  synthesizeCourseFacts,
  validateGpxAgainstCourse,
} from '../../../lib/course-facts';
import { formatHMS } from '../../../lib/time';
import type { FitnessSummary } from '../../../lib/types';

import type { GpxTrack } from '../../../lib/types';

type Body = {
  gpxText: string;
  /** Pre-computed DEM-enriched track. When present, used instead of
   *  re-parsing gpxText so pacing uses DEM elevation. */
  demTrack?: GpxTrack;
  /** Verified aid station mile marks from the extraction review panel. */
  verifiedAidStationMiles?: number[];
  /** A registered course slug ('big-sur-marathon', 'sombrero-half') OR a
   *  custom slug for a brand-new race the user just typed in. When the
   *  slug isn't recognized, raceName + raceDate must be supplied and the
   *  facts are synthesized from the GPX. */
  courseSlug: string;
  /** Required when courseSlug is unrecognized; ignored otherwise. */
  raceName?: string;
  raceDate: string;
  goalFinishS: number;
  strategy: 'even_effort' | 'even_split' | 'negative_split';
  toleranceSPerMi: number;
  weatherText?: string;
  fitness: {
    baselineName: string;
    baselineFinish: string;
    baselineMonthsAgo: number;
    weeklyMileage: number;
    weeklyMileageTrend: number;
    longestLongRunMi: number;
    longestLongRunAgeWk: number;
    restingHr: number;
    restingHrTrend: number;
    age?: string;
    weightLb?: string;
  };
  claudeRationale?: string | null;
};

function parseHMS(s: string): number | null {
  const m = s.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  if (!body.gpxText) return new Response('Missing gpxText', { status: 400 });
  if (!body.goalFinishS || body.goalFinishS < 600) {
    return new Response('Invalid goalFinishS', { status: 400 });
  }

  let track: GpxTrack;
  if (body.demTrack) {
    track = body.demTrack;
  } else {
    try {
      track = parseGpx(body.gpxText);
    } catch (err) {
      return new Response(`GPX parse error: ${err instanceof Error ? err.message : err}`, { status: 400 });
    }
  }

  // Look up the registered course; if unknown, synthesize facts from the
  // GPX so the user can drop in a brand-new race without pre-registration.
  let facts = getCourseFacts(body.courseSlug);
  if (!facts) {
    if (!body.raceName) {
      return new Response('raceName required for custom (unregistered) courseSlug', { status: 400 });
    }
    facts = synthesizeCourseFacts(track, {
      name: body.raceName,
      slug: body.courseSlug,
      date: body.raceDate,
    });
  }

  const check = validateGpxAgainstCourse(track, facts);

  const pacingInput = {
    goalFinishS: body.goalFinishS,
    strategy: body.strategy,
    toleranceSPerMi: body.toleranceSPerMi,
    segmentDistanceM: 800,
  };
  const segments = buildSegments(track, pacingInput);
  // Synthesized facts have empty phases[] — fall back to geometric grouping
  // so a brand-new course still gets a sensible 5-6 phase breakdown.
  const phases = groupPhases(
    segments,
    facts.phases.length > 0 ? { courseFacts: facts } : {}
  );
  // Prefer verified aid stations from the form's extraction review panel.
  // Fall back to curated course facts landmarks.
  const aidStationMiles: number[] = body.verifiedAidStationMiles?.length
    ? body.verifiedAidStationMiles
    : facts.landmarks.filter(l => l.kind === 'aid_station').map(l => l.at_mi);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const hasVerifiedAidStations = aidStationMiles.length > 0;
  const fueling = (apiKey && hasVerifiedAidStations)
    ? await planFuelingWithClaude({
        phases,
        finishS: body.goalFinishS,
        apiKey,
        weather: body.weatherText,
        aidStationMiles,
      })
    : planFueling({ phases, finishS: body.goalFinishS });
  const landmarks = shippableLandmarks(facts).map(l => ({ atMi: l.at_mi, label: l.label }));

  const fitnessSummary: FitnessSummary = {
    baselineRace: {
      name: body.fitness.baselineName,
      finishS: parseHMS(body.fitness.baselineFinish) ?? 0,
      monthsAgo: body.fitness.baselineMonthsAgo,
    },
    weeklyMileage: body.fitness.weeklyMileage,
    weeklyMileageTrend6Wk: body.fitness.weeklyMileageTrend,
    longestRecentLongRunMi: body.fitness.longestLongRunMi,
    longestRecentLongRunAgeWk: body.fitness.longestLongRunAgeWk,
    restingHrBpm: body.fitness.restingHr,
    restingHrTrend8Wk: body.fitness.restingHrTrend,
    age: body.fitness.age ? Number(body.fitness.age) : null,
    weightLb: body.fitness.weightLb ? Number(body.fitness.weightLb) : null,
    source: 'manual',
  };

  const plan = assemblePlan({
    race: { name: body.raceName ?? facts.race.name, date: body.raceDate },
    track,
    pacing: pacingInput,
    phases,
    fueling,
    fitnessSummary,
    landmarks,
    claudeRationale: body.claudeRationale ?? null,
    generator: 'faff-web@0.1.0',
  });

  const planJsonText = JSON.stringify(plan, null, 2);

  const summary = {
    raceName: body.raceName ?? facts.race.name,
    courseSlug: body.courseSlug,
    goalDisplay: formatHMS(body.goalFinishS),
    phases: phases.map(p => ({
      label: p.label,
      startMi: p.startMi,
      endMi: p.endMi,
      paceDisplay: p.targetPaceDisplay,
      grade: p.meanGradePct,
      cumulativeDisplay: p.cumulativeTimeDisplay,
    })),
    gelCount: fueling.summary.gelCount,
    totalCarbsG: fueling.summary.totalCarbsG,
    landmarkCount: landmarks.length,
    intervalCount: plan.intervals.length,
    geometryWarnings: check.warnings,
    geometryErrors: check.errors,
  };

  // Return DEM elevations array parallel to GPX trackpoints so the
  // detail page can render the elevation profile from DEM, not GPS.
  const demElevations = track.points.every(p => p.demEleM !== undefined)
    ? track.points.map(p => p.demEleM!)
    : undefined;

  return Response.json({ planJsonText, summary, demElevations });
}
