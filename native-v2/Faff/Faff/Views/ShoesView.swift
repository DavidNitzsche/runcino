//
//  ShoesView.swift
//  Shoe Garage · in-rotation cards + retired pile.
//

import SwiftUI

struct ShoesView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var shoes: [Shoe] = []
    @State private var loaded = false

    private let mesh = FaffMesh(
        c1: 0x7A3A18, c2: 0x1F5A64, c3: 0x5E2F12,
        c4: 0x16110D, c5: 0x16110D, base: 0x16110D
    )

    var body: some View {
        ZStack {
            FaffMeshView(mesh: mesh)

            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    header
                        .padding(.horizontal, 22)
                        .padding(.top, 50)
                    statsRow
                        .padding(.horizontal, 22)
                        .padding(.top, 20)

                    sectionLabel("IN ROTATION")
                        .padding(.horizontal, 22)
                        .padding(.top, 24)
                    rotationList
                        .padding(.horizontal, 22)
                        .padding(.top, 12)
                    addShoeButton
                        .padding(.horizontal, 22)
                        .padding(.top, 4)

                    if !retired.isEmpty {
                        sectionLabel("RETIRED")
                            .padding(.horizontal, 22)
                            .padding(.top, 24)
                        retiredList
                            .padding(.horizontal, 22)
                            .padding(.top, 12)
                    }

                    Spacer(minLength: 40)
                }
            }
        }
        .task {
            if !loaded {
                loaded = true
                let resp = try? await API.fetchShoes()
                shoes = resp?.shoes ?? []
            }
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            BackChip { dismiss() }
            SpecLabel(text: "SHOE GARAGE", size: 13, tracking: 2.5, color: Theme.txt)
            Spacer()
        }
    }

    private var active: [Shoe] { shoes.filter { !($0.retired ?? false) } }
    private var retired: [Shoe] { shoes.filter { $0.retired ?? false } }

    private var totalActiveMi: Double {
        active.reduce(0.0) { $0 + ($1.mileage ?? 0) }
    }

    private var retireSoon: Int {
        active.filter {
            guard let mi = $0.mileage, let cap = $0.mileage_cap, cap > 0 else { return false }
            return (mi / cap) > 0.85
        }.count
    }

    private var statsRow: some View {
        HStack(alignment: .top, spacing: 0) {
            stat(label: "ACTIVE PAIRS", value: "\(active.count)")
            stat(label: "FLEET MILES", value: formatMileage(totalActiveMi))
            stat(label: "RETIRE SOON",
                 value: "\(retireSoon)",
                 tint: retireSoon > 0 ? Color(hex: 0xFFCE8A) : Theme.txt)
        }
    }

    private func stat(label: String, value: String, tint: Color = Theme.txt) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            SpecLabel(text: label, size: 9, tracking: 1.5, color: Theme.txt.opacity(0.55))
            Text(value)
                .font(.display(22, weight: .semibold))
                .tracking(-0.5)
                .foregroundStyle(tint)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func sectionLabel(_ text: String) -> some View {
        HStack {
            SpecLabel(text: text, color: Theme.txt.opacity(0.55))
            Spacer()
        }
    }

    private var rotationList: some View {
        VStack(spacing: 11) {
            ForEach(active) { shoe in
                ShoeDetail(shoe: toFaffShoe(shoe))
            }
            if active.isEmpty {
                ShoeDetail(shoe: placeholderShoe(role: "EASY", name: "Add your first shoe", mi: 0, life: 450, ec: Theme.Shoe.easy))
                    .opacity(0.4)
            }
        }
    }

    private var addShoeButton: some View {
        Button {
            // Add-shoe flow not wired in v3 yet · placeholder.
        } label: {
            Text("+ ADD A SHOE")
                .font(.body(13, weight: .extraBold))
                .tracking(0.5)
                .foregroundStyle(Theme.txt)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(Color.white.opacity(0.08),
                            in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.26),
                                      style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
                )
        }
        .buttonStyle(.plain)
    }

    private var retiredList: some View {
        VStack(spacing: 11) {
            ForEach(retired) { shoe in
                ShoeDetail(shoe: toFaffShoe(shoe, retired: true))
            }
        }
    }

    private func toFaffShoe(_ s: Shoe, retired: Bool = false) -> FaffShoe {
        let role = inferRole(brand: s.brand, model: s.model, mileage: s.mileage ?? 0, cap: s.mileage_cap ?? 450)
        return FaffShoe(
            id: "\(s.id)",
            brand: s.brand ?? "",
            name: s.displayName.isEmpty ? "Shoe \(s.id)" : s.displayName,
            role: role,
            miles: s.mileage ?? 0,
            lifeMi: s.mileage_cap ?? 450,
            retired: retired,
            note: s.notes
        )
    }

    private func placeholderShoe(role: String, name: String, mi: Double, life: Double, ec: Color) -> FaffShoe {
        FaffShoe(id: "ph", brand: "", name: name, role: role, miles: mi, lifeMi: life, retired: false, note: nil)
    }

    private func inferRole(brand: String?, model: String?, mileage: Double, cap: Double) -> String {
        let name = "\(brand ?? "") \(model ?? "")".lowercased()
        if name.contains("vapor") || name.contains("alpha") || name.contains("metaspeed") { return "RACE" }
        if name.contains("tempo") || name.contains("zoom fly") { return "TEMPO" }
        if name.contains("long") || name.contains("superblast") { return "LONG" }
        if name.contains("recovery") || name.contains("nova") { return "RECOVERY" }
        return "EASY"
    }

    private func formatMileage(_ mi: Double) -> String {
        let v = Int(mi.rounded())
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        return formatter.string(from: NSNumber(value: v)) ?? "\(v)"
    }
}
