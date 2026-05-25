//
//  RacesView.swift
//  Scaffold. Phase 3/4 wires the surface end-to-end per the deck.
//

import SwiftUI

struct RacesView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Text("faff").font(.display(28)).foregroundStyle(Theme.ink).tracking(1.2)
                    Spacer()
                }
                .padding(.horizontal, 24).padding(.top, 8)

                Text("RACES").font(.display(48)).foregroundStyle(Theme.ink).tracking(0.5)
                    .padding(.horizontal, 24)
                Text("SCAFFOLD · WIRED IN LATER PHASE")
                    .font(.body(11, weight: .bold))
                    .foregroundStyle(Theme.mute).tracking(1.6)
                    .padding(.horizontal, 24)
            }
            .padding(.bottom, 40)
        }
        .background(Theme.bg.ignoresSafeArea())
    }
}
