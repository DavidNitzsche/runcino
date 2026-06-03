/**
 * lib/coach/run-purpose.ts · "WHY THIS RUN" pre-run engine.
 *
 * Doctrine sources:
 *   · Research/04-workout-vocabulary.md · physiological target per type
 *   · Research/00a-distance-running-training.md · periodization + TID
 *   · Research/01-pace-zones-vdot.md · zone purpose
 *   · Research/03-heart-rate-zones.md · HR-zone physiology
 *
 * Replaces the hardcoded `planRecap(type)` strings in TodayView.tsx with a
 * server-side, research-cited, phase-aware engine. The plan-builder does
 * NOT author per-run purpose copy — the coach derives it on its own from
 * what the workout IS (type), where it sits in the season (phase), and
 * what it does to the runner physiologically.
 *
 * Output shape stays compact for any UI to render directly:
 *   {
 *     verdict:  string,        // 3-5 word headline
 *     facts:    string[],      // 1-2 short sentences, plain English
 *     citations: Citation[]   // backing research
 *   }
 */

/**
 * Citation type kept for the legacy import in run-recap.ts. Citations
 * are NOT surfaced to the runner anymore (David's voice doctrine ·
 * 2026-05-31); they remain in the type system for internal references
 * only. New code should not export citations on payloads.
 */
export interface Citation {
  slug: string;
  label: string;
}

export type WorkoutType =
  | 'easy' | 'long' | 'tempo' | 'threshold' | 'intervals' | 'fartlek'
  | 'progression' | 'recovery' | 'shakeout' | 'race' | 'rest' | 'unplanned';

export type Phase = 'BASE' | 'BUILD' | 'PEAK' | 'TAPER' | 'RECOVERY' | 'OFF';

export interface PurposeInput {
  type: WorkoutType;
  phase: Phase | null;
  /** Race distance in miles (5K=3.1, 10K=6.2, HM=13.1, M=26.2). Drives
   *  the "this is the bread + butter" framing for marathon long-runs vs
   *  5K interval work. */
  raceDistanceMi?: number | null;
  /** Weeks until the goal race. Used to flag taper-window context. */
  weeksToRace?: number | null;
  /** This run's planned distance in miles. Used to scale long-run copy
   *  (a 16-mi long vs a 10-mi long earns different framing). */
  plannedMi: number;
}

export interface PurposePayload {
  verdict: string;
  facts: string[];
}

const CITE_VOCAB: Citation = {
  slug: 'research-04-workout-vocabulary',
  label: 'Research/04 · Workout Vocabulary',
};
const CITE_DISTRUN: Citation = {
  slug: 'research-00a-distance-running-training',
  label: 'Research/00a · Distance Running Training',
};
const CITE_ZONES: Citation = {
  slug: 'research-01-pace-zones-vdot',
  label: 'Research/01 · Pace Zones VDOT',
};
const CITE_HR: Citation = {
  slug: 'research-03-heart-rate-zones',
  label: 'Research/03 · Heart Rate Zones',
};

const isMarathonBlock = (raceDist?: number | null) =>
  raceDist != null && raceDist >= 20;
const isHalfBlock = (raceDist?: number | null) =>
  raceDist != null && raceDist >= 11 && raceDist < 20;
const isShortBlock = (raceDist?: number | null) =>
  raceDist != null && raceDist < 11;

/**
 * The deterministic engine. Reads inputs, returns a verdict + facts
 * payload. Pure function; no DB or LLM calls.
 *
 * VOICE DOCTRINE (David, 2026-05-31):
 *   Plain English. No PhD jargon. The runner is a runner, not a
 *   physiologist. "mitochondrial density" / "VO2max" / "lactate
 *   threshold" / "slow-twitch oxidative" — none of that lands. Say
 *   what the run IS in everyday words. The science still drives the
 *   rules; it doesn't drive the output text. And no citations on the
 *   payload · "rooted in research" is for the engine, not the runner.
 */
