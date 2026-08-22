//
//  FaffComplicationViews.swift
//  FaffWatch Widgets
//
//  The three complication sizes. Circular, rectangular, corner.
//
//  SOURCE OF TRUTH — see WatchThemeV5.swift's header.
//    README.md § "Screens · 9" and § "The rules the design enforces" rule 12
//    Faff-Watch-App.dc.html, board `Complications` (2× set; px ÷ 2 below)
//
//  ─────────────────────────────────────────────────────────────────────────
//  RULE 12 IS THE WHOLE FILE
//
//  "Nothing on a watch face or complication is ever coloured. A grade in the
//  corner of the eye all day is not the deal."
//
//  So: no `WatchV5.band`, no `WatchV5.attention`, no `WatchV5.fault`, no
//  `WatchV5.signal`, no day-state ramp — not on any of these three. The only
//  values reachable from here are white and its opacity steps, and the one
//  place staleness would ask for amber (the addendum's "9 DAYS OLD" kicker)
//  steps in OPACITY instead. Opacity is not a hue; a dimmer number does not
//  read as a graded number.
//
//  This is not a style preference the next edit can trade away. The reason
//  the phone and web have no green at all, and the reason the wrist gets an
//  exception, is that the wrist has ONE instrument and ONE question during a
//  run. A complication is not during a run. It sits in the corner of the eye
//  for sixteen hours, and a green disc there is a verdict the runner did not
//  ask for and cannot dismiss.
//
//  ─────────────────────────────────────────────────────────────────────────
//  SUBSTITUTION, DELIBERATE: the surface plate
//
//  The board draws each complication on a `#17191B` plate — `WatchV5.surface2`,
//  a fill step, no border, exactly the containment grammar the rest of the
//  design uses. On a real watch face a fixed dark plate is the wrong object:
//  the system composites complications through the face's own tint and
//  material, and a hard-filled rectangle sits on a photo face like a sticker.
//
//  `AccessoryWidgetBackground()` IS that fill step, supplied by the platform
//  and adapted to the face. It carries no hue of its own, so rule 12 holds,
//  and it introduces no hex, so the palette gate has nothing to catch. Every
//  other value in this file is a `WatchV5.*` token.
//
//  ─────────────────────────────────────────────────────────────────────────
//  KNOWN DISCREPANCY, resolved toward the platform: the CORNER size
//
//  The board draws corner as a pill carrying both registers inline —
//  `EASY  6 mi`, 22px/22px = 11pt each. A watch-face corner slot is roughly
//  30pt across. Two registers at 11pt do not fit in it, and shrinking them
//  until they do would break the type floor the handoff sets by role.
//
//  watchOS gives the corner size a second register for free: the curved
//  `widgetLabel` that runs along the bezel. So the corner draws the TYPE in
//  the slot and the DOSE on the curve — both registers present, type read
//  first, and the dose is still the one that drops (no dose, no label). The
//  content rule survives; only the geometry moved.
//  ─────────────────────────────────────────────────────────────────────────
//

import SwiftUI
import WidgetKit

// MARK: - Circular
//
// Board: 104 × 104px disc = 52 × 52pt, figure 38px/19pt weight 800 over unit
// 20px/10pt weight 700 at 48%.
//
// The unit sits below the type floor the handoff states for a RUNNING FACE
// unit (16pt). That floor is about a number read at arm's length while
// moving; this one is read standing still, at rest, on a face the runner is
// already looking at, and the board draws it at 10pt on purpose. It is the
// same exception the week strip's day letters take.

struct FaffCircularComplication: View {
    let content: FaffWidgetContent

    var body: some View {
        let parts = content.circularParts
        VStack(spacing: 0) {
            Text(parts.figure)
                .font(WatchV5.number(19))
                .foregroundStyle(content.dimmed ? WatchV5.valueMute : WatchV5.value)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            if let unit = parts.unit {
                Text(unit)
                    .font(WatchV5.number(10))
                    .foregroundStyle(WatchV5.valueMute)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .containerBackground(for: .widget) { AccessoryWidgetBackground() }
    }
}

// MARK: - Rectangular · on a watch face
//
// Board: 22px/11pt radius plate, 16px/8pt vertical and 20px/10pt horizontal
// padding, type Archivo 26px/13pt uppercase white over dose 26px/13pt weight
// 700 at 62%, 2px/1pt between them.
//
// The dose is the same SIZE as the type and a step down in OPACITY. That is
// the two-register grammar the lobby uses, compressed: the type names the
// day, the dose is what it costs, and neither is louder than the other by
// more than a step.

struct FaffRectangularComplication: View {
    let content: FaffWidgetContent

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            // The age kicker, where there is room for one. UNCOLOURED — the
            // addendum draws it amber on the in-app board and rule 12 takes
            // the hue away here. It steps ABOVE the prescription it qualifies
            // (72% over 48%), so what the runner reads first is that the
            // number below is old.
            if let age = content.ageKicker {
                WKicker(text: age, color: WatchV5.valueDim, size: 10)
            }
            if let lede = content.lede {
                WDisplayWord(text: lede,
                             size: 13,
                             color: content.dimmed ? WatchV5.valueMute : WatchV5.value)
            }
            if let dose = content.dose {
                Text(dose)
                    .font(WatchV5.number(13))
                    .foregroundStyle(content.dimmed ? WatchV5.valueMute
                                                    : WatchV5.value.opacity(0.62))
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .containerBackground(for: .widget) { AccessoryWidgetBackground() }
    }
}

// MARK: - Corner
//
// Board: 16px/8pt radius, 12px/6pt vertical and 18px/9pt horizontal padding,
// type Archivo 22px/11pt beside dose 22px/11pt at 62%, baseline aligned.
// See the KNOWN DISCREPANCY above for where the second register went.

struct FaffCornerComplication: View {
    let content: FaffWidgetContent

    @ViewBuilder
    var body: some View {
        // The curved register is applied only when there is something for it
        // to say. An absent register is absent — a bezel label reading
        // nothing is a ring of empty space the face still has to draw around.
        if let label = cornerLabel {
            slot.widgetLabel(label)
        } else {
            slot
        }
    }

    private var slot: some View {
        Group {
            if let lede = content.lede {
                WDisplayWord(text: lede,
                             size: 11,
                             color: content.dimmed ? WatchV5.valueMute : WatchV5.value)
            } else if let dose = content.dose {
                // No type to name — the dose takes the slot rather than the
                // slot going blank.
                Text(dose)
                    .font(WatchV5.number(11))
                    .foregroundStyle(WatchV5.value)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .containerBackground(for: .widget) { AccessoryWidgetBackground() }
    }

    /// Type is in the slot, so the curve carries the dose — and when the
    /// prescription is old, it carries the age instead. At corner size the
    /// curve fits one of them, and "9 days old" changes what the dose means,
    /// so it is the one that must survive.
    private var cornerLabel: String? {
        if let age = content.ageKicker { return age }
        if let dose = content.dose, !dose.isEmpty { return dose }
        return nil
    }
}
