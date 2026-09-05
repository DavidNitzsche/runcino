/**
 * lib/adaptation-harness/drive.ts · run the real loop, not a model of it.
 *
 * CLAUDE.md Rule 13's fixture trap, one level up: a harness that reimplements
 * the engine proves things about the harness. So every function here is a thin
 * wrapper that calls the shipped code — including `runNightlyPass`, which
 * invokes the `run-adaptations` route's OWN `POST` handler rather than
 * re-staging the sequence inside it. The order the route applies things in, its
 * propose/apply split, its `pullbackDecided` gate and its post-pass stamping
 * are all part of what is under test; re-typing them here would be re-typing
 * the bug.
 */

import { assertHarnessDatabase, OWNER_UUID } from './fence';

assertHarnessDatabase();

/**
 * The nightly cron, exactly as it runs in production.
 *
 * `CRON_SECRET` is set here rather than by the shell so it can never be
 * confused with a real one: the harness is talking to its own database and the
 * route's auth check is not what is being tested.
 */
export async function runNightlyPass(): Promise<{
  ok: boolean; users: number; total_applied: number; total_proposed: number;
  results: Array<{ user_id: string; triggers: number; applied: number; proposed: number; error?: string }>;
}> {
  process.env.CRON_SECRET = process.env.CRON_SECRET || 'harness-local-secret';
  const { NextRequest } = await import('next/server');
  const route = await import('@/app/api/cron/run-adaptations/route');
  const req = new NextRequest('http://localhost/api/cron/run-adaptations', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  const res = await route.POST(req);
  const body = await res.json();
  if (res.status !== 200) {
    throw new Error(`[harness] run-adaptations returned ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

/** Detection alone — triggers and actions, before anything is applied. */
export async function detect() {
  const { detectAdaptations } = await import('@/lib/plan/adapt');
  return detectAdaptations(OWNER_UUID);
}

/** The apply/propose split the cron makes, on a given action list. */
export async function partition(actions: Awaited<ReturnType<typeof detect>>['actions']) {
  const { partitionActionsForCron } = await import('@/lib/plan/adapt');
  return partitionActionsForCron(actions);
}

/**
 * Every gate on the upward volume path, with the ones that are shut named.
 *
 * This is the Rule 21 instrument: "compute what the runner would have had to DO
 * to trigger it, then check whether any week they have actually run would
 * have." When the ramp does not fire, a harness that only says "no bump" has
 * told you nothing. This says WHICH gate refused.
 */
export async function rampDiagnosis(): Promise<{
  planId: string | null;
  signals: Record<string, boolean>;
  details: Record<string, unknown>;
  blockedBy: string[];
}> {
  const { pool } = await import('@/lib/db/pool');
  const { detectRampSignals } = await import('@/lib/plan/adaptive-ramp');
  const plan = (await pool.query<{ id: string; authored_state: Record<string, unknown> }>(
    `SELECT id, authored_state FROM training_plans
      WHERE user_uuid = $1::uuid AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [OWNER_UUID],
  )).rows[0];
  if (!plan) return { planId: null, signals: {}, details: {}, blockedBy: ['no active plan'] };

  const s = await detectRampSignals(OWNER_UUID, { id: plan.id, authoredState: plan.authored_state });
  const signals: Record<string, boolean> = {
    acwrHeadroom: s.acwrHeadroom,
    lastQualityOnPace: s.lastQualityOnPace,
    lastLongClean: s.lastLongClean,
    belowTierUpper: s.belowTierUpper,
    noBumpRecent: s.noBumpRecent,
  };
  return {
    planId: plan.id,
    signals,
    details: s.details as unknown as Record<string, unknown>,
    blockedBy: Object.entries(signals).filter(([, v]) => !v).map(([k]) => k),
  };
}

/** The upward volume path, called the way the cron calls it. */
export async function bump(pullbackApplied = false) {
  const { tryAdaptiveBump } = await import('@/lib/plan/adaptive-ramp');
  return tryAdaptiveBump(OWNER_UUID, pullbackApplied);
}

/**
 * The pace axis. Re-derives every future prescription from a new anchor.
 *
 * REANCHORPROPOSES-1 (2026-09-05) · declares `RUNNER_ACCEPTED`, because that is
 * the class of the ONLY production path that now reaches this function
 * standalone: the runner tapping accept on a reprice card
 * (`applyReanchorProposal`) or answering the race-authority question. The
 * harness stands in for him. It does not declare `COACHING_ADAPTATION`, which
 * `mutationIsPermitted` refuses while the seam is closed — that is the
 * `apply()` wrapper below, whose whole job is to prove the refusal still holds.
 */
export async function repaceTo(planId: string, vdot: number) {
  const { recomputePacesForPlan } = await import('@/lib/plan/recompute-paces');
  return recomputePacesForPlan(planId, vdot, {
    source: 'adaptation-harness',
    authority: 'RUNNER_ACCEPTED',
  });
}

/** The missed-session detector, alone. */
export async function detectMissed() {
  const { detectMissedKeyWorkout } = await import('@/lib/plan/adapt');
  return detectMissedKeyWorkout(OWNER_UUID);
}

/** The weekly progression cycle's loader — null when the cycle cannot run. */
export async function loadProgression() {
  const { loadProgressionWeek } = await import('@/lib/plan/progression-pass');
  return loadProgressionWeek(OWNER_UUID);
}

/** Apply an action list through the canonical path, with the mutation boundary. */
export async function apply(actions: Awaited<ReturnType<typeof detect>>['actions']) {
  const { applyAdaptations } = await import('@/lib/plan/adapt');
  return applyAdaptations(OWNER_UUID, actions, 'COACHING_ADAPTATION');
}
