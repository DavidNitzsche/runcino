#!/usr/bin/env tsx
/**
 * audit-races · race-table curation audit
 *
 * Lists every row in `races` and every race-distance activity in
 * `strava_activities`, then flags:
 *
 *   1. Races with no `actual_result` (uncurated) — needs chip time entered
 *   2. Races where `actual_result.finishS` matches strava_activities exactly
 *      (suspect: probably gun-time from Strava, not chip-time from results)
 *   3. Strava race-distance activities with NO corresponding races row
 *      (race ran but never logged into the curated table)
 *
 * Per the Option-B source-of-truth design: compute-vdot will prefer
 * `races.actual_result.finishS` over `strava_activities.canonicalFinishS`.
 * That only helps if races.actual_result is actually populated with the
 * official chip time. This audit surfaces the gap.
 *
 * Usage:
 *   cd web && npx tsx scripts/audit-races.ts
 *
 * Reads from the same DB the app does (DATABASE_URL env var).
 */

import { query } from '../lib/db';

interface RaceRow {
  slug: string;
  meta_name: string | null;
  meta_date: string | null;
  meta_distance_mi: number | null;
  actual_finish_s: number | null;
  actual_source: 'manual' | 'strava' | null;
  actual_strava_id: number | null;
}

interface StravaRaceRow {
  id: string;
  date: string;
  name: string;
  distance_mi: number;
  canonical_label: string | null;
  canonical_finish_s: number | null;
  moving_time_s: number;
  workout_type: number | null;
}

function fmt(s: number | null): string {
  if (s == null) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

async function main() {
  // ── 1. Pull every races row ──────────────────────────────────
  const races = await query<RaceRow>(`
    SELECT
      slug,
      meta->>'name'                                       AS meta_name,
      meta->>'date'                                       AS meta_date,
      (meta->>'distance_mi')::NUMERIC                     AS meta_distance_mi,
      (actual_result->>'finishS')::NUMERIC                AS actual_finish_s,
      actual_result->>'source'                            AS actual_source,
      (actual_result->>'stravaActivityId')::NUMERIC       AS actual_strava_id
    FROM races
    ORDER BY meta->>'date' DESC
  `);

  // ── 2. Pull every Strava activity that looks like a race ─────
  const stravaRaces = await query<StravaRaceRow>(`
    SELECT
      id::text                                           AS id,
      data->>'date'                                      AS date,
      COALESCE(data->>'name', '')                        AS name,
      (data->>'distanceMi')::NUMERIC                     AS distance_mi,
      data->>'canonicalLabel'                            AS canonical_label,
      (data->>'canonicalFinishS')::NUMERIC               AS canonical_finish_s,
      (data->>'movingTimeS')::NUMERIC                    AS moving_time_s,
      (data->>'workoutType')::INTEGER                    AS workout_type
    FROM strava_activities
    WHERE
      (data->>'workoutType')::INTEGER = 1
      OR data->>'canonicalLabel' IS NOT NULL
    ORDER BY data->>'date' DESC
    LIMIT 50
  `);

  // ── Report 1: races needing curation ─────────────────────────
  console.log('\n=== RACES TABLE — CURATION STATUS ===\n');
  console.log('slug                              | date       | distance | actual finish | source  | flag');
  console.log('----------------------------------+------------+----------+---------------+---------+-----------------');
  for (const r of races) {
    const flag = (() => {
      if (r.actual_finish_s == null) return '⚠ NO CURATED RESULT';
      if (r.actual_source === 'strava') return '⚠ STRAVA-AUTO (verify chip time)';
      if (r.actual_source === 'manual') return '✓ manual-curated';
      return '? unknown source';
    })();
    console.log(
      [
        (r.slug ?? '').padEnd(33),
        (r.meta_date ?? '').padEnd(10),
        (r.meta_distance_mi != null ? `${Number(r.meta_distance_mi).toFixed(2)}mi` : '—').padEnd(8),
        fmt(r.actual_finish_s != null ? Number(r.actual_finish_s) : null).padEnd(13),
        (r.actual_source ?? '—').padEnd(7),
        flag,
      ].join(' | '),
    );
  }
  if (races.length === 0) console.log('  (no races rows)');

  // ── Report 2: Strava race-tagged activities not in races ─────
  console.log('\n\n=== STRAVA RACE-TAGGED ACTIVITIES — IN races TABLE? ===\n');
  console.log('strava id    | date       | distance | label   | finish        | linked to races slug');
  console.log('-------------+------------+----------+---------+---------------+----------------------------');
  for (const a of stravaRaces) {
    // Match by date AND distance (within 5%), or by stored stravaActivityId
    const matchByDate = races.find((r) => {
      if (r.meta_date !== a.date) return false;
      if (r.meta_distance_mi == null || a.distance_mi == null) return false;
      return Math.abs(Number(r.meta_distance_mi) - Number(a.distance_mi)) / Number(a.distance_mi) < 0.05;
    });
    const matchByStravaId = races.find((r) => r.actual_strava_id != null && Number(r.actual_strava_id) === Number(a.id));
    const match = matchByStravaId || matchByDate;
    const finishS = a.canonical_finish_s != null ? Number(a.canonical_finish_s) : Number(a.moving_time_s);
    console.log(
      [
        String(a.id).padEnd(12),
        a.date.padEnd(10),
        `${Number(a.distance_mi).toFixed(2)}mi`.padEnd(8),
        (a.canonical_label ?? '—').padEnd(7),
        fmt(finishS).padEnd(13),
        match ? `✓ ${match.slug}` : '⚠ NOT IN races (add as race entry)',
      ].join(' | '),
    );
  }
  if (stravaRaces.length === 0) console.log('  (no race-tagged activities in strava_activities)');

  // ── Report 3: chip-time vs gun-time divergence ───────────────
  console.log('\n\n=== CHIP-TIME vs STRAVA DIVERGENCE ===\n');
  console.log('When races.actual_result.finishS differs from the matched');
  console.log('strava_activities.canonicalFinishS, the curated value wins');
  console.log('per the Option-B source-of-truth design.');
  console.log('');
  console.log('races slug                        | curated  | strava   | delta');
  console.log('----------------------------------+----------+----------+--------');
  let divergeFound = false;
  for (const r of races) {
    if (r.actual_finish_s == null || r.actual_strava_id == null) continue;
    const strava = stravaRaces.find((a) => Number(a.id) === Number(r.actual_strava_id));
    if (!strava) continue;
    const stravaS = strava.canonical_finish_s != null ? Number(strava.canonical_finish_s) : Number(strava.moving_time_s);
    const delta = Number(r.actual_finish_s) - stravaS;
    if (Math.abs(delta) < 2) continue;
    divergeFound = true;
    console.log(
      [
        (r.slug ?? '').padEnd(33),
        fmt(Number(r.actual_finish_s)).padEnd(8),
        fmt(stravaS).padEnd(8),
        `${delta >= 0 ? '+' : ''}${delta}s`,
      ].join(' | '),
    );
  }
  if (!divergeFound) console.log('  (no divergences found — either no curated results, or curated == strava)');

  console.log('');
  console.log('Done. Next steps:');
  console.log('  - ⚠ NO CURATED RESULT  → enter chip time via /races/<slug> UI');
  console.log('  - ⚠ STRAVA-AUTO        → confirm strava value matches official chip time');
  console.log('  - ⚠ NOT IN races       → add as race entry so compute-vdot uses the curated value');
  console.log('');
}

main().catch((e) => { console.error(e); process.exit(1); });
