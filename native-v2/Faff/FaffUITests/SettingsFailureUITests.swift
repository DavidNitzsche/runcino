//
//  SettingsFailureUITests.swift
//
//  SETTINGSCANCEL-1 / SETTINGSPARTIAL-1 / SETTINGSDIAG-1 (2026-09-07 review)
//
//  The tapping half of the proof. `SettingsFailureStateTests` (unit) walks the
//  pure decisions; nothing there can press Retry twice, and the defect the
//  reviewer found is a race between two presses.
//
//  ─────────────────────────────────────────────────────────────────────────
//  HOW TO RUN IT (it is SKIPPED unless you do)
//
//  It needs three things standing, none of which belong in CI:
//
//    1 · a scratch database built from the owner's real production rows
//        FAFF_HARNESS_DB=faff_followup_settings \
//          bash web-v2/scripts/adapt-harness-substrate.sh
//    2 · `next dev` on 3129 with DATABASE_URL pointed at it
//    3 · a fault-injecting proxy on 3130 in front of it, controlled by
//        GET /__fault?rules=[{"match":"/api/settings","mode":"status","status":503}]
//        modes: pass | status | delay(ms) | hang | drop
//
//  Then:
//    FAFF_UI_HOST=http://127.0.0.1:3130 FAFF_UI_TOKEN=<bearer> \
//    xcodebuild test -project native-v2/Faff.xcodeproj -scheme Faff \
//      -destination 'platform=iOS Simulator,name=<your own sim>' \
//      -only-testing:FaffUITests
//
//  ─────────────────────────────────────────────────────────────────────────
//  RULE 22 · WHAT THIS GATE CANNOT FAIL ON
//
//  · It cannot fail in CI, because it skips there. That is the price of
//    driving a real backend, and it is stated rather than hidden: this file
//    is a REPRO, and the standing gate is the unit test.
//  · It cannot fail on production behaviour. It refuses to run against any
//    host that is not loopback (see `hostIsLocal`), so it can never point the
//    app at faff.run and can never write a production row.
//  · Its cancellation case SAMPLES the screen, and each sample is an
//    accessibility snapshot of the whole app, which measures at roughly
//    7 seconds. That is far too coarse to catch the defect at its natural
//    width, so the case deliberately widens the consequence instead of
//    speeding up the sampler: see the two different delays in the test. Run
//    against the unfixed code the wrong sentence is on screen for about
//    eight seconds and every sampler catches it (it was falsified exactly
//    that way, 2026-09-07 — render 2 read "faff is taking too long to
//    respond"). It is still a sampler: a state narrower than one snapshot
//    would be missed.
//

import XCTest

