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

    @State private var elapsedSec: Int = 0
    @State private var distanceMi: Double = 0
    @State private var speedMph: Double
    @State private var inclinePct: Double
    @State private var isPaused: Bool = false
    @State private var lastTickAt: Date = .now
    private let startedAt: Date = .now
    /// Stable id, stamped once. Same role as `TreadmillView`'s `workoutId` —
    /// backend idempotency key, and reused as the payload's `workoutId` so a
    /// retried POST from the durable queue overwrites rather than duplicates.
    private let workoutId: String = "trd_\(UUID().uuidString)"
    /// Cumulative elevation gain in ft, accumulated each tick from the SET
    /// incline at that instant (rise = distance × grade) — mirrors legacy's
    /// `elev` accumulator so a run with a changing incline isn't reported at
    /// its final grade alone.
    @State private var elevFt: Double = 0
    /// Per-phase actuals, keyed by `WatchPhase.index` — this view's analogue
    /// of legacy's `actualsBySegment`. A phase absent from this dict was
    /// never reached.
    @State private var phaseActuals: [Int: PhaseActual] = [:]
    /// The phase index the tracker currently believes is active, so a
    /// boundary crossing (detected each tick) can close out the previous
    /// phase exactly once.
    @State private var trackedPhaseIndex: Int?

    private struct PhaseActual {
        var speedSumMph: Double = 0
        var inclineSumPct: Double = 0
        var sampleCount: Int = 0
        var durationSec: Int = 0
        var completed: Bool = false
        var avgHr: Int?
        var maxHr: Int?

        var avgSpeedMph: Double { sampleCount > 0 ? speedSumMph / Double(sampleCount) : 0 }
        var avgInclinePct: Double { sampleCount > 0 ? inclineSumPct / Double(sampleCount) : 0 }
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
        .background(
            TimelineView(.periodic(from: .now, by: 1.0)) { ctx in
                Color.clear.onChange(of: ctx.date) { _, now in tick(at: now) }
            }
        )
        .onChange(of: isPaused) { _, paused in
            UIApplication.shared.isIdleTimerDisabled = !paused
        }
        .onAppear {
            UIApplication.shared.isIdleTimerDisabled = true
            Task { await hr.start(from: startedAt) }
        }
        .onDisappear {
            UIApplication.shared.isIdleTimerDisabled = false
            hr.stop()
        }
    }

    // MARK: - Tick
    //
    // No GPS, no separate tracker — distance accumulates from speed × time,
    // exactly the arithmetic the prototype's own sample data performs
    // client-side (`TREADMILL_RUN`'s pace is derived from speed, not read
    // from a sensor).

    private func tick(at now: Date) {
        guard !isPaused else { lastTickAt = now; return }
        let delta = max(0, Int(now.timeIntervalSince(lastTickAt).rounded()))
        lastTickAt = now
        guard delta > 0 else { return }
        elapsedSec += delta
        let distDeltaMi = Double(delta) / 3600.0 * speedMph
        distanceMi += distDeltaMi
        // Incline-derived climb · rise = run × grade, same arithmetic as
        // legacy's `elev` accumulator.
        elevFt += distDeltaMi * 5280.0 * (inclinePct / 100.0)
        advancePhaseTracking(deltaSec: delta)
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

    private func advancePhaseTracking(deltaSec: Int) {
        let idx = currentPhaseIndex(at: elapsedSec)
        if idx != trackedPhaseIndex {
            // Crossed into a new phase · the one we just left ran its full
            // asked duration, same as legacy's auto-advance (`completed: true`).
            if let prev = trackedPhaseIndex { closeOutPhase(prev, completed: true) }
            trackedPhaseIndex = idx
        }
        var actual = phaseActuals[idx] ?? PhaseActual()
        actual.speedSumMph += speedMph
        actual.inclineSumPct += inclinePct
        actual.sampleCount += 1
        actual.durationSec += deltaSec
        phaseActuals[idx] = actual
    }

    /// Closes the given phase's HR window (`TreadmillHRStreamer.closePhase`)
    /// and stamps its `completed` flag. Speed/incline/duration are already
    /// accumulated by `advancePhaseTracking` — this only adds what only a
    /// boundary crossing (or End) can know.
    private func closeOutPhase(_ index: Int, completed: Bool) {
        let hrResult = hr.closePhase()
        var actual = phaseActuals[index] ?? PhaseActual()
        actual.completed = completed
        actual.avgHr = hrResult.avg
        actual.maxHr = hrResult.max
        phaseActuals[index] = actual
    }

    /// Closes out whatever phase is still open when the runner taps End.
    /// Mirrors legacy's `recordActual` call inside `endAndPost`: the phase in
    /// progress is "completed" only if its accumulated duration reached the
    /// asked duration — ending early is an honest partial, not a pass.
    private func finalizeActivePhaseForEnd(status: String) {
        guard let idx = trackedPhaseIndex else { return }
        let askedSec = effectivePhases.first(where: { $0.index == idx })?.durationSec ?? 0
        let actualSec = phaseActuals[idx]?.durationSec ?? 0
        closeOutPhase(idx, completed: status == "completed" && actualSec >= askedSec)
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
            if let act, act.sampleCount > 0 {
                let actualDistanceMi = Double(act.durationSec) / 3600.0 * act.avgSpeedMph
                p["actualDistanceMi"] = (actualDistanceMi * 100).rounded() / 100
                p["actualDurationSec"] = act.durationSec
                p["actualPaceSPerMi"] = Int(round(3600.0 / max(0.5, act.avgSpeedMph)))
                if let avgHr = act.avgHr { p["avgHr"] = avgHr }
                if let maxHr = act.maxHr { p["maxHr"] = maxHr }
            }
            return p
        }
        // Session-level HR rollup · separate from the per-phase buffers so it
        // captures samples landing right at a phase boundary. Nil when no
        // watch is paired.
        let sessionHr = hr.closeSession()
        let roundedDistanceMi = (distanceMi * 100).rounded() / 100
        var payload: [String: Any] = [
            "workoutId": workoutId,
            "startedAt": iso.string(from: startedAt),
            "completedAt": iso.string(from: .now),
            "status": status,
            "totalDistanceMi": roundedDistanceMi,
            "totalDurationSec": elapsedSec,
            "elevGainFt": elevFt.rounded(),
            "elevGainSource": "treadmill_incline",
            "source": "treadmill",
            "indoor": true,
            "phases": phasePayloads,
        ]
        if let avgHr = sessionHr.avg { payload["avgHr"] = avgHr }
        if let maxHr = sessionHr.max { payload["maxHr"] = maxHr }
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
            return "Next \u{00b7} \(String(format: "%.1f", mph)) mph in \(walk.remainingShort)"
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
                    adjustSpeed(-0.2)
                }
                Text(FaffFmt.oneDecimal(speedMph) ?? "0.0")
                    .font(.faffText(TypeScaleV5.valueMax, weight: .semibold))
                    .foregroundStyle(V5.textPrimary)
                roundControl(symbol: "plus", diameter: 72, glyphSize: 30,
                            fill: V5.materialAction, ink: V5.actionPrimaryText) {
                    adjustSpeed(0.2)
                }
            }
            Text("mph")
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

    private func adjustSpeed(_ delta: Double) {
        speedMph = (min(max(speedMph + delta, 3.0), 14.0) * 10).rounded() / 10
    }

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
                statColumn(label: "DIST", value: FaffFmt.miles(distanceMi) ?? "0")
                statColumn(label: "PACE", value: currentPaceText)
                if let bpm = hr.currentBpm {
                    statColumn(label: "HEART", value: FaffFmt.bpm(Double(bpm)) ?? "\u{2014}")
                }
            }
            .padding(.vertical, V5.S.s16)
            .padding(.horizontal, V5.S.s12)
            .background(V5.materialTile, in: RoundedRectangle(cornerRadius: 24, style: .continuous))

            if hr.currentBpm == nil {
                Text("No heart rate source \u{00b7} running on speed and incline alone.")
                    .font(.faffText(TypeScaleV5.label13))
                    .foregroundStyle(V5.textQuiet)
                    .padding(.horizontal, V5.S.s4)
            }
        }
    }

    private var currentPaceText: String {
        guard speedMph > 0 else { return "\u{2014}" }
        return FaffFmt.pace(secPerMi: 3600.0 / speedMph) ?? "\u{2014}"
    }

    private func statColumn(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: V5.S.s6) {
            Text(label)
                .font(.faffText(14))
                .tracking(14 * 0.04)
                .foregroundStyle(V5.textQuiet)
            Text(value)
                .font(.faffText(30, weight: .semibold))
                .foregroundStyle(V5.textPrimary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Buttons

    private var buttons: some View {
        HStack(spacing: V5.S.s10) {
            FaffButton(isPaused ? "Resume" : "Pause", variant: .secondary, size: .lg) {
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
