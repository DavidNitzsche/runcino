//
//  Runs.swift
//  Wire models for /api/log + /api/runs/[id]. Mirrors the server shapes
//  in lib/coach/log-state.ts and lib/coach/run-state.ts so the iPhone
//  surfaces work off the same data as web /log and web /runs/[id].
//

import Foundation

// MARK: - /api/log

// 2026-05-31 audit round 3 — ROOT CAUSE for "no runs on iPhone":
// `try c.decodeIfPresent(Int.self, ...)` tolerates missing key + null
// value but THROWS on a type mismatch. Apple Watch and HK averaging
// emit fractional HR (`avg_hr: 142.5`) which is JSON-valid but trips
// the Int decoder. One throw inside a LogRun fails the parent
// [LogRun] decode; the outer try? at LogWeek/LogState swallows it;
// that whole week's runs collapse to []. Backend agent confirmed 100
// runs returned for David's user_uuid; phone rendered zero. Fix is to
// (a) use try? on every scalar so a type mismatch becomes nil, and
// (b) introduce flexInt() for the Int fields that decodes Int OR
// Double-rounded so fractional wire values survive.
struct LogState: Decodable {
    let today: String
    let totalRuns: Int
    let totalMi: Double
    let weeks: [LogWeek]
    let totalRunsUnfiltered: Int?
    let totalMiUnfiltered: Double?
    let axes: LogFilterAxes?
    let filters: LogFilters?

    enum CodingKeys: String, CodingKey {
        case today, totalRuns, totalMi, weeks
        case totalRunsUnfiltered, totalMiUnfiltered, axes, filters
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.today = (try? c.decode(String.self, forKey: .today)) ?? ""
        self.totalRuns = c.decodeFlexInt(forKey: .totalRuns) ?? 0
        self.totalMi = (try? c.decode(Double.self, forKey: .totalMi)) ?? 0
        self.weeks = (try? c.decode([LogWeek].self, forKey: .weeks)) ?? []
        self.totalRunsUnfiltered = c.decodeFlexInt(forKey: .totalRunsUnfiltered)
        self.totalMiUnfiltered = try? c.decode(Double.self, forKey: .totalMiUnfiltered)
        self.axes = try? c.decode(LogFilterAxes.self, forKey: .axes)
        self.filters = try? c.decode(LogFilters.self, forKey: .filters)
    }

}

// Per-axis available values for the /log filter chip strip — render a chip
// only for values that actually appear in the unfiltered set.
struct LogFilterAxes: Decodable {
    let sources: [String]
    let types: [String]
    let phases: [String]
    let shoes: [LogShoeAxis]

    enum CodingKeys: String, CodingKey { case sources, types, phases, shoes }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.sources = (try? c.decode([String].self, forKey: .sources)) ?? []
        self.types = (try? c.decode([String].self, forKey: .types)) ?? []
        self.phases = (try? c.decode([String].self, forKey: .phases)) ?? []
        self.shoes = (try? c.decode([LogShoeAxis].self, forKey: .shoes)) ?? []
    }
}

struct LogShoeAxis: Decodable, Identifiable {
    var id: String { slug }
    let slug: String
    let name: String
    let runs: Int

    enum CodingKeys: String, CodingKey { case slug, name, runs }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.slug = try c.decodeIfPresent(String.self, forKey: .slug) ?? ""
        self.name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        self.runs = c.decodeFlexInt(forKey: .runs) ?? 0
    }
}

// Active filters echoed back by the server (null = not filtering that axis).
struct LogFilters: Decodable {
    let source: String?
    let type: String?
    let phase: String?
    let shoe: String?

    enum CodingKeys: String, CodingKey { case source, type, phase, shoe }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.source = try c.decodeIfPresent(String.self, forKey: .source)
        self.type = try c.decodeIfPresent(String.self, forKey: .type)
        self.phase = try c.decodeIfPresent(String.self, forKey: .phase)
        self.shoe = try c.decodeIfPresent(String.self, forKey: .shoe)
    }
}

struct LogWeek: Decodable, Identifiable {
    // 2026-05-31 audit round 3: every scalar uses try? so a wire type
    // mismatch falls to the default instead of throwing and dropping
    // the whole week. See LogState comment for the original failure mode.
    var id: String { monday }
    let monday: String
    let label: String
    let totalMi: Double
    let totalDuration: String?
    let runs: [LogRun]
    let isCurrent: Bool?

