//
//  IdleView.swift
//  FaffWatch
//
//  Home / pre-run on the dark v4 canon (watch-app.html §A): brand mark,
//  a one-word readiness glance, today's session name as the hero, the
//  pace line, est time + distance, the whole-session segment strip, and a
//  thumb-sized green Start. No scroll — Start is always one tap away.
//

import SwiftUI

struct IdleView: View {
    let workout: WatchWorkout
    let onStart: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("FAFF").font(WatchTheme.sub(12, .semibold)).tracking(1.5).foregroundStyle(WatchTheme.C.orange)
                Spacer()
            }
            Spacer(minLength: 2)

            // Readiness glance — one word + score (watch-app.html §A).
            if let score = workout.readinessScore {
                HStack(spacing: 5) {
                    Circle().fill(readinessColor).frame(width: 6, height: 6)
                    Text("\(score) · \(workout.readinessLabel ?? "Ready")")
                        .font(WatchTheme.sub(12, .semibold)).tracking(0.5)
                        .foregroundStyle(readinessColor)
                }
            }

            // Hero — today's session.
            Text(workout.name)
                .font(WatchTheme.display(34)).foregroundStyle(WatchTheme.C.ink)
                .lineLimit(2).minimumScaleFactor(0.5).fixedSize(horizontal: false, vertical: true)
            // Pace line — zone tag · target · recovery.
            Text(paceLine)
                .font(WatchTheme.body(11.5, .semibold)).foregroundStyle(WatchTheme.C.orange)
                .lineLimit(1).minimumScaleFactor(0.6)
            // Est time + distance.
            Text(estLine)
                .font(WatchTheme.body(10.5)).foregroundStyle(WatchTheme.C.t3).padding(.top, 1)

            segments.padding(.top, 7)
            Spacer(minLength: 6)

            Button(action: onStart) {
                HStack(spacing: 6) {
                    Image(systemName: "play.fill").font(.system(size: 12, weight: .bold))
                    Text("START").font(WatchTheme.sub(15, .semibold)).tracking(2)
                }
                .frame(maxWidth: .infinity).padding(.vertical, 11)
                .foregroundStyle(Color(red: 0.016, green: 0.075, blue: 0.051))
                .background(WatchTheme.C.green, in: Capsule())
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .padding(.horizontal, 8).padding(.bottom, 2)
        .background(WatchTheme.C.bg.ignoresSafeArea())
    }

    private var readinessColor: Color {
        switch workout.readinessScore ?? 0 {
        case 80...: return WatchTheme.C.green
        case 60..<80: return WatchTheme.C.amber
        default: return WatchTheme.C.warn
        }
    }

    /// "@ T · 6:31/mi · 90s rec" — zone tag, target pace, recovery, all
    /// derived from the phases (only the parts we actually have).
    private var paceLine: String {
        let work = workout.phases.first { $0.type == .work }
        let rec = workout.phases.first { $0.type == .recovery }
        var s = workout.paceLabel.map { "@ \($0)" } ?? "@ pace"
        if let p = work?.targetPaceSPerMi { s += " · \(PaceFormat.mmss(p))/mi" }
        if let r = rec?.durationSec { s += " · \(r)s rec" }
        return s
    }

    /// "EST 52 MIN · 6.4 MI".
    private var estLine: String {
        var s = "est \(workout.totalEstimatedMinutes) min"
        if let d = workout.distanceMi { s += " · \(String(format: "%.1f", d)) mi" }
        return s.uppercased()
    }

    /// The whole session as a thin strip — one cell per phase, sized by
    /// duration, work tinted orange, everything else the track.
    private var segments: some View {
        let total = max(workout.phases.reduce(0) { $0 + $1.durationSec }, 1)
        return GeometryReader { geo in
            HStack(spacing: 1.5) {
                ForEach(workout.phases) { p in
                    let w = geo.size.width * CGFloat(p.durationSec) / CGFloat(total)
                    Capsule().fill(p.type == .work ? WatchTheme.C.orange : WatchTheme.C.track)
                        .frame(width: max(w - 1.5, 2))
                }
            }
        }
        .frame(height: 3)
    }
}

#Preview {
    IdleView(workout: .sample) { }
}
