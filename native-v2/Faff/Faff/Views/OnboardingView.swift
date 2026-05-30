//
//  OnboardingView.swift
//  Welcome → connect → target → projection. Mesh migrates cool → hot.
//

import SwiftUI

struct OnboardingView: View {
    let onComplete: () -> Void

    @State private var step: Int = 0
    @State private var connected: Set<String> = []
    @State private var mode: TargetMode = .race
    @State private var distance: Distance = .marathon
    @State private var goalSec: Int = 14400
    @State private var raceName: String = ""

    enum TargetMode: String, CaseIterable { case race, goal, just }
    enum Distance: String, CaseIterable { case k5 = "5K", k10 = "10K", half = "HALF", marathon = "MARATHON" }

    private let palettes: [FaffMesh] = [
        FaffMesh(c1: 0x7FE6D6, c2: 0x5AA9D6, c3: 0x2F7FAE, c4: 0x1F6A8A, c5: 0x1A5A7A, base: 0x08222E),
        FaffMesh(c1: 0x8EF0B0, c2: 0x34C194, c3: 0x1F8A8A, c4: 0x128A64, c5: 0x137259, base: 0x06382E),
        FaffMesh(c1: 0xFFE0A0, c2: 0xF8B85F, c3: 0xE08A36, c4: 0xC96E2A, c5: 0xB46026, base: 0x5E2F12),
        FaffMesh(c1: 0xFFD27A, c2: 0xFF7A45, c3: 0xD6263C, c4: 0x9E1733, c5: 0xC01030, base: 0x420A1E)
    ]

