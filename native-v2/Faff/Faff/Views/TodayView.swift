//
//  TodayView.swift
//  Phase 1 wires the post-run state end-to-end. This is the scaffold.
//

import SwiftUI

struct TodayView: View {
    @State private var briefing: Briefing?
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // App bar
                HStack(alignment: .firstTextBaseline) {
                    Text("faff").font(.display(28)).foregroundStyle(Theme.ink).tracking(1.2)
                    Text("MON · MAY 25").font(.body(11, weight: .bold))
                        .foregroundStyle(Theme.mute).tracking(1.2)
                    Spacer()
                    ReadinessChip(value: 88)
                }
                .padding(.horizontal, 24).padding(.top, 8)

                if let briefing {
                    CoachBlock(lead: briefing.lead, paragraphs: briefing.voice)
                        .padding(.horizontal, 24)
                } else if loading {
                    ProgressView().tint(Theme.green).padding()
                } else if let error {
                    Text("Error: \(error)").font(.body(13))
                        .foregroundStyle(Theme.over).padding()
                } else {
                    Text("Scaffold · Phase 1 wires the briefing.")
                        .font(.body(13)).foregroundStyle(Theme.mute)
                        .padding(.horizontal, 24)
                }
            }
            .padding(.bottom, 40)
        }
        .background(Theme.bg.ignoresSafeArea())
        .task { await loadBriefing() }
    }

    private func loadBriefing() async {
        loading = true; defer { loading = false }
        do {
            briefing = try await API.briefing(surface: "today", mode: "post-run")
        } catch {
            self.error = String(describing: error)
        }
    }
}

private struct CoachBlock: View {
    let lead: String?
    let paragraphs: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label {
                Text("COACH").font(.body(10, weight: .bold)).tracking(1.6)
                    .foregroundStyle(Theme.green)
            } icon: {
                Circle().fill(Theme.green).frame(width: 6, height: 6)
            }
            if let lead {
                Text(lead).font(.display(28)).foregroundStyle(Theme.ink)
                    .tracking(0.5).lineSpacing(2)
            }
            ForEach(paragraphs, id: \.self) { p in
                Text(p).font(.body(15)).foregroundStyle(Theme.ink.opacity(0.86))
                    .lineSpacing(4)
            }
        }
        .padding(.top, 12)
    }
}

private struct ReadinessChip: View {
    let value: Int
    var body: some View {
        ZStack {
            Circle().stroke(Color.white.opacity(0.08), lineWidth: 3)
            Circle()
                .trim(from: 0, to: CGFloat(value) / 100)
                .stroke(Theme.green, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Text("\(value)").font(.display(16)).foregroundStyle(Theme.green)
        }
        .frame(width: 44, height: 44)
    }
}
