/**
 * Run pending Drizzle migrations against DATABASE_URL.
 * Invoked by `npm run migrate` and as part of the production start command.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import path from 'node:path';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set');
  }
  const ssl = /sslmode=require/i.test(url) || /\.railway\.app/.test(url)
    ? { rejectUnauthorized: false }
    : undefined;
  const pool = new Pool({ connectionString: url, ssl });
  const db = drizzle(pool);
  const migrationsFolder = path.resolve(process.cwd(), 'drizzle');
  console.log(`[migrate] running migrations from ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });
  await pool.end();
  console.log('[migrate] done');
}

main().catch((err) => {
  console.error('[migrate] failed:', err);
  process.exit(1);
});
