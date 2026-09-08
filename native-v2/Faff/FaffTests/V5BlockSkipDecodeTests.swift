//
//  V5BlockSkipDecodeTests.swift
//  faff.run iPhone · SKIPCAL-1 — a skipped day reaches the training calendar.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHAT WENT WRONG
//
//  `lib/plan/v5-block.ts:buildWeeks` has sent `skipped` on every day since
//  SKIPAGREE-1, and said so in its own comment: "Rendering it is a separate,
//  deliberately-out-of-scope Swift change; what this closes is the wire having
//  nothing to render."
//
//  Nothing rendered it, because `V5BlockDay` had no `skipped` property at all.
//  A synthesised `Decodable` silently drops a key it has no field for — no
//  error, no warning, a perfectly successful decode — so the fact travelled
//  the whole way from `day_actions` to the phone and stopped one line short of
//  the screen. The training calendar drew a skipped day with a blank status
//  column, visually identical to an ordinary un-skipped day of the same type,
//  on the one scannable list a runner reads to answer "what did I miss this
//  week".
//
//  That silence is the reason this file is a WIRE-SHAPE test rather than a
//  behavioural one. There is no failing behaviour to assert against — the app
//  behaved correctly for the data it believed it had. The only way to catch it
//  is to feed the decoder the server's actual key and check the value comes
//  out the other end.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHAT THIS FILE CANNOT FAIL ON (Rule 22)
//
//  It exercises the DECODER and the shared status LADDER. It does not build a
//  SwiftUI view, so it cannot tell you that `HostsV5.calendarWeeks` or
//  `TodayBeforeLiveV5.resolvedCalendarWeeks` still call the ladder — a screen
//  that stops calling the shared resolver is exactly the failure Rule 16 warns
//  about, and only rendering catches it. Nor can it see the current week's
//  date-join in `HostsV5.calendarWeeks`, which reads the skip off the block
//  and matches it to a strip row by `dateISO`.
//
//  It also says nothing about `skipStateUnknown`: the block payload carries
//  that flag, this ladder does not consult it, and the reason is written on
//  `TodayCalendarDay.status`.
//
import XCTest
@testable import Faff

final class V5BlockSkipDecodeTests: XCTestCase {

    /// One week of `/api/v5/block`, key-for-key as `buildWeeks` emits it.
    /// `dayFields` is spliced into the SKIPPED day so the same fixture can be
    /// replayed with the key present, absent, or explicitly false.
    private func weekJSON(skippedDayFields: String) -> Data {
        let json = """
        {
          "id": "wk-7",
          "label": "Wk 7",
          "flag": "Build",
          "miles": {"text": "44 mi", "modelled": false},
          "isCurrent": false,
          "days": [
            {"id": "wko_a", "miles": 6, "quality": false, "race": false,
             "isToday": false, "isFuture": false,
             "dateISO": "2026-09-01", "type": "Easy", "isDone": true, "skipped": false},
            {"id": "wko_b", "miles": 8, "quality": true, "race": false,
             "isToday": false, "isFuture": false,
             "dateISO": "2026-09-02", "type": "Threshold", "isDone": false\(skippedDayFields)},
            {"id": "wko_c", "miles": 0, "quality": false, "race": false,
             "isToday": true, "isFuture": false,
             "dateISO": "2026-09-03", "type": "Rest", "isDone": false, "skipped": false}
          ],
          "detail": [
            {"id": "wk-7-long", "label": "Long run", "sub": null,
             "value": {"text": "16 mi", "modelled": false}, "action": null, "tone": "neutral"}
          ]
        }
        """
        return Data(json.utf8)
    }

    private func decodeWeek(_ data: Data) throws -> V5BlockWeek {
        try JSONDecoder().decode(V5BlockWeek.self, from: data)
    }

    // MARK: - The decoder

