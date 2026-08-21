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
//  ─────────────────────────────────────────────────────────────────────────
//  "ADD A PAIR" — EXPAND IN PLACE, TYPE ONLY, NEVER A CAP NUMBER
//
//  The prototype draws "Add a pair" as a ghost button wired to a noop — the
//  handoff never specced what the form inside it holds. Built here as the
//  same expand-in-place idiom every other picker on this screen uses: the
//  button itself toggles a form beneath it, never a full-screen picker.
//
//  The form collects brand, model, and the shoe's TYPE — never a mileage cap
//  by default. Per the header above, the retirement band is `POST /api/shoe`'s
//  job to resolve from `shoe_type` (`web-v2/lib/shoe/lifespan.ts`), so this
//  screen sends the type and nothing else unless the runner types an explicit
//  override, which then travels as their own number, not a default this file
//  invented. That is also why the override field's helper text never states a
//  mileage figure — the one number this file is not allowed to know.
//

import SwiftUI

// MARK: - Shoe type, screen-local

/// Mirrors `web-v2/lib/shoe/lifespan.ts`'s `ShoeType`. Local to this screen —
/// it exists only so the picker has something to show; once picked it
/// travels to the server as the raw `shoe_type` string, which is the only
/// place the type→band mapping is allowed to live.
private enum ShoeTypeV5: String, CaseIterable, Identifiable {
    case dailyTrainer = "daily_trainer"
    case maxCushion = "max_cushion"
    case stability = "stability"
    case trail = "trail"
    case superShoe = "super_shoe"
    case racingFlat = "racing_flat"
    case tempoTrainer = "tempo_trainer"
    case trackSpike = "track_spike"

    var id: String { rawValue }

    /// Runner-facing name, matching `SHOE_LIFESPAN[type].label` server-side.
    var label: String {
        switch self {
        case .dailyTrainer: return "Daily trainer"
        case .maxCushion:   return "Max cushion"
        case .stability:    return "Stability"
        case .trail:        return "Trail"
        case .superShoe:    return "Super shoe"
        case .racingFlat:   return "Racing flat"
        case .tempoTrainer: return "Tempo trainer"
        case .trackSpike:   return "Track spike"
        }
    }

    static func matching(label: String) -> ShoeTypeV5? {
        allCases.first { $0.label == label }
    }
}

// MARK: - Screen

struct ShoesV5: View {
    let shoes: [Shoe]

    /// The id of the shoe to mark as worn. Fires even when the tapped shoe is
    /// already the one worn — same as the prototype, which does not special
    /// case re-confirming the current pair.
    let onWear: (Int) -> Void
    let onRetire: (Int) -> Void
    /// brand, model, shoe_type (raw `ShoeType` value), and an explicit
    /// mileage-cap override — nil unless the runner typed one. The caller
    /// (`ShoesHostV5`) does the actual `POST /api/shoe`; this file only
    /// collects the answers.
    /// Screen 21a's four fields. The last is STARTING MILEAGE — miles already
    /// on the shoe before faff saw it — not a retirement override. 21a shows
    /// no retirement figure at all; that band is the engine's.
    let onAddPair: (_ brand: String, _ model: String, _ shoeType: String, _ startMi: Double) -> Void
    var onBack: (() -> Void)? = nil

    /// Single-expansion accordion, same as the prototype's `shoeDetail`
    /// state — one card open at a time.
    @State private var openId: Int?

    // "Add a pair" form state.
    @State private var addingPair = false

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

                    FaffButton("Add a pair", variant: .ghost, size: .md, full: true) {
                        withAnimation(V5.Motion.sheet) { addingPair = true }
                    }

                    if !retired.isEmpty {
                        ListGroup(header: "Retired") {
                            ForEach(retired) { shoe in
                                // Same rule as the in-rotation card below: an
                                // unknown mileage is unreadable, not zero.
                                ListRow(label: shoe.displayName,
                                        value: .measured(FaffFmt.milesUnit(shoe.mileage)))
                            }
                        }
                    }
                }
                .padding(.horizontal, V5.S.gutter)
                .padding(.bottom, V5.S.s32)
            }
        }
        .background(V5.surfacePage)
        .overlay {
            V5SheetHost(isPresented: $addingPair, tall: true) {
                AddShoeV5(onCancel: { withAnimation(V5.Motion.sheet) { addingPair = false } },
                          onAdd: { brand, model, type, startMi in
                              onAddPair(brand, model, type, startMi)
                              withAnimation(V5.Motion.sheet) { addingPair = false }
                          })
            }
        }
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
                        // `?? "0 mi"` printed a hard, measured zero for a shoe
                        // whose mileage we could not read — the exact failure
                        // ValuesV5's optional overload exists to prevent, and
                        // the opposite of what the track two lines below does
                        // with the same nil. Nil is unreadable, never zero.
                        FaffValueText(.measured(FaffFmt.milesUnit(shoe.mileage)),
                                      font: .faffText(TypeScaleV5.label13),
                                      color: V5.textQuiet)
                    }
                    // `shoe.mileage` stays optional straight through to the
                    // track: a shoe with no logged mileage yet draws no
                    // marker, not a marker sitting dishonestly at zero.
                    RangeScale(mode: .progress,
                               min: 0, max: shoe.retireAtMi,
                               value: shoe.mileage,
                               // Both ends name the AXIS, not the shoe. "New"
                               // sat under the bar looking like a badge — a
                               // pair with 99 miles on it was labelled New —
                               // when all it ever meant was where the scale
                               // starts. It says so now. The left end must not
                               // repeat the mileage on the title row either;
                               // 0 is the origin, not this shoe's number.
                               endpoints: ("0 mi",
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

    // MARK: Add a pair
    //
    // Screen 21a is a TALL SHEET, not an expand-in-place tile: it is a form
    // with its own header and its own primary action, and the handoff draws
    // it pinned near the top of the screen with the body scrolling inside.
    // The old inline tile also asked for a "Retirement override" — the 0821
    // spec deliberately shows no band or retirement number here at all,
    // because that figure is the engine's and is CI-gated against Research/17.

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
        onAddPair: { _, _, _, _ in },
        onBack: {}
    )
    .preferredColorScheme(.dark)
}
