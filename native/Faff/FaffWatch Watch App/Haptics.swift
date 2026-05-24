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
//  Also hosts TonePlayer (bottom of file), the synthesized audible chime
//  used by Haptics.chime() — plays through the watch speaker even when
//  the watch is in silent mode (AVAudioSession `.playback` category).
//

import WatchKit
import AVFoundation

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
    /// UserDefaults audibleAlerts). Combines:
    ///   · the .notification HAPTIC (so even on a watch with audio fully
    ///     off you get a stronger double-buzz than a single tap)
    ///   · the synthesized bell-like TONE via TonePlayer, which uses
    ///     AVAudioSession `.playback` so it plays through silent mode.
    static func chime() {
        WKInterfaceDevice.current().play(.notification)
        TonePlayer.shared.chime()
    }
}

// MARK: - TonePlayer · synthesized bell chime that beats silent mode

/// A short bell-like ping synthesized at runtime — no bundled sound file.
/// Two stacked sine waves (~880 Hz + ~1318 Hz, a perfect-fifth interval)
/// with an exponential decay envelope, ~180 ms long. Plays through the
/// watch speaker via AVAudioSession `.playback` so it's audible even when
/// the watch is in silent mode — the whole point of the Sound toggle.
///
/// Lazily configures the audio session + audio engine on the first chime
/// call so we don't activate audio routing for runners who never turn the
/// toggle on. `.duckOthers` briefly lowers any other audio (e.g. music)
/// during the chime so the runner hears the cue clearly.
final class TonePlayer {
    static let shared = TonePlayer()

    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let sampleRate: Double = 44100
    private var isReady = false

    private init() {
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: nil)
    }

    /// One-time audio-session + engine bring-up. Failure is silent: if the
    /// session can't be configured, no chime — the haptic still fires.
    private func ensureReady() {
        guard !isReady else { return }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default,
                                    options: [.duckOthers])
            try session.setActive(true, options: [])
            try engine.start()
            isReady = true
        } catch {
            // No audio — leave isReady=false so we retry next call.
        }
    }

    func chime() {
        ensureReady()
        guard isReady else { return }

        let duration: Double = 0.18
        let frameCount = AVAudioFrameCount(sampleRate * duration)
        guard let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate,
                                          channels: 1),
              let buffer = AVAudioPCMBuffer(pcmFormat: format,
                                            frameCapacity: frameCount) else { return }
        buffer.frameLength = frameCount
        guard let ptr = buffer.floatChannelData?[0] else { return }

        // Bell-like ping: fundamental + perfect-fifth overtone, exponential
        // decay. Volume kept low (~0.4 peak) so it's a clean cue, not a
        // jarring blast.
        let f1: Float = 880.0    // ~A5 fundamental
        let f2: Float = 1318.5   // ~E6 overtone (perfect fifth)
        let twoPi: Float = 2.0 * .pi
        for i in 0..<Int(frameCount) {
            let t = Float(i) / Float(sampleRate)
            let env = exp(-7.0 * t)                  // 180ms decay envelope
            let s = (sin(twoPi * f1 * t) * 0.55
                   + sin(twoPi * f2 * t) * 0.30) * env * 0.45
            ptr[i] = s
        }

        player.scheduleBuffer(buffer, at: nil, options: [], completionHandler: nil)
        if !player.isPlaying { player.play() }
    }
}
