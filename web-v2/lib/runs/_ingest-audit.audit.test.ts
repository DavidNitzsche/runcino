/**
 * READ-ONLY ingest/dedup audit — scratch diagnostic. Gated on DATABASE_URL_RO.
 */
import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';
import { clusterRuns, planMergeOps, isTrustworthy, type RunRow } from './identity';

import { readFileSync } from 'node:fs';
function roUrl(): string | undefined {
  if (process.env.DATABASE_URL_RO) return process.env.DATABASE_URL_RO;
  for (const f of ['.env.audit.local', '.env.local', 'web-v2/.env.audit.local', 'web-v2/.env.local']) {
    try {
      const m = /^DATABASE_URL_RO=(.+)$/m.exec(readFileSync(f, 'utf8'));
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    } catch { /* next */ }
  }
  return undefined;
}
const RO = roUrl();
const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const TZ = 'America/Los_Angeles';

const distMi = (r: RunRow) => Number(r.data?.distanceMi ?? 0);
const durSec = (r: RunRow) => Number(r.data?.durationSec ?? r.data?.movingTimeS ?? r.data?.elapsedTimeS ?? 0);
const dayOf = (r: RunRow) => String(r.data?.date ?? String(r.data?.startLocal ?? '').slice(0, 10));
const src = (r: RunRow) => String(r.data?.source ?? '(null)');
const mid = (r: RunRow) => (r.data?.mergedIntoId != null ? String(r.data.mergedIntoId) : null);

