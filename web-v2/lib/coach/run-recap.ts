/**
 * lib/coach/run-recap.ts · "WHAT THIS RUN DID" post-run engine.
 *
 * Takes a completed canonical run + its planned-workout intent + the
 * conditions it ran in, returns 1-2 sentences of plain English about
 * what the stimulus actually was. Heat-aware: when conditions explain
 * a slowdown or HR drift, the recap honors that instead of judging
 * the runner against an impossible pace target.
 *
 * Doctrine sources:
 *   · Research/04-workout-vocabulary.md · per-type expectations
 *   · Research/06-weather-adjustments.md · heat-adjusted honest pace
 *   · Research/15-wearable-data.md · cardiovascular drift signal
 *   · Research/00a-distance-running-training.md · stimulus vs prescription
 *
 * Output shape (matches PurposePayload so consumers can share renderer):
 *   {
 *     verdict:  string,         // "Banked the long" / "Held threshold" / ...
 *     facts:    string[],       // 1-2 sentences on what landed
 *     coach_tip: string | null, // forward-looking advice when warranted
 *     conditions_note: string | null,  // null when neutral
 *     citations: Citation[]
 *   }
 */
import type { Citation, Phase, WorkoutType } from '@/lib/coach/run-purpose';
import {
  judgeWeather,
  type WeatherInput,
  type WeatherJudgment,
} from '@/lib/coach/weather-adjust';

export interface RecapInput {
  type: WorkoutType;
  phase: Phase | null;
  plannedMi: number;
  /** Plan-side target pace (s/mi). null when by-feel. */
  plannedPaceSPerMi?: number | null;
  /** Plan-side HR cap (bpm). null when by-feel. */
  plannedHrCap?: number | null;
  /** Actual canonical-row execution. */
  actualMi: number;
  actualPaceSPerMi: number | null;
  actualAvgHr: number | null;
  actualMaxHr: number | null;
  /** Mile-by-mile splits with pace + HR per segment when available. */
  splits?: Array<{
    mile?: number;
    paceSPerMi?: number | null;
    avgHr?: number | null;
  }>;
  weather?: WeatherInput | null;
}

export interface RecapPayload {
  verdict: string;
  facts: string[];
  coach_tip: string | null;
  conditions_note: string | null;
  citations: Citation[];
}

const CITE_VOCAB: Citation = {
  slug: 'research-04-workout-vocabulary',
  label: 'Research/04 · Workout Vocabulary',
};
const CITE_WEAR: Citation = {
  slug: 'research-15-wearable-data',
  label: 'Research/15 · Wearable Data',
};
const CITE_WEATHER: Citation = {
  slug: 'research-06-weather-adjustments',
  label: 'Research/06 · Weather Adjustments',
};

function paceLabel(spm: number | null | undefined): string | null {
  if (!spm || spm <= 0) return null;
  return `${Math.floor(spm / 60)}:${String(Math.round(spm % 60)).padStart(2, '0')}/mi`;
}

/**
 * Detect cardiovascular drift across the run: did HR climb in the back
 * half while pace held or slowed? Returns {drift, firstHr, lastHr} when
 * we have enough split signal. Research/15 frames this as the canonical
 * heat / dehydration / fatigue marker for steady efforts.
 */
function detectHrDrift(splits: RecapInput['splits']): {
  drift: number;
  firstHr: number;
  lastHr: number;
} | null {
  if (!splits || splits.length < 4) return null;
  const withHr = splits
    .map((s, i) => ({ i, hr: typeof s.avgHr === 'number' ? s.avgHr : null }))
    .filter((s): s is { i: number; hr: number } => s.hr != null && s.hr > 0);
  if (withHr.length < 4) return null;
  const half = Math.floor(withHr.length / 2);
  const first = withHr.slice(0, half);
  const last = withHr.slice(-half);
  const firstAvg = first.reduce((s, x) => s + x.hr, 0) / first.length;
  const lastAvg = last.reduce((s, x) => s + x.hr, 0) / last.length;
  return {
    drift: Math.round(lastAvg - firstAvg),
    firstHr: Math.round(firstAvg),
    lastHr: Math.round(lastAvg),
  };
}

/**
 * Detect back-half pace fade: did the last third of the run slow vs the
 * first two thirds? Returns the slowdown in s/mi.
 */
function detectPaceFade(splits: RecapInput['splits']): number | null {
  if (!splits || splits.length < 5) return null;
  const withPace = splits.filter((s) => typeof s.paceSPerMi === 'number' && s.paceSPerMi! > 0);
  if (withPace.length < 5) return null;
  const cut = Math.floor(withPace.length * 2 / 3);
  const front = withPace.slice(0, cut).map(s => s.paceSPerMi!);
  const back = withPace.slice(cut).map(s => s.paceSPerMi!);
  const frontAvg = front.reduce((s, x) => s + x, 0) / front.length;
  const backAvg = back.reduce((s, x) => s + x, 0) / back.length;
  return Math.round(backAvg - frontAvg);
}

