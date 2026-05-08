/**
 * Doctrine — Race-day pacing strategy.
 *
 * Source: Research/08-pacing-and-race-week.md §§2-8
 *
 * Pacing-strategy research (even/negative/positive splits, Diaz/
 * Hettinga 5-km segment framework, Foster anticipatory regulation),
 * distance-specific pacing templates, adverse-conditions tactics,
 * heart-rate/RPE in racing, late-race form cues, segmenting, and the
 * wall.
 *
 * Engine consumers:
 *   - coach.paceStrategy           → distance templates + HR/RPE
 *                                   ceilings for race-morning brief
 *   - coach.briefRaceMorning       → first-mile target + segmenting
 *   - /races/[slug] page           → goal-time pacing plan display
 *
 * Heat/wind/altitude pacing adjustments live in weather.ts. */
import { cite, type Cited } from './cite';

// ── Pacing strategy research foundation ───────────────────────────

/** Even / negative / positive split research findings by runner tier
 *  and race distance. */
export const SPLIT_STRATEGY_BY_TIER: Cited<{
  eliteMarathon: { dominantStrategy: 'even'; cv5kPctLow: number; cv5kPctHigh: number };
  recreationalMarathon: { positivePct: number; negativePct: number; recommendedStrategy: 'controlled_even_or_slight_negative'; rationale: string };
  shorterRaces: { distance: '5K_to_HM'; dominantStrategy: 'even_or_slight_positive' };
}> = {
  value: {
    eliteMarathon: { dominantStrategy: 'even', cv5kPctLow: 1.5, cv5kPctHigh: 3 },
    recreationalMarathon: {
      positivePct: 77, negativePct: 18,
      recommendedStrategy: 'controlled_even_or_slight_negative',
      rationale: 'Glycogen sparing — early conservation cuts anaerobic burn, delaying the 30-35 km crisis.',
    },
    shorterRaces: { distance: '5K_to_HM', dominantStrategy: 'even_or_slight_positive' },
  },
  citations: [
    cite('§2.1 Even, negative, or positive — what wins', 'Elite marathoners: even pacing (CV 1.5-3%). Recreational: 77% positive, 18% negative; sub-elites benefit from slight negative or controlled even pace. 5K-HM: even or slight positive dominate.', 'research', '08'),
  ],
};

/** Diaz / Hettinga 5-km segment framework — pacing CV by performance
 *  tier. The 4th 5-km segment (15-20 km) is most prognostic for the
 *  wall. */
export const PACING_CV_BY_TIER: Cited<Array<{
  tier: string;
  cv5kMenPctLow: number;
  cv5kMenPctHigh: number;
  cv5kWomenPctLow: number;
  cv5kWomenPctHigh: number;
  lateRacePattern: string;
}>> = {
  value: [
    { tier: 'World class (sub-2:10 / sub-2:25)', cv5kMenPctLow: 1.5, cv5kMenPctHigh: 3,    cv5kWomenPctLow: 1.5, cv5kWomenPctHigh: 3,    lateRacePattern: 'Slight end-spurt' },
    { tier: 'National-class',                    cv5kMenPctLow: 3,   cv5kMenPctHigh: 5,    cv5kWomenPctLow: 3,   cv5kWomenPctHigh: 5,    lateRacePattern: 'Modest fade' },
    { tier: 'Sub-3 amateur',                     cv5kMenPctLow: 5,   cv5kMenPctHigh: 8,    cv5kWomenPctLow: 4,   cv5kWomenPctHigh: 7,    lateRacePattern: 'Fade after 30 km' },
    { tier: '3:00-3:30',                         cv5kMenPctLow: 7,   cv5kMenPctHigh: 10,   cv5kWomenPctLow: 6,   cv5kWomenPctHigh: 9,    lateRacePattern: 'Marked slowdown after 30 km' },
    { tier: '3:30-4:00',                         cv5kMenPctLow: 8,   cv5kMenPctHigh: 12,   cv5kWomenPctLow: 7,   cv5kWomenPctHigh: 11,   lateRacePattern: 'Wall around 32-37 km' },
    { tier: '4:00-5:00+',                        cv5kMenPctLow: 10,  cv5kMenPctHigh: 15,   cv5kWomenPctLow: 10,  cv5kWomenPctHigh: 14,   lateRacePattern: 'Major slowdown after 25 km' },
  ],
  note: 'The 4th 5-km segment (15-20 km) is most prognostic — runners who hit the wall typically begin decelerating here, often 1-3 km before they perceive it.',
  citations: [
    cite('§2.2 Diaz / Hettinga 5-km segment framework', 'Performance tier → 5-km CV (men/women) + late-race pattern', 'research', '08'),
  ],
};

