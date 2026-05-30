//
//  Heatmap.swift
//  Consistency heatmap · 18 cols × 7 rows of colored cells. Hover/tap shows
//  the day's pill ("May 28 · 8.0 mi · Tempo" / "Rest day"). Used on Activity.
//

import SwiftUI

struct HeatmapDay: Hashable {
    let date: Date
    /// 0 = no run; 1..4 = increasing volume buckets
    let intensity: Int
    let label: String  // pre-rendered "May 28 · 8.0 mi · Tempo" or "Rest day"
}

struct Heatmap: View {
    /// Days arranged column-major (oldest col first; within column oldest-day first).
    let columns: [[HeatmapDay]]
    @Binding var tooltip: String?

    var body: some View {
        HStack(alignment: .top, spacing: 3) {
            ForEach(Array(columns.enumerated()), id: \.offset) { _, col in
                VStack(spacing: 3) {
                    ForEach(col, id: \.self) { d in
                        Rectangle()
                            .fill(color(d.intensity))
                            .aspectRatio(1, contentMode: .fit)
                            .clipShape(RoundedRectangle(cornerRadius: 3, style: .continuous))
                            .onTapGesture { tooltip = d.label }
                    }
                }
                .frame(maxWidth: .infinity)
            }
        }
    }

    private func color(_ i: Int) -> Color {
        switch i {
        case 0:  return Color.white.opacity(0.06)
        case 1:  return Color(hex: 0x1F6F7A)
        case 2:  return Color(hex: 0x2F9A7E)
        case 3:  return Color(hex: 0xE0913A)
        default: return Color(hex: 0xEF6038)
        }
    }
}
