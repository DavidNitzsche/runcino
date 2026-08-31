// One-off verification of pruneAdaptationShadowLog() against production.
// Safe: with only a handful of rows (all from today), both bounds (180 days,
// 400/user) are far from binding, so this is expected to delete 0 rows and
// simply prove the function runs cleanly against the real table.
import { readFileSync } from 'node:fs';

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

async function main() {
  const { pruneAdaptationShadowLog } = await import('../lib/adaptation/shadow-log-retention.ts');
  const { pool } = await import('../lib/db/pool.ts');

  const before = await pool.query(`SELECT count(*)::int AS n FROM adaptation_shadow_log`);
  console.log('total rows before:', before.rows[0].n);

  const result = await pruneAdaptationShadowLog();
  console.log('prune result:', JSON.stringify(result));

  const after = await pool.query(`SELECT count(*)::int AS n FROM adaptation_shadow_log`);
  console.log('total rows after:', after.rows[0].n);

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
