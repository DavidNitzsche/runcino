//
//  SettingsFailureStateTests.swift
//
//  SETTINGSCANCEL-1 / SETTINGSPARTIAL-1 / SETTINGSDIAG-1 (2026-09-07 review)
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHAT WENT WRONG
//
//  An adversarial review of SETTINGSFAIL-1 with real fault injection (a proxy
//  that drops, hangs, or returns a chosen status) passed all four original
//  acceptance criteria and returned three conditions:
//
//   1 · CANCELLATION RACE. Baseline a `serverError(503)`, tap Retry twice
//       ~250ms apart against a backend that answers in ~6s — healthy, and
//       well inside every timeout. The copy transiently flipped to "faff is
//       taking too long to respond." A false statement to the runner.
//       Two causes, both closed here: `load()` wrote `.timeout` whenever
//       `withDeadline` returned nil, and cancelling the parent makes it
//       return nil for a reason that has nothing to do with a deadline; and
//       `categorize` had no `URLError.cancelled` branch, so a cancelled
//       request was reported as `.offline` — a second wrong fact.
//
//   2 · PARTIAL OUTAGE. The failure gate was `settings == nil AND profile ==
//       nil`. With ONE endpoint down, the screen rendered normally with the
//       failed endpoint's fields silently defaulted (`?? "sun"`, `?? "mi"`,
//       `?? true`) or blank (Email), in the same ink as a real value. A
//       runner on kilometres was shown "Miles".
//
//   3 · DIAGNOSTICS DOOR. The hidden seven-tap footer existed only in the
//       loaded view, so the failure state could not reach it.
//
//  A THIRD review of that fix (2026-09-07) confirmed all three closed and
//  returned one more real defect, covered here as SETTINGSWRITE-1:
//
//   4 · A WRITE THAT STRADDLES AN OUTAGE THREW THE LAST KNOWN GOOD AWAY.
//       Healthy load, real values on screen ("Distance · Kilometres").
//       `/api/settings` goes down. The runner toggles a switch; the PATCH
//       503s and the throw is swallowed by `try?`; `SettingsCache
//       .invalidate()` wipes the good copy anyway; the reload's GET 503s
//       too — and the row the runner was reading ONE SECOND EARLIER flips to
//       "Unavailable", as does the switch they just touched. The host's own
//       full-failure path refuses to blank a screen that already has content
//       ("old content is not wrong, it is old"); the partial path did not.
//
//  ─────────────────────────────────────────────────────────────────────────
//  RULE 22 · WHAT THIS GATE CANNOT FAIL ON
//
//  · It cannot fail on the RENDERING. These tests drive the pure decision
//    functions (`categorize`, `classify`, `application(for:isCancelled:)`)
//    and the health type's own copy. Whether `SettingsV5` actually draws
//    `UnavailableRow` for a marked source, and whether the failure state
//    actually hosts `SettingsDiagnosticsFooter`, is a claim about a view
//    hierarchy that only a screenshot against a real outage settles. Both
//    were verified that way on device against the owner's own production
//    rows; nothing here would notice if a later edit dropped either.
//
//  · It cannot fail on the REAL RACE. `application(for:isCancelled:)` takes
//    cancellation as a parameter, which is what makes the decision testable
//    at all — but it means these cases prove the decision, not that `load()`
//    passes it `Task.isCancelled` at the right moment. The two-rapid-Retry
//    repro against a delayed backend is the only measurement of that.
//
//  · It cannot fail on `SettingsCache`'s piggyback ordering. That fix
//    (applying the shared result in BOTH branches rather than trusting the
//    owning caller to have written first) is unobservable from outside the
//    actor without a controllable transport, and the cache reaches `API`
//    directly.
//
//  · It says NOTHING about whether a partial outage is likely. It asserts
//    only that when one arrives, no field states a default as a reading.
//
//  · SETTINGSWRITE-1's cases cannot fail on the WIRING. They drive
//    `applyWrite` — the real sequence both `patch` and `patchProfile` call —
//    with a stand-in cache, so they prove the ordering and prove that
//    `classify` still shows the kept value. They do NOT prove that those two
//    writers hand it the right `write` closure, which is a one-line reading
//    at each call site.
//
//  · Nothing here can fail on an `UnavailableRow` actually being drawn, for
//    the same reason as the partial cases above: that is a view hierarchy,
//    and `SettingsFailureUITests` is where it is measured.
//

