// STATE AUDIT · Part 1.1: canonical volume 30/60/90d — exact port of lib/runs/identity.ts
// clustering + lib/runs/volume.ts mileageByDay, vs naive sums. RO.
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL_RO, ssl: { rejectUnauthorized: false } });
const UID = '0645f40c-951d-4ccc-b86e-9979cd26c795';

// ── identity.ts port (1:1) ──
const SOURCE_TIER = { watch: 5, manual: 4, apple_watch: 3, apple_health: 2, strava: 1, strava_webhook: 1 };
const PROVIDER_LOCAL = new Set(['apple_watch', 'strava_webhook']);
const hasOffset = (s) => /(?:Z|[+-]\d{2}:?\d{2})$/.test(s || '');
const isIana = (tz) => typeof tz === 'string' && /^[A-Za-z]+\/[A-Za-z0-9_+\-]+$/.test(tz);
const isTrustworthy = (row) => {
  const d = row.data ?? {};
  if (hasOffset(String(d.startLocal ?? ''))) return true;
  if (isIana(d.timezone)) return true;
  if (PROVIDER_LOCAL.has(String(d.source ?? ''))) return true;
  return false;
};
const localDay = (r) => String(r.data?.date ?? String(r.data?.startLocal ?? '').slice(0, 10));
const durSec = (r) => Number(r.data?.durationSec ?? r.data?.movingTimeS ?? r.data?.elapsedTimeS ?? 0);
const distMi = (r) => Number(r.data?.distanceMi ?? 0);
const DEFAULT_TZ = 'America/Los_Angeles';
function tzOffsetMs(utcMs, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = {};
  for (const part of dtf.formatToParts(new Date(utcMs))) p[part.type] = part.value;
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - utcMs;
}
function startUtcMs(r) {
  let s = String(r.data?.startLocal ?? '');
  if (!s) return NaN;
  if (String(r.data?.source ?? '') === 'strava' && s.endsWith('Z')) s = s.slice(0, -1);
  if (hasOffset(s)) return Date.parse(s);
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (!m) return Date.parse(s);
  const tz = isIana(r.data?.timezone) ? r.data.timezone : DEFAULT_TZ;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  return guess - tzOffsetMs(guess, tz);
}
const endUtcMs = (r) => startUtcMs(r) + durSec(r) * 1000;
function spansOverlap(a, b) {
  const sa = startUtcMs(a), sb = startUtcMs(b), ea = endUtcMs(a), eb = endUtcMs(b);
  if (![sa, sb, ea, eb].every(Number.isFinite)) return false;
  return Math.max(sa, sb) < Math.min(ea, eb);
}
function isSameRun(a, b) {
  if (String(a.user_uuid) !== String(b.user_uuid)) return false;
  if (localDay(a) !== localDay(b)) return false;
  if (isTrustworthy(a) && isTrustworthy(b)) return spansOverlap(a, b);
  return Math.abs(durSec(a) - durSec(b)) <= 120 && Math.abs(distMi(a) - distMi(b)) <= 0.05;
}
function clusterRuns(rows) {
  const clusters = [];
  for (const row of rows) {
    let placed = false;
    for (const cluster of clusters) {
      if (cluster.some((m) => isSameRun(m, row))) { cluster.push(row); placed = true; break; }
    }
    if (!placed) clusters.push([row]);
  }
  return clusters;
}
const tierOf = (r) => SOURCE_TIER[String(r.data?.source ?? '')] ?? 0;
const richness = (r) => {
  const d = r.data ?? {}; let n = 0;
  for (const k of ['avgHr', 'maxHr', 'avgCadence', 'elevGainFt', 'tempF', 'routePolyline']) if (d[k] != null) n++;
  if (Array.isArray(d.splits) && d.splits.length) n++;
  return n;
};
const realSplits = (r) => (Array.isArray(r.data?.splits) ? r.data.splits : []).filter((s) => (s?.hr ?? s?.avgHr ?? s?.hrAvgBpm) != null && (s?.pace ?? s?.paceSPerMi ?? s?.paceSecPerMi) != null).length;
function pickCanonical(cluster) {
  const ranked = [...cluster].sort((a, b) => (tierOf(b) - tierOf(a)) || (richness(b) - richness(a)));
  let canonical = ranked[0];
  if (!isTrustworthy(canonical)) {
    for (const alt of ranked.slice(1)) {
      if (isTrustworthy(alt) && Math.abs(distMi(alt) - distMi(canonical)) <= 0.05 && Math.abs(durSec(alt) - durSec(canonical)) <= 120 && realSplits(alt) >= realSplits(canonical)) { canonical = alt; break; }
    }
  }
  const canonDist = distMi(canonical);
  for (const alt of ranked.slice(1)) {
    const altDist = distMi(alt);
    if (String(alt.data?.source ?? '') === 'strava' && /Z$/.test(String(alt.data?.startLocal ?? '')) && !isIana(alt.data?.timezone) && altDist > 0 && canonDist > altDist * 1.10) { canonical = alt; break; }
  }
  return { canonical, losers: cluster.filter((r) => r.id !== canonical.id) };
}

