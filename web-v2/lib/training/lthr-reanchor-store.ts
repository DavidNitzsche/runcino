/**
 * lib/training/lthr-reanchor-store.ts · the DB half of the LTHR re-anchor.
 *
 * Split from `lib/training/lthr-reanchor.ts` — which holds the doctrine
 * constants, the candidate selection and the decision, all pure — for the same
 * reason `lib/training/vdot-inputs.ts` is separate from `lib/training/vdot.ts`:
 * the rule and the query that feeds it are different concerns, and only one of
 * them can be unit-tested without a database.
 *
 * The split is also load-bearing for the CLIENT. `components/faff-app/views/
 * ProfileView.tsx` needs `LTHR_RETEST_CADENCE_DAYS` to know when to draw the
 * stale marker on the LTHR tile, and a module that reaches `@/lib/db/pool` —
 * even behind a dynamic import — has no business in a browser bundle. The pure
 * module has no database import at any depth now, so the profile tile and the
 * engine read the same doctrine number instead of the tile carrying a literal
 * that drifts from it (it carried 120 days against doctrine's 84).
 */
import { pool } from '@/lib/db/pool';
import { rowsOrNull } from '@/lib/db/read';
import { distanceMiFromLabel } from '@/lib/race/distance';
import { runnerToday } from '@/lib/runtime/runner-tz';
import type { AuthorityTier } from '@/lib/race/effort-authority';
import {
  LTHR_RETEST_CADENCE_DAYS,
  decideLthrReanchor,
  selectLthrAnchor,
  type LthrRaceCandidate,
  type LthrReanchorDecision,
  type StoredLthr,
} from '@/lib/training/lthr-reanchor';

export interface LthrReanchorResult extends LthrReanchorDecision {
  /** True when profile.lthr was actually updated. */
  written: boolean;
}

/**
 * What every caller gets when a read failed. NOT a decision — `action: 'none'`
 * here means "did not look", and the `why` says so, so nothing downstream can
 * mistake a broken query for a runner whose anchor is fine.
 */
function couldNotDecide(why: string): LthrReanchorResult {
  return {
    action: 'none', nextLthr: null, nextMethod: null,
    previousLthr: null, previousProvenance: 'unknown',
    anchor: null, stale: false, storedAgeDays: null,
    why, written: false,
  };
}

/**
 * Re-anchor the runner's LTHR from race evidence.
 *
 * Called from three seams so the answer is the same wherever a result lands:
 *   · `lib/race/result-chain.ts` — both writers of `actual_result.finishS`
 *     (the manual chip-time route and the auto-provisional detector);
 *   · `PATCH /api/race` — the editor path, which used to do its own
 *     unconditional overwrite;
 *   · the daily `run-adaptations` cron — so an anchor that went stale between
 *     result writes heals without waiting for the runner to edit something.
 *
 * Never throws. A failure leaves the anchor exactly as it was, which is the
 * safe direction: an unchanged number is wrong in a way the runner has already
 * been living with, and a half-applied one is wrong in a new way.
 */
export async function reanchorLthr(
  userUuid: string,
  todayISOArg?: string,
): Promise<LthrReanchorResult> {
  const todayISO = todayISOArg ?? await runnerToday(userUuid);

  // A failed profile read must not read as "this runner has no LTHR" — that
  // is the write limb's own trigger, and it would overwrite a field-tested
  // anchor the query simply failed to return.
  const profileRows = await rowsOrNull<{ lthr: number | string | null; lthr_method: string | null; lthr_set_at: string | null }>(
    'lthr-reanchor · profile anchor',
    pool.query(
      `SELECT lthr, lthr_method, lthr_set_at::date::text AS lthr_set_at
         FROM profile WHERE user_uuid = $1 LIMIT 1`,
      [userUuid],
    ),
  );
  if (profileRows === null) return couldNotDecide('profile read failed · anchor left untouched');
  const profileRow = profileRows[0];

  const stored: StoredLthr = {
    lthr: profileRow?.lthr != null ? Number(profileRow.lthr) : null,
    method: profileRow?.lthr_method ?? null,
    setAtISO: profileRow?.lthr_set_at ?? null,
  };

  const candidates = await loadLthrRaceCandidates(userUuid, todayISO);
  if (candidates === null) return couldNotDecide('race candidate read failed · anchor left untouched');
  const anchor = selectLthrAnchor(candidates, todayISO);
  const decision = decideLthrReanchor({ stored, anchor, todayISO });

  if (decision.action !== 'write' || decision.nextLthr == null) {
    return { ...decision, written: false };
  }

  // The write is guarded on the exact state it decided against, so a field-test
  // completion landing between the read above and this statement cannot be
  // clobbered by a race derivation that never saw it. The predicate is the
  // decision's own precondition, re-asserted in SQL — `IS NOT DISTINCT FROM`
  // rather than `=` so a NULL on either side compares as equal instead of
  // making the whole WHERE unknown (which would silently match zero rows and
  // report a failed write as "nothing to do").
  const res = await pool.query(
    `UPDATE profile
        SET lthr = $1, lthr_method = $2, lthr_set_at = NOW()
      WHERE user_uuid = $3
        AND lthr IS NOT DISTINCT FROM $4::int
        AND lthr_method IS NOT DISTINCT FROM $5::text`,
    [decision.nextLthr, decision.nextMethod, userUuid, decision.previousLthr, stored.method],
  ).catch((e: unknown) => {
    console.warn('[lthr-reanchor] write failed:', e instanceof Error ? e.message : String(e));
    return { rowCount: 0 };
  });
  const written = (res.rowCount ?? 0) > 0;

  if (written) {
    await pool.query(
      `INSERT INTO coach_intents (user_id, user_uuid, reason, field, value)
       VALUES ($1, $1, 'lthr_auto_calibrated', 'lthr', $2)`,
      [userUuid, `${decision.nextLthr} (${decision.nextMethod})`],
    ).catch(() => null);
    // An LTHR change reshapes every zone edge and both HR caps · the same
    // cache event the field-test capture path busts.
    await import('@/lib/coach/cache')
      .then((m) => m.bustBriefingCacheForEvent(userUuid, 'profile_edit'))
      .catch(() => null);
  }
  return { ...decision, written };
}

