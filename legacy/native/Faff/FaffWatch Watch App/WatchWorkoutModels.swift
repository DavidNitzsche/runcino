//
//  WatchWorkoutModels.swift
//  FaffWatch
//
//  Data shapes for the watch app.  The INCOMING workout mirrors the
//  backend GET /api/watch/today payload (and the iPhone target's
//  Faff/API.swift WatchWorkout) — duplicated here per
//  docs/native/03-watchos-target-setup.md ("v0 duplication is fine;
//  consolidate later" once a shared module exists).
//
//  The OUTGOING completion mirrors the backend POST
//  /api/watch/workouts/complete body (web/lib/watch-completion.ts), so
//  when WatchConnectivity + HealthKit writeback land (phases 4-6) the
//  engine's result can be sent straight up with no reshaping.
//
//  This is the UI-shell phase (scoping step 3): timer-driven, no
//  HKWorkoutSession yet, so live pace/HR fields are nil here.
//

import Foundation

// MARK: - Lenient Int decoding (M-13 hardening · 2026-06-09)
//
// The server occasionally emits fractional numbers for fields the watch
// types as Int (readinessScore 67.4 was the live failure — the strict
// Int decode threw, the WHOLE WatchWorkout decode failed, and the watch
// silently kept yesterday's workout). The server is being fixed to round
// these in parallel; the watch additionally tolerates both forms so one
// fractional field can never invalidate the day's payload again.
//
// Decode order: Int first (exact, the common case), then Double → rounded.
// Encoding is untouched — these helpers are decode-only.

extension KeyedDecodingContainer {
    /// Required Int that may arrive as a JSON double. Throws only when the
    /// key is missing or the value is neither Int- nor Double-shaped.
    func lenientInt(forKey key: Key) throws -> Int {
        if let i = try? decode(Int.self, forKey: key) { return i }
        return Int((try decode(Double.self, forKey: key)).rounded())
    }

    /// Optional Int that may arrive as a JSON double. Never throws —
    /// missing / null / unparseable all read as nil.
    func lenientIntIfPresent(forKey key: Key) -> Int? {
        if let i = (try? decodeIfPresent(Int.self, forKey: key)) ?? nil { return i }
        if let d = (try? decodeIfPresent(Double.self, forKey: key)) ?? nil { return Int(d.rounded()) }
        return nil
    }

    /// Required [Int] that may arrive as [Double] (or mixed).
    func lenientIntArray(forKey key: Key) throws -> [Int] {
        if let ints = try? decode([Int].self, forKey: key) { return ints }
        return (try decode([Double].self, forKey: key)).map { Int($0.rounded()) }
    }
}

// MARK: - Incoming · today's prescribed workout

enum WatchPhaseType: String, Codable {
    case warmup, work, recovery, cooldown
}

enum WatchHaptic: String, Codable {
    case start
    case transitionWork = "transition-work"
    case transitionRecovery = "transition-recovery"
    case transitionCooldown = "transition-cooldown"
    case end
}

/// How a rep is measured — a time interval ("7 min") or a fixed distance
/// ("800 m" / "1 mi"). Drives whether the engine advances/counts down by
/// elapsed time or by GPS distance, and how the remaining value reads.
enum WatchRepUnit: String, Codable {
    case time, distance
}

/// A contingency rule from the plan's spec — the shape that makes the bail
/// offer possible at all.
///
/// The server has shipped `rules` since 2026-06-09 and this model never
/// decoded it, so the strongest thing in the design — the coach asking rather
/// than the runner quietly failing — could not fire. Same silent class as the
/// missing `ruleOutcomes`: the wire carried it, nothing errored, and the
/// feature simply never happened.
/// Race-day heart-rate guidance (2026-09-01). Every field is a REFERENCE the
/// race face may show beside the pace target; none of them is a ceiling the
/// wrist alarms on for the length of a race. `checkpointAbortBpm` is the one
/// figure a rule may act on, at `checkpointMi`, and only when
/// `informationalOnly` is false.
///
/// Mirrors `WatchRaceHr` in the phone's `Models/Watch.swift` field for field —
/// they are two decoders of ONE server object (`lib/race/race-hr-guidance.ts`),
/// and `check-wire-keys.sh` reads both against the emitter.
struct WatchRaceHr: Codable, Equatable {
    let expectedLoBpm: Int
    let expectedHiBpm: Int
    let earlyCeilingBpm: Int
    let earlyThroughMi: Double
    let lateAllowanceBpm: Int
    let checkpointMi: Double?
    let checkpointAbortBpm: Int?
    /// True → the band has no personal evidence behind it, or the runner's own
    /// efforts at this pace contradict it. No surface may grade or alarm on
    /// it; show it as a reference and say why.
    let informationalOnly: Bool
}

struct WatchRule: Codable, Equatable {
    /// "bail" | "abort" | "pass".
    ///
    /// CORRECTED 2026-09-01. This comment used to read "Only `bail` draws a
    /// board", and it was accurate: the race `abort` rules were authored,
    /// persisted, shipped over the wire, decoded here, and drew nothing. A
    /// safety stop shipped inert. `WorkoutEngine.bailRule` now falls through
    /// to an abort when no bail exists, and gates it on the rule's own
    /// `metric` and `scope`.
    ///
    /// `pass` still draws nothing, and that is correct — a pass criterion is
    /// a grading line, not something to interrupt a runner with.
    let kind: String
    /// "hr" | "pace".
    let metric: String?
    /// "<=" | ">".
    let op: String?
    let value: Double?
    /// "work" | "finish" | "overall" | "mile-5".
    let scope: String?
    let action: String?
    let label: String?
    /// 2026-08-21 · the board draws these as two registers — the evidence
    /// quietly, then the judgement in the coach's voice. Optional so an older
    /// payload still decodes, and the engine composes them when absent.
    let evidence: String?
    let judgement: String?

    private enum CodingKeys: String, CodingKey {
        case kind, metric, op, value, scope, action, label, evidence, judgement
    }

    /// Memberwise, for fixtures and the session simulator.
    ///
    /// The custom `init(from:)` below suppresses the synthesised one, and its
    /// absence is why the bail and abort boards could not be driven from
    /// `_SessionSim` at all: a harness could not construct a rule to breach.
    init(kind: String, metric: String? = nil, op: String? = nil, value: Double? = nil,
         scope: String? = nil, action: String? = nil, label: String? = nil,
         evidence: String? = nil, judgement: String? = nil) {
        self.kind = kind; self.metric = metric; self.op = op; self.value = value
        self.scope = scope; self.action = action; self.label = label
        self.evidence = evidence; self.judgement = judgement
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // Lenient throughout: a rule the watch cannot read must never cost the
        // workout, so every field but `kind` is optional and `kind` falls back
        // to a value that draws nothing.
        self.kind      = (try? c.decode(String.self, forKey: .kind)) ?? "pass"
        self.metric    = try? c.decodeIfPresent(String.self, forKey: .metric)
        self.op        = try? c.decodeIfPresent(String.self, forKey: .op)
        self.value     = try? c.decodeIfPresent(Double.self, forKey: .value)
        self.scope     = try? c.decodeIfPresent(String.self, forKey: .scope)
        self.action    = try? c.decodeIfPresent(String.self, forKey: .action)
        self.label     = try? c.decodeIfPresent(String.self, forKey: .label)
        self.evidence  = try? c.decodeIfPresent(String.self, forKey: .evidence)
        self.judgement = try? c.decodeIfPresent(String.self, forKey: .judgement)
    }

    var isBail: Bool { kind == "bail" }
    var isAbort: Bool { kind == "abort" }
}

/// A line the coach says, and the same line drawn on the wrist for the three
/// seconds it is spoken.
///
/// RULE 10: a spoken cue is ALWAYS also drawn. Audio is a delivery route,
/// never a second content channel — one runner has headphones in, one has
/// them in a pocket, and both get the same sentence. That is why this carries
/// exactly one `text` and not a spoken twin: two fields would eventually
/// disagree, and the runner with no headphones would be the one who lost.
struct WatchSpokenCue: Codable, Equatable, Identifiable {
    let id: String
    let text: String
    /// "distance" | "phase" | "fraction" — names which of the three below is
    /// the live one. Flat rather than a tagged union because the lenient
    /// decoders cannot express one.
    let trigger: String
    let atMi: Double?
    let phaseIndex: Int?
    let atFraction: Double?
    let holdSec: Int

    private enum CodingKeys: String, CodingKey {
        case id, text, trigger, atMi, phaseIndex, atFraction, holdSec
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.id          = (try? c.decode(String.self, forKey: .id)) ?? UUID().uuidString
        self.text        = (try? c.decode(String.self, forKey: .text)) ?? ""
        self.trigger     = (try? c.decode(String.self, forKey: .trigger)) ?? "fraction"
        self.atMi        = try? c.decodeIfPresent(Double.self, forKey: .atMi)
        self.phaseIndex  = c.lenientIntIfPresent(forKey: .phaseIndex)
        self.atFraction  = try? c.decodeIfPresent(Double.self, forKey: .atFraction)
        self.holdSec     = c.lenientIntIfPresent(forKey: .holdSec) ?? 3
    }

    /// A cue with nothing to say is not a cue.
    var isDrawable: Bool { !text.isEmpty }
}

