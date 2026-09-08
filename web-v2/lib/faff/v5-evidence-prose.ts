/**
 * lib/faff/v5-evidence-prose.ts · EVIDENCE USED, written as sentences.
 *
 * ── WHAT WAS WRONG (EVIDENCEPROSE-1, 2026-09-08) ───────────────────────────
 *
 * `detailFor` built the sheet's EVIDENCE USED list by walking
 * `Object.entries(evidence)` and printing `${label}: ${value}` for every key.
 * For the repricing card live on the owner's phone that produced, verbatim:
 *
 *     Block is priced at: 47.8
 *     Evidence came from: run
 *     Confidence in that read: 0.8
 *     Your evidence reads: 47.7
 *     Ends the calibration intro: no
 *
 * His verdict: "the reasoning can be way better right now it's not telling me
 * anything and it's def not in normal type wording and phrasing."
 *
 * He is right twice. It is not English, and it is not information: 47.8 has no
 * unit and no meaning outside a Daniels table the runner has never seen, 0.8
 * has no scale, and a `no` under "Ends the calibration intro" is an engine
 * field with a runner-facing label glued to the front of it. This is
 * `PRODUCT_UX_SIMPLIFICATION_DOCTRINE`'s named mistake — Layer 3 reaching a
 * surface — and better LABELS could not have fixed it, because the defect is
 * the one-line-per-key SHAPE, not the words on the left of the colon.
 *
 * ── THE RULE THIS FILE FOLLOWS ─────────────────────────────────────────────
 *
 * A reader claims the keys it can SPEAK FOR and returns sentences. Anything no
 * reader claims still falls through to the generic renderer in
 * `v5-proposals.ts`, so a shape nobody has taught this file is degraded, never
 * dropped. Readers are ADDITIVE rather than exclusive: `write.ts` stamps
 * `evidence_family` onto every row it inserts while `reanchor-proposal.ts`
 * writes its own blob through a separate INSERT, so one blob can legitimately
 * carry two shapes at once and a switch over "which shape is this" would have
 * silently answered only one of them.
 *
 * ── WHY SOME MEASURED, NON-NULL FACTS ARE DELIBERATELY NOT PRINTED ─────────
 *
 * Rule 17 and the UX doctrine's one test — "only surface information that
 * changes what the runner should understand or do next":
 *
 *   · `planned_type` / `planned_distance_mi` are what SESSIONS AFFECTED is
 *     built from, and that section is drawn immediately ABOVE this one. The
 *     sheet was printing "intervals · 2.5 mi" and then "Session type:
 *     intervals / Session distance: 2.5 mi" underneath it. Same screen, twice.
 *   · `ends_calibration_intro: false` and `priced_before_canonical_layer` say
 *     nothing the runner acts on — the second is the card's own `why`
 *     (`repriceReason`'s canonical-prior branch) restated one tap later.
 *   · a readiness blob's `band` / `tier` / `score` / `forcedByHardRule` /
 *     `sustainedPullBackDays` are model internals, and the same blob's
 *     `headline` already carries the runner-facing statement of them.
 *
 * A claimed-but-silent key is a JUDGEMENT, not a swallowed read, and it is
 * only ever exercised on a key whose value is present and non-null — Rule 11's
 * three facts are resolved before any reader is consulted (see `detailFor`),
 * so a null still reaches MISSING EVIDENCE exactly as it did before.
 *
 * ── AND WHY AN EMPTY EVIDENCE LIST IS THE HONEST ANSWER FOR SOME ROWS ──────
 *
 * Several `detectAdaptations` triggers — shave, reschedule, downgrade — record
 * ONLY `planned_type` and `planned_distance_mi`. Once those are claimed, those
 * rows carry no evidence lines at all and the sheet draws "None recorded on
 * this decision."
 *
 * That is not a regression, it is the finding. This file already held the
 * argument, one section up, about a different key: `planned_date` was excluded
 * because "a date is not evidence anyway: it is where the evidence applies."
 * The type and the distance of the session are the same thing — they identify
 * the SUBJECT of the decision, not the measurement behind it. A row that
 * recorded only its subject recorded no evidence, and saying so plainly is
 * worth more than three lines restating the session named directly above.
 * Those triggers not writing a reading is a real gap, and Rule 11 says a
 * surface built to explain a decision should show it rather than dress it.
 *
 * ── WHAT THIS FILE CANNOT FAIL ON (Rule 22) ────────────────────────────────
 *
 *   · IT CANNOT TELL YOU THE SENTENCE IS TRUE. Every claim here is gated on
 *     the key it describes (Rule 16), but nothing checks that the engine put
 *     an honest number in that key.
 *   · IT CANNOT GRADE TONE. `scripts/check-coach-voice.sh` scans
 *     `web-v2/lib/faff` and owns the banned registers; a clean sentence in
 *     words nobody listed still reads as clean.
 *   · IT CANNOT SEE A SHAPE IT WAS NOT TAUGHT. An unknown blob falls back to
 *     the generic renderer, which is a worse line and not a missing one.
 */
