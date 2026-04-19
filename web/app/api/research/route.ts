/**
 * /api/research — drive the course-research pipeline.
 *
 * Delegates to lib/course-research.researchCourse. Requires
 * ANTHROPIC_API_KEY. Without a key, returns a realistic stub keyed to
 * the race name (hard-coded CIM example) so the review UI still works.
 */

import { researchCourse } from '../../../lib/course-research';
import type { CourseFacts } from '../../../lib/course-facts';

type Body = {
  raceName: string;
  officialUrl?: string;
  typicalDate?: string;
  expectedDistanceMi?: number;
};

function cimStub(): CourseFacts {
  return {
    race: {
      name: 'California International Marathon',
      slug: 'california-international-marathon',
      description: 'Point-to-point marathon from Folsom Dam to the California State Capitol in Sacramento.',
      course_type: 'point_to_point',
      typical_date: 'first Sunday of December',
      expected_facts: {
        distance_mi: 26.22,
        distance_m: 42195,
        total_gain_ft: 350,
        total_loss_ft: 690,
        net_ft: -340,
      },
      expected_tolerances: { distance_mi: 0.2, gain_ft: 400, loss_ft: 400 },
      sources: [
        {
          url: 'https://www.runsra.org/california-international-marathon',
          title: 'CIM · official race page',
          confidence: 'primary_source_verified',
          verified_at: '2026-04-19',
          verified_quote: 'USATF-certified 26.2-mile point-to-point course from Folsom to the California State Capitol',
        },
      ],
    },
    phases: [
      {
        index: 0, label: 'Folsom descent', start_mi: 0, end_mi: 6,
        expected_mean_grade_pct: -1.2, note: 'Gradual descent off Folsom Dam. Tempting to go fast — hold back.',
        sources: [{ url: 'https://www.runsra.org/california-international-marathon', confidence: 'primary_source_verified', verified_at: '2026-04-19' }],
      },
      {
        index: 1, label: 'Rolling through Fair Oaks', start_mi: 6, end_mi: 13,
        expected_mean_grade_pct: -0.4, note: 'Rolling with Fair Oaks Bridge at mile 9. Net-down but not flat.',
        sources: [{ url: 'https://www.runsra.org/california-international-marathon', confidence: 'primary_source_verified', verified_at: '2026-04-19' }],
      },
      {
        index: 2, label: 'Carmichael straight', start_mi: 13, end_mi: 20,
        expected_mean_grade_pct: -0.2, note: 'Long straights through Carmichael. Mind the crowd thinning.',
        sources: [{ url: 'https://www.runsra.org/california-international-marathon', confidence: 'primary_source_verified', verified_at: '2026-04-19' }],
      },
      {
        index: 3, label: 'H-Street to finish', start_mi: 20, end_mi: 26.22,
        expected_mean_grade_pct: -0.1, note: 'Into East Sacramento. H-Street Bridge at mi 25, Capitol finish at 26.2.',
        sources: [{ url: 'https://www.runsra.org/california-international-marathon', confidence: 'primary_source_verified', verified_at: '2026-04-19' }],
      },
    ],
    landmarks: [
      {
        at_mi: 9, kind: 'landmark', label: 'Fair Oaks Bridge',
        note: 'Historic bridge crossing at mile 9.',
        sources: [{
          url: 'https://www.runsra.org/california-international-marathon',
          confidence: 'primary_source_verified',
          verified_at: '2026-04-19',
          verified_quote: 'Runners cross the historic Fair Oaks Bridge at mile 9',
        }],
      },
      {
        at_mi: 25, kind: 'landmark', label: 'H-Street Bridge · final mile',
        note: 'Signals the final mile into downtown Sacramento.',
        sources: [{
          url: 'https://www.runnersworld.com/races-places/a21262447/cim',
          confidence: 'secondary_source',
          verified_at: '2026-04-19',
        }],
      },
      {
        at_mi: 26.2, kind: 'landmark', label: 'California State Capitol',
        note: 'Finish line at the Capitol steps.',
        sources: [{
          url: 'https://www.runsra.org/california-international-marathon',
          confidence: 'primary_source_verified',
          verified_at: '2026-04-19',
        }],
      },
    ],
    notes_from_sources: {},
    warnings: {},
  };
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  if (!body.raceName) {
    return new Response('Missing raceName', { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Stub — returns CIM as an example; other race names get a minimal
    // placeholder so the UI flow remains usable.
    const isCim = body.raceName.toLowerCase().includes('california') ||
                  body.raceName.toLowerCase().includes('cim');
    const facts = isCim ? cimStub() : minimalStub(body);
    return Response.json({
      slug: facts.race.slug,
      facts,
      reasoning: isCim
        ? `Using cached CIM example (no ANTHROPIC_API_KEY set). Started from the official URL, confirmed distance, extracted 4 phases and 3 landmarks with source citations.`
        : `Stub mode (no ANTHROPIC_API_KEY set). Returned a minimal placeholder for "${body.raceName}". Add an API key to run real research.`,
      unresolvedQuestions: isCim ? ['H-Street bridge mile marker cited in Runner\'s World only — verify against official course map PDF.'] : ['Live research disabled in stub mode.'],
      stub: true,
    });
  }

  try {
    const result = await researchCourse({
      raceName: body.raceName,
      officialUrl: body.officialUrl,
      typicalDate: body.typicalDate,
      expectedDistanceMi: body.expectedDistanceMi,
    });
    return Response.json({
      slug: result.slug,
      facts: result.facts,
      reasoning: result.reasoning,
      unresolvedQuestions: result.unresolvedQuestions,
      stub: false,
    });
  } catch (err) {
    return new Response(`Research failed: ${err instanceof Error ? err.message : err}`, { status: 502 });
  }
}

function minimalStub(body: Body): CourseFacts {
  const slug = body.raceName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return {
    race: {
      name: body.raceName,
      slug,
      description: `Race: ${body.raceName}`,
      course_type: 'point_to_point',
      typical_date: body.typicalDate ?? 'unknown',
      expected_facts: {
        distance_mi: body.expectedDistanceMi ?? 26.22,
        distance_m: Math.round((body.expectedDistanceMi ?? 26.22) * 1609.344),
        total_gain_ft: 0,
        total_loss_ft: 0,
        net_ft: 0,
      },
      expected_tolerances: { distance_mi: 0.2, gain_ft: 400, loss_ft: 400 },
      sources: body.officialUrl ? [{
        url: body.officialUrl,
        confidence: 'secondary_source',
        verified_at: new Date().toISOString().slice(0, 10),
      }] : [],
    },
    phases: [],
    landmarks: [],
    notes_from_sources: {},
    warnings: {
      stub: 'This is a placeholder. Run real research with an ANTHROPIC_API_KEY to populate phases + landmarks.',
    },
  };
}