    enum CodingKeys: String, CodingKey { case monday, label, totalMi, totalDuration, runs, isCurrent }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.monday = (try? c.decode(String.self, forKey: .monday)) ?? ""
        self.label = (try? c.decode(String.self, forKey: .label)) ?? ""
        self.totalMi = (try? c.decode(Double.self, forKey: .totalMi)) ?? 0
        self.totalDuration = try? c.decode(String.self, forKey: .totalDuration)
        self.runs = (try? c.decode([LogRun].self, forKey: .runs)) ?? []
        self.isCurrent = try? c.decode(Bool.self, forKey: .isCurrent)
    }
}

struct LogRun: Decodable, Identifiable {
    // 2026-05-31 audit round 3: flexInt for every Int field so a
    // fractional HR/cadence/elev from Apple Watch averaging doesn't
    // throw and collapse the parent [LogRun] array. See LogState
    // comment for the failure mode.
    let id: String
    let date: String
    let dow: Int
    let start_local: String?
    let name: String
    let source: String
    let type: String?
    let distance_mi: Double
    let pace: String?
    let time_moving: String?
    let avg_hr: Int?
    let max_hr: Int?
    let cadence: Int?
    let elev_gain_ft: Int?
    let workoutType: String?
    let phaseLabel: String?
    let shoeName: String?
    let shoeSlug: String?
    // 2026-06-01 · `indoor` written by /api/watch/workouts/complete when the
    // iPhone POSTs a treadmill session (body.indoor=true). Null on outdoor
    // sources. Activity feed + run detail use it to gate "no-GPS"
    // affordances and pick the right glyph independently of `source`.
    let indoor: Bool?
    // 2026-08-17 · the Activity truth audit's three enrichment signals
    // (web-v2/lib/runs/log-enrich.ts, applied in lib/coach/log-state.ts).
    // All three were already on the /api/log wire and silently dropped by
    // this decoder, which is why the AFC Half rendered as a generic effort
    // word instead of its real name.
    /// True when the run matched a race on the runner's calendar.
    let isRace: Bool?
    /// The matched race's slug · lets the row link to the race page.
    let raceSlug: String?
    /// RACE | NAILED IT | SOLID | LONGEST · nil when nothing was earned.
    let badge: String?

    enum CodingKeys: String, CodingKey {
        case id, date, dow, start_local, name, source, type, distance_mi
        case pace, time_moving, avg_hr, max_hr, cadence, elev_gain_ft
        case workoutType, phaseLabel, shoeName, shoeSlug, indoor
        case isRace, raceSlug, badge
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.id = (try? c.decode(String.self, forKey: .id)) ?? UUID().uuidString
        self.date = (try? c.decode(String.self, forKey: .date)) ?? ""
        self.dow = c.decodeFlexInt(forKey: .dow) ?? 0
        self.start_local = try? c.decode(String.self, forKey: .start_local)
        self.name = (try? c.decode(String.self, forKey: .name)) ?? "Run"
        self.source = (try? c.decode(String.self, forKey: .source)) ?? "unknown"
        self.type = try? c.decode(String.self, forKey: .type)
        self.distance_mi = (try? c.decode(Double.self, forKey: .distance_mi)) ?? 0
        self.pace = try? c.decode(String.self, forKey: .pace)
        self.time_moving = try? c.decode(String.self, forKey: .time_moving)
        self.avg_hr = c.decodeFlexInt(forKey: .avg_hr)
        self.max_hr = c.decodeFlexInt(forKey: .max_hr)
        self.cadence = c.decodeFlexInt(forKey: .cadence)
        self.elev_gain_ft = c.decodeFlexInt(forKey: .elev_gain_ft)
        self.workoutType = try? c.decode(String.self, forKey: .workoutType)
        self.phaseLabel = try? c.decode(String.self, forKey: .phaseLabel)
        self.shoeName = try? c.decode(String.self, forKey: .shoeName)
        self.shoeSlug = try? c.decode(String.self, forKey: .shoeSlug)
        self.indoor = try? c.decode(Bool.self, forKey: .indoor)
        self.isRace = try? c.decode(Bool.self, forKey: .isRace)
        self.raceSlug = try? c.decode(String.self, forKey: .raceSlug)
        self.badge = try? c.decode(String.self, forKey: .badge)
    }

