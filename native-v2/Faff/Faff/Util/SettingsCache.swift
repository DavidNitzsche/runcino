//
//  SettingsCache.swift
//
//  Shared in-process cache for /api/settings + /api/profile. Both are
//  effectively app-singletons (per logged-in user); SettingsSheet was
//  fetching both on appear, causing a visible loading state on every
//  open. Now ProfileView warms the cache when it mounts, the avatar
//  / EDIT trigger warms on hover, and the sheet seeds its @State
//  synchronously from the cache.
//
//  Mirrors the web pattern in components/settings/SettingsModal.tsx
//  (module-scope cache survives unmount + route changes for the session).
//

import Foundation

/// Actor so concurrent warm/read calls don't race. The values are tiny
/// (~1KB combined) so we keep them in memory for the lifetime of the
/// process. Mutations to either resource invalidate the cache via
/// `invalidate()` from the PATCH paths.
actor SettingsCache {
    static let shared = SettingsCache()

    private var settings: UserSettings?
    private var profile: ProfileFields?
    private var inflightSettings: Task<UserSettings?, Never>?
    private var inflightProfile: Task<ProfileFields?, Never>?

    /// Fire both fetches in parallel if missing or stale. Idempotent —
    /// concurrent callers reuse the in-flight Task. Returns once both
    /// have either succeeded or failed (failures cache nil; next call retries).
    func warm() async {
        async let s: () = warmSettings()
        async let p: () = warmProfile()
        _ = await (s, p)
    }

    private func warmSettings() async {
        if settings != nil { return }
        if let inflight = inflightSettings { _ = await inflight.value; return }
        let task = Task { try? await API.fetchSettings() }
        inflightSettings = task
        let result = await task.value
        if let result { settings = result }
        inflightSettings = nil
    }

    private func warmProfile() async {
        if profile != nil { return }
        if let inflight = inflightProfile { _ = await inflight.value; return }
        let task = Task { try? await API.fetchProfile() }
        inflightProfile = task
        let result = await task.value
        if let result { profile = result }
        inflightProfile = nil
    }

    func read() -> (settings: UserSettings?, profile: ProfileFields?) {
        (settings, profile)
    }

    /// Called from save paths in SettingsSheet so the next open reflects
    /// freshly-edited values without waiting for TTL expiry.
    func invalidate() {
        settings = nil
        profile = nil
    }
}
