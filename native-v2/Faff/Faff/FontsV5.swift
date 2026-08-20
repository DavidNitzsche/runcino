//
//  FontsV5.swift
//  faff.run iPhone · v5 typography.
//
//  Two families, per design_handoff_faff_iphone_app v5:
//
//    · Instrument Sans — all interface text and numerals, TABULAR FIGURES.
//    · Archivo, weight 800, width 112, uppercase — the display register,
//      used as the graphic itself (session type, screen headline).
//      Not used below 20px.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHAT A DEVELOPER TYPES
//
//  Prefer the helpers at the bottom of this file (`.faffText`, `.faffDisplay`)
//  — they set the variation axes and the tabular-figure feature for you.
//
//  The names, enumerated from the shipped binaries after registering them with
//  CoreText (not read off a foundry page):
//
//    family "Instrument Sans"   styles Regular · Medium · SemiBold · Bold
//      PostScript  InstrumentSans-Regular
//                  InstrumentSans-Regular_Medium
//                  InstrumentSans-Regular_SemiBold
//                  InstrumentSans-Regular_Bold
//
//    family "Archivo"           styles Thin … ExtraBold · Black
//      PostScript  Archivo-SemiBold          (the default instance, wght 600)
//                  ArchivoRoman-Regular … ArchivoRoman-ExtraBold · -Black
//
//  Two cautions before typing one of those into `Font.custom`:
//
//    · Everything with an underscore in it is a name CoreText SYNTHESISED.
//      Instrument Sans's named instances carry no PostScript name records of
//      their own, so `InstrumentSans-Regular_SemiBold` is generated, not
//      authored, and is not a stable contract across OS versions. Set the wght
//      axis instead.
//
//    · Every Archivo named instance sits at wdth 100. The design asks for
//      wght 800 at wdth 112, which is not a named instance at all — it exists
//      only as a point in the variation space, so `ArchivoRoman-ExtraBold`
//      gives you the right weight at the wrong width.
//
//  Both faces are therefore reached by setting axes, never by name. That is
//  what `Font.faffText` and `Font.faffDisplay` do. Verified: asking for
//  wght 800 / wdth 112 returns a CTFont whose resolved variation is exactly
//  {wght: 800, wdth: 112} in family "Archivo".
//
//  ─────────────────────────────────────────────────────────────────────────
//  TABULAR FIGURES
//
//  Verified against the bundled binaries rather than assumed. Instrument Sans's
//  DEFAULT figures are proportional — the digits run 391 to 666 units wide at
//  1000 upem, so a live pace or a countdown would visibly jitter. Its `tnum`
//  feature maps every digit to a `.tf` variant, all 600 units. Archivo's default
//  digits are 575–577 (near-tabular but not equal); `tnum` snaps them to 579.
//  Both features exist in the shipped files and both are applied here through
//  the OpenType feature tag, not through `.monospacedDigit()`.
//
//  ─────────────────────────────────────────────────────────────────────────
//  PROVENANCE AND LICENCE
//
//  Both files are the unmodified upstream Google Fonts releases, renamed only
//  (bracketed axis filenames do not survive a plist round-trip cleanly):
//
//    Resources/Fonts/InstrumentSans-Variable.ttf
//      ← google/fonts ofl/instrumentsans/InstrumentSans[wdth,wght].ttf
//      sha256 b24f1812584816958afcf22e22d08e44318c5e51651e25d2438efdde389b33b1
//      Copyright 2022 The Instrument Sans Project Authors · SIL OFL 1.1
//
//    Resources/Fonts/Archivo-Variable.ttf
//      ← google/fonts ofl/archivo/Archivo[wdth,wght].ttf
//      sha256 0e094a7d3c7c4c25cf1310c4b30014f1dae9332220b1c2c88f4fa996f0b05053
//      Copyright 2020 The Archivo Project Authors · SIL OFL 1.1
//
//  SIL OFL 1.1 permits bundling in and distribution with an application,
//  including a paid one, with no attribution surfaced in the UI. Neither
//  copyright line declares a Reserved Font Name, so the files may also be
//  modified or subsetted later if the bundle size matters. The one binding
//  condition is that the licence travels with the font: OFL-InstrumentSans.txt
//  and OFL-Archivo.txt sit beside the TTFs in Resources/Fonts and ship inside
//  the app bundle. Keep them there. The fonts may not be sold on their own.
//

import SwiftUI
import UIKit
import CoreText

// MARK: - Names

enum FaffFaceV5 {
    /// Interface text and numerals.
    static let textFamily      = "Instrument Sans"
    static let textPostScript  = "InstrumentSans-Regular"

    /// The display register. CoreText reports the family as "Archivo" (the
    /// typographic family, name ID 16); the file's name ID 1 is the less useful
    /// "Archivo SemiBold", after its default instance.
    static let displayFamily     = "Archivo"
    static let displayPostScript = "Archivo-SemiBold"

