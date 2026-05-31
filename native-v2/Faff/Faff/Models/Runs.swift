//
//  Runs.swift
//  Wire models for /api/log + /api/runs/[id]. Mirrors the server shapes
//  in lib/coach/log-state.ts and lib/coach/run-state.ts so the iPhone
//  surfaces work off the same data as web /log and web /runs/[id].
//

import Foundation

// MARK: - /api/log

struct LogState: Decodable {
    let today: String
    let totalRuns: Int
    let totalMi: Double
    let weeks: [LogWeek]
    // Filter axes (mirrors lib/coach/log-state.ts, added 2026-05-28). New
    // fields are optional so a /log decode can't break in a deploy window
    // where the phone is briefly ahead of the server.
    let totalRunsUnfiltered: Int?
    let totalMiUnfiltered: Double?
    let axes: LogFilterAxes?
    let filters: LogFilters?
}

// Per-axis available values for the /log filter chip strip — render a chip
// only for values that actually appear in the unfiltered set.
struct LogFilterAxes: Decodable {
    let sources: [String]
    let types: [String]
    let phases: [String]
    let shoes: [LogShoeAxis]
}

struct LogShoeAxis: Decodable, Identifiable {
    var id: String { slug }
    let slug: String
    let name: String
    let runs: Int
}

// Active filters echoed back by the server (null = not filtering that axis).
struct LogFilters: Decodable {
    let source: String?
    let type: String?
    let phase: String?
    let shoe: String?
}

struct LogWeek: Decodable, Identifiable {
    var id: String { monday }
    let monday: String
    let label: String
    let totalMi: Double
    let totalDuration: String?
    let runs: [LogRun]
    /// Server doesn't emit this on /api/log (as of 2026-05-31). Was required
    /// here, so the entire LogState decode silently failed inside fetchLog's
    /// `try?` and the Activity tab rendered as 0 runs. Defaulted to false ·
    /// the UI doesn't render "current week" any differently from the others
    /// anyway, so the missing flag is cosmetic.
    let isCurrent: Bool?
}

struct LogRun: Decodable, Identifiable {
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
    // Filter-axis joins (mirrors lib/coach/log-state.ts LogRun).
    let workoutType: String?
    let phaseLabel: String?
    let shoeName: String?
    let shoeSlug: String?
}

// MARK: - /api/runs/[id]

struct RunDetail: Decodable, Identifiable {
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
    let form: RunForm

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
