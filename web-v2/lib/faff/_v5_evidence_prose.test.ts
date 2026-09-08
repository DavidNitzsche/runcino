/**
 * lib/faff/_v5_evidence_prose.test.ts · EVIDENCEPROSE-1.
 *
 * ── WHAT THIS PROVES ───────────────────────────────────────────────────────
 *
 * Every blob below is COPIED OUT OF PRODUCTION, byte for byte, from
 * `plan_workout_proposals` on 2026-09-08 — rows 12, 7, 11 and 5. **Only 12 and
 * 5 belong to the owner's own account** (uuid `0645f40c-…`); row 7 belongs to
 * `bcefea06-…` and row 11 to `606bcc38-…` — real production blobs from other
 * accounts, kept because they're real production shapes worth having, not
 * because they're his. Only row 12 was PENDING on his phone the evening he
 * said "the reasoning can be way better right now it's not telling me
 * anything and it's def not in normal type wording and phrasing." His OTHER
 * pending row that evening was id 10, which is not in this corpus — a
 * materially identical blob belonging to someone else is here instead.
 * Corrected 2026-09-08 by independent review (Rule 14 — the sibling
 * `_v5_proposal_harness_fixture.test.ts` already got this right: "Two of
 * them belong to accounts that are not the owner's, which is itself a
 * finding worth keeping").
 *
 * Rule 15 is the reason they are copied rather than invented: a corpus of made
 * up blobs reaches whichever branches its author remembered, and the shape
 * that actually shipped is the one nobody thought of. Rule 13 is the reason
 * this is not the whole verification — a passing assertion here says the
 * strings are right, and only a screenshot says the runner can read them.
 *
 * ── WHAT IT CANNOT FAIL ON (Rule 22) ───────────────────────────────────────
 *
 *   · IT CANNOT FAIL ON THE SENTENCE BEING GOOD. It pins the shape and the
 *     absence of the field dump; a reviewer's ear is the only thing that can
 *     grade the prose, and `check-coach-voice.sh` is the only thing that can
 *     grade the register.
 *   · IT CANNOT FAIL ON A SHAPE PRODUCTION HAS NOT WRITTEN YET. Four blobs is
 *     every distinct shape in the table as of this date, not every shape the
 *     engine could produce.
 *   · IT CANNOT SEE THE CARD. `why` lives on the card and this sheet is a
 *     different screen; the Rule 17 arguments in `v5-evidence-prose.ts` about
 *     not restating it are arguments, and no assertion here checks them.
 */
import { describe, it, expect } from 'vitest';
import { detailFor } from '@/lib/faff/v5-proposals';
import { evidenceProse, missingEvidenceLabel } from '@/lib/faff/v5-evidence-prose';
import type { PendingProposal } from '@/lib/plan/workout-proposals';

/** `plan_workout_proposals` id 12 · pending, `reprice`, 2026-09-08. */
const REAL_REPRICE_EVIDENCE = {
  anchor_vdot_now: 47.8,
  evidence_source: 'run',
  anchor_confidence: 0.8081792830507429,
  anchor_vdot_proposed: 47.7,
  ends_calibration_intro: false,
} as const;

/** `plan_workout_proposals` id 7 · pending, `field_test`, 2026-09-02. */
const REAL_FIELD_TEST_EVIDENCE = {
  citation: 'Research/01-pace-zones-vdot.md §"Testing cadence" + §"Field test protocols"',
  lthr_stale: false,
  workout_id: 'wko_9ea09c32abe20459',
  planned_date: '2026-09-09',
  planned_type: 'intervals',
  lthr_age_days: null,
  planned_distance_mi: 2.5,
} as const;

/** `plan_workout_proposals` id 11 · pending, `hold`, 2026-09-08. */
const REAL_HOLD_EVIDENCE = {
  planned_type: 'long',
  evidence_family: 'PROGRESSION_GATE',
  planned_distance_mi: 19,
} as const;

/** `plan_workout_proposals` id 5 · `downgrade` off a readiness pull-back. */
const REAL_READINESS_EVIDENCE = {
  band: 'pull-back',
  tier: 'advanced',
  score: 44,
  streaks: [{ days: 5, pillar: 'hrv', direction: 'below' }],
  headline: "HRV below for 5 days · The trend matters more than today's number.",
  forcedByHardRule: false,
  sustainedPullBackDays: 0,
} as const;

/** The exact lines the old renderer produced for id 12. */
const THE_OLD_FIELD_DUMP = [
  'Block is priced at: 47.8',
  'Evidence came from: run',
  'Confidence in that read: 0.8',
  'Your evidence reads: 47.7',
  'Ends the calibration intro: no',
];