/// PACE-SHAPE-1 (2026-09-01) · what a phase's `targetPaceSPerMi` MEANS.
///
/// The wrist used to grade every paced phase as a two-sided band, because the
/// wire carried a target and a tolerance and nothing that said which KIND of
/// target it was. So a cool-down at 8:54/mi under an 8:22/mi easy ceiling came
/// back `missed` — a correct cool-down, graded a failure — and a between-rep
/// jog was one legacy payload away from being graded at all.
///
///   · `window`  — hold it, ±`tolerancePaceSPerMi`, both sides. Quality reps.
///   · `ceiling` — do not go FASTER than it. Slower is never a miss. Warm-up,
///                 cool-down, easy and long running.
///   · `none`    — no prescribed pace. Recovery jogs. Never pace-graded.
///   · `effort`  — a target that is not a pace. Never pace-graded.
///
/// Additive on the wire: a payload that omits it falls back to `legacyDefault`
/// below, which reproduces the old behaviour for work phases and fixes the two
/// shapes that were unambiguously wrong (recovery, warm-up/cool-down) without
/// needing the server to say so. The server owner is
/// `web-v2/lib/training/execution-semantics.ts`; this enum never re-derives it.
enum WatchPaceShape: String, Codable {
    case window
    case ceiling
    case effort
    case none

    /// What a phase means when the server did not say.
    ///
    /// Deliberately NOT `.window` for every phase. A recovery has no prescribed
    /// pace, and a warm-up/cool-down target is the easy band's fast edge — both
    /// are true of every session ever authored, so an old payload gets the
    /// right answer without a server round trip.
    static func legacyDefault(for type: WatchPhaseType, hasTarget: Bool) -> WatchPaceShape {
        guard hasTarget else { return .none }
        switch type {
        case .recovery: return .none
        case .warmup, .cooldown: return .ceiling
        default: return .window
        }
    }

    /// Is this phase graded against a pace at all?
    var isPaceGraded: Bool { self == .window || self == .ceiling }
}

struct WatchPhase: Codable, Identifiable {
    /// Stable identity for SwiftUI lists · the cursor index assigned at
    /// decode time (the backend payload has no per-phase id).
    var id: Int { index }
    /// `var` only so `reindexed(_:)` can copy-and-overwrite. Nothing outside
    /// this type may move a phase's position — see RESTAMP-2.
    private(set) var index: Int
    let type: WatchPhaseType
    let label: String
    let durationSec: Int
    let targetPaceSPerMi: Int?
    let tolerancePaceSPerMi: Int?
    /// PACE-SHAPE-1 · what `targetPaceSPerMi` means. Never nil: an omitted wire
    /// key resolves through `WatchPaceShape.legacyDefault`, so every consumer
    /// can branch on it without a second absence check.
    let paceShape: WatchPaceShape
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
    /// Face display semantics (floor/ceiling/reference) are a face-level decision.
    let hrTargetBpm: Int?
    /// 2026-06-08 · True on the closing HM/M pace segment of a long run.
    /// Server sets it when workout_spec.finish_mi is present. Old payloads
    /// omit it → false. The router shows the FINISH face (not the rep face)
    /// and the engine fires a FINISH boundary cue instead of "REP n/m".
    let isFinishSegment: Bool
    /// 2026-08-23 · the server has carried this since DOCTRINE-STRIDES-1 and
    /// this model never read it, so the router matched `label.contains("stride")`
    /// instead and said so in a comment: "the wire has no strides phase". It
    /// does. The board worked only because `expand-spec.ts` happens to emit
    /// "Stride N of M" — rename that label and strides silently stopped.
    let isStrideSegment: Bool
    /// The contingency line drawn under a phase target. Emitted since
    /// 2026-08-21, never decoded.
    let ruleLabel: String?
    let ruleEvidence: String?
    let ruleJudgement: String?

    /// The backend payload omits `index` (the phases array is ordered
    /// and the watch walks it with a cursor).  We assign it during
    /// decode via WatchWorkout's custom init so each phase carries its
    /// own position for labels + completion reporting.
    init(index: Int, type: WatchPhaseType, label: String, durationSec: Int,
         targetPaceSPerMi: Int?, tolerancePaceSPerMi: Int?, haptic: WatchHaptic,
         paceShape: WatchPaceShape? = nil,
         repUnit: WatchRepUnit = .time, distanceMi: Double? = nil, hrTargetBpm: Int? = nil,
         isFinishSegment: Bool = false, isStrideSegment: Bool = false,
         ruleLabel: String? = nil, ruleEvidence: String? = nil, ruleJudgement: String? = nil) {
        self.index = index
        self.type = type
        self.label = label
        self.durationSec = durationSec
        self.targetPaceSPerMi = targetPaceSPerMi
        self.tolerancePaceSPerMi = tolerancePaceSPerMi
        self.paceShape = paceShape
            ?? WatchPaceShape.legacyDefault(for: type, hasTarget: (targetPaceSPerMi ?? 0) > 0)
        self.haptic = haptic
        self.repUnit = repUnit
        self.distanceMi = distanceMi
        self.hrTargetBpm = hrTargetBpm
        self.isFinishSegment = isFinishSegment
        self.isStrideSegment = isStrideSegment
        self.ruleLabel = ruleLabel
        self.ruleEvidence = ruleEvidence
        self.ruleJudgement = ruleJudgement
    }

    /// A copy of this phase carrying its position in the array.
    ///
    /// RESTAMP-2 · the ONLY way `WatchWorkout`'s decoder stamps an index.
    /// Copy-and-overwrite, never a positional re-construction: a field added
    /// to this struct tomorrow survives the round trip without anyone having
    /// to remember that this line exists. Twice now, nobody did.
    func reindexed(_ i: Int) -> WatchPhase {
        var copy = self
        copy.index = i
        return copy
    }

    private enum CodingKeys: String, CodingKey {
        case type, label, durationSec, targetPaceSPerMi, tolerancePaceSPerMi, paceShape, haptic, repUnit, distanceMi, hrTargetBpm, isFinishSegment
        case isStrideSegment, ruleLabel, ruleEvidence, ruleJudgement
    }

    /// Decoding without an index — used only when a phase is decoded in
    /// isolation.  WatchWorkout normally re-stamps indices on decode.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.index = 0
        // A value a newer server invents must read as unrecognised, not
        // throw. `type`, `haptic` and `repUnit` each took the whole workout
        // down on an unknown string — so adding a fifth phase type server-side
        // was a breaking change for every deployed watch. The file's own
        // doctrine says this, and applied it to the glance's enums only.
        self.type = (try? c.decode(WatchPhaseType.self, forKey: .type)) ?? .work
        self.label = try c.decode(String.self, forKey: .label)
        // Lenient Int decodes (M-13): server-derived numerics can arrive
        // fractional (durationSec = pace × miles, etc). Int first, Double
        // → rounded fallback — a stray .5 must not kill the whole payload.
        self.durationSec = try c.lenientInt(forKey: .durationSec)
        self.targetPaceSPerMi = c.lenientIntIfPresent(forKey: .targetPaceSPerMi)
        self.tolerancePaceSPerMi = c.lenientIntIfPresent(forKey: .tolerancePaceSPerMi)
        // Same leniency doctrine as `type`/`haptic`/`repUnit` above: a shape
        // string a newer server invents must read as unrecognised and fall
        // back, never throw and take the whole workout down.
        let decodedType = self.type
        let decodedTarget = self.targetPaceSPerMi
        self.paceShape = ((try? c.decodeIfPresent(WatchPaceShape.self, forKey: .paceShape)) ?? nil)
            ?? WatchPaceShape.legacyDefault(for: decodedType, hasTarget: (decodedTarget ?? 0) > 0)
        self.haptic = (try? c.decode(WatchHaptic.self, forKey: .haptic)) ?? .start
        self.repUnit = try c.decodeIfPresent(WatchRepUnit.self, forKey: .repUnit) ?? .time
        self.distanceMi = try c.decodeIfPresent(Double.self, forKey: .distanceMi)
        self.hrTargetBpm = c.lenientIntIfPresent(forKey: .hrTargetBpm)
        self.isFinishSegment = try c.decodeIfPresent(Bool.self, forKey: .isFinishSegment) ?? false
        self.isStrideSegment = ((try? c.decodeIfPresent(Bool.self, forKey: .isStrideSegment)) ?? nil) ?? false
        self.ruleLabel = (try? c.decodeIfPresent(String.self, forKey: .ruleLabel)) ?? nil
        self.ruleEvidence = (try? c.decodeIfPresent(String.self, forKey: .ruleEvidence)) ?? nil
        self.ruleJudgement = (try? c.decodeIfPresent(String.self, forKey: .ruleJudgement)) ?? nil
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(type, forKey: .type)
        try c.encode(label, forKey: .label)
        try c.encode(durationSec, forKey: .durationSec)
        try c.encodeIfPresent(targetPaceSPerMi, forKey: .targetPaceSPerMi)
        try c.encodeIfPresent(tolerancePaceSPerMi, forKey: .tolerancePaceSPerMi)
        // RESTAMP-2 applies here too. `persistSnapshot` stores the workout as
        // JSON, so dropping this on the way OUT means a run resumed after a
        // crash grades its cool-down as a two-sided band again.
        try c.encode(paceShape, forKey: .paceShape)
        try c.encode(haptic, forKey: .haptic)
        try c.encode(repUnit, forKey: .repUnit)
        try c.encodeIfPresent(distanceMi, forKey: .distanceMi)
        try c.encodeIfPresent(hrTargetBpm, forKey: .hrTargetBpm)
        try c.encode(isFinishSegment, forKey: .isFinishSegment)
        // RESTAMP-2 · the same four fields, dropped again on the way OUT.
        // This is not a cosmetic symmetry: `WorkoutEngine.persistSnapshot`
        // stores the crash-recovery snapshot as `JSONEncoder().encode(workout)`
        // (WorkoutEngine.swift:640 and :2451), so a run resumed after a crash
        // decodes a workout whose strides are no longer flagged and whose bail
        // registers are gone. The decode side was the visible half; while it
        // was broken this half could not be noticed.
        try c.encode(isStrideSegment, forKey: .isStrideSegment)
        try c.encodeIfPresent(ruleLabel, forKey: .ruleLabel)
        try c.encodeIfPresent(ruleEvidence, forKey: .ruleEvidence)
        try c.encodeIfPresent(ruleJudgement, forKey: .ruleJudgement)
    }
}

