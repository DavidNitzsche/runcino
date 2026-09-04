//
//  Watch.swift  (native-v2 · iPhone side)
//
//  PHONE-SIDE COPY of the watch wire-format structs.
//
//  Lifted verbatim from legacy/native/Faff/FaffWatch Watch App/WatchWorkoutModels.swift
//  so the v2 iPhone app can encode WatchWorkout for transit to the watch
//  (which decodes using its OWN copy — DO NOT delete or modify the watch
//  copy at legacy/native/Faff/FaffWatch Watch App/WatchWorkoutModels.swift,
//  it is the wire-contract source of truth).
//
//  WIRE FORMAT POLICY (see docs/coach/WATCH_CONTRACT.md):
//   - Adding a new optional field here is safe (watch's decoder is tolerant).
//   - RENAMING or REMOVING a field breaks the watch app. Don't.
//   - INCOMING workout shape mirrors what web-v2 /api/watch/today returns.
//   - OUTGOING WatchCompletion mirrors what web-v2 /api/watch/workouts/complete expects.
//

import Foundation

// MARK: - Incoming · today's prescribed workout

enum WatchPhaseType: String, Codable, Equatable {
    case warmup, work, recovery, cooldown
}

enum WatchHaptic: String, Codable, Equatable {
    case start
    case transitionWork = "transition-work"
    case transitionRecovery = "transition-recovery"
    case transitionCooldown = "transition-cooldown"
    case end
}

/// How a rep is measured — a time interval ("7 min") or a fixed distance
/// ("800 m" / "1 mi"). Drives whether the engine advances/counts down by
/// elapsed time or by GPS distance, and how the remaining value reads.
/// HR-ROLE-1 · WHAT `WatchPhase.hrTargetBpm` means, mirroring `paceShape`.
/// A rep shorter than the doctrine kinetics floor (`Research/03` §13 — HR
/// has a ~30s response half-time and does not reach a real target within a
/// short rep) still carries a real bpm number, but it must never render as a
/// live target: doctrine says pace/effort governs and HR is read only.
/// `nil`/absent on an older payload defaults to `.observational` on the
/// phone side — the conservative reading, never the one that invites a
/// runner to chase a number the wire didn't label.
enum WatchHrRole: String, Codable, Equatable {
    case target
    case observational
}

enum WatchRepUnit: String, Codable, Equatable {
    case time, distance
}

/// PACESHAPE-1 (2026-09-03) · what a phase's `targetPaceSPerMi` MEANS, not
/// just what it IS. The server has carried this since SPECFIRST-1
/// (`lib/training/execution-semantics.ts#paceShapeFor`) — one owner, never
/// re-derived — but the phone discarded it on decode until now, which is
/// how a warm-up's easy-band ceiling ("no faster than 8:22/mi") rendered as
/// a naked, undifferentiated "8:22/mi" indistinguishable from a flat target
/// pace to hold. `.none` means the phase carries no pace to grade at all
/// (a recovery jog); a target with `.none` should not be read as a number
/// to hit.
enum WatchPaceShape: String, Codable, Equatable {
    /// Warm-up/cool-down, or an easy/long work phase — the number is the
    /// easy band's FAST edge, never a midpoint to hover on.
    case ceiling
    /// Quality/race work — a two-sided range around the target, using
    /// `tolerancePaceSPerMi`.
    case window
    /// By-effort — grade varies (outdoor hills) or no pace applies at all.
    case effort
    /// No prescribed pace (a recovery jog by feel).
    case none
}

