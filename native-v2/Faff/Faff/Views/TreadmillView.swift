//
//  TreadmillView.swift
//  Guided treadmill console · 2026-06-01 v2 (build 136 target).
//
//  Previously: hardcoded 4-interval session, no plan read, no POST,
//  nothing persisted. Visual stub only.
//
//  Now:
//  · Fetches today's WatchWorkout via /api/watch/today on appear
//  · Derives segments from the plan's WatchPhase array (warmup/
//    work/recovery/cooldown). Falls back to a single open-run
//    segment when no plan / rest day / fetch fails.
//  · Real timer counts elapsed seconds via a run-loop Timer; pause halts,
//    skip advances, end POSTs.
//  · Runner enters actual speed (±0.1 mph) + incline (±0.5%) per
//    segment via the existing steppers. Initial values come from the
//    plan's target pace (mph-converted) when available, else 5.5/1.0.
//  · Per-segment actuals (speed + incline at end of segment) get
//    recorded into a phase buffer. On End, the buffer becomes the
//    POST payload's `phases[].actualSpeedMph` + `actualInclinePct`.
//  · Distance accumulates from speed × time per tick (treadmill GPS
//    is unavailable on the phone).
//  · End button POSTs WatchCompletion-shaped payload to
//    /api/watch/workouts/complete with source='treadmill' +
//    indoor=true. Backend ingest changes are in
//    designs/briefs/treadmill-backend-wire-brief.md (must land
//    alongside this for source to be respected).
//
//  HR-from-HK (live): when the runner wears an Apple Watch on the
//  treadmill, the watch streams HR samples into HealthKit. The view
//  reads them via TreadmillHRStreamer (HKObserverQuery + HKAnchored
//  ObjectQuery, anchored at session start) with ~5-30s latency.
//  Per-phase avgHr/maxHr land in actualsBySegment[i] and flow into the
//  POST payload. Non-watch users see no HR pill and the payload stays
//  null for HR fields, which backend resolveCalories tier 3 handles.
//

import SwiftUI
import HealthKit
import UIKit

struct TreadmillView: View {
    @Environment(\.dismiss) private var dismiss

    // ── Live HR feed (HK · build 136) ───────────────────────────────
    @StateObject private var hrStreamer = TreadmillHRStreamer()
    // ── Measured indoor distance (CoreMotion · 2026-08-21) ──────────
    // The belt speed below is a number the runner TYPED. This is the only
    // number on this screen a sensor produced. It does not replace the belt
    // figure — see IndoorDistanceMeter.swift for why not — it corroborates
    // it, or it contradicts it and says so.
    @StateObject private var meter = IndoorDistanceMeter()
    /// Observed for `treadmillSessionConfirmed` — the watch's real answer to
    /// "did your HR session actually open", as opposed to "did we manage to
    /// send the request".
    @ObservedObject private var watchSync = WatchSync.shared

    // ── Plan source · fetched on .task ──────────────────────────────
    @State private var workout: WatchWorkout?
    @State private var loaded: Bool = false

    // ── Live session state ──────────────────────────────────────────
    /// THE RECORDER. Belt speed, incline, the integrator, the segment
    /// cursor and the per-segment actuals all live in this object, not in
    /// this struct.
    ///
    /// That is the fix for the 2026-08-20 defect, not a tidy-up. All of it
    /// used to be `@State` on this view, and the tick ran from a closure
    /// captured inside a `.background` subtree — so the closure integrated
    /// `speedMph` as it stood when the closure was made. David moved the belt
    /// on the steppers, the display re-read `@State` and showed the new
    /// number immediately, and the integrator kept using the captured copy.
    /// See BeltSession.swift's header for the arithmetic that pins it, and
    /// the harness that reproduces the old shape failing.
    @StateObject private var session = BeltSession()
    /// Workout startedAt wall-clock · stamped on first play.
    @State private var startedAt: Date?
    /// Stable workout id · generated once on first play. Used as the
    /// WatchConnectivity sessionId for the watch HR bridge AND as the
    /// payload's workoutId so backend idempotency is consistent across
    /// retries.
    @State private var workoutId: String?
    /// Did we successfully ask the watch to stream HR? false when the
    /// Faff watch app isn't launched/reachable · drives the "Open Faff
    /// on watch for live HR" pill in the topbar so the runner knows to
    /// fix the bridge if they want live HR.
    @State private var watchHRBridgeUp: Bool = false
    /// Per-segment HEART RATE, closed at the same boundary the recorder
    /// closes its segment. Only HR lives here now — the belt's own numbers
    /// are `session.actuals`, because a stale copy of those is what this
    /// whole change is about.
    @State private var hrBySegment: [Int: (avg: Int?, max: Int?)] = [:]
    /// How many segment closes we have already attached HR to, so a bump in
    /// `session.closedCount` is matched exactly once.
    @State private var hrClosedCount: Int = 0

    /// Confirm-end prompt before POST.
    @State private var showEndConfirm: Bool = false
    /// Status indicator for the POST request.
    @State private var posting: Bool = false
    @State private var postError: String?
    /// P1-21 (2026-07-06) · the payload is persisted to the durable
    /// completion queue BEFORE the first POST. When the immediate POST
    /// fails (gym basement, airplane mode) this flips true: the run is
    /// safe on disk and WatchSync retries on launch/foreground until the
    /// server accepts. The old UI offered "Discard and exit" as the only
    /// escape — permanent data loss for a 60-minute session.
    @State private var savedSyncing: Bool = false
    /// Wall-clock of the last watch keepalive ping (P2-49) · the watch's
    /// dead-man timer resets on each ping and auto-ends its HR session
    /// when pings stop (phone died / app killed / runner walked off).
    @State private var lastPingAt: Date = .distantPast
    /// Wall-clock of the last attempt to (re)open the watch's HR session.
    @State private var lastBridgeAskAt: Date = .distantPast
    /// Wall-clock of the last HR sample that actually landed · the difference
    /// between "no watch" and "the watch stopped talking", which the runner
    /// deserves to be told apart.
    @State private var lastBpmAt: Date?


    // ── Derived: segments from workout.phases ──────────────────────

