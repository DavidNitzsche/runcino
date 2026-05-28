//
//  Fonts.swift
//
//  Two families total — Oswald display + Inter body (v3 lock-in 2026-05-28).
//
//    .display(size)  — Oswald-Bold. Hero numbers + headlines.
//    .label(size)    — Inter-Bold caps-tracked. Small caps + chip + eyebrow.
//    .body(size, w)  — Inter at the chosen weight. Paragraph copy.
//
//  v3 swap (2026-05-28 cutover): display moved HelveticaNeue-Bold → Oswald
//  to match the web design system (shared/tokens.json v1.4.0). Existing
//  view callsites picking up `Font.display(...)` automatically render in
//  Oswald — no per-view edits required. Fallback chain keeps the app safe
//  if the TTFs aren't bundled (clean degrade to system bold).
//

import SwiftUI

extension Font {
    /// Display font — Oswald-Bold. Hero numbers + headlines at any size.
    /// Falls back to HelveticaNeue-Bold (built-in) then system bold if the
    /// Oswald TTF didn't bundle into the build.
    static func display(_ size: CGFloat) -> Font {
        if UIFont(name: "Oswald-Bold", size: size) != nil {
            return .custom("Oswald-Bold", size: size)
        }
        if UIFont(name: "HelveticaNeue-Bold", size: size) != nil {
            return .custom("HelveticaNeue-Bold", size: size)
        }
        return .system(size: size, weight: .bold)
    }

    /// Label font — Inter-Bold (caps-tracked usage downstream).
    /// v3 swap: was HelveticaNeue-Bold; now matches the web's
    /// caps-tracked labels (Inter 700wt + letter-spacing) so the iPhone
    /// + web read with the same letterforms at small caps sizes.
    static func label(_ size: CGFloat) -> Font {
        if UIFont(name: "Inter-Bold", size: size) != nil {
            return .custom("Inter-Bold", size: size)
        }
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
