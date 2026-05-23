//
//  WatchFixtures.swift
//  FaffWatch
//
//  AFTER the locked-face migration this file holds only two things:
//    1. `InRunStatsFace` — the swipe-page 2×2 grid (elapsed / distance /
//       avg pace / calories). Still owned by the WatchFaces.swift primitive
//       stack since it's an inventory view, not the in-run face.
//    2. `WatchFixtureView` — a thin stub that lets `-face <name>` still launch
//       the app without crashing. It now just renders a placeholder; the
//       formal visual-regression scaffolding (scripts/watch/refs) needs to be
//       rebuilt against the new face system before it can light back up.
//

import SwiftUI

// MARK: - In-run stats (swipe page · 2×2 grid)

/// In-run secondary stats — the swipe page off the work face for the "nice but
/// rarely looked at" metrics: elapsed, distance, avg pace, active calories. A
/// 2×2 grid that fills the screen. (Elapsed lives here, not the top-right
/// corner the OS clock owns.)
struct InRunStatsFace: View {
    let elapsed: String
    let distance: String      // "3.2"
    let avgPace: String       // "6:42"
    let calories: String      // "412"
    var body: some View {
        // No header — the metric labels self-describe. The 2×2 grid fills the
        // whole screen below the clock (safe area respected), each cell
        // centered in its quadrant.
        VStack(spacing: 0) {
            row(left: cell(elapsed, nil, "Elapsed"), right: cell(distance, "mi", "Distance"))
            Rectangle().fill(WP.line).frame(height: 1)
            row(left: cell(avgPace, "/mi", "Avg pace"), right: cell(calories, nil, "Calories"))
        }
        .padding(.horizontal, 10)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WP.bg)
    }
    private func row<L: View, R: View>(left: L, right: R) -> some View {
        HStack(spacing: 6) {
            left.frame(maxWidth: .infinity)
            Rectangle().fill(WP.line).frame(width: 1, height: 40)
            right.frame(maxWidth: .infinity)
        }
        .frame(maxHeight: .infinity)
    }
    private func cell(_ value: String, _ unit: String?, _ label: String) -> some View {
        VStack(spacing: 3) {
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(value).font(WF.bebas(42)).monospacedDigit().foregroundStyle(WP.ink)
                if let unit { Text(unit).font(WF.interSemi(13)).foregroundStyle(WP.muted) }
            }
            .lineLimit(1).minimumScaleFactor(0.6)
            Text(label.uppercased()).font(WF.interBold(9.5)).tracking(0.7).foregroundStyle(WP.muted)
        }
    }
}

// MARK: - Fixture entry point (now a stub)

/// `-face <name>` used to render a per-face fixture; the locked face system
/// makes that scaffolding obsolete and a fresh visual-regression pass will be
/// authored against Faces.swift. Until then, render a single sample face so
/// the launch path still works without crashing.
struct WatchFixtureView: View {
    let face: String
    var body: some View {
        ResponsiveFace {
            content
        }
    }
    @ViewBuilder private var content: some View {
        switch face {
        case "easy":
            EasyFace(pace: "8:42", paceRole: .live,
                     hr: "145", hrOver: false, cadence: "172", distance: "2.30")
        case "easy-no-gps":
            // Simulate the just-pressed-Start state — no GPS lock yet, pace is
            // the "—:—" placeholder rendered in mute grey. The em-dash width
            // fix means the placeholder doesn't blow up the font size; the
            // three rows still read as a clean stack.
            EasyFace(pace: "—:—", paceRole: .mute,
                     hr: "66", hrOver: false, cadence: "—", distance: "0.00")
        case "easy-hr-over":
            EasyFace(pace: "8:42", paceRole: .live,
                     hr: "164", hrOver: true, cadence: "172", distance: "2.30")
        case "rep":
            WorkIntervalFace(livePace: "6:33", paceRole: .live, targetPace: "6:31",
                             totalDistance: "3.78", repCounter: "0:24",
                             stripStates: [1, 1, 1, 2, 0, 0])
        case "race":
            LiveRaceFace(livePace: "8:28", paceRole: .live, phaseTarget: "8:30",
                         totalDistance: "10.8", goalDelta: "+1:14", goalDeltaRole: .live,
                         phaseSegments: [1, 1, 2, 0, 0, 0])
        case "warmup":
            WarmupFace(coveredValue: "0.4", thenPace: "6:31", thenDistance: "0.50")
        case "recovery", "rest":
            RestFace(restTimeLeft: "1:30", nextTargetPace: "6:31", nextDistance: "0.50")
        case "go":
            GoFace(sub: "Rep 1 · 6:31")
        case "fuel":
            FuelFace(big: "Fuel · 2 of 3", sub: "+ water")
        case "landmark":
            LandmarkFace(big: "BIXBY", sub: "0.3 mi ahead")
        case "milesplit", "mile-split":
            MileSplitFace(mile: "MILE 7", pace: "8:42")
        case "pause":
            LivePauseFace(distance: "4.10", elapsed: "38:20", onResume: {})
        case "complete":
            CompleteFace(label: "Threshold", pace: "8:48", distance: "9.6", elapsed: "1:24",
                         onDone: {})
        case "today":
            TodayDoneFace()
        case "calibrate":
            CalibrateFace(mile: 13)
        case "stats":
            InRunStatsFace(elapsed: "24:18", distance: "3.2", avgPace: "6:42", calories: "412")
        case "hr":
            HRFace(pace: "9:15", hr: "142", hrRole: .live, distance: "4.1")
        case "strides":
            StridesFace(livePace: "5:30", burstCountdown: "0:14",
                        stripStates: [1, 1, 1, 2, 0, 0])
        case "steady":
            SteadyRunFace(livePace: "8:55", paceRole: .live, distance: "9.6", elapsed: "1:25")
        default:
            // Default fixture: rep-work face — the canonical reference.
            WorkIntervalFace(livePace: "6:33", paceRole: .live, targetPace: "6:31",
                             totalDistance: "3.78", repCounter: "0:24",
                             stripStates: [1, 1, 1, 2, 0, 0])
        }
    }
}

#Preview("Fixture · rep") { WatchFixtureView(face: "rep") }
#Preview("Fixture · race") { WatchFixtureView(face: "race") }
#Preview("Fixture · easy-hr-over") { WatchFixtureView(face: "easy-hr-over") }
