//
//  ReadinessBriefSeed.swift
//  Wire model for /api/readiness/brief · the full envelope the iPhone
//  ReadinessBriefSheet consumes.
//
//  Mirrors `ReadinessBrief` from web-v2/lib/coach/readiness-brief.ts
//  field-for-field. Both surfaces (web + iPhone) consume the same
//  composer (loadReadinessBrief) · single source of truth.
//
//  Doctrine 2026-05-31: every server-shaped struct gets a lenient
//  init so a single null field can't drop the whole response.
//

import Foundation

// MARK: - Envelope wrapper

/// Top-level response shape from /api/readiness/brief.
/// `brief` is null when the runner has no recoverable CoachState
/// (brand-new user before any HK data lands).
struct ReadinessBriefResponse: Decodable {
    let ok: Bool
    let brief: ReadinessBriefSeed?

    enum CodingKeys: String, CodingKey { case ok, brief }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.ok = try c.decodeIfPresent(Bool.self, forKey: .ok) ?? false
        self.brief = try c.decodeIfPresent(ReadinessBriefSeed.self, forKey: .brief)
    }
}

// MARK: - Top-level envelope

struct ReadinessBriefSeed: Decodable {
    let date: String
    let score: Int
    let band: String              // sharp | ready | moderate | pull-back | no-data
    let label: String             // 'READY'
    let headline: String
    let oneLineMover: String?
    let scoreTrend: [ScoreTrendPoint]
    let pillars: [ReadinessPillar]
    let streaks: [ReadinessStreak]
    let movers: [ReadinessMover]
    let subjectiveOverride: SubjectiveOverride?
    let coldStart: ColdStart?
    let trendNote: String?
    let composition: Composition?
    let watchTomorrow: [String]
    // 2026-06-08 · WHAT TO DO · server already emits these (readiness-brief.ts
    // :226/:233 via buildHealthActions); the model just wasn't decoding them.
    let actions: [HealthAction]
    let actionsThreshold: String
    let prescription: BriefPrescription?

    enum CodingKeys: String, CodingKey {
        case date, score, band, label, headline, oneLineMover,
             scoreTrend, pillars, streaks, movers,
             subjectiveOverride, coldStart, trendNote, composition, watchTomorrow,
             actions, actionsThreshold, prescription
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.date = try c.decodeIfPresent(String.self, forKey: .date) ?? ""
        self.score = try c.decodeIfPresent(Int.self, forKey: .score) ?? 0
        self.band = try c.decodeIfPresent(String.self, forKey: .band) ?? "no-data"
        self.label = try c.decodeIfPresent(String.self, forKey: .label) ?? ""
        self.headline = try c.decodeIfPresent(String.self, forKey: .headline) ?? ""
        self.oneLineMover = try c.decodeIfPresent(String.self, forKey: .oneLineMover)
        self.scoreTrend = (try? c.decode([ScoreTrendPoint].self, forKey: .scoreTrend)) ?? []
        self.pillars = (try? c.decode([ReadinessPillar].self, forKey: .pillars)) ?? []
        self.streaks = (try? c.decode([ReadinessStreak].self, forKey: .streaks)) ?? []
        self.movers = (try? c.decode([ReadinessMover].self, forKey: .movers)) ?? []
        self.subjectiveOverride = try c.decodeIfPresent(SubjectiveOverride.self, forKey: .subjectiveOverride)
        self.coldStart = try c.decodeIfPresent(ColdStart.self, forKey: .coldStart)
        self.trendNote = try c.decodeIfPresent(String.self, forKey: .trendNote)
        self.composition = try c.decodeIfPresent(Composition.self, forKey: .composition)
        self.watchTomorrow = (try? c.decode([String].self, forKey: .watchTomorrow)) ?? []
        self.actions = (try? c.decode([HealthAction].self, forKey: .actions)) ?? []
        self.actionsThreshold = try c.decodeIfPresent(String.self, forKey: .actionsThreshold) ?? ""
        self.prescription = try c.decodeIfPresent(BriefPrescription.self, forKey: .prescription)
    }
}

// MARK: - Health action (WHAT TO DO)

