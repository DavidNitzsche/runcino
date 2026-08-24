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

    /// Samantha, chosen by ear against Daniel, Eddy and Flo — David, 2026-08-24.
    ///
    /// PREFERRED, NOT REQUIRED. Which voices a watch actually has installed is
    /// not ours to decide: Apple's genuinely natural ones are Enhanced or
    /// Premium quality and must be downloaded by the runner, and Siri's own
    /// voice is not available to third-party apps at all. So this asks for the
    /// best Samantha it can find, prefers a higher-quality variant if the
    /// runner has one, and falls back to the system default rather than
    /// refusing to speak.
    private lazy var voice: AVSpeechSynthesisVoice? = {
        let all = AVSpeechSynthesisVoice.speechVoices()
            .filter { $0.language.hasPrefix("en") }
        let samantha = all.filter { $0.name.localizedCaseInsensitiveContains("Samantha") }
        let best = samantha.max { a, b in a.quality.rawValue < b.quality.rawValue }
        return best ?? AVSpeechSynthesisVoice(language: Locale.preferredLanguages.first)
    }()

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
        u.voice = voice
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
                     almostDone: String?,
                     driftVerb: String?) -> String? {
        switch kind {
        case .go:
            return nil

        case .phaseChange:
            // "Work. Rep 4 of 6. Six forty five to seven hundred per mile."
            // is a sentence nobody can act on at a rep boundary. The word and
            // the count; the band is on the board for the eye.
            guard let w = phaseWord else { return nil }
            // A COMMA, NOT A FULL STOP. "Work. Rep 4 of 6." makes a
            // synthesiser stop dead between two halves of one thought, which
            // is most of what made this sound like a machine reading a form.
            if let d = phaseDetail, !d.isEmpty {
                return "\(w), \(lowerFirst(spokenPhrase(d)))."
            }
            return "\(w)."

        case .split:
            // The one cue a runner most wants without looking.
            guard let l = splitLabel, let t = splitTime else { return nil }
            var s = "\(spokenPhrase(l)), \(spokenClock(t))."
            if let c = splitComparison, !c.isEmpty { s += " \(upperFirst(spokenPhrase(c)))." }
            return s

        case .fuel(let index, let total):
            return "Gel, \(spokenCount(index)) of \(spokenCount(total))."

        case .headsUp:
            // THE VOICE SAYS WHAT THE BOARD SAYS. It said "Off the band",
            // which the board never draws — the board draws the direction,
            // "Ease off" or "Pick it up". A runner with headphones in and a
            // runner looking at the wrist were getting different words for the
            // same event, which is exactly the thing rule 10 forbids and
            // exactly what this file was written to make impossible. Caught by
            // rendering the lines to audio and reading them back.
            guard let p = pace, let verb = driftVerb else { return nil }
            if let b = band {
                return "\(verb). \(upperFirst(spokenClock(p))), band is \(spokenBand(b))."
            }
            return "\(verb). \(upperFirst(spokenClock(p)))."

        case .almostDone:
            guard let v = almostDone else { return nil }
            // "0.25 mi" would be read "point two five M I".
            let parts = v.split(separator: " ").map(String.init)
            guard parts.count == 2 else { return "\(v) to go." }
            return "\(spokenDistance(parts[0], unit: parts[1])) to go."

        case .paused:
            return nil
        }
    }

    // MARK: - Saying numbers the way a runner says them
    //
    // ORTHOGRAPHY IS NOT CONTENT. The board draws "6 sec under goal" and the
    // voice says "six seconds under goal" — that is the same sentence rendered
    // for a different sense, exactly as the board renders it in tabular
    // figures and the voice does not. Rule 10 asks that both runners get the
    // same sentence, not the same characters.

    /// A clock, as a split is actually called out.
    ///
    /// "7:48" handed to a synthesiser raw is read "seven hundred forty-eight";
    /// spelled as two bare integers it becomes "seven, forty-eight" with a
    /// gap in the middle. Neither is what a person says. A runner says "seven
    /// forty-eight", "seven oh five", and "seven flat" — and the last two are
    /// the ones that give it away as a machine when it gets them wrong.
    static func spokenClock(_ s: String) -> String {
        let parts = s.split(separator: ":").map(String.init)
        guard parts.count == 2, let m = Int(parts[0]), let sec = Int(parts[1]) else { return s }
        let mins = spokenCount(m)
        if sec == 0 { return "\(mins) flat" }
        if sec < 10 { return "\(mins) oh \(spokenCount(sec))" }
        return "\(mins) \(spokenCount(sec))"
    }

    /// Small numbers as words. A synthesiser reads "4" correctly, but a line
    /// that mixes digits and words reads as a form being filled in rather than
    /// a person talking.
    static func spokenCount(_ n: Int) -> String {
        let ones = ["zero","one","two","three","four","five","six","seven","eight","nine",
                    "ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen",
                    "seventeen","eighteen","nineteen"]
        let tens = ["","","twenty","thirty","forty","fifty"]
        if n < 0 { return String(n) }
        if n < 20 { return ones[n] }
        if n < 60 {
            let t = tens[n / 10], o = n % 10
            return o == 0 ? t : "\(t)-\(ones[o])"
        }
        return String(n)
    }

    /// Sentence case. A synthesiser does not read capitals, but the tests read
    /// these strings and a line that says "seven fifty-two. six seconds" is a
    /// line nobody proofread — and the next person to add a branch copies the
    /// shape they find.
    static func upperFirst(_ s: String) -> String {
        guard let f = s.first else { return s }
        return String(f).uppercased() + s.dropFirst()
    }

    static func lowerFirst(_ s: String) -> String {
        guard let f = s.first else { return s }
        return String(f).lowercased() + s.dropFirst()
    }

    /// A phrase the board composed, spoken. "6 sec under goal" ->
    /// "six seconds under goal".
    static func spokenPhrase(_ s: String) -> String {
        var words = s.split(separator: " ").map(String.init)
        for i in words.indices {
            if let n = Int(words[i]) { words[i] = spokenCount(n) }
            else if words[i] == "sec" { words[i] = "seconds" }
            else if words[i] == "min" { words[i] = "minutes" }
        }
        // "one seconds" is the giveaway nobody forgives.
        if let i = words.firstIndex(of: "seconds"), i > 0, words[i - 1] == "one" {
            words[i] = "second"
        }
        return words.joined(separator: " ")
    }

    /// A distance, said rather than read. "0.25 miles" is "point two five
    /// miles"; a runner says "a quarter mile".
    static func spokenDistance(_ value: String, unit: String) -> String {
        let u = spokenUnit(unit)
        switch value {
        case "0.25": return u.hasPrefix("mile") ? "a quarter mile" : "a quarter of a kilometre"
        case "0.5", "0.50": return u.hasPrefix("mile") ? "half a mile" : "half a kilometre"
        case "0.75": return u.hasPrefix("mile") ? "three quarters of a mile" : "three quarters of a kilometre"
        default: return "\(value) \(u)"
        }
    }

    /// "6:45-7:00" is two clocks and a dash. Said as a range.
    private static func spokenBand(_ b: String) -> String {
        let cleaned = b.replacingOccurrences(of: "\u{2013}", with: " to ")
                       .replacingOccurrences(of: "-", with: " to ")
        return cleaned.split(separator: " ").map { part -> String in
            part.contains(":") ? spokenClock(String(part)) : spokenUnit(String(part))
        }.joined(separator: " ")
    }

    /// "/mi" is a symbol, and a synthesiser reads it as "slash M I". Every
    /// unit that reaches the voice is spelled as the word a runner would say.
    static func spokenUnit(_ u: String) -> String {
        switch u {
        case "/mi": return "per mile"
        case "/km": return "per kilometre"
        case "mi":  return "miles"
        case "km":  return "kilometres"
        case "bpm": return "beats"
        case "spm": return "steps per minute"
        default:    return u
        }
    }
}
