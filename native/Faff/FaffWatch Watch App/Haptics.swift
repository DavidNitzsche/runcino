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
    /// IMPORTANT: This used to also call TonePlayer for a synthesized bell
    /// that overrode silent mode. That code activated an AVAudioSession
    /// with category .playback DURING an active HKWorkoutSession, which
    /// throws an uncatchable NSException on watchOS — same class of bug as
    /// allowsBackgroundLocationUpdates. Caused the watch app to crash at
    /// the first mile-split (the first transition cue to fire during a
    /// long run). Reverted to haptic-only — the .notification pattern is
    /// distinctly stronger than the single tap a regular event fires, so
    /// you still get an obvious "this is the alert" feel. True audible
    /// playback during a workout is a real watchOS audio-session puzzle
    /// that needs more careful work to solve safely.
    static func chime() {
        WKInterfaceDevice.current().play(.notification)
    }
}

// (TonePlayer removed — the AVAudioEngine + AVAudioSession.setActive path
// crashed mid-workout on real hardware. Activating .playback while
// HKWorkoutSession is running throws an uncatchable NSException on
// watchOS. Reintroduce only with a proper background-audio entitlement
// + a session-coordination strategy that doesn't fight HK.)