/// One data-grounded action from buildHealthActions (health-actions.ts).
/// {signal, priority, action, cite} · priority drives the chip color.
struct HealthAction: Decodable, Identifiable {
    let signal: String
    let priority: String      // urgent | high | medium | low | on-course
    let action: String
    let cite: String
    var id: String { signal + "·" + String(action.prefix(24)) }
    enum CodingKeys: String, CodingKey { case signal, priority, action, cite }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.signal   = try c.decodeIfPresent(String.self, forKey: .signal) ?? ""
        self.priority = try c.decodeIfPresent(String.self, forKey: .priority) ?? "low"
        self.action   = try c.decodeIfPresent(String.self, forKey: .action) ?? ""
        self.cite     = try c.decodeIfPresent(String.self, forKey: .cite) ?? ""
    }
}

// MARK: - Prescription (today's run guidance)

struct BriefPrescription: Decodable {
    let action: String
    let why: String
    let intent: String
    let targetMinutes: Int?
    let targetMiles: Double?

    enum CodingKeys: String, CodingKey {
        case action, why, intent, targetMinutes, targetMiles
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.action        = try c.decodeIfPresent(String.self, forKey: .action) ?? ""
        self.why           = try c.decodeIfPresent(String.self, forKey: .why) ?? ""
        self.intent        = try c.decodeIfPresent(String.self, forKey: .intent) ?? "plan"
        self.targetMinutes = try c.decodeIfPresent(Int.self,    forKey: .targetMinutes)
        self.targetMiles   = try c.decodeIfPresent(Double.self, forKey: .targetMiles)
    }
}

// MARK: - Score trend point

struct ScoreTrendPoint: Decodable, Identifiable {
    let date: String
    let score: Int
    let band: String
    var id: String { date }

    enum CodingKeys: String, CodingKey { case date, score, band }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.date = try c.decodeIfPresent(String.self, forKey: .date) ?? ""
        self.score = try c.decodeIfPresent(Int.self, forKey: .score) ?? 0
        self.band = try c.decodeIfPresent(String.self, forKey: .band) ?? "no-data"
    }
}

// MARK: - Pillar

struct ReadinessPillar: Decodable, Identifiable {
    let key: String              // sleep | hrv | rhr | load | hr_recovery
    let label: String
    let weightPct: Int
    let observedValue: String
    let observedSub: String
    let baseline: String
    let band: String             // sharp | ready | moderate | pull-back | no-data | good | ok | watch | low
    let weightContribution: Int
    let meaning: String
    let confounders: [ReadinessConfounder]
    let trend: [PillarTrendPoint]
    let citation: String

    var id: String { key }

    enum CodingKeys: String, CodingKey {
        case key, label, weightPct, observedValue, observedSub, baseline,
             band, weightContribution, meaning, confounders, trend, citation
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.key = try c.decodeIfPresent(String.self, forKey: .key) ?? ""
        self.label = try c.decodeIfPresent(String.self, forKey: .label) ?? ""
        self.weightPct = try c.decodeIfPresent(Int.self, forKey: .weightPct) ?? 0
        self.observedValue = try c.decodeIfPresent(String.self, forKey: .observedValue) ?? ""
        self.observedSub = try c.decodeIfPresent(String.self, forKey: .observedSub) ?? ""
        self.baseline = try c.decodeIfPresent(String.self, forKey: .baseline) ?? ""
        self.band = try c.decodeIfPresent(String.self, forKey: .band) ?? "no-data"
        self.weightContribution = try c.decodeIfPresent(Int.self, forKey: .weightContribution) ?? 0
        self.meaning = try c.decodeIfPresent(String.self, forKey: .meaning) ?? ""
        self.confounders = (try? c.decode([ReadinessConfounder].self, forKey: .confounders)) ?? []
        self.trend = (try? c.decode([PillarTrendPoint].self, forKey: .trend)) ?? []
        self.citation = try c.decodeIfPresent(String.self, forKey: .citation) ?? ""
    }
}

struct ReadinessConfounder: Decodable, Identifiable {
    let pillar: String
    let explanation: String
    let likely: Bool

    var id: String { "\(pillar)·\(explanation.prefix(24))" }

    enum CodingKeys: String, CodingKey { case pillar, explanation, likely }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.pillar = try c.decodeIfPresent(String.self, forKey: .pillar) ?? ""
        self.explanation = try c.decodeIfPresent(String.self, forKey: .explanation) ?? ""
        self.likely = try c.decodeIfPresent(Bool.self, forKey: .likely) ?? false
    }
}

