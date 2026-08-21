/**
 * lib/runtime/request-memo.ts · request-scoped read memoization.
 *
 * THE PROBLEM (2026-08-21 perf audit)
 *   One `buildSeed()` render issued 260 database round-trips. 58 of them
 *   (22%) were byte-identical repeats — same SQL, same parameters, same
 *   render. `firstRunISO` alone ran 12 times for a value that depends on
 *   nothing but the user id. Only 3 of the 58 overlapped in time, so
 *   in-flight coalescing would have caught almost none of them: the
 *   duplicates are spread across sequential phases of the render, which
 *   means the memo has to survive for the whole request, not just for the
 *   duration of one call.
 *
 * WHY NOT React `cache()`
 *   Measured, not assumed: outside a React render scope `cache()` does not
 *   memoize at all (4 calls → 4 executions). It would fix Server Component
 *   renders and do exactly nothing for the `/api/v5/*` route handlers the
 *   phone actually talks to. This works in both.
 *
 * THE SCOPE RULE
 *   The store lives in an AsyncLocalStorage scope opened by
 *   `withRequestMemo()` and dies when that scope exits. There is no TTL to
 *   tune and nothing to invalidate, because nothing outlives the request
 *   that created it. With NO active scope `memo()` is a pass-through and
 *   the read executes exactly as it did before — so an un-wrapped caller
 *   (a cron job, a script, a test) keeps its current behavior rather than
 *   silently inheriting a cache.
 *
 * WHAT MAY BE MEMOIZED
 *   Pure reads only, and only where every caller treats the result as
 *   read-only — the resolved value is SHARED, not copied. Do not memoize
 *   anything a request also writes to: a read-modify-write in the same
 *   request would read its own stale value. Each call site is opted in
 *   explicitly for that reason; there is deliberately no blanket
 *   memoization at the pool layer.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

type Store = Map<string, Promise<unknown>>;

const als = new AsyncLocalStorage<Store>();

/** Open a fresh memo scope for one request. Nested calls reuse the outer scope. */
export function withRequestMemo<T>(fn: () => Promise<T>): Promise<T> {
  if (als.getStore()) return fn();
  return als.run(new Map(), fn);
}

/**
 * Memoize one pure read for the life of the current request scope.
 * No scope → straight pass-through.
 *
 * The PROMISE is cached, not the value, so concurrent callers share one
 * in-flight query too. A rejection is evicted so a failed read is never
 * cached as a result.
 */
export function memo<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const store = als.getStore();
  if (!store) return fn();
  const hit = store.get(key) as Promise<T> | undefined;
  if (hit) return hit;
  const p = fn().catch((err) => { store.delete(key); throw err; });
  store.set(key, p);
  return p;
}

/**
 * Drop one memoized read from the current scope.
 *
 * A writer that changes the row a memoized read returns MUST call this with
 * the same key, so a read-after-write in the same request sees the write.
 * No scope → no-op, same as `memo`.
 */
export function memoDrop(key: string): void {
  als.getStore()?.delete(key);
}

/** Test/diagnostic helper — how many distinct reads the current scope holds. */
export function memoSize(): number {
  return als.getStore()?.size ?? 0;
}
