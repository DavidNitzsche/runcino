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
}

struct LogWeek: Decodable, Identifiable {
    var id: String { monday }
    let monday: String
    let label: String
    let totalMi: Double
    let totalDuration: String?
    let runs: [LogRun]
    let isCurrent: Bool
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
