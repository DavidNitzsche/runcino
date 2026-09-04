//
//  BeltSession.swift
//  faff.run iPhone · the live state of an indoor belt session, in a model.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY THIS IS NOT VIEW STATE
//
//  David ran on 2026-08-20, moved the belt speed on the app's own ± steppers,
//  watched the number change on screen, and the recorded run came back at a
//  distance that number could not have produced. The display and the
//  integrator disagreed.
//
//  The stored row bounds it precisely. The run integrated to 4.26 mi over
//  2250 s closing at 6.8 mph; a flat 6.8 for that whole duration is 4.25 mi.
//  So the TOTAL time the integrator ever spent above 6.8 is worth 18-54
//  mph-seconds — between one and four minutes' worth of a small raise, out of
//  a 37:30 session. A runner who moved the belt a couple of times and
//  finished at 6.8 cannot produce that: ten minutes at +0.4 mph alone would
//  have stored 4.32. The integrator was reading a value the screen was not.
//
//  The mechanism was the recorder living in the view:
//
//      .background(TimelineView(.periodic(from: .now, by: 1.0)) { ctx in
//          Color.clear.onChange(of: ctx.date) { _, now in tick(at: now) }
//      })
//
//  `tick` is a method on a View STRUCT, so the action closure captures `self`
//  by value — including `speedMph` as it stood when that closure was made.
//  The closure lives in a `.background` subtree with its own identity, and
//  nothing guarantees it is rebuilt when the runner taps a stepper. The
//  display re-reads `@State` on every render and is always right; the
//  captured copy is right only until the next tap, and comes back into sync
//  only when something unrelated happens to rebuild that subtree. Stale most
//  of the time, refreshed occasionally — which is exactly the sliver of
//  raised speed the row records.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE INVARIANT THIS TYPE EXISTS TO HOLD
//
//  No view closure sits between a tap and the integral.
//
//  `BeltSession` is a CLASS. The clock's callback captures `self` weakly —
//  a reference, not a snapshot — and `tick` reads `self.speedMph`, a stored
//  property, at the instant it runs. A tap calls `setSpeed` on the same
//  object. There is no copy anywhere on that path for a render cycle to
//  leave behind, so the staleness class is not mitigated here, it is absent.
//
//  That is a claim a test can falsify rather than a claim about SwiftUI
//  semantics, which is what got this wrong the first time. The falsification
//  captures the tick entry point ONCE, exactly as a timer registration does,
//  taps the stepper, invokes the CAPTURED closure, and asserts the raise
//  reached the integral. The same test run against a struct-shaped recorder
//  fails, which is how we know it has teeth.
//
//  Everything that determines a RECORDED NUMBER lives here: belt speed,
//  incline, the integrator, the segment cursor, and the per-segment actuals.
//  The views own rendering, heart rate, the watch bridge and payload
//  assembly — none of which can corrupt a distance by going stale.
//
//  ─────────────────────────────────────────────────────────────────────────
//  TREADMILL-STATE-MACHINE-1 (2026-09-03) · THE SECOND STALE-STATE DEFECT,
//  AND WHY THIS TYPE IS NOW THE ONLY PLACE "WHAT PHASE" IS ANSWERED
//
//  A real hill session (today's) did not auto-advance from warm-up into
//  intervals without a pause/resume, cooldown's speed did not update until
//  another control was touched, and cooldown showed no remaining time at
//  all. Root cause, read from the code that shipped: `LiveRunTreadmillV5`'s
//  DISPLAY read "what phase am I in" from `LiveRunPhaseWalk.walk(phases:
//  elapsedSec:)` — a pure re-derivation from TOTAL elapsed time — while this
//  type's RECORDER answered the same question from `belt.segElapsedSec`, a
//  SEPARATE, SEGMENT-LOCAL counter, via `autoAdvanceIfDue()`. Two
//  independent walks over the same phase list is this app's own named
//  defect class (Rule 16 · "one quantity, one name") and it is why the
//  numbers the runner could act on (belt speed/incline) lagged the number
//  the runner could see (the interval label) until something — a pause/
//  resume, a stray control tap — forced a resync.
//
//  The fix is not a new formula. `LiveRunPhaseWalk.walk` was already
//  correct; it just had no one calling it from here. `configurePhases`
//  below hands this type the SAME `[WatchPhase]` array the view's own
//  `walk` property reads, and `advanceToCanonicalPhase()` calls the SAME
//  function with the SAME total elapsed seconds every tick. The display and
//  the recorder cannot disagree because they are now, by construction, the
//  same computation — not two implementations kept manually in sync.
//
//  This also makes the segment cursor SURVIVE an interruption without a
//  pause/resume trick: `BeltTracker`'s own gap policy already credits a
//  backgrounding gap on the next tick (see BeltTracker.swift's header), so
//  the moment a stalled timer resumes — or `catchUp(at:)` is called
//  explicitly on `scenePhase` returning to `.active`, see the view — elapsed
//  time jumps forward and `advanceToCanonicalPhase()` walks straight to the
//  correct phase in one step, closing any phases jumped over honestly
//  (unwitnessed, not fabricated) rather than requiring the runner to notice
//  and nudge it.
//

