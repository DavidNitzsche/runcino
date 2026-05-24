//
//  ChimePlayer.swift
//  FaffWatch
//
//  Synthesized bell ping that plays through silent mode during a run.
//
//  WHY THIS EXISTS AS ITS OWN FILE (not in Haptics.swift):
//
//  The previous attempt put audio bring-up inside Haptics.chime() — the
//  first mile-split triggered the first chime call, which tried to
//  AVAudioSession.setActive(true, .playback) WHILE HKWorkoutSession was
//  already running. watchOS raises an uncatchable Objective-C NSException
//  when that happens — Swift's try/catch can't save you, the app just
//  terminates. That crashed the user's actual long run at mile 1.
//
//  Fix: separate the LIFECYCLE (configure session + start engine) from
//  the HOT PATH (schedule + play). The lifecycle work happens exactly
//  once, BEFORE HK takes over, in WorkoutTracker.start(). The hot path
//  does no session work — just `player.scheduleBuffer + player.play()`
//  on an already-running engine, which is safe to call as often as we
//  want from inside a live workout.
//
//  The session is configured `.playback` (so it overrides silent mode
//  the same way iOS does) + `.mixWithOthers` (so the runner's music
//  keeps playing — we layer the bell on top, never pause anything).
//

import Foundation
import AVFoundation

final class ChimePlayer {
    static let shared = ChimePlayer()

    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let sampleRate: Double = 44100
    private var buffer: AVAudioPCMBuffer?
    private var isActive = false

    private init() {
        // No force-unwrapping or throwing work in init — this is a static
        // singleton created at first reference, and a crash here would
        // happen on app launch, which is worse than a missed chime. If
        // any of the audio plumbing comes back nil, the player just
        // stays unprepared; play() no-ops and the runner still gets the
        // haptic via WKInterfaceDevice.play(.notification).
        engine.attach(player)
        guard let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate,
                                          channels: 1) else { return }
        engine.connect(player, to: engine.mainMixerNode, format: format)
        buffer = makeBellBuffer(format: format)
    }

    // MARK: - Lifecycle (called from WorkoutTracker)

    /// Configure + activate the audio session and start the engine.
    /// **Must be called BEFORE HKWorkoutSession.startActivity(with:).**
    /// Calling this during a live workout is the path that raises the
    /// uncatchable NSException — don't do it.
    ///
    /// Safe to call when audibleAlerts is OFF; activating the session
    /// alone makes no sound, only player.play() does. Activating up
    /// front lets the user toggle Sound mid-workout without us ever
    /// needing to touch the session again.
    func activate() {
        guard !isActive else { return }
        do {
            let session = AVAudioSession.sharedInstance()
            // .playback ignores silent mode (same as iOS).
            // .mixWithOthers leaves any playing music alone — the bell
            // layers on top instead of ducking or pausing it.
            try session.setCategory(.playback, mode: .default,
                                    options: [.mixWithOthers])
            try session.setActive(true, options: [])
            try engine.start()
            isActive = true
        } catch {
            // No audio — leave isActive=false, Haptics.chime() will skip
            // the audio leg and the .notification haptic still fires.
            isActive = false
        }
    }

    /// Tear down after the workout ends. Releases the audio session so
    /// the watch's regular silent-mode behavior comes back when the user
    /// is just looking at the home page or the summary.
    func deactivate() {
        guard isActive else { return }
        if engine.isRunning { engine.stop() }
        player.stop()
        try? AVAudioSession.sharedInstance().setActive(false,
                                                       options: [.notifyOthersOnDeactivation])
        isActive = false
    }

    // MARK: - Hot path (called from Haptics.chime)

    /// Play the bell. No session work, no engine work — just schedule
    /// the pre-built buffer on the already-running player. Safe to call
    /// from any thread during a live workout.
    func play() {
        guard isActive, let buffer else { return }
        player.scheduleBuffer(buffer, at: nil, options: [], completionHandler: nil)
        if !player.isPlaying { player.play() }
    }

    // MARK: - Bell synthesis

    /// Two stacked sine waves (~A5 + ~E6, a perfect-fifth interval) with an
    /// exponential decay envelope, ~180ms long. Built ONCE at init and
    /// re-scheduled on every chime — same buffer, no re-synthesis cost.
    private func makeBellBuffer(format: AVAudioFormat) -> AVAudioPCMBuffer? {
        let duration: Double = 0.18
        let frameCount = AVAudioFrameCount(sampleRate * duration)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format,
                                            frameCapacity: frameCount) else { return nil }
        buffer.frameLength = frameCount
        guard let ptr = buffer.floatChannelData?[0] else { return nil }

        let f1: Float = 880.0    // A5 fundamental
        let f2: Float = 1318.5   // E6 perfect-fifth overtone
        let twoPi: Float = 2.0 * .pi
        for i in 0..<Int(frameCount) {
            let t = Float(i) / Float(sampleRate)
            let env = exp(-7.0 * t)                          // 180ms decay
            let s = (sin(twoPi * f1 * t) * 0.55
                   + sin(twoPi * f2 * t) * 0.30) * env * 0.45
            ptr[i] = s
        }
        return buffer
    }
}
