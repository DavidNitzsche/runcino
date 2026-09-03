# Today navigation P0 — handback (2026-09-03)

## What was reported

Physical-device TestFlight 254: tapping a future day replaced the whole Today
screen with a giant unexplained skeleton; the week strip disappeared; loading
felt indefinite; swiping weeks did the same; the app felt "coupled to the
network" rather than following the runner's finger.

## Root cause

`TodayHostV5.body`'s `.loading` / `.failed` readiness cases rendered a
structurally different screen (`navigatingCard`) with no `WeekStripV5` at all
— a minimal header, no calendar/account buttons, nothing resembling the real
Today screen. Any navigation to a date whose full detail wasn't already
cached tore the whole shell down and replaced it. Every reported symptom
follows directly from that one fact.

## The fix — TODAYSHELL-1

- **`TodayHeaderStripV5`** (`ComponentsV5.swift`): the header + weekline +
  strip cluster factored into one shared component. `TodayBeforeV5`,
  `TodayAfterV5`, and the new pending card all mount the *same* shell — there
  is no second, thinner version of it anywhere.
- **`pendingCard`** replaces `navigatingCard`: a compact, content-region-local
  loading state ("Loading Sunday's workout…") instead of a near-full-screen
  skeleton. A **provisional-summary render path** (`pendingContentBody`) shows
  the real type/dose from a cached week summary while the full day detail is
  still loading, so the runner sees "Long run · 15 mi" immediately rather than
  a bare spinner where the data already partly exists.
- **`weekStripDays(for:)` / `weekLine(for:)`** degrade gracefully in three
  steps: exact day cache → current surface's own week → a pure-arithmetic
  "ghost" week for a date never fetched at all. The strip is *always* drawn,
  never blanked. Selected-day highlighting is explicitly remapped per date so
  the pill follows wherever the runner is navigating, not the server's own
  `isToday`.
- **`weekCache` / `fetchAndCacheWeek`**: a `planVersion + weekStart`-keyed
  cache of `/api/plan/week`, fetched alongside the existing per-day prefetch
  for the visible week and both neighbors (extended to **two** weeks ahead
  in the polish round below).
- **`isOffline`** (from the existing `.faffReachabilityLost` signal) drives a
  distinct "offline, no cached data" pending state vs. a genuine fetch
  failure — different copy, same retry mechanism.
- **TIMEOUT-1**: `API.authedSend` now bounds every request to 12s instead of
  URLRequest's 60s default, so a connection that's accepted but never
  responds exits loading into a retryable failure instead of hanging.

Live-verified on simulator against an isolated copy of real production data
(the walk-substrate infrastructure, with a correctly-minted, SHA-256-hashed
session token — not a hash read directly off the `sessions` table, which is
the flaw that made every prior HTTP probe this project ran silently 401):
tap-to-future-date, swipe into a never-loaded week (landing on a genuinely
different day-state, a race day), and rapid direction reversal all preserved
the shell and landed on correct content with no screen-swap and no wrong-date
render.

## The polish round — first slice

Once the architecture was fixed, a second, much larger request came in for
motion/tactile polish (native gesture feel, matched-geometry selection,
directional transitions, per-state colors, three-layer preloading,
instrumentation, a full 12-step acceptance recording). That is a multi-day
scope on its own. This round shipped the highest-leverage, independently
verifiable slice of it and named the rest explicitly rather than claiming
more than was actually done.

**Already true before this round, discovered while reading the code —
credit where due:**
- The week strip already used a real `TabView(.page)` (native finger-tracked
  paging, real deceleration, real snapping) — not an approximation.
- The selected-day pill already used `.matchedGeometryEffect`, so it glides
  between cells rather than popping — this satisfies "selection background
  moves using a matched-geometry animation" with no new code.
- `goTo` already fires exactly **one** haptic, on selection intent, guarded
  against re-tapping the same date — never on data arrival, never once per
  date crossed during a swipe. This already satisfies the haptic rules in
  the polish spec.

**Built and shipped this round:**
- **STRIPCOLOR-1**: the week-strip rail used to paint every non-rest day
  identically (one ink, two opacities for done/not-done). It now reuses the
  existing, locked six-ramp day-state palette (`Theme.V5.DayState`, the same
  one that already paints the full panel gradient) — quality reads amber,
  long run reads blue, race reads its own accent, rest stays blank. No new
  colors invented.
