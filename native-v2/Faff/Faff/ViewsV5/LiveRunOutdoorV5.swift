//
//  LiveRunOutdoorV5.swift
//  faff.run iPhone · v5 screen 12a — Live run, outdoor.
//
//  Glanceable while moving, phone in hand or armband. No tab bar — this is
//  immersive; the console below is the only thing tappable. Large elapsed
//  time + distance row, two large tiles (Pace with its target-band scale,
//  Heart rate with its ceiling scale), one current-interval line, Pause/End
//  at the bottom.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY THIS SCREEN OWNS `PhoneRunTracker` DIRECTLY
//
//  Every other v5 screen "takes its decoded model as a let and renders it…
//  does NOT fetch" (AGENT-BRIEF). A live run breaks that shape on purpose:
//  there is no payload to decode, because `PhoneRunTracker` "has no internal
//  timer — the view ticks it" (task brief, echoing PhoneRunView's own file
//  header). So this screen is the one place in v5 that observes a live
//  object instead of a snapshot, and reproduces PhoneRunView's own
//  TimelineView-tick idiom to drive it. `TreadmillHRStreamer` is the same
//  shape for the HR tile — a live HealthKit feed, not a payload field — and
//  is reused as-is rather than rebuilt (it is not treadmill-specific
//  mechanically; it just reads whatever HR samples land in HealthKit while
//  the session runs, which a watch worn outdoors writes exactly the same
//  way).
//
//  Everything that ISN'T live — the session's target pace band, its HR
//  ceiling, the phase list to walk for the current-interval line — comes
//  from `LiveRunPlanV5`, decoded once by the caller from today's
//  `WatchWorkout` (the same payload `PhoneRunView` already fetches for
//  context) and handed down as a `let`, per the AGENT-BRIEF shape.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE TWO LIMITS THE DESIGN DOES NOT ACCOUNT FOR
//
//  1 · Phone run recording is foreground-only (`PhoneRunTracker`:
//      `allowsBackgroundLocationUpdates = false`). This screen keeps the
//      idle timer disabled for the run's duration and restores it on exit —
//      mirrors `PhoneRunView`'s own `.onChange(of: tracker.state)` /
//      `.onDisappear` pair exactly.
//  2 · A GPS drop is `tracker.lastFixAgeIsStale`. That is RULE THREE
//      territory: "we could not read this," not a zero and not a silent
//      undercounted number. Rendered as `ErrorNote`, not folded into the
//      pace tile.
//
//  A third limit the design doesn't name, but the machinery forces: a
//  no-watch outdoor runner (the exact runner `PhoneRunTracker` exists for —
//  see its own file header) has no HR source either. The prototype's sample
//  data always carries a heart-rate reading, so 12a's mock never shows this.
//  Applying the same honesty the task requires of 12b's HEART tile here too
//  — see `heartTile` below — is a deliberate extension past the reference,
//  called out in the delivery report.
//

import SwiftUI
import UIKit

// MARK: - Plan context (decoded once, not live)

/// The target context a live console reads from today's planned workout —
/// pace bands, an HR ceiling, and the phase list to walk for the
/// current-interval line. Decoded once from `WatchWorkout` and handed down
/// as a `let`; a live console never re-fetches it mid-run.
struct LiveRunPlanV5 {
    /// The display-face graphic at the top of the screen — "Threshold".
    /// Pre-rendered by the caller from the workout's own label, the same way
    /// `V5Panel.type` arrives already-rendered from the Today contract —
    /// this screen never derives a session-type WORD itself.
    let sessionType: String
    /// Today's planned total, for "of 6 mi". Nil on an open/unstructured
    /// run (no plan, rest day, fetch failure) — `PhoneRunTracker`'s own
    /// "Just run" shape.
    let totalMi: Double?
    let phases: [WatchPhase]
    /// HR ceiling for the WHOLE session (easy / Z2 / heat-flagged sessions
    /// carry one at the workout level). A quality session's ceiling more
    /// often comes from the CURRENT phase's own `hrTargetBpm` instead — see
    /// `heartCeilingBpm(walk:)` below, which prefers the phase.
    let workoutHrCeilingBpm: Int?

    init(workout: WatchWorkout, sessionType: String) {
        self.sessionType = sessionType
        self.totalMi = workout.distanceMi
        self.phases = workout.phases
        self.workoutHrCeilingBpm = workout.hrCeilingBpm
    }

    init(sessionType: String, totalMi: Double?, phases: [WatchPhase], workoutHrCeilingBpm: Int?) {
        self.sessionType = sessionType
        self.totalMi = totalMi
        self.phases = phases
        self.workoutHrCeilingBpm = workoutHrCeilingBpm
    }
}

// MARK: - Phase walking

