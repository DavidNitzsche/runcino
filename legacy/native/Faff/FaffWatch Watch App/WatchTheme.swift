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

    // MARK: Semantic colours · LOCKED TEN-COLOR PALETTE (brief v2, AFC fix 4)
    // Byte-for-byte with FaceKit's Faff roles, iPhone Theme.swift, and web
    // globals.css. The old values (#2CA82F / #D4900A / #E85D26) were a
    // second, divergent palette on the same wrist · on-pace green differed
    // between the glance surfaces and the in-run faces for the same metric.
    //
    // DEPRECATED for direct use in views — consume Faff.* from FaceKit instead.
    // WatchTheme.C remains as the source-of-truth definition; it is not deleted
    // because it anchors the locked values. New view code must not add C.* calls.
    enum C {
        static let bg      = Color.black            // true-black surface
        static let ink     = Color.white            // --wink
        static let t2      = Color.white.opacity(0.62) // --wt2 secondary
        static let t3      = Color.white.opacity(0.40) // dim labels / eyebrows
        static let track   = Color.white.opacity(0.14) // progress track
        static let green   = Color(hex: 0x3EBD41)   // on-pace / good state
        static let amber   = Color(hex: 0xF3AD38)   // drift / watch attention
        static let orange  = Color(hex: 0xFF5722)   // race / now (brand hero)
        static let warn    = Color(hex: 0xFC4D64)   // over / off
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
