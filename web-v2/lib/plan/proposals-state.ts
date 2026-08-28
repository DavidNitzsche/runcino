/**
 * lib/plan/proposals-state.ts · loader for plan_proposals · the
 * autonomous-rebuild audit + accept/dismiss surface.
 *
 * Read by FaffSeed so the Today view can render:
 *   · Pending proposals (drift_cron → user accepts or dismisses)
 *   · Recent auto_applied rows (immediate-fire hooks → "we rebuilt
 *     your plan because X" notification)
 *
 * Mirrors lib/coach/proposals-state.ts which already powers the
 * illness/injury accept-decline cards.
 */

import { pool } from '@/lib/db/pool';
import { describeDelta, type PlanDelta } from './plan-delta';

export type PlanProposalKind =
  | 'volume_drift'
  | 'vdot_drift'
  | 'staleness'
  // 2026-08-17 · truth-bug fix · the drift cron now writes its TRUE
  // kind (per-axis drift + goal-gap included) instead of a synthetic
  // 'goal_time_changed', which mislabeled a staleness observation as
  // "Goal time updated" and defeated the next-day dedupe.
  | 'easy_drift'
  | 'long_drift'
  | 'quality_drift'
  | 'goal_gap_widening'
  | 'race_date_changed'
  | 'goal_time_changed'    // reserved for ACTUAL goal edits
  | 'a_race_added'
  | 'a_race_removed'
  // 2026-08-17 · coaching-loop reconciliation
  | 'goal_renegotiation'   // unclosable gap sustained ≥5d · revised target band, ambition stays
  | 'pace_reanchor'        // training-drift fitness regression · propose a re-anchor rebuild
  // 2026-08-25 · THE KINDS THE WRITERS ALREADY STAMP AND THIS TYPE DENIED.
  //
  // `AutoRebuildKind` (lib/plan/auto-rebuild.ts) and the settings path have
  // written these to `plan_proposals.proposal_kind` for months. This union
  // never listed them, which made `synthesizeMessage` below LOOK exhaustive to
  // the compiler while returning `undefined` at runtime for every one of them:
  // an auto-applied notice card with a title and an empty body, on a surface
  // whose entire job is to say what just changed to the runner's plan.
  //
  // Verified against prod on 2026-08-25: five `plan_change` rows carry no
  // `reasons.message`, and `rebuildActivePlanForPrefs` writes `replan` the
  // same way. A settings change is one of the paths that rewrites a block
  // without the runner watching it happen — the least acceptable place for a
  // blank explanation.
  | 'replan'               // a settings/prefs change rebuilt the block
  /** The plan-change sheet. Written by replan-scenarios.ts already stamped
   *  'accepted', because it records a change the RUNNER made rather than asking
   *  them anything. Never renders as a card; listed so the loader can describe
   *  the row rather than returning undefined for it. */
  | 'plan_change'
  | 'race_graduate'        // goal race finished · graduated to the next one
  | 'recovery_complete'    // recovery block finished · rebuilt toward the race
  | 'plan_elapsed'         // plan ran out of prescribed days · rebuilt toward the goal
  | 'maintenance_to_raceprep'   // race entered its build window
  // 2026-08-28 · RACEROLE-1 · a tune-up race inside the build is ~14 days out
  // and the coach recommends how to RUN it (B effort / honest race / convert
  // to the MP long · Research/REVIEW_NOTES.md A2). Always pending — the plan
  // only moves if the runner accepts; expiry means the authored composition
  // stands.
  | 'race_role'
  // 2026-08-28 · the operator code-upgrade rebuild now writes its audit row
  // through fireAutoRebuild (it was the one plan writer POST /api/plan/undo
  // could not pair, and returned not_undoable for). The row is what makes it
  // undoable; the card it puts up for 24h is the price of that, accepted.
  | 'silent_rebuild';

