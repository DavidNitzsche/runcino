//
//  RepBreakdownV5.swift
//  faff.run iPhone · the session as the watch actually ran it, piece by piece.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY THIS EXISTS
//
//  `RunDetail.phase_breakdown` has been on the wire and decoded by Swift for
//  months. It fed exactly one thing: the colour of the route polyline. On
//  2026-08-11 the runner's tune-up stored NINE phases — warm-up, four 1 km
//  reps, three recovery jogs, a cool-down, each with its own target, its own
//  actual, its own heart rate and the watch's own grade — and run detail drew
//  a mile-by-mile bar chart. The reps were never shown.
//
//  A rep session is a list of reps. That is what the runner came to see, and
//  a chart cut on mile boundaries cannot show it: mile two of that session
//  contains the back half of rep one, a recovery jog, and the front of rep
//  two, averaged into one bar. The split chart is not wrong — it answers
//  "what shape was the run" — it just cannot answer "how did the reps go".
//  Both stay. They are different questions.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE COMPOSITION SEAM
//
//  Same contract `WristDecisionsV5` set: the WIRE carries quantities, the
//  PHONE owns the sentences. This component takes formatted strings and
//  arranges them; `RunDetailV5.repPieces` is the one place a phase becomes
//  words. A wording revision never touches the payload.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE REGISTER · WORDS, NOT COLOUR
//
//  This section grades execution, which `WristDecisionsV5` explicitly may not
//  do. So the rules collide and the collision needs settling out loud:
//
//    · NO AMBER, NO RED, NO GREEN, on any row. Green as a grade is out of
//      this palette everywhere. Amber means "out of range or provisional" and
//      a missed rep genuinely is out of range — so amber would be legal here
//      in a way it is not on a decision. It is still refused. Nine rows inked
//      by outcome turns a training session into a scorecard, and the coach's
//      own verdict — which has the heat, the terrain and the taper context
//      this list does not — is already two inches down the screen doing that
//      job properly. A list that grades every rep in isolation would be
//      arguing with it.
//
//    · A REP THE RUNNER CHOSE TO SKIP CARRIES NO GRADE AT ALL. `completed:
//      false` is the same byte whether the watch offered a stop and the
//      runner took it or the runner simply stopped, and on this screen those
//      two must not read the same. The caller resolves it against
//      `RunDetail.rep_skips` — an explicit record, never inferred — and a
//      chosen skip arrives here with `chosen: true` and no verdict phrase.
//
//    · THE WORK IS PRIMARY, the rest is context. Reps draw in full ink;
//      warm-up, recovery jogs and cool-down draw quiet. That is the only
//      visual hierarchy in the component and it encodes structure, never
//      outcome.
//
//  RULE ONE. An actual pace is measured — it is a reading off the wrist. A
//  target pace is modelled: it comes out of the plan's own pace table. The
//  tilde is retired, so the distinction is carried by the WORD "asked" in
//  front of every target, and by VoiceOver saying "estimated" before the
//  figure. A label that says what a number is beats a symbol that hints.
//
//  RULE THREE. A run with no phases draws NOTHING — not a header over an
//  empty list, which reads as a section that failed to load. The caller does
//  not construct this view at all in that case, and `pieces.isEmpty &&
//  toleranceLine == nil` is belt and braces.
//

import SwiftUI

// MARK: - One piece of the session

/// A single phase, already turned into words by the caller.
struct RepPiece: Identifiable, Equatable {
    /// The phase's own index in the workout. Identity is never the label —
    /// "Interval · 1 km" repeats four times in one session.
    let id: Int

    /// What the watch called it. "Warm-up", "Interval · 1 km", "Jog 1:30".
    let label: String

    /// True for a work rep. Drives ink weight and nothing else.
    let isWork: Bool

    /// The pace that was run, formatted with its unit. Measured.
    let actualPace: String?

    /// The pace that was asked for, bare. Modelled — the caller prefixes it
    /// with "asked" and this component never prints it without that word.
    let askedPace: String?

    /// Distance, duration, heart rate — whatever the phase carried, joined by
    /// the middle dot. Nil when it carried none of them.
    let detail: String?

