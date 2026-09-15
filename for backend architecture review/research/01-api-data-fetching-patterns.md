# Faff `web-v2/app/api` Architecture Catalog

**Source:** background research sub-agent, dispatched 2026-09-15, as part of F159's research phase.
**Base branch caveat:** this sub-agent's read was NOT confirmed to be against `origin/main` specifically — treat any claim about "current" application code state as needing a quick re-check against `main` before being relied on for implementation decisions. Structural/architectural facts (route counts, patterns, caching config) are unlikely to be affected; anything about a *specific recent fix's presence* should be re-verified.

Scope note up front: read `find`/`grep` output across all 157 `route.ts` files for structural facts (counts, import patterns, loop shapes), plus a full read of 6 files, a partial deep read of one (`v5/today/route.ts`, ~1000 of 2622 lines), and targeted reads of ~15 more (lib helpers, migrations, cron workflows, `lib/db/pool.ts`, `lib/db/read.ts`, `lib/runtime/request-memo.ts`). Roughly 20-22 files read in real depth, out of 157 route files — not exhaustive, and the report says below wherever a claim rests on grep-inference rather than a direct read.

## 1. Taxonomy of endpoints (157 total, by top-level directory)

```
 18  admin/*        — diagnostics, audits, one-off backfills, ops
 17  plan/*         — plan CRUD, mutation, proposals, undo/restore
 17  cron/*         — scheduled jobs (see §4)
 13  coach/*        — calibration, facts, intents, log, proposals, read
 11  v5/*           — the iPhone v5 surface (today, plan-snapshot, races, block, paces...)
  8  race/*         — single-race detail, autofill, execution-plan, block-preview
  8  auth/*         — apple/email/strava login, signup, password, access requests
  5  strava/*       — push status/history, webhook
  5  profile/*      — profile, goal, notifications, state, timezone
  4  today/*        — purpose, reschedule, shoe, skip (legacy/parallel to v5/today)
  3  runs/*         — [id], [id]/recap, [id]/rpe
  3  readiness/*    — readiness, brief, subjective
  3  notifications/*— ack, inbox, register
  3  niggle/*        — episode logging, history, recovery
  3  health/*        — manual entry, series, state
  2  watch/*         — today, workouts/complete
  2  sick/*, injuries/*, ingest/*, gpx/*, goals/*, checkin/*  (2 each)
  1  each — up, travel, training, tips, targets, strength, streak, shoe,
             settings, run(manual), records, races(list), prescription,
             overview, onboarding, log, learn, forecast, cross-training,
             coach-calendar, briefing, account
```

Rough breakdown: **admin + cron = 35/157 (~22%)** are internal/operational, not runner-facing in the normal sense. **111/157 routes call `requireUserId`** (session-authenticated, i.e., genuinely runner-facing). The remaining ~46 are either admin/cron (gated by `CRON_SECRET`, 20 files) or unauthenticated infra endpoints (webhooks, `/up` health check, `auth/*` login/signup routes themselves, `learn`/`tips`/`overview` static-ish content).

## 2. Data-fetching pattern consistency

**No shared "get a connection" abstraction is used consistently.** There is exactly one pool: `web-v2/lib/db/pool.ts` — `new Pool({ max: 8, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 })`, a single module-level singleton reused across every route, every cron job, and every lib helper in the same process. (Caveat: the `max` value seen here should be re-checked against `main` — see the cron report for a specific discrepancy found there.)

- **108 of 157 route.ts files** import `pool` from `@/lib/db/pool` directly.
- **74 of 157** call `pool.query(` directly inside the route file itself.
- **5 of 157** call `pool.connect()` for explicit transactions (`plan/undo`, `auth/apple`, `auth/signup`, `account/delete`, `onboarding/complete`) — all 5 spot-checked and all correctly `client.release()` in a `finally` block, so this isn't a leak source.
- **19 of 157** import `lib/db/read.ts` (`rowOrNull`/`rowsOrNull`/`attempt`/`rowsOrEmpty`) — **not a connection-management abstraction**, it's a result-shape wrapper around a `pool.query()` promise passed in by the caller (per the header comment in that file — it exists to stop failures being swallowed as empty results, a documented past incident, not to pool or dedupe connections).
- **49 of 157 route files have zero direct DB reference** — these delegate entirely to `lib/*` service functions (e.g. `lib/coach/*-state.ts`, `lib/plan/*`, `lib/faff/*`) which do their own `pool.query()` calls internally. This means the *real* number of DB round-trips per request is not visible from the route file alone — it's distributed across however many independent lib functions the route composes, each of which independently reaches into the same 8-connection pool.

