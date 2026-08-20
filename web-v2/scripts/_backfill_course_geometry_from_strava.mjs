#!/usr/bin/env node
/**
 * Backfill races.course_geometry from Strava activity streams.
 *
 * Several course_library rows hold hand-typed elevation and no geometry, so
 * resolveCourseElevation has nothing to measure and correctly falls through
 * to the curated value — including where that value is known to be wrong
 * (big-sur-marathon: stored +260 ft net against a published −346).
 *
 * The runner has actually run these races, and the race rows carry a
 * stravaActivityId. Strava returns the full altitude series for any activity
 * the athlete owns, which is the measurement the resolver wants.
 *
 * DEFAULT IS DRY RUN. Nothing is written unless --commit is passed, and a
 * dry run still performs the fetch so the numbers can be inspected before
 * anyone decides to store them.
 *
 *   node scripts/_backfill_course_geometry_from_strava.mjs           # report only
 *   node scripts/_backfill_course_geometry_from_strava.mjs --slug=big-sur-marathon
 *   node scripts/_backfill_course_geometry_from_strava.mjs --commit  # writes
 *
 * NOTE ON THE TOKEN. Reading streams needs a live access token. The stored
 * one expires hourly and refreshing it rotates the refresh token, which is a
 * write to connector_tokens. That happens on any normal sync, but it is a
 * side effect, so it is called out here rather than buried.
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const ROOT = path.resolve(import.meta.dirname, '..');
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);

const COMMIT = process.argv.includes('--commit');
const slugArg = process.argv.find((a) => a.startsWith('--slug='))?.split('=')[1] ?? null;

// Read-write even on a dry run, and deliberately so. Strava ROTATES the
// refresh token on every refresh: the old one dies the instant the new one is
// issued. If we cannot persist the new triple, the connection is broken and
// the next sync fails — so a refresh that cannot be saved must never be
// attempted. The dry-run guarantee here is narrower and explicit: the only
// statement gated on --commit is the course_geometry write. Token
// persistence always happens, because a half-completed refresh is worse than
// no refresh at all.
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const M2FT = 3.28084;

/** Mirrors lib/race/course-elevation.ts · net from endpoints, gross filtered. */
function elevationProfileFt(eles, thresholdM = 1.6) {
  const e = eles.filter((x) => typeof x === 'number' && isFinite(x));
  if (e.length < 2) return null;
  let gainM = 0, lossM = 0, upRef = e[0], downRef = e[0];
  for (let i = 1; i < e.length; i++) {
    const up = e[i] - upRef;
    if (up >= thresholdM) { gainM += up; upRef = e[i]; } else if (up < 0) { upRef = e[i]; }
    const down = downRef - e[i];
    if (down >= thresholdM) { lossM += down; downRef = e[i]; } else if (down < 0) { downRef = e[i]; }
  }
  return {
    gainFt: Math.round(gainM * M2FT),
    lossFt: Math.round(lossM * M2FT),
    netFt: Math.round((e[e.length - 1] - e[0]) * M2FT),
  };
}

