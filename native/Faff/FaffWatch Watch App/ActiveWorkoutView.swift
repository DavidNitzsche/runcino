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
                    SteadyFace(engine: engine, tracker: tracker, phase: phase,
                               accent: phase.type == .warmup ? WatchTheme.C.green : WatchTheme.C.t2)
                case .recovery:
                    RecoveryFace(engine: engine, tracker: tracker, phase: phase)
                }
            }
        }
    }
}

// MARK: - Hero number (fills the width · watch-app.html)

/// The one giant centered number per face. Sized off the available WIDTH
/// (not height) so 4- and 5-char values both fill the screen — the bug
/// before was a height-constrained Text that shrank to a fraction. The
/// width multiplier fills ~90% for a 4-char time; longer strings auto-
/// scale down via minimumScaleFactor. No negative tracking (canon).
private struct HeroNumber: View {
    let text: String
    var color: Color = WatchTheme.C.ink
    /// Vertical room the hero zone claims (the centered middle band).
    var zoneHeight: CGFloat = 104
    var body: some View {
        GeometryReader { g in
            Text(text)
                .font(WatchTheme.display(g.size.width * 0.62))
                .foregroundStyle(color)
                .lineLimit(1).minimumScaleFactor(0.4)
                .frame(width: g.size.width, height: g.size.height, alignment: .center)
        }
        .frame(height: zoneHeight)
    }
}

// MARK: - Shared face chrome

/// Top strip: orientation eyebrow (left) + elapsed workout time (right).
/// Deck: .w-eye 12.5/700/1.1 uppercase; .w-elapsed 11/700 wt2 tabular.
private struct TopStrip: View {
    let eyebrow: String
    let eyebrowColor: Color
    let elapsedSec: Int
    /// Race uses h:mm:ss; workout uses m:ss.
    var hms: Bool = false
    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(eyebrow.uppercased())
                .font(WatchTheme.body(12.5, .bold)).tracking(1.1)
                .foregroundStyle(eyebrowColor)
                .lineLimit(1)
            Spacer(minLength: 6)
            Text(hms ? PaceFormat.hms(elapsedSec) : PaceFormat.clock(elapsedSec))
                .font(WatchTheme.body(11, .bold)).monospacedDigit()
                .foregroundStyle(WatchTheme.C.t3)
        }
    }
}

/// A hairline strip of the whole session — one cell per phase, sized by
/// duration. Done = green, current = orange, upcoming = track (white .16).
/// Deck: .w-seg height 4, gap 2, radius 2.
private struct SegmentBar: View {
    @ObservedObject var engine: WorkoutEngine
    var body: some View {
        let phases = engine.workout.phases
        let total = max(phases.reduce(0) { $0 + $1.durationSec }, 1)
        GeometryReader { geo in
            HStack(spacing: 2) {
                ForEach(phases) { p in
                    let w = geo.size.width * CGFloat(p.durationSec) / CGFloat(total)
                    RoundedRectangle(cornerRadius: 2, style: .continuous).fill(color(for: p.index))
                        .frame(width: max(w - 2, 2))
                }
            }
        }
        .frame(height: 4)
    }
    private func color(for idx: Int) -> Color {
        if idx < engine.currentIndex { return WatchTheme.C.green }
        if idx == engine.currentIndex { return WatchTheme.C.orange }
        return Color.white.opacity(0.16)
    }
}

/// Bottom stats row with the deck's hairline top border + center divider.
/// Deck: .w-stats border-top wline, pad-top 9; .w-stat .v Bebas 34, small 11.
private struct StatsRow: View {
    let hr: Int
    let cadence: Int
    var body: some View {
        VStack(spacing: 0) {
            Rectangle().fill(WatchTheme.C.track).frame(height: 1)
            HStack(spacing: 0) {
                WStat(value: hr, unit: "bpm").frame(maxWidth: .infinity, alignment: .leading)
                Rectangle().fill(WatchTheme.C.track).frame(width: 1, height: 26)
                WStat(value: cadence, unit: "spm").frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.leading, 12)
            }
            .padding(.top, 8)
        }
    }
}

/// One bottom stat: big Bebas value + small unit-as-label (bpm/spm).
private struct WStat: View {
    let value: Int
    let unit: String
    var body: some View {
        (Text(value > 0 ? "\(value)" : "—").font(WatchTheme.display(34)).foregroundStyle(WatchTheme.C.ink)
         + Text(unit).font(WatchTheme.body(11, .semibold)).foregroundStyle(WatchTheme.C.t3))
            .lineLimit(1).minimumScaleFactor(0.6)
    }
}

