//
//  Races.swift  (P40)
//  iPhone race detail wire models.
//

import Foundation

// Lenient decoders across the race chain (doctrine 2026-05-31). A single
// null `race` or `proximity` from a migration-window response used to drop
// the entire RaceDetailResponse and render "could not load this race." Now
// every required field has a safe default so the page degrades gracefully.

struct RaceDetailResponse: Decodable {
    let race: RaceDetail
    let proximity: String   // "post-race" | "race-week" | "sharpening" | "building"
    let course_geometry: CourseGeometry?
    let course_source: String?
    let course_library: CourseLibraryProvenance?

    enum CodingKeys: String, CodingKey {
        case race, proximity, course_geometry, course_source, course_library
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.race = (try? c.decode(RaceDetail.self, forKey: .race)) ?? RaceDetail.empty
        self.proximity = try c.decodeIfPresent(String.self, forKey: .proximity) ?? ""
        self.course_geometry = try c.decodeIfPresent(CourseGeometry.self, forKey: .course_geometry)
        self.course_source = try c.decodeIfPresent(String.self, forKey: .course_source)
        self.course_library = try c.decodeIfPresent(CourseLibraryProvenance.self, forKey: .course_library)
    }
}

struct CourseLibraryProvenance: Decodable {
    let source: String?
    let contributor_count: Int

    enum CodingKeys: String, CodingKey { case source, contributor_count }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.source = try c.decodeIfPresent(String.self, forKey: .source)
        self.contributor_count = try c.decodeIfPresent(Int.self, forKey: .contributor_count) ?? 0
    }
}

struct RaceDetail: Decodable {
    let slug: String
    let name: String
    let date: String
    let priority: String?
    let goal: String?
    let distance_label: String?
    let distance_mi: Double?
    let location: String?
    let is_past: Bool?
    let days: Int?
    let finishTime: String?
    let pb: Bool?
    let matchedRun: RaceMatchedRun?

    /// Empty fallback used by RaceDetailResponse when the wire emits a
    /// null race object (rare but seen during race-CRUD overlap windows).
    static let empty = RaceDetail(
        slug: "", name: "", date: "",
        priority: nil, goal: nil, distance_label: nil, distance_mi: nil,
        location: nil, is_past: nil, days: nil,
        finishTime: nil, pb: nil, matchedRun: nil
    )

    init(slug: String, name: String, date: String,
         priority: String?, goal: String?, distance_label: String?, distance_mi: Double?,
         location: String?, is_past: Bool?, days: Int?,
         finishTime: String?, pb: Bool?, matchedRun: RaceMatchedRun?) {
        self.slug = slug; self.name = name; self.date = date
        self.priority = priority; self.goal = goal
        self.distance_label = distance_label; self.distance_mi = distance_mi
        self.location = location; self.is_past = is_past; self.days = days
        self.finishTime = finishTime; self.pb = pb; self.matchedRun = matchedRun
    }

    enum CodingKeys: String, CodingKey {
        case slug, name, date, priority, goal, distance_label, distance_mi
        case location, is_past, days, finishTime, pb, matchedRun
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.slug = try c.decodeIfPresent(String.self, forKey: .slug) ?? ""
        self.name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        self.date = try c.decodeIfPresent(String.self, forKey: .date) ?? ""
        self.priority = try c.decodeIfPresent(String.self, forKey: .priority)
        self.goal = try c.decodeIfPresent(String.self, forKey: .goal)
        self.distance_label = try c.decodeIfPresent(String.self, forKey: .distance_label)
        self.distance_mi = try c.decodeIfPresent(Double.self, forKey: .distance_mi)
        self.location = try c.decodeIfPresent(String.self, forKey: .location)
        self.is_past = try c.decodeIfPresent(Bool.self, forKey: .is_past)
        self.days = try c.decodeIfPresent(Int.self, forKey: .days)
        self.finishTime = try c.decodeIfPresent(String.self, forKey: .finishTime)
        self.pb = try c.decodeIfPresent(Bool.self, forKey: .pb)
        self.matchedRun = try c.decodeIfPresent(RaceMatchedRun.self, forKey: .matchedRun)
    }
}

struct RaceMatchedRun: Decodable {
    let activity_id: String?
    let pace: String?
    let avg_hr: Int?
    let cadence: Int?
    let elev_gain_ft: Int?

    enum CodingKeys: String, CodingKey { case activity_id, pace, avg_hr, cadence, elev_gain_ft }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.activity_id = try c.decodeIfPresent(String.self, forKey: .activity_id)
        self.pace = try c.decodeIfPresent(String.self, forKey: .pace)
        self.avg_hr = try c.decodeIfPresent(Int.self, forKey: .avg_hr)
        self.cadence = try c.decodeIfPresent(Int.self, forKey: .cadence)
        self.elev_gain_ft = try c.decodeIfPresent(Int.self, forKey: .elev_gain_ft)
    }
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
