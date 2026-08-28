//
//  TreadmillHRView.swift
//  FaffWatch
//
//  The watch as a heart-rate strap. The iPhone's TreadmillView starts a
//  session over WatchConnectivity, the watch takes the screen — bpm only,
//  nothing to read or tap. The phone owns everything else: it starts the
//  bridge as soon as the console appears (while the runner is still dialing
//  in speed/incline, before Start), so this screen can be on-wrist and
//  showing a real reading well before any run is timed.
//
//  2026-08-28 · David, after seeing the session's own clock ticking and a
//  Stop button on this screen before he had even tapped Start on the phone:
//  "why is stop here if the run hasnt even started? ... dont need this on
//  the watch." Both were driven by `TreadmillHRSession.startedAt`, which
//  stamps the moment the HR BRIDGE links — deliberately early, per the
//  comment above — not the moment the runner's run actually starts. Showing
//  either read as "a workout is running" when the runner was still standing
//  on the belt setting the speed. The session has its own dead-man timer and
//  absolute cap (see TreadmillHRSession) so nothing needed a manual Stop
//  here as a safety net; it's gone along with the wordmark and the "the
//  phone has the controls" line David also called out. Bpm is the one
//  figure this screen exists for.
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
//

import SwiftUI

struct TreadmillHRView: View {
    @ObservedObject private var hr = TreadmillHRSession.shared

    var body: some View {
        WBoard {
            VStack(alignment: .leading, spacing: 0) {
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
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
