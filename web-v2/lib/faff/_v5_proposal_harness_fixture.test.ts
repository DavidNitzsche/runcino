/**
 * lib/faff/_v5_proposal_harness_fixture.test.ts · the render harness's payload
 * is the SERVER'S OWN OUTPUT, and stays that way.
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 *
 * Rule 13 says a runner-facing change is verified by RENDERING it with real
 * data. The proposal surface makes that hard in a specific way: production's
 * `plan_workout_proposals` holds SEVEN rows in the life of the product, five
 * `downgrade` and two `field_test`. Between them they reach two of the six
 * directions and one of the four standings. There is no account whose data can
 * render this feature, and creating rows to fix that would be a production
 * write, which `lib/verify/install-barrier` exists to prevent.
 *
 * So the harness is seeded from a file, and this test is what stops that file
 * from becoming an agent's idea of what the server says. It runs the REAL
 * `toWire` over the REAL row shapes and asserts the committed fixture still
 * matches. If the mapping changes and nobody regenerates, the screenshots
 * taken from that fixture are stale and this fails rather than letting a
 * verified-looking image outlive what it verified.
 *
 * Regenerate with `UPDATE_PROPOSAL_FIXTURE=1 npx vitest run <this file>`.
 *
 * ── WHAT IS REAL AND WHAT IS NOT, STATED RATHER THAN BLURRED ───────────────
 *
 * `PRODUCTION_ROWS` are the seven rows read out of production on 2026-09-05,
 * verbatim in every field `toWire` reads. Only the row ids and the workout ids
 * are replaced, and neither reaches the wire. Two of them belong to accounts
 * that are not the owner's, which is itself a finding worth keeping: the
 * pending row from 2026-08-25 that Rule 13's brief calls out is NOT his.
 *
 * `SYNTHETIC_ROWS` are constructed, and are the only way to draw a push, a
 * move, a rest-day recovery, a condition or a deferral at all. They are
 * plausible rows, not observations, and nothing about them should be read as
 * evidence about this runner.
 *
 * ── RULE 22 · WHAT THIS GATE CANNOT FAIL ON ────────────────────────────────
 *
 * It cannot fail on the fixture LOOKING right, only on it being what `toWire`
 * currently produces. A wrong mapping that is faithfully rendered passes here
 * and is caught, if at all, by `_v5_proposals.test.ts` and by looking at the
 * screenshots.
 *
 * It cannot fail on the SYNTHETIC rows being realistic. Nothing can.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { toWire, directionOf, headlineFor } from '@/lib/faff/v5-proposals';
import { _internals } from '@/lib/faff/v5-decisions';
import { repriceReason } from '@/lib/plan/reanchor-plan';
import type { RepriceAnchorMove } from '@/lib/plan/reprice-payload';
import type { PendingProposal } from '@/lib/plan/workout-proposals';

/** The day the harness renders as. Fixed so the fixture is deterministic. */
const TODAY = '2026-09-05';

/**
 * `action_payload.reprice.anchorMoves` from production row 12, transcribed
 * unaltered. The same six `lib/plan/_reprice_reason_names_the_mover.test.ts`
 * calls `DAVID_MOVES` — one set of numbers, read out of one row, so the two
 * suites cannot end up arguing about what the runner's repricing actually was
 * (Rule 16). Threshold, interval, repetition and marathon did not move at all;
 * the easy and shakeout ceilings each moved 10 s/mi faster.
 */
const DAVID_ROW_12_MOVES: RepriceAnchorMove[] = [
  { key: 'threshold_s_per_mi', fromSecPerMi: 430, toSecPerMi: 430 },
  { key: 'interval_s_per_mi', fromSecPerMi: 401, toSecPerMi: 401 },
  { key: 'repetition_s_per_mi', fromSecPerMi: 365, toSecPerMi: 365 },
  { key: 'easy_ceiling_s_per_mi', fromSecPerMi: 502, toSecPerMi: 492 },
  { key: 'shakeout_ceiling_s_per_mi', fromSecPerMi: 532, toSecPerMi: 522 },
  { key: 'marathon_s_per_mi', fromSecPerMi: 472, toSecPerMi: 472 },
];

const FIXTURE = path.join(process.cwd(), '..', 'docs', 'verification',
  'v5-proposal-harness.json');

