//
//  ForegroundWork.swift
//  faff.run iPhone · what coming back to the app is supposed to do.
//
//  ─────────────────────────────────────────────────────────────────────────
//  TWO JOBS THAT WERE SHARING ONE THROTTLE, AND ONLY ONE OF THEM WANTED IT.
//
//  Foregrounding used to run this, inline in a SwiftUI closure:
//
//      guard phase == .active else { return }
//      Task { await WatchSync.shared.refresh() }
//      guard now.timeIntervalSince(lastImportAt) > 30 else { return }   // ←
//      lastImportAt = now
//      Task { await HealthKitImporter.shared.importIfConnected(daysBack: 2)
//             post(.faffForegroundRefresh) }
//      post(.faffForegroundRefresh)                                      // ←
//
//  The 30-second guard is right for the HealthKit import: it is expensive, and
//  opening and re-opening the app should not fire two parallel ingests. It was
//  never meant to gate the SURFACE REFRESH — but the early `return` sits above
//  the post, so it did.
//
//  The consequence is the shape of defect that is almost impossible to
//  reproduce on purpose and trivial to hit by accident: background the app,
//  the server corrects something, foreground again within thirty seconds, and
//  NOTHING refreshes. Not Today, not Block, not Races — every `V5Surface`
//  observes `.faffForegroundRefresh`, and it was never posted. The screen
//  keeps rendering the value the server has already moved on from, with no
//  `stale` flag, because `stale` only ever means "a refresh was attempted and
//  failed" and here no refresh was attempted at all.
//
//  Split, so each job carries its own answer:
//
//    · the import is throttled, because it is expensive
//    · the refresh is NOT, because it is cheap and being wrong is not
//
//  Kept as free functions on a caseless enum so a test can ask the question
//  without standing up a SwiftUI scene. The old shape could not be tested at
//  all, which is the other half of why it went unnoticed for so long.
//

import Foundation

enum ForegroundWork {

    /// The HealthKit import is expensive; two in quick succession are two
    /// parallel ingests of the same days.
    static let importThrottleSec: TimeInterval = 30

    /// Should this foreground kick off a HealthKit re-import?
    static func shouldImport(now: Date, lastImportAt: Date) -> Bool {
        now.timeIntervalSince(lastImportAt) > importThrottleSec
    }

    /// STUCKCONN-2 · a background longer than this is treated as long enough
    /// to have killed any pooled HTTP/2 connection.
    ///
    /// Five minutes, and the number is a POLICY CHOICE rather than a measured
    /// one. iOS suspends an app's networking within seconds of backgrounding
    /// and servers commonly close idle keep-alives inside a minute, so the
    /// true threshold is smaller than this; five minutes is deliberately
    /// conservative so an ordinary app-switch does not throw away a healthy
    /// pool. The failure it exists for was eleven hours, which clears this by
    /// two orders of magnitude.
    static let connectionResetAfterBackgroundSec: TimeInterval = 300

    /// Should this foreground throw away the connection pool first?
    ///
    /// Nil `lastActiveAt` is a COLD START, and the answer there is no: a fresh
    /// process has no pool to be stale. Saying yes would spend a reset on
    /// every launch to fix a state that cannot exist yet.
    static func shouldResetConnections(now: Date, lastActiveAt: Date?) -> Bool {
        guard let lastActiveAt else { return false }
        return now.timeIntervalSince(lastActiveAt) > connectionResetAfterBackgroundSec
    }

    /// Should this foreground refresh the surfaces?
    ///
    /// ALWAYS, on every return to the foreground. There is no throttle here on
    /// purpose. A duplicate GET costs a request; a skipped one costs the
    /// runner a screen that quietly disagrees with the server, which is the
    /// failure this file is named after.
    ///
    /// The per-view modifier `v5ReloadOnForeground` still de-duplicates its
    /// own work at 3 seconds. That is the right place for it — it is
    /// protecting against one notification arriving twice, not deciding
    /// whether the app should look at the server at all.
    static func shouldRefreshSurfaces(isActive: Bool) -> Bool { isActive }
}
