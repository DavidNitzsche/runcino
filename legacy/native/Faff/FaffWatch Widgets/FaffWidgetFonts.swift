//
//  FaffWidgetFonts.swift
//  FaffWatch Widgets
//
//  Registering Instrument Sans and Archivo inside the extension's own
//  process.
//
//  SOURCE OF TRUTH — see WatchThemeV5.swift's header.
//
//  watchOS has no `UIAppFonts` path that reaches an app extension, and the
//  watch app's own registration (`WatchTheme.registerFonts`) runs in the app
//  process against the app's `Bundle.main`. A widget extension is a separate
//  process with a separate main bundle, so it registers its own copy of the
//  same TTFs — the same files, shipped into the extension by the `Fonts`
//  resource entry on the widget target in `native-v2/project.yml`.
//
//  Both faces are VARIABLE fonts. Registering one makes its DEFAULT instance
//  reachable by PostScript name (`InstrumentSans-Regular`,
//  `Archivo-SemiBold`) and every other point in the variation space reachable
//  by setting axes on a CTFontDescriptor. `WatchCoreText.font` does exactly
//  that, and it PROBES the family it got back — because CoreText substitutes
//  San Francisco silently when a face is missing, and a silent substitution
//  is what this whole path exists to make visible. If registration fails, the
//  display register falls back deliberately instead of quietly.
//
//  `.process` scope, not `.persistent`: the extension is short-lived and
//  should leave nothing registered behind it for the app process to trip
//  over.
//

import Foundation
import CoreText

enum FaffWidgetFonts {

    private static var done = false

    /// Idempotent. Called from the widget bundle's `init`, which runs before
    /// any timeline entry is rendered.
    static func register() {
        guard !done else { return }
        done = true

        var urls: [URL] = []
        urls += Bundle.main.urls(forResourcesWithExtension: "ttf", subdirectory: "Fonts") ?? []
        urls += Bundle.main.urls(forResourcesWithExtension: "ttf", subdirectory: nil) ?? []

        var seen = Set<String>()
        for url in urls where seen.insert(url.lastPathComponent).inserted {
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }
}
