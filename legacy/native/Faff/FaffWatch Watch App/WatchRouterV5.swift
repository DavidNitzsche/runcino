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
import Combine

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

    // ── Units ────────────────────────────────────────────────────────────
    //
    // Every internal number stays in miles and seconds-per-mile — the engine,
    // the drift thresholds, the wire. ONLY this last formatting step converts,
    // which is the same rule WatchWorkout.mmssWithUnit already follows and the
    // reason a km runner's pace-drift maths is identical to a mi runner's.
    //
    // The unit STRING travels with the value, as a pair, because the boards
    // take a unit parameter and a value that arrived without its unit is how
    // a face ends up drawing kilometres labelled "mi".

    private static let milesPerKm = 0.621371

    /// True only for exactly "km" — anything else, including nil and any
    /// value a newer server invents, renders as miles. That is the same
    /// default every payload had before the field existed.
    static func isKm(_ pref: String?) -> Bool { pref == "km" }

    /// Distance, in the runner's unit, with the unit that matches it.
    static func distance(_ mi: Double, units: String?) -> (value: String, unit: String) {
        isKm(units) ? (miles(mi / milesPerKm), "km") : (miles(mi), "mi")
    }

    /// Pace, in the runner's unit. nil in, nil out — an absent pace is drawn
    /// as absent whatever the unit.
    static func paceWithUnit(_ secPerMi: Int?, units: String?) -> (value: String, unit: String)? {
        guard let s = secPerMi, s > 0, s < 3600 else { return nil }
        if isKm(units) {
            let perKm = max(0, Int((Double(s) * milesPerKm).rounded()))
            return ("\(perKm / 60):" + String(format: "%02d", perKm % 60), "/km")
        }
        return ("\(s / 60):" + String(format: "%02d", s % 60), "/mi")
    }

    /// Elevation. Feet in miles-land, metres in km-land — a runner who thinks
    /// in kilometres does not think in feet.
    static func elevation(_ metres: Double?, units: String?) -> (value: String, unit: String)? {
        guard let m = metres else { return nil }
        if isKm(units) {
            return ((m >= 0 ? "+" : "") + String(Int(m.rounded())), "m")
        }
        let ft = m * 3.28084
        return ((ft >= 0 ? "+" : "") + String(Int(ft.rounded())), "ft")
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
    /// The limit, named, with the number that broke it. Same grammar as a
    /// band crossing because it is the same class of event — it takes the
    /// screen and gives it back. The QUESTION that may follow is
    /// `.ceilingOverride`, which does not.
    case ceilingBreach
    /// The coach's line, drawn for the seconds it is spoken. RULE 10.
    case spokenCue(String)
    case moment(WMomentKind)
    case lowBattery
    case gpsAcquiring

    /// Whether this gives the screen back on its own. The two coach questions
    /// do NOT — they wait. Everything else is timed or condition-driven.
    var isSelfDismissing: Bool {
        switch self {
        case .bailOffered, .ceilingOverride: return false
        case .waterLock, .lowBattery, .gpsAcquiring: return false
        case .ceilingBreach, .spokenCue: return true
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
    /// The breach moment, which returns the screen on its own.
    @Published var ceilingBreachShowing = false
    /// The coach's line, while it is being said. Nil the rest of the time.
    @Published var spokenCueText: String? = nil
    /// Cue ids already said. A line is said once — repeating it is the nag
    /// the anti-nag rule forbids.
    var firedCueIds: Set<String> = []

    enum Confirm: Equatable {
        case end
        case skipRep
    }

    /// What is on top of the running face right now, or nil for the face
    /// itself. Precedence is the enum's declaration order, deliberately.
    func interrupt(engine: WorkoutEngine, tracker: WorkoutTracker) -> WInterrupt? {
        if let q = pendingQuestion { return q }
        if tracker.isWaterLocked { return .waterLock }
        if ceilingBreachShowing { return .ceilingBreach }
        if let cue = spokenCueText { return .spokenCue(cue) }
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
    static func grade(_ zone: PaceZone,
                      treadmill: Bool,
                      hasBand: Bool,
                      hasReading: Bool) -> FacePaceGrade {
        // NOTHING GRADES UNLESS SOMETHING GRADED IT.
        //
        // `paceZone` on the engine initialises to `.onTarget` and is assigned
        // ONLY inside a work phase that carries a target pace. So a warm-up, a
        // recovery, a cool-down and every session with no prescribed target
        // arrive here reading "on target" when nothing was ever compared, and
        // the old one-line map turned that into green.
        //
        // Green means the runner is inside the band the session asked for. It
        // is the only colour in this product that grades, and asserting it
        // over an unmeasured value is the single worst thing this file can do.
        // The design says it plainly on the Page 1 off-band note: white is a
        // plain measurement with no band to be inside of.
        //
        // Three ways to have nothing to say, and all three are white:
        //  · a belt, where there is no trustworthy pace at all
        //  · no band on this phase, so there is no inside to be on
        //  · no reading yet, in the first minute of every outdoor run
        if treadmill || !hasBand || !hasReading { return .untrusted }
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
    /// The battery board is offered once per run, not once per crossing —
    /// a percentage that flickers over the threshold must not re-ask.
    @State private var batteryOffered = false
    /// The ceiling question is asked at most once per run.
    @State private var ceilingAsked = false
    @State private var ceilingBreachTask: Task<Void, Never>? = nil
    /// The previous mile's split, so the next one can be compared to it.
    @State private var lastSplitSec: Int? = nil

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

    /// True when something opaque is drawn over the running face.
    private var isCovered: Bool {
        router.interrupt(engine: engine, tracker: tracker) != nil
            || router.controlsShowing
            || router.confirm != nil
    }

    /// The runner's distance unit, straight off the payload.
    private var units: String? { engine.workout.unitsDistance }
    private var dist: (value: String, unit: String) {
        WFmt.distance(tracker.distanceMi, units: units)
    }
    private var livePace: (value: String, unit: String) {
        WFmt.paceWithUnit(tracker.paceSPerMi, units: units) ?? ("--", WFmt.isKm(units) ? "/km" : "/mi")
    }
    /// Is there a live pace reading at all? "--" is not a slow pace.
    private var hasPaceReading: Bool { tracker.paceSPerMi > 0 }
    /// Does the phase in flight prescribe a band to be inside of?
    private var hasBand: Bool { band(for: engine.currentPhase) != nil }

    /// The one graded value on the face, with its evidence stated.
    private var paceGrade: FacePaceGrade {
        WatchRouterV5.grade(engine.paceZone,
                            treadmill: isTreadmill,
                            hasBand: hasBand,
                            hasReading: hasPaceReading)
    }

    /// What is unfinished, as a FACT rather than a warning — the runner may
    /// already have decided about it. nil on a steady run, which drops the
    /// line rather than finding something to say.
    private var unfinishedSummary: String? { engine.unfinishedSummary }

    /// The one confirmation that earns a coach sentence, because skipping a
    /// rep is the decision the coach has an opinion about. It gives the
    /// opinion, then honours either answer with no second ask.
    private var skipOpinion: String { engine.skipOpinion }

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
                // Rule 8 keeps the run VISIBLE under every fault and every
                // question, which is right. But nothing removed it from the
                // ACCESSIBILITY tree, so with a confirm sheet up VoiceOver
                // walked the covered board's numbers interleaved with the
                // three choices — and the last stop was "Discard it", a
                // full-width button that throws the run away. Rule 7 defends
                // that with fill weight, which is a purely visual defence:
                // to VoiceOver all three buttons are identical.
                .accessibilityHidden(isCovered)

            // ── What is interrupting ─────────────────────────────────────
            if let interrupt = router.interrupt(engine: engine, tracker: tracker) {
                interruptLayer(interrupt)
                    .transition(.identity)   // rule 13: no motion
            }

            // ── Controls, reached by tapping the face ────────────────────
            // Not on a recovery: that phase answers its own question on the
            // face (rule 11), and `controlsShowing` drives BOTH, so the
            // opaque controls board was covering the +30 sec board one layer
            // down. The seam was unreachable twice over.
            if router.controlsShowing,
               router.confirm == nil,
               engine.currentPhase?.type != .recovery {
                controlsLayer
            }
            if let confirm = router.confirm {
                confirmLayer(confirm)
            }
        }
        // Wrist down. Three values, no ticking second, and it takes the whole
        // screen because there is nothing else the runner can act on.
        .faffTracksLuminance(tracker)
        .onDisappear {
            // The ceiling task sleeps 3s + 60s before writing @Published
            // state. Without this it outlives the run by over a minute,
            // retains the router, engine and tracker, and can raise the
            // ceiling question on a surface that no longer exists.
            ceilingBreachTask?.cancel()
            ceilingBreachTask = nil
        }

        // ── What raises a question ───────────────────────────────────────
        //
        // Each of these fires ONCE and then stops asking. `pendingQuestion`
        // is cleared only by an answer, never by a timer, because these are
        // the two shapes in the app that wait — and a battery board that
        // re-raised itself every thirty seconds would be the nag the anti-nag
        // rule exists to prevent.
        .onChange(of: engine.hrOverCeiling) { _, over in
            guard over, !engine.ceilingLifted, router.pendingQuestion == nil else { return }
            // The BREACH first: the limit, named, with the number that broke
            // it. It takes the screen and gives it back, like a band crossing.
            router.ceilingBreachShowing = true
            Haptics.play(moment: .ceilingBreach)
            ceilingBreachTask?.cancel()
            ceilingBreachTask = Task {
                try? await Task.sleep(for: .seconds(3))
                guard !Task.isCancelled else { return }
                router.ceilingBreachShowing = false
                // Then, only if the runner is STILL over it, the question —
                // because a limit stated once is information and a limit
                // stated twice with no way to answer is the alert they learn
                // to swipe. Offered once per run.
                try? await Task.sleep(for: .seconds(60))
                guard !Task.isCancelled,
                      engine.hrOverCeiling,
                      !engine.ceilingLifted,
                      !ceilingAsked,
                      router.pendingQuestion == nil else { return }
                ceilingAsked = true
                router.pendingQuestion = .ceilingOverride
                Haptics.play(moment: .ceilingOverride)
            }
        }
        // Observe the EVIDENCE, not the eligibility flag. `canOfferBail` is
        // true from the moment the run starts, and `onChange` does not fire on
        // first evaluation — so the only edge it ever saw was true→false, and
        // the entire bail feature was one dead observer away from working.
        .onChange(of: engine.milesAdrift) { _, _ in
            guard engine.canOfferBail, engine.shouldOfferBailNow, router.pendingQuestion == nil else { return }
            router.pendingQuestion = .bailOffered
            Haptics.play(moment: .bailOffered)
        }
        .onChange(of: tracker.distanceMi) { _, _ in fireDueCue() }
        .onChange(of: engine.currentIndex) { _, _ in fireDueCue() }
        .onChange(of: tracker.batteryPercent) { _, pct in
            // 15% is the threshold, and the board is offered once. Below it
            // the run still records — no sensor blocks the run — so this is
            // an offer to spend less, not a warning to act on.
            guard let pct, pct <= 15, !batteryOffered, router.pendingQuestion == nil else { return }
            batteryOffered = true
            router.pendingQuestion = .lowBattery
            Haptics.play(moment: .conditionNotice)
        }
    }

    /// Say the next cue that has come due, if any, and draw it for its hold.
    ///
    /// One at a time and once each: `firedCueIds` is checked before the trigger
    /// so a distance that oscillates across a mile marker cannot say the same
    /// line twice. A cue never interrupts a question — the coach does not talk
    /// over their own asking.
    private func fireDueCue() {
        guard router.pendingQuestion == nil,
              router.spokenCueText == nil,
              let cues = engine.workout.spokenCues else { return }
        guard let due = cues.first(where: { cue in
            guard cue.isDrawable, !router.firedCueIds.contains(cue.id) else { return false }
            switch cue.trigger {
            case "distance":
                guard let at = cue.atMi else { return false }
                return tracker.distanceMi >= at
            case "phase":
                guard let idx = cue.phaseIndex else { return false }
                return engine.currentIndex >= idx
            case "fraction":
                guard let f = cue.atFraction, let total = engine.workout.distanceMi, total > 0 else { return false }
                return tracker.distanceMi >= total * f
            default:
                return false
            }
        }) else { return }

        router.firedCueIds.insert(due.id)
        router.spokenCueText = due.text
        Haptics.play(moment: .coachLine)
        Task {
            try? await Task.sleep(for: .seconds(max(2, due.holdSec)))
            router.spokenCueText = nil
        }
    }

    // MARK: The face

    @ViewBuilder
    private var faceLayer: some View {
        if tracker.isLuminanceReduced {
            AlwaysOnFaceV6(
                pace: livePace.value,
                paceUnit: livePace.unit,
                grade: paceGrade.workoutGrade,
                distance: dist.value,
                distanceUnit: dist.unit,
                elapsedMinutes: String(max(0, engine.totalElapsedSec / 60))
            )
        } else if let phase = engine.currentPhase, phase.type == .recovery, router.controlsShowing {
            // RULE 11 · anything the runner can answer is answered where it is
            // asked. Extend recovery lives on the recovery face rather than in
            // controls, because it is only true for ninety seconds — and the
            // countdown stays LIVE while the buttons show, so +30 sec adds to
            // the number the runner is watching. That is the whole reason the
            // design draws it here.
            //
            // This seam was declared, exposed as a modifier and wired at the
            // call site, and nothing ever called it. A dead seam reads as
            // finished work from every angle except the runner's.
            FaceExtendRecoveryV5(
                secondsRemaining: engine.recoveryRemainingSec,
                onAddThirty: {
                    engine.recordRecoveryExtension(addedSec: 30)
                    onRecoveryExtend(30)
                },
                onGoNow: {
                    engine.endCurrentPhase()
                    router.controlsShowing = false
                }
            )
            .contentShape(Rectangle())
            .onTapGesture { router.controlsShowing = false }
        } else if engine.planComplete {
            // OVERTIME. The plan is done and the runner is still going.
            //
            // `advance()` resets phaseElapsedSec and phaseStart but does NOT
            // move currentIndex, so the phase board kept drawing the LAST rep
            // with a fresh countdown and an empty progress strip — "Rep 4 / 4"
            // restarting after a 4x1mi session. The engine's comment says the
            // live face "already signals overtime by flipping the distance row
            // to bonus purple", which was true of the retired ActiveWorkoutView
            // and of nothing in the 0821 boards.
            //
            // So: the plain running face, not a phase board. There is no rep
            // to be inside of any more, and the design has no overtime board —
            // it has a session that ended and a runner who kept running, which
            // is exactly what Page 1 already draws.
            runningPages
                .contentShape(Rectangle())
                .onTapGesture { router.controlsShowing = true }
        } else if let phase = engine.currentPhase, isStructured(phase) {
            // Structured sessions swap the running face for the phase board
            // automatically at each change, announced by the Phase change
            // moment. The numbers below keep page 1's order.
            phaseBoard(phase)
                .contentShape(Rectangle())
                .onTapGesture { router.controlsShowing = true }
                // A bare onTapGesture creates no accessibility element and no
                // action, so VoiceOver's double-tap had nothing to activate —
                // which would mean Pause, Lap and End run had no reachable
                // entry point at all during a run.
                .accessibilityAction(.default) { router.controlsShowing = true }
                .accessibilityLabel("Controls")
                .accessibilityHint("Pause, lap or end the run")
        } else {
            runningPages
                .contentShape(Rectangle())
                .onTapGesture { router.controlsShowing = true }
                // A bare onTapGesture creates no accessibility element and no
                // action, so VoiceOver's double-tap had nothing to activate —
                // which would mean Pause, Lap and End run had no reachable
                // entry point at all during a run.
                .accessibilityAction(.default) { router.controlsShowing = true }
                .accessibilityLabel("Controls")
                .accessibilityHint("Pause, lap or end the run")
        }
    }

    /// Page 1 ◀▶ page 2. Tridots, and the page survives a phase board.
    /// Page 1 and page 2, on the native foundation.
    ///
    /// VERTICAL paging, Crown-navigable, per the 2026-08-23 ruling: watchOS
    /// puts the indicator beside the Crown and Apple's own guidance is that
    /// vertical is "more effective than horizontal pagination" here. The
    /// tridots the 0821 design drew at the bottom are gone with the gesture
    /// they belonged to.
    private var runningPages: some View {
        TabView(selection: $router.runPage) {
            primaryPage.tag(0)
            performancePage.tag(1)
        }
        .tabViewStyle(.verticalPage)
    }

    @ViewBuilder
    private var primaryPage: some View {
        RunFaceV6(
            pace: livePace.value,
            paceUnit: livePace.unit,
            grade: paceGrade.workoutGrade,
            band: workoutBand,
            // nil NAMES the sensor on the board rather than drawing a dash.
            // True on a belt too — a missing strap is a missing strap.
            heartRate: tracker.heartRate > 0 ? WFmt.whole(tracker.heartRate) : nil,
            distance: dist.value,
            distanceUnit: dist.unit,
            elapsed: WFmt.clock(engine.totalElapsedSec)
        )
    }

    private var performancePage: some View {
        PerfFaceV6(
            cadence: WFmt.whole(tracker.cadence) ?? "--",
            averagePace: WFmt.paceWithUnit(averagePaceSPerMi, units: units)?.value ?? "--",
            averagePaceUnit: WFmt.isKm(units) ? "/km" : "/mi",
            power: isTreadmill ? nil : WFmt.whole(tracker.powerWatts),
            elevation: isTreadmill ? nil : WFmt.elevation(tracker.elevGainM, units: units)?.value,
            elevationUnit: WFmt.isKm(units) ? "m" : "ft"
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

    /// Every structured phase, on the native foundation.
    ///
    /// One board shape, not six. The phase is named once in a fixed slot and
    /// the telemetry under it keeps page 1's order, so when the board swaps
    /// mid-session the only thing that moved is the word.
    private func phaseBoard(_ phase: WatchPhase) -> some View {
        let m = phaseMetrics(phase)
        return PhaseFaceV6(
            phase: phaseName(phase),
            context: phaseContext(phase),
            band: workoutBand,
            // DERIVED, never a constant. The graded metric is on row 1 in a
            // work or warm-up phase, row 0 in a race, and on no row at all in
            // a recovery. A literal here would have drawn the gauge under the
            // countdown on five of the six boards.
            bandRow: m.firstIndex { $0.role == "Pace" } ?? 0,
            metrics: m
        )
    }

    /// The prescribed band in the shape the foundation draws, or nil.
    ///
    /// Rule 7 of the build standard: a graded metric needs its band. The V6
    /// port carried `paceGrade` across and left this behind, so the running
    /// faces coloured the pace and never said what it was being coloured
    /// against. It survived review because the preview harness supplied a
    /// band by hand — the screenshots were right about a screen that did not
    /// exist.
    ///
    /// nil when the phase prescribes no target, and nil on a belt, where
    /// there is no trustworthy pace to put a mark on.
    private var workoutBand: (start: Double, end: Double, marker: Double, inBand: Bool)? {
        guard !isTreadmill, let b = band(for: engine.currentPhase) else { return nil }
        return (start: b.start, end: b.end, marker: b.marker,
                inBand: paceGrade == .inBand)
    }

    private func phaseName(_ phase: WatchPhase) -> String {
        if engine.workout.isRace { return raceMileLabel }
        switch phase.type {
        case .warmup:   return "Warm-up"
        case .recovery: return "Recovery"
        case .cooldown: return "Cool-down"
        case .work:
            if isStrides(phase) { return "Strides" }
            if isThreshold(phase) { return "Threshold" }
            return "Work"
        }
    }

    /// The count only. The clock used to share this line and is now the lead
    /// metric on the board, because it is the number the runner is actually
    /// watching during a rep.
    private func phaseContext(_ phase: WatchPhase) -> String? {
        if engine.workout.isRace { return raceGoalLabel }
        guard phase.type == .work else { return nil }
        return "\(repIndex) of \(repCount)"
    }

    /// WHICH numbers, in what order. The only genuinely product decision on
    /// these boards — everything else belongs to the foundation.
    private func phaseMetrics(_ phase: WatchPhase) -> [WorkoutMetric] {
        let hr = WFmt.whole(tracker.heartRate)
        let paced = WorkoutMetric(value: livePace.value, unit: livePace.unit,
                                  grade: paceGrade.workoutGrade, role: "Pace")

        switch phase.type {
        case .recovery:
            // No pace. A recovery is not asking for one, and drawing a number
            // nobody is being held to is how a board starts lying.
            var m: [WorkoutMetric] = [
                WorkoutMetric(value: WFmt.short(engine.phaseRemainingSec), role: "Time left")
            ]
            if let hr { m.append(WorkoutMetric(value: hr, unit: "bpm", role: "Heart rate")) }
            return m

        case .warmup, .cooldown:
            var m = [WorkoutMetric(value: WFmt.short(engine.phaseRemainingSec), role: "Time left"), paced]
            if let hr { m.append(WorkoutMetric(value: hr, unit: "bpm", role: "Heart rate")) }
            m.append(WorkoutMetric(value: dist.value, unit: dist.unit, role: "Distance"))
            return m

        case .work:
            if engine.workout.isRace {
                var m = [paced]
                if let d = onGoalDelta {
                    // No unit. "on goal" is seven characters and would set the
                    // size ceiling for the whole column — a long word beside a
                    // figure is a label, which this design does not have. The
                    // sign carries the meaning and the header says the goal.
                    m.append(WorkoutMetric(value: d, role: "Against goal"))
                }
                m.append(WorkoutMetric(value: dist.value, unit: dist.unit, role: "Distance"))
                m.append(WorkoutMetric(value: WFmt.clock(engine.totalElapsedSec), role: "Elapsed"))
                return m
            }
            if isStrides(phase) {
                // A STRIDE DOES NOT SHOW PACE.
                //
                // It is fifteen to twenty-five seconds of near-maximum
                // turnover, and GPS pace over that window is mostly lag: the
                // figure peaks after the stride has ended. Drawing it invites
                // the runner to chase a number that is describing the previous
                // ten seconds.
                //
                // Cadence is what a stride is actually for, it responds
                // instantly, and it is the one the runner can act on. No band
                // either — the plan prescribes no pace target for a stride, so
                // `band(for:)` returns nil and nothing here needs to force it.
                var m = [WorkoutMetric(value: WFmt.short(engine.phaseRemainingSec),
                                       role: "Time left in stride")]
                if let c = WFmt.whole(tracker.cadence) {
                    m.append(WorkoutMetric(value: c, unit: "spm", role: "Cadence"))
                }
                if let hr { m.append(WorkoutMetric(value: hr, unit: "bpm", role: "Heart rate")) }
                return m
            }
            var m = [WorkoutMetric(value: WFmt.short(engine.phaseRemainingSec), role: "Time left in rep"), paced]
            if isThreshold(phase),
               let avg = WFmt.paceWithUnit(averagePaceSPerMi, units: units) {
                // Average pace earns a row on a threshold block and nowhere
                // else: that block is judged over its length, not instant by
                // instant.
                m.append(WorkoutMetric(value: avg.value, unit: "avg", role: "Average pace"))
            }
            if let hr { m.append(WorkoutMetric(value: hr, unit: "bpm", role: "Heart rate")) }
            let rep = WFmt.distance(engine.phaseCoveredMi, units: units)
            m.append(WorkoutMetric(value: rep.value, unit: rep.unit, role: "Rep distance"))
            return m
        }
    }

    /// The wire DOES say so — `isStrideSegment`, carried since
    /// DOCTRINE-STRIDES-1 and undecoded until 2026-08-23. The label match
    /// stays as a fallback for payloads written before the flag, but the flag
    /// is the evidence: routing on prose meant renaming "Stride 3 of 6"
    /// anywhere upstream would have silently retired the board.
    private func isStrides(_ phase: WatchPhase) -> Bool {
        phase.isStrideSegment || phase.label.lowercased().contains("stride")
    }

    /// Threshold and tempo blocks. `paceLabel` is the plan's own zone tag, so
    /// it is preferred; the label is the fallback for payloads that omit it.
    private func isThreshold(_ phase: WatchPhase) -> Bool {
        if (engine.workout.paceLabel ?? "").uppercased() == "T" { return true }
        let l = phase.label.lowercased()
        return l.contains("threshold") || l.contains("tempo") || l.contains("cruise")
    }

    /// "Mile 9" — where the runner is, not which phase index they are in.
    private var raceMileLabel: String {
        let n = Int(tracker.distanceMi) + 1
        return (WFmt.isKm(units) ? "Km " : "Mile ") + String(n)
    }

    /// "sub 3:30". Absent when the race carries no goal, so the register
    /// drops rather than drawing a zero.
    private var raceGoalLabel: String? {
        guard let g = engine.workout.goalSec, g > 0 else { return nil }
        return "sub " + WFmt.clock(g)
    }

    /// "−0:22" against the goal pace, signed. nil until there is enough
    /// distance to say anything — a delta off the first hundred metres is
    /// noise, and drawing it would be a claim the run cannot support.
    private var onGoalDelta: String? {
        guard let goal = engine.workout.goalSec, goal > 0,
              let total = engine.workout.distanceMi, total > 0,
              tracker.distanceMi >= 0.5 else { return nil }
        let goalPace = Double(goal) / total
        let projected = Double(engine.totalElapsedSec) / tracker.distanceMi
        let deltaSec = Int(((projected - goalPace) * total).rounded())
        let sign = deltaSec <= 0 ? "\u{2212}" : "+"
        return sign + WFmt.short(abs(deltaSec))
    }

    /// Which rep of how many. Derived from the engine's own phase list rather
    /// than stored, so it cannot drift from the cursor the engine is actually
    /// walking. Work phases only — a warm-up is not rep zero.
    private var workPhases: [WatchPhase] {
        engine.workout.phases.filter { $0.type == .work }
    }
    /// Prefer the engine's own cursor over re-deriving it. Two counts of the
    /// same thing is how a board ends up saying "rep 3 of 6" while the engine
    /// is running rep 4.
    private var repCount: Int { max(1, engine.repCountForDisplay) }
    private var repIndex: Int { max(1, engine.repIndexForDisplay) }

    /// "8:15–8:45 /mi" — the band the phase prescribes, as words. nil when
    /// there is none, and the board then has nothing to announce.
    /// The prescribed band, split into figure and unit.
    ///
    /// SPLIT because `WMomentPhaseChange` draws the two at different weights —
    /// the figure in band green, the unit at 62% of it — and it appends the
    /// unit itself. Handing it a string that already ended in one drew
    /// "6:45–7:00 /mi /mi" on every work-rep boundary of every interval
    /// session. Invisible in review because the preview fixture passed a band
    /// with no unit, so the harness showed a board the router never produced.
    private var bandParts: (value: String, unit: String)? {
        guard let phase = engine.currentPhase,
              let target = phase.targetPaceSPerMi, target > 0,
              let tol = phase.tolerancePaceSPerMi, tol > 0,
              let quick = WFmt.paceWithUnit(target - tol, units: units),
              let steady = WFmt.paceWithUnit(target + tol, units: units) else { return nil }
        return ("\(quick.value)–\(steady.value)", quick.unit)
    }

    /// The band as one sentence-ready string, for the boards that compose it
    /// into prose ("Band is 6:45–7:00 /mi") rather than typesetting it.
    private var bandLabel: String? {
        bandParts.map { "\($0.value) \($0.unit)" }
    }

    // `reading(_:grade:phase:)` and its `WBandReading` return type were
    // deleted with the V5 phase boards they fed. The function was still
    // defined here and called from nowhere.


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
        case .ceilingBreach:
            FaceCeilingBreachV5(
                bpm: WFmt.whole(tracker.heartRate) ?? "--",
                ceiling: WFmt.whole(engine.workout.hrCeilingBpm) ?? "--"
            )
        case .spokenCue(let text):
            // The coach's line in its own register with NOTHING else on the
            // board. The orange kicker marks WHO is talking, not how it is
            // going — the one place orange appears mid-run.
            FaceSpokenCueV5(line: text)
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
            WMomentPhaseChange(word: title, detail: sub ?? "",
                               band: bandParts?.value,
                               bandUnit: bandParts?.unit ?? livePace.unit)
        case .split(let mile, let paceSec):
            let _ = recordSplit(paceSec)
            WMomentSplit(
                label: (WFmt.isKm(units) ? "Km " : "Mile ") + String(mile),
                time: WFmt.short(paceSec),
                comparison: splitComparison(paceSec)
            )
        case .fuel(let index, let total):
            // PERSISTENT by design — at mile 14 a lit panel is what gets seen,
            // so it does not time out. But `dismissTransition()` had no caller
            // anywhere in the V5 boards, and WBoard's ground is opaque and
            // hit-testable, so the takeover swallowed the tap-to-controls
            // gesture. The runner could not pause, could not end the run and
            // could not see pace until the next phase boundary — up to 52
            // minutes on a long segment, and forever on a single-phase race.
            WMomentFuel(index: index, total: total)
                .contentShape(Rectangle())
                .onTapGesture { engine.dismissTransition() }
        case .headsUp(_, _):
            // The engine's cue payload is the DISTANCE REMAINING to the
            // boundary, not a band. Passing it through drew "BAND IS 0.2"
            // under an "Ease off" verb — a sentence that is not true, in
            // amber, on a board whose whole job is to name the band the
            // runner has left.
            //
            // The band comes from the phase, and the direction from which
            // side of it the runner is on. Both are known here; neither was
            // being used.
            WMomentHeadsUp(
                direction: engine.paceDeltaSPerMi < 0 ? .easeOff : .quicken,
                pace: livePace.value,
                paceUnit: livePace.unit,
                // nil, never a unit standing in for a band. The fallback used
                // to be `livePace.unit`, which drew the sentence "Band is /mi".
                band: bandLabel
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

    /// Remember this split so the next one has something to compare against.
    /// `lastSplitSec` was declared and never assigned, so the comparison
    /// register never once appeared.
    private func recordSplit(_ paceSec: Int) -> Int {
        DispatchQueue.main.async { lastSplitSec = paceSec }
        return paceSec
    }

    /// "4 sec quicker" against the previous split, or nil for the first one
    /// and for a difference too small to be a fact rather than noise.
    private func splitComparison(_ paceSec: Int) -> String? {
        guard let prev = lastSplitSec else { return nil }
        let delta = paceSec - prev
        guard abs(delta) >= 3 else { return nil }
        return "\(abs(delta)) sec " + (delta < 0 ? "quicker" : "slower")
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
        case .bailOffered:
            // Evidence quietly first, then the judgement in the coach's own
            // register, then two verbs. "Cut it short" leads on fill — not
            // because it is the recommendation, but because it is the one the
            // runner will not press by themselves, and a coach that only ever
            // offers the brave option is not offering anything.
            FaceBailOfferedV5(
                evidence: engine.bailEvidence,
                judgement: engine.bailJudgement,
                onCutItShort: {
                    engine.recordBail(taken: true)
                    router.pendingQuestion = nil
                    // Taking it is not a failed run, it is a shorter one, and
                    // the run detail will say so.
                    engine.finish(save: true)
                },
                onRunItOut: {
                    engine.recordBail(taken: false)
                    router.pendingQuestion = nil
                }
            )
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
            // Only ever called inside a rep: a steady run draws no lead verb,
            // because the one it used to draw was Lap and Lap changed nothing
            // the runner could see. See WControlsMode.
            onLead: { router.confirm = .skipRep },
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
                // "Skip rep 4", not "INTERVAL 4/5". The board's whole
                // argument is that Skip without a named rep is a question the
                // runner cannot answer, and the phase label is not that name.
                repLabel: "Skip rep \(repIndex)",
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
            let d = WFmt.distance(mi, units: workout.unitsDistance)
            return d.value + " " + d.unit
        }
        return "\(max(1, workout.totalEstimatedMinutes)) min"
    }

    /// The band line under the dose — the pace the session is asking for.
    /// nil when the session prescribes none, and the board then draws one
    /// fewer register rather than an empty one.
    static func band(for workout: WatchWorkout) -> String? {
        // Units-aware, like every other surface. This was the one place that
        // appended a literal " /mi", so a km runner's lobby showed mile pace
        // while their running face showed kilometres.
        let u = workout.unitsDistance
        guard let phase = workout.phases.first(where: { $0.type == .work }),
              let target = phase.targetPaceSPerMi, target > 0,
              let base = WFmt.paceWithUnit(target, units: u) else { return nil }
        // FASTER END FIRST. For pace a bigger clock is a SLOWER runner, so
        // `target - tol` is the quick edge and `target + tol` is the slow one.
        // Naming them lo/hi by arithmetic rather than by meaning printed the
        // band backwards — "6:41-6:21" — which reads as a range that runs the
        // wrong way and was on screen for one commit.
        guard let tol = phase.tolerancePaceSPerMi, tol > 0,
              let quick = WFmt.paceWithUnit(target - tol, units: u),
              let steady = WFmt.paceWithUnit(target + tol, units: u) else {
            return base.value + " " + base.unit
        }
        return "\(quick.value)–\(steady.value) \(quick.unit)"
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
                    // Race morning's third register is the GOAL, in the band
                    // slot with its word — "Goal 3:29:59" — not a bare clock
                    // in the qualifier slot the design reserves for a closing
                    // instruction. A race with no goal drops the register
                    // rather than drawing 0:00.
                    qualifier: nil,
                    band: workout.isRace
                        ? (workout.goalSec.map { "Goal " + WFmt.clock($0) })
                        : WatchLobbyAdapter.band(for: workout),
                    bandSub: workout.isRace ? WatchLobbyAdapter.band(for: workout) : nil,
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

    private var units: String? { engine.workout.unitsDistance }
    private var dist: (value: String, unit: String) {
        WFmt.distance(tracker.distanceMi, units: units)
    }
    private var distance: String { dist.value }
    private var duration: String { WFmt.clock(engine.totalElapsedSec) }
    private var pace: String {
        guard tracker.distanceMi > 0.05 else { return "--" }
        let secPerMi = Int(Double(engine.totalElapsedSec) / tracker.distanceMi)
        guard let p = WFmt.paceWithUnit(secPerMi, units: units) else { return "--" }
        return p.value + " " + p.unit
    }

    var body: some View {
        if showingSummary {
            FinishSummaryBoard(
                distance: distance,
                distanceUnit: dist.unit,
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
                distanceUnit: dist.unit,
                duration: duration,
                pace: pace,
                coachLine: completeLine,
                onSave: { showingSummary = true }
            )
        }
    }

    /// One line of judgement on the run. Says what the session was FOR when
    /// the watch can stand behind it, and says nothing when it cannot —
    /// silence over an unfalsifiable claim, which on this board means the
    /// phone's summary gets the last word instead.
    private var completeLine: String {
        if engine.workout.phases.contains(where: { $0.type == .work && $0.targetPaceSPerMi != nil }) {
            return "That is the session. The rest is on the phone."
        }
        return "Logged. The rest is on the phone."
    }

    /// "Under 3:29:59" / "Over 3:29:59". Under the goal, and nothing else —
    /// the coach's sentence can wait for the phone.
    /// "Under 3:29:59". Empty when the race carries no goal — the board then
    /// draws one fewer register rather than an empty 16pt line.
    private var goalComparison: String {
        guard let goal = engine.workout.goalSec, goal > 0 else { return "" }
        let verb = engine.totalElapsedSec <= goal ? "Under" : "Over"
        return "\(verb) \(WFmt.clock(goal))"
    }

    private var averages: [FinishSummaryRow] {
        var rows: [FinishSummaryRow] = [FinishSummaryRow("Pace", pace)]
        if let hr = tracker.avgHr { rows.append(FinishSummaryRow("Heart", "\(hr) avg")) }
        if let cad = tracker.avgCadence { rows.append(FinishSummaryRow("Cadence", "\(cad) spm")) }
        return rows
    }

    private var splits: [FinishSummaryRow] {
        // "Mile" vs "Km" — the row label follows the unit, because a row
        // reading "Mile 3 · 4:03/km" is two different units in one sentence.
        // A structured session's splits are one row per WORK REP, so calling
        // them miles reads "Mile 1 - 6:31" for a seven-minute threshold rep.
        let hasReps = engine.workout.phases.filter { $0.type == .work }.count > 1
        let noun = hasReps ? "Rep" : (WFmt.isKm(units) ? "Km" : "Mile")
        return engine.splits.enumerated().compactMap { (i, split) -> FinishSummaryRow? in
            guard let p = WFmt.paceWithUnit(split.paceSPerMi, units: units) else { return nil }
            return FinishSummaryRow("\(noun) \(i + 1)", p.value)
        }
    }

    /// Climb sits below the splits rather than in the averages group, so the
    /// first screenful still ends on a whole row — a sliced row reads as a
    /// bug rather than an invitation to scroll.
    private var totals: [FinishSummaryRow] {
        guard let climb = WFmt.elevation(tracker.elevGainM, units: units) else { return [] }
        return [FinishSummaryRow("Climb", climb.value + " " + climb.unit)]
    }
}

// MARK: - Recovery receipt

/// What a recovered run's END & SAVE lands on. The same summary board the
/// normal finish uses, because a run that survived a crash is still a run and
/// deserves the same receipt — the only difference is that its numbers come
/// from the recovered completion rather than from a live engine.
struct WatchRecoveryReceiptV5: View {
    let summary: WatchRootModel.RecoverySummary
    let onDone: () -> Void

    var body: some View {
        FinishSummaryBoard(
            distance: WFmt.miles(summary.completion.totalDistanceMi ?? 0),
            duration: WFmt.clock(summary.completion.totalDurationSec),
            averages: averages,
            splits: [],
            totals: []
        )
        .onTapGesture(perform: onDone)
    }

    /// Splits are deliberately empty. A recovered run's per-mile detail is
    /// reconstructed server-side from the pace samples, and drawing an empty
    /// or partial ladder here would state something the watch does not know.
    private var averages: [FinishSummaryRow] {
        var rows: [FinishSummaryRow] = []
        if let mi = summary.completion.totalDistanceMi, mi > 0.05 {
            let sec = Double(summary.completion.totalDurationSec)
            if let p = WFmt.paceWithUnit(Int(sec / mi), units: nil) {
                rows.append(FinishSummaryRow("Pace", p.value + " " + p.unit))
            }
        }
        if let hr = summary.completion.avgHr { rows.append(FinishSummaryRow("Heart", "\(hr) avg")) }
        if let cad = summary.completion.avgCadence { rows.append(FinishSummaryRow("Cadence", "\(cad) spm")) }
        return rows
    }
}

// MARK: - Wall-clock helper

/// "7:11" — when a run actually started, from how long ago it was.
///
/// The recovered-run board leads with evidence that the run is really there,
/// and a duration labelled "ago" is not that evidence: it drew "FROM 41:02
/// AGO" beside a duration of 41:02, which is one number wearing two hats.
enum WatchRunStart {
    static func label(secondsAgo: Int) -> String {
        let started = Date().addingTimeInterval(-Double(max(0, secondsAgo)))
        let f = DateFormatter()
        f.locale = .current
        f.setLocalizedDateFormatFromTemplate("j:mm")
        return f.string(from: started)
    }
}
