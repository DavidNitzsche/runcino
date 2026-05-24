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

/// In-run secondary stats — the swipe page off the work face. Re-skinned
/// under the locked grammar: four big number rows, colour-coded to type,
/// no labels (position + colour carry the meaning, same as the in-run
/// faces).
///
///   · distance  (blue · canonical)
///   · elapsed   (white · neutral readout)
///   · avg pace  (green · live when computed, muted while still 0)
///   · calories  (muted · least-actionable readout)
struct InRunStatsFace: View {
    let elapsed: String      // "24:18"
    let distance: String     // "3.2"
    let avgPace: String      // "6:42" or "—:—"
    let calories: String     // "412" or "—"

    private var paceRole: Role {
        avgPace == "—:—" || avgPace == "—" ? .mute : .live
    }
    var body: some View {
        NumberFace(rows: [
            NumRow(distance, .dist),
            NumRow(elapsed,  .neutral),
            NumRow(avgPace,  paceRole),
            // Flame icon disambiguates the bare integer from HR / cadence /
            // any other count. Same icon pattern as HR (♥) / cadence (🏃)
            // on the in-run faces — glyph = "this is what kind of number."
            NumRow(calories, .mute, icon: "flame.fill")
        ])
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
            FuelFace(index: 2, total: 3)
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
        case "splits":
            SplitsFace(rows: [
                .init(repNo: 1, pace: "6:29", role: .live),
                .init(repNo: 2, pace: "6:30", role: .live),
                .init(repNo: 3, pace: "6:33", role: .neutral),   // current
                .init(repNo: 4, pace: "—",    role: .mute),
                .init(repNo: 5, pace: "—",    role: .mute),
                .init(repNo: 6, pace: "—",    role: .mute)
            ])
        case "session-map":
            SessionMapFace(rows: [
                .init(label: "Warmup",     value: "10:00", state: .done),
                .init(label: "Reps 1–2",   value: "✓",     state: .done),
                .init(label: "Rep 3 · now", value: "6:31", state: .current),
                .init(label: "Reps 4–6",   value: "3×",    state: .upcoming),
                .init(label: "Cooldown",   value: "10:00", state: .upcoming)
            ])
        case "justrun", "just-run":
            JustRunFace(onStart: {})
        case "lobby-easy":
            // Easy long run with a pace RANGE — exercises the new
            // paceRange subtitle under the midpoint. Time hits 101 min
            // → renders as h:mm "1:41" per the >=60-min rule.
            LobbyFace(name: "LONG RUN", distance: "11.6", pace: "8:44",
                      time: "1:41", paceRange: "8:29-8:59", onStart: {})
        case "lobby-race":
            LobbyFace(name: "BIG SUR", distance: "26.2", pace: "8:46",
                      time: "3:50", paceRange: nil, showTimeIcon: false, onStart: {})
        case "countdown":
            // Render a 3 — the engine drives the real countdown; this is
            // just a layout fixture.
            CountdownView(engine: WorkoutEngine.fixture(
                workout: .sample, currentIndex: 0,
                phaseElapsedSec: 0, totalElapsedSec: 0))
        case "summary-workout":
            SummaryView(
                workout: .sample,
                completion: WatchCompletion(
                    workoutId: "sample", startedAt: "", completedAt: "",
                    status: "completed", totalDistanceMi: 6.4,
                    totalDurationSec: 3134, avgHr: 171, maxHr: 182,
                    avgCadence: 181, phases: []),
                onDone: {})
        case "summary-race":
            SummaryView(
                workout: .sampleRace,
                completion: WatchCompletion(
                    workoutId: "race", startedAt: "", completedAt: "",
                    status: "completed", totalDistanceMi: 26.2,
                    totalDurationSec: 13752, avgHr: 168, maxHr: 184,
                    avgCadence: 178, phases: []),
                onDone: {})
        // ── Tomorrow's long-run fixtures ──────────────────────────────────
        case "tomorrow-easy-mid":
            // Easy face mid-run, on pace, GPS locked. Shows the rotating
            // guardrail in HR position.
            EasyFace(pace: "8:42", paceRole: .live,
                     hr: "145", hrOver: false, cadence: "172", distance: "5.30")
        case "tomorrow-easy-cadence":
            // Same face, 60s later — rotation has flipped to cadence.
            EasyFace(pace: "8:46", paceRole: .live,
                     hr: "147", hrOver: false, cadence: "172", distance: "5.31")
        case "tomorrow-milesplit":
            // Mid-run mile-split flash for mile 5.
            MileSplitFace(mile: "MILE 5", pace: "8:39")
        case "tomorrow-fuel-1":
            FuelFace(index: 1, total: 3)
        case "tomorrow-fuel-3":
            FuelFace(index: 3, total: 3)
        case "tomorrow-pause":
            LivePauseFace(distance: "5.30", elapsed: "46:18", onResume: {})
        case "tomorrow-summary":
            // Long-run completion — name "LONG RUN", ~11.6 mi, ~1:42:18.
            SummaryView(
                workout: WatchWorkout(
                    workoutId: "long-tomorrow",
                    name: "LONG RUN",
                    summary: "Long Run · 8:29-8:59/mi · easy",
                    totalEstimatedMinutes: 101,
                    phases: [], completionEndpoint: "",
                    expiresAt: "2099-01-01T00:00:00Z",
                    distanceMi: 11.6),
                completion: WatchCompletion(
                    workoutId: "long-tomorrow", startedAt: "", completedAt: "",
                    status: "completed", totalDistanceMi: 11.6,
                    totalDurationSec: 6138, avgHr: 148, maxHr: 162,
                    avgCadence: 173, phases: []),
                onDone: {})
        case "controls":
            ControlsFace(paused: false, onPrimary: {}, onEnd: {})
        case "headsup":
            HeadsUpFace(sub: "3 SECONDS LEFT")
        case "phase-change":
            PhaseChangeFace(title: "HURRICANE", sub: "10:38/MI · HOLD EFFORT")
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
