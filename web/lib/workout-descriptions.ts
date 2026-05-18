/**
 * Workout descriptions — proper, physiologically-accurate copy for
 * each named workout in the synthetic plan template.
 *
 * The modal previously fell back to a generic "Easy · Zone 2" copy
 * for every easy-typed workout (including HILL STRIDES, EASY +
 * STRIDES, etc.), which is wrong — those have specific structures.
 *
 * Keyed by the exact workout `label` string from synthetic-plan.ts
 * TEMPLATE. Fallback to type-based defaults if no match.
 *
 * Source: standard endurance methodology (Daniels Running Formula,
 * Pfitzinger, Hudson) — distilled to the structure faff.run plans
 * actually emit.
 */

export interface WorkoutDescription {
  /** Headline zone label, e.g. "Threshold · Zone 4" */
  zone: string;
  /** Full workout copy — structure + intent. 2–4 sentences. */
  copy: string;
  /** Recommended pace target as displayed in the modal stat block. */
  paceTarget: string;
}

/* ───────────────────────────────────────────────────────────────────
 * Exact-label lookups (case-sensitive, matches lib/synthetic-plan.ts)
 * ─────────────────────────────────────────────────────────────────── */

const BY_LABEL: Record<string, WorkoutDescription> = {
  // ── Easy / aerobic ────────────────────────────────────────────
  'Easy': {
    zone: 'Easy · Zone 2',
    copy: 'Run at a pace where you could comfortably hold a conversation the whole way. If you find yourself breathing too hard to say a full sentence, slow down. Easy days are where your aerobic fitness actually builds, so don\'t let them creep into "medium-hard" — protect them.',
    paceTarget: '9:00 – 9:30 per mile',
  },
  'Easy + Strides': {
    zone: 'Easy · Zone 2 + Strides',
    copy: 'Run at an easy, conversational pace for the full distance. In the final mile, add 6 to 8 strides on flat ground — each one is a 15-second pickup at near-mile-race pace, focused on quick, smooth turnover (not a sprint). Walk for 45 to 60 seconds between strides to fully recover. Strides keep your legs feeling fast without adding fatigue.',
    paceTarget: '9:00 – 9:30 per mile · strides at mile pace',
  },
  'Hill Strides': {
    zone: 'Easy · Zone 2 + Hill Strides',
    copy: 'Run easy and conversational for most of the distance. Then find a moderate-grade hill (a 4–8% incline you can run, not climb) and do 8 strides up it — each one is 10 seconds of powerful, controlled effort. Walk back down to fully recover before the next one. The point is sharpening your legs\' power and stiffness, not lung work. Focus on form: drive your knees, stay tall, don\'t sprint.',
    paceTarget: '9:00 – 9:30 per mile · strides hard',
  },

  // ── Long ──────────────────────────────────────────────────────
  'Long': {
    zone: 'Long · Zone 2',
    copy: 'Stay easy and conversational for the full distance. The goal is time on your feet, not speed. If the last 20 minutes naturally feel like flowing a bit faster, that\'s fine — let your body lead. But don\'t force a fast finish if it isn\'t there. Long runs build endurance through duration, not pace.',
    paceTarget: '9:00 – 9:45 per mile',
  },
  'Long Run · HM Finish': {
    zone: 'Long · Zone 2 → Race Pace',
    copy: 'Start easy and conversational for the first two-thirds of the run. With 3 to 4 miles left, pick it up to your goal half-marathon pace and hold it to the finish. The point is practicing race pace on tired legs — the same fatigue you\'ll feel in the second half on race day. Stay disciplined: don\'t go faster than goal pace even if it feels easy.',
    paceTarget: '9:30 easy → half-marathon goal pace',
  },
  'Long Run · Progression': {
    zone: 'Long · Zone 2 → Zone 3',
    copy: 'Start at an easy, conversational pace and gradually pick it up so you finish the last third of the run 15 to 20 seconds per mile faster than the opening. This isn\'t a sprint finish — it\'s a steady, controlled progression that teaches you to push tempo as fatigue builds. You should feel stronger and faster as the run develops, not blown out at the end.',
    paceTarget: '9:45 → 8:30 per mile across the run',
  },
  'Long Run · Taper': {
    zone: 'Long · Zone 2',
    copy: 'A shorter long run, kept fully easy and conversational throughout. The point is preserving the long-run feeling without adding more fatigue — we\'re tapering, not building. Treat this as a relaxed weekend run that keeps your aerobic system sharp for race day.',
    paceTarget: '9:00 – 9:30 per mile',
  },

  // ── Threshold (Zone 4) ────────────────────────────────────────
  'Threshold · Cruise Intervals': {
    zone: 'Threshold · Zone 4',
    copy: 'Warm up easy for 15 minutes. Then run 4 to 5 "cruise intervals" — each one is 6 to 8 minutes at a comfortably hard pace, roughly your 10K race pace. You should be able to say 2 or 3 words at a time, but not a full sentence. Between intervals, jog easy for 90 seconds. Finish with a 10-minute easy cooldown. This is controlled, sustainable work — not a race. Stay steady at the edge of comfortable; don\'t push harder.',
    paceTarget: '7:20 – 7:40 per mile',
  },
  'Threshold · HM Blocks': {
    zone: 'Threshold · Zone 4',
    copy: 'Warm up easy for 15 minutes. Then run 2 to 3 blocks at your goal half-marathon pace — each block is 12 to 15 minutes, with 3 minutes of easy jogging between them. Finish with 10 minutes easy. These longer blocks build race-specific endurance: they teach your body to hold goal pace for extended chunks of time, which is exactly what race day demands.',
    paceTarget: '7:30 – 7:50 per mile (half-marathon goal)',
  },
  'Threshold · HM Cruise': {
    zone: 'Threshold · Zone 4',
    copy: 'Warm up easy for 15 minutes. Then run 3 intervals at your goal half-marathon pace — 10 minutes each, with 2 minutes of easy jogging between. Finish with 10 minutes easy. A solid threshold dose at race pace: long enough to feel like work, short enough not to overreach.',
    paceTarget: '7:30 – 7:50 per mile (half-marathon pace)',
  },
  'Threshold · HM Tempo': {
    zone: 'Threshold · Zone 4',
    copy: 'Warm up easy for 15 minutes. Then run 20 to 30 minutes continuously at your goal half-marathon pace — no breaks. Finish with a 10-minute easy cooldown. This is the hardest sustained effort of the week. Hold your goal pace steady; if you can\'t, slow down and finish controlled rather than blowing up.',
    paceTarget: '7:30 – 7:50 per mile (half-marathon goal)',
  },
  'Threshold Touch': {
    zone: 'Threshold · Zone 4 (taper)',
    copy: 'A brief threshold workout to stay sharp during taper week. Warm up easy for 10 minutes. Then run 3 intervals of 4 minutes each at threshold pace — comfortably hard, about your 10K pace — with 90 seconds of easy jogging between. Finish with 10 minutes easy. The point is to remind your body what hard feels like without adding fatigue that would compromise race day.',
    paceTarget: '7:20 – 7:40 per mile',
  },
  'Threshold · Race Week Tune': {
    zone: 'Threshold · Zone 4 (race week)',
    copy: 'A race-week wake-up workout. Warm up easy for 10 minutes. Then run 2 intervals of 6 minutes each at threshold pace — about 10 seconds per mile slower than your half-marathon goal pace — with 2 minutes of easy jogging between. Finish with 10 minutes easy. This is meant to feel sharp but easy: wake the system up, don\'t leave anything on the table for race day.',
    paceTarget: '7:40 – 8:00 per mile',
  },

  // ── VO₂max / Intervals ────────────────────────────────────────
  'Intervals': {
    zone: 'VO₂max · Zone 5',
    copy: 'Warm up easy for 15 minutes. Then run 5 to 6 intervals of 3 minutes each at a hard pace — faster than your 5K race pace, where breathing is the limiter, not your legs. Take 2 minutes of easy jogging between each interval to recover. Finish with 10 minutes easy. This is VO₂max work: short, hard, and meant to push your aerobic ceiling. You should feel it in your lungs.',
    paceTarget: '6:30 – 7:00 per mile',
  },

  // ── Race week ─────────────────────────────────────────────────
  'Shake-out': {
    zone: 'Easy · Zone 1–2',
    copy: 'A short, easy jog 1 to 2 days before your race — about 3 miles at a fully conversational pace. If you feel flat or stiff, add 2 or 3 strides at the end to wake up your legs. The goal is to loosen up and stay relaxed, not to train. Get out, get back, save the legs for race day.',
    paceTarget: '9:30 – 10:00 per mile',
  },
  'AFC Half': {
    zone: 'Race · Zone 4–5',
    copy: 'Race day. Start conservatively — the first 3 miles should feel almost too easy. Settle into your goal pace from miles 4 through 10. Then commit fully from mile 10 to the finish; the last 5K is where the race is won or lost. Trust the training. Your legs know what to do.',
    paceTarget: 'Half-marathon goal pace',
  },

  // ── Rest ──────────────────────────────────────────────────────
  'Rest': {
    zone: 'Rest',
    copy: 'No run today. Use the day for full recovery — sleep, hydrate, do some gentle mobility if you want. If you feel restless, a non-running cross-train (light cycling, easy swim, walk) is fine. Rest is when your body actually absorbs the work and gets stronger. You\'ve earned it — take it.',
    paceTarget: '—',
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
