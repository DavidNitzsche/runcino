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
//  A FOURTH review (2026-09-08) confirmed that one closed and returned the
//  defect its fix had opened, covered here as SETTINGSREVERT-1 by
//  `SettingsWriteRevertTests` at the bottom of this file:
//
//   5 · A FAILED WRITE WITH HEALTHY READS WAS COMPLETELY SILENT. Fault ONLY
//       `PATCH /api/settings`. Toggle a switch: it animates, its subtitle
//       follows, no banner, no Retry, and the server never took it. Keeping
//       the cached copy (item 4, correct) means the reload rebuilds an
//       IDENTICAL model, and the screen's correction rides on
//       `.onChange(of: model)`, which is equality-gated — so it never fired.
//       Every case in item 4 above failed the READ as well as the write,
//       which moves `health` and therefore moves the model. That is exactly
//       why they all passed while this was open.
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

// MARK: - 5 · SETTINGSREVERT-1 · a write that did not land does not stand

/// SETTINGSREVERT-1 (2026-09-08 review) · A FAILED WRITE WAS COMPLETELY
/// SILENT, AND THE SCREEN SHOWED A VALUE THAT WAS NEVER SAVED.
///
/// ─────────────────────────────────────────────────────────────────────────
/// WHAT WENT WRONG
///
/// A fourth review, on a healthy connection with ONLY `PATCH /api/settings`
/// faulted, toggled "Start runs from this phone". The switch animated, its
/// subtitle changed to match, and nothing else happened: no banner, no
/// Retry, and the server still held the old value. The app's own tab bar,
/// driven by the same setting through `PhoneRunGate`, still showed the TRUE
/// state, so the screen contradicted another part of the app in the same
/// frame. Leaving Settings and coming back self-corrected it, which is
/// exactly why it survived: the state was recoverable, and a runner who
/// toggles and navigates away never sees the correction.
///
/// It is an interaction between TWO CORRECT FIXES, not a simple bug:
///
///   · `SettingsV5` corrects its optimistic mirror in `.onChange(of: model)`,
///     on the documented assumption that every writer ends in `await load()`.
///   · SETTINGSWRITE-1 correctly stopped `applyWrite` invalidating the cache
///     when a write fails, so a good cached value is not destroyed by a write
///     that changed nothing.
///
/// Put together: the cache is intact, so the reload rebuilds an IDENTICAL
/// model, and `onChange` is equality-gated, so the correction never runs.
/// Every previous round's cases failed the READ alongside the write, which
/// moves `health` and therefore moves the model, which is precisely why they
/// all passed while this case was open.
///
/// ─────────────────────────────────────────────────────────────────────────
/// RULE 22 · WHAT THIS GATE CANNOT FAIL ON
///
/// · It cannot fail on SwiftUI. `ScreenStandIn` MODELS the two `onChange`
///   deliveries; it does not run them. What it does not model away is the
///   thing that matters: the equality gate is reproduced faithfully, and
///   `testTheEqualityGateAloneCannotCorrectAFailedWrite` proves the stand-in
///   can still see the defect, so a pass here is not a pass by construction.
///
/// · It cannot fail on the WIRING: that `SettingsV5` really does hand
///   `follow(model)` to BOTH `onChange` handlers, and that the host really
///   passes `truth.revision` down. Two lines, read at the call site, and
///   measured on device against a fault-injected PATCH.
///
/// · It cannot fail on a SEVENTH optimistic control added later with its own
///   private `@State` instead of a `SettingsMirror` field. Nothing cheap can:
///   the mirror's own field list is asserted below, which catches a control
///   dropped FROM the mirror, not one that never joined it.
///
/// · It says nothing about whether the runner is TOLD the write failed. The
///   screen reverts, silently. That is the posture SETTINGSWRITE-1 shipped
///   with and the same open item: a silent revert beats a silent lie.
final class SettingsWriteRevertTests: XCTestCase {

    // MARK: - Fixtures

    /// The server's own answer. Deliberately NOT the wire defaults (Saturday
    /// and kilometres, six days a week) for the same reason the UI test's
    /// substrate is seeded off-default: against a value that happens to equal
    /// the fallback, a revert and a failure to revert look identical.
    private func serverModel() -> SettingsV5Model {
        SettingsV5Model(
            longRunDay: "Saturday",
            longRunDayOptions: ["Friday", "Saturday", "Sunday"],
            daysPerWeek: 6,
            phoneRunEnabled: true,
            sessionReminders: true,
            weeklySummary: false,
            units: "Kilometres",
            unitsOptions: ["Miles", "Kilometres"],
            stravaConnected: true,
            email: "d@faff.run")
    }

