/**
 * Doctrine — Injury return-to-run protocols.
 *
 * Source: Research/05-injury-return-protocols.md
 *
 * Generic, evidence-backed protocols a coach can suggest. Coach must
 * default to medical referral when red flags appear. Each catalog
 * entry has a §pointer back to Research/05 for the full per-injury
 * detail (causes, exercises, surface adjustments, etc).
 *
 * Engine consumers (when injury intake is built):
 *   - coach.adjustForReality (Stage A)  → consult INJURY_CATALOG when
 *                                         user logs an injury
 *   - coach.prescribeWorkout (Stage 3)  → suppress quality, suggest
 *                                         cross-train when injury flag
 *                                         is active
 *   - /coach/today UI                    → red-flag prompts, MD referral */
import { cite, type Cited } from './cite';

// ── General principles ────────────────────────────────────────────

/** 8-stage walk-run protocol — universal RTR scaffold for any injury
 *  requiring layoff >2 weeks. */
export const WALK_RUN_PROTOCOL: Cited<Array<{
  stage: number;
  runMin: number;
  walkMin: number | null;
  repeats: number | null;
  totalRunMin: number;
  sessionsPerWeekLow: number;
  sessionsPerWeekHigh: number;
}>> = {
  value: [
    { stage: 1, runMin: 1,                walkMin: 4,    repeats: 5,    totalRunMin: 5,  sessionsPerWeekLow: 3, sessionsPerWeekHigh: 3 },
    { stage: 2, runMin: 2,                walkMin: 3,    repeats: 5,    totalRunMin: 10, sessionsPerWeekLow: 3, sessionsPerWeekHigh: 3 },
    { stage: 3, runMin: 3,                walkMin: 2,    repeats: 5,    totalRunMin: 15, sessionsPerWeekLow: 3, sessionsPerWeekHigh: 3 },
    { stage: 4, runMin: 4,                walkMin: 2,    repeats: 4,    totalRunMin: 16, sessionsPerWeekLow: 3, sessionsPerWeekHigh: 4 },
    { stage: 5, runMin: 5,                walkMin: 1,    repeats: 4,    totalRunMin: 20, sessionsPerWeekLow: 3, sessionsPerWeekHigh: 4 },
    { stage: 6, runMin: 8,                walkMin: 2,    repeats: 3,    totalRunMin: 24, sessionsPerWeekLow: 3, sessionsPerWeekHigh: 4 },
    { stage: 7, runMin: 12,               walkMin: 2,    repeats: 2,    totalRunMin: 24, sessionsPerWeekLow: 3, sessionsPerWeekHigh: 4 },
    { stage: 8, runMin: 28 /* 25-30 */,   walkMin: null, repeats: null, totalRunMin: 28, sessionsPerWeekLow: 4, sessionsPerWeekHigh: 4 },
  ],
  note: 'Spend ≥2 sessions at each stage before progressing. If pain or swelling rises, drop back one stage and re-attempt after 48-72h. Surface flat/firm/predictable for stages 1-5; soft/rolling only after stage 6. Pace easy/conversational only — no tempo, intervals, or hills until full continuous-running base is restored.',
  citations: [
    cite('§1.1 The Walk-Run Protocol Structure', '8-stage progression: stage 1 (1/4 × 5) to stage 8 (25-30 min continuous). Run-walk ratio shifts toward more running over time.', 'research', '05'),
  ],
};

/** Three-rule pain monitoring system (modified Silbernagel 2007). */
export const PAIN_MONITORING_RULES: Cited<{
  inSessionRule: { greenLow: number; greenHigh: number; amberLow: number; amberHigh: number; redMin: number };
  twentyFourHourRule: string;
  locationRule: string;
  bsiException: string;
}> = {
  value: {
    inSessionRule: {
      greenLow: 0, greenHigh: 2,
      amberLow: 3, amberHigh: 5,
      redMin: 6,
    },
    twentyFourHourRule: 'Same or better than baseline within 24h: tolerated. Worse but resolves by 48h: hold load, repeat stage. Still worse at 48h: drop a stage.',
    locationRule: 'Pain must be at original injury site only. New pain elsewhere (especially compensatory) means form is breaking down — reduce volume or stop.',
    bsiException: 'For bone stress injury, the 24h rule is stricter: any pain during running on a healing bone is a red light.',
  },
  note: 'Day-of-session pain ≤3/10 is the broadest evidence-based threshold (Silbernagel pain-monitoring model). 24h rule applies primarily to tendinopathy and overuse soft-tissue injury.',
  citations: [
    cite('§1.2 Pain Monitoring Rules', 'Three-rule system: 0-10 in-session NRS, 24-hour rule, location rule', 'research', '05'),
  ],
};

