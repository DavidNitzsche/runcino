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
    let hasFever: Bool
    let loggedAt: String   // ISO-8601 · used to compute daysActive

    enum CodingKeys: String, CodingKey {
        case id, symptoms
        case hasFever = "has_fever"
        case loggedAt = "logged_at"
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try c.decodeIfPresent(Int.self, forKey: .id) ?? 0
        self.symptoms = (try? c.decode([String].self, forKey: .symptoms)) ?? []
        self.hasFever = try c.decodeIfPresent(Bool.self, forKey: .hasFever) ?? false
        self.loggedAt = try c.decodeIfPresent(String.self, forKey: .loggedAt) ?? ""
    }

    /// Calendar days since the episode was logged.
    var daysActive: Int {
        let fmt = ISO8601DateFormatter()
        guard let d = fmt.date(from: loggedAt) else { return 0 }
        return max(0, Calendar.current.dateComponents([.day], from: d, to: Date()).day ?? 0)
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

// MARK: - Per-workout adapter proposals (propose-first flow)

/// One pending plan_workout_proposals row from GET /api/plan/workout-proposals.
/// Wire is camelCase (lib/plan/workout-proposals.ts PendingProposal); the
/// nested actionPayload is flattened into newType / newDate / shaveFraction /
/// why for ergonomic rendering. Lenient decode per doctrine 2026-05-31.
struct WorkoutProposal: Decodable, Identifiable {
    let id: Int
    let planWorkoutId: String
    let workoutDateISO: String
    let actionKind: String            // "downgrade" | "shave" | "reschedule"
    let newType: String?              // downgrade target ("easy", ...)
    let newDate: String?              // reschedule target (yyyy-MM-dd)
    let shaveFraction: Double?        // 0.15 = 15% off the volume
    let why: String?                  // one-line adapter rationale
    let reason: String                // trigger reason (banner subtitle fallback)
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, planWorkoutId, workoutDateISO, actionKind, actionPayload, reason, createdAt
    }
    enum PayloadKeys: String, CodingKey { case newType, newDate, shaveFraction, why }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.id = c.decodeFlexInt(forKey: .id) ?? 0
        self.planWorkoutId = try c.decodeIfPresent(String.self, forKey: .planWorkoutId) ?? ""
        self.workoutDateISO = try c.decodeIfPresent(String.self, forKey: .workoutDateISO) ?? ""
        self.actionKind = try c.decodeIfPresent(String.self, forKey: .actionKind) ?? ""
        self.reason = try c.decodeIfPresent(String.self, forKey: .reason) ?? ""
        self.createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt) ?? ""
        // actionPayload fields are written with explicit JSON nulls
        // (writeWorkoutProposals stringifies `?? null`) · try? decode
        // maps null / missing / type-drift to nil uniformly.
        if let pc = try? c.nestedContainer(keyedBy: PayloadKeys.self, forKey: .actionPayload) {
            self.newType = try? pc.decode(String.self, forKey: .newType)
            self.newDate = try? pc.decode(String.self, forKey: .newDate)
            self.shaveFraction = try? pc.decode(Double.self, forKey: .shaveFraction)
            self.why = try? pc.decode(String.self, forKey: .why)
        } else {
            self.newType = nil
            self.newDate = nil
            self.shaveFraction = nil
            self.why = nil
        }
    }
}

struct WorkoutProposalsResponse: Decodable {
    let ok: Bool
    let proposals: [WorkoutProposal]

    enum CodingKeys: String, CodingKey { case ok, proposals }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.ok = try c.decodeIfPresent(Bool.self, forKey: .ok) ?? false
        self.proposals = (try? c.decode([WorkoutProposal].self, forKey: .proposals)) ?? []
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

// MARK: - Targets projection ("Closing the gap" panel)
//
// Backend: GET /api/targets/projection?distance_mi=...&race_slug=...
//
// Wires the redesigned Targets surface. Mirrors the GoalRace shape on
// the web seed (web-v2/components/faff-app/types.ts:132) so iPhone and
// web read identical numbers from identical helpers:
//
//   · courseImpactSec  → computeCourseImpact (course_library + Daniels)
//   · conditionsImpactSec → computeRaceConditions (forecast → climate-normals)
//   · executionBufferSec → computePacingDiscipline (CV across typed runs)
//   · levers[]         → computeProjectionLevers (5-rule decision tree)
//
// Doctrine 2026-05-31 · designs/briefs/targets-gap-panel-backend-brief.md.

/// One hit-list lever from computeProjectionLevers.
/// Lives 1:1 with the web `Lever` interface (projection-levers.ts L37).
struct ProjectionLever: Decodable, Identifiable {
    let icon: String          // "flag" | "bolt" | "clock" | "shield" | "spark"
    let kind: String          // tune_up_race | threshold_block | vo2_block | ...
    let title: String         // "Drop a tune-up 10K"
    let detail: String        // "Carlsbad 10K · Jun 22 re-rates VDOT 49+"
    let projectedTime: String // "1:32:30"
    let deltaSec: Int         // negative = faster than current projection
    let controllability: String // "Trainable" | "Logistics" | "Smart"
    let linkTo: String?       // "/races/carlsbad-10k" when applicable
    let lvtag: String         // sub-label

