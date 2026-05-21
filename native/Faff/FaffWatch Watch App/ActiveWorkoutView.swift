//
//  ActiveWorkoutView.swift
//  FaffWatch
//
//  The execution surface — the dark v4 face (watch-app.html). The primary
//  view never grows: it routes by the current phase type (WORK is the
//  canon hero). Detail lives one swipe / crown-turn away (watch-app.html
//  §D): Controls (pause / end / water-lock), Splits, and the Session map.
//  Transition flips ("Ease off", "Go · Int 4") overlay the whole thing
//  for a beat at the edges of a rep.
//
//  The faces themselves live in WatchFaces.swift — the verbatim copy of the
//  approved reference (WP / WF / Eyebrow / TopBar / Hero / RefLine / Stat /
//  StatsRow / ProgressRow / SegmentStrip + WorkIntervalFace / RaceFace).
//  This file only wires the live engine/tracker into those faces and builds
//  the remaining faces in the same component style.
//
//  Live pace/HR/cadence come from the tracker (mocked in the simulator,
//  HKLiveWorkoutBuilder + GPS on a physical watch).
//

import SwiftUI
import WatchKit

struct ActiveWorkoutView: View {
    @ObservedObject var engine: WorkoutEngine
    @ObservedObject var tracker: WorkoutTracker
    /// Default to the face; Controls sit one swipe left, detail to the right.
    @State private var page = Page.face

    private enum Page: Hashable { case controls, face, splits, map }

    var body: some View {
        ZStack {
            WP.bg.ignoresSafeArea()

            // Paused replaces the paged surface (rather than overlaying it)
            // so its Resume button isn't fighting the TabView's paging
            // gesture for the tap.
            if engine.isPaused {
                PausedVeil(engine: engine) { page = .face }
            } else {
                TabView(selection: $page) {
                    ControlsPage(engine: engine) { page = .face }.tag(Page.controls)
                    faceRouter.tag(Page.face)
                    SplitsPage(engine: engine).tag(Page.splits)
                    SessionMapPage(engine: engine).tag(Page.map)
                }
                .tabViewStyle(.page)
            }

            // Edge-of-rep flips are brief + non-interactive, so they can
            // safely sit above the pages.
            if let cue = engine.transition {
                TransitionFlip(cue: cue).transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.18), value: engine.transition)
        .animation(.easeInOut(duration: 0.18), value: engine.isPaused)
    }

    @ViewBuilder
    private var faceRouter: some View {
        if let phase = engine.currentPhase {
            if engine.isRace {
                LiveRace(engine: engine, tracker: tracker, phase: phase)
            } else {
                switch phase.type {
                case .work:
                    LiveWorkInterval(engine: engine, tracker: tracker, phase: phase)
                case .warmup, .cooldown:
                    LiveSteady(engine: engine, tracker: tracker, phase: phase,
                               accent: phase.type == .warmup ? WP.green : WP.muted)
                case .recovery:
                    LiveRecovery(engine: engine, tracker: tracker, phase: phase)
                }
            }
        }
    }
}

// MARK: - Live → reference-face adapters
//
// The reference faces (WatchFaces.swift) take plain Strings + [Seg] so the
// design stays the single source of truth. These thin wrappers compute those
// values from the live engine/tracker and hand them straight to the faces.

/// The whole-session strip: one cell per phase, weighted by duration.
private func sessionSegs(_ e: WorkoutEngine) -> [Seg] {
    e.workout.phases.map { p in
        Seg(weight: CGFloat(max(p.durationSec, 1)),
            state: p.index < e.currentIndex ? .done
                 : (p.index == e.currentIndex ? .current : .upcoming))
    }
}

private struct LiveWorkInterval: View {
    @ObservedObject var engine: WorkoutEngine
    @ObservedObject var tracker: WorkoutTracker
    let phase: WatchPhase

    private var workOrdinal: (Int, Int) {
        let work = engine.workout.phases.filter { $0.type == .work }
        let n = (work.firstIndex { $0.index == phase.index }).map { $0 + 1 } ?? 1
        return (n, work.count)
    }

