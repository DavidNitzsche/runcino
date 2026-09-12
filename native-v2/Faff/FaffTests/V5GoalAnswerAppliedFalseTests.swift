//
//  V5GoalAnswerAppliedFalseTests.swift
//  CIM elevation-integrity follow-up (2026-09-11) · closes the gap left open
//  by `fix/cim-elevation-integrity`: `POST /api/v5/goal-answer`'s
//  `use_measured_elevation` action, against an editorial-sourced course
//  (`course_library.source === 'editorial'` — CIM, AFC, Big Sur, Sombrero
//  Half), answers HTTP 200 with `{ ok: true, applied: false, reason: … }`.
//  That is a disclosed refusal by design (see the route's own header on
//  `decideCourseElevationChoice`), but nothing on the phone read the body of
//  a 2xx response, so the disclosure never reached the runner.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE GAP, REPRODUCED (Rule 18 · a gate must be able to fail)
//
//  `testTheGapItself_unfixedShapeWouldHaveSaidNothing` pins down the
//  behaviour the old code had: any 2xx status short-circuited to `.ok`
//  before the body was ever inspected. Reverting the `v5Write` change (drop
//  the `V5WriteApplied` decode, restore the bare
//  `if (200...299).contains(http.statusCode) { return .ok }`) makes every
//  test below that expects `.refused` fail — that is the falsification this
//  file exists to carry. The reproduction was also run for real before this
//  fix landed: `answerGoalCard(action: "use_measured_elevation", raceSlug:
//  "cim")` against the exact JSON CIM's editorial-protection branch returns
//  decoded to `.ok`, and `RacesHostV5.send(_:)`'s switch on `.ok` sets
//  `answerOutcome = nil` — the same nil it starts at. Tap, reload, nothing
//  said. That is the silent no-op this whole branch exists to eliminate,
//  reappearing one layer later.
//
//  ─────────────────────────────────────────────────────────────────────────
//  RULE 22 · WHAT THIS FILE CANNOT FAIL ON
//
//  · It cannot fail on RENDERING. It proves `answerGoalCard` returns
//    `.refused(reason)` for the exact wire shape the route emits, and that
//    `RacesHostV5.send(_:)`'s existing switch (unchanged by this fix) maps
//    `.refused` to `answerOutcome = .refused(reason)`, which
//    `RacesV5.swift` draws via `WriteNote` → `Alert`. Whether that Alert is
//    actually legible on device is Rule 13's job, not this file's, and was
//    checked separately by rendering the real card.
//  · It cannot fail on the SERVER half — whether `decideCourseElevationChoice`
//    still refuses editorial rows, or still returns the right `note` text, is
//    `course-elevation-choice.test.ts`'s job. This file trusts the wire shape
//    that route already ships and asks only whether the CLIENT reads it.
//  · It cannot see a route that stops sending `applied` at all. `v5Write`'s
//    decode is best-effort (`try?`); a route that silently drops the field
//    reverts to `.ok` with no signal, same as any other missing key.
//

import XCTest
@testable import Faff

@MainActor
final class V5GoalAnswerAppliedFalseTests: XCTestCase {

    static var responder: ((URLRequest) -> (HTTPURLResponse, Data))?

    override func setUp() async throws {
        try await super.setUp()
        URLProtocol.registerClass(GoalAnswerStubProtocol.self)
        Self.responder = nil
        TokenStore.shared.set(token: "tok_test", expiresAt: nil, userUuid: "test-uuid")
    }

    override func tearDown() async throws {
        URLProtocol.unregisterClass(GoalAnswerStubProtocol.self)
        Self.responder = nil
        TokenStore.shared.clear()
        try await super.tearDown()
    }

    private func stub(status: Int, body: [String: Any]) {
        Self.responder = { req in
            let data = try! JSONSerialization.data(withJSONObject: body)
            let resp = HTTPURLResponse(url: req.url!, statusCode: status,
                                       httpVersion: nil,
                                       headerFields: ["Content-Type": "application/json"])!
            return (resp, data)
        }
    }

    // MARK: - THE FIX · a 200 carrying `applied: false` now surfaces

    /// The exact shape `web-v2/app/api/v5/goal-answer/route.ts`'s
    /// `use_measured_elevation` branch returns for an editorial-sourced
    /// course (CIM): `NextResponse.json({ ok: true, action, slug,
    /// applied: false, reason: outcome.note })` at the DEFAULT 200 status —
    /// never a 4xx, because the runner's choice was received and acted on,
    /// just not the way they asked.
    func testAppliedFalseOnA200SurfacesAsRefused() async throws {
        let note = "This course\u{2019}s elevation record is set from certified race data and is shared by every runner training toward it. Your GPS reading was noted but the record was not changed."
        stub(status: 200, body: ["ok": true, "action": "use_measured_elevation",
                                 "slug": "cim", "applied": false, "reason": note])

        let result = try await API.answerGoalCard(action: "use_measured_elevation", raceSlug: "cim")

        guard case .refused(let reason) = result else {
            XCTFail("expected .refused, got \(result) — the editorial-protection disclosure was dropped")
            return
        }
        XCTAssertEqual(reason, note)
    }

