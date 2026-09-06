/**
 * POST /api/plan/change · the design's "Change the plan" sheet.
 *
 * ─── the interaction the design draws ───────────────────────────────────────
 *
 * The Block screen's "Change the plan" row opens a bottom sheet: pick a
 * scenario, read the coach's stated trade-off, then confirm or back out. So
 * this endpoint has two halves and one body shape.
 *
 *   POST { scenario, ...params }                → PROPOSE. Nothing is written.
 *   POST { scenario, ...params, confirm, token} → APPLY, if the plan has not
 *                                                 moved since the propose.
 *
 * The same request produces the same proposal, so the second call re-derives
 * exactly what the first one described rather than trusting a cached blob. The
 * `token` from the propose is a hash of the plan's structural state plus the
 * request; a confirm carrying a stale one gets a 409 and the runner is told to
 * look again, because a change applied to a plan the runner never read is
 * indistinguishable to them from a bug.
 *
 * ─── the five scenarios ─────────────────────────────────────────────────────
 *
 *   cutback       { weekIdx? }                 · a named week deloads
 *   travel        { fromISO, toISO }           · days the runner cannot run
 *   extra_day     { dow, fromWeekIdx? }        · one more running day a week
 *   move_day      { dateISO, toDateISO }       · a session changes day
 *   another_race  { raceSlug }                 · a B or C race joins the block
 *
 * Four of them edit the live plan. `another_race` does not: embedding a
 * mid-block race is already implemented end to end (`embedMidBlockRaces`,
 * reached through `fireAutoRebuild({kind:'a_race_added'})`, the same path
 * `POST /api/race` fires), and writing a second one would be two engines for
 * one job. What this endpoint adds there is the half the design asks for and
 * that path has never had: the consequence stated BEFORE it happens, and a
 * confirm.
 *
 * ─── what it will not do ────────────────────────────────────────────────────
 *
 * Every write goes through `lib/plan/mutate.ts`, so a change that introduces a
 * doctrine violation rolls back whole and comes back as a 409 carrying the
 * violation strings. Daniels' weekly dosing caps are checked before the
 * boundary is even entered — `validateComposedPlan` treats §10 as advisory and
 * `mutatePlan` does not request it, so a cutback or an extra day that pushed a
 * week past the share caps would otherwise have committed quietly.
 *
 * A refusal always carries a reason. Nothing here fails silently.
 *
 * ─── MOVEREADJUDICATE-1 (2026-09-05) · move_day is now re-adjudicated ──────
 *
 * `move_day` moves a `plan_workouts.date_iso`, and until this change it did so
 * through `planMoveDay` alone — its own local checks (a rest-day destination,
 * the stimulus gap, the week's longest run), NONE of which read the race
 * calendar, demand, the reassessment queue, or the sequence layer's one-
 * stressor-at-a-time detector. `lib/brain/orchestration/_move_readjudication.
 * test.ts`'s mover census named this route's `move_day` scenario as one of the
 * two paths still bypassing re-adjudication.
 *
 * The fix does NOT replace `planMoveDay` or `applyChange`'s own mutation path
 * — that stays exactly as it is, still routed through `mutatePlan`, which
 * already lands an atomic ledger row on every commit (LEDGERATOMIC-1). What
 * this adds is a GATE in front of it: before either a propose or a confirm is
 * allowed to proceed, `readjudicateMove` runs the same nine checks Move-a-Run
 * runs, and a REFUSED verdict (a discrete fact — the destination is inside a
 * taper, the move breaks hard-session spacing, a long run would land beside a
 * race) stops the request here, before `proposeChange`/`applyChange` ever see
 * it. An INCOMPLETE or COSTED verdict does not block, matching `applyMove`'s
 * own policy in the orchestrated surface (Rule 16 — one policy for one
 * decision) — only a REFUSED verdict, a discrete fact, blocks; a check that
 * could not run is reported, not treated as a silent refusal.
 *
 * The gate is READ-ONLY (`readjudicateMove` opens no transaction) and runs on
 * every call, propose and confirm alike, so a race added between the two does
 * not slip a since-refused move through on a stale token check.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { fireAutoRebuild } from '@/lib/plan/auto-rebuild';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';
import {
  proposeChange,
  applyChange,
  loadPlanShape,
  CHANGE_SCENARIOS,
  type ChangeRequest,
  type ChangeScenario,
} from '@/lib/plan/replan-scenarios';
import { timelineOf } from '@/lib/plan/reschedule';
import { readjudicateMove, verdictOf, allFindings } from '@/lib/brain/orchestration/move-orchestrator';
import { checksThatCouldNotRun, type ReadjudicationReport } from '@/lib/coaching-contract/move-readjudication';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const STATUS: Record<string, number> = {
  no_plan: 404,
  bad_request: 400,
  unavailable: 422,
  plan_moved: 409,
  rejected: 409,
  dosing_breach: 409,
  rebuild_failed: 500,
};

/** Rule 11 · serialise the report WITH what could not run, matching /api/plan/move's
 *  own `wire()` — a surface that printed only the findings would show an INCOMPLETE
 *  re-adjudication as a clean one. */
function wireReadjudication(report: ReadjudicationReport) {
  return {
    verdict: verdictOf(report),
    weeks: report.weeks,
    findings: allFindings(report),
    could_not_run: checksThatCouldNotRun(report),
    better_date: report.betterDate,
  };
}

