/**
 * /api/brief — race-morning brief generator.
 *
 * Stage 2 wired: delegates to `coach.briefRaceMorning(...)`. The Coach
 * routes the call through the LLM brain when `ANTHROPIC_API_KEY` is
 * present (with voice.md + coaching-research.md cached), and falls
 * back to a deterministic stub when not.
 *
 * The legacy response shape — `{ narrative, plan_adjustments, stub }`
 * — is preserved so the existing BriefTile keeps working. The richer
 * `CoachDecision` (rationale + citations) is delivered in a `coach`
 * sub-object the tile picks up incrementally.
 */
import { coach } from '../../../coach/coach';
import { llmAvailable } from '../../../coach/llm';
import { getCourseFacts } from '../../../lib/course-facts';
import type { CoachDecision } from '../../../coach/types';

type Body = {
  courseSlug: string;
  raceName?: string;
  raceDate?: string;
  goalDisplay?: string;
  weatherText: string;
  phases: Array<{ index: number; label: string; startMi: number; endMi: number; paceSPerMi: number; grade: number }>;
};

/** Build a one-line course summary from the plan's phases for the
 *  Coach prompt. Avoids inventing course facts the Coach doesn't have. */
function summarizeCourse(body: Body, raceName: string): string {
  const total = body.phases.length > 0
    ? body.phases[body.phases.length - 1].endMi
    : 0;
  if (total <= 0) return `${raceName}, distance unknown.`;
  const peakGrade = Math.max(...body.phases.map(p => p.grade));
  const peakPhase = body.phases.find(p => p.grade === peakGrade);
  const peakNote = peakPhase && peakGrade > 1
    ? `, with the steepest section near mile ${((peakPhase.startMi + peakPhase.endMi) / 2).toFixed(1)} at ${peakGrade.toFixed(1)}% grade`
    : '';
  return `${raceName}, ${total.toFixed(1)} mi, ${body.phases.length} sectors${peakNote}.`;
}

/** Parse a free-text NOAA-style forecast into the structured weather
 *  the Coach expects. Best-effort regex; if it can't parse, just
 *  forwards the raw text in `conditions`. */
function parseWeather(text: string): { tempF?: number; windMph?: number; conditions?: string } | undefined {
  if (!text || text.trim().length === 0) return undefined;
  const tempMatch = text.match(/(\d{2,3})\s*°?\s*F/i);
  const windMatch = text.match(/(\d{1,3})\s*mph/i);
  return {
    tempF: tempMatch ? Number(tempMatch[1]) : undefined,
    windMph: windMatch ? Number(windMatch[1]) : undefined,
    conditions: text.trim(),
  };
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const facts = getCourseFacts(body.courseSlug);
  const raceName = body.raceName ?? facts?.race.name ?? body.courseSlug;
  const courseSummary = summarizeCourse(body, raceName);
  const today = new Date().toISOString().slice(0, 10);

  let decision: CoachDecision<string>;
  try {
    decision = await coach.briefRaceMorning({
      today,
      raceName,
      raceDate: body.raceDate ?? today,
      goalDisplay: body.goalDisplay ?? '',
      weather: parseWeather(body.weatherText),
      courseSummary,
    });
  } catch (e) {
    return new Response(
      `Coach failed: ${e instanceof Error ? e.message : String(e)}`,
      { status: 502 },
    );
  }

  // Legacy shape for the existing BriefTile + a `coach` sub-object
  // that surfaces the rationale + citations.
  return Response.json({
    narrative: decision.answer,
    plan_adjustments: [], // Brief no longer prescribes pace deltas — voice rules call for run-the-plan.
    stub: decision.brain === 'deterministic',
    coach: {
      rationale: decision.rationale,
      citations: decision.citations,
      brain: decision.brain,
      llmAvailable: llmAvailable(),
    },
  });
}
