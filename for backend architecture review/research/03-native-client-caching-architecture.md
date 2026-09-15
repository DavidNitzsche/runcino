# Faff iPhone client freshness/caching architecture

**Source:** background research sub-agent, dispatched 2026-09-15, as part of F159's research phase. Investigated on branch `audit/brain-forensic-2026-09-10` at a fresh clone.

**Base branch caveat, important:** this sub-agent found that the F152 fix (Retry no-op, `goTo(date, force: true)`) does NOT appear present in the code it read — `goTo` still has the bare unconditional guard with no `force:` bypass. **This does NOT mean F152 wasn't really fixed** — it's independently confirmed merged to `main` and externally re-verified. This sub-agent's clone was very likely based on this session's own documentation branch rather than `main`, where the actual native fixes land. Re-verify against `main` before trusting any specific-fix-presence claim below; the architectural/pattern findings below are not affected by this caveat (they describe the general shape of the code, present regardless of which specific patch commit is or isn't in a given checkout).

All line numbers refer to files under `native-v2/Faff/Faff/`.

---

## 1. Independent freshness/staleness/offline state

The client does not have one cache — it has at least **nine independently-owned freshness mechanisms**, several of which the codebase's own comments admit were discovered piecemeal and are still not unified. Enumerated with write/invalidate triggers:

**a. `V5Surface<Model>` (`ViewsV5/SurfaceStoreV5.swift:41-358`)** — one instance per surface (Today/Block/Races/Paces/Return/RaceDetail, `V5Surfaces` factory at line 670). State: `model`, `stale`, `absentReason`, `refreshing`, `cachedAt`.
- Write: `load()` success sets `model`/clears `stale`/sets `cachedAt = Date()` (line 292-300). `presentSync` re-reads `cachedAt` from `AppCache.writtenAt` (line 208).
- Invalidate `stale`: only on next successful/absent `load()`. A failed load does **not** set `stale` immediately — `markStaleAfterDebounce()` (line 349) waits 1.2s and checks a `staleAttemptGeneration` counter (a race-guarding piece of state itself), so a load that succeeds inside that window silently cancels the pending "stale" flip.
- **Already-documented instance of the exact bug shape asked about**: `CACHEDAT-1` (lines 66-77) — `cachedAt` used to be a `let` set once at `init` and never re-read, so the "showing what you had ___ ago" banner reported the age of the very first disk read for the surface's entire lifetime regardless of how many successful refreshes had landed since. Fixed by making it re-readable — a second confirmed instance of "flag never gets refreshed in the right place," same family as `isOffline`.

**b. `AppCache` (`AppCache.swift`)** — disk (`UserDefaults`)-backed, two different staleness policies live side by side in the same type:
- Fixed `Key` slots (today/block/races/etc.): `maxAgeSec = 12h` (line 145), checked in `fresh(_:now:)` (line 147), gates `read()` (line 124-127). Missing timestamp = treated as expired, not trusted (line 148-150) — a real Rule-11-correct fix, documented at lines 129-144 as a prior bug: a cache with no age check rendered yesterday's session as today's.
- Dynamic per-date keys (`v5.day.*`, `v5.week.*`): **deliberately no wall-clock TTL at all** (comment lines 173-181) — validity delegated entirely to plan-version comparison done by the caller (`reconcileDayCache`). A second, structurally different freshness policy inside the same type, justified in the comment but still a second definition of "is this data current" a reader has to know to look up correctly.
- Retention (LRU eviction, capped at 60 days / 20 weeks, lines 200-252) is a third, explicitly-distinguished concept ("is this worth keeping" vs "is this true") layered on top.

**c. `TodayHostV5`'s own local caches (`ViewsV5/HostsV5.swift`)** — a fourth layer, in-memory, on top of (a) and (b):
- `dayCache: [String: V5Today]` (line 779), `weekCache: [String: PlanWeek]` (line 1189), `lastKnownPlanVersion`, `planStartISO`/`planEndISO` (line 1202-1203).
- Invalidation: `reconcileDayCache`/`reconciledDayCache` (lines 1323-1356) — drops the **entire** `dayCache` when `planVersion` (a whole-plan identity, `id:last_adapted_at`) changes, or drops individual entries when a cached day's own `plan_workout_id` no longer matches. Careful, well-reasoned code (explicitly designed around a real gap: an in-place pace re-anchor rewrites a workout row under the same id, so per-row diffing alone would miss it) — but a **third distinct staleness algorithm**, none of it shared with (a) or (b).

**d. `isOffline` (`HostsV5.swift:1241`)** — the flag named in the original bug report. Doc comment (lines 1233-1240) is explicit about its own limits: "best-effort, local-only... never authoritative." Set on `.faffReachabilityLost` (line 790), cleared **only** when `surface.model?.dateISO` changes (line 767-785, `onChange` handler) — only when *this* surface's own day payload lands, not on any other evidence the network recovered (a successful Block/Races fetch, a successful write, a successful watch sync would none of them clear it). Architecturally guaranteed by design, not a one-off slip — nothing else in the file clears it.

**e. `DayFetchCoordinator.inFlight` (`HostsV5.swift:56-114`)** and **f. `weekFetchInFlight: Set<String>` (`HostsV5.swift:1194`, guard at 1277-1279)** — two separate per-date in-flight dedup tables, one for single-day prefetch fan-out, one for week-summary fetch. Both clear via `defer` **on completion**, not on any time basis — two *sequential* calls past the in-flight window each proceed as fresh requests. Architecturally identical in shape to `V5RequestCoalescer` below; no shared implementation.

**g. `PlanSnapshotStore` (`PlanSnapshotStore.swift`)** — a fifth, file-backed (not `UserDefaults`) store: `current`, `lastSuccessfulSyncAt`, `lastError`, `syncState` (idle/syncing/failed), `syncGeneration`. **No TTL or age check anywhere** — `lastSuccessfulSyncAt` is written (line 137) but read only by `RequestDiagnosticsView.swift` (diagnostics-only) and `HostsV5.swift` (for a UI label, not a staleness decision). Freshness entirely event-triggered (launch, foreground, explicit Retry, plan mutation, completion sync) with no fallback "this is now too old, force a resync" path.

**h. `StuckConnectionMonitor` (`API.swift:41-127`, actor)** — a rolling-window (90s / 3-signal threshold) connection-health tracker, independent of everything above, answering "is the connection *pool* dead" rather than "is the data stale." Its own header (lines 44-82) documents the *first* version of this exact mechanism was broken in three distinct ways (a success on any pooled connection cleared a streak that belonged to a different broken connection; only `.timedOut` counted when `.networkConnectionLost` was equally common; "consecutive" was measured across concurrent, not sequential, requests) — a second documented case of "a flag/guard that looked correct in isolation and had a real gap," found and rewritten once already (`STUCKCONN-2`).

**i. `SettingsCache` (`Util/SettingsCache.swift`, actor)** — process-lifetime cache with **no TTL at all**: `if settings != nil { return }` (line 99) — once populated, never re-fetched for the rest of the process unless a PATCH path explicitly calls `invalidate()` (line 141-144). A settings change made on web mid-session would never be picked up by the phone without an explicit local edit.

**j. `V5RequestCoalescer` (`DesignV5/APIV5.swift:3037-3060`, actor)** — URL-keyed in-flight GET dedup, the "canonical" single-flight mechanism. Its own surrounding comment (`WATCH-TODAY-SINGLEFLIGHT-1`, lines 1904-1946) is the most directly relevant evidence in the whole codebase for this investigation: it documents that an **independent review found six separate ad-hoc single-flight mechanisms already existing side by side** — `V5RequestCoalescer`, two `SettingsCache` slots, `DayFetchCoordinator.inFlight`, `PLANSNAPSHOT-SINGLEFLIGHT-1`, and a since-deleted `WatchTodayGate` — all answering the same underlying question ("may two concurrent identical GETs share one transport call") with separately-written, separately-tested logic. One was deleted and consolidated; the others remain separate.

---

## 2. Refetch triggers and fan-out

| Trigger | Where | Scope fetched |
|---|---|---|
| View first appears (`.task`) | `TodayHostV5.body` (`HostsV5.swift:724-760`) | Disk seed (~14 days + 2-3 weeks from disk only) → `surface.load()` (today) → un-awaited `syncPlanSnapshot()` (whole block) → un-awaited `blockSurface.load()` → `prefetchAround(today)` + `fetchAndCacheWeek(today)` |
| Any navigation (`goTo`, day tap, week-strip swipe, "Today") | `goTo` (`HostsV5.swift:1447-1543`) | The tapped day itself (cache hit or 1 network read) + unconditionally, at the end, `Task { await prefetchAround(iso) }` |
| `prefetchAround(iso)` | `HostsV5.swift:1757-1830` | Visible week (≤7 days) + 7 days before + 7 days after = **21 days** of day-level prefetch (deduped/bounded via `DayFetchCoordinator`, `maxConcurrent: Int = 6`) plus, run alongside it, 4 week-summary fetches via `fetchAndCacheWeek`: visible week, previous week, next week, and (`PRELOAD-1`) the week after that — 4 concurrent `GET /api/plan/week` calls |
| Retry on a failed/offline day-pending card | `retryPending(date)` → `goTo(date,...)` (`HostsV5.swift:420-428`) | Once F152's `force:` bypass is present: identical to the full navigation fan-out row above — 1 day fetch + the 21-day prefetch + the 4 week fetches, every tap, since the in-flight guards clear on completion, not on a cooldown, so sequential retries spaced past each other's ~12s timeout each re-trigger the full fan-out |
| Pull-to-refresh | `.refreshable { await surface.load(); await syncPlanSnapshot() }` (`HostsV5.swift:797`) | This surface only (today) + whole-block snapshot |
| App foreground | `FaffApp.swift:400-455` | Posts `.faffForegroundRefresh` twice (deliberate). Every `V5Surface` throttled to once per 3s. `v5ReloadOnForeground` modifier also 3s-throttled, drives `syncPlanSnapshot()`. `WatchSync.shared.refresh()` (60s throttle, `force:` bypass available) also fires here. |
| Plan mutation | `.faffPlanMutated` posted from several call sites → `HostsV5.swift:794-796` | Whole-block snapshot resync only |
| Tab re-select | `.faffTabReselected` (`HostsV5.swift:679-683`) | Local nav only, no network unless target day isn't cached |
| Background app refresh (`BGTaskScheduler`) | **Not found anywhere in the codebase** — zero matches. All "background" behavior is foreground-transition-triggered, not OS background refresh. |
| Watch sync completion / reachability | `WatchSync.swift` (`refresh(force:)`, 60s throttle with explicit force override) | Watch-facing endpoints only, separate from the V5 surfaces above |

**Fan-out concentration**: `TodayHostV5` is by far the most complex host (spans lines 168–2303 of a 4471-line file). `BlockHostV5`/`RacesHostV5` are ~70-140 lines each with essentially none of this machinery — their Retry is a bare `Task { await API.resetConnectionPool(); await surface.load() }`, no day-cache, no prefetch fan-out. All the complexity above is concentrated in the one surface that does per-day navigation.

---

## 3. Other instances of the same bug shape

**Already-fixed instances of the identical shape, documented in the code's own comments** (confirming this bug family has fired more than the 3 named in the original bug report):

1. **`REQUESTSTORM-2` / `ForegroundWork.swift:1-40`** — a throttle written to throttle the expensive HealthKit import sat, via early-`return` ordering, above the `.faffForegroundRefresh` post every surface depends on — foregrounding within 30s of the last foreground silently skipped **all** surface refreshes. Structurally the same defect class as the same-date guard: a guard scoped for reason A silently gated behavior B that needed to always run.
2. **`CANCELBANNER-1`/`CANCELBANNER-2` (`API.swift:362-383`, `SurfaceStoreV5.swift:311-338`)** — cancellation errors arrive as *either* `CancellationError` or `URLError(.cancelled)` depending on OS/SDK, one call site checked only one form, so every navigation-cancelled request (routine, happens on every fast swipe) was misread as a real failure and triggered the full outage UI.
3. **`WATCH-TODAY-SINGLEFLIGHT-1` (`API.swift:1904-1946`)** — three independent cold-launch call sites each fired `/api/watch/today` with no shared dedup. "No guard existed where one was needed" — same underlying failure mode (independent local decision-making instead of one shared mechanism).
4. **`STUCKCONN-1`→`STUCKCONN-2` (`API.swift:44-82`)** — the first version of the connection-health detector couldn't fire in the exact scenario it was built for, three compounding reasons.
5. **`SETTINGSCANCEL-1` (`SettingsCache.swift:63-77`)** — the original piggyback-on-in-flight-task logic returned without applying the result, a genuine race distinct from but adjacent to the others.
6. **Rule 20 correction inside `TokenStore.swift:75-90`** — a doc comment asserted an invariant the code did not actually implement for two of three read paths, producing a real, reproduced-on-device bug (valid token, every request 401s) — the *documentation* form of the same "looks correct, has a real gap" failure.

**Currently-live guards checked and found structurally sound** (counter-evidence — not everything in this family is broken):
- `WatchSync.refresh(force: Bool = false)` (`WatchSync.swift:222-232`) — the *fixed* version of exactly the same-date-guard problem: a 60s throttle with an explicit `force:` parameter and a comment stating outright the throttle exists to stop background triggers hammering the endpoint, not to make a runner's own tap into a silent no-op. **Proof the codebase already knows the correct pattern** — `goTo`'s guard simply doesn't use it.
- `StuckConnectionMonitor.resetPool` guard `!resetInFlight` — genuinely reasoned (a second reset racing the first would tear down connections already being rebuilt for nothing).
- `V5RequestCoalescer`/`DayFetchCoordinator`/`weekFetchInFlight` all use `defer { inFlight[key] = nil }` cleared strictly on completion — correct for concurrent-request coalescing, but not a defense against sequential bursts past a timeout; a live gap, not a fixed one, in that sense.

No distinct fourth-or-fifth still-lurking same-date/guard bug found beyond what's listed. Remaining `guard ... else { return }` instances found were either well-reasoned dedup/throttle guards with documented rationale, or plain nil-unwrapping guards unrelated to freshness.

---

## 4. Architecture assessment: thin display layer, or a cache with independent invalidation logic?

**Honest read: this is, today, a client-side cache with independently-invented invalidation logic layered several times over, not a thin display layer with a few isolated bugs.** The bugs found are not random — structurally predictable output of the current design, and the code's own comments say so directly (the `WATCH-TODAY-SINGLEFLIGHT-1` "sixth ad-hoc single-flight mechanism" note; `ForegroundWork.swift`'s header, literally titled "two jobs that were sharing one throttle, and only one of them wanted it").

