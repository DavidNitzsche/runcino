# Faff live-data architecture — ASAP implementation sequence

**Status:** execution-ready sequence  
**Date:** 2026-09-15  
**Governing brief:** [BACKEND-DATA-BRAIN-APP-ARCHITECTURE-BRIEF.md](./BACKEND-DATA-BRAIN-APP-ARCHITECTURE-BRIEF.md)  
**Hosting:** Railway only. Cloudflare is out of scope.  
**Capacity posture:** build contracts that can scale; keep production resources at current-demand levels until David separately approves a cost increase.

> **Post-audit control, 2026-09-15:** this first-pass sequence remains the
> architectural outline. The whole-backend audit found a required migration
> foundation and additional BA-01 work. Use
> [WHOLE-BACKEND-MASTER-PLAN-AUDIT-2026-09-15.md](./WHOLE-BACKEND-MASTER-PLAN-AUDIT-2026-09-15.md)
> and
> [BACKEND-IMPLEMENTATION-SCOPE-AND-SETUP-2026-09-15.md](./BACKEND-IMPLEMENTATION-SCOPE-AND-SETUP-2026-09-15.md)
> as the executable sequence. They add BA-00, name BA-01R, and divide BA-02
> through BA-05 into reviewable releases.

## The fastest safe route

Do not wait for the entire target architecture before fixing the live experience. The original outline used five release units:

1. **BA-01 — stop the request storm:** use the whole-block snapshot that already exists and remove the redundant 21-day/four-week fetch burst.
2. **BA-02 — make reads prepared and versioned:** persist screen-ready snapshots, add one bootstrap response, and revalidate by version/ETag.
3. **BA-03 — move the brain off screen reads:** facts create durable work; the brain and projections update after facts change.
4. **BA-04 — push live versions:** one Railway-hosted foreground update stream plus coalesced silent APNs hints.
5. **BA-05 — remove the old client freshness machinery:** migrate each surface, support one old app-version window, then delete the old paths.

BA-01 is the emergency release. BA-02 through BA-05 complete the architecture. Do not combine all five into one unreviewable branch.

## Programme-lead actions before coding

1. Assign one code owner and one independent reviewer to BA-01.
2. Create an isolated worktree from the exact current `origin/main`; do not implement from `audit/brain-forensic-2026-09-10` or the shared dirty checkout.
3. Record the base SHA in the work packet.
4. Freeze overlapping changes to these files until BA-01 is integrated:
   - `native-v2/Faff/Faff/ViewsV5/HostsV5.swift`
   - `native-v2/Faff/Faff/API.swift`
   - `native-v2/Faff/Faff/FaffApp.swift`
   - `native-v2/Faff/Faff/PlanSnapshotStore.swift`
   - `web-v2/app/api/v5/plan-snapshot/route.ts`
   - `web-v2/lib/plan/plan-snapshot.ts`
5. Capture one baseline Request Diagnostics trace for:
   - cold launch;
   - background then foreground;
   - seven date taps across past and future days;
   - one pull to refresh;
   - one failed request followed by Retry.
6. Record total requests, endpoint counts, maximum simultaneous requests, server p95, database checkout wait, and peak pool use. This is the before evidence.

## BA-01 — stop the request storm

### Existing asset to use

`GET /api/v5/plan-snapshot` and `PlanSnapshotStore` already provide the runner's complete active block as one atomic, disk-backed object. Current navigation already renders covered non-today dates from that snapshot with zero network calls.

The remaining contradiction is in `TodayHostV5` launch behavior: after loading Today and starting the whole-block snapshot sync, it still invokes `prefetchAround`, which requests up to 21 individual dates and launches four overlapping week requests. It also refreshes Block from the Today host. Separately, `FaffApp` calls `prefetchAllOnLaunch`, which warms seven endpoints before the screen-owned loads run.

### Exact code changes

1. In `native-v2/Faff/Faff/ViewsV5/HostsV5.swift`, change the `TodayHostV5` launch `.task` so it performs only:
   - synchronous `PlanSnapshotStore.shared.loadFromDiskSynchronously()`;
   - existing disk seed needed for the current Today payload during migration;
   - one `surface.load()` for live Today;
   - one single-flight `syncPlanSnapshot()` in the background;
   - the surface-ready signal.
