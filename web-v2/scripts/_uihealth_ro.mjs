// UI-HEALTH audit RO harness. Read-only; refuses any non-RO URL.
// Usage: node scripts/_uihealth_ro.mjs <file.sql>   (multiple statements separated by ';\n--@\n')
//   or:  node scripts/_uihealth_ro.mjs -e "SELECT 1"
import fs from 'node:fs';
import pg from 'pg';

const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const RO_URL = (env.match(/^DATABASE_URL_RO=(.*)$/m)?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
if (!RO_URL || !/faff_readonly/.test(RO_URL)) {
  console.error('REFUSING: DATABASE_URL_RO must name faff_readonly'); process.exit(1);
}
const pool = new pg.Pool({ connectionString: RO_URL });

const arg = process.argv[2];
let blocks;
if (arg === '-e') {
  blocks = [process.argv[3]];
} else if (arg) {
  const raw = fs.readFileSync(arg, 'utf8');
  blocks = raw.split(/\n--@\n/).map(s => s.trim()).filter(Boolean);
} else {
  console.error('need a .sql file or -e "SQL"'); process.exit(1);
}

const cu = (await pool.query('SELECT current_user, has_table_privilege(current_user, \'runs\', \'UPDATE\') AS can_write')).rows[0];
console.log(`# current_user=${cu.current_user} can_write_runs=${cu.can_write}`);

for (const sql of blocks) {
  const label = (sql.match(/^--\s*(.+)$/m)?.[1]) ?? sql.slice(0, 60).replace(/\s+/g, ' ');
  try {
    const r = await pool.query(sql);
    console.log(`\n### ${label}  (${r.rowCount} rows)`);
    console.log(JSON.stringify(r.rows, null, 2));
  } catch (e) {
    console.log(`\n### ${label}\n  ERROR: ${e.message}`);
  }
}
await pool.end();
