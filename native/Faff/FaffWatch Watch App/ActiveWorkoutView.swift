//
//  ActiveWorkoutView.swift
//  FaffWatch
//
//  The execution surface — now driving the LOCKED face redesign (Faces.swift +
//  FaceKit.swift). The primary view routes by phase type to the new faces and
//  binds them to the live engine + tracker. Detail lives one swipe / crown-turn
//  away (Controls, Splits, Session map, In-run stats) — those pages still use
//  the WatchFaces.swift primitives because they're inventory views, not the
//  in-run face.
//
//  Long-press anywhere on the workout pages = pause. The existing pause path
//  (engine.pause / engine.resume) is unchanged; the gesture just routes through
//  it. Auto-pause from HKWorkoutSession still works via its own delegate.
//
//  Live pace/HR/cadence/distance come from WorkoutTracker (mocked in the
//  simulator, HKLiveWorkoutBuilder + GPS on a physical watch).
//

import SwiftUI
import WatchKit

struct ActiveWorkoutView: View {
    @ObservedObject var engine: WorkoutEngine
    @ObservedObject var tracker: WorkoutTracker
    /// Default to the face; Controls sit one swipe left, detail to the right.
    @State private var page = Page.face

    private enum Page: Hashable { case controls, face, stats, splits, map }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            // Paused replaces the paged surface — the locked LivePauseFace owns
            // the whole screen so the Resume button isn't fighting the TabView's
            // page gesture for the tap.
            if engine.isPaused {
                ResponsiveFace {
                    LivePauseFace(
                        distance: String(format: "%.2f", tracker.distanceMi),
                        elapsed: PaceFormat.clock(engine.totalElapsedSec),
                        onResume: { engine.resume(); page = .face }
                    )
                }
            } else {
                TabView(selection: $page) {
                    ResponsiveFace { ControlsPage(engine: engine) { page = .face } }.tag(Page.controls)
                    ResponsiveFace { faceRouter }.tag(Page.face)
                    ResponsiveFace { LiveInRunStats(engine: engine, tracker: tracker) }.tag(Page.stats)
                    ResponsiveFace { SplitsPage(engine: engine) }.tag(Page.splits)
                    ResponsiveFace { SessionMapPage(engine: engine) }.tag(Page.map)
                }
                .tabViewStyle(.page)
            }

            // Edge-of-rep flips sit above the pages. Most transitions are brief
            // + non-interactive (auto-clear after a beat). Fuel cues are
            // PERSISTENT — they stay until the runner swipes them down to
            // acknowledge ("yes, I took the gel"). A missed gel costs the race
            // plan, so the alert can't time out while you fumble for your gel.
            if let cue = engine.transition {
                let isFuel: Bool = { if case .fuel = cue { return true } else { return false } }()
                ResponsiveFace { TransitionFlip(cue: cue) }
                    .transition(.opacity)
                    .gesture(
                        // Swipe (any direction) on a persistent fuel cue
                        // dismisses it. minimumDistance 24pt is firm enough
                        // to avoid mis-fires from a wrist twitch on a run,
                        // soft enough to land deliberately at arm's length.
                        isFuel
                            ? DragGesture(minimumDistance: 24)
                                .onEnded { _ in engine.dismissTransition() }
                            : nil
                    )
            }
        }
        // Long-press anywhere → manual pause. 0.6s is firm enough to never
        // mis-fire from a wrist nudge, fast enough to catch on at a stoplight.
        .onLongPressGesture(minimumDuration: 0.6) {
            if !engine.isPaused { engine.pause() }
        }
        .animation(.easeInOut(duration: 0.18), value: engine.transition)
        .animation(.easeInOut(duration: 0.18), value: engine.isPaused)
    }

    @ViewBuilder
    private var faceRouter: some View {
        if engine.planComplete {
            LiveOvertime(engine: engine, tracker: tracker)
        } else if let phase = engine.currentPhase {
            if engine.isRace {
                LiveRace(engine: engine, tracker: tracker, phase: phase)
            } else {
                switch phase.type {
                case .work:
                    // A workout with exactly one .work phase is an easy / long /
                    // steady run, not a rep session — route to EasyFace (rotating
                    // HR/cadence guardrail) or SteadyRunFace (no target). Multi-
                    // work-phase sessions (intervals, threshold blocks) get the
                    // canonical rep-work face with the strip + counter.
                    if isSingleWorkSession(engine) {
                        if phase.targetPaceSPerMi != nil {
                            LiveEasy(engine: engine, tracker: tracker, phase: phase)
                        } else {
                            LiveSteady(engine: engine, tracker: tracker, phase: phase, role: .neutral)
                        }
                    } else {
                        LiveWorkInterval(engine: engine, tracker: tracker, phase: phase)
                    }
                case .warmup:
                    LiveWarmup(engine: engine, tracker: tracker, phase: phase)
                case .cooldown:
                    LiveSteady(engine: engine, tracker: tracker, phase: phase, role: .neutral)
                case .recovery:
                    LiveRecovery(engine: engine, phase: phase)
                }
            }
        }
    }
}