struct WatchWorkout: Codable {

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
    let readinessLabel: String?     // "Primed" / "Hold easy" / "Back off"
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
    /// RACE-DAY HEART RATE, AS A REFERENCE (2026-09-01).
    ///
    /// From `lib/race/race-hr-guidance.ts` via `build-workout.ts`. Every field
    /// is something the race face may SHOW beside the pace target; none of
    /// them is a ceiling the wrist alarms on for the length of a race — that
    /// is the whole point of the object existing, because race day used to
    /// carry a single `hr_cap_bpm` graded as a hard cap and the owner's own
    /// half marathon came in one beat under it on his PR.
    ///
    /// `Research/08` §6.1: race HR is a BAND per distance, "guides, not laws",
    /// with 3-5 bpm/hour of drift expected. `checkpointAbortBpm` is the ONE
    /// figure a rule may act on, at `checkpointMi`, and only when
    /// `informationalOnly` is false.
    ///
    /// HR-SEMANTICS-2 · THIS DID NOT EXIST HERE UNTIL NOW. `raceHr` was added
    /// to `native-v2/Faff/Faff/Models/Watch.swift` — the PHONE'S mirror of
    /// this model — and reported as "the watch decodes raceHr". The watch app
    /// compiles THIS file, so the field arrived over WatchConnectivity and was
    /// dropped on decode: nothing on the wrist had ever seen it.
    let raceHr: WatchRaceHr?
    // Optional backend signal for which IN-RUN face flavour to render.
    // Recognised values (router falls back to phase-based defaults when nil
    // or unknown):
    //   · "hr"           → HRFace (HR is the hero, pace below as reference)
    //   · "progression"  → ProgressionFace (current step target + miles to next)
    //   · "strides"      → StridesFace (burst countdown + strip)
    //   · "tempo"        → TempoFace (live · target · steady HR · miles-to-go)
    // The phase-driven default rules (single-work-phase + target → EasyFace
    // etc.) still apply when this is nil, so older payloads keep working.
    let displayHint: String?
    // 2026-07-07 · units audit — runner's distance display preference
    // ("mi"/"km"), sourced from profile.user_settings.units_distance.
    // DISPLAY ONLY: every numeric field on this payload (distanceMi,
    // phase.targetPaceSPerMi, etc.) stays in miles / seconds-per-mile
    // regardless of this value — the engine's GPS accumulation and
    // pace-drift comparisons are untouched. Only the formatting helpers
    // that render a Text(...) string read it. nil/unrecognized → "mi",
    // matching every payload before this field existed.
    let unitsDistance: String?
    /// Contingency rules. See `WatchRule`.
    let rules: [WatchRule]?
    /// Lines the coach says, each also drawn. See `WatchSpokenCue`.
    let spokenCues: [WatchSpokenCue]?

    /// 2026-08-24 · today's conditions, one sentence, LOBBY ONLY.
    ///
    /// Present only when the server actually eased this payload's targets for
    /// the heat, so its presence IS the adjustment and its absence is not a
    /// silent failure. Nothing on a running face ever draws it: a runner
    /// mid-effort cannot act on a temperature, and the band they are being
    /// held to already carries the correction.
    let heatNote: String?

    private enum CodingKeys: String, CodingKey {
        case workoutId, name, summary, totalEstimatedMinutes, phases, completionEndpoint, expiresAt
        case readinessScore, readinessLabel, distanceMi, paceLabel
        case isRace, goalSec, strategyLabel, gelsMi, fueling, hrCeilingBpm, raceHr
        case displayHint, unitsDistance, rules, spokenCues, heatNote
    }

    init(workoutId: String, name: String, summary: String, totalEstimatedMinutes: Int,
         phases: [WatchPhase], completionEndpoint: String, expiresAt: String,
         readinessScore: Int? = nil, readinessLabel: String? = nil,
         distanceMi: Double? = nil, paceLabel: String? = nil,
         isRace: Bool = false, goalSec: Int? = nil, strategyLabel: String? = nil, gelsMi: [Double]? = nil,
         fueling: WatchFueling? = nil, hrCeilingBpm: Int? = nil,
         raceHr: WatchRaceHr? = nil,
         displayHint: String? = nil, unitsDistance: String? = nil,
         rules: [WatchRule]? = nil,
         spokenCues: [WatchSpokenCue]? = nil,
         heatNote: String? = nil) {
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
        self.unitsDistance = unitsDistance
        self.rules = rules
        self.spokenCues = spokenCues
        self.heatNote = heatNote
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.workoutId = try c.decode(String.self, forKey: .workoutId)
        self.name = try c.decode(String.self, forKey: .name)
        self.summary = try c.decode(String.self, forKey: .summary)
        // Lenient Int decodes (M-13): readinessScore arrived as 67.4 once
        // and the strict Int decode failed the WHOLE workout decode — the
        // watch silently kept yesterday's session. Tolerate Double → round.
        self.totalEstimatedMinutes = try c.lenientInt(forKey: .totalEstimatedMinutes)
        self.completionEndpoint = try c.decode(String.self, forKey: .completionEndpoint)
        self.expiresAt = try c.decode(String.self, forKey: .expiresAt)
        self.readinessScore = c.lenientIntIfPresent(forKey: .readinessScore)
        self.readinessLabel = try c.decodeIfPresent(String.self, forKey: .readinessLabel)
        self.distanceMi = try c.decodeIfPresent(Double.self, forKey: .distanceMi)
        self.paceLabel = try c.decodeIfPresent(String.self, forKey: .paceLabel)
        self.isRace = try c.decodeIfPresent(Bool.self, forKey: .isRace) ?? false
        self.goalSec = c.lenientIntIfPresent(forKey: .goalSec)
        self.strategyLabel = try c.decodeIfPresent(String.self, forKey: .strategyLabel)
        self.gelsMi = try c.decodeIfPresent([Double].self, forKey: .gelsMi)
        // `try?`, like `rules` and `spokenCues`. WatchFueling hard-decodes all
        // nine of its fields, so ONE missing key threw and took the entire
        // day's payload with it — the exact shape of the M-13 incident, whose
        // mitigation was applied to its two siblings and not to this.
        self.fueling = (try? c.decodeIfPresent(WatchFueling.self, forKey: .fueling)) ?? nil
        self.hrCeilingBpm = c.lenientIntIfPresent(forKey: .hrCeilingBpm)
        // `try?`, like `fueling` / `rules` / `spokenCues` above. A band the
        // runner is only meant to GLANCE at must never be the reason a
        // race-morning payload fails to decode and the wrist shows
        // yesterday's session on the start line.
        self.raceHr = (try? c.decodeIfPresent(WatchRaceHr.self, forKey: .raceHr)) ?? nil
        self.displayHint = try c.decodeIfPresent(String.self, forKey: .displayHint)
        self.unitsDistance = try c.decodeIfPresent(String.self, forKey: .unitsDistance)
        // Lenient: a malformed rules array must never cost the workout.
        self.rules = (try? c.decodeIfPresent([WatchRule].self, forKey: .rules)) ?? nil
        self.spokenCues = (try? c.decodeIfPresent([WatchSpokenCue].self, forKey: .spokenCues)) ?? nil
        // Lenient, like its neighbours. A sentence about the weather must
        // never be the reason a runner has no workout.
        self.heatNote = (try? c.decodeIfPresent(String.self, forKey: .heatNote)) ?? nil
        // Re-stamp each phase with its cursor index. CRITICAL: pass through
        // repUnit + distanceMi too — earlier this constructor only carried
        // the first 7 fields forward, which silently dropped repUnit (→ .time)
        // and distanceMi (→ nil) on every phase after decode. That's the
        // bug behind yesterday's 5.8-mi long run overshooting to 6.0: the
        // engine fell through to time-based finish because the phase's
        // distanceMi was lost mid-decode. Same bug ate the distance count-
        // down. Round-trip smoke test in WatchFixtures · cruise-decode-
        // tomorrow caught it.
        //
        // RESTAMP-2 (2026-08-25) · AND IT HAPPENED AGAIN, TO THE NEXT FOUR.
        //
        // The note above is the fix for the FIRST two fields this constructor
        // dropped. Every field added to `WatchPhase` since then was decoded
        // correctly by `WatchPhase.init(from:)` on the line above and then
        // thrown away here, because the re-stamp names its fields positionally
        // and the trailing ones default:
        //
        //   · `isStrideSegment` → false. Decoded 2026-08-23 specifically so
        //     the stride board would stop routing on prose, with a comment at
        //     WatchRouterV5.swift:828 saying "the flag is the evidence". The
        //     flag never arrived; `isStrides` has been carried the whole time
        //     by its own `label.contains("stride")` fallback, so renaming
        //     "Stride N of M" upstream still silently retires the board. The
        //     fix reads as landed and is inert.
        //   · `ruleLabel` / `ruleEvidence` / `ruleJudgement` → nil. The
        //     server has pinned the bail's two registers onto the phases it
        //     scopes to since 2026-08-21 (build-workout.ts, B7).
        //
        // A positional re-stamp cannot be made safe by remembering to update
        // it; this is the second time it was not remembered. Copying through a
        // `var` and overwriting only `index` means a field added tomorrow
        // survives by default, and the dropping case has to be written on
        // purpose rather than reached by forgetting.
        let raw = try c.decode([WatchPhase].self, forKey: .phases)
        self.phases = raw.enumerated().map { (i, p) in p.reindexed(i) }
    }
}

// MARK: - Expiry parsing (RK-2 · 2026-06-09)
//
// The backend stamps `expiresAt` via toISOString(), which ALWAYS carries
// fractional seconds ("2026-06-09T18:00:00.000Z"). A default
// ISO8601DateFormatter cannot parse fractional seconds, so the staleness
// gate's parse silently failed and the gate never fired. The server is
// being changed in parallel to also emit non-fractional timestamps —
// this parser accepts BOTH forms. Parse failure stays permissive
// (isExpired == false) so a malformed timestamp can't block a legit run.