    private var segments: [TreadSeg] {
        guard let phases = workout?.phases, !phases.isEmpty else {
            // Cold path · no plan loaded yet OR rest day OR fetch
            // failed. Single open segment, runner just logs.
            return [TreadSeg(label: "Just Run", sub: "",
                             kind: .work, mph: 5.5, inc: 1.0, dur: 30 * 60)]
        }
        // COLD-4 2026-08-17 · a belt needs a number even when the session does
        // not have one, so the defaults below stay. What changes is WHERE the
        // number comes from for a runner we have never measured: a session
        // prescribed by effort (hill reps · the cold-start calibration intro)
        // used to hand them a flat 7.0 mph — 8:34/mi — which is a pace, and a
        // fast one, invented by this view. When the session carries an easy
        // anchor of its own (the warm-up, which is derived from the runner's own
        // band) start the work segments a step above it instead. The runner
        // adjusts by feel from there, which is what the session is asking for.
        let easyMph = phases
            .first(where: { $0.type == .warmup })
            .flatMap { mphFromPaceSPerMi($0.targetPaceSPerMi) }
        return phases.map { phase in
            let mph = mphFromPaceSPerMi(phase.targetPaceSPerMi)
                ?? effortStartMph(phase.type, easyMph: easyMph)
                ?? defaultMphFor(phase.type)
            let kind: TreadSegKind = {
                switch phase.type {
                case .warmup:   return .warm
                case .work:     return .work
                case .recovery: return .rec
                case .cooldown: return .cool
                }
            }()
            return TreadSeg(
                label: phase.label,
                sub: "",
                kind: kind,
                mph: mph,
                inc: 1.0,   // treadmill default; runner adjusts
                dur: phase.durationSec
            )
        }
    }

    /// Convert sec/mi pace into mph. 7:00/mi → 8.57 mph.
    private func mphFromPaceSPerMi(_ secPerMi: Int?) -> Double? {
        guard let s = secPerMi, s > 0 else { return nil }
        return 3600.0 / Double(s)
    }

    /// COLD-4 · a STARTING belt speed for a by-effort segment, anchored on the
    /// runner's own easy pace rather than a population constant. Threshold work
    /// sits roughly 0.8 mph above easy and recoveries at easy — close enough to
    /// begin, which is all a by-effort session needs; the runner takes it from
    /// there. Returns nil when the session carries no easy anchor either, and
    /// the flat defaults below stand.
    private func effortStartMph(_ type: WatchPhaseType, easyMph: Double?) -> Double? {
        guard let easy = easyMph, easy > 0 else { return nil }
        switch type {
        case .warmup, .cooldown, .recovery: return easy
        case .work: return easy + 0.8
        }
    }

    /// Sensible defaults when the plan didn't carry a target pace.
    private func defaultMphFor(_ type: WatchPhaseType) -> Double {
        switch type {
        case .warmup:   return 5.5
        case .work:     return 7.0
        case .recovery: return 5.0
        case .cooldown: return 5.0
        }
    }

    // MARK: - body

    var body: some View {
        // 2026-06-02 round 36 · per-RUN effort mesh (not per-segment,
        // not time-of-day). The run's overall type (easy / tempo /
        // long / intervals / recovery / rest) drives the palette ·
        // matches every other run surface in the app + the web app.
        // Derive from the workout's paceLabel (T/E/I/L tag) with a
        // fallback to easy for null/unknown.
        let effort = FaffEffort.fromType(workout?.paceLabel ?? "easy")
        let mesh = effort.mesh
        ZStack {
            FaffMeshView(mesh: mesh)

            VStack(spacing: 0) {
                topHead
                    .padding(.horizontal, 20)
                    .padding(.top, 8)

                segRow
                    .padding(.horizontal, 20)
                    .padding(.top, 24)

                segProgressBar
                    .padding(.horizontal, 20)
                    .padding(.top, 16)

                console
                    .padding(.horizontal, 20)
                    .padding(.top, 20)

                Spacer(minLength: 0)

                bottomBlock
                    .padding(.horizontal, 20)
                    .padding(.bottom, 24)
            }
            .foregroundStyle(Theme.txt)
            // Live tick · 2026-08-21. Was:
            //
            //   .background(TimelineView(.periodic(from: .now, by: 1.0)) { ctx in
            //       Color.clear.onChange(of: ctx.date) { _, now in tick(at: now) } })
            //
            // which is a feedback loop, not a clock. `.now` is read inside
            // `body`, so every re-render builds a NEW schedule anchored at a
            // new instant, which yields a new `ctx.date`, which fires
            // `onChange`, which ticks, which writes state, which re-renders.
            // The same construct was instrumented on the outdoor recorder and
            // measured at 5,543 ticks in ~15 seconds, saturating the main
            // actor hard enough that only 2 GPS fixes were accepted in the
            // same window.
            //
            // On the OLD tick that was silent data loss: every sub-second
            // delta rounded to zero while `lastTickAt` advanced anyway, so
            // both the seconds and the distance for that interval vanished.
            // (BeltTracker now accumulates in Double seconds, so a fast tick
            // is arithmetically harmless — but a saturated main actor still
            // starves HealthKit delivery, the pedometer callbacks, and the
            // runner's own taps on the ± steppers.)
            //
            // A run-loop timer in `.common` mode fires at a fixed 1 Hz
            // regardless of rendering, and nothing in `body` reads the clock,
            // so there is no loop to close. `.onReceive` keeps every state
            // access inside SwiftUI's normal update cycle.
            // The recorder drives itself. This only follows it, for the
            // watch bridge and the heart-rate window — neither of which can
            // corrupt a distance by going stale.
            .onReceive(session.$tickStamp) { now in
                maintainWatchBridge(at: now)
                attachHrForClosedSegments()
                // 2026-08-25 · same wiring as the v5 console · the meter must
                // measure its step rate over the belt's MOVING clock, not over
                // wall clock, or a paused minute lands in the denominator of a
                // cadence the run is then filed with.
                meter.note(movingSec: session.belt.elapsedSec, isPaused: !session.isRunning)
            }
        }
        .task {
            await loadPlan()
        }
        // P2-45 · keep the screen awake while the session is running. iOS
        // auto-lock (30s default) suspended the app mid-run: guided segments
        // mangled and distance kept crediting at a stale speed. Scoped to
        // `playing` only — pausing re-enables auto-lock, and both the end
        // path and onDisappear reset it so the flag never leaks app-wide.
        .onChange(of: playing) { _, isPlaying in
            UIApplication.shared.isIdleTimerDisabled = isPlaying
            // Resuming after a long pause: ask for the watch's HR session
            // again rather than assuming it survived. The watch's start is
            // idempotent for the same id, so a live session no-ops.
            if isPlaying, startedAt != nil, let id = workoutId {
                lastBridgeAskAt = .now
                lastPingAt = .now
                watchHRBridgeUp = WatchSync.shared.startTreadmillHRSession(sessionId: id)
            }
        }
        .onChange(of: hrStreamer.currentBpm) { _, bpm in
            // Push heart rate INTO the recorder as a plain stored value.
            // The pace samples carry it, and the recorder must not hold a
            // closure reaching back into a view to fetch it — that is the
            // shape this whole change removes.
            session.currentBpm = bpm
            if bpm != nil { lastBpmAt = .now }
        }
        .onDisappear {
            UIApplication.shared.isIdleTimerDisabled = false
            meter.stop()
            if let id = workoutId {
                WatchSync.shared.stopTreadmillHRSession(sessionId: id)
            }
        }
        .alert("End workout?", isPresented: $showEndConfirm) {
            Button("End and save", role: .destructive) { endAndPost(status: "completed") }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Saves what you've done so far · skips remaining segments.")
        }
        // 2026-06-02 round 34 · hide the floating tab bar while the
        // treadmill console is on screen. The console's End/Skip/Pause
        // buttons sit at the bottom and were getting clipped by the
        // tab bar pill. Active run = full-screen takeover.
        .hideFaffTabBar()
    }

