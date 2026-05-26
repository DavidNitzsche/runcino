/**
 * Seed Learn articles — shared between /learn/[slug] page (kept as a
 * fallback/SEO route) and /api/learn/[slug] (used by the modal on /health).
 */

export interface Article {
  slug: string;
  title: string;
  eyebrow: string | null;
  body_md: string;
  citations_json: Array<{ author: string; year: number; title: string; journal?: string; doi?: string; url?: string }>;
  related_slugs: string[];
}

export const SEED: Record<string, Article> = {
  'why-rest-works': {
    slug: 'why-rest-works',
    title: 'Why rest works.',
    eyebrow: 'RECOVERY',
    body_md: [
      "Training doesn't make you fitter. Recovering from training does. The work tears the system down; the rest builds it back, stronger.",
      'Inside a single rest day, three things land: glycogen restocks, muscle micro-tears repair, and the nervous system that fired hard yesterday resets. Skip the rest and you skip the adaptation.',
      'The classic mistake: counting workouts, not adaptations. A week with two hard days plus rest produces more fitness than a week of seven moderate days.',
    ].join('\n\n'),
    citations_json: [
      { author: 'Seiler', year: 2010, title: "What is best practice for training intensity and duration distribution in endurance athletes?", journal: 'International Journal of Sports Physiology and Performance' },
      { author: 'Mujika', year: 2017, title: 'Endurance training: science and practice.', journal: 'Iñigo Mujika Editorial' },
    ],
    related_slugs: ['hrv', 'rhr'],
  },
  'hrv': {
    slug: 'hrv',
    title: 'HRV · What it is, why we watch it.',
    eyebrow: 'PHYSIOLOGY',
    body_md: [
      'Heart rate variability is the time variation between consecutive heartbeats, measured overnight. It is a window into your autonomic nervous system — sympathetic (fight/flight) vs parasympathetic (rest/digest).',
      "Higher HRV generally means your nervous system is recovered and ready for hard training. Lower HRV can signal fatigue, stress, illness brewing, or accumulating training load. It's one of the best early-warning signals we have for overtraining — dips in HRV often predict bad workouts before the legs do.",
      "We track YOUR baseline, not population norms. A 60ms reading is 'high' for some runners and 'low' for others. What matters is your trend versus your 30-day average.",
    ].join('\n\n'),
    citations_json: [
      { author: 'Plews et al.', year: 2013, title: 'Training adaptation and heart rate variability in elite endurance athletes.', journal: 'European Journal of Applied Physiology' },
      { author: 'Stanley et al.', year: 2013, title: 'Cardiac parasympathetic reactivation following exercise.', journal: 'Sports Medicine' },
    ],
    related_slugs: ['rhr', 'why-rest-works'],
  },
  'rhr': {
    slug: 'rhr',
    title: 'Resting heart rate.',
    eyebrow: 'PHYSIOLOGY',
    body_md: [
      'Resting heart rate trends downward as aerobic fitness improves. A sub-50 RHR is common in trained runners; sub-40 in elite endurance athletes.',
      "It elevates 3-5 bpm during volume jumps, illness brewing, dehydration, or sleep deficit. A sustained +5 bpm bump that doesn't resolve in a few days is the flag to take seriously.",
      "On its own, one elevated reading means nothing. The pattern across days is the signal. We watch the 7-day rolling average against your 60-day baseline.",
    ].join('\n\n'),
    citations_json: [
      { author: 'Buchheit', year: 2014, title: 'Monitoring training status with HR measures.', journal: 'Frontiers in Physiology' },
    ],
    related_slugs: ['hrv', 'vo2-max'],
  },
  'vo2-max': {
    slug: 'vo2-max',
    title: 'VO2 max.',
    eyebrow: 'PHYSIOLOGY',
    body_md: [
      'VO2 max is the peak oxygen your body can use per minute. It is the single best lab predictor of endurance ceiling. Higher VO2 max → faster aerobic running.',
      "Apple's watch estimate isn't lab-grade — it's modeled from heart rate and pace, plus your demographics. It's directionally honest, but absolute numbers should be taken with salt. Month-over-month moves in Apple's number are real signal.",
      'Trained endurance runners typically score 55-75 ml/kg/min for men, 50-65 for women. Elite is 80+.',
    ].join('\n\n'),
    citations_json: [
      { author: 'Bassett & Howley', year: 2000, title: 'Limiting factors for maximum oxygen uptake.', journal: 'Medicine & Science in Sports & Exercise' },
    ],
    related_slugs: ['hrv', 'rhr'],
  },
  'heart-rate-zones': {
    slug: 'heart-rate-zones',
    title: 'Heart rate zones, the Friel way.',
    eyebrow: 'METHODOLOGY',
    body_md: [
      "Most consumer wearables anchor zones to %MHR (max heart rate). For trained runners that's a coin flip — the 220-age formula has a ±10-15 bpm standard error. Two runners with the same MHR can have LTHRs 20+ bpm apart.",
      "We anchor to LTHR (lactate threshold HR) — Joe Friel's seven-zone system, which maps to real physiological transitions (LT1, LT2, MLSS) instead of a guess.",
      "Z1 Recovery (<85% LTHR): true easy days, shake-outs, recovery. Z2 Aerobic (85-89%): the bulk of weekly mileage and long runs. Z3 Tempo (90-94%): marathon pace. Z4 Threshold (95-99%): cruise intervals. Z5 (100%+): VO2 work, hill repeats, race finishes.",
      "How to find your LTHR: a 30-min solo time trial — LTHR ≈ average HR of the final 20 min. Or derive from race avg HR: half marathon ≈ LTHR, marathon ≈ LTHR − 6 bpm, 10K ≈ LTHR + 4. Re-test every 6-12 weeks.",
    ].join('\n\n'),
    citations_json: [
      { author: 'Friel', year: 2009, title: 'The Triathlete\'s Training Bible.', journal: 'VeloPress (LTHR seven-zone system)' },
      { author: 'Seiler', year: 2010, title: 'What is best practice for training intensity distribution in endurance athletes?', journal: 'International Journal of Sports Physiology and Performance' },
    ],
    related_slugs: ['hrv', 'rhr'],
  },
};
