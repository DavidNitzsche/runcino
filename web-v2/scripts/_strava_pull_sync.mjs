/**
 * _strava_pull_sync.mjs · pull recent Strava activities and enhance the
 * canonical rows. Uses connector_tokens directly (mirrors getStravaToken
 * + refreshStravaToken logic from lib/strava/auth.ts).
 *
 * Pulls last 30 days. For each Strava activity:
 *   - Try to match an existing canonical run within ±10 min start AND
 *     ±0.1 mi distance via lib/runs/canonical.ts logic.
 *   - If matched: enhance the canonical with Strava's gear (→ shoe_id),
 *     perceived_exertion (→ post_run_rpe), splits, weather, etc.
 *   - If unmatched: INSERT a fresh canonical row sourced from Strava.
 *
 * Idempotent: re-running is safe · enhanceRun is enhance-only.
 *
 * Run: node web-v2/scripts/_strava_pull_sync.mjs
 *
 * David's UUID is hardcoded · this is the bootstrap one-shot. The
 * /api/cron/strava-sync route (built separately) will iterate every
 * connected user.
 */
import pg from 'pg';
import fs from 'fs';

const env = fs.readFileSync('.env.local','utf8').split('\n')
  .reduce((a,l)=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)a[m[1]]=m[2].replace(/^["']|["']$/g,'');return a;},{});
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const STRAVA_CLIENT_ID = env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = env.STRAVA_CLIENT_SECRET;

const SOURCE_TIER = {
  watch: 5, manual: 4, apple_watch: 3, apple_health: 2,
  strava: 1, strava_webhook: 1,
};
const tierFor = (s) => SOURCE_TIER[s ?? ''] ?? 0;

const NEVER_COPY = new Set([
  'id', 'activityId', 'source', 'ingestedAt', 'mergedIntoId',
  'client_workout_id', 'absorbed_into_canonical_at',
]);

// ─────────────────── Strava token + API ───────────────────

async function ensureValidStravaToken(userUuid) {
  const r = (await pool.query(
    `SELECT access_token, refresh_token, expires_at
       FROM connector_tokens
      WHERE provider='strava' AND (user_uuid = $1 OR user_id = $1)`,
    [userUuid],
  )).rows[0];
  if (!r?.refresh_token) throw new Error('no Strava refresh token for ' + userUuid);

  const expiresMs = r.expires_at ? new Date(r.expires_at).getTime() : 0;
  if (Date.now() < expiresMs - 5 * 60 * 1000) {
    return r.access_token;
  }

  console.log('Token expired or near-expiry · refreshing…');
  if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
    throw new Error('STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET missing from .env.local');
  }

  const resp = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      refresh_token: r.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`strava refresh failed: ${resp.status} ${body.slice(0, 200)}`);
  }
  const j = await resp.json();

  await pool.query(
    `UPDATE connector_tokens
        SET access_token = $1,
            refresh_token = $2,
            expires_at = to_timestamp($3),
            updated_at = NOW()
      WHERE provider = 'strava' AND (user_uuid = $4 OR user_id = $4)`,
    [j.access_token, j.refresh_token, j.expires_at, userUuid],
  );
  console.log('  ✓ refreshed · new expires_at = ' + new Date(j.expires_at * 1000).toISOString());
  return j.access_token;
}

async function listStravaActivities({ accessToken, afterEpoch, perPage = 50 }) {
  const all = [];
  let page = 1;
  while (true) {
    const url = `https://www.strava.com/api/v3/athlete/activities?after=${afterEpoch}&per_page=${perPage}&page=${page}`;
    const r = await fetch(url, { headers: { authorization: 'Bearer ' + accessToken } });
    if (!r.ok) {
      console.error('list activities failed:', r.status, await r.text());
      break;
    }
    const j = await r.json();
    if (!Array.isArray(j) || j.length === 0) break;
    all.push(...j);
    if (j.length < perPage) break;
    page++;
  }
  return all;
}

async function getStravaActivityDetail({ accessToken, activityId }) {
  const r = await fetch(
    `https://www.strava.com/api/v3/activities/${activityId}?include_all_efforts=false`,
    { headers: { authorization: 'Bearer ' + accessToken } },
  );
  if (!r.ok) return null;
  return r.json();
}

// ─────────────────── Canonical match + enhance ───────────────────

function distanceMi(stravaActivity) {
  return Number(stravaActivity.distance ?? 0) / 1609.344;
}

function startISO(stravaActivity) {
  return stravaActivity.start_date_local ?? stravaActivity.start_date ?? null;
}