import { fmtMi } from '@/lib/format/run';
import { SELF_HEAL_REANCHOR_DELTA } from '@/lib/training/pace-anchor';
import { CAPACITY_CONFIDENCE_BANDS } from '@/lib/training/capacity-resolver';
import type { EvidenceFamily } from '@/lib/brain/proposal/evidence-facet';

export interface EvidenceProse {
  /** Sentences, in reading order. May be empty when every key was claimed and
   *  silent — which is a real answer, not a failure. */
  readonly sentences: string[];
  /** Keys this module has answered for. The generic renderer must not print
   *  them again, whether or not a sentence came out. */
  readonly spokenFor: ReadonlySet<string>;
}

/**
 * What the caller knows that the blob does not.
 *
 * `sessionNamedElsewhere` is true when `affectedFrom` will draw the planned
 * session in SESSIONS AFFECTED off these same two keys — which it does for
 * every action kind except a repricing carrying its own payload. Passed in
 * rather than re-derived here, so there is one answer to "does that row get
 * drawn" and it lives with the function that draws it (Rule 16).
 */
export interface EvidenceProseContext {
  readonly sessionNamedElsewhere: boolean;
}

/**
 * Turn what a trigger recorded into what a coach would say about it.
 *
 * Only ever handed keys whose value is present and non-null.
 */
export function evidenceProse(
  ev: Readonly<Record<string, unknown>>,
  ctx: EvidenceProseContext,
): EvidenceProse {
  const sentences: string[] = [];
  const spokenFor = new Set<string>();

  // Order is reading order, most concrete first: what was measured about the
  // runner, then what was measured about the session, then which part of the
  // engine weighed it.
  repriceRead(ev, sentences, spokenFor);
  fieldTestRead(ev, sentences, spokenFor);
  readinessRead(ev, sentences, spokenFor);
  sessionRead(ev, ctx, sentences, spokenFor);
  familyRead(ev, sentences, spokenFor);

  return { sentences, spokenFor };
}

/**
 * A better line for a key the engine looked for and did not find.
 *
 * The MISSING EVIDENCE section had the same defect as EVIDENCE USED and a
 * worse excuse: it printed the SAME engine labels, so a runner read "Threshold
 * HR anchor age, days" as a thing that was missing. A missing-evidence row is
 * a noun phrase naming what nobody could measure, not a column header.
 *
 * Returns null for a key with no better wording, and the caller keeps its
 * existing label — degraded, not dropped.
 */
export function missingEvidenceLabel(key: string): string | null {
  return MISSING_LABELS[key] ?? null;
}

const MISSING_LABELS: Readonly<Record<string, string>> = {
  lthr_age_days: 'How long ago your threshold heart rate was set',
  lthr_stale: 'Whether your threshold heart rate is still current',
  days_since_test: 'How long since your fitness was last measured directly',
  weekly_mi: 'What you have been running each week',
  long_mi: 'How long your longest recent run was',
  planned_type: 'What kind of session this day holds',
  planned_distance_mi: 'How far this day was set to be',
  anchor_vdot_now: 'The fitness this block was priced at',
  anchor_vdot_proposed: 'What your evidence reads now',
  evidence_source: 'Whether this came from a race or from training',
  anchor_confidence: 'How firmly that read is held',
  anchor_source: 'How your fitness is known',
};

