// POST /api/cron/plan-drift
//
// Nightly scan of every active plan for drift signals. For each
// runner: load the active plan, compute DriftReport, and persist a
// pending plan_proposals row when one or more signals fire.
//
// Idempotent · we check hasPendingProposal before writing so the
// nightly run doesn't pile up identical "volume drift" rows.
//
// Same auth pattern as the other cron routes.

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { detectDrift, hasPendingProposal } from '@/lib/plan/drift-monitor';
import { computeGoalGap } from '@/lib/plan/goal-gap';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({
      error: 'CRON_SECRET not configured.',
    }, { status: 503 });
  }
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (token !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const userIds = (await pool.query<{ user_uuid: string }>(
    `SELECT DISTINCT user_uuid FROM training_plans
      WHERE archived_iso IS NULL AND user_uuid IS NOT NULL`,
  ).catch(() => ({ rows: [] }))).rows.map((r) => r.user_uuid);

  // Always include the default user (David's UUID · same pattern as the
  // other crons).
  const DEFAULT = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';
  if (!userIds.includes(DEFAULT)) userIds.push(DEFAULT);

  type UserResult = {
    user_uuid: string;
    plan_id: string | null;
    signals_found: number;
    proposals_written: number;
    signals_skipped: number;        // pending row already exists
    error?: string;
  };
  const results: UserResult[] = [];

  for (const u of userIds) {
    const r: UserResult = {
      user_uuid: u,
      plan_id: null,
      signals_found: 0,
      proposals_written: 0,
      signals_skipped: 0,
    };
    try {
      // 2026-06-03 · Rule 12 · maintenance → race-prep transition.
      // When an active MAINTENANCE plan's target race comes within
      // its build window (BUILD_WINDOW_WEEKS[distance]), fire a
      // rebuild that picks race-prep mode. The runner has been in
      // maintenance possibly for months; now it's time to build.
      const maintenancePlan = (await pool.query<{
        plan_id: string; race_id: string; race_date: string; race_dist_mi: string;
      }>(
        `SELECT tp.id::text AS plan_id, tp.race_id::text AS race_id,
                (rc.meta->>'date')::text AS race_date,
                (rc.meta->>'distanceMi')::text AS race_dist_mi
           FROM training_plans tp
           JOIN races rc ON rc.slug = tp.race_id
          WHERE tp.user_uuid = $1
            AND tp.archived_iso IS NULL
            AND tp.mode = 'maintenance'
          ORDER BY tp.authored_iso DESC LIMIT 1`,
        [u],
      ).catch(() => ({ rows: [] }))).rows[0];

      if (maintenancePlan) {
        const { BUILD_WINDOW_WEEKS } = await import('@/lib/plan/goal-tiers');
        const { distanceCategoryOf } = await import('@/lib/plan/goal-tiers');
        const dMi = Number(maintenancePlan.race_dist_mi);
        const buildWindowDays = BUILD_WINDOW_WEEKS[distanceCategoryOf(dMi)] * 7;
        const raceMs = new Date(maintenancePlan.race_date + 'T12:00:00Z').getTime();
        const nowMs = Date.now();
        const daysToRace = (raceMs - nowMs) / 86400000;
        if (daysToRace > 0 && daysToRace <= buildWindowDays) {
          // De-dupe within 24h
          const alreadyTransitioned = (await pool.query(
            `SELECT 1 FROM plan_proposals
              WHERE user_uuid = $1
                AND proposal_kind = 'maintenance_to_raceprep'
                AND created_at >= NOW() - interval '24 hours'`,
            [u],
          ).catch(() => ({ rowCount: 0 }))).rowCount;
          if (!alreadyTransitioned) {
            try {
              const { fireAutoRebuild } = await import('@/lib/plan/auto-rebuild');
              const result = await fireAutoRebuild({
                userUuid: u,
                raceSlug: maintenancePlan.race_id,
                kind: 'race_graduate', // reuses graduate path · same semantics
                reasons: {
                  transition: 'maintenance_to_raceprep',
                  race_slug: maintenancePlan.race_id,
                  weeks_to_race: Math.round(daysToRace / 7),
                  build_window_weeks: buildWindowDays / 7,
                  message: `Race within build window · transitioning from maintenance to race-prep.`,
                },
                source: 'maintenance_transition_cron',
              });
              if (result.ok) r.proposals_written++;
            } catch (e) {
              console.error('[plan-drift] maintenance→race-prep failed:', e);
            }
          }
        }
      }

      // 2026-06-03 · post-race auto-graduate (Rule 11 follow-on).
      // If the runner's active plan target's race date is in the past
      // (race day finished), find the next A-priority race in their
      // schedule and fire a rebuild with kind='race_graduate'. The new
      // plan inherits all training history via composePlan's readers
      // (recentLong, recentQuality, bestRecentVdot, tsbAtStart, etc.)
      // so it's a continuous progression, not a cold-start.
      // Cite: docs/PLAN_ENGINE_MID_BLOCK_DOCTRINE.md §Rule 11 follow-on.
      // 2026-06-03 · runner TZ for the race-date boundary.
      const { runnerToday } = await import('@/lib/runtime/runner-tz');
      const userToday = await runnerToday(u);
      const finishedRow = (await pool.query<{
        plan_id: string; race_id: string; race_date: string;
      }>(
        `SELECT tp.id::text AS plan_id, tp.race_id::text AS race_id,
                (rc.meta->>'date')::text AS race_date
           FROM training_plans tp
           JOIN races rc ON rc.slug = tp.race_id
          WHERE tp.user_uuid = $1
            AND tp.archived_iso IS NULL
            AND (rc.meta->>'date')::date < $2::date - interval '1 day'
          ORDER BY tp.authored_iso DESC LIMIT 1`,
        [u, userToday],
      ).catch(() => ({ rows: [] }))).rows[0];

      if (finishedRow) {
        // Pick the next A-race AFTER today
        const nextRow = (await pool.query<{ slug: string; race_date: string }>(
          `SELECT slug, (meta->>'date')::text AS race_date
             FROM races
            WHERE user_uuid = $1
              AND meta->>'priority' = 'A'
              AND (meta->>'date')::date >= $2::date
            ORDER BY (meta->>'date')::date ASC LIMIT 1`,
          [u, userToday],
        ).catch(() => ({ rows: [] }))).rows[0];

        if (nextRow) {
          // De-dupe · don't graduate twice for the same (old race, new race) pair
          // within 24h. After the first successful graduate the active plan's
          // race_id matches nextRow.slug · so this only fires once per transition.
          const alreadyGraduated = (await pool.query(
            `SELECT 1 FROM plan_proposals
              WHERE user_uuid = $1
                AND proposal_kind = 'race_graduate'
                AND reasons->>'previous_race' = $2
                AND created_at >= NOW() - interval '24 hours'`,
            [u, finishedRow.race_id],
          ).catch(() => ({ rowCount: 0 }))).rowCount;

          if (!alreadyGraduated) {
            try {
              const { fireAutoRebuild } = await import('@/lib/plan/auto-rebuild');
              const result = await fireAutoRebuild({
                userUuid: u,
                raceSlug: nextRow.slug,
                kind: 'race_graduate',
                reasons: {
                  previous_race: finishedRow.race_id,
                  previous_race_date: finishedRow.race_date,
                  new_race_date: nextRow.race_date,
                  message: `${finishedRow.race_id} finished · graduating to ${nextRow.slug}.`,
                },
                source: 'graduate_cron',
              });
              if (result.ok) r.proposals_written++;
            } catch (e) {
              console.error('[plan-drift] race-graduate failed:', e);
            }
          }
        }
        // No next A-race · leave plan as-is. Runner gets a "schedule your next race"
        // empty-state on the next /today render. NOT a drift signal · move on.
      }

      // 2026-06-01 · Phase 1.1 · goal-gap engine. Continuous projection-
      // vs-goal check · fires a rebuild when the gap is WIDENING for 3+
      // consecutive days. This is the closed-loop signal the architecture
      // doc calls the keystone · see docs/PLAN_ENGINE_ARCHITECTURE.md
      // §Phase 1.1. We check it BEFORE per-axis drift because a widening
      // goal-gap is the higher-order signal · drift detection is the
      // input-side anomaly check, goal-gap is the output-side check.
      const goalGap = await computeGoalGap(u);
      if (goalGap && goalGap.status === 'widening' && goalGap.consecutiveWideningDays >= 3) {
        // Auto-rebuild if no recent goal-gap rebuild
        const recentGapRebuild = await hasPendingProposal(u, '', 'goal_gap_widening').catch(() => false);
        if (!recentGapRebuild) {
          try {
            const { fireAutoRebuild } = await import('@/lib/plan/auto-rebuild');
            await fireAutoRebuild({
              userUuid: u,
              raceSlug: goalGap.raceSlug,
              kind: 'goal_time_changed',  // synthetic · recalibrate
              reasons: {
                drift_kind: 'goal_gap_widening',
                message: `Projection drifting away from goal for ${goalGap.consecutiveWideningDays} days · rebuilding to close the gap.`,
                trajectory_sec: goalGap.trajectorySec,
                goal_sec: goalGap.goalSec,
                gap_sec: goalGap.gapSec,
                weeks_remaining: goalGap.weeksRemaining,
                what_closes_it: goalGap.whatClosesIt,
                citation: goalGap.citation,
              },
              source: 'goal_gap_cron_auto',
            });
            r.proposals_written++;
          } catch (e) {
            console.error('[plan-drift] goal-gap rebuild failed:', e);
          }
        }
      }

      const report = await detectDrift(u);
      if (!report) {
        results.push(r);
        continue;
      }
      r.plan_id = report.planId;
      r.signals_found = report.signals.length;

      // 2026-06-01 · soft drift now AUTO-APPLIES (David's zero-gaps
      // directive · "no opening the app required"). Generator gaps
      // that previously made auto-rebuild risky for mid-block runners
      // are fixed (spec-builder.ts + detectMidBlock) so the rebuilt
      // plan preserves quality + carries pace targets + workout specs
      // from row one.
      //
      // To avoid thrashing on borderline drift, take ONLY THE HIGHEST-
      // SEVERITY signal per run · multiple signals (e.g. volume_drift
      // + staleness simultaneously) collapse into one rebuild.
      // Idempotency · skip if a rebuild already fired in last 24h via
      // any drift signal kind.
      const recent = await hasPendingProposal(u, report.planId, 'volume_drift')
        || await hasPendingProposal(u, report.planId, 'vdot_drift')
        || await hasPendingProposal(u, report.planId, 'staleness');
      if (recent) {
        r.signals_skipped = report.signals.length;
      } else if (report.primary) {
        const signal = report.primary;
        // Run the rebuild via fireAutoRebuild · same path the hard-drift
        // hooks use · same audit shape · same dedupe window.
        try {
          const { fireAutoRebuild } = await import('@/lib/plan/auto-rebuild');
          // Look up the goal race slug for the plan
          const plan = (await pool.query<{ race_id: string | null }>(
            `SELECT race_id FROM training_plans WHERE id = $1`,
            [report.planId],
          ).catch(() => ({ rows: [] }))).rows[0];
          if (plan?.race_id) {
            await fireAutoRebuild({
              userUuid: u,
              raceSlug: plan.race_id,
              // Map drift kind → AutoRebuildKind · we reuse the existing
              // hard-drift kinds since drift IS a recalibration trigger.
              // The proposal row's `reasons.drift_kind` carries the soft
              // signal that fired so the runner sees why.
              kind: 'goal_time_changed',  // synthetic · "recalibrate"
              reasons: {
                drift_kind: signal.kind,
                message: signal.message,
                severity: signal.severity,
                ...signal.details,
              },
              source: 'drift_cron_auto',
            });
            r.proposals_written++;
          }
        } catch (e: unknown) {
          // If auto-rebuild fails, fall back to writing a pending proposal
          // (the old behavior · runner sees a card to manually accept)
          await pool.query(
            `INSERT INTO plan_proposals
               (user_uuid, plan_id, proposal_kind, reasons, status, source, created_at)
             VALUES ($1, $2, $3, $4::jsonb, 'pending', 'drift_cron_fallback', NOW())`,
            [
              u, report.planId, signal.kind,
              JSON.stringify({
                message: signal.message,
                severity: signal.severity,
                auto_rebuild_error: e instanceof Error ? e.message : String(e),
                ...signal.details,
              }),
            ],
          );
          r.proposals_written++;
        }
      }
    } catch (e: unknown) {
      r.error = e instanceof Error ? e.message : String(e);
    }
    results.push(r);
  }

  return NextResponse.json({
    ok: results.every((r) => !r.error),
    today: new Intl.DateTimeFormat('en-CA').format(new Date()),
    users: results.length,
    written: results.reduce((s, r) => s + r.proposals_written, 0),
    skipped: results.reduce((s, r) => s + r.signals_skipped, 0),
    errors: results.filter((r) => r.error).length,
    results,
  });
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/cron/plan-drift',
    auth: 'Authorization: Bearer <CRON_SECRET>',
    recommended_schedule: '0 9 * * *  (daily at 02:00 PT = 09:00 UTC · runs AFTER snapshot-projections + readiness-snapshot)',
    triggers: [
      'volume_drift · current 28d avg deviates >40% from authored 4wk avg',
      'vdot_drift · current VDOT deviates >2 from plan anchor (inferred from T-pace)',
      'staleness · plan authored >8 weeks ago',
    ],
    note: 'Idempotent · checks for an existing pending proposal of the same kind before writing. Soft-drift only; hard-drift (race date / goal time / A-race add-or-remove) is handled by immediate-fire hooks at the route level.',
  });
}
