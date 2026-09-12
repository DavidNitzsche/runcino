//
//  PlanSnapshotNavigationTests.swift
//  PLANSNAPSHOT-1's own coverage for the navigation-side decision function
//  and the model's date lookups — the falsifiable core of "date selection
//  performs no blocking network request" once a valid snapshot exists.
//

import XCTest
@testable import Faff

final class PlanSnapshotNavigationTests: XCTestCase {

    private func day(_ iso: String, dow: Int = 4, type: String = "easy",
                      resolution: String? = nil, moved_to_iso: String? = nil,
                      supplemental_runs: [PlanSnapshotSupplementalRun] = []) -> PlanSnapshotDay {
        PlanSnapshotDay(plan_workout_id: "pw_\(iso)", date_iso: iso, dow: dow, type: type,
                         is_rest: type == "rest", is_race: type == "race",
                         is_quality: type == "threshold" || type == "intervals" || type == "tempo",
                         is_long: type == "long", distance_mi: type == "rest" ? 0 : 6,
                         sub_label: nil, notes: nil, card: nil, treadmill: nil,
                         matched_run: nil, supplemental_runs: supplemental_runs,
                         day_state: type == "rest" ? "rest" : type, kicker: nil, dose: nil, stats: [],
                         resolution: resolution, moved_to_iso: moved_to_iso)
    }

    private func snapshot(days: [PlanSnapshotDay]) -> PlanSnapshot {
        PlanSnapshot(plan_id: "pln_x", plan_version: "pln_x:v1",
                     plan_start_iso: days.first?.date_iso, plan_end_iso: days.last?.date_iso,
                     today_iso: "2026-09-03", synced_at: "2026-09-04T00:00:00Z", days: days)
    }

    // MARK: - shouldRenderFromSnapshot: the exact gate `goTo` calls

    func testHomeNavigationNeverUsesTheSnapshot() {
        // Today itself always keeps the live narrative path, snapshot or not.
        let snap = snapshot(days: [day("2026-09-03")])
        XCTAssertFalse(TodayHostV5.shouldRenderFromSnapshot(iso: "2026-09-03", isHome: true, snapshot: snap))
    }

    func testNonHomeDateCoveredBySnapshotSkipsTheNetwork() {
        let snap = snapshot(days: [day("2026-09-04")])
        XCTAssertTrue(TodayHostV5.shouldRenderFromSnapshot(iso: "2026-09-04", isHome: false, snapshot: snap))
    }

    func testNonHomeDateNotInSnapshotFallsBackToNetwork() {
        let snap = snapshot(days: [day("2026-09-04")])
        XCTAssertFalse(TodayHostV5.shouldRenderFromSnapshot(iso: "2026-12-25", isHome: false, snapshot: snap))
    }

    func testNoSnapshotYetAlwaysFallsBackToNetwork() {
        XCTAssertFalse(TodayHostV5.shouldRenderFromSnapshot(iso: "2026-09-04", isHome: false, snapshot: nil))
    }

    // MARK: - Falsified once (Rule 18): the guard is load-bearing, not a tautology

    func testFalsifier_ifHomeWereIgnoredATodayNavigationWouldWronglySkipTheNetwork() {
        // Not production code — proves `isHome` actually gates the decision
        // rather than the snapshot lookup alone deciding everything.
        let snap = snapshot(days: [day("2026-09-03")])
        let wrongAnswerIfIsHomeWereIgnored = snap.day(on: "2026-09-03") != nil
        XCTAssertTrue(wrongAnswerIfIsHomeWereIgnored, "the day IS in the snapshot")
        XCTAssertFalse(TodayHostV5.shouldRenderFromSnapshot(iso: "2026-09-03", isHome: true, snapshot: snap),
                       "but isHome must still force the live path")
    }

    // MARK: - PlanSnapshot.day(on:) — exact-match lookup, including calendar boundaries