/// Where elapsed time places the runner in the phase list, and what that
/// phase asks for. Walked from cumulative `durationSec` — the wire
/// contract's own words are "a time ESTIMATE" even for a distance rep (see
/// `WatchPhase.distanceMi`'s doc comment) — because a live console has no
/// other clock to walk the plan by. Once inside a distance rep, the
/// remaining figure it reports is a distance, from that phase's own
/// `distanceMi`, not a countdown.
struct LiveRunPhaseWalk {
    let phase: WatchPhase
    let isWork: Bool
    /// 1-based position among ONLY the `.work` phases — "Interval 2 of 4"
    /// counts intervals, not warm-ups, recoveries, or cool-downs.
    let workIndex: Int
    let workCount: Int
    let elapsedInPhaseSec: Int
    let remainingInPhaseSec: Int
    /// Set only on a distance rep (`repUnit == .distance`) with a known
    /// `distanceMi` — the design's "0.6 mi to go" reads a distance whenever
    /// the phase itself is distance-anchored.
    let remainingMi: Double?
    let nextPhase: WatchPhase?

    /// The phase whose cumulative window contains `elapsedSec`, or the last
    /// phase once the plan's own estimate has been exceeded (the runner ran
    /// long — better than reporting no phase at all).
    static func walk(phases: [WatchPhase], elapsedSec: Int) -> LiveRunPhaseWalk? {
        guard !phases.isEmpty else { return nil }
        var cursor = 0
        for (i, phase) in phases.enumerated() {
            let dur = max(phase.durationSec, 1)
            let end = cursor + dur
            let isLast = i == phases.count - 1
            if elapsedSec < end || isLast {
                let elapsedInPhase = min(max(elapsedSec - cursor, 0), dur)
                let workPhases = phases.filter { $0.type == .work }
                let workIdx = phase.type == .work
                    ? (workPhases.firstIndex(where: { $0.index == phase.index }).map { $0 + 1 } ?? 0)
                    : 0
                let remainingSec = max(dur - elapsedInPhase, 0)
                var remainingMi: Double?
                if phase.repUnit == .distance, let total = phase.distanceMi, dur > 0 {
                    let fraction = Double(elapsedInPhase) / Double(dur)
                    remainingMi = max(total * (1 - fraction), 0)
                }
                let next = i + 1 < phases.count ? phases[i + 1] : nil
                return LiveRunPhaseWalk(phase: phase, isWork: phase.type == .work,
                                        workIndex: workIdx, workCount: workPhases.count,
                                        elapsedInPhaseSec: elapsedInPhase,
                                        remainingInPhaseSec: remainingSec,
                                        remainingMi: remainingMi, nextPhase: next)
            }
            cursor = end
        }
        return nil
    }

    /// "0.6 mi" or "1:20" — no trailing words, so a caller can build either
    /// "… to go" (12a) or "Next · 8.6 mph in …" (12b) around it.
    var remainingShort: String {
        if let mi = remainingMi {
            return "\(FaffFmt.miles(mi) ?? "0") mi"
        }
        let m = remainingInPhaseSec / 60, s = remainingInPhaseSec % 60
        return "\(m):" + String(format: "%02d", s)
    }

    /// "Interval 2 of 4 · 0.6 mi to go" for a repeated work phase, or the
    /// phase's own label for anything else — a warm-up is a warm-up, not
    /// "Interval 1 of 1".
    var lineText: String {
        let head = (isWork && workCount > 1) ? "Interval \(workIndex) of \(workCount)" : phase.label
        return "\(head) · \(remainingShort) to go"
    }
}

// MARK: - Live run, outdoor

struct LiveRunOutdoorV5: View {
    /// Owned by the caller (same lifetime as the run itself); this screen
    /// only observes and ticks it — see file header.
    @ObservedObject var tracker: PhoneRunTracker
    @ObservedObject var hr: TreadmillHRStreamer
    let plan: LiveRunPlanV5?
    /// Fired on every Pause/Resume tap. Pause never leaves the screen — the
    /// caller (which holds the same `tracker`) decides whether to call
    /// `tracker.pause()` or `tracker.start()`, exactly as PhoneRunView's
    /// existing control button already does off the same state read.
    let onPause: () -> Void
    /// Fired on End. Leaves the screen — the caller owns any confirm step
    /// and the eventual `tracker.finish()` + save, per AGENT-BRIEF ("does
    /// not own navigation").
    let onEnd: () -> Void