export type PlanProposalStatus =
  | 'pending'
  | 'auto_applied'
  | 'accepted'
  | 'dismissed'
  | 'superseded'
  | 'expired'              // 2026-08-17 · pending >14d, expired by the drift cron
  // 2026-08-25 · THE TWO OUTCOMES A REBUILD COULD NOT PREVIOUSLY RECORD.
  //
  // 'no_change' · the engine ran, composed a block identical to the one the
  //   runner already had, and rolled back rather than archiving a live block
  //   to replace it with itself. Never surfaces — `loadPlanProposals` selects
  //   pending and auto_applied only — because there is nothing to tell anyone.
  //   It is here so `?all=1` can answer "did the cron look at me last night".
  //
  // 'undone' · the runner put the previous block back. Carries
  //   `reasons.undone_fingerprint`, which is what stops the next rebuild from
  //   re-landing the exact block they rejected. Also never surfaces: an undo
  //   is a thing the runner did, not news for them.
  | 'no_change'
  | 'undone';

export interface PlanProposal {
  id: number;
  planId: string | null;
  /** 2026-06-02 · explicit alias for `planId` on auto_applied rows ·
   *  for those rows planId = the OLD plan that just got archived (the
   *  `from` side of the diff). Named `previousPlanId` so the diff page
   *  can read `proposal.previousPlanId` without spelunking the schema. */
  previousPlanId: string | null;
  newPlanId: string | null;
  kind: PlanProposalKind;
  status: PlanProposalStatus;
  source: string;
  /** Canonical reasons blob. Includes plain-language `message` field
   *  when the cron writer surfaced one. */
  reasons: Record<string, unknown>;
  /** Plain-language explanation for the runner. Always populated · the
   *  loader synthesizes a fallback when reasons.message isn't set. */
  message: string;
  /** Severity 0-1 for soft-drift kinds. Null for hard-drift kinds
   *  (which are inherently severity-1). */
  severity: number | null;
  createdAt: string;
  resolvedAt: string | null;
}

/**
 * Pending proposals + recently auto-applied ones the runner should
 * see. Returns up to 5, sorted by:
 *   1. status (pending first · auto_applied second)
 *   2. severity desc (highest impact first)
 *   3. created_at desc
 *
 * Hard-drift kinds (race_*, goal_*, a_race_*) get severity 1.0 so
 * they sort to the top regardless of soft-drift severity scores.
 */
/** The `plan_proposals` columns both reads select. */
interface ProposalRow {
  id: number;
  plan_id: string | null;
  new_plan_id: string | null;
  proposal_kind: PlanProposalKind;
  status: PlanProposalStatus;
  source: string;
  reasons: Record<string, unknown> | null;
  created_at: Date | string;
  resolved_at: Date | string | null;
}

/** Row → `PlanProposal`. One translation, so two reads cannot disagree. */
function toProposal(r: ProposalRow): PlanProposal {
  const reasons = r.reasons ?? {};
  const severityRaw = typeof reasons.severity === 'number' ? reasons.severity : null;
  return {
    id: r.id,
    planId: r.plan_id,
    previousPlanId: r.plan_id,
    newPlanId: r.new_plan_id,
    kind: r.proposal_kind,
    status: r.status,
    source: r.source,
    reasons,
    message: synthesizeMessage(r.proposal_kind, r.status, reasons),
    severity: isHardDriftKind(r.proposal_kind) ? 1.0 : severityRaw,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    resolvedAt: r.resolved_at instanceof Date ? r.resolved_at.toISOString()
      : r.resolved_at ? String(r.resolved_at) : null,
  };
}

