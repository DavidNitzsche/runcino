//
//  MiniTileGridView.swift
//
//  Mirrors web-v2/components/faff/MiniTileGrid.tsx (+ .module.css).
//
//  2-column grid of small dark cards · each tile carries:
//    · small caps label  ("SLEEP", "RHR", "HRV", "LOAD")
//    · big value         (Inter 700 tabular-nums)
//    · unit suffix       ("h", "bpm", "ms")
//    · meta line         ("7d avg", "+2 vs base", "sweet spot")
//    · status dot top-right (green / amber / over / dist / none)
//

import SwiftUI

struct MiniTileGridView: View {
    let tiles: [FaffMiniTile]
    var actionTileIndex: Int? = nil

    private let columns = [
        GridItem(.flexible(), spacing: 10),
        GridItem(.flexible(), spacing: 10),
    ]

    var body: some View {
        LazyVGrid(columns: columns, spacing: 10) {
            ForEach(0..<tiles.count, id: \.self) { i in
                tileView(tiles[i], isAction: i == actionTileIndex)
            }
        }
    }

    private func tileView(_ tile: FaffMiniTile, isAction: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            // Top row · label + status dot
            HStack(alignment: .top, spacing: 4) {
                Text(tile.label)
                    .font(.body(9, weight: .bold))
                    .tracking(1.6)
                    .foregroundStyle(Theme.mute)
                Spacer()
                if tile.dot != .none {
                    Circle()
                        .fill(dotColor(tile.dot))
                        .frame(width: 6, height: 6)
                        .padding(.top, 4)
                }
            }

            // Value + unit · baseline-aligned
            HStack(alignment: .lastTextBaseline, spacing: 4) {
                Text(tile.value)
                    .font(.body(22, weight: .bold))
                    .foregroundStyle(valueColor(tile.valueColor))
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                if let unit = tile.valueUnit {
                    Text(unit)
                        .font(.body(10, weight: .semibold))
                        .foregroundStyle(Theme.mute)
                }
            }

            // Meta line
            Text(tile.meta)
                .font(.body(10, weight: .medium))
                .foregroundStyle(Theme.mute)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(minHeight: 78, alignment: .topLeading)
        .background(Theme.card2)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(isAction ? Theme.goal.opacity(0.55) : Theme.line, lineWidth: isAction ? 1.5 : 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func dotColor(_ dot: FaffDotColor) -> Color {
        switch dot {
        case .green: return Theme.green
        case .amber: return Theme.goal
        case .over:  return Theme.over
        case .dist:  return Theme.dist
        case .none:  return .clear
        }
    }

    private func valueColor(_ v: FaffValueColor) -> Color {
        switch v {
        case .green: return Theme.green
        case .amber: return Theme.goal
        case .over:  return Theme.over
        case .race:  return Theme.race
        case .dist:  return Theme.dist
        case .default: return Theme.ink
        }
    }
}
