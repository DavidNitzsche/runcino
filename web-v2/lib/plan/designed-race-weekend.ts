/**
 * designed-race-weekend.ts · MAY A LONG RUN STAND AT FULL DOSE THE DAY AFTER
 * A RACE, FOR THIS RUNNER?
 *
 * ONE QUESTION, ONE OWNER (Constitution). Nothing else in the engine answers
 * it, and `embedMidBlockRaces` no longer answers it by omission.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * The owner's block stood an 18-mile long run one day after the 2026-09-26
 * Dodgers 10K — 24.21 miles across the pair. He ruled on it himself:
 *
 *   "I accept the 18-mile long run one day after the 09-26 Dodgers 10K. This
 *    is aggressive, but it is acceptable for me given my running history,
 *    settings, current training context, and willingness to undertake an
 *    intentionally demanding weekend. Do not weaken it merely because a
 *    generic rule sees two adjacent stressors. However, this must be a
 *    deliberate athlete-specific decision, not a universally acceptable
 *    default."
 *
 * And on the mechanism:
 *
 *   "The binding primary-stressor rule therefore needs an explicit, typed
 *    exception for intentionally designed race-plus-long-run weekends. That
 *    exception must require athlete-specific evidence and an authored
 *    rationale. It must not silently make this pairing available to every
 *    runner."
 *
 * WHAT WAS ACTUALLY WRONG BEFORE THIS FILE. `raceConsumesLongRunSlot('C')`
 * returned false, so EVERY C-effort race in front of EVERY runner's long run
 * was accepted, at full dose, with no reference to that runner at all. The
 * `ACCEPT_AS_HARD_WORKOUT` record was honest about the decision and silent
 * about the athlete. That is the "universally acceptable default" his ruling
 * forbids, and it was already shipping.
 *
 * ── THE DOCTRINE THIS IS BUILT ON, AND IT NAMES THE EXCEPTION ITSELF ────────
 *
 * `Research/00b` §"Hard/Easy Alternation", first sentence:
 *
 *   "never stack two hard days back-to-back UNLESS THE PLAN EXPLICITLY CALLS
 *    FOR A 'STRESS BLOCK' FOLLOWED BY EXTENDED RECOVERY"
 *
 * That is doctrine's own typed exception, and it comes with its own two
 * conditions. The plan must EXPLICITLY call for it (hence the required
 * authored purpose below, and hence a refusal when none is stated), and the
 * stress block must be FOLLOWED BY EXTENDED RECOVERY (hence `recoveryDaysAfter`
 * being a required input rather than a hope).
 *
 * `Research/00b` §"Recovery by Effort" supplies the grade: a C race is a
 * "hard workout substitute", "Strong effort, no taper", "0-3 days easy". The
 * top of that band is the extended recovery this file requires, on the same
 * read-the-top-of-the-band convention `POST_RACE_PRIORITY_SCALE` already
 * states in `combined-stress.ts`.
 *
 * `Research/22` §"Multi-Race Year Planning" · "5K-10K Track / Road Series" is
 * the row that puts a Saturday race in a training week at all, and it is worth
 * reading exactly: "1 short quality (Tue) + race (Sat); rest of week is E".
 * Doctrine puts a race in the week. It does not put a long run the next
 * morning. That is the gap this file fills, and it is why the answer is an
 * athlete-specific exception rather than a general rule.
 *
 * ── WHAT IT DOES NOT OWN ────────────────────────────────────────────────────
 *
 * It does not place, size, cut or record anything. `embedMidBlockRaces` calls
 * it and spends the answer; `validateComposedPlan` re-checks the shipped block
 * against it. It holds no clock, no database and no plan. Every input is
 * passed in, so the same decision is reproducible from a fixture.
 *
 * ── RULE 11 · THE PERMISSION IS A TYPE, NOT A BOOLEAN ───────────────────────
 *
 * `DesignedRaceWeekend`'s refusal branch carries NO `grant` field, so
 * `result.grant` does not compile until the caller has branched on
 * `result.permitted`. Modelled on `NormalReading<T>` in
 * `lib/training/normal-window.ts` for exactly the reason stated there: a
 * discipline anybody can forget becomes a type error nobody can.
 *
 * And every refusal is NAMED. "This runner has never demonstrated a comparable
 * weekend", "I could not read his history at all" and "he demonstrated one and
 * it was smaller than this" are three different facts, and collapsing them
 * into `false` is the bug shape Rule 11 exists to stop.
 *
 * ── RULE 22 · WHAT THIS CANNOT FAIL ON ──────────────────────────────────────
 *
 *   · INTENSITY OF THE RACE AS PRESCRIBED. It asserts the row is graded C and
 *     that the following long carries no quality. It cannot see the pace or HR
 *     text on either row; `inlinePrescriptions` writes those and nothing here
 *     reads them.
 *   · WHETHER THE EVIDENCE IS TRUE. It grades the numbers it is handed. If a
 *     caller passes a `demonstratedPairMi` measured over a contaminated window
 *     (Rule 8), this file cannot tell and will grant on it. The window is the
 *     caller's obligation and `loadGeneratorInputs` discharges it through
 *     `eligibleDaysBack`.
 *   · A RACE THE COMPOSER WAS NEVER TOLD ABOUT. Not in `midBlockRaces`, not
 *     placed, not seen.
 *   · WHETHER 24.21 MILES IS WISE. It is not a physiological model. It asks
 *     whether the runner has already run this much, whether doctrine's own
 *     stress-block conditions are met, and whether somebody wrote down why. A
 *     runner can satisfy every one of those and still have a bad weekend.
 *   · A RUNNER WHOSE HISTORY IS THIN BUT WHO COULD PLAINLY DO IT. Every gate
 *     is demonstrated history, so a runner who has never happened to run two
 *     big days back to back is refused even where a coach would say yes. That
 *     is the intended direction: the exception buys an aggressive weekend and
 *     the evidence has to have been earned.
 *   · THE SECOND HALF OF THE PAIR MOVING LATER. Three passes can still shorten
 *     the long run after the embed. `refreshPlacementCompromises` restates the
 *     record; the GRANT's own numbers are re-read there too, but a grant is
 *     never re-decided after the fact, so a block whose long run grew after
 *     the embed would carry a grant issued for a smaller pair. Nothing in the
 *     composer grows a long run after embedding today, and `_designed_race_
 *     weekend.test.ts` asserts the shipped pair is the granted pair.
 *
 * Cite: Research/00b-recovery-protocols.md §"Hard/Easy Alternation"
 * Cite: Research/00b-recovery-protocols.md §"Recovery by Effort (A vs. B vs. C Race)"
 * Cite: Research/22-plan-templates.md §"Multi-Race Year Planning"
 */

