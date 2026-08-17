/**
 * injury-protocols · the per-site return-to-run doctrine table.
 *
 * INJURY-1 (2026-08-17). `injury-builder` used to pick the whole return
 * from a three-value severity enum: minor 2 weeks, moderate 3, major 4,
 * one generic walk-run ladder for every diagnosis. `injury.site` was
 * loaded and echoed into the phase rationale but never reached the
 * prescription.
 *
 * Research/05-injury-return-protocols.md is organised the other way
 * round: §§2-19 are one graded protocol PER SITE, and §9.2 (:440-454)
 * stratifies bone stress injury by location because the high-risk sites
 * have poor blood supply and non-union rates that make premature loading
 * limb-threatening. Two numbers the old builder could not express:
 *
 *   · :475  low-risk BSI · "Total return: 8-16 weeks typical."
 *   · :487  high-risk BSI · "Total return commonly 4-9 months."
 *
 * against a builder whose longest plan was four weeks.
 *
 * And the rule that matters most, :463:
 *
 *   "All confirmed BSIs: no running until clinical clearance."
 *
 * A suspected navicular stress fracture used to get a walk-run ladder on
 * a three-week clock. Every protocol here whose `runStartWeek` is null
 * emits ZERO running rows; the plan is a cross-training holding pattern
 * with a clearance gate, and the return-to-run plan is written after a
 * clinician clears it.
 *
 * This table is data, not advice. It carries the doctrine's own numbers
 * and its own citations, nothing extrapolated. Where the research is
 * silent for a site we fall to `unknown`, which is deliberately the most
 * conservative entry in the table (see PROTOCOL_UNKNOWN).
 */

/**
 * Risk class · drives whether running may be prescribed at all and what
 * kind of cross-training is safe.
 *
 *   bsi_high      · Research/05:443-454 high-risk column · tension-side or
 *                   avascular sites. Non-weight-bearing until cleared (:66).
 *   bsi_low       · :442-453 low-risk column. Non-impact only (:65).
 *   bsi_suspected · focal bone tenderness / positive hop with no imaging.
 *                   :499-500 "All suspected BSIs warrant medical
 *                   evaluation." Treated as low-risk BSI until stratified.
 *   tendinopathy  · §§3,4,7,11,15,16 · load is the treatment (:64), so
 *                   complete rest is contraindicated.
 *   soft_tissue   · §§10,12,13 acute strains.
 *   joint         · §§5,6,14,19.
 *   fascia        · §2.
 *   bone_stress_continuum · §8 MTSS · not a BSI, but on the same
 *                   continuum (:390) and one positive hop test away.
 *   unknown       · doctrine silent for this site · conservative degrade.
 */
export type InjuryRiskClass =
  | 'bsi_high'
  | 'bsi_low'
  | 'bsi_suspected'
  | 'tendinopathy'
  | 'soft_tissue'
  | 'joint'
  | 'fascia'
  | 'bone_stress_continuum'
  | 'unknown';

export type CrossTrainMode = 'non_weight_bearing' | 'non_impact' | 'as_tolerated';

export interface InjuryProtocol {
  key: string;
  /** Runner-facing name of the protocol we matched. */
  label: string;
  riskClass: InjuryRiskClass;
  /**
   * The doctrine's own total-return band in weeks, [low, high]. `high`
   * is null where the research writes an open-ended "12+".
   */
  totalWeeks: readonly [number, number | null];
  /**
   * 0-based plan week at which the FIRST running row may appear.
   * null → no running rows at all; return is clinician-gated.
   */
  runStartWeek: number | null;
  /** Same, for a `major` (7-10/10) presentation, where the site's own
   *  table gives a pain-dependent band (e.g. MTSS phase 1 is "2-6 weeks
   *  (pain-dependent)", Research/05:407). Undefined → use runStartWeek. */
  runStartWeekSevere?: number;
  /** Walk-run stage the site's table re-enters running at (:21-30). */
  startStage: number;
  crossTrain: CrossTrainMode;
  /** Shown instead of a return date when runStartWeek is null. */
  clearanceGate: string | null;
  /** Line-level citation into Research/05. */
  citation: string;
}