import XCTest
@testable import Faff

final class SettingsFailureStateTests: XCTestCase {

    // MARK: - Fixtures, decoded from real wire shapes rather than hand-built

    private func settings(longRunDay: String, units: String) throws -> UserSettings {
        let json = """
        {"units_distance":"\(units)","long_run_day":"\(longRunDay)","phone_run_enabled":true}
        """
        return try JSONDecoder().decode(UserSettings.self, from: Data(json.utf8))
    }

    private func profile(email: String, weekly: Int) throws -> ProfileFields {
        let json = """
        {"email":"\(email)","weekly_frequency":\(weekly)}
        """
        return try JSONDecoder().decode(ProfileFields.self, from: Data(json.utf8))
    }

    private var prefs: NotificationPrefs { .defaults }

    // MARK: - 1 · categorize does not report a cancellation as an outage

    func testCancelledURLErrorIsNotReportedAsOffline() {
        let cancelled = URLError(.cancelled)
        XCTAssertEqual(SettingsLoadFailure.categorize(cancelled), .cancelled,
                       "A cancelled request is not a statement about the connection.")
        XCTAssertNotEqual(SettingsLoadFailure.categorize(cancelled), .offline)
        XCTAssertNotEqual(SettingsLoadFailure.categorize(cancelled), .timeout)
    }

    func testSwiftCancellationErrorIsCancelled() {
        XCTAssertEqual(SettingsLoadFailure.categorize(CancellationError()), .cancelled)
    }

    /// The neighbours must not move. `.timedOut` is the one code that means
    /// "faff is slow", and it is the sentence the race wrongly showed.
    func testRealTransportFailuresKeepTheirOwnCategories() {
        XCTAssertEqual(SettingsLoadFailure.categorize(URLError(.timedOut)), .timeout)
        XCTAssertEqual(SettingsLoadFailure.categorize(URLError(.notConnectedToInternet)), .offline)
        XCTAssertEqual(SettingsLoadFailure.categorize(URLError(.cannotConnectToHost)), .offline)
        XCTAssertEqual(SettingsLoadFailure.categorize(API.APIError.badStatus(503)), .serverError(503))
        XCTAssertEqual(SettingsLoadFailure.categorize(API.APIError.badStatus(401)), .unauthorized)
        XCTAssertEqual(SettingsLoadFailure.categorize(APIAuthError.unauthorized), .unauthorized)
    }

    /// Every category says something DIFFERENT. The whole point of the enum
    /// is that "Can't reach faff" is not printed over a 503.
    func testEveryCategoryHasItsOwnSentence() {
        let all: [SettingsLoadFailure] = [.offline, .timeout, .unauthorized,
                                          .serverError(503), .cancelled, .unknown]
        XCTAssertEqual(Set(all.map(\.message)).count, all.count)
        XCTAssertEqual(Set(all.map(\.shortCause)).count, all.count)
    }

    // MARK: - 1 · a cancelled load writes NOTHING

    func testCancelledLoadAppliesNothingEvenHoldingAnOutcome() throws {
        let outcome = SettingsHostV5.LoadOutcome.loaded(
            settings: try settings(longRunDay: "sat", units: "km"),
            profile: try profile(email: "d@faff.run", weekly: 6),
            prefs: prefs, stravaConnected: true, health: .healthy)
        XCTAssertEqual(SettingsHostV5.application(for: outcome, isCancelled: true), .ignore)
    }

