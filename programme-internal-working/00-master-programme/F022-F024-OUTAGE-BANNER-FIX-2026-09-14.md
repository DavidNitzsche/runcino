# F022 / F024 — Today/Block outage screens + global stale banner removed

**Implementer report. Not a closure. Per the review-protocol role split, the
implementer does not certify its own work — an external reviewer and David's
own device confirmation close these findings, not this document.**

- Branch: `outage-fix/F022-F024-today-block-banner` (created off `origin/main`
  at `2169e664e`, current at the time of implementation)
- Commit: see the commit this file ships with (reported to the caller
  separately — do not hand-copy a SHA into this file before it exists)
- Source docs read in full before implementation: `for external
  review/code-agent-inbox/OD-20260914-001-primary-surfaces-never-outage.md`,
  `OD-20260914-003-remove-global-stale-banner.md`, `for external
  review/findings/ER-20260914-F022.md`, `ER-20260914-F024.md`, `for external
  review/REVIEW-PROTOCOL.md`.

## 1. What was wrong (confirmed by reading the code, not assumed)

- `native-v2/Faff/Faff/ViewsV5/StaleStateV5.swift` defined `StaleBannerV5` /
  `V5StaleBannerModifier` — the top safe-area "Can't reach faff. Showing what
  you had ___ ago." banner with a Retry button.
- `TodayHostV5`, `BlockHostV5`, `RacesHostV5` (`HostsV5.swift`) all attached it
  via `.v5StaleBanner(...)`, unconditionally, over otherwise-usable content.
- `TodayHostV5`/`BlockHostV5`'s `surface.isOutage` branch rendered
  `OutageBodyV5` — an `ErrorNote`-with-Retry, a height-reserving `Skeleton`,
  and a `CoachSay` reassurance paragraph — the exact composition named in
  David's ruling, whenever a background refresh failed and nothing had ever
  been decoded into the live `V5Surface.model`.
- `StateScreensV5.swift`'s `DataOutageV5` (screen 16a) staged this same
  rejected composition as a live, reachable design-gallery specimen in
  `ScreensCatalogV5`, contrary to the owner-direction doc's explicit
  instruction not to preserve it "as a hidden gallery specimen or canonical
  example."