/**
 * The re-adjudication gate for `move_day`. Returns a refusal response when the
 * move is blocked on a discrete fact; returns null (proceed) otherwise,
 * carrying the report along so the caller can attach it to a successful
 * response too.
 */
async function moveDayReadjudication(
  userId: string, todayISO: string, dateISO: string, toDateISO: string,
): Promise<{ block: NextResponse | null; report: ReadjudicationReport | null }> {
  const shape = await loadPlanShape(userId);
  if (!shape) return { block: null, report: null }; // let the existing "no_plan" path answer
  const target = timelineOf(shape).byDate.get(dateISO);
  if (!target) return { block: null, report: null }; // let planMoveDay's own "nothing prescribed" answer

  const report = await readjudicateMove({
    userUuid: userId,
    todayISO,
    move: { planWorkoutId: target.id, fromISO: target.dateISO, toISO: toDateISO, optionId: null },
  });
  if (verdictOf(report) !== 'REFUSED') return { block: null, report };

  const reason = allFindings(report).filter((f) => f.severity === 'REFUSES').map((f) => f.what).join(' ')
    || 'That move was refused on re-adjudication.';
  return {
    block: NextResponse.json(
      { ok: false, error: 'unavailable', reason, readjudication: wireReadjudication(report) },
      { status: 422 },
    ),
    report,
  };
}

function readRequest(body: Record<string, unknown> | null): ChangeRequest | null {
  const scenario = String(body?.scenario ?? '') as ChangeScenario;
  if (!CHANGE_SCENARIOS.includes(scenario)) return null;
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
  return {
    scenario,
    weekIdx: num(body?.weekIdx),
    fromWeekIdx: num(body?.fromWeekIdx),
    dow: num(body?.dow),
    fromISO: str(body?.fromISO),
    toISO: str(body?.toISO),
    raceSlug: str(body?.raceSlug),
    dateISO: str(body?.dateISO),
    toDateISO: str(body?.toDateISO),
  };
}

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const request = readRequest(body);
  if (!request) {
    return NextResponse.json(
      { ok: false, error: 'bad_request', reason: `scenario must be one of ${CHANGE_SCENARIOS.join(', ')}` },
      { status: 400 },
    );
  }

  const todayISO = await runnerToday(userId);
  const confirm = body?.confirm === true;

  // MOVEREADJUDICATE-1 · re-adjudicate move_day before either half proceeds.
  // See this file's header. A REFUSED verdict stops here; anything else
  // (CLEAR / COSTED / INCOMPLETE) falls through to the existing propose/apply
  // path unchanged, and the report — when one was produced — rides along on
  // the eventual success response.
  let moveDayReport: ReadjudicationReport | null = null;
  if (request.scenario === 'move_day' && request.dateISO && request.toDateISO) {
    const gate = await moveDayReadjudication(userId, todayISO, request.dateISO, request.toDateISO);
    if (gate.block) return gate.block;
    moveDayReport = gate.report;
  }

  if (!confirm) {
    const out = await proposeChange(userId, todayISO, request);
    if (!out.ok) {
      return NextResponse.json(
        { ok: false, error: out.code, reason: out.reason, ...(out.detail ? { detail: out.detail } : {}) },
        { status: STATUS[out.code] ?? 400 },
      );
    }
    return NextResponse.json({
      ok: true,
      applied: false,
      ...out.proposal,
      ...(moveDayReport ? { readjudication: wireReadjudication(moveDayReport) } : {}),
    });
  }

  const out = await applyChange(userId, todayISO, request, typeof body?.token === 'string' ? body.token : null, {
    // The one path that is a re-author rather than an edit. Same call
    // `POST /api/race` makes, so a race added from this sheet and a race added
    // from the race screen reach the generator identically.
    rebuild: async ({ userUuid, raceSlug }) => {
      const target = await resolveTargetSlug(userUuid);
      if (!target) {
        return { ok: false, reason: 'This block is not built toward a race, so there is nothing to rebuild around.' };
      }
      const r = await fireAutoRebuild({
        userUuid,
        raceSlug: target,
        kind: 'a_race_added',
        reasons: { added_race: raceSlug, source: 'plan-change-sheet' },
        source: 'plan_change_sheet',
      });
      return { ok: r.ok, reason: r.reason, oldPlanId: r.oldPlanId, newPlanId: r.newPlanId };
    },
  });

  if (!out.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: out.code,
        reason: out.reason,
        ...(out.violations ? { violations: out.violations } : {}),
        ...(out.findings ? { findings: out.findings } : {}),
      },
      { status: STATUS[out.code] ?? 400 },
    );
  }

  await bustBriefingCacheForEvent(userId, 'plan_swap').catch(() => {});

  return NextResponse.json({
    ok: true,
    applied: true,
    ...out.proposal,
    planId: out.planId,
    ...(out.rebuiltPlanId ? { rebuiltPlanId: out.rebuiltPlanId } : {}),
    ...(out.diffUrl ? { diffUrl: out.diffUrl } : {}),
    ...(moveDayReport ? { readjudication: wireReadjudication(moveDayReport) } : {}),
  });
}

/** The race this block is built toward · `fireAutoRebuild` keys off it. */
async function resolveTargetSlug(userUuid: string): Promise<string | null> {
  const { pool } = await import('@/lib/db/pool');
  const r = (await pool.query<{ race_id: string | null }>(
    `SELECT race_id FROM training_plans
      WHERE user_uuid = $1::uuid AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userUuid],
  ).catch(() => ({ rows: [] as Array<{ race_id: string | null }> }))).rows[0];
  return r?.race_id ?? null;
}
