//
//  NotificationsControllerV5.swift
//  FaffWatch Watch App
//
//  The plumbing under NotificationsV5.swift: the three custom long-look
//  controllers, the scenes that route a push to them, the watch's own
//  UNNotificationCategory registration, and the decode from an APNs payload
//  to a board.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY THIS FILE EXISTS AT ALL
//
//  Until now the watch had no notification code whatsoever — no
//  WKNotificationScene, no UNNotificationCategory, no interface controller.
//  A companion watch app with none of that MIRRORS the phone: watchOS
//  forwards the push and draws its own default long look from
//  aps.alert.title + body, in the system's type, on the system's ground.
//  None of the three 0821 boards could render, because nothing on the wrist
//  had been told they exist.
//
//  Two separate mechanisms, and they are easy to conflate:
//
//    · WKNotificationScene(controller:category:) is what routes a category
//      to a CUSTOM INTERFACE. Without a scene for a category, the system
//      long look is what the runner sees.
//    · UNUserNotificationCenter.setNotificationCategories is what decides
//      which ACTION BUTTONS the OS draws under that interface. The watch has
//      its own registration and does NOT inherit the phone's — which is the
//      lever this design needs (see `register()` below).
//
//  ─────────────────────────────────────────────────────────────────────────
//  CATEGORY IDENTIFIERS AND WHAT THE SERVER ACTUALLY SENDS TODAY
//
//  The identifiers below must equal the `aps.category` string the server
//  puts on the push (web-v2/lib/notifications/apns.ts · apnsCategoryId).
//  As of 2026-08-21 the ledger is:
//
//   | board          | id                  | server today                    |
//   |----------------|---------------------|---------------------------------|
//   | Race tomorrow  | FAFF_RACE_EVE       | EMITTED · apnsCategoryId(       |
//   |                |                     | 'race_eve'), and renderRaceEve  |
//   |                |                     | carries an action button, so    |
//   |                |                     | aps.category is set. Routes.    |
//   | Yesterday      | FAFF_RUN_UNREAD     | EMITTED · the 'run_unread'      |
//   | unread         |                     | category + renderRunUnread      |
//   |                |                     | landed 2026-08-21, and its      |
//   |                |                     | OPEN_ON_IPHONE button means     |
//   |                |                     | aps.category is set. Routes.    |
//   | Session moved  | FAFF_SESSION_MOVED  | NOT EMITTED · no 'session_moved'|
//   |                |                     | NotificationCategory, no        |
//   |                |                     | template, no scheduler.         |
//
//  AND ONE BLOCKER THAT LANDS SQUARELY ON `Session moved`:
//
//    buildApnsBody (apns.ts) sets `aps.category` ONLY when the template
//    carries action_buttons:
//
//        if (args.action_buttons && args.action_buttons.length > 0) {
//          aps.category = args.apns_category_id ?? apnsCategoryId(...);
//        }
//
//    `Session moved` is DEFINED by having no action — the plan has already
//    moved and the runner is being told, not asked. A template with no
//    action_buttons ships no aps.category, a push with no aps.category cannot
//    match a WKNotificationScene, and the board falls back to the system long
//    look. So the design's own rule ("an action only when there genuinely is
//    one") is currently the thing that stops the board from drawing.
//
//    The fix is to set aps.category unconditionally: a category with an empty
//    actions array renders no buttons, which is exactly what the two
//    actionless boards want, and FAFF_MILESTONE already proves the shape.
//    One line, in a file this pass may not touch; it is called out in the
//    report.
//
//  Naming: FAFF_ + SCREAMING_SNAKE, matching the seven the phone already
//  registers in native-v2/Faff/Faff/NotificationCategories.swift. The wire
//  categories these would map from are 'session_moved' and 'run_unread',
//  following apnsCategoryId's existing snake_case bucket names.
//
//  ─────────────────────────────────────────────────────────────────────────
//  "FIRES ONCE" IS NOT IMPLEMENTED HERE, AND CANNOT BE
//
//  The handoff says the unread-run notification fires once, because a second
//  reminder would make it a nag and the run is not going anywhere. That is a
//  SCHEDULING property and it belongs to whatever decides to send the push —
//  a `dedup_key` the scheduler refuses to re-fire, in the shape templates.ts
//  already uses ('race-eve:${race_id}', 'sick-check:...').
//
//  A notification interface controller runs AFTER the OS has delivered and
//  drawn the alert. There is nothing left to suppress by then: dropping the
//  target, or dimming the kicker, on a second delivery would leave the runner
//  looking at a second buzz with LESS in it, which is a worse nag, not a
//  smaller one. So the watch draws every push it is handed, faithfully, and
//  `dedupKey` is carried through the model unused-but-present so the client
//  half exists the day anything needs it.
//

