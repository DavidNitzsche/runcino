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
    private var inflightSettings: Task<Result<UserSettings?, Error>, Never>?
    private var inflightProfile: Task<Result<ProfileFields?, Error>, Never>?

    /// SETTINGSFAIL-1 (2026-09-07) · the last real failure for each resource,
    /// or nil if the last attempt succeeded — even if it legitimately
    /// returned no data. `warmSettings`/`warmProfile` used to swallow every
    /// throw with `try?`, so a caller reading `settings == nil` afterward
    /// could not tell "the runner has no settings" from "we could not reach
    /// faff" from "the session expired" — three different facts (Rule 11)
    /// collapsed into one. `SettingsHostV5.load()` reads these to decide
    /// whether a `nil` pair is a real outage worth a failed state, and what
    /// category of failure to show. Cleared to nil the instant a fetch
    /// SUCCEEDS, so a stale error from an earlier attempt never survives a
    /// later good read.
    private var lastSettingsError: Error?
    private var lastProfileError: Error?

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
        let task = Task<Result<UserSettings?, Error>, Never> {
            do { return .success(try await API.fetchSettings()) }
            catch { return .failure(error) }
        }
        inflightSettings = task
        switch await task.value {
        case .success(let value):
            lastSettingsError = nil
            if let value { settings = value }
        case .failure(let error):
            lastSettingsError = error
        }
        inflightSettings = nil
    }

    private func warmProfile() async {
        if profile != nil { return }
        if let inflight = inflightProfile { _ = await inflight.value; return }
        let task = Task<Result<ProfileFields?, Error>, Never> {
            do { return .success(try await API.fetchProfile()) }
            catch { return .failure(error) }
        }
        inflightProfile = task
        switch await task.value {
        case .success(let value):
            lastProfileError = nil
            if let value { profile = value }
        case .failure(let error):
            lastProfileError = error
        }
        inflightProfile = nil
    }

    func read() -> (settings: UserSettings?, profile: ProfileFields?) {
        (settings, profile)
    }

    /// SETTINGSFAIL-1 · see the property doc comments above. Read alongside
    /// `read()` when both come back nil, to tell a genuine outage apart from
    /// an honestly-empty response and to categorize it correctly.
    func lastErrors() -> (settings: Error?, profile: Error?) {
        (lastSettingsError, lastProfileError)
    }

    /// Called from save paths in SettingsSheet so the next open reflects
    /// freshly-edited values without waiting for TTL expiry.
    func invalidate() {
        settings = nil
        profile = nil
    }
}