    /// The design's display register: Archivo 800 at width 112, uppercase.
    static let displayWeight: Double = 800
    static let displayWidth:  Double = 112
    /// Below this the display face is not used at all — fall back to text.
    static let displayMinSize: CGFloat = 20
}

/// Instrument Sans weights the design uses. The family's axis stops at 700.
enum InstrumentWeight: Double {
    case regular  = 400
    case medium   = 500
    case semibold = 600
    case bold     = 700

    var systemWeight: Font.Weight {
        switch self {
        case .regular:  return .regular
        case .medium:   return .medium
        case .semibold: return .semibold
        case .bold:     return .bold
        }
    }
}

// MARK: - Variable-axis + feature plumbing

enum FaffCoreTextV5 {

    /// Four-character axis tag as the OSType CoreText wants.
    static func axisTag(_ tag: String) -> Int {
        tag.utf8.reduce(0) { ($0 << 8) | Int($1) }
    }

    /// Build a CTFont at explicit variation coordinates, optionally with
    /// tabular figures switched on. Returns nil if the face is not registered,
    /// so callers can fall back rather than silently rendering San Francisco.
    static func font(postScriptName: String,
                     size: CGFloat,
                     axes: [String: Double],
                     tabularFigures: Bool) -> CTFont? {
        guard UIFont(name: postScriptName, size: size) != nil else { return nil }

        var attributes: [CFString: Any] = [kCTFontNameAttribute: postScriptName as CFString]

        if !axes.isEmpty {
            var variation: [NSNumber: NSNumber] = [:]
            for (tag, value) in axes {
                variation[NSNumber(value: axisTag(tag))] = NSNumber(value: value)
            }
            attributes[kCTFontVariationAttribute] = variation as CFDictionary
        }

        if tabularFigures {
            // OpenType tag form, not `.monospacedDigit()`: the SwiftUI modifier
            // is defined for the system font's digit variant and is not a
            // guarantee for a custom face. `tnum` is present in both bundled
            // binaries (verified against the shipped TTFs).
            attributes[kCTFontFeatureSettingsAttribute] = [
                [
                    kCTFontOpenTypeFeatureTag:   "tnum",
                    kCTFontOpenTypeFeatureValue: 1,
                ]
            ] as CFArray
        }

        let descriptor = CTFontDescriptorCreateWithAttributes(attributes as CFDictionary)
        return CTFontCreateWithFontDescriptor(descriptor, size, nil)
    }
}

// MARK: - The two registers

extension Font {

    /// Instrument Sans. Interface text and numerals.
    ///
    /// - Parameters:
    ///   - size: point size. The design renders nothing below 12.
    ///   - weight: 400 / 500 / 600 / 700.
    ///   - width: the wdth axis, 75–100. 100 unless you are deliberately
    ///     condensing a value that would otherwise wrap.
    ///   - tabular: tabular figures. Default on — the design relies on them
    ///     everywhere numerals sit in a column or tick live.
    static func faffText(_ size: CGFloat,
                         weight: InstrumentWeight = .regular,
                         width: Double = 100,
                         tabular: Bool = true) -> Font {
        if let ct = FaffCoreTextV5.font(
            postScriptName: FaffFaceV5.textPostScript,
            size: size,
            axes: ["wght": weight.rawValue, "wdth": width],
            tabularFigures: tabular
        ) {
            return Font(ct)
        }
        let fallback = Font.system(size: size, weight: weight.systemWeight)
        return tabular ? fallback.monospacedDigit() : fallback
    }

    /// Archivo 800 at width 112 — the display register, always uppercase at the
    /// call site (`.textCase(.uppercase)`). Not for use below 20pt; smaller
    /// callers get the text face instead rather than a squashed display face.
    static func faffDisplay(_ size: CGFloat, tabular: Bool = true) -> Font {
        guard size >= FaffFaceV5.displayMinSize else {
            return faffText(size, weight: .bold, tabular: tabular)
        }
        if let ct = FaffCoreTextV5.font(
            postScriptName: FaffFaceV5.displayPostScript,
            size: size,
            axes: ["wght": FaffFaceV5.displayWeight, "wdth": FaffFaceV5.displayWidth],
            tabularFigures: tabular
        ) {
            return Font(ct)
        }
        let fallback = Font.system(size: size, weight: .heavy).width(.expanded)
        return tabular ? fallback.monospacedDigit() : fallback
    }
}

// MARK: - The registers the design names

/// The point sizes the v5 screens use. New views pick a rung rather than a
/// number that sits between two.
enum TypeScaleV5 {
    /// Display face (Archivo 800/112, uppercase).
    static let display76: CGFloat = 76
    static let display56: CGFloat = 56
    static let display44: CGFloat = 44
    static let display38: CGFloat = 38
    /// Numerals — the value register spans 28 to 104.
    static let valueMin: CGFloat = 28
    static let valueMax: CGFloat = 104
    /// Body.
    static let body17: CGFloat = 17
    static let body15: CGFloat = 15
    /// Labels. Nothing in the design renders below 12.
    static let label14: CGFloat = 14
    static let label13: CGFloat = 13
    static let label12: CGFloat = 12
    static let floor:   CGFloat = 12
}

