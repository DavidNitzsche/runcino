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

    // MARK: - shouldSkipNavigation(from:to:force:) — RETRYNOOP-1

    /// The regression itself: a Retry tap always retries the date already
    /// being viewed (`from == to`), and without `force` this used to make
    /// `goTo`'s very first line a silent no-op — before the snapshot check,
    /// before `navigationTask`, before anything that would actually
    /// re-fetch. `retryPending` passing `force: true` is the fix.
    func testRuleEighteenFalsifier_withoutForce_sameDateIsSkipped() {
        XCTAssertTrue(TodayHostV5.shouldSkipNavigation(from: "2026-09-14", to: "2026-09-14", force: false),
                       "RULE 18: the pre-fix shape (force always false) must skip a same-date retry — this is the exact bug retryPending's force:true exists to bypass")
    }

    func testForcedSameDateNavigationIsNeverSkipped() {
        XCTAssertFalse(TodayHostV5.shouldSkipNavigation(from: "2026-09-14", to: "2026-09-14", force: true),
                        "a forced retry on the currently-viewed date must proceed, not no-op")
    }

    /// Every OTHER caller of `goTo` never passes `force` — confirms the
    /// original "re-tap of the day already showing is a no-op" behaviour is
    /// completely unchanged for normal navigation.
    func testUnforcedNavigationToADifferentDateIsNeverSkipped() {
        XCTAssertFalse(TodayHostV5.shouldSkipNavigation(from: "2026-09-14", to: "2026-09-15", force: false))
    }

    func testForcedNavigationToADifferentDateIsAlsoNeverSkipped() {
        XCTAssertFalse(TodayHostV5.shouldSkipNavigation(from: "2026-09-14", to: "2026-09-15", force: true))
    }

    // MARK: - shouldPrefetchWeek(dateAlreadyCached:skipWeekPrefetch:) — BA01-3
    //
    // BA-01 required test #3 (ASAP-IMPLEMENTATION-SEQUENCE.md): "A Retry
    // test proves exactly one owning request and no neighbor/week
    // prefetch." `retryPending` calls `goTo(..., skipWeekPrefetch: true)`,
    // but `goTo`'s own week-prefetch line never actually read that
    // parameter — it fired `fetchAndCacheWeek` whenever the date wasn't
    // already in `dayCache`, on every caller, retry or not. Since a Retry
    // exists specifically because the date's own fetch FAILED, the date is
    // essentially always uncached at that moment — so every real Retry tap
    // silently re-fired a week-level fetch, exactly the "neighbor/week
    // prefetch" this required test exists to forbid. Found and fixed while
    // writing this test, not before.

    /// The regression itself, restated as a fact the function must get
    /// right: `skipWeekPrefetch: true` (retryPending's own call shape) must
    /// refuse to prefetch the week even when the date is genuinely
    /// uncached — the exact state a failed date is normally in.
    func testRuleEighteenFalsifier_retryOnAnUncachedDateMustNotPrefetchTheWeek() {
        XCTAssertFalse(
            TodayHostV5.shouldPrefetchWeek(dateAlreadyCached: false, skipWeekPrefetch: true),
            "RULE 18: this is the exact bug shape — an uncached date (the normal state of a "
            + "failed retry target) must not trigger a week prefetch when the caller asked to skip it")
    }

    /// Ordinary (non-retry) navigation to a date not yet in `dayCache` must
    /// keep priming the week — this is WEEKCACHE-1's own existing,
    /// legitimate behavior, and the fix must not regress it.
    func testOrdinaryNavigationToAnUncachedDateStillPrefetchesTheWeek() {
        XCTAssertTrue(TodayHostV5.shouldPrefetchWeek(dateAlreadyCached: false, skipWeekPrefetch: false))
    }

    /// A date already in `dayCache` never needs the week re-primed,
    /// regardless of `skipWeekPrefetch` — this was already true before
    /// BA01-3 and must stay true after it.
    func testAlreadyCachedDateNeverPrefetchesTheWeekEitherWay() {
        XCTAssertFalse(TodayHostV5.shouldPrefetchWeek(dateAlreadyCached: true, skipWeekPrefetch: false))
        XCTAssertFalse(TodayHostV5.shouldPrefetchWeek(dateAlreadyCached: true, skipWeekPrefetch: true))
    }

    // MARK: - shouldSkipForegroundSync(reason:currentState:lastSuccessfulSyncAt:now:) — BA-01R item 6
    //
    // "A foreground signal without a known plan/fact invalidation cannot
    // rebuild a snapshot that just completed successfully." Every other
    // trigger (retry, mutation, manual refresh, launch, post-import,
    // range-miss) already carries its own evidence of change and must
    // never be skipped by this cooldown.

    private let cooldownReference = Date(timeIntervalSince1970: 2_000_000)

    /// The regression this exists to prevent: a bare foreground event,
    /// moments after a successful sync, re-running the whole ~329-query
    /// block rebuild for no new reason at all.
    func testRuleEighteenFalsifier_foregroundRightAfterASuccessIsSkipped() {
        XCTAssertTrue(TodayHostV5.shouldSkipForegroundSync(
            reason: .foreground,
            currentState: .idle,
            lastSuccessfulSyncAt: cooldownReference,
            now: cooldownReference.addingTimeInterval(1)))
    }

    /// A foreground signal genuinely past the cooldown window is a real
    /// signal again — must proceed, not be skipped forever.
    func testForegroundPastTheCooldownWindowIsNotSkipped() {
        XCTAssertFalse(TodayHostV5.shouldSkipForegroundSync(
            reason: .foreground,
            currentState: .idle,
            lastSuccessfulSyncAt: cooldownReference,
            now: cooldownReference.addingTimeInterval(TodayHostV5.planSnapshotForegroundCooldownSec + 1)))
    }

    /// Every other reason bypasses the cooldown entirely, even at zero gap —
    /// each already IS the evidence something may have changed.
    func testEveryOtherReasonBypassesTheCooldownEntirely() {
        for reason: PlanSnapshotStore.SyncReason in [.launch, .retry, .mutation, .manualRefresh, .postImport, .rangeMiss] {
            XCTAssertFalse(TodayHostV5.shouldSkipForegroundSync(
                reason: reason,
                currentState: .idle,
                lastSuccessfulSyncAt: cooldownReference,
                now: cooldownReference),
                "\(reason) must never be skipped by the foreground cooldown")
        }
    }

    /// A foreground signal while a PRIOR attempt is still `.syncing` or
    /// `.failed` is not "a snapshot that just completed successfully" —
    /// the cooldown only ever protects a genuinely fresh `.idle` success.
    func testForegroundIsNeverSkippedWhenTheLastAttemptWasNotAnIdleSuccess() {
        XCTAssertFalse(TodayHostV5.shouldSkipForegroundSync(
            reason: .foreground, currentState: .syncing,
            lastSuccessfulSyncAt: cooldownReference, now: cooldownReference.addingTimeInterval(1)))
        XCTAssertFalse(TodayHostV5.shouldSkipForegroundSync(
            reason: .foreground, currentState: .failed("boom"),
            lastSuccessfulSyncAt: cooldownReference, now: cooldownReference.addingTimeInterval(1)))
    }

    /// No prior successful sync at all (a cold account, or one cleared by
    /// sign-out) must never be treated as "just completed successfully."
    func testForegroundIsNeverSkippedWithNoPriorSuccessfulSync() {
        XCTAssertFalse(TodayHostV5.shouldSkipForegroundSync(
            reason: .foreground, currentState: .idle,
            lastSuccessfulSyncAt: nil, now: cooldownReference))
    }
}
