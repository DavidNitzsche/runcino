//
//  K_TargetsProjectionDepth.swift
//  Family K · Targets PROJECTION DEPTH · supporting sections (race P3).
//
//  Sits BELOW the clean Pace Projection hero card (K_TargetsProjection) on
//  TargetsView. The hero card answers "how am I going for the goal" at a
//  glance and is kept deliberately clean — these sections surface the
//  decode-but-never-shown depth that already rides in ProjectionSummary:
//
//    1. AT OTHER DISTANCES  · raceProjections[] · equivalent 5K/10K/Half/M
//                             times at current fitness. Always show when present.
//    2. LIKELY RANGE        · confidenceInterval lo–hi + label. David: "keep
//                             it, it's honest." A short band, not in the card.
//    3. SAFE TARGET         · goalSafeSec (B-goal) as a secondary target line.
//    4. WHAT'S THE GAP MADE OF · gap decomposition (Fitness / Conditions /
//                             Course / Execution sec). Web REMOVED this from the
//                             "steady" view in favor of the trajectory hero —
//                             built here self-contained + easily removable, and
//                             flagged for David's keep-or-cut on review. Renders
//                             only when the chunks carry real signal.
//
//  Doctrine: display-only, coach voice (no hype / emoji / em dash), Theme
//  tokens (CI-locked palette). Each section renders only when its data is
//  present — restrained supporting depth, NOT a dashboard. All values are
//  REAL from ProjectionSummary; zero client-side race-time math.
//

import SwiftUI

// MARK: - Time helpers (h:mm:ss / m:ss · mirror the hero card)

private func depthFormatTime(_ sec: Int?) -> String {
    guard let sec, sec > 0 else { return "—" }
    let h = sec / 3600
    let m = (sec % 3600) / 60
    let s = sec % 60
    if h > 0 { return String(format: "%d:%02d:%02d", h, m, s) }
    return String(format: "%d:%02d", m, s)
}

/// "m:ss" of an absolute second amount (gap-chunk magnitudes).
private func depthClock(_ sec: Int) -> String {
    let a = Swift.abs(sec)
    return String(format: "%d:%02d", a / 60, a % 60)
}

// MARK: - Public · supporting depth block