import SwiftUI
import UserNotifications
import WatchConnectivity
import WatchKit
import Combine

// MARK: - Category identifiers

/// The watch's half of the contract with `apnsCategoryId`. Kept in its own
/// enum rather than inlined so the three strings appear exactly once each and
/// a rename cannot half-land.
enum FaffWatchNotificationCategoryId {
    /// Shared with the phone, byte-identical. The phone registers this id
    /// WITH an OPEN CHECKLIST action; the watch registers it WITHOUT one, on
    /// purpose — see `WatchNotificationCategories.register()`.
    static let raceEve      = "FAFF_RACE_EVE"

    /// New. Needs a matching `'session_moved'` case in apnsCategoryId.
    static let sessionMoved = "FAFF_SESSION_MOVED"

    /// New. Needs a matching `'run_unread'` case in apnsCategoryId.
    static let runUnread    = "FAFF_RUN_UNREAD"
}

/// Keys the watch reads out of the push's `faff` dictionary. Every one is
/// optional and every one has a fallback — a board that cannot draw because a
/// key was missing is worse than a board that draws the title it was given.
private enum FaffNotificationPayloadKey {
    static let dict        = "faff"

    /// Overrides the unread board's amber line. Normally absent, in which
    /// case the alert TITLE is the kicker — see the decode below.
    ///
    /// DO NOT READ `faff.kicker`. `renderRunUnread` (templates.ts) already
    /// uses that key for a COLOUR TOKEN NAME — it sends the literal string
    /// `"amber"` to say which token the kicker takes. Reading it as text
    /// draws a board whose amber line says "AMBER". The wrist does not need
    /// to be told: amber is the only colour this board's kicker can be, and
    /// which token a register takes is a property of the design, not of the
    /// message. Hence a separate, explicitly-textual key.
    static let kickerText  = "kicker_text"

    /// Overrides the watch's own "Open on iPhone". Present so the server can
    /// name a different verb without a client release.
    static let targetLabel = "target_label"

    /// What the target opens, as the app's own URL. `renderRunUnread` sends
    /// `faff://today`, which is where an unread run is surfaced.
    static let deeplink    = "deeplink"

    /// Set by dispatch.ts on every push (apns.ts:337).
    static let dedupKey    = "dedup_key"
}

// MARK: - Decode

extension FaffNotificationContent {

