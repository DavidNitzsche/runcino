/**
 * lib/adaptation/pace-hr-evidence.ts · wires REAL work-segment HR into
 * `checkPaceHrCompatibility` (`pace-hr-compatibility.ts`).
 *
 * That module is deliberately DB-free and takes `HrCheckedSession[]` as a
 * plain argument — see its own header for why. This file is the harness
 * side it names but that did not exist yet: "a production wiring of this
 * validator should instead source `avgWorkHrBpm` from the Evidence Engine's
 * own quality-segment grouping in `lib/evidence/activity-evidence.ts`, which
 * already exists and does this properly" (`docs/reports/
 * pace-hr-compatibility-2026-09-01.md` §"Verdict against the real, live
 * proposal"). The report's own demonstration used a PACE-BASED PROXY for two
 * of three sessions because that grouping was not yet wired in; this file
 * replaces the proxy with the real mechanism.
 *
 * ── WHAT "REAL" MEANS HERE ──────────────────────────────────────────────
 *
 * `classifyRecentActivities` (`lib/evidence/load-activity-evidence.ts`) is
 * the SAME batched classification `resolveAdaptationProposals` already runs
 * to build `PaceEvidence.sessions` — this file calls it a second time
 * (read-only, no new write surface) over the same window, and reads the
 * FULL `ActivityEvidenceResult` it returns rather than the narrow
 * `QualitySessionRead` projection `load-adaptation-engine.ts` keeps. The
 * full result carries `segments: ObservedSegment[]` (from `segmentActivity`
 * — pace-lift, HR-corroborated grouping, not a pace-band proxy) and
 * `environment.tempF`. A session's "work" HR is the distance-weighted mean
 * HR across its `threshold_like` / `high_intensity` segments — the actual
 * quality-segment classification, not a guess at which miles were "the fast
 * ones."
 *
 * No new DB write. No touch of `adaptation-engine.ts`'s proposal
 * composition, `capacity-resolver.ts`, or `normal-window.ts` — this file
 * only reads `runs`/`profile` through the existing, unmodified
 * `classifyRecentActivities` and `profile.lthr_set_at` for the (optional,
 * advisory-only) staleness read.
 */
import { pool } from '@/lib/db/pool';
import { classifyRecentActivities, type ClassifiedActivity } from '@/lib/evidence/load-activity-evidence';
import type { QualitySessionRead } from '@/lib/adaptation/adaptation-engine';
import type { HrCheckedSession, LthrReanchorAdvisory } from '@/lib/adaptation/pace-hr-compatibility';

const WORK_SEGMENT_CLASSIFICATIONS = new Set(['threshold_like', 'high_intensity']);

/** No shared export of this exists (checked — every file that needs it
 *  redefines it locally, e.g. `load-adaptation-engine.ts`); one more local
 *  copy, not a fourth inline formula of anything doctrine-bearing. */
const isoMinusDays = (isoDate: string, days: number): string => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
};

/**
 * Distance-weighted mean HR across a classified activity's WORK segments
 * (the Evidence Engine's own pace-lift/HR-corroborated grouping), or null
 * when the activity has no such segment or none of them carry HR — Rule 11:
 * absence is reported, never guessed at or defaulted to "in band."
 */
function workSegmentAvgHrBpm(result: ClassifiedActivity['result']): number | null {
  const work = result.segments.filter(
    (s) => WORK_SEGMENT_CLASSIFICATIONS.has(s.classification) && s.meanHrBpm != null,
  );
  if (work.length === 0) return null;
  let weightedSum = 0;
  let weight = 0;
  for (const s of work) {
    const w = s.distanceMi > 0 ? s.distanceMi : (s.spanSec / 3600);
    weightedSum += (s.meanHrBpm as number) * w;
    weight += w;
  }
  return weight > 0 ? weightedSum / weight : null;
}

/**
 * Build the `HrCheckedSession[]` the compatibility validator needs, for the
 * exact sessions `PaceEvidence.sessions` already named as backing (or
 * arguing against) a PACE proposal.
 *
 * Read-only, best-effort per session: a session whose raw activity cannot be
 * re-classified (deleted, malformed) is excluded from the returned array
 * rather than failing the whole batch — `checkPaceHrCompatibility` already
 * treats "fewer sessions than expected" honestly (it does not lower its own
 * corroboration bar), so under-returning here is safe.
 */
