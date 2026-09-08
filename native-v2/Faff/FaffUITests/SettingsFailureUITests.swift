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
//
//        then SET `user_settings` NON-DEFAULT BY HAND — the script does not
//        do this and will not:
//          UPDATE profile SET user_settings = user_settings
//            || '{"long_run_day":"sat","units_distance":"km"}'::jsonb;
//        Production's own `profile.user_settings` is `{}`,
//        which means the owner's EFFECTIVE values are the server defaults —
//        Sunday and Miles — and those are exactly the values the fabrication
//        bug printed. A fallback that happens to match the runner's default
//        is invisible: the screen looks identical whether it read the value
//        or invented it, and the test would pass against the unfixed code.
//        Choosing values the defaults cannot produce is what makes
//        "Unavailable" legible as the absence of a real value. So the
//        Saturday/Kilometres below are a chosen test fixture, never a claim
//        about what the owner's account holds.
//    2 · `next dev` on 3129 with DATABASE_URL pointed at it
//    3 · a fault-injecting proxy on 3130 in front of it, controlled by
//        GET /__fault?rules=[{"match":"/api/settings","mode":"status","status":503}]
//        modes: pass | status | delay(ms) | hang | drop
//        SETTINGSREVERT-1 (2026-09-08) added one OPTIONAL field to a rule,
//        `"method":"PATCH"`. Without it a rule matches a path whatever the
//        verb, and the fourth review's defect is a failed WRITE with healthy
//        READS on the same path, which such a rule cannot express. Rules that
//        omit `method` behave exactly as before.
//
//  Then — NOTE THE `TEST_RUNNER_` PREFIX, it is load-bearing:
//    TEST_RUNNER_FAFF_UI_HOST=http://127.0.0.1:3130 \
//    TEST_RUNNER_FAFF_UI_TOKEN=<bearer> \
//    xcodebuild test -project native-v2/Faff.xcodeproj -scheme Faff \
//      -destination 'platform=iOS Simulator,name=<your own sim>' \
//      -only-testing:FaffUITests
//
//  WHY THE PREFIX, AND WHAT IT COST (2026-09-07 review). This header used to
//  document the bare `FAFF_UI_HOST=... xcodebuild test`. `xcodebuild` does
//  not forward its own environment into the test process running inside the
//  simulator; only variables named `TEST_RUNNER_<NAME>` are passed through,
//  with the prefix stripped. So `ProcessInfo` below read "" either way, the
//  `XCTSkipUnless` in `setUpWithError` fired, and the documented command
//  reported "Executed 1 test, with 1 test skipped", exit 0, TEST EXECUTE
//  SUCCEEDED. A green line that had run nothing at all — Rule 18's worst
//  outcome, because it also reports confidence. If a run of this file
//  reports a SKIP, the credentials did not arrive; that is a failure to run
//  it, not a pass.
//
//  BOTH DIRECTIONS MEASURED, 2026-09-07, before the correction was trusted:
//    · unprefixed `FAFF_UI_HOST=... FAFF_UI_TOKEN=...`
//        → "Test skipped - Set FAFF_UI_HOST and FAFF_UI_TOKEN", exit 0,
//          "Executed 1 test, with 1 test skipped", ** TEST SUCCEEDED **
//    · `TEST_RUNNER_FAFF_UI_HOST=http://example.invalid:3130`
//        → no skip; the loopback guard failed with the value echoed back:
//          "REFUSING: http://example.invalid:3130 is not loopback", which is
//          the variable's own contents arriving inside the simulator
//    · `TEST_RUNNER_FAFF_UI_HOST=http://127.0.0.1:3130`, no backend standing
//        → no skip; ran 38.8s into the test BODY and failed on the seeded
//          value, which is the correct answer with nothing serving it
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
//  · SETTINGSREVERT-1's case cannot fail on a FLICKER on the happy path. Its
//    landed-write half breaks on the first correct reading, so a mis-fix that
//    restated the old value on EVERY write (correcting it a moment later off
//    the reload) would pass here. `SettingsWriteRevertTests
//    .testALandedWriteInvalidatesAndRestatesNothing` is what fails on that,
//    and it was falsified in that direction on 2026-09-08.
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
                      "the settled screen does not carry the substrate's seeded value")
        clearFaults()
    }

    // MARK: - 2 · the baseline the partial cases are measured against

    /// Nothing faulted. This is the control: it records what the substrate's
    /// SEEDED settings look like when every source answers, so "Unavailable"
    /// in the two cases below reads as the absence of a value that genuinely
    /// exists, rather than as the absence of one that was never there.
    ///
    /// The values are Saturday and Kilometres, and they are deliberately NOT
    /// the server's defaults — see this file's header. Production's real
    /// `profile.user_settings` is `{}`, so the owner's effective values are
    /// Sunday and Miles, which are the same strings the fabrication bug
    /// printed; against those the defect is invisible and this whole file
    /// would pass on the unfixed code.
    func testHealthyLoadShowsTheSeededNonDefaultValuesAndNoBanner() throws {
        clearFaults()
        let app = launchIntoSettings()
        XCTAssertTrue(app.buttons["Long run day, Saturday"].waitForExistence(timeout: 25),
                      "the seeded long run day is not on screen")
        XCTAssertTrue(app.buttons["Distance, Kilometres"].exists,
                      "the seeded units are not on screen")
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
        // baseline above proves this substrate holds, plus the server
        // defaults the old code would have printed in their place — which
        // are ALSO the owner's real effective values in production, since
        // his `user_settings` is `{}`. That coincidence is the reason the
        // substrate is seeded off-default: on his own row the fabricated
        // "Sunday"/"Miles" and the truth are the same two words.
        for fabricated in ["Long run day, Saturday", "Long run day, Sunday",
                           "Distance, Kilometres", "Distance, Miles"] {
            XCTAssertFalse(app.buttons[fabricated].exists,
                           "\(fabricated) was stated while its source was down")
        }

        // The half that answered is still here, with its value. Email comes
        // from `/api/profile` and IS the owner's real address, carried over
        // by the substrate script rather than chosen.
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

    // MARK: - 5 · SETTINGSREVERT-1 · the write fails, the reads do not

    /// THE FOURTH REVIEWER'S EXACT REPRO, AND THE ONLY PLACE IT CAN BE
    /// MEASURED.
    ///
    /// Fault ONLY `PATCH /api/settings`. Every GET stays healthy, which is
    /// what separates this from every case above and what let the defect
    /// live: with the reads up, `applyWrite` correctly keeps the cached copy
    /// (SETTINGSWRITE-1), so the reload rebuilds an IDENTICAL model, and
    /// `SettingsV5`'s correction rides on `.onChange(of: model)`, which is
    /// equality-gated. It never fired. The switch stayed where the runner put
    /// it, over a server that had refused the change.
    ///
    /// The assertion is the SWITCH'S OWN VALUE, read back off the screen, and
    /// it is taken WITHOUT leaving Settings and returning — a revisit
    /// self-corrects even on the unfixed build (the view is rebuilt and
    /// `State(initialValue:)` runs again), so a test that navigates away
    /// before looking would pass against the defect.
    ///
    /// The `method` field in the rule below is why this file's proxy contract
    /// grew one: a rule that matches a path regardless of method cannot
    /// express "the write fails and the reads do not".
    ///
    /// FALSIFIED TWICE, 2026-09-08, against the build without the fix — once
    /// from each starting state, which is also what proves the baseline
    /// handling below is real and not decorative:
    ///
    ///   · baseline "1": the switch read "0" on all 89 samples of the 30s
    ///     window while the row still held `phone_run_enabled: true`
    ///   · baseline "0": the switch read "1" for the whole window while the
    ///     row still held false
    ///
    /// Both runs' proxy logs showed the PATCH 503'd and every GET passed, so
    /// the reads were healthy throughout. The screenshot from the first also
    /// caught the contradiction the reviewer described: switch off, subtitle
    /// "Your watch starts every session", and the orange RUN pill still in
    /// the tab bar underneath, because `PhoneRunGate` reads the TRUE value.
    ///
    /// It leaves the substrate as it found it, and does not care which way
    /// the seed points — see the baseline comment below.
    func testAFailedWriteWithHealthyReadsDoesNotLeaveTheSwitchWhereTheRunnerPutIt() throws {
        clearFaults()
        let app = launchIntoSettings()

        // WHATEVER THE SUBSTRATE HOLDS, READ OFF THE SCREEN. An earlier
        // version of this case asserted `phone_run_enabled: true` because
        // that is how the substrate script seeds it — and then wrote to that
        // same value in its own landed-write half below, so a run whose
        // restore did not land left the NEXT run failing on its baseline.
        // A repro that only works from one starting state is a repro that
        // reports on the previous run.
        let toggle = app.switches["Start runs from this phone"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 25), "no phone-run switch")
        let baseline = (toggle.value as? String) ?? "?"
        XCTAssertTrue(baseline == "0" || baseline == "1",
                      "the phone-run switch has no readable value: \(baseline)")
        let flipped = baseline == "1" ? "0" : "1"
        let onSub = "RUN sits in the bottom bar"
        let offSub = "Your watch starts every session"
        let baselineSub = baseline == "1" ? onSub : offSub
        let flippedSub = baseline == "1" ? offSub : onSub
        print("[baseline] phone-run switch = \(baseline)")
        shot(app, "05-before-toggle")

        // Only the WRITE fails. Reads stay completely healthy.
        XCTAssertTrue(setFaults([[
            "match": "/api/settings", "method": "PATCH",
            "mode": "status", "status": 503,
        ]]), "fault proxy did not accept rules")

        toggle.tap()

        // Sample rather than assert on one frame, and record what the switch
        // held at each sample so the evidence is readable (Rule 13).
        let refused = sample(toggle, until: baseline, seconds: 30, settleSamples: 3)
        print("[toggle across the REFUSED write] \(refused.samples.joined(separator: ","))")
        shot(app, "06-after-failed-write")
        print("[after] \(visibleText(app))")

        XCTAssertTrue(refused.settled,
                      "the switch still shows a change the server refused; last read \(refused.samples.last ?? "?")")
        // The subtitle is drawn FROM the same optimistic value. Rule 16: a
        // sentence about a value follows that value.
        XCTAssertTrue(app.staticTexts.containing(
            NSPredicate(format: "label CONTAINS %@", baselineSub)).firstMatch.exists,
                      "the subtitle still describes the state the server refused")
        // AND THE SERVER ITSELF, not only the screen's account of it. This is
        // the half a screenshot cannot settle: "the screen went back" and
        // "the write never landed" are two facts, and the defect is only a
        // defect because the second one is true.
        XCTAssertEqual(serverPhoneRun(), baseline,
                       "the faulted PATCH reached the row after all, so this case proves nothing")

        // ── AND THE SWITCH STILL WORKS ───────────────────────────────────
        //
        // Rule 22, applied to this case's own bias: every assertion above
        // asks "did the screen correctly refuse to keep a change?", and a
        // screen that could not change AT ALL would satisfy every one of
        // them. So the next thing measured is a write that LANDS — measured
        // at the SERVER, because the screen shows an optimistic value the
        // instant the switch is touched and would read "changed" either way.
        clearFaults()
        toggle.tap()
        let landed = sample(toggle, until: flipped, seconds: 30, settleSamples: 6)
        print("[toggle across the LANDED write] \(landed.samples.joined(separator: ","))")
        shot(app, "07-after-landed-write")
        XCTAssertTrue(landed.settled,
                      "a healthy write no longer changes anything; last read \(landed.samples.last ?? "?")")
        XCTAssertTrue(app.staticTexts.containing(
            NSPredicate(format: "label CONTAINS %@", flippedSub)).firstMatch.exists,
                      "the subtitle did not follow a write that landed")
        XCTAssertTrue(waitForServerPhoneRun(flipped, seconds: 20),
                      "a healthy write did not reach the row; it holds \(serverPhoneRun())")

        // Put the substrate back where this case found it, and confirm it AT
        // THE SERVER rather than tapping and walking away.
        //
        // Why this needs a retry loop, and it is not the fix under test: the
        // switch's write is gated on `newValue != model.phoneRunEnabled`, and
        // `model` only moves when the reload lands. A tap that arrives before
        // then compares against the PREVIOUS server value, matches it, and is
        // dropped — the screen moves optimistically and no PATCH is sent.
        // Reported as a separate, pre-existing finding (a rapid double-tap
        // loses the second tap); this case works around it rather than
        // masking it, and would fail loudly if the workaround stopped working.
        var attempts = 0
        while serverPhoneRun() != baseline && attempts < 4 {
            attempts += 1
            toggle.tap()
            _ = waitForServerPhoneRun(baseline, seconds: 15)
        }
        XCTAssertEqual(serverPhoneRun(), baseline,
                       "this case did not put the substrate back after \(attempts) attempts")
    }

    // MARK: - Reading the server directly

    /// `phone_run_enabled` as the ROW holds it, rendered in the switch's own
    /// "0"/"1" vocabulary so the two can be compared without a translation
    /// step in each assertion. Returns "?" if the read itself fails, which is
    /// a third fact and never silently one of the other two (Rule 11).
    private func serverPhoneRun() -> String {
        guard let url = URL(string: "\(host)/api/settings") else { return "?" }
        var req = URLRequest(url: url)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let sem = DispatchSemaphore(value: 0)
        var out = "?"
        URLSession.shared.dataTask(with: req) { data, resp, _ in
            defer { sem.signal() }
            guard (resp as? HTTPURLResponse)?.statusCode == 200, let data,
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else { return }
            // Absent means the runner has no stored value, and the server's
            // own default for this field is true.
            let v = obj["phone_run_enabled"] as? Bool ?? true
            out = v ? "1" : "0"
        }.resume()
        _ = sem.wait(timeout: .now() + 10)
        return out
    }

    private func waitForServerPhoneRun(_ want: String, seconds: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(seconds)
        while Date() < deadline {
            if serverPhoneRun() == want { return true }
            Thread.sleep(forTimeInterval: 0.5)
        }
        return false
    }

    /// Poll `element.value` until it reads `want` for `settleSamples`
    /// consecutive reads, or the window elapses. Returns every reading, so a
    /// failure prints the whole sequence rather than one frame of it.
    private func sample(_ element: XCUIElement, until want: String,
                        seconds: TimeInterval, settleSamples: Int)
        -> (settled: Bool, samples: [String]) {
        var samples: [String] = []
        var run = 0
        let deadline = Date().addingTimeInterval(seconds)
        while Date() < deadline {
            let v = (element.value as? String) ?? "?"
            samples.append(v)
            run = (v == want) ? run + 1 : 0
            if run >= settleSamples { return (true, samples) }
            Thread.sleep(forTimeInterval: 0.25)
        }
        return (false, samples)
    }
}
