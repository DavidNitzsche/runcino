/**
 * Postgres pool — single shared instance per process.
 * Reads DATABASE_URL from env (Railway prod or local override in .env.local).
 */
import { Pool } from 'pg';
// Arms the production write barrier IF this process is verification tooling
// (vitest, NODE_ENV=test, FAFF_VERIFICATION=1) — and does nothing at all
// otherwise, so the real application's writes are untouched. Imported for
// effect, before the pool below is constructed, because the barrier patches
// `pg`'s prototypes rather than this one instance.
// See lib/verify/production-barrier.ts for the incident it exists to prevent.
import './../verify/install-barrier';

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
  // F156 (2026-09-15) · raised from 8. This single Railway instance runs
  // ALONE against the DB (no horizontal scaling configured in railway.json)
  // and shares this one pool across every live user request, plus tick.yml
  // (a 10-minute, all-day cron dispatcher that queries a staleness ledger on
  // every single run) and strava-push-poll.yml (a real per-user poller
  // firing every 15 minutes, 9 hours a day) — a genuinely chronic, year-round
  // background load, not a one-night spike. 8 concurrent connections proved
  // too few: live production logs showed repeated
  // "timeout exceeded when trying to connect" failures on /api/v5/today and
  // several other subsystems within the same short window.
  // Confirmed safe to raise, not picked blind: `SHOW max_connections` on the
  // real database returned 500, with only 9 connections in use at the time
  // of checking — this app's own artificially small pool was the actual
  // bottleneck, not the database's real capacity. 32 leaves over 15x
  // headroom below that ceiling even if every connection is in simultaneous
  // use, while directly relieving the observed exhaustion.
  // Disclosed, not asserted as the confirmed root cause: this is a real,
  // independently-justified infra fix regardless of outcome, but whether it
  // actually explains what David has been experiencing needs a live re-test
  // after this deploys, not just a plausible mechanism on paper — see F156.
  max: 32,
  // Fail a checkout instead of queueing forever when all connections hang.
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
