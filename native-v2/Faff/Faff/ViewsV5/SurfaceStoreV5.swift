//
//  SurfaceStoreV5.swift
//  faff.run iPhone · how a v5 screen gets its content, and what it does when
//  it cannot.
//
//  ─────────────────────────────────────────────────────────────────────────
//  TWO RULES DECIDE THIS FILE'S SHAPE
//
//  "Loading/error states reserve their final layout space always — nothing
//   appears or disappears and reflows."
//
//  A screen that fetches in `.task` and renders nothing until it returns
//  reflows by construction. So a surface seeds itself SYNCHRONOUSLY from the
//  last good payload at init, and the fetch is a refresh rather than a first
//  paint. `AppCache.read` is a plain `UserDefaults` read and a decode — there
//  is no async gap to design around.
//
//  RULE THREE: a refusal is a correct answer, not an empty state.
//
//  That splits two things this store must never merge:
//
//    · A REFUSAL arrives INSIDE a successful payload. The engine read it and
//      the answer is no. It is content, it renders as `Alert` or `Silence`,
//      and this store knows nothing about it.
//
//    · An OUTAGE is this store failing to read at all. `ErrorNote`, and only
//      then.
//
//  And a third case that is neither: a fetch that fails while a cached payload
//  is in hand. The screen is not wrong, it is old. The design's own data-outage
//  screen shows exactly this — the readiness section becomes an `ErrorNote`
//  while "a coach line clarifies today's session still works because it's
//  stored on-device". So `stale` is its own state and it does NOT blank the
//  screen.
//
//  COLDOPEN-1 (2026-09-11) · THAT THIRD CASE USED TO BE UNREACHABLE PAST
//  `AppCache.maxAgeSec`, WHICH IS THE BUG THIS DATE MARKS.
//
//  `AppCache.read` used to return nil the instant a decodable, on-disk
//  payload turned 12h01m old — collapsing "there is something honest to
//  show" and "this is recent enough to trust without saying so" into one
//  nil, so a cached payload just past that line and a cold install with
//  nothing ever cached were indistinguishable to this file. Both fell
//  through to the outage screen the moment a refresh failed, even though one
//  of them had a perfectly legible day sitting on disk. `AppCache.read` no
//  longer gates on age at all; `AppCache.withinIdentityWindow` is the
//  narrower question `init` (below) still asks, to decide whether an old
//  seed needs to disclose itself before any refresh has even had a chance to
//  answer. See `docs/audit-2026-09-11-session-handback.md` §5 Finding 1.
//

import Foundation
import SwiftUI

@MainActor
final class V5Surface<Model: Decodable>: ObservableObject {

    /// The last payload we could read. Seeded synchronously at init, so the
    /// first frame is real content whenever there has ever been one.
    @Published private(set) var model: Model?

    /// A refresh failed. If `model` is non-nil the screen is old, not wrong —
    /// keep rendering it and let the affected section say it could not
    /// refresh. If `model` is nil this is the data-outage screen.
    @Published private(set) var stale = false

    /// The engine answered and the answer is that this surface does not apply
    /// — a runner whose paces have never moved, a runner with no injury on the
    /// ladder. Carries the engine's own sentence.
    ///
    /// This is NOT `stale`. Collapsing the two made a screen with nothing to
    /// say claim it had gone blind, which is the one thing rule three forbids.
    @Published private(set) var absentReason: String?

    /// A refresh is running. Never used to blank anything.
    @Published private(set) var refreshing = false

    /// When the payload in hand was written. For a "cached 12m ago"
    /// affordance, if a screen wants one.
    ///
    /// CACHEDAT-1 (2026-09-04) · was a `let`, set once from `AppCache.writtenAt`
    /// at `init` and never touched again — so `StaleBannerV5`'s "showing what
    /// you had ___ ago" kept reporting the age of the surface's FIRST disk
    /// read (app cold launch, in practice) for the surface's entire lifetime,
    /// no matter how many successful fetches landed in between. `APIV5.swift`
    /// writes a fresh `AppCache` entry on every successful V5 fetch (line
    /// ~1670) — the disk timestamp WAS advancing; this property just never
    /// looked again. Caught live: David saw "2 hours ago" on a banner that
    /// had, in truth, refreshed cleanly dozens of times since — a brief blip
    /// minutes earlier was reported with an age that had nothing to do with
    /// it, which is exactly what made "it's never happened so much before"
    /// look like a much longer outage than the one that actually occurred.
    @Published private(set) var cachedAt: Date?

    private let cacheKey: AppCache.Key?
    private var fetch: () async throws -> API.V5Fetch<Model>

    /// STALEDEBOUNCE-1 (2026-09-04) · a single failed `load()` used to flip
    /// `stale` to `true` immediately, and the banner's own `.safeAreaInset`
    /// reflows everything below it the instant that happens (and again the
    /// instant it clears). Found live on David's phone during a night of
    /// rapid back-to-back production redeploys: a brief container swap fails
    /// one request, the banner appears, the very next poll succeeds, the
    /// banner vanishes — a real transient blip, correctly detected, but
    /// shown and hidden so quickly it reads as the whole screen "jumping
    /// around". A genuine, sustained outage should still show the banner
    /// promptly; a one-request blip that resolves itself within about a
    /// second should never have been visible at all.
    ///
    /// LATEFAILURE-1 (2026-09-08) · THE SAME COUNTER NOW ALSO GUARDS THE
    /// OPPOSITE ORDERING, WHICH IT NEVER DID BEFORE.
    ///
    /// This used to be bumped only when an attempt COMPLETED (a success, an
    /// absence, or the moment a failure entered its debounce wait) — never
    /// when one STARTED. That is exactly backwards for what David hit live:
    /// a real 502/timeout storm across several endpoints, then a real
    /// recovery (`/api/v5/today` itself came back 200), and the outage
    /// banner never cleared — while his own Request Log showed `sync
    /// generation` advancing and a recent `last successful sync` (that log
    /// reads `PlanSnapshotStore`, an entirely separate sync machine from
    /// this one; see its own header — this surface's `stale` flag is what
    /// the banner actually reads, and nothing kept the two in step).
    ///
    /// `SurfaceCancellationTests` named this exact gap the day CANCELBANNER-2
    /// landed: "a genuinely-failed load that lands after a healthy one still
    /// raises the banner over current content, indefinitely, until the next
    /// success." The old scheme's guard only asked "did anything else finish
    /// WHILE I was in my own 1.2s debounce wait" — a slow, already-superseded
    /// request that FAILS after a newer request has already SUCCEEDED looks,
    /// under that question, like "the newest event", because nothing recorded
    /// which attempt was actually the latest one asked for.
    ///
    /// Bumping this at the START of an attempt (`load()`'s very first line,
    /// and `presentSync`'s) fixes that: a completion — success, absence, OR
    /// failure — may only touch `model`/`stale`/`absentReason` if it is still
    /// the attempt this counter currently names. A straggling failure from an
    /// older attempt is dropped the instant it is caught, before it can even
    /// schedule a debounced "show" — see `markStaleAfterDebounce` below.
    private var loadAttempt = 0

