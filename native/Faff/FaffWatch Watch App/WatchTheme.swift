//
//  WatchTheme.swift
//  FaffWatch
//
//  The dark execution surface — the v4 design language on the wrist.
//  True-black ground, the same semantic hues as the phone, and the
//  bundled Bebas Neue / Inter / Oswald typefaces (registered at launch
//  via CoreText, same as the iOS target).
//

import SwiftUI
import CoreText

enum WatchTheme {

    // MARK: Semantic colours (v4 dark variant — match watch-app.html)
    enum C {
        static let bg      = Color.black            // true-black surface
        static let ink     = Color.white            // --wink
        static let t2      = Color.white.opacity(0.62) // --wt2 secondary
        static let t3      = Color.white.opacity(0.40) // dim labels / eyebrows
        static let track   = Color.white.opacity(0.14) // progress track
        static let green   = Color(red: 0.173, green: 0.659, blue: 0.184) // #2CA82F on-pace
        static let amber   = Color(red: 0.831, green: 0.565, blue: 0.039) // #D4900A drift
        static let orange  = Color(red: 0.910, green: 0.365, blue: 0.149) // #E85D26 race/now
        static let warn    = Color(red: 0.957, green: 0.247, blue: 0.369) // #F43F5E over
    }

    // MARK: Type — Bebas (display), Inter (body), Oswald (sub)
    static func display(_ size: CGFloat) -> Font { .custom("BebasNeue-Regular", size: size) }
    static func body(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font { .custom("Inter", size: size).weight(weight) }
    static func sub(_ size: CGFloat, _ weight: Font.Weight = .semibold) -> Font { .custom("Oswald", size: size).weight(weight) }

    // MARK: Font registration (watchOS has no Info.plist UIAppFonts here)
    private static var registered = false
    static func registerFonts() {
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

extension Color {
    /// Pace-drift zone → the v4 hue used on the wrist hero + bar.
    static func zone(_ z: PaceZone) -> Color {
        switch z {
        case .onTarget: return WatchTheme.C.green
        case .drifting: return WatchTheme.C.amber
        case .offTarget: return WatchTheme.C.warn
        }
    }
}
