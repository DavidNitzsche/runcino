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
 * ── EVIDENCE-HONESTY-1 (2026-09-02) · THE GRANT'S SENTENCE WAS FALSE IN SHAPE
 *
 * The weekend is KEPT. What was wrong was what the app told him about why it
 * is safe. The grant said, in his own account:
 *
 *   "You have run 29.4mi across two days before."
 *
 * Measured against production, that pair is 2026-04-25 (2.61 mi shakeout) and
 * 2026-04-26 (26.81 mi, the Big Sur Marathon). A short shakeout followed by a
 * MARATHON. The prescription is the opposite arrangement — a hard-ish 10K
 * followed by a long run — and every other large two-day block in his history
 * runs big day first, small day second:
 *
 *   02-15  20.00 + 02-16  7.85 = 27.85     04-05  20.02 + 04-06  7.51 = 27.53
 *   02-08  17.21 + 02-09  5.35 = 22.56     07-12  12.60 + 07-13  9.09 = 21.69
 *
 * The number was real and the query was correct. The SHAPE was not evidence
 * for the demand being made, and this is the one place the exception was
 * supposed to be athlete-specific, so a misleading sentence here is worse than
 * no sentence at all.
 *
 * His ruling, verbatim:
 *
 *   "Keep the controlled Dodgers 10K plus next-day long-run weekend. I
 *    knowingly accept its aggressive nature. However, do not claim my
 *    29.4-mile historical pair demonstrates this specific demand... Represent
 *    the decision honestly: the combined volume is supported by prior large
 *    weekends; the specific hard-short-first, long-second arrangement is novel
 *    in my recorded history; I explicitly authorized that aggressive
 *    exception; the 10K is prescribed as controlled; the following long run is
 *    restrained appropriately; the surrounding days provide recovery; no
 *    automatic next-day mutation occurs. Persist the exception as an
 *    owner-authorized, evidence-informed novel demand — not as a previously
 *    demonstrated identical pattern."
 *
 * WHAT CHANGED HERE. Two claims that were sharing one field are now two
 * fields, with two different types that a caller cannot substitute for one
 * another (their `evidenceOf` brands differ, so TypeScript rejects the swap):
 *
 *   · `pairVolume`  — COMBINED TWO-DAY VOLUME. Genuinely demonstrated, and it
 *                     now EXCLUDES race days, the way `demonstratedLongMi`
 *                     already excludes them for the block's long-run ceiling.
 *                     A pair whose second day is a marathon is not evidence
 *                     about training. His honest number is 27.85 mi from
 *                     2026-02-15, not 29.4 from 2026-04-25, and 27.85 still
 *                     clears the 24.21 mi this weekend asks for.
 *   · `pairOrdering` — THE ARRANGEMENT. COMPUTED, never asserted, by
 *                     `resolvePairOrderingEvidence`. Measured over his last
 *                     365 days: 11 pairs begin with a hard effort, and the
 *                     longest run he has ever done the morning after one is
 *                     9.01 mi. Not one reaches the 18 proposed. The
 *                     arrangement is NOVEL, and the app now says so.
 *
 * ORDERING IS NARRATED, NOT GATED. A novel arrangement does not refuse this
 * weekend — the owner authorised it knowingly and that authorisation is the
 * licence, not a pattern match. What ordering evidence buys is an honest
 * sentence. Gating on it would overturn his ruling by the back door.
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
 *   · WHETHER THE EVIDENCE IS TRUE. It grades the day readings it is handed.
 *     If a caller supplies days measured over a contaminated window (Rule 8),
 *     this file cannot tell and will grant on them. The window is the caller's
 *     obligation and `loadGeneratorInputs` discharges it through
 *     `eligibleDaysBack`. What this file DOES own, since EVIDENCE-HONESTY-1,
 *     is which of those days may be cited for which claim: race days are
 *     dropped from the volume reading here, not upstream.
 *   · A HARD DAY IT CANNOT SEE. `resolvePairOrderingEvidence` grades the
 *     `wasHardEffort` marker it is given. On this runner 62 of 149 days in the
 *     window are Strava-era rows carrying only `type: 'Run'`, which is not a
 *     workout grade, so a hard session among them reads as not-hard and the
 *     ordering answer is conservative in the NOVEL direction. When NO day in
 *     the window carries a readable marker the answer is UNDETERMINED by name,
 *     never NOVEL — "I could not tell" and "he has not done it" are two facts
 *     (Rule 11).
 *   · WHETHER THE ARRANGEMENT IS SAFE. Ordering evidence is narrated, not
 *     gated, so a NOVEL answer neither refuses the weekend nor shrinks it. It
 *     changes one sentence. If a future reader wants novelty to bind, that is
 *     a ruling to get from the owner, not a threshold to add here.
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
 *   pair volume   27.85 mi demonstrated vs 24.21 proposed  margin 3.64 mi (15%)
 *   long run      18.0 mi demonstrated, ceiling 19.8 vs 18 proposed   margin 1.8 mi (10%)
 *   sustained     46.4 mi/wk vs 24.21 across the weekend   margin 22.2 mi
 *   ordering      NOVEL · 11 hard-first pairs, longest second day 9.01 mi
 *
 * The pair-volume row READ 29.4 until EVIDENCE-HONESTY-1. That number came
 * from 2.61 mi + the Big Sur Marathon and has been dropped: race days no
 * longer enter the volume reading, so the citable pair is 27.85 mi from
 * 2026-02-15 (20.00 + 7.85), which is training. The margin narrows from 21% to
 * 15% and the weekend still stands, which is the point — the honest number was
 * always sufficient and the misleading one bought nothing.
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