    /// Point this surface at a different read — the same Today surface serving
    /// a different date, for instance.
    ///
    /// ─────────────────────────────────────────────────────────────────────
    /// THE OLD DAY STAYS UP UNTIL THE NEW ONE ARRIVES
    ///
    /// This used to clear `model` first, which dropped the screen to its
    /// cold-start skeleton for the length of a round trip — a black flash
    /// between two days that are both perfectly fine. Stepping through a week
    /// should feel like turning a page, not like reloading.
    ///
    /// So the current day stays on screen and is replaced only when the next
    /// one is in hand. If the read fails, the runner is still looking at a
    /// real day rather than at nothing.
    func rebind(_ newFetch: @escaping () async throws -> API.V5Fetch<Model>) async {
        fetch = newFetch
        await load()
    }

    /// FETCHOWNER-1 (2026-09-04) · like `rebind`, but does not change what a
    /// LATER, UNRELATED refresh fetches.
    ///
    /// `rebind`/`refreshBehind` permanently overwrite `fetch` — correct for
    /// "the runner is home now, THIS is the canonical fetch going forward"
    /// (Today's own `goTo` calls `refreshBehind` exactly once, for that
    /// case). It is wrong for "fetch this one OTHER date, temporarily,
    /// because the runner tapped it" — that reassignment used to survive
    /// the navigation, so `.faffForegroundRefresh` (app backgrounded then
    /// foregrounded — a completely ordinary interruption, not an edge
    /// case) firing while the runner was looking at a date two weeks out
    /// would silently re-fetch THAT date instead of today, and could hand
    /// the shared "today" surface an `.absent`/failed outcome for a day
    /// that was never today at all. `model`/`stale`/`absentReason` still
    /// update exactly as `rebind` would for THIS call, so `readiness()`'s
    /// `.match` still fires the same way — only the STANDING `fetch`
    /// closure is protected, restored the instant this call finishes.
    func fetchOnce(_ oneOffFetch: @escaping () async throws -> API.V5Fetch<Model>) async {
        let standingFetch = fetch
        fetch = oneOffFetch
        await load()
        fetch = standingFetch
    }

    /// Put a payload the caller already holds on screen NOW, then refresh it
    /// for real behind that.
    ///
    /// ─────────────────────────────────────────────────────────────────────
    /// DAVID, 2026-08-25, THIRD ROUND: "Click on the days needs to feel like
    /// it pushes the data change. Not a button, a load, wait, see it."
    ///
    /// A day already decoded this session needs no round trip to be shown —
    /// it is correct, in memory, and stale by at most a few seconds. This
    /// paints it in the SAME `Task` the caller is already tracking, then
    /// keeps going to fetch the real thing behind it, so a genuinely stale
    /// cached day still self-corrects.
    ///
    /// AN EARLIER VERSION OF THIS EXISTED AND WAS DELETED. It fired its own
    /// untracked `Task { await load() }` internally — a second, independent
    /// unit of concurrency the CALLER could not cancel. Two navigations in a
    /// row could each spawn one, and whichever finished last won the screen,
    /// which was the actual cause of a real "position jumps to the wrong
    /// week" bug, not this technique itself. This version is `async` and
    /// does none of its own task-spawning: the caller wraps the ENTIRE
    /// present-then-refresh sequence in ONE `Task` it owns and can cancel,
    /// exactly like `rebind`. Cancelling that Task here cancels the refresh
    /// too, the same way it always did for a plain `rebind`.
    ///
    /// A HARD CUT, NOT A CROSSFADE. Today keys its content on `dateISO` and
    /// fades between days, which is right when the new day is arriving off
    /// the network — the fade covers the gap. It is wrong when the day is
    /// already in hand: the 200ms would be 200ms of the day the runner just
    /// left, on a tap that had nothing left to wait for.
    func present(_ known: Model, refreshWith newFetch: @escaping () async throws -> API.V5Fetch<Model>) async {
        presentSync(known)
        await refreshBehind(newFetch)
    }

    /// STATEGATE-1 (2026-09-03) · the synchronous half of `present`, split out
    /// so a caller can paint a cache hit on THIS tick — no `await`, no Task
    /// scheduling gap — rather than the async gap `Task { await
    /// surface.present(...) }` leaves between "navigation requested" and
    /// "model actually updated." That gap used to be invisible (the OLD
    /// model just stayed on screen through it), which is exactly the defect:
    /// a caller gating render on "does `model` match the selected date" would
    /// see a false mismatch for one frame on every cache-hit navigation,
    /// the FAST, COMMON case. Calling this directly, synchronously, before
    /// any Task exists, closes that gap to zero.
    ///
    /// NOT A HARD CUT ANY MORE. David, third round: "the motion is there but
    /// then everything just sort of flashes... we need things to move and to
    /// be slick." This used to force `disablesAnimations = true`, reasoning
    /// that the screen's own 200ms crossfade was "200ms of the day you just
    /// left, on a tap that had nothing left to wait for." That reasoning
    /// mistook the fade for a delay. Plain assignment lets the ambient
    /// `.animation(value:)` already on the screen pick it up — the SAME
    /// 200ms fade a network-driven `rebind` already uses, so a cached day and
    /// a freshly fetched one move exactly the same way.
    func presentSync(_ known: Model) {
        // STALEDEBOUNCE-1 / LATEFAILURE-1 · this is itself a new "attempt" —
        // it both cancels any pending delayed-stale task from an earlier
        // failed load (without this, a debounce timer scheduled before this
        // cache hit could still fire afterward and flip `stale` back to true
        // over content that just proved itself current) AND becomes the new
        // "latest" attempt, so a still-in-flight older `load()` that later
        // fails cannot override what this just put on screen either.
        loadAttempt += 1
        model = known
        stale = false
        absentReason = nil
        // CACHEDAT-1 · re-read, not left at whatever `init` saw — a cache
        // hit years into a session should report ITS OWN disk age, not the
        // first one this surface ever observed.
        cachedAt = cacheKey.flatMap { AppCache.writtenAt($0) }
    }

