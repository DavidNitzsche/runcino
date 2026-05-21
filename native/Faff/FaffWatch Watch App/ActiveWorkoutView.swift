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
            WatchTheme.C.bg.ignoresSafeArea()

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
                RaceFace(engine: engine, tracker: tracker, phase: phase)
            } else {
                switch phase.type {
                case .work:
                    WorkIntervalFace(engine: engine, tracker: tracker, phase: phase)
                case .warmup, .cooldown:
                    SteadyFace(engine: engine, tracker: tracker, phase: phase, accent: WatchTheme.C.t2)
                case .recovery:
                    RecoveryFace(engine: engine, tracker: tracker, phase: phase)
                }
            }
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

/// Progress bar + a short word cue (no clock) — used where the hero is
/// already the countdown, so the time isn't repeated.
private struct CueProgress: View {
    let progress: Double
    let cue: String
    var fill: Color = WatchTheme.C.green
    var body: some View {
        HStack(spacing: 7) {
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(WatchTheme.C.track)
                    Capsule().fill(fill).frame(width: max(geo.size.width * progress, 3))
                }
            }
            .frame(height: 5)
            Text(cue).font(WatchTheme.body(11, .medium)).foregroundStyle(WatchTheme.C.t2)
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

// MARK: - RACE (the interval face, retargeted · watch-app.html §F)

/// One race stat: big Bebas value (+ optional small unit) over a small
/// rank label — "3:49 / proj finish", "15.8 mi / to go".
private struct RaceStat: View {
    let value: String
    var unit: String? = nil
    let label: String
    var align: HorizontalAlignment = .leading
    var body: some View {
        VStack(alignment: align, spacing: 0) {
            (Text(value).font(WatchTheme.display(30)).foregroundStyle(WatchTheme.C.ink)
             + (unit.map { Text($0).font(WatchTheme.body(11, .semibold)).foregroundStyle(WatchTheme.C.t2) } ?? Text("")))
                .lineLimit(1).minimumScaleFactor(0.6)
            Text(label.uppercased()).font(WatchTheme.body(8, .semibold)).tracking(0.5).foregroundStyle(WatchTheme.C.t3)
        }
    }
}

private struct RaceFace: View {
    @ObservedObject var engine: WorkoutEngine
    @ObservedObject var tracker: WorkoutTracker
    let phase: WatchPhase

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
    private var raceProgress: Double {
        guard let total = engine.workout.distanceMi, total > 0 else { return engine.phaseProgress }
        return min(1, tracker.distanceMi / total)
    }
    private var gelCue: String {
        if let g = engine.nextGel { return "Gel \(g.number) · \(String(format: "%.1f", g.toGoMi))mi" }
        return "fuel done"
    }

    var body: some View {
        VStack(spacing: 0) {
            // Phase eyebrow (orange) + total elapsed at race scale.
            HStack(alignment: .firstTextBaseline) {
                Text(phase.label.uppercased())
                    .font(WatchTheme.sub(13, .semibold)).tracking(0.8)
                    .foregroundStyle(WatchTheme.C.orange).lineLimit(1)
                Spacer()
                Text(PaceFormat.hms(engine.totalElapsedSec))
                    .font(WatchTheme.body(13, .semibold)).monospacedDigit().foregroundStyle(WatchTheme.C.t2)
            }
            SegmentBar(engine: engine).padding(.top, 5)
            Spacer(minLength: 4)
            // Hero — current pace vs this phase's terrain-aware target.
            Text(hasPace ? PaceFormat.mmss(tracker.paceSPerMi) : "—:—")
                .font(WatchTheme.display(80)).foregroundStyle(heroColor)
                .lineLimit(1).minimumScaleFactor(0.45).frame(maxWidth: .infinity)
            if let target = phase.targetPaceSPerMi {
                (Text(PaceFormat.mmss(target)).foregroundStyle(WatchTheme.C.ink).bold()
                 + Text("  ·  ").foregroundStyle(WatchTheme.C.t3)
                 + Text(refStatus.0).foregroundStyle(refStatus.1))
                    .font(WatchTheme.body(13, .semibold))
            }
            Spacer(minLength: 4)
            // On-goal read: projected finish + distance to go.
            HStack(alignment: .firstTextBaseline) {
                RaceStat(value: engine.projectedFinishSec.map { PaceFormat.hm($0) } ?? "—", label: "proj finish")
                Spacer()
                RaceStat(value: engine.distanceToGoMi.map { String(format: "%.1f", $0) } ?? "—",
                         unit: "mi", label: "to go", align: .trailing)
            }
            HStack(spacing: 7) {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(WatchTheme.C.track)
                        Capsule().fill(WatchTheme.C.orange).frame(width: max(geo.size.width * raceProgress, 3))
                    }
                }.frame(height: 5)
                Text(gelCue).font(WatchTheme.body(11, .semibold)).foregroundStyle(WatchTheme.C.t2).lineLimit(1)
            }.padding(.top, 3)
        }
        .padding(.horizontal, 6).padding(.vertical, 4)
    }
}