/** Cross-training vs complete rest decision. */
export const CROSS_TRAIN_VS_REST: Cited<Array<{
  scenario: string;
  recommendation: string;
}>> = {
  value: [
    { scenario: 'Acute injury, first 24-72h',           recommendation: 'Relative rest. Avoid aggravating motion. Walking OK if pain-free.' },
    { scenario: 'Soft-tissue injury beyond 72h',        recommendation: 'Cross-train at intensities that don\'t reproduce symptoms.' },
    { scenario: 'Tendinopathy (any stage)',             recommendation: 'Complete rest is contraindicated — tendons require load to remodel.' },
    { scenario: 'Low-risk BSI',                         recommendation: 'Non-impact only (pool, cycle, elliptical) until pain-free walking ≥7 days.' },
    { scenario: 'High-risk BSI',                        recommendation: 'Non-weight-bearing only until clinician clears.' },
    { scenario: 'Post-surgical',                        recommendation: 'Follow surgeon\'s protocol.' },
  ],
  note: 'Pool running (deep-water with flotation belt) preserves VO2max and running-specific neuromuscular patterns; trained runners can maintain aerobic fitness for 4-6 weeks. Elliptical and cycling preserve VO2max but are less running-specific.',
  citations: [
    cite('§1.3 Cross-Training vs. Complete Rest', '6 scenarios + recommendations + pool-running fitness preservation', 'research', '05'),
  ],
};

/** Volume + intensity rebuild rules after clearing walk-run. */
export const REBUILD_PROGRESSION: Cited<{
  weeklyMileageIncreasePctMax: number;
  downWeekFrequencyEveryNWeeks: { low: number; high: number };
  downWeekReductionPct: { low: number; high: number };
  longRunPctOfWeeklyMax: number;
  weeksOffToWeeksToRebuildHeuristic: '1:1';
  intensitySequence: string[];
  tendinopathyBsiContinuousEasyMinWeeks: number;
  tendinopathyBsiThresholdMinWeeks: number;
}> = {
  value: {
    weeklyMileageIncreasePctMax: 10,
    downWeekFrequencyEveryNWeeks: { low: 3, high: 4 },
    downWeekReductionPct: { low: 20, high: 30 },
    longRunPctOfWeeklyMax: 30,
    weeksOffToWeeksToRebuildHeuristic: '1:1',
    intensitySequence: [
      '1. Continuous easy running re-established (≥3 weeks at pre-injury easy volume)',
      '2. Strides (4-6 × 15-20 sec controlled fast, full recovery)',
      '3. Tempo / threshold (begin 2 × 8 min)',
      '4. VO2max intervals',
      '5. Hills and sprints (last — peak impact load)',
    ],
    tendinopathyBsiContinuousEasyMinWeeks: 4,
    tendinopathyBsiThresholdMinWeeks: 6,
  },
  note: 'Volume before intensity, always. Each phase ≥1-2 weeks before adding the next. Tendinopathy and BSI need 4+ weeks of continuous easy before strides; 6+ weeks before threshold.',
  citations: [
    cite('§1.4 Return-to-Volume Guidelines', '10% rule, down weeks every 3-4 wks (-20-30%), long run ≤30% weekly, weeks-off ≈ weeks-to-rebuild', 'research', '05'),
    cite('§1.5 Return-to-Intensity Guidelines', '5-step sequence: continuous easy → strides → tempo → VO2 → hills/sprints', 'research', '05'),
  ],
};

