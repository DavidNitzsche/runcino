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
    /// Optional prompt rendered above the SOLID/TIRED/WRECKED chips. Nil
    /// (or empty) suppresses both the prompt AND the chips, e.g. on
    /// profile/race-detail surfaces that don't request a check-in.
    let askPrompt: String?
    var onCheckIn: ((CheckInRating) async -> Bool)? = nil

    enum CheckInRating: String { case solid, tired, wrecked }

    @State private var selected: CheckInRating?
    @State private var ack: String?
    @State private var pending = false

    var body: some View {
        // DISPATCH — the coach voice gets a designated, typeset slot
        // (telex / wire-service framing) instead of floating prose. Ruled
        // header with a registration dot + label + mono stamp; editorial
        // lead; Inter body; flattened spec-style check-in. Paper gut
        // 2026-05-29.
        VStack(alignment: .leading, spacing: 0) {
            // Ruled header band
            HStack(spacing: 8) {
                RegistrationDot(tone: .green, size: 7)
                SpecLabel("DISPATCH", size: 10, tone: .green)
                Spacer()
                Stamp("COACH", tone: .mute)
            }
            .padding(.bottom, 12)
            Rectangle().fill(Theme.line).frame(height: 1)

            if let lead {
                // No lineLimit clamp — long leads wrap freely.
                Text(lead).font(.display(28)).tracking(0.4)
                    .foregroundStyle(Theme.ink).lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .multilineTextAlignment(.leading)
                    .padding(.top, 14)
            }

            VStack(alignment: .leading, spacing: 10) {
                ForEach(Array(voice.enumerated()), id: \.offset) { _, paragraph in
                    paragraphView(paragraph)
                }
            }
            .padding(.top, voice.isEmpty ? 0 : 12)

            if let ack {
                Text(ack).font(.body(13)).italic().foregroundStyle(Theme.green)
                    .padding(.top, 10)
            }

            if let askPrompt, !askPrompt.isEmpty {
                Text(askPrompt.uppercased()).font(.label(10)).tracking(1.4)
                    .foregroundStyle(Theme.mute)
                    .padding(.top, 16).padding(.bottom, 8)

                HStack(spacing: 0) {
                    chipButton(.solid,   color: Theme.green)
                    chipButton(.tired,   color: Theme.goal)
                    chipButton(.wrecked, color: Theme.over)
                }
                .overlay(Rectangle().stroke(Theme.line, lineWidth: 1))
            }
        }
        .padding(.horizontal, 24)
        .padding(.top, 20)
        .padding(.bottom, 22)
        // Subtle haptic on chip-select + a heavier "success" thump when
        // the ack lands so check-ins feel like a real interaction.
        .sensoryFeedback(.selection, trigger: selected)
        .sensoryFeedback(.success, trigger: ack)
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
                .font(.label(11)).tracking(1.4)
                .foregroundStyle(isSelected ? color : (isDisabled ? Theme.dim : Theme.ink))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 13)
                .background(isSelected ? color.opacity(0.10) : Color.clear)
                .overlay(alignment: .leading) {
                    // hairline divider between segments (skip the first)
                    if rating != .solid {
                        Rectangle().fill(Theme.line).frame(width: 1)
                    }
                }
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
