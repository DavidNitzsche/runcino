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
    /// 2026-06-09 · race-killer F3 — server-computed, course-aware goal
    /// splits (lib/race/pacing.ts). nil on older servers; consumers fall
    /// back to local linear interpolation.
    let pacing: RacePacing?

    enum CodingKeys: String, CodingKey {
        case race, proximity, course_geometry, course_source, course_library, pacing
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.race = (try? c.decode(RaceDetail.self, forKey: .race)) ?? RaceDetail.empty
        self.proximity = try c.decodeIfPresent(String.self, forKey: .proximity) ?? ""
        self.course_geometry = try c.decodeIfPresent(CourseGeometry.self, forKey: .course_geometry)
        self.course_source = try c.decodeIfPresent(String.self, forKey: .course_source)
        self.course_library = try c.decodeIfPresent(CourseLibraryProvenance.self, forKey: .course_library)
        self.pacing = try? c.decodeIfPresent(RacePacing.self, forKey: .pacing)
    }
}

/// 2026-06-09 · race-killer F3 — course-aware goal pacing from the server.
/// `source` is "course" (grade-weighted over the authored phase profile,
/// cite Research/11 §grade-cost) or "linear" (no usable profile).
struct RacePacing: Decodable {
    let source: String
    let goal_sec: Int
    let splits: [RacePacingSplit]
    let phases: [RacePacingPhase]?
}

struct RacePacingSplit: Decodable {
    let label: String      // "5K" / "10K" / "HALF" / "FINISH"
    let mi: Double
    let cum_sec: Int
    let display: String    // "21:31" / "1:30:00"
}

struct RacePacingPhase: Decodable {
    let label: String          // "Point Loma Climb"
    let start_mi: Double
    let end_mi: Double
    let pace_s_per_mi: Int
    let display: String        // "6:58/mi"
}

struct CourseLibraryProvenance: Decodable {
    let source: String?
    let contributor_count: Int

    enum CodingKeys: String, CodingKey { case source, contributor_count }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.source = try c.decodeIfPresent(String.self, forKey: .source)
        self.contributor_count = c.decodeFlexInt(forKey: .contributor_count) ?? 0
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
    // Race-morning logistics — nil until the runner enters them on the web.
    let gun_time: String?
    let wave: String?

    /// Empty fallback used by RaceDetailResponse when the wire emits a
    /// null race object (rare but seen during race-CRUD overlap windows).
    static let empty = RaceDetail(
        slug: "", name: "", date: "",
        priority: nil, goal: nil, distance_label: nil, distance_mi: nil,
        location: nil, is_past: nil, days: nil,
        finishTime: nil, pb: nil, matchedRun: nil,
        gun_time: nil, wave: nil
    )

    init(slug: String, name: String, date: String,
         priority: String?, goal: String?, distance_label: String?, distance_mi: Double?,
         location: String?, is_past: Bool?, days: Int?,
         finishTime: String?, pb: Bool?, matchedRun: RaceMatchedRun?,
         gun_time: String? = nil, wave: String? = nil) {
        self.slug = slug; self.name = name; self.date = date
        self.priority = priority; self.goal = goal
        self.distance_label = distance_label; self.distance_mi = distance_mi
        self.location = location; self.is_past = is_past; self.days = days
        self.finishTime = finishTime; self.pb = pb; self.matchedRun = matchedRun
        self.gun_time = gun_time; self.wave = wave
    }

    enum CodingKeys: String, CodingKey {
        case slug, name, date, priority, goal, distance_label, distance_mi
        case location, is_past, days, finishTime, pb, matchedRun
        case gun_time, wave
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
        self.days = c.decodeFlexInt(forKey: .days)
        self.finishTime = try c.decodeIfPresent(String.self, forKey: .finishTime)
        self.pb = try c.decodeIfPresent(Bool.self, forKey: .pb)
        self.matchedRun = try c.decodeIfPresent(RaceMatchedRun.self, forKey: .matchedRun)
        self.gun_time = try c.decodeIfPresent(String.self, forKey: .gun_time)
        self.wave = try c.decodeIfPresent(String.self, forKey: .wave)
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
        self.avg_hr = c.decodeFlexInt(forKey: .avg_hr)
        self.cadence = c.decodeFlexInt(forKey: .cadence)
        self.elev_gain_ft = c.decodeFlexInt(forKey: .elev_gain_ft)
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

// MARK: - Race execution plan (race P2)
//
// GET /api/race/[slug]/execution-plan → composeRaceExecutionPlan
// (lib/race/execution-plan.ts). The composed race-morning brief: per-mile
// split targets, the objective B-goal trigger, the heat decision tree, and
// the warm-up timeline anchored to the gun. One endpoint, every surface.
//
// Decode-robust by design: every field is optional and unknown keys are
// ignored. A parallel agent is enhancing the server's fueling block, so the
// response shape is still evolving — we decode only splits / bGoal / heat /
// warmup / strategy prose and never throw on a present-but-unexpected blob.
// Fueling (`plan.fuelingPlan` / `plan.fueling`) is left for the fueling
// phase, which owns entry + display; it is intentionally NOT modeled here.

struct RaceExecutionPlanResponse: Decodable {
    let slug: String?
    let raceName: String?
    let raceDateISO: String?
    let startTimeLocal: String?
    let plan: RaceExecutionPlan?

