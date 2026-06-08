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

struct WatchPhase: Codable, Identifiable {
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
    /// Face display semantics (floor/ceiling/reference) are a face-level decision.
    let hrTargetBpm: Int?

    /// The backend payload omits `index` (the phases array is ordered
    /// and the watch walks it with a cursor).  We assign it during
    /// decode via WatchWorkout's custom init so each phase carries its
    /// own position for labels + completion reporting.
    init(index: Int, type: WatchPhaseType, label: String, durationSec: Int,
         targetPaceSPerMi: Int?, tolerancePaceSPerMi: Int?, haptic: WatchHaptic,
         repUnit: WatchRepUnit = .time, distanceMi: Double? = nil, hrTargetBpm: Int? = nil) {
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
    }

    private enum CodingKeys: String, CodingKey {
        case type, label, durationSec, targetPaceSPerMi, tolerancePaceSPerMi, haptic, repUnit, distanceMi, hrTargetBpm
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
    }
}

struct WatchWorkout: Codable {
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
    // Optional backend signal for which IN-RUN face flavour to render.
    // Recognised values (router falls back to phase-based defaults when nil
    // or unknown):
    //   · "hr"           → HRFace (HR is the hero, pace below as reference)
    //   · "progression"  → ProgressionFace (current step target + miles to next)
    //   · "strides"      → StridesFace (burst countdown + strip)
    // The phase-driven default rules (single-work-phase + target → EasyFace
    // etc.) still apply when this is nil, so older payloads keep working.
    let displayHint: String?

    private enum CodingKeys: String, CodingKey {
        case workoutId, name, summary, totalEstimatedMinutes, phases, completionEndpoint, expiresAt
        case readinessScore, readinessLabel, distanceMi, paceLabel
        case isRace, goalSec, strategyLabel, gelsMi, fueling, hrCeilingBpm
        case displayHint
    }

    init(workoutId: String, name: String, summary: String, totalEstimatedMinutes: Int,
         phases: [WatchPhase], completionEndpoint: String, expiresAt: String,
         readinessScore: Int? = nil, readinessLabel: String? = nil,
         distanceMi: Double? = nil, paceLabel: String? = nil,
         isRace: Bool = false, goalSec: Int? = nil, strategyLabel: String? = nil, gelsMi: [Double]? = nil,
         fueling: WatchFueling? = nil, hrCeilingBpm: Int? = nil,
         displayHint: String? = nil) {
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
        self.displayHint = displayHint
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
        // Re-stamp each phase with its cursor index. CRITICAL: pass through
        // repUnit + distanceMi too — earlier this constructor only carried
        // the first 7 fields forward, which silently dropped repUnit (→ .time)
        // and distanceMi (→ nil) on every phase after decode. That's the
        // bug behind yesterday's 5.8-mi long run overshooting to 6.0: the
        // engine fell through to time-based finish because the phase's
        // distanceMi was lost mid-decode. Same bug ate the distance count-
        // down. Round-trip smoke test in WatchFixtures · cruise-decode-
        // tomorrow caught it.
        let raw = try c.decode([WatchPhase].self, forKey: .phases)
        self.phases = raw.enumerated().map { (i, p) in
            WatchPhase(index: i, type: p.type, label: p.label, durationSec: p.durationSec,
                       targetPaceSPerMi: p.targetPaceSPerMi,
                       tolerancePaceSPerMi: p.tolerancePaceSPerMi, haptic: p.haptic,
                       repUnit: p.repUnit, distanceMi: p.distanceMi, hrTargetBpm: p.hrTargetBpm)
        }
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
struct PaceSample: Encodable {
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

struct HRSample: Encodable {
    /// Seconds since the phase began.
    let tSec: Int
    /// Heart rate in beats per minute. `nil` when HR couldn't be read
    /// (sensor glitch, cold-start).
    let bpm: Int?
}

struct WatchCompletionPhase: Encodable {
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
    /// "6:31" from 391 s/mi.
    static func mmss(_ secondsPerMile: Int) -> String {
        let m = secondsPerMile / 60
        let s = secondsPerMile % 60
        return "\(m):\(String(format: "%02d", s))"
    }

    /// "2:15" from 135 seconds (durations / elapsed clocks).
    static func clock(_ seconds: Int) -> String {
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
        let h = seconds / 3600
        let m = (seconds % 3600) / 60
        let s = seconds % 60
        if h > 0 { return "\(h):\(String(format: "%02d", m))" }
        return "\(m):\(String(format: "%02d", s))"
    }

    /// "3:50" — hours:minutes, for goal/projection at race scale.
    static func hm(_ seconds: Int) -> String {
        let h = seconds / 3600
        let m = (seconds % 3600) / 60
        return "\(h):\(String(format: "%02d", m))"
    }
}
