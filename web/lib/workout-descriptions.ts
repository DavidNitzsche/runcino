/**
 * Workout descriptions — clean recipe-style breakdown per workout.
 *
 * Each workout is a numbered list of steps. A step is either:
 *
 *   SIMPLE — single phase, one line of info
 *     "Warm Up — 15 min at 9:00–9:30/mi (easy)"
 *
 *   LOOP — repeating phase with sub-items
 *     "Cruise Intervals
 *      5 ROUNDS OF:
 *        · Run 7 min at 7:20–7:40/mi (threshold)
 *        · Jog 90 sec easy to recover"
 *
 * The modal renders these as a numbered recipe so the repetition
 * structure is unambiguous. Pace numbers anchored to a sub-1:45
 * half-marathon goal — will switch to user VDOT once we compute it.
 */

export interface SimpleStep {
  kind: 'simple';
  /** Phase name in caps: "Warm Up", "Cool Down", "Long Run". */
  name: string;
  /** Duration or distance: "15 min", "Most of the run", "Final 3-4 mi". */
  duration: string;
  /** Pace target: "9:00–9:30/mi" or "Half-marathon goal pace". */
  pace: string;
  /** Zone label shown in parentheses at end: "easy", "threshold", "HM goal". */
  zone: string;
}

export interface LoopItem {
  /** Action verb: "Run", "Jog", "Walk", "Sprint". */
  verb: string;
  /** Duration of this sub-item: "7 min", "90 sec". */
  duration: string;
  /** Pace target. Optional for recovery items where pace doesn't matter. */
  pace?: string;
  /** Zone label in parentheses: "threshold", "easy". */
  zone?: string;
  /** Free-text suffix shown after the pace, e.g. "to recover". */
  suffix?: string;
}

export interface LoopStep {
  kind: 'loop';
  /** Phase name in caps: "Cruise Intervals", "Hill Strides". */
  name: string;
  /** Number of rounds to complete. */
  times: number;
  /** What happens in each round, in order. Typically [work, recovery]. */
  items: LoopItem[];
}

export type WorkoutStep = SimpleStep | LoopStep;

export interface WorkoutDescription {
  /** Zone tag: "Threshold · Zone 4" — shown as a chip at the top. */
  zone: string;
  /** Display pace used in the modal stat block + Strava description. */
  paceTarget: string;
  /** Recipe steps, top to bottom. Empty for rest. */
  steps: WorkoutStep[];
  /** Concrete feel cue. */
  effort: string;
  /** Why this workout exists in the plan. */
  why: string;
}

/* ───────────────────────────────────────────────────────────────────
 * Exact-label lookups
 * ─────────────────────────────────────────────────────────────────── */