// ── the repricing read ──────────────────────────────────────────────────────
//
// Written by `reanchor-plan.ts`'s three arms through `writeReanchorProposal`.
// The race-prep and maintenance arms write anchor_vdot_now /
// anchor_vdot_proposed / evidence_source / anchor_confidence /
// ends_calibration_intro; the canonical-prior arm writes anchor_source /
// anchor_confidence / priced_before_canonical_layer.

function repriceRead(
  ev: Readonly<Record<string, unknown>>,
  out: string[],
  spokenFor: Set<string>,
): void {
  const source = stringOrNull(ev.evidence_source);
  const anchorSource = stringOrNull(ev.anchor_source);
  const confidence = numberOrNull(ev.anchor_confidence);
  const pricedAt = numberOrNull(ev.anchor_vdot_now);
  const readsNow = numberOrNull(ev.anchor_vdot_proposed);
  const endsCalibration = booleanOrNull(ev.ends_calibration_intro);
  const pricedBefore = booleanOrNull(ev.priced_before_canonical_layer);

  const provenance = source != null
    ? SOURCE_PHRASE[source] ?? null
    : anchorSource != null ? ANCHOR_SOURCE_PHRASE[anchorSource] ?? null : null;

  if (provenance != null) {
    if (source != null) spokenFor.add('evidence_source');
    else spokenFor.add('anchor_source');
  }

  // Provenance and certainty are one sentence because they are one thought:
  // where the number came from, and how much weight it will carry. Split into
  // two lines they read as two findings.
  if (provenance != null && confidence != null) {
    spokenFor.add('anchor_confidence');
    out.push(`The read comes from ${provenance}, and it is held with `
      + `${anchorConfidenceBand(confidence)} confidence.`);
  } else if (provenance != null) {
    out.push(`The read comes from ${provenance}.`);
  } else if (confidence != null) {
    spokenFor.add('anchor_confidence');
    out.push(`This read is held with ${anchorConfidenceBand(confidence)} confidence.`);
  }

  /* THE FITNESS MOVE, WITHOUT INVENTING A SECOND THRESHOLD PACE.
   *
   * The obvious rendering — convert both anchors to a pace and print them — is
   * the CIM three-projections defect (Rule 16) waiting to happen. The card's
   * own `why` already states a threshold pace, and it states the one derived
   * from `pricedAnchors` / `liveAnchors`; this pair is the SEASON ANCHOR, a
   * different quantity that would land within a second or two of it and be
   * labelled the same way. One screen, two numbers, one name.
   *
   * So the pair is spent on the only thing it can answer alone: whether the
   * runner's fitness has actually moved. The band is the engine's own
   * `SELF_HEAL_REANCHOR_DELTA` — the distance at which this very self-heal
   * considers a fitness read to have moved enough to matter — rather than a
   * number invented here, so the sentence and the mechanism cannot drift.
   *
   * ── EVIDENCEPROSE-2 (2026-09-08) · THE PAIR MEANS SOMETHING ELSE WHEN ────
   * ── THE CALIBRATION IS ENDING, AND SAYING IT THE OLD WAY WAS FALSE ───────
   *
   * These two facts used to be emitted as two independent sentences. On a
   * calibration-ending repricing whose delta sat inside the band, one sheet
   * carried both, in this order:
   *
   *     "Your fitness reads level with what this block was priced at. This is
   *      not a fitness change: the paces the block is written at have drifted
   *      from what your evidence now supports."
   *     "This ends the opening calibration. The block stops running on an
   *      estimate of your fitness and starts running on what you have actually
   *      run."
   *
   * The first says nothing changed. The second says the whole basis of the
   * number just changed. Found by independent review, and NOT a rare edge:
   * six of the seven live plans on 2026-09-08 carry
   * `season_anchor_provisional: true`, and `shouldReanchorRacePrep` returns
   * true for a provisional anchor REGARDLESS of the delta — so both
   * conditions holding at once is the ordinary shape of the most consequential
   * repricing a new runner ever sees.
   *
   * WHAT DECIDES THE FIX IS THAT THE FIRST SENTENCE WAS ALSO UNTRUE THERE.
   * `ends_calibration_intro` is written as `wasProvisional` (race-prep arm)
   * and `anchorSource !== 'measured_run'` (maintenance arm). Both mean exactly
   * one thing: THE `anchor_vdot_now` SIDE IS NOT A MEASUREMENT. It is a
   * `user_prior` or a mileage guess, and `paceBlendAnchorIsProvisional` exists
   * precisely so that three readers refuse to believe it as fitness. So there
   * was no prior fitness read for fitness to be "level with", and "this is not
   * a fitness change" asserts a comparison with no left-hand side.
   *
   * So when the calibration is ending the pair answers a different question,
   * and the two facts are ordered into one thought: the calibration first,
   * because it is what makes the comparison legible, then where the first real
   * measurement landed against THE ESTIMATE IT REPLACES — never against "the
   * fitness this block was priced at", which that estimate never was. Both
   * true, complementary rather than competing, and each said once (Rule 17).
   */
  if (endsCalibration != null) spokenFor.add('ends_calibration_intro');
  const calibrationEnding = endsCalibration === true;

  if (calibrationEnding) {
    out.push('This ends the opening calibration. The block stops running on an estimate '
      + 'of your fitness and starts running on what you have actually run.');
  }

  if (pricedAt != null && readsNow != null) {
    spokenFor.add('anchor_vdot_now');
    spokenFor.add('anchor_vdot_proposed');
    const delta = readsNow - pricedAt;
    const level = Math.abs(delta) < SELF_HEAL_REANCHOR_DELTA;
    if (calibrationEnding) {
      // The before-side is an estimate, so this states where the FIRST real
      // measurement landed against it. It never calls that estimate a fitness
      // read, and it never claims fitness did or did not move.
      out.push(level
        ? 'What you have run lands level with the estimate it replaces.'
        : delta > 0
          ? 'What you have run reads ahead of the estimate it replaces.'
          : 'What you have run reads behind the estimate it replaces.');
    } else if (level) {
      // A repricing row cannot exist unless at least one anchor moved:
      // `writeReanchorProposal` answers `unchanged` when "every anchor lands
      // on the same second per mile". So the second clause is gated on the
      // row's own existence, not assumed.
      out.push('Your fitness reads level with what this block was priced at. '
        + 'This is not a fitness change: the paces the block is written at have drifted '
        + 'from what your evidence now supports.');
    } else if (delta > 0) {
      out.push('Your evidence now reads ahead of the fitness this block was priced at.');
    } else {
      out.push('Your evidence now reads behind the fitness this block was priced at.');
    }
  }

  // Claimed and silent: the canonical-prior card's `why` opens with exactly
  // this fact ("This block was priced before the canonical pace layer read
  // your history"), one tap earlier.
  if (pricedBefore != null) spokenFor.add('priced_before_canonical_layer');
}

