//
//  PaywallView.swift
//  Hot ember Pro paywall · "Train like you mean it."
//

import SwiftUI

struct PaywallView: View {
    @Environment(\.dismiss) private var dismiss

    enum Plan { case annual, monthly }
    @State private var plan: Plan = .annual

    private let mesh = FaffMesh(
        c1: 0xFFE0A0, c2: 0xF8B85F, c3: 0xB46026,
        c4: 0x7A3A18, c5: 0x7A3A18, base: 0x5E2F12
    )

    var body: some View {
        ZStack {
            FaffMeshView(mesh: mesh)

            VStack(alignment: .leading, spacing: 0) {
                closeButton
                Text("FAFF PRO")
                    .font(.label(12)).tracking(4)
                    .foregroundStyle(Theme.txt.opacity(0.8))
                    .padding(.top, 6)
                (Text("Train like\nyou ")
                    .foregroundColor(Theme.txt)
                 + Text("mean it.")
                    .foregroundColor(Color(hex: 0xFFE0A0)))
                    .font(.display(46, weight: .bold))
                    .tracking(-2)
                    .lineSpacing(-6)
                    .shadow(color: .black.opacity(0.3), radius: 22, y: 2)
                features
                    .padding(.top, 24)
                Spacer(minLength: 0)
                plans
                cta
                    .padding(.top, 14)
                fine
                    .padding(.top, 13)
            }
            .padding(.horizontal, 24)
            .padding(.top, 48)
            .padding(.bottom, 26)
        }
    }

    private var closeButton: some View {
        HStack {
            Spacer()
            Button { dismiss() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Theme.txt)
                    .frame(width: 32, height: 32)
                    .background(Color.white.opacity(0.16), in: Circle())
            }
            .buttonStyle(.plain)
        }
    }

    private struct Feat: Hashable {
        let icon: String
        let title: String
        let sub: String
    }

    private let feats: [Feat] = [
        Feat(icon: "chart.line.uptrend.xyaxis", title: "A plan that adapts every day", sub: "rebuilt from your readiness & results"),
        Feat(icon: "heart.fill", title: "Readiness & form science", sub: "HRV, GCT, cadence, the full picture"),
        Feat(icon: "flag.checkered", title: "Race projections & the gap", sub: "know exactly where you stand"),
        Feat(icon: "infinity", title: "Unlimited history & Shoe Garage", sub: "nothing capped, ever")
    ]

    private var features: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(feats, id: \.self) { f in
                HStack(spacing: 13) {
                    Image(systemName: f.icon)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Color(hex: 0xFFE0A0))
                        .frame(width: 30, height: 30)
                        .background(Color.white.opacity(0.16),
                                    in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                    VStack(alignment: .leading, spacing: 1) {
                        Text(f.title)
                            .font(.body(15, weight: .bold))
                            .foregroundStyle(Theme.txt)
                        Text(f.sub)
                            .font(.body(12, weight: .semibold))
                            .foregroundStyle(Theme.txt.opacity(0.65))
                    }
                    Spacer()
                }
            }
        }
    }

    private var plans: some View {
        HStack(spacing: 10) {
            planCard(.annual, label: "ANNUAL", price: "$5.83", unit: "/mo", desc: "$69.99 billed yearly", badge: "SAVE 33%")
            planCard(.monthly, label: "MONTHLY", price: "$8.99", unit: "/mo", desc: "billed monthly", badge: nil)
        }
    }

    private func planCard(_ p: Plan, label: String, price: String, unit: String, desc: String, badge: String?) -> some View {
        let on = plan == p
        return Button { withAnimation(Theme.Motion.smooth) { plan = p } } label: {
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
                            .font(.display(11, weight: .semibold))
                            .foregroundStyle(Theme.txt.opacity(0.6))
                    }
                    .padding(.top, 8)
                    Text(desc)
                        .font(.body(11, weight: .semibold))
                        .foregroundStyle(Theme.txt.opacity(0.6))
                        .padding(.top, 5)
                }
                .padding(EdgeInsets(top: 15, leading: 14, bottom: 15, trailing: 14))
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    on
                    ? Color(hex: 0xFFE0A0).opacity(0.14)
                    : Color(hex: 0x1E0C02).opacity(0.4),
                    in: RoundedRectangle(cornerRadius: 18, style: .continuous)
                )
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(on ? Color(hex: 0xFFE0A0) : Color.white.opacity(0.18), lineWidth: 1.5))

                if let badge {
                    Text(badge)
                        .font(.label(8.5)).tracking(0.5)
                        .foregroundStyle(Color(hex: 0x3A1808))
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(
                            LinearGradient(colors: [Color(hex: 0xFFE0A0), Color(hex: 0xFF9560)],
                                           startPoint: .leading, endPoint: .trailing),
                            in: RoundedRectangle(cornerRadius: 6, style: .continuous)
                        )
                        .offset(x: -12, y: -9)
                }
            }
        }
        .buttonStyle(.plain)
    }

    private var cta: some View {
        Button {
            // StoreKit hook lands later.
        } label: {
            Text(plan == .annual ? "Start 7-day free trial" : "Subscribe monthly")
                .font(.body(16, weight: .extraBold))
                .foregroundStyle(Color(hex: 0x9E4A17))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 17)
                .background(Color.white, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .shadow(color: .black.opacity(0.45), radius: 28, y: 10)
        }
        .buttonStyle(.plain)
    }

    private var fine: some View {
        Text("Then $69.99/yr. Cancel anytime. · Restore · Terms")
            .font(.display(10, weight: .semibold))
            .foregroundStyle(Theme.txt.opacity(0.55))
            .frame(maxWidth: .infinity)
    }
}