function haversineM(a, b) {
  const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Mirrors assessGeometryConfidence's checks, so the report matches runtime. */
function assess(points, nominalMi) {
  const geo = points.filter((p) => isFinite(p.lat) && isFinite(p.lon));
  const withEle = points.filter((p) => p.ele != null);
  if (withEle.length < 2) return { confidence: 'reject', why: 'no elevation samples' };
  if (geo.length < 2) return { confidence: 'low', why: 'no coordinates' };

  let meters = 0, maxGap = 0;
  for (let i = 1; i < geo.length; i++) {
    const d = haversineM(geo[i - 1], geo[i]);
    meters += d;
    if (d > maxGap) maxGap = d;
  }
  const mi = meters / 1609.344;
  let maxJump = 0;
  for (let i = 1; i < withEle.length; i++) {
    const j = Math.abs(withEle[i].ele - withEle[i - 1].ele);
    if (j > maxJump) maxJump = j;
  }
  const ratio = nominalMi ? mi / nominalMi : null;
  const ppm = mi > 0 ? withEle.length / mi : 0;

  if (ratio != null && ratio < 0.95) return { confidence: 'reject', why: `covers ${(ratio * 100).toFixed(0)}% of nominal`, mi, ratio, ppm, maxGap, maxJump };
  if (ratio != null && ratio > 1.08) return { confidence: 'reject', why: `${(ratio * 100).toFixed(0)}% of nominal — too long`, mi, ratio, ppm, maxGap, maxJump };
  if (maxJump > 60) return { confidence: 'reject', why: `${maxJump.toFixed(0)} m altitude spike`, mi, ratio, ppm, maxGap, maxJump };

  let confidence = 'high';
  const notes = [];
  if (ppm < 20) { confidence = 'low'; notes.push(`${ppm.toFixed(0)} samples/mi`); }
  if (maxGap > 400) { confidence = 'low'; notes.push(`${maxGap.toFixed(0)} m gap`); }
  if (ratio == null && confidence === 'high') { confidence = 'medium'; notes.push('no nominal distance'); }
  return { confidence, why: notes.join('; ') || 'clean', mi, ratio, ppm, maxGap, maxJump };
}

async function stravaToken(userId) {
  const r = await pool.query(
    `SELECT access_token, refresh_token, expires_at
       FROM connector_tokens
      WHERE user_uuid = $1 AND provider = 'strava' AND disconnected_at IS NULL
      ORDER BY connected_at DESC LIMIT 1`,
    [userId],
  );
  const t = r.rows[0];
  if (!t) throw new Error('no Strava connection for this user');
  if (new Date(t.expires_at).getTime() > Date.now() + 5 * 60 * 1000) return t.access_token;

  // Refresh. Strava rotates the refresh token, so the new triple must be
  // persisted or the next run cannot authenticate at all.
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.STRAVA_CLIENT_ID,
      client_secret: env.STRAVA_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: t.refresh_token,
    }),
  });
  if (!res.ok) throw new Error(`token refresh failed: ${res.status} ${await res.text()}`);
  const j = await res.json();
  if (!j.access_token || !j.refresh_token) {
    throw new Error('refresh returned an incomplete token triple — refusing to persist a broken connection');
  }
  console.log('  token refreshed; persisting the rotated triple (the previous refresh token is now dead)');
  const upd = await pool.query(
    `UPDATE connector_tokens
        SET access_token = $2, refresh_token = $3, expires_at = to_timestamp($4)
      WHERE user_uuid = $1 AND provider = 'strava' AND disconnected_at IS NULL`,
    [userId, j.access_token, j.refresh_token, j.expires_at],
  );
  if (upd.rowCount !== 1) {
    // Loud, because the rotated token is live and unsaved: the Strava
    // connection is now one step from broken and someone has to know.
    throw new Error(
      `CRITICAL: refreshed token was NOT persisted (${upd.rowCount} rows updated). ` +
      `Strava has rotated the refresh token and the stored one is now dead. ` +
      `Reconnect Strava, or persist this refresh_token manually: ${j.refresh_token}`,
    );
  }
  return j.access_token;
}