/** `ReanchorEvidence.source` is 'race' | 'run' | null. */
const SOURCE_PHRASE: Readonly<Record<string, string>> = {
  race: 'a race result',
  run: 'your own recent training, not from a race',
};

/** `SourceMode`, verbatim the six rungs `capacity-resolver.ts` names. */
const ANCHOR_SOURCE_PHRASE: Readonly<Record<string, string>> = {
  direct: 'your own recent training, corroborated across sessions',
  inferred: 'a pace you have shown at another effort, converted across',
  race_derived: 'a race result',
  vdot_fallback: 'an equivalent effort at another distance',
  user_prior: 'what you told the app about yourself, with nothing run against it yet',
  population_prior: 'nothing of yours yet, so it starts from what is typical',
};

/**
 * Three words over `CapacityEstimateBase.confidence`.
 *
 * The edges are `CAPACITY_CONFIDENCE_BANDS`' own, because that is where this
 * number's scale is defined and the bands there do not overlap by
 * construction: direct evidence occupies [0.50 .. 0.90], any derived fallback
 * [0.20 .. 0.50], a population prior 0.10. Reusing them means "high" here
 * means the same thing as "direct" there.
 *
 * NOT `activity-evidence.ts`'s `CONFIDENCE_HIGH_MIN` / `CONFIDENCE_MODERATE_MIN`,
 * which its own header scopes to "a single-activity physiological read". Same
 * word, different quantity, different scale (Rule 16).
 */
