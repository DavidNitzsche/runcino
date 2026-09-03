# Handback — Today/week-strip navigation, round 2

Status as of this write: **the P0 state-integrity defect is fixed and tested
directly, not just rendered and eyeballed.** Everything below sits on branch
`claude/today-navigation-p0`, in an isolated worktree at
`/tmp/faff-p0-worktree`, based on current `main` (`9787680d`). **Nothing is
committed.**

**Section 1 is the one to read first** — it's what round 1 got wrong and how
round 2 actually fixes it. Section 6 is the operational finding that cost the
most time this round and is worth reading before anyone else touches this
file concurrently. Section 8 is the honest scorecard against the full
external-review punch list.

The round-1 handback (`handback-today-week-strip-2026-09-03.md`) no longer
exists on disk — lost in the same collision described in §6, never committed.
This document is self-contained and supersedes it.

---

## 1 · What round 1 got wrong, and the actual fix

Round 1 shipped STALEDAY-1: when a swiped-to date's fetch failed, the screen
kept showing the previous date's workout with an honest banner naming the
mismatch ("Thursday, September 24 did not load — showing Thursday, September
17"). Correct information, wrong fix. The external review named the rule
precisely:

> The app must never render workout content for date A beneath a selected or
> labeled date B. Do not solve a state-integrity defect with explanatory copy.

The banner was still true. `content(model)` was still being called with a
`model` that did not belong to the visible selection. A caller could always
reach it regardless of whether the banner rendered correctly above it.

### STATEGATE-1

`TodayHostV5.readiness(model:wanted:pendingDate:)` is now the ONE function
that decides which of three screens gets built, and `content(_:)` is
reachable from exactly one of its cases:

```swift
enum ContentReadiness: Equatable {
    case match(V5Today)
    case loading(date: String)
    case failed(date: String)
}

func readiness(model: V5Today?, wanted: String, pendingDate: String?) -> ContentReadiness {
    if let model, model.dateISO == wanted { return .match(model) }
    if pendingDate == wanted { return .loading(date: wanted) }
    return .failed(date: wanted)
}
```

`body` switches on this and only ever calls `content(matched)` from
`.match(let matched)`. There is no second call site. A day whose content
has not arrived yet renders a genuine loading skeleton (workout removed from
the content region, per the review's own preferred behavior); a day whose
fetch genuinely failed renders a genuine per-date failed card with Retry.
Neither ever shows another day's workout.

`pendingDate` (new `@State`) is what makes the loading/failed distinction
possible — set the instant a real (non-cache-hit) navigation starts, cleared
only by the specific task that set it and only if nothing newer has already
moved past it (single-flight, same discipline `navigationTask` already had).

**The cache-hit path was hardened too**, independent of the failure path:
`V5Surface.present(known:refreshWith:)` used to do `model = known` inside an
`async` function — meaning a `Task { await surface.present(...) }` had a real
(if brief) scheduling gap between "navigation requested" and "model actually
matches." Split into `presentSync(_:)` (synchronous, zero gap) and
`refreshBehind(_:)` (the async refetch behind it), so a cache hit — the fast,
common case — can never produce even a one-frame false mismatch.

### Tested directly, not just rendered

`TodayNavigationTests.swift`, 12 tests, including the invariant itself:

```swift
func testMismatchedPayloadNeverReadsAsMatch() throws {
    let old = try decode(V5ContractTests.Fixtures.beforeRun)
    let host = TodayHostV5(path: .constant([]))
    let result = host.readiness(model: old, wanted: "2026-09-13", pendingDate: nil)
    XCTAssertFalse(result == .match(old))
}
```

Plus the loading/failed/match/nil-model permutations, and the id/date
resolver tests carried over from round 1. All pass; full suite (22 test
files) green in the isolated worktree.

Live-rendered against real production-shaped data (see §7): swiped across
several weeks, tapped multiple dates, forced the server down mid-navigation
— no mismatch observed, and the wide prefetch (§3) means the failure path is
now rare enough that reproducing it live took deliberately killing the local
dev server, not ordinary use.

---

## 2 · The two bugs you saw twice, and why

Both the duplicate "‹ Today" chip and the status-bar scrim were fixed once,
mid-round-1, then came back — not because the fix regressed, but because a
**second, concurrent Claude Code session** merged a 224-commit integration
branch into `main` that contained the ORIGINAL (pre-fix) versions of both,
and a `git pull --ff-only` landed mid-session and silently reverted several
uncommitted local edits back to those originals. Full account in §6.

Both are fixed again as of this round, in the isolated worktree, verified by
rendering:

- **Duplicate chip**: `PlaceHeaderV5` already draws a "‹ Today" chip inside
  the panel the moment a runner is off today. A second, pinned copy was
  added above the scroll on the assumption the first one scrolled out of
  reach — it didn't check that assumption, and both were visible at once.
  Removed; the loading/failed cards (§1) get their own single header instead
  (there is no `PlaceHeaderV5` in those states to duplicate).
- **Status-bar scrim**: explicitly rejected twice now — "the status bar
  skrim and fade is WRONG and should not be there." Removed entirely this
  time, including the dead `StatusBarScrimV5` struct, with a comment at the
  call site telling the next person not to re-add it.

---

## 3 · Hardening carried over and extended from round 1

| What | Status |
|---|---|
| WKSTRIP-RACE-1 (swipe recentre no longer races its own fetch) | Already on `main` via the upstream merge — unaffected by this round. |
| CACHEDAT-1 (`cachedAt` stamped on every real fetch, not frozen at launch) | Re-landed this round after the collision reverted it. |
| VW-3 (QA-token auth) | Re-landed and **re-verified with stronger evidence** — reproduced 0-for-6 401s with a confirmed-valid, unrevoked, matching session token before the fix; 0 401s after. See §7. |
| One honest banner instead of two stacked | **Superseded, not just fixed** — STATEGATE-1 makes the day-mismatch banner impossible to need at all, since a mismatch can no longer render as content in the first place. The plain reachability banner (`StaleBannerV5`) is the only one left, and it only ever states one fact. |
| Settle-only haptic | Re-landed, moved to the single canonical navigation entry point (`goTo`), fires at selection commit rather than data-arrival — matches "the calendar follows the runner's finger immediately; data quietly catches up." |

---

## 4 · New this round: bounded request coordinator (REQCOORD-1)

The review's "Load weeks as weeks" section wanted one request per week,
deduplication, and a bound on concurrent fan-out — with an explicit
fallback: *"If a complete week endpoint cannot responsibly land in this
workstream, document why and implement a bounded request coordinator... But
the master task must remain open."*

**Why the endpoint doesn't land this round**: investigated what it would
take (backend agent report below). `loadPlanWeek` already returns all seven
days' plan rows in one cheap query — but a full rich per-day card (the
type/dose/pace-band/HR-ceiling the Today screen shows) has no server-side
"day → card" composer today; writing one means either running the expensive
`composeV5Today` path seven times per request (too slow, and it does
per-run reads a week-ahead view doesn't need) or lifting two currently-file-
private helper functions (`sessionMinutes`, `fmtBand`/`fmtSingle` in
`route.ts`) into a shared module and writing the composition fresh — a real,
first-of-its-kind piece of coaching-facing output this codebase's own
doctrine treats with more care than a time-boxed pass should spend on it.
**Left open, not silently dropped** — tracked here by name for whoever picks
it up next.

**What landed instead**: `DayFetchCoordinator`, a bounded, deduplicating
fetch layer every prefetch call now routes through —

- Two overlapping prefetch calls for the same date get the SAME in-flight
  task, never two requests.
- At most `maxConcurrent` (6) requests open at once, however many dates a
  burst of swipes wants primed.
- `prefetchAround` was also widened to request the full seven days of the
  immediately previous and next week (not just ±1/±7 single days), bounded
  off the visible strip's own dates — matching "prefetch the immediately
  previous and next weeks" from the original brief, now routed through the
  coordinator so the wider ask doesn't reintroduce the fan-out problem it
  replaced.

---

## 5 · PLANVERSION-1, and the field it stops short of

The review wants a canonical `planVersion` on the wire, threaded through
week-strip, day response, client cache key, and adaptation-invalidation
events. That's a backend contract change. What landed instead, backend-free:
every fresh `weekStrip` that arrives is diffed against the session's
`dayCache` by `plan_workout_id` (the per-day identity a rebuild replaces
wholesale), and any cached day whose id no longer matches is dropped.

**Backend investigation for the real field** (so the next pass doesn't
re-derive this): `training_plans.id` is safe as a coarse plan-version — a
full rebuild inserts a new row and archives the old one
(`lib/plan/generate.ts`). It is **not** sufficient alone: in-place adaptation
(pace re-anchoring, `lib/plan/recompute-paces.ts` /
`lib/plan/reanchor-plan.ts`) rewrites `plan_workouts` and
`training_plans.authored_state` under the SAME id. A real `planVersion`
needs to combine `training_plans.id` with something that also moves on
re-anchor — `last_adapted_at` is already tracked
(`lib/plan/adapt.ts:2165,2171`) and is the natural second component.

**The gap this leaves, named rather than hidden**: a cached day whose PACES
changed via re-anchoring without its `plan_workout_id` changing would not be
caught by the current client-side diff. Closing it needs the wire field
above.

---

## 6 · Operational finding: a second concurrent session, and what it cost

Partway through this round, a `git pull --ff-only` landed mid-session
(triggered by the fetch inside an unrelated `git stash` test) and fast-
forwarded `main` by 200+ commits — a second Claude Code session had merged
the entire `integrate/p0-2026-09-01` branch (WKSTRIP-RACE-1, the stale-
banner component, their own VW-3 root-cause fix, and unrelated coaching-
engine work) and shipped TestFlight build 251 from it.

Consequences, in order of how they were found:

1. The stash-pop that followed the pull 3-way-merged local edits against
   the NEW `HEAD`, and silently dropped every hunk that didn't cleanly
   locate its context there — reverting CACHEDAT-1, the banner collapse,
   the duplicate-chip fix, PLANVERSION-1, the wide prefetch, the haptic, the
   VW-3 TokenStore fix, and the new test file, with **no conflict markers
   and no error** to signal it happened. Confirmed by diffing every touched
   file against `HEAD` one at a time (`git diff HEAD -- <path>` returning
   empty where a real edit should have shown).
2. **TestFlight build 251, already shipped, was confirmed to carry the
   duplicate-chip bug** — `pinnedWayBack` predates the ship commit and
   nothing since has touched that code path. This was live on the phone,
   not just this session's simulator.
3. Rebuilding after reconstructing the lost edits hit a compile error
   (`cannot find 'RPECaptureRow' in scope`) in a file this session never
   touched — the other session's own in-progress, uncommitted feature work
   (an RPE-capture addition to the post-run screen), sitting in the SAME
   shared working tree in real time.
4. At that point all further work moved to an isolated worktree
   (`git worktree add /tmp/faff-p0-worktree -b claude/today-navigation-p0
   9787680d`), with only this session's five touched files copied in by
   hand — never the other session's `RunDetailV5.swift` / `TodayAfterV5.swift`
   / new `RPEV5.swift`. The shared checkout's copies of those five files
   were reverted to `HEAD` so this session stopped touching a tree another
   agent is actively using, per this repo's own standing branching doctrine.

No data was permanently lost — everything reverted was reconstructed from
this session's own record of what it had built — but it cost real time and
is the reason this handback exists as "round 2" rather than a small delta.

---

## 7 · Verification

Per this project's own standing rule, a display fix is verified by rendering
it against real data, never a fixture.

- **Real session, not a fixture**: `web-v2/scripts/walk-substrate.ts` (now
  present on `main` via the same merge that caused §6) mints a session
  against a local, structurally-writable-but-isolated copy of the account
  (`faff_visual_walk`, a separate database, not production). Served from
  THIS session's own worktree code (a fresh script pointed at
  `/tmp/faff-p0-worktree/web-v2` — the checked-out worktree shares `web-v2`
  with the main checkout since only `native-v2/` was isolated) rather than
  a stale worktree left over from the merge.
- **VW-3, re-verified with direct evidence**: launched with a confirmed-
  valid, unrevoked, database-matching session token — every request 401'd
  (`/api/races`, `/api/profile`, `/api/strava/status`,
  `/api/today/purpose`, `/api/coach/intents`, `/api/forecast/...`) before
  the fix, zero 401s after. The earlier round's fix had been reasoned but
  never actually forced to fail first; this round it was.
- **The full navigation loop, live**: cold launch → real Today content →
  swipe forward (real content for the new date, no mismatch) → repeated
  rapid swipes (state held correctly, wide prefetch meant most were served
  from cache) → server killed mid-session to force the failure path →
  no observed mismatch.
- **One install-path mistake, caught and corrected inline**: partway
  through this round's verification, several "nothing changed" observations
  turned out to be because builds were being installed from the ORIGINAL
  checkout's stale DerivedData rather than the worktree's own — Xcode
  hashes DerivedData by project path, so the worktree's `Faff.xcodeproj`
  builds to a different folder. Caught by checking `WorkspacePath` in each
  candidate DerivedData's `info.plist`; noted here so it isn't rediscovered
  the same way next time this worktree is rebuilt.
- **A disk-full false alarm**: `df` reported 0 bytes free on the project's
  ExFAT volume mid-session; Finder's own "Get Info" showed 2.85TB free.
  Treated as a transient/contention read (two sessions building
  concurrently on the same external drive) rather than a real blocker,
  per direct correction — worth knowing if it recurs.

---

## 8 · Scorecard against the external review, item by item

| Review item | Status |
|---|---|
| The app must never render workout content for date A beneath date B | **LANDED**, tested directly (§1) |
| Preferred behavior (loading state removes old content, failed state offers Retry, explicit way back) | **LANDED** (§1) |
| Hard state assertion / behavioral test for `selectedDate == renderedWorkout.dateISO` | **LANDED** — `testMismatchedPayloadNeverReadsAsMatch` and siblings (§1) |
| Make navigation state atomic (one owner for selected date, content date, loading/error state) | **LANDED for the render gate** (`readiness`/`ContentReadiness` is that one owner for what's ON SCREEN). **Not landed**: a full reducer additionally owning plan version and request generation as first-class fields — `pendingDate` + single-flight cancellation cover the request-identity half; plan version is still the client-side `plan_workout_id` diff from §5, not a formal field. |
| Every navigation request carries an identity; stale/superseded results are ignored | **LANDED** — single-flight `navigationTask` (pre-existing, unchanged) plus the render-time gate, which catches a mismatch even if a cancellation raced. |
| Haptic fires on coherent selection commit only | **LANDED** (§3) |
| Load weeks as weeks — one request per week | **NOT LANDED, documented why, fallback built instead** (§4) |
| Bounded request coordinator preventing uncontrolled fan-out | **LANDED** (§4) |
| Explicit `planVersion` on the wire, threaded through cache/invalidation | **NOT LANDED** — client-side `plan_workout_id` fallback landed; the real field's shape is scoped in §5 for whoever picks it up. |
| Render-verify plan-version invalidation after a live rebuild; test with two real-shaped local plan versions first | **NOT DONE** either way this round. |
| Finish the top-bar work; render on Dynamic Island + smaller device | **NOT DONE.** Scrim removal (§2) is not a top-bar audit. |
| Preserve weekday across paging, incl. month/year/plan boundaries | **Ordinary case verified live** (Thu→Thu across weeks, §7). **Boundary tests (month/year/plan start-end) not written.** |
| Full hardening test matrix (offline, rest/completed/future/race day, Dynamic Type, Reduce Motion, VoiceOver, duplicate-request checks, etc.) | **Partially covered** — 12 tests total, covering the state-integrity invariant and the id/date resolver. The accessibility-specific items were explicitly descoped by direction mid-session; the rest of the matrix (rest/race/missing-workout days, offline, Reduce Motion, duplicate-request assertions) is not written. |
| Performance verification — signposts, XCTest performance metrics, release-build profiling | **NOT DONE.** `xctrace record` was attempted twice against a Release build and hung both times with no completion in this environment; no fallback (signposts, XCTest performance metrics) was attempted this round either. Stated as a real gap, not "unavailable so skipped." |
| Full delivery pipeline (commit, reconcile, push, confirm CI, TestFlight, report) | **Explicitly not started** — "do not commit or ship this pass yet" stands. |

---

## 9 · Files changed (isolated worktree, uncommitted)

```
M  .claude/launch.json                     new walk-server config entry
M  native-v2/Faff/Faff/DesignV5/ComponentsV5.swift   scrim removed for good
M  native-v2/Faff/Faff/FaffApp.swift        seedDebugToken wiring
M  native-v2/Faff/Faff/TokenStore.swift     VW-3, re-verified with direct evidence
M  native-v2/Faff/Faff/ViewsV5/HostsV5.swift  STATEGATE-1, REQCOORD-1, PLANVERSION-1,
                                              CACHEDAT-1 caller, haptic, wide prefetch
M  native-v2/Faff/Faff/ViewsV5/ShellV5.swift  scrim call site removed
M  native-v2/Faff/Faff/ViewsV5/SurfaceStoreV5.swift  presentSync/refreshBehind split, CACHEDAT-1
+  native-v2/Faff/FaffTests/TodayNavigationTests.swift  12 tests, incl. the hard invariant
```

Not touched, deliberately — the other session's own in-progress work:
`RunDetailV5.swift`, `TodayAfterV5.swift`'s RPE-capture addition,
`DesignV5/RPEV5.swift` (new, untracked).

---

## 10 · Next step

Nothing here is committed or shipped. Genuinely open, in priority order if
this continues: the `planVersion` wire field (§5) and its render-verification
against a real rebuild; the top-bar two-device render pass; weekday-boundary
tests; the remaining hardening-test matrix; performance verification with a
working method. The week-batch endpoint (§4) stays explicitly open per the
review's own fallback clause — not blocking, but not to be silently dropped
either.
