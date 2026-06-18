//
//  ProView.swift
//  Faff Pro upgrade · hot purple-orange premium mesh.
//

import SwiftUI

struct ProView: View {
    @Environment(\.dismiss) private var dismiss

    enum Plan { case annual, monthly }
    @State private var plan: Plan = .annual

    private let mesh = FaffMesh(
        c1: 0xF3AD38, c2: 0xD03F3F, c3: 0x9E3AA0,
        c4: 0x5A1C8A, c5: 0x5A1C8A, base: 0x1C0C20
    )

    var body: some View {
        ZStack {
            FaffMeshView(mesh: mesh)

            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    closeRow
                        .padding(.top, 48)
                        .padding(.horizontal, 22)
                    hero
                        .padding(.top, 8)
                        .padding(.horizontal, 26)
                    features
                        .padding(.horizontal, 26)
                        .padding(.top, 24)
                    plans
                        .padding(.horizontal, 22)
                        .padding(.top, 26)
                    primaryCTA
                        .padding(.horizontal, 22)
                        .padding(.top, 22)
                    trialLine
                        .padding(.top, 14)
                    fine
                        .padding(.horizontal, 30)
                        .padding(.top, 14)
                        .padding(.bottom, 40)
                }
            }
        }
    }

    private var closeRow: some View {
        HStack {
            Spacer()
            Button { dismiss() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Theme.txt)
                    .frame(width: 32, height: 32)
                    .background(Color.white.opacity(0.14), in: Circle())
                    .overlay(Circle().stroke(Color.white.opacity(0.24), lineWidth: 1))
            }
            .buttonStyle(.plain)
        }
    }

    private var hero: some View {
        VStack(spacing: 12) {
            HStack(spacing: 7) {
                Image(systemName: "star.fill")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Color(hex: 0x1C0C20))
                Text("FAFF PRO")
                    .font(.label(11)).tracking(2.5)
                    .foregroundStyle(Color(hex: 0x1C0C20))
            }
            .padding(.horizontal, 14).padding(.vertical, 6)
            .background(
                LinearGradient(colors: [Color(hex: 0xF3AD38), Color(hex: 0xD03F3F)],
                               startPoint: .leading, endPoint: .trailing),
                in: Capsule()
            )

            Text("Your coach,\nunlocked.")
                .font(.display(42, weight: .bold))
                .tracking(-2)
                .multilineTextAlignment(.center)
                .foregroundStyle(Theme.txt)
                .lineSpacing(-4)
                .padding(.top, 6)

            Text("A plan that adapts every day, deep analytics, and everything that makes Faff yours.")
                .font(.body(15, weight: .semibold))
                .foregroundStyle(Theme.txt.opacity(0.8))
                .multilineTextAlignment(.center)
                .lineSpacing(3)
        }
    }

    private struct Feat: Hashable {
        let icon: String
        let tint: Color
        let title: String
        let sub: String
    }

    private let feats: [Feat] = [
        Feat(icon: "circle.dashed", tint: Color(hex: 0xFF7A8A),
             title: "Adaptive AI plan", sub: "retunes daily from readiness, sleep & load"),
        Feat(icon: "chart.xyaxis.line", tint: Color(hex: 0xFFAE7A),
             title: "Full analytics & trends", sub: "form, cadence, GCT, every history chart"),
        Feat(icon: "sun.max.fill", tint: Color(hex: 0xF3AD38),
             title: "Heat & weather recalibration", sub: "targets & HR read adjusted to conditions"),
        Feat(icon: "target", tint: Theme.Accent.mintReady,
             title: "Unlimited race goals", sub: "every distance, projections & the gap"),
        Feat(icon: "person.2.fill", tint: Theme.dist,
             title: "Spectator sharing", sub: "let family follow you live on race day")
    ]

    private var features: some View {
        VStack(alignment: .leading, spacing: 15) {
            ForEach(feats, id: \.self) { f in
                HStack(alignment: .top, spacing: 13) {
                    Image(systemName: f.icon)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(f.tint)
                        .frame(width: 26, height: 26)
                        .background(f.tint.opacity(0.2),
                                    in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(f.title)
                            .font(.body(15, weight: .bold))
                            .foregroundStyle(Theme.txt)
                        Text(f.sub)
                            .font(.body(12, weight: .medium))
                            .foregroundStyle(Theme.txt.opacity(0.6))
                            .lineSpacing(2)
                    }
                    Spacer()
                }
            }
        }
    }

    private var plans: some View {
        HStack(spacing: 11) {
            planCard(.annual,
                     label: "ANNUAL",
                     price: "$69.99",
                     unit: "/yr",
                     note: "$5.83 / mo",
                     save: "SAVE 40%")
            planCard(.monthly,
                     label: "MONTHLY",
                     price: "$9.99",
                     unit: "/mo",
                     note: "billed monthly",
                     save: nil)
        }
    }

    private func planCard(_ p: Plan, label: String, price: String, unit: String, note: String, save: String?) -> some View {
        let on = plan == p
        return Button {
            withAnimation(Theme.Motion.smooth) { plan = p }
        } label: {
            ZStack(alignment: .topTrailing) {
                VStack(alignment: .leading, spacing: 0) {
                    Text(label)
                        .font(.label(11)).tracking(1)
                        .foregroundStyle(Theme.txt.opacity(0.7))
                    HStack(alignment: .firstTextBaseline, spacing: 2) {
                        Text(price)
                            .font(.display(24, weight: .semibold))
                            .tracking(-1)
                            .foregroundStyle(Theme.txt)
                        Text(unit)
                            .font(.body(12, weight: .semibold))
                            .foregroundStyle(Theme.txt.opacity(0.6))
                    }
                    .padding(.top, 8)
                    Text(note)
                        .font(.body(10, weight: .bold))
                        .foregroundStyle(Theme.txt.opacity(0.55))
                        .padding(.top, 5)
                }
                .padding(EdgeInsets(top: 16, leading: 14, bottom: 16, trailing: 14))
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    on ? Color(hex: 0xF3AD38).opacity(0.12) : Color.white.opacity(0.07),
                    in: RoundedRectangle(cornerRadius: 18, style: .continuous)
                )
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(on ? Color(hex: 0xF3AD38) : Color.white.opacity(0.16), lineWidth: 1.5))

                if let save {
                    Text(save)
                        .font(.label(8.5)).tracking(0.5)
                        .foregroundStyle(Color(hex: 0x0A3A2A))
                        .padding(.horizontal, 7).padding(.vertical, 3)
                        .background(Theme.green, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                        .offset(x: -12, y: -9)
                }
            }
        }
        .buttonStyle(.plain)
    }

    private var primaryCTA: some View {
        Button {
            // StoreKit hook lands later.
        } label: {
            Text("Start 7-day free trial")
                .font(.body(16, weight: .extraBold))
                .foregroundStyle(Color(hex: 0x1C0C20))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 18)
                .background(
                    LinearGradient(colors: [Color(hex: 0xF3AD38), Color(hex: 0xD03F3F)],
                                   startPoint: .leading, endPoint: .trailing),
                    in: RoundedRectangle(cornerRadius: 18, style: .continuous)
                )
                .shadow(color: Color(hex: 0xD03F3F).opacity(0.6), radius: 34, y: 14)
        }
        .buttonStyle(.plain)
    }

    private var trialLine: some View {
        Text(plan == .annual ? "Then $69.99/yr · cancel anytime" : "Then $9.99/mo · cancel anytime")
            .font(.body(11, weight: .semibold))
            .foregroundStyle(Theme.txt.opacity(0.6))
            .frame(maxWidth: .infinity)
    }

    private var fine: some View {
        Text("Payment charged to your App Store account. Auto-renews unless canceled 24h before period ends. Terms · Privacy · Restore")
            .font(.body(9.5, weight: .semibold))
            .foregroundStyle(Theme.txt.opacity(0.4))
            .multilineTextAlignment(.center)
            .lineSpacing(3)
    }
}
