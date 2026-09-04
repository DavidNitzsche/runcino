//
//  PlanSnapshotModels.swift
//  PLANSNAPSHOT-1 · the wire and on-disk shape of the runner's whole
//  authored block, decoded from `GET /api/v5/plan-snapshot`
//  (web-v2/lib/plan/plan-snapshot.ts — one field, one name, both sides).
//
//  This is the ONLY object Today and the week strip read to render a date.
//  Once a sync has landed, no per-date navigation may touch the network —
//  see `PlanSnapshotStore.swift` for the atomic storage contract and
//  `TodayHostV5.swift`'s `goTo` for the navigation contract this backs.
//

import Foundation

struct PlanSnapshotTreadmillGuidance: Codable, Equatable {
    let speedMph: Double?
    let inclinePct: Double
}

/// Mirrors `lib/training/prescriptions.ts`'s `PrescriptionStep` — the SAME
/// shape `/api/v5/today`'s card renders, so a step decoded here and a step
/// decoded on Today's own live path can never disagree in structure.
struct PlanSnapshotStep: Codable, Equatable {
    let label: String
    let distance_mi: Double?
    let reps: Int?
    let rep_distance_mi: Double?
    let duration: String?
    let pace_target: String?
    let hr_target: String?
    let note: String
    let recovery: Recovery?
    let rep_noun: String?
    let effort_target: String?

    struct Recovery: Codable, Equatable {
        let duration: String
        let pace_target: String?
        let note: String
    }
}

/// `SpecCard` minus `citation`/`selectionRationale` — see
/// `web-v2/lib/plan/plan-snapshot.ts`'s `PlanSnapshotCard` doc comment for
/// why those two fields are dropped server-side before this ever decodes.
struct PlanSnapshotCard: Codable, Equatable {
    let type: String
    let headline: String
    let why: String
    let steps: [PlanSnapshotStep]
    let total_mi: Double
    let workPaceSPerMi: Double?
    let workToleranceSPerMi: Double?
    let hasRacePaceFinish: Bool
    let totalDurationSec: Double?
    let basis: String
}

struct PlanSnapshotMatchedRun: Codable, Equatable {
    let runId: String
    let distanceMi: Double?
    let durationSec: Double?
    let paceSPerMi: Double?
    /// `"exact"` · `"legacy_type"` · `"supplemental"` — see
    /// `web-v2/lib/execution/day-resolver.ts`'s `ExecutionMatch`. This is
    /// the field that keeps a treadmill run "matched" and a friend's run
    /// "supplemental" without the client re-deciding anything.
    let match: String
    let indoor: Bool
}

struct PlanSnapshotSupplementalRun: Codable, Equatable, Identifiable {
    var id: String { runId }
    let runId: String
    let distanceMi: Double
    let durationSec: Double?
    let paceSPerMi: Double?
    let indoor: Bool
}

struct PlanSnapshotDay: Codable, Equatable, Identifiable {
    var id: String { date_iso }
    let plan_workout_id: String?
    let date_iso: String
    let dow: Int
    let type: String
    let is_rest: Bool
    let is_race: Bool
    let is_quality: Bool
    let is_long: Bool
    let distance_mi: Double
    let sub_label: String?
    let notes: String?
    let card: PlanSnapshotCard?
    let treadmill: PlanSnapshotTreadmillGuidance?
    let matched_run: PlanSnapshotMatchedRun?
    let supplemental_runs: [PlanSnapshotSupplementalRun]
}

/// The ONE locally persisted, versioned object. `days` is keyed by
/// `date_iso` at read time (`dayByISO`) rather than re-scanned on every
/// lookup — a ~120-day block is small, but a date-string dictionary lookup
/// is still the right shape for something read on every tap.
/// `Decodable` only, deliberately — the store never re-encodes a
/// `PlanSnapshot` back to JSON. It persists the RAW BYTES the server sent
/// (validated by decoding them, same as this type does), and reloads by
/// re-decoding those same bytes — so what's on disk is byte-identical to
/// what was actually validated, never a round-tripped reconstruction that
/// could silently drift from it.
struct PlanSnapshot: Decodable, Equatable {
    let plan_id: String?
    let plan_version: String?
    let plan_start_iso: String?
    let plan_end_iso: String?
    let today_iso: String
    let synced_at: String
    let days: [PlanSnapshotDay]
    let message: String?