- **Independently discovered, already fixed on `origin/main` before this
  session started:** `AppCache.swift`'s `COLDOPEN-1` (2026-09-11) had already
  removed the 12-hour age gate from `AppCache.read`, so a cached `V5Today`/
  `V5Block` payload now survives on disk indefinitely and seeds `V5Surface`
  regardless of age. This meant `surface.isOutage` (`model == nil && stale`)
  was already unreachable for Today/Block except on a genuine first-ever
  sync — the owner-direction doc's own "known implementation seam" section is
  accurate as a historical description of the defect but slightly stale
  against current `main`. Verified by reading the file and its own header
  comment before writing any code, per this project's Rule 18/20 discipline
  (don't trust a described defect without reading the current source).
- **A residual defect COLDOPEN-1 did not close, and the actual reason F022's
  day-rollover criterion still needed a real fix:** because a cached
  `V5Today` payload now survives indefinitely, a phone that goes offline
  before a calendar-day rollover keeps rendering the STALE payload's own
  baked `dateISO`/`weekStrip.isToday` as a `.match` for "today" — i.e. it can
  render YESTERDAY's session, correctly formatted, confidently labelled
  "Today." This is exactly the defect named in F022's acceptance criterion 3.

## 2. The fix

### F024 — banner deleted outright, not hidden

- `StaleStateV5.swift` gutted to a historical note; `StaleBannerV5`,
  `V5StaleBannerModifier`, the `.v5StaleBanner` extension, and its preview are
  gone, not commented out.
- All three real call sites (`TodayHostV5`, `BlockHostV5`, `RacesHostV5` in
  `HostsV5.swift`) had `.v5StaleBanner(...)` removed.
- `StateScreensV5.swift`'s `StateScreenScaffold` lost its `StaleBannerWiring`
  parameter and its internal `.v5StaleBanner(...)` composition (every real
  caller passed `nil` for it already — confirmed by reading all five callers
  before deleting).
- `DataOutageV5` (screen 16a), its `ScreensCatalogV5` entry, its
  `V5Today.sampleOutageV5` fixture, and its `#Preview` are deleted — the
  rejected composition no longer exists anywhere in the app, including the
  debug gallery.
- `ScrollClock3RegressionV5` (a harness that existed only to exercise the
  scaffold's now-deleted `staleBanner` parameter) and its `ScreensCatalogV5`
  entry are deleted.
- Two now-obsolete UI tests deleted as "banner-only tests" per the
  owner-direction doc's own instruction: `ScrollHeaderStatusBarCollisionUITests
  .testStaleBannerNeverLeavesABlackGapBehindTheStatusBarClock` and the entire
  `StateScreenScaffoldStaleBannerCompositionUITests` class. Both asserted the
  banner's Retry button existed and its composition order was correct —
  assertions that are false-by-construction once the banner is gone.
- `V5Surface.stale`/`cachedAt` (`SurfaceStoreV5.swift`) are UNCHANGED — they
  still drive the debounced silent background retry
  (`LateFailureBannerTests`' own coverage, re-run and still green). UI
  deletion did not require deleting that internal recovery state, per the
  owner-direction doc's own instruction.
- Comments in `PanelV5.swift`, `StateScreensV5.swift` describing the deleted
  mechanism updated from present tense ("this scaffold now owns...") to past
  tense / "removed", so no surviving comment asserts the banner as current
  behavior.

### F022 — PlanSnapshotStore becomes the owning fallback, not `OutageBodyV5`

**`TodayHostV5` (`HostsV5.swift`):**

1. New `dayRolloverOverride: String?` — when there is no explicit navigation
   (`viewingDate == nil`) and the live/cached `V5Today.model`'s own baked
   "today" (`todayISO(model)`) disagrees with the REAL calendar day
   (`Self.localTodayISO()`, computed from the device clock in
   `RunnerTimezone.current` — the same timezone resolver
   `HealthKitImporter.swift` already uses for local-date bucketing, never
   from a network payload), AND `PlanSnapshotStore` has an entry for the real
   date, this returns the real date. The existing browsed-date snapshot
   short-circuit at the top of `body` (`if let effectiveDate = viewingDate ??
   dayRolloverOverride, ...`) then renders through it — the SAME code path a
   runner's own explicit day navigation already used, now also reachable
   automatically on a day-boundary mismatch. Zero behavior change when the
   cached model still agrees with the real day (the overwhelming common
   case).
2. `stripDays(for:)`'s `selected` line also consults `dayRolloverOverride`,
   so the week-strip's own "today" pill lands on the correct day too, not
   just the content pane.
3. New `snapshotOnlyCard(for:day:)` — the fallback for `surface.isOutage`
   (no live/cached model at all): if `PlanSnapshotStore.shared.current?.day(on:
   Self.localTodayISO())` exists, render it using the SAME header+strip
   scaffold `pendingCard` already draws without a network model, and the
   SAME `HeroDayPanelContentV5` + `PlanSnapshotDayView` content the
   browsed-date branch already draws for an open prescription. `OutageBodyV5`
   is never reached from `TodayHostV5` any more.
4. If PlanSnapshotStore ALSO has nothing (genuine first-use, never synced),
   render a compact, deliberately non-`OutageBodyV5` state: `wayOutHeader` +
   `Silence("Not synced yet. Connect once to bring today's plan to this
   phone.")` + a small `FaffButton("Try again", variant: .secondary, size:
   .md, full: false)`. No skeleton, no `ErrorNote`, no reassurance paragraph
   — the composition David rejected does not reappear under a different name.

**`BlockHostV5` (`HostsV5.swift`):**

1. `surface.isOutage` now checks `PlanSnapshotStore.shared.current` first. If
   it has days, renders `BlockHostV5.snapshotOnlyBody(_:)` — a new, honest,
   COMPACT subset view: a `CoachSay` line plus a plain `ListGroup` of the
   next 21 upcoming days (`date_iso >= today`) with type/distance, sourced
   directly from the versioned snapshot. Deliberately NOT a reconstruction of
   the full `BlockV5` screen (phases, proposals, pace-zone summaries,
   progress percentages) — `PlanSnapshotStore` was never asked to persist
   those fields, and inventing values for them would itself be a doctrine
   violation (a confident number measured off the wrong thing).
2. If PlanSnapshotStore also has nothing, the same compact
   `Silence`/`FaffButton` floor as Today, worded for Block.
3. `OutageBodyV5` is never reached from `BlockHostV5` any more.

**`RacesHostV5`:** banner removed (F024); `OutageBodyV5` unchanged — Races has
no local-truth fallback of its own and is explicitly out of this pass's fix
scope (audited, not fixed — see §4).

**`SurfaceStoreV5.swift`:** `V5OutageCopy.today`/`.block` deleted (they were
David's exact rejected Today/Block outage sentences, now unreachable from any
call site) and `OutageBodyV5.copy` changed from a defaulted parameter
(`= .today`) to a required one, so no future call site can silently fall back
to a deleted default.

### Account isolation — a real, independently-discovered gap, fixed as part of this work

While tracing every reader of `PlanSnapshotStore` for the F022 fallback,
found that `PlanSnapshotStore`'s on-disk file (`Application
Support/plan_snapshot.v1.json`) was **never cleared on sign-out or identity
change** — `AppCache.clearAll()` only sweeps `UserDefaults` keys prefixed
`faff.cache.`, and this file lives outside that. This was a narrow,
low-consequence gap while `PlanSnapshotStore` only backed offline
day-navigation; this fix makes it Today/Block's OWNING fallback on a failed
read, which turns the same gap into a real account-isolation leak — the next
runner on the same device could be handed the PREVIOUS runner's actual
authored plan the instant a background refresh so much as blips, no full
outage required.

Fixed: `PlanSnapshotStore.clearForSignOut()` (new, always-compiled — the
existing `#if DEBUG`-only `resetForTesting()` now delegates to it) wipes the
in-memory state and the on-disk file. Wired into both places
`AppCache.clearAll()`/`purgeUserTiedStores()` already are:
`AppCache.bindOwner(_:)` (covers an expired session, which never reaches the
sign-out button) and `SessionHygiene.signOut()` (covers the explicit
sign-out path, which `bindOwner` never reaches). This mirrors the existing
split for `AppCache.purgeUserTiedStores()` at the same two call sites.

**Verification for this specific fix is code-review + full-test-suite level,
not live-rendered** — the addition is two one-line calls to a new,
straightforward method, at two call sites that already carry the identical
pattern for `AppCache.clearAll()`. Driving a full sign-out UI flow reliably
in the simulator during this session ran into simulator-side unreliability
described in §5; given the size of this deliverable already, I judged
re-deriving a robust UI-automation path for this one narrow addition to be
lower value than the time it would cost, and I am reporting it as such rather
than fabricating render evidence for it. The full `FaffTests` suite (492+
cases) passes with this change in place.

### Regression gate (F022 §9 / F024's own requirement)

New `scripts/check-no-outage-banner.sh`, wired into `web-v2/package.json`'s
`prebuild` chain (the same CI gate `check-panel-ink.sh`/`check-xcodeproj-sync
.sh` already ride for native-v2-scanning checks that have no dedicated
native-only CI job). Four guards:

1. `StaleBannerV5`/`V5StaleBannerModifier`/`v5StaleBanner(` may never be
   declared again anywhere under `native-v2/Faff/Faff`.
2. `.v5StaleBanner(` may only appear as the literal comment placeholder
   `.v5StaleBanner(...)` — any other occurrence is a real attachment.
3. `OutageBodyV5(` may never appear inside `TodayHostV5`'s or `BlockHostV5`'s
   own struct body in `HostsV5.swift` (extracted by line range between the
   `struct <Name>` declaration and the next top-level `struct`/`// MARK:`
   boundary).
4. `V5OutageCopy.today`/`.block` may never be re-declared in
   `SurfaceStoreV5.swift`.

**Falsified in both directions before trusting it (Rule 18):** each guard was
independently broken on purpose (re-declaring `StaleBannerV5`; a live
`.v5StaleBanner(stale:...)` call; an `OutageBodyV5(...)` call inside
`TodayHostV5`; re-adding `V5OutageCopy.today`) and confirmed to fail with the
correct message, then restored and confirmed clean. One real bug was found
and fixed during this falsification: guard 3's original implementation piped
a large extracted struct body through `printf '%s\n' "$body" | grep -q
'...'`, and `grep -q`'s early exit on the first match caused `printf` to
receive SIGPIPE, which `pipefail` reported as the pipeline's exit status
(141) — masking a real match as "not found." Fixed by using a bash
here-string (`grep -q '...' <<< "$body"`) instead, which has no second
writing process to receive the pipe closure. Documented in the script's own
header per this project's convention.

## 3. Render evidence (Rule 13)

**No production credentials are available in this isolated agent worktree**
(`web-v2/.env.local` does not exist here, so `DATABASE_URL_RO`-dependent
harnesses — `walk-substrate.sh`, `sandbox-setup.sh`, `_build_roundtrip_scratch
.sh`, and the `-faffToken`-against-a-real-QA-account path `FaffApp.swift`
itself documents — are all unavailable). This is the correct, expected state
for a credential-isolated worktree, not a shortcut being taken.

**What was done instead, and why it still satisfies Rule 13's substance:** a
minimal stdlib-only local HTTP mock (`/private/tmp/.../scratchpad/mock_server
.py`) served schema-valid, Decodable-contract-exact JSON fixtures — `V5Today`
adapted from this app's own proven-good `TodayBeforeV5.sampleBeforeRunJSON`
fixture, `PlanSnapshot` hand-built against `PlanSnapshotModels.swift`'s own
field contract — over the REAL native networking stack
(`API.baseURL`/`URLSession`/`V5RequestCoalescer`/`JSONDecoder`), into the REAL
`AppCache`/`PlanSnapshotStore` persistence, rendered by the REAL, actually
shipped `TodayHostV5`/`BlockHostV5` SwiftUI views on a booted iPhone 17 Pro
simulator (`793CC699-AA75-4E4E-BB29-344BF7776C01`) running the real Debug
build (`xcodebuild ... build`, not a SwiftUI Preview/canvas — the exact thing
Rule 13's own history names as having skipped the code path that broke
before). `-faffToken`/`-faffHost` are this app's own existing, `#if
DEBUG`-gated verification launch arguments (`FaffApp.swift`), not something
built for this task. The only honest caveat: the JSON content is synthetic,
not David's actual account data — every screenshot below is captioned with
that fact baked into the rendered "About" card so it is unmistakable in the
image itself.

**A real tooling problem was hit and is disclosed rather than papered over:**
the `mcp__Claude_Code_iOS_Simulator__control` MCP tool's `screenshot` action
returned stale/incorrect frames after a stray `attach` call to a second
simulator device left two panels attached simultaneously; several
intermediate captures during this session showed content that did not match
the live device state, and one of them briefly looked like a real defect
(the true-never-synced test appearing to show stale content on a verified-empty
fresh container). This was caught, root-caused (not simply reasoned around)
by cross-checking against the actual on-disk container contents
(`plutil -p` on the real sandboxed preferences file, confirmed empty) and by
switching to `xcrun simctl io screenshot` (which reads the simulator's
framebuffer directly, bypassing the MCP tool) for every capture below. Every
screenshot in this report was captured or re-captured with `simctl io
screenshot` after that switch; none of the final evidence relies on the
unreliable tool path. The full erase/reinstall/reverify sequence is not
theatre — the day-rollover result specifically was independently
re-produced end-to-end after this fix, because it was the single most novel
and consequential claim in this whole change.

### 3.1 Online / synced baseline (Today)

Real local server → real decode → real cache write. `Threshold · 5 mi`,
Monday 14 Sep, matching the mock fixture exactly.

### 3.2 Offline with a valid cache (Today) — F022/F024 core case

Same app, same install, relaunched pointed at `http://127.0.0.1:1` (nothing
listening). Identical render to 3.1, taken twice a minute apart to rule out a
delayed banner. **Zero banner, zero outage screen, zero skeleton** — the
exact behavior David's ruling requires and the opposite of what shipped
before this fix.

### 3.3 Day-rollover (Today) — the most novel, most load-bearing result

`AppCache`'s `v5.today` entry seeded directly (via `defaults write ... -data`,
through the same `cfprefsd` path the real app reads) with a payload dated
**yesterday** (2026-09-13, "Long run · 16 mi," `weekStrip.isToday` on the
13th) while `PlanSnapshotStore`'s real, previously-synced file covered
**today** (2026-09-14, "Threshold · 5 mi"). Relaunched fully offline.

