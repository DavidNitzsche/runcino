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
    /// second should never have been visible at all. This generation counter
    /// is what lets a delayed "show" be cancelled by a load that already
    /// succeeded before the delay elapsed, without touching `stale`'s own
    /// meaning or `SurfaceReadiness`'s three-state contract above it.
    private var staleAttemptGeneration = 0

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
        // STALEDEBOUNCE-1 · cancels any pending delayed-stale task from an
        // earlier failed load — without this, a debounce timer scheduled
        // before this cache hit could still fire afterward and flip `stale`
        // back to true over content that just proved itself current.
        staleAttemptGeneration += 1
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
        refreshing = true
        defer { refreshing = false }
        do {
            switch try await fetch() {
            case .ok(let fresh):
                staleAttemptGeneration += 1
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
                // The engine decided. Not an outage, and not something to
                // paper over with a cached payload from when it did apply.
                staleAttemptGeneration += 1
                absentReason = reason
                model = nil
                stale = false
            case .failed:
                markStaleAfterDebounce()
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
            markStaleAfterDebounce()
        }
    }

    /// STALEDEBOUNCE-1 · does not set `stale` itself. Waits out a short
    /// window first, so a load that succeeds in the meantime — the common
    /// case for a one-off blip — cancels this one by bumping the generation
    /// before it fires. 1.2s: long enough to absorb a single dropped request
    /// during a container swap, short enough that a GENUINE outage still
    /// shows the banner well within what would read as "instant" to a
    /// runner glancing at the screen.
    private func markStaleAfterDebounce() {
        staleAttemptGeneration += 1
        let myGeneration = staleAttemptGeneration
        Task {
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            guard myGeneration == staleAttemptGeneration else { return }
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
    /// Deliberately one case and not two. A non-2xx and a dropped
    /// connection are different facts, but the phone cannot tell them apart
    /// here (`API.authedSend` returns non-2xx rather than throwing, and the
    /// niggle/sick/shoe routes carry no refusal sentence a 4xx could be
    /// rendered from), and inventing a distinction the wire does not carry
    /// would be a second fabrication. When those routes grow a refusal
    /// body, this splits — `AddRaceV5.saveRefusal` is the shape to copy.
    case didNotLand
    /// The runner's own navigation tore this down before it settled. Not a
    /// failure and not a success: nothing to report, nothing to retry.
    /// Same distinction, same helper, as `load()`'s catch block above.
    case cancelled
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
    /// It did not land. The row says so and offers the write again.
    case failed(String)

    /// The whole transition, as a pure function. This is the line the four
    /// defects crossed: `.done` is reachable from `.landed` and from nothing
    /// else.
    static func settled(_ settlement: V5WriteSettlement, token: String) -> V5RowWriteState {
        switch settlement {
        case .landed:     return .done(token)
        case .didNotLand: return .failed(token)
        // Torn down mid-write — see `V5WriteSettlement.cancelled`. Back to
        // the picker, claiming nothing in either direction.
        case .cancelled:  return .idle
        }
    }

    /// The token this state is about, when it has one.
    var token: String? {
        switch self {
        case .idle: return nil
        case .sending(let t), .done(let t), .failed(let t): return t
        }
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

    static let today = V5OutageCopy(
        note: "Readiness did not load. Your score is fine, we just cannot see it.",
        reassurance: "Today's session is on the phone already, so it runs whether or not we can reach the server. The rest catches up when the connection does."
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
