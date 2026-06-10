//
//  UsageSheet.swift
//  LLM spend rollup · daily briefings + tokens + USD cost from
//  /api/usage. Surfaced from Profile · DEV section so the user can
//  watch steady-state cost trends without leaving the app.
//

import SwiftUI

struct UsageSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var response: UsageResponse?
    @State private var loading: Bool = true

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Capsule().fill(Color.white.opacity(0.18))
                .frame(width: 40, height: 4)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.top, 8)
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("LLM spend")
                        .font(.display(22, weight: .bold))
                        .foregroundStyle(Theme.txt)
                    Text("Last 14 days of briefing tokens + cost.")
                        .font(.body(12.5, weight: .medium))
                        .foregroundStyle(Theme.mute)
                }
                Spacer()
                if let total = response?.totalCostUsd {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(String(format: "$%.2f", total))
                            .font(.display(22, weight: .bold)).monospacedDigit()
                            .foregroundStyle(Theme.Accent.amberGold)
                        Text("14-DAY TOTAL")
                            .font(.body(9, weight: .extraBold)).tracking(1.4)
                            .foregroundStyle(Theme.mute)
                    }
                }
            }
            .padding(.horizontal, 24).padding(.top, 12)

            if loading {
                VStack { Spacer(); ProgressView().tint(Theme.txt); Spacer() }
                    .frame(maxWidth: .infinity, minHeight: 200)
            } else if let days = response?.days, !days.isEmpty {
                ScrollView {
                    VStack(spacing: 6) {
                        ForEach(days) { d in row(d) }
                    }
                    .padding(.horizontal, 16).padding(.top, 16).padding(.bottom, 24)
                }
            } else {
                Text("No usage rolled up yet.")
                    .font(.body(13, weight: .medium))
                    .foregroundStyle(Theme.mute)
                    .padding(24)
            }
        }
        .background(Theme.Glass.strong)
        .ignoresSafeArea(edges: .bottom)
        .task {
            let r = try? await API.fetchUsage(days: 14)
            await MainActor.run { response = r; loading = false }
        }
    }

    private func row(_ d: UsageDayRow) -> some View {
        HStack(alignment: .center, spacing: 12) {
            Text(d.date)
                .font(.body(12, weight: .bold)).monospacedDigit()
                .foregroundStyle(Theme.mute)
                .frame(width: 86, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 12) {
                    metric("\(d.briefings)", unit: "briefings", color: Theme.txt)
                    metric("\(d.tokens / 1000)", unit: "k toks", color: Theme.dist)
                }
            }
            Spacer(minLength: 4)
            Text(String(format: "$%.2f", d.cost_usd))
                .font(.body(13, weight: .bold)).monospacedDigit()
                .foregroundStyle(Theme.Accent.amberGold)
        }
        .padding(12)
        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
    }

    private func metric(_ v: String, unit: String, color: Color) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 3) {
            Text(v).font(.body(14, weight: .bold)).monospacedDigit().foregroundStyle(color)
            Text(unit).font(.body(10, weight: .semibold)).foregroundStyle(Theme.mute)
        }
    }
}
