/**
 * Doctrine — Mental training, sport psychology applied to running.
 *
 * Source: Research/20-mental-training.md
 *
 * Engine consumers:
 *   - coach.briefRaceMorning   → SELF_TALK_BY_PHASE +
 *                                 PRE_RACE_ANXIETY_PROTOCOLS
 *   - coach.adjustForReality   → POST_RACE_BLUES_DECISION
 *                                 + DNF_DECISION_RULES
 *   - profile / settings UI    → BURNOUT_WARNING_SIGNS */
import { cite, type Cited } from '.';

// ── Goal-setting ──────────────────────────────────────────────────

export const GOAL_SETTING_FRAMEWORKS: Cited<{
  smart: string;
  abc: { A: string; B: string; C: string };
  outcomeProcessPerformance: string;
}> = {
  value: {
    smart: 'Specific, Measurable, Achievable, Relevant, Time-bound. Locke & Latham 35-yr meta-research: specific + difficult goals beat vague + easy ones.',
    abc: {
      A: 'A goal: stretch goal. <30% probability. Galvanizes effort, accepts risk of failure.',
      B: 'B goal: realistic goal. 50-70% probability. Most likely actual outcome.',
      C: 'C goal: insurance goal. 95%+ probability. Race-saving floor — finish, no injury.',
    },
    outcomeProcessPerformance: 'Outcome goals (place, time) are external — uncontrollable factors weigh heavily. Process goals (pacing, fueling, form) are controllable; performance goals (PR, time benchmarks) are intermediate.',
  },
  citations: [
    cite('§Goal Setting', 'SMART (Locke & Latham); A/B/C tiers (Daniels); outcome vs process vs performance goals', 'research', '20'),
  ],
};

// ── Visualization ─────────────────────────────────────────────────

export const PETTLEP_VISUALIZATION: Cited<{
  framework: string;
  components: Array<{ letter: string; element: string; description: string }>;
  protocol: string;
}> = {
  value: {
    framework: 'PETTLEP imagery (Holmes & Collins 2001) — most validated visualization model in sport psychology',
    components: [
      { letter: 'P', element: 'Physical',     description: 'Wear race kit while imagining; assume race posture' },
      { letter: 'E', element: 'Environment',   description: 'Imagine actual course; pre-trip drive-through helps' },
      { letter: 'T', element: 'Task',          description: 'Imagery matches actual race demand (pace, terrain, weather)' },
      { letter: 'T', element: 'Timing',        description: 'Real-time, not slow-motion. Hard miles in real elapsed time.' },
      { letter: 'L', element: 'Learning',      description: 'Update with each session and race experience' },
      { letter: 'E', element: 'Emotion',       description: 'Include nerves, doubt, joy — full emotional palette' },
      { letter: 'P', element: 'Perspective',   description: 'First-person ("I see the finish") not third-person' },
    ],
    protocol: '5-10 min daily for 2 weeks pre-race. Rehearse start, body of race, finish; specifically the hard miles (marathon 18-23, half 9-12, 10K 4-5, 5K mile 2). Rehearse correct response to setbacks: GI distress, missed gel, off-pace early miles, weather change.',
  },
  citations: [
    cite('§Mental Rehearsal and Visualization', 'PETTLEP framework + race-specific protocol', 'research', '20'),
  ],
};

// ── Self-talk ─────────────────────────────────────────────────────

export const SELF_TALK_RESEARCH: Cited<{
  hatzigeorgiadisFinding: string;
  secondPersonRule: string;
  motivationalVsInstructional: { motivational: string; instructional: string; whenToUseEach: string };
}> = {
  value: {
    hatzigeorgiadisFinding: 'Hatzigeorgiadis 2011 meta-analysis: self-talk improved task performance with moderate effect size (d=0.48); larger for novel tasks and explicit instructional cues.',
    secondPersonRule: 'Second-person ("you\'ve got this") outperforms first-person ("I\'ve got this") in research. Distance from self enables more objective coaching.',
    motivationalVsInstructional: {
      motivational: 'Energy + confidence: "stay strong," "trust the work"',
      instructional: 'Technique + execution: "drive the elbow," "tall posture"',
      whenToUseEach: 'Motivational for sustained effort and confidence; instructional during technical demands or fatigue-driven form breakdown',
    },
  },
  citations: [
    cite('§Self-Talk', 'Hatzigeorgiadis 2011 meta-analysis. Second-person beats first-person. Motivational vs instructional split.', 'research', '20'),
  ],
};