    /// THE REPRODUCED DEFECT, as a decision. Cancelling the parent makes
    /// `withDeadline` hand back nil, and the old code read every nil as a
    /// deadline. A superseded Retry must not narrate a timeout.
    func testCancelledNilOutcomeIsNotATimeout() {
        XCTAssertEqual(SettingsHostV5.application(for: nil, isCancelled: true), .ignore)
        XCTAssertNotEqual(SettingsHostV5.application(for: nil, isCancelled: true), .fail(.timeout))
    }

    /// And the deadline still means what it says when nothing was cancelled.
    func testUncancelledNilOutcomeIsStillATimeout() {
        XCTAssertEqual(SettingsHostV5.application(for: nil, isCancelled: false), .fail(.timeout))
    }

    func testCancelledFailureIsNotShownToTheRunner() {
        let outcome = SettingsHostV5.LoadOutcome.failed(.serverError(503))
        XCTAssertEqual(SettingsHostV5.application(for: outcome, isCancelled: true), .ignore)
        XCTAssertEqual(SettingsHostV5.application(for: outcome, isCancelled: false), .fail(.serverError(503)))
    }

    // MARK: - 2 · partial outage · the three cases, not two

    func testBothSourcesHealthyIsAWholeScreen() throws {
        let outcome = SettingsHostV5.classify(
            settings: try settings(longRunDay: "sat", units: "km"), settingsError: nil,
            profile: try profile(email: "d@faff.run", weekly: 6), profileError: nil,
            prefs: prefs, prefsError: nil, stravaConnected: true)
        guard case .loaded(_, _, _, _, let health) = outcome else {
            return XCTFail("two healthy sources must load")
        }
        XCTAssertTrue(health.isWhole)
        XCTAssertNil(health.partialMessage)
    }

    func testBothSourcesDownIsTheFullFailureState() throws {
        let outcome = SettingsHostV5.classify(
            settings: nil, settingsError: API.APIError.badStatus(503),
            profile: nil, profileError: API.APIError.badStatus(503),
            prefs: nil, prefsError: API.APIError.badStatus(503), stravaConnected: nil)
        guard case .failed(let reason) = outcome else {
            return XCTFail("a total outage is still the full failure state")
        }
        XCTAssertEqual(reason, .serverError(503))
    }

    /// THE BUG. `/api/settings` down, `/api/profile` up. Before this fix the
    /// screen rendered confidently with "Sunday" and "Miles" fabricated.
    func testSettingsDownWithProfileUpIsPartialAndMarksTheSettingsRows() throws {
        let outcome = SettingsHostV5.classify(
            settings: nil, settingsError: API.APIError.badStatus(503),
            profile: try profile(email: "d@faff.run", weekly: 6), profileError: nil,
            prefs: prefs, prefsError: nil, stravaConnected: true)
        guard case .loaded(_, let loadedProfile, _, _, let health) = outcome else {
            return XCTFail("half a screen is still a screen")
        }
        XCTAssertEqual(health.settings, .serverError(503))
        XCTAssertNil(health.profile, "the half that answered is not marked")
        XCTAssertNil(health.prefs)
        XCTAssertFalse(health.isWhole)
        XCTAssertNotNil(health.partialMessage)
        XCTAssertEqual(loadedProfile?.email, "d@faff.run",
                       "the data that DID load is still shown")
    }

    /// The mirror case. `/api/profile` down: Email and Days per week are the
    /// rows that must not state a value.
    func testProfileDownWithSettingsUpIsPartialAndMarksTheProfileRows() throws {
        let outcome = SettingsHostV5.classify(
            settings: try settings(longRunDay: "sat", units: "km"), settingsError: nil,
            profile: nil, profileError: URLError(.notConnectedToInternet),
            prefs: prefs, prefsError: nil, stravaConnected: nil)
        guard case .loaded(let loadedSettings, _, _, _, let health) = outcome else {
            return XCTFail("half a screen is still a screen")
        }
        XCTAssertEqual(health.profile, .offline)
        XCTAssertNil(health.settings)
        XCTAssertFalse(health.isWhole)
        XCTAssertEqual(loadedSettings?.units_distance, "km")
    }