    /// Build a board from the delivered push.
    ///
    /// The BOARD is decided by the scene that routed us here, not by sniffing
    /// the payload — a scene is registered per category, so by the time this
    /// runs the category is already known and re-deriving it would just add a
    /// second place to be wrong.
    init(board: FaffNotificationBoard, notification: UNNotification) {
        let push  = notification.request.content
        let title = push.title.trimmingCharacters(in: .whitespacesAndNewlines)
        let body  = push.body.trimmingCharacters(in: .whitespacesAndNewlines)
        let faff  = push.userInfo[FaffNotificationPayloadKey.dict] as? [String: Any] ?? [:]

        let deeplink    = faff[FaffNotificationPayloadKey.deeplink] as? String
        let dedupKey    = faff[FaffNotificationPayloadKey.dedupKey] as? String
        let targetLabel = faff[FaffNotificationPayloadKey.targetLabel] as? String

        switch board {
        case .sessionMoved, .raceTomorrow:
            // The change goes in the display register. The server already
            // sends these uppercase ('RACE TOMORROW' in renderRaceEve) and
            // the lede uppercases again — which is idempotent, and is the
            // reason the uppercasing lives at the draw site rather than
            // being assumed of the wire.
            self.init(board: board,
                      lede: title.isEmpty ? nil : title,
                      kicker: nil,
                      sentence: body,
                      targetLabel: nil,
                      deeplink: deeplink,
                      dedupKey: dedupKey)

        case .runUnread:
            // The change goes in the AMBER KICKER, not the display register,
            // because the design's own line carries a figure ("14 mi · still
            // unread") and Archivo takes words only. See NotificationsV5's
            // header.
            //
            // The TITLE is that line. `renderRunUnread` sends "THE LONG RUN
            // IS IN" / "THE SESSION IS IN" as the title and the consequence
            // as the body, which is the same split the board draws — one
            // register naming the condition, one stating what it costs. So
            // the title lands in the kicker here rather than in the lede, and
            // that is the whole difference between this case and the two
            // above.
            let kicker = (faff[FaffNotificationPayloadKey.kickerText] as? String) ?? title
            self.init(board: board,
                      lede: nil,
                      kicker: kicker.isEmpty ? nil : kicker,
                      sentence: body,
                      targetLabel: targetLabel,
                      deeplink: deeplink,
                      dedupKey: dedupKey)
        }
    }

    /// What a controller holds before `didReceive` hands it a push.
    ///
    /// Deliberately EMPTY rather than seeded with the design's fixture copy.
    /// A board that briefly reads "Gun at 7:40 · nothing left to do but
    /// sleep" for a race that is not tomorrow is a lie with a nice typeface
    /// on it; a board with only the wordmark on it is merely early.
    static func awaitingPush(_ board: FaffNotificationBoard) -> FaffNotificationContent {
        FaffNotificationContent(board: board, sentence: "")
    }
}

// MARK: - The model the interface observes
//
// `didReceive(_:)` runs before the interface is displayed, but `body` on a
// hosting controller is a computed property with no dependency tracking of
// its own. Routing the content through an ObservableObject means the board
// redraws if the two ever land in the other order, which is the kind of
// ordering assumption that is fine until the day it is not.

final class FaffNotificationModel: ObservableObject {
    @Published var content: FaffNotificationContent

    init(_ content: FaffNotificationContent) {
        self.content = content
    }
}

/// The hosting controller's root view. Thin on purpose: it observes, decides
/// whether there is an action to pass down, and hands off to the board.
struct V5NotificationBoardHost: View {
    @ObservedObject var model: FaffNotificationModel
    let onTarget: () -> Void

    var body: some View {
        V5NotificationBoard(content: model.content, onTarget: action)
    }

    /// Only wire the closure when the board actually draws a target. The
    /// board would ignore it anyway — this is the second lock on the same
    /// rule, at the layer where a future edit is likeliest.
    private var action: (() -> Void)? {
        model.content.target == nil ? nil : onTarget
    }
}

// MARK: - Controllers

/// Shared behaviour for all three. Subclasses supply the board; nothing else
/// differs, which is the file-level claim ("one shell, three states") held
/// honest one layer down.
class FaffNotificationController: WKUserNotificationHostingController<V5NotificationBoardHost> {

    /// Which board this controller draws. Overridden by each subclass.
    class var board: FaffNotificationBoard { .sessionMoved }

    // `type(of: self)` rather than `Self` so the subclass's override is what
    // is read. Both resolve dynamically in an instance context, but only one
    // of them says so at a glance.
    private lazy var model = FaffNotificationModel(
        .awaitingPush(type(of: self).board)
    )

    /// `true` on all three, and it is NOT an invitation to add a button.
    ///
    /// A hosting controller that returns `false` is rendered by the system as
    /// a static snapshot. The two actionless boards contain no controls
    /// either way, so `false` would buy nothing and would put their type
    /// through a different rendering path than the third board's for no
    /// reason. The absence of an action is stated by `content.target` being
    /// nil, which is where the design's rule lives — not by this flag.
    override class var isInteractive: Bool { true }

