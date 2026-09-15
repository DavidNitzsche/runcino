# Faff cron / background job system — architecture audit

**Source:** background research sub-agent, dispatched 2026-09-15, as part of F159's research phase.
**Base branch caveat, important:** this sub-agent's worktree was based on this session's own documentation branch (`audit/brain-forensic-2026-09-10`), NOT `main`. It found `web-v2/lib/db/pool.ts` still hardcoding `max: 8` with no commit history changing it. **This does NOT mean the pool fix (raised to 32) didn't happen** — that fix is independently confirmed merged to `main` (commit `da817ed33`) and deployed live via Railway deploy-status checks. It means this specific research pass couldn't see `main`'s current state. Re-verify against `main` directly before treating any specific-commit claim below as current; the structural/architectural findings (schedules, shared-pool pattern, job shapes) are not affected by this caveat.

## 1. Every schedule-triggered workflow (cron), what it does

The repo has **25 workflow files** in `.github/workflows/`. Of those, **19 fire on a real `cron:` schedule**. The other 6 (`build-check.yml`, `native-check.yml`, `test-full.yml`, `plan-engine-bench.yml`, `surface-sweep.yml`, `silent-rebuild.yml`) are push/PR/`workflow_dispatch`-only — CI or on-demand, not scheduled DB load.

Every scheduled workflow follows the same shape: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://www.faff.run/api/cron/<name>` — all of them hit the live production Next.js server over HTTPS, not a script running against the DB directly (except the three noted at the bottom).

| # | File | Cron (UTC) | Plain English | What it hits |
|---|---|---|---|---|
| 1 | `tick.yml` | `*/10 * * * *` | every 10 min (nominal) | `POST /api/cron/tick` — the meta-dispatcher (see below) |
| 2 | `keep-warm.yml` | `*/15 14-23`, `*/15 0-6`, `0 7-13` | ~75/day nominal (every 15 min waking hours PT, hourly overnight) | `POST /api/cron/keep-warm` |
| 3 | `strava-push-poll.yml` | `*/15 14-23`, `*/15 0-6` | ~68/day nominal, every 15 min, 7am-11pm PT (no overnight tail) | `POST /api/cron/strava-push-poll` |
| 4 | `notifications.yml` | `*/30 14-23`, `*/30 0-6`, `*/30 7-13`, `*/15 11-13` | ~60/day nominal | `POST /api/cron/notifications` |
| 5 | `run-adaptations.yml` | `0 3 * * *` | daily, 8pm PT | `POST /api/cron/run-adaptations` |
| 6 | `plan-drift.yml` | `0 9`, `0 4` | twice daily | `POST /api/cron/plan-drift` |
| 7 | `readiness-snapshot.yml` | `15 8 * * *` | daily | `POST /api/cron/readiness-snapshot` |
| 8 | `reassessment-sweep.yml` | `30 5 * * *` | daily | `POST /api/cron/reassessment-sweep` |
| 9 | `pace-drift-monitor.yml` | `0 9 * * *` | daily | `POST /api/cron/pace-drift-monitor` |
| 10 | `snapshot-projections.yml` | `30 7 * * *` | daily | `POST /api/cron/snapshot-projections` |
| 11 | `max-hr-ratchet.yml` | `30 8 * * *` | daily | `POST /api/cron/max-hr-ratchet` |
| 12 | `dedupe-runs.yml` | `0 10 * * *` | daily | `POST /api/cron/dedupe-runs` |
| 13 | `promote-courses.yml` | `45 7 * * *` | daily | `POST /api/cron/promote-courses` |
| 14 | `prune-adaptation-shadow-log.yml` | `0 5 * * *` | daily | `POST /api/cron/prune-adaptation-shadow-log` |
| 15 | `strava-sync.yml` | `15 8 * * *` | daily | `POST /api/cron/strava-sync` |
| 16 | `enrich-weather.yml` | `30 7 * * *` | daily | `POST /api/cron/enrich-weather` |
| 17 | `emit-telemetry.yml` | `0 6 * * *` | daily | own node script, `npm install pg`, own `pg.Pool` |
| 18 | `audit-suite.yml` | `0 16 * * *` (+push) | daily | `npx vitest run` against 28 `*.audit.test.ts` files, own `pg.Pool` via `DATABASE_URL_RO` |
| 19 | `deletion-plan-fixture.yml` | `17 7 * * 1` (+push/PR) | weekly, Monday | `psql` directly, 2 `SELECT`s against `pg_catalog` |