Concretely, for `SurfaceStoreV5`/`HostsV5` as they exist:

- **`SurfaceStoreV5.swift` (867 lines)**: roughly the first 360 lines (`V5Surface` itself) are almost entirely freshness/staleness decision-making. This IS the correct home for that logic (per the doctrine comment at the top of the file), but it is not thin — a fairly sophisticated client-side cache-with-invalidation-policy, deliberately, because David's own quoted directive in `presentSync`'s comment ("Click on the days needs to feel like it pushes the data change... load, wait, see it") requires instant paint from local state before any network round trip. Making the client a pure pass-through would mean giving up exactly the instant-navigation UX this file was built to deliver — **a real product trade-off, not just legacy cruft.**
- **`HostsV5.swift`'s `TodayHostV5` (lines 168–2303, ~2135 of the file's 4471 lines)**: this is where the "independent decision-maker" pattern is most concentrated and least justified.
  - State: `dayCache`, `weekCache`, `weekFetchInFlight`, `isOffline`, `lastKnownPlanVersion`, `planStartISO`/`planEndISO`, `knownTodayISO`, `navDirection`, `viewingDate`, `pendingDate`, `navigationTask`, `fetchCoordinator` — 12 pieces of independently-managed local state, none owned by `V5Surface`.
  - Functions devoted to freshness/cache/dedup decisions (`DayFetchCoordinator`, `fetchAndCacheWeek`, `reconcileDayCache`/`reconciledDayCache`, `canPageWeek` ×2, `goTo` ~100 lines, `prefetchAround` ~75 lines, `planVersionAcceptable`, `shouldRenderFromSnapshot`, `syncPlanSnapshot`/`performPlanSnapshotSync`, `seedCachesFromDisk`, `todayISO`, `retryPending`, `weekStripDays`, `weekSummary`) — roughly **700-900 lines, roughly a third of `TodayHostV5`**, doing nothing but deciding what is fresh, what is stale, what to fetch, and what to trust, independently of `V5Surface`'s own answer to the same questions for the *same* underlying data.
  - The remainder (~1200-1400 lines) is genuinely display/composition and close to what a thin display layer should look like.