    /// Generic device-default names carry zero information. Mirrors
    /// `isGenericRunName` in web-v2/lib/runs/log-enrich.ts so the phone
    /// agrees with the server about which names are worth showing.
    ///
    /// The server already coalesced the merged Strava twin's real name
    /// into `name`; this check only decides whether the row has a name
    /// worth putting in front of the effort word, never re-derives one.
    var hasMeaningfulName: Bool {
        let s = name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if s.isEmpty { return false }
        let generic: Set<String> = [
            "run", "workout", "treadmill", "treadmill run",
            "outdoor run", "indoor run",
        ]
        if generic.contains(s) { return false }
        for prefix in ["morning ", "lunch ", "afternoon ", "evening ", "night "] {
            if s.hasPrefix(prefix), generic.contains(String(s.dropFirst(prefix.count))) {
                return false
            }
        }
        return true
    }
}

// MARK: - /api/runs/[id]

struct RunDetail: Decodable, Identifiable {
    // 2026-05-31 audit: non-id fields stay non-optional at the call site
    // (view code reads `.distance_mi`, `.splits`, etc. directly) but the
    // decoder is now lenient · null/missing wire values default to safe
    // zeros / empty arrays / "" rather than throwing and dropping the
    // whole RunDetail. A single missing field used to nuke the entire
    // run-detail screen ("Could not load this run") · no longer.
    let id: String
    let date: String
    let start_local: String?
    let name: String?
    let source: String
    let type: String?
    /// The runner-facing word for `type`, composed by the server's one
    /// enum-to-name table (`displayTypeFor`). Nil on a server that predates
    /// the field; see `RunDetailV5.title` for what happens then and why the
    /// table is not restated here.
    let type_display: String?

    let distance_mi: Double
    let pace: String?
    let pace_s_per_mi: Int?
    let time_moving: String?
    let time_elapsed: String?
    let avg_speed_mph: Double?

    let hr_avg: Int?
    let hr_max: Int?
    let cadence_avg: Int?
    let elev_gain_ft: Int?
    let temp_f: Double?

    let has_route: Bool
    let route_polyline: String?
    let splits: [RunSplit]
    let hrZonePcts: HRZonePcts
    let form: RunForm?

    // P42 + P45 — work-phase-only averages (excludes warmup, cooldown,
    // recovery jogs). Null on easy/long runs or when no phase data is
    // available.
    let pace_work: String?
    let pace_work_s_per_mi: Int?
    let hr_avg_work: Int?
    let cadence_avg_work: Int?
    let work_seconds: Int?

    // P44 — phase-by-phase breakdown when the Faff watch app ran a
    // structured workout. Empty for runs from other sources.
    let phase_breakdown: [PhaseBreakdown]?

    // ── Audit 2026-05-29 · fields web /api/runs/[id] already emits
    //    (lib/coach/run-state.ts RunDetail) that the phone was silently
    //    dropping. Optional/Double-typed for decode safety; not all
    //    rendered yet — carried so the modal can grow without a re-wire. ──
    let suffer_score: Int?
    let kudos: Int?
    let shoe_id: Int?              // assigned shoe (P32)
    let shoes: [RunDetailShoe]?    // inline non-retired inventory for the picker
    let hr_zones_from_lthr: HRZonesFromLTHR?
    let planned_spec: WorkoutSpec?     // Migration 120 structured spec
    let planned_sub_label: String?
    let planned_distance_mi: Double?
    /// The zone(s) the PLANNED session asked for, 1-indexed and ascending.
    /// Empty when nothing was planned that day, or when doctrine assigns the
    /// planned type no zone — an unhighlighted bar is honest, a guessed one
    /// is not.
    ///
    /// Server-derived (`lib/coach/zone-target.ts`, off the `plan_workouts`
    /// row) and never re-derived here. This screen used to carry its own
    /// copy of that switch keyed on `type` — the RUN's own type, not the
    /// prescription's — and the copy had already drifted from the table it
    /// was copying. One table, one owner, and the owner is the server.
    ///
    /// A SET because a race is not one zone: a half straddles the 90%
    /// %HRmax edge and asks for Z4 and Z5 both.
    let zoneTargets: [Int]
    /// 8b · what the runner decided on the wrist. Empty for almost every run.
    let ceiling_lift: RunCeilingLift?
    let rep_skips: [RunRepSkip]
    let recovery_extensions: [RunRecoveryExtension]

