/**
 * Postgres pool — single shared instance per process.
 * Reads DATABASE_URL from env (Railway prod or local override in .env.local).
 */
import { Pool } from 'pg';

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

export const pool: Pool = global.__pgPool ?? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 8,
});

if (process.env.NODE_ENV !== 'production') {
  global.__pgPool = pool;
}
