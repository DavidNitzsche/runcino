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

            // Live ending countdown — sits ABOVE the pages, BELOW the
            // transition flips. Fires in the last 10 s of a time-based work
            // rep (10 → 0). When non-nil, it covers the live face so the
            // runner gets the full-screen countdown read. The engine clears
            // it back to nil when the phase advances.
            if engine.endingCountdownSec != nil {
                ResponsiveFace { EndingCountdownView(engine: engine) }
                    .transition(.opacity)
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
        .animation(.easeInOut(duration: 0.18), value: engine.endingCountdownSec != nil)
    }

    @ViewBuilder
    private var faceRouter: some View {
        // No special LiveOvertime branch — LiveEasy handles its own
        // overtime state inline (same face, distance row flips to
        // purple + counts up). Keeping the runner on the same layout
        // past the plan was the requested behaviour.
        if let phase = engine.currentPhase {
            if engine.isRace {
                LiveRace(engine: engine, tracker: tracker, phase: phase)
            } else {
                switch phase.type {
                case .work:
                    // displayHint takes precedence — backend signal that
                    // this workout wants a specialised face (HR-governed,
                    // progression, strides). Falls back to the phase-driven
                    // defaults below when nil/unknown.
                    switch engine.workout.displayHint {
                    case "hr":
                        LiveHR(engine: engine, tracker: tracker, phase: phase)
                    case "progression":
                        LiveProgression(engine: engine, tracker: tracker, phase: phase)
                    case "strides":
                        LiveStrides(engine: engine, tracker: tracker, phase: phase)
                    default:
                        // A workout with exactly one .work phase is an easy /
                        // long / steady run — route to EasyFace (rotating
                        // HR/cadence guardrail) or SteadyRunFace (no target).
                        // Multi-work-phase sessions (intervals, threshold
                        // blocks) get the rep-work face with strip + counter.
                        if isSingleWorkSession(engine) {
                            if phase.targetPaceSPerMi != nil {
                                LiveEasy(engine: engine, tracker: tracker, phase: phase)
                            } else {
                                LiveSteady(engine: engine, tracker: tracker, phase: phase, role: .neutral)
                            }
                        } else {
                            LiveWorkInterval(engine: engine, tracker: tracker, phase: phase)
                        }
                    }
                case .warmup:
                    LiveWarmup(engine: engine, tracker: tracker, phase: phase)
                case .cooldown:
                    LiveSteady(engine: engine, tracker: tracker, phase: phase, role: .neutral)
                case .recovery:
                    LiveRecovery(engine: engine, tracker: tracker, phase: phase)
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
/// zone (driven by engine.guardrailIdx so it survives view recreation).
///
/// Distance row has two states:
///   · During the plan — counts DOWN from workout.distanceMi to 0, blue (.dist).
///   · In overtime (planComplete) — counts UP from 0, purple (.bonus).
///     The face stays the same; only the distance row's number direction +
///     colour change. User reported wanting to "stay on the same face" past
///     the plan rather than swap to a different layout.
///
/// Uses workout.distanceMi (top-level) as the canonical target, not the
/// phase's distanceMi, so a stale payload that lost repUnit at the phase
/// level still does the right thing.
private struct LiveEasy: View {
    @ObservedObject var engine: WorkoutEngine
    @ObservedObject var tracker: WorkoutTracker
    let phase: WatchPhase

    private var distanceDisplay: String {
        if engine.planComplete {
            // Overtime · keep showing TOTAL covered (now purple).
            // "I ran 6.2 today" is the meaningful number; the colour
            // says "and 0.4 of that was bonus past the plan." Less
            // mental math than showing only the bonus portion.
            return distText(tracker.distanceMi)
        }
        if let remaining = engine.distanceToGoMi {
            return distText(remaining)
        }
        return distText(tracker.distanceMi)
    }
    var body: some View {
        EasyFace(
            pace:     paceText(tracker),
            paceRole: paceRole(engine: engine, tracker: tracker),
            hr:       tracker.heartRate > 0 ? "\(tracker.heartRate)" : "—",
            hrOver:   engine.hrOverCeiling,
            cadence:  tracker.cadence > 0 ? "\(tracker.cadence)" : "—",
            distance: distanceDisplay,
            guardrailIdx: engine.guardrailIdx,
            distanceRole: engine.planComplete ? .bonus : .dist
        )
    }
}

/// HR-governed easy face — MAF / Z2 / heat-flag sessions where HR is the
/// real anchor, not pace. Same NumberFace recipe as EasyFace but HR is the
/// big-green hero in the middle and pace is the neutral white row above.
/// Routed when workout.displayHint == "hr".
private struct LiveHR: View {
    @ObservedObject var engine: WorkoutEngine
    @ObservedObject var tracker: WorkoutTracker
    let phase: WatchPhase

    /// HR row role: green when in-zone, red when over ceiling, mute pre-HR.
    private var hrRole: Role {
        if tracker.heartRate <= 0 { return .mute }
        if engine.hrOverCeiling { return .over }
        return .live
    }
    var body: some View {
        HRFace(
            pace:     paceText(tracker),
            hr:       tracker.heartRate > 0 ? "\(tracker.heartRate)" : "—",
            hrRole:   hrRole,
            distance: distText(tracker.distanceMi)
        )
    }
}

/// Progression run — pace target step-changes through the workout. Each
/// .work phase carries the next target; this adapter shows the runner the
/// current target + how much further until the next step kicks in.
/// Routed when workout.displayHint == "progression".
private struct LiveProgression: View {
    @ObservedObject var engine: WorkoutEngine
    @ObservedObject var tracker: WorkoutTracker
    let phase: WatchPhase

    private var stepTarget: String {
        phase.targetPaceSPerMi.map { PaceFormat.mmss($0) } ?? "—:—"
    }
    /// How much further before the pace target step-changes — either miles
    /// (when this phase is distance-based) or m:ss to next.
    private var toNextStep: String {
        if phase.repUnit == .distance {
            return engine.phaseRemainingMi.map { String(format: "%.2f", $0) } ?? "—"
        }
        return PaceFormat.clock(engine.phaseRemainingSec)
    }
    var body: some View {
        ProgressionFace(
            livePace:      paceText(tracker),
            paceRole:      paceRole(engine: engine, tracker: tracker),
            stepTarget:    stepTarget,
            totalDistance: distText(tracker.distanceMi),
            toNextStep:    toNextStep
        )
    }
}

/// Strides — short bursts (typically 8 × 20 s, full recovery between). The
/// face leads with live pace + a burst countdown so the runner knows when
/// the current stride ends; the strip below tracks reps done / now / left.
/// Routed when workout.displayHint == "strides".
private struct LiveStrides: View {
    @ObservedObject var engine: WorkoutEngine
    @ObservedObject var tracker: WorkoutTracker
    let phase: WatchPhase

    /// Time left in the current burst — m:ss for a 20s stride reads as "0:14".
    private var burstCountdown: String {
        if phase.repUnit == .distance {
            return engine.phaseRemainingMi.map { String(format: "%.2f", $0) } ?? "—"
        }
        return PaceFormat.clock(engine.phaseRemainingSec)
    }
    var body: some View {
        StridesFace(
            livePace:        paceText(tracker),
            burstCountdown:  burstCountdown,
            stripStates:     sessionStripStates(engine)
        )
    }
}

private struct LiveRecovery: View {
    @ObservedObject var engine: WorkoutEngine
    @ObservedObject var tracker: WorkoutTracker
    let phase: WatchPhase

    var body: some View {
        RestFace(
            restTimeLeft: PaceFormat.clock(engine.phaseRemainingSec),
            pace:         paceText(tracker),
            paceRole:     tracker.paceSPerMi > 0 ? .live : .mute,
            hr:           tracker.heartRate > 0 ? "\(tracker.heartRate)" : "—"
        )
    }
}

private struct LiveWarmup: View {
    @ObservedObject var engine: WorkoutEngine
    @ObservedObject var tracker: WorkoutTracker
    let phase: WatchPhase

    /// Warmup count-DOWN. Distance-based warmups (the typical case — the
    /// payload ships `repUnit: distance, distanceMi: 1.8`): tick down from
    /// the prescribed miles to zero. Time-based warmups: tick down from
    /// the prescribed seconds to zero.
    private var remaining: String {
        if phase.repUnit == .distance, let total = phase.distanceMi {
            let rem = max(0, total - engine.phaseCoveredMi)
            return String(format: "%.2f", rem)
        }
        let rem = max(0, phase.durationSec - engine.phaseElapsedSec)
        return PaceFormat.clock(rem)
    }
    private var remainingRole: Role {
        phase.repUnit == .distance ? .dist : .neutral
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
            pace:           paceText(tracker),
            paceRole:       tracker.paceSPerMi > 0 ? .live : .mute,
            hr:             tracker.heartRate > 0 ? "\(tracker.heartRate)" : "—",
            remaining:      remaining,
            remainingRole:  remainingRole,
            thenPace:       thenPace,
            thenDistance:   thenDistance
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

    /// Distance row — same dual-mode treatment as LiveEasy:
    ///   · Distance-based phase (cooldown w/ phase.distanceMi): counts DOWN
    ///     from the phase target (1.2 → 0), blue.
    ///   · Overtime (planComplete fired, runner kept going past plan): counts
    ///     UP total covered, purple.
    ///   · Otherwise (Just Run, no target): counts UP total covered, blue.
    private var distanceDisplay: String {
        if engine.planComplete {
            return distText(tracker.distanceMi)
        }
        if let remaining = engine.phaseRemainingMi {
            return distText(remaining)
        }
        return distText(tracker.distanceMi)
    }
    private var distanceRole: Role {
        engine.planComplete ? .bonus : .dist
    }

    var body: some View {
        SteadyRunFace(
            livePace: paceText(tracker),
            paceRole: role,
            distance: distanceDisplay,
            elapsed:  engine.totalElapsedSec >= 3600
                ? PaceFormat.hms(engine.totalElapsedSec)
                : PaceFormat.clock(engine.totalElapsedSec),
            distanceRole: distanceRole
        )
    }
}

// (LiveOvertime removed — overtime is now handled inline inside LiveEasy,
// so the runner stays on the same EasyFace layout past the plan with just
// the distance row flipping to .bonus / counting up. See LiveEasy above.)

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
/// little circles. Pause/Resume (primary, filled amber/green), End (red),
/// and Sound (blue · toggles audible alert "ding" on every transition cue —
/// mile splits, fuel, etc. Persists across runs via @AppStorage).
struct ControlsFace: View {
    var paused: Bool = false
    var onPrimary: () -> Void = {}
    var onEnd: () -> Void = {}
    /// Audible alert toggle — persists across runs. When ON, the engine
    /// plays Haptics.chime() on top of the regular haptic for every
    /// transition cue (split / fuel / go / etc). Reads UserDefaults key
    /// "audibleAlerts" elsewhere in the engine.
    /// Default ON: a long run is the use case (mile-splits + 3 gel cues),
    /// and a silent miss costs more than an extra ding the runner can mute.
    /// Existing testers who already toggled to OFF keep that value;
    /// AppStorage only applies the default when the key is missing.
    @AppStorage("audibleAlerts") private var audibleAlerts: Bool = true

    var body: some View {
        VStack(spacing: 8) {
            HStack {
                Eyebrow(text: "Controls", color: WP.muted)
                Spacer(minLength: 78)
            }
            .padding(.leading, 8).padding(.top, 20)
            Spacer(minLength: 0)
            bar(paused ? "play.fill" : "pause.fill", paused ? "Resume" : "Pause",
                tint: paused ? WP.green : WP.amber, filled: true, action: onPrimary)
            // End filled to match Pause's weight — they're both primary
            // actions on this page, no reason End should read as secondary.
            // Uses Faff.redish (#D03F3F, the approved destructive-action red)
            // — distinct from WP.warn/Faff.over (#FC4D64, the pinker red used
            // on live-data alerts like off-pace / HR-over). Buttons + data
            // states get different reds so they read as different meanings.
            bar("stop.fill", "End", tint: Faff.redish, filled: true, action: onEnd)
            bar(audibleAlerts ? "speaker.wave.2.fill" : "speaker.slash.fill",
                audibleAlerts ? "Sound" : "Muted",
                tint: Faff.brand, filled: audibleAlerts,
                action: { audibleAlerts.toggle() })
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

// MARK: - SPLITS (every rep's pace as you bank it)

private struct SplitsPage: View {
    @ObservedObject var engine: WorkoutEngine
    var body: some View {
        SplitsFace(rows: engine.splits.map {
            SplitsFace.Row(repNo: $0.repNo,
                           pace: $0.paceSPerMi.map { p in PaceFormat.mmss(p) } ?? "—",
                           role: paceRole($0))
        })
    }
    /// Map a split's pace-vs-target zone to the locked grammar's Role for
    /// colour: muted (no data yet) · live/over/goal once a pace is banked.
    /// Current rep is highlighted neutral (it's the row to read NOW).
    private func paceRole(_ s: WorkoutEngine.Split) -> Role {
        guard s.paceSPerMi != nil else { return .mute }
        if s.state == .current { return .neutral }
        return Role.from(zone: engine.zone(forPace: s.paceSPerMi, target: s.targetSPerMi))
    }
}

/// Splits — number-led list under the locked grammar. No "SPLITS" header
/// chrome, no per-row phase label ("Easy"). Each row is `repNo · pace`,
/// with the pace coloured by drift-zone (green = on target, amber = drift,
/// red = off). Done rows banked; current row neutral white; upcoming rows
/// muted dashes. List scrolls if the rep count overflows.
///
/// Layout: explicit top spacer (Color.clear, ~14% h) so the first row sits
/// firmly BELOW the OS clock — ScrollView in watchOS pins content to the
/// safe-area top and ignores VStack-level top padding, so an in-flow spacer
/// is the only reliable way to clear the clock.
struct SplitsFace: View {
    struct Row: Identifiable {
        let id = UUID()
        let repNo: Int
        let pace: String
        let role: Role
    }
    let rows: [Row]
    var body: some View {
        GeometryReader { geo in
            let h = geo.size.height
            ZStack {
                Color.black.ignoresSafeArea()
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: h * 0.030) {
                        Color.clear.frame(height: h * 0.135)   // clears OS clock baseline
                        ForEach(rows) { r in
                            HStack(spacing: h * 0.045) {
                                Text("\(r.repNo)")
                                    .font(.custom("HelveticaNeue-Bold", size: h * 0.105))
                                    .foregroundStyle(Faff.mute)
                                    .frame(width: h * 0.10, alignment: .leading)
                                Text(r.pace)
                                    .font(.custom("HelveticaNeue-Bold", size: h * 0.155))
                                    .foregroundStyle(r.role.color)
                                Spacer(minLength: 0)
                            }
                        }
                        Color.clear.frame(height: h * 0.060)   // clears page-indicator dots
                    }
                    .padding(.horizontal, h * 0.075)
                }
            }
        }
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

/// Session map — where you are in the workout, under the locked grammar.
/// No "SESSION" header. Each row: status dot · phase label · value (target
/// pace, time remaining, ✓ for done, etc.). Dot colour carries state — green
/// for done, neutral white for current, muted for upcoming. Helvetica Bold
/// throughout. List scrolls if a long workout overflows.
struct SessionMapFace: View {
    struct Row: Identifiable {
        let id = UUID()
        let label: String
        let value: String
        let state: SegState
    }
    let rows: [Row]
    var body: some View {
        GeometryReader { geo in
            let h = geo.size.height
            ZStack {
                Color.black.ignoresSafeArea()
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: h * 0.030) {
                        Color.clear.frame(height: h * 0.135)   // clears OS clock baseline
                        ForEach(rows) { r in
                            HStack(spacing: h * 0.040) {
                                Circle()
                                    .fill(dotColor(r.state))
                                    .frame(width: h * 0.040, height: h * 0.040)
                                Text(r.label)
                                    .font(.custom("HelveticaNeue-Bold", size: h * 0.075))
                                    .foregroundStyle(labelColor(r.state))
                                    .lineLimit(1)
                                    .minimumScaleFactor(0.7)
                                Spacer(minLength: 0)
                                Text(r.value)
                                    .font(.custom("HelveticaNeue-Bold", size: h * 0.080))
                                    .foregroundStyle(valueColor(r.state))
                                    .monospacedDigit()
                            }
                        }
                        Color.clear.frame(height: h * 0.060)   // clears page-indicator dots
                    }
                    .padding(.horizontal, h * 0.075)
                }
            }
        }
    }
    private func dotColor(_ s: SegState) -> Color {
        switch s {
        case .done:     return Faff.live
        case .current:  return Faff.ink
        case .upcoming: return Faff.mute.opacity(0.55)
        }
    }
    private func labelColor(_ s: SegState) -> Color {
        s == .upcoming ? Faff.mute : Faff.ink
    }
    private func valueColor(_ s: SegState) -> Color {
        switch s {
        case .done:     return Faff.live
        case .current:  return Faff.ink
        case .upcoming: return Faff.mute
        }
    }
}

// MARK: - Transition flips (full-screen, brief · deck §C3 / §F2)

/// Routes engine transitions to locked-grammar takeovers. All five cue
/// types now use Faces.swift takeovers — no more legacy TransitionFace.
private struct TransitionFlip: View {
    let cue: WorkoutEngine.TransitionCue
    var body: some View {
        switch cue {
        case .fuel(let i, let total):
            FuelFace(index: i, total: total)
        case .go(let rep, let target):
            GoFace(rep: rep, target: target)
        case .split(let n, let paceSec):
            // MILE N · m:ss takeover — the just-banked mile pace, flashed
            // briefly so the runner sees the split without leaving the face.
            MileSplitFace(mile: "MILE \(n)", pace: PaceFormat.mmss(paceSec))
        case .headsUp(let value):
            HeadsUpFace(value: value)
        case .phase(let t, let s):
            PhaseChangeFace(title: t, sub: s ?? "")
        }
    }
}

// (Legacy TransitionFace removed — every transition cue now routes to a
// proper Faces.swift takeover via TransitionFlip above.)

#Preview {
    ActiveWorkoutView(engine: {
        let e = WorkoutEngine(workout: .sample)
        e.start()
        return e
    }(), tracker: WorkoutTracker())
}