    enum CodingKeys: String, CodingKey {
        case id, date, start_local, name, source, type, type_display
        case distance_mi, pace, pace_s_per_mi, time_moving, time_elapsed, avg_speed_mph
        case hr_avg, hr_max, cadence_avg, elev_gain_ft, temp_f
        case has_route, route_polyline, splits, hrZonePcts, form
        case pace_work, pace_work_s_per_mi, hr_avg_work, cadence_avg_work, work_seconds
        case phase_breakdown
        case suffer_score, kudos, shoe_id, shoes, hr_zones_from_lthr
        case planned_spec, planned_sub_label, planned_distance_mi
        case zoneTargets
        case ceiling_lift, rep_skips, recovery_extensions
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        self.date = try c.decodeIfPresent(String.self, forKey: .date) ?? ""
        self.start_local = try c.decodeIfPresent(String.self, forKey: .start_local)
        self.name = try c.decodeIfPresent(String.self, forKey: .name)
        self.source = try c.decodeIfPresent(String.self, forKey: .source) ?? "unknown"
        self.type = try c.decodeIfPresent(String.self, forKey: .type)
        self.type_display = try c.decodeIfPresent(String.self, forKey: .type_display)
        self.distance_mi = try c.decodeIfPresent(Double.self, forKey: .distance_mi) ?? 0
        self.pace = try c.decodeIfPresent(String.self, forKey: .pace)
        self.pace_s_per_mi = c.decodeFlexInt(forKey: .pace_s_per_mi)
        self.time_moving = try c.decodeIfPresent(String.self, forKey: .time_moving)
        self.time_elapsed = try c.decodeIfPresent(String.self, forKey: .time_elapsed)
        self.avg_speed_mph = try c.decodeIfPresent(Double.self, forKey: .avg_speed_mph)
        self.hr_avg = c.decodeFlexInt(forKey: .hr_avg)
        self.hr_max = c.decodeFlexInt(forKey: .hr_max)
        self.cadence_avg = c.decodeFlexInt(forKey: .cadence_avg)
        self.elev_gain_ft = c.decodeFlexInt(forKey: .elev_gain_ft)
        self.temp_f = try c.decodeIfPresent(Double.self, forKey: .temp_f)
        self.has_route = try c.decodeIfPresent(Bool.self, forKey: .has_route) ?? false
        self.route_polyline = try c.decodeIfPresent(String.self, forKey: .route_polyline)
        self.splits = (try? c.decode([RunSplit].self, forKey: .splits)) ?? []
        self.hrZonePcts = (try? c.decode(HRZonePcts.self, forKey: .hrZonePcts))
            ?? HRZonePcts(z1: 0, z2: 0, z3: 0, z4: 0, z5: 0)
        self.form = try? c.decode(RunForm.self, forKey: .form)
        self.pace_work = try c.decodeIfPresent(String.self, forKey: .pace_work)
        self.pace_work_s_per_mi = c.decodeFlexInt(forKey: .pace_work_s_per_mi)
        self.hr_avg_work = c.decodeFlexInt(forKey: .hr_avg_work)
        self.cadence_avg_work = c.decodeFlexInt(forKey: .cadence_avg_work)
        self.work_seconds = c.decodeFlexInt(forKey: .work_seconds)
        self.phase_breakdown = try c.decodeIfPresent([PhaseBreakdown].self, forKey: .phase_breakdown)
        self.suffer_score = c.decodeFlexInt(forKey: .suffer_score)
        self.kudos = c.decodeFlexInt(forKey: .kudos)
        self.shoe_id = c.decodeFlexInt(forKey: .shoe_id)
        self.shoes = try c.decodeIfPresent([RunDetailShoe].self, forKey: .shoes)
        self.hr_zones_from_lthr = try c.decodeIfPresent(HRZonesFromLTHR.self, forKey: .hr_zones_from_lthr)
        self.planned_spec = try c.decodeIfPresent(WorkoutSpec.self, forKey: .planned_spec)
        self.planned_sub_label = try c.decodeIfPresent(String.self, forKey: .planned_sub_label)
        self.planned_distance_mi = try c.decodeIfPresent(Double.self, forKey: .planned_distance_mi)
        // Lenient like every sibling here: an older server that does not
        // send the key yields [], which highlights nothing — the same thing
        // this screen did before the field existed, never a wrong zone.
        self.zoneTargets = (try? c.decode([Int].self, forKey: .zoneTargets)) ?? []
        self.ceiling_lift = try? c.decodeIfPresent(RunCeilingLift.self, forKey: .ceiling_lift)
        self.rep_skips = (try? c.decode([RunRepSkip].self, forKey: .rep_skips)) ?? []
        self.recovery_extensions = (try? c.decode([RunRecoveryExtension].self, forKey: .recovery_extensions)) ?? []
    }
}

