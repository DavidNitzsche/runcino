//
//  IdleView.swift
//  FaffWatch
//
//  Home / pre-run on the dark v4 canon (watch-app.html §A): brand mark,
//  today's session name + estimate, the whole-session segment strip,
//  and a thumb-sized green Start.
//

import SwiftUI

struct IdleView: View {
    let workout: WatchWorkout
    let onStart: () -> Void

    var body: some View {
        // Single screen — no scroll. Content tops out, Start is pinned to
        // the bottom so it's always one tap away. The title auto-scales
        // so even long names keep everything on one face.
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("FAFF").font(WatchTheme.sub(12, .semibold)).tracking(1.5).foregroundStyle(WatchTheme.C.orange)
                Spacer()
            }
            Spacer(minLength: 2)
            Text(workout.name)
                .font(WatchTheme.display(26)).foregroundStyle(WatchTheme.C.ink)
                .lineLimit(2).minimumScaleFactor(0.5).fixedSize(horizontal: false, vertical: true)
            Text(workout.summary)
                .font(WatchTheme.body(11.5, .medium)).foregroundStyle(WatchTheme.C.t2)
                .lineLimit(1).minimumScaleFactor(0.7)
            Text("≈ \(workout.totalEstimatedMinutes) min · \(workout.phases.count) phases")
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
