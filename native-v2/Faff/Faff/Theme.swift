//
//  Theme.swift
//  faff.run v3 design tokens — single source of truth.
//
//  Canonical reference:
//    Faff/shared/tokens.json (v1.4.0)
//    Faff/design/tokens/typography.css (Oswald 700 lock-in 2026-05-28)
//    Runcino/web-v2/app/globals.css (mirror for the production web client)
//
//  v3 changes vs v2 (2026-05-28 cutover):
//    · Display font swap from HelveticaNeue-Bold → Oswald 700
//    · Added: 12 state gradients (Theme.Gradient.easy, .quality, .long, ...)
//    · Added: 5 HR-zone tokens (Theme.Zone.z1 … z5)
//    · Added: Theme.Font.display(size:) / Theme.Font.body(size:weight:) helpers
//    · Added: Theme.Font.displayRecipe — applies the 4-piece Oswald 700 bundle
//    · BACKWARDS COMPATIBLE — all existing `Theme.bg`, `Theme.green`, etc.
//      flat statics are preserved as aliases. Existing Views continue to work
//      without changes.
//
//  Cardinal Rule #4 — Single source of truth: hex values traced to
//  shared/tokens.json. Don't inline a colour anywhere else. To change a
//  token: edit Faff/design/tokens/*.css, regenerate tokens.json, mirror
//  here.
//

import SwiftUI

// MARK: - Theme (top-level — backwards-compatible flat surface)

enum Theme {
    // ───── Canvas (v2 names · preserved) ─────
    static let bg      = Color(red: 0.039, green: 0.047, blue: 0.063)   // #0a0c10
    static let bgPage  = Color(red: 0.082, green: 0.090, blue: 0.110)   // #15171c
    static let card    = Color(red: 0.067, green: 0.078, blue: 0.102)   // #11141a
    static let card2   = Color(red: 0.075, green: 0.090, blue: 0.122)   // #13171f

    // ───── Ink ─────
    static let ink   = Color(red: 0.965, green: 0.969, blue: 0.973)     // #f6f7f8
    static let mute  = Color(red: 0.541, green: 0.565, blue: 0.627)     // #8a90a0
    static let dim   = Color(red: 0.294, green: 0.314, blue: 0.369)     // #4b505e

    // ───── Lines ─────
    static let line  = Color.white.opacity(0.08)
    static let line2 = Color.white.opacity(0.04)

    // ───── Semantic palette ─────
    static let green  = Color(red: 0.243, green: 0.741, blue: 0.255)    // #3EBD41 DONE
    static let goal   = Color(red: 0.953, green: 0.678, blue: 0.220)    // #F3AD38 QUALITY
    static let over   = Color(red: 0.988, green: 0.302, blue: 0.392)    // #FC4D64 over/alert
    static let dist   = Color(red: 0.153, green: 0.706, blue: 0.878)    // #27B4E0 LONG
    static let rest   = Color(red: 0.000, green: 0.561, blue: 0.925)    // #008FEC REST
    static let learn  = Color(red: 0.690, green: 0.518, blue: 1.000)    // #B084FF PHASE
    static let race   = Color(red: 1.000, green: 0.533, blue: 0.278)    // #FF8847 RACE WEEK

    // ───── Radii ─────
    static let rCard:  CGFloat = 18
    static let rPill:  CGFloat = 999
    static let rInput: CGFloat = 10

    // MARK: - HR Zone palette (v3 · 2026-05-28)
    enum Zone {
        static let z1 = Color(red: 0.357, green: 0.486, blue: 0.722)    // #5B7CB8 recovery
        static let z2 = Color(red: 0.282, green: 0.702, blue: 0.710)    // #48B3B5 aerobic
        static let z3 = Color(red: 0.561, green: 0.753, blue: 0.290)    // #8FC04A tempo
        static let z4 = Color(red: 0.910, green: 0.608, blue: 0.227)    // #E89B3A threshold
        static let z5 = Color(red: 0.839, green: 0.243, blue: 0.306)    // #D63E4E VO2max
    }

    // MARK: - State Gradients (v3 · 2026-05-28)
    //
    // One 135° linear gradient per day-state. Three-stop gradients match
    // the web CSS in globals.css (var(--g-easy) etc.). Used by Poster
    // backgrounds + race-week takeover surfaces.
    enum Gradient {
        static let easy = LinearGradient(
            colors: [Color(hex: 0x3EBD41), Color(hex: 0x1F8A52), Color(hex: 0x0F4A3A)],
            startPoint: .topLeading, endPoint: .bottomTrailing
        )
        static let quality = LinearGradient(
            colors: [Color(hex: 0xF3AD38), Color(hex: 0xE85D26), Color(hex: 0x7A2828)],
            startPoint: .topLeading, endPoint: .bottomTrailing
        )
        static let long = LinearGradient(
            colors: [Color(hex: 0x27B4E0), Color(hex: 0x1A6A9E), Color(hex: 0x0C2A5E)],
            startPoint: .topLeading, endPoint: .bottomTrailing
        )
        static let rest = LinearGradient(
            colors: [Color(hex: 0x008FEC), Color(hex: 0x4A3A8E), Color(hex: 0x1C1A3A)],
            startPoint: .topLeading, endPoint: .bottomTrailing
        )
        static let done = LinearGradient(
            colors: [Color(hex: 0x3EBD41), Color(hex: 0x27B4E0), Color(hex: 0x1A4A8E)],
            startPoint: .topLeading, endPoint: .bottomTrailing
        )
        static let race = LinearGradient(
            colors: [Color(hex: 0xFF8847), Color(hex: 0xE85D26), Color(hex: 0x7A2828)],
            startPoint: .topLeading, endPoint: .bottomTrailing
        )
        static let phase = LinearGradient(
            colors: [Color(hex: 0xB084FF), Color(hex: 0x6A4ACE), Color(hex: 0x2A1A5A)],
            startPoint: .topLeading, endPoint: .bottomTrailing
        )
        static let missed = LinearGradient(
            colors: [Color(hex: 0xF3AD38), Color(hex: 0xC47812), Color(hex: 0x5A3408)],
            startPoint: .topLeading, endPoint: .bottomTrailing
        )
        static let ease = LinearGradient(
            colors: [Color(hex: 0xF3AD38), Color(hex: 0x7A4A26), Color(hex: 0x2A1A18)],
            startPoint: .topLeading, endPoint: .bottomTrailing
        )
        static let sick = LinearGradient(
            colors: [Color(hex: 0x5A6580), Color(hex: 0x3A3A55), Color(hex: 0x1A1A2A)],
            startPoint: .topLeading, endPoint: .bottomTrailing
        )
        static let niggle = LinearGradient(
            colors: [Color(hex: 0x3EBD41), Color(hex: 0x2A6A3A), Color(hex: 0x5A3408)],
            startPoint: .topLeading, endPoint: .bottomTrailing
        )
        static let new = LinearGradient(
            colors: [Color(hex: 0xB084FF), Color(hex: 0x6A4ACE), Color(hex: 0x2A1A5A)],
            startPoint: .topLeading, endPoint: .bottomTrailing
        )
    }

