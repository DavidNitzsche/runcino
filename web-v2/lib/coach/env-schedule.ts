/**
 * lib/coach/env-schedule.ts · environment-aware scheduling. Phase 2 (3.6).
 *
 * The audit's Part-5 #7 gap: the app judges heat AFTER runs and prices
 * race day, but never moves a workout out of the heat BEFORE it lands.
 * This engine looks at the next 3 days' quality + long sessions, prices
 * the planned window with the unified heat model, and when the day
 * offers a materially cooler option (earlier start, or a swap with an
 * adjacent easy day), writes ONE suggestion intent the surfaces render
 * as a chip: "Thu tempo · 78°F by 8 AM. 6 AM is 64°F. Move it?"
 *
 * Rules:
 *   · suggest only when planned ≥ SUGGEST_AT_PCT and the alternative
 *     ≤ ALTERNATIVE_MAX_PCT (a real difference, not noise)
 *   · hard-easy spacing guard (Research/04): a swap may never put two
 *     quality/long days within 48h of each other
 *   · never inside race week (T-7 → race) · taper structure is sacred
 *   · one unacked suggestion per workout date · dismiss = acknowledge
 *
 * Cite: Research/06 (the heat cost avoided) · Research/04 §hard-easy.
 */
import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { fetchDayForecast, resolveHomeLatLng } from '@/lib/weather/openmeteo';
import { effortSlowdownPct } from '@/lib/training/heat-model';

const SUGGEST_AT_PCT = 4;
const ALTERNATIVE_MAX_PCT = 2;
const QUALITY_TYPES = new Set(['tempo', 'threshold', 'intervals', 'race_week_tuneup', 'long']);
const EARLY_START_HOUR = 6;

export interface EnvScheduleSuggestion {
  workoutDateISO: string;
  workoutType: string;
  workoutLabel: string;
  plannedStartHour: number;
  plannedTempF: number;
  plannedSlowdownPct: number;
  /** 'earlier' (same day, 6 AM) or 'swap' (with an adjacent easy day). */
  suggestion: 'earlier' | 'swap';
  suggestedStartHour: number;
  suggestedDateISO: string;
  suggestedTempF: number;
  suggestedSlowdownPct: number;
  text: string;
}

/** Median start hour of the runner's last 14 outdoor runs · fallback 8. */
async function typicalStartHour(userUuid: string): Promise<number> {
  const rows = (await pool.query<{ h: string }>(
    `SELECT SUBSTRING(data->>'startLocal' FROM 12 FOR 2) AS h
       FROM runs
      WHERE user_uuid = $1::uuid AND NOT (data ? 'mergedIntoId')
        AND data->>'startLocal' ~ 'T\\d{2}:'
      ORDER BY COALESCE(data->>'date', LEFT(data->>'startLocal',10)) DESC
      LIMIT 14`,
    [userUuid],
  ).catch(() => ({ rows: [] }))).rows;
  const hours = rows.map((r) => parseInt(r.h, 10)).filter((h) => Number.isFinite(h) && h >= 0 && h <= 23);
  if (hours.length < 3) return 8;
  hours.sort((a, b) => a - b);
  return hours[Math.floor(hours.length / 2)];
}

const addDays = (iso: string, n: number): string =>
  new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