    var body: some View {
        let (n, m) = workOrdinal
        let hasPace = tracker.paceSPerMi > 0
        WorkIntervalFace(
            rep: "Int \(n) / \(m)",
            elapsed: PaceFormat.clock(engine.totalElapsedSec),
            segments: sessionSegs(engine),
            currentPace: hasPace ? PaceFormat.mmss(tracker.paceSPerMi) : "—:—",
            targetPace: phase.targetPaceSPerMi.map { PaceFormat.mmss($0) } ?? "—:—",
            deltaSeconds: engine.paceDeltaSPerMi,
            heartRate: tracker.heartRate > 0 ? "\(tracker.heartRate)" : "—",
            cadence: tracker.cadence > 0 ? "\(tracker.cadence)" : "—",
            repFraction: engine.phaseProgress,
            repTimeLeft: PaceFormat.clock(engine.phaseRemainingSec))
    }
}

private struct LiveRace: View {
    @ObservedObject var engine: WorkoutEngine
    @ObservedObject var tracker: WorkoutTracker
    let phase: WatchPhase

    private var nextFuel: String {
        if let g = engine.nextGel { return "Gel \(g.number) · \(String(format: "%.1f", g.toGoMi))mi" }
        return "fuel done"
    }

    var body: some View {
        let hasPace = tracker.paceSPerMi > 0
        RaceFace(
            phase: phase.label,
            elapsed: PaceFormat.hms(engine.totalElapsedSec),
            segments: sessionSegs(engine),
            currentPace: hasPace ? PaceFormat.mmss(tracker.paceSPerMi) : "—:—",
            phaseTarget: phase.targetPaceSPerMi.map { PaceFormat.mmss($0) } ?? "—:—",
            deltaSeconds: engine.paceDeltaSPerMi,
            projectedFinish: engine.projectedFinishSec.map { PaceFormat.hm($0) } ?? "—",
            goalDeltaSec: engine.projectedDeltaSec,
            distanceToGo: engine.distanceToGoMi.map { String(format: "%.1f", $0) } ?? "—",
            nextFuel: nextFuel)
    }
}

// MARK: - RECOVERY (countdown hero + next rep pre-loaded · deck C3)

private struct LiveRecovery: View {
    @ObservedObject var engine: WorkoutEngine
    @ObservedObject var tracker: WorkoutTracker
    let phase: WatchPhase

    private var restOrdinal: (Int, Int) {
        let recs = engine.workout.phases.filter { $0.type == .recovery }
        let n = (recs.firstIndex { $0.index == phase.index }).map { $0 + 1 } ?? 1
        // Recoveries sit between work reps, so "Rest n / <work count>".
        let work = engine.workout.phases.filter { $0.type == .work }.count
        return (n, work)
    }
    private var nextRef: String {
        if let t = engine.nextPhase?.targetPaceSPerMi { return "Next rep · \(PaceFormat.mmss(t))/mi" }
        if let next = engine.nextPhase { return "Next · \(next.label)" }
        return ""
    }

    var body: some View {
        let (n, m) = restOrdinal
        RecoveryFace(
            rest: "Rest \(n) / \(m)",
            elapsed: PaceFormat.clock(engine.totalElapsedSec),
            countdown: PaceFormat.clock(engine.phaseRemainingSec),
            nextRef: nextRef,
            heartRate: tracker.heartRate > 0 ? "\(tracker.heartRate)" : "—",
            cadence: tracker.cadence > 0 ? "\(tracker.cadence)" : "—",
            fraction: engine.phaseProgress)
    }
}

// MARK: - WARMUP / COOLDOWN (steady, no target · deck B)

private struct LiveSteady: View {
    @ObservedObject var engine: WorkoutEngine
    @ObservedObject var tracker: WorkoutTracker
    let phase: WatchPhase
    let accent: Color

