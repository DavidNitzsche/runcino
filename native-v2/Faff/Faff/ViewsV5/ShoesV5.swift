//
//  ShoesV5.swift
//  faff.run iPhone · screen 11a.
//
//  AppBar + plain black background — the shell exception. A card per shoe in
//  rotation, expanding in place to "Wear these" / "Retire these", then a
//  ghost "Add a pair", then a quiet Retired list.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE RETIREMENT BAND IS A BACKEND CONCERN
//
//  `GET /api/shoe` returns a server-computed `retire_at_mi` per shoe
//  (resolved from the shoe's category against `Research/17-footwear.md`,
//  with the runner's own `mileage_cap` overriding it — see the doc comment
//  on `Shoe.retireAtMi` in `Models/Runs.swift`). This file reads that
//  resolved number and draws nothing else — no hardcoded figure from the
//  design doc, no client-side cap. `Shoe.retireAtMi` is the one number that
//  matters here.
//
//  ─────────────────────────────────────────────────────────────────────────
//  "NO CHEVRON ON A ROW THAT HAS NOTHING TO OPEN"
//
//  The retired list is mileage only — no progress bar (a retired shoe's
//  progress against its own cap is not a live question any more) and no
//  onTap, so `ListRow` draws no chevron. That is `ComponentsV5.ListRow`'s
//  own rule, not something this file has to enforce by hand.
//

import SwiftUI

// MARK: - Screen

struct ShoesV5: View {
    let shoes: [Shoe]

    /// The id of the shoe to mark as worn. Fires even when the tapped shoe is
    /// already the one worn — same as the prototype, which does not special
    /// case re-confirming the current pair.
    let onWear: (Int) -> Void
    let onRetire: (Int) -> Void
    let onAddPair: () -> Void
    var onBack: (() -> Void)? = nil

    /// Single-expansion accordion, same as the prototype's `shoeDetail`
    /// state — one card open at a time.
    @State private var openId: Int?

    private var inRotation: [Shoe] { shoes.filter { $0.retired != true } }
    private var retired: [Shoe] { shoes.filter { $0.retired == true } }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                AppBar(title: "Shoes", onBack: onBack)

                // The prototype's content band: `padding:0 16px 32px;gap:24px`.
                VStack(alignment: .leading, spacing: V5.S.s24) {
                    VStack(alignment: .leading, spacing: V5.S.s10) {
                        V5SectionLabel(text: "In rotation").padding(.horizontal, V5.S.s4)
                        VStack(spacing: V5.S.inGroup) {
                            ForEach(inRotation) { shoe in
                                shoeCard(shoe)
                            }
                        }
                    }

                    FaffButton("Add a pair", variant: .ghost, size: .md, full: true, action: onAddPair)

                    if !retired.isEmpty {
                        ListGroup(header: "Retired") {
                            ForEach(retired) { shoe in
                                ListRow(label: shoe.displayName,
                                        value: .measured(FaffFmt.milesUnit(shoe.mileage) ?? "0 mi"))
                            }
                        }
                    }
                }
                .padding(.horizontal, V5.S.gutter)
                .padding(.bottom, V5.S.s32)
            }
        }
        .background(V5.surfacePage)
        .scrollIndicators(.hidden)
    }

    // MARK: One card

    private func shoeCard(_ shoe: Shoe) -> some View {
        let open = openId == shoe.id
        let wearing = shoe.preferred == true

        return Tile {
            Button {
                withAnimation(V5.Motion.expand) { openId = open ? nil : shoe.id }
            } label: {
                VStack(alignment: .leading, spacing: V5.S.s12) {
                    HStack(alignment: .firstTextBaseline, spacing: V5.S.s12) {
                        Text(shoe.displayName)
                            .font(.faffText(16, weight: .semibold))
                            .foregroundStyle(V5.textPrimary)
                        Spacer(minLength: 0)
                        FaffValueText(.measured(FaffFmt.milesUnit(shoe.mileage) ?? "0 mi"),
                                      font: .faffText(TypeScaleV5.label13),
                                      color: V5.textQuiet)
                    }
                    // `shoe.mileage` stays optional straight through to the
                    // track: a shoe with no logged mileage yet draws no
                    // marker, not a marker sitting dishonestly at zero.
                    RangeScale(mode: .progress,
                               min: 0, max: shoe.retireAtMi,
                               value: shoe.mileage,
                               // The left endpoint used to repeat the shoe's
                               // mileage, which is already on the title row —
                               // "no content is ever printed twice on one
                               // screen". The scale starts at nothing and ends
                               // at the band; that is what the two ends mean.
                               endpoints: ("New",
                                           "\(Int(shoe.retireAtMi.rounded())) mi retirement"),
                               size: .s)
                }
            }
            .buttonStyle(V5PressStyle())

            if open {
                HStack(spacing: V5.S.s8) {
                    FaffButton(wearing ? "Wearing" : "Wear these",
                               variant: wearing ? .secondary : .primary,
                               size: .md, full: true) { onWear(shoe.id) }
                    FaffButton("Retire these", variant: .destructive, size: .md, full: true) {
                        onRetire(shoe.id)
                    }
                }
                .padding(.top, V5.S.s4)
            }
        }
    }
}

// MARK: - Preview

#Preview("Shoes · 11a") {
    ShoesV5(
        shoes: [
            Shoe(id: 1, brand: "Saucony", model: "Endorphin Speed 4", color: nil,
                 mileage: 214, mileage_cap: nil, shoe_type: "super", retire_at_mi: 250,
                 run_types: nil, baseline_mi: nil, retired: false, preferred: true, notes: nil),
            Shoe(id: 2, brand: "ASICS", model: "Novablast 5", color: nil,
                 mileage: 386, mileage_cap: nil, shoe_type: "daily_trainer", retire_at_mi: 400,
                 run_types: nil, baseline_mi: nil, retired: false, preferred: false, notes: nil),
            Shoe(id: 3, brand: "Nike", model: "Vaporfly 3", color: nil,
                 mileage: 58, mileage_cap: nil, shoe_type: "super", retire_at_mi: 250,
                 run_types: nil, baseline_mi: nil, retired: false, preferred: false, notes: nil),
            Shoe(id: 4, brand: "Nike", model: "Pegasus 40", color: nil,
                 mileage: 412, mileage_cap: nil, shoe_type: "daily_trainer", retire_at_mi: 400,
                 run_types: nil, baseline_mi: nil, retired: true, preferred: false, notes: nil)
        ],
        onWear: { _ in },
        onRetire: { _ in },
        onAddPair: {},
        onBack: {}
    )
    .preferredColorScheme(.dark)
}
