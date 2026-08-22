//
//  FaffWidgetProvider.swift
//  FaffWatch Widgets
//
//  The timeline. It has one job and one rule: never hand a view something
//  the runner would have to guess at.
//
//  SOURCE OF TRUTH — see WatchThemeV5.swift's header.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THREE STATES, NO FOURTH
//
//  WidgetKit's default shape encourages a fourth: a placeholder drawn while
//  the real content is fetched. This provider has no fetch. It reads a file
//  the app already wrote, synchronously, and returns — so `placeholder(in:)`
//  returns the SAME resolved state every other callback returns. There is
//  nothing to wait for, so there is nothing to draw a spinner for (rule 13),
//  and no redacted skeleton stands in for a session that may not exist.
//
//  The one honest degradation is `.noPlan`, and it is a real board with real
//  copy, not an empty frame.
//
//  RELOAD POLICY
//
//  Two clocks move a widget here and neither of them is a poll:
//
//   1. The app writing a new snapshot — `FaffWidgetStore.write` calls
//      `reloadAllTimelines` itself, so a session that arrives from the phone
//      lands on the wrist without the widget asking.
//   2. LOCAL MIDNIGHT — the only moment a correct widget becomes a wrong one
//      with no input at all. At 00:00 today's session becomes yesterday's and
//      `.current` has to become `.stale`. So the timeline ends there and
//      WidgetKit is asked to come back.
//
//  There is deliberately no fifteen-minute refresh. watchOS grants a small
//  finite reload budget; spending it re-reading a file that has not changed
//  is how the widget is out of budget at 6am when the session actually
//  arrives.
//  ─────────────────────────────────────────────────────────────────────────
//

import Foundation
import WidgetKit
import SwiftUI

struct FaffSessionEntry: TimelineEntry {
    let date: Date
    let state: FaffWidgetState
}

struct FaffSessionProvider: TimelineProvider {

    /// The gallery preview and the pre-render frame. Returns the runner's
    /// OWN state, not an invented sample: if there is a session on disk the
    /// gallery shows it, and if there is not, the gallery shows the board the
    /// runner would actually get. A gallery that previews a fictional
    /// "EASY · 6 mi" is an advertisement, and this surface says the session
    /// and nothing about the app.
    func placeholder(in context: Context) -> FaffSessionEntry {
        FaffSessionEntry(date: Date(), state: FaffWidgetStore.state())
    }

    func getSnapshot(in context: Context, completion: @escaping (FaffSessionEntry) -> Void) {
        completion(FaffSessionEntry(date: Date(), state: FaffWidgetStore.state()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<FaffSessionEntry>) -> Void) {
        let now = Date()
        let entry = FaffSessionEntry(date: now, state: FaffWidgetStore.state(now: now))

        // One entry, ending at the next local midnight. Not `.atEnd` with a
        // stack of pre-computed entries: the content of tomorrow's entry is
        // not knowable today — the phone may push a session overnight — so
        // pre-drawing it would be guessing at exactly the thing this file
        // refuses to guess at.
        let policy: TimelineReloadPolicy
        if let midnight = Calendar.current.nextDate(after: now,
                                                    matching: DateComponents(hour: 0, minute: 0, second: 5),
                                                    matchingPolicy: .nextTime) {
            policy = .after(midnight)
        } else {
            // No next midnight is not a real calendar answer, but a missing
            // policy would freeze the widget forever. An hour is the fallback
            // and it is a fallback, not the design.
            policy = .after(now.addingTimeInterval(3600))
        }

        completion(Timeline(entries: [entry], policy: policy))
    }
}
