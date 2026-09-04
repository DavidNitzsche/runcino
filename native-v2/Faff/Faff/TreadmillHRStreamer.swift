//
//  TreadmillHRStreamer.swift   (build 136)
//
//  Live HR feed for the iPhone TreadmillView. When the runner is wearing
//  an Apple Watch on the treadmill, the watch streams HR samples into
//  HealthKit; we read them here in ~5-30s latency batches and surface a
//  live bpm display + per-phase avg/max for the WatchCompletion payload.
//
//  Pattern mirrors HRAlerter.swift (phone-side HR ceiling alert) ·
//  HKObserverQuery triggers a drain via HKAnchoredObjectQuery, anchored
//  at the session start so we don't pick up old samples.
//
//  Lifecycle:
//   · start(from:) on the first play tick · idempotent
//   · closePhase() at every segment boundary · returns (avg, max) for
//     the just-closed phase, resets the phase buffer
//   · closeSession() at end-of-workout · returns session-level (avg, max)
//   · stop() on view dismiss (best-effort · observer keeps registered)
//
//  Non-watch users: currentBpm stays nil, closePhase returns (nil, nil),
//  the view shows no HR pill, payload's avgHr/maxHr fields stay null.
//  Backend resolveCalories tier 3 estimator already handles null HR
//  cleanly, so this fails gracefully end-to-end.
//
//  2026-08-27 · same bridge, five more metrics. The watch's active
//  `HKWorkoutSession` (TreadmillHRSession, watch-side) makes watchOS sample
//  running power / ground contact time / vertical oscillation / stride
//  length / active energy at the same fast cadence as HR — no new watch
//  session, no new WatchConnectivity message, just more anchored queries
//  riding the workout that is already open. `MetricChannel` below is that
//  same HR anchor/observer/drain safety logic (re-anchor guard, retire-
//  before-register, non-reentrant drain) generalized, so the five new
//  reads get the SAME care through one reviewed implementation instead of
//  five hand-copies with five chances to reintroduce a bug already fixed
//  once for HR. `closePhaseExtras()`/`closeSessionExtras()` are additive —
//  the HR-only `closePhase()`/`closeSession()` tuple and its existing call
//  sites (TreadmillView.swift, LiveRunTreadmillV5.swift) are untouched.
//
//  Field names match the existing HealthKit-IMPORT convention already on
//  `RunData` (avgPowerW / avgGctMs / avgVertOscCm / avgStrideLengthM in
//  web-v2/lib/runs/run-shape.ts, populated by HealthKitImporter.swift's
//  post-workout statAvg reads for outdoor runs) — this bridge is a second,
//  LIVE writer of the same fields, now also available for indoor treadmill
//  runs, which never had an HKWorkout to import running-dynamics from
//  before. Active energy is SUMMED, not averaged, into `kcal` — the
//  run-level calories field the treadmill completion payload has never
//  populated (see LiveRunTreadmillV5.buildCompletionPayload's own `kcal`
//  wiring for why that's the one worth filling, not a new field name).
//

import Foundation
import HealthKit

@MainActor
final class TreadmillHRStreamer: NSObject, ObservableObject {
    /// Most recent bpm seen · drives the live display. Nil until the
    /// first sample lands (or forever, if no watch is paired).
    @Published private(set) var currentBpm: Int?

    /// TREADMILL-LIVE-HR-1 (2026-09-03) · the complete, honest answer to
    /// "what is this console's own HR number right now" — see this file's
    /// sibling `TreadmillHRFreshness.swift` for the two-channel architecture
    /// (mirrored HKWorkoutSession vs. async HealthKit sync) and why freshness
    /// is computed from sample AGE, never from which channel produced it.
    /// `currentBpm` above is kept in sync with `snapshot.bpm` for the
    /// existing call sites that only ever wanted the number; new code should
    /// read `snapshot` for source/timestamp/state.
    @Published private(set) var snapshot: TreadmillHRSnapshot = .empty
    private var lastSampleAt: Date?
    private var lastSampleSource: TreadmillHRSource = .none
    /// True once `start(from:)` has been called for the current session —
    /// distinguishes "asked and waiting" (`.connecting`) from "never asked"
    /// (`.unavailable`), per Rule 11.
    private var attemptInFlight = false

