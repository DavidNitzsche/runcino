//
//  ProposalDetailV5.swift
//  faff.run iPhone · V5PROPOSALSURFACE-1 · why the coach is asking.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHERE THIS SITS
//
//  `PRODUCT_UX_SIMPLIFICATION_DOCTRINE` names three layers and one mistake:
//  Layer 1 is the coach, Layer 2 is the explanation available on "why?", Layer
//  3 is the engine, and "Layer 3 must never leak directly into Layer 1". This
//  is Layer 2, and it is the reason the card can stay at five lines.
//
//  ─────────────────────────────────────────────────────────────────────────
//  RULE 17 · NOTHING HERE RESTATES THE CARD
//
//  The card already said which way, what kind, what changes, why and when. So
//  this sheet does NOT open with the headline, the direction or the reason. It
//  opens with the evidence, which is the thing the card could not carry. The
//  sessions-affected section names what a day currently holds, which is a
//  different fact from what would change about it.
//
//  ─────────────────────────────────────────────────────────────────────────
//  RULE 11 · THREE DIFFERENT SILENCES, DRAWN AS THREE DIFFERENT LINES
//
//  A section can be absent for three reasons and they are not the same fact:
//
//    nil        WE HAVE NO RECORD. Nothing wrote this down. Today that is true
//               of the options, the earning gate and the policy assumptions
//               for every production row, because nothing persists a
//               `DecisionTrace` onto a proposal yet.
//    []         WE LOOKED AND THERE WERE NONE. "Nothing was missing" is a real
//               and useful answer, and it is not the same as "we did not
//               check what was missing".
//    non-empty  the rows.
//
//  A sheet that drew all three as blank space would tell the runner the coach
//  considered no alternatives when the truth may be that nobody recorded which
//  alternatives it considered. So the empty ones say so, and the unrecorded
//  ones are named ONCE at the foot rather than as five orphan headers over
//  five blank spaces — which would be the bloat the doctrine's own rule about
//  headers over nothing forbids.
//

import SwiftUI

