//
//  ScrollHeaderStatusBarCollisionUITests.swift
//
//  SCROLLCLOCK-1 (2026-09-09) · the RENDERING half.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY IT EXISTS
//
//  CLAUDE.md Rule 13: a fix to something the runner sees is verified by
//  RENDERING it, with real data — never by reading the code and never against
//  a sample fixture. The defect this covers: on Today, Block and Settings,
//  scrolling far enough that a section eyebrow/header reaches the top of the
//  screen let it collide with the status-bar clock, illegibly. No unit test
//  can see this — it is a composition of the device's own status-bar chrome
//  (which does not exist in a unit-test process) and a ScrollView's real
//  scroll-position clipping, neither of which XCTest can synthesize without
//  actually driving a simulator window.
//
//  ─────────────────────────────────────────────────────────────────────────
//  HOW TO RUN IT, and note the `TEST_RUNNER_` prefix
//
//    1 · a scratch database built from the owner's real production rows,
//        read-only, cloned via the project's own harness:
//          bash web-v2/scripts/walk-substrate.sh
//    2 · serve it on :3111 (native-v2 already points there by default):
//          bash web-v2/scripts/walk-server.sh
//    3 · the token minted onto disk by step 1:
//          cat web-v2/.walk-session-token
//
//    TEST_RUNNER_FAFF_UI_HOST=http://127.0.0.1:3111 \
//    TEST_RUNNER_FAFF_UI_TOKEN=$(cat web-v2/.walk-session-token) \
//    xcodebuild test -project native-v2/Faff.xcodeproj -scheme Faff \
//      -destination 'id=<your own sim>' \
//      -only-testing:FaffUITests/ScrollHeaderStatusBarCollisionUITests
//
//  `xcodebuild` forwards only `TEST_RUNNER_`-prefixed variables into the
//  simulator, with the prefix stripped. Without the prefix these tests SKIP
//  and the run reports success having done nothing — Rule 18's worst outcome.
//  A SKIP here is a failure to run, never a pass.
//
//  ─────────────────────────────────────────────────────────────────────────
//  RULE 22 · WHAT THIS CANNOT FAIL ON
//
//  · It cannot fail in CI, because it skips there — no `FAFF_UI_HOST`/`_TOKEN`
//    is ever set in that environment.
//  · It refuses any non-loopback host, so it can never point the app at
//    faff.run and can never write a production row (see `hostIsLocal`).
//  · It keeps PIXELS as attachments and asserts only that scrolling was real
//    (the app moved off its rest position) — the actual "does the header
//    touch the clock" call is made by a human or an agent reading the
//    attached screenshot, the same as every other render-verification file
//    in this suite. A pixel-level automated contrast/overlap assertion is
//    future work, not something this file claims to do.
//

import XCTest

final class ScrollHeaderStatusBarCollisionUITests: XCTestCase {

    private var host: String { ProcessInfo.processInfo.environment["FAFF_UI_HOST"] ?? "" }
    private var token: String { ProcessInfo.processInfo.environment["FAFF_UI_TOKEN"] ?? "" }

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

