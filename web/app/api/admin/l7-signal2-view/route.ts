/**
 * GET /api/admin/l7-signal2-view
 *
 * Diagnostic for L7 Signal 2 (pace at fixed HR drift). Surfaces the
 * full per-workout view: Z2 splits used, weighted Z2 pace, window
 * bucketing (recent vs prior 4 weeks), and the fire/no-fire decision.
 *
 * Parallels /api/admin/l7-signal-view for Signal 1. Read-only.
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { computeSignal2 } from '@/lib/adaptive-vdot-signal2';
import { resolveEffectiveMaxHr } from '@/lib/compute-max-hr';
import { query } from '@/lib/db';

function fmtPace(s: number | null): string {
  if (s == null || s <= 0) return '—';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}/mi`;
}

export async function GET() {
  const admin = await requireAdmin();
  const today = new Date();

  const maxHrResolved = await resolveEffectiveMaxHr(admin.id);
  const maxHr = maxHrResolved.value ?? null;
  const userRows = await query<{ resting_hr: number | null }>(
    `SELECT resting_hr FROM users WHERE id = $1 LIMIT 1`,
    [admin.id],
  );
  const restingHr = userRows[0]?.resting_hr ?? null;

  const signal2 = await computeSignal2(admin.id, today, maxHr, restingHr);

  return NextResponse.json({
    inputs: { maxHr, restingHr },
    z2Band: signal2.z2BandBpm,
    windows: {
      recent: {
        ...signal2.windows.recent,
        weightedZ2Pace: fmtPace(signal2.windows.recent.weightedZ2PaceS),
      },
      prior: {
        ...signal2.windows.prior,
        weightedZ2Pace: fmtPace(signal2.windows.prior.weightedZ2PaceS),
      },
    },
    deltaSPerMi: signal2.deltaSPerMi,
    deltaDisplay: signal2.deltaSPerMi != null
      ? (signal2.deltaSPerMi < 0
          ? `${Math.abs(signal2.deltaSPerMi)} s/mi FASTER at fixed HR`
          : signal2.deltaSPerMi > 0
            ? `${signal2.deltaSPerMi} s/mi SLOWER at fixed HR`
            : 'no change')
      : 'insufficient data',
    enoughVolume: signal2.enoughVolume,
    firesUp: signal2.firesUp,
    firesDown: signal2.firesDown,
    workouts: signal2.workouts.map((w) => ({
      date: w.date,
      name: w.name,
      distanceMi: w.distanceMi,
      window: w.inWindow,
      z2MileCount: w.z2Splits.length,
      weightedZ2Pace: fmtPace(w.weightedZ2PaceS),
      temperatureF: w.temperatureF,
      daysToNearestRace: w.daysToNearestRace,
      context: w.context,
    })),
    skipped: signal2.skipped,
    summary: {
      hint: signal2.firesUp
        ? `Signal 2 FIRES UP · ${signal2.deltaSPerMi} s/mi faster at Z2 HR over the last 4 weeks.`
        : signal2.firesDown
          ? `Signal 2 fires DOWN · ${signal2.deltaSPerMi} s/mi slower at Z2 HR.`
          : !signal2.enoughVolume
            ? `Not enough volume yet — need 3+ easy workouts and 10+ Z2 splits per window. recent: ${signal2.windows.recent.workoutCount}w / ${signal2.windows.recent.z2MileCount}mi · prior: ${signal2.windows.prior.workoutCount}w / ${signal2.windows.prior.z2MileCount}mi.`
            : `Delta within noise floor (±5 s/mi). System holding — no fitness drift detected.`,
    },
  });
}