/** Foster anticipatory-regulation pacing model. */
export const FOSTER_PACING_MODEL: Cited<{
  framework: string;
  optimalStrategy: string;
  validation: string;
}> = {
  value: {
    framework: 'Endurance racing as anticipatory regulation: the brain throttles output based on predicted remaining work.',
    optimalStrategy: 'Slightly conservative start with acceleration into the body of the race. Going out too fast triggers premature regulation (forced slowdown); too conservative leaves fitness on the table.',
    validation: 'Validated repeatedly in time trials: even or slight negative pacing beats aggressive starts in efforts longer than 2 minutes.',
  },
  citations: [
    cite('§2.3 The Foster pacing model', 'Foster and deKoning frame endurance as anticipatory regulation. Optimal: slightly conservative start, accelerate into body of race.', 'research', '08'),
  ],
};

// ── First-mile pacing ─────────────────────────────────────────────

/** First-mile target relative to goal pace, by distance. Highest-
 *  leverage decision in any race. */
export const FIRST_MILE_TARGET: Cited<Record<
  '5K' | '10K' | 'half' | 'marathon' | 'hilly_marathon',
  { offsetVsGpSPerMiLow: number; offsetVsGpSPerMiHigh: number; rationale: string }
>> = {
  value: {
    '5K':              { offsetVsGpSPerMiLow: -2,  offsetVsGpSPerMiHigh: 5,   rationale: 'Race is too short to bank time; too short to recover from fast start' },
    '10K':             { offsetVsGpSPerMiLow: 5,   offsetVsGpSPerMiHigh: 10,  rationale: 'Conservative opener buys ability to push at 7-9K' },
    half:              { offsetVsGpSPerMiLow: 10,  offsetVsGpSPerMiHigh: 15,  rationale: 'LT-effort race; early acidosis derails the second half' },
    marathon:          { offsetVsGpSPerMiLow: 10,  offsetVsGpSPerMiHigh: 20,  rationale: 'Glycogen-conservation imperative; first 5K should feel "annoyingly easy"' },
    hilly_marathon:    { offsetVsGpSPerMiLow: 30,  offsetVsGpSPerMiHigh: 45,  rationale: 'Eccentric quad damage on early downhills surfaces 16+ miles later (Boston, Big Sur)' },
  },
  note: 'Useful rule: the first mile should feel one full effort tier easier than goal effort. For a marathon, that\'s "easy aerobic" not "marathon pace." For a 5K, "controlled hard" not "all-out."',
  citations: [
    cite('§3.1 First-mile pacing by distance', 'Distance → first-mile target offset vs GP + rationale', 'research', '08'),
  ],
};

// ── Distance-specific pacing templates ────────────────────────────

export type RaceDistance = '5K' | '10K' | 'half' | 'marathon';

/** Per-distance segment-by-segment pacing template. */
export const PACING_TEMPLATE_5K: Cited<Array<{
  segment: string;
  paceVsGp: string;
  cue: string;
}>> = {
  value: [
    { segment: 'Mile 1',         paceVsGp: 'Hit GP within 1-2 sec; never more than 3 sec faster',  cue: 'Controlled' },
    { segment: 'Mile 2',         paceVsGp: 'Hold GP — the mental dark zone where most fades happen', cue: 'Stay with the rhythm' },
    { segment: 'Mile 3',         paceVsGp: 'Maintain or accelerate slightly',                       cue: 'Press' },
    { segment: 'Final 400m',     paceVsGp: 'Kick, empty the tank',                                  cue: 'Empty' },
  ],
  note: 'Critical errors: going out >5 sec/mile too fast (collapse exceeds 15 sec/mile by mile 2); holding back hoping to "kick from behind" (deficit can\'t be made up in 5K); watching the watch (5K runs by feel and breathing). 5K runs at 95-100% VO2max.',
  citations: [
    cite('§3.2 The 5K', 'Mile 1 hit GP, Mile 2 hold, Mile 3 maintain or accelerate, final 400m kick', 'research', '08'),
  ],
};

