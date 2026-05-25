//
//  RacesView.swift  (P5 — iOS parity for /races)
//  Coach voice + cards from briefing. P6 adds full race list view.
//

import SwiftUI

struct RacesView: View {
    @State private var briefing: Briefing?
    @State private var loading = true

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Text("faff").font(.display(26)).tracking(1.2).foregroundStyle(Theme.ink)
                    Spacer()
                }
                .padding(.horizontal, 24).padding(.top, 8)

                Text("RACES").font(.display(48)).tracking(0.5).foregroundStyle(Theme.ink)
                    .padding(.horizontal, 24)

                if loading {
                    HStack { Spacer(); ProgressView().tint(Theme.green); Spacer() }.padding(40)
                } else if let briefing {
                    CoachBlock(
                        lead: briefing.lead, voice: briefing.voice,
                        briefingId: "races|\(briefing.mode)",
                        askPrompt: "Pick a race when ready."
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
            briefing = try? await API.briefing(surface: "races")
        }
    }
}
