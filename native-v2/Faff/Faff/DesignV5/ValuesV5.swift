//
//  ValuesV5.swift
//  faff.run iPhone · RULE ONE, made into a type.
//
//  ─────────────────────────────────────────────────────────────────────────
//  A MODELLED NUMBER MUST NEVER LOOK MEASURED.
//
//  The design contract calls this "the only real sin". A projected finish, a
//  pace derived from training rather than from a race, a projection taken
//  after time off — all modelled. The mark is a small amber tilde immediately
//  before the value, and it is a SYSTEM rule, not one screen's fix.
//
//  A rule that lives in eighteen screens' worth of `if isProjected { "~" }`
//  is a rule that will be broken by the nineteenth screen. So it lives here
//  instead, in a type that cannot render a number without first being told
//  where the number came from:
//
//      FaffValue.measured("1:41:53")      →   1:41:53
//      FaffValue.modelled("3:16:45")      →  ~3:16:45      (tilde in amber)
//      FaffValue.unreadable               →   —            (in fault red)
//
//  There is deliberately no `FaffValue(text:)`. Every construction names a
//  basis, so "I forgot" is not a reachable state — the compiler asks.
//
//  `scripts/check-modelled-mark.sh` is the build-side half: it fails the build
//  if a v5 view prints a known-modelled field as a bare String.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHAT COUNTS AS MODELLED · decided by the engine, not by the screen
//
//  The backend flags it. `GoalAssessment.basis` is the literal string
//  "projected" and covers safeTargetSec, stretchTargetSec, weeksToReach and
//  the statement built from them. A pace re-anchored from training rather
//  than from a race is modelled; a pace anchored on a race result is not. A
//  race whose chip time has not locked yet is "Training effort · race to lock
//  in" and is NOT authoritative for fitness.
//
//  If a screen cannot tell, the answer is `.modelled`. Over-marking makes a
//  measured number look humble. Under-marking is the sin.
//

import SwiftUI

// MARK: - Basis

/// Where a number came from. There are only three answers and the design
/// paints each one differently.
enum FaffBasis: String, Equatable, Hashable, Codable {
    /// Read from something that happened. A finish time, a logged distance,
    /// a heart rate off the wrist.
    case measured
    /// Derived from a model — a projection, a training-derived pace, an
    /// equivalence off the Daniels table. Carries the amber tilde.
    case modelled
    /// We could not read this. Fault red, and never a real value beside it.
    case unreadable
}

// MARK: - The value

/// A number on its way to the screen, carrying its own provenance.
///
/// Construct through the three named cases. There is no untyped initialiser
/// on purpose — see the file header.
struct FaffValue: Equatable, Hashable {
    /// The formatted value. Already a string: formatting is the caller's
    /// business, provenance is this type's.
    let text: String
    let basis: FaffBasis

    private init(text: String, basis: FaffBasis) {
        self.text = text
        self.basis = basis
    }

    /// Read from something that happened.
    static func measured(_ text: String) -> FaffValue { .init(text: text, basis: .measured) }

    /// Derived from a model. Renders with the amber tilde.
    static func modelled(_ text: String) -> FaffValue { .init(text: text, basis: .modelled) }

    /// We could not read it.
    static let unreadable = FaffValue(text: "—", basis: .unreadable)

    /// The common shape at a call site: an optional the engine may not have
    /// been able to produce. Nil becomes `.unreadable` rather than an empty
    /// string, because a blank space reads as "zero", not as "unknown".
    static func measured(_ text: String?) -> FaffValue {
        text.map { .measured($0) } ?? .unreadable
    }

    static func modelled(_ text: String?) -> FaffValue {
        text.map { .modelled($0) } ?? .unreadable
    }

