/**
 * lib/adaptation/authoring-convergence.ts · THE AUTHORING/REANCHOR
 * CONVERGENCE GUARD.
 *
 * Required by `docs/PRODUCT_DECISIONS.md` 2026-09-01 §2's "required before
 * live PACE authority is even reconsidered" list ("an explicit decision on
 * how authoring and recomputation converge onto one brain") and named
 * concretely by `docs/reports/pace-shadow-compare-2026-09-01.md` §3 as a
 * "cheap guard... not built tonight": a shadow-compare record must be able to
 * say whether the plan it just read has actually been through the canonical
 * capacity resolvers since it was authored, or whether it is still pricing
 * off `lib/plan/generate.ts`'s legacy VDOT cascade (32 call expressions, zero
 * references to `capacity-resolver.ts`, confirmed by that report as of
 * 2026-09-01 — generate.ts is NOT migrated yet).
 *
 * ── FOUR STATES, NOT A BOOLEAN ──────────────────────────────────────────────
 *
 * Per the brief that commissioned this file: "a shadow record must
 * distinguish among these states, not just a boolean."
 *
 *   · AUTHORED_CANONICALLY      — the plan was composed directly through the
 *     canonical resolvers at authoring time. This branch was written as
 *     "structurally unreachable today", on the bet that it should need no
 *     change the day `generate.ts` was migrated. That day is 2026-09-01
 *     (AUTHORING-CANONICAL-1): authoring prices every zone from
 *     `resolvePrescribedPaceAnchors` and stamps
 *     `authored_state.pace_authoring` with `authored_directly: true`. The bet
 *     paid — the predicate below moved by one key name and nothing else in
 *     this file changed for it.
 *   · CANNOT_CONVERGE_NO_CANONICAL_PRICING — added 2026-09-01. See the state's
 *     own doc comment: this guard's four states could not express "no reanchor
 *     will EVER come", which the independent audit found was the majority
 *     state in production.
 *   · REANCHORED_CANONICALLY    — authored via the legacy cascade, but
 *     `reanchorActivePlan` (the nightly, unconditional self-heal —
 *     `lib/plan/reanchor-plan.ts`, run from `/api/cron/snapshot-projections`
 *     at 07:30 UTC across every active plan) has landed a canonical rewrite
 *     SINCE authoring. Today's normal case, confirmed by the pace-shadow-
 *     compare report's own account: "77 of 78 future rows rewritten within
 *     the same session as authoring."
 *   · AUTHORED_TOO_RECENTLY     — `authored_iso` is newer than the last
 *     successful canonical reanchor. Benign and expected: the nightly job
 *     simply has not had a slot yet. Distinguished from the next state by
 *     asking the job's OWN heartbeat (`lib/ops/cron-ledger.ts`) whether it
 *     has run at all since authoring — if it has not, this is a timing fact,
 *     not a failure.
 *   · REANCHOR_STATUS_UNKNOWN   — honest "we don't know", per Rule 11 ("be
 *     honest about this state rather than defaulting to 'assumed fine'").
 *     Fires when either (a) the reanchor job's own heartbeat is unreadable
 *     or has never completed at all (can't rule out a broken scheduler,
 *     which is worse than "hasn't had a chance yet"), or (b) the job HAS
 *     reported success since authoring but this specific plan still carries
 *     no reanchor stamp — `cron-ledger.ts`'s own documented blind spot ("it
 *     cannot see a job that succeeds for one runner and throws for another")
 *     means a global 200 does not prove THIS plan converged, and Rule 11
 *     forbids reading that ambiguity as "must be fine."
 *
 * ── HOW "REANCHORED SINCE AUTHORING" IS DETECTED ────────────────────────────
 *
 * `generate.ts` never writes `authored_state.pace_blend.reanchored_at`,
 * `authored_state.reanchored_at`, or `authored_state.pace_anchors` at
 * authoring time (confirmed by grep — it stamps `season_anchor_source` /
 * `season_anchor_vdot` only). `reanchor-plan.ts`'s two arms are the ONLY
 * writers of those three keys, and only when a reanchor actually commits
 * (`boundary.ok`). So the presence of a reanchor timestamp NEWER than
 * `authored_iso` is unambiguous, positive evidence that the canonical
 * resolvers have priced this plan at least once since it was composed — no
 * new stamp was invented for this guard; it reads marks the mutation
 * boundary already leaves.
 */