    /// The mirrored copy of the watch's own `HKWorkoutSession` — see the
    /// file header. Non-nil once iOS has actually handed one over via
    /// `workoutSessionMirroringStartHandler`; nil the whole run if mirroring
    /// never attaches (no paired watch reachable at the right moment, an
    /// older OS, or a handshake this session cannot verify on real hardware —
    /// the async channel below is what keeps the console working in every
    /// one of those cases).
    private var mirroredSession: HKWorkoutSession?
    /// `HKLiveWorkoutBuilder` itself — not just `associatedWorkoutBuilder()`
    /// — is an iOS-26-only type ON THE PHONE (it has existed on watchOS for
    /// years; the iPhone-side live-mirrored builder is newer). This app's
    /// deployment target is 17.0, so the property cannot be typed
    /// `HKLiveWorkoutBuilder?` without breaking every earlier OS this app
    /// still supports. Stored type-erased; every read/write happens inside
    /// an `if #available(iOS 26.0, *)` block that casts it back — see
    /// `attachMirroredSession`/`stop()`/the delegate extension below. On
    /// iOS 17-25 this simply never gets set, and the async channel
    /// (`TreadmillHRFreshness.swift`'s `.asyncHealthKitSync`) is the whole
    /// story — never a crash, never a silent wrong answer.
    private var mirroredBuilderBox: Any?

    /// HKHealthStore is thread-safe per Apple's docs · reads happen via
    /// callbacks, no awaits on the store directly.
    nonisolated private let store = HKHealthStore()
    private var observerActive = false
    /// The registered observer, so it can actually be retired. `stop()` used
    /// to only flip `observerActive`, leaving the query live on the store —
    /// and `start()` executes a NEW one every time it re-anchors, so a
    /// console reopened inside one app launch accumulated observers, each
    /// still firing `drain` with its OWN (earlier) predicate. That is how a
    /// previous session's heart rate leaks into this one's average.
    private var observer: HKObserverQuery?
    private var anchor: HKQueryAnchor?
    /// True while a drain is in flight. See `drain`.
    private var isDraining = false
    /// Set when the observer fired during a drain, so the samples it was
    /// telling us about are collected rather than dropped.
    private var drainAgain = false
    /// The instant this stream is anchored at · the run's start, not the
    /// screen's. Kept so a later caller with a better answer can re-anchor.
    private var anchorDate: Date?

    /// Buffer for the current phase · cleared by closePhase().
    private var phaseSamples: [Double] = []
    /// Buffer for the whole session · cleared by closeSession().
    /// Kept separate so closePhase() doesn't disturb session-level stats.
    private var sessionSamples: [Double] = []

    // ── Running-form + energy channels · 2026-08-27 ─────────────────────
    //
    // Each is a `MetricChannel` (below) wired to its own quantity type/unit/
    // aggregation, riding the exact same watch workout session HR does.
    // `lazy` so `onUpdate` can close over `self` safely — the closure only
    // runs on first PROPERTY ACCESS, which is after `init` completes, never
    // during it.
    private lazy var powerChannel: MetricChannel = {
        let c = MetricChannel(store: store, type: HKQuantityType(.runningPower), unit: .watt(), aggregation: .average)
        c.onUpdate = { [weak self] v in self?.currentRunningPowerW = v }
        return c
    }()
    private lazy var gctChannel: MetricChannel = {
        let c = MetricChannel(store: store, type: HKQuantityType(.runningGroundContactTime),
                               unit: .secondUnit(with: .milli), aggregation: .average)
        c.onUpdate = { [weak self] v in self?.currentGroundContactTimeMs = v }
        return c
    }()
    private lazy var voChannel: MetricChannel = {
        let c = MetricChannel(store: store, type: HKQuantityType(.runningVerticalOscillation),
                               unit: .meterUnit(with: .centi), aggregation: .average)
        c.onUpdate = { [weak self] v in self?.currentVerticalOscillationCm = v }
        return c
    }()
    private lazy var strideChannel: MetricChannel = {
        let c = MetricChannel(store: store, type: HKQuantityType(.runningStrideLength), unit: .meter(), aggregation: .average)
        c.onUpdate = { [weak self] v in self?.currentStrideLengthM = v }
        return c
    }()
    private lazy var energyChannel: MetricChannel = {
        let c = MetricChannel(store: store, type: HKQuantityType(.activeEnergyBurned), unit: .kilocalorie(), aggregation: .sum)
        c.onUpdate = { [weak self] v in self?.currentActiveEnergyKcal = v }
        return c
    }()

