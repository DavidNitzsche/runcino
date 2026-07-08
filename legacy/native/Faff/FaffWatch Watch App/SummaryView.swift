//
//  SummaryView.swift
//  FaffWatch
//
//  End-of-workout readout under the locked grammar — three big number rows
//  + Done button, same shape as the in-run faces.
//
//    workout: avg pace (green) · miles (blue) · total time (white)
//    race:    finish time (white) · goal delta (green/over) · miles (blue)
//
//  The completion payload is the exact body the iPhone bridge POSTs to
//  /api/watch/workouts/complete (auto-sent the moment the run ends, not
//  gated on the Done tap — see WatchRootModel).
//

import SwiftUI

struct SummaryView: View {
    let workout: WatchWorkout
    let completion: WatchCompletion?
    let onDone: () -> Void

    @ObservedObject private var phone = PhoneSync.shared

    var body: some View {
        if workout.isRace {
            ResponsiveFace { raceSummary }
        } else if isIntervalCompletion, let c = completion {
            // Interval: page 1 = summary + avg HR, page 2 = per-rep ladder.
            // indexDisplayMode .never avoids dot overlap with the Done button.
            TabView {
                ResponsiveFace { workoutSummary }.tag(0)
                ResponsiveFace { RepLadderView(phases: c.phases, isKm: isKm, onDone: onDone) }.tag(1)
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
        } else {
            ResponsiveFace { workoutSummary }
        }
    }

    // MARK: - Workout summary (avg pace · miles · elapsed · avg HR)

    @ViewBuilder
    private var workoutSummary: some View {
        CompleteFace(
            label:       labelText,
            pace:        avgPaceText,
            distance:    milesText,
            elapsed:     elapsedText,
            hr:          avgHrText,
            verdict:     verdictInfo?.text,
            verdictRole: verdictInfo?.role ?? .neutral,
            syncStatus:  syncStatusText,
            syncRole:    syncStatusRole,
            onDone:      onDone
        )
    }

    /// W-7: one-line upload status so a stranded run (RK-2 silent path-1 fail)
    /// is visible. Nil hides the row — shown only while actively sending or
    /// when a definitive outcome has arrived.
    private var syncStatusText: String? {
        switch phone.syncState {
        case .idle:             return nil
        case .sending:          return "Uploading…"
        case .sent:             return "Sent ✓"
        case .failed(let msg):  return msg
        }
    }
    private var syncStatusRole: Role {
        switch phone.syncState {
        case .sent:   return .live
        case .failed: return .over
        default:      return .neutral
        }
    }

    /// Brief v2 §9 verdict row · state (on-pace / under / over) + one-word
    /// verdict, role-colored (on-pace green · under amber · over red).
    ///
    /// Derivation (all on-device, from the completion the engine already
    /// recorded per-phase):
    ///   state   = WORK-PHASE pace vs WORK-PHASE target ± tolerance —
    ///             distance-weighted across every `.work` phase with a
    ///             target, so warmup/cooldown/recovery framing never
    ///             dilutes the read (phase tolerance when shipped, else
    ///             15 s/mi, also distance-weighted)
    ///   word    = GOOD (on-pace) · SHARP (under = faster than target) ·
    ///             LOADED (over + work-phase avg HR above the work HR
    ///             target) · STEADY (over, HR fine or unknown)
    /// Nil (row hidden) when there's no work-phase target to judge against
    /// — free runs and unstructured sessions stay a plain receipt.
    ///
    /// P1-29 / P1-31 fix (2026-07-07) · the prior computation graded WHOLE-
    /// RUN avg pace (c.totalDurationSec / c.totalDistanceMi — warmup +
    /// recoveries + cooldown all folded in) against the FIRST work phase's
    /// target, so every structured session with a warmup graded 'OVER' even
    /// when every rep was nailed (confirmed independently by four audit
    /// finders). This mirrors the Wave-1 backend fix in
    /// goal-projection.ts:judgeTestPointExecution — basis 1 there is
    /// "watch work-phase pace vs work target," never whole-run vs a work
    /// target. The watch already HAS true per-phase actuals (no need for
    /// the backend's splits/blend fallback ladder — this data is live), so
    /// it always grades work phases directly rather than falling back to a
    /// whole-run number the moment >1 work phase exists.
    private var verdictInfo: (text: String, role: Role)? {
        guard let c = completion else { return nil }
        let workPhases = c.phases.filter { $0.type == "work" && ($0.targetPaceSPerMi ?? 0) > 0 }
        guard !workPhases.isEmpty else { return nil }

        // Distance-weighted actual pace across qualifying work phases —
        // falls back to duration-weighting for any phase whose GPS distance
        // never landed (mirrors the engine's own avgPace derivation, which
        // needs >0.02 mi to trust a distance-based pace).
        func weightedAvg(_ pick: (WatchCompletionPhase) -> Int?) -> Int? {
            var num = 0.0, den = 0.0
            for p in workPhases {
                guard let v = pick(p) else { continue }
                let w = (p.actualDistanceMi ?? 0) > 0.02
                    ? p.actualDistanceMi!
                    : Double(max(p.actualDurationSec, 0)) / 3600.0
                guard w > 0 else { continue }
                num += Double(v) * w
                den += w
            }
            return den > 0 ? Int((num / den).rounded()) : nil
        }

        guard let avg = weightedAvg({ $0.actualPaceSPerMi }),
              let target = weightedAvg({ $0.targetPaceSPerMi }) else { return nil }
        // WatchCompletionPhase carries no tolerance field on the wire
        // (tolerance is a PLAN property, not a completion property) — pull
        // it from workout.phases, matched by index. See
        // weightedAvgTolerance doc below.
        let tol = weightedAvgTolerance(workPhases) ?? 15
        let d = avg - target
        if abs(d) <= tol { return ("GOOD · ON-PACE", .live) }
        if d < 0 { return ("SHARP · UNDER", .goal) }
        // LOADED vs STEADY — over target AND running hot vs the work HR
        // target. Roll up work-phase avgHr the same distance-weighted way
        // (never the whole-run c.avgHr, which pools recovery/warmup HR too)
        // and compare it to the plan's work-phase HR target.
        let workHrTarget = workout.phases.first(where: { $0.type == .work })?.hrTargetBpm
        let workAvgHr = weightedAvg({ $0.avgHr })
        if let hrTarget = workHrTarget, let hr = workAvgHr, hr > hrTarget {
            return ("LOADED · OVER", .over)
        }
        return ("STEADY · OVER", .over)
    }

    /// tolerancePaceSPerMi isn't itself part of the `pick`-closure surface
    /// above (WatchCompletionPhase carries no tolerance field on the wire —
    /// tolerance is a PLAN property, not a completion property), so the
    /// weighted average is derived from `workout.phases` (the plan) keyed
    /// by phase index, matched against the completion's qualifying work
    /// phases. Falls back to nil (→ 15 s/mi default) when indices can't be
    /// matched (older payload shape).
    private func weightedAvgTolerance(_ workPhases: [WatchCompletionPhase]) -> Int? {
        var num = 0.0, den = 0.0
        for cp in workPhases {
            guard let plan = workout.phases.first(where: { $0.index == cp.index }),
                  let tol = plan.tolerancePaceSPerMi else { continue }
            let w = (cp.actualDistanceMi ?? 0) > 0.02
                ? cp.actualDistanceMi!
                : Double(max(cp.actualDurationSec, 0)) / 3600.0
            guard w > 0 else { continue }
            num += Double(tol) * w
            den += w
        }
        return den > 0 ? Int((num / den).rounded()) : nil
    }

    private var labelText: String {
        // Workout TYPE tag for the end-of-run summary (e.g. "THRESHOLD",
        // "TEMPO", "EASY"). The backend's `workout.name` can ship as a
        // full plan description — David's 2026-06-03 run came in as
        // "1 MI WU · 4 MI @ 10:12 · 1 MI CD". That overflowed the small
        // top-label slot and collided with the OS clock at top-right,
        // producing the chaotic top row in the failure screenshot.
        //
        // Strategy: take the first chunk of `workout.name` before any
        // " · " or " @ " separator (so plan-description noise drops
        // away), trim, cap at 14 chars defensively, fall back to
        // status / "WORKOUT" if everything else is empty.
        let raw = workout.name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty else {
            return (completion?.status ?? "Workout").capitalized
        }
        var head = raw
        if let dot = head.range(of: " · ") {
            head = String(head[..<dot.lowerBound])
        }
        if let at = head.range(of: " @ ") {
            head = String(head[..<at.lowerBound])
        }
        head = head.trimmingCharacters(in: .whitespacesAndNewlines)
        if head.count > 14 {
            head = String(head.prefix(14)).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return head.isEmpty ? "WORKOUT" : head
    }
    /// 2026-07-07 · units audit — same pattern as IdleView.swift: internal
    /// completion data (totalDistanceMi, totalDurationSec) stays in miles /
    /// seconds always; only this display formatting step converts, and only
    /// when workout.unitsDistance == "km". Local milesPerKm (not shared —
    /// same "v0 duplication is fine" doctrine as IdleView / PaceFormat).
    private static let milesPerKm = 0.621371
    private var isKm: Bool { workout.unitsDistance == "km" }

    private var avgPaceText: String {
        guard let c = completion, let mi = c.totalDistanceMi, mi > 0.05 else { return "—:—" }
        let secPerMi = Int(Double(c.totalDurationSec) / mi)
        guard isKm else { return PaceFormat.mmss(secPerMi) }
        let secPerKm = Int((Double(max(0, secPerMi)) * Self.milesPerKm).rounded())
        return "\(secPerKm / 60):\(String(format: "%02d", secPerKm % 60))"
    }
    private var milesText: String {
        guard let mi = completion?.totalDistanceMi else { return "—" }
        let v = isKm ? mi * (1.0 / Self.milesPerKm) : mi
        return String(format: "%.1f", v)
    }
    private var elapsedText: String {
        let s = completion?.totalDurationSec ?? 0
        return s >= 3600 ? PaceFormat.hms(s) : PaceFormat.clock(s)
    }
    private var avgHrText: String? {
        completion?.avgHr.map { "\($0)" }
    }
    private var isIntervalCompletion: Bool {
        guard let c = completion else { return false }
        return c.phases.filter { $0.type == "work" }.count > 1
    }

    // MARK: - Race summary (finish time · goal delta · miles)

    @ViewBuilder
    private var raceSummary: some View {
        RaceFinishCard(
            label:     workout.name.isEmpty ? "Finish" : workout.name,
            finish:    raceFinishText,
            delta:     raceDeltaText,
            deltaRole: raceDeltaRole,
            distance:  milesText,
            onDone:    onDone
        )
    }

    private var raceFinishText: String {
        let s = completion?.totalDurationSec ?? 0
        return s >= 3600 ? PaceFormat.hms(s) : PaceFormat.clock(s)
    }
    /// Signed delta-to-goal as "-0:48" (under, green) / "+0:24" (over, red).
    /// Renders "—" until enough banked to compare.
    private var raceDeltaText: String {
        guard let goal = workout.goalSec, let c = completion else { return "—" }
        let d = c.totalDurationSec - goal
        let a = abs(d)
        let mag = a >= 60 ? "\(a / 60):" + String(format: "%02d", a % 60) : "\(a)s"
        return d <= 0 ? "-\(mag)" : "+\(mag)"
    }
    private var raceDeltaRole: Role {
        guard let goal = workout.goalSec, let c = completion else { return .neutral }
        return c.totalDurationSec <= goal ? .live : .over
    }
}

/// Race-day finish card — finish time (white) · goal delta (live/over) ·
/// distance (blue). Sibling to CompleteFace; same shape, race-specific rows.
private struct RaceFinishCard: View {
    let label: String
    let finish: String
    let delta: String
    let deltaRole: Role
    let distance: String
    var onDone: () -> Void = {}
    var body: some View {
        GeometryReader { geo in
            let h = geo.size.height
            ZStack {
                Color.black.ignoresSafeArea()
                LinearGradient(colors: [Faff.liveWash, .clear],
                               startPoint: .top, endPoint: .bottom)
                    .ignoresSafeArea()
                VStack(alignment: .leading, spacing: 0) {
                    FaceLabel(text: label, color: Faff.live, size: h * 0.06)
                        .topTagInset(h)
                    VStack(alignment: .leading, spacing: h * 0.012) {
                        BigValue(text: finish,   role: .neutral, size: h * 0.18)
                        BigValue(text: delta,    role: deltaRole, size: h * 0.18)
                        BigValue(text: distance, role: .dist,    size: h * 0.18)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                    Button(action: onDone) {
                        Text("Done")
                            .font(.custom("HelveticaNeue-Bold", size: h * 0.12))
                            .foregroundStyle(Faff.onLive)
                            .frame(maxWidth: .infinity).padding(.vertical, h * 0.022)
                            .background(Capsule().fill(Faff.live))
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, h * 0.075)
                .padding(.bottom, h * 0.085)
            }
        }
    }
}

// MARK: - Rep ladder — interval post-run breakdown

/// Page 2 of the interval SummaryView. Scrollable list of work phases:
/// each row shows rep number · avg pace · avg HR · verdict glyph.
struct RepLadderView: View {
    let phases: [WatchCompletionPhase]
    /// 2026-07-07 · units audit — true when the runner's distance
    /// preference is km. Defaults false so any call site that predates
    /// this parameter (none currently exist besides SummaryView) keeps
    /// rendering mi, byte-identical to before.
    var isKm: Bool = false
    var onDone: () -> Void = {}

    private var workPhases: [WatchCompletionPhase] {
        phases.filter { $0.type == "work" }
    }

    var body: some View {
        GeometryReader { geo in
            let h = geo.size.height
            ZStack(alignment: .bottom) {
                Color.black.overlay(Faff.liveWash).ignoresSafeArea()
                VStack(alignment: .leading, spacing: 0) {
                    FaceLabel(text: "REPS", color: Faff.live, size: h * 0.06)
                        .topTagInset(h)
                    ScrollView(.vertical, showsIndicators: false) {
                        VStack(spacing: 0) {
                            ForEach(Array(workPhases.enumerated()), id: \.offset) { i, phase in
                                RepLadderRow(number: i + 1, phase: phase, h: h, isKm: isKm)
                            }
                        }
                        .padding(.horizontal, h * 0.048)
                        .padding(.bottom, h * 0.22)   // clear the Done button
                    }
                    .padding(.top, h * 0.024)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                // Done button — same proportions as CompleteFace
                Button(action: onDone) {
                    Text("Done")
                        .font(.custom("HelveticaNeue-Bold", size: h * 0.085))
                        .foregroundStyle(Faff.onLive)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, h * 0.016)
                        .background(Capsule().fill(Faff.live))
                }
                .buttonStyle(.plain)
                .padding(.horizontal, h * 0.075)
                .padding(.bottom, h * 0.020)
            }
        }
    }
}

private struct RepLadderRow: View {
    let number: Int
    let phase: WatchCompletionPhase
    let h: CGFloat
    /// 2026-07-07 · units audit — see RepLadderView.isKm doc.
    var isKm: Bool = false

    private var paceText: String {
        guard let p = phase.actualPaceSPerMi else { return "—:—" }
        guard isKm else { return PaceFormat.mmss(p) }
        let perKm = Int((Double(max(0, p)) * 0.621371).rounded())
        return "\(perKm / 60):\(String(format: "%02d", perKm % 60))"
    }
    private var hrText: String {
        phase.avgHr.map { "♥\($0)" } ?? "—"
    }
    private var verdictGlyph: String {
        switch phase.verdict {
        case "hit":     return "✓"
        case "drifted": return "~"
        case "missed":  return "✗"
        default:        return "—"
        }
    }
    private var verdictColor: Color {
        switch phase.verdict {
        case "hit":     return Faff.live
        case "drifted": return Color(hex: 0xF3AD38)
        case "missed":  return Faff.over
        default:        return Faff.mute
        }
    }

    var body: some View {
        HStack(spacing: h * 0.016) {
            Text("R\(number)")
                .font(.custom("HelveticaNeue-Bold", size: h * 0.040))
                .foregroundStyle(Faff.mute)
                .frame(width: h * 0.072, alignment: .leading)
            Text(paceText)
                .font(.custom("HelveticaNeue-Bold", size: h * 0.056))
                .foregroundStyle(Faff.live)
                .frame(width: h * 0.160, alignment: .leading)
            Text(hrText)
                .font(.custom("HelveticaNeue-Bold", size: h * 0.044))
                .foregroundStyle(.white.opacity(0.65))
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(verdictGlyph)
                .font(.custom("HelveticaNeue-Bold", size: h * 0.056))
                .foregroundStyle(verdictColor)
                .frame(width: h * 0.064, alignment: .trailing)
        }
        .padding(.vertical, h * 0.020)
    }
}