    /// Build from the engine's own flag. Use this wherever a payload carries
    /// a projected/measured discriminator, so the screen never re-decides it.
    static func from(_ text: String?, modelled: Bool) -> FaffValue {
        guard let text else { return .unreadable }
        // THE TILDE MARKS A FIGURE. A phrase carries none.
        //
        // The mark means "this number is estimated, not read". Applied to
        // words it says nothing and reads as a typo: the Races decision card
        // renders its safe target as a value, and on the returning-from-injury
        // variant that target is the phrase "Finish healthy" — which came out
        // as "~Finish healthy". Same for any target the engine words rather
        // than counts.
        //
        // Rule one is not weakened by this: a value with no digits cannot be
        // over- or under-stated, so there is nothing for the mark to protect.
        // The moment a digit appears the mark comes back.
        // Renders plainly either way: a measured value, or a modelled phrase
        // with no figure in it to qualify.
        guard modelled, text.contains(where: \.isNumber) else { return .measured(text) }
        return .modelled(text)
    }

    /// True when this value must not be presented as evidence of fitness.
    var isModelled: Bool { basis == .modelled }
}

// MARK: - Rendering

/// The one way a `FaffValue` reaches the screen.
///
/// The tilde is a separate, smaller, amber run set immediately before the
/// value with no space, exactly as the design draws it. It is not part of the
/// string: putting it in the string would let it be copied, truncated, or
/// formatted away, and would let a caller fake it.
struct FaffValueText: View {
    let value: FaffValue
    var font: Font
    /// The ink for a measured value. A modelled value uses this too — only
    /// the MARK is amber, never the number, or "modelled" would start to read
    /// as "out of range".
    var color: Color = V5.textPrimary
    /// The tilde renders at this fraction of the value's size.
    var markScale: CGFloat = 0.62
    /// The ink for the MARK, which is amber everywhere except on the two
    /// light day-state ramps.
    ///
    /// ─────────────────────────────────────────────────────────────────────
    /// WHY THIS IS A PARAMETER AND NOT A CONSTANT
    ///
    /// It was `V5.attention` outright, which was correct while every gradient
    /// panel was dark. Round three gave the quality and race ramps dark ink,
    /// and those two ramps OPEN ON THE MARK'S OWN COLOUR — their first stops
    /// are the warm amber-orange the attention token is drawn from, and amber
    /// on them measures about 1.05:1. On 8c the tilde in front of the watch
    /// time was a faint squiggle that is not there at a glance.
    ///
    /// That is rule one failing in the one place it is load-bearing: a
    /// modelled number whose mark cannot be seen IS a number that looks
    /// measured. The screen's whole job is to refuse to promote that time.
    ///
    /// So on a light ramp the mark takes the panel's own ink. It stops being
    /// amber, which is a real loss — amber is what makes the mark catch the
    /// eye. But nothing amber can catch the eye on an amber field, and a
    /// legible mark in the wrong colour beats an invisible one in the right
    /// colour. The alternative is a second, darker amber, which is a new hex
    /// against a byte-locked palette and a designer's call, not a build's.
    /// Flagged in the report rather than taken.
    var mark: Color = V5.attention

    init(_ value: FaffValue,
         font: Font,
         color: Color = V5.textPrimary,
         markScale: CGFloat = 0.62,
         mark: Color = V5.attention) {
        self.value = value
        self.font = font
        self.color = color
        self.markScale = markScale
        self.mark = mark
    }

    var body: some View {
        switch value.basis {
        case .measured:
            Text(value.text)
                .font(font)
                .foregroundStyle(color)

        case .modelled:
            HStack(alignment: .firstTextBaseline, spacing: 0) {
                Text(Theme.V5.modelledMark)
                    .font(font)
                    .scaleEffect(markScale, anchor: .bottomTrailing)
                    .foregroundStyle(mark)
                    .accessibilityLabel("estimated")
                Text(value.text)
                    .font(font)
                    .foregroundStyle(color)
            }
            .accessibilityElement(children: .combine)

        case .unreadable:
            Text(value.text)
                .font(font)
                .foregroundStyle(V5.fault)
                .accessibilityLabel("could not be read")
        }
    }
}