    func testNotificationPrefsDownIsItsOwnPartial() throws {
        let outcome = SettingsHostV5.classify(
            settings: try settings(longRunDay: "sat", units: "km"), settingsError: nil,
            profile: try profile(email: "d@faff.run", weekly: 6), profileError: nil,
            prefs: nil, prefsError: API.APIError.badStatus(500), stravaConnected: true)
        guard case .loaded(_, _, _, _, let health) = outcome else {
            return XCTFail("prefs alone never blanks the screen")
        }
        XCTAssertEqual(health.prefs, .serverError(500))
        XCTAssertNil(health.settings)
        XCTAssertNil(health.profile)
    }

    /// RULE 11, THE OTHER HALF. A runner who genuinely has no settings row is
    /// NOT an outage, and the server's own defaults are the right answer for
    /// them. Marking this as unavailable would be its own false statement.
    func testEmptyWithNoErrorIsNotAFailure() throws {
        let outcome = SettingsHostV5.classify(
            settings: nil, settingsError: nil,
            profile: try profile(email: "new@faff.run", weekly: 4), profileError: nil,
            prefs: nil, prefsError: nil, stravaConnected: nil)
        guard case .loaded(_, _, _, _, let health) = outcome else {
            return XCTFail("an empty read is a successful read")
        }
        XCTAssertTrue(health.isWhole)
        XCTAssertNil(health.partialMessage)
    }

    /// And a value we DID get is never marked, even if a stale error rides
    /// along beside it.
    func testAValuePresentIsNeverMarkedUnavailable() throws {
        let outcome = SettingsHostV5.classify(
            settings: try settings(longRunDay: "sat", units: "km"),
            settingsError: API.APIError.badStatus(503),
            profile: try profile(email: "d@faff.run", weekly: 6), profileError: nil,
            prefs: prefs, prefsError: nil, stravaConnected: true)
        guard case .loaded(_, _, _, _, let health) = outcome else {
            return XCTFail("we have the value")
        }
        XCTAssertNil(health.settings)
        XCTAssertTrue(health.isWhole)
    }

    // MARK: - 2 · the banner names the cause once

    func testPartialMessageCarriesTheRealCauseAndSaysSettingsOnce() {
        let health = SettingsSourceHealth(settings: .serverError(503), profile: nil, prefs: nil)
        let message = try? XCTUnwrap(health.partialMessage)
        let text = message ?? ""
        XCTAssertTrue(text.contains("503"), "the runner gets the real status, not a flat sentence")
        // Rule 17 · the affected rows say "Unavailable" themselves. The
        // banner must not enumerate them as well.
        XCTAssertFalse(text.contains("Unavailable"))
        XCTAssertFalse(text.contains("Long run day"))
        // Coach voice · no em dash, no exclamation.
        XCTAssertFalse(text.contains("\u{2014}"))
        XCTAssertFalse(text.contains("!"))
    }

    func testPartialMessageIsNilWhenNothingFailed() {
        XCTAssertNil(SettingsSourceHealth.healthy.partialMessage)
        XCTAssertTrue(SettingsSourceHealth.healthy.isWhole)
    }

    // MARK: - 4 · SETTINGSWRITE-1 · a failed write keeps the last known good

    /// Stands in for `SettingsCache` so the sequence can be walked without a
    /// live outage. Only the two operations `applyWrite` performs.
    private actor CacheStandIn {
        private(set) var settings: UserSettings?
        private(set) var invalidateCalls = 0
        init(settings: UserSettings?) { self.settings = settings }
        func invalidate() { settings = nil; invalidateCalls += 1 }
    }

