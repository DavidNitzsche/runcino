/**
 * Run the actual vdot computation against current production data
 * to see what bestRecentVdot returns + what projection it predicts.
 *
 * Mirrors the logic in profile-state.ts and race-header.ts.
 */
import { Pool } from 'pg';
import {
  vdotFromRace, predictRaceTime, formatRaceTime, parseRaceTime, bestRecentVdot,
} from '../lib/training/vdot.ts';

// Can't import .ts directly from .mjs without a runtime. Inline the math.
function kmFromMi(mi) { return mi * 1.609344; }
function vo2Cost(s) { return -4.6 + 0.182258 * s + 0.000104 * s * s; }
function pctVO2(min) {
  return 0.8 + 0.1894393 * Math.exp(-0.012778 * min) + 0.2989558 * Math.exp(-0.1932605 * min);
}
function rawVdot(fs, mi) {
  if (!fs || fs <= 0 || !mi || mi <= 0) return null;
  const meters = kmFromMi(mi) * 1000;
  const minutes = fs / 60;
  const speed = meters / minutes;
  const vo2 = vo2Cost(speed);
  const pct = pctVO2(minutes);
  return vo2 / pct;
}
function vdotFromRaceInline(fs, mi) {
  const v = rawVdot(fs, mi);
  if (v == null) return null;
  if (v < 30 || v > 85) return null;
  return Math.round(v * 10) / 10;
}
function predictTimeInline(vdot, mi) {
  let lo = mi * 150, hi = mi * 1500, mid = (lo + hi) / 2;
  for (let i = 0; i < 60; i++) {
    mid = (lo + hi) / 2;
    const v = rawVdot(mid, mi);
    if (v == null) break;
    if (v > vdot) lo = mid; else hi = mid;
  }
  return Math.round(mid);
}
function fmtTime(s) {
  if (s == null) return null;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

try {
  const today = new Date().toISOString().slice(0, 10);
  console.log('Today:', today);

  // Replicate profile-state.ts query exactly
  const raceRows = (await pool.query(
    `SELECT slug, meta, actual_result FROM races
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND (meta->>'date')::date >= ($2::date - interval '180 days')::date
        AND (meta->>'date')::date < $2::date
        AND meta->>'priority' IN ('A', 'B')`,
    [DAVID, today]
  )).rows;

  console.log('\n=== A/B races in last 180d ===');
  console.log('count:', raceRows.length);

  // Compute VDOT three ways for each race:
  //   1. From meta.finishTime (current canonical lookup — null today)
  //   2. From Strava match (current fallback)
  //   3. From actual_result.finishS (CLAUDE.md canonical, what SHOULD be used)
  for (const r of raceRows) {
    const m = r.meta || {};
    const ar = r.actual_result || {};
    const distMi = m.distanceMi ? Number(m.distanceMi) : null;

    const fsFromMeta = m.finishTime ? parseTimeFromStr(m.finishTime) : null;
    const fsFromActual = ar.finishS ? Number(ar.finishS) : null;

    // Strava match
    const candidateRuns = (await pool.query(
      `SELECT data FROM runs
        WHERE (user_uuid=$1 OR user_uuid IS NULL)
          AND NOT (data ? 'mergedIntoId')
          AND (data->>'distanceMi')::numeric > 2.5
          AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) BETWEEN ($2::date - 1)::text AND ($2::date + 1)::text`,
      [DAVID, m.date]
    )).rows;
    let fsFromStrava = null;
    let bestScore = Infinity;
    for (const c of candidateRuns) {
      const d = c.data;
      const day = d.date || (d.startLocal ?? '').slice(0, 10);
      const dayDelta = Math.abs((Date.parse(day + 'T12:00:00Z') - Date.parse(m.date + 'T12:00:00Z')) / 86400000);
      if (dayDelta > 1) continue;
      const miDelta = Math.abs(Number(d.distanceMi) - distMi);
      if (miDelta > 2.0) continue;
      const score = dayDelta * 10 + miDelta;
      if (score < bestScore) {
        fsFromStrava = Number(d.movingTimeS) || Number(d.elapsedTimeS) || null;
        bestScore = score;
      }
    }

    const v1 = fsFromMeta && distMi ? vdotFromRaceInline(fsFromMeta, distMi) : null;
    const v2 = fsFromStrava && distMi ? vdotFromRaceInline(fsFromStrava, distMi) : null;
    const v3 = fsFromActual && distMi ? vdotFromRaceInline(fsFromActual, distMi) : null;

    console.log(`\n${r.slug} (${m.date}, ${m.priority}, ${distMi}mi):`);
    console.log(`  meta.finishTime:        ${m.finishTime ?? 'null'} → VDOT ${v1 ?? 'null'}`);
    console.log(`  strava match:           ${fsFromStrava ?? 'null'}s (${fmtTime(fsFromStrava)}) → VDOT ${v2 ?? 'null'}`);
    console.log(`  actual_result.finishS:  ${fsFromActual ?? 'null'}s (${fmtTime(fsFromActual)}) → VDOT ${v3 ?? 'null'} ← CANONICAL per CLAUDE.md`);
  }

  // Pick the canonical best VDOT (from actual_result)
  const arVdots = raceRows.map(r => {
    const m = r.meta || {};
    const ar = r.actual_result || {};
    const fs = ar.finishS ? Number(ar.finishS) : null;
    const mi = m.distanceMi ? Number(m.distanceMi) : null;
    if (!fs || !mi || m.priority === 'C') return null;
    return { slug: r.slug, vdot: vdotFromRaceInline(fs, mi) };
  }).filter(x => x && x.vdot != null).sort((a,b) => b.vdot - a.vdot);

  console.log('\n=== Best VDOT candidates (using actual_result.finishS) ===');
  for (const c of arVdots) console.log(`  ${c.slug}: VDOT ${c.vdot}`);
  const bestVdot = arVdots[0]?.vdot ?? null;
  console.log('\nBest VDOT:', bestVdot);

  // Projection for AFC Half (13.1mi)
  if (bestVdot != null) {
    const projAfcSec = predictTimeInline(bestVdot, 13.1);
    const projCimSec = predictTimeInline(bestVdot, 26.219);
    const projLaSec = predictTimeInline(bestVdot, 26.219);
    console.log(`\nProjected for AFC Half (13.1mi) at VDOT ${bestVdot}: ${fmtTime(projAfcSec)} (goal 1:30:00)`);
    console.log(`Projected for CIM Marathon (26.22mi) at VDOT ${bestVdot}: ${fmtTime(projCimSec)} (goal 3:00:00)`);
    console.log(`Projected for LA Marathon (26.22mi) at VDOT ${bestVdot}: ${fmtTime(projLaSec)} (goal 3:31:00)`);
  }
} catch (e) {
  console.error(e);
} finally {
  await pool.end();
}

function parseTimeFromStr(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  if (m[3] != null) return +m[1]*3600 + +m[2]*60 + +m[3];
  return +m[1]*60 + +m[2];
}