    var body: some View {
        ZStack {
            FaffMeshView(mesh: palettes[step], transition: 0.9)

            VStack(spacing: 0) {
                topBar
                    .padding(.top, 46)
                    .padding(.horizontal, 20)

                ZStack {
                    welcomePanel.opacity(step == 0 ? 1 : 0)
                    connectPanel.opacity(step == 1 ? 1 : 0)
                    targetPanel.opacity(step == 2 ? 1 : 0)
                    projectionPanel.opacity(step == 3 ? 1 : 0)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .animation(Theme.Motion.smooth, value: step)
                .padding(.top, 32)
            }
        }
    }

    // MARK: chrome

    private var topBar: some View {
        ZStack {
            HStack {
                if step > 0 {
                    BackChip { withAnimation(Theme.Motion.smooth) { step = max(0, step - 1) } }
                }
                Spacer()
            }
            HStack(spacing: 7) {
                ForEach(0..<4, id: \.self) { i in
                    Capsule()
                        .fill(i == step ? Color.white : Color.white.opacity(0.25))
                        .frame(width: i == step ? 30 : 22, height: 4)
                }
            }
        }
        .frame(height: 36)
    }

    // MARK: welcome panel

    private var welcomePanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer(minLength: 0)
            Text("WELCOME TO")
                .font(.label(11))
                .tracking(3)
                .foregroundStyle(Theme.txt.opacity(0.66))
            HStack(spacing: 0) {
                Brandmark(size: 52, style: .swept)
                Spacer()
            }
            .padding(.top, 6)
            Text("Your training, built around what you're chasing · and honest about where you stand today.")
                .font(.body(15, weight: .semibold))
                .foregroundStyle(Theme.txt.opacity(0.84))
                .lineSpacing(4)
                .padding(.top, 18)
            LinearGradient(
                colors: [
                    Color(hex: 0x3AB0CF), Color(hex: 0x34C194), Color(hex: 0xF8B85F),
                    Color(hex: 0xFF7A45), Color(hex: 0xD6263C)
                ],
                startPoint: .leading, endPoint: .trailing
            )
            .frame(height: 10)
            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            .padding(.top, 22)
            Spacer(minLength: 0)
            ctaButton(title: "Get started") {
                withAnimation(Theme.Motion.smooth) { step = 1 }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(.horizontal, 26)
        .padding(.bottom, 30)
    }

    // MARK: connect panel

    private struct SrcRow: Identifiable {
        let id: String
        let name: String
        let sub: String
        let miles: Int
        let runs: Int
        let glyph: String
        let tint: Color
    }

    private let sources: [SrcRow] = [
        SrcRow(id: "health", name: "Apple Health", sub: "Workouts, heart, sleep",
               miles: 642, runs: 78, glyph: "heart.fill", tint: Color(hex: 0xFF2D55)),
        SrcRow(id: "strava", name: "Strava", sub: "Activity history",
               miles: 1184, runs: 142, glyph: "triangle.fill", tint: Color(hex: 0xFC4C02)),
        SrcRow(id: "garmin", name: "Garmin", sub: "Watch & metrics",
               miles: 980, runs: 120, glyph: "g.circle.fill", tint: Color(hex: 0x0A66A8))
    ]

    private var connectPanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("STEP 1")
                .font(.label(11))
                .tracking(3)
                .foregroundStyle(Theme.txt.opacity(0.66))
            Text("Bring your\nhistory in.")
                .font(.display(38, weight: .bold))
                .tracking(-1.5)
                .foregroundStyle(Theme.txt)
                .lineSpacing(-4)
                .padding(.top, 12)
            Text("Connect your watch and apps. We'll pull in every run so Faff is alive from minute one.")
                .font(.body(15, weight: .semibold))
                .foregroundStyle(Theme.txt.opacity(0.84))
                .lineSpacing(3)
                .padding(.top, 14)

            VStack(spacing: 11) {
                ForEach(sources) { src in srcRow(src) }
            }
            .padding(.top, 18)

            if !connected.isEmpty {
                importBlock
                    .padding(.top, 20)
            }

            Spacer(minLength: 0)

            ctaButton(title: "Continue", enabled: !connected.isEmpty) {
                withAnimation(Theme.Motion.smooth) { step = 2 }
            }
            Button {
                withAnimation(Theme.Motion.smooth) { step = 2 }
            } label: {
                Text("I'll start fresh")
                    .font(.body(13, weight: .bold))
                    .foregroundStyle(Theme.txt.opacity(0.6))
                    .frame(maxWidth: .infinity)
                    .padding(.top, 14)
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(.horizontal, 26)
        .padding(.bottom, 30)
    }

    private func srcRow(_ src: SrcRow) -> some View {
        let isOn = connected.contains(src.id)
        return Button {
            withAnimation(Theme.Motion.smooth) {
                if isOn { connected.remove(src.id) } else { connected.insert(src.id) }
            }
        } label: {
            HStack(spacing: 14) {
                Image(systemName: src.glyph)
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(Color.white)
                    .frame(width: 42, height: 42)
                    .background(src.tint, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(src.name)
                        .font(.body(16, weight: .extraBold))
                        .foregroundStyle(Theme.txt)
                    Text(src.sub)
                        .font(.body(11, weight: .semibold))
                        .foregroundStyle(Theme.txt.opacity(0.6))
                }
                Spacer()
                Text(isOn ? "Connected" : "Connect")
                    .font(.display(12, weight: .bold))
                    .foregroundStyle(isOn ? Color(hex: 0x7BE8A0) : Theme.txt.opacity(0.8))
            }
            .padding(EdgeInsets(top: 15, leading: 16, bottom: 15, trailing: 16))
            .background(
                Color.white.opacity(isOn ? 0.14 : 0.08),
                in: RoundedRectangle(cornerRadius: 18, style: .continuous)
            )
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(isOn ? Color(hex: 0x7BE8A0).opacity(0.5) : Color.white.opacity(0.16), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private var importBlock: some View {
        let totalMi = sources
            .filter { connected.contains($0.id) }
            .map(\.miles).max() ?? 0
        let totalRuns = sources
            .filter { connected.contains($0.id) }
            .map(\.runs).max() ?? 0
        let mergedSuffix = connected.count > 1
            ? "\nMERGED ACROSS \(connected.count) SOURCES · DUPLICATES REMOVED"
            : ""
        return VStack(spacing: 8) {
            Text("HISTORY IMPORTED")
                .font(.label(12)).tracking(1)
                .foregroundStyle(Color(hex: 0x7BE8A0))
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text("\(totalMi)")
                    .font(.display(40, weight: .bold))
                    .tracking(-2)
                    .foregroundStyle(Theme.txt)
                Text("mi")
                    .font(.body(16, weight: .extraBold))
                    .foregroundStyle(Theme.txt.opacity(0.7))
            }
            Text("\(totalRuns) RUNS · SINCE 2024" + mergedSuffix)
                .font(.display(11, weight: .bold))
                .foregroundStyle(Theme.txt.opacity(0.7))
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(18)
        .background(Color(hex: 0x7BE8A0).opacity(0.1),
                    in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous)
            .stroke(Color(hex: 0x7BE8A0).opacity(0.32), lineWidth: 1))
    }

    // MARK: target panel

    private var targetPanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("STEP 2")
                .font(.label(11)).tracking(3)
                .foregroundStyle(Theme.txt.opacity(0.66))
            Text("What are you\nchasing?")
                .font(.display(38, weight: .bold))
                .tracking(-1.5)
                .foregroundStyle(Theme.txt)
                .lineSpacing(-4)
                .padding(.top, 12)

            modeChips
                .padding(.top, 18)

            if mode == .race {
                fieldLabel("RACE NAME")
                TextField("", text: $raceName, prompt: Text("e.g. California Intl Marathon")
                    .foregroundColor(Color.white.opacity(0.4)))
                    .font(.body(16, weight: .bold))
                    .foregroundStyle(Theme.txt)
                    .padding(EdgeInsets(top: 14, leading: 16, bottom: 14, trailing: 16))
                    .background(Color.white.opacity(0.08),
                                in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(Color.white.opacity(0.2), lineWidth: 1))
                    .padding(.top, 6)
            }

            if mode != .just {
                fieldLabel("DISTANCE")
                distanceChips
                    .padding(.top, 6)
                fieldLabel("GOAL TIME")
                stepper
                    .padding(.top, 6)
            } else {
                Text("No target, no pressure. We'll keep you consistent, healthy, and ready when a goal appears.")
                    .font(.body(15, weight: .semibold))
                    .foregroundStyle(Theme.txt.opacity(0.84))
                    .lineSpacing(3)
                    .padding(.top, 16)
            }

            Spacer(minLength: 0)
            ctaButton(title: "Continue") {
                withAnimation(Theme.Motion.smooth) { step = 3 }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(.horizontal, 26)
        .padding(.bottom, 30)
    }

    private func fieldLabel(_ text: String) -> some View {
        Text(text)
            .font(.label(11)).tracking(2)
            .foregroundStyle(Theme.txt.opacity(0.55))
            .padding(.top, 24)
    }

    private var modeChips: some View {
        let modes: [(TargetMode, String)] = [
            (.race, "Train for a race"),
            (.goal, "Chase a goal time"),
            (.just, "Just keep running")
        ]
        return HStack(spacing: 8) {
            ForEach(modes, id: \.0) { m in
                chip(text: m.1, on: mode == m.0) {
                    withAnimation(Theme.Motion.smooth) { mode = m.0 }
                }
            }
        }
    }

    private var distanceChips: some View {
        HStack(spacing: 8) {
            ForEach(Distance.allCases, id: \.self) { d in
                chip(text: d.rawValue, on: distance == d) {
                    withAnimation(Theme.Motion.smooth) {
                        distance = d
                        goalSec = defaultGoal(for: d)
                    }
                }
            }
        }
    }

    private func chip(text: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(text)
                .font(.body(13, weight: .extraBold))
                .foregroundStyle(on ? Color(hex: 0x2A0E08) : Theme.txt)
                .padding(.horizontal, 16).padding(.vertical, 11)
                .background(on ? Color.white : Color.white.opacity(0.1),
                            in: Capsule())
                .overlay(Capsule().stroke(on ? Color.white : Color.white.opacity(0.2), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private var stepper: some View {
        HStack {
            stepperButton(symbol: "minus") {
                goalSec = max(stepSec * 4, goalSec - stepSec)
            }
            Spacer()
            VStack(spacing: 2) {
                Text(formatTime(goalSec))
                    .font(.display(32, weight: .bold))
                    .tracking(-1)
                    .foregroundStyle(Theme.txt)
                Text("TARGET")
                    .font(.label(10)).tracking(1.5)
                    .foregroundStyle(Theme.txt.opacity(0.55))
            }
            Spacer()
            stepperButton(symbol: "plus") {
                goalSec += stepSec
            }
        }
        .padding(EdgeInsets(top: 8, leading: 10, bottom: 8, trailing: 10))
        .background(Color.white.opacity(0.08),
                    in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous)
            .stroke(Color.white.opacity(0.18), lineWidth: 1))
    }

    private func stepperButton(symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 16, weight: .regular))
                .foregroundStyle(Theme.txt)
                .frame(width: 46, height: 46)
                .background(Color.white.opacity(0.16), in: Circle())
                .overlay(Circle().stroke(Color.white.opacity(0.28), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    // MARK: projection panel

    private var projectionPanel: some View {
        let proj = fitnessProjection(for: distance)
        let gap = proj - goalSec
        return VStack(alignment: .leading, spacing: 0) {
            Text(mode == .just ? "YOU'RE ALL SET" : "YOUR STARTING LINE")
                .font(.label(11)).tracking(3)
                .foregroundStyle(Theme.txt.opacity(0.66))
            Text(headline)
                .font(.display(38, weight: .bold))
                .tracking(-1.5)
                .foregroundStyle(Theme.txt)
                .lineSpacing(-4)
                .padding(.top, 12)

            if mode == .just {
                Text("No clock to beat · just steady, healthy miles. Your readiness and trends start tracking from your very next run.")
                    .font(.body(15, weight: .semibold))
                    .foregroundStyle(Theme.txt.opacity(0.84))
                    .lineSpacing(3)
                    .padding(.top, 14)
            } else {
                projectionBeam(proj: proj, gap: gap)
                    .padding(.top, 26)
                Text(gap > 0 ? "Now let's start running and close it." : "Keep this as a comfortable target.")
                    .font(.body(15, weight: .semibold))
                    .foregroundStyle(Theme.txt.opacity(0.92))
                    .lineSpacing(3)
                    .padding(.top, 24)
            }

            Spacer(minLength: 0)

            ctaButton(title: mode == .just ? "Start running" : "Build my plan") {
                onComplete()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(.horizontal, 26)
        .padding(.bottom, 30)
    }

    private func projectionBeam(proj: Int, gap: Int) -> some View {
        let ahead = gap <= 0
        let gapAbs = abs(gap)
        return VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                Text("PROJECTED TODAY")
                    .font(.label(10)).tracking(1.5)
                    .foregroundStyle(Theme.txt.opacity(0.55))
                Text(formatTime(proj))
                    .font(.display(42, weight: .bold))
                    .tracking(-2)
                    .foregroundStyle(ahead ? Theme.txt : Theme.txt.opacity(0.86))
                Text(connected.isEmpty
                     ? "modeled from your starting point"
                     : "modeled from your imported history")
                    .font(.display(10, weight: .bold))
                    .foregroundStyle(Theme.txt.opacity(0.5))
            }
            HStack(spacing: 18) {
                Rectangle()
                    .fill(LinearGradient(
                        colors: ahead
                        ? [Color(hex: 0x7BE8A0), Color(hex: 0xAEF0C2), Color.white]
                        : [Color(hex: 0xFF9A55), Color(hex: 0xFFD27A), Color.white],
                        startPoint: .top, endPoint: .bottom
                    ))
                    .frame(width: 4, height: 60)
                    .clipShape(Capsule())
                    .shadow(color: ahead ? Color(hex: 0x7BE8A0).opacity(0.5) : Color(hex: 0xFFB45A).opacity(0.6), radius: 20)
                VStack(alignment: .leading, spacing: 2) {
                    Text(shortClock(gapAbs))
                        .font(.display(34, weight: .bold))
                        .tracking(-1)
                        .foregroundStyle(ahead ? Color(hex: 0x7BE8A0) : Color(hex: 0xFFCE8A))
                    Text(ahead ? "AHEAD BY" : "THE GAP")
                        .font(.label(10)).tracking(2)
                        .foregroundStyle(Theme.txt.opacity(0.55))
                }
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("YOUR GOAL")
                    .font(.label(10)).tracking(1.5)
                    .foregroundStyle(Theme.txt.opacity(0.55))
                Text(formatTime(goalSec))
                    .font(.display(42, weight: .bold))
                    .tracking(-2)
                    .foregroundStyle(Color.white)
                    .shadow(color: Color(hex: 0xFFD2A0).opacity(0.5), radius: 26)
            }
        }
    }

    private var headline: String {
        switch mode {
        case .race:
            return raceName.isEmpty ? distance.rawValue : raceName
        case .goal:
            return distance.rawValue
        case .just:
            return "Let's build\na base."
        }
    }

    // MARK: shared

    private func ctaButton(title: String, enabled: Bool = true, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.body(16, weight: .extraBold))
                .foregroundStyle(Color(hex: 0x2A0E08))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 17)
                .background(Color.white.opacity(enabled ? 1.0 : 0.4),
                            in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }

    private var stepSec: Int {
        switch distance {
        case .k5: return 15
        case .k10: return 30
        case .half, .marathon: return 60
        }
    }

    private func defaultGoal(for d: Distance) -> Int {
        switch d {
        case .k5: return 1500
        case .k10: return 3300
        case .half: return 7200
        case .marathon: return 14400
        }
    }

    private func fitnessProjection(for d: Distance) -> Int {
        switch d {
        case .k5: return 1600
        case .k10: return 3360
        case .half: return 7560
        case .marathon: return 15300
        }
    }

    private func formatTime(_ s: Int) -> String {
        let h = s / 3600
        let m = (s % 3600) / 60
        let x = s % 60
        if h > 0 {
            return String(format: "%d:%02d:%02d", h, m, x)
        }
        return String(format: "%d:%02d", m, x)
    }

    private func shortClock(_ s: Int) -> String {
        let m = s / 60
        let x = s % 60
        return String(format: "%d:%02d", m, x)
    }
}
