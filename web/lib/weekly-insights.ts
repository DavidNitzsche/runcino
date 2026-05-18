/**
 * Weekly insights — plan-aware pattern detection.
 *
 * Earlier version compared actuals to prior 4-week behavior, which got
 * the framing exactly backward: the coach IS the plan, so adherence
 * should be measured against the plan, not against the runner's past
 * (especially when "past" includes a taper / race / recovery week
 * where mileage was deliberately low and pace was deliberately fast).
 *
 * Current rubric:
 *   1. Easy pace vs PLANNED easy band — flag when actual is faster
 *      than target (real "creep"). Slowdown toward target = good
 *      adherence, not a fatigue flag.
 *   2. Mileage vs PLANNED weekly mileage — flag when actual is
 *      meaningfully ABOVE plan. Below plan is just a missed session.
 *   3. Long-run trend — actual long miles climbing across recent
 *      weeks is positive (healthy progression).
 *
 * Insight = 1 sentence, actionable, cites numbers, no hedging.
 */

import { query } from './db';

export interface WeeklyInsight {
  /** Short headline-able text. */
  text: string;
  /** Visual tone — controls the dot color in the UI. */
  tone: 'green' | 'amber' | 'blue';
}

export interface PlanContext {
  /** Planned mileage for the current calendar week. */
  thisWeekPlannedMi: number;
  /** Easy-pace band the plan prescribes, in seconds per mile. */
  easyPaceLowSec: number;
  easyPaceHighSec: number;
  /** Current phase, used to soften flags during taper/race week. */
  phase: 'BASE' | 'BUILD' | 'PEAK' | 'TAPER' | 'RACE_WEEK';
}

interface ActivityRow {
  day: string;
  mi: string | null;
  pace_s: string | null;
  type: string | null;
}

function fmtPace(s: number): string {
  if (!s || s <= 0) return '—';
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}/mi`;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Compute weekly insights for a user given a "today" anchor + plan context.
 *
 * planContext is REQUIRED — the coach measures adherence against the plan,
 * not against prior weeks. Without it, insights would (and did) misread
 * recovery weeks as red flags.
 */
export async function generateWeeklyInsights(
  userId: string,
  todayISO: string,
  planContext: PlanContext,
): Promise<WeeklyInsight[]> {
  // Look back 28 days from today
  const lookbackStart = (() => {
    const d = new Date(todayISO + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 28);
    return d.toISOString().slice(0, 10);
  })();
  const weekStart = (() => {
    const d = new Date(todayISO + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 7);
    return d.toISOString().slice(0, 10);
  })();

  const rows = await query<ActivityRow>(
    `SELECT COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) AS day,
            (data->>'distanceMi')::NUMERIC                          AS mi,
            (data->>'paceSPerMi')::NUMERIC                          AS pace_s,
            data->>'type'                                           AS type
       FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) BETWEEN $2 AND $3
      ORDER BY day ASC`,
    [userId, lookbackStart, todayISO],
  );

  if (rows.length === 0) return [];

  const thisWeek = rows.filter((r) => r.day >= weekStart);
  const prior = rows.filter((r) => r.day < weekStart);

  const insights: WeeklyInsight[] = [];
  const { thisWeekPlannedMi, easyPaceLowSec, easyPaceHighSec, phase } = planContext;

  // ── 1. Easy pace vs PLANNED easy band ──────────────────────
  // Find easy-looking runs (3+ mi, slower than typical threshold).
  // Compare median to the plan's prescribed easy pace band.
  const easyPaces = thisWeek
    .filter((r) => {
      const mi = Number(r.mi) || 0;
      const pace = Number(r.pace_s) || 0;
      return mi >= 3 && pace >= 360 && (r.type || '').toLowerCase() !== 'race';
    })
    .map((r) => Number(r.pace_s));

  if (easyPaces.length >= 2) {
    const thisMed = median(easyPaces);
    if (thisMed < easyPaceLowSec - 15) {
      // Faster than the easy band's fast edge — real "creep"
      const delta = easyPaceLowSec - thisMed;
      insights.push({
        text: `Easy pace this week is ${fmtPace(thisMed)} — ${Math.round(delta)} sec/mi below the ${fmtPace(easyPaceLowSec)}–${fmtPace(easyPaceHighSec)} plan target. Easy days work best when they stay easy.`,
        tone: 'amber',
      });
    } else if (thisMed > easyPaceHighSec + 30 && phase !== 'TAPER' && phase !== 'RACE_WEEK') {
      // Slower than the easy band's slow edge (outside taper/race week)
      insights.push({
        text: `Easy pace this week is ${fmtPace(thisMed)} — ${Math.round(thisMed - easyPaceHighSec)} sec/mi slower than the ${fmtPace(easyPaceLowSec)}–${fmtPace(easyPaceHighSec)} target. Could be fatigue, heat, or terrain — worth a check-in.`,
        tone: 'amber',
      });
    } else if (thisMed >= easyPaceLowSec && thisMed <= easyPaceHighSec) {
      // Right in the band — quiet positive note (only show occasionally)
      // Skip to avoid noise; user already knows they're on plan.
    }
  }

  // ── 2. Mileage vs PLANNED weekly mileage ───────────────────
  const totalThis = thisWeek.reduce((s, r) => s + (Number(r.mi) || 0), 0);

  if (thisWeekPlannedMi > 0 && totalThis > 0) {
    const overPct = Math.round(((totalThis - thisWeekPlannedMi) / thisWeekPlannedMi) * 100);
    if (overPct >= 25) {
      // Real over-plan jump
      insights.push({
        text: `${totalThis.toFixed(0)} mi this week vs ${thisWeekPlannedMi.toFixed(0)} planned (+${overPct}%). Over plan — back off the extra running on easy days to leave room for the quality work.`,
        tone: 'amber',
      });
    } else if (overPct <= -40) {
      // Significantly under plan
      const pct = Math.abs(overPct);
      insights.push({
        text: `${totalThis.toFixed(0)} mi this week vs ${thisWeekPlannedMi.toFixed(0)} planned (${pct}% short). Missed sessions adding up — check back in or adjust next week's plan.`,
        tone: 'amber',
      });
    }
  }

  // ── 3. Long-run trend ──────────────────────────────────────
  const longestThis = Math.max(0, ...thisWeek.map((r) => Number(r.mi) || 0));
  const longestPriorWeeks = (() => {
    const buckets: number[] = [0, 0, 0];
    for (const r of prior) {
      const daysAgo = Math.floor(
        (Date.parse(todayISO + 'T00:00:00Z') - Date.parse(r.day + 'T00:00:00Z')) / 86400000,
      );
      const idx = Math.floor((daysAgo - 7) / 7);
      if (idx >= 0 && idx < 3) buckets[idx] = Math.max(buckets[idx], Number(r.mi) || 0);
    }
    return buckets;
  })();
  const longestPriorMedian = median(longestPriorWeeks);
  if (longestThis > 0 && longestPriorMedian > 0) {
    const delta = longestThis - longestPriorMedian;
    if (delta >= 2 && longestThis >= 8 && phase !== 'TAPER' && phase !== 'RACE_WEEK') {
      insights.push({
        text: `Long run climbing — ${longestThis.toFixed(1)} mi this week vs ${longestPriorMedian.toFixed(1)} 4-week median. Healthy progression.`,
        tone: 'green',
      });
    }
  }

  return insights.slice(0, 3);
}
