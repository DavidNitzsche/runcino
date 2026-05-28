//
//  SiblingCard.swift
//
//  Mirrors web-v2/components/faff/Sibling.tsx (+ Sibling.module.css).
//
//  Dark dashboard card next to the Poster · two-piece title (Oswald
//  display + Inter caps-tracked suffix), optional prose line, then
//  the 2x2 MiniTileGrid below.
//

import SwiftUI

struct SiblingCard: View {
    let payload: SiblingPayload

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // TITLE row · "THE BODY · TODAY"
            HStack(alignment: .lastTextBaseline, spacing: 8) {
                Text(payload.title.main)
                    .displayRecipe(size: 24)
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                if let suffix = payload.title.suffix {
                    Text(suffix)
                        .font(.body(9, weight: .bold))
                        .tracking(1.6)
                        .foregroundStyle(Theme.mute)
                }
                Spacer()
            }
            .padding(.bottom, 16)

            // PROSE · Inter 500 12.5pt at 82% ink
            if let prose = payload.prose {
                Text(prose)
                    .font(.body(12.5, weight: .medium))
                    .foregroundStyle(Theme.ink.opacity(0.82))
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.bottom, 18)
            }

            // MINI TILE GRID · 2-column
            MiniTileGridView(
                tiles: payload.tiles,
                actionTileIndex: payload.actionTileIndex
            )
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card)
        .overlay(
            RoundedRectangle(cornerRadius: Theme.rCard)
                .stroke(Theme.line, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
    }
}
