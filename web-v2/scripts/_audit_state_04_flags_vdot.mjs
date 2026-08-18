// STATE AUDIT · Part 1.2: flag-protection simulation + VDOT source + race meta + plan. RO.
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL_RO, ssl: { rejectUnauthorized: false } });
const UID = '0645f40c-951d-4ccc-b86e-9979cd26c795';

// identity port (same as _audit_state_03)
const SOURCE_TIER = { watch: 5, manual: 4, apple_watch: 3, apple_health: 2, strava: 1, strava_webhook: 1 };
const PROVIDER_LOCAL = new Set(['apple_watch', 'strava_webhook']);
const hasOffset = (s) => /(?:Z|[+-]\d{2}:?\d{2})$/.test(s || '');
const isIana = (tz) => typeof tz === 'string' && /^[A-Za-z]+\/[A-Za-z0-9_+\-]+$/.test(tz);
const isTrustworthy = (row) => {
  const d = row.data ?? {};
  return hasOffset(String(d.startLocal ?? '')) || isIana(d.timezone) || PROVIDER_LOCAL.has(String(d.source ?? ''));
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

// ── A) flag-wipe simulation: for each flagged row, would clustering re-merge it with its canonical? ──
const all = (await pool.query(`SELECT id::text AS id, user_uuid::text AS user_uuid, data FROM runs WHERE user_uuid=$1`, [UID])).rows;
const flagged = all.filter(r => r.data?.mergedIntoId != null);
let protectedRows = [];
for (const f of flagged) {
  const canonical = all.find(r => String(r.id) === String(f.data.mergedIntoId));
  if (!canonical) { protectedRows.push({ id: f.id, day: localDay(f), why: 'canonical row MISSING', src: f.data?.source ?? 'null', mi: distMi(f) }); continue; }
  if (!isSameRun(f, canonical)) {
    protectedRows.push({
      id: f.id, day: localDay(f), src: f.data?.source ?? 'null', mi: distMi(f), dur: durSec(f),
      canonicalId: canonical.id, canonSrc: canonical.data?.source ?? 'null', canonMi: distMi(canonical), canonDur: durSec(canonical),
      fTrust: isTrustworthy(f), cTrust: isTrustworthy(canonical),
      fStart: String(f.data?.startLocal ?? ''), cStart: String(canonical.data?.startLocal ?? ''),
      why: 'isSameRun=false (flag is load-bearing)',
    });
  }
}
console.log(`=== FLAG-WIPE SIMULATION: flagged rows that would NOT re-cluster (flag is the only protection) ===`);
console.log(`flagged total: ${flagged.length} · load-bearing flags: ${protectedRows.length}`);
console.table(protectedRows.map(p => ({ day: p.day, id: p.id, src: p.src, mi: p.mi, canonSrc: p.canonSrc, canonMi: p.canonMi, fStart: (p.fStart||'').slice(0,19), cStart: (p.cStart||'').slice(0,19), why: p.why })));
const wipedMi = protectedRows.reduce((s, p) => s + (p.mi || 0), 0);
console.log(`miles that would DOUBLE-COUNT if flags wiped and clustering can't re-merge: ${Math.round(wipedMi * 10) / 10} mi`);

// ── B) VDOT source: projection_snapshots ──
console.log('\n=== projection_snapshots (last 12) ===');
const snaps = (await pool.query(
  `SELECT snapshot_date, distance_mi, vdot, projection_sec, race_slug, source, vdot_anchor_date, vdot_anchor_distance_mi
     FROM projection_snapshots WHERE user_uuid=$1 ORDER BY snapshot_date DESC LIMIT 12`, [UID])).rows;
console.table(snaps);

// ── C) races: meta + actual_result ──
console.log('\n=== races (all) ===');
const races = (await pool.query(
  `SELECT slug, meta->>'name' AS name, meta->>'date' AS date, meta->>'priority' AS pri,
          meta->>'distanceMi' AS dist_mi, meta->>'goalDisplay' AS goal_display, meta->>'goalSec' AS goal_sec,
          meta->>'bGoalDisplay' AS b_goal, meta->>'waveTime' AS wave, meta->>'gunTimeIso' AS gun_iso,
          meta->>'startTimeLocal' AS start_local, actual_result, promoted_to_library_iso IS NOT NULL AS in_library
     FROM races WHERE user_uuid=$1 ORDER BY meta->>'date'`, [UID])).rows;
console.table(races.map(r => ({ ...r, actual_result: r.actual_result ? JSON.stringify(r.actual_result).slice(0, 80) : null })));

// race meta full dump for the A race (next upcoming)
console.log('\n=== A-race full meta ===');
const aRace = (await pool.query(
  `SELECT slug, meta, course_geometry IS NOT NULL AS has_course_geom, course_source FROM races
    WHERE user_uuid=$1 AND meta->>'priority'='A' AND meta->>'date' >= '2026-06-09' ORDER BY meta->>'date' LIMIT 1`, [UID])).rows[0];
console.log(JSON.stringify(aRace, null, 2).slice(0, 3000));

// ── D) active plan ──
console.log('\n=== training_plans ===');
const plans = (await pool.query(
  `SELECT id, mode, race_id, goal_iso, authored_iso::date AS authored, archived_iso::date AS archived, archive_reason,
          last_adapted_at::date AS last_adapted
     FROM training_plans WHERE user_uuid=$1 ORDER BY authored_iso DESC LIMIT 6`, [UID])).rows;
console.table(plans);

await pool.end();
