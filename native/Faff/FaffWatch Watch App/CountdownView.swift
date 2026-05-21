//
//  CountdownView.swift
//  FaffWatch
//
//  The three-count between Start and the warmup (watch-app.html §B): a
//  green "Get ready" eyebrow over a single huge number, one tick haptic
//  per beat (fired by the engine), so the GPS-laggy first seconds aren't
//  a panic. Pure presentation — the engine owns the countdown clock.
//

import SwiftUI

struct CountdownView: View {
    @ObservedObject var engine: WorkoutEngine

    var body: some View {
        VStack(spacing: 6) {
            Text("Get ready")
                .font(WatchTheme.body(12, .bold)).tracking(0.8)
                .foregroundStyle(WatchTheme.C.green).textCase(.uppercase)
            Text("\(max(engine.countdownValue, 1))")
                .font(WatchTheme.display(130))
                .foregroundStyle(WatchTheme.C.green)
                .monospacedDigit()
                .contentTransition(.numericText(countsDown: true))
                .animation(.snappy, value: engine.countdownValue)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WatchTheme.C.bg.ignoresSafeArea())
    }
}
