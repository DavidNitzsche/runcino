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

    #if DEBUG
    /// VW-3 · the QA-token seed path (`FaffApp.seedQATokenIfAsked`) sets the
    /// token via the ordinary Keychain-backed `set(...)` below, and on a
    /// locally-built, ad-hoc/unsigned simulator binary the write can fail
    /// silently: `keychainWrite`'s `SecItemAdd` status is never checked, so a
    /// keychain-access-group entitlement mismatch drops the item with no
    /// error. `token` (this `@Published` field) still reads "signed in" —
    /// it was set in memory in the same call — but `readToken()`,
    /// `readTokenStatus()` and `authorize(_:)` all re-read Keychain fresh, so
    /// every outbound request goes with no Authorization header.
    ///
    /// Reproduced directly, 2026-09-03: a real, unexpired, unrevoked
    /// walk-substrate session token, confirmed matching in the database,
    /// still 401'd on every single request (`/api/races`, `/api/profile`,
    /// `/api/strava/status`, `/api/today/purpose`, `/api/coach/intents`,
    /// `/api/forecast/...`) after a `-faffToken` launch on this machine —
    /// the server was never the problem.
    ///
    /// Rather than chase the exact SecItem failure mode on this machine, the
    /// QA path stops depending on the Keychain round-trip at all: an
    /// in-memory override, checked first by every read below, ahead of
    /// whatever Keychain does or does not hold. `#if DEBUG` keeps it out of
    /// every non-DEBUG build, same as the seed path itself.
    ///
    /// Rule 20 correction, 2026-09-03: the paragraph above was written when
    /// this override was ADDED, but `readToken()`, `readTokenStatus()` and
    /// `authorize(_:)` were never actually changed to check it — only
    /// `seedDebugToken` wrote it. The doc comment asserted the fix; the code
    /// did not perform it. Consequence, traced end to end the same day: a
    /// `-faffToken` launch DID reach `.main` (the in-memory `@Published
    /// token` made `isSignedIn` true), then `API.prefetchAllOnLaunch()`
    /// fired every request with no `Authorization` header (`authorize(_:)`
    /// still read Keychain, which the entitlement-mismatch write above never
    /// landed in), which 401'd across the board, which fired
    /// `.faffSessionExpired` (`FaffApp.swift`), which called
    /// `TokenStore.shared.clear()` and cleared `faff.onboarded`, which
    /// bounced the app back to the sign-in screen — the exact "stuck on
    /// sign-in despite a valid token" symptom chased over several rounds.
    /// The three functions below now actually check `debugOverrideToken`
    /// first, closing the gap this comment always claimed was closed.
    nonisolated(unsafe) private static var debugOverrideToken: String?

    /// Seed a QA session without depending on the Keychain write landing.
    /// Still calls `set(...)` so the ordinary in-memory `@Published` surface
    /// and a best-effort Keychain write both happen exactly as before —
    /// this only adds a read path that cannot be defeated by that write
    /// silently failing.
    func seedDebugToken(_ token: String) {
        TokenStore.debugOverrideToken = token
        set(token: token, expiresAt: nil, userUuid: nil)
    }
    #endif

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

    /// Read the current session token directly from Keychain. Safe to call
    /// from any context (nonisolated) — used by `authedSend` to snapshot the
    /// token before an in-flight request so a late 401 can compare against the
    /// current token and avoid clobbering a freshly-minted replacement.
    nonisolated func readToken() -> String? {
        #if DEBUG
        if let override = TokenStore.debugOverrideToken { return override }
        #endif
        return TokenStore.keychainRead(K.token)
    }

    /// A token read that distinguishes "no session token exists" from
    /// "couldn't tell right now" (Keychain locked pre-first-unlock, or any
    /// other SecItem failure). `readToken()` collapses both to `nil`, which
    /// is right for `authorize(_:)` (no token to attach either way) but
    /// wrong for `authedSend`'s 401 guard: firing .faffSessionExpired on a
    /// merely-locked read would wipe a perfectly valid, just-inaccessible
    /// token, while suppressing it on a genuinely absent token strands a
    /// signed-out runner with no route back to sign-in.
    enum ReadStatus: Equatable {
        case present(String)
        case absent
        case inaccessible
    }

    nonisolated func readTokenStatus() -> ReadStatus {
        #if DEBUG
        if let override = TokenStore.debugOverrideToken { return .present(override) }
        #endif
        return TokenStore.keychainReadStatus(K.token)
    }

    /// Augment a request with `Authorization: Bearer` when a token is set.
    /// Called from API helpers (authedGET/authedSend) on every outbound
    /// request. Reads the keychain directly (nonisolated) so background-
    /// launched contexts (notifications, watch sync, BGTask) can attach
    /// auth without round-tripping the main actor.
    nonisolated func authorize(_ req: inout URLRequest) {
        #if DEBUG
        if let override = TokenStore.debugOverrideToken {
            req.setValue("Bearer \(override)", forHTTPHeaderField: "Authorization")
            return
        }
        #endif
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
    /// fine for `authorize(_:)`, which just needs to know whether to attach
    /// a Bearer header. `authedSend`'s 401 guard needs the finer-grained
    /// `keychainReadStatus` below instead — collapsing "absent" and
    /// "inaccessible" here is exactly the distinction that guard cannot
    /// afford to lose.
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

    /// Same lookup as `keychainRead`, but reports errSecItemNotFound (no
    /// session token was ever written, or it was explicitly cleared) as
    /// `.absent`, distinct from any other SecItem failure — most notably
    /// errSecInteractionNotAllowed, returned when the device is locked and
    /// the item's `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` blocks the
    /// read. Those two cases must not be treated the same: the app cannot
    /// tell a locked device apart from a token that never existed by the
    /// string value alone.
    nonisolated fileprivate static func keychainReadStatus(_ account: String) -> TokenStore.ReadStatus {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        switch status {
        case errSecSuccess:
            guard let data = result as? Data, let str = String(data: data, encoding: .utf8) else {
                return .inaccessible
            }
            return .present(str)
        case errSecItemNotFound:
            return .absent
        default:
            return .inaccessible
        }
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