    /// The async half of `present` — refetch behind whatever is already on
    /// screen (a `presentSync`'d cache hit, most callers; a still-current
    /// `model`, if a caller wants only the refresh). Never touches `model`
    /// itself except through `load()`'s own success path, so a refresh that
    /// fails leaves the visible content exactly where `presentSync` put it.
    func refreshBehind(_ newFetch: @escaping () async throws -> API.V5Fetch<Model>) async {
        fetch = newFetch
        await load()
    }


    init(cache: AppCache.Key?, fetch: @escaping () async throws -> API.V5Fetch<Model>) {
        self.cacheKey = cache
        self.fetch = fetch
        self.model = cache.flatMap { AppCache.read($0, as: Model.self) }
        self.cachedAt = cache.flatMap { AppCache.writtenAt($0) }

        // COLDOPEN-1 (2026-09-11) · A SEEDED CACHE PAST THE IDENTITY WINDOW
        // DISCLOSES ITSELF, EAGERLY — IT DOES NOT WAIT FOR A FAILURE.
        //
        // `AppCache.read` used to return nil the instant a payload turned
        // `maxAgeSec` old, so this class never had to think about "old but
        // decodable" as a seed state — it simply never saw one. Now it does,
        // and rendering it silently (`stale` starting `false`, same as a
        // warm cache) would resurrect the exact bug `maxAgeSec` was written
        // to close: a phone that has been offline since yesterday would show
        // yesterday's plan as today's with nothing on screen saying so, right
        // up until a refresh either confirms it (silently) or fails (after
        // STALEDEBOUNCE-1's own 1.2s). See
        // `docs/audit-2026-09-11-session-handback.md` §5 Finding 1.
        //
        // So a seed outside `AppCache.withinIdentityWindow` schedules the
        // SAME disclosure a failed refresh would, from the moment this
        // surface exists — deliberately NOT keyed on `loadAttempt`, which
        // answers a different question ("which REQUEST is newest") than the
        // one here ("has ANY confirmed answer landed since this surface was
        // seeded"). `loadAttempt` is bumped at the START of every `load()`
        // call, success or failure alike, so a debounce keyed on it would be
        // superseded the instant `.task` calls `load()` — before that load
        // has actually answered anything — and would never fire at all.
        // `discloseAgeIfStillUnconfirmed` instead watches `cachedAt` itself,
        // which only moves on a CONFIRMED fresh read (`load()`'s `.ok` case,
        // or `presentSync`), so it can tell "a live answer arrived" from "a
        // request merely started."
        //
        // The debounce is what keeps this SILENT in the common case: a
        // stale-but-decodable cache with a healthy network refreshes well
        // inside 1.2s and this never becomes visible at all. Only a refresh
        // that is slow, or fails outright, is disclosed — same threshold
        // STALEDEBOUNCE-1 already uses for a failure, applied here to a seed
        // this class already knows it cannot vouch for.
        if let cache, self.model != nil, !AppCache.withinIdentityWindow(cache) {
            discloseAgeIfStillUnconfirmed(since: self.cachedAt)
        }

        // FOREGROUND IS A READ.
        //
        // Every legacy screen listened for this; none of the v5 screens did,
        // so a run that landed while the app was open — a HealthKit import on
        // foreground, a Strava sync — left Today asking for a run the runner
        // had already done. Watched live: a treadmill run ingested at 13:45
        // and Today kept showing the pre-run screen until the app was killed.
        //
        // Every surface takes the refresh. They are cheap reads, the shell
        // keeps all three stacks alive, and `load()` never blanks what is
        // already on screen.
        //
        // REQUESTSTORM-2 (2026-09-06) · throttled against `.foregroundLoadCoalesceSec`.
        // `FaffApp` posts `.faffForegroundRefresh` TWICE per real foreground
        // on purpose (see its own comment), and this is the ONE place that
        // decides how many times THAT turns into an actual `load()` — not a
        // per-view modifier, because a view can come and go, or add its own
        // second observer on the same notification, and this surface's own
        // request count must not depend on which view happens to be showing
        // it. Without this, every `V5Surface` reloaded twice per foreground,
        // and Today/Block/Races reloaded a THIRD time on top of that because
        // `v5ReloadOnForeground` called `surface.load()` again, throttled
        // only against its own two calls, blind to this observer entirely.
        // See `ForegroundWork.shouldLoadOnForeground`'s doc comment for the
        // full incident.
        foreground = NotificationCenter.default.addObserver(
            forName: .faffForegroundRefresh, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                let now = Date()
                guard ForegroundWork.shouldLoadOnForeground(now: now, lastLoadAt: self.lastForegroundLoadAt) else { return }
                self.lastForegroundLoadAt = now
                await self.load()
            }
        }
    }

    private var foreground: NSObjectProtocol?
    /// REQUESTSTORM-2 · when this surface last acted on `.faffForegroundRefresh`.
    /// `.distantPast` so the very first post (app launch/first foreground)
    /// always goes through.
    private var lastForegroundLoadAt: Date = .distantPast

    deinit {
        if let foreground { NotificationCenter.default.removeObserver(foreground) }
    }

    /// True exactly when the design's data-outage screen applies: we have
    /// nothing at all and the last read FAILED. Not "we are loading", and not
    /// "there is nothing here" — that one is `absentReason`.
    var isOutage: Bool { model == nil && stale && absentReason == nil }

    /// True on a genuine cold start — no cache, no failure yet. This is where
    /// a `Skeleton` goes, reserving the real content's height.
    var isColdStart: Bool { model == nil && !stale && absentReason == nil }

    func load() async {
        // LATEFAILURE-1 (2026-09-08) · claim an attempt number BEFORE the
        // first `await`, not after. This is the whole fix: every completion
        // below — success, absence, or failure — checks it still belongs to
        // the newest attempt this surface has asked for, so an older,
        // slower request can never speak for the surface once a newer one
        // has already answered. See `loadAttempt`'s own doc comment for the
        // incident this closes.
        loadAttempt += 1
        let myAttempt = loadAttempt
        refreshing = true
        defer { refreshing = false }
        do {
            switch try await fetch() {
            case .ok(let fresh):
                // Superseded by a newer attempt (started after this one, and
                // either still in flight or already answered) — this result
                // is stale data arriving late and must not overwrite
                // whatever that newer attempt already decided, success or
                // failure alike.
                guard myAttempt == loadAttempt else { return }
                model = fresh
                stale = false
                absentReason = nil
                // CACHEDAT-1 · this fetch just wrote a new `AppCache` entry
                // (`APIV5.swift`'s shared V5 fetch helper). `Date()` directly
                // rather than re-reading disk: the write already happened,
                // and there is nothing a round trip through `AppCache.writtenAt`
                // would tell us that we do not already know.
                cachedAt = Date()
            case .absent(let reason):
                guard myAttempt == loadAttempt else { return }
                // The engine decided. Not an outage, and not something to
                // paper over with a cached payload from when it did apply.
                absentReason = reason
                model = nil
                stale = false
            case .failed:
                markStaleAfterDebounce(attempt: myAttempt)
            }
        } catch {
            // CANCELBANNER-2 (2026-09-08 review) · A SCREEN GOING AWAY IS NOT
            // AN OUTAGE, AND IT WEARS TWO DIFFERENT ERROR TYPES.
            //
            // This used to be `catch is CancellationError`, which is only HALF
            // the cancellation vocabulary. `URLSession.shared.data(for:)` is
            // Task-cancellation-aware and throws EITHER Swift concurrency's
            // `CancellationError` OR Foundation's `URLError(.cancelled)` —
            // which one is not guaranteed across OS/SDK versions, which is
            // exactly why `API.isCancellation` exists and checks both. This
            // call site was the one place that did not use it, so every
            // cancellation that arrived as `URLError(.cancelled)` fell through
            // to the generic catch, took `markStaleAfterDebounce()`, and one
            // second later the runner was reading the full "cannot reach the
            // server" screen about a request the app itself had superseded.
            //
            // Measured by a reviewer on the real app: the outage screen stood
            // for 25-41 seconds with NO `/api/v5/today` request ever having
            // been ISSUED, and once for 69 seconds AFTER the real request had
            // already returned 200 — because the load that superseded this one
            // had long since painted, and nothing about that success could
            // reach a `stale` flag this cancelled sibling had already set.
            //
            // Rule 11: cancelled, failed and absent are three facts. The load
            // that superseded this one is what decides the screen; this one
            // says nothing, because it never got an answer to report.
            if API.isCancellation(error) { return }
            markStaleAfterDebounce(attempt: myAttempt)
        }
    }

    /// STALEDEBOUNCE-1 · does not set `stale` itself. Waits out a short
    /// window first, so a load that succeeds in the meantime — the common
    /// case for a one-off blip — cancels this one by bumping the generation
    /// before it fires. 1.2s: long enough to absorb a single dropped request
    /// during a container swap, short enough that a GENUINE outage still
    /// shows the banner well within what would read as "instant" to a
    /// runner glancing at the screen.
    ///
    /// LATEFAILURE-1 · `attempt` is `load()`'s OWN attempt number, captured
    /// before its `await`, not a fresh generation minted here. That is the
    /// fix: the old version bumped the counter itself at this point, which
    /// made every failure look like "the newest event" regardless of when it
    /// actually started. Checked TWICE now — once immediately, so an already-
    /// superseded failure cannot even schedule a delayed "show", and once
    /// after the wait, for a newer attempt that starts (or lands) DURING the
    /// debounce window.
    private func markStaleAfterDebounce(attempt: Int) {
        guard attempt == loadAttempt else { return }
        Task {
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            guard attempt == loadAttempt else { return }
            stale = true
        }
    }

    /// COLDOPEN-1 · the init-time twin of `markStaleAfterDebounce`, for a
    /// seed this surface already knows is outside `AppCache`'s identity
    /// window rather than for a request that failed.
    ///
    /// `seededAt` is the disk timestamp `cachedAt` held at the moment this
    /// was scheduled. After the same 1.2s STALEDEBOUNCE-1 already uses, the
    /// only question is whether `cachedAt` still holds THAT SAME value: if
    /// it does, nothing has confirmed this content since, and the age is
    /// disclosed; if it has moved on, a `load()` (or a `presentSync`) landed
    /// a real answer in the meantime and there is nothing to say. This is
    /// deliberately not the `loadAttempt` machinery `markStaleAfterDebounce`
    /// uses — see the call site in `init` for why that counter answers the
    /// wrong question here.
    private func discloseAgeIfStillUnconfirmed(since seededAt: Date?) {
        Task {
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            guard cachedAt == seededAt else { return }
            stale = true
        }
    }
}