export const RACE_SELF_TALK_PHRASES: Cited<Array<{
  phase: string;
  selfTalk: string;
}>> = {
  value: [
    { phase: 'Start',                            selfTalk: '"You\'re prepared. Stick to the plan."' },
    { phase: 'Body of race',                     selfTalk: '"Smooth and strong."' },
    { phase: 'First sign of fatigue',            selfTalk: '"This is normal. Keep moving."' },
    { phase: 'Mid-race doubt',                   selfTalk: '"One mile at a time."' },
    { phase: 'Wall / dark patch',                selfTalk: '"You\'ve trained for this. Drive the elbows."' },
    { phase: 'Final 2K',                         selfTalk: '"Empty the tank."' },
  ],
  citations: [
    cite('§Self-Talk', '6-phrase race library by phase, second-person', 'research', '20'),
  ],
};

// ── Anxiety + arousal management ──────────────────────────────────

export const ANXIETY_ARROUSAL_REGULATION: Cited<{
  invertedU: string;
  reframing: string;
  boxBreathing: { protocol: string; useCase: string };
  preRaceRoutine: string[];
}> = {
  value: {
    invertedU: 'Inverted-U (Yerkes-Dodson 1908): performance peaks at moderate arousal. Too low = sluggish; too high = panicky, tight, over-pacing. Race-specific calibration.',
    reframing: '"I\'m excited" beats "I\'m nervous" — same physiological state, different cognitive label. Brooks 2014 found reappraisal as excitement improved performance vs suppression.',
    boxBreathing: {
      protocol: '4 sec inhale, 4 sec hold, 4 sec exhale, 4 sec hold. Repeat 4-6 cycles.',
      useCase: '2-3 min pre-gun for over-aroused runners. Activates parasympathetic, drops HR ~5-10 bpm.',
    },
    preRaceRoutine: [
      'Same warmup, shoes, playlist as long runs (familiarity reduces arousal)',
      'Familiar pre-race meal and timing',
      'Box breathing 2-3 min pre-gun',
      'Brief visualization (15-30 sec) of strong start',
      'Trigger-word self-talk: "smooth," "ready," "trust the work"',
    ],
  },
  citations: [
    cite('§Race-Day Arousal Management + Pre-Race Anxiety Management', 'Inverted-U, reframing, box breathing, pre-race routine', 'research', '20'),
  ],
};

// ── Attention strategies ──────────────────────────────────────────

export const ATTENTION_STRATEGIES: Cited<{
  associativeVsDissociative: { associative: string; dissociative: string; researchFinding: string };
  byRaceStage: Array<{ stage: string; recommended: 'associative' | 'dissociative' | 'mixed'; cue: string }>;
}> = {
  value: {
    associativeVsDissociative: {
      associative: 'Internal focus on body signals: breathing, form, pace, HR. Maintains pacing precision.',
      dissociative: 'External or distracting focus: scenery, music, conversation, mental escape. Reduces perceived effort.',
      researchFinding: 'Elite endurance athletes use associative strategies in competition (Morgan 1978). Dissociative strategies are useful in training and during the easy stages of long races; associative becomes essential in the final 25-30%.',
    },
    byRaceStage: [
      { stage: 'Start (0-10%)',                recommended: 'associative',  cue: 'Pace check, breathing rhythm, restraint' },
      { stage: 'Body of race (10-75%)',        recommended: 'mixed',         cue: 'Switch every 5-10 min between scenery/internal' },
      { stage: 'Final 25%',                     recommended: 'associative',  cue: 'Form cues, breathing pattern, "drive the elbow"' },
      { stage: 'Wall / dark patch',             recommended: 'dissociative', cue: 'Tether to runner ahead, count steps, song lyrics' },
    ],
  },
  citations: [
    cite('§During-Race Attention Strategies', 'Associative vs dissociative strategies; stage-specific recommendations', 'research', '20'),
  ],
};

// ── Pain tolerance ────────────────────────────────────────────────