    /// Stable identity for SwiftUI ForEach · the kind is unique enough
    /// per request since the decision tree returns at most 1 of each.
    var id: String { "\(kind)·\(lvtag)" }

    enum CodingKeys: String, CodingKey {
        case icon, kind, title, detail, projectedTime, deltaSec,
             controllability, linkTo, lvtag
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.icon = try c.decodeIfPresent(String.self, forKey: .icon) ?? "spark"
        self.kind = try c.decodeIfPresent(String.self, forKey: .kind) ?? ""
        self.title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        self.detail = try c.decodeIfPresent(String.self, forKey: .detail) ?? ""
        self.projectedTime = try c.decodeIfPresent(String.self, forKey: .projectedTime) ?? ""
        self.deltaSec = try c.decodeIfPresent(Int.self, forKey: .deltaSec) ?? 0
        self.controllability = try c.decodeIfPresent(String.self, forKey: .controllability) ?? "Trainable"
        self.linkTo = try c.decodeIfPresent(String.self, forKey: .linkTo)
        self.lvtag = try c.decodeIfPresent(String.self, forKey: .lvtag) ?? ""
    }
}

struct ProjectionLastMove: Decodable {
    let iso: String
    let prevVdot: Double
    let newVdot: Double
    let deltaVdot: Double
    let source: String

    enum CodingKeys: String, CodingKey { case iso, prevVdot, newVdot, deltaVdot, source }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.iso = try c.decodeIfPresent(String.self, forKey: .iso) ?? ""
        self.prevVdot = try c.decodeIfPresent(Double.self, forKey: .prevVdot) ?? 0
        self.newVdot = try c.decodeIfPresent(Double.self, forKey: .newVdot) ?? 0
        self.deltaVdot = try c.decodeIfPresent(Double.self, forKey: .deltaVdot) ?? 0
        self.source = try c.decodeIfPresent(String.self, forKey: .source) ?? ""
    }
}

struct RaceProjectionEntry: Decodable {
    let distance: String   // "5K" / "10K" / "Half" / "Marathon"
    let time: String       // "19:42" / "1:34:59"
}

struct ProjectionConfidenceInterval: Decodable {
    let lo: Int
    let hi: Int
    let pct: Double
    let method: String
    enum CodingKeys: String, CodingKey { case lo, hi, pct, method }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.lo     = try c.decodeIfPresent(Int.self,    forKey: .lo)     ?? 0
        self.hi     = try c.decodeIfPresent(Int.self,    forKey: .hi)     ?? 0
        self.pct    = try c.decodeIfPresent(Double.self, forKey: .pct)    ?? 0
        self.method = try c.decodeIfPresent(String.self, forKey: .method) ?? ""
    }
}

struct ConfidenceLabelEvidence: Decodable {
    let goalVdot: Double?
    enum CodingKeys: String, CodingKey { case goalVdot }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.goalVdot = try c.decodeIfPresent(Double.self, forKey: .goalVdot)
    }
}

struct ProjectionConfidenceLabel: Decodable {
    let tier: String        // "high" | "medium" | "low"
    let word: String        // "HIGH" | "MEDIUM" | "LOW"
    let descriptor: String  // "tracking to hit it" | "doable, not banked" | "behind on this runway"
    let detail: String
    let evidence: ConfidenceLabelEvidence?
    enum CodingKeys: String, CodingKey { case tier, word, descriptor, detail, evidence }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.tier       = try c.decodeIfPresent(String.self, forKey: .tier)       ?? ""
        self.word       = try c.decodeIfPresent(String.self, forKey: .word)       ?? ""
        self.descriptor = try c.decodeIfPresent(String.self, forKey: .descriptor) ?? ""
        self.detail     = try c.decodeIfPresent(String.self, forKey: .detail)     ?? ""
        self.evidence   = try? c.decode(ConfidenceLabelEvidence.self, forKey: .evidence)
    }
}

