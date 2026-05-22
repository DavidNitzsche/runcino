//
//  ShoeEditSheet.swift
//  Faff
//
//  Add / edit a shoe, mirrors the web /profile shoe modal: brand, model,
//  color, mileage, cap, run types, preferred, retired. Saves via
//  POST /api/shoes (new) or PUT /api/shoes/[id] (edit).
//

import SwiftUI

struct ShoeEditSheet: View {
    let shoe: Shoe?
    var onSaved: () -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var brand: String
    @State private var model: String
    @State private var colorHex: String
    @State private var mileage: String
    @State private var cap: String
    @State private var runTypes: Set<String>
    @State private var preferred: Bool
    @State private var retired: Bool
    @State private var working = false
    @State private var error: String?

    private var isEdit: Bool { shoe != nil }

    // Run-type options + colour swatches mirror the web modal.
    private let runTypeOptions: [(String, String)] = [
        ("easy", "Easy"), ("long", "Long"), ("recovery", "Recovery"),
        ("tempo", "Tempo"), ("intervals", "Intervals"), ("race", "Race"), ("as_needed", "As needed"),
    ]
    private let swatches: [UInt32] = [0x2CA82F, 0xD4900A, 0xE85D26, 0x2563EB, 0x0D0F12, 0x8B5CF6]

    init(shoe: Shoe?, onSaved: @escaping () -> Void) {
        self.shoe = shoe
        self.onSaved = onSaved
        _brand = State(initialValue: shoe?.brand ?? "")
        _model = State(initialValue: shoe?.model ?? "")
        _colorHex = State(initialValue: shoe?.color ?? "#2CA82F")
        _mileage = State(initialValue: String(Int(shoe?.mileage ?? 0)))
        _cap = State(initialValue: String(Int(shoe?.mileageCap ?? 400)))
        _runTypes = State(initialValue: Set(shoe?.runTypes ?? []))
        _preferred = State(initialValue: shoe?.preferred ?? true)
        _retired = State(initialValue: shoe?.retired ?? false)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Faff.S.rowGap) {
                SheetGrabHandle()
                HStack(alignment: .top) {
                    Text(isEdit ? "EDIT SHOE" : "ADD SHOE")
                        .font(Faff.F.inter(10, .semibold)).tracking(2).foregroundStyle(Faff.C.textDim)
                    Spacer()
                    SheetCloseButton { dismiss() }
                }

                VStack(alignment: .leading, spacing: 14) {
                    field("Brand", text: $brand, placeholder: "Nike")
                    field("Model", text: $model, placeholder: "Vaporfly 3")
                    HStack(spacing: Faff.S.inlineGap) {
                        numField("Mileage", text: $mileage, unit: "mi")
                        numField("Retire at", text: $cap, unit: "mi")
                    }
                    // Colour
                    VStack(alignment: .leading, spacing: 6) {
                        Text("COLOUR").font(Faff.F.inter(9, .semibold)).tracking(1).foregroundStyle(Faff.C.textDim)
                        HStack(spacing: 10) {
                            ForEach(swatches, id: \.self) { hex in
                                let sel = colorHex.lowercased() == String(format: "#%06x", hex)
                                Circle().fill(Color(hex: hex)).frame(width: 26, height: 26)
                                    .overlay(Circle().stroke(Faff.C.ink, lineWidth: sel ? 2.5 : 0))
                                    .overlay(Circle().stroke(Faff.C.pillLine, lineWidth: sel ? 0 : 1))
                                    .onTapGesture { colorHex = String(format: "#%06x", hex) }
                            }
                        }
                    }
                    // Run types
                    VStack(alignment: .leading, spacing: 6) {
                        Text("RUN TYPES").font(Faff.F.inter(9, .semibold)).tracking(1).foregroundStyle(Faff.C.textDim)
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 84), spacing: 8)], alignment: .leading, spacing: 8) {
                            ForEach(runTypeOptions, id: \.0) { value, label in
                                let on = runTypes.contains(value)
                                Text(label).font(Faff.F.inter(12, .semibold))
                                    .foregroundStyle(on ? .white : Faff.C.ink)
                                    .frame(maxWidth: .infinity).padding(.vertical, 8)
                                    .background(on ? Faff.C.ink : Faff.C.pillBg, in: Capsule())
                                    .overlay(Capsule().stroke(Faff.C.pillLine, lineWidth: on ? 0 : 1))
                                    .onTapGesture {
                                        if on { runTypes.remove(value) } else { runTypes.insert(value) }
                                    }
                            }
                        }
                    }
                    Toggle(isOn: $preferred) {
                        Text("Preferred").font(Faff.F.inter(13, .semibold)).foregroundStyle(Faff.C.ink)
                    }.tint(Faff.C.recovery)
                    if isEdit {
                        Toggle(isOn: $retired) {
                            Text("Retired").font(Faff.F.inter(13, .semibold)).foregroundStyle(Faff.C.ink)
                        }.tint(Faff.C.warn)
                    }
                }.faffCard()

                if let e = error { Text(e).font(Faff.F.inter(12)).foregroundStyle(Faff.C.warn) }

                PrimaryButton(title: working ? "Saving…" : (isEdit ? "Save changes" : "Add shoe"),
                              icon: nil) { Task { await save() } }
                    .disabled(working || brand.trimmingCharacters(in: .whitespaces).isEmpty || model.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding(.horizontal, Faff.S.pageEdge).padding(.bottom, Faff.S.scrollBottom)
        }
        .background(Faff.C.bg.ignoresSafeArea())
    }

    private func field(_ label: String, text: Binding<String>, placeholder: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label.uppercased()).font(Faff.F.inter(9, .semibold)).tracking(1).foregroundStyle(Faff.C.textDim)
            TextField(placeholder, text: text)
                .font(Faff.F.inter(15)).foregroundStyle(Faff.C.ink)
                .padding(.horizontal, 12).padding(.vertical, 10)
                .background(Faff.C.pillBg, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Faff.C.pillLine, lineWidth: 1))
        }
    }
    private func numField(_ label: String, text: Binding<String>, unit: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label.uppercased()).font(Faff.F.inter(9, .semibold)).tracking(1).foregroundStyle(Faff.C.textDim)
            HStack(spacing: 4) {
                TextField("0", text: text).font(Faff.F.display(18)).foregroundStyle(Faff.C.ink)
                    .keyboardType(.numberPad)
                Text(unit).font(Faff.F.inter(11)).foregroundStyle(Faff.C.textDim)
            }
            .padding(.horizontal, 12).padding(.vertical, 9)
            .background(Faff.C.pillBg, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Faff.C.pillLine, lineWidth: 1))
        }
    }

    private func save() async {
        let mileageNum = Double(mileage) ?? 0
        let capNum = Double(cap) ?? 400
        guard mileageNum >= 0, mileageNum <= 5000 else { error = "Mileage must be 0–5000."; return }
        guard capNum >= 50, capNum <= 2000 else { error = "Retire-at must be 50–2000 mi."; return }
        working = true; defer { working = false }
        let body: [String: Any] = [
            "brand": brand.trimmingCharacters(in: .whitespaces),
            "model": model.trimmingCharacters(in: .whitespaces),
            "color": colorHex,
            "run_types": Array(runTypes),
            "mileage": mileageNum,
            "mileage_cap": capNum,
            "preferred": preferred,
            "retired": retired,
        ]
        do {
            if let s = shoe { try await ShoesAPI.update(id: s.id, body) }
            else { try await ShoesAPI.create(body) }
            onSaved()
            dismiss()
        } catch {
            self.error = "Couldn't save. Try again."
        }
    }
}