    /// Live/most-recent values for the five extra metrics · mirror
    /// `currentBpm`. Nil until a sample lands (or forever, on a watch model
    /// or OS version that doesn't support the type — HealthKit yields zero
    /// samples for an unsupported-but-valid type identifier, never a throw,
    /// so no separate availability branching is needed here).
    @Published private(set) var currentRunningPowerW: Double?
    @Published private(set) var currentGroundContactTimeMs: Double?
    @Published private(set) var currentVerticalOscillationCm: Double?
    @Published private(set) var currentStrideLengthM: Double?
    /// Running SESSION total, not a per-sample reading — active energy is
    /// cumulative, so "current" here means "so far this run."
    @Published private(set) var currentActiveEnergyKcal: Double?

    /// Registers the mirroring handler as early as this object exists —
    /// `LiveRunHostV5` constructs one `TreadmillHRStreamer` for the whole
    /// console's lifetime (reused across a second run in the same session,
    /// per `closeSession()`'s own comment), so this fires well before the
    /// runner ever taps Start. iOS attaches a mirrored session to whichever
    /// handler was already registered when the WATCH'S session begins — a
    /// handler set only inside `start(from:)`, racing the WatchConnectivity
    /// message that asks the watch to start, would risk losing the mirror
    /// for that run to timing alone. Registering here removes the race
    /// rather than narrowing it.
    override init() {
        super.init()
        guard HKHealthStore.isHealthDataAvailable() else { return }
        store.workoutSessionMirroringStartHandler = { [weak self] mirrored in
            Task { @MainActor in self?.attachMirroredSession(mirrored) }
        }
    }