function anchorConfidenceBand(confidence: number): 'high' | 'moderate' | 'low' {
  if (confidence >= CAPACITY_CONFIDENCE_BANDS.fallbackCeiling) return 'high';
  if (confidence >= CAPACITY_CONFIDENCE_BANDS.fallbackFloor) return 'moderate';
  return 'low';
}

// ── the field-test read ─────────────────────────────────────────────────────
//
// Written by `adapt.ts`'s `detectFieldTestDue`.

function fieldTestRead(
  ev: Readonly<Record<string, unknown>>,
  out: string[],
  spokenFor: Set<string>,
): void {
  const stale = booleanOrNull(ev.lthr_stale);
  const ageDays = numberOrNull(ev.lthr_age_days);
  const daysSinceTest = numberOrNull(ev.days_since_test);
  const weeklyMi = numberOrNull(ev.weekly_mi);
  const longMi = numberOrNull(ev.long_mi);

  if (stale != null) {
    spokenFor.add('lthr_stale');
    if (stale) {
      // The card's `why` already says the anchor is out of date and by how
      // much. What it does not say is that this session would fix it, which is
      // the part that decides whether the swap is worth taking.
      out.push('The same test would reset your threshold heart rate, which is also out of date.');
      if (ageDays != null) spokenFor.add('lthr_age_days');
    } else if (ageDays != null) {
      spokenFor.add('lthr_age_days');
      out.push(`Your threshold heart rate was set ${days(ageDays)} ago and is still current.`);
    } else {
      out.push('Your threshold heart rate reading is still current.');
    }
  }

  if (daysSinceTest != null) {
    spokenFor.add('days_since_test');
    out.push(`Nothing has measured your fitness directly in ${days(daysSinceTest)}.`);
  }

  // `fmtMi` returns null for a literal 0 by design ("zero is not a
  // distance" — see its own doc comment), which a naive `!= null` check on
  // the RAW number doesn't catch: `weeklyMi = 0` passes `!= null` and then
  // interpolates as the literal word "null" into the sentence. Found by
  // independent review (2026-09-08), unreached by any current production
  // blob but exactly the leak class this file exists to close. Branch on
  // the FORMATTED value, not the raw one, so a genuine zero is treated the
  // same as a genuinely absent reading — spoken for nothing, claimed as
  // nothing.
  // `fmtMi` returns null for a literal 0 by design ("zero is not a
  // distance" — see its own doc comment), which a naive `!= null` check on
  // the RAW number doesn't catch: `weeklyMi = 0` passes `!= null` and then
  // interpolates as the literal word "null" into the sentence. Found by
  // independent review (2026-09-08), unreached by any current production
  // blob but exactly the leak class this file exists to close. Branch on
  // the FORMATTED value, not the raw one, so a genuine zero is treated the
  // same as a genuinely absent reading — spoken for nothing, claimed as
  // nothing.
  const weeklyFmt = fmtMi(weeklyMi);
  const longFmt = fmtMi(longMi);
  if (weeklyFmt != null && longFmt != null) {
    spokenFor.add('weekly_mi');
    spokenFor.add('long_mi');
    out.push(`You are running ${weeklyFmt} a week, with a longest run of ${longFmt}.`);
  } else if (weeklyFmt != null) {
    spokenFor.add('weekly_mi');
    out.push(`You are running ${weeklyFmt} a week.`);
  } else if (longFmt != null) {
    spokenFor.add('long_mi');
    out.push(`Your longest recent run is ${longFmt}.`);
  }
}