2. Remove the launch calls to:
   - `prefetchAround(m.dateISO)`;
   - `fetchAndCacheWeek(anchoredOn: m.dateISO)`;
   - `blockSurface.load()` from the Today host.
3. Keep the existing zero-network `goTo` path for any date covered by `PlanSnapshotStore.current`.
4. For a date outside the snapshot, fetch one bounded fallback only. Do not prefetch neighboring days or weeks from that action.
5. Change Retry so it retries only the missing owning object:
   - Today failure retries Today;
   - snapshot failure retries the snapshot;
   - an uncovered selected date requests one fallback date or one range;
   - Retry never invokes `prefetchAround`.
6. In `native-v2/Faff/Faff/FaffApp.swift` and `API.swift`, replace `prefetchAllOnLaunch()` with a bounded launch coordinator:
   - do not prefetch Today, Block, or Races when their stores already have valid disk content and their hosts own foreground refresh;
   - keep only data that is truly required before first interaction, such as settings/profile needed for units or identity, and the Watch packet when Watch sync requires it;
   - cap the coordinator at two simultaneous network operations;
   - coalesce an endpoint already requested by a surface rather than issue a sibling request.
7. Do not broadly parallelize the 35–40 reads inside `/api/v5/today` as the quick fix. That can trade latency for more simultaneous database connections and recreate the saturation by another route.
   - Preserve reviewed F164 (`a70bce72a`), which parallelizes two bounded, independently verified groups. It is valid latency work, but it is not the incident fix.
   - Do not merge F164 by itself while the launch burst is still live. Land BA-01's client request-shape fix first, then merge the exact reviewed F164 SHA in the same integration wave or immediately afterward.
   - Re-run the physical-device and pool-headroom checks against the combined BA-01 + F164 state. If peak database pressure regresses, remove F164 without backing out BA-01.
   - Keep the seven additional candidate groups out of this release. They require later measurement against the prepared read-model direction.
8. Keep the already-landed `outage()` durable-recording fix from `origin/main`; verify it rather than rebuilding it.
9. Add one server deadline envelope so an interactive route returns a structured failure before the phone's deadline. For BA-01, set the server budget below the existing 12-second client timeout and record the exact timeout stage. Do not lengthen the phone timeout to hide the issue.

### Required validation gates

There are **six BA-01-specific gates**, followed by the existing regression suite:

1. A launch-orchestration test proves a normal Today launch schedules no more than two runner-data reads: Today and plan snapshot.
2. A navigation test walks at least 30 dates inside a snapshot and proves zero network calls.
3. A Retry test proves exactly one owning request and no neighbor/week prefetch.
4. A foreground test proves duplicate foreground signals coalesce while a post-import signal still produces one required refresh.
5. A cancellation test proves fast date navigation does not create an outage state or retry burst.
6. A source-level gate rejects reintroduction of `prefetchAround` or overlapping week fetches into Today launch/retry paths.

Then run the existing PlanSnapshot validation, account isolation, disk atomicity, Today navigation, Watch, client-contract, build, and full native regression suites. Existing tests remaining green is mandatory release evidence; it is not a seventh missing BA-01-specific test to invent.

### BA-01 merge and release gate

The code agent must provide:

- exact base and head SHAs;
- changed-file list;
- request-count proof before and after;
- test commands and complete results;
- known limitations;
- rollback SHA.

The independent reviewer must falsify the launch, navigation, Retry, foreground, and cancellation claims against the exact head SHA. Any new commit invalidates that review.

After review:

1. integrate the exact reviewed SHA;
2. deploy the Railway backend if server code changed;
3. confirm the deployed backend SHA;
4. ship the corresponding TestFlight build;
5. repeat the baseline sequence on David's device;
6. query Railway and durable request telemetry for the same trace window.

BA-01 is complete only when ordinary launch/date browsing creates no request burst and the database pool retains headroom on the physical-device reproduction.

## BA-02 — persist one prepared app snapshot

### Database migrations

Create migrations under `web-v2/db/migrations/` for:

1. `runner_state_versions`
   - `user_uuid` primary key;
   - monotonic `state_version`;
   - component versions for facts, evidence, runner model, plan, readiness, and projections;
   - `updated_at`.