final class SettingsFailureUITests: XCTestCase {

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
                          "Set FAFF_UI_HOST and FAFF_UI_TOKEN. See this file's header.")
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

    private func clearFaults() { setFaults([]) }

    // MARK: - Launching into Settings

    /// Today app bar → the account disc → the account sheet's "Settings" row.
    /// Two taps, because that is the real door; a deep link would skip the
    /// navigation the screen is actually reached through.
    private func launchIntoSettings() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-faffHost", host, "-faffToken", token]
        app.launch()

        let today = app.staticTexts.containing(
            NSPredicate(format: "label ==[c] 'Today'")).firstMatch
        if !today.waitForExistence(timeout: 40) {
            print("[hierarchy] \(app.debugDescription)")
            XCTFail("never reached Today")
        }
        // The disc renders the runner's initials. Try it as a button first
        // (SwiftUI usually promotes it), then as the bare label.
        let disc = app.buttons["Account and settings"]
        XCTAssertTrue(disc.waitForExistence(timeout: 10), "no account disc")

        // The sheet is a SwiftUI overlay with an animation, and a tap that
        // lands while Today is still settling is swallowed. Retry rather
        // than flake: this helper is scaffolding, not the thing under test.
        let settingsRow = app.buttons.matching(
            NSPredicate(format: "label BEGINSWITH 'Settings'")).firstMatch
        var opened = false
        for _ in 0..<4 {
            disc.tap()
            if settingsRow.waitForExistence(timeout: 5) { opened = true; break }
            Thread.sleep(forTimeInterval: 1.0)
        }
        if !opened {
            print("[hierarchy · account sheet] \(app.debugDescription)")
            XCTFail("the account sheet has no Settings row")
        }
        settingsRow.tap()

        // The Settings screen's own app bar title. Wait generously: this is
        // deliberately run against a backend that has been told to be slow.
        let title = app.staticTexts.matching(
            NSPredicate(format: "label ==[c] 'Settings'")).firstMatch
        if !title.waitForExistence(timeout: 25) {
            print("[hierarchy · after settings tap] \(app.debugDescription)")
            XCTFail("never reached Settings")
        }
        return app
    }

    /// Every sentence currently on screen, as one blob. Used both to assert
    /// what IS shown and to record what was shown at each sample.
    private func visibleText(_ app: XCUIApplication) -> String {
        app.staticTexts.allElementsBoundByIndex
            .prefix(80)
            .map { $0.label }
            .joined(separator: " | ")
    }


    /// Attach the screen to the test result, so the evidence for a
    /// runner-facing change is a PICTURE and not only a label dump
    /// (CLAUDE.md Rule 13). Extract with:
    ///   xcrun xcresulttool export attachments --path <.xcresult> --output-path <dir>
    private func shot(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot())
        a.name = name
        a.lifetime = .keepAlways
        add(a)
    }

    // MARK: - 1 · the cancellation race

    /// THE REVIEWER'S EXACT REPRO.
    ///
    /// Baseline a `serverError(503)` failure, then make the backend HEALTHY
    /// BUT SLOW (~6s, well inside every timeout) and tap Retry twice about
    /// 250ms apart. The second tap cancels the first load. Before the fix the
    /// first load's completion wrote `.timeout` from a nil that meant
    /// "cancelled", and the copy flipped to "faff is taking too long to
    /// respond" — false, on a connection that was about to succeed.
    ///
    /// The assertion is on the INTERMEDIATE renders, not the final one: the
    /// screen is sampled continuously across the whole reload window and the
    /// timeout sentence must never appear in any sample.
    func testDoubleRetryAgainstASlowBackendNeverNarratesATimeout() throws {
        XCTAssertTrue(setFaults([
            ["match": "/api/settings", "mode": "status", "status": 503],
            ["match": "/api/profile", "mode": "status", "status": 503],
        ]), "fault proxy did not accept rules")

        let app = launchIntoSettings()

        let failureCopy = app.staticTexts.containing(
            NSPredicate(format: "label CONTAINS 'faff hit an error (503)'")).firstMatch
        XCTAssertTrue(failureCopy.waitForExistence(timeout: 25),
                      "baseline 503 failure state never appeared")
        shot(app, "01-total-outage-failure-state")

        // Healthy, and slow. Nothing here is a timeout.
        //
        // WHY THE TWO DELAYS DIFFER. Both Retries share `SettingsCache`'s
        // in-flight fetch, so left alone the superseded load and the live one
        // finish within a few hundred ms of each other and the wrong state is
        // only briefly on screen — the reviewer saw it, but XCUITest cannot
        // sample fast enough to be sure it did not blink past. Raising the
        // delay BETWEEN the two taps separates them: the first (cancelled)
        // load's requests were already issued at 2s and complete then, while
        // the second load's own `/api/profile/*` legs are issued after the
        // change and take 20s. Pre-fix, that puts the false "taking too long"
        // on screen for roughly eighteen seconds. It changes nothing about
        // the mechanism — only how long the consequence is visible.
        XCTAssertTrue(setFaults([
            ["match": "/api/settings", "mode": "delay", "ms": 2000],
            ["match": "/api/profile", "mode": "delay", "ms": 2000],
        ]))

        let retry = app.buttons["Retry"]
        XCTAssertTrue(retry.waitForExistence(timeout: 5))
        retry.tap()
        // 10s, not 20: `API.authedSend` bounds every request at 12s
        // (TIMEOUT-1), and a delay past that would make the timeout copy
        // HONEST, which would rob the assertion below of its meaning.
        XCTAssertTrue(setFaults([
            ["match": "/api/settings", "mode": "delay", "ms": 10000],
            ["match": "/api/profile", "mode": "delay", "ms": 10000],
        ]))
        if retry.exists { retry.tap() }

        var samples: [String] = []
        let started = Date()
        let deadline = Date().addingTimeInterval(45)
        var sawTimeoutSentence = false
        var sawOfflineSentence = false
        var sawCancelledSentence = false
        while Date() < deadline {
            let text = visibleText(app)
            samples.append(text)
            if text.contains("taking too long") { sawTimeoutSentence = true }
            if text.contains("Check your connection") { sawOfflineSentence = true }
            if text.contains("was cancelled") { sawCancelledSentence = true }
            // Settled: the failure copy is gone and a real row is up.
            if !text.contains("(503)") && text.contains("Days per week") { break }
            Thread.sleep(forTimeInterval: 0.04)
        }

        // Log every distinct render, so the evidence is readable rather than
        // just a pass/fail. Rule 13: assert the SHAPE of the result.
        var seen = Set<String>()
        for s in samples where seen.insert(s).inserted {
            print("[render] \(s.prefix(400))")
        }
        let elapsed = Date().timeIntervalSince(started)
        print(String(format: "[render count] %d samples, %d distinct, over %.1fs (one every %.2fs)",
                     samples.count, seen.count, elapsed,
                     elapsed / Double(max(samples.count, 1))))

        XCTAssertFalse(sawTimeoutSentence,
                       "the copy claimed a timeout while the connection was healthy")
        XCTAssertFalse(sawOfflineSentence,
                       "the copy claimed the connection was down while it was healthy")
        XCTAssertFalse(sawCancelledSentence,
                       "a cancellation reached the runner; it is an internal fact")
        XCTAssertFalse(samples.last?.contains("(503)") ?? true,
                       "the reload never settled into the loaded screen")
        XCTAssertTrue(app.buttons["Long run day, Saturday"].waitForExistence(timeout: 10),
                      "the settled screen does not carry the runner's real value")
        clearFaults()
    }

    // MARK: - 2 · the baseline the partial cases are measured against

    /// Nothing faulted. This is the control: it records what the runner's REAL
    /// settings look like on this substrate, so "Unavailable" in the two cases
    /// below can be read as the absence of a value that genuinely exists,
    /// rather than as the absence of one that was never there.
    func testHealthyLoadShowsTheRunnersRealValuesAndNoBanner() throws {
        clearFaults()
        let app = launchIntoSettings()
        XCTAssertTrue(app.buttons["Long run day, Saturday"].waitForExistence(timeout: 25),
                      "the runner's real long run day is not on screen")
        XCTAssertTrue(app.buttons["Distance, Kilometres"].exists,
                      "the runner's real units are not on screen")
        shot(app, "00-healthy-baseline")
        print("[healthy] \(visibleText(app))")
        let banner = app.staticTexts.containing(
            NSPredicate(format: "label CONTAINS 'did not load'")).firstMatch
        XCTAssertFalse(banner.exists, "a healthy load must say nothing at all")
    }

    // MARK: - 2 · partial outage

    /// `/api/settings` down, `/api/profile` up. Before the fix this rendered a
    /// completely normal Settings screen with "Sunday" and "Miles" fabricated.
    func testSettingsDownWithProfileUpShowsUnavailableAndNeverADefault() throws {
        XCTAssertTrue(setFaults([["match": "/api/settings", "mode": "status", "status": 503]]))
        let app = launchIntoSettings()

        let banner = app.staticTexts.containing(
            NSPredicate(format: "label CONTAINS 'Some of your settings did not load'")).firstMatch
        XCTAssertTrue(banner.waitForExistence(timeout: 25),
                      "a partial outage said nothing at all")

        shot(app, "02-partial-settings-down")
        print("[partial · settings down] \(visibleText(app))")

        // Every row whose source is `/api/settings` states nothing.
        for label in ["Long run day", "Distance", "Start runs from this phone"] {
            XCTAssertTrue(app.staticTexts["\(label), unavailable"].exists,
                          "\(label) did not render as unavailable")
        }
        // And nothing WRONG. These are the exact strings the healthy
        // baseline above proves are the runner's real values, plus the
        // fallback defaults the old code would have printed in their place.
        for fabricated in ["Long run day, Saturday", "Long run day, Sunday",
                           "Distance, Kilometres", "Distance, Miles"] {
            XCTAssertFalse(app.buttons[fabricated].exists,
                           "\(fabricated) was stated while its source was down")
        }

        // The half that answered is still here, with its REAL value.
        XCTAssertTrue(app.staticTexts["dnitch85@me.com"].exists,
                      "the data that DID load must still be shown")
        clearFaults()
    }

    /// The mirror. `/api/profile` down: Email and Days per week are the rows
    /// that must not state a value, and Email must not render blank.
    func testProfileDownWithSettingsUpMarksTheProfileRows() throws {
        XCTAssertTrue(setFaults([["match": "/api/profile", "mode": "status", "status": 503]]))
        let app = launchIntoSettings()

        let banner = app.staticTexts.containing(
            NSPredicate(format: "label CONTAINS 'Some of your settings did not load'")).firstMatch
        XCTAssertTrue(banner.waitForExistence(timeout: 25))

        shot(app, "03-partial-profile-down")
        print("[partial · profile down] \(visibleText(app))")
        // Email must not render as an empty value, which reads as "faff has
        // no email for you" rather than "we could not read it".
        XCTAssertTrue(app.staticTexts["Email, unavailable"].exists,
                      "Email did not render as unavailable")
        XCTAssertFalse(app.staticTexts["dnitch85@me.com"].exists)
        // And the settings half is still real, not marked.
        XCTAssertFalse(app.staticTexts["Long run day, unavailable"].exists,
                       "the half that loaded must not be marked")
        clearFaults()
    }

    // MARK: - 3 · the diagnostics door on the failure state

    func testFailureStateCanStillReachRequestDiagnostics() throws {
        XCTAssertTrue(setFaults([
            ["match": "/api/settings", "mode": "status", "status": 503],
            ["match": "/api/profile", "mode": "status", "status": 503],
        ]))
        let app = launchIntoSettings()

        let failureCopy = app.staticTexts.containing(
            NSPredicate(format: "label CONTAINS 'faff hit an error (503)'")).firstMatch
        XCTAssertTrue(failureCopy.waitForExistence(timeout: 25))

        let footer = app.staticTexts.containing(
            NSPredicate(format: "label BEGINSWITH 'faff.run '")).firstMatch
        XCTAssertTrue(footer.waitForExistence(timeout: 5),
                      "the failure state has no version footer, so no door to diagnostics")

        for _ in 0..<7 { footer.tap() }
        let diagnostics = app.staticTexts.containing(
            NSPredicate(format: "label CONTAINS[c] 'request'")).firstMatch
        XCTAssertTrue(diagnostics.waitForExistence(timeout: 10),
                      "seven taps on the failure state's footer did not open diagnostics")
        shot(app, "04-diagnostics-from-failure-state")
        print("[diagnostics from failure state] \(visibleText(app).prefix(400))")
        clearFaults()
    }
}
