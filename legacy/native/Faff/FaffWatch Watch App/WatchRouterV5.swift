//
//  WatchRouterV5.swift
//  FaffWatch
//
//  Which board is on the wrist right now.
//
//  The 0821 boards are pure presentation — they take strings and closures and
//  know nothing about HealthKit, the engine or the wire. This is the one file
//  that knows both sides, so it is the only place a mapping decision lives.
//
//  Navigation model, from the handoff README:
//
//      LOBBY ──swipe──▶ breakdown ──swipe──▶ week shape
//        │ (Start)
//        ▼
//      RUNNING page 1 ◀──swipe──▶ page 2
//        │ tap                wrist down ──▶ ALWAYS-ON
//        ▼
//      CONTROLS ──▶ End confirm ──▶ COMPLETE ──scroll──▶ SUMMARY
//                                └─ Discard (text) ──▶ lobby
//
//      moments, faults and coach questions INTERRUPT running and return to it
//
//  Two rules shape this file more than the diagram does.
//
//  A moment REDUCES density and gives the screen back on its own (rule 9) —
//  except the bail offer and the ceiling override, which WAIT, because an
//  unanswered question that vanishes is worse than one never asked. So the
//  interrupt stack has two kinds of entry and they are not interchangeable.
//
//  NO SENSOR BLOCKS THE RUN (rule 8). Every fault board here is an overlay on
//  a running face, never a replacement for it, and never a gate in front of
//  Start. A watch that will not start until it has found a satellite is a
//  watch the runner stops trusting on the third cold morning.
//

import SwiftUI

// MARK: - Formatting
//
// Every number the boards draw is a string, and this is where it becomes one.
// Kept here rather than in the boards so that "what 7:42 means" is a routing
// decision and "how 7:42 looks" is a design one.

enum WFmt {

    /// Seconds per mile → "7:42". Returns nil rather than "0:00" when there is
    /// no reading — a zero pace is not a slow pace, it is an absent one, and
    /// the boards drop a slot rather than draw a lie.
    static func pace(_ secPerMi: Int?) -> String? {
        guard let s = secPerMi, s > 0, s < 3600 else { return nil }
        return "\(s / 60):" + String(format: "%02d", s % 60)
    }

    /// Elapsed → "44:16", or "1:04:16" past an hour.
    static func clock(_ sec: Int) -> String {
        let s = max(0, sec)
        if s >= 3600 {
            return "\(s / 3600):" + String(format: "%02d:%02d", (s % 3600) / 60, s % 60)
        }
        return "\(s / 60):" + String(format: "%02d", s % 60)
    }

    /// mm:ss for a countdown that is always under an hour.
    static func short(_ sec: Int) -> String {
        let s = max(0, sec)
        return "\(s / 60):" + String(format: "%02d", s % 60)
    }

    /// Distance → "5.72". Two decimals under 100 miles, which is every run.
    static func miles(_ mi: Double) -> String {
        String(format: mi >= 100 ? "%.1f" : "%.2f", max(0, mi))
    }

    /// A whole number with no decimal point — cadence, watts, bpm.
    static func whole(_ v: Int?) -> String? {
        guard let v, v > 0 else { return nil }
        return String(v)
    }

    /// Elevation gain → "+482". Signed, because a climb reads as a climb.
    static func elevation(_ feet: Double?) -> String? {
        guard let f = feet else { return nil }
        return (f >= 0 ? "+" : "") + String(Int(f.rounded()))
    }
}

// MARK: - What is interrupting the run

/// A moment, a fault or a question currently holding the screen.
///
/// Ordered by precedence, HIGHEST FIRST, and the order is a design decision
/// rather than an implementation detail:
///
///  · A question the coach asked outranks everything, because it is waiting
///    for an answer and the runner has already been made to look.
///  · Water lock outranks a moment because the screen is not usable anyway.
///  · A moment outranks a fault, because a moment is 2-3 seconds and a fault
///    is a condition that will still be there afterwards.
enum WInterrupt: Equatable {
    case bailOffered
    case ceilingOverride
    case waterLock
    case moment(WMomentKind)
    case lowBattery
    case gpsAcquiring