    func testDayLookupAcrossAMonthBoundary() {
        let snap = snapshot(days: [day("2026-09-30"), day("2026-10-01")])
        XCTAssertEqual(snap.day(on: "2026-09-30")?.date_iso, "2026-09-30")
        XCTAssertEqual(snap.day(on: "2026-10-01")?.date_iso, "2026-10-01")
        XCTAssertNil(snap.day(on: "2026-10-02"))
    }

    func testDayLookupAcrossAYearBoundary() {
        let snap = snapshot(days: [day("2026-12-31"), day("2027-01-01")])
        XCTAssertEqual(snap.day(on: "2026-12-31")?.date_iso, "2026-12-31")
        XCTAssertEqual(snap.day(on: "2027-01-01")?.date_iso, "2027-01-01")
    }

    func testContainsDateRespectsInclusiveBounds() {
        let snap = snapshot(days: [day("2026-08-24"), day("2026-12-06", type: "race")])
        XCTAssertTrue(snap.containsDate("2026-08-24"), "plan start is inclusive")
        XCTAssertTrue(snap.containsDate("2026-12-06"), "plan end (race day) is inclusive")
        XCTAssertFalse(snap.containsDate("2026-08-23"), "the day before plan start is out of bounds")
        XCTAssertFalse(snap.containsDate("2026-12-07"), "the day after race day is out of bounds")
    }

    func testContainsDateWithNoSnapshotBoundsIsAlwaysFalse() {
        let empty = PlanSnapshot(plan_id: nil, plan_version: nil, plan_start_iso: nil, plan_end_iso: nil,
                                  today_iso: "2026-09-03", synced_at: "2026-09-04T00:00:00Z", days: [],
                                  message: "No active plan.")
        XCTAssertFalse(empty.containsDate("2026-09-03"))
    }

    // MARK: - Matched vs supplemental never conflated (the exact contract the brief names)

    func testMatchedAndSupplementalCoexistWithoutConflation() {
        let matched = PlanSnapshotMatchedRun(runId: "r_treadmill", distanceMi: 6.0, durationSec: 2400,
                                              paceSPerMi: 400, match: "exact", indoor: true)
        let supplemental = PlanSnapshotSupplementalRun(runId: "r_friend", distanceMi: 3.1,
                                                        durationSec: 1500, paceSPerMi: 480, indoor: false)
        let d = PlanSnapshotDay(plan_workout_id: "pw_1", date_iso: "2026-09-03", dow: 4, type: "intervals",
                                 is_rest: false, is_race: false, is_quality: true, is_long: false,
                                 distance_mi: 6, sub_label: nil, notes: nil, card: nil, treadmill: nil,
                                 matched_run: matched, supplemental_runs: [supplemental],
                                 day_state: "quality", kicker: nil, dose: nil, stats: [])
        XCTAssertEqual(d.matched_run?.match, "exact")
        XCTAssertEqual(d.matched_run?.runId, "r_treadmill")
        XCTAssertEqual(d.supplemental_runs.count, 1)
        XCTAssertEqual(d.supplemental_runs.first?.runId, "r_friend")
        XCTAssertNotEqual(d.matched_run?.runId, d.supplemental_runs.first?.runId,
                           "the matched session and the supplemental run must never be the same identity")
    }

    // MARK: - SNAPSHOT-RESOLUTION-1 (2026-09-11 follow-up)
    //
    // A reviewer found that `shouldRenderFromSnapshot` returning `true` — the
    // correct, unchanged decision for every missed/moved/skipped/supplemental
    // day, since none of them carry a `matched_run` — routed the SNAPSHOT
    // render path around the whole past-day resolution hero this branch adds,
    // because `PlanSnapshotDay` had no `resolution` field for that path to
    // read at all. These tests cover the fix: the wire field decodes to the
    // same `V5.ResolutionState` the live path already uses, and
    // `TodayHostV5.snapshotResolutionHero(for:)` — the pure function `body`'s
    // snapshot branch gates on — returns the right thing for every case.

