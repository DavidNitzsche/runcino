/**
 * lib/training/pace-anchor.ts · THE ONE PACE-ANCHOR AUTHORITY.
 *
 * Two systems rewrite `plan_workouts.pace_target_s_per_mi` on the same
 * morning with no shared lock:
 *
 *   · the 03:00 adapter (`lib/plan/adapt.ts` · pr_bank / fitness_regression /
 *     training_lead → `recompute_paces`), and
 *   · the 07:30 self-heal (`lib/plan/reanchor-plan.ts` · `reanchorActivePlan`,
 *     called from the projection cron).
 *
 * Until 2026-08-28 each carried its own thresholds and its own anchor
 * cascade, and the only dedupe between them was `recordPaceZoneEvent`'s
 * rounding. This module is where the policy now lives; both consult it.
 *
 * ── THE THRESHOLD POLICY, IN ONE PLACE ──────────────────────────────────────
 *
 *   RACE_EVIDENCE_REANCHOR_DELTA = 1.5
 *     A race result moves the anchor when it reads more than 1.5 VDOT away
 *     from it, in either direction (pr_bank upward, fitness_regression's race
 *     arm downward). Research/01 §"Triggers to retest" puts a single training
 *     signal at −1 to −2 VDOT, so 1.5 is one honest evidence step. Race
 *     evidence additionally passes the representativeness gate
 *     (`lib/race/representativeness.ts`) before the delta is measured.
 *
 *   TRAINING_LEAD_REANCHOR_DELTA = 1.0
 *     Training evidence alone may move the anchor exactly one point upward
 *     (Research/01 §"Triggers to retest": "Add 1 VDOT point; re-derive
 *     paces"), and only with the corroboration gates `detectTrainingLead`
 *     applies (≥2 sessions across ≥14 days, newest ≤28 days old). Deliberately
 *     NOT the mirror of the race threshold — doctrine is heavier downward
 *     than upward, and the doctrine registry (SYNTH.training-lead-*) fails
 *     the build if that ordering inverts.
 *
 *   SELF_HEAL_REANCHOR_DELTA = 2.0
 *     The daily self-heal's fitness-shift threshold. Wider than both adapter
 *     gates ON PURPOSE: the self-heal has no evidence-kind context (it sees
 *     one blended `bestRecentVdot` number), so it acts only on a move too
 *     large to be candidate-set jitter. Anything between 1.0 and 2.0 is the
 *     adapter's business, where the evidence kind is known and the right
 *     gate can be applied.
 *
 * ── WHO YIELDS WHEN BOTH WOULD FIRE ─────────────────────────────────────────
 *
 * The adapter runs first (03:00) and is the more informed writer, so the
 * 07:30 self-heal DEFERS to any anchor the adapter moved within the last
 * `ADAPTER_ANCHOR_DEFER_HOURS` — unless the self-heal's own move is strictly
 * more authoritative, which is exactly one case: upgrading a provisional /
 * unaccounted anchor to a measured one. That upgrade must still fire (it is
 * what ends the calibration intro), and the adapter cannot have done it —
 * every adapter re-anchor is already measured-evidence-only.
 *
 * The adapter's move is detected from its own durable record — the
 * `plan_adapt_recompute_paces` coach_intents row `applyAdaptations` writes in
 * the same transaction as the pace rewrite. No new state.
 */
import { paceBlendAnchorIsProvisional } from '@/lib/plan/anchor-provenance';
import type { pool } from '@/lib/db/pool';

/** Race evidence (representativeness-gated) moves the anchor at |Δ| > 1.5. */
export const RACE_EVIDENCE_REANCHOR_DELTA = 1.5;

/** Training evidence moves the anchor at Δ ≥ 1.0, upward only, corroborated. */
export const TRAINING_LEAD_REANCHOR_DELTA = 1.0;

/** The daily self-heal's context-free fitness-shift threshold. */
export const SELF_HEAL_REANCHOR_DELTA = 2.0;

