//
//  IdleView.swift
//  FaffWatch
//
//  Home / pre-run on the dark v4 canon (watch-app.html §A / §F). Center-
//  aligned launchpad: brand mark, a one-word readiness pill, today's
//  session name as the hero, the pace line, est time + distance, and a
//  thumb-sized green Start. Race day swaps in the goal/strategy + course
//  strip (§F). No scroll — Start is always one tap away.
//

import SwiftUI

struct IdleView: View {
    let workout: WatchWorkout
    let onStart: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            // w-top: brand mark left (the OS clock provides the time, right).
            HStack {
                Text("FAFF").font(WatchTheme.display(15)).italic()
                    .tracking(1.5).foregroundStyle(WatchTheme.C.orange)
                Spacer()
            }
            .padding(.leading, 8).padding(.top, 20)   // FAFF level with the OS clock
            Spacer(minLength: 2)
            if workout.isRace { raceBody } else { workoutBody }
            Spacer(minLength: 6)
            startButton
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .padding(.horizontal, 10).padding(.bottom, 2)
        .background(WatchTheme.C.bg.ignoresSafeArea())
        .ignoresSafeArea(.container, edges: .top)
    }

    // Workout day (watch-app.html §A): readiness pill, name hero, pace.
    @ViewBuilder private var workoutBody: some View {
        VStack(spacing: 5) {
            if let score = workout.readinessScore {
                HStack(spacing: 5) {
                    Circle().fill(readinessColor).frame(width: 6, height: 6)
                    Text("\(score) · \(workout.readinessLabel ?? "Ready")".uppercased())
                        .font(WatchTheme.body(10, .bold)).tracking(0.5)
                        .foregroundStyle(readinessColor)
                }
                .padding(.vertical, 4).padding(.horizontal, 9)
                .background(readinessColor.opacity(0.15), in: Capsule())
            }
            Text(workout.name)
                .font(WatchTheme.display(52)).tracking(-1).foregroundStyle(WatchTheme.C.ink)
                .lineLimit(2).minimumScaleFactor(0.4).multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 2).padding(.bottom, -2)   // Bebas sits ~4px high in its line-box; nudge the glyph down to optically center it between pill and pace (net height unchanged)
            Text(paceLine)
                .font(WatchTheme.sub(15, .semibold)).tracking(0.5).foregroundStyle(WatchTheme.C.orange)
                .textCase(.uppercase).lineLimit(1).minimumScaleFactor(0.6)
            Text(estLine)
                .font(WatchTheme.body(13, .semibold)).tracking(0.4).foregroundStyle(WatchTheme.C.t3)
        }
        .frame(maxWidth: .infinity)
    }

    // Pre-race (watch-app.html §F): goal hero, strategy, distance · gels, strip.
    @ViewBuilder private var raceBody: some View {
        VStack(spacing: 5) {
            HStack(spacing: 5) {
                Text(workout.name.uppercased())
                    .font(WatchTheme.body(12.5, .bold)).tracking(1.1).foregroundStyle(WatchTheme.C.orange).lineLimit(1)
            }
            Text(workout.goalSec.map { PaceFormat.hm($0) } ?? workout.name)
                .font(WatchTheme.display(64)).tracking(-1.5).foregroundStyle(WatchTheme.C.ink)
                .lineLimit(1).minimumScaleFactor(0.5)
            if let strategy = workout.strategyLabel {
                Text(strategy)
                    .font(WatchTheme.sub(15, .semibold)).tracking(0.5).foregroundStyle(WatchTheme.C.orange)
                    .lineLimit(1).minimumScaleFactor(0.6)
            }
            Text(raceMetaLine)
                .font(WatchTheme.body(13, .semibold)).tracking(0.4).foregroundStyle(WatchTheme.C.t3)
            courseStrip.padding(.top, 4)
        }
        .frame(maxWidth: .infinity)
    }

    private var startButton: some View {
        Button(action: onStart) {
            HStack(spacing: 7) {
                Image(systemName: "play.fill").font(.system(size: 12, weight: .bold))
                Text("START").font(WatchTheme.sub(15, .semibold)).tracking(2)
            }
            .frame(maxWidth: .infinity).padding(.vertical, 13)
            .foregroundStyle(Color(red: 0.016, green: 0.075, blue: 0.051))
            .background(WatchTheme.C.green, in: Capsule())
        }
        .buttonStyle(.plain)
    }

    private var readinessColor: Color {
        switch workout.readinessScore ?? 0 {
        case 80...: return WatchTheme.C.green
        case 60..<80: return WatchTheme.C.amber
        default: return WatchTheme.C.warn
        }
    }

    /// "@ T · 6:31/mi · 90s rec" — derived from the phases.
    private var paceLine: String {
        let work = workout.phases.first { $0.type == .work }
        let rec = workout.phases.first { $0.type == .recovery }
        var s = workout.paceLabel.map { "@ \($0)" } ?? "@ pace"
        if let p = work?.targetPaceSPerMi { s += " · \(PaceFormat.mmss(p))/mi" }
        if let r = rec?.durationSec { s += " · \(r)s rec" }
        return s
    }

    private var estLine: String {
        var s = "est \(workout.totalEstimatedMinutes) min"
        if let d = workout.distanceMi { s += " · \(String(format: "%.1f", d)) mi" }
        return s
    }

    private var raceMetaLine: String {
        var s = ""
        if let d = workout.distanceMi { s += String(format: "%.1f mi", d) }
        if let gels = workout.gelsMi { s += s.isEmpty ? "\(gels.count) gels" : " · \(gels.count) gels" }
        return s
    }

    /// The course as a thin strip — one cell per phase, sized by duration.
    private var courseStrip: some View {
        let total = max(workout.phases.reduce(0) { $0 + $1.durationSec }, 1)
        return GeometryReader { geo in
            HStack(spacing: 2) {
                ForEach(workout.phases) { p in
                    let w = geo.size.width * CGFloat(p.durationSec) / CGFloat(total)
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(p.type == .work ? WatchTheme.C.orange : Color.white.opacity(0.32))
                        .frame(width: max(w - 2, 2))
                }
            }
        }
        .frame(height: 5)
    }
}

#Preview { IdleView(workout: .sample) { } }
#Preview("Race") { IdleView(workout: .sampleRace) { } }
