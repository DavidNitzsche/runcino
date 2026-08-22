//
//  NotificationsV5.swift
//  FaffWatch Watch App
//
//  The three notification boards — 0821 handoff, README § "Screens · 9 ·
//  Before the app opens", last bullet:
//
//    "Notifications — one shell: source line small (wordmark with the orange
//     dot), the change as the display lede, the consequence in the coach's
//     register, and an action only when there genuinely is one. 'Session
//     moved' and 'Race tomorrow' have none. 'Yesterday is unread' has one
//     target and an amber kicker, and fires once — a second reminder would
//     make it a nag."
//
//  SOURCE OF TRUTH — see WatchThemeV5.swift's header.
//    design_handoff_faff_watch_app/Faff-Watch-App.dc.html
//      data-screen-label="Notification moved"
//      data-screen-label="Notification race"
//      data-screen-label="Notification unread run"
//  Every measurement below is the 2× set's px ÷ 2, quoted in the comment that
//  carries it so a future edit can see what it would be changing.
//
//  This file draws the boards and nothing else. The controllers, the
//  WKNotificationScene declarations and the category registration live in
//  NotificationsControllerV5.swift.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY THIS IS ONE SHELL AND NOT THREE SCREENS
//
//  The three boards differ in which of four slots are filled. Nothing else
//  moves. Building them as three views is how the wordmark ends up at three
//  sizes and the coach sentence at three brightnesses, which is the drift the
//  shared kit in WatchKitV5.swift exists to stop.
//
//    · wordmark   — always. 12pt, words at 62%, the dot at full orange.
//    · kicker     — the unread run only. Amber, telemetry register.
//    · lede       — the two that have no action. Archivo 800/112, 23pt.
//    · sentence   — always. Instrument Sans, 14pt.
//    · target     — the unread run only. One, 50pt, full width, pill.
//
//  The unread board puts its change in the KICKER rather than the lede, and
//  that is the design, not a slip. "14 mi · still unread" contains a figure,
//  and the display register is for words — a number never goes inside Archivo
//  (WatchThemeV5's type section, handoff "Display register ... never inside a
//  running metric"). Amber carries it instead because amber is a CONDITION:
//  a result is provisional until it is read. Rule 3 keeps orange off it —
//  orange is drawn intent, the wordmark dot, and never a number.
//

import SwiftUI

// MARK: - Content

/// Which of the three boards this is. The case decides which slots are drawn,
/// so a board cannot grow an action by accident: `targetLabel` is only read
/// for `.runUnread`.
enum FaffNotificationBoard: String {
    /// The plan has already moved and the runner is being TOLD, not asked.
    /// No action, because there is nothing to answer.
    case sessionMoved
    /// The one notification with nothing to do in it, and it says so. Every
    /// logistic is on the phone by now.
    case raceTomorrow
    /// The only one that asks for something, so the only one with a target.
    case runUnread

    /// The `aps.category` string the server sends. See
    /// NotificationsControllerV5.swift for which of these the server actually
    /// emits today and which are still a gap.
    var categoryId: String {
        switch self {
        case .sessionMoved:  return FaffWatchNotificationCategoryId.sessionMoved
        case .raceTomorrow:  return FaffWatchNotificationCategoryId.raceEve
        case .runUnread:     return FaffWatchNotificationCategoryId.runUnread
        }
    }
}

/// One board's content. Built from the push in
/// `FaffNotificationContent.init(notification:)`; built by hand in the
/// previews at the foot of this file.
struct FaffNotificationContent {
    let board: FaffNotificationBoard

    /// The change, in the display register. `nil` on the unread run, which
    /// states its change in the kicker instead — see the file header.
    let lede: String?

    /// The condition, in amber. `nil` on the two boards that are statements
    /// of fact rather than of a state waiting.
    let kicker: String?

    /// The consequence, in the coach's register. Always present: a board with
    /// no sentence is a headline, and a headline is not coaching.
    let sentence: String

    /// The one verb, on the one board that has one. Read only for
    /// `.runUnread` — see `FaffNotificationBoard`.
    let targetLabel: String?

    /// What the target opens, when there is one — the app's own URL, sent by
    /// the server (`renderRunUnread` sends `faff://today`). Carried through
    /// so the handoff names the SCREEN rather than just waking the app: the
    /// phone already knows how to route one of these, and inventing a second
    /// addressing scheme for the wrist would be a second thing to keep in
    /// sync with the shell's router.
    let deeplink: String?

    /// The push's dedup key, carried for the anti-nag ledger the SERVER owns.
    /// The watch cannot suppress a notification the OS has already delivered;
    /// firing once is a scheduling property, not a rendering one.
    let dedupKey: String?