/** How long a 07:30 self-heal defers to an adapter anchor move. Covers the
 *  same-morning window (03:00 → 07:30) with slack for a late cron. */
export const ADAPTER_ANCHOR_DEFER_HOURS = 24;

/**
 * The anchor cascade, extracted verbatim from `detectFitnessRegression` /
 * `detectTrainingLead` (adapt.ts) so the two detectors and any future
 * consumer read the SAME anchor:
 *
 *   users.vdot_last_reviewed
 *     → authored_state.pace_recompute.vdot
 *     → authored_state.pace_blend.season_anchor_vdot   (skipped when the
 *       blend anchor is PROVISIONAL — COLD-3: an invented mileage-derived
 *       VDOT is not fitness, so it can be neither regressed from nor led
 *       from)
 *     → authored_state.derived_from.bestRecentVdot
 *
 * `reviewed` is the raw `vdot_last_reviewed::numeric::text` read (or a
 * number); `authoredState` is the active plan's authored_state.
 */
export function anchorVdotFromState(
  reviewed: string | number | null | undefined,
  authoredState: Record<string, unknown> | null | undefined,
): number | null {
  const st = (authoredState ?? {}) as Record<string, any>;
  const anchorProvisional = paceBlendAnchorIsProvisional(st.pace_blend);
  const candidates: Array<number | null> = [
    reviewed != null ? Number(reviewed) : null,
    st.pace_recompute?.vdot != null ? Number(st.pace_recompute.vdot) : null,
    !anchorProvisional && st.pace_blend?.season_anchor_vdot != null
      ? Number(st.pace_blend.season_anchor_vdot) : null,
    st.derived_from?.bestRecentVdot != null ? Number(st.derived_from.bestRecentVdot) : null,
  ];
  for (const c of candidates) {
    if (c != null && Number.isFinite(c)) return c;
  }
  return null;
}

/**
 * Did the 03:00 adapter move this runner's pace anchor within the window?
 *
 * Reads the adapter's own audit record (`plan_adapt_recompute_paces`
 * coach_intents rows, written inside the same `mutatePlan` transaction as the
 * pace rewrite) rather than any new state.
 *
 * Returns `null` when the read FAILED — which is not the same answer as
 * `false`, and the caller must treat it as "could not tell" (the self-heal
 * fails toward deferring: a pace refresh skipped for one day is recoverable,
 * a double-write over the adapter's morning move is the bug this exists to
 * prevent).
 */
export async function adapterMovedAnchorWithin(
  q: { query: typeof pool.query },
  userId: string,
  hours: number = ADAPTER_ANCHOR_DEFER_HOURS,
): Promise<boolean | null> {
  try {
    const r = await q.query(
      `SELECT 1 FROM coach_intents
        WHERE COALESCE(user_uuid, user_id) = $1::uuid
          AND reason = 'plan_adapt_recompute_paces'
          AND ts >= NOW() - make_interval(hours => $2::int)
        LIMIT 1`,
      [userId, hours],
    );
    return r.rows.length > 0;
  } catch {
    return null;
  }
}

/**
 * The deferral decision, pure so the policy is testable without a database.
 *
 *   · An UPGRADE (provisional / unaccounted anchor → measured) never defers:
 *     it is strictly more authoritative than anything the adapter did, and
 *     the adapter cannot have performed it.
 *   · Otherwise the self-heal defers whenever the adapter moved the anchor
 *     inside the window — and also when it COULD NOT TELL (`null`), because
 *     the safe direction for a same-morning double-writer is to stand down.
 */
export function selfHealShouldDefer(opts: {
  /** This re-anchor upgrades a non-measured anchor to a measured one. */
  upgradesProvisionalAnchor: boolean;
  /** `adapterMovedAnchorWithin` result · null = read failed. */
  adapterMoveRecent: boolean | null;
}): boolean {
  if (opts.upgradesProvisionalAnchor) return false;
  return opts.adapterMoveRecent !== false;
}
