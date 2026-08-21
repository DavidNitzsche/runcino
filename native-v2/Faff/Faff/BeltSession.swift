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

    // ── The runner's inputs ─────────────────────────────────────────────

    /// The runner's own belt reading. Records that THEY set it, so the next
    /// segment boundary offers its target instead of overwriting them.
    func setSpeed(_ mph: Double) {
        speedMph = mph
        runnerSetSpeed = true
    }

    /// Step the belt by `notches` in the runner's own display unit and store
    /// the result back in mph. See `BeltSpeed`.
    func stepSpeed(notches: Double, unit: DistanceUnit) {
        setSpeed(BeltSpeed.stepped(mph: speedMph, by: notches, unit: unit))
    }

    func setIncline(_ pct: Double) {
        inclinePct = Swift.min(Swift.max(pct, 0), 15)
    }

    func stepIncline(_ delta: Double) {
        setIncline(((inclinePct + delta) * 2).rounded() / 2)
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
                                inclinePct: inclinePct)
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

    /// Auto-advance only INTERMEDIATE segments when they run out. The last
    /// (or only) segment never auto-advances or auto-ends — the runner can
    /// keep going past the target and taps End when they are done.
    private func autoAdvanceIfDue() {
        guard let seg = currentSegment, seg.durationSec > 0 else { return }
        guard Int(belt.segElapsedSec) >= seg.durationSec else { return }
        guard segmentIndex + 1 < plan.count else { return }
        closeCurrentSegment(completed: true)
        segmentIndex += 1
        adoptTargetOrKeepRunnerSpeed()
    }

    /// Skip to the next segment. The one being left is an honest partial.
    func skip() {
        guard segmentIndex + 1 < plan.count else { return }
        closeCurrentSegment(completed: false)
        segmentIndex += 1
        adoptTargetOrKeepRunnerSpeed()
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

    private func closeCurrentSegment(completed: Bool) {
        var actual = belt.closeSegment(speedMph: speedMph, bpm: currentBpm)
        actual.completed = completed
        actuals[segmentIndex] = actual
        closedCount += 1
    }

    /// A new segment carries a new TARGET. It does not carry a new
    /// measurement. Adopt the target only when the runner has not set the
    /// belt themselves in the segment just finished — otherwise their number
    /// stands and the new target is offered as a one-tap match instead.
    private func adoptTargetOrKeepRunnerSpeed() {
        if !runnerSetSpeed, let seg = currentSegment {
            speedMph = seg.targetMph
            inclinePct = seg.targetInclinePct
        }
        runnerSetSpeed = false
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
}
