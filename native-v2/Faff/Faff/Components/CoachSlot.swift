//
//  CoachSlot.swift
//  Background-loading coach container — page chrome paints immediately
//  and this slot fills in once the brief arrives. NO page-blocking
//  ProgressView spinner.
//
//  Replaces the per-surface `if loading { ProgressView() } else if let
//  briefing { CoachBlock(...) }` pattern that made the iPhone feel like
//  it was "loading" the whole screen even when only the brief was
//  pending. Mirrors web-v2's BriefingLoader + Suspense pattern: real
//  data appears as it lands, no white wall in between.
//

import SwiftUI

struct CoachSlot: View {
    let briefing: Briefing?
    let surface: String                 // "today", "training", "health", etc.
    let askPrompt: String?              // nil suppresses the chip row
    var onCheckIn: ((CoachBlock.CheckInRating) async -> Bool)? = nil

    var body: some View {
        ZStack {
            if let briefing {
                CoachBlock(
                    lead: briefing.lead,
                    voice: briefing.voice,
                    briefingId: "\(briefing.surface)|\(briefing.mode)",
                    askPrompt: askPrompt,
                    onCheckIn: onCheckIn
                )
                .transition(.opacity.combined(with: .move(edge: .top)))
            } else {
                CoachSkeleton()
                    .transition(.opacity)
            }
        }
        .animation(.spring(response: 0.45, dampingFraction: 0.85), value: briefing?.lead)
    }
}

/// Matched-shape skeleton — same vertical rhythm as the real CoachBlock
/// so the page doesn't jump when content snaps in. Subtle shimmer keeps
/// it from looking dead while the brief is in flight.
private struct CoachSkeleton: View {
    @State private var pulse = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                Circle().fill(Theme.green.opacity(0.4)).frame(width: 6, height: 6)
                Text("COACH").font(.label(10)).tracking(1.6)
                    .foregroundStyle(Theme.green.opacity(0.55))
            }

            // Lead headline placeholder (one tall line, ~display-32)
            RoundedRectangle(cornerRadius: 6)
                .fill(Theme.ink.opacity(0.06))
                .frame(height: 32)
                .frame(maxWidth: .infinity)

            // Two paragraph lines worth of placeholder
            VStack(alignment: .leading, spacing: 8) {
                RoundedRectangle(cornerRadius: 4)
                    .fill(Theme.ink.opacity(0.05))
                    .frame(height: 14)
                RoundedRectangle(cornerRadius: 4)
                    .fill(Theme.ink.opacity(0.05))
                    .frame(height: 14)
                    .frame(maxWidth: .infinity * 0.7, alignment: .leading)
                    .padding(.trailing, 60)
            }
        }
        .padding(.horizontal, 24)
        .padding(.top, 22)
        .padding(.bottom, 22)
        .opacity(pulse ? 0.55 : 1.0)
        .onAppear {
            withAnimation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true)) {
                pulse.toggle()
            }
        }
    }
}
