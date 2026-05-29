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
        VStack(alignment: .leading, spacing: 0) {
            // DISPATCH header — matches CoachBlock so nothing jumps when
            // the real brief lands.
            HStack(spacing: 8) {
                RegistrationDot(tone: .green, size: 7)
                SpecLabel("DISPATCH", size: 10, tone: .green)
                Spacer()
                Stamp("COACH", tone: .mute)
            }
            .padding(.bottom, 12)
            Rectangle().fill(Theme.line).frame(height: 1)

            // Lead headline placeholder (one tall line, ~display-28)
            RoundedRectangle(cornerRadius: 2)
                .fill(Theme.ink.opacity(0.06))
                .frame(height: 28)
                .frame(maxWidth: .infinity)
                .padding(.top, 14)

            // Two paragraph lines worth of placeholder
            VStack(alignment: .leading, spacing: 8) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(Theme.ink.opacity(0.05))
                    .frame(height: 14)
                RoundedRectangle(cornerRadius: 2)
                    .fill(Theme.ink.opacity(0.05))
                    .frame(height: 14)
                    .padding(.trailing, 60)
            }
            .padding(.top, 14)
        }
        .padding(.horizontal, 24)
        .padding(.top, 20)
        .padding(.bottom, 22)
        .opacity(pulse ? 0.55 : 1.0)
        .onAppear {
            withAnimation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true)) {
                pulse.toggle()
            }
        }
    }
}