struct WatchPhase: Codable, Identifiable, Equatable {
    /// Stable identity for SwiftUI lists · the cursor index assigned at
    /// decode time (the backend payload has no per-phase id).
    var id: Int { index }
    let index: Int
    let type: WatchPhaseType
    let label: String
    let durationSec: Int
    let targetPaceSPerMi: Int?
    let tolerancePaceSPerMi: Int?
    let haptic: WatchHaptic
    /// How this rep is measured. Defaults to `.time` so older payloads
    /// (and every non-rep phase) behave exactly as before.
    let repUnit: WatchRepUnit
    /// Fixed rep distance in miles · set only on distance reps. (durationSec
    /// is still carried as a time ESTIMATE for distance reps — used for the
    /// total-time estimate and as a fallback.)
    let distanceMi: Double?
    /// HR target for work phases on quality sessions (intervals/threshold/tempo).
    /// Sourced from workout_spec.lthr_bpm at plan-generation time.
    /// nil on warmup/recovery/cooldown and on easy/long sessions.
    let hrTargetBpm: Int?
    /// See `WatchHrRole`. Absent on an older payload — `effectiveHrRole`
    /// below is what every consumer should read, never this raw field.
    let hrRole: WatchHrRole?
    /// TREADMILL-HILL-1 (2026-09-03) · a belt speed + incline for a WORK
    /// phase that is prescribed by effort (no `targetPaceSPerMi`) and whose
    /// label names it a hill rep. See the server's `WatchPhase.
    /// treadmillInclinePct` doc comment (web-v2/lib/watch/build-workout.ts)
    /// for the full derivation. nil on every non-hill or already-paced
    /// phase, and on any payload from before this field existed.
    let treadmillInclinePct: Double?
    let treadmillSpeedMph: Double?
    /// See `WatchPaceShape`. Absent on an older payload — `effectivePaceShape`
    /// below is what every consumer should read, never this raw field.
    let paceShape: WatchPaceShape?

    /// The backend payload omits `index` (the phases array is ordered
    /// and the watch walks it with a cursor).  We assign it during
    /// decode via WatchWorkout's custom init so each phase carries its
    /// own position for labels + completion reporting.
    init(index: Int, type: WatchPhaseType, label: String, durationSec: Int,
         targetPaceSPerMi: Int?, tolerancePaceSPerMi: Int?, haptic: WatchHaptic,
         repUnit: WatchRepUnit = .time, distanceMi: Double? = nil, hrTargetBpm: Int? = nil,
         hrRole: WatchHrRole? = nil, treadmillInclinePct: Double? = nil,
         treadmillSpeedMph: Double? = nil, paceShape: WatchPaceShape? = nil) {
        self.index = index
        self.type = type
        self.label = label
        self.durationSec = durationSec
        self.targetPaceSPerMi = targetPaceSPerMi
        self.tolerancePaceSPerMi = tolerancePaceSPerMi
        self.haptic = haptic
        self.repUnit = repUnit
        self.distanceMi = distanceMi
        self.hrTargetBpm = hrTargetBpm
        self.hrRole = hrRole
        self.treadmillInclinePct = treadmillInclinePct
        self.treadmillSpeedMph = treadmillSpeedMph
        self.paceShape = paceShape
    }

    private enum CodingKeys: String, CodingKey {
        case type, label, durationSec, targetPaceSPerMi, tolerancePaceSPerMi, haptic, repUnit, distanceMi, hrTargetBpm, hrRole, treadmillInclinePct, treadmillSpeedMph, paceShape
    }

