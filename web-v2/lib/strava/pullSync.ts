/**
 * lib/strava/pullSync.ts · scheduled Strava pull-sync.
 *
 * Walks every Strava-connected user, pulls their last-N-days of activities
 * from /athlete/activities, then either ENHANCES a matching canonical row
 * (start within ±10 min, distance within ±0.15 mi) or INSERTS a new
 * canonical row when no match exists.
 *
 * Doctrine (David, 2026-05-31): "Faff app first, then HealthKit, then
 * Strava. Never duplicate data, always enhance." Strava's tier=1, so on
 * conflict with a higher-tier source already in canonical, the canonical
 * value wins. Strava only fills gaps and inserts genuinely-new runs.
 *
 * Companion to lib/runs/canonical.ts (enhancement engine on dedup-loser
 * rows). This module pulls from the Strava API directly; merge.ts is
 * what handles the inbound webhook path.
 *
 * Used by: app/api/cron/strava-sync · scripts/_strava_pull_sync.mjs
 *   (the script is the canonical hand-runnable mirror of this lib)
 */
import { pool } from '@/lib/db/pool';
import { getStravaToken } from '@/lib/strava/auth';
import { SOURCE_TIER } from '@/lib/runs/canonical';
import { sanitizeElevGain } from '@/lib/runs/elev-sanity';

const STRAVA_API = 'https://www.strava.com/api/v3';
const M_PER_MILE = 1609.344;
const MATCH_WINDOW_SEC = 600;     // ±10 min on start time
const MATCH_DIST_MI = 0.15;       // ±0.15 mi on distance

function tierFor(source: string | null | undefined): number {
  if (!source) return 0;
  return SOURCE_TIER[source] ?? 0;
}

const NEVER_COPY = new Set<string>([
  'id', 'activityId', 'source', 'ingestedAt', 'mergedIntoId',
  'client_workout_id', 'absorbed_into_canonical_at',
]);
const SPECIAL_ROUTE = new Set<string>([
  'gear', 'gear_id', 'perceived_exertion', 'rpe',
]);

interface StravaActivity {
  id: number;
  name: string;
  type: string;
  sport_type?: string;
  workout_type?: number;
  start_date: string;          // ISO UTC
  start_date_local: string;    // ISO local-wall
  distance: number;            // meters
  moving_time: number;
  elapsed_time: number;
  total_elevation_gain: number;
  average_speed?: number;      // m/s
  average_heartrate?: number;
  max_heartrate?: number;
  average_cadence?: number;
  suffer_score?: number;
  achievement_count?: number;
  kudos_count?: number;
  /** Strava ships kcal for runs that carry HR or power. Detail-only field. */
  calories?: number;
  start_latlng?: [number, number] | null;
  end_latlng?: [number, number] | null;
  map?: { summary_polyline?: string | null };
  gear_id?: string | null;
}

interface StravaActivityDetail extends StravaActivity {
  splits_standard?: Array<{
    distance: number;            // meters
    moving_time: number;
    elapsed_time: number;
    average_speed: number;
    elevation_difference: number;
    pace_zone?: number;
    split: number;
  }>;
  splits_metric?: Array<{
    distance: number;
    moving_time: number;
    elapsed_time: number;
    average_speed: number;
  }>;
  map?: { polyline?: string | null; summary_polyline?: string | null };
  gear?: {
    id?: string;
    name?: string;
    brand_name?: string;
    model_name?: string;
  };
  perceived_exertion?: number | null;
}

/**
 * Convert a Strava activity (list + detail merged) to the Faff canonical
 * data shape. Returns the `data` jsonb payload.
 */
