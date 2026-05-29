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
    // ═════ ACTIVE SKIN · paper overhaul (2026-05-29) ═════
    //
    // The flat tokens below ALIAS the active skin. This is the iOS mirror
    // of the web `[data-skin="paper"]` swap in web-v2/app/globals.css.
    //
    // Cardinal Rule #8 — dark stays revertable via token swap: BOTH full
    // palettes live below (`Paper` + `Dark`). To revert the whole app to the
    // original dark theme, flip these 16 aliases from `Paper.` → `Dark.`
    // (and FaffApp's `.preferredColorScheme(.light)` back to `.dark`).
    // Nothing else references raw colours — every View reads `Theme.bg` etc.
    //
    // NOTE (mirrors globals.css): only the NEUTRALS + the semantic palette
    // swap. The 13 state Gradients below are intentionally NOT re-tuned —
    // they're saturated enough to read on warm paper and carry the Poster
    // accent + race-week wash on both skins.

    // ───── Canvas ─────
    static let bg      = Paper.bg
    static let bgPage  = Paper.bgPage
    static let card    = Paper.card
    static let card2   = Paper.card2

    // ───── Ink ─────
    static let ink   = Paper.ink
    static let mute  = Paper.mute
    static let dim   = Paper.dim

    // ───── Lines ─────
    static let line  = Paper.line
    static let line2 = Paper.line2

    // ───── Semantic palette ─────
    static let green  = Paper.green
    static let goal   = Paper.goal
    static let over   = Paper.over
    static let dist   = Paper.dist
    static let rest   = Paper.rest
    static let learn  = Paper.learn
    static let race   = Paper.race

    // ───── PAPER skin · warm spec-sheet (ACTIVE) ─────
    // Values traced 1:1 to the `[data-skin="paper"]` block in globals.css.
    enum Paper {
        static let bg      = Color(hex: 0xECE7DD)   // recessed paper
        static let bgPage  = Color(hex: 0xF2EFE9)   // THE canvas · warm paper
        static let card    = Color(hex: 0xF7F4EE)   // raised paper card
        static let card2   = Color(hex: 0xFBFAF6)   // lightest paper (top layer)

        static let ink   = Color(hex: 0x14110D)     // near-black warm
        static let mute  = Color(hex: 0x6B6358)     // warm grey label
        static let dim   = Color(hex: 0xA9A093)     // faint warm grey

        static let line  = Color(hex: 0x14110D).opacity(0.14)
        static let line2 = Color(hex: 0x14110D).opacity(0.07)

        static let green  = Color(hex: 0x1E9E47)    // ON TRACK / DONE (deepened)
        static let goal   = Color(hex: 0xC2791A)    // WATCH / QUALITY (deepened)
        static let over   = Color(hex: 0xD8344C)    // OFF TRACK / alert (deepened)
        static let dist   = Color(hex: 0x1789B0)    // LONG / distance (deepened)
        static let rest   = Color(hex: 0x1268C9)    // REST (deepened)
        static let learn  = Color(hex: 0x7A4FD0)    // PHASE / insight (deepened)
        static let race   = Color(hex: 0xDD5F22)    // RACE WEEK / horizon (deepened)
    }

    // ───── DARK skin · original v3 (REVERT TARGET · Cardinal Rule #8) ─────
    enum Dark {
        static let bg      = Color(hex: 0x0A0C10)
        static let bgPage  = Color(hex: 0x15171C)
        static let card    = Color(hex: 0x11141A)
        static let card2   = Color(hex: 0x13171F)

        static let ink   = Color(hex: 0xF6F7F8)
        static let mute  = Color(hex: 0x8A90A0)
        static let dim   = Color(hex: 0x4B505E)

        static let line  = Color.white.opacity(0.08)
        static let line2 = Color.white.opacity(0.04)

        static let green  = Color(hex: 0x3EBD41)    // DONE
        static let goal   = Color(hex: 0xF3AD38)    // QUALITY
        static let over   = Color(hex: 0xFC4D64)    // over/alert
        static let dist   = Color(hex: 0x27B4E0)    // LONG
        static let rest   = Color(hex: 0x008FEC)    // REST
        static let learn  = Color(hex: 0xB084FF)    // PHASE
        static let race   = Color(hex: 0xFF8847)    // RACE WEEK
    }

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
        // P-SKIP (Phase 12 · 2026-05-28). Slate-purple gradient for the
        // explicit "I am skipping today" state. Mirrors --g-skip in
        // web-v2/app/globals.css (#6B7A8F → #4A4A5C → #1F1F2A · 135°).
        static let skip = LinearGradient(
            colors: [Color(hex: 0x6B7A8F), Color(hex: 0x4A4A5C), Color(hex: 0x1F1F2A)],
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
