//
//  TreadmillHRView.swift
//  FaffWatch
//
//  The watch as a heart-rate strap. The iPhone's TreadmillView starts a
//  session over WatchConnectivity, the watch takes the screen, and the phone
//  keeps the controls — the belt is in front of the runner and the wrist is
//  not where they are looking.
//
//  NOT IN THE 0821 BOARD SET. There is no drawn board for this surface, so
//  everything below is the handoff's RULES applied to a screen the handoff
//  does not cover, rather than a board copied from it. Flagged in
//  docs/design/watch-0821/AUDIT.md rather than presented as spec:
//
//   · A treadmill has no trustworthy pace, so nothing here grades and every
//     value is white. That is the same reason the treadmill running faces are
//     white throughout.
//   · The heart rate is a MEASURED value with no band, so it is white at full
//     opacity and its unit steps down — it is not amber, because amber means
//     out of range and there is no range here.
//   · Red would name a sensor, and no sensor has failed. The old version drew
//     the wordmark and the STOP button in the race red, which is a coloured
//     non-graded element and the thing rule 1 exists to prevent.
//   · Stop is a 50pt full-width pill like every other target, and it is not
//     destructive — the phone owns the session and ending it saves.
//

import SwiftUI

struct TreadmillHRView: View {
    @ObservedObject private var hr = TreadmillHRSession.shared

    var body: some View {
        WBoard {
            VStack(alignment: .leading, spacing: 0) {

                HStack(alignment: .firstTextBaseline) {
                    WWordmark(size: 12)
                    Spacer(minLength: 6)
                    Text(elapsedLabel)
                        .font(WatchV5.number(13))
                        .foregroundStyle(WatchV5.valueLabel)
                }

                Spacer(minLength: 0)

                WKicker(text: "Treadmill")

                // The one figure this screen exists for. "--" until the first
                // sample lands: an absent reading is drawn as absent, never as
                // a zero, because a zero heart rate is a claim and a dash is
                // an admission.
                WMetric(
                    value: hr.currentBpm > 0 ? "\(hr.currentBpm)" : "--",
                    unit: "bpm",
                    rank: .hero
                )

                Spacer(minLength: 0)

                // Says where the controls are, because the runner's hands are
                // on the belt and the wrist is not where they are looking.
                WCoachLine(text: "The phone has the controls.", size: 13)

                WTargetStack {
                    WTarget(label: "Stop", weight: .quiet, action: stop)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// "--" before the first sample rather than "0:00": the session has a
    /// start time or it does not, and a zero clock claims it started now.
    private var elapsedLabel: String {
        guard let started = hr.startedAt else { return "--" }
        return WFmt.clock(max(0, Int(Date().timeIntervalSince(started))))
    }

    private func stop() {
        Task { await TreadmillHRSession.shared.end() }
    }
}
