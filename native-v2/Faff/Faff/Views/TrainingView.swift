//
//  TrainingView.swift
//
//  iPhone TRAINING tab — week-by-week schedule. Lead with the structured
//  week strip (tap any day to preview), then the phase chip + coach
//  prose. The strip is the answer to "I have no way to see the schedule
//  on the phone."
//

import SwiftUI

struct TrainingView: View {
    @State private var briefing: Briefing?
    @State private var planWeek: PlanWeek?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                // Background-load pattern: page chrome paints immediately,
                // each section snaps in as data lands.

                // 1) Week strip — the schedule itself, clickable per day.
                if let week = planWeek, !week.days.isEmpty {
                    WeekStripView(week: week)
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }

                // 2) Coach voice on the phase / training arc.
                CoachSlot(
                    briefing: briefing,
                    surface: "training",
                    askPrompt: nil   // no chips on /training
                )

                if let briefing, !briefing.topics.isEmpty {
                    VStack(spacing: 10) {
                        ForEach(Array(briefing.topics.enumerated()), id: \.offset) { _, topic in
                            TopicRenderer(topic: topic)
                        }
                    }
                    .padding(.horizontal, 24)
                    .transition(.opacity)
                }
                }
                .padding(.bottom, 40)
                .animation(.spring(response: 0.45, dampingFraction: 0.85), value: planWeek?.days.count)
                .animation(.spring(response: 0.45, dampingFraction: 0.85), value: briefing?.lead)
            }
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle("Training")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                if let mode = briefing?.mode {
                    ToolbarItem(placement: .topBarTrailing) {
                        Text(mode.uppercased())
                            .font(.label(10)).tracking(1.4)
                            .foregroundStyle(phaseColor(mode))
                            .padding(.horizontal, 10).padding(.vertical, 4)
                            .background(phaseColor(mode).opacity(0.12))
                            .overlay(Capsule().stroke(phaseColor(mode).opacity(0.35), lineWidth: 1))
                            .clipShape(Capsule())
                    }
                }
            }
            .task { await loadAll() }
            .refreshable { await loadAll() }
        }
    }

    private func loadAll() async {
        async let bRes = (try? await API.briefing(surface: "training"))
        async let pRes = (try? await API.fetchPlanWeek())
        briefing = await bRes
        planWeek = await pRes
    }

    private func phaseColor(_ phase: String) -> Color {
        switch phase.lowercased() {
        case "taper": return Theme.goal
        case "race":  return Theme.race
        case "peak":  return Theme.learn
        default:      return Theme.green
        }
    }
}