    /// Whether this gives the screen back on its own. The two coach questions
    /// do NOT — they wait. Everything else is timed or condition-driven.
    var isSelfDismissing: Bool {
        switch self {
        case .bailOffered, .ceilingOverride: return false
        case .waterLock, .lowBattery, .gpsAcquiring: return false
        case .moment: return true
        }
    }
}

/// The moment kinds, mapped one-to-one from the engine's own `TransitionCue`
/// so the router adds no vocabulary the engine does not already have.
enum WMomentKind: Equatable {
    case go(rep: String, target: String)
    case phaseChange(title: String, sub: String?)
    case split(mile: Int, paceSec: Int)
    case fuel(index: Int, total: Int)
    case headsUp(value: String, quicken: Bool)
    case paused
}

// MARK: - The router

/// Drives the whole running surface. Owns only presentation state — which
/// page, whether controls are showing, which confirm is open. Everything
/// factual comes from the engine and the tracker.
@MainActor
final class WatchRouterV5: ObservableObject {

    /// Tap the running face to reach controls; tap elsewhere to dismiss.
    @Published var controlsShowing = false
    /// Which confirmation, if any, is open on top of controls.
    @Published var confirm: Confirm? = nil
    /// The running face's page. Persisted across a phase board so the
    /// muscle memory survives the interval.
    @Published var runPage: Int = 0
    /// Set when the coach asks something. Cleared only by an answer.
    @Published var pendingQuestion: WInterrupt? = nil

    enum Confirm: Equatable {
        case end
        case skipRep
    }

    /// What is on top of the running face right now, or nil for the face
    /// itself. Precedence is the enum's declaration order, deliberately.
    func interrupt(engine: WorkoutEngine, tracker: WorkoutTracker) -> WInterrupt? {
        if let q = pendingQuestion { return q }
        if tracker.isWaterLocked { return .waterLock }
        if let cue = engine.transition { return .moment(Self.moment(from: cue)) }
        if engine.isPaused { return .moment(.paused) }
        return nil
    }

    /// The engine already speaks in cues that match the design's moments, so
    /// this is a translation and not an interpretation. Heads-up carries a
    /// direction the cue does not: the engine's value is a distance or a time
    /// to the boundary, and whether the runner should ease off or pick it up
    /// comes from the live pace zone, not from the cue.
    static func moment(from cue: WorkoutEngine.TransitionCue) -> WMomentKind {
        switch cue {
        case .go(let rep, let target):        return .go(rep: rep, target: target)
        case .phase(let title, let sub):      return .phaseChange(title: title, sub: sub)
        case .split(let mileNo, let paceSec): return .split(mile: mileNo, paceSec: paceSec)
        case .fuel(let index, let total):     return .fuel(index: index, total: total)
        case .headsUp(let value):             return .headsUp(value: value, quicken: false)
        }
    }

    /// Pace zone → the one graded value on the face.
    ///
    /// A treadmill run NEVER grades: there is no trustworthy pace on a belt,
    /// and amber on a running face means one thing only. The caller passes
    /// `treadmill` and this returns `.treadmill` regardless of the zone.
    static func grade(_ zone: PaceZone, treadmill: Bool) -> FacePaceGrade {
        if treadmill { return .untrusted }
        return zone == .onTarget ? .inBand : .outOfBand
    }
}

// MARK: - The running surface

/// Everything from Start to the finish. The lobby and the summary are handled
/// by the existing root, which owns crash recovery and the treadmill bridge.
struct WatchRunSurfaceV5: View {
    @ObservedObject var engine: WorkoutEngine
    @ObservedObject var tracker: WorkoutTracker
    @StateObject private var router = WatchRouterV5()

    // ── The decision seam ───────────────────────────────────────────────
    //
    // The four wrist decisions and the two end verbs are CLOSURES rather than
    // direct engine calls. Not indirection for its own sake: the engine records
    // them onto the completion payload, and keeping the call site here means
    // this file does not have to move every time that recording API changes.
    // It also makes the router testable without an HKWorkoutSession.
    //
    // Defaults are deliberately inert. A decision that silently no-ops is a
    // bug, but a decision that silently does the WRONG thing is worse, and
    // these are wired in exactly one place.
    var onEndAndSave: () -> Void = {}
    var onDiscard: () -> Void = {}
    var onCeilingLift: (Int) -> Void = { _ in }
    var onRepSkip: (Int, Int) -> Void = { _, _ in }
    var onRecoveryExtend: (Int) -> Void = { _ in }
    var onDropGPS: () -> Void = {}

