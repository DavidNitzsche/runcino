//
//  HealthMetricSheet.swift
//
//  Bottom sheet for an expanded HealthMetric · opens when a bar-card
//  is tapped. Replaces the in-place expansion (round 72-77) which
//  pushed row neighbors into an awkward L-shape.
//
//  Per David round 78: "lets have it open horizontal instead of
//  vertical... or better yet, maybe its a panel that slides up from
//  the bottom · more room, better way to present info."
//
//  Surface: drag handle · metric label + status dot · big value +
//  unit · target eyebrow · 28-day area+line chart (bigger than the
//  inline version) · X-axis labels · coach line · context caption.
//
//  Created 2026-06-03 round 78.
//

import SwiftUI

struct HealthMetricSheet: View {
    let metric: HealthMetric
    let onDismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Drag handle
            Capsule()
                .fill(Color.white.opacity(0.28))
                .frame(width: 44, height: 4)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.top, 10)
                .padding(.bottom, 18)

            VStack(alignment: .leading, spacing: 16) {
                // Header · status dot + label + trend arrow
                HStack(spacing: 8) {
                    Circle().fill(metric.status.color).frame(width: 8, height: 8)
                    Text(metric.label)
                        .font(.body(12, weight: .extraBold)).tracking(1.0)
                        .foregroundStyle(Color.white.opacity(0.78))
                    Spacer(minLength: 0)
                    Text(metric.direction.glyph)
                        .font(.body(14, weight: .bold))
                        .foregroundStyle(metric.status.color)
                }

                // Hero value
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(metric.value)
                        .font(.display(72, weight: .bold))
                        .tracking(-1.5)
                        .foregroundStyle(.white)
                    if let u = metric.unit, !u.isEmpty {
                        Text(u.trimmingCharacters(in: .whitespaces))
                            .font(.body(20, weight: .semibold))
                            .foregroundStyle(Color.white.opacity(0.55))
                    }
                }

                // Status line · caption + status word
                HStack {
                    Text(metric.caption)
                        .font(.body(13, weight: .semibold))
                        .foregroundStyle(Color.white.opacity(0.66))
                    Spacer(minLength: 0)
                    Text(metric.status.word.uppercased())
                        .font(.body(11, weight: .extraBold)).tracking(1.0)
                        .foregroundStyle(metric.status.color)
                }

                // Target eyebrow (when metric has one).
                // 2026-06-03 round 79 · use caption directly uppercased ·
                // it already says "target 1:15" / "aim 235" / "baseline
                // 58" so prepending "TARGET " yielded "TARGET TARGET
                // 1:15." Just uppercase what we have.
                if metric.target != nil {
                    Text(metric.caption.uppercased())
                        .font(.body(10, weight: .extraBold)).tracking(1.2)
                        .foregroundStyle(Color.white.opacity(0.45))
                        .padding(.top, 4)
                }

                // 28-day area + line chart
                MetricChart(values: metric.chart28, target: metric.target, color: metric.status.color)
                    .frame(height: 180)
                    .padding(.top, 4)

                // X-axis labels
                HStack {
                    Text("4 WEEKS AGO")
                    Spacer()
                    Text("2W")
                    Spacer()
                    Text("TODAY")
                }
                .font(.body(9.5, weight: .extraBold)).tracking(0.8)
                .foregroundStyle(Color.white.opacity(0.42))

                // Coach line
                Text(metric.coach)
                    .font(.body(14, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.85))
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 8)

                Spacer(minLength: 24)
            }
            .padding(.horizontal, 22)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color(hex: 0x0A4540))
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.hidden)   // we render our own
        .presentationBackground(Color(hex: 0x0A4540))
    }
}

/// 28-day area+line chart for the metric sheet · larger than the
/// inline HealthBarCard chart. Smoothed line + status-color gradient
/// fill + dashed target line + end-point dot.
private struct MetricChart: View {
    let values: [Double]
    let target: Double?
    let color: Color

    var body: some View {
        GeometryReader { geo in
            chartContent(in: geo.size)
        }
    }

    @ViewBuilder
    private func chartContent(in size: CGSize) -> some View {
        let w = size.width
        let h = size.height
        let count = max(2, values.count)
        let pad: CGFloat = 6
        let minV = (values.min() ?? 0) - 0.05 * abs(values.min() ?? 1)
        let maxV = (values.max() ?? 1) + 0.05 * abs(values.max() ?? 1)
        let span = max(0.0001, maxV - minV)
        let stepX = (w - pad * 2) / CGFloat(count - 1)
        let pt: (Int) -> CGPoint = { i in
            let v = i < values.count ? values[i] : (values.last ?? 0)
            let norm = CGFloat((v - minV) / span)
            let x = pad + CGFloat(i) * stepX
            let y = h - pad - norm * (h - pad * 2)
            return CGPoint(x: x, y: y)
        }
        ZStack {
            // Area fill
            Path { p in
                p.move(to: CGPoint(x: pad, y: h - pad))
                for i in 0..<count { p.addLine(to: pt(i)) }
                p.addLine(to: CGPoint(x: w - pad, y: h - pad))
                p.closeSubpath()
            }
            .fill(
                LinearGradient(
                    colors: [color.opacity(0.40), color.opacity(0.02)],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
            // Line
            Path { p in
                p.move(to: pt(0))
                for i in 1..<count { p.addLine(to: pt(i)) }
            }
            .stroke(Color.white, style: StrokeStyle(lineWidth: 2.4, lineCap: .round, lineJoin: .round))
            // Target dashed line
            if let target {
                let tNorm = CGFloat((target - minV) / span)
                let y = h - pad - tNorm * (h - pad * 2)
                Path { p in
                    p.move(to: CGPoint(x: pad, y: y))
                    p.addLine(to: CGPoint(x: w - pad, y: y))
                }
                .stroke(color.opacity(0.55), style: StrokeStyle(lineWidth: 1, dash: [5, 5]))
            }
            // End dot
            Circle()
                .fill(color)
                .frame(width: 10, height: 10)
                .position(pt(count - 1))
        }
    }
}
