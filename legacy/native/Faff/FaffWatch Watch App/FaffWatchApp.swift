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
    }
}
