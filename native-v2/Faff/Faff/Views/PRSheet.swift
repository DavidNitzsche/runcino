//
//  PRSheet.swift
//  PR celebration · hottest, brightest, radiating sunburst.
//

import SwiftUI

struct PRSheet: View {
    let onShare: () -> Void
    let onView: () -> Void

    private let mesh = FaffMesh(
        c1: 0xFFE0A0, c2: 0xFF9560, c3: 0xD6451F,
        c4: 0xA8231A, c5: 0xA8231A, base: 0x3A0F06
    )

    var body: some View {
        ZStack {
            FaffMeshView(mesh: mesh)
            SunburstRays()
                .allowsHitTesting(false)

            VStack(alignment: .center, spacing: 0) {
                badge
                    .padding(.top, 74)

                Spacer(minLength: 0)

                center

                Spacer(minLength: 0)

                actions
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(.horizontal, 28)
            .padding(.bottom, 30)
        }
    }

    private var badge: some View {
        HStack(spacing: 8) {
            Image(systemName: "trophy.fill")
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(Color(hex: 0xFFE0A0))
            Text("PERSONAL RECORD")
                .font(.label(12)).tracking(3)
                .foregroundStyle(Theme.txt)
        }
        .padding(.horizontal, 18).padding(.vertical, 9)
        .background(Color.white.opacity(0.14), in: Capsule())
        .overlay(Capsule().stroke(Color.white.opacity(0.28), lineWidth: 1))
        .background(.ultraThinMaterial, in: Capsule())
    }

    private var center: some View {
        VStack(spacing: 0) {
            Text("NEW PR")
                .font(.label(13)).tracking(4)
                .foregroundStyle(Theme.txt.opacity(0.85))
            Text("Half Marathon")
                .font(.body(22, weight: .extraBold))
                .foregroundStyle(Theme.txt.opacity(0.9))
                .padding(.top, 10)
            Text("1:29:48")
                .font(.display(84, weight: .bold))
                .tracking(-4)
                .foregroundStyle(Theme.txt)
                .padding(.top, 8)
                .shadow(color: .black.opacity(0.4), radius: 40, y: 4)

            improvementChip
                .padding(.top, 20)

            compareRow
                .padding(.top, 26)

            coachCard
                .padding(.top, 30)
        }
    }

    private var improvementChip: some View {
        HStack(spacing: 8) {
            Image(systemName: "arrow.up")
                .font(.system(size: 13, weight: .heavy))
                .foregroundStyle(Color(hex: 0x9AF0BF))
            Text("2:22 faster · first sub-1:30")
                .font(.display(14, weight: .bold))
                .foregroundStyle(Color(hex: 0x9AF0BF))
        }
        .padding(.horizontal, 16).padding(.vertical, 8)
        .background(Color(hex: 0x9AF0BF).opacity(0.16), in: Capsule())
        .overlay(Capsule().stroke(Color(hex: 0x9AF0BF).opacity(0.4), lineWidth: 1))
    }

    private var compareRow: some View {
        HStack(spacing: 16) {
            Text("WAS 1:32:10")
                .font(.display(13, weight: .bold))
                .foregroundStyle(Theme.txt.opacity(0.55))
                .strikethrough(true, color: Theme.txt.opacity(0.55))
            Image(systemName: "arrow.right")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(Theme.txt.opacity(0.6))
            Text("NOW 1:29:48")
                .font(.display(16, weight: .bold))
                .foregroundStyle(Theme.txt)
        }
    }

    private var coachCard: some View {
        HStack(alignment: .top, spacing: 11) {
            Text("COACH")
                .font(.label(9)).tracking(1)
                .foregroundStyle(Color(hex: 0x3A0F06))
                .padding(.horizontal, 7).padding(.vertical, 4)
                .background(Color(hex: 0x9AF0BF),
                            in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                .padding(.top, 2)
            Text("That's a 2:22 PR and your first sub-1:30. Even splits, negative second half · the threshold work is paying off. CIM's sub-3 is right on track.")
                .font(.body(15, weight: .semibold))
                .foregroundStyle(Theme.txt.opacity(0.94))
                .lineSpacing(4)
                .multilineTextAlignment(.leading)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: 320)
    }

    private var actions: some View {
        HStack(spacing: 11) {
            Button(action: onShare) {
                Text("Share")
                    .font(.body(15, weight: .extraBold))
                    .foregroundStyle(Color(hex: 0xA8231A))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(Color.white, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(.plain)

            Button(action: onView) {
                Text("View run")
                    .font(.body(15, weight: .extraBold))
                    .foregroundStyle(Theme.txt)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(Color.white.opacity(0.12),
                                in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(Color.white.opacity(0.26), lineWidth: 1))
            }
            .buttonStyle(.plain)
        }
    }
}

private struct SunburstRays: View {
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0/30.0)) { ctx in
            let t = ctx.date.timeIntervalSinceReferenceDate
            let angle = Angle(degrees: (t * 6).truncatingRemainder(dividingBy: 360))
            GeometryReader { geo in
                let size = max(geo.size.width, geo.size.height) * 1.6
                AngularGradient(
                    gradient: Gradient(stops: rayStops),
                    center: .center,
                    angle: angle
                )
                .frame(width: size, height: size)
                .position(x: geo.size.width / 2, y: geo.size.height * 0.34)
                .opacity(0.5)
                .mask(
                    RadialGradient(
                        gradient: Gradient(colors: [.black, .black.opacity(0)]),
                        center: .init(x: 0.5, y: 0.34),
                        startRadius: 0,
                        endRadius: max(geo.size.width, geo.size.height) * 0.6
                    )
                )
            }
        }
    }

    private var rayStops: [Gradient.Stop] {
        var stops: [Gradient.Stop] = []
        let raySpan: Double = 360.0 / 90.0
        for i in 0..<90 {
            let start = Double(i) * raySpan / 360.0
            let mid = (Double(i) + 0.3) * raySpan / 360.0
            let end = (Double(i) + 1.0) * raySpan / 360.0
            stops.append(.init(color: Color.white.opacity(0.16), location: start))
            stops.append(.init(color: Color.white.opacity(0.16), location: mid))
            stops.append(.init(color: .clear, location: mid + 0.0001))
            stops.append(.init(color: .clear, location: end))
        }
        return stops
    }
}
