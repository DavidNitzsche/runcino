//
//  ReadinessGlanceView.swift
//  FaffWatch
//
//  The readiness glance (watch-app.html §G) — the watch's slice of the phone's
//  body-state read, available any day. One hero number (the score), colored by
//  state, with a one-word label, the HRV · RHR subline, and the race countdown.
//  When the read is suppressed (score == nil) it shows a dashed empty state
//  rather than an error. Fed by /api/watch/readiness via the PhoneSync bridge.
//

import SwiftUI

struct ReadinessGlanceView: View {
    let readiness: WatchReadiness?

    var body: some View {
        VStack(spacing: 0) {
            // READINESS eyebrow lifted level with the OS clock (top-right is the OS's).
            HStack {
                Text("READINESS")
                    .font(WatchTheme.body(12.5, .bold)).tracking(1.1)
                    .foregroundStyle(eyebrowColor)
                Spacer(minLength: 0)
            }
            .padding(.leading, 8).padding(.top, 20)

            Spacer(minLength: 0)
            if let r = readiness, let score = r.score {
                filled(r, score: score)
            } else {
                empty
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14).padding(.bottom, 8)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WatchTheme.C.bg.ignoresSafeArea())
        .ignoresSafeArea(.container, edges: .top)
    }

    // The body-state read: label word, big score hero (state-colored), HRV·RHR,
    // and the race countdown.
    @ViewBuilder private func filled(_ r: WatchReadiness, score: Int) -> some View {
        let c = stateColor(r.state)
        Text(r.label.uppercased())
            .font(WatchTheme.body(12, .bold)).tracking(0.8)
            .foregroundStyle(WatchTheme.C.t2).lineLimit(1)
        Text("\(score)")
            .font(WatchTheme.display(96)).foregroundStyle(c)
            .lineLimit(1).minimumScaleFactor(0.5)
        if let sub = subline(r) {
            Text(sub).font(WatchTheme.body(13, .semibold)).foregroundStyle(WatchTheme.C.t2)
                .padding(.top, 4)
        }
        if let race = r.nextRace {
            Text("\(race.name.uppercased()) · \(race.daysAway) DAYS")
                .font(WatchTheme.body(11, .semibold)).tracking(0.4)
                .foregroundStyle(WatchTheme.C.t3).padding(.top, 12)
        }
    }

    // Suppressed read (injured / no data): a dashed, dimmed placeholder.
    private var empty: some View {
        VStack(spacing: 10) {
            Text("– –")
                .font(WatchTheme.display(96)).foregroundStyle(WatchTheme.C.t3)
            Text(emptyReason)
                .font(WatchTheme.body(12.5, .medium)).foregroundStyle(WatchTheme.C.t3)
                .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 170)
        }
    }

    private var emptyReason: String {
        switch readiness?.suppressReason {
        case "injured": return "Recovering — readiness paused"
        case "no-data": return "No readiness data yet"
        default:        return "No readiness read today"
        }
    }

    /// State hue only when there's a real score; muted when suppressed.
    private var eyebrowColor: Color {
        if let r = readiness, r.score != nil { return stateColor(r.state) }
        return WatchTheme.C.t2
    }

    private func subline(_ r: WatchReadiness) -> String? {
        var parts: [String] = []
        if let hrv = r.hrvMs { parts.append("HRV \(hrv)") }
        if let rhr = r.rhrBpm { parts.append("RHR \(rhr)") }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /// ≥80 green, ≥60 yellow, else red — the backend already decides `state`
    /// against the shared phone/web thresholds; we just map it to the hue.
    private func stateColor(_ state: String) -> Color {
        switch state {
        case "green":  return WatchTheme.C.green
        case "yellow": return WatchTheme.C.amber
        default:       return WatchTheme.C.warn
        }
    }
}

#Preview("Green") {
    ReadinessGlanceView(readiness: WatchReadiness(
        score: 82, state: "green", label: "Primed",
        recommendation: "Green. Hit today's prescription as written.",
        hrvMs: 68, rhrBpm: 48, suppressReason: nil,
        nextRace: .init(name: "CIM", slug: "cim", daysAway: 198)))
}
#Preview("Empty") {
    ReadinessGlanceView(readiness: WatchReadiness(
        score: nil, state: "yellow", label: "Hold easy", recommendation: "",
        hrvMs: nil, rhrBpm: nil, suppressReason: "no-data", nextRace: nil))
}
