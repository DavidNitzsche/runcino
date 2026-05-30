//
//  WatchMirrorView.swift
//  Live in-run mirror of the Apple Watch. The watch owns the timer +
//  controls; the phone is read-only with a course/open layout that
//  shows the runner what's ahead.
//

import SwiftUI

struct WatchMirrorView: View {
    @State private var liveOk: Bool = true
    @State private var workout: WatchWorkout?

    var body: some View {
        let effort = workout.map { FaffEffort.fromType($0.paceLabel ?? "tempo") } ?? .tempo
        let mesh = effort.mesh
        ZStack {
            FaffMeshView(mesh: mesh)

            VStack(spacing: 0) {
                followPill
                    .padding(.top, 8)

                if let w = workout {
                    plannedHero(workout: w)
                        .padding(.top, 22)
                        .padding(.horizontal, 24)

                    if !w.phases.isEmpty {
                        phaseList(phases: w.phases)
                            .padding(.top, 24)
                            .padding(.horizontal, 24)
                    }
                } else {
                    hero
                        .padding(.top, 16)
                        .padding(.horizontal, 24)
                    threeStatRow
                        .padding(.top, 18)
                        .padding(.horizontal, 24)
                    courseSection
                        .padding(.top, 18)
                        .padding(.horizontal, 24)
                }

                Spacer(minLength: 0)

                Text("PAUSE · LAP · END ON YOUR WATCH")
                    .font(.display(10, weight: .bold))
                    .tracking(0.5)
                    .foregroundStyle(Theme.txt.opacity(0.5))
                    .padding(.bottom, 28)
            }
        }
        .task { workout = try? await API.fetchWatchWorkout() }
    }

    private var followPill: some View {
        HStack(spacing: 9) {
            LivePulseDot(color: liveOk ? Color(hex: 0x9AF0BF) : Color(hex: 0xFF5A52), size: 8)
                .frame(width: 12, height: 12)
            Text(workout != nil ? "FOLLOWING APPLE WATCH · MIRRORED" : "STANDING BY")
                .font(.label(11)).tracking(1.5)
                .foregroundStyle(Theme.txt)
        }
        .padding(.horizontal, 14).padding(.vertical, 8)
        .background(Color.white.opacity(0.1), in: Capsule())
        .overlay(Capsule().stroke(Color.white.opacity(0.2), lineWidth: 1))
        .background(.ultraThinMaterial, in: Capsule())
    }

    private func plannedHero(workout w: WatchWorkout) -> some View {
        VStack(spacing: 12) {
            SpecLabel(text: "PLANNED", size: 10, tracking: 2.5, color: Theme.txt.opacity(0.6))
            Text(w.name)
                .displayRecipe(size: 46, weight: .bold)
                .foregroundStyle(Theme.txt)
                .multilineTextAlignment(.center)
                .shadow(color: .black.opacity(0.32), radius: 26, y: 3)
            HStack(spacing: 22) {
                if let mi = w.distanceMi {
                    statBlock(value: String(format: "%.1f", mi), key: "MI")
                }
                statBlock(value: "~\(w.totalEstimatedMinutes)", key: "MIN EST")
                if let label = w.paceLabel {
                    statBlock(value: label, key: "TARGET")
                }
            }
            .padding(.top, 6)
        }
    }

    private func statBlock(value: String, key: String) -> some View {
        VStack(spacing: 4) {
            Text(value)
                .font(.display(22, weight: .bold))
                .tracking(-0.5)
                .foregroundStyle(Theme.txt)
            SpecLabel(text: key, size: 9, tracking: 1.4, color: Theme.txt.opacity(0.6))
        }
    }

