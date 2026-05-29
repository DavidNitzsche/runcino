//
//  FieldCard.swift
//
//  iPhone mirror of the FieldCard surface in
//  web-v2/app/profile/page.tsx:260-268. The lockstep recipe:
//
//      LABEL    (f-label · 11pt · mute · 1.4px tracking · uppercase)
//      VALUE    (f-display · 28pt · ink · 0.5px tracking)
//      HINT?    (f-label · 11pt · green · 1px tracking)
//
//  Used for PERSONAL grid (NAME · GENDER · BIRTHDAY · HEIGHT · CITY ·
//  EXPERIENCE) and PHYSIOLOGY · TRAINING ANCHORS grid (LTHR · MAX HR ·
//  RESTING HR · VDOT). When a field is editable, the caller wraps the
//  card in a Button and the EDIT chip surfaces in the value row — this
//  type only renders the static surface; tap-to-edit lives in the
//  parent View.
//

import SwiftUI

struct FieldCard: View {
    /// Caps-tracked label above the value (e.g. "LTHR", "BIRTHDAY").
    let label: String
    /// The value to display. Pass "—" for missing data — the parent
    /// View is responsible for the formatting, never this component.
    let value: String
    /// Optional small hint underneath (e.g. "60D MEAN", "APPLE HEALTH")
    /// — rendered in the brand green when present.
    var hint: String? = nil
    /// Optional second hint line (e.g. used-for context like
    /// "HR zones (Z1–Z5 from Friel)") — rendered in mute below the
    /// brand-green hint, mirroring the web's AnchorCard.
    var subhint: String? = nil
    /// When `true`, surfaces a tiny EDIT chip in the bottom-right of the
    /// card. Mirrors the EditableField pencil affordance on the web.
    /// Tap handling is the parent's job — the chip is purely visual.
    var editable: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(label)
                    .font(.body(11, weight: .bold))
                    .tracking(1.4)
                    .foregroundStyle(Theme.mute)
                    .textCase(.uppercase)
                Spacer(minLength: 4)
                if editable {
                    Text("EDIT")
                        .font(.body(9, weight: .bold))
                        .tracking(1.2)
                        .foregroundStyle(Theme.green)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 3)
                        .overlay(Capsule().stroke(Theme.green.opacity(0.35), lineWidth: 1))
                        .clipShape(Capsule())
                }
            }
            Text(value)
                .font(.display(24))
                .tracking(0.5)
                .foregroundStyle(Theme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            if let hint, !hint.isEmpty {
                Text(hint)
                    .font(.body(10, weight: .semibold))
                    .tracking(1.0)
                    .foregroundStyle(Theme.green)
                    .textCase(.uppercase)
            }
            if let subhint, !subhint.isEmpty {
                Text(subhint)
                    .font(.body(11))
                    .foregroundStyle(Theme.mute)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Theme.card)
        .overlay(RoundedRectangle(cornerRadius: Theme.rCard).stroke(Theme.line, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
    }
}
