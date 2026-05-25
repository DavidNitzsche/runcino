#!/usr/bin/env node
/**
 * One-shot run-log dedupe backfill.
 *
 * Scans strava_activities for the single user (id `0645f40c-...`) and:
 *
 *   1. Removes the 5 zombie rows that are tombstoned in deleted_activity_ids
 *      but were resurrected by AH/watch ingest before Fix 2 landed.
 *
 *   2. Folds duplicate-session pairs (same calendar date, distance ratio
 *      >= 0.85, lesser-source row not already merged) into the higher-rank
 *      canonical via data.mergedIntoId. Covers BOTH:
 *        (a) absolute-time gap <= 15 min — same minute, different source
 *        (b) the TZ-offset-shift case from Fix 1 — AH wrote startISO in
 *            true UTC while Strava wrote wall-clock + Z. They appear 7h
 *            apart in raw startLocal but represent the same session.
 *
 * Defaults to DRY RUN. Pass --apply to actually mutate.
 *
 * Usage:
 *   node scripts/runlog-backfill-dedupe.mjs              # dry-run summary
 *   node scripts/runlog-backfill-dedupe.mjs --apply      # mutate
 *
 * Hard-scoped to user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'
 * (the single real user). Multi-tenant variant would loop users; we don't
 * need that today.
 *
 * Safe to re-run: idempotent. A row already pointing the right way is
 * left alone. A zombie already gone is a no-op.
 */

import pg from '../web/node_modules/pg/lib/index.js';
const { Client } = pg;

const APPLY = process.argv.includes('--apply');
const USER_ID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const TZ = 'America/Los_Angeles';

// Same conversion as Fix 1 — used to detect the TZ-shift dup case where
// AH wrote true-UTC startISO and Strava wrote wall-clock-LA + Z.
function utcToWallClockZ(utcISO, tz) {
  const ms = Date.parse(utcISO);
  if (!Number.isFinite(ms)) return utcISO;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date(ms));
  const get = (t) => parts.find((p) => p.type === t)?.value ?? '00';
  let hh = get('hour'); if (hh === '24') hh = '00';
  return `${get('year')}-${get('month')}-${get('day')}T${hh}:${get('minute')}:${get('second')}Z`;
}

// Same rank as the runtime helper in web/lib/run-dedupe-write.ts
function rank(row) {
  if (row.id > 0) return 3;
  const n = (row.name || '').toLowerCase();
  const s = (row.source || '').toLowerCase();
  if (s.includes('watch') || n.includes('watch')) return 2;
  return 1;
}

function pickCanonical(a, b) {
  const ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra > rb ? { canonical: a, lesser: b } : { canonical: b, lesser: a };
  if (a.distanceMi !== b.distanceMi)
    return a.distanceMi > b.distanceMi ? { canonical: a, lesser: b } : { canonical: b, lesser: a };
  if (a.movingTimeS !== b.movingTimeS)
    return a.movingTimeS > b.movingTimeS ? { canonical: a, lesser: b } : { canonical: b, lesser: a };
  if (a.id > 0 && b.id < 0) return { canonical: a, lesser: b };
  if (b.id > 0 && a.id < 0) return { canonical: b, lesser: a };
  return Math.abs(a.id) <= Math.abs(b.id) ? { canonical: a, lesser: b } : { canonical: b, lesser: a };
}

const client = new Client({
  connectionString: process.env.DATABASE_URL
    || 'postgresql://postgres:gMqZjWTFIvUzuoFnYIVJbgtijtChNvUL@crossover.proxy.rlwy.net:20769/railway',
  ssl: { rejectUnauthorized: false },
});

await client.connect();

console.log(`MODE: ${APPLY ? 'APPLY (will mutate)' : 'DRY RUN (read-only)'}`);
console.log(`USER: ${USER_ID}`);
console.log('');

// ============================================================
// 1. Zombie cleanup
// ============================================================
console.log('=== STEP 1: Zombie rows (tombstoned but still present) ===');
const zombies = await client.query(
  `SELECT s.id::text AS id, s.data->>'date' AS date, s.data->>'name' AS name,
          s.data->>'source' AS source, (s.data->>'distanceMi')::TEXT AS distance_mi
     FROM strava_activities s
     JOIN deleted_activity_ids d ON d.id = s.id
    WHERE s.user_uuid = $1`,
  [USER_ID],
);
console.log(`Found ${zombies.rows.length} zombie row(s):`);
for (const z of zombies.rows) {
  console.log(`  ${z.id} | ${z.date} | ${z.distance_mi}mi | ${z.source || 'null'} | ${z.name}`);
}
if (APPLY && zombies.rows.length > 0) {
  const ids = zombies.rows.map((z) => z.id);
  const del = await client.query(
    `DELETE FROM strava_activities
      WHERE id = ANY($1::BIGINT[])
        AND user_uuid = $2`,
    [ids, USER_ID],
  );
  console.log(`  DELETED ${del.rowCount} zombie row(s)`);
} else if (zombies.rows.length > 0) {
  console.log(`  (dry-run: would DELETE ${zombies.rows.length} row(s))`);
}
console.log('');

