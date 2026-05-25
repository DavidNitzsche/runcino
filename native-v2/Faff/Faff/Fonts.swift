//
//  Fonts.swift
//  Bebas Neue (display) + Inter (body). Bundle the .ttf files in the
//  Xcode target's Resources and register here.
//

import SwiftUI

extension Font {
    /// Display font — Bebas Neue. Falls back to system bold if unavailable.
    static func display(_ size: CGFloat) -> Font {
        if UIFont(name: "BebasNeue-Regular", size: size) != nil {
            return .custom("BebasNeue-Regular", size: size)
        }
        return .system(size: size, weight: .bold).width(.expanded)
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
