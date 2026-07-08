//
//  Units.swift
//  Faff
//
//  Single formatting choke point for distance / pace / temperature display.
//  Backend already stores + returns the preference (UserSettings.units_distance
//  / units_temp / units_pace, wire values "mi"/"km", "F"/"C" — see
//  web-v2/lib/coach/settings.ts). Before this file, ZERO renderers on the
//  phone consumed it: every view hardcoded "mi", "/mi", "mph", "°F" literals
//  directly (audit finding, phone-watch-audit-2026-07-06.md). This file is
//  the fix — a thin display-only conversion layer.
//
//  Doctrine: internal app state (tracker distances, API request/response
//  bodies, pace-drift thresholds, everything that round-trips to the server)
//  stays in the wire's native units — miles, seconds-per-mile, Fahrenheit —
//  EXACTLY as before this file existed. Nothing upstream of the final
//  Text(...) call changes. Only the last-mile formatting step reads the
//  preference and converts for DISPLAY. This is what makes the change
//  byte-safe for every existing 'mi'/'F' user (the default, and every
//  runner on the app today, including David): UnitsPreference.default
//  is mi/F, and every convert/format function no-ops (returns the exact
//  same string as the old hardcoded call) when the preference is mi/F.
//
//  Mirrors the synchronous-static-enum pattern used by StravaConnection.swift
//  (Util/StravaConnection.swift) rather than an ObservableObject — units
//  rarely change mid-session and every call site wants a synchronous read
//  at render time, not a subscription.
//

import Foundation

// MARK: - Preference

/// Distance unit. Raw values match the wire ("mi" / "km") so decoding
/// `UserSettings.units_distance` needs no translation table.
enum DistanceUnit: String, Codable {
    case mi
    case km
}

/// Temperature unit. Raw values match the wire — the backend emits
/// uppercase "F" / "C" (web-v2/lib/coach/settings.ts DEFAULT_SETTINGS),
/// not lowercase.
enum TemperatureUnit: String, Codable {
    case f = "F"
    case c = "C"
}

/// Resolved preference bundle. Pace always renders per the same unit as
/// distance (Daniels pace is time-per-distance-unit) — the backend's
/// `units_pace` field is a derived/redundant echo of `units_distance`, not
/// an independent axis, so we don't carry a third enum here.
struct UnitsPreference: Equatable {
    var distance: DistanceUnit
    var temperature: TemperatureUnit

    /// Every existing user's setting today, and the byte-safe fallback
    /// before the first successful /api/settings fetch on a fresh install.
    static let `default` = UnitsPreference(distance: .mi, temperature: .f)
}

// MARK: - Store

/// Synchronous, app-wide source of truth for the runner's units preference.
/// Read at render time — no async, no subscription. Seeded from AppCache
/// (instant, matches the read pattern every other cached surface uses) and
/// refreshed whenever /api/settings resolves (API.fetchSettings, called from
/// launch prefetch + SettingsView).
enum Units {
    /// Current preference. Views read this directly:
    ///   Text(Units.formatDistance(run.distanceMi))
    /// Computed (not cached in a static var) so a mid-session Settings save
    /// is picked up by the next render without a manual refresh call.
    static var preference: UnitsPreference {
        guard let s = AppCache.read(.userSettings, as: UserSettings.self) else {
            return .default
        }
        let distance: DistanceUnit = (s.units_distance == "km") ? .km : .mi
        // Backend emits uppercase "F"/"C" but tolerate lowercase defensively —
        // this is a display fallback, never re-serialized back to the wire.
        let tempRaw = (s.units_temp ?? "F").uppercased()
        let temperature: TemperatureUnit = (tempRaw == "C") ? .c : .f
        return UnitsPreference(distance: distance, temperature: temperature)
    }

