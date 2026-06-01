//
//  C_CoachTransparency.swift
//  Family C · Coach transparency components.
//
//  Components: CoachActivityTimeline · WhatChangedExpander ·
//              AdaptationCard · StateChangeToast.
//
//  Three densities of the same data source (coach_intents):
//   · AdaptationCard       — single most-recent row on Today (24h window)
//   · WhatChangedExpander  — count + recent plan_adapt_* rows on Plan
//   · CoachActivityTimeline — full history on Profile
//
//  Severity drives color:
//   · info     → mint  (small left bar)
//   · warn     → goal  (amber)
//   · override → over  (red)
//

import SwiftUI

// MARK: - Severity helpers

extension CoachIntentSeverity {
    var color: Color {
        switch self {
        case .info:     return Theme.Accent.mintReady
        case .warn:     return Theme.goal
        case .override: return Theme.over
        }
    }
}

// MARK: - CoachActivityTimeline
//
// Vertical timeline with one row per intent. Severity colored left-bar.
// Tap-target the whole row in case we add detail expansion later.

struct CoachActivityTimeline: View {
    let intents: [CoachIntent]?    // nil → loading
    var emptyTitle: String = "No coach activity yet. Decisions show up here as Faff adapts your plan."

    var body: some View {
        if let rows = intents {
            if rows.isEmpty {
                emptyState
            } else {
                VStack(spacing: 0) {
                    ForEach(rows) { r in
                        row(r)
                        if r.id != rows.last?.id {
                            Divider().background(Color.white.opacity(0.06))
                                .padding(.leading, 16)
                        }
                    }
                }
                .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
            }
        } else {
            loadingState
        }
    }

    private func row(_ r: CoachIntent) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Rectangle()
                .fill(r.severity.color)
                .frame(width: 3)
                .frame(maxHeight: .infinity)
            VStack(alignment: .leading, spacing: 4) {
                Text(formatWhen(r.when_iso))
                    .font(.body(10, weight: .extraBold))
                    .tracking(1.4).textCase(.uppercase)
                    .foregroundStyle(Theme.mute)
                Text(r.summary)
                    .font(.body(13, weight: .semibold))
                    .foregroundStyle(Theme.txt)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.vertical, 12)
            Spacer(minLength: 8)
        }
        .padding(.trailing, 14)
    }

    private var emptyState: some View {
        HStack(spacing: 10) {
            Image(systemName: "clock")
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(Theme.mute)
            Text(emptyTitle)
                .font(.body(12.5, weight: .medium))
                .foregroundStyle(Theme.mute)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
    }

    private var loadingState: some View {
        VStack(spacing: 0) {
            ForEach(0..<3, id: \.self) { _ in
                HStack(alignment: .top, spacing: 12) {
                    Rectangle().fill(Color.white.opacity(0.08)).frame(width: 3)
                    VStack(alignment: .leading, spacing: 4) {
                        RoundedRectangle(cornerRadius: 4)
                            .fill(Color.white.opacity(0.08))
                            .frame(width: 80, height: 10)
                        RoundedRectangle(cornerRadius: 4)
                            .fill(Color.white.opacity(0.08))
                            .frame(maxWidth: .infinity).frame(height: 14)
                    }
                    .padding(.vertical, 12)
                }
                .padding(.trailing, 14)
            }
        }
        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
    }

    private func formatWhen(_ iso: String) -> String {
        let isoFmt = ISO8601DateFormatter()
        isoFmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let cleaned = iso.replacingOccurrences(of: " ", with: "T")
        guard let d = isoFmt.date(from: cleaned) ?? isoFmt.date(from: cleaned + "Z") else { return iso }
        let df = DateFormatter()
        df.dateFormat = "MMM d · h:mm a"
        return df.string(from: d)
    }
}

// MARK: - WhatChangedExpander
//
// Collapsed by default · a count pill that opens the recent plan_adapt_*
// rows. Same data as CoachActivityTimeline, scoped to plan changes only.