export const PACING_TEMPLATE_10K: Cited<Array<{
  segment: string;
  paceVsGp: string;
  cue: string;
}>> = {
  value: [
    { segment: '0-2 km',     paceVsGp: 'GP +5 to +10 sec/mi',         cue: 'Controlled' },
    { segment: '2-7 km',     paceVsGp: 'At GP',                        cue: 'Sustainable hard' },
    { segment: '7-9 km',     paceVsGp: 'At GP, hold form',             cue: 'Very hard' },
    { segment: '9-10 km',    paceVsGp: 'Push, kick last 400-600 m',    cue: 'All out' },
  ],
  note: '10K = "5K plus a 5K." First 5K at open 5K PR pace + 5-15 sec; second 5K at whatever\'s left (typically 10-30 sec slower for amateurs; even or faster for elites). 10K runs at ~90-94% VO2max.',
  citations: [
    cite('§3.3 The 10K', 'Pacing template + middle 5K is where races are won and lost', 'research', '08'),
  ],
};

export const PACING_TEMPLATE_HALF: Cited<Array<{
  segment: string;
  paceVsGpSPerMiLow: number;
  paceVsGpSPerMiHigh: number;
  cue: string;
}>> = {
  value: [
    { segment: 'Mile 1',          paceVsGpSPerMiLow: 10,  paceVsGpSPerMiHigh: 15,  cue: 'Slower than goal — controlled' },
    { segment: 'Miles 2-3',       paceVsGpSPerMiLow: 5,   paceVsGpSPerMiHigh: 10,  cue: 'Settling toward GP' },
    { segment: 'Miles 4-10',      paceVsGpSPerMiLow: 0,   paceVsGpSPerMiHigh: 0,   cue: 'At GP — "comfortably hard"' },
    { segment: 'Miles 11-13.1',   paceVsGpSPerMiLow: 0,   paceVsGpSPerMiHigh: 0,   cue: 'At GP; push final mile' },
  ],
  note: 'A correctly paced half feels "comfortably hard" through 10 km, "hard" through 16 km, "very hard" in the final 5 km. If miles 1-3 feel "hard," pace is wrong. HM runs at ~88-92% VO2max.',
  citations: [
    cite('§3.4 The half marathon', 'Mile 1 GP+10-15, Miles 2-3 GP+5-10, Miles 4-10 at GP, push final mile', 'research', '08'),
  ],
};

export type MarathonStrategy = '10_10_10' | 'pfitzinger_conservative' | 'canova_specificity';

export const PACING_TEMPLATE_MARATHON: Cited<Record<MarathonStrategy, {
  description: string;
  segments: Array<{ miles: string; pace: string; cue: string }>;
  bestFor: string;
}>> = {
  value: {
    '10_10_10': {
      description: 'Most amateurs',
      segments: [
        { miles: 'Miles 1-10',  pace: 'GP + 5-10 sec',          cue: 'Controlled' },
        { miles: 'Miles 11-20', pace: 'GP',                     cue: 'Locked in' },
        { miles: 'Miles 21-26', pace: 'GP or slight push',      cue: 'Empty tank' },
      ],
      bestFor: 'Amateur marathoners; balances early conservation with fitness use',
    },
    pfitzinger_conservative: {
      description: 'Pfitzinger conservative',
      segments: [
        { miles: 'Miles 1-3',   pace: 'GP + 5-10 sec',                                cue: 'Settling' },
        { miles: 'Miles 4-20',  pace: 'GP exactly',                                   cue: 'Locked' },
        { miles: 'Miles 21-26', pace: 'Hold; do not slow more than 5 sec/mile',       cue: 'Stay tall' },
      ],
      bestFor: 'Disciplined runners, hot conditions, hilly courses',
    },
    canova_specificity: {
      description: 'Canova specificity (advanced)',
      segments: [
        { miles: 'Miles 1-2',   pace: 'GP + 10 sec',                                       cue: 'Settle' },
        { miles: 'Miles 3-22',  pace: 'GP, with 1-2 5-km segments at GP -5 sec',           cue: 'Surge in body of race' },
        { miles: 'Miles 23-26', pace: 'Hold; controlled push final 2K',                    cue: 'Empty' },
      ],
      bestFor: 'Advanced marathoners with marathon-specific block + tactical race',
    },
  },
  note: 'Key rule: second 10K should never be slower than first 10K by more than 1-2%. A 4:00 marathon as 1:55/2:05 is botched; the same fitness as 2:00/2:00 finishes 5+ minutes faster. Marathon runs at 78-88% VO2max — glycogen is the dominant limiter.',
  citations: [
    cite('§3.5 The marathon', '10-10-10, Pfitzinger conservative, Canova specificity strategies', 'research', '08'),
  ],
};

