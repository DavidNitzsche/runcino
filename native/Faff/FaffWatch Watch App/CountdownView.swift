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
                .font(WatchTheme.sub(14, .semibold)).tracking(1)
                .foregroundStyle(WatchTheme.C.green)
            Text("\(max(engine.countdownValue, 1))")
                .font(WatchTheme.display(120))
                .foregroundStyle(WatchTheme.C.ink)
                .monospacedDigit()
                .contentTransition(.numericText(countsDown: true))
                .animation(.snappy, value: engine.countdownValue)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WatchTheme.C.bg.ignoresSafeArea())
    }
}
