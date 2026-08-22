//
//  WatchThemeV5.swift
//  FaffWatch
//
//  The 0821 watch handoff, as tokens.
//
//  SOURCE OF TRUTH — do not reconcile these values against anything else:
//    /Volumes/WP/06 Claude Code/Faff/design/0821/design_handoff_faff_watch_app/
//      README.md + Faff-Watch-App.dc.html      (53 boards, 15:49 2026-08-21)
//    /Volumes/WP/06 Claude Code/Faff/design/0821/design_handoff_0821_addendum/
//      README.md + the two board files          (six screens, 16:17 2026-08-21)
//  Audit + build sequencing: docs/design/watch-0821/AUDIT.md
//
//  This is the v5 token family — the same one the phone carries in
//  ThemeV5.swift — extended to the wrist. Surface steps, signal orange,
//  attention amber, fault red and the six day-state ramps are byte-identical
//  to the phone. The wrist ADDS one token the phone does not have and may not
//  have: band green.
//
//  WHY GREEN EXISTS HERE AND NOWHERE ELSE IN THE PRODUCT
//
//  The phone and web have no green as a grade, on purpose — they are surfaces
//  where a number is argued about, and a green number ends the argument before
//  it starts. The wrist is the one surface where the runner has a single
//  instrument and a single question: am I holding it. So on the wrist, and
//  only on the wrist, colour GRADES: green inside the prescribed band, amber
//  outside it, on the one value the session is asking the runner to hold.
//  Handoff rule 1. It is a sanctioned exception, argued for in the handoff,
//  and it is the reason a running face may not colour anything else — a
//  coloured number is read as a graded number, so a second coloured figure
//  reads as a second verdict.
//
//  THE LEGACY PALETTE IS STILL LIVE
//
//  `Faff.*` in FaceKit.swift and `WatchTheme.C` still back every existing
//  face. They are the brief-v2 ten-colour palette and they are being retired
//  face by face, not in one sweep — a half-migrated skin on a device is the
//  outcome worth avoiding. check-palette-sync.sh asserts BOTH palettes while
//  both have consumers, and the watch legacy branch expires on its own: when
//  the last face stops referencing a legacy token, the gate stops asserting
//  the old values and starts requiring their declarations be deleted. Nobody
//  has to remember to come back.
//
//  New face code uses WatchV5 only. Do not add a `Faff.*` call site.
//

import SwiftUI
import CoreText

// MARK: - Color(hex:)
//
// This lived in FaceKit.swift, the LEGACY face kit, until 2026-08-21. Two
// reasons it moved here, one structural and one that broke a build:
//
//  1. FaceKit is scheduled for deletion. When the last face migrates off the
//     brief-v2 palette, check-palette-sync.sh inverts and demands the Faff
//     enum and Role be removed. Every token in this file would have gone with
//     them. A token layer may not depend on the layer it replaces.
//
//  2. The widget extension target compiles WatchThemeV5.swift and does NOT
//     compile FaceKit.swift - correctly, since a complication has no business
//     with the old face kit. That produced 60 "no exact matches in call to
//     initializer" errors in this file the moment the target was added, all
//     of them cascade from one missing extension.
//
// FaceKit still calls Color(hex:) and still resolves it: same module, same
// target. It just no longer OWNS it.
extension Color {
    init(hex: UInt32) {
        self.init(
            red:   Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue:  Double(hex & 0xFF) / 255
        )
    }
}

enum WatchV5 {

    // ───── Ground and containment ─────
    // True black on every running board — an OLED wrist at 6am, and the
    // gradient boards are the only place colour fills a screen. Four surface
    // steps above it, and NO BORDERS ANYWHERE: containment is a fill-step
    // change, never a hairline. The rounded shells and bezels in the design
    // file are presentation for the design file, not part of the app.
    static let ground   = Color(hex: 0x000000)
    static let surface1 = Color(hex: 0x0F1011)
    static let surface2 = Color(hex: 0x17191B)
    static let surface3 = Color(hex: 0x212427)   // quiet target fill
    static let surface4 = Color(hex: 0x2A2E32)   // pressed / raised

    // ───── The four signals ─────

    /// Pace is inside the prescribed band. THE ONLY METRIC THAT GRADES, and
    /// the only green in the product. Never on a second figure.
    static let band      = Color(hex: 0x3EBD41)