    /// A mirrored `HKWorkoutSession` has arrived from iOS — the watch's own
    /// session just started and this phone was registered to receive it.
    /// Wires the SAME delegate shape the watch's own `TreadmillHRSession`
    /// uses for its live display, so HR reaches the phone via the live
    /// builder callback (`workoutBuilder(_:didCollectDataOf:)` below)
    /// instead of waiting on a HealthKit store round-trip.
    private func attachMirroredSession(_ session: HKWorkoutSession) {
        mirroredSession = session
        session.delegate = self
        if #available(iOS 26.0, *) {
            let builder = session.associatedWorkoutBuilder()
            mirroredBuilderBox = builder
            builder.delegate = self
        }
        // Pre-26: `mirroredBuilderBox` stays nil. `mirroredSession` is still
        // set (state-change/failure delegate callbacks still fire), but
        // nothing delivers a live HR sample through it — the async channel
        // is the whole story on these OS versions, exactly as it was before
        // this file added mirroring.
    }

    /// The one place every real sample, from either channel, lands. Always
    /// keeps the FRESHEST sample regardless of which channel produced it —
    /// see the file header for why this is not a channel-priority decision.
    private func applySample(bpm: Int, at sampleAt: Date, source: TreadmillHRSource) {
        if let existing = lastSampleAt, sampleAt < existing { return }
        currentBpm = bpm
        lastSampleAt = sampleAt
        lastSampleSource = source
        recomputeSnapshot(at: sampleAt)
    }

    /// Called every tick by the console (it already has one clock —
    /// `BeltSession.tickStamp` — this reuses it rather than running a
    /// second timer) so `snapshot.freshness` ages forward even between
    /// samples: a sample that landed live 90 seconds ago must read as
    /// `.stale` NOW, not still `.live` because nothing re-evaluated it.
    func refreshFreshness(at now: Date = .now) {
        recomputeSnapshot(at: now)
    }

    private func recomputeSnapshot(at now: Date) {
        snapshot = TreadmillHRFreshnessPolicy.snapshot(
            now: now, bpm: currentBpm, source: lastSampleSource,
            sampleAt: lastSampleAt, isAttemptInFlight: attemptInFlight)
    }

    /// Begin streaming HR samples. Requests HK auth on first call (no-op
    /// if already granted in the standard import auth sweep). Anchors at
    /// `when` so historical samples don't leak into the session.
    func start(from when: Date) async {
        attemptInFlight = true
        recomputeSnapshot(at: when)
        guard HKHealthStore.isHealthDataAvailable() else { return }
        // 2026-08-21 · this was a bare `guard !observerActive else { return }`,
        // so the FIRST caller pinned the sample anchor and every later, more
        // accurate one was silently discarded. `LiveRunHostV5` used to call it
        // with "whenever the plan finished loading" and beat the console's own
        // call with the run's real start instant. That host call is gone, and
        // this now re-anchors instead of ignoring: a second start with a
        // different date, before any sample has landed, is someone telling us
        // the run actually began somewhere else. Once samples exist the
        // anchor is load-bearing and a re-anchor would discard them, so an
        // active stream with data stands.
        if observerActive {
            guard anchorDate != when, sessionSamples.isEmpty else { return }
            observerActive = false
            anchor = nil
        }
        // Retire whatever is registered before registering another. Without
        // this the old query keeps firing against its old predicate, and its
        // drains append pre-re-anchor samples into the buffers this run's
        // avg/max are computed from.
        retireObserver()
        anchorDate = when

        let hrType = HKQuantityType(.heartRate)
        _ = try? await store.requestAuthorization(toShare: [], read: [hrType])

        let predicate = HKQuery.predicateForSamples(
            withStart: when, end: nil, options: [.strictStartDate]
        )
        let q = HKObserverQuery(sampleType: hrType, predicate: predicate) { [weak self] _, completion, _ in
            Task { await self?.drain(predicate: predicate) }
            completion()
        }
        store.execute(q)
        observer = q
        observerActive = true
        // TREADMILL-HR-BACKGROUND-1 (2026-09-03) · this was the one HR
        // consumer in the app that never asked HealthKit to wake it in the
        // background — `HRAlerter.swift` and `HealthKitImporter.swift` both
        // already do, with the same entitlement already granted
        // (`com.apple.developer.healthkit.background-delivery`). Without it
        // the observer only fires while the process is actually running;
        // backgrounding the phone (screen off, phone propped on a console,
        // a call, another app) stalls every live update until the app is
        // foregrounded again, at which point HealthKit delivers exactly one
        // stale catch-up batch — "HR only appeared after backgrounding and
        // returning, then stopped updating live again" is that catch-up
        // batch landing once, with no further live delivery behind it.
        // `.immediate` is the correct frequency for HR specifically (Apple's
        // own guidance) — a shorter cadence than `.hourly`/`.daily` would
        // reserve, appropriate for a live in-run display. Best-effort: a
        // failure here does not fail the stream, it just leaves foreground-
        // only delivery, exactly today's behavior — never worse.
        store.enableBackgroundDelivery(for: hrType, frequency: .immediate) { _, _ in }

        // First drain · catches any samples that landed in the gap
        // between the watch starting its workout and our observer
        // registering. HealthKit fires the observer on registration too, so
        // this and that first callback are two drains asking for the same
        // window — `drain` is non-reentrant precisely because of this pair.
        await drain(predicate: predicate)

        // Extra running-form + energy channels ride the same watch workout
        // session HR does. Each manages its own anchor/observer/drain state
        // independently (see `MetricChannel`), so calling start() on all of
        // them here — after HR's own re-anchor branch above, which returns
        // early on a call that isn't telling us anything new — is safe and
        // idempotent: they were always co-started with HR on the FIRST call,
        // so a later no-op call for HR is a no-op for these too.
        await powerChannel.start(from: when)
        await gctChannel.start(from: when)
        await voChannel.start(from: when)
        await strideChannel.start(from: when)
        await energyChannel.start(from: when)
    }

    /// Stop streaming. The observer is retired, not merely muted.
    func stop() {
        observerActive = false
        attemptInFlight = false
        retireObserver()
        powerChannel.stop()
        gctChannel.stop()
        voChannel.stop()
        strideChannel.stop()
        energyChannel.stop()
        // The mirrored session's own lifecycle is driven by the WATCH
        // ending its session — `workoutSession(_:didChangeTo:)` below will
        // usually fire `.ended` on its own. Detaching the delegate/reference
        // here too is defensive: if this console stops before the watch
        // does (the runner ends first), nothing should keep delivering
        // callbacks into a screen that is going away.
        mirroredSession?.delegate = nil
        if #available(iOS 26.0, *) {
            (mirroredBuilderBox as? HKLiveWorkoutBuilder)?.delegate = nil
        }
        mirroredSession = nil
        mirroredBuilderBox = nil
        recomputeSnapshot(at: .now)
    }

    private func retireObserver() {
        if let q = observer { store.stop(q) }
        observer = nil
    }

    /// Capture (avg, max) for the just-closed phase + reset the phase
    /// buffer. Session buffer is untouched.
    func closePhase() -> (avg: Int?, max: Int?) {
        let avg = phaseSamples.isEmpty
            ? nil
            : Int((phaseSamples.reduce(0, +) / Double(phaseSamples.count)).rounded())
        let max = phaseSamples.max().map { Int($0.rounded()) }
        phaseSamples.removeAll(keepingCapacity: true)
        return (avg, max)
    }

    /// Capture (avg, max) for the whole session, and reset.
    ///
    /// The reset was missing, and this object outlives a single run: the
    /// treadmill and outdoor consoles share one instance for the whole
    /// `LiveRunHostV5` lifetime, and `stop()` then `start()` gives the same
    /// instance a second run. Without the clear, run two's `avgHr` was the
    /// mean of run one and run two — and `start`'s re-anchor guard
    /// (`sessionSamples.isEmpty`) could never be satisfied again either, so
    /// run two also kept run one's anchor date.
    ///
    /// Cleared HERE and not in `stop()` on purpose: `LiveRunHostV5.end()`
    /// calls `hr.stop()` before `hr.closeSession()`, so clearing on stop
    /// would drop the heart rate off every phone-recorded outdoor run.
    func closeSession() -> (avg: Int?, max: Int?) {
        let avg = sessionSamples.isEmpty
            ? nil
            : Int((sessionSamples.reduce(0, +) / Double(sessionSamples.count)).rounded())
        let max = sessionSamples.max().map { Int($0.rounded()) }
        sessionSamples.removeAll(keepingCapacity: false)
        phaseSamples.removeAll(keepingCapacity: false)
        anchor = nil
        anchorDate = nil
        // Same reset-on-closeSession-not-stop reasoning as the buffers
        // above: a second run in this same instance must not open reading
        // the first run's last sample as if it just arrived.
        currentBpm = nil
        lastSampleAt = nil
        lastSampleSource = .none
        snapshot = .empty
        return (avg, max)
    }

    /// Running-form + energy metrics captured over the same watch bridge.
    /// Names match `RunData` (web-v2/lib/runs/run-shape.ts) exactly, so a
    /// treadmill-bridge value and a HealthKit-import value land in the same
    /// field · `kcal` is the SUM of active-energy samples, everything else
    /// is the mean, matching each field's own physical meaning.
    struct ExtraMetrics {
        var avgPowerW: Double?
        var avgGctMs: Double?
        var avgVertOscCm: Double?
        var avgStrideLengthM: Double?
        var kcal: Double?
    }

    /// Additive sibling to `closePhase()` — same boundary, same reset
    /// timing, independent buffers. Existing `closePhase()` callers are
    /// untouched; a caller that wants the extras opts in by calling this too.
    func closePhaseExtras() -> ExtraMetrics {
        ExtraMetrics(
            avgPowerW: powerChannel.closePhase(),
            avgGctMs: gctChannel.closePhase(),
            avgVertOscCm: voChannel.closePhase(),
            avgStrideLengthM: strideChannel.closePhase(),
            kcal: energyChannel.closePhase()
        )
    }

    /// Additive sibling to `closeSession()` — see `closePhaseExtras()`.
    func closeSessionExtras() -> ExtraMetrics {
        ExtraMetrics(
            avgPowerW: powerChannel.closeSession(),
            avgGctMs: gctChannel.closeSession(),
            avgVertOscCm: voChannel.closeSession(),
            avgStrideLengthM: strideChannel.closeSession(),
            kcal: energyChannel.closeSession()
        )
    }

    /// ─────────────────────────────────────────────────────────────────────
    /// WHY THIS IS NON-REENTRANT
    ///
    /// `anchor` is read before the HealthKit query and written after it, and
    /// the `await` between the two releases the main actor. Two drains in
    /// flight therefore both snapshot the SAME anchor, both get the SAME
    /// batch back, and both append it — every sample in that window counted
    /// twice.
    ///
    /// It is not a rare interleaving; `start` produces it on every stream.
    /// `store.execute(observer)` makes HealthKit fire the observer straight
    /// away, and the line after it awaits a drain of its own. The observer's
    /// drain runs while that one is suspended, sees `anchor == nil`, and
    /// re-reads the identical catch-up batch — the samples the watch wrote
    /// between starting its workout and this stream registering.
    ///
    /// Duplicating a whole window leaves `max` alone but pulls `avg` toward
    /// the duplicated stretch, and that average ships as `actualAvgHr` on the
    /// phase and `avgHr` on the completion. It is presented as measured, so
    /// it has to be arithmetically what was measured.
    ///
    /// The re-run flag matters as much as the guard: an observer firing
    /// during a drain is HealthKit saying there are new samples, and simply
    /// dropping that callback would lose them until the next write.
    private func drain(predicate: NSPredicate) async {
        guard observerActive else { return }
        if isDraining {
            drainAgain = true
            return
        }
        isDraining = true
        defer { isDraining = false }

        let hrType = HKQuantityType(.heartRate)
        let bpm = HKUnit.count().unitDivided(by: .minute())

        repeat {
            drainAgain = false
            guard observerActive else { break }
            let snapshotAnchor = self.anchor

            let (samples, newAnchor): ([HKQuantitySample], HKQueryAnchor?) = await withCheckedContinuation { cont in
                let q = HKAnchoredObjectQuery(
                    type: hrType, predicate: predicate, anchor: snapshotAnchor, limit: HKObjectQueryNoLimit
                ) { _, samps, _, anchor, _ in
                    cont.resume(returning: ((samps as? [HKQuantitySample]) ?? [], anchor))
                }
                store.execute(q)
            }
            self.anchor = newAnchor ?? self.anchor
            // A stop that landed while the query was out. Advance the anchor
            // (so a later start does not re-read this window) but do not feed
            // a session that has already been closed out.
            guard observerActive else { break }
            guard !samples.isEmpty else { continue }

            for s in samples {
                let v = s.quantity.doubleValue(for: bpm)
                phaseSamples.append(v)
                sessionSamples.append(v)
                // Drive the live display off the newest sample, through the
                // shared freshness-aware path — this channel's own real
                // timestamp (`endDate`, when HealthKit actually recorded the
                // reading), never `.now`, or a sample delayed by sync would
                // wrongly read as `.live` the instant it happened to arrive.
                applySample(bpm: Int(v.rounded()), at: s.endDate, source: .asyncHealthKitSync)
            }
        } while drainAgain
    }
}

