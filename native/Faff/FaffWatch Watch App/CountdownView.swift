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
        // Just the huge number, owning the whole screen (approved §B redesign).
        Text("\(max(engine.countdownValue, 1))")
            .font(WatchTheme.display(240))
            .foregroundStyle(WatchTheme.C.green)
            .monospacedDigit()
            .lineLimit(1).minimumScaleFactor(0.3)
            .contentTransition(.numericText(countsDown: true))
            .animation(.snappy, value: engine.countdownValue)
            .offset(y: 10)        // optically center (Bebas line box rides high)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(WatchTheme.C.bg.ignoresSafeArea())
    }
}
