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
import { logReadFailure } from '@/lib/db/read';
import { getStravaToken } from '@/lib/strava/auth';
import { SOURCE_TIER, existingTierFor, IDENTITY_FILL_ONLY } from '@/lib/runs/canonical';
import { isSameRun, type RunRow } from '@/lib/runs/identity';
import { runnerTimezoneOrPacific } from '@/lib/runtime/runner-tz';
import { runDaySql } from '@/lib/runs/run-shape';
import { sanitizeElevGain } from '@/lib/runs/elev-sanity';
import { isSubThresholdRun } from '@/lib/runs/length-guard';
import { CANONICAL_ROW_SQL } from '@/lib/runs/volume';
// Shared gear matcher · also used by the ingest-time auto-assign hook
// (lib/shoe/auto-assign.ts) so there is ONE gear-match source, not two.
import { matchShoeByGear as tryShoeFromGear } from '@/lib/shoe/gear-match';

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
    // `date` is the LOCAL calendar day (YYYY-MM-DD) — the invariant every
    // reader assumes (`data->>'date' = plan.date_iso` joins, the
    // `COALESCE(data->>'date', LEFT(data->>'startLocal',10))` fallback, and
    // profile-state's last-sync parse). Writing Strava's full UTC timestamp
    // (act.start_date) here was wrong twice: wrong format (a full timestamp
    // that crashed profile-state → null profile → cold Targets gap) AND wrong
    // day (UTC rolls an evening run to tomorrow). Truncate the LOCAL start.
    date: String(act.start_date_local ?? act.start_date ?? '').slice(0, 10) || null,
    startLocal: act.start_date_local,
    // 2026-08-21 · ingest audit · the ABSOLUTE start instant, kept alongside
    // the wall clock. `start_date_local` carries a spurious Z and is in the
    // zone STRAVA assigned the activity from its GPS, which is not always the
    // zone the runner's device was in — on 2026-08-01 the two differed by two
    // hours (a run logged at sea) and the Strava row never merged with its
    // Apple-Watch twin, double-counting 1.34 mi. `start_date` needs no zone
    // and no inference. lib/runs/identity.ts prefers it. See exactStartUtcMs.
    startUtc: act.start_date ?? null,
    distanceMi: Number(distanceMi.toFixed(4)),
    movingTimeS: act.moving_time,
    elapsedTimeS: act.elapsed_time,
    elevGainFt: elevSanity.value,
    elevGainSource: elevSanity.source,
    avgSpeedMph: avgSpeedMph != null ? Number(avgSpeedMph.toFixed(3)) : null,
    paceSPerMi: paceSPerMi != null ? Math.round(paceSPerMi) : null,
    avgHr: act.average_heartrate ?? null,
    maxHr: act.max_heartrate ?? null,
    // Strava's running average_cadence is per-leg (half true steps/min); the
    // webhook path already doubles it. Match here so cron-synced runs store
    // full SPM (~168, not ~84) and clear the 130-220 health-baseline guard.
    avgCadence: act.average_cadence != null ? Math.round(act.average_cadence * 2) : null,
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

/**
 * The canonical row this Strava activity already exists as, or null.
 *
 * 2026-08-21 · ingest audit · REWRITTEN. The old query was:
 *
 *   ABS(EXTRACT(EPOCH FROM (
 *     COALESCE((data->>'date')::timestamptz, (data->>'startLocal')::timestamptz, …)
 *     - $startIso::timestamptz))) < 600
 *
 * `data->>'date'` is a bare `YYYY-MM-DD`, and it is present on effectively
 * every row, so the COALESCE always resolved to it and `::timestamptz` turned
 * it into MIDNIGHT. The comparison was therefore "did this run start within
 * ten minutes of midnight?" — false for every daytime run. Measured on the
 * 2026-08-01 activity: 81,833 s apart against a 600 s window.
 *
 * The ENHANCE branch was consequently unreachable and every Strava activity
 * took the INSERT branch, laying down a second row for a run the watch or
 * HealthKit had already delivered and leaving dedup entirely to the nightly
 * merge cron.
 *
 * Now it asks the merge engine. `isSameRun` is the SAME predicate
 * `autoMergeForDate` and the volume reader use, so the matcher and the merge
 * can no longer disagree about what counts as the same physical run — the
 * drift that made a repair job necessary in the first place.
 */
