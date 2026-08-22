//
//  Haptics.swift
//  FaffWatch
//
//  THE ONE TABLE. Every haptic this app can produce is named here, once:
//
//      moment  ──▶  feel  ──▶  WKHapticType
//
//  A caller names a MOMENT ("a mile went by"). It never names a texture, and
//  it never reaches WKInterfaceDevice itself. That is the whole point: the
//  bug this file exists to make impossible is a call site that fires the cue
//  for a different moment because the enum it had to hand was the wrong
//  vocabulary. (It has already happened — see the LEGACY section at the
//  bottom: WorkoutEngine fires `play(.transitionWork)` for a mile split and
//  `play(.transitionCooldown)` for a gel, because `WatchHaptic` is a wire
//  format describing PHASES and it got used as a palette of textures.)
//
//  The rule this table serves, from the approved watch design (handoff
//  § "Interactions & behaviour"):
//
//      Haptics carry every moment; the visual is the confirmation, not the
//      alert. A phase change and a split must not feel the same.
//
//  So: two moments share a texture ONLY where this file says so out loud, by
//  naming the same `Feel` with the reason written above it. Anything else is
//  a defect, and in DEBUG the first `play(moment:)` of a session asserts that
//  no two Feels have collapsed onto one WKHapticType.
//
//  NOTE · the haptic CODE runs in the simulator (where it is effectively a
//  no-op), but TIMING AND TEXTURE VALIDATION requires a physical Apple Watch
//  — "I knew it was time to slow down" vs. "I overran the interval by 15
//  seconds" can only be felt on the wrist. The allocations below are a first
//  pass to be tuned on-device; the places most likely to need it are marked
//  TUNE.
//
//  This file owns WHAT a moment feels like. It does not own WHEN one fires or
//  how long its board holds — that is the router's, and there is deliberately
//  no timer, no repeat loop and no delay anywhere below.
//

import WatchKit

enum Haptics {

    // MARK: - Feel · the sensations this app owns
    //
    // watchOS gives twelve usable textures and no way to author a custom one.
    // Their Apple-facing names are about notifications, navigation and task
    // outcomes; what reaches the wrist is a texture, not a name, and the
    // runner never learns Apple's word for it. So a few are used here purely
    // for how they feel, renamed for what they mean in this app. Where that
    // is the case it is said in the comment.
    //
    // The vocabulary is FULL: twelve feels, twelve types, nothing spare. A
    // new moment either joins one of the declared families below or it
    // displaces something — it cannot quietly take a texture that is already
    // spoken for. (The two underwater-depth types are deliberately left out:
    // they are depth-gauge cues and their behaviour off an Ultra is not
    // something a marathon should depend on.)
    enum Feel: CaseIterable {

        /// The clock is running. `.start` is literally this.
        case go

        /// Read the wrist, something changed. Two firm beats.
        case attend

        /// A change is coming, not here yet. Apple calls it a generic
        /// maneuver cue, which is exactly the job: a boundary is about to
        /// arrive. Must not be `attend` — feeling the same thing at T-3s and
        /// again at T-0 is how a runner loses track of which one was the
        /// boundary.
        case imminent

        /// One light tap. Information, nothing to do about it.
        case tick

        /// The heaviest texture in the palette — a long, hard sequence.
        /// Apple's name for it is `.failure`; nothing has failed. It is here
        /// because it is the only thing on this watch a runner will not miss
        /// at mile 14 with a sweaty wrist and an arm in motion. TUNE.
        case insist

        /// Back off. `.directionDown`, felt as the verb.
        case easeDown

        /// Pick it up. The mirror of it.
        case pickUp

        /// The clock stopped.
        case halt

        /// A question that is WAITING for an answer. `.retry` in Apple's
        /// vocabulary, and the meaning carries: it is asking the runner to
        /// act. Distinct from every moment that gives the screen back on its
        /// own, because that difference is the entire content of the cue.
        case question

        /// A condition, not an instruction. Something about the watch, not
        /// about the running. Texture chosen for being unlike everything
        /// above; Apple's turn-by-turn name for it means nothing here. TUNE.
        case condition

        /// The coach is talking. Same caveat as `condition` — borrowed for
        /// its texture. TUNE.
        case speak

        /// Done. `.success`.
        case complete

        fileprivate var type: WKHapticType {
            switch self {
            case .go:        return .start
            case .attend:    return .notification
            case .imminent:  return .navigationGenericManeuver
            case .tick:      return .click
            case .insist:    return .failure
            case .easeDown:  return .directionDown
            case .pickUp:    return .directionUp
            case .halt:      return .stop
            case .question:  return .retry
            case .condition: return .navigationLeftTurn
            case .speak:     return .navigationRightTurn
            case .complete:  return .success
            }
        }
    }