2. `app_snapshots`
   - `user_uuid`;
   - `snapshot_kind` (`bootstrap`, `calendar`, `today`, `block`, `races`, `watch`, `post_run`);
   - `scope_key` for a date range or named singleton;
   - `state_version` and dependency versions;
   - `schema_version`;
   - `generated_at`;
   - `etag`;
   - `payload jsonb`;
   - composite unique key on runner, kind, scope, and schema version.
3. Add indexes for the exact read keys. Do not add a generic table scan or cross-user cache key.

These rows are rebuildable projections. Existing facts, evidence, decisions, and plans remain canonical.

### Server modules

Create one bounded projection subsystem, with names adjusted to repository convention:

- `web-v2/lib/projections/version.ts` — increment/read runner versions;
- `web-v2/lib/projections/store.ts` — atomic projection read/write;
- `web-v2/lib/projections/build-bootstrap.ts`;
- `web-v2/lib/projections/build-calendar.ts`;
- `web-v2/lib/projections/build-today.ts`;
- `web-v2/lib/projections/dependencies.ts` — explicit invalidation map;
- tests alongside each module.

Projection builders call canonical owners and copy their outputs. They may not contain new fitness, readiness, pace, race, adaptation, or plan decisions.

### Read API

Add:

- `GET /api/app/bootstrap` — Today, block header, runner shell, and a useful calendar range;
- `GET /api/app/snapshot?after_version=` — returns current snapshot/delta or `304`;
- `GET /api/app/calendar?from=&through=` — one bounded range when navigation leaves the local block.

Every response carries schema version, state version, dependency versions, generation time, ETag, processing state, and trace ID.

Read routes may perform no coaching recomputation. Their initial budget is at most three database queries, with a target of one projection query.

### Client migration foundation

Create one shared `AppSnapshotStore`/`FreshnessAuthority`:

1. load and validate the last snapshot synchronously from disk;
2. publish it to every observing screen;
3. send one conditional version request;
4. atomically replace local state only after complete decode and validation;
5. expose the five factual states from the governing brief: verified current, last known, processing, unavailable, incompatible;
6. do not display those internal states unless they change what the runner should understand or do.

### BA-02 proof

- cold launch paints cached useful content without network delay;
- unchanged foreground receives `304` or an equivalent tiny response;
- plan browsing performs zero network calls inside the held range;
- hot read p95 is below 500 ms under the agreed test load;
- hot screen reads make no more than three database queries;
- projection parity holds for golden runners and David's current production-shaped fixture;
- no user can retrieve another user's projection.

## BA-03 — move brain work off the read path

### Durable lifecycle tables

Create:

1. `command_receipts` — command ID, user, idempotency key, type, status, accepted/result versions, trace ID, timestamps, and failure/refusal detail.
2. `outbox_events` — event ID, user, type, source command/fact, payload/version, availability time, attempts, lease, processed time, and dead-letter state.

Every relevant fact-writing transaction writes its outbox event before commit. Repeated client writes return the original receipt.

### Processing loop

Use the existing Railway application and scheduler first, under a strict worker concurrency budget, so this stage does not require added infrastructure spending.

1. Claim work with a durable lease.
2. Permit one state-producing job per runner.
3. Coalesce compatible pending events for that runner.
4. Run Activity Interpreter → Evidence Engine → Runner Model/Readiness/Safety → owning coaching services.
5. Record canonical decisions and accepted/proposed status.
6. Build affected projections.
7. Advance the runner's state version and commit outputs.
8. Mark events processed only after output commits.
9. Retry bounded transient failures with jitter; expose permanent failure/dead-letter state.

Do not start a second paid Railway worker service yet. Prepare the code so it can move into one later. The programme lead must bring any recurring-cost increase to David before enabling it.

### Write endpoints

Migrate writes in this order:

1. Watch/phone run completion;
2. runner post-run feedback;
3. HealthKit summaries that affect Today/readiness;
4. race edits and results;
5. accepted plan changes and reschedules;
6. remaining settings and background enrichment.

Each returns a receipt immediately. The app can show “saved; coaching update in progress” only where that fact helps. It never guesses that the resulting plan already changed.

### BA-03 proof

- opening Today executes no brain computation;
- a completion advances fact, evidence, state, and projection versions in order;
- a killed worker resumes without duplicate decisions or lost work;
- duplicate completion uploads result in one canonical run and one receipt chain;
- a burst from one runner cannot block another runner's read;
- every lifecycle stage is queryable by one trace ID.

## BA-04 — Railway-hosted live updates

