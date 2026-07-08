//
//  WorkoutEngine.swift
//  FaffWatch
//
//  The workout state machine (docs/native/01-watchos-scoping.md
//  §"Workout state machine on the watch"):
//
//      IDLE → WARMUP → INTERVAL[1..N] ⇄ RECOVERY → COOLDOWN → SUMMARY → IDLE
//
//  Forward-only · the user can skip a phase early ("End interval") but
//  never jump backward.  This is the UI-shell phase: a plain Timer
//  drives the clock.  Phase 4 swaps the timer for HKLiveWorkoutBuilder
//  sampling without changing this state surface — the views bind to
//  the published properties either way.
//

import Foundation
import Combine

@MainActor
final class WorkoutEngine: ObservableObject {

    enum State: Equatable {
        case idle
        case countingDown
        case running
        case finished
    }

    /// A brief full-screen flip the UI overlays at the edges of a rep —
    /// "Ease off · 3s left" before a work interval ends, "Go · Int 4" when
    /// the next work interval begins (watch-app.html §C3). Self-clearing.
    enum TransitionCue: Equatable {
        /// "0.25" / "10s" — value is the big read, "LEFT" is the small caption.
        /// Unit (mi vs s) is baked into the value when needed: "10s" reads as
        /// time, "0.25" without an "s" reads as distance.
        case headsUp(value: String)
        /// GO flash at the start of each work rep. Carries the rep label
        /// + target pace string — no "GO" wordmark on the face anymore;
        /// these two strings ARE the content.
        case go(rep: String, target: String)
        case phase(title: String, sub: String?)    // orange, race phase change
        case fuel(index: Int, total: Int)          // GEL · n of m takeover, persistent
        case split(mileNo: Int, paceSec: Int)      // MILE N · m:ss flash, every auto-lap
    }

    // MARK: Published surface (views bind to these)

    @Published private(set) var state: State = .idle
    @Published private(set) var currentIndex: Int = 0
    /// Whole seconds elapsed in the current phase.
    @Published private(set) var phaseElapsedSec: Int = 0
    /// Whole seconds elapsed across the whole workout.
    @Published private(set) var totalElapsedSec: Int = 0
    /// True while the run is paused (stoplights, water stops). The clock
    /// freezes and the tracked session pauses with it.
    @Published private(set) var isPaused = false
    /// 3 · 2 · 1 pre-roll value, shown by CountdownView while .countingDown.
    @Published private(set) var countdownValue = 0
    /// END-OF-PHASE countdown for time-based interval reps — live ticking
    /// 10 → 0 in the last ten seconds, beeped + tick'd every second so the
    /// runner can pace their effort to the count. nil whenever not in
    /// last-ten-seconds window. Used instead of a static "10s LEFT" flash
    /// for time-based reps; distance-based reps still use the .headsUp
    /// flash with "0.25 LEFT" since distance doesn't tick the same way.
    @Published private(set) var endingCountdownSec: Int? = nil
    /// True once every prescribed phase is done but the session is STILL
    /// recording — "overtime". The plan is complete (logged as such), yet we
    /// keep the clock + HKWorkoutSession running so the user can run farther or
    /// jog home and end on their own terms. Set instead of finishing.
    @Published private(set) var planComplete = false
    /// A transient transition flip; nil most of the time.
    @Published var transition: TransitionCue?

    /// Live pace-vs-target zone for the WORK screen (green/amber/red) and
    /// the signed delta in s/mi. Updated from the tracker's GPS pace.
    @Published private(set) var paceZone: PaceZone = .onTarget
    @Published private(set) var paceDeltaSPerMi: Int = 0
    /// True when live HR has crossed the easy ceiling for this workout
    /// (`workout.hrCeilingBpm`). The Easy face snaps the guardrail row to a
    /// red HR and holds it until HR drops back below the ceiling — so the
    /// "this isn't easy anymore" cue can't be swiped past like a banner.
    /// Always false on workouts that don't ship a ceiling.
    @Published private(set) var hrOverCeiling: Bool = false

    let workout: WatchWorkout

    /// The run recorder underneath the phase clock. Set by the root model
    /// before start(). When present, the engine records real metrics and
    /// folds them into the completion; when nil it degrades to the
    /// timer-only guide.
    var tracker: WorkoutTracker?
    private var driftEval: PaceDriftEvaluator?

    // MARK: Private timing state

    /// Debug time-warp factor — read at process start from env var
    /// `FAFF_TIME_WARP` or the `-warp <N>` launch argument. Multiplies the
    /// engine's perception of elapsed time so a 10-minute warmup completes
    /// in 20 real seconds at warp=30. Defaults to 1.0 (real time). Only
    /// active in sim/debug — production never sets it.
    static let warpFactor: Double = {
        let env = ProcessInfo.processInfo.environment["FAFF_TIME_WARP"]
        let args = ProcessInfo.processInfo.arguments
        let argVal: String? = {
            if let i = args.firstIndex(of: "-warp"), i + 1 < args.count { return args[i + 1] }
            return args.first(where: { $0.hasPrefix("-warp=") })?.dropFirst(6).description
        }()
        return Double(env ?? "") ?? Double(argVal ?? "") ?? 1.0
    }()

    /// Wall-clock seconds since the current phase started, scaled by the
    /// warp factor. ALL of the engine's elapsed/banked math goes through
    /// here — pause/resume's wall-clock `phaseStart` adjustments are
    /// applied separately and are NOT warped (real-time pause stays real).
    private func elapsedSincePhaseStart() -> Int {
        return Int(Date.now.timeIntervalSince(phaseStart) * Self.warpFactor)
    }

    private var ticker: Task<Void, Never>?
    private var countdownTask: Task<Void, Never>?
    private var transitionClear: Task<Void, Never>?
    // Internal (not private) so @testable tests can roll phaseStart
    // backward to simulate elapsed wall-clock time without real delays.
    var phaseStart: Date = .now
    /// Cumulative GPS distance (mi) at the moment the current phase began —
    /// lets a distance rep measure how far you've run *within* this rep.
    private var phaseStartMi: Double = 0
    private var workoutStart: Date = .now
    /// Index of every fuel mark we've already fired (don't double-fire if the
    /// engine ticks past the threshold more than once). Reset on start/reset.
    private var firedFuelIndices: Set<Int> = []
    /// When the current pause began (nil when running).
    private var pauseStart: Date?
    /// Wall-clock seconds already banked from completed phases (so the
    /// total clock survives the per-phase resets).
    private var bankedSec: Int = 0
    private var didFireAlmostDone = false
    /// Gel markers already cued (race mode), so each fires once.
    private var firedGels: Set<Int> = []
    /// Last mile boundary the runner has crossed (0 at start, 1 after first
    /// mile, etc). Increments by 1 on each integer-mile crossing, used to
    /// fire the MILE N · m:ss takeover. Crossings are distance-driven (not
    /// HK auto-lap events) so this works on the sim mock too.
    private var lastMileIndex: Int = 0
    /// Elapsed seconds at the moment of the last mile crossing — diffed
    /// against current `totalElapsedSec` to compute the banked split.
    private var lastMileElapsedSec: Int = 0

    /// Per-phase execution record, accumulated as the workout runs.
    /// `completed` flips to false when the user ends a phase early.
    private var results: [WatchCompletionPhase] = []

    // ─── Crash-recovery snapshot (RK-3 · 2026-06-09) ────────────────
    /// totalElapsedSec at the last cadence-driven snapshot write, so the
    /// tick path persists at most once per ~60s.
    private var lastSnapshotElapsedSec: Int = 0
    /// The workout payload encoded once per run (snapshots embed it so a
    /// recovered launch can rebuild the engine without PhoneSync state).
    private var workoutJSONCache: Data?

    /// Per-phase running aggregates — sampled once per tick (1 Hz) from the
    /// tracker. recordCurrentPhase() turns these into true averages on phase
    /// end (true average HR over the rep, peak HR, average cadence, etc).
    /// Reset on every advance() and at workout start.
    private var phaseHrSum: Int = 0
    private var phaseHrCount: Int = 0
    private var phaseHrMax: Int = 0
    private var phaseCadSum: Int = 0
    private var phaseCadCount: Int = 0

    // ─── Tier 1 telemetry buffers (2026-06-02) ──────────────────────
    // Per-phase 5-second pace + HR timelines, populated in tick() and
    // emitted in recordCurrentPhase(). Reset on every advance() with the
    // other phaseXxx aggregates. See WatchCompletionPhase for wire shape
    // and designs/briefs/watch-tier-1-telemetry-swift-diff-2026-06-02.md
    // for the rationale.
    private var phaseHrSamples: [HRSample] = []
    private var phasePaceSamples: [PaceSample] = []
    /// Last tSec we appended a sample for. Starts at -5 so the first
    /// tick of a phase (tSec >= 0) is always sampled. 5-sec gating
    /// happens against this value.
    private var phaseLastSampleSec: Int = -5

