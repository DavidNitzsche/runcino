/**
 * Claude-powered fueling planner.
 *
 * Reasons about glycogen depletion curves, pre-climb loading, aid station
 * water availability, heat/sweat adjustments, and gut sensitivity to place
 * gels where they'll actually help — not just evenly spaced.
 *
 * Falls back to the rule-based planFueling() if no API key or if Claude
 * fails, so build-plan always completes.
 */

import Anthropic from '@anthropic-ai/sdk';
import { planFueling, type FuelPlan, type FuelPlanInput } from './fueling';
import type { Phase } from './types';

const FUEL_SYSTEM_PROMPT = `
You are Runcino's fueling strategist. You place gels on a race course to maximize performance.

# Fueling science you must apply

- Carbs take 15-30 min to absorb. Place gels BEFORE hard efforts, not during.
- For 3:00-4:30 efforts, target 60-90g carbs/hr (default 60g if gut tolerance unknown).
- First gel: 45-60 minutes in.
- Never place a gel mid-climb — hard to open, swallow, and breathe. Place 1-2 miles before.
- Aid stations provide water. Snap gel timing to within 0.5 mi of an aid station when possible.
- In heat (>65°F finish), increase carb target by ~10g/hr.
- Final gel: no later than 4 miles from finish.
- Space gels so no gap exceeds 45 minutes of race time.

Call set_fueling_plan with your optimized schedule.
`.trim();

type ClaudeFuelInput = FuelPlanInput & {
  apiKey: string;
  weather?: string;
  aidStationMiles?: number[];
};

type ClaudeFuelOutput = {
  carbTargetGPerHr: number;
  gelCarbsG: number;
  gelBrand: string;
  totalCarbsG: number;
  gels: Array<{ number: number; atMi: number; phaseIdx: number; rationale: string }>;
  notes: string;
};

export async function planFuelingWithClaude(input: ClaudeFuelInput): Promise<FuelPlan> {
  const { phases, finishS, apiKey, weather, aidStationMiles } = input;

  const userPayload = {
    finish_time_s: finishS,
    finish_time_display: new Date(finishS * 1000).toISOString().slice(11, 19),
    weather: weather ?? 'unknown',
    gel_brand: input.gelBrand ?? 'Maurten',
    gel_carbs_g: input.gelCarbsG ?? 40,
    carb_target_g_per_hr_hint: input.carbTargetGPerHr ?? 60,
    gut_sensitivity: 'normal',
    aid_station_miles: aidStationMiles ?? [],
    phases: phases.map((p, i) => ({
      index: i,
      label: p.label,
      start_mi: Number(p.startMi.toFixed(2)),
      end_mi: Number(p.endMi.toFixed(2)),
      distance_mi: Number(p.distanceMi.toFixed(2)),
      mean_grade_pct: Number(p.meanGradePct.toFixed(1)),
      elevation_gain_ft: Math.round(p.elevationGainFt),
      elevation_loss_ft: Math.round(p.elevationLossFt),
      cumulative_time_s: p.cumulativeTimeS,
    })),
  };

  try {
    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: [{ type: 'text', text: FUEL_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: [{
        name: 'set_fueling_plan',
        description: 'Submit the optimized gel schedule for this race.',
        input_schema: {
          type: 'object' as const,
          required: ['carbTargetGPerHr', 'gelCarbsG', 'gelBrand', 'totalCarbsG', 'gels', 'notes'],
          properties: {
            carbTargetGPerHr: { type: 'number' },
            gelCarbsG: { type: 'number' },
            gelBrand: { type: 'string' },
            totalCarbsG: { type: 'number' },
            notes: { type: 'string', description: '1-2 sentence rationale for the overall strategy' },
            gels: {
              type: 'array',
              items: {
                type: 'object',
                required: ['number', 'atMi', 'phaseIdx', 'rationale'],
                properties: {
                  number: { type: 'number' },
                  atMi: { type: 'number', description: 'Mile marker for this gel, within the phase range' },
                  phaseIdx: { type: 'number', description: '0-based index into the phases array' },
                  rationale: { type: 'string', description: 'One sentence: why this mile, grounded in physiology or terrain' },
                },
              },
            },
          },
        },
      }],
      tool_choice: { type: 'tool', name: 'set_fueling_plan' },
      messages: [{ role: 'user', content: JSON.stringify(userPayload, null, 2) }],
    });

    const toolBlock = resp.content.find(b => b.type === 'tool_use');
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      throw new Error('Claude did not call set_fueling_plan');
    }
    const parsed = toolBlock.input as ClaudeFuelOutput;

    return claudeOutputToFuelPlan(parsed, phases);
  } catch (err) {
    console.error('[fueling-claude] Claude call failed, falling back to rule-based:', err);
    return planFueling(input);
  }
}

function claudeOutputToFuelPlan(output: ClaudeFuelOutput, phases: Phase[]): FuelPlan {
  const anchors = output.gels.map(g => ({
    atMi: g.atMi,
    gelNumber: g.number,
    phaseIdx: g.phaseIdx,
    rationale: g.rationale,
  }));

  return {
    summary: {
      carbTargetGPerHr: output.carbTargetGPerHr,
      totalCarbsG: output.totalCarbsG,
      gelCount: output.gels.length,
      gelCarbsG: output.gelCarbsG,
      gelBrand: output.gelBrand,
      notes: output.notes,
    },
    anchors,
  };
}