    /// A treadmill run is white throughout — no pace verdict at all, because
    /// the incline is unknown and the copy rules forbid an unfalsifiable claim.
    private var isTreadmill: Bool { tracker.distanceSourceUnavailable }

    /// What is unfinished, as a FACT rather than a warning — the runner may
    /// already have decided about it. nil on a steady run, which drops the
    /// line rather than finding something to say.
    private var unfinishedSummary: String? {
        let remaining = workPhases.filter { $0.index > (engine.currentPhase?.index ?? -1) }.count
        guard remaining > 0 else { return nil }
        return remaining == 1 ? "One rep unfinished" : "\(spelled(remaining)) reps unfinished"
    }

    /// The one confirmation that earns a coach sentence, because skipping a
    /// rep is the decision the coach has an opinion about. It gives the
    /// opinion, then honours either answer with no second ask.
    private var skipOpinion: String {
        let banked = repIndex - 1
        guard banked > 0 else {
            return "Nothing banked yet \(WatchV5.separator) this is the rep the session is built on."
        }
        let left = repCount - banked
        if left <= 2 {
            return "\(spelled(banked).capitalized) are banked \(WatchV5.separator) the last \(spelled(left)) are where the session earns its name."
        }
        return "\(spelled(banked).capitalized) are banked \(WatchV5.separator) \(spelled(left)) left to go."
    }

    /// Whole numbers up to twenty are spelled, which is the copy rule the
    /// server composes to as well.
    private func spelled(_ n: Int) -> String {
        let words = ["zero","one","two","three","four","five","six","seven","eight",
                     "nine","ten","eleven","twelve","thirteen","fourteen","fifteen",
                     "sixteen","seventeen","eighteen","nineteen","twenty"]
        return n >= 0 && n < words.count ? words[n] : String(n)
    }

    var body: some View {
        ZStack {
            // ── The face underneath ──────────────────────────────────────
            // Always present. A fault or a moment sits ON it, never instead
            // of it, so the run never stops being visible (rule 8).
            faceLayer

            // ── What is interrupting ─────────────────────────────────────
            if let interrupt = router.interrupt(engine: engine, tracker: tracker) {
                interruptLayer(interrupt)
                    .transition(.identity)   // rule 13: no motion
            }

            // ── Controls, reached by tapping the face ────────────────────
            if router.controlsShowing, router.confirm == nil {
                controlsLayer
            }
            if let confirm = router.confirm {
                confirmLayer(confirm)
            }
        }
        // Wrist down. Three values, no ticking second, and it takes the whole
        // screen because there is nothing else the runner can act on.
        .faffTracksLuminance(tracker)
    }

    // MARK: The face

    @ViewBuilder
    private var faceLayer: some View {
        if tracker.isLuminanceReduced {
            RunFaceAlwaysOn(
                pace: WFmt.pace(tracker.paceSPerMi) ?? "--",
                grade: WatchRouterV5.grade(engine.paceZone, treadmill: isTreadmill),
                distance: WFmt.miles(tracker.distanceMi),
                elapsedMinutes: String(max(0, engine.totalElapsedSec / 60))
            )
        } else if let phase = engine.currentPhase, isStructured(phase) {
            // Structured sessions swap the running face for the phase board
            // automatically at each change, announced by the Phase change
            // moment. The numbers below keep page 1's order.
            phaseBoard(phase)
                .contentShape(Rectangle())
                .onTapGesture { router.controlsShowing = true }
        } else {
            runningPages
                .contentShape(Rectangle())
                .onTapGesture { router.controlsShowing = true }
        }
    }