import Foundation
import Combine

@MainActor
final class BeltSession: ObservableObject {

    /// One segment of the session, as the plan asks for it. Labels and types
    /// stay in the view; this is only what the recorder needs.
    struct SegmentPlan: Equatable {
        var durationSec: Int
        var targetMph: Double
        var targetInclinePct: Double
    }

    // ── Live state · every one of these is read by `tick` at call time ──

    @Published private(set) var speedMph: Double
    @Published private(set) var inclinePct: Double
    /// The integrator.
    ///
    /// ─────────────────────────────────────────────────────────────────────
    /// DELIBERATELY NOT `@Published` · IT USED TO BE, AND IT COST A COPY OF
    /// THE WHOLE SAMPLE BUFFER EVERY SECOND
    ///
    /// `BeltTracker` is a struct carrying `segSamples: [BeltSample]`, and
    /// `Published.wrappedValue` exposes only a getter and a setter — no
    /// `_modify` coroutine. So `belt.advance(...)` is not an in-place
    /// mutation: it is get, mutate the copy, set. During the mutation the
    /// wrapper's own storage still holds the original, so the sample array's
    /// buffer is referenced twice and the `append` inside `advance` triggers
    /// a full copy-on-write.
    ///
    /// Measured, not assumed — a probe that reserves capacity so no growth
    /// realloc can be mistaken for COW, then appends 200 times through each
    /// shape:
    ///
    ///     @Published struct mutation: buffer reallocated on 200/200 appends
    ///     plain     struct mutation: buffer reallocated on   0/200 appends
    ///
    /// `tick` advances the belt once a second and a sample lands every five,
    /// so at second t of a segment the copy is t/5 elements. Over a segment
    /// of T seconds that is Σ(t/5) ≈ T²/10 element copies: 1.3M for an hour,
    /// 11.7M (~470 MB of memcpy at 40 bytes a sample) for three. Not a leak —
    /// each copy is freed — but unbounded WORK that grows linearly through
    /// the run, on the actor that also has to service GPS fixes and HealthKit
    /// drains. This app has already lost a run to main-actor starvation once
    /// (see `PhoneRunTracker.startClock`).
    ///
    /// Nothing is lost by dropping the wrapper: every mutation site here
    /// (`begin`/`resync`/`advance`/`closeSegment`) is followed in the same
    /// synchronous block by a write to `tickStamp`, `isRunning` or
    /// `closedCount`, all of which are `@Published`. The console re-renders
    /// on those and re-reads `session.belt` fresh. No `$belt` subscriber
    /// exists anywhere in the app.
    private(set) var belt: BeltTracker
    @Published private(set) var isRunning = false
    @Published private(set) var segmentIndex = 0
    /// Bumps whenever a segment closes, so the view can close its heart-rate
    /// window at the same boundary without owning the boundary itself.
    @Published private(set) var closedCount = 0
    /// Bumps every tick, so the view can do its own follow-up work (the watch
    /// keepalive) inside SwiftUI's normal update cycle. Nothing that affects a
    /// recorded number hangs off this.
    @Published private(set) var tickStamp: Date

