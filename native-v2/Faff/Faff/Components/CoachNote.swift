//
//  CoachNote.swift
//  Coach card with pill tag + body paragraph.
//  Used on: planned, rundetail, nudge, weekly, pr, withinreach, raceday.
//

import SwiftUI

struct CoachNote: View {
    let message: String
    var tag: String = "Faff Coach"
    var accent: Color = Theme.race
    /// Background card style. `.note` blends into a parent. `.tile` is the
    /// glass-card variant used on detail screens.
    var style: Style = .note

    enum Style { case note, tile }

    private var inner: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text(tag)
                .font(.label(10)).tracking(1.5).textCase(.uppercase)
                .foregroundStyle(accent)
            Text(message)
                .font(.body(14.5, weight: .medium))
                .foregroundStyle(Theme.txt.opacity(0.92))
                .fixedSize(horizontal: false, vertical: true)
                .lineSpacing(3)
        }
    }

    @ViewBuilder
    var body: some View {
        switch style {
        case .note:
            inner
                .padding(.vertical, 18)
                .padding(.horizontal, 24)
        case .tile:
            GlassTile { inner }
        }
    }
}