**Two exact-time collisions found**, evidence these schedules were set independently, not coordinated:
- `readiness-snapshot.yml` and `strava-sync.yml` both fire at **`15 8 * * *`** (08:15 UTC), identical cron string.
- `enrich-weather.yml` and `snapshot-projections.yml` both fire at **`30 7 * * *`** (07:30 UTC), identical cron string.

## 2. Shared pool vs. own connection — the crux

Checked every scheduled workflow's target by grepping its route file (and, where the route delegates, the imported lib module) for `lib/db/pool`.

**16 of the 19** scheduled workflows are `curl`s into live Next.js API routes running inside the same Railway container that serves user traffic, and every one of those routes imports the single shared singleton:

```ts
// web-v2/lib/db/pool.ts
export const pool: Pool = global.__pgPool ?? new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 8,   // <-- SEE BASE-BRANCH CAVEAT AT TOP; re-verify against main
  connectionTimeoutMillis: 10_000,
  statement_timeout: 30_000,
});
```

Confirmed directly (`import { pool } from '@/lib/db/pool'`) in: `run-adaptations`, `plan-drift`, `readiness-snapshot`, `notifications`, `pace-drift-monitor`, `promote-courses`, `snapshot-projections`, `strava-push-poll`, `dedupe-runs`, `keep-warm`, `max-hr-ratchet`, `silent-rebuild`, `tick`. Confirmed transitively (route → lib module → `pool`) for `enrich-weather` (via `lib/weather/openmeteo.ts`), `prune-adaptation-shadow-log` (via `lib/adaptation/shadow-log-retention.ts`), `strava-sync` (via `lib/strava/pullSync.ts`), `reassessment-sweep` (via `lib/ops/reassessment-evaluators.ts`). So **every one of the 16 route-hitting cron workflows draws from the exact same 8-connection pool that live user page loads draw from** — no separate cron pool.

**3 of the 19 do NOT touch the shared pool** — they run in a GitHub-hosted runner as a separate process, with their own independent Postgres connection:
- `emit-telemetry.yml` → `web-v2/scripts/_emit_telemetry.mjs`: `new pg.Pool({ connectionString: env.DATABASE_URL })` — a brand-new pool (default node-pg max, i.e. 10), reading `DATABASE_URL` out of a freshly-written `.env.local` in the runner. Same physical database, same connection string, but a completely separate TCP client-side pool — competes for Postgres's server-side `max_connections` budget, not for Railway's app-side `max: 8`.
- `audit-suite.yml` → `npx vitest run` against 28 `*.audit.test.ts` files, most constructing their own `new Pool({ connectionString: RO, max: 2 })` against `DATABASE_URL_RO` (read-only role) — separate client-side pool.
- `deletion-plan-fixture.yml` → raw `psql` against `DATABASE_URL_RO || DATABASE_URL`, two `SELECT`s, no pooling library at all.

**The meta-dispatcher (`tick.yml` / `POST /api/cron/tick`)** is the most important piece of architecture here and materially changes the picture. Driven by **two** legs:
1. An **in-process heartbeat**, `web-v2/instrumentation.ts`, registered via Next's `register()` hook — fires every **5 minutes**, forever, as long as the Railway container is up, via a loopback `fetch('http://127.0.0.1:$PORT/api/cron/tick')`. This is the *primary* driver, not GitHub Actions.
2. `tick.yml`'s `*/10 * * * *` GitHub cron — an explicit backstop, acknowledged in its own header as delivering only a fraction of its nominal ticks ("EIGHT of the 75 ticks keep-warm's three cron lines ask for in a day").

`/api/cron/tick` itself, on every invocation (so up to ~288×/day from the heartbeat alone): runs `allLastSuccess()` — one `SELECT source, MAX(created_at) FROM ops_alerts WHERE kind='cron_ok' GROUP BY source` — computes staleness for all 11 registered jobs in memory, and only if a job is **due** makes a **second, nested HTTP request** back into the same process (`fetch(selfBaseUrl() + job.path)`) to actually run it. Cheap when nothing is due (1 lightweight query), but when jobs are due it becomes a same-process HTTP-into-HTTP chain, sequentially draining each due job in dependency order, each checking out its own connection(s) from the same 8-slot pool while the outer tick request is also still open.

## 3. Frequency / DB-work / pool table

