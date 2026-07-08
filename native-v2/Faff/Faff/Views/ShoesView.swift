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
    /// P2-37 · shoe being edited (Edit action) or nil.
    @State private var editingShoe: Shoe? = nil
    /// P2-37 · pending delete confirmation — destructive, so confirm first.
    @State private var deleteCandidate: Shoe? = nil
    @State private var actionError: String? = nil

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

                    if let err = actionError {
                        Text(err)
                            .font(.body(12, weight: .semibold))
                            .foregroundStyle(Theme.over)
                            .padding(.horizontal, 22)
                            .padding(.top, 10)
                            .frame(maxWidth: .infinity, alignment: .leading)
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
        // P2-37 · reuses AddShoeSheet's field layout in edit mode.
        .sheet(item: $editingShoe) { shoe in
            AddShoeSheet(editing: shoe) {
                Task { await reloadShoes() }
            }
        }
        .confirmationDialog(
            "Delete \(deleteCandidate?.displayName ?? "this shoe")?",
            isPresented: Binding(get: { deleteCandidate != nil }, set: { if !$0 { deleteCandidate = nil } }),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let s = deleteCandidate { Task { await performDelete(s) } }
            }
            Button("Cancel", role: .cancel) { deleteCandidate = nil }
        } message: {
            Text("This removes the shoe and its mileage history. Runs already logged with it keep their record.")
        }
    }

    private func reloadShoes() async {
        if let resp = try? await API.fetchShoes() {
            shoes = resp.shoes ?? []
        }
    }

    /// P2-37 · toggle retired. Optimistic: flips locally, reverts + shows
    /// the error inline on failure (same discipline as SettingsView.save).
    private func toggleRetired(_ shoe: Shoe) {
        let newVal = !(shoe.retired ?? false)
        setLocalRetired(id: shoe.id, retired: newVal)
        Task {
            do {
                try await API.patchShoe(id: shoe.id, fields: ["retired": newVal])
            } catch {
                setLocalRetired(id: shoe.id, retired: !newVal)
                await MainActor.run { actionError = "Couldn't update that shoe. Check your connection." }
            }
        }
    }

    private func setLocalRetired(id: Int, retired: Bool) {
        guard let idx = shoes.firstIndex(where: { $0.id == id }) else { return }
        let s = shoes[idx]
        shoes[idx] = Shoe(id: s.id, brand: s.brand, model: s.model, color: s.color,
                           mileage: s.mileage, mileage_cap: s.mileage_cap, run_types: s.run_types,
                           baseline_mi: s.baseline_mi, retired: retired, preferred: s.preferred, notes: s.notes)
    }

    /// P2-37 · mark as the preferred/race shoe. Server doesn't enforce
    /// exclusivity, so clear any other preferred pair locally + server-side
    /// first (only one "preferred" pill should show at a time).
    private func setPreferred(_ shoe: Shoe) {
        let others = shoes.filter { $0.preferred == true && $0.id != shoe.id }
        Task {
            for o in others {
                try? await API.patchShoe(id: o.id, fields: ["preferred": false])
            }
            do {
                try await API.patchShoe(id: shoe.id, fields: ["preferred": true])
                await reloadShoes()
            } catch {
                await MainActor.run { actionError = "Couldn't set the race shoe. Check your connection." }
            }
        }
    }

    private func performDelete(_ shoe: Shoe) async {
        deleteCandidate = nil
        do {
            try await API.deleteShoe(id: shoe.id)
            await MainActor.run { shoes.removeAll { $0.id == shoe.id } }
        } catch {
            await MainActor.run { actionError = "Couldn't delete that shoe. Check your connection." }
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
                    .contentShape(Rectangle())
                    .contextMenu { shoeActions(shoe) }
            }
            if active.isEmpty {
                ShoeDetail(shoe: FaffShoe(id: "ph", brand: "", name: "Add your first shoe",
                                         roles: ["EASY"], miles: 0, lifeMi: 450))
                    .opacity(0.4)
            }
        }
    }

    /// P2-37 · long-press actions — Retire, Edit, Mark race shoe, Delete.
    /// No swipe actions here (rows live in a VStack/ScrollView, not a
    /// List, so .swipeActions doesn't apply) — context menu is the
    /// standard SwiftUI escape hatch for non-List row actions.
    @ViewBuilder
    private func shoeActions(_ shoe: Shoe) -> some View {
        Button { editingShoe = shoe } label: {
            Label("Edit", systemImage: "pencil")
        }
        if shoe.preferred != true {
            Button { setPreferred(shoe) } label: {
                Label("Mark race shoe", systemImage: "star")
            }
        }
        Button { toggleRetired(shoe) } label: {
            if shoe.retired ?? false {
                Label("Unretire", systemImage: "arrow.uturn.backward")
            } else {
                Label("Retire", systemImage: "archivebox")
            }
        }
        Button(role: .destructive) { deleteCandidate = shoe } label: {
            Label("Delete", systemImage: "trash")
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
                    .contentShape(Rectangle())
                    .contextMenu { shoeActions(shoe) }
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
    /// P2-37 · non-nil = editing an existing shoe (PATCH instead of POST,
    /// fields pre-seeded, sheet title + button copy flip to "Save").
    var editing: Shoe? = nil
    var onSaved: () -> Void

    @State private var brand: String
    @State private var model: String
    @State private var selectedRoles: Set<String>
    @State private var mileageCap: String
    @State private var baselineMi: String
    @State private var saving = false
    @State private var errorMsg: String? = nil

    private let allRoles = ["EASY", "LONG", "TEMPO", "INTERVALS", "RACE", "RECOVERY"]

    init(editing: Shoe? = nil, onSaved: @escaping () -> Void) {
        self.editing = editing
        self.onSaved = onSaved
        _brand = State(initialValue: editing?.brand ?? "")
        _model = State(initialValue: editing?.model ?? "")
        let seededRoles = Set((editing?.run_types ?? ["easy"]).map { $0.uppercased() })
        _selectedRoles = State(initialValue: seededRoles.isEmpty ? ["EASY"] : seededRoles)
        _mileageCap = State(initialValue: editing.flatMap { $0.mileage_cap.map { String(Int($0)) } } ?? "400")
        _baselineMi = State(initialValue: editing.flatMap { $0.baseline_mi.map { String(Int($0)) } } ?? "0")
    }

    /// P3-14 · UI implies model is optional but POST /api/shoe 400s
    /// without it. Require it client-side so the disabled state and the
    /// error copy tell the truth instead of blaming the network.
    private var modelMissing: Bool { model.trimmingCharacters(in: .whitespaces).isEmpty }

    var body: some View {
        ZStack {
            Color(hex: 0x16110D).ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 24) {

                    // Header
                    HStack {
                        SpecLabel(text: editing == nil ? "ADD A SHOE" : "EDIT SHOE", size: 13, tracking: 2.5, color: Theme.txt)
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

                    // Model · required server-side (P3-14) — labeled so the
                    // requirement is visible instead of a network-flavored
                    // error after the fact.
                    fieldGroup(label: "MODEL · REQUIRED") {
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

                    // Save button · disabled when brand OR model is empty
                    // (P3-14 — model is server-required, not optional).
                    Button {
                        Task { await save() }
                    } label: {
                        Text(saving ? "SAVING…" : (editing == nil ? "ADD SHOE" : "SAVE CHANGES"))
                            .font(.body(14, weight: .extraBold))
                            .tracking(0.5)
                            .foregroundStyle(saving || brand.trimmingCharacters(in: .whitespaces).isEmpty || modelMissing
                                             ? Theme.txt.opacity(0.4) : Theme.txt)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(
                                RoundedRectangle(cornerRadius: 16, style: .continuous)
                                    .fill(Color.white.opacity(saving || brand.trimmingCharacters(in: .whitespaces).isEmpty || modelMissing ? 0.05 : 0.12))
                            )
                    }
                    .disabled(saving || brand.trimmingCharacters(in: .whitespaces).isEmpty || modelMissing)
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
        guard !modelMissing else {
            errorMsg = "Model is required."
            return
        }
        saving = true
        errorMsg = nil
        let runTypes = allRoles.filter { selectedRoles.contains($0) }.map { $0.lowercased() }
        let cap = Double(mileageCap) ?? 400
        let baseline = Double(baselineMi) ?? 0
        do {
            if let editing {
                // P2-37 · edit path — PATCH the changed fields onto the
                // existing shoe id instead of creating a new row.
                try await API.patchShoe(id: editing.id, fields: [
                    "brand": brand.trimmingCharacters(in: .whitespaces),
                    "model": model.trimmingCharacters(in: .whitespaces),
                    "run_types": runTypes,
                    "mileage_cap": cap,
                    "baseline_mi": baseline,
                ])
            } else {
                try await API.createShoe(
                    brand: brand.trimmingCharacters(in: .whitespaces),
                    model: model.trimmingCharacters(in: .whitespaces),
                    runTypes: runTypes,
                    mileageCap: cap,
                    baselineMi: baseline
                )
            }
            onSaved()
            dismiss()
        } catch {
            errorMsg = "Failed to save. Check your connection and try again."
            saving = false
        }
    }
}