async function main() {
  console.log(COMMIT ? '=== COMMIT — this will write ===' : '=== DRY RUN — nothing will be written ===\n');

  const { rows } = await pool.query(
    `SELECT r.slug, r.user_uuid::text AS uid,
            r.actual_result->>'stravaActivityId' AS act,
            (r.meta->>'distanceMi')::float        AS nominal_mi,
            c.elevation_gain_ft::int              AS lib_gain,
            c.net_elevation_ft::int               AS lib_net,
            c.source                              AS lib_source
       FROM races r
       LEFT JOIN course_library c ON c.slug = r.slug
      WHERE r.actual_result->>'stravaActivityId' IS NOT NULL
        AND COALESCE(jsonb_array_length(r.course_geometry->'trackPoints'), 0) = 0
        ${slugArg ? 'AND r.slug = $1' : ''}
      ORDER BY r.slug`,
    slugArg ? [slugArg] : [],
  );

  if (!rows.length) { console.log('nothing to backfill'); return; }

  const token = await stravaToken(rows[0].uid);
  const plan = [];

  for (const row of rows) {
    console.log(`\n── ${row.slug}  (activity ${row.act})`);
    const url = `https://www.strava.com/api/v3/activities/${row.act}/streams?keys=latlng,altitude,distance&key_by_type=true`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) { console.log(`  FETCH FAILED ${res.status} ${res.statusText}`); continue; }
    const body = await res.json();
    const alt = body?.altitude?.data ?? null;
    const ll = body?.latlng?.data ?? null;
    const dist = body?.distance?.data ?? null;
    if (!alt || alt.length < 2) { console.log('  no altitude stream — skipping'); continue; }

    const points = alt.map((ele, i) => ({
      lat: ll?.[i] ? Number(ll[i][0]) : NaN,
      lon: ll?.[i] ? Number(ll[i][1]) : NaN,
      ele: isFinite(Number(ele)) ? Number(ele) : null,
    }));
    const prof = elevationProfileFt(points.map((p) => p.ele).filter((e) => e != null));
    const a = assess(points, row.nominal_mi);

    console.log(`  points ${points.length}  ·  measured ${a.mi?.toFixed(2) ?? '?'} mi (nominal ${row.nominal_mi ?? '?'})`);
    console.log(`  confidence ${a.confidence.toUpperCase()} — ${a.why}`);
    console.log(`  stored   gain ${row.lib_gain ?? '—'}  net ${row.lib_net ?? '—'}   (${row.lib_source ?? 'no library row'})`);
    console.log(`  measured gain ${prof.gainFt}  net ${prof.netFt}  loss ${prof.lossFt}`);

    const netDelta = row.lib_net != null ? prof.netFt - row.lib_net : null;
    if (netDelta != null && Math.abs(netDelta) > 50) {
      console.log(`  >>> NET CONFLICT: stored ${row.lib_net}, measured ${prof.netFt}  (${netDelta > 0 ? '+' : ''}${netDelta} ft)`);
    }
    if (a.confidence === 'reject') { console.log('  → would NOT be used (rejected)'); continue; }

    plan.push({ slug: row.slug, uid: row.uid, points, dist, act: row.act, prof });
  }

  console.log(`\n${plan.length} course(s) would get geometry.`);
  if (!COMMIT) {
    console.log('Dry run — re-run with --commit to write races.course_geometry.');
    return;
  }

  for (const p of plan) {
    const meters = p.dist?.length ? Number(p.dist[p.dist.length - 1]) : NaN;
    const lats = p.points.map((x) => x.lat).filter(isFinite);
    const lons = p.points.map((x) => x.lon).filter(isFinite);
    const geom = {
      source: 'strava_match',
      trackPoints: p.points,
      distance_mi: isFinite(meters) && meters > 0 ? +(meters / 1609.344).toFixed(2) : null,
      elevation_gain_ft: p.prof.gainFt,
      elevation_loss_ft: p.prof.lossFt,
      net_elevation_ft: p.prof.netFt,
      bbox: lats.length ? {
        minLat: Math.min(...lats), maxLat: Math.max(...lats),
        minLon: Math.min(...lons), maxLon: Math.max(...lons),
      } : null,
      strava_activity_id: String(p.act),
    };
    // Scoped by user_uuid as well as slug. `races` is per-user and slugs are
    // shared across runners, so a slug-only predicate would overwrite every
    // other athlete's row for the same race with THIS athlete's GPS trace.
    // The trackPoints guard keeps it idempotent and stops it clobbering
    // geometry that already exists.
    const res = await pool.query(
      `UPDATE races
          SET course_geometry = $3::jsonb, course_source = 'strava_match'
        WHERE slug = $1
          AND user_uuid = $2::uuid
          AND COALESCE(jsonb_array_length(course_geometry->'trackPoints'), 0) = 0`,
      [p.slug, p.uid, JSON.stringify(geom)],
    );
    console.log(`  wrote ${p.slug} (${p.points.length} points, ${res.rowCount} row)`);
  }
}

main()
  .catch((e) => { console.error('FAILED:', e.message); process.exitCode = 1; })
  .finally(() => pool.end());