    /// Decoding without an index — used only when a phase is decoded in
    /// isolation.  WatchWorkout normally re-stamps indices on decode.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.index = 0
        self.type = try c.decode(WatchPhaseType.self, forKey: .type)
        self.label = try c.decode(String.self, forKey: .label)
        self.durationSec = try c.decode(Int.self, forKey: .durationSec)
        self.targetPaceSPerMi = try c.decodeIfPresent(Int.self, forKey: .targetPaceSPerMi)
        self.tolerancePaceSPerMi = try c.decodeIfPresent(Int.self, forKey: .tolerancePaceSPerMi)
        self.haptic = try c.decode(WatchHaptic.self, forKey: .haptic)
        self.repUnit = try c.decodeIfPresent(WatchRepUnit.self, forKey: .repUnit) ?? .time
        self.distanceMi = try c.decodeIfPresent(Double.self, forKey: .distanceMi)
        self.hrTargetBpm = try c.decodeIfPresent(Int.self, forKey: .hrTargetBpm)
        self.hrRole = try c.decodeIfPresent(WatchHrRole.self, forKey: .hrRole)
        self.treadmillInclinePct = try c.decodeIfPresent(Double.self, forKey: .treadmillInclinePct)
        self.treadmillSpeedMph = try c.decodeIfPresent(Double.self, forKey: .treadmillSpeedMph)
        self.paceShape = try c.decodeIfPresent(WatchPaceShape.self, forKey: .paceShape)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(type, forKey: .type)
        try c.encode(label, forKey: .label)
        try c.encode(durationSec, forKey: .durationSec)
        try c.encodeIfPresent(targetPaceSPerMi, forKey: .targetPaceSPerMi)
        try c.encodeIfPresent(tolerancePaceSPerMi, forKey: .tolerancePaceSPerMi)
        try c.encode(haptic, forKey: .haptic)
        try c.encode(repUnit, forKey: .repUnit)
        try c.encodeIfPresent(distanceMi, forKey: .distanceMi)
        try c.encodeIfPresent(hrTargetBpm, forKey: .hrTargetBpm)
        try c.encodeIfPresent(hrRole, forKey: .hrRole)
        try c.encodeIfPresent(treadmillInclinePct, forKey: .treadmillInclinePct)
        try c.encodeIfPresent(treadmillSpeedMph, forKey: .treadmillSpeedMph)
        try c.encodeIfPresent(paceShape, forKey: .paceShape)
    }

    /// PACESHAPE-1 · what every consumer should read, never the raw
    /// `paceShape` field — absent on an older payload defaults to `.window`
    /// (a flat target/range) exactly like today's undifferentiated
    /// rendering, so a client that has not been told otherwise behaves as it
    /// always has rather than silently reclassifying every pace as a
    /// ceiling or an ineffort.
    var effectivePaceShape: WatchPaceShape { paceShape ?? .window }

    /// The role to actually use. An absent wire value (older payload, or a
    /// server not yet carrying this field) defaults to `.observational` —
    /// the conservative reading. Never default to `.target`: that is
    /// exactly the bug this field exists to fix, and a missing field must
    /// not silently resurrect it.
    var effectiveHrRole: WatchHrRole { hrRole ?? .observational }
}

struct WatchWorkout: Codable, Equatable {

    /// An OPEN-ENDED session — one work phase with a ceiling nobody reaches,
    /// finished when the runner says so rather than when the plan runs out.
    /// `makeJustRun()` is the only thing that builds this shape: a single
    /// `.work` phase, no target pace, and a 24h duration ceiling placed there
    /// precisely so the phase never ends on its own.
    ///
    /// Why the engine needs to know: `abandon()` decides `completed` vs
    /// `abandoned` on whether the plan ran out first, which is the right
    /// question for a prescribed session and a meaningless one here. Every
    /// just-run therefore came back stamped `abandoned` — the runner ending
    /// the run IS how a just-run completes. Verified in prod: the one
    /// just-run on record (2026-08-21, 9.14 mi) is also the ONLY `abandoned`
    /// row in the entire runs table.
    ///
    /// Both conditions are accepted because either alone could drift: the id
    /// prefix is the contract the backend already stores and both builders
    /// (here and native-v2 Models/Watch.swift) emit, while the shape check
    /// still holds if that prefix is ever renamed. A planned easy/long/
    /// recovery run also expands to one `.work` phase (expand-spec.ts), so
    /// the 12h floor — not the phase count — is what keeps those out.
    var isOpenEnded: Bool {
        if workoutId.hasPrefix("just-run-") { return true }
        guard phases.count == 1, let only = phases.first else { return false }
        return only.type == .work
            && only.targetPaceSPerMi == nil
            && only.durationSec >= 12 * 60 * 60
    }
    let workoutId: String
    let name: String
    let summary: String
    let totalEstimatedMinutes: Int
    let phases: [WatchPhase]
    let completionEndpoint: String
    let expiresAt: String
    // Home-screen glance fields (watch-app.html §A). Optional so an older
    // payload still decodes; the phone bridge fills them from the plan +
    // readiness read.
    let readinessScore: Int?
    // The band word `/api/readiness` itself resolves: "SHARP" / "READY" /
    // "MODERATE" / "PULL BACK" / "UNKNOWN" (lib/coach/readiness.ts, carried
    // by lib/watch/build-workout.ts as `r.label ?? r.band`). It names where
    // the score sits and instructs nothing. This comment used to read
    // "Primed" / "Hold easy" / "Back off", which was both a wrong record of
    // the wire and the instruction grammar the 2026-09-02 ruling removed.
    let readinessLabel: String?
    let distanceMi: Double?
    let paceLabel: String?          // training-zone tag, e.g. "T", "I", "E"
    // Race day (watch-app.html §F). isRace flips the faces to the race
    // layout (proj finish / to-go / gel cues) fed by these fields.
    let isRace: Bool
    let goalSec: Int?               // goal finish time
    let strategyLabel: String?      // "Even effort · 8:46 flat"
    let gelsMi: [Double]?           // gel marker mile points (race-only, distance-anchored)
    // Training fueling — TIME-anchored gel plan that fires during any run
    // that warrants fuel (lib/training-fueling.ts on the backend). The watch
    // fires a haptic + screen prompt at each `fueling.atMins[i]` while the
    // session is active; the runner sees what to take and when without
    // opening the phone. nil → no fuel needed for this workout.
    let fueling: WatchFueling?
    // HR ceiling for easy / Z2 / heat-flag sessions. When live HR > this, the
    // easy face's guardrail row flips red and holds until you drop back into
    // zone — the alert can't be hidden behind a swipe. nil → no ceiling.
    let hrCeilingBpm: Int?
    // Optional backend signal for which IN-RUN face flavour to render.
    // Recognised values (router falls back to phase-based defaults when nil
    // or unknown):
    //   · "hr"           → HRFace (HR is the hero, pace below as reference)
    //   · "progression"  → ProgressionFace (current step target + miles to next)
    //   · "strides"      → StridesFace (burst countdown + strip)
    // The phase-driven default rules (single-work-phase + target → EasyFace
    // etc.) still apply when this is nil, so older payloads keep working.
    let displayHint: String?
    // 2026-06-02 round 41 · forward-compat. Dedicated single-sentence coach
    // cue rendered in the pre-run sheet SESSION CUE row. Backend brief in
    // flight (see `cue field on workout payload` brief David sent
    // 2026-06-02). When the field arrives, TodayPreRunBodyV3.cueText reads
    // it directly; until then, the pre-run body falls back to its existing
    // type-specific defaults so the UI is unaffected.
    let cue: String?
    // 2026-09-01 · race-day HR guidance from the race-pace brain
    // (lib/race/race-hr-guidance.ts via build-workout.ts `raceHr`). Additive:
    // absent on non-race days and on older servers. `informationalOnly` means
    // the band has no personal evidence behind it and may inform, never alarm.
    let raceHr: WatchRaceHr?