import { pool } from '@/lib/db/pool';
import { lastSuccessAt } from '@/lib/ops/cron-ledger';

/** The one job that runs `reanchorActivePlan` unconditionally, across every
 *  active plan, on a nightly schedule — see `authoring-convergence.ts`'s
 *  header. Not `run-adaptations`: that job's own re-anchor call
 *  (`reanchorLthr`) moves LTHR, not the pace anchors this guard is about. */
const REANCHOR_JOB_ID = 'snapshot-projections';

export type AuthoringReanchorConvergenceState =
  | 'AUTHORED_CANONICALLY'
  | 'REANCHORED_CANONICALLY'
  | 'AUTHORED_TOO_RECENTLY'
  | 'REANCHOR_STATUS_UNKNOWN'
  /**
   * CANNOT-CONVERGE-1 (2026-09-01) · THE STATE THIS GUARD HAD NO WORD FOR, and
   * which the independent audit found was the MAJORITY STATE in production.
   *
   * `reanchorActivePlan`'s GUARD 2 used to return null for any runner without
   * a qualifying measured VDOT, and `snapshot-projections` passes an
   * evidence-only read. So such a runner was never reanchored — not late,
   * NEVER — and this guard reported `AUTHORED_TOO_RECENTLY` or
   * `REANCHOR_STATUS_UNKNOWN` forever, both of which imply "check again
   * tomorrow". Six of seven live plans, one of them 24 days old.
   *
   * The engine side is fixed (`reanchorOffCanonicalPrior` re-prices such a
   * plan off the canonical resolvers' honest prior). This state remains
   * because a plan can still be in it — between the fix landing and the next
   * nightly run — and because Rule 23 says a precondition that can never be
   * satisfied must be LOUD rather than silent. It is raised as an
   * `ops_alerts` row by `alertOnUnconvergedPlan`.
   */
  | 'CANNOT_CONVERGE_NO_CANONICAL_PRICING';

export interface AuthoringReanchorConvergence {
  readable: boolean;
  planId: string | null;
  authoredIso: string | null;
  lastCanonicalReanchorAt: string | null;
  state: AuthoringReanchorConvergenceState;
  /** Coach-register-adjacent, but this is an internal/audit field, not
   *  runner-facing prose — plain English explaining WHY this state, always
   *  built from the fields above, never asserted independently (§27
   *  discipline, applied to an audit trail rather than a coaching line). */
  detail: string;
}

const UNREADABLE = (detail: string): AuthoringReanchorConvergence => ({
  readable: false, planId: null, authoredIso: null, lastCanonicalReanchorAt: null,
  state: 'REANCHOR_STATUS_UNKNOWN', detail,
});

