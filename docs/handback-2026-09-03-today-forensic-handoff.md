# Today/week-strip navigation — forensic handoff (2026-09-03)

Physical-device acceptance has failed twice against this stream's work.
Per explicit instruction: no further patches, no further ships. This is a
factual state dump for a clean architectural review by whoever picks this
up next — not a defense of the work, not a diagnosis of the new symptoms
listed in the stop message (future dates stuck loading, cached summaries
that never resolve, missing top controls during pending states, repeated
"Can't reach faff", data over an hour stale, large empty screens, content
extending beneath the bottom nav). None of those seven were independently
re-investigated after the stop instruction arrived; some overlap with
things this document DOES explain, some do not.

## 1 · Exact latest TestFlight build and commit

| | |
|---|---|
| **Last SHIPPED build** | **TestFlight 267**, commit `ff29f0ac` |
| Fix in that build | SHELLBYPASS-1 + FETCHOWNER-1 (`c1db1737`) |
| **Uncommitted-to-remote local work** | commit `cbaf3cb7` ("CANCELBANNER-1"), sitting on top of `ff29f0ac`'s descendant on the local `main` checkout at `/Volumes/WP/06 Claude Code/Runcino`. **NOT pushed to `origin/main`. NOT shipped to TestFlight. NOT further verified against the new symptom list.** `git log origin/main..HEAD` shows exactly this one commit; `origin/main` itself is at `9aca6302`, from an unrelated concurrent session (`fix(adaptation): ratchet the canonical shadow-log write into the mutation gates`), i.e. THIS stream's own last commit reachable from `origin/main` is still `ff29f0ac`/build 267. |

`cbaf3cb7` touches only `native-v2/Faff/Faff/API.swift` (+ its own new test
file + a routine `project.pbxproj` regen). It changes `API.authedSend`'s
error handling so a cancelled request (Task cancellation from a superseded
navigation) does not post the global `.faffReachabilityLost` notification
the way any other transport failure does. It was live-verified on
simulator (rapid multi-tap navigation → no banner; server genuinely
killed → banner still correctly appears) but **never shipped, never run
against the physical device, and is not reflected in build 267** — the
build David is testing does not contain it.

## 2 · Every Today render branch currently present

`TodayHostV5.body` (`native-v2/Faff/Faff/ViewsV5/HostsV5.swift`), top level,
in order:

```
if let model = surface.model {
    switch readiness(model:, wanted:, pendingDate:) {   // line 469
    case .match(matched):   content(matched)             // line 470 — shared shell, own file
    case .loading(date):    pendingCard(date, .loading)   // line ~510
    case .failed(date):     pendingCard(date, .failed or .offlineNoCache)  // line ~511-521
    }
} else if let viewingDate {                              // line 522 — SHELLBYPASS-1's own branch
    pendingCard(viewingDate, .failed or .offlineNoCache)
} else if let reason = surface.absentReason {             // line 556
    wayOutHeader + Silence(reason)                        // NOT the shared shell
} else if surface.isOutage {                              // line 570
    wayOutHeader + OutageBodyV5                            // NOT the shared shell
} else {
    coldStart                                              // line 586
}
```

`content(_:)` (line 777), reached only from the `.match` case above,
switches on `model.state` — **seven** cases:

```
switch model.state {                                      // line 777
case .notOnPhoneYet:              inSharedShell { NotOnPhoneYetV5(...) }
case .injuryFlare:                inSharedShell { InjuryFlareV5(...) } / TodayBeforeLiveV5 fallback
case .sick:                       inSharedShell { SickFlareV5(...) } / TodayBeforeLiveV5 fallback
case .weekOff:                    inSharedShell { WeekOffV5(...) } / TodayBeforeLiveV5 fallback
case .offSeason:                  inSharedShell { OffSeasonV5(...) } / inSharedShell { NotOnPhoneYetV5(...) } fallback
case .afterRun:                   TodayAfterV5(...)         // draws its own header internally
case .beforeRun, .raceDay:        TodayBeforeLiveV5(...)    // wraps TodayBeforeV5, own header internally
}
```