// ── Hilly course pacing ───────────────────────────────────────────

export const HILLY_PACE_ADJUSTMENT: Cited<Array<{
  gradePctLow: number;
  gradePctHigh: number;
  paceAdjVsFlatGpSPerMiLow: number;
  paceAdjVsFlatGpSPerMiHigh: number;
  notes?: string;
}>> = {
  value: [
    { gradePctLow: -3,   gradePctHigh: -3,  paceAdjVsFlatGpSPerMiLow: -20, paceAdjVsFlatGpSPerMiHigh: -10, notes: 'Downhill: let gravity do work, but control braking' },
    { gradePctLow: -2,   gradePctHigh: -1,  paceAdjVsFlatGpSPerMiLow: -10, paceAdjVsFlatGpSPerMiHigh: -5  },
    { gradePctLow: 0,    gradePctHigh: 0,   paceAdjVsFlatGpSPerMiLow: 0,   paceAdjVsFlatGpSPerMiHigh: 0   },
    { gradePctLow: 1,    gradePctHigh: 2,   paceAdjVsFlatGpSPerMiLow: 10,  paceAdjVsFlatGpSPerMiHigh: 15  },
    { gradePctLow: 3,    gradePctHigh: 3,   paceAdjVsFlatGpSPerMiLow: 20,  paceAdjVsFlatGpSPerMiHigh: 30  },
    { gradePctLow: 5,    gradePctHigh: 5,   paceAdjVsFlatGpSPerMiLow: 40,  paceAdjVsFlatGpSPerMiHigh: 60  },
    { gradePctLow: 7,    gradePctHigh: 7,   paceAdjVsFlatGpSPerMiLow: 60,  paceAdjVsFlatGpSPerMiHigh: 90, notes: 'Often a hike' },
  ],
  note: 'Hold heart rate or RPE constant rather than pace. On a 5% uphill at marathon effort, expect 30-45 sec/km slower while HR holds.',
  citations: [
    cite('§4.4 Hilly courses — effort-based, not pace-based', 'Grade → pace adjustment vs flat GP', 'research', '08'),
  ],
};

/** Net-downhill course-specific pacing. Eccentric quad damage during
 *  downhill braking surfaces 60-90 min later — early downhills must
 *  be paced conservatively. */
export const NET_DOWNHILL_COURSE_PACING: Cited<Array<{
  course: 'boston' | 'big_sur' | 'cim_revel_st_george';
  description: string;
  rules: string[];
}>> = {
  value: [
    {
      course: 'boston',
      description: 'Hopkinton drop → Newton Hills → descent to Boylston',
      rules: [
        'Miles 1-4 (downhill): run 30-45 sec/mile slower than flat GP. Quad damage here breaks the race at miles 22-24.',
        'Miles 5-15: hold GP.',
        'Miles 16-21 (Newton Hills): convert to effort; expect 15-30 sec/mile slower on Heartbreak.',
        'Miles 22-26: closing descent punishes early quad damage. Correctly run, miles 22-26 splits stay within 10 sec of GP.',
      ],
    },
    {
      course: 'big_sur',
      description: 'Rolling, not net-downhill as commonly assumed',
      rules: [
        'The 2-mile Hurricane Point climb (mile 10-12) is the defining test.',
        'Miles 1-5 conservative (+15-30 sec).',
        'Race miles 13-22.',
      ],
    },
    {
      course: 'cim_revel_st_george',
      description: 'CIM, Revel, Tucson, St. George — true net-downhill PR courses',
      rules: [
        'Course-PR potential is real but only with quad-protective training (downhill long runs) and conservative early pacing.',
        'Expected gain vs flat: 1-3% for trained downhill runners; 0% or negative for untrained.',
        'Do not chase early miles — 6:30/mile through mile 6 of CIM feels like 7:00/mile flat but eccentric load is double.',
      ],
    },
  ],
  citations: [
    cite('§4.5 Net downhill courses', 'Boston / Big Sur / CIM-Revel-St-George specific rules', 'research', '08'),
  ],
};