**The net pattern:** every layer of the codebase (route handlers, and dozens of independent `lib/*` service modules) treats `pool.query()` as a zero-cost call and reaches for it directly and independently. There is no request-level connection budget, no "acquire once, reuse for this request" pattern, and no central gateway that could apply backpressure or queuing above the raw `pg.Pool`.

**Spot-checked hot routes — exact shape found:**

- **`web-v2/app/api/v5/today/route.ts`** (2,622 lines — the largest route in the app). Its own header comment states: *"The Today surface is 570 lines of composition over ~35 reads."* Confirmed by grep: **15 direct `pool.query()` calls** in the route file itself, plus dozens more inside the ~40 `lib/*` functions it imports (`loadActivePlanStrict`, `loadGlanceState`, `loadPlanWeek`, `resolveCoachingThesis`, `loadPostRunExperience`, `resolveFitness`, etc.). Reads are **mostly sequential awaits** (46 `await` occurrences, only **1 `Promise.all`** in the whole file, used for a two-item shoe/mileage fetch), because most queries have data dependencies on prior ones (branch on active plan → branch on safety state → branch on today's prescription, etc.). Good for peak concurrent-connection pressure per request (usually only 1 connection checked out at a time), bad for tail latency — a single request can chain 15-40+ sequential round-trips.
  - This route has its own documented incident: *"One `buildSeed()` render issued 260 database round-trips. 58 of them (22%) were byte-identical repeats — same SQL, same parameters, same render."* This motivated `lib/runtime/request-memo.ts` (`withRequestMemo`/`memo()`), an `AsyncLocalStorage`-scoped per-request memoization layer.
  - **Only 3 of 157 routes actually use `withRequestMemo`**: `v5/today`, `v5/races`, `v5/block`. Opt-in per call site inside `lib/*` functions too (6 lib files call `memo()`). The N+1-style duplicate-read problem this was built to fix is fixed only on the v5 surface, not on the parallel legacy `today/*`, `coach/*`, `overview`, or `plan/week` routes.

- **`web-v2/app/api/coach/read/route.ts`** (151 lines) — the cleanest pattern found. `pool` is imported but never called directly; all three data needs (fitness, adaptation, goal-gap) are fanned out via `Promise.all([quiet(...), quiet(...), quiet(...)])`, each delegating to a `lib/*` resolver, each independently wrapped so a failure in one doesn't blank the whole response. This is a genuine 3-way concurrent connection draw from the 8-cap pool on every hit — `loadVdotInputs` (3 `pool.query` calls), `readAdaptation` (5), `computeGoalGap` (4) all run concurrently, so a single `/api/coach/read` request can occupy 3+ pool connections simultaneously (more if any of those inner functions parallelize their own queries too — not verified deeper).

- **`web-v2/app/api/today/purpose/route.ts`** (464 lines), **`web-v2/app/api/v5/plan-snapshot/route.ts`** (32 lines, thin composition), **`web-v2/app/api/plan/week/route.ts`** (53 lines), **`web-v2/app/api/watch/today/route.ts`** (48 lines), **`web-v2/app/api/overview/route.ts`** (30 lines) — all have **0 direct `pool.query()` calls**; each is a thin wrapper delegating entirely to one or two `lib/*` composer functions. Full DB fan-out inside those lib functions not traced (out of budget for this pass) — **not exhaustively checked**.

**On N+1 shape specifically:** no classic in-route "loop that queries once per row" pattern found in the 157 route files via a `for(...){ await pool.query }` regex scan (zero matches). What *was* found — related and arguably worse for the pool-exhaustion incident — is covered in the cron report: nearly every cron route loops `for (const u of userIds)` and does full per-user DB work inside the loop, sequentially across users but often with an internal `Promise.all` fan-out per user.

## 3. Explicit caching

**HTTP-level caching (`Cache-Control` headers) exists on only 9 of 157 route files**, all short-TTL, per-request-still-hits-the-DB caching (client/CDN, not server-side skip-the-query caching):

- `forecast/[date]` — `private, max-age=1800, stale-while-revalidate=600`
- `learn/[slug]` — `public, max-age=3600, s-maxage=86400, stale-while-revalidate=300` (genuinely static content)
- `shoe` — `private, max-age=120, stale-while-revalidate=30`
- `prescription` — `private, max-age=600, stale-while-revalidate=60`
- `injuries`, `runs/[id]` — explicitly `no-cache, must-revalidate` (deliberately *not* cached; `runs/[id]`'s comment notes a prior 5-minute cache was deliberately dropped)
- `admin/audit-convergence`, `admin/audit-weather`, `admin/backfill-course-geometry` — admin-only, not relevant to runner load

**No `unstable_cache` / Next.js data-cache usage found anywhere in `web-v2/app/api`** (grep for `unstable_cache` returned nothing).

**Critically: none of the hot routes named in the incident have any caching at all.** `v5/today`, `v5/plan-snapshot`, `coach/read`, `overview`, `plan/week` — zero `Cache-Control`, zero `unstable_cache`, zero DB-table-as-cache. Every hit re-executes the full read chain (up to ~35-40 round-trips for `v5/today`) against the pool. `export const dynamic = 'force-dynamic'` is explicitly set on `v5/today` and `coach/read` (confirmed by direct read), opting them out of any Next.js route-level caching altogether.

**DB-table-as-cache pattern — `coach_reads_cache`, one confirmed live instance:**

`web-v2/lib/coach-calendar/store.ts` implements a proper read-through cache against `coach_reads_cache` (migration `153_coach_reads_cache.sql`), keyed `(user_uuid, read_kind, cache_key)` with a `ttl_at` column and `ON CONFLICT (user_uuid, read_kind, cache_key) DO UPDATE ... ttl_at = EXCLUDED.ttl_at`. It carefully distinguishes three states per Rule 11 in CLAUDE.md — cache hit (row), cache miss (`undefined`), and "cache unreadable" (`null`, i.e., the DB read itself failed) — and on miss/expiry fires a background refresh rather than blocking. Currently used **only for `read_kind = 'coach_calendar'`** — grep confirms no other call site sets a different `read_kind` into this table, so it's schematically general-purpose but not actually reused elsewhere yet.

**A second, now-dead cache table exists: `briefings`** (migration `105_briefings_cache.sql`, unique index literally named `briefings_cache_key`). Built as an LLM-response cache keyed on a computed signature. **Zero live code references it** — `grep -rln "briefings_cache"` across `lib/` and `app/` returns nothing, and `web-v2/app/api/briefing/route.ts`'s own header comment confirms why: *"2026-05-28 · Cardinal Rule #1 ... 'Zero LLM · anywhere · ever.' The old Anthropic tool-use engine is deleted. This route ... is now a thin adapter over `/api/coach/facts`."* Corroborates the standing memory note ("Phantom-table scripts — briefings has no successor") — phantom cache table, dead weight in the schema, not active.

## 4. Hot / high-frequency routes

Covered in detail in `02-cron-background-jobs.md`. Summary: **named-in-incident runner-facing routes** (`today`, `dashboard`, `overview`, `v5/today`, `plan-snapshot`, `coach/read`) all confirmed uncached, all doing double-digit sequential DB round-trips per hit. Hit on every app foreground/pull-to-refresh by every active user, with no caching layer absorbing repeat load.

## 5. Admin/diagnostic volume

- **`admin/*`: 18 route files** — access requests, 6 distinct `audit-*` endpoints, 4 `backfill-*` one-off repair endpoints, `canonical-adaptation-shadow`, `decision-ledger`, `healthkit-resync-preview`, `ops-alerts`, `plan-mutation-rejections`, `re-enrich-weather`, `recompute-runs`, `reseed-maintenance`, `strava-webhook` (duplicate of the top-level Strava webhook — worth a look separately, not investigated here), `tester-watch`.
- **`cron/*`: 17 route files** — internal, `CRON_SECRET`-gated (or intended to be), not hit by the runner's own device.
- **Combined: 35/157 (~22%)** of the route surface is admin/cron, not runner-facing.
- **20/157 routes check `CRON_SECRET`** in the route body — doesn't cleanly equal 35, meaning some admin routes use a different/weaker gate. 17 admin routes have neither `CRON_SECRET` nor `requireUserId` in a direct grep; whether they use a third auth mechanism (e.g., email allowlist) is **not verified, flagged as open**.
- **111/157 routes require `requireUserId`** — the real "runner-facing, needs a live user session" surface, ~71% of the API.

For load-vs-investigative-surface purposes: the 35 admin/cron routes aren't hit by the phone in normal operation, but several cron jobs fire every 10-15 minutes around the clock and loop per-user, so "admin/cron = low load" would be the wrong inference — low *route-count-relative-to-runner-surface* but not low *pool pressure*.

---

### Summary

One global 8-connection pool shared, with no partitioning, between (a) 111 runner-facing routes that mostly do long uncached sequential read-chains (`v5/today` alone: ~35-40 round-trips per hit, only 3 of 157 routes using any per-request memoization), and (b) a dozen-plus cron jobs — several running every 10-15 minutes essentially 24/7 — that loop per-active-user and, at least in the one case fully verified (`keep-warm`, see cron report), fan out 6-way concurrent queries per user against that same pool, explicitly designed to hold connections open. No route-level or DB-table caching exists for any of the routes actually named in tonight's incident. The one working DB-cache pattern (`coach_reads_cache`) is schematically reusable but currently scoped to a single feature, and a structurally identical earlier attempt (`briefings`) is dead code left in the schema.