/**
 * THE CEILING ON THE SECOND DAY OF A DESIGNED WEEKEND.
 *
 * OWNER RULING, 2026-09-02, and it carries NO `Research/` anchor because it
 * asserts no physiology — it is a coaching decision about this weekend, and
 * saying so plainly is Rule 7's own distinction (a constant that asserts
 * physiology needs a registry claim; one that records a ruling needs a
 * citation to the ruling). The same posture `CONTROLLED_EFFORT_PACE_TOLERANCE`
 * above already takes.
 *
 * His words on the Sunday: "16-17 miles", "easy throughout", "no marathon-pace
 * finish, no progression finish", purpose "durable time on feet after a
 * controlled prior-day effort". The grant had been issued for 18.
 *
 * 17 is the TOP of his stated band, on the same read-the-top convention
 * `EXTENDED_RECOVERY_DAYS_AFTER_PAIR` takes for the 0-3 row. Reading the
 * bottom would be inventing a further reduction he did not ask for.
 *
 * It sits alongside the wider block thesis he ruled in the same pass —
 * consistency as the primary constraint, durability as the marathon-specific
 * development priority, and "prefer repeatable weeks in the low-to-mid 50s
 * over touching 60 and then collapsing." A 17-mile easy Sunday serves that; an
 * 18 with a fast finish does not.
 */
export const DESIGNED_WEEKEND_LONG_CAP_MI = 17;

const CITE_STRESS_BLOCK =
  'Research/00b-recovery-protocols.md §"Hard/Easy Alternation" (stress block followed by extended recovery)';
const CITE_EFFORT =
  'Research/00b-recovery-protocols.md §"Recovery by Effort (A vs. B vs. C Race)" (C race · treat like a hard workout)';
const CITE_SPIKE =
  'Research/00a-distance-running-training.md §"Volume progression rules" (>110% of the longest run in the prior 30 days)';
const CITE_SERIES =
  'Research/22-plan-templates.md §"Multi-Race Year Planning" · "5K-10K Track / Road Series"';
/**
 * NOT a `Research/` citation, and it says so. The cap and the Sunday restraint
 * conditions are the owner's coaching decision about this weekend, not a
 * physiological finding, so citing a doctrine file for them would be a false
 * anchor of exactly the kind Rule 18 warns about.
 */
const CITE_OWNER_RULING =
  'Owner ruling 2026-09-02 · designed race weekend · "16-17 miles, easy throughout, '
  + 'no marathon-pace finish, no progression finish"';

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
  /** The long run carries a progression or fast-finish structure. His ruling
   *  2026-09-02 names this separately from quality because a plain
   *  `isQuality` flag does not catch it: a long run graded easy can still be
   *  authored to finish fast, and "easy throughout" is what he asked for. */
  | 'LONG_RUN_CARRIES_PROGRESSION_FINISH'
  /** The long run carries a marathon-pace segment. Same ruling, same reason:
   *  "no marathon-pace finish." */
  | 'LONG_RUN_CARRIES_MARATHON_PACE'
  /** The long run is longer than a designed weekend's second day may be.
   *  Carries the cap, so the composer can author to it rather than guess. */
  | 'LONG_RUN_EXCEEDS_DESIGNED_CAP'
  /** The combined-load history could not be read at all. Rule 11: this is not
   *  "he has never done it", it is "I do not know". */
  | 'NO_COMBINED_LOAD_EVIDENCE'
  /** The history read fine and holds no two-day training pair to cite — a
   *  runner who never runs on consecutive days, or one whose only big pairs
   *  are races. EVIDENCE-HONESTY-1 split this out of the code above, because
   *  Rule 11's third state is exactly this one: the read SUCCEEDED and found
   *  nothing, which is a different fact from the read failing. */
  | 'NO_TRAINING_PAIR_FOUND'
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

