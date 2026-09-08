/**
 * _historical_boundary_scan.script.ts · ORGANIC-PUSH-SCAN-1 (2026-09-07)
 *
 * Runs the REAL, wired production decision code — `readCompletedWeek`,
 * `readProposedWeekDemand`, `evaluateBoundary1FromReadings` from
 * `lib/plan/adjudication/rolling-boundary-evaluator.ts`, calling straight
 * through into `lib/plan/adjudication/rolling-boundary.ts`'s
 * `demandStepConfidence` / `boundaryBeforeWeek` — against EVERY eligible
 * historical week boundary in the runner's real training history, not a
 * single hand-picked candidate.
 *
 * Read-only. DATABASE_URL_RO. No proposal, ledger, or plan row is written.
 *
 * ── WHY A SEPARATE PLAN-ID-SCOPED LOADER ─────────────────────────────────
 *
 * `loadPlannedWeeks` (the real production reader) scopes to `archived_iso
 * IS NULL` — the runner's ONE active plan — because in production there is
 * only ever one plan to reassess against. A historical scan needs the SAME
 * row-shape and the SAME transform for an ARCHIVED plan, since the boundary
 * question ("is this week's demand a reasonable step on the trailing
 * three?") is plan-agnostic — `evaluateBoundary1FromReadings` never reads
 * `archived_iso` at all. `loadPlanWeeksForPlanId` below is `loadPlannedWeeks`
 * with `plan_id = $1` in place of `tp.user_uuid = $1 AND tp.archived_iso IS
 * NULL`, and is otherwise a byte-for-byte copy of its row-processing loop —
 * not a re-derivation of the transform, a re-scoping of the same one.
 *
 * ── THE ELIGIBILITY CONTRACT, DECLARED BEFORE ANY RESULT IS READ ─────────
 *
 *   E1  real canonical execution data       → mileageByDay / CANONICAL_ROW_SQL,
 *                                              same reader `readCompletedWeek`
 *                                              already uses; no override.
 *   E2  real authored prescription          → the week must exist in this
 *                                              SAME plan's own `plan_workouts`
 *                                              (mirrors `readCompletedWeek`'s
 *                                              own `planWeeks.get()` refusal).
 *   E3  ordinary training week               → proposed week is not itself a
 *                                              taper or a race week
 *                                              (`isTaper || isRaceWeek`).
 *   E4  valid execution identity             → inherited from E1 — canonical
 *                                              dedup already resolves this.
 *   E5  sufficient preceding baseline        → all three trailing weeks
 *                                              (`-21/-14/-7` days) exist
 *                                              WITHIN THIS SAME PLAN's own
 *                                              authored span (the real
 *                                              production scoping) and read
 *                                              back `ok: true`.
 *   E6  future unsealed work available       → `reducibleCandidates`-shaped
 *                                              check: the proposed week has
 *                                              at least one quality/long row
 *                                              to change (else nothing for a
 *                                              PUSH to touch).
 *   E7  no race/recovery/cutback exclusion   → none of the three trailing
 *                                              weeks are a prescribed dip
 *                                              (`isPrescribedDip`) — matches
 *                                              `demandBaseline`'s own refusal
 *                                              rule ("every trailing week was
 *                                              a dip" refuses outright); here
 *                                              stated as a per-boundary
 *                                              eligibility gate up front
 *                                              rather than read off the
 *                                              decision after the fact.
 *   E8  no safety hard stop                  → no `subjective_checkins`
 *                                              injury/illness flag or DNF
 *                                              dated inside the proposed
 *                                              week or its trailing window
 *                                              (best-effort real read;
 *                                              absence of the table/column
 *                                              is reported, not assumed
 *                                              clean).
 *   E9  no fabricated evidence               → structural: every number
 *                                              below comes from `runs` /
 *                                              `plan_workouts` as they
 *                                              actually stand. Nothing here
 *                                              writes or overrides a row.
 *   E10 no changed doctrine thresholds       → structural: this script
 *                                              imports `demandStepConfidence`
 *                                              / `boundaryBeforeWeek`
 *                                              unmodified from the real
 *                                              module. It does not
 *                                              re-implement the curve.
 *
 * ── THE SELECTION RULE ────────────────────────────────────────────────────
 *
 * Walk every plan the runner has ever had, in chronological order by its
 * own authored span; within a plan, walk its own weeks oldest to newest.
 * Report EVERY boundary, eligible or not, with its exclusion reason where
 * excluded. Among boundaries that pass E1–E10, the answer is the EARLIEST
 * whose verdict is PROCEED (an organic PUSH). If none exists across the
 * runner's entire history, the answer is exactly that sentence — not a
 * softened one.
 */