/// P44 — single phase of a structured workout, plan vs actual.
struct PhaseBreakdown: Decodable, Identifiable {
    var id: Int { index }
    let index: Int
    let label: String
    let type: String                       // "warmup" | "work" | "recovery" | "cooldown" | "unknown"
    let target_pace: String?
    let target_pace_sec: Double?
    let tolerance_pace_sec: Double?
    let target_distance_mi: Double?
    let target_duration_sec: Int?
    let actual_pace: String?
    let actual_distance_mi: Double?
    let actual_duration_sec: Int?
    let avg_hr: Int?
    let max_hr: Int?
    let avg_cadence: Int?
    let completed: Bool
    let status: String?                    // "on" | "fast" | "slow" | nil

    /// THE WATCH'S OWN GRADE, and not the same thing as `status`.
    ///
    /// `status` is the server's read, recomputed from the two paces with a
    /// heat allowance. `verdict` is what the device decided on the wrist,
    /// against the tolerance the server sent it, using a 5-second sample
    /// stream that never leaves the watch:
    ///
    ///   hit        · mean pace in band AND at least 70% of samples in band
    ///   drifted    · mean pace in band, under 70% of samples in band
    ///   missed     · mean pace outside the band
    ///   incomplete · the phase ended before reaching its target
    ///
    /// The two legitimately disagree. A rep whose mean was fine but which
    /// sawed either side of the band reads `on` and `drifted`, and the second
    /// is the one holding the sample stream's evidence.
    ///
    /// Nil on every treadmill phase and on any phase with no target — absence
    /// of recording, never a judgement.
    let verdict: String?                   // "hit" | "drifted" | "missed" | "incomplete" | nil
    /// Seconds inside the pace band, as the device counted them.
    let time_in_tolerance_sec: Int?
    /// Seconds outside it. `in + out` is the GRADED time and is shorter than
    /// `actual_duration_sec` — the device only grades while it has a pace.
    let time_out_of_tolerance_sec: Int?

    enum CodingKeys: String, CodingKey {
        case index, label, type
        case target_pace, target_pace_sec, tolerance_pace_sec
        case target_distance_mi, target_duration_sec
        case actual_pace, actual_distance_mi, actual_duration_sec
        case avg_hr, max_hr, avg_cadence, completed, status
        case verdict, time_in_tolerance_sec, time_out_of_tolerance_sec
    }