    /// Page 1 ◀▶ page 2. Tridots, and the page survives a phase board.
    private var runningPages: some View {
        TabView(selection: $router.runPage) {
            primaryPage.tag(0)
            performancePage.tag(1)
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
    }

    @ViewBuilder
    private var primaryPage: some View {
        if isTreadmill {
            RunFaceTreadmillPrimary(
                pace: WFmt.pace(tracker.paceSPerMi) ?? "--",
                distance: WFmt.miles(tracker.distanceMi),
                heartRate: WFmt.whole(tracker.heartRate) ?? "--",
                elapsed: WFmt.clock(engine.totalElapsedSec),
                pageIndex: 0, pageCount: 2
            )
        } else if tracker.heartRate <= 0 {
            // One slot broken, three untouched. Red names the SENSOR and
            // never renders a figure — a stale last-known number is worse
            // than none, because the runner cannot tell it has stopped.
            FaceHeartDropoutV5(
                pace: WFmt.pace(tracker.paceSPerMi) ?? "--",
                paceInBand: engine.paceZone == .onTarget && !isTreadmill,
                distance: WFmt.miles(tracker.distanceMi),
                elapsed: WFmt.clock(engine.totalElapsedSec)
            )
        } else {
            RunFacePrimary(
                pace: WFmt.pace(tracker.paceSPerMi) ?? "--",
                grade: WatchRouterV5.grade(engine.paceZone, treadmill: false),
                band: band(for: engine.currentPhase),
                heartRate: WFmt.whole(tracker.heartRate) ?? "--",
                distance: WFmt.miles(tracker.distanceMi),
                elapsed: WFmt.clock(engine.totalElapsedSec),
                pageIndex: 0, pageCount: 2
            )
        }
    }

    /// Page 2. Power and elevation DROP OUT when unavailable rather than
    /// drawing a placeholder — the board becomes three metrics, or two.
    private var performancePage: some View {
        RunFacePerformance(
            cadence: WFmt.whole(tracker.cadence) ?? "--",
            averagePace: WFmt.pace(averagePaceSPerMi) ?? "--",
            power: isTreadmill ? nil : WFmt.whole(tracker.powerWatts),
            elevation: isTreadmill ? nil : WFmt.elevation(tracker.elevGainM * 3.28084),
            pageIndex: 1, pageCount: 2
        )
    }

    /// Whole-run average, derived rather than sampled — the tracker's live
    /// pace is instantaneous and would read as an average that jitters.
    private var averagePaceSPerMi: Int? {
        guard tracker.distanceMi > 0.05, engine.totalElapsedSec > 0 else { return nil }
        return Int(Double(engine.totalElapsedSec) / tracker.distanceMi)
    }

    // MARK: Phase boards

    private func isStructured(_ phase: WatchPhase) -> Bool {
        switch phase.type {
        case .work, .recovery, .warmup: return true
        case .cooldown:                 return false
        }
    }

    @ViewBuilder
    private func phaseBoard(_ phase: WatchPhase) -> some View {
        let pace = WFmt.pace(tracker.paceSPerMi) ?? "--"
        let grade = WatchRouterV5.grade(engine.paceZone, treadmill: isTreadmill)

        switch phase.type {
        case .warmup:
            WPhaseWarmUp(
                remaining: WFmt.short(engine.phaseRemainingSec),
                pace: reading(pace, grade: grade, phase: phase),
                heartRate: WFmt.whole(tracker.heartRate)
            )
        case .recovery:
            // Extend recovery lives HERE, not in controls, because it is only
            // true for ninety seconds. The countdown stays live while the
            // buttons show — +30 sec adds to the number the runner is
            // watching, which is the whole reason it is drawn on this board.
            WPhaseRecovery(
                remaining: WFmt.short(engine.phaseRemainingSec),
                heartRate: WFmt.whole(tracker.heartRate),
                repIndex: repIndex, repCount: repCount
            )
        case .work:
            WPhaseWorkInterval(
                repIndex: repIndex, repCount: repCount,
                remaining: WFmt.short(engine.phaseRemainingSec),
                pace: reading(pace, grade: grade, phase: phase),
                heartRate: WFmt.whole(tracker.heartRate),
                distance: WFmt.miles(tracker.distanceMi)
            )
        case .cooldown:
            EmptyView()
        }
    }

    /// Which rep of how many. Derived from the engine's own phase list rather
    /// than stored, so it cannot drift from the cursor the engine is actually
    /// walking. Work phases only — a warm-up is not rep zero.
    private var workPhases: [WatchPhase] {
        engine.workout.phases.filter { $0.type == .work }
    }
    private var repCount: Int { max(1, workPhases.count) }
    private var repIndex: Int {
        guard let current = engine.currentPhase, current.type == .work else { return 1 }
        return (workPhases.firstIndex { $0.index == current.index } ?? 0) + 1
    }

    /// A figure plus the band it is being judged against. The gauge and the
    /// grade travel together deliberately: a board cannot say "green" and
    /// draw the mark outside the lit segment.
    private func reading(_ value: String, grade: FacePaceGrade, phase: WatchPhase) -> WBandReading {
        let b = band(for: phase)
        return WBandReading(
            value: value,
            inBand: grade == .inBand,
            bandStart: b?.start ?? 0.25,
            bandEnd: b?.end ?? 0.75,
            marker: b?.marker ?? 0.5
        )
    }

    /// The prescribed band, as fractions of the strip, or nil when the phase
    /// prescribes none. A band with no target is not a band.
    private func band(for phase: WatchPhase?) -> FaceBand? {
        guard let phase,
              let target = phase.targetPaceSPerMi, target > 0,
              let tol = phase.tolerancePaceSPerMi, tol > 0 else { return nil }
        let lo = Double(target - tol), hi = Double(target + tol)
        let span = max(1.0, (hi - lo) * 2.5)
        let origin = lo - (span - (hi - lo)) / 2
        func f(_ v: Double) -> Double { min(1, max(0, (v - origin) / span)) }
        let live = Double(tracker.paceSPerMi > 0 ? tracker.paceSPerMi : target)
        return FaceBand(start: f(lo), end: f(hi), marker: f(live))
    }

    // MARK: Interrupts

    @ViewBuilder
    private func interruptLayer(_ interrupt: WInterrupt) -> some View {
        switch interrupt {
        case .waterLock:
            // The run keeps recording, so the board's job is to prove it:
            // two moving numbers and the way out.
            FaceWaterLockV5(
                distance: WFmt.miles(tracker.distanceMi),
                elapsed: WFmt.clock(engine.totalElapsedSec)
            )
        case .moment(let kind):
            momentBoard(kind)
        case .bailOffered, .ceilingOverride, .lowBattery, .gpsAcquiring:
            questionBoard(interrupt)
        }
    }

    @ViewBuilder
    private func momentBoard(_ kind: WMomentKind) -> some View {
        switch kind {
        case .go:
            WMomentGo(session: sessionClass)
        case .phaseChange(let title, let sub):
            WMomentPhaseChange(word: title, detail: sub ?? "", band: nil)
        case .split(let mile, let paceSec):
            WMomentSplit(label: "Mile \(mile)", time: WFmt.pace(paceSec) ?? "--")
        case .fuel(let index, let total):
            WMomentFuel(index: index, total: total)
        case .headsUp(let value, let quicken):
            WMomentHeadsUp(
                direction: quicken ? .quicken : .easeOff,
                pace: WFmt.pace(tracker.paceSPerMi) ?? "--",
                band: value
            )
        case .paused:
            WMomentPaused(
                distance: WFmt.miles(tracker.distanceMi),
                elapsed: WFmt.clock(engine.totalElapsedSec),
                onResume: { engine.isPaused ? engine.resume() : engine.pause() },
                onEnd: { router.confirm = .end }
            )
        }
    }

    /// The session's ramp name, for the one moment that carries a colour
    /// field — Fuel, race only, because at mile 14 a lit panel is what gets
    /// seen.
    private var sessionClass: String {
        engine.workout.isRace ? "race" : (engine.workout.paceLabel ?? "easy")
    }

    /// The boards that WAIT. None of them dismisses itself, and each honours
    /// either answer with no second ask.
    @ViewBuilder
    private func questionBoard(_ interrupt: WInterrupt) -> some View {
        switch interrupt {
        case .ceilingOverride:
            FaceCeilingOverrideV5(
                bpm: WFmt.whole(tracker.heartRate) ?? "--",
                ceiling: WFmt.whole(engine.workout.hrCeilingBpm) ?? "--",
                onLiftForToday: {
                    onCeilingLift(tracker.heartRate)
                    router.pendingQuestion = nil
                },
                onEaseOff: { router.pendingQuestion = nil }
            )
        case .lowBattery:
            FaceLowBatteryV5(
                percent: tracker.batteryPercent ?? 0,
                projectedMinutes: tracker.batteryProjectedMinutes,
                onDropGPS: {
                    // The runner is choosing to trade the route for the run.
                    // Distance survives from motion; the polyline ends here,
                    // which is the honest outcome of the choice they made.
                    onDropGPS()
                    router.pendingQuestion = nil
                },
                onKeepItAll: { router.pendingQuestion = nil }
            )
        case .gpsAcquiring:
            FaceGPSAcquiringV5(onStart: { router.pendingQuestion = nil })
        default:
            EmptyView()
        }
    }

    // MARK: Controls

    private var controlsLayer: some View {
        // Inside a rep, Lap has no meaning — the session is already cutting
        // its own laps — so it becomes Skip rep in the SAME SLOT, and the
        // header names the rep, because Skip without that is a question the
        // runner cannot answer.
        FaceControlsV5(
            mode: engine.currentPhase?.type == .work ? .structured : .steady,
            header: controlsHeader,
            onLead: {
                if engine.currentPhase?.type == .work {
                    router.confirm = .skipRep
                } else {
                    // A steady run has no rep to end, so Lap closes the
                    // current segment the same way an auto-lap would.
                    engine.endCurrentPhase()
                    router.controlsShowing = false
                }
            },
            onPause: {
                engine.isPaused ? engine.resume() : engine.pause()
                router.controlsShowing = false
            },
            onEnd: { router.confirm = .end }
        )
        // Dismissed by tapping anything else — the design's own gesture.
        .contentShape(Rectangle())
        .onTapGesture { router.controlsShowing = false }
    }

    private var controlsHeader: String {
        if engine.currentPhase?.type == .work {
            return "\(engine.currentPhase?.label ?? "Rep") \(WatchV5.separator) \(WFmt.short(engine.phaseRemainingSec)) left"
        }
        let mile = Int(tracker.distanceMi) + 1
        return "Mile \(mile) \(WatchV5.separator) \(WFmt.clock(engine.totalElapsedSec))"
    }

    @ViewBuilder
    private func confirmLayer(_ confirm: WatchRouterV5.Confirm) -> some View {
        switch confirm {
        case .end:
            FaceEndConfirmV5(
                unfinished: unfinishedSummary,
                onEndAndSave: { onEndAndSave(); router.confirm = nil },
                onKeepRunning: { router.confirm = nil; router.controlsShowing = false },
                onDiscard: { onDiscard(); router.confirm = nil }
            )
        case .skipRep:
            // The one confirmation that earns a coach sentence, because it is
            // the decision the coach has an opinion about. It gives the
            // opinion, then honours either answer with no second ask and no
            // nag on the next rep.
            FaceSkipConfirmV5(
                repLabel: engine.currentPhase?.label ?? "this rep",
                coachLine: skipOpinion,
                onSkipAnyway: {
                    onRepSkip(repIndex, repCount)
                    router.confirm = nil
                    router.controlsShowing = false
                },
                onFinishIt: { router.confirm = nil; router.controlsShowing = false }
            )
        }
    }
}

// MARK: - The decision seam, as modifiers
//
// Kept as modifiers rather than initialiser arguments so the call site in
// WorkoutRootView reads as a list of what each verb DOES, rather than as a
// six-argument constructor where two closures of the same type can be
// transposed without the compiler noticing.

extension WatchRunSurfaceV5 {
    func onEndAndSave(_ action: @escaping () -> Void) -> Self {
        var copy = self; copy.onEndAndSave = action; return copy
    }
    func onDiscardRun(_ action: @escaping () -> Void) -> Self {
        var copy = self; copy.onDiscard = action; return copy
    }
    func onCeilingLift(_ action: @escaping (Int) -> Void) -> Self {
        var copy = self; copy.onCeilingLift = action; return copy
    }
    func onRepSkip(_ action: @escaping (Int, Int) -> Void) -> Self {
        var copy = self; copy.onRepSkip = action; return copy
    }
    func onRecoveryExtend(_ action: @escaping (Int) -> Void) -> Self {
        var copy = self; copy.onRecoveryExtend = action; return copy
    }
    func onDropGPS(_ action: @escaping () -> Void) -> Self {
        var copy = self; copy.onDropGPS = action; return copy
    }
}

// MARK: - Wire → lobby

/// Turns a `WatchWorkout` into the strings the lobby boards draw.
///
/// The boards take plain values on purpose, so this is the ONLY place that
/// knows both the wire's shape and the design's vocabulary. A board that
/// reached for `WatchWorkout` directly would have to learn what a null
/// `distanceMi` means, and that is not a design question.
enum WatchLobbyAdapter {