    /// Wall-clock of the first start. Nil until the runner begins.
    private(set) var startedAt: Date?
    /// Per-segment slices of the one integral, keyed by segment index.
    private(set) var actuals: [Int: BeltSegmentActual] = [:]
    /// True once the runner has moved the belt themselves inside the CURRENT
    /// segment. Their input is the only measurement this console has, so a
    /// segment boundary must not overwrite it with the plan's target.
    private(set) var runnerSetSpeed = false
    /// Latest heart rate, pushed in by the view. A plain stored property, not
    /// a closure — the samples ride on it and nothing here should hold a
    /// reference back into a view.
    var currentBpm: Int?

    private var plan: [SegmentPlan] = []
    /// The full authored phase list, set only by `configurePhases` (the V5
    /// console). Empty for the legacy `TreadmillView` caller, which still
    /// only ever calls `configure(plan:)` — that path keeps its original
    /// segment-local `autoAdvanceIfDue()` behavior unchanged, untouched by
    /// this file's canonical-walk addition. See the file header.
    private var watchPhases: [WatchPhase] = []
    /// One runner override per PHASE TYPE, not per phase instance — "change
    /// one hill rep, the rest of this set's reps follow" (Stage 3). Recovery
    /// and work are tracked separately so a recovery-pace edit can never
    /// leak into the next hill rep and vice versa. Warm-up/cooldown are
    /// singletons in every plan this app authors, so a "type" override on
    /// either is equivalent to a one-off edit — harmless, not a special case.
    private(set) var speedOverrideByType: [WatchPhaseType: Double] = [:]
    private(set) var inclineOverrideByType: [WatchPhaseType: Double] = [:]
    /// Bumped every time the phase actually changes (auto or skip), so the
    /// view can fire a cue exactly once per transition without owning the
    /// boundary logic itself. Carries enough for the cue to speak the right
    /// sentence without re-deriving anything.
    @Published private(set) var lastTransition: PhaseTransition?

    struct PhaseTransition: Equatable {
        let from: WatchPhase?
        let to: WatchPhase
        let auto: Bool
    }

    /// The phase type the belt is currently on, for override bookkeeping.
    /// Nil only when no phases have been configured at all (a free-run
    /// session with no plan).
    private var currentPhaseType: WatchPhaseType? {
        watchPhases.indices.contains(segmentIndex) ? watchPhases[segmentIndex].type : nil
    }

    private var timer: Timer?

    /// The console's own idempotency key, carried so the checkpoint can be
    /// matched to the run that wrote it — a finished run must never clear a
    /// live one's file.
    let workoutId: String

    /// Defaulted so a console that stamps its id later can simply adopt the
    /// session's — one id per belt run, generated once, rather than two that
    /// have to be kept in step.
    init(workoutId: String = "trd_\(UUID().uuidString)",
         speedMph: Double = 5.5, inclinePct: Double = 1.0, now: Date = .now) {
        self.workoutId = workoutId
        self.speedMph = speedMph
        self.inclinePct = inclinePct
        self.belt = BeltTracker(now: now)
        self.tickStamp = now
    }

    // No `deinit`. `Timer.invalidate()` must be sent on the thread the timer
    // was installed on (RunLoop.main), and a `deinit` cannot promise that:
    // it is nonisolated, so the last release can land on any executor. The
    // clock retires itself instead — see `startClock`.

    // ── Plan ────────────────────────────────────────────────────────────

    /// Hand the recorder the shape of the session. Safe to call again while
    /// the plan is still loading; ignored once the run has started, because
    /// re-cutting the segments mid-run would orphan the actuals already
    /// recorded against them.
    func configure(plan: [SegmentPlan]) {
        guard startedAt == nil else { return }
        self.plan = plan
        if let first = plan.first, !runnerSetSpeed {
            speedMph = first.targetMph
            inclinePct = first.targetInclinePct
        }
    }

    var segmentCount: Int { plan.count }
    func segment(at i: Int) -> SegmentPlan? { plan.indices.contains(i) ? plan[i] : nil }
    var currentSegment: SegmentPlan? { segment(at: segmentIndex) }

