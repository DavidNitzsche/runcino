//
//  FaffPayloads.swift
//
//  Component-ready payload types for the iPhone Today surface.
//  Mirrors `web-v2/lib/faff/types.ts` (the canonical contract shared
//  by web + iOS clients) — only the fields the iPhone actually renders
//  for v1. Future surfaces (/plan, /races, /health, /me) can extend.
//
//  Design rules respected:
//    · DayState enum mirrors the 11-state union locked in
//      design/resolver/states.md (2026-05-28).
//    · Poster/Sibling/WeekStrip shapes mirror the named TS interfaces
//      so a future codegen step can stamp these from one source.
//    · Stat / MiniTile / SiblingTitle are referenced inline (no
//      tagged-union explosion · the iPhone resolver is the only call
//      site and it knows which fields to set per state).
//

import Foundation
import SwiftUI

// MARK: - Enums

/// 11-state day enum — mirrors `DayState` in web-v2/lib/faff/types.ts.
enum FaffDayState: String, Codable {
    case easy, quality, long, rest
    case done_nailed, done_ease_off
    case niggle, sick, missed, race_week, new_user
}

/// Status dot color · mirrors `DotColor` in web-v2/lib/faff/types.ts.
enum FaffDotColor: String, Codable {
    case green, amber, over, dist, none
}

/// Value color cue · mirrors `ValueColor` in web-v2/lib/faff/types.ts.
enum FaffValueColor: String, Codable {
    case `default`, amber, green, over, race, dist
}

// MARK: - Stat trio (Poster bottom strip)

struct FaffStat {
    let value: String
    let label: String
    var valueColor: FaffValueColor = .default
}

// MARK: - Hero number (used for LONG mileage + race-week countdown)

struct FaffHeroNumber {
    let value: String
    let unit: String?
    let duration: String?
}

struct FaffDaysCountdown {
    let days: Int
    let dateLabel: String
}

// MARK: - PosterPayload

/// Gradient hero card payload · mirrors `PosterPayload` in web-v2/lib/faff/types.ts.
///
/// The iPhone keeps a `SwiftUI.LinearGradient` directly on the payload
/// (resolved from the state via Theme.Gradient.X in the adapter) so the
/// view doesn't have to re-map state→gradient at render time. This is
/// the Swift-side equivalent of CSS's `var(--g-<token>)`.
struct PosterPayload {
    let state: FaffDayState
    let gradient: LinearGradient
    let eyebrow: String          // "THU · MAY 28 · BASE"
    let verb: String             // "EASY 6.1.", "REST.", "NAILED IT.", etc.
    let verbSuffix: String?
    let prose: String?
    let phaseTag: String?
    let statTrio: [FaffStat]?
    let heroNumber: FaffHeroNumber?
    let daysCountdown: FaffDaysCountdown?
}

// MARK: - Sibling

struct FaffSiblingTitle {
    let main: String             // "THE BODY", "BANKED IT", etc.
    let suffix: String?          // "TODAY", "EASE OFF", etc.
}

struct FaffMiniTile {
    let label: String            // "SLEEP", "RHR", "HRV", "LOAD"
    let value: String            // "7.4", "52", "—"
    let valueUnit: String?       // "h", "bpm", "ms"
    var valueColor: FaffValueColor = .default
    let meta: String             // "7d avg", "+2 vs base", "sweet spot"
    let metaStrong: String?
    let dot: FaffDotColor
}

/// Dark dashboard card next to the Poster · mirrors `SiblingPayload`
/// in web-v2/lib/faff/types.ts (collapsed from a tagged union to a
/// single struct with optional state-specific fields).
struct SiblingPayload {
    let state: FaffDayState
    let title: FaffSiblingTitle
    let tiles: [FaffMiniTile]
    let prose: String?
    let actionTileIndex: Int?
}

// MARK: - WeekStrip

/// One day card in the 7-day strip. Mirrors `WeekStripPayload.days[i]`
/// in web-v2/lib/faff/types.ts.
struct FaffWeekDay: Identifiable {
    let date: String             // YYYY-MM-DD
    var id: String { date }
    let dow: Int                 // 0..6 (M..S, matching the web's DOW_LABELS)
    let plannedType: String?     // 'easy'|'quality'|'long'|'rest'|... or nil
    let plannedDistance: Double? // mi
    let plannedTypeLabel: String // EASY|INTS|TMPO|THRS|LONG|REST|RACE|... (4 chars)
    let completedRunId: String?
    let isToday: Bool
    let isFuture: Bool
}

/// WeekStrip payload · mirrors `WeekStripPayload` in web-v2/lib/faff/types.ts.
struct WeekStripPayload {
    let weekStart: String
    let days: [FaffWeekDay]
    let plannedMi: Double
    let completedMi: Double
}
