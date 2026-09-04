//
//  PlanVersionInvalidationTests.swift
//  faff.run iPhone · PLANVERSION-1's own regression coverage.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE GAP THIS CLOSES
//
//  A per-day diff on `weekStrip[i].id` (plan_workout_id) catches a full
//  rebuild — every id changes — but NOT an in-place re-anchor, which rewrites
//  `plan_workouts` under the SAME id (verified server-side against a real
//  local plan copy: `wko_13338389f511a813` kept its id while `distance_mi`
//  moved 5→7 mi and `training_plans.last_adapted_at` bumped from
//  `00:53:41-07` to `11:32:17-07`, changing `planVersion` end to end). These
//  tests prove the client closes that exact gap: `reconciledDayCache` wipes
//  the WHOLE cache when `planVersion` changes, even when every cached row's
//  own id is unchanged — the fixtures below hold row ids constant across
//  "version A" and "version B" so the per-day id-diff fallback would find
//  nothing on its own, isolating what `planVersion` alone is responsible for.
//
//  Tests call `TodayHostV5.reconciledDayCache(_:lastKnownPlanVersion:against:)`
//  directly rather than constructing a `TodayHostV5` and reading its `@State`
//  back — `@State` mutated on a bare, unrendered host does not reliably
//  persist across statements outside a live SwiftUI view hierarchy, which is
//  also why `readiness(model:wanted:pendingDate:)` in `TodayNavigationTests`
//  is a pure function rather than a `@State` read. `reconciledDayCache` is
//  the same shape, and `reconcileDayCache` is its two-line `@State` wrapper.
//

import XCTest
@testable import Faff

final class PlanVersionInvalidationTests: XCTestCase {

    private func decode(_ json: String) throws -> V5Today {
        try JSONDecoder().decode(V5Today.self, from: Data(json.utf8))
    }

