//
//  FaffApp.swift
//  Faff
//
//  Created by David Nitzsche on 5/19/26.
//

import SwiftUI

@main
struct FaffApp: App {
    init() {
        FaffFonts.register()   // bundle the v4 typefaces before any view renders
    }
    var body: some Scene {
        WindowGroup {
            ContentView()
                // The v4 design is light-only (cream ground, white cards, no
                // dark tokens). Without this, dark-mode renders the adaptive
                // bits — the .ultraThinMaterial sticky header, the status bar —
                // dark/gray against the cream content. Pin to light everywhere.
                .preferredColorScheme(.light)
        }
    }
}