// MARK: - RECOVERY (countdown hero + next rep pre-loaded)

private struct RecoveryFace: View {
    @ObservedObject var engine: WorkoutEngine
    @ObservedObject var tracker: WorkoutTracker
    let phase: WatchPhase

    private var restOrdinal: (Int, Int) {
        let recs = engine.workout.phases.filter { $0.type == .recovery }
        let n = (recs.firstIndex { $0.index == phase.index }).map { $0 + 1 } ?? 1
        return (n, recs.count)
    }

    var body: some View {
        let (n, m) = restOrdinal
        VStack(spacing: 0) {
            TopStrip(eyebrow: "Rest \(n) / \(m)", eyebrowColor: WatchTheme.C.green, elapsedSec: engine.totalElapsedSec)
            SegmentBar(engine: engine).padding(.top, 5)
            Spacer(minLength: 4)
            Text(PaceFormat.clock(engine.phaseRemainingSec))
                .font(WatchTheme.display(86)).foregroundStyle(WatchTheme.C.green)
                .lineLimit(1).minimumScaleFactor(0.45).frame(maxWidth: .infinity)
            if let target = engine.nextPhase?.targetPaceSPerMi {
                (Text("Next rep · ").foregroundColor(WatchTheme.C.t2)
                 + Text("\(PaceFormat.mmss(target))/mi").foregroundColor(WatchTheme.C.ink).bold())
                    .font(WatchTheme.body(13, .semibold))
            } else if let next = engine.nextPhase {
                Text("next · \(next.label)").font(WatchTheme.body(12, .medium)).foregroundStyle(WatchTheme.C.t3)
            }
            Spacer(minLength: 4)
            HStack(alignment: .firstTextBaseline) {
                WStat(value: tracker.heartRate, unit: "bpm")
                Spacer()
                WStat(value: tracker.cadence, unit: "spm")
            }
            CueProgress(progress: engine.phaseProgress, cue: "jog easy", fill: WatchTheme.C.green)
                .padding(.top, 3)
        }
        .padding(.horizontal, 6).padding(.vertical, 4)
    }
}

// MARK: - WARMUP / COOLDOWN (steady, no target)

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
            // Canon §B: the hero counts UP toward the phase duration; the
            // progress bar carries the time REMAINING. Two different numbers,
            // so no duplication.
            Text(PaceFormat.clock(engine.phaseElapsedSec))
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

// MARK: - CONTROLS (swipe-in · pause / end / water-lock)

private struct ControlsPage: View {
    @ObservedObject var engine: WorkoutEngine
    /// Called after a control runs, to swipe back to the face.
    let backToFace: () -> Void
    @State private var confirmEnd = false