**Known gap, never independently checked:** `inSharedShell` and
`TodayAfterV5`/`TodayBeforeLiveV5` each independently construct their own
`TodayHeaderStripV5` call with their own copy of `canPageBackward`/
`canPageForward`/`weekStripDays(for:)`. These are not unified through one
call site — three separate construction points that are expected to agree
but are not mechanically guaranteed to. A reviewer should treat "the shell
is the same everywhere" as an assertion this stream made, not a structural
invariant the type system enforces.

Separately, at line 1799 and 1869, **two more, unrelated hosts** in this
same file (`ReturnToRunningHostV5`-shaped code, for the injury-return
ladder flow reached from Settings/niggle, not from Today's own navigation)
repeat the same `if model / else if absentReason / else if isOutage`
three-way split with their OWN version of `wayOutHeader`-equivalent
content. These were not touched by this stream and were not audited for
the same class of bug SHELLBYPASS-1 fixed in `TodayHostV5`.

## 3 · Every endpoint called when selecting a date

- **`GET /api/v5/today?date=<iso>`** — the primary fetch. Client:
  `API.fetchV5Today(date:)` (`DesignV5/APIV5.swift:1636`). Called from:
  - `goTo` directly (`HostsV5.swift:1254`, the `refresh` closure used by
    `fetchOnce`/`rebind`/`refreshBehind`)
  - `DayFetchCoordinator.fetch` (`HostsV5.swift:70`) — the bounded/
    deduplicating prefetch coordinator `prefetchAround` uses for
    neighboring days
  - `retryPending` (line ~2501) — Retry button
  - the initial cold-start `.task` (line ~3078, no `date:` — "today" itself)
- **`GET /api/plan/week?date=<iso>`** — the week-summary fetch. Client:
  `API.fetchPlanWeek(date:)` (`API.swift:1462`). Called from
  `fetchAndCacheWeek(anchoredOn:)` (`HostsV5.swift:1052`), fired
  unawaited the instant a navigation starts (`goTo`) and from
  `prefetchAround` for the visible/prev/next/next-next week anchors.

No other endpoint is called as a direct consequence of tapping/swiping to
a date. (`fetchPlanWeek`'s own response also carries `plan_start_iso`/
`plan_end_iso`, consumed by `canPageWeek` for boundary clamping — no
separate request for that.)

## 4 · Cache keys and invalidation rules

**In-memory, `TodayHostV5` `@State`:**
- `dayCache: [String: V5Today]` — keyed by `dateISO`.
- `weekCache: [String: PlanWeek]` — keyed by the week's own
  `week_start_iso` (not the anchor date requested).
- `pendingDate: String?` — the one date currently "in flight," per
  `readiness()`'s own use of it (§5).
- `viewingDate: String?` — nil means "on today."

**Disk (`AppCache.swift`):**
- Fixed slots (`Key` enum, one per screen): `.v5Today` is the only one
  Today-relevant; written only for the no-`date` ("today") fetch. 12h
  wall-clock staleness gate (`fresh(_:)`).
- Dynamic per-key slots (`writeRawDynamic`/`readRawDynamic`,
  `AppCache.swift:162+`): `"v5.day.<date>"` and `"v5.week.<start>"`, one
  per date/week ever fetched. **No wall-clock staleness gate** — validity
  is treated as a plan-version question, not a time question (see
  PLANVERSION-1 below). **Bounded retention** (added this stream,
  `AppCache.swift:200-206`): 60 day entries, 20 week entries, LRU-evicted
  (a read touches the entry's timestamp same as a write) once a kind
  exceeds its cap.
- `bindOwner`/`clearAll` sweep everything under the `"faff.cache."` prefix
  on sign-out/identity change — this covers the dynamic keys too since
  they share the same prefix, not because anything explicitly iterates
  `Key`'s cases.

**Invalidation:** `PLANVERSION-1` — every `V5Today`/`PlanWeek` payload
carries `planVersion: "${training_plans.id}:${last_adapted_at}"`.
`reconciledDayCache` (existing, predates this stream) drops the WHOLE
`dayCache` when an incoming payload's `planVersion` disagrees with the
last-known one. `seedCachesFromDisk()` (cold-launch disk restore) applies
the same check per-entry against whatever `surface.model` itself already
loaded from disk, accepting a `nil` version on either side as "unknown,
not necessarily wrong" rather than refusing it.

**A separate, KNOWN, UNRESOLVED staleness gap** (reported by another
session, not this one, not verified independently by this stream): one
specific production plan (`pln_7636bcc0a201bf2d`) had a pace recompute
that never bumped `last_adapted_at` before the bug that caused that was
itself fixed — so `planVersion` may currently under-report a real content
change for that plan. The proposed one-line `UPDATE` fixing it is
UNEXECUTED, held pending explicit verification that the plan is David's
own and pending his direct go — see the previous handback
(`docs/handback-2026-09-03-shellbypass-1-root-cause.md`, §7) for the
exact statement. Not touched by CANCELBANNER-1 or anything since.

## 5 · Request ownership / cancellation logic

`goTo(_:todayISO:)` (`HostsV5.swift`, ~line 1230+) is the single entry
point every navigation funnels through (day tap, week-strip swipe,
"Today"). On each call:

1. `navigationTask?.cancel()` — cancels whatever the PREVIOUS call started.
2. If `dayCache[iso]` exists: paint synchronously (`presentSync`), clear
   `pendingDate`, then start a background refresh — `refreshBehind`
   (permanent rebind) if landing on today, `fetchOnce` (temporary, does
   not touch the surface's standing `fetch` closure) otherwise.
3. Else: set `pendingDate = iso`, start `rebind` (today) or `fetchOnce`
   (elsewhere); on completion, clear `pendingDate` ONLY if it still equals
   `iso` — guards against a late-completing, already-superseded fetch
   un-pending a date the runner is no longer on.
4. `weekCache`/`prefetchAround` fire unawaited, independently — cannot
   race the above because they never touch `surface.model`/`pendingDate`.

`fetchOnce` (`SurfaceStoreV5.swift`, added this stream) exists specifically
so a non-home navigation's fetch cannot leave the shared surface's
canonical `fetch` closure pointed at a stale date for a LATER, unrelated
refresh (`.faffForegroundRefresh`) to reuse — see FETCHOWNER-1 in the
previous handback for the full mechanism and its own live verification.

`readiness(model:wanted:pendingDate:)` is the pure function deciding
`.match`/`.loading`/`.failed` from these three inputs — unchanged by
CANCELBANNER-1, covered by `TodayNavigationTests` (pre-existing).

**`CancellationBannerTests` (uncommitted-to-remote, `cbaf3cb7`):**
`API.authedSend`'s catch block used to post `.faffReachabilityLost` — the
global "can't reach faff" banner trigger — for ANY error, including a
cancelled request. Since `URLSession.shared.data(for:)` is Task-
cancellation-aware and throws when cancelled, and `navigationTask?.cancel()`
above fires on every ordinary fast navigation, this meant tapping two or
three dates in quick succession routinely triggered a false "can't reach
faff" on a healthy connection. `API.isCancellation(_:)` (new, pure,
tested) now gates that. **This is a real, understood, tested,
live-verified-on-simulator fix that has not shipped and has not been
checked against the physical device.**

## 6 · Known failures and unverified claims — stated plainly

**Verified, this stream, live on simulator, before the stop instruction:**
- Persistent shell across `.match`/`.loading`/`.failed` (TODAYSHELL-1,
  build 255+).
- All seven `content(_:)` states render under one shared header/strip
  (SHELLBYPASS-1, build 267) — reproduced specifically for `weekOff` via a
  real server response, not just by code reading; the other four outlier
  states share the identical code path but were NOT individually
  re-clicked.
- Cold launch with disk cache, offline-with-cache, offline-without-cache,
  Retry-after-reconnect, plan-boundary clamping at month/year/plan-start/
  plan-end (all builds through 259/267).
- Cancellation no longer raises the connectivity banner while a genuine
  outage still does (CANCELBANNER-1, uncommitted, simulator only).

**Never verified on a physical device by this stream, at any point** — all
verification this entire stream was simulator-only, against an isolated
local copy of production data. No tool in this environment can drive or
record a real iPhone; this was stated as a known limitation in every prior
handback in this stream and remains true here.

**Explicitly NOT investigated after the stop instruction, named rather
than guessed at:**
- "Content extending beneath the bottom navigation" — no safe-area/scroll-
  inset audit was ever performed on any of the seven `content(_:)` states
  or `pendingCard`'s `ScrollView`. Plausible independent bug, not looked
  at.
- "Large empty screens" on the physical device — not reproduced; could be
  the outlier-state screens (§2) rendering correctly but sparsely, could
  be something else.
- Whether the specific symptom list in the stop message reflects build
  267 (which HAS SHELLBYPASS-1/FETCHOWNER-1) or an OLDER cached TestFlight
  build David's device had not yet updated to — not established.
- Whether `.faffForegroundRefresh` firing mid-navigation (the exact
  scenario FETCHOWNER-1 targets) has an OTHER, still-open failure mode
  beyond the one already fixed — not re-audited after that fix shipped.

## 7 · Files changed by this stream (native-v2 + the two web-v2/scripts touches)

Per-commit, this stream's own commits only (not merges, not other
sessions' work that happened to land on `main` in between):

| Commit | Files |
|---|---|
| `3dfc7bed` TODAYSHELL-1 | `API.swift`, `DesignV5/ComponentsV5.swift`, `ViewsV5/HostsV5.swift`, `ViewsV5/TodayAfterV5.swift`, `ViewsV5/TodayBeforeV5.swift`, pbxproj |
| `05bf799b` polish (rail colors/panel transition) | `DesignV5/ChartsV5.swift`, `ViewsV5/HostsV5.swift` |
| `fe7ebcf0` disk cache/plan boundaries | `API.swift`, `AppCache.swift`, `DesignV5/APIV5.swift`, `DesignV5/ChartsV5.swift`, `DesignV5/ComponentsV5.swift`, `ViewsV5/HostsV5.swift`, `ViewsV5/TodayAfterV5.swift`, `ViewsV5/TodayBeforeLiveV5.swift`, `ViewsV5/TodayBeforeV5.swift`, `FaffTests/TodayReliabilityTests.swift`, `web-v2/lib/onboarding/_onboarding_e2e.test.ts`, `web-v2/lib/plan/week-loader.ts`, `web-v2/lib/watch/_watch_lobby.test.ts` |
| `9f1f76cb` retention/eviction | `AppCache.swift`, `FaffTests/AppCacheRetentionTests.swift`, pbxproj |
| `c1db1737` SHELLBYPASS-1/FETCHOWNER-1 | `ViewsV5/HostsV5.swift`, `ViewsV5/ShellV5.swift`, `ViewsV5/SickV5.swift`, `ViewsV5/StateScreensV5.swift`, `ViewsV5/SurfaceStoreV5.swift` |
| `ff29f0ac` (ship-only) | `scripts/ship-testflight-v2.sh` (watch-gate retry loop + explicit `FAFF_SKIP_WATCH_GATE` escape hatch — infra, not app logic), `legacy/native/.asc.build` |
| `cbaf3cb7` CANCELBANNER-1 — **uncommitted to remote** | `API.swift`, `FaffTests/CancellationBannerTests.swift`, pbxproj |

`web-v2/lib/plan/week-loader.ts` is the only backend file this stream
touched — it added `plan_start_iso`/`plan_end_iso` to `/api/plan/week`'s
response (additive, non-breaking, already live).

## 8 · Current branch/main state

- Working directory: `/Volumes/WP/06 Claude Code/Runcino`, branch `main`.
- `origin/main` tip: `9aca6302` (unrelated concurrent session's commit).
- This stream's last commit reachable from `origin/main`: `ff29f0ac`
  (TestFlight build 267).
- Local-only, uncommitted-to-remote: `cbaf3cb7` (CANCELBANNER-1), one
  commit ahead.
- No other uncommitted changes (`git status --short` shows only the
  pre-existing untracked `AGENTS.md`, not from this stream).
- **No push, no ship, no further code change made after the stop
  instruction arrived.** `cbaf3cb7` was already committed locally before
  that message was received; it was not pushed afterward, and nothing
  else was written to any file after.

This document is the full stop. No further action taken on this
workstream.
