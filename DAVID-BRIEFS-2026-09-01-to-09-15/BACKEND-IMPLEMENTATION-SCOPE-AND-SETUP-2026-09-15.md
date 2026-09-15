# Backend implementation scope and exact setup

**Status:** execution packet following the whole-backend audit  
**Date:** 2026-09-15  
**Baseline audited:** `origin/main` at `b6d972fded126cde46f639fcddb21088cd5f81fe`  
**Governing direction:** `BACKEND-DATA-BRAIN-APP-ARCHITECTURE-BRIEF.md`  
**Audit:** `WHOLE-BACKEND-MASTER-PLAN-AUDIT-2026-09-15.md`  
**Hosting:** Railway and PostgreSQL only. No Cloudflare work. No recurring-cost increase without David's approval.

## The implementation rule

Build this as a sequence of additive, reversible releases. Do not create one “backend architecture” branch. Every unit starts from the current `origin/main`, has one code owner and one independent reviewer, carries exact base/head SHAs, and is reviewed again after any code change.

The target chain is:

> fact or command → durable receipt and event → canonical owners → versioned projection → one app snapshot store → one version signal → displayed-version evidence

The projection system copies answers from canonical owners. It never contains a second fitness, readiness, pace, plan, adaptation, safety, goal, or race-prediction decision.

## Programme structure

Use these release units:

| Unit | Purpose | May ship without the next unit? |
|---|---|---|
| BA-01R | Finish the live incident: real launch budget, truthful timeout, bounded snapshot triggers | Yes |
| BA-00A | Automated additive schema deployment | Yes |
| BA-00B | Workload budgets and route-stage metrics | Yes |
| BA-02A | Runner versions and projection store | Yes, dark |
| BA-02B | Shadow projection builders and parity | Yes, dark |
| BA-02C | Bootstrap/calendar/version API | Yes, behind flag |
| BA-02D | iPhone `AppSnapshotStore` foundation | Yes, internal/TestFlight |
| BA-03A | Command receipts and transactional outbox | Yes, dark |
| BA-03B | Per-runner worker and projection publication | Yes, shadow |
| BA-03C | Migrate high-value writes | Incrementally |
| BA-04 | SSE and APNs state-version hints | Yes, with polling fallback |
| BA-05 | Migrate surfaces and delete old freshness paths | Surface by surface |

BA-01R and BA-00A may run at the same time in separate worktrees because their file sets do not overlap. BA-02 starts only after BA-00A is proven in production. BA-03 may begin in dark mode after BA-02A exists.

## Common setup for every unit

1. Fetch `origin/main` and record its SHA.
2. Create an isolated worktree and a `codex/ba-<unit>-<short-name>` branch.
3. Copy the unit from this document into a work packet under `for external review/review-requests/`.
4. List frozen files and active overlapping branches before editing.
5. Capture the relevant before evidence.
6. Implement only the unit's declared files and migrations.
7. Run unit tests, doctrine gates, typecheck/build, and the unit's falsification tests.
8. Commit and push one reviewable head.
9. Submit the exact head SHA to an independent reviewer.
10. If review changes code, create a new head and invalidate the old review.
11. Integrate the exact reviewed SHA.
12. Verify Railway deployed that exact SHA before any client release depends on it.
13. Record after evidence and rollback.

Every unit report begins with a normal-English paragraph: what changed, what the runner will notice, what remains unchanged, and whether the unit met its release gate.

---

## BA-01R: finish the incident

### Goal

Make a normal launch and in-range date navigation bounded on the real shell, stop unnecessary Plan Snapshot rebuilds, return a structured server failure before the phone abandons the request, and stop calling a server timeout “offline.”

### Files in scope

