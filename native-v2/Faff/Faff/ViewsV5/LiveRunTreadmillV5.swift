//
//  LiveRunTreadmillV5.swift
//  faff.run iPhone · v5 screen 12b — Live run, treadmill.
//
//  "A console meant to be read from a few feet away, mid-stride — this is
//  its own thing, not a shrunk version of 12a." Solid black, no gradient,
//  maximum contrast. Top row: elapsed + current interval. Two dominant
//  control tiles — Speed (104pt) and Incline (68pt) — each flanked by large
//  round −/+ buttons that adjust the value live. A 3-column stat row, one
//  "what's next" line, Pause/End at the bottom.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY THIS SCREEN OWNS ITS OWN SPEED/INCLINE/ELAPSED STATE
//
//  Unlike the outdoor console, there is no small reusable "treadmill
//  tracker" object to observe — the belt has no GPS and no clock of its
//  own; the runner's speed/incline dial IS the session, and today that
//  state machine lives inside the legacy `TreadmillView` monolith (segment
//  cursor, POST, HK bridge, all one file). Rebuilding that whole engine is
//  out of scope for a screen transcription. So this view owns the console's
//  own live numbers directly — the same way the prototype's own sample data
//  computes them (`TREADMILL_RUN`'s `pace` is `3600 / speed`, not a
//  separate measured field) — and exposes them through the same shape every
//  other v5 component uses: `Pause`/`End` leave the screen through
//  callbacks; the −/+ buttons do not, because adjusting the belt never
//  navigates anywhere.
//
//  `TreadmillHRStreamer` is real, named machinery ("do not rebuild it") and
//  is used exactly as built — a live HealthKit feed, started once on
//  appear, read reactively.
//
//  Target pace bands are NOT drawn here — 12b's own design has no
//  `RangeScale` on this screen. The runner sets speed/incline by feel
//  against the plan; only the current-interval line and the "what's next"
//  line read the plan (`LiveRunPlanV5`, decoded once by the caller, same as
//  12a — see `LiveRunOutdoorV5.swift` for `LiveRunPlanV5` /
//  `LiveRunPhaseWalk`, shared by both live-run screens).
//
//  ─────────────────────────────────────────────────────────────────────────
//  SAVING · WHY THIS VIEW POSTS ITSELF INSTEAD OF HANDING A PAYLOAD UP
//
//  A treadmill run used to leave `End` with nothing persisted — the whole
//  session lived in this view's own `@State` and vanished on dismiss. The
//  legacy `Views/TreadmillView.swift` (`buildPayload`, ~line 794) is the
//  wire-shape source of truth: WatchCompletion-shaped JSON POSTed to
//  `/api/watch/workouts/complete` with `source: "treadmill"`, `indoor: true`,
//  and per-phase `actualSpeedMph` / `actualInclinePct` — the exact fields
//  `/api/v5/today` averages to build the "on the belt" card. Drift the shape
//  and that card goes blank.
//
//  `HostsV5.swift` is off-limits for this change (per AGENT-BRIEF), so this
//  view does not hand a payload up through `onEnd` — `onEnd: () -> Void`
//  keeps its existing zero-argument shape and needs no wiring change at the
//  call site. Instead the End button fires the save itself, through
//  `WatchSync.shared.saveCompletionDurably` — the SAME durable-queue door
//  `PhoneRunTracker`'s outdoor path uses from `LiveRunHostV5.end()`: the
//  payload is written to disk before the network call, so a failed POST is
//  "will sync later," never "run gone" — then calls `onEnd()` exactly as
//  before. That mirrors the outdoor host's own fire-then-dismiss pattern
//  (`Task { saveCompletionDurably }` followed immediately by `onDismiss()`,
//  not awaited) rather than inventing a new one.
//
//  Per-phase actuals are captured by walking `LiveRunPhaseWalk` on every 1s
//  tick (the same clock that already drives `elapsedSec`/`distanceMi`): the
//  active phase accumulates a running speed/incline average and duration:
//  when the walk crosses into the next phase, the just-finished phase closes
//  out — including its slice of `TreadmillHRStreamer.closePhase()`, exactly
//  the call legacy makes at its own segment boundary. A phase never reached
//  (the runner ended early) reports `completed: false` and its *nominal*
//  speed/incline, matching legacy's own fallback for an unreached segment —
//  inherited, not introduced here.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE NO-HEART LAYOUT (task's own words)
//
//  "The treadmill HEART tile has no source without a watch on the wrist…
//  it needs a no-heart layout, not a zero and not a dash where a number
//  should be." `TreadmillHRStreamer`'s own header confirms this is
//  permanent, not transient, for a non-watch runner: "currentBpm stays nil
//  … the view shows no HR pill." So `hr.currentBpm == nil` re-flows the
//  3-column stat row to 2 columns (Dist / Pace) and says once, quietly,
//  why — see `statRow` below. The one edge case this can't distinguish: a
//  watch that IS paired but hasn't delivered its first HealthKit batch yet
//  (5–30s latency, per that file's header) will show the same no-heart
//  layout for a few seconds at the very start of a run. Noted in the
//  delivery report; `TreadmillHRStreamer` exposes no "watch paired" signal
//  to tell the two apart.
//