### Foreground stream

Add one authenticated endpoint, for example `GET /api/app/events`, using SSE on the existing Railway service.

Rules:

- one stream per signed-in device, never per screen;
- authenticate before opening and revalidate on reconnect;
- send only state version, changed projection keys, reason, and trace ID;
- do not hold a database connection for the life of the stream;
- heartbeat only as needed to detect a dead transport;
- coalesce rapid changes and advertise only the newest usable version;
- on disconnect, the phone reconnects with bounded backoff and performs one conditional version check;
- correctness never depends on receiving every event.

With one Railway instance, a process-local broadcaster can deliver the hint because missed events are repaired by the version check. Define a broadcaster interface now so a later multi-instance implementation can use shared pub/sub without changing the iPhone contract.

### Background push

Extend the existing APNs system to send a coalescible silent `state_version` hint after a new projection publishes.

- one pending hint per runner/device;
- no full training payload in the notification;
- no visible alert for ordinary cache refresh;
- foreground/version checking remains the fallback because iOS may delay or drop background delivery;
- record sent, accepted-by-APNs, and client-observed versions.

### Client update coordinator

1. Own the SSE connection at app/session scope.
2. Feed SSE, APNs, command receipts, foreground entry, and manual refresh into one coordinator.
3. Ignore versions already held.
4. Collapse several incoming versions to the newest one.
5. Make one snapshot/delta request.
6. Atomically publish it to all screens.
7. Never allow a screen to launch its own reaction fetch.

### BA-04 proof

- a server-side test update appears on an open phone without pull-to-refresh;
- ten rapid source updates produce one coherent client fetch of the final version;
- a dropped SSE event is repaired on reconnect;
- a dropped APNs notification is repaired on foreground;
- one active device creates one live connection regardless of tabs visited;
- the stream creates no persistent PostgreSQL checkout;
- live updates do not change the BA-01/BA-02 request and latency budgets.

## BA-05 — migrate surfaces and delete duplicate freshness logic

Migrate in this order:

1. Today and date navigation;
2. Block;
3. Races and race detail;
4. post-run experience;
5. Paces, Return to Running, Settings, and remaining active iPhone surfaces;
6. Watch packet status.

For each surface:

1. render from `AppSnapshotStore`;
2. remove its screen-owned foreground listener, TTL, offline flag, retry policy, in-flight registry, and plan-version comparison;
3. keep only presentation state such as selected date or open sheet;
4. run parity and failure tests;
5. delete the old route/cache path after the compatibility window.

Support the current and immediately previous app build during one explicit transition window. Instrument old-route use by app version. Once the replacement build is available, device-verified, and adopted, set the minimum supported version deliberately and remove the old server/client path. Do not maintain both architectures indefinitely.

## Production resource policy

No implementation unit above authorizes:

- another Railway replica;
- a larger Railway/PostgreSQL tier;
- a paid Redis/cache service;
- a separate paid worker deployment;
- Cloudflare or another provider;
- any other recurring infrastructure increase.

The architecture and synthetic tests target 1,000 concurrently active runners, 5,000 connected devices, and a 2,000-runner burst. Production stays right-sized for current demand. When metrics justify a capacity increase, the programme lead presents the measured threshold, proposed change, monthly cost, expected headroom, and rollback to David for approval.

## Daily programme control until this is complete

The programme lead maintains one row per BA unit with:

- owner;
- exact branch and base/head SHA;
- current step;
- next step;
- reviewer;
- blocker;
- last real evidence;
- deploy/TestFlight status;
- device-verification status.

No owner stops after reporting. If the next step is unblocked, they begin it. The lead checks active work at least hourly, reassigns idle unblocked work, and never advances a unit on prose alone.

## Definition of complete

The architecture is up and running only when all of these are true:

- the physical-device request storm is gone;
- Today and in-range dates paint instantly from a valid local snapshot;
- the server prepares screen reads instead of recomputing the brain on open;
- writes have durable receipts and drive versioned projections;
- an open phone receives new versions without manual refresh;
- missed live/background signals self-heal through one version check;
- one shared client authority owns cache, freshness, retry, and update coalescing;
- interactive traffic retains database headroom while background work runs;
- old clients have a deliberate transition path;
- no new infrastructure spend has occurred without David's approval;
- independent review and real-device evidence cover the exact released SHAs.
