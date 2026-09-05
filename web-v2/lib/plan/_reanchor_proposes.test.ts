/**
 * lib/plan/_reanchor_proposes.test.ts · REANCHORPROPOSES-1.
 *
 * David, 2026-09-05: "The current state is contradictory: COACHING_ADAPTATION
 * is supposedly refused, while a named hold allows reanchor to continue
 * changing workouts. A hold that continues writing is an exemption with better
 * paperwork."
 *
 * The gate for the conversion. Three things have to hold together and none of
 * them is provable from the others:
 *
 *   1 · the unattended path WRITES NOTHING — no hold, no COACHING_ADAPTATION,
 *       no `mutatePlan` from the cron's own call
 *   2 · it RAISES A CARD instead, one card for the whole block
 *   3 · the card is DRAWABLE — `directionOf` refuses unknown kinds, so a
 *       mapping that had not learned `reprice` would have withheld the card
 *       silently and the runner's paces would simply have stopped moving with
 *       nothing on screen to say why. That is the failure this conversion
 *       could most easily have shipped, so it gets its own guard.
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ────────────────────────────────
 *
 *   · It cannot tell whether the repricing is CORRECT. Whether the anchors are
 *     the right anchors is `_recompute_paces.test.ts`'s question and the
 *     shadow compare's; this file only asks who is allowed to apply them.
 *   · It cannot tell whether the runner ever taps accept. Nothing in a test
 *     suite can, and the honest consequence — his paces do not move until he
 *     does — is a product fact, not a bug this gate can catch.
 *   · It does not exercise the accept ROUTE end to end (no HTTP, no session).
 *     It asserts the branch exists and calls the apply half; whether Next
 *     wires the handler is the route's own suite.
 *   · Its balance is deliberately even: three cases assert the engine may NOT
 *     write and four assert a card IS raised. A suite that only proved the
 *     refusal would pass an engine that had gone silent, which is the Rule 22
 *     failure this project measured across the whole progression ladder.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));
vi.mock('@/lib/execution/day-resolver', () => ({
  resolveDateRangeExecutions: vi.fn(async () => new Map()),
}));

import { pool } from '@/lib/db/pool';
import { resolveDateRangeExecutions } from '@/lib/execution/day-resolver';
import {
  writeReanchorProposal, anchorMovesBetween, meanAnchorDelta, isSameRepricing,
  pricedAnchorsOf, REPRICE_DISMISSAL_QUIET_DAYS,
} from './reanchor-proposal';
import { REPRICE_ACTION_KIND, asRepricePayload, type RepricePayload } from './reprice-payload';
import { directionOf, headlineFor, toWire } from '@/lib/faff/v5-proposals';
import type { PendingProposal } from './workout-proposals';

const WEB = path.resolve(__dirname, '..', '..');

/**
 * Comments removed, so PROSE ABOUT the defect is not read as the defect.
 *
 * Learned by falsifying this file against its own subject: the header of
 * `reanchor-plan.ts` explains what `COACHING_ADAPTATION` used to do there, and
 * a raw-text scan called that a violation. A gate that cannot tell code from
 * the comment describing it is a gate that punishes documentation.
 */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
const src = (rel: string): string => stripComments(readFileSync(path.join(WEB, rel), 'utf8'));

const REANCHOR = src('lib/plan/reanchor-plan.ts');
const RECOMPUTE = src('lib/plan/recompute-paces.ts');
const ACCEPT = src('app/api/plan/workout-proposals/[id]/accept/route.ts');
const CRON = src('app/api/cron/snapshot-projections/route.ts');

const UUID = '00000000-0000-0000-0000-0000000000aa';

const LIVE = {
  thresholdSecPerMi: 420, intervalSecPerMi: 392, repetitionSecPerMi: 356,
  easyCeilingSecPerMi: 492, shakeoutCeilingSecPerMi: 522, marathonSecPerMi: 462,
};
const PRICED = {
  threshold_s_per_mi: 430, interval_s_per_mi: 401, repetition_s_per_mi: 365,
  easy_ceiling_s_per_mi: 502, shakeout_ceiling_s_per_mi: 532, marathon_s_per_mi: 472,
};