// MARK: - Mirrored HKWorkoutSession (the live channel)
//
// See the file header for the full architecture. `HKWorkoutSessionDelegate`
// and `HKLiveWorkoutBuilderDelegate` both extend `NSObjectProtocol`, which is
// why this type now inherits `NSObject`. Mirrors the exact delegate shape
// the watch's own `TreadmillHRSession.swift` already uses for its live
// display — same reviewed pattern, not a second design.

extension TreadmillHRStreamer: HKWorkoutSessionDelegate {
    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession,
                                    didChangeTo toState: HKWorkoutSessionState,
                                    from fromState: HKWorkoutSessionState,
                                    date: Date) {
        guard toState == .ended || toState == .stopped else { return }
        Task { @MainActor [weak self] in
            guard let self, self.mirroredSession === workoutSession else { return }
            self.mirroredSession?.delegate = nil
            if #available(iOS 26.0, *) {
                (self.mirroredBuilderBox as? HKLiveWorkoutBuilder)?.delegate = nil
            }
            self.mirroredSession = nil
            self.mirroredBuilderBox = nil
        }
    }

    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        print("[TreadmillHRStreamer] mirrored workout session failed: \(error.localizedDescription)")
    }
}

/// The live channel's actual delivery point — fires as HealthKit collects
/// each new sample on the WATCH's session, mirrored to this builder with no
/// HealthKit-store round trip. `HKLiveWorkoutBuilder` is iOS-26-only on the
/// phone (see `mirroredBuilderBox`'s own comment), so this whole conformance
/// is gated — Swift supports a conditionally-available protocol conformance
/// exactly like this. On iOS 17-25 `TreadmillHRStreamer` simply does not
/// conform, `attachMirroredSession` never sets a delegate that would need
/// it, and the async channel carries the whole console.
@available(iOS 26.0, *)
extension TreadmillHRStreamer: HKLiveWorkoutBuilderDelegate {
    nonisolated func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}

    nonisolated func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder,
                                    didCollectDataOf collectedTypes: Set<HKSampleType>) {
        let bpmUnit = HKUnit.count().unitDivided(by: .minute())
        guard collectedTypes.contains(where: { ($0 as? HKQuantityType) == HKQuantityType(.heartRate) }),
              let stats = workoutBuilder.statistics(for: HKQuantityType(.heartRate)),
              let q = stats.mostRecentQuantity() else { return }
        let bpm = Int(q.doubleValue(for: bpmUnit).rounded())
        // `HKStatistics` does not carry the originating sample's own
        // timestamp — `.now` is honest here because this callback fires
        // essentially the instant HealthKit collected the reading (the
        // whole point of mirroring), unlike the async channel above where
        // the wire timestamp and the arrival time can be meaningfully
        // different.
        let now = Date()
        Task { @MainActor [weak self] in
            self?.applySample(bpm: bpm, at: now, source: .mirroredWorkoutSession)
        }
    }
}