extension WatchWorkout {
    private static let isoFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let isoPlain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    /// Parse an ISO-8601 timestamp, fractional seconds or not.
    static func parseExpiry(_ raw: String) -> Date? {
        isoFractional.date(from: raw) ?? isoPlain.date(from: raw)
    }

    /// True when the payload's expiry window has passed. Unparseable /
    /// missing expiry reads as NOT expired (permissive — see above).
    var isExpired: Bool {
        guard let exp = Self.parseExpiry(expiresAt) else { return false }
        return Date.now > exp
    }
}

// MARK: - Incoming · 0821 lobby glance (additive · 2026-08-21 · server 82d3b1f7)
//
// GET /api/watch/today gained three OPTIONAL objects that ride BOTH
// branches of the response — the one with a `workout` and the one with
// only a `message`. Server side they are declared in
// web-v2/lib/watch/build-workout.ts (WatchWeekStrip / WatchSessionMoved /
// WatchDayState / WatchTodayGlance):
//
//   · weekStrip    → the lobby's "This week" page
//   · sessionMoved → the "the session already moved" lobby variant
//   · dayState     → the two structured empty states (rest / no session)
//
// Everything here is ADDITIVE. A payload that predates these keys decodes
// exactly as it decoded before, because each object is optional AND is
// read with `try?` at the envelope, so a malformed or newer-shaped glance
// object can never cost the runner the workout it arrived beside.
//
// Two conventions carried over from the rest of this file:
//
//   · Ints go through the lenient helpers (M-13). A fractional `dow` must
//     not be able to invalidate a day's payload the way readinessScore
//     67.4 once did.
//   · The wire's string enumerations — `state`, `kind`, `actionKind` — are
//     decoded as RAW STRINGS, not Swift enums. A value a newer server
//     invents has to read as "unrecognised" at the face, not throw here.
//     Typed accessors sit next to each one for callers that want a case.

/// One day of the lobby's week strip. `state` is the design's three-way
/// read; `isPast` rides alongside it so a past day nobody ran is not drawn
/// as though it were still to come.
struct WatchWeekStripDay: Codable, Identifiable {
    /// Stable identity for SwiftUI · the wire has no per-day id.
    var id: String { dateIso }
    let dateIso: String
    /// 0=Sun .. 6=Sat
    let dow: Int
    /// The strip's 10 pt day letter.
    let letter: String
    /// "done" · "today" · "remaining" — raw, see the note above.
    let state: String
    let isPast: Bool
    /// plan_workouts.type · "rest" on a synthesised rest day.
    let type: String
    let plannedMi: Double
    /// Canonical actual mileage. nil when nothing was run — never a zero
    /// standing in for one.
    let doneMi: Double?

    var isToday: Bool { state == "today" }
    var isDone: Bool { state == "done" }

    private enum CodingKeys: String, CodingKey {
        case dateIso, dow, letter, state, isPast, type, plannedMi, doneMi
    }

    init(dateIso: String, dow: Int, letter: String, state: String, isPast: Bool,
         type: String, plannedMi: Double, doneMi: Double? = nil) {
        self.dateIso = dateIso
        self.dow = dow
        self.letter = letter
        self.state = state
        self.isPast = isPast
        self.type = type
        self.plannedMi = plannedMi
        self.doneMi = doneMi
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.dateIso = try c.decode(String.self, forKey: .dateIso)
        // Lenient (M-13) · a day-of-week that arrives 3.0 is still Wednesday.
        self.dow = try c.lenientInt(forKey: .dow)
        self.letter = try c.decodeIfPresent(String.self, forKey: .letter) ?? ""
        self.state = try c.decodeIfPresent(String.self, forKey: .state) ?? "remaining"
        self.isPast = try c.decodeIfPresent(Bool.self, forKey: .isPast) ?? false
        self.type = try c.decodeIfPresent(String.self, forKey: .type) ?? "rest"
        self.plannedMi = try c.decodeIfPresent(Double.self, forKey: .plannedMi) ?? 0
        self.doneMi = try c.decodeIfPresent(Double.self, forKey: .doneMi)
    }
}

/// The lobby's "This week" page · seven days plus "18 of 42 mi". Projected
/// server-side from the SAME week loader /api/plan/week and /api/v5/today
/// read, so the wrist's week and the phone's week cannot disagree.
struct WatchWeekStrip: Codable {
    let weekStartIso: String
    let weekEndIso: String
    /// Miles actually run across the window, one decimal.
    let milesDone: Double
    /// Miles the plan asked for across the window, one decimal.
    let milesPlanned: Double
    /// Always seven, in day order.
    let days: [WatchWeekStripDay]

    private enum CodingKeys: String, CodingKey {
        case weekStartIso, weekEndIso, milesDone, milesPlanned, days
    }

    init(weekStartIso: String, weekEndIso: String, milesDone: Double,
         milesPlanned: Double, days: [WatchWeekStripDay]) {
        self.weekStartIso = weekStartIso
        self.weekEndIso = weekEndIso
        self.milesDone = milesDone
        self.milesPlanned = milesPlanned
        self.days = days
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.weekStartIso = try c.decode(String.self, forKey: .weekStartIso)
        self.weekEndIso = try c.decode(String.self, forKey: .weekEndIso)
        self.milesDone = try c.decodeIfPresent(Double.self, forKey: .milesDone) ?? 0
        self.milesPlanned = try c.decodeIfPresent(Double.self, forKey: .milesPlanned) ?? 0
        self.days = try c.decodeIfPresent([WatchWeekStripDay].self, forKey: .days) ?? []
    }
}

/// Lobby variant · the session ALREADY changed, and the reason is stated
/// once. Deliberately carries no score: readinessScore / readinessLabel on
/// WatchWorkout are untouched and separate — this is not them.
struct WatchSessionMoved: Codable {
    /// The coach's own reason, citation-scrubbed at source.
    let reason: String?
    /// What the day used to be · "was six miles".
    let wasLine: String?
    /// The two composed into the one line the board draws.
    let line: String
    let originalType: String?
    let originalSubLabel: String?
    let originalDistanceMi: Double?
    /// AdaptationInfo.kind · "downgrade" · "reschedule" · "shave" · …
    let kind: String?
    let adaptedAt: String?

    private enum CodingKeys: String, CodingKey {
        case reason, wasLine, line, originalType, originalSubLabel
        case originalDistanceMi, kind, adaptedAt
    }

    init(reason: String? = nil, wasLine: String? = nil, line: String,
         originalType: String? = nil, originalSubLabel: String? = nil,
         originalDistanceMi: Double? = nil, kind: String? = nil,
         adaptedAt: String? = nil) {
        self.reason = reason
        self.wasLine = wasLine
        self.line = line
        self.originalType = originalType
        self.originalSubLabel = originalSubLabel
        self.originalDistanceMi = originalDistanceMi
        self.kind = kind
        self.adaptedAt = adaptedAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.reason = try c.decodeIfPresent(String.self, forKey: .reason)
        self.wasLine = try c.decodeIfPresent(String.self, forKey: .wasLine)
        // `line` is the only thing the board actually draws. The server
        // emits nothing at all rather than a line it cannot compose, so an
        // object that arrives without one has nothing to say either.
        self.line = try c.decode(String.self, forKey: .line)
        self.originalType = try c.decodeIfPresent(String.self, forKey: .originalType)
        self.originalSubLabel = try c.decodeIfPresent(String.self, forKey: .originalSubLabel)
        self.originalDistanceMi = try c.decodeIfPresent(Double.self, forKey: .originalDistanceMi)
        self.kind = try c.decodeIfPresent(String.self, forKey: .kind)
        self.adaptedAt = try c.decodeIfPresent(String.self, forKey: .adaptedAt)
    }
}

/// The next running day still ahead in the loaded week, surfaced on the
/// Rest / No-session boards. nil when the window has nothing left after
/// today — never guessed past what the server loaded.
struct WatchNextWorkout: Codable {
    /// "Thursday"
    let dayName: String
    let dateIso: String
    /// plan_workouts.type · "easy" · "long" · "tempo" · "intervals" · …
    let type: String
    let distanceMi: Double
    /// 1 = tomorrow, 2 = "in 2 days", etc. Always >= 1.
    let daysAway: Int

    private enum CodingKeys: String, CodingKey {
        case dayName, dateIso, type, distanceMi, daysAway
    }

    init(dayName: String, dateIso: String, type: String, distanceMi: Double, daysAway: Int) {
        self.dayName = dayName
        self.dateIso = dateIso
        self.type = type
        self.distanceMi = distanceMi
        self.daysAway = daysAway
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.dayName = try c.decodeIfPresent(String.self, forKey: .dayName) ?? ""
        self.dateIso = try c.decode(String.self, forKey: .dateIso)
        self.type = try c.decodeIfPresent(String.self, forKey: .type) ?? "easy"
        self.distanceMi = try c.decodeIfPresent(Double.self, forKey: .distanceMi) ?? 0
        self.daysAway = try c.lenientInt(forKey: .daysAway)
    }
}