extension FaffValue {
    /// Sugar for the overwhelmingly common call.
    func text(_ font: Font, color: Color = V5.textPrimary) -> FaffValueText {
        FaffValueText(self, font: font, color: color)
    }
}

// MARK: - Formatting
//
// Every numeral in this app is tabular — `Font.faffText`/`faffDisplay` switch
// the OpenType `tnum` feature on by default, because Instrument Sans's own
// digits are genuinely proportional (391–666 upem) and a live pace would
// visibly jitter without it. `.monospacedDigit()` is a system-font guarantee
// and does nothing for a custom face.

enum FaffFmt {

    /// `7:42` from seconds per mile. The app's pace format everywhere.
    static func pace(secPerMi: Double?) -> String? {
        guard let s = secPerMi, s.isFinite, s > 0 else { return nil }
        let total = Int(s.rounded())
        return "\(total / 60):" + String(format: "%02d", total % 60)
    }

    /// `7:42/mi`.
    static func paceUnit(secPerMi: Double?) -> String? {
        pace(secPerMi: secPerMi).map { $0 + "/mi" }
    }

    /// `7:38–7:52` — a target band. Nil unless both edges read.
    static func paceBand(lowSecPerMi: Double?, highSecPerMi: Double?) -> String? {
        guard let lo = pace(secPerMi: lowSecPerMi), let hi = pace(secPerMi: highSecPerMi) else { return nil }
        return "\(lo)–\(hi)"
    }

    /// `1:41:53` past an hour, `41:53` below it. Elapsed time and finish time.
    static func clock(sec: Double?) -> String? {
        guard let s = sec, s.isFinite, s >= 0 else { return nil }
        let t = Int(s.rounded())
        let h = t / 3600, m = (t % 3600) / 60, sec = t % 60
        return h > 0
            ? "\(h):" + String(format: "%02d:%02d", m, sec)
            : "\(m):" + String(format: "%02d", sec)
    }

    /// `1:41:53` always, hours included even at zero. A goal or a projection.
    static func raceTime(sec: Double?) -> String? {
        guard let s = sec, s.isFinite, s >= 0 else { return nil }
        let t = Int(s.rounded())
        return "\(t / 3600):" + String(format: "%02d:%02d", (t % 3600) / 60, t % 60)
    }

    /// `6.2` · a distance, one decimal, trailing `.0` kept off whole numbers.
    static func miles(_ mi: Double?) -> String? {
        guard let mi, mi.isFinite, mi >= 0 else { return nil }
        let r = (mi * 10).rounded() / 10
        return r == r.rounded() ? String(Int(r)) : String(format: "%.1f", r)
    }

    /// `6.2 mi`.
    static func milesUnit(_ mi: Double?) -> String? {
        miles(mi).map { $0 + " mi" }
    }

    /// `+24 s/mi` · a signed per-zone pace move. Slower is positive, which is
    /// the direction the engine reports, and the sign is always drawn.
    static func paceDeltaSec(_ sec: Double?) -> String? {
        guard let sec, sec.isFinite else { return nil }
        let v = Int(sec.rounded())
        return (v > 0 ? "+" : v < 0 ? "−" : "") + "\(abs(v)) s/mi"
    }

    /// `152` bpm.
    static func bpm(_ v: Double?) -> String? {
        guard let v, v.isFinite, v > 0 else { return nil }
        return String(Int(v.rounded()))
    }

    /// `1.5` for a treadmill incline, `7.2` for a speed. One decimal, always.
    static func oneDecimal(_ v: Double?) -> String? {
        guard let v, v.isFinite else { return nil }
        return String(format: "%.1f", v)
    }

    /// `340 ft`.
    static func feet(_ ft: Double?) -> String? {
        guard let ft, ft.isFinite else { return nil }
        return "\(Int(ft.rounded())) ft"
    }
}