/// True when the workout has exactly one .work phase — an easy / long / steady
/// run, not a rep session. Warmup/cooldown around it don't change the verdict
/// (they're framing, not work).
private func isSingleWorkSession(_ e: WorkoutEngine) -> Bool {
    e.workout.phases.filter { $0.type == .work }.count == 1
}

// MARK: - Helpers shared by adapters

/// String the tracker's seconds-per-mile into "m:ss" with an em-dash placeholder
/// until the GPS lock produces a real reading.
private func paceText(_ tracker: WorkoutTracker) -> String {
    tracker.paceSPerMi > 0 ? PaceFormat.mmss(tracker.paceSPerMi) : "—:—"
}

/// Pace row colour: muted grey while waiting for GPS lock (placeholder is
/// "—:—" — bright green on a placeholder reads as "active on-target," which
/// is a lie). Once a real pace lands, it flips to the drift-zone colour.
private func paceRole(engine: WorkoutEngine, tracker: WorkoutTracker) -> Role {
    tracker.paceSPerMi > 0 ? Role.from(zone: engine.paceZone) : .mute
}

/// Two-decimal distance string (the canon `dist` row format).
private func distText(_ mi: Double) -> String { String(format: "%.2f", mi) }

/// Strip states ([0=empty, 1=done, 2=now]) for the whole-session bar at the
/// bottom of the work face. One cell per phase, ordered as the engine walks them.
private func sessionStripStates(_ e: WorkoutEngine) -> [Int] {
    e.workout.phases.map { p in
        if p.index < e.currentIndex { return 1 }
        if p.index == e.currentIndex { return 2 }
        return 0
    }
}

/// Phase strip for races — one cell per course phase, current = amber (the
/// `Strip` view paints "now" with `nowColor`).
private func raceStripStates(_ e: WorkoutEngine) -> [Int] {
    sessionStripStates(e)
}

// MARK: - Live → reference-face adapters

private struct LiveWorkInterval: View {
    @ObservedObject var engine: WorkoutEngine
    @ObservedObject var tracker: WorkoutTracker
    let phase: WatchPhase

    private var repCounter: String {
        phase.repUnit == .distance
            ? (engine.phaseRemainingMi.map { String(format: "%.2f", $0) } ?? "—")
            : PaceFormat.clock(engine.phaseRemainingSec)
    }

    var body: some View {
        WorkIntervalFace(
            livePace:      paceText(tracker),
            paceRole:      paceRole(engine: engine, tracker: tracker),
            targetPace:    phase.targetPaceSPerMi.map { PaceFormat.mmss($0) } ?? "—:—",
            totalDistance: distText(tracker.distanceMi),
            repCounter:    repCounter,
            stripStates:   sessionStripStates(engine)
        )
    }
}

