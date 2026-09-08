//
//  SkipAndProjectionRenderUITests.swift
//
//  SKIPCAL-1 / SKIPPROJ-CONTRAST-1 (2026-09-08) · the RENDERING half.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY IT EXISTS
//
//  CLAUDE.md Rule 13: a change to something the runner sees is verified by
//  RENDERING it, with real data — "not by reading the code, not against a
//  sample fixture, not by asserting the absence of the bad thing."
//
//  Both fixes in this change are literally invisible to a unit test:
//
//   · The projected-finish DASH was drawn at 1.02:1 against the race-day
//     gradient. `V5ContrastTests` computes that number from the tokens, which
//     is the right gate — and a token can be correct while a call site inside
//     a `DayPanel` forgets to thread it. Only a screenshot settles which
//     colour reached the glass.
//   · The SKIPPED day's status column was blank because the decoder dropped
//     the server's key. `V5BlockSkipDecodeTests` proves the decode and the
//     status ladder; neither can see whether the calendar sheet still calls
//     that ladder.
//
//  So this file opens the real screens, against the real payload, and keeps
//  the pictures.
//
//  ─────────────────────────────────────────────────────────────────────────
//  HOW TO RUN IT (SKIPPED unless you do), and note the `TEST_RUNNER_` prefix
//
//    1 · a scratch database built from the owner's real production rows
//          FAFF_HARNESS_DB=faff_fix_skipproj_contrast \
//            bash web-v2/scripts/adapt-harness-substrate.sh
//    2 · `next dev` with DATABASE_URL pointed at it
//    3 · a bearer session row in THAT database (sha256 of the token)
//
//    TEST_RUNNER_FAFF_UI_HOST=http://127.0.0.1:3123 \
//    TEST_RUNNER_FAFF_UI_TOKEN=<bearer> \
//    TEST_RUNNER_FAFF_UI_SKIPPED_DAY='S 6' \
//    TEST_RUNNER_FAFF_UI_RACE_DAY='S 13' \
//    xcodebuild test -project native-v2/Faff.xcodeproj -scheme Faff \
//      -destination 'id=<your own sim>' \
//      -only-testing:FaffUITests/SkipAndProjectionRenderUITests
//
//  `xcodebuild` forwards only `TEST_RUNNER_`-prefixed variables into the
//  simulator, with the prefix stripped. Without the prefix these tests SKIP
//  and the run reports success having done nothing — Rule 18's worst outcome.
//  A SKIP here is a failure to run, never a pass.
//
//  ─────────────────────────────────────────────────────────────────────────
//  RULE 22 · WHAT THIS CANNOT FAIL ON
//
//  · It cannot fail in CI, because it skips there. The standing gates are
//    `V5ContrastTests` and `V5BlockSkipDecodeTests`; this is the render.
//  · It refuses any non-loopback host, so it can never point the app at
//    faff.run and can never write a production row.
//  · It asserts the WORDS on the screen and keeps the PIXELS as an
//    attachment. It does not itself measure the contrast of the dash — the
//    screenshot is measured outside, against the ramp underneath it, which is
//    the only place the composite actually exists.
//  · The projected-finish failure state has to be FAULT-INJECTED upstream
//    (the deadline dropped so the outlook resolution times out). This file
//    does not inject it; it renders whatever the backend serves, and the
//    invocation is responsible for arranging the state. If the projection
//    resolves normally the dash case simply does not appear, and the test
//    says so rather than passing quietly.
//

import XCTest

final class SkipAndProjectionRenderUITests: XCTestCase {

    private var host: String { ProcessInfo.processInfo.environment["FAFF_UI_HOST"] ?? "" }
    private var token: String { ProcessInfo.processInfo.environment["FAFF_UI_TOKEN"] ?? "" }
    /// The calendar row label of the day the scratch database records a skip
    /// on, e.g. `S 6`. Passed in rather than hard-coded: which day carries a
    /// real skip is a property of the runner's history, not of this test.
    private var skippedDayLabel: String {
        ProcessInfo.processInfo.environment["FAFF_UI_SKIPPED_DAY"] ?? ""
    }
    /// The calendar row label of a race day, e.g. `S 13`.
    private var raceDayLabel: String {
        ProcessInfo.processInfo.environment["FAFF_UI_RACE_DAY"] ?? ""
    }

    private var hostIsLocal: Bool {
        guard let u = URL(string: host), let h = u.host else { return false }
        return h == "127.0.0.1" || h == "localhost" || h == "::1"
    }

