# Today/week-strip navigation — diagnosis and architecture gap, for external review

3 September 2026. Written for review before any decision is made on sequencing.
No code changed in this pass. This document exists to let someone other than
the agent that wrote it check the reasoning before work proceeds.

## 1 · The ask

A P0 brief (full text preserved below in §6) requested replacing Today's
network-driven navigation with a locally persisted, versioned `PlanSnapshot`
containing every authored day in the active block, so that with a previously
synchronized plan and Airplane Mode enabled, every date from plan start
through race day renders immediately from local storage — header, week
strip, selected date, content, and bottom navigation all staying mounted,
with no blocking per-day network request and no indefinite loading state.

The brief explicitly distrusts prior closure claims in this codebase (this
area has a documented history of "wired but claimed-fixed, never actually
verified live" — see the project's own Rules 13/18/19) and asks for the
failure to be reproduced and root-caused before architecture changes.

Mid-review, the user narrowed priority: **first determine whether the
reported failures are a Today-navigation defect, a shared networking/auth
regression, a production/deployment failure, a decoding/schema mismatch, a
cache-invalidation problem, or several independent causes** — and to not
touch architecture until that boundary is established.

## 2 · What's confirmed about the device under test

The user confirmed the installed build is **TestFlight build 267**
(`ff29f0ac chore(ship): TestFlight build 267 — SHELLBYPASS-1/FETCHOWNER-1;
watch gate resilience`).

`main` has moved 40+ commits past build 267. **Nothing has shipped since.**
The most recent commit on local `main` at the time of this review is
`cbaf3cb7`. (Local `main` and `origin/main` have each independently gained
one commit not on the other — `cbaf3cb7` is not yet pushed; `origin/main`'s
`46c2fe85`, an unrelated adaptation-engine digest fix, is not yet merged
locally. Both need reconciling before anything ships — low risk, disjoint
files, but not yet done.)

## 3 · Diagnostic findings

### 3a · Production/backend health — probed directly, right now

| Endpoint | Result | TTFB |
|---|---|---|
| `GET /` | `200` | 144ms |
| `GET /api/v5/today` | `401` (correct — unauthenticated) | 96ms |
| `GET /api/v5/block` | `401` (correct) | 100ms |
| `GET /api/races` | `401` (correct) | 100ms |
| `GET /api/plan/week` | `401` (correct) | 103ms |

No hangs, no 5xx, no elevated latency, correct auth-gating on every surface
Today/Block/Races/Run depend on. **No evidence of an independent production
or deployment failure at present.**

### 3b · Response-shape / decoding check

Diff on the two routes the native client's Today/week-strip flow reads,
from the build-267 commit (`ff29f0ac`) to current `main` (`cbaf3cb7`):

- `web-v2/app/api/plan/week` — **unchanged**, zero diff.
- `web-v2/app/api/v5/today` — one additive, nullable field (`raceOnToday`,
  from unrelated race-content work, `c1deac94`). Safe for an older client's
  `Codable` decode; nothing was removed, renamed, or retyped.

**No decoding/schema mismatch found** for the endpoints in question.

### 3c · The actual root cause — two already-fixed, unshipped bugs

Every authenticated request in the app — Today, Block, Races, Run,
reschedule — funnels through one shared low-level function,
`API.authedSend` (`native-v2/Faff/Faff/API.swift`). Two fixes already exist
on `main`, both committed, neither shipped:

1. **`CANCELBANNER-1`** (commit `cbaf3cb7`). Root cause, in the commit's own
   words: `authedSend`'s catch block posted the global
   `.faffReachabilityLost` banner for *any* error the request threw,
   including ordinary Swift-concurrency `Task` cancellation. Today's `goTo`
   (`HostsV5.swift:1264`, `navigationTask?.cancel()`) cancels the in-flight
   fetch on every new navigation — which fires on every normal fast tap
   between dates. So on build 267, browsing a few dates in quick succession
   raised "can't reach faff" on a perfectly healthy connection, essentially
   every time. Fix: `API.isCancellation(_:)`, a small static function
   checking both shapes a cancelled `URLSession` task can throw
   (`CancellationError`, `URLError(.cancelled)`); `authedSend` now rethrows
   silently instead of broadcasting. 9 unit tests
   (`CancellationBannerTests.swift`), falsified once before being trusted
   (both positive cases reverted to `false`, confirmed to fail, reverted
   back), plus 6 genuine-failure shapes confirmed to still raise the banner
   correctly. Live-verified on simulator: 4 rapid taps → no banner; real
   server kill → correct banner still fires.
2. **`TIMEOUT-1`** (same commit family, `API.swift`). Build 267 has no
   per-request timeout override, so a hung request rides `URLSession`'s
   default 60s. On `main`, this is cut to 12s, so a stuck request surfaces
   as a retryable failure instead of an indefinite spinner — this maps
   directly onto "future days stuck on Loading…"/"Getting the full
   session…".

Both bugs live in the same shared function, in the same file, already fixed
by the same fix. This is not four independent per-surface patches; it's one
shared-client defect with one already-landed correction.

### 3d · Why "hour-old data" specifically

Contributing, not causal on its own: the per-date/per-week disk cache
(`AppCache.writeRawDynamic`, `TODAYPERSIST-1`) has **no wall-clock
staleness gate by design** — the existing code comment treats validity as a
plan-version question, not a TTL. Combined with 3c, a build-267 runner would
routinely see genuinely-cached content (sometimes old) *while* the app
falsely claims it can't reach the server on nearly every tap — which reads
exactly as "repeatedly can't reach faff, showing old data, content won't
resolve," without the server, the account, or the data model actually being
broken.

## 4 · Boundary determination

Against the six options the review asked to distinguish:

1. **Today-navigation cancellation incorrectly surfaced as connectivity
   loss** — confirmed. This is the primary cause. Already fixed on `main`
   (`cbaf3cb7`), unshipped.
2. **Shared iPhone networking/authentication regression** — the bug lives
   in a shared function (`authedSend`, used by every authenticated surface),
   so its blast radius is app-wide, not Today-only. It is not, however, a
   separate "regression" needing its own owner or investigation — it is the
   same defect as (1), already correctly scoped to one fix in one file.
3. **Production API/deployment failure** — no evidence found (§3a).
4. **Response-decoding/schema mismatch** — no evidence found (§3b).
5. **Plan-version/cache invalidation** — a contributing factor to the
   *staleness* symptom (§3d) and to the architecture gap in §5, but not the
   trigger of the false "can't reach faff" banner itself.
6. **Multiple independent failures** — two compounding causes (cancellation-
   as-outage, no timeout ceiling), not independent: same file, same commit
   family, already fixed together.

**Conclusion: this stays inside the Today/navigation task. No separate
backend owner is needed.** The gap is distribution, not diagnosis: the fix
already exists; David's phone has never run it.

## 5 · Current architecture vs. the requested `PlanSnapshot` design

Separately from the live-bug diagnosis, a full codebase survey (current
`main`) was run against the brief's target: *"one locally persisted,
versioned `PlanSnapshot` containing every authored day for the active
block; Today/week-strip read ONLY from local snapshot; date selection never
waits on network; background sync validates+commits atomically; one
permanent shell for all states."*

**No such type exists today.** What exists instead:

- **Two independent per-granularity caches**, not one snapshot object:
  - Disk: `AppCache.writeRawDynamic`/`readRawDynamic`
    (`native-v2/Faff/Faff/AppCache.swift:162-252`), keyed `v5.day.<date>` /
    `v5.week.<weekStart>`, capped at 60 day-entries / 20 week-entries with
    LRU eviction (`RETENTION-1`), no wall-clock TTL.
  - Memory: `TodayHostV5.dayCache`/`weekCache`
    (`HostsV5.swift:951,969`), seeded from disk once per cold launch.
- **Date selection does wait on network today**, by design, on a cache
  miss: `goTo` (`HostsV5.swift:1227`) sets `pendingDate` and awaits a fetch
  whenever the tapped date isn't already cached. It degrades gracefully
  (ghost week strip, ContentReadiness gate), but is not "instant from local
  storage" for every date — only for dates already inside the prefetch
  radius (visible week ± 7 days, ± 2 weeks of summaries).
- **The 60-day/20-week retention cap is smaller than a full block.** The
  code's own comment notes a marathon block runs ~112-126 days.
  Airplane-mode navigation to plan-start or race-day, if either falls
  outside the LRU window, would still show the "never visited offline"
  honest-empty state, not real content — this is the concrete way the
  acceptance test in §6 could still fail even after 3c/3d are shipped.
- **Invalidation is opportunistic reconciliation, not atomic commit.**
  `reconciledDayCache` busts stale entries whenever *any* fresh payload
  happens to land — there's no single "validate the whole snapshot, then
  commit it as one unit" step. A mid-flight visit can render some dates
  under an old plan version and some under a new one until every relevant
  cache slot has individually been touched.
- **A second, legacy Today shell still exists** in the binary
  (`Views/TodayView.swift`, v4), reachable only via the `-faffLegacy`
  launch argument — not on the production path, but not deleted either.
- **Server contract gap**: no endpoint currently returns "the whole
  block" in one call. The closest primitive is `/api/plan/week`, one week
  at a time; a real `PlanSnapshot` would need either a new bulk endpoint or
  client-side assembly across N week-fetches at sync time.

Full file-by-file map (line numbers, current shell/navigation/cache call
sites, matched-vs-supplemental execution contract, existing test coverage)
is preserved in the session this document was produced from and can be
re-run on request; omitted here for length.

## 6 · Original brief (verbatim, for reference)

> P0: Replace Today's network-driven navigation with a local plan snapshot.
> [...] Do not declare closure from simulator screenshots. This closes only
> when the distributed build navigates the entire saved plan instantly on
> David's phone with Airplane Mode enabled.

Acceptance test as subsequently clarified by the user:

> With one previously synchronized plan and Airplane Mode enabled, every
> date from plan start through race day must render immediately from local
> storage. The header, week strip, selected date, content, and bottom
> navigation must remain mounted. Selecting a date must issue no blocking
> per-day request and must never show an indefinite loading state.

## 7 · What this review has not verified

- **No exact physical-device timestamps were available**, and this session
  has no `RAILWAY_TOKEN` configured, so server-side request logs could not
  be pulled to correlate one specific failure instance. §3's conclusion
  rests on a code-level causal chain plus live production probes taken
  during this review, not a log-matched proof of one exact incident.
- **Nothing in this review has been rendered on a real device or with a
  real account this session.** The prior session's simulator-based
  verification of `CANCELBANNER-1` is real but simulator-only, per that
  commit's own message; the project's `-faffToken` QA path for real-data
  simulator verification is separately documented as currently broken
  (`VW-3`), so simulator verification with real data is not presently
  available either.
- `cbaf3cb7` is not yet pushed to `origin/main`, and `origin/main` carries
  one commit not yet merged locally. Reconciling this is a prerequisite for
  shipping anything, not yet done.

## 8 · The decision this document is for

Two questions, deliberately left open for review rather than decided here:

1. **Sequencing.** Ship a build containing the two already-fixed, unshipped
   bugs (§3c) first, and use David's own Airplane-Mode test as the
   falsification of this diagnosis — before committing to the full
   `PlanSnapshot` rewrite? Or treat §5's gap as confirmed regardless and go
   straight to the redesign? Shipping is cheap (two files, already tested)
   and would tell us how much of the reported failure the redesign is even
   still needed to fix, versus how much was always going to be fixed by
   distribution catching up to `main`.
2. **Scope of the redesign, if it proceeds.** §5 describes a real gap
   against the brief's target (windowed cache with LRU eviction vs. a full
   versioned block snapshot; opportunistic reconciliation vs. atomic
   commit; no bulk server endpoint). Confirming this gap is still worth
   closing — and at what size block/retention limit — is a decision, not
   an inference.