    /// Bumped only by `PlanSnapshotStore` itself, never decoded from the
    /// wire — the SCHEMA version of the on-disk file, distinct from
    /// `plan_version` (the runner's plan content version). A future format
    /// change increments this so an old cached file on a fresh install of a
    /// newer build is recognized as incompatible rather than mis-decoded.
    static let currentSchemaVersion = 1

    /// Built ONCE, at decode/construction time, not per lookup —
    /// `PlanSnapshotStore` holds one decoded `PlanSnapshot` for the app's
    /// lifetime between syncs, and every date tap calls `day(on:)`, so this
    /// is exactly the field that must not be a re-scanning computed
    /// property. Excluded from `Codable`/`Equatable` since it is a pure
    /// function of `days`.
    let dayIndex: [String: PlanSnapshotDay]

    private enum CodingKeys: String, CodingKey {
        case plan_id, plan_version, plan_start_iso, plan_end_iso, today_iso, synced_at, days, message
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        plan_id = try c.decodeIfPresent(String.self, forKey: .plan_id)
        plan_version = try c.decodeIfPresent(String.self, forKey: .plan_version)
        plan_start_iso = try c.decodeIfPresent(String.self, forKey: .plan_start_iso)
        plan_end_iso = try c.decodeIfPresent(String.self, forKey: .plan_end_iso)
        today_iso = try c.decode(String.self, forKey: .today_iso)
        synced_at = try c.decode(String.self, forKey: .synced_at)
        days = try c.decode([PlanSnapshotDay].self, forKey: .days)
        message = try c.decodeIfPresent(String.self, forKey: .message)
        dayIndex = Dictionary(uniqueKeysWithValues: days.map { ($0.date_iso, $0) })
    }

    /// Memberwise, for tests and for constructing a snapshot in-process
    /// (e.g. after a plan mutation) without a round trip through JSON.
    init(plan_id: String?, plan_version: String?, plan_start_iso: String?, plan_end_iso: String?,
         today_iso: String, synced_at: String, days: [PlanSnapshotDay], message: String? = nil) {
        self.plan_id = plan_id
        self.plan_version = plan_version
        self.plan_start_iso = plan_start_iso
        self.plan_end_iso = plan_end_iso
        self.today_iso = today_iso
        self.synced_at = synced_at
        self.days = days
        self.message = message
        self.dayIndex = Dictionary(uniqueKeysWithValues: days.map { ($0.date_iso, $0) })
    }

    static func == (lhs: PlanSnapshot, rhs: PlanSnapshot) -> Bool {
        lhs.plan_id == rhs.plan_id && lhs.plan_version == rhs.plan_version
            && lhs.plan_start_iso == rhs.plan_start_iso && lhs.plan_end_iso == rhs.plan_end_iso
            && lhs.today_iso == rhs.today_iso && lhs.synced_at == rhs.synced_at
            && lhs.days == rhs.days && lhs.message == rhs.message
    }

    func day(on iso: String) -> PlanSnapshotDay? {
        dayIndex[iso]
    }

    /// True when `iso` falls inside `[plan_start_iso, plan_end_iso]` — the
    /// distinction `TodayHostV5` needs between "this date has no row
    /// because it's a synthesized rest day inside the block" (still
    /// instant, still local) and "this date is outside the authored block
    /// entirely" (a real boundary, same contract `canPageWeek` already
    /// enforces for the week strip).
    func containsDate(_ iso: String) -> Bool {
        guard let start = plan_start_iso, let end = plan_end_iso else { return false }
        return iso >= start && iso <= end
    }
}