    /// Update the cached preference immediately after a successful Settings
    /// PATCH, so the picker's own screen (and any view that re-renders
    /// before the next full /api/settings GET) reflects the change right
    /// away. UserSettings is Decodable-only (API.swift) — build the merged
    /// payload as a plain JSON dictionary via JSONSerialization rather than
    /// requiring Encodable conformance on a shared wire struct other call
    /// sites depend on. Other UserSettings fields already on disk from the
    /// last full fetch are preserved by merging rather than overwriting —
    /// AppCache.readRaw + JSONSerialization round-trips the untyped bag so
    /// fields this file never named (long_run_day, quality_days, etc.)
    /// survive the patch intact.
    static func applyLocalPatch(unitsDistance: String? = nil, unitsTemp: String? = nil) {
        var dict: [String: Any] = [:]
        if let raw = AppCache.readRaw(.userSettings),
           let existing = (try? JSONSerialization.jsonObject(with: raw)) as? [String: Any] {
            dict = existing
        }
        if let unitsDistance { dict["units_distance"] = unitsDistance }
        if let unitsTemp { dict["units_temp"] = unitsTemp }
        guard let data = try? JSONSerialization.data(withJSONObject: dict) else { return }
        AppCache.writeRaw(.userSettings, data: data)
    }

    // MARK: - Pure conversions (no rounding beyond what's asked for)

    static let milesPerKm = 0.621371
    static let kmPerMile = 1.0 / milesPerKm

    /// Miles → the preference's distance unit. No-ops (returns `mi` value
    /// verbatim) when the preference is `.mi`.
    static func convertDistance(miles: Double, to unit: DistanceUnit) -> Double {
        switch unit {
        case .mi: return miles
        case .km: return miles * kmPerMile
        }
    }

    /// Seconds-per-mile → seconds-per-(preference unit). No-ops when `.mi`.
    /// A pace is TIME per unit DISTANCE, so converting mi→km pace divides
    /// by the mi-per-km factor (going to the smaller unit, km, means less
    /// time per unit → seconds-per-km is SMALLER than seconds-per-mile for
    /// the same speed: 1 mi in secPerMi seconds ⇒ 1 km takes
    /// secPerMi × (1 km / 1 mi) = secPerMi × 0.621371 seconds).
    static func convertPaceSecPerUnit(secPerMile: Double, to unit: DistanceUnit) -> Double {
        switch unit {
        case .mi: return secPerMile
        case .km: return secPerMile * milesPerKm
        }
    }

    /// mph → the preference's speed unit (km/h when distance pref is km).
    static func convertSpeed(mph: Double, to unit: DistanceUnit) -> Double {
        switch unit {
        case .mi: return mph
        case .km: return mph * kmPerMile
        }
    }

    /// Fahrenheit → the preference's temperature unit. No-ops when `.f`.
    static func convertTemperature(fahrenheit: Double, to unit: TemperatureUnit) -> Double {
        switch unit {
        case .f: return fahrenheit
        case .c: return (fahrenheit - 32) * 5.0 / 9.0
        }
    }

    // MARK: - Formatted strings (what views actually call)

    /// "6.2" (mi, one decimal — matches every existing call site's
    /// `String(format: "%.1f", mi)`) or "10.0" (km). Pass `decimals: 2` for
    /// the watch's finer live-tracking reads (was `%.2f` on distanceMi).
    static func formatDistance(miles: Double, decimals: Int = 1, unit: DistanceUnit? = nil) -> String {
        let u = unit ?? preference.distance
        let converted = convertDistance(miles: miles, to: u)
        return String(format: "%.\(decimals)f", converted)
    }

    /// The bare unit label — "mi" or "km" — for callers that render the
    /// number and suffix as separate Text nodes (unit chips, stat columns).
    static func distanceLabel(unit: DistanceUnit? = nil) -> String {
        (unit ?? preference.distance).rawValue
    }