**What "thinner, backend-is-sole-source-of-truth" would concretely require:**
- Collapsing the freshness *decision* into one place. Right now `V5Surface.stale`/`cachedAt`, `AppCache.fresh`, `HostsV5.dayCache`+`lastKnownPlanVersion`, `isOffline`, and `PlanSnapshotStore.syncState` each independently answer some version of "can I trust what's on screen," with no single function any of them defers to. A thinner client would have exactly one freshness authority per data shape and every other flag would read from it rather than maintain a parallel opinion.
- `isOffline` specifically would need to stop being a locally-inferred, locally-cleared guess and either be removed (let a failed fetch simply be a failed fetch, shown honestly per-attempt) or be re-derived from the same authority `stale` already uses.
- `goTo`'s same-date guard needs the `force:`/explicit-intent pattern `WatchSync.refresh(force:)` already demonstrates elsewhere in this same codebase — the fix is not novel, it already exists as a precedent two files away.
- The `prefetchAround`/`fetchAndCacheWeek` 21-day-plus-4-week fan-out on every navigation is a design choice trading request volume for perceived instantness; making the client "thin" in David's stated sense would mean this fan-out shrinks or the in-flight guards gain a cooldown, not just a "cleared on completion" reset.
- `SettingsCache`'s "never re-fetch once populated" policy and `PlanSnapshotStore`'s "no age check, purely event-triggered" policy are both, on David's stated model, the wrong default — they assume the client's copy stays correct until some specific event proves otherwise, rather than treating the server as continuously authoritative.

**So: not "thin display layer with a few specific bugs."** The bugs found are symptomatic of an architecture that has organically grown five-plus separately-invented "is this fresh" mechanisms (the codebase's own comments confirm this happened at least once already with single-flight dedup), each reasoned about in isolation, several already needing a "v2" rewrite after shipping with a real gap. The honest fraction for `TodayHostV5` specifically is roughly a third of the file's logic doing independent freshness/staleness work; the concentration of that logic in one host (vs. the much thinner `BlockHostV5`/`RacesHostV5`) suggests the fix is tractable — one file's worth of consolidation, not an app-wide rewrite — but it is a real architectural change, not a bug-fix-sized one.
