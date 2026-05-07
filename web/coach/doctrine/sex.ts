/**
 * Doctrine — Sex-specific training, physiology, and screening.
 *
 * Source: Research/13-sex-specific-training.md
 *
 * Engine consumers (UI prompts on intake; coaching adjustments):
 *   - profile / settings UI    → MENSTRUAL_CYCLE_GUIDANCE
 *                                + RED_S_SCREENING_QUESTIONS
 *   - coach.briefRaceMorning    → cycle-aware adjustments (when known)
 *   - coach.adjustForReality    → IRON_DEFICIENCY_RED_FLAGS */
import { cite, type Cited } from '.';

// ── Menstrual cycle ───────────────────────────────────────────────

export const MENSTRUAL_CYCLE_GUIDANCE: Cited<{
  phases: Array<{ phase: string; daysApprox: string; physiology: string; trainingNote: string }>;
  cycleBasedPeriodizationEvidence: string;
  trackingRecommendation: string;
  symptomManagement: string[];
}> = {
  value: {
    phases: [
      { phase: 'Early follicular (menses)',          daysApprox: '1-5',     physiology: 'Estrogen + progesterone low. Iron loss, possible cramping/fatigue.',         trainingNote: 'Most women train normally. Iron monitoring matters more than workout adjustment.' },
      { phase: 'Late follicular',                     daysApprox: '6-13',    physiology: 'Estrogen rising; testosterone peak around ovulation. Highest perceived strength.', trainingNote: 'Window where many women feel best. Train normally.' },
      { phase: 'Ovulation',                            daysApprox: '~14',     physiology: 'LH surge; some women experience injury vulnerability spike (laxity).',           trainingNote: 'No strong evidence for adjustment; some elite programs reduce eccentric load.' },
      { phase: 'Early luteal',                         daysApprox: '15-22',   physiology: 'Progesterone rising; core temp elevated 0.3-0.5°C; HR rises ~5 bpm submax.',     trainingNote: 'Heat tolerance reduced. RPE rises at fixed pace. Adjust by HR/RPE in heat.' },
      { phase: 'Late luteal (PMS)',                    daysApprox: '23-28',   physiology: 'Progesterone peak then drop; mood/sleep disruption common; appetite shifts.',     trainingNote: 'Sleep + carb intake matter more. Variable individual response — track personally.' },
    ],
    cycleBasedPeriodizationEvidence: 'Cycle-based periodization research is in equipoise. Some studies (McNulty 2020 review) find tiny effect sizes; others find phase-specific differences. Honest current state: track your own pattern; adjust based on your data, not population averages.',
    trackingRecommendation: 'Log cycle day + subjective effort + sleep + workout outcomes for 3 cycles before drawing conclusions about personal pattern.',
    symptomManagement: [
      'Iron-rich foods + ferritin labs annually if heavy menses or symptoms',
      'Magnesium + B6 may reduce PMS severity (mixed evidence)',
      'Sleep priority during late luteal',
      'Heat awareness during luteal phase (training in cool early hours)',
      'Avoid major race scheduling during PMS / menses if symptoms historically severe',
    ],
  },
  citations: [
    cite('§1 The Menstrual Cycle and Training', 'Phase-by-phase physiology + training notes; cycle-based periodization equipoise', 'research', '13'),
  ],
};

// ── Hormonal contraception ────────────────────────────────────────

export const HORMONAL_CONTRACEPTION_NOTES: Cited<{
  oralContraceptive: { effect: string; performanceEvidence: string };
  iud: string;
  dmpa: string;
  generalRule: string;
}> = {
  value: {
    oralContraceptive: {
      effect: 'Suppresses natural cycle; provides synthetic estrogen + progestin levels. May raise core temp slightly; mild reduction in VO2max in some studies (~2%).',
      performanceEvidence: 'Mixed; small effect sizes. Modern combined OCP probably has minimal performance impact for most users.',
    },
    iud: 'Hormonal IUD (Mirena) provides local progestin; minimal systemic effect on training.',
    dmpa: 'Depo-Provera (DMPA) — reduces bone density meaningfully. Caution in distance runners (already at BSI risk). Consider alternatives if BSI history.',
    generalRule: 'Choice of contraception is a clinical decision, not a coaching one. Coach acknowledges contraception status when setting expectations + monitoring iron/bone health.',
  },
  citations: [
    cite('§2 Hormonal Contraception and Performance', 'OCP / IUD / DMPA effects on training and bone density', 'research', '13'),
  ],
};

