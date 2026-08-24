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
    /// PREFERRED, NOT REQUIRED, AND NOT AT ANY PRICE. Which voices a watch has
    /// is not ours to decide: Apple's genuinely natural ones are Enhanced or
    /// Premium quality and are downloaded rather than shipped, and Siri's own
    /// voice is closed to third-party apps. David heard Compact Samantha and
    /// called it computery, and he was right — Compact is the floor of what
    /// the platform can do.
    ///
    /// So this ranks QUALITY FIRST and uses the name only to break a tie
    /// inside a tier. An earlier version filtered to Samantha and only then
    /// took the best quality, which would have pinned a watch that HAD a
    /// better voice installed to the floor anyway — the name preference
    /// outranking the thing the preference was a proxy for.
    ///
    /// Enhanced Ava beats Compact Samantha. Compact Samantha beats Compact
    /// Fred. A watch with no English voice at all still speaks.
    private lazy var voice: AVSpeechSynthesisVoice? = {
        let ranked = AVSpeechSynthesisVoice.speechVoices()
            .filter { $0.language.hasPrefix("en") }
            .max { SpokenCues.rank($0) < SpokenCues.rank($1) }
        return ranked ?? AVSpeechSynthesisVoice(language: Locale.preferredLanguages.first)
    }()

    /// Voices David picked by ear, best first. Only consulted within a tier.
    static let preferredNames = ["Samantha", "Ava", "Allison", "Susan", "Zoe", "Nicky"]

    /// How good a voice is, in the order the qualities actually matter:
    /// installed quality, then David's ear, then US English over other English.
    ///
    /// Internal rather than private so the ordering itself can be tested —
    /// the bug this replaced was in the ORDER, not in either half.
    static func rank(_ v: AVSpeechSynthesisVoice) -> (Int, Int, Int) {
        rank(quality: v.quality.rawValue, name: v.name, language: v.language)
    }

    /// The ordering itself, over plain values, so a test can state the rule
    /// without needing a watch that has the voices installed.
    static func rank(quality: Int, name: String, language: String) -> (Int, Int, Int) {
        let byEar = preferredNames.firstIndex {
            name.localizedCaseInsensitiveContains($0)
        }
        return (quality,
                byEar.map { preferredNames.count - $0 } ?? 0,
                language == "en-US" ? 1 : 0)
    }

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
            if let c = splitComparison, !c.isEmpty {
                s += " \(upperFirst(spokenComparison(c)))."
            }
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
            //
            // THE BAND IS DELIBERATELY NOT SPOKEN, and `band` is deliberately
            // still a parameter so that stays visible. "Ease off. Seven
            // fourteen, band is six forty-five to seven flat per mile" is
            // eleven words of numbers arriving mid-effort, and by the end of
            // it the runner has lost the one number that mattered. The
            // direction and the current pace are the whole instruction; the
            // range is on the board for the eye, exactly as the rep band is
            // at a phase change. Do not wire this back in.
            guard let p = pace, let verb = driftVerb else { return nil }
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

    /// A split's comparison, said the way a runner says it.
    ///
    /// The board draws "6 sec under goal" because the eye reads a whole label
    /// at a glance. The ear does not — it receives one word at a time, and by
    /// "goal" the runner is three words past the six. So the voice drops the
    /// unit and the noun and says "six under", which is what a person shouting
    /// from the kerb says. Same content, rendered for a different sense.
    ///
    /// "on goal pace" keeps its noun: there is no number to protect there, and
    /// "on goal" alone reads as a fragment.
    static func spokenComparison(_ s: String) -> String {
        var words = s.split(separator: " ").map(String.init)
        words.removeAll { $0 == "sec" || $0 == "seconds" }
        // Only a TRAILING "goal" — "on goal pace" must survive intact.
        if words.count > 1, words.last == "goal" { words.removeLast() }
        for i in words.indices {
            if let n = Int(words[i]) { words[i] = spokenCount(n) }
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