/* ─────────────────────────────── the two-day history, and the two facts in it */

/**
 * ONE DAY OF THE RUNNER'S OWN HISTORY, as the caller read it.
 *
 * The caller supplies only days that are already Rule 8 eligible — taper
 * lead-ins and post-race recovery windows filtered out — and this file decides
 * which of them may be cited for which claim. That split is deliberate: the
 * WINDOW is one question (whose owner is `normal-window.ts` via the caller)
 * and WHAT A DAY IS EVIDENCE OF is another, and the second one is what
 * EVIDENCE-HONESTY-1 got wrong.
 *
 * Days need not be contiguous or sorted. Consecutiveness is derived from
 * `dateISO`, so a day the caller's window excluded simply forms no pair, which
 * is the same behaviour the old SQL had and is now stated once here.
 */
export interface HistoricalDayReading {
  /** `YYYY-MM-DD`. */
  dateISO: string;
  /** Total miles run that day, across every canonical row on it. */
  mi: number;
  /**
   * True when a race was run that day. `races` is the authority (CLAUDE.md
   * §Race-data source-of-truth), never a guess off distance.
   */
  wasRace: boolean;
  /**
   * True when the day carried a HARD EFFORT — a race, or a run the runner's
   * own row grades tempo / threshold / intervals.
   *
   * NULL means NO MARKER WAS READABLE for that day, which is a third fact and
   * not a `false` (Rule 11). Strava-era rows carry `type: 'Run'` and no workout
   * grade; 62 of this runner's 149 days in the window are like that. A window
   * in which NO day carries a marker cannot answer the ordering question at
   * all, and `resolvePairOrderingEvidence` says UNDETERMINED rather than
   * reporting a novelty it did not measure.
   */
  wasHardEffort: boolean | null;
}

/**
 * CLAIM ONE · COMBINED TWO-DAY VOLUME. "Has he absorbed this much across two
 * days?" Genuinely demonstrated, and the gate the grant is issued on.
 *
 * RACE DAYS ARE NOT IN IT. `demonstratedLongMi` already excludes them from the
 * block's long-run ceiling for the same reason, stated in its own comment: a
 * race is not a training long run. The pair that made this rule necessary was
 * 2.61 mi plus the Big Sur Marathon.
 *
 * The `evidenceOf` brand is not decoration. It is what stops this value being
 * passed where `PairOrderingEvidence` is expected: the two unions have no
 * member in common, so the substitution that produced the false sentence does
 * not type-check any more (Rule 20 — the rule is the check, not the comment).
 */
export type PairVolumeEvidence =
  | {
      evidenceOf: 'two-day-volume';
      kind: 'DEMONSTRATED';
      combinedMi: number;
      fromISO: string;
      toISO: string;
      firstDayMi: number;
      secondDayMi: number;
    }
  /** The history read fine and holds no citable training pair. */
  | { evidenceOf: 'two-day-volume'; kind: 'NONE_FOUND' }
  /** The read itself failed, or the caller supplied nothing. */
  | { evidenceOf: 'two-day-volume'; kind: 'READ_FAILED' };

/**
 * CLAIM TWO · THE ARRANGEMENT. "Has he run a hard effort and then gone long
 * the next morning?" A different question from claim one, on a different axis,
 * and on this runner the two answers disagree — which is precisely why they
 * may not share a field.
 *
 * NARRATED, NOT GATED. Nothing in `resolveDesignedRaceWeekend` refuses on
 * this. It selects which sentence the runner reads.
 */
