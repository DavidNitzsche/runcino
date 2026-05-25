//
//  Haptics.swift
//  FaffWatch
//
//  Maps the backend's WatchHaptic cues to WatchKit haptic types
//  (docs/native/01-watchos-scoping.md §3 "Transition haptics").
//
//  NOTE · the haptic CODE is here and runs in the simulator (where it's
//  effectively a no-op), but TIMING VALIDATION is phase 5 and requires
//  a physical Apple Watch — "I knew it was time to slow down" vs.
//  "I overran the interval by 15 seconds" can only be felt on the wrist.
//  Patterns below are a first pass to be tuned on-device.
//
//

import WatchKit

enum Haptics {

    /// Fire the haptic that marks the START of a phase.
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

    /// The "3 seconds before a work interval ends" warning.
    static func almostDone() {
        WKInterfaceDevice.current().play(.notification)
    }

    /// A single light tick · each beat of the 3 · 2 · 1 countdown.
    static func tick() {
        WKInterfaceDevice.current().play(.click)
    }

    /// Audible "ding" — fires on top of the regular alert haptic when the
    /// runner has toggled the Sound button on (Controls page, blue button →
    /// UserDefaults audibleAlerts).
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
        WKInterfaceDevice.current().play(.notification)
        ChimePlayer.shared.play()
    }
}