    /// FAILS AGAINST THE PREVIOUS CODE — `V5BlockDay` had no `skipped`
    /// property, so this key was dropped and `isSkipped` did not exist to be
    /// asked. Deleting the property again makes this file stop compiling,
    /// which is the loudest failure available for a field the decoder would
    /// otherwise ignore in silence.
    func test_decodesSkippedTrueFromTheBlockWire() throws {
        let week = try decodeWeek(weekJSON(skippedDayFields: #", "skipped": true"#))
        let day = try XCTUnwrap(week.days.first { $0.id == "wko_b" })
        XCTAssertEqual(day.skipped, true, "the server's own key name is `skipped`")
        XCTAssertTrue(day.isSkipped)
        // The days either side must not be dragged along with it.
        XCTAssertFalse(try XCTUnwrap(week.days.first { $0.id == "wko_a" }).isSkipped)
        XCTAssertFalse(try XCTUnwrap(week.days.first { $0.id == "wko_c" }).isSkipped)
    }

    /// BACKWARD COMPATIBILITY, and Rule 11 in the small.
    ///
    /// A `PlanSnapshot`/block payload cached on disk before the server carried
    /// this key must still decode — that is why the property is optional
    /// rather than a non-optional `Bool`, matching `dateISO`/`type`/`isDone`
    /// beside it and `PlanSnapshotDay.skipped`'s own
    /// `decodeIfPresent(...) ?? false`.
    ///
    /// And the absent key must read as "no claim", never as "we know this day
    /// was kept": `skipped` stays nil and only `isSkipped` collapses it to the
    /// one answer the UI can act on.
    func test_anOlderPayloadWithNoSkippedKeyStillDecodes() throws {
        let week = try decodeWeek(weekJSON(skippedDayFields: ""))
        let day = try XCTUnwrap(week.days.first { $0.id == "wko_b" })
        XCTAssertNil(day.skipped, "an absent key is not a false one")
        XCTAssertFalse(day.isSkipped)
        XCTAssertEqual(day.type, "Threshold", "the rest of the day must survive the missing key")
        XCTAssertEqual(day.dateISO, "2026-09-02")
    }

    /// An explicit `false` and an absent key agree on the only question the
    /// column asks, and differ on the raw field. Both are asserted so a future
    /// edit cannot quietly turn one into the other.
    func test_anExplicitFalseIsNotSkipped() throws {
        let week = try decodeWeek(weekJSON(skippedDayFields: #", "skipped": false"#))
        let day = try XCTUnwrap(week.days.first { $0.id == "wko_b" })
        XCTAssertEqual(day.skipped, false)
        XCTAssertFalse(day.isSkipped)
    }

    // MARK: - What the calendar sheet then shows

    /// THE ROW THE FIX EXISTS FOR.
    ///
    /// A past day, not done, explicitly skipped. Before this it computed to
    /// `nil` — a blank status column, indistinguishable from a day nothing had
    /// been recorded about.
    func test_aSkippedDayGetsASkippedStatusInTheCalendar() throws {
        let week = try decodeWeek(weekJSON(skippedDayFields: #", "skipped": true"#))
        let day = try XCTUnwrap(week.days.first { $0.id == "wko_b" })

        let status = TodayCalendarDay.status(isToday: day.isToday,
                                             isDone: day.isDone ?? false,
                                             skipped: day.isSkipped)
        XCTAssertEqual(status, FaffValue.skipped)
        XCTAssertEqual(status?.text, "Skipped.")
    }

    /// The same day, decoded from the payload shape that predates the field,
    /// keeps the status it has always had. A backward-compatibility default
    /// that changed what an old payload rendered would be a regression wearing
    /// a fix's clothes.
    func test_aDayFromAnOlderPayloadKeepsItsOldStatus() throws {
        let week = try decodeWeek(weekJSON(skippedDayFields: ""))
        let day = try XCTUnwrap(week.days.first { $0.id == "wko_b" })
        XCTAssertNil(TodayCalendarDay.status(isToday: day.isToday,
                                             isDone: day.isDone ?? false,
                                             skipped: day.isSkipped))
    }

    /// THE LADDER'S ORDER, PINNED.
    ///
    /// `skipped` was APPENDED to the existing ladder, not inserted into it, so
    /// that nothing which already rendered moves. These four assertions are
    /// what "appended" means, and they are what a later reorder has to argue
    /// with rather than quietly do.
    func test_theStatusLadderPrefersWhatActuallyHappened() {
        // A run that happened outranks a skip declared before it.
        XCTAssertEqual(TodayCalendarDay.status(isToday: false, isDone: true, skipped: true)?.text,
                       "Done")
        // Today stays the list's anchor. The skip for today is stated on the
        // day's own screen, which is where the runner is standing.
        XCTAssertEqual(TodayCalendarDay.status(isToday: true, isDone: false, skipped: true)?.text,
                       "Today")
        XCTAssertEqual(TodayCalendarDay.status(isToday: false, isDone: false, skipped: true)?.text,
                       "Skipped.")
        XCTAssertNil(TodayCalendarDay.status(isToday: false, isDone: false, skipped: false))
    }

    /// RULE 16 · ONE FACT, ONE WORDING.
    ///
    /// `PlanSnapshotDayView` says this under the headline and the calendar
    /// sheet says it in a status column. They read the same constant, so this
    /// pins the constant rather than either call site — a second literal is
    /// the thing that drifts.
    func test_theSkippedWordingIsTheOneCanonicalString() {
        XCTAssertEqual(FaffValue.skipped.text, "Skipped.")
        XCTAssertEqual(FaffValue.skipped.basis, .measured,
            "a skip is something the runner did and the server recorded, not a model output")
        XCTAssertFalse(FaffValue.skipped.isModelled)
    }
}
