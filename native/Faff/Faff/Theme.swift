//
//  Theme.swift
//  Faff
//
//  The v4 design system (designs/V4_DESIGN_LAW.md +
//  web/app/components/v4/tokens.ts) translated to SwiftUI. Import these
//  instead of inlining magic numbers — same rule as the web tokens.
//
//  FONTS: Bebas Neue (display/numbers), Inter (body), Oswald (sub-headers)
//  are NOT system fonts. They must be bundled into the target (the .ttf
//  files + an Info.plist UIAppFonts entry) before they render — otherwise
//  SwiftUI silently falls back to the system font. See the build notes.
//

import SwiftUI

enum Faff {

    // ── Color (light v4) ──────────────────────────────────────────
    enum C {
        static let bg        = Color(hex: 0xEEECEA)   // warm ground
        static let surface   = Color.white            // cards
        static let ink       = Color(hex: 0x0D0F12)   // primary text
        static let textMuted = Color.ink55            // values in cards
        static let textDim   = Color.ink35            // labels / eyebrows
        static let textFaint = Color.ink20            // rest-day em-dash
        static let divider   = Color.ink08
        static let pillBg    = Color.ink04
        static let track     = Color(hex: 0x0D0F12).opacity(0.07)

        // Semantic — color only when it carries meaning.
        static let recovery  = Color(hex: 0x2CA82F)   // green · on plan
        static let milestone = Color(hex: 0xD4900A)   // amber · today
        static let race      = Color(hex: 0xE85D26)   // orange · brand (sparingly)
        static let warn      = Color(hex: 0xF43F5E)   // red · errors only

        static let greenWash  = Color(hex: 0x2CA82F).opacity(0.12)
        static let amberWash  = Color(hex: 0xD4900A).opacity(0.14)
        static let orangeWash = Color(hex: 0xE85D26).opacity(0.12)
    }

    // ── Type ladder ───────────────────────────────────────────────
    // Phone scale (the web tokens.ts sizes are desktop; the iPhone
    // mockup in iphone-handoff.html uses these smaller sizes).
    enum F {
        // Bebas Neue is static (one weight). Inter + Oswald are variable
        // fonts — reference the default PostScript name and shift weight
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
        static let rowGap: CGFloat       = 10   // between feed rows (phone-tightened)
        static let cardPadding: CGFloat  = 14   // card interior (phone)
        static let blockGap: CGFloat     = 8    // label → value inside a card
        static let inlineGap: CGFloat    = 5    // between pills / segments
        static let pageEdge: CGFloat     = 13   // feed horizontal padding
    }

    // ── Radii ─────────────────────────────────────────────────────
    enum R {
        static let card: CGFloat  = 15
        static let pill: CGFloat  = 8
        static let chip: CGFloat  = 6
    }
}

// ── Card surface modifier (white, soft shadow, NO border) ─────────
private struct FaffCard: ViewModifier {
    var padding: CGFloat = Faff.S.cardPadding
    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(Faff.C.surface)
            .clipShape(RoundedRectangle(cornerRadius: Faff.R.card, style: .continuous))
            .shadow(color: .black.opacity(0.06), radius: 1.5, x: 0, y: 1)
            .shadow(color: .black.opacity(0.04), radius: 8, x: 0, y: 4)
    }
}

extension View {
    func faffCard(padding: CGFloat = Faff.S.cardPadding) -> some View {
        modifier(FaffCard(padding: padding))
    }
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
    static let ink   = Color(hex: 0x0D0F12)
    static let ink55 = Color(hex: 0x0D0F12).opacity(0.55)
    static let ink35 = Color(hex: 0x0D0F12).opacity(0.35)
    static let ink20 = Color(hex: 0x0D0F12).opacity(0.20)
    static let ink08 = Color(hex: 0x0D0F12).opacity(0.08)
    static let ink04 = Color(hex: 0x0D0F12).opacity(0.04)

    /// The faff.run wordmark gradient (amber → orange → burnt).
    static let faffMark = LinearGradient(
        colors: [Color(hex: 0xF3AD38), Color(hex: 0xE85D26), Color(hex: 0xC73E0B)],
        startPoint: .topLeading, endPoint: .bottomTrailing
    )
}