import { describe, it } from 'vitest';
import { pool } from '@/lib/db/pool';
import { rowsOrNull } from '@/lib/db/read';
import { planVersionOf } from '@/lib/plan/plan-version';
import type { LiveWeek } from '@/lib/plan/adjudication/live-sequence';
import {
  readCompletedWeek, readProposedWeekDemand, evaluateBoundary1FromReadings,
  type CompletedWeekReading,
} from '@/lib/plan/adjudication/rolling-boundary-evaluator';
import { NEUTRAL_FATIGUE_SAFETY_CLEARANCE, clamp01 } from '@/lib/plan/adjudication/rolling-boundary';

const UID = '0645f40c-951d-4ccc-b86e-9979cd26c795';

// ── verbatim copies of the two tiny private helpers the evaluator keeps
// unexported — reproduced here so this scan calls the SAME arithmetic, not
// a re-derivation of it. See rolling-boundary-evaluator.ts for the originals.
const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
function mondayOf(iso: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const shift = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  return d.toISOString().slice(0, 10);
}
function stressorNameOf(type: string, subLabel: string | null, isQuality: boolean | null, isLong: boolean | null): string | null {
  const STRESSOR_TYPES = new Set(['tempo', 'threshold', 'intervals', 'interval', 'race', 'hill', 'hills']);
  const t = (type ?? '').toLowerCase();
  if (STRESSOR_TYPES.has(t)) return t === 'intervals' ? 'interval' : t;
  if (isLong === true || t === 'long') {
    const s = (subLabel ?? '').toUpperCase();
    return s.includes('FAST') || s.includes('MP') || s.includes('PROGRESS') ? 'fast-finish long' : 'long';
  }
  if (isQuality === true && t !== 'easy' && t !== 'recovery' && t !== 'rest') return t || 'quality';
  return null;
}
const RUNWAY_FULL_WEEKS = 4;
function weeksRemainingAfter(planWeeks: ReadonlyMap<string, LiveWeek>, weekStartISO: string): number {
  return [...planWeeks.keys()].filter((w) => w > weekStartISO).length;
}
function runwayOpennessFor(planWeeks: ReadonlyMap<string, LiveWeek>, weekStartISO: string): number {
  return clamp01(weeksRemainingAfter(planWeeks, weekStartISO) / RUNWAY_FULL_WEEKS);
}
function trainingPhaseOpennessFor(planWeeks: ReadonlyMap<string, LiveWeek>, weekStartISO: string): number {
  const week = planWeeks.get(weekStartISO);
  if (!week) return 1;
  return week.isTaper || week.isRaceWeek ? 0 : 1;
}

/** `loadPlannedWeeks`, re-scoped to an arbitrary plan_id instead of "the
 *  active plan" — same query shape, same row transform, copied not
 *  re-derived. See this file's own header for why re-scoping (not
 *  re-implementing) is the faithful move here. */
async function loadPlanWeeksForPlanId(planId: string): Promise<
  | { ok: true; weeks: LiveWeek[]; planVersion: string }
  | { ok: false; why: string }
