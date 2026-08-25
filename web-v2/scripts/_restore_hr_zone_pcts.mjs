/**
 * _restore_hr_zone_pcts.mjs · the exact inverse of `recompute-hr-zones.ts`.
 *
 * Reads `docs/hr-zone-pcts-snapshot-2026-08-24.json` and puts every
 * `runs.data.hrZonePcts` back exactly as it was before ZONE-BANDS-1 ran —
 * including the five rows that held `{0,0,0,0,0}` and the rows that held
 * `null`. It touches nothing else in `data`: a single `jsonb_set` per row,
 * per Rule 6, so a concurrent writer's fields survive.
 *
 *   node scripts/_bundle-script.mjs …          ← not needed, this is plain .mjs
 *   DATABASE_URL=… node scripts/_restore_hr_zone_pcts.mjs           · dry run
 *   DATABASE_URL=… node scripts/_restore_hr_zone_pcts.mjs --apply   · restores
 *
 * Restoring puts the OLD, wrong bands' output back beside runs written under
 * the new ones, so only do it to undo a bad apply — not as a way to "keep the
 * old numbers".
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SNAPSHOT = path.resolve(ROOT, '../docs/hr-zone-pcts-snapshot-2026-08-24.json');

const apply = process.argv.includes('--apply');
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const snap = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

let changed = 0;
for (const row of snap.rows) {
  const want = row.hrZonePcts ?? null;
  const { rows: [cur] } = await pool.query(
    `SELECT data->'hrZonePcts' AS v FROM runs WHERE id = $1`, [row.runId],
  );
  if (cur === undefined) { console.log(`MISSING ${row.runId} · row is gone`); continue; }
  const same = JSON.stringify(cur.v ?? null) === JSON.stringify(want);
  if (same) continue;
  changed++;
  console.log(`${apply ? 'RESTORE' : 'would restore'} ${row.date} ${row.runId} · `
    + `${JSON.stringify(cur.v ?? null)} → ${JSON.stringify(want)}`);
  if (apply) {
    await pool.query(
      `UPDATE runs SET data = jsonb_set(data, '{hrZonePcts}', $2::jsonb, true) WHERE id = $1`,
      [row.runId, JSON.stringify(want)],
    );
  }
}
console.log(`${apply ? 'restored' : 'dry run ·'} ${changed} row(s) of ${snap.rows.length}`);
await pool.end();