const BY_LABEL: Record<string, WorkoutDescription> = {
  // ── Easy / aerobic ────────────────────────────────────────────
  'Easy': {
    zone: 'Easy · Zone 2',
    paceTarget: '9:00 – 9:30 per mile',
    steps: [
      { kind: 'simple', name: 'Easy Run', duration: 'Full distance', pace: '9:00–9:30/mi', zone: 'easy' },
    ],
    effort: 'Conversational — you should be able to hold a full sentence the whole way. If breathing makes that hard, slow down.',
    why: 'Easy days are where your aerobic engine builds. Protect them from creeping into "medium-hard."',
  },
  'Easy + Strides': {
    zone: 'Easy · Zone 2 + Strides',
    paceTarget: '9:00 – 9:30 per mile · strides at 1-mile race pace',
    steps: [
      { kind: 'simple', name: 'Easy Run', duration: 'Most of the run', pace: '9:00–9:30/mi', zone: 'easy' },
      {
        kind: 'loop',
        name: 'Strides at the end',
        times: 8,
        items: [
          { verb: 'Run', duration: '15 sec', pace: '1-mile race pace', zone: 'fast' },
          { verb: 'Walk', duration: '45–60 sec', suffix: 'to recover' },
        ],
      },
    ],
    effort: 'Easy throughout the run. Strides are quick and smooth — about the speed you could just barely hold for a full mile race. Focus on form and turnover.',
    why: 'Strides keep your legs feeling fast and your turnover sharp without adding fatigue.',
  },
  'Hill Strides': {
    zone: 'Easy · Zone 2 + Hill Strides',
    paceTarget: '9:00 – 9:30 per mile · strides hard uphill',
    steps: [
      { kind: 'simple', name: 'Easy Run', duration: 'Most of the run', pace: '9:00–9:30/mi', zone: 'easy' },
      {
        kind: 'loop',
        name: 'Hill Strides at the end',
        times: 8,
        items: [
          { verb: 'Run uphill', duration: '10 sec', pace: 'hard', zone: 'powerful' },
          { verb: 'Walk back down', duration: 'to base', suffix: 'fully recover' },
        ],
      },
    ],
    effort: 'Easy on the flat. Strides are powerful and controlled — drive your knees, stay tall. Don\'t sprint.',
    why: 'Sharpens leg power and tendon stiffness without the volume cost of intervals.',
  },

  // ── Long ──────────────────────────────────────────────────────
  'Long': {
    zone: 'Long · Zone 2',
    paceTarget: '9:00 – 9:45 per mile',
    steps: [
      { kind: 'simple', name: 'Long Run', duration: 'Full distance', pace: '9:00–9:45/mi', zone: 'easy' },
    ],
    effort: 'Conversational throughout. Time on feet is the stimulus — don\'t chase pace. Last 20 min can drift slightly faster if it feels natural.',
    why: 'Endurance builds through duration, not speed.',
  },
  'Long Run · HM Finish': {
    zone: 'Long · Zone 2 → Race Pace',
    paceTarget: '9:30 easy → half-marathon goal pace',
    steps: [
      { kind: 'simple', name: 'Easy Aerobic', duration: 'First ⅔ of run', pace: '9:30/mi', zone: 'easy' },
      { kind: 'simple', name: 'HM Finish',    duration: 'Final 3–4 mi',  pace: '7:30–7:50/mi', zone: 'half-marathon goal' },
    ],
    effort: 'Easy for two-thirds. Then disciplined race pace through the finish — same fatigue you\'ll have on race day.',
    why: 'Practice goal pace on tired legs. Pacing discipline is the work.',
  },
  'Long Run · Progression': {
    zone: 'Long · Zone 2 → Zone 3',
    paceTarget: '9:45 → 8:30 per mile across the run',
    steps: [
      { kind: 'simple', name: 'Opening Third', duration: 'First ⅓',  pace: '9:45/mi', zone: 'easy' },
      { kind: 'simple', name: 'Middle Third',  duration: 'Middle ⅓', pace: '9:10/mi', zone: 'steady' },
      { kind: 'simple', name: 'Final Third',   duration: 'Last ⅓',   pace: '8:30/mi', zone: 'progressing' },
    ],
    effort: 'Steady, controlled increase. You should feel stronger as the run develops, not blown out at the end.',
    why: 'Teaches you to push tempo as fatigue builds — race-day pacing without the race.',
  },
  'Long Run · Taper': {
    zone: 'Long · Zone 2',
    paceTarget: '9:00 – 9:30 per mile',
    steps: [
      { kind: 'simple', name: 'Long Run', duration: 'Full distance', pace: '9:00–9:30/mi', zone: 'easy' },
    ],
    effort: 'Fully easy. This is sharpening, not building.',
    why: 'Preserves the long-run feel without adding fatigue. Volume drops to set up race week.',
  },

  // ── Threshold (Zone 4) ────────────────────────────────────────
  'Threshold · Cruise Intervals': {
    zone: 'Threshold · Zone 4',
    paceTarget: '7:20 – 7:40 per mile',
    steps: [
      { kind: 'simple', name: 'Warm Up', duration: '15 min', pace: '9:00–9:30/mi', zone: 'easy' },
      {
        kind: 'loop',
        name: 'Cruise Intervals',
        times: 5,
        items: [
          { verb: 'Run', duration: '7 min',   pace: '7:20–7:40/mi', zone: 'threshold' },
          { verb: 'Jog', duration: '90 sec',  pace: 'easy',         suffix: 'to recover' },
        ],
      },
      { kind: 'simple', name: 'Cool Down', duration: '10 min', pace: '9:00–9:30/mi', zone: 'easy' },
    ],
    effort: 'Comfortably hard — roughly your 10K race pace. You can say 2–3 words at a time, but not a full sentence.',
    why: 'Controlled, sustainable threshold work. Stay steady at the edge of comfortable; don\'t push harder.',
  },
  'Threshold · HM Blocks': {
    zone: 'Threshold · Zone 4',
    paceTarget: '7:30 – 7:50 per mile (half-marathon goal)',
    steps: [
      { kind: 'simple', name: 'Warm Up', duration: '15 min', pace: '9:00–9:30/mi', zone: 'easy' },
      {
        kind: 'loop',
        name: 'HM-Pace Blocks',
        times: 3,
        items: [
          { verb: 'Run', duration: '13 min', pace: '7:30–7:50/mi', zone: 'half-marathon goal' },
          { verb: 'Jog', duration: '3 min',  pace: 'easy',         suffix: 'to recover' },
        ],
      },
      { kind: 'simple', name: 'Cool Down', duration: '10 min', pace: '9:00–9:30/mi', zone: 'easy' },
    ],
    effort: 'Goal half-marathon pace — sustainable but pressing. Steady, not surging.',
    why: 'Race-specific endurance. Teaches your body to hold goal pace for extended chunks.',
  },
  'Threshold · HM Cruise': {
    zone: 'Threshold · Zone 4',
    paceTarget: '7:30 – 7:50 per mile (half-marathon pace)',
    steps: [
      { kind: 'simple', name: 'Warm Up', duration: '15 min', pace: '9:00–9:30/mi', zone: 'easy' },
      {
        kind: 'loop',
        name: 'HM-Pace Cruise',
        times: 3,
        items: [
          { verb: 'Run', duration: '10 min', pace: '7:30–7:50/mi', zone: 'half-marathon pace' },
          { verb: 'Jog', duration: '2 min',  pace: 'easy',         suffix: 'to recover' },
        ],
      },
      { kind: 'simple', name: 'Cool Down', duration: '10 min', pace: '9:00–9:30/mi', zone: 'easy' },
    ],
    effort: 'Steady half-marathon pace — feels like work but never out of control.',
    why: 'Solid threshold dose at race pace. Long enough to feel like work, short enough not to overreach.',
  },
  'Threshold · HM Tempo': {
    zone: 'Threshold · Zone 4',
    paceTarget: '7:30 – 7:50 per mile (half-marathon goal)',
    steps: [
      { kind: 'simple', name: 'Warm Up',  duration: '15 min',    pace: '9:00–9:30/mi', zone: 'easy' },
      { kind: 'simple', name: 'HM Tempo', duration: '25 min',    pace: '7:30–7:50/mi', zone: 'half-marathon goal · continuous' },
      { kind: 'simple', name: 'Cool Down',duration: '10 min',    pace: '9:00–9:30/mi', zone: 'easy' },
    ],
    effort: 'The hardest sustained effort of the week. If pace slips, finish controlled — don\'t blow up.',
    why: 'Pure race-day specificity. Practice holding goal pace under fatigue.',
  },
  'Threshold Touch': {
    zone: 'Threshold · Zone 4 (taper)',
    paceTarget: '7:20 – 7:40 per mile',
    steps: [
      { kind: 'simple', name: 'Warm Up', duration: '10 min', pace: '9:00–9:30/mi', zone: 'easy' },
      {
        kind: 'loop',
        name: 'Threshold Touch',
        times: 3,
        items: [
          { verb: 'Run', duration: '4 min',  pace: '7:20–7:40/mi', zone: '10K race pace' },
          { verb: 'Jog', duration: '90 sec', pace: 'easy',         suffix: 'to recover' },
        ],
      },
      { kind: 'simple', name: 'Cool Down', duration: '10 min', pace: '9:00–9:30/mi', zone: 'easy' },
    ],
    effort: 'Comfortably hard. Brief — should feel sharp, not depleted.',
    why: 'Reminds your body what hard feels like during taper without compromising race day.',
  },
  'Threshold · Race Week Tune': {
    zone: 'Threshold · Zone 4 (race week)',
    paceTarget: '7:40 – 8:00 per mile',
    steps: [
      { kind: 'simple', name: 'Warm Up', duration: '10 min', pace: '9:00–9:30/mi', zone: 'easy' },
      {
        kind: 'loop',
        name: 'Race-Week Tune',
        times: 2,
        items: [
          { verb: 'Run', duration: '6 min', pace: '7:40–8:00/mi', zone: '~10 sec/mi slower than HM goal' },
          { verb: 'Jog', duration: '2 min', pace: 'easy',         suffix: 'to recover' },
        ],
      },
      { kind: 'simple', name: 'Cool Down', duration: '10 min', pace: '9:00–9:30/mi', zone: 'easy' },
    ],
    effort: 'Sharp but easy. Wake the system up.',
    why: 'Race-week primer. Don\'t leave anything on the table — save it for race day.',
  },

  // ── VO₂max / Intervals ────────────────────────────────────────
  'Intervals': {
    zone: 'VO₂max · Zone 5',
    paceTarget: '6:30 – 7:00 per mile',
    steps: [
      { kind: 'simple', name: 'Warm Up', duration: '15 min', pace: '9:00–9:30/mi', zone: 'easy' },
      {
        kind: 'loop',
        name: 'VO₂max Intervals',
        times: 6,
        items: [
          { verb: 'Run', duration: '3 min', pace: '6:30–7:00/mi', zone: 'faster than 5K race pace' },
          { verb: 'Jog', duration: '2 min', pace: 'easy',         suffix: 'to recover' },
        ],
      },
      { kind: 'simple', name: 'Cool Down', duration: '10 min', pace: '9:00–9:30/mi', zone: 'easy' },
    ],
    effort: 'Hard — faster than 5K pace. Breathing is the limiter, not your legs.',
    why: 'VO₂max work pushes your aerobic ceiling.',
  },

  // ── Race week ─────────────────────────────────────────────────
  'Shake-out': {
    zone: 'Easy · Zone 1–2',
    paceTarget: '9:30 – 10:00 per mile',
    steps: [
      { kind: 'simple', name: 'Easy Jog', duration: '3 mi',        pace: '9:30–10:00/mi', zone: 'fully conversational' },
      { kind: 'simple', name: 'Optional Strides', duration: '3 strides at the end', pace: 'brisk', zone: 'only if you feel flat' },
    ],
    effort: 'Easy and relaxed. Get out, get back.',
    why: 'Loosen up, not train. Save the legs for race day.',
  },
  'AFC Half': {
    zone: 'Race · Zone 4–5',
    paceTarget: 'Half-marathon goal pace',
    steps: [
      { kind: 'simple', name: 'Conservative Open', duration: 'Miles 1–3',  pace: '~10 sec/mi slower than goal', zone: 'should feel almost too easy' },
      { kind: 'simple', name: 'Settle In',         duration: 'Miles 4–10', pace: 'goal pace',                   zone: 'lock in and hold' },
      { kind: 'simple', name: 'Commit',            duration: 'Mile 10 → finish', pace: 'goal pace or faster',   zone: 'the last 5K is where the race is won' },
    ],
    effort: 'Race effort. Trust the training — your legs know what to do.',
    why: 'Race day. Execute the plan; conserve early, commit late.',
  },

  // ── Rest ──────────────────────────────────────────────────────
  'Rest': {
    zone: 'Rest',
    paceTarget: '—',
    steps: [],
    effort: 'Sleep, hydrate, gentle mobility if you want. Cross-train lightly only if you feel restless.',
    why: 'Rest is when your body absorbs the work and gets stronger. Take it.',
  },
};

/* ───────────────────────────────────────────────────────────────────
 * Type fallbacks
 * ─────────────────────────────────────────────────────────────────── */

const BY_TYPE: Record<string, WorkoutDescription> = {
  easy:     BY_LABEL['Easy'],
  recovery: BY_LABEL['Easy'],
  long:     BY_LABEL['Long'],
  quality:  BY_LABEL['Threshold · Cruise Intervals'],
  race:     BY_LABEL['AFC Half'],
  rest:     BY_LABEL['Rest'],
};

export function describeWorkout(label: string, type: string): WorkoutDescription {
  return BY_LABEL[label] ?? BY_TYPE[type] ?? BY_LABEL['Easy'];
}