| Job | Frequency (nominal) | Real / measured reliability | Rough per-run DB work | Pool |
|---|---|---|---|---|
| In-process heartbeat → tick | every 5 min | reliable while container is up (the *actual* clock) | 1 query when nothing due; cascades into whichever jobs are due | shared |
| `tick.yml` (GH) | every 10 min | own header cites ~8/75 delivered for a comparable cadence | same as above | shared |
| `notifications` | ~60/day | — | per active user: COUNT + batch drain + scheduler pass | shared |
| `keep-warm` | ~75/day nominal | **measured 8/day** on 2026-08-30 (cited verbatim in `cron-ledger.ts`) | trivial warm-up query | shared |
| `strava-push-poll` | ~68/day nominal | not separately measured | small poll of pending `strava_pushes` rows | shared |
| `run-adaptations` | 1/day | GH-measured 03:55–15:08 UTC spread over 4 days (5-12h late), Rule 23 | per active user: reassessment sweep, `detectAdaptations`/`applyAdaptations` (transaction), `tryAdaptiveBump`, volume-evidence lane, action-proposal lane, shadow-compare — heaviest job in the registry (1054-line route) | shared |
| `plan-drift` | 2/day | GH-measured 14:07–20:37 UTC vs. nominal 04:00/09:00 (10-16h late) | per active user: `reanchorLthr` ensure, drift computation, proposal writes; 1516-line route, largest of all cron routes | shared |
| `snapshot-projections` | 1/day | — | per active user: race read, quality-run read, VDOT compute, 3 projection upserts | shared |
| `readiness-snapshot` | 1/day | — | per active user: CoachState load + breakdown compute + 1 upsert | shared |
| `reassessment-sweep` | 1/day | — | reads `reassessment_schedule` where PENDING/DUE, transitions rows | shared |
| `pace-drift-monitor` | 1/day | — | read-only against plan tables + 1 alert row | shared |
| `max-hr-ratchet` | 1/day | — | per user, 1 monotone UPDATE gated on override; explicit "safety net" duplicate of a call `snapshot-projections` already makes | shared |
| `dedupe-runs` | 1/day | — | `autoMergeRecent` per active user, 14-day window | shared |
| `promote-courses` | 1/day | — | scans up to 200 races missing `promoted_to_library_iso` | shared |
| `prune-adaptation-shadow-log` | 1/day | — | 1 DELETE (retention) + row-cap enforcement | shared |
| `strava-sync` | 1/day | — | `pullSyncAllUsers`, 30-day pull per connected user (also hits Strava's external API — slowest by design, `maxDuration=300`/`timeoutMs=450000`) | shared |
| `enrich-weather` | 1/day | — | batched un-enriched runs, Open-Meteo external calls | shared |
| `emit-telemetry` | 1/day | — | multiple read-only SELECTs building an HTML report | own pool |
| `audit-suite` | 1/day + every push | — | 28 test files, live prod reads via RO role | own pool(s), `max: 2` each |
| `deletion-plan-fixture` | 1/week | — | 2 SELECTs against `pg_catalog` | own connection, psql |

Nothing here looks abusively chatty in isolation — most jobs are simple per-active-user loops with a handful of queries each. Per `docs/CRON_AUDIT.md` (dated 2026-05-30, now stale but indicative), the user base was tiny at the time. What's structurally unusual is the **count of independently-scheduled jobs all sharing one 8-connection in-process pool with live traffic**, compounded by the **meta-dispatcher nesting HTTP calls into the same process**, and the fact that GitHub's own cron is empirically unreliable (single-digit-percent delivery measured on `keep-warm`), which the app worked around by adding a *second*, in-process, 5-minute clock — meaning the real cadence of DB-touching scheduled work is now driven mostly by the app's own process, not by GitHub at all.

## 4. Rule 23 — status update, with evidence

**The specific incident Rule 23 documents has a real, dated (2026-08-30) fix in the current code**, not just a written rule. Two independent mechanisms:

**A. The ledger + tick (`web-v2/lib/ops/cron-ledger.ts`, `POST /api/cron/tick`).** Instead of trusting a clock, every job stamps `ops_alerts (kind='cron_ok', source='cron/<id>')` on success, and "due" is computed as "has this job run since its most recent slot opened" rather than "is it that hour." The module's own header quotes the exact incident from Rule 23 verbatim and states explicitly: "Lateness must be harmless" and "a MISS IS VISIBLE" — jobs that go stale raise a `cron_stale` ops alert, and the registry (`CRON_JOBS`) encodes explicit `requires: [...]` dependency ordering so the tick defers a job whose predecessor hasn't run yet, rather than running out of order.

**B. The specific LTHR-freeze bug is directly fixed, not just scheduled around.** `web-v2/app/api/cron/plan-drift/route.ts` (lines ~159-213) now calls `reanchorLthr(u)` as the first statement of its own per-user loop, before any plan-authoring path, with an explicit comment: "This cron AUTHORS BLOCKS... this job was silently assuming that a DIFFERENT job... had already run today... The fix is not to check the sibling and refuse. It is to stop needing it." Exactly the "ensure the precondition" remedy Rule 23 calls for. Idempotent/cheap when the anchor is already fresh, reports a three-state outcome, raises a `cron_precondition` alert if the ensure itself fails.

**Caveat found while checking this:** the 19 scheduled GitHub Actions workflows are still running unchanged and in parallel with the new tick/ledger system — deliberate (documented: "a new trigger and the removal of an old one do not belong in the same change... the new path has to be watched through a full cycle first"), designed to cooperate (the ledger row is stamped by the route itself regardless of caller). Reasonable transition posture, but means the redundancy in §5 is current and intentional, not legacy cruft — someone will need to decide on retiring the old per-job GH crons once the tick has been watched through a cycle; no evidence that decision has been made yet.

## 5. Overall assessment

**Is this a coherent structural problem independent of the live incident? Partially — mostly yes on shape, no on redundant computation.**

- **The core structural claim is confirmed by code, not just by log symptoms**: 16 of 19 scheduled workflows curl live API routes that all import the same `pool.ts` singleton, the same pool every live user page-load hits. No separate "jobs pool." Real, load-bearing architectural fact.
- **The "raised to 32" claim could NOT be confirmed from this codebase** — see base-branch caveat at top of this document. `pool.ts` still showed `max: 8` in this sub-agent's checkout, with only 4 commits total in that file's history, none changing `max`. Independently confirmed elsewhere (Railway deploy-status, implementer's report) that this fix IS live on `main` — this is a research-clone artifact, not evidence the fix doesn't exist. Worth a direct, named re-verification against `main` rather than being taken as settled either way.
- **The "17-24 independent cron workflows" framing somewhat overstates the redundancy risk as of today**, because the team already recognized this exact problem and built a real fix for the *scheduling reliability* half (the ledger/tick system, §4) — evidence the shape was noticed and engineered around, not ignored. What it does **not** fix: the pool-sharing half. The tick still drives due jobs by nested in-process HTTP calls checking out connections from the same 8-slot pool as users, and 16 independently-authored cron routes still each do their own per-user DB work with no coordination on how much of the pool they're allowed to consume at once. Nothing in the registry limits concurrent pool usage across jobs — `START_BUDGET_MS` bounds how long the tick *keeps starting new jobs*, not how many connections are in flight at once.
- **Genuine duplication exists, documented as deliberate, not accidental**: `max-hr-ratchet.yml` explicitly re-runs `ratchetUsersMaxHr` as a "safety net" for the same call `snapshot-projections` already makes inline — a self-aware, small redundancy.
- **Concerning-kind evidence found**: two literal cron-string collisions (`readiness-snapshot`/`strava-sync` both at 08:15 UTC; `enrich-weather`/`snapshot-projections` both at 07:30 UTC) — independently authored, never coordinated, both likely to hit the Railway process at close to the same wall-clock moment, each opening its own pool checkout. Given `connectionTimeoutMillis: 10_000`, a burst of 2-3 simultaneous per-user-loop jobs plus live user traffic is a plausible mechanical path to the pg-pool timeout pattern seen in the incident — causation from static code alone can't be proven, but the collision is real and unforced.
- **Stale/phantom documentation found while checking ordering claims**: three workflow files (`keep-warm.yml`, `snapshot-projections.yml`, `enrich-weather.yml`) reference a `refresh-briefings` cron at 07:05 UTC as something other jobs run "after" — this file/route no longer exists anywhere in the repo, fully retired, comments never updated. Separately, `snapshot-projections.yml`/`promote-courses.yml` still say they run "after run-adaptations (07:15 UTC)," but `run-adaptations.yml`'s live cron is `0 3 * * *` — a schedule change from 2026-06-04 never back-propagated into these comments. Neither affects correctness today (jobs described as idempotent/order-tolerant), but the ordering *narrative* in comments should not be trusted — only the cron-ledger's `requires:` array and `CRON_JOBS` registry is live-enforced.

**Bottom line**: a real, coherent architectural pattern — a shared, small, in-process connection pool serving both live traffic and a genuinely large number of independently-scheduled background sweeps — plausible as a contributing or compounding factor to the incident, but the team has already done non-trivial engineering to fix the *timing* half of the problem. What's not yet done: nothing coordinates or caps *concurrent pool consumption* across the 16 shared-pool jobs, the two GH cron workflows run in parallel with the new tick with no stated retirement date, and the pool-size claim needs direct re-verification against `main`.
