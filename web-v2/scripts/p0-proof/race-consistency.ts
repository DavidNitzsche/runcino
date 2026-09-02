/**
 * scripts/p0-proof/race-consistency.ts · READ-ONLY proof artifact for the P0
 * handback (§7 goal isolation, §8 CIM bridge, §9 race consistency matrices,
 * §10 HR semantics). Resolves the race-pace brain for the owner's CIM and
 * Santa Monica races and queries every LIBRARY consumer that feeds a surface,
 * so the same field can be shown with its label, meaning, value and source
 * across surfaces.
 *
 * Usage:
 *   DATABASE_URL=$DATABASE_URL_RO npx tsx --tsconfig tsconfig.json \
 *     scripts/p0-proof/race-consistency.ts <out.json>
 */
import fs from 'node:fs';
import { pool } from '@/lib/db/pool';
import { resolveRaceOutlook, loadRaceForOutlook, composeRaceOutlook, loadRaceOutlookReads, type RaceOutlook } from '@/lib/race/race-outlook';
import { raceProjectionFromOutlook } from '@/lib/training/race-projection';
import { loadEffectiveRaceTarget } from '@/lib/race/effective-race-target';
import { computeGoalGap } from '@/lib/plan/goal-gap';
import { composeGapReport } from '@/lib/plan/gap-report';
import { loadCoachGoalForRace } from '@/lib/race/coach-goal-load';
import { resolveNextAGoalProjection } from '@/lib/training/goal-projection-resolve';
import { resolveGoalOutlookProjection } from '@/lib/plan/goal-outlook';
import { resolvePrescribedPaceAnchors } from '@/lib/training/load-prescription-anchors';
import { resolveThresholdCapacity } from '@/lib/training/capacity-resolver';
import { resolveRaceExponent } from '@/lib/training/durability-anchor';
import { runnerToday } from '@/lib/runtime/runner-tz';

const USER = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const OUT = process.argv[2] ?? 'race-consistency.json';

function slim(o: RaceOutlook) {
  return {
    race: o.race,
    statedGoal: o.statedGoal,
    capacity: o.capacity,
    currentProjection: { ...o.currentProjection, confidenceInterval: undefined },
    trainingPrescription: o.trainingPrescription,
    expectedImprovement: o.expectedImprovement,
    expectedRaceDay: o.expectedRaceDay,
    execution: o.execution,
    goalFeasibility: o.goalFeasibility,
    coachSet: o.coachSet,
    bridge: o.bridge,
    flags: o.flags,
  };
}