    /// The session's ramp — its identity across the whole product.
    static func ramp(for workout: WatchWorkout) -> V5LobbyRamp {
        if workout.isRace { return .race }
        switch (workout.paceLabel ?? "").uppercased() {
        case "T", "I", "R":  return .quality
        case "L":            return .long
        default:
            // `displayHint` distinguishes a long run from an easy one when the
            // pace label does not — a long run is paced like an easy one.
            return workout.displayHint == "pace" ? .long : .easy
        }
    }

    /// "6.0 mi" / "6 × 800 m". The dose is what goes when space runs out, so
    /// it is one short string and never a sentence.
    static func dose(for workout: WatchWorkout) -> String {
        if let mi = workout.distanceMi, mi > 0 {
            return WFmt.miles(mi) + " mi"
        }
        return "\(max(1, workout.totalEstimatedMinutes)) min"
    }

    /// The band line under the dose — the pace the session is asking for.
    /// nil when the session prescribes none, and the board then draws one
    /// fewer register rather than an empty one.
    static func band(for workout: WatchWorkout) -> String? {
        guard let phase = workout.phases.first(where: { $0.type == .work }),
              let target = phase.targetPaceSPerMi, target > 0,
              let base = WFmt.pace(target) else { return nil }
        guard let tol = phase.tolerancePaceSPerMi, tol > 0,
              let lo = WFmt.pace(target - tol), let hi = WFmt.pace(target + tol) else {
            return base + " /mi"
        }
        return "\(lo)–\(hi) /mi"
    }

