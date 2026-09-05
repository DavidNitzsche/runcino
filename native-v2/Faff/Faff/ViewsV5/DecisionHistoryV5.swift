//
//  DecisionHistoryV5.swift
//  faff.run iPhone · V5PROPOSALSURFACE-1 · what the coach has decided.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY THIS SCREEN EXISTS AT ALL
//
//  Rule 21: "a log that records that something happened but not what is not a
//  log", and establishing the zero that rule measures needed `coach_intents`
//  queried sideways because nothing could answer "has this engine ever pushed
//  me". The runner is in the same position one level up. Seven proposals have
//  been raised against his plan in the life of the product and he has never
//  seen a single one, accepted, declined or expired.
//
//  This is the record. It is a HISTORY, not a second inbox: nothing here has a
//  button, because everything that is still answerable is already a card on
//  Today and a decision with two homes is a decision that can be answered
//  twice.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY IT IS NOT A TAB, AND NOT ON TODAY
//
//  `PRODUCT_UX_SIMPLIFICATION_DOCTRINE`: only surface information that changes
//  what the runner should understand or do next. History does not, so it earns
//  no permanent position — "adaptation almost disappears as a feature" and
//  "the adaptation engine can be extremely sophisticated without having an
//  Adaptation tab". It is one row in Settings, reached on purpose.
//
//  ─────────────────────────────────────────────────────────────────────────
//  RULE 11 · THE THREE STATES THIS SCREEN MUST TELL APART
//
//  An empty history and a failed read look identical, and they mean opposite
//  things on the one screen built to prove that the engine HAS decided things.
//  So `GET /api/v5/decisions` answers `outage()` on a failed read and this
//  screen draws the fault treatment for it, a `Silence` for a genuine
//  never-been-asked, and rows for a real history. Three states, three
//  renderings.
//

import SwiftUI

struct DecisionHistoryV5: View {
    /// Three states, never collapsed. `loading` is not `empty`.
    enum State: Equatable {
        case loading
        case ready([V5Decision])
        /// We could not read it. NOT an empty history.
        case failed
    }

    let state: State
    var onBack: (() -> Void)? = nil
    /// Re-read. Nil in a preview, where there is nothing to re-read from.
    var onRetry: (() -> Void)? = nil

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                AppBar(title: "Coach decisions", onBack: onBack)

                VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
                    switch state {
                    case .loading:
                        Silence(reason: "Reading your decision history.")
                    case .failed:
                        // The design contract's rule three, the other way up:
                        // this IS the outage, so it wears the OUTAGE treatment
                        // (`ErrorNote` plus the screen's own reassurance) and
                        // never `Alert`, which is this app's refusal shape.
                        // A refusal means "we read it and the answer is no";
                        // here we did not read it at all.
                        OutageBodyV5(copy: .decisions, onRetry: { onRetry?() },
                                     skeletonLines: 4)
                    case .ready(let rows) where rows.isEmpty:
                        Silence(reason: "Your coach has not proposed a change yet. "
                                + "When it does, the decision and what became of it show up here.")
                    case .ready(let rows):
                        ForEach(groups(rows), id: \.title) { g in
                            ListGroup(header: g.title) {
                                ForEach(g.rows) { d in DecisionRowV5(decision: d) }
                            }
                        }
                    }
                }
                .padding(.horizontal, V5.S.gutter)
                .padding(.top, V5.S.s16)
                .padding(.bottom, V5.S.s40)
            }
        }
        .background(V5.surfacePage.ignoresSafeArea())
    }

    private struct Group {
        let title: String
        let rows: [V5Decision]
    }

    /// Open first, then everything else newest first.
    ///
    /// Two groups, not eight. A section per outcome would put six headers over
    /// one row each on a runner with a normal history, and the outcome is
    /// already on every row — the split that earns a header is the one that
    /// changes what the runner does, which is "does this still want an answer".
    private func groups(_ rows: [V5Decision]) -> [Group] {
        // A DEFERRAL BELONGS WITH THE OPEN ONES, and rendering it put it under
        // SETTLED, which is the opposite of what it means: the engine has said
        // it will re-take this decision, so nothing about it is settled. Found
        // by looking at the screen, not by reading the code.
        let stillOpen: Set<String> = ["pending", "deferred"]
        let open = rows.filter { stillOpen.contains($0.outcome) }
        let rest = rows.filter { !stillOpen.contains($0.outcome) }
        var out: [Group] = []
        if !open.isEmpty { out.append(Group(title: "STILL OPEN", rows: open)) }
        if !rest.isEmpty { out.append(Group(title: "SETTLED", rows: rest)) }
        return out
    }
}

/// One decision. Never tappable: there is nothing behind it to open, and the
/// design forbids a chevron on a row that opens nothing.
struct DecisionRowV5: View {
    let decision: V5Decision