/**
 * The generic walk-run ladder · Research/05:21-30, table "Generic
 * walk-run progression template (8 stages)". Encoded verbatim.
 *
 * `sessionsPerWk` takes the LOW end where the research writes a band
 * ("3-4" for stages 4-7): the conservative reading, per the rule that
 * ambiguity degrades toward the safer number.
 */
export interface WalkRunStage {
  stage: number;
  runMin: number;
  walkMin: number;
  repeats: number;
  totalRunMin: number;
  sessionsPerWk: number;
  /** Whole-session minutes including the walk intervals. */
  sessionMin: number;
  continuous: boolean;
}

export const WALK_RUN_LADDER: readonly WalkRunStage[] = [
  { stage: 1, runMin: 1,  walkMin: 4, repeats: 5, totalRunMin: 5,  sessionsPerWk: 3, sessionMin: 25, continuous: false },
  { stage: 2, runMin: 2,  walkMin: 3, repeats: 5, totalRunMin: 10, sessionsPerWk: 3, sessionMin: 25, continuous: false },
  { stage: 3, runMin: 3,  walkMin: 2, repeats: 5, totalRunMin: 15, sessionsPerWk: 3, sessionMin: 25, continuous: false },
  { stage: 4, runMin: 4,  walkMin: 2, repeats: 4, totalRunMin: 16, sessionsPerWk: 3, sessionMin: 24, continuous: false },
  { stage: 5, runMin: 5,  walkMin: 1, repeats: 4, totalRunMin: 20, sessionsPerWk: 3, sessionMin: 24, continuous: false },
  { stage: 6, runMin: 8,  walkMin: 2, repeats: 3, totalRunMin: 24, sessionsPerWk: 3, sessionMin: 30, continuous: false },
  { stage: 7, runMin: 12, walkMin: 2, repeats: 2, totalRunMin: 24, sessionsPerWk: 3, sessionMin: 28, continuous: false },
  { stage: 8, runMin: 28, walkMin: 0, repeats: 1, totalRunMin: 28, sessionsPerWk: 4, sessionMin: 28, continuous: true },
] as const;

export const MAX_WALK_RUN_STAGE = 8;

/**
 * Research/05:33 · "Spend at least 2 sessions at each stage before
 * progressing." At the doctrine's 3 sessions/week that is one stage per
 * week at most, never two.
 */
export const MAX_STAGE_ADVANCE_PER_WEEK = 1;

/**
 * Research/05:17 · "Frequency: every other day during early stages
 * (alternate-day rule) — the off-day is for tissue adaptation and pain
 * monitoring." Impact sessions are never placed on back-to-back days
 * below this stage.
 */
export const ALTERNATE_DAY_THROUGH_STAGE = 7;

/**
 * How many plan weeks we actually write rows for. The doctrine bands run
 * to 39 weeks (4-9 months, :487); a plan is a rolling scaffold that
 * re-generates, so we write the near window and carry the full band in
 * the plan's authored_state and phase rationale.
 */
export const INJURY_PLAN_MAX_WEEKS = 12;

/**
 * Conservative fallback. Research/05 has no entry for e.g. "lower back",
 * so we apply only the general principles: the walk-run scaffold is for
 * "any injury that has required a layoff longer than ~2 weeks" (:11),
 * "weeks off ≈ weeks to rebuild base" (:76), and "symptoms persisting
 * ≥6 weeks despite appropriate load management" is a referral (:101).
 * Two weeks off running, then stage 1, over an 8-week window.
 */
const PROTOCOL_UNKNOWN: InjuryProtocol = {
  key: 'unknown',
  label: 'General return-to-run',
  riskClass: 'unknown',
  totalWeeks: [8, null],
  runStartWeek: 2,
  startStage: 1,
  crossTrain: 'non_impact',
  clearanceGate: null,
  citation: 'Research/05:11, :17, :76, :101 · general principles · no site-specific protocol in the research',
};

/**
 * Bone stress injury · the three entries that emit no running.
 * :463 "All confirmed BSIs: no running until clinical clearance."
 */