    override var body: V5NotificationBoardHost {
        V5NotificationBoardHost(model: model) { [weak self] in
            self?.handleTarget()
        }
    }

    override func didReceive(_ notification: UNNotification) {
        model.content = FaffNotificationContent(board: type(of: self).board,
                                                notification: notification)
    }

    /// The one verb, on the one board that has one.
    ///
    /// watchOS cannot foreground the iPhone app — there is no API for it, and
    /// there is no honest way to fake one. What the watch CAN do is tell the
    /// phone the runner asked for this run, durably, and let the phone raise
    /// it. `transferUserInfo` is the right channel: queued, survives the
    /// phone being asleep, and it is already how a finished workout crosses.
    private func handleTarget() {
        FaffNotificationHandoff.openOnPhone(model.content.deeplink)
        // Give the screen back. The runner asked for their phone, not for the
        // watch app — `performNotificationDefaultAction()` would launch us
        // instead, which is the wrong app.
        performDismissAction()
    }
}

/// `Session moved` · no action. The plan has already moved and the runner is
/// being told, not asked.
final class FaffSessionMovedController: FaffNotificationController {
    override class var board: FaffNotificationBoard { .sessionMoved }
}

/// `Race tomorrow` · no action. Every logistic is on the phone by now, so the
/// wrist gets the two facts it can hold.
final class FaffRaceTomorrowController: FaffNotificationController {
    override class var board: FaffNotificationBoard { .raceTomorrow }
}

/// `Yesterday is unread` · one target, one amber kicker.
final class FaffRunUnreadController: FaffNotificationController {
    override class var board: FaffNotificationBoard { .runUnread }
}

// MARK: - Scenes
//
// NEEDS: `FaffWatchApp.swift` must add `FaffNotificationScenes()` to its
// `body`, beside the existing `WindowGroup` and `.backgroundTask`:
//
//     var body: some Scene {
//         WindowGroup { ContentView() }
//             .backgroundTask(...)
//         FaffNotificationScenes()
//     }
//
// and `init()` must call `WatchNotificationCategories.register()` beside
// `WatchFonts.register()`. Until both land, the three boards compile and
// preview but never appear on a wrist: an unrouted category falls through to
// the system long look. This pass may not edit that file.

/// The three scenes, bundled so the App body takes one line rather than
/// three — and so adding a fourth board is a change in this file only.
struct FaffNotificationScenes: Scene {
    var body: some Scene {
        WKNotificationScene(controller: FaffSessionMovedController.self,
                            category: FaffWatchNotificationCategoryId.sessionMoved)
        WKNotificationScene(controller: FaffRaceTomorrowController.self,
                            category: FaffWatchNotificationCategoryId.raceEve)
        WKNotificationScene(controller: FaffRunUnreadController.self,
                            category: FaffWatchNotificationCategoryId.runUnread)
    }
}

// MARK: - Category registration

enum WatchNotificationCategories {

    /// Register the watch's categories. Call once at launch.
    ///
    /// ALL THREE REGISTER WITH AN EMPTY ACTIONS ARRAY, and for the unread run
    /// that is not the same statement as "it has no action":
    ///
    ///  · `Session moved` and `Race tomorrow` genuinely have none.
    ///  · `Yesterday is unread` has ONE, and the design draws it INSIDE the
    ///    board — full width, 50pt, pill (rule 6). The server sends an
    ///    `OPEN_ON_IPHONE` action button for it (`renderRunUnread`), which is
    ///    right for the phone and wrong for the wrist: an OS action button is
    ///    a different object at a height the app cannot set, so registering
    ///    it here would draw the verb twice — once as the board's 50pt target
    ///    and once as a system row under it, at a size rule 6 forbids.
    ///
    /// FAFF_RACE_EVE is the same story a second time. The phone registers
    /// that id WITH an `OPEN CHECKLIST` action and `renderRaceEve` sends it.
    /// The watch registers it without: the checklist is a phone surface, the
    /// board says so in words ("nothing left to do but sleep"), and a button
    /// that opens a screen the wrist does not have is worse than no button.
    ///
    /// Same identifier — which is what the wire contract requires — different
    /// actions, which is what a per-device registration is FOR. An unlisted
    /// action id in a delivered payload is simply not drawn; it is not an
    /// error. This is not drift. Drift would be a different identifier.
    static func register() {
        let center = UNUserNotificationCenter.current()
        center.setNotificationCategories([
            actionless(FaffWatchNotificationCategoryId.sessionMoved),
            actionless(FaffWatchNotificationCategoryId.raceEve),
            actionless(FaffWatchNotificationCategoryId.runUnread),
        ])
    }