    /// WRITTEN OUT, NOT SYNTHESISED, and the reason is in `decodeFlexInt`'s
    /// own doc comment in `API.swift`: "one throw inside a nested Codable
    /// failed the whole parent array". Every Int here comes off `Number(...)`
    /// in `lib/coach/run-state.ts`, and HealthKit / Apple Watch averaging
    /// produces fractional heart rates and cadences that are JSON-valid and
    /// throw `Int.self`. This struct decoded through the synthesised
    /// initialiser, so one `"avg_hr": 164.5` would have taken down not just
    /// the phase list but the ENTIRE run detail — `phase_breakdown` is read
    /// with `try c.decodeIfPresent`, which re-raises.
    ///
    /// Nothing here throws now. A field we cannot read is nil, which every
    /// reader already treats as "the watch did not record it".
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.index = c.decodeFlexInt(forKey: .index) ?? 0
        self.label = (try? c.decode(String.self, forKey: .label)) ?? ""
        self.type = (try? c.decode(String.self, forKey: .type)) ?? "unknown"
        self.target_pace = try? c.decodeIfPresent(String.self, forKey: .target_pace)
        self.target_pace_sec = try? c.decodeIfPresent(Double.self, forKey: .target_pace_sec)
        self.tolerance_pace_sec = try? c.decodeIfPresent(Double.self, forKey: .tolerance_pace_sec)
        self.target_distance_mi = try? c.decodeIfPresent(Double.self, forKey: .target_distance_mi)
        self.target_duration_sec = c.decodeFlexInt(forKey: .target_duration_sec)
        self.actual_pace = try? c.decodeIfPresent(String.self, forKey: .actual_pace)
        self.actual_distance_mi = try? c.decodeIfPresent(Double.self, forKey: .actual_distance_mi)
        self.actual_duration_sec = c.decodeFlexInt(forKey: .actual_duration_sec)
        self.avg_hr = c.decodeFlexInt(forKey: .avg_hr)
        self.max_hr = c.decodeFlexInt(forKey: .max_hr)
        self.avg_cadence = c.decodeFlexInt(forKey: .avg_cadence)
        self.completed = (try? c.decodeIfPresent(Bool.self, forKey: .completed)) ?? true
        self.status = try? c.decodeIfPresent(String.self, forKey: .status)
        self.verdict = try? c.decodeIfPresent(String.self, forKey: .verdict)
        self.time_in_tolerance_sec = c.decodeFlexInt(forKey: .time_in_tolerance_sec)
        self.time_out_of_tolerance_sec = c.decodeFlexInt(forKey: .time_out_of_tolerance_sec)
    }
}

/// 8b · the ceiling the runner lifted, as the watch recorded it.
///
/// Both figures, never a delta. "+9 over" is what a backend naturally
/// produces and it is unreadable at a glance, which is why the drawn row
/// spells the reading and the limit out separately.
struct RunCeilingLift: Decodable {
    let ceilingBpm: Int?
    let readingBpm: Int?
    let phaseLabel: String?
    let atMi: Double?
}

/// A rep the runner CHOSE to skip.
///
/// An explicit record, never inferred. A chosen skip and a dropped rep are
/// the same `completed: false`, and on a screen whose register says a
/// decision is not a lapse they must not read the same.
struct RunRepSkip: Decodable, Identifiable {
    var id: Int { repIndex }
    let repIndex: Int
    let repCount: Int?
    let repsCompleted: Int?
    let phaseLabel: String?
}

/// One +30s the runner added to a recovery. One entry per extension, so the
/// count is the array length and the boundaries live on the entries.
struct RunRecoveryExtension: Decodable {
    let afterRepIndex: Int?
    let beforeRepIndex: Int?
    let addedSec: Int?
}

struct RunSplit: Decodable, Identifiable, Equatable {
    var id: Int { mile }
    let mile: Int
    let pace: String?
    let hr: Int?
    let cadence: Int?
    let elev_change_ft: Int?
}

struct HRZonePcts: Decodable {
    let z1: Double
    let z2: Double
    let z3: Double
    let z4: Double
    let z5: Double
}

struct RunForm: Decodable {
    let cadence_spm: Double?
    let ground_contact_ms: Double?
    let stride_length_m: Double?
    let vertical_oscillation_cm: Double?
    let vertical_ratio_pct: Double?
    let run_power_w: Double?
    let respiratory_rate: Double?
    let spo2_pct: Double?
}

// MARK: - P32 shoes

struct ShoesResponse: Decodable {
    let shoes: [Shoe]?
}

/// 2026-08-19 · LAST-RESORT retirement mileage, in miles.
///
/// The retirement target is the SERVER's answer: `/api/shoe` returns
/// `retire_at_mi`, resolved by `web-v2/lib/shoe/lifespan.ts` from the shoe's
/// category against `Research/17-footwear.md` (super shoe 150-250 mi, daily
/// trainer 400-500, …), with the runner's own `mileage_cap` overriding it.
/// The phone deliberately carries NO copy of that table — a second table is a
/// second source of truth, and this app already had four different numbers
/// (450, 450, 450, 400) sitting where this one constant now is.
///
/// This value is used only when the server answered with neither
/// `retire_at_mi` nor `mileage_cap` — an older backend. It equals the low end
/// of the daily-trainer band, which is what `DEFAULT_SHOE_TYPE` resolves to
/// server-side, so the two agree.
let kShoeFallbackRetireMi: Double = 400

