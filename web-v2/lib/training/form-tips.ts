/**
 * form-tips.ts — library of running-form metrics with definitions,
 * target ranges, classification of a current value, and drills/
 * corrections when something is flagged.
 *
 * Each tip is opened from a form stat tile in the run detail modal OR
 * browsed on the /tips page. The voice is direct and prescriptive —
 * coach giving a one-thing-to-do, not a textbook.
 *
 * Doctrine in the code; the SOURCE files in `/Research/` are the source
 * of truth but never surfaced to the runner (per "no citations in UI" rule).
 */

export type FormBand = 'elite' | 'good' | 'fine' | 'flag';

export interface FormTipBand {
  band: FormBand;
  range: string;        // human-readable range like "175-180 spm"
  label: string;        // "Elite efficiency"
  meaning: string;      // what it means
}

export interface FormTip {
  key: string;           // metric key — matches RunForm field
  title: string;         // human title
  unit: string;          // "spm", "ms", "m", "cm", "%", "w", "%", "/min"
  oneLiner: string;      // one-line summary for cards
  whatItIs: string;      // what this metric measures
  whyItMatters: string;  // why it matters for running

  bands: FormTipBand[];  // bands ordered best→worst
  /** Classify a numeric value into a band. Lower-is-better metrics still
   *  use the bands array in best→worst order. */
  classify: (value: number) => FormTipBand;

  drillsWhenFlagged: string[];  // 2-4 specific things to do if flagged
}

// ── Helpers ─────────────────────────────────────────────────────────────

function band(value: number, ranges: Array<[number, number, FormBand, string, string, string]>): FormTipBand {
  // ranges: [min, max, band, rangeLabel, label, meaning]
  for (const [min, max, b, range, label, meaning] of ranges) {
    if (value >= min && value <= max) return { band: b, range, label, meaning };
  }
  // Fall through to the worst band if out of range
  const last = ranges[ranges.length - 1];
  return { band: last[2], range: last[3], label: last[4], meaning: last[5] };
}

// ── Tip library ─────────────────────────────────────────────────────────

