//
//  TipsView.swift  (P40)
//  Form-metric tips library — mirrors web /tips. Tap a tip → detail sheet.
//

import SwiftUI

struct TipsView: View {
    @State private var tips: [FormTip] = []
    @State private var loading = true
    @State private var selected: FormTip?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .firstTextBaseline) {
                    Text("TIPS").font(.display(26)).tracking(1.2).foregroundStyle(Theme.ink)
                    Spacer()
                }
                .padding(.horizontal, 24).padding(.top, 8)

                Text("FORM · WHAT IT MEANS · WHAT TO DO")
                    .font(.body(10, weight: .bold)).tracking(1.4)
                    .foregroundStyle(Theme.mute)
                    .padding(.horizontal, 24)

                if loading {
                    HStack { Spacer(); ProgressView().tint(Theme.green); Spacer() }
                        .padding(40)
                } else if tips.isEmpty {
                    Text("Couldn't load tips.")
                        .font(.body(13)).foregroundStyle(Theme.mute)
                        .padding(.horizontal, 24)
                } else {
                    VStack(spacing: 10) {
                        ForEach(tips) { tip in
                            Button { selected = tip } label: { tipCard(tip) }
                                .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 24)
                }
            }
            .padding(.bottom, 40)
        }
        .background(Theme.bg.ignoresSafeArea())
        .task { await load() }
        .refreshable { await load() }
        .sheet(item: $selected) { tip in
            FormTipDetailSheet(tip: tip)
        }
    }

    private func tipCard(_ tip: FormTip) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(tip.title).font(.display(22)).foregroundStyle(Theme.ink)
                Spacer()
                Text("READ →")
                    .font(.body(10, weight: .bold)).tracking(1.2)
                    .foregroundStyle(Theme.learn)
            }
            Text(tip.one_liner)
                .font(.body(13))
                .foregroundStyle(Theme.mute)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
            HStack(spacing: 8) {
                ForEach(tip.bands) { b in
                    Text(b.range)
                        .font(.body(10))
                        .foregroundStyle(Theme.ink.opacity(0.55))
                        .padding(.horizontal, 9).padding(.vertical, 3)
                        .background(Capsule().fill(Color.white.opacity(0.04)))
                        .overlay(Capsule().stroke(Color.white.opacity(0.08), lineWidth: 1))
                }
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white.opacity(0.025))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.line, lineWidth: 1))
    }

    private func load() async {
        defer { loading = false }
        guard let url = URL(string: "https://www.faff.run/api/tips") else { return }
        if let (data, _) = try? await URLSession.shared.data(from: url),
           let decoded = try? JSONDecoder().decode(TipsResponse.self, from: data) {
            tips = decoded.tips
        }
    }
}

// MARK: - Tip detail sheet

struct FormTipDetailSheet: View {
    let tip: FormTip
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("FORM TIP")
                            .font(.body(10, weight: .bold)).tracking(1.6)
                            .foregroundStyle(Theme.learn)
                        Text(tip.title)
                            .font(.display(34)).foregroundStyle(Theme.ink)
                        Text(tip.unit.uppercased())
                            .font(.body(11, weight: .semibold))
                            .foregroundStyle(Theme.mute)
                    }
                    .padding(.horizontal, 24)
                    .padding(.top, 6)

                    section("WHAT IT IS", tip.what_it_is)
                    section("WHY IT MATTERS", tip.why_it_matters)

                    VStack(alignment: .leading, spacing: 10) {
                        Text("BANDS")
                            .font(.body(10, weight: .bold)).tracking(1.4)
                            .foregroundStyle(Theme.mute)
                        VStack(spacing: 8) {
                            ForEach(tip.bands) { b in
                                bandRow(b)
                            }
                        }
                    }
                    .padding(.horizontal, 24)

                    if !tip.drills_when_flagged.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("WHAT TO DO IF FLAGGED")
                                .font(.body(10, weight: .bold)).tracking(1.4)
                                .foregroundStyle(Theme.goal)
                            VStack(alignment: .leading, spacing: 6) {
                                ForEach(tip.drills_when_flagged, id: \.self) { d in
                                    HStack(alignment: .top, spacing: 8) {
                                        Text("·").foregroundStyle(Theme.goal)
                                        Text(d).font(.body(13))
                                            .foregroundStyle(Theme.ink.opacity(0.85))
                                            .multilineTextAlignment(.leading)
                                    }
                                }
                            }
                        }
                        .padding(.horizontal, 24)
                    }
                }
                .padding(.vertical, 18)
            }
            .background(Theme.bg.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { dismiss() }.foregroundStyle(Theme.green)
                }
            }
        }
    }

    private func section(_ label: String, _ body: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label).font(.body(10, weight: .bold)).tracking(1.4)
                .foregroundStyle(Theme.mute)
            Text(body).font(.body(14))
                .foregroundStyle(Theme.ink.opacity(0.9))
                .lineSpacing(2)
                .multilineTextAlignment(.leading)
        }
        .padding(.horizontal, 24)
    }

    private func bandRow(_ b: FormBand) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(b.label).font(.body(13, weight: .semibold))
                    .foregroundStyle(colorForBand(b.band))
                Spacer()
                Text(b.range).font(.body(11))
                    .foregroundStyle(Theme.mute)
            }
            Text(b.meaning).font(.body(11))
                .foregroundStyle(Theme.ink.opacity(0.65))
                .multilineTextAlignment(.leading)
        }
        .padding(10)
        .background(Color.white.opacity(0.025))
        .clipShape(RoundedRectangle(cornerRadius: 9))
        .overlay(RoundedRectangle(cornerRadius: 9).stroke(Theme.line, lineWidth: 1))
    }

    private func colorForBand(_ b: String) -> Color {
        switch b {
        case "elite": return Theme.green
        case "good":  return Theme.dist
        case "fine":  return Theme.learn
        case "flag":  return Theme.over
        default:      return Theme.mute
        }
    }
}