export type PairOrderingEvidence =
  | {
      evidenceOf: 'hard-then-long-ordering';
      kind: 'DEMONSTRATED';
      hardDayISO: string;
      hardDayMi: number;
      longDayISO: string;
      longDayMi: number;
    }
  | {
      evidenceOf: 'hard-then-long-ordering';
      kind: 'NOVEL';
      /** How many hard-effort-first pairs the window held at all. Zero and
       *  eleven are different stories and the sentence tells them apart. */
      hardFirstPairsSeen: number;
      /** The nearest he has come: the longest second day after a hard first
       *  day. Null when `hardFirstPairsSeen` is 0. */
      closestHardDayISO: string | null;
      closestHardDayMi: number | null;
      closestLongDayMi: number | null;
    }
  | {
      evidenceOf: 'hard-then-long-ordering';
      kind: 'UNDETERMINED';
      reason: 'read-failed' | 'no-history' | 'no-hard-effort-marker';
    };

/**
 * The athlete-specific evidence. Every field is REQUIRED as an input, because
 * "not measured" is a fact this file must be able to refuse on by name rather
 * than treat as zero.
 *
 * EVIDENCE-HONESTY-1 · `demonstratedPairMi` / `demonstratedPairFromISO` are
 * GONE, replaced by `pairVolume` and `pairOrdering`. Two scalars carrying one
 * claim became two typed unions carrying two, because the grant was spending
 * the volume number as though it settled the arrangement. A caller cannot make
 * that mistake again without the compiler saying so.
 */
