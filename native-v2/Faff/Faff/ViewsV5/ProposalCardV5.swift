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
//  WHAT THE FIRST CUT LEFT OUT (V5PROPOSALSURFACE-1, 2026-09-05)
//
//  It shipped in TestFlight 280 and was never rendered once. Reading it
//  against the objective, four things were missing and one was wrong:
//
//   · NO EFFECTIVE DATE. "Take 17% off Thursday" does not say WHICH Thursday,
//     and a proposal can stand for a session up to a week out.
//   · NO STANDING. A card with two buttons asserts "this is a live question".
//     A condition that has not been earned yet and a decision already applied
//     are not live questions, and the buttons were a lie for both.
//   · NO WAY IN TO THE REASONING. The evidence, the options considered, the
//     earning gate and the reassessment date had nowhere to be read, so the
//     runner's only choice was to trust one sentence or ignore it.
//   · THE WORDS WERE A FOURTH VOCABULARY. "MORE" and "EASIER" against an
//     engine that reasons in PUSH / HOLD / PULL_BACK. Rule 16.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY IT IS STILL SMALL
//
//  `PRODUCT_UX_SIMPLIFICATION_DOCTRINE`: only surface information that changes
//  what the runner should understand or do next. The card is Layer 1 and it
//  holds five things — which way, what kind, what changes, why, and when. The
//  evidence trail, the alternatives and the ranking are Layer 2 and live in a
//  sheet a tap away. Nothing from that sheet is allowed to climb onto here.
//
//  Rule 17 · every line on this card is a different fact. Direction is which
//  way, standing is what kind of thing, headline is what changes, `why` is the
//  evidence, the date is when. None of them restates another, which is why the
//  section header above them says neither "your call" nor a direction word.
//
//  Direction is drawn as a word and a colour, never as a judgement. Amber for
//  a reduction because the app already uses amber for "attention, nothing is
//  broken", signal orange for an increase because it is the thing the runner
//  most wants to see and has never once been offered. There is no green in
//  this palette and a push is not a compliment.
//

import SwiftUI

/// What the phone can DRAW for a direction. Separate from the wire's String on
/// purpose: an older phone meeting a direction a newer server invented must
/// render the card neutrally rather than drop a decision it cannot colour.
enum ProposalDirectionV5 {
    case push, hold, pullBack, move, recovery, stop, unknown

    init(wire: String) {
        switch wire {
        case "push": self = .push
        case "hold": self = .hold
        case "pull_back": self = .pullBack
        case "move": self = .move
        case "recovery": self = .recovery
        case "stop": self = .stop
        default: self = .unknown
        }
    }

    /// The register is the app's tracked uppercase, so these are words, not
    /// enum tokens: `pull_back` reads as "PULL BACK" and never as an engine
    /// identifier with an underscore in it.
    var word: String {
        switch self {
        case .push: return "PUSH"
        case .hold: return "HOLD"
        case .pullBack: return "PULL BACK"
        case .move: return "MOVE"
        case .recovery: return "RECOVERY"
        case .stop: return "STOP"
        case .unknown: return "CHANGE"
        }
    }

    var color: Color {
        switch self {
        // The one thing the runner has never been offered.
        case .push: return V5.signal
        // "Attention, a decision waiting" — never "error", never "bad".
        case .pullBack, .recovery: return V5.attention
        // A hard stop is the only direction that is genuinely a fault state:
        // suspected bone stress, systemic illness, an escalating pain signal.
        case .stop: return V5.fault
        case .hold, .move, .unknown: return V5.textSecondary
        }
    }
}

/// What kind of thing this is. See `V5ProposalStanding` on the server for the
/// four and why they are not the same question as direction.
enum ProposalStandingV5 {
    case proposal, condition, deferral, applied

    init(wire: String) {
        switch wire {
        case "condition": self = .condition
        case "deferral": self = .deferral
        case "applied": self = .applied
        // A standing this phone has not been taught is treated as the one that
        // asks for nothing. Showing two buttons for a word we cannot read
        // would invite an answer to a question we do not understand.
        case "proposal": self = .proposal
        default: self = .deferral
        }
    }

    var word: String {
        switch self {
        case .proposal: return "PROPOSAL"
        case .condition: return "CONDITION"
        case .deferral: return "DEFERRED"
        case .applied: return "APPLIED"
        }
    }

    /// Only an open proposal is answerable. A condition has not been earned, a
    /// deferral has not been asked yet, and an applied decision is history.
    /// Drawing Do it / Leave it on any of those would be the card asserting a
    /// question the engine is not asking.
    var isAnswerable: Bool { self == .proposal }
}

