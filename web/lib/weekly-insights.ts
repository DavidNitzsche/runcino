/**
 * Weekly insights — pattern detection across recent training history.
 *
 * The coach briefing on /overview surfaces these when there's enough
 * data to support a meaningful observation. Each insight is a 1-sentence
 * actionable read, not a chart or a number dump.
 *
 * Triggers we look for:
 *   - "Easy-pace creep": easy-day pace this week vs the 4-week median
 *   - "Quality completion": % of planned quality sessions actually run
 *     in the past 4 weeks
 *   - "Long-run trend": longest run trending up vs flat vs dropping
 *   - "Volume jump": this week's mileage > 1.25× 4-week median (red flag)
 *
 * Returns 0-3 of the most relevant insights for the briefing context.
 */

import { query } from './db';

export interface WeeklyInsight {
  /** Short headline-able text. */
  text: string;
  /** Visual tone — controls the dot color in the UI. */
  tone: 'green' | 'amber' | 'blue';
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
 * Compute weekly insights for a user given a "today" anchor.
 *
 * Loads the user's last 4 calendar weeks of activities and looks for
 * meaningful patterns. Empty array when there's not enough history.
 */
export async function generateWeeklyInsights(userId: string, todayISO: string): Promise<WeeklyInsight[]> {
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

  if (rows.length < 3) return []; // not enough data

  // Bucket into "this week" (last 7d) vs "prior 3 weeks" (8-28d ago)
  const thisWeek = rows.filter((r) => r.day >= weekStart);
  const prior = rows.filter((r) => r.day < weekStart);

  const insights: WeeklyInsight[] = [];

  // ── 1. Easy-pace creep ──────────────────────────────────────
  // Find runs that look "easy" (long, slow-ish pace) and compare
  // this week's median pace to the prior 3-week median.
  const easyPaces = (set: ActivityRow[]) => set
    .filter((r) => {
      const mi = Number(r.mi) || 0;
      const pace = Number(r.pace_s) || 0;
      // Heuristic: not a race, ≥3 mi, pace slower than ~7:30 (430s)
      // Avoids counting intervals/threshold workouts as "easy".
      return mi >= 3 && pace >= 430 && (r.type || '').toLowerCase() !== 'race';
    })
    .map((r) => Number(r.pace_s));

  const thisEasyPaces = easyPaces(thisWeek);
  const priorEasyPaces = easyPaces(prior);

  if (thisEasyPaces.length >= 2 && priorEasyPaces.length >= 4) {
    const thisMed = median(thisEasyPaces);
    const priorMed = median(priorEasyPaces);
    const delta = thisMed - priorMed;
    if (delta < -20) {
      // Easy days are 20+ sec/mi faster than the 4-week norm
      insights.push({
        text: `Easy pace has crept ${Math.abs(Math.round(delta))} sec/mi faster this week (${fmtPace(thisMed)} vs ${fmtPace(priorMed)} 4-week median). Watch it — easy days work best when they stay easy.`,
        tone: 'amber',
      });
    } else if (delta > 30) {
      insights.push({
        text: `Easy pace has slowed ${Math.round(delta)} sec/mi this week (${fmtPace(thisMed)} vs ${fmtPace(priorMed)} 4-week median). Could be fatigue accumulating — worth a heads-up check-in.`,
        tone: 'amber',
      });
    }
  }

  // ── 2. Volume jump (acute red flag) ─────────────────────────
  const totalThis = thisWeek.reduce((s, r) => s + (Number(r.mi) || 0), 0);
  const weeklyMileages = (() => {
    // Bucket prior 3 weeks by their week (Mon-Sun) — approximate with
    // 7-day chunks from todayISO going back.
    const buckets: number[] = [0, 0, 0];
    for (const r of prior) {
      const daysAgo = Math.floor(
        (Date.parse(todayISO + 'T00:00:00Z') - Date.parse(r.day + 'T00:00:00Z')) / 86400000,
      );
      const idx = Math.floor((daysAgo - 7) / 7); // 0 = week-2, 1 = week-3, 2 = week-4
      if (idx >= 0 && idx < 3) buckets[idx] += Number(r.mi) || 0;
    }
    return buckets;
  })();
  const priorMedianMi = median(weeklyMileages);

  if (priorMedianMi > 5 && totalThis > priorMedianMi * 1.25) {
    const jumpPct = Math.round(((totalThis - priorMedianMi) / priorMedianMi) * 100);
    insights.push({
      text: `Mileage is up ${jumpPct}% this week (${totalThis.toFixed(0)} mi vs ${priorMedianMi.toFixed(0)} 4-week median). Above the +10% rule — consider a cutback next week.`,
      tone: 'amber',
    });
  } else if (priorMedianMi > 0 && totalThis > 0 && totalThis < priorMedianMi * 0.5) {
    insights.push({
      text: `Mileage is well below the 4-week norm (${totalThis.toFixed(0)} mi vs ${priorMedianMi.toFixed(0)} median). Cutback week, off week, or missed sessions worth investigating.`,
      tone: 'blue',
    });
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
    if (delta >= 2 && longestThis >= 8) {
      insights.push({
        text: `Long-run distance is climbing — ${longestThis.toFixed(1)} mi this week vs ${longestPriorMedian.toFixed(1)} 4-week median. Healthy progression.`,
        tone: 'green',
      });
    }
  }

  // Return up to 3 most actionable insights
  return insights.slice(0, 3);
}
