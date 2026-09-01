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
 * off `lib/plan/generate.ts`'s legacy VDOT cascade. As of 2026-09-01
 * `generate.ts` holds ZERO references to `capacity-resolver.ts` and the
 * cascade is threaded through its authoring logic rather than isolable at a
 * call site: it is NOT migrated.
 *
 * NO COUNT HERE ANY MORE. This sentence used to say "32 call expressions",
 * quoting `docs/reports/pace-shadow-compare-2026-09-01.md` §"The real scope"
 * ("32 call expressions across 19 distinct lines"). Re-counted at HEAD on
 * 2026-09-01 over that report's own import list, the figure is 35 across 31
 * lines — the report's number was already a recount that disagreed with the
 * prior day's "23 direct call sites" on counting method alone, and a number
 * copied into a header rots faster than the thing it describes. The QUALITY of
 * the claim (zero canonical references, not isolable) is what the guard rests
 * on and is checkable by grep; the arithmetic is not, so it lives in the
 * report where it is dated.
 *
 * ── FOUR STATES, NOT A BOOLEAN ──────────────────────────────────────────────
 *
 * Per the brief that commissioned this file: "a shadow record must
 * distinguish among these states, not just a boolean."
 *
 *   · AUTHORED_CANONICALLY      — the plan was composed directly through the
 *     canonical resolvers at authoring time. STRUCTURALLY UNREACHABLE TODAY
 *     — generate.ts still imports the legacy cascade — kept as a real branch
 *     so the day generate.ts is migrated, this guard does not need touching;
 *     it starts firing the moment authoring stamps the marker it already
 *     checks for.
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
  | 'REANCHOR_STATUS_UNKNOWN';

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
 * Structural marker for authoring having gone through the canonical
 * resolvers DIRECTLY, at composition time. `generate.ts` does not write this
 * today (see header) — this branch is real code with no live path to it yet,
 * kept so the guard needs no change the day generate.ts is migrated. Any
 * writer that starts authoring canonically should stamp exactly this key.
 */
function authoredCanonically(authoredState: Record<string, unknown> | null): boolean {
  return authoredState?.pace_anchors != null
    && (authoredState.pace_anchors as Record<string, unknown>).authored_directly === true;
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
      detail: 'authored_state.pace_anchors.authored_directly is true — this plan was composed '
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