    /// "9 DAYS OLD".
    ///
    /// Measured off the expiry the payload itself carries, because that is
    /// the only date on the wire that says which DAY this session was for.
    /// An unparseable expiry yields no kicker at all rather than a guessed
    /// age — a board that states a wrong number of days is worse than one
    /// that states none, and the rest of the board still says the plan is
    /// old.
    static func ageLabel(for workout: WatchWorkout) -> String {
        guard let expiry = WatchWorkout.parseExpiry(workout.expiresAt) else { return "OLD PLAN" }
        let days = Calendar.current.dateComponents([.day], from: expiry, to: .now).day ?? 0
        let n = max(1, days)
        return n == 1 ? "1 DAY OLD" : "\(n) DAYS OLD"
    }

    /// The session's steps, for the breakdown page. An empty list means the
    /// board is never drawn — an empty page is never drawn to even a count.
    static func steps(for workout: WatchWorkout) -> [V5LobbyStep] {
        workout.phases.map { phase in
            V5LobbyStep(
                name: phase.label,
                value: phase.repUnit == .distance && phase.distanceMi != nil
                    ? WFmt.miles(phase.distanceMi ?? 0) + " mi"
                    : WFmt.short(phase.durationSec),
                emphasised: phase.type == .work
            )
        }
    }

