/**
 * /api/brief — race-morning brief generator.
 *
 * Takes a weather description (NOAA forecast paste) plus the existing plan,
 * returns a narrative + optional pace adjustments. Same guardrails as /api/goal:
 * Claude reasons about strategy; it does NOT invent course facts.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getCourseFacts } from '../../../lib/course-facts';

const BRIEF_SYSTEM_PROMPT = `
You are Runcino's race-morning briefer. You receive a race plan (phases with paces and landmarks) and a weather forecast the runner pastes in. You return a short narrative for the runner to read over coffee, plus optional pace adjustments.

# Hard rules

- Speak only to the weather, strategy, and pacing. Do not invent course facts, aid stations, or landmarks not in the plan.
- If conditions are unremarkable, say "no changes" and give a one-sentence head-up.
- Pace adjustments are integers in seconds per mile, referenced by phase index.
- Length: 3-6 sentences. Warm but direct. No cheerleading.

# Output format

JSON only:

{
  "narrative": string,
  "plan_adjustments": [
    { "phase_idx": number, "pace_delta_s_per_mi": number, "reason": string }
  ]
}
`;

type Body = {
  courseSlug: 'big-sur-marathon';
  weatherText: string;
  phases: Array<{ index: number; label: string; startMi: number; endMi: number; paceSPerMi: number; grade: number }>;
};

function briefStub(body: Body) {
  const hot = /\b(80|85|90|hot|humid)\b/i.test(body.weatherText);
  const windy = /\b(wind|gust|headwind|\d{2}\s*mph)\b/i.test(body.weatherText);
  const cool = /\b(40|45|50|cool|overcast)\b/i.test(body.weatherText);
  const adj: Array<{ phase_idx: number; pace_delta_s_per_mi: number; reason: string }> = [];
  let narrative = 'Conditions look unremarkable. Run the plan as written.';
  if (hot) {
    narrative = 'Warm day. Pace will drift late — start conservative, accept 5-10 sec/mi slowdown after mile 20, drink at every aid station.';
    if (body.phases.length >= 5) {
      adj.push({ phase_idx: 4, pace_delta_s_per_mi: +8, reason: 'heat drift in the bluffs' });
      adj.push({ phase_idx: 5, pace_delta_s_per_mi: +10, reason: 'heat sustain through finish' });
    }
  } else if (windy) {
    narrative = 'Wind in the forecast. Exposed sections (highway bluffs) will cost pace — don\'t force the number. Tuck in behind runners when you can.';
    if (body.phases.length >= 5) adj.push({ phase_idx: 4, pace_delta_s_per_mi: +4, reason: 'crosswind exposure' });
  } else if (cool) {
    narrative = 'Cool and favorable. Trust the pace plan. Don\'t overdress — you\'ll warm up fast after the first mile.';
  }
  return { narrative, plan_adjustments: adj, stub: true };
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const facts = getCourseFacts(body.courseSlug);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return Response.json(briefStub(body));

  const client = new Anthropic({ apiKey });
  const resp = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: [{ type: 'text', text: BRIEF_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{
      role: 'user',
      content: JSON.stringify({
        race: facts.race.name,
        phases: body.phases,
        weather: body.weatherText,
      }, null, 2),
    }],
  });

  let raw = '';
  for (const block of resp.content) if (block.type === 'text') raw += block.text;
  const jsonText = raw.replace(/```json\s*/i, '').replace(/```\s*$/i, '').trim();

  try {
    const parsed = JSON.parse(jsonText);
    return Response.json({ ...parsed, stub: false });
  } catch {
    return new Response(`Claude returned invalid JSON: ${jsonText.slice(0, 300)}`, { status: 502 });
  }
}