export const PAIN_TOLERANCE_FRAMEWORK: Cited<{
  acceptanceVsAvoidance: string;
  reappraisal: string;
  trainingTransfer: string;
  acceptanceBuildingProtocol: string[];
}> = {
  value: {
    acceptanceVsAvoidance: 'Acceptance ("this is hard, and I can keep going") vs avoidance ("this is too hard, I should slow down"). Acceptance increases tolerance; avoidance reduces it (Mahoney & Hanrahan 2011).',
    reappraisal: 'Re-label sensations: "burning legs" → "muscles working hard"; "can\'t breathe" → "deep effort breathing." Reduces emotional weight without denying physical reality.',
    trainingTransfer: 'Pain tolerance trained in workouts transfers to racing. Tempo runs and threshold sessions are pain-tolerance practice as much as physiological training. Sit with discomfort; don\'t bail early.',
    acceptanceBuildingProtocol: [
      'Hard intervals: stay with the rep through the discomfort, not around it',
      'After the workout, name what was hard — desensitization through articulation',
      'Mental rehearsal of late-race fatigue weekly during build',
      'Avoid catastrophizing internal narratives ("this is killing me")',
    ],
  },
  citations: [
    cite('§Pain Tolerance and Embracing Discomfort', 'Acceptance vs avoidance; reappraisal; training transfer', 'research', '20'),
  ],
};

// ── Post-race blues + DNF ─────────────────────────────────────────

export const POST_RACE_BLUES: Cited<{
  whatItIs: string;
  prevalence: string;
  durationDaysLow: number;
  durationDaysHigh: number;
  protectiveFactors: string[];
  whenToReferToTherapy: string[];
}> = {
  value: {
    whatItIs: 'Mood drop after a goal race regardless of outcome. Driven by neurochemical shift (dopamine/endorphin reset post-buildup) + identity vacuum (training structure removed).',
    prevalence: 'Common — most marathoners report some post-race mood drop within 1-7 days of an A race.',
    durationDaysLow: 1, durationDaysHigh: 14,
    protectiveFactors: [
      'Plan a non-running activity 2-7 days post-race (travel, social event, project)',
      'Post-race goals (next race, base block, off-season XT focus)',
      'Reverse-taper structure (gives a return-to-running plan, not a void)',
      'Avoid training-volume cliff (drop too suddenly = mood crash)',
      'Acknowledge the let-down as expected, not a sign something is wrong',
    ],
    whenToReferToTherapy: [
      'Mood drop persists >2 weeks',
      'Suicidal ideation — emergency referral, not coaching',
      'Loss of pleasure in non-running activities (anhedonia)',
      'Sleep disturbance >2 weeks',
      'Significant appetite or weight change',
    ],
  },
  citations: [
    cite('§Post-Race Blues and Depression', 'Definition, prevalence, duration, protective factors, therapy referral criteria', 'research', '20'),
  ],
};

export const DNF_DECISION_RULES: Cited<{
  legitimateReasons: string[];
  illegitimateReasons: string[];
  decisionFramework: string;
}> = {
  value: {
    legitimateReasons: [
      'Acute injury with structural risk (audible pop, sudden severe pain, loss of function)',
      'Suspected medical event (chest pain, fainting, heat illness, severe GI distress with symptoms beyond exhaustion)',
      'Hyponatremia or severe dehydration symptoms',
      'Race-day course conditions deemed unsafe (lightning, flooding, extreme heat exceeding bail thresholds)',
    ],
    illegitimateReasons: [
      '"This is hard" — racing IS hard',
      'Off-pace by 2-5% — adjust the goal, not the day',
      'Mid-race blow-up — walk through aid, fuel, restart at adjusted pace',
      'Mental fatigue without physical limit — segment the rest of the race',
    ],
    decisionFramework: 'If continuing risks lasting injury or medical event, DNF. If continuing only feels bad, finish — even at adjusted pace. The line: structural damage vs discomfort.',
  },
  citations: [
    cite('§DNF Decisions', 'Legitimate vs illegitimate DNF reasons; structural damage vs discomfort line', 'research', '20'),
  ],
};

// ── Burnout (Smith model) ─────────────────────────────────────────