    // MARK: - Load plan

    private func loadPlan() async {
        guard !loaded else { return }
        let fetched = try? await API.fetchWatchWorkout()
        await MainActor.run {
            self.workout = fetched
            self.loaded = true
            // Hand the recorder the shape of the session. It seeds its own
            // starting belt speed from the first segment.
            self.session.configure(plan: segments.map {
                BeltSession.SegmentPlan(durationSec: $0.dur,
                                        targetMph: $0.mph,
                                        targetInclinePct: $0.inc)
            })
        }
    }

    // MARK: - Derived clock reads
    //
    // One accumulator, read three ways. These were three separate `@State`
    // Ints being advanced in parallel, which is how the run total and the
    // per-phase totals were able to disagree in the first place.

    /// Seconds elapsed within the current segment (counts UP from 0).
    private var elapsedInSeg: Int { Int(session.belt.segElapsedSec) }
    /// Cumulative elapsed seconds across the whole session.
    private var totalSec: Int { session.belt.elapsedSecInt }
    /// Index into `segments` for the active segment · owned by the recorder.
    private var idx: Int { session.segmentIndex }
    private var speedMph: Double { session.speedMph }
    private var inclinePct: Double { session.inclinePct }
    private var playing: Bool { session.isRunning }

    // MARK: - The recorder's tick
    //
    // There is no `tick` on this view any more. `BeltSession` owns the clock
    // and does the integration inside itself, reading its own stored belt
    // speed at the instant the timer fires. This view only reacts to the
    // tick, for work that cannot corrupt a recorded number.

    /// P2-49 · watch keepalive, plus the two things it was missing.
    ///
    /// `watchHRBridgeUp` is only "the message was SENT" — the real
    /// acknowledgement is `WatchSync.treadmillSessionConfirmed`, which was
    /// written by the reply handler and read nowhere. So a watch that took
    /// the start message but failed to open its session got pinged for the
    /// whole run while the runner was told nothing. Now an unconfirmed bridge
    /// is RE-ASKED rather than pinged into the void, and the topbar says
    /// there is no live HR.
    ///
    /// `TreadmillHRSession.start(sessionId:)` on the watch is idempotent for
    /// the same id — a live session no-ops, a dead one comes back — so
    /// re-asking is safe to repeat.
    private func maintainWatchBridge(at now: Date) {
        guard startedAt != nil, let id = workoutId else { return }
        let confirmed = watchSync.treadmillSessionConfirmed
        // Confirmed and alive · a ping every ~2 min resets the dead-man timer.
        if confirmed, now.timeIntervalSince(lastPingAt) >= 120 {
            lastPingAt = now
            WatchSync.shared.pingTreadmillHRSession(sessionId: id)
            return
        }
        // Asked, never answered — or answered and then went quiet. Ask again,
        // no more than once a minute so an absent watch is not hammered.
        if !confirmed, now.timeIntervalSince(lastBridgeAskAt) >= 60 {
            lastBridgeAskAt = now
            lastPingAt = now
            watchHRBridgeUp = WatchSync.shared.startTreadmillHRSession(sessionId: id)
        }
    }

    /// Attach heart rate to whichever segments the recorder has just closed.
    ///
    /// The recorder owns the boundary — it is the thing that knows when a
    /// segment's integral ends. This view owns the HR window, because HR
    /// comes from HealthKit rather than from a value a render cycle could
    /// leave stale. `closedCount` bumps once per close, and this drains it.
    private func attachHrForClosedSegments() {
        while hrClosedCount < session.closedCount {
            let closedIdx = hrClosedCount
            let hr = hrStreamer.closePhase()
            hrBySegment[closedIdx] = (hr.avg, hr.max)
            hrClosedCount += 1
        }
    }

    // MARK: - Topbar