    // MARK: - Moment · what the caller names
    //
    // One case per thing that happens to a runner. No associated values: a
    // moment's CONTENT is on the board, and a haptic carries none of it.
    // The router maps its own `WMomentKind` / `WInterrupt` onto these in one
    // exhaustive switch, so a case added there cannot silently go unfelt:
    //
    //      WMomentKind.go               → .go
    //      WMomentKind.phaseChange      → .phaseChange   (.repBoundary in a rep)
    //      WMomentKind.split            → .split
    //      WMomentKind.fuel             → .fuel
    //      WMomentKind.headsUp(quicken) → .headsUpPickItUp / .headsUpEaseOff
    //      WMomentKind.paused           → .paused
    //      WInterrupt.bailOffered       → .bailOffered
    //      WInterrupt.ceilingOverride   → .ceilingOverride
    //      WInterrupt.lowBattery        → .conditionNotice
    //      WInterrupt.waterLock         → nothing. The system owns that cue.
    //      WInterrupt.gpsAcquiring      → nothing. It is the lobby, before
    //                                     the run; a buzz for "not yet" is a
    //                                     buzz for a non-event.
    enum Moment: CaseIterable {

        /// The run begins. The ramp's last appearance until the finish.
        case go

        /// Running again after a pause.
        ///
        /// FAMILY · `go`. Deliberately the same feel as the start of the run,
        /// because it is the same fact: the clock is running. There is no
        /// third state for the runner to distinguish.
        case resumed

        /// The session moved to a new phase. Warm-up → work, work → recovery,
        /// into the threshold block, into the finish segment.
        case phaseChange

        /// A rep boundary inside an interval session.
        ///
        /// FAMILY · `phaseChange`, and this is the answer to "a rep boundary
        /// vs a mile split": a rep boundary IS a phase change — the effort
        /// the runner is holding has just been replaced — while a split is
        /// information about effort that is unchanged. So the two that must
        /// differ are `repBoundary` and `split`, and they do: an instruction
        /// (`attend`) against a note (`tick`).
        ///
        /// It is NOT split further into "entering work" vs "entering
        /// recovery". The directional pair belongs to the heads-up moments,
        /// which fire during quality sessions and would collide with it; and
        /// the phase board that comes up states the word, the rep count and
        /// the band at 38pt. The haptic's job here is "look", not "look, and
        /// here is what it says".
        case repBoundary

        /// Three seconds until the current rep or phase ends.
        case boundaryComing

        /// One beat of the 3 · 2 · 1 countdown.
        ///
        /// FAMILY · `split`. Same single light tap, and the sequence is what
        /// separates them: three of these a second apart is a countdown, one
        /// on its own is a mile. Nothing else in the app taps once.
        case countdownTick

        /// A mile went by.
        case split

        /// A gel point. Race only, from the plan's own fuelling marks.
        ///
        /// This gets the heaviest texture in the palette, and the reasoning is
        /// asymmetric cost: a missed gel at mile 14 is a bonked race, while
        /// every other moment either repeats, persists on screen, or costs
        /// nothing when missed. The design gives this moment the one lit
        /// colour field for the same reason.
        ///
        /// Nothing in `WKHapticType` repeats on its own, and this file does
        /// not own timing — so insistence lives in the texture, not in a
        /// loop. If the wrist test says it is still missable, the router can
        /// fire the moment again; the cadence is the router's call.
        case fuel

        /// Over the band. "Ease off".
        case headsUpEaseOff

        /// Under a band with a floor. "Pick it up".
        case headsUpPickItUp

        /// Heart rate went through today's ceiling. The board states it and
        /// gives the screen back; `ceilingOverride` is the one that asks.
        ///
        /// FAMILY · `headsUpEaseOff`. Same sentence to the runner — back off
        /// now — and the board names which instrument said so. A separate
        /// texture here would be a distinction the runner cannot act on
        /// differently.
        case ceilingBreach

        /// The clock stopped.
        case paused

        /// The coach offers the bail. Two miles adrift, still running,
        /// decision open. WAITS for an answer.
        case bailOffered

        /// The coach offers to lift today's ceiling. WAITS for an answer.
        ///
        /// FAMILY · `bailOffered`. Both are the only shape in the app that
        /// does not give the screen back on its own, and the cue's whole
        /// content is that fact: stop reading the run, answer this. They
        /// cannot co-occur (one fires when the runner is adrift slow, the
        /// other when they are pushing too hard) and the board says which is
        /// being asked. Telling them apart by feel would buy nothing and
        /// would cost the clarity of having ONE texture that means "this
        /// does not go away".
        case ceilingOverride

        /// A condition worth knowing about: battery low and the run is long,
        /// a sensor dropped. Never an instruction — no sensor blocks the run.
        case conditionNotice

        /// A coach line, drawn (and possibly spoken) on its own board.
        case coachLine

        /// The run is done.
        case finish

        fileprivate var feel: Feel {
            switch self {
            case .go, .resumed:                     return .go
            case .phaseChange, .repBoundary:        return .attend
            case .boundaryComing:                   return .imminent
            case .split, .countdownTick:            return .tick
            case .fuel:                             return .insist
            case .headsUpEaseOff, .ceilingBreach:   return .easeDown
            case .headsUpPickItUp:                  return .pickUp
            case .paused:                           return .halt
            case .bailOffered, .ceilingOverride:    return .question
            case .conditionNotice:                  return .condition
            case .coachLine:                        return .speak
            case .finish:                           return .complete
            }
        }
    }

