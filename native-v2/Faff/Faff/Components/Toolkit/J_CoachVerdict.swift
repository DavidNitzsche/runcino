//
//  J_CoachVerdict.swift
//  Family J · Coach verdict & narration.
//
//  Components: CitationChip.
//
//  RunPurposeCard + RunRecapCard already live in TodayView /
//  RunDetailView · this file holds the shared atoms that family uses.
//

import SwiftUI

// MARK: - CitationChip
//
// Atom · the deep-link into the Learn reader. Build once, reuse wherever
// the coach cites doctrine.

struct CitationChip: View {
    let label: String
    let slug: String

    var body: some View {
        NavigationLink(value: FaffRoute.learn(slug: slug)) {
            HStack(spacing: 4) {
                Text(label)
                    .font(.body(11, weight: .extraBold)).tracking(0.4)
                    .foregroundStyle(Theme.txt)
                Image(systemName: "chevron.right")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(Theme.mute)
            }
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(Theme.Glass.fill, in: Capsule())
            .overlay(Capsule().stroke(Theme.Glass.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

struct CitationRow: View {
    let citations: [(label: String, slug: String)]

    var body: some View {
        if citations.isEmpty { EmptyView() }
        else {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(Array(citations.enumerated()), id: \.offset) { _, c in
                        CitationChip(label: c.label, slug: c.slug)
                    }
                }
            }
        }
    }
}