const PROTOCOL_BSI_HIGH: InjuryProtocol = {
  key: 'bsi_high',
  label: 'High-risk bone stress injury',
  riskClass: 'bsi_high',
  totalWeeks: [16, 39],
  runStartWeek: null,
  startStage: 1,
  crossTrain: 'non_weight_bearing',
  clearanceGate: 'Imaging confirmation of healing before any running. Your clinician sets the date, not this plan.',
  citation: 'Research/05:463, :477-487 · high-risk site · imaging-confirmed healing before running · total return commonly 4-9 months',
};

const PROTOCOL_BSI_LOW: InjuryProtocol = {
  key: 'bsi_low',
  label: 'Low-risk bone stress injury',
  riskClass: 'bsi_low',
  totalWeeks: [8, 16],
  runStartWeek: null,
  startStage: 1,
  crossTrain: 'non_impact',
  clearanceGate: 'Five consecutive days fully pain-free in daily activity, plus clinical clearance, before the first running step.',
  citation: 'Research/05:463, :465-475, :494-497 · offload then pain-free walking gate · total return 8-16 weeks typical',
};

const PROTOCOL_BSI_SUSPECTED: InjuryProtocol = {
  key: 'bsi_suspected',
  label: 'Suspected bone stress injury',
  riskClass: 'bsi_suspected',
  totalWeeks: [8, 16],
  runStartWeek: null,
  startStage: 1,
  crossTrain: 'non_impact',
  clearanceGate: 'Get it looked at before any running. Focal bone pain with a positive hop test is a referral, not a training decision.',
  citation: 'Research/05:95, :456-460, :463, :499-500 · suspected BSI warrants medical evaluation · treated as low-risk until stratified',
};

/**
 * Site table. `match` runs against the lowercased concatenation of the
 * injury row's site, notes and return_protocol, so a runner who picks
 * "shin" from the coarse body-part list but types "stress fracture" in
 * the notes lands on the BSI protocol.
 *
 * Order matters: first match wins, so the specific patterns
 * (navicular before foot, insertional before achilles) come first.
 */
interface SiteRule {
  match: RegExp;
  protocol: InjuryProtocol;
}