/// Rep progress bar + time left in the phase.
/// Deck: .w-bar height 6 radius 4 track white.14; .w-ptime Bebas 18 white.
private struct RepProgress: View {
    let progress: Double
    let remainingSec: Int
    var fill: Color = WatchTheme.C.orange
    var body: some View {
        HStack(spacing: 10) {
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(WatchTheme.C.track)
                    Capsule().fill(fill).frame(width: max(geo.size.width * progress, 3))
                }
            }
            .frame(height: 6)
            Text(PaceFormat.clock(remainingSec))
                .font(WatchTheme.display(18)).monospacedDigit()
                .foregroundStyle(WatchTheme.C.ink)
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
        HStack(spacing: 10) {
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(WatchTheme.C.track)
                    Capsule().fill(fill).frame(width: max(geo.size.width * progress, 3))
                }
            }
            .frame(height: 6)
            Text(cue.uppercased()).font(WatchTheme.body(10, .bold)).tracking(0.6)
                .foregroundStyle(WatchTheme.C.t3)
        }
    }
}

/// The target + live-delta reference line (deck .w-ref 11/700/.4 uppercase;
/// target = white, status coloured by zone).
private struct RefLine: View {
    let target: Int
    let status: String
    let statusColor: Color
    var body: some View {
        (Text(PaceFormat.mmss(target)).foregroundStyle(WatchTheme.C.ink)
         + Text("  ·  ").foregroundStyle(WatchTheme.C.t3)
         + Text(status.uppercased()).foregroundStyle(statusColor))
            .font(WatchTheme.body(11, .bold))
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
            SegmentBar(engine: engine).padding(.top, 6)

            Spacer(minLength: 2)

            // Hero — current pace, the biggest thing on the watch, color-coded.
            HeroNumber(text: hasPace ? PaceFormat.mmss(tracker.paceSPerMi) : "—:—", color: heroColor)
            if let target = phase.targetPaceSPerMi {
                RefLine(target: target, status: refStatus.0, statusColor: refStatus.1).padding(.top, 4)
            }

            Spacer(minLength: 2)

            StatsRow(hr: tracker.heartRate, cadence: tracker.cadence)
            RepProgress(progress: engine.phaseProgress, remainingSec: engine.phaseRemainingSec,
                        fill: hasPace ? .zone(engine.paceZone) : WatchTheme.C.orange)
                .padding(.top, 10)
        }
        .padding(.horizontal, 7)
        .padding(.vertical, 5)
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
        VStack(alignment: align, spacing: 2) {
            (Text(value).font(WatchTheme.display(34)).foregroundStyle(WatchTheme.C.ink)
             + (unit.map { Text($0).font(WatchTheme.body(11, .semibold)).foregroundStyle(WatchTheme.C.t3) } ?? Text("")))
                .lineLimit(1).minimumScaleFactor(0.6)
            Text(label.uppercased()).font(WatchTheme.body(8.5, .bold)).tracking(0.7).foregroundStyle(WatchTheme.C.t3)
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
            TopStrip(eyebrow: phase.label, eyebrowColor: WatchTheme.C.orange,
                     elapsedSec: engine.totalElapsedSec, hms: true)
            SegmentBar(engine: engine).padding(.top, 6)
            Spacer(minLength: 2)
            // Hero — current pace vs this phase's terrain-aware target.
            HeroNumber(text: hasPace ? PaceFormat.mmss(tracker.paceSPerMi) : "—:—", color: heroColor)
            if let target = phase.targetPaceSPerMi {
                RefLine(target: target, status: refStatus.0, statusColor: refStatus.1).padding(.top, 4)
            }
            Spacer(minLength: 2)
            // On-goal read: projected finish + distance to go, with the
            // deck's hairline top border + center divider.
            VStack(spacing: 0) {
                Rectangle().fill(WatchTheme.C.track).frame(height: 1)
                HStack(spacing: 0) {
                    RaceStat(value: engine.projectedFinishSec.map { PaceFormat.hm($0) } ?? "—", label: "proj finish")
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Rectangle().fill(WatchTheme.C.track).frame(width: 1, height: 30)
                    RaceStat(value: engine.distanceToGoMi.map { String(format: "%.1f", $0) } ?? "—",
                             unit: "mi", label: "to go", align: .trailing)
                        .frame(maxWidth: .infinity, alignment: .trailing).padding(.leading, 12)
                }
                .padding(.top, 8)
            }
            HStack(spacing: 10) {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(WatchTheme.C.track)
                        Capsule().fill(WatchTheme.C.orange).frame(width: max(geo.size.width * raceProgress, 3))
                    }
                }.frame(height: 6)
                Text(gelCue.uppercased()).font(WatchTheme.body(10, .bold)).tracking(0.6)
                    .foregroundStyle(WatchTheme.C.t3).lineLimit(1)
            }.padding(.top, 10)
        }
        .padding(.horizontal, 7).padding(.vertical, 5)
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
            SegmentBar(engine: engine).padding(.top, 6)
            Spacer(minLength: 2)
            HeroNumber(text: PaceFormat.clock(engine.phaseRemainingSec), color: WatchTheme.C.green)
            // Next rep pre-loaded (deck .w-nx 11/700/.4 uppercase, b=white).
            if let target = engine.nextPhase?.targetPaceSPerMi {
                (Text("NEXT REP · ").foregroundStyle(WatchTheme.C.t3)
                 + Text("\(PaceFormat.mmss(target))/MI").foregroundStyle(WatchTheme.C.ink))
                    .font(WatchTheme.body(11, .bold)).tracking(0.4)
            } else if let next = engine.nextPhase {
                Text("NEXT · \(next.label.uppercased())").font(WatchTheme.body(11, .bold)).tracking(0.4)
                    .foregroundStyle(WatchTheme.C.t3)
            }
            Spacer(minLength: 2)
            StatsRow(hr: tracker.heartRate, cadence: tracker.cadence)
            CueProgress(progress: engine.phaseProgress, cue: "jog easy", fill: WatchTheme.C.green)
                .padding(.top, 10)
        }
        .padding(.horizontal, 7).padding(.vertical, 5)
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
            // Canon §B: green eyebrow, NO app clock on the right (the OS
            // clock already shows the time of day there — putting total
            // elapsed here would just duplicate the hero during the warmup,
            // since the first phase's elapsed == the total).
            HStack {
                Text(phase.label.uppercased())
                    .font(WatchTheme.body(12.5, .bold)).tracking(1.1)
                    .foregroundStyle(accent).lineLimit(1)
                Spacer()
            }
            SegmentBar(engine: engine).padding(.top, 6)
            Spacer(minLength: 2)
            // Hero counts UP toward the phase duration (white); the progress
            // bar carries the time REMAINING. Two different numbers.
            HeroNumber(text: PaceFormat.clock(engine.phaseElapsedSec), color: WatchTheme.C.ink)
            if let next = engine.nextPhase {
                Text("NEXT · \(next.label.uppercased())").font(WatchTheme.body(11, .bold)).tracking(0.4)
                    .foregroundStyle(WatchTheme.C.t3)
            }
            Spacer(minLength: 2)
            StatsRow(hr: tracker.heartRate, cadence: tracker.cadence)
            RepProgress(progress: engine.phaseProgress, remainingSec: engine.phaseRemainingSec, fill: accent)
                .padding(.top, 10)
        }
        .padding(.horizontal, 7).padding(.vertical, 5)
    }
}

