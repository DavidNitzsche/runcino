// POST /api/cron/pace-drift-monitor
//
// DECISION 1 (2026-09-06) · the scheduled replacement for
// `_cross_surface_contract.test.ts`'s excluded build-blocking pace check
// (DEPLOYFENCE-1, scripts/check-generated-content.sh). That test still exists
// unchanged and still fails loudly when run directly — this cron is what
// watches the SAME finding on an ongoing schedule instead of on every deploy,
// which is what the owner's ruling asked for: "Replace the excluded
// cross-surface build test with scheduled monitoring that understands this
// state."
//
// "Understands this state" means: a live-vs-persisted pace drift is not
// automatically a defect. Since REANCHORPROPOSES-1, a re-anchor is a
// runner-gated proposal rather than an automatic write, so a persisted anchor
// can legitimately sit stale until the runner accepts. But the owner was
// explicit that this is NOT a blanket tolerance — "Generic 'one reanchor
// cycle of tolerance' is not approved" — so every drift is checked against
// `lib/audit/pace-drift-monitor.ts#explainPaceDrift`'s six named fields
// (before value, after value, plan version, evidence, creation/expiration,
// status) before being waved through. An unexplained drift raises a real
// alert; nothing here silently accepts a number just because it's close.
//
// Two anchors checked: threshold and marathon, the two the excluded test
// currently finds diverging on the reference account. Both compare the LIVE
// resolver against the SAME `authored_state.pace_recompute.anchors` stamp
// the excluded test itself reads as "the persisted number" — one source,
// not a second copy of "what does the plan currently say" (Rule 16).
//
// Schedule (GitHub Actions, to be added by whoever owns the workflow file):
// daily, any time — this reads, it does not depend on ordering against any
// other cron (Rule 23).
//
// ── DECISION 2 (2026-09-07) · UNEXPLAINED + RUNNER-VISIBLE RAISES THE CARD ──
//
// The owner's ruling: "Implement proposal creation only when the calculated
// drift changes a runner-visible rounded prescription... Do not silently
// rewrite accepted paces... require runner acceptance." Every unexplained
// finding for a plan is handed to `lib/audit/pace-drift-autopropose.ts`,
// which raises exactly one coordinated `plan_workout_proposals` card through
// the EXISTING `writeReanchorProposal` writer when at least one finding
// would change what the runner's own screen prints, and writes nothing
// otherwise. This route still never touches `plan_workouts` or
// `training_plans` directly — only the proposal writer's own INSERT can
// fire, and only after this check.

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { recordCronSuccess } from '@/lib/ops/cron-ledger';
import { raiseAlert } from '@/lib/ops/alerts';
import { explainPaceDrift, readPendingRepriceProposal, type PaceDriftFinding } from '@/lib/audit/pace-drift-monitor';
import { autoProposeForUnexplainedDrift } from '@/lib/audit/pace-drift-autopropose';

export const maxDuration = 60;

interface AnchorCheck {
  readonly key: string;
  readonly label: string;
  readonly liveSecPerMi: number | null;
  readonly persistedSecPerMi: number | null;
}

