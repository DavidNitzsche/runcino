//
//  TokenStore.swift  (P39)
//  Session token persistence for the iPhone. Beta uses UserDefaults;
//  move to Keychain when multi-user goes live (the token is an opaque
//  server-side reference, so the risk surface is "stolen device →
//  attacker reads runs"). The server's session table tracks created
//  + last_used + revoked_at, so a stolen token can be revoked.
//

import Foundation

@MainActor
final class TokenStore: ObservableObject {
    static let shared = TokenStore()
    private init() {
        self.token = UserDefaults.standard.string(forKey: tokenKey)
        self.expiresAt = UserDefaults.standard.string(forKey: expiresKey)
        self.userUuid = UserDefaults.standard.string(forKey: userUuidKey)
    }

    private let tokenKey  = "faff.session.token"
    private let expiresKey = "faff.session.expires_at"
    private let userUuidKey = "faff.session.user_uuid"

    @Published var token: String?
    @Published var expiresAt: String?
    @Published var userUuid: String?

    var isSignedIn: Bool { token != nil }

    func set(token: String?, expiresAt: String?, userUuid: String?) {
        self.token = token
        self.expiresAt = expiresAt
        self.userUuid = userUuid
        if let t = token {
            UserDefaults.standard.set(t, forKey: tokenKey)
            UserDefaults.standard.set(expiresAt, forKey: expiresKey)
            UserDefaults.standard.set(userUuid, forKey: userUuidKey)
        } else {
            UserDefaults.standard.removeObject(forKey: tokenKey)
            UserDefaults.standard.removeObject(forKey: expiresKey)
            UserDefaults.standard.removeObject(forKey: userUuidKey)
        }
    }

    func clear() { set(token: nil, expiresAt: nil, userUuid: nil) }

    /// Augment a request with Authorization: Bearer when a token is set.
    /// Called from API helpers in API.swift via `authed(_:)`.
    nonisolated func authorize(_ req: inout URLRequest) {
        // Cross-actor read — main-actor mutation of `token` is serialized
        // via UserDefaults; reads here may lag by one update but that's
        // acceptable for HTTP auth (a 401 will trigger re-sign-in).
        if let t = UserDefaults.standard.string(forKey: "faff.session.token") {
            req.setValue("Bearer \(t)", forHTTPHeaderField: "Authorization")
        }
    }
}