// MARK: - MetricChannel
//
// One anchored-query channel for a single HealthKit quantity type. This is
// `TreadmillHRStreamer`'s own anchor/observer/drain logic above —
// re-anchor guard, retire-before-register, non-reentrant drain via the
// `isDraining`/`drainAgain` pair — generalized by quantity type + unit +
// aggregation, so the five running-form/energy metrics get the exact same
// correctness the file's header argues for HR, through ONE implementation
// reviewed once rather than five hand-copies. See `TreadmillHRStreamer.drain`
// above for the full argument on why the non-reentrant shape is load-bearing,
// not decorative — every word of it applies here unchanged.
@MainActor
private final class MetricChannel {
    enum Aggregation {
        /// Instantaneous quantities — power, ground contact time, vertical
        /// oscillation, stride length. Phase/session values are the MEAN;
        /// the live value is the newest sample.
        case average
        /// Cumulative quantities — active energy. Phase/session values are
        /// the SUM; the live value is the running total for the session.
        case sum
    }

    private let store: HKHealthStore
    private let quantityType: HKQuantityType
    private let unit: HKUnit
    private let aggregation: Aggregation

    /// Fired on every sample with the value to publish live: the raw
    /// sample for `.average`, the running session total for `.sum`.
    var onUpdate: ((Double) -> Void)?

