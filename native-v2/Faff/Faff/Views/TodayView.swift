//
//  TodayView.swift
//  P1: full TODAY iPhone with coach voice + cards lane + reply chips.
//  Mirrors web-v2 /today route.
//

import SwiftUI

struct TodayView: View {
    @State private var briefing: Briefing?
    @State private var loading = true
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // App bar
                HStack(alignment: .firstTextBaseline) {
                    Text("faff").font(.display(26)).tracking(1.2).foregroundStyle(Theme.ink)
                    Text(todayLabel()).font(.body(11, weight: .bold)).tracking(1.2)
                        .foregroundStyle(Theme.mute)
                    Spacer()
                    // Readiness chip — wired in P3.3 (§8.3 breakdown loop)
                    ReadinessChip(value: 88)
                }
                .padding(.horizontal, 24).padding(.top, 8)

                if loading {
                    HStack {
                        Spacer()
                        ProgressView().tint(Theme.green)
                        Spacer()
                    }.padding(40)
                } else if let error {
                    errorBlock(error)
                } else if let briefing {
                    CoachBlock(
                        lead: briefing.lead,
                        voice: briefing.voice,
                        briefingId: "\(briefing.surface)|\(briefing.mode)",
                        askPrompt: askPrompt(for: briefing.mode),
                        onCheckIn: { rating in
                            do {
                                try await API.checkin(rating: rating.rawValue,
                                                       briefingId: "\(briefing.surface)|\(briefing.mode)")
                                // Closed loop: refresh next briefing.
                                Task { await loadBriefing() }
                                return true
                            } catch {
                                return false
                            }
                        }
                    )

                    // Cards lane
                    VStack(spacing: 10) {
                        ForEach(Array(briefing.topics.enumerated()), id: \.offset) { _, topic in
                            TopicRenderer(topic: topic)
                        }
                    }
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
            briefing = try await API.briefing(surface: "today")
            error = nil
        } catch {
            self.error = String(describing: error)
        }
    }

    private func todayLabel() -> String {
        let fmt = DateFormatter()
        fmt.dateFormat = "E · MMM d"
        return fmt.string(from: Date()).uppercased()
    }

    private func askPrompt(for mode: String) -> String {
        switch mode {
        case "post-run": return "Let me know how it felt."
        case "pre-run":  return "How are the legs?"
        case "rest-day": return "Anything sore?"
        case "race-day": return "Ready?"
        default:         return "Let me know."
        }
    }

    private func errorBlock(_ msg: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("BRIEFING ERROR").font(.body(9, weight: .bold)).tracking(1.6)
                .foregroundStyle(Theme.over)
            Text(msg).font(.body(12)).foregroundStyle(Theme.ink.opacity(0.85)).lineSpacing(2)
        }
        .padding(16)
        .background(Theme.over.opacity(0.04))
        .overlay(RoundedRectangle(cornerRadius: Theme.rCard).stroke(Theme.over.opacity(0.22), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
        .padding(.horizontal, 24)
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
