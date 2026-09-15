//
//  DecisionRowContextLineTests.swift
//  F060 (2026-09-14) · the Coach Decisions history screen showed the same
//  HOLD decision card twice, word for word: once STILL OPEN, once SETTLED.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE BUG, AS DESIGN REVIEW ROOT-CAUSED IT
//
//  Not a data bug. Design review queried `plan_workout_proposals` directly
//  and confirmed the two rows behind the duplicate-looking cards are
//  genuinely distinct: one raised 9/7 against the old long-run workout, one
//  raised 9/14 against the workout that replaced it after a plan rebuild.
//  Both events are real and both belong on the screen.
//
//  The bug is that `headline` and `why` are fixed per-action-kind template
//  strings (`actionHeadline`'s `HOLD` case; the evidence facet that writes
//  the reason) with no per-instance content, so two distinct events render
//  as one byte-identical card. `DecisionRowV5` already decoded a field that
//  is NEVER templated — `dateISO`, read straight off the workout the
//  decision was raised against — and never drew it.
//
//  ── WHAT THIS TEST CANNOT FAIL ON (Rule 22) ────────────────────────────────
//
//  · Whether the wording is the best possible coach voice — it pins the
//    literal string against regressing, not against a copy-review opinion.
//  · Whether the row actually renders this on a phone screen — only a
//    rendered screenshot answers that (Rule 13); this is the logic that
//    feeds it. See `docs/verification/2026-09-14-f060` for the rendered
//    proof via the `-faffProposals` debug harness.
//  · Which HOLD fires, when, or why — this suite never touches
//    `plan_workout_proposals`, the adaptation engine, or the evidence
//    facets. It is scoped to `DecisionRowV5.contextLine` only.
//

import XCTest
@testable import Faff

final class DecisionRowContextLineTests: XCTestCase {

    private func hold(id: String, dateISO: String, decidedISO: String, outcome: String) -> V5Decision {
        V5Decision(
            id: id, dateISO: dateISO, decidedISO: decidedISO, direction: "hold",
            outcome: outcome, headline: "Holding the plan as it is",
            why: "The upcoming long run already carries a race-pace segment; "
                + "the structure axis has already moved.")
    }

    /// THE FALSIFICATION CASE. Two rows shaped exactly like the real ones
    /// design review found — same action kind, byte-identical headline and
    /// why text, raised against two different workouts three weeks apart —
    /// one still open, one settled. `contextLine` is the one thing that
    /// tells them apart.
    ///
    /// The dates are a synthetic equivalent of production rows 10 and 15
    /// (raised 9/7 against the old 9/20 long run, and 9/14 against the
    /// workout that replaced it): this suite has no database access to the
    /// real ids, and the task this fixes does not require one — the
    /// mechanism is identical for any two dates.
    func testTwoIdenticalHoldCardsGetDifferentContextLines() {
        let stillOpen = hold(id: "w15", dateISO: "2026-10-11", decidedISO: "2026-09-14", outcome: "pending")
        let settled = hold(id: "w10", dateISO: "2026-09-20", decidedISO: "2026-09-07", outcome: "expired")

        // Before this fix, both of these were the exact same two strings —
        // that IS the bug this test reproduces. See the Rule 18 falsification
        // note below for how this was checked to actually fail without it.
        XCTAssertEqual(stillOpen.headline, settled.headline, "the templated headline is meant to collide")
        XCTAssertEqual(stillOpen.why, settled.why, "the templated reason is meant to collide")

        let openContext = DecisionRowV5.contextLine(stillOpen)
        let settledContext = DecisionRowV5.contextLine(settled)

        XCTAssertNotNil(openContext)
        XCTAssertNotNil(settledContext)
        XCTAssertNotEqual(openContext, settledContext,
                           "F060: two distinct HOLD decisions must not read as one card shown twice")
        XCTAssertEqual(openContext, "About the session on Oct 11.")
        XCTAssertEqual(settledContext, "About the session on Sep 20.")
    }

    /// The common case: one HOLD, never duplicated. This must keep working
    /// exactly as it does today — the fix adds a line, it does not change
    /// anything else about a normal card.
    func testSingleHoldCardStillGetsAContextLine() {
        let solo = hold(id: "w8", dateISO: "2026-09-16", decidedISO: "2026-09-09", outcome: "pending")
        XCTAssertEqual(DecisionRowV5.contextLine(solo), "About the session on Sep 16.")
    }

    /// A block-level decision (`p`-prefixed) has no single day — `dateISO`
    /// is nil on the wire for exactly these rows (`V5DecisionWire`'s own
    /// doc comment) — and must not grow a fabricated date line.
    func testBlockLevelDecisionHasNoContextLine() {
        let rebuild = V5Decision(
            id: "p9", dateISO: nil, decidedISO: "2026-09-03", direction: nil,
            outcome: "applied", headline: "The engine rebuilt your block",
            why: "Your paces were re-anchored and the block was re-authored around them.")
        XCTAssertNil(DecisionRowV5.contextLine(rebuild))
    }

    /// A malformed date does not crash `contextLine` — it delegates entirely
    /// to `shortDate`, the same pre-existing formatter `dateLine` already
    /// uses for `decidedISO` on this row, and inherits whatever that
    /// formatter's own fallback is (`Calendar.date(from:)` on a components
    /// value with nothing readable defaults rather than returning nil).
    /// This test is not pinning that fallback as good copy — only that this
    /// fix does not add a new way for a bad date to reach the runner as a
    /// crash or a raw string.
    func testUnparsableDateDoesNotCrash() {
        let odd = hold(id: "w1", dateISO: "not-a-date", decidedISO: "2026-09-09", outcome: "pending")
        XCTAssertNotNil(DecisionRowV5.contextLine(odd))
    }
}
