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

    /// THE RUNNER EXPLICITLY DECLINED THIS DAY. One wording, one owner.
    ///
    /// `day_actions action='skip'`, stated plainly and never judged — the same
    /// coach-voice rule the rest of this surface follows.
    ///
    /// It lives here because it is now drawn by two unrelated views:
    /// `PlanSnapshotDayView`, which says it as a line under the headline, and
    /// the training-calendar sheet, which says it in a day row's status
    /// column. Rule 16 wants one canonical presentation of a fact, not a
    /// second one that drifts — and a status column and a body line are
    /// exactly the pair that drifts, because nobody edits both.
    ///
    /// `.measured`, deliberately: a skip is something the runner did and the
    /// server recorded, not something the engine inferred.
    static let skipped = FaffValue(text: "Skipped.", basis: .measured)

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

    /// WHAT A SCREEN READER SAYS. MARKER-RESTORE-1 (2026-09-09) · between
    /// 2026-08-21 and today this was the ONLY thing carrying rule one at the
    /// point of render, while the visible tilde was retired. David has since
    /// reinstated the visible mark (see `FaffValueText.body`'s `.modelled`
    /// case for the full history) — this string is now the COMPLEMENT to the
    /// glyph, not its replacement, exactly per his own framing: "VoiceOver is
    /// complementary, not a replacement for visible provenance."
    ///
    /// It lives here rather than inline in `FaffValueText.body` so it can be
    /// tested independently of whether the glyph is drawn.
    var voiceOverLabel: String {
        switch basis {
        case .measured:   return text
        case .modelled:   return "estimated \(text)"
        case .unreadable: return "could not be read"
        }
    }
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
    /// The ink of the tilde itself.
    ///
    /// Amber everywhere the ground is dark, which is almost everywhere. The
    /// exception is a LIGHT day-state panel, where amber-on-amber measures
    /// 1.45:1 and the one glyph carrying rule one becomes the least legible
    /// thing on the screen. Those call sites pass `panelInk.mark`, which keeps
    /// the tilde and drops the hue. See `V5.PanelInk.mark`.
    var mark: Color = V5.attention
    /// The ink of the unreadable dash.
    ///
    /// A FAULT MARK HAS TO BE VISIBLE TO BE A FAULT MARK.
    ///
    /// This was hard-coded to `V5.fault` inside the `.unreadable` case below,
    /// on the same reasoning that once hard-coded the tilde to `V5.attention`:
    /// fault red measures 6.6:1 on a tile and that is the surface it was
    /// checked against. On a day-state gradient it fails on all six ramps, and
    /// worst of all on `race` — 1.02:1 on the stats plate, where the
    /// "Projected finish" stat lives and where a dash is the WHOLE content of
    /// the slot. See `V5.PanelInk.fault` for the measurements and for why the
    /// on-panel answer is the panel's own ink rather than a second red.
    ///
    /// Defaults to `V5.fault`, which is right off a panel and wrong on one, so
    /// every call site drawn inside a `DayPanel` passes `panelInk.fault` — the
    /// same discipline `mark` above already carries, checked the same way by
    /// `scripts/check-panel-ink.sh`.
    var fault: Color = V5.fault

    init(_ value: FaffValue,
         font: Font,
         color: Color = V5.textPrimary,
         markScale: CGFloat = 0.62,
         mark: Color = V5.attention,
         fault: Color = V5.fault) {
        self.value = value
        self.font = font
        self.color = color
        self.markScale = markScale
        self.mark = mark
        self.fault = fault
    }

    var body: some View {
        switch value.basis {
        case .measured:
            Text(value.text)
                .font(font)
                .foregroundStyle(color)

        case .modelled:
            // THE MARK IS DRAWN AGAIN (2026-09-09) · MARKER-RESTORE-1.
            //
            // Retired 2026-08-21 on David's own ruling ("we dont need the
            // tilde. its obvious and implied the number is calculated"), kept
            // as a one-line-back change per this file's own comment at the
            // time. David has now explicitly reversed that, in the terms he
            // used: "Treat the current brief as authoritative: modelled
            // numbers must visibly carry the amber `~` marker. An older
            // August ruling does not override the current explicit
            // design-system requirement." The current design handoff
            // (`design_handoff_faff_iphone_app v5/README.md`, locked
            // 2026-08-19, restated in `docs/faff-iphone-design-contract.md`
            // §1) states it as a system rule, not a per-screen choice: "A
            // modelled/projected number... carries a small amber `~` (tilde)
            // immediately before its value — the app's one mark for 'this
            // number is estimated'... Apply it everywhere a number is
            // estimated." `check-modelled-mark.sh`'s own header already
            // quoted that same contract line and Guard 2 already assumed
            // this is where the glyph lives — the gate's documentation and
            // this file's rendering had quietly drifted apart since 08-21;
            // this closes that gap rather than opening a new one.
            //
            // VoiceOver is UNCHANGED, not replaced: `value.voiceOverLabel`
            // still says "estimated" before the figure for a reader who
            // cannot see the glyph at all — visible and spoken provenance are
            // both required, per David's explicit "VoiceOver is
            // complementary, not a replacement for visible provenance."
            HStack(alignment: .firstTextBaseline, spacing: 0) {
                Text(Theme.V5.modelledMark)
                    .font(font)
                    .scaleEffect(markScale, anchor: .bottomTrailing)
                    .foregroundStyle(mark)
                    .accessibilityHidden(true)
                Text(value.text)
                    .font(font)
                    .foregroundStyle(color)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(value.voiceOverLabel)

        case .unreadable:
            // `fault`, not `V5.fault`. On a gradient panel the red is
            // invisible against the ground — see the property's own comment.
            Text(value.text)
                .font(font)
                .foregroundStyle(fault)
                .accessibilityLabel(value.voiceOverLabel)
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

    /// `2.40` · a distance on a console being read MID-STRIDE. Two decimals.
    ///
    /// `miles` above is right everywhere a distance is a finished fact, and
    /// wrong while one is accumulating: it holds at "0" for the first 0.05 mi
    /// and then steps a tenth at a time, so a live tile reads as broken for the
    /// first few hundred metres of every run and as frozen for forty seconds at
    /// a stretch after that. The shipped legacy console used two decimals here
    /// for exactly that reason.
    ///
    /// 2026-08-25 · this lived as a private `static func liveMiles` on
    /// `LiveRunOutdoorV5`, with that argument written out beside it — and the
    /// TREADMILL console, the other live console in the same set, went on
    /// calling `miles`. Driven on a simulator its DIST tile read a bare "0" at
    /// eight seconds while the outdoor one read "2.40": one product, two live
    /// consoles, two distance formats, and the diagnosis for the defect sitting
    /// in a doc comment the other file could not reach. One definition, both
    /// consoles. Optional in, optional out, so a distance that cannot be
    /// formatted stays unreadable rather than becoming a confident zero.
    static func liveMiles(_ mi: Double?) -> String? {
        guard let mi, mi.isFinite, mi >= 0 else { return nil }
        return String(format: "%.2f", mi)
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