    /// "6:47/mi" or "4:12/km" from seconds-per-mile. Matches the existing
    /// `String(format: "%d:%02d/mi", sec/60, sec%60)` call shape.
    static func formatPace(secPerMile: Double, unit: DistanceUnit? = nil) -> String {
        let u = unit ?? preference.distance
        let perUnit = convertPaceSecPerUnit(secPerMile: secPerMile, to: u)
        let total = max(0, Int(perUnit.rounded()))
        // Deliberately not "%@" in String(format:) — no precedent for that
        // token in this codebase and Swift string interpolation is the
        // house style for appending a non-numeric suffix.
        return "\(String(format: "%d:%02d", total / 60, total % 60))/\(u.rawValue)"
    }

    /// Same as `formatPace` but WITHOUT the trailing "/mi" or "/km" suffix —
    /// for callers that append the unit themselves as a separate Text node
    /// (several views already split "value" + "/mi" into two styled runs).
    static func formatPaceBare(secPerMile: Double, unit: DistanceUnit? = nil) -> String {
        let u = unit ?? preference.distance
        let perUnit = convertPaceSecPerUnit(secPerMile: secPerMile, to: u)
        let total = max(0, Int(perUnit.rounded()))
        return String(format: "%d:%02d", total / 60, total % 60)
    }

    /// Integer seconds overload (most call sites carry Int, not Double).
    static func formatPace(secPerMile: Int, unit: DistanceUnit? = nil) -> String {
        formatPace(secPerMile: Double(secPerMile), unit: unit)
    }
    static func formatPaceBare(secPerMile: Int, unit: DistanceUnit? = nil) -> String {
        formatPaceBare(secPerMile: Double(secPerMile), unit: unit)
    }

    /// "8.6" mph or "13.8" km/h — treadmill speed entry/display.
    static func formatSpeed(mph: Double, decimals: Int = 1, unit: DistanceUnit? = nil) -> String {
        let u = unit ?? preference.distance
        let converted = convertSpeed(mph: mph, to: u)
        return String(format: "%.\(decimals)f", converted)
    }

    /// "mph" or "km/h" — the speed unit label for the treadmill console.
    static func speedLabel(unit: DistanceUnit? = nil) -> String {
        (unit ?? preference.distance) == .km ? "km/h" : "mph"
    }

    /// "72°F" / "22°C" — rounds to whole degrees, matches every existing
    /// `"\(Int(t.rounded()))°F"` call site.
    static func formatTemperature(fahrenheit: Double, unit: TemperatureUnit? = nil) -> String {
        let u = unit ?? preference.temperature
        let converted = convertTemperature(fahrenheit: fahrenheit, to: u)
        return "\(Int(converted.rounded()))°\(u.rawValue)"
    }

    /// Bare degree number without the ° suffix or unit letter, for callers
    /// building their own composite string that doesn't fit
    /// formatTemperature's "N°F" shape exactly.
    static func temperatureUnitSuffix(unit: TemperatureUnit? = nil) -> String {
        (unit ?? preference.temperature).rawValue
    }

    /// A Fahrenheit DELTA (e.g. a raw +6° hotter-than-typical figure, as
    /// distinct from a point reading) converted to the preference unit's
    /// delta scale. Unlike an absolute reading, a Fahrenheit delta converts
    /// to Celsius by ×5/9 with NO -32 offset (the offset cancels between
    /// the two points the delta was taken between). Kept separate from
    /// convertTemperature so callers can't accidentally apply the -32
    /// offset to a delta. Not currently called by any TodayView tag — the
    /// "HOTTER N°F" weather chip turned out to display an ABSOLUTE reading
    /// (formatTemperature, not this), not the delta itself; kept as a
    /// correct, ready-to-use primitive for any future delta-display need.
    static func convertTemperatureDelta(fahrenheitDelta: Double, to unit: TemperatureUnit? = nil) -> Double {
        let u = unit ?? preference.temperature
        switch u {
        case .f: return fahrenheitDelta
        case .c: return fahrenheitDelta * 5.0 / 9.0
        }
    }
}
