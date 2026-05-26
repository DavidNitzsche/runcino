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
    @State private var loading = true

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Text("faff").font(.display(26)).tracking(1.2).foregroundStyle(Theme.ink)
                    Spacer()
                    if let mode = briefing?.mode {
                        Text(mode.uppercased())
                            .font(.body(10, weight: .bold)).tracking(1.4)
                            .foregroundStyle(phaseColor(mode))
                            .padding(.horizontal, 10).padding(.vertical, 4)
                            .background(phaseColor(mode).opacity(0.12))
                            .overlay(Capsule().stroke(phaseColor(mode).opacity(0.35), lineWidth: 1))
                            .clipShape(Capsule())
                    }
                }
                .padding(.horizontal, 24).padding(.top, 8)

                Text("TRAINING").font(.display(48)).tracking(0.5).foregroundStyle(Theme.ink)
                    .padding(.horizontal, 24)

                if loading {
                    HStack { Spacer(); ProgressView().tint(Theme.green); Spacer() }.padding(40)
                } else {
                    // 1) Week strip — the schedule itself, clickable per day.
                    if let week = planWeek, !week.days.isEmpty {
                        WeekStripView(week: week)
                    }

                    // 2) Coach voice on the phase / training arc.
                    if let briefing {
                        CoachBlock(
                            lead: briefing.lead, voice: briefing.voice,
                            briefingId: "training|\(briefing.mode)",
                            askPrompt: "Tracking the plan."
                        )
                        VStack(spacing: 10) {
                            ForEach(Array(briefing.topics.enumerated()), id: \.offset) { _, topic in
                                TopicRenderer(topic: topic)
                            }
                        }
                        .padding(.horizontal, 24)
                    } else {
                        Text("Coach voice pending sync. Pull to refresh.")
                            .font(.body(13)).foregroundStyle(Theme.mute)
                            .padding(.horizontal, 24)
                    }
                }
            }
            .padding(.bottom, 40)
        }
        .background(Theme.bg.ignoresSafeArea())
        .task { await loadAll() }
        .refreshable { await loadAll() }
    }

    private func loadAll() async {
        loading = true
        defer { loading = false }
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