function proposal(over: Partial<PendingProposal>): PendingProposal {
  return {
    id: 12, userUuid: 'u', planWorkoutId: 'wko_1', workoutDateISO: '2026-09-10',
    actionKind: 'reprice', actionPayload: {}, reason: 'a stated reason',
    evidence: {}, status: 'pending', createdAt: '2026-09-08T07:00:00Z',
    ...over,
  } as PendingProposal;
}

const ctx = { sessionNamedElsewhere: true };

describe("EVIDENCEPROSE-1 · the owner's own repricing reads as English", () => {
  const p = proposal({
    actionKind: 'reprice',
    actionPayload: { reprice: { workoutsAffected: 76, workoutsSealed: 0 } as never },
    evidence: { ...REAL_REPRICE_EVIDENCE },
  });

  it('says where the read came from and how firmly it is held, in one sentence', () => {
    const used = detailFor(p).evidenceUsed ?? [];
    expect(used).toContain(
      'The read comes from your own recent training, not from a race, and it is held with '
      + 'high confidence.',
    );
  });

  it('spends the two fitness numbers on whether fitness MOVED, never on a second pace', () => {
    // 47.8 → 47.7 is inside `SELF_HEAL_REANCHOR_DELTA`, which is the engine's
    // own statement of "far enough to be a fitness change". Converting either
    // number to a threshold pace would put a second "your threshold is X" on a
    // screen whose card already carries one (Rule 16).
    const used = detailFor(p).evidenceUsed ?? [];
    expect(used).toContain(
      'Your fitness reads level with what this block was priced at. This is not a fitness '
      + 'change: the paces the block is written at have drifted from what your evidence now '
      + 'supports.',
    );
    expect(used.join(' ')).not.toMatch(/47\.[78]/);
    expect(used.join(' ')).not.toMatch(/\b\d:\d\d\b/);
  });

  it('is TWO sentences, not five key-value lines', () => {
    const used = detailFor(p).evidenceUsed ?? [];
    expect(used).toHaveLength(2);
    // Every line ends a sentence and none of them is `label: value` — that
    // shape is a short phrase, a colon, and then the line stops.
    for (const line of used) {
      expect(line).toMatch(/\.$/);
      expect(line).not.toMatch(/^[^.:]{1,45}: \S{1,12}$/);
      expect(line.split(/\s+/).length).toBeGreaterThan(7);
    }
  });

  it('THE FALSIFIER · the old mechanical rendering is gone, line for line', () => {
    const used = detailFor(p).evidenceUsed ?? [];
    for (const dead of THE_OLD_FIELD_DUMP) expect(used).not.toContain(dead);
  });

  it('says nothing about a calibration that is not ending', () => {
    // `ends_calibration_intro: false` is measured, present and non-null, and
    // it changes nothing the runner does. Claimed and silent, never printed as
    // "Ends the calibration intro: no".
    const used = (detailFor(p).evidenceUsed ?? []).join(' ');
    expect(used).not.toMatch(/calibration/i);
    // And it is not misfiled as MISSING either: the engine looked and answered.
    expect((detailFor(p).missingEvidence ?? []).join(' ')).not.toMatch(/calibration/i);
  });

  it('says so when the calibration IS ending', () => {
    const q = proposal({
      actionKind: 'reprice',
      actionPayload: { reprice: { workoutsAffected: 76 } as never },
      evidence: { ...REAL_REPRICE_EVIDENCE, ends_calibration_intro: true },
    });
    expect((detailFor(q).evidenceUsed ?? []).join(' '))
      .toContain('This ends the opening calibration.');
  });

  it('reads a real move as ahead or behind, and only outside the engine\'s own band', () => {
    const ahead = evidenceProse(
      { ...REAL_REPRICE_EVIDENCE, anchor_vdot_proposed: 50.4 }, ctx).sentences.join(' ');
    expect(ahead).toContain('ahead of the fitness this block was priced at');
    const behind = evidenceProse(
      { ...REAL_REPRICE_EVIDENCE, anchor_vdot_proposed: 45.1 }, ctx).sentences.join(' ');
    expect(behind).toContain('behind the fitness this block was priced at');
  });

  it('names the rung when the canonical-prior arm wrote one instead', () => {
    // That arm's blob: anchor_source + anchor_confidence +
    // priced_before_canonical_layer. The last is the card's own `why`, one tap
    // earlier, so it is claimed and silent.
    const s = evidenceProse({
      anchor_source: 'population_prior',
      anchor_confidence: 0.1,
      priced_before_canonical_layer: true,
    }, ctx);
    expect(s.sentences).toEqual([
      'The read comes from nothing of yours yet, so it starts from what is typical, and it '
      + 'is held with low confidence.',
    ]);
    expect(s.spokenFor.has('priced_before_canonical_layer')).toBe(true);
  });
});