- `native-v2/Faff/Faff/DesignV5/ShellV5.swift`
- `native-v2/Faff/Faff/ViewsV5/HostsV5.swift`
- `native-v2/Faff/Faff/ViewsV5/SurfaceStoreV5.swift`
- `native-v2/Faff/Faff/FaffApp.swift`
- `native-v2/Faff/Faff/API.swift`
- `native-v2/Faff/Faff/PlanSnapshotStore.swift`
- `native-v2/Faff/Faff/Util/ForegroundWork.swift`
- `native-v2/Faff/FaffTests/LaunchOrchestrationTests.swift`
- existing BA-01 test files and source gate
- `web-v2/app/api/v5/today/route.ts`
- `web-v2/app/api/v5/races/route.ts`
- `web-v2/app/api/v5/block/route.ts`
- `web-v2/app/api/v5/plan-snapshot/route.ts`
- `web-v2/lib/route/` for one shared deadline/failure helper
- `web-v2/lib/plan/plan-snapshot.ts`
- `web-v2/lib/race/race-outlook.ts`

### Exact changes

1. Introduce one app-launch coordinator that owns runner-data refresh.
2. Hidden tabs render disk content but do not start a live request. The selected tab can request its owning content through the coordinator.
3. The launch budget is two runner-state reads: Today and Plan Snapshot. Profile/settings may be loaded from their existing disk cache; any required validation must coalesce with later consumers.
4. Replace the current direct-call launch test with a shell-level seam. It must enumerate every launch owner and fail when a hidden host or `FaffApp` adds a network read.
5. Add `reason` to every Plan Snapshot sync attempt: `launch`, `foreground`, `post_import`, `retry`, `mutation`, `manual_refresh`, or `range_miss`.
6. Add a same-version cooldown. A foreground signal without a known plan/fact invalidation cannot rebuild a snapshot that just completed successfully.
7. Retry owns one missing object. It cannot invoke a neighbor, week, hidden tab, or full launch refresh.
8. Add a legacy interactive deadline envelope below the phone's 12-second timeout. Start at 9 seconds for the remaining legacy computation and record the last completed stage. BA-02 projection routes will use the final 2-second hard budget.
9. Deadline checks must be cooperative between expensive phases. Do not add another `Promise.race` that leaves all work running silently.
10. Classify client failure as `timeout`, `transport_unreachable`, `server_unavailable`, `authentication`, `cancelled`, or `decode`. Only real transport reachability loss can set offline state.
11. Preserve valid local content for timeout/server failure without a global banner.
12. Temporarily remove race-outlook recomputation from Plan Snapshot if a prepared last-good value exists; otherwise return an explicit pending/unknown field rather than hold the entire block request.

### Required proof

- Cold shell launch: at most two runner-state requests.
- Hidden Block, Races, and Run hosts: zero live request until selected or specifically invalidated.
- Thirty in-snapshot date taps: zero requests.
- Seven rapid foreground signals without a version-changing event: at most one conditional refresh and no repeated snapshot build.
- Retry: exactly one owning request.
- Every snapshot generation has one recorded reason.
- Server returns its structured deadline envelope before the client timeout.
- A forced server timeout on active networking never renders offline copy.
- Physical build trace shows Today, Block, Races, Plan Snapshot, and Watch within the agreed transitional budgets and no 12-second client timeouts.
- Matching Railway evidence records route stages and pool headroom.

### Exit gate

Do not close BA-01R until the real-device reproduction is green. Passing unit tests alone is insufficient.

### Rollback

One revert returns to build-303 orchestration. No schema changes occur in BA-01R.

---

## BA-00A: automated additive schema deployment

### Why this is first

The historical migration directory contains migrations deliberately not approved for production, including brain tables 166–169, and migration 165 is designed to refuse application. Therefore the deploy command must **not** blindly replay `web-v2/db/migrations/*.sql`.

### New files

- `web-v2/db/deploy-migrations/README.md`
- `web-v2/db/deploy-migrations/manifest.json`
- `web-v2/db/deploy-migrations/001_schema_migrations.sql`
- `web-v2/scripts/migrate-deploy.mjs`
- `web-v2/scripts/migrate-status.mjs`
- `web-v2/lib/db/_deploy_migrations.db.test.ts`
- `web-v2/package.json` scripts: `migrate:deploy`, `migrate:status`, `test:migrations`
- Railway config or service setting for the pre-deploy command

