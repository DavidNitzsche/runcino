//
//  AppCache.swift
//
//  Disk-persisted last-response cache, keyed by endpoint, so views can
//  render real (slightly stale) content the instant they appear instead
//  of staring at skeleton bars.
//
//  Pattern, used by every view:
//
//    @State private var briefing: Briefing? =
//        AppCache.read(.todayBriefing, as: Briefing.self)
//
//    .task {
//      if let (data, _) = try? await API.briefingRaw(surface: "today"),
//         let fresh = try? JSONDecoder().decode(Briefing.self, from: data) {
//        briefing = fresh
//        AppCache.writeRaw(.todayBriefing, data: data)
//      }
//    }
//
//  Cache stores the raw response Data, so wire models don't need to
//  conform to Encodable — only Decodable (which they already do). The
//  read side decodes lazily via the type the caller requests.
//
//  First-ever launch reads nil; from then on, every tap reads the last
//  successful response off disk synchronously. Network refresh updates
//  the UI when it lands, then writes back so the next cold launch
//  shows that newer value instantly.
//
//  2026-05-27: shipped after David called the loading-bar carpet bomb
//  ("LOADING LOADING LOADING") a deal-breaker. Stale-while-revalidate
//  is the same pattern web /today and friends use via Suspense
//  boundaries; iPhone needed the equivalent.
//

import Foundation

enum AppCache {
    /// Stable keys used by both write- and read-side. Adding a new
    /// endpoint? Add a case here and write to it from the API helper.
    enum Key: String {
        case todayBriefing       = "v1.briefing.today"
        case trainingBriefing    = "v1.briefing.training"
        case racesBriefing       = "v1.briefing.races"
        case healthBriefing      = "v1.briefing.health"
        case profileBriefing     = "v1.briefing.profile"
        case todayWorkout        = "v1.watch.today"
        case planWeek            = "v1.plan.week"
        case readiness           = "v1.readiness"
        case trainingState       = "v1.training.state"
        case healthState         = "v1.health.state"
        case profileState        = "v1.profile.state"
        case raceList            = "v1.race.list"
        case logState            = "v1.log.state"
        case tipsList            = "v1.tips.list"
        /// /api/settings response (UserSettings) — units_distance / units_temp
        /// / units_pace + plan-shaping day prefs. Added 2026-07-07 so
        /// Units.swift can read the units preference synchronously at
        /// render time, matching every other AppCache-backed surface.
        case userSettings        = "v1.settings"
    }

    /// `UserDefaults.standard` rather than the App Group container —
    /// none of these payloads are sensitive (all readable on web too)
    /// and we don't need cross-process visibility.
    private static let store: UserDefaults = .standard
    private static let prefix = "faff.cache."

    // MARK: - Raw data primitives
    //
    // The write side stores the bytes the network returned. The read
    // side hands them back so the caller can decode them with the
    // matching type. This keeps wire models Decodable-only — no need
    // to make every struct Encodable just for caching.

    static func writeRaw(_ key: Key, data: Data) {
        store.set(data, forKey: prefix + key.rawValue)
        store.set(Date(), forKey: prefix + key.rawValue + ".at")
    }

    static func readRaw(_ key: Key) -> Data? {
        store.data(forKey: prefix + key.rawValue)
    }

    /// Last-written timestamp, for "cached 12m ago" affordances. Best-
    /// effort; absent on cache misses.
    static func writtenAt(_ key: Key) -> Date? {
        store.object(forKey: prefix + key.rawValue + ".at") as? Date
    }

    // MARK: - Typed convenience

    /// Decode the cached payload into `type`. Returns nil if the key
    /// was never written, or the on-disk shape no longer matches the
    /// type (e.g. wire schema drifted between app versions).
    static func read<T: Decodable>(_ key: Key, as type: T.Type) -> T? {
        guard let data = readRaw(key) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    /// Wipe the cache. Useful for debugging or after a sign-out.
    /// Exposed for future settings actions; currently unwired.
    static func clearAll() {
        let keys = store.dictionaryRepresentation().keys.filter { $0.hasPrefix(prefix) }
        for k in keys { store.removeObject(forKey: k) }
    }
}