export const FORM_TIPS: Record<string, FormTip> = {
  cadence_spm: {
    key: 'cadence_spm',
    title: 'Cadence',
    unit: 'spm',
    oneLiner: 'Steps per minute — the rhythm of your run.',
    whatItIs: 'How many times your feet hit the ground per minute. Counts both feet — a single foot strike is half a step.',
    whyItMatters: 'Higher cadence (shorter, quicker steps) reduces ground contact time and bounce. Most efficient runners land 175-185 spm regardless of pace. Slow cadence usually means overstriding — landing with your foot ahead of your hips, braking each step.',
    bands: [
      { band: 'elite', range: '180+ spm', label: 'Elite turnover', meaning: 'Efficient, low ground contact.' },
      { band: 'good',  range: '170-180 spm', label: 'Optimal range', meaning: 'Most efficient marathoners live here.' },
      { band: 'fine',  range: '160-170 spm', label: 'Fine, room to lift', meaning: 'A few more spm would reduce overstriding.' },
      { band: 'flag',  range: '< 160 spm',   label: 'Overstriding flag', meaning: 'Likely landing ahead of your hips and braking.' },
    ],
    classify: (v) => band(v, [
      [180, 250, 'elite', '180+ spm', 'Elite turnover', 'Efficient, low ground contact.'],
      [170, 179.9, 'good', '170-180 spm', 'Optimal range', 'Most efficient marathoners live here.'],
      [160, 169.9, 'fine', '160-170 spm', 'Fine, room to lift', 'A few more spm would reduce overstriding.'],
      [0,   159.9, 'flag', '< 160 spm',   'Overstriding flag', 'Likely landing ahead of your hips and braking.'],
    ]),
    drillsWhenFlagged: [
      'Run with a metronome at 175 spm for the first 10 minutes of easy runs — let your stride shorten naturally.',
      '4 × 30-second strides at the end of easy runs, focused on quick foot turnover. Don\'t reach with the foot — let it land under your hip.',
      'On treadmill: bump pace 5-10s/mi faster for short stretches. Faster pace forces higher cadence naturally; bring that turnover back to easy pace.',
      'Visualize "fast feet, short steps" rather than "long strides".',
    ],
  },

  ground_contact_ms: {
    key: 'ground_contact_ms',
    title: 'Ground Contact Time',
    unit: 'ms',
    oneLiner: 'How long each foot stays on the ground.',
    whatItIs: 'The duration (in milliseconds) that each foot is in contact with the ground per stride. Apple Watch measures this from accelerometer + gyroscope data.',
    whyItMatters: 'Shorter contact = faster running economy. Elite distance runners are 200-230ms. Long contact correlates with overstriding and a heavier landing — the energy spent pushing off lasts longer.',
    bands: [
      { band: 'elite', range: '< 220 ms', label: 'Elite range', meaning: 'Quick, light steps. Sub-elite distance runners live here.' },
      { band: 'good',  range: '220-260 ms', label: 'Efficient', meaning: 'Good ground contact for trained runners.' },
      { band: 'fine',  range: '260-300 ms', label: 'Typical recreational', meaning: 'Room to tighten through cadence work.' },
      { band: 'flag',  range: '> 300 ms', label: 'Long contact', meaning: 'Suggests overstriding or weak push-off.' },
    ],
    classify: (v) => band(v, [
      [0,   220, 'elite', '< 220 ms', 'Elite range', 'Quick, light steps. Sub-elite distance runners live here.'],
      [220, 260, 'good',  '220-260 ms', 'Efficient', 'Good ground contact for trained runners.'],
      [260, 300, 'fine',  '260-300 ms', 'Typical recreational', 'Room to tighten through cadence work.'],
      [300, 9999, 'flag', '> 300 ms', 'Long contact', 'Suggests overstriding or weak push-off.'],
    ]),
    drillsWhenFlagged: [
      'Hill repeats — 6 × 30s steep uphill at hard effort. Forces a quick, powerful push-off and naturally shortens ground contact.',
      'Pop-up plyos: 3 × 10 quick low jumps off both feet, focusing on minimal floor time. Twice a week, after easy runs.',
      'Drill the cadence fix (175+ spm) — they\'re linked. Shorter steps = shorter contact.',
      'Strength: single-leg calf raises, 3 × 12 each side, 2× per week. Stronger calves = faster push-off.',
    ],
  },

  stride_length_m: {
    key: 'stride_length_m',
    title: 'Stride Length',
    unit: 'm',
    oneLiner: 'Distance covered per step.',
    whatItIs: 'How far you travel between each footfall, in meters. Pace = cadence × stride length.',
    whyItMatters: 'Stride length naturally grows with pace and aerobic fitness. The trap: lengthening stride to go faster by reaching with the foot leads to overstriding. The better way: keep cadence high and let stride length increase from a stronger push-off.',
    bands: [
      { band: 'good', range: '1.30-1.60 m', label: 'Typical at marathon pace', meaning: 'Stride scales with pace; this range reflects 8-9 min/mi territory.' },
      { band: 'fine', range: '1.00-1.30 m', label: 'Easy / recovery pace', meaning: 'Normal for easy runs.' },
      { band: 'flag', range: '< 1.00 m',   label: 'Very short stride',  meaning: 'Could be over-cautious or fatigue.' },
    ],
    classify: (v) => band(v, [
      [1.3, 9, 'good', '1.30-1.60 m', 'Typical at marathon pace', 'Stride scales with pace; this range reflects 8-9 min/mi territory.'],
      [1.0, 1.3, 'fine', '1.00-1.30 m', 'Easy / recovery pace', 'Normal for easy runs.'],
      [0, 1.0, 'flag', '< 1.00 m', 'Very short stride', 'Could be over-cautious or fatigue.'],
    ]),
    drillsWhenFlagged: [
      'Strides — 4-6 × 20s at near-mile pace at the end of easy runs. Builds the muscular ability to stride longer without reaching.',
      'Hill bounding: 4 × 30s uphill at hard effort with exaggerated push-off. Develops the power to lengthen stride from the ground up.',
      'Don\'t fix this by reaching — that creates overstriding. Cadence + push-off does it.',
    ],
  },

  vertical_oscillation_cm: {
    key: 'vertical_oscillation_cm',
    title: 'Vertical Oscillation',
    unit: 'cm',
    oneLiner: 'How much you bounce up and down with each stride.',
    whatItIs: 'The vertical movement of your torso (in cm) per stride. Measured by Apple Watch accelerometer.',
    whyItMatters: 'Every cm of vertical motion is energy spent NOT going forward. Elite distance runners are 6-8 cm; recreational 9-11 cm. High bounce = energy leak.',
    bands: [
      { band: 'elite', range: '< 7 cm',   label: 'Elite efficiency', meaning: 'Almost no wasted vertical motion.' },
      { band: 'good',  range: '7-9 cm',   label: 'Efficient',        meaning: 'Good economy for trained runners.' },
      { band: 'fine',  range: '9-10.5 cm', label: 'Typical',           meaning: 'Recreational range; some room to lower.' },
      { band: 'flag',  range: '> 10.5 cm', label: 'High bounce',       meaning: 'Significant energy leak. Probably linked to low cadence.' },
    ],
    classify: (v) => band(v, [
      [0,   7,    'elite', '< 7 cm',     'Elite efficiency', 'Almost no wasted vertical motion.'],
      [7,   9,    'good',  '7-9 cm',     'Efficient',        'Good economy for trained runners.'],
      [9,   10.5, 'fine',  '9-10.5 cm',  'Typical',          'Recreational range; some room to lower.'],
      [10.5,99,   'flag',  '> 10.5 cm',  'High bounce',      'Significant energy leak. Probably linked to low cadence.'],
    ]),
    drillsWhenFlagged: [
      'Lift cadence to 175+ spm. Shorter steps = less time airborne = less vertical motion. This is the #1 fix.',
      'Visualize horizontal motion: "head moving forward, not up." Try running in front of a mirror or window where you can see your head height.',
      'Skip the heel strike — landing under your hips reduces the upward bounce of each stride.',
      'Core strength — planks 3 × 30s, side planks 3 × 20s each side, 2× per week. A stiffer trunk damps oscillation.',
    ],
  },

  vertical_ratio_pct: {
    key: 'vertical_ratio_pct',
    title: 'Vertical Ratio',
    unit: '%',
    oneLiner: 'Vertical bounce as a percentage of stride length — the efficiency ratio.',
    whatItIs: 'Vertical oscillation ÷ stride length, as a percentage. The cleanest single-number form indicator.',
    whyItMatters: 'A 10cm bounce in a 1.6m stride is more efficient than a 10cm bounce in a 1.0m stride. Vertical ratio normalizes for pace. Elite < 6%, good < 8%, recreational 8-10%.',
    bands: [
      { band: 'elite', range: '< 6%',  label: 'Elite efficiency', meaning: 'World-class form.' },
      { band: 'good',  range: '6-8%',  label: 'Trained runner',    meaning: 'Strong form.' },
      { band: 'fine',  range: '8-10%', label: 'Typical',           meaning: 'Recreational range.' },
      { band: 'flag',  range: '> 10%', label: 'Inefficient bounce', meaning: 'Significant room to reduce bounce relative to stride.' },
    ],
    classify: (v) => band(v, [
      [0, 6, 'elite', '< 6%',  'Elite efficiency', 'World-class form.'],
      [6, 8, 'good',  '6-8%',  'Trained runner',    'Strong form.'],
      [8, 10, 'fine', '8-10%', 'Typical',           'Recreational range.'],
      [10, 99, 'flag', '> 10%', 'Inefficient bounce', 'Significant room to reduce bounce relative to stride.'],
    ]),
    drillsWhenFlagged: [
      'Same fix list as vertical oscillation — primarily cadence work. Lifting cadence reduces both numerator (bounce) and grows denominator (stride length) over time.',
      'Mid-run cadence check: every 10 min, count steps for 15s and multiply by 4. Should hit 175+ at easy pace.',
      'Plyometrics — 2 × per week. Box jumps + bounding teach the body to spring forward, not up.',
    ],
  },

  run_power_w: {
    key: 'run_power_w',
    title: 'Running Power',
    unit: 'w',
    oneLiner: 'The actual work output per stride, in watts.',
    whatItIs: 'Estimated work in watts — derived from cadence, vertical motion, ground contact, pace, and your body weight. Apple Watch reports it from watchOS 10.',
    whyItMatters: 'Power is the most consistent effort metric across terrain. HR drifts in heat, pace drifts on hills, but power reflects what you\'re actually doing. Useful for pacing hilly long runs, race-day effort, and tracking improvement at the same pace.',
    bands: [
      { band: 'good', range: 'depends on weight, pace, terrain', label: 'No universal target', meaning: 'Track YOUR baseline. A 270w long run is meaningful in context of YOUR 270w; absolute numbers vary by runner weight + form.' },
    ],
    classify: () => ({ band: 'good', range: 'depends', label: 'Track your baseline', meaning: 'Compare to your own past runs.' }),
    drillsWhenFlagged: [
      'Run power isn\'t a flag-able metric on its own — use it as a pacing tool. Find your easy-effort wattage and your threshold wattage from past runs.',
      'On a hilly long run: hold steady power instead of steady pace. Pace will slow uphill and speed downhill; effort stays constant.',
      'Track week-over-week: if you can hit the same pace at lower power, you\'re getting more economical.',
    ],
  },

  spo2_pct: {
    key: 'spo2_pct',
    title: 'Blood Oxygen (SpO₂)',
    unit: '%',
    oneLiner: 'Oxygen saturation of your blood.',
    whatItIs: 'Percentage of hemoglobin carrying oxygen. Measured optically by the watch. Normal at sea level: 95-100%.',
    whyItMatters: 'Mostly a health indicator, not a running metric. A sustained drop (< 92%) can flag respiratory issues, altitude effects, or sleep apnea. Doesn\'t change per-run, but trends matter.',
    bands: [
      { band: 'good', range: '95-100%', label: 'Normal',   meaning: 'No flag.' },
      { band: 'fine', range: '92-95%',  label: 'Watch it', meaning: 'Could be altitude or fatigue.' },
      { band: 'flag', range: '< 92%',   label: 'See a doc', meaning: 'Sustained low SpO₂ warrants a medical check.' },
    ],
    classify: (v) => band(v, [
      [95, 101, 'good', '95-100%', 'Normal',   'No flag.'],
      [92, 95,  'fine', '92-95%',  'Watch it', 'Could be altitude or fatigue.'],
      [0,  92,  'flag', '< 92%',   'See a doc', 'Sustained low SpO₂ warrants a medical check.'],
    ]),
    drillsWhenFlagged: [
      'A single low reading is noise. Sustained low (multiple days) → medical consultation.',
      'Not a training metric to act on — it\'s a health metric to monitor.',
    ],
  },

  respiratory_rate: {
    key: 'respiratory_rate',
    title: 'Respiratory Rate',
    unit: '/min',
    oneLiner: 'Breaths per minute, measured overnight.',
    whatItIs: 'How many times you breathe per minute (resting / overnight). Apple Watch tracks this from sleep data.',
    whyItMatters: 'Resting respiratory rate is an autonomic-state indicator. A persistent jump of 2-3 breaths above your baseline can flag illness brewing, overtraining, or stress — often before HRV catches it.',
    bands: [
      { band: 'good', range: '12-20 / min', label: 'Normal adult resting', meaning: 'No flag in isolation.' },
      { band: 'flag', range: 'sustained +2-3 above your baseline', label: 'Watch it', meaning: 'Persistent elevation flags illness or overtraining brewing.' },
    ],
    classify: () => ({ band: 'good', range: '12-20 / min', label: 'Track YOUR baseline', meaning: 'Absolute number matters less than your trend.' }),
    drillsWhenFlagged: [
      'Not a per-run actionable. Track baseline over weeks.',
      'If sustained above baseline + RHR elevated + HRV down → pull back on hard work, prioritize sleep.',
    ],
  },
};

/** Try to find the tip for a key the modal/page uses. */
export function tipFor(key: string): FormTip | null {
  return FORM_TIPS[key] ?? null;
}

/** All tips in display order. */
export function allTips(): FormTip[] {
  return [
    FORM_TIPS.cadence_spm,
    FORM_TIPS.ground_contact_ms,
    FORM_TIPS.stride_length_m,
    FORM_TIPS.vertical_oscillation_cm,
    FORM_TIPS.vertical_ratio_pct,
    FORM_TIPS.run_power_w,
    FORM_TIPS.respiratory_rate,
    FORM_TIPS.spo2_pct,
  ];
}