// MARK: - What a write settled as
//
// ─────────────────────────────────────────────────────────────────────────
// TODAYWRITE-1 (2026-09-08 review) · THE WRITE-SIDE TWIN OF THIS FILE'S
// OWN RULE THREE.
//
// The store above is careful about what a failed READ is allowed to claim.
// Nothing was careful about a failed WRITE, and a Product Experience review
// of the real app measured the consequence four ways — rendering, a direct
// database query, the network log, and the code:
//
//   · Flagging a niggle drew "Left calf flagged · The coach has it, it
//     shapes tomorrow" while `POST /api/niggle` recorded ZERO rows.
//   · Reporting illness drew "Reported · Logged. Today rests." with the
//     same nothing behind it.
//
// Both were `_ = try? await API.authedSend(req)` in `HostsV5.swift` — the
// success/failure of the write thrown away at the call site — combined with
// a view that moved its own `@State` to the CONFIRMED row's exact copy the
// instant the button was pressed. The runner read a sentence the app had no
// evidence for, about the one topic (pain, illness) where being wrong costs
// the most.
//
// This is Rule 11 at a write: LANDED, DID-NOT-LAND and CANCELLED are three
// facts and a `try?` collapses all three into silence. It is also the rule
// `TodayAfterV5`'s own Strava push already follows in the same file — "only
// flips to `.done`/`.dup` on the server's own confirmed status, never
// optimistically, per the bug this replaced" — and the rule `AddRaceV5` and
// `RPECaptureRow` follow: on failure they say so, in the runner's words,
// with a way to try again.
//
// ─────────────────────────────────────────────────────────────────────────
// THREE NEARBY NAMES, THREE DIFFERENT QUESTIONS. Rule 16 forbids two names
// for one quantity; it does not license one name for three. Read this before
// adding a fourth:
//
//   · `V5WriteSettlement` (here) — DID THE SERVER TAKE IT. A fact about the
//     write, with no copy attached, so the screen decides what to say.
//   · `V5WriteOutcome` (DesignV5/ComponentsV5.swift) — WHAT NOTE TO DRAW.
//     Carries the engine's own sentence and picks `Alert` vs `ErrorNote`;
//     it has no "it worked" case at all, because a note is only drawn when
//     something needs saying. `RaceDetailV5`/`RacesV5` use it.
//   · `SettingsHostV5.WriteSettlement` — MUST I DROP MY CACHE. A question
//     about `SettingsCache`, not about a screen. Collapsing it into this
//     one would put cache-invalidation semantics in a view's hands.
//
// A route that grows a real refusal body should carry BOTH: this type for
// whether the row may claim success, `V5WriteOutcome` for the sentence.
enum V5WriteSettlement: Equatable {
    /// The server took it. The screen may now say so.
    case landed
    /// It did not land, or we could not tell. Either way the screen has NO
    /// evidence the thing it was asked to state is true, so it must not
    /// state it — it says what happened and offers the write again.
    ///
    /// TODAYWRITE-2 (2026-09-08 review) · AND IT MUST NOT STATE THE OPPOSITE
    /// EITHER. The first cut of this enum was right and its COPY was not:
    /// five rows read "Nothing was written", "Not saved", "The coach has not
    /// seen this yet", "the plan has not changed". Every one of those is a
    /// confident claim about the SERVER, and this case cannot support one.
    ///
    /// `API.authedSend` bounds a request at 12 seconds (TIMEOUT-1). A write
    /// that reaches the server, is saved, and whose answer is slower than
    /// that — a cold container is enough — arrives here identical to a write
    /// that never left. The row then told the runner nothing was written
    /// about a row that exists, and offered a Retry that inserted a SECOND
    /// one. `/api/sick` and `/api/niggle` were bare INSERTs, and their
    /// recovery endpoints cleared only the most recent episode, so the first
    /// one stayed active forever and the runner stayed in forced rest.
    ///
    /// So the copy for this case says what the PHONE knows ("that was not
    /// confirmed"), never what the server did, and the two routes now refuse
    /// to duplicate an identical active report. Both halves are required:
    /// honest copy over a duplicating write is still a trap, and a
    /// de-duplicating write under lying copy still misinforms the runner.
    ///
    /// INJURYCHECKIN-1 (2026-09-08) · THIS CASE SPLIT, EXACTLY AS THE
    /// PARAGRAPH BELOW SAID IT WOULD.
    ///
    /// It used to read: "a non-2xx and a dropped connection are different
    /// facts, but the phone cannot tell them apart here … when those routes
    /// grow a refusal body, this splits." They have. `.refused` is that
    /// split, and everything else still lands here.
    ///
    /// A non-2xx with NO refusal sentence stays `.didNotLand` on purpose: a
    /// 500, a 404 from a proxy, a route that has not learned the contract —
    /// the phone genuinely does not know, and must not pretend either way.
    case didNotLand
    /// The server answered, in words, that this request can NEVER succeed as
    /// sent. Not a failure to reach it and not a slow success: a permanent,
    /// deterministic no.
    ///
    /// INJURYCHECKIN-1 · WHY THIS IS NOT `.didNotLand`. The injury-flare
    /// check-in (13a) POSTs to `/api/niggle/recovery`, which reads `niggles`,
    /// while the screen itself is drawn off `runner_injuries`. Two tables,
    /// two lifecycles, and nothing in the app writes the second from the
    /// phone at all. So a runner with an open injury and no active niggle got
    /// `404 no active niggle` EVERY TIME, on a healthy network, and the row
    /// rendered `.didNotLand`'s copy: "The coach may not have it yet. Trying
    /// again is safe." Trying again could not work, and the runner had no way
    /// to learn that from the screen.
    ///
    /// Rule 11 one layer deeper than TODAYWRITE-2 took it. "It failed",
    /// "we could not tell" and "it can never work" are three facts, and only
    /// the third one the SERVER can state in words — which is why the
    /// associated value is the server's own sentence rather than a literal
    /// invented here. A screen renders it as an `Alert` with NO Retry, the
    /// shape `AddRaceV5.saveRefusal` already uses for a refusal that is an
    /// answer rather than an outage.
    case refused(String)
    /// The runner's own navigation tore this down before it settled. Not a
    /// failure and not a success: nothing to report, nothing to retry.
    /// Same distinction, same helper, as `load()`'s catch block above.
    case cancelled
}