async function findCanonicalRow({ userUuid, startISO: startIso, distMi }) {
  if (!startIso) return null;
  const r = await pool.query(
    `SELECT id::text AS id, data, provenance, shoe_id
       FROM strava_activities
      WHERE user_uuid = $1
        AND absorbed_into_canonical_at IS NULL
        AND NOT (data ? 'mergedIntoId')
        AND ABS(EXTRACT(EPOCH FROM (
              COALESCE(data->>'startLocal', data->>'date')::timestamp
              - $2::timestamp
            )) / 60) <= 10
        AND ABS(COALESCE((data->>'distanceMi')::numeric, 0) - $3::numeric) <= 0.15
      ORDER BY ABS(EXTRACT(EPOCH FROM (
              COALESCE(data->>'startLocal', data->>'date')::timestamp
              - $2::timestamp
            )) / 60) ASC
      LIMIT 1`,
    [userUuid, startIso, distMi],
  );
  return r.rows[0] ?? null;
}

async function tryShoeFromGear({ userUuid, gear }) {
  if (!gear || typeof gear !== 'object') return null;
  const brand = String(gear.brand_name ?? '').trim();
  const model = String(gear.model_name ?? gear.name ?? '').trim();
  if (!brand && !model) return null;

  if (brand && model) {
    let r = await pool.query(
      `SELECT id FROM shoes WHERE user_uuid = $1 AND retired = false
        AND LOWER(brand) = LOWER($2) AND LOWER(model) = LOWER($3) LIMIT 1`,
      [userUuid, brand, model],
    );
    if (r.rows[0]) return r.rows[0].id;

    r = await pool.query(
      `SELECT id FROM shoes WHERE user_uuid = $1 AND retired = false
        AND LOWER(brand) = LOWER($2)
        AND (LOWER(model) LIKE '%' || LOWER($3) || '%' OR LOWER($3) LIKE '%' || LOWER(model) || '%')
        LIMIT 1`,
      [userUuid, brand, model],
    );
    if (r.rows[0]) return r.rows[0].id;
  }
  return null;
}

function stravaToFaffPayload(act, detail) {
  return {
    activityId: String(act.id),
    source: 'strava',
    name: act.name,
    date: act.start_date_local?.slice(0, 10) ?? null,
    startLocal: act.start_date_local ?? null,
    distanceMi: Math.round((act.distance / 1609.344) * 100) / 100,
    durationSec: act.elapsed_time,
    movingTimeS: act.moving_time,
    // avgPaceMinPerMi is intentionally omitted · log-state.ts derives a
    // formatted "M:SS" string from paceSPerMi when missing. Writing a
    // numeric value here breaks paceSec/paceToSec callers (TypeError:
    // p.split is not a function).
    paceSPerMi: act.average_speed > 0 ? Math.round(1609.344 / act.average_speed) : null,
    avgHr: act.average_heartrate ?? null,
    maxHr: act.max_heartrate ?? null,
    elevGainFt: act.total_elevation_gain ? Math.round(act.total_elevation_gain * 3.281) : null,
    routePolyline: act.map?.summary_polyline ?? null,
    perceived_exertion: detail?.perceived_exertion ?? null,
    gear: detail?.gear ?? null,
    gear_id: detail?.gear_id ?? act.gear_id ?? null,
    splits: detail?.splits_standard ?? detail?.splits_metric ?? null,
  };
}

async function enhanceCanonical(canonical, stravaPayload, incomingSource = 'strava') {
  const incomingTier = tierFor(incomingSource);
  const canonicalData = canonical.data ?? {};
  const canonicalProv = canonical.provenance ?? {};
  const updatedData = { ...canonicalData };
  const updatedProv = { ...canonicalProv };
  const fieldsAdded = [];

  for (const key of Object.keys(stravaPayload)) {
    if (NEVER_COPY.has(key)) continue;
    if (key === 'gear' || key === 'gear_id' || key === 'perceived_exertion') continue;
    const v = stravaPayload[key];
    if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) continue;

    const existingVal = canonicalData[key];
    const existingTier = tierFor(canonicalProv[key]);

    if (existingVal == null || existingVal === '' || (Array.isArray(existingVal) && existingVal.length === 0)) {
      updatedData[key] = v;
      updatedProv[key] = incomingSource;
      fieldsAdded.push(key);
    } else if (incomingTier > existingTier) {
      updatedData[key] = v;
      updatedProv[key] = incomingSource;
      fieldsAdded.push(key + '*');
    }
  }

  // gear → shoe_id
  let shoeAttributed = null;
  if (canonical.shoe_id == null && stravaPayload.gear) {
    const shoeId = await tryShoeFromGear({ userUuid: DAVID, gear: stravaPayload.gear });
    if (shoeId != null) {
      await pool.query(
        `UPDATE strava_activities SET shoe_id = $1 WHERE id = $2::BIGINT AND shoe_id IS NULL`,
        [shoeId, canonical.id],
      );
      shoeAttributed = shoeId;
      fieldsAdded.push('shoe_id');
    }
  }

  // perceived_exertion → post_run_rpe
  let rpeWritten = null;
  if (typeof stravaPayload.perceived_exertion === 'number'
      && stravaPayload.perceived_exertion >= 1
      && stravaPayload.perceived_exertion <= 10) {
    const existing = (await pool.query(
      `SELECT id FROM post_run_rpe WHERE user_uuid = $1 AND activity_id = $2 LIMIT 1`,
      [DAVID, String(canonical.id)],
    )).rows[0];
    if (!existing) {
      await pool.query(
        `INSERT INTO post_run_rpe (user_id, user_uuid, activity_id, rpe, notes, logged_at)
         VALUES ($1, $1, $2, $3, $4, NOW())`,
        [DAVID, String(canonical.id), Math.round(stravaPayload.perceived_exertion),
         'auto-imported from strava'],
      );
      rpeWritten = Math.round(stravaPayload.perceived_exertion);
      fieldsAdded.push('post_run_rpe');
    }
  }

  if (fieldsAdded.some(f => f !== 'shoe_id' && f !== 'post_run_rpe')) {
    await pool.query(
      `UPDATE strava_activities SET data = $1::jsonb, provenance = $2::jsonb
        WHERE id = $3::BIGINT`,
      [JSON.stringify(updatedData), JSON.stringify(updatedProv), canonical.id],
    );
  }

  return { fieldsAdded, shoeAttributed, rpeWritten };
}

