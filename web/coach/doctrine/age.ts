/**
 * Doctrine — Age-related training adjustments (lifespan).
 *
 * Source: Research/14-age-considerations.md
 *
 * Existing masters.ts (legacy) covers a fraction; this file extends to
 * full lifespan (youth → 70+) with VO2max decline curves, recovery
 * requirements by decade, and screening triggers.
 *
 * Engine consumers:
 *   - profile / settings UI    → AGE_DEFAULTS_BY_DECADE prompts
 *   - coach.adjustForReality   → SCREENING_BY_AGE referrals
 *   - coach.prescribeWorkout   → recovery-day frequency by age */
import { cite, type Cited } from '.';

// ── Defaults by decade ───────────────────────────────────────────

export const AGE_DEFAULTS_BY_DECADE: Cited<Array<{
  decade: 'under_14' | '14_18' | '18_22' | '20s' | '30s' | '40s' | '50s' | '60s' | '70_plus';
  volumeRecommendation: string;
  recoveryDaysPerHardSession: { low: number; high: number };
  strengthEmphasis: 'low' | 'moderate' | 'high' | 'critical';
  injuryRiskShifts: string[];
}>> = {
  value: [
    { decade: 'under_14',  volumeRecommendation: 'Cap 30 mpw; max race distance 10K (apophyseal injury risk)', recoveryDaysPerHardSession: { low: 1, high: 2 }, strengthEmphasis: 'low',       injuryRiskShifts: ['Apophyseal injuries (Sever, Osgood-Schlatter)'] },
    { decade: '14_18',     volumeRecommendation: 'Build to ~50 mpw; HM by senior year only',                     recoveryDaysPerHardSession: { low: 1, high: 1 }, strengthEmphasis: 'moderate', injuryRiskShifts: ['Stress fractures if rapid volume increase', 'RED-S vulnerability'] },
    { decade: '18_22',     volumeRecommendation: 'Collegiate volume 60-90 mpw; full marathon physiology',         recoveryDaysPerHardSession: { low: 1, high: 1 }, strengthEmphasis: 'moderate', injuryRiskShifts: ['Compartment syndrome', 'Mononucleosis vulnerability'] },
    { decade: '20s',       volumeRecommendation: 'Peak training years',                                            recoveryDaysPerHardSession: { low: 1, high: 1 }, strengthEmphasis: 'moderate', injuryRiskShifts: ['Acute injuries from intensity'] },
    { decade: '30s',       volumeRecommendation: 'Marathon sweet spot — cumulative aerobic adaptation pays off',   recoveryDaysPerHardSession: { low: 1, high: 2 }, strengthEmphasis: 'high',     injuryRiskShifts: ['Achilles/plantar fasciitis', 'IT band'] },
    { decade: '40s',       volumeRecommendation: 'Hold volume; build strength + mobility',                          recoveryDaysPerHardSession: { low: 1, high: 2 }, strengthEmphasis: 'high',     injuryRiskShifts: ['Tendon stiffness; meniscal degeneration'] },
    { decade: '50s',       volumeRecommendation: 'Recovery weeks more critical; consider 2-on-1-off cycle',         recoveryDaysPerHardSession: { low: 2, high: 2 }, strengthEmphasis: 'critical', injuryRiskShifts: ['Rotator cuff (form), Achilles, hamstring'] },
    { decade: '60s',       volumeRecommendation: 'Modify intensity emphasis; prioritize steady aerobic',            recoveryDaysPerHardSession: { low: 2, high: 3 }, strengthEmphasis: 'critical', injuryRiskShifts: ['Bone density loss', 'Joint OA flare-ups'] },
    { decade: '70_plus',   volumeRecommendation: 'Time-on-feet > pace; consistency is everything',                  recoveryDaysPerHardSession: { low: 2, high: 3 }, strengthEmphasis: 'critical', injuryRiskShifts: ['Falls', 'Cardiovascular events', 'Bone fragility'] },
  ],
  citations: [
    cite('§Quick Reference: Defaults by Decade', '9 age tiers × volume / recovery / strength / injury risk', 'research', '14'),
  ],
};

// ── VO2max decline curve ──────────────────────────────────────────

export const VO2MAX_DECLINE_CURVE: Cited<{
  inactivePctPerDecade: number;
  trainedAerobicPctPerDecadeAfter40: { low: number; high: number };
  trainedAerobicAcceleratesAfterAge: number;
  preservationProtocol: string[];
}> = {
  value: {
    inactivePctPerDecade: 10,
    trainedAerobicPctPerDecadeAfter40: { low: 5, high: 7 },
    trainedAerobicAcceleratesAfterAge: 70,
    preservationProtocol: [
      'Maintain ≥1 weekly VO2max session (3-5 min reps)',
      'Plyometric / hill sprint 1-2×/week',
      'Avoid extended aerobic-only blocks past 8 weeks (loses top-end)',
      'Strength training 2×/week minimum',
    ],
  },
  citations: [
    cite('§The VO2max Decline Curve', 'Inactive ~10%/decade; trained 5-7%/decade after 40; accelerates after 70', 'research', '14'),
  ],
};