struct ProposalDetailV5: View {
    let proposal: V5Proposal

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
                if let d = proposal.detail {
                    sections(d)
                    unrecorded(d)
                } else {
                    // An older server. Not "there was no reasoning" — there is
                    // no record of it, and the difference matters enough to say.
                    quiet("This decision predates the reasoning record. "
                          + "Nothing was kept about how it was made.")
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.bottom, V5.S.s24)
        }
        .scrollIndicators(.visible)
    }

    @ViewBuilder
    private func sections(_ d: V5ProposalDetail) -> some View {
        // Sessions first. It is the only section that anchors the sheet to a
        // day, and a runner opening "Details" wants to know what is at stake
        // before he is told what was measured.
        if let rows = d.affectedWorkouts, !rows.isEmpty {
            group("SESSIONS AFFECTED") {
                ForEach(rows) { r in
                    line(ProposalCardV5.effectiveDate(r.dateISO), sub: r.what)
                }
            }
        }

        list("EVIDENCE USED", d.evidenceUsed, whenEmpty: "None recorded on this decision.")
        list("MISSING EVIDENCE", d.missingEvidence, whenEmpty: "Nothing was missing.")

        if let opts = d.optionsConsidered {
            group("OTHER OPTIONS") {
                if opts.isEmpty {
                    quiet("No alternative was weighed.")
                } else {
                    ForEach(opts) { o in line(o.what, sub: o.why) }
                }
            }
        }

        list("WHAT WOULD EARN IT", d.earningConditions,
             whenEmpty: "Nothing is being held back.")

        if let iso = d.reassessOnISO {
            group("RE-CHECKED ON") {
                quiet(ProposalCardV5.effectiveDate(iso))
            }
        }

        list("POLICY ASSUMPTIONS", d.policyAssumptions,
             whenEmpty: "Every number here was measured or cited.")
    }

    /// The one closing line that names what was never written down.
    ///
    /// Rule 17: five sections each saying "not recorded" is five headers over
    /// nothing. One sentence carries the same fact and reads as a fact rather
    /// than as five failures.
    @ViewBuilder
    private func unrecorded(_ d: V5ProposalDetail) -> some View {
        let missing: [String] = [
            d.affectedWorkouts == nil ? "sessions affected" : nil,
            d.evidenceUsed == nil ? "evidence used" : nil,
            d.missingEvidence == nil ? "missing evidence" : nil,
            d.optionsConsidered == nil ? "other options" : nil,
            d.earningConditions == nil ? "what would earn it" : nil,
            d.policyAssumptions == nil ? "policy assumptions" : nil,
        ].compactMap { $0 }

        if !missing.isEmpty {
            quiet("Not recorded for this decision: " + missing.joined(separator: ", ") + ".")
        }
    }

    // ── small pieces ──────────────────────────────────────────────────────

    @ViewBuilder
    private func list(_ title: String, _ rows: [String]?, whenEmpty: String) -> some View {
        if let rows {
            group(title) {
                if rows.isEmpty {
                    quiet(whenEmpty)
                } else {
                    ForEach(Array(rows.enumerated()), id: \.offset) { _, r in line(r) }
                }
            }
        }
    }

    @ViewBuilder
    private func group<Content: View>(_ title: String,
                                      @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: V5.S.s10) {
            V5SectionLabel(text: title, color: V5.textSecondary, size: TypeScaleV5.label13)
            VStack(alignment: .leading, spacing: V5.S.s12) { content() }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(V5.S.tilePad)
                .background(V5.materialTile,
                            in: RoundedRectangle(cornerRadius: V5.R.r18, style: .continuous))
        }
    }

    private func line(_ text: String, sub: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: V5.S.s4) {
            Text(text)
                .font(.faffText(TypeScaleV5.body15))
                .foregroundStyle(V5.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
            if let sub, !sub.isEmpty {
                Text(sub)
                    .font(.faffText(TypeScaleV5.label13))
                    .foregroundStyle(V5.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func quiet(_ text: String) -> some View {
        Text(text)
            .font(.faffText(TypeScaleV5.label13))
            .foregroundStyle(V5.textQuiet)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

#Preview("a decision with a full trace") {
    ZStack {
        V5.surfacePage.ignoresSafeArea()
        ProposalDetailV5(proposal: V5Proposal(
            id: "1", dateISO: "2026-09-10", direction: "push",
            headline: "Thursday goes to 9 mi",
            why: "You absorbed 47.3 miles against 45.5 prescribed, with no late fade.",
            detail: V5ProposalDetail(
                evidenceUsed: ["Session type: threshold", "Session distance: 8 mi"],
                missingEvidence: [],
                optionsConsidered: [
                    V5ProposalOption(what: "HOLD",
                                     why: "the same week again gives no new evidence"),
                ],
                earningConditions: [],
                reassessOnISO: "2026-09-20",
                affectedWorkouts: [
                    V5ProposalWorkout(dateISO: "2026-09-10", what: "threshold · 8 mi"),
                ],
                policyAssumptions: ["Three comparables before a capacity ceiling is claimed"])))
        .padding(V5.S.gutter)
    }
}

#Preview("a decision nothing was written down about") {
    ZStack {
        V5.surfacePage.ignoresSafeArea()
        ProposalDetailV5(proposal: V5Proposal(
            id: "2", dateISO: "2026-09-09", direction: "push",
            headline: "Make Wednesday a field test",
            why: "No race or field test in the last 6 weeks.",
            detail: V5ProposalDetail(
                evidenceUsed: [],
                missingEvidence: [],
                affectedWorkouts: [
                    V5ProposalWorkout(dateISO: "2026-09-09", what: "The prescribed session"),
                ])))
        .padding(V5.S.gutter)
    }
}