    private enum CodingKeys: String, CodingKey {
        case workoutId, name, summary, totalEstimatedMinutes, phases, completionEndpoint, expiresAt
        case readinessScore, readinessLabel, distanceMi, paceLabel
        case isRace, goalSec, strategyLabel, gelsMi, fueling, hrCeilingBpm
        case displayHint, cue, raceHr
    }

    init(workoutId: String, name: String, summary: String, totalEstimatedMinutes: Int,
         phases: [WatchPhase], completionEndpoint: String, expiresAt: String,
         readinessScore: Int? = nil, readinessLabel: String? = nil,
         distanceMi: Double? = nil, paceLabel: String? = nil,
         isRace: Bool = false, goalSec: Int? = nil, strategyLabel: String? = nil, gelsMi: [Double]? = nil,
         fueling: WatchFueling? = nil, hrCeilingBpm: Int? = nil, raceHr: WatchRaceHr? = nil,
         displayHint: String? = nil, cue: String? = nil) {
        self.workoutId = workoutId
        self.name = name
        self.summary = summary
        self.totalEstimatedMinutes = totalEstimatedMinutes
        self.phases = phases
        self.completionEndpoint = completionEndpoint
        self.expiresAt = expiresAt
        self.readinessScore = readinessScore
        self.readinessLabel = readinessLabel
        self.distanceMi = distanceMi
        self.paceLabel = paceLabel
        self.isRace = isRace
        self.goalSec = goalSec
        self.strategyLabel = strategyLabel
        self.gelsMi = gelsMi
        self.fueling = fueling
        self.hrCeilingBpm = hrCeilingBpm
        self.raceHr = raceHr
        self.displayHint = displayHint
        self.cue = cue
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.workoutId = try c.decode(String.self, forKey: .workoutId)
        self.name = try c.decode(String.self, forKey: .name)
        self.summary = try c.decode(String.self, forKey: .summary)
        self.totalEstimatedMinutes = try c.decode(Int.self, forKey: .totalEstimatedMinutes)
        self.completionEndpoint = try c.decode(String.self, forKey: .completionEndpoint)
        self.expiresAt = try c.decode(String.self, forKey: .expiresAt)
        self.readinessScore = try c.decodeIfPresent(Int.self, forKey: .readinessScore)
        self.readinessLabel = try c.decodeIfPresent(String.self, forKey: .readinessLabel)
        self.distanceMi = try c.decodeIfPresent(Double.self, forKey: .distanceMi)
        self.paceLabel = try c.decodeIfPresent(String.self, forKey: .paceLabel)
        self.isRace = try c.decodeIfPresent(Bool.self, forKey: .isRace) ?? false
        self.goalSec = try c.decodeIfPresent(Int.self, forKey: .goalSec)
        self.strategyLabel = try c.decodeIfPresent(String.self, forKey: .strategyLabel)
        self.gelsMi = try c.decodeIfPresent([Double].self, forKey: .gelsMi)
        self.fueling = try c.decodeIfPresent(WatchFueling.self, forKey: .fueling)
        self.hrCeilingBpm = try c.decodeIfPresent(Int.self, forKey: .hrCeilingBpm)
        self.displayHint = try c.decodeIfPresent(String.self, forKey: .displayHint)
        self.cue = try c.decodeIfPresent(String.self, forKey: .cue)
        self.raceHr = try c.decodeIfPresent(WatchRaceHr.self, forKey: .raceHr)
        // Re-stamp each phase with its cursor index. Mirror watch agent's
        // 2026-05-25 fix (e304b82 watch(decode): pass repUnit + distanceMi
        // through phase re-stamp) — without those fields the iPhone-side
        // WorkoutTodayCard renderer loses rep distance + can't distinguish
        // distance vs time reps.
        //
        // TREADMILL-RESTAMP-1 (2026-09-03) · this re-stamp named every field
        // of `WatchPhase.init` EXCEPT `hrRole`, `treadmillInclinePct` and
        // `treadmillSpeedMph` — all three have `nil` defaults on that
        // initializer, so every one of them was silently discarded here on
        // EVERY real decode, regardless of what the server sent. The
        // treadmill console's `nominalMph`/`nominalInclinePct` (added the
        // same day, TREADMILL-STRUCTURE-1) read exactly these three fields —
        // so the doctrine-computed hill/warm-up/recovery/cooldown speed and
        // incline could never have reached the belt through this decode
        // path. Found reading this file end to end while investigating why
        // today's real hill session opened at flat defaults despite the
        // server-side fix; the two bugs compounded (server computes the
        // right number, decode throws it away before the console ever sees
        // it). Same shape as `effectiveHrRole`'s own doc comment warns
        // against — an absent field must read as the safe default
        // downstream, not silently vanish upstream of every consumer.
        let raw = try c.decode([WatchPhase].self, forKey: .phases)
        // PACESHAPE-1 (2026-09-03 correction) · this re-stamp had the EXACT
        // same defect three separate times over: `repUnit`/`distanceMi` were
        // the 2026-05-25 fix this comment already cites; `hrRole` (HR-ROLE-1)
        // and `treadmillInclinePct`/`treadmillSpeedMph` (TREADMILL-HILL-1)
        // were BOTH added to `WatchPhase` since, and BOTH silently dropped
        // right here, because this list was never updated to carry them —
        // every field added to the struct after this map was written had to
        // be added here too, by hand, and nothing enforced it.
        //
        // Found because `hrRole`'s drop was INVISIBLE: `effectiveHrRole`
        // defaults dropped-to-nil to `.observational`, which happens to be
        // the correct answer for the by-effort hill reps this session kept
        // testing against — so HR-ROLE-1 "worked" in every render this
        // session did, by coincidence, while silently misclassifying any
        // REAL `.target` HR phase (a tempo session's genuine HR target) as
        // observational instead. `treadmillInclinePct`/`treadmillSpeedMph`
        // had no such lucky default — TREADMILL-HILL-2's own fix, wired and
        // unit-tested against hand-built `WatchPhase` values (which never
        // pass through this decoder at all), never once fired against real
        // decoded data because of this exact line.
        //
        // Every field the memberwise init accepts is threaded through now.
        // The next field added to `WatchPhase` will still need a line here —
        // Swift has no "spread the rest" for a memberwise init — but at
        // least this sweep closes every gap that existed today.
        self.phases = raw.enumerated().map { (i, p) in
            WatchPhase(index: i, type: p.type, label: p.label, durationSec: p.durationSec,
                       targetPaceSPerMi: p.targetPaceSPerMi,
                       tolerancePaceSPerMi: p.tolerancePaceSPerMi, haptic: p.haptic,
                       repUnit: p.repUnit, distanceMi: p.distanceMi, hrTargetBpm: p.hrTargetBpm,
                       hrRole: p.hrRole, treadmillInclinePct: p.treadmillInclinePct,
                       treadmillSpeedMph: p.treadmillSpeedMph, paceShape: p.paceShape)
        }
    }
}