/* ─────────────────────────────────────────────────────────── the constants */

/**
 * Days of easy or rest that must FOLLOW the pair.
 *
 * `Research/00b` §"Hard/Easy Alternation" licenses a stress block only when it
 * is "followed by extended recovery", and §"Recovery by Effort" sizes what a C
 * effort owes: "0-3 days easy". The TOP of the band, on the convention
 * `POST_RACE_PRIORITY_SCALE` already states: a recovery window is a floor on
 * rest, so the least conservative reading is the wrong one to take.
 *
 * The pair is two stressors rather than one, so the window is measured from
 * the LONG RUN, not from the race.
 */
export const EXTENDED_RECOVERY_DAYS_AFTER_PAIR = 3;

/*
 * DETERMINISM (locked 2026-09-02): "given the same meaningful inputs, the
 * generator should produce the same plan."
 *
 * Every gate below compares two measured quantities and none of them is a
 * transient reading: the demonstrated pair is a MAXIMUM over a year of
 * representative days, the demonstrated long run is a maximum over 28
 * representative days, and sustained volume is the 3rd-highest of sixteen
 * 7-day blocks — chosen precisely so one anomalous week cannot move it. None
 * reads a clock, a mood, or a score.
 *
 * WHERE THE OWNER ACTUALLY SITS, measured 2026-09-02, so the margins are a
 * number in the record rather than a hope:
 *
 *   pair          29.4 mi demonstrated vs 24.21 proposed   margin 5.19 mi (21%)
 *   long run      18.0 mi demonstrated, ceiling 19.8 vs 18 proposed   margin 1.8 mi (10%)
 *   sustained     46.4 mi/wk vs 24.21 across the weekend   margin 22.2 mi
 *
 * The long-run gate is the tightest and is worth watching: it binds at 10%,
 * which is doctrine's own spike ratio, so a block that grew his long run past
 * 19.8 mi would refuse the weekend rather than shipping it. That is the
 * correct direction and it is stated so the next reader does not find it by
 * being surprised.
 */

