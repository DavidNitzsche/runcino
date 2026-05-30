//
//  ColdStartView.swift
//  Cold-start empty states · activity ghost heatmap / health ghost ring.
//

import SwiftUI

struct ColdStartView: View {
    let mode: Mode

    enum Mode: String, CaseIterable { case activity, health }

    @State private var current: Mode

    init(mode: Mode) {
        self.mode = mode
        _current = State(initialValue: mode)
    }

    private var meshForMode: FaffMesh {
        switch current {
        case .activity:
            return FaffMesh(c1: 0x7A3A18, c2: 0x1F5A64, c3: 0x5E2F12,
                            c4: 0x16110D, c5: 0x16110D, base: 0x16110D)
        case .health:
            return FaffMesh(c1: 0x2F9A7E, c2: 0x1F5A64, c3: 0x0E1F1C,
                            c4: 0x0E1F1C, c5: 0x0E1F1C, base: 0x0E1F1C)
        }
    }

    var body: some View {
        ZStack {
            FaffMeshView(mesh: meshForMode, transition: 0.6)

            VStack(spacing: 0) {
                header
                    .padding(.top, 50)
                    .padding(.horizontal, 24)
                toggle
                    .padding(.top, 14)
                    .padding(.horizontal, 24)

                Spacer(minLength: 0)

                center
                    .padding(.horizontal, 24)

                Spacer(minLength: 0)
            }
            .padding(.bottom, 28)
        }
    }

    private var header: some View {
        HStack {
            SpecLabel(text: current == .activity ? "ACTIVITY" : "HEALTH",
                      size: 13, tracking: 2.5, color: Theme.txt)
            Spacer()
        }
    }

    private var toggle: some View {
        HStack(spacing: 0) {
            toggleButton(.activity, "ACTIVITY")
            toggleButton(.health, "HEALTH")
        }
        .padding(4)
        .background(Color.white.opacity(0.1),
                    in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 26, style: .continuous)
            .stroke(Color.white.opacity(0.2), lineWidth: 1))
    }

    private func toggleButton(_ m: Mode, _ label: String) -> some View {
        let on = current == m
        return Button {
            withAnimation(Theme.Motion.smooth) { current = m }
        } label: {
            Text(label)
                .font(.body(12, weight: .extraBold))
                .tracking(0.8)
                .foregroundStyle(on ? Color(hex: 0x0E1F1C) : Theme.txt)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .background(on ? Color.white : Color.clear,
                            in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var center: some View {
        VStack(spacing: 0) {
            switch current {
            case .activity:
                ghostHeatmap
                    .padding(.bottom, 26)
                copy(
                    title: "Your first run\nstarts the story.",
                    desc: "Every mile, record, and streak fills in from here. Run with your watch or start a treadmill session.",
                    note: "NOTHING TO SHOW YET · BY DESIGN.",
                    secondary: "Connect a watch to import history"
                )
            case .health:
                ghostRing
                    .padding(.bottom, 26)
                copy(
                    title: "Building your\nbaseline.",
                    desc: "Readiness, HRV trends, and form metrics need a few runs to learn what's normal for you. Check back in about a week.",
                    note: "3–5 RUNS TO YOUR FIRST READINESS SCORE.",
                    secondary: "Connect Apple Health to skip the wait"
                )
            }
        }
        .frame(maxWidth: .infinity)
    }

    private var ghostHeatmap: some View {
        HStack(spacing: 3) {
            ForEach(0..<12, id: \.self) { _ in
                VStack(spacing: 3) {
                    ForEach(0..<7, id: \.self) { _ in
                        RoundedRectangle(cornerRadius: 3, style: .continuous)
                            .fill(Color.white.opacity(0.07))
                            .frame(width: 11, height: 11)
                    }
                }
            }
        }
    }

    private var ghostRing: some View {
        ZStack {
            Circle()
                .stroke(Color.white.opacity(0.12), lineWidth: 9)
                .frame(width: 150, height: 150)
            Circle()
                .trim(from: 0, to: 0.05)
                .stroke(Color.white.opacity(0.28),
                        style: StrokeStyle(lineWidth: 9, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .frame(width: 150, height: 150)
            Text("?")
                .font(.display(52, weight: .bold))
                .foregroundStyle(Theme.txt.opacity(0.5))
        }
    }

    private func copy(title: String, desc: String, note: String, secondary: String) -> some View {
        VStack(spacing: 14) {
            Text(title)
                .font(.display(26, weight: .bold))
                .tracking(-1)
                .multilineTextAlignment(.center)
                .foregroundStyle(Theme.txt)
                .lineSpacing(0)
            Text(desc)
                .font(.body(15, weight: .semibold))
                .foregroundStyle(Theme.txt.opacity(0.78))
                .multilineTextAlignment(.center)
                .lineSpacing(4)
                .frame(maxWidth: 280)
            Text(note)
                .font(.display(10.5, weight: .bold))
                .tracking(0.3)
                .foregroundStyle(Theme.txt.opacity(0.5))
                .multilineTextAlignment(.center)
                .padding(.top, 4)
            Button {
                // Start run hook lands later.
            } label: {
                Text("Start a run")
                    .font(.body(15, weight: .extraBold))
                    .foregroundStyle(Color(hex: 0x0E1F1C))
                    .padding(.horizontal, 30)
                    .padding(.vertical, 15)
                    .background(Color.white, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(.plain)
            .padding(.top, 16)
            Button {
                // Connect flow hook lands later.
            } label: {
                Text(secondary)
                    .font(.body(13, weight: .bold))
                    .foregroundStyle(Theme.txt)
                    .padding(.horizontal, 18).padding(.vertical, 13)
                    .background(Color.white.opacity(0.12),
                                in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(Color.white.opacity(0.3), lineWidth: 1))
            }
            .buttonStyle(.plain)
        }
    }
}
