//
//  SessionHygiene.swift
//  One sign-out cleanup shared by SettingsView + ProfileView.
//
//  Audit P2-38 (2026-07-06): the two sign-out buttons had drifted ·
//  ProfileView skipped the lastNightHours stash (user B briefly saw
//  user A's last-night sleep) and NEITHER path cleared the cycle-ingest
//  flag or revoked the server session. Every future sign-out surface
//  calls this instead of hand-rolling the key list.
//

import Foundation

enum SessionHygiene {

    /// Full local + server sign-out. Revokes the server session first
    /// (needs the token), then clears every user-tied local stash and
    /// posts .faffGateReset so RootContainer bounces to SignIn.
    @MainActor
    static func signOut() async {
        // Server session revoke · fire-and-forget. A dead network still
        // signs the device out locally; the row expires server-side.
        await API.logout()

        TokenStore.shared.clear()

        let d = UserDefaults.standard
        // Gate flags · next launch lands on SignIn, no auto-bypass.
        d.removeObject(forKey: "faff.onboarded")
        // Health connect flag · the next account must re-consent, and the
        // Settings row must honestly read "Connect" again.
        d.removeObject(forKey: "faff.health.connected.v2")
        // User-tied metric stash · without this the NEXT account to sign
        // in on this device briefly renders the previous runner's
        // last-night sleep (multi-user hygiene, 2026-06-10). Clearing the
        // published value also removes the UserDefaults key via didSet.
        HealthKitImporter.shared.lastNightHours = nil
        d.removeObject(forKey: "faff.health.lastNightHours.v1")
        // Cycle-ingest opt-in is per-person, not per-device.
        HealthKitImporter.shared.cycleEnabled = false

        StravaConnection.clear()
        AppCache.clearAll()

        NotificationCenter.default.post(name: .faffGateReset, object: nil)
    }
}