export function deriveRecap(input: RecapInput): RecapPayload {
  const weather = input.weather ? judgeWeather(input.weather) : null;
  const drift = detectHrDrift(input.splits);
  const fade = detectPaceFade(input.splits);
  const paceStr = paceLabel(input.actualPaceSPerMi);

  const facts: string[] = [];
  const citations: Citation[] = [CITE_VOCAB];
  let conditions_note: string | null = null;
  let coach_tip: string | null = null;

  // Compose the conditions sentence FIRST when it's material · it
  // changes how we interpret pace + HR drift.
  const conditionsMaterial = weather?.shouldFlagInRecap === true;
  if (conditionsMaterial && weather) {
    conditions_note = `${weather.summary} · Maughan/Ely model expects ~${weather.slowdownPct.toFixed(1)}% honest slowdown vs 50°F.`;
    citations.push(CITE_WEATHER);
    if (weather.coachTipForNextTime) coach_tip = weather.coachTipForNextTime;
  }

  // Heat-aware judgment on HR drift + pace fade.
  const heatExplainsDrift =
    conditionsMaterial && (weather?.heatBand === 'warm' || weather?.heatBand === 'hot' || weather?.heatBand === 'extreme');

  switch (input.type) {
    case 'long': {
      facts.push(
        `Long aerobic stimulus banked · ${input.actualMi.toFixed(1)} mi${paceStr ? ' at ' + paceStr : ''}${input.actualAvgHr ? ', avg HR ' + input.actualAvgHr : ''}. The mitochondrial and capillary work doesn't care about the last-mile split — what counts is the time the slow-twitch fibers spent under load.`,
      );
      if (drift && drift.drift >= 8) {
        if (heatExplainsDrift) {
          facts.push(
            `HR climbed ${drift.drift} bpm from first half (${drift.firstHr}) to last (${drift.lastHr}) — cardiovascular drift at this temperature is expected, not a fitness signal. You did the right thermoregulatory work; the engine stayed honest.`,
          );
          citations.push(CITE_WEAR);
        } else {
          facts.push(
            `HR drifted ${drift.drift} bpm from first half to last (${drift.firstHr} → ${drift.lastHr}). Fueling + hydration cadence are the usual culprits on long runs — watch the second-half splits next week.`,
          );
          citations.push(CITE_WEAR);
        }
      }
      if (fade && fade > 25 && !heatExplainsDrift) {
        facts.push(`Back-third pace softened by ~${fade}s/mi. Worth checking fueling rhythm and last-meal timing.`);
      }
      return {
        verdict: 'Banked the long.',
        facts,
        coach_tip,
        conditions_note,
        citations,
      };
    }

    case 'easy': {
      facts.push(
        `Aerobic miles in the bank · ${input.actualMi.toFixed(1)} mi${paceStr ? ' at ' + paceStr : ''}. Boring is the point. The adaptation is from time on feet, not heroics.`,
      );
      if (input.plannedHrCap && input.actualAvgHr && input.actualAvgHr > input.plannedHrCap + 5) {
        if (heatExplainsDrift) {
          facts.push(`Avg HR ${input.actualAvgHr} ran a touch above the ${input.plannedHrCap} cap, but ${weather!.heatBand} conditions explain it · effort was honest.`);
        } else {
          facts.push(`Avg HR ${input.actualAvgHr} drifted past the ${input.plannedHrCap} cap. Slow it down next time — the easy day works when it's actually easy.`);
        }
      }
      return {
        verdict: 'Banked the easy.',
        facts,
        coach_tip,
        conditions_note,
        citations,
      };
    }

    case 'tempo':
    case 'threshold': {
      facts.push(
        `Threshold work landed · ${input.actualMi.toFixed(1)} mi${paceStr ? ' at ' + paceStr : ''}${input.actualAvgHr ? ', avg HR ' + input.actualAvgHr : ''}. Lactate-clearance training compounds across weeks; one session doesn't move the needle alone, but the bank does.`,
      );
      if (heatExplainsDrift && weather!.slowdownPct >= 4) {
        facts.push(`Pace targets read ~${weather!.slowdownPct.toFixed(1)}% slower in ${weather!.heatBand} conditions · if you hit the planned HR band, the stimulus is the same regardless of clock pace.`);
      }
      return {
        verdict: 'Sat on threshold.',
        facts,
        coach_tip,
        conditions_note,
        citations,
      };
    }

    case 'intervals': {
      facts.push(
        `VO2 stimulus delivered · ${input.actualMi.toFixed(1)} mi total${paceStr ? ' at ' + paceStr + ' avg' : ''}${input.actualMaxHr ? ', peak HR ' + input.actualMaxHr : ''}. The work bouts pushed the aerobic ceiling; the easy jog recoveries protected the next rep.`,
      );
      if (heatExplainsDrift) {
        facts.push(`Heat compresses interval splits · pace by feel, not the clock. The fitness gain is from the HR + ventilation response, not the split times.`);
      }
      return {
        verdict: 'Emptied the engine.',
        facts,
        coach_tip,
        conditions_note,
        citations,
      };
    }

    case 'recovery':
    case 'shakeout': {
      facts.push(`Recovery miles · ${input.actualMi.toFixed(1)} mi${paceStr ? ' at ' + paceStr : ''}. Blood flow, not training stress. Box checked.`);
      return {
        verdict: 'Cleared the legs.',
        facts,
        coach_tip,
        conditions_note,
        citations,
      };
    }

    case 'race': {
      facts.push(`Race effort · ${input.actualMi.toFixed(1)} mi${paceStr ? ' at ' + paceStr : ''}${input.actualAvgHr ? ', avg HR ' + input.actualAvgHr : ''}. The block's full test.`);
      return {
        verdict: 'Raced it.',
        facts,
        coach_tip,
        conditions_note,
        citations,
      };
    }

    default: {
      facts.push(`Logged · ${input.actualMi.toFixed(1)} mi${paceStr ? ' at ' + paceStr : ''}.`);
      return {
        verdict: 'Logged.',
        facts,
        coach_tip,
        conditions_note,
        citations,
      };
    }
  }
}