// ── Tactical racing ───────────────────────────────────────────────

/** When to use specific race tactics. */
export const RACE_TACTICS: Cited<Array<{
  tactic: 'sit_and_kick' | 'front_running_breakaway' | 'pack_running' | 'pacing_groups';
  whenToUse: string;
  failureMode?: string;
  benefitNote?: string;
}>> = {
  value: [
    {
      tactic: 'sit_and_kick',
      whenToUse: 'Stronger finish than the field, or field starts slow. Sit 1-3 sec behind leader\'s shoulder; kick with 600-1200 m to go on roads, 200-400 m on track.',
      failureMode: 'Field surges at 2K and the kicker is dropped before the kick opens. Solution: practice mid-race surges in training.',
    },
    {
      tactic: 'front_running_breakaway',
      whenToUse: 'Aerobic strength but no kick, or conditions reward fast pacing. Push the early-middle stage (e.g., hard 5-km block at 10K-15K of a half) to drop sprinters.',
      failureMode: 'Soloing into headwind costs 5-15% extra at any pace.',
    },
    {
      tactic: 'pack_running',
      whenToUse: 'For most amateurs, the highest-value tactic. Drafting in a pack of 2-6 cuts metabolic cost 1-7%. In marathon, a stable pace pack worth 1-2% of finish time.',
      benefitNote: 'Find a pack within 5 sec/mile of GP in first 2 km; if pack is faster than GP, let it go (don\'t bank time); stay in second/third row (front gets no draft); take fueling lines that don\'t break draft.',
    },
    {
      tactic: 'pacing_groups',
      whenToUse: 'Goal pace 5+ min from current PR; first marathon at distance; crowded race start; variable rolling course.',
      failureMode: 'Pacer goes out 5+ sec/mile fast (banks lactate); group balloons to 30+; pacer banks early time on rolling course; runner\'s true fitness is between two posted paces.',
    },
  ],
  citations: [
    cite('§5 Tactical Racing', 'Sit-and-kick, front-running, pack running, pacing groups', 'research', '08'),
  ],
};

// ── HR + RPE in racing ────────────────────────────────────────────

export const HR_CEILINGS_BY_DISTANCE: Cited<Record<RaceDistance, {
  hrMaxPctLow: number;
  hrMaxPctHigh: number;
  lthrPctLow: number;
  lthrPctHigh: number;
}>> = {
  value: {
    '5K':       { hrMaxPctLow: 95, hrMaxPctHigh: 100, lthrPctLow: 105, lthrPctHigh: 110 },
    '10K':      { hrMaxPctLow: 92, hrMaxPctHigh: 96,  lthrPctLow: 100, lthrPctHigh: 105 },
    half:       { hrMaxPctLow: 88, hrMaxPctHigh: 92,  lthrPctLow: 96,  lthrPctHigh: 100 },
    marathon:   { hrMaxPctLow: 80, hrMaxPctHigh: 88,  lthrPctLow: 88,  lthrPctHigh: 95  },
  },
  note: 'HR ceilings are guides, not laws. Cardiovascular drift adds 3-5 bpm/hour at constant effort, so fixed mid-marathon caps are unreliable. Use HR as a backstop; pace and RPE primary. Marathon HR >90% HRmax in the first half predicts a blow-up. Race HR >95% HRmax sustained >10 min predicts collapse for races >10K.',
  citations: [
    cite('§6.1 Heart-rate ceilings by distance', '5K 95-100% HRmax, 10K 92-96%, Half 88-92%, Marathon 80-88%', 'research', '08'),
  ],
};