    /// Same shape as `V5ContractTests.Fixtures.beforeRun`, parameterized on
    /// `planVersion` and on the Sept 10 row's own `id` — held constant across
    /// "version A" and "version B" below unless a test says otherwise, so
    /// that any invalidation seen is provably driven by `planVersion` alone.
    private func payload(planVersion: String?, sept10RowID: String = "date:2026-09-10") -> String {
        let versionLine = planVersion.map { "\"planVersion\": \"\($0)\"," } ?? "\"planVersion\": null,"
        return #"""
        {
          "dateISO": "2026-09-03",
          \#(versionLine)
          "state": "before_run",
          "panel": {
            "dayState": "quality",
            "quiet": false,
            "place": "Today",
            "dateLine": "Thursday September 3",
            "weekLine": "Week 1 of 16",
            "kicker": null,
            "type": "Intervals",
            "dose": null,
            "stats": []
          },
          "weekStrip": [
            {
              "id": "date:2026-09-03",
              "dateISO": "2026-09-03",
              "letter": "T",
              "number": "3",
              "dayState": "quality",
              "isToday": true,
              "isDone": false,
              "isRest": false
            },
            {
              "id": "\#(sept10RowID)",
              "dateISO": "2026-09-10",
              "letter": "T",
              "number": "10",
              "dayState": "easy",
              "isToday": false,
              "isDone": false,
              "isRest": false
            }
          ],
          "groups": [],
          "why": null,
          "whereYouAre": [],
          "beforeYouGo": [],
          "askedVsRan": [],
          "verdict": null,
          "zoneShares": null,
          "zoneTarget": null,
          "elevation": null,
          "onTheBelt": null,
          "shoesWorn": null,
          "whatThisDidToTheWeek": [],
          "runId": null,
          "changed": null,
          "injury": null,
          "weekOff": null,
          "offSeason": null,
          "notOnPhoneYet": null
        }
        """#
    }

    /// A minimal standalone payload standing in for a cached Sept 10 day —
    /// its own `weekStrip` entry for itself carries `rowID`, so the per-day
    /// id-diff fallback in `reconciledDayCache` sees this cached row's id and
    /// can compare it against a fresh payload's row for the same date.
    private func sept10CachedDay(rowID: String = "date:2026-09-10") -> String {
        #"""
        {
          "dateISO": "2026-09-10",
          "planVersion": null,
          "state": "before_run",
          "panel": {
            "dayState": "easy",
            "quiet": false,
            "place": "Today",
            "dateLine": "Thursday September 10",
            "weekLine": "Week 2 of 16",
            "kicker": null,
            "type": "Easy",
            "dose": null,
            "stats": []
          },
          "weekStrip": [
            {
              "id": "\#(rowID)",
              "dateISO": "2026-09-10",
              "letter": "T",
              "number": "10",
              "dayState": "easy",
              "isToday": true,
              "isDone": false,
              "isRest": false
            }
          ],
          "groups": [],
          "why": null,
          "whereYouAre": [],
          "beforeYouGo": [],
          "askedVsRan": [],
          "verdict": null,
          "zoneShares": null,
          "zoneTarget": null,
          "elevation": null,
          "onTheBelt": null,
          "shoesWorn": null,
          "whatThisDidToTheWeek": [],
          "runId": null,
          "changed": null,
          "injury": null,
          "weekOff": null,
          "offSeason": null,
          "notOnPhoneYet": null
        }
        """#
    }

    /// THE GAP, closed: an in-place re-anchor — `planVersion` changes,
    /// `plan_workout_id` (the weekStrip row's own `id`) does NOT — must still
    /// evict the cached day. A per-day id diff alone would see nothing here
    /// by construction (`sept10RowID` is identical in both payloads).
    func testPlanVersionChangeWipesCacheEvenWhenRowIDsAreUnchanged() throws {
        let versionA = try decode(payload(planVersion: "pln_x:2026-09-03T00:53:41-07:00"))
        let afterA = TodayHostV5.reconciledDayCache([:], lastKnownPlanVersion: nil, against: versionA)

        var cache = afterA.cache
        cache["2026-09-10"] = try decode(sept10CachedDay()) // simulate a prefetched, cached day

        let versionB = try decode(payload(planVersion: "pln_x:2026-09-03T11:32:17-07:00")) // last_adapted_at bumped; row id unchanged
        let afterB = TodayHostV5.reconciledDayCache(cache, lastKnownPlanVersion: afterA.lastKnownPlanVersion, against: versionB)

        XCTAssertNil(afterB.cache["2026-09-10"], "a planVersion change must evict the whole cache, including days whose own row id never changed")
    }

    /// The negative case, so the test above isn't trivially satisfied by a
    /// function that just always wipes: an unchanged `planVersion` must leave
    /// a cached day alone.
    func testUnchangedPlanVersionLeavesCacheAlone() throws {
        let versionA = try decode(payload(planVersion: "pln_x:2026-09-03T00:53:41-07:00"))
        let afterA = TodayHostV5.reconciledDayCache([:], lastKnownPlanVersion: nil, against: versionA)

        let cachedDay = try decode(sept10CachedDay())
        var cache = afterA.cache
        cache["2026-09-10"] = cachedDay

        let stillA = try decode(payload(planVersion: "pln_x:2026-09-03T00:53:41-07:00"))
        let afterStillA = TodayHostV5.reconciledDayCache(cache, lastKnownPlanVersion: afterA.lastKnownPlanVersion, against: stillA)

        XCTAssertEqual(afterStillA.cache["2026-09-10"], cachedDay, "an unchanged planVersion must not evict anything")
    }

    /// The FALLBACK path, independently: a server too old to send
    /// `planVersion` (nil on both) must still catch a changed row id via the
    /// per-day diff — PLANVERSION-1 is additive, it does not replace this.
    func testRowIDChangeAloneStillEvictsThatDayWhenPlanVersionIsAbsent() throws {
        let versionA = try decode(payload(planVersion: nil, sept10RowID: "date:2026-09-10"))
        let afterA = TodayHostV5.reconciledDayCache([:], lastKnownPlanVersion: nil, against: versionA)

        var cache = afterA.cache
        cache["2026-09-10"] = try decode(sept10CachedDay(rowID: "date:2026-09-10"))

        let rebuilt = try decode(payload(planVersion: nil, sept10RowID: "date:2026-09-10-rebuilt"))
        let afterRebuilt = TodayHostV5.reconciledDayCache(cache, lastKnownPlanVersion: afterA.lastKnownPlanVersion, against: rebuilt)

        XCTAssertNil(afterRebuilt.cache["2026-09-10"], "a changed row id must still evict that day even with no planVersion on the wire")
    }

    /// The very first payload a session ever sees must never wipe a cache —
    /// `lastKnownPlanVersion` starts nil, and nil is "never seen a version
    /// yet," not "the version just changed."
    func testFirstPayloadOfASessionNeverWipesAnything() throws {
        let cachedDay = try decode(sept10CachedDay())
        let seededCache = ["2026-09-10": cachedDay]

        let firstEverPayload = try decode(payload(planVersion: "pln_x:2026-09-03T00:53:41-07:00"))
        let result = TodayHostV5.reconciledDayCache(seededCache, lastKnownPlanVersion: nil, against: firstEverPayload)

        XCTAssertEqual(result.cache["2026-09-10"], cachedDay, "the first payload of a session establishes the baseline version, it does not invalidate against one")
        XCTAssertEqual(result.lastKnownPlanVersion, "pln_x:2026-09-03T00:53:41-07:00")
    }

    /// `lastKnownPlanVersion` itself only advances on a payload that actually
    /// carries one — an older server's nil `planVersion` must not erase a
    /// version this session already knows.
    func testAbsentPlanVersionOnAFreshPayloadDoesNotClearTheKnownVersion() throws {
        let payloadWithNoVersion = try decode(payload(planVersion: nil))
        let result = TodayHostV5.reconciledDayCache([:], lastKnownPlanVersion: "pln_x:2026-09-03T00:53:41-07:00", against: payloadWithNoVersion)
        XCTAssertEqual(result.lastKnownPlanVersion, "pln_x:2026-09-03T00:53:41-07:00")
    }
}