// MARK: - Outgoing · completion writeback (phase 6)
//
// CANONICAL SOURCE: legacy/native/Faff/FaffWatch Watch App/WatchWorkoutModels.swift
// These iPhone-side structs MUST match the watch structs exactly. The relay
// path (WatchSync) passes raw bytes through without decoding, so drift is
// silently invisible in the relay — but it corrupts any iPhone-generated
// completion (treadmill v2, manual entry) and any future decode.
//
// Tier-1 telemetry structs (PaceSample / HRSample) mirror WatchWorkoutModels.swift.

struct WatchPaceSample: Encodable {
    /// Seconds since the phase began.
    let tSec: Int
    /// Instantaneous pace in seconds per mile. `nil` when GPS hadn't locked.
    let paceSPerMi: Int?
    /// Cumulative distance covered IN THIS PHASE at the sample instant (miles).
    let distMi: Double
}

struct WatchHRSample: Encodable {
    /// Seconds since the phase began.
    let tSec: Int
    /// Heart rate in bpm. `nil` when HR couldn't be read.
    let bpm: Int?
}

struct WatchCompletionPhase: Encodable {
    let index: Int
    let type: String
    let label: String
    let targetPaceSPerMi: Int?
    let actualPaceSPerMi: Int?
    let actualDurationSec: Int
    /// GPS-tracked distance covered DURING this phase (miles).
    let actualDistanceMi: Double?
    let avgHr: Int?
    /// Peak HR observed during this phase.
    let maxHr: Int?
    /// Average cadence (steps/min) across the phase.
    let avgCadence: Int?
    let completed: Bool
    // ─── Tier 1 (2026-06-02) ────────────────────────────────────────
    var paceSamples: [WatchPaceSample]? = nil
    var hrSamples: [WatchHRSample]? = nil
    var timeInToleranceSec: Int? = nil
    var timeOutOfToleranceSec: Int? = nil
    /// "hit" | "drifted" | "missed" | "incomplete" | nil
    var verdict: String? = nil
    // ─── Tier 2 (2026-06-02, UI rescinded — always nil on wire) ─────
    var repRpe: Int? = nil
    var repRpeTag: String? = nil
}

