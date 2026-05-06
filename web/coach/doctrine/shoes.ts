/**
 * Doctrine §9 — Footwear strategy: super shoes and the rotation.
 *
 * Extracted from docs/coaching-research.md §9.1, §9.2, §9.3.
 */
import { cite, type Cited } from '.';

/** What super shoes actually buy you. */
export const SUPER_SHOE_BENEFIT: Cited<{
  metabolicCostReductionPct: number;
  /** Pace below which the benefit drops substantially. */
  benefitDropoffSlowerThanSPerMi: number;
  /** Spent foam, in miles. */
  lifetimeMilesLow: number;
  lifetimeMilesHigh: number;
}> = {
  value: { metabolicCostReductionPct: 4, benefitDropoffSlowerThanSPerMi: 480, lifetimeMilesLow: 200, lifetimeMilesHigh: 300 },
  note: 'Approximately 4% metabolic cost reduction at race paces. At slow easy paces the benefit drops substantially. Foam wears faster than conventional — usually 200–300 miles, sometimes less.',
  citations: [
    cite('§9.1', 'Carbon-plated shoes with high-rebound foam … reduce the metabolic cost of running by approximately 4 percent at race paces.'),
    cite('§9.2', 'Most super shoes are spent at 200 to 300 miles, sometimes less.'),
  ],
};

/** The rotation framework — which shoe to use when. */
export const SHOE_ROTATION: Cited<{
  raceDay: string;
  trainingSuper: string;
  dailyTrainer: string;
  recoveryShoe: string;
}> = {
  value: {
    raceDay: 'super shoe — marathon, half, key MP long runs near race day',
    trainingSuper: 'SC Trainer / Endorphin Speed / similar — tempos, threshold intervals, faster long runs',
    dailyTrainer: 'max cushion — general aerobic, medium-long runs',
    recoveryShoe: 'soft trainer — very easy days, recovery runs',
  },
  citations: [cite('§9.2', 'A practical rotation framework')],
};

/** Cadence-shoe interaction — supershoe risk for low-cadence runners. */
export const SHOE_CADENCE_RISK: Cited<{
  /** Below this spm, super shoes can amplify overstride. */
  spmBelowWhichSupershoeRisksAmplifyOverstride: number;
  remediation: 'build_cadence_first';
}> = {
  value: { spmBelowWhichSupershoeRisksAmplifyOverstride: 165, remediation: 'build_cadence_first' },
  note: 'Building cadence first, then adopting super shoes, is the safer order.',
  citations: [cite('§9.3', 'There is a real consideration for runners with low cadence (under 165 to 170 spm) about super shoes.')],
};

/** Stress-fracture concern documented in research. */
export const SUPER_SHOE_INJURY_NOTE: Cited<{
  injuryReferenced: 'navicular_stress_fracture';
  source: '2023_Sports_Medicine';
}> = {
  value: { injuryReferenced: 'navicular_stress_fracture', source: '2023_Sports_Medicine' },
  citations: [cite('§9.2', 'A 2023 Sports Medicine article documented five cases of navicular stress fractures linked to carbon-plated shoes')],
};
