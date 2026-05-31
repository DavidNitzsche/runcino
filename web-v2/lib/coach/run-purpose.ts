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
  citations: Citation[];
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
 */
export function derivePurpose(input: PurposeInput): PurposePayload {
  const { type, phase, raceDistanceMi, plannedMi } = input;

  switch (type) {
    case 'easy': {
      const facts: string[] = [];
      facts.push('Aerobic base · capillary density and mitochondrial volume. The bulk of weekly volume sits here because it produces fitness without leaving fatigue you have to dig out of.');
      if (phase === 'BASE') {
        facts.push('In the base phase this IS the work · keep it boring, keep it conversational, and let the week\'s volume compound.');
      } else if (phase === 'PEAK' || phase === 'TAPER') {
        facts.push('Around quality + race work, easy days exist to let adaptation land. Drift faster and you blunt the next hard session.');
      }
      return {
        verdict: 'Build aerobic capacity.',
        facts,
        citations: [CITE_VOCAB, CITE_ZONES, CITE_HR],
      };
    }

    case 'long': {
      const facts: string[] = [];
      // Marathon-specific framing earns the strongest language.
      if (isMarathonBlock(raceDistanceMi)) {
        facts.push(`Marathon-specific aerobic stimulus. Long efforts above ~${Math.max(10, Math.round(plannedMi * 0.7))} mi push mitochondrial biogenesis, slow-twitch oxidative capacity, and the fat-oxidation pathways your last 10K depends on.`);
      } else if (isHalfBlock(raceDistanceMi)) {
        facts.push(`Aerobic ceiling work. For a half-marathon block, the long run extends time-on-feet and lifts the steady-state pace you can hold without crossing threshold.`);
      } else if (isShortBlock(raceDistanceMi)) {
        facts.push('Long aerobic stimulus. Even for short-distance racing, this is the day that lifts your VO2 ceiling by giving slow-twitch fibers the volume they grow under.');
      } else {
        facts.push('Long aerobic stimulus. The single most important run of the week for endurance · mitochondrial density and capillarization scale with duration, not pace.');
      }
      // Phase + execution cue.
      if (phase === 'PEAK') {
        facts.push('In peak phase the long should rehearse race effort · last third controlled at marathon-effort range, fueling cadence, kit you\'ll race in.');
      } else {
        facts.push('Fuel early and often. Run the first half by feel and let it settle in · pick up the final third only if everything is clicking.');
      }
      return {
        verdict: 'Build the base.',
        facts,
        citations: [CITE_VOCAB, CITE_DISTRUN, CITE_ZONES],
      };
    }

    case 'tempo':
    case 'threshold': {
      const facts: string[] = [];
      facts.push('Lactate-threshold work · the pace your body learns to clear lactate at. Sitting at LT2 (~1-hour race pace) trains the slow-twitch fibers to run faster aerobically. Don\'t freelance the pace · the band IS the prescription.');
      if (phase === 'BUILD' || phase === 'PEAK') {
        facts.push('Threshold compounds over weeks. Banked at the right intensity, this is the work that lifts every other pace in the system.');
      } else {
        facts.push('Pace creeping = HR creeping. Back off before you bury the next session.');
      }
      return {
        verdict: 'Sit on threshold.',
        facts,
        citations: [CITE_VOCAB, CITE_ZONES, CITE_HR],
      };
    }

    case 'intervals': {
      const facts: string[] = [];
      facts.push('VO2max stimulus. Reps at 95-100% of VO2max push the aerobic ceiling · the engine, not the splits. Drive turnover on the work bouts, jog the recoveries truly easy.');
      if (phase === 'PEAK') {
        facts.push('Peak phase: race-specific economy + neuromuscular firing. The goal is sharpness, not depth · don\'t leave anything on the track.');
      } else {
        facts.push('The point is the stimulus, not the splits. If form falls apart, the rep is done.');
      }
      return {
        verdict: 'Empty the engine.',
        facts,
        citations: [CITE_VOCAB, CITE_ZONES],
      };
    }

    case 'fartlek':
    case 'progression': {
      return {
        verdict: 'Vary the engine.',
        facts: [
          'Mixed-intensity stimulus · alternating efforts across zones recruits a broader span of motor units than a steady run and improves pace control.',
          'Treat it like a controlled play day. Surge by feel for the named segments, settle between · the stimulus comes from the contrast.',
        ],
        citations: [CITE_VOCAB, CITE_ZONES],
      };
    }

    case 'recovery':
    case 'shakeout': {
      return {
        verdict: 'Shake the legs.',
        facts: [
          'Active recovery only. Easier than easy · blood flow to clear metabolites, no training stress added. Cap the HR at ~70% of max.',
          'If the legs ask for more rest, give it to them. The session you protect today is the one you nail tomorrow.',
        ],
        citations: [CITE_HR, CITE_DISTRUN],
      };
    }

    case 'race': {
      return {
        verdict: 'Race the gap.',
        facts: [
          'Race-day execution · the test the block built toward. Pacing is the prescription · don\'t burn matches in the first third.',
          'Trust the work. Conditions are conditions; adjust your effort, not your goal.',
        ],
        citations: [
          { slug: 'research-08-pacing-and-race-week', label: 'Research/08 · Pacing And Race Week' },
        ],
      };
    }

    case 'rest': {
      return {
        verdict: 'Take the rest.',
        facts: [
          'Adaptation happens between sessions. A real day off · sleep, eat, hydrate, walk.',
          'Resist the urge to log a "junk" easy mile. The rest itself is the work.',
        ],
        citations: [
          { slug: 'research-00b-recovery-protocols', label: 'Research/00b · Recovery Protocols' },
        ],
      };
    }

    case 'unplanned':
    default: {
      return {
        verdict: 'By feel.',
        facts: ['No specific prescription · run by feel and let the body decide the dose.'],
        citations: [CITE_DISTRUN],
      };
    }
  }
}
