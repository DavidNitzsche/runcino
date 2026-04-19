/**
 * /api/plan-week — generate a training block or a single week.
 *
 * Current implementation: deterministic rule-based (lib/training.ts).
 * Swap target: Claude-authored weekly plans grounded in HealthKit
 * signals + philosophy choice. The schema (TrainingBlock) stays the
 * same; only the generator changes.
 */

import { generateBlock, generateWeek, currentWeekNumber } from '../../../lib/training';

type Body = {
  goalRaceName: string;
  goalRaceDate: string;
  basePaceSPerMi: number;
  weeksTotal?: number;
  peakMpw?: number;
  hilly?: boolean;
  philosophy?: 'pfitz' | 'daniels' | 'hanson' | 'custom';
  /** If present, return just this week's plan + currentWeekNumber context. */
  forDateISO?: string;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  if (!body.goalRaceName || !body.goalRaceDate || !body.basePaceSPerMi) {
    return new Response('Missing goalRaceName / goalRaceDate / basePaceSPerMi', { status: 400 });
  }

  const block = generateBlock({
    goalRaceName: body.goalRaceName,
    goalRaceDate: body.goalRaceDate,
    weeksTotal: body.weeksTotal,
    peakMpw: body.peakMpw,
    basePaceSPerMi: body.basePaceSPerMi,
    philosophy: body.philosophy,
    hilly: body.hilly,
  });

  if (body.forDateISO) {
    const weekNum = currentWeekNumber(body.forDateISO, block);
    const week = block.weeks[weekNum - 1];
    return Response.json({
      block: {
        goalRace: block.goalRace,
        goalDate: block.goalDate,
        weeksTotal: block.weeksTotal,
        peakMpw: block.peakMpw,
        philosophy: block.philosophy,
      },
      week,
      weekNumber: weekNum,
      engine: 'rule-based',
      stub: false,
    });
  }

  return Response.json({ block, engine: 'rule-based', stub: false });
}