    private func phaseList(phases: [WatchPhase]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SpecLabel(text: "PHASES", size: 11, tracking: 2, color: Theme.txt.opacity(0.6))
            ForEach(phases) { p in
                HStack(alignment: .top, spacing: 13) {
                    Rectangle()
                        .fill(phaseColor(p.type))
                        .frame(width: 3)
                        .frame(minHeight: 34)
                        .clipShape(RoundedRectangle(cornerRadius: 3))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(p.label)
                            .font(.body(14, weight: .extraBold))
                            .tracking(-0.2)
                            .foregroundStyle(Theme.txt)
                        Text(phaseSubtitle(p))
                            .font(.display(11, weight: .semibold))
                            .foregroundStyle(Theme.txt.opacity(0.66))
                    }
                    Spacer(minLength: 0)
                }
            }
        }
    }

    private func phaseSubtitle(_ p: WatchPhase) -> String {
        var parts: [String] = []
        if p.durationSec > 0 {
            let m = p.durationSec / 60
            parts.append("\(m) min")
        }
        if let mi = p.distanceMi { parts.append(String(format: "%.2f mi", mi)) }
        if let pace = p.targetPaceSPerMi {
            parts.append("@ \(pace / 60):\(String(format: "%02d", pace % 60))/mi")
        }
        return parts.joined(separator: " · ")
    }

    private func phaseColor(_ type: WatchPhaseType) -> Color {
        switch type {
        case .warmup:   return Color(hex: 0x34C194)
        case .work:     return Color(hex: 0xFF8847)
        case .recovery: return Color(hex: 0x27B4E0)
        case .cooldown: return Color(hex: 0x14C08C)
        default:        return Theme.mute
        }
    }

    private var hero: some View {
        VStack(spacing: 0) {
            SpecLabel(text: "CURRENT PACE", size: 10, tracking: 2.5, color: Theme.txt.opacity(0.6))
            HStack(alignment: .lastTextBaseline, spacing: 4) {
                Text("6:48")
                    .font(.display(70, weight: .bold))
                    .tracking(-3)
                    .foregroundStyle(Theme.txt)
                    .shadow(color: .black.opacity(0.32), radius: 26, y: 3)
                Text("/mi")
                    .font(.display(20, weight: .bold))
                    .foregroundStyle(Theme.txt.opacity(0.6))
            }
            .padding(.top, 6)

            HStack(spacing: 7) {
                Image(systemName: "checkmark")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Color(hex: 0x9AF0BF))
                Text("ON FOR 2:58 · 90s under")
                    .font(.body(12, weight: .extraBold))
                    .foregroundStyle(Color(hex: 0x9AF0BF))
            }
            .padding(.horizontal, 13).padding(.vertical, 6)
            .background(Color(hex: 0x9AF0BF).opacity(0.16), in: Capsule())
            .overlay(Capsule().stroke(Color(hex: 0x9AF0BF).opacity(0.4), lineWidth: 1))
            .padding(.top, 12)
        }
    }

    private var threeStatRow: some View {
        HStack(alignment: .top, spacing: 0) {
            statCell("1:50:12", "TIME")
            statCell("16.2", "MILES")
            statCell("163", "BPM")
        }
    }

    private func statCell(_ v: String, _ k: String) -> some View {
        VStack(spacing: 5) {
            Text(v).font(.display(23, weight: .bold)).tracking(-1).foregroundStyle(Theme.txt)
            SpecLabel(text: k, size: 9, tracking: 1.5, color: Theme.txt.opacity(0.6))
        }
        .frame(maxWidth: .infinity)
    }

    private var courseSection: some View {
        VStack(spacing: 14) {
            cueCard
            courseMap
                .frame(minHeight: 196)
            tofin
        }
    }

    private var cueCard: some View {
        HStack(spacing: 11) {
            ZStack {
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(Color(hex: 0xFFCE8A).opacity(0.18))
                    .frame(width: 30, height: 30)
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Color(hex: 0xFFCE8A))
            }
            VStack(alignment: .leading, spacing: 2) {
                SpecLabel(text: "NEXT · MILE 18", size: 9, tracking: 1.5, color: Theme.txt.opacity(0.6))
                Text("Long climb · hold effort, ease pace")
                    .font(.body(15, weight: .extraBold))
                    .foregroundStyle(Theme.txt)
            }
            Spacer()
        }
        .padding(.horizontal, 15).padding(.vertical, 12)
        .background(Color(hex: 0x1E0804).opacity(0.42), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Color.white.opacity(0.14), lineWidth: 1))
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var courseMap: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let h = geo.size.height
            ZStack {
                // Faint future path
                Path { p in
                    p.move(to: .init(x: w * 0.08, y: h * 0.76))
                    p.addCurve(to: .init(x: w * 0.36, y: h * 0.60), control1: .init(x: w * 0.17, y: h * 0.48), control2: .init(x: w * 0.28, y: h * 0.47))
                    p.addCurve(to: .init(x: w * 0.60, y: h * 0.56), control1: .init(x: w * 0.45, y: h * 0.78), control2: .init(x: w * 0.51, y: h * 0.76))
                    p.addCurve(to: .init(x: w * 0.94, y: h * 0.66), control1: .init(x: w * 0.69, y: h * 0.36), control2: .init(x: w * 0.76, y: h * 0.32))
                }
                .stroke(Color.white.opacity(0.18), style: StrokeStyle(lineWidth: 6, lineCap: .round))

                // Traveled
                Path { p in
                    p.move(to: .init(x: w * 0.08, y: h * 0.76))
                    p.addCurve(to: .init(x: w * 0.36, y: h * 0.60), control1: .init(x: w * 0.17, y: h * 0.48), control2: .init(x: w * 0.28, y: h * 0.47))
                    p.addCurve(to: .init(x: w * 0.60, y: h * 0.56), control1: .init(x: w * 0.45, y: h * 0.78), control2: .init(x: w * 0.51, y: h * 0.76))
                }
                .stroke(
                    LinearGradient(colors: [Color(hex: 0xFFE0A0), Color(hex: 0xFF7A45)], startPoint: .leading, endPoint: .trailing),
                    style: StrokeStyle(lineWidth: 3.8, lineCap: .round)
                )

                // Start dot
                Circle().fill(Color.white.opacity(0.6))
                    .frame(width: 8, height: 8)
                    .position(x: w * 0.08, y: h * 0.76)

                // Current position halo
                Circle()
                    .fill(Color(hex: 0xFF7A45).opacity(0.25))
                    .frame(width: 24, height: 24)
                    .position(x: w * 0.60, y: h * 0.56)
                Circle()
                    .stroke(Color(hex: 0xFF5A3C), lineWidth: 2.6)
                    .frame(width: 13, height: 13)
                    .background(Circle().fill(Color.white))
                    .position(x: w * 0.60, y: h * 0.56)

                // Finish flag
                ZStack(alignment: .bottomLeading) {
                    Rectangle().fill(Color(hex: 0x9AF0BF)).frame(width: 13, height: 9)
                    Rectangle().fill(Color(hex: 0x9AF0BF)).frame(width: 2, height: 24)
                }
                .position(x: w * 0.94, y: h * 0.66)
            }
        }
    }

    private var tofin: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                SpecLabel(text: "TO FINISH", size: 9, tracking: 1.2, color: Theme.txt.opacity(0.55))
                HStack(alignment: .lastTextBaseline, spacing: 3) {
                    Text("10.0").font(.display(18, weight: .bold)).foregroundStyle(Theme.txt)
                    Text("mi").font(.display(11, weight: .bold)).foregroundStyle(Theme.txt.opacity(0.6))
                }
            }
            Spacer()
            VStack(spacing: 4) {
                SpecLabel(text: "NEXT FUEL", size: 9, tracking: 1.2, color: Theme.txt.opacity(0.55))
                HStack(alignment: .lastTextBaseline, spacing: 3) {
                    Text("mi 20").font(.display(18, weight: .bold)).foregroundStyle(Theme.txt)
                    Text("gel").font(.display(11, weight: .bold)).foregroundStyle(Theme.txt.opacity(0.6))
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                SpecLabel(text: "PROJECTED", size: 9, tracking: 1.2, color: Theme.txt.opacity(0.55))
                HStack(alignment: .lastTextBaseline, spacing: 3) {
                    Text("2:58").font(.display(18, weight: .bold)).foregroundStyle(Theme.txt)
                    Text(":40").font(.display(11, weight: .bold)).foregroundStyle(Theme.txt.opacity(0.6))
                }
            }
        }
    }
}