const SITE_RULES: readonly SiteRule[] = [
  // ── Bone stress · highest priority, most specific first ──────────────
  // High-risk sites · Research/05:443-454.
  {
    match: /\b(navicular|jones (fracture|zone)|fifth metatarsal|5th metatarsal|femoral neck|anterior tibia|anterior tibial cortex|black line|medial malleol\w*|sesamoid)\b/,
    protocol: PROTOCOL_BSI_HIGH,
  },
  // Low-risk sites named explicitly alongside a bone-stress word.
  {
    match: /\b(stress fracture|stress reaction|bone stress|bsi)\b.*\b(posteromedial|tibial shaft|femoral shaft|metatarsal [234]|calcaneus|pubic ramus|sacrum)\b/,
    protocol: PROTOCOL_BSI_LOW,
  },
  {
    match: /\b(posteromedial|tibial shaft|femoral shaft|metatarsal [234]|pubic ramus|sacrum)\b.*\b(stress fracture|stress reaction|bone stress|bsi)\b/,
    protocol: PROTOCOL_BSI_LOW,
  },
  // Bone stress named without a site · unstratified, so suspected.
  { match: /\b(stress fracture|stress reaction|bone stress|bsi)\b/, protocol: PROTOCOL_BSI_SUSPECTED },
  // The referral red flags for BSI, in the runner's own words (:95).
  { match: /\b(focal bone|point.?tender|hop test|night pain)\b/, protocol: PROTOCOL_BSI_SUSPECTED },

  // ── Achilles · insertional before mid-portion ───────────────────────
  {
    match: /\binsertional\b|\bhaglund\w*\b/,
    protocol: {
      key: 'achilles_insertional',
      label: 'Insertional Achilles tendinopathy',
      riskClass: 'tendinopathy',
      totalWeeks: [11, null],
      runStartWeek: 3,
      startStage: 1,
      crossTrain: 'non_impact',
      clearanceGate: null,
      citation: 'Research/05:234-240 · §4.4 · floor-level calf raises, no dorsiflexion past neutral · phase 1 weeks 1-3 off running',
    },
  },
  {
    match: /\bachilles\b|\bheel cord\b/,
    protocol: {
      key: 'achilles_midportion',
      label: 'Mid-portion Achilles tendinopathy',
      riskClass: 'tendinopathy',
      totalWeeks: [12, null],
      runStartWeek: 2,
      startStage: 1,
      crossTrain: 'non_impact',
      clearanceGate: null,
      citation: 'Research/05:190-196 · §3.4 · Silbernagel pain-monitoring model · phase 1 weeks 1-2 off running',
    },
  },

  // ── Foot ────────────────────────────────────────────────────────────
  {
    match: /\b(plantar|fascii?t\w*|fasciopathy)\b|\bheel pain\b|\barch\b/,
    protocol: {
      key: 'plantar_fasciopathy',
      label: 'Plantar fasciopathy',
      riskClass: 'fascia',
      totalWeeks: [12, null],
      runStartWeek: 4,
      startStage: 1,
      crossTrain: 'non_impact',
      clearanceGate: null,
      citation: 'Research/05:141-148 · §2.4 · high-load calf raises weeks 1-4, walk-run stage 1-2 at weeks 5-6 if morning pain <=2/10',
    },
  },
  {
    match: /\b(neuroma|morton\w*)\b/,
    protocol: {
      key: 'mortons_neuroma',
      label: "Morton's neuroma",
      riskClass: 'joint',
      totalWeeks: [12, null],
      runStartWeek: 0,
      startStage: 8,
      crossTrain: 'as_tolerated',
      clearanceGate: null,
      citation: 'Research/05:866-870 · §18.4 · footwear is the intervention · reduced volume running continues from week 1',
    },
  },
  {
    match: /\b(tibialis posterior|posterior tib\w*|post.?tib)\b/,
    protocol: {
      key: 'posterior_tibial_tendinopathy',
      label: 'Posterior tibial tendinopathy',
      riskClass: 'tendinopathy',
      totalWeeks: [12, null],
      runStartWeek: 3,
      startStage: 1,
      crossTrain: 'non_impact',
      clearanceGate: null,
      citation: 'Research/05:744-748 · §15.4 · phase 1 weeks 1-3 off running, walk-run from week 4 on flat cushioned surfaces',
    },
  },
  {
    match: /\bperoneal\b/,
    protocol: {
      key: 'peroneal_tendinopathy',
      label: 'Peroneal tendinopathy',
      riskClass: 'tendinopathy',
      totalWeeks: [9, 12],
      runStartWeek: 2,
      startStage: 1,
      crossTrain: 'non_impact',
      clearanceGate: null,
      citation: 'Research/05:785-789 · §16.4 · phase 1 weeks 1-2 off running, walk-run on flat predictable surface from week 3',
    },
  },
  {
    match: /\b(metatarsalgia|forefoot|foot|toe)\b/,
    protocol: {
      key: 'metatarsalgia',
      label: 'Metatarsalgia',
      riskClass: 'joint',
      totalWeeks: [9, null],
      runStartWeek: 2,
      startStage: 1,
      crossTrain: 'non_impact',
      clearanceGate: null,
      citation: 'Research/05:826-830 · §17.4 · walk only weeks 1-2, walk-run stage 1-3 in a cushioned shoe from week 3',
    },
  },

  // ── Shin ────────────────────────────────────────────────────────────
  {
    match: /\b(mtss|shin splint\w*|shin|medial tibial)\b/,
    protocol: {
      key: 'mtss',
      label: 'Medial tibial stress syndrome',
      riskClass: 'bone_stress_continuum',
      totalWeeks: [12, 14],
      runStartWeek: 2,
      // :407 phase 1 is "2-6 weeks (pain-dependent)". A 7-10/10
      // presentation takes the far end of that band.
      runStartWeekSevere: 6,
      startStage: 1,
      crossTrain: 'non_impact',
      clearanceGate: null,
      citation: 'Research/05:406-411 · §8.4 · phase 1 relative rest 2-6 weeks pain-dependent · alternate-day walk-run on flat soft surface',
    },
  },

  // ── Knee ────────────────────────────────────────────────────────────
  {
    match: /\b(itbs?|iliotibial|it band|lateral knee)\b/,
    protocol: {
      key: 'itbs',
      label: 'Iliotibial band syndrome',
      riskClass: 'joint',
      totalWeeks: [9, null],
      runStartWeek: 2,
      startStage: 1,
      crossTrain: 'non_impact',
      clearanceGate: null,
      citation: 'Research/05:272-279 · §5.4 · hip abductor work weeks 1-2 off running, walk-run stage 1-2 flat only from week 3, no downhills',
    },
  },
  {
    match: /\b(patellar tendon|patellar tendinopathy|jumper\w* knee)\b/,
    protocol: {
      key: 'patellar_tendinopathy',
      label: 'Patellar tendinopathy',
      riskClass: 'tendinopathy',
      totalWeeks: [13, null],
      runStartWeek: 3,
      startStage: 1,
      crossTrain: 'non_impact',
      clearanceGate: null,
      citation: 'Research/05:362-368 · §7.4 · heavy slow resistance · walk-run stage 1-3 starting week 4-5, flat',
    },
  },
  {
    match: /\b(knee|patell\w*|pfps|runner\w* knee)\b/,
    protocol: {
      key: 'pfps',
      label: 'Patellofemoral pain',
      riskClass: 'joint',
      totalWeeks: [9, null],
      // §6.4 (:313) is the one protocol in the research that keeps the
      // runner running: "supports running through monitored, low-grade
      // symptoms (<=2/10 NRS in-session) with training modification
      // rather than complete cessation". Stage 8 is continuous easy, and
      // its 28 minutes is roughly the "~50% of pre-flare" the table asks
      // for at a typical easy volume.
      runStartWeek: 0,
      startStage: 8,
      crossTrain: 'as_tolerated',
      clearanceGate: null,
      citation: 'Research/05:313-321 · §6.4 · pain-guided · reduce volume to ~50% of pre-flare, keep it flat and easy, pain <=2/10 in session',
    },
  },

  // ── Hamstring · proximal tendinopathy before acute strain ───────────
  {
    match: /\b(proximal hamstring|pht|ischial|high hamstring|sit bone)\b/,
    protocol: {
      key: 'proximal_hamstring_tendinopathy',
      label: 'Proximal hamstring tendinopathy',
      riskClass: 'tendinopathy',
      totalWeeks: [11, null],
      runStartWeek: 2,
      startStage: 1,
      crossTrain: 'non_impact',
      clearanceGate: null,
      citation: 'Research/05:573-577 · §11.4 Goom framework · isometrics weeks 1-2, walk-run flat alternate-day from week 3, no uphill',
    },
  },
  {
    match: /\bhamstring\b/,
    protocol: {
      key: 'hamstring_strain',
      label: 'Hamstring strain',
      riskClass: 'soft_tissue',
      // :531-532 · type I (sprint mechanism) 3-6 weeks, type II (stretch
      // mechanism) 8-30+, and "Coaches should be much more conservative"
      // about type II. We cannot tell the two apart from a body-part
      // picker, so the band is the conservative one.
      totalWeeks: [8, 30],
      runStartWeek: 2,
      startStage: 1,
      crossTrain: 'non_impact',
      clearanceGate: null,
      citation: 'Research/05:523-532 · §10.4 · walk-run from week 3 · type II stretch-mechanism band taken because type is unknown from a body-part picker',
    },
  },

  // ── Calf ────────────────────────────────────────────────────────────
  {
    match: /\b(calf|gastroc\w*|soleus|tennis leg)\b/,
    protocol: {
      key: 'calf_strain',
      label: 'Calf strain',
      riskClass: 'soft_tissue',
      totalWeeks: [4, 8],
      runStartWeek: 2,
      startStage: 1,
      crossTrain: 'non_impact',
      clearanceGate: null,
      citation: 'Research/05:614-620 · §12.4 · walk-run stage 1-3 from week 3 once 25 single-leg heel raises are pain-free · 2-4 weeks grade I, 4-8 grade II',
    },
  },

  // ── Hip / glute ─────────────────────────────────────────────────────
  {
    match: /\b(labr\w*|fai|impingement|groin)\b/,
    protocol: {
      key: 'fai_hip',
      label: 'Hip impingement / labral irritation',
      riskClass: 'joint',
      totalWeeks: [12, null],
      // :909 offers "reduced volume if tolerable ... cycling or pool if
      // not". A plan generator cannot judge "if tolerable", so it takes
      // the other branch and re-enters running at week 5 with the
      // walk-run ladder the table's phase 2 uses.
      runStartWeek: 4,
      startStage: 1,
      crossTrain: 'non_impact',
      clearanceGate: null,
      citation: 'Research/05:907-912 · §19.4 · conservative management 3-6 months before surgical consideration · walk-run in phase 2 (weeks 5-8)',
    },
  },
  {
    match: /\b(piriformis|deep gluteal|glute|buttock)\b/,
    protocol: {
      key: 'piriformis',
      label: 'Deep gluteal syndrome',
      riskClass: 'joint',
      totalWeeks: [9, null],
      // :700 · "Reduce volume to pain-tolerable level" · running continues.
      runStartWeek: 0,
      startStage: 8,
      crossTrain: 'as_tolerated',
      clearanceGate: null,
      citation: 'Research/05:700-704 · §14.4 · reduced volume from week 1, no hills, glute strengthening is the intervention',
    },
  },
  {
    match: /\b(hip flexor|iliopsoas|psoas|hip)\b/,
    protocol: {
      key: 'hip_flexor',
      label: 'Hip flexor / iliopsoas',
      riskClass: 'soft_tissue',
      totalWeeks: [6, 8],
      runStartWeek: 2,
      startStage: 1,
      crossTrain: 'non_impact',
      clearanceGate: null,
      citation: 'Research/05:659-663 · §13.4 · phase 1 1-2 weeks off, walk-run on the flat from week 3, no hills and no fast running',
    },
  },
];