export function derivePurpose(input: PurposeInput): PurposePayload {
  const { type, phase, raceDistanceMi } = input;

  switch (type) {
    case 'easy': {
      const facts: string[] = [];
      // 2026-06-03 · drop the redundant "Easy day." prefix · the
      // verdict already says it. David flagged "Easy day. Easy day."
      // appearing back-to-back on the Fri 6/5 upcoming card.
      facts.push('Conversational pace · should feel like nothing.');
      if (phase === 'BASE') {
        facts.push("Just put the miles in. The week's volume is what matters · not how fast any one run goes.");
      } else if (phase === 'PEAK' || phase === 'TAPER') {
        facts.push("Easy means easy. Today is about recovering for the hard stuff coming up · don't get fancy.");
      }
      return { verdict: 'Easy day.', facts };
    }

    case 'long': {
      const facts: string[] = [];
      if (isMarathonBlock(raceDistanceMi)) {
        facts.push('The long run is the single most important run of your marathon week. Time on feet builds the endurance you need for the back half of race day.');
      } else if (isHalfBlock(raceDistanceMi)) {
        facts.push("The long run lifts the pace you can hold for a half. The longer you can run comfortably, the easier race pace feels.");
      } else {
        facts.push('The long run is where the endurance lives. Time on feet beats hitting any specific pace.');
      }
      if (phase === 'PEAK') {
        facts.push("Practice race effort in the last third · pace, fueling, what you'll wear. Today is dress rehearsal.");
      } else {
        facts.push("Fuel early and often. Start easy and let it settle · pick it up at the end only if everything still feels good.");
      }
      return { verdict: 'Long run.', facts };
    }

    case 'tempo':
    case 'threshold': {
      const facts: string[] = [];
      facts.push("This is your comfortably-hard pace · about what you could hold for an hour all-out. Lock in and stay there.");
      if (phase === 'BUILD' || phase === 'PEAK') {
        facts.push("These sessions pay off over weeks · one good tempo doesn't change much, but ten of them changes your race time.");
      } else {
        facts.push("If your pace starts creeping or your HR starts climbing, back off. Better to nail it than try too hard and bury yourself.");
      }
      return { verdict: 'Tempo.', facts };
    }

    case 'intervals': {
      const facts: string[] = [];
      facts.push("Hard reps with easy jog recoveries. Push the work bouts · the recovery jogs should feel slow on purpose.");
      if (phase === 'PEAK') {
        facts.push("Peak phase · this is about sharpness, not piling on more. Run the splits clean, don't grind out an extra rep.");
      } else {
        facts.push("If your form falls apart, the rep is over. The point is the effort, not the clock.");
      }
      return { verdict: 'Intervals.', facts };
    }

    case 'fartlek':
    case 'progression': {
      return {
        verdict: 'Mixed effort.',
        facts: [
          "Alternating efforts · push the surges, settle in between. Run by feel, not by clock.",
          "The variety is the workout. Don't overthink it.",
        ],
      };
    }

    case 'recovery':
    case 'shakeout': {
      return {
        verdict: 'Shake the legs.',
        facts: [
          "Easier than your easy day. Just blood flow · no training stress. Keep HR under about 70% of max.",
          "If the legs are asking for more rest, give it. Protect this run and you nail tomorrow.",
        ],
      };
    }

    case 'race': {
      return {
        verdict: 'Race day.',
        facts: [
          "All the work you put in is in the bank. Pace it · don't burn it all in the first third.",
          "Whatever the conditions are, adjust your effort, not your goal. Trust the training.",
        ],
      };
    }

    case 'rest': {
      return {
        verdict: 'Rest day.',
        facts: [
          "Real rest. Sleep, eat, hydrate, walk if you want · no running.",
          "You don't need a junk mile to feel productive. Resting IS the work today.",
        ],
      };
    }

    case 'unplanned':
    default: {
      return {
        verdict: 'By feel.',
        facts: ["No specific plan today · run by feel."],
      };
    }
  }
}
