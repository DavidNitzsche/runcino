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
}
