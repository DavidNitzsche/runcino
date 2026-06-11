/**
 * Postgres pool — single shared instance per process.
 * Reads DATABASE_URL from env (Railway prod or local override in .env.local).
 */
import { Pool } from 'pg';

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

// Local sandbox (scripts/sandbox.sh · localhost Postgres) speaks no TLS —
// forcing ssl there fails every query. Railway proxy connections keep the
// permissive TLS they always had.
const isLocalDb = /@(localhost|127\.0\.0\.1)[:/]|^postgres(ql)?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? '');

export const pool: Pool = global.__pgPool ?? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocalDb ? undefined : { rejectUnauthorized: false },
  max: 8,
  // Fail a checkout instead of queueing forever when all 8 connections hang.
  connectionTimeoutMillis: 10_000,
  // Server-side kill for runaway statements; well above the slowest known
  // query (plan rebuild batch inserts) and below Railway's proxy idle cut.
  statement_timeout: 30_000,
});

// node-pg emits 'error' on the Pool when an IDLE client's backend dies
// (Railway PG restart, proxy idle-kill). With no listener Node treats it as
// an unhandled 'error' event and crashes the process — mid-write, which is
// how half-committed states get minted. Log and let the pool replace the
// client; in-flight queries on that client still reject to their callers.
pool.on('error', (err) => {
  console.error('[db/pool] idle client error (recovered):', err.message);
});

if (process.env.NODE_ENV !== 'production') {
  global.__pgPool = pool;
}
