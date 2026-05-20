//
//  ActiveWorkoutView.swift
//  FaffWatch
//
//  The execution surface — the dark v4 face (watch-app.html). Routes by
//  the current phase type. The WORK INTERVAL face is the canon: a top
//  strip (orientation + elapsed), the whole-session segment bar, a
//  centered auto-scaling pace hero color-coded by drift, a target/delta
//  reference, HR + cadence, and the rep progress bar.
//
//  Live pace/HR/cadence come from the tracker (mocked in the simulator,
//  HKLiveWorkoutBuilder + GPS on a physical watch). Long-press the face
//  for End-interval / End-workout controls so they never crowd the glance.
//

import SwiftUI

struct ActiveWorkoutView: View {
    @ObservedObject var engine: WorkoutEngine
    @ObservedObject var tracker: WorkoutTracker
    @State private var showControls = false

    var body: some View {
        ZStack {
            WatchTheme.C.bg.ignoresSafeArea()
            if let phase = engine.currentPhase {
                switch phase.type {
                case .work:
                    WorkIntervalFace(engine: engine, tracker: tracker, phase: phase)
                case .warmup, .cooldown:
                    SteadyFace(engine: engine, tracker: tracker, phase: phase, accent: WatchTheme.C.t2)
                case .recovery:
                    SteadyFace(engine: engine, tracker: tracker, phase: phase, accent: WatchTheme.C.green)
                }
            }
        }
        .contentShape(Rectangle())
        .onLongPressGesture(minimumDuration: 0.4) { showControls = true }
        .confirmationDialog("Workout", isPresented: $showControls, titleVisibility: .hidden) {
            Button("End interval") { engine.endCurrentPhase() }
            Button("End workout", role: .destructive) { engine.abandon() }
            Button("Resume", role: .cancel) {}
        }
    }
}

// MARK: - Shared face chrome

/// Top strip: orientation eyebrow (left) + elapsed workout time (right).
private struct TopStrip: View {
    let eyebrow: String
    let eyebrowColor: Color
    let elapsedSec: Int
    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(eyebrow.uppercased())
                .font(WatchTheme.sub(13, .semibold)).tracking(0.8)
                .foregroundStyle(eyebrowColor)
                .lineLimit(1)
            Spacer()
            Text(PaceFormat.clock(elapsedSec))
                .font(WatchTheme.body(13, .semibold)).monospacedDigit()
                .foregroundStyle(WatchTheme.C.t2)
        }
    }
}

/// A hairline strip of the whole session — one cell per phase, sized by
/// duration. Done = green, current = orange, upcoming = track.
private struct SegmentBar: View {
    @ObservedObject var engine: WorkoutEngine
    var body: some View {
        let phases = engine.workout.phases
        let total = max(phases.reduce(0) { $0 + $1.durationSec }, 1)
        GeometryReader { geo in
            HStack(spacing: 1.5) {
                ForEach(phases) { p in
                    let w = geo.size.width * CGFloat(p.durationSec) / CGFloat(total)
                    Capsule().fill(color(for: p.index))
                        .frame(width: max(w - 1.5, 2))
                }
            }
        }
        .frame(height: 3)
    }
    private func color(for idx: Int) -> Color {
        if idx < engine.currentIndex { return WatchTheme.C.green }
        if idx == engine.currentIndex { return WatchTheme.C.orange }
        return WatchTheme.C.track
    }
}

/// One bottom stat: big Bebas value + small unit-as-label (bpm/spm).
private struct WStat: View {
    let value: Int
    let unit: String
    var body: some View {
        (Text(value > 0 ? "\(value)" : "—").font(WatchTheme.display(30)).foregroundStyle(WatchTheme.C.ink)
         + Text(unit).font(WatchTheme.body(12, .semibold)).foregroundStyle(WatchTheme.C.t2))
            .lineLimit(1)
    }
}

/// Rep progress bar + time left in the phase.
private struct RepProgress: View {
    let progress: Double
    let remainingSec: Int
    var fill: Color = WatchTheme.C.orange
    var body: some View {
        HStack(spacing: 7) {
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(WatchTheme.C.track)
                    Capsule().fill(fill).frame(width: max(geo.size.width * progress, 3))
                }
            }
            .frame(height: 5)
            Text(PaceFormat.clock(remainingSec))
                .font(WatchTheme.body(12, .semibold)).monospacedDigit()
                .foregroundStyle(WatchTheme.C.t2)
        }
    }
}

// MARK: - WORK INTERVAL (the hero face)