async function checkedAnchorsFor(userUuid: string, todayISO: string, planId: string): Promise<AnchorCheck[]> {
  const { resolveThresholdCapacity } = await import('@/lib/training/capacity-resolver');
  const { resolvePrescribedPaceAnchors } = await import('@/lib/training/load-prescription-anchors');

  const planRow = (await pool.query<{ authored_state: Record<string, unknown> | null }>(
    `SELECT authored_state FROM training_plans WHERE id = $1`, [planId],
  )).rows[0];
  const stamp = (planRow?.authored_state?.['pace_recompute'] as { anchors?: Record<string, unknown> } | undefined)
    ?.anchors;
  if (stamp == null) {
    // No stamp at all is its own, separate fact (Rule 11) — not a drift, and
    // not silently skipped either. Reported as a zero-anchor check below via
    // an empty return; the caller's own liveness accounting sees the plan
    // contributed no checks rather than assuming it agreed.
    return [];
  }

  const anchorRead = await resolvePrescribedPaceAnchors(userUuid, todayISO);
  const A = anchorRead.ok ? anchorRead.anchors : null;
  // No .catch() here — a genuine throw from the resolver is a real failure
  // for THIS plan's check, not "no threshold data", and must not be
  // silently collapsed into the same null a legitimate absence produces
  // (Rule 11). It propagates to the per-plan try/catch in POST below, which
  // already reports it as this plan's own error result rather than a
  // passing, empty check.
  const thresholdCap = await resolveThresholdCapacity(userUuid, todayISO);

  // Two distinguishable sources, never silently coalesced into one number
  // (a resolver that genuinely FAILED and a resolver that agreed are
  // opposite facts, Rule 11): `resolveThresholdCapacity` is the dedicated,
  // canonical resolver and is read first; the composed anchor is read only
  // when that resolver produced no reading AT ALL, an explicit fallback
  // branch rather than a `??` chain.
  let liveThreshold: number | null;
  if (typeof thresholdCap?.paceSecPerMi === 'number') {
    liveThreshold = thresholdCap.paceSecPerMi;
  } else if (typeof A?.thresholdSecPerMi === 'number') {
    liveThreshold = A.thresholdSecPerMi;
  } else {
    liveThreshold = null;
  }
  let liveMarathon: number | null = null;
  if (typeof A?.marathonSecPerMi === 'number') {
    liveMarathon = A.marathonSecPerMi;
  }

  const out: AnchorCheck[] = [];
  const stampedThreshold = stamp['threshold_s_per_mi'];
  if (typeof stampedThreshold === 'number' || typeof stampedThreshold === 'string') {
    out.push({
      key: 'threshold_s_per_mi',
      label: 'threshold pace',
      liveSecPerMi: liveThreshold,
      persistedSecPerMi: Number(stampedThreshold),
    });
  }
  const stampedMarathon = stamp['marathon_s_per_mi'];
  if (typeof stampedMarathon === 'number' || typeof stampedMarathon === 'string') {
    out.push({
      key: 'marathon_s_per_mi',
      label: 'marathon pace',
      liveSecPerMi: liveMarathon,
      persistedSecPerMi: Number(stampedMarathon),
    });
  }
  return out;
}

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'CRON_SECRET not configured.' }, { status: 503 });
  }
  let auth = req.headers.get('authorization');
  if (auth == null) auth = '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (token !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { runnerToday } = await import('@/lib/runtime/runner-tz');

  // No .catch() here — a failure listing active plans is a genuine failure
  // of this whole run, not "there are no active plans" (Rule 11). It is
  // allowed to throw out of this route handler, which reports it as a real
  // 500 rather than a silent, misleadingly-clean "0 plans checked" result.
  const plans = (await pool.query<{ id: string; user_uuid: string }>(
    `SELECT id, user_uuid FROM training_plans
      WHERE archived_iso IS NULL AND user_uuid IS NOT NULL`,
  )).rows;

  const results: Array<{
    userUuid: string;
    planId: string;
    checked: number;
    explained: number;
    unexplained: Array<{ anchorKey: string; reason: string }>;
    autopropose?: string;
    error?: string;
  }> = [];

  for (const { id: planId, user_uuid: userUuid } of plans) {
    try {
      const todayISO = await runnerToday(userUuid);
      const checks = await checkedAnchorsFor(userUuid, todayISO, planId);
      const proposal = await readPendingRepriceProposal(pool, userUuid);
      const unexplained: Array<{ anchorKey: string; reason: string }> = [];
      const unexplainedFindings: PaceDriftFinding[] = [];
      let explainedCount = 0;

      for (const c of checks) {
        if (c.liveSecPerMi == null || c.persistedSecPerMi == null) continue;
        if (c.liveSecPerMi === c.persistedSecPerMi) continue;
        const finding: PaceDriftFinding = {
          anchorKey: c.key,
          persistedSecPerMi: c.persistedSecPerMi,
          liveSecPerMi: c.liveSecPerMi,
          activePlanId: planId,
        };
        const verdict = explainPaceDrift(finding, proposal, new Date().toISOString());
        if (verdict.explained) {
          explainedCount += 1;
        } else {
          unexplained.push({ anchorKey: c.key, reason: verdict.reason });
          unexplainedFindings.push(finding);
        }
      }

      // DECISION 2 (2026-09-07) · only reached when at least one anchor is
      // unexplained. `autoProposeForUnexplainedDrift` itself decides whether
      // any of them is runner-visible before writing anything (see its own
      // header); this is not a second gate duplicating that logic, it is
      // simply not calling the function at all when there is nothing to
      // explain — an empty findings array would just report `not_visible`.
      let autopropose: string | undefined;
      if (unexplainedFindings.length > 0) {
        const outcome = await autoProposeForUnexplainedDrift(userUuid, planId, todayISO, unexplainedFindings);
        switch (outcome.status) {
          case 'not_visible':
            autopropose = 'monitored only · no formatted display change for the runner';
            break;
          case 'no_active_plan':
            autopropose = 'skipped · plan no longer active';
            break;
          case 'anchors_unavailable':
            autopropose = `skipped · anchors unavailable · ${outcome.reason}`;
            break;
          case 'proposed':
            autopropose = `${outcome.outcome.status} · anchors ${outcome.visibleAnchorKeys.join(', ')}`
              + (outcome.outcome.status === 'written' ? ` · card ${outcome.outcome.proposalId}` : '');
            break;
        }
      }

      results.push({
        userUuid, planId, checked: checks.length, explained: explainedCount, unexplained, autopropose,
      });
    } catch (e) {
      results.push({
        userUuid, planId, checked: 0, explained: 0, unexplained: [],
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const totalUnexplained = results.reduce((s, r) => s + r.unexplained.length, 0);
  const totalErrors = results.filter((r) => r.error).length;
  const totalCardsWritten = results.filter((r) => r.autopropose?.startsWith('written')).length;

  // Rule 23 · a job that finds nothing wrong must still be visible, and one
  // that finds a real drift must be LOUD, not a line in a log nobody tails.
  await raiseAlert({
    kind: 'pace_drift_unexplained',
    severity: totalUnexplained > 0 ? 'error' : totalErrors > 0 ? 'warn' : 'info',
    message: totalUnexplained > 0
      ? `${totalUnexplained} unexplained pace drift(s) across ${plans.length} active plan(s) — `
        + `a live anchor disagrees with the persisted plan and no valid pending proposal explains it `
        + `(${totalCardsWritten} raised as a new reprice card this pass)`
      : `pace drift checked across ${plans.length} active plan(s), all explained or agreeing`,
    metadata: {
      plans: plans.length,
      unexplained: totalUnexplained,
      errors: totalErrors,
      cardsWritten: totalCardsWritten,
      detail: results.filter((r) => r.unexplained.length > 0 || r.error).slice(0, 10),
    },
    source: 'cron/pace-drift-monitor',
  }).catch(() => {});

  await recordCronSuccess('pace-drift-monitor', {
    plans: plans.length, unexplained: totalUnexplained, errors: totalErrors, cardsWritten: totalCardsWritten,
  });

  return NextResponse.json({
    ok: true, plans: plans.length, unexplained: totalUnexplained, cardsWritten: totalCardsWritten, results,
  });
}
