//
//  LearnModal.swift  (P40)
//  Reusable sheet for in-app doctrine reads. Drop in via:
//      .sheet(isPresented: $showLearn) { LearnModal(slug: "hr-zones") }
//
//  Loads /api/learn/[slug] (DB-backed when seeded; falls back to seed.ts).
//

import SwiftUI

struct LearnModal: View {
    let slug: String

    @Environment(\.dismiss) private var dismiss
    @State private var article: LearnArticle?
    @State private var loading = true

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if loading {
                        HStack { Spacer(); ProgressView().tint(Theme.green); Spacer() }
                            .padding(40)
                    } else if let a = article {
                        VStack(alignment: .leading, spacing: 4) {
                            if let eyebrow = a.eyebrow {
                                Text(eyebrow.uppercased())
                                    .font(.label(10)).tracking(1.6)
                                    .foregroundStyle(Theme.learn)
                            }
                            Text(a.title).font(.display(34)).foregroundStyle(Theme.ink)
                        }
                        .padding(.horizontal, 24)
                        .padding(.top, 6)

                        // Minimal markdown rendering: headings, paragraphs, lists.
                        VStack(alignment: .leading, spacing: 10) {
                            ForEach(Array(parseMarkdown(a.body_md).enumerated()), id: \.offset) { _, block in
                                renderBlock(block)
                            }
                        }
                        .padding(.horizontal, 24)
                    } else {
                        Text("Couldn't load this article.")
                            .font(.body(13)).foregroundStyle(Theme.mute)
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
        .task { await load() }
    }

    private func load() async {
        defer { loading = false }
        guard let url = URL(string: "https://www.faff.run/api/learn/\(slug)") else { return }
        if let (data, _) = try? await URLSession.shared.data(from: url) {
            article = try? JSONDecoder().decode(LearnArticle.self, from: data)
        }
    }

    // MARK: - Minimal markdown

    enum MdBlock { case h2(String), p(String), li(String) }

    private func parseMarkdown(_ md: String) -> [MdBlock] {
        var out: [MdBlock] = []
        for raw in md.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = String(raw).trimmingCharacters(in: .whitespaces)
            if line.isEmpty { continue }
            if line.hasPrefix("## ") {
                out.append(.h2(String(line.dropFirst(3))))
            } else if line.hasPrefix("# ") {
                out.append(.h2(String(line.dropFirst(2))))
            } else if line.hasPrefix("- ") || line.hasPrefix("* ") {
                out.append(.li(String(line.dropFirst(2))))
            } else {
                out.append(.p(line))
            }
        }
        return out
    }

    @ViewBuilder
    private func renderBlock(_ block: MdBlock) -> some View {
        switch block {
        case .h2(let t):
            Text(t.uppercased())
                .font(.label(11)).tracking(1.4)
                .foregroundStyle(Theme.green)
                .padding(.top, 6)
        case .p(let t):
            Text(t)
                .font(.body(14))
                .foregroundStyle(Theme.ink.opacity(0.9))
                .lineSpacing(3)
                .multilineTextAlignment(.leading)
        case .li(let t):
            HStack(alignment: .top, spacing: 8) {
                Text("·").foregroundStyle(Theme.learn)
                Text(t).font(.body(14))
                    .foregroundStyle(Theme.ink.opacity(0.85))
                    .lineSpacing(2)
                    .multilineTextAlignment(.leading)
            }
        }
    }
}