function stravaToFaffPayload(
  act: StravaActivity,
  detail: StravaActivityDetail | null,
): Record<string, unknown> {
  const distanceMi = act.distance / M_PER_MILE;
  const avgSpeedMph = act.average_speed != null
    ? act.average_speed * 2.23693629
    : null;
  const paceSPerMi = act.average_speed && act.average_speed > 0
    ? M_PER_MILE / act.average_speed
    : null;

  // Sanity-check elev_gain at ingest time. Strava receives whatever the
  // watch sent · barometric drift produces 5-10x overshoots on long runs.
  // sanitizeElevGain demands splits corroboration above 250 ft/mi before
  // accepting a wild number; otherwise it swaps in a credible
  // splits-derived value AND stamps `elevGainSource = 'recomputed'` so
  // the read path knows the provenance.
  const rawElevFt = Math.round(act.total_elevation_gain * 3.28084);
  const elevSanity = sanitizeElevGain({
    elevGainFt: rawElevFt,
    distanceMi,
    splits: detail?.splits_standard,
  });

  const payload: Record<string, unknown> = {
    id: String(act.id),
    name: act.name,
    type: act.type,
    sportType: act.sport_type,
    workoutType: act.workout_type,
    date: act.start_date,
    startLocal: act.start_date_local,
    distanceMi: Number(distanceMi.toFixed(4)),
    movingTimeS: act.moving_time,
    elapsedTimeS: act.elapsed_time,
    elevGainFt: elevSanity.value,
    elevGainSource: elevSanity.source,
    avgSpeedMph: avgSpeedMph != null ? Number(avgSpeedMph.toFixed(3)) : null,
    paceSPerMi: paceSPerMi != null ? Math.round(paceSPerMi) : null,
    avgHr: act.average_heartrate ?? null,
    maxHr: act.max_heartrate ?? null,
    avgCadence: act.average_cadence ?? null,
    sufferScore: act.suffer_score ?? null,
    achievementCount: act.achievement_count ?? null,
    kudosCount: act.kudos_count ?? null,
    startLatLng: act.start_latlng ?? null,
    endLatLng: act.end_latlng ?? null,
    summaryPolyline: act.map?.summary_polyline ?? null,
    source: 'strava',
  };

  if (detail) {
    if (detail.splits_standard?.length) payload.splits = detail.splits_standard;
    if (detail.splits_metric?.length)   payload.splits_metric = detail.splits_metric;
    if (detail.map?.polyline)           payload.routePolyline = detail.map.polyline;
    if (detail.gear)                    payload.gear = detail.gear;
    if (detail.gear_id)                 payload.gear_id = detail.gear_id;
    if (typeof detail.perceived_exertion === 'number') {
      payload.perceived_exertion = detail.perceived_exertion;
    }
    // Strava only exposes calories on the detail endpoint, not the list.
    // Persist as `calories` (matches Strava's name); the read path in
    // lib/coach/run-state.ts falls back to active_energy samples when this
    // is null (Apple-Watch-only runs).
    if (typeof detail.calories === 'number' && detail.calories > 0) {
      payload.calories = Math.round(detail.calories);
    }
  }
  return payload;
}

async function listStravaActivities(
  token: string,
  afterEpoch: number,
): Promise<StravaActivity[]> {
  const out: StravaActivity[] = [];
  let page = 1;
  for (;;) {
    const url = `${STRAVA_API}/athlete/activities?after=${afterEpoch}&per_page=100&page=${page}`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error(`STRAVA_LIST_FAILED: ${r.status} ${txt.slice(0, 200)}`);
    }
    const batch = await r.json() as StravaActivity[];
    if (!Array.isArray(batch) || batch.length === 0) break;
    out.push(...batch);
    if (batch.length < 100) break;
    page++;
    if (page > 20) break;  // safety
  }
  return out.filter((a) => a.type === 'Run' || a.sport_type === 'Run' || a.sport_type === 'TrailRun');
}

async function getStravaActivityDetail(
  token: string,
  id: number,
): Promise<StravaActivityDetail | null> {
  const r = await fetch(
    `${STRAVA_API}/activities/${id}?include_all_efforts=false`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!r.ok) return null;
  return await r.json() as StravaActivityDetail;
}

async function findCanonicalRow(args: {
  userUuid: string;
  startIso: string;
  distMi: number;
}): Promise<{ id: string; data: Record<string, unknown>; provenance: Record<string, string>; shoe_id: number | null } | null> {
  const { userUuid, startIso, distMi } = args;
  const r = await pool.query<{
    id: string;
    data: Record<string, unknown>;
    provenance: Record<string, string>;
    shoe_id: number | null;
  }>(
    `SELECT id::text AS id, data, provenance, shoe_id
       FROM runs
      WHERE user_uuid = $1
        AND absorbed_into_canonical_at IS NULL
        AND (data ? 'mergedIntoId') = false
        AND COALESCE(
              (data->>'date')::timestamptz,
              (data->>'startLocal')::timestamptz,
              (data->>'startDate')::timestamptz
            ) IS NOT NULL
        AND ABS(EXTRACT(EPOCH FROM (
              COALESCE(
                (data->>'date')::timestamptz,
                (data->>'startLocal')::timestamptz,
                (data->>'startDate')::timestamptz
              ) - $2::timestamptz
            ))) < $3
        AND ABS(COALESCE(
              (data->>'distanceMi')::numeric,
              (data->>'distance_mi')::numeric,
              0
            ) - $4::numeric) < $5
      LIMIT 1`,
    [userUuid, startIso, MATCH_WINDOW_SEC, distMi, MATCH_DIST_MI],
  );
  return r.rows[0] ?? null;
}