function parseDateSafe(v: unknown): Date | null {
  if (v == null) return null;
  const d = new Date(v as string);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * The most recent canonical-reanchor stamp on this plan's `authored_state`,
 * whichever arm wrote it (race-prep writes `pace_blend.reanchored_at` as a
 * full ISO instant; maintenance writes top-level `reanchored_at` as a date-
 * only ISO string — both are read and the later of the two wins).
 */
function lastCanonicalReanchorFromState(authoredState: Record<string, unknown> | null): Date | null {
  if (!authoredState) return null;
  const paceBlend = authoredState.pace_blend as Record<string, unknown> | null | undefined;
  const raceArm = parseDateSafe(paceBlend?.reanchored_at);
  const maintArm = parseDateSafe((authoredState as Record<string, unknown>).reanchored_at);
  if (raceArm && maintArm) return raceArm.getTime() >= maintArm.getTime() ? raceArm : maintArm;
  return raceArm ?? maintArm ?? null;
}

/**
 * Structural marker for authoring having gone through the canonical resolvers
 * DIRECTLY, at composition time.
 *
 * `persistComposedPlan` writes `authored_state.pace_authoring` since
 * AUTHORING-CANONICAL-1 (2026-09-01): `{source:'canonical', authored_directly:
 * true, at, anchors:{…, basis}}`. The six prices and their basis travel with
 * the mark, which is Rule 10's stamp requirement — a later reader can tell a
 * stale price from a current one by looking rather than by inferring.
 *
 * BOTH KEYS ARE READ. `pace_anchors.authored_directly` was this file's
 * original guess at the key name and no writer ever produced it; it is kept as
 * an accepted alias rather than deleted, because a plan authored by a future
 * writer that follows the older comment must not be reported as unconverged.
 * Cheap, and the failure it prevents is silent.
 */
function authoredCanonically(authoredState: Record<string, unknown> | null): boolean {
  const pa = authoredState?.pace_authoring as Record<string, unknown> | null | undefined;
  if (pa != null && (pa.authored_directly === true || pa.source === 'canonical')) return true;
  const legacy = authoredState?.pace_anchors as Record<string, unknown> | null | undefined;
  return legacy != null && legacy.authored_directly === true;
}

/**
 * Resolve the convergence state for a runner's active plan, as of `todayISO`.
 *
 * Read-only. Two DB reads: the active plan row (`training_plans`), and the
 * reanchor job's own heartbeat (`ops_alerts`, via `lastSuccessAt` — the same
 * ledger CLAUDE.md Rule 23 already built for exactly this "did the job that
 * guarantees my precondition actually run" question).
 */
export async function resolveAuthoringReanchorConvergence(
  userUuid: string,
): Promise<AuthoringReanchorConvergence> {
  let planRow: { id: string; authored_iso: Date; authored_state: Record<string, unknown> | null } | null;
  try {
    const r = await pool.query<{
      id: string; authored_iso: Date; authored_state: Record<string, unknown> | null;
    }>(
      `SELECT id, authored_iso, authored_state
         FROM training_plans
        WHERE user_uuid = $1::uuid AND archived_iso IS NULL
        ORDER BY authored_iso DESC
        LIMIT 1`,
      [userUuid],
    );
    planRow = r.rows[0] ?? null;
  } catch (e) {
    return UNREADABLE(`Could not read the active plan: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!planRow) {
    return UNREADABLE('No active plan to judge convergence against.');
  }

  const authoredIso = new Date(planRow.authored_iso);
  const st = planRow.authored_state;

  // ── AUTHORED_CANONICALLY · structurally unreachable today, see header ───
  if (authoredCanonically(st)) {
    return {
      readable: true, planId: planRow.id, authoredIso: authoredIso.toISOString(),
      lastCanonicalReanchorAt: authoredIso.toISOString(),
      state: 'AUTHORED_CANONICALLY',
      detail: 'authored_state.pace_authoring says this plan was composed '
        + 'through the canonical resolvers directly, not the legacy VDOT cascade. No reanchor '
        + 'was needed to converge because there was never a second brain to converge with.',
    };
  }

  const lastReanchor = lastCanonicalReanchorFromState(st);

  // ── REANCHORED_CANONICALLY · a stamp exists and postdates authoring ─────
  if (lastReanchor && lastReanchor.getTime() >= authoredIso.getTime()) {
    return {
      readable: true, planId: planRow.id, authoredIso: authoredIso.toISOString(),
      lastCanonicalReanchorAt: lastReanchor.toISOString(),
      state: 'REANCHORED_CANONICALLY',
      detail: `authored_state carries a reanchor stamp (${lastReanchor.toISOString()}) at or after `
        + `authoring (${authoredIso.toISOString()}) — the canonical resolvers have rewritten this `
        + 'plan\'s pace targets at least once since it was composed. Evidence from this cycle is '
        + 'meaningful; the two brains have converged.',
    };
  }

  // No reanchor stamp postdates authoring. Ask the JOB's own health before
  // deciding whether this is benign timing or something worth distrusting.
  let jobHealth: Awaited<ReturnType<typeof lastSuccessAt>>;
  try {
    jobHealth = await lastSuccessAt(REANCHOR_JOB_ID);
  } catch (e) {
    return {
      readable: true, planId: planRow.id, authoredIso: authoredIso.toISOString(),
      lastCanonicalReanchorAt: lastReanchor?.toISOString() ?? null,
      state: 'REANCHOR_STATUS_UNKNOWN',
      detail: `No reanchor stamp on this plan since authoring, and the reanchor job's own health `
        + `could not be read (${e instanceof Error ? e.message : String(e)}). Cannot distinguish `
        + '"hasn\'t had a chance yet" from "the mechanism is broken" — refusing to assume fine.',
    };
  }

  // ── REANCHOR_STATUS_UNKNOWN · the job itself is unreadable or has never
  //    completed. Never treated as "too recently" — a scheduler that has
  //    NEVER succeeded is worse news than one that merely hasn't had a slot
  //    yet, and collapsing the two hides that (Rule 11). ─────────────────
  if (jobHealth.state === 'read_failed' || jobHealth.state === 'never') {
    return {
      readable: true, planId: planRow.id, authoredIso: authoredIso.toISOString(),
      lastCanonicalReanchorAt: lastReanchor?.toISOString() ?? null,
      state: 'REANCHOR_STATUS_UNKNOWN',
      detail: jobHealth.state === 'never'
        ? `No reanchor stamp on this plan, and /api/cron/${REANCHOR_JOB_ID} has never recorded a `
          + 'successful run — cannot tell timing from a broken mechanism.'
        : `No reanchor stamp on this plan, and the reanchor job's ledger read failed `
          + `(${(jobHealth as { error: string }).error}) — its own health is unknown.`,
    };
  }

  const jobLastRan = jobHealth.at;

  // ── AUTHORED_TOO_RECENTLY · the job has run, but only BEFORE authoring —
  //    it genuinely has not had a slot since this plan was composed. ──────
  if (jobLastRan.getTime() < authoredIso.getTime()) {
    return {
      readable: true, planId: planRow.id, authoredIso: authoredIso.toISOString(),
      lastCanonicalReanchorAt: lastReanchor?.toISOString() ?? null,
      state: 'AUTHORED_TOO_RECENTLY',
      detail: `Plan authored ${authoredIso.toISOString()}, and /api/cron/${REANCHOR_JOB_ID} last `
        + `completed ${jobLastRan.toISOString()} — before authoring. The nightly reanchor simply `
        + 'has not had a slot yet; this is a timing fact, not a failure. Evidence from this cycle '
        + 'is contaminated (may still reflect the legacy cascade\'s pricing) and should be excluded '
        + 'from any "readiness for authority" aggregate.',
    };
  }

  // ── REANCHOR_STATUS_UNKNOWN · the job HAS run since authoring, globally,
  //    but THIS plan carries no stamp. cron-ledger.ts's own documented blind
  //    spot: a 200 from the route proves the batch finished, not that this
  //    user's reanchor succeeded (shouldReanchor could have legitimately
  //    found nothing to do, OR the mutation boundary could have refused for
  //    this user specifically — the two are indistinguishable from here,
  //    and Rule 11 forbids picking the comfortable one). ───────────────────
  // ── CANNOT_CONVERGE_NO_CANONICAL_PRICING · the job has run since authoring
  //    and this plan STILL carries no canonical stamp of any kind. Older than
  //    a day, that is not ambiguity any more: it is a plan the convergence
  //    mechanism is not reaching, and Rule 23 says that must be loud. ───────
  const ageHours = (Date.now() - authoredIso.getTime()) / 3_600_000;
  if (ageHours > CONVERGENCE_ALERT_AFTER_HOURS) {
    return {
      readable: true, planId: planRow.id, authoredIso: authoredIso.toISOString(),
      lastCanonicalReanchorAt: lastReanchor?.toISOString() ?? null,
      state: 'CANNOT_CONVERGE_NO_CANONICAL_PRICING',
      detail: `Plan authored ${authoredIso.toISOString()} (${Math.round(ageHours)}h ago) carries `
        + `neither a canonical authoring stamp nor a reanchor stamp, and /api/cron/${REANCHOR_JOB_ID} `
        + `has completed since (${jobLastRan.toISOString()}). This plan is being priced by neither `
        + 'brain the app currently has, and waiting another night will not change that — before '
        + 'CANNOT-CONVERGE-1 a runner with no measured VDOT was never reanchored at all.',
    };
  }

  return {
    readable: true, planId: planRow.id, authoredIso: authoredIso.toISOString(),
    lastCanonicalReanchorAt: lastReanchor?.toISOString() ?? null,
    state: 'REANCHOR_STATUS_UNKNOWN',
    detail: `/api/cron/${REANCHOR_JOB_ID} last completed ${jobLastRan.toISOString()}, at or after `
      + `authoring (${authoredIso.toISOString()}), but this plan carries no reanchor stamp. Cannot `
      + 'confirm whether the canonical resolvers already agreed with the authored anchor closely '
      + 'enough that no rewrite was needed, or whether this plan\'s own reanchor was refused — '
      + 'cron-ledger.ts\'s own documented limit is that a batch success cannot see a per-user '
      + 'failure. Treated as unready rather than assumed fine.',
  };
}

/**
 * How old an unconverged plan may be before it stops being timing and starts
 * being a defect, in hours.
 *
 * 24. `snapshot-projections` is scheduled daily and the audit measured its
 * worst observed gap at 15.7 h, so a plan that has survived a full day with no
 * canonical pricing of any kind has outlived every benign explanation the
 * schedule can offer (Rule 23: lateness must be harmless, and this is the
 * boundary past which it is not).
 */
export const CONVERGENCE_ALERT_AFTER_HOURS = 24;

/**
 * RULE 23 · A PLAN THAT NOTHING IS PRICING MUST BE NOTICED.
 *
 * The audit's finding was not that convergence sometimes lagged. It was that
 * for the majority of live plans it never happened, and NOBODY KNEW — there
 * was no alert, no staleness check, and the state was discovered only because
 * a human queried `training_plans` by hand.
 *
 * Called by the reanchor cron after it has done its own work, so the alert
 * describes what is STILL wrong after the mechanism has had its turn. Raises
 * at most one row per plan per `CONVERGENCE_ALERT_AFTER_HOURS` window —
 * `raiseAlert` is append-only and this is a daily job, so the dedupe is the
 * schedule rather than a query.
 *
 * Returns the state it judged, so a caller can log it without re-resolving.
 */
export async function alertOnUnconvergedPlan(
  userUuid: string,
): Promise<AuthoringReanchorConvergenceState | null> {
  const c = await resolveAuthoringReanchorConvergence(userUuid).catch(() => null);
  if (c == null || !c.readable) return null;
  if (c.state !== 'CANNOT_CONVERGE_NO_CANONICAL_PRICING') return c.state;

  const { raiseAlert } = await import('@/lib/ops/alerts');
  await raiseAlert({
    kind: 'plan_convergence',
    severity: 'warn',
    message: `Plan ${c.planId} has no canonical pricing ${CONVERGENCE_ALERT_AFTER_HOURS}h after authoring`,
    metadata: {
      plan_id: c.planId,
      user_uuid: userUuid,
      authored_iso: c.authoredIso,
      last_canonical_reanchor_at: c.lastCanonicalReanchorAt,
      detail: c.detail,
    },
    source: 'authoring-convergence',
  });
  return c.state;
}