    enum CodingKeys: String, CodingKey {
        case slug, raceName, raceDateISO, startTimeLocal, plan
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.slug = try? c.decodeIfPresent(String.self, forKey: .slug)
        self.raceName = try? c.decodeIfPresent(String.self, forKey: .raceName)
        self.raceDateISO = try? c.decodeIfPresent(String.self, forKey: .raceDateISO)
        self.startTimeLocal = try? c.decodeIfPresent(String.self, forKey: .startTimeLocal)
        self.plan = try? c.decodeIfPresent(RaceExecutionPlan.self, forKey: .plan)
    }
}

struct RaceExecutionPlan: Decodable {
    let goalSec: Int?
    let goalPaceSPerMi: Int?
    let distanceMi: Double?
    let bGoalSec: Int?
    let bGoalPaceSPerMi: Int?
    let firstMileAllowanceSPerMi: Int?
    let splits: [RaceSplitTarget]
    let bGoalTriggers: [BGoalTrigger]
    let heatRules: [HeatRule]
    let warmup: [WarmupStep]
    let strategyLine: String?
    let ciNote: String?

    enum CodingKeys: String, CodingKey {
        case goalSec, goalPaceSPerMi, distanceMi, bGoalSec, bGoalPaceSPerMi
        case firstMileAllowanceSPerMi, splits, bGoalTriggers, heatRules
        case warmup, strategyLine, ciNote
        // Intentionally unmodeled: fueling, fuelingPlan — owned by the
        // fueling phase. Unknown keys decode-skip via decodeIfPresent.
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.goalSec = c.decodeFlexInt(forKey: .goalSec)
        self.goalPaceSPerMi = c.decodeFlexInt(forKey: .goalPaceSPerMi)
        self.distanceMi = try? c.decodeIfPresent(Double.self, forKey: .distanceMi)
        self.bGoalSec = c.decodeFlexInt(forKey: .bGoalSec)
        self.bGoalPaceSPerMi = c.decodeFlexInt(forKey: .bGoalPaceSPerMi)
        self.firstMileAllowanceSPerMi = c.decodeFlexInt(forKey: .firstMileAllowanceSPerMi)
        self.splits = (try? c.decodeIfPresent([RaceSplitTarget].self, forKey: .splits)) ?? []
        self.bGoalTriggers = (try? c.decodeIfPresent([BGoalTrigger].self, forKey: .bGoalTriggers)) ?? []
        self.heatRules = (try? c.decodeIfPresent([HeatRule].self, forKey: .heatRules)) ?? []
        self.warmup = (try? c.decodeIfPresent([WarmupStep].self, forKey: .warmup)) ?? []
        self.strategyLine = try? c.decodeIfPresent(String.self, forKey: .strategyLine)
        self.ciNote = try? c.decodeIfPresent(String.self, forKey: .ciNote)
    }
}

/// One per-mile split target. `label` is "settle" | "find rhythm" |
/// "goal pace" | "push"; kept as a String so a future label can't break
/// the decode.
struct RaceSplitTarget: Decodable {
    let mile: Int?
    let distanceMi: Double?
    let paceSPerMi: Int?
    let cumulativeSec: Int?
    let label: String?

    enum CodingKeys: String, CodingKey {
        case mile, distanceMi, paceSPerMi, cumulativeSec, label
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.mile = c.decodeFlexInt(forKey: .mile)
        self.distanceMi = try? c.decodeIfPresent(Double.self, forKey: .distanceMi)
        self.paceSPerMi = c.decodeFlexInt(forKey: .paceSPerMi)
        self.cumulativeSec = c.decodeFlexInt(forKey: .cumulativeSec)
        self.label = try? c.decodeIfPresent(String.self, forKey: .label)
    }
}

/// Objective mid-race abort criterion. `hrAboveBpm` is null when the runner
/// has no LTHR / maxHr anchor.
struct BGoalTrigger: Decodable {
    let atMile: Int?
    let hrAboveBpm: Int?
    let paceSlowerThanSPerMi: Int?
    let action: String?

    enum CodingKeys: String, CodingKey {
        case atMile, hrAboveBpm, paceSlowerThanSPerMi, action
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.atMile = c.decodeFlexInt(forKey: .atMile)
        self.hrAboveBpm = c.decodeFlexInt(forKey: .hrAboveBpm)
        self.paceSlowerThanSPerMi = c.decodeFlexInt(forKey: .paceSlowerThanSPerMi)
        self.action = try? c.decodeIfPresent(String.self, forKey: .action)
    }
}

/// One row of the heat decision tree: at-or-above this start temp, add this
/// to every split.
struct HeatRule: Decodable {
    let ifStartTempAtLeastF: Int?
    let addSPerMi: Int?
    let note: String?

    enum CodingKeys: String, CodingKey {
        case ifStartTempAtLeastF, addSPerMi, note
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.ifStartTempAtLeastF = c.decodeFlexInt(forKey: .ifStartTempAtLeastF)
        self.addSPerMi = c.decodeFlexInt(forKey: .addSPerMi)
        self.note = try? c.decodeIfPresent(String.self, forKey: .note)
    }
}

/// One warm-up step. `clock` ("6:15 AM") is null when the gun time is unknown,
/// in which case the surface leans on `minutesBeforeGun`.
struct WarmupStep: Decodable {
    let minutesBeforeGun: Int?
    let clock: String?
    let step: String?

    enum CodingKeys: String, CodingKey {
        case minutesBeforeGun, clock, step
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.minutesBeforeGun = c.decodeFlexInt(forKey: .minutesBeforeGun)
        self.clock = try? c.decodeIfPresent(String.self, forKey: .clock)
        self.step = try? c.decodeIfPresent(String.self, forKey: .step)
    }
}
