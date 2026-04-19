/**
 * /api/goal — Claude-driven goal recommendation.
 *
 * Safety model:
 *   - Server-side: ANTHROPIC_API_KEY stays off-device.
 *   - Strict system prompt: Claude writes interpretation grounded in the
 *     runner's numbers + course facts. It is explicitly forbidden from
 *     inventing course facts ("what's at mile X" etc.).
 *   - If ANTHROPIC_API_KEY is missing, returns a canned stub so the UI
 *     flow is usable offline / during dev.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getCourseFacts } from '../../../lib/course-facts';
import { formatHMS, parseHMS } from '../../../lib/time';

const GOAL_SYSTEM_PROMPT = `
You are Runcino's goal-setting assistant. You help a runner pick an honest goal finish time for an upcoming marathon based on their current fitness and the course's character.

# Hard rules

- You receive JSON describing the runner's fitness and a trusted course facts summary. That is the only information you have about this runner and this race.
- You return interpretation (goal recommendation + rationale), NOT course facts. Do not describe what happens at specific miles of the course. Do not invent landmarks, fueling spots, weather patterns, or aid stations.
- Only reference course characteristics that are present in the course_facts payload (total gain, phase grades, phase names). If you refer to a landmark, quote its label exactly as provided.
- Be conservative. When sources of error cancel, say so. A runner who is marginally prepared gets a goal with more headroom.
- End with one recommended anchor time and a plausible range (low, high). These are h:mm:ss strings.

# Output format

Return ONLY a JSON object (no prose outside):

{
  "recommendedFinishS": number,       // seconds, e.g. 13800 for 3:50:00
  "rangeLowS": number,                // lower bound of the range
  "rangeHighS": number,               // upper bound
  "rationale": string,                // 2-4 sentence paragraph, warm but honest
  "riskFlags": [
    { "severity": "good" | "watch" | "risk", "text": string }
  ]
}

# Your tone

Warm, direct, a little wry. Like a coach who's watched you train for a year and wants you to finish strong, not prove something you haven't earned. No cheerleading. No fluff.
`;

type GoalRequestBody = {
  courseSlug: 'big-sur-marathon';
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
};

function coachStub(body: GoalRequestBody) {
  // Deterministic stub — applies the "Big Sur course penalty ≈ 10 min vs flat"
  // heuristic to the runner's baseline race. Used when no API key is set.
  const baselineS = parseHMS(body.fitness.baselineFinish) ?? 13200;
  const weeksSince = body.fitness.baselineMonthsAgo * 4;
  const restingHrDelta = body.fitness.restingHrTrend; // negative = fitter
  const mileageDelta = body.fitness.weeklyMileageTrend; // negative = detrained
  const longRunAgeWk = body.fitness.longestLongRunAgeWk;

  // Fitness adjustment: improvement if HR drop outweighs mileage drop
  const fitnessAdjS = Math.round(weeksSince * 10) - restingHrDelta * -30 + mileageDelta * 20;
  const coursePenaltyS = 600; // ~10 minutes for Big Sur
  const durabilityPenaltyS = longRunAgeWk > 2 ? 120 : 0;
  const recommendedS = baselineS + coursePenaltyS + fitnessAdjS + durabilityPenaltyS;
  // Round to nearest 5 min for aesthetics
  const rounded = Math.round(recommendedS / 300) * 300;

  const risks: Array<{ severity: 'good' | 'watch' | 'risk'; text: string }> = [];
  if (longRunAgeWk > 2) {
    risks.push({ severity: 'watch', text: `Only one 18+ mile run in last ${longRunAgeWk + 2} weeks — durability is the soft spot` });
  }
  if (mileageDelta < -2) {
    risks.push({ severity: 'watch', text: `Mileage trend is ${mileageDelta} mi/wk — likely taper ate some of the base` });
  }
  if (restingHrDelta < 0) {
    risks.push({ severity: 'good', text: `Resting HR trending ${restingHrDelta} bpm — strong positive signal` });
  }

  return {
    recommendedFinishS: rounded,
    rangeLowS: rounded - 300,
    rangeHighS: rounded + 300,
    rationale:
      `Your ${body.fitness.baselineName} ${body.fitness.baselineFinish} extrapolates to a flat-course equivalent close to the same today. Big Sur adds roughly 10 minutes to flat-marathon effort because of the climbs (especially the phase starting mile 10). Resting HR and mileage signals roughly offset. Anchoring at the range midpoint leaves room to push the back half if the day's going well.`,
    riskFlags: risks,
    stub: true,
  };
}

export async function POST(req: Request) {
  let body: GoalRequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const facts = getCourseFacts(body.courseSlug);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const s = coachStub(body);
    return Response.json({
      ...s,
      recommendedDisplay: formatHMS(s.recommendedFinishS),
      rangeLowDisplay: formatHMS(s.rangeLowS),
      rangeHighDisplay: formatHMS(s.rangeHighS),
    });
  }

  const client = new Anthropic({ apiKey });
  const userPayload = {
    course_facts: {
      name: facts.race.name,
      distance_mi: facts.race.expected_facts.distance_mi,
      total_gain_ft: facts.race.expected_facts.total_gain_ft,
      total_loss_ft: facts.race.expected_facts.total_loss_ft,
      phases: facts.phases.map(p => ({
        label: p.label,
        start_mi: p.start_mi,
        end_mi: p.end_mi,
        expected_mean_grade_pct: p.expected_mean_grade_pct,
        expected_gain_ft: p.expected_gain_ft,
      })),
    },
    fitness: body.fitness,
  };

  const resp = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: [{ type: 'text', text: GOAL_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: JSON.stringify(userPayload, null, 2) }],
  });

  let raw = '';
  for (const block of resp.content) if (block.type === 'text') raw += block.text;
  const jsonText = raw.replace(/```json\s*/i, '').replace(/```\s*$/i, '').trim();

  type ClaudeGoal = {
    recommendedFinishS: number;
    rangeLowS: number;
    rangeHighS: number;
    rationale: string;
    riskFlags: Array<{ severity: 'good' | 'watch' | 'risk'; text: string }>;
  };

  let parsed: ClaudeGoal;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return new Response(`Claude returned invalid JSON: ${jsonText.slice(0, 300)}`, { status: 502 });
  }

  return Response.json({
    recommendedFinishS: parsed.recommendedFinishS,
    recommendedDisplay: formatHMS(parsed.recommendedFinishS),
    rangeLowDisplay: formatHMS(parsed.rangeLowS),
    rangeHighDisplay: formatHMS(parsed.rangeHighS),
    rationale: parsed.rationale,
    riskFlags: parsed.riskFlags,
    stub: false,
  });
}