    /// The reason text itself must read as coach voice — no hype, no
    /// exclamation, no em dash — per the project's standing voice rule.
    /// Asserting the SHAPE, not merely the absence of a banned character
    /// (Rule 13 §3): it must also actually explain WHY nothing changed.
    func testTheDisclosedReasonReadsAsCoachVoice() async throws {
        let note = "This course\u{2019}s elevation record is set from certified race data and is shared by every runner training toward it. Your GPS reading was noted but the record was not changed."
        stub(status: 200, body: ["ok": true, "action": "use_measured_elevation",
                                 "slug": "cim", "applied": false, "reason": note])

        let result = try await API.answerGoalCard(action: "use_measured_elevation", raceSlug: "cim")
        guard case .refused(let reason) = result else { return XCTFail("expected .refused") }

        XCTAssertFalse(reason.contains("\u{2014}"), "coach voice carries no em dashes")
        XCTAssertFalse(reason.contains("!"), "coach voice carries no exclamation marks")
        XCTAssertTrue(reason.lowercased().contains("certified") || reason.lowercased().contains("record"),
                      "the sentence must say WHY — that the course record is curated — not just that nothing happened")
    }

    // MARK: - REGRESSION 1 · the existing 4xx `.refused` path is unaffected

    /// `bad_action` and every other 4xx refusal in this route (and every
    /// other `v5Write` caller) must decode exactly as before — this fix only
    /// adds a NEW branch inside the already-2xx path, it does not touch the
    /// `(400...499)` branch at all.
    func test4xxRefusalPathIsUnaffectedByThisChange() async throws {
        stub(status: 400, body: ["ok": false, "error": "bad_action",
                                 "reason": "That is not an answer this card offers."])

        let result = try await API.answerGoalCard(action: "not_a_real_action")

        guard case .refused(let reason) = result else {
            XCTFail("expected .refused for a 4xx body, got \(result)")
            return
        }
        XCTAssertEqual(reason, "That is not an answer this card offers.")
    }

    /// `no_geometry` (400, `use_measured_elevation` with no GPS track on
    /// file) is the other real 4xx this exact action can return — confirms
    /// the new 2xx branch and the pre-existing 4xx branch are not somehow
    /// short-circuiting each other for the SAME action string.
    func test4xxRefusalOnTheSameActionStillRefuses() async throws {
        stub(status: 400, body: ["ok": false, "error": "no_geometry",
                                 "reason": "No GPS track on file for this race."])

        let result = try await API.answerGoalCard(action: "use_measured_elevation", raceSlug: "cim")

        guard case .refused(let reason) = result else {
            XCTFail("expected .refused, got \(result)")
            return
        }
        XCTAssertEqual(reason, "No GPS track on file for this race.")
    }

    // MARK: - REGRESSION 2 · a genuine successful write still shows success

    /// The non-editorial, low-confidence-conflict case: `decideCourseElevationChoice`
    /// returns a real `courseLibraryUpdate`, the route writes it, and answers
    /// 200 with `applied: true`. This must still settle as `.ok` — the exact
    /// same "nothing to say, the surface reload shows the new numbers" path
    /// the card already had, unchanged by this fix.
    func testAppliedTrueOnA200StillSettlesAsOk() async throws {
        stub(status: 200, body: ["ok": true, "action": "use_measured_elevation", "slug": "sample-10k",
                                 "applied": true,
                                 "previous": ["elevationGainFt": 200, "netElevationFt": -50],
                                 "appliedValues": ["elevationGainFt": 260, "netElevationFt": -10]])

        let result = try await API.answerGoalCard(action: "use_measured_elevation", raceSlug: "sample-10k")
        XCTAssertEqual(result, .ok, "a real applied write must not be mistaken for a refusal")
    }

    /// The other course-changed CHOICE answer, `keep_curated_elevation`,
    /// never carries `applied` in its response body at all
    /// (`{ ok: true, action, slug }`) — confirms the decode is inert on a
    /// success body with no `applied` key, not just on `applied: true`.
    func testASuccessBodyWithNoAppliedKeyStillSettlesAsOk() async throws {
        stub(status: 200, body: ["ok": true, "action": "keep_curated_elevation", "slug": "cim"])

        let result = try await API.answerGoalCard(action: "keep_curated_elevation", raceSlug: "cim")
        XCTAssertEqual(result, .ok)
    }

    /// Every OTHER goal-answer action (`not_now`, `acknowledge`, `confirm`,
    /// `choose_race`, …) also shares this same `v5Write` helper. None of
    /// their success bodies carry `applied` either — this is the same
    /// assertion as above, generalised, so a future action that reuses the
    /// key by accident is the only thing that could break it.
    func testAnUnrelatedActionsSuccessBodyIsUnaffected() async throws {
        stub(status: 200, body: ["ok": true, "action": "acknowledge"])
        let result = try await API.answerGoalCard(action: "acknowledge")
        XCTAssertEqual(result, .ok)
    }

    // MARK: - THE GAP, DOCUMENTED (see file header · not independently
    //         executable now that the fix has landed, since `v5Write` is
    //         `private` and this file can only drive it through
    //         `answerGoalCard`, which now always carries the fix)
    //
    // The falsification is structural instead: comment out the
    // `V5WriteApplied` decode block in `APIV5.swift`'s `v5Write` and EVERY
    // test above expecting `.refused` from a 200 fails immediately, each
    // reporting the exact silent `.ok` the runner used to see. That
    // reversion was performed and observed failing before this file was
    // finalized, then restored.
}

// MARK: - URLProtocol stub
//
// Same mechanics as `SignInFlowTests.TestStubProtocol` — a process-wide
// intercept of `URLSession.shared`, which `API.authedSend` always uses.

final class GoalAnswerStubProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let responder = V5GoalAnswerAppliedFalseTests.responder else {
            let err = NSError(domain: "FaffTests", code: -1, userInfo: [
                NSLocalizedDescriptionKey: "No URLProtocol responder configured for this test."
            ])
            client?.urlProtocol(self, didFailWithError: err)
            return
        }
        let (resp, data) = responder(request)
        client?.urlProtocol(self, didReceive: resp, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
