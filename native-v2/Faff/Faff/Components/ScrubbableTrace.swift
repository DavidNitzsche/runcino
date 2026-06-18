//
//  ScrubbableTrace.swift
//  Multi-metric scrubbable line chart with optional area fill + cursor.
//  Used on rundetail (pace/HR/elev/cadence) and Health focus chart.
//

import SwiftUI

struct ScrubbableTrace: View {
    /// Y values at evenly-spaced X positions.
    let points: [Double]
    /// Display labels for each point (for the scrub readout).
    var labels: [String] = []
    var color: Color = Color(hex: 0xE88021)
    var fill: Bool = true
    /// Optional horizontal target line value.
    var target: Double? = nil
    /// Optional band [lo, hi].
    var band: ClosedRange<Double>? = nil
    /// Bind a "scrub readout" string set when the user drags across the chart.
    @Binding var readout: String?

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let h = geo.size.height
            let lo = (band?.lowerBound ?? points.min() ?? 0) - (max(1e-6, (points.max() ?? 1) - (points.min() ?? 0))) * 0.06
            let hi = (band?.upperBound ?? points.max() ?? 1) + (max(1e-6, (points.max() ?? 1) - (points.min() ?? 0))) * 0.06
            let span = max(0.0001, hi - lo)
            let stepX = w / CGFloat(max(1, points.count - 1))

            ZStack {
                // Target / band
                if let t = target {
                    let y = (1 - CGFloat((t - lo) / span)) * h
                    Path { p in p.move(to: CGPoint(x: 0, y: y)); p.addLine(to: CGPoint(x: w, y: y)) }
                        .stroke(Color.white.opacity(0.4), style: StrokeStyle(lineWidth: 1, dash: [2, 4]))
                }
                if let b = band {
                    let y1 = (1 - CGFloat((b.upperBound - lo) / span)) * h
                    let y2 = (1 - CGFloat((b.lowerBound - lo) / span)) * h
                    Path { p in
                        p.addRect(CGRect(x: 0, y: y1, width: w, height: max(0, y2 - y1)))
                    }
                    .fill(color.opacity(0.12))
                }

                if fill {
                    fillPath(in: geo.size, lo: lo, hi: hi, stepX: stepX)
                        .fill(LinearGradient(colors: [color.opacity(0.34), color.opacity(0.0)],
                                             startPoint: .top, endPoint: .bottom))
                }
                tracePath(in: geo.size, lo: lo, hi: hi, stepX: stepX)
                    .stroke(Color.white, style: StrokeStyle(lineWidth: 2.6, lineCap: .round, lineJoin: .round))

                // Final dot
                if let last = points.last {
                    let lx = w
                    let ly = (1 - CGFloat((last - lo) / span)) * h
                    Circle().fill(color)
                        .frame(width: 9, height: 9)
                        .shadow(color: color, radius: 6)
                        .position(x: lx - 4, y: ly)
                }
            }
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { g in
                        let i = max(0, min(points.count - 1, Int((g.location.x / w) * CGFloat(points.count - 1) + 0.5)))
                        if i < labels.count {
                            readout = labels[i]
                        } else {
                            readout = String(format: "%.0f", points[i])
                        }
                    }
                    .onEnded { _ in readout = nil }
            )
        }
    }

    private func tracePath(in size: CGSize, lo: Double, hi: Double, stepX: CGFloat) -> Path {
        Path { p in
            let h = size.height
            let span = max(0.0001, hi - lo)
            for (i, v) in points.enumerated() {
                let x = CGFloat(i) * stepX
                let y = (1 - CGFloat((v - lo) / span)) * h
                if i == 0 { p.move(to: CGPoint(x: x, y: y)) } else { p.addLine(to: CGPoint(x: x, y: y)) }
            }
        }
    }

    private func fillPath(in size: CGSize, lo: Double, hi: Double, stepX: CGFloat) -> Path {
        Path { p in
            let h = size.height
            let span = max(0.0001, hi - lo)
            p.move(to: CGPoint(x: 0, y: h))
            for (i, v) in points.enumerated() {
                let x = CGFloat(i) * stepX
                let y = (1 - CGFloat((v - lo) / span)) * h
                p.addLine(to: CGPoint(x: x, y: y))
            }
            p.addLine(to: CGPoint(x: CGFloat(points.count - 1) * stepX, y: h))
            p.closeSubpath()
        }
    }
}