struct Shoe: Decodable, Identifiable {
    let id: Int
    let brand: String?
    let model: String?
    let color: String?
    let mileage: Double?
    let mileage_cap: Double?
    /// Shoe category · one of lib/shoe/lifespan.ts ShoeType. nil on an older
    /// backend; the server sends a resolved value (never null) once migrated.
    let shoe_type: String?
    /// THE retirement mileage this shoe is drawn against, resolved server-side
    /// from category + the runner's own cap. Prefer this over `mileage_cap`.
    let retire_at_mi: Double?
    let run_types: [String]?
    let baseline_mi: Double?
    let retired: Bool?
    let preferred: Bool?
    let notes: String?

    var displayName: String { [brand, model].compactMap { $0 }.joined(separator: " ") }

    /// THE retirement mileage to draw this shoe against. Server's resolved
    /// answer first, the runner's raw cap next, `kShoeFallbackRetireMi` last.
    /// A non-positive cap is treated as unset — a "0 mi" typo would otherwise
    /// make percent-used infinite and read 100% on the shoe's first run.
    var retireAtMi: Double {
        if let r = retire_at_mi, r > 0 { return r }
        if let c = mileage_cap, c > 0 { return c }
        return kShoeFallbackRetireMi
    }
}

// MARK: - Run-detail wire additions (audit 2026-05-29)

/// Shoe entry surfaced inline on the run detail (mirrors RunDetailShoe in
/// lib/coach/run-state.ts) so the picker needs no second round-trip.
/// brand/model optional defensively — DB rows can be sparse, matching Shoe.
struct RunDetailShoe: Decodable, Identifiable {
    let id: Int
    let brand: String?
    let model: String?
    let color: String?
    let color2: String?
    let run_types: [String]?
    let mileage: Double?
    let mileage_cap: Double?
    /// Shoe category · one of lib/shoe/lifespan.ts ShoeType.
    let shoe_type: String?
    /// THE retirement mileage this shoe is drawn against, resolved server-side.
    let retire_at_mi: Double?
    let retired: Bool?
    let preferred: Bool?
    let notes: String?

    var displayName: String { [brand, model].compactMap { $0 }.joined(separator: " ") }

    /// See `Shoe.retireAtMi`.
    var retireAtMi: Double {
        if let r = retire_at_mi, r > 0 { return r }
        if let c = mileage_cap, c > 0 { return c }
        return kShoeFallbackRetireMi
    }
}

/// LTHR-derived HR zone bands (mirrors hr_zones_from_lthr in run-state.ts).
/// Bounds are Double for decode safety — JS numbers don't distinguish
/// int/float and the bands may be unrounded fractions of LTHR.
struct HRZonesFromLTHR: Decodable {
    let lthr: Int?
    let ranges: [HRZoneRange]?
}

struct HRZoneRange: Decodable, Identifiable, Equatable {
    var id: String { label }
    let label: String
    let lower: Double?
    let upper: Double?
}

/// Collapsed mirror of the WorkoutSpec discriminated union in
/// lib/faff/types.ts. `kind` is the discriminator; every other field is
/// optional because only the active kind's fields are present. Numbers are
/// Double for decode safety. Not yet rendered — carried so /runs/[id] can
/// grow a WorkoutBreakdown without another wire change.
struct WorkoutSpec: Decodable {
    let kind: String
    // easy · long · recovery
    let pace_target_s_per_mi_lo: Double?
    let pace_target_s_per_mi_hi: Double?
    let hr_cap_bpm: Double?
    let fuel_mi: [Double]?
    // shared by threshold · intervals · tempo · progression · mp
    let warmup_mi: Double?
    let cooldown_mi: Double?
    // threshold · intervals
    let rep_count: Int?
    let rep_distance_m: Double?
    let rep_distance_mi: Double?
    let rep_pace_s_per_mi: Double?
    let rep_rest_s: Double?
    let lthr_bpm: Double?
    // tempo (hr_target_bpm shared with mp)
    let tempo_distance_mi: Double?
    let tempo_pace_s_per_mi: Double?
    let hr_target_bpm: Double?
    // fartlek
    let segments: [FartlekSegment]?
    // progression
    let prog_distance_mi: Double?
    let prog_start_s_per_mi: Double?
    let prog_end_s_per_mi: Double?
    // mp
    let mp_distance_mi: Double?
    let mp_pace_s_per_mi: Double?
}

struct FartlekSegment: Decodable {
    let pace_s_per_mi: Double?
    let duration_s: Double?
}