    /// Repeated small drags on the screen's own scroll view — never
    /// `app.swipeUp()`, which drags from the WINDOW's centre and can land on a
    /// sheet or a nested horizontal strip instead of the vertical list that
    /// actually owns the header we are chasing.
    private func scrollDown(_ app: XCUIApplication, times: Int) {
        let list = app.scrollViews.firstMatch
        guard list.exists else { return }
        let start = list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.75))
        let end = list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.1))
        for _ in 0..<times {
            start.press(forDuration: 0.02, thenDragTo: end)
            Thread.sleep(forTimeInterval: 0.3)
        }
    }

    /// Scrolls in small steps, photographing after each one, so whichever
    /// step actually parks a header at the top is on film — the exact
    /// scroll depth a header reaches the clock at is a property of how much
    /// content today's real payload has, not a constant this file can predict.
    private func scrollAndPhotographSteps(_ app: XCUIApplication, namePrefix: String, steps: Int) {
        for step in 1...steps {
            scrollDown(app, times: 1)
            shot(app, "\(namePrefix)-scroll-step-\(step)")
        }
    }

    // MARK: - 1 · Today

    func testTodayScrolledDoesNotCollideWithTheStatusBar() throws {
        let app = launchToToday()
        // Let the cold-launch fetches settle so the screenshots show real
        // content rather than skeleton bars.
        Thread.sleep(forTimeInterval: 2.0)
        shot(app, "today-00-rest")
        scrollAndPhotographSteps(app, namePrefix: "today", steps: 6)
    }

    // MARK: - 2 · Block

    func testBlockScrolledDoesNotCollideWithTheStatusBar() throws {
        let app = launchToToday()
        // `app.buttons["Block"]` is genuinely ambiguous — SwiftUI's own
        // accessibility bridging exposes the tab bar's "Block" button as TWO
        // identical `Button` nodes at the same frame (confirmed by dumping
        // `app.debugDescription`: both at {{108.0, 778.0}, {85.7, 62.0}}, the
        // tab row's real on-screen position). `element(boundBy: 0)` picks
        // one deterministically rather than letting an ambiguous-match error
        // or an unscoped `firstMatch` silently resolve to a DIFFERENT
        // same-labelled element elsewhere on Today (there is also a
        // "Block phases…" summary and a plain "Block" static text on Today's
        // own content, both at unrelated frames).
        // Let the cold-launch fetches settle before touching anything — the
        // splash gate can still be mid-transition for a beat after "Today"
        // first appears in the accessibility tree.
        Thread.sleep(forTimeInterval: 2.0)
        let block = app.buttons.matching(NSPredicate(format: "label == 'Block'")).element(boundBy: 0)
        XCTAssertTrue(block.waitForExistence(timeout: 30), "no Block tab")

        // Confirm the tab actually switched before trusting anything below.
        // Neither `.exists` nor `.isHittable` are reliable signals here —
        // ShellV5 keeps every tab's content permanently MOUNTED
        // (opacity-toggled, never removed) so the launch gate can hold until
        // all three report painted, and in practice BOTH mere existence and
        // `isHittable` came back true for Block's own content even while a
        // screenshot proved Today was what actually painted. `TabBarV5`
        // stamps `.accessibilityAddTraits(selected == tab ? [.isSelected]
        // : [])` on the button itself, which is a direct read of the
        // `selected` binding this whole mechanism turns on — poll THAT.
        var isBlockSelected = false
        for _ in 0..<20 {
            if block.isSelected { isBlockSelected = true; break }
            if block.exists && block.isHittable { block.tap() }
            Thread.sleep(forTimeInterval: 0.5)
        }
        if !isBlockSelected {
            let a = XCTAttachment(string: app.debugDescription)
            a.name = "hierarchy-after-block-tap-failed"
            a.lifetime = .keepAlways
            add(a)
        }
        XCTAssertTrue(isBlockSelected, "Block tab never became selected — still looks like Today")
        shot(app, "block-00-rest")
        scrollAndPhotographSteps(app, namePrefix: "block", steps: 6)
    }

    // MARK: - 3 · Settings

    /// Today's account disc → the account sheet's "Settings" row → the
    /// pushed Settings screen. The real door a runner uses, not a direct
    /// route push.
    func testSettingsScrolledDoesNotCollideWithTheStatusBar() throws {
        let app = launchToToday()
        let account = app.buttons["Account and settings"]
        XCTAssertTrue(account.waitForExistence(timeout: 30), "no account button on Today")
        Thread.sleep(forTimeInterval: 1.0)
        account.tap()

        let settingsRow = app.buttons.containing(
            NSPredicate(format: "label CONTAINS 'Settings'")).firstMatch
        var found = settingsRow.waitForExistence(timeout: 10)
        if !found {
            // The sheet's own open animation can still be mid-flight — retap
            // once rather than fail on a timing flake unrelated to this fix.
            account.tap()
            found = settingsRow.waitForExistence(timeout: 10)
        }
        if !found {
            let a = XCTAttachment(string: app.debugDescription)
            a.name = "hierarchy-no-settings-row"
            a.lifetime = .keepAlways
            add(a)
            XCTFail("no Settings row in the account sheet")
        }
        settingsRow.tap()

        // The AppBar's own title, so we know the pushed screen actually
        // arrived before scrolling it.
        let title = app.staticTexts.containing(
            NSPredicate(format: "label ==[c] 'Settings'")).firstMatch
        XCTAssertTrue(title.waitForExistence(timeout: 15), "Settings screen never arrived")
        shot(app, "settings-00-rest")
        scrollAndPhotographSteps(app, namePrefix: "settings", steps: 6)
    }
}