export const RPE_BY_DISTANCE_AND_STAGE: Cited<Record<RaceDistance, {
  rpeStartLow: number;
  rpeStartHigh: number;
  rpeMidLow: number;
  rpeMidHigh: number;
  rpeFinalQuarterLow: number;
  rpeFinalQuarterHigh: number;
}>> = {
  value: {
    '5K':       { rpeStartLow: 6, rpeStartHigh: 7, rpeMidLow: 8, rpeMidHigh: 8, rpeFinalQuarterLow: 9, rpeFinalQuarterHigh: 10 },
    '10K':      { rpeStartLow: 5, rpeStartHigh: 6, rpeMidLow: 7, rpeMidHigh: 8, rpeFinalQuarterLow: 9, rpeFinalQuarterHigh: 10 },
    half:       { rpeStartLow: 5, rpeStartHigh: 5, rpeMidLow: 6, rpeMidHigh: 7, rpeFinalQuarterLow: 8, rpeFinalQuarterHigh: 9  },
    marathon:   { rpeStartLow: 3, rpeStartHigh: 4, rpeMidLow: 5, rpeMidHigh: 6, rpeFinalQuarterLow: 8, rpeFinalQuarterHigh: 10 },
  },
  note: 'For races over 10K and any race in heat or hills, RPE outperforms pace as a control variable. Calibration cue: if marathon\'s first 10K is RPE 6+, the pace is wrong. The first 10K should feel "comfortable" and trigger active restraint. Borg CR-10 anchors.',
  citations: [
    cite('§6.2 RPE as primary control', 'Borg CR-10: RPE at start, midpoint, final 25% by distance', 'research', '08'),
  ],
};

// ── Late-race form cues ───────────────────────────────────────────

export const LATE_RACE_FORM_CUES: Cited<Array<{
  cue: string;
  whatItFixes: string;
}>> = {
  value: [
    { cue: 'Quick feet',         whatItFixes: 'Restores cadence' },
    { cue: 'Tall and proud',     whatItFixes: 'Restores posture, opens chest' },
    { cue: 'Drive the elbow',    whatItFixes: 'Restores arm swing rhythm' },
    { cue: 'Squeeze the glute',  whatItFixes: 'Restores hip extension' },
    { cue: 'Soft hands',         whatItFixes: 'Reduces shoulder tension' },
    { cue: 'Light steps',        whatItFixes: 'Reduces braking force' },
  ],
  note: 'Cycle through cues every 30-60 seconds in the last 10K. They reset focus and momentarily reorganize neuromuscular patterns. Under fatigue cadence falls 3-8 spm in final 10K of a marathon, stride lengthens (overstriding), vertical oscillation rises, posture collapses.',
  citations: [
    cite('§7 Cadence and Form During Late-Race Fatigue', '6 cues + what each fixes; cycle every 30-60 s in last 10K', 'research', '08'),
  ],
};

// ── Race chunking / segmenting ────────────────────────────────────

export const RACE_SEGMENTING_METHODS: Cited<Array<{
  method: string;
  howItWorks: string;
}>> = {
  value: [
    { method: '5K segments (marathon)',                howItWorks: 'Mentally race "another 5K," not "another 22 miles"' },
    { method: 'Aid station to aid station',            howItWorks: 'Reset every ~2 miles: drink, fuel, reassess' },
    { method: 'Gel intervals',                          howItWorks: 'Each segment ends with the next gel' },
    { method: 'Mile-by-mile ("run the mile you\'re in")', howItWorks: 'Hardest mental discipline; refuses to think past the next mile' },
    { method: 'Course landmarks',                       howItWorks: 'Use bridges, turns, hills as natural breakpoints' },
    { method: 'Quartiles',                              howItWorks: 'Particularly useful for half marathons (first / second / third / final quarter)' },
  ],
  note: 'Tactical layer: each segment gets a process goal. E.g., "first 10K = controlled breathing"; "miles 11-20 = stay with pack"; "miles 21-26 = one mile at a time, form cues only."',
  citations: [
    cite('§8.1 Race chunking (segmenting)', '6 segmenting methods', 'research', '08'),
  ],
};

// ── The wall ──────────────────────────────────────────────────────