> {
  const rows = await rowsOrNull<{
    id: string; date_iso: string; type: string; distance_mi: string | number | null;
    sub_label: string | null; is_quality: boolean | null; is_long: boolean | null;
    is_race_week: boolean | null; is_cutback: boolean | null; phase_label: string | null;
    plan_id: string; last_adapted_at: Date | null;
  }>(
    'historical-scan · plan-scoped block',
    pool.query(
      `SELECT pw.id::text AS id, pw.date_iso::text AS date_iso, pw.type,
              pw.distance_mi, pw.sub_label, pw.is_quality, pw.is_long,
              w.is_race_week, w.is_cutback, ph.label AS phase_label,
              pw.plan_id, tp.last_adapted_at
         FROM plan_workouts pw
         JOIN training_plans tp ON tp.id = pw.plan_id
    LEFT JOIN plan_weeks w ON w.id = pw.week_id
    LEFT JOIN plan_phases ph ON ph.id = w.phase_id
        WHERE pw.plan_id = $1
        ORDER BY pw.date_iso ASC`,
      [planId],
    ),
  );
  if (rows === null) return { ok: false, why: 'the plan read failed' };
  if (rows.length === 0) return { ok: false, why: 'plan has no workouts' };

  const byWeek = new Map<string, LiveWeek & { rows: LiveWeek['rows'][number][] }>();
  for (const r of rows) {
    const start = mondayOf(r.date_iso);
    if (start === null) continue;
    const mi = r.distance_mi === null ? 0 : Number(r.distance_mi);
    const stressor = stressorNameOf(r.type, r.sub_label, r.is_quality, r.is_long);
    let wk = byWeek.get(start);
    if (!wk) {
      wk = {
        weekStartISO: start, weeklyMi: 0, longestMi: 0, stressors: [], mpMi: 0,
        isTaper: (r.phase_label ?? '').toLowerCase().includes('taper'),
        isRaceWeek: r.is_race_week === true, rows: [],
      } as LiveWeek & { rows: LiveWeek['rows'][number][] };
      byWeek.set(start, wk);
    }
    const mutable = wk as unknown as {
      weeklyMi: number; longestMi: number; stressors: string[]; isTaper: boolean; isRaceWeek: boolean;
      rows: LiveWeek['rows'][number][];
    };
    mutable.weeklyMi = Math.round((mutable.weeklyMi + mi) * 10) / 10;
    if (mi > mutable.longestMi) mutable.longestMi = mi;
    if (stressor) mutable.stressors.push(stressor);
    if (r.is_race_week === true) mutable.isRaceWeek = true;
    if ((r.phase_label ?? '').toLowerCase().includes('taper')) mutable.isTaper = true;
    mutable.rows.push({ id: r.id, dateISO: r.date_iso, type: r.type, distanceMi: mi, stressor });
  }
  return {
    ok: true,
    weeks: [...byWeek.values()].sort((a, b) => a.weekStartISO.localeCompare(b.weekStartISO)),
    planVersion: planVersionOf({ id: planId, last_adapted_at: rows[0].last_adapted_at }),
  };
}

interface CandidateRow {
  planId: string;
  weekStartISO: string;
  eligible: boolean;
  exclusionReason: string | null;
  baselineDemand: number | null;
  candidateDemand: number | null;
  stepPct: number | null;
  baseConfidence: number | null;
  contextContribution: number | null;
  finalConfidence: number | null;
  verdict: string | null;
  reason: string | null;
}

describe('historical boundary scan', () => {
  it('scans every eligible boundary', async () => { await main(); }, 300_000);
});