// ── Lactate threshold preservation ────────────────────────────────

export const LACTATE_THRESHOLD_PRESERVATION: Cited<{
  preservationFinding: string;
  protocolRequirement: string;
  practicalImplication: string;
}> = {
  value: {
    preservationFinding: 'Lactate threshold (LT2) preserves better with age than VO2max. Trained masters can maintain LT pace as % of VO2max even as VO2max declines.',
    protocolRequirement: 'Maintain ≥1 weekly threshold session (cruise intervals or continuous tempo). 4-7 mi at T or 3-5 × 1 mi at T.',
    practicalImplication: 'Marathon performance preserves better than 5K performance with age — marathon is more LT-dependent, less VO2max-dependent.',
  },
  citations: [
    cite('§Lactate Threshold Preservation', 'LT preserves better than VO2max; marathon performance preserves better than 5K', 'research', '14'),
  ],
};

// ── Cardiovascular screening ──────────────────────────────────────

export const CARDIOVASCULAR_SCREENING_BY_AGE: Cited<Array<{
  ageRange: string;
  screeningRecommendation: string;
  whenToSee: string;
}>> = {
  value: [
    { ageRange: '<35',     screeningRecommendation: 'Standard physical exam; baseline ECG if family history of cardiac death',                       whenToSee: 'Annual physical' },
    { ageRange: '35-45',   screeningRecommendation: 'Resting ECG; lipid panel; BP; consider stress test if multiple risk factors',                  whenToSee: 'Annual physical + before starting marathon training' },
    { ageRange: '46-55',   screeningRecommendation: 'Stress test recommended before high-intensity programs',                                        whenToSee: 'Annual physical + before any marathon training' },
    { ageRange: '56-65',   screeningRecommendation: 'Stress test required before any high-intensity program; consider coronary calcium score',       whenToSee: 'Annual physical + before any race-effort training' },
    { ageRange: '65+',     screeningRecommendation: 'Comprehensive cardio workup; coronary calcium score; consider echo if abnormalities',           whenToSee: 'Annual physical + every cycle change' },
  ],
  note: 'Family history of premature cardiac death (sudden death <50 or MI <55 in 1st-degree relative) elevates screening at any age.',
  citations: [
    cite('§Cardiovascular Screening Recommendations by Age', 'Age range → screening + when to see physician', 'research', '14'),
  ],
};

// ── Recovery scaling by decade ────────────────────────────────────

export const RECOVERY_BY_DECADE: Cited<Array<{
  decade: string;
  recoveryDaysAfterHard: number;
  recoveryDaysAfterMarathon: { low: number; high: number };
  cutbackFrequencyWeeks: { load: number; cutback: number };
}>> = {
  value: [
    { decade: '20s',       recoveryDaysAfterHard: 1,  recoveryDaysAfterMarathon: { low: 21, high: 28 },  cutbackFrequencyWeeks: { load: 4, cutback: 1 } },
    { decade: '30s',       recoveryDaysAfterHard: 1,  recoveryDaysAfterMarathon: { low: 21, high: 28 },  cutbackFrequencyWeeks: { load: 3, cutback: 1 } },
    { decade: '40s',       recoveryDaysAfterHard: 1,  recoveryDaysAfterMarathon: { low: 28, high: 35 },  cutbackFrequencyWeeks: { load: 3, cutback: 1 } },
    { decade: '50s',       recoveryDaysAfterHard: 2,  recoveryDaysAfterMarathon: { low: 28, high: 42 },  cutbackFrequencyWeeks: { load: 2, cutback: 1 } },
    { decade: '60s',       recoveryDaysAfterHard: 2,  recoveryDaysAfterMarathon: { low: 35, high: 49 },  cutbackFrequencyWeeks: { load: 2, cutback: 1 } },
    { decade: '70_plus',   recoveryDaysAfterHard: 2,  recoveryDaysAfterMarathon: { low: 42, high: 56 },  cutbackFrequencyWeeks: { load: 2, cutback: 1 } },
  ],
  citations: [
    cite('§Recovery Requirements by Decade', 'Recovery scales with age. Cutback every 2 wk for 50+; 3-4 wk for younger.', 'research', '14'),
  ],
};
