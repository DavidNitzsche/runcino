/**
 * Weekly insights, plan-aware pattern detection.
 *
 * Earlier version compared actuals to prior 4-week behavior, which got
 * the framing exactly backward: the coach IS the plan, so adherence
 * should be measured against the plan, not against the runner's past
 * (especially when "past" includes a taper / race / recovery week
 * where mileage was deliberately low and pace was deliberately fast).
 *
 * Current rubric:
 *   1. Easy pace vs PLANNED easy band, flag when actual is faster
 *      than target (real "creep"). Slowdown toward target = good
 *      adherence, not a fatigue flag.
 *   2. Mileage vs PLANNED weekly mileage, flag when actual is
 *      meaningfully ABOVE plan. Below plan is just a missed session.
 *   3. Long-run trend, actual long miles climbing across recent
 *      weeks is positive (healthy progression).
 *
 * Insight = 1 sentence, actionable, cites numbers, no hedging.
 */

import { query } from './db';

export interface WeeklyInsight {
  /** Short headline-able text. */
  text: string;
  /** Visual tone, controls the dot color in the UI. */
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
  if (!s || s <= 0) return ', ';
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
 * planContext is REQUIRED, the coach measures adherence against the plan,
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
        AND NOT (data ? 'mergedIntoId')
        AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) BETWEEN $2 AND $3
      ORDER BY day ASC`,
    [userId, lookbackStart, todayISO],
  );

  if (rows.length === 0) return [];

  const thisWeek = rows.filter((r) => r.day >= weekStart);
  const prior = rows.filter((r) => r.day < weekStart);

  const insights: WeeklyInsight[] = [];
  // Positive/neutral plain-language reads, surfaced only when nothing's
  // wrong, so the card always says something useful instead of going empty.
  const goodNotes: WeeklyInsight[] = [];
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

  // Philosophy guard: require ≥3 easy runs in the window before
  // firing any pace insight. Two runs is enough sample size to be
  // wrong about a trend; three is the floor for "this is a pattern,
  // not noise." Matches DEFAULT_THRESHOLDS.upMinEvidence in
  // lib/adaptive-pattern.ts.
  if (easyPaces.length >= 3) {
    const thisMed = median(easyPaces);
    if (thisMed < easyPaceLowSec - 15) {
      // Faster than the easy band's fast edge, real "creep".
      // Falsifier line tells the runner what would un-fire this.
      const delta = easyPaceLowSec - thisMed;
      insights.push({
        text:
          `Easy pace (last 7 days, ${easyPaces.length} runs) is ${fmtPace(thisMed)}, ` +
          `${Math.round(delta)} sec/mi below the ${fmtPace(easyPaceLowSec)}–${fmtPace(easyPaceHighSec)} ` +
          `plan target. Easy days work best when they stay easy. ` +
          `We'd let this go if next week's easy median lands back in band.`,
        tone: 'amber',
      });
    } else if (thisMed > easyPaceHighSec + 30 && phase !== 'TAPER' && phase !== 'RACE_WEEK') {
      // Slower than the easy band's slow edge (outside taper/race week)
      insights.push({
        text:
          `Easy pace (last 7 days, ${easyPaces.length} runs) is ${fmtPace(thisMed)}, ` +
          `${Math.round(thisMed - easyPaceHighSec)} sec/mi slower than the ` +
          `${fmtPace(easyPaceLowSec)}–${fmtPace(easyPaceHighSec)} target. ` +
          `Could be fatigue, heat, or terrain, worth a check-in. ` +
          `If next week's median lands back in band this resolves itself.`,
        tone: 'amber',
      });
    } else {
      // Right in the band, a real positive worth saying plainly.
      goodNotes.push({
        text: `Your easy runs are landing right where they should (${easyPaces.length} runs around ${fmtPace(median(easyPaces))}). That's the discipline that builds your engine.`,
        tone: 'green',
      });
    }
  }

  // ── 2. Mileage vs PLANNED weekly mileage ───────────────────
  const totalThis = thisWeek.reduce((s, r) => s + (Number(r.mi) || 0), 0);

  // The lookback window is a ROLLING last-7-days, not the Mon–Sun
  // calendar week. Early in the week those trailing 7 days mostly
  // reflect LAST week's running, so we can't fairly say you're "on
  // plan" or "short" for the current week yet, and claiming "X of Y
  // this week" mid-week reads as if the week were already finished.
  // So: only render the on-plan / short verdict once the week is
  // essentially complete (Sat/Sun), when the trailing 7 days line up
  // with the current plan week. "Over plan" stays on every day, 
  // running well past a full week's mileage is a real signal anytime.
  const dowMon0 = (new Date(todayISO + 'T00:00:00Z').getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  const weekEssentiallyComplete = dowMon0 >= 5; // Sat or Sun
  if (thisWeekPlannedMi > 0 && totalThis > 0 && thisWeek.length >= 3) {
    const overPct = Math.round(((totalThis - thisWeekPlannedMi) / thisWeekPlannedMi) * 100);
    if (overPct >= 25) {
      insights.push({
        text:
          `${totalThis.toFixed(0)} mi (last 7 days) vs ${thisWeekPlannedMi.toFixed(0)} planned (+${overPct}%). ` +
          `Over plan, back off the extra running on easy days to leave room for the quality work. ` +
          `If next week lands within ±10% of plan this resolves itself.`,
        tone: 'amber',
      });
    } else if (overPct <= -40 && weekEssentiallyComplete) {
      const pct = Math.abs(overPct);
      insights.push({
        text:
          `${totalThis.toFixed(0)} mi this week vs ${thisWeekPlannedMi.toFixed(0)} planned (${pct}% short). ` +
          `Missed sessions adding up, check back in or adjust next week's plan. ` +
          `One short week is fine; two in a row means the plan needs to bend.`,
        tone: 'amber',
      });
    } else if (overPct > -40 && overPct < 25 && weekEssentiallyComplete) {
      goodNotes.push({
        text: `Mileage is right on plan, ${totalThis.toFixed(0)} of ${thisWeekPlannedMi.toFixed(0)} mi this week. Steady is exactly what works.`,
        tone: 'green',
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
        text: `Long run climbing, ${longestThis.toFixed(1)} mi this week vs ${longestPriorMedian.toFixed(1)} 4-week median. Healthy progression.`,
        tone: 'green',
      });
    }
  }

  // If nothing needs flagging, surface the positives so the card always
  // tells the runner something real instead of an empty state.
  if (insights.length === 0) insights.push(...goodNotes);
  return insights.slice(0, 3);
}