/**
 * EVIDENCEPROSE-2 · the calibration-ending repricing.
 *
 * ── WHERE THIS BLOB COMES FROM, HONESTLY ───────────────────────────────────
 *
 * It is SYNTHESISED, and that is stated rather than hidden: as of 2026-09-08
 * exactly one row in `plan_workout_proposals` carries `ends_calibration_intro`
 * at all (id 12, and it is `false`), so there is no production blob with this
 * shape to copy. Rule 13 · this is the honest substitute, not a claim of real
 * data.
 *
 * What IS real is every number in it, and the reason the shape matters:
 *
 *   · 39.9 is `authored_state.pace_blend.season_anchor_vdot` on the live plan
 *     `pln_2684dabde181e595` (`user_uuid` bcefea06-…, the same account the
 *     field-test blob above belongs to), whose anchor is
 *     `season_anchor_source: 'user_prior'`, `season_anchor_provisional: true`.
 *   · SIX of the SEVEN non-archived plans on that date carry
 *     `season_anchor_provisional: true` — every account but the owner's.
 *     `shouldReanchorRacePrep` returns true for a provisional anchor BEFORE it
 *     looks at any delta, and `reanchorRacePrep` writes
 *     `ends_calibration_intro: wasProvisional`. So a repricing on any of those
 *     six carries `true` here whatever the measurement says.
 *   · 0.808… is the real `anchor_confidence` from row 12.
 *
 * ── WHAT IT CANNOT FAIL ON (Rule 22) ───────────────────────────────────────
 *
 *   · IT CANNOT FAIL ON THE REPLACEMENT SENTENCES BEING GOOD. It proves the
 *     two claims no longer contradict and that the surviving ones are true of
 *     the blob; a reviewer's ear still owns whether they read well.
 *   · IT CANNOT SEE THE CARD's `why`, which is a different screen.
 *   · IT CANNOT PROVE THE ENGINE SET `ends_calibration_intro` HONESTLY. It
 *     tests what the sheet says given the flag, not whether the flag is right.
 */
const REAL_PROVISIONAL_ANCHOR_VDOT = 39.9;

/** What `reanchorRacePrep` writes for `pln_2684dabde181e595` when the first
 *  real measurement lands inside `SELF_HEAL_REANCHOR_DELTA` of the guess. */
const CALIBRATION_ENDING_EVIDENCE = {
  anchor_vdot_now: REAL_PROVISIONAL_ANCHOR_VDOT,
  evidence_source: 'run',
  anchor_confidence: 0.8081792830507429,
  anchor_vdot_proposed: 39.0,          // |Δ| = 0.9, inside the 2.0 band
  ends_calibration_intro: true,
} as const;

/** The two sentences that used to land together, verbatim. */
const THE_CONTRADICTION = {
  notAFitnessChange:
    'Your fitness reads level with what this block was priced at. This is not a fitness '
    + 'change: the paces the block is written at have drifted from what your evidence now '
    + 'supports.',
  endsCalibration:
    'This ends the opening calibration. The block stops running on an estimate of your '
    + 'fitness and starts running on what you have actually run.',
};