    // MARK: - The one entry point

    /// Fire the haptic for a moment.
    ///
    /// This is the only way new code should produce a haptic. It takes the
    /// moment, not the texture, so there is no call site that can name the
    /// wrong sensation — only one that names the wrong moment, which is a
    /// thing a reader can see.
    ///
    /// - Parameters:
    ///   - moment: what just happened to the runner.
    ///   - audible: also ring the bell, for a runner who has Sound on. The
    ///     caller decides (the toggle lives in `UserDefaults` /
    ///     `@AppStorage("audibleAlerts")`); this function does not read it,
    ///     because a haptic table that consults settings is a haptic table
    ///     that behaves differently in two places. Audio is a delivery route,
    ///     never a second channel — the bell adds no haptic of its own, so the
    ///     texture a runner feels is the same with Sound on or off.
    static func play(moment: Moment, audible: Bool = false) {
        #if DEBUG
        _ = vocabularyIsDistinct
        #endif
        WKInterfaceDevice.current().play(moment.feel.type)
        if audible { ChimePlayer.shared.play() }
    }

    #if DEBUG
    /// Asserts, once per session on the first haptic, that no two `Feel`s
    /// have collapsed onto the same `WKHapticType`.
    ///
    /// The families above are deliberate and live in `Moment.feel`, where
    /// each one is written down with its reason. THIS check guards the other
    /// direction: an edit to `Feel.type` that quietly makes two distinct
    /// sensations identical — which is how "a phase change and a split must
    /// not feel the same" gets broken without anyone touching a moment.
    private static let vocabularyIsDistinct: Bool = {
        var seen: [Int: Feel] = [:]
        for feel in Feel.allCases {
            let raw = feel.type.rawValue
            if let clash = seen[raw] {
                assertionFailure(
                    "Haptics: \(feel) and \(clash) map to the same WKHapticType. "
                    + "Two sensations that are meant to differ have collapsed."
                )
            }
            seen[raw] = feel
        }
        return true
    }()
    #endif

    // MARK: - LEGACY · the backend's per-phase wire cue
    //
    // `WatchHaptic` is a field on `WatchPhase` — it is the BACKEND saying
    // which cue a phase wants, and it predates the moment vocabulary above.
    // The V1 engine (`WorkoutEngine` / `ActiveWorkoutView`) also uses it as a
    // general palette, which is the misrouting this file was rewritten to
    // stop: today a mile split fires `.transitionWork` and a gel fires
    // `.transitionCooldown`, so a split feels like entering a rep and a gel
    // feels like stopping. The fix is at those call sites — they should call
    // `play(moment:)` with the moment they actually mean — and that is not
    // this file's edit to make.
    //
    // So the four functions below are FROZEN: same textures they have shipped
    // with, so nothing in the V1 path changes feel underneath a runner. New
    // code must not call them.

    /// Fire the haptic the backend attached to a phase. Legacy · V1 engine.
    static func play(_ cue: WatchHaptic) {
        let device = WKInterfaceDevice.current()
        switch cue {
        case .start:
            device.play(.start)
        case .transitionWork:
            // Entering a hard effort · assertive double cue.
            device.play(.directionUp)
        case .transitionRecovery:
            // Easing off · gentler cue.
            device.play(.directionDown)
        case .transitionCooldown:
            device.play(.stop)
        case .end:
            device.play(.success)
        }
    }

    /// The "3 seconds before a work interval ends" warning. Legacy · V1
    /// engine. The moment vocabulary calls this `.boundaryComing`.
    static func almostDone() {
        WKInterfaceDevice.current().play(.notification)
    }

    /// A single light tick · each beat of the 3 · 2 · 1 countdown. Legacy ·
    /// V1 engine. The moment vocabulary calls this `.countdownTick`.
    static func tick() {
        WKInterfaceDevice.current().play(.click)
    }

    /// Audible "ding" — rings on top of whatever haptic the caller already
    /// fired, when the runner has toggled Sound on (Controls page, blue
    /// button → UserDefaults audibleAlerts).
    ///
    /// It rings and does NOT play a haptic of its own. It used to add a
    /// `.notification` here, which meant a runner with Sound on felt a
    /// notification riding every single cue — a split, a gel and a phase
    /// change all carried it, so with Sound on they DID feel the same, which
    /// is the one thing the design forbids. Every call site already fires the
    /// cue's own haptic first (verified: all seven `flash()` sites in
    /// WorkoutEngine), so removing it costs nothing and restores the
    /// distinction. Audio is a delivery route, never a second channel.
    ///
    /// History: an earlier draft activated AVAudioSession inside this
    /// function, which raised an uncatchable NSException the first time
    /// it fired during an active HKWorkoutSession (crashed the user's
    /// long run at mile 1). The fix isn't to skip audio — it's to do
    /// the session bring-up BEFORE HK takes over. That now happens in
    /// WorkoutTracker.start() via ChimePlayer.activate(). Here we only
    /// run the hot path: schedule a pre-built buffer on the running
    /// engine. No session work, safe to call from any transition cue.
    static func chime() {
        ChimePlayer.shared.play()
    }
}
