//
//  CartoConfig.swift
//  Build-time secret plumbing for RouteMapView's CARTO basemap.
//
//  The key is never a literal in source. It lives in Secrets.xcconfig
//  (gitignored — see native-v2/Secrets.example.xcconfig), which project.yml
//  wires in as the base config file for every build configuration
//  (`configFiles:`), substituted into Info.plist as CartoAPIKey →
//  $(CARTO_API_KEY), and read back out here via Bundle.main. Same two-step
//  idiom as any other iOS build-time key that isn't sensitive enough to need
//  Keychain or a server round-trip — CARTO's own docs describe this key as
//  fair-use rate-limiting, not a security boundary (see RouteMapView.swift's
//  header for the full migration rationale).
//
//  On a fresh checkout without Secrets.xcconfig set up, this reads "" (an
//  empty/missing $(CARTO_API_KEY) substitutes to an empty string in
//  Info.plist, not a build failure) — RouteMapView still builds and runs,
//  it just gets a 401/watermark from CARTO instead of tiles.
//

import Foundation

enum CartoConfig {
    static var apiKey: String {
        (Bundle.main.object(forInfoDictionaryKey: "CartoAPIKey") as? String) ?? ""
    }

    /// CARTO's ready-made MapLibre GL style JSON for the "Dark Matter" look —
    /// pure black land, muted roads, no green. `labels: false` swaps in the
    /// label-free variant (race-course maps spanning a whole city, where
    /// CARTO's baked place labels would render huge over the route).
    static func styleURL(labels: Bool) -> URL {
        let variant = labels ? "dark-matter-gl-style" : "dark-matter-nolabels-gl-style"
        var comps = URLComponents(string: "https://basemaps.cartocdn.com/gl/\(variant)/style.json")!
        if !apiKey.isEmpty {
            comps.queryItems = [URLQueryItem(name: "key", value: apiKey)]
        }
        return comps.url!
    }
}