// ── Pregnancy + postpartum ────────────────────────────────────────

export const PREGNANCY_RUNNING: Cited<{
  generalRule: string;
  trimesterGuidance: Array<{ trimester: 1 | 2 | 3; description: string; modifications: string[] }>;
  contraindications: string[];
  postpartumReturnGuidelines: string[];
}> = {
  value: {
    generalRule: 'Healthy pregnancies tolerate continued running. ACOG guidelines (2020) support 150+ min/week moderate exercise. Pre-pregnancy runners can usually continue at reduced intensity through pregnancy.',
    trimesterGuidance: [
      { trimester: 1, description: 'Often hardest due to fatigue/nausea',                modifications: ['Reduce intensity if needed', 'Prioritize hydration', 'Iron + folate adequate'] },
      { trimester: 2, description: 'Often best — energy returns, bump not yet limiting', modifications: ['Most women run normally', 'Avoid overheating', 'Watch for round-ligament pain'] },
      { trimester: 3, description: 'Volume + intensity drop naturally',                   modifications: ['Switch to walk/run or cross-train', 'Stop if pelvic/abdominal pain', 'Avoid supine positioning post-20 wk'] },
    ],
    contraindications: [
      'Placenta previa after 26 weeks',
      'Persistent bleeding',
      'Pre-eclampsia',
      'Cervical insufficiency',
      'Ruptured membranes',
      'Pre-term labor in current pregnancy',
      'Uncontrolled medical conditions',
    ],
    postpartumReturnGuidelines: [
      '6-week postpartum check before any running (vaginal delivery); 8-12 wk for C-section',
      'Pelvic floor PT screen recommended before return',
      'Begin walk-run, monitor for prolapse, urinary incontinence, diastasis recti',
      'Full return to pre-pregnancy training typically 4-6 months',
      'Lactation: ensure hydration + caloric intake (500-700 kcal additional)',
      'Iron stores may be low postpartum; recheck ferritin',
    ],
  },
  citations: [
    cite('§3 Pregnancy and Running + §4 Postpartum Return', 'ACOG-aligned guidance, trimester modifications, contraindications, postpartum return', 'research', '13'),
  ],
};

// ── RED-S ─────────────────────────────────────────────────────────

export const RED_S_SCREENING: Cited<{
  definition: string;
  warningSignsFemale: string[];
  warningSignsMale: string[];
  consequences: string[];
  referralCriteria: string[];
}> = {
  value: {
    definition: 'Relative Energy Deficiency in Sport (Mountjoy 2014, IOC consensus). Insufficient energy availability to support normal physiologic function. Affects all sexes, not only women.',
    warningSignsFemale: [
      'Menstrual dysfunction (amenorrhea ≥3 months, irregular cycles)',
      'Stress fractures (especially recurrent)',
      'Decreased performance despite training',
      'Persistent fatigue / impaired recovery',
      'Cold intolerance',
      'GI symptoms',
      'Mood changes / depression',
      'Disordered eating / preoccupation with body weight',
      'Frequent illness (immune suppression)',
    ],
    warningSignsMale: [
      'Reduced libido',
      'Stress fractures',
      'Decreased testosterone (low energy, fatigue, mood, body composition)',
      'Persistent fatigue',
      'Decreased performance',
      'Disordered eating signs',
    ],
    consequences: [
      'Bone health: stress injuries, low BMD, premature osteoporosis',
      'Reproductive: amenorrhea, suppressed testosterone, infertility',
      'Cardiovascular: bradycardia (in extreme cases), arrhythmia risk',
      'Metabolic: thyroid suppression, low resting metabolic rate, glucose dysregulation',
      'Immune: frequent URTI',
      'Performance: reduced strength, endurance, training response',
      'Psychological: depression, anxiety, eating disorder progression',
    ],
    referralCriteria: [
      'Sport-medicine physician + sports dietitian + sport psychologist (multidisciplinary)',
      'Amenorrhea ≥3 months in cycling-age female',
      'Recurrent stress fractures',
      'Disordered eating signs (restricting, purging, obsessive food rules)',
      'BSI in non-weight-bearing bone (rib, sacrum)',
      'Multiple warning signs persisting >4 weeks',
    ],
  },
  citations: [
    cite('§6 RED-S', 'Mountjoy 2014 IOC consensus. Female + male signs, consequences, multidisciplinary referral.', 'research', '13'),
  ],
};

