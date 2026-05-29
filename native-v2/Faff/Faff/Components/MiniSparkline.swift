//
//  MiniSparkline.swift
//
//  14-day inline trend line for BodyMetricCard. Mirrors the small
//  per-metric mini-chart pattern used on web-v2/app/health when the
//  card is in its compact rendering — a single thin polyline with a
//  faint baseline dot pattern. NOT the larger BarChart used in the
//  hero TrendCard slot; that one is the editorial visual.
//
//  Phase 25b · 2026-05-28 · iPhone /health v3 cutover.
//
//  Design intent:
//    · 14 datapoints (last fortnight) — enough for "trend" without
//      drowning out the headline value.
//    · One thin stroke + tiny end-dot. No fills, no gridlines.
//    · Mute Theme.line dashed baseline when caller supplies one
//      (e.g. RHR baseline · sleep target).
//    · Renders a "no data yet" dotted placeholder line when the
//      series is empty — per task constraint #5, never fabricate.
//
//  Theme rule: every color comes from Theme.*. No inline hex.
//

import SwiftUI

struct MiniSparkline: View {
    /// Last-14 (or fewer) values to chart. Pass [] for placeholder.
    let values: [Double]
    /// Stroke color — match the parent BodyMetricCard's accent
    /// (Theme.goal for sleep, Theme.green for HRV, etc.).
    let color: Color
    /// Optional value-axis clamp. When nil, auto-fits to series.
    var minValue: Double? = nil
    var maxValue: Double? = nil
    /// Optional dashed reference line (baseline / target) drawn
    /// across the chart at this value. Hidden if out of range.
    var baseline: Double? = nil

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let h = geo.size.height
            // Render placeholder when there's not enough signal.
            // Per constraint #5, dotted line — never a fake series.
            if values.count < 2 {
                placeholderLine(width: w, height: h)
            } else {
                let lo = minValue ?? (values.min() ?? 0)
                let hi = maxValue ?? (values.max() ?? 1)
                let range = Swift.max(0.001, hi - lo)
                let stepX = w / CGFloat(values.count - 1)

                ZStack(alignment: .topLeading) {
                    // Optional dashed baseline reference.
                    if let b = baseline, b >= lo, b <= hi {
                        let y = h * (1 - CGFloat((b - lo) / range))
                        Path { p in
                            p.move(to: CGPoint(x: 0, y: y))
                            p.addLine(to: CGPoint(x: w, y: y))
                        }
                        .stroke(Theme.line, style: StrokeStyle(lineWidth: 1, dash: [2, 3]))
                    }

                    // The trend polyline.
                    Path { p in
                        for (i, v) in values.enumerated() {
                            let clamped = Swift.min(hi, Swift.max(lo, v))
                            let x = CGFloat(i) * stepX
                            let y = h * (1 - CGFloat((clamped - lo) / range))
                            if i == 0 { p.move(to: CGPoint(x: x, y: y)) }
                            else      { p.addLine(to: CGPoint(x: x, y: y)) }
                        }
                    }
                    .stroke(color.opacity(0.85),
                            style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))

                    // End-dot — current value emphasized.
                    if let last = values.last {
                        let clamped = Swift.min(hi, Swift.max(lo, last))
                        let x = w
                        let y = h * (1 - CGFloat((clamped - lo) / range))
                        Circle()
                            .fill(color)
                            .frame(width: 4, height: 4)
                            .position(x: x - 2, y: y)
                    }
                }
            }
        }
    }

    /// Dotted placeholder line — communicates "trend pending" without
    /// faking values. Sits at the vertical center of the available box.
    @ViewBuilder
    private func placeholderLine(width w: CGFloat, height h: CGFloat) -> some View {
        Path { p in
            p.move(to: CGPoint(x: 0, y: h / 2))
            p.addLine(to: CGPoint(x: w, y: h / 2))
        }
        .stroke(Theme.mute.opacity(0.35),
                style: StrokeStyle(lineWidth: 1, dash: [1.5, 3]))
    }
}
