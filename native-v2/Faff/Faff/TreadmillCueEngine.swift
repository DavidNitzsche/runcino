//
//  TreadmillCueEngine.swift
//  faff.run iPhone · audio/haptic/spoken cues for a live treadmill session.
//
//  Stage 5 · zero audio, haptic or speech infrastructure existed anywhere in
//  this app before this file — confirmed by a repo-wide grep for
//  AVSpeechSynthesizer, AudioServicesPlaySystemSound,
//  UINotificationFeedbackGenerator, UIImpactFeedbackGenerator and
//  AVAudioSession across every phone source file: zero matches, treadmill or
//  outdoor. `WatchPhase.haptic` is decoded on the phone but has never had a
//  phone-side consumer — it drives the WATCH's Taptic Engine only, over a
//  separate wire path this file does not touch. This is a second, additive,
//  phone-side cue system.
//
//  EVERY cue here fires from `BeltSession.lastTransition` — the state
//  machine's own transition event — or from the belt's own monotonic
//  elapsed/remaining time, never from a view-local timer, animation
//  completion, or anything that could disagree with what the screen shows.
//  Stage 5's own words: "Cues must originate from state-machine transitions,
//  so they cannot disagree with the visible phase."
//
//  Two independent toggles (voice / tones), UserDefaults-backed rather than
//  wired into the server-synced Settings/Profile architecture — Stage 5:
//  "do not turn this into a settings project." Surfaced from the console's
//  own small overflow control, not a new screen.
//

import AVFoundation
import AudioToolbox
import UIKit

@MainActor
final class TreadmillCueEngine {
    static let voiceEnabledKey = "treadmillVoiceCuesEnabled"
    static let tonesEnabledKey = "treadmillToneCuesEnabled"

    static var voiceEnabled: Bool {
        get { UserDefaults.standard.object(forKey: voiceEnabledKey) as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: voiceEnabledKey) }
    }
    static var tonesEnabled: Bool {
        get { UserDefaults.standard.object(forKey: tonesEnabledKey) as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: tonesEnabledKey) }
    }

    private let synth = AVSpeechSynthesizer()
    private var sessionConfigured = false

    /// `.duckOthers` + `.mixWithOthers`, never `.interruptSpokenAudioAndMixWithOthers`
    /// — Stage 5: "avoid interrupting music unnecessarily." Music or a
    /// podcast dips under the cue and returns, rather than being paused or
    /// permanently silenced. Configured once, lazily, only when a cue is
    /// actually about to play — a treadmill console with cues disabled
    /// should never touch the shared audio session at all.
    private func ensureSession() {
        guard !sessionConfigured else { return }
        sessionConfigured = true
        let s = AVAudioSession.sharedInstance()
        try? s.setCategory(.playback, mode: .voicePrompt, options: [.duckOthers, .mixWithOthers])
        try? s.setActive(true, options: [])
    }

    // MARK: - Transition

    /// The one call site that matters most: fired on every `BeltSession
    /// .lastTransition` change (auto or skip). Tone/haptic first — audible
    /// and felt even if the runner is mid-stride and not listening for
    /// words — then, if voice is on, one short sentence: the phase, its
    /// target speed and incline. Never the full plan, never repeated
    /// context already said once (Rule 17) — just what changed.
    func phaseTransition(to phase: WatchPhase, workIndex: Int?, workCount: Int?) {
        haptic(.success)
        tone(.transition)
        guard Self.voiceEnabled else { return }
        var sentence: String
        if phase.type == .work, let workIndex, let workCount, workCount > 1 {
            sentence = "Interval \(workIndex) of \(workCount)."
        } else {
            sentence = "\(phase.label)."
        }
        if let speed = phase.treadmillSpeedMph, speed > 0 {
            sentence += " \(Units.formatSpeed(mph: speed)) \(Units.speedLabel())"
            if let incline = phase.treadmillInclinePct, incline > 0.5 {
                sentence += ", \(FaffFmt.oneDecimal(incline) ?? "0") percent grade"
            }
            sentence += "."
        } else if let target = phase.targetPaceSPerMi, target > 0 {
            sentence += " Target \(FaffFmt.pace(secPerMi: Double(target)) ?? "") pace."
        }
        speak(sentence)
    }

    /// "3… 2… 1…" in the last three seconds before a KNOWN transition —
    /// Stage 5's "countdown before a phase transition." Caller is
    /// responsible for calling this at most once per second (it fires a
    /// haptic tick + optional spoken number every call, so a caller ticking
    /// faster than 1 Hz would over-fire).
    func countdownTick(secondsRemaining: Int) {
        guard (1...3).contains(secondsRemaining) else { return }
        haptic(.warning)
        guard Self.voiceEnabled else { return }
        speak("\(secondsRemaining)", rate: 0.56)
    }

    /// One quiet progress cue, roughly midway through the workout — Stage
    /// 5's "halfway or useful progress cue where appropriate." Caller
    /// decides WHEN (crossing the workout's own halfway mark); this only
    /// decides HOW to say it.
    func halfway() {
        tone(.progress)
        guard Self.voiceEnabled else { return }
        speak("Halfway there.")
    }

    func workoutComplete() {
        haptic(.success)
        tone(.complete)
        guard Self.voiceEnabled else { return }
        speak("Workout complete. Nice work.")
    }

    // MARK: - Primitives

    private enum Tone {
        case transition, progress, complete

        /// System sound IDs — respects the silent switch and system volume,
        /// unlike a haptic, which is the correct split: a runner who has
        /// silenced their phone still feels the tap but does not hear a tone
        /// over it, matching how every other iOS timer/alarm behaves.
        var systemSoundID: SystemSoundID {
            switch self {
            case .transition: return 1054   // "Tink" · short, unambiguous
            case .progress:   return 1003   // subtle
            case .complete:   return 1025   // a clearer "done" chime
            }
        }
    }

    private func tone(_ t: Tone) {
        guard Self.tonesEnabled else { return }
        ensureSession()
        AudioServicesPlaySystemSound(t.systemSoundID)
    }

    private enum Haptic { case success, warning }

    private func haptic(_ h: Haptic) {
        switch h {
        case .success:
            let g = UINotificationFeedbackGenerator()
            g.prepare()
            g.notificationOccurred(.success)
        case .warning:
            let g = UIImpactFeedbackGenerator(style: .light)
            g.prepare()
            g.impactOccurred()
        }
    }

    private func speak(_ text: String, rate: Float = AVSpeechUtteranceDefaultSpeechRate) {
        ensureSession()
        // A cue mid-utterance is less useful than the NEXT cue landing on
        // time — never queue behind a stale sentence the moment matters
        // more than.
        if synth.isSpeaking { synth.stopSpeaking(at: .immediate) }
        let u = AVSpeechUtterance(string: text)
        u.rate = rate
        u.voice = AVSpeechSynthesisVoice(language: AVSpeechSynthesisVoice.currentLanguageCode())
        synth.speak(u)
    }
}