/// Why there is no prescribed session. `kind == "rest"` is a planned rest
/// day and is its own board; every other value is the No-session board.
/// The flat `message` string still rides the response beside this, so a
/// deployed watch that knows nothing of dayState keeps working.
struct WatchDayState: Codable {
    /// "rest" · "no_session"
    let kind: String
    /// nil on rest · otherwise "injury" · "sick" · "week_off" ·
    /// "off_season" · "no_plan" · "nothing_scheduled".
    let reason: String?
    /// Display lede · "Nothing today" · "Week off" · "Off-season".
    let title: String
    /// The reasoned coach sentence. A clause whose evidence is missing is
    /// dropped at source rather than guessed, so this is safe to draw whole.
    let coachLine: String
    /// The board's one target · "Run anyway" · "Just run".
    let actionLabel: String
    /// "run_anyway" · "just_run"
    let actionKind: String
    /// Evidence behind `coachLine`, carried separately so the watch can
    /// recompose it. nil when unknown — never a zero standing in for one.
    let weekMilesDone: Double?
    let weekMilesPlanned: Double?
    /// "Sunday" · the day this week's long run falls on.
    let longRunDayName: String?
    let longRunIsPast: Bool
    let longRunDone: Bool
    /// "Monday" plus its date · when the block resumes. Week-off only.
    let resumesDayName: String?
    let resumesIso: String?
    /// The next running day still ahead in the loaded week. nil when the
    /// window has nothing left after today.
    let nextWorkout: WatchNextWorkout?

    var isRestDay: Bool { kind == "rest" }
    var isJustRun: Bool { actionKind == "just_run" }

    private enum CodingKeys: String, CodingKey {
        case kind, reason, title, coachLine, actionLabel, actionKind
        case weekMilesDone, weekMilesPlanned
        case longRunDayName, longRunIsPast, longRunDone
        case resumesDayName, resumesIso, nextWorkout
    }

    init(kind: String, reason: String? = nil, title: String, coachLine: String,
         actionLabel: String, actionKind: String,
         weekMilesDone: Double? = nil, weekMilesPlanned: Double? = nil,
         longRunDayName: String? = nil, longRunIsPast: Bool = false,
         longRunDone: Bool = false, resumesDayName: String? = nil,
         resumesIso: String? = nil, nextWorkout: WatchNextWorkout? = nil) {
        self.kind = kind
        self.reason = reason
        self.title = title
        self.coachLine = coachLine
        self.actionLabel = actionLabel
        self.actionKind = actionKind
        self.weekMilesDone = weekMilesDone
        self.weekMilesPlanned = weekMilesPlanned
        self.longRunDayName = longRunDayName
        self.longRunIsPast = longRunIsPast
        self.longRunDone = longRunDone
        self.resumesDayName = resumesDayName
        self.resumesIso = resumesIso
        self.nextWorkout = nextWorkout
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.kind = try c.decodeIfPresent(String.self, forKey: .kind) ?? "no_session"
        self.reason = try c.decodeIfPresent(String.self, forKey: .reason)
        self.title = try c.decode(String.self, forKey: .title)
        self.coachLine = try c.decodeIfPresent(String.self, forKey: .coachLine) ?? ""
        self.actionLabel = try c.decodeIfPresent(String.self, forKey: .actionLabel) ?? "Just run"
        self.actionKind = try c.decodeIfPresent(String.self, forKey: .actionKind) ?? "just_run"
        self.weekMilesDone = try c.decodeIfPresent(Double.self, forKey: .weekMilesDone)
        self.weekMilesPlanned = try c.decodeIfPresent(Double.self, forKey: .weekMilesPlanned)
        self.longRunDayName = try c.decodeIfPresent(String.self, forKey: .longRunDayName)
        self.longRunIsPast = try c.decodeIfPresent(Bool.self, forKey: .longRunIsPast) ?? false
        self.longRunDone = try c.decodeIfPresent(Bool.self, forKey: .longRunDone) ?? false
        self.resumesDayName = try c.decodeIfPresent(String.self, forKey: .resumesDayName)
        self.resumesIso = try c.decodeIfPresent(String.self, forKey: .resumesIso)
        self.nextWorkout = try c.decodeIfPresent(WatchNextWorkout.self, forKey: .nextWorkout)
    }
}

/// One row of the lobby's post-run recap · "Distance / asked 7 mi / 3.14 mi",
/// "Heart / under 145 / 121", "Effort / — / 4 of 10". `sub`/`value` arrive
/// precomposed — the server already formatted this prose, the watch draws it
/// verbatim, same convention as `WatchDayState.coachLine`.
struct WatchCompletedRow: Codable, Identifiable {
    var id: String { rowId }
    let rowId: String
    let label: String
    let sub: String?
    let value: String?
    /// "attention" · nil.
    let tone: String?

    private enum CodingKeys: String, CodingKey {
        case rowId = "id", label, sub, value, tone
    }

    init(rowId: String, label: String, sub: String? = nil, value: String? = nil, tone: String? = nil) {
        self.rowId = rowId
        self.label = label
        self.sub = sub
        self.value = value
        self.tone = tone
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.rowId = try c.decodeIfPresent(String.self, forKey: .rowId) ?? ""
        self.label = try c.decodeIfPresent(String.self, forKey: .label) ?? ""
        self.sub = try c.decodeIfPresent(String.self, forKey: .sub)
        self.value = try c.decodeIfPresent(String.self, forKey: .value)
        self.tone = try c.decodeIfPresent(String.self, forKey: .tone)
    }
}

/// The lobby draws this instead of the Start board once today's session is
/// already run — asked-vs-ran, the same three rows `/api/v5/today` composes
/// for the phone, trimmed to what the wrist has room for (no elevation,
/// weather, shoes). `distanceMi`/`durationSec`/`paceSPerMi` are raw so the
/// watch's own WFmt formatters render them, same convention as every other
/// numeric field on this payload.
struct WatchCompletedRun: Codable {
    let distanceMi: Double
    let durationSec: Int?
    let paceSPerMi: Double?
    let avgHr: Int?
    let rows: [WatchCompletedRow]

    private enum CodingKeys: String, CodingKey {
        case distanceMi, durationSec, paceSPerMi, avgHr, rows
    }

    init(distanceMi: Double, durationSec: Int? = nil, paceSPerMi: Double? = nil,
         avgHr: Int? = nil, rows: [WatchCompletedRow] = []) {
        self.distanceMi = distanceMi
        self.durationSec = durationSec
        self.paceSPerMi = paceSPerMi
        self.avgHr = avgHr
        self.rows = rows
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.distanceMi = try c.decodeIfPresent(Double.self, forKey: .distanceMi) ?? 0
        self.durationSec = try? c.decodeIfPresent(Int.self, forKey: .durationSec)
        self.paceSPerMi = try c.decodeIfPresent(Double.self, forKey: .paceSPerMi)
        self.avgHr = try? c.decodeIfPresent(Int.self, forKey: .avgHr)
        self.rows = (try? c.decodeIfPresent([WatchCompletedRow].self, forKey: .rows)) ?? []
    }
}

/// The four glance objects on their own. Because JSONDecoder ignores keys
/// it was not asked for, this decodes straight out of the FULL
/// /api/watch/today body as well as out of a bridge payload carrying only
/// the glance — the iPhone relay can forward either without reshaping.
struct WatchTodayGlance: Codable {
    let weekStrip: WatchWeekStrip?
    let sessionMoved: WatchSessionMoved?
    let dayState: WatchDayState?
    let completedToday: WatchCompletedRun?

    var isEmpty: Bool {
        weekStrip == nil && sessionMoved == nil && dayState == nil && completedToday == nil
    }

    private enum CodingKeys: String, CodingKey {
        case weekStrip, sessionMoved, dayState, completedToday
    }

    init(weekStrip: WatchWeekStrip? = nil, sessionMoved: WatchSessionMoved? = nil,
         dayState: WatchDayState? = nil, completedToday: WatchCompletedRun? = nil) {
        self.weekStrip = weekStrip
        self.sessionMoved = sessionMoved
        self.dayState = dayState
        self.completedToday = completedToday
    }

    /// Never throws on the glance itself. Each object is read with `try?`:
    /// a shape this build does not understand reads as absent, which is
    /// exactly what every build before it saw.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.weekStrip = (try? c.decodeIfPresent(WatchWeekStrip.self, forKey: .weekStrip)) ?? nil
        self.sessionMoved = (try? c.decodeIfPresent(WatchSessionMoved.self, forKey: .sessionMoved)) ?? nil
        self.dayState = (try? c.decodeIfPresent(WatchDayState.self, forKey: .dayState)) ?? nil
        self.completedToday = (try? c.decodeIfPresent(WatchCompletedRun.self, forKey: .completedToday)) ?? nil
    }
}

/// The whole GET /api/watch/today body · either branch. `workout` and
/// `message` are mutually exclusive on the wire; the glance rides both.
///
/// The workout is decoded STRICTLY on purpose. A workout that fails to
/// decode has to surface (PhoneSync records it in lastSyncError — M-13 was
/// exactly that failure going silent); a glance object that fails to decode
/// must not, because the runner can still execute the session without it.
struct WatchTodayResponse: Codable {
    let workout: WatchWorkout?
    /// The flat line every deployed watch already renders on a rest /
    /// no-plan day. Unchanged, and still the fallback when `dayState` is
    /// absent.
    let message: String?
    let weekStrip: WatchWeekStrip?
    let sessionMoved: WatchSessionMoved?
    let dayState: WatchDayState?
    let completedToday: WatchCompletedRun?

    var glance: WatchTodayGlance {
        WatchTodayGlance(weekStrip: weekStrip, sessionMoved: sessionMoved,
                          dayState: dayState, completedToday: completedToday)
    }

    private enum CodingKeys: String, CodingKey {
        case workout, message, weekStrip, sessionMoved, dayState, completedToday
    }

    init(workout: WatchWorkout? = nil, message: String? = nil,
         weekStrip: WatchWeekStrip? = nil, sessionMoved: WatchSessionMoved? = nil,
         dayState: WatchDayState? = nil, completedToday: WatchCompletedRun? = nil) {
        self.workout = workout
        self.message = message
        self.weekStrip = weekStrip
        self.sessionMoved = sessionMoved
        self.dayState = dayState
        self.completedToday = completedToday
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.workout = try c.decodeIfPresent(WatchWorkout.self, forKey: .workout)
        self.message = try c.decodeIfPresent(String.self, forKey: .message)
        let g = try WatchTodayGlance(from: decoder)
        self.weekStrip = g.weekStrip
        self.sessionMoved = g.sessionMoved
        self.dayState = g.dayState
        self.completedToday = g.completedToday
    }
}