    /// The current segment's asked speed when the belt is not on it. Nil when
    /// they agree — nothing to offer.
    var pendingTargetMph: Double? {
        guard let seg = currentSegment else { return nil }
        return abs(seg.targetMph - speedMph) > 0.05 ? seg.targetMph : nil
    }

    /// The V5 console's entry point — hands over the FULL authored phase
    /// list, not just the reduced `SegmentPlan` shape, so this type can walk
    /// phase boundaries with the exact same function and the exact same
    /// input the view's own display reads. See the file header. Calls
    /// through to `configure(plan:)` for the existing SegmentPlan-shaped
    /// bookkeeping (`currentSegment`, target adoption) — additive, not a
    /// replacement, so nothing here changes for a caller (legacy
    /// `TreadmillView`) that never calls this.
    func configurePhases(_ phases: [WatchPhase]) {
        guard startedAt == nil else { return }
        watchPhases = phases
        configure(plan: phases.map {
            SegmentPlan(durationSec: $0.durationSec, targetMph: Self.nominalMph(for: $0),
                        targetInclinePct: Self.nominalInclinePct(for: $0))
        })
    }

    /// TREADMILL-STRUCTURE-1's fallback chain, moved here from the view so
    /// `configurePhases` and the view's own "phase never reached" payload
    /// fallback read the SAME nominal target — the view no longer keeps a
    /// second copy. Server-priced treadmill speed/incline first
    /// (`WatchPhase.treadmillSpeedMph`'s doc comment), then a genuinely
    /// paced phase's own target, then the flat per-type defaults that
    /// predate either — never a fabricated third guess.
    static func nominalMph(for phase: WatchPhase) -> Double {
        if let speed = phase.treadmillSpeedMph, speed > 0 { return speed }
        if let target = phase.targetPaceSPerMi, target > 0 {
            return (3600.0 / Double(target) * 10).rounded() / 10
        }
        switch phase.type {
        case .warmup:   return 5.5
        case .work:     return 7.0
        case .recovery: return 5.0
        case .cooldown: return 5.0
        }
    }

    static func nominalInclinePct(for phase: WatchPhase) -> Double {
        if let incline = phase.treadmillInclinePct, incline > 0 { return incline }
        return 1.0
    }

    // ── The runner's inputs ─────────────────────────────────────────────

    /// The runner's own belt reading. Records that THEY set it, so the next
    /// segment boundary offers its target instead of overwriting them — and,
    /// TREADMILL-STATE-MACHINE-1, records it as this PHASE TYPE's standing
    /// override, so every later equivalent rep in this set adopts it too
    /// (Stage 3 — "change one rep, the set follows") until reset or the
    /// session ends.
    func setSpeed(_ mph: Double) {
        speedMph = mph
        runnerSetSpeed = true
        if let type = currentPhaseType { speedOverrideByType[type] = mph }
    }

    /// Step the belt by `notches` in the runner's own display unit and store
    /// the result back in mph. See `BeltSpeed`.
    func stepSpeed(notches: Double, unit: DistanceUnit) {
        setSpeed(BeltSpeed.stepped(mph: speedMph, by: notches, unit: unit))
    }

    func setIncline(_ pct: Double) {
        inclinePct = Swift.min(Swift.max(pct, 0), 15)
        runnerSetSpeed = true
        if let type = currentPhaseType { inclineOverrideByType[type] = inclinePct }
    }

    func stepIncline(_ delta: Double) {
        setIncline(((inclinePct + delta) * 2).rounded() / 2)
    }

    /// True while the phase the belt is on right now carries a standing
    /// runner override — drives the "Custom pace" badge and Reset action.
    var hasOverrideForCurrentPhase: Bool {
        guard let type = currentPhaseType else { return false }
        return speedOverrideByType[type] != nil || inclineOverrideByType[type] != nil
    }

    /// Drop this phase type's standing override and, if the belt is on that
    /// type right now, snap immediately back to the plan's own target —
    /// Stage 3's "simple reset-to-plan action." Never touches any OTHER
    /// type's override.
    func resetOverride(for type: WatchPhaseType) {
        speedOverrideByType[type] = nil
        inclineOverrideByType[type] = nil
        guard currentPhaseType == type, let seg = currentSegment else { return }
        speedMph = seg.targetMph
        inclinePct = seg.targetInclinePct
        runnerSetSpeed = false
    }

