//
//  WriteHonestyUITests.swift
//
//  TODAYWRITE-1 (2026-09-08 review) · the RENDERING half of the proof.
//
//  `WriteHonestyTests` (unit) walks the settlement and the copy tables. It
//  cannot press a button, and it cannot see a screen — and the defect this
//  file exists for was reported by someone LOOKING at Today, so CLAUDE.md
//  Rule 13 is explicit that the fix is verified by rendering it, with real
//  data, not by asserting the absence of a bad string in a fixture.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE REVIEWER'S REPRO, WHICH IS WHAT THIS FILE DRIVES
//
//  With `POST /api/sick` failing, Today still rendered:
//
//      "Reported"  /  "Logged. Today rests."
//
//  and the database recorded no episode. Same shape on `POST /api/niggle`:
//  "<part> flagged · The coach has it, it shapes tomorrow" over nothing.
//
//  So: fail the write at the proxy — the request never reaches the server, so
//  the absence of a row is structural rather than asserted — and read what
//  Today actually says. Then clear the fault, press the row's own Retry, and
//  read it again. BOTH directions, because a row that never confirms anything
//  is its own defect (Rule 22).
//
//  ─────────────────────────────────────────────────────────────────────────
//  HOW TO RUN IT (it is SKIPPED unless you do)
//
//  Identical scaffolding to `SettingsFailureUITests` — read that file's header
//  first; only the database name and ports differ here.
//
//    1 · a scratch database built from the owner's real production rows
//        FAFF_HARNESS_DB=faff_fix_resilience_honesty \
//          bash web-v2/scripts/adapt-harness-substrate.sh
//        then mint a bearer session in it against the owner's user row.
//    2 · `next dev` with DATABASE_URL pointed at that database
//    3 · the fault proxy in front of it, same `/__fault?rules=` contract
//
//    TEST_RUNNER_FAFF_UI_HOST=http://127.0.0.1:<proxy> \
//    TEST_RUNNER_FAFF_UI_TOKEN=<bearer> \
//    xcodebuild test -project native-v2/Faff.xcodeproj -scheme Faff \
//      -destination 'platform=iOS Simulator,name=<your own sim>' \
//      -only-testing:FaffUITests/WriteHonestyUITests
//
//  THE `TEST_RUNNER_` PREFIX IS LOAD-BEARING — `xcodebuild` forwards nothing
//  else into the simulator, and without it this file reports "1 test skipped,
//  TEST SUCCEEDED", which is Rule 18's worst outcome: a green line that ran
//  nothing. A SKIP here is a failure to run, never a pass.
//
//  ─────────────────────────────────────────────────────────────────────────
//  RULE 22 · WHAT THIS GATE CANNOT FAIL ON
//
//  · It cannot fail in CI. It skips there, deliberately — it drives a real
//    backend. This file is a REPRO; the standing gate is `WriteHonestyTests`.
//  · It cannot fail on production behaviour. It refuses any host that is not
//    loopback, so it can never point the app at faff.run and can never write
//    a production row.
//  · It covers the SICK REPORT row end to end and nothing else end to end.
//    The niggle flag, the injury check-in, the sick trend and the shoe pick
//    reach the same `V5RowWriteState` through the same `v5SettleWrite`, and
//    the unit file walks all of them, but only this one is pressed here. The
//    niggle row additionally needs an `after_run` day, which not every
//    substrate has.
//  · It cannot fail on the DATABASE. It proves the screen does not claim
//    success; the proof that nothing was written is that the proxy never
//    forwarded the request (`mode: status` answers without an upstream hop).
//    A direct row count is the reviewer's own separate check.
//
//  · IT SAYS NOTHING ABOUT CANCELBANNER-2, the false-outage half of the same
//    review. Two end-to-end drivers for that were built here and both PASSED
//    against the unfixed code, so both were deleted rather than kept as
//    green decoration — see `SurfaceCancellationTests`' header for what they
//    were, why the coalescer makes the obvious one impossible, and where the
//    real cancellation comes from.
//

import XCTest

final class WriteHonestyUITests: XCTestCase {

    private var host: String { ProcessInfo.processInfo.environment["FAFF_UI_HOST"] ?? "" }
    private var token: String { ProcessInfo.processInfo.environment["FAFF_UI_TOKEN"] ?? "" }

    /// Loopback only. A UI test that could be pointed at production is a
    /// production write path wearing a test's clothes.
    private var hostIsLocal: Bool {
        guard let u = URL(string: host), let h = u.host else { return false }
        return h == "127.0.0.1" || h == "localhost" || h == "::1"
    }

    override func setUpWithError() throws {
        continueAfterFailure = false
        try XCTSkipUnless(!host.isEmpty && !token.isEmpty,
                          "Set TEST_RUNNER_FAFF_UI_HOST and TEST_RUNNER_FAFF_UI_TOKEN. See this file's header.")
        XCTAssertTrue(hostIsLocal, "REFUSING: \(host) is not loopback.")
    }

    // MARK: - The fault proxy's control plane

    @discardableResult
    private func setFaults(_ rules: [[String: Any]]) -> Bool {
        let json = String(data: try! JSONSerialization.data(withJSONObject: rules), encoding: .utf8)!
        let encoded = json.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? json
        guard let url = URL(string: "\(host)/__fault?rules=\(encoded)") else { return false }
        let sem = DispatchSemaphore(value: 0)
        var ok = false
        URLSession.shared.dataTask(with: url) { _, resp, _ in
            ok = (resp as? HTTPURLResponse)?.statusCode == 200
            sem.signal()
        }.resume()
        _ = sem.wait(timeout: .now() + 10)
        return ok
    }