    var body: some View {
        SteadyFace(
            label: phase.label,
            accent: accent,
            elapsed: PaceFormat.clock(engine.totalElapsedSec),
            hero: PaceFormat.clock(engine.phaseElapsedSec),
            refLabel: phase.type == .cooldown ? "Cool" : "Easy",
            refPace: phase.targetPaceSPerMi.map { PaceFormat.mmss($0) },
            heartRate: tracker.heartRate > 0 ? "\(tracker.heartRate)" : "—",
            cadence: tracker.cadence > 0 ? "\(tracker.cadence)" : "—",
            fraction: engine.phaseProgress,
            timeLeft: PaceFormat.clock(engine.phaseRemainingSec))
    }
}

// MARK: - Faces built in the reference component style
//
// These match the deck (watch-app.html) using the same WP/WF/Hero/Stat/…
// primitives as WorkIntervalFace/RaceFace, so the whole set is one language.

/// Recovery (deck §C3): green eyebrow + elapsed, the rest countdown as hero,
/// next rep pre-loaded, HR + cadence, a "jog easy" cue bar.
struct RecoveryFace: View {
    let rest: String
    let elapsed: String
    let countdown: String
    let nextRef: String
    let heartRate: String
    let cadence: String
    let fraction: Double

    var body: some View {
        VStack(spacing: 0) {
            FaceHeader(label: rest, color: WP.green)
            VStack(spacing: -8) {
                Hero(value: countdown, color: WP.green)
                if !nextRef.isEmpty {
                    Text(nextRef).font(WF.interBold(12)).tracking(0.4).textCase(.uppercase)
                        .foregroundStyle(WP.muted).lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)   // CSS .w-mid flex:1
            StatsRow(left: Stat(value: heartRate, unit: "bpm"),
                     right: Stat(value: cadence, unit: "spm"))
            ProgressRow(fraction: fraction, fill: WP.green) {
                Text("JOG EASY").font(WF.interBold(10)).tracking(0.6).foregroundStyle(WP.muted)
            }
            .padding(.top, 8)
        }
        .executionFace()
    }
}

/// Warmup / cooldown (deck §B): accent eyebrow + elapsed, the phase clock as
/// hero (counts up toward the duration), an easy-pace reference, HR + cadence,
/// progress bar carrying the time remaining.
struct SteadyFace: View {
    let label: String
    var accent: Color = WP.green
    let elapsed: String
    let hero: String
    let refLabel: String
    let refPace: String?
    let heartRate: String
    let cadence: String
    let fraction: Double
    let timeLeft: String

    var body: some View {
        VStack(spacing: 0) {
            FaceHeader(label: label, color: accent)
            VStack(spacing: -10) {
                Hero(value: hero, color: WP.ink)
                if let refPace {
                    (Text(refLabel.uppercased() + " · ").foregroundStyle(WP.muted)
                     + Text(refPace + "/MI").foregroundStyle(WP.ink))
                        .font(WF.interBold(15))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)   // CSS .w-mid flex:1
            StatsRow(left: Stat(value: heartRate, unit: "bpm"),
                     right: Stat(value: cadence, unit: "spm"))
            ProgressRow(fraction: fraction, fill: accent) {
                Text(timeLeft).font(WF.bebas(18)).monospacedDigit().foregroundStyle(WP.ink)
            }
            .padding(.top, 8)
        }
        .executionFace()
    }
}

// MARK: - CONTROLS (swipe-in · pause / end / water-lock · deck §D)

private struct ControlsPage: View {
    @ObservedObject var engine: WorkoutEngine
    /// Called after a control runs, to swipe back to the face.
    let backToFace: () -> Void
    @State private var confirmEnd = false

