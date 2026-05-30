//
//  RolePickView.swift
//  Pick a side, mesh rolls warm (runner) or cool (spectator).
//

import SwiftUI

struct RolePickView: View {
    let onPick: (Role) -> Void

    enum Role { case runner, spectator }

    @State private var selected: Role = .runner

    private let warm = FaffMesh(
        c1: 0xFFCE8A, c2: 0xFF8A4D, c3: 0xEF4F2A,
        c4: 0xD6263C, c5: 0xD6263C, base: 0x3A0E12
    )
    private let cool = FaffMesh(
        c1: 0x7FE6D6, c2: 0x3FB6B0, c3: 0x1F8F76,
        c4: 0x2AA0A8, c5: 0x2AA0A8, base: 0x06302E
    )

    var body: some View {
        ZStack {
            FaffMeshView(mesh: selected == .runner ? warm : cool, transition: 0.9)

            VStack(alignment: .leading, spacing: 0) {
                Brandmark(size: 22, style: .swept)
                    .padding(.top, 54)

                Text("How will\nyou use\nFaff?")
                    .font(.heroDisplay(42))
                    .tracking(-2.2)
                    .foregroundStyle(Theme.txt)
                    .lineSpacing(-6)
                    .shadow(color: .black.opacity(0.32), radius: 26, y: 2)
                    .padding(.top, 30)

                Text("You can switch or do both, anytime.")
                    .font(.body(14, weight: .semibold))
                    .foregroundStyle(Theme.txt.opacity(0.72))
                    .padding(.top, 14)

                Spacer(minLength: 0)

                cards
                    .padding(.vertical, 20)

                Spacer(minLength: 0)

                continueButton
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(.horizontal, 24)
            .padding(.bottom, 28)
        }
    }

    private var cards: some View {
        VStack(spacing: 14) {
            roleCard(
                role: .runner,
                eyebrow: "COACHED EVERY DAY",
                title: "I'm a runner",
                desc: "A plan that adapts to you · from base miles to your goal race."
            )
            roleCard(
                role: .spectator,
                eyebrow: "LIVE FOLLOW",
                title: "I'm here to cheer",
                desc: "Follow your runners live · how they're doing, where to stand, send cheers."
            )
        }
    }

    private func roleCard(role: Role, eyebrow: String, title: String, desc: String) -> some View {
        let on = selected == role
        return Button {
            withAnimation(Theme.Motion.smooth) { selected = role }
        } label: {
            ZStack(alignment: .topTrailing) {
                VStack(alignment: .leading, spacing: 11) {
                    Text(eyebrow)
                        .font(.label(10))
                        .tracking(2.5)
                        .foregroundStyle(Theme.txt.opacity(0.7))
                    Text(title)
                        .font(.display(30, weight: .bold))
                        .tracking(-1)
                        .foregroundStyle(Theme.txt)
                        .lineSpacing(-2)
                    Text(desc)
                        .font(.body(13.5, weight: .medium))
                        .foregroundStyle(Theme.txt.opacity(0.76))
                        .lineSpacing(3)
                        .frame(maxWidth: 250, alignment: .leading)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(EdgeInsets(top: 24, leading: 22, bottom: 24, trailing: 22))
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    Color.white.opacity(on ? 0.16 : 0.08),
                    in: RoundedRectangle(cornerRadius: 24, style: .continuous)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 24, style: .continuous)
                        .stroke(Color.white.opacity(on ? 0.92 : 0.16), lineWidth: 1.5)
                )
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 24, style: .continuous))

                pickDot(on: on)
                    .padding(22)
            }
        }
        .buttonStyle(.plain)
    }

    private func pickDot(on: Bool) -> some View {
        ZStack {
            Circle()
                .fill(on ? Color.white : Color.clear)
                .frame(width: 26, height: 26)
                .overlay(Circle().stroke(Color.white.opacity(on ? 1.0 : 0.35), lineWidth: 2))
            if on {
                Image(systemName: "checkmark")
                    .font(.system(size: 13, weight: .heavy))
                    .foregroundStyle(selected == .runner ? Color(hex: 0x3A0E12) : Color(hex: 0x06302E))
            }
        }
    }

    private var continueButton: some View {
        Button {
            onPick(selected)
        } label: {
            HStack(spacing: 8) {
                Text(selected == .runner ? "Continue as a runner" : "Continue as a spectator")
                    .font(.body(16, weight: .extraBold))
                Image(systemName: "arrow.right")
                    .font(.system(size: 14, weight: .heavy))
            }
            .foregroundStyle(selected == .runner ? Color(hex: 0x3A0E12) : Color(hex: 0x06302E))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 17)
            .background(Color.white, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}