- **PANELMOTION-1**: the workout panel used to crossfade on every date
  change with no directional cue. A later date now slides new content in
  from the trailing edge while old content exits leading (reversed for an
  earlier date) — a small ~12pt offset + fade, under the same 200ms
  `V5.Motion.fill` that already governs every other transition here, not a
  new duration. A same-date data refresh keys no `.id` change, so it's
  untouched and stays a pure crossfade, matching the spec's "plan-version
  refresh: brief crossfade, never a slide."
- **PRELOAD-1**: plan-week prefetch extended from visible/prev/next week to
  visible/prev/next-**two** weeks, matching "at rest the app already has ...
  the next two weeks."

Live-verified on simulator: the rail now shows green/amber/blue per day kind
and blank for a genuine rest day; forward navigation (Thursday → Sunday, a
later date) landed on the correct long-run content with the pill following;
backward navigation (Sunday → Tuesday, an earlier date) landed on a
**completed** threshold run's recap (splits, HR, cadence, temperature) — a
state I hadn't deliberately gone looking for, confirming the same code path
handles a completed day correctly too. No crashes, no wrong-date renders, no
shell disruption in either direction.

## Explicitly deferred — not built this round

Named here rather than silently dropped, per this project's own standing
rule that an unenforced or unbuilt claim has to say so:

- **Elastic boundary resistance** at genuine plan start/end (the strip can
  currently page indefinitely past the plan's real edges via pure date
  arithmetic — nothing yet clamps it).
- **Cold-launch persistence** of `weekCache`/`dayCache` to disk. Both are
  in-memory `@State` today and are lost on relaunch; "a normal relaunch
  should not show an empty Today screen" needs a real cache-to-disk layer,
  not just the in-memory one this round extended.
- **Completed-run live-update animation** (fill/check transition, crossfade
  from prescription to summary while Today is open and a run lands) — not
  built or verified this round.
- **Supplemental-run secondary indicator** on the strip — needs a new field
  threaded from the backend through `WeekStripDayV5`; not started.
- **Perceived-speed instrumentation** (signposts/XCTest performance
  metrics for tap-to-selection, cached-render, swipe-settle timings) — not
  built. Everything reported above is *observed* correct behavior, not
  *measured* timing.
- **Full calendar-boundary matrix** (month/year boundary, plan start, plan
  end, two runs one day, plan rebuild while cached dates are visible) —
  only "future day" and "a swipe into a never-loaded week landing on a race
  day" plus the incidental completed-run case above were actually exercised.
- **Offline behavior** (both "showing your saved plan" and "isn't available
  offline" states) — the code exists (`isOffline`, `.offlineNoCache` phase)
  but was not live-tested against a killed connection this round.
- **A physical-device recording.** No tool in this environment can drive or
  record a physical iPhone or the TestFlight app on one — only the
  simulator. Everything above was verified on simulator against a real,
  isolated copy of production data; it is the closest available substitute,
  not the thing that was asked for.

## Shipping

| | Round 1 (architecture) | Round 2 (polish slice) |
|---|---|---|
| Commit | `3dfc7bed` | `05bf799b` |
| Merged to `main` | yes, fast-forward | yes, rebased onto a concurrent merge from another session |
| Railway deploy | `SUCCESS` | `SUCCESS` (`252ca934`) |
| TestFlight build | **255**, VALID, distributed to Internal Testers | **256**, VALID, distributed to Internal Testers |
| XCTest suite | 216/216 green | 216/216 green |

## One more thing found along the way

While confirming the production deploy, `faff.run` (no `www`) turned out to
be serving a completely different, non-Railway backend for every path except
`/` — a generic 404 template from a host that isn't Railway's edge. This
does **not** affect the app: `native-v2/Faff/Faff/API.swift:184` calls
`https://www.faff.run` exclusively, and that host correctly serves the new
build (confirmed 401-gating on unauth API calls, 200 on real pages, matching
the deployed commit). Flagged as a separate background task rather than
chased further here, since it's unrelated to the calendar work and the app
itself is unaffected.