    private static func actionless(_ id: String) -> UNNotificationCategory {
        UNNotificationCategory(identifier: id,
                               actions: [],
                               intentIdentifiers: [],
                               options: [])
    }
}

// MARK: - Handoff to the phone

/// "Open on iPhone", as far as the wrist can honestly take it.
enum FaffNotificationHandoff {

    /// The default when the push carried no deeplink of its own. `faff://today`
    /// is where an unread run is surfaced, and it is the URL `renderRunUnread`
    /// sends — this constant only covers the case where it did not.
    static let fallbackDeeplink = "faff://today"

    /// UserDefaults key holding a deeplink the runner asked for while the
    /// WCSession was not yet activated.
    ///
    /// NEEDS: something at app launch should read this key and re-send, then
    /// clear it — the natural home is beside `PhoneSync.shared.activate()`.
    /// Without that flush this is a record of the ask, not a delivery of it.
    /// A notification controller can run before the session is up, and
    /// dropping the tap silently is the failure worth naming rather than
    /// pretending away.
    static let pendingKey = "pendingOpenOnPhoneDeeplink"

    /// Message key the phone side switches on.
    ///
    /// NEEDS: no phone-side handler exists yet. `WatchSync` in native-v2 reads
    /// `sendMessage(["request": "today"])` and the completion transfers, and
    /// nothing reads this. Until it does, the transfer is queued and dropped
    /// on the floor at the far end.
    ///
    /// The phone's half is small, because the deeplink is a URL the shell's
    /// router already understands: on `didReceiveUserInfo` carrying
    /// `openOnPhone`, post a LOCAL notification whose payload is that
    /// deeplink. The phone cannot foreground itself on command either — no
    /// platform lets a watch do that — so a local notification the runner
    /// taps is the honest last hop, and it is the reason the wrist's target
    /// says "Open on iPhone" rather than "Open".
    static let messageKey = "openOnPhone"

    static func openOnPhone(_ deeplink: String?) {
        let url = deeplink ?? fallbackDeeplink

        guard WCSession.isSupported() else {
            remember(url)
            return
        }

        // The app owns exactly one WCSession and PhoneSync is its delegate.
        // Activating a second one here would take the delegate off the object
        // that handles completions.
        PhoneSync.shared.activate()

        let session = WCSession.default
        guard session.activationState == .activated else {
            remember(url)
            return
        }

        session.transferUserInfo([messageKey: url])
    }

    private static func remember(_ deeplink: String) {
        UserDefaults.standard.set(deeplink, forKey: pendingKey)
    }

    /// Re-send a tap that happened before WCSession was up.
    ///
    /// `remember(_:)` existed and nothing ever read it back, so a runner who
    /// tapped "Open on iPhone" from a cold watch had their request written to
    /// UserDefaults and left there permanently. Called once on launch, and it
    /// clears the key first so a failure to reach the phone cannot leave a
    /// stale deeplink to fire days later against a different day's run.
    static func flushPending() {
        let d = UserDefaults.standard
        guard let url = d.string(forKey: pendingKey) else { return }
        d.removeObject(forKey: pendingKey)
        openOnPhone(url)
    }
}
