//
//  HealthView.swift  (P5 — iOS parity for /health)
//

import SwiftUI

struct HealthView: View {
    @State private var briefing: Briefing?
    @State private var readiness: ReadinessSnapshot?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                // 2026-05-27 parity audit: /health was missing the readiness
                // ring. Hero shows the composite score with band label, same
                // color semantics as TodayView's chip.
                HStack {
                    Spacer()
                    ReadinessRing(
                        score: readiness?.score,
                        label: readiness?.label,
                        size: .large
                    )
                    Spacer()
                }
                .padding(.vertical, 12)

                // Background-load coach — page renders immediately, brief
                // snaps in. No page-blocking spinner.
                CoachSlot(
                    briefing: briefing,
                    surface: "health",
                    askPrompt: nil
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
                .animation(.spring(response: 0.45, dampingFraction: 0.85), value: readiness?.score)
                .animation(.spring(response: 0.45, dampingFraction: 0.85), value: briefing?.lead)
            }
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle("Health")
            .navigationBarTitleDisplayMode(.large)
            .task { await loadAll() }
            .refreshable { await loadAll() }
            .sensoryFeedback(.success, trigger: readiness?.score)
        }
    }

    private func loadAll() async {
        // Brief + readiness in parallel; ring renders as soon as
        // readiness lands (usually before the LLM brief).
        async let bRes = (try? await API.briefing(surface: "health"))
        async let rRes = (try? await API.fetchReadiness())
        let (b, r) = await (bRes, rRes)
        briefing = b
        readiness = r
    }
}