private struct LiveRace: View {
    @ObservedObject var engine: WorkoutEngine
    @ObservedObject var tracker: WorkoutTracker
    let phase: WatchPhase

    /// Delta-to-goal as the bottom row: "+1:14" (over goal) / "-0:42" (under).
    /// Role flips between live (≤ 0 — on/under goal) and over (> 0 — behind).
    /// Renders "—" until enough banked to project a finish.
    private var goalDeltaText: String {
        guard let d = engine.projectedDeltaSec else { return "—" }
        let a = abs(d)
        let mag = a >= 60 ? "\(a / 60):" + String(format: "%02d", a % 60) : "\(a)s"
        return d <= 0 ? "-\(mag)" : "+\(mag)"
    }
    private var goalDeltaRole: Role {
        guard let d = engine.projectedDeltaSec else { return .neutral }
        return d <= 0 ? .live : .over
    }

    var body: some View {
        LiveRaceFace(
            livePace:       paceText(tracker),
            paceRole:       paceRole(engine: engine, tracker: tracker),
            phaseTarget:    phase.targetPaceSPerMi.map { PaceFormat.mmss($0) } ?? "—:—",
            totalDistance:  String(format: "%.1f", tracker.distanceMi),
            goalDelta:      goalDeltaText,
            goalDeltaRole:  goalDeltaRole,
            phaseSegments:  raceStripStates(engine)
        )
    }
}

/// EASY / long / steady run — single-work-phase session with a target pace.
/// Pace colour reflects the drift zone; HR row flips red when over the workout's
/// `hrCeilingBpm`. The guardrail rotates HR ⇄ cadence every 60 s when HR is in
/// zone (handled inside EasyFace).
private struct LiveEasy: View {
    @ObservedObject var engine: WorkoutEngine
    @ObservedObject var tracker: WorkoutTracker
    let phase: WatchPhase

    var body: some View {
        EasyFace(
            pace:     paceText(tracker),
            paceRole: paceRole(engine: engine, tracker: tracker),
            hr:       tracker.heartRate > 0 ? "\(tracker.heartRate)" : "—",
            hrOver:   engine.hrOverCeiling,
            cadence:  tracker.cadence > 0 ? "\(tracker.cadence)" : "—",
            distance: distText(tracker.distanceMi)
        )
    }
}

private struct LiveRecovery: View {
    @ObservedObject var engine: WorkoutEngine
    let phase: WatchPhase

    private var nextTarget: String {
        engine.nextPhase?.targetPaceSPerMi.map { PaceFormat.mmss($0) } ?? "—:—"
    }
    /// Next rep's distance ("0.50") or a duration label fallback ("0:30") so the
    /// runner sees the *next* thing they'll execute against.
    private var nextDist: String {
        if let n = engine.nextPhase {
            if let d = n.distanceMi { return String(format: "%.2f", d) }
            return PaceFormat.clock(n.durationSec)
        }
        return "—"
    }

    var body: some View {
        RestFace(
            restTimeLeft:   PaceFormat.clock(engine.phaseRemainingSec),
            nextTargetPace: nextTarget,
            nextDistance:   nextDist
        )
    }
}

private struct LiveWarmup: View {
    @ObservedObject var engine: WorkoutEngine
    @ObservedObject var tracker: WorkoutTracker
    let phase: WatchPhase

    /// Show the distance covered in the warmup so far (matches the locked
    /// design's "0.4" warmup readout); when there's no GPS yet, fall back to
    /// elapsed time.
    private var coveredValue: String {
        engine.phaseCoveredMi > 0
            ? String(format: "%.2f", engine.phaseCoveredMi)
            : PaceFormat.clock(engine.phaseElapsedSec)
    }
    private var thenPace: String {
        engine.nextPhase?.targetPaceSPerMi.map { PaceFormat.mmss($0) } ?? "—:—"
    }
    private var thenDistance: String {
        if let n = engine.nextPhase {
            if let d = n.distanceMi { return String(format: "%.2f", d) }
            return PaceFormat.clock(n.durationSec)
        }
        return "—"
    }

