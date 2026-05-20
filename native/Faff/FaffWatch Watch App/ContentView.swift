//
//  ContentView.swift
//  FaffWatch Watch App
//
//  Created by David Nitzsche on 5/19/26.
//

import SwiftUI

struct ContentView: View {
    var body: some View {
        // Routes IDLE → active workout → SUMMARY (see WorkoutRootView).
        WorkoutRootView()
    }
}

#Preview {
    ContentView()
}