    var body: some View {
        VStack(spacing: 10) {
            Text("Controls").font(WatchTheme.sub(13, .semibold)).tracking(1)
                .foregroundStyle(WatchTheme.C.t2)
                .frame(maxWidth: .infinity, alignment: .leading)

            // Pause / Resume — the primary, stoplight-sized target.
            Button {
                if engine.isPaused { engine.resume(); backToFace() } else { engine.pause() }
            } label: {
                HStack(spacing: 7) {
                    Image(systemName: engine.isPaused ? "play.fill" : "pause.fill")
                        .font(.system(size: 15, weight: .bold))
                    Text(engine.isPaused ? "RESUME" : "PAUSE")
                        .font(WatchTheme.sub(15, .semibold)).tracking(1.5)
                }
                .frame(maxWidth: .infinity).padding(.vertical, 13)
                .foregroundStyle(Color(red: 0.10, green: 0.07, blue: 0.0))
                .background(engine.isPaused ? WatchTheme.C.green : WatchTheme.C.amber, in: Capsule())
            }
            .buttonStyle(.plain)

            HStack(spacing: 10) {
                roundControl("stop.fill", "End", tint: WatchTheme.C.warn) { confirmEnd = true }
                roundControl("lock.fill", "Lock", tint: WatchTheme.C.t2) {
                    WKInterfaceDevice.current().enableWaterLock()
                    backToFace()
                }
            }
        }
        .padding(.horizontal, 8).padding(.vertical, 6)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .confirmationDialog("End workout?", isPresented: $confirmEnd, titleVisibility: .visible) {
            Button("End workout", role: .destructive) { engine.abandon() }
            Button("End this interval") { engine.endCurrentPhase(); backToFace() }
            Button("Keep going", role: .cancel) {}
        }
    }

    private func roundControl(_ icon: String, _ label: String, tint: Color, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: icon).font(.system(size: 16, weight: .bold))
                    .frame(width: 46, height: 46)
                    .foregroundStyle(tint)
                    .overlay(Circle().stroke(tint.opacity(0.6), lineWidth: 1.5))
                Text(label).font(WatchTheme.body(10, .semibold)).foregroundStyle(WatchTheme.C.t2)
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - SPLITS (every rep's pace as you bank it)

private struct SplitsPage: View {
    @ObservedObject var engine: WorkoutEngine
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 6) {
                Text("Splits · so far").font(WatchTheme.sub(13, .semibold)).tracking(0.8)
                    .foregroundStyle(WatchTheme.C.t2).padding(.bottom, 2)
                ForEach(engine.splits) { s in
                    HStack(spacing: 8) {
                        Text("\(s.repNo)")
                            .font(WatchTheme.body(11, .bold)).foregroundStyle(WatchTheme.C.t3)
                            .frame(width: 16, alignment: .leading)
                        Text(s.label).font(WatchTheme.body(12, .medium))
                            .foregroundStyle(s.state == .upcoming ? WatchTheme.C.t3 : WatchTheme.C.ink)
                            .lineLimit(1)
                        Spacer()
                        Text(s.paceSPerMi.map { PaceFormat.mmss($0) } ?? "—")
                            .font(WatchTheme.display(20)).monospacedDigit()
                            .foregroundStyle(paceColor(s))
                    }
                    .padding(.vertical, 3)
                    .opacity(s.state == .upcoming ? 0.55 : 1)
                }
            }
            .padding(.horizontal, 8).padding(.vertical, 4)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
    private func paceColor(_ s: WorkoutEngine.Split) -> Color {
        guard s.paceSPerMi != nil else { return WatchTheme.C.t3 }
        if s.state == .current { return WatchTheme.C.orange }
        return .zone(engine.zone(forPace: s.paceSPerMi, target: s.targetSPerMi))
    }
}

// MARK: - SESSION MAP (where this rep sits in the whole workout)

private struct SessionMapPage: View {
    @ObservedObject var engine: WorkoutEngine
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 5) {
                Text("Session").font(WatchTheme.sub(13, .semibold)).tracking(0.8)
                    .foregroundStyle(WatchTheme.C.t2).padding(.bottom, 2)
                ForEach(engine.workout.phases) { p in
                    HStack(spacing: 8) {
                        Circle().fill(dotColor(p.index)).frame(width: 7, height: 7)
                        Text(p.label).font(WatchTheme.body(12, .medium))
                            .foregroundStyle(p.index >= engine.currentIndex && p.index != engine.currentIndex
                                             ? WatchTheme.C.t3 : WatchTheme.C.ink)
                            .lineLimit(1)
                        Spacer()
                        Text(value(for: p)).font(WatchTheme.body(12, .semibold)).monospacedDigit()
                            .foregroundStyle(WatchTheme.C.t2)
                    }
                    .padding(.vertical, 3)
                    .opacity(p.index > engine.currentIndex ? 0.6 : 1)
                }
            }
            .padding(.horizontal, 8).padding(.vertical, 4)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
    private func dotColor(_ idx: Int) -> Color {
        if idx < engine.currentIndex { return WatchTheme.C.green }
        if idx == engine.currentIndex { return WatchTheme.C.orange }
        return WatchTheme.C.track
    }
    private func value(for p: WatchPhase) -> String {
        if p.index < engine.currentIndex { return "✓" }
        if p.index == engine.currentIndex { return PaceFormat.clock(engine.phaseRemainingSec) }
        return PaceFormat.clock(p.durationSec)
    }
}

