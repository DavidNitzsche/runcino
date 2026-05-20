//
//  FaffWatchApp.swift
//  FaffWatch Watch App
//
//  Created by David Nitzsche on 5/19/26.
//

import SwiftUI

@main
struct FaffWatch_Watch_AppApp: App {
    init() { WatchTheme.registerFonts() }
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
