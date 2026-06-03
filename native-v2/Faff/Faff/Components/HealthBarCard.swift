//
//  HealthBarCard.swift
//
//  Reusable bar-card component (`.mc` in the web prototype) used in
//  BODY · SLEEP · FORM sections of the Health page.
//
//  Two states:
//   - Collapsed (default): label + trend arrow, value + unit, 14-bar
//     mini-history, caption row (baseline / status word)
//   - Expanded (tap toggles): same header + a 28-day area+line chart,
//     "TARGET" label, axis labels (4W ago · 2W · TODAY), coach line
//
//  Scrub-on-chart interaction from the web prototype is deferred to v2
//  · the static chart still communicates trend + current. (Scrub adds
//  pointer/touch capture complexity that's not worth blocking V1 on.)
//
//  Per design_handoff_iphone_health_a · `.mc*` rules in health.css.
//
//  Created 2026-06-03 round 72.
//

import SwiftUI

/// Single bar-card metric · descriptive shape mirroring the seed in
/// health-lib.js. Backend wiring fills these from real health data;
/// for unwired metrics we render the seed as placeholder.
struct HealthMetric: Identifiable, Equatable {
    let id: String           // "hrv", "rhr", "vo2", etc
    let label: String        // "HRV", "RESTING HR"
    let value: String        // formatted display ("52", "1:08" for clock)
    let unit: String?        // " ms" / " bpm" / nil
    let history: [Double]    // 14 most recent values (oldest → newest) for mini-bars
    let chart28: [Double]    // 28-day series for expanded chart
    let target: Double?      // target threshold (nil if metric has no target)
    let status: Status       // good / warn / bad / neutral
    let direction: Direction // up / down / flat (trend arrow)
    let caption: String      // "baseline 58" / "target 1:15" / "30-day"
    let coach: String        // one-line coach voice for expanded state

    enum Status: String {
        case good, warn, bad, neutral
        var color: Color {
            switch self {
            case .good:    return Color(hex: 0x5fd06a)
            case .warn:    return Color(hex: 0xF3AD38)
            case .bad:     return Color(hex: 0xFC4D64)
            case .neutral: return Color(hex: 0x8A90A0)
            }
        }
        var word: String {
            switch self {
            case .good:    return "on target"
            case .warn:    return "watching"
            case .bad:     return "below target"
            case .neutral: return "—"
            }
        }
    }

    enum Direction { case up, down, flat
        var glyph: String {
            switch self { case .up: return "↑"; case .down: return "↓"; case .flat: return "→" }
        }
    }
}

/// Card variant · controls the value-font size + bar height. .big is
/// used by the SLEEP section per the brief (38pt values + 62pt bars).
enum HealthBarCardVariant { case standard, big }

struct HealthBarCard: View {
    let metric: HealthMetric
    var variant: HealthBarCardVariant = .standard

    @State private var expanded: Bool = false

