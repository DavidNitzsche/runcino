//
//  ToolkitPayloads.swift
//  Wire models for the Faff Component Toolkit endpoints (Niggle, Sick,
//  Strength, Cross-training, Goals, RPE, Streak, NotificationPrefs,
//  Checkin reply).
//
//  Doctrine 2026-05-31: every server-shaped struct gets a custom lenient
//  init so a single null field can't drop the whole response.
//

import Foundation

// MARK: - Niggle

struct NiggleRow: Decodable, Identifiable {
    let id: Int
    let body_part: String
    let side: String?
    let severity: Int
    let status: String?           // "just_started" | "few_days" | "weeks"
    let note: String?
    let logged_at: String

    enum CodingKeys: String, CodingKey {
        case id, body_part, side, severity, status, note, logged_at
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try c.decodeIfPresent(Int.self, forKey: .id) ?? 0
        self.body_part = try c.decodeIfPresent(String.self, forKey: .body_part) ?? ""
        self.side = try c.decodeIfPresent(String.self, forKey: .side)
        self.severity = try c.decodeIfPresent(Int.self, forKey: .severity) ?? 0
        self.status = try c.decodeIfPresent(String.self, forKey: .status)
        self.note = try c.decodeIfPresent(String.self, forKey: .note)
        self.logged_at = try c.decodeIfPresent(String.self, forKey: .logged_at) ?? ""
    }
}

struct NiggleEnvelope: Decodable {
    let active: NiggleRow?
}

// MARK: - Sick

struct SickRow: Decodable, Identifiable {
    let id: Int
    let symptoms: [String]
    let fever: Bool
    let started_at: String
    let cleared_at: String?

    enum CodingKeys: String, CodingKey {
        case id, symptoms, fever, started_at, cleared_at
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try c.decodeIfPresent(Int.self, forKey: .id) ?? 0
        self.symptoms = (try? c.decode([String].self, forKey: .symptoms)) ?? []
        self.fever = try c.decodeIfPresent(Bool.self, forKey: .fever) ?? false
        self.started_at = try c.decodeIfPresent(String.self, forKey: .started_at) ?? ""
        self.cleared_at = try c.decodeIfPresent(String.self, forKey: .cleared_at)
    }
}

struct SickEnvelope: Decodable {
    let active: SickRow?
}

// MARK: - Streak

struct StreakResponse: Decodable {
    let ok: Bool
    let current: Int
    let longestPrior: Int
    let nextMilestone: Int?
    let daysToMilestone: Int?
    let isMilestoneToday: Bool

    enum CodingKeys: String, CodingKey {
        case ok, current, longestPrior, nextMilestone, daysToMilestone, isMilestoneToday
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.ok = try c.decodeIfPresent(Bool.self, forKey: .ok) ?? false
        self.current = try c.decodeIfPresent(Int.self, forKey: .current) ?? 0
        self.longestPrior = try c.decodeIfPresent(Int.self, forKey: .longestPrior) ?? 0
        self.nextMilestone = try c.decodeIfPresent(Int.self, forKey: .nextMilestone)
        self.daysToMilestone = try c.decodeIfPresent(Int.self, forKey: .daysToMilestone)
        self.isMilestoneToday = try c.decodeIfPresent(Bool.self, forKey: .isMilestoneToday) ?? false
    }
}

// MARK: - RPE

struct RPEValue: Decodable {
    let rpe: Int
    let notes: String?
    let logged_at: String?

    enum CodingKeys: String, CodingKey { case rpe, notes, logged_at }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.rpe = try c.decodeIfPresent(Int.self, forKey: .rpe) ?? 0
        self.notes = try c.decodeIfPresent(String.self, forKey: .notes)
        self.logged_at = try c.decodeIfPresent(String.self, forKey: .logged_at)
    }
}

struct RPEResponse: Decodable {
    let ok: Bool
    let rpe: RPEValue?

    enum CodingKeys: String, CodingKey { case ok, rpe }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.ok = try c.decodeIfPresent(Bool.self, forKey: .ok) ?? false
        self.rpe = try? c.decode(RPEValue.self, forKey: .rpe)
    }
}

// MARK: - Checkin reply

struct CheckinResponse: Decodable {
    let ok: Bool
    let coach_reply: String

    enum CodingKeys: String, CodingKey { case ok, coach_reply }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.ok = try c.decodeIfPresent(Bool.self, forKey: .ok) ?? false
        self.coach_reply = try c.decodeIfPresent(String.self, forKey: .coach_reply) ?? ""
    }
}