export async function computeEnvScheduleSuggestions(
  userUuid: string,
): Promise<EnvScheduleSuggestion[]> {
  const today = await runnerToday(userUuid);
  const home = await resolveHomeLatLng(userUuid).catch(() => null);
  if (!home) return [];

  // Plan days, today+1 .. today+3 (today's workout may already be run or
  // imminent · moving it is the runner's call, not a 1 AM cron's).
  const days = (await pool.query<{
    date_iso: string; type: string; distance_mi: string | null; sub_label: string | null;
  }>(
    `SELECT pw.date_iso, pw.type, pw.distance_mi::text, pw.sub_label
       FROM plan_workouts pw
       JOIN training_plans tp ON tp.id = pw.plan_id
      WHERE tp.user_uuid = $1::uuid AND tp.archived_iso IS NULL
        AND pw.date_iso > $2 AND pw.date_iso <= $3
      ORDER BY pw.date_iso`,
    [userUuid, today, addDays(today, 3)],
  ).catch(() => ({ rows: [] }))).rows;
  if (days.length === 0) return [];

  // Race-week silence: any A-race within 7 days of any candidate.
  const race = (await pool.query<{ date: string }>(
    `SELECT meta->>'date' AS date FROM races
      WHERE user_uuid = $1::uuid AND meta->>'priority' = 'A'
        AND (meta->>'date')::date BETWEEN $2::date AND $2::date + 10`,
    [userUuid, today],
  ).catch(() => ({ rows: [] }))).rows[0];

  const byDate = new Map(days.map((d) => [d.date_iso, d]));
  const startHour = await typicalStartHour(userUuid);
  const out: EnvScheduleSuggestion[] = [];

  for (const d of days) {
    if (!QUALITY_TYPES.has(d.type)) continue;
    if (race?.date) continue; // race within 10d → leave the plan alone
    const distMi = d.distance_mi != null ? Number(d.distance_mi) : 6;
    const durS = Math.round(distMi * 510); // mixed-pace estimate · only feeds the duration scale

    const windowOf = async (dateISO: string, hour: number): Promise<{ tempF: number; pct: number } | null> => {
      const fc = await fetchDayForecast(home.lat, home.lng, dateISO, {
        durationMin: Math.ceil(durS / 60), startHourOverride: hour,
      }).catch(() => null);
      const t = Math.max(fc?.temp_start_f ?? -Infinity, fc?.temp_end_f ?? -Infinity);
      if (!Number.isFinite(t)) return null;
      const pct = Math.round(effortSlowdownPct({ tempF: t, durationS: durS }) * 10) / 10;
      return { tempF: t, pct };
    };

    const planned = await windowOf(d.date_iso, startHour);
    if (!planned || planned.pct < SUGGEST_AT_PCT) continue;

    // Alternative 1 · same day, 6 AM (skip when the runner already runs early).
    let best: { kind: 'earlier' | 'swap'; dateISO: string; hour: number; tempF: number; pct: number } | null = null;
    if (startHour > EARLY_START_HOUR + 1) {
      const early = await windowOf(d.date_iso, EARLY_START_HOUR);
      if (early && early.pct <= ALTERNATIVE_MAX_PCT) {
        best = { kind: 'earlier', dateISO: d.date_iso, hour: EARLY_START_HOUR, ...early };
      }
    }
    // Alternative 2 · swap with an adjacent EASY day, hard-easy guarded:
    // post-swap, the quality day's new neighbors must not be quality/long.
    if (!best) {
      for (const delta of [1, -1]) {
        const swapISO = addDays(d.date_iso, delta);
        const neighbor = byDate.get(swapISO);
        if (!neighbor || neighbor.type !== 'easy') continue;
        const beyondISO = addDays(swapISO, delta);
        const beyond = byDate.get(beyondISO);
        if (beyond && QUALITY_TYPES.has(beyond.type)) continue; // would stack quality
        const swapped = await windowOf(swapISO, startHour);
        if (swapped && swapped.pct <= ALTERNATIVE_MAX_PCT) {
          best = { kind: 'swap', dateISO: swapISO, hour: startHour, ...swapped };
          break;
        }
      }
    }
    if (!best) continue;

    const label = d.sub_label ?? d.type;
    const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;
    const text = best.kind === 'earlier'
      ? `${d.date_iso} ${label}: ${Math.round(planned.tempF)}°F by ${hourLabel(startHour)}. ${hourLabel(best.hour)} is ${Math.round(best.tempF)}°F · same workout, ${planned.pct}% → ${best.pct}% heat cost.`
      : `${d.date_iso} ${label}: ${Math.round(planned.tempF)}°F. ${best.dateISO} runs ${Math.round(best.tempF)}°F · swap with that easy day, ${planned.pct}% → ${best.pct}% heat cost.`;

    out.push({
      workoutDateISO: d.date_iso,
      workoutType: d.type,
      workoutLabel: label,
      plannedStartHour: startHour,
      plannedTempF: Math.round(planned.tempF),
      plannedSlowdownPct: planned.pct,
      suggestion: best.kind,
      suggestedStartHour: best.hour,
      suggestedDateISO: best.dateISO,
      suggestedTempF: Math.round(best.tempF),
      suggestedSlowdownPct: best.pct,
      text,
    });
  }
  return out;
}
