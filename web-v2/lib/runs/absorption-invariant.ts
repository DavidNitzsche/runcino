/**
 * lib/runs/absorption-invariant.ts · the detector for silently-deleted mileage.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS EXISTS FOR
 *
 * `runs` records "this row lost a dedup" in two places:
 *
 *     data->>'mergedIntoId'          a pointer to the row that won
 *     absorbed_into_canonical_at     a timestamp stamped at absorption
 *
 * They are one fact, written together and cleared together. The invariant:
 *
 *   I1 · a row carrying the STAMP carries a POINTER, and that pointer names a
 *        row that is itself neither stamped nor pointing anywhere.
 *   I2 · every calendar day that has any run has at least one canonical
 *        survivor.
 *
 * Both were broken in production. Seven of the owner's runs — 2026-06-14,
 * 06-19, 07-06, 07-07, 07-25, 08-10, 08-26 — carried the stamp with no
 * pointer, while being the CANONICAL row for their day with their own
 * duplicates pointing correctly at them. 63.0 miles, including a peak 18.00 mi
 * long run, across ten weeks. The state was unreachable by the nightly repair
 * (which planned its ops from the pointer alone) and invisible to the existing
 * tripwire (`flag-census.ts`, which counts pointers and cannot see a stamp).
 *
 * Two guards now stand between the writer and that state: an advisory lock in
 * merge.ts that stops two passes disagreeing, and a conditional stamp in
 * canonical.ts that refuses a write the committed state does not entitle it
 * to. This file is the third thing — the one that assumes both will one day be
 * defeated, and makes the result LOUD instead of a quietly smaller number.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY A DETECTOR AND NOT ONLY A GUARD
 *
 * The cost of this failure is not an error, a stack trace, or a 500. It is a
 * base mileage that reads a little low and a peak long run that is simply not
 * there, on the night a 14-week marathon block sizes itself from both. Nothing
 * about that looks wrong from the inside. So the check has to be run on a
 * schedule and its finding has to arrive somewhere a person reads.
 */
import { pool } from '@/lib/db/pool';
import { runDaySql, runDistanceMiSql, runMergedIntoIdSql } from '@/lib/runs/run-shape';

/** One row, in the only three fields the invariant is about. */
export interface AbsorptionRow {
  id: string;
  /** Runner-local calendar day. */
  day: string;
  /** `data->>'mergedIntoId'` · null when absent. */
  mergedIntoId: string | null;
  /** `absorbed_into_canonical_at` · null when absent. */
  absorbedAt: string | null;
  /** Miles on the row · what the finding costs if this row goes missing. */
  distanceMi: number;
}

export type ViolationKind =
  /** I1 · stamped, but carries no pointer. The shape that hid 63 miles. */
  | 'stamp_without_pointer'
  /** I1 · stamped and pointing at a row that does not exist. */
  | 'pointer_dangling'
  /** I1 · stamped and pointing at a row that is itself a loser. */
  | 'pointer_to_loser'
  /** I2 · the day has rows and not one of them reads as canonical. */
  | 'day_without_survivor';

export interface Violation {
  kind: ViolationKind;
  /** The offending row, or `''` for a day-level finding. */
  id: string;
  day: string;
  distanceMi: number;
  detail: string;
}

/**
 * The whole check, as a pure function over a set of rows.
 *
 * Pure so the exact production shape can be reproduced in a unit test with no
 * database — see `_absorption_invariant.test.ts`. Pass ALL of a user's rows, or
 * all the rows in a window; day-level findings are only meaningful for days the
 * input covers completely, which is why the SQL wrapper below never windows by
 * anything but date.
 */