type Row = PendingProposal & { storedStatus: string; resolvedAtISO: string | null };

function row(p: Partial<Row> & Pick<Row, 'id' | 'actionKind' | 'workoutDateISO' | 'reason'>): Row {
  return {
    userUuid: 'u', planWorkoutId: `wko_${p.id}`,
    actionPayload: {}, evidence: {}, status: 'pending',
    createdAt: `${p.workoutDateISO}T07:00:00.000Z`,
    storedStatus: 'pending', resolvedAtISO: null,
    ...p,
  } as Row;
}

/**
 * The seven rows production actually holds, read 2026-09-05. Every field
 * `toWire` reads is verbatim.
 */
const PRODUCTION_ROWS: Row[] = [
  row({
    id: 5, actionKind: 'downgrade', workoutDateISO: '2026-08-06',
    actionPayload: {
      why: 'Avoid stacking two quality days; downgrade upcoming key to easy.',
      newType: 'easy',
    },
    reason: 'Readiness pullback · HRV below 5 days running.',
    // EVIDENCEPROSE-1 (2026-09-08) · re-read from production and now VERBATIM.
    // The three keys this carried were row 1's band/tier/score, not row 5's,
    // and it dropped the four the readiness rollup actually writes — including
    // `streaks`, which is an ARRAY and is what proved the old renderer would
    // put a raw JSON literal on the phone. The header promises verbatim; it now
    // is.
    evidence: {
      band: 'pull-back',
      tier: 'advanced',
      score: 44,
      streaks: [{ days: 5, pillar: 'hrv', direction: 'below' }],
      headline: "HRV below for 5 days · The trend matters more than today's number.",
      forcedByHardRule: false,
      sustainedPullBackDays: 0,
    },
    createdAt: '2026-08-07T07:15:00.000Z',
    storedStatus: 'expired', resolvedAtISO: '2026-08-07T18:00:00.000Z',
  }),
  row({
    id: 6, actionKind: 'field_test', workoutDateISO: '2026-08-25',
    actionPayload: {
      why: 'No race or field test in the last 6 weeks. Pace anchors are going stale. '
        + "Convert 2026-08-25's quality session to a 30-minute threshold field test to "
        + 'lock in current fitness.',
    },
    reason: 'No race or field test in the last 6 weeks. Pace anchors are going stale. '
      + "Convert 2026-08-25's quality session to a 30-minute threshold field test to "
      + 'lock in current fitness.',
    evidence: {
      citation: 'Research/01-pace-zones-vdot.md:684-686 + :700-703',
      workout_id: 'wko_af70b328c4a89b4d',
      planned_date: '2026-08-25',
      planned_type: 'tempo',
      planned_distance_mi: 6,
    },
    createdAt: '2026-08-23T03:52:44.551Z',
  }),
  row({
    id: 7, actionKind: 'field_test', workoutDateISO: '2026-09-09',
    actionPayload: {
      why: 'No race or field test in the last 6 weeks. Pace anchors are going stale. '
        + "Convert 2026-09-09's quality session to a 30-minute threshold field test to "
        + 'lock in current fitness.',
    },
    reason: 'No race or field test in the last 6 weeks. Pace anchors are going stale. '
      + "Convert 2026-09-09's quality session to a 30-minute threshold field test to "
      + 'lock in current fitness.',
    evidence: {
      citation: 'Research/01-pace-zones-vdot.md §"Testing cadence" + §"Field test protocols"',
      lthr_stale: false,
      workout_id: 'wko_9ea09c32abe20459',
      planned_date: '2026-09-09',
      planned_type: 'intervals',
      // A null in the blob, which is the engine saying it looked and found
      // nothing. This is the row that makes MISSING EVIDENCE non-empty.
      lthr_age_days: null,
      planned_distance_mi: 2.5,
    },
    createdAt: '2026-09-02T07:44:43.655Z',
  }),
  /* ── EVIDENCEPROSE-1 (2026-09-08) · THE ROW THE OWNER WAS LOOKING AT ──────
   *
   * `reprice` id 12, pending in production, read 2026-09-08. It is here for
   * Rule 15's reason: the harness could not express a repricing AT ALL, so the
   * entire reprice branch of `detailFor` and `affectedFrom` was dark across the
   * fixture — which is exactly the branch whose rendering the owner opened on
   * his phone and called "not telling me anything". A corpus that cannot reach
   * a branch is not covering it however many rows it holds.
   *
   * ── REPRICEFIXTURE-1 (2026-09-08) · WHY `anchorMoves` IS HERE NOW ────────
   *
   * This payload used to be trimmed to `workoutsAffected` and `workoutsSealed`
   * — "nothing else on this path reads the rest" — and that sentence stopped
   * being true the moment `repriceHeadline` shipped: the headline is now
   * resolved from `anchorMoves` through `repriceSubject`, so a fixture without
   * them cannot reach the branch it exists to render. It is the exact failure
   * this row's own comment describes one paragraph up, one level down (Rule
   * 15), and it was found the honest way: the committed JSON was hand-edited
   * to the new sentence while the row that builds it still produced the old
   * one, so this suite passed on `main` and failed here.
   *
   * The six moves are `action_payload.reprice.anchorMoves` from production row
   * 12, transcribed unaltered — the same six `_reprice_reason_names_the_mover
   * .test.ts` calls `DAVID_MOVES`. Four anchors did not move at all; the easy
   * and shakeout ceilings each moved 10 s/mi faster. That is the whole of what
   * made the old headline say "faster paces" over a threshold the runner could
   * see had not budged.
   *
   * `arm`, `workoutsAffected`, `workoutsSealed`, `meanAnchorDeltaSecPerMi` and
   * `anchorMoves` are every field any render path reads. The rest of
   * `RepricePayload` (`planId`, the VDOT pair, `toSource`, `computedAt`) is
   * still omitted rather than invented, which is what the `as never` records:
   * this is a real payload with fields left out, not a fabricated whole one.
   *
   * ── WHAT THE `why` LINE SAYS, AND WHY IT IS STILL THE OLD SENTENCE ────────
   *
   * `toWire` reads `p.reason`, the string PERSISTED when the row was written.
   * Row 12 was raised 2026-09-08 before `3b1bbad0c`, so its stored reason is
   * the threshold-twice sentence David actually read, and `writeReanchorProposal`
   * will not refresh it — `isSameRepricing` answers "this card is already up"
   * while the anchors have not moved again. So the honest render of row 12
   * after REPRICEHEADLINE-1 is a NEW headline over its OLD body, and that is
   * what this fixture shows. It is not the fix failing; it is the residue of
   * one already-stored row, and hand-editing the JSON to hide it was the
   * defect this comment replaces. The coherent card the writer produces today
   * is drawn by row 108 below, from the real `repriceReason`. */
  row({
    id: 12, actionKind: 'reprice', workoutDateISO: '2026-09-08',
    actionPayload: {
      why: 'Your recent training puts your threshold at 7:10 per mile. '
        + 'This block is written at 7:10 per mile.',
      reprice: {
        arm: 'race-prep',
        workoutsAffected: 76,
        workoutsSealed: 0,
        meanAnchorDeltaSecPerMi: -3.3333333333333335,
        anchorMoves: DAVID_ROW_12_MOVES,
      } as never,
    },
    reason: 'Your recent training puts your threshold at 7:10 per mile. '
      + 'This block is written at 7:10 per mile.',
    evidence: {
      anchor_vdot_now: 47.8,
      evidence_source: 'run',
      anchor_confidence: 0.8081792830507429,
      anchor_vdot_proposed: 47.7,
      ends_calibration_intro: false,
    },
    createdAt: '2026-09-08T07:00:28.475Z',
  }),
];

