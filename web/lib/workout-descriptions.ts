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
    copy: 'Conversational pace throughout — if you can\'t hold a sentence, slow down. The aerobic engine gets built on the easy days; protect them.',
    paceTarget: '9:00 – 9:30/mi',
  },
  'Easy + Strides': {
    zone: 'Easy · Zone 2 + Strides',
    copy: 'Easy aerobic run. In the final mile, add 6–8 × 15-second strides on flat ground with 60 sec walk recovery. Strides are quick and smooth — turnover work, not a sprint.',
    paceTarget: '9:00 – 9:30/mi · strides ~mile pace',
  },
  'Hill Strides': {
    zone: 'Easy · Zone 2 + Hill Strides',
    copy: 'Easy aerobic run, then 8 × 10-second hill strides on a moderate grade with walk-back recovery. Strides build neuromuscular power and tendon stiffness without the volume cost of intervals — short, powerful, focused on form.',
    paceTarget: '9:00 – 9:30/mi · strides full effort',
  },

  // ── Long ──────────────────────────────────────────────────────
  'Long': {
    zone: 'Long · Zone 2',
    copy: 'Aerobic time on feet. Hold conversational pace; the duration is the stimulus, not speed. Last 20 minutes can drift slightly faster if it feels natural — let the body lead, don\'t force it.',
    paceTarget: '9:00 – 9:45/mi',
  },
  'Long Run · HM Finish': {
    zone: 'Long · Zone 2 → Zone 4',
    copy: 'First two-thirds at easy aerobic pace. Final 3–4 miles at goal half-marathon pace. Specific simulation of race-day fatigue plus pacing discipline — practice running fast on tired legs.',
    paceTarget: '9:30 easy → HM goal pace',
  },
  'Long Run · Progression': {
    zone: 'Long · Zone 2 → Zone 3',
    copy: 'Start easy, finish strong. Final third should be 15–20 sec per mile faster than the opening — controlled progression, not a sprint. Teaches even-effort pacing as fatigue builds.',
    paceTarget: '9:45 → 8:30/mi over the run',
  },
  'Long Run · Taper': {
    zone: 'Long · Zone 2',
    copy: 'Shortened long run — sharpening, not building. Keep effort easy throughout. The long-run signal is preserved while the volume drops to set up race week.',
    paceTarget: '9:00 – 9:30/mi',
  },

  // ── Threshold (Zone 4) ────────────────────────────────────────
  'Threshold · Cruise Intervals': {
    zone: 'Threshold · Zone 4',
    copy: '15 min easy warmup. 4–5 × 6–8 min at threshold pace (comfortably hard, ~10K to HM effort) with 90 sec easy jog between. 10 min easy cooldown. Threshold = controlled work, not a race.',
    paceTarget: '7:20 – 7:40/mi',
  },
  'Threshold · HM Blocks': {
    zone: 'Threshold · Zone 4',
    copy: '15 min easy warmup. 2–3 × 12–15 min at half-marathon goal pace with 3 min easy jog between. 10 min easy cooldown. Longer blocks build race-specific endurance at goal pace.',
    paceTarget: '7:30 – 7:50/mi (HM goal)',
  },
  'Threshold · HM Cruise': {
    zone: 'Threshold · Zone 4',
    copy: '15 min easy warmup. 3 × 10 min at half-marathon pace with 2 min easy jog between. 10 min easy cooldown. Continuous threshold dose without overreaching.',
    paceTarget: '7:30 – 7:50/mi (HM pace)',
  },
  'Threshold · HM Tempo': {
    zone: 'Threshold · Zone 4',
    copy: '15 min easy warmup. 20–30 min continuous at half-marathon goal pace. 10 min easy cooldown. The single hardest sustained effort of the week — race-day specificity.',
    paceTarget: '7:30 – 7:50/mi (HM goal)',
  },
  'Threshold Touch': {
    zone: 'Threshold · Zone 4 (touch)',
    copy: 'Brief threshold stimulus during taper. 10 min easy warmup. 3 × 4 min at threshold pace with 90 sec jog. 10 min cooldown. Keeps the engine sharp without taxing recovery.',
    paceTarget: '7:20 – 7:40/mi',
  },
  'Threshold · Race Week Tune': {
    zone: 'Threshold · Zone 4 (tune)',
    copy: 'Race-week sharpener. 10 min easy. 2 × 6 min at threshold (about 10 sec/mi slower than HM goal) with 2 min jog. 10 min cooldown. Wakes up the system without leaving anything on the table.',
    paceTarget: '7:40 – 8:00/mi',
  },

  // ── VO₂max / Intervals ────────────────────────────────────────
  'Intervals': {
    zone: 'VO₂max · Zone 5',
    copy: '15 min easy warmup. 5–6 × 3 min hard with 2 min easy jog between. 10 min easy cooldown. Hard = faster than 5K race pace; you should feel work in the lungs, not the legs.',
    paceTarget: '6:30 – 7:00/mi',
  },

  // ── Race week ─────────────────────────────────────────────────
  'Shake-out': {
    zone: 'Easy · Zone 1–2',
    copy: 'Short easy jog 1–2 days before race. 3 mi conversational, optional strides if you feel flat. Purpose: loosen up, not train. Get out, get back, save the legs.',
    paceTarget: '9:30 – 10:00/mi',
  },
  'AFC Half': {
    zone: 'Race · Zone 4–5',
    copy: 'Race day. Conserve early — first 3 mi should feel almost too easy. Lock into goal pace for miles 4–10. Commit hard from mile 10 to the finish. Trust the training; the legs know what to do.',
    paceTarget: 'HM goal pace',
  },

  // ── Rest ──────────────────────────────────────────────────────
  'Rest': {
    zone: 'Rest',
    copy: 'No run today. Use the day for full recovery, mobility, or a non-running cross-train if you feel restless. Rest is when adaptation happens — earn it by taking it.',
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
