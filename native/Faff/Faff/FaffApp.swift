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
        }
    }
}