    /// Outside the band; a condition (battery, a provisional result); a
    /// decision waiting. Never means "error" — that is `fault`.
    static let attention = Color(hex: 0xF2B03C)

    /// A sensor we could not read. **Words only, never a figure.** A stale or
    /// greyed last-known number was explicitly rejected: it is worse than none,
    /// because the runner cannot tell it has stopped moving. Handoff rule 2.
    static let fault     = Color(hex: 0xFF4438)

    /// Drawn intent only — the wordmark dot and the kicker that says the coach
    /// is speaking. **Never on a number.** Handoff rule 3.
    static let signal    = Color(hex: 0xFF5A1F)

    // ───── Measured values ─────
    // Every value with no band is white, stepped. Treadmill runs stay white
    // THROUGHOUT: there is no trustworthy pace on a belt, so nothing grades,
    // and amber already carries out-of-band elsewhere.
    static let value     = Color.white                  // 1.0 · the reading
    static let valueDim  = Color.white.opacity(0.72)    // unit, secondary
    static let valueMute = Color.white.opacity(0.48)    // tertiary, and the
                                                        // stale prescription on
                                                        // the too-old-to-trust
                                                        // board
    /// Destructive verbs are drawn at this opacity as TEXT with no pill.
    /// "Discard it" / "Throw it away". A filled pill beside a filled pill is
    /// how a run gets thrown away by accident. Handoff rule 7.
    static let destructive = Color.white.opacity(0.42)

    // ───── Day-state gradients ─────
    // Byte-identical to Theme.V5.DayState on the phone — the ramp is the
    // session's identity across the whole product, so it may not drift between
    // surfaces. 135°, three stops, interpolated in oklab in the design.
    // SwiftUI interpolates in the working colour space, not oklab, so the
    // STOPS are the locked part and the midpoint is the renderer's.
    //
    // On the wrist these fill the lobby, the pre-session boards and the Smart
    // Stack widget — a whole screen, which is exactly why they are allowed to
    // be colourful when a running face is not. A ramp filling a board cannot
    // be mistaken for a verdict on one figure.
    //
    // `v5stop` exempts these from the retired-hex tripwire in
    // check-palette-sync.sh: #FF8847, #E85D26 and #008FEC were retired under
    // the OLD phone palette and are restored by v5 as gradient stops only.
    enum DayState {
        static let easy:    [Color] = [Color(hex: 0x3EBD41), Color(hex: 0x1F8A52), Color(hex: 0x0F4A3A)] // v5stop
        static let rest:    [Color] = [Color(hex: 0x008FEC), Color(hex: 0x4A3A8E), Color(hex: 0x1C1A3A)] // v5stop
        static let quality: [Color] = [Color(hex: 0xF3AD38), Color(hex: 0xE85D26), Color(hex: 0x7A2828)] // v5stop
        static let race:    [Color] = [Color(hex: 0xFF8847), Color(hex: 0xE85D26), Color(hex: 0x7A2828)] // v5stop
        static let phase:   [Color] = [Color(hex: 0xB084FF), Color(hex: 0x6A4ACE), Color(hex: 0x2A1A5A)] // v5stop
        static let long:    [Color] = [Color(hex: 0x27B4E0), Color(hex: 0x1A6A9E), Color(hex: 0x0C2A5E)] // v5stop

        /// No session — off-season, a week off, injury, sick. A MUTED ramp,
        /// and it earns its own entry rather than being a grey wash: the
        /// board has no display word because there is no session type to
        /// name, so the ramp is the only thing saying which state this is.
        /// Its middle stop sits at 55%, not 76% — the ramp is flatter than a
        /// session ramp on purpose. Measured off the `No session` board.
        static let muted:   [Color] = [Color(hex: 0x8792A8), Color(hex: 0x5A6072), Color(hex: 0x25272E)]

        static let locations:      [Double] = [0.00, 0.76, 1.85]
        static let raceLocations:  [Double] = [0.00, 0.72, 1.85]
        static let mutedLocations: [Double] = [0.00, 0.55, 1.85]

        /// A fine grain layer sits OVER the colour and UNDER the type at 50%,
        /// overlay blend. It is what keeps white type legible on the ramp
        /// without a scrim. Not decoration — do not drop it.
        static let grainOpacity: Double = 0.5