    // ── Durability ──────────────────────────────────────────────────────
    //
    // A TREADMILL RUN USED TO PERSIST NOTHING UNTIL "End".
    //
    // The outdoor recorder writes a checkpoint every ten seconds and
    // re-submits it on the next console open, so a mid-run teardown costs at
    // most ten seconds. The belt had no equivalent, and the teardown is not
    // hypothetical: any 401 posts `.faffSessionExpired`, whose handler
    // re-roots to sign-in and destroys the shell holding the live-run cover —
    // and FaffApp's own comment says that handler "can fire on a perfectly
    // valid session". An hour on a belt, gone, with nothing on disk.
    //
    // Same shape as `PhoneRunCheckpoint` deliberately: same ten-second
    // cadence, same serial queue so a clear cannot be overtaken by a write,
    // same id-matched clear so a finished run cannot delete a live one.

    private static let checkpointIO = DispatchQueue(label: "run.faff.belt-checkpoint")

    static var checkpointURL: URL? {
        guard let dir = try? FileManager.default.url(for: .applicationSupportDirectory,
                                                     in: .userDomainMask,
                                                     appropriateFor: nil,
                                                     create: true) else { return nil }
        return dir.appendingPathComponent("belt-run-checkpoint.json")
    }

    private var lastCheckpointAt: Date?

    private func writeCheckpoint(at now: Date, force: Bool = false) {
        if !force, let last = lastCheckpointAt, now.timeIntervalSince(last) < 10 { return }
        guard let startedAt else { return }
        lastCheckpointAt = now
        let cp = BeltCheckpoint(workoutId: workoutId,
                                startedAt: startedAt,
                                updatedAt: now,
                                elapsedSec: Int(belt.elapsedSec.rounded()),
                                distanceMi: belt.distanceMi,
                                elevGainFt: belt.elevGainFt,
                                speedMph: speedMph,
                                inclinePct: inclinePct,
                                speedOverrides: speedOverrideByType.isEmpty ? nil :
                                    Dictionary(uniqueKeysWithValues: speedOverrideByType.map { ($0.key.rawValue, $0.value) }),
                                inclineOverrides: inclineOverrideByType.isEmpty ? nil :
                                    Dictionary(uniqueKeysWithValues: inclineOverrideByType.map { ($0.key.rawValue, $0.value) }),
                                pausedSec: belt.pausedSec,
                                unmeasuredSec: belt.unmeasuredSec,
                                unmeasuredMi: belt.unmeasuredMi,
                                droppedSec: belt.droppedSec)
        guard let url = Self.checkpointURL,
              let data = try? JSONEncoder().encode(cp) else { return }
        Self.checkpointIO.async { try? data.write(to: url, options: .atomic) }
    }

    /// Only removes the checkpoint when it is the one for `workoutId`, so a
    /// late clear from a finished run can never delete a live one.
    static func clearCheckpoint(workoutId: String?) {
        guard let url = checkpointURL else { return }
        checkpointIO.async {
            if let workoutId,
               let data = try? Data(contentsOf: url),
               let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
               let existing = obj["workoutId"] as? String,
               existing != workoutId {
                return
            }
            try? FileManager.default.removeItem(at: url)
        }
    }

    /// The checkpoint left by a run this app died in the middle of, if any.
    static func interruptedRun() -> BeltCheckpoint? {
        guard let url = checkpointURL,
              let data = try? Data(contentsOf: url),
              let cp = try? JSONDecoder().decode(BeltCheckpoint.self, from: data) else { return nil }
        return cp
    }

    // ── Clock ───────────────────────────────────────────────────────────

    /// Begin. Idempotent — a second call resumes rather than restarting.
    func start(at now: Date = .now) {
        if startedAt == nil {
            startedAt = now
            belt.begin(at: now)
        } else {
            belt.resync(to: now)
        }
        isRunning = true
        startClock()
        writeCheckpoint(at: now, force: true)
    }

    func pause(at now: Date = .now) {
        belt.resync(to: now)
        isRunning = false
    }