struct WatchCompletion: Encodable {
    let workoutId: String
    let startedAt: String
    let completedAt: String
    let status: String          // "completed" | "partial" | "abandoned"
    let totalDistanceMi: Double?
    let totalDurationSec: Int
    let avgHr: Int?
    let maxHr: Int?
    var avgCadence: Int? = nil
    /// Active calories from HKLiveWorkoutBuilder. `nil` → backend estimator fallback.
    var kcal: Int? = nil
    let phases: [WatchCompletionPhase]
}

// MARK: - Training fueling (time-anchored gel plan)

/// Training fueling — gel plan the watch fires during the run. Parity with
/// the web `FuelingPlan` (lib/training-fueling.ts).
///
///   - `atMins[i]` is when to fire the i-th gel prompt, in minutes from
///     run start. The engine matches elapsed minutes against this list and
///     emits a notification haptic + a "Fuel now" screen note when it
///     crosses each mark.
///   - `shortLine` is the one-liner the runner sees on the prompt
///     ("Maurten 100 now — 1 of 3"). `gels` lets us suffix "X of Y".
struct WatchFueling: Codable, Equatable {
    let needed: Bool
    let gels: Int
    let atMins: [Int]
    let gPerHr: Int
    let totalCarbsG: Int
    let isRehearsal: Bool
    let heatAdjusted: Bool
    let shortLine: String
    let why: String
}

