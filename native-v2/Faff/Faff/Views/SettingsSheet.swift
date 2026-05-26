//
//  SettingsSheet.swift
//  P29 — iPhone settings modal. Mirrors web SettingsModal:
//  units (distance/temp/pace), long-run day, rest day, quality days.
//  Plus profile-level editable fields: MaxHR, LTHR, height, gender,
//  experience level — these PATCH /api/profile, not /api/settings.
//

import SwiftUI

struct SettingsSheet: View {
    @Environment(\.dismiss) private var dismiss

    // /api/settings fields (per-user preferences)
    @State private var unitsDistance: String = "mi"        // "mi" | "km"
    @State private var unitsTemp: String = "F"             // "F" | "C"
    @State private var unitsPace: String = "min/mi"        // "min/mi" | "min/km"
    @State private var longRunDay: String = "saturday"
    @State private var restDay: String = "monday"

    // /api/profile fields (training-zone identity)
    @State private var maxHr: String = ""
    @State private var lthr: String = ""
    @State private var heightCm: String = ""
    @State private var gender: String = ""
    @State private var experienceLevel: String = ""
    @State private var crossBike: Bool = false
    @State private var crossSwim: Bool = false
    @State private var crossStrength: Bool = false
    @State private var crossOther: Bool = false

    @State private var loading = true
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Units") {
                    Picker("Distance", selection: $unitsDistance) {
                        Text("Miles").tag("mi")
                        Text("Kilometers").tag("km")
                    }
                    Picker("Temperature", selection: $unitsTemp) {
                        Text("Fahrenheit").tag("F")
                        Text("Celsius").tag("C")
                    }
                    Picker("Pace", selection: $unitsPace) {
                        Text("min / mi").tag("min/mi")
                        Text("min / km").tag("min/km")
                    }
                }

                Section("Training schedule") {
                    Picker("Long-run day", selection: $longRunDay) {
                        ForEach(weekdays, id: \.self) { d in Text(d.capitalized).tag(d) }
                    }
                    Picker("Rest day", selection: $restDay) {
                        ForEach(weekdays, id: \.self) { d in Text(d.capitalized).tag(d) }
                    }
                }

                Section("Training zones") {
                    HStack {
                        Text("Max HR")
                        Spacer()
                        TextField("e.g. 188", text: $maxHr)
                            .multilineTextAlignment(.trailing)
                            .keyboardType(.numberPad)
                            .frame(maxWidth: 100)
                    }
                    HStack {
                        Text("LTHR (Friel)")
                        Spacer()
                        TextField("e.g. 168", text: $lthr)
                            .multilineTextAlignment(.trailing)
                            .keyboardType(.numberPad)
                            .frame(maxWidth: 100)
                    }
                }

                Section("Profile") {
                    HStack {
                        Text("Height (cm)")
                        Spacer()
                        TextField("e.g. 178", text: $heightCm)
                            .multilineTextAlignment(.trailing)
                            .keyboardType(.numberPad)
                            .frame(maxWidth: 100)
                    }
                    Picker("Gender", selection: $gender) {
                        Text("—").tag("")
                        Text("Male").tag("male")
                        Text("Female").tag("female")
                    }
                    Picker("Experience", selection: $experienceLevel) {
                        Text("—").tag("")
                        Text("Beginner").tag("beginner")
                        Text("Intermediate").tag("intermediate")
                        Text("Advanced").tag("advanced")
                        Text("Advanced+").tag("advanced_plus")
                    }
                }

                Section("Cross-training") {
                    Text("Pick what you'd like the plan to include alongside running.")
                        .font(.caption)
                        .foregroundStyle(Theme.mute)
                    Toggle("Bike",     isOn: $crossBike)
                    Toggle("Swim",     isOn: $crossSwim)
                    Toggle("Strength", isOn: $crossStrength)
                    Toggle("Other",    isOn: $crossOther)
                }

                if let error {
                    Section { Text(error).foregroundStyle(Theme.over) }
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(saving ? "Saving…" : "Save") { Task { await save() } }
                        .disabled(saving)
                        .foregroundStyle(Theme.green)
                }
            }
            .task { await load() }
        }
    }

    private let weekdays = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"]

    private func load() async {
        defer { loading = false }
        if let s = try? await API.fetchSettings() {
            unitsDistance = s.units_distance ?? "mi"
            unitsTemp     = s.units_temp ?? "F"
            unitsPace     = s.units_pace ?? "min/mi"
            longRunDay    = s.long_run_day ?? "saturday"
            restDay       = s.rest_day ?? "monday"
        }
        if let p = try? await API.fetchProfile() {
            maxHr = p.hrmax_observed.map(String.init) ?? p.maxhr.map(String.init) ?? ""
            lthr  = p.lthr.map(String.init) ?? ""
            heightCm = p.height_cm.map { String(Int($0)) } ?? ""
            gender = p.gender ?? ""
            experienceLevel = p.experience_level ?? ""
            let modes = Set(p.cross_training_modes ?? [])
            crossBike = modes.contains("bike")
            crossSwim = modes.contains("swim")
            crossStrength = modes.contains("strength")
            crossOther = modes.contains("other")
        }
    }

    private func save() async {
        saving = true; defer { saving = false }
        do {
            try await API.patchSettings([
                "units_distance": unitsDistance,
                "units_temp":     unitsTemp,
                "units_pace":     unitsPace,
                "long_run_day":   longRunDay,
                "rest_day":       restDay,
            ])
            var profilePatch: [String: Any] = [:]
            if let n = Int(maxHr) { profilePatch["hrmax_observed"] = n }
            if let n = Int(lthr) { profilePatch["lthr"] = n }
            if let n = Int(heightCm) { profilePatch["height_cm"] = n }
            if !gender.isEmpty { profilePatch["gender"] = gender }
            if !experienceLevel.isEmpty { profilePatch["experience_level"] = experienceLevel }
            // Cross-training modes — always send the array (server treats
            // empty array as "off", non-empty as "I cross-train in these").
            var modes: [String] = []
            if crossBike { modes.append("bike") }
            if crossSwim { modes.append("swim") }
            if crossStrength { modes.append("strength") }
            if crossOther { modes.append("other") }
            profilePatch["cross_training_modes"] = modes

            if !profilePatch.isEmpty {
                try await API.updateProfile(profilePatch)
            }
            dismiss()
        } catch {
            self.error = "Couldn't save: \(error.localizedDescription)"
        }
    }
}