// MARK: - Transition flip + pause veil (full-screen, brief)

private struct TransitionFlip: View {
    let cue: WorkoutEngine.TransitionCue
    var body: some View {
        let (icon, title, sub, tint): (String, String, String?, Color) = {
            switch cue {
            case .headsUp(let t, let s): return ("clock", t, s, WatchTheme.C.amber)
            case .go(let t, let s):      return ("arrow.right", t, s, WatchTheme.C.green)
            case .phase(let t, let s):   return ("mountain.2.fill", t, s, WatchTheme.C.orange)
            case .fuel(let t, let s):    return ("bolt.fill", t, s, WatchTheme.C.orange)
            }
        }()
        return VStack(spacing: 8) {
            Image(systemName: icon).font(.system(size: 30, weight: .bold)).foregroundStyle(tint)
            Text(title).font(WatchTheme.display(30)).foregroundStyle(tint)
                .lineLimit(1).minimumScaleFactor(0.5)
            if let sub {
                Text(sub).font(WatchTheme.body(12, .semibold)).foregroundStyle(WatchTheme.C.t2)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WatchTheme.C.bg.ignoresSafeArea())
    }
}

private struct PausedVeil: View {
    @ObservedObject var engine: WorkoutEngine
    let onResume: () -> Void
    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "pause.circle.fill").font(.system(size: 34)).foregroundStyle(WatchTheme.C.amber)
            Text("PAUSED").font(WatchTheme.display(30)).foregroundStyle(WatchTheme.C.ink).tracking(1)
            Text(PaceFormat.clock(engine.totalElapsedSec))
                .font(WatchTheme.body(13, .semibold)).monospacedDigit().foregroundStyle(WatchTheme.C.t2)
            Button {
                engine.resume()
                onResume()
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "play.fill").font(.system(size: 13, weight: .bold))
                    Text("RESUME").font(WatchTheme.sub(14, .semibold)).tracking(1.5)
                }
                .frame(maxWidth: .infinity).padding(.vertical, 11)
                .foregroundStyle(Color(red: 0.016, green: 0.075, blue: 0.051))
                .background(WatchTheme.C.green, in: Capsule())
            }
            .buttonStyle(.plain).padding(.top, 4).padding(.horizontal, 6)
        }
        .padding(.horizontal, 10)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WatchTheme.C.bg.opacity(0.96).ignoresSafeArea())
    }
}

#Preview {
    ActiveWorkoutView(engine: {
        let e = WorkoutEngine(workout: .sample)
        e.start()
        return e
    }(), tracker: WorkoutTracker())
}
