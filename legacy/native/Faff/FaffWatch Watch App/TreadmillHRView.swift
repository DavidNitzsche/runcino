//
//  TreadmillHRView.swift   (FaffWatch · build matched to iPhone 137)
//
//  Minimal watch display for when the iPhone has us streaming HR for
//  a treadmill session. The runner's looking at their phone, not the
//  watch · the watch view is just for the occasional wrist-glance and
//  the emergency-stop affordance (if the iPhone's stop message doesn't
//  reach us for some reason).
//
//  Composition:
//    · "TREADMILL" eyebrow
//    · Big BPM hero · the only meaningful live value here
//    · "Phone has the controls" status line so the runner doesn't
//      hunt for buttons
//    · "Stop" → ends the watch session locally (the iPhone is the
//      canonical workout owner · this is just a safety hatch)
//

import SwiftUI

struct TreadmillHRView: View {
    @ObservedObject private var hr = TreadmillHRSession.shared

    var body: some View {
        ResponsiveFace {
            VStack(spacing: 0) {
                HStack {
                    Text("FAFF").font(WatchTheme.display(15)).italic().tracking(1.5)
                        .foregroundStyle(WatchTheme.C.orange)
                    Spacer()
                    Text(elapsedLabel)
                        .font(WatchTheme.body(11, .semibold))
                        .foregroundStyle(WatchTheme.C.t2)
                        .monospacedDigit()
                }
                .padding(.leading, 8).padding(.trailing, 4).padding(.top, 14)

                Spacer(minLength: 0)

                Text("TREADMILL")
                    .font(WatchTheme.body(10, .bold))
                    .tracking(2)
                    .foregroundStyle(WatchTheme.C.t2)

                // Big BPM hero · "—" until first sample, "162" once it lands.
                Text(hr.currentBpm > 0 ? "\(hr.currentBpm)" : "—")
                    .font(WatchTheme.display(72))
                    .foregroundStyle(WatchTheme.C.ink)
                    .monospacedDigit()
                Text("BPM")
                    .font(WatchTheme.body(11, .bold))
                    .tracking(1.5)
                    .foregroundStyle(WatchTheme.C.t2.opacity(0.85))

                Spacer(minLength: 8)

                Text("Phone has the controls")
                    .font(WatchTheme.body(10, .medium))
                    .foregroundStyle(WatchTheme.C.t2)
                    .multilineTextAlignment(.center)

                Button(action: stop) {
                    Text("STOP")
                        .font(WatchTheme.body(13, .bold))
                        .tracking(1.5)
                        .foregroundStyle(WatchTheme.C.ink)
                        .frame(maxWidth: .infinity).padding(.vertical, 8)
                        .background(WatchTheme.C.orange.opacity(0.18), in: Capsule())
                        .overlay(Capsule().stroke(WatchTheme.C.orange.opacity(0.5), lineWidth: 1))
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 18)
                .padding(.top, 8)
                .padding(.bottom, 10)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var elapsedLabel: String {
        guard let started = hr.startedAt else { return "—" }
        let secs = max(0, Int(Date().timeIntervalSince(started)))
        let m = secs / 60, s = secs % 60
        return "\(m):\(s < 10 ? "0" : "")\(s)"
    }

    private func stop() {
        Task { await TreadmillHRSession.shared.end() }
    }
}