async function tryShoeFromGear(args: {
  userUuid: string;
  gear: unknown;
}): Promise<number | null> {
  const { userUuid, gear } = args;
  if (!gear || typeof gear !== 'object') return null;
  const g = gear as Record<string, unknown>;
  const brand = String(g.brand_name ?? g.brand ?? '').trim();
  const model = String(g.model_name ?? g.model ?? g.name ?? '').trim();
  if (!brand && !model) return null;
  if (brand && model) {
    const exact = (await pool.query<{ id: number }>(
      `SELECT id FROM shoes WHERE user_uuid = $1 AND retired = false
         AND LOWER(brand) = LOWER($2) AND LOWER(model) = LOWER($3) LIMIT 1`,
      [userUuid, brand, model],
    )).rows[0];
    if (exact) return exact.id;
    const loose = (await pool.query<{ id: number }>(
      `SELECT id FROM shoes WHERE user_uuid = $1 AND retired = false
         AND LOWER(brand) = LOWER($2)
         AND (LOWER(model) LIKE '%' || LOWER($3) || '%' OR LOWER($3) LIKE '%' || LOWER(model) || '%')
         LIMIT 1`,
      [userUuid, brand, model],
    )).rows[0];
    if (loose) return loose.id;
  }
  return null;
}

export interface SyncOneResult {
  userUuid: string;
  fetched: number;
  matched: number;
  inserted: number;
  fieldsAdded: number;
  shoesAttributed: number;
  rpeWritten: number;
  errors: string[];
}

/**
 * Pull last-N-days of Strava activities for one user and reconcile into
 * the canonical model. Skips activity-detail fetches when we already
 * matched canonical and the canonical has the field we'd be pulling.
 */
export async function pullSyncOneUser(args: {
  userUuid: string;
  windowDays?: number;
}): Promise<SyncOneResult> {
  const { userUuid } = args;
  const windowDays = args.windowDays ?? 30;
  const out: SyncOneResult = {
    userUuid,
    fetched: 0,
    matched: 0,
    inserted: 0,
    fieldsAdded: 0,
    shoesAttributed: 0,
    rpeWritten: 0,
    errors: [],
  };

  let token: string;
  try {
    token = await getStravaToken(userUuid);
  } catch (e: any) {
    out.errors.push(`token: ${e?.message ?? String(e)}`);
    return out;
  }

  const afterEpoch = Math.floor((Date.now() - windowDays * 86400000) / 1000);
  let acts: StravaActivity[];
  try {
    acts = await listStravaActivities(token, afterEpoch);
  } catch (e: any) {
    out.errors.push(`list: ${e?.message ?? String(e)}`);
    return out;
  }
  out.fetched = acts.length;

  for (const act of acts) {
    try {
      const distMi = act.distance / M_PER_MILE;
      const startIso = act.start_date;
      const match = await findCanonicalRow({ userUuid, startIso, distMi });

      // Fetch detail only if matched + canonical missing key fields, OR
      // we're about to insert (always need detail for new inserts).
      const needsDetail = !match
        || !(match.data?.splits as unknown[] | undefined)?.length
        || !match.data?.routePolyline
        || !match.shoe_id;
      const detail = needsDetail ? await getStravaActivityDetail(token, act.id) : null;
      const payload = stravaToFaffPayload(act, detail);

      if (match) {
        // ENHANCE: fold incoming fields into canonical per tier rules
        const canoData = match.data ?? {};
        const canoProv = match.provenance ?? {};
        const incomingTier = tierFor('strava');
        const updatedData = { ...canoData };
        const updatedProv = { ...canoProv };
        let added = 0;
        for (const k of Object.keys(payload)) {
          if (NEVER_COPY.has(k) || SPECIAL_ROUTE.has(k)) continue;
          const inVal = (payload as Record<string, unknown>)[k];
          if (inVal == null || inVal === '' || (Array.isArray(inVal) && inVal.length === 0)) continue;
          const cVal = (canoData as Record<string, unknown>)[k];
          const existingTier = tierFor(canoProv[k]);
          if (cVal == null || cVal === '' || (Array.isArray(cVal) && cVal.length === 0)) {
            updatedData[k] = inVal; updatedProv[k] = 'strava'; added++;
          } else if (incomingTier > existingTier) {
            updatedData[k] = inVal; updatedProv[k] = 'strava'; added++;
          }
        }
        if (added > 0) {
          await pool.query(
            `UPDATE runs SET data = $1::jsonb, provenance = $2::jsonb
              WHERE id = $3::BIGINT`,
            [JSON.stringify(updatedData), JSON.stringify(updatedProv), match.id],
          );
          out.fieldsAdded += added;
        }
        // Shoe attribution
        if (match.shoe_id == null && payload.gear) {
          const shoeId = await tryShoeFromGear({ userUuid, gear: payload.gear });
          if (shoeId != null) {
            await pool.query(
              `UPDATE runs SET shoe_id = $1, shoe_auto_assigned_at = NOW()
                WHERE id = $2::BIGINT AND shoe_id IS NULL`,
              [shoeId, match.id],
            );
            out.shoesAttributed++;
          }
        }
        // RPE
        if (typeof payload.perceived_exertion === 'number') {
          const rpe = Math.round(payload.perceived_exertion);
          if (rpe >= 1 && rpe <= 10) {
            const existing = (await pool.query(
              `SELECT id FROM post_run_rpe WHERE user_uuid = $1 AND activity_id = $2 LIMIT 1`,
              [userUuid, match.id],
            )).rows[0];
            if (!existing) {
              await pool.query(
                `INSERT INTO post_run_rpe (user_id, user_uuid, activity_id, rpe, notes, logged_at)
                 VALUES ($1, $1, $2, $3, 'auto-imported from strava', NOW())`,
                [userUuid, match.id, rpe],
              );
              out.rpeWritten++;
            }
          }
        }
        out.matched++;
      } else {
        // INSERT: new canonical row
        const provenance: Record<string, string> = {};
        for (const k of Object.keys(payload)) {
          const v = (payload as Record<string, unknown>)[k];
          if (v != null && v !== '' && !SPECIAL_ROUTE.has(k)) {
            provenance[k] = 'strava';
          }
        }
        let shoeId: number | null = null;
        if (payload.gear) shoeId = await tryShoeFromGear({ userUuid, gear: payload.gear });
        // 2026-06-01 · counter bug fix (task #70). The INSERT below uses
        // ON CONFLICT DO NOTHING · when a row with the same Strava id
        // already exists, the insert silently no-ops AND the previous
        // code would still tick out.inserted++ / shoesAttributed++ /
        // rpeWritten++. That made the cron's "we inserted N runs" metric
        // overcount by every silent conflict (which can happen if the
        // sync ran twice for the same window). Now: capture rowCount and
        // only tick when it's 1.
        const insRes = await pool.query(
          `INSERT INTO runs (id, user_uuid, data, provenance, shoe_id, fetched_at)
           VALUES ($1::BIGINT, $2, $3::jsonb, $4::jsonb, $5, NOW())
           ON CONFLICT (id) DO NOTHING`,
          [String(act.id), userUuid, JSON.stringify(payload), JSON.stringify(provenance), shoeId],
        );
        const reallyInserted = (insRes.rowCount ?? 0) > 0;
        if (!reallyInserted) {
          // Row already existed · not a real insert. Skip the counters
          // and let the next iteration handle it as a match if the
          // upstream branch's match query missed it.
          continue;
        }
        if (shoeId != null) out.shoesAttributed++;
        if (typeof payload.perceived_exertion === 'number') {
          const rpe = Math.round(payload.perceived_exertion);
          if (rpe >= 1 && rpe <= 10) {
            const rpeRes = await pool.query(
              `INSERT INTO post_run_rpe (user_id, user_uuid, activity_id, rpe, notes, logged_at)
               VALUES ($1, $1, $2, $3, 'auto-imported from strava', NOW())
               ON CONFLICT DO NOTHING`,
              [userUuid, String(act.id), rpe],
            ).catch(() => ({ rowCount: 0 } as { rowCount: number | null }));
            if ((rpeRes.rowCount ?? 0) > 0) out.rpeWritten++;
          }
        }
        out.inserted++;
      }
    } catch (e: any) {
      out.errors.push(`activity ${act.id}: ${e?.message ?? String(e)}`);
    }
  }
  return out;
}