// ─────────────────── Main ───────────────────

async function main() {
  console.log('Strava pull-sync · last 30 days · David');
  console.log('=========================================');
  const accessToken = await ensureValidStravaToken(DAVID);
  console.log('✓ have valid access token');

  const after = Math.floor((Date.now() - 30 * 86400000) / 1000);
  const activities = await listStravaActivities({ accessToken, afterEpoch: after, perPage: 50 });
  console.log(`Found ${activities.length} Strava activities in last 30 days.`);

  let matched = 0, unmatched = 0, fieldsAdded = 0, shoes = 0, rpe = 0;

  for (const act of activities) {
    if (act.type !== 'Run' && act.sport_type !== 'Run' && act.sport_type !== 'TrailRun') continue;

    const distMi = distanceMi(act);
    const startIso = startISO(act);
    const canonical = await findCanonicalRow({ userUuid: DAVID, startISO: startIso, distMi });

    let needsDetail = false;
    if (canonical) {
      needsDetail = !(canonical.shoe_id) || !canonical.data?.perceived_exertion;
    } else {
      needsDetail = true;
    }

    const detail = needsDetail ? await getStravaActivityDetail({ accessToken, activityId: act.id }) : null;
    const payload = stravaToFaffPayload(act, detail);

    if (canonical) {
      matched++;
      const result = await enhanceCanonical(canonical, payload, 'strava');
      if (result.fieldsAdded.length > 0) {
        fieldsAdded += result.fieldsAdded.length;
        if (result.shoeAttributed) shoes++;
        if (result.rpeWritten) rpe++;
        console.log(`  ${startIso?.slice(0, 10)} ${distMi.toFixed(1)}mi → enhanced canonical ${canonical.id} · added ${result.fieldsAdded.join(', ')}`);
      }
    } else {
      unmatched++;
      // Insert as a new Strava-sourced canonical row. The provenance jsonb gets
      // stamped per-field as 'strava' so future ingests from higher-tier sources
      // (apple_watch, watch, manual) can enhance.
      const provenance = {};
      for (const k of Object.keys(payload)) {
        if (payload[k] != null && payload[k] !== '' && k !== 'gear' && k !== 'gear_id' && k !== 'perceived_exertion') {
          provenance[k] = 'strava';
        }
      }
      const newId = String(act.id);
      let shoeId = null;
      if (payload.gear) {
        shoeId = await tryShoeFromGear({ userUuid: DAVID, gear: payload.gear });
      }
      await pool.query(
        `INSERT INTO strava_activities (id, user_uuid, data, provenance, shoe_id, fetched_at)
         VALUES ($1::BIGINT, $2, $3::jsonb, $4::jsonb, $5, NOW())
         ON CONFLICT (id) DO NOTHING`,
        [newId, DAVID, JSON.stringify(payload), JSON.stringify(provenance), shoeId],
      );
      if (typeof payload.perceived_exertion === 'number') {
        await pool.query(
          `INSERT INTO post_run_rpe (user_id, user_uuid, activity_id, rpe, notes, logged_at)
           VALUES ($1, $1, $2, $3, 'auto-imported from strava', NOW())
           ON CONFLICT DO NOTHING`,
          [DAVID, newId, Math.round(payload.perceived_exertion)],
        ).catch(() => {});
      }
      console.log(`  ${startIso?.slice(0, 10)} ${distMi.toFixed(1)}mi → INSERTED new canonical id=${newId}` + (shoeId ? ` · shoe=${shoeId}` : ''));
    }
  }

  console.log('');
  console.log(`Matched (enhanced): ${matched}`);
  console.log(`Unmatched (would insert · skipped this pass): ${unmatched}`);
  console.log(`Total fields added: ${fieldsAdded}`);
  console.log(`Shoes attributed: ${shoes}`);
  console.log(`RPE rows written: ${rpe}`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