// ── Iron deficiency ───────────────────────────────────────────────

export const IRON_DEFICIENCY: Cited<{
  prevalence: string;
  ferritinThresholds: { sufficientNgPerMl: number; lowNgPerMl: number; deficientNgPerMl: number };
  sportsPhysicianTargetForRunners: string;
  warningSigns: string[];
  causes: string[];
  intervention: string[];
}> = {
  value: {
    prevalence: 'Up to 50% of female endurance runners have low ferritin. Higher prevalence in adolescents + heavy menstrual losers.',
    ferritinThresholds: { sufficientNgPerMl: 35, lowNgPerMl: 20, deficientNgPerMl: 12 },
    sportsPhysicianTargetForRunners: 'Sports physicians often target ferritin ≥30-50 ng/mL for endurance athletes (above general-population threshold) due to performance impact at low-normal levels.',
    warningSigns: [
      'Persistent fatigue not resolved by rest',
      'Dyspnea on exertion at usual paces',
      'Performance decline despite training',
      'Pale conjunctiva',
      'Cold extremities',
      'Pica (cravings for ice, dirt, paper)',
      'Restless legs / poor sleep',
    ],
    causes: [
      'Heavy menstrual losses',
      'GI losses (foot-strike hemolysis, bleeding ulcers)',
      'Inadequate dietary iron',
      'Vegetarian/vegan without supplementation',
      'Foot-strike hemolysis (long-distance runners)',
      'Inflammation (chronic training stress reduces absorption)',
    ],
    intervention: [
      'Annual ferritin labs for female runners (especially adolescent + masters)',
      'Iron-rich foods: red meat 2-3×/wk, lentils, fortified cereals',
      'Vitamin C with iron-containing meals improves absorption',
      'Avoid coffee/tea/calcium within 1h of iron-rich meals (reduces absorption)',
      'Ferrous sulfate 65-100 mg daily ferrous-iron under MD supervision if low',
      'Recheck ferritin at 8-12 weeks of supplementation',
      'IV iron only under MD direction for severe deficiency',
    ],
  },
  citations: [
    cite('§8 Iron Deficiency in Female Runners', 'Prevalence, thresholds, sports-physician target, warning signs, intervention', 'research', '13'),
  ],
};

// ── Bone density ──────────────────────────────────────────────────

export const BONE_DENSITY_CONSIDERATIONS: Cited<{
  riskFactors: string[];
  protectiveFactors: string[];
  screeningThreshold: string;
  protocol: string[];
}> = {
  value: {
    riskFactors: [
      'Amenorrhea / oligomenorrhea',
      'Eating disorder history',
      'Low body fat % (<12% female, <5% male)',
      'Family history of osteoporosis',
      'Chronic glucocorticoid use',
      'BSI history (especially trabecular bone — femoral neck, sacrum)',
      'DMPA (Depo-Provera) contraceptive use',
      'Adolescent training without adequate energy',
      'Smoking, excess alcohol',
    ],
    protectiveFactors: [
      'Adequate energy availability (≥45 kcal/kg FFM/day)',
      'Strength training (impact + resistance)',
      'Adequate calcium (1000-1300 mg/day) + vitamin D (1000-2000 IU/day)',
      'Multidirectional impact loading (jumping, bounding)',
      'Adequate protein (1.4-2.0 g/kg/day)',
      'Hormone replacement when indicated (estrogen primarily)',
    ],
    screeningThreshold: 'DEXA scan recommended for: stress fracture history, amenorrhea ≥3 months, eating disorder history, age 65+ female / 70+ male, fracture from minimal trauma.',
    protocol: [
      '20-30 min strength training 2-3×/week including jumping/plyometric work',
      'Calcium 1000-1300 mg/day (food first; supplement to fill gap)',
      'Vitamin D 1000-2000 IU/day; check serum 25-OH-D annually',
      'Protein 1.4-2.0 g/kg/day distributed across meals',
      'Energy availability ≥45 kcal/kg FFM/day for bone health',
      'Monitor menstrual cycle (premenopausal female) — amenorrhea = risk',
    ],
  },
  citations: [
    cite('§9 Bone Density Considerations', 'Risk + protective factors, DEXA criteria, protective protocol', 'research', '13'),
  ],
};