/** Mechanism, prevalence, and prevention for the marathon wall. */
export const THE_WALL: Cited<{
  whatItIs: string;
  mechanism: string;
  whoLow: number;
  whoHigh: number;
  preventionLevers: Array<{ lever: string; how: string }>;
}> = {
  value: {
    whatItIs: 'Abrupt pacing collapse, typically at 30-35 km. Pace drops 30-90 sec/mile in 1-2 km. Subjective: legs go from "tired" to "unable to respond."',
    mechanism: 'Combined glycogen depletion (peripheral) + central fatigue. When muscle glycogen falls below ~20% of starting capacity, fat oxidation cannot supply ATP at MP rates. Brain detects falling fuel and downregulates motor output (Noakes central governor framework).',
    whoLow: 40, whoHigh: 60,  // 40-60% of marathon finishers report wall-like experience
    preventionLevers: [
      { lever: 'Aerobic base',                how: 'Higher base mileage builds glycogen capacity; fat-oxidation training spares glycogen' },
      { lever: 'Marathon-pace specific work', how: 'Long runs with 12+ miles at MP train the metabolic machinery' },
      { lever: 'Pacing',                       how: 'Conservative first half cuts anaerobic glycogen burn by 30-50%' },
      { lever: 'Carb loading',                 how: '8-12 g/kg/day for 24-48 h pre-race adds 50-100% to glycogen stores' },
      { lever: 'Race-day fueling',             how: '60-90 g/h carbs delays muscle glycogen depletion by 30-60 min' },
      { lever: 'Caffeine',                     how: '3-6 mg/kg pre-race + late-race dose blunts central fatigue' },
      { lever: 'Heat management',              how: 'Lower core temp preserves CNS function' },
    ],
  },
  note: '4:00+ marathoners disproportionately affected (more time at intensities above fat-oxidation capacity); sub-3:00 hit fewer walls but more catastrophic ones.',
  citations: [
    cite('§8.2 The wall — mechanism and prevention', 'What it is + mechanism + prevalence + 7 prevention levers', 'research', '08'),
  ],
};

/** Late-race rescue protocol — if the wall hits. */
export const LATE_RACE_RESCUE: Cited<Array<{
  step: number;
  action: string;
}>> = {
  value: [
    { step: 1, action: 'Walk through the next aid station. 30-60 sec of walking restores HR and lets fuel hit; time loss recovered if running resumes.' },
    { step: 2, action: 'Take gel + caffeine + water immediately. 30 g carbs + 100 mg caffeine.' },
    { step: 3, action: 'Reduce pace to what can be held without further deterioration. A 30 sec/mile slowdown that holds beats a "try to maintain GP" that becomes 90 sec/mile.' },
    { step: 4, action: 'External focus. Tether to a runner 10-20 m ahead. Internal focus on fatigue accelerates collapse.' },
    { step: 5, action: 'Mile-by-mile cuing. Refuse to think past the next aid station.' },
  ],
  citations: [
    cite('§8.3 Late-race rescue (if the wall hits)', '5-step rescue protocol', 'research', '08'),
  ],
};

// ── In-race decision triggers ─────────────────────────────────────

export const IN_RACE_DECISION_TRIGGERS: Cited<Array<{
  trigger: string;
  action: string;
}>> = {
  value: [
    { trigger: 'Mile 1 is 10+ sec/mile too fast',                 action: 'Slow to GP+5 for next 2 miles' },
    { trigger: 'HR >90% HRmax in first half',                     action: 'Hold pace, reassess at next 5K' },
    { trigger: 'Stomach distress',                                action: 'Walk through next aid, sip electrolyte, restart slowly' },
    { trigger: 'Missed gel',                                       action: 'Take asap, restart 30-min intervals' },
    { trigger: 'Pace falls 15+ sec/mile mid-race',                action: 'Walk 30 s, fuel + caffeine, restart adjusted' },
    { trigger: 'Cramping',                                         action: 'Salt + slow + shorten stride; resume gradually' },
    { trigger: 'Side stitch',                                      action: 'Slow, deep diaphragmatic breath, exhale on opposite footstrike' },
    { trigger: 'GPS drifting from markers',                       action: 'Switch to course markers; GPS overestimates on tangents' },
  ],
  citations: [
    cite('§18.3 In-race decision triggers', '8 trigger → action rules for in-race adjustments', 'research', '08'),
  ],
};