// ============================================================
// 2. Duplicate-session pairs
// ============================================================
console.log('=== STEP 2: Duplicate-session pair scan ===');
// Load all rows for the user, NOT already merged. Compute an "effective ms"
// for the TZ-shift case: if a row's source is apple_health and its raw
// startLocal parses to a UTC instant that's exactly the wall-clock-LA of
// another row's raw startLocal, they're the same session.
// IMPORTANT: match the runtime read predicate `(user_uuid = $1 OR
// user_uuid IS NULL)`. Legacy demo rows landed with user_uuid=NULL and
// the user's real rows landed with the assigned UUID; both are visible
// to /overview, so both must be considered when scanning for dup pairs
// (otherwise a NULL Strava row stays adjacent to an AH-owned dup and
// the page double-counts).
const rowsRes = await client.query(
  `SELECT id::text AS id,
          user_uuid::text AS user_uuid,
          data->>'date' AS date,
          data->>'startLocal' AS start_local,
          (data->>'distanceMi')::NUMERIC AS distance_mi,
          (data->>'movingTimeS')::NUMERIC AS moving_s,
          data->>'name' AS name,
          data->>'source' AS source
     FROM strava_activities
    WHERE (user_uuid = $1 OR user_uuid IS NULL)
      AND data->>'startLocal' IS NOT NULL
      AND NOT (data ? 'mergedIntoId')
    ORDER BY data->>'startLocal'`,
  [USER_ID],
);

const rows = rowsRes.rows.map((r) => {
  const id = Number(r.id);
  const rawStartMs = Date.parse(r.start_local);
  // For AH rows, also compute the wall-clock-LA equivalent — that's what
  // matches Strava's frame. For non-AH rows, the raw startLocal IS the
  // wall-clock-LA frame (Strava's quirky behaviour).
  const source = (r.source || '').toLowerCase();
  const normalizedStart = source === 'apple_health'
    ? utcToWallClockZ(r.start_local, TZ)
    : r.start_local;
  return {
    id,
    date: r.date,
    startLocal: r.start_local,
    normalizedStart,
    normalizedMs: Date.parse(normalizedStart),
    rawStartMs,
    distanceMi: Number(r.distance_mi) || 0,
    movingTimeS: Number(r.moving_s) || 0,
    name: r.name,
    source: r.source,
  };
});

// Build a set of zombie ids that are about to be deleted in step 1 —
// we must not fold any non-zombie lesser INTO a zombie canonical,
// because that would leave the lesser pointing to a deleted row
// (invisible AND orphaned, the session disappears from /log).
const zombieIds = new Set(zombies.rows.map((z) => Number(z.id)));

// Find pairs: same date OR same date ±1 (TZ boundary), distance ratio
// >= 0.85, normalized-start gap <= 15 min.
const pairs = [];
const sorted = [...rows].sort((a, b) => a.normalizedMs - b.normalizedMs);
for (let i = 0; i < sorted.length; i++) {
  for (let j = i + 1; j < sorted.length; j++) {
    const gap = Math.abs(sorted[i].normalizedMs - sorted[j].normalizedMs);
    if (gap > 15 * 60_000) break;
    const distMin = Math.min(sorted[i].distanceMi, sorted[j].distanceMi);
    const distMax = Math.max(sorted[i].distanceMi, sorted[j].distanceMi);
    if (distMax === 0) continue;
    const ratio = distMin / distMax;
    if (ratio < 0.85) continue;
    const { canonical, lesser } = pickCanonical(sorted[i], sorted[j]);
    // Zombie interlock: if the picked canonical is being deleted, and
    // the lesser is not, leave the lesser ALONE — it stays as the
    // visible row for the session.
    if (zombieIds.has(canonical.id) && !zombieIds.has(lesser.id)) continue;
    pairs.push({ canonical, lesser, gap, ratio });
  }
}

// Multi-row clusters: if a row appears as both canonical (in one pair)
// and lesser (in another), prefer the higher-rank canonical chain. Build
// a transitive merge map.
const targetFor = new Map(); // lesserId -> ultimate canonicalId
for (const p of pairs) {
  targetFor.set(p.lesser.id, p.canonical.id);
}
// Chase chains: if A -> B and B -> C, rewrite A -> C.
for (const lesserId of Array.from(targetFor.keys())) {
  let target = targetFor.get(lesserId);
  let depth = 0;
  while (targetFor.has(target) && depth < 5) {
    target = targetFor.get(target);
    depth++;
  }
  targetFor.set(lesserId, target);
}

console.log(`Found ${pairs.length} dup pair(s) -> ${targetFor.size} unique lesser row(s) to fold:`);
const pairsByLesser = new Map();
for (const p of pairs) {
  if (!pairsByLesser.has(p.lesser.id)) pairsByLesser.set(p.lesser.id, p);
}
for (const [lesserId, target] of targetFor) {
  const p = pairsByLesser.get(lesserId);
  const lesser = p?.lesser;
  const canonical = rows.find((r) => r.id === target);
  if (!lesser || !canonical) continue;
  console.log(`  ${lesser.id} (${lesser.distanceMi}mi ${lesser.source}) -> ${canonical.id} (${canonical.distanceMi}mi ${canonical.source}) | gap ${Math.round(p.gap/1000)}s ratio ${Math.round(p.ratio*100)}%`);
}

if (APPLY && targetFor.size > 0) {
  let folded = 0;
  for (const [lesserId, target] of targetFor) {
    // Mirror the read predicate: the lesser may be a legacy NULL-uuid
    // row OR belong to this user. Don't constrain by user_uuid alone.
    const r = await client.query(
      `UPDATE strava_activities
          SET data = jsonb_set(data, '{mergedIntoId}', to_jsonb($1::BIGINT))
        WHERE id = $2::BIGINT
          AND (user_uuid = $3 OR user_uuid IS NULL)
          AND NOT (data ? 'mergedIntoId')`,
      [target, lesserId, USER_ID],
    );
    folded += r.rowCount;
  }
  console.log(`  FOLDED ${folded} row(s)`);
} else if (targetFor.size > 0) {
  console.log(`  (dry-run: would FOLD ${targetFor.size} row(s))`);
}
console.log('');

console.log(APPLY ? 'DONE (mutations applied).' : 'DONE (dry-run only; pass --apply to mutate).');
await client.end();
