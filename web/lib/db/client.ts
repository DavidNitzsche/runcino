import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

declare global {
  var __runcinoPgPool: Pool | undefined;
}

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. On Railway it is auto-injected by the Postgres plugin; locally, set it in .env.local.',
    );
  }
  return url;
}

function buildPool(): Pool {
  const url = getDatabaseUrl();
  const ssl = /sslmode=require/i.test(url) || /\.railway\.app/.test(url)
    ? { rejectUnauthorized: false }
    : undefined;
  return new Pool({ connectionString: url, ssl, max: 5 });
}

const pool = globalThis.__runcinoPgPool ?? buildPool();
if (process.env.NODE_ENV !== 'production') {
  globalThis.__runcinoPgPool = pool;
}

export const db = drizzle(pool, { schema });
export { pool };
