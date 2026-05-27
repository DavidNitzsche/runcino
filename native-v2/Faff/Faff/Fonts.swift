//
//  Fonts.swift
//
//  Three roles, mirroring web-v2 design tokens:
//    .display(size)  — Bebas Neue. Hero numbers + headlines at ≥18px.
//                       Falls apart below ~14px (condensed/stencil-y).
//    .label(size)    — HelveticaNeue-Bold. Small caps labels, chip text,
//                       eyebrows — anything in ALL CAPS at <18px. Matches
//                       the Apple Watch app's label rendering + falls back
//                       to SF Compact / system rounded on Apple devices.
//    .body(size, w)  — Inter at the chosen weight. Paragraph copy, form
//                       fields, narrative.
//
//  Rule: if it's <18px ALL CAPS with letter-tracking → .label.
//        if it's a hero number or display headline → .display.
//        everything else → .body.
//

import SwiftUI

extension Font {
    /// Display font — Bebas Neue. Reserve for hero use at ≥18px.
    /// Falls back to system bold if unavailable.
    static func display(_ size: CGFloat) -> Font {
        if UIFont(name: "BebasNeue-Regular", size: size) != nil {
            return .custom("BebasNeue-Regular", size: size)
        }
        return .system(size: size, weight: .bold).width(.expanded)
    }

    /// Label font — HelveticaNeue-Bold. Small caps + chip + eyebrow text.
    /// Built-in on every iOS device since iOS 4 — no bundling needed.
    /// Falls back to SF Compact (system rounded) for parity if a future
    /// OS ever drops the font.
    static func label(_ size: CGFloat) -> Font {
        if UIFont(name: "HelveticaNeue-Bold", size: size) != nil {
            return .custom("HelveticaNeue-Bold", size: size)
        }
        return .system(size: size, weight: .bold)
    }

    /// Body font — Inter at given weight. Falls back to system if unavailable.
    static func body(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        let interName: String
        switch weight {
        case .black, .heavy:   interName = "Inter-Black"
        case .bold:            interName = "Inter-Bold"
        case .semibold:        interName = "Inter-SemiBold"
        case .medium:          interName = "Inter-Medium"
        case .light, .thin:    interName = "Inter-Light"
        default:               interName = "Inter-Regular"
        }
        if UIFont(name: interName, size: size) != nil {
            return .custom(interName, size: size)
        }
        return .system(size: size, weight: weight)
    }
}
