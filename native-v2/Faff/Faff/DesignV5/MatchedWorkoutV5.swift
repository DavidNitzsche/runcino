import SwiftUI

// MARK: - MatchedWorkoutV5 · PR-15
//
// ═══════════════════════════════════════════════════════════════════════════
// AT MOST ONE COMPARISON, AND THE BASIS IS ALWAYS ON SCREEN
//
// `docs/RUNNER_EXPERIENCE_CONTRACT.md` Q44 is unusually specific about this
// surface, and two of its instructions are about what the runner READS rather
// than what the server computes:
//
//   "Always state the basis: 'Compared with your previous 4 × 1-mile threshold
//    session.' — never merely 'matched run.'"
//
//   "If no defensible match exists, say so rather than forcing one."
//
// So the basis sentence is the first thing in the card and it is not optional
// — there is no initialiser that can draw a comparison without one, because
// the server composes it onto the same object as the rows. And the refusal is
// its own view, because a card that quietly does not appear is
// indistinguishable from a section that failed to load (Rule 11).
//
// The brief adds "at most one high-quality comparison. Hide entirely when no
// honest comparator exists."
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT THIS CARD DOES NOT DO
//
//   · NO VERDICT. Not one row says better or worse. Every delta is a
//     direction and a magnitude — "18 s/mi slower", "4 s/mi tighter" — and
//     what it MEANS is the coach card's job, at the top of the screen, once
//     (Rule 17). A comparison card that also grades is two coaches.
//   · NO COLOUR-BY-OUTCOME. Faster is not green, slower is not red. This
//     palette has no green as a grade, and the rule is not decorative: on the
//     owner's own 2026-09-01 session "18 s/mi slower" is a runner executing
//     BETTER, because he was asked for 27 s/mi slower. A colour would have
//     said the opposite of the truth before he read a word.
//   · NO WHOLE-RUN AVERAGE PACE. It cannot: the server sends no such row and
//     `MatchedWorkoutLine` has no field one could occupy.
//   · NO TAP-THROUGH, yet. Opening the compared run is an obvious next step
//     and is deliberately not guessed at here — it needs a navigation route
//     this component does not own.

struct MatchedWorkoutV5: View {
    let matched: MatchedWorkout?
    /// The sentence explaining why there is no comparison. Nil when a
    /// comparison exists, and ALSO nil when this kind of run never has one —
    /// see `RunDetail.matchedRefusal` for why those are two different states.
    var refusal: String? = nil

    var body: some View {
        if let matched {
            comparison(matched)
        } else if let refusal {
            // A REFUSAL IS AN ANSWER. It is drawn quietly — one line, no tile
            // furniture, no header over an empty box — because it is telling
            // the runner something small and true, not presenting a section.
            Text(refusal)
                .font(.faffText(TypeScaleV5.label13))
                .foregroundStyle(V5.textQuiet)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, V5.S.s4)
        } else {
            // RULE THREE. Nothing to say, so nothing is drawn.
            EmptyView()
        }
    }

    private func comparison(_ m: MatchedWorkout) -> some View {
        Tile {
            // THE BASIS, FIRST AND IN FULL. It is the reason these two
            // sessions are side by side, and a runner who disagrees with the
            // match can only disagree if he can see what it was made on.
            Text(m.basis)
                .font(.faffText(TypeScaleV5.body15))
                .foregroundStyle(V5.textPrimary)
                .fixedSize(horizontal: false, vertical: true)

            // Column heads, once. "Then" carries the date so the two columns
            // are never ambiguous, and the date is not repeated per row.
            HStack(spacing: V5.S.s12) {
                Spacer(minLength: 0)
                Text("This one")
                    .frame(width: Self.column, alignment: .trailing)
                Text(Self.shortDate(m.dateISO))
                    .frame(width: Self.column, alignment: .trailing)
            }
            .font(.faffText(TypeScaleV5.label12))
            .foregroundStyle(V5.textQuiet)

            VStack(spacing: V5.S.s10) {
                ForEach(m.lines) { line in
                    row(line)
                }
            }

            // WHAT COULD NOT BE COMPARED, AND WHY. Rule 11: a card that
            // silently drops its heart-rate row looks exactly like a card over
            // a session that had a strap. Usually empty, and then absent.
            ForEach(m.withheld, id: \.self) { w in
                Text(w)
                    .font(.faffText(TypeScaleV5.label12))
                    .foregroundStyle(V5.textQuiet)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        /* NO COMBINED LABEL. It had `.accessibilityElement(children: .combine)`
         * with `accessibilitySummary` as the label, and that REPLACES the
         * children rather than summarising them — so VoiceOver would have read
         * "Compared with your previous 4 × 1 mi threshold session, 11 weeks
         * ago. 7 figures compared." and then none of the seven figures.
         *
         * The rows are labelled text in a sensible reading order and are
         * better read as themselves. The summary is not wasted: it is what the
         * chart above uses, where the content genuinely is a drawing. */
    }

    private static let column: CGFloat = 84

    private func row(_ line: MatchedWorkoutLine) -> some View {
        VStack(alignment: .leading, spacing: V5.S.s2) {
            HStack(spacing: V5.S.s12) {
                Text(line.label)
                    .font(.faffText(TypeScaleV5.label13))
                    .foregroundStyle(V5.textSecondary)
                Spacer(minLength: V5.S.s8)
                // BOTH FIGURES ARE MEASURED. They are what two instruments
                // recorded, formatted server-side; neither is a model output,
                // so neither carries the tilde.
                FaffValueText(.measured(line.now),
                              font: .faffText(TypeScaleV5.label14, weight: .medium))
                    .frame(width: Self.column, alignment: .trailing)
                FaffValueText(.measured(line.then),
                              font: .faffText(TypeScaleV5.label14))
                    .frame(width: Self.column, alignment: .trailing)
            }
            if let d = line.delta {
                // THE DIFFERENCE, IN WORDS, QUIETLY. A difference the
                // instrument cannot resolve carries no delta at all — the
                // server withholds it — so anything printed here is real.
                Text(d)
                    .font(.faffText(TypeScaleV5.label12))
                    .foregroundStyle(V5.textQuiet)
            }
        }
    }

    /// "16 Jun". The comparison is within six months by construction, so the
    /// year would be noise on almost every card and misleading on none.
    private static func shortDate(_ iso: String) -> String {
        let parts = iso.split(separator: "-")
        guard parts.count == 3, let m = Int(parts[1]), let d = Int(parts[2]),
              m >= 1, m <= 12 else { return iso }
        let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        return "\(d) \(months[m - 1])"
    }
}