describe('EVIDENCEPROSE-2 · a calibration-ending repricing does not argue with itself', () => {
  const p = proposal({
    actionKind: 'reprice',
    actionPayload: { reprice: { workoutsAffected: 76, workoutsSealed: 0 } as never },
    evidence: { ...CALIBRATION_ENDING_EVIDENCE },
  });

  it('THE FALSIFIER · never says "not a fitness change" beside "ends the calibration"', () => {
    // Before the fix these two were both pushed, in this order. Restore the
    // old `repriceRead` and this single assertion goes red on the first line.
    const used = detailFor(p).evidenceUsed ?? [];
    expect(used).toContain(THE_CONTRADICTION.endsCalibration);
    expect(used).not.toContain(THE_CONTRADICTION.notAFitnessChange);
    // And not in any looser form either: the false claim is the COMPARISON,
    // so nothing on this sheet may call the estimate a fitness reading.
    const joined = used.join(' ');
    expect(joined).not.toMatch(/not a fitness change/i);
    expect(joined).not.toMatch(/fitness this block was priced at/i);
    expect(joined).not.toMatch(/fitness reads level with/i);
  });

  it('states where the first real measurement landed, against THE ESTIMATE', () => {
    // The honest reading of `ends_calibration_intro: true`: the before-side is
    // a `user_prior`, which `paceBlendAnchorIsProvisional` exists to stop
    // three readers believing as fitness. So the pair is spent on the
    // estimate, never on a fitness that was never measured.
    expect(detailFor(p).evidenceUsed).toContain(
      'What you have run lands level with the estimate it replaces.',
    );
  });

  it('orders the calibration fact FIRST, so the comparison has a frame', () => {
    const used = detailFor(p).evidenceUsed ?? [];
    const calibration = used.indexOf(THE_CONTRADICTION.endsCalibration);
    const landed = used.indexOf('What you have run lands level with the estimate it replaces.');
    expect(calibration).toBeGreaterThan(-1);
    expect(landed).toBeGreaterThan(calibration);
  });

  it('is three sentences and still spends both anchors on no second pace', () => {
    const used = detailFor(p).evidenceUsed ?? [];
    expect(used).toHaveLength(3);
    expect(used.join(' ')).not.toMatch(/39\.\d/);
    expect(used.join(' ')).not.toMatch(/\b\d:\d\d\b/);
    for (const line of used) expect(line).toMatch(/\.$/);
  });

  it('claims both anchor keys and the flag, so none is dumped again below', () => {
    const s = evidenceProse({ ...CALIBRATION_ENDING_EVIDENCE }, ctx);
    for (const k of ['anchor_vdot_now', 'anchor_vdot_proposed', 'ends_calibration_intro']) {
      expect(s.spokenFor.has(k)).toBe(true);
    }
  });

  it('reads a real move against the estimate when the delta is OUTSIDE the band', () => {
    const ahead = evidenceProse(
      { ...CALIBRATION_ENDING_EVIDENCE, anchor_vdot_proposed: 42.6 }, ctx).sentences;
    expect(ahead).toContain('What you have run reads ahead of the estimate it replaces.');
    const behind = evidenceProse(
      { ...CALIBRATION_ENDING_EVIDENCE, anchor_vdot_proposed: 37.0 }, ctx).sentences;
    expect(behind).toContain('What you have run reads behind the estimate it replaces.');
    // Same rule as inside the band: an estimate is never named as fitness.
    for (const set of [ahead, behind]) {
      expect(set.join(' ')).not.toMatch(/fitness this block was priced at/i);
    }
  });

  it('CONDITION ALONE · calibration ending with no anchor pair still says so', () => {
    const s = evidenceProse({ ends_calibration_intro: true }, ctx);
    expect(s.sentences).toEqual([THE_CONTRADICTION.endsCalibration]);
  });

  it('CONDITION ALONE · a delta inside the band with NO calibration is unchanged', () => {
    // The regression guard. `REAL_REPRICE_EVIDENCE` is the owner's own row 12
    // (`ends_calibration_intro: false`), where the before-side IS a measured
    // anchor and "this is not a fitness change" is the true statement.
    const s = evidenceProse({ ...REAL_REPRICE_EVIDENCE }, ctx);
    expect(s.sentences).toContain(THE_CONTRADICTION.notAFitnessChange);
    expect(s.sentences.join(' ')).not.toMatch(/calibration/i);
  });
});

