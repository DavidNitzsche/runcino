//
//  WithinReachSheet.swift
//  Within reach · the coach spots a PR one effort away.
//

import SwiftUI

struct WithinReachSheet: View {
    let onAccept: () -> Void
    let onLater: () -> Void

    private let mesh = FaffMesh(
        c1: 0xFFE9B0, c2: 0xFFC15E, c3: 0xE89030,
        c4: 0xA86420, c5: 0xA86420, base: 0x3A2208
    )

    var body: some View {
        ZStack {
            FaffMeshView(mesh: mesh)

            VStack(alignment: .leading, spacing: 0) {
                tag
                    .padding(.top, 54)
                content
                    .padding(.top, 22)
                Spacer(minLength: 0)
                actions
            }
            .padding(.horizontal, 26)
            .padding(.bottom, 30)
        }
    }

    private var tag: some View {
        HStack(spacing: 9) {
            Image(systemName: "scope")
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(Color(hex: 0xFFE9B0))
            Text("WITHIN REACH")
                .font(.label(12)).tracking(2.5)
                .foregroundStyle(Theme.txt)
            Spacer()
        }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Your 5K best\nis right there.")
                .font(.display(42, weight: .bold))
                .tracking(-1.8)
                .foregroundStyle(Theme.txt)
                .lineSpacing(-4)
                .shadow(color: .black.opacity(0.3), radius: 24, y: 2)

            HStack(alignment: .firstTextBaseline, spacing: 9) {
                Text("YOU'RE")
                    .font(.display(14, weight: .bold))
                    .tracking(1)
                    .foregroundStyle(Theme.txt.opacity(0.85))
                Text("8 seconds")
                    .font(.display(23, weight: .bold))
                    .tracking(-0.5)
                    .foregroundStyle(Color(hex: 0xFFE9B0))
                Text("AWAY")
                    .font(.display(14, weight: .bold))
                    .tracking(1)
                    .foregroundStyle(Theme.txt.opacity(0.85))
            }
            .padding(.top, 18)

            beam
                .padding(.top, 26)

            coachLine
                .padding(.top, 30)

            goalCard
                .padding(.top, 24)
        }
    }

    private var beam: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack {
                Text("RECENT 20:24")
                    .font(.display(10, weight: .bold))
                    .foregroundStyle(Theme.txt.opacity(0.7))
                Spacer()
                Text("5K PR · 20:16")
                    .font(.display(10, weight: .bold))
                    .foregroundStyle(Theme.txt.opacity(0.7))
            }
            GapBeam(
                progress: 0.92,
                height: 10,
                fillStops: [Color(hex: 0xFFE9B0), Color(hex: 0xFFB24D)],
                gapColor: Color(hex: 0xFFE9B0)
            )
        }
    }

    private var coachLine: some View {
        HStack(alignment: .top, spacing: 11) {
            Text("COACH")
                .font(.label(9)).tracking(1)
                .foregroundStyle(Color(hex: 0x3A2208))
                .padding(.horizontal, 7).padding(.vertical, 4)
                .background(Color(hex: 0xFFE9B0),
                            in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                .padding(.top, 2)
            Text("Your last three tempo runs put a 5K PR within one good effort. You're not chasing it · you're basically already there. Want to make it official and go for it?")
                .font(.body(15, weight: .semibold))
                .foregroundStyle(Theme.txt.opacity(0.94))
                .lineSpacing(4)
            Spacer(minLength: 0)
        }
    }

    private var goalCard: some View {
        HStack(spacing: 14) {
            Image(systemName: "scope")
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(Color(hex: 0xFFE9B0))
                .frame(width: 40, height: 40)
                .background(Color(hex: 0xFFE9B0).opacity(0.18),
                            in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Text("SUGGESTED GOAL")
                    .font(.label(10)).tracking(1.5)
                    .foregroundStyle(Theme.txt.opacity(0.6))
                Text("5K · break 20:00")
                    .font(.body(17, weight: .extraBold))
                    .foregroundStyle(Theme.txt)
                Text("~3–4 weeks · one focused effort")
                    .font(.display(10.5, weight: .bold))
                    .foregroundStyle(Theme.txt.opacity(0.6))
            }
            Spacer()
        }
        .padding(EdgeInsets(top: 15, leading: 17, bottom: 15, trailing: 17))
        .background(Color(hex: 0x1C0E02).opacity(0.5),
                    in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous)
            .stroke(Color(hex: 0xFFE9B0).opacity(0.3), lineWidth: 1))
        .background(.ultraThinMaterial,
                    in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private var actions: some View {
        VStack(spacing: 11) {
            Button(action: onAccept) {
                Text("Add this goal")
                    .font(.body(16, weight: .extraBold))
                    .foregroundStyle(Color(hex: 0x3A2208))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 17)
                    .background(Color(hex: 0xFFE9B0),
                                in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .shadow(color: Color(hex: 0xFFC15E).opacity(0.5), radius: 30, y: 12)
            }
            .buttonStyle(.plain)

            Button(action: onLater) {
                Text("Maybe later")
                    .font(.body(13, weight: .bold))
                    .foregroundStyle(Theme.txt.opacity(0.6))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 4)
            }
            .buttonStyle(.plain)
        }
    }
}