/**
 * Walk every Strava-connected user, run pullSyncOneUser. Updates
 * connector_tokens.last_sync_at + last_sync_status on each.
 */
export async function pullSyncAllUsers(args?: {
  windowDays?: number;
}): Promise<{ users: number; results: SyncOneResult[] }> {
  const windowDays = args?.windowDays ?? 30;
  const users = (await pool.query<{ user_uuid: string }>(
    `SELECT DISTINCT COALESCE(user_uuid, user_id) AS user_uuid
       FROM connector_tokens
      WHERE provider = 'strava'
        AND access_token IS NOT NULL
        AND disconnected_at IS NULL`,
  )).rows;

  const results: SyncOneResult[] = [];
  for (const { user_uuid } of users) {
    if (!user_uuid) continue;
    const r = await pullSyncOneUser({ userUuid: user_uuid, windowDays });
    results.push(r);
    const status = r.errors.length === 0 ? 'ok' : 'partial';
    await pool.query(
      `UPDATE connector_tokens
          SET last_sync_at = NOW(),
              last_sync_status = $1,
              last_sync_error = $2,
              activities_count = COALESCE(activities_count, 0) + $3
        WHERE COALESCE(user_uuid, user_id) = $4 AND provider = 'strava'`,
      [status, r.errors.slice(0, 3).join(' · ') || null, r.inserted, user_uuid],
    ).catch(() => {});
  }
  return { users: users.length, results };
}
