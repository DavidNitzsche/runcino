//
//  ProposalHarnessV5.swift
//  faff.run iPhone · V5PROPOSALSURFACE-1 · Rule 13, for a surface with almost
//  no production data to render.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE PROBLEM THIS SOLVES
//
//  Rule 13 says a change to something the runner sees is verified by RENDERING
//  it with real data, and it is right. The proposal surface has a problem the
//  run-detail screen did not: THERE IS ALMOST NOTHING TO RENDER.
//  `plan_workout_proposals` holds seven rows in the life of the product, two
//  pending, and both of those are `field_test`. Opening Today against the real
//  account would exercise one of six directions and one of four standings.
//
//  Writing the other rows is not an option: they would be writes to the
//  production table, which `lib/verify/install-barrier` exists to prevent.
//
//  So the seam moves one step out. The fixture is the SERVER'S OWN wire shape
//  — `V5ProposalWire` and `V5DecisionWire`, field for field — decoded by the
//  REAL decoder in `APIV5.swift` and drawn by the REAL views. Nothing here
//  re-implements a view, and nothing here composes a string the server would
//  have composed: every headline and every reason in a fixture is the output
//  of `lib/faff/v5-proposals.ts` for the row it stands for.
//
//  WHAT IT PROVES: the decode, the layout, the colour, the button gating and
//  the Rule 11 renderings, across every direction and standing.
//  WHAT IT DOES NOT: the network hop, the auth layer, `toWire`'s mapping off a
//  real database row, or the accept and dismiss writes. Anything verified this
//  way says so.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY IT IS ONE SCREEN WITH A SEGMENTED CONTROL AND NOT THREE HARNESSES
//
//  The three surfaces are one feature, and a reviewer moving between them is
//  the point: the card's headline and the history's headline come from the
//  same function, and reading them side by side is how you catch a Rule 16
//  drift that no test would see.
//

import SwiftUI

/// The fixture file's shape. Deliberately mirrors what the two routes send:
/// `today.proposals` + `today.proposalsRead`, and `decisions.decisions`.
struct ProposalHarnessFixture: Decodable {
    let proposals: [V5Proposal]
    /// "ok" or "failed". See `V5Today.proposalsRead`.
    let proposalsRead: String?
    let decisions: [V5Decision]
    /// "ok" or "failed". Not a wire field: `GET /api/v5/decisions` answers
    /// `outage()` rather than a flag, so this is how the harness reaches the
    /// state that answer produces. Without it the outage rendering could only
    /// be checked in a preview, and Rule 13 asks for the running app.
    let decisionsRead: String?

    enum K: String, CodingKey { case proposals, proposalsRead, decisions, decisionsRead }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        proposals = (try? c.decode([V5Proposal].self, forKey: .proposals)) ?? []
        proposalsRead = try? c.decodeIfPresent(String.self, forKey: .proposalsRead)
        decisions = (try? c.decode([V5Decision].self, forKey: .decisions)) ?? []
        decisionsRead = try? c.decodeIfPresent(String.self, forKey: .decisionsRead)
    }
}

struct ProposalHarnessV5: View {
    let fixture: ProposalHarnessFixture

    private enum Pane: String, CaseIterable, Identifiable {
        case cards = "Cards"
        case history = "History"
        var id: String { rawValue }
    }

    @State private var pane: Pane = .cards
    @State private var openDetail: V5Proposal? = nil

    var body: some View {
        ZStack {
            V5.surfacePage.ignoresSafeArea()

            VStack(spacing: 0) {
                Picker("", selection: $pane) {
                    ForEach(Pane.allCases) { p in Text(p.rawValue).tag(p) }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, V5.S.gutter)
                .padding(.top, V5.S.s56)
                .padding(.bottom, V5.S.s12)

                switch pane {
                case .cards: cards
                case .history:
                    DecisionHistoryV5(
                        state: fixture.decisionsRead == "failed"
                            ? .failed : .ready(fixture.decisions))
                }
            }

            V5SheetHost(
                isPresented: Binding(
                    get: { openDetail != nil },
                    set: { if !$0 { openDetail = nil } }),
                title: "The reasoning",
                tall: true,
            ) {
                if let p = openDetail { ProposalDetailV5(proposal: p) }
            }
            .zIndex(7)
        }
    }

    /// The Today section, drawn by the SAME composition `TodayBeforeV5`'s
    /// `proposalsSection` uses: the header, the read-failure note, the cards.
    /// Kept literally parallel so a change to one that is not made to the
    /// other is visible on this screen rather than only in a diff.
    private var cards: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: V5.S.s10) {
                V5SectionLabel(text: "DECISIONS", color: V5.textSecondary)
                if fixture.proposalsRead == "failed" {
                    ErrorNote(text: "Any decision waiting on you did not load. "
                              + "Nothing has been applied, we just cannot see it.")
                }
                ForEach(fixture.proposals) { p in
                    ProposalCardV5(
                        proposal: p,
                        // The harness renders; it never writes. A tap on Do it
                        // or Leave it here must not reach the accept route,
                        // and cannot: there is no session and no host.
                        onAnswer: { _ in },
                        onDetails: { openDetail = p },
                    )
                }
            }
            .padding(.horizontal, V5.S.gutter)
            .padding(.bottom, V5.S.s40)
        }
    }
}
