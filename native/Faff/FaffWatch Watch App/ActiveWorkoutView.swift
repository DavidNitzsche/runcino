//
//  ActiveWorkoutView.swift
//  FaffWatch
//
//  The execution surface (scoping §2 "Workout execution UI").  Routes
//  by the current phase type to one of three screens — WARMUP/COOLDOWN,
//  WORK INTERVAL, RECOVERY — matching the mockups in
//  docs/native/01-watchos-scoping.md.
//
//  Live pace + HR are placeholders ("—") in this UI-shell phase; they
//  come from HKLiveWorkoutBuilder in phase 4.  The clocks, progress
//  bars, interval labels, and transitions are all real and timer-driven
//  so the flow is fully exercisable in the simulator.
//

import SwiftUI

struct ActiveWorkoutView: View {
    @ObservedObject var engine: WorkoutEngine
    @ObservedObject var tracker: WorkoutTracker

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                if let phase = engine.currentPhase {
                    switch phase.type {
                    case .warmup, .cooldown:
                        WarmupCooldownScreen(engine: engine, tracker: tracker, phase: phase)
                    case .work:
                        WorkIntervalScreen(engine: engine, tracker: tracker, phase: phase)
                    case .recovery:
                        RecoveryScreen(engine: engine, tracker: tracker, phase: phase)
                    }
                }

                DistanceLine(tracker: tracker)
                controls
            }
            .padding(.horizontal, 6)
        }
    }

    @ViewBuilder
    private var controls: some View {
        VStack(spacing: 6) {
            Button(role: .cancel) {
                engine.endCurrentPhase()
            } label: {
                Label("End interval", systemImage: "forward.end.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)

            Button(role: .destructive) {
                engine.abandon()
            } label: {
                Text("End workout")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .tint(.red)
        }
        .padding(.top, 4)
    }
}

// MARK: - Shared live-metric views (real, from the tracker)

/// Live GPS pace. `zoneColor` tints it on WORK intervals; secondary
/// (grey) when no fix yet or off a quality phase.
private struct LivePace: View {
    let paceSPerMi: Int
    var zoneColor: Color? = nil
    var body: some View {
        Text(paceSPerMi > 0 ? "\(PaceFormat.mmss(paceSPerMi))/mi" : "—:—/mi")
            .font(.system(.body, design: .rounded))
            .foregroundStyle(paceSPerMi > 0 ? (zoneColor ?? .primary) : .secondary)
    }
}

/// Live heart rate from the workout session.
private struct LiveHR: View {
    let bpm: Int
    var suffix: String? = nil
    var body: some View {
        HStack(spacing: 4) {
            Text(bpm > 0 ? "\(bpm) bpm" : "— bpm")
            if let suffix { Text("(\(suffix))").foregroundStyle(.secondary) }
        }
        .font(.system(.body, design: .rounded))
        .foregroundStyle(bpm > 0 ? .primary : .secondary)
    }
}

/// Cumulative distance for the run, shown under the phase card.
private struct DistanceLine: View {
    @ObservedObject var tracker: WorkoutTracker
    var body: some View {
        if tracker.distanceMi > 0 {
            Text(String(format: "%.2f mi", tracker.distanceMi))
                .font(.system(.caption, design: .rounded).monospacedDigit())
                .foregroundStyle(.secondary)
        }
    }
}

private func zoneColor(_ z: PaceZone) -> Color {
    switch z { case .onTarget: return .green; case .drifting: return .orange; case .offTarget: return .red }
}

private struct ClockLine: View {
    let elapsedSec: Int
    let targetSec: Int
    var body: some View {
        Text("\(PaceFormat.clock(elapsedSec)) / \(PaceFormat.clock(targetSec))")
            .font(.system(.title3, design: .rounded).monospacedDigit())
    }
}

// MARK: - WARMUP / COOLDOWN

private struct WarmupCooldownScreen: View {
    @ObservedObject var engine: WorkoutEngine
    @ObservedObject var tracker: WorkoutTracker
    let phase: WatchPhase

    var body: some View {
        VStack(spacing: 8) {
            Text(phase.label.uppercased())
                .font(.caption).fontWeight(.bold)
                .foregroundStyle(.secondary)
            ClockLine(elapsedSec: engine.phaseElapsedSec, targetSec: phase.durationSec)
            LivePace(paceSPerMi: tracker.paceSPerMi)
            LiveHR(bpm: tracker.heartRate)
            ProgressView(value: engine.phaseProgress)
                .tint(.blue)
        }
    }
}

// MARK: - WORK INTERVAL (the high-stakes screen)

private struct WorkIntervalScreen: View {
    @ObservedObject var engine: WorkoutEngine
    @ObservedObject var tracker: WorkoutTracker
    let phase: WatchPhase

    var body: some View {
        VStack(spacing: 6) {
            Text(phase.label.uppercased())
                .font(.caption).fontWeight(.bold)
                .foregroundStyle(.secondary)

            if let target = phase.targetPaceSPerMi {
                VStack(spacing: 0) {
                    Text("TARGET")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(.secondary)
                    Text(PaceFormat.mmss(target))
                        .font(.system(size: 34, weight: .bold, design: .rounded))
                        .foregroundStyle(.orange)
                }
            }

            // Live GPS pace coloured by drift zone (green/amber/red) +
            // signed delta vs target. The engine feeds the PaceDrift
            // evaluator and fires a sustained-drift haptic.
            HStack(spacing: 6) {
                LivePace(paceSPerMi: tracker.paceSPerMi,
                         zoneColor: phase.targetPaceSPerMi != nil ? zoneColor(engine.paceZone) : nil)
                if tracker.paceSPerMi > 0, phase.targetPaceSPerMi != nil {
                    Text(engine.paceDeltaSPerMi == 0 ? "±0"
                         : (engine.paceDeltaSPerMi > 0 ? "+\(engine.paceDeltaSPerMi)" : "\(engine.paceDeltaSPerMi)"))
                        .font(.caption)
                        .foregroundStyle(zoneColor(engine.paceZone))
                }
            }
            LiveHR(bpm: tracker.heartRate)
            ClockLine(elapsedSec: engine.phaseElapsedSec, targetSec: phase.durationSec)
            ProgressView(value: engine.phaseProgress)
                .tint(.orange)
        }
    }
}

// MARK: - RECOVERY

private struct RecoveryScreen: View {
    @ObservedObject var engine: WorkoutEngine
    @ObservedObject var tracker: WorkoutTracker
    let phase: WatchPhase

    var body: some View {
        VStack(spacing: 8) {
            Text(phase.label.uppercased())
                .font(.caption).fontWeight(.bold)
                .foregroundStyle(.secondary)
            ClockLine(elapsedSec: engine.phaseElapsedSec, targetSec: phase.durationSec)
            LivePace(paceSPerMi: tracker.paceSPerMi)
            LiveHR(bpm: tracker.heartRate, suffix: "cooling")
            ProgressView(value: engine.phaseProgress)
                .tint(.green)
            if let next = engine.nextPhase {
                Text("next: \(next.label)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

#Preview {
    ActiveWorkoutView(engine: {
        let e = WorkoutEngine(workout: .sample)
        e.start()
        return e
    }(), tracker: WorkoutTracker())
}
