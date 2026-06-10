//
//  I_RunDetail.swift
//  Family I · Run-detail richness.
//
//  Components: PhaseBreakdownList · RPEEntryCard · ZoneMethodToggle ·
//              ProjectionSparkline · StreakPill.
//
//  RunSourceBadge already exists in Components/StravaReconnectBanner area
//  on the Activity feed · re-export the canonical version here so the
//  Run Detail header can use it without duplicating logic.
//

import SwiftUI

// MARK: - PhaseBreakdownList
//
// Per-phase planned-vs-actual breakdown · the richest coach-vs-runner
// conversation in the app. Status: "on" / "fast" / "slow".

struct PhaseBreakdownList: View {
    let phases: [PhaseBreakdown]?     // nil → loading

    var body: some View {
        if let ps = phases {
            if ps.isEmpty {
                emptyState
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(ps.enumerated()), id: \.element.id) { idx, p in
                        row(p)
                        if idx < ps.count - 1 { Divider().background(Color.white.opacity(0.06)) }
                    }
                }
                .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
            }
        } else {
            VStack(spacing: 0) {
                ForEach(0..<3, id: \.self) { _ in
                    HStack(spacing: 12) {
                        Circle().fill(Color.white.opacity(0.08)).frame(width: 9, height: 9)
                        RoundedRectangle(cornerRadius: 4).fill(Color.white.opacity(0.08))
                            .frame(maxWidth: 120).frame(height: 12)
                        Spacer()
                        RoundedRectangle(cornerRadius: 4).fill(Color.white.opacity(0.08))
                            .frame(width: 46, height: 14)
                    }
                    .padding(.horizontal, 14).padding(.vertical, 12)
                }
            }
            .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
        }
    }

    private func row(_ p: PhaseBreakdown) -> some View {
        let s = statusOf(p)
        return HStack(alignment: .center, spacing: 12) {
            Circle().fill(s.color).frame(width: 9, height: 9)
            VStack(alignment: .leading, spacing: 2) {
                Text(p.label)
                    .font(.body(13, weight: .extraBold))
                    .foregroundStyle(Theme.txt)
                if let t = p.target_pace, !t.isEmpty {
                    Text("target \(t)")
                        .font(.body(11.5, weight: .medium))
                        .foregroundStyle(Theme.mute)
                }
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                Text(p.actual_pace ?? "—")
                    .font(.body(14, weight: .bold)).monospacedDigit()
                    .foregroundStyle(Theme.txt)
                Text(s.label)
                    .font(.body(10, weight: .extraBold)).tracking(0.8)
                    .foregroundStyle(s.color)
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
    }

    private struct StatusVis { let label: String; let color: Color }
    private func statusOf(_ p: PhaseBreakdown) -> StatusVis {
        let s = (p.status ?? "").lowercased()
        switch s {
        case "fast": return StatusVis(label: "Fast",  color: Theme.dist)
        case "slow": return StatusVis(label: "Slow",  color: Theme.goal)
        case "on":   return StatusVis(label: "On",    color: Theme.green)
        default:     return StatusVis(label: p.completed ? "Done" : "—",
                                       color: p.completed ? Theme.green : Theme.mute)
        }
    }

    private var emptyState: some View {
        HStack(spacing: 10) {
            Image(systemName: "waveform")
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(Theme.mute)
            Text("Unstructured run · no planned phases to compare against.")
                .font(.body(12.5, weight: .medium))
                .foregroundStyle(Theme.mute)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
    }
}

// MARK: - RunSourceBadge
//
// Atom. Small glyph + label left of the run name in the Activity list and
// Run Detail header.

enum RunSource: String {
    // 2026-06-01 · `.treadmill` added when the iPhone TreadmillView began
    // POSTing completions with body.source='treadmill' (build 136). Renders
    // as an indoor-figure glyph in the activity feed + run detail header,
    // distinct from outdoor watch runs.
    case watch, apple_health, strava, manual, treadmill, unknown

    static func from(_ raw: String?) -> RunSource {
        switch (raw ?? "").lowercased() {
        case "watch":         return .watch
        case "apple_health":  return .apple_health
        case "strava":        return .strava
        case "manual":        return .manual
        case "treadmill":     return .treadmill
        default:              return .unknown
        }
    }
    var label: String {
        switch self {
        case .watch:         return "Watch"
        case .apple_health:  return "Health"
        case .strava:        return "Strava"
        case .manual:        return "Manual"
        case .treadmill:     return "Treadmill"
        case .unknown:       return "—"
        }
    }
    var symbol: String {
        switch self {
        case .watch:         return "applewatch"
        case .apple_health:  return "heart.fill"
        case .strava:        return "bolt.fill"
        case .manual:        return "pencil.line"
        case .treadmill:     return "figure.indoor.run"
        case .unknown:       return "circle.dashed"
        }
    }
    var color: Color {
        switch self {
        case .watch:         return Theme.green
        case .apple_health:  return Theme.race
        case .strava:        return Theme.over
        case .manual:        return Theme.Accent.amberBright
        // Treadmill = indoor mechanical · use the amber/ember mid-tone to
        // distinguish from the watch's outdoor green and Strava's red-orange.
        case .treadmill:     return Theme.Accent.amberBright
        case .unknown:       return Theme.mute
        }
    }
}

struct RunSourceBadge: View {
    let source: RunSource
    var compact: Bool = false

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: source.symbol)
                .font(.system(size: compact ? 10 : 11, weight: .semibold))
                .foregroundStyle(source.color)
                .frame(width: compact ? 18 : 22, height: compact ? 18 : 22)
                .background(source.color.opacity(0.18), in: RoundedRectangle(cornerRadius: 6))
            if !compact {
                Text(source.label)
                    .font(.body(11, weight: .extraBold)).tracking(0.5)
                    .foregroundStyle(Theme.txt)
            }
        }
    }
}

