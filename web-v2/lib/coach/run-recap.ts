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
 *     verdict:  string,         // "Long run done." / "Tempo done." / ...
 *     facts:    string[],       // 1-2 plain-English sentences on what landed
 *     coach_tip: string | null, // forward-looking advice when warranted
 *     conditions_note: string | null,  // null when neutral
 *   }
 *
 * Voice doctrine (David, 2026-05-31): plain runner-English, no PhD jargon
 * ("mitochondrial / cardiovascular drift / lactate threshold" all gone),
 * and citations are NOT in the output. The science is in the rules · it's
 * not in the words.
 */
import type { Phase, WorkoutType } from '@/lib/coach/run-purpose';
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
  /** Work-phase avg pace (s/mi) derived from watch completion phases.
   *  When present, replaces whole-run avg in tempo/threshold copy.
   *  Absent on Strava/cold-start runs — falls back to actualPaceSPerMi. */
  workPaceSPerMi?: number | null;
  /** Sum of work-phase actualDistanceMi from watch completion phases.
   *  When present alongside workPaceSPerMi, formats as "4.0 mi @ 7:18".
   *  Absent when phases carry no distance (falls back to pace-only block). */
  workDistanceMi?: number | null;
  /** Count of completed work phases (reps) from watch completion.
   *  When present, used in intervals lead line: "4 reps @ 6:52".
   *  Absent on Strava/cold-start runs (falls back to total-distance block). */
  repCount?: number | null;
  /** Finish-segment distance (mi) from workout_spec (long runs with HM/M finish). */
  finishMi?: number | null;
  /** Actual finish-segment pace (s/mi). Prefer the isFinishSegment phase's
   *  actualPaceSPerMi; falls back to workout_spec finish_pace_s_per_mi. */
  finishPaceSPerMi?: number | null;
  /** 'HM' | 'M' from the spec — rendered as 'HMP' / 'MP'. */
  finishLabel?: string | null;
  actualAvgHr: number | null;
  actualMaxHr: number | null;
  /**
   * Mile-by-mile splits with pace + HR per segment when available.
   * 2026-05-31 fix: accept both naming conventions on the wire ·
   * canonical rows store `{mile, hr, pace, cadence, elev_ft}` (Faff watch
   * + Apple Watch shape) while older code paths emit `{mile, avgHr,
   * paceSPerMi}`. detectHrDrift + detectPaceFade coalesce both via the
   * normalizeSplit helper.
   */
  splits?: Array<{
    mile?: number;
    paceSPerMi?: number | null;
    avgHr?: number | null;
    /** Alternate shape: `pace` as "M:SS" string, `hr` as int. */
    pace?: string | null;
    hr?: number | null;
  }>;
  weather?: WeatherInput | null;
}

export interface RecapPayload {
  verdict: string;
  facts: string[];
  coach_tip: string | null;
  conditions_note: string | null;
}

// Citations removed from output payloads (David, 2026-05-31). The
// engine still reads research-grounded rules · the words shown to the
// runner are plain English, not paper-style citations.

function paceLabel(spm: number | null | undefined): string | null {
  if (!spm || spm <= 0) return null;
  return `${Math.floor(spm / 60)}:${String(Math.round(spm % 60)).padStart(2, '0')}/mi`;
}

/** Pull an HR out of a split using either canonical key (`avgHr` or `hr`). */
function splitHr(s: { avgHr?: number | null; hr?: number | null } | undefined): number | null {
  if (!s) return null;
  if (typeof s.avgHr === 'number' && s.avgHr > 0) return s.avgHr;
  if (typeof s.hr === 'number' && s.hr > 0) return s.hr;
  return null;
}

/** Pull a paceSPerMi out of a split, accepting either the integer field
 *  or a "M:SS" formatted pace string. */