    /// THE REVIEWER'S EXACT SEQUENCE, as the runner lived it.
    ///
    /// 1 · a healthy load has the real value on screen ("Kilometres")
    /// 2 · `/api/settings` starts answering 503
    /// 3 · the runner toggles a switch; the PATCH 503s too, silently
    /// 4 · the reload's GET 503s as well
    ///
    /// Before the fix step 3 wiped the cache, so step 4 had nothing left and
    /// the row flipped to "Unavailable". The value was never wrong. It was
    /// thrown away by a write that changed nothing.
    func testAFailedWriteDuringAnOutageKeepsTheValueTheRunnerWasJustReading() async throws {
        let good = try settings(longRunDay: "sat", units: "km")
        let cache = CacheStandIn(settings: good)

        // Step 3. The PATCH did not land.
        await SettingsHostV5.applyWrite(write: { false },
                                        invalidate: { await cache.invalidate() })
        let kept = await cache.settings
        let calls = await cache.invalidateCalls
        XCTAssertEqual(calls, 0,
                       "a write that changed nothing on the server invalidated the copy of it")
        XCTAssertNotNil(kept, "the last known good was discarded by a failed write")

        // Step 4. The reload's GET fails too, and this is the whole point:
        // with the copy kept, the reload is not left with nothing.
        let outcome = SettingsHostV5.classify(
            settings: kept, settingsError: API.APIError.badStatus(503),
            profile: try profile(email: "d@faff.run", weekly: 6), profileError: nil,
            prefs: prefs, prefsError: nil, stravaConnected: true)
        guard case .loaded(let shown, _, _, _, let health) = outcome else {
            return XCTFail("an outage over a value we still hold is not a blank screen")
        }
        XCTAssertNil(health.settings,
                     "the row the runner was reading one second earlier now says Unavailable")
        XCTAssertTrue(health.isWhole)
        XCTAssertEqual(shown?.units_distance, "km",
                       "the runner's real units were replaced by nothing at all")
        XCTAssertEqual(shown?.long_run_day, "sat")
    }

    /// The other direction, so the fix cannot be "never invalidate". A write
    /// that DID land makes the copy stale by definition, and keeping it would
    /// show the runner the value they just changed away from.
    func testAWriteThatLandedStillInvalidates() async throws {
        let cache = CacheStandIn(settings: try settings(longRunDay: "sat", units: "km"))
        await SettingsHostV5.applyWrite(write: { true },
                                        invalidate: { await cache.invalidate() })
        let calls = await cache.invalidateCalls
        XCTAssertEqual(calls, 1, "a landed write left a stale copy in place")
        let after = await cache.settings
        XCTAssertNil(after)
    }

    // MARK: - 4 · SETTINGSEQ-1 · the equality compares the payload

    /// The conformance used to return true for ANY two `.apply` values, so an
    /// `XCTAssertEqual(application(...), .apply(expected))` passed with the
    /// wrong model inside. Rule 18: an assertion that cannot tell its subject
    /// apart is not an assertion.
    func testTwoApplicationsCarryingDifferentModelsAreNotEqual() throws {
        let km = SettingsHostV5.LoadOutcome.loaded(
            settings: try settings(longRunDay: "sat", units: "km"),
            profile: try profile(email: "d@faff.run", weekly: 6),
            prefs: prefs, stravaConnected: true, health: .healthy)
        let mi = SettingsHostV5.LoadOutcome.loaded(
            settings: try settings(longRunDay: "sun", units: "mi"),
            profile: try profile(email: "d@faff.run", weekly: 6),
            prefs: prefs, stravaConnected: true, health: .healthy)
        XCTAssertNotEqual(SettingsHostV5.LoadApplication.apply(km),
                          SettingsHostV5.LoadApplication.apply(mi))
        XCTAssertEqual(SettingsHostV5.LoadApplication.apply(km),
                       SettingsHostV5.LoadApplication.apply(km))
        // And the health travelling with an otherwise-identical model is part
        // of the comparison too. That is the field a partial outage moves.
        let kmPartial = SettingsHostV5.LoadOutcome.loaded(
            settings: try settings(longRunDay: "sat", units: "km"),
            profile: try profile(email: "d@faff.run", weekly: 6),
            prefs: prefs, stravaConnected: true,
            health: SettingsSourceHealth(settings: nil, profile: .serverError(503), prefs: nil))
        XCTAssertNotEqual(SettingsHostV5.LoadApplication.apply(km),
                          SettingsHostV5.LoadApplication.apply(kmPartial))
    }
}