**Result: the app rendered "Threshold · 5 mi," Monday the 14th, with the
week-strip's own highlighted pill correctly on 14 — not the stale cached
"Long run" content, and not an outage screen.** This is `dayRolloverOverride`
firing exactly as designed, independently reproduced twice (once via the MCP
tool before it became unreliable, once via `simctl io screenshot` afterward,
on a freshly-erased device, to rule out any tool or state-leakage artifact).

### 3.4 Block, offline with the snapshot as owning fallback

`/api/v5/block` mocked as a bare `500` (no `refusal`/`reason` key, so the
client's own `v5()` helper classifies it `.failed`, i.e. a genuine outage —
never `.absent`). Result: `BlockHostV5.snapshotOnlyBody` rendered — "The
block did not load. Showing your saved plan — this fills back in once the
connection returns." followed by a plain list ("Mon 14 Sep · Threshold · 5.0
mi", "Tue 15 Sep · Easy · 6.0 mi") pulled directly from `PlanSnapshotStore`.
Correctly EXCLUDED the past day (Sun 13 Sep · Long run) per the `date_iso >=
today` filter. No `OutageBodyV5`.

### 3.5 Races — banner gone, existing outage floor unchanged (in-scope-for-banner-only)

`/api/v5/races` also mocked as `500`, and Races had never been visited while
online in this session (no cache to fall back to). Result: `OutageBodyV5`
still renders (correct — unchanged, out of F022's fix scope for this
surface) with its own in-card `ErrorNote` + Retry, but **no global banner at
the top of the screen** — confirming F024's deletion reaches Races too.

