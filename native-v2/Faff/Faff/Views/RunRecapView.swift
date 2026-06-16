//
//  RunRecapView.swift
//  The run-detail surface reached by tapping a run in Activity.
//
//  Replaces the old orange RunDetailView (broken header, duplicate
//  mile-pace/mile-splits charts, a fabricated PACE/HR/ELEV trace). This
//  reuses TodayPostRunBody — the same accurate recap Today renders for a
//  completed/past day: verdict, real stats trio + secondary stats, the
//  real MapKit route, shoe, mile splits, HOW IT WENT. Grey background and
//  a proper header pill that clears the global app header (no collision).
//

import SwiftUI

struct RunRecapView: View {
    let runId: String

    @Environment(\.dismiss) private var dismiss
    @State private var detail: RunDetail? = nil
    @State private var recap: RunRecap? = nil

    /// Effort resolved from the run's planned kind (preferred) or actual
    /// type — drives the accent + the Oswald title word ("EASY").
    private var effort: FaffEffort {
        FaffEffort.fromType(detail?.planned_spec?.kind ?? detail?.type ?? "easy")
    }

    var body: some View {
        ZStack {
            // Grey · the neutral app base, NOT the warm effort mesh the old
            // detail page used (David: "use the grey").
            Theme.bg.ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    // Clear the global top bar (50pt) + header pill (84pt).
                    Color.clear.frame(height: 132)

                    TodayPostRunBody(
                        detail: detail,
                        recap: recap,
                        accent: effort.dot,
                        runId: runId,
                        effortLabel: effort.title,
                        dowLabel: nil,
                        titleText: effort.title,
                        nameSubtitle: detail?.name,
                        onMesh: true
                    )
                    .padding(.bottom, 120)
                }
            }
            .scrollClipDisabled(true)
        }
        .faffHeaderPill {
            HStack(spacing: 12) {
                BackChip { dismiss() }
                SpecLabel(text: "RUN RECAP", size: 13, tracking: 2.5, color: Theme.txt)
                Spacer()
            }
            .padding(.horizontal, 15)
        }
        .navigationBarHidden(true)
        .task { await load() }
    }

    private func load() async {
        async let d = (try? await API.fetchRunDetail(id: runId))
        async let r = (try? await API.fetchRunRecap(runId: runId))
        let (dd, rr) = await (d, r)
        await MainActor.run {
            if let dd { detail = dd }
            if let rr { recap = rr }
        }
    }
}