    func testPlanSnapshotDayResolutionDecodesToTheTypedState() {
        XCTAssertEqual(day("2026-09-06", resolution: "skipped").resolvedState, .skipped)
        XCTAssertEqual(day("2026-09-10", resolution: "missed").resolvedState, .missed)
        XCTAssertEqual(day("2026-09-04", resolution: "moved").resolvedState, .moved)
        XCTAssertEqual(day("2026-09-07", resolution: "supplemental").resolvedState, .supplemental)
        XCTAssertEqual(day("2026-09-08", resolution: "completed").resolvedState, .completed)
    }

    func testPlanSnapshotDayResolutionAbsentDecodesToNilNotAFailure() {
        // Same lenient posture as `skipped` — an older cached snapshot, or a
        // day the server never resolved (still a live, open prescription).
        XCTAssertNil(day("2026-09-11").resolvedState)
    }

    func testPlanSnapshotDayResolutionUnknownRawValueDecodesToNil() {
        // Mirrors `V5.ResolutionState`'s own "unknown reads as nil, never a
        // crash" contract for a server that ships a sixth case before this
        // build knows about it.
        XCTAssertNil(day("2026-09-11", resolution: "something_new_the_server_added").resolvedState)
    }

    func testSnapshotResolutionHeroNilForALiveOpenPrescription() {
        // The ordinary case — no resolution at all — must keep falling
        // through to the existing `PlanSnapshotDayView`, unchanged.
        XCTAssertNil(TodayHostV5.snapshotResolutionHero(for: day("2026-09-11")))
    }

    func testSnapshotResolutionHeroNilForCompleted() {
        // Guarded defensively even though a completed day should never reach
        // this function in practice (the `matched_run == nil` gate one call
        // site up already excludes it) — see the function's own header for
        // why this is asserted rather than assumed.
        XCTAssertNil(TodayHostV5.snapshotResolutionHero(for: day("2026-09-08", resolution: "completed")))
    }

    func testSnapshotResolutionHeroForMissed() {
        let hero = TodayHostV5.snapshotResolutionHero(for: day("2026-09-10", resolution: "missed"))
        XCTAssertEqual(hero?.resolution, "missed")
        XCTAssertEqual(hero?.state, .missed)
        XCTAssertNil(hero?.movedToISO)
    }

    func testSnapshotResolutionHeroForSkipped() {
        let hero = TodayHostV5.snapshotResolutionHero(for: day("2026-09-06", resolution: "skipped"))
        XCTAssertEqual(hero?.state, .skipped)
    }

    func testSnapshotResolutionHeroCarriesMovedToISO() {
        let hero = TodayHostV5.snapshotResolutionHero(
            for: day("2026-09-04", resolution: "moved", moved_to_iso: "2026-09-06"))
        XCTAssertEqual(hero?.state, .moved)
        XCTAssertEqual(hero?.movedToISO, "2026-09-06")
    }

    func testSnapshotResolutionHeroCarriesSupplementalRunIds() {
        let supplemental = PlanSnapshotSupplementalRun(runId: "r_extra", distanceMi: 3.1,
                                                         durationSec: 1500, paceSPerMi: 480, indoor: false)
        let hero = TodayHostV5.snapshotResolutionHero(
            for: day("2026-09-07", resolution: "supplemental", supplemental_runs: [supplemental]))
        XCTAssertEqual(hero?.state, .supplemental)
        XCTAssertEqual(hero?.supplementalRunIds, ["r_extra"])
    }

    // MARK: - Falsified once (Rule 18): the field genuinely gates the branch,
    // not a tautology that would pass however `snapshotResolutionHero` were
    // wired.

    func testFalsifier_aLiveDayAndAMissedDayMustNotBeIndistinguishable() {
        let live = day("2026-09-11")
        let missed = day("2026-09-11", resolution: "missed")
        XCTAssertNotEqual(TodayHostV5.snapshotResolutionHero(for: live) != nil,
                           TodayHostV5.snapshotResolutionHero(for: missed) != nil,
                           "a day with no resolution and a missed day must route to different content")
    }
}
