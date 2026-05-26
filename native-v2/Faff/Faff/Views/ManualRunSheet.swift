//
//  ManualRunSheet.swift
//  P29 — iPhone parity with web /log "log a run" form.
//  POSTs /api/run/manual. Auto-merge fires on the server.
//

import SwiftUI

struct ManualRunSheet: View {
    @Environment(\.dismiss) private var dismiss

    @State private var date: Date = Date()
    @State private var distanceMi: String = ""
    @State private var durationMin: String = ""
    @State private var avgHrBpm: String = ""
    @State private var elevGainFt: String = ""
    @State private var name: String = ""
    @State private var notes: String = ""

    @State private var saving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Run") {
                    DatePicker("Date", selection: $date, displayedComponents: [.date])
                    HStack {
                        Text("Distance (mi)")
                        Spacer()
                        TextField("5.0", text: $distanceMi)
                            .multilineTextAlignment(.trailing)
                            .keyboardType(.decimalPad)
                            .frame(maxWidth: 110)
                    }
                    HStack {
                        Text("Duration (min)")
                        Spacer()
                        TextField("42", text: $durationMin)
                            .multilineTextAlignment(.trailing)
                            .keyboardType(.decimalPad)
                            .frame(maxWidth: 110)
                    }
                }

                Section("Optional") {
                    HStack {
                        Text("Avg HR")
                        Spacer()
                        TextField("142", text: $avgHrBpm)
                            .multilineTextAlignment(.trailing)
                            .keyboardType(.numberPad)
                            .frame(maxWidth: 110)
                    }
                    HStack {
                        Text("Elev gain (ft)")
                        Spacer()
                        TextField("180", text: $elevGainFt)
                            .multilineTextAlignment(.trailing)
                            .keyboardType(.numberPad)
                            .frame(maxWidth: 110)
                    }
                    HStack {
                        Text("Name")
                        Spacer()
                        TextField("Easy 5mi", text: $name)
                            .multilineTextAlignment(.trailing)
                            .frame(maxWidth: 180)
                    }
                    TextField("Notes (felt good, wind, etc.)", text: $notes, axis: .vertical)
                        .lineLimit(2...4)
                }

                if let error {
                    Section { Text(error).foregroundStyle(Theme.over) }
                }
            }
            .navigationTitle("Log a run")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(saving ? "Saving…" : "Save") { Task { await save() } }
                        .disabled(saving || !canSave)
                        .foregroundStyle(canSave ? Theme.green : Theme.mute)
                }
            }
        }
    }

    private var canSave: Bool {
        Double(distanceMi) != nil && Double(durationMin) != nil
    }

    private func save() async {
        saving = true; defer { saving = false }
        do {
            let f = DateFormatter()
            f.locale = Locale(identifier: "en_US_POSIX")
            f.dateFormat = "yyyy-MM-dd"
            var body: [String: Any] = [
                "date": f.string(from: date),
                "distance_mi": Double(distanceMi) ?? 0,
                "duration_min": Double(durationMin) ?? 0,
                "source": "manual",
            ]
            if !name.isEmpty { body["name"] = name }
            if let hr = Int(avgHrBpm) { body["avg_hr_bpm"] = hr }
            if let el = Int(elevGainFt) { body["elev_gain_ft"] = el }
            if !notes.isEmpty { body["notes"] = notes }
            try await API.submitManualRun(body)
            dismiss()
        } catch {
            self.error = "Couldn't save: \(error.localizedDescription)"
        }
    }
}
