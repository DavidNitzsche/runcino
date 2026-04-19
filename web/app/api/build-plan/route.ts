/**
 * /api/build-plan — run the full pacing pipeline and return a .runcino.json
 * payload plus a summary for UI display.
 */

import { parseGpx } from '../../../lib/gpx';
import { buildSegments } from '../../../lib/pacing';
import { groupPhases } from '../../../lib/grouping';
import { planFueling } from '../../../lib/fueling';
import { assemblePlan } from '../../../lib/export';
import {
  getCourseFacts,
  shippableLandmarks,
  validateGpxAgainstCourse,
} from '../../../lib/course-facts';
import { formatHMS } from '../../../lib/time';
import type { FitnessSummary } from '../../../lib/types';

type Body = {
  gpxText: string;
  courseSlug: 'big-sur-marathon';
  raceDate: string;
  goalFinishS: number;
  strategy: 'even_effort' | 'even_split' | 'negative_split';
  toleranceSPerMi: number;
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

  const facts = getCourseFacts(body.courseSlug);

  let track;
  try {
    track = parseGpx(body.gpxText);
  } catch (err) {
    return new Response(`GPX parse error: ${err instanceof Error ? err.message : err}`, { status: 400 });
  }

  const check = validateGpxAgainstCourse(track, facts);

  const pacingInput = {
    goalFinishS: body.goalFinishS,
    strategy: body.strategy,
    toleranceSPerMi: body.toleranceSPerMi,
    segmentDistanceM: 800,
  };
  const segments = buildSegments(track, pacingInput);
  const phases = groupPhases(segments, { courseFacts: facts });
  const fueling = planFueling({ phases, finishS: body.goalFinishS });
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
    race: { name: facts.race.name, date: body.raceDate },
    track,
    pacing: pacingInput,
    phases,
    fueling,
    fitnessSummary,
    landmarks,
    claudeRationale: body.claudeRationale ?? null,
    generator: 'runcino-web@0.1.0',
  });

  const planJsonText = JSON.stringify(plan, null, 2);

  const summary = {
    raceName: facts.race.name,
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

  return Response.json({ planJsonText, summary });
}