/// TODAYWRITE-2 · EVERY SENTENCE A `.didNotLand` ROW IS ALLOWED TO SAY.
///
/// These were five string literals buried in five view bodies, and four of
/// them asserted a fact about the SERVER that the phone had no way to know
/// ("Nothing was written", "the plan has not changed", "The coach still has
/// yesterday's answer", "The run is still logged against …"). A literal
/// inside a `body` cannot be read by a test, which is why nothing caught it
/// — Rule 20: a product rule with no gate is a hypothesis.
///
/// Collected here so `WriteHonestyTests` can walk all of them at once, and
/// so the next screen that needs one reaches for an existing sentence rather
/// than inventing a confident new one.
///
/// THE SHAPE, and why every one of them holds in BOTH worlds:
///   · what the PHONE knows — "That was not confirmed" — never what the
///     server did, because `.didNotLand` covers a refusal AND a write that
///     landed and lost its answer.
///   · what MIGHT follow, hedged, so a runner whose write actually landed is
///     not told a falsehood about their own plan.
///   · that retrying is safe, which is TRUE because `/api/sick` and
///     `/api/niggle` now refuse to duplicate an identical active report.
///     Do not keep this clause if that guard is ever removed.
enum V5UnconfirmedCopy {
    /// The niggle flag (`TodayAfterV5`) and the flare check-in
    /// (`StateScreensV5`). ONE sentence for one situation, not two copies:
    /// both are "the coach may not have this pain report".
    static let coachMayNotHaveIt =
        "That was not confirmed. The coach may not have it yet. Trying again is safe."
    /// The daily sick trend (`SickV5.SickFlareV5`).
    static let sickTrend =
        "That was not confirmed. The coach may not have today's answer. Trying again is safe."
    /// The sick report itself (`SickV5.SickReportRowV5`).
    static let sickReport =
        "That was not confirmed. The coach may not have your report yet. Trying again is safe."
    /// The shoe pick (`TodayAfterV5`). "Still shows" is a fact about THIS
    /// SCREEN, true either way — the reload only runs on `.landed`.
    static func shoePick(current: String) -> String {
        "That was not confirmed. The run still shows \(current). Trying again is safe."
    }