### 3.6 True never-synced first-use state (Today and Block)

Simulator fully erased (`xcrun simctl erase`), app freshly installed, launched
offline with `-faffToken` (bypasses sign-in, per the app's own existing
mechanism) and genuinely zero cached bytes (verified directly against the
container's on-disk preferences plist and the absence of
`plan_snapshot.v1.json` before launching). Result on both tabs: the new
compact floor — "Not synced yet. Connect once to bring today's plan / your
block to this phone." plus a small "Try again" button. **Not** `OutageBodyV5`
— no skeleton, no `ErrorNote`, no reassurance paragraph.

### 3.7 Reconnect

From the never-synced state (3.6), relaunched pointed back at the working
mock server. Result: real content ("Threshold · 5 mi") appeared immediately
on the very next launch, with no manual retry needed beyond the launch
itself — satisfying "reconnection refreshes the visible model without
requiring a tap."

## 4. Audit of sibling surfaces (per the owner-direction doc's explicit "audit, do not fix" instruction)

Not implemented — named here so David/the programme lead can decide whether
any of them warrant a follow-up pass, per the doc's own "do not expand
implementation beyond Today and Block without naming the affected behavior
and evidence; bring David into any larger structural proposal."

| Surface | Durable local truth available? | Current outage floor | Notes |
|---|---|---|---|
| Races | No — `V5Races` has no local snapshot equivalent | `OutageBodyV5` | Banner removed (F024); outage screen itself untouched, out of scope |
| Paces | No | `OutageBodyV5` | Untouched |
| Race detail | No | `OutageBodyV5` | Untouched |
| Return-to-running | No | `OutageBodyV5` | Untouched |
| Run log | No | `OutageBodyV5` | Untouched |
| Run detail | No | `OutageBodyV5` | Untouched |
| Decision history | No | `OutageBodyV5` | Untouched; its own reassurance copy already argues the emptiness away — lowest-priority candidate if this is ever revisited |
| Tomorrow (injury preview) | No | `OutageBodyV5` | Untouched |