// MARK: - RPEEntryCard
//
// Borg CR10 scale + notes. Pre-fills from a prior GET so re-open shows
// the runner's prior rating instead of a blank slate.

struct RPEEntryCard: View {
    let runId: String
    @State private var priorRpe: Int? = nil
    @State private var priorNotes: String = ""
    @State private var rpe: Int? = nil
    @State private var notes: String = ""
    @State private var submitting: Bool = false
    @State private var submitError: String? = nil
    @State private var loaded: Bool = false
    var onSubmitted: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: 11) {
            Text("How hard did that feel?")
                .font(.body(11, weight: .extraBold)).tracking(0.6)
                .foregroundStyle(Theme.mute)
            scale
            HStack {
                Text("Easy").font(.body(10.5, weight: .semibold)).foregroundStyle(Theme.mute)
                Spacer()
                Text("Max").font(.body(10.5, weight: .semibold)).foregroundStyle(Theme.mute)
            }
            if let p = priorRpe {
                priorRow(p)
            } else {
                notesField
            }
            if priorRpe == nil || rpe != priorRpe {
                Button { submit() } label: {
                    Text(submitting ? "Saving…" : (priorRpe == nil ? "Save" : "Update"))
                        .font(.body(13, weight: .extraBold))
                        .foregroundStyle(rpe == nil ? Theme.mute : Theme.bg)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 11)
                        .background(rpe == nil ? Color.white.opacity(0.08) : Theme.txt,
                                    in: RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)
                .disabled(rpe == nil || submitting)
            }
            if let err = submitError {
                Text(err)
                    .font(.body(11, weight: .semibold))
                    .foregroundStyle(Color(hex: 0xFC4D64))
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(16)
        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
        .task { if !loaded { await loadPrior() } }
    }

    private var scale: some View {
        HStack(spacing: 6) {
            ForEach(1...10, id: \.self) { n in
                Button { rpe = n } label: {
                    Text("\(n)")
                        .font(.body(13, weight: .bold)).monospacedDigit()
                        .foregroundStyle(rpe == n ? Theme.bg : Theme.txt)
                        .frame(maxWidth: .infinity, minHeight: 30)
                        .background(rpe == n ? rpeColor(n) : Theme.Glass.fill, in: RoundedRectangle(cornerRadius: 8))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(rpe == n ? rpeColor(n) : Theme.Glass.line, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func rpeColor(_ n: Int) -> Color {
        if n <= 3 { return Theme.green }
        if n <= 6 { return Theme.goal }
        return Theme.over
    }

    private var notesField: some View {
        ZStack(alignment: .topLeading) {
            TextEditor(text: $notes)
                .font(.body(13, weight: .medium))
                .foregroundStyle(Theme.txt)
                .scrollContentBackground(.hidden)
                .frame(minHeight: 64)
                .padding(8)
                .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.Glass.line, lineWidth: 1))
            if notes.isEmpty {
                Text("Anything worth noting? Legs, weather, how it sat.")
                    .font(.body(13, weight: .medium))
                    .foregroundStyle(Theme.mute)
                    .padding(.horizontal, 12).padding(.vertical, 12)
            }
        }
    }

    private func priorRow(_ p: Int) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            (Text("You rated this ")
             + Text("\(p) · \(adjective(p))").font(.body(12.5, weight: .extraBold)))
                .font(.body(12.5, weight: .medium))
                .foregroundStyle(Theme.txt)
            if !priorNotes.isEmpty {
                Text("\"\(priorNotes)\"")
                    .font(.body(12, weight: .medium))
                    .foregroundStyle(Theme.mute)
                    .italic()
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
    }

    private func adjective(_ n: Int) -> String {
        switch n {
        case 1...2: return "very easy"
        case 3:     return "easy"
        case 4:     return "moderate"
        case 5...6: return "comfortably hard"
        case 7:     return "hard"
        case 8...9: return "very hard"
        case 10:    return "max"
        default:    return "—"
        }
    }

    private func loadPrior() async {
        loaded = true
        if let r = try? await API.fetchRPE(runId: runId), let v = r.rpe {
            await MainActor.run {
                priorRpe = v.rpe
                priorNotes = v.notes ?? ""
                rpe = v.rpe
                notes = v.notes ?? ""
            }
        }
    }

    private func submit() {
        guard let r = rpe else { return }
        submitting = true
        submitError = nil
        Task {
            do {
                _ = try await API.postRPE(runId: runId, rpe: r, notes: notes.isEmpty ? nil : notes)
                await MainActor.run {
                    priorRpe = r
                    priorNotes = notes
                    submitting = false
                    onSubmitted()
                }
            } catch {
                await MainActor.run {
                    submitting = false
                    submitError = "Couldn't save · check your connection"
                }
            }
        }
    }
}

// MARK: - ZoneMethodToggle
//
// %MHR / LTHR switch above the time-in-zones bar. The two can differ
// 5–10 bpm; being honest about method matters.

enum ZoneMethod: String, CaseIterable {
    case pctMhr = "%MHR"
    case lthr   = "LTHR"
}

struct ZoneMethodToggle: View {
    @Binding var method: ZoneMethod

    var body: some View {
        HStack(spacing: 0) {
            ForEach(ZoneMethod.allCases, id: \.self) { m in
                Button { withAnimation(Theme.Motion.smooth) { method = m } } label: {
                    Text(m.rawValue)
                        .font(.body(11, weight: .extraBold)).tracking(0.6)
                        .foregroundStyle(method == m ? Theme.bg : Theme.txt)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 7)
                        .background(method == m ? Theme.txt : Color.clear)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(3)
        .frame(maxWidth: 200)
        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 11))
        .overlay(RoundedRectangle(cornerRadius: 11).stroke(Theme.Glass.line, lineWidth: 1))
    }
}

// MARK: - ProjectionSparkline
//
// Last ~4 weeks of projected finish from projection_snapshots. Tells the
// runner if they're improving, stalling, or regressing.

struct ProjectionSparkline: View {
    let points: [Double]?           // projected_seconds for each snapshot (left→right is oldest→newest)
    let currentLabel: String        // "1:29:40"
    let deltaLabel: String?         // "2:20 faster · 4 wks" / "30s slower · 2 wks"
    let trendUp: Bool               // true → improving (lower seconds is better)

    var body: some View {
        HStack(spacing: 14) {
            chart
                .frame(width: 120, height: 46)
            VStack(alignment: .leading, spacing: 3) {
                Text(currentLabel)
                    .font(.display(20, weight: .bold)).monospacedDigit()
                    .foregroundStyle(Theme.txt)
                if let d = deltaLabel {
                    HStack(spacing: 4) {
                        Image(systemName: trendUp ? "arrow.up.right" : "arrow.down.right")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(trendUp ? Theme.Accent.mintReady : Theme.over)
                        Text(d)
                            .font(.body(11.5, weight: .extraBold))
                            .foregroundStyle(trendUp ? Theme.Accent.mintReady : Theme.over)
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
    }

    @ViewBuilder
    private var chart: some View {
        if let pts = points, pts.count > 1 {
            GeometryReader { geo in
                let lo = pts.min() ?? 0
                let hi = pts.max() ?? 1
                let span = max(hi - lo, 1)
                Path { p in
                    for (i, v) in pts.enumerated() {
                        let x = geo.size.width * CGFloat(i) / CGFloat(pts.count - 1)
                        let norm = (v - lo) / span
                        // lower seconds is better → invert so improvement goes UP visually
                        let yNorm = trendUp ? norm : (1 - norm)
                        let y = geo.size.height - 4 - geo.size.height * CGFloat(1 - yNorm) * 0.9
                        if i == 0 { p.move(to: CGPoint(x: x, y: y)) }
                        else { p.addLine(to: CGPoint(x: x, y: y)) }
                    }
                }
                .stroke(trendUp ? Theme.Accent.mintReady : Theme.over,
                        style: StrokeStyle(lineWidth: 2.4, lineCap: .round, lineJoin: .round))
                Circle()
                    .fill(trendUp ? Theme.Accent.mintReady : Theme.over)
                    .frame(width: 7, height: 7)
                    .position(x: geo.size.width - 4, y: 8)
            }
        } else {
            RoundedRectangle(cornerRadius: 4)
                .fill(Color.white.opacity(0.08))
        }
    }
}

// MARK: - StreakPill
//
// Surfaces consecutive-day streak with milestone celebration at 7/14/30/100.

struct StreakPill: View {
    let current: Int
    let isMilestone: Bool

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: isMilestone ? "star.fill" : "flame.fill")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(isMilestone ? Theme.Accent.amberGold : Theme.race)
            Text("\(current)")
                .font(.body(13, weight: .bold)).monospacedDigit()
                .foregroundStyle(isMilestone ? Theme.Accent.amberGold : Theme.txt)
            Text(isMilestone ? "days · milestone" : "day streak")
                .font(.body(11, weight: .extraBold)).tracking(0.5)
                .foregroundStyle(isMilestone ? Theme.Accent.amberGold : Theme.txt)
        }
        .padding(.horizontal, 10).padding(.vertical, 6)
        .background(Theme.Glass.fill, in: Capsule())
        .overlay(Capsule().stroke(
            isMilestone ? Theme.Status.prBorder : Theme.Glass.line, lineWidth: 1))
    }
}