import SwiftUI
import UIKit

struct LiveRunTreadmillV5: View {
    @ObservedObject var hr: TreadmillHRStreamer
    /// The only number on this screen a sensor produced. The belt speed is
    /// typed; this is measured. It corroborates the belt figure or it
    /// contradicts it and says so — it never replaces it silently. See
    /// IndoorDistanceMeter.swift.
    @StateObject private var meter = IndoorDistanceMeter()
    /// Observed for `treadmillSessionConfirmed` — the watch's real answer to
    /// "did your HR session actually open".
    @ObservedObject private var watchSync = WatchSync.shared
    let plan: LiveRunPlanV5?
    /// Fired on every Pause/Resume tap, in addition to this view's own local
    /// pause (which freezes elapsed/distance immediately for the runner).
    /// The caller has nothing else live to pause — no external tracker
    /// exists for the treadmill — but still gets the tap for its own
    /// bookkeeping (e.g. a future POST/session log).
    let onPause: () -> Void
    /// Fired on End, AFTER this view has already saved the run (see
    /// "SAVING" in the file header) — leaves the screen. The caller still
    /// owns navigation/dismissal per AGENT-BRIEF; it just no longer owns
    /// the completion save, because that save has to live here or not
    /// happen at all (`HostsV5.swift` is off-limits for this change).
    let onEnd: () -> Void

    /// The ONE integration of this session. Was four inline accumulators
    /// with a per-TICK speed average standing in for a per-SECOND integral:
    /// `speedSum / sampleCount` weighted a 90-second backgrounding gap the
    /// same as one ordinary second, so `actualDistanceMi` drifted away from
    /// `totalDistanceMi` on exactly the runs where it mattered. See
    /// BeltTracker.swift.
    @State private var belt = BeltTracker()
    @State private var speedMph: Double
    @State private var inclinePct: Double
    @State private var isPaused: Bool = false
    /// Stamped when the runner actually starts, not when the view is built.
    /// The console renders at `.opacity(0)` while `LiveRunHostV5` fetches the
    /// plan, and this used to be `.now` at init — so a slow fetch counted as
    /// running, on a belt the runner had not stepped onto yet.
    @State private var startedAt: Date?
    /// True once the runner has moved the belt themselves. Nothing in this
    /// view may overwrite a runner's own input with a target after that.
    @State private var runnerSetSpeed: Bool = false
    /// Seeded from the plan the first time one arrives. `State(initialValue:)`
    /// runs ONCE, at the first `init`, and the host builds this view before
    /// the plan lands — so the plan's own target never reached the belt and
    /// every planned session opened at the flat 8.0 mph fallback.
    @State private var seededFromPlan = false
    /// Watch HR bridge · 2026-08-21. This console never asked the watch to
    /// open an indoor HKWorkoutSession at all, so its heart rate came from
    /// HealthKit's passive every-5-minute baseline rather than the 5-15 s
    /// stream the legacy console has had since build 137. On a threshold
    /// session that is the difference between a heart-rate reading and a
    /// souvenir.
    @State private var watchHRBridgeUp = false
    @State private var lastPingAt: Date = .distantPast
    @State private var lastBridgeAskAt: Date = .distantPast
    @State private var lastBpmAt: Date?
    /// The session clock. `@State` so it is not rebuilt on every render.
    @State private var clock = Timer.publish(every: 1.0, on: .main, in: .common).autoconnect()
    /// Stable id, stamped once. Same role as `TreadmillView`'s `workoutId` —
    /// backend idempotency key, and reused as the payload's `workoutId` so a
    /// retried POST from the durable queue overwrites rather than duplicates.
    private let workoutId: String = "trd_\(UUID().uuidString)"
    /// Per-phase actuals, keyed by `WatchPhase.index` — this view's analogue
    /// of legacy's `actualsBySegment`. A phase absent from this dict was
    /// never reached.
    @State private var phaseActuals: [Int: PhaseActual] = [:]
    /// The phase index the tracker currently believes is active, so a
    /// boundary crossing (detected each tick) can close out the previous
    /// phase exactly once.
    @State private var trackedPhaseIndex: Int?

