import { Pool } from 'pg';
import { writeFileSync } from 'node:fs';

const DAVID_UUID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const DAVID_EMAIL = 'dnitch85@me.com';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 4,
});

async function main() {
  const tables = (await pool.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' ORDER BY table_name;
  `)).rows.map((r) => r.table_name);

  const out = {
    generated_at: new Date().toISOString(),
    david: { uuid: DAVID_UUID, email: DAVID_EMAIL },
    table_count: tables.length,
    tables: {},
  };

  for (const t of tables) {
    const cols = (await pool.query(
      `SELECT column_name, data_type, is_nullable, column_default,
              character_maximum_length, numeric_precision, numeric_scale
       FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1
       ORDER BY ordinal_position;`, [t])).rows;

    const idx = (await pool.query(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE schemaname='public' AND tablename=$1 ORDER BY indexname;`, [t])).rows;

    const constraints = (await pool.query(
      `SELECT conname,
              pg_get_constraintdef(c.oid, true) AS def
       FROM pg_constraint c
       JOIN pg_class r ON r.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = r.relnamespace
       WHERE n.nspname='public' AND r.relname=$1
       ORDER BY conname;`, [t])).rows;

    let total = 0;
    try {
      total = Number((await pool.query(`SELECT COUNT(*)::bigint AS c FROM ${t}`)).rows[0].c);
    } catch {}

    const colNames = new Set(cols.map((c) => c.column_name));
    let davidRows = null;
    let scope = 'global';
    if (colNames.has('user_uuid')) {
      scope = 'per-user (uuid)';
      try {
        davidRows = Number((await pool.query(
          `SELECT COUNT(*)::bigint AS c FROM ${t} WHERE user_uuid = $1`,
          [DAVID_UUID])).rows[0].c);
      } catch {}
    } else if (colNames.has('user_id')) {
      const dt = cols.find((c) => c.column_name === 'user_id')?.data_type;
      scope = dt === 'uuid' ? 'per-user (uuid only)' : "per-user (text 'me')";
      try {
        if (dt === 'uuid') {
          davidRows = Number((await pool.query(
            `SELECT COUNT(*)::bigint AS c FROM ${t} WHERE user_id = $1`,
            [DAVID_UUID])).rows[0].c);
        } else {
          davidRows = Number((await pool.query(
            `SELECT COUNT(*)::bigint AS c FROM ${t} WHERE user_id::text IN ('me', $1)`,
            [DAVID_UUID])).rows[0].c);
        }
      } catch {}
    }

    out.tables[t] = {
      total_rows: total,
      david_rows: davidRows,
      scope,
      columns: cols,
      indexes: idx,
      constraints,
    };
  }

  writeFileSync(process.argv[2] || '/tmp/schema_dump.json', JSON.stringify(out, null, 2));
  console.log(`Wrote schema for ${tables.length} tables`);
}

try { await main(); } catch (e) { console.error(e); process.exit(1); }
finally { await pool.end(); }
