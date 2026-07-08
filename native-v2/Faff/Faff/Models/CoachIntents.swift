//
//  CoachIntents.swift
//  Wire models for /api/coach/intents.
//
//  Mirrors web-v2/app/api/coach/intents/route.ts response shape:
//   { ok, rows: [{ ts, reason, severity, summary, field, value }] }
//
//  The upstream route omits an `id` field · we synthesise a stable id
//  client-side from ts + reason so SwiftUI ForEach can diff. Also accepts
//  the legacy `intents` key + `when_iso` field so an older deploy stays
//  decodable while a deploy window is in flight.
//
//  Lenient decode (doctrine 2026-05-31) · every field defaults so a
//  schema drift on the value blob can't drop the whole timeline.
//

import Foundation

enum CoachIntentSeverity: String, Decodable {
    case info, warn, override

    /// Server may add new severities; default unknown values to info so a
    /// future "celebration" tier doesn't drop the row.
    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = CoachIntentSeverity(rawValue: raw) ?? .info
    }
}

struct CoachIntent: Decodable, Identifiable {
    /// Stable id synthesised from `when_iso + reason`. The upstream
    /// response doesn't carry one (coach_intents.id is a bigserial that
    /// the route doesn't currently SELECT). This still works for ForEach
    /// because the (ts, reason) pair is effectively unique per row.
    let id: String
    let reason: String
    let severity: CoachIntentSeverity
    let summary: String
    let when_iso: String
    let field: String?
    let value: String?

    /// Detail text · optional secondary line below the summary on
    /// AdaptationCard ("Your resting HR sat 6 bpm above baseline..."). The
    /// server can pass it inside the value blob as `{ detail: "..." }`;
    /// we extract it lazily so the wire stays flat.
    var detail: String? {
        guard let v = value, !v.isEmpty else { return nil }
        if let data = v.data(using: .utf8),
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let d = obj["detail"] as? String, !d.isEmpty {
            return d
        }
        return nil
    }

    /// One-line adapter rationale · applyAdaptations writes `{why: "..."}`
    /// into the value blob for every plan_adapt_* intent (web-v2/lib/plan/
    /// adapt.ts writeIntent callers). Drives the applied-adapter coach
    /// line on Today. Same lazy extraction pattern as `detail`.
    var why: String? {
        guard let v = value, !v.isEmpty else { return nil }
        if let data = v.data(using: .utf8),
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let w = obj["why"] as? String, !w.isEmpty {
            return w
        }
        return nil
    }

    enum CodingKeys: String, CodingKey {
        case ts, reason, severity, summary, field, value
        // Legacy keys · accept if a deploy window still emits them.
        case when_iso
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.reason = try c.decodeIfPresent(String.self, forKey: .reason) ?? ""
        self.severity = (try? c.decode(CoachIntentSeverity.self, forKey: .severity)) ?? .info
        self.summary = try c.decodeIfPresent(String.self, forKey: .summary) ?? ""
        // Prefer `ts` (canonical) · fall back to `when_iso` (legacy).
        let tsCanonical = try c.decodeIfPresent(String.self, forKey: .ts)
        let tsLegacy = try c.decodeIfPresent(String.self, forKey: .when_iso)
        self.when_iso = tsCanonical ?? tsLegacy ?? ""
        self.field = try c.decodeIfPresent(String.self, forKey: .field)
        // value may arrive as String OR as a JSON object · normalise to
        // String so detail-extraction has something to parse uniformly.
        if let s = try? c.decode(String.self, forKey: .value) {
            self.value = s
        } else if let obj = try? c.decode([String: AnyCodable].self, forKey: .value),
                  let data = try? JSONSerialization.data(withJSONObject: obj.mapValues(\.value)),
                  let s = String(data: data, encoding: .utf8) {
            self.value = s
        } else {
            self.value = nil
        }
        self.id = "\(self.when_iso)|\(self.reason)"
    }

    /// Convenience constructor for previews + filtering · NOT a wire path.
    init(id: String, reason: String, severity: CoachIntentSeverity,
         summary: String, when_iso: String, field: String? = nil, value: String? = nil) {
        self.id = id; self.reason = reason; self.severity = severity
        self.summary = summary; self.when_iso = when_iso
        self.field = field; self.value = value
    }
}

struct CoachIntentsResponse: Decodable {
    let ok: Bool
    let intents: [CoachIntent]

    enum CodingKeys: String, CodingKey { case ok, rows, intents }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.ok = try c.decodeIfPresent(Bool.self, forKey: .ok) ?? false
        // Prefer `rows` (canonical) · fall back to `intents` (legacy).
        let rows = try c.decodeIfPresent([CoachIntent].self, forKey: .rows)
        let legacy = try c.decodeIfPresent([CoachIntent].self, forKey: .intents)
        self.intents = rows ?? legacy ?? []
    }
}
