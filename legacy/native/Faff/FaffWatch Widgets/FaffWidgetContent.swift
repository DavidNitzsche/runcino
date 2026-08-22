//
//  FaffWidgetContent.swift
//  FaffWatch Widgets
//
//  The content rule, in one place, so three sizes cannot disagree about it.
//
//  SOURCE OF TRUTH — see WatchThemeV5.swift's header.
//    README.md § "Screens · 9 · Before the app opens"
//    Faff-Watch-App.dc.html, board `Complications`:
//      "Three sizes, one content rule: type and dose, in that order, and the
//       dose is what goes when the space runs out. … the circular has room
//       for one thing so it carries the dose, because a runner glancing at a
//       face already knows what day it is."
//
//  THE RULE, STATED ONCE
//
//   · TYPE leads, DOSE follows, and the DOSE is the register that drops.
//   · Except on circular, which has room for one thing and carries the DOSE —
//     the day is already known to anyone reading a watch face.
//   · Nothing about the app. A complication that reads "faff.run" has wasted
//     the only line it gets, so the wordmark appears on none of these.
//   · An absent register is absent, not empty. A rest day has a type and no
//     dose and draws one register, never a dash in the second.
//

import Foundation
import SwiftUI

/// What a size is actually going to draw, resolved from the state once.
///
/// Views take THIS, not `FaffWidgetState` — so a size cannot quietly invent
/// its own reading of "stale", and the degradation ladder stays in
/// `FaffWidgetStore.state`.
struct FaffWidgetContent {

    /// The display word. `nil` where there is no session type to name.
    let lede: String?
    /// The dose, single line, already formatted by the writer.
    let dose: String?
    /// How old the prescription is, in whole days. `nil` when it is today's.
    /// Drawn as an age kicker where there is room for one.
    let daysOld: Int?
    /// The day-state ramp name, for the one surface allowed a ramp.
    let ramp: String
    /// The coach's sentence. Only the no-plan board carries one — the other
    /// states say the session, and a sentence under a session it already
    /// states is the app talking about itself.
    let note: String?

    /// The prescription is drawn at 48% when it is too old to trust. Hiding
    /// it would be pretending we do not have it (addendum § 3).
    var dimmed: Bool { daysOld != nil }

    /// "9 DAYS OLD" · "1 DAY OLD". The addendum's exact register.
    var ageKicker: String? {
        guard let daysOld else { return nil }
        return daysOld == 1 ? "1 day old" : "\(daysOld) days old"
    }

    init(_ state: FaffWidgetState) {
        switch state {
        case .current(let s):
            lede = s.lede
            dose = s.dose
            daysOld = nil
            ramp = s.ramp
            note = nil

        case .stale(let s, let days):
            lede = s.lede
            dose = s.dose
            daysOld = days
            ramp = s.ramp
            note = nil

        case .noPlan:
            // The whole of onboarding on the wrist. The plan is made on the
            // phone and this app is a receiver, so the board says that and
            // stops. No target: a widget cannot make a plan, and an action
            // that cannot be honoured is worse than none.
            lede = "No plan yet"
            dose = nil
            daysOld = nil
            ramp = "none"           // the muted ramp — see WatchV5.DayState
            note = "Open faff on your phone once " + WatchV5.separator
                 + " today's session arrives here on its own."
        }
    }

    // MARK: - Circular's one thing

    /// The circular complication carries the dose alone, and the board draws
    /// it as a figure over its unit — `6` above `mi`. This splits the
    /// writer's single string back into those two registers.
    ///
    /// The split is the LAST space, and only when what follows it carries no
    /// digit: "6 mi" → (6, mi) and "5 × 800 m" → (5 × 800, m), but "1:45"
    /// and "8:12 pace" stay whole rather than being cut somewhere that
    /// changes what they mean.
    ///
    /// Returns the LEDE when there is no dose. That is not a fallback to the
    /// app's voice — a rest day genuinely has one register, and the rule that
    /// the dose is what drops only bites when there are two.
    var circularParts: (figure: String, unit: String?) {
        guard let dose, !dose.isEmpty else {
            return (lede ?? "No plan", nil)
        }
        guard let space = dose.lastIndex(of: " ") else { return (dose, nil) }
        let tail = String(dose[dose.index(after: space)...])
        guard !tail.isEmpty,
              tail.rangeOfCharacter(from: .decimalDigits) == nil else {
            return (dose, nil)
        }
        return (String(dose[dose.startIndex..<space]), tail)
    }
}