async function main() {
  const today = await runnerToday(USER);
  const out: Record<string, unknown> = { user: USER, today, resolvedAt: new Date().toISOString() };

  // ── canonical reads, once ─────────────────────────────────────────────
  const [anchors, threshold, durability] = await Promise.all([
    resolvePrescribedPaceAnchors(USER, today),
    resolveThresholdCapacity(USER, today),
    resolveRaceExponent(USER),
  ]);
  out.canonical = {
    anchors: anchors.ok ? anchors.anchors : anchors,
    threshold: { pace: threshold.paceSecPerMi, vdot: threshold.vdot, confidence: threshold.confidence, sourceMode: threshold.sourceMode, evidenceIds: threshold.evidenceIds, reasons: threshold.reasons },
    durability,
  };

  // ── the two races ─────────────────────────────────────────────────────
  const races: Record<string, unknown> = {};
  for (const slug of ['cim', 'santa-monica-10k-2026-09-13']) {
    const race = await loadRaceForOutlook(USER, slug, today);
    if (!race) { races[slug] = { missing: true }; continue; }
    const outlook = await resolveRaceOutlook(USER, race, today);
    const projection = raceProjectionFromOutlook(outlook);
    const effective = race.statedGoalSec != null
      ? await loadEffectiveRaceTarget(USER, race.statedGoalSec, race.distanceMi, { slug, todayISO: today })
      : null;
    const coachGoal = await loadCoachGoalForRace(USER, {
      slug, name: race.name, priority: race.priority, statedGoalSec: race.statedGoalSec, distanceMi: race.distanceMi,
      daysAway: outlook.race.daysToRace,
    });
    const planRows = (await pool.query(
      `SELECT pw.id, pw.date_iso::text AS date_iso, pw.type, pw.pace_target_s_per_mi, pw.distance_mi,
              pw.workout_spec->>'pace_target_s_per_mi_lo' AS lo, pw.workout_spec->>'pace_target_s_per_mi_hi' AS hi,
              pw.workout_spec->>'hr_cap_bpm' AS hr_cap_bpm, pw.workout_spec->'race_execution' AS race_execution,
              pw.workout_spec->'race_hr' AS race_hr, tp.id AS plan_id
         FROM plan_workouts pw JOIN training_plans tp ON tp.id = pw.plan_id
        WHERE tp.user_uuid = $1::uuid AND tp.archived_iso IS NULL AND pw.type = 'race'
          AND pw.date_iso::text = $2
        ORDER BY pw.date_iso`,
      [USER, race.dateISO],
    )).rows;
    races[slug] = {
      outlook: slim(outlook),
      consumers: {
        'race-projection.raceProjectionFromOutlook (Races list / Race detail "Projected")': projection,
        'effective-race-target.loadEffectiveRaceTarget (watch race day / execution plan / api race detail)': effective
          ? { targetSec: effective.targetSec, source: effective.source, goalSec: effective.goalSec, projectionSec: effective.projectionSec } : null,
        'coach-goal-load.loadCoachGoalForRace (coach-set A/B/C · null when a goal is stated)': coachGoal,
        'plan_workouts race row (plan row · watch reads its spec)': planRows,
      },
    };
  }
  out.races = races;

  // ── consumers that pick the race themselves ───────────────────────────
  const gap = await computeGoalGap(USER);
  out['goal-gap.computeGoalGap (Progress / plan drift / proposals)'] = gap ? {
    mode: gap.mode, raceSlug: gap.raceSlug, goalSec: gap.goalSec, expectedRaceDaySec: gap.expectedRaceDaySec,
    likelyRangeSec: gap.likelyRangeSec, trajectoryBasis: gap.trajectoryBasis, gapSec: gap.gapSec, status: gap.status,
    weeksRemaining: gap.weeksRemaining, whatClosesIt: gap.whatClosesIt,
  } : null;
  const report = await composeGapReport(USER);
  out['gap-report.composeGapReport (morning brief / readiness brief)'] = report ? {
    headline: report.headline, expectedRaceDaySec: report.expectedRaceDaySec, goalSec: report.goalSec, gapSec: report.gapSec,
    status: report.status, confidenceBand: report.confidenceBand, alternativeRanges: report.alternativeRanges,
  } : null;
  out['goal-projection-resolve.resolveNextAGoalProjection (snapshot cron · projection-changed notification)'] = await (async () => {
    const r = await resolveNextAGoalProjection(USER, today);
    return r ? { raceSlug: r.raceSlug, goalSec: r.goalSec, projectedSec: r.projectedSec, basis: r.basis } : null;
  })();
  out['goal-outlook.resolveGoalOutlookProjection (goal outlook note)'] = gap ? await resolveGoalOutlookProjection(USER, gap, today) : null;

  // ── §7 goal isolation: same evidence, three goals ─────────────────────
  const cim = await loadRaceForOutlook(USER, 'cim', today);
  if (cim) {
    const reads = await loadRaceOutlookReads(USER, cim, today);
    const variants: Record<string, unknown> = {};
    for (const [label, goalSec] of [['stated 3:00', 10800], ['soft 3:30', 12600], ['extreme 2:30', 9000], ['none', null]] as const) {
      const o = await composeRaceOutlook({ ...cim, statedGoalSec: goalSec }, today, reads);
      variants[label] = {
        capacity: { threshold: o.capacity.thresholdSecPerMi, vdot: o.capacity.thresholdVdot, confidence: o.capacity.confidence, exponent: o.capacity.durabilityExponent, evidenceIds: o.capacity.evidenceIds },
        currentProjectionSec: o.currentProjection.expectedSec,
        trainingPaceSecPerMi: o.trainingPrescription.paceSecPerMi,
        expectedGainVdot: o.expectedImprovement.gainVdot,
        expectedRaceDaySec: o.expectedRaceDay.expectedSec,
        likelyRangeSec: o.expectedRaceDay.likelyRangeSec,
        executionTargetSec: o.execution.targetSec,
        executionSource: o.execution.source,
        feasibility: o.goalFeasibility.status,
      };
    }
    out.goalIsolation = variants;
  }

  // ── §8 CIM progression artifact: every future race-specific row ───────
  out.cimRaceSpecificRows = (await pool.query(
    `SELECT pw.id, pw.date_iso::text AS date_iso, pw.type, pw.sub_label, pw.distance_mi, pw.pace_target_s_per_mi, pw.is_quality, pw.is_long,
            pw.workout_spec->>'kind' AS kind, pw.workout_spec->>'pace_target_s_per_mi_lo' AS lo, pw.workout_spec->>'pace_target_s_per_mi_hi' AS hi,
            pw.workout_spec->>'hr_cap_bpm' AS hr_cap_bpm, pw.workout_spec->'finish' AS finish, pw.workout_spec->'race_execution' AS race_execution,
            pw.workout_spec->'race_hr' AS race_hr, pw.workout_spec->>'rationale' AS rationale, pw.notes, w.phase_id AS phase, w.week_start_iso::text AS week_start, w.week_idx, w.is_race_week, w.is_peak, w.is_cutback
       FROM plan_workouts pw JOIN training_plans tp ON tp.id = pw.plan_id
       LEFT JOIN plan_weeks w ON w.id = pw.week_id
      WHERE tp.user_uuid = $1::uuid AND tp.archived_iso IS NULL AND pw.date_iso::date >= $2::date
        AND (pw.type = 'race' OR pw.workout_spec ? 'finish' OR pw.sub_label ILIKE '%marathon%' OR pw.sub_label ILIKE '%MP%' OR pw.notes ILIKE '%marathon pace%' OR pw.notes ILIKE '%M pace%')
      ORDER BY pw.date_iso`,
    [USER, today],
  ).catch((e) => ({ rows: [{ error: String(e) }] }))).rows;

  // ── §10 HR semantics inputs ───────────────────────────────────────────
  out.hr = (await pool.query(
    `SELECT p.lthr, p.lthr_method, p.lthr_set_at::text AS lthr_set_at, p.hrmax, p.hrmax_observed, p.rhr, u.max_hr AS users_max_hr
       FROM profile p JOIN users u ON u.id = p.user_uuid WHERE p.user_uuid = $1::uuid`,
    [USER],
  ).catch((e) => ({ rows: [{ error: String(e) }] }))).rows[0];

  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log('wrote', OUT);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