// ── mileageByDay port ──
async function mileageByDay(fromISO, toISO) {
  const rows = (await pool.query(
    `SELECT id::text AS id, user_uuid::text AS user_uuid, data FROM runs
      WHERE user_uuid = $1 AND NOT (data ? 'mergedIntoId')
        AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) BETWEEN $2 AND $3`,
    [UID, fromISO, toISO])).rows;
  const byDay = new Map();
  for (const r of rows) {
    const day = localDay(r);
    if (!day) continue;
    (byDay.get(day) ?? byDay.set(day, []).get(day)).push(r);
  }
  const out = new Map();
  for (const [day, dayRows] of byDay) {
    let total = 0; const ids = []; let nClusters = 0; let nRows = dayRows.length;
    for (const cluster of clusterRuns(dayRows)) {
      const { canonical } = pickCanonical(cluster);
      total += distMi(canonical); ids.push(canonical.id); nClusters++;
    }
    out.set(day, { mi: Math.round(total * 10) / 10, ids, nClusters, nRows });
  }
  return out;
}

const TODAY = '2026-06-09';
const daysBefore = (iso, d) => new Date(Date.parse(iso + 'T12:00:00Z') - d * 86400000).toISOString().slice(0, 10);

for (const win of [30, 60, 90]) {
  const from = daysBefore(TODAY, win);
  const byDay = await mileageByDay(from, TODAY);
  let mi = 0, runs = 0, multiRowDays = 0;
  for (const v of byDay.values()) { mi += v.mi; runs += v.nClusters; if (v.nRows > v.nClusters) multiRowDays++; }
  // naive comparisons
  const naive = (await pool.query(
    `SELECT ROUND(SUM((data->>'distanceMi')::numeric),1) AS all_rows_mi, COUNT(*) AS all_rows,
            ROUND(SUM((data->>'distanceMi')::numeric) FILTER (WHERE NOT (data ? 'mergedIntoId')),1) AS nonmerged_mi,
            COUNT(*) FILTER (WHERE NOT (data ? 'mergedIntoId')) AS nonmerged_rows
       FROM runs WHERE user_uuid=$1 AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) BETWEEN $2 AND $3`,
    [UID, from, TODAY])).rows[0];
  console.log(`\n=== ${win}d window (${from} → ${TODAY}) ===`);
  console.log(`CANONICAL (identity-clustered):  ${Math.round(mi*100)/100} mi · ${runs} runs · days-with-extra-rows-collapsed: ${multiRowDays}`);
  console.log(`naive ALL rows:                  ${naive.all_rows_mi} mi · ${naive.all_rows} rows`);
  console.log(`naive non-merged rows:           ${naive.nonmerged_mi} mi · ${naive.nonmerged_rows} rows`);
  const inflation = naive.nonmerged_mi - mi;
  console.log(`>>> non-merged minus canonical = ${Math.round(inflation*100)/100} mi ${Math.abs(inflation) < 0.05 ? '(CLEAN — flags + clustering agree)' : '(CLUSTERING IS DOING WORK — unflagged dupes exist)'}`);
}

// Per-day detail last 30d where clustering collapsed anything (unflagged dupes)
console.log('\n=== last-30d days where identity-clustering collapsed unflagged rows ===');
const byDay30 = await mileageByDay(daysBefore(TODAY, 30), TODAY);
for (const [day, v] of [...byDay30.entries()].sort()) {
  if (v.nRows > v.nClusters) console.log(`${day}: ${v.nRows} non-merged rows → ${v.nClusters} canonical · ${v.mi} mi`);
}

// merged-flag state across all rows
const flags = (await pool.query(
  `SELECT COUNT(*) FILTER (WHERE data ? 'mergedIntoId') AS flagged,
          COUNT(*) FILTER (WHERE absorbed_into_canonical_at IS NOT NULL) AS absorbed,
          COUNT(*) AS total FROM runs WHERE user_uuid=$1`, [UID])).rows[0];
console.log(`\nALL-TIME rows: ${flags.total} · mergedIntoId-flagged: ${flags.flagged} · absorbed_into_canonical_at: ${flags.absorbed}`);
await pool.end();