    /// SETTINGSREVERT-1 · a stand-in for what SwiftUI does with `SettingsV5`'s
    /// two `onChange` handlers, and NOTHING else. `SettingsMirror` and the
    /// re-seed (`mirror = model.mirror`) are the production type and the
    /// production assignment; only the delivery is modelled, and modelled with
    /// its equality gate intact, because that gate IS the defect.
    private struct ScreenStandIn {
        /// What the runner is looking at.
        var mirror: SettingsMirror
        private var lastModel: SettingsV5Model
        private var lastRevision: Int

        init(model: SettingsV5Model, revision: Int) {
            mirror = model.mirror
            lastModel = model
            lastRevision = revision
        }

        /// One body evaluation. Each handler fires only if its own subject
        /// moved, which is what `onChange(of:)` guarantees and all it
        /// guarantees.
        mutating func render(model: SettingsV5Model, revision: Int) {
            if model != lastModel { mirror = model.mirror }
            if revision != lastRevision { mirror = model.mirror }
            lastModel = model
            lastRevision = revision
        }
    }

    /// Counts what `applyWrite` did to the cache. Kept local so the two suites
    /// in this file cannot drift into sharing state.
    private actor CacheStandIn {
        private(set) var invalidateCalls = 0
        func invalidate() { invalidateCalls += 1 }
    }

    /// The whole sequence the reviewer performed, as one helper: the runner
    /// changes something, the PATCH does not land, the reads stay healthy so
    /// the reload rebuilds the SAME model, and the screen renders again.
    ///
    /// `applyWrite` and `ServerTruth` are the production code; only the
    /// render is a stand-in.
    private func failedWrite(
        touching change: (inout SettingsMirror) -> Void,
        file: StaticString = #filePath, line: UInt = #line
    ) async -> (screen: ScreenStandIn, server: SettingsV5Model, invalidations: Int) {
        let server = serverModel()
        var truth = SettingsHostV5.ServerTruth()
        var screen = ScreenStandIn(model: server, revision: truth.revision)

        // 1 · optimistic. This happens before the PATCH is even sent.
        change(&screen.mirror)
        XCTAssertNotEqual(screen.mirror, server.mirror,
                          "the repro did not actually move the screen off the server's value",
                          file: file, line: line)

        // 2 · the PATCH 503s. Reads are healthy, so nothing else changes.
        let cache = CacheStandIn()
        truth.settle(await SettingsHostV5.applyWrite(
            write: { false },
            invalidate: { await cache.invalidate() }))

        // 3 · the reload lands. Same cache, same wire, same model.
        screen.render(model: server, revision: truth.revision)
        return (screen, server, await cache.invalidateCalls)
    }

    // MARK: - The repro, on the control the reviewer used

    func testAFailedPhoneRunWriteDoesNotLeaveTheSwitchWhereTheRunnerPutIt() async {
        let (screen, server, invalidations) = await failedWrite {
            $0.phoneRunEnabled = false
        }
        XCTAssertEqual(invalidations, 0,
                       "SETTINGSWRITE-1 regressed: a write that changed nothing wiped the cache")
        XCTAssertTrue(screen.mirror.phoneRunEnabled,
                      "the switch still shows a change the server never took")
        XCTAssertEqual(screen.mirror, server.mirror,
                       "the screen does not agree with the server")
    }

    // MARK: - The two fields it would cost the most to get wrong

    /// The day the training week ends. A runner who believes they moved their
    /// long run to Sunday, on a server that still says Saturday, gets a plan
    /// shaped against a week they think they changed.
    func testAFailedLongRunDayWriteRevertsToTheServersDay() async {
        let (screen, server, _) = await failedWrite { $0.longRunDay = "Sunday" }
        XCTAssertEqual(screen.mirror.longRunDay, "Saturday")
        XCTAssertEqual(screen.mirror, server.mirror)
    }

    /// How many times a week the engine writes a run. A different writer
    /// (`patchProfile` rather than `patch`), the same settlement, the same
    /// obligation.
    func testAFailedWeeklyFrequencyWriteRevertsToTheServersCount() async {
        let (screen, server, _) = await failedWrite { $0.daysPerWeek = 3 }
        XCTAssertEqual(screen.mirror.daysPerWeek, 6)
        XCTAssertEqual(screen.mirror, server.mirror)
    }

    func testAFailedUnitsWriteRevertsToTheServersUnits() async {
        let (screen, server, _) = await failedWrite { $0.units = "Miles" }
        XCTAssertEqual(screen.mirror.units, "Kilometres")
        XCTAssertEqual(screen.mirror, server.mirror)
    }

    /// EVERY optimistic value, not just the one that was touched. The mirror
    /// is one value precisely so this is one assertion.
    func testEveryOptimisticValueFollowsTheServerBackAtOnce() async {
        let (screen, server, _) = await failedWrite {
            $0.longRunDay = "Friday"
            $0.daysPerWeek = 2
            $0.phoneRunEnabled = false
            $0.sessionReminders = false
            $0.weeklySummary = true
            $0.units = "Miles"
        }
        XCTAssertEqual(screen.mirror, server.mirror,
                       "some controls were corrected and others were left standing")
    }

