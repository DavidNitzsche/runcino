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

    /// THE RECORDER. Belt speed, incline, the integrator, the phase cursor
    /// and the per-phase actuals live in this object, not in this struct.
    ///
    /// This console had the same defect the legacy one shipped: the tick ran
    /// from a closure captured inside a `.background` subtree, so it
    /// integrated `speedMph` as it stood when the closure was made rather
    /// than when the runner tapped. It ALSO averaged speed per TICK rather
    /// than per SECOND. Both are gone — see BeltSession.swift, which is where
    /// the belt speed now lives, and BeltTracker.swift for the integral.
    @StateObject private var session: BeltSession

    /// Watch HR bridge · 2026-08-21. This console never asked the watch to
    /// open an indoor HKWorkoutSession at all, so its heart rate came from
    /// HealthKit's passive every-5-minute baseline rather than the 5-15 s
    /// stream the legacy console has had since build 137. On a threshold
    /// session that is the difference between a heart-rate reading and a
    /// souvenir.
    @State private var lastPingAt: Date = .distantPast
    @State private var lastBridgeAskAt: Date = .distantPast
    @State private var lastBpmAt: Date?

    /// Stable id, stamped once. Same role as `TreadmillView`'s `workoutId` —
    /// backend idempotency key, and reused as the payload's `workoutId` so a
    /// retried POST from the durable queue overwrites rather than duplicates.
    private let workoutId: String
    /// Per-phase HEART RATE, closed at the same boundary the recorder closes
    /// its phase. Only HR lives here — the belt's own numbers are
    /// `session.actuals`, because a stale copy of those is the defect.
    @State private var hrByPhase: [Int: (avg: Int?, max: Int?)] = [:]
    /// Per-phase running-form + energy extras (power/GCT/vertical
    /// oscillation/stride length/kcal), same watch bridge, same boundary as
    /// `hrByPhase` — closed alongside it in `attachHrForClosedPhases()`.
    @State private var hrExtrasByPhase: [Int: TreadmillHRStreamer.ExtraMetrics] = [:]
    /// How many phase closes we have already attached HR to.
    @State private var hrClosedCount: Int = 0
    /// True once the plan has been handed to the recorder.
    @State private var configured = false

    init(plan: LiveRunPlanV5?, hr: TreadmillHRStreamer,
         onPause: @escaping () -> Void, onEnd: @escaping () -> Void) {
        self.plan = plan
        self._hr = ObservedObject(wrappedValue: hr)
        self.onPause = onPause
        self.onEnd = onEnd
        let id = "trd_\(UUID().uuidString)"
        self.workoutId = id
        self._session = StateObject(wrappedValue: BeltSession(
            workoutId: id,
            speedMph: Self.defaultSpeedMph(plan: plan), inclinePct: 1.0))
    }

    // One accumulator, read for the UI. `elapsedSec` and `distanceMi` were
    // separate `@State` advanced in parallel with the phase totals, which is
    // how the two could disagree.
    private var elapsedSec: Int { session.belt.elapsedSecInt }
    private var distanceMi: Double { session.belt.distanceMi }
    private var isRunning: Bool { session.isRunning }
    private var isPaused: Bool { session.startedAt != nil && !session.isRunning }
    private var startedAt: Date? { session.startedAt }
    private var speedMph: Double { session.speedMph }
    private var inclinePct: Double { session.inclinePct }

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

            buttonRow
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
        // The recorder drives itself. This only follows it, for the watch
        // bridge and the heart-rate window.
        .onReceive(session.$tickStamp) { now in
            maintainWatchBridge(at: now)
            attachHrForClosedPhases()
            // 2026-08-25 · the meter is started in `.onAppear` and stopped in
            // `.onDisappear`, so nothing between them ever told it the run had
            // paused. It measured its step rate over wall clock while the run
            // is stored against the belt's moving clock, which under-reports
            // cadence by every paused minute and can drop the carried gate
            // altogether. It reads the same clock as the distance now.
            meter.note(movingSec: session.belt.elapsedSec, isPaused: !session.isRunning)
        }
        .task {
            // A belt run this app was killed in the middle of. Same contract
            // as the outdoor recorder's: re-submitted through the same
            // durable queue with status "partial", and safe to double-fire
            // because the endpoint derives its row id from workoutId and
            // upserts. Runs before this console stamps anything of its own,
            // so the recovered run can never be confused with the new one.
            await flushInterruptedBeltRun()
        }
        .onAppear {
            // 2026-08-27 · appearing no longer starts the clock — it only gets
            // the console ready to dial in speed/incline. The runner taps
            // Start (see `buttons`/`startRun()`) the same way the belt itself
            // waits for a button before the display starts counting.
            configurePlanIfNeeded()
            // 2026-08-28 · REMOVED the early `startTreadmillHRSession` call
            // that used to fire right here. David, after opening this screen
            // just to check the watch link (never tapping Start): "somethign
            // still started a timer as you can see on my watch. no run
            // started, just checking the linking for the HR and this
            // appeared" — a screenshot of watchOS's own system "active
            // workout" pill, ticking. That head start really did start a
            // real HKWorkoutSession on the watch the instant this screen
            // rendered, before any run existed to bridge HR for — and if the
            // runner then backgrounds the phone instead of tapping Start (no
            // "End" exists yet to tap; only "Start" shows), `.onDisappear`
            // never fires because the view never left the hierarchy, so
            // nothing tells the watch to stop until its own 15-minute
            // dead-man timer does. A live sensor session sitting there for
            // up to 15 minutes because someone glanced at the ready screen
            // is exactly the battery-drain risk he'd just asked about one
            // message earlier — a "head start" is not worth that. The bridge
            // now starts ONLY in `startRun()`, anchored to the runner's own
            // Start tap, same as the clock, the pedometer and the HR stream
            // it already anchors there. The in-run `hrHint` (see below)
            // already covers "watch hasn't confirmed yet" reactively, so
            // nothing here needs to ask early to give the runner a chance to
            // fix it — see `hrHint`'s own doc for the ORIGINAL point that
            // motivated the head start.
        }
        // The plan arrives AFTER this view is built (the host renders it at
        // `.opacity(0)` while it fetches), and `State(initialValue:)` only
        // runs on that first build. Without this the plan's own target never
        // reached the belt and every planned session opened at the flat
        // 8.0 mph fallback. Seed once, and never over a runner's own input.
        .onChange(of: plan?.phases.count ?? 0) { _, _ in configurePlanIfNeeded() }
        .onDisappear {
            UIApplication.shared.isIdleTimerDisabled = false
            hr.stop()
            meter.stop()
            // Idempotent · safe even if the watch never received the start.
            WatchSync.shared.stopTreadmillHRSession(sessionId: workoutId)
        }
        .onChange(of: hr.currentBpm) { _, bpm in
            // Push heart rate INTO the recorder as a plain stored value.
            // The pace samples carry it, and the recorder must not hold a
            // closure reaching back into a view to fetch it — that is the
            // shape this whole change removes.
            session.currentBpm = bpm
            if bpm != nil { lastBpmAt = .now }
        }
        .onChange(of: session.isRunning) { _, running in
            UIApplication.shared.isIdleTimerDisabled = running
            // Resuming: re-ask rather than assume the watch session survived.
            // The watch's dead-man timer is 15 minutes and its start is
            // idempotent for the same id, so a live session no-ops.
            guard running, startedAt != nil else { return }
            lastBridgeAskAt = .now
            lastPingAt = .now
            WatchSync.shared.startTreadmillHRSession(sessionId: workoutId)
        }
    }

    // MARK: - Tick
    //
    // No GPS, no separate tracker — distance accumulates from speed × time,
    // exactly the arithmetic the prototype's own sample data performs
    // client-side (`TREADMILL_RUN`'s pace is derived from speed, not read
    // from a sensor).

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
            WatchSync.shared.startTreadmillHRSession(sessionId: workoutId)
        }
    }

    /// What to say about heart rate, or nothing when it is flowing. "No watch"
    /// and "your heart rate stopped four minutes ago" are different problems
    /// and get different sentences.
    ///
    /// 2026-08-27 · dropped the passive "No heart rate source · running on
    /// speed and incline alone." — a dead end with nothing the runner can do
    /// about it. `treadmillSessionConfirmed` now actually reflects whether the
    /// watch accepted the bridge request (fixed the same day — it checked for
    /// a reply key the watch never sends), so the unconfirmed case gets an
    /// action instead: open the watch app. Confirmed-but-still-no-sample is
    /// HealthKit latency, not a real problem, so it says nothing.
    private var hrHint: String? {
        guard startedAt != nil else { return nil }
        if let last = lastBpmAt {
            guard Date().timeIntervalSince(last) >= 120 else { return nil }
            return "Heart rate stopped \u{00b7} reconnecting to your watch."
        }
        guard elapsedSec > 45 else { return nil }
        guard !watchSync.treadmillSessionConfirmed else { return nil }
        return "Open Faff on your Apple Watch for heart rate."
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

    /// Attach heart rate to whichever phases the recorder has just closed.
    /// The recorder owns the boundary; this view owns the HR window.
    private func attachHrForClosedPhases() {
        while hrClosedCount < session.closedCount {
            let closed = hrClosedCount
            let result = hr.closePhase()
            hrByPhase[closed] = (result.avg, result.max)
            // 2026-08-27 · same boundary, same window, the five running-form
            // + energy metrics the watch bridge now also carries. Additive
            // sibling call — closePhase() above is untouched.
            hrExtrasByPhase[closed] = hr.closePhaseExtras()
            hrClosedCount += 1
        }
    }

    // MARK: - Completion payload
    //
    // WatchCompletion-shaped dict, key-for-key against
    // `TreadmillView.buildPayload` (Views/TreadmillView.swift ~line 794) —
    // see the file header for why this view POSTs itself rather than handing
    // the payload up through `onEnd`.

    private func buildCompletionPayload(status: String) -> [String: Any] {
        let iso = ISO8601DateFormatter()
        let phasePayloads: [[String: Any]] = effectivePhases.enumerated().map { i, phase in
            let act = session.actuals[i]
            let bpm = hrByPhase[i]
            let extras = hrExtrasByPhase[i]
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
                "actualSpeedMph": act.map { $0.avgSpeedMph } ?? nominalMph(for: phase),
                "actualInclinePct": act.map { $0.avgInclinePct } ?? 1.0,
            ]
            if let act, act.durationSec > 0 {
                let b = act
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
                if let avgHr = bpm?.avg { p["avgHr"] = avgHr }
                if let maxHr = bpm?.max { p["maxHr"] = maxHr }
                // 2026-08-27 · running-form + energy, same watch bridge as
                // HR above, same "absent when no watch" contract. Names
                // match `RunData` (avgPowerW / avgGctMs / avgVertOscCm /
                // avgStrideLengthM / kcal) — see TreadmillHRStreamer's
                // header for why these are the same fields the HealthKit
                // IMPORT path already writes for outdoor runs.
                if let v = extras?.avgPowerW { p["avgPowerW"] = v }
                if let v = extras?.avgGctMs { p["avgGctMs"] = v }
                if let v = extras?.avgVertOscCm { p["avgVertOscCm"] = v }
                if let v = extras?.avgStrideLengthM { p["avgStrideLengthM"] = v }
                if let v = extras?.kcal { p["kcal"] = v }
            }
            return p
        }
        // Session-level HR rollup · separate from the per-phase buffers so it
        // captures samples landing right at a phase boundary. Nil when no
        // watch is paired.
        let sessionHr = hr.closeSession()
        // Same rollup for the five running-form + energy metrics · additive
        // sibling call, does not disturb hr's own HR-only close above.
        let sessionExtras = hr.closeSessionExtras()
        var payload: [String: Any] = [
            "workoutId": workoutId,
            "startedAt": iso.string(from: startedAt ?? Date(timeIntervalSinceNow: -session.belt.elapsedSec)),
            "completedAt": iso.string(from: .now),
            "status": status,
            "totalDistanceMi": (session.belt.distanceMi * 100).rounded() / 100,
            "totalDurationSec": session.belt.elapsedSecInt,
            "elevGainFt": session.belt.elevGainFt.rounded(),
            "elevGainSource": "treadmill_incline",
            "source": "treadmill",
            "indoor": true,
            "phases": phasePayloads,
        ]
        if let avgHr = sessionHr.avg { payload["avgHr"] = avgHr }
        if let maxHr = sessionHr.max { payload["maxHr"] = maxHr }
        // 2026-08-27 · session-level running-form + energy, same watch
        // bridge. `kcal` is the one worth calling out: treadmill runs have
        // never carried a measured calorie figure (TreadmillHRSession never
        // collected anything but HR before today), so this is the first
        // real number in the slot the backend's resolveCalories tier-1
        // already prefers over the estimator — see route.ts's own kcal
        // comment. Absent (not zero) when no watch answered the bridge ask,
        // same "no watch → nil" contract as avgHr/maxHr above.
        if let v = sessionExtras.avgPowerW { payload["avgPowerW"] = v }
        if let v = sessionExtras.avgGctMs { payload["avgGctMs"] = v }
        if let v = sessionExtras.avgVertOscCm { payload["avgVertOscCm"] = v }
        if let v = sessionExtras.avgStrideLengthM { payload["avgStrideLengthM"] = v }
        if let v = sessionExtras.kcal { payload["kcal"] = v }
        // What this run could not witness. Keys ABSENT on a clean run.
        if session.belt.unmeasuredSec >= 1 {
            payload["unmeasuredSec"] = Int(session.belt.unmeasuredSec.rounded())
            payload["unmeasuredDistanceMi"] = (session.belt.unmeasuredMi * 100).rounded() / 100
        }
        if session.belt.droppedSec >= 1 {
            payload["droppedGapSec"] = Int(session.belt.droppedSec.rounded())
        }
        if session.belt.pausedSec >= 1 { payload["pausedSec"] = Int(session.belt.pausedSec.rounded()) }
        // Provenance, same contract as the legacy console — see
        // Views/TreadmillView.swift buildPayload for the full argument.
        payload["distanceSource"] = {
            guard let m = measuredMi else { return "belt_stated" }
            return IndoorDistanceMeter.materiallyDisagree(beltMi: session.belt.distanceMi, measuredMi: m)
                ? "belt_contested" : "belt_corroborated"
        }()
        // Cadence, MEASURED. The watch bridge (2026-08-27: HR + running
        // power/GCT/vertical oscillation/stride length/active energy, all
        // via TreadmillHRStreamer reading HealthKit) does not carry step
        // cadence — CMPedometer.currentCadence on the PHONE covers that,
        // same as watch-started outdoor runs via WorkoutTracker. Same
        // pedometer, same carried gate: nil rather than a zero when the
        // phone was parked on the console.
        if let cad = meter.avgCadenceSpm { payload["avgCadence"] = cad }
        if let m = meter.rawDistanceMi { payload["pedometerDistanceMi"] = (m * 100).rounded() / 100 }
        if let st = meter.rawSteps { payload["pedometerSteps"] = st }
        if !IndoorDistanceMeter.isSupported { payload["pedometerAvailable"] = false }
        payload["clockDriftSec"] = (session.belt.clockDriftSec(
            startedAt: startedAt ?? Date(timeIntervalSinceNow: -session.belt.elapsedSec),
            completedAt: .now) * 10).rounded() / 10
        return payload
    }

    /// Starting belt speed for a phase never reached — from its own target
    /// pace when the plan set one, else the same flat defaults legacy falls
    /// back to. Never the live speedMph, which belongs to whichever phase
    /// the runner actually was on.
    /// Hand the recorder the shape of the session, once. The host builds this
    /// view before the plan lands, so this runs again when it arrives — the
    /// recorder ignores it after the run has started.
    private func configurePlanIfNeeded() {
        guard !configured || session.startedAt == nil else { return }
        configured = true
        session.configure(plan: effectivePhases.map {
            BeltSession.SegmentPlan(durationSec: $0.durationSec,
                                    targetMph: nominalMph(for: $0),
                                    targetInclinePct: 1.0)
        })
    }

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
                            fill: V5.materialControl, ink: V5.textPrimary,
                            spoken: "Slow the belt down") {
                    adjustSpeed(-1)
                }
                // 104pt is drawn for "8.0". A belt at "12.0" is one glyph
                // wider and truncated to "1..." — the console's largest,
                // most-read number, unreadable at exactly the speeds a fast
                // runner uses. Shrink to fit rather than clip; the tile keeps
                // its height either way.
                Text(Units.formatSpeed(mph: speedMph))
                    .font(.faffText(TypeScaleV5.valueMax, weight: .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.65)
                    .foregroundStyle(V5.textPrimary)
                roundControl(symbol: "plus", diameter: 72, glyphSize: 30,
                            fill: V5.materialAction, ink: V5.actionPrimaryText,
                            spoken: "Speed the belt up") {
                    adjustSpeed(1)
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
                            fill: V5.materialControl, ink: V5.textPrimary,
                            spoken: "Lower the incline") {
                    adjustIncline(-0.5)
                }
                Text(FaffFmt.oneDecimal(inclinePct) ?? "0.0")
                    .font(.faffText(68, weight: .semibold))
                    .foregroundStyle(V5.textPrimary)
                roundControl(symbol: "plus", diameter: 60, glyphSize: 26,
                            fill: V5.materialAction, ink: V5.actionPrimaryText,
                            spoken: "Raise the incline") {
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

    /// PRESS AND HOLD, not tap-tap-tap. A notch is 0.2 mph, so 6.0 to 9.0 is
    /// fifteen taps — and a burst of taps is counted as roughly one. See
    /// `RepeatStepV5` for the measurement. A single deliberate tap is still
    /// exactly one notch.
    private func roundControl(symbol: String, diameter: CGFloat, glyphSize: CGFloat,
                              fill: Color, ink: Color, spoken: String,
                              action: @escaping () -> Void) -> some View {
        RepeatStepV5(step: action, accessibilityLabel: spoken) {
            Image(systemName: symbol)
                .font(.system(size: glyphSize, weight: .bold))
                .foregroundStyle(ink)
                .frame(width: diameter, height: diameter)
                .background(fill, in: Circle())
        }
    }

    /// The step and the bounds move in the unit the runner is READING. They
    /// stepped in mph regardless of preference, so a km runner's tap moved
    /// the display by 0.32 km/h and no sequence of taps reached a round
    /// km/h number. The accumulator is still mph — only the notch is theirs.
    ///
    /// Any belt change is a RUNNER input: `runnerSetSpeed` records that, so
    /// nothing in this view may later overwrite it with a plan target.
    private func adjustSpeed(_ notches: Double) {
        session.stepSpeed(notches: notches, unit: Units.preference.distance)
    }

    /// Incline is a percent grade on every belt, in every country.
    private func adjustIncline(_ delta: Double) {
        session.stepIncline(delta)
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
                // A distance we cannot format is one we cannot read, and a
                // confident "0" is the opposite of that. nil is .unreadable.
                // 2026-08-25 · was `FaffFmt.miles`, the one-decimal format for a
                // finished distance. On a belt console it read a bare "0" for
                // the first 0.05 mi and then stepped a tenth at a time — the
                // outdoor console had already diagnosed exactly this and fixed
                // it privately, so the two live consoles printed one distance
                // two ways. `FaffFmt.liveMiles` is now that fix, shared.
                statColumn(label: "DIST",
                           value: FaffValue.from(FaffFmt.liveMiles(distanceMi),
                                                 modelled: distanceIsModelled))
                // PACE here is 3600 / the belt speed the runner typed in.
                // Nothing sensed it — it inherits the distance's provenance,
                // because it IS the distance divided by time.
                statColumn(label: "PACE",
                           value: FaffValue.from(currentPaceText,
                                                 modelled: distanceIsModelled))
                if let bpm = hr.currentBpm {
                    statColumn(label: "HR",
                               value: FaffValue.from(FaffFmt.bpm(Double(bpm)),
                                                     modelled: false))
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
        guard let m = measuredMi, session.belt.distanceMi > 0.1 else { return false }
        return IndoorDistanceMeter.materiallyDisagree(beltMi: session.belt.distanceMi, measuredMi: m)
    }

    /// A belt figure is modelled unless something measured the same run and
    /// agreed with it. Rule one, applied to the one number on this screen
    /// nobody sensed.
    private var distanceIsModelled: Bool {
        if session.belt.distanceIsModelled { return true }
        guard let m = measuredMi else { return true }
        return IndoorDistanceMeter.materiallyDisagree(beltMi: session.belt.distanceMi, measuredMi: m)
    }

    /// One quiet line. Only fires when the two distance readings actually
    /// disagree by enough to matter — that's the one case with something
    /// for the runner to act on. 2026-08-27 dropped the other two cases
    /// (nothing measured it at all / estimated while backgrounded): both
    /// were passive disclaimers with no action attached, on by default for
    /// most treadmill runs (no phone motion sensor, or a locked screen).
    private var provenanceNote: String? {
        if readingsDisagree, let m = measuredMi {
            return "Your phone counted \(Units.formatDistance(miles: m, decimals: 2)) \(Units.distanceLabel()) \u{00b7} the belt speed you set says \(Units.formatDistance(miles: session.belt.distanceMi, decimals: 2)). Check the belt number."
        }
        return nil
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
    //
    // 2026-08-28 · the pre-run "open your watch" / "Linked" line that used to
    // sit above this row is gone along with the early `.onAppear` bridge
    // start it was reporting on (see that removal's comment) — nothing
    // happens on the watch until Start is tapped, so there was nothing left
    // to say here pre-Start. `hrHint` below covers the same question the
    // moment the run actually starts.

    private var buttonRow: some View {
        HStack(spacing: V5.S.s10) {
            if startedAt == nil {
                FaffButton("Start", variant: .primary, size: .lg) {
                    startRun()
                }
            } else {
                FaffButton(isPaused ? "Resume" : "Pause", variant: .secondary, size: .lg) {
                    // The recorder owns its own clock, so pause and resume
                    // re-anchor inside the model.
                    session.togglePause()
                    onPause()
                }
                FaffButton("End", variant: .destructive, size: .lg) {
                    endAndSave()
                }
            }
        }
    }

    /// Everything that used to fire on `.onAppear` — now deferred to the
    /// runner's own tap. Dial in speed/incline first, then Start: the clock,
    /// the pedometer, the HR stream and the watch bridge all anchor to this
    /// instant instead of the moment the console happened to render.
    private func startRun() {
        guard startedAt == nil else { return }
        let now = Date()
        session.start(at: now)
        meter.start(from: now)
        UIApplication.shared.isIdleTimerDisabled = true
        Task { await hr.start(from: now) }
        // Ask the watch for a real indoor workout session, so HealthKit
        // gets 5-15 s samples instead of the passive baseline.
        lastBridgeAskAt = now
        lastPingAt = now
        WatchSync.shared.startTreadmillHRSession(sessionId: workoutId)
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
    /// Re-submit a belt run the app died in the middle of.
    ///
    /// Totals only — the checkpoint deliberately does not carry the sample
    /// streams, so this posts one work phase with the distance, the time and
    /// the belt settings it had. A partial run that exists beats a complete
    /// one that does not.
    private func flushInterruptedBeltRun() async {
        guard let cp = BeltSession.interruptedRun(), cp.workoutId != workoutId else { return }
        // Nothing worth recovering. A console opened and closed leaves a
        // checkpoint too, and re-POSTing a ten-second stub would put a run in
        // the log the runner never did.
        guard cp.distanceMi >= 0.1, cp.elapsedSec >= 60 else {
            BeltSession.clearCheckpoint(workoutId: cp.workoutId)
            return
        }
        let iso = ISO8601DateFormatter()
        let payload: [String: Any] = [
            "workoutId": cp.workoutId,
            "startedAt": iso.string(from: cp.startedAt),
            "completedAt": iso.string(from: cp.updatedAt),
            "status": "partial",
            "totalDistanceMi": (cp.distanceMi * 100).rounded() / 100,
            "totalDurationSec": cp.elapsedSec,
            "elevGainFt": cp.elevGainFt.rounded(),
            "elevGainSource": "treadmill_incline",
            "source": "treadmill",
            "indoor": true,
            "timezone": TimeZone.current.identifier,
            "phases": [[
                "label": "Treadmill",
                "type": "work",
                "completed": false,
                "actualSpeedMph": cp.speedMph,
                "actualInclinePct": cp.inclinePct,
                "actualDistanceMi": (cp.distanceMi * 100).rounded() / 100,
                "actualDurationSec": cp.elapsedSec,
            ]],
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return }
        _ = await WatchSync.shared.saveCompletionDurably(data)
        BeltSession.clearCheckpoint(workoutId: cp.workoutId)
    }

    private func endAndSave() {
        session.finish()
        attachHrForClosedPhases()
        hr.stop()
        meter.stop()
        WatchSync.shared.stopTreadmillHRSession(sessionId: workoutId)
        let payload = buildCompletionPayload(status: "completed")
        if let data = try? JSONSerialization.data(withJSONObject: payload) {
            Task {
                _ = await WatchSync.shared.saveCompletionDurably(data)
                // Only once the run is in the durable queue. Clearing before
                // that would trade one loss window for another — the queue
                // survives a kill, and until the run is in it the checkpoint
                // is the only copy.
                BeltSession.clearCheckpoint(workoutId: workoutId)
            }
        }
        onEnd()
    }
}

// MARK: - Preview
//
// `#if DEBUG` for the whole region: `seedForPreview` is a DEBUG-only seam,
// but `#Preview` expands in Release too, so this failed the archive. See the
// matching note in LiveRunOutdoorV5.swift.

#if DEBUG

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
func treadmillWithHeartPreview() -> some View {
    let hr = TreadmillHRStreamer()
    hr.seedForPreview(bpm: 158)
    return LiveRunTreadmillV5(plan: previewPlan(), hr: hr, onPause: {}, onEnd: {})
}

@MainActor
func treadmillNoHeartPreview() -> some View {
    let hr = TreadmillHRStreamer()
    return LiveRunTreadmillV5(plan: previewPlan(), hr: hr, onPause: {}, onEnd: {})
}

#Preview("Treadmill · with heart") {
    treadmillWithHeartPreview()
}

#Preview("Treadmill · no heart source") {
    treadmillNoHeartPreview()
}

#endif  // DEBUG · previews only
