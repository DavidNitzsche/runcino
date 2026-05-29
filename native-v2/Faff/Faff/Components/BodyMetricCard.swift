//
//  BodyMetricCard.swift
//
//  Per-metric tile on /health: SLEEP · RHR · HRV · LOAD · CHECK-IN.
//  Mirrors the small-card recipe pattern called out in the v3 design:
//      eyebrow + big value + delta vs baseline + 14-day MiniSparkline.
//
//  Card surface matches the existing CardSurface (Theme.card · Theme.line
//  1pt · Theme.rCard radius) — same chrome the rest of the iPhone uses
//  so the page reads as one design system.
//
//  Phase 25b · 2026-05-28 · iPhone /health v3 cutover.
//
//  Delta-color rule (matches web /health TrendCard):
//    · favorable / no-flag        → Theme.green
//    · mildly off                 → Theme.goal
//    · over baseline (e.g. RHR)   → Theme.over
//  Caller chooses via the `deltaTone` enum.
//

import SwiftUI

enum BodyMetricDeltaTone {
    case green
    case amber
    case red
    case mute

    var color: Color {
        switch self {
        case .green: return Theme.green
        case .amber: return Theme.goal
        case .red:   return Theme.over
        case .mute:  return Theme.mute
        }
    }
}

struct BodyMetricCard: View {
    /// Caps-tracked top label · "SLEEP", "RHR", etc.
    let label: String
    /// Eyebrow color · usually the metric's brand accent
    /// (Theme.goal for sleep, Theme.over for RHR, Theme.green for HRV).
    let labelColor: Color
    /// Big number · "7.4", "52", "—".
    let value: String
    /// Tiny unit suffix beside the value · "h", "bpm", "ms". Empty hides.
    let unit: String
    /// One-line delta vs baseline · "+3 bpm vs 60D" / "-0.4h vs target".
    /// Colored by `deltaTone`. nil hides the row.
    let delta: String?
    let deltaTone: BodyMetricDeltaTone
    /// Sub-line below the sparkline · "BASELINE 49 · 60-DAY WINDOW" etc.
    let sub: String
    /// 14-day series for the trend line. Empty array renders the
    /// placeholder dotted line via MiniSparkline (per constraint #5).
    let series: [Double]
    /// Optional value-axis clamp for the sparkline.
    var seriesMin: Double? = nil
    var seriesMax: Double? = nil
    /// Optional dashed reference line on the sparkline.
    var sparkBaseline: Double? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Eyebrow caps label.
            Text(label)
                .font(.label(10)).tracking(1.6)
                .foregroundStyle(labelColor)

            // Big number + tiny unit.
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text(value)
                    .font(.display(40))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                if !unit.isEmpty {
                    Text(unit)
                        .font(.body(13, weight: .semibold))
                        .foregroundStyle(Theme.mute)
                }
            }

            // Delta line — colored by tone.
            if let delta {
                Text(delta)
                    .font(.body(11, weight: .semibold))
                    .foregroundStyle(deltaTone.color)
                    .fixedSize(horizontal: false, vertical: true)
            }

            // 14-day inline trend.
            MiniSparkline(
                values: series.suffix(14).map { $0 },
                color: labelColor,
                minValue: seriesMin,
                maxValue: seriesMax,
                baseline: sparkBaseline
            )
            .frame(height: 32)
            .padding(.top, 4)

            // Caps sub-line.
            Text(sub)
                .font(.label(9)).tracking(1.0)
                .foregroundStyle(Theme.mute)
                .fixedSize(horizontal: false, vertical: true)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(Theme.card)
        .overlay(
            RoundedRectangle(cornerRadius: Theme.rCard)
                .stroke(Theme.line, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
    }
}
