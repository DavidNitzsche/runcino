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
    /// This decides whether `FaffApp` POSTS `.faffForegroundRefresh` at all.
    /// It is deliberately blind to how many times that post gets ACTED on —
    /// see `shouldLoadOnForeground` below for that question, which used to
    /// have no answer of its own.
    static func shouldRefreshSurfaces(isActive: Bool) -> Bool { isActive }

    /// REQUESTSTORM-2 (2026-09-06) · how long to collapse the app's two
    /// DELIBERATE `.faffForegroundRefresh` posts (immediate, so the Strava
    /// banner clears on an OAuth return; and again once the HealthKit import
    /// lands, so today's run shows up) into one actual surface reload.
    ///
    /// ─────────────────────────────────────────────────────────────────────
    /// THE COMMENT ABOVE THIS ONE WAS WRONG, AND THAT IS WHY IT SHIPPED TWICE
    ///
    /// It said the per-view modifier `v5ReloadOnForeground` was "the right
    /// place" to de-duplicate the two posts. That is true for what THAT
    /// modifier calls — `syncPlanSnapshot()`, uniquely — but `V5Surface`
    /// (`SurfaceStoreV5.swift`) ALSO listens for `.faffForegroundRefresh`,
    /// directly, in its own `init`, completely independently of any view
    /// modifier. That observer had no throttle of its own, so Today/Block/
    /// Races/every other `V5Surface` reloaded on BOTH of the app's two posts
    /// regardless of what any view layered on top — REQUESTSTORM-1's fix
    /// (one in-flight GET coalesced per URL) helped only when both loads
    /// happened to overlap in flight; by the time the HealthKit import
    /// finishes, the first wave's request has usually already completed and
    /// left `V5RequestCoalescer`'s in-flight table, so the second wave fired
    /// as brand-new, uncoalesced traffic. On Today/Block/Races specifically,
    /// the ALSO-present `v5ReloadOnForeground { await surface.load() }`
    /// added a THIRD trigger for the exact same reload, throttled only
    /// against itself.
    ///
    /// David's own on-device request log, 2026-09-0x night: paired duplicate
    /// requests to `/api/v5/today`, `/api/v5/block`, `/api/v5/races` and
    /// `/api/v5/plan-snapshot`, roughly 0.7-2s apart — sequential, not
    /// concurrent, which is exactly what a second wave arriving AFTER the
    /// first wave's coalesced request already completed looks like.
    ///
    /// So the de-dupe belongs where `.faffForegroundRefresh` is actually
    /// turned into a `load()` call — inside `V5Surface` itself, which every
    /// V5 surface already gets for free — not bolted onto whichever views
    /// happen to also carry `v5ReloadOnForeground`. Kept at 3 seconds to
    /// match the window that modifier already used: long enough to absorb
    /// the gap between the two deliberate posts, short enough that a runner
    /// who backgrounds and returns a few seconds later still gets a fresh
    /// read.
    static let foregroundLoadCoalesceSec: TimeInterval = 3

    /// REQUESTSTORM-3 (2026-09-14) · THE WINDOW WAS MEASURED FROM THE WRONG
    /// EDGE, AND "MEASURE FROM THE OTHER EDGE" DOES NOT FIX IT EITHER.
    ///
    /// `V5Surface` used to stamp `lastForegroundLoadAt` the instant `load()`
    /// STARTED, so a load already in flight when the post-import post landed
    /// made that post look like "the tail of the same burst" and swallowed
    /// it — the run the import had just pulled in never reached the screen,
    /// because the FIRST load's own fetch had already run and answered
    /// before the import finished, and nothing asked again. David saw this
    /// as: a completed run doesn't appear on Today until the app is
    /// force-quit and relaunched — plainly foregrounding it is not enough,
    /// because `.distantPast` is what actually "fixes" a force-quit, by
    /// defeating this window entirely rather than by doing anything else.
    ///
    /// The obvious-looking fix — stamp at load-FINISH instead of load-START —
    /// was tried on paper first and does not close this. `FaffApp` fires the
    /// import (`HealthKitImporter.importIfConnected`) and this surface's own
    /// `load()` as two SEPARATE, CONCURRENT tasks off the same foreground
    /// event, not sequentially. If the surface's own GET (duration `L`)
    /// finishes before the import does (duration `I` — the case the import's
    /// own comments say is typical, since it is the "expensive" side), a
    /// finish-stamped `lastForegroundLoadAt` reads `L`, and the post-import
    /// post lands at `I`. The gap the throttle sees is `I − L`, which is
    /// SMALLER than the start-stamped gap of `I − 0`. Moving the stamp to the
    /// finish edge narrows the window in exactly the concurrent-start case
    /// this bug lives in — it does not widen it. Measured against the
    /// project's own cited round-trip times (import 0.7-2s, a V5 GET well
    /// under 1s), `I − L` stays inside the 3s coalesce window in the ordinary
    /// case, so the bug would still reproduce.
    ///
    /// So the fix is not which edge the window is measured from. It is that
    /// this ONE post is never supposed to be coalesced, at any gap, because
    /// it exists specifically to catch a run the first load could not have
    /// seen yet. `FaffApp` tags it (and `WatchSync.flushPendingCompletions`'s
    /// own always-load-bearing post, once a completion actually lands — the
    /// SAME shared observer, the SAME coalescing window, the SAME failure
    /// mode, independently diagnosed and independently confirmed reachable)
    /// with `mustLoadKey` in the notification's `userInfo`, and
    /// `shouldLoadOnForeground` below honors it unconditionally.
    static let mustLoadKey = "faff.foreground.mustLoad"

    /// Should a `.faffForegroundRefresh` observer actually call `load()` now,
    /// or has this surface already reloaded too recently to be a SECOND real
    /// foreground rather than the tail of the same one?
    ///
    /// `mustLoad` bypasses the throttle entirely — see `mustLoadKey`'s doc
    /// comment above for why the window itself cannot be reshaped to catch
    /// this case, and why bypass is the only fix that actually closes it.
    /// Defaulted to `false` so every existing caller/test that only ever
    /// asked the coalescing question keeps asking exactly that question.
    static func shouldLoadOnForeground(now: Date, lastLoadAt: Date, mustLoad: Bool = false) -> Bool {
        mustLoad || now.timeIntervalSince(lastLoadAt) > foregroundLoadCoalesceSec
    }
}
