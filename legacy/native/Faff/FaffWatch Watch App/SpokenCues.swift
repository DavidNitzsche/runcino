//
//  SpokenCues.swift
//  FaffWatch
//
//  The app's voice.
//
//  RULE 10 IS THE WHOLE DESIGN OF THIS FILE. "A spoken cue is always also
//  drawn. Audio is a delivery route, never a second content channel. Two
//  runners — headphones in, headphones in a pocket — get the same sentence."
//
//  So there is exactly one function that turns a moment into words, and it
//  reads the SAME values the board draws. Not a parallel copy that has to be
//  kept in step; the parity is structural. If a board changes what it says,
//  the sentence changes with it or it does not compile.
//
//  WHAT IS NOT SPOKEN, and why:
//
//    · The running faces. A number that changes every second is not a
//      sentence, and a watch that reads your pace aloud continuously is a
//      watch you turn off.
//    · Faults. "No heart signal" spoken into a runner's ear sounds like an
//      emergency; the board says it quietly and red already means one thing.
//    · Anything the runner has to answer. The bail, the ceiling override —
//      those WAIT for a decision, and a voice cannot wait.
//
//  So: the moments, which are exactly the things that take the screen for a
//  couple of seconds and then give it back. The same set, in the same words.
//
//  ───────────────────────────────────────────────────────────────────────
//  Why this exists at all: the app had no audio of any kind. The design's
//  "spoken cue" board drew a sentence nothing ever said, which is rule 10
//  passing on a technicality — nothing was spoken, so nothing was spoken
//  without being drawn.
//

import AVFoundation
import Foundation

@MainActor
final class SpokenCues {

    static let shared = SpokenCues()

    /// Default ON. A runner who wants silence has a switch; a runner who
    /// never finds the switch gets the feature the watch was bought for.
    /// Sound already gates the chime through `audibleAlerts`; this is its own
    /// key because a runner may want a tick and not a voice, or the reverse.
    var enabled: Bool {
        UserDefaults.standard.object(forKey: "spokenCues") as? Bool ?? true
    }

    private let synth = AVSpeechSynthesizer()
    private var sessionReady = false

    private init() {}

    /// Say a line, ducking whatever the runner is listening to.
    ///
    /// Fire and forget. A cue that arrives late is worse than one that never
    /// arrives — the board it belongs to has already gone — so nothing here
    /// queues or retries, and a second line while one is speaking replaces it.
    func say(_ line: String) {
        guard enabled, !line.isEmpty else { return }
        prepareSession()
        if synth.isSpeaking {
            synth.stopSpeaking(at: .immediate)
        }
        let u = AVSpeechUtterance(string: line)
        // A shade under default. These land mid-effort and a runner reading
        // a board at the same time should not be racing the voice.
        u.rate = AVSpeechUtteranceDefaultSpeechRate * 0.95
        u.postUtteranceDelay = 0
        synth.speak(u)
    }

    /// `.duckOthers` rather than `.mixWithOthers`: a cue that plays UNDER a
    /// podcast is a cue nobody hears, and the whole point is that the runner
    /// with headphones in gets the same sentence as the runner without.
    private func prepareSession() {
        guard !sessionReady else { return }
        sessionReady = true
        let s = AVAudioSession.sharedInstance()
        try? s.setCategory(.playback, mode: .voicePrompt,
                           options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers])
        s.activate(options: []) { _, _ in }
    }
}

// MARK: - One moment, one sentence

extension SpokenCues {

    /// The words for a moment, built from the values its BOARD draws.
    ///
    /// Every branch here mirrors `WatchRouterV5.momentBoard(_:)`. The router
    /// hands this the same figures it hands the view, so the two cannot drift
    /// into saying different things.
    ///
    /// Returns nil for a moment that should stay silent — which is a decision
    /// per moment, not an oversight. `Go` is silent because the runner just
    /// pressed Start and knows; `Paused` is silent because the watch stopping
    /// is not news to someone standing still, and on auto-pause a voice
    /// announcing it would be the watch talking about itself.
    static func line(for kind: WMomentKind,
                     sessionClass: String,
                     splitLabel: String?,
                     splitTime: String?,
                     splitComparison: String?,
                     phaseWord: String?,
                     phaseDetail: String?,
                     band: String?,
                     pace: String?,
                     almostDone: String?) -> String? {
        switch kind {
        case .go:
            return nil

        case .phaseChange:
            // "Work. Rep 4 of 6. Six forty five to seven hundred per mile."
            // is a sentence nobody can act on at a rep boundary. The word and
            // the count; the band is on the board for the eye.
            guard let w = phaseWord else { return nil }
            if let d = phaseDetail, !d.isEmpty { return "\(w). \(d)." }
            return "\(w)."

        case .split:
            // The one cue a runner most wants without looking.
            guard let l = splitLabel, let t = splitTime else { return nil }
            var s = "\(l). \(spokenClock(t))."
            if let c = splitComparison, !c.isEmpty { s += " \(c)." }
            return s

        case .fuel(let index, let total):
            return "Gel. \(index) of \(total)."

        case .headsUp:
            // The direction and the band, because this cue exists to be acted
            // on and the runner is by definition not looking at the wrist.
            guard let p = pace else { return nil }
            let verb = (band != nil) ? "Off the band" : "Off pace"
            if let b = band { return "\(verb). \(spokenClock(p)). Band is \(spokenBand(b))." }
            return "\(verb). \(spokenClock(p))."

        case .almostDone:
            guard let v = almostDone else { return nil }
            return "\(v) to go."

        case .paused:
            return nil
        }
    }

    /// "7:48" reads as "seven forty-eight" if handed to a synthesiser raw —
    /// which is a number, not a time. Spelled so it is heard as one.
    private static func spokenClock(_ s: String) -> String {
        let parts = s.split(separator: ":").map(String.init)
        guard parts.count == 2, let m = Int(parts[0]), let sec = Int(parts[1]) else { return s }
        if sec == 0 { return "\(m) minutes" }
        return "\(m) \(sec)"
    }

    /// "6:45–7:00" is two clocks and a dash. Said as a range.
    private static func spokenBand(_ b: String) -> String {
        let cleaned = b.replacingOccurrences(of: "\u{2013}", with: " to ")
                       .replacingOccurrences(of: "-", with: " to ")
        return cleaned.split(separator: " ").map { part -> String in
            part.contains(":") ? spokenClock(String(part)) : String(part)
        }.joined(separator: " ")
    }
}