/// Which of the three things wearing the display register this is.
/// See `View.faffDisplayV5` for what each one breaks like and why.
enum DisplayFit {
    case graphic
    case name
    case free
}

extension View {
    /// The display recipe: Archivo 800/112, uppercase, and it does not clip.
    ///
    /// ─────────────────────────────────────────────────────────────────────
    /// WHY THIS SHRINKS, MEASURED RATHER THAN GUESSED
    ///
    /// The design asks for the session type at 56px in the display register,
    /// and for that register to be uppercase. Measured against the real
    /// binary at wght 800 / wdth 112, in the panel's own 350pt box
    /// (390 frame, 20pt panel padding each side):
    ///
    ///     THRESHOLD   411.8pt      Threshold   314.0pt
    ///     LONG RUN    346.0pt      Long run    271.1pt
    ///     EASY        177.4pt      Easy        153.6pt
    ///
    /// So the longest ordinary session type overflows by 62pt uppercase, and
    /// fits with room to spare in mixed case. Both instructions in the handoff
    /// are real — "treat pixel measurements as exact" and "uppercase" — and on
    /// this one word they cannot both hold.
    ///
    /// Wrapping is the worst of the three outcomes: it turns the graphic into
    /// two ragged lines and pushes everything below it down, which breaks the
    /// rule that nothing reflows. Clipping is worse still. So the size holds
    /// wherever it fits — which is every headline in the design except this
    /// one — and the rare long word shrinks to the width instead of breaking
    /// the layout. 0.82 covers THRESHOLD at 0.85 with margin.
    ///
    /// Flagged to David: if the intent was mixed case at 56, drop the
    /// `.textCase` here and every screen follows, because no screen sets it
    /// itself.
    ///
    /// ─────────────────────────────────────────────────────────────────────
    /// WHERE THE UPPERCASE ACTUALLY APPLIES, ALSO MEASURED
    ///
    /// The README calls the display register "uppercase — used as the graphic
    /// itself (session type, screen headline)", and lists its sizes as
    /// 76 / 56 / 44 / 38. Those are the graphic. The prototype ALSO puts the
    /// display face on smaller things that are not graphics — the 26pt date
    /// line, the 20pt place label, the 15pt group headers — and the 26pt one
    /// does not survive the transform:
    ///
    ///     THURSDAY 20 AUGUST   ~402pt      Thursday 20 August   ~290pt
    ///
    /// against roughly 200pt of a row it shares with the week line. Uppercased
    /// it wraps to two lines and shoves the whole panel down. So the transform
    /// applies at the sizes the README names as the graphic, and not below
    /// them. The place label and the group headers are short enough that the
    /// rule never bites them, and they carry their own tracking anyway.
    ///
    /// Flagged to David along with the fit behaviour: both live here, and
    /// both move every screen at once.
    ///
    /// ─────────────────────────────────────────────────────────────────────
    /// THREE THINGS WEAR THIS REGISTER, AND THEY BREAK DIFFERENTLY
    ///
    /// All three were one boolean, and each wrong setting shipped a different
    /// failure to the screen before this enum existed.
    ///
    /// `.graphic` — a category word: EASY, THRESHOLD, MAINTENANCE, the phase.
    ///   One line, always. It may shrink but it may never lose a letter, and
    ///   it may never break: a broken category word is not a graphic. The
    ///   floor is 0.5 because MAINTENANCE needs 0.64 in a 322pt box, and
    ///   28pt Archivo 800 is still a graphic.
    ///
    /// `.name` — a proper noun of arbitrary length: a race. "MY HALF MARATHON"
    ///   needs 778pt at 56 and fits at NO scale on one line. Forced to one
    ///   line it truncated; allowed to wrap freely it broke mid-word into
    ///   "MY HALF / MARATHO / N". So: up to two lines, scaled to fit, which
    ///   lets it break at the space instead of inside the word.
    ///
    /// `.free` — a register that may legitimately run long and whose wrapping
    ///   costs nothing because the panel scrolls. The 26pt date line: on a 390
    ///   device the panel gives 350pt, the week line takes 111 and the gap 12,
    ///   leaving 227, and "Wednesday 30 September" wants ~353. No floor that
    ///   keeps 26pt legible covers that, and the prototype's own row is a
    ///   plain CSS flex row that simply wraps.

    func faffDisplayV5(_ size: CGFloat, fit: DisplayFit = .graphic) -> some View {
        self
            .font(.faffDisplay(size))
            .textCase(size >= TypeScaleV5.display38 ? .uppercase : nil)
            .lineLimit(fit == .graphic ? 1 : fit == .name ? 2 : nil)
            .minimumScaleFactor(fit == .free ? 1 : 0.5)
    }
}
