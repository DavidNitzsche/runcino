/**
 * /api/strava/bests — aggregate Strava's best_efforts across every
 * cached activity detail in the database. Returns the fastest YTD time
 * per canonical distance (1 mi / 5K / 10K / Half / Marathon) plus the
 * activity that set it.
 *
 * Why best_efforts: Strava computes per-distance bests *inside* every
 * run. So a 5:27 mile PR set during a half-marathon race shows up as
 * a `best_efforts` entry on that activity, with `pr_rank: 1`. The
 * naïve "fastest whole run near this distance" approach in
 * lib/strava-stats.ts can't see that.
 *
 * Lazy detail fetching: detail (with best_efforts) only lands in
 * `strava_activities.detail` after /api/strava/activity/[id] or the
 * sync route hits Strava. To populate fast, this endpoint will fetch
 * detail on demand for any race-like activity (workout_type=1 OR
 * matching the race-name regex) that doesn't have it yet, capped at
 * 8 fetches per request to stay well under the 100 req / 15 min
 * budget. After a few page loads, every race is cached.
 */

import { fetchActivityDetail, type StravaActivity } from '../../../../lib/strava';
import { setCachedDetail } from '../../../../lib/strava-cache';
import { isProbablyRace } from '../../../../lib/strava-stats';
import { type NormalizedActivity } from '../activities/route-shared';
import { query } from '../../../../lib/db';

const FETCH_BUDGET = 8;

/** Map Strava's best_effort.name to our display labels. Strava uses
 *  inconsistent casing — "1 mile", "5k", "10k", "Half-Marathon",
 *  "Marathon" — so normalize. Also drops shorter efforts (400m, 1/2
 *  mile, 1k, 2 mile) that the dashboard doesn't surface. */
const NAME_MAP: Array<{ match: RegExp; label: string; distMi: number }> = [
  { match: /^1\s*mile$/i,         label: '1 mi',     distMi: 1.00 },
  { match: /^5\s*k$/i,            label: '5K',       distMi: 3.10 },
  { match: /^10\s*k$/i,           label: '10K',      distMi: 6.21 },
  { match: /^half[-\s]?marathon$/i, label: 'Half',  distMi: 13.10 },
  { match: /^marathon$/i,         label: 'Marathon', distMi: 26.22 },
];

interface AggregatedBest {
  label: string;
  distMi: number;
  bestS: number | null;
  elapsedDisplay: string;
  activityId: number | null;
  activityName: string | null;
  date: string | null;
  isPR: boolean;       // pr_rank === 1 on the source activity
}

interface DBRow {
  id: number;
  data: NormalizedActivity;
  detail: StravaActivity | null;
}

function fmtT(s: number): string {
  s = Math.round(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export async function GET() {
  if (!process.env.STRAVA_REFRESH_TOKEN) {
    return Response.json({ bests: [], error: 'STRAVA_REFRESH_TOKEN not set.' }, { status: 200 });
  }

  // Pull all activity rows from Postgres — already normalized + maybe
  // detail-cached.
  const rows = await query<DBRow>(`SELECT id, data, detail FROM strava_activities`);

  // Identify race-like activities that don't yet have detail. These are
  // the highest-value candidates for lazy fetching since PRs almost
  // always live in races.
  const needsDetail = rows
    .filter(r => r.detail == null && isProbablyRace(r.data))
    .slice(0, FETCH_BUDGET);

  let fetched = 0;
  for (const r of needsDetail) {
    try {
      const detail = await fetchActivityDetail(r.id);
      await setCachedDetail(r.id, detail);
      // Update the in-memory row so the aggregation below uses the
      // freshly-fetched detail without a second DB read.
      r.detail = detail;
      fetched++;
    } catch (e) {
      console.warn(`[bests] detail fetch failed for ${r.id}:`, e);
    }
  }

  // Aggregate: walk every cached detail, scan its best_efforts array,
  // pick the fastest time per canonical distance bucket.
  const bestByLabel = new Map<string, { row: DBRow; elapsedS: number; isPR: boolean }>();

  for (const r of rows) {
    const efforts = r.detail?.best_efforts;
    if (!efforts) continue;
    for (const e of efforts) {
      const map = NAME_MAP.find(m => m.match.test(e.name));
      if (!map) continue;
      const cur = bestByLabel.get(map.label);
      if (!cur || e.elapsed_time < cur.elapsedS) {
        bestByLabel.set(map.label, {
          row: r,
          elapsedS: e.elapsed_time,
          isPR: e.pr_rank === 1,
        });
      }
    }
  }

  const bests: AggregatedBest[] = NAME_MAP.map(({ label, distMi }) => {
    const hit = bestByLabel.get(label);
    if (!hit) return { label, distMi, bestS: null, elapsedDisplay: '—', activityId: null, activityName: null, date: null, isPR: false };
    return {
      label,
      distMi,
      bestS: hit.elapsedS,
      elapsedDisplay: fmtT(hit.elapsedS),
      activityId: hit.row.id,
      activityName: hit.row.data.name,
      date: hit.row.data.date,
      isPR: hit.isPR,
    };
  });

  return Response.json({
    bests,
    detailsCached: rows.filter(r => r.detail != null).length,
    detailsTotal: rows.length,
    detailsRefreshed: fetched,
  });
}
