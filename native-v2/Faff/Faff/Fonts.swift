//
//  Fonts.swift
//
//  Two families total — matched to the Apple Watch app aesthetic
//  David approved 2026-05-26. Bebas Neue dropped (too condensed/stencil
//  even at hero size).
//
//    .display(size)  — HelveticaNeue-Bold. Hero numbers + headlines.
//    .label(size)    — HelveticaNeue-Bold. Small caps + chip + eyebrow.
//    .body(size, w)  — Inter at the chosen weight. Paragraph copy.
//
//  display + label share a font now; size + tracking differentiate them.
//

import SwiftUI

extension Font {
    /// Display font — HelveticaNeue-Bold. Hero numbers + headlines at any size.
    /// Built-in on every iOS device since iOS 4 — no bundling needed.
    static func display(_ size: CGFloat) -> Font {
        if UIFont(name: "HelveticaNeue-Bold", size: size) != nil {
            return .custom("HelveticaNeue-Bold", size: size)
        }
        return .system(size: size, weight: .bold)
    }

    /// Label font — HelveticaNeue-Bold. Small caps + chip + eyebrow text.
    /// Same family as .display intentionally — single source of truth.
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