export const BURNOUT_WARNING_SIGNS: Cited<{
  smithModelStages: Array<{ stage: number; name: string; description: string }>;
  earlyWarningSigns: string[];
  intervention: string[];
}> = {
  value: {
    smithModelStages: [
      { stage: 1, name: 'Situational demands',                  description: 'Training load, life stress, identity-based pressure' },
      { stage: 2, name: 'Cognitive appraisal',                  description: 'Athlete perceives demands as exceeding resources' },
      { stage: 3, name: 'Physiological responses',               description: 'Tension, fatigue, irritability, sleep disruption' },
      { stage: 4, name: 'Behavioral consequences',                description: 'Decreased performance, withdrawal, ultimately quitting' },
    ],
    earlyWarningSigns: [
      'Loss of enthusiasm for runs that previously felt joyful',
      'Dreading workouts that were previously routine',
      'Persistent low-grade fatigue not resolved by rest weeks',
      'Increased irritability with running-related discussions',
      'Cynicism about training ("what\'s the point")',
      'Performance plateau or decline despite consistent effort',
    ],
    intervention: [
      'Insert a 2-4 week unstructured break (run for fun or not at all)',
      'Reduce training volume 30-50% for a recovery block',
      'Introduce cross-training to break the running monotony',
      'Re-anchor on intrinsic motivation (why started running) vs extrinsic (PRs, BQ, social comparison)',
      'Refer to sport psychologist if symptoms persist >4 weeks',
    ],
  },
  citations: [
    cite('§Burnout Prevention (Smith Cognitive-Affective Model)', 'Smith 4-stage model + early warning signs + intervention', 'research', '20'),
  ],
};

// ── Mantras and breathing ─────────────────────────────────────────

export const MANTRAS_AND_CUES: Cited<{
  effectiveMantraTraits: string[];
  examples: Array<{ purpose: string; mantra: string }>;
  cueWordRule: string;
}> = {
  value: {
    effectiveMantraTraits: [
      'Short (≤5 words)',
      'Rhythmic — matches cadence',
      'Personal — resonates with the runner',
      'Process-focused, not outcome-focused',
      'Tested in training before race day',
    ],
    examples: [
      { purpose: 'Effort regulation',     mantra: '"Smooth and strong"' },
      { purpose: 'Hard moments',          mantra: '"Stay in this mile"' },
      { purpose: 'Closing surge',         mantra: '"Empty the tank"' },
      { purpose: 'Self-belief',           mantra: '"You\'ve done the work"' },
      { purpose: 'Form reset',            mantra: '"Tall and proud"' },
      { purpose: 'Pain acceptance',       mantra: '"This is the work"' },
    ],
    cueWordRule: 'Cycle through 2-3 cues every 30-60 sec in the final 10-20% of the race. Reset focus and re-organize neuromuscular patterns.',
  },
  citations: [
    cite('§Mantras and Cue Words', '5 effective traits + 6 examples + cue cycling rule', 'research', '20'),
  ],
};

export const BREATHING_TECHNIQUES: Cited<Array<{
  technique: string;
  protocol: string;
  useCase: string;
}>> = {
  value: [
    { technique: 'Box breathing',                 protocol: '4-4-4-4 (inhale-hold-exhale-hold)',                   useCase: 'Pre-race calming, 2-3 min pre-gun' },
    { technique: 'Rhythmic running breathing',    protocol: '3-2 (3 footfalls inhale, 2 exhale) easy; 2-1 hard',    useCase: 'Establishes pace + reduces side-stitch risk' },
    { technique: 'Diaphragmatic ("belly") breathing', protocol: 'Inhale to expand belly first, then chest. Slow, deep.', useCase: 'Recovery between intervals, race-week sleep' },
    { technique: '4-7-8 breathing',               protocol: '4 sec inhale, 7 sec hold, 8 sec exhale',                useCase: 'Sleep onset; severe pre-race anxiety' },
  ],
  citations: [
    cite('§Breathing Techniques for Arousal Regulation', 'Box, rhythmic, diaphragmatic, 4-7-8 protocols', 'research', '20'),
  ],
};

// ── Therapy referral ──────────────────────────────────────────────

export const THERAPY_REFERRAL_CRITERIA: Cited<string[]> = {
  value: [
    'Persistent low mood >2 weeks unrelated to a recent race',
    'Disordered eating signs (restricting, purging, obsessive food rules, secrecy around food)',
    'Body image distress that interferes with daily life',
    'Anxiety that prevents race-day performance despite preparation',
    'Burnout symptoms that persist after a 4-week unstructured break',
    'Loss of identity or purpose tied to inability to run (injury, life change)',
    'Substance use that affects training or daily functioning',
    'Suicidal ideation — emergency referral, not coaching',
  ],
  note: 'Coaches are not therapists. The job is to recognize warning signs and refer. A sport-psychologist consult is normal preventive maintenance for serious athletes, not a sign of failure.',
  citations: [
    cite('§Therapy and Referral', '8 referral criteria + coaches-not-therapists rule', 'research', '20'),
  ],
};