    private var observerActive = false
    private var observer: HKObserverQuery?
    private var anchor: HKQueryAnchor?
    private var isDraining = false
    private var drainAgain = false
    private var anchorDate: Date?
    /// Running session total for `.sum` channels only · reset in
    /// closeSession(), untouched by closePhase() (session-scoped, not
    /// phase-scoped — a session's live "kcal so far" does not reset at
    /// every phase boundary the way phaseSamples does).
    private var runningSum: Double = 0

    private var phaseSamples: [Double] = []
    private var sessionSamples: [Double] = []

    init(store: HKHealthStore, type: HKQuantityType, unit: HKUnit, aggregation: Aggregation) {
        self.store = store
        self.quantityType = type
        self.unit = unit
        self.aggregation = aggregation
    }

    /// Same shape as `TreadmillHRStreamer.start(from:)` — see its comments
    /// for why the re-anchor guard and the retire-before-register ordering
    /// both matter.
    func start(from when: Date) async {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        if observerActive {
            guard anchorDate != when, sessionSamples.isEmpty else { return }
            observerActive = false
            anchor = nil
        }
        retireObserver()
        anchorDate = when

        // Some watch models/OS versions don't support every running-form
        // type (running power in particular needs Series 8+/Ultra or a
        // paired footpod). Requesting authorization for, and executing
        // queries against, an unsupported-but-VALID type identifier simply
        // yields zero samples — never a throw, never a crash — so no extra
        // availability branching is needed to keep this file's "no watch →
        // nil" contract.
        _ = try? await store.requestAuthorization(toShare: [], read: [quantityType])

        let predicate = HKQuery.predicateForSamples(
            withStart: when, end: nil, options: [.strictStartDate]
        )
        let q = HKObserverQuery(sampleType: quantityType, predicate: predicate) { [weak self] _, completion, _ in
            Task { await self?.drain(predicate: predicate) }
            completion()
        }
        store.execute(q)
        observer = q
        observerActive = true
        // Same background-delivery fix as `TreadmillHRStreamer.start` above,
        // for the same reason — these five channels ride the identical
        // watch workout session HR does, so a runner mid-session should not
        // lose power/GCT/vertical-oscillation/stride/energy live updates
        // while HR itself keeps flowing.
        store.enableBackgroundDelivery(for: quantityType, frequency: .immediate) { _, _ in }

        await drain(predicate: predicate)
    }

