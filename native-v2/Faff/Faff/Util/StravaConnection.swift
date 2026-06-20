//
//  StravaConnection.swift
//  Faff
//
//  Synchronous, app-wide source of truth for "is Strava linked to this
//  account". Mirrors the HealthKit pattern (faff.health.connected.v2) so
//  any view can gate Strava UI at render time without an async round-trip.
//
//  Product rule (David, 2026-06-20): if the runner hasn't connected Strava,
//  Strava is hidden everywhere EXCEPT the Settings connection row (the
//  re-enable door) and the onboarding Connect step. This flag is what the
//  hidden surfaces read.
//
//  The authoritative value is profile.connections.strava.connected; the
//  surfaces that load profile/state refresh this mirror on every load, and
//  a successful OAuth round-trip sets it immediately for snappy UI. Token
//  health ("needs_reauth") is a SEPARATE signal carried by
//  /api/strava/status and handled by StravaReconnectBanner — a runner whose
//  token expired is still "linked", so the mirror stays true and only the
//  reconnect banner fires.
//

import Foundation

enum StravaConnection {
    private static let key = "faff.strava.connected.v1"

    /// True when Strava is linked to this account. Read at render time to
    /// gate Strava UI.
    static var isConnected: Bool {
        UserDefaults.standard.bool(forKey: key)
    }

    /// Set the linked state. Call from profile/state loads (authoritative)
    /// and on a successful OAuth round-trip.
    static func set(_ linked: Bool) {
        UserDefaults.standard.set(linked, forKey: key)
    }

    /// Clear on sign-out so the next account on this device doesn't inherit
    /// the previous runner's Strava visibility.
    static func clear() {
        UserDefaults.standard.removeObject(forKey: key)
    }
}
</content>
