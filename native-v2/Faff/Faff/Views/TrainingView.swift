//
//  TrainingView.swift  (P5 — iOS parity for /training)
//  Coach voice for the current phase + cards lane.
//

import SwiftUI

struct TrainingView: View {
    @State private var briefing: Briefing?
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
                } else if let briefing {
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
            .padding(.bottom, 40)
        }
        .background(Theme.bg.ignoresSafeArea())
        .task {
            loading = true; defer { loading = false }
            briefing = try? await API.briefing(surface: "training")
        }
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