None of these have an equivalent to `PlanSnapshotStore` — a durable,
independently-synced, versioned local copy of their own domain — so building
a local-truth fallback for any of them would be new engineering, not a
reuse of an existing mechanism, which is exactly the "larger structural
proposal" the owner-direction doc says needs David brought in first.

## 5. What was falsified, what was not, and open items for the reviewer

- Falsified: the regression gate (§2, all 4 guards, both directions).
- Falsified: none of the six render states in §3 were assumed — every one was
  produced by actually breaking the corresponding precondition (killing the
  host, seeding a stale cache, erasing the simulator) and observing the
  result, not by reading the code and inferring the screen.
- **Not falsified / not independently re-verified:** the account-isolation
  fix (§2, "Account isolation") — see that section's own note. Code-reviewed
  and covered by the full test suite, not rendered.
- **A tooling problem, not a code problem, is disclosed in §3** rather than
  silently worked around, per this project's own standing practice of
  reporting a gate/tool that misbehaves rather than only reporting the
  passing result it eventually produced.
- I did not attempt Races/Paces/etc. local-truth fallbacks — see §4.
- I did not push, merge, or mark F022/F024 closed — per the review protocol
  and this task's own explicit instruction, that is the reviewer's and
  programme lead's call.

## 6. Files changed