    /// One closed phase. `belt` is that phase's own slice of the single
    /// session integration, so its speed, distance and pace agree with each
    /// other and the slices sum to the run total.
    ///
    /// This used to hold `speedSumMph / sampleCount` — a mean over TICKS.
    /// Ticks are not equal: one covers a second, the next covers however long
    /// the screen was locked. Weighting is per second now, in BeltTracker.
    private struct PhaseActual {
        var belt: BeltSegmentActual
        var completed: Bool = false
        var avgHr: Int?
        var maxHr: Int?
    }

    init(plan: LiveRunPlanV5?, hr: TreadmillHRStreamer,
         onPause: @escaping () -> Void, onEnd: @escaping () -> Void) {
        self.plan = plan
        self._hr = ObservedObject(wrappedValue: hr)
        self.onPause = onPause
        self.onEnd = onEnd
        self._speedMph = State(initialValue: Self.defaultSpeedMph(plan: plan))
        self._inclinePct = State(initialValue: 1.0)
    }

    // One accumulator, read for the UI. `elapsedSec` and `distanceMi` were
    // separate `@State` advanced in parallel with the phase totals, which is
    // how the two could disagree.
    private var elapsedSec: Int { belt.elapsedSecInt }
    private var distanceMi: Double { belt.distanceMi }
    private var isRunning: Bool { startedAt != nil && !isPaused }