// MARK: - /api/records

// 2026-08-18 · doctrine sweep sibling fix (CLAUDE.md Race-data
// source-of-truth). ActivityView's "Personal records" grid used to derive
// FASTEST PACE client-side from ANY run in /api/log, zero gate on whether
// it was a race — a GPS-glitched stride or a hard interval rep could
// headline as a Personal Record forever, the exact shape f55798f2 fixed
// on web (seed.ts's recordsFromRuns). /api/records already existed for
// this (built 2026-07-06 · phone+watch audit P1-7, lib/race/
// personal-records.ts) but the phone never adopted it — these are its
// wire models. Curated race results (races.actual_result first, then
// races.meta.finishTime) render as authoritative; a bucket with no
// curated result falls back to the fastest whole training run near that
// distance, ALWAYS carrying provisional:true + provisionalLabel.
struct PersonalRecordsResponse: Decodable {
    let records: [PersonalRecordEntry]
    let training: PersonalRecordTraining?

    enum CodingKeys: String, CodingKey { case records, training }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.records = (try? c.decode([PersonalRecordEntry].self, forKey: .records)) ?? []
        self.training = try? c.decodeIfPresent(PersonalRecordTraining.self, forKey: .training)
    }
}

struct PersonalRecordEntry: Decodable, Identifiable {
    /// "5k" | "10k" | "half" | "marathon"
    let key: String
    /// "5K" / "10K" / "Half Marathon" / "Marathon"
    let label: String
    let timeDisplay: String
    let paceDisplay: String?
    let dateISO: String?
    let name: String?
    let distanceMi: Double?
    /// 'race_result' | 'race_meta' | 'training_run'
    let source: String
    /// Rule 3: true whenever this is NOT a curated race result.
    let provisional: Bool
    let provisionalLabel: String?

    var id: String { key }

    enum CodingKeys: String, CodingKey {
        case key, label, timeDisplay, paceDisplay, dateISO, name, distanceMi
        case source, provisional, provisionalLabel
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.key = (try? c.decode(String.self, forKey: .key)) ?? ""
        self.label = (try? c.decode(String.self, forKey: .label)) ?? ""
        self.timeDisplay = (try? c.decode(String.self, forKey: .timeDisplay)) ?? ""
        self.paceDisplay = try? c.decodeIfPresent(String.self, forKey: .paceDisplay)
        self.dateISO = try? c.decodeIfPresent(String.self, forKey: .dateISO)
        self.name = try? c.decodeIfPresent(String.self, forKey: .name)
        self.distanceMi = try? c.decodeIfPresent(Double.self, forKey: .distanceMi)
        self.source = (try? c.decode(String.self, forKey: .source)) ?? "training_run"
        self.provisional = (try? c.decodeIfPresent(Bool.self, forKey: .provisional)) ?? true
        self.provisionalLabel = try? c.decodeIfPresent(String.self, forKey: .provisionalLabel)
    }
}

struct PersonalRecordTraining: Decodable {
    let longestRun: PersonalRecordLongestRun?
    let biggestWeek: PersonalRecordBiggestWeek?

    enum CodingKeys: String, CodingKey { case longestRun, biggestWeek }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.longestRun = try? c.decodeIfPresent(PersonalRecordLongestRun.self, forKey: .longestRun)
        self.biggestWeek = try? c.decodeIfPresent(PersonalRecordBiggestWeek.self, forKey: .biggestWeek)
    }
}

struct PersonalRecordLongestRun: Decodable {
    let distanceMi: Double
    let dateISO: String?
    let name: String?

    enum CodingKeys: String, CodingKey { case distanceMi, dateISO, name }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.distanceMi = (try? c.decode(Double.self, forKey: .distanceMi)) ?? 0
        self.dateISO = try? c.decodeIfPresent(String.self, forKey: .dateISO)
        self.name = try? c.decodeIfPresent(String.self, forKey: .name)
    }
}

struct PersonalRecordBiggestWeek: Decodable {
    let miles: Double
    let weekStartISO: String

    enum CodingKeys: String, CodingKey { case miles, weekStartISO }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.miles = (try? c.decode(Double.self, forKey: .miles)) ?? 0
        self.weekStartISO = (try? c.decode(String.self, forKey: .weekStartISO)) ?? ""
    }
}
