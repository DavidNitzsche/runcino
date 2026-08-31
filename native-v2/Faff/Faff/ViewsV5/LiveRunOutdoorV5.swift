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
//  THE LIMITS THE DESIGN DOES NOT ACCOUNT FOR
//
//  1 · Recording continues with the screen locked (`PhoneRunTracker` now
//      holds a background-location assertion). The idle timer is still
//      disabled for the run's duration and restored on exit, because a
//      console you can glance at is better than one you have to wake — but
//      it is no longer load-bearing, and `tracker.backgroundRecordingEnabled`
//      says so if a build ever ships without the entitlement.
//  2 · A GPS drop is `tracker.lastFixAgeIsStale`. That is RULE THREE
//      territory: "we could not read this," not a zero and not a silent
//      undercounted number. Rendered as `ErrorNote`, not folded into the
//      pace tile.
//  3 · There is a wait before the first fix, and during it the distance is
//      not zero — it is unread. Printing "0.00" there is RULE ONE the wrong
//      way round: a number the screen does not have, dressed as one it does.
//      `tracker.hasFirstFix` gates it.
//  4 · Location can be refused outright, which is an ANSWER and has to look
//      like one. `Alert` (attention rail, an action, no fault red), never
//      the `ErrorNote` the network-outage case uses, and never a live-looking
//      console frozen at 0:00 — which is what this screen used to show,
//      because it read neither authorization flag.
//  5 · A stretch nobody could measure (`tracker.trackHasGap`) makes the
//      distance read SHORT. Nothing is guessed across it; the runner is told
//      instead.
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
    /// carry one at the workout level). A quality session carries no
    /// workout-level ceiling at all — its HR reference comes from the
    /// CURRENT phase's own `hrTargetBpm` instead, and is a different KIND of
    /// value, not a tighter ceiling — see `heartReference(walk:plan:)` below.
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

    /// "Interval 2 of 4", or the phase's own label — a warm-up is a warm-up,
    /// not "Interval 1 of 1".
    var lineHead: String {
        (isWork && workCount > 1) ? "Interval \(workIndex) of \(workCount)" : phase.label
    }

    /// The remaining figure carrying its own provenance · RULE ONE.
    ///
    /// A time countdown is a real clock run against a prescribed duration:
    /// measured. A distance rep's "0.6 mi to go" is NOT — it is that rep's
    /// planned distance scaled by how much of the plan's own TIME estimate
    /// has elapsed (`WatchPhase.distanceMi`'s doc comment calls that figure
    /// an estimate in as many words), so it is a model of where the runner
    /// probably is, and it takes the mark. It was previously printed as a
    /// bare string indistinguishable from the measured case.
    var remainingValue: FaffValue {
        remainingMi != nil ? .modelled(remainingShort) : .measured(remainingShort)
    }

    /// "Interval 2 of 4 · 0.6 mi to go" as one flat string. 12b builds its
    /// own line out of `lineHead`/`remainingShort`; 12a renders `lineHead` +
    /// `remainingValue` so the mark survives (see `intervalLine`).
    var lineText: String {
        "\(lineHead) · \(remainingShort) to go"
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
            if tracker.authorizationDenied {
                // RULE THREE · this is an answer, not an outage. Attention
                // rail and a way to act on it, never fault red, and never
                // the console it replaces.
                locationRefused
            } else {
                console
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(V5.surfacePage.ignoresSafeArea())
        // The run clock is NOT driven from here any more. This screen used
        // to carry `TimelineView(.periodic(from: .now, by: 1.0))` in a
        // `.background`, ticking the tracker from `.onChange(of: ctx.date)`.
        // `.now` is read inside `body`, so every re-render re-anchored the
        // schedule, which produced a new date, which fired the tick, which
        // wrote `@Published elapsedSec`, which re-rendered. Measured on the
        // simulator: 5,543 ticks in fifteen seconds, and only two GPS fixes
        // accepted in the same window because the loop had the main actor.
        // `PhoneRunTracker` owns its clock now — see `startClock` there.
        // The view redraws because `elapsedSec` changes, which is the right
        // direction for that dependency to run in.
        // Keep the screen awake for the run's duration only, restore on
        // exit — mirrors PhoneRunView's own onChange/onDisappear pair. This
        // is now a convenience rather than the thing holding the run up:
        // recording survives a locked screen (LIMIT 1).
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

    // MARK: - The console

    private var console: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: V5.S.s16) {
                topRow
                distTile
                paceTile
                heartTile
                if let walk { intervalLine(walk) }
                signalNote
            }
            .padding(.horizontal, V5.S.s20)
            .padding(.top, V5.S.s8)

            Spacer(minLength: V5.S.s16)

            buttons
                .padding(.horizontal, V5.S.s20)
                .padding(.top, V5.S.s12)
                .padding(.bottom, V5.S.s16)
        }
    }

    /// One note at a time, in the order the runner needs them. Before the
    /// first fix nothing else is knowable; a live drop outranks a historical
    /// gap; and the missing-entitlement case is last because it is a build
    /// problem, not a run problem, and should never appear at all.
    @ViewBuilder
    private var signalNote: some View {
        if !tracker.hasFirstFix && tracker.state == .running {
            Silence(reason: "Finding GPS. Distance and pace start when the signal locks.")
        } else if tracker.lastFixAgeIsStale {
            // RULE THREE: a GPS drop is "we could not read this," not a
            // silently undercounted distance folded into the tile.
            ErrorNote(text: "GPS signal dropped. Distance holds where it is until it comes back.")
        } else if tracker.trackHasGap {
            Alert(text: "Part of this run could not be measured. Nothing was filled in across the gap, so the distance reads short.")
        } else if !tracker.backgroundRecordingEnabled && tracker.state == .running {
            Alert(text: "This build can only record while the app is open. Keep the screen on until you end the run.")
        }
    }

    /// "Interval 2 of 4 · ~0.6 mi to go". The figure goes through
    /// `FaffValueText` rather than into the string, so a distance derived
    /// from the plan's time estimate carries the mark and a real countdown
    /// does not — see `LiveRunPhaseWalk.remainingValue`.
    private func intervalLine(_ walk: LiveRunPhaseWalk) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 0) {
            Text("\(walk.lineHead) \u{00b7} ")
            FaffValueText(walk.remainingValue, font: .faffText(20, weight: .medium))
            Text(" to go")
        }
        .font(.faffText(20, weight: .medium))
        .foregroundStyle(V5.textPrimary)
        .lineSpacing(2)
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        .padding(.horizontal, V5.S.s4)
    }

    // MARK: - Location refused
    //
    // The screen this replaces read neither `authorizationGranted` nor
    // `authorizationDenied`, so a runner who had said no — or who had not
    // been asked yet — got the full live console, frozen at 0:00, with a
    // button labelled "Pause" as the only thing that would start anything.

    private var locationRefused: some View {
        VStack(alignment: .leading, spacing: V5.S.s16) {
            topRow
            Alert(text: "Location is off for Faff. There is no route, distance or pace to record without it.")
            Text("Turn it on in Settings, then start the run again.")
                .font(.faffText(TypeScaleV5.body15))
                .foregroundStyle(V5.textSecondary)
                .lineSpacing(3)
                .padding(.horizontal, V5.S.s4)
            FaffButton("Open Settings", variant: .secondary, size: .lg) {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            }
            Spacer(minLength: 0)
            FaffButton("Back", variant: .ghost, size: .lg, action: onEnd)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, V5.S.s20)
        .padding(.top, V5.S.s8)
        .padding(.bottom, V5.S.s16)
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
                // Before the first fix this is not zero, it is unread. The
                // old `?? "0"` printed a measurement the screen did not have,
                // and a runner who set off during the lock wait read it as a
                // broken tracker.
                FaffValueText(tracker.hasFirstFix ? .measured(Self.liveMiles(tracker.distanceMi)) : .unreadable,
                              font: .faffText(32, weight: .semibold))
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

    /// Two decimals on a live console · now `FaffFmt.liveMiles`, because the
    /// treadmill console needed the identical thing and had no way to reach
    /// this. The argument for it lives with the definition. Every non-live
    /// distance still goes through `FaffFmt.miles`.
    static func liveMiles(_ mi: Double) -> String {
        FaffFmt.liveMiles(mi) ?? "\u{2014}"
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
                // HR-SEMANTICS-1 (2026-09-01) · a real ceiling (easy/long)
                // still draws the shaded `.ceiling` gauge and still turns
                // amber on breach — unchanged. A quality phase's "expected"
                // reference now draws `.reference` instead: same track, same
                // live marker, no shaded zone and never amber, because
                // running past it mid-rep is not a breach. See
                // `heartReference`'s doc comment.
                let reference = LiveRunOutdoorV5.heartReference(walk: walk, plan: plan)
                let ceilingBpm: Int? = { if case .ceiling(let c) = reference { return c }; return nil }()
                let expectedBpm: Int? = { if case .expected(let e) = reference { return e }; return nil }()
                let hrMax = Double(ceilingBpm ?? expectedBpm ?? max(bpm + 20, 170)) + 20
                VStack(spacing: V5.S.s10) {
                    Text("HEART RATE")
                        .font(.faffText(18))
                        .tracking(18 * 0.06)
                        .foregroundStyle(V5.textSecondary)
                    FaffValueText(.measured(FaffFmt.bpm(Double(bpm))), font: .faffText(72, weight: .semibold))
                    if let ceilingBpm {
                        RangeScale(mode: .ceiling, min: 100, max: hrMax,
                                  band: (low: 0.0, high: Double(ceilingBpm)),
                                  value: Double(bpm),
                                  endpoints: ("100", String(ceilingBpm)),
                                  hue: .heart, size: .s)
                    } else {
                        RangeScale(mode: .reference, min: 100, max: hrMax,
                                  value: Double(bpm),
                                  endpoints: ("100", expectedBpm.map { "~\($0) expected" } ?? FaffFmt.bpm(hrMax) ?? "\u{2014}"),
                                  hue: .heart, size: .s)
                    }
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

    /// THE SCALE ALWAYS CONTAINS THE RUNNER'S OWN PACE.
    ///
    /// `RangeScale` clamps its marker to [0, 1], so a value outside the scale
    /// pins to an edge and stops moving — and the endpoint label underneath it
    /// then states a range the runner is not in. Caught on the simulator at
    /// screen 12a: a recovery jog inside a threshold session targets 8:40–9:20,
    /// which gave a scale of 8:00–11:00, and the runner going 7:32 got a marker
    /// welded to the left edge above a label reading "8:00".
    ///
    /// The asymmetric headroom below (40 fast, 100 slow) is right for drift —
    /// fatigue moves a live pace slower — but a RECOVERY phase is exactly where
    /// a runner is habitually far too fast, so 40 s/mi is not enough. Rather
    /// than widen the default and make every scale coarser, the bounds simply
    /// grow to admit whatever the runner is actually doing, with a little air
    /// so the marker is never flush against the end.
    static func paceScaleBounds(band: (low: Int, high: Int)?, currentSecPerMi: Int?) -> (min: Double, max: Double) {
        var lo: Double
        var hi: Double
        if let band {
            lo = Double(band.low - 40)
            hi = Double(band.high + 100)
        } else {
            let center = Double(currentSecPerMi ?? 480)
            lo = center - 60
            hi = center + 90
        }
        if let current = currentSecPerMi.map(Double.init) {
            lo = Swift.min(lo, current - 15)
            hi = Swift.max(hi, current + 15)
        }
        return (lo, hi)
    }

    /// HR-SEMANTICS-1 (2026-09-01) · what the heart tile has to say about
    /// heart rate on THIS phase, if anything — and which of two structurally
    /// different things it is. See `docs/reports/hr-semantics-2026-09-01.md`.
    ///
    /// `.ceiling` — `plan.workoutHrCeilingBpm`, the real aerobic Z2 cap an
    /// easy/long/shakeout day is judged against. Staying under it is the
    /// whole discipline of the day, so the tile shades the zone and turns
    /// amber on breach.
    ///
    /// `.expected` — `walk.phase.hrTargetBpm`, the quality work phase's own
    /// informational reference (`lib/watch/build-workout.ts`'s
    /// `workHrTargetBpm`, ~100-105% LTHR). Pace is the primary instruction
    /// on a threshold or interval rep; this number is worth showing, never
    /// enforcing. Before this fix it rode the SAME `.ceiling` gauge as the
    /// real cap above — a rep running a few beats past it (normal, expected)
    /// turned the marker amber and had VoiceOver announce "above the
    /// ceiling", exactly the alarm a genuine easy-day breach gets. That is
    /// the live-run-screen instance of the warm-up segment's own
    /// pace-vs-HR contradiction (`spec-card.ts`'s WARMUP-CONTRADICTION-1),
    /// one surface over.
    ///
    /// The two are mutually exclusive by construction on the server —
    /// `build-workout.ts` gates `hrTargetBpm` to quality work phases and
    /// `hrCeilingBpm` to easy/long/shakeout — but the phase value still wins
    /// if a future spec shape ever sent both, since a quality phase's own
    /// read is the tighter, more specific one.
    enum HeartReference { case ceiling(Int), expected(Int) }

    static func heartReference(walk: LiveRunPhaseWalk?, plan: LiveRunPlanV5?) -> HeartReference? {
        if let bpm = walk?.phase.hrTargetBpm { return .expected(bpm) }
        if let bpm = plan?.workoutHrCeilingBpm { return .ceiling(bpm) }
        return nil
    }
}

// MARK: - Preview
//
// Each preview's setup (seeding the DEBUG-only tracker/HR state, building
// the sample plan) is a plain function returning the built view, rather
// than inline statements in the `#Preview` trailing closure — a Void method
// call as a bare statement ahead of the final View expression does not
// type-check inside a `@ViewBuilder` body.
//
// THE WHOLE REGION IS `#if DEBUG`, AND HAS TO BE.
//
// `seedForPreview` is a DEBUG-only seam on `PhoneRunTracker` and
// `TreadmillHRStreamer` — deliberately, so nothing can stamp a fake GPS
// state into a shipping build. But `#Preview` itself is NOT debug-only: the
// macro expands in Release too, so these helpers were compiled against
// symbols that do not exist there. `xcodebuild -configuration Release`
// failed with 12 errors, which means an ARCHIVE failed, which means
// TestFlight was blocked and nothing said so until someone tried it.
// Debug builds and the simulator never saw it.

#if DEBUG

@MainActor
func outdoorMidRunPreview() -> some View {
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
func outdoorNoHeartPreview() -> some View {
    let tracker = PhoneRunTracker()
    tracker.seedForPreview(state: .running, elapsedSec: 18 * 60 + 42,
                           distanceMi: 2.4, currentPaceSecPerMi: 452)
    let hr = TreadmillHRStreamer()
    let plan = LiveRunPlanV5(sessionType: "Easy", totalMi: 5, phases: [], workoutHrCeilingBpm: nil)
    return LiveRunOutdoorV5(tracker: tracker, hr: hr, plan: plan, onPause: {}, onEnd: {})
}

/// The first ten seconds of every outdoor run, and the state the screen used
/// to render as a measured "0.00".
@MainActor
func outdoorFindingGpsPreview() -> some View {
    let tracker = PhoneRunTracker()
    tracker.seedForPreview(state: .running, elapsedSec: 6, distanceMi: 0,
                           currentPaceSecPerMi: nil, hasFirstFix: false)
    let hr = TreadmillHRStreamer()
    let plan = LiveRunPlanV5(sessionType: "Easy", totalMi: 5, phases: [], workoutHrCeilingBpm: nil)
    return LiveRunOutdoorV5(tracker: tracker, hr: hr, plan: plan, onPause: {}, onEnd: {})
}

/// A stretch nobody could measure. The distance is honest and short, and the
/// screen says so rather than filling the hole in.
@MainActor
func outdoorGapPreview() -> some View {
    let tracker = PhoneRunTracker()
    tracker.seedForPreview(state: .running, elapsedSec: 24 * 60, distanceMi: 2.9,
                           currentPaceSecPerMi: 468, trackHasGap: true)
    let hr = TreadmillHRStreamer()
    hr.seedForPreview(bpm: 149)
    let plan = LiveRunPlanV5(sessionType: "Easy", totalMi: 6, phases: [], workoutHrCeilingBpm: 152)
    return LiveRunOutdoorV5(tracker: tracker, hr: hr, plan: plan, onPause: {}, onEnd: {})
}

#Preview("Outdoor · mid-run") {
    outdoorMidRunPreview()
}

#Preview("Outdoor · no heart source") {
    outdoorNoHeartPreview()
}

#Preview("Outdoor · finding GPS") {
    outdoorFindingGpsPreview()
}

#Preview("Outdoor · track has a gap") {
    outdoorGapPreview()
}

#endif  // DEBUG · previews only
