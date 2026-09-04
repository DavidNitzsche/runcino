//
//  PlanSnapshotStoreTests.swift
//  PLANSNAPSHOT-1's own coverage for the atomic-commit contract: a valid
//  snapshot replaces `current` and lands on disk; a malformed one changes
//  neither; a relaunch (fresh store instance, same file) reloads exactly
//  what was last validated.
//

import XCTest
@testable import Faff

final class PlanSnapshotStoreTests: XCTestCase {

    var tempDir: URL!

    override func setUp() {
        super.setUp()
        tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("PlanSnapshotStoreTests-\(UUID().uuidString)")
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: tempDir)
        super.tearDown()
    }

    private func validSnapshotJSON(planId: String = "pln_abc", version: String = "pln_abc:v1",
                                    start: String = "2026-08-24", end: String = "2026-12-06",
                                    days: String = #"[{"plan_workout_id":"pw_1","date_iso":"2026-09-03","dow":4,"type":"rest","is_rest":true,"is_race":false,"is_quality":false,"is_long":false,"distance_mi":0,"sub_label":null,"notes":null,"card":null,"treadmill":null,"matched_run":null,"supplemental_runs":[]}]"#
    ) -> Data {
        let json = """
        {"plan_id":"\(planId)","plan_version":"\(version)","plan_start_iso":"\(start)","plan_end_iso":"\(end)",
         "today_iso":"2026-09-03","synced_at":"2026-09-04T00:00:00.000Z","days":\(days)}
        """
        return json.data(using: .utf8)!
    }

    private func noActivePlanJSON() -> Data {
        """
        {"plan_id":null,"plan_version":null,"plan_start_iso":null,"plan_end_iso":null,
         "today_iso":"2026-09-03","synced_at":"2026-09-04T00:00:00.000Z","days":[],"message":"No active plan."}
        """.data(using: .utf8)!
    }

    // MARK: - Happy path

    func testValidSnapshotCommitsAndPersists() {
        let store = PlanSnapshotStore(testDirectory: tempDir)
        XCTAssertNil(store.current)

        let result = store.commit(rawData: validSnapshotJSON())
        switch result {
        case .success(let snap):
            XCTAssertEqual(snap.plan_id, "pln_abc")
        case .failure(let e):
            XCTFail("expected success, got \(e)")
        }
        XCTAssertEqual(store.current?.plan_id, "pln_abc")
        XCTAssertNotNil(store.lastSuccessfulSyncAt)
        XCTAssertNil(store.lastError)

        // Relaunch: a fresh store instance reading the SAME directory must
        // reload exactly what was committed.
        let reloaded = PlanSnapshotStore(testDirectory: tempDir)
        XCTAssertNil(reloaded.current) // not yet loaded
        reloaded.loadFromDiskSynchronously()
        XCTAssertEqual(reloaded.current?.plan_id, "pln_abc")
        XCTAssertEqual(reloaded.current?.plan_version, "pln_abc:v1")
        XCTAssertEqual(reloaded.current?.days.count, 1)
    }

    func testNoActivePlanIsAValidCommit() {
        let store = PlanSnapshotStore(testDirectory: tempDir)
        let result = store.commit(rawData: noActivePlanJSON())
        if case .failure(let e) = result { XCTFail("expected success, got \(e)") }
        XCTAssertEqual(store.current?.message, "No active plan.")
        XCTAssertEqual(store.current?.days.count, 0)
    }

    // MARK: - The rule that matters most: a bad commit cannot damage a good one

    func testMalformedCommitNeverReplacesAValidSnapshot() {
        let store = PlanSnapshotStore(testDirectory: tempDir)
        _ = store.commit(rawData: validSnapshotJSON(planId: "pln_good"))
        XCTAssertEqual(store.current?.plan_id, "pln_good")

        // Garbage bytes — not even valid JSON.
        let garbage = "{not json".data(using: .utf8)!
        let result = store.commit(rawData: garbage)
        if case .success = result { XCTFail("garbage must not be accepted") }

        // `current` is UNTOUCHED.
        XCTAssertEqual(store.current?.plan_id, "pln_good")
        XCTAssertNotNil(store.lastError)

        // The FILE on disk is also untouched — a relaunch still sees the
        // good snapshot, not the garbage and not nothing.
        let reloaded = PlanSnapshotStore(testDirectory: tempDir)
        reloaded.loadFromDiskSynchronously()
        XCTAssertEqual(reloaded.current?.plan_id, "pln_good")
    }

    func testStructurallyInvalidShapeIsRejectedEvenThoughItDecodes() {
        let store = PlanSnapshotStore(testDirectory: tempDir)
        _ = store.commit(rawData: validSnapshotJSON(planId: "pln_good"))

        // Decodes fine as JSON/PlanSnapshot, but bounds with zero days —
        // a real plan can never have no authored days.
        let invalid = validSnapshotJSON(planId: "pln_bad", days: "[]")
        let result = store.commit(rawData: invalid)
        if case .success = result { XCTFail("a real plan with zero days must be refused") }
        XCTAssertEqual(store.current?.plan_id, "pln_good", "the last VALID snapshot must survive")
    }

    func testPlanStartAfterPlanEndIsRejected() {
        let store = PlanSnapshotStore(testDirectory: tempDir)
        let backwards = validSnapshotJSON(start: "2026-12-06", end: "2026-08-24")
        let result = store.commit(rawData: backwards)
        if case .success = result { XCTFail("plan_start_iso after plan_end_iso must be refused") }
    }

    func testMessageWithNonEmptyDaysIsSelfContradictingAndRejected() {
        let store = PlanSnapshotStore(testDirectory: tempDir)
        let json = """
        {"plan_id":null,"plan_version":null,"plan_start_iso":null,"plan_end_iso":null,
         "today_iso":"2026-09-03","synced_at":"2026-09-04T00:00:00.000Z","days":\
        [{"plan_workout_id":null,"date_iso":"2026-09-03","dow":4,"type":"rest","is_rest":true,"is_race":false,"is_quality":false,"is_long":false,"distance_mi":0,"sub_label":null,"notes":null,"card":null,"treadmill":null,"matched_run":null,"supplemental_runs":[]}],
         "message":"No active plan."}
        """.data(using: .utf8)!
        let result = store.commit(rawData: json)
        if case .success = result { XCTFail("message + real days is self-contradicting") }
    }

    // MARK: - Plan-version change is a coherent replacement, not a merge

    func testPlanVersionChangeReplacesTheWholeSnapshotAtomically() {
        let store = PlanSnapshotStore(testDirectory: tempDir)
        _ = store.commit(rawData: validSnapshotJSON(version: "pln_abc:v1",
            days: #"[{"plan_workout_id":"pw_old","date_iso":"2026-09-03","dow":4,"type":"easy","is_rest":false,"is_race":false,"is_quality":false,"is_long":false,"distance_mi":4,"sub_label":null,"notes":null,"card":null,"treadmill":null,"matched_run":null,"supplemental_runs":[]}]"#))
        XCTAssertEqual(store.current?.day(on: "2026-09-03")?.plan_workout_id, "pw_old")

        _ = store.commit(rawData: validSnapshotJSON(version: "pln_abc:v2",
            days: #"[{"plan_workout_id":"pw_new","date_iso":"2026-09-03","dow":4,"type":"threshold","is_rest":false,"is_race":false,"is_quality":true,"is_long":false,"distance_mi":6,"sub_label":null,"notes":null,"card":null,"treadmill":null,"matched_run":null,"supplemental_runs":[]}]"#))
        // The WHOLE day for that date came from the new version — no trace
        // of the old row's id or type survives a coherent replacement.
        XCTAssertEqual(store.current?.plan_version, "pln_abc:v2")
        XCTAssertEqual(store.current?.day(on: "2026-09-03")?.plan_workout_id, "pw_new")
        XCTAssertEqual(store.current?.day(on: "2026-09-03")?.type, "threshold")
    }

    // MARK: - Sync-generation bookkeeping (the diagnostics sheet's field)

    func testSyncGenerationIncrementsOnEveryCommitAttempt() {
        let store = PlanSnapshotStore(testDirectory: tempDir)
        XCTAssertEqual(store.syncGeneration, 0)
        _ = store.commit(rawData: validSnapshotJSON())
        XCTAssertEqual(store.syncGeneration, 1)
        _ = store.commit(rawData: "garbage".data(using: .utf8)!)
        XCTAssertEqual(store.syncGeneration, 2)
    }

    // MARK: - A missing/corrupt file at cold launch degrades quietly

    func testLoadFromDiskWithNoFileLeavesCurrentNil() {
        let store = PlanSnapshotStore(testDirectory: tempDir)
        store.loadFromDiskSynchronously()
        XCTAssertNil(store.current)
    }

    func testLoadFromDiskWithCorruptFileRemovesItAndLeavesCurrentNil() {
        let fileURL = tempDir.appendingPathComponent("plan_snapshot.v1.json")
        try? FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        try? "not json at all".data(using: .utf8)!.write(to: fileURL)

        let store = PlanSnapshotStore(testDirectory: tempDir)
        store.loadFromDiskSynchronously()
        XCTAssertNil(store.current)
        XCTAssertFalse(FileManager.default.fileExists(atPath: fileURL.path),
                        "a corrupt file must be cleared so the next real sync gets a clean slate")
    }

    // MARK: - Falsified once, per this project's own Rule 18

    func testValidationFalsifier_backwardsBoundsWouldPassWithoutTheCheck() {
        // Not a test of production code — proof the validation function's
        // bounds check is load-bearing. Directly exercises
        // `validationFailureReason` rather than mutating the real function.
        let snap = try! JSONDecoder().decode(PlanSnapshot.self, from: validSnapshotJSON(start: "2026-12-06", end: "2026-08-24"))
        XCTAssertNotNil(PlanSnapshotStore.validationFailureReason(snap),
                         "backwards bounds must be caught — if this ever passes, the check regressed")
        let ok = try! JSONDecoder().decode(PlanSnapshot.self, from: validSnapshotJSON())
        XCTAssertNil(PlanSnapshotStore.validationFailureReason(ok))
    }
}
