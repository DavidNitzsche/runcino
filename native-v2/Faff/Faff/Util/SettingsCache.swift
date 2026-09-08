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
    ///
    /// SETTINGSCANCEL-1 · the two `Task {}`s below are UNSTRUCTURED on
    /// purpose, and therefore do not inherit their caller's cancellation.
    /// That is the point of the in-flight slot: the shared fetch belongs to
    /// every caller piggybacking on it, so one caller walking away (a
    /// superseded `SettingsHostV5` load, a dismissed sheet) must not cancel
    /// the read the others are still waiting on. The consequence, stated
    /// plainly rather than left for the next reader to discover: `warm()` is
    /// NOT promptly cancellable, and a caller that cancels mid-`warm()` still
    /// waits for the transport. `API.authedSend` bounds every request at 12s
    /// (TIMEOUT-1), which is what actually bounds that wait.
    func warm() async {
        async let s: () = warmSettings()
        async let p: () = warmProfile()
        _ = await (s, p)
    }

    /// SETTINGSCANCEL-1 (2026-09-07 review) · THE PIGGYBACKER APPLIES THE
    /// RESULT ITSELF.
    ///
    /// The piggyback branch below used to be `_ = await inflight.value;
    /// return` — it waited for the shared fetch and then returned WITHOUT
    /// applying its outcome, trusting the caller that OWNS the task to have
    /// written `settings`/`lastSettingsError` first. Both callers resume from
    /// the same `await`, and the actor makes no promise about which resumes
    /// first, so a piggybacking caller could return, read `lastErrors()`, and
    /// see the state from BEFORE this fetch — a stale error surviving a good
    /// read, or a fresh failure invisible to the caller that is about to
    /// decide whether the screen failed. Unobserved on device so far, and
    /// real. Applying the result in both branches removes the ordering
    /// question entirely: whoever resumes first writes, the second write is
    /// identical, and no caller can observe the gap.
    private func applySettings(_ result: Result<UserSettings?, Error>) {
        switch result {
        case .success(let value):
            lastSettingsError = nil
            if let value { settings = value }
        case .failure(let error):
            lastSettingsError = error
        }
    }

    private func applyProfile(_ result: Result<ProfileFields?, Error>) {
        switch result {
        case .success(let value):
            lastProfileError = nil
            if let value { profile = value }
        case .failure(let error):
            lastProfileError = error
        }
    }

    private func warmSettings() async {
        if settings != nil { return }
        if let inflight = inflightSettings {
            applySettings(await inflight.value)
            return
        }
        let task = Task<Result<UserSettings?, Error>, Never> {
            do { return .success(try await API.fetchSettings()) }
            catch { return .failure(error) }
        }
        inflightSettings = task
        applySettings(await task.value)
        inflightSettings = nil
    }

    private func warmProfile() async {
        if profile != nil { return }
        if let inflight = inflightProfile {
            applyProfile(await inflight.value)
            return
        }
        let task = Task<Result<ProfileFields?, Error>, Never> {
            do { return .success(try await API.fetchProfile()) }
            catch { return .failure(error) }
        }
        inflightProfile = task
        applyProfile(await task.value)
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
