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
import type { PendingProposal } from '@/lib/plan/workout-proposals';

/** The day the harness renders as. Fixed so the fixture is deterministic. */
const TODAY = '2026-09-05';

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
    evidence: { band: 'moderate', tier: 'advanced', score: 64 },
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
