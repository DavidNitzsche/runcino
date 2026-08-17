//
//  MorningBriefBlock.swift
//  The composed morning brief on Today · web recomposition deck,
//  Decision 8, placement 1 (approved 2026-08-17).
//
//  The paragraph is composed SERVER-SIDE (web-v2/lib/coach/morning-brief.ts)
//  and rides on GET /api/briefing?surface=today as `morning_brief`. This
//  view renders it verbatim — it never re-joins the sentences, because a
//  client-side join would drift from the web's wording and the two
//  surfaces would stop telling the same story.
//
//  Placement, adapted to the locked native layout (Header → 84pt frosted
//  pill → big headline → content): the deck puts the brief "directly
//  under the Today header, above the hero". On iPhone the header slot is
//  the frosted week-strip pill, so the brief becomes the FIRST thing in
//  the scrolling content, immediately above the 88pt hero word — the same
//  reading order as the mock, expressed in the native chrome.
//
//  Nil-safe by construction: the whole view collapses to EmptyView when
//  the field is absent or the paragraph is blank, so there is no spacer,
//  no divider and no layout shift on a morning with no brief (and on any
//  server deploy that predates the field).
//
//  Type: Inter body (never Oswald — this is prose, and Oswald is display
//  only), dim ink, generous leading. It speaks first and then gets out of
//  the way: quieter than the hero it sits above.
//

import SwiftUI

struct MorningBriefBlock: View {
    let brief: MorningBrief?
    /// Eyebrow copy. "THIS MORNING" on a morning surface; the caller can
    /// pass a post-race variant without a second component.
    var eyebrow: String = "THIS MORNING"

    var body: some View {
        if let b = brief, b.isRenderable {
            VStack(alignment: .leading, spacing: 7) {
                Text(eyebrow)
                    .font(.body(9.5, weight: .extraBold))
                    .tracking(1.5)
                    .foregroundStyle(Theme.txt.opacity(0.42))
                Text(b.paragraph)
                    .font(.body(13, weight: .medium))
                    .foregroundStyle(Theme.txt.opacity(0.72))
                    // Generous leading · this is the one paragraph of
                    // continuous prose on the surface and it has to read
                    // as prose, not as a data label.
                    .lineSpacing(4.5)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