    /// The week strip. Done days are solid, today is lit, what is left is
    /// outlined — load, not seven rows of text.
    static func days(from strip: WatchWeekStrip) -> [V5LobbyDay] {
        strip.days.map { d in
            V5LobbyDay(
                letter: d.letter,
                miles: d.doneMi ?? d.plannedMi,
                state: d.state == "done" ? .done : (d.state == "today" ? .today : .planned)
            )
        }
    }
}

// MARK: - Lobby surface

/// Poster → breakdown → week. Pages exist only when they have something on
/// them: an empty page is never drawn to even a count.
struct WatchLobbySurfaceV5: View {
    let workout: WatchWorkout
    let weekStrip: WatchWeekStrip?
    let sessionMoved: WatchSessionMoved?
    let onStart: () -> Void

    private var steps: [V5LobbyStep] { WatchLobbyAdapter.steps(for: workout) }
    /// A single-phase session has nothing to break down, so it pages
    /// poster → week rather than drawing a one-row list.
    private var hasBreakdown: Bool { steps.count > 1 }
    private var pageCount: Int { 1 + (hasBreakdown ? 1 : 0) + (weekStrip != nil ? 1 : 0) }

    var body: some View {
        TabView {
            V5LobbyPoster(
                session: V5LobbySession(
                    ramp: WatchLobbyAdapter.ramp(for: workout),
                    lede: workout.name,
                    dose: WatchLobbyAdapter.dose(for: workout),
                    qualifier: workout.isRace ? WFmt.clock(workout.goalSec ?? 0) : nil,
                    band: WatchLobbyAdapter.band(for: workout),
                    // Readiness appears as a session that has ALREADY changed,
                    // with the reason stated once — never as a score, because
                    // a score on a lobby is a thing to argue with at 6am.
                    note: sessionMoved?.line
                ),
                pageCount: pageCount,
                pageIndex: 0,
                onStart: onStart
            )
            .tag(0)

            if hasBreakdown {
                V5LobbyBreakdown(
                    kicker: workout.isRace ? "The plan" : "The steps",
                    steps: steps,
                    pageCount: pageCount,
                    pageIndex: 1
                )
                .tag(1)
            }

            if let strip = weekStrip {
                V5LobbyWeek(
                    days: WatchLobbyAdapter.days(from: strip),
                    milesRun: WFmt.miles(strip.milesDone),
                    milesPlanned: WFmt.miles(strip.milesPlanned),
                    pageCount: pageCount,
                    pageIndex: pageCount - 1
                )
                .tag(2)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
    }
}

// MARK: - Finish surface

/// Complete → scroll → Summary. The only scrolling board in the app is the
/// summary, which is why it is the only one allowed more than four numbers.
struct WatchFinishSurfaceV5: View {
    @ObservedObject var engine: WorkoutEngine
    @ObservedObject var tracker: WorkoutTracker
    let onDone: () -> Void

    @State private var showingSummary = false

    private var distance: String { WFmt.miles(tracker.distanceMi) }
    private var duration: String { WFmt.clock(engine.totalElapsedSec) }
    private var pace: String {
        guard tracker.distanceMi > 0.05 else { return "--" }
        return WFmt.pace(Int(Double(engine.totalElapsedSec) / tracker.distanceMi)) ?? "--"
    }

    var body: some View {
        if showingSummary {
            FinishSummaryBoard(
                distance: distance,
                duration: duration,
                averages: averages,
                splits: splits,
                totals: totals
            )
        } else if engine.workout.isRace {
            // The clock is not the result, so it does not pose as one.
            FinishRaceCompleteBoard(
                raceName: engine.workout.name,
                watchTime: duration,
                goalComparison: goalComparison,
                onSave: { showingSummary = true }
            )
        } else {
            FinishCompleteBoard(
                session: WatchLobbyAdapter.ramp(for: engine.workout).rawValue,
                distance: distance,
                duration: duration,
                pace: pace,
                coachLine: "",
                onSave: { showingSummary = true }
            )
        }
    }

    /// "Under 3:29:59" / "Over 3:29:59". Under the goal, and nothing else —
    /// the coach's sentence can wait for the phone.
    private var goalComparison: String {
        guard let goal = engine.workout.goalSec, goal > 0 else { return "" }
        let verb = engine.totalElapsedSec <= goal ? "Under" : "Over"
        return "\(verb) \(WFmt.clock(goal))"
    }

    private var averages: [FinishSummaryRow] {
        var rows: [FinishSummaryRow] = [FinishSummaryRow("Pace", pace + " /mi")]
        if let hr = tracker.avgHr { rows.append(FinishSummaryRow("Heart", "\(hr) avg")) }
        if let cad = tracker.avgCadence { rows.append(FinishSummaryRow("Cadence", "\(cad) spm")) }
        return rows
    }

    private var splits: [FinishSummaryRow] {
        engine.splits.enumerated().compactMap { (i, split) -> FinishSummaryRow? in
            guard let p = WFmt.pace(split.paceSPerMi) else { return nil }
            return FinishSummaryRow("Mile \(i + 1)", p)
        }
    }

    /// Climb sits below the splits rather than in the averages group, so the
    /// first screenful still ends on a whole row — a sliced row reads as a
    /// bug rather than an invitation to scroll.
    private var totals: [FinishSummaryRow] {
        guard let climb = WFmt.elevation(tracker.elevGainM * 3.28084) else { return [] }
        return [FinishSummaryRow("Climb", climb + " ft")]
    }
}