const BASE_INPUT = {
  userUuid: UUID,
  planId: 'pln_1',
  arm: 'race-prep' as const,
  todayISO: '2026-09-05',
  fromVdot: 45.9,
  toVdot: 47.7,
  toSource: 'measured_vdot',
  measured: true,
  pricedAnchors: PRICED as Record<string, unknown>,
  liveAnchors: LIVE,
  reason: 'Your recent training puts your threshold at 7:00 per mile. This block is written at 7:10 per mile.',
  evidence: { anchor_vdot_now: 45.9, anchor_vdot_proposed: 47.7 },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const query = pool.query as any;
type Router = (sql: string) => { rows: Record<string, unknown>[] };
let issued: string[] = [];
let route: Router = () => ({ rows: [] });

/** Three future days; the resolver seals whichever ids are named. */
function standardRoute(opts?: { existing?: Record<string, unknown>[] }): Router {
  return (sql) => {
    if (sql.includes('FROM plan_workouts pw')) {
      return { rows: [
        { id: 'w1', date_iso: '2026-09-06' },
        { id: 'w2', date_iso: '2026-09-08' },
        { id: 'w3', date_iso: '2026-09-09' },
      ] };
    }
    if (sql.includes('FROM plan_workout_proposals')) return { rows: opts?.existing ?? [] };
    if (sql.includes('INSERT INTO plan_workout_proposals')) return { rows: [{ id: 77 }] };
    return { rows: [] };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  issued = [];
  route = standardRoute();
  query.mockImplementation(async (sql: unknown) => {
    issued.push(String(sql));
    const r = route(String(sql));
    return { rows: r.rows, rowCount: r.rows.length };
  });
  (resolveDateRangeExecutions as unknown as { mockImplementation: (f: unknown) => void })
    .mockImplementation(async () => new Map());
});

/* ══════════════════════════════════════════════════════════════════════════
 * LIVENESS · Rule 18 point 2. A source scan that read nothing reports clean.
 * ═══════════════════════════════════════════════════════════════════════ */

describe('LIVENESS · the files this reasons about are real', () => {
  // Floors are on the COMMENT-STRIPPED text, which is a fraction of the file.
  it('read four non-trivial sources', () => {
    expect(REANCHOR.length).toBeGreaterThan(9000);
    expect(RECOMPUTE.length).toBeGreaterThan(7000);
    expect(ACCEPT.length).toBeGreaterThan(1200);
    expect(CRON.length).toBeGreaterThan(4000);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * GUARD 1 · the hold is gone, and so is the class it was excusing.
 * ═══════════════════════════════════════════════════════════════════════ */

describe('GUARD 1 · no held write survives in the self-heal', () => {
  it('reanchor-plan declares no COACHING_ADAPTATION and passes no hold', () => {
    expect(
      REANCHOR.includes("authority: 'COACHING_ADAPTATION'"),
      'reanchor-plan declares COACHING_ADAPTATION again. The seam REFUSES that class, so the '
      + 'only way this compiles into a working write is a hold — which is the exemption with '
      + 'better paperwork the owner ruled out.',
    ).toBe(false);
    expect(
      /^\s*hold:\s*\{/m.test(REANCHOR),
      'a hold reappeared in reanchor-plan. A hold that continues writing is not a hold.',
    ).toBe(false);
  });

  it('recompute-paces passes no hold and takes its authority from the caller', () => {
    expect(RECOMPUTE.includes("authority: 'COACHING_ADAPTATION'")).toBe(false);
    expect(/^\s*hold:\s*\{/m.test(RECOMPUTE)).toBe(false);
    expect(RECOMPUTE).toContain('authority: opts.authority');
    // A standalone recompute with no declared class is REFUSED, not defaulted.
    expect(RECOMPUTE).toContain('if (opts?.authority == null)');
  });

  it('every mutatePlan in the self-heal is RUNNER_ACCEPTED', () => {
    const declared = [...REANCHOR.matchAll(/authority: '([A-Z_]+)'/g)].map((m) => m[1]);
    expect(declared.length, 'no authority declaration found — the scan has stopped matching')
      .toBeGreaterThanOrEqual(3);
    expect([...new Set(declared)]).toEqual(['RUNNER_ACCEPTED']);
  });

  it('the unattended entry point proposes on BOTH arms and the prior arm too', () => {
    const fn = /export async function reanchorActivePlan[\s\S]*?\n}\n/.exec(REANCHOR)?.[0] ?? '';
    expect(fn.length).toBeGreaterThan(500);
    expect(fn).toContain("reanchorOffCanonicalPrior(userId, today, 'propose')");
    expect(fn).toContain("'propose')");
    expect(
      fn.includes("'apply'"),
      'reanchorActivePlan reaches the apply half. It is the unattended caller and must not.',
    ).toBe(false);
  });

  it('the cron reports the proposal outcome rather than swallowing it', () => {
    // Rule 11 · the failure mode of this conversion is SILENCE, so the cron
    // has to carry the writer's own status word.
    expect(CRON).toContain('isReanchorProposed');
    expect(CRON).toContain('reanchor_proposed');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * GUARD 2 · one card for the whole block, and it is applied on his tap.
 * ═══════════════════════════════════════════════════════════════════════ */

describe('GUARD 2 · the coordinated proposal', () => {
  it('writes exactly ONE row for a block of many affected days', async () => {
    const out = await writeReanchorProposal(BASE_INPUT);
    expect(out.status).toBe('written');
    if (out.status !== 'written') return;
    expect(out.payload.workoutsAffected).toBe(3);
    expect(out.payload.anchorMoves).toHaveLength(6);
    expect(out.payload.meanAnchorDeltaSecPerMi).toBeLessThan(0);
    const inserts = issued.filter((s) => s.includes('INSERT INTO plan_workout_proposals'));
    expect(
      inserts.length,
      'a repricing wrote more than one card. Seventy-seven identical cards is Rule 17 at its '
      + 'worst, and a half-accepted repricing prices one block off two anchors.',
    ).toBe(1);
  });

  it('hangs the card on the earliest day that is NOT already run', async () => {
    (resolveDateRangeExecutions as unknown as { mockImplementation: (f: unknown) => void })
      .mockImplementation(async () => new Map([
        ['2026-09-06', { dateISO: '2026-09-06', prescriptions: [{ id: 'w1', matchedRun: { id: 'r1' } }], supplementalRuns: [] }],
      ]));
    const out = await writeReanchorProposal(BASE_INPUT);
    expect(out.status).toBe('written');
    if (out.status !== 'written') return;
    expect(out.payload.workoutsSealed).toBe(1);
    expect(out.payload.workoutsAffected).toBe(2);
    const insert = issued.find((s) => s.includes('INSERT INTO plan_workout_proposals'));
    expect(insert).toBeTruthy();
  });

  it('writes NO plan row of its own', async () => {
    await writeReanchorProposal(BASE_INPUT);
    expect(
      issued.some((s) => /UPDATE\s+plan_workouts\b/i.test(s)),
      'the proposal writer touched the plan. It proposes; it does not apply.',
    ).toBe(false);
  });

  it('the accept route branches on reprice and calls the apply half', () => {
    expect(ACCEPT).toContain("proposal.actionKind === 'reprice'");
    expect(ACCEPT).toContain('applyReanchorProposal');
    // And it reports what LANDED beside what was PROMISED (Rule 10 · the arms
    // re-resolve, so the two can honestly differ).
    expect(ACCEPT).toContain('applied_to_vdot');
    expect(REANCHOR).toContain('export async function applyReanchorProposal');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * GUARD 3 · idempotence, supersession and the nagging budget.
 * ═══════════════════════════════════════════════════════════════════════ */

describe('GUARD 3 · a daily cron does not stack cards', () => {
  const payloadOf = (o: Awaited<ReturnType<typeof writeReanchorProposal>>): RepricePayload => {
    if (o.status !== 'written') throw new Error(`expected written, got ${o.status}`);
    return o.payload;
  };

  it('an identical pending card is left alone', async () => {
    const first = payloadOf(await writeReanchorProposal(BASE_INPUT));
    issued = [];
    route = standardRoute({ existing: [{ id: 77, status: 'pending', action_payload: { reprice: first }, resolved_at: null }] });
    const out = await writeReanchorProposal(BASE_INPUT);
    expect(out.status).toBe('unchanged');
    expect(issued.some((s) => s.includes('INSERT INTO plan_workout_proposals'))).toBe(false);
  });

  it('a materially different repricing SUPERSEDES the pending one in one statement', async () => {
    const stale = payloadOf(await writeReanchorProposal(BASE_INPUT));
    issued = [];
    route = standardRoute({ existing: [{ id: 77, status: 'pending', action_payload: { reprice: stale }, resolved_at: null }] });
    const out = await writeReanchorProposal({
      ...BASE_INPUT,
      liveAnchors: { ...LIVE, thresholdSecPerMi: 405, intervalSecPerMi: 380 },
    });
    expect(out.status).toBe('written');
    if (out.status !== 'written') return;
    expect(out.supersededId).toBe(77);
    const stmt = issued.find((s) => s.includes('INSERT INTO plan_workout_proposals'));
    expect(stmt, 'the supersede and the insert must be one statement').toContain('WITH superseded AS');
    // `expired`, never `dismissed` — the runner's answers stay his.
    expect(stmt).toContain("SET status = 'expired'");
  });

  it('a card he dismissed is not re-raised while the engine believes the same thing', async () => {
    const same = payloadOf(await writeReanchorProposal(BASE_INPUT));
    issued = [];
    route = standardRoute({ existing: [{ id: 77, status: 'dismissed', action_payload: { reprice: same }, resolved_at: new Date() }] });
    const out = await writeReanchorProposal(BASE_INPUT);
    expect(out.status).toBe('quiet_after_dismissal');
    expect(issued.some((s) => s.includes('INSERT INTO plan_workout_proposals'))).toBe(false);
  });

  it('but the quiet ENDS once the answer changes · a new question may be asked', async () => {
    const old = payloadOf(await writeReanchorProposal(BASE_INPUT));
    issued = [];
    route = standardRoute({ existing: [{ id: 77, status: 'dismissed', action_payload: { reprice: old }, resolved_at: new Date() }] });
    const out = await writeReanchorProposal({
      ...BASE_INPUT,
      liveAnchors: { ...LIVE, thresholdSecPerMi: 402 },
    });
    expect(
      out.status,
      'a dismissal silenced a DIFFERENT repricing. The budget is for repeating one question, '
      + 'not for muting the pace axis.',
    ).toBe('written');
  });

  it('the quiet window is a real number of days', () => {
    expect(REPRICE_DISMISSAL_QUIET_DAYS).toBeGreaterThan(0);
    expect(REPRICE_DISMISSAL_QUIET_DAYS).toBeLessThanOrEqual(30);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * GUARD 4 · Rule 11 · a refusal and a read failure are not "nothing changed".
 * ═══════════════════════════════════════════════════════════════════════ */

describe('GUARD 4 · the three facts stay three facts', () => {
  it('a block with no priced anchors is REFUSED, never shown with a guessed direction', async () => {
    const out = await writeReanchorProposal({ ...BASE_INPUT, pricedAnchors: null });
    expect(out.status).toBe('refused');
  });

  it('a reason that names a disposition rather than a fact is REFUSED', async () => {
    const out = await writeReanchorProposal({ ...BASE_INPUT, reason: 'this looks aggressive' });
    expect(out.status).toBe('refused');
    expect(issued.some((s) => s.includes('INSERT INTO plan_workout_proposals'))).toBe(false);
  });

  it('a failed read reports read_failed, not no_target', async () => {
    query.mockImplementation(async () => { throw new Error('connection reset'); });
    const out = await writeReanchorProposal(BASE_INPUT);
    expect(out.status).toBe('read_failed');
  });

  it('an unresolvable seal state is read_failed, not "the block is finished"', async () => {
    (resolveDateRangeExecutions as unknown as { mockImplementation: (f: unknown) => void })
      .mockImplementation(async () => { throw new Error('resolver down'); });
    const out = await writeReanchorProposal(BASE_INPUT);
    expect(out.status).toBe('read_failed');
  });

  it('anchors that do not move produce `unchanged`, and nothing is written', async () => {
    const out = await writeReanchorProposal({
      ...BASE_INPUT,
      liveAnchors: {
        thresholdSecPerMi: 430, intervalSecPerMi: 401, repetitionSecPerMi: 365,
        easyCeilingSecPerMi: 502, shakeoutCeilingSecPerMi: 532, marathonSecPerMi: 472,
      },
    });
    expect(out.status).toBe('unchanged');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * GUARD 5 · the card is DRAWABLE. Without this the proposal is invisible.
 * ═══════════════════════════════════════════════════════════════════════ */

function cardRow(payload: RepricePayload, reason = 'Your recent training puts your threshold at 7:00 per mile.'): PendingProposal {
  return {
    id: 77, userUuid: UUID, planWorkoutId: 'w1', workoutDateISO: '2026-09-06',
    actionKind: 'reprice', actionPayload: { why: reason, reprice: payload },
    reason, evidence: {}, status: 'pending', createdAt: new Date().toISOString(),
  };
}

describe('GUARD 5 · the phone can draw a repricing', () => {
  const payloadFor = (mean: number, affected = 12): RepricePayload => ({
    kind: REPRICE_ACTION_KIND, planId: 'pln_1', arm: 'race-prep',
    fromVdot: 45.9, toVdot: 47.7, toSource: 'measured_vdot', measured: true,
    anchorMoves: [{ key: 'threshold_s_per_mi', fromSecPerMi: 430, toSecPerMi: 430 + mean }],
    meanAnchorDeltaSecPerMi: mean, workoutsAffected: affected, workoutsSealed: 0,
    computedAt: new Date().toISOString(),
  });

  it('faster is a PUSH, slower is a PULL BACK, and a wash is a HOLD', () => {
    expect(directionOf('reprice', { reprice: payloadFor(-10) })).toBe('push');
    expect(directionOf('reprice', { reprice: payloadFor(10) })).toBe('pull_back');
    expect(directionOf('reprice', { reprice: payloadFor(0) })).toBe('hold');
  });

  it('an unreadable payload is WITHHELD, not guessed at', () => {
    expect(directionOf('reprice', {})).toBeNull();
    expect(directionOf('reprice', undefined)).toBeNull();
  });

  it('the card actually reaches the wire · this is the silent-withholding guard', () => {
    const wire = toWire(cardRow(payloadFor(-10)), '2026-09-05');
    expect(
      wire,
      'toWire withheld a repricing. The proposal row would exist, the runner would see nothing, '
      + 'and his paces would simply stop updating. That is the worst outcome of this conversion.',
    ).not.toBeNull();
    expect(wire?.direction).toBe('push');
    expect(wire?.standing).toBe('proposal');
    expect(wire?.detail.affectedWorkouts?.[0].what).toContain('12');
  });

  it('the headline names the block, in the coach voice', () => {
    const faster = headlineFor(cardRow(payloadFor(-10, 31)));
    expect(faster).toBe('31 sessions ahead move to faster paces');
    expect(headlineFor(cardRow(payloadFor(9, 4)))).toBe('4 sessions ahead move to easier paces');
    expect(headlineFor(cardRow(payloadFor(0, 1)))).toBe('1 session ahead gets updated paces');
    for (const s of [faster, headlineFor(cardRow(payloadFor(9, 4)))]) {
      expect(s, 'coach voice · no em dash').not.toMatch(/—/);
      expect(s, 'coach voice · no exclamation').not.toMatch(/!/);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * GUARD 6 · the pure helpers, including the one that decides direction.
 * ═══════════════════════════════════════════════════════════════════════ */

describe('GUARD 6 · one direction-bearing quantity', () => {
  it('anchorMovesBetween pairs every anchor with both sides and filters none', () => {
    expect(anchorMovesBetween(PRICED, LIVE)).toHaveLength(6);
    expect(anchorMovesBetween(null, LIVE)).toHaveLength(0);
    // A one-second move is REPORTED here even though the drift GATE ignores it:
    // the card must describe what the accept will actually do.
    const tiny = anchorMovesBetween({ threshold_s_per_mi: 430 }, { ...LIVE, thresholdSecPerMi: 429 });
    expect(tiny).toHaveLength(1);
  });

  it('negative is faster · seconds per mile, and fewer is quicker', () => {
    expect(meanAnchorDelta(anchorMovesBetween(PRICED, LIVE))).toBeLessThan(0);
    expect(meanAnchorDelta([])).toBeNull();
  });

  it('pricedAnchorsOf falls through recompute stamp, authoring stamp, seeder key', () => {
    expect(pricedAnchorsOf({ pace_recompute: { anchors: { a: 1 } }, pace_authoring: { anchors: { b: 2 } } }))
      .toEqual({ a: 1 });
    expect(pricedAnchorsOf({ pace_authoring: { anchors: { b: 2 } } })).toEqual({ b: 2 });
    expect(pricedAnchorsOf({ pace_anchors: { c: 3 } })).toEqual({ c: 3 });
    expect(pricedAnchorsOf({})).toBeNull();
    expect(pricedAnchorsOf(null)).toBeNull();
  });

  it('asRepricePayload refuses a shape it cannot trust', () => {
    expect(asRepricePayload(null)).toBeNull();
    expect(asRepricePayload({ kind: 'downgrade' })).toBeNull();
    expect(asRepricePayload({ kind: REPRICE_ACTION_KIND, planId: 'p', meanAnchorDeltaSecPerMi: 1, anchorMoves: [], workoutsAffected: 1 })).toBeNull();
  });

  it('isSameRepricing tolerates rounding but not a real move', () => {
    const a: RepricePayload = {
      kind: REPRICE_ACTION_KIND, planId: 'p', arm: 'race-prep', fromVdot: 46, toVdot: 47,
      toSource: 'measured_vdot', measured: true,
      anchorMoves: [{ key: 'threshold_s_per_mi', fromSecPerMi: 430, toSecPerMi: 420 }],
      meanAnchorDeltaSecPerMi: -10, workoutsAffected: 3, workoutsSealed: 0,
      computedAt: '2026-09-05T00:00:00.000Z',
    };
    expect(isSameRepricing(a, { ...a, anchorMoves: [{ key: 'threshold_s_per_mi', fromSecPerMi: 430, toSecPerMi: 421 }] })).toBe(true);
    expect(isSameRepricing(a, { ...a, anchorMoves: [{ key: 'threshold_s_per_mi', fromSecPerMi: 430, toSecPerMi: 410 }] })).toBe(false);
  });
});
