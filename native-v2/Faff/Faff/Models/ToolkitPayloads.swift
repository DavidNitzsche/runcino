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

// MARK: - Coach proposals (pending stack)

struct PendingProposal: Decodable, Identifiable {
    let id: Int
    let proposal_type: String      // "injury_adjust" | "illness_adjust" | "swap"
    let reason: String
    let suggested: String
    let created_at: String

    enum CodingKeys: String, CodingKey { case id, proposal_type, reason, suggested, created_at }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try c.decodeIfPresent(Int.self, forKey: .id) ?? 0
        self.proposal_type = try c.decodeIfPresent(String.self, forKey: .proposal_type) ?? ""
        self.reason = try c.decodeIfPresent(String.self, forKey: .reason) ?? ""
        self.suggested = try c.decodeIfPresent(String.self, forKey: .suggested) ?? ""
        self.created_at = try c.decodeIfPresent(String.self, forKey: .created_at) ?? ""
    }
}

struct ProposalsResponse: Decodable {
    let ok: Bool
    let proposals: [PendingProposal]

    enum CodingKeys: String, CodingKey { case ok, proposals }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.ok = try c.decodeIfPresent(Bool.self, forKey: .ok) ?? false
        self.proposals = (try? c.decode([PendingProposal].self, forKey: .proposals)) ?? []
    }
}

// MARK: - Notification inbox

struct NotifInboxItem: Decodable, Identifiable {
    let id: Int
    let category: String
    let title: String
    let body: String
    let fired_at: String
    let delivered: Bool?
    let ack_action: String?
    let ack_at: String?
    let dedup_key: String?

    enum CodingKeys: String, CodingKey {
        case id, category, title, body, fired_at, delivered, ack_action, ack_at, dedup_key
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try c.decodeIfPresent(Int.self, forKey: .id) ?? 0
        self.category = try c.decodeIfPresent(String.self, forKey: .category) ?? ""
        self.title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        self.body = try c.decodeIfPresent(String.self, forKey: .body) ?? ""
        self.fired_at = try c.decodeIfPresent(String.self, forKey: .fired_at) ?? ""
        self.delivered = try? c.decode(Bool.self, forKey: .delivered)
        self.ack_action = try? c.decode(String.self, forKey: .ack_action)
        self.ack_at = try? c.decode(String.self, forKey: .ack_at)
        self.dedup_key = try? c.decode(String.self, forKey: .dedup_key)
    }
}

struct NotifInboxResponse: Decodable {
    let ok: Bool
    let items: [NotifInboxItem]

    enum CodingKeys: String, CodingKey { case ok, items }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.ok = try c.decodeIfPresent(Bool.self, forKey: .ok) ?? false
        self.items = (try? c.decode([NotifInboxItem].self, forKey: .items)) ?? []
    }
}

// MARK: - Strava push history

struct StravaPushRow: Decodable, Identifiable {
    let id: Int
    let run_id: String?
    let status: String          // "queued" | "succeeded" | "failed"
    let strava_activity_id: String?
    let title: String?
    let privacy: String?
    let error_message: String?
    let pushed_at: String?
    let completed_at: String?

    enum CodingKeys: String, CodingKey {
        case id, run_id, status, strava_activity_id, title, privacy
        case error_message, pushed_at, completed_at
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try c.decodeIfPresent(Int.self, forKey: .id) ?? 0
        self.run_id = try? c.decode(String.self, forKey: .run_id)
        self.status = try c.decodeIfPresent(String.self, forKey: .status) ?? ""
        self.strava_activity_id = try? c.decode(String.self, forKey: .strava_activity_id)
        self.title = try? c.decode(String.self, forKey: .title)
        self.privacy = try? c.decode(String.self, forKey: .privacy)
        self.error_message = try? c.decode(String.self, forKey: .error_message)
        self.pushed_at = try? c.decode(String.self, forKey: .pushed_at)
        self.completed_at = try? c.decode(String.self, forKey: .completed_at)
    }
}

struct StravaPushesResponse: Decodable {
    let pushes: [StravaPushRow]

    enum CodingKeys: String, CodingKey { case pushes }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.pushes = (try? c.decode([StravaPushRow].self, forKey: .pushes)) ?? []
    }
}

// MARK: - LLM spend rollup

struct UsageDayRow: Decodable, Identifiable {
    let date: String
    let briefings: Int
    let tokens: Int
    let cost_usd: Double

    var id: String { date }
    enum CodingKeys: String, CodingKey { case date, briefings, tokens, cost_usd }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.date = try c.decodeIfPresent(String.self, forKey: .date) ?? ""
        self.briefings = try c.decodeIfPresent(Int.self, forKey: .briefings) ?? 0
        self.tokens = try c.decodeIfPresent(Int.self, forKey: .tokens) ?? 0
        self.cost_usd = try c.decodeIfPresent(Double.self, forKey: .cost_usd) ?? 0
    }
}

struct UsageResponse: Decodable {
    let days: [UsageDayRow]
    let totalCostUsd: Double

    enum CodingKeys: String, CodingKey { case days, totalCostUsd }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.days = (try? c.decode([UsageDayRow].self, forKey: .days)) ?? []
        self.totalCostUsd = try c.decodeIfPresent(Double.self, forKey: .totalCostUsd) ?? 0
    }
}
