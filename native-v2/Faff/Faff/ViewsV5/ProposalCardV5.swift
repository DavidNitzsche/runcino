//
//  ProposalCardV5.swift
//  faff.run iPhone · V5PROPOSAL-1 · an adaptation the runner can answer.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHAT WAS WRONG
//
//  The engine has written `plan_workout_proposals` since 2026-06-04, and the
//  flow around it is complete: a cron detects, a row is written, an accept
//  route re-applies it through `applyAdaptations`, a dismiss route closes it.
//  Everything except the part where a runner sees it.
//
//  The only Swift caller of `/api/plan/workout-proposals` is
//  `Views/TodayView.swift`, the v4 shell, reachable only under `-faffLegacy`.
//  So in the app that actually ships there was no proposal surface at all.
//  Production has SEVEN rows ever written, zero accepted, zero dismissed, and
//  one from 2026-08-25 still sitting pending eleven days later.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY THIS IS SMALL
//
//  `PRODUCT_UX_SIMPLIFICATION_DOCTRINE`: only surface information that changes
//  what the runner should understand or do next. A pending adaptation is
//  exactly that and nothing more, so the card is a direction, a headline, a
//  sentence and two buttons. The evidence trail, the alternatives considered
//  and the ranking belong in a trace, not on Today.
//
//  Direction is drawn as a word and a colour, never as a judgement. Amber for
//  a reduction because the app already uses amber for "attention, nothing is
//  broken", signal orange for an increase because it is the thing the runner
//  most wants to see and has never once been offered.
//

import SwiftUI

struct ProposalCardV5: View {
    let proposal: V5Proposal
    /// Accept or dismiss. The parent owns the network call and the refresh,
    /// so this view stays previewable and holds no state of its own.
    let onAnswer: (_ accept: Bool) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: V5.S.s10) {
            HStack(spacing: V5.S.s8) {
                Text(directionWord)
                    .font(.faffText(TypeScaleV5.label12, weight: .semibold))
                    .foregroundStyle(directionColor)
                Spacer(minLength: 0)
            }

            Text(proposal.headline)
                .font(.faffText(TypeScaleV5.body15, weight: .semibold))
                .foregroundStyle(V5.textPrimary)
                .fixedSize(horizontal: false, vertical: true)

            Text(proposal.why)
                .font(.faffText(TypeScaleV5.label13))
                .foregroundStyle(V5.textSecondary)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: V5.S.s10) {
                Button { onAnswer(true) } label: {
                    Text("Do it")
                        .font(.faffText(TypeScaleV5.label13, weight: .semibold))
                        .foregroundStyle(V5.textPrimary)
                        .padding(.horizontal, V5.S.s14)
                        .frame(height: 32)
                        .background(directionColor.opacity(0.22), in: Capsule())
                }
                .buttonStyle(V5PressStyle())

                Button { onAnswer(false) } label: {
                    Text("Leave it")
                        .font(.faffText(TypeScaleV5.label13))
                        .foregroundStyle(V5.textSecondary)
                        .padding(.horizontal, V5.S.s14)
                        .frame(height: 32)
                        .background(V5.materialControl, in: Capsule())
                }
                .buttonStyle(V5PressStyle())
            }
        }
        .padding(V5.S.tilePad)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(V5.materialTile,
                    in: RoundedRectangle(cornerRadius: V5.R.r18, style: .continuous))
        .overlay(alignment: .leading) {
            RoundedRectangle(cornerRadius: V5.R.r6, style: .continuous)
                .fill(directionColor)
                .frame(width: 3)
                .padding(.vertical, V5.S.s8)
                .padding(.leading, V5.S.s6)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(directionWord). \(proposal.headline). \(proposal.why)")
    }

    /// The server owns the direction; the phone owns only what it can DRAW.
    /// An unrecognised direction renders neutrally rather than being dropped,
    /// because a card we cannot colour is still a decision the runner owes an
    /// answer to.
    private var directionWord: String {
        switch proposal.direction {
        case "more": return "MORE"
        case "less": return "EASIER"
        case "move": return "MOVED"
        case "test": return "TEST"
        default: return "CHANGE"
        }
    }

    private var directionColor: Color {
        switch proposal.direction {
        case "more": return V5.signal
        case "less": return V5.attention
        default: return V5.textSecondary
        }
    }
}

#Preview("more · the one that never existed") {
    ZStack {
        V5.surfacePage.ignoresSafeArea()
        ProposalCardV5(
            proposal: V5Proposal(
                id: "1", dateISO: "2026-09-10", direction: "more",
                headline: "Thursday goes to 9 mi",
                why: "You absorbed 47.3 miles against 45.5 prescribed, with no late fade."),
            onAnswer: { _ in },
        )
        .padding(V5.S.gutter)
    }
}

#Preview("less") {
    ZStack {
        V5.surfacePage.ignoresSafeArea()
        ProposalCardV5(
            proposal: V5Proposal(
                id: "2", dateISO: "2026-09-10", direction: "less",
                headline: "Take 17% off Thursday",
                why: "Your last two long runs deteriorated in the final third."),
            onAnswer: { _ in },
        )
        .padding(V5.S.gutter)
    }
}
