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
 *  forwards the raw text in `conditions`.
 *
 *  Dewpoint patterns recognized: "dew point 65", "Td 65", "DP 65°F",
 *  "65°F dewpoint" (case-insensitive). When a dewpoint is present,
 *  the Coach uses the more accurate Tair+Td slowdown calculation
 *  (Research/06 §2). */
function parseWeather(text: string): { tempF?: number; dewpointF?: number; windMph?: number; conditions?: string } | undefined {
  if (!text || text.trim().length === 0) return undefined;
  // Pull all temperature-shaped tokens for disambiguation
  const tempMatch = text.match(/(?:^|[^/\d])(\d{2,3})\s*°?\s*F/i);
  const windMatch = text.match(/(\d{1,3})\s*mph/i);
  // Dewpoint heuristics — try several common phrasings.
  let dewpointF: number | undefined;
  const dpPatterns = [
    /dew[\s-]?point[^\d]*(\d{2,3})/i,
    /\bTd\s*[:=]?\s*(\d{2,3})/i,
    /\bDP\s*[:=]?\s*(\d{2,3})/i,
    /(\d{2,3})\s*°?\s*F\s*dew[\s-]?point/i,
  ];
  for (const re of dpPatterns) {
    const m = text.match(re);
    if (m) { dewpointF = Number(m[1]); break; }
  }
  return {
    tempF: tempMatch ? Number(tempMatch[1]) : undefined,
    dewpointF,
    windMph: windMatch ? Number(windMatch[1]) : undefined,
    conditions: text.trim(),
  };
}

/** Derive goal pace in seconds per mile from goalDisplay (e.g. "3:30:00")
 *  and total race distance (from phases). Returns null when either
 *  input can't be parsed cleanly. */
function deriveGoalPace(goalDisplay: string | undefined, totalMi: number): number | null {
  if (!goalDisplay || totalMi <= 0) return null;
  const m = goalDisplay.trim().match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (!m) return null;
  const h = m[3] ? Number(m[1]) : 0;
  const min = m[3] ? Number(m[2]) : Number(m[1]);
  const sec = m[3] ? Number(m[3]) : Number(m[2]);
  const totalS = h * 3600 + min * 60 + sec;
  if (totalS <= 0) return null;
  return Math.round(totalS / totalMi);
}

/** Pick an ability tier from goal pace. Marathon-anchored. */
function deriveAbilityTier(goalPaceSPerMi: number | null): 'elite' | 'mid_pack' | 'slow' {
  if (goalPaceSPerMi == null) return 'mid_pack';
  if (goalPaceSPerMi <= 420) return 'elite';      // ≤7:00/mi marathon (~3:03)
  if (goalPaceSPerMi <= 600) return 'mid_pack';   // ≤10:00/mi (~4:20)
  return 'slow';
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
  const totalMi = body.phases.length > 0 ? body.phases[body.phases.length - 1].endMi : 0;
  const goalPaceSPerMi = deriveGoalPace(body.goalDisplay, totalMi);
  const abilityTier = deriveAbilityTier(goalPaceSPerMi);
  // Course elevation isn't currently in course-facts; future field.
  // Treating as sea level for now keeps the slowdown calculation
  // skipping the altitude component (a no-op below 1000 ft).
  const elevationFt: number | undefined = undefined;

  let decision: CoachDecision<string>;
  try {
    decision = await coach.briefRaceMorning({
      today,
      raceName,
      raceDate: body.raceDate ?? today,
      goalDisplay: body.goalDisplay ?? '',
      weather: parseWeather(body.weatherText),
      courseSummary,
      goalPaceSPerMi: goalPaceSPerMi ?? undefined,
      abilityTier,
      elevationFt,
      raceDistanceMi: totalMi > 0 ? totalMi : undefined,
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