export interface ResolveInjuryProtocolInput {
  site: string | null | undefined;
  notes?: string | null;
  returnProtocol?: string | null;
  severity: 'minor' | 'moderate' | 'major';
}

export interface ResolvedInjuryProtocol {
  protocol: InjuryProtocol;
  /** Effective first running week after the severity band is applied.
   *  null → this plan writes no running rows. */
  runStartWeek: number | null;
  /** How many weeks of rows to write. */
  planWeeks: number;
  /** True when the plan is a cross-training holding pattern gated on a
   *  clinician, not a return-to-run progression. */
  clearanceRequired: boolean;
  /** Why we landed on this protocol · goes in the plan's rationale. */
  matchedOn: string;
}

const isBsi = (r: InjuryRiskClass): boolean =>
  r === 'bsi_high' || r === 'bsi_low' || r === 'bsi_suspected';

/**
 * Pick the protocol for one injury row.
 *
 * The free-text haystack is site + notes + return_protocol because the
 * runner-facing picker only offers nine coarse body parts (hamstring,
 * calf, achilles, shin, knee, hip, foot, glute, lower back) and the
 * diagnosis that changes the prescription — "navicular", "stress
 * reaction" — arrives in the notes.
 */
export function resolveInjuryProtocol(input: ResolveInjuryProtocolInput): ResolvedInjuryProtocol {
  const haystack = [input.site, input.notes, input.returnProtocol]
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .join(' ')
    .toLowerCase();

  let protocol = PROTOCOL_UNKNOWN;
  let matchedOn = 'no site-specific protocol in Research/05 · conservative general principles applied';
  for (const rule of SITE_RULES) {
    if (rule.match.test(haystack)) {
      protocol = rule.protocol;
      matchedOn = `matched "${input.site ?? ''}" to ${protocol.label}`;
      break;
    }
  }

  // Conservative escalation · a 7-10/10 presentation at a site that sits
  // on the bone-stress continuum is the exact picture Research/05:395
  // and :425 send for imaging ("Focal tenderness, positive hop test,
  // night pain -> image to rule out stress fracture"). We cannot palpate
  // or run a hop test from here, so a major shin or foot complaint is
  // handled as a suspected BSI rather than loaded on a walk-run ladder.
  if (
    input.severity === 'major'
    && !isBsi(protocol.riskClass)
    && (protocol.riskClass === 'bone_stress_continuum' || protocol.key === 'metatarsalgia')
  ) {
    protocol = PROTOCOL_BSI_SUSPECTED;
    matchedOn = `${matchedOn} · escalated to suspected bone stress injury at 7-10/10 (Research/05:395, :425)`;
  }

  let runStartWeek = protocol.runStartWeek;
  if (runStartWeek != null && input.severity === 'major' && protocol.runStartWeekSevere != null) {
    runStartWeek = protocol.runStartWeekSevere;
  }

  const [low, high] = protocol.totalWeeks;
  // Length comes from the site's own band, never from the severity enum.
  // Severity moves within the band; it does not set it.
  const banded = input.severity === 'major' && high != null ? high : low;
  const planWeeks = Math.max(1, Math.min(INJURY_PLAN_MAX_WEEKS, banded));

  return {
    protocol,
    runStartWeek,
    planWeeks,
    clearanceRequired: runStartWeek == null,
    matchedOn,
  };
}

