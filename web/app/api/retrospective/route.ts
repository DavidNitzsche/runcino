/**
 * /api/retrospective — Claude writes the race narrative.
 *
 * Safety model: deterministic stats are computed client-side via
 * lib/retrospective.ts. Claude receives those facts and writes a
 * human-readable interpretation — it does NOT compute splits or
 * invent data.
 */

import Anthropic from '@anthropic-ai/sdk';
import { computeRetrospective, type ActualRace } from '../../../lib/retrospective';
import type { RuncinoPlan } from '../../../lib/types';

const RETROSPECTIVE_SYSTEM_PROMPT = `
You are Runcino's race retrospective writer. You receive a computed retrospective object — phase deltas, calibration coefficients, HR drift, weather log, and deterministic takeaways — and you write a 3-5 paragraph race report in the runner's voice.

# Hard rules

- The numbers you receive are the truth. You may quote them and interpret them, but never assert new numbers (mile positions, pace values, HR values) that aren't in the input.
- You are writing post-race reflection, not analysis novelty. The runner wants to know what the data says and what to carry forward.
- Warm, direct, a little wry. Like a coach texting after a race — no cheerleading, no cliché.
- End with a one-sentence take on readiness for the next race, based on the observed calibration.

# Output

Return JSON only:
{ "narrative": string }

The narrative should be 4-6 sentences, paragraph form, no headers or bullets.
`;

export async function POST(req: Request) {
  let body: { plan: RuncinoPlan; actual: ActualRace };
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const retro = computeRetrospective(body.plan, body.actual);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Deterministic stub — builds a plausible narrative from the numbers.
    const delta = retro.finish_delta_s;
    const deltaM = Math.floor(Math.abs(delta) / 60);
    const deltaS = Math.abs(delta) % 60;
    const climbVerdict =
      retro.calibration.climb_coefficient < 1.05 ? 'went to plan' : 'cost a bit more than projected';
    const largestDriftPhase = retro.phase_deltas.reduce((a, b) => Math.abs(b.deltaSPerMi) > Math.abs(a.deltaSPerMi) ? b : a);
    const windLine = retro.calibration.headwind_sensitivity_s_per_mi_per_mph
      ? `Wind cost about ${retro.calibration.headwind_sensitivity_s_per_mi_per_mph} sec/mi per mph on exposed sections. ${body.actual.weather.wind_mph} mph from ${body.actual.weather.wind_dir} explains most of the back-half slide.`
      : `Weather was quiet enough that the back half was pure pacing.`;
    const hrLine = retro.calibration.hr_drift_bpm < 6
      ? `HR drifted only ${retro.calibration.hr_drift_bpm} bpm from early to late — fueling and pacing held up.`
      : `HR drifted ${retro.calibration.hr_drift_bpm} bpm late — worth auditing fueling or effort in the first half.`;
    const verdict =
      Math.abs(delta) < 180 ? 'The plan read the race honestly.' :
      delta > 0 ? 'The course cost more than the plan allowed for.' :
      'Went faster than projected — worth checking if fitness has moved since we ran the numbers.';

    const narrative =
      `Finished ${Math.floor(retro.actual_finish_s / 3600)}:${String(Math.floor((retro.actual_finish_s % 3600) / 60)).padStart(2, '0')}:${String(retro.actual_finish_s % 60).padStart(2, '0')} against a ${Math.floor(retro.planned_finish_s / 3600)}:${String(Math.floor((retro.planned_finish_s % 3600) / 60)).padStart(2, '0')}:${String(retro.planned_finish_s % 60).padStart(2, '0')} plan — ${delta >= 0 ? `+${deltaM}:${String(deltaS).padStart(2, '0')} over` : `−${deltaM}:${String(deltaS).padStart(2, '0')} under`}.\n\n` +
      `The climbs ${climbVerdict} (climb coefficient ${retro.calibration.climb_coefficient.toFixed(2)}×). Biggest drift was in "${largestDriftPhase.label}" at ${largestDriftPhase.deltaSPerMi >= 0 ? '+' : ''}${largestDriftPhase.deltaSPerMi} sec/mi from target.\n\n` +
      `${windLine} ${hrLine}\n\n` +
      `${verdict}`;

    return Response.json({ narrative, stub: true });
  }

  const client = new Anthropic({ apiKey });
  const resp = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1200,
    system: [{ type: 'text', text: RETROSPECTIVE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{
      role: 'user',
      content: JSON.stringify({
        plan_goal_s: body.plan.goal.finish_time_s,
        actual_finish_s: body.actual.finish_time_s,
        weather: body.actual.weather,
        phase_deltas: retro.phase_deltas,
        calibration: retro.calibration,
        takeaways: retro.takeaways,
      }, null, 2),
    }],
  });

  let raw = '';
  for (const b of resp.content) if (b.type === 'text') raw += b.text;
  const jsonText = raw.replace(/```json\s*/i, '').replace(/```\s*$/i, '').trim();

  try {
    const parsed = JSON.parse(jsonText);
    return Response.json({ narrative: parsed.narrative, stub: false });
  } catch {
    return new Response(`Claude returned invalid JSON: ${jsonText.slice(0, 300)}`, { status: 502 });
  }
}