export interface DesignedWeekendEvidence {
  /** What he has absorbed across two days, races excluded. The GATE. */
  pairVolume: PairVolumeEvidence;
  /** Whether he has ever run hard and then long the next morning. NARRATED. */
  pairOrdering: PairOrderingEvidence;
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
  /** True when the following long run carries quality or a paced target. A
   *  stress block's second day is volume. */
  longCarriesQuality: boolean;
  /**
   * True when the long run is authored to finish fast — a progression lever,
   * a fast-finish or a cut-down structure.
   *
   * REQUIRED, not optional-defaulting-to-false. An unstated restraint is not a
   * restraint, and a caller that cannot answer must say `true` and be refused
   * rather than have the aggressive answer assumed for it (Rule 11, and
   * Invariant 11 of the simplification doctrine: missing data may not silently
   * produce a more aggressive plan).
   */
  longCarriesProgressionFinish: boolean;
  /** True when the long run carries a marathon-pace segment. Required, for the
   *  same reason as the field above. */
  longCarriesMarathonPaceFinish: boolean;
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

/** Next calendar day, on the ISO string. No clock, no timezone. */
function nextDayISO(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

/**
 * CLAIM ONE, COMPUTED · the heaviest two-consecutive-day total in the runner's
 * own TRAINING.
 *
 * RACE DAYS ARE DROPPED FROM BOTH HALVES. Not the day after a race — the
 * caller's Rule 8 window already owns that — but the race day itself, on the
 * same reasoning `demonstratedLongMi` states for the long-run ceiling: a race
 * is not training, and a pair whose second day is a marathon is not evidence
 * about what this runner absorbs in a training week. On the owner that moves
 * the citable number from 29.4 mi (2.61 + Big Sur) to 27.85 mi (20.00 + 7.85,
 * 2026-02-15), which still clears the 24.21 this weekend asks for.
 *
 * `null` days is a FAILED READ and is not the same as an empty array, which is
 * a runner with no eligible history. Three states, three answers (Rule 11).
 */
export function resolvePairVolumeEvidence(
  days: readonly HistoricalDayReading[] | null,
): PairVolumeEvidence {
  if (days == null) return { evidenceOf: 'two-day-volume', kind: 'READ_FAILED' };
  const byDay = new Map<string, HistoricalDayReading>();
  for (const d of days) {
    if (d.wasRace) continue;                     // a race day is not training
    if (!Number.isFinite(d.mi) || d.mi <= 0) continue;
    byDay.set(d.dateISO, d);
  }
  let best: PairVolumeEvidence | null = null;
  let bestMi = 0;
  for (const [iso, first] of byDay) {
    const second = byDay.get(nextDayISO(iso));
    if (second == null) continue;
    const total = round2(first.mi + second.mi);
    if (best != null && total <= bestMi) continue;
    bestMi = total;
    best = {
      evidenceOf: 'two-day-volume',
      kind: 'DEMONSTRATED',
      combinedMi: total,
      fromISO: iso,
      toISO: second.dateISO,
      firstDayMi: round2(first.mi),
      secondDayMi: round2(second.mi),
    };
  }
  return best ?? { evidenceOf: 'two-day-volume', kind: 'NONE_FOUND' };
}

/**
 * CLAIM TWO, COMPUTED · has he ever run a hard effort and then gone long the
 * next morning?
 *
 * THE PREDICATE, and why it is this one. The proposal is a hard day followed
 * by a long run of `proposedLongMi`. So a historical pair DEMONSTRATES it when
 * the first day was a hard effort AND the second day was at least as long as
 * the one being proposed. Two measured facts, `>=` against the actual
 * proposal, no tolerance fraction and therefore no threshold to relocate
 * (Rule 9) — the same shape gate 4 already uses for volume.
 *
 * It does NOT require the first day to be shorter than the second. A hard
 * 20-miler followed by an 18 is a larger demand than the one proposed, not a
 * smaller one, and refusing to count it would understate his history in the
 * direction of claiming more novelty than is true.
 *
 * RACE DAYS COUNT HERE, and that is not in tension with dropping them from the
 * volume reading. The question is about ARRANGEMENT, and a race is the
 * canonical hard first day — the thing being proposed has one in it. What is
 * being asked is "has this shape happened", not "how much training has he
 * absorbed", and the two questions want different rows. That divergence is the
 * whole reason these are two fields.
 *
 * Measured on the owner over 365 eligible days: 11 pairs open with a hard
 * effort, and the longest second day among them is 9.01 mi (2026-07-15, after
 * an 8.02 mi tempo). None reaches 18. NOVEL, computed, not asserted.
 */
export function resolvePairOrderingEvidence(
  days: readonly HistoricalDayReading[] | null,
  proposedLongMi: number,
): PairOrderingEvidence {
  const undetermined = (
    reason: 'read-failed' | 'no-history' | 'no-hard-effort-marker',
  ): PairOrderingEvidence => ({
    evidenceOf: 'hard-then-long-ordering', kind: 'UNDETERMINED', reason,
  });
  if (days == null) return undetermined('read-failed');
  if (days.length < 2) return undetermined('no-history');
  // A window in which NOTHING carries a hard-effort grade cannot answer this.
  // Reporting NOVEL off a signal nobody had is the exact bug EVIDENCE-HONESTY-1
  // exists to stop, in the opposite direction.
  if (!days.some((d) => d.wasHardEffort != null || d.wasRace)) {
    return undetermined('no-hard-effort-marker');
  }
  const byDay = new Map<string, HistoricalDayReading>();
  for (const d of days) {
    if (!Number.isFinite(d.mi) || d.mi <= 0) continue;
    byDay.set(d.dateISO, d);
  }
  let seen = 0;
  let closest: { iso: string; hardMi: number; longMi: number } | null = null;
  for (const [iso, first] of byDay) {
    if (!(first.wasHardEffort === true || first.wasRace)) continue;
    const second = byDay.get(nextDayISO(iso));
    if (second == null) continue;
    seen += 1;
    if (second.mi + 1e-9 >= proposedLongMi) {
      return {
        evidenceOf: 'hard-then-long-ordering',
        kind: 'DEMONSTRATED',
        hardDayISO: iso,
        hardDayMi: round2(first.mi),
        longDayISO: second.dateISO,
        longDayMi: round2(second.mi),
      };
    }
    if (closest == null || second.mi > closest.longMi) {
      closest = { iso, hardMi: round2(first.mi), longMi: round2(second.mi) };
    }
  }
  return {
    evidenceOf: 'hard-then-long-ordering',
    kind: 'NOVEL',
    hardFirstPairsSeen: seen,
    closestHardDayISO: closest?.iso ?? null,
    closestHardDayMi: closest?.hardMi ?? null,
    closestLongDayMi: closest?.longMi ?? null,
  };
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

  // 3 · THE SECOND DAY IS RESTRAINED (his point 3, and his 2026-09-02 ruling
  //     that "easy throughout" means all three of these, not just the first).
  //     THREE CODES, NOT ONE. A long run graded easy can still be authored to
  //     finish fast, so `isQuality` alone does not answer this and collapsing
  //     the three into one refusal would tell whoever reads it the wrong thing
  //     to fix (Rule 11 at the refusal layer).
  if (req.longCarriesQuality) {
    return refuse(
      'LONG_RUN_CARRIES_QUALITY',
      `The ${mi(req.longMi)}mi run after ${req.raceName} carries quality. The day after a race is volume, run easy, or it is a third stressor.`,
      CITE_STRESS_BLOCK,
    );
  }
  if (req.longCarriesProgressionFinish) {
    return refuse(
      'LONG_RUN_CARRIES_PROGRESSION_FINISH',
      `The ${mi(req.longMi)}mi run after ${req.raceName} is authored to finish fast. This one is easy the whole way or it is a second workout.`,
      CITE_STRESS_BLOCK,
    );
  }
  if (req.longCarriesMarathonPaceFinish) {
    return refuse(
      'LONG_RUN_CARRIES_MARATHON_PACE',
      `The ${mi(req.longMi)}mi run after ${req.raceName} carries marathon pace. Durable time on feet is the point of it, not a second quality session.`,
      CITE_STRESS_BLOCK,
    );
  }

  // 4 · THE CEILING ON THE SECOND DAY. His ruling: 16-17 miles, not 18.
  //     The refusal names the cap so the composer can author to it rather than
  //     fall all the way back onto the return-to-long curve, which would cut
  //     far below what he asked for.
  if (req.longMi > DESIGNED_WEEKEND_LONG_CAP_MI + 1e-9) {
    return refuse(
      'LONG_RUN_EXCEEDS_DESIGNED_CAP',
      `${mi(req.longMi)}mi the morning after ${req.raceName} is past the ${mi(DESIGNED_WEEKEND_LONG_CAP_MI)}mi a designed weekend's second day carries. Take the time on feet, not the extra miles.`,
      CITE_OWNER_RULING,
    );
  }

  // 5 · HAS HE ABSORBED A COMPARABLE COMBINED LOAD? The pair as ONE
  //     transaction (his point 4), measured on the axis it is proposed on.
  //
  //     EVIDENCE-HONESTY-1 · THIS GATE READS `pairVolume` AND NOTHING ELSE.
  //     It is a VOLUME question and it is answered with volume evidence. The
  //     ordering evidence sits one field over and is deliberately not consulted
  //     here: a novel arrangement does not refuse this weekend, because the
  //     owner authorised the arrangement knowingly and that authorisation is
  //     the licence. What ordering buys is the sentence, further down.
  const vol = req.evidence.pairVolume;
  if (vol.kind === 'READ_FAILED') {
    return refuse(
      'NO_COMBINED_LOAD_EVIDENCE',
      `I cannot read what you have run across two days together, so I cannot put ${mi(combinedMi)}mi across this weekend.`,
      CITE_STRESS_BLOCK,
    );
  }
  if (vol.kind === 'NONE_FOUND') {
    return refuse(
      'NO_TRAINING_PAIR_FOUND',
      `You have no two training days back to back for me to measure this against, so ${mi(combinedMi)}mi across one weekend is not a step I can take.`,
      CITE_STRESS_BLOCK,
    );
  }
  if (vol.combinedMi < combinedMi) {
    return refuse(
      'COMBINED_LOAD_NOT_DEMONSTRATED',
      `${mi(combinedMi)}mi across ${req.raceName} and the next day is more than the ${mi(vol.combinedMi)}mi you have run across two days of training before. That is not a weekend to meet for the first time off a race.`,
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

  /*
   * EVIDENCE-HONESTY-1 · THE SENTENCE THE RUNNER ACTUALLY READS.
   *
   * The old one was a single clause — "You have run 29.4mi across two days
   * before" — and it was false in shape: that pair was a 2.61 mi shakeout
   * followed by a marathon, which is the opposite arrangement to the one being
   * prescribed. His instruction is that the record state SEVEN things, so this
   * states seven and no more, once each (Rule 17):
   *
   *   1 the combined volume is supported by prior large weekends
   *   2 the hard-first, long-second arrangement is novel in his history
   *   3 he authorised the exception explicitly
   *   4 the race is prescribed as a controlled effort
   *   5 the long run that follows is restrained
   *   6 the surrounding days provide recovery
   *   7 no automatic next-day mutation occurs
   *
   * NO PACE OR HR NUMBER APPEARS HERE, on purpose. `race-outlook.ts` is the
   * canonical owner of how a controlled C effort is priced, and a second
   * sentence naming a pace would be a second answer to that question
   * (Constitution: one question, one owner; Rule 16). This states the INTENT
   * the grant was issued under, which is what the grant actually owns.
   */
  const orderingSentence = ((): string => {
    const ord = req.evidence.pairOrdering;
    if (ord.kind === 'DEMONSTRATED') {
      return `You have run this shape before: ${mi(ord.longDayMi)}mi on ${ord.longDayISO}, `
        + `the morning after a hard ${mi(ord.hardDayMi)}mi.`;
    }
    if (ord.kind === 'UNDETERMINED') {
      return 'I cannot tell from your history whether you have run long the morning after a hard '
        + 'effort before, so I am not claiming you have.';
    }
    if (ord.hardFirstPairsSeen === 0 || ord.closestLongDayMi == null) {
      return 'Running long the morning after a hard effort is new for you. Your history has no '
        + 'hard day with a run the next morning at all.';
    }
    return 'Running long the morning after a hard effort is new for you. The furthest you have '
      + `gone the day after a hard one is ${mi(ord.closestLongDayMi)}mi.`;
  })();

  const evidenceSentence =
    `${mi(combinedMi)}mi across the weekend sits inside the ${mi(vol.combinedMi)}mi you have `
    + `already run across two days of training, on ${vol.fromISO}. `
    + `${orderingSentence} `
    + 'You asked for this weekend knowing it is aggressive, and I have kept it. '
    + `${req.raceName} is prescribed as a controlled effort, not a race. `
    + `The ${mi(req.longMi)}mi that follows is easy the whole way and inside the ${mi(long)}mi `
    + `you already run long, and ${req.recoveryDaysAfter} easy days follow it. `
    + 'Nothing changes that long run on its own. If you run '
    + `${req.raceName} materially harder than it is prescribed, I will say so and leave the call `
    + 'to you.';

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
 * And, narrowing it on 2026-09-02: the system "may advise reconsideration if
 * Saturday is executed materially harder than prescribed, but it must not
 * automatically mutate Sunday's plan." Advise, record, and stop.
 *
 * A grant is issued on a PREMISE, and the premise is stated on the grant:
 * this race is run as a controlled C effort, at or near the target on the row.
 * When the finish says otherwise the premise is false, and a permission whose
 * premise is false is void. That is not a threshold on physiology; it is a
 * check of a stated fact against what happened, which is the shape Rule 9
 * asks for when it says a decision must rest on "a discrete honest fact"
 * rather than on a number standing in for a question it cannot ask.
 *
 * THE RESPONSE IS AN ADVISORY, NEVER A REWRITE. `detectDesignedWeekendOverrun`
 * emits a `note`, which writes a `coach_intents` row and changes no plan row —
 * and `DESIGNEDWEEKEND-1` is deliberately ABSENT from `PROPOSE_FIRST_TRIGGERS`
 * for that reason, because routing a note through the proposal queue would
 * create a proposal path with nothing behind it. What the runner sees is a
 * comparison; the long run on his plan is untouched either way. That is also
 * why the verdict is allowed to be discrete where the authored plan would not
 * be: Rule 9 governs what the composer authors, and an observation a human
 * acts on or ignores is not an authored plan flipping in kind.
 *
 * (This paragraph previously claimed the detector "routes through
 * `PROPOSE_FIRST_TRIGGERS`". It does not, and never did — `adapt.ts` states
 * the opposite in the set's own comment. A header asserting an invariant
 * nothing checks is the failure Rule 20's corollary names, so it is corrected
 * rather than left to be believed.)
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
    /*
     * ADVISORY, AND THE WORDING HAS TO SAY SO.
     *
     * This read "Take the shorter version.", which is an instruction, and it
     * was printed directly above `adapt.ts`'s own line saying the long run is
     * unchanged. One surface telling him to take a shorter run and the next
     * telling him nothing changed is a Rule 16 contradiction in two adjacent
     * sentences, and the owner's ruling is explicit: the system "may advise
     * reconsideration if Saturday is executed materially harder than
     * prescribed, but it must not automatically mutate Sunday's plan."
     *
     * So it names the fact and hands him the decision. Nothing here changes a
     * plan row, and now nothing here reads as though it did.
     */
    message:
      `You ran ${args.grant.raceName} ${Math.round(overrunPct * 100)}% faster than the target it carried. ` +
      `That was a race, not the controlled effort tomorrow's ${mi(args.grant.longMi)}mi was built on. ` +
      'It is worth reconsidering the distance. The long run stands unless you change it.',
    citation: CITE_EFFORT,
  };
}
