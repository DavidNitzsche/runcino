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
        /// /api/profile response (ProfileFields) — timezone + physiology
        /// edits. Added 2026-07-08 (re-audit P0) so HealthKitImporter can
        /// read the runner's stored timezone for local-date bucketing
        /// instead of hardcoding America/Los_Angeles, mirroring
        /// runnerTimezoneOrPacific's server-side fallback pattern.
        case profileFields       = "v1.profile.fields"

        // ── v5 surfaces ──
        // One key per SCREEN rather than per data source, because that is how
        // the v5 endpoints are shaped. These are what let a v5 screen paint its
        // real content on frame one: seed @State from AppCache.read at
        // declaration, then refresh in .task. The design requires that loading
        // states reserve their exact final layout height and that nothing
        // appears, disappears, or reflows — a cache hit is how that is true in
        // practice rather than only in theory.
        case v5Today             = "v5.today"
        case v5Block             = "v5.block"
        case v5Races             = "v5.races"
        case v5Paces             = "v5.paces"
        case v5Return            = "v5.return"
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
        guard let data = readRaw(key), fresh(key) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    /// A CACHED DAY IS STILL A DAY, AND DAYS EXPIRE.
    ///
    /// `writtenAt` was recorded from the beginning and read by nothing. The
    /// cache had no age check at all and was cleared only by sign-out or by a
    /// change of owner, so a phone that had been offline since yesterday
    /// rendered YESTERDAY'S session as today's — the prescription, the week
    /// line, the strip — with nothing on screen saying it was old. The
    /// surface store's `stale` flag only fires when a REFRESH fails; a cold
    /// launch with no network never refreshes, so it never fired.
    ///
    /// Twelve hours, not twenty-four: the point is that a cached payload must
    /// not survive the boundary between one training day and the next, and a
    /// runner who reads Today at 06:00 and again at 06:00 is two days apart.
    /// Past it the cache misses, the surface asks the network, and a failure
    /// there is the honest data-outage screen rather than a confident wrong
    /// day.
    static let maxAgeSec: TimeInterval = 12 * 60 * 60

    static func fresh(_ key: Key, now: Date = Date()) -> Bool {
        // No timestamp means it predates `writeRaw` stamping one. Treat it as
        // expired rather than trusted — the payload is at least that old.
        guard let at = writtenAt(key) else { return false }
        let age = now.timeIntervalSince(at)
        return age >= 0 && age <= maxAgeSec
    }

    /// Wipe the cache. Called by SessionHygiene.signOut() and by
    /// `bindOwner` whenever the signed-in identity changes.
    static func clearAll() {
        let keys = store.dictionaryRepresentation().keys.filter { $0.hasPrefix(prefix) }
        for k in keys { store.removeObject(forKey: k) }
    }

    // MARK: - Identity binding
    //
    // 2026-08-21 · multi-tenancy audit. This cache was a single global
    // UserDefaults namespace with no notion of WHOSE data it held, and
    // only the explicit sign-out button ever cleared it. Two real leaks
    // followed from that, and both bypassed the sign-out button:
    //
    //   A · a session that EXPIRED rather than being signed out left the
    //       cache intact. The launch gate then read cached bytes as proof
    //       of a returning user and entered the main app with no token at
    //       all, painting the previous runner's plan, runs and health to
    //       whoever was holding the phone.
    //   B · signing in cleared nothing, so runner B landed on runner A's
    //       cached surfaces and only corrected as each refresh returned —
    //       and a surface whose refresh fails deliberately keeps showing
    //       the stale model, so a flaky network kept A's data on screen.
    //
    // The fix is to give the cache an owner and check it, rather than to
    // add one more clear() call to one more code path. Every future
    // sign-in route inherits the guarantee without remembering to.

    private static let ownerKey = prefix + "__owner"

    /// The runner this cache currently holds data for, or nil when the
    /// cache is unbound (fresh install, or just wiped).
    static var owner: String? {
        store.string(forKey: ownerKey)
    }

    /// Bind the cache to a runner. If the identity differs from what the
    /// cache already holds — a different account, or no account at all —
    /// the previous runner's bytes are wiped BEFORE anything can read
    /// them. Same uuid is a no-op, so a returning runner keeps their
    /// offline surfaces.
    ///
    /// Call this at every point where the signed-in identity is
    /// established or lost: sign-in, launch, sign-out.
    static func bindOwner(_ uuid: String?) {
        let incoming = (uuid?.isEmpty == false) ? uuid! : ""
        let current = store.string(forKey: ownerKey) ?? ""
        guard current != incoming else { return }
        clearAll()   // also drops ownerKey — it carries the prefix
        // EVERY user-tied local store, not just the surface cache.
        //
        // Three others outlived a sign-out, and one of them crosses users on
        // a WRITE rather than a read: the watch relay queue holds runs that
        // were recorded but never reached the server, and the drain posts
        // them with whatever token is current. Runner A's unsent run filed
        // into runner B's log, under B's name.
        //
        // Hung here rather than in `SessionHygiene.signOut()` alone, because
        // signOut is only the BUTTON. A session that merely expired never
        // calls it, and that is the path that left a phone sitting on the
        // previous runner's data with no token at all.
        purgeUserTiedStores()
        if !incoming.isEmpty { store.set(incoming, forKey: ownerKey) }
    }

    /// Local stores that belong to a person, not to the device.
    static func purgeUserTiedStores() {
        // Runs recorded on the watch or the phone that never reached the
        // server. They are the previous runner's and nobody else may send
        // them. Losing an unsent run is bad; filing it under the wrong
        // runner is worse, and it cannot be undone from inside the app.
        store.removeObject(forKey: "faff.watch.pendingCompletions.v2")
        // The interrupted-outdoor-run checkpoint, re-submitted on the next
        // console open within its 24h window.
        if let dir = FileManager.default.urls(for: .applicationSupportDirectory,
                                              in: .userDomainMask).first {
            try? FileManager.default.removeItem(
                at: dir.appendingPathComponent("phone-run-checkpoint.json"))
        }
    }
}