    /// The watch's grade, in plain words. Nil when the phase had no target to
    /// grade against, and ALWAYS nil on a chosen skip.
    let verdictPhrase: String?

    /// The runner chose to stop this rep. Not a lapse, and not graded.
    let chosen: Bool
}

// MARK: - The section

struct RepBreakdownV5: View {
    /// "Rep by rep" when the session was a rep set, "Piece by piece"
    /// otherwise. The caller decides, because it is the one holding the
    /// phase types.
    let title: String
    let pieces: [RepPiece]

    /// The watch's tolerance arithmetic for the whole of the work, as one
    /// sentence. Nil when no work phase carried the counters — every
    /// treadmill session, and anything the device could not grade.
    var toleranceLine: String? = nil

    var body: some View {
        // RULE THREE, belt and braces. The caller already guards this; a
        // component that can draw an empty header is a component that
        // eventually will.
        if !pieces.isEmpty || toleranceLine != nil {
            VStack(alignment: .leading, spacing: V5.S.s10) {
                V5SectionLabel(text: title).padding(.horizontal, V5.S.s4)

                VStack(alignment: .leading, spacing: 0) {
                    ForEach(pieces) { piece in
                        row(piece)
                    }
                    if let toleranceLine {
                        // A TILE INSIDE A TILE STEPS UP ONE FILL LEVEL.
                        // `TokensV5` is explicit that containment in this
                        // system is a fill-step change and NEVER a hairline —
                        // "no borders anywhere" — so the sum of the rows above
                        // is separated from them by stepping up, not by a
                        // rule. On a single-phase session there are no rows
                        // and this stands alone, which is still a statement
                        // and not an orphan header.
                        Text(toleranceLine)
                            .font(.faffText(TypeScaleV5.label14))
                            .lineSpacing(TypeScaleV5.label14 * 0.4)
                            .foregroundStyle(V5.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, V5.S.s14)
                            .padding(.vertical, V5.S.s12)
                            .background(V5.materialTileRaised,
                                        in: RoundedRectangle(cornerRadius: V5.R.r16, style: .continuous))
                            .padding(.horizontal, V5.S.s8)
                            .padding(.top, pieces.isEmpty ? 0 : V5.S.s8)
                    }
                }
                .padding(.vertical, V5.S.s6)
                .background(V5.materialTile,
                            in: RoundedRectangle(cornerRadius: V5.R.r18, style: .continuous))
            }
        }
    }

    // MARK: - A row