// MARK: - Outgoing · completion writeback (phase 6)

// MARK: - Tier 1 telemetry samples
//
// Per-phase pace + HR timelines, sampled every 5 seconds during each
// phase. Backend's `_raw` passthrough preserves them in
// `runs.data.splits[i]._raw` automatically; the typed `paceSamples` /
// `hrSamples` fields on WatchCompletionPhase below also surface them
// via `deriveSplitsFromPhases` for hot-path composer reads.
//
// Per agreement in:
//   designs/briefs/watch-tier-1-telemetry-swift-diff-2026-06-02.md
//   designs/briefs/backend-response-recap-engine-not-llm-2026-06-02.md
//   designs/briefs/watch-response-yes-to-raw-passthrough-2026-06-02.md
//   (backend ship 0489c791 · 2026-06-02)
// NOTE (RK-3 · 2026-06-09): PaceSample / HRSample / WatchCompletionPhase
// are now Codable (was Encodable) so the WorkoutEngine crash-recovery
// snapshot can persist banked per-phase results to UserDefaults and read
// them back after a relaunch. Decoding is synthesized; ENCODING is
// unchanged (still synthesized, same keys) — zero wire-format impact on
// the completion POST.
struct PaceSample: Codable {
    /// Seconds since the phase began (not since workout start).
    let tSec: Int
    /// Instantaneous pace at the sample instant, in seconds per mile.
    /// `nil` when GPS hadn't locked yet or pace couldn't be computed.
    let paceSPerMi: Int?
    /// Cumulative distance covered IN THIS PHASE at the sample instant,
    /// in miles. Anchored to phase start (phaseStartMi subtraction
    /// happens watch-side before assembly).
    let distMi: Double
}

struct HRSample: Codable {
    /// Seconds since the phase began.
    let tSec: Int
    /// Heart rate in beats per minute. `nil` when HR couldn't be read
    /// (sensor glitch, cold-start).
    let bpm: Int?
}

struct WatchCompletionPhase: Codable {
    let index: Int
    let type: String
    let label: String
    let targetPaceSPerMi: Int?
    /// TRUE per-rep average pace, computed from actualDistanceMi / actualDurationSec
    /// at phase end (not a snapshot of the instantaneous reading the moment
    /// the rep finished — which was the old behaviour and overstated by
    /// however much the runner kicked at the line).
    let actualPaceSPerMi: Int?
    let actualDurationSec: Int
    /// GPS-tracked distance covered DURING this phase. For a 1-mile rep this
    /// reads the watch's actual measurement (e.g. 1.02 mi) — separate from
    /// the planned phase.distanceMi which says 1.0.
    let actualDistanceMi: Double?
    /// True average HR across the phase (sum of every per-second sample
    /// divided by count), not the snapshot at phase end.
    let avgHr: Int?
    /// Peak HR observed during this phase.
    let maxHr: Int?
    /// Average cadence (steps/min) across the phase.
    let avgCadence: Int?
    let completed: Bool

    // ─── Tier 1 (2026-06-02) ────────────────────────────────────────
    /// 5-second pace timeline for the phase. `nil` for phases too
    /// short to produce a sample (<5 sec). Older builds ship `nil` —
    /// composers gate on field presence.
    var paceSamples: [PaceSample]? = nil

    /// 5-second HR timeline for the phase. `nil` when no samples
    /// landed (sensor never reported during the phase).
    var hrSamples: [HRSample]? = nil

    /// Seconds the runner was within target pace ±tolerance during
    /// this phase, derived watch-side from `paceSamples` and the
    /// phase's target/tolerance. Together with `actualDurationSec`
    /// gives time-in-tolerance percentage:
    ///   pct = timeInToleranceSec / actualDurationSec.
    /// `nil` for phases without a target pace (recovery jog, just-run).
    var timeInToleranceSec: Int? = nil

    /// Seconds outside the target band during this phase.
    /// `timeInToleranceSec + timeOutOfToleranceSec` ≈ duration of the
    /// portion of the phase that had pace samples available.
    /// `nil` for phases without a target.
    var timeOutOfToleranceSec: Int? = nil

    /// Honest per-phase verdict derived watch-side:
    ///   "hit"        ≥ 70% of phase within tolerance AND avg in band
    ///   "drifted"    avg in band but < 70% of phase within tolerance
    ///   "missed"     avg pace outside the tolerance band
    ///   "incomplete" user ended the phase early before reaching target
    /// `nil` for phases without a target pace (no band to compare against).
    var verdict: String? = nil

    // ─── Tier 2 (2026-06-02) · subjective per-rep RPE ───────────────
    /// Rate of Perceived Exertion the runner tapped on the post-rep
    /// prompt during the following recovery phase. 1-5 scale:
    ///   1 · easy · "I could do another 10 of these"
    ///   2 · light · comfortable, controlled
    ///   3 · moderate · the prescribed effort
    ///   4 · hard · honest threshold burn
    ///   5 · max · hanging on, couldn't sustain longer
    /// Only collected on `.work` phases. `nil` when the runner didn't
    /// answer (prompt auto-dismisses at 30 s) or when the phase wasn't
    /// a work rep. Backend `_raw` passthrough preserves these for
    /// composers gating on subjective effort vs. measured effort
    /// (e.g. "felt 5/5 but pace was hit" → red-flag fatigue signal).
    ///
    /// 2026-06-02 update · field SHAPE retained for backend composer
    /// typing; the visual capture prompt was reverted (see
    /// designs/briefs/watch-tier-2-rpe-rescinded-2026-06-02.md).
    /// Engine plumbing (pendingRpeResultsIndex, recordRpe, etc.) stays
    /// in WorkoutEngine ready to be re-hooked when the UI lands. Until
    /// then this field is always nil on the wire.
    var repRpe: Int? = nil

    /// Optional one-tap tag the runner picked alongside the RPE rating.
    /// Closed set:
    ///   "legs" · legs were the limit
    ///   "lungs" · breathing/cardio was the limit
    ///   "mind" · mental fatigue / focus
    ///   "pace" · the target pace itself felt off (too aggressive)
    /// `nil` when no tag was selected. See `repRpe` doc re: 2026-06-02
    /// visual rescission — field shape retained, capture UI pending.
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
    /// Total active calories burned during the run, from HK's
    /// HKLiveWorkoutBuilder activeEnergyBurned aggregate. Sent to the
    /// backend so resolveCalories() tier 1 uses this real number
    /// instead of the distance × weight × 1.04 × hr_multiplier
    /// estimator fallback. Optional · `nil` when HK didn't report any
    /// energy samples (e.g. very short run, sensor glitch).
    /// Doctrine: designs/briefs/iphone-calories-and-absorption-brief.md
    /// (2026-06-01).
    var kcal: Int? = nil
    let phases: [WatchCompletionPhase]
    /// Google-encoded polyline (precision 5), downsampled to ≤600 points.
    /// Sent so the watch completion row gets GPS immediately — no separate
    /// iPhone HK import hop required.  nil when GPS was unavailable (indoor,
    /// simulator, or <2 accurate fixes recorded).
    var routePolyline: String? = nil
    /// Total elevation GAIN in feet, summed from positive barometer-fused
    /// CLLocation.altitude deltas during the run (build 17x+). Sent so the
    /// watch row gets device-measured climb immediately — preferred over the
    /// coarse Open-Meteo polyline estimate (lib/runs/elev-from-gps.ts). nil
    /// when no valid vertical fixes were collected (indoor, simulator).
    var elevGainFt: Double? = nil

    // ── 0821 · the three wrist decisions (additive · 2026-08-21) ─────────
    //
    // The bail already rides the completion's rule outcomes. These are the
    // three decisions the runner could take on the wrist and the payload
    // had nowhere to put. Server side: web-v2/app/api/watch/workouts/
    // complete/route.ts (WatchCompletionBody.ceilingLift / repSkips /
    // recoveryExtensions).
    //
    // camelCase is not a style choice here. WatchCompletion is Encodable
    // with NO CodingKeys, so the wire IS these stored-property names — a
    // server reading route_polyline while Swift emitted routePolyline
    // silently dropped every GPS track for a day (6616d766). The CI gate
    // scripts/check-wire-keys.sh reads this struct's property names and
    // requires each to exist in web-v2, which is why these types are
    // NESTED here rather than declared beside it: the extractor walks this
    // struct's braces, so a nested field is watched and a sibling struct's
    // field is not.
    //
    // TWO CONTRACTS THESE SHAPES HOLD:
    //
    //  1 · A DECISION IS NOT A LAPSE, AND THE DATA SAYS SO. A phase's
    //      `completed == false` means "this rep did not happen" and says
    //      nothing about why — a rep the runner chose to skip and a rep
    //      that fell over when the watch died are the same value. So a
    //      skip is an EXPLICIT record, never a flag inferred from the
    //      phase array. "Was this chosen?" is answered by a field.
    //
    //  2 · EVERY DECISION CARRIES ITS OWN QUANTITIES. The phone owns the
    //      sentences; what has to arrive is every number they need — the
    //      reading AND the limit, never a delta ("ran to 174, the ceiling
    //      was 165", not "+9 over"); which rep and out of how many; how
    //      many extensions and between which reps.
    //
    // NOT carried: temperature. Nothing here has a thermometer — a run's
    // temperature is a weather model for a grid square and an hour bucket.
    // The phone gets that clause from the run row's own enrichment, and
    // drops it when it is absent. Sending it from the wrist would launder
    // a model into a reading.
    //
    // SEND ONLY WHAT EXISTS. All three are nil by default and the
    // synthesized Encodable emits nothing at all for a nil (encodeIfPresent
    // semantics), so an unremarkable run's payload is byte-identical to the
    // one it sent before this shipped. Never assign an EMPTY array: the
    // server merges onto runs.data, and `[]` would overwrite a sibling
    // payload's real value with nothing. Use the record… helpers below,
    // which only ever create an array by putting something in it.