    private var topHead: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 3) {
                Text(workout?.name ?? "Just Run")
                    .font(.body(19, weight: .extraBold))
                    .tracking(-0.3)
                    .lineLimit(1)
                SpecLabel(text: "TREADMILL · GUIDED", size: 10, tracking: 2, color: Theme.txt.opacity(0.6))
            }
            // Watch-HR-bridge hint. Was gated on `!watchHRBridgeUp`, which
            // is "we managed to SEND the request" — so a watch that took the
            // message and failed to open its session showed nothing at all,
            // and an HR feed that died mid-run (the 15-minute dead-man timer
            // after a long pause) also showed nothing. Both now say so, and
            // they say different things, because they are different problems.
            if let hint = hrHint {
                Text(hint)
                    .font(.body(10, weight: .semibold))
                    .tracking(0.3)
                    .foregroundStyle(Theme.txt.opacity(0.75))
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(Color.white.opacity(0.12), in: Capsule())
                    .overlay(Capsule().stroke(Color.white.opacity(0.22)))
            }
            HStack(alignment: .top, spacing: 0) {
                topStat("TIME", formatClock(totalSec))
                // 2026-07-07 · units audit — `session.belt.distanceMi` (the internal
                // accumulator driving the recorded run's totalDistanceMi)
                // stays miles; only this display string converts.
                // Units.formatDistance no-ops back to the exact "%.1f" mi
                // reading when the preference is mi (default, byte-safe for
                // every existing runner). Kept at 2 decimals via the explicit
                // param since treadmill distance benefits from the finer
                // live read.
                //
                // 2026-08-21 · the mark. When part of this distance was
                // credited across seconds the app did not witness (screen
                // locked, app backgrounded), the number is partly an estimate
                // and says so — amber tilde, same mark the rest of the app
                // uses for a modelled number. Rule one is a system rule, not
                // one screen's fix.
                topStat("DISTANCE",
                        "\(Units.formatDistance(miles: session.belt.distanceMi, decimals: 2)) \(Units.distanceLabel())",
                        modelled: distanceIsModelled)
                topStat("PHASE", "\(min(idx + 1, segments.count))/\(segments.count)")
            }
            if let note = provenanceNote {
                Text(note)
                    .font(.body(10, weight: .semibold))
                    .foregroundStyle(Theme.warnText.opacity(0.9))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Where this run's distance comes from
    //
    // The belt figure is an integral of a STATED speed. Nothing measured it,
    // so under rule one it is modelled and wears the amber mark — unless a
    // carried phone's pedometer independently lands on the same number, which
    // is corroboration and takes the mark off.

    /// The pedometer's own reading, when the phone was actually on the runner.
    private var measuredMi: Double? { meter.reading.miles }

    /// True when the two readings are telling different stories.
    private var readingsDisagree: Bool {
        guard let m = measuredMi, session.belt.distanceMi > 0.1 else { return false }
        return IndoorDistanceMeter.materiallyDisagree(beltMi: session.belt.distanceMi, measuredMi: m)
    }

    /// The displayed distance is measured only when something measured it.
    private var distanceIsModelled: Bool {
        if session.belt.distanceIsModelled { return true }          // credited across a gap
        guard let m = measuredMi else { return true }        // nothing corroborates it
        return IndoorDistanceMeter.materiallyDisagree(beltMi: session.belt.distanceMi, measuredMi: m)
    }

    /// One quiet line under the stats. Names both numbers when they disagree,
    /// says what was estimated when the app was away, and otherwise says
    /// nothing at all. Never scolds, never picks for the runner.
    private var provenanceNote: String? {
        if session.belt.distanceIsModelled { return unmeasuredNote }
        if readingsDisagree, let m = measuredMi {
            return "Your phone counted \(Units.formatDistance(miles: m, decimals: 2)) \(Units.distanceLabel()) · the belt speed you set says \(Units.formatDistance(miles: session.belt.distanceMi, decimals: 2)). Check the belt number."
        }
        if measuredMi == nil, startedAt != nil, totalSec > 120 {
            return "Distance is from the belt speed you set · nothing here measured it."
        }
        return nil
    }

    /// What to say about heart rate, or nothing when it is flowing.
    ///
    /// Three distinct states, because "no HR" from a runner with no watch and
    /// "your HR stopped 4 minutes ago" are not the same message:
    ///   · never arrived        → tell them how to start it
    ///   · arrived, then quiet  → tell them it stopped, and that it is coming
    ///                            back (maintainWatchBridge re-asks)
    ///   · flowing              → say nothing
    private var hrHint: String? {
        guard startedAt != nil else { return nil }
        if let last = lastBpmAt {
            guard Date().timeIntervalSince(last) >= 120 else { return nil }
            return "Heart rate stopped · reconnecting to your watch"
        }
        // Give the first sample its 5-30 s of HealthKit latency before
        // claiming there is nothing there.
        guard totalSec > 45 else { return nil }
        return "Open Faff on your watch for live HR"
    }

    /// Says what is estimated and why, once, without scolding. The runner
    /// did nothing wrong by locking their phone.
    private var unmeasuredNote: String {
        let mins = Int((session.belt.unmeasuredSec / 60).rounded())
        let span = mins >= 1 ? "\(mins) min" : "\(Int(session.belt.unmeasuredSec.rounded())) sec"
        return "\(span) ran with the app in the background · that distance is estimated at the belt speed you last set."
    }

    private func topStat(_ k: String, _ v: String, modelled: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            SpecLabel(text: k, size: 9, tracking: 1.5, color: Theme.txt.opacity(0.58))
            HStack(alignment: .firstTextBaseline, spacing: 0) {
                if modelled {
                    Text(Theme.V5.modelledMark)
                        .font(.display(21, weight: .bold))
                        .scaleEffect(0.62, anchor: .bottomTrailing)
                        .foregroundStyle(Theme.warnText)
                        .accessibilityLabel("estimated")
                }
                Text(v).font(.display(21, weight: .bold)).tracking(-0.5)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Segment row + bar

    private var segRow: some View {
        HStack {
            Text(segLabelText)
                .font(.body(14, weight: .extraBold))
                .tracking(1.5)
                .textCase(.uppercase)
                .padding(.horizontal, 18).padding(.vertical, 9)
                .background(Color.white.opacity(0.18), in: Capsule())
                .overlay(Capsule().stroke(Color.white.opacity(0.32), lineWidth: 1))
                .background(.ultraThinMaterial, in: Capsule())
            if let target = session.pendingTargetMph { matchTargetChip(target) }
            Spacer()
            HStack(alignment: .lastTextBaseline, spacing: 6) {
                Text(isOverTarget ? "+\(formatClock(overInSeg))" : formatClock(remainingInSeg))
                    .font(.display(42, weight: .bold))
                    .tracking(-1)
                    .foregroundStyle(isOverTarget ? Theme.green : Theme.txt)
                Text(isOverTarget ? "OVER" : "LEFT")
                    .font(.label(11)).tracking(1.5)
                    .foregroundStyle(isOverTarget ? Theme.green.opacity(0.85) : Theme.txt.opacity(0.6))
            }
        }
    }

    /// The segment's asked speed, one tap away, when the belt is not on it.
    /// This is what replaced silently writing the target into `speedMph` at
    /// every boundary: the app can ASK for a speed, but only the runner can
    /// tell it what the belt is doing.
    private func matchTargetChip(_ target: Double) -> some View {
        Button { session.setSpeed(target) } label: {
            HStack(spacing: 5) {
                Image(systemName: "arrow.right").font(.system(size: 10, weight: .bold))
                Text("SET \(Units.formatSpeed(mph: target))")
                    .font(.body(11, weight: .extraBold))
                    .tracking(1.2)
            }
            .foregroundStyle(Theme.warnText)
            .padding(.horizontal, 11).padding(.vertical, 7)
            .background(Theme.warnText.opacity(0.14), in: Capsule())
            .overlay(Capsule().stroke(Theme.warnText.opacity(0.45), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Set belt to \(Units.formatSpeed(mph: target)) \(Units.speedLabel())")
    }

    private var remainingInSeg: Int {
        guard let seg = segments[safe: idx] else { return 0 }
        return max(0, seg.dur - elapsedInSeg)
    }

    /// True once the runner passes the target on the open-ended last
    /// segment. The clock flips from counting down ("LEFT") to counting
    /// up ("OVER") so a hit target reads as bonus time, not a stuck 0:00.
    private var isOverTarget: Bool {
        guard let seg = segments[safe: idx] else { return false }
        return idx == segments.count - 1 && seg.dur > 0 && elapsedInSeg >= seg.dur
    }

    private var overInSeg: Int {
        guard let seg = segments[safe: idx] else { return 0 }
        return max(0, elapsedInSeg - seg.dur)
    }

    private var segProgressBar: some View {
        let seg = segments[safe: idx]
        let frac = seg.map { max(0, min(1, Double(elapsedInSeg) / Double($0.dur))) } ?? 0
        let fill: Color = isOverTarget ? Theme.green : Color.white
        return GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.2)).frame(height: 8)
                Capsule().fill(fill).frame(width: geo.size.width * frac, height: 8)
            }
        }
        .frame(height: 8)
    }

    // MARK: - Console (speed + incline steppers)

    private var console: some View {
        VStack(spacing: 11) {
            consoleTile(
                label: "SPEED",
                // 2026-07-07 · units audit — DISPLAY ONLY. The internal
                // `speedMph` state (and the ±0.1 stepper below) stays mph —
                // that's what the BeltTracker integrates each tick and what the
                // POST payload's actualSpeedMph carries. Only the number
                // shown and the unit label convert. Units.formatSpeed
                // no-ops back to the exact "%.1f" mph reading when the
                // preference is mi (default, byte-safe for every existing
                // runner).
                value: Units.formatSpeed(mph: speedMph),
                unit: Units.speedLabel(),
                valueFontSize: 74,
                // When HK streams a live HR sample, append it to the
                // sub line · "8:34 /mi · 162 bpm". Nil when no watch
                // is paired, sub stays pace-only. paceStr still computes
                // off speedMph (mph) — pace display converts separately.
                sub: hrSubLine(pace: paceDisplayStr(speedMph)),
                // 2026-08-21 · units audit round 2. The step and the bounds
                // now move in the unit the runner is READING. They stepped in
                // mph regardless of preference, so a km runner's tap moved the
                // display by 0.161 km/h and no sequence of taps reached a
                // round km/h number — on a belt whose own console steps in
                // 0.1 km/h. The accumulator is still mph; only the notch and
                // the ceiling are the runner's. No-ops to the exact previous
                // 0.1 mph / 0.5–12.0 behaviour for a mi runner.
                onMinus: { session.stepSpeed(notches: -1, unit: Units.preference.distance) },
                onPlus:  { session.stepSpeed(notches:  1, unit: Units.preference.distance) }
            )
            consoleTile(
                label: "INCLINE",
                value: String(format: "%.1f", inclinePct),
                unit: "%",
                valueFontSize: 54,
                sub: " ",
                onMinus: { session.stepIncline(-0.5) },
                onPlus:  { session.stepIncline(0.5) }
            )
        }
    }

    private func consoleTile(label: String, value: String, unit: String, valueFontSize: CGFloat, sub: String, onMinus: @escaping () -> Void, onPlus: @escaping () -> Void) -> some View {
        HStack(spacing: 12) {
            bigStepButton(symbol: "−", spoken: "Decrease \(label.lowercased())", action: onMinus)
            VStack(spacing: 5) {
                SpecLabel(text: label, size: 11, tracking: 2.5, color: Theme.txt.opacity(0.62))
                HStack(alignment: .lastTextBaseline, spacing: 4) {
                    // Shrink to fit: the tile is drawn for "8.0" and a belt at
                    // "12.0" is a glyph wider. Truncating the console's
                    // largest number is worse than a slightly smaller one.
                    Text(value).font(.display(valueFontSize, weight: .bold)).tracking(-3)
                        .lineLimit(1)
                        .minimumScaleFactor(0.65)
                        .foregroundStyle(Theme.txt)
                        .shadow(color: .black.opacity(0.32), radius: 22, y: 2)
                    Text(unit).font(.display(valueFontSize * 0.27, weight: .bold)).foregroundStyle(Theme.txt.opacity(0.85))
                }
                Text(sub)
                    .font(.body(10, weight: .bold))
                    .tracking(0.8)
                    .foregroundStyle(Theme.txt.opacity(0.72))
                    .frame(height: 12)
            }
            .frame(maxWidth: .infinity)
            bigStepButton(symbol: "+", spoken: "Increase \(label.lowercased())", action: onPlus)
        }
        .padding(14)
        .background(Color.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 26, style: .continuous).stroke(Color.white.opacity(0.22), lineWidth: 1))
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
    }

    /// PRESS AND HOLD, not tap-tap-tap. See `RepeatStepV5`: a notch is
    /// 0.2 mph, moving the belt 6.0 to 9.0 was fifteen separate taps, and a
    /// burst of taps registered as about one. A single deliberate tap is
    /// still exactly one notch.
    private func bigStepButton(symbol: String, spoken: String,
                               action: @escaping () -> Void) -> some View {
        RepeatStepV5(step: action, accessibilityLabel: spoken) {
            Text(symbol)
                .font(.display(32))
                .foregroundStyle(Theme.txt)
                .frame(width: 60, height: 60)
                .background(Color.white.opacity(0.18), in: Circle())
                .overlay(Circle().stroke(Color.white.opacity(0.3), lineWidth: 1))
        }
    }

    // MARK: - Bottom (next-up + ticks + controls)

    private var bottomBlock: some View {
        VStack(spacing: 11) {
            nextUpCard
            overallTicks
            controlRow
            // P1-21 · the run is persisted locally and will sync on its own.
            // Replaces the old failure path whose only escape was "Discard
            // and exit" — a 60-minute session gone because the gym had no
            // signal. The console hides the tab bar, so Done is the exit.
            if savedSyncing {
                Text("Run saved on this phone · syncs when you're back online.")
                    .font(.body(11, weight: .medium))
                    .foregroundStyle(Theme.txt.opacity(0.75))
                    .multilineTextAlignment(.center)
                Button { dismiss() } label: {
                    Text("Done")
                        .font(.body(13, weight: .extraBold))
                        .foregroundStyle(Theme.txt)
                        .underline()
                }
                .buttonStyle(.plain)
            } else if let err = postError {
                Text(err)
                    .font(.body(11, weight: .medium))
                    .foregroundStyle(Theme.over)
                    .multilineTextAlignment(.center)
            }
        }
    }

    private var nextUpCard: some View {
        let next = idx + 1 < segments.count ? segments[idx + 1] : nil
        return VStack(alignment: .leading, spacing: 5) {
            SpecLabel(text: "NEXT UP", size: 10, tracking: 2, color: Theme.txt.opacity(0.6))
            HStack(alignment: .bottom) {
                Text(next.map { fullName($0) } ?? "Finish")
                    .font(.body(18, weight: .extraBold))
                    .tracking(-0.3)
                Spacer()
                VStack(alignment: .trailing, spacing: 1) {
                    HStack(alignment: .lastTextBaseline, spacing: 2) {
                        // 2026-07-07 · units audit — display only; $0.mph
                        // (TreadSeg's stored target) stays mph internally.
                        Text(next.map { Units.formatSpeed(mph: $0.mph) } ?? "—")
                            .font(.display(32, weight: .bold)).tracking(-1)
                        Text(next != nil ? Units.speedLabel() : "")
                            .font(.body(13, weight: .bold))
                    }
                    Text(next.map { "\(String(format: "%.1f", $0.inc))% · \(formatClock($0.dur))" } ?? "complete")
                        .font(.body(11, weight: .bold))
                        .foregroundStyle(Theme.txt.opacity(0.78))
                }
            }
        }
        .padding(.horizontal, 18).padding(.vertical, 14)
        .background(Color(hex: 0x0A0408).opacity(0.42), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(Color.white.opacity(0.18), lineWidth: 1))
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private var overallTicks: some View {
        HStack(spacing: 4) {
            ForEach(0..<segments.count, id: \.self) { i in
                let done = i < idx
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.white.opacity(0.22)).frame(height: 4)
                        Capsule().fill(Color.white).frame(width: done ? geo.size.width : 0, height: 4)
                    }
                }
                .frame(height: 4)
                .frame(maxWidth: .infinity)
            }
        }
    }

    private var controlRow: some View {
        HStack(spacing: 9) {
            controlBtn(
                icon: playing ? "pause.fill" : "play.fill",
                label: playing ? "Pause" : (totalSec == 0 ? "Start" : "Resume"),
                style: .secondary
            ) {
                if !playing && startedAt == nil {
                    startedAt = .now
                    // ADOPT the session's id rather than minting a second one.
                    // The belt checkpoint is keyed by it, so a console id and
                    // a session id that differ would let a finished run fail
                    // to clear its own file — or clear someone else's.
                    let id = session.workoutId
                    workoutId = id
                    // Kick off the HR stream the first time the runner
                    // starts the session · idempotent on re-calls.
                    let anchor = startedAt ?? .now
                    Task { await hrStreamer.start(from: anchor) }
                    // Start measuring at the same instant the run starts, so
                    // the pedometer's window and the belt's window are the
                    // same window and the two numbers are comparable.
                    meter.start(from: anchor)
                    // Ask the watch to open a parallel indoor-running
                    // workout session so HK gets fast HR samples (5-15s
                    // cadence) instead of the passive every-5-min baseline.
                    // Best-effort · falls through when watch not reachable.
                    watchHRBridgeUp = WatchSync.shared.startTreadmillHRSession(sessionId: id)
                }
                // The recorder owns its own clock: starting it also starts
                // the timer, and pause/resume re-anchor inside the model so a
                // paused span is never credited as running.
                session.togglePause()
            }
            controlBtn(icon: "forward.fill", label: "Skip", style: .secondary) {
                withAnimation(.easeInOut(duration: 0.4)) { session.skip() }
                attachHrForClosedSegments()
            }
            controlBtn(icon: "stop.fill", label: posting ? "Saving" : (savedSyncing ? "Saved" : "End"), style: .primary) {
                session.pause()
                showEndConfirm = true
            }
            // savedSyncing also blocks a second End · re-running endAndPost
            // after the buffers flushed would overwrite the final phase's HR
            // with nil (the closePhase buffer is empty on a retry).
            .disabled(posting || savedSyncing)
        }
    }

    private enum CtrlStyle { case primary, secondary }

    private func controlBtn(icon: String, label: String, style: CtrlStyle, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: icon).font(.system(size: 13, weight: .bold))
                Text(label).font(.body(13, weight: .extraBold))
            }
            .foregroundStyle(style == .primary ? Color(hex: 0x1A0D12) : Theme.txt)
            .frame(maxWidth: .infinity).padding(.vertical, 13)
            .background(
                style == .primary
                    ? Color.white.opacity(0.92)
                    : Color.white.opacity(0.14),
                in: RoundedRectangle(cornerRadius: 16, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(style == .primary ? Color.white : Color.white.opacity(0.26), lineWidth: 1)
            )
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    // MARK: - State helpers

    private var segLabelText: String {
        guard let s = segments[safe: idx] else { return "" }
        return s.sub.isEmpty ? s.label.uppercased() : "\(s.label.uppercased()) \(s.sub)"
    }

    private func formatClock(_ s: Int) -> String {
        let m = s / 60, x = s % 60
        return "\(m < 10 ? "0" : "")\(m):\(x < 10 ? "0" : "")\(x)"
    }

    private func fullName(_ s: TreadSeg) -> String {
        s.sub.isEmpty ? s.label : "\(s.label) \(s.sub)"
    }

    private func paceStr(_ mph: Double) -> String {
        let pmin = 60.0 / mph
        var m = Int(pmin)
        var s = Int(round((pmin - Double(m)) * 60))
        if s == 60 { m += 1; s = 0 }
        return "\(m):\(s < 10 ? "0" : "")\(s)"
    }

    /// 2026-07-07 · units audit — "8:34/mi" or "5:19/km" display string for
    /// the speed tile's sub-line. `paceStr` above is UNCHANGED (still used
    /// nowhere else, kept intact rather than deleted in case another call
    /// site is added later) — this wraps the same 60/mph→min-per-mile math
    /// through Units.formatPace so the unit suffix and conversion are both
    /// handled by the shared formatter. No-ops to paceStr's exact output +
    /// "/mi" when the preference is mi.
    private func paceDisplayStr(_ mph: Double) -> String {
        guard mph > 0 else { return "—:—/\(Units.distanceLabel())" }
        let secPerMile = (60.0 / mph) * 60.0
        return Units.formatPace(secPerMile: secPerMile)
    }

    /// Speed-tile sub line · pace plus live HR if a watch is streaming.
    /// Nil HR keeps the line clean for non-watch users.
    private func hrSubLine(pace: String) -> String {
        if let bpm = hrStreamer.currentBpm { return "\(pace) · \(bpm) bpm" }
        return pace
    }

    private func meshFor(_ kind: TreadSegKind) -> FaffMesh {
        switch kind {
        case .warm: return FaffMesh(c1: 0x62E3D4, c2: 0x3AB0CF, c3: 0x1C6F9A, c4: 0x0F8F93, c5: 0x0F6A84, base: 0x07323F)
        case .work: return FaffMesh(c1: 0xFFA566, c2: 0xFC4D64, c3: 0xEC2F54, c4: 0xC01D48, c5: 0xA8163F, base: 0x4E0A22)
        case .rec:  return FaffMesh(c1: 0x8EF0B0, c2: 0x34C194, c3: 0x1F8A68, c4: 0x128A64, c5: 0x137259, base: 0x06382E)
        case .cool: return FaffMesh(c1: 0x7FE0D0, c2: 0x34B0A0, c3: 0x1F8A8A, c4: 0x127A72, c5: 0x0F6A64, base: 0x06322E)
        }
    }

    // MARK: - End + POST

    private func endAndPost(status: String) {
        // Close the open segment inside the recorder, then take its heart
        // rate. Order matters: `finish()` bumps `closedCount`, and
        // `attachHrForClosedSegments` is what turns that into an HR window.
        session.finish()
        attachHrForClosedSegments()
        // Stop streaming new HR samples · session rollup happens inside
        // buildPayload via closeSession().
        hrStreamer.stop()
        meter.stop()
        // Tell the watch to end its parallel HR workout session so the
        // watch returns to passive HR sensing. Idempotent · safe even
        // if the watch never received the start.
        if let id = workoutId {
            WatchSync.shared.stopTreadmillHRSession(sessionId: id)
        }
        posting = true
        postError = nil
        let payload = buildPayload(status: status)
        // P1-21 · durable-first save. Serialize once, persist to the same
        // UserDefaults-backed queue the watch relay uses (same wire shape,
        // same endpoint, same idempotent workoutId), THEN attempt the POST.
        // A failed POST is no longer data loss — the run stays queued and
        // WatchSync drains it on next launch/foreground/reachability.
        guard let data = try? JSONSerialization.data(withJSONObject: payload) else {
            // Can't happen · payload is built from JSON-safe types. Fall back
            // to the direct single-shot POST rather than dropping the run.
            Task {
                let ok = await postTreadmillCompletion(payload: payload)
                await MainActor.run {
                    posting = false
                    if ok { dismiss() }
                    else { postError = "Couldn't save · check connection and try End again." }
                }
            }
            return
        }
        Task {
            let synced = await WatchSync.shared.saveCompletionDurably(data)
            await MainActor.run {
                posting = false
                if synced {
                    dismiss()
                } else {
                    // Saved on disk, not yet on the server. Tell the runner
                    // the run is safe and let them leave · syncs itself.
                    savedSyncing = true
                }
            }
        }
    }

    private func buildPayload(status: String) -> [String: Any] {
        let iso = ISO8601DateFormatter()
        let started = startedAt ?? Date(timeIntervalSinceNow: -Double(totalSec))
        let phasePayloads: [[String: Any]] = segments.enumerated().map { i, seg in
            let act = session.actuals[i]
            let hr = hrBySegment[i]
            var phase: [String: Any] = [
                // `index` was never sent. The endpoint declares it and the v5
                // console keys its own actuals by it; without it a consumer
                // can only infer phase identity from array position.
                "index": i,
                "label": seg.label,
                "type": treadKindToWatchType(seg.kind),
                "completed": act?.completed ?? false,
                // A phase the runner never reached reports its NOMINAL target,
                // and carries no duration or distance at all — the absence is
                // what says "this did not happen".
                "actualSpeedMph": act.map { $0.avgSpeedMph } ?? seg.mph,
                "actualInclinePct": act.map { $0.avgInclinePct } ?? seg.inc,
            ]
            if let act, act.durationSec > 0 {
                let b = act
                phase["actualDistanceMi"] = (b.distanceMi * 100).rounded() / 100
                phase["actualDurationSec"] = b.durationSec
                // Pace from THIS phase's own duration and distance, not from
                // a speed reading. With a time-weighted mean speed these are
                // the same number by construction — computing it the defining
                // way keeps it that way if either side ever changes.
                if let pace = b.paceSPerMi { phase["actualPaceSPerMi"] = pace }
                // 2026-08-21 · the belt's own speed timeline, ~5 s cadence
                // plus a sample at every speed change. This is what the
                // server's deriveSplitsFromPaceSamples walks to build real
                // per-mile splits: every treadmill run before this one landed
                // with `splits: []` because the treadmill payload carried no
                // paceSamples at all, so run detail had no splits and the HR
                // zone bar had nothing to bucket.
                //
                // These samples are REAL, not modelled: they are the speed the
                // runner set, at the second they set it, which is the only
                // measurement a belt gives us and is exactly what the run
                // total is already integrated from. Deriving splits
                // server-side from one (speed, duration) pair instead would
                // have invented a flat pace for a run whose speed moved — a
                // modelled number wearing a measured number's clothes.
                if !b.samples.isEmpty {
                    phase["paceSamples"] = b.paceSamplesPayload
                    let hrs = b.hrSamplesPayload
                    if !hrs.isEmpty { phase["hrSamples"] = hrs }
                }
                // What this phase could not witness. Absent when zero.
                if b.unmeasuredSec > 0 {
                    phase["unmeasuredSec"] = b.unmeasuredSec
                    phase["unmeasuredDistanceMi"] = (b.unmeasuredMi * 100).rounded() / 100
                }
                // Per-phase HR from live HK stream · null when no watch.
                if let avgHr = hr?.avg { phase["avgHr"] = avgHr }
                if let maxHr = hr?.max { phase["maxHr"] = maxHr }
            }
            return phase
        }
        // Session-level HR rollup · separate from per-phase buffers so
        // it captures samples that may have landed between phase
        // boundaries. Null when no watch.
        let sessionHr = hrStreamer.closeSession()
        var payload: [String: Any] = [
            // Reuse the stable workoutId stamped at first play · keeps
            // the WatchConnectivity sessionId, HR streamer anchor, and
            // backend idempotency key all in sync.
            "workoutId": workoutId ?? "trd_\(UUID().uuidString)",
            "startedAt": iso.string(from: started),
            "completedAt": iso.string(from: .now),
            "status": status,
            "totalDistanceMi": (session.belt.distanceMi * 100).rounded() / 100,
            "totalDurationSec": totalSec,
            // Incline-derived elevation gain · so a treadmill run with incline
            // shows real climb instead of flat (0 ft). Source flags it as
            // incline-derived, not barometric.
            "elevGainFt": session.belt.elevGainFt.rounded(),
            "elevGainSource": "treadmill_incline",
            // kcal stays null on iPhone-treadmill v1 · backend
            // resolveCalories tier 3 estimator picks up.
            "source": "treadmill",
            "indoor": true,
            "phases": phasePayloads,
        ]
        if let avgHr = sessionHr.avg { payload["avgHr"] = avgHr }
        if let maxHr = sessionHr.max { payload["maxHr"] = maxHr }
        // 2026-08-21 · what this run could not witness, carried on the wire
        // rather than left for a reader to infer. Keys are ABSENT on a clean
        // run so the merge upsert can never clobber a sibling payload, and so
        // an untouched run's shape is byte-identical to before.
        if session.belt.unmeasuredSec >= 1 {
            payload["unmeasuredSec"] = Int(session.belt.unmeasuredSec.rounded())
            payload["unmeasuredDistanceMi"] = (session.belt.unmeasuredMi * 100).rounded() / 100
        }
        if session.belt.droppedSec >= 1 {
            // A gap longer than the credit ceiling. Counted to nothing, and
            // said out loud so the run does not quietly look shorter than the
            // wall clock for no stated reason.
            payload["droppedGapSec"] = Int(session.belt.droppedSec.rounded())
        }
        if session.belt.pausedSec >= 1 { payload["pausedSec"] = Int(session.belt.pausedSec.rounded()) }

        // ── Where this run's distance came from ──────────────────────────
        // `totalDistanceMi` is the belt integral, because that is the number
        // the runner watched for the whole session and swapping it for
        // another reading without asking would be its own defect. What ships
        // alongside it is the provenance, so no reader has to guess:
        //
        //   belt_stated       · integrated from a speed the runner typed.
        //                       Nothing measured it.
        //   belt_corroborated · a carried phone's pedometer independently
        //                       landed within tolerance of it.
        //   belt_contested    · a carried phone measured a materially
        //                       different distance. Both numbers ship; this
        //                       endpoint does not get to pick, and neither
        //                       does this screen.
        payload["distanceSource"] = {
            guard let m = measuredMi else { return "belt_stated" }
            return IndoorDistanceMeter.materiallyDisagree(beltMi: session.belt.distanceMi, measuredMi: m)
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
        if let m = meter.rawDistanceMi {
            payload["pedometerDistanceMi"] = (m * 100).rounded() / 100
        }
        if let st = meter.rawSteps { payload["pedometerSteps"] = st }
        if !IndoorDistanceMeter.isSupported { payload["pedometerAvailable"] = false }

        // ── The run's own clock audit ────────────────────────────────────
        // Every second between the first play and now is running time, paused
        // time, or time the tracker declined to credit. If they do not add up
        // to the wall clock, ticks were dropped — which is precisely the
        // failure that used to need a row read out of the database to spot.
        // The run proves it every time now.
        payload["clockDriftSec"] = (session.belt.clockDriftSec(startedAt: started, completedAt: .now) * 10).rounded() / 10
        return payload
    }

    private func treadKindToWatchType(_ k: TreadSegKind) -> String {
        switch k {
        case .warm: return "warmup"
        case .work: return "work"
        case .rec:  return "recovery"
        case .cool: return "cooldown"
        }
    }

    private func postTreadmillCompletion(payload: [String: Any]) async -> Bool {
        do {
            var req = URLRequest(url: API.baseURL.appendingPathComponent("api/watch/workouts/complete"))
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            // Fail fast · the default 60s left the End button stuck on
            // "Saving" for a full minute when the network stalled.
            req.timeoutInterval = 20
            req.httpBody = try JSONSerialization.data(withJSONObject: payload)
            let (_, http) = try await API.authedSend(req)
            return (200..<300).contains(http.statusCode)
        } catch {
            print("[treadmill] POST failed: \(error)")
            return false
        }
    }
}

private enum TreadSegKind { case warm, work, rec, cool }

private struct TreadSeg {
    let label: String
    let sub: String
    let kind: TreadSegKind
    let mph: Double
    let inc: Double
    let dur: Int
}

private extension Array {
    subscript(safe i: Int) -> Element? {
        indices.contains(i) ? self[i] : nil
    }
}