/**
 * Stage for a given plan week. Research/05:33 · at least two sessions
 * per stage before progressing, so at the doctrine's three sessions a
 * week that is one stage per week, never two.
 */
export function stageForWeek(resolved: ResolvedInjuryProtocol, weekIdx: number): WalkRunStage | null {
  const start = resolved.runStartWeek;
  if (start == null || weekIdx < start) return null;
  const stage = Math.min(
    MAX_WALK_RUN_STAGE,
    resolved.protocol.startStage + (weekIdx - start) * MAX_STAGE_ADVANCE_PER_WEEK,
  );
  return WALK_RUN_LADDER[stage - 1] ?? null;
}

/** Human band, e.g. "8-16 weeks" or "12+ weeks". */
export function doctrineWeeksLabel(protocol: InjuryProtocol): string {
  const [low, high] = protocol.totalWeeks;
  return high == null ? `${low}+ weeks` : `${low}-${high} weeks`;
}

/**
 * The session line for one walk-run stage, in coach voice.
 * Research/05:36 · easy/conversational only, no tempo, no intervals, no
 * hills until a full continuous base is back.
 */
export function stageSessionLabel(s: WalkRunStage): string {
  return s.continuous ? `EASY ${s.totalRunMin} MIN` : `WALK-RUN ${s.runMin}:${s.walkMin}`;
}

