//  DecisionsSectionV5.swift
//
//  DECISIONPLACEMENT-1 (2026-09-07) · extracted from `TodayBeforeV5`'s
//  `proposalsSection` (V5PROPOSAL-1 / ACCEPTVOICE-1 / WITHHOLDLOG-1) so
//  Today and Block draw pending decisions from ONE implementation rather
//  than two that could drift (Rule 16).
//
//  David's ruling, verbatim, on why this exists as a shared component at
//  all rather than staying Today-only: "This decision card should go in the
//  block section though I think. It's weird to have it on TODAY." A HOLD
//  about a long run thirteen days out is not about right now, and
//  `app/api/v5/today/route.ts` / `lib/plan/v5-block.ts` already partition
//  pending proposals by `dateISO` at the server (`loadV5PendingProposals`,
//  same file's own header) — Today keeps `dateISO == todayISO`, Block keeps
//  everything else. This view does not know or care which half it was
//  handed; it draws whatever list its caller passes.
//
//  Does NOT host its own detail sheet. `V5SheetHost` reads its container's
//  own frame (a `GeometryReader` sizing the dim overlay and the sheet's
//  height) to work correctly, so it has to live at the screen's root ZStack
//  — the same level `accountOpen`'s sheet already sits at — not nested
//  inside a `ScrollView`'s content, where it would measure this section's
//  own small bounds instead of the screen. `onDetails` hands the tapped
//  proposal up; the caller owns the `@State` and hosts the sheet itself,
//  exactly as `TodayBeforeV5` already did before this extraction.
import SwiftUI

struct DecisionsSectionV5: View {
    let proposals: [V5Proposal]
    /// See `V5Today.proposalsRead`. `nil` reads as `"ok"`.
    let proposalsRead: String?
    let onDetails: (V5Proposal) -> Void
    /// P0PROPOSALFETCH-1 · re-read after a failed load. Every other
    /// section-level `ErrorNote` in this app passes `onRetry` (see
    /// `HostsV5.swift`'s `OutageBodyV5`/`ErrorNote` call sites, all
    /// `{ Task { await API.resetConnectionPool(); await surface.load() } }`
    /// or the equivalent `reload()` this screen's own host already threads
    /// through for its other failed-read rows). This one did not, even
    /// though `ErrorNote` has carried `onRetry` since it was written — the
    /// only DECISION surface in the app whose outage note offered no way
    /// back in. Defaults to a no-op so a caller wiring only the read path
    /// still compiles; every real host below supplies one.
    var onRetry: () -> Void = {}

    @State private var answerRefusal: String? = nil
    @State private var answerFailed = false
    @State private var answeringProposalID: String? = nil

    /// V5PROPOSAL-1 · the engine asking for an answer.
    ///
    /// Drawn only when there is something to answer: an empty list draws
    /// nothing at all, which is the correct rendering of "no decision
    /// pending" and is what `PRODUCT_UX_SIMPLIFICATION_DOCTRINE` asks for.
    @ViewBuilder
    var body: some View {
        // Rule 11 · three states, not two. `proposalsRead == "failed"` means
        // the list is empty because the server could not read, which is the
        // opposite fact from having nothing pending.
        let readFailed = proposalsRead == "failed"
        if !proposals.isEmpty || readFailed {
            VStack(alignment: .leading, spacing: V5.S.s10) {
                // NOT "YOUR CALL". Only an open proposal is the runner's
                // call; a condition, a deferral and an applied decision are
                // not, and each card says which it is.
                V5SectionLabel(text: "DECISIONS", color: V5.textSecondary)
                if readFailed {
                    // The genuine-empty branch above (`proposals.isEmpty` with
                    // `readFailed == false`) draws nothing at all and offers no
                    // retry, correctly — there is nothing to retry. This is the
                    // other branch: we do not know whether anything is pending,
                    // and that is worth another try.
                    ErrorNote(text: "Any decision waiting on you did not load. "
                              + "Nothing has been applied, we just cannot see it.",
                              onRetry: onRetry)
                }
                if let refusal = answerRefusal {
                    Alert(text: refusal)
                }
                if answerFailed {
                    ErrorNote(text: "That did not go through, and nothing has changed. "
                              + "Try again.")
                }
                ForEach(proposals) { p in
                    ProposalCardV5(
                        proposal: p,
                        answering: answeringProposalID == p.id,
                        onAnswer: { accept in
                            Task { await answerProposal(p, accept: accept) }
                        },
                        onDetails: { onDetails(p) },
                    )
                }
            }
        }
    }

    /// ACCEPTVOICE-1 · a failed tap must never look successful, and must
    /// never look like nothing. `.ok` refreshes; `.refused` prints the
    /// engine's own words; `.failed` and a throw print our own sentence and
    /// deliberately do not refresh.
    private func answerProposal(_ p: V5Proposal, accept: Bool) async {
        answerRefusal = nil
        answerFailed = false
        answeringProposalID = p.id
        defer { answeringProposalID = nil }
        do {
            switch try await API.answerProposal(id: p.id, accept: accept) {
            case .ok:
                NotificationCenter.default.post(name: .faffForegroundRefresh, object: nil)
                NotificationCenter.default.post(name: .faffPlanMutated, object: nil)
            case .refused(let text):
                answerRefusal = text
            case .failed:
                answerFailed = true
            }
        } catch {
            answerFailed = true
        }
    }
}