/*
 * NO DECLARED LEVEL. NOT AS A GATE, AND NOT AS A RECORD EITHER.
 *
 * REMOVED IN TWO STEPS, and the second is the one that matters. The first cut
 * of this file GATED the exception on `profile.experience_level` being
 * 'advanced' or 'advanced_plus', reading it as the runner's declared appetite
 * for a stress block. That gate went on 2026-09-02 with the rest of the
 * self-declared experience-level bands: the label is typed at onboarding and
 * measures nothing, and his own row reads `advanced` against a measured best
 * week of 48.5 mi and zero weeks at 50+.
 *
 * But the field stayed on the grant's `evidence` object, unread, "for the
 * account of the decision". He ruled that out too, and named the reason:
 *
 *   "Do not merely stop reading it while continuing to persist it as
 *    purported evidence."
 *
 * A field sitting inside an object called `evidence` ASSERTS AUTHORITY whether
 * or not anything reads it. The next person to touch this code reasonably
 * assumes it counts, and re-gating on it is then a one-line change nobody
 * argues about. So `declaredLevel` and `declaredDaysPerWeek` are gone from the
 * type, from every construction site, and from what is persisted on the
 * placement record. `profile.experience_level` survives as inert profile data
 * the runner can see and edit; it reaches nothing here.
 *
 * The whole test is DEMONSTRATED HISTORY: a combined load he has actually
 * absorbed, a long run he has actually run, volume he actually holds. A label
 * cannot buy this weekend and neither can a confidence score.
 *
 * Enforced by `_declared_level_inert.test.ts`, which composes the same runner
 * at every declared level and with none, and asserts the block is byte-
 * identical — so this paragraph is a check rather than a promise (Rule 20).
 */

/**
 * How far past the runner's demonstrated longest run the second half of the
 * pair may reach.
 *
 * `Research/00a` §"Volume progression rules" states the ratio in one line:
 * ">110% of the longest run in the prior 30 days" carries a 64% injury risk.
 * That is doctrine's own number for "a long run that is too much more than you
 * have done", and it is reused here rather than a new one being invented.
 *
 * THE WINDOW IS DIFFERENT FROM THE SPIKE GUARD'S, ON PURPOSE, and this is the
 * split CLAUDE.md already records for `recentPeakLongMi`. `enforceSpikeRule`
 * asks what the runner's connective tissue has recently ABSORBED and keeps the
 * literal prior-30-day maximum, because the citation writes that window into
 * itself. This asks what he CAN DO, which is a habit question, so it takes the
 * Rule-8-filtered habit reading. The spike guard is untouched and still runs.
 */
export const SPIKE_RATIO_OVER_DEMONSTRATED_LONG = 1.10;

/**
 * How much faster than the prescribed target a finish may be and still be the
 * controlled effort the grant was issued for.
 *
 * CONVENTION, stated as one: it asserts no physiology and therefore carries no
 * doctrine claim. It is the same +/-5% width `RACE_HR_EVIDENCE_PACE_TOLERANCE`
 * (lib/race/race-hr-guidance.ts) already spends for "is this the same
 * intensity", and it exists so watch timing, one downhill mile and an honest
 * finishing kick do not void a grant. Past it, the runner raced.
 */
export const CONTROLLED_EFFORT_PACE_TOLERANCE = 0.05;

const CITE_STRESS_BLOCK =
  'Research/00b-recovery-protocols.md §"Hard/Easy Alternation" (stress block followed by extended recovery)';
const CITE_EFFORT =
  'Research/00b-recovery-protocols.md §"Recovery by Effort (A vs. B vs. C Race)" (C race · treat like a hard workout)';
const CITE_SPIKE =
  'Research/00a-distance-running-training.md §"Volume progression rules" (>110% of the longest run in the prior 30 days)';
const CITE_SERIES =
  'Research/22-plan-templates.md §"Multi-Race Year Planning" · "5K-10K Track / Road Series"';

/* ──────────────────────────────────────────────────────────────── the types */

