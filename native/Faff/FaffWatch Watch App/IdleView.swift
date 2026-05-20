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
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text("FAFF").font(WatchTheme.sub(13, .semibold)).tracking(1.5).foregroundStyle(WatchTheme.C.orange)
                    Spacer()
                }
                Spacer(minLength: 8)
                Text(workout.name)
                    .font(WatchTheme.display(30)).foregroundStyle(WatchTheme.C.ink)
                    .lineLimit(2).minimumScaleFactor(0.55).fixedSize(horizontal: false, vertical: true)
                Text(workout.summary)
                    .font(WatchTheme.body(12, .medium)).foregroundStyle(WatchTheme.C.t2)
                    .fixedSize(horizontal: false, vertical: true)
                Text("≈ \(workout.totalEstimatedMinutes) min · \(workout.phases.count) phases")
                    .font(WatchTheme.body(11)).foregroundStyle(WatchTheme.C.t3).padding(.top, 2)
                segments.padding(.top, 9)
                Spacer(minLength: 12)
                Button(action: onStart) {
                    HStack(spacing: 6) {
                        Image(systemName: "play.fill").font(.system(size: 12, weight: .bold))
                        Text("START").font(WatchTheme.sub(15, .semibold)).tracking(2)
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 12)
                    .foregroundStyle(Color(red: 0.016, green: 0.075, blue: 0.051))
                    .background(WatchTheme.C.green, in: Capsule())
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 8).padding(.vertical, 4)
        }
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