    /// The HR ceiling was lifted FOR THE DAY. Singular by design: the board
    /// asks once and the answer holds for the rest of the run.
    struct CeilingLift: Encodable {
        /// The ceiling that was in force, bpm.
        let ceilingBpm: Int?
        /// What HR actually read at the moment it was lifted, bpm.
        let readingBpm: Int?
        let phaseIndex: Int?
        let phaseLabel: String?
        let atMi: Double?
        let atSec: Int?

        init(ceilingBpm: Int? = nil, readingBpm: Int? = nil,
             phaseIndex: Int? = nil, phaseLabel: String? = nil,
             atMi: Double? = nil, atSec: Int? = nil) {
            self.ceilingBpm = ceilingBpm
            self.readingBpm = readingBpm
            self.phaseIndex = phaseIndex
            self.phaseLabel = phaseLabel
            self.atMi = atMi
            self.atSec = atSec
        }
    }

    /// One rep the runner CHOSE to skip. Distinct from a phase carrying
    /// `completed == false`, which is every OTHER way a rep fails to happen.
    struct RepSkip: Encodable {
        /// 1-based · which rep was skipped ("the fourth rep").
        let repIndex: Int?
        /// How many reps the session asked for ("of six").
        let repCount: Int?
        /// How many were actually run ("Five of six"). nil when the watch
        /// does not know — the phone drops that half of the line rather
        /// than computing it.
        let repsCompleted: Int?
        let phaseIndex: Int?
        let phaseLabel: String?
        let atMi: Double?
        let atSec: Int?

        init(repIndex: Int? = nil, repCount: Int? = nil, repsCompleted: Int? = nil,
             phaseIndex: Int? = nil, phaseLabel: String? = nil,
             atMi: Double? = nil, atSec: Int? = nil) {
            self.repIndex = repIndex
            self.repCount = repCount
            self.repsCompleted = repsCompleted
            self.phaseIndex = phaseIndex
            self.phaseLabel = phaseLabel
            self.atMi = atMi
            self.atSec = atSec
        }
    }

    /// One recovery extension · one entry per +30 s, so the count is the
    /// array length ("Twice") and the boundaries are on the entries
    /// ("between reps two and four").
    struct RecoveryExtension: Encodable {
        /// 1-based · the rep just finished.
        let afterRepIndex: Int?
        /// 1-based · the rep it delayed.
        let beforeRepIndex: Int?
        let repCount: Int?
        /// Seconds THIS one extension added.
        let addedSec: Int?
        let phaseIndex: Int?
        let phaseLabel: String?
        let atSec: Int?

        init(afterRepIndex: Int? = nil, beforeRepIndex: Int? = nil,
             repCount: Int? = nil, addedSec: Int? = nil,
             phaseIndex: Int? = nil, phaseLabel: String? = nil, atSec: Int? = nil) {
            self.afterRepIndex = afterRepIndex
            self.beforeRepIndex = beforeRepIndex
            self.repCount = repCount
            self.addedSec = addedSec
            self.phaseIndex = phaseIndex
            self.phaseLabel = phaseLabel
            self.atSec = atSec
        }
    }

    /// nil unless the runner lifted the ceiling. Omitted from the wire when nil.
    var ceilingLift: CeilingLift? = nil
    /// nil unless at least one rep was skipped BY CHOICE. Never `[]` — see
    /// recordRepSkip.
    var repSkips: [RepSkip]? = nil
    /// nil unless at least one recovery was extended. Never `[]` — see
    /// recordRecoveryExtension.
    var recoveryExtensions: [RecoveryExtension]? = nil

    /// Append one skip, holding the wire contract: the field is either
    /// absent or a non-empty array. Assigning `[]` by hand would clobber a
    /// sibling payload's value on the server's jsonb merge.
    /// Contingency-rule outcomes — the bail, taken or declined.
    ///
    /// This field was MISSING until 2026-08-21, and the gap was invisible from
    /// both ends: the server has read `ruleOutcomes` since 2026-06-09 and
    /// `run-recap.ts` already distinguishes a taken bail from a declined one,
    /// while the engine detected breaches and offered the board. There was
    /// simply no Swift property in between, so every answer the runner gave
    /// died on the wrist. Nothing errored, nothing logged; the recap just
    /// never saw a bail.
    ///
    /// `nil` when no rule fired, never `[]` — the server merges onto a jsonb
    /// column and an empty array would clobber what a sibling payload wrote.
    var ruleOutcomes: [WorkoutEngine.RuleOutcome]? = nil

    /// Seconds the runner held the clock. The server declares `pausedSec` and
    /// only the treadmill ever sent it, so a watch run paused at a stoplight
    /// failed the clock audit: `accounted = totalSec + pausedSec + droppedGapSec`
    /// came up short by exactly the pause. nil rather than 0 when nothing was
    /// paused, so the field is absent on the wire like every other optional.
    var pausedSec: Int? = nil

    /// The server declares `movingSec` and has since before this file did —
    /// `complete/route.ts`'s "MOVING TIME IS WHAT PACE IS COMPUTED FROM"
    /// ruling (2026-08-21) reads `body.movingSec`, falling back to `totalSec`
    /// only when it is absent. No watch build has ever populated this key, so
    /// every watch run has always taken that fallback — silently, because the
    /// fallback exists and nothing looked wrong.
    ///
    /// It should not have needed a fallback. `totalDurationSec` (below) is
    /// NOT wall-clock elapsed — `WorkoutEngine.resume()` shifts `phaseStart`
    /// forward by every paused interval, manual or automatic, so the paused
    /// seconds were never in `totalElapsedSec` to begin with. The value this
    /// struct already sends as the run's duration IS its moving time; it was
    /// only ever missing under the key the ruling asks for by name. Send the
    /// same number twice rather than compute a second, competing total.
    var movingSec: Int? = nil

    /// Append one outcome. Creates the array only by putting something in it,
    /// so `[]` can never be assigned by accident.
    mutating func recordRuleOutcome(_ outcome: WorkoutEngine.RuleOutcome) {
        ruleOutcomes = (ruleOutcomes ?? []) + [outcome]
    }

    mutating func recordRepSkip(_ skip: RepSkip) {
        repSkips = (repSkips ?? []) + [skip]
    }

    /// Append one extension. Same contract as recordRepSkip.
    mutating func recordRecoveryExtension(_ ext: RecoveryExtension) {
        recoveryExtensions = (recoveryExtensions ?? []) + [ext]
    }
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
struct WatchFueling: Codable {
    let needed: Bool
    let gels: Int
    let atMins: [Int]
    let gPerHr: Int
    let totalCarbsG: Int
    let isRehearsal: Bool
    let heatAdjusted: Bool
    let shortLine: String
    let why: String

    /// Lenient Int decode (M-13) — server-computed gel math (gPerHr,
    /// atMins) can plausibly arrive fractional; a malformed fueling block
    /// must not fail the whole WatchWorkout decode chain. Encoding stays
    /// synthesized (unchanged on the wire).
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.needed = try c.decode(Bool.self, forKey: .needed)
        self.gels = try c.lenientInt(forKey: .gels)
        self.atMins = try c.lenientIntArray(forKey: .atMins)
        self.gPerHr = try c.lenientInt(forKey: .gPerHr)
        self.totalCarbsG = try c.lenientInt(forKey: .totalCarbsG)
        self.isRehearsal = try c.decode(Bool.self, forKey: .isRehearsal)
        self.heatAdjusted = try c.decode(Bool.self, forKey: .heatAdjusted)
        self.shortLine = try c.decode(String.self, forKey: .shortLine)
        self.why = try c.decode(String.self, forKey: .why)
    }
}

// MARK: - Readiness glance (watch-app.html §G · GET /api/watch/readiness)

/// The watch's slice of the phone's readiness read. Available any day
/// (rest/race/workout), unlike the workout payload. `score == nil` means the
/// read is suppressed (injured / no data) → the glance renders its empty state.
struct WatchReadiness: Codable {
    let score: Int?                 // 0–100, or nil when suppressed
    let state: String               // "green" | "yellow" | "red"
    let label: String               // "Primed" / "Hold easy" / "Back off"
    let recommendation: String      // plain-language coach line (may be "")
    let hrvMs: Int?                 // 7-day avg HRV
    let rhrBpm: Int?                // resting HR
    let suppressReason: String?     // present only when score is nil
    let nextRace: NextRace?

    struct NextRace: Codable {
        let name: String
        let slug: String
        let daysAway: Int

        init(name: String, slug: String, daysAway: Int) {
            self.name = name; self.slug = slug; self.daysAway = daysAway
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            self.name = try c.decode(String.self, forKey: .name)
            self.slug = try c.decode(String.self, forKey: .slug)
            self.daysAway = try c.lenientInt(forKey: .daysAway)
        }
    }

    init(score: Int?, state: String, label: String, recommendation: String,
         hrvMs: Int?, rhrBpm: Int?, suppressReason: String?, nextRace: NextRace?) {
        self.score = score
        self.state = state
        self.label = label
        self.recommendation = recommendation
        self.hrvMs = hrvMs
        self.rhrBpm = rhrBpm
        self.suppressReason = suppressReason
        self.nextRace = nextRace
    }

