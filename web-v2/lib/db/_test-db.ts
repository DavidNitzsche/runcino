/**
 * lib/db/_test-db.ts · whether this test process has a database to talk to.
 *
 * `vitest.setup.ts` states the contract this exists to keep: it loads
 * `.env.local` if there is one, and "missing file is not an error — the suite
 * is overwhelmingly pure and must stay runnable with no database at all."
 *
 * Two suites did not keep it. `_open_block_authoring.test.ts` and
 * `_wave1_smoke_dryrun.test.ts` call `pool.query` unguarded, so with no
 * `DATABASE_URL` the pool falls back to a localhost default, nothing is
 * listening, and six tests fail with ECONNREFUSED. That is the same failure
 * mode `vitest.setup.ts`'s own header was written about, and its verdict
 * stands: "a permanently-red suite trains everyone to ignore red, which is the
 * most expensive habit a test suite can teach." Six red tests that mean "there
 * is no database here" teach exactly that, and they taught it well enough that
 * the count was being quoted as the known baseline.
 *
 * Skipping says the true thing instead. Where a `DATABASE_URL` exists — CI, a
 * developer with `.env.local` — these suites run and gate exactly as before;
 * where none does, they report as not-run rather than as broken. The predicate
 * is the variable itself and not a connection attempt, because
 * `lib/db/pool.ts`'s localhost fallback means an unset variable is already
 * indistinguishable from a wrong one.
 */
export const HAS_DATABASE = !!process.env.DATABASE_URL;

/** Message for the skip, so a reader of the run output knows why. */
export const NO_DATABASE_REASON =
  'no DATABASE_URL in this environment · these assertions read production rows';
