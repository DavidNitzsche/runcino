//
//  TodayNavigationTests.swift
//  faff.run iPhone · pins the exact regression David hit live: a swiped-to
//  or tapped-to date that fails to load must never render silently as
//  though it were the date that DID load.
//
//  ─────────────────────────────────────────────────────────────────────────
//  STATEGATE-1 — THE GOVERNING INVARIANT, TESTED DIRECTLY
//
//  "The app must never render workout content for date A beneath a selected
//  or labeled date B." `TodayHostV5.readiness(model:wanted:pendingDate:)` is
//  the single function that decides which of three screens gets built —
//  `content(_:)` is reachable from exactly one of its three cases — so this
//  file tests THAT function directly, on the real state shapes, rather than
//  the older, narrower approach of testing only the id/date resolver
//  underneath it.
//

import XCTest
@testable import Faff

final class TodayNavigationTests: XCTestCase {

    private func decode(_ json: String) throws -> V5Today {
        try JSONDecoder().decode(V5Today.self, from: Data(json.utf8))
    }

    // MARK: - readiness(model:wanted:pendingDate:) — the hard invariant

    /// The regression itself, restated as a fact `readiness` must get right:
    /// the runner asked for Sept 13, the payload on hand is for Sept 6 (a
    /// stand-in for "today" here, since the fixture's own date is what it
    /// is) — this must NEVER read as `.match`, because `content(_:)` is only
    /// reachable from that case.
    func testMismatchedPayloadNeverReadsAsMatch() throws {
        let sept6 = try decode(V5ContractTests.Fixtures.beforeRun) // dateISO 2026-08-19, stands in for "the old day"
        let host = TodayHostV5(path: .constant([]))
        let result = host.readiness(model: sept6, wanted: "2026-09-13", pendingDate: nil)
        XCTAssertFalse(result == .match(sept6), "a payload for a different date must never read as a match")
        // And it must read as SOMETHING — never nil, never silently ignored.
        switch result {
        case .match: XCTFail("must not be .match")
        case .loading, .failed: break // either is an honest, non-silent answer
        }
    }

    /// Nothing is in flight for the mismatched date (`pendingDate` is nil,
    /// or points somewhere else) → the mismatch already ran and did not
    /// produce a match. That is a FAILURE, not a wait — the exact
    /// distinction STATEGATE-1 exists to draw.
    func testMismatchWithNothingPendingReadsAsFailed() throws {
        let model = try decode(V5ContractTests.Fixtures.beforeRun)
        let host = TodayHostV5(path: .constant([]))
        XCTAssertEqual(host.readiness(model: model, wanted: "2026-09-24", pendingDate: nil),
                       .failed(date: "2026-09-24"))
        XCTAssertEqual(host.readiness(model: model, wanted: "2026-09-24", pendingDate: "2026-09-17"),
                       .failed(date: "2026-09-24"), "pending a DIFFERENT date must not mask this one's failure")
    }

    /// A fetch for the wanted date is genuinely in flight → loading, not
    /// failed, and — the point of the whole mechanism — not a silent render
    /// of whatever `model` happens to hold either.
    func testMismatchWithMatchingPendingReadsAsLoading() throws {
        let model = try decode(V5ContractTests.Fixtures.beforeRun)
        let host = TodayHostV5(path: .constant([]))
        XCTAssertEqual(host.readiness(model: model, wanted: "2026-09-24", pendingDate: "2026-09-24"),
                       .loading(date: "2026-09-24"))
    }

    /// The ordinary case: the payload's own date IS the wanted date. Must
    /// read as `.match`, carrying that exact payload — this is the one path
    /// `content(_:)` is reachable from.
    func testMatchingPayloadReadsAsMatch() throws {
        let model = try decode(V5ContractTests.Fixtures.beforeRun)
        let host = TodayHostV5(path: .constant([]))
        XCTAssertEqual(host.readiness(model: model, wanted: model.dateISO, pendingDate: nil), .match(model))
    }

    /// No payload at all (nil) is never a match, regardless of what is
    /// pending — this is `TodayHostV5.body`'s job to route to
    /// absentReason/isOutage/coldStart, not `readiness`'s, but `readiness`
    /// itself must still answer honestly if ever called with `nil`.
    func testNilModelNeverReadsAsMatch() {
        let host = TodayHostV5(path: .constant([]))
        let result = host.readiness(model: nil, wanted: "2026-09-24", pendingDate: "2026-09-24")
        XCTAssertEqual(result, .loading(date: "2026-09-24"))
    }

    // MARK: - dateISO(forRowID:in:) — the week strip is the authority first

    func testWeekStripRowResolvesByID() throws {
        let model = try decode(V5ContractTests.Fixtures.beforeRun)
        // "w1" is the fixture's first strip row, dated 2026-08-18.
        XCTAssertEqual(TodayHostV5.dateISO(forRowID: "w1", in: model), "2026-08-18")
    }

    // MARK: - dateISO(forRowID:in:) — the calendar's rows are not in the strip

    func testCalendarRowOutsideTheStripResolvesFromItsOwnEmbeddedDate() throws {
        let model = try decode(V5ContractTests.Fixtures.beforeRun)
        // No row in `beforeRun`'s weekStrip carries this id — it stands for a
        // day in the calendar sheet's later weeks, which the strip has never
        // seen.
        XCTAssertEqual(TodayHostV5.dateISO(forRowID: "pw-2026-09-04", in: model), "2026-09-04")
    }

    func testRowIDWithNoDateAndNoStripMatchResolvesToNothing() throws {
        let model = try decode(V5ContractTests.Fixtures.beforeRun)
        XCTAssertNil(TodayHostV5.dateISO(forRowID: "not-a-real-row", in: model))
    }

    // MARK: - isoDate(embeddedIn:) — validated, not just pattern-matched

    func testEmbeddedDateIsExtracted() {
        XCTAssertEqual(TodayHostV5.isoDate(embeddedIn: "date:2026-09-13"), "2026-09-13")
        XCTAssertEqual(TodayHostV5.isoDate(embeddedIn: "pw-2026-09-04"), "2026-09-04")
    }

    /// The regression this exists to catch: a ten-character substring that
    /// LOOKS like `yyyy-MM-dd` but names no real calendar date must not be
    /// handed to the server as one — `Self.iso.date(from:)` is what actually
    /// validates it, not a regex shape check.
    func testImpossibleCalendarDateIsRejected() {
        XCTAssertNil(TodayHostV5.isoDate(embeddedIn: "pw-2026-13-45"))
    }

    func testTooShortToContainADateResolvesToNothing() {
        XCTAssertNil(TodayHostV5.isoDate(embeddedIn: "w1"))
    }

    // MARK: - The decoded payload's own date is the fact of record

    func testDecodedPayloadNamesItsOwnDateAsTheFactOfRecord() throws {
        let model = try decode(V5ContractTests.Fixtures.beforeRun)
        XCTAssertEqual(model.dateISO, "2026-08-19")
        XCTAssertNotEqual(model.dateISO, "2026-08-18", "the payload's own date must never be read as its neighbour's")
    }
}