    // ─── Tier 2 RPE pending capture (2026-06-02) ────────────────────
    // Data-path scaffolding for per-rep RPE. The capture UI (RpeFace)
    // was reverted on 2026-06-02 — these vars + the API functions
    // below stay dormant, ready to be re-hooked when a new UI lands.
    // Until then, `pendingRpeResultsIndex` may briefly hold an index
    // after a work rep completes, but no view ever flips
    // `rpePromptVisible` true, so `recordRpe` is never called and the
    // model field stays nil on the wire. Backend composers typed
    // against `repRpe` / `repRpeTag` don't bitrot — they just don't
    // fire until the visual returns. See:
    //   designs/briefs/watch-tier-2-rpe-rescinded-2026-06-02.md
    /// When a `.work` phase ends, this is set to the index in the
    /// `results` array of that work phase. The next phase (typically
    /// `.recovery`) overlays an RPE prompt; on tap, `recordRpe(...)`
    /// patches the indexed entry. Cleared after capture, on dismiss,
    /// on 30-sec timeout, or when the next work rep starts.
    @Published private(set) var pendingRpeResultsIndex: Int? = nil
    /// True while the post-rep RPE prompt should overlay the current
    /// face. Views check this; true implies `pendingRpeResultsIndex`
    /// is set. Cleared by `recordRpe`, `dismissRpePrompt`, or auto-
    /// timeout (caller schedules dismiss via `flash`-style task).
    @Published private(set) var rpePromptVisible = false
    /// 30-sec auto-dismiss countdown task for the RPE prompt.
    private var rpeDismissTask: Task<Void, Never>?

    init(workout: WatchWorkout) {
        self.workout = workout
    }

    /// A frozen engine for visual-regression fixtures — exact state, no
    /// timers/tracker — so a face renders watch-app.html's canonical values
    /// and the diff measures LAYOUT, not live data.
    static func fixture(workout: WatchWorkout, currentIndex: Int, phaseElapsedSec: Int,
                        totalElapsedSec: Int, zone: PaceZone = .onTarget, deltaSPerMi: Int = 0) -> WorkoutEngine {
        let e = WorkoutEngine(workout: workout)
        e.state = .running
        e.currentIndex = currentIndex
        e.phaseElapsedSec = phaseElapsedSec
        e.totalElapsedSec = totalElapsedSec
        e.paceZone = zone
        e.paceDeltaSPerMi = deltaSPerMi
        return e
    }

    /// Test-only — freeze the ending countdown at a specific value so the
    /// `-face endcountdown` fixture renders mid-stream without a live tick.
    func setEndingCountdownFixture(_ n: Int) { endingCountdownSec = n }

    // MARK: Derived

    var currentPhase: WatchPhase? {
        guard workout.phases.indices.contains(currentIndex) else { return nil }
        return workout.phases[currentIndex]
    }

    var nextPhase: WatchPhase? {
        let n = currentIndex + 1
        guard workout.phases.indices.contains(n) else { return nil }
        return workout.phases[n]
    }

    /// True when the workout has exactly one `.work` phase — no OTHER rep to
    /// blend against or compete for attention with. Covers easy / long /
    /// recovery / "just run" sessions AND a single-rep tempo/threshold (both
    /// shapes expand to exactly one `.work` phase — expand-spec.ts). Mirrors
    /// ActiveWorkoutView's private `isSingleWorkSession(_:)` free function
    /// (face-routing decision) — kept as a SEPARATE computed property here
    /// rather than shared, because the engine needs it before any view
    /// exists: tick()'s mile-split gate uses it as ONE input (further
    /// narrowed by a tolerance check — see isEasyBandSingleWork in tick() —
    /// since "single work phase" alone doesn't distinguish an easy run from
    /// a one-rep tempo). The two isSingleWorkSession definitions (this one
    /// and ActiveWorkoutView's) must never drift: same predicate, same
    /// field.
    var isSingleWorkSession: Bool {
        workout.phases.filter { $0.type == .work }.count == 1
    }

    /// Distance (mi) covered within the current phase — for distance reps.
    var phaseCoveredMi: Double { max(0, coveredMi - phaseStartMi) }

    /// 0…1 progress through the current phase — by distance for a distance
    /// rep, otherwise by elapsed time.
    var phaseProgress: Double {
        guard let p = currentPhase else { return 0 }
        if p.repUnit == .distance, let d = p.distanceMi, d > 0 {
            return min(1, phaseCoveredMi / d)
        }
        guard p.durationSec > 0 else { return 0 }
        return min(1, Double(phaseElapsedSec) / Double(p.durationSec))
    }

    var phaseRemainingSec: Int {
        guard let p = currentPhase else { return 0 }
        return max(0, p.durationSec - phaseElapsedSec)
    }

    /// Miles left in the current phase · nil unless this is a distance rep.
    var phaseRemainingMi: Double? {
        guard let p = currentPhase, p.repUnit == .distance, let d = p.distanceMi else { return nil }
        return max(0, d - phaseCoveredMi)
    }

    // MARK: Race-derived (watch-app.html §F)

    var isRace: Bool { workout.isRace }

    /// Distance covered (GPS / tracked), in miles.
    private var coveredMi: Double { tracker?.distanceMi ?? 0 }

    /// Which guardrail row the easy face should show — 0 = HR, 1 = cadence.
    /// Flips every 60 s. Computed from totalElapsedSec (which the engine
    /// already publishes every second), not a per-view Timer publisher.
    ///
    /// History: the rotation lived as a @State + Timer.publish inside
    /// EasyFace itself. Every parent re-render (which happens once a
    /// second when HR / distance update) recreated the publisher AND
    /// reset its t=0, so 60 s of continuous existence was unreachable
    /// and the row never flipped. Hoisting the source-of-truth to the
    /// engine — which has a single stable tick — fixes it.
    var guardrailIdx: Int { (totalElapsedSec / 60) % 2 }

    /// Miles still to run.
    var distanceToGoMi: Double? {
        guard let total = workout.distanceMi else { return nil }
        return max(0, total - coveredMi)
    }

    /// Projected finish time (s), pace-of-the-day extrapolated to the full
    /// distance. Nil until enough distance has banked to be meaningful.
    var projectedFinishSec: Int? {
        guard let total = workout.distanceMi, coveredMi > 0.08 else { return nil }
        return Int(Double(totalElapsedSec) * total / coveredMi)
    }

    /// Seconds vs the goal (− = ahead of goal).
    var projectedDeltaSec: Int? {
        guard let proj = projectedFinishSec, let goal = workout.goalSec else { return nil }
        return proj - goal
    }

    /// The next gel marker and how far to it (mi).
    var nextGel: (number: Int, toGoMi: Double)? {
        guard let gels = workout.gelsMi else { return nil }
        for (i, mark) in gels.enumerated() where mark > coveredMi {
            return (i + 1, mark - coveredMi)
        }
        return nil
    }

    // MARK: Splits + session map (the on-demand pages)

    enum SplitState { case done, current, upcoming }

    struct Split: Identifiable {
        let id: Int            // phase index
        let repNo: Int         // 1-based work-rep ordinal
        let label: String
        let targetSPerMi: Int?
        let paceSPerMi: Int?   // banked (done) or live (current); nil upcoming
        let state: SplitState
    }

    /// One row per WORK interval: banked pace for finished reps, live pace
    /// for the current one, dash for the rest (watch-app.html §D · Splits).
    var splits: [Split] {
        let works = workout.phases.filter { $0.type == .work }
        return works.enumerated().map { (i, p) in
            if let r = results.first(where: { $0.index == p.index }) {
                return Split(id: p.index, repNo: i + 1, label: p.label,
                             targetSPerMi: p.targetPaceSPerMi, paceSPerMi: r.actualPaceSPerMi, state: .done)
            }
            if p.index == currentIndex {
                let live = (tracker?.paceSPerMi).flatMap { $0 > 0 ? $0 : nil }
                return Split(id: p.index, repNo: i + 1, label: p.label,
                             targetSPerMi: p.targetPaceSPerMi, paceSPerMi: live, state: .current)
            }
            return Split(id: p.index, repNo: i + 1, label: p.label,
                         targetSPerMi: p.targetPaceSPerMi, paceSPerMi: nil, state: .upcoming)
        }
    }

    /// Zone for a banked/live split pace vs its own target (for coloring
    /// the splits + session map without re-running the live evaluator).
    func zone(forPace pace: Int?, target: Int?) -> PaceZone {
        guard let pace, let target else { return .onTarget }
        let d = abs(pace - target)
        if d <= 10 { return .onTarget }
        if d <= 15 { return .drifting }
        return .offTarget
    }

    // MARK: Lifecycle

