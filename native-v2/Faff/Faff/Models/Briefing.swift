//
//  Briefing.swift
//  Wire types matching web-v2 /api/briefing response. Voice + topics.
//

import Foundation

// Lenient decode (doctrine 2026-05-31). Server always emits surface +
// mode, but per the doctrine "make them optional with defaults anyway"
// so a future schema shift doesn't kill the whole briefing. voice and
// topics array decodes default to []. workout_breakdown stays optional
// (intentional · server omits it on non-today surfaces).
struct Briefing: Codable {
    let surface: String
    let mode: String
    let lead: String?
    let voice: [String]
    let topics: [Topic]
    let workout_breakdown: [PosterBreakdownRow]?
    /// 2026-08-17 · the composed morning brief (today surface only ·
    /// web-v2/lib/coach/morning-brief.ts). Additive on the wire: absent
    /// on every other surface and on any server that predates it, so the
    /// decode is optional and the Today mount renders nothing when nil.
    let morning_brief: MorningBrief?

    enum CodingKeys: String, CodingKey {
        case surface, mode, lead, voice, topics, workout_breakdown, morning_brief
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.surface = try c.decodeIfPresent(String.self, forKey: .surface) ?? ""
        self.mode = try c.decodeIfPresent(String.self, forKey: .mode) ?? ""
        self.lead = try c.decodeIfPresent(String.self, forKey: .lead)
        self.voice = (try? c.decode([String].self, forKey: .voice)) ?? []
        self.topics = (try? c.decode([Topic].self, forKey: .topics)) ?? []
        self.workout_breakdown = (try? c.decode([PosterBreakdownRow].self, forKey: .workout_breakdown))
        self.morning_brief = try? c.decodeIfPresent(MorningBrief.self, forKey: .morning_brief)
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(surface, forKey: .surface)
        try c.encode(mode, forKey: .mode)
        try c.encodeIfPresent(lead, forKey: .lead)
        try c.encode(voice, forKey: .voice)
        try c.encode(topics, forKey: .topics)
        try c.encodeIfPresent(workout_breakdown, forKey: .workout_breakdown)
        try c.encodeIfPresent(morning_brief, forKey: .morning_brief)
    }
}

/// The composed morning brief · mirrors `MorningBrief` in
/// web-v2/lib/coach/morning-brief.ts. The server does the composition;
/// the phone renders `paragraph` verbatim and never re-assembles the
/// sentences (a client-side join would drift from the web's wording).
///
/// `sentences` rides along for future per-sentence treatment and is
/// decoded leniently so a shape change there can never cost us the
/// paragraph.
struct MorningBrief: Codable, Equatable {
    let paragraph: String
    let composedFor: String?

    enum CodingKeys: String, CodingKey { case paragraph, composedFor }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.paragraph = (try? c.decode(String.self, forKey: .paragraph)) ?? ""
        self.composedFor = try? c.decode(String.self, forKey: .composedFor)
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(paragraph, forKey: .paragraph)
        try c.encodeIfPresent(composedFor, forKey: .composedFor)
    }

    /// Nil-safe render gate · an empty or whitespace-only paragraph is
    /// treated exactly like an absent field (nothing renders, no layout
    /// shift). Server composition can legitimately produce "" if every
    /// sentence dropped out.
    var isRenderable: Bool {
        !paragraph.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

/// One prescription row · mirrors `PosterBreakdownRow` in
/// web-v2/lib/faff/types.ts: `{ label; body; tail: string | null }`.
/// Lenient decoder · doctrine 2026-05-31.
struct PosterBreakdownRow: Codable, Identifiable {
    var id: String { label }
    let label: String
    let body: String
    let tail: String?

    enum CodingKeys: String, CodingKey { case label, body, tail }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.label = try c.decodeIfPresent(String.self, forKey: .label) ?? ""
        self.body = try c.decodeIfPresent(String.self, forKey: .body) ?? ""
        self.tail = try c.decodeIfPresent(String.self, forKey: .tail)
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(label, forKey: .label)
        try c.encode(body, forKey: .body)
        try c.encodeIfPresent(tail, forKey: .tail)
    }
}

/// Topic kind discriminator. Mirrors web-v2/lib/topics/*.
/// `unknown` is the lenient fallback for any kind we haven't yet built
/// a renderer for · keeps the [Topic] decode from collapsing when the
/// server adds a 28th kind ahead of an iPhone release.
enum TopicKind: String, Codable {
    case run_recap, sleep_deficit, sleep_trend, hrv_trend, rhr_trend, weight_trend
    case next_workout, race_horizon, race_trajectory
    case cadence_insight, cadence_experiment
    case profile_gap, fun_fact, watch_list
    case shoe_status, shoe_race_fit, shoe_rotation
    case plan_arc, phase_context, next_quality, volume_delta
    case weather_chip, fueling_plan, kit_list, race_morning_schedule
    case unknown

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = TopicKind(rawValue: raw) ?? .unknown
    }
}

/// Polymorphic topic envelope. Concrete payload lives in `.payload` (decoded
/// per `kind` by the topic-rendering layer). The kind enum tolerates
/// unknown values so a server-side topic addition can't drop the whole
/// topics array.
struct Topic: Codable {
    let kind: TopicKind
    let payload: [String: AnyCodable]?
    let coach_note: String?

    enum CodingKeys: String, CodingKey { case kind, payload, coach_note }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.kind = (try? c.decode(TopicKind.self, forKey: .kind)) ?? .unknown
        self.payload = try? c.decode([String: AnyCodable].self, forKey: .payload)
        self.coach_note = try? c.decode(String.self, forKey: .coach_note)
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(kind, forKey: .kind)
        try c.encodeIfPresent(payload, forKey: .payload)
        try c.encodeIfPresent(coach_note, forKey: .coach_note)
    }
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
