//
//  WatchMirrorView.swift
//  Live in-run mirror of the Apple Watch. The watch owns the timer +
//  controls; the phone is read-only with a course/open layout that
//  shows the runner what's ahead.
//

import SwiftUI

struct WatchMirrorView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var liveOk: Bool = true
    @State private var workout: WatchWorkout?

    var body: some View {
        // 2026-06-02 round 36 · per-RUN effort mesh. Background tracks
        // the run's type (easy / tempo / long / intervals / etc.) ·
        // same palette doctrine as every other run surface.
        let effort = workout.map { FaffEffort.fromType($0.paceLabel ?? "easy") } ?? .easy
        let mesh = effort.mesh
        ZStack {
            FaffMeshView(mesh: mesh)

            VStack(spacing: 0) {
                // Clearance for the global top bar (50pt) + the header pill
                // (84pt). Was a top:8 floating capsule that collided with
                // the FAFF logo bar — now the status lives in a real
                // faffHeaderPill like every other surface.
                Color.clear.frame(height: 132)

                if let w = workout {
                    plannedHero(workout: w)
                        .padding(.top, 14)
                        .padding(.horizontal, 24)

                    if !w.phases.isEmpty {
                        phaseList(phases: w.phases)
                            .padding(.top, 24)
                            .padding(.horizontal, 24)
                    }
                } else {
                    // STANDING BY state · no workout loaded. The previous
                    // fallback rendered a fake live pace of 6:48 + "ON FOR
                    // 2:58 · 90s under" + a fake 1:50:12 / 16.2 mi / 163 BPM
                    // strip + a fake "NEXT · MILE 18 Long climb" cue card.
                    // Looked like a real in-progress run despite nothing
                    // actually being live. Replaced with an honest empty
                    // state.
                    standbyEmpty
                        .padding(.top, 48)
                        .padding(.horizontal, 32)
                }

                Spacer(minLength: 0)

                Text("PAUSE · LAP · END ON YOUR WATCH")
                    .font(.body(10, weight: .bold))
                    .tracking(0.5)
                    .foregroundStyle(Theme.txt.opacity(0.5))
                    .padding(.bottom, 28)
            }
        }
        .task {
            do {
                workout = try await API.fetchWatchWorkout()
                liveOk = true
            } catch {
                liveOk = false
            }
        }
        .faffHeaderPill { mirrorPill }
        // 2026-06-02 round 34 · hide the floating tab bar during live
        // mirror · the watch run is the focus, no tab nav needed.
        .hideFaffTabBar()
    }

    /// Standard header pill · live status on the left, a Cancel control on
    /// the right so the runner can always leave the mirror (the route is
    /// pushed with the nav bar hidden, so there was no back affordance).
    /// The watch still owns pause/lap/end — Cancel only closes this screen.
    private var mirrorPill: some View {
        HStack(spacing: 11) {
            LivePulseDot(color: liveOk ? Theme.Accent.mintGlow : Color(hex: 0xFF5A52), size: 8)
                .frame(width: 14, height: 14)
            VStack(alignment: .leading, spacing: 2) {
                Text(workout != nil ? "TODAY'S PLAN" : "STANDING BY")
                    .font(.body(9.5, weight: .extraBold)).tracking(2)
                    .foregroundStyle(Theme.txt.opacity(0.6))
                Text(workout?.name ?? "Start on your Apple Watch")
                    .font(.body(15, weight: .extraBold)).tracking(-0.2)
                    .foregroundStyle(Theme.txt)
                    .lineLimit(1).minimumScaleFactor(0.7)
            }
            Spacer(minLength: 8)
            Button { dismiss() } label: {
                Text("Cancel")
                    .font(.body(13, weight: .extraBold))
                    .foregroundStyle(Theme.txt)
                    .padding(.horizontal, 15).padding(.vertical, 9)
                    .background(Color.white.opacity(0.12), in: Capsule())
                    .overlay(Capsule().stroke(Color.white.opacity(0.22), lineWidth: 1))
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 15)
        .padding(.vertical, 12)
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
                            .font(.body(11, weight: .semibold))
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
        case .warmup:   return Theme.neutralTeal
        case .work:     return Color(hex: 0xFF5722)
        case .recovery: return Color(hex: 0x27B4E0)
        case .cooldown: return Color(hex: 0x14C08C)
        default:        return Theme.mute
        }
    }

    /// Empty / standby state when no workout is loaded · was a hardcoded
    /// CURRENT PACE 6:48 + ON FOR 2:58 + 1:50:12 / 16.2 mi / 163 BPM strip
    /// + NEXT MILE 18 cue card that looked like a real in-progress run.
    private var standbyEmpty: some View {
        VStack(spacing: 18) {
            Image(systemName: "applewatch.radiowaves.left.and.right")
                .font(.system(size: 36, weight: .regular))
                .foregroundStyle(Theme.txt.opacity(0.7))
            Text("Standing by")
                .font(.display(20, weight: .bold))
                .tracking(-0.5)
                .foregroundStyle(Theme.txt)
            Text("Start the workout on your Apple Watch and this screen will mirror it · pace, heart rate, splits, the upcoming cue.")
                .font(.body(14, weight: .semibold))
                .multilineTextAlignment(.center)
                .foregroundStyle(Theme.txt.opacity(0.7))
                .lineSpacing(3)
        }
    }
}
