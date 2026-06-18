//
//  ShoesView.swift
//  Shoe Garage · in-rotation cards + retired pile.
//

import SwiftUI

struct ShoesView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var shoes: [Shoe] = []
    @State private var loaded = false
    @State private var showAddShoe = false

    private let mesh = FaffMesh(
        c1: 0x7A3A18, c2: 0x1F5A64, c3: 0x5E2F12,
        c4: 0x16110D, c5: 0x16110D, base: 0x16110D
    )

    var body: some View {
        ZStack {
            // Neutral black/grey mesh, matching every tab + Profile/Settings.
            // The warm shoe mesh read as an off-palette brown page (David).
            FaffMeshView(mesh: .neutral)

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
                await reloadShoes()
            }
        }
        .sheet(isPresented: $showAddShoe) {
            AddShoeSheet {
                Task { await reloadShoes() }
            }
        }
    }

    private func reloadShoes() async {
        if let resp = try? await API.fetchShoes() {
            shoes = resp.shoes ?? []
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
                 tint: retireSoon > 0 ? Color(hex: 0xF3AD38) : Theme.txt)
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
                ShoeDetail(shoe: FaffShoe(id: "ph", brand: "", name: "Add your first shoe",
                                         roles: ["EASY"], miles: 0, lifeMi: 450))
                    .opacity(0.4)
            }
        }
    }

    private var addShoeButton: some View {
        Button {
            showAddShoe = true
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
        let rawRoles = s.run_types ?? []
        let roles = rawRoles.isEmpty ? ["EASY"] : rawRoles.map { $0.uppercased() }
        return FaffShoe(
            id: "\(s.id)",
            brand: s.brand ?? "",
            name: s.displayName.isEmpty ? "Shoe \(s.id)" : s.displayName,
            roles: roles,
            miles: s.mileage ?? 0,
            lifeMi: s.mileage_cap ?? 450,
            retired: retired,
            note: s.notes
        )
    }

    private func formatMileage(_ mi: Double) -> String {
        let v = Int(mi.rounded())
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        return formatter.string(from: NSNumber(value: v)) ?? "\(v)"
    }
}

// MARK: - Add Shoe Sheet

struct AddShoeSheet: View {
    @Environment(\.dismiss) private var dismiss
    var onSaved: () -> Void

    @State private var brand = ""
    @State private var model = ""
    @State private var selectedRoles: Set<String> = ["EASY"]
    @State private var mileageCap: String = "400"
    @State private var baselineMi: String = "0"
    @State private var saving = false
    @State private var errorMsg: String? = nil

    private let allRoles = ["EASY", "LONG", "TEMPO", "INTERVALS", "RACE", "RECOVERY"]

    var body: some View {
        ZStack {
            Color(hex: 0x16110D).ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 24) {

                    // Header
                    HStack {
                        SpecLabel(text: "ADD A SHOE", size: 13, tracking: 2.5, color: Theme.txt)
                        Spacer()
                        Button { dismiss() } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(Theme.txt.opacity(0.6))
                                .padding(10)
                        }
                    }
                    .padding(.top, 20)

                    // Brand
                    fieldGroup(label: "BRAND") {
                        styledTextField("e.g. Nike", text: $brand)
                    }

                    // Model
                    fieldGroup(label: "MODEL") {
                        styledTextField("e.g. Vaporfly 3", text: $model)
                    }

                    // Roles multi-select
                    VStack(alignment: .leading, spacing: 10) {
                        SpecLabel(text: "ROLES", size: 9, tracking: 1.5, color: Theme.txt.opacity(0.55))
                        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                            ForEach(allRoles, id: \.self) { role in
                                roleChip(role)
                            }
                        }
                    }

                    // Mileage cap
                    fieldGroup(label: "SHOE LIFE (MI)") {
                        styledTextField("400", text: $mileageCap)
                            .keyboardType(.decimalPad)
                    }

                    // Baseline miles
                    fieldGroup(label: "MILES BEFORE APP") {
                        styledTextField("0", text: $baselineMi)
                            .keyboardType(.decimalPad)
                    }

                    // Save button
                    Button {
                        Task { await save() }
                    } label: {
                        Text(saving ? "SAVING…" : "ADD SHOE")
                            .font(.body(14, weight: .extraBold))
                            .tracking(0.5)
                            .foregroundStyle(saving || brand.trimmingCharacters(in: .whitespaces).isEmpty
                                             ? Theme.txt.opacity(0.4) : Theme.txt)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(
                                RoundedRectangle(cornerRadius: 16, style: .continuous)
                                    .fill(Color.white.opacity(saving || brand.trimmingCharacters(in: .whitespaces).isEmpty ? 0.05 : 0.12))
                            )
                    }
                    .disabled(saving || brand.trimmingCharacters(in: .whitespaces).isEmpty)
                    .buttonStyle(.plain)

                    if let err = errorMsg {
                        Text(err)
                            .font(.body(12, weight: .semibold))
                            .foregroundStyle(Theme.over)
                    }

                    Spacer(minLength: 40)
                }
                .padding(.horizontal, 22)
            }
        }
    }

    @ViewBuilder
    private func fieldGroup<Content: View>(label: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SpecLabel(text: label, size: 9, tracking: 1.5, color: Theme.txt.opacity(0.55))
            content()
        }
    }

    private func styledTextField(_ placeholder: String, text: Binding<String>) -> some View {
        TextField(placeholder, text: text)
            .font(.body(15, weight: .semibold))
            .foregroundStyle(Theme.txt)
            .padding(.horizontal, 14)
            .padding(.vertical, 13)
            .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(Color.white.opacity(0.15), lineWidth: 1))
    }

    @ViewBuilder
    private func roleChip(_ role: String) -> some View {
        let on = selectedRoles.contains(role)
        let eff = FaffEffort.fromType(role)
        Button { toggleRole(role) } label: {
            Text(role)
                .font(.body(11, weight: .extraBold))
                .tracking(0.3)
                .foregroundStyle(on ? eff.dot : Theme.txt.opacity(0.5))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(on ? eff.dot.opacity(0.18) : Color.white.opacity(0.06))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(on ? eff.dot.opacity(0.5) : Color.white.opacity(0.12), lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }

    private func toggleRole(_ role: String) {
        if selectedRoles.contains(role) {
            // Keep at least one selected
            if selectedRoles.count > 1 { selectedRoles.remove(role) }
        } else {
            selectedRoles.insert(role)
        }
    }

    private func save() async {
        saving = true
        errorMsg = nil
        let runTypes = allRoles.filter { selectedRoles.contains($0) }.map { $0.lowercased() }
        let cap = Double(mileageCap) ?? 400
        let baseline = Double(baselineMi) ?? 0
        do {
            try await API.createShoe(
                brand: brand.trimmingCharacters(in: .whitespaces),
                model: model.trimmingCharacters(in: .whitespaces),
                runTypes: runTypes,
                mileageCap: cap,
                baselineMi: baseline
            )
            onSaved()
            dismiss()
        } catch {
            errorMsg = "Failed to save. Check your connection and try again."
            saving = false
        }
    }
}
