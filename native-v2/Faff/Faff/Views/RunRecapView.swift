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

    /// The run's date for the header pill ("MON, JUN 15") — identifies
    /// which run this is. Replaces a redundant "RUN RECAP" label (the
    /// effort word is already the hero title right below).
    private var dateLabel: String {
        guard let raw = detail?.date, !raw.isEmpty else { return "" }
        let inFmt = DateFormatter()
        inFmt.dateFormat = "yyyy-MM-dd"
        inFmt.locale = Locale(identifier: "en_US_POSIX")
        guard let d = inFmt.date(from: String(raw.prefix(10))) else { return "" }
        let outFmt = DateFormatter()
        outFmt.dateFormat = "EEE, MMM d"
        outFmt.locale = Locale(identifier: "en_US_POSIX")
        return outFmt.string(from: d).uppercased()
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
            // Standard nav layout · back chevron pinned left, the run's
            // date as a centered title. The date is NOT placed next to the
            // chevron — a label there reads as the back destination ("back
            // to RUN RECAP"), which is wrong since this is reachable from
            // Activity, race day, or the week-ahead.
            ZStack {
                if !dateLabel.isEmpty {
                    SpecLabel(text: dateLabel, size: 13, tracking: 2, color: Theme.txt)
                }
                HStack {
                    BackChip { dismiss() }
                    Spacer()
                }
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