/**
 * Why the exception was refused. NEVER a boolean and never a zero: a runner
 * with no history, a runner whose history is smaller than the pair, and a
 * runner whose race is not graded C are three different refusals and each
 * needs a different answer from whoever reads it.
 */
export type DesignedWeekendRefusalCode =
  /** The race is not a controlled C effort. His point 1: the grade is
   *  asserted, never assumed. */
  | 'RACE_IS_NOT_A_C_EFFORT'
  /** Nobody stated why this weekend is shaped this way. Doctrine's own
   *  condition ("the plan explicitly calls for"), and his point 7. */
  | 'NO_AUTHORED_PURPOSE'
  /** The following long run carries quality or a paced target. His point 3:
   *  a stress block's second day is volume, not a second workout. */
  | 'LONG_RUN_CARRIES_QUALITY'
  /** The combined-load history could not be read at all. Rule 11: this is not
   *  "he has never done it", it is "I do not know". */
  | 'NO_COMBINED_LOAD_EVIDENCE'
  /** He has a combined-load history and it is smaller than this pair. */
  | 'COMBINED_LOAD_NOT_DEMONSTRATED'
  /** The long-run history could not be read. */
  | 'NO_LONG_RUN_EVIDENCE'
  /** He has a long-run history and it is shorter than this long run. */
  | 'LONG_RUN_NOT_DEMONSTRATED'
  /** Sustained weekly volume could not be read. */
  | 'NO_SUSTAINED_VOLUME_EVIDENCE'
  /** The weekend asks for more than the runner's whole sustained week. */
  | 'PAIR_EXCEEDS_SUSTAINED_WEEK'
  /** Doctrine's second condition is unmet: the days after the pair are not
   *  extended recovery. His point 5. */
  | 'NO_EXTENDED_RECOVERY_AFTER';

export interface DesignedWeekendRefusal {
  code: DesignedWeekendRefusalCode;
  /** Coach voice. Short, direct, and safe to surface as-is. */
  message: string;
  citation: string;
}

/**
 * The athlete-specific evidence. Every field is REQUIRED as an input and
 * nullable as a value, because "not measured" is a fact this file must be able
 * to refuse on by name rather than treat as zero.
 */
export interface DesignedWeekendEvidence {
  /**
   * The largest running total the runner has actually completed across TWO
   * CONSECUTIVE CALENDAR DAYS, in representative training. This is the direct
   * answer to "has he absorbed a comparable combined load", measured on the
   * same axis as the thing being proposed. Null = the read failed or there was
   * no history to read.
   */
  demonstratedPairMi: number | null;
  /** The day the demonstrated pair started, so the record can name it. */
  demonstratedPairFromISO: string | null;
  /**
   * The longest single run in the runner's RECENT HABIT window — 28
   * representative days, Rule 8 filtered by the caller. Null = not measured.
   *
   * RULE 16 · this was called `demonstratedLongMi`, which is the name
   * `ComposePlanInput` already uses for a DIFFERENT quantity: the longest run
   * over a YEAR with races and their prescribed windows excluded. On the
   * owner they read 18.0 and 21.5 — one name, two numbers, and the composer
   * passes the 28-day one in here. Renamed rather than re-pointed, because
   * the 28-day habit read is the right input for "is this long run a spike":
   * `SPIKE_RATIO_OVER_DEMONSTRATED_LONG` cites a prior-30-day window, and a
   * year-wide maximum would license a long run off a distance he ran in
   * March.
   */
  recentHabitLongMi: number | null;
  /** Sustained weekly volume, mi/wk. The robust estimator, not a mean. Null =
   *  not measured. */
  sustainedWeeklyMi: number | null;
}

/** The permission, once granted. Persisted verbatim on the placement record. */
export interface DesignedWeekendGrant {
  raceSlug: string;
  raceName: string;
  raceDateISO: string;
  raceMi: number;
  longDateISO: string;
  longMi: number;
  /** The pair, as ONE transaction. His point 4. */
  combinedMi: number;
  gapDays: number;
  /** The composer's stated purpose, in coach voice. Required input. */
  authoredPurpose: string;
  /** The full sentence the app shows: purpose, then the evidence that
   *  licensed it. His point 7. */
  rationale: string;
  /** The evidence as resolved, so the grant can be audited without re-reading
   *  the database. */
  evidence: DesignedWeekendEvidence;
  /** Days of easy or rest that follow the long run. */
  recoveryDaysAfter: number;
  /** The prescribed pace for the race, s/mi. The premise the grant was issued
   *  under, and what `reassessDesignedWeekend` re-checks. Null when the row
   *  carried no target, which makes the reassessment refuse rather than guess. */
  prescribedRacePaceSec: number | null;
  citation: string;
}