### Migration ledger

Create a new table named `app_schema_migrations`; do not reuse `data_migrations`, which already has a different historical purpose and only two production rows.

```sql
CREATE TABLE IF NOT EXISTS app_schema_migrations (
  migration_id text PRIMARY KEY,
  checksum_sha256 text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  execution_ms integer NOT NULL,
  git_sha text NOT NULL
);
```

### Runner behavior

`migrate-deploy.mjs` must:

1. acquire one PostgreSQL advisory lock dedicated to schema deployment;
2. read only files explicitly listed in `manifest.json`;
3. calculate SHA-256 and refuse if an applied migration's checksum changed;
4. apply each migration in one transaction unless its manifest entry explicitly declares `transaction: false` with a reason;
5. use `lock_timeout` and `statement_timeout` appropriate to the migration;
6. record execution time and `RAILWAY_GIT_COMMIT_SHA`/local Git SHA;
7. exit nonzero on any failure so the application deploy does not proceed;
8. support `--status` and `--dry-run` without mutation;
9. print migration IDs and status, never secrets or connection strings.

### Railway setup

Set the service pre-deploy command to:

```text
cd web-v2 && npm run migrate:deploy
```

Railway documents that pre-deploy commands run between build and deployment, use service variables/private networking, and block deployment on failure: [Railway pre-deploy command](https://docs.railway.com/deployments/pre-deploy-command).

Do not insert migrations 100–171 into the new ledger as if they were all applied. Record one audited production baseline entry that includes the schema fingerprint and the exact baseline SHA. New automated migrations begin in the new directory.

### Proof

- Empty scratch database applies the new series once.
- Second run is a no-op.
- Changed checksum refuses.
- Failed migration rolls back and blocks the simulated deploy.
- Two concurrent runners result in one applier.
- Status identifies pending/applied/drifted.
- Production dry-run reports no mutation.
- First harmless production migration creates only `app_schema_migrations`; status then returns clean.

### Rollback

Disable the pre-deploy command and revert the code. Keep the ledger table; it is harmless and preserves evidence. Schema rollback remains migration-specific and must never be an automatic “down all.”

---

## BA-00B: workload budgets and route-stage metrics

### New modules

- `web-v2/lib/runtime/workload-budget.ts`
- `web-v2/lib/runtime/route-deadline.ts`
- `web-v2/lib/observability/route-stages.ts`
- `web-v2/lib/observability/pool-metrics.ts`
- `web-v2/lib/db/workload-pools.ts` only when callers are migrated deliberately
- tests beside each module

### Initial logical budgets

Keep these environment-configurable. Initial one-instance values are test hypotheses, not permanent physiological constants:

| Workload | Maximum concurrent units in one process |
|---|---:|
| prepared interactive reads | 8 |
| commands/uploads | 4 |
| brain/projection jobs | 1 runner job |
| scheduled/maintenance jobs | 2 jobs |
| external-source fetches | 4 total, with per-source limits |

Do not split the existing global pool blindly. First put permits around background/brain entry points and instrument pool use. When BA-02 projection routes exist, give them a small dedicated read pool and cap the sum of every pool per process. The configured sum must include deployment overlap and any future replica count.

### Standard route measurements

Every target route records:

- trace ID, route, method, app build, and workload class;
- total duration;
- database checkout wait, query count, and database time;
- named stage durations;
- deadline stage;
- response bytes and status;
- current pool total/idle/waiting counts;
- state version and projection kind when applicable.

Do not log health payloads, tokens, raw run data, or other sensitive bodies.

### Exit gate

One dashboard/query must answer which stage made a trace slow. BA-02 work cannot call a read fast merely because the route returned 200.

---

## BA-02A: runner versions and projection store

### Migrations

Allocate the next IDs in `db/deploy-migrations/` after rebasing. The names below are stable even if numeric prefixes move.

#### `runner_state_versions`

```sql
CREATE TABLE runner_state_versions (
  user_uuid uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  state_version bigint NOT NULL DEFAULT 0 CHECK (state_version >= 0),
  facts_version bigint NOT NULL DEFAULT 0,
  evidence_version bigint NOT NULL DEFAULT 0,
  runner_model_version bigint NOT NULL DEFAULT 0,
  plan_version bigint NOT NULL DEFAULT 0,
  readiness_version bigint NOT NULL DEFAULT 0,
  projection_version bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

#### `app_projections`

Use `app_projections`, not `projection_snapshots`, to avoid colliding with the existing VDOT history table.

```sql
CREATE TABLE app_projections (
  user_uuid uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  projection_kind text NOT NULL,
  scope_key text NOT NULL,
  schema_version integer NOT NULL,
  state_version bigint NOT NULL,
  dependency_versions jsonb NOT NULL,
  generated_at timestamptz NOT NULL,
  etag text NOT NULL,
  payload jsonb NOT NULL,
  payload_bytes integer NOT NULL,
  build_ms integer NOT NULL,
  trace_id text NOT NULL,
  PRIMARY KEY (user_uuid, projection_kind, scope_key, schema_version)
);

CREATE INDEX app_projections_version_idx
  ON app_projections (user_uuid, state_version DESC);
```

Constrain `projection_kind` in application code and a database CHECK to:

- `bootstrap`
- `calendar`
- `today`
- `block`
- `races`
- `race_detail`
- `watch_packet`
- `post_run`
- `runner_shell`

### New server modules

- `web-v2/lib/projections/types.ts`
- `web-v2/lib/projections/version-store.ts`
- `web-v2/lib/projections/projection-store.ts`
- `web-v2/lib/projections/etag.ts`
- `web-v2/lib/projections/dependency-map.ts`
- `web-v2/lib/projections/schema/v1.ts`
- tests beside each module

### Transaction rule

Publish projection payloads first inside one transaction, then advance `projection_version` and `state_version` as the last database write in that transaction. A reader must never see a version whose projection rows are not committed.

### Proof

- Monotonic versions under concurrent updates.
- Atomic multi-projection publication.
- Cross-user reads return nothing/unauthorized.
- ETag is stable for identical bytes and changes for changed content.
- Corrupt payload cannot be published.
- Delete/rebuild reproduces the same semantic projection from the same canonical inputs.

---

## BA-02B: shadow projection builders

### New files

- `web-v2/lib/projections/build-runner-shell.ts`
- `web-v2/lib/projections/build-calendar.ts`
- `web-v2/lib/projections/build-today.ts`
- `web-v2/lib/projections/build-block.ts`
- `web-v2/lib/projections/build-races.ts`
- `web-v2/lib/projections/build-watch-packet.ts`
- `web-v2/lib/projections/build-bootstrap.ts`
- `web-v2/lib/projections/build-affected.ts`
- `web-v2/lib/projections/parity.ts`

### Build order

1. `runner_shell`
2. `calendar` for active plan plus 14 days behind and through the active block end
3. `today`
4. `block`
5. `races`
6. `watch_packet`
7. `bootstrap`, assembled only from the preceding projection outputs

### Invalidation map

| Change | Rebuild |
|---|---|
| run accepted/corrected | today, calendar, block, races, post_run, watch_packet, bootstrap |
| health/readiness evidence | today, watch_packet, bootstrap; block only if its visible decision changes |
| accepted plan mutation | calendar, today, block, races, watch_packet, bootstrap |
| race edit/result | races, race_detail, calendar race day, today when relevant, block, bootstrap |
| profile/units/integration state | runner_shell, bootstrap; coaching projections only through their canonical owner invalidation |
| weather/course enrichment | affected day/race detail and bootstrap only when currently visible |
| notification preference | runner_shell only |

This table names projection dependencies. It does not authorize a plan change.

### Shadow rules

- Continue serving legacy routes.
- Build projections after a controlled admin trigger and after selected existing writes, but do not expose them to the phone.
- Compare semantic fields against the current route output for golden runners and David's production-shaped fixture.
- Classify every difference as expected formatting, known legacy defect, or projection defect.
- Never force parity with a legacy result that contradicts doctrine.

### Payload budget

For the initial full-marathon bootstrap fixture:

- compressed response target: at most 350 KB;
- server read target: one projection query, at most three total DB queries;
- JSON decode and structural validation target on the supported iPhone: under 50 ms;
- if day detail breaks the budget, keep compact day cards in bootstrap and fetch one bounded detail projection on demand.

### Exit gate

Seven consecutive days of shadow builds with zero unexplained semantic differences and no cross-user leakage. A reviewer must inspect the builder imports and reject any new coaching calculation.

---

## BA-02C: read API

### Routes

- `GET /api/app/bootstrap`
- `GET /api/app/version`
- `GET /api/app/snapshot?after_version=<n>`
- `GET /api/app/calendar?from=<date>&through=<date>`
- `GET /api/app/projection/<kind>?scope=<key>` only for bounded detail needs

### Response contract

Every successful projection response includes:

- `schema_version`
- `state_version`
- `generated_at`
- `valid_for`
- `dependency_versions`
- `processing.status`
- `processing.pending_command_ids`
- `data`
- `trace_id`
- HTTP `ETag`

`If-None-Match` on an unchanged version returns 304 without rebuilding anything.

### Read-path prohibitions

- no call to a fitness/race/readiness/plan/adaptation resolver;
- no loop over days with one query per day;
- no remote source fetch;
- no write except bounded access telemetry;
- no process-local value required for correctness.

### Deadline

Prepared routes use a 2-second hard server envelope and target p95 under 500 ms. The normal case should be far below that because it is one indexed row read.

### Feature flags

- `APP_PROJECTION_BUILD_ENABLED`
- `APP_PROJECTION_READ_ENABLED`
- `APP_BOOTSTRAP_CLIENT_MIN_BUILD`

All default false until dark-build parity passes.

---

## BA-02D: iPhone snapshot foundation

### New files

- `native-v2/Faff/Faff/AppSnapshot/AppSnapshotEnvelope.swift`
- `native-v2/Faff/Faff/AppSnapshot/AppSnapshotStore.swift`
- `native-v2/Faff/Faff/AppSnapshot/FreshnessAuthority.swift`
- `native-v2/Faff/Faff/AppSnapshot/AppUpdateCoordinator.swift`
- `native-v2/Faff/Faff/AppSnapshot/AppSnapshotDiskStore.swift`
- tests for atomicity, schema compatibility, 304, corrupt payload, cancellation, and cross-screen publication

### Five factual states

- `verifiedCurrent`
- `lastKnown`
- `processing`
- `unavailable`
- `incompatible`

These are internal facts. A view may surface one only when it changes what the runner can trust or do.

### Publication rule

Decode and validate the entire envelope to a temporary value, verify schema/version/integrity, write it atomically to disk, then publish it once to observers. Never merge fields from two state versions.

### Compatibility

The old stores remain active behind a build flag. The new build can fall back to legacy routes if the bootstrap route is unavailable. The server continues supporting the current and immediately previous build for the stated transition window.

---

## BA-03A: receipts and transactional outbox

### Migrations

#### `command_receipts`

```sql
CREATE TABLE command_receipts (
  command_id uuid PRIMARY KEY,
  user_uuid uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  command_type text NOT NULL,
  idempotency_key text NOT NULL,
  source text NOT NULL,
  source_record_id text,
  status text NOT NULL CHECK (status IN ('accepted','applied','duplicate','rejected','failed')),
  input_state_version bigint,
  result_state_version bigint,
  trace_id text NOT NULL,
  accepted_at timestamptz,
  applied_at timestamptz,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_uuid, command_type, idempotency_key)
);
```

#### `outbox_events`

```sql
CREATE TABLE outbox_events (
  event_id uuid PRIMARY KEY,
  user_uuid uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  command_id uuid REFERENCES command_receipts(command_id),
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  payload jsonb NOT NULL,
  trace_id text NOT NULL,
  available_at timestamptz NOT NULL DEFAULT now(),
  attempt_count integer NOT NULL DEFAULT 0,
  leased_by text,
  lease_expires_at timestamptz,
  processed_at timestamptz,
  dead_lettered_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX outbox_claim_idx
  ON outbox_events (available_at, created_at)
  WHERE processed_at IS NULL AND dead_lettered_at IS NULL;

CREATE INDEX outbox_runner_idx
  ON outbox_events (user_uuid, created_at)
  WHERE processed_at IS NULL AND dead_lettered_at IS NULL;
```

#### `device_state_receipts`

```sql
CREATE TABLE device_state_receipts (
  user_uuid uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id_hash text NOT NULL,
  app_build text NOT NULL,
  fetched_state_version bigint,
  displayed_state_version bigint,
  fetched_at timestamptz,
  displayed_at timestamptz,
  PRIMARY KEY (user_uuid, device_id_hash, app_build)
);
```

### New modules

- `web-v2/lib/commands/types.ts`
- `web-v2/lib/commands/accept-command.ts`
- `web-v2/lib/commands/receipt-store.ts`
- `web-v2/lib/outbox/write-event.ts`
- `web-v2/lib/outbox/claim-events.ts`
- `web-v2/app/api/commands/[id]/route.ts`
- `web-v2/app/api/app/displayed-version/route.ts`

### Atomic rule

The canonical fact write, receipt acceptance, and outbox insert occur on the same checked-out client and commit together. If any fails, none commits. Duplicate requests return the original receipt.

### First commands

1. `RecordRunCompletion`
2. `RecordPostRunFeedback`
3. `ImportHealthSummary`
4. `UpdateRace`
5. `RecordRaceResult`
6. `AcceptPlanChange`
7. `RescheduleWorkout`

Do not wrap all 106 write routes at once. Migrate the commands that change coaching/read projections first.

---

## BA-03B: per-runner worker

### New modules

- `web-v2/lib/worker/runner-worker.ts`
- `web-v2/lib/worker/runner-lock.ts`
- `web-v2/lib/worker/coalesce-events.ts`
- `web-v2/lib/worker/process-runner-state.ts`
- `web-v2/lib/worker/retry-policy.ts`
- `web-v2/lib/worker/worker-metrics.ts`
- `web-v2/app/api/internal/worker/tick/route.ts` protected by internal/cron authentication

### Processing algorithm

1. Claim a bounded event batch with `FOR UPDATE SKIP LOCKED` and a lease.
2. Acquire one per-runner advisory lock for state-producing work.
3. Coalesce compatible events but retain every source event ID in lineage.
4. Load canonical facts.
5. Call Activity Interpreter, Evidence Engine, Runner Model, Readiness/Safety, and the owning coaching services in doctrine order.
6. Persist canonical decisions/proposals through their existing owners.
7. Build only affected projections.
8. Publish projections and advance the state version in one transaction.
9. Mark events processed and update receipts with the result version.
10. Release the lease/lock.

On process death, the lease expires and another worker resumes. Every stage is idempotent against command/event IDs and target state version.

### Initial runtime

Run one worker job at a time through the existing Railway service/tick mechanism. This adds no paid service. Prepare a separate start command and service definition, but do not enable a second Railway worker service until measured demand justifies it and David approves the recurring cost.

### Canonical brain migrations 166–169

Do not silently bundle the currently absent `plan_decision_ledger`, `reassessment_schedule`, `plan_decision_outcome`, or `runner_beliefs` migrations into BA-03. They retain their existing approval packets and production-activation gates. The worker must report an honest refused/degraded state while a required canonical store is absent; it must not fabricate a replacement inside projections.

### Proof

- Kill after claim, after brain work, after projection write, and before receipt update; each resumes without loss or duplicate decision.
- Two events for one runner serialize.
- Two runners can progress fairly.
- Ten duplicate Watch/phone completion uploads create one run, one receipt chain, and one resulting state version.
- A failed runner job does not block another runner.
- Opening Today performs no worker/brain computation.

---

## BA-03C: write migration order

For each command:

1. add idempotency key to the client payload;
2. adapt the existing route to call `acceptCommand` inside its fact transaction;
3. return a receipt immediately;
4. build the resulting projection in shadow;
5. compare with the old synchronous result;
6. turn on async processing for internal/TestFlight users;
7. remove synchronous brain work only after the receipt-to-projection SLA is green;
8. retain a feature-flag rollback to the old behavior through the compatibility window.

Migration order:

1. Watch/phone run completion
2. post-run RPE/feedback
3. HealthKit readiness-affecting summaries
4. race edits and results
5. accepted plan changes/proposals
6. reschedules/moves/skips
7. remaining profile/settings writes that invalidate visible state

---

## BA-04: live version delivery

### Server files

- `web-v2/lib/live/broadcaster.ts` interface
- `web-v2/lib/live/process-broadcaster.ts` single-instance implementation
- `web-v2/lib/live/subscription-auth.ts`
- `web-v2/app/api/app/events/route.ts`
- `web-v2/lib/notifications/state-version-hint.ts`

### SSE contract

One authenticated connection per signed-in device:

```json
{
  "type": "state_changed",
  "state_version": 1842,
  "changed": ["today", "calendar", "post_run"],
  "reason": "run_interpreted",
  "trace_id": "..."
}
```

The stream never holds a PostgreSQL connection. It publishes a hint, not a full payload. Missing events are repaired by `GET /api/app/version` or a conditional snapshot fetch.

### APNs contract

Send a coalescible silent hint containing the newest state version only. Record enqueue, APNs acceptance, and later client-observed version. Do not show a visible notification for ordinary cache refresh.

### Client coordinator

SSE, APNs, command receipts, foreground entry, manual refresh, and reconnect all feed one `AppUpdateCoordinator`. It ignores held versions, collapses bursts to the newest version, and performs one fetch.

### Proof

- Ten state changes create one final fetch.
- Lost SSE heals on reconnect.
- Lost APNs heals on foreground.
- One device has one stream regardless of selected tab.
- 5,000 synthetic mostly idle connections do not require a PostgreSQL connection each.
- A Railway restart reconnects cleanly.

The first broadcaster can be process-local because version revalidation supplies correctness. The interface must permit shared pub/sub later without changing the client contract.

---

## BA-05: migrate and delete

### Surface order

1. Today and calendar navigation
2. Block
3. Races and Race Detail
4. post-run
5. Paces, Return to Running, Health, Settings, and remaining active iPhone surfaces
6. Watch packet status

### Per-surface checklist

- render from `AppSnapshotStore`;
- remove screen-owned foreground observer;
- remove screen-owned TTL/freshness policy;
- remove screen-owned offline flag;
- remove screen-owned retry loop and in-flight registry;
- remove duplicate plan-version comparison;
- preserve only presentation state such as selected day or open sheet;
- parity test normal, pending, last-known, unavailable, incompatible, and authentication states;
- instrument legacy route use by app build;
- delete the old server/client path after the compatibility gate.

### Compatibility gate

Support the current and immediately previous supported build. Do not delete an old route until:

- the replacement TestFlight build is device-verified;
- adoption is measured;
- no supported old build requires the route;
- rollback has been tested;
- the minimum supported build decision is recorded.

---

## Railway setup now and later

### Now, no added spend

- one Railway application service;
- one PostgreSQL service;
- pre-deploy migration command;
- current healthcheck `/api/up` extended to report build/schema compatibility without exposing secrets;
- one in-process bounded worker tick;
- one process-local SSE broadcaster with version-recheck correctness;
- no replica increase;
- no new paid cache or queue.

### Prepared but disabled

- a worker start command from the same repository image;
- shared Railway variables for schema version, budgets, and database URL;
- broadcaster interface for future shared pub/sub;
- pool-size formula by workload and replica count;
- synthetic load profiles for 1,000 active runners, 5,000 connections, and a 2,000-runner burst.

Railway can run separate services from one repository and share variables/private networking; replicas can be added later. Those are future capacity controls, not authorization to enable or pay for them now: [Railway services and variables](https://docs.railway.com/variables), [Railway scaling](https://docs.railway.com/deployments/scaling).

### Capacity trigger packet

Before any paid increase, present:

- measured p95/p99 and breach duration;
- pool waiters and checkout latency;
- queue oldest age and depth;
- CPU/memory saturation;
- exact proposed service/replica/tier;
- expected monthly cost;
- expected headroom;
- rollback.

---

## Required operational views

### Runner journey

Input: trace ID or command ID. Output:

- client command;
- receipt status;
- fact ID/version;
- outbox event IDs;
- worker attempts/stages;
- canonical decision/proposal IDs;
- projection/state version;
- SSE/APNs notification;
- device fetched/displayed version.

### Current runner state

- facts/evidence/model/plan/readiness/projection versions;
- projection generation times and ETAGs;
- pending commands/events;
- last worker error;
- last fetched/displayed device versions by app build.

### Load health

- route p50/p95/p99 by workload;
- pool total/idle/waiters and checkout wait;
- query count/database time per request;
- active commands, workers, maintenance jobs;
- queue depth/age/retries/dead letters;
- projection hit rate and payload bytes;
- SSE connections/reconnects;
- foreground-to-current latency.

### Alert thresholds

Start with:

- prepared read p95 over 500 ms for 10 minutes;
- any prepared read over the 2-second server deadline;
- pool waiters above zero for 30 seconds on interactive pool;
- oldest outbox event over 60 seconds during normal operation;
- dead-letter count above zero;
- accepted command without result version after five minutes;
- projection parity mismatch;
- schema/app incompatibility on a supported build;
- state version published but not retrievable.

Tune thresholds from evidence; do not silence a breach by lengthening client timeouts.

---

## Test matrix

### Correctness

- doctrine golden runners;
- goal-poisoning, bad-race, hero-workout, stale-evidence, fatigue, easy-run, and modified-workout cases;
- projection parity for David and golden runners;
- cross-user access attempts for every new route/table;
- race source-of-truth cases;
- plan proposal versus accepted change;
- safety immediate constraint versus non-safety proposal.

### Reliability

- duplicate command;
- worker crash at every commit boundary;
- database timeout;
- slow external source;
- corrupt projection;
- cache/disk incompatibility;
- SSE loss/reconnect;
- APNs loss;
- deploy overlap;
- old client against new server and new client against old/disabled route;
- Watch and phone uploading the same completion.

### Load

- historical device launch/navigation sequence;
- one noisy runner repeatedly foregrounding;
- 1,000 actively interacting runners;
- 5,000 mostly idle SSE connections;
- 2,000-runner burst with imports and brain jobs active;
- background cron during interactive load;
- one slow runner job alongside healthy runners;
- database slowdown and queue backlog.

The scale tests prove the contracts can scale. Production capacity remains sized for current demand.

---

## Release evidence required from every unit

- base/head SHAs;
- changed files and migrations;
- schema compatibility statement;
- feature flags and their production values;
- before/after request count, latency, query count, and pool evidence;
- complete test commands/results;
- independent-review result against the exact SHA;
- deployed Railway SHA;
- TestFlight build when applicable;
- physical-device result when applicable;
- known limitations;
- rollback command/SHA and data implications;
- next unblocked unit already assigned.

## Final completion gate

The programme is complete only when:

- a real launch paints useful cached content immediately;
- one conditional check determines freshness;
- in-range date browsing is local;
- prepared reads do not invoke the brain;
- writes have receipts and durable events;
- state-producing work serializes per runner and is resumable;
- projections publish atomically with monotonic versions;
- an open phone receives version changes without manual refresh;
- missed signals heal automatically;
- timeout is not called offline;
- background work cannot starve interactive reads;
- current and previous app builds have a deliberate transition;
- old freshness/read paths are actually deleted;
- the released SHAs have independent review and physical-device proof;
- no infrastructure spend or Cloudflare work occurred without explicit approval.