    private func launchIntoToday() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-faffHost", host, "-faffToken", token]
        app.launch()
        let today = app.staticTexts.containing(
            NSPredicate(format: "label ==[c] 'Today'")).firstMatch
        if !today.waitForExistence(timeout: 40) {
            print("[hierarchy] \(app.debugDescription)")
            XCTFail("never reached Today")
        }
        return app
    }

    /// Every sentence on screen, from staticTexts AND from the composite
    /// elements. `ExpandingRow` publishes its label and sub as ONE
    /// accessibility element rather than two `staticTexts`, and that element
    /// is exactly where the row's verdict lives — a blob built from
    /// `staticTexts` alone cannot see the sentence this file exists to check.
    private func visibleText(_ app: XCUIApplication) -> String {
        let statics = app.staticTexts.allElementsBoundByIndex.prefix(120).map { $0.label }
        let buttons = app.buttons.allElementsBoundByIndex.prefix(120).map { $0.label }
        let others = app.otherElements.allElementsBoundByIndex.prefix(160).map { $0.label }
        return (statics + buttons + others).joined(separator: " | ")
    }

    /// Attach the screen, so the evidence for a runner-facing change is a
    /// PICTURE (Rule 13). Extract with:
    ///   xcrun xcresulttool export attachments --path <.xcresult> --output-path <dir>
    private func shot(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot())
        a.name = name
        a.lifetime = .keepAlways
        add(a)
    }

    /// Scroll until an element with this label is hittable, then hand it back.
    @discardableResult
    private func reveal(_ app: XCUIApplication, label: String, tries: Int = 12) -> XCUIElement {
        let el = app.descendants(matching: .any).matching(
            NSPredicate(format: "label BEGINSWITH %@", label)).firstMatch
        for _ in 0..<tries {
            if el.exists && el.isHittable { return el }
            app.swipeUp()
        }
        return el
    }

    // MARK: - The sick report, both directions

    /// THE REVIEWER'S EXACT REPRO, then its opposite.
    ///
    /// Part 1 · `POST /api/sick` 503s at the proxy, so nothing reaches the
    /// server. The row must NOT say "Logged. Today rests." — the plan has not
    /// changed and the coach has not seen it — and it must offer a Retry.
    ///
    /// Part 2 · the fault is cleared and that same Retry pressed. NOW the row
    /// says it, because now it is true.
    func testAFailedSickReportNeverClaimsTheDayIsLogged() throws {
        XCTAssertTrue(setFaults([
            ["match": "/api/sick", "mode": "status", "status": 503, "method": "POST"],
        ]), "fault proxy did not accept rules")

        let app = launchIntoToday()

        let row = reveal(app, label: "Not feeling right")
        XCTAssertTrue(row.exists, "the sick report row is not on Today\n\(visibleText(app))")
        shot(app, "01-before-report")
        row.tap()

        let symptom = app.buttons.matching(
            NSPredicate(format: "label BEGINSWITH 'Head cold'")).firstMatch
        XCTAssertTrue(symptom.waitForExistence(timeout: 10),
                      "the symptom picker never expanded\n\(visibleText(app))")
        symptom.tap()

        let report = app.buttons.matching(
            NSPredicate(format: "label BEGINSWITH 'Report it'")).firstMatch
        XCTAssertTrue(report.waitForExistence(timeout: 10), "no Report it button")
        report.tap()

        // ── the failing world ────────────────────────────────────────────
        let failureCopy = app.staticTexts.containing(
            NSPredicate(format: "label CONTAINS 'That did not send'")).firstMatch
        XCTAssertTrue(failureCopy.waitForExistence(timeout: 25),
                      "a failed report said nothing at all\n\(visibleText(app))")
        shot(app, "02-failed-report-honest-state")

        let afterFailure = visibleText(app)
        XCTAssertFalse(afterFailure.contains("Logged. Today rests."),
                       "THE DEFECT: the row claimed the plan rests over a write that 503d\n\(afterFailure)")
        XCTAssertTrue(afterFailure.contains("Not sent"),
                      "the row must state the failure, not just fall silent\n\(afterFailure)")

        let retry = app.buttons.matching(
            NSPredicate(format: "label BEGINSWITH 'Retry'")).firstMatch
        XCTAssertTrue(retry.exists, "an honest failure with no way back is half a fix")

        // ── the healthy world ────────────────────────────────────────────
        //
        // BOTH DIRECTIONS (Rule 22). A row that never confirms anything is
        // its own defect, and a fix that only ever says "not saved" would
        // pass the half above.
        //
        // WHAT CONFIRMATION ACTUALLY LOOKS LIKE HERE, and why it is not the
        // row's own "Logged. Today rests.": a report that lands flips
        // TODAY'S OWN STATE to `sick` on the reload `settleAndReload` runs
        // before it returns, so `SickFlareV5` replaces the whole screen and
        // this row — along with its label — goes with it. That whole-screen
        // change IS the confirmation the runner reads. The row's own
        // confirmed copy is reached in the narrower case where the state
        // does not flip, and `WriteHonestyTests` is what walks it.
        XCTAssertTrue(setFaults([]), "could not clear faults")
        retry.tap()

        let flare = app.staticTexts.containing(
            NSPredicate(format: "label ==[c] 'Not today'")).firstMatch
        XCTAssertTrue(flare.waitForExistence(timeout: 30),
                      "a report that LANDED must still change the day\n\(visibleText(app))")
        shot(app, "03-landed-report-confirms")

        let afterLanding = visibleText(app)
        XCTAssertFalse(afterLanding.contains("That did not send"),
                       "the failure note must clear once the write lands\n\(afterLanding)")
    }
}