    // MARK: - The notification switches, which take a different route

    /// `setPref` never touches `SettingsCache` (prefs are fetched fresh every
    /// load) and used to drop `patchNotificationPref`'s own landed answer with
    /// `_ =`. The failure shape is identical: a healthy GET returns the value
    /// from BEFORE the toggle, so the model does not move.
    func testAFailedNotificationPrefWriteRevertsItsSwitch() {
        let server = serverModel()
        var truth = SettingsHostV5.ServerTruth()
        var screen = ScreenStandIn(model: server, revision: truth.revision)

        screen.mirror.weeklySummary = true          // the runner turns it on
        XCTAssertNotEqual(screen.mirror, server.mirror)

        // `patchNotificationPref` returns false on any non-2xx.
        truth.settle(SettingsHostV5.settlement(landed: false))
        screen.render(model: server, revision: truth.revision)

        XCTAssertFalse(screen.mirror.weeklySummary,
                       "the weekly-summary switch stands on a preference the server never stored")
        XCTAssertEqual(screen.mirror, server.mirror)
    }

    // MARK: - The other direction · a landed write must NOT be restated

    /// The fix cannot be "always restate". A write that DID land makes the
    /// held copy stale by definition, and restating it would flip the control
    /// back to the old value for the length of the reload and then forward
    /// again: a visible flicker on the happy path.
    func testALandedWriteInvalidatesAndRestatesNothing() async {
        let cache = CacheStandIn()
        var truth = SettingsHostV5.ServerTruth()
        let before = truth.revision
        truth.settle(await SettingsHostV5.applyWrite(
            write: { true },
            invalidate: { await cache.invalidate() }))
        let calls = await cache.invalidateCalls
        XCTAssertEqual(calls, 1, "a landed write left a stale copy in place")
        XCTAssertEqual(truth.revision, before,
                       "a landed write restated the OLD value over the one that just saved")
    }

    func testSettlementReadsBothWaysAndTheCounterOnlyMovesOnFailure() {
        XCTAssertEqual(SettingsHostV5.settlement(landed: true), .serverChanged)
        XCTAssertEqual(SettingsHostV5.settlement(landed: false), .serverUnchanged)
        var truth = SettingsHostV5.ServerTruth()
        truth.settle(.serverChanged)
        XCTAssertEqual(truth.revision, 0)
        truth.settle(.serverUnchanged)
        XCTAssertEqual(truth.revision, 1)
        truth.settle(.serverUnchanged)
        XCTAssertEqual(truth.revision, 2, "two failures in a row must be two restatements")
    }

    // MARK: - RULE 18 · the stand-in can still see the defect

    /// THE FALSIFIER, BUILT IN. Run the identical sequence with the
    /// restatement withheld, which is exactly the code that shipped, and the
    /// equality gate leaves the optimistic value standing. If this case ever
    /// passes, `ScreenStandIn` has stopped modelling the gate and every
    /// assertion above is passing by construction.
    func testTheEqualityGateAloneCannotCorrectAFailedWrite() {
        let server = serverModel()
        var screen = ScreenStandIn(model: server, revision: 0)
        screen.mirror.phoneRunEnabled = false

        // The reload, with no restatement: same model, same revision.
        screen.render(model: server, revision: 0)

        XCTAssertNotEqual(screen.mirror, server.mirror,
                          "the stand-in no longer reproduces the equality gate, so nothing above is proven")
        XCTAssertFalse(screen.mirror.phoneRunEnabled)
    }

    /// And the gate still does its own job: when the model DOES move (a read
    /// that failed alongside the write, which is every earlier round's case)
    /// the correction runs without any restatement at all.
    func testAMovedModelStillCorrectsOnItsOwn() {
        let server = serverModel()
        var screen = ScreenStandIn(model: server, revision: 0)
        screen.mirror.phoneRunEnabled = false

        var moved = server
        moved.health = SettingsSourceHealth(settings: .serverError(503), profile: nil, prefs: nil)
        screen.render(model: moved, revision: 0)

        XCTAssertEqual(screen.mirror, moved.mirror)
    }

    // MARK: - The mirror covers every control the runner can touch

    /// A control dropped from `SettingsMirror` is a control that stops being
    /// corrected. This names the six by hand so removing one fails loudly
    /// rather than quietly shrinking what "all optimistic UI" means.
    func testTheMirrorCarriesEveryOptimisticControl() {
        let fields = Swift.Mirror(reflecting: serverModel().mirror)
            .children.compactMap(\.label).sorted()
        XCTAssertEqual(fields,
                       ["daysPerWeek", "longRunDay", "phoneRunEnabled",
                        "sessionReminders", "units", "weeklySummary"],
                       "the set of optimistic controls changed; every one of them needs the revert")
    }
}
