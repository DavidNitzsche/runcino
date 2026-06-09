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

    var body: some View {
        if workout.isRace {
            ResponsiveFace { raceSummary }
        } else if isIntervalCompletion, let c = completion {
            // Interval: page 1 = summary + avg HR, page 2 = per-rep ladder.
            // indexDisplayMode .never avoids dot overlap with the Done button.
            TabView {
                ResponsiveFace { workoutSummary }.tag(0)
                ResponsiveFace { RepLadderView(phases: c.phases, onDone: onDone) }.tag(1)
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
            label:    labelText,
            pace:     avgPaceText,
            distance: milesText,
            elapsed:  elapsedText,
            hr:       avgHrText,
            onDone:   onDone
        )
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
    private var avgPaceText: String {
        guard let c = completion, let mi = c.totalDistanceMi, mi > 0.05 else { return "—:—" }
        return PaceFormat.mmss(Int(Double(c.totalDurationSec) / mi))
    }
    private var milesText: String {
        completion?.totalDistanceMi.map { String(format: "%.1f", $0) } ?? "—"
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
                LinearGradient(colors: [Color(hex: 0x0C2A14), .black],
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
                            .foregroundStyle(Color(hex: 0x06210C))
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
    var onDone: () -> Void = {}

    private var workPhases: [WatchCompletionPhase] {
        phases.filter { $0.type == "work" }
    }

    var body: some View {
        GeometryReader { geo in
            let h = geo.size.height
            ZStack(alignment: .bottom) {
                Color(hex: 0x0C2A14).ignoresSafeArea()
                VStack(alignment: .leading, spacing: 0) {
                    FaceLabel(text: "REPS", color: Faff.live, size: h * 0.06)
                        .topTagInset(h)
                    ScrollView(.vertical, showsIndicators: false) {
                        VStack(spacing: 0) {
                            ForEach(Array(workPhases.enumerated()), id: \.offset) { i, phase in
                                RepLadderRow(number: i + 1, phase: phase, h: h)
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
                        .foregroundStyle(Color(hex: 0x06210C))
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

    private var paceText: String {
        phase.actualPaceSPerMi.map { PaceFormat.mmss($0) } ?? "—:—"
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