struct ProjectionSummary: Decodable {
    let ok: Bool
    let status: String     // "on_track" | "watch" | "off" | "race_week" | "cold"

    // Race + projection identity
    let vdot: Double?
    let projectionSec: Int?
    let goalSec: Int?
    let goalSafeSec: Int?           // B-goal (safe target) · meta.goalSafeDisplay
    let raceSlug: String?
    let raceName: String?
    let raceDate: String?
    let daysAway: Int?
    let distanceMi: Double?
    let location: String?

    // Pre-composed gap totals (server does the math · iPhone renders)
    let totalGapSec: Int
    let fitnessSec: Int

    // §2.2 Course chunk
    let courseImpactSec: Int?
    let courseSource: String?                 // "editorial" | "crowd" | "stub"
    let courseElevGainFtPerMi: Double?

    // §2.1 Conditions chunk
    let conditionsImpactSec: Int?
    let conditionsSource: String?             // "forecast" | "climate"

    // §2.3 Execution chunk · always populated, default 30s
    let executionBufferSec: Int
    let executionSource: String               // "observed" | "default"
    let executionCV: Double?
    let executionN: Int

    // §2.4 Hit list · 0-3 levers
    let levers: [ProjectionLever]

    // VDOT-move history (iPhone "held N days" + "last move" pills)
    let heldDays: Int
    let lastMove: ProjectionLastMove?

    // Backend-computed Daniels predictions for 5K / 10K / Half / Marathon.
    // Formatted strings ("1:34:59") — zero local race-time math on device.
    let raceProjections: [RaceProjectionEntry]?

    // §2.5 Confidence interval + label (2026-06-08)
    let confidenceInterval: ProjectionConfidenceInterval?
    let confidenceLabel: ProjectionConfidenceLabel?

    // 2026-06-12 · goal-seeking trajectory ("AHEAD" upgrade gear). Server
    // derives these from computeGoalProjection — the same engine web reads.
    // All optional · older API responses lack them → nil → dormant behavior.
    let aheadOfGoal: Bool?              // projected to beat the goal
    let planUnderBuilt: Bool?           // trajectory passed what the plan trains for
    let overPerformanceBonusVdot: Double?  // unconfirmed training-derived fitness (diagnostic)
    let trajectoryProjectedSec: Int?    // goal-seeking projected race-day time
    // 2026-06-18 · the "TODAY" accrued estimate · anchor VDOT + gain accrued
    // so far based on plan completion fraction. Moves week-by-week; converges
    // toward trajectoryProjectedSec by race day. nil → falls back to projectionSec.
    let trajectoryAccruedSec: Int?

    // 2026-06-16 · THE READOUT levers (execution / plan intensity / runway).
    let executionQuality: Double?       // 0…1 · how well recent quality work lands
    let planBuiltForGoal: Bool?         // plan's prescribed ceiling reaches the goal
    let plannedTargetVdot: Double?      // VDOT the plan's peak work trains toward
    let projectedGainVdot: Double?      // VDOT the build is projected to deliver
    let goalVdot: Double?               // VDOT the goal time demands
    let currentVdot: Double?            // responsive current fitness (echo of vdot)
    let buildWeeks: Double?             // build weeks left (weeksToRace − taper)
    let gapVdot: Double?                // goalVdot − projectedVdot (>0 = short)

    // 2026-07-13 · server-authored coach sentence + runway framing.
    // summaryLine: the one-sentence read the card renders verbatim (falls
    // back to a client OFFLINE sentence only when absent).
    // runwayLimited: true IFF the planned gain was clamped by time remaining
    // (build weeks) rather than by execution or the plan ceiling — so the
    // FITNESS read must read "On runway", never "Stalled".
    let summaryLine: String?
    let runwayLimited: Bool?

    enum CodingKeys: String, CodingKey {
        case ok, status, vdot, projectionSec, goalSec, goalSafeSec,
             raceSlug, raceName, raceDate, daysAway, distanceMi, location,
             totalGapSec, fitnessSec,
             courseImpactSec, courseSource, courseElevGainFtPerMi,
             conditionsImpactSec, conditionsSource,
             executionBufferSec, executionSource, executionCV, executionN,
             levers, heldDays, lastMove, raceProjections,
             confidenceInterval, confidenceLabel,
             aheadOfGoal, planUnderBuilt, overPerformanceBonusVdot, trajectoryProjectedSec,
             trajectoryAccruedSec,
             executionQuality, planBuiltForGoal, plannedTargetVdot, projectedGainVdot,
             goalVdot, currentVdot, buildWeeks, gapVdot,
             summaryLine, runwayLimited
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.ok = try c.decodeIfPresent(Bool.self, forKey: .ok) ?? true
        self.status = try c.decodeIfPresent(String.self, forKey: .status) ?? "cold"