export function absorptionViolations(rows: AbsorptionRow[]): Violation[] {
  const out: Violation[] = [];
  const byId = new Map(rows.map((r) => [String(r.id), r]));

  for (const r of rows) {
    if (r.absorbedAt == null) continue;

    if (r.mergedIntoId == null) {
      out.push({
        kind: 'stamp_without_pointer',
        id: r.id,
        day: r.day,
        distanceMi: r.distanceMi,
        detail:
          `row ${r.id} is stamped absorbed but points at nothing, so it reads as `
          + `canonical while carrying a loser's marker. Nothing clears it and `
          + `nothing re-merges it.`,
      });
      continue;
    }

    const target = byId.get(String(r.mergedIntoId));
    if (!target) {
      out.push({
        kind: 'pointer_dangling',
        id: r.id,
        day: r.day,
        distanceMi: r.distanceMi,
        detail: `row ${r.id} is absorbed into ${r.mergedIntoId}, which is not in the set.`,
      });
      continue;
    }
    if (target.mergedIntoId != null || target.absorbedAt != null) {
      out.push({
        kind: 'pointer_to_loser',
        id: r.id,
        day: r.day,
        distanceMi: r.distanceMi,
        detail:
          `row ${r.id} is absorbed into ${target.id}, which is itself a loser `
          + `(mergedIntoId=${target.mergedIntoId ?? 'none'}, absorbed=${target.absorbedAt ?? 'no'}).`,
      });
    }
  }

  // I2 · a day whose every row carries a pointer has no survivor, and every
  // canonical read of that day returns nothing at all — it does not shade down,
  // it reads zero. This is the finding that costs miles rather than tidiness.
  const byDay = new Map<string, AbsorptionRow[]>();
  for (const r of rows) {
    if (!r.day) continue;
    const arr = byDay.get(r.day);
    if (arr) arr.push(r); else byDay.set(r.day, [r]);
  }
  for (const [day, dayRows] of byDay) {
    if (dayRows.some((r) => r.mergedIntoId == null)) continue;
    out.push({
      kind: 'day_without_survivor',
      id: '',
      day,
      distanceMi: Math.max(...dayRows.map((r) => r.distanceMi)),
      detail:
        `${day} has ${dayRows.length} row(s) and not one of them is canonical. `
        + `Every canonical read of this day returns zero miles.`,
    });
  }

  return out;
}

/** What one user's history looks like to the invariant. */
export interface AbsorptionAudit {
  userUuid: string;
  rowsChecked: number;
  violations: Violation[];
  /** Miles the findings account for · the headline a person needs. */
  milesAtRisk: number;
}

/**
 * Run the invariant against one runner's full run history.
 *
 * FULL history on purpose. The nightly merge sweep repairs a 14-day window, so
 * a violation older than that is precisely the one no repair will ever reach —
 * which makes it the one most worth naming. The read is bounded by the runner's
 * own row count (low hundreds) and runs once a night.
 */
export async function auditAbsorptionInvariant(userUuid: string): Promise<AbsorptionAudit> {
  const rows = (await pool.query<{
    id: string; day: string; mergedIntoId: string | null;
    absorbedAt: string | null; distanceMi: string | null;
  }>(
    `SELECT id::text                        AS id,
            ${runDaySql()}                  AS day,
            ${runMergedIntoIdSql()}         AS "mergedIntoId",
            absorbed_into_canonical_at::text AS "absorbedAt",
            ${runDistanceMiSql()}::text     AS "distanceMi"
       FROM runs
      WHERE user_uuid = $1::uuid`,
    [userUuid],
  )).rows;

  const shaped: AbsorptionRow[] = rows.map((r) => ({
    id: r.id,
    day: r.day ?? '',
    mergedIntoId: r.mergedIntoId,
    absorbedAt: r.absorbedAt,
    distanceMi: Number(r.distanceMi ?? 0) || 0,
  }));

  const violations = absorptionViolations(shaped);
  return {
    userUuid,
    rowsChecked: shaped.length,
    violations,
    milesAtRisk: Math.round(violations.reduce((s, v) => s + v.distanceMi, 0) * 10) / 10,
  };
}

/**
 * The alert body for one audit, or null when the runner is clean.
 *
 * Separate from the raise so the wording is testable and so a caller that only
 * wants to know CAN ask without writing a row.
 */
export function absorptionAlertMessage(audit: AbsorptionAudit): string | null {
  if (audit.violations.length === 0) return null;
  const byKind = new Map<ViolationKind, number>();
  for (const v of audit.violations) byKind.set(v.kind, (byKind.get(v.kind) ?? 0) + 1);
  const shape = [...byKind.entries()].map(([k, n]) => `${n}× ${k}`).join(', ');
  const days = [...new Set(audit.violations.map((v) => v.day))].sort();
  return (
    `Absorption invariant BROKEN for ${audit.userUuid.slice(0, 8)}… · ${shape} · `
    + `${audit.milesAtRisk} mi at risk on ${days.join(', ')}. `
    + `A stamped row with no pointer reads as canonical and no repair can see it; `
    + `a day with no survivor reads as zero miles. Plan authoring sizes off both.`
  );
}