    var body: some View {
        WarmupFace(
            coveredValue: coveredValue,
            thenPace:     thenPace,
            thenDistance: thenDistance
        )
    }
}

private struct LiveSteady: View {
    @ObservedObject var engine: WorkoutEngine
    @ObservedObject var tracker: WorkoutTracker
    let phase: WatchPhase
    /// Pace row colour. `.live` while the runner has an easy target to hold,
    /// `.neutral` for cooldown / unstructured stretches where there's no chase.
    let role: Role

    var body: some View {
        SteadyRunFace(
            livePace: paceText(tracker),
            paceRole: role,
            distance: distText(tracker.distanceMi),
            elapsed:  PaceFormat.clock(engine.totalElapsedSec)
        )
    }
}

/// OVERTIME (plan done · still recording · run free)
private struct LiveOvertime: View {
    @ObservedObject var engine: WorkoutEngine
    @ObservedObject var tracker: WorkoutTracker
    var body: some View {
        SteadyRunFace(
            livePace: paceText(tracker),
            paceRole: .neutral,
            distance: distText(tracker.distanceMi),
            elapsed:  engine.totalElapsedSec >= 3600
                ? PaceFormat.hms(engine.totalElapsedSec)
                : PaceFormat.clock(engine.totalElapsedSec)
        )
    }
}

// MARK: - SECONDARY STATS (swipe page — elapsed / distance / avg pace / calories)

private struct LiveInRunStats: View {
    @ObservedObject var engine: WorkoutEngine
    @ObservedObject var tracker: WorkoutTracker
    var body: some View {
        let mi = tracker.distanceMi
        let avgSec = mi > 0.02 ? Int(Double(engine.totalElapsedSec) / mi) : 0
        InRunStatsFace(
            elapsed: engine.totalElapsedSec >= 3600
                ? PaceFormat.hms(engine.totalElapsedSec)
                : PaceFormat.clock(engine.totalElapsedSec),
            distance: String(format: "%.1f", mi),
            avgPace: avgSec > 0 ? PaceFormat.mmss(avgSec) : "—:—",
            calories: tracker.activeEnergyKcal > 0 ? "\(tracker.activeEnergyKcal)" : "—")
    }
}

// MARK: - CONTROLS (swipe-in · pause / end · deck §D)

private struct ControlsPage: View {
    @ObservedObject var engine: WorkoutEngine
    /// Called after a control runs, to swipe back to the face.
    let backToFace: () -> Void
    @State private var confirmEnd = false

    var body: some View {
        ControlsFace(paused: engine.isPaused,
                     onPrimary: { if engine.isPaused { engine.resume(); backToFace() } else { engine.pause() } },
                     onEnd: { confirmEnd = true })
        .confirmationDialog("End workout?", isPresented: $confirmEnd, titleVisibility: .visible) {
            Button("End workout", role: .destructive) { engine.abandon() }
            Button("End this interval") { engine.endCurrentPhase(); backToFace() }
            Button("Keep going", role: .cancel) {}
        }
    }
}

/// The control page (deck §D): full-width stacked bars — big tap targets, not
/// little circles. Pause/Resume (primary, filled) over End.
struct ControlsFace: View {
    var paused: Bool = false
    var onPrimary: () -> Void = {}
    var onEnd: () -> Void = {}

