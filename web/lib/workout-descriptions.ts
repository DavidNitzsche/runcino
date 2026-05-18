/**
 * Workout descriptions — structured breakdown for each named workout.
 *
 * Replaces the prose paragraphs with a chart-friendly shape:
 *   - steps[]   : table rows for the modal — name + duration + pace + note
 *   - effort    : 1-2 sentence "how it should feel" cue
 *   - why       : 1 sentence purpose statement
 *
 * Each "step" is one phase of the workout. For a threshold session
 * that's warm up → intervals → cool down. For an easy run it's
 * a single row covering the whole distance.
 *
 * The modal renders these as a small table + two short sections —
 * scannable, no wall of text.
 *
 * Pace numbers are estimates anchored to a sub-1:45 half-marathon
 * goal. When per-user VDOT/HR zones land later, these get computed
 * from the runner's own training paces instead of hardcoded ranges.
 */

export interface WorkoutStep {
  /** Phase name shown in the leftmost column (UPPERCASE in render). */
  name: string;
  /** Duration / structure — "15 min", "4–5 × 6–8 min", "Final mile". */
  duration: string;
  /** Pace target for this phase — "9:00–9:30/mi", "Hard", "Walk back". */
  pace: string;
  /** Optional sub-note shown beneath the row in italic small text. */
  note?: string;
}

export interface WorkoutDescription {
  /** Headline zone label, e.g. "Threshold · Zone 4" */
  zone: string;
  /** Stat-block primary pace string — see lib/strava-writeback.ts. */
  paceTarget: string;
  /** Workout steps, top to bottom. Empty for rest day. */
  steps: WorkoutStep[];
  /** "How it should feel" — concrete body-aware cue. */
  effort: string;
  /** Why this workout exists in the plan. */
  why: string;
}

/* ───────────────────────────────────────────────────────────────────
 * Exact-label lookups (case-sensitive, matches lib/synthetic-plan.ts)
 * ─────────────────────────────────────────────────────────────────── */

