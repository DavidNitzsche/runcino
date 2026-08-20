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
    let cachedAt: Date?

    private let cacheKey: AppCache.Key?
    private var fetch: () async throws -> API.V5Fetch<Model>

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
        foreground = NotificationCenter.default.addObserver(
            forName: .faffForegroundRefresh, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in await self?.load() }
        }
    }

    private var foreground: NSObjectProtocol?

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
                model = fresh
                stale = false
                absentReason = nil
            case .absent(let reason):
                // The engine decided. Not an outage, and not something to
                // paper over with a cached payload from when it did apply.
                absentReason = reason
                model = nil
                stale = false
            case .failed:
                stale = true
            }
        } catch is CancellationError {
            // A screen going away is not an outage.
        } catch {
            stale = true
        }
    }
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
            CoachSay(text: copy.reassurance, size: .sm)
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