        self.vdot = try c.decodeIfPresent(Double.self, forKey: .vdot)
        self.projectionSec = try c.decodeIfPresent(Int.self, forKey: .projectionSec)
        self.goalSec     = try c.decodeIfPresent(Int.self, forKey: .goalSec)
        self.goalSafeSec = try c.decodeIfPresent(Int.self, forKey: .goalSafeSec)
        self.raceSlug = try c.decodeIfPresent(String.self, forKey: .raceSlug)
        self.raceName = try c.decodeIfPresent(String.self, forKey: .raceName)
        self.raceDate = try c.decodeIfPresent(String.self, forKey: .raceDate)
        self.daysAway = try c.decodeIfPresent(Int.self, forKey: .daysAway)
        self.distanceMi = try c.decodeIfPresent(Double.self, forKey: .distanceMi)
        self.location = try c.decodeIfPresent(String.self, forKey: .location)

        self.totalGapSec = try c.decodeIfPresent(Int.self, forKey: .totalGapSec) ?? 0
        self.fitnessSec = try c.decodeIfPresent(Int.self, forKey: .fitnessSec) ?? 0

        self.courseImpactSec = try c.decodeIfPresent(Int.self, forKey: .courseImpactSec)
        self.courseSource = try c.decodeIfPresent(String.self, forKey: .courseSource)
        self.courseElevGainFtPerMi = try c.decodeIfPresent(Double.self, forKey: .courseElevGainFtPerMi)

        self.conditionsImpactSec = try c.decodeIfPresent(Int.self, forKey: .conditionsImpactSec)
        self.conditionsSource = try c.decodeIfPresent(String.self, forKey: .conditionsSource)

        self.executionBufferSec = try c.decodeIfPresent(Int.self, forKey: .executionBufferSec) ?? 30
        self.executionSource = try c.decodeIfPresent(String.self, forKey: .executionSource) ?? "default"
        self.executionCV = try c.decodeIfPresent(Double.self, forKey: .executionCV)
        self.executionN = try c.decodeIfPresent(Int.self, forKey: .executionN) ?? 0

        self.levers = (try? c.decode([ProjectionLever].self, forKey: .levers)) ?? []

        self.heldDays = try c.decodeIfPresent(Int.self, forKey: .heldDays) ?? 0
        self.lastMove = try c.decodeIfPresent(ProjectionLastMove.self, forKey: .lastMove)
        self.raceProjections    = try? c.decode([RaceProjectionEntry].self,            forKey: .raceProjections)
        self.confidenceInterval = try? c.decode(ProjectionConfidenceInterval.self,     forKey: .confidenceInterval)
        self.confidenceLabel    = try? c.decode(ProjectionConfidenceLabel.self,        forKey: .confidenceLabel)
        self.aheadOfGoal              = try c.decodeIfPresent(Bool.self,   forKey: .aheadOfGoal)
        self.planUnderBuilt           = try c.decodeIfPresent(Bool.self,   forKey: .planUnderBuilt)
        self.overPerformanceBonusVdot = try c.decodeIfPresent(Double.self, forKey: .overPerformanceBonusVdot)
        self.trajectoryProjectedSec   = try c.decodeIfPresent(Int.self,    forKey: .trajectoryProjectedSec)
        self.trajectoryAccruedSec     = try c.decodeIfPresent(Int.self,    forKey: .trajectoryAccruedSec)
        self.executionQuality  = try c.decodeIfPresent(Double.self, forKey: .executionQuality)
        self.planBuiltForGoal  = try c.decodeIfPresent(Bool.self,   forKey: .planBuiltForGoal)
        self.plannedTargetVdot = try c.decodeIfPresent(Double.self, forKey: .plannedTargetVdot)
        self.projectedGainVdot = try c.decodeIfPresent(Double.self, forKey: .projectedGainVdot)
        self.goalVdot          = try c.decodeIfPresent(Double.self, forKey: .goalVdot)
        self.currentVdot       = try c.decodeIfPresent(Double.self, forKey: .currentVdot)
        self.buildWeeks        = try c.decodeIfPresent(Double.self, forKey: .buildWeeks)
        self.gapVdot           = try c.decodeIfPresent(Double.self, forKey: .gapVdot)
        self.summaryLine       = try c.decodeIfPresent(String.self, forKey: .summaryLine)
        self.runwayLimited     = try c.decodeIfPresent(Bool.self,   forKey: .runwayLimited)
    }
}