    var body: some View {
        VStack(alignment: .leading, spacing: V5.S.s6) {
            HStack(spacing: V5.S.s8) {
                if let dir = decision.direction {
                    let d = ProposalDirectionV5(wire: dir)
                    Text(d.word)
                        .font(.faffText(TypeScaleV5.label12, weight: .semibold))
                        .tracking(TypeScaleV5.label12 * 0.06)
                        .foregroundStyle(d.color)
                }
                Text(DecisionRowV5.outcomeWord(decision.outcome))
                    .font(.faffText(TypeScaleV5.label12))
                    .tracking(TypeScaleV5.label12 * 0.06)
                    .foregroundStyle(DecisionRowV5.outcomeColor(decision.outcome))
                Spacer(minLength: V5.S.s8)
                // NAMED, because it is not the card's date (Rule 16).
                //
                // The card's date is when the change LANDS; this one is when
                // the decision was raised or settled. Rendered side by side
                // they were both a bare "Thursday, September 10" and nothing
                // said they were different quantities. The short form also
                // stops the row wrapping its date onto two lines, which the
                // long form did on every September date.
                Text(DecisionRowV5.dateLine(decision))
                    .font(.faffText(TypeScaleV5.label12))
                    .foregroundStyle(V5.textQuiet)
                    .fixedSize()
            }

            Text(decision.headline)
                .font(.faffText(TypeScaleV5.body15))
                .foregroundStyle(V5.textPrimary)
                .fixedSize(horizontal: false, vertical: true)

            if !decision.why.isEmpty {
                Text(decision.why)
                    .font(.faffText(TypeScaleV5.label13))
                    .foregroundStyle(V5.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, V5.S.tilePad)
        .padding(.vertical, V5.S.s14)
        .accessibilityElement(children: .combine)
    }

    /// "Raised Sep 2" or "Settled Aug 7".
    ///
    /// `decidedISO` is `resolved_at ?? created_at`, so the verb follows the
    /// outcome exactly: an open decision has only ever been raised.
    static func dateLine(_ d: V5Decision) -> String {
        let verb = (d.outcome == "pending" || d.outcome == "deferred") ? "Raised" : "Settled"
        return "\(verb) \(shortDate(d.decidedISO))"
    }

    /// Month then day, the order this app settled on. See `BlockV5`.
    static func shortDate(_ iso: String) -> String {
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
        f.dateFormat = "MMM d"
        return f.string(from: date)
    }

    /// The runner's word for each outcome. Never the database's.
    static func outcomeWord(_ outcome: String) -> String {
        switch outcome {
        case "pending": return "WAITING ON YOU"
        case "accepted": return "YOU SAID YES"
        case "declined": return "YOU SAID NO"
        case "deferred": return "DEFERRED"
        case "expired": return "EXPIRED"
        case "applied": return "APPLIED"
        case "superseded": return "SUPERSEDED"
        case "undone": return "UNDONE"
        // An outcome this build has not been taught still happened. Naming it
        // vaguely beats dropping the row, which would understate the record.
        default: return "SETTLED"
        }
    }

    static func outcomeColor(_ outcome: String) -> Color {
        switch outcome {
        // "A decision waiting" is exactly what amber is for in this palette.
        case "pending": return V5.attention
        default: return V5.textQuiet
        }
    }
}

#Preview("a real history") {
    DecisionHistoryV5(state: .ready([
        V5Decision(id: "w7", dateISO: "2026-09-09", decidedISO: "2026-09-02",
                   direction: "push", outcome: "pending",
                   headline: "Make Wednesday a field test",
                   why: "No race or field test in the last 6 weeks. Pace anchors are going stale."),
        V5Decision(id: "w6", dateISO: "2026-08-25", decidedISO: "2026-08-23",
                   direction: "push", outcome: "expired",
                   headline: "Make Tuesday a field test",
                   why: "No race or field test in the last 6 weeks."),
        V5Decision(id: "p9", dateISO: nil, decidedISO: "2026-09-03",
                   direction: nil, outcome: "applied",
                   headline: "The engine rebuilt your block",
                   why: "Your paces were re-anchored and the block was re-authored around them."),
        V5Decision(id: "w5", dateISO: "2026-08-06", decidedISO: "2026-08-07",
                   direction: "pull_back", outcome: "expired",
                   headline: "Thursday becomes an easy run",
                   why: "Resting heart rate had been above your usual for five days."),
    ]))
    .preferredColorScheme(.dark)
}

#Preview("never been asked anything") {
    DecisionHistoryV5(state: .ready([])).preferredColorScheme(.dark)
}

#Preview("we could not read it") {
    DecisionHistoryV5(state: .failed).preferredColorScheme(.dark)
}
