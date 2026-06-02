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

    enum CodingKeys: String, CodingKey {
        case id, date, dow, start_local, name, source, type, distance_mi
        case pace, time_moving, avg_hr, max_hr, cadence, elev_gain_ft
        case workoutType, phaseLabel, shoeName, shoeSlug, indoor
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

    enum CodingKeys: String, CodingKey {
        case id, date, start_local, name, source, type
        case distance_mi, pace, pace_s_per_mi, time_moving, time_elapsed, avg_speed_mph
        case hr_avg, hr_max, cadence_avg, elev_gain_ft, temp_f
        case has_route, route_polyline, splits, hrZonePcts, form
        case pace_work, pace_work_s_per_mi, hr_avg_work, cadence_avg_work, work_seconds
        case phase_breakdown
        case suffer_score, kudos, shoe_id, shoes, hr_zones_from_lthr
        case planned_spec, planned_sub_label, planned_distance_mi
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        self.date = try c.decodeIfPresent(String.self, forKey: .date) ?? ""
        self.start_local = try c.decodeIfPresent(String.self, forKey: .start_local)
        self.name = try c.decodeIfPresent(String.self, forKey: .name)
        self.source = try c.decodeIfPresent(String.self, forKey: .source) ?? "unknown"
        self.type = try c.decodeIfPresent(String.self, forKey: .type)
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
    }
}

/// P44 — single phase of a structured workout, plan vs actual.
struct PhaseBreakdown: Decodable, Identifiable {
    var id: Int { index }
    let index: Int
    let label: String
    let type: String                       // "warmup" | "work" | "recovery" | "cooldown" | "unknown"
    let target_pace: String?
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
}

struct RunSplit: Decodable, Identifiable {
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

struct Shoe: Decodable, Identifiable {
    let id: Int
    let brand: String?
    let model: String?
    let color: String?
    let mileage: Double?
    let mileage_cap: Double?
    let retired: Bool?
    let preferred: Bool?
    let notes: String?

    var displayName: String { [brand, model].compactMap { $0 }.joined(separator: " ") }
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
    let retired: Bool?
    let preferred: Bool?
    let notes: String?

    var displayName: String { [brand, model].compactMap { $0 }.joined(separator: " ") }
}

/// LTHR-derived HR zone bands (mirrors hr_zones_from_lthr in run-state.ts).
/// Bounds are Double for decode safety — JS numbers don't distinguish
/// int/float and the bands may be unrounded fractions of LTHR.
struct HRZonesFromLTHR: Decodable {
    let lthr: Int?
    let ranges: [HRZoneRange]?
}

struct HRZoneRange: Decodable, Identifiable {
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
