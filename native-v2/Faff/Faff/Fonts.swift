//
//  Fonts.swift
//  v3 typography stack · Anton (brand) · Oswald (display + numerics) · Inter (body).
//
//  PostScript names per Google Fonts OFL releases:
//    Anton-Regular
//    Oswald-Light / Oswald-Regular / Oswald-Medium / Oswald-SemiBold / Oswald-Bold
//    Inter-Regular / Inter-Medium / Inter-SemiBold / Inter-Bold / Inter-ExtraBold
//
//  All registered in project.yml UIAppFonts. If a face is missing at runtime
//  (e.g. a font failed to bundle) UIFont(name:size:) returns nil and we fall
//  back to a system substitute so the app doesn't fail silently with the
//  default San Francisco.
//

import SwiftUI
import UIKit

extension Font {

    // ───── Anton · brand wordmark only ─────
    static func brand(_ size: CGFloat) -> Font {
        if UIFont(name: "Anton-Regular", size: size) != nil {
            return .custom("Anton-Regular", size: size, relativeTo: .largeTitle)
        }
        return .system(size: size, weight: .black, design: .default).width(.condensed)
    }

    // ───── Oswald · display + ALL numerics ─────
    static func display(_ size: CGFloat, weight: OswaldWeight = .semibold) -> Font {
        let name = weight.postScriptName
        if UIFont(name: name, size: size) != nil {
            return .custom(name, size: size, relativeTo: .title)
        }
        return .system(size: size, weight: weight.systemWeight).width(.condensed)
    }

    /// Convenience for the dominant hero recipe (Oswald 700, tight tracking,
    /// short line-height). Apply as `.font(.heroDisplay(size:))`.
    static func heroDisplay(_ size: CGFloat) -> Font {
        display(size, weight: .bold)
    }

    // ───── Inter · body / labels / eyebrows ─────
    static func body(_ size: CGFloat, weight: InterWeight = .regular) -> Font {
        let name = weight.postScriptName
        if UIFont(name: name, size: size) != nil {
            return .custom(name, size: size, relativeTo: .body)
        }
        return .system(size: size, weight: weight.systemWeight)
    }

    /// Tracked-caps label recipe (Inter ExtraBold). The View applies
    /// `.tracking()` and `.textCase(.uppercase)` via `.eyebrow()` modifier.
    static func label(_ size: CGFloat) -> Font {
        body(size, weight: .extraBold)
    }
}

enum OswaldWeight {
    case light, regular, medium, semibold, bold

    var postScriptName: String {
        switch self {
        case .light:    return "Oswald-Light"
        case .regular:  return "Oswald-Regular"
        case .medium:   return "Oswald-Medium"
        case .semibold: return "Oswald-SemiBold"
        case .bold:     return "Oswald-Bold"
        }
    }

    var systemWeight: Font.Weight {
        switch self {
        case .light:    return .light
        case .regular:  return .regular
        case .medium:   return .medium
        case .semibold: return .semibold
        case .bold:     return .bold
        }
    }
}

enum InterWeight {
    case regular, medium, semibold, bold, extraBold

    var postScriptName: String {
        switch self {
        case .regular:   return "Inter-Regular"
        case .medium:    return "Inter-Medium"
        case .semibold:  return "Inter-SemiBold"
        case .bold:      return "Inter-Bold"
        case .extraBold: return "Inter-ExtraBold"
        }
    }

    var systemWeight: Font.Weight {
        switch self {
        case .regular:   return .regular
        case .medium:    return .medium
        case .semibold:  return .semibold
        case .bold:      return .bold
        case .extraBold: return .heavy
        }
    }
}

// MARK: - Canonical type scale (brief v2)
//
// Six tiers, mirroring web's --fs-* CSS vars. New views pick the nearest
// tier; never hard-code a point size that fits between two rungs.
enum TypeScale {
    /// Oswald hero — the largest single-field display role (workout name, big countdown)
    static let hero: CGFloat = 64
    /// Oswald mid stats — section numerals, ring values, weekly totals
    static let stat: CGFloat = 30
    /// Inter primary body copy (brief: display ≥16pt · body uses this tier)
    static let body: CGFloat = 15
    /// Inter secondary — detail rows, list labels, subheads
    static let sec:  CGFloat = 13
    /// Inter ExtraBold eyebrow — tracking 1.2px, uppercase (≤11pt boundary)
    static let eye:  CGFloat = 11
    /// Inter micro — calendar tags, badge stamps, map sub-labels
    static let mic:  CGFloat = 9.5
}

// MARK: - Display recipe modifier
//
// The hero look used everywhere: Oswald + tight tracking + short line-height.

struct DisplayRecipe: ViewModifier {
    let size: CGFloat
    let weight: OswaldWeight
    func body(content: Content) -> some View {
        content
            .font(.display(size, weight: weight))
            .tracking(-(size * 0.045))     // ~−2px @ 44pt
    }
}

extension View {
    /// Hero numeric recipe: Oswald + tight tracking.
    func displayRecipe(size: CGFloat, weight: OswaldWeight = .bold) -> some View {
        modifier(DisplayRecipe(size: size, weight: weight))
    }

    /// Tracked-caps eyebrow recipe (Inter ExtraBold, uppercase, default 2px tracking).
    func eyebrow(size: CGFloat = 11, tracking: CGFloat = 2.0) -> some View {
        self
            .font(.label(size))
            .tracking(tracking)
            .textCase(.uppercase)
    }
}