    var body: some View {
        VStack(spacing: 10) {
            HStack {
                Eyebrow(text: "Controls", color: WP.muted)
                Spacer(minLength: 78)
            }
            .padding(.leading, 8).padding(.top, 20)
            Spacer(minLength: 0)
            bar(paused ? "play.fill" : "pause.fill", paused ? "Resume" : "Pause",
                tint: paused ? WP.green : WP.amber, filled: true, action: onPrimary)
            bar("stop.fill", "End", tint: WP.warn, filled: false, action: onEnd)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12).padding(.bottom, 8)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WP.bg)
        .ignoresSafeArea(.container, edges: .top)
    }

    private func bar(_ icon: String, _ label: String, tint: Color, filled: Bool,
                     action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: icon).font(.system(size: 17, weight: .bold))
                Text(label).font(WF.oswald(16)).tracking(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 20).padding(.vertical, 16)
            .frame(maxWidth: .infinity)
            .foregroundStyle(filled ? Color(red: 0.10, green: 0.07, blue: 0.0) : tint)
            .background(filled ? tint : tint.opacity(0.16), in: Capsule())
            .overlay(Capsule().stroke(filled ? .clear : tint.opacity(0.55), lineWidth: 1.5))
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
            HStack {
                Eyebrow(text: "Splits", color: WP.muted)
                Spacer(minLength: 78)
            }
            .padding(.leading, 8).padding(.top, 20).padding(.bottom, 2)
            ForEach(Array(rows.enumerated()), id: \.element.id) { idx, r in
                if idx > 0 { Rectangle().fill(WP.line).frame(height: 1) }
                HStack(spacing: 10) {
                    Text("\(r.repNo)").font(WF.interBold(12)).foregroundStyle(WP.faint)
                        .frame(width: 16, alignment: .leading)
                    Text(r.label).font(WF.interSemi(15)).foregroundStyle(WP.ink)
                    Spacer()
                    Text(r.pace).font(WF.bebas(26)).monospacedDigit().foregroundStyle(r.color)
                }
                .frame(maxHeight: .infinity)
            }
        }
        .padding(.horizontal, 14).padding(.bottom, 8)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(WP.bg)
        .ignoresSafeArea(.container, edges: .top)
    }
}

// MARK: - SESSION MAP (where this rep sits in the whole workout · deck §D)

private struct SessionMapPage: View {
    @ObservedObject var engine: WorkoutEngine
    var body: some View { SessionMapFace(rows: groupedRows) }

    private func seg(_ idx: Int) -> SegState {
        idx < engine.currentIndex ? .done : (idx == engine.currentIndex ? .current : .upcoming)
    }

    /// Collapse the interval block so a 5×7 doesn't list 12 rows: warmup, done
    /// reps as one line, the current rep/recovery, upcoming reps as one line,
    /// cooldown. Stays ~5 readable rows regardless of rep count.
    private var groupedRows: [SessionMapFace.Row] {
        let phases = engine.workout.phases
        let cur = engine.currentIndex
        let totalReps = phases.filter { $0.type == .work }.count
        let doneReps = phases.filter { $0.type == .work && $0.index < cur }.count
        let curPhase = phases.indices.contains(cur) ? phases[cur] : nil
        var out: [SessionMapFace.Row] = []

        if let wu = phases.first(where: { $0.type == .warmup }) {
            out.append(.init(label: "Warmup",
                             value: cur > wu.index ? "✓" : PaceFormat.clock(cur == wu.index ? engine.phaseRemainingSec : wu.durationSec),
                             state: seg(wu.index)))
        }
        if doneReps > 0 {
            out.append(.init(label: doneReps == 1 ? "Rep 1" : "Reps 1–\(doneReps)", value: "✓", state: .done))
        }
        if let cp = curPhase, cp.type == .work {
            out.append(.init(label: "Rep \(doneReps + 1) · now",
                             value: cp.targetPaceSPerMi.map { PaceFormat.mmss($0) } ?? PaceFormat.clock(engine.phaseRemainingSec),
                             state: .current))
        } else if let cp = curPhase, cp.type == .recovery {
            out.append(.init(label: "Recovery · now", value: PaceFormat.clock(engine.phaseRemainingSec), state: .current))
        }
        let curIsWork = curPhase?.type == .work
        let upcoming = totalReps - doneReps - (curIsWork ? 1 : 0)
        if upcoming > 0 {
            let first = totalReps - upcoming + 1
            out.append(.init(label: upcoming == 1 ? "Rep \(first)" : "Reps \(first)–\(totalReps)", value: "\(upcoming)×", state: .upcoming))
        }
        if let cd = phases.first(where: { $0.type == .cooldown }) {
            out.append(.init(label: "Cooldown",
                             value: cur > cd.index ? "✓" : PaceFormat.clock(cd.durationSec),
                             state: seg(cd.index)))
        }
        return out
    }
}