struct PillarTrendPoint: Decodable, Identifiable {
    let date: String
    let value: Double
    var id: String { date }

    enum CodingKeys: String, CodingKey { case date, value }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.date = try c.decodeIfPresent(String.self, forKey: .date) ?? ""
        self.value = try c.decodeIfPresent(Double.self, forKey: .value) ?? 0
    }
}

// MARK: - Streak

struct ReadinessStreak: Decodable, Identifiable {
    let pillar: String           // 'sleep' | 'hrv' | 'rhr' | 'load' | 'hr_recovery'
    let direction: String        // 'above' | 'below'
    let days: Int
    let startDate: String
    let short: String            // collapsed banner copy
    let meaning: String          // expanded doctrine

    var id: String { "\(pillar)·\(startDate)" }

    enum CodingKeys: String, CodingKey {
        case pillar, direction, days, startDate, short, meaning
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.pillar = try c.decodeIfPresent(String.self, forKey: .pillar) ?? ""
        self.direction = try c.decodeIfPresent(String.self, forKey: .direction) ?? "below"
        self.days = try c.decodeIfPresent(Int.self, forKey: .days) ?? 0
        self.startDate = try c.decodeIfPresent(String.self, forKey: .startDate) ?? ""
        let s = try c.decodeIfPresent(String.self, forKey: .short) ?? ""
        let m = try c.decodeIfPresent(String.self, forKey: .meaning) ?? ""
        // `short` is supposed to be a compact one-liner; older envelopes
        // may not carry it. Fall back to the first sentence of meaning.
        self.short = s.isEmpty ? String(m.prefix(120)) : s
        self.meaning = m
    }
}

// MARK: - Mover (unused for now · kept for future surfacing)

struct ReadinessMover: Decodable, Identifiable {
    let pillar: String
    let deltaPts: Int
    let label: String
    var id: String { pillar }

    enum CodingKeys: String, CodingKey { case pillar, deltaPts, label }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.pillar = try c.decodeIfPresent(String.self, forKey: .pillar) ?? ""
        self.deltaPts = try c.decodeIfPresent(Int.self, forKey: .deltaPts) ?? 0
        self.label = try c.decodeIfPresent(String.self, forKey: .label) ?? ""
    }
}

// MARK: - Subjective override

struct SubjectiveOverride: Decodable {
    let subjectiveScore: Int
    let objectiveScore: Int
    let deltaAbs: Int
    let advice: String

    enum CodingKeys: String, CodingKey {
        case subjectiveScore, objectiveScore, deltaAbs, advice
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.subjectiveScore = try c.decodeIfPresent(Int.self, forKey: .subjectiveScore) ?? 0
        self.objectiveScore = try c.decodeIfPresent(Int.self, forKey: .objectiveScore) ?? 0
        self.deltaAbs = try c.decodeIfPresent(Int.self, forKey: .deltaAbs) ?? 0
        self.advice = try c.decodeIfPresent(String.self, forKey: .advice) ?? ""
    }
}

// MARK: - Cold start

struct ColdStart: Decodable {
    let nightsLogged: Int
    let nightsNeeded: Int
    let note: String
    let healthConnected: Bool

    enum CodingKeys: String, CodingKey {
        case nightsLogged, nightsNeeded, note, healthConnected
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.nightsLogged = try c.decodeIfPresent(Int.self, forKey: .nightsLogged) ?? 0
        self.nightsNeeded = try c.decodeIfPresent(Int.self, forKey: .nightsNeeded) ?? 7
        self.note = try c.decodeIfPresent(String.self, forKey: .note) ?? ""
        self.healthConnected = try c.decodeIfPresent(Bool.self, forKey: .healthConnected) ?? false
    }
}

// MARK: - Composition

struct Composition: Decodable {
    let baseline: Int
    let net: Int
    let today: Int

    enum CodingKeys: String, CodingKey { case baseline, net, today }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.baseline = try c.decodeIfPresent(Int.self, forKey: .baseline) ?? 0
        self.net = try c.decodeIfPresent(Int.self, forKey: .net) ?? 0
        self.today = try c.decodeIfPresent(Int.self, forKey: .today) ?? 0
    }
}