    /// Every sentence, for the gate to walk. A new one that is not in here
    /// is invisible to the test, so add it here rather than inline.
    static var all: [String] {
        [coachMayNotHaveIt, sickTrend, sickReport, shoePick(current: "Endorphin Speed 4")]
    }
}

/// INJURYCHECKIN-1 · WHAT A `.refused` ROW SAYS WHEN THE SERVER SENT NO WORDS.
///
/// The sentence normally comes from the server (`lib/health/checkin-refusal.ts`),
/// because only the server knows WHY. This is the floor under that: a 4xx that
/// carries a refusal marker but an empty sentence still must not fall back to
/// `V5UnconfirmedCopy`, whose every line ends "Trying again is safe."
///
/// The one thing this fallback is allowed to assert is the thing the STATUS
/// CODE itself established — that the request was refused, not lost.
enum V5RefusedCopy {
    static let cannotSucceed =
        "The coach answered: there is nothing open to check in on. Trying again will not change that."

    /// Every sentence, for the gate to walk. Same contract as
    /// `V5UnconfirmedCopy.all`.
    static var all: [String] { [cannotSucceed] }
}

/// The whole decision, as a pure function over the two things a write can
/// hand back, so a test can walk every branch without a live outage — the
/// same reason `API.isCancellation` and `SettingsHostV5.settlement(landed:)`
/// are extracted.
///
/// `succeeded` is "the server answered 2xx", NOT "the call returned". Every
/// caller must compute it from the real status code, because
/// `API.authedSend` hands back a 500 without throwing.
func v5WriteSettlement(_ result: Result<Bool, Error>) -> V5WriteSettlement {
    switch result {
    case .success(let succeeded):
        return succeeded ? .landed : .didNotLand
    case .failure(let error):
        return API.isCancellation(error) ? .cancelled : .didNotLand
    }
}

/// Run a write and settle it. The one place the `do/catch` lives, so no
/// caller re-types it and none of them can go back to `try?`.
func v5SettleWrite(_ write: () async throws -> Bool) async -> V5WriteSettlement {
    do { return v5WriteSettlement(.success(try await write())) }
    catch { return v5WriteSettlement(.failure(error)) }
}