async function findCanonicalRow(args: {
  userUuid: string;
  /** Strava `start_date` · the true UTC instant. */
  startIso: string;
  /** Strava `start_date_local` · athlete-local wall time, Z-suffixed. */
  startLocalIso: string;
  distMi: number;
  movingSec: number;
}): Promise<{ id: string; data: Record<string, unknown>; provenance: Record<string, string>; shoe_id: number | null } | null> {
  const { userUuid, startIso, startLocalIso, distMi, movingSec } = args;

  const localDay = String(startLocalIso || startIso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDay)) return null;

  // Candidates: the canonical rows on the activity's own local day, plus the
  // days either side. The neighbours matter because the two sides can disagree
  // about which calendar day a late-evening or early-morning run belongs to —
  // exactly the disagreement `isSameRun` is there to settle. `isSameRun` still
  // requires equal local days, so a neighbour only matches when its own `date`
  // already agrees.
  const r = await pool.query<{
    id: string;
    user_uuid: string;
    data: Record<string, unknown>;
    provenance: Record<string, string>;
    shoe_id: number | null;
  }>(
    // #4 · CANONICAL_ROW_SQL is the shared canonical-row predicate (see
    // lib/runs/volume.ts). Keying only on mergedIntoId matches volume; a true
    // loser always carries mergedIntoId, so it can never be picked here.
    `SELECT id::text AS id, user_uuid::text AS user_uuid, data, provenance, shoe_id
       FROM runs
      WHERE user_uuid = $1
        AND ${CANONICAL_ROW_SQL}
        AND ${runDaySql()} BETWEEN $2 AND $3`,
    [
      userUuid,
      new Date(Date.parse(localDay + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10),
      new Date(Date.parse(localDay + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10),
    ],
  );
  if (r.rows.length === 0) return null;

  const tz = await runnerTimezoneOrPacific(userUuid);
  const incoming: RunRow = {
    id: '__incoming__',
    user_uuid: userUuid,
    data: {
      source: 'strava',
      date: localDay,
      startLocal: startLocalIso || null,
      // The absolute instant · makes the comparison exact regardless of which
      // zone Strava assigned the activity or which zone the device was in.
      startUtc: startIso || null,
      distanceMi: distMi,
      durationSec: movingSec,
    },
  };

  for (const row of r.rows) {
    if (isSameRun(incoming, { id: row.id, user_uuid: row.user_uuid, data: row.data }, tz)) {
      return { id: row.id, data: row.data, provenance: row.provenance, shoe_id: row.shoe_id };
    }
  }
  // Fallback for rows the identity predicate cannot pin (a legacy row with no
  // usable timestamp on either side): the original intent, ±10 min on the true
  // start instant and ±0.15 mi, but comparing against the row's own start
  // rather than midnight of its date.
  for (const row of r.rows) {
    const rowStart = rowStartMsFallback(row.data);
    if (rowStart == null) continue;
    const incomingStart = Date.parse(startIso);
    if (!Number.isFinite(incomingStart)) continue;
    if (Math.abs(rowStart - incomingStart) >= MATCH_WINDOW_SEC * 1000) continue;
    const rowDist = Number(row.data?.distanceMi ?? (row.data as Record<string, unknown>)?.distance_mi ?? 0);
    if (Math.abs(rowDist - distMi) >= MATCH_DIST_MI) continue;
    return { id: row.id, data: row.data, provenance: row.provenance, shoe_id: row.shoe_id };
  }
  return null;
}

/** Best-effort absolute start for the ±10-min fallback above. Offset-carrying
 *  values only — a bare wall clock has no defensible instant here, and
 *  `isSameRun` above has already had its go at those. */
function rowStartMsFallback(data: Record<string, unknown> | null | undefined): number | null {
  for (const key of ['startUtc', 'startLocal', 'startDate']) {
    const v = data?.[key];
    if (typeof v !== 'string' || !v) continue;
    if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(v)) continue;
    const ms = Date.parse(v);
    if (Number.isFinite(ms)) return ms;
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
  /** 2026-06-02 · sub-threshold drops · count of Strava activities
   *  rejected at the length guard (< 0.25 mi AND < 180 s).
   *  See lib/runs/length-guard.ts. */
  droppedSubThreshold: number;
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
    droppedSubThreshold: 0,
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
      // 2026-06-02 · length guard · skip tap tests that found their
      // way to Strava (e.g. a watch test that auto-pushed). Threshold
      // matches the other 3 ingest sites: < 0.25 mi AND < 180 s.
      const guard = isSubThresholdRun({
        distanceMi: distMi,
        durationSec: act.moving_time ?? act.elapsed_time ?? 0,
      });
      if (guard.isSubThreshold) {
        out.droppedSubThreshold++;
        continue;
      }
      const startIso = act.start_date;
      const match = await findCanonicalRow({
        userUuid,
        startIso,
        startLocalIso: act.start_date_local,
        distMi,
        movingSec: act.moving_time ?? act.elapsed_time ?? 0,
      });

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
          // 2026-08-21 · ingest audit · floor the existing tier at the
          // canonical row's OWN source (see canonical.ts existingTierFor).
          // `provenance` only records ABSORBED fields, so an unstamped field
          // read as tier 0 and this tier-1 Strava enhance overwrote a tier-5
          // Faff-watch value. Same bug, second site — symmetric fix.
          const existingTier = existingTierFor(canoData, canoProv, k);
          if (cVal == null || cVal === '' || (Array.isArray(cVal) && cVal.length === 0)) {
            updatedData[k] = inVal; updatedProv[k] = 'strava'; added++;
          } else if (IDENTITY_FILL_ONLY.has(k)) {
            // Present already · Strava never moves an existing run in time.
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
              // A DEDUP READ, so a miss fails OPEN and writes a SECOND row for
              // a run the runner already answered. Match both user columns —
              // user_id is TEXT and predates user_uuid, so a manually-logged
              // row can carry 'me' and no uuid and be invisible here.
              // The id spelling is still single and still a real gap; see the
              // exemption in lib/runs/_identity_lint.test.ts.
              `SELECT id FROM post_run_rpe
                WHERE (user_uuid = $1 OR user_id::text = $1::text) AND activity_id = $2
                LIMIT 1`,
              [userUuid, match.id],
            )).rows[0];
            if (!existing) {
              await pool.query(
                `INSERT INTO post_run_rpe (user_id, user_uuid, activity_id, rpe, notes, logged_at)
                 VALUES ($1::text, $1::uuid, $2, $3, 'auto-imported from strava', NOW())`,
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
        //
        // 2026-06-05 · backend audit P0-4 fix · the PK on runs is `id`
        // alone (Strava activity id). If user A already wrote that id
        // from any ingest path, user B's cron insert silently no-ops ·
        // findCanonicalRow upstream is user-scoped so the matcher said
        // "new for this user" and we ended up dropping the activity.
        // Pre-check the existing row's owner so cross-user collisions
        // surface as loud errors instead of silent drops.
        // Cite docs/2026-06-05-backend-audit.html § P0-4.
        const existingOwner = (await pool.query<{ u: string }>(
          `SELECT user_uuid::text AS u FROM runs WHERE id = $1::bigint`,
          [String(act.id)],
        ).catch(() => ({ rows: [] as Array<{ u: string }> }))).rows[0];
        if (existingOwner && existingOwner.u !== userUuid) {
          console.error(
            `[strava/pullSync] cross-user activity-id collision · ` +
            `activity=${act.id} owned_by=${existingOwner.u.slice(0,8)} ` +
            `attempting=${userUuid.slice(0,8)} · skipping insert to ` +
            `prevent overwriting another runner's row. This indicates ` +
            `Strava-id reuse (impossible in practice) or an admin ` +
            `restore from another runner's export. Investigate.`,
          );
          out.errors.push(`activity ${act.id}: cross-user id collision (owner=${existingOwner.u.slice(0,8)})`);
          continue;
        }
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
        // 2026-06-03 · post-write hook · calibration auto-complete on
        // bulk Strava sync. Cold-start runners connecting Strava with
        // a few runs already in it get calibrated immediately on the
        // first qualifying easy run in the imported set.
        void (await import('@/lib/runs/post-write-hooks'))
          .afterRunWrite({ userUuid, runId: String(act.id), source: 'strava' });
        if (shoeId != null) out.shoesAttributed++;
        if (typeof payload.perceived_exertion === 'number') {
          const rpe = Math.round(payload.perceived_exertion);
          if (rpe >= 1 && rpe <= 10) {
            const rpeRes = await pool.query(
              `INSERT INTO post_run_rpe (user_id, user_uuid, activity_id, rpe, notes, logged_at)
               VALUES ($1::text, $1::uuid, $2, $3, 'auto-imported from strava', NOW())
               ON CONFLICT DO NOTHING`,
              [userUuid, String(act.id), rpe],
            // 2026-08-24 · swallowed-failure sweep · `post_run_rpe.user_id` is
            // `text` and `.user_uuid` is `uuid`, so `VALUES ($1, $1, …)` asked
            // Postgres to deduce two types for one parameter: `inconsistent
            // types deduced for parameter $1`. Every RPE arriving with a Strava
            // import threw, `.catch` returned `rowCount: 0`, and `out.rpeWritten`
            // stayed at zero — a sync that reported writing no RPE because it
            // could not write any, in the same words it would use if there had
            // been none to write. Both sides are cast now.
            ).catch((e) => {
              logReadFailure('strava/pullSync · post_run_rpe insert', e);
              return { rowCount: 0 } as { rowCount: number | null };
            });
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
