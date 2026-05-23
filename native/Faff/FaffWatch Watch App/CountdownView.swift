//
//  CountdownView.swift
//  FaffWatch
//
//  Pre-roll 3-2-1 before the workout begins. Under the locked grammar:
//  single huge Helvetica Neue digit in Faff.live green, centered on a
//  black canvas. One tick haptic per beat (fired by the engine).
//
//  Pure presentation — the engine owns the countdown clock.
//

import SwiftUI

struct CountdownView: View {
    @ObservedObject var engine: WorkoutEngine

    var body: some View {
        ResponsiveFace {
            GeometryReader { geo in
                let h = geo.size.height
                ZStack {
                    Color.black.ignoresSafeArea()
                    Text("\(max(engine.countdownValue, 1))")
                        .font(.custom("HelveticaNeue-Bold", size: h * 0.90))
                        .foregroundStyle(Faff.live)
                        .monospacedDigit()
                        .lineLimit(1)
                        .minimumScaleFactor(0.3)
                        .contentTransition(.numericText(countsDown: true))
                        .animation(.snappy, value: engine.countdownValue)
                        .padding(.vertical, -h * 0.90 * 0.22)   // tight-number crop
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
        }
    }
}