    private var walk: LiveRunPhaseWalk? {
        guard let plan else { return nil }
        return LiveRunPhaseWalk.walk(phases: plan.phases, elapsedSec: elapsedSec)
    }

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: V5.S.s16) {
                topRow
                speedTile
                inclineTile
                statRow
                if let next = nextLineText {
                    Text(next)
                        .font(.faffText(24, weight: .medium))
                        .foregroundStyle(V5.textPrimary)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                }
            }
            .padding(.horizontal, V5.S.s20)
            .padding(.top, V5.S.s8)

            Spacer(minLength: V5.S.s16)

            buttons
                .padding(.horizontal, V5.S.s20)
                .padding(.top, V5.S.s12)
                .padding(.bottom, V5.S.s16)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        // "Solid black background — no gradient, maximum contrast." Same
        // ground as 12a, but this screen never reaches for a day-state
        // panel at all; the belt IS the console.
        .background(V5.surfacePage.ignoresSafeArea())
        // Live tick · 2026-08-21. Was a `TimelineView(.periodic(from: .now,
        // by: 1.0))` inside `.background`, which reads the clock inside `body`
        // and so closes a feedback loop: render builds a new schedule, the new
        // schedule yields a new date, the date fires the tick, the tick writes
        // state, the state re-renders. Measured on the identical construct in
        // the outdoor recorder at 5,543 ticks in ~15 s. See the matching note
        // in Views/TreadmillView.swift. A run-loop timer in `.common` mode
        // fires at a fixed 1 Hz and nothing in `body` reads the clock.
        .onReceive(clock) { now in tick(at: now) }
        .onChange(of: isRunning) { _, running in
            UIApplication.shared.isIdleTimerDisabled = running
        }
        .onAppear {
            // The host no longer builds this console until the plan has been
            // asked for, so appearing IS starting. Stamp the clock and anchor
            // the HR stream to the same instant.
            let now = Date()
            startedAt = now
            belt.begin(at: now)
            meter.start(from: now)
            UIApplication.shared.isIdleTimerDisabled = true
            Task { await hr.start(from: now) }
            // Ask the watch for a real indoor workout session, so HealthKit
            // gets 5-15 s samples instead of the passive baseline.
            lastBridgeAskAt = now
            lastPingAt = now
            watchHRBridgeUp = WatchSync.shared.startTreadmillHRSession(sessionId: workoutId)
        }
        // The plan arrives AFTER this view is built (the host renders it at
        // `.opacity(0)` while it fetches), and `State(initialValue:)` only
        // runs on that first build. Without this the plan's own target never
        // reached the belt and every planned session opened at the flat
        // 8.0 mph fallback. Seed once, and never over a runner's own input.
        .onChange(of: plan?.phases.count ?? 0) { _, _ in
            guard !seededFromPlan, !runnerSetSpeed, plan != nil else { return }
            seededFromPlan = true
            speedMph = Self.defaultSpeedMph(plan: plan)
        }
        .onDisappear {
            UIApplication.shared.isIdleTimerDisabled = false
            hr.stop()
            meter.stop()
            // Idempotent · safe even if the watch never received the start.
            WatchSync.shared.stopTreadmillHRSession(sessionId: workoutId)
        }
        .onChange(of: hr.currentBpm) { _, bpm in
            if bpm != nil { lastBpmAt = .now }
        }
        .onChange(of: isPaused) { _, paused in
            // Resuming: re-ask rather than assume the watch session survived.
            // The watch's dead-man timer is 15 minutes and its start is
            // idempotent for the same id, so a live session no-ops.
            guard !paused, startedAt != nil else { return }
            lastBridgeAskAt = .now
            lastPingAt = .now
            watchHRBridgeUp = WatchSync.shared.startTreadmillHRSession(sessionId: workoutId)
        }
    }

    // MARK: - Tick
    //
    // No GPS, no separate tracker — distance accumulates from speed × time,
    // exactly the arithmetic the prototype's own sample data performs
    // client-side (`TREADMILL_RUN`'s pace is derived from speed, not read
    // from a sensor).

    private func tick(at now: Date) {
        // Kept alive outside the pause guard: the watch's dead-man timer is
        // 15 minutes, and a session only pinged while the belt turns dies on
        // a longer pause with nothing on screen saying so.
        maintainWatchBridge(at: now)
        // Nothing is running until the runner starts it. The console is built
        // and ticking (at `.opacity(0)`) while the host fetches the plan.
        guard startedAt != nil, !isPaused else { belt.resync(to: now); return }
        belt.advance(to: now, speedMph: speedMph, inclinePct: inclinePct,
                     bpm: hr.currentBpm)
        advancePhaseTracking()
    }

    /// Ping a confirmed watch HR session, or re-ask for one that never
    /// confirmed. `treadmillSessionConfirmed` is the watch's actual answer;
    /// `startTreadmillHRSession`'s return value only says the message was
    /// sent. Mirrors the legacy console's `maintainWatchBridge`.
    private func maintainWatchBridge(at now: Date) {
        guard startedAt != nil else { return }
        if watchSync.treadmillSessionConfirmed, now.timeIntervalSince(lastPingAt) >= 120 {
            lastPingAt = now
            WatchSync.shared.pingTreadmillHRSession(sessionId: workoutId)
            return
        }
        if !watchSync.treadmillSessionConfirmed, now.timeIntervalSince(lastBridgeAskAt) >= 60 {
            lastBridgeAskAt = now
            lastPingAt = now
            watchHRBridgeUp = WatchSync.shared.startTreadmillHRSession(sessionId: workoutId)
        }
    }

    /// What to say about heart rate, or nothing when it is flowing. "No watch"
    /// and "your heart rate stopped four minutes ago" are different problems
    /// and get different sentences.
    private var hrHint: String? {
        guard startedAt != nil else { return nil }
        if let last = lastBpmAt {
            guard Date().timeIntervalSince(last) >= 120 else { return nil }
            return "Heart rate stopped \u{00b7} reconnecting to your watch."
        }
        guard elapsedSec > 45 else { return nil }
        return "No heart rate source \u{00b7} running on speed and incline alone."
    }

    // MARK: - Phase tracking (for the completion payload)
    //
    // No plan → a single synthetic "Just Run" phase, same fallback shape as
    // legacy's cold path (`segments` returning one open work segment). Every
    // other case walks `plan.phases` exactly as the UI's `walk` property
    // does, so the tracked phase and the displayed phase never disagree.

    private var effectivePhases: [WatchPhase] {
        guard let plan, !plan.phases.isEmpty else {
            return [WatchPhase(index: 0, type: .work, label: "Just Run", durationSec: 30 * 60,
                                targetPaceSPerMi: nil, tolerancePaceSPerMi: nil, haptic: .start)]
        }
        return plan.phases
    }

    private func currentPhaseIndex(at elapsedSec: Int) -> Int {
        guard let plan, !plan.phases.isEmpty else { return 0 }
        return LiveRunPhaseWalk.walk(phases: plan.phases, elapsedSec: elapsedSec)?.phase.index ?? 0
    }

    private func advancePhaseTracking() {
        let idx = currentPhaseIndex(at: elapsedSec)
        guard idx != trackedPhaseIndex else { return }
        // Crossed into a new phase · the one we just left ran its full asked
        // duration, same as legacy's auto-advance (`completed: true`).
        if trackedPhaseIndex != nil { closeOutPhase(completed: true) }
        trackedPhaseIndex = idx
        // The new phase does NOT get the plan's target written into
        // `speedMph`: the belt is whatever the runner last set it to until
        // they say otherwise. `nextLineText` already asks for the new speed.
    }

    /// Closes the open phase: its slice of the belt integration, plus its HR
    /// window (`TreadmillHRStreamer.closePhase`) and its `completed` flag.
    private func closeOutPhase(completed: Bool) {
        guard let index = trackedPhaseIndex else { return }
        let hrResult = hr.closePhase()
        phaseActuals[index] = PhaseActual(
            belt: belt.closeSegment(speedMph: speedMph, bpm: hr.currentBpm),
            completed: completed,
            avgHr: hrResult.avg,
            maxHr: hrResult.max
        )
    }

    /// Closes out whatever phase is still open when the runner taps End.
    /// Mirrors legacy's `recordActual` call inside `endAndPost`: the phase in
    /// progress is "completed" only if its accumulated duration reached the
    /// asked duration — ending early is an honest partial, not a pass.
    private func finalizeActivePhaseForEnd(status: String) {
        guard let idx = trackedPhaseIndex else { return }
        let askedSec = effectivePhases.first(where: { $0.index == idx })?.durationSec ?? 0
        let actualSec = Int(belt.segElapsedSec.rounded())
        closeOutPhase(completed: status == "completed" && actualSec >= askedSec)
    }

    // MARK: - Completion payload
    //
    // WatchCompletion-shaped dict, key-for-key against
    // `TreadmillView.buildPayload` (Views/TreadmillView.swift ~line 794) —
    // see the file header for why this view POSTs itself rather than handing
    // the payload up through `onEnd`.

    private func buildCompletionPayload(status: String) -> [String: Any] {
        let iso = ISO8601DateFormatter()
        let phasePayloads: [[String: Any]] = effectivePhases.map { phase in
            let act = phaseActuals[phase.index]
            var p: [String: Any] = [
                "index": phase.index,
                "label": phase.label,
                "type": phase.type.rawValue,
                "completed": act?.completed ?? false,
                // A never-reached phase reports its NOMINAL speed/incline
                // (planned target, or the flat treadmill default), not the
                // live belt reading at End — the same fallback shape legacy
                // uses for an unreached segment, inherited here rather than
                // introduced.
                "actualSpeedMph": act.map { $0.belt.avgSpeedMph } ?? nominalMph(for: phase),
                "actualInclinePct": act.map { $0.belt.avgInclinePct } ?? 1.0,
            ]
            if let act, act.belt.durationSec > 0 {
                let b = act.belt
                // The phase's own slice of the integration — never a
                // recompute from a summary speed.
                p["actualDistanceMi"] = (b.distanceMi * 100).rounded() / 100
                p["actualDurationSec"] = b.durationSec
                if let pace = b.paceSPerMi { p["actualPaceSPerMi"] = pace }
                // The belt's own speed timeline. Without this the server's
                // deriveSplitsFromPaceSamples has nothing to walk and every
                // treadmill run lands with `splits: []` — no per-mile splits
                // in run detail, and nothing for the HR zone bar to bucket.
                if !b.samples.isEmpty {
                    p["paceSamples"] = b.paceSamplesPayload
                    let hrs = b.hrSamplesPayload
                    if !hrs.isEmpty { p["hrSamples"] = hrs }
                }
                if b.unmeasuredSec > 0 {
                    p["unmeasuredSec"] = b.unmeasuredSec
                    p["unmeasuredDistanceMi"] = (b.unmeasuredMi * 100).rounded() / 100
                }
                if let avgHr = act.avgHr { p["avgHr"] = avgHr }
                if let maxHr = act.maxHr { p["maxHr"] = maxHr }
            }
            return p
        }
        // Session-level HR rollup · separate from the per-phase buffers so it
        // captures samples landing right at a phase boundary. Nil when no
        // watch is paired.
        let sessionHr = hr.closeSession()
        var payload: [String: Any] = [
            "workoutId": workoutId,
            "startedAt": iso.string(from: startedAt ?? Date(timeIntervalSinceNow: -belt.elapsedSec)),
            "completedAt": iso.string(from: .now),
            "status": status,
            "totalDistanceMi": (belt.distanceMi * 100).rounded() / 100,
            "totalDurationSec": belt.elapsedSecInt,
            "elevGainFt": belt.elevGainFt.rounded(),
            "elevGainSource": "treadmill_incline",
            "source": "treadmill",
            "indoor": true,
            "phases": phasePayloads,
        ]
        if let avgHr = sessionHr.avg { payload["avgHr"] = avgHr }
        if let maxHr = sessionHr.max { payload["maxHr"] = maxHr }
        // What this run could not witness. Keys ABSENT on a clean run.
        if belt.unmeasuredSec >= 1 {
            payload["unmeasuredSec"] = Int(belt.unmeasuredSec.rounded())
            payload["unmeasuredDistanceMi"] = (belt.unmeasuredMi * 100).rounded() / 100
        }
        if belt.droppedSec >= 1 {
            payload["droppedGapSec"] = Int(belt.droppedSec.rounded())
        }
        if belt.pausedSec >= 1 { payload["pausedSec"] = Int(belt.pausedSec.rounded()) }
        // Provenance, same contract as the legacy console — see
        // Views/TreadmillView.swift buildPayload for the full argument.
        payload["distanceSource"] = {
            guard let m = measuredMi else { return "belt_stated" }
            return IndoorDistanceMeter.materiallyDisagree(beltMi: belt.distanceMi, measuredMi: m)
                ? "belt_contested" : "belt_corroborated"
        }()
        // Cadence, MEASURED. The phone-driven watch bridge carries heart
        // rate only — TreadmillHRSession collects nothing else, and the phone
        // reads HR out of HealthKit rather than over WatchConnectivity — so a
        // treadmill run has never had a cadence figure, while watch-started
        // outdoor runs have carried one since WorkoutTracker started reading
        // CMPedometer.currentCadence. Same pedometer, same carried gate: nil
        // rather than a zero when the phone was parked on the console.
        if let cad = meter.avgCadenceSpm { payload["avgCadence"] = cad }
        if let m = meter.rawDistanceMi { payload["pedometerDistanceMi"] = (m * 100).rounded() / 100 }
        if let st = meter.rawSteps { payload["pedometerSteps"] = st }
        if !IndoorDistanceMeter.isSupported { payload["pedometerAvailable"] = false }
        payload["clockDriftSec"] = (belt.clockDriftSec(
            startedAt: startedAt ?? Date(timeIntervalSinceNow: -belt.elapsedSec),
            completedAt: .now) * 10).rounded() / 10
        return payload
    }

    /// Starting belt speed for a phase never reached — from its own target
    /// pace when the plan set one, else the same flat defaults legacy falls
    /// back to. Never the live speedMph, which belongs to whichever phase
    /// the runner actually was on.
    private func nominalMph(for phase: WatchPhase) -> Double {
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

    // MARK: - Top row

    private var topRow: some View {
        HStack(alignment: .lastTextBaseline) {
            Text(FaffFmt.clock(sec: Double(elapsedSec)) ?? "0:00")
                .font(.faffText(34, weight: .semibold))
                .foregroundStyle(V5.textPrimary)
            Spacer(minLength: V5.S.s12)
            Text(intervalShortText)
                .font(.faffText(34, weight: .semibold))
                .foregroundStyle(V5.signal)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
    }

    private var intervalShortText: String {
        guard let walk else { return plan?.sessionType ?? "Run" }
        return (walk.isWork && walk.workCount > 1)
            ? "Interval \(walk.workIndex) of \(walk.workCount)"
            : walk.phase.label
    }

    private var nextLineText: String? {
        guard let walk, let next = walk.nextPhase else { return nil }
        if let target = next.targetPaceSPerMi, target > 0 {
            let mph = (3600.0 / Double(target) * 10).rounded() / 10
            return "Next \u{00b7} \(Units.formatSpeed(mph: mph)) \(Units.speedLabel()) in \(walk.remainingShort)"
        }
        return "Next \u{00b7} \(next.label) in \(walk.remainingShort)"
    }

    // MARK: - Speed tile

    private var speedTile: some View {
        VStack(spacing: V5.S.s6) {
            Text("SPEED")
                .font(.faffText(20))
                .tracking(20 * 0.06)
                .foregroundStyle(V5.textSecondary)
            HStack(spacing: V5.S.s16 + V5.S.s2) {
                roundControl(symbol: "minus", diameter: 72, glyphSize: 30,
                            fill: V5.materialControl, ink: V5.textPrimary) {
                    adjustSpeed(-2)
                }
                Text(Units.formatSpeed(mph: speedMph))
                    .font(.faffText(TypeScaleV5.valueMax, weight: .semibold))
                    .foregroundStyle(V5.textPrimary)
                roundControl(symbol: "plus", diameter: 72, glyphSize: 30,
                            fill: V5.materialAction, ink: V5.actionPrimaryText) {
                    adjustSpeed(2)
                }
            }
            // Display only \u{00b7} the accumulator and the wire stay mph.
            Text(Units.speedLabel())
                .font(.faffText(20))
                .foregroundStyle(V5.textQuiet)
        }
        .frame(maxWidth: .infinity)
        .frame(maxHeight: .infinity)
        .padding(.vertical, V5.S.s16)
        .background(V5.materialTile, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
    }

    // MARK: - Incline tile

    private var inclineTile: some View {
        VStack(spacing: V5.S.s4) {
            Text("INCLINE")
                .font(.faffText(18))
                .tracking(18 * 0.06)
                .foregroundStyle(V5.textSecondary)
            HStack(spacing: V5.S.s16) {
                roundControl(symbol: "minus", diameter: 60, glyphSize: 26,
                            fill: V5.materialControl, ink: V5.textPrimary) {
                    adjustIncline(-0.5)
                }
                Text(FaffFmt.oneDecimal(inclinePct) ?? "0.0")
                    .font(.faffText(68, weight: .semibold))
                    .foregroundStyle(V5.textPrimary)
                roundControl(symbol: "plus", diameter: 60, glyphSize: 26,
                            fill: V5.materialAction, ink: V5.actionPrimaryText) {
                    adjustIncline(0.5)
                }
            }
            Text("% grade")
                .font(.faffText(18))
                .foregroundStyle(V5.textQuiet)
        }
        .frame(maxWidth: .infinity)
        .frame(maxHeight: .infinity)
        .padding(.vertical, V5.S.s16)
        .background(V5.materialTile, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
    }

    private func roundControl(symbol: String, diameter: CGFloat, glyphSize: CGFloat,
                              fill: Color, ink: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: glyphSize, weight: .bold))
                .foregroundStyle(ink)
                .frame(width: diameter, height: diameter)
                .background(fill, in: Circle())
        }
        .buttonStyle(V5PressStyle())
    }

    /// The step and the bounds move in the unit the runner is READING. They
    /// stepped in mph regardless of preference, so a km runner's tap moved
    /// the display by 0.32 km/h and no sequence of taps reached a round
    /// km/h number. The accumulator is still mph — only the notch is theirs.
    ///
    /// Any belt change is a RUNNER input: `runnerSetSpeed` records that, so
    /// nothing in this view may later overwrite it with a plan target.
    private func adjustSpeed(_ notches: Double) {
        speedMph = BeltSpeed.stepped(mph: speedMph, by: notches,
                                     unit: Units.preference.distance)
        runnerSetSpeed = true
    }

    /// Incline is a percent grade on every belt, in every country.
    private func adjustIncline(_ delta: Double) {
        inclinePct = (min(max(inclinePct + delta, 0.0), 12.0) * 10).rounded() / 10
    }

    private static func defaultSpeedMph(plan: LiveRunPlanV5?) -> Double {
        guard let phase = plan?.phases.first(where: { $0.type == .work }),
              let target = phase.targetPaceSPerMi, target > 0 else { return 8.0 }
        return (3600.0 / Double(target) * 10).rounded() / 10
    }

    // MARK: - Stat row
    //
    // 3 columns with a live HR source, 2 without — see file header. Never a
    // dash where HEART's numeral would sit; the column is gone, and the
    // note underneath says why exactly once.

    private var statRow: some View {
        VStack(alignment: .leading, spacing: V5.S.s8) {
            HStack(spacing: 0) {
                // The mark. When part of this distance was credited across
                // seconds the console did not witness (screen locked, app
                // backgrounded) the number is partly an estimate and wears
                // the amber tilde — rule one is a system rule, not one
                // screen's fix, so it goes through FaffValueText like every
                // other modelled number in the app.
                statColumn(label: "DIST",
                           value: .from(FaffFmt.miles(distanceMi) ?? "0",
                                        modelled: distanceIsModelled))
                statColumn(label: "PACE", value: .measured(currentPaceText))
                if let bpm = hr.currentBpm {
                    statColumn(label: "HEART", value: .measured(FaffFmt.bpm(Double(bpm)) ?? "\u{2014}"))
                }
            }
            .padding(.vertical, V5.S.s16)
            .padding(.horizontal, V5.S.s12)
            .background(V5.materialTile, in: RoundedRectangle(cornerRadius: 24, style: .continuous))

            // Was an unconditional "no heart rate source" whenever currentBpm
            // was nil — which is also true for the first 5-30 s of every run
            // with a watch on the wrist, and for a feed that died mid-run.
            // hrHint waits out the latency and tells those two apart.
            if let hint = hrHint {
                Text(hint)
                    .font(.faffText(TypeScaleV5.label13))
                    .foregroundStyle(V5.textQuiet)
                    .padding(.horizontal, V5.S.s4)
                    .fixedSize(horizontal: false, vertical: true)
            }
            // Says what is estimated, or which two numbers disagree, once.
            // The runner did nothing wrong by locking their phone.
            if let note = provenanceNote {
                Text(note)
                    .font(.faffText(TypeScaleV5.label13))
                    .foregroundStyle(V5.attention)
                    .padding(.horizontal, V5.S.s4)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    /// The pedometer's reading, when the phone was actually on the runner.
    private var measuredMi: Double? { meter.reading.miles }

    private var readingsDisagree: Bool {
        guard let m = measuredMi, belt.distanceMi > 0.1 else { return false }
        return IndoorDistanceMeter.materiallyDisagree(beltMi: belt.distanceMi, measuredMi: m)
    }

    /// A belt figure is modelled unless something measured the same run and
    /// agreed with it. Rule one, applied to the one number on this screen
    /// nobody sensed.
    private var distanceIsModelled: Bool {
        if belt.distanceIsModelled { return true }
        guard let m = measuredMi else { return true }
        return IndoorDistanceMeter.materiallyDisagree(beltMi: belt.distanceMi, measuredMi: m)
    }

    /// One quiet line. Names both numbers when they disagree, says what was
    /// estimated when the console was away, and otherwise says nothing.
    private var provenanceNote: String? {
        if belt.distanceIsModelled { return unmeasuredNote }
        if readingsDisagree, let m = measuredMi {
            return "Your phone counted \(Units.formatDistance(miles: m, decimals: 2)) \(Units.distanceLabel()) \u{00b7} the belt speed you set says \(Units.formatDistance(miles: belt.distanceMi, decimals: 2)). Check the belt number."
        }
        if measuredMi == nil, startedAt != nil, elapsedSec > 120 {
            return "Distance is from the belt speed you set \u{00b7} nothing here measured it."
        }
        return nil
    }

    private var unmeasuredNote: String {
        let mins = Int((belt.unmeasuredSec / 60).rounded())
        let span = mins >= 1 ? "\(mins) min" : "\(Int(belt.unmeasuredSec.rounded())) sec"
        return "\(span) ran with the app in the background \u{00b7} that distance is estimated at the belt speed you last set."
    }

    private var currentPaceText: String {
        guard speedMph > 0 else { return "\u{2014}" }
        return FaffFmt.pace(secPerMi: 3600.0 / speedMph) ?? "\u{2014}"
    }

    private func statColumn(label: String, value: FaffValue) -> some View {
        VStack(alignment: .leading, spacing: V5.S.s6) {
            Text(label)
                .font(.faffText(14))
                .tracking(14 * 0.04)
                .foregroundStyle(V5.textQuiet)
            FaffValueText(value, font: .faffText(30, weight: .semibold))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Buttons

    private var buttons: some View {
        HStack(spacing: V5.S.s10) {
            FaffButton(isPaused ? "Resume" : "Pause", variant: .secondary, size: .lg) {
                // Re-anchor so the paused wall-clock span is never credited
                // as running when the belt starts again.
                belt.resync(to: .now)
                isPaused.toggle()
                onPause()
            }
            FaffButton("End", variant: .destructive, size: .lg) {
                endAndSave()
            }
        }
    }

    /// Closes out whatever phase was still open, builds the WatchCompletion
    /// payload, and saves it through the same durable door the outdoor host
    /// uses — see the file header for why this lives here instead of being
    /// handed up through `onEnd`. Fire-then-dismiss, not awaited, matching
    /// `LiveRunHostV5.end()`'s own outdoor pattern exactly: the payload is
    /// already safe on disk (`saveCompletionDurably` persists before it
    /// attempts the network) by the time the `Task` is even scheduled, so
    /// there is nothing correctness-relevant left to wait for before handing
    /// the screen back to `onEnd`.
    private func endAndSave() {
        finalizeActivePhaseForEnd(status: "completed")
        hr.stop()
        meter.stop()
        WatchSync.shared.stopTreadmillHRSession(sessionId: workoutId)
        let payload = buildCompletionPayload(status: "completed")
        if let data = try? JSONSerialization.data(withJSONObject: payload) {
            Task { _ = await WatchSync.shared.saveCompletionDurably(data) }
        }
        onEnd()
    }
}

// MARK: - Preview

private func previewPlan() -> LiveRunPlanV5 {
    LiveRunPlanV5(
        sessionType: "Threshold",
        totalMi: 6,
        phases: [
            WatchPhase(index: 0, type: .warmup, label: "Warm up", durationSec: 600,
                      targetPaceSPerMi: 540, tolerancePaceSPerMi: 20, haptic: .start),
            WatchPhase(index: 1, type: .work, label: "Threshold", durationSec: 480,
                      targetPaceSPerMi: 452, tolerancePaceSPerMi: 8, haptic: .transitionWork,
                      hrTargetBpm: 168),
            WatchPhase(index: 2, type: .recovery, label: "Recovery", durationSec: 120,
                      targetPaceSPerMi: 540, tolerancePaceSPerMi: 20, haptic: .transitionRecovery),
            WatchPhase(index: 3, type: .work, label: "Threshold", durationSec: 480,
                      targetPaceSPerMi: 452, tolerancePaceSPerMi: 8, haptic: .transitionWork,
                      hrTargetBpm: 168),
        ],
        workoutHrCeilingBpm: nil
    )
}

// Plain functions, not inline `#Preview` statements — see the matching note
// in LiveRunOutdoorV5.swift's Preview section: a Void seeding call ahead of
// the final View expression does not type-check inside a `@ViewBuilder`
// body.

@MainActor
private func treadmillWithHeartPreview() -> some View {
    let hr = TreadmillHRStreamer()
    hr.seedForPreview(bpm: 158)
    return LiveRunTreadmillV5(plan: previewPlan(), hr: hr, onPause: {}, onEnd: {})
}

@MainActor
private func treadmillNoHeartPreview() -> some View {
    let hr = TreadmillHRStreamer()
    return LiveRunTreadmillV5(plan: previewPlan(), hr: hr, onPause: {}, onEnd: {})
}

#Preview("Treadmill · with heart") {
    treadmillWithHeartPreview()
}

#Preview("Treadmill · no heart source") {
    treadmillNoHeartPreview()
}
