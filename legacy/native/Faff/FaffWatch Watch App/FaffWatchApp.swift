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
        WatchFonts.register()
        // App-level UserDefaults registrations. `register(defaults:)` only
        // applies when a key hasn't been set yet — so existing testers who
        // manually toggled Sound OFF keep that value; new installs (and
        // anyone who hasn't touched the toggle) get audibleAlerts = true.
        UserDefaults.standard.register(defaults: [
            "audibleAlerts": true,
        ])
        // The three notification boards are useless until their categories
        // are registered — without this the OS draws its own plain alert and
        // the custom long-look never runs.
        WatchNotificationCategories.register()
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

        // The custom long-look interfaces. Session moved, Race tomorrow and
        // Yesterday-is-unread each get the app's own board rather than the
        // system alert — one shell, and an action only on the one that
        // genuinely has one.
        FaffNotificationScenes()
    }
}
