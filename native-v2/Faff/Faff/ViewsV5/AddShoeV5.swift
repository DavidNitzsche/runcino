//
//  AddShoeV5.swift
//  faff.run iPhone · screen 21a, "Add a shoe".
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE TYPE LIST IS THE ENGINE'S, NOT THE DESIGN'S
//
//  The 0821 handoff ships eight placeholder types and says so in its own
//  caption: "swap for Research/17's real types and retirement bands before
//  ship." These are those eight, in the engine's own labels, and the keys are
//  the ones `POST /api/shoe` validates against — it rejects an unknown
//  `shoe_type` outright, so a placeholder string would have been a write that
//  always failed.
//
//  Each type binds to one row of `Research/17-footwear.md` § "Mileage Lifespan
//  by Category", and CI asserts every band against that table. Picking the
//  wrong one is not cosmetic: it is the difference between being told to
//  retire a shoe at 150 miles and at 600.
//
//  NO BAND OR RETIREMENT NUMBER APPEARS ON THIS SCREEN. That is deliberate and
//  the handoff is explicit about it — the same rule screen 11a already
//  follows. The engine owns those figures; a number typed here would be a
//  second source of truth for something that is already gated.
//
//  ─────────────────────────────────────────────────────────────────────────
//  ONE NAME FIELD, TWO WIRE FIELDS
//
//  The design asks for a single "Name" ("e.g. Vaporfly 3"). The shoes table
//  keeps brand and model apart, and the Shoes screen renders them joined. So
//  the first word is the brand and the rest is the model — which is exactly
//  how the existing rows already read: "Asics" + "Novablast 5", "NB" + "SC
//  Trainer v3 - red".
//

import SwiftUI

struct AddShoeV5: View {
    var onCancel: () -> Void = {}
    /// Name, shoe-type key, and starting mileage. The caller writes.
    var onAdd: (_ brand: String, _ model: String, _ shoeType: String, _ startMi: Double) -> Void = { _, _, _, _ in }

    @State private var name: String = ""
    @State private var typeLabel: String = AddShoeV5.types[0].label
    @State private var startMi: String = ""

    /// `Research/17-footwear.md` § "Mileage Lifespan by Category", via
    /// `web-v2/lib/shoe/lifespan.ts`. Keys are what the API validates.
    static let types: [(key: String, label: String)] = [
        ("daily_trainer", "Daily trainer"),
        ("max_cushion",   "Max cushion"),
        ("stability",     "Stability"),
        ("trail",         "Trail"),
        ("tempo_trainer", "Tempo trainer"),
        ("super_shoe",    "Super shoe"),
        ("racing_flat",   "Racing flat"),
        ("track_spike",   "Track spike"),
    ]

    private var trimmedName: String { name.trimmingCharacters(in: .whitespaces) }

    /// First word is the brand, the rest is the model. A single word is a
    /// brand with no model rather than the other way round, so the Shoes list
    /// still reads as a name.
    private var split: (brand: String, model: String) {
        let parts = trimmedName.split(separator: " ", maxSplits: 1,
                                      omittingEmptySubsequences: true).map(String.init)
        return (parts.first ?? "", parts.count > 1 ? parts[1] : "")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: V5.S.s20) {
            header

            // The middle scrolls; the header above and the action below stay
            // put. Matches the design's own flex column, and means a keyboard
            // or a longer type list never pushes the primary action away.
            ScrollView {
                VStack(alignment: .leading, spacing: V5.S.s16) {
                FaffInput(label: "Name", text: $name, placeholder: "e.g. Vaporfly 3")

                FaffSelect(label: "Shoe type",
                           value: typeLabel,
                           options: Self.types.map(\.label),
                           onChange: { typeLabel = $0 })

                FaffInput(label: "Starting mileage",
                          text: $startMi,
                          placeholder: "0 \u{00B7} already broken in",
                          keyboard: .decimalPad)
                }
                .padding(.horizontal, 2)
            }
            .scrollIndicators(.hidden)
            .frame(maxHeight: .infinity, alignment: .top)

            FaffButton("Add to rotation", variant: .primary, size: .lg, full: true,
                       enabled: !trimmedName.isEmpty,
                       disabledReason: "Name the shoe first \u{b7} brand and model is enough.") {
                let key = Self.types.first { $0.label == typeLabel }?.key ?? "daily_trainer"
                onAdd(split.brand, split.model, key, Double(startMi) ?? 0)
            }
        }
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            Button("Cancel", action: onCancel)
                .font(.faffText(TypeScaleV5.body15, weight: .semibold))
                .foregroundStyle(V5.textSecondary)
            Spacer(minLength: V5.S.s8)
            Text("Add a shoe")
                .font(.faffDisplay(17))
                .foregroundStyle(V5.textPrimary)
            Spacer(minLength: V5.S.s8)
            // The design's own 52px spacer, so the title sits centred against
            // Cancel rather than drifting right.
            Color.clear.frame(width: 52, height: 1)
        }
        .padding(.horizontal, V5.S.s4)
    }
}
