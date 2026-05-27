//
//  HealthView.swift  (P5 — iOS parity for /health)
//

import SwiftUI

struct HealthView: View {
    @State private var briefing: Briefing?
    @State private var readiness: ReadinessSnapshot?
    @State private var loading = true

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Text("faff").font(.display(26)).tracking(1.2).foregroundStyle(Theme.ink)
                    Spacer()
                }
                .padding(.horizontal, 24).padding(.top, 8)

                Text("HEALTH").font(.display(48)).tracking(0.5).foregroundStyle(Theme.ink)
                    .padding(.horizontal, 24)

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

                if loading {
                    HStack { Spacer(); ProgressView().tint(Theme.green); Spacer() }.padding(40)
                } else if let briefing {
                    CoachBlock(
                        lead: briefing.lead, voice: briefing.voice,
                        briefingId: "health|\(briefing.mode)",
                        askPrompt: "How are you sleeping?"
                    )
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
        .task {
            loading = true; defer { loading = false }
            // Brief + readiness in parallel; ring renders as soon as
            // readiness lands (usually before the LLM brief).
            async let bRes = (try? await API.briefing(surface: "health"))
            async let rRes = (try? await API.fetchReadiness())
            let (b, r) = await (bRes, rRes)
            briefing = b
            readiness = r
        }
    }
}