export function stageSessionNotes(s: WalkRunStage, riskClass: InjuryRiskClass): string {
  const shape = s.continuous
    ? `${s.totalRunMin} minutes continuous, easy effort.`
    : `${s.runMin} min jog / ${s.walkMin} min walk, ${s.repeats} rounds. ${s.totalRunMin} minutes of running total.`;
  // Research/05:42-45 · the in-session rule is 0-2 green, 3-5 hold, 6+
  // stop. The old builder said "pain >= 4/10 = stop", which both stopped
  // sessions the doctrine says to continue at held load and gave a
  // number the doctrine does not use.
  const pain = isBsi(riskClass)
    ? 'Any pain on the bone stops the session (Research/05:55).'
    : 'Pain 0-2 carry on. 3-5 hold this stage, do not progress. 6 or more stop.';
  const surface = s.stage <= 5
    ? 'Flat, firm, predictable surface.'
    : 'Soft surface and rolling terrain are back on the table.';
  return `${shape} ${pain} ${surface}`;
}

/** Cross-training line, constrained by risk class. Research/05:60-69. */
export function crossTrainNotes(mode: CrossTrainMode): string {
  switch (mode) {
    case 'non_weight_bearing':
      // :66 · high-risk BSI · non-weight-bearing only until cleared.
      return 'Non-weight-bearing only. Pool running with a flotation belt, or an arm ergometer. No elliptical, no bike unless your clinician has said yes.';
    case 'non_impact':
      // :65, :69 · pool running preserves VO2max and running-specific
      // neuromuscular patterns for 4-6 weeks in trained runners.
      return 'Non-impact aerobic, 30-45 min easy. Pool run, bike, or elliptical. Pool running holds your aerobic fitness closest to running.';
    default:
      return 'Cross-train at an intensity that does not reproduce symptoms. 30-45 min easy.';
  }
}