    func stop() {
        observerActive = false
        retireObserver()
    }

    private func retireObserver() {
        if let q = observer { store.stop(q) }
        observer = nil
    }

    /// Capture the just-closed phase's value + reset the phase buffer.
    /// Session buffer (and, for `.sum` channels, `runningSum`) untouched.
    func closePhase() -> Double? {
        defer { phaseSamples.removeAll(keepingCapacity: true) }
        guard !phaseSamples.isEmpty else { return nil }
        switch aggregation {
        case .average: return phaseSamples.reduce(0, +) / Double(phaseSamples.count)
        case .sum: return phaseSamples.reduce(0, +)
        }
    }

    /// Capture the whole session's value, and reset — mirrors
    /// `TreadmillHRStreamer.closeSession()`'s full teardown (buffers, anchor,
    /// anchorDate) so a reused instance's second run starts clean.
    func closeSession() -> Double? {
        defer {
            sessionSamples.removeAll(keepingCapacity: false)
            phaseSamples.removeAll(keepingCapacity: false)
            anchor = nil
            anchorDate = nil
            runningSum = 0
        }
        guard !sessionSamples.isEmpty else { return nil }
        switch aggregation {
        case .average: return sessionSamples.reduce(0, +) / Double(sessionSamples.count)
        case .sum: return sessionSamples.reduce(0, +)
        }
    }

    /// Non-reentrant for the exact reason `TreadmillHRStreamer.drain` is —
    /// same anchor-snapshot-then-await race, same duplicate-batch risk on a
    /// second drain interleaving the first. See that method's header.
    private func drain(predicate: NSPredicate) async {
        guard observerActive else { return }
        if isDraining {
            drainAgain = true
            return
        }
        isDraining = true
        defer { isDraining = false }

        repeat {
            drainAgain = false
            guard observerActive else { break }
            let snapshotAnchor = self.anchor

            let (samples, newAnchor): ([HKQuantitySample], HKQueryAnchor?) = await withCheckedContinuation { cont in
                let q = HKAnchoredObjectQuery(
                    type: quantityType, predicate: predicate, anchor: snapshotAnchor, limit: HKObjectQueryNoLimit
                ) { _, samps, _, anchor, _ in
                    cont.resume(returning: ((samps as? [HKQuantitySample]) ?? [], anchor))
                }
                store.execute(q)
            }
            self.anchor = newAnchor ?? self.anchor
            guard observerActive else { break }
            guard !samples.isEmpty else { continue }

            for s in samples {
                let v = s.quantity.doubleValue(for: unit)
                phaseSamples.append(v)
                sessionSamples.append(v)
                switch aggregation {
                case .average:
                    onUpdate?(v)
                case .sum:
                    runningSum += v
                    onUpdate?(runningSum)
                }
            }
        } while drainAgain
    }
}

// MARK: - Preview seam
//
// `currentBpm` is `private(set)` — real samples only come from HealthKit.
// DEBUG-only, compiled out of release builds: lets a #Preview show a live HR
// tile (or the deliberate no-source layout, by simply not calling this).

#if DEBUG
extension TreadmillHRStreamer {
    func seedForPreview(bpm: Int?) {
        if let bpm {
            applySample(bpm: bpm, at: .now, source: .asyncHealthKitSync)
        } else {
            currentBpm = nil
            snapshot = .empty
        }
    }

    func seedExtrasForPreview(
        powerW: Double? = nil, gctMs: Double? = nil,
        vertOscCm: Double? = nil, strideLengthM: Double? = nil, kcal: Double? = nil
    ) {
        currentRunningPowerW = powerW
        currentGroundContactTimeMs = gctMs
        currentVerticalOscillationCm = vertOscCm
        currentStrideLengthM = strideLengthM
        currentActiveEnergyKcal = kcal
    }
}
#endif