/**
 * Rows the production table has never held. The only way to draw four of the
 * six directions and three of the four standings.
 */
const SYNTHETIC_ROWS: Row[] = [
  row({
    id: 101, actionKind: 'mark_upgrade', workoutDateISO: '2026-09-10',
    actionPayload: { newDistanceMi: 9, why: 'Absorbed more than prescribed with no late fade.' },
    reason: 'You absorbed 47.3 miles against 45.5 prescribed, and the last three long runs '
      + 'held their pace into the final third.',
    evidence: {
      planned_type: 'long run',
      planned_distance_mi: 8,
      weekly_mi: 47.3,
      long_mi: 16,
      options: [
        { option: 'Leave Thursday at 8 mi',
          why: 'a fourth week at the same load produces no new evidence either way' },
        { option: 'Add the mile to Saturday instead',
          why: 'it would put the step on the week\'s longest run, which is the one '
            + 'doctrine caps hardest' },
      ],
      policyAssumptions: [
        'Three comparable sessions before this engine claims a capacity ceiling',
      ],
    },
  }),
  row({
    id: 102, actionKind: 'shave', workoutDateISO: '2026-09-11',
    actionPayload: { shaveFraction: 0.17, why: 'Late-session deterioration on the last two longs.' },
    reason: 'Your last two long runs lost 22 and 19 seconds a mile across the final third.',
    evidence: {
      planned_type: 'long run',
      planned_distance_mi: 18,
      missingEvidence: ['Heart rate on the second of the two long runs'],
    },
  }),
  row({
    id: 103, actionKind: 'downgrade', workoutDateISO: '2026-09-12',
    actionPayload: { newType: 'rest', why: 'Three quality days inside five.' },
    reason: 'Three quality sessions land inside five days this week, and the last one '
      + 'sits on the day after your long run.',
    evidence: { planned_type: 'intervals', planned_distance_mi: 7 },
  }),
  row({
    id: 104, actionKind: 'reschedule', workoutDateISO: '2026-09-13',
    actionPayload: { newDate: '2026-09-15', why: 'Hard days one day apart.' },
    reason: 'This session and Monday\'s threshold sit one day apart, which leaves neither '
      + 'a recovery day.',
    evidence: { planned_type: 'tempo', planned_distance_mi: 8 },
  }),
  // A CONDITION. Nothing writes an earning gate onto a proposal row yet, so
  // this is the shape `contract.ts` defines rather than one observed.
  row({
    id: 105, actionKind: 'mark_upgrade', workoutDateISO: '2026-10-08',
    actionPayload: { newDistanceMi: 20 },
    reason: 'Week 9 opens at 55 miles, which is 6 more than you have run in a week.',
    evidence: {
      planned_type: 'long run',
      planned_distance_mi: 18,
      earningGate: {
        requires: [
          { what: 'A 50 mile week, completed.' },
          { what: 'An 18 mile long run that holds its pace to the end.' },
        ],
      },
      reassessOnISO: '2026-09-28',
    },
  }),
  // A DEFERRAL. Same caveat: the reassessment date exists in `DecisionTrace`
  // and nothing persists one onto a proposal yet.
  row({
    id: 106, actionKind: 'shave', workoutDateISO: '2026-09-24',
    actionPayload: { shaveFraction: 0.1 },
    reason: 'Two of the last three weeks ended above your usual resting heart rate, and '
      + 'the third has not finished.',
    evidence: {
      planned_type: 'threshold',
      planned_distance_mi: 9,
      reassessOnISO: '2026-09-19',
    },
  }),
  /* ── REPRICEFIXTURE-1 (2026-09-08) · A REPRICING AS TODAY'S WRITER STORES IT
   *
   * Row 12 above is the only repricing the product has ever held, and it was
   * written before `3b1bbad0c` fixed the body sentence, so its persisted
   * `reason` names the anchor that stood still. Nothing in production can draw
   * the card the writer produces NOW — headline and body resolving through the
   * same `repriceSubject` — which is exactly the Rule 15 gap row 12 was added
   * to close, one release later and one field over.
   *
   * The anchor moves are row 12's, unaltered, so the two cards are the SAME
   * repricing seen through the old writer and the new one, and the difference
   * on the screen is attributable to the code and to nothing else.
   *
   * `reason` is not typed out here. It is produced by calling the real
   * `repriceReason` with the real move set, so this row cannot assert a body
   * sentence the writer would not actually write — which is the failure mode
   * that put a hand-edited string in the committed JSON in the first place.
   */
  row({
    id: 108, actionKind: 'reprice', workoutDateISO: '2026-09-14',
    actionPayload: {
      reprice: {
        arm: 'race-prep',
        workoutsAffected: 76,
        workoutsSealed: 0,
        meanAnchorDeltaSecPerMi: -3.3333333333333335,
        anchorMoves: DAVID_ROW_12_MOVES,
      } as never,
    },
    reason: repriceReason({
      arm: 'race-prep',
      fromThresholdSecPerMi: 430,
      toThresholdSecPerMi: 430,
      moves: DAVID_ROW_12_MOVES,
      evidence: { source: 'run', refId: null },
    }),
    evidence: {
      anchor_vdot_now: 47.8,
      evidence_source: 'run',
      anchor_confidence: 0.8081792830507429,
      anchor_vdot_proposed: 47.7,
      ends_calibration_intro: false,
    },
    createdAt: '2026-09-08T07:00:28.475Z',
  }),
];

