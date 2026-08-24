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

    // ─── The four wrist decisions (0821 · README §5, §7) ────────────
    // Published so the boards can read them without asking twice. The
    // records themselves are private — a board asks "has this been
    // answered", never "what exactly was written down". See the
    // `MARK: - The four wrist decisions` section near the bottom for
    // the API, the wire mapping and the reasoning.

    /// True once the bail question has been ANSWERED, either way. The bail
    /// fires once per run (README §7), so this is what a board checks before
    /// offering it — a declined bail closes the question exactly as firmly
    /// as a taken one.
    @Published private(set) var bailAnswered = false
    /// Which way it was answered. Meaningless until `bailAnswered`.
    @Published private(set) var bailTaken = false
    /// True once the runner answered "Lift it for today" on the ceiling
    /// board. Singular by design: the board asks once and the answer holds
    /// for the rest of the run, which is also why `hrOverCeiling` stops
    /// firing from that moment (a ceiling lifted for the day is not a
    /// ceiling you keep being warned about).
    @Published private(set) var ceilingLifted = false
    /// 1-based ordinals of the reps the runner CHOSE to skip. Read by a
    /// board to guarantee the second half of README §5's skip rule: no
    /// second ask, and no nag on the next rep.
    @Published private(set) var skippedRepOrdinals: Set<Int> = []
    /// Seconds ADDED to the current phase by "+30 sec" on the recovery
    /// face. Folded into `phaseRemainingSec` / `phaseProgress` / the tick's
    /// completion test, so the button adds to the number the runner is
    /// actually watching rather than to a number kept somewhere else.
    /// Reset to 0 on every phase boundary — an extension buys time in THIS
    /// recovery and never leaks into the next one.
    @Published private(set) var phaseAddedSec: Int = 0

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
    /// Total seconds the runner held the clock. Sent on the completion so the
    /// server's clock audit can account for it: `totalDurationSec` excludes
    /// paused time by design while `startedAt` is the real wall-clock start,
    /// so without this every run paused longer than the 45s tolerance wrote a
    /// clockAudit row and warned about dropped ticks that never happened. The
    /// row is meant to mean "worth looking at"; most of them meant a stoplight.
    private(set) var totalPausedSec: Int = 0
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
        let dur = p.durationSec + phaseAddedSec
        guard dur > 0 else { return 0 }
        return min(1, Double(phaseElapsedSec) / Double(dur))
    }

    /// Time left in the current phase, INCLUDING any "+30 sec" the runner
    /// added to this recovery. This is the number the extend-recovery board
    /// draws, so the button has to move it — see `recordRecoveryExtension`.
    var phaseRemainingSec: Int {
        guard let p = currentPhase else { return 0 }
        return max(0, p.durationSec + phaseAddedSec - phaseElapsedSec)
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
        // A payload with no phases decodes happily and used to freeze the
        // clock: tick() returns early on a nil currentPhase BEFORE publishing
        // elapsed, so the run recorded in HealthKit while the face showed
        // 0:00 for ninety minutes and the completion carried a zero duration.
        // The overtime branch already publishes elapsed correctly, so the fix
        // is to start there rather than to special-case the tick.
        if workout.phases.isEmpty { planComplete = true }
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
        clearDecisions()
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
        // GO. The design lists it as a moment and the board exists; nothing
        // fired it. The countdown ended and the running face simply appeared,
        // so the loudest board in the app was drawn for a state it was never
        // reached in — it was being spent on work-rep boundaries instead,
        // where it had nothing to say.
        //
        // Carries no payload on purpose: `WMomentGo` draws the word on the
        // session's own ramp, and at this instant the session type is the
        // only thing there is to say.
        flash(.go(rep: "", target: ""), for: 1.2)
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
    ///
    /// An OPEN-ENDED session is neither. A just-run is one work phase under a
    /// 24h ceiling that exists so the phase never ends on its own — the
    /// runner ending it is not them cutting the plan short, it is the only
    /// way the session can finish. Asking `planComplete` there asks a
    /// question with no true answer and always got the wrong one: every
    /// just-run came back `abandoned`, with its single work phase recorded
    /// `completed: false`. Downstream that is the difference between a run
    /// that happened and one that came apart — `reconstruct.ts` reads
    /// `abandoned`/`partial` as "did not run to its end," and the phase flag
    /// is what `glance-state` counts. Today the readers are lenient enough
    /// that nothing visibly broke; the next one to trust the label plainly
    /// would mislabel every unstructured run the app has.
    func abandon() {
        guard state == .running else { return }
        if planComplete { finish(status: "completed"); return }
        if workout.isOpenEnded {
            recordCurrentPhase(completed: true)
            finish(status: "completed")
            return
        }
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
        Haptics.play(moment: .paused)
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
        totalPausedSec += Int(delta.rounded())
        pauseStart = nil
        isPaused = false
        tracker?.resume()
        // The staleness watchdog is not ticked while paused, so lastHrSampleAt
        // ages through the pause and fires the instant the run resumes —
        // drawing "No heart signal" for twenty seconds after every pause
        // longer than twenty seconds. Nothing failed; nobody was looking.
        tracker?.markHrSampleFresh()
        Haptics.play(moment: .resumed)
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
        clearDecisions()
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
        // WRIST DOWN COSTS LESS (2026-08-23). In Always-On the watch redraws
        // about once a minute, and every one of the ~60 ticks between those
        // redraws was doing the full job: publishing elapsed, re-evaluating
        // drift, and invalidating a surface nobody can read. The clock is
        // wall-clock anchored — the comment above says so, and that is exactly
        // what makes this safe — so a 5 s tick cannot drift; it just tells the
        // truth less often while nobody is looking.
        //
        // The interval is re-read every iteration, so the wrist coming up
        // restores 1 Hz within one tick rather than at the next phase.
        ticker = Task { [weak self] in
            while !Task.isCancelled {
                let dimmed = self?.tracker?.isLuminanceReduced ?? false
                try? await Task.sleep(for: .seconds(dimmed ? 5 : 1))
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
        //
        // 0821 · `!ceilingLifted` — once the runner has answered "Lift it for
        // today" on the ceiling board (README §7), the limit is not in force
        // any more, so the guardrail stops flipping red for the rest of the
        // run. The else-branch below clears a flag that was already up. The
        // decision itself is NOT forgotten: it rides the completion as
        // `ceilingLift` and surfaces on the phone.
        if let ceiling = workout.hrCeilingBpm, ceiling > 0, !ceilingLifted {
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
                    Haptics.play(moment: .fuel)
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
                if r.fireHaptic {
                    // THE DRIFT CUE NOW DRAWS ITSELF.
                    //
                    // This used to be a haptic and nothing else. The board for
                    // it exists — WMomentHeadsUp, "ease off / pick it up" with
                    // the band underneath, §4 of the handoff — and drift never
                    // reached it. The runner felt a tap with no way to know
                    // what it meant, which is the same failure rule 10 forbids
                    // for audio: a delivery route is not a content channel.
                    //
                    // Worse, the board WAS being drawn — for the almost-done
                    // cue, whose "Band is ..." line is not true at a phase
                    // boundary. Each event was wearing the other's clothes.
                    //
                    // Truthful here by construction: driftEval only exists on a
                    // work phase with a target, so there is always a band to
                    // name.
                    // The texture names the direction, matching the word the
                    // board is about to draw. A single texture for both would
                    // be a tap the runner cannot act on without looking.
                    Haptics.play(moment: r.deltaSPerMi < 0 ? .headsUpEaseOff
                                                           : .headsUpPickItUp)
                    flash(.headsUp(value: ""), for: 2.6)
                }
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
            // NO VISUAL, deliberately, and this is a gap rather than a fix.
            //
            // This used to flash `.headsUp`, which the router draws as the
            // ease-off / pick-it-up correction — a board whose content is the
            // band the runner is being held to. At a phase boundary that
            // sentence is not true, and on a single-phase run with no
            // prescribed band it rendered literally as "Band is /mi".
            //
            // The handoff's §4 has no board for "almost done"; its heads-up IS
            // the correction. So rather than invent one, the cue stays haptic
            // for now and the missing board is a question for David.
            // `headsUpValue` — the remaining distance — is what it would carry.
            _ = headsUpValue
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
        // A RACE ALWAYS SPLITS.
        //
        // This gate exists so a mile boundary does not take the screen in the
        // middle of a 400m rep, and it asks "is this a work phase" — which is
        // the right question for an interval session and the wrong one for a
        // race, because a race's course segments are ALSO typed `.work`.
        //
        // A marathon therefore failed every exemption: several work phases, so
        // not `isEasyBandSingleWork`; no finish segment, so not
        // `isLongBuildPhase`. `allowSplitFlash` was false for the entire race
        // and every mile passed in silence — no board and no haptic, because
        // both live inside this branch. The single most-wanted number in a
        // marathon was the one thing the watch would not say.
        //
        // A course segment is not a rep. The distinction the gate wants is
        // "am I in a short effort I should not interrupt", and a race never is.
        let allowSplitFlash = isRace || currentPhase?.type != .work
            || isEasyBandSingleWork || isLongBuildPhase
        if allowSplitFlash, mileIndex > lastMileIndex {
            // If GPS jumps multiple integers in one tick (rare, e.g. a sim
            // teleport), we only flash the most-recent mile rather than
            // queuing several — the runner can't process N flashes anyway.
            let lapSec = max(1, totalElapsedSec - lastMileElapsedSec)
            lastMileElapsedSec = totalElapsedSec
            lastMileIndex = mileIndex
            noteMileBand(inBand: paceZone == .onTarget)
            Haptics.play(moment: .split)
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
                // The FUEL texture, not almostDone. Race day fired the
                // "your effort is nearly over" tap at mile 8 of a marathon —
                // the training path two hundred lines up uses `.fuel`, and the
                // two paths differ only in what triggers them (elapsed time
                // for training, aid-station miles for a race). The cue itself
                // is one idea and should feel like one.
                Haptics.play(moment: .fuel)
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
        // `phaseAddedSec` is EXCLUDED from this test deliberately. A
        // time-based phase cannot normally reach 1.5x its own duration — but
        // an extended recovery can: two "+30 sec" presses hold a 120s
        // recovery to 180s, which is exactly the threshold, and a runner
        // standing at a fountain covers well under 80 metres in that time.
        // `distanceSourceUnavailable` is sticky for the whole run, so two
        // taps on a button the design put there on purpose turned an outdoor
        // run into a treadmill run: Page 1 swapped, pace stopped grading, and
        // power and climb dropped off Page 2 for good.
        let extended = phaseAddedSec > 0
        let noDistanceSource = !extended
            && phaseCoveredMi < 0.05
            && phaseElapsedSec >= Int(Double(max(phase.durationSec, 60)) * 1.5)
        if noDistanceSource { tracker?.markDistanceSourceUnavailable() }
        let finished: Bool
        if isSinglePhaseDistanceRun, let total = workout.distanceMi {
            finished = coveredMi >= total || noDistanceSource
        } else if phase.repUnit == .distance, let d = phase.distanceMi {
            finished = phaseCoveredMi >= d || noDistanceSource
        } else {
            // `+ phaseAddedSec` · an extended recovery ends when the EXTENDED
            // clock runs out, not when the prescribed one does. Zero on every
            // phase the runner didn't extend, so this is byte-identical to the
            // old test for every other rep.
            finished = phaseElapsedSec >= phase.durationSec + phaseAddedSec
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
            if phaseAddedSec != 0 { phaseAddedSec = 0 }
            didFireAlmostDone = false
            phaseHrSum = 0; phaseHrCount = 0; phaseHrMax = 0
            phaseCadSum = 0; phaseCadCount = 0
            driftEval = nil
            paceZone = .onTarget
            paceDeltaSPerMi = 0
            // Snapshot the plan-done state (results now hold every phase) so
            // a crash during overtime still recovers a complete run.
            persistSnapshot()
            Haptics.play(moment: .finish)
            // No takeover face for plan-done — the live face already
            // signals overtime by flipping the distance row to .bonus
            // purple + counting up, and the finish haptic just fired
            // above. The extra full-screen wordmark flash was clutter.
            saveSnapshot()
            return
        }

        currentIndex += 1
        phaseStart = .now
        phaseStartMi = coveredMi
        phaseElapsedSec = 0
        totalElapsedSec = bankedSec
        // A "+30 sec" bought time in the recovery we are LEAVING. It does not
        // travel — the next rep gets the duration the plan prescribed.
        if phaseAddedSec != 0 { phaseAddedSec = 0 }
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
                let target = p.targetPaceSPerMi.map { "\(PaceFormat.mmss($0))/mi" } ?? ""
                flash(.phase(title: "Finish", sub: "\(p.label) · \(target)"), for: 2.2)
            } else if p.type == .work {
                // Entering a work rep. Two reads: which rep ("Rep 2 of 4") and
                // the target pace ("6:47").
                //
                // THIS USED TO FIRE `.go` AND THE TWO READS WERE THROWN AWAY.
                // The router's `.go` case draws `WMomentGo`, which is the word
                // GO on a session ramp and nothing else — so the engine
                // computed the rep number and the target, said in its own
                // comment that those strings ARE the content and that there
                // should be no GO wordmark, and the board drew exactly the GO
                // wordmark and discarded both. Every rep of every interval
                // session showed the same content-free screen at the one
                // moment the runner most needs to know which rep they are on
                // and what pace it asks for.
                //
                // `.phase` is the board that was drawn for this: word, detail,
                // and the band underneath. `.go` is the start of the RUN, and
                // it now fires there — see `start()`.
                let totalWorks = workout.phases.filter { $0.type == .work }.count
                let n = workout.phases.prefix(currentIndex + 1).filter { $0.type == .work }.count
                // The pace is said ONCE. The router draws the prescribed band
                // under this board whenever the phase has a tolerance
                // ("6:45-7:00 /mi"), so repeating the point target in the
                // detail line would say the same thing twice on a board whose
                // whole job is to be read in a second and a half. The target
                // appears here only when there is no band to carry it.
                let rep = "Rep \(n) of \(totalWorks)"
                let hasBand = (p.tolerancePaceSPerMi ?? 0) > 0 && (p.targetPaceSPerMi ?? 0) > 0
                let sub: String
                if !hasBand, let t = p.targetPaceSPerMi, t > 0 {
                    sub = "\(rep) · \(PaceFormat.mmss(t))/mi"
                } else {
                    sub = rep
                }
                flash(.phase(title: p.label, sub: sub), for: 1.6)
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

    // MARK: - The four wrist decisions (0821 · 2026-08-21)
    //
    // A runner can decide four things mid-run: take or decline the bail,
    // lift the HR ceiling for the day, skip a rep, extend a recovery. Until
    // now the engine acted on none of them and remembered none of them, so
    // every one of them reached the phone as an absence — a rep that simply
    // did not happen, a ceiling that was simply exceeded.
    //
    // THE ONE RULE THAT SHAPES THIS WHOLE SECTION: a decision is not a
    // lapse, and the DATA has to say so. `WatchCompletionPhase.completed ==
    // false` means "this rep did not happen" and says nothing about why — a
    // rep the runner chose to skip and a rep that fell over when the watch
    // died are the same value on that field. So a chosen skip is an
    // EXPLICIT record with its own quantities, never a flag the phone
    // infers from the phase array. The phone must never have to guess which
    // one it was, because on the one screen whose register says "you chose
    // it, we did not lose it", guessing wrong calls a choice a failure.
    //
    // NEVER AN EMPTY ARRAY. All three array/optional wire fields are nil
    // until something is actually recorded, and they are populated through
    // `WatchCompletion.recordRepSkip` / `.recordRecoveryExtension`, which
    // only ever create an array by putting something in it. The server
    // merges onto runs.data, so `[]` would overwrite a value a sibling
    // payload already wrote (Rule 6). The engine holds its own records in
    // plain Swift arrays and maps them at build time; an empty engine array
    // produces an ABSENT wire field, not an empty one.
    //
    // These records are also carried through the crash-recovery snapshot.
    // "The watch does not quietly forget" has to survive the watch dying —
    // a ceiling lift the runner answered at mile 4 must still reach the
    // phone if the process is killed at mile 9.

    /// A contingency-rule outcome, in the exact shape the server already
    /// reads (`ruleOutcomes` on the completion body · run-recap.ts reasons
    /// about `kind` / `breached` / `actionTaken`). The BAIL is the only rule
    /// the watch fires today, and both answers are recorded: taken is
    /// `actionTaken: true`, declined is `actionTaken: false` with
    /// `breached: true` still standing, because the rule DID trip — the
    /// runner just chose to push through, and the recap says "noted, not
    /// judged" rather than nothing at all.
    struct RuleOutcome: Codable, Equatable {
        /// "bail" | "abort" | "pass" — matches run-recap.ts's reader.
        let kind: String
        /// Names the rule, e.g. "Bail line". The recap lowercases it into
        /// "the bail line tripped and you pushed through".
        let label: String
        /// The rule tripped. Always true here: the board is only offered
        /// because the engine saw the breach.
        let breached: Bool
        /// Whether the runner took the action the rule offered.
        let actionTaken: Bool
        let atMi: Double?
    }

    /// Engine-side record of the ceiling lift. Kept separate from
    /// `WatchCompletion.CeilingLift` (which is Encodable only) so it can
    /// ride the Codable crash snapshot.
    struct CeilingLiftRecord: Codable {
        let ceilingBpm: Int?
        let readingBpm: Int?
        let phaseIndex: Int?
        let phaseLabel: String?
        let atMi: Double?
        let atSec: Int?
    }

    /// Engine-side record of one CHOSEN rep skip.
    ///
    /// `repsCompleted` is deliberately NOT stored here. "Five of six" is a
    /// count of the whole run and the run isn't over at the moment of the
    /// skip — the runner may well go on to finish reps five and six. It is
    /// computed once, at completion-build time, from the banked phase
    /// results. Storing the mid-run figure would ship a number that is true
    /// for one second and wrong for the rest of the session.
    struct RepSkipRecord: Codable {
        let repIndex: Int
        let repCount: Int
        let phaseIndex: Int?
        let phaseLabel: String?
        let atMi: Double?
        let atSec: Int?
    }

    /// Engine-side record of ONE press of "+30 sec". One entry per press:
    /// the count is the array length ("Twice"), never a summed field, so
    /// the phone can say how many and between which reps without the watch
    /// pre-deciding the sentence.
    struct RecoveryExtensionRecord: Codable {
        let afterRepIndex: Int?
        let beforeRepIndex: Int?
        let repCount: Int?
        let addedSec: Int
        let phaseIndex: Int?
        let phaseLabel: String?
        let atSec: Int?
    }

    private var bailOutcome: RuleOutcome?
    private var ceilingLiftRecord: CeilingLiftRecord?
    private var repSkipRecords: [RepSkipRecord] = []
    private var recoveryExtensionRecords: [RecoveryExtensionRecord] = []

    /// Wipe every decision. Called from `start()` and `reset()` so a second
    /// run in the same app session can never inherit the first one's
    /// answers.
    private func clearDecisions() {
        bailAnswered = false
        bailTaken = false
        milesAdrift = 0
        totalPausedSec = 0
        ceilingLifted = false
        if !skippedRepOrdinals.isEmpty { skippedRepOrdinals = [] }
        if phaseAddedSec != 0 { phaseAddedSec = 0 }
        bailOutcome = nil
        ceilingLiftRecord = nil
        repSkipRecords = []
        recoveryExtensionRecords = []
        // Manual laps ride along here: same lifetime, same reason — they are
        // things this runner did on this run, and a second run in the same
        // app session must not inherit them.
        lapCount = 0
        lastLapElapsedSec = 0
    }

    // MARK: Read-only state the boards need

    /// How many work reps the session asked for. 1 on an easy/long/just-run
    /// session (the backend expands those as a single `.work` phase), which
    /// is why the boards route on session shape and not on this number.
    var repCountForDisplay: Int {
        workout.phases.filter { $0.type == .work }.count
    }

    /// 1-based ordinal of the rep the runner is IN, or — on a recovery /
    /// cooldown — the rep they just finished. 0 during a warm-up, before
    /// any rep has started, which a progress strip renders as "none done"
    /// rather than as rep zero.
    var repIndexForDisplay: Int {
        let upTo = min(currentIndex + 1, workout.phases.count)
        guard upTo > 0 else { return 0 }
        return workout.phases.prefix(upTo).filter { $0.type == .work }.count
    }

    /// 1-based ordinal of the NEXT work rep after the current phase, or nil
    /// when the session has no more reps. This is the "before" half of an
    /// extension's "between reps two and three".
    private var nextWorkRepOrdinal: Int? {
        guard let pos = workout.phases.indices.first(where: {
            $0 > currentIndex && workout.phases[$0].type == .work
        }) else { return nil }
        return workout.phases.prefix(pos + 1).filter { $0.type == .work }.count
    }

    /// The live recovery countdown, including every "+30 sec" already
    /// pressed. Named for the board that draws it so a call site cannot
    /// accidentally freeze it: this is a computed read of live state, and
    /// re-reading it every tick is the point.
    var recoveryRemainingSec: Int { phaseRemainingSec }

    /// Whether the bail can still be offered. It fires ONCE per run
    /// (README §7) and a declined bail closes it as firmly as a taken one —
    /// re-asking a question the runner already answered is the nag the rule
    /// exists to prevent.
    var canOfferBail: Bool { state == .running && !bailAnswered }

    // MARK: The bail — evidence, judgement, and when to ask
    //
    // "The strongest thing the phone has that no watch app does: the coach
    // asking rather than the runner quietly failing." It fires ONCE per run,
    // when the evidence is in, and both answers are legitimate.
    //
    // Two conditions, and both must hold. A rule must exist (the plan decides
    // whether this session HAS a bail — an easy run does not), and the runner
    // must actually be adrift. Firing on a rule alone would ask the question
    // of somebody having a good day.

    /// The plan's bail rule for this session, if it carries one.
    var bailRule: WatchRule? { workout.rules?.first(where: { $0.isBail }) }

    /// Consecutive whole miles the runner has finished outside the band.
    /// Reset the moment a mile lands inside it — the question is about a
    /// pattern, not about one bad mile.
    @Published private(set) var milesAdrift: Int = 0

    /// Whether to put the board up right now.
    ///
    /// Deliberately conservative: two full miles adrift, on a session whose
    /// plan carries a bail rule, and never in the first mile. A coach that
    /// asks too early is a coach the runner stops believing.
    var shouldOfferBailNow: Bool {
        guard bailRule != nil, !bailAnswered, state == .running else { return false }
        return milesAdrift >= 2
    }

    /// Called at each mile boundary with whether that mile finished in band.
    func noteMileBand(inBand: Bool) {
        milesAdrift = inBand ? 0 : milesAdrift + 1
    }

    /// The evidence, quietly. Prefers what the plan sent; composes from the
    /// engine's own count when the wire does not carry it.
    var bailEvidence: String {
        if let e = bailRule?.evidence, !e.isEmpty { return e }
        let n = max(2, milesAdrift)
        return "\(Self.spell(n).capitalized) miles adrift"
    }

    /// The judgement, in the coach's register. Same precedence.
    ///
    /// Silence over an unfalsifiable claim: when the plan sends no judgement
    /// and the session is one the engine cannot reason about, this returns
    /// the honest general case rather than inventing a physiological claim
    /// about a session it does not understand.
    var bailJudgement: String {
        if let j = bailRule?.judgement, !j.isEmpty { return j }
        let done = repIndexForDisplay - 1
        if done >= 2 {
            return "The stimulus is already banked \(Self.mid) forcing the rest buys fatigue, not fitness."
        }
        return "Holding this pace is costing more than it is building \(Self.mid) a shorter run still counts."
    }

    /// The one Unicode character with a job. Never an em dash.
    private static let mid = "\u{00B7}"

    /// Whether THIS rep has already been skipped. The skip advances the
    /// phase immediately, so in practice this guards a double-tap; it is
    /// public because the second half of README §5's skip rule ("no second
    /// ask and no nag on the next rep") is a claim a board should be able
    /// to check rather than assume.
    func didSkipRep(ordinal: Int) -> Bool { skippedRepOrdinals.contains(ordinal) }

    /// How many recoveries have been extended so far, in presses.
    var recoveryExtensionCount: Int { recoveryExtensionRecords.count }

    /// What the End-confirm board states as a fact before it asks anything:
    /// "Two reps unfinished". Nil when there is nothing outstanding to
    /// name.
    ///
    /// Reps only. A single-work-phase session (easy, long, recovery, just
    /// run) has exactly one `.work` phase covering the whole run, so
    /// "One rep unfinished" would be a true sentence in the wrong register
    /// for a runner who is simply stopping a mile early — the board drops
    /// the line rather than say it.
    var unfinishedSummary: String? {
        guard !planComplete, !isSingleWorkSession else { return nil }
        let total = repCountForDisplay
        guard total > 0 else { return nil }
        let done = results.filter { $0.type == "work" && $0.completed }.count
        let outstanding = max(0, total - done)
        guard outstanding > 0 else { return nil }
        return "\(Self.spell(outstanding).capitalized) \(outstanding == 1 ? "rep" : "reps") unfinished"
    }

    /// The coach's opinion on skipping THIS rep — the one confirmation that
    /// earns a sentence, because it is the one decision the coach has a
    /// view on. Copy rules: second person, present tense, 8-40 words, no
    /// exclamation marks, no emoji, no em dashes, never scolding, and
    /// nothing it cannot stand behind.
    var skipOpinion: String {
        let total = repCountForDisplay
        let n = max(1, repIndexForDisplay)
        let left = max(0, total - n)
        let banked = max(0, n - 1)
        if left == 0 {
            return "This is the last one. Everything before it is already banked, so this rep is the only thing that can still change how the session reads."
        }
        if banked == 0 {
            return "You are on the first rep. Skipping this early usually means the target was set too hard, not that you are done. Ease the pace and hold it if you can."
        }
        let bankedPart = "\(Self.spell(banked).capitalized) \(banked == 1 ? "rep is" : "reps are") banked"
        let leftPart = "\(Self.spell(left)) \(left == 1 ? "remains" : "remain")"
        return "\(bankedPart) and \(leftPart). The session still counts without this one. The reps at the end are the ones that change anything."
    }

    /// Small numbers spelled out, the way every other line on these boards
    /// writes them ("Two reps unfinished"). Falls back to digits past
    /// twelve, where words start reading worse than figures.
    private static func spell(_ n: Int) -> String {
        let words = ["zero", "one", "two", "three", "four", "five", "six",
                     "seven", "eight", "nine", "ten", "eleven", "twelve"]
        return words.indices.contains(n) ? words[n] : String(n)
    }

    /// Distance right now, 2 dp, or nil when nothing meaningful has banked.
    /// A decision taken at 0.0 mi carries no mile — better absent than a
    /// zero the phone would render as "at mile 0".
    private func atMiNow() -> Double? {
        let mi = coveredMi
        return mi > 0.01 ? (mi * 100).rounded() / 100 : nil
    }

    // MARK: The four record… calls (the router calls these from a button)

    /// The bail, answered. `taken: true` = "Cut it short", `false` = "Run it
    /// out". BOTH are recorded: a declined bail is a decision the recap
    /// reasons about ("noted, not judged"), and recording only the taken one
    /// would make the wire unable to tell "declined" from "never asked".
    ///
    /// Fires once per run. A second call is ignored, which is what makes
    /// "no second ask" a property of the engine rather than a discipline
    /// the boards have to keep.
    ///
    /// This RECORDS the answer; it does not itself cut the run short. What
    /// "cut it short" does to the plan is a routing decision (end the run,
    /// end the rep, drop to easy), and the engine already exposes each of
    /// those as its own call. Pair this with one of them.
    ///
    /// ORDER MATTERS · record the answer BEFORE acting on it. The completion
    /// is built at the moment the run ends, so `finish(save:)` first and
    /// `recordBail` second would end the run and then write the decision on
    /// a payload that has already been sealed.
    func recordBail(taken: Bool, label: String = "Bail line") {
        guard state == .running, !bailAnswered else { return }
        bailAnswered = true
        bailTaken = taken
        bailOutcome = RuleOutcome(
            kind: "bail",
            label: label,
            breached: true,
            actionTaken: taken,
            atMi: atMiNow()
        )
        // No haptic. The question already carried one when it was ASKED
        // (Haptics.Moment.bailOffered, fired by whoever put the board up);
        // the answer is a button the runner just pressed while looking at
        // the screen, and the visual is the confirmation. Haptics.swift's
        // vocabulary is full and deliberately has no "answered" moment.
        saveSnapshot()
    }

    /// "Lift it for today" on the ceiling board. Records the ceiling that
    /// was in force AND the reading at the moment it was lifted, as two
    /// separate figures — never a delta. "Ran to 174, the ceiling was 165"
    /// is a fact the phone can phrase; "+9 over" has already thrown away
    /// the half of it the phone might need.
    ///
    /// A reading of 0 or nil is recorded as ABSENT, not as zero: the strap
    /// dropping out is not a heart rate of nothing.
    ///
    /// From here on the guardrail stops flipping red (see the tick's
    /// ceiling block) — the ceiling was lifted, so continuing to warn about
    /// it would be the nag the board exists to replace. The decision itself
    /// rides the completion and surfaces on the phone; the watch does not
    /// quietly forget it.
    func recordCeilingLift(readingBpm: Int?) {
        guard state == .running, !ceilingLifted else { return }
        ceilingLifted = true
        if hrOverCeiling { hrOverCeiling = false }
        ceilingLiftRecord = CeilingLiftRecord(
            ceilingBpm: workout.hrCeilingBpm.flatMap { $0 > 0 ? $0 : nil },
            readingBpm: readingBpm.flatMap { $0 > 0 ? $0 : nil },
            phaseIndex: currentPhase?.index,
            phaseLabel: currentPhase?.label,
            atMi: atMiNow(),
            atSec: totalElapsedSec
        )
        // No haptic, for the same reason as `recordBail`: the ceiling board
        // buzzed when it asked, and this is the runner answering it.
        saveSnapshot()
    }

    /// "Skip anyway" on the skip-confirm board. The engine knows which rep
    /// it is, so the caller passes nothing.
    ///
    /// This is the WHOLE action: it writes the explicit skip record and then
    /// ends the rep. Do not follow it with `endCurrentPhase()` — that would
    /// skip a second rep.
    ///
    /// The phase it ends banks with `completed: false`, exactly like every
    /// other early end, and that is fine precisely BECAUSE the skip record
    /// exists alongside it: the phone reads the record to know the rep was
    /// chosen away, and never has to interpret the phase flag.
    ///
    /// No-ops outside a work rep, and no-ops on a rep already skipped.
    func recordRepSkip() {
        guard state == .running, !planComplete,
              let p = currentPhase, p.type == .work else { return }
        let ordinal = repIndexForDisplay
        guard ordinal > 0, !skippedRepOrdinals.contains(ordinal) else { return }
        skippedRepOrdinals.insert(ordinal)
        repSkipRecords.append(RepSkipRecord(
            repIndex: ordinal,
            repCount: repCountForDisplay,
            phaseIndex: p.index,
            phaseLabel: p.label,
            atMi: atMiNow(),
            atSec: totalElapsedSec
        ))
        // Advance BEFORE persisting: the snapshot then holds both the skip
        // record and the banked (incomplete) phase, so a crash one second
        // later recovers a run that agrees with itself.
        advance(completedCurrent: false)
        saveSnapshot()
    }

    /// One press of "+30 sec" on the recovery face. Adds the time to the
    /// number the runner is watching (`phaseRemainingSec`, which the board
    /// reads live) and records one entry per press — the count is the array
    /// length, so "Twice" is a fact about the data rather than a counter the
    /// watch maintained.
    ///
    /// Records which reps it sat between: the rep just finished, and the rep
    /// it delayed.
    ///
    /// Recovery phases only. "+30 sec" mid-rep is not a thing the design
    /// offers, and silently extending a work interval would corrupt the rep
    /// the whole session is built around.
    func recordRecoveryExtension(addedSec: Int = 30) {
        guard state == .running, !planComplete, addedSec > 0,
              let p = currentPhase, p.type == .recovery else { return }
        phaseAddedSec += addedSec
        recoveryExtensionRecords.append(RecoveryExtensionRecord(
            afterRepIndex: repIndexForDisplay > 0 ? repIndexForDisplay : nil,
            beforeRepIndex: nextWorkRepOrdinal,
            repCount: repCountForDisplay > 0 ? repCountForDisplay : nil,
            addedSec: addedSec,
            phaseIndex: p.index,
            phaseLabel: p.label,
            atSec: totalElapsedSec
        ))
        // The countdown just jumped back up; clear the ending-countdown
        // window so the runner does not see a stale "3" for one tick and
        // so the final-beat haptic fires again at the NEW boundary.
        if endingCountdownSec != nil { endingCountdownSec = nil }
        // No haptic. The runner is looking at the number they just changed,
        // and it changed by thirty. A buzz on top of that is a second
        // channel saying what the screen already said.
        saveSnapshot()
    }

    // MARK: Wire mapping
    //
    // Engine records → the completion's fields. Each mapper returns nil for
    // "nothing to say" so the caller can leave the field absent. Nothing
    // here ever produces an empty array.

    /// The rule outcomes for this run, or nil when no rule was answered.
    /// Today that is the bail and only the bail.
    var ruleOutcomesForWire: [RuleOutcome]? {
        guard let bailOutcome else { return nil }
        return [bailOutcome]
    }

    /// Fold every recorded decision onto a completion that has already been
    /// built. Shared by the live-finish path and the crash-recovery path so
    /// the two can never drift apart.
    ///
    /// `repsCompleted` is resolved HERE, from the phases the completion is
    /// actually carrying, because it is a whole-run count — see
    /// `RepSkipRecord`.
    private static func applyDecisions(
        to completion: inout WatchCompletion,
        ceilingLift: CeilingLiftRecord?,
        repSkips: [RepSkipRecord],
        recoveryExtensions: [RecoveryExtensionRecord],
        ruleOutcomes: [RuleOutcome]? = nil
    ) {
        // The bail, taken or declined. Both answers travel: a declined bail is
        // evidence the runner was offered the out and chose to finish, which
        // the recap reasons about differently from never having been asked.
        ruleOutcomes?.forEach { completion.recordRuleOutcome($0) }

        if let l = ceilingLift {
            completion.ceilingLift = WatchCompletion.CeilingLift(
                ceilingBpm: l.ceilingBpm,
                readingBpm: l.readingBpm,
                phaseIndex: l.phaseIndex,
                phaseLabel: l.phaseLabel,
                atMi: l.atMi,
                atSec: l.atSec
            )
        }
        // Whole-run tally of reps actually run, for "Five of six".
        let repsRun = completion.phases.filter { $0.type == "work" && $0.completed }.count
        for s in repSkips {
            completion.recordRepSkip(WatchCompletion.RepSkip(
                repIndex: s.repIndex,
                repCount: s.repCount > 0 ? s.repCount : nil,
                repsCompleted: repsRun,
                phaseIndex: s.phaseIndex,
                phaseLabel: s.phaseLabel,
                atMi: s.atMi,
                atSec: s.atSec
            ))
        }
        for e in recoveryExtensions {
            completion.recordRecoveryExtension(WatchCompletion.RecoveryExtension(
                afterRepIndex: e.afterRepIndex,
                beforeRepIndex: e.beforeRepIndex,
                repCount: e.repCount,
                addedSec: e.addedSec,
                phaseIndex: e.phaseIndex,
                phaseLabel: e.phaseLabel,
                atSec: e.atSec
            ))
        }
    }

    // MARK: - Controls the 0821 boards drive
    //
    // Thin wrappers over behaviour the engine already had. They exist so a
    // board can be a closure and a label, with no state machine of its own.

    /// Pause / resume from the one control that does both.
    func togglePause() {
        isPaused ? resume() : pause()
    }

    /// Manual lap, from the steady-run controls. Banks the split internally
    /// and marks it with a haptic.
    ///
    /// Deliberately does NOT fire a takeover: the engine's only split cue
    /// reads "Mile N", and a lap the runner cut by hand is not a mile
    /// boundary. Drawing one would be the first number on these boards that
    /// is not a reading. The automatic mile splits are untouched — this
    /// keeps its own bookkeeping so a manual lap cannot renumber them.
    func lap() {
        guard state == .running else { return }
        lapCount += 1
        lastLapElapsedSec = totalElapsedSec
        // `.split` · the same family a mile boundary belongs to (a note
        // about effort that has not changed), which is exactly what a lap
        // the runner cut by hand is. Named through the moment vocabulary
        // rather than the frozen legacy palette.
        Haptics.play(moment: .split)
        saveSnapshot()
    }

    /// Laps the runner cut by hand, and the clock at the last one.
    private(set) var lapCount: Int = 0
    private(set) var lastLapElapsedSec: Int = 0
    /// Seconds since the last manual lap (or since the start).
    var lapElapsedSec: Int { max(0, totalElapsedSec - lastLapElapsedSec) }

    /// End confirm. `save: true` closes the run out normally — completed in
    /// overtime, abandoned mid-plan — and the completion (decisions and all)
    /// goes up the usual way. `save: false` is Discard: the run is thrown
    /// away and nothing is sent.
    ///
    /// Known limit, stated rather than hidden: discard still ENDS the
    /// HealthKit session through the tracker's normal `end()`, which writes
    /// the HKWorkout to Health. Leaving a live session running would be
    /// worse (battery, a phantom workout, a recovery prompt on next
    /// launch), and discarding an active HK session needs a tracker call
    /// that does not exist yet. What discard reliably guarantees is that no
    /// faff completion is built and none is sent.
    func finish(save: Bool) {
        guard state == .running else { return }
        if save { abandon(); return }
        stopTimer()
        Self.clearSnapshot()
        if let tracker {
            // DISCARD, not end. `end()` finishes the builder and writes the
            // HKWorkout to Health — a runner who threw a run away still found
            // it in their rings. `discard()` is the call that actually means
            // discard, and it clears the session so the next launch's recovery
            // sweep cannot resurrect what was just thrown away.
            Task { await tracker.discard() }
        }
        reset()
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

        // ─── The wrist decisions (0821 · 2026-08-21) ─────────────────
        // OPTIONAL, and that is load-bearing: a snapshot written by an
        // older build has no such key, and the synthesized decoder reads
        // an Optional with decodeIfPresent — so an in-flight run that
        // started before this shipped still recovers instead of failing
        // to decode and losing the whole run.
        //
        // Decisions are here at all because "the watch does not quietly
        // forget" has to survive the watch dying. A ceiling lifted at
        // mile 4 must still reach the phone when the process is killed
        // at mile 9.
        var decisions: Decisions? = nil

        struct Decisions: Codable {
            var ceilingLift: CeilingLiftRecord? = nil
            var repSkips: [RepSkipRecord]? = nil
            var recoveryExtensions: [RecoveryExtensionRecord]? = nil
            var bail: RuleOutcome? = nil
            /// Seconds added to the phase that was in flight, so a
            /// recovered recovery does not silently shed its extension.
            var phaseAddedSec: Int? = nil

            var isEmpty: Bool {
                ceilingLift == nil && (repSkips?.isEmpty ?? true)
                    && (recoveryExtensions?.isEmpty ?? true) && bail == nil
                    && (phaseAddedSec ?? 0) == 0
            }
        }

        func decodedWorkout() -> WatchWorkout? {
            try? JSONDecoder().decode(WatchWorkout.self, from: workoutJSON)
        }
    }

    /// The decisions taken so far, packed for the snapshot. Nil when the run
    /// has been unremarkable, so an ordinary run's snapshot is the same size
    /// it always was.
    private var decisionsForSnapshot: RunSnapshot.Decisions? {
        let d = RunSnapshot.Decisions(
            ceilingLift: ceilingLiftRecord,
            repSkips: repSkipRecords.isEmpty ? nil : repSkipRecords,
            recoveryExtensions: recoveryExtensionRecords.isEmpty ? nil : recoveryExtensionRecords,
            bail: bailOutcome,
            phaseAddedSec: phaseAddedSec > 0 ? phaseAddedSec : nil
        )
        return d.isEmpty ? nil : d
    }

    /// The inverse of `decisionsForSnapshot`, for the RESUME path.
    private func restoreDecisions(_ d: RunSnapshot.Decisions?) {
        clearDecisions()
        guard let d else { return }
        ceilingLiftRecord = d.ceilingLift
        ceilingLifted = d.ceilingLift != nil
        repSkipRecords = d.repSkips ?? []
        skippedRepOrdinals = Set(repSkipRecords.map { $0.repIndex })
        recoveryExtensionRecords = d.recoveryExtensions ?? []
        bailOutcome = d.bail
        bailAnswered = d.bail != nil
        bailTaken = d.bail?.actionTaken ?? false
        phaseAddedSec = max(0, d.phaseAddedSec ?? 0)
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
            savedAtEpoch: Date.now.timeIntervalSince1970,
            decisions: decisionsForSnapshot
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
        // Restore every decision the runner had already taken. Without this
        // a crash would quietly un-answer the bail (the board would ask a
        // second time), un-lift the ceiling (the guardrail would start
        // flashing again at a limit the runner had already dismissed), and
        // drop the skips and extensions off the completion entirely. Absent
        // on a snapshot written before this shipped, which reads as "no
        // decisions" — the honest answer for a build that could not take
        // any.
        restoreDecisions(snap.decisions)
        isPaused = false
        pauseStart = nil
        prepDrift()
        workoutJSONCache = snap.workoutJSON
        lastSnapshotElapsedSec = totalElapsedSec
        persistSnapshot()
        Haptics.play(moment: .resumed)
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

        var out = WatchCompletion(
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
        // Decisions survive the crash. They were persisted to the snapshot at
        // the moment they were taken, so an END & SAVE after a watch reboot
        // still tells the phone that the runner lifted the ceiling, skipped
        // rep four and bought thirty seconds twice. The route and the climb
        // died with the old process; the decisions did not.
        if let d = snapshot?.decisions {
            applyDecisions(
                to: &out,
                ceilingLift: d.ceilingLift,
                repSkips: d.repSkips ?? [],
                recoveryExtensions: d.recoveryExtensions ?? [],
                // The snapshot carries the bail so a run that died at mile 9
                // still reports a decision taken at mile 4. This is a static
                // recovery path with no live engine, so it reads the answer
                // off the snapshot rather than off `ruleOutcomesForWire`.
                ruleOutcomes: d.bail.map { [$0] }
            )
        }
        return out
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
        Haptics.play(moment: .finish)
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

        var out = WatchCompletion(
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
        // The wrist decisions ride the SAME POST — no second request, no
        // separate endpoint. Fields stay absent when nothing was decided, so
        // an unremarkable run's body is byte-identical to what it sent before
        // any of this existed.
        //
        // ONE DECISION IS STILL GROUNDED, and it is stated here rather than
        // left to be discovered: THE BAIL. The server has read
        // `ruleOutcomes` since 2026-06-09 (complete/route.ts, and run-recap
        // reasons about it — a taken bail leads the facts, a declined one
        // gets "noted, not judged"), but `WatchCompletion` in
        // WatchWorkoutModels.swift has no such stored property, so there is
        // no field to write it to and an extension cannot add one. The
        // engine records BOTH answers and survives a crash with them
        // (`recordBail`, `ruleOutcomesForWire`); they simply cannot leave
        // the watch yet.
        //
        // The whole fix is one property on that struct plus its helper,
        // which is that file's owner to add:
        //
        //     var ruleOutcomes: [WorkoutEngine.RuleOutcome]? = nil
        //     mutating func recordRuleOutcome(_ o: WorkoutEngine.RuleOutcome) {
        //         ruleOutcomes = (ruleOutcomes ?? []) + [o]
        //     }
        //
        // and then, here:  ruleOutcomesForWire?.forEach { out.recordRuleOutcome($0) }
        // Absent when nothing was paused, so the field never ships a zero.
        out.pausedSec = totalPausedSec > 0 ? totalPausedSec : nil
        Self.applyDecisions(
            to: &out,
            ceilingLift: ceilingLiftRecord,
            repSkips: repSkipRecords,
            recoveryExtensions: recoveryExtensionRecords,
            ruleOutcomes: ruleOutcomesForWire
        )
        return out
    }
}
