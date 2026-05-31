//
//  LearnArticleSheet.swift
//  Modal reader for a single doctrine article from /api/learn/[slug].
//  Mirrors the web /health learn modal: eyebrow → title → body paragraphs
//  → citations list → related articles. Stays inside the iPhone's dark
//  mesh — no system sheet chrome. New surface 2026-05-30 after backend
//  audit seeded 45 articles.
//

import SwiftUI

struct LearnArticleSheet: View {
    let slug: String

    @State private var article: LearnArticle?
    @State private var loading = true

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let mesh = FaffMesh.forView(.health)
        ZStack {
            FaffMeshView(mesh: mesh)

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    header
                        .padding(.horizontal, 22)
                        .padding(.top, 8)

                    if loading {
                        loadingState
                            .padding(.horizontal, 24)
                            .padding(.top, 40)
                    } else if let a = article {
                        bodyContent(a)
                    } else {
                        notFoundState
                            .padding(.horizontal, 24)
                            .padding(.top, 40)
                    }
                }
                .padding(.bottom, 60)
            }
        }
        .task { await load() }
    }

    // MARK: - Body sections

    private var header: some View {
        HStack(spacing: 12) {
            BackChip { dismiss() }
            SpecLabel(text: "LEARN", size: 13, tracking: 2.5, color: Theme.txt)
            Spacer()
        }
    }

    private func bodyContent(_ a: LearnArticle) -> some View {
        VStack(alignment: .leading, spacing: 22) {
            // Eyebrow + title
            VStack(alignment: .leading, spacing: 10) {
                if let eyebrow = a.eyebrow, !eyebrow.isEmpty {
                    SpecLabel(text: eyebrow.uppercased(), size: 11, tracking: 2.5, color: Theme.txt.opacity(0.66))
                }
                Text(a.title)
                    .font(.display(34, weight: .bold))
                    .tracking(-1.0)
                    .foregroundStyle(Theme.txt)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 22)
            .padding(.top, 18)

            // Body paragraphs — split on double newlines.
            VStack(alignment: .leading, spacing: 14) {
                ForEach(Array(paragraphs(a.body_md).enumerated()), id: \.offset) { _, para in
                    Text(para)
                        .font(.body(15, weight: .regular))
                        .foregroundStyle(Theme.txt.opacity(0.85))
                        .lineSpacing(4)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.horizontal, 22)

            // Citations
            if let cites = a.citations_json, !cites.isEmpty {
                citationsSection(cites)
                    .padding(.horizontal, 22)
            }

            // Related slugs
            if let rel = a.related_slugs, !rel.isEmpty {
                relatedSection(rel)
                    .padding(.horizontal, 22)
            }
        }
    }

    private func citationsSection(_ cites: [LearnCitation]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            SpecLabel(text: "CITATIONS", size: 11, tracking: 2, color: Theme.txt.opacity(0.55))
            GlassTile(padding: 0) {
                VStack(spacing: 0) {
                    ForEach(Array(cites.enumerated()), id: \.offset) { i, c in
                        VStack(alignment: .leading, spacing: 4) {
                            Text("\(c.author) (\(c.year))")
                                .font(.display(12, weight: .semibold))
                                .foregroundStyle(Theme.txt.opacity(0.85))
                            Text(c.title)
                                .font(.body(13, weight: .regular))
                                .foregroundStyle(Theme.txt.opacity(0.65))
                                .fixedSize(horizontal: false, vertical: true)
                            if let j = c.journal, !j.isEmpty {
                                Text(j)
                                    .font(.body(11, weight: .medium))
                                    .foregroundStyle(Theme.txt.opacity(0.45))
                                    .italic()
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(14)
                        if i < cites.count - 1 {
                            Divider().background(Color.white.opacity(0.08))
                        }
                    }
                }
            }
        }
    }

    private func relatedSection(_ slugs: [String]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            SpecLabel(text: "RELATED", size: 11, tracking: 2, color: Theme.txt.opacity(0.55))
            VStack(spacing: 8) {
                ForEach(slugs, id: \.self) { s in
                    NavigationLink(value: FaffRoute.learn(slug: s)) {
                        HStack {
                            Text(prettyTitle(s))
                                .font(.body(14, weight: .semibold))
                                .foregroundStyle(Theme.txt)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.system(size: 12, weight: .bold))
                                .foregroundStyle(Theme.txt.opacity(0.4))
                        }
                        .padding(14)
                        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(Color.white.opacity(0.1), lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    // MARK: - Empty + loading states

    private var loadingState: some View {
        VStack(alignment: .leading, spacing: 14) {
            SpecLabel(text: "LOADING", size: 11, tracking: 2, color: Theme.txt.opacity(0.55))
            Text("Pulling the doctrine.")
                .font(.body(15, weight: .regular))
                .foregroundStyle(Theme.txt.opacity(0.6))
        }
    }

    private var notFoundState: some View {
        VStack(alignment: .leading, spacing: 14) {
            SpecLabel(text: "NOT FOUND", size: 11, tracking: 2, color: Theme.txt.opacity(0.55))
            Text("This article hasn't been published yet.")
                .font(.body(15, weight: .regular))
                .foregroundStyle(Theme.txt.opacity(0.6))
        }
    }

    // MARK: - Helpers

    private func paragraphs(_ md: String) -> [String] {
        md.components(separatedBy: "\n\n").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }

    private func prettyTitle(_ slug: String) -> String {
        slug.split(separator: "-").map { $0.capitalized }.joined(separator: " ")
    }

    private func load() async {
        let a = try? await API.fetchLearnArticle(slug: slug)
        await MainActor.run {
            self.article = a
            self.loading = false
        }
    }
}