const ALL_ROWS = [...PRODUCTION_ROWS, ...SYNTHETIC_ROWS];

function buildFixture() {
  const proposals = ALL_ROWS
    // The harness draws the card list, which is the PENDING list: a row whose
    // day has gone is not a card, exactly as `loadPendingProposals` filters.
    .filter((r) => r.storedStatus === 'pending' && r.workoutDateISO >= TODAY)
    .map((r) => toWire(r, TODAY))
    .filter((w) => w !== null);

  // Built with the resolver's own maps rather than by hand, so the history and
  // the cards cannot disagree about a headline or a direction (Rule 16).
  const decisions = ALL_ROWS.map((r) => {
    const direction = directionOf(r.actionKind, r.actionPayload);
    return {
      id: `w${r.id}`,
      dateISO: r.workoutDateISO,
      decidedISO: (r.resolvedAtISO ?? r.createdAt).slice(0, 10),
      direction,
      outcome: _internals.outcomeOfWorkoutRow(
        r.storedStatus,
        r.workoutDateISO < TODAY,
        typeof (r.evidence as Record<string, unknown>)?.reassessOnISO === 'string'
          && String((r.evidence as Record<string, unknown>).reassessOnISO) > TODAY
          && (r.evidence as Record<string, unknown>).earningGate == null,
      ),
      headline: direction == null ? 'A change to one session' : headlineFor(r),
      why: r.reason,
    };
  });

  // Two block-level rows, so the history shows the outcomes only that lane can
  // produce. Shapes taken from `PLAN_TITLES` and `PlanProposalStatus`.
  decisions.push(
    {
      id: 'p9', dateISO: null as unknown as string, decidedISO: '2026-09-03',
      direction: null, outcome: 'applied',
      headline: 'The engine rebuilt your block',
      why: 'Your threshold pace was re-anchored and the block was re-authored around it.',
    },
    {
      id: 'p8', dateISO: null as unknown as string, decidedISO: '2026-08-30',
      direction: null, outcome: 'superseded',
      headline: 'Where this build projects',
      why: 'A newer read of the same gap replaced this one before you answered it.',
    },
  );

  decisions.sort((a, b) => (a.decidedISO < b.decidedISO ? 1 : a.decidedISO > b.decidedISO ? -1 : 0));

  return { proposals, proposalsRead: 'ok', decisions };
}

