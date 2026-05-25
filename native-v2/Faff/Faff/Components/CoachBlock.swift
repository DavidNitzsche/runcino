//
//  CoachBlock.swift
//  Coach hero — lead + voice paragraphs + reply chips.
//  Mirrors web-v2/components/cards/CoachBlock.tsx, §8.1 closed loop.
//

import SwiftUI

struct CoachBlock: View {
    let lead: String?
    let voice: [String]
    let briefingId: String?
    let askPrompt: String
    var onCheckIn: ((CheckInRating) async -> Bool)? = nil

    enum CheckInRating: String { case solid, tired, wrecked }

    @State private var selected: CheckInRating?
    @State private var ack: String?
    @State private var pending = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            // Eyebrow
            HStack(spacing: 8) {
                Circle().fill(Theme.green).frame(width: 6, height: 6)
                    .shadow(color: Theme.green.opacity(0.6), radius: 6)
                Text("COACH").font(.body(10, weight: .bold)).tracking(1.6)
                    .foregroundStyle(Theme.green)
            }

            if let lead {
                Text(lead).font(.display(32)).tracking(0.5)
                    .foregroundStyle(Theme.ink).lineSpacing(2)
            }

            ForEach(Array(voice.enumerated()), id: \.offset) { _, paragraph in
                paragraphView(paragraph)
            }

            if let ack {
                Text(ack).font(.body(13)).italic().foregroundStyle(Theme.green)
                    .padding(.top, 4)
            }

            Text(askPrompt).font(.body(12)).foregroundStyle(Theme.mute)
                .padding(.top, 8)

            HStack(spacing: 8) {
                chipButton(.solid,   color: Theme.green)
                chipButton(.tired,   color: Theme.goal)
                chipButton(.wrecked, color: Theme.over)
            }
        }
        .padding(.horizontal, 24)
        .padding(.top, 22)
        .padding(.bottom, 22)
    }

    /// Render **bold** spans inline (LLM emits markdown-ish emphasis).
    private func paragraphView(_ text: String) -> some View {
        var attr = AttributedString(text)
        // Parse **bold** spans into the AttributedString
        var working = text
        while let range = working.range(of: #"\*\*[^*]+\*\*"#, options: .regularExpression) {
            let raw = String(working[range])
            let inner = String(raw.dropFirst(2).dropLast(2))
            if let attrRange = attr.range(of: raw) {
                attr.replaceSubrange(attrRange, with: AttributedString(inner))
                if let newRange = attr.range(of: inner) {
                    attr[newRange].font = .body(15.5, weight: .semibold)
                    attr[newRange].foregroundColor = Theme.ink
                }
            }
            working.replaceSubrange(range, with: inner)
        }
        return Text(attr)
            .font(.body(15.5))
            .foregroundStyle(Theme.ink.opacity(0.86))
            .lineSpacing(4)
    }

    @ViewBuilder
    private func chipButton(_ rating: CheckInRating, color: Color) -> some View {
        let isSelected = selected == rating
        let isDisabled = selected != nil && !isSelected
        Button {
            Task { await submit(rating) }
        } label: {
            Text(rating.rawValue.uppercased())
                .font(.display(18)).tracking(1.2)
                .foregroundStyle(isSelected ? color : (isDisabled ? Theme.dim : Theme.ink))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(isSelected ? color.opacity(0.12) : Color.clear)
                .overlay(RoundedRectangle(cornerRadius: 14)
                    .stroke(isSelected ? color : Theme.line, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 14))
        }
        .disabled(pending || isDisabled)
        .opacity(isDisabled ? 0.5 : 1)
        .buttonStyle(.plain)
    }

    @MainActor
    private func submit(_ rating: CheckInRating) async {
        guard !pending else { return }
        selected = rating
        pending = true
        defer { pending = false }
        // Can't put `await` inside `??` autoclosure — unwrap explicitly.
        let ok: Bool
        if let handler = onCheckIn {
            ok = await handler(rating)
        } else {
            ok = await defaultCheckIn(rating)
        }
        ack = !ok ? "(couldn't save — we'll try again)"
            : rating == .solid   ? "OK. Hold the plan."
            : rating == .tired   ? "OK — we'll see how the legs are tomorrow."
                                 : "OK. We'll back off tomorrow."
    }

    private func defaultCheckIn(_ rating: CheckInRating) async -> Bool {
        do {
            try await API.checkin(rating: rating.rawValue, briefingId: briefingId)
            return true
        } catch {
            return false
        }
    }
}