export async function resolveHrCheckedSessions(
  userUuid: string,
  sessions: readonly QualitySessionRead[],
): Promise<HrCheckedSession[]> {
  if (sessions.length === 0) return [];

  const dates = sessions.map((s) => s.dateISO).sort();
  const fromISO = isoMinusDays(dates[0], 1);
  const toISO = dates[dates.length - 1];

  let classified: ClassifiedActivity[];
  try {
    classified = await classifyRecentActivities(userUuid, fromISO, toISO);
  } catch {
    // Rule 11 · a failed batch read must not look like "no sessions had HR" —
    // the caller (shadow-compare.ts) is expected to notice an empty return
    // against a non-empty `sessions` input and record that as a distinct
    // fact, not silently spend it as "excluded for missing HR."
    return [];
  }

  const byRunId = new Map(classified.map((c) => [c.runId, c] as const));

  const out: HrCheckedSession[] = [];
  for (const s of sessions) {
    const c = byRunId.get(s.activityId);
    if (!c) continue; // not reclassifiable in this window — caller sees it as absent, not as "checked and clean"
    out.push({
      activityId: s.activityId,
      dateISO: s.dateISO,
      avgWorkHrBpm: workSegmentAvgHrBpm(c.result),
      tempF: c.result.environment.tempF ?? null,
    });
  }
  return out;
}

export interface LthrContext {
  lthrBpm: number | null;
  advisory: LthrReanchorAdvisory | null;
}

/**
 * The runner's raw stored LTHR, plus an advisory-only staleness read, in one
 * query — the compatibility validator's `lthrBpm` input and its
 * `lthrReanchorAdvisory` input both come from this single profile row.
 *
 * The advisory is deliberately NOT `decideLthrReanchor`
 * (`lib/training/lthr-reanchor.ts`) — that function's `write`/`hold` limbs
 * need a resolved qualifying-race anchor, which is a second read this
 * wiring does not need to make to answer the narrower question this
 * validator actually asks: "is the STORED anchor past its own re-test
 * cadence." This never writes anything and is read, verbatim, as the
 * module's own `lthrReanchorAdvisory` input — see that file's header for
 * why this module does not re-anchor LTHR itself.
 */
export async function resolveLthrContext(
  userUuid: string,
  todayISO: string,
): Promise<LthrContext> {
  const { LTHR_RETEST_CADENCE_DAYS } = await import('@/lib/training/lthr-reanchor');
  let row: { lthr: number | string | null; lthr_set_at: string | null } | undefined;
  try {
    const r = await pool.query<{ lthr: number | string | null; lthr_set_at: string | null }>(
      `SELECT lthr, lthr_set_at::date::text AS lthr_set_at FROM profile WHERE user_uuid = $1::uuid LIMIT 1`,
      [userUuid],
    );
    row = r.rows[0];
  } catch {
    return { lthrBpm: null, advisory: null }; // Rule 11 · a failed read is "no LTHR available", never "fresh"
  }
  if (!row || row.lthr == null) return { lthrBpm: null, advisory: null };
  const lthrBpm = Number(row.lthr);

  if (!row.lthr_set_at) {
    return {
      lthrBpm,
      advisory: { stale: true, action: 'stale', why: 'LTHR is set but carries no lthr_set_at stamp — cannot confirm freshness.' },
    };
  }
  const ageDays = Math.floor(
    (new Date(todayISO).getTime() - new Date(row.lthr_set_at).getTime()) / 86400000,
  );
  if (ageDays > LTHR_RETEST_CADENCE_DAYS) {
    return {
      lthrBpm,
      advisory: { stale: true, action: 'stale', why: `Set ${row.lthr_set_at} · ${ageDays}d ago, past the ${LTHR_RETEST_CADENCE_DAYS}d re-test cadence.` },
    };
  }
  return { lthrBpm, advisory: { stale: false, action: 'none', why: `Set ${row.lthr_set_at} · inside the re-test cadence.` } };
}
