//
//  FaffFonts.swift
//  Faff
//
//  Registers the bundled v4 typefaces (Bebas Neue, Inter, Oswald) at
//  launch via CoreText. The iOS target uses a generated Info.plist
//  (no UIAppFonts key), so we register programmatically instead — call
//  FaffFonts.register() once from the app entry point.
//

import CoreText
import Foundation

enum FaffFonts {
    static func register() {
        var urls: [URL] = []
        urls += Bundle.main.urls(forResourcesWithExtension: "ttf", subdirectory: nil) ?? []
        urls += Bundle.main.urls(forResourcesWithExtension: "ttf", subdirectory: "Fonts") ?? []
        // De-dupe (a file at the bundle root could be found by both queries).
        var seen = Set<String>()
        for url in urls where seen.insert(url.lastPathComponent).inserted {
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }
}
