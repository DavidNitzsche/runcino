//
//  FaffWatchApp.swift
//  FaffWatch Watch App
//
//  Created by David Nitzsche on 5/19/26.
//

import SwiftUI

@main
struct FaffWatch_Watch_AppApp: App {
    init() {
        WatchTheme.registerFonts()
        // App-level UserDefaults registrations. `register(defaults:)` only
        // applies when a key hasn't been set yet — so existing testers who
        // manually toggled Sound OFF keep that value; new installs (and
        // anyone who hasn't touched the toggle) get audibleAlerts = true.
        UserDefaults.standard.register(defaults: [
            "audibleAlerts": true,
        ])
    }
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        // System woke us to finish a background completion upload — recreate
        // the session so its delegate receives the queued events and the
        // durable queue gets drained. (watchOS 9+; target is 10.0.)
        .backgroundTask(.urlSession(PhoneSync.bgSessionId)) {
            await PhoneSync.shared.ensureBackgroundSession()
        }
    }
}