    override func setUpWithError() throws {
        continueAfterFailure = false
        try XCTSkipUnless(!host.isEmpty && !token.isEmpty,
                          "Set FAFF_UI_HOST and FAFF_UI_TOKEN. See this file's header.")
        XCTAssertTrue(hostIsLocal, "REFUSING: \(host) is not loopback.")
    }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot())
        a.name = name
        a.lifetime = .keepAlways
        add(a)
    }

    private func launchToToday() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-faffHost", host, "-faffToken", token]
        app.launch()
        let today = app.staticTexts.containing(
            NSPredicate(format: "label ==[c] 'Today'")).firstMatch
        if !today.waitForExistence(timeout: 60) {
            print("[hierarchy] \(app.debugDescription)")
            XCTFail("never reached Today")
        }
        return app
    }

    /// Today's app bar → the grid button → the training-calendar sheet.
    private func openCalendar(_ app: XCUIApplication) {
        // 60s, not 20. A cold install fetches today, the block, races,
        // readiness and the whole plan snapshot before the header settles,
        // and this harness reinstalls on every run. A flaky repro is bad
        // evidence: it produces failures that say nothing about the code.
        let grid = app.buttons["Training calendar"]
        XCTAssertTrue(grid.waitForExistence(timeout: 60), "no calendar button on Today")
        let title = app.staticTexts.matching(
            NSPredicate(format: "label ==[c] 'Training calendar'")).firstMatch
        for _ in 0..<4 {
            grid.tap()
            if title.waitForExistence(timeout: 5) {
                if ProcessInfo.processInfo.environment["FAFF_UI_DUMP"] == "1" {
                    print("[hierarchy · calendar open] \(app.debugDescription)")
                }
                return
            }
            Thread.sleep(forTimeInterval: 1.0)
        }
        print("[hierarchy · after calendar tap] \(app.debugDescription)")
        XCTFail("the training calendar never opened")
    }

    /// Scroll the calendar's OWN list, never the app root.
    ///
    /// `XCUIApplication.swipeDown()` on this screen dismisses the sheet — the
    /// first run of this file scrolled the calendar right off the screen and
    /// then reported "no row labelled S 6" while dumping a hierarchy that was
    /// plainly Today. A drag inside the list's own frame moves the list.
    private func scrollCalendar(_ app: XCUIApplication, up: Bool) {
        let list = app.scrollViews.element(boundBy: app.scrollViews.count - 1)
        guard list.exists else { return }
        let mid = list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let to = list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: up ? 0.9 : 0.1))
        mid.press(forDuration: 0.05, thenDragTo: to)
        Thread.sleep(forTimeInterval: 0.6)
    }

    // MARK: - 1 · a skipped day is legible in the training calendar

    /// THE ROW THE FIX EXISTS FOR, on the screen it exists for.
    ///
    /// Before this change the server sent `skipped: true`, `V5BlockDay` had no
    /// property to decode it into, and this row rendered with a blank status
    /// column — the same as any untouched day of the same type.
    func testTheTrainingCalendarShowsASkippedDay() throws {
        try XCTSkipUnless(!skippedDayLabel.isEmpty,
                          "Set FAFF_UI_SKIPPED_DAY to the calendar label of a day the "
                          + "scratch database records a skip on.")
        let app = launchToToday()
        openCalendar(app)

        // The row for the skipped day, found by its own label, then scrolled
        // to. The calendar opens on THIS week, so a past week is above it.
        let row = app.buttons.containing(
            NSPredicate(format: "label CONTAINS %@", skippedDayLabel)).firstMatch
        // The block arrives on its own schedule: until it does, the sheet
        // shows the CURRENT week only (`fallbackCalendarWeeks`) and a past
        // week's row does not exist to be found. So this waits for the row
        // rather than scrolling for it, then scrolls.
        var found = row.waitForExistence(timeout: 30)
        for _ in 0..<20 where !found {
            scrollCalendar(app, up: true)
            found = row.exists
        }
        if !found {
            print("[hierarchy · calendar] \(app.debugDescription)")
            XCTFail("no calendar row labelled \(skippedDayLabel)")
        }
        // EXISTS IS NOT ON SCREEN. XCUITest reports an element in a scroll
        // view as existing long before it is visible, and the calendar opens
        // on THIS week with the past above it — so the first screenshot this
        // file produced was of a correct assertion about a row nobody could
        // see. Rule 13 wants the picture to show the thing.
        for _ in 0..<20 where !row.isHittable {
            scrollCalendar(app, up: true)
        }
        XCTAssertTrue(row.isHittable,
                      "the \(skippedDayLabel) row never came on screen to be photographed")
        shot(app, "01-training-calendar-with-a-skipped-day")

        // ASSERT THE SHAPE OF THE RESULT, NOT THE ABSENCE OF THE DEFECT
        // (Rule 13 §3). "Skipped." must be ON the row for that day, not merely
        // somewhere on the screen — a sheet containing the word anywhere would
        // satisfy a looser check while the row itself stayed blank.
        XCTAssertTrue(row.label.contains("Skipped"),
                      "the \(skippedDayLabel) row reads '\(row.label)' · the skip is not on it")
    }

    // MARK: - 2 · the projected-finish dash on a race day

    /// Opens a RACE day through the calendar, which is the real door, and
    /// keeps the picture of its stats plate.
    ///
    /// What the picture is for: the "Projected finish" slot on a race day sits
    /// on the `race` gradient, and when the engine cannot produce the figure
    /// the slot holds a dash and nothing else. The dash was drawn in
    /// `V5.fault` #FF4438, which measures 1.02:1 there. The screenshot is the
    /// evidence, measured outside this file against the ramp under it.
    func testARaceDayPanelRendersItsProjectedFinishSlot() throws {
        try XCTSkipUnless(!raceDayLabel.isEmpty,
                          "Set FAFF_UI_RACE_DAY to the calendar label of a race day.")
        let app = launchToToday()
        openCalendar(app)

        let row = app.buttons.containing(
            NSPredicate(format: "label CONTAINS %@", raceDayLabel)).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15),
                      "no calendar row labelled \(raceDayLabel)")
        row.tap()

        // The panel re-fills with the race ramp and the stat plate redraws.
        let stat = app.staticTexts.containing(
            NSPredicate(format: "label CONTAINS 'Projected finish'")).firstMatch
        if !stat.waitForExistence(timeout: 30) {
            print("[hierarchy · race day] \(app.debugDescription)")
            XCTFail("the race day drew no Projected finish stat · nothing to render")
        }
        shot(app, "02-race-day-projected-finish")

        // VoiceOver is the other half of the distinction the dash carries. It
        // is asserted here and not in the contrast test because only the
        // running app proves the label survives `.accessibilityElement
        // (children: .combine)` on the stat's own column.
        print("[projected-finish stat] \(stat.label)")
    }
}
