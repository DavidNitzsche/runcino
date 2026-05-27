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
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                Text("FORM · WHAT IT MEANS · WHAT TO DO")
                    .font(.label(10)).tracking(1.4)
                    .foregroundStyle(Theme.mute)
                    .padding(.horizontal, 24)

                if !tips.isEmpty {
                    VStack(spacing: 10) {
                        ForEach(tips) { tip in
                            Button { selected = tip } label: { tipCard(tip) }
                                .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 24)
                    .transition(.opacity)
                } else if loading {
                    tipsSkeleton
                        .transition(.opacity)
                } else {
                    Text("Couldn't load tips.")
                        .font(.body(13)).foregroundStyle(Theme.mute)
                        .padding(.horizontal, 24)
                }
                }
                .padding(.bottom, 40)
                .animation(.spring(response: 0.45, dampingFraction: 0.85), value: tips.count)
            }
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle("Tips")
            .navigationBarTitleDisplayMode(.large)
            .task { await load() }
            .refreshable { await load() }
            .sensoryFeedback(.selection, trigger: selected?.id)
            .sheet(item: $selected) { tip in
                FormTipDetailSheet(tip: tip)
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
            }
        }
    }

    /// Skeleton tip cards — same shape as the real ones — so the screen
    /// doesn't go blank while /api/tips is in flight.
    private var tipsSkeleton: some View {
        VStack(spacing: 10) {
            ForEach(0..<5, id: \.self) { _ in
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        RoundedRectangle(cornerRadius: 4)
                            .fill(Theme.ink.opacity(0.06))
                            .frame(width: 140, height: 22)
                        Spacer()
                        RoundedRectangle(cornerRadius: 3)
                            .fill(Theme.ink.opacity(0.05))
                            .frame(width: 50, height: 10)
                    }
                    RoundedRectangle(cornerRadius: 3)
                        .fill(Theme.ink.opacity(0.05))
                        .frame(height: 13)
                    RoundedRectangle(cornerRadius: 3)
                        .fill(Theme.ink.opacity(0.05))
                        .frame(maxWidth: 200, alignment: .leading)
                        .frame(height: 13)
                    HStack(spacing: 8) {
                        ForEach(0..<3, id: \.self) { _ in
                            Capsule()
                                .fill(Theme.ink.opacity(0.04))
                                .frame(width: 50, height: 16)
                        }
                    }
                }
                .padding(18)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.white.opacity(0.025))
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.line, lineWidth: 1))
            }
        }
        .padding(.horizontal, 24)
    }

    private func tipCard(_ tip: FormTip) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(tip.title).font(.display(22)).foregroundStyle(Theme.ink)
                Spacer()
                Text("READ →")
                    .font(.label(10)).tracking(1.2)
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
                            .font(.label(10)).tracking(1.6)
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
                            .font(.label(10)).tracking(1.4)
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
                                .font(.label(10)).tracking(1.4)
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
            Text(label).font(.label(10)).tracking(1.4)
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