    private var valueFont: Font {
        variant == .big ? .display(38, weight: .bold) : .display(32, weight: .bold)
    }
    private var barsHeight: CGFloat { variant == .big ? 62 : 44 }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            valueRow
            miniBars
            captionRow
            if expanded {
                expandedDetail
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 14)
        .padding(.bottom, 12)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color(red: 0.016, green: 0.071, blue: 0.063).opacity(0.40))
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(Color.white.opacity(expanded ? 0.16 : 0.09), lineWidth: 1)
                )
        )
        .contentShape(Rectangle())
        .onTapGesture {
            withAnimation(.easeOut(duration: 0.22)) {
                expanded.toggle()
            }
        }
    }

    // MARK: - Header (label + trend)
    private var header: some View {
        HStack(spacing: 6) {
            Circle().fill(metric.status.color).frame(width: 6, height: 6)
            Text(metric.label)
                .font(.body(9.5, weight: .extraBold)).tracking(0.8)
                .foregroundStyle(Color.white.opacity(0.62))
            Spacer(minLength: 0)
            Text(metric.direction.glyph)
                .font(.body(12, weight: .bold))
                .foregroundStyle(metric.status.color)
        }
    }

    // MARK: - Value + unit
    private var valueRow: some View {
        HStack(alignment: .firstTextBaseline, spacing: 2) {
            Text(metric.value)
                .font(valueFont)
                .foregroundStyle(Color.white)
            if let u = metric.unit, !u.isEmpty {
                Text(u)
                    .font(.body(12, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.55))
            }
        }
    }

    // MARK: - 14-bar mini-history
    private var miniBars: some View {
        GeometryReader { geo in
            let count = min(14, metric.history.count)
            let total = max(1, count)
            // Range for height normalization
            let minV = (metric.history.suffix(count).min() ?? 0)
            let maxV = (metric.history.suffix(count).max() ?? 1)
            let span = max(0.0001, maxV - minV)
            let gap: CGFloat = 3
            let barW = max(2, (geo.size.width - CGFloat(total - 1) * gap) / CGFloat(total))
            HStack(alignment: .bottom, spacing: gap) {
                ForEach(0..<count, id: \.self) { i in
                    let v = metric.history.suffix(count)[metric.history.count - count + i]
                    let norm = CGFloat((v - minV) / span)
                    let h = max(4, norm * geo.size.height)
                    RoundedRectangle(cornerRadius: 1.5)
                        .fill(i == count - 1 ? metric.status.color : Color.white.opacity(0.16))
                        .frame(width: barW, height: h)
                }
            }
            // Target dashed line (right-edge anchored)
            .overlay(alignment: .leading) {
                if let target = metric.target {
                    let tNorm = CGFloat((target - minV) / span)
                    let y = geo.size.height - max(0, min(geo.size.height, tNorm * geo.size.height))
                    Path { p in
                        p.move(to: CGPoint(x: 0, y: y))
                        p.addLine(to: CGPoint(x: geo.size.width, y: y))
                    }
                    .stroke(Color.white.opacity(0.32), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                }
            }
        }
        .frame(height: barsHeight)
    }

    // MARK: - Caption row
    private var captionRow: some View {
        HStack {
            Text(metric.caption)
                .font(.body(10, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.55))
            Spacer(minLength: 0)
            Text(metric.status.word.uppercased())
                .font(.body(9.5, weight: .extraBold)).tracking(0.8)
                .foregroundStyle(metric.status.color)
        }
    }

    // MARK: - Expanded detail (28-day chart + coach line)
    private var expandedDetail: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Target label
            if metric.target != nil {
                Text("TARGET \(metric.caption.uppercased())")
                    .font(.body(9, weight: .extraBold)).tracking(1.0)
                    .foregroundStyle(Color.white.opacity(0.50))
                    .padding(.top, 6)
            }
            // 28-day area + line chart
            ChartArea(values: metric.chart28, target: metric.target, color: metric.status.color)
                .frame(height: 132)
                .padding(.vertical, 4)
            // X-axis labels
            HStack {
                Text("4 WEEKS AGO")
                Spacer()
                Text("2W")
                Spacer()
                Text("TODAY")
            }
            .font(.body(8.5, weight: .extraBold)).tracking(0.6)
            .foregroundStyle(Color.white.opacity(0.42))
            // Coach line
            Text(metric.coach)
                .font(.body(12.5, weight: .medium))
                .foregroundStyle(Color.white.opacity(0.80))
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 4)
        }
    }
}

/// 28-day area+line chart · smoothed cubic between points + gradient
/// area fill + dashed target line + end-point dot. Scrub deferred to v2.
private struct ChartArea: View {
    let values: [Double]
    let target: Double?
    let color: Color

    var body: some View {
        GeometryReader { geo in
            chartContent(in: geo.size)
        }
    }

    /// Render the chart for a given size. Hoisted out of body so the
    /// inner `point` closure isn't fighting SwiftUI's @ViewBuilder
    /// resolution inside GeometryReader.
    @ViewBuilder
    private func chartContent(in size: CGSize) -> some View {
        let w = size.width
        let h = size.height
        let count = max(2, values.count)
        let pad: CGFloat = 4
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
            Path { p in
                p.move(to: CGPoint(x: pad, y: h - pad))
                for i in 0..<count { p.addLine(to: pt(i)) }
                p.addLine(to: CGPoint(x: w - pad, y: h - pad))
                p.closeSubpath()
            }
            .fill(
                LinearGradient(
                    colors: [color.opacity(0.35), color.opacity(0.02)],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
            Path { p in
                p.move(to: pt(0))
                for i in 1..<count { p.addLine(to: pt(i)) }
            }
            .stroke(Color.white, style: StrokeStyle(lineWidth: 2.2, lineCap: .round, lineJoin: .round))
            if let target {
                let tNorm = CGFloat((target - minV) / span)
                let y = h - pad - tNorm * (h - pad * 2)
                Path { p in
                    p.move(to: CGPoint(x: pad, y: y))
                    p.addLine(to: CGPoint(x: w - pad, y: y))
                }
                .stroke(color.opacity(0.55), style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
            }
            Circle()
                .fill(color)
                .frame(width: 8, height: 8)
                .position(pt(count - 1))
        }
    }
}