// MARK: - CONTROLS (swipe-in · pause / end / water-lock)

private struct ControlsPage: View {
    @ObservedObject var engine: WorkoutEngine
    /// Called after a control runs, to swipe back to the face.
    let backToFace: () -> Void
    @State private var confirmEnd = false

    var body: some View {
        VStack(spacing: 12) {
            Text("Controls").font(WatchTheme.sub(13, .semibold)).tracking(1)
                .foregroundStyle(WatchTheme.C.t2)
                .frame(maxWidth: .infinity, alignment: .leading)

            // watch-app.html §D — a row of three: Pause/Resume (the primary,
            // filled), End, Lock. Pause is the largest, easiest stoplight tap.
            HStack(alignment: .top, spacing: 8) {
                control(engine.isPaused ? "play.fill" : "pause.fill",
                        engine.isPaused ? "Resume" : "Pause",
                        size: 64, filled: true,
                        tint: engine.isPaused ? WatchTheme.C.green : WatchTheme.C.amber) {
                    if engine.isPaused { engine.resume(); backToFace() } else { engine.pause() }
                }
                control("stop.fill", "End", size: 50, filled: false, tint: WatchTheme.C.warn) {
                    confirmEnd = true
                }
                control("lock.fill", "Lock", size: 50, filled: false, tint: WatchTheme.C.t2) {
                    WKInterfaceDevice.current().enableWaterLock(); backToFace()
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

    private func control(_ icon: String, _ label: String, size: CGFloat, filled: Bool,
                         tint: Color, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 5) {
                Image(systemName: icon)
                    .font(.system(size: size * 0.34, weight: .bold))
                    .frame(width: size, height: size)
                    .foregroundStyle(filled ? Color(red: 0.10, green: 0.07, blue: 0.0) : tint)
                    .background(filled ? tint : .clear, in: Circle())
                    .overlay(Circle().stroke(filled ? .clear : tint.opacity(0.6), lineWidth: 1.5))
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
            Image(systemName: icon).font(.system(size: 36, weight: .bold)).foregroundStyle(tint)
            Text(title).font(WatchTheme.display(40)).foregroundStyle(tint)
                .lineLimit(1).minimumScaleFactor(0.5)
            if let sub {
                Text(sub.uppercased()).font(WatchTheme.body(12, .semibold)).tracking(0.5)
                    .foregroundStyle(WatchTheme.C.t2).multilineTextAlignment(.center)
            }
        }
        .padding(.horizontal, 10)
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