    // MARK: - Typography (v3 · Oswald 700 display + Inter body)
    //
    // Two-family system locked 2026-05-28 in shared/tokens.json v1.4.0.
    //   · display: Oswald 700 — hero verbs, stat values, card titles
    //   · body:    Inter 400/500/700 — paragraphs, labels, captions
    //
    // The DISPLAY RECIPE is a 4-piece bundle:
    //   font-family    = Oswald
    //   font-weight    = 700
    //   tracking       = -0.015em (= -0.015 × pointSize in Swift)
    //   line-height    = 0.86
    // Apply all four together via `.displayRecipe(size:)` (see View+Recipe
    // extension below) — partial application loses Oswald's intended
    // optical character.
    //
    // FONT BUNDLING (one-time Xcode work · see deploy.md):
    //   1. Drop these into Faff/Resources/Fonts/:
    //        Oswald-Regular.ttf · Oswald-Medium.ttf · Oswald-Bold.ttf
    //        Inter-Regular.ttf · Inter-Medium.ttf · Inter-SemiBold.ttf
    //        Inter-Bold.ttf
    //   2. In Xcode: drag the folder into the project navigator → check
    //      "Add to target: Faff" → ensure they appear under Build Phases
    //      → Copy Bundle Resources.
    //   3. Info.plist already lists them under UIAppFonts (next commit).
    //
    // Until TTFs are bundled, .custom("Oswald", ...) falls back to system
    // fonts. The fallback chain in Font.display() catches that.
    enum Font {
        static let displayFamily = "Oswald"
        static let bodyFamily    = "Inter"

        /// Display recipe constants — used by `displayRecipe(size:)` and any
        /// callsite that wants the exact lock-in values.
        static let displayWeight: SwiftUI.Font.Weight = .bold       // 700
        static let displayTrackingFactor: CGFloat     = -0.015      // em
        static let displayLineHeight: CGFloat         = 0.86

        /// Oswald 700 at the requested size, with system bold as fallback.
        /// Prefer `.displayRecipe(size:)` on a View — it applies the full
        /// 4-piece bundle (family + weight + tracking + line-height).
        static func display(_ size: CGFloat) -> SwiftUI.Font {
            // .custom returns a Font that falls back to the system bold if
            // the named family isn't bundled. Safer than crashing.
            return SwiftUI.Font.custom(displayFamily, size: size)
                .weight(displayWeight)
        }

        /// Inter at the requested size + weight. Body family.
        static func body(_ size: CGFloat,
                         weight: SwiftUI.Font.Weight = .regular) -> SwiftUI.Font {
            return SwiftUI.Font.custom(bodyFamily, size: size)
                .weight(weight)
        }

        /// Tracking in Swift units for a given pointSize.
        /// Use as `.tracking(Theme.Font.tracking(for: 72))`.
        static func tracking(for size: CGFloat) -> CGFloat {
            return displayTrackingFactor * size
        }
    }
}

// MARK: - Color hex initializer
//
// Convenience: build a Color from a hex literal (e.g. 0x3EBD41). Used by
// gradients + zone tokens above so we don't repeat the (0.243, 0.741, 0.255)
// triple form for every value.
extension Color {
    init(hex: UInt32, alpha: Double = 1.0) {
        let r = Double((hex >> 16) & 0xFF) / 255.0
        let g = Double((hex >>  8) & 0xFF) / 255.0
        let b = Double( hex        & 0xFF) / 255.0
        self.init(.sRGB, red: r, green: g, blue: b, opacity: alpha)
    }
}

// MARK: - View extension · the display recipe modifier
//
// Apply the locked 4-piece Oswald 700 bundle in one call:
//
//     Text("EASY 6.1.").displayRecipe(size: 72)
//
// This sets family + weight + tracking + line-height all at once. The
// vertical metrics from line-height 0.86 are approximated via
// `.lineSpacing(size * (0.86 - 1.0))` — Swift doesn't expose a direct
// "line-height" prop on Text. For multi-line display verbs the negative
// lineSpacing tightens the leading to match the web.
extension View {
    /// Apply the Oswald 700 display recipe at the given size.
    func displayRecipe(size: CGFloat) -> some View {
        self
            .font(Theme.Font.display(size))
            .tracking(Theme.Font.tracking(for: size))
            .lineSpacing(size * (Theme.Font.displayLineHeight - 1.0))
    }
}