/* eslint-disable no-console */
describe.skipIf(!RO)('ingest audit', () => {
  const pool = new Pool({ connectionString: RO, ssl: { rejectUnauthorized: false }, max: 2 });
  let rows: RunRow[] = [];

  it('loads', async () => {
    const who = (await pool.query('SELECT current_user')).rows[0].current_user;
    expect(who).toBe('faff_readonly');
    rows = (await pool.query(
      `SELECT id::text AS id, user_uuid::text AS user_uuid, data
         FROM runs WHERE user_uuid = $1 ORDER BY id`, [DAVID])).rows;
    console.log(`\n[audit] ${rows.length} rows total`);
  });

  it('A · flags vs planMergeOps (per day, ALL rows)', () => {
    const byDay = new Map<string, RunRow[]>();
    for (const r of rows) { const d = dayOf(r); if (!d) continue; (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(r); }
    let pendingDays = 0;
    for (const [day, drows] of [...byDay].sort()) {
      const ops = planMergeOps(drows, TZ);
      if (ops.clears.length || ops.sets.length) {
        pendingDays++;
        console.log(`  [PENDING] ${day} rows=${drows.length} clusters=${ops.clusters} clears=${JSON.stringify(ops.clears)} sets=${JSON.stringify(ops.sets)}`);
        for (const r of drows) console.log(`      id=${r.id} src=${src(r)} ${distMi(r)}mi ${durSec(r)}s start=${r.data?.startLocal} tz=${r.data?.timezone ?? '-'} merged=${mid(r)} trust=${isTrustworthy(r)}`);
      }
    }
    console.log(`[audit] A · days whose flags disagree with planMergeOps: ${pendingDays}`);
  });

  it('B · unflagged multi-row clusters + multi-run days', () => {
    const live = rows.filter((r) => mid(r) == null);
    const byDay = new Map<string, RunRow[]>();
    for (const r of live) { const d = dayOf(r); if (!d) continue; (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(r); }
    let n = 0;
    for (const [day, drows] of [...byDay].sort()) {
      if (drows.length < 2) continue;
      const clusters = clusterRuns(drows, TZ);
      for (const c of clusters) if (c.length > 1) {
        n++;
        console.log(`  [UNFLAGGED-CLUSTER] ${day} ${c.map((r) => `${r.id}/${src(r)}/${distMi(r)}mi`).join('  ')}`);
      }
      if (clusters.length === drows.length) {
        console.log(`  [MULTI-RUN-DAY] ${day} ${drows.map((r) => `${r.id}/${src(r)}/${distMi(r)}mi/${r.data?.startLocal}/${durSec(r)}s`).join('  ')}`);
      }
    }
    console.log(`[audit] B · unflagged >1-row clusters: ${n}`);
  });

  it('C · cross-day near-misses (same run, different date string)', () => {
    const live = rows.filter((r) => mid(r) == null).sort((a, b) => dayOf(a).localeCompare(dayOf(b)));
    let n = 0;
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i], b = live[j];
        const da = dayOf(a), db = dayOf(b);
        if (da === db) continue;
        const gap = Math.abs(Date.parse(da + 'T00:00Z') - Date.parse(db + 'T00:00Z')) / 86400000;
        if (gap > 1.5) continue;
        if (Math.abs(durSec(a) - durSec(b)) <= 180 && Math.abs(distMi(a) - distMi(b)) <= 0.15 && distMi(a) > 0) {
          n++;
          console.log(`  [CROSS-DAY] ${a.id}/${src(a)}/${da}/${a.data?.startLocal}/${distMi(a)}mi/${durSec(a)}s  <->  ${b.id}/${src(b)}/${db}/${b.data?.startLocal}/${distMi(b)}mi/${durSec(b)}s`);
        }
      }
    }
    console.log(`[audit] C · cross-day near-miss pairs: ${n}`);
  });

  it('C2 · SAME-DAY live rows that look like the same run but are in different clusters', () => {
    const live = rows.filter((r) => mid(r) == null);
    const byDay = new Map<string, RunRow[]>();
    for (const r of live) { const d = dayOf(r); if (!d) continue; (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(r); }
    let n = 0; let phantomMi = 0;
    for (const [day, drows] of [...byDay].sort()) {
      if (drows.length < 2) continue;
      for (let i = 0; i < drows.length; i++) for (let j = i + 1; j < drows.length; j++) {
        const a = drows[i], b = drows[j];
        if (durSec(a) <= 0 || durSec(b) <= 0) continue;
        const sameDur = Math.abs(durSec(a) - durSec(b)) <= 5;
        const sameDist = Math.abs(distMi(a) - distMi(b)) <= 0.05 && distMi(a) > 0.3;
        if (!sameDur || !sameDist) continue;
        // are they in the same cluster already?
        const clustered = clusterRuns(drows, TZ).some((c) => c.includes(a) && c.includes(b));
        if (clustered) continue;
        n++; phantomMi += Math.min(distMi(a), distMi(b));
        console.log(`  [MISSED-DUP] ${day} ${a.id}/${src(a)}/${distMi(a)}mi/${durSec(a)}s/${a.data?.startLocal}  <->  ${b.id}/${src(b)}/${distMi(b)}mi/${durSec(b)}s/${b.data?.startLocal}`);
      }
    }
    console.log(`[audit] C2 · missed same-day dups: ${n} · phantom miles: ${phantomMi.toFixed(2)}`);
  });

  it('D · canonical rows whose provenance stamps a LOWER-tier source', async () => {
    const r = await pool.query(
      `SELECT id::text, data->>'source' src, provenance, data->>'distanceMi' d
         FROM runs WHERE user_uuid=$1 AND provenance <> '{}'::jsonb AND NOT (data ? 'mergedIntoId')
         ORDER BY data->>'date'`, [DAVID]);
    const TIER: Record<string, number> = { watch: 5, phone: 5, manual: 4, apple_watch: 3, apple_health: 2, strava: 1, strava_webhook: 1 };
    let n = 0;
    for (const row of r.rows) {
      const own = TIER[row.src] ?? 0;
      const bad = Object.entries((row.provenance ?? {}) as Record<string, string>)
        .filter(([, s]) => (TIER[s] ?? 0) < own);
      if (bad.length) { n++; console.log(`  [PROV-DOWNGRADE] id=${row.id} own=${row.src}(t${own}) ${bad.map(([k, s]) => `${k}<-${s}`).join(' ')}`); }
    }
    console.log(`[audit] D · canonicals with a lower-tier provenance stamp: ${n}/${r.rows.length}`);
  });

  it('E · latent inflation · miles a re-merge pass would ADD to a settled day', () => {
    const byDay = new Map<string, RunRow[]>();
    for (const r of rows) { const d = dayOf(r); if (!d) continue; (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(r); }
    let totalDelta = 0;
    for (const [day, drows] of [...byDay].sort()) {
      const ops = planMergeOps(drows, TZ);
      if (!ops.clears.length && !ops.sets.length) continue;
      const liveNow = drows.filter((r) => mid(r) == null);
      const nowMi = liveNow.reduce((s, r) => s + distMi(r), 0);
      const clears = new Set(ops.clears);
      const sets = new Set(ops.sets.map((s) => s.id));
      const liveAfter = drows.filter((r) => (clears.has(r.id)) || (mid(r) == null && !sets.has(r.id)));
      const afterMi = liveAfter.reduce((s, r) => s + distMi(r), 0);
      const delta = Math.round((afterMi - nowMi) * 100) / 100;
      totalDelta += delta;
      console.log(`  [LATENT] ${day} now=${nowMi.toFixed(2)}mi after-remerge=${afterMi.toFixed(2)}mi delta=${delta > 0 ? '+' : ''}${delta}`);
    }
    console.log(`[audit] E · total latent inflation across settled days: ${totalDelta.toFixed(2)} mi`);
  });

  it('F · every other account · missed same-day dups', async () => {
    const users = (await pool.query<{ id: string; email: string }>(
      `SELECT id::text, email FROM users ORDER BY created_at`)).rows;
    for (const u of users) {
      if (u.id === DAVID) continue;
      const rs = (await pool.query(
        `SELECT id::text AS id, user_uuid::text AS user_uuid, data FROM runs WHERE user_uuid = $1`, [u.id])).rows as RunRow[];
      const live = rs.filter((r) => mid(r) == null);
      const byDay = new Map<string, RunRow[]>();
      for (const r of live) { const d = dayOf(r); if (!d) continue; (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(r); }
      let dups = 0;
      for (const [, drows] of byDay) {
        if (drows.length < 2) continue;
        for (let i = 0; i < drows.length; i++) for (let j = i + 1; j < drows.length; j++) {
          const a = drows[i], b = drows[j];
          if (durSec(a) <= 0 || durSec(b) <= 0) continue;
          if (Math.abs(durSec(a) - durSec(b)) > 5 || Math.abs(distMi(a) - distMi(b)) > 0.05 || distMi(a) <= 0.3) continue;
          if (clusterRuns(drows, TZ).some((c) => c.includes(a) && c.includes(b))) continue;
          dups++;
        }
      }
      console.log(`  [OTHER] ${u.email} rows=${rs.length} live=${live.length} missed-dups=${dups}`);
    }
  });

  it('Z · closes', async () => { await pool.end(); });
});