const BY_LABEL: Record<string, WorkoutDescription> = {
  // ── Easy / aerobic ────────────────────────────────────────────
  'Easy': {
    zone: 'Easy · Zone 2',
    paceTarget: '9:00 – 9:30 per mile',
    steps: [
      { name: 'Run', duration: 'Full distance', pace: '9:00–9:30/mi' },
    ],
    effort: 'Conversational — you should be able to hold a full sentence the whole way. If breathing makes that hard, slow down.',
    why: 'Easy days are where your aerobic engine actually builds. Protect them from creeping into "medium-hard."',
  },
  'Easy + Strides': {
    zone: 'Easy · Zone 2 + Strides',
    paceTarget: '9:00 – 9:30 per mile · strides at mile pace',
    steps: [
      { name: 'Easy run',     duration: 'First 4.5 mi',  pace: '9:00–9:30/mi' },
      { name: 'Strides',      duration: '6–8 × 15 sec',  pace: 'Near mile pace',  note: 'Flat ground · quick, smooth turnover · 45–60 sec walk between each' },
    ],
    effort: 'Easy throughout the run. Strides are quick and smooth — not sprints. Focus on form and turnover.',
    why: 'Strides keep your legs feeling fast and your turnover sharp without adding fatigue.',
  },
  'Hill Strides': {
    zone: 'Easy · Zone 2 + Hill Strides',
    paceTarget: '9:00 – 9:30 per mile · strides hard uphill',
    steps: [
      { name: 'Easy run',    duration: 'First 4.5 mi', pace: '9:00–9:30/mi' },
      { name: 'Hill strides',duration: '8 × 10 sec',   pace: 'Hard uphill', note: '4–8% grade · walk back down to fully recover before next' },
    ],
    effort: 'Easy on the flat. Strides are powerful and controlled — drive your knees, stay tall. Don\'t sprint.',
    why: 'Sharpens leg power and tendon stiffness without the volume cost of intervals.',
  },

  // ── Long ──────────────────────────────────────────────────────
  'Long': {
    zone: 'Long · Zone 2',
    paceTarget: '9:00 – 9:45 per mile',
    steps: [
      { name: 'Long run', duration: 'Full distance', pace: '9:00–9:45/mi', note: 'Last 20 min can drift slightly faster if it feels natural' },
    ],
    effort: 'Conversational throughout. Time on feet is the stimulus — don\'t chase pace.',
    why: 'Endurance builds through duration, not speed.',
  },
  'Long Run · HM Finish': {
    zone: 'Long · Zone 2 → Race Pace',
    paceTarget: '9:30 easy → half-marathon goal pace',
    steps: [
      { name: 'Easy', duration: 'First ⅔ of run', pace: '9:30/mi' },
      { name: 'HM finish', duration: 'Final 3–4 mi', pace: '7:30–7:50/mi', note: 'Goal half-marathon pace — don\'t go faster even if it feels easy' },
    ],
    effort: 'Easy for two-thirds. Then disciplined race pace through the finish — same fatigue you\'ll have on race day.',
    why: 'Practice goal pace on tired legs. Pacing discipline is the work.',
  },
  'Long Run · Progression': {
    zone: 'Long · Zone 2 → Zone 3',
    paceTarget: '9:45 → 8:30 per mile across the run',
    steps: [
      { name: 'Opening third',  duration: 'First ⅓',  pace: '9:45/mi' },
      { name: 'Middle third',   duration: 'Middle ⅓', pace: '9:10/mi' },
      { name: 'Final third',    duration: 'Last ⅓',   pace: '8:30/mi', note: '15–20 sec/mi faster than opening — controlled, not a sprint finish' },
    ],
    effort: 'Steady, controlled increase. You should feel stronger as the run develops, not blown out at the end.',
    why: 'Teaches you to push tempo as fatigue builds — race-day pacing without the race.',
  },
  'Long Run · Taper': {
    zone: 'Long · Zone 2',
    paceTarget: '9:00 – 9:30 per mile',
    steps: [
      { name: 'Long run', duration: 'Full distance', pace: '9:00–9:30/mi', note: 'Fully easy throughout' },
    ],
    effort: 'Fully easy. This is sharpening, not building.',
    why: 'Preserves the long-run feel without adding fatigue. Volume drops to set up race week.',
  },

  // ── Threshold (Zone 4) ────────────────────────────────────────
  'Threshold · Cruise Intervals': {
    zone: 'Threshold · Zone 4',
    paceTarget: '7:20 – 7:40 per mile',
    steps: [
      { name: 'Warm up',           duration: '15 min',           pace: '9:00–9:30/mi · easy' },
      { name: 'Cruise intervals',  duration: '4–5 × 6–8 min',    pace: '7:20–7:40/mi',  note: 'Recover 90 sec easy jog between each' },
      { name: 'Cool down',         duration: '10 min',           pace: '9:00–9:30/mi · easy' },
    ],
    effort: 'Comfortably hard — roughly your 10K race pace. You can say 2–3 words at a time, but not a full sentence.',
    why: 'Controlled, sustainable threshold work. Stay steady at the edge of comfortable; don\'t push harder.',
  },
  'Threshold · HM Blocks': {
    zone: 'Threshold · Zone 4',
    paceTarget: '7:30 – 7:50 per mile (half-marathon goal)',
    steps: [
      { name: 'Warm up', duration: '15 min',         pace: '9:00–9:30/mi · easy' },
      { name: 'Blocks',  duration: '2–3 × 12–15 min', pace: '7:30–7:50/mi', note: 'Half-marathon goal pace · 3 min easy jog between blocks' },
      { name: 'Cool down', duration: '10 min',       pace: '9:00–9:30/mi · easy' },
    ],
    effort: 'Goal half-marathon pace — sustainable but pressing. Steady, not surging.',
    why: 'Race-specific endurance. Teaches your body to hold goal pace for extended chunks.',
  },
  'Threshold · HM Cruise': {
    zone: 'Threshold · Zone 4',
    paceTarget: '7:30 – 7:50 per mile (half-marathon pace)',
    steps: [
      { name: 'Warm up', duration: '15 min',     pace: '9:00–9:30/mi · easy' },
      { name: 'Cruise',  duration: '3 × 10 min', pace: '7:30–7:50/mi', note: 'Half-marathon pace · 2 min easy jog between' },
      { name: 'Cool down', duration: '10 min',   pace: '9:00–9:30/mi · easy' },
    ],
    effort: 'Steady half-marathon pace — feels like work but never out of control.',
    why: 'Solid threshold dose at race pace. Long enough to feel like work, short enough not to overreach.',
  },
  'Threshold · HM Tempo': {
    zone: 'Threshold · Zone 4',
    paceTarget: '7:30 – 7:50 per mile (half-marathon goal)',
    steps: [
      { name: 'Warm up', duration: '15 min',          pace: '9:00–9:30/mi · easy' },
      { name: 'Tempo',   duration: '20–30 min',       pace: '7:30–7:50/mi', note: 'Continuous — no breaks. Goal half-marathon pace' },
      { name: 'Cool down', duration: '10 min',        pace: '9:00–9:30/mi · easy' },
    ],
    effort: 'The hardest sustained effort of the week. If pace slips, finish controlled — don\'t blow up.',
    why: 'Pure race-day specificity. Practice holding goal pace under fatigue.',
  },
  'Threshold Touch': {
    zone: 'Threshold · Zone 4 (taper)',
    paceTarget: '7:20 – 7:40 per mile',
    steps: [
      { name: 'Warm up',  duration: '10 min',     pace: '9:00–9:30/mi · easy' },
      { name: 'Intervals', duration: '3 × 4 min', pace: '7:20–7:40/mi', note: '10K pace · 90 sec easy jog between' },
      { name: 'Cool down', duration: '10 min',    pace: '9:00–9:30/mi · easy' },
    ],
    effort: 'Comfortably hard. Brief — should feel sharp, not depleted.',
    why: 'Reminds your body what hard feels like during taper without compromising race day.',
  },
  'Threshold · Race Week Tune': {
    zone: 'Threshold · Zone 4 (race week)',
    paceTarget: '7:40 – 8:00 per mile',
    steps: [
      { name: 'Warm up',  duration: '10 min',     pace: '9:00–9:30/mi · easy' },
      { name: 'Tune',     duration: '2 × 6 min',  pace: '7:40–8:00/mi', note: '~10 sec/mi slower than HM goal · 2 min easy jog between' },
      { name: 'Cool down', duration: '10 min',    pace: '9:00–9:30/mi · easy' },
    ],
    effort: 'Sharp but easy. Wake the system up.',
    why: 'Race-week primer. Don\'t leave anything on the table — save it for race day.',
  },

  // ── VO₂max / Intervals ────────────────────────────────────────
  'Intervals': {
    zone: 'VO₂max · Zone 5',
    paceTarget: '6:30 – 7:00 per mile',
    steps: [
      { name: 'Warm up',  duration: '15 min',     pace: '9:00–9:30/mi · easy' },
      { name: 'Intervals', duration: '5–6 × 3 min', pace: '6:30–7:00/mi', note: 'Faster than 5K pace · 2 min easy jog between' },
      { name: 'Cool down', duration: '10 min',    pace: '9:00–9:30/mi · easy' },
    ],
    effort: 'Hard — faster than 5K pace. Breathing is the limiter, not your legs.',
    why: 'VO₂max work pushes your aerobic ceiling.',
  },

  // ── Race week ─────────────────────────────────────────────────
  'Shake-out': {
    zone: 'Easy · Zone 1–2',
    paceTarget: '9:30 – 10:00 per mile',
    steps: [
      { name: 'Easy jog', duration: '3 mi',      pace: '9:30–10:00/mi', note: 'Fully conversational' },
      { name: 'Strides',  duration: 'Optional · 2–3', pace: 'Brisk',     note: 'Only if you feel flat or stiff' },
    ],
    effort: 'Easy and relaxed. Get out, get back.',
    why: 'Loosen up, not train. Save the legs for race day.',
  },
  'AFC Half': {
    zone: 'Race · Zone 4–5',
    paceTarget: 'Half-marathon goal pace',
    steps: [
      { name: 'Conservative',   duration: 'Miles 1–3',     pace: '~10 sec/mi slower than goal', note: 'Should feel almost too easy' },
      { name: 'Settle in',      duration: 'Miles 4–10',    pace: 'Goal pace',                    note: 'Lock in and hold' },
      { name: 'Commit',         duration: 'Mile 10 → finish', pace: 'Goal pace or faster',       note: 'The last 5K is where the race is won' },
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
 * Type fallbacks — used when a label isn't in BY_LABEL
 * ─────────────────────────────────────────────────────────────────── */

const BY_TYPE: Record<string, WorkoutDescription> = {
  easy:     BY_LABEL['Easy'],
  recovery: BY_LABEL['Easy'],     // recovery folded into easy 2026-05
  long:     BY_LABEL['Long'],
  quality:  BY_LABEL['Threshold · Cruise Intervals'],
  race:     BY_LABEL['AFC Half'],
  rest:     BY_LABEL['Rest'],
};

/**
 * Look up the workout description. Prefers exact-label match; falls
 * back to type-based default; final fallback is the generic Easy copy.
 */
export function describeWorkout(label: string, type: string): WorkoutDescription {
  return BY_LABEL[label] ?? BY_TYPE[type] ?? BY_LABEL['Easy'];
}