// ── the readiness read ──────────────────────────────────────────────────────
//
// `detectAdaptations`' readiness pull-back writes the whole readiness rollup.
// `headline` is already the runner-facing statement of it; everything beside
// it is the model that produced the headline, and `streaks` is an ARRAY, which
// the generic renderer would have printed as raw JSON on a phone.

function readinessRead(
  ev: Readonly<Record<string, unknown>>,
  out: string[],
  spokenFor: Set<string>,
): void {
  const headline = stringOrNull(ev.headline);
  if (headline == null) return;
  spokenFor.add('headline');
  for (const k of READINESS_MODEL_KEYS) {
    if (ev[k] !== undefined && ev[k] !== null) spokenFor.add(k);
  }
  // Kept verbatim. It is composed prose from the readiness owner, and
  // paraphrasing it here would be a second answer to one question (Rule 16).
  out.push(headline.endsWith('.') ? headline : `${headline}.`);
}

const READINESS_MODEL_KEYS = [
  'band', 'tier', 'score', 'streaks', 'forcedByHardRule', 'sustainedPullBackDays',
] as const;

// ── the planned session ─────────────────────────────────────────────────────

function sessionRead(
  ev: Readonly<Record<string, unknown>>,
  ctx: EvidenceProseContext,
  _out: string[],
  spokenFor: Set<string>,
): void {
  if (!ctx.sessionNamedElsewhere) return;
  // Claimed and silent. SESSIONS AFFECTED is drawn from these two keys and
  // sits directly above EVIDENCE USED on the same sheet.
  if (ev.planned_type != null) spokenFor.add('planned_type');
  if (ev.planned_distance_mi != null) spokenFor.add('planned_distance_mi');
}

// ── which reader weighed it ─────────────────────────────────────────────────

function familyRead(
  ev: Readonly<Record<string, unknown>>,
  out: string[],
  spokenFor: Set<string>,
): void {
  const family = stringOrNull(ev.evidence_family);
  if (family == null) return;
  const sentence = FAMILY_PHRASE[family as EvidenceFamily];
  if (sentence == null) return;   // an unlisted family degrades to the generic line
  spokenFor.add('evidence_family');
  out.push(sentence);
}

/**
 * `EvidenceFamily` in the runner's language.
 *
 * Typed as a total record so a new family fails to COMPILE rather than
 * reaching the phone as `Evidence family: NEW_THING`. This is not a second
 * copy of `EVIDENCE_REGISTRY`'s `measures`: that field describes what one KIND
 * reads and is written for the completeness gate's report, this one describes
 * what a FAMILY is and is written for a runner.
 */
const FAMILY_PHRASE: Readonly<Record<EvidenceFamily, string>> = {
  PACE_ANCHOR: 'Weighed against the paces your training currently supports.',
  PROGRESSION_GATE: 'Weighed by the progression check, which asks whether the next step up '
    + 'has been earned yet.',
  DETECTION_PASS: 'Found by the nightly pass over your training: gaps, overshoot, readiness '
    + 'and how your hard days are spaced.',
  VOLUME_EVIDENCE: 'Weighed against the volume you actually absorbed, not the volume that '
    + 'was asked for.',
  SAFETY_VERDICT: 'This is the safety read. Nothing else overrides it.',
  AUTHORITY_SEAM: 'Nothing was changed for you. This one needs your answer first.',
  RUNNER_STATED: 'You said so. Nothing was measured here.',
  EARNING_GATE: 'Held against what would earn it, with the readings taken on the date below.',
};

// ── small pieces ────────────────────────────────────────────────────────────

function stringOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function numberOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function booleanOrNull(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

function days(n: number): string {
  const whole = Math.round(n);
  return whole === 1 ? '1 day' : `${whole} days`;
}
