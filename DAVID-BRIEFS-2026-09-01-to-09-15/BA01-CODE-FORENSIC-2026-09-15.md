# BA-01 code forensic after TestFlight build 303

**Code inspected:** `origin/main` at `859393cfd`, containing BA-01 `80995b187`  
**Device evidence:** build 303, approximately 2:53–2:54 PM  
**Conclusion:** BA-01 removed three real redundant paths, but the real application launch still creates a multi-surface fan-out and several target routes still perform read-time brain work that is too expensive for an interactive request.

## 1. Confirmed client cause: the real shell still launches every surface

`ShellV5.swift` keeps Today, Block, Races, and Run mounted simultaneously in one `ZStack`; unselected tabs are hidden with `opacity(0)`, not removed from the hierarchy. Each host has its own `.task`:

- Today loads `/api/v5/today` and starts `/api/v5/plan-snapshot`.
- Block loads `/api/v5/block`.
- Races loads `/api/v5/races`.
- Run loads its Watch workout.
- `FaffApp` independently calls `prefetchAllOnLaunch()`, which loads settings and profile concurrently, then Watch.
- Watch startup has additional Watch-packet callers, coalesced only while requests genuinely overlap.

That is the request set shown on David's build-303 diagnostics screen. BA-01 removed extra calls *inside TodayHostV5*, but it did not change the shell-wide launch fan-out.

### Why the launch test passed anyway

`LaunchOrchestrationTests.testNormalLaunchSchedulesExactlyTwoRunnerDataReads` does not render `ShellV5` or `TodayHostV5`. Its own header discloses that it directly invokes only `API.fetchV5Today()` and `API.fetchPlanSnapshotRaw()`, then asserts the total is two.

The source-level gate scans Today's `.task` only. Neither gate can fail when Block, Races, Run, `FaffApp`, or Watch startup adds requests alongside Today. The test proved the two calls it manually selected each hit the wire once; it did not prove a real app launch schedules only two reads.

This is a confirmed coverage defect and a confirmed remaining launch-demand source.

## 2. Confirmed server cause: interactive routes still recompute too much

The server routes are not prepared reads:

- `/api/v5/today` documents roughly 35–40 database round trips and still builds a large live narrative on every request.
- `/api/v5/races` performs a long sequence of runner-state, goal, fitness, race-outlook, trend, evidence, injury, weather/course, and coach-log reads.
- `/api/v5/block` calls `loadTrainingState` and then builds library, scenario, proposal, and thesis content.
- `/api/v5/plan-snapshot` documents approximately **329 `pool.query` calls per request** even after earlier optimization.

The snapshot loader also resolves projections for every race in the active block. Its own measurements show whole-snapshot loads between roughly 2 and 5.4 seconds under prior testing, before the simultaneous launch demand seen on build 303.

This directly contradicts the target architecture's rule that screen reads should retrieve one prepared projection rather than rerun the brain.

## 3. Confirmed shared hotspot: race-outlook computation

Both Plan Snapshot and Races invoke `resolveRaceOutlookBySlug()` and the expensive race-independent read bundle in `race-outlook.ts`.

Plan Snapshot wraps each outlook in `withDeadline(..., 8_000)`, implemented with `Promise.race`. That deadline returns a timeout result but does **not cancel the underlying promise or its database work**. After the snapshot response gives up on an outlook, the computation can continue consuming CPU and database work.

The in-process `userReadsInFlight` map coalesces concurrent calls for one runner/day, but it deletes the entry when the work settles and provides no durable prepared result. A later foreground, Retry, plan mutation, or launch recomputes the bundle.

Production evidence strengthens this lead:

- post-BA-01 failures contain no `DATABASE_POOL` event for the device window;
- a Races client report lasted approximately 184 seconds;
- Railway logs repeatedly report Plan Snapshot race-outlook deadline expirations for all four calendar races, followed by last-known-good fallback.

This does not prove one function explains every slow route, but it is a confirmed common expensive path for the two most visibly broken race-related reads.

## 4. Snapshot generation 7 is explainable, but still wrong operationally

`syncPlanSnapshot()` has five independent triggers: launch, foreground, explicit Retry, pull-to-refresh, and plan mutation/completion notification. The new single-flight guard coalesces callers only while one request is currently in flight. Sequential triggers after a request settles start another full snapshot build.

`PlanSnapshotStore.syncGeneration` increments on every successful commit and every failed fetch/commit. Therefore generation 7 does not by itself prove seven simultaneous requests or an automatic retry loop. It does prove this app process attempted or committed the full snapshot repeatedly.

Because each snapshot can invoke hundreds of queries and non-cancelled race-outlook work, sequential generation churn is expensive even when overlap is prevented.

The diagnostics should record a reason for every generation (`launch`, `foreground`, `post_import`, `retry`, `mutation`, `manual_refresh`) so the next trace identifies the trigger rather than only the count.

## 5. Confirmed presentation bug: timeout becomes “offline”

`API.authedSend` distinguishes a timeout only for diagnostics. For any non-cancellation transport error, including `.timedOut`, it posts `.faffReachabilityLost`. `TodayHostV5` then sets `isOffline = true` and can render “isn't available offline.”

The device can therefore have active 5G and receive offline copy merely because a server request exceeded 12 seconds. The screenshot is consistent with the code. This is separate from making the request fast and should be corrected so timeout, server unavailable, and genuine network loss remain different facts.

## Corrective sequence

1. Replace the direct-call launch test with a real shell-level orchestration seam that enumerates every launch owner and fails if the total exceeds the intended budget.
2. Stop hidden Block, Races, and Run tabs from launching live network reads. Paint them from disk cache; refresh the selected tab on selection through one app-level coordinator.
3. Remove the independent `prefetchAllOnLaunch()` network path once the coordinator owns settings/profile/Watch bootstrap.
4. Add a reason to every Plan Snapshot sync request and enforce cooldown/version invalidation so sequential triggers without a state change do not rebuild the same block.
5. Remove race-outlook computation from Plan Snapshot and Races interactive reads. Publish it once as a versioned projection when evidence, plan, race, or execution state changes.
6. Until BA-02 lands, add a bounded prepared/last-good race projection read that performs no live brain recomputation on the screen path.
7. Make the server deadline envelope cancellation-aware where possible. A response deadline that leaves the expensive work running is load shedding in appearance only.
8. Stop mapping server timeout to offline. Preserve last valid content and record `timeout` as its own diagnostic state.
9. Repeat the physical-device trace with per-generation reasons, full launch-owner counts, route-stage timing, and matching server telemetry.

## Relationship to the master plan

These findings reinforce the existing sequence rather than replacing it:

- BA-01 still needs a real bounded launch coordinator and truthful failure behavior.
- BA-02's prepared, versioned snapshots are required to make the reads fast.
- BA-03 is required to remove race/fitness/brain computation from screen requests.
- BA-04 and BA-05 are required to replace the many screen-owned refresh triggers with one version-driven update path.

No Cloudflare work or paid capacity increase is indicated by this investigation.
