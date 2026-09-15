//
//  FinishSyncStatusTests.swift
//  FaffWatch Watch AppTests
//
//  Finding F119 — design review's 3-state spec for FinishSummaryBoard's
//  sync-status line: `.sent` shows nothing, `.sending` shows dim "Saving",
//  `.failed` shows amber "Still saving · trying another way" (never
//  `WatchV5.fault` red — this project's colour doctrine reserves red for
//  something worse than "still working on it").
//
//  This target has no SwiftUI view-inspection dependency (no ViewInspector,
//  no snapshot testing — checked; neither is present anywhere in this
//  repo), so `FinishSummaryBoard.body` deliberately reads its text/colour
//  off `FinishSyncStatus.statusLine` / `.statusColor` rather than deciding
//  them inline — exactly the same "pull the decision out of the view so it
//  is a plain, testable value" shape `WatchLobbyAdapter` already uses for
//  the lobby boards. These tests assert those two computed properties
//  directly, which is what the view actually renders.
//

import Testing
@testable import FaffWatch_Watch_App

struct FinishSyncStatusTests {

    // MARK: - .sent — the ordinary, successful case

    @Test func sentDrawsNothing() {
        #expect(FinishSyncStatus.sent.statusLine == nil)
    }

    // MARK: - .sending — dim, informational

    @Test func sendingShowsDimSaving() {
        #expect(FinishSyncStatus.sending.statusLine == "Saving")
        #expect(FinishSyncStatus.sending.statusColor == WatchV5.valueDim)
    }

    // MARK: - .failed — amber, never red

    @Test func failedShowsAmberRetryLine() {
        #expect(FinishSyncStatus.failed.statusLine == "Still saving \(WatchV5.separator) trying another way")
        #expect(FinishSyncStatus.failed.statusColor == WatchV5.attention)
    }

    /// The doctrine check, as its own explicit assertion rather than only
    /// implied by "equals .attention" above: `.failed` here means "still
    /// working on it," not "something is broken," so it must never be
    /// drawn in `WatchV5.fault` — the colour this product reserves for an
    /// unreadable sensor / a genuine error. A future edit that swaps
    /// `.attention` for `.fault` "to make it stand out more" fails this
    /// test rather than silently violating the doctrine.
    @Test func failedIsNeverFaultRed() {
        #expect(FinishSyncStatus.failed.statusColor != WatchV5.fault)
    }
}