/**
 * MAY THIS PAIRING STAND?
 *
 * The refusal branch carries no `grant`, so a caller cannot read the
 * permission without branching on it.
 */
export type DesignedRaceWeekend =
  | { permitted: true; grant: DesignedWeekendGrant }
  | { permitted: false; refusal: DesignedWeekendRefusal };

export interface DesignedWeekendRequest {
  raceSlug: string;
  raceName: string;
  raceDateISO: string;
  raceMi: number;
  /** The EFFECTIVE grade (`effectiveRecoveryPriority`), never the calendar
   *  letter. His points 1 and 2. */
  effectivePriority: 'A' | 'B' | 'C';
  /** The prescribed pace on the race row, s/mi, or null. */
  prescribedRacePaceSec: number | null;
  longDateISO: string;
  longMi: number;
  /** True when the following long run carries quality, marathon-pace work or
   *  a paced target. A stress block's second day is volume. */
  longCarriesQuality: boolean;
  gapDays: number;
  /** Days of easy or rest AFTER the long run before the next hard day. */
  recoveryDaysAfter: number;
  evidence: DesignedWeekendEvidence;
  /**
   * The composer's stated purpose for this weekend, in coach voice. Null or
   * blank REFUSES: doctrine requires the plan to explicitly call for a stress
   * block, and a purpose nobody wrote is not an explicit call.
   */
  authoredPurpose: string | null;
}

const mi = (v: number): string => (Math.round(v * 100) / 100).toFixed(2).replace(/\.?0+$/, '');

function refuse(
  code: DesignedWeekendRefusalCode,
  message: string,
  citation: string,
): DesignedRaceWeekend {
  return { permitted: false, refusal: { code, message, citation } };
}

/**
 * THE RESOLVER. Every gate below is one of the eight things the runner
 * required, in the order that answers the cheapest question first.
 *
 * There is no permissive fallback anywhere in it. A missing input refuses by
 * name; it never defaults to the aggressive answer (Rule 11), which is the
 * exact failure mode that let `recentQualityPerWeek`'s honest zero become full
 * quality density.
 */