describe('EVIDENCEPROSE-1 · the field-test blob', () => {
  const p = proposal({
    id: 7, actionKind: 'field_test', workoutDateISO: '2026-09-09',
    evidence: { ...REAL_FIELD_TEST_EVIDENCE },
  });

  it('says the one thing the card does not, and stops', () => {
    expect(detailFor(p).evidenceUsed).toEqual([
      'Your threshold heart rate reading is still current.',
    ]);
  });

  it('does not reprint the session SESSIONS AFFECTED already names (Rule 17)', () => {
    const d = detailFor(p);
    // The two sections are drawn one above the other on the same sheet.
    expect(d.affectedWorkouts).toEqual([
      { dateISO: '2026-09-09', what: 'intervals · 2.5 mi' },
    ]);
    const used = (d.evidenceUsed ?? []).join(' ');
    expect(used).not.toContain('Session type');
    expect(used).not.toContain('Session distance');
    expect(used).not.toContain('intervals');
  });

  it('keeps Rule 11 · a null-valued key is still MISSING, in better words', () => {
    // `lthr_age_days: null` — the engine looked and could not answer.
    expect(detailFor(p).missingEvidence)
      .toContain('How long ago your threshold heart rate was set');
    expect(detailFor(p).missingEvidence).not.toContain('Threshold HR anchor age, days');
  });

  it('still never leaks the citation or the row id', () => {
    const used = (detailFor(p).evidenceUsed ?? []).join(' ');
    expect(used).not.toMatch(/Research\//);
    expect(used).not.toMatch(/wko_/);
  });

  it('names the age when the anchor is current and the age IS known', () => {
    const s = evidenceProse({ lthr_stale: false, lthr_age_days: 31 }, ctx);
    expect(s.sentences).toEqual([
      'Your threshold heart rate was set 31 days ago and is still current.',
    ]);
  });

  it('when the anchor IS stale, says what the test would do about it', () => {
    const s = evidenceProse({ lthr_stale: true, lthr_age_days: 96 }, ctx);
    expect(s.sentences).toEqual([
      'The same test would reset your threshold heart rate, which is also out of date.',
    ]);
  });
});

describe('EVIDENCEPROSE-1 · the shapes that were dumping engine words', () => {
  it('a progression-gate hold names the check, not the taxonomy', () => {
    const p = proposal({
      id: 11, actionKind: 'hold', workoutDateISO: '2026-09-13',
      evidence: { ...REAL_HOLD_EVIDENCE },
    });
    expect(detailFor(p).evidenceUsed).toEqual([
      'Weighed by the progression check, which asks whether the next step up has been earned yet.',
    ]);
    expect((detailFor(p).evidenceUsed ?? []).join(' ')).not.toContain('PROGRESSION_GATE');
  });

  it('a readiness pull-back keeps its headline and drops the model behind it', () => {
    const p = proposal({
      id: 5, actionKind: 'downgrade', actionPayload: { newType: 'easy' },
      evidence: { ...REAL_READINESS_EVIDENCE },
    });
    const used = detailFor(p).evidenceUsed ?? [];
    expect(used).toEqual([
      "HRV below for 5 days · The trend matters more than today's number.",
    ]);
    // The defect this closes: `streaks` is an ARRAY, and the old renderer
    // ended `JSON.stringify(v)`.
    expect(used.join(' ')).not.toContain('{');
    expect(used.join(' ')).not.toMatch(/Score: 44|Band: pull-back|Tier: advanced/);
  });

  it('a row that recorded only its SUBJECT reports no evidence, and means it', () => {
    // `detectAdaptations`' shave / reschedule / downgrade triggers write only
    // the session's type and distance. Those identify what the decision is
    // ABOUT; they are not a measurement, and the sheet draws `[]` as "None
    // recorded on this decision." — which is true of these triggers and worth
    // seeing. Same argument the file already makes for `planned_date`.
    const p = proposal({
      actionKind: 'shave', actionPayload: { shaveFraction: 0.17 },
      evidence: { planned_type: 'long run', planned_distance_mi: 18 },
    });
    const d = detailFor(p);
    expect(d.evidenceUsed).toEqual([]);
    // Rule 11 · `[]` and `null` are different lines on the sheet, and this is
    // the empty one, not the unrecorded one.
    expect(d.evidenceUsed).not.toBeNull();
    // The two keys are not lost. They are drawn once, above.
    expect(d.affectedWorkouts).toEqual([
      { dateISO: '2026-09-10', what: 'long run · 18 mi' },
    ]);
  });

  it('an unknown key still reaches the runner, degraded rather than dropped', () => {
    const p = proposal({ evidence: { some_future_reading: 12 } });
    expect(detailFor(p).evidenceUsed).toEqual(['Some future reading: 12']);
  });

  it('an unknown key with no readable rendering is withheld, not stringified', () => {
    const p = proposal({ evidence: { some_future_reading: [{ a: 1 }] } });
    expect(detailFor(p).evidenceUsed).toEqual([]);
  });
});

describe('EVIDENCEPROSE-1 · the module contract', () => {
  it('claims no key it was not given', () => {
    const s = evidenceProse({}, ctx);
    expect(s.sentences).toEqual([]);
    expect(s.spokenFor.size).toBe(0);
  });

  it('leaves the planned session alone when SESSIONS AFFECTED will not name it', () => {
    // A repricing carrying its own payload names a COUNT of sessions instead,
    // so these keys would be unspoken for anywhere and must fall through.
    const s = evidenceProse(
      { planned_type: 'long', planned_distance_mi: 19 },
      { sessionNamedElsewhere: false });
    expect(s.spokenFor.size).toBe(0);
  });

  it('has a better missing-evidence line for every key it can speak for', () => {
    expect(missingEvidenceLabel('anchor_confidence')).toBe('How firmly that read is held');
    expect(missingEvidenceLabel('nothing_known_about_this')).toBeNull();
  });
});
