//
//  Theme.swift
//  Faff
//
//  The v4 design system (designs/V4_DESIGN_LAW.md +
//  web/app/components/v4/tokens.ts) translated to SwiftUI. Import these
//  instead of inlining magic numbers, same rule as the web tokens.
//
//  FONTS: Bebas Neue (display/numbers), Inter (body), Oswald (sub-headers)
//  are NOT system fonts. They must be bundled into the target (the .ttf
//  files + an Info.plist UIAppFonts entry) before they render, otherwise
//  SwiftUI silently falls back to the system font. See the build notes.
//

import SwiftUI

enum Faff {

    // ── Color (light v4) ──────────────────────────────────────────
    enum C {
        static let bg        = Color(hex: 0xE6E8EF)   // warm ground
        static let surface   = Color.white            // cards
        static let ink       = Color(hex: 0x080808)   // primary text
        static let textMuted = Color.ink55            // values in cards
        static let textDim   = Color.ink35            // labels / eyebrows
        static let textFaint = Color.ink20            // rest-day em-dash
        static let divider   = Color.ink08
        static let pillBg    = Color.ink04
        static let track     = Color(hex: 0x080808).opacity(0.07)

        // Semantic, color only when it carries meaning.
        static let recovery  = Color(hex: 0x3EBD41)   // green · on plan
        static let milestone = Color(hex: 0xF3AD38)   // amber · today
        static let race      = Color(hex: 0xE88021)   // orange · brand (sparingly)
        static let warn      = Color(hex: 0xFC4D64)   // red · errors only

        static let greenWash  = Color(hex: 0x3EBD41).opacity(0.12)
        static let amberWash  = Color(hex: 0xF3AD38).opacity(0.14)
        static let orangeWash = Color(hex: 0xE88021).opacity(0.12)

        // ➕ v4 handoff additions.
        /// Darkened amber for TEXT/icons on `amberWash` (milestone #D4900A
        /// fails contrast as on-wash text). Readiness number, "Watch Load".
        static let amberInk   = Color(hex: 0xB3450A)
        /// Data-viz only, descent/elevation grade (Race detail). Not chrome.
        static let dataBlue   = Color(hex: 0x008FEC)
        static let dataBlueWash = Color(hex: 0x008FEC).opacity(0.12)
        /// Hairline border on stat pills / ghost buttons.
        static let pillLine   = Color(hex: 0x080808).opacity(0.10)
    }

    // ── Type ladder ───────────────────────────────────────────────
    // Phone scale (the web tokens.ts sizes are desktop; the iPhone
    // mockup in iphone-handoff.html uses these smaller sizes).
    enum F {
        // Bebas Neue is static (one weight). Inter + Oswald are variable
        // fonts, reference the default PostScript name and shift weight
        // along the wght axis with .weight().
        static func display(_ size: CGFloat) -> Font { .custom("BebasNeue-Regular", size: size) }
        static func inter(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
            .custom("Inter-Regular", size: size).weight(weight)
        }
        static func oswald(_ size: CGFloat, _ weight: Font.Weight = .semibold) -> Font {
            .custom("Oswald-Regular", size: size).weight(weight)
        }
    }

    // ── Spacing (the only allowed values) ─────────────────────────
    enum S {
        static let rowGap: CGFloat       = 14   // between feed cards (v4)
        static let cardPadding: CGFloat  = 16   // card interior (heroes 17, tiles 12)
        static let blockGap: CGFloat     = 8    // label → value inside a card
        static let inlineGap: CGFloat    = 7    // between pills / segments
        static let pageEdge: CGFloat     = 20   // feed horizontal padding
        // ➕ v4 handoff additions.
        static let tilePadding: CGFloat  = 12   // metric-tile interior
        static let tileGap: CGFloat      = 8    // gap between tiles in the grid
        static let scrollTop: CGFloat    = 12   // inset under the sticky bar
        static let scrollBottom: CGFloat = 30   // breathing room before the tab bar
    }

    // ── Radii ─────────────────────────────────────────────────────
    enum R {
        static let card: CGFloat   = 18
        static let pill: CGFloat   = 12
        static let chip: CGFloat   = 8
        // ➕ v4 handoff additions.
        static let tile: CGFloat   = 14   // metric tiles
        static let sheet: CGFloat  = 24   // slide-up sheets (top corners)
        static let chipSm: CGFloat = 10   // race chip, sticky-bar buttons, segments
    }
}

// ── Card surface modifier (white, soft shadow, NO border) ─────────
private struct FaffCard: ViewModifier {
    var padding: CGFloat = Faff.S.cardPadding
    var radius: CGFloat = Faff.R.card
    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(Faff.C.surface)
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
            // v4 handoff: softer card shadow (0 1px2 .04 + 0 6px20 .05).
            .shadow(color: .black.opacity(0.04), radius: 1, x: 0, y: 1)
            .shadow(color: .black.opacity(0.05), radius: 10, x: 0, y: 4)
    }
}

extension View {
    func faffCard(padding: CGFloat = Faff.S.cardPadding, radius: CGFloat = Faff.R.card) -> some View {
        modifier(FaffCard(padding: padding, radius: radius))
    }
    /// Upward shadow for slide-up sheets (0 -10px 40 .10).
    func faffSheetShadow() -> some View {
        shadow(color: .black.opacity(0.10), radius: 20, x: 0, y: -10)
    }
}

/// Render coach copy with **markdown bold** support.
func faffMarkdown(_ s: String) -> Text {
    if let a = try? AttributedString(markdown: s, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)) {
        return Text(a)
    }
    return Text(s)
}

// ── Helpers ───────────────────────────────────────────────────────
extension Color {
    init(hex: UInt32) {
        self.init(
            red:   Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue:  Double(hex & 0xFF) / 255
        )
    }
    static let ink   = Color(hex: 0x080808)
    static let ink55 = Color(hex: 0x080808).opacity(0.55)
    static let ink35 = Color(hex: 0x080808).opacity(0.35)
    static let ink20 = Color(hex: 0x080808).opacity(0.20)
    static let ink08 = Color(hex: 0x080808).opacity(0.08)
    static let ink04 = Color(hex: 0x080808).opacity(0.04)

    /// The faff.run wordmark gradient (amber → orange → burnt).
    static let faffMark = LinearGradient(
        colors: [Color(hex: 0xF3AD38), Color(hex: 0xE85D26), Color(hex: 0xC73E0B)],
        startPoint: .topLeading, endPoint: .bottomTrailing
    )
}