struct TargetsProjectionDepth: View {
    let summary: ProjectionSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            if hasRaceProjections { otherDistancesSection }
            if let ci = summary.confidenceInterval, ci.lo > 0, ci.hi > 0 { likelyRangeSection(ci) }
            if let safe = summary.goalSafeSec, safe > 0 { safeTargetSection(safe) }
            if hasGapBreakdown { gapBreakdownSection }
        }
    }

    // ── 1 · AT OTHER DISTANCES ────────────────────────────────────────────

    private var hasRaceProjections: Bool {
        !(summary.raceProjections ?? []).isEmpty
    }

    private var otherDistancesSection: some View {
        let rows = summary.raceProjections ?? []
        return depthSection("AT OTHER DISTANCES", caption: "Equivalent efforts at today's fitness") {
            VStack(spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.offset) { idx, entry in
                    if idx > 0 {
                        Rectangle()
                            .fill(Color.white.opacity(0.06))
                            .frame(height: 1)
                    }
                    HStack {
                        Text(entry.distance.uppercased())
                            .font(.body(12, weight: .extraBold))
                            .tracking(0.8)
                            .foregroundStyle(Theme.txt.opacity(0.7))
                        Spacer()
                        Text(entry.time)
                            .font(.display(18, weight: .semibold))
                            .tracking(-0.5)
                            .foregroundStyle(Theme.txt)
                            .monospacedDigit()
                    }
                    .padding(.vertical, 11)
                }
            }
            .depthTile()
        }
    }

    // ── 2 · LIKELY RANGE ──────────────────────────────────────────────────

    private func likelyRangeSection(_ ci: ProjectionConfidenceInterval) -> some View {
        // Server `pct` is ALREADY a percent — the interval half-width as ±% of
        // the projection (e.g. 2.5 → ±2.5%), NOT a 0…1 fraction. Render it as a
        // ± band, not ×100 (which read as a nonsensical "250% range").
        let pctText: String = {
            guard ci.pct > 0 else { return "" }
            let s = ci.pct == ci.pct.rounded() ? String(format: "%.0f", ci.pct)
                                               : String(format: "%.1f", ci.pct)
            return "± \(s)%"
        }()
        return depthSection("LIKELY RANGE", caption: confidenceCaption) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(depthFormatTime(ci.lo))
                        .font(.display(22, weight: .semibold))
                        .tracking(-0.5)
                        .foregroundStyle(Theme.txt)
                        .monospacedDigit()
                    Rectangle()
                        .fill(Theme.txt.opacity(0.35))
                        .frame(width: 14, height: 1.5)
                        .offset(y: -5)
                    Text(depthFormatTime(ci.hi))
                        .font(.display(22, weight: .semibold))
                        .tracking(-0.5)
                        .foregroundStyle(Theme.txt)
                        .monospacedDigit()
                    Spacer()
                    if !pctText.isEmpty {
                        Text(pctText)
                            .font(.body(10.5, weight: .extraBold))
                            .tracking(0.8)
                            .foregroundStyle(Theme.mute)
                    }
                }
                if let label = summary.confidenceLabel, !label.descriptor.isEmpty {
                    Text(label.descriptor.prefix(1).capitalized + label.descriptor.dropFirst())
                        .font(.body(12))
                        .foregroundStyle(Theme.txt.opacity(0.55))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .depthTile()
        }
    }

    /// Caption under the LIKELY RANGE label · prefers the server confidence
    /// word ("HIGH confidence"), else a plain framing.
    private var confidenceCaption: String {
        if let w = summary.confidenceLabel?.word, !w.isEmpty {
            return "\(w.capitalized) confidence"
        }
        return "Where you'd likely finish"
    }

    // ── 3 · SAFE TARGET (B-goal) ──────────────────────────────────────────

    private func safeTargetSection(_ safe: Int) -> some View {
        depthSection("SAFE TARGET", caption: "The honest fallback if the day goes sideways") {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Safe")
                        .font(.body(11, weight: .extraBold))
                        .tracking(0.6)
                        .foregroundStyle(Theme.txt.opacity(0.6))
                    Text(depthFormatTime(safe))
                        .font(.display(24, weight: .semibold))
                        .tracking(-0.5)
                        .foregroundStyle(Theme.txt)
                        .monospacedDigit()
                }
                Spacer()
                if let goal = summary.goalSec, goal > 0 {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("Goal")
                            .font(.body(11, weight: .extraBold))
                            .tracking(0.6)
                            .foregroundStyle(Theme.txt.opacity(0.6))
                        Text(depthFormatTime(goal))
                            .font(.display(24, weight: .semibold))
                            .tracking(-0.5)
                            .foregroundStyle(Theme.goal)
                            .monospacedDigit()
                    }
                }
            }
            .depthTile()
        }
    }

    // ── 4 · WHAT'S THE GAP MADE OF (self-contained · keep-or-cut) ─────────
    //
    // The decomposition of the today→goal gap into its server-computed chunks.
    // Web dropped this from the steady view in favor of the trajectory hero;
    // kept here behind a real-signal guard so it never shows an all-zero
    // breakdown. Easily removable: delete this section + hasGapBreakdown.

    private struct GapChunk: Identifiable {
        let id = UUID()
        let label: String
        let sec: Int
        let color: Color
    }

    /// The chunks, in the order the runner thinks about them. Fitness is the
    /// trainable bulk; conditions/course are the course-day tax; execution is
    /// the pacing buffer. Only chunks with a non-trivial magnitude show.
    private var gapChunks: [GapChunk] {
        var out: [GapChunk] = []
        if summary.fitnessSec > 0 {
            out.append(GapChunk(label: "Fitness", sec: summary.fitnessSec, color: Theme.race))
        }
        if let cond = summary.conditionsImpactSec, cond > 0 {
            out.append(GapChunk(label: "Conditions", sec: cond, color: Theme.goal))
        }
        if let course = summary.courseImpactSec, course > 0 {
            out.append(GapChunk(label: "Course", sec: course, color: Theme.dist))
        }
        // Execution buffer always carries a value (defaults to 30s); show it
        // only when there's other signal to decompose against.
        if summary.executionBufferSec > 0 {
            out.append(GapChunk(label: "Execution", sec: summary.executionBufferSec, color: Theme.mute))
        }
        return out
    }

    /// Show only when there's a real story: more than one chunk, or one chunk
    /// that isn't just the default execution buffer.
    private var hasGapBreakdown: Bool {
        let chunks = gapChunks
        guard !chunks.isEmpty else { return false }
        let nonExecution = chunks.filter { $0.label != "Execution" }
        // A lone default execution buffer is not a story worth a section.
        if nonExecution.isEmpty { return false }
        return true
    }

    private var gapBreakdownSection: some View {
        let chunks = gapChunks
        let total = max(1, chunks.reduce(0) { $0 + $1.sec })
        return depthSection("WHAT'S THE GAP MADE OF", caption: "Today's projection minus the goal, broken down") {
            VStack(alignment: .leading, spacing: 14) {
                // Stacked proportion bar.
                GeometryReader { geo in
                    HStack(spacing: 2) {
                        ForEach(chunks) { ch in
                            ch.color.opacity(0.85)
                                .frame(width: max(3, geo.size.width * CGFloat(ch.sec) / CGFloat(total)))
                        }
                    }
                    .clipShape(Capsule())
                }
                .frame(height: 8)

                // Legend rows · color dot · label · m:ss.
                VStack(spacing: 0) {
                    ForEach(Array(chunks.enumerated()), id: \.element.id) { idx, ch in
                        if idx > 0 {
                            Rectangle()
                                .fill(Color.white.opacity(0.06))
                                .frame(height: 1)
                        }
                        HStack(spacing: 10) {
                            Circle()
                                .fill(ch.color)
                                .frame(width: 8, height: 8)
                            Text(ch.label)
                                .font(.body(12, weight: .semibold))
                                .foregroundStyle(Theme.txt.opacity(0.75))
                            Spacer()
                            Text(depthClock(ch.sec))
                                .font(.body(13, weight: .bold))
                                .foregroundStyle(Theme.txt)
                                .monospacedDigit()
                        }
                        .padding(.vertical, 9)
                    }
                }
            }
            .depthTile()
        }
    }

    // ── Shared section + tile chrome (matches TargetsView styling) ────────

    @ViewBuilder
    private func depthSection<C: View>(
        _ title: String,
        caption: String? = nil,
        @ViewBuilder content: () -> C
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                SpecLabel(text: title, size: 11, tracking: 2, color: Theme.txt.opacity(0.6))
                if let caption {
                    Text(caption)
                        .font(.body(11))
                        .foregroundStyle(Theme.txt.opacity(0.4))
                }
            }
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Tile chrome (matches the hero card's surface language)

private extension View {
    /// Tile body matching the projection card · 0x11141A fill, white-opacity
    /// hairline, 18px inset, 18 radius (a notch tighter than the hero's 22 so
    /// the supporting tiles read as secondary).
    func depthTile() -> some View {
        self
            .padding(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
            .background(Theme.card)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(Color.white.opacity(0.08), lineWidth: 1)
            )
    }
}