        /// The ramp for a session, by the class the wire already carries
        /// (`SessionClass` in lib/watch/build-workout.ts).
        static func forSession(_ name: String) -> [Color] {
            switch name.lowercased() {
            case "race":                      return race
            case "threshold", "interval",
                 "tempo", "quality":          return quality
            case "long":                      return long
            case "rest":                      return rest
            case "phase":                     return phase
            case "none", "off", "muted":      return muted
            default:                          return easy
            }
        }

        static func locations(for name: String) -> [Double] {
            switch name.lowercased() {
            case "race":                 return raceLocations
            case "none", "off", "muted": return mutedLocations
            default:                     return locations
            }
        }
    }

    // ───── Type ─────
    //
    // Three registers, and the rule is that a register never leaves its role.
    //
    //  · TELEMETRY — SF Rounded Bold, tabular, tracking 0. Every number in the
    //    app. The rounded SYSTEM face, not a bundled one: the numbers were
    //    designed against it and it is the one face guaranteed to be present
    //    at every size on every watch.
    //  · DISPLAY — Archivo 800, width 112, uppercase. Session type on the
    //    lobby, moment words (GO / WORK / END RUN), notification titles.
    //    NEVER inside a running metric.
    //  · COACH — Instrument Sans 500. Every sentence the coach says, and the
    //    only face used for prose.
    //
    // Archivo at weight 800 / width 112 is NOT a named instance in the shipped
    // variable TTF, so `Font.custom("Archivo-ExtraBold")` returns nil and
    // silently falls back to San Francisco. It has to be reached by setting
    // the `wght` and `wdth` axes on a CTFontDescriptor — same problem the
    // phone solved in FontsV5.swift, same solution here, minus the UIKit
    // dynamic-type plumbing that does not exist on watchOS.

    /// Telemetry. Every number. Tabular by construction — a pace that shifts
    /// horizontally as the seconds tick is unreadable at arm's length.
    static func number(_ size: CGFloat) -> Font {
        .system(size: size, weight: .bold, design: .rounded)
            .monospacedDigit()
    }

    /// Display register. Uppercase at the call site, not here — the design
    /// uppercases the content, and lowercasing a string to re-uppercase it
    /// loses acronyms.
    static func display(_ size: CGFloat) -> Font {
        if let ct = WatchCoreText.font(postScriptName: FontNames.displayPostScript,
                                       size: size,
                                       axes: ["wght": 800, "wdth": 112],
                                       tabularFigures: false) {
            return Font(ct)
        }
        return .system(size: size, weight: .heavy).width(.expanded)
    }

    /// SF Rounded, for everything that is neither a coach sentence nor a
    /// display word: target labels, kickers, row labels, statements of fact.
    ///
    /// MEASURED, not assumed. The 0821 file declares `ui-rounded` 61 times and
    /// `Instrument Sans` 17, and every one of those 17 is a COACH SENTENCE -
    /// "Three are banked - the last three are where the session earns its
    /// name", "About 40 minutes - GPS is most of that spend". There is no
    /// Instrument Sans kicker, label or button in the whole design.
    ///
    /// So rounded is the DEFAULT register and the coach face is the exception,
    /// which is exactly what the README says in words: Instrument Sans is "the
    /// only face used for prose". A target label is not prose.
    ///
    /// No `monospacedDigit()` here - use `number()` for anything that ticks.
    static func label(_ size: CGFloat, _ weight: Font.Weight = .bold) -> Font {
        .system(size: size, weight: weight, design: .rounded)
    }

    /// Coach register. Prose only.
    static func coach(_ size: CGFloat, weight: Double = 500) -> Font {
        if let ct = WatchCoreText.font(postScriptName: FontNames.textPostScript,
                                       size: size,
                                       axes: ["wght": weight],
                                       tabularFigures: false) {
            return Font(ct)
        }
        return .system(size: size, weight: .medium)
    }

    enum FontNames {
        static let textFamily        = "Instrument Sans"
        static let textPostScript    = "InstrumentSans-Regular"
        static let displayFamily     = "Archivo"
        static let displayPostScript = "Archivo-SemiBold"
    }

