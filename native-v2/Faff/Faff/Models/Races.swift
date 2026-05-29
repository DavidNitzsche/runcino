//
//  Races.swift  (P40)
//  iPhone race detail wire models.
//

import Foundation

struct RaceDetailResponse: Decodable {
    let race: RaceDetail
    let proximity: String   // "post-race" | "race-week" | "sharpening" | "building"
    let course_geometry: CourseGeometry?   // raw GPX geometry; all-optional so it can't break decode
    let course_source: String?
}

struct RaceDetail: Decodable {
    let slug: String
    let name: String
    let date: String
    let priority: String?       // "A" | "B" | "C"
    let goal: String?
    let distance_label: String?
    let distance_mi: Double?
    let location: String?
    let is_past: Bool?
    let days: Int?
    // BUGFIX 2026-05-29: web RaceRow emits camelCase `finishTime` and a
    // boolean `pb` flag. The old `finish_time` key never decoded, and
    // `pb: String?` threw on any non-null value — silently nil-ing the
    // whole sheet through the `try?` decode in API.swift.
    let finishTime: String?
    let pb: Bool?
    // Past-race enrichment — the matching run pulled from the log.
    let matchedRun: RaceMatchedRun?
}

/// Matched-run summary for a past race (mirrors RaceRow.matchedRun in
/// lib/coach/races-state.ts). HR/cadence/elev are integers in the Strava
/// source — the same fields the Log/RunDetail models already decode as Int.
struct RaceMatchedRun: Decodable {
    let activity_id: String?
    let pace: String?
    let avg_hr: Int?
    let cadence: Int?
    let elev_gain_ft: Int?
}

/// Raw GPX course geometry stored on races.course_geometry (mirrors
/// CourseGeometry in lib/race/gpx-parser.ts). Every field is optional and
/// all numbers are Double so a present-but-unexpected blob can never throw
/// and break the RaceDetailResponse decode. Not rendered yet — the course
/// map is a follow-up; carried so it ships without another wire change.
struct CourseGeometry: Decodable {
    let source: String?            // "upload" | "library" | "strava_match"
    let trackPoints: [CourseTrackPoint]?
    let distance_mi: Double?
    let elevation_gain_ft: Double?
    let bbox: CourseBBox?
    let raw_filename: String?
}

struct CourseTrackPoint: Decodable {
    let lat: Double?
    let lon: Double?
    let ele: Double?
}

struct CourseBBox: Decodable {
    let minLat: Double?
    let maxLat: Double?
    let minLon: Double?
    let maxLon: Double?
}