// MARK: - Readiness glance (watch-app.html §G · GET /api/watch/readiness)

/// The watch's slice of the phone's readiness read. Available any day
/// (rest/race/workout), unlike the workout payload. `score == nil` means the
/// read is suppressed (injured / no data).
///
/// The phone's mirror of the watch's own struct. `WatchSync.readinessPayload`
/// is what actually fills it; read its header for why nothing in here may
/// instruct.
struct WatchReadiness: Codable {
    let score: Int?                 // 0–100, or nil when suppressed
    let state: String               // "green" | "yellow" | "red" · a tint, not a verdict
    // The band word from /api/readiness: "SHARP" / "READY" / "MODERATE" /
    // "PULL BACK" / "UNKNOWN". Not the old "Primed / Hold easy / Back off"
    // grammar, which this comment wrongly recorded and which instructed.
    let label: String
    // A WIRE KEY, not a recommendation. Filled from `formLine`, the TSB
    // caption ("Form +8 · fresh"), which is a reading.
    let recommendation: String      // may be ""
    let hrvMs: Int?                 // 7-day avg HRV
    let rhrBpm: Int?                // resting HR
    let suppressReason: String?     // present only when score is nil
    let nextRace: NextRace?

    struct NextRace: Codable {
        let name: String
        let slug: String
        let daysAway: Int
    }
}

// MARK: - Sample · drives the simulator UI flow before WCSession exists

extension WatchWorkout {
    /// Unstructured "just run" workout. Available from the home screen as the
    /// JUST RUN page — always one swipe away, regardless of today's plan.
    /// Single open-ended `.work` phase with no target pace + no rep structure
    /// → the router lands on SteadyRunFace (live pace · distance · elapsed).
    /// A 24h duration ceiling means the phase never naturally ends; the
    /// runner ends from controls when they're done.
    static func makeJustRun() -> WatchWorkout {
        let phase = WatchPhase(index: 0, type: .work, label: "Just run",
                               durationSec: 24 * 60 * 60,
                               targetPaceSPerMi: nil,
                               tolerancePaceSPerMi: nil,
                               haptic: .start)
        return WatchWorkout(
            workoutId: "just-run-\(UUID().uuidString)",
            name: "Just run",
            summary: "Unstructured run",
            totalEstimatedMinutes: 30,
            phases: [phase],
            completionEndpoint: "/api/watch/workouts/complete",
            expiresAt: "2099-12-31T00:00:00Z"
        )
    }

    /// A hardcoded threshold session so the shell can be exercised in
    /// the simulator without a paired iPhone (WatchConnectivity lands
    /// in a later phase).  Mirrors the "Threshold · Cruise Intervals"
    /// catalog entry in web/lib/watch-workout.ts.
    static var sample: WatchWorkout {
        var phases: [WatchPhase] = []
        var idx = 0
        func add(_ type: WatchPhaseType, _ label: String, _ sec: Int,
                 target: Int?, tol: Int?, haptic: WatchHaptic) {
            phases.append(WatchPhase(index: idx, type: type, label: label, durationSec: sec,
                                     targetPaceSPerMi: target, tolerancePaceSPerMi: tol, haptic: haptic))
            idx += 1
        }
        add(.warmup, "Warmup", 600, target: nil, tol: nil, haptic: .start)
        for rep in 1...5 {
            add(.work, "Interval \(rep)/5", 420, target: 391, tol: 10, haptic: .transitionWork)
            if rep < 5 {
                add(.recovery, "Recovery \(rep)/5", 90, target: nil, tol: nil, haptic: .transitionRecovery)
            }
        }
        add(.cooldown, "Cooldown", 600, target: nil, tol: nil, haptic: .transitionCooldown)
        let total = phases.reduce(0) { $0 + $1.durationSec }
        return WatchWorkout(
            workoutId: "sample-threshold",
            name: "5×7",
            summary: "5×7 min @ 6:31 · 90s rec",
            totalEstimatedMinutes: total / 60,
            phases: phases,
            completionEndpoint: "/api/watch/workouts/complete",
            expiresAt: "2026-05-21T08:00:00Z",
            readinessScore: 82,
            readinessLabel: "Primed",
            distanceMi: 6.4,
            paceLabel: "T"
        )
    }