    init(board: FaffNotificationBoard,
         lede: String? = nil,
         kicker: String? = nil,
         sentence: String,
         targetLabel: String? = nil,
         deeplink: String? = nil,
         dedupKey: String? = nil) {
        self.board = board
        self.lede = lede
        self.kicker = kicker
        self.sentence = sentence
        self.targetLabel = targetLabel
        self.deeplink = deeplink
        self.dedupKey = dedupKey
    }

    /// The target, resolved. `nil` on every board but the unread run, and the
    /// switch is exhaustive on purpose: adding a fourth board forces a
    /// decision about whether it has an action rather than inheriting one.
    var target: String? {
        switch board {
        case .sessionMoved, .raceTomorrow:
            return nil
        case .runUnread:
            return targetLabel ?? FaffNotificationCopy.openOnPhone
        }
    }
}

/// The one string this file owns rather than reads off the wire. It is a
/// TARGET LABEL, not a coach sentence, so it lives here rather than in the
/// server's template — the verb is a property of the watch (this is the
/// surface that cannot show a run), not of the message.
enum FaffNotificationCopy {
    static let openOnPhone = "Open on iPhone"
}

// MARK: - Metrics
//
// Points, measured off the three boards. Everything that is shared with the
// rest of the app comes from `WatchV5.Metric` instead — clock clearance, side
// padding, target height, the 7pt reading-block-to-target-stack gap.

private enum FaffNotificationMetric {
    /// `gap:14px` on the two lede boards, `12px` on the unread run. One value:
    /// the difference is a rounding of the same 7pt gap, and a wordmark that
    /// sits at two heights across three boards is the drift, not the design.
    static let wordmarkToBlock: CGFloat = 7

    /// `gap:12px` between the lede and the sentence.
    static let ledeToSentence: CGFloat = 6

    /// `gap:10px` between the kicker and the sentence. Tighter because the
    /// kicker is a label on the sentence, not a register above it.
    static let kickerToSentence: CGFloat = 5

    /// `font-size:24px` — the wordmark on all three boards.
    static let wordmarkSize: CGFloat = 12

    /// `rgba(255,255,255,.62)` on the WORDS. The dot never dims: it is the one
    /// piece of drawn intent in the mark (rule 3), and taking it down with the
    /// letters is what `WWordmark`'s `wordOpacity` exists to prevent.
    static let wordmarkOpacity: Double = 0.62

    /// `font-size:46px` — and the README's own table: "Notification title · 23
    /// · Archivo". The two agree, which is the check.
    static let ledeSize: CGFloat = 23

    /// `letter-spacing:-.015em` at 23pt.
    static let ledeTracking: CGFloat = -0.35

    /// `font-size:22px` — inside the README's 11-13pt kicker band.
    static let kickerSize: CGFloat = 11

    /// `font-size:28px` — inside the README's 13-17pt coach-sentence band.
    static let sentenceSize: CGFloat = 14
}

// MARK: - The display lede
//
// `WDisplayWord` is the shared display-register component and it is the right
// register — but it is `lineLimit(1)` with a 0.5 scale floor, because every
// other consumer of it is a WORD ("GO", "EASY", "DONE", a session type).
//
// A notification title is a PHRASE. "Session moved" at 23pt is ~186pt of
// Archivo 800/112 in a 178pt column, so `WDisplayWord` would shrink it to fit
// one line rather than wrap it — and the design's own `line-height:.92` is
// there precisely because it wraps. Shrinking is the wrong answer: the lede is
// the thing the board exists to say, and 23pt is the size the README fixes it
// at.
//
// NEEDS: `WDisplayWord` should take a `lineLimit: Int? = 1` (and pass
// `.leading(.tight)` when it is not 1) so this view can be deleted and the
// display register has exactly one implementation again. Not done here — this
// pass may not edit WatchKitV5.swift.
// V5NotificationLede is GONE. It existed because WDisplayWord could not wrap
// or carry tracking, so a notification's phrase-length lede had to be
// hand-rolled — which is how a shared component quietly stops being shared.
// Both properties are on WDisplayWord now.

// MARK: - The shell

/// One board, three states. See the file header for the four slots.
///
/// `onTarget` is optional and is only ever CALLED for `.runUnread` — the
/// target is not drawn on the other two, so a caller that passes a closure to
/// a board with no action gets a board with no action.
struct V5NotificationBoard: View {
    let content: FaffNotificationContent
    var onTarget: (() -> Void)? = nil