struct SessionMapFace: View {
    struct Row: Identifiable { let id = UUID(); let label: String; let value: String; let state: SegState }
    let rows: [Row]
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Eyebrow(text: "Session", color: WP.muted)
                Spacer(minLength: 78)
            }
            .padding(.leading, 8).padding(.top, 20).padding(.bottom, 2)
            ForEach(Array(rows.enumerated()), id: \.element.id) { idx, r in
                if idx > 0 { Rectangle().fill(WP.line).frame(height: 1) }
                HStack(spacing: 11) {
                    Circle().fill(dot(r.state)).frame(width: 8, height: 8)
                    Text(r.label).font(WF.interSemi(15))
                        .foregroundStyle(r.state == .upcoming ? WP.muted : WP.ink).lineLimit(1)
                    Spacer()
                    Text(r.value).font(WF.interSemi(15)).monospacedDigit().foregroundStyle(WP.muted)
                }
                .frame(maxHeight: .infinity)
                .opacity(r.state == .upcoming ? 0.7 : 1)
            }
        }
        .padding(.horizontal, 14).padding(.bottom, 8)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(WP.bg)
        .ignoresSafeArea(.container, edges: .top)
    }
    private func dot(_ s: SegState) -> Color {
        switch s { case .done: return WP.green; case .current: return WP.orange; case .upcoming: return WP.line }
    }
}

// MARK: - Transition flips (full-screen, brief · deck §C3 / §F2)

/// Routes engine transitions to the right takeover face. Fuel + Go use the new
/// locked takeovers; heads-up and phase-change use the WatchFaces TransitionFace
/// until they have their own locked variants.
private struct TransitionFlip: View {
    let cue: WorkoutEngine.TransitionCue
    var body: some View {
        switch cue {
        case .fuel(let t, let s):
            FuelFace(big: t, sub: s ?? "+ water")
        case .go(let t, let s):
            // The new GoFace is glyph + GO + sub. Engine's title carries the
            // rep number ("Go · Int 4") and the sub carries the target.
            GoFace(sub: "\(t)\(s.map { " · \($0)" } ?? "")")
        case .headsUp(let t, let s):
            TransitionFace(icon: "clock", title: t, titleColor: WP.amber, sub: s)
        case .phase(let t, let s):
            TransitionFace(icon: "mountain.2.fill", title: t, titleColor: WP.orange, sub: s)
        }
    }
}

/// The shared centered transition layout (icon + title + sub) for the cues that
/// don't yet have a locked takeover. Survives from the previous design.
struct TransitionFace: View {
    let icon: String
    let title: String
    var titleColor: Color = WP.amber
    let sub: String?
    var next: String? = nil   // what's coming after this beat (e.g. "90s jog") so you can prepare
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: icon).font(.system(size: 34, weight: .bold)).foregroundStyle(titleColor)
            Text(title).font(WF.bebas(44)).foregroundStyle(titleColor)
                .lineLimit(1).minimumScaleFactor(0.5)
            if let sub {
                Text(sub).font(WF.interSemi(12)).tracking(0.3)
                    .foregroundStyle(WP.muted).multilineTextAlignment(.center)
            }
            if let next {
                (Text("UP NEXT  ").foregroundStyle(WP.muted)
                 + Text(next.uppercased()).foregroundStyle(WP.ink))
                    .font(WF.interBold(12)).tracking(0.6)
                    .padding(.top, 4)
            }
        }
        .padding(.horizontal, 14)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WP.bg)
    }
}

#Preview {
    ActiveWorkoutView(engine: {
        let e = WorkoutEngine(workout: .sample)
        e.start()
        return e
    }(), tracker: WorkoutTracker())
}