/** Pending before auto_applied before everything else, then severity, then recency. */
function sortProposals(proposals: PlanProposal[]): PlanProposal[] {
  return [...proposals].sort((a, b) => {
    const statusRank = (s: PlanProposalStatus) =>
      s === 'pending' ? 0 : s === 'auto_applied' ? 1 : 2;
    const sa = statusRank(a.status);
    const sb = statusRank(b.status);
    if (sa !== sb) return sa - sb;
    const va = a.severity ?? 0;
    const vb = b.severity ?? 0;
    if (va !== vb) return vb - va;
    return Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
}

export async function loadPlanProposals(userId: string): Promise<PlanProposal[]> {
  const rows = (await pool.query<ProposalRow>(
    // 2026-06-02 · auto_applied banners auto-clear after 24h per the
    // PlanProposalCard doctrine note ("stays up for 24h then hides").
    // Pending proposals stay 14d so the runner has time to accept /
    // dismiss; auto_applied are informational records that should
    // fade once read. The DB row stays · only the surface stops
    // rendering it. Audit + diff-page deep links still work.
    `SELECT id, plan_id, new_plan_id, proposal_kind, status, source,
            reasons, created_at, resolved_at
       FROM plan_proposals
      WHERE user_uuid = $1
        AND (
          (status = 'pending'      AND created_at >= NOW() - interval '14 days') OR
          (status = 'auto_applied' AND created_at >= NOW() - interval '24 hours')
        )
      ORDER BY status ASC, created_at DESC
      LIMIT 20`,
    [userId],
  ).catch(() => ({ rows: [] as ProposalRow[] }))).rows;

  return sortProposals(rows.map(toProposal)).slice(0, 5);
}

/**
 * Every recent proposal, resolved rows included · the debug/audit read behind
 * `GET /api/plan/proposal?all=1` (2026-08-17).
 *
 * `loadPlanProposals` above is the SURFACE read: it hides resolved rows and an
 * auto-applied banner after 24 hours, because that is what a Today card should
 * show. When you are trying to work out why a plan rebuilt itself last Tuesday,
 * those are exactly the rows you need. Same mapping, same sort, wider window —
 * the row → `PlanProposal` translation is shared so the two reads can never
 * describe the same row differently.
 */
export async function loadAllPlanProposals(
  userId: string,
  limit = 25,
): Promise<PlanProposal[]> {
  const rows = (await pool.query<ProposalRow>(
    `SELECT id, plan_id, new_plan_id, proposal_kind, status, source,
            reasons, created_at, resolved_at
       FROM plan_proposals
      WHERE user_uuid = $1
        AND created_at >= NOW() - interval '180 days'
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, Math.max(1, Math.min(100, limit))],
  ).catch(() => ({ rows: [] as ProposalRow[] }))).rows;
  return sortProposals(rows.map(toProposal));
}

/**
 * 2026-08-27 · THE PROPOSAL THAT OUTLIVED ITS PLAN.
 *
 * Archiving a plan (`clearActivePlansFor`, the race-completed archive in
 * result-chain.ts, the plan-elapsed archive in the drift cron, injury-builder,
 * onboarding reseed) never touched `plan_proposals`. A pending proposal points
 * at a `plan_id` by TEXT reference with no FK, so nothing broke — the row just
 * sat there, `status = 'pending'`, surfacing on Today as a live decision for
 * up to 14 days after the plan it was computed against had already been
 * replaced, sometimes more than once. `goal_renegotiation` proposal 53 sat
 * that way for 5 days across two intervening rebuilds before this was caught.
 *
 * Called right after every "archive the active plan(s) for this user" write,
 * on the SAME client/transaction where one is open, so a proposal can never
 * observe a plan as archived before this has also marked it stale. Scoped by
 * `user_uuid` rather than a specific plan id: whichever plan(s) just went
 * archived, ANY pending proposal still pointing at an archived plan for this
 * user is equally stale, including ones orphaned by an earlier bug before this
 * function existed.
 */
export async function supersedeProposalsForArchivedPlans(
  client: { query: typeof pool.query },
  userUuid: string,
): Promise<number> {
  const result = await client.query(
    `UPDATE plan_proposals p
        SET status = 'superseded', resolved_at = NOW()
       FROM training_plans tp
      WHERE p.plan_id = tp.id
        AND p.user_uuid = $1
        AND p.status = 'pending'
        AND tp.archived_iso IS NOT NULL`,
    [userUuid],
  );
  return result.rowCount ?? 0;
}

/**
 * 2026-08-28 · THE SAME SUPERSEDE, FOR coach_intents.
 *
 * The function above closes the dangling-proposal shape; coach_intents had
 * the identical shape with nothing closing it. An intent row's `field` holds
 * a `plan_workouts.id`; when the plan is archived those rows keep pointing at
 * workouts nothing renders, and the PENDING ones (`acknowledged_at IS NULL`)
 * keep feeding the briefing voice changes made to a plan that no longer
 * exists. `silent-rebuild` acked its own archived plan's intents by hand;
 * every other archive path (drift rebuilds, result-chain, injury-builder,
 * onboarding reseed, generate) left them dangling.
 *
 * Mark, don't delete: `superseded_at` (migration 157, additive) records that
 * the workout this intent points at left the active plan, and
 * `acknowledged_at` is back-filled so a stale banner stops surfacing — the
 * same stamp the silent-rebuild ack has always used. Rows the detectors read
 * by reason + ts as idempotency markers (gap markers, progression week
 * markers) are untouched in every column those reads consult.
 *
 * Scoped like its sibling: ANY plan_adapt_* intent still pointing at an
 * archived plan's workout, so a nightly sweep also heals rows orphaned before
 * this existed. Callers treat it as best-effort (catch-guarded) — it names a
 * column that lands with migration 157, and a plan archive must never fail on
 * the audit stamp.
 */
export async function supersedeIntentsForArchivedPlans(
  client: { query: typeof pool.query },
  userUuid: string,
): Promise<number> {
  const result = await client.query(
    `UPDATE coach_intents ci
        SET superseded_at = NOW(),
            acknowledged_at = COALESCE(ci.acknowledged_at, NOW())
      WHERE COALESCE(ci.user_uuid, ci.user_id) = $1::uuid
        AND ci.superseded_at IS NULL
        AND ci.reason LIKE 'plan_adapt_%'
        AND ci.field IN (
          SELECT pw.id FROM plan_workouts pw
            JOIN training_plans tp ON tp.id = pw.plan_id
           WHERE tp.user_uuid = $1::uuid
             AND tp.archived_iso IS NOT NULL
        )`,
    [userUuid],
  );
  return result.rowCount ?? 0;
}

function isHardDriftKind(kind: PlanProposalKind): boolean {
  return kind === 'race_date_changed'
      || kind === 'goal_time_changed'
      || kind === 'a_race_added'
      || kind === 'a_race_removed'
      // 2026-08-17 · a sustained-unclosable renegotiation is the highest-
      // stakes card the engine writes · never buried under soft drift.
      || kind === 'goal_renegotiation'
      // 2026-08-28 · RACEROLE-1 · a race-role card has a hard deadline (the
      // race itself, ~14 days out when it fires) · never buried under drift.
      || kind === 'race_role';
}

/**
 * 2026-08-25 · WHAT MOVED, THEN WHY.
 *
 * `reasons.message` is the drift DETECTOR's sentence. It answers why. It never
 * answered what, and on 2026-08-25 that was the whole gap: the runner's block
 * was replaced overnight and the most any surface could have told him was
 * "your long runs have drifted from this plan's targets" — true, and no help
 * at all in working out that his week had gone from 23 miles to 38.
 *
 * `reasons.plan_delta` is written by the rebuild itself, from both persisted
 * blocks, and is the missing half. Where it exists it leads, because the first
 * thing a runner needs is the number that changed.
 *
 * Returns null when there is no delta, which is the normal case for a PENDING
 * proposal: nothing has happened yet, so nothing has moved.
 */
function deltaSentence(kind: PlanProposalKind, reasons: Record<string, unknown>): string | null {
  const raw = reasons.plan_delta;
  if (raw == null || typeof raw !== 'object') return null;
  return describeDelta(raw as PlanDelta, kind);
}

/**
 * The applied voice, per kind.
 *
 * The switch at the bottom of this file is written for a PROPOSAL: it tells the
 * runner what the engine noticed and what it would like to do ("Refit for an
 * honest target"). Once the rebuild has already happened that reads as an
 * instruction the runner cannot act on, so an auto-applied row says the same
 * observation in the past tense and asks for nothing.
 *
 * Nothing here scolds. "Your easy days run longer than this plan prescribes" is
 * a fine thing to say to someone deciding whether to refit, and the wrong thing
 * to say to someone who has just been told their week was rewritten overnight.
 */
const APPLIED_WHY: Partial<Record<PlanProposalKind, string>> = {
  volume_drift: 'Your recent weeks had moved away from what this block was built on.',
  vdot_drift: 'Your pace targets had drifted from current fitness.',
  staleness: 'The block was more than eight weeks old.',
  easy_drift: 'Your easy days had settled longer than the block prescribed.',
  long_drift: 'Your long runs had moved past what the block prescribed.',
  quality_drift: 'Your quality sessions had moved away from the block’s targets.',
  goal_gap_widening: 'The projection had been drifting away from the goal.',
};

function synthesizeMessage(
  kind: PlanProposalKind,
  status: PlanProposalStatus,
  reasons: Record<string, unknown>,
): string {
  const what = deltaSentence(kind, reasons);
  const why = typeof reasons.message === 'string' && reasons.message.length > 0
    ? reasons.message
    : null;

  if (status === 'auto_applied') {
    const appliedWhy = APPLIED_WHY[kind] ?? why;
    if (what && appliedWhy) return `${what} ${appliedWhy}`;
    if (what) return what;
    if (appliedWhy) return appliedWhy;
  }

  if (why) return what ? `${what} ${why}` : why;
  if (what) return what;

  // Fallback copy per kind · plain English.
  switch (kind) {
    case 'volume_drift':
      return 'Your recent weekly volume has drifted from this plan\'s baseline. Refit for an honest target.';
    case 'vdot_drift':
      return 'Your current VDOT has drifted from this plan\'s anchor. Pace targets are stale.';
    case 'staleness':
      return 'This plan was authored more than 8 weeks ago. Time for a refresh.';
    case 'easy_drift':
      return 'Your easy days run longer than this plan prescribes. Refit so the plan matches reality.';
    case 'long_drift':
      return 'Your long runs have drifted from this plan\'s targets. Refit for an honest progression.';
    case 'quality_drift':
      return 'Your quality sessions have drifted from this plan\'s targets. Refit the work.';
    case 'goal_gap_widening':
      return 'The projection is drifting away from the goal. Rebuild to close the gap.';
    case 'race_date_changed':
      return status === 'auto_applied'
        ? 'Race date changed · plan timeline rebuilt automatically.'
        : 'Race date changed · plan needs a refit.';
    case 'goal_time_changed':
      return status === 'auto_applied'
        ? 'Goal time changed · pace targets rebuilt automatically.'
        : 'Goal time changed · plan needs a refit.';
    case 'a_race_added':
      return status === 'auto_applied'
        ? 'A new goal race was added · plan rebuilt to point at it.'
        : 'A new goal race was added · plan needs a refit.';
    case 'a_race_removed':
      return 'Your goal race was removed · pick a new A-race to keep training meaningful.';
    case 'goal_renegotiation':
      return 'The gap to your goal is wider than the remaining weeks can close. A revised race target is recommended. The goal stays on the board as the season ambition.';
    case 'pace_reanchor':
      return 'Training evidence reads below the plan\'s pace anchor. Recommend re-anchoring paces to current fitness.';
    case 'replan':
    case 'plan_change':
      return status === 'auto_applied'
        ? 'Your training settings changed · the block was rebuilt around them.'
        : 'Your training settings changed · the block needs a rebuild.';
    case 'race_graduate':
      return 'Your goal race is behind you · the block was rebuilt toward the next one.';
    case 'recovery_complete':
      // The pending shape exists again since 2026-08-28: the auto path falls
      // back to a card when the runner undid this block or is compromised.
      // Past tense on a card that is ASKING was the dead-end copy bug.
      return status === 'auto_applied'
        ? 'Your recovery block finished · the next block was built toward your race.'
        : 'Your recovery block finished · accept to start the build toward your race.';
    case 'plan_elapsed':
      return status === 'auto_applied'
        ? 'Your block ran out of prescribed days · a new one was built toward your goal.'
        : 'Your block ran out of prescribed days · accept to build the next one.';
    case 'maintenance_to_raceprep':
      return 'Your race entered its build window · maintenance gave way to race-prep.';
    case 'race_role':
      // The cron always writes reasons.message (the full coach copy), so this
      // fallback is for rows that lost it. Accepted rows read as a record.
      return status === 'accepted'
        ? 'Race role set · the week around the tune-up was adjusted to match.'
        : 'A tune-up race inside your build is two weeks out. The coach has a recommendation for how to run it.';
    case 'silent_rebuild':
      return 'The plan engine was updated · your block was rebuilt around the same goal. Undo puts the old block back.';
  }
  // 2026-08-25 · A REAL DEFAULT, NOT AN IMPLICIT `undefined`.
  //
  // The switch above used to end here with nothing. TypeScript read it as
  // exhaustive over `PlanProposalKind` and let the function fall off the end,
  // so any kind a writer stamped that this union did not list returned
  // `undefined` — and `PlanProposal.message` is documented three fields up as
  // "Always populated". It was not.
  //
  // The union is now wide enough to cover every writer, so this line should be
  // unreachable. It exists because the last time this was unreachable it was
  // not: a runner's plan changed and the card explaining it rendered blank.
  // The next kind someone adds gets an honest sentence instead of an empty one.
  return 'Your training plan changed. Open the plan to see what moved.';
}