    private func row(_ p: RepPiece) -> some View {
        // Work reps in full ink, everything around them quiet. Structure,
        // never outcome — a missed rep and a hit rep are the same weight.
        let primary = p.isWork ? V5.textPrimary : V5.textSecondary

        return HStack(alignment: .firstTextBaseline, spacing: V5.S.s12) {
            VStack(alignment: .leading, spacing: V5.S.s4) {
                Text(p.label)
                    .font(.faffText(p.isWork ? TypeScaleV5.body17 : TypeScaleV5.body15))
                    .foregroundStyle(primary)
                if let detail = p.detail {
                    Text(detail)
                        .font(.faffText(TypeScaleV5.label13))
                        .foregroundStyle(V5.textQuiet)
                }
                if let note = Self.note(p) {
                    Text(note)
                        .font(.faffText(TypeScaleV5.label13))
                        .foregroundStyle(V5.textQuiet)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            VStack(alignment: .trailing, spacing: V5.S.s4) {
                // NOTHING, NOT A DASH, when there is no pace.
                //
                // `FaffValue.measured(nil)` is `.unreadable`, which draws "—"
                // in FAULT RED and means "we tried to read this and could
                // not". A rep the runner chose to skip was never run: there is
                // nothing to read, and a red dash on that row is precisely the
                // screen calling a decision a failure. Absence is the honest
                // mark for absence.
                if let pace = p.actualPace {
                    FaffValueText(.measured(pace),
                                  font: .faffText(p.isWork ? 17 : 15, weight: .semibold),
                                  color: primary)
                }
                if let asked = p.askedPace {
                    // THE WORD CARRIES RULE ONE. "asked" says this is a
                    // prescription, which is what the retired tilde was
                    // gesturing at and never managed to say.
                    Text("asked \(asked)")
                        .font(.faffText(TypeScaleV5.label12))
                        .foregroundStyle(V5.textQuiet)
                }
            }
        }
        .padding(.horizontal, V5.S.tilePad)
        .padding(.vertical, V5.S.s12)
        // One element per piece. Read as five separate strings a rep becomes
        // "Interval · 1 km" followed by four orphaned fragments, and the
        // fragment that says whose decision the skip was is the one that
        // stops the row sounding like a confession.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken(p))
    }

    /// The one line under a row, or none.
    ///
    /// A CHOSEN SKIP OUTRANKS A VERDICT AND REPLACES IT. The caller already
    /// declines to compose a verdict phrase for a chosen skip, so this is the
    /// second of two guards on the same rule — the one thing this section may
    /// not do is print "outside the band" against a rep the coach offered to
    /// stop. The sentence names whose decision it was, which is the only fact
    /// that separates it from a rep the runner simply lost.
    static func note(_ p: RepPiece) -> String? {
        p.chosen ? "You took the stop the watch offered" : p.verdictPhrase
    }

    /// The spoken row.
    ///
    /// "estimated" goes in front of the target and nowhere else. That word is
    /// rule one's whole remaining carrier now the tilde is gone, so it has to
    /// be attached to the modelled figure and only to it — an actual pace is a
    /// reading and must never pick it up.
    private func spoken(_ p: RepPiece) -> String {
        var parts: [String] = [p.label]
        if let pace = p.actualPace { parts.append("ran \(pace)") }
        if let asked = p.askedPace { parts.append("asked estimated \(asked) per mile") }
        if let detail = p.detail { parts.append(detail.replacingOccurrences(of: " \u{00B7} ", with: ", ")) }
        if let note = Self.note(p) { parts.append(note) }
        return parts.joined(separator: ". ") + "."
    }
}

// MARK: - Preview

#Preview("Rep by rep · the 2026-08-11 tune-up") {
    ScrollView {
        RepBreakdownV5(
            title: "Rep by rep",
            pieces: [
                RepPiece(id: 0, label: "Warm-up", isWork: false, actualPace: "7:55/mi",
                         askedPace: "8:57", detail: "1.5 mi \u{00B7} 11:54 \u{00B7} HR 135",
                         verdictPhrase: nil, chosen: false),
                RepPiece(id: 1, label: "Interval \u{00B7} 1 km", isWork: true, actualPace: "6:21/mi",
                         askedPace: "6:52", detail: "0.62 mi \u{00B7} 3:57 \u{00B7} HR 164",
                         verdictPhrase: "Outside the band", chosen: false),
                RepPiece(id: 2, label: "Jog 1:30", isWork: false, actualPace: "8:14/mi",
                         askedPace: nil, detail: "0.18 mi \u{00B7} 1:30 \u{00B7} HR 164",
                         verdictPhrase: nil, chosen: false),
                RepPiece(id: 3, label: "Interval \u{00B7} 1 km", isWork: true, actualPace: "6:27/mi",
                         askedPace: "6:52", detail: "0.62 mi \u{00B7} 4:02 \u{00B7} HR 169",
                         verdictPhrase: "Outside the band", chosen: false),
                RepPiece(id: 5, label: "Interval \u{00B7} 1 km", isWork: true, actualPace: "6:42/mi",
                         askedPace: "6:52", detail: "0.62 mi \u{00B7} 4:10 \u{00B7} HR 168",
                         verdictPhrase: "In and out of the band", chosen: false),
                RepPiece(id: 7, label: "Interval \u{00B7} 1 km", isWork: true, actualPace: nil,
                         askedPace: "6:52", detail: nil,
                         verdictPhrase: nil, chosen: true),
            ],
            toleranceLine: "The watch had you inside the target pace for 5:55 of the 16:30 of work it graded."
        )
        .padding(.horizontal, V5.S.gutter)
    }
    .background(V5.surfacePage)
    .preferredColorScheme(.dark)
}
