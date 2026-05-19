/**
 * GET /api/admin/l7-signal3-view
 *
 * Diagnostic for L7 Signal 3 (interval pace at controlled effort).
 * Mirrors Signal 1's diagnostic shape: full per-workout view with
 * work-split picks, context tags, fire/no-fire decision.
 *
 * Read-only. opt-token or admin session.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireAdminOrOpToken } from '@/lib/auth';
import { computeSignal3 } from '@/lib/adaptive-vdot-signal3';
import { resolveEffectiveMaxHr } from '@/lib/compute-max-hr';
import { computeAggregateVdot } from '@/lib/compute-vdot';
import { query } from '@/lib/db';

function fmtPace(s: number | null): string {
  if (s == null || s <= 0) return '—';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}/mi`;
}

export async function GET(req: NextRequest) {
  const admin = await requireAdminOrOpToken(req);
  const today = new Date();

  const aggVdot = await computeAggregateVdot(admin.id);
  const currentVdot = aggVdot?.value ?? 45;
  const maxHrResolved = await resolveEffectiveMaxHr(admin.id);
  const maxHr = maxHrResolved.value ?? null;
  const userRows = await query<{ resting_hr: number | null }>(
    `SELECT resting_hr FROM users WHERE id = $1 LIMIT 1`,
    [admin.id],
  );
  const restingHr = userRows[0]?.resting_hr ?? null;

  const signal3 = await computeSignal3(admin.id, today, currentVdot, maxHr, restingHr);

  return NextResponse.json({
    inputs: { currentVdot, maxHr, restingHr },
    iPaceCenter: fmtPace(signal3.iPaceCenterS),
    z4z5Range: signal3.z4z5Range,
    candidatesEvaluated: signal3.observations.length,
    rollup: {
      fasterCount: signal3.fasterCount,
      fasterWeight: Math.round(signal3.fasterWeight * 100) / 100,
      slowerCount: signal3.slowerCount,
      slowerWeight: Math.round(signal3.slowerWeight * 100) / 100,
      firesUp: signal3.firesUp,
      firesDown: signal3.firesDown,
    },
    observations: signal3.observations.map((o) => ({
      date: o.date,
      label: o.workoutLabel,
      workIntervalPace: fmtPace(o.workIntervalPaceS),
      prescribedIPace: fmtPace(o.prescribedPaceS),
      paceDeltaS: o.paceDeltaS,
      workAvgHr: o.workAvgHr,
      hrInRange: o.hrInRange,
      workSplits: o.workSplits.map((s) => ({
        mile: s.mile,
        pace: fmtPace(s.paceSPerMi),
        avgHr: s.avgHr,
      })),
      temperatureF: o.temperatureF,
      daysToNearestRace: o.daysToNearestRace,
      context: o.context,
      weight: o.weight,
      verdict: o.faster
        ? 'COUNTS · faster'
        : o.slower
        ? 'COUNTS · slower'
        : o.context.some((t) => ['heat', 'race-recency', 'poor-sleep'].includes(t))
        ? `FILTERED · ${o.context.join(', ')}`
        : 'NEUTRAL · within I-pace band',
    })),
    skipped: signal3.candidatesSkipped,
    summary: {
      hint: signal3.firesUp
        ? `Signal 3 FIRES UP · ${signal3.fasterCount} interval workouts at ${signal3.fasterWeight.toFixed(1)}w trending faster than prescribed I-pace.`
        : signal3.firesDown
          ? `Signal 3 fires DOWN · ${signal3.slowerCount} interval workouts at ${signal3.slowerWeight.toFixed(1)}w trending slow at controlled HR.`
          : signal3.observations.length < 3
            ? `Only ${signal3.observations.length} interval-effort workouts in last ${42} days. Need 3 to fire — system correctly waiting.`
            : `Observations within noise floor (±5 s/mi of prescribed I-pace). System holding — no I-pace fitness drift detected.`,
    },
  });
}
