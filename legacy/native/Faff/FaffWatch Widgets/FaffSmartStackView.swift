//
//  FaffSmartStackView.swift
//  FaffWatch Widgets
//
//  The Smart Stack widget: the lobby with the poster cropped out.
//
//  SOURCE OF TRUTH — see WatchThemeV5.swift's header.
//    README.md § "Screens · 9 · Before the app opens"
//    Faff-Watch-App.dc.html, board `Smart Stack`:
//      "The widget is the lobby with the poster cropped out: same two
//       registers, same ramp, one target. It earns the gradient the
//       complications do not, because it appears for a few seconds when the
//       wrist is raised rather than sitting in the corner of the eye all day.
//       Tapping it goes to the lobby, not straight into the run · one screen
//       of confirmation is worth it when the surface is this easy to press by
//       accident."
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY THIS ONE MAY BE COLOURED AND THE COMPLICATIONS MAY NOT
//
//  Rule 12 bans colour on a WATCH FACE. It is a rule about duration, not
//  about pixels: a hue that sits in the corner of the eye for sixteen hours
//  is read as a standing verdict. A Smart Stack card is raised, read and
//  lowered inside a few seconds, and it fills its own frame — a ramp filling
//  a card cannot be mistaken for a verdict on one figure, which is the same
//  argument that lets the lobby fill a whole screen with colour.
//
//  So this file draws `WRamp` and the complications do not, and the two are
//  in separate files so that a future edit cannot copy one into the other by
//  reaching for the nearest view.
//
//  HOW THE TWO ARE TOLD APART AT RUNTIME
//
//  Both surfaces ask for the same family — `accessoryRectangular`. The
//  discriminator is `widgetRenderingMode`: watchOS renders Smart Stack
//  widgets in `.fullColor` and watch-face complications in `.accented`,
//  where it strips the view's own hues and re-tints it to the face. So the
//  branch in `FaffRectangularEntryView` is not a guess about which surface we
//  are on — it is the system telling us, and it fails SAFE: any mode that is
//  not `.fullColor` gets the uncoloured complication.
//  NEEDS DEVICE CONFIRMATION — see the report; the branch is correct by the
//  documented behaviour and has not been run on a wrist here.
//
//  ─────────────────────────────────────────────────────────────────────────
//  TAPPING GOES TO THE LOBBY
//
//  No `widgetURL`. A watchOS widget with no URL launches its containing app
//  at the root, and the watch app's root is `WorkoutRootView`, which is the
//  idle lobby unless a run is already in progress (in which case the run IS
//  where the runner meant to go). That is exactly the behaviour the design
//  asks for, with no deep link to register and no scheme that can fall
//  through and do nothing.
//
//  NEEDS: if the lobby ever gains a deep-link route — a specific page, or a
//  "start this session" intent — this is where `widgetURL` goes, and the
//  watch app needs a matching `onOpenURL` plus a `CFBundleURLTypes` entry in
//  its Info.plist block in `native-v2/project.yml`. It must still land on the
//  lobby: this surface is easy to press by accident and the design is
//  explicit that one screen of confirmation is worth it.
//
//  ─────────────────────────────────────────────────────────────────────────
//  KNOWN DISCREPANCY, resolved toward the platform: the card is shorter than
//  the board
//
//  The board draws the card at 364 × 219px = 182 × 110pt. A watchOS Smart
//  Stack card gives an `accessoryRectangular` widget roughly 172 × 84pt, so
//  the board's stack — 26pt lede, 17pt dose, 38pt pill, 12pt padding — is
//  about a third taller than the frame it has to live in.
//
//  The RATIOS are kept and the sizes step down together: lede 24, dose 15,
//  pill 28. Nothing is dropped, because the design's point is that the widget
//  carries the same two registers and one target as the lobby, and dropping
//  the target to preserve a type size would break that before it broke
//  anything else. Every size also carries `minimumScaleFactor`, so a longer
//  session name shrinks rather than truncating — `INTERVALS` is nine
//  characters and the lobby already steps down for it.
//  ─────────────────────────────────────────────────────────────────────────
//

import SwiftUI
import WidgetKit

struct FaffSmartStackView: View {
    let content: FaffWidgetContent

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {

            // The age kicker. Here it KEEPS its amber: this card is not a
            // watch face, and amber is what stale evidence means everywhere
            // else in this product (addendum § 3). It is a condition, not a
            // grade, and it is on a word rather than on a figure.
            if let age = content.ageKicker {
                WKicker(text: age, color: WatchV5.attention, size: 10)
            }

            // Register one: the type, in the display face.
            if let lede = content.lede {
                WDisplayWord(text: lede,
                             size: 24,
                             color: content.dimmed ? WatchV5.valueMute : WatchV5.value)
            }

            // Register two: the dose, in the value register. The board draws
            // it at 90% white — a step under the type, not a second voice.
            if let dose = content.dose {
                Text(dose)
                    .font(WatchV5.number(15))
                    .foregroundStyle(content.dimmed ? WatchV5.valueMute
                                                    : WatchV5.value.opacity(0.9))
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }

            // The coach's sentence, on the one board that has no session to
            // state. It replaces the target rather than joining it.
            if let note = content.note {
                WCoachLine(text: note, size: 11, color: WatchV5.valueDim)
                    .lineLimit(3)
                    .minimumScaleFactor(0.7)
            }

            if let label = targetLabel {
                Spacer(minLength: 2)
                FaffWidgetTarget(label: label)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .containerBackground(for: .widget) { WRamp(session: content.ramp) }
    }

    /// One target, or none.
    ///
    /// · A session gets `Start` — the board's own word, and the invitation the
    ///   lobby completes.
    /// · A prescription too old to trust gets `Open`. The lobby has a board
    ///   for a nine-day-old plan with two honest answers on it ("Run it
    ///   anyway" / "Plain run"); a card that said `Start` over a stale dose
    ///   would be selling one of them before the runner had seen either.
    /// · The no-plan board gets NOTHING. There is no plan to start and the
    ///   widget cannot make one, so it states that and stops — the same rule
    ///   the notification shell follows, where an action appears only when
    ///   there genuinely is one.
    private var targetLabel: String? {
        if content.note != nil { return nil }       // no plan yet
        return content.dimmed ? "Open" : "Start"
    }
}

/// The target on the card.
///
/// It is DRAWN, not pressed. A watchOS widget is one tap target end to end —
/// the pill is what makes the card read as the lobby it opens, and there is
/// deliberately no `Button` here: a second press target inside a card this
/// easy to catch with a sleeve is the accident the design is guarding
/// against.
///
/// Black fill, white label — the ramp has already said what kind of day it
/// is, and a white pill on a lit ramp is a hole in the poster. Same weight as
/// the lobby's Start (`V5LobbyTarget.start`), scaled with the rest of the
/// card.
private struct FaffWidgetTarget: View {
    let label: String

    var body: some View {
        Text(label)
            .font(WatchV5.label(14, .heavy))
            .foregroundStyle(WatchV5.value)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .frame(maxWidth: .infinity)
            .frame(height: 28)
            .background(WatchV5.ground, in: Capsule())
    }
}