    /// Lenient Int decode (M-13) — readiness numerics come from the same
    /// server that shipped a fractional readinessScore. Encoding stays
    /// synthesized (unchanged on the wire).
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.score = c.lenientIntIfPresent(forKey: .score)
        self.state = try c.decode(String.self, forKey: .state)
        self.label = try c.decode(String.self, forKey: .label)
        self.recommendation = try c.decode(String.self, forKey: .recommendation)
        self.hrvMs = c.lenientIntIfPresent(forKey: .hrvMs)
        self.rhrBpm = c.lenientIntIfPresent(forKey: .rhrBpm)
        self.suppressReason = try c.decodeIfPresent(String.self, forKey: .suppressReason)
        self.nextRace = try c.decodeIfPresent(NextRace.self, forKey: .nextRace)
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
            // Far-future — RK-2 expiry parse now actually fires; a past date
            // here would flag the fixture stale and break -autostart drives.
            expiresAt: "2099-12-31T00:00:00Z",
            readinessScore: 82,
            readinessLabel: "Primed",
            distanceMi: 6.4,
            paceLabel: "T"
        )
    }

    /// Cruise Intervals · 4 × 1 mile reps — the structured workout the
    /// iOS app shows in the "Threshold · 4 × 1 MILE REPS" card. Mirrors
    /// what /api/watch/today will emit for that day:
    ///   · Warmup     1.8 mi @ easy (~ 8:12/mi)            · distance
    ///   · Rep 1      1.0 mi @ T-pace 6:47/mi              · distance
    ///   · Recovery 1 2:00     easy jog                    · time
    ///   · Rep 2      1.0 mi @ T-pace                      · distance
    ///   · Recovery 2 2:00                                  · time
    ///   · Rep 3      1.0 mi @ T-pace                      · distance
    ///   · Recovery 3 2:00                                  · time
    ///   · Rep 4      1.0 mi @ T-pace (no recovery after)  · distance
    ///   · Cooldown   1.2 mi @ easy                        · distance
    ///   = 7.0 work + ~0.6 jog = ~7.9 mi total
    /// Used to verify the engine + face router consume mixed distance/time
    /// reps correctly + advance through a 9-phase workout end to end.
    static var sampleCruise: WatchWorkout {
        var phases: [WatchPhase] = []
        var idx = 0
        func addDist(_ type: WatchPhaseType, _ label: String, mi: Double,
                     target: Int?, tol: Int?, durationSec: Int, haptic: WatchHaptic) {
            phases.append(WatchPhase(
                index: idx, type: type, label: label,
                durationSec: durationSec,
                targetPaceSPerMi: target, tolerancePaceSPerMi: tol,
                haptic: haptic, repUnit: .distance, distanceMi: mi))
            idx += 1
        }
        func addTime(_ type: WatchPhaseType, _ label: String, sec: Int,
                     target: Int?, tol: Int?, haptic: WatchHaptic) {
            phases.append(WatchPhase(
                index: idx, type: type, label: label,
                durationSec: sec,
                targetPaceSPerMi: target, tolerancePaceSPerMi: tol,
                haptic: haptic, repUnit: .time, distanceMi: nil))
            idx += 1
        }

        // Warmup — 1.8 mi at easy pace (~8:12/mi midpoint of 7:47-8:37 band).
        addDist(.warmup, "Warmup", mi: 1.8,
                target: 492, tol: 25, durationSec: 885,
                haptic: .start)
        // 4 work reps + 3 recoveries (no recovery after rep 4 — straight to CD).
        for n in 1...4 {
            addDist(.work, "Rep \(n)/4", mi: 1.0,
                    target: 407, tol: 8, durationSec: 407,
                    haptic: .transitionWork)
            if n < 4 {
                addTime(.recovery, "Recovery \(n)/4", sec: 120,
                        target: 540, tol: 30, haptic: .transitionRecovery)
            }
        }
        // Cooldown — 1.2 mi easy.
        addDist(.cooldown, "Cooldown", mi: 1.2,
                target: 492, tol: 25, durationSec: 590,
                haptic: .transitionCooldown)

        let total = phases.reduce(0) { $0 + $1.durationSec }
        return WatchWorkout(
            workoutId: "sample-cruise-intervals",
            name: "CRUISE INTERVALS",
            summary: "Threshold · 4 × 1 mile reps",
            totalEstimatedMinutes: total / 60,
            phases: phases,
            completionEndpoint: "/api/watch/workouts/complete",
            expiresAt: "2099-01-01T00:00:00Z",
            readinessScore: 78,
            readinessLabel: "Primed",
            distanceMi: 7.9,
            paceLabel: "T"
        )
    }

    /// Long run with an HM/M finish segment — the marquee marathon/HM session
    /// ("17 mi · last 9 @ HMP"). Two distance WORK phases; the SECOND is flagged
    /// `isFinishSegment` so the router shows the FINISH face (not the rep face)
    /// and the engine fires a "FINISH" boundary cue instead of "REP 2/2".
    /// Mirrors what /api/watch/today emits for a long-with-finish day:
    /// displayHint "pace", no HR ceiling (the easy build runs by feel · D1).
    /// Launch in the sim with `-face finish`.
    static var sampleLongFinish: WatchWorkout {
        let easy = WatchPhase(index: 0, type: .work, label: "8.0 mi easy",
                              durationSec: 8 * 480, targetPaceSPerMi: 480,
                              tolerancePaceSPerMi: 20, haptic: .start,
                              repUnit: .distance, distanceMi: 8.0)
        let finish = WatchPhase(index: 1, type: .work, label: "9.0 mi @ HM pace",
                                durationSec: 9 * 412, targetPaceSPerMi: 412,
                                tolerancePaceSPerMi: 12, haptic: .transitionWork,
                                repUnit: .distance, distanceMi: 9.0,
                                isFinishSegment: true)
        let total = easy.durationSec + finish.durationSec
        return WatchWorkout(
            workoutId: "sample-long-finish",
            name: "LONG · 9mi @ HM",
            summary: "17.0 mi · last 9 @ HM pace",
            totalEstimatedMinutes: total / 60,
            phases: [easy, finish],
            completionEndpoint: "/api/watch/workouts/complete",
            expiresAt: "2099-01-01T00:00:00Z",
            readinessScore: 80,
            readinessLabel: "Primed",
            distanceMi: 17.0,
            paceLabel: "L",
            displayHint: "pace"
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
            // Far-future — RK-2 expiry gate now really fires; must not be stale.
            expiresAt: "2099-12-31T00:00:00Z",
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
    /// "6:31" from 391 s/mi. Floors at 0:00 — negative inputs from GPS
    /// glitches or early-phase extrapolation must not produce "-1:-1".
    static func mmss(_ secondsPerMile: Int) -> String {
        let v = max(0, secondsPerMile)
        let m = v / 60
        let s = v % 60
        return "\(m):\(String(format: "%02d", s))"
    }

    /// "2:15" from 135 seconds (durations / elapsed clocks).
    static func clock(_ seconds: Int) -> String {
        // CLAMPED, as `mmss` already was. Without it a negative reads "0:-5":
        // the minute divides to zero and the remainder keeps its sign, so the
        // string is not merely wrong, it is malformed. Nothing feeds these a
        // negative today, and the two that could — an elapsed derived from a
        // clock that moved backwards, a delta against a goal — are exactly the
        // shapes that have gone negative in this engine before.
        let seconds = max(0, seconds)
        let m = seconds / 60
        let s = seconds % 60
        return "\(m):\(String(format: "%02d", s))"
    }

    /// "1:34" / "3:50" / "12:30" — h:mm past an hour, m:ss under. Seconds
    /// are dropped at the 1-hour mark: nobody scrutinises the seconds digit
    /// on an in-run elapsed read, and "1:12:30" clips the right edge on the
    /// Ultra's 208-pt aperture. (Was h:mm:ss; user flagged the clipping
    /// during the cooldown-overtime audit.)
    static func hms(_ seconds: Int) -> String {
        let seconds = max(0, seconds)
        let h = seconds / 3600
        let m = (seconds % 3600) / 60
        let s = seconds % 60
        if h > 0 { return "\(h):\(String(format: "%02d", m))" }
        return "\(m):\(String(format: "%02d", s))"
    }

    /// "3:50" — hours:minutes, for goal/projection at race scale.
    static func hm(_ seconds: Int) -> String {
        let seconds = max(0, seconds)
        let h = seconds / 3600
        let m = (seconds % 3600) / 60
        return "\(h):\(String(format: "%02d", m))"
    }

    // MARK: - Units-aware pace (2026-07-07 · units audit)
    //
    // `mmss(_:)` above is UNCHANGED — every existing call site keeps
    // formatting raw seconds-per-mile exactly as before (byte-safe for
    // every runner, since none has opted into km on the watch face yet;
    // the payload's `unitsDistance` only arrives once the phone re-pushes
    // after this build ships). This is an ADDITIVE overload for callers
    // that have a WatchWorkout.unitsDistance in scope and want the pace
    // string in the runner's preferred unit. Internal engine state
    // (tracker.paceSPerMi, phase.targetPaceSPerMi, pace-drift thresholds)
    // is NEVER converted — those stay seconds-per-mile everywhere in
    // WorkoutEngine/PaceDrift; only this final formatting step converts.

    /// mi→km factor. Kept local (not shared with the iPhone target — the
    /// watch app has no shared-module boundary with Faff/Util/Units.swift
    /// per docs/native/03-watchos-target-setup.md's "v0 duplication is
    /// fine" doctrine already governing this whole file).
    private static let milesPerKm = 0.621371

    /// "6:31/mi" or "4:03/km" from seconds-per-mile, unit-aware. `unitsPref`
    /// is the raw wire string from WatchWorkout.unitsDistance ("mi"/"km"/nil);
    /// anything other than exactly "km" renders as mi — same default as
    /// every payload before this field existed.
    static func mmssWithUnit(_ secondsPerMile: Int, unitsPref: String?) -> String {
        if unitsPref == "km" {
            let perKm = Double(max(0, secondsPerMile)) * milesPerKm
            let v = max(0, Int(perKm.rounded()))
            return "\(v / 60):\(String(format: "%02d", v % 60))/km"
        }
        return "\(mmss(secondsPerMile))/mi"
    }
}
