//
//  TokenStore.swift
//  Faff
//
//  Secure storage for auth tokens.  Uses Keychain (the Apple-canonical
//  pattern for credentials) — not UserDefaults, which is plaintext-
//  readable by anyone with filesystem access.
//
//  Two tokens are managed here:
//
//    accessToken  · short-lived Bearer · 24h TTL · attached to API calls
//    refreshToken · long-lived rotation · 90d TTL · used when access expires
//
//  Both are stored under the same service identifier ("run.faff.app").
//  Clearing one clears both — logout is atomic.
//
//  Created on 2026-05-19 · Phase 2 iPhone bridge work.
//

import Foundation
import Security

@MainActor
final class TokenStore {
    static let shared = TokenStore()
    private init() {}

    private let service = "run.faff.app"

    var accessToken: String? {
        get { read(account: "accessToken") }
        set { write(account: "accessToken", value: newValue) }
    }

    var refreshToken: String? {
        get { read(account: "refreshToken") }
        set { write(account: "refreshToken", value: newValue) }
    }

    var isLoggedIn: Bool {
        accessToken != nil && refreshToken != nil
    }

    func clear() {
        accessToken = nil
        refreshToken = nil
    }

    // MARK: - Keychain primitives

    private func read(account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    private func write(account: String, value: String?) {
        let baseQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]

        // Always delete the existing entry first.  SecItemUpdate has
        // subtle differences across iOS versions; delete+add is the
        // canonical idiomatic pattern.
        SecItemDelete(baseQuery as CFDictionary)

        guard let value, let data = value.data(using: .utf8) else { return }

        var addQuery = baseQuery
        addQuery[kSecValueData as String] = data
        addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(addQuery as CFDictionary, nil)
    }
}