private struct WorkIntervalFace: View {
    @ObservedObject var engine: WorkoutEngine
    @ObservedObject var tracker: WorkoutTracker
    let phase: WatchPhase

    private var workOrdinal: (Int, Int) {
        let work = engine.workout.phases.filter { $0.type == .work }
        let n = (work.firstIndex { $0.index == phase.index }).map { $0 + 1 } ?? 1
        return (n, work.count)
    }
    private var hasPace: Bool { tracker.paceSPerMi > 0 }
    private var heroColor: Color {
        guard hasPace, phase.targetPaceSPerMi != nil else { return WatchTheme.C.t3 }
        return .zone(engine.paceZone)
    }
    private var refStatus: (String, Color) {
        guard phase.targetPaceSPerMi != nil, hasPace else { return ("warming", WatchTheme.C.t3) }
        let d = engine.paceDeltaSPerMi
        switch engine.paceZone {
        case .onTarget: return ("on pace", WatchTheme.C.green)
        case .drifting: return (d > 0 ? "+\(d)s" : "\(d)s", WatchTheme.C.amber)
        case .offTarget: return (d > 0 ? "+\(d)s" : "\(d)s", WatchTheme.C.warn)
        }
    }

    var body: some View {
        let (n, m) = workOrdinal
        VStack(spacing: 0) {
            TopStrip(eyebrow: "Int \(n) / \(m)", eyebrowColor: WatchTheme.C.amber,
                     elapsedSec: engine.totalElapsedSec)
            SegmentBar(engine: engine).padding(.top, 5)

            Spacer(minLength: 4)

            // Hero — current pace, centered + auto-scaled, color-coded.
            Text(hasPace ? PaceFormat.mmss(tracker.paceSPerMi) : "—:—")
                .font(WatchTheme.display(86))
                .foregroundStyle(heroColor)
                .lineLimit(1).minimumScaleFactor(0.45)
                .frame(maxWidth: .infinity)
            // Reference — target + live delta.
            if let target = phase.targetPaceSPerMi {
                (Text(PaceFormat.mmss(target)).foregroundStyle(WatchTheme.C.ink).bold()
                 + Text("  ·  ").foregroundStyle(WatchTheme.C.t3)
                 + Text(refStatus.0).foregroundStyle(refStatus.1))
                    .font(WatchTheme.body(13, .semibold))
            }

            Spacer(minLength: 4)

            HStack(alignment: .firstTextBaseline) {
                WStat(value: tracker.heartRate, unit: "bpm")
                Spacer()
                WStat(value: tracker.cadence, unit: "spm")
            }
            RepProgress(progress: engine.phaseProgress, remainingSec: engine.phaseRemainingSec,
                        fill: hasPace ? .zone(engine.paceZone) : WatchTheme.C.orange)
                .padding(.top, 3)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 4)
    }
}

// MARK: - WARMUP / RECOVERY / COOLDOWN (steady, no target) — dark stub
// Rebuilt to the canon next; for now a clean dark face so the flow runs.

private struct SteadyFace: View {
    @ObservedObject var engine: WorkoutEngine
    @ObservedObject var tracker: WorkoutTracker
    let phase: WatchPhase
    let accent: Color

    var body: some View {
        VStack(spacing: 0) {
            TopStrip(eyebrow: phase.label, eyebrowColor: accent, elapsedSec: engine.totalElapsedSec)
            SegmentBar(engine: engine).padding(.top, 5)
            Spacer(minLength: 4)
            Text(PaceFormat.clock(engine.phaseRemainingSec))
                .font(WatchTheme.display(86)).foregroundStyle(accent)
                .lineLimit(1).minimumScaleFactor(0.45).frame(maxWidth: .infinity)
            if let next = engine.nextPhase {
                Text("next · \(next.label)").font(WatchTheme.body(12, .medium)).foregroundStyle(WatchTheme.C.t3)
            }
            Spacer(minLength: 4)
            HStack(alignment: .firstTextBaseline) {
                WStat(value: tracker.heartRate, unit: "bpm")
                Spacer()
                WStat(value: tracker.cadence, unit: "spm")
            }
            RepProgress(progress: engine.phaseProgress, remainingSec: engine.phaseRemainingSec, fill: accent)
                .padding(.top, 3)
        }
        .padding(.horizontal, 6).padding(.vertical, 4)
    }
}

#Preview {
    ActiveWorkoutView(engine: {
        let e = WorkoutEngine(workout: .sample)
        e.start()
        return e
    }(), tracker: WorkoutTracker())
}
