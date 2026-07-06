//
//  MileBars.swift
//  Vertical bar chart of per-mile pace (or per-week mileage) · with optional
//  dashed target line + tap to read out the exact split. Used on rundetail,
//  completed, weekly.
//

import SwiftUI

struct MileBar: Identifiable, Hashable {
    let id: Int            // mile number (1-based)
    let value: Double      // pace seconds or mileage
    let label: String      // "6:33" or "48"
    var subLabel: String? = nil  // "146 bpm"
    var color: Color = Color(hex: 0xD03F3F)
    var isHighlight: Bool = false
}

struct MileBars: View {
    let bars: [MileBar]
    /// Domain min/max; if nil, derived from data.
    var domain: ClosedRange<Double>? = nil
    /// Target value (renders a dashed horizontal reference line).
    var target: Double? = nil
    /// External read-out binding — set when a bar is tapped, cleared on tap again.
    @Binding var readout: String?

    var body: some View {
        // Derived domain includes the target so the dashed reference line
        // always lands inside the chart (a work-pace target faster than
        // every split used to render off-chart). An explicit domain wins;
        // a target outside it simply isn't drawn.
        let values = bars.map(\.value) + (target.map { [$0] } ?? [])
        let lo = domain?.lowerBound ?? (values.min() ?? 0)
        let hi = domain?.upperBound ?? (values.max() ?? 1)
        let span = max(0.0001, hi - lo)

        GeometryReader { geo in
            let h = geo.size.height
            let barW = (geo.size.width - CGFloat(bars.count - 1) * 4) / CGFloat(bars.count)
            ZStack(alignment: .bottom) {
                if let t = target, t >= lo, t <= hi {
                    let ty = CGFloat((hi - t) / span) * (h - 18) + 9
                    Path { p in
                        p.move(to: CGPoint(x: 0, y: ty))
                        p.addLine(to: CGPoint(x: geo.size.width, y: ty))
                    }
                    .stroke(Color.white.opacity(0.42), style: StrokeStyle(lineWidth: 1, dash: [3, 4]))
                }
                HStack(alignment: .bottom, spacing: 4) {
                    ForEach(bars) { b in
                        let frac = (b.value - lo) / span
                        let bh = max(8, CGFloat(frac) * (h - 18))
                        VStack(spacing: 4) {
                            Rectangle()
                                .fill(b.color.opacity(b.isHighlight ? 1.0 : 0.86))
                                .frame(width: barW, height: bh)
                                .clipShape(RoundedRectangle(cornerRadius: 3, style: .continuous))
                                .onTapGesture {
                                    let line = "Mile \(b.id) · \(b.label)\(b.subLabel.map { " · \($0)" } ?? "")"
                                    readout = readout == line ? nil : line
                                }
                            Text("\(b.id)")
                                .font(.label(8.5)).tracking(0.5)
                                .foregroundStyle(Theme.txt.opacity(b.isHighlight ? 0.9 : 0.42))
                        }
                        .frame(width: barW)
                    }
                }
            }
        }
    }
}