    func resume(at now: Date = .now) {
        belt.resync(to: now)
        isRunning = true
    }

    func togglePause(at now: Date = .now) {
        if isRunning { pause(at: now) }
        else if startedAt == nil { start(at: now) }
        else { resume(at: now) }
    }

    /// Stop the clock entirely. The accumulated run is untouched.
    func stopClock() {
        timer?.invalidate()
        timer = nil
        isRunning = false
    }

    /// The clock, on the run loop rather than in the render tree.
    ///
    /// `.common` mode so it keeps firing during scroll and touch tracking.
    /// The closure captures `self` WEAKLY — a reference to this object, not a
    /// copy of its fields — so `tick` reads whatever `speedMph` is at the
    /// moment it runs. That is the whole point of this file.
    ///
    /// The block also takes the timer as its parameter and retires it once
    /// the session is gone. `RunLoop.main` owns this timer independently of
    /// the session, so a session deallocated mid-run — the console torn down
    /// without End, which `.faffSessionExpired` does on any 401 — would
    /// otherwise leave it firing every second for the life of the process.
    /// Invalidating from the block runs on the run loop's own thread, which
    /// is where `Timer.invalidate()` is required to be sent.
    private func startClock() {
        guard timer == nil else { return }
        let t = Timer(timeInterval: 1.0, repeats: true) { [weak self] timer in
            guard let self else { timer.invalidate(); return }
            Task { @MainActor in self.tick(at: Date()) }
        }
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    // ── The tick ────────────────────────────────────────────────────────

    /// Advance the session to `now`. Reads `speedMph` and `inclinePct` from
    /// this object, at this instant.
    ///
    /// Internal rather than private so the falsification harness can invoke it
    /// through a closure captured once, the way the timer does.
    func tick(at now: Date) {
        guard isRunning else {
            belt.resync(to: now)
            tickStamp = now
            return
        }
        belt.advance(to: now, speedMph: speedMph, inclinePct: inclinePct, bpm: currentBpm)
        autoAdvanceIfDue()
        tickStamp = now
        writeCheckpoint(at: now)
    }

    /// Force an immediate recompute against the wall clock right now,
    /// without waiting for the 1 Hz timer's next natural fire. `RunLoop`
    /// timers do not fire AT ALL while the process is suspended — the timer
    /// is not late, it does not run — so the moment the app is active again
    /// is the moment this must be called explicitly, from the view's own
    /// `scenePhase` observation, rather than trusting the timer to have kept
    /// up on its own. `BeltTracker`'s own gap policy (see its header) is
    /// what makes the resulting jump honest: the elapsed gap is credited at
    /// the last known belt settings and marked unmeasured, never invented.
    /// Idempotent and cheap when nothing was actually missed.
    func catchUp(at now: Date = .now) {
        guard isRunning else { return }
        tick(at: now)
    }

    /// Auto-advance INTERMEDIATE phases when they run out. The last (or
    /// only) phase never auto-advances or auto-ends — the runner can keep
    /// going past the target and taps End when they are done.
    ///
    /// TREADMILL-STATE-MACHINE-1 · when `watchPhases` is set (the V5
    /// console), this delegates to `advanceToCanonicalPhase()` — the SAME
    /// cumulative-duration walk the view's own display reads — rather than
    /// this type's own, separate segment-local threshold. See the file
    /// header for why two independent answers to "what phase" was the
    /// actual defect. The legacy caller (`watchPhases` empty) keeps its
    /// original segment-local check, unchanged, below.
    private func autoAdvanceIfDue() {
        guard !watchPhases.isEmpty else {
            guard let seg = currentSegment, seg.durationSec > 0 else { return }
            guard Int(belt.segElapsedSec) >= seg.durationSec else { return }
            guard segmentIndex + 1 < plan.count else { return }
            let from = currentSegmentWatchPhase
            closeCurrentSegment(completed: true)
            segmentIndex += 1
            adoptTargetOrKeepRunnerSpeed()
            announceTransition(from: from, auto: true)
            return
        }
        advanceToCanonicalPhase()
    }

    /// THE canonical phase-boundary check. Walks the exact same function,
    /// the exact same phase list and the exact same total elapsed seconds
    /// the view's `LiveRunPhaseWalk.walk` display call does — so the
    /// recorder's segment cursor and the runner's own eyes can never
    /// disagree. Never advances past the FINAL phase automatically (mirrors
    /// the legacy branch's own "last segment never auto-ends" rule):
    /// `LiveRunPhaseWalk.walk` pins the last phase once elapsed exceeds the
    /// plan's own estimate, so `targetIndex` naturally stops climbing there.
    private func advanceToCanonicalPhase() {
        guard let walked = LiveRunPhaseWalk.walk(phases: watchPhases, elapsedSec: belt.elapsedSecInt) else { return }
        let targetIndex = walked.phase.index
        guard targetIndex > segmentIndex else { return }
        // Ordinarily exactly one phase closes per tick. A very long
        // backgrounding gap, credited in one jump by BeltTracker's own gap
        // policy, can legitimately cross more than one short phase (a 60 s
        // hill rep, say) — each one still gets a real, honest close: the
        // FIRST gets whatever time/distance the belt actually accumulated
        // before the gap was noticed, every one after that closes at zero
        // (nothing was witnessed for it) rather than being silently skipped.
        while segmentIndex < targetIndex {
            let from = currentSegmentWatchPhase
            closeCurrentSegment(completed: true)
            segmentIndex += 1
            adoptTargetOrKeepRunnerSpeed()
            announceTransition(from: from, auto: true)
        }
    }

    /// Skip to the next phase. The one being left is an honest partial —
    /// never marked `completed`, whatever fraction of it actually ran is
    /// kept exactly as measured.
    func skip() {
        guard segmentIndex + 1 < plan.count else { return }
        let from = currentSegmentWatchPhase
        closeCurrentSegment(completed: false)
        segmentIndex += 1
        adoptTargetOrKeepRunnerSpeed()
        announceTransition(from: from, auto: false)
    }

    /// Close whatever segment is open, at End. `completed` only when it
    /// reached the duration it asked for.
    @discardableResult
    func finish() -> BeltSegmentActual? {
        let asked = currentSegment?.durationSec ?? 0
        let ran = Int(belt.segElapsedSec)
        closeCurrentSegment(completed: asked > 0 && ran >= asked)
        stopClock()
        return actuals[segmentIndex]
    }

    private var currentSegmentWatchPhase: WatchPhase? {
        watchPhases.indices.contains(segmentIndex) ? watchPhases[segmentIndex] : nil
    }

    private func closeCurrentSegment(completed: Bool) {
        var actual = belt.closeSegment(speedMph: speedMph, bpm: currentBpm)
        actual.completed = completed
        actuals[segmentIndex] = actual
        closedCount += 1
    }

    /// Publish the transition that just happened, for the view's cue engine.
    /// `to` is read AFTER `segmentIndex` has already advanced, so it names
    /// the phase the belt is now on, not the one just closed.
    private func announceTransition(from: WatchPhase?, auto: Bool) {
        guard let to = currentSegmentWatchPhase else { return }
        lastTransition = PhaseTransition(from: from, to: to, auto: auto)
    }

    /// A new segment carries a new TARGET. It does not carry a new
    /// measurement.
    ///
    /// TREADMILL-STATE-MACHINE-1 · falsified 2026-09-03 by
    /// `testAWorkOverrideNeverLeaksIntoRecovery` /
    /// `testARecoveryOverrideNeverLeaksIntoWork`, both red on the first
    /// version of this method: `runnerSetSpeed` is a single UNTYPED flag,
    /// set once by `setSpeed`/`setIncline` and only ever cleared here — so
    /// overriding a work rep left it `true` clear through the NEXT
    /// transition into recovery, where `!runnerSetSpeed` was false and the
    /// recovery target was never adopted at all. The work rep's number rode
    /// straight into recovery. `runnerSetSpeed` and the typed
    /// `speedOverrideByType`/`inclineOverrideByType` dictionaries were two
    /// mechanisms answering the same question and disagreeing — exactly
    /// this file's own named defect class, one level down.
    ///
    /// Fix: for the V5 console (`watchPhases` non-empty), the typed
    /// dictionaries are the ONLY authority — `runnerSetSpeed` plays no part
    /// in the decision, only in the legacy branch below, which keeps the
    /// ORIGINAL single-flag behavior verbatim for `Views/TreadmillView.swift`
    /// (untouched by this change, never phase-typed to begin with).
    private func adoptTargetOrKeepRunnerSpeed() {
        guard let seg = currentSegment else { runnerSetSpeed = false; return }
        guard let type = currentPhaseType else {
            // Legacy path only — no phase types to key an override on.
            if !runnerSetSpeed {
                speedMph = seg.targetMph
                inclinePct = seg.targetInclinePct
            }
            runnerSetSpeed = false
            return
        }
        speedMph = speedOverrideByType[type] ?? seg.targetMph
        inclinePct = inclineOverrideByType[type] ?? seg.targetInclinePct
        runnerSetSpeed = false
    }

    // ── Resume (relaunch mid-run) ───────────────────────────────────────

    /// Reconstruct a live session from a checkpoint written by an earlier
    /// instance of THIS SAME workout (`workoutId` already matched by the
    /// caller before calling this — see the view's `.task`). Recomputes
    /// `segmentIndex` from the SAME canonical walk everything else uses, so
    /// a runner relaunching mid-hill-rep reopens on that exact rep, not at
    /// phase 0 — Stage 2's "reconstruct the correct phase from persisted
    /// state and timestamps after interruption," not merely a salvage post.
    func resume(from cp: BeltCheckpoint, phases: [WatchPhase], now: Date = .now) {
        guard startedAt == nil else { return }
        watchPhases = phases
        configure(plan: phases.map {
            SegmentPlan(durationSec: $0.durationSec, targetMph: Self.nominalMph(for: $0),
                        targetInclinePct: Self.nominalInclinePct(for: $0))
        })
        belt = BeltTracker(now: now, elapsedSec: Double(cp.elapsedSec), distanceMi: cp.distanceMi,
                           elevGainFt: cp.elevGainFt, pausedSec: cp.pausedSec ?? 0,
                           unmeasuredSec: cp.unmeasuredSec ?? 0, unmeasuredMi: cp.unmeasuredMi ?? 0,
                           droppedSec: cp.droppedSec ?? 0)
        speedOverrideByType = Dictionary(uniqueKeysWithValues: (cp.speedOverrides ?? [:]).compactMap { k, v in
            WatchPhaseType(rawValue: k).map { ($0, v) }
        })
        inclineOverrideByType = Dictionary(uniqueKeysWithValues: (cp.inclineOverrides ?? [:]).compactMap { k, v in
            WatchPhaseType(rawValue: k).map { ($0, v) }
        })
        speedMph = cp.speedMph
        inclinePct = cp.inclinePct
        startedAt = cp.startedAt
        // Walk to the phase this elapsed time actually belongs in, closing
        // every phase in between exactly as `advanceToCanonicalPhase` would
        // have live — the runner missed watching those transitions happen,
        // not the transitions themselves.
        isRunning = true
        advanceToCanonicalPhase()
        startClock()
        tickStamp = now
    }
}

/// What survives a treadmill run the app was killed in the middle of.
///
/// Deliberately the belt's TOTALS rather than its sample streams: the point
/// is that the run exists at all, and a partial sample timeline is worth less
/// than the distance and the time. Mirrors `PhoneRunCheckpoint`, which makes
/// the same trade for the same reason.
struct BeltCheckpoint: Codable {
    let workoutId: String
    let startedAt: Date
    let updatedAt: Date
    let elapsedSec: Int
    let distanceMi: Double
    let elevGainFt: Double
    let speedMph: Double
    let inclinePct: Double
    // TREADMILL-STATE-MACHINE-1 · all optional, all decoding to `nil` on a
    // checkpoint written by an older build — a missing value here must never
    // fail the decode, only fall back to `resume(from:)`'s own zero
    // defaults (an un-overridden phase, an un-audited pause/gap total).
    var speedOverrides: [String: Double]? = nil
    var inclineOverrides: [String: Double]? = nil
    var pausedSec: Double? = nil
    var unmeasuredSec: Double? = nil
    var unmeasuredMi: Double? = nil
    var droppedSec: Double? = nil
}