    // ───── Metrics ─────
    //
    // Points, from the handoff's 2× set divided by two.
    enum Metric {
        /// The system clock owns the top corner and the app cannot restyle it,
        /// so the top of every board stays empty. Handoff rule 5.
        static let clockClearance: CGFloat = 22

        static let sidePadding:    CGFloat = 10   // 8-11 in the design
        static let bottomPadding:  CGFloat = 10   // 8-12

        /// EVERY target, no exceptions — including faults and confirmations.
        /// Full width, pill radius. The hand pressing them is wet and moving.
        /// Handoff rule 6.
        static let targetHeight:   CGFloat = 50
        static let targetGap:      CGFloat = 5
        /// Reading block to the target stack.
        static let readingToStack: CGFloat = 7

        static let rowRadius:      CGFloat = 10
        static let tileRadius:     CGFloat = 9    // 8-11
        static let widgetRadius:   CGFloat = 18

        /// Four metrics maximum on any running face, one left edge, and the
        /// metric that matters is first and ~20% larger than the next — so the
        /// hierarchy survives a runner who cannot distinguish the two hues.
        /// Handoff rule 4.
        static let maxMetricsPerFace = 4
        static let heroLeadRatio: CGFloat = 1.20
    }

    /// The one Unicode character with a job. Not an em dash — the product's
    /// copy rules forbid those, and this is the sanctioned separator.
    static let separator = "\u{00B7}"   // ·
}

// MARK: - Font registration
//
// watchOS has no `UIAppFonts` for this target, so the bundled TTFs are
// registered with CoreText at launch. Moved here from WatchTheme.swift when
// the legacy face kit was deleted — it was the one live thing left in that
// file, and losing it would silently drop Archivo and Instrument Sans to San
// Francisco everywhere at once, which is exactly the failure the family-name
// guard below exists to catch rather than to suffer.

enum WatchFonts {
    private static var registered = false

    static func register() {
        guard !registered else { return }
        registered = true
        var urls: [URL] = []
        urls += Bundle.main.urls(forResourcesWithExtension: "ttf", subdirectory: nil) ?? []
        urls += Bundle.main.urls(forResourcesWithExtension: "ttf", subdirectory: "Fonts") ?? []
        var seen = Set<String>()
        for url in urls where seen.insert(url.lastPathComponent).inserted {
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }
}

// MARK: - Variable-axis plumbing
//
// The portable half of the phone's FaffCoreTextV5. No UIKit: watchOS has no
// UIApplication, and the registration probe is done by asking CoreText what
// family it actually produced rather than by constructing a UIFont. If the
// face is not registered CoreText silently substitutes San Francisco, and a
// silent substitution is exactly what this guard exists to catch — the caller
// falls back deliberately instead.

enum WatchCoreText {

    /// Four-character axis tag as the OSType CoreText wants.
    static func axisTag(_ tag: String) -> Int {
        tag.utf8.reduce(0) { ($0 << 8) | Int($1) }
    }

    static func font(postScriptName: String,
                     size: CGFloat,
                     axes: [String: Double],
                     tabularFigures: Bool) -> CTFont? {

        var attributes: [CFString: Any] = [kCTFontNameAttribute: postScriptName as CFString]

        if !axes.isEmpty {
            var variation: [NSNumber: NSNumber] = [:]
            for (tag, value) in axes {
                variation[NSNumber(value: axisTag(tag))] = NSNumber(value: value)
            }
            attributes[kCTFontVariationAttribute] = variation as CFDictionary
        }

        if tabularFigures {
            attributes[kCTFontFeatureSettingsAttribute] = [
                [
                    kCTFontOpenTypeFeatureTag:   "tnum",
                    kCTFontOpenTypeFeatureValue: 1,
                ]
            ] as CFArray
        }

        let descriptor = CTFontDescriptorCreateWithAttributes(attributes as CFDictionary)
        let produced = CTFontCreateWithFontDescriptor(descriptor, size, nil)

        // Did we get the face we asked for, or San Francisco wearing its name?
        let family = CTFontCopyFamilyName(produced) as String
        let wanted = postScriptName.hasPrefix("Archivo")
            ? WatchV5.FontNames.displayFamily
            : WatchV5.FontNames.textFamily
        guard family == wanted else { return nil }

        return produced
    }
}