    /// Pre-roll 3 · 2 · 1 (each with a tick), then start for real. Gives
    /// the GPS a beat to lock so the first seconds aren't a panic.
    func beginCountdown() {
        guard state == .idle else { return }
        state = .countingDown
        countdownValue = 3
        Haptics.tick()
        // Start the recorder NOW so the workout session keeps the app
        // awake through the count (watchOS suspends an app with no active
        // session — that would freeze the countdown). The phase clock
        // doesn't begin until start() resets phaseStart below.
        tracker?.start()
        countdownTask?.cancel()
        countdownTask = Task { [weak self] in
            for n in [3, 2, 1] {
                guard let self, self.state == .countingDown else { return }
                self.countdownValue = n
                Haptics.tick()
                try? await Task.sleep(for: .seconds(1))
            }
            guard let self, self.state == .countingDown else { return }
            self.start()
        }
    }

    func start() {
        guard state == .idle || state == .countingDown else { return }
        state = .running
        currentIndex = 0
        phaseElapsedSec = 0
        totalElapsedSec = 0
        bankedSec = 0
        results = []
        didFireAlmostDone = false
        firedFuelIndices.removeAll()
        firedGels.removeAll()
        hrOverCeiling = false
        lastMileIndex = 0
        lastMileElapsedSec = 0
        planComplete = false
        workoutStart = .now
        phaseStart = .now
        phaseStartMi = coveredMi
        phaseHrSum = 0; phaseHrCount = 0; phaseHrMax = 0
        phaseCadSum = 0; phaseCadCount = 0
        phaseHrSamples = []; phasePaceSamples = []; phaseLastSampleSec = -5
        tracker?.start()
        prepDrift()
        // Recovery snapshot — write the first one as the run begins so a
        // crash in minute one is already covered, and refresh on every
        // phase transition + ~60s cadence from tick(). Cleared in finish().
        workoutJSONCache = try? JSONEncoder().encode(workout)
        lastSnapshotElapsedSec = 0
        persistSnapshot()
        // Start cue · haptic + chime if Sound is on. User reported no beep
        // at workout start — the chime was wired into flash() (mile splits,
        // fuel, etc.) but the start haptic only fired the haptic, never
        // the bell. The "we're rolling" moment deserves an audible mark.
        if let p = currentPhase { Haptics.play(p.haptic) }
        if UserDefaults.standard.bool(forKey: "audibleAlerts") {
            ChimePlayer.shared.play()
        }
        startTimer()
        saveSnapshot()
    }

    /// Arm a fresh pace-drift evaluator when the current phase is a WORK
    /// interval with a target pace; clear it otherwise.
    private func prepDrift() {
        if let p = currentPhase, p.type == .work, let target = p.targetPaceSPerMi {
            driftEval = PaceDriftEvaluator(targetPaceSPerMi: target, toleranceSPerMi: p.tolerancePaceSPerMi ?? 10)
            tracker?.mockCenterPace = target          // sim mock crosses this band
        } else {
            driftEval = nil
        }
        paceZone = .onTarget
        paceDeltaSPerMi = 0
    }

    /// User tapped "End interval" — bank the current phase as ended
    /// early and advance.
    func endCurrentPhase() {
        guard state == .running, !planComplete else { return }
        advance(completedCurrent: false)
    }

    /// User ended the run from the active screen. In overtime the plan is
    /// already done, so this is a normal "completed" finish; mid-plan it's an
    /// abandon.
    func abandon() {
        guard state == .running else { return }
        if planComplete { finish(status: "completed"); return }
        recordCurrentPhase(completed: false)
        finish(status: "abandoned")
    }

    /// Freeze the clock for a stoplight / water stop. Elapsed time and
    /// phase progress hold; the tracked session pauses with them.
    func pause() {
        guard state == .running, !isPaused else { return }
        isPaused = true
        pauseStart = .now
        transition = nil
        tracker?.pause()
        Haptics.play(.transitionCooldown)
        saveSnapshot()
    }

    /// Resume from a pause — shift the phase origin forward by the paused
    /// interval so the time off the clock never counts.
    ///
    /// `workoutStart` is deliberately NOT shifted (audit W-4, 2026-06-09):
    /// its only consumer is the completion's `startedAt`, which must be the
    /// real wall-clock start of the run — the old shift made a run paused
    /// 8 min post a startedAt 8 min late, corrupting the server-side run
    /// timestamp and straining HK-import dedup proximity. Elapsed math
    /// never read workoutStart (it runs on bankedSec + phaseStart).
    func resume() {
        guard state == .running, isPaused, let ps = pauseStart else { return }
        let delta = Date.now.timeIntervalSince(ps)
        phaseStart = phaseStart.addingTimeInterval(delta)
        pauseStart = nil
        isPaused = false
        tracker?.resume()
        Haptics.play(.transitionWork)
        saveSnapshot()
    }

    func reset() {
        stopTimer()
        Self.clearSnapshot()
        countdownTask?.cancel(); countdownTask = nil
        transitionClear?.cancel(); transitionClear = nil
        // Defensive — finish() already clears, but a reset from any other
        // path (user bailed during countdown, etc.) must not leave a stale
        // snapshot behind to mislabel a future recovery.
        Self.clearSnapshot()
        state = .idle
        currentIndex = 0
        phaseElapsedSec = 0
        totalElapsedSec = 0
        bankedSec = 0
        results = []
        didFireAlmostDone = false
        firedGels = []
        planComplete = false
        isPaused = false
        pauseStart = nil
        countdownValue = 0
        transition = nil
        completion = nil
    }

    /// Show a transition flip. `persistent: true` keeps the cue on screen
    /// until the runner swipes it away (`dismissTransition()`); everything
    /// else auto-clears after `seconds`.
    ///
    /// TRAINING fuel cues are persistent — a missed gel is the difference
    /// between hitting the plan and bonking, so the alert can't time out
    /// while you fumble for your gel. RACE gel cues auto-clear (audit W-2,
    /// 2026-06-09): mid-race the pace face is the priority read, and the
    /// old code's `if case .fuel` early-return silently overrode the race
    /// call site's auto-clear duration — at mile 20 the takeover hid live
    /// pace until a deliberate swipe landed. Swipe-dismiss still works
    /// during the visible window for both kinds.
    private func flash(_ cue: TransitionCue, for seconds: Double, persistent: Bool = false) {
        transition = cue
        transitionClear?.cancel()
        // Audible "ding" on top of whatever haptic the caller already fired,
        // if the runner has toggled Sound on (Controls page, blue button).
        // Covers EVERY transition: mile-split, fuel, go, heads-up, phase
        // change. Honest "if the watch isn't silent, you'll hear it" feedback.
        if UserDefaults.standard.bool(forKey: "audibleAlerts") {
            Haptics.chime()
        }
        if persistent { return }
        transitionClear = Task { [weak self] in
            try? await Task.sleep(for: .seconds(seconds))
            guard let self, self.transition == cue else { return }
            self.transition = nil
        }
    }

    /// Acknowledge / dismiss the current transition. Used by the UI for the
    /// persistent fuel cue (the runner swipes it away once they've taken
    /// the gel). Safe to call any time — clears whatever is currently up.
    func dismissTransition() {
        transitionClear?.cancel()
        transitionClear = nil
        transition = nil
    }

    /// Format a remaining-miles distance for the heads-up cue. Two decimals
    /// down to 0.1 (e.g. 0.25), one decimal at 0.1+, "0.05" floor when very
    /// close. Trailing zeros stripped so 0.20 reads "0.2".
    private func formatMiRemaining(_ mi: Double) -> String {
        if mi < 0.1 { return String(format: "%.2f", mi) }
        let s = String(format: "%.2f", mi)
        // strip trailing zero ("0.20" → "0.2") but keep "0.25" as-is
        if s.hasSuffix("0") { return String(s.dropLast()) }
        return s
    }

    // MARK: Timer tick

