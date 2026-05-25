//
//  Briefing.swift
//  Wire types matching web-v2 /api/briefing response. Voice + topics.
//

import Foundation

struct Briefing: Codable {
    let surface: String
    let mode: String
    let lead: String?
    let voice: [String]
    let topics: [Topic]
}

/// Topic kind discriminator. Mirrors web-v2/lib/topics/*.
enum TopicKind: String, Codable {
    case run_recap, sleep_deficit, sleep_trend, hrv_trend, rhr_trend, weight_trend
    case next_workout, race_horizon, race_trajectory
    case cadence_insight, cadence_experiment
    case profile_gap, fun_fact, watch_list
    case shoe_status, shoe_race_fit, shoe_rotation
    case plan_arc, phase_context, next_quality, volume_delta
    case weather_chip, fueling_plan, kit_list, race_morning_schedule
}

/// Polymorphic topic envelope. Concrete payload lives in `.payload` (decoded
/// per `kind` by the topic-rendering layer).
struct Topic: Codable {
    let kind: TopicKind
    let payload: [String: AnyCodable]?
    let coach_note: String?
}

/// Generic value wrapper for the polymorphic topic payload.
struct AnyCodable: Codable {
    let value: Any

    init(_ value: Any) { self.value = value }

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let v = try? c.decode(String.self)  { value = v; return }
        if let v = try? c.decode(Int.self)     { value = v; return }
        if let v = try? c.decode(Double.self)  { value = v; return }
        if let v = try? c.decode(Bool.self)    { value = v; return }
        if let v = try? c.decode([AnyCodable].self) { value = v.map(\.value); return }
        if let v = try? c.decode([String: AnyCodable].self) {
            value = v.mapValues(\.value); return
        }
        value = NSNull()
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch value {
        case let v as String: try c.encode(v)
        case let v as Int:    try c.encode(v)
        case let v as Double: try c.encode(v)
        case let v as Bool:   try c.encode(v)
        default:              try c.encodeNil()
        }
    }
}