    /// A point-to-point race fed to the same engine (watch-app.html §F):
    /// a flat list of terrain-aware course phases, each with its own even-
    /// effort target pace, plus gel markers. Drives the race faces in the
    /// simulator (launch with -race) before phone race sync exists.
    static var sampleRace: WatchWorkout {
        var phases: [WatchPhase] = []
        var idx = 0
        func add(_ label: String, _ sec: Int, target: Int, tol: Int = 12) {
            phases.append(WatchPhase(index: idx, type: .work, label: label, durationSec: sec,
                                     targetPaceSPerMi: target, tolerancePaceSPerMi: tol,
                                     haptic: .transitionWork))
            idx += 1
        }
        // Big Sur-shaped: rolling start, the Hurricane Point climb (slow
        // target), the descent (fast), then the long run-in. Targets are
        // even EFFORT, so pace shifts with terrain.
        add("Opening rollers", 1500, target: 526)   // 8:46
        add("Bixby descent",   900,  target: 502)    // 8:22
        add("Hurricane climb", 1140, target: 638)    // 10:38
        add("Point descent",   720,  target: 514)    // 8:34
        add("Coast miles",     3120, target: 532)    // 8:52
        add("Carmel run-in",   1500, target: 520)    // 8:40
        let total = phases.reduce(0) { $0 + $1.durationSec }
        return WatchWorkout(
            workoutId: "sample-bigsur",
            name: "Big Sur",
            summary: "Even effort · 8:46 flat",
            totalEstimatedMinutes: total / 60,
            phases: phases,
            completionEndpoint: "/api/watch/workouts/complete",
            expiresAt: "2026-05-21T08:00:00Z",
            readinessScore: 88,
            readinessLabel: "Race ready",
            distanceMi: 26.2,
            paceLabel: "Goal",
            isRace: true,
            goalSec: 13_800,            // 3:50:00
            strategyLabel: "Even effort · 8:46 flat",
            gelsMi: [4, 8, 12, 16, 20, 23]
        )
    }
}

// MARK: - Pace formatting helpers

enum PaceFormat {
    /// "6:31" from 391 s/mi. 2026-07-07 · units audit — redirected to the
    /// shared bare formatter (Util/Units.swift). Both call sites
    /// (PlannedView.swift) append their own "/mi" literal — fixed at each
    /// site rather than baking a suffix in here, matching this function's
    /// original bare-number contract.
    static func mmss(_ secondsPerMile: Int) -> String {
        Units.formatPaceBare(secPerMile: secondsPerMile)
    }

    /// "2:15" from 135 seconds (durations / elapsed clocks).
    static func clock(_ seconds: Int) -> String {
        let m = seconds / 60
        let s = seconds % 60
        return "\(m):\(String(format: "%02d", s))"
    }

    /// "1:34:20" / "3:50" — h:mm:ss for race-length clocks, m:ss under an hour.
    static func hms(_ seconds: Int) -> String {
        let h = seconds / 3600
        let m = (seconds % 3600) / 60
        let s = seconds % 60
        if h > 0 { return "\(h):\(String(format: "%02d", m)):\(String(format: "%02d", s))" }
        return "\(m):\(String(format: "%02d", s))"
    }

    /// "3:50" — hours:minutes, for goal/projection at race scale.
    static func hm(_ seconds: Int) -> String {
        let h = seconds / 3600
        let m = (seconds % 3600) / 60
        return "\(h):\(String(format: "%02d", m))"
    }
}


/// Race-day heart-rate guidance (2026-09-01). Every field is a REFERENCE the
/// race face may show beside the pace target; none of them is a ceiling the
/// wrist alarms on for the length of a race. `checkpointAbortBpm` is the one
/// figure the bail rule reads, at `checkpointMi`, and only when
/// `informationalOnly` is false.
struct WatchRaceHr: Codable, Equatable {
    let expectedLoBpm: Int
    let expectedHiBpm: Int
    let earlyCeilingBpm: Int
    let earlyThroughMi: Double
    let lateAllowanceBpm: Int
    let checkpointMi: Double?
    let checkpointAbortBpm: Int?
    let informationalOnly: Bool
}