describe('V5PROPOSALSURFACE-1 · the harness renders what the server would send', () => {
  it('the committed fixture is exactly what toWire produces today', () => {
    const built = buildFixture();
    const json = JSON.stringify(built, null, 2) + '\n';

    if (process.env.UPDATE_PROPOSAL_FIXTURE === '1') {
      mkdirSync(path.dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, json);
    }

    const onDisk = readFileSync(FIXTURE, 'utf8');
    expect(onDisk).toBe(json);
  });

  it('covers every direction the card can draw', () => {
    const built = buildFixture();
    const drawn = new Set(built.proposals.map((p) => p!.direction));
    // `hold` and `stop` have no writer in the engine, so no row can produce
    // them and the fixture honestly does not contain them. They are drawn by
    // `ProposalCardV5`'s own previews instead, which is where an unreachable
    // direction belongs — a fixture that faked one would be claiming the
    // engine can emit something it cannot.
    expect(drawn).toEqual(new Set(['push', 'pull_back', 'recovery', 'move']));
  });

  it('covers every standing the card can draw except applied', () => {
    const built = buildFixture();
    const drawn = new Set(built.proposals.map((p) => p!.standing));
    // `applied` is never a pending row by definition, so it belongs to the
    // history and not to the card list.
    expect(drawn).toEqual(new Set(['proposal', 'condition', 'deferral']));
  });

  it('covers every outcome the history can draw from these rows', () => {
    const built = buildFixture();
    const drawn = new Set(built.decisions.map((d) => d.outcome));
    expect(drawn).toContain('pending');
    expect(drawn).toContain('expired');
    expect(drawn).toContain('applied');
    expect(drawn).toContain('superseded');
    expect(drawn).toContain('deferred');
  });
});