    var body: some View {
        ControlsFace(paused: engine.isPaused,
                     onPrimary: { if engine.isPaused { engine.resume(); backToFace() } else { engine.pause() } },
                     onEnd: { confirmEnd = true },
                     onLock: { WKInterfaceDevice.current().enableWaterLock(); backToFace() })
        .confirmationDialog("End workout?", isPresented: $confirmEnd, titleVisibility: .visible) {
            Button("End workout", role: .destructive) { engine.abandon() }
            Button("End this interval") { engine.endCurrentPhase(); backToFace() }
            Button("Keep going", role: .cancel) {}
        }
    }
}

/// The three-button control row (deck §D): Pause/Resume (primary, filled),
/// End, Lock.
struct ControlsFace: View {
    var paused: Bool = false
    var onPrimary: () -> Void = {}
    var onEnd: () -> Void = {}
    var onLock: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Controls").font(WF.oswald(13)).tracking(1).foregroundStyle(WP.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
            HStack(alignment: .top, spacing: 8) {
                control(paused ? "play.fill" : "pause.fill", paused ? "Resume" : "Pause",
                        size: 64, filled: true, tint: paused ? WP.green : WP.amber, action: onPrimary)
                control("stop.fill", "End", size: 50, filled: false, tint: WP.warn, action: onEnd)
                control("lock.fill", "Lock", size: 50, filled: false, tint: WP.muted, action: onLock)
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 13)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(WP.bg)
    }

    private func control(_ icon: String, _ label: String, size: CGFloat, filled: Bool,
                         tint: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 5) {
                Image(systemName: icon)
                    .font(.system(size: size * 0.34, weight: .bold))
                    .frame(width: size, height: size)
                    .foregroundStyle(filled ? Color(red: 0.10, green: 0.07, blue: 0.0) : tint)
                    .background(filled ? tint : .clear, in: Circle())
                    .overlay(Circle().stroke(filled ? .clear : tint.opacity(0.6), lineWidth: 1.5))
                Text(label).font(WF.interSemi(10)).foregroundStyle(WP.muted)
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - SPLITS (every rep's pace as you bank it · deck §D)

private struct SplitsPage: View {
    @ObservedObject var engine: WorkoutEngine
    var body: some View {
        SplitsFace(rows: engine.splits.map {
            SplitsFace.Row(repNo: $0.repNo, label: shortLabel($0.label),
                           pace: $0.paceSPerMi.map { p in PaceFormat.mmss(p) } ?? "—",
                           color: paceColor($0))
        })
    }
    private func shortLabel(_ s: String) -> String {
        // Deck shows the rep distance ("800"), not "Interval 3/6".
        s.split(separator: " ").first.map(String.init) ?? s
    }
    private func paceColor(_ s: WorkoutEngine.Split) -> Color {
        guard s.paceSPerMi != nil else { return WP.faint }
        if s.state == .current { return WP.orange }
        return .zone(engine.zone(forPace: s.paceSPerMi, target: s.targetSPerMi))
    }
}

struct SplitsFace: View {
    struct Row: Identifiable { let id = UUID(); let repNo: Int; let label: String; let pace: String; let color: Color }
    let rows: [Row]
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Splits · so far").font(WF.oswald(13)).tracking(0.8).foregroundStyle(WP.muted)
                .padding(.bottom, 8)
            ForEach(rows) { r in
                HStack(spacing: 8) {
                    Text("\(r.repNo)").font(WF.interBold(11)).foregroundStyle(WP.faint)
                        .frame(width: 14, alignment: .leading)
                    Text(r.label).font(WF.interSemi(13)).foregroundStyle(WP.ink)
                    Spacer()
                    Text(r.pace).font(WF.bebas(22)).monospacedDigit().foregroundStyle(r.color)
                }
                .padding(.vertical, 5)
                Rectangle().fill(WP.line).frame(height: 1)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14).padding(.vertical, 13)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(WP.bg)
    }
}

// MARK: - SESSION MAP (where this rep sits in the whole workout · deck §D)

private struct SessionMapPage: View {
    @ObservedObject var engine: WorkoutEngine
    var body: some View {
        SessionMapFace(rows: engine.workout.phases.map { p in
            SessionMapFace.Row(label: p.label, value: value(for: p), state: state(p.index))
        })
    }
    private func state(_ idx: Int) -> SegState {
        idx < engine.currentIndex ? .done : (idx == engine.currentIndex ? .current : .upcoming)
    }
    private func value(for p: WatchPhase) -> String {
        if p.index < engine.currentIndex { return "✓" }
        if p.index == engine.currentIndex { return PaceFormat.clock(engine.phaseRemainingSec) }
        return PaceFormat.clock(p.durationSec)
    }
}

struct SessionMapFace: View {
    struct Row: Identifiable { let id = UUID(); let label: String; let value: String; let state: SegState }
    let rows: [Row]
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Session").font(WF.oswald(13)).tracking(0.8).foregroundStyle(WP.muted)
                .padding(.bottom, 8)
            ForEach(rows) { r in
                HStack(spacing: 9) {
                    Circle().fill(dot(r.state)).frame(width: 7, height: 7)
                    Text(r.label).font(WF.interSemi(13))
                        .foregroundStyle(r.state == .upcoming ? WP.muted : WP.ink).lineLimit(1)
                    Spacer()
                    Text(r.value).font(WF.interSemi(13)).monospacedDigit().foregroundStyle(WP.muted)
                }
                .padding(.vertical, 5)
                .opacity(r.state == .upcoming ? 0.7 : 1)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14).padding(.vertical, 13)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(WP.bg)
    }
    private func dot(_ s: SegState) -> Color {
        switch s { case .done: return WP.green; case .current: return WP.orange; case .upcoming: return WP.line }
    }
}

// MARK: - Transition flips (full-screen, brief · deck §C3 / §F2)

/// The shared centered transition layout (icon + title + sub).
struct TransitionFace: View {
    let icon: String
    let title: String
    var titleColor: Color = WP.amber
    let sub: String?
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: icon).font(.system(size: 34, weight: .bold)).foregroundStyle(titleColor)
            Text(title).font(WF.bebas(44)).foregroundStyle(titleColor)
                .lineLimit(1).minimumScaleFactor(0.5)
            if let sub {
                Text(sub).font(WF.interSemi(12)).tracking(0.3)
                    .foregroundStyle(WP.muted).multilineTextAlignment(.center)
            }
        }
        .padding(.horizontal, 14)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WP.bg)
    }
}

