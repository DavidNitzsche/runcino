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

    /// The hero block is authored ONCE at this full size, then uniformly scaled
    /// to fit whatever room a given watch leaves. No per-device branching.
    private struct Tier { let hero: CGFloat; let mid: CGFloat; let sub: CGFloat; let spacing: CGFloat }
    private static let base = Tier(hero: 58, mid: 22, sub: 19, spacing: 8)

    var body: some View {
        GeometryReader { geo in
            // Reclaim the top inset (the OS clock's row) so we have the full
            // screen height to work with and FAFF can sit up alongside the clock.
            let topInset = geo.safeAreaInsets.top
            VStack(spacing: 0) {
                // w-top: brand mark left (the OS clock owns the time, top-right).
                HStack {
                    Text("FAFF").font(WatchTheme.display(15)).italic()
                        .tracking(1.5).foregroundStyle(WatchTheme.C.orange)
                    Spacer(minLength: 0)
                }
                .padding(.top, max(12, topInset - 22))   // lift into the clock row, never clipped
                // Author the block at full size; scale it to fit the leftover
                // region between FAFF and START — big on the Ultra, proportionally
                // smaller on the 40mm, always fits, never clips.
                GeometryReader { mid in
                    heroBlock(Self.base)
                        .fixedSize(horizontal: false, vertical: true)
                        .modifier(ScaleToFitHeight(available: mid.size.height))
                        .frame(width: mid.size.width, height: mid.size.height)
                }
                startButton
            }
            .frame(width: geo.size.width, height: geo.size.height + topInset, alignment: .top)
            .ignoresSafeArea(.container, edges: .top)
        }
        .padding(.horizontal, 10)
        .padding(.bottom, 2)
        .background(WatchTheme.C.bg.ignoresSafeArea())
    }

    @ViewBuilder private func heroBlock(_ t: Tier) -> some View {
        if workout.isRace { raceBody(t) } else { workoutBody(t) }
    }

    // Workout day (watch-app.html §A): readiness pill, name hero, pace.
    @ViewBuilder private func workoutBody(_ t: Tier) -> some View {
        VStack(spacing: t.spacing) {
            if let score = workout.readinessScore {
                HStack(spacing: 5) {
                    Circle().fill(readinessColor).frame(width: 7, height: 7)
                    Text("\(score) · \(workout.readinessLabel ?? "Ready")".uppercased())
                        .font(WatchTheme.body(11.5, .bold)).tracking(0.5)
                        .foregroundStyle(readinessColor)
                }
                .padding(.vertical, 5).padding(.horizontal, 10)
                .background(readinessColor.opacity(0.15), in: Capsule())
            }
            Text(workout.name)
                .font(WatchTheme.display(t.hero)).tracking(-1).foregroundStyle(WatchTheme.C.ink)
                .lineLimit(1).minimumScaleFactor(0.4)
                .frame(maxWidth: .infinity)
            Text(paceLine)
                .font(WatchTheme.sub(t.mid, .semibold)).tracking(0.5).foregroundStyle(WatchTheme.C.orange)
                .textCase(.uppercase).lineLimit(1).minimumScaleFactor(0.6)
            Text(estLine)
                .font(WatchTheme.body(t.sub, .semibold)).tracking(0.3).foregroundStyle(WatchTheme.C.t3)
                .lineLimit(1).minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity)
    }

    // Pre-race (watch-app.html §F): goal hero, strategy, distance · gels, strip.
    @ViewBuilder private func raceBody(_ t: Tier) -> some View {
        VStack(spacing: t.spacing) {
            Text(workout.name.uppercased())
                .font(WatchTheme.body(12.5, .bold)).tracking(1.1).foregroundStyle(WatchTheme.C.orange).lineLimit(1)
            Text(workout.goalSec.map { PaceFormat.hm($0) } ?? workout.name)
                .font(WatchTheme.display(t.hero + 10)).tracking(-1.5).foregroundStyle(WatchTheme.C.ink)
                .lineLimit(1).minimumScaleFactor(0.45).frame(maxWidth: .infinity)
            if let strategy = workout.strategyLabel {
                Text(strategy)
                    .font(WatchTheme.sub(t.mid, .semibold)).tracking(0.5).foregroundStyle(WatchTheme.C.orange)
                    .lineLimit(1).minimumScaleFactor(0.6)
            }
            Text(raceMetaLine)
                .font(WatchTheme.body(t.sub, .semibold)).tracking(0.3).foregroundStyle(WatchTheme.C.t3)
                .lineLimit(1).minimumScaleFactor(0.7)
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

/// Measures its content's natural height and uniformly scales it down (never up)
/// so it fits `available`. scaleEffect is a render transform, so the background
/// GeometryReader still reports the un-scaled height — no measurement feedback loop.
private struct FaffNaturalHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

private struct ScaleToFitHeight: ViewModifier {
    let available: CGFloat
    @State private var natural: CGFloat = 0
    func body(content: Content) -> some View {
        let scale = (natural > 0 && available > 0) ? min(1, available / natural) : 1
        return content
            .background(GeometryReader { g in
                Color.clear.preference(key: FaffNaturalHeightKey.self, value: g.size.height)
            })
            .scaleEffect(scale, anchor: .center)
            .onPreferenceChange(FaffNaturalHeightKey.self) { natural = $0 }
    }
}

#Preview { IdleView(workout: .sample) { } }
#Preview("Race") { IdleView(workout: .sampleRace) { } }
