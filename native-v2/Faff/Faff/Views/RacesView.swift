//
//  RacesView.swift  (P5 — iOS parity for /races)
//  Coach voice + cards from briefing. P6 adds full race list view.
//

import SwiftUI

struct RacesView: View {
    @State private var briefing: Briefing?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                // Background-load coach — page chrome paints immediately.
                CoachSlot(
                    briefing: briefing,
                    surface: "races",
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
                .animation(.spring(response: 0.45, dampingFraction: 0.85), value: briefing?.lead)
            }
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle("Races")
            .navigationBarTitleDisplayMode(.large)
            .task { await load() }
            .refreshable { await load() }
        }
    }

    private func load() async {
        briefing = try? await API.briefing(surface: "races")
    }
}