/// INJURYCHECKIN-1 · THE REFUSAL-AWARE SETTLEMENT, AS A PURE FUNCTION OVER
/// WHAT THE WIRE ACTUALLY CARRIED, so a test can walk every branch without a
/// server. Same reason `v5WriteSettlement` above is extracted.
///
/// `.refused` is keyed on the SENTENCE, not on the status code. That is the
/// load-bearing choice:
///
///   · a 404 from a mistyped path, a proxy, or a route that predates this
///     contract carries no sentence, so it stays `.didNotLand` — the phone
///     does not know what happened and must not claim to.
///   · a 5xx NEVER refuses however it is worded. A server that fell over is
///     the textbook "we could not tell", and suppressing the Retry there
///     would strand a runner on a transient outage.
///
/// So the server opts in, in words, and the phone never infers a permanent
/// answer from a bare number.
func v5RefusalSettlement(status: Int, body: Data?) -> V5WriteSettlement {
    if (200..<300).contains(status) { return .landed }
    guard (400..<500).contains(status), let body else { return .didNotLand }
    guard
        let obj = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
        // Presence of the key is the marker. A route that has not learned
        // this contract cannot accidentally suppress a Retry.
        obj["refusal"] != nil
    else { return .didNotLand }
    let sentence = (obj["refusal"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
    return .refused(sentence?.isEmpty == false ? sentence! : V5RefusedCopy.cannotSucceed)
}

/// Send one authenticated write and settle it, refusal included. The pair to
/// `v5SettleWrite` for the routes that answer a refusal in words.
func v5SettleAuthedWrite(_ req: URLRequest) async -> V5WriteSettlement {
    do {
        let (data, http) = try await API.authedSend(req)
        return v5RefusalSettlement(status: http.statusCode, body: data)
    } catch {
        return API.isCancellation(error) ? .cancelled : .didNotLand
    }
}

/// TODAYWRITE-1 · WHAT A ROW THAT SUBMITTED SOMETHING IS CURRENTLY ALLOWED
/// TO SAY.
///
/// Four screens ran the same tiny state machine badly, each in its own way,
/// and all four got it wrong in the same direction: they moved to the DONE
/// copy in the button's action handler. One shape here instead, so the
/// transition is written once and can be walked by a test rather than by
/// taking down a server (Rule 16, and the reason `API.isCancellation` and
/// `SettingsHostV5.settlement(landed:)` are extracted the same way).
///
/// The `token` is whatever the row needs to name the thing it submitted —
/// a body part, a check-in row id, a shoe id — so `.failed`'s Retry can
/// resend THAT, not whatever the row happens to show by then.
enum V5RowWriteState: Equatable {
    /// Nothing submitted. The row offers its picker.
    case idle
    /// In flight. The row may say it is sending; it may NOT say it is done.
    case sending(String)
    /// The server confirmed it. The ONLY state that may carry done copy.
    case done(String)
    /// It did not land, OR we could not tell. The row says so and offers the
    /// write again.
    case failed(String)
    /// INJURYCHECKIN-1 · the server refused it, in words. The row prints the
    /// server's own sentence and offers NO Retry, because a Retry here can
    /// only ever repeat a request that is structurally unable to succeed.
    /// The second value is the sentence, never a phone-authored guess at why.
    case refused(String, String)

    /// The whole transition, as a pure function. This is the line the four
    /// defects crossed: `.done` is reachable from `.landed` and from nothing
    /// else.
    static func settled(_ settlement: V5WriteSettlement, token: String) -> V5RowWriteState {
        switch settlement {
        case .landed:     return .done(token)
        case .didNotLand: return .failed(token)
        case .refused(let reason): return .refused(token, reason)
        // Torn down mid-write — see `V5WriteSettlement.cancelled`. Back to
        // the picker, claiming nothing in either direction.
        case .cancelled:  return .idle
        }
    }

    /// The token this state is about, when it has one.
    var token: String? {
        switch self {
        case .idle: return nil
        case .sending(let t), .done(let t), .failed(let t), .refused(let t, _): return t
        }
    }

    /// The server's refusal sentence, when this row carries one.
    var refusal: String? {
        if case .refused(_, let reason) = self { return reason }
        return nil
    }

    /// True while a write this row started has not settled. Guards a second
    /// submit, and is what the "Sending" copy is gated on.
    var isSending: Bool { if case .sending = self { return true }; return false }
}

// MARK: - The three surfaces

@MainActor
enum V5Surfaces {
    static func today() -> V5Surface<V5Today> {
        V5Surface(cache: .v5Today) { try await API.fetchV5Today() }
    }
    static func block() -> V5Surface<V5Block> {
        V5Surface(cache: .v5Block) { try await API.fetchV5Block() }
    }
    static func races() -> V5Surface<V5Races> {
        V5Surface(cache: .v5Races) { try await API.fetchV5Races() }
    }
    static func paces() -> V5Surface<V5Paces> {
        V5Surface(cache: .v5Paces) { try await API.fetchV5Paces() }
    }
    static func returnToRunning() -> V5Surface<V5Return> {
        V5Surface(cache: .v5Return) { try await API.fetchV5Return() }
    }
    static func raceDetail(slug: String) -> V5Surface<V5RaceDetail> {
        V5Surface(cache: nil) { try await API.fetchV5RaceDetail(slug: slug) }
    }
}

// MARK: - The outage screen's own body
//
// Screen 16a. The same Today shell, demonstrating the network-failure content
// rules rather than a screen of its own: the section that failed becomes an
// `ErrorNote` with a Retry, the section that has not arrived becomes a
// `Skeleton` reserving its exact height, and a coach line says the session
// still works because it is stored on the phone.

/// What an outage says, per surface.
///
/// ─────────────────────────────────────────────────────────────────────────
/// THE COPY IS NOT SHARED, AND THE FIRST BUILD SHARED IT
///
/// Every surface reused Today's sentence, so the Races tab said "Readiness did
/// not load. Your score is fine, we just cannot see it." Readiness has nothing
/// to do with whether the goal is still real. A wrong-but-fluent sentence is
/// worse than a blank one: it tells the runner we looked at something we never
/// looked at.
///
/// Each one keeps the shape of the design's own example — name what failed,
/// then say the runner is fine, then say what we cannot see — and each names
/// the thing THIS screen could not read.
struct V5OutageCopy {
    /// The `ErrorNote`. What failed, and that it is our sight, not their data.
    let note: String
    /// The quiet line underneath. What is still true while we cannot see.
    let reassurance: String

    /// COLDOPEN-1 (2026-09-11) · BOTH LINES CORRECTED — SEE THE FINDING.
    ///
    /// This copy is reached only by `isOutage` (`model == nil && stale`),
    /// and `/api/v5/today` is ONE monolithic fetch — there is no separate
    /// readiness sub-fetch, and `V5Today` carries no readiness-score field
    /// at all (`ContentReadiness` elsewhere in this app is an unrelated
    /// concept — whether a payload matches the date on screen, not a
    /// coaching score). So the old `note` named a specific part that failed
    /// when the truth is the WHOLE model never arrived; that is Rule 16's
    /// failure mode pointed at an error message rather than a metric.
    ///
    /// The old `reassurance` had the opposite problem: it asserted "today's
    /// session is on the phone already" unconditionally, but this branch is
    /// reached ONLY when nothing decodable exists on disk AND the refresh
    /// failed (per COLDOPEN-1, any decodable cache — however old — now seeds
    /// `model` and renders through the stale-banner path instead, never
    /// this one). In the one state that reaches this copy, the session is
    /// specifically NOT already known on the phone, so claiming it is would
    /// be exactly the unverified reassurance Rule 20/Finding 1 flags. What
    /// IS true in that state, traced against `LiveRunHostV5`'s `.task`
    /// (HostsV5.swift): starting and recording a run never depends on this
    /// fetch — `PendingRunPlanV5`/`API.fetchWatchWorkout()` are a separate
    /// read, and failing that too still leaves both live-run consoles their
    /// documented no-target layout rather than blocking Start. That is the
    /// claim this reassurance is narrowed to.
    static let today = V5OutageCopy(
        note: "Today did not load. Your plan is intact, we just cannot see it.",
        reassurance: "You can still start and record a run from the Run tab without this. Today's session shows again the moment the connection does."
    )

    static let block = V5OutageCopy(
        note: "The block did not load. Your plan is intact, we just cannot see it.",
        reassurance: "Nothing in it has changed. This is the connection, not the training."
    )

    static let races = V5OutageCopy(
        note: "The race read did not load. Your goal and your schedule stand, we just cannot see them.",
        reassurance: "Nothing here decides anything on its own. It reads again when the connection does."
    )

    static let raceDetail = V5OutageCopy(
        note: "This race did not load. The plan for it is unchanged, we just cannot see it.",
        reassurance: "The pace plan is worked out ahead of time, not on the day."
    )

    static let paces = V5OutageCopy(
        note: "The pace read did not load. Your paces are unchanged, we just cannot see them.",
        reassurance: "Nothing re-anchors while we cannot read it."
    )

    static let returnLadder = V5OutageCopy(
        note: "The ladder did not load. Your stage is unchanged, we just cannot see it.",
        reassurance: "A stage only advances on a session you report, so nothing moved while this was down."
    )

    static let runDetail = V5OutageCopy(
        note: "This run did not load. It is still in your log, we just cannot see it.",
        reassurance: "A run that is already recorded does not change while we cannot read it."
    )

    static let runLog = V5OutageCopy(
        note: "The log did not load. Every run you have done is still there, we just cannot see them.",
        reassurance: "Nothing is counted from this screen. It reads again when the connection does."
    )

    /// V5PROPOSALSURFACE-1 · the decision history. The reassurance is doing
    /// real work here: this is the one screen whose emptiness would otherwise
    /// read as "the coach has never decided anything about me", which is the
    /// exact false fact the screen was built to disprove.
    static let decisions = V5OutageCopy(
        note: "Your decision history did not load. Every decision is still on record, we just cannot see it.",
        reassurance: "Nothing is decided from this screen. Anything still waiting on you is on Today."
    )

    static let tomorrow = V5OutageCopy(
        note: "Tomorrow did not load. We just cannot see it from here.",
        reassurance: "Whatever the niggle turns into, the day is decided in the morning, not now."
    )
}

struct OutageBodyV5: View {
    var copy: V5OutageCopy = .today
    let onRetry: () -> Void
    /// The height the real content will take. Passed in, so the placeholder
    /// reserves the layout rather than guessing at it.
    var skeletonLines: Int = 3

    var body: some View {
        VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
            ErrorNote(text: copy.note, onRetry: onRetry)
            Skeleton(lines: skeletonLines)
            // `size="md"` in 16a's markup, and every other CoachSay in the
            // v5 set is md. This one was the only sm, which read as a
            // smaller, quieter coach on the one screen where the point is
            // that the session is still fine.
            CoachSay(text: copy.reassurance, size: .md)
        }
    }
}

// MARK: - The phone-run setting
//
// `user_settings.phone_run_enabled` is THE single source of truth for whether
// the RUN pill exists in the tab bar. It defaults to true and degrades to true
// on a failed read, so a watchless runner is never stranded with no way to
// start a run because a settings fetch timed out.

@MainActor
final class PhoneRunGate: ObservableObject {
    @Published private(set) var enabled: Bool = true

    func refresh() async {
        await SettingsCache.shared.warm()
        enabled = await SettingsCache.shared.read().settings?.phoneRunEnabled ?? true
    }
}

// MARK: - Coming back to a screen that has been sitting there
//
// THE V5 SURFACES NEVER RELOADED ON FOREGROUND, AND NOTHING SAID SO.
//
// `.task` runs when a view first appears. The three tab destinations live
// inside a `TabView` and are never torn down, so for a warm app it ran once
// per process and never again. Everything after that came from pull-to-refresh
// — a gesture a runner has no reason to know is load-bearing.
//
// So an app left in the background overnight showed yesterday: an adaptation
// the coach made at 4am, a plan edited on the web, a run synced off the watch,
// a correction made to the data. All of it invisible until the runner either
// force-quit or happened to pull down.
//
// `.faffForegroundRefresh` has existed the whole time and every listener for
// it is in the v4 `Views/` directory. The v5 port carried over the screens and
// not the signal, which is the quiet kind of regression: nothing broke, a
// behaviour simply stopped happening, and no test asks "is this still fresh".
//
// Throttled because the app posts twice on purpose — once the instant
// foregrounding starts, so the Strava banner clears after an OAuth return, and
// again once the HealthKit import lands, because that is what brings today's
// run in. Both are wanted; two identical fetches a second apart are not.
//
// REQUESTSTORM-2 (2026-09-06) · THIS THROTTLE ONLY EVER PROTECTED WHATEVER
// `reload` CLOSURE A CALLER PASSED IN HERE. It does nothing for `V5Surface`'s
// OWN `.faffForegroundRefresh` observer above (`init`, ~line 250) — a
// completely separate registration on the same notification. Today/Block/
// Races used to pass `{ await surface.load() }` (or `{ await surface.load();
// await syncPlanSnapshot() }`) to this modifier, which meant that surface's
// `load()` fired from BOTH places: twice via its own unthrottled observer,
// once more (throttled, but independently) via this one. Now nothing here
// calls `surface.load()` — only work that has no other foreground trigger,
// like `syncPlanSnapshot()`, belongs in a `v5ReloadOnForeground` closure.
extension View {
    func v5ReloadOnForeground(_ reload: @escaping () async -> Void) -> some View {
        modifier(V5ForegroundReload(reload: reload))
    }
}

private struct V5ForegroundReload: ViewModifier {
    let reload: () async -> Void
    @State private var lastAt: Date = .distantPast

    /// Long enough to coalesce the two deliberate posts, short enough that a
    /// runner who backgrounds and returns still gets a fresh read.
    private static let throttleSec: TimeInterval = 3

    func body(content: Content) -> some View {
        content.onReceive(NotificationCenter.default.publisher(for: .faffForegroundRefresh)) { _ in
            let now = Date()
            guard now.timeIntervalSince(lastAt) > Self.throttleSec else { return }
            lastAt = now
            Task { await reload() }
        }
    }
}
