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

    /// A refresh is running. Never used to blank anything.
    @Published private(set) var refreshing = false

    /// When the payload in hand was written. For a "cached 12m ago"
    /// affordance, if a screen wants one.
    let cachedAt: Date?

    private let cacheKey: AppCache.Key?
    private let fetch: () async throws -> Model?

    init(cache: AppCache.Key?, fetch: @escaping () async throws -> Model?) {
        self.cacheKey = cache
        self.fetch = fetch
        self.model = cache.flatMap { AppCache.read($0, as: Model.self) }
        self.cachedAt = cache.flatMap { AppCache.writtenAt($0) }
    }

    /// True exactly when the design's data-outage screen applies: we have
    /// nothing at all and the last read failed. Not "we are loading".
    var isOutage: Bool { model == nil && stale }

    /// True on a genuine cold start — no cache, no failure yet. This is where
    /// a `Skeleton` goes, reserving the real content's height.
    var isColdStart: Bool { model == nil && !stale }

    func load() async {
        refreshing = true
        defer { refreshing = false }
        do {
            if let fresh = try await fetch() {
                model = fresh
                stale = false
            } else {
                // A non-2xx with no throw. We could not read it; we did not
                // learn that the answer is no.
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

struct OutageBodyV5: View {
    let onRetry: () -> Void
    /// The height the real content will take. Passed in, so the placeholder
    /// reserves the layout rather than guessing at it.
    var skeletonLines: Int = 3

    var body: some View {
        VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
            ErrorNote(text: "Readiness did not load. Your score is fine, we just cannot see it.",
                      onRetry: onRetry)
            Skeleton(lines: skeletonLines)
            CoachSay(text: "Today's session is on the phone already, so it runs whether or not we can reach the server. The rest catches up when the connection does.",
                     size: .sm)
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