private struct TransitionFlip: View {
    let cue: WorkoutEngine.TransitionCue
    var body: some View {
        switch cue {
        case .headsUp(let t, let s): TransitionFace(icon: "clock", title: t, titleColor: WP.amber, sub: s)
        case .go(let t, let s):      TransitionFace(icon: "arrow.right", title: t, titleColor: WP.green, sub: s)
        case .phase(let t, let s):   TransitionFace(icon: "mountain.2.fill", title: t, titleColor: WP.orange, sub: s)
        case .fuel(let t, let s):    TransitionFace(icon: "bolt.fill", title: t, titleColor: WP.orange, sub: s)
        }
    }
}

private struct PausedVeil: View {
    @ObservedObject var engine: WorkoutEngine
    let onResume: () -> Void
    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "pause.circle.fill").font(.system(size: 34)).foregroundStyle(WP.amber)
            Text("PAUSED").font(WF.bebas(30)).foregroundStyle(WP.ink).tracking(1)
            Text(PaceFormat.clock(engine.totalElapsedSec))
                .font(WF.interSemi(13)).monospacedDigit().foregroundStyle(WP.muted)
            Button {
                engine.resume(); onResume()
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "play.fill").font(.system(size: 13, weight: .bold))
                    Text("RESUME").font(WF.oswald(14)).tracking(1.5)
                }
                .frame(maxWidth: .infinity).padding(.vertical, 11)
                .foregroundStyle(Color(red: 0.016, green: 0.075, blue: 0.051))
                .background(WP.green, in: Capsule())
            }
            .buttonStyle(.plain).padding(.top, 4).padding(.horizontal, 6)
        }
        .padding(.horizontal, 14)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WP.bg.opacity(0.96).ignoresSafeArea())
    }
}

#Preview {
    ActiveWorkoutView(engine: {
        let e = WorkoutEngine(workout: .sample)
        e.start()
        return e
    }(), tracker: WorkoutTracker())
}
