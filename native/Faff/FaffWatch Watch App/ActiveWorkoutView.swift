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

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                if let phase = engine.currentPhase {
                    switch phase.type {
                    case .warmup, .cooldown:
                        WarmupCooldownScreen(engine: engine, phase: phase)
                    case .work:
                        WorkIntervalScreen(engine: engine, phase: phase)
                    case .recovery:
                        RecoveryScreen(engine: engine, phase: phase)
                    }
                }

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

// MARK: - Shared live-metric placeholders

/// Live pace · placeholder until HKLiveWorkoutBuilder lands (phase 4).
private struct LivePace: View {
    var body: some View {
        Text("—:—/mi")
            .font(.system(.body, design: .rounded))
            .foregroundStyle(.secondary)
    }
}

/// Live HR · placeholder until HKLiveWorkoutBuilder lands (phase 4).
private struct LiveHR: View {
    var suffix: String? = nil
    var body: some View {
        HStack(spacing: 4) {
            Text("— bpm")
            if let suffix { Text("(\(suffix))").foregroundStyle(.secondary) }
        }
        .font(.system(.body, design: .rounded))
        .foregroundStyle(.secondary)
    }
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
    let phase: WatchPhase

    var body: some View {
        VStack(spacing: 8) {
            Text(phase.label.uppercased())
                .font(.caption).fontWeight(.bold)
                .foregroundStyle(.secondary)
            ClockLine(elapsedSec: engine.phaseElapsedSec, targetSec: phase.durationSec)
            LivePace()
            LiveHR()
            ProgressView(value: engine.phaseProgress)
                .tint(.blue)
        }
    }
}

// MARK: - WORK INTERVAL (the high-stakes screen)

private struct WorkIntervalScreen: View {
    @ObservedObject var engine: WorkoutEngine
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

            // Current pace + delta-vs-target · placeholders until live
            // sensor data lands (phase 4).
            //
            // PHASE-4 HOOK: feed each live pace sample into a
            //   PaceDriftEvaluator(targetPaceSPerMi: target,
            //                      toleranceSPerMi: phase.tolerancePaceSPerMi ?? 10)
            // and use the returned .zone to color this pace text
            // (green/amber/red) + show result.deltaSPerMi as the "±" value,
            // and fire Haptics.almostDone()-style cue when result.fireHaptic
            // is true. The PaceDrift logic + tests already exist (PaceDrift.swift).
            HStack(spacing: 6) {
                LivePace()
                Text("±—")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            LiveHR()
            ClockLine(elapsedSec: engine.phaseElapsedSec, targetSec: phase.durationSec)
            ProgressView(value: engine.phaseProgress)
                .tint(.orange)
        }
    }
}

// MARK: - RECOVERY

private struct RecoveryScreen: View {
    @ObservedObject var engine: WorkoutEngine
    let phase: WatchPhase

    var body: some View {
        VStack(spacing: 8) {
            Text(phase.label.uppercased())
                .font(.caption).fontWeight(.bold)
                .foregroundStyle(.secondary)
            ClockLine(elapsedSec: engine.phaseElapsedSec, targetSec: phase.durationSec)
            LivePace()
            LiveHR(suffix: "cooling")
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
    }())
}