// ── Red flags ─────────────────────────────────────────────────────

/** Universal red flags requiring medical evaluation. */
export const UNIVERSAL_RED_FLAGS: Cited<{
  general: string[];
  redsTriad: string[];
  jointSpecific: { knee: string[]; hip: string[]; ankleFoot: string[]; calf: string[] };
  emergencySpinal: string[];
}> = {
  value: {
    general: [
      'Focal, point-tender bone pain worsening with weight-bearing, hopping, or single-leg jump (suspect BSI)',
      'Night pain or rest pain',
      'Visible swelling, deformity, bruising, or palpable muscle/tendon defect',
      'Sudden audible "pop" with inability to continue (suspect rupture)',
      'Strength or ROM deficit >50% vs uninjured side',
      'Numbness, paraesthesia, or weakness in a dermatomal/myotomal pattern',
      'Symptoms persisting ≥6 weeks despite appropriate load management',
      'Symptoms worsening rather than improving',
    ],
    redsTriad: [
      'Amenorrhea or menstrual irregularity in female runners',
      'Recurrent stress fractures (>1)',
      'Disordered eating signs, unintended weight loss, low BMI',
      'BSI in non-weight-bearing bone (rib, sacrum, pelvis) — suggests low energy availability',
    ],
    jointSpecific: {
      knee:       ['Locking', 'Giving way', 'True effusion'],
      hip:        ['C-sign', 'Restricted internal rotation in flexion (intra-articular pathology)'],
      ankleFoot:  ['Inability to weight-bear immediately after acute injury (Ottawa rules)'],
      calf:       ['Unilateral swelling, warmth, calf tenderness — rule out DVT'],
    },
    emergencySpinal: [
      'Bilateral leg weakness or numbness',
      'Saddle anaesthesia',
      'New bowel/bladder dysfunction',
    ],
  },
  note: 'Spinal red flags are an emergency — refer to ED, not clinic.',
  citations: [
    cite('§1.6 Red Flags Requiring Medical Evaluation', 'Universal + REDs/triad + joint-specific + cauda equina/spinal emergency', 'research', '05'),
  ],
};

// ── Injury catalog ────────────────────────────────────────────────

export type InjuryId =
  | 'plantar_fasciitis'
  | 'achilles_tendinopathy_mid'
  | 'achilles_tendinopathy_insertional'
  | 'itbs'
  | 'pfp_runners_knee'
  | 'patellar_tendinopathy'
  | 'mtss_shin_splints'
  | 'tibial_stress_reaction_or_fracture'
  | 'hamstring_strain_acute'
  | 'proximal_hamstring_tendinopathy'
  | 'calf_strain'
  | 'hip_flexor_strain'
  | 'piriformis_syndrome'
  | 'posterior_tibial_tendinopathy'
  | 'peroneal_tendinopathy'
  | 'metatarsalgia'
  | 'mortons_neuroma'
  | 'hip_labral_fai'
  | 'doms_acute_soreness';

export type InjuryCategory =
  | 'plantar' | 'tendinopathy' | 'patellofemoral' | 'iliotibial' | 'bone_stress'
  | 'muscle_strain' | 'hip_buttock' | 'forefoot_nerve' | 'hip_joint' | 'soreness';

export interface InjuryEntry {
  id: InjuryId;
  name: string;
  category: InjuryCategory;
  riskLevel: 'low' | 'moderate' | 'high';
  expectedRTRWeeksLow: number;
  expectedRTRWeeksHigh: number;
  /** Headline coaching protocol — the load-management directive. */
  coreProtocol: string;
  /** Critical red flags specific to this injury. */
  redFlags: string[];
  /** Cross-training recommendations during the layoff. */
  crossTrainOK: string[];
  contraindications: string[];
  researchSection: string;
}

/** Catalog of return-to-run protocols by injury. Each entry summary;
 *  full per-injury detail (pathophysiology, diagnostic features,
 *  exercise progressions, surface management) lives at researchSection. */