```
native-v2/Faff/Faff/AppCache.swift
native-v2/Faff/Faff/DesignV5/PanelV5.swift
native-v2/Faff/Faff/PlanSnapshotStore.swift
native-v2/Faff/Faff/Util/SessionHygiene.swift
native-v2/Faff/Faff/ViewsV5/HostsV5.swift
native-v2/Faff/Faff/ViewsV5/ScreensCatalogV5.swift
native-v2/Faff/Faff/ViewsV5/StaleStateV5.swift
native-v2/Faff/Faff/ViewsV5/StateScreensV5.swift
native-v2/Faff/Faff/ViewsV5/SurfaceStoreV5.swift
native-v2/Faff/FaffUITests/ScrollHeaderStatusBarCollisionUITests.swift
scripts/check-no-outage-banner.sh (new)
web-v2/package.json
```

`native-v2/Secrets.xcconfig` was created locally (copied from
`Secrets.example.xcconfig`) purely to make `xcodebuild` runnable in this
worktree — it is gitignored and carries a blank CARTO key, matching this
project's own documented convention for exactly this situation
(`native-check.yml`'s CI job does the identical copy for the identical
reason). Not part of the commit.

## 7. Build and test evidence

- `xcodebuild -project native-v2/Faff.xcodeproj -scheme Faff -destination
  'generic/platform=iOS Simulator' -configuration Debug build` → **BUILD
  SUCCEEDED**, both before and after the account-isolation addition.
- `xcodebuild ... build-for-testing` (FaffTests + FaffUITests) → **TEST BUILD
  SUCCEEDED**.
- `xcodebuild ... -only-testing:FaffTests test` → **all suites passed**
  (`LateFailureBannerTests`, `SurfaceCancellationTests` individually, then
  the full `FaffTests.xctest` bundle — 'All tests' passed both before and
  after the account-isolation addition).
- `bash scripts/check-no-outage-banner.sh` → clean, all 4 guards, falsified
  in both directions (§2).