    private var walk: LiveRunPhaseWalk? {
        guard let plan else { return nil }
        return LiveRunPhaseWalk.walk(phases: plan.phases, elapsedSec: tracker.elapsedSec)
    }

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: V5.S.s16) {
                topRow
                distTile
                paceTile
                heartTile
                if let walk {
                    Text(walk.lineText)
                        .font(.faffText(20, weight: .medium))
                        .foregroundStyle(V5.textPrimary)
                        .lineSpacing(2)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                        .padding(.horizontal, V5.S.s4)
                }
                if tracker.lastFixAgeIsStale {
                    // RULE THREE: a GPS drop is "we could not read this," not
                    // a silently undercounted distance folded into the tile.
                    ErrorNote(text: "GPS signal dropped. Distance may undercount until it returns.")
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
        .background(V5.surfacePage.ignoresSafeArea())
        // No internal timer on the tracker — this screen ticks it, exactly
        // the idiom PhoneRunView already uses.
        .background(
            TimelineView(.periodic(from: .now, by: 1.0)) { ctx in
                Color.clear.onChange(of: ctx.date) { _, now in tracker.tick(at: now) }
            }
        )
        // LIMIT 1 · foreground-only GPS means a locked screen stops the run.
        // Keep the screen awake for the run's duration only, restore on
        // exit — mirrors PhoneRunView's own onChange/onDisappear pair.
        .onChange(of: tracker.state) { _, state in
            UIApplication.shared.isIdleTimerDisabled = (state == .running)
            if state == .running, hr.currentBpm == nil {
                Task { await hr.start(from: tracker.startedAt ?? .now) }
            }
        }
        .onDisappear {
            UIApplication.shared.isIdleTimerDisabled = false
            hr.stop()
        }
    }

    // MARK: - Top row

    private var topRow: some View {
        HStack(alignment: .lastTextBaseline) {
            Text(FaffFmt.clock(sec: Double(tracker.elapsedSec)) ?? "0:00")
                .font(.faffText(34, weight: .semibold))
                .foregroundStyle(V5.textPrimary)
            Spacer(minLength: V5.S.s12)
            Text(plan?.sessionType ?? "Run")
                .font(.faffText(22, weight: .semibold))
                .foregroundStyle(V5.signal)
        }
    }

    // MARK: - Distance tile

    private var distTile: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: V5.S.s6) {
                Text("DIST")
                    .font(.faffText(14))
                    .tracking(14 * 0.04)
                    .foregroundStyle(V5.textQuiet)
                Text(FaffFmt.miles(tracker.distanceMi) ?? "0")
                    .font(.faffText(32, weight: .semibold))
                    .foregroundStyle(V5.textPrimary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            VStack(alignment: .leading, spacing: V5.S.s6) {
                Text("OF")
                    .font(.faffText(14))
                    .tracking(14 * 0.04)
                    .foregroundStyle(V5.textQuiet)
                Text(plan?.totalMi.flatMap { FaffFmt.milesUnit($0) } ?? "\u{2014}")
                    .font(.faffText(32, weight: .semibold))
                    .foregroundStyle(V5.textPrimary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, V5.S.s16)
        .padding(.horizontal, V5.S.s12)
        // The prototype's own literal for this tile — see 12a.html — sits
        // between the kit's r22/r26 tokens, so it is taken verbatim rather
        // than rounded to the nearest named radius.
        .background(V5.materialTile, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    // MARK: - Pace tile

    private var paceTile: some View {
        let bandSecs = LiveRunOutdoorV5.paceBand(phase: walk?.phase)
        let scale = LiveRunOutdoorV5.paceScaleBounds(band: bandSecs, currentSecPerMi: tracker.currentPaceSecPerMi)
        return VStack(spacing: V5.S.s10) {
            Text("PACE")
                .font(.faffText(18))
                .tracking(18 * 0.06)
                .foregroundStyle(V5.textSecondary)
            FaffValueText(.measured(FaffFmt.pace(secPerMi: tracker.currentPaceSecPerMi.map { Double($0) })),
                         font: .faffText(72, weight: .semibold))
            RangeScale(mode: .band, min: scale.min, max: scale.max,
                      band: bandSecs.map { (low: Double($0.low), high: Double($0.high)) },
                      value: tracker.currentPaceSecPerMi.map { Double($0) },
                      endpoints: (FaffFmt.pace(secPerMi: scale.min) ?? "\u{2014}",
                                  FaffFmt.pace(secPerMi: scale.max) ?? "\u{2014}"),
                      hue: .pace, size: .s)
        }
        .frame(maxWidth: .infinity)
        .frame(maxHeight: .infinity)
        .padding(V5.S.s16)
        .background(V5.materialTile, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
    }

    // MARK: - Heart tile
    //
    // "It needs a no-heart layout, not a zero and not a dash where a number
    // should be" — the task's own words for 12b's stat row, applied here
    // too: this exact runner (no watch, recording from the phone) is the
    // one most likely to have no HR source at all on THIS screen.

    private var heartTile: some View {
        Group {
            if let bpm = hr.currentBpm {
                let ceiling = LiveRunOutdoorV5.heartCeilingBpm(walk: walk, plan: plan)
                let hrMax = Double(ceiling ?? max(bpm + 20, 170)) + 20
                VStack(spacing: V5.S.s10) {
                    Text("HEART RATE")
                        .font(.faffText(18))
                        .tracking(18 * 0.06)
                        .foregroundStyle(V5.textSecondary)
                    FaffValueText(.measured(FaffFmt.bpm(Double(bpm))), font: .faffText(72, weight: .semibold))
                    RangeScale(mode: .ceiling, min: 100, max: hrMax,
                              band: ceiling.map { (low: 0.0, high: Double($0)) },
                              value: Double(bpm),
                              endpoints: ("100", ceiling.map { String($0) } ?? FaffFmt.bpm(hrMax) ?? "\u{2014}"),
                              hue: .heart, size: .s)
                }
                .frame(maxWidth: .infinity)
                .frame(maxHeight: .infinity)
                .padding(V5.S.s16)
                .background(V5.materialTile, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
            } else {
                // A designed absence, not a fault and not a zero — see file
                // header. Same tile footprint as the live state, so nothing
                // reflows if a watch reconnects mid-run.
                Silence(reason: "No heart rate source · running from the phone with no watch paired.")
                    .frame(maxWidth: .infinity)
                    .frame(maxHeight: .infinity)
            }
        }
    }

    // MARK: - Buttons

    private var buttons: some View {
        HStack(spacing: V5.S.s10) {
            FaffButton(tracker.state == .paused ? "Resume" : "Pause",
                      variant: .secondary, size: .lg, action: onPause)
            FaffButton("End", variant: .destructive, size: .lg, action: onEnd)
        }
    }

    // MARK: - Target-band math
    //
    // Neither figure below is a doctrine constant — they are display padding
    // so the runner's own marker has room to move on the track before
    // hitting an edge. Slower drift gets more headroom than faster, because
    // that is the direction fatigue moves a live pace.

    static func paceBand(phase: WatchPhase?) -> (low: Int, high: Int)? {
        guard let phase, let target = phase.targetPaceSPerMi else { return nil }
        let tol = phase.tolerancePaceSPerMi ?? 10
        return (target - tol, target + tol)
    }

    static func paceScaleBounds(band: (low: Int, high: Int)?, currentSecPerMi: Int?) -> (min: Double, max: Double) {
        if let band {
            return (Double(band.low - 40), Double(band.high + 100))
        }
        let center = Double(currentSecPerMi ?? 480)
        return (center - 60, center + 90)
    }

    /// The current phase's own HR target wins over the workout-level
    /// ceiling — a quality phase's target is a tighter read than the
    /// session's overall easy/Z2 ceiling.
    static func heartCeilingBpm(walk: LiveRunPhaseWalk?, plan: LiveRunPlanV5?) -> Int? {
        walk?.phase.hrTargetBpm ?? plan?.workoutHrCeilingBpm
    }
}

// MARK: - Preview
//
// Each preview's setup (seeding the DEBUG-only tracker/HR state, building
// the sample plan) is a plain function returning the built view, rather
// than inline statements in the `#Preview` trailing closure — a Void method
// call as a bare statement ahead of the final View expression does not
// type-check inside a `@ViewBuilder` body.

@MainActor
private func outdoorMidRunPreview() -> some View {
    let tracker = PhoneRunTracker()
    tracker.seedForPreview(state: .running, elapsedSec: 18 * 60 + 42,
                           distanceMi: 2.4, currentPaceSecPerMi: 452)
    let hr = TreadmillHRStreamer()
    hr.seedForPreview(bpm: 158)
    let plan = LiveRunPlanV5(
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
    return LiveRunOutdoorV5(tracker: tracker, hr: hr, plan: plan, onPause: {}, onEnd: {})
}

@MainActor
private func outdoorNoHeartPreview() -> some View {
    let tracker = PhoneRunTracker()
    tracker.seedForPreview(state: .running, elapsedSec: 18 * 60 + 42,
                           distanceMi: 2.4, currentPaceSecPerMi: 452)
    let hr = TreadmillHRStreamer()
    let plan = LiveRunPlanV5(sessionType: "Easy", totalMi: 5, phases: [], workoutHrCeilingBpm: nil)
    return LiveRunOutdoorV5(tracker: tracker, hr: hr, plan: plan, onPause: {}, onEnd: {})
}

#Preview("Outdoor · mid-run") {
    outdoorMidRunPreview()
}

#Preview("Outdoor · no heart source") {
    outdoorNoHeartPreview()
}