export function resolveDesignedRaceWeekend(req: DesignedWeekendRequest): DesignedRaceWeekend {
  const combinedMi = Math.round((req.raceMi + req.longMi) * 100) / 100;

  // 1 · THE C-EFFORT CHARACTER IS ASSERTED, NOT ASSUMED (his points 1 and 2).
  if (req.effectivePriority !== 'C') {
    return refuse(
      'RACE_IS_NOT_A_C_EFFORT',
      `${req.raceName} is graded a ${req.effectivePriority} effort. A designed weekend is built on a controlled effort, and this one is a race.`,
      CITE_EFFORT,
    );
  }

  // 2 · SOMEBODY STATED WHY. Doctrine's own first condition.
  const purpose = (req.authoredPurpose ?? '').trim();
  if (purpose.length === 0) {
    return refuse(
      'NO_AUTHORED_PURPOSE',
      `Nothing states why ${req.raceName} and the long run the next day belong together. A stress block is authored or it does not happen.`,
      CITE_STRESS_BLOCK,
    );
  }

  // 3 · THE SECOND DAY IS RESTRAINED (his point 3).
  if (req.longCarriesQuality) {
    return refuse(
      'LONG_RUN_CARRIES_QUALITY',
      `The ${mi(req.longMi)}mi run after ${req.raceName} carries quality. The day after a race is volume, run easy, or it is a third stressor.`,
      CITE_STRESS_BLOCK,
    );
  }

  // 4 · HAS HE ABSORBED A COMPARABLE COMBINED LOAD? The pair as ONE
  //     transaction (his point 4), measured on the axis it is proposed on.
  const pair = req.evidence.demonstratedPairMi;
  if (pair == null || !Number.isFinite(pair) || pair <= 0) {
    return refuse(
      'NO_COMBINED_LOAD_EVIDENCE',
      `I cannot read what you have run across two days together, so I cannot put ${mi(combinedMi)}mi across this weekend.`,
      CITE_STRESS_BLOCK,
    );
  }
  if (pair < combinedMi) {
    return refuse(
      'COMBINED_LOAD_NOT_DEMONSTRATED',
      `${mi(combinedMi)}mi across ${req.raceName} and the next day is more than the ${mi(pair)}mi you have run across two days before. That is not a weekend to meet for the first time off a race.`,
      CITE_STRESS_BLOCK,
    );
  }

  // 5 · LONG-RUN HISTORY.
  const long = req.evidence.recentHabitLongMi;
  if (long == null || !Number.isFinite(long) || long <= 0) {
    return refuse(
      'NO_LONG_RUN_EVIDENCE',
      `I cannot read your long-run history, so the ${mi(req.longMi)}mi the day after ${req.raceName} stands on nothing.`,
      CITE_STRESS_BLOCK,
    );
  }
  const longCeiling = long * SPIKE_RATIO_OVER_DEMONSTRATED_LONG;
  if (req.longMi > longCeiling + 1e-9) {
    return refuse(
      'LONG_RUN_NOT_DEMONSTRATED',
      `${mi(req.longMi)}mi is past the ${mi(longCeiling)}mi that ${mi(long)}mi of demonstrated long run supports. ` +
        'The day after a race is not where a new longest run belongs.',
      CITE_SPIKE,
    );
  }

  // 6 · SUSTAINED VOLUME (his point 6, the history half).
  const sustained = req.evidence.sustainedWeeklyMi;
  if (sustained == null || !Number.isFinite(sustained) || sustained <= 0) {
    return refuse(
      'NO_SUSTAINED_VOLUME_EVIDENCE',
      `I cannot read the volume you hold week to week, so I will not put ${mi(combinedMi)}mi into one weekend.`,
      CITE_STRESS_BLOCK,
    );
  }
  if (combinedMi >= sustained) {
    return refuse(
      'PAIR_EXCEEDS_SUSTAINED_WEEK',
      `${mi(combinedMi)}mi across the weekend is your whole ${mi(sustained)}mi week. A stress block sits inside the training, not on top of it.`,
      CITE_STRESS_BLOCK,
    );
  }

  // 7 · DOCTRINE'S SECOND CONDITION: FOLLOWED BY EXTENDED RECOVERY (his
  //     point 5). Measured from the long run, because the pair is the block.
  if (!(req.recoveryDaysAfter >= EXTENDED_RECOVERY_DAYS_AFTER_PAIR)) {
    return refuse(
      'NO_EXTENDED_RECOVERY_AFTER',
      `${req.recoveryDaysAfter} easy day(s) follow the long run. A stress block owes ${EXTENDED_RECOVERY_DAYS_AFTER_PAIR}, and without them it is just two hard days.`,
      CITE_STRESS_BLOCK,
    );
  }

  const evidenceSentence =
    `You have run ${mi(pair)}mi across two days before, your longest run is ${mi(long)}mi, ` +
    `and you hold ${mi(sustained)}mi a week. ${EXTENDED_RECOVERY_DAYS_AFTER_PAIR} easy days follow.`;

  return {
    permitted: true,
    grant: {
      raceSlug: req.raceSlug,
      raceName: req.raceName,
      raceDateISO: req.raceDateISO,
      raceMi: req.raceMi,
      longDateISO: req.longDateISO,
      longMi: req.longMi,
      combinedMi,
      gapDays: req.gapDays,
      authoredPurpose: purpose,
      rationale: `${purpose} ${evidenceSentence}`,
      evidence: req.evidence,
      recoveryDaysAfter: req.recoveryDaysAfter,
      prescribedRacePaceSec: req.prescribedRacePaceSec,
      citation: `${CITE_STRESS_BLOCK} · ${CITE_EFFORT} · ${CITE_SERIES}`,
    },
  };
}

