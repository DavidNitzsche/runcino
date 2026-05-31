//
//  TokenStore.swift  (P39 · Keychain-backed 2026-05-31)
//
//  Session token persistence for the iPhone. Backed by the iOS Keychain
//  via `SecItem*` calls so the token survives reinstalls (matching the
//  60d server-side session TTL) and lives in the secure enclave rather
//  than NSUserDefaults · which any sibling extension can read.
//
//  Why Keychain: multi-user backend is live (54 routes hardened, /api/*
//  no longer falls back to DEFAULT_USER_ID). A leaked token now gives
//  the bearer real access to a specific runner's plan, runs, and health
//  data · we shouldn't be storing it in plaintext UserDefaults.
//
//  Migration: anything previously written by the UserDefaults path
//  (build ≤ 118) is read on first launch, copied into Keychain, then
//  cleared from UserDefaults. Subsequent launches see only Keychain.
//
//  The @MainActor surface is unchanged so callers (FaffApp, SignInView,
//  API.authedSend) don't need updates. Only the backing store moved.
//

import Foundation
import Security

@MainActor
final class TokenStore: ObservableObject {
    static let shared = TokenStore()

    /// Keychain service identifier. Single string, never user-rotatable ·
    /// `kSecAttrAccount` discriminates between fields. A future multi-account
    /// device could vary the account suffix; today there's one runner.
    /// `nonisolated` so the keychain helpers (which run off the main actor
    /// so background launches can read the token) can reference it.
    nonisolated private static let service = "run.faff.session"

    nonisolated private enum K {
        static let token = "token"
        static let expires = "expires_at"
        static let userUuid = "user_uuid"
    }

    // Legacy UserDefaults keys · drained on first launch and not written again.
    nonisolated private static let legacyTokenKey = "faff.session.token"
    nonisolated private static let legacyExpiresKey = "faff.session.expires_at"
    nonisolated private static let legacyUserUuidKey = "faff.session.user_uuid"

    @Published var token: String?
    @Published var expiresAt: String?
    @Published var userUuid: String?

    private init() {
        TokenStore.migrateFromUserDefaultsIfNeeded()
        self.token = TokenStore.keychainRead(K.token)
        self.expiresAt = TokenStore.keychainRead(K.expires)
        self.userUuid = TokenStore.keychainRead(K.userUuid)
    }

    var isSignedIn: Bool { token != nil }

    /// Persist a fresh session. Pass `nil` for `token` to wipe.
    func set(token: String?, expiresAt: String?, userUuid: String?) {
        self.token = token
        self.expiresAt = expiresAt
        self.userUuid = userUuid
        if let t = token {
            TokenStore.keychainWrite(K.token, value: t)
            TokenStore.keychainWrite(K.expires, value: expiresAt)
            TokenStore.keychainWrite(K.userUuid, value: userUuid)
        } else {
            TokenStore.keychainDelete(K.token)
            TokenStore.keychainDelete(K.expires)
            TokenStore.keychainDelete(K.userUuid)
        }
    }

    func clear() { set(token: nil, expiresAt: nil, userUuid: nil) }

    /// Augment a request with `Authorization: Bearer` when a token is set.
    /// Called from API helpers (authedGET/authedSend) on every outbound
    /// request. Reads the keychain directly (nonisolated) so background-
    /// launched contexts (notifications, watch sync, BGTask) can attach
    /// auth without round-tripping the main actor.
    nonisolated func authorize(_ req: inout URLRequest) {
        if let t = TokenStore.keychainRead(K.token) {
            req.setValue("Bearer \(t)", forHTTPHeaderField: "Authorization")
        }
    }

    // MARK: - Migration (one-shot)

    /// Drain any UserDefaults-stored token into Keychain on first launch
    /// of the Keychain-backed build (build 119+). Runs before the
    /// `@Published` reads, so the published surface still reflects the
    /// migrated values without an extra reload.
    private static func migrateFromUserDefaultsIfNeeded() {
        let defaults = UserDefaults.standard
        guard let legacy = defaults.string(forKey: legacyTokenKey) else { return }
        // Only migrate if Keychain is empty for this field — never clobber
        // a fresh-signin token with a stale UserDefaults one.
        if keychainRead(K.token) == nil {
            keychainWrite(K.token, value: legacy)
            keychainWrite(K.expires, value: defaults.string(forKey: legacyExpiresKey))
            keychainWrite(K.userUuid, value: defaults.string(forKey: legacyUserUuidKey))
        }
        defaults.removeObject(forKey: legacyTokenKey)
        defaults.removeObject(forKey: legacyExpiresKey)
        defaults.removeObject(forKey: legacyUserUuidKey)
    }

    // MARK: - SecItem wrappers

    /// Read a string from Keychain. Returns nil for missing-or-error ·
    /// callers treat that as "no session" rather than distinguishing
    /// between errSecItemNotFound and a real failure (the user-visible
    /// outcome is the same: route to sign-in).
    nonisolated fileprivate static func keychainRead(_ account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// Write a string to Keychain · upserts the account row. Nil clears.
    ///
    /// Strategy: delete-then-add rather than update-or-add. Update-first was
    /// silently failing on some installs (the legacy item carried a different
    /// accessibility class than the new write, SecItemUpdate returned
    /// errSecParam or similar non-`itemNotFound`, the fall-through never
    /// fired, and the new token never landed). The runner appeared signed in
    /// (the @Published `token` was set) but every authedSend read the stale /
    /// missing keychain row · backend returned 401 · NudgeSheet etc. rendered
    /// empty. Delete-then-add costs one extra SecItem call per write but
    /// removes the failure mode.
    nonisolated fileprivate static func keychainWrite(_ account: String, value: String?) {
        guard let value, let data = value.data(using: .utf8) else {
            keychainDelete(account); return
        }
        let baseQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        // Drop any existing row (or no-op if absent). errSecItemNotFound here
        // is expected on first write and not actionable.
        _ = SecItemDelete(baseQuery as CFDictionary)
        var add = baseQuery
        add[kSecValueData as String] = data
        // `WhenUnlockedThisDeviceOnly` keeps the token off iCloud backups and
        // only readable while the device is unlocked · the right default for
        // a session token. Background-launched contexts (notifications, BG
        // fetch) run with the device unlocked or after the first unlock, so
        // this still serves them.
        add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let status = SecItemAdd(add as CFDictionary, nil)
        // Add can return errSecDuplicateItem if a system race re-inserted the
        // row between our delete + add. One retry handles that without
        // looping forever on a real failure.
        if status == errSecDuplicateItem {
            _ = SecItemDelete(baseQuery as CFDictionary)
            _ = SecItemAdd(add as CFDictionary, nil)
        }
    }

    nonisolated fileprivate static func keychainDelete(_ account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        _ = SecItemDelete(query as CFDictionary)
    }
}