    private func startTimer() {
        stopTimer()
        // A main-actor Task loop rather than a Timer: the closure inherits
        // this class's @MainActor isolation, so tick() stays on the main
        // actor (no Swift 6 concurrency warning), and Task.sleep keeps the
        // clock ticking without blocking the run loop.
        //
        // 1 Hz, not 250 ms (audit W-1, 2026-06-09). The clock is wall-clock
        // anchored (elapsedSincePhaseStart), so a slower tick can't drift —
        // and GPS/HR sources update at ~1 Hz anyway. At 250 ms every tick
        // re-assigned @Published vars (willSet fires even on equal values),
        // so the whole face tree re-rendered 4×/s for the entire workout.
        // Combined with the changed-value guards in tick(), this cuts
        // render churn ~4× over a 3.5 h race.
        ticker = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                guard let self else { return }
                self.tick()
            }
        }
    }

    private func stopTimer() {
        ticker?.cancel()
        ticker = nil
    }

    // Internal so tests can call it directly after rolling `phaseStart`
    // backward to simulate elapsed time. Production callers reach it via
    // the Task loop in `startTimer()`.
    /// Assign only when the value actually changed — @Published fires
    /// objectWillChange on every write (willSet), equal or not, so
    /// unconditional assigns re-render every observing face per tick.
    private func publishElapsed(_ phaseSec: Int) {
        if phaseElapsedSec != phaseSec { phaseElapsedSec = phaseSec }
        let total = bankedSec + phaseSec
        if totalElapsedSec != total { totalElapsedSec = total }
    }

    func tick() {
        guard state == .running, !isPaused else { return }

        // P2-53 · HR staleness watchdog — polled every tick (1 Hz) so it
        // can never drift from the phase clock it's gating. Runs BEFORE any
        // phase-aggregate read below, so a stale tick's zeroed heartRate is
        // what phaseHrSum/phaseHrCount/hrOverCeiling/the Tier-1 HR sample
        // all see — a dropped-then-recovered band can never contribute a
        // frozen reading into an average or a ceiling alert. Also runs
        // during overtime (below), where HR staying honest matters just as
        // much even though there's no phase to record it into.
        tracker?.checkHrStaleness()

        // Overtime: plan is done, but keep the clock + live metrics running.
        // No phase logic — the user runs free until they End.
        if planComplete {
            publishElapsed(elapsedSincePhaseStart())
            snapshotIfDue()
            return
        }

        guard let phase = currentPhase else { return }

        publishElapsed(elapsedSincePhaseStart())
        snapshotIfDue()

        // Sample per-phase aggregates from the tracker once per tick (1 Hz).
        // recordCurrentPhase() turns these into true averages on phase end.
        if let hr = tracker?.heartRate, hr > 0 {
            phaseHrSum += hr
            phaseHrCount += 1
            phaseHrMax = max(phaseHrMax, hr)
        }
        if let cad = tracker?.cadence, cad > 0 {
            phaseCadSum += cad
            phaseCadCount += 1
        }

        // Tier 1 timeline samples (5-second cadence). The aggregates
        // above give true averages; these arrays preserve the shape of
        // the rep so recap composers can detect drift, sandbagging,
        // surges, recovery rate, etc. tSec is relative to phase start
        // (not workout start) so each phase is a self-contained timeline.
        if phaseElapsedSec - phaseLastSampleSec >= 5 {
            phaseLastSampleSec = phaseElapsedSec
            let pace = tracker?.paceSPerMi ?? 0
            phasePaceSamples.append(PaceSample(
                tSec: phaseElapsedSec,
                paceSPerMi: pace > 0 ? pace : nil,
                distMi: phaseCoveredMi
            ))
            let hr = tracker?.heartRate ?? 0
            phaseHrSamples.append(HRSample(
                tSec: phaseElapsedSec,
                bpm: hr > 0 ? hr : nil
            ))
        }

        // HR-ceiling alert (easy/Z2/heat). When the plan ships a ceiling and
        // live HR exceeds it, flip the flag; the Easy face owns the visual
        // snap-to-red and hold-until-recovered behaviour. Cleared as soon as
        // HR drops back below the ceiling so the alert is honest, not sticky.
        if let ceiling = workout.hrCeilingBpm, ceiling > 0 {
            let hr = tracker?.heartRate ?? 0
            let over = hr > ceiling
            if hrOverCeiling != over { hrOverCeiling = over }
        } else if hrOverCeiling {
            hrOverCeiling = false
        }

        // Fuel cues — fire a notification haptic + a full-screen "Fuel now"
        // flip when elapsed crosses each gel mark from the prescribed plan
        // (lib/training-fueling.ts on the backend). Idempotent per index, so
        // a slow tick doesn't double-fire.
        // Time-anchored fueling — the canonical path for TRAINING runs.
        // Doctrine: gels every ~30 min based on glycogen depletion at
        // endurance pace (Research/18 §1). Calories burned ≈ rate × time,
        // so a slow runner at 30 min elapsed and a fast runner at 30 min
        // elapsed are in roughly the same depletion state — they should
        // fuel at the same elapsed time, not the same mile. Mile-anchoring
        // would DELAY the cue for a slow runner, increasing bonk risk.
        // Race day uses workout.gelsMi (literal aid-station positions) —
        // see the distance-anchored block below; the two paths coexist.
        if let fueling = workout.fueling, fueling.needed, !isRace {
            let mins = totalElapsedSec / 60
            for (i, mark) in fueling.atMins.enumerated() {
                if mins >= mark && !firedFuelIndices.contains(i) {
                    firedFuelIndices.insert(i)
                    // Cue carries the index + total directly. FuelFace
                    // renders GEL (big) · n of m (big). Persists until
                    // swiped down — see flash() and dismissTransition().
                    let total = max(fueling.gels, fueling.atMins.count)
                    Haptics.play(.transitionCooldown)
                    flash(.fuel(index: i + 1, total: total), for: 5, persistent: true)
                }
            }
        }

        // Live pace-drift on WORK intervals — color the pace + fire a
        // single sustained-drift cue. Driven by the tracker's GPS pace.
        if phase.type == .work, let pace = tracker?.paceSPerMi, pace > 0 {
            let r = driftEval?.update(currentPaceSPerMi: pace)
            if let r {
                if paceZone != r.zone { paceZone = r.zone }
                if paceDeltaSPerMi != r.deltaSPerMi { paceDeltaSPerMi = r.deltaSPerMi }
                if r.fireHaptic { Haptics.almostDone() }
            }
        }

        // End-of-phase cue — two flavours depending on what's being measured:
        //
        //   · DISTANCE-based phases (single-phase long run + distance interval
        //     reps) get a one-shot .headsUp flash with the remaining miles
        //     ("0.25 LEFT"). Static, auto-dismisses after 2.6 s. GPS jitter
        //     on the hundredths column makes a live count unstable, so the
        //     flash pattern is right here.
        //
        //   · TIME-based interval reps get a LIVE countdown — the engine
        //     publishes endingCountdownSec each second from 10 → 0, with a
        //     tick haptic + chime on every decrement. The runner can pace
        //     their effort to the count. No static "10s LEFT" flash — the
        //     live countdown replaces it.
        let isSinglePhaseDistanceRun =
            workout.phases.count == 1 && workout.distanceMi != nil

        // Static heads-up flash (distance-based only).
        let nearEnd: Bool
        let headsUpValue: String
        if isSinglePhaseDistanceRun, let total = workout.distanceMi {
            let remaining = max(0, total - coveredMi)
            nearEnd = remaining > 0 && remaining <= 0.25
            headsUpValue = formatMiRemaining(remaining)
        } else if phase.repUnit == .distance {
            let remaining = phaseRemainingMi ?? 1
            nearEnd = remaining <= 0.03 && phaseProgress < 1
            headsUpValue = formatMiRemaining(remaining)
        } else {
            nearEnd = false       // time-based: handled by live countdown below
            headsUpValue = ""
        }
        let shouldFire = !isRace && !didFireAlmostDone && nearEnd &&
            (isSinglePhaseDistanceRun || phase.type == .work)
        if shouldFire {
            didFireAlmostDone = true
            Haptics.almostDone()
            flash(.headsUp(value: headsUpValue), for: 2.6)
        }

        // Live ending countdown (time-based reps). Fires for BOTH work
        // reps (next: GO into the next rep) and recovery reps (next: GO
        // into the next work rep), since the runner needs the heads-up
        // in either direction. Race phase boundaries are out (they're
        // terrain markers, not rep ends).
        let isTimeRep = phase.repUnit == .time && !isRace &&
            (phase.type == .work || phase.type == .recovery)
        if isTimeRep && phaseRemainingSec > 0 && phaseRemainingSec <= 10 {
            // Fire tick + chime ONCE per second-decrement (the engine ticks
            // every 1 s, so any tick that lands inside this window sees a
            // new phaseRemainingSec value vs what we last published).
            if endingCountdownSec != phaseRemainingSec {
                endingCountdownSec = phaseRemainingSec
                if phaseRemainingSec == 1 {
                    // Final beat — stronger haptic (.notification, the
                    // double-buzz "alert" pattern) so the runner feels
                    // the cliff edge clearly. Chime fires too if Sound
                    // is on. Then the next tick advances the phase and
                    // the countdown clears — runner jumps straight from
                    // "1" to GO / Rest face, never sees "0".
                    Haptics.almostDone()
                } else {
                    Haptics.tick()
                }
                if UserDefaults.standard.bool(forKey: "audibleAlerts") {
                    ChimePlayer.shared.play()
                }
            }
        } else if endingCountdownSec != nil {
            endingCountdownSec = nil
        }

        // MILE SPLIT takeover — at every integer-mile crossing, fire a brief
        // "MILE N · m:ss" overlay with the banked split (time spent on the
        // mile we just finished). Distance-crossing based (not HK auto-lap
        // events) so it works on the sim mock and any future tracker too.
        // Paused minutes naturally don't count because totalElapsedSec is
        // paused-corrected.
        //
        // GATED to "not a structured work rep" — during ONE rep of a
        // multi-rep session (intervals/threshold/tempo blocks) the runner is
        // focused on hitting THIS rep's target pace; the global "MILE 2 ·
        // 6:47" takeover is noise (and a 6s view-blocker — they'd lose pace
        // feedback mid-rep). The rep's own pace + distance-remaining are
        // already on the WorkIntervalFace. David flagged this in tomorrow's
        // preflight (2026-06-02).
        //
        // P1-28 fix (2026-07-07) · the ORIGINAL gate (`phase.type != .work`)
        // meant to keep warmup/cooldown/recovery/just-run getting splits —
        // those are where mile pace is the highest-value read — but the
        // backend expands EVERY easy/long/recovery/just-run session as a
        // single `type:'work'` phase for its entire duration (expand-spec.ts
        // expandEasy/expandRecovery/plain-long, WatchWorkoutModels.makeJustRun),
        // so the old gate suppressed the takeover for exactly those runs,
        // start to finish.
        //
        // Correct gate needs to distinguish "single-work-phase EASY-BAND
        // session" (easy/long/recovery/just-run — audit's named list) from
        // "single-work-phase QUALITY rep" (a one-rep tempo/threshold — also
        // isSingleWorkSession==true, since it too has exactly one `.work`
        // phase, but it's still the SAME kind of focused rep the original
        // gate was protecting; the audit's P1-28 finding does not name
        // tempo). isSingleWorkSession alone can't tell these apart — both
        // shapes have phases.filter{.work}.count == 1. The distinguishing
        // signal available on-watch: tolerance band width. build-workout.ts
        // ships 8 s/mi for threshold/intervals, 12 for tempo/race, 20 for
        // everything else (easy/long/recovery default) — a tight tolerance
        // (<=15, comfortably between the 12 quality ceiling and the 20 easy
        // floor) means "this is a quality rep even though it's the only
        // work phase," so splits stay suppressed there exactly like a REP
        // in a multi-rep set. A nil target (just-run) or wide/nil tolerance
        // (easy/long/recovery) allows the takeover.
        let isEasyBandSingleWork: Bool = {
            guard isSingleWorkSession, let work = workout.phases.first(where: { $0.type == .work }) else { return false }
            guard let target = work.targetPaceSPerMi, target > 0 else { return true }   // just-run: no target at all
            let tol = work.tolerancePaceSPerMi ?? 20
            return tol > 15
        }()
        // Long-with-finish easy build (two `.work` phases, but the build
        // "runs by feel" exactly like a plain long run — see isLongWithFinish
        // face routing in ActiveWorkoutView — while the finish segment
        // itself keeps the focused pace-read behaviour).
        let isLongBuildPhase = currentPhase?.type == .work
            && currentPhase?.isFinishSegment == false
            && workout.phases.contains { $0.isFinishSegment }
        let mileIndex = Int(coveredMi)
        let allowSplitFlash = currentPhase?.type != .work || isEasyBandSingleWork || isLongBuildPhase
        if allowSplitFlash, mileIndex > lastMileIndex {
            // If GPS jumps multiple integers in one tick (rare, e.g. a sim
            // teleport), we only flash the most-recent mile rather than
            // queuing several — the runner can't process N flashes anyway.
            let lapSec = max(1, totalElapsedSec - lastMileElapsedSec)
            lastMileElapsedSec = totalElapsedSec
            lastMileIndex = mileIndex
            Haptics.play(.transitionWork)
            flash(.split(mileNo: mileIndex, paceSec: lapSec), for: 6.0)
        } else if mileIndex > lastMileIndex {
            // Suppressed the flash, but still advance the mile bookkeeping
            // so the NEXT split (when we leave the work phase) reads the
            // correct mile number and the correct banked split duration.
            lastMileElapsedSec = totalElapsedSec
            lastMileIndex = mileIndex
        }

        // Distance-anchored gel cue — RACE DAY ONLY. workout.gelsMi[]
        // carries literal aid-station mile markers from the course plan
        // (not a derived "every 30 min" approximation), so firing by GPS
        // distance matches what the race actually serves. Training runs
        // use the time-anchored path above instead — see doctrine note.
        if isRace, let gels = workout.gelsMi, !gels.isEmpty {
            for (i, mark) in gels.enumerated() where coveredMi >= mark && !firedGels.contains(i) {
                firedGels.insert(i)
                Haptics.almostDone()
                // Auto-clears (6 s, generous but bounded) — mid-race the
                // pace face must come back on its own; see flash() doc.
                flash(.fuel(index: i + 1, total: gels.count), for: 6)
                saveSnapshot()
            }
        }

        // Single-phase distance workouts (easy/long/steady run): the
        // canonical "done" is the WORKOUT distance, not the phase. This
        // shields us from a stale or partial payload where the phase
        // lost repUnit/distanceMi but the workout-level distanceMi is
        // still correct. User reported: plan 5.8 mi, watch flipped to
        // overtime at 6.0 mi — that was the time-based fallback firing
        // late because the runner was faster than the projected pace.
        //
        // P2-56 fix (2026-07-07) · a runner who denied HealthKit access
        // (or whose session failed to start — start()'s catch block leaves
        // `session`/`builder` nil, so tracker.distanceMi never moves off 0)
        // used to be stuck forever on a distance phase: coveredMi/
        // phaseCoveredMi both read 0 permanently, so neither distance
        // branch below EVER completes, and — unlike a time-based rep —
        // there was no `else` fallback for a distance-typed phase to fall
        // through to. `noDistanceSource` distinguishes "distance genuinely
        // has no source" from "distance is progressing normally but hasn't
        // reached the target yet": the phase's own durationSec is already
        // carried as a TIME ESTIMATE for every distance rep (see WatchPhase
        // doc), so at 1.5× that estimate with essentially zero distance
        // banked, GPS/HK has had every reasonable chance to report SOME
        // movement — fall back to time so the run advances instead of
        // hanging. 0.05 mi is the same "meaningful distance" floor
        // recordCurrentPhase() already uses elsewhere in this file.
        let noDistanceSource = phaseCoveredMi < 0.05
            && phaseElapsedSec >= Int(Double(max(phase.durationSec, 60)) * 1.5)
        if noDistanceSource { tracker?.markDistanceSourceUnavailable() }
        let finished: Bool
        if isSinglePhaseDistanceRun, let total = workout.distanceMi {
            finished = coveredMi >= total || noDistanceSource
        } else if phase.repUnit == .distance, let d = phase.distanceMi {
            finished = phaseCoveredMi >= d || noDistanceSource
        } else {
            finished = phaseElapsedSec >= phase.durationSec
        }
        if finished {
            advance(completedCurrent: true)
        }
    }

    // MARK: State transitions

    private func advance(completedCurrent: Bool) {
        // If an RPE prompt was still showing from a prior work rep when
        // we advance into a new phase, treat it as dismissed. Any later
        // recordCurrentPhase that completes a work rep will re-queue
        // its own pending RPE index. Dismiss BEFORE recordCurrentPhase
        // so the index it sets doesn't get cleared.
        if rpePromptVisible { dismissRpePrompt() }
        recordCurrentPhase(completed: completedCurrent)

        // Bank the wall-clock time actually spent in the phase we're
        // leaving (honest even when the user skipped early). Warped so
        // banked + per-phase elapsed stay consistent under time-warp.
        bankedSec += elapsedSincePhaseStart()

        if currentIndex + 1 >= workout.phases.count {
            // Plan done — do NOT stop. Enter overtime: the workout is complete,
            // but keep the clock + session recording so the user can keep
            // running and End when ready (see endCurrentPhase/abandon + tick).
            planComplete = true
            phaseStart = .now
            phaseElapsedSec = 0
            didFireAlmostDone = false
            phaseHrSum = 0; phaseHrCount = 0; phaseHrMax = 0
            phaseCadSum = 0; phaseCadCount = 0
            driftEval = nil
            paceZone = .onTarget
            paceDeltaSPerMi = 0
            // Snapshot the plan-done state (results now hold every phase) so
            // a crash during overtime still recovers a complete run.
            persistSnapshot()
            Haptics.play(.end)
            // No takeover face for plan-done — the live face already
            // signals overtime by flipping the distance row to .bonus
            // purple + counting up, and Haptics.play(.end) just fired
            // above. The extra full-screen wordmark flash was clutter.
            saveSnapshot()
            return
        }

        currentIndex += 1
        phaseStart = .now
        phaseStartMi = coveredMi
        phaseElapsedSec = 0
        totalElapsedSec = bankedSec
        didFireAlmostDone = false
        // Reset per-phase aggregates so the next rep starts clean.
        phaseHrSum = 0; phaseHrCount = 0; phaseHrMax = 0
        phaseCadSum = 0; phaseCadCount = 0
        phaseHrSamples = []; phasePaceSamples = []; phaseLastSampleSec = -5
        prepDrift()
        // Phase boundary — refresh the recovery snapshot (the just-banked
        // phase's result is the data a crash must not lose).
        persistSnapshot()
        if let p = currentPhase {
            Haptics.play(p.haptic)
            if isRace {
                // Race: a phase boundary is a new course segment — orange
                // flip with the new target + a two-word cue.
                let sub = p.targetPaceSPerMi.map { "\(PaceFormat.mmss($0))/mi · hold effort" }
                flash(.phase(title: p.label, sub: sub), for: 1.8)
            } else if p.isFinishSegment {
                // Long-run HM/M finish: announce the lift to race pace, NOT
                // "REP n/m". Reuses the .phase takeover (PhaseChangeFace) —
                // title uppercases to "FINISH"; sub carries the segment + pace.
                let target = p.targetPaceSPerMi.map { "\(PaceFormat.mmss($0))/mi" } ?? "—:—"
                flash(.phase(title: "Finish", sub: "\(p.label) · \(target)"), for: 2.2)
            } else if p.type == .work {
                // Entering a work rep — brief 1.5 s GO card. Two reads:
                // which rep ("REP 2 / 4") + target pace ("6:47"). No
                // "GO" wordmark on the face — the takeover IS the cue.
                let totalWorks = workout.phases.filter { $0.type == .work }.count
                let n = workout.phases.prefix(currentIndex + 1).filter { $0.type == .work }.count
                let target = p.targetPaceSPerMi.map { PaceFormat.mmss($0) } ?? "—:—"
                flash(.go(rep: "REP \(n) / \(totalWorks)", target: target), for: 1.5)
            }
        }
        // Tier 2 RPE prompt — if a pending RPE was queued by the prior
        // work rep's recordCurrentPhase, and we're now landing in a
        // non-work phase (recovery / cooldown), surface the prompt.
        // 30-sec auto-dismiss starts inside `showRpePromptIfPending()`.
        // 2026-06-02: visual was rescinded; this still fires but no
        // view observes rpePromptVisible — see brief above.
        if pendingRpeResultsIndex != nil, currentPhase?.type != .work {
            showRpePromptIfPending()
        }
        saveSnapshot()
    }

    private func recordCurrentPhase(completed: Bool) {
        guard let p = currentPhase else { return }
        let actual = elapsedSincePhaseStart()
        // True averages from the per-tick samples, not the instantaneous
        // snapshot at the moment the phase ended.
        let distMi = phaseCoveredMi
        let avgPace: Int? = {
            // Average pace = total seconds / total miles for the phase.
            // Need at least ~30 m of distance to avoid garbage from a phase
            // that barely got any GPS lock (e.g. recoveries).
            guard distMi > 0.02, actual > 0 else { return nil }
            return Int((Double(actual) / distMi).rounded())
        }()
        let avgHr: Int? = phaseHrCount > 0
            ? Int((Double(phaseHrSum) / Double(phaseHrCount)).rounded())
            : nil
        let maxHr: Int? = phaseHrMax > 0 ? phaseHrMax : nil
        let avgCad: Int? = phaseCadCount > 0
            ? Int((Double(phaseCadSum) / Double(phaseCadCount)).rounded())
            : nil

        // ── Tier 1 derivations ──────────────────────────────────────
        // time-in-tolerance: each 5-sec sample represents the band the
        // runner was in over the prior 5 seconds. Only computed when
        // the phase has a target pace + tolerance (recovery / just-run
        // phases have neither — verdict / tolerance fields stay nil).
        let timeInTol: Int?
        let timeOutTol: Int?
        if let target = p.targetPaceSPerMi, let tol = p.tolerancePaceSPerMi,
           !phasePaceSamples.isEmpty {
            var inSec = 0, outSec = 0
            for s in phasePaceSamples {
                guard let pace = s.paceSPerMi else { continue }
                if abs(pace - target) <= tol { inSec += 5 } else { outSec += 5 }
            }
            timeInTol = inSec
            timeOutTol = outSec
        } else {
            timeInTol = nil
            timeOutTol = nil
        }

        // verdict: honest per-phase read for the recap engine.
        //   incomplete · user ended before reaching the target
        //   hit        · avg pace in band AND ≥ 70% of samples in band
        //   drifted    · avg pace in band but < 70% of samples in band
        //   missed     · avg pace outside the band
        //   nil        · no target to grade against
        let verdict: String? = {
            guard let target = p.targetPaceSPerMi, let tol = p.tolerancePaceSPerMi,
                  let avgPace = avgPace else { return nil }
            if !completed { return "incomplete" }
            let avgInBand = abs(avgPace - target) <= tol
            let inSec = timeInTol ?? 0
            let outSec = timeOutTol ?? 0
            let totalGraded = inSec + outSec
            let pctInBand = totalGraded > 0 ? Double(inSec) / Double(totalGraded) : 0
            if avgInBand && pctInBand >= 0.7 { return "hit" }
            if avgInBand { return "drifted" }
            return "missed"
        }()

        // Emit nil instead of an empty array when no samples landed —
        // backend's `_raw` passthrough preserves the original shape and
        // composers can field-presence-gate cleanly.
        let pacesOut = phasePaceSamples.isEmpty ? nil : phasePaceSamples
        let hrsOut = phaseHrSamples.isEmpty ? nil : phaseHrSamples

        results.append(WatchCompletionPhase(
            index: p.index,
            type: p.type.rawValue,
            label: p.label,
            targetPaceSPerMi: p.targetPaceSPerMi,
            actualPaceSPerMi: avgPace,
            actualDurationSec: actual,
            actualDistanceMi: distMi > 0 ? (distMi * 100).rounded() / 100 : nil,
            avgHr: avgHr,
            maxHr: maxHr,
            avgCadence: avgCad,
            completed: completed,
            paceSamples: pacesOut,
            hrSamples: hrsOut,
            timeInToleranceSec: timeInTol,
            timeOutOfToleranceSec: timeOutTol,
            verdict: verdict
        ))
        // Tier 2: queue an RPE prompt for the recovery that follows a
        // completed work rep. We index the results array entry we just
        // appended so the prompt's eventual answer patches the right
        // phase. Skipped reps (completed == false) don't get a prompt —
        // there's nothing to rate honestly. Wait for the runner to
        // actually be IN the next phase before showing the prompt; we
        // just record intent here.
        if p.type == .work && completed {
            pendingRpeResultsIndex = results.count - 1
        }
    }

    // ─── Tier 2 RPE capture API ────────────────────────────────────
    /// Show the post-rep RPE prompt overlay. Called from the next
    /// phase's `LiveRecovery` / `LiveSteady` view onAppear (or by the
    /// engine right after `advance()` lands on a non-work phase).
    /// 30-sec auto-dismiss timer starts when this is called.
    func showRpePromptIfPending() {
        guard pendingRpeResultsIndex != nil, !rpePromptVisible else { return }
        rpePromptVisible = true
        rpeDismissTask?.cancel()
        rpeDismissTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(30))
            await MainActor.run { self?.dismissRpePrompt() }
        }
    }

    /// User tapped a rating. Patches the queued results entry and
    /// dismisses the prompt. Tag is optional (the runner can pick a
    /// rating without a qualifier).
    func recordRpe(_ rating: Int, tag: String? = nil) {
        guard let idx = pendingRpeResultsIndex, idx < results.count else {
            dismissRpePrompt()
            return
        }
        // WatchCompletionPhase is a struct (value type) inside the
        // results array — patch in place.
        var entry = results[idx]
        entry.repRpe = max(1, min(5, rating))
        if let tag = tag { entry.repRpeTag = tag }
        results[idx] = entry
        dismissRpePrompt()
    }

    /// User dismissed (down-swipe) or 30 s elapsed. Clears prompt
    /// state without recording.
    func dismissRpePrompt() {
        rpeDismissTask?.cancel(); rpeDismissTask = nil
        rpePromptVisible = false
        pendingRpeResultsIndex = nil
    }

    // MARK: - Crash-recovery snapshot (RK-3 · 2026-06-09)
    //
    // All engine state (results, banked time, phase cursor) is in-memory —
    // a watch crash/reboot mid-run used to lose the entire run (no HKWorkout
    // → the iPhone HK fallback had nothing → no completion). The snapshot
    // is a lightweight UserDefaults record written at start, on every phase
    // transition, and on a ~60s cadence from tick(). It is deleted on every
    // normal end (finish — completed AND abandoned — plus reset). Its
    // presence at launch therefore means exactly one thing: a run died
    // mid-flight.
    //
    // The in-flight phase's 5s sample buffers are NOT persisted (too churny
    // to write 4×/sec-adjacent); on RESUME that phase's timelines restart
    // from the recovery point. Completed phases carry their full timelines
    // through `results`.

    struct RunSnapshot: Codable {
        let workoutId: String
        /// The full WatchWorkout payload, JSON-encoded — recovery rebuilds
        /// the engine from this, independent of PhoneSync's current state.
        let workoutJSON: Data
        let startedAtEpoch: Double
        let currentIndex: Int
        let planComplete: Bool
        let bankedSec: Int
        let phaseElapsedSec: Int
        let phaseStartMi: Double
        let results: [WatchCompletionPhase]
        let savedAtEpoch: Double

        func decodedWorkout() -> WatchWorkout? {
            try? JSONDecoder().decode(WatchWorkout.self, from: workoutJSON)
        }
    }

    static let snapshotKey = "faff.watch.activeRunSnapshot.v1"

    static func loadSnapshot() -> RunSnapshot? {
        guard let data = UserDefaults.standard.data(forKey: snapshotKey) else { return nil }
        return try? JSONDecoder().decode(RunSnapshot.self, from: data)
    }

    static func clearSnapshot() {
        UserDefaults.standard.removeObject(forKey: snapshotKey)
    }

    func saveSnapshot() { persistSnapshot() }

    private func persistSnapshot() {
        guard state == .running else { return }
        if workoutJSONCache == nil { workoutJSONCache = try? JSONEncoder().encode(workout) }
        guard let workoutJSON = workoutJSONCache else { return }
        let snap = RunSnapshot(
            workoutId: workout.workoutId,
            workoutJSON: workoutJSON,
            startedAtEpoch: workoutStart.timeIntervalSince1970,
            currentIndex: currentIndex,
            planComplete: planComplete,
            bankedSec: bankedSec,
            phaseElapsedSec: phaseElapsedSec,
            phaseStartMi: phaseStartMi,
            results: results,
            savedAtEpoch: Date.now.timeIntervalSince1970
        )
        if let data = try? JSONEncoder().encode(snap) {
            UserDefaults.standard.set(data, forKey: Self.snapshotKey)
        }
    }

    /// Cadence write from the tick path — at most once per ~60s.
    private func snapshotIfDue() {
        guard totalElapsedSec - lastSnapshotElapsedSec >= 60 else { return }
        lastSnapshotElapsedSec = totalElapsedSec
        persistSnapshot()
    }

    /// Rebuild a mid-run engine from a recovery snapshot and keep going —
    /// the RESUME path after a crash. The tracker must already be re-attached
    /// to the recovered HKWorkoutSession (WorkoutTracker.adoptRecoveredSession)
    /// so live metrics + total distance flow. Defensive: indices are clamped,
    /// historical cues (mile splits, fuel marks, heads-ups) are marked as
    /// already-fired so the runner doesn't get a barrage of stale takeovers.
    func resumeFromSnapshot(_ snap: RunSnapshot) {
        guard state == .idle else { return }
        state = .running
        let count = workout.phases.count
        currentIndex = min(max(0, snap.currentIndex), max(0, count - 1))
        planComplete = snap.planComplete || snap.currentIndex >= count
        bankedSec = snap.bankedSec
        results = snap.results
        workoutStart = Date(timeIntervalSince1970: snap.startedAtEpoch)
        // Continue the phase clock from where the last snapshot left it.
        // The dead window (crash → relaunch) is NOT credited to the phase —
        // the engine only counts time it observed. The HKWorkout itself
        // still spans the real wall-clock run.
        phaseElapsedSec = max(0, snap.phaseElapsedSec)
        phaseStart = Date.now.addingTimeInterval(-Double(phaseElapsedSec) / Self.warpFactor)
        totalElapsedSec = bankedSec + phaseElapsedSec
        phaseStartMi = snap.phaseStartMi
        // In-flight phase aggregates restart clean — only post-recovery
        // samples feed this phase's averages (honest, never fabricated).
        phaseHrSum = 0; phaseHrCount = 0; phaseHrMax = 0
        phaseCadSum = 0; phaseCadCount = 0
        phaseHrSamples = []; phasePaceSamples = []
        phaseLastSampleSec = phaseElapsedSec
        // Don't replay cues that already fired before the crash.
        didFireAlmostDone = false
        lastMileIndex = Int(coveredMi)
        lastMileElapsedSec = totalElapsedSec
        if let fueling = workout.fueling {
            for (i, mark) in fueling.atMins.enumerated() where totalElapsedSec / 60 >= mark {
                firedFuelIndices.insert(i)
            }
        }
        if let gels = workout.gelsMi {
            for (i, mark) in gels.enumerated() where coveredMi >= mark {
                firedGels.insert(i)
            }
        }
        hrOverCeiling = false
        isPaused = false
        pauseStart = nil
        prepDrift()
        workoutJSONCache = snap.workoutJSON
        lastSnapshotElapsedSec = totalElapsedSec
        persistSnapshot()
        Haptics.play(.transitionWork)
        startTimer()
    }

    /// Build a WatchCompletion for a recovered run WITHOUT a live engine —
    /// the END & SAVE path. Totals come from the recovered builder's
    /// statistics (they span the whole session, pre-crash included); phases
    /// come from the snapshot's banked results plus a best-effort entry for
    /// the phase that was in flight when the watch died. With no snapshot
    /// (crash during countdown / mismatched leftovers) it degrades to a
    /// single-phase record so the run still reaches the server.
    static func completionFromRecovery(snapshot: RunSnapshot?,
                                       stats: WorkoutTracker.RecoveredStats) -> WatchCompletion {
        let iso = ISO8601DateFormatter()
        let workout = snapshot?.decodedWorkout()
        // HK's session start is ground truth when present; the snapshot's
        // engine start is the fallback; last resort walks back from elapsed.
        let startDate = stats.startDate
            ?? snapshot.map { Date(timeIntervalSince1970: $0.startedAtEpoch) }
            ?? Date.now.addingTimeInterval(-Double(stats.elapsedSec))

        var phases = snapshot?.results ?? []
        if let snap = snapshot, !snap.planComplete,
           let w = workout, w.phases.indices.contains(snap.currentIndex) {
            // The phase in flight at the crash — duration as of the last
            // snapshot (never inflated by the dead window), no per-phase
            // pace/HR claims we can't back.
            let p = w.phases[snap.currentIndex]
            phases.append(WatchCompletionPhase(
                index: p.index,
                type: p.type.rawValue,
                label: p.label,
                targetPaceSPerMi: p.targetPaceSPerMi,
                actualPaceSPerMi: nil,
                actualDurationSec: max(0, snap.phaseElapsedSec),
                actualDistanceMi: nil,
                avgHr: nil,
                maxHr: nil,
                avgCadence: nil,
                completed: false
            ))
        }
        if phases.isEmpty {
            let avgPace: Int? = {
                guard let mi = stats.distanceMi, mi > 0.05, stats.elapsedSec > 0 else { return nil }
                return Int((Double(stats.elapsedSec) / mi).rounded())
            }()
            phases = [WatchCompletionPhase(
                index: 0,
                type: "work",
                label: workout?.name ?? "Recovered run",
                targetPaceSPerMi: nil,
                actualPaceSPerMi: avgPace,
                actualDurationSec: stats.elapsedSec,
                actualDistanceMi: stats.distanceMi.map { ($0 * 100).rounded() / 100 },
                avgHr: stats.avgHr,
                maxHr: stats.maxHr,
                avgCadence: nil,
                completed: false
            )]
        }

        // P1-34 · same per-start suffix as the live-finish path, keyed off
        // the same startDate this completion already reports — a recovery
        // completion must not collide with a normal finish (or another
        // recovery) for the same calendar day's workoutId.
        let baseWorkoutId = snapshot?.workoutId
            ?? workout?.workoutId
            ?? "recovered-\(Int(startDate.timeIntervalSince1970))"
        let workoutId = baseWorkoutId + WorkoutEngine.sessionSuffix(for: startDate)

        // P2-54 fix (2026-07-07) · when there's no live HKWorkoutSession to
        // read stats from (battery death — recoverActiveWorkoutSession
        // returns nil, so `stats` is the caller's zero/empty struct), the
        // snapshot's BANKED phase results are the only surviving record of
        // the run. Sum them as a fallback for every top-level total so a
        // 16-mile long run doesn't reach the server reporting 0 mi / 0 s
        // just because the builder that would have reported it died with
        // the battery. Prefers the live builder's totals (stats.*) when
        // present — they're ground truth and span pre-crash time the
        // snapshot's phases can't always fully cover — falls back to the
        // phase sum only when a field is genuinely absent.
        let phaseDistSum = phases.compactMap { $0.actualDistanceMi }.reduce(0, +)
        let phaseDurSum = phases.reduce(0) { $0 + $1.actualDurationSec }
        let phaseHrWeighted: Int? = {
            var num = 0.0, den = 0.0
            for p in phases {
                guard let hr = p.avgHr, p.actualDurationSec > 0 else { continue }
                num += Double(hr) * Double(p.actualDurationSec)
                den += Double(p.actualDurationSec)
            }
            return den > 0 ? Int((num / den).rounded()) : nil
        }()
        let phaseMaxHr = phases.compactMap { $0.maxHr }.max()

        let totalDist: Double? = {
            if let d = stats.distanceMi, d > 0.01 { return (d * 100).rounded() / 100 }
            return phaseDistSum > 0.01 ? (phaseDistSum * 100).rounded() / 100 : nil
        }()
        let totalDur = stats.elapsedSec > 0 ? stats.elapsedSec : phaseDurSum
        let totalAvgHr = stats.avgHr ?? phaseHrWeighted
        let totalMaxHr = stats.maxHr ?? phaseMaxHr

        return WatchCompletion(
            workoutId: workoutId,
            startedAt: iso.string(from: startDate),
            completedAt: iso.string(from: .now),
            status: snapshot?.planComplete == true ? "completed" : "partial",
            totalDistanceMi: totalDist,
            totalDurationSec: totalDur,
            avgHr: totalAvgHr,
            maxHr: totalMaxHr,
            avgCadence: nil,
            kcal: stats.kcal,
            phases: phases,
            routePolyline: nil,   // pre-crash route died with the old process
            elevGainFt: nil       // partial post-crash climb would mislead
        )
    }

    // MARK: - GPS polyline encoder

    /// Google precision-5 polyline encoding.  Matches the decoder in the
    /// web map renderer and the identical encoder in HealthKitImporter.swift.
    private static func encodePolyline(_ coords: [(Double, Double)]) -> String {
        var result = ""
        var prevLat = 0, prevLng = 0
        func enc(_ v: Int) {
            var value = v < 0 ? ~(v << 1) : (v << 1)
            while value >= 0x20 {
                result.append(Character(UnicodeScalar(UInt8((0x20 | (value & 0x1f)) + 63))))
                value >>= 5
            }
            result.append(Character(UnicodeScalar(UInt8(value + 63))))
        }
        for (lat, lng) in coords {
            let iLat = Int((lat * 1e5).rounded()), iLng = Int((lng * 1e5).rounded())
            enc(iLat - prevLat); enc(iLng - prevLng)
            prevLat = iLat; prevLng = iLng
        }
        return result
    }

    private func finish(status: String) {
        stopTimer()
        // The run is closing out through the normal path — the recovery
        // snapshot is no longer needed (covers completed AND abandoned ends).
        Self.clearSnapshot()
        // Build the completion BEFORE flipping state, so anything observing the
        // .finished transition (the root model's auto-send) can read it.
        completion = buildCompletion(status: status)
        state = .finished
        Haptics.play(.end)
        // Persist the HKWorkout + GPS route to Health (async, best-effort).
        if let tracker {
            Task { await tracker.end() }
        }
    }

    // MARK: - Per-start identity (P1-34 · 2026-07-07)
    //
    // The server issues workoutId as `${userId}-${YYYY-MM-DD}` — one id per
    // calendar day (build-workout.ts). Two completions on the SAME day used
    // to collide on that id: a restart after a crash/accidental-end, or a
    // genuine double (running today's tile twice), and the second upsert
    // silently overwrote the first run's distance + per-phase blob (audit
    // finding P1-34). workoutId itself stays the plan-linkage key the
    // backend matches to a plan day / prescription — this suffix rides on
    // TOP of it so the two concerns (which plan day, which physical run)
    // are both carried on the wire without a new field. Server-side:
    // route.ts's date-extraction regex tolerates the optional `#HHmm` tail,
    // so cross-day forking is unaffected.
    //
    // Baked in ONCE per completion (here, at build time) — not minted fresh
    // on every retry — so PhoneSync's durable retry queue re-POSTs the
    // IDENTICAL workoutId on every attempt (retry-safe idempotency).
    /// `#HHmm` from the run's actual start — 4 digits, always present.
    static func sessionSuffix(for startDate: Date) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = .current
        let c = cal.dateComponents([.hour, .minute], from: startDate)
        return String(format: "#%02d%02d", c.hour ?? 0, c.minute ?? 0)
    }

    // MARK: Completion payload (ready for phase-6 writeback)

    /// Populated when the workout finishes · the exact body the iPhone
    /// bridge will POST to /api/watch/workouts/complete.
    @Published private(set) var completion: WatchCompletion?

    private func buildCompletion(status: String) -> WatchCompletion {
        let iso = ISO8601DateFormatter()
        let dist = tracker?.distanceMi ?? 0
        let maxHr = tracker?.maxHr ?? 0
        // HK-derived active energy total · piped through so resolveCalories
        // tier 1 picks the real number over the estimator (brief 2026-06-01).
        let kcal = tracker?.activeEnergyKcal ?? 0

        // Re-derive top-level avgHr + avgCadence from WORK-PHASE results
        // only, weighted by each phase's actualDurationSec. The tracker's
        // lifetime accumulators (`tracker.avgHr` / `tracker.avgCadence`)
        // pool every per-second sample across recovery, warmup, and
        // cooldown — for an interval session that drags a 188 spm
        // threshold pull down toward a 165 spm jog and produces a
        // meaningless middle number on the iPhone summary card. The same
        // bug afflicts avgHr (recovery HR still elevated from a hard rep,
        // not the work HR).
        //
        // Per-phase aggregates inside `WatchCompletionPhase.avgHr` /
        // `.avgCadence` are already isolated per phase (engine resets the
        // counters on each advance), so we can roll them up cleanly.
        // Weighting by actualDurationSec is mathematically equivalent to
        // re-summing the per-second samples, since each phase aggregate
        // is itself sample-count-weighted at ~1 Hz.
        //
        // Edge cases:
        //   · no work phases recorded (e.g. user ended in warmup) →
        //     fall back to tracker's pooled value so the field isn't nil
        //     when SOMETHING was sampled
        //   · all work-phase avgHr/avgCadence are nil (no HR/cadence
        //     samples landed) → same fallback
        //   · single-work-phase steady run → identical to lifetime when
        //     there is no warmup/cooldown; otherwise correctly excludes
        //     the framing phases
        //
        // 2026-06-02: doctrine ships post Tier 2 RPE rescind audit. See
        // designs/briefs/watch-work-only-avg-hr-cadence-2026-06-02.md.
        let workPhases = results.filter { $0.type == "work" }
        let derivedAvgHr: Int? = {
            let weighted = workPhases.compactMap { p -> (Int, Int)? in
                guard let hr = p.avgHr, p.actualDurationSec > 0 else { return nil }
                return (hr, p.actualDurationSec)
            }
            guard !weighted.isEmpty else { return tracker?.avgHr }
            let totalSec = weighted.reduce(0) { $0 + $1.1 }
            guard totalSec > 0 else { return tracker?.avgHr }
            let totalHrSec = weighted.reduce(0) { $0 + ($1.0 * $1.1) }
            return Int((Double(totalHrSec) / Double(totalSec)).rounded())
        }()
        let derivedAvgCadence: Int? = {
            let weighted = workPhases.compactMap { p -> (Int, Int)? in
                guard let c = p.avgCadence, p.actualDurationSec > 0 else { return nil }
                return (c, p.actualDurationSec)
            }
            guard !weighted.isEmpty else { return tracker?.avgCadence }
            let totalSec = weighted.reduce(0) { $0 + $1.1 }
            guard totalSec > 0 else { return tracker?.avgCadence }
            let totalCadSec = weighted.reduce(0) { $0 + ($1.0 * $1.1) }
            return Int((Double(totalCadSec) / Double(totalSec)).rounded())
        }()

        // GPS polyline — encode BEFORE tracker.end() tears down the session.
        // Downsample to ≤600 points; precision-5 Google encoding ~800 bytes
        // for a 12mi run.  nil when fewer than 2 coordinates were collected
        // (indoor, very short tap-test, simulator).
        let routePolyline: String? = {
            guard let coords = tracker?.gpsCoords, coords.count >= 2 else { return nil }
            let step = max(1, coords.count / 600)
            var sampled: [(Double, Double)] = stride(from: 0, to: coords.count, by: step)
                .map { coords[$0] }
            if let last = coords.last,
               sampled.last.map({ $0.0 != last.0 || $0.1 != last.1 }) ?? true {
                sampled.append(last)
            }
            return Self.encodePolyline(sampled)
        }()

        // Elevation gain — read the barometer-fused accumulator BEFORE
        // tracker.end() tears down the session. Convert meters → feet (1 dp).
        // nil when no valid vertical fixes were collected (indoor, simulator).
        let elevGainFt: Double? = {
            guard let m = tracker?.elevGainM, m > 0 else { return nil }
            return (m * 3.28084 * 10).rounded() / 10
        }()

        return WatchCompletion(
            // P1-34 · per-start session suffix so a same-day restart/double
            // never collides with an earlier completion's row. See
            // sessionSuffix(for:) doc above.
            workoutId: workout.workoutId + Self.sessionSuffix(for: workoutStart),
            startedAt: iso.string(from: workoutStart),
            completedAt: iso.string(from: .now),
            status: status,
            totalDistanceMi: dist > 0 ? (dist * 100).rounded() / 100 : nil,
            totalDurationSec: totalElapsedSec,
            avgHr: derivedAvgHr,
            maxHr: maxHr > 0 ? maxHr : nil,
            avgCadence: derivedAvgCadence,
            kcal: kcal > 0 ? kcal : nil,
            phases: results,
            routePolyline: routePolyline,
            elevGainFt: elevGainFt
        )
    }
}