    var body: some View {
        WBoard {
            VStack(alignment: .leading, spacing: 0) {

                // The source line. Small, and small on purpose: the runner
                // knows what app woke them, and the wordmark's job here is to
                // say who is speaking, not to take a register.
                WWordmark(size: FaffNotificationMetric.wordmarkSize,
                          wordOpacity: FaffNotificationMetric.wordmarkOpacity)

                Spacer(minLength: FaffNotificationMetric.wordmarkToBlock)

                // The reading block, centred in what is left. `flex:1;
                // justify-content:center` in the design.
                VStack(alignment: .leading, spacing: blockGap) {
                    if let kicker = content.kicker {
                        // Amber, because a result is provisional until it is
                        // read — a condition, not a fault and not a grade.
                        // Rule 2 keeps red for a sensor; rule 3 keeps orange
                        // off a figure. Amber is the one that fits.
                        WKicker(text: kicker,
                                color: WatchV5.attention,
                                size: FaffNotificationMetric.kickerSize)
                    }

                    if let lede = content.lede {
                        WDisplayWord(
                            text: lede,
                            size: FaffNotificationMetric.ledeSize,
                            lineLimit: 2,
                            tracking: FaffNotificationMetric.ledeTracking,
                            tightLeading: true
                        )
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    // The consequence. Never a grade on the runner: "the long
                    // run is in but not judged · this week's shape waits on
                    // it", not "you forgot". The cost is stated to the PLAN,
                    // which is a fact, and a fact is answerable.
                    WCoachLine(text: content.sentence,
                               size: FaffNotificationMetric.sentenceSize,
                               color: sentenceColor)
                }

                Spacer(minLength: 0)

                // An action ONLY when there genuinely is one. `content.target`
                // is nil on two of the three boards and this branch is the
                // whole of the difference.
                if let label = content.target {
                    WTargetStack {
                        WTarget(label: label, weight: .quiet) {
                            onTarget?()
                        }
                    }
                }
            }
            .frame(maxHeight: .infinity)
        }
    }

    private var blockGap: CGFloat {
        content.kicker != nil
            ? FaffNotificationMetric.kickerToSentence
            : FaffNotificationMetric.ledeToSentence
    }

    /// The unread board draws its sentence at full white; the two lede boards
    /// draw theirs at 86%. Measured, and it is not arbitrary — on the lede
    /// boards the Archivo title is the loudest thing and the sentence steps
    /// under it. On the unread board the sentence IS the loudest thing, since
    /// the kicker above it is 11pt.
    private var sentenceColor: Color {
        content.kicker != nil ? WatchV5.value : WatchV5.prose
    }
}

// MARK: - Fixtures
//
// The design's own copy, verbatim off the three boards. Used by the previews
// below and by nothing that ships — the boards render what the server sends.

enum FaffNotificationFixtures {

    /// `data-screen-label="Notification moved"`.
    static let sessionMoved = FaffNotificationContent(
        board: .sessionMoved,
        lede: "Session moved",
        sentence: "Thursday's threshold went to Friday · today is easy 5."
    )

    /// `data-screen-label="Notification race"`.
    static let raceTomorrow = FaffNotificationContent(
        board: .raceTomorrow,
        lede: "Race tomorrow",
        sentence: "Gun at 7:40 · nothing left to do but sleep."
    )

    /// `data-screen-label="Notification unread run"`.
    static let runUnread = FaffNotificationContent(
        board: .runUnread,
        kicker: "14 mi · still unread",
        sentence: "The long run is in but not judged · this week's shape waits on it.",
        targetLabel: FaffNotificationCopy.openOnPhone,
        deeplink: "faff://today"
    )

    /// The same board with the copy the SERVER actually sends today
    /// (`renderRunUnread`, templates.ts). Kept beside the design fixture on
    /// purpose: the shell is the thing being reviewed, and the two previews
    /// side by side are what shows it holds a phrase it was not drawn with.
    static let runUnreadAsSent = FaffNotificationContent(
        board: .runUnread,
        kicker: "The long run is in",
        sentence: "Not judged yet · this week's shape waits on how it felt.",
        targetLabel: FaffNotificationCopy.openOnPhone,
        deeplink: "faff://today"
    )

    /// Not a design board — the long-tail check the design does not draw. A
    /// title that wraps to three lines is what a real "Session moved" looks
    /// like on the day the plan actually moves, and the shell has to hold it
    /// without the sentence sliding off the bottom.
    static let sessionMovedLong = FaffNotificationContent(
        board: .sessionMoved,
        lede: "Long run moved",
        sentence: "Sunday's long run went to Saturday · the rest of the week is unchanged."
    )
}

// MARK: - Previews

#Preview("Notification moved") {
    V5NotificationBoard(content: FaffNotificationFixtures.sessionMoved)
}

#Preview("Notification race") {
    V5NotificationBoard(content: FaffNotificationFixtures.raceTomorrow)
}

#Preview("Notification unread run") {
    V5NotificationBoard(content: FaffNotificationFixtures.runUnread) { }
}

#Preview("Notification moved · long lede") {
    V5NotificationBoard(content: FaffNotificationFixtures.sessionMovedLong)
}

#Preview("Notification unread run · as sent") {
    V5NotificationBoard(content: FaffNotificationFixtures.runUnreadAsSent) { }
}