export const INJURY_CATALOG: Cited<InjuryEntry[]> = {
  value: [
    {
      id: 'plantar_fasciitis',
      name: 'Plantar Fasciitis / Plantar Fasciopathy',
      category: 'plantar',
      riskLevel: 'moderate',
      expectedRTRWeeksLow: 6, expectedRTRWeeksHigh: 12,
      coreProtocol: 'Rasmussen-Rathleff high-load strength: heel-raises with rolled towel under toes, slow tempo, progressive load 8-week protocol. Reduce running volume 30-50% during early weeks; maintain easy aerobic only.',
      redFlags: ['Numbness or burning radiating into foot (rule out tarsal tunnel)', 'Heel pain with localised swelling or warmth (suspect calcaneal stress reaction)', 'Bilateral atypical foot pain in young athlete'],
      crossTrainOK: ['Pool', 'Cycle (low resistance)', 'Elliptical with care'],
      contraindications: ['Barefoot running on hard surfaces', 'Sudden return to hill work'],
      researchSection: '§2',
    },
    {
      id: 'achilles_tendinopathy_mid',
      name: 'Achilles Tendinopathy — Mid-Portion',
      category: 'tendinopathy',
      riskLevel: 'moderate',
      expectedRTRWeeksLow: 6, expectedRTRWeeksHigh: 12,
      coreProtocol: 'Heavy slow resistance (HSR) eccentric calf raises 3 sets × 15 reps × 3-4 days/week, 12 weeks. Pain ≤3/10 in session. Continue running if 24h pain pattern is stable.',
      redFlags: ['Sudden "pop" with weakness on push-off (rupture)', 'Palpable defect in tendon', 'Marked swelling or warmth'],
      crossTrainOK: ['Pool', 'Cycle (avoid high-cadence at low resistance)'],
      contraindications: ['Sudden volume increase', 'Hill repeats during reactive phase', 'Steroid injection (research mixed; weakens tendon)'],
      researchSection: '§3',
    },
    {
      id: 'achilles_tendinopathy_insertional',
      name: 'Achilles Tendinopathy — Insertional',
      category: 'tendinopathy',
      riskLevel: 'moderate',
      expectedRTRWeeksLow: 8, expectedRTRWeeksHigh: 14,
      coreProtocol: 'Eccentric calf raises modified — DO NOT drop below floor level (avoid compressive load on insertion). Heel lift 6-12mm helpful early. Same pain rules.',
      redFlags: ['Bony enlargement at heel (Haglund deformity)', 'Severe local swelling', 'Loss of plantarflexion strength'],
      crossTrainOK: ['Pool', 'Cycle'],
      contraindications: ['Below-floor eccentric calf raises', 'Hill running (compresses insertion)'],
      researchSection: '§4',
    },
    {
      id: 'itbs',
      name: 'Iliotibial Band Syndrome (ITBS)',
      category: 'iliotibial',
      riskLevel: 'low',
      expectedRTRWeeksLow: 4, expectedRTRWeeksHigh: 8,
      coreProtocol: 'Hip-abductor strengthening (side-lying leg raises, monster walks, single-leg squats). Reduce running volume; avoid downhill and cambered surfaces. ITB foam-rolling has weak evidence — strength is the primary driver.',
      redFlags: ['True knee effusion', 'Mechanical locking', 'Pain at lateral tibial plateau persisting at rest'],
      crossTrainOK: ['Pool', 'Cycle (steep saddle position to avoid IT band tension)', 'Elliptical'],
      contraindications: ['Downhill running early', 'Cambered roads'],
      researchSection: '§5',
    },
    {
      id: 'pfp_runners_knee',
      name: 'Patellofemoral Pain Syndrome (Runner\'s Knee)',
      category: 'patellofemoral',
      riskLevel: 'low',
      expectedRTRWeeksLow: 4, expectedRTRWeeksHigh: 12,
      coreProtocol: 'Hip and quadriceps strengthening (gluteus medius primary, VMO secondary). Correct cadence (target ~170-180 spm) — overstriding loads patellofemoral joint. Reduce volume by 30-50% during reactive phase.',
      redFlags: ['Locking, catching, true effusion', 'Pain at rest or night pain', 'Giving way (suspect ligamentous instability)'],
      crossTrainOK: ['Pool', 'Cycle (high seat, low resistance)'],
      contraindications: ['Deep squats early', 'Stairs descending in pain', 'Downhill running'],
      researchSection: '§6',
    },
    {
      id: 'patellar_tendinopathy',
      name: 'Patellar Tendinopathy (Jumper\'s Knee)',
      category: 'tendinopathy',
      riskLevel: 'moderate',
      expectedRTRWeeksLow: 8, expectedRTRWeeksHigh: 16,
      coreProtocol: 'Heavy slow resistance — single-leg decline squats or leg-press eccentrics, 3 sets × 15 reps × 3 days/week. Isometric holds (45 s × 5) for in-season pain management. Tendon needs load to remodel — do not rest.',
      redFlags: ['Sudden inability to extend knee (suspect rupture)', 'Marked swelling', 'Quadriceps weakness >50%'],
      crossTrainOK: ['Cycle (low resistance)', 'Pool'],
      contraindications: ['Plyometric volume too early', 'Uphill sprints early'],
      researchSection: '§7',
    },
    {
      id: 'mtss_shin_splints',
      name: 'Medial Tibial Stress Syndrome (Shin Splints)',
      category: 'bone_stress',
      riskLevel: 'moderate',
      expectedRTRWeeksLow: 3, expectedRTRWeeksHigh: 8,
      coreProtocol: 'Reduce running volume 50-70%; substitute pool running. Calf and tibialis posterior strengthening. Surface review (avoid hard / cambered). Cadence increase if low. Resume gradually with walk-run protocol.',
      redFlags: ['Focal point-tender bone pain (suspect stress reaction → BSI)', 'Pain on hop test or single-leg jump', 'Pain worsening with weight-bearing'],
      crossTrainOK: ['Pool', 'Cycle', 'Elliptical (cautious)'],
      contraindications: ['Continued running through worsening focal pain', 'Hard-surface running early'],
      researchSection: '§8',
    },
    {
      id: 'tibial_stress_reaction_or_fracture',
      name: 'Tibial Stress Reaction / Stress Fracture',
      category: 'bone_stress',
      riskLevel: 'high',
      expectedRTRWeeksLow: 8, expectedRTRWeeksHigh: 24,
      coreProtocol: 'IMAGING (MRI for grade) before any return decision. Non-impact for ≥6 weeks (high-risk site) or until pain-free walking ≥7 days (low-risk). Then walk-run protocol stage 1 only after clinician clears.',
      redFlags: ['ANY focal bone pain on running', 'Pain on hop test', 'Night pain', 'High-risk sites (anterior tibia, femoral neck, navicular, sacrum) — refer immediately'],
      crossTrainOK: ['Pool only initially', 'Cycle once pain-free walking ≥7d'],
      contraindications: ['Running through focal bone pain — non-negotiable'],
      researchSection: '§9',
    },
    {
      id: 'hamstring_strain_acute',
      name: 'Hamstring Strain (Acute)',
      category: 'muscle_strain',
      riskLevel: 'moderate',
      expectedRTRWeeksLow: 2, expectedRTRWeeksHigh: 8,
      coreProtocol: 'POLICE early (Protect, Optimal Load, Ice, Compression, Elevation). Eccentric loading (Nordic hamstring) once pain-free isometrics. Re-test sprint progression criteria before track return. High re-injury risk.',
      redFlags: ['Palpable defect', 'Severe bruising', 'Inability to walk', 'Suspected complete tear (grade III)'],
      crossTrainOK: ['Pool (after acute phase)', 'Cycle (low resistance)'],
      contraindications: ['Sprinting before re-test criteria met (60-90% strength symmetry, pain-free isokinetic)', 'Static stretching of acutely strained tissue early'],
      researchSection: '§10',
    },
    {
      id: 'proximal_hamstring_tendinopathy',
      name: 'Proximal Hamstring Tendinopathy (PHT)',
      category: 'tendinopathy',
      riskLevel: 'moderate',
      expectedRTRWeeksLow: 12, expectedRTRWeeksHigh: 24,
      coreProtocol: 'Isometric loading early (long-lever bridges 45 s × 5). HSR progression. Avoid prolonged sitting (compresses tendon). Sprint and downhill last to return. Long course — patience required.',
      redFlags: ['Sciatic nerve symptoms (radiation past knee)', 'Severe seated pain', 'Bone pain at ischial tuberosity'],
      crossTrainOK: ['Pool', 'Cycle (limit prolonged sitting; stand often)'],
      contraindications: ['Forward-bend stretching early (compressive)', 'Hill sprints early'],
      researchSection: '§11',
    },
    {
      id: 'calf_strain',
      name: 'Calf Strain (Gastrocnemius / Soleus)',
      category: 'muscle_strain',
      riskLevel: 'moderate',
      expectedRTRWeeksLow: 2, expectedRTRWeeksHigh: 8,
      coreProtocol: 'POLICE early. Calf eccentric raises in two positions (knee straight = gastroc, knee bent = soleus) once pain-free isometrics. Heel lift can offload during return. Avoid hills early.',
      redFlags: ['Sudden tearing pain with limp', 'Unilateral swelling, warmth, calf tenderness — rule out DVT', 'Palpable defect'],
      crossTrainOK: ['Pool', 'Cycle (low resistance)'],
      contraindications: ['Hills, sprints, plyometrics until both straight- and bent-knee raises symmetric'],
      researchSection: '§12',
    },
    {
      id: 'hip_flexor_strain',
      name: 'Hip Flexor Strain / Iliopsoas-Related Pain',
      category: 'muscle_strain',
      riskLevel: 'low',
      expectedRTRWeeksLow: 2, expectedRTRWeeksHigh: 6,
      coreProtocol: 'POLICE early. Progressive hip-flexor strengthening (banded marches → leg raises → single-leg cable hip flexion). Stretch glute and posterior chain (often tight on injured side). Avoid sprinting and uphill running early.',
      redFlags: ['Snapping or clunk with motion (suspect intra-articular)', 'Numbness in groin or anterior thigh', 'Severe night pain'],
      crossTrainOK: ['Pool (avoid kicks)', 'Cycle (avoid high cadence)'],
      contraindications: ['Sprinting and uphill running early'],
      researchSection: '§13',
    },
    {
      id: 'piriformis_syndrome',
      name: 'Piriformis Syndrome / Deep Gluteal Syndrome',
      category: 'hip_buttock',
      riskLevel: 'low',
      expectedRTRWeeksLow: 4, expectedRTRWeeksHigh: 12,
      coreProtocol: 'Hip-stabilizer + glute strengthening. Address sitting tolerance (avoid prolonged compression). Sciatic neural mobilization. Reduce running volume during reactive phase.',
      redFlags: ['Frank radiculopathy (radiation past knee)', 'Bilateral symptoms', 'Saddle anaesthesia (cauda equina — emergency)'],
      crossTrainOK: ['Pool', 'Cycle (avoid prolonged sitting)'],
      contraindications: ['Aggressive piriformis stretches early (can irritate)'],
      researchSection: '§14',
    },
    {
      id: 'posterior_tibial_tendinopathy',
      name: 'Posterior Tibial Tendinopathy',
      category: 'tendinopathy',
      riskLevel: 'moderate',
      expectedRTRWeeksLow: 6, expectedRTRWeeksHigh: 16,
      coreProtocol: 'HSR resisted foot adduction-inversion + foot intrinsics. Medial post or supportive shoe during return. Progressive walk-run. Examine arch / pronation patterns. Watch for arch collapse (Stage II).',
      redFlags: ['Visible arch collapse', 'Inability to perform single-leg heel raise', 'Severe medial ankle pain at rest'],
      crossTrainOK: ['Pool', 'Cycle', 'Elliptical'],
      contraindications: ['Minimalist shoes during reactive phase', 'Trail running early'],
      researchSection: '§15',
    },
    {
      id: 'peroneal_tendinopathy',
      name: 'Peroneal Tendinopathy',
      category: 'tendinopathy',
      riskLevel: 'low',
      expectedRTRWeeksLow: 6, expectedRTRWeeksHigh: 12,
      coreProtocol: 'HSR resisted foot eversion. Cuboid mobility check. Address ankle stability if recurrent inversion sprains. Walk-run progression standard.',
      redFlags: ['Snapping over lateral malleolus (suspect subluxation)', 'Visible swelling along lateral ankle', 'Foot drop'],
      crossTrainOK: ['Pool', 'Cycle', 'Elliptical'],
      contraindications: ['Trail running and uneven surfaces early'],
      researchSection: '§16',
    },
    {
      id: 'metatarsalgia',
      name: 'Metatarsalgia',
      category: 'forefoot_nerve',
      riskLevel: 'low',
      expectedRTRWeeksLow: 3, expectedRTRWeeksHigh: 8,
      coreProtocol: 'Metatarsal pads or full-length insoles. Reduce running volume. Foot-intrinsics strengthening. Re-evaluate forefoot strike pattern (high forefoot load) — gradual cadence increase if needed.',
      redFlags: ['Focal swelling at single MT head (suspect stress fracture)', 'Numbness between toes', 'Severe night pain'],
      crossTrainOK: ['Pool', 'Cycle'],
      contraindications: ['Minimalist shoes on hard surfaces', 'Forefoot-strike running drills early'],
      researchSection: '§17',
    },
    {
      id: 'mortons_neuroma',
      name: 'Morton\'s Neuroma',
      category: 'forefoot_nerve',
      riskLevel: 'low',
      expectedRTRWeeksLow: 4, expectedRTRWeeksHigh: 12,
      coreProtocol: 'Wide toe-box shoes. Metatarsal dome / pad to splay metatarsals. Reduce running volume. Imaging (MRI/US) if persistent. Refer for injection if conservative fails.',
      redFlags: ['Persistent numbness (sensory loss)', 'Bilateral symptoms', 'Severe pain at rest'],
      crossTrainOK: ['Pool', 'Cycle'],
      contraindications: ['Narrow shoes', 'High-pressure forefoot drills'],
      researchSection: '§18',
    },
    {
      id: 'hip_labral_fai',
      name: 'Hip Labral Irritation / FAI Syndrome',
      category: 'hip_joint',
      riskLevel: 'high',
      expectedRTRWeeksLow: 8, expectedRTRWeeksHigh: 24,
      coreProtocol: 'Refer to sports medicine for FAI workup (X-ray, possible MRI). Avoid deep flexion + internal rotation. Hip-stabilizer strengthening. Reduce running volume substantially. May require surgical consultation.',
      redFlags: ['C-sign', 'Restricted internal rotation in flexion', 'Mechanical clicking/locking', 'Severe groin pain at rest'],
      crossTrainOK: ['Pool (avoid breaststroke kick)', 'Cycle (steep saddle, avoid deep flexion)'],
      contraindications: ['Yoga poses that combine deep hip flexion + IR', 'Squats below 90° if symptomatic'],
      researchSection: '§19',
    },
    {
      id: 'doms_acute_soreness',
      name: 'DOMS / Generic Acute Soreness',
      category: 'soreness',
      riskLevel: 'low',
      expectedRTRWeeksLow: 0, expectedRTRWeeksHigh: 1,
      coreProtocol: 'Active recovery (very easy 30 min) often helps. Light mobility. Hydration + protein. Symmetric symptoms across both legs after a hard session = DOMS, run through. Asymmetric or focal = treat as injury.',
      redFlags: ['Asymmetric pain', 'Focal point-tender pain', 'Pain that worsens day 3-4 post-session (DOMS should improve)', 'Functional weakness'],
      crossTrainOK: ['Easy aerobic anything'],
      contraindications: ['Hard quality session within 48h of severe DOMS'],
      researchSection: '§20',
    },
  ],
  citations: [
    cite('§§2-20 Per-injury return-to-run protocols', 'Catalog of 19 named injuries with risk level, expected RTR weeks, core protocol, red flags, cross-train options, contraindications. Full per-injury detail (pathophysiology, diagnosis, exercise progressions) at researchSection pointer.', 'research', '05'),
  ],
};
