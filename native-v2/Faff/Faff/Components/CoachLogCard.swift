//
//  CoachLogCard.swift
//  COACH'S LOG on Train · web recomposition deck, Decision 8,
//  placement 2 (approved 2026-08-17).
//
//  Reads GET /api/coach/log (newest first): week closes, phase
//  boundaries, all-time firsts, and every silent re-pace the engine ever
//  applied, spoken. The log lives on Train because that is where the
//  plan's story belongs.
//
//  No new visual grammar. The card body reuses the exact container
//  TrainView's `fullPlanCard` already uses (0x0C1416 @ 32%, r22, white
//  15% hairline) and the same eyebrow treatment (10.5 extra-bold,
//  tracking 1.4, ink at 66%), so the log reads as another Train card
//  rather than an import from another surface.
//
//  Paging: ~5 rows visible, then a MORE affordance. The first tap reveals
//  the rest of the page already in hand; subsequent taps pull the next
//  page with the server's own `nextBefore` cursor. When the cursor comes
//  back nil the affordance disappears — there is nothing left, and a
//  button that fetches nothing is a lie.
//

import SwiftUI

struct CoachLogCard: View {
    /// Rows visible before the MORE affordance.
    static let collapsedCount = 5

    @State private var entries: [CoachLogEntry] = []
    @State private var nextBefore: String? = nil
    @State private var expanded = false
    @State private var loading = false
    @State private var loadedOnce = false

    var body: some View {
        // Nothing logged yet is a real state for a runner whose first week
        // has not closed. Render nothing rather than an empty box.
        if loadedOnce && entries.isEmpty {
            EmptyView()
        } else {
            card
                .task { await loadFirstPageIfNeeded() }
        }
    }

    private var visible: [CoachLogEntry] {
        expanded ? entries : Array(entries.prefix(Self.collapsedCount))
    }

    /// The affordance shows while either more rows are already loaded or
    /// the server says another page exists.
    private var hasMore: Bool {
        (!expanded && entries.count > Self.collapsedCount) || nextBefore != nil
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("COACH'S LOG")
                .font(.body(10.5, weight: .extraBold))
                .tracking(1.4)
                .foregroundStyle(Theme.txt.opacity(0.66))
                .padding(.bottom, 13)

            if entries.isEmpty && loading {
                Text("Loading")
                    .font(.body(12, weight: .semibold))
                    .foregroundStyle(Theme.txt.opacity(0.45))
                    .padding(.vertical, 6)
            }

            ForEach(Array(visible.enumerated()), id: \.element.id) { idx, e in
                if idx > 0 {
                    Divider()
                        .background(Color.white.opacity(0.08))
                        .padding(.vertical, 11)
                }
                row(e)
            }

            if hasMore {
                Button {
                    Task { await more() }
                } label: {
                    HStack(spacing: 6) {
                        Text(loading ? "LOADING" : "MORE")
                            .font(.body(11, weight: .extraBold))
                            .tracking(1.0)
                        if !loading {
                            Image(systemName: "chevron.down")
                                .font(.system(size: 10, weight: .bold))
                        }
                    }
                    .foregroundStyle(Theme.txt.opacity(0.6))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                }
                .buttonStyle(.plain)
                .disabled(loading)
                .padding(.top, 12)
            }
        }
        .padding(15)
        .background(Color(hex: 0x0C1416).opacity(0.32),
                    in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(Color.white.opacity(0.15), lineWidth: 1)
        )
    }

    /// One entry · accent rule, title, body, and the date stamp on the
    /// right (the deck's row shape).
    private func row(_ e: CoachLogEntry) -> some View {
        HStack(alignment: .top, spacing: 11) {
            Capsule()
                .fill(e.accent)
                .frame(width: 3)
                .padding(.vertical, 2)
            VStack(alignment: .leading, spacing: 4) {
                Text(e.title)
                    .font(.body(12.5, weight: .extraBold))
                    .foregroundStyle(Theme.txt)
                    .fixedSize(horizontal: false, vertical: true)
                Text(e.body)
                    .font(.body(12, weight: .medium))
                    .foregroundStyle(Theme.txt.opacity(0.74))
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            Text(e.stampLabel)
                .font(.body(9.5, weight: .extraBold))
                .tracking(1.1)
                .foregroundStyle(Theme.txt.opacity(0.4))
                .padding(.top, 1)
        }
    }

    // MARK: - Loading

    private func loadFirstPageIfNeeded() async {
        guard !loadedOnce, !loading else { return }
        loading = true
        let page = (try? await API.fetchCoachLog(limit: 20)) ?? CoachLogPage(ok: false, entries: [], nextBefore: nil)
        await MainActor.run {
            entries = page.entries.filter(\.isRenderable)
            nextBefore = page.nextBefore
            loading = false
            loadedOnce = true
        }
    }

    /// First tap reveals what is already loaded; after that, page.
    private func more() async {
        if !expanded && entries.count > Self.collapsedCount {
            await MainActor.run { withAnimation(Theme.Motion.smooth) { expanded = true } }
            return
        }
        guard let cursor = nextBefore, !loading else { return }
        await MainActor.run { loading = true }
        let page = (try? await API.fetchCoachLog(limit: 20, before: cursor)) ?? CoachLogPage(ok: false, entries: [], nextBefore: nil)
        await MainActor.run {
            let known = Set(entries.map(\.id))
            withAnimation(Theme.Motion.smooth) {
                entries.append(contentsOf: page.entries.filter { $0.isRenderable && !known.contains($0.id) })
                expanded = true
            }
            nextBefore = page.nextBefore
            loading = false
        }
    }
}