/**
 * Load the race rows an LTHR anchor can come from.
 *
 * The HR ladder mirrors `lib/coach/profile-state.ts`'s, which was itself
 * widened on 2026-08-24 after it was found reading ONE race out of six: no row
 * carries every spelling, and the three that exist in production are
 * `actual_result.avgHrBpm` (written by `manualResultPatch`),
 * `actual_result.avgHr` (written by the Strava-backed result import) and
 * `meta.avgHrBpm` (written by the race editor).
 *
 * Fetched over the re-test cadence plus a small margin — `selectLthrAnchor`
 * owns the recency gate, and a loader window narrower than the gate would make
 * the gate untestable against production.
 *
 * Returns NULL when the read failed, and an empty array when it succeeded and
 * the runner has no races. That distinction is load-bearing rather than
 * decorative: "no qualifying race" is a real state with real consequences —
 * it is what makes `decideLthrReanchor` report `stale`, which lifts the
 * field-test detector's recent-race blocker and can spend one of the runner's
 * quality days. A dropped connection must not be able to say it.
 */
export async function loadLthrRaceCandidates(
  userUuid: string,
  todayISO: string,
): Promise<LthrRaceCandidate[] | null> {
  const cutoff = new Date(Date.parse(todayISO + 'T12:00:00Z') - (LTHR_RETEST_CADENCE_DAYS + 7) * 86400000)
    .toISOString().slice(0, 10);
  const rows = await rowsOrNull<{
    slug: string;
    meta: Record<string, unknown> | null;
    actual_result: Record<string, unknown> | null;
    avg_hr: string | null;
  }>(
    'lthr-reanchor · race candidates',
    pool.query(
      `SELECT slug, meta, actual_result,
              COALESCE(
                NULLIF(actual_result->>'avgHrBpm','')::numeric,
                NULLIF(actual_result->>'avgHr','')::numeric,
                NULLIF(meta->>'avgHrBpm','')::numeric
              )::text AS avg_hr
         FROM races
        WHERE user_uuid = $1
          AND (meta->>'date')::date >= $2::date
          AND (meta->>'date')::date <= $3::date`,
      [userUuid, cutoff, todayISO],
    ),
  );
  if (rows === null) return null;

  return rows.map((r) => {
    const m = (r.meta ?? {}) as Record<string, unknown>;
    const ar = (r.actual_result ?? {}) as Record<string, unknown>;
    const distanceMi = m.distanceMi != null
      ? Number(m.distanceMi)
      : distanceMiFromLabel(m.distanceLabel as string);
    return {
      slug: r.slug,
      name: (m.name as string) ?? r.slug,
      dateISO: (m.date as string) ?? '',
      priority: (m.priority as string) ?? null,
      distanceMi: Number.isFinite(Number(distanceMi)) ? Number(distanceMi) : null,
      avgHrBpm: r.avg_hr != null ? Number(r.avg_hr) : null,
      runnerAuthorityTier: runnerReportedTier(ar),
    };
  });
}

/** The runner's own grading of their race, and only theirs. Mirrors
 *  `lib/training/vdot-inputs.ts#runnerAuthorityTier` — `authority_source`
 *  guards against reading a tier some future automatic re-grade wrote. */
function runnerReportedTier(ar: Record<string, unknown>): AuthorityTier | null {
  if (ar.authority_source !== 'runner') return null;
  const t = ar.authority_tier;
  return t === 'representative' || t === 'compromised' || t === 'unrepresentative'
    ? (t as AuthorityTier)
    : null;
}
