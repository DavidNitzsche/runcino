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

/// HEROPANEL-1 (2026-09-04) · `V5Number`/`V5Stat` (`DesignV5/APIV5.swift`)
/// are `Decodable`-only, by design — `V5Number`'s custom decoder carries the
/// "absent flag reads as MODELLED, never measured" rule that cannot be a
/// synthesized `Encodable`. Nothing ever encodes a `PlanSnapshotDay` back to
/// JSON (grepped: `FaffTests` builds fixtures through the memberwise init
/// below, never `JSONEncoder`), so this is `Decodable`, not `Codable` — the
/// same posture `PlanSnapshot` itself already takes, one level up, for the
/// identical reason (see that struct's own header comment).
struct PlanSnapshotDay: Decodable, Equatable, Identifiable {
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
    /// HEROPANEL-1 · the same four fields `V5Panel` (`DesignV5/APIV5.swift`)
    /// carries for the actual current day, computed server-side by the SAME
    /// resolver (`dayStateWordFor`) — so every browsed day renders the
    /// identical hero card `/api/v5/today` draws, never a second, flatter
    /// template. See `HeroDayPanelV5` (`DesignV5/PanelV5.swift`), the one
    /// view both this and `TodayBeforeV5`/`TodayAfterV5` now render through.
    let day_state: String
    let kicker: String?
    let dose: V5Number?
    let stats: [V5Stat]

    var state: V5.DayState { V5.DayState(rawValue: day_state) ?? .easy }
    var fill: PanelFill { PanelFill.state(state) }

    init(plan_workout_id: String?, date_iso: String, dow: Int, type: String, is_rest: Bool,
         is_race: Bool, is_quality: Bool, is_long: Bool, distance_mi: Double, sub_label: String?,
         notes: String?, card: PlanSnapshotCard?, treadmill: PlanSnapshotTreadmillGuidance?,
         matched_run: PlanSnapshotMatchedRun?, supplemental_runs: [PlanSnapshotSupplementalRun],
         day_state: String, kicker: String?, dose: V5Number?, stats: [V5Stat]) {
        self.plan_workout_id = plan_workout_id
        self.date_iso = date_iso
        self.dow = dow
        self.type = type
        self.is_rest = is_rest
        self.is_race = is_race
        self.is_quality = is_quality
        self.is_long = is_long
        self.distance_mi = distance_mi
        self.sub_label = sub_label
        self.notes = notes
        self.card = card
        self.treadmill = treadmill
        self.matched_run = matched_run
        self.supplemental_runs = supplemental_runs
        self.day_state = day_state
        self.kicker = kicker
        self.dose = dose
        self.stats = stats
    }

    private enum CodingKeys: String, CodingKey {
        case plan_workout_id, date_iso, dow, type, is_rest, is_race, is_quality, is_long,
             distance_mi, sub_label, notes, card, treadmill, matched_run, supplemental_runs,
             day_state, kicker, dose, stats
    }

    /// HEROPANEL-1 · the four new fields decode LENIENTLY — absent, not a
    /// decode failure — everything else keeps the original strict contract
    /// unchanged. Two real cases this protects, both already true today
    /// rather than hypothetical: a `PlanSnapshot` cached on disk from BEFORE
    /// this feature shipped (`PlanSnapshotStore.loadFromDiskSynchronously`
    /// re-decodes whatever bytes are already sitting there at cold launch,
    /// no server round trip to backfill them), and a version-skew window if
    /// the server and an old build are ever briefly live together. A day
    /// with no hero data just draws no hero content — `day_state` falls back
    /// to `"easy"` (harmless: an aerobic-tint panel, not a wrong claim about
    /// the workout), `stats` to `[]`, exactly `PanelStatPlate`'s own "nothing
    /// to say, nothing drawn" rule one level up.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        plan_workout_id = try c.decodeIfPresent(String.self, forKey: .plan_workout_id)
        date_iso = try c.decode(String.self, forKey: .date_iso)
        dow = try c.decode(Int.self, forKey: .dow)
        type = try c.decode(String.self, forKey: .type)
        is_rest = try c.decode(Bool.self, forKey: .is_rest)
        is_race = try c.decode(Bool.self, forKey: .is_race)
        is_quality = try c.decode(Bool.self, forKey: .is_quality)
        is_long = try c.decode(Bool.self, forKey: .is_long)
        distance_mi = try c.decode(Double.self, forKey: .distance_mi)
        sub_label = try c.decodeIfPresent(String.self, forKey: .sub_label)
        notes = try c.decodeIfPresent(String.self, forKey: .notes)
        card = try c.decodeIfPresent(PlanSnapshotCard.self, forKey: .card)
        treadmill = try c.decodeIfPresent(PlanSnapshotTreadmillGuidance.self, forKey: .treadmill)
        matched_run = try c.decodeIfPresent(PlanSnapshotMatchedRun.self, forKey: .matched_run)
        supplemental_runs = try c.decode([PlanSnapshotSupplementalRun].self, forKey: .supplemental_runs)
        day_state = try c.decodeIfPresent(String.self, forKey: .day_state) ?? "easy"
        kicker = try c.decodeIfPresent(String.self, forKey: .kicker)
        dose = try c.decodeIfPresent(V5Number.self, forKey: .dose)
        stats = try c.decodeIfPresent([V5Stat].self, forKey: .stats) ?? []
    }
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