function splitPaceS(s: { paceSPerMi?: number | null; pace?: string | null } | undefined): number | null {
  if (!s) return null;
  if (typeof s.paceSPerMi === 'number' && s.paceSPerMi > 0) return s.paceSPerMi;
  if (typeof s.pace === 'string') {
    const m = /^(\d{1,2}):(\d{2})$/.exec(s.pace.trim());
    if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }
  return null;
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
    .map((s, i) => ({ i, hr: splitHr(s) }))
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
  const paced = splits.map(s => splitPaceS(s)).filter((p): p is number => p != null && p > 0);
  if (paced.length < 5) return null;
  const cut = Math.floor(paced.length * 2 / 3);
  const front = paced.slice(0, cut);
  const back = paced.slice(cut);
  const frontAvg = front.reduce((s, x) => s + x, 0) / front.length;
  const backAvg = back.reduce((s, x) => s + x, 0) / back.length;
  return Math.round(backAvg - frontAvg);
}

export function deriveRecap(input: RecapInput): RecapPayload {
  // E6: pass the workout type so the conditions copy reframes around effort
  // for easy/long/recovery/shakeout (pace-cost framing only for quality/race).
  const weather = input.weather ? judgeWeather({ ...input.weather, workoutType: input.type }) : null;
  const drift = detectHrDrift(input.splits);
  const fade = detectPaceFade(input.splits);
  const paceStr = paceLabel(input.actualPaceSPerMi);

  const facts: string[] = [];
  let conditions_note: string | null = null;
  let coach_tip: string | null = null;

  // Compose the conditions sentence FIRST when it's material · it
  // changes how we read pace + HR drift.
  const conditionsMaterial = weather?.shouldFlagInRecap === true;
  if (conditionsMaterial && weather) {
    conditions_note = weather.summary;
    if (weather.coachTipForNextTime) coach_tip = weather.coachTipForNextTime;
  }

  // Heat-aware judgment on HR drift + pace fade.
  const heatExplainsDrift =
    conditionsMaterial && (weather?.heatBand === 'warm' || weather?.heatBand === 'hot' || weather?.heatBand === 'extreme');

  // Voice doctrine (David, 2026-05-31): plain English. No PhD jargon.
  // "mitochondrial / lactate / VO2 / cardiovascular drift" all gone.
  // The science still drives the rules · just not the words.
  switch (input.type) {
    case 'long': {
      const finishMi = input.finishMi ?? 0;
      const hasFinish = finishMi > 0 && input.finishPaceSPerMi != null;
      if (hasFinish) {
        const easyMi = Math.round(input.plannedMi - finishMi);
        const fPaceStr = paceLabel(input.finishPaceSPerMi!)?.replace('/mi', '') ?? '';
        const rawLabel = String(input.finishLabel ?? '').trim().toUpperCase();
        const label = rawLabel === 'HM' ? 'HMP' : rawLabel === 'M' ? 'MP' : rawLabel || 'HMP';
        const hrPart = input.actualAvgHr ? ` · avg HR ${input.actualAvgHr}` : '';
        facts.push(
          `Long run done · ${easyMi}mi easy + ${Math.round(finishMi)}mi @ ${label} ${fPaceStr}${hrPart}.`,
        );
      } else {
        const hrPart = input.actualAvgHr ? ` · avg HR ${input.actualAvgHr}` : '';
        facts.push(
          `Long run done · ${input.actualMi.toFixed(1)} mi${hrPart} · kept it aerobic.`,
        );
      }
      if (drift && drift.drift >= 8) {
        if (heatExplainsDrift) {
          facts.push(
            `Your HR climbed ${drift.drift} bpm by the end (${drift.firstHr} → ${drift.lastHr}). That's normal in heat like this · the body works harder to cool itself, not because you're slowing down.`,
          );
        } else {
          facts.push(
            `Your HR climbed ${drift.drift} bpm by the end (${drift.firstHr} → ${drift.lastHr}). Usually fuel or water · try eating something earlier and drinking more next time.`,
          );
        }
      }
      if (fade && fade > 25 && !heatExplainsDrift) {
        facts.push(`The last third was about ${fade}s/mi slower than the rest. Worth checking your fueling.`);
      }
      return {
        verdict: 'Long run done.',
        facts,
        coach_tip,
        conditions_note,
      };
    }

    case 'easy': {
      facts.push(
        `Easy ${input.actualMi.toFixed(1)} mi${paceStr ? ' at ' + paceStr : ''}. Boring is good · that's the whole point of easy days.`,
      );
      if (input.plannedHrCap && input.actualAvgHr && input.actualAvgHr > input.plannedHrCap + 5) {
        if (heatExplainsDrift) {
          facts.push(`Your HR (${input.actualAvgHr}) ran a bit above the ${input.plannedHrCap} target, but it was hot · effort was right.`);
        } else {
          facts.push(`Your HR (${input.actualAvgHr}) ran past the ${input.plannedHrCap} target. Slow it down next time · easy days only work when they're actually easy.`);
        }
      }
      return {
        verdict: 'Easy done.',
        facts,
        coach_tip,
        conditions_note,
      };
    }

    case 'tempo':
    case 'threshold': {
      const workPaceStr = paceLabel(input.workPaceSPerMi);
      const hrPart = input.actualAvgHr ? ` · avg HR ${input.actualAvgHr}` : '';
      const leadLine = workPaceStr && input.workDistanceMi
        ? `Tempo done · ${input.workDistanceMi.toFixed(1)} mi @ ${workPaceStr.replace('/mi', '')}${hrPart}.`
        : workPaceStr
          ? `Tempo done · ${workPaceStr} tempo block${hrPart}.`
          : `Tempo done · ${input.actualMi.toFixed(1)} mi total${paceStr ? ' at ' + paceStr : ''}${input.actualAvgHr ? ', avg HR ' + input.actualAvgHr : ''}.`;
      facts.push(`${leadLine} These build up over weeks · one alone doesn't change much, but the bank pays off.`);
      // 2026-06-04 · don't repeat the heat percentage here · the
      // CONDITIONS card already owns the "Got from 69°F to 74°F ·
      // Costs you about X% on pace" quantitative read. Recap keeps
      // the runner-facing "ignore the clock" framing without
      // triple-mentioning the same number across recap + conditions
      // + coach-tip surfaces (David's QC).
      if (heatExplainsDrift && weather!.slowdownPct >= 4) {
        facts.push(`Heat was working against the clock today. If your HR was right, the stimulus was right · go by effort.`);
      }
      return {
        verdict: 'Tempo done.',
        facts,
        coach_tip,
        conditions_note,
      };
    }

    case 'intervals': {
      const workPaceStr = paceLabel(input.workPaceSPerMi);
      const repStr = input.repCount ? `${input.repCount} rep${input.repCount !== 1 ? 's' : ''}` : null;
      const hrPart = input.actualAvgHr ? ` · avg HR ${input.actualAvgHr}` : '';
      const leadLine = repStr && workPaceStr
        ? `Reps done · ${repStr} @ ${workPaceStr.replace('/mi', '')}${hrPart}.`
        : repStr
          ? `Reps done · ${repStr}${hrPart}.`
          : workPaceStr
            ? `Reps done · ${workPaceStr} work avg${hrPart}.`
            : `Reps done · ${input.actualMi.toFixed(1)} mi total${paceStr ? ' at ' + paceStr + ' avg' : ''}${input.actualAvgHr ? ', avg HR ' + input.actualAvgHr : ''}.`;
      facts.push(`${leadLine} Building the top end · these stack.`);
      if (heatExplainsDrift) {
        facts.push(`Heat makes interval pace harder. Go by feel and HR · the workout still counted.`);
      }
      return {
        verdict: 'Reps done.',
        facts,
        coach_tip,
        conditions_note,
      };
    }

    case 'recovery':
    case 'shakeout': {
      facts.push(`Recovery jog · ${input.actualMi.toFixed(1)} mi${paceStr ? ' at ' + paceStr : ''}. Just blood flow. Box checked.`);
      return {
        verdict: 'Legs cleared.',
        facts,
        coach_tip,
        conditions_note,
      };
    }

    case 'race': {
      facts.push(`Race · ${input.actualMi.toFixed(1)} mi${paceStr ? ' at ' + paceStr : ''}${input.actualAvgHr ? ', avg HR ' + input.actualAvgHr : ''}.`);
      return {
        verdict: 'Raced it.',
        facts,
        coach_tip,
        conditions_note,
      };
    }

    default: {
      facts.push(`Logged · ${input.actualMi.toFixed(1)} mi${paceStr ? ' at ' + paceStr : ''}.`);
      return {
        verdict: 'Logged.',
        facts,
        coach_tip,
        conditions_note,
      };
    }
  }
}