struct ProposalCardV5: View {
    let proposal: V5Proposal
    /// Accept or dismiss. The parent owns the network call and the refresh,
    /// so this view stays previewable and holds no state of its own.
    let onAnswer: (_ accept: Bool) -> Void
    /// Open the reasoning. The parent owns presentation for the same reason.
    let onDetails: () -> Void

    private var direction: ProposalDirectionV5 { .init(wire: proposal.direction) }
    private var standing: ProposalStandingV5 { .init(wire: proposal.standing) }

    var body: some View {
        VStack(alignment: .leading, spacing: V5.S.s10) {
            HStack(spacing: V5.S.s8) {
                Text(direction.word)
                    .font(.faffText(TypeScaleV5.label12, weight: .semibold))
                    .tracking(TypeScaleV5.label12 * 0.06)
                    .foregroundStyle(direction.color)
                Text(standing.word)
                    .font(.faffText(TypeScaleV5.label12))
                    .tracking(TypeScaleV5.label12 * 0.06)
                    .foregroundStyle(V5.textQuiet)
                Spacer(minLength: V5.S.s8)
                Text(ProposalCardV5.effectiveDate(proposal.dateISO))
                    .font(.faffText(TypeScaleV5.label12))
                    .foregroundStyle(V5.textQuiet)
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
                if standing.isAnswerable {
                    Button { onAnswer(true) } label: {
                        pill("Do it", weight: .semibold, ink: V5.textPrimary,
                             fill: direction.color.opacity(0.22))
                    }
                    .buttonStyle(V5PressStyle())

                    Button { onAnswer(false) } label: {
                        pill("Leave it", ink: V5.textSecondary, fill: V5.materialControl)
                    }
                    .buttonStyle(V5PressStyle())
                }

                Button(action: onDetails) {
                    pill("Details", ink: V5.textSecondary, fill: V5.materialControl)
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
                .fill(direction.color)
                .frame(width: 3)
                .padding(.vertical, V5.S.s8)
                .padding(.leading, V5.S.s6)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            "\(direction.word). \(standing.word). \(proposal.headline). "
            + "\(ProposalCardV5.effectiveDate(proposal.dateISO)). \(proposal.why)")
    }

    private func pill(_ text: String, weight: InstrumentWeight = .regular,
                      ink: Color, fill: Color) -> some View {
        Text(text)
            .font(.faffText(TypeScaleV5.label13, weight: weight))
            .foregroundStyle(ink)
            .padding(.horizontal, V5.S.s14)
            .frame(height: 32)
            .background(fill, in: Capsule())
    }

    /// "Thursday, September 10". Same order and same formatter shape as
    /// `BlockV5`, so two screens naming one day never name it differently.
    static func effectiveDate(_ iso: String) -> String {
        guard iso.count >= 10 else { return iso }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC") ?? .current
        var c = DateComponents()
        c.year = Int(iso.prefix(4))
        c.month = Int(iso.dropFirst(5).prefix(2))
        c.day = Int(iso.dropFirst(8).prefix(2))
        guard let date = cal.date(from: c) else { return iso }
        let f = DateFormatter()
        f.calendar = cal
        f.timeZone = cal.timeZone
        f.dateFormat = "EEEE, MMMM d"
        return f.string(from: date)
    }
}

#Preview("push · the one that never existed") {
    ZStack {
        V5.surfacePage.ignoresSafeArea()
        ProposalCardV5(
            proposal: V5Proposal(
                id: "1", dateISO: "2026-09-10", direction: "push",
                headline: "Thursday goes to 9 mi",
                why: "You absorbed 47.3 miles against 45.5 prescribed, with no late fade."),
            onAnswer: { _ in }, onDetails: {},
        )
        .padding(V5.S.gutter)
    }
}

#Preview("pull back") {
    ZStack {
        V5.surfacePage.ignoresSafeArea()
        ProposalCardV5(
            proposal: V5Proposal(
                id: "2", dateISO: "2026-09-10", direction: "pull_back",
                headline: "Take 17% off Thursday",
                why: "Your last two long runs deteriorated in the final third."),
            onAnswer: { _ in }, onDetails: {},
        )
        .padding(V5.S.gutter)
    }
}

#Preview("condition · nothing to answer yet") {
    ZStack {
        V5.surfacePage.ignoresSafeArea()
        ProposalCardV5(
            proposal: V5Proposal(
                id: "3", dateISO: "2026-10-08", direction: "push", standing: "condition",
                headline: "Week 9 opens at 55 mi",
                why: "It rests on two 50 mile weeks you have not run yet."),
            onAnswer: { _ in }, onDetails: {},
        )
        .padding(V5.S.gutter)
    }
}