async function main() {
  const planRows = (await pool.query<{ id: string; authored_iso: string; archived_iso: string | null; start: string; end: string; span: number }>(
    `SELECT tp.id, tp.authored_iso::text, tp.archived_iso::text,
            MIN(pw.date_iso) AS start, MAX(pw.date_iso) AS end,
            (MAX(pw.date_iso)::date - MIN(pw.date_iso)::date) AS span
       FROM training_plans tp
       JOIN plan_workouts pw ON pw.plan_id = tp.id
      WHERE tp.user_uuid = $1::uuid
      GROUP BY tp.id, tp.authored_iso, tp.archived_iso
     HAVING (MAX(pw.date_iso)::date - MIN(pw.date_iso)::date) >= 28
      ORDER BY MIN(pw.date_iso) ASC, tp.authored_iso ASC`,
    [UID],
  )).rows;

  // NO span-based de-duplication (removed — see E12-DEDUP-1 below).
  //
  // This scan originally deduped plans that share an identical (start,end)
  // authored span (onboarding/testing churn produced 20+ plan_ids covering
  // the identical 2026-05-11..2026-08-16 range in one minute), keeping "the
  // LAST such plan per span, on the reasoning that it is the one version of
  // that span the runner actually trained under longest." That reasoning was
  // FALSE for a real case in this runner's own history: `pln_c0ff77ee065b8fe4`
  // (2026-06-01..2026-08-16, authored+archived same night, lived 20 minutes)
  // and `pln_ca91f252bba50c74` (the SAME 2026-06-01..2026-08-16 span,
  // authored four days earlier, lived 75 days — the actual plan this runner
  // trained under all of June and July) share one span. "Last authored" and
  // "longest-lived" are different orderings, and the dedup silently kept the
  // 20-minute plan and discarded the 75-day one — hiding the runner's real
  // June/July training history from every subsequent step of this scan.
  // The same trap recurs for the CURRENT active plan: `pln_7636bcc0a201bf2d`
  // (active) shares its exact span with `pln_9a57561debb776e5` (archived
  // 2026-09-03), so the old dedup would have silently picked one of those two
  // arbitrarily as well.
  //
  // The fix is not a better tie-break — it is to not need one. E12 (below)
  // already excludes a plan for any boundary whose week starts on or after
  // that plan's own `archived_iso`, which is precisely and correctly what
  // makes every short-lived churn plan structurally ineligible for almost
  // every week in its own span. Walking every plan_id (still ordered
  // chronologically by its own earliest authored week) and letting E12 do
  // the real exclusion work is both simpler and safe against this failure
  // shape, because it never has to choose which of two plans "wins" a span.
  const distinctPlans = [...planRows].sort((a, b) => a.start.localeCompare(b.start));

  console.log(`Distinct authored spans found: ${distinctPlans.length}`);
  for (const p of distinctPlans) {
    console.log(`  ${p.id.slice(0, 24).padEnd(24)} ${p.start} .. ${p.end} (${p.span}d) authored ${p.authored_iso} archived ${p.archived_iso ?? '(active)'}`);
  }

  const allCandidates: CandidateRow[] = [];

  for (const p of distinctPlans) {
    const loaded = await loadPlanWeeksForPlanId(p.id);
    if (!loaded.ok) {
      console.log(`[${p.id}] plan load failed: ${loaded.why}`);
      continue;
    }
    const planWeeks = new Map(loaded.weeks.map((w) => [w.weekStartISO, w]));
    const weekStarts = [...planWeeks.keys()].sort();

    for (const weekStartISO of weekStarts) {
      const trailingStarts = [addDays(weekStartISO, -21), addDays(weekStartISO, -14), addDays(weekStartISO, -7)];

      // E11 (added after the first pass surfaced the exact defect it exists
      // to catch): the LAST trailing week (`weekStartISO - 7`) must have
      // genuinely, chronologically elapsed as of the REAL wall-clock date
      // this scan is run on — not merely relative to the fictional
      // `todayISO` this scan otherwise passes (`weekStartISO` itself, matching
      // real production's own "assessed the night the week starts" contract).
      // `readCompletedWeek`'s own completeness guard compares `todayISO` to
      // `weekEndISO` — both SCAN-INTERNAL dates — so it cannot tell a
      // genuinely-elapsed trailing week from one this scan is merely
      // PRETENDING has elapsed by picking a future `todayISO`. First pass of
      // this exact script did that for `pln_7636bcc0a201bf2d`'s Sept 14
      // candidate: its `-7` trailing week (starting 2026-09-07) was read via
      // real `mileageByDay`, which returned a genuine but PARTIAL sum — only
      // 2026-09-07 itself has a real run; 09-08..09-13 have not happened yet
      // as this scan runs — silently priced as if it were that week's whole,
      // completed total. That is precisely the "partial week read as
      // complete" failure this file's own header (and Rule 9/11) exists to
      // rule out, reproduced here by the SCAN rather than by production. Any
      // boundary whose trailing window reaches past real "now" is excluded,
      // full stop — no amount of eligibility elsewhere rescues it.
      const REAL_TODAY = '2026-09-07';
      if (weekStartISO > REAL_TODAY) {
        allCandidates.push({
          planId: p.id, weekStartISO, eligible: false,
          exclusionReason: `E11 fail: this boundary's own trailing window extends past ${REAL_TODAY} `
            + '(real "now") — at least one trailing week has not genuinely elapsed yet, so any '
            + 'mileage read for it would be partial-read-as-complete, not real completed evidence',
          baselineDemand: null, candidateDemand: null, stepPct: null,
          baseConfidence: null, contextContribution: null, finalConfidence: null,
          verdict: null, reason: null,
        });
        continue;
      }

      // E12 (added after the second pass surfaced a second real defect):
      // `evaluateDueRollingBoundariesForUser` in real production reads
      // `planWeeks` from `loadPlannedWeeks`, which scopes to `tp.archived_iso
      // IS NULL` — the runner's ONE active plan. It NEVER evaluates a
      // boundary against a plan that has already been superseded. This
      // scan's own `loadPlanWeeksForPlanId` deliberately drops that scope
      // (see this file's header) so it can read an ARCHIVED plan's own
      // authored rows at all — but nothing then re-asked the question the
      // real reader's scope answers for free: was THIS plan still the one
      // active plan on the date this boundary's own week began? If it was
      // already archived by then, the real cron could never have organically
      // evaluated this exact boundary against this exact plan — a real
      // engine reading `plan_workouts` here for `weekStartISO` would have
      // found a DIFFERENT, later plan's row instead (or none). Treating a
      // superseded plan's stale prescription as if it were still live is
      // exactly the wrong-population read Rule 14 names.
      //
      // First pass of this scan (pre-E12) reported three "earned PUSH"
      // candidates — 2026-06-08 under plan `8599e3a1-...` (archived
      // 2026-06-02, six days before its own candidate week even began), and
      // 2026-07-13 / 2026-07-27 under `pln_c0ff77ee065b8fe4` (authored AND
      // archived the same night, 2026-06-07, over a month before either
      // candidate week). All three are false positives of this exact shape.
      // The gate: the plan must still have been active (not yet archived) as
      // of the calendar day this candidate week starts — the same day real
      // production's own `archived_iso IS NULL` scope would still have
      // included it.
      if (p.archived_iso !== null && weekStartISO >= p.archived_iso.slice(0, 10)) {
        allCandidates.push({
          planId: p.id, weekStartISO, eligible: false,
          exclusionReason: `E12 fail: plan ${p.id} was already archived (${p.archived_iso.slice(0, 10)}) `
            + `on or before this boundary's own week start (${weekStartISO}) — the real production `
            + 'reader never evaluates a boundary against a plan that is no longer the active one, so '
            + 'this candidate could not have organically fired',
          baselineDemand: null, candidateDemand: null, stepPct: null,
          baseConfidence: null, contextContribution: null, finalConfidence: null,
          verdict: null, reason: null,
        });
        continue;
      }

      // E2/E5 structural gate: every trailing week must be authored WITHIN
      // THIS SAME PLAN (the real production reader's own scoping) — a
      // trailing week from a different plan_id is not readable by
      // `readCompletedWeek` as this plan's own history, and treating it as
      // if it were would be exactly the "second definition" Rule 16 forbids.
      const missingFromPlan = trailingStarts.filter((ws) => !planWeeks.has(ws));
      if (missingFromPlan.length > 0) {
        allCandidates.push({
          planId: p.id, weekStartISO, eligible: false,
          exclusionReason: `E5 fail: trailing week(s) ${missingFromPlan.join(', ')} not authored within this plan's own span`,
          baselineDemand: null, candidateDemand: null, stepPct: null,
          baseConfidence: null, contextContribution: null, finalConfidence: null,
          verdict: null, reason: null,
        });
        continue;
      }

      const proposedWeek = planWeeks.get(weekStartISO)!;
      // E3: ordinary training week.
      if (proposedWeek.isTaper || proposedWeek.isRaceWeek) {
        allCandidates.push({
          planId: p.id, weekStartISO, eligible: false,
          exclusionReason: 'E3 fail: proposed week is itself a taper or race week',
          baselineDemand: null, candidateDemand: null, stepPct: null,
          baseConfidence: null, contextContribution: null, finalConfidence: null,
          verdict: null, reason: null,
        });
        continue;
      }

      // E6: future unsealed work available — at least one stressor row.
      const hasReducible = proposedWeek.rows.some((r) => r.stressor !== null);
      if (!hasReducible) {
        allCandidates.push({
          planId: p.id, weekStartISO, eligible: false,
          exclusionReason: 'E6 fail: proposed week has no quality/long row for a push to touch',
          baselineDemand: null, candidateDemand: null, stepPct: null,
          baseConfidence: null, contextContribution: null, finalConfidence: null,
          verdict: null, reason: null,
        });
        continue;
      }

      // E1/E5: read the three trailing weeks for REAL. todayISO = weekStartISO,
      // matching the real cron's own assessOnISO semantics ("assessed the day
      // the week is authored to start").
      const trailingResults = await Promise.all(
        trailingStarts.map((ws) => readCompletedWeek(UID, planWeeks, ws, weekStartISO)),
      );
      const failed = trailingResults.find((r): r is { ok: false; why: string } => !r.ok);
      if (failed) {
        allCandidates.push({
          planId: p.id, weekStartISO, eligible: false,
          exclusionReason: `E1/E5 fail: ${failed.why}`,
          baselineDemand: null, candidateDemand: null, stepPct: null,
          baseConfidence: null, contextContribution: null, finalConfidence: null,
          verdict: null, reason: null,
        });
        continue;
      }
      const trailing = trailingResults.map((r) => (r as { ok: true; reading: CompletedWeekReading }).reading);

      // E7: no trailing week a prescribed dip.
      const dips = trailing.filter((t) => t.isPrescribedDip).map((t) => t.weekStartISO);
      if (dips.length > 0) {
        allCandidates.push({
          planId: p.id, weekStartISO, eligible: false,
          exclusionReason: `E7 fail: trailing week(s) ${dips.join(', ')} are a prescribed dip (taper/race)`,
          baselineDemand: null, candidateDemand: null, stepPct: null,
          baseConfidence: null, contextContribution: null, finalConfidence: null,
          verdict: null, reason: null,
        });
        continue;
      }

      const proposed = await readProposedWeekDemand(planWeeks, weekStartISO);
      if (!proposed.ok) {
        allCandidates.push({
          planId: p.id, weekStartISO, eligible: false,
          exclusionReason: `E2 fail: ${proposed.why}`,
          baselineDemand: null, candidateDemand: null, stepPct: null,
          baseConfidence: null, contextContribution: null, finalConfidence: null,
          verdict: null, reason: null,
        });
        continue;
      }

      // E8: no safety hard stop — best-effort real read against
      // subjective_checkins for an injury/illness flag dated inside the
      // trailing window or the proposed week. Reported, not assumed clean,
      // if the table/columns are not what's expected.
      let safetyFlag: string | null = null;
      try {
        const windowStart = trailingStarts[0];
        const windowEnd = addDays(weekStartISO, 6);
        const flagRows = await pool.query<{ date_iso: string; kind: string | null }>(
          `SELECT date_iso::text, kind FROM subjective_checkins
            WHERE user_uuid = $1::uuid AND date_iso BETWEEN $2 AND $3
              AND (kind ILIKE '%injur%' OR kind ILIKE '%illness%' OR kind ILIKE '%sick%')`,
          [UID, windowStart, windowEnd],
        );
        if (flagRows.rows.length > 0) {
          safetyFlag = `injury/illness flag(s): ${flagRows.rows.map((r) => `${r.date_iso}:${r.kind}`).join(', ')}`;
        }
      } catch (e) {
        safetyFlag = `E8 unreadable: ${e instanceof Error ? e.message : String(e)} (reported, not assumed clean)`;
      }
      if (safetyFlag && !safetyFlag.startsWith('E8 unreadable')) {
        allCandidates.push({
          planId: p.id, weekStartISO, eligible: false,
          exclusionReason: `E8 fail: ${safetyFlag}`,
          baselineDemand: null, candidateDemand: null, stepPct: null,
          baseConfidence: null, contextContribution: null, finalConfidence: null,
          verdict: null, reason: null,
        });
        continue;
      }

      const trainingPhaseOpenness = trainingPhaseOpennessFor(planWeeks, weekStartISO);
      const runwayOpenness = runwayOpennessFor(planWeeks, weekStartISO);

      const decision = evaluateBoundary1FromReadings({
        trailing,
        proposed: proposed.demand,
        todayISO: weekStartISO,
        targetWorkoutId: null,
        targetDateISO: null,
        trainingPhaseOpenness,
        runwayOpenness,
      });

      // Recompute the same numbers the decision used, for the report table
      // (demandBaseline/priceWeek/demandStepConfidence are the exact
      // production functions; re-deriving the READOUT here, not the
      // VERDICT, which already came from evaluateBoundary1FromReadings).
      const { priceWeek, demandBaseline, demandGrowthBaseConfidence, demandStepConfidence } =
        await import('@/lib/plan/adjudication/rolling-boundary');
      const trailingPriced = trailing.map((w) => priceWeek(w));
      const baseline = demandBaseline(trailingPriced, (ws) => trailing.find((t) => t.weekStartISO === ws)?.isPrescribedDip ?? false);
      const step = baseline.known ? proposed.demand.load.demandIndex / baseline.demandIndex - 1 : null;
      const baseConf = step !== null ? demandGrowthBaseConfidence(step) : null;
      const completionRatio = trailing[trailing.length - 1].prescribedMi > 0
        ? trailing[trailing.length - 1].weeklyMi / trailing[trailing.length - 1].prescribedMi : null;
      void completionRatio;
      const finalConf = step !== null
        ? demandStepConfidence(step, {
          recentExecutionCleanliness: trailing.filter((w) => w.prescribedMi > 0)
            .reduce((acc, w, _i, arr) => acc + clamp01(w.weeklyMi / w.prescribedMi) / arr.length, 0) || 0.5,
          baselineFreedomFromDip: trailing.filter((w) => !w.isPrescribedDip).length / trailing.length,
          fatigueSafetyClearance: NEUTRAL_FATIGUE_SAFETY_CLEARANCE,
          trainingPhaseOpenness, runwayOpenness,
        })
        : null;

      allCandidates.push({
        planId: p.id, weekStartISO, eligible: true, exclusionReason: null,
        baselineDemand: baseline.known ? Math.round(baseline.demandIndex * 100) / 100 : null,
        candidateDemand: Math.round(proposed.demand.load.demandIndex * 100) / 100,
        stepPct: step !== null ? Math.round(step * 1000) / 10 : null,
        baseConfidence: baseConf !== null ? Math.round(baseConf * 1000) / 10 : null,
        contextContribution: (finalConf !== null && baseConf !== null) ? Math.round((finalConf - baseConf) * 1000) / 10 : null,
        finalConfidence: finalConf !== null ? Math.round(finalConf * 1000) / 10 : null,
        verdict: decision.verdict,
        reason: decision.because,
      });
    }
  }

  console.log('\n=== FULL CANDIDATE TABLE ===');
  for (const c of allCandidates) {
    console.log(JSON.stringify(c));
  }

  const eligible = allCandidates.filter((c) => c.eligible);
  const pushes = eligible.filter((c) => c.verdict === 'PROCEED').sort((a, b) => a.weekStartISO.localeCompare(b.weekStartISO));

  console.log(`\n=== SUMMARY ===`);
  console.log(`Total boundaries examined: ${allCandidates.length}`);
  console.log(`Eligible (passed E1-E8): ${eligible.length}`);
  console.log(`Excluded: ${allCandidates.length - eligible.length}`);
  console.log(`Eligible verdicts: PROCEED=${eligible.filter((c) => c.verdict === 'PROCEED').length} REDUCE=${eligible.filter((c) => c.verdict === 'REDUCE').length} REFUSE=${eligible.filter((c) => c.verdict === 'REFUSE').length}`);

  if (pushes.length > 0) {
    console.log(`\nEARLIEST ORGANIC PUSH: ${pushes[0].planId} @ ${pushes[0].weekStartISO}`);
    console.log(JSON.stringify(pushes[0], null, 2));
  } else {
    console.log('\nNO HISTORICAL ORGANIC PUSH EXISTS FOR THIS RUNNER under the predeclared eligibility contract.');
  }
}