struct WhatChangedExpander: View {
    let intents: [CoachIntent]?    // already filtered to plan_adapt_*
    @State private var open: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button { withAnimation(Theme.Motion.smooth) { open.toggle() } } label: {
                HStack(spacing: 11) {
                    if let count = intents?.count {
                        Text("\(count)")
                            .font(.display(13, weight: .bold)).monospacedDigit()
                            .foregroundStyle(Theme.txt)
                            .frame(width: 24, height: 24)
                            .background(Theme.Accent.mintReady.opacity(0.18), in: Circle())
                            .overlay(Circle().stroke(Theme.Accent.mintReady.opacity(0.45), lineWidth: 1))
                    } else {
                        Circle().fill(Color.white.opacity(0.08)).frame(width: 24, height: 24)
                    }
                    Text(label)
                        .font(.body(13, weight: .semibold))
                        .foregroundStyle(Theme.txt)
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Theme.mute)
                        .rotationEffect(.degrees(open ? 180 : 0))
                }
                .padding(.horizontal, 16).padding(.vertical, 14)
            }
            .buttonStyle(.plain)
            if open, let rows = intents, !rows.isEmpty {
                Divider().background(Color.white.opacity(0.06))
                CoachActivityTimeline(intents: rows)
                    .padding(.horizontal, 8).padding(.vertical, 8)
                    .background(Color.black.opacity(0.15))
            }
        }
        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
    }

    private var label: String {
        let n = intents?.count ?? 0
        if n == 0 { return "No plan adjustments this week." }
        if n == 1 { return "Plan adjustment this week" }
        return "Plan adjustments this week"
    }
}

// MARK: - AdaptationCard
//
// Surfaces on Today only when an adaptation just fired (last 24h).
// Same data shape as the expander but as a single dismissible card with
// the most recent reason.

struct AdaptationCard: View {
    let intent: CoachIntent?       // nil → no card
    var onTapDetail: (() -> Void)? = nil

    var body: some View {
        if let i = intent {
            HStack(alignment: .top, spacing: 12) {
                Text("FAFF")
                    .font(.body(9, weight: .extraBold))
                    .tracking(1.6)
                    .foregroundStyle(Theme.bg)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(Theme.Accent.amberBright, in: Capsule())
                VStack(alignment: .leading, spacing: 6) {
                    Text(i.summary)
                        .font(.body(14, weight: .extraBold))
                        .foregroundStyle(Theme.txt)
                        .fixedSize(horizontal: false, vertical: true)
                    if let why = i.detail, !why.isEmpty {
                        Text(why)
                            .font(.body(12.5, weight: .medium))
                            .foregroundStyle(Theme.txt.opacity(0.85))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if onTapDetail != nil {
                        Button { onTapDetail?() } label: {
                            HStack(spacing: 4) {
                                Text("See what changed")
                                    .font(.body(11, weight: .extraBold))
                                    .tracking(0.5)
                                    .foregroundStyle(Theme.dist)
                                Image(systemName: "chevron.right")
                                    .font(.system(size: 9, weight: .bold))
                                    .foregroundStyle(Theme.dist)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(14)
            .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rCard, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.rCard, style: .continuous).stroke(i.severity.color.opacity(0.35), lineWidth: 1))
        } else {
            EmptyView()
        }
    }
}

// MARK: - StateChangeToast
//
// Surfaces a fitness baseline change after the race retro silently
// recalculates. The runner needs to connect "I logged my half" to
// "my paces moved".

struct StateChangeToast: View {
    enum Variant {
        case vdotBump(from: Int, to: Int)
        case lthrCalibrated(bpm: Int)
    }
    let variant: Variant

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(Theme.green)
            text
                .font(.body(12.5, weight: .medium))
                .foregroundStyle(Theme.txt)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 4)
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rChip, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.rChip, style: .continuous).stroke(Theme.green.opacity(0.35), lineWidth: 1))
    }

    private var icon: String {
        switch variant {
        case .vdotBump:         return "chart.line.uptrend.xyaxis"
        case .lthrCalibrated:   return "checkmark.seal.fill"
        }
    }
    private var text: Text {
        switch variant {
        case .vdotBump(let from, let to):
            return Text("VDOT updated ") +
                   Text("\(from) → \(to)").font(.body(12.5, weight: .extraBold)) +
                   Text(" from this race. Your paces will adjust.")
        case .lthrCalibrated(let bpm):
            return Text("LTHR recalibrated to ") +
                   Text("\(bpm) bpm").font(.body(12.5, weight: .extraBold)) +
                   Text(" from your finish HR.")
        }
    }
}