/* ═════════════════════════════════════════════════════════════════════════
 * HIS POINT 8 · IF HE RACES IT HARDER THAN PRESCRIBED, RECOGNISE IT
 *
 *   "If he races the 10K harder than prescribed, the system recognises that
 *    and reassesses the following day rather than blindly preserving the 18
 *    miles."
 *
 * A grant is issued on a PREMISE, and the premise is stated on the grant:
 * this race is run as a controlled C effort, at or near the target on the row.
 * When the finish says otherwise the premise is false, and a permission whose
 * premise is false is void. That is not a threshold on physiology; it is a
 * check of a stated fact against what happened, which is the shape Rule 9
 * asks for when it says a decision must rest on "a discrete honest fact"
 * rather than on a number standing in for a question it cannot ask.
 *
 * THE RESPONSE IS A PROPOSAL, NEVER A REWRITE. `detectDesignedWeekendOverrun`
 * routes through `PROPOSE_FIRST_TRIGGERS`, so what the runner sees is a
 * question about tomorrow, not a plan that changed under him overnight. That
 * is also why the verdict is allowed to be discrete where the authored plan
 * would not be: Rule 9 governs what the composer authors, and a proposal a
 * human accepts or declines is not an authored plan flipping in kind.
 *
 * WHAT THIS CANNOT FAIL ON (Rule 22):
 *   · A race run harder in EFFORT but not in TIME. Heat, a hard course or a
 *     bad day can cost every second the extra effort bought, and this reads
 *     the clock. HR would be the better instrument and is not on this input;
 *     that is a named gap, not an oversight.
 *   · A race the runner never uploaded. `CANNOT_TELL`, by name.
 *   · Whether the reassessed distance is the right one. It is the same
 *     doctrine curve the composer would have applied at the graded effort;
 *     the caller computes it, this states the grade to compute it at.
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * The reassessment. Three outcomes, and only one of them carries numbers, so a
 * caller cannot read an overrun off a read that failed.
 */
export type DesignedWeekendReassessment =
  | {
      verdict: 'PREMISE_HELD';
      /** Fraction faster than the prescribed target. Negative = slower. */
      overrunPct: number;
      message: string;
    }
  | {
      verdict: 'PREMISE_VOID';
      overrunPct: number;
      /** The grade the execution earns. Capped at B: `Research/00b`'s A row
       *  is "Maximum, full taper, peak day", and a tune-up run off full
       *  training has had no taper, so it cannot be an A row however hard it
       *  was run. */
      racedGrade: 'B';
      message: string;
      citation: string;
    }
  | {
      verdict: 'CANNOT_TELL';
      reason: 'no-prescribed-target' | 'no-actual-result';
      message: string;
    };

export function reassessDesignedWeekend(args: {
  grant: Pick<DesignedWeekendGrant, 'raceName' | 'prescribedRacePaceSec' | 'longMi'>;
  /** The finish pace actually run, s/mi. Null when the race has no result. */
  actualRacePaceSec: number | null;
}): DesignedWeekendReassessment {
  const target = args.grant.prescribedRacePaceSec;
  if (target == null || !Number.isFinite(target) || target <= 0) {
    return {
      verdict: 'CANNOT_TELL',
      reason: 'no-prescribed-target',
      message: `${args.grant.raceName} carried no pace target, so I cannot say whether you raced it harder than planned.`,
    };
  }
  const actual = args.actualRacePaceSec;
  if (actual == null || !Number.isFinite(actual) || actual <= 0) {
    return {
      verdict: 'CANNOT_TELL',
      reason: 'no-actual-result',
      message: `No finish for ${args.grant.raceName} yet. Tomorrow's long run stands until there is one.`,
    };
  }

  const overrunPct = (target - actual) / target;
  if (overrunPct <= CONTROLLED_EFFORT_PACE_TOLERANCE) {
    return {
      verdict: 'PREMISE_HELD',
      overrunPct,
      message: `${args.grant.raceName} came in where it was meant to. The long run stands.`,
    };
  }
  return {
    verdict: 'PREMISE_VOID',
    overrunPct,
    racedGrade: 'B',
    message:
      `You ran ${args.grant.raceName} ${Math.round(overrunPct * 100)}% faster than the target it carried. ` +
      `That was a race, not the controlled effort tomorrow's ${mi(args.grant.longMi)}mi was built on. ` +
      'Take the shorter version.',
    citation: CITE_EFFORT,
  };
}
