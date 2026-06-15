//
//  F_Sheets.swift
//  Family F · Entry sheets.
//
//  Components: SymptomReportSheet (Niggle | Sick toggle) · ReturnGateCard ·
//              LogNonRunSheet (Strength | Cross toggle) · NewGoalSheet.
//
//  ShoePickerSheet already exists (Run Detail picker) · reuse verbatim per
//  the design spec.
//
//  ManualHealthSheet is web-only (iOS gets these from HealthKit).
//

import SwiftUI

// MARK: - Common sheet chrome

private func sheetHeader(_ title: String, subtitle: String? = nil) -> some View {
    VStack(alignment: .leading, spacing: 6) {
        Capsule().fill(Color.white.opacity(0.18)).frame(width: 40, height: 4)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.top, 8)
        Text(title)
            .font(.display(22, weight: .bold))
            .foregroundStyle(Theme.txt)
            .padding(.top, 8)
        if let s = subtitle, !s.isEmpty {
            Text(s)
                .font(.body(12.5, weight: .medium))
                .foregroundStyle(Theme.mute)
        }
    }
    .padding(.horizontal, 24)
}

private struct SegToggle: View {
    let options: [String]
    @Binding var selectionIndex: Int

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(options.enumerated()), id: \.offset) { idx, label in
                Button { withAnimation(Theme.Motion.smooth) { selectionIndex = idx } } label: {
                    Text(label)
                        .font(.body(12, weight: .extraBold))
                        .tracking(0.6)
                        .foregroundStyle(selectionIndex == idx ? Theme.bg : Theme.txt)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(selectionIndex == idx ? Theme.txt : Color.clear)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(3)
        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 13))
        .overlay(RoundedRectangle(cornerRadius: 13).stroke(Theme.Glass.line, lineWidth: 1))
    }
}

private struct PickRow: View {
    let label: String
    let options: [String]
    @Binding var selection: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label.uppercased())
                .font(.body(9, weight: .extraBold)).tracking(1.4)
                .foregroundStyle(Theme.mute)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 7) {
                    ForEach(options, id: \.self) { o in
                        Button { selection = o } label: {
                            Text(o)
                                .font(.body(12.5, weight: .semibold))
                                .foregroundStyle(selection == o ? Theme.bg : Theme.txt)
                                .padding(.horizontal, 12).padding(.vertical, 8)
                                .background(
                                    Capsule().fill(selection == o ? Theme.txt : Theme.Glass.fill)
                                )
                                .overlay(
                                    Capsule().stroke(selection == o ? Theme.txt : Theme.Glass.line, lineWidth: 1)
                                )
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 1)
            }
        }
    }
}

private struct ScaleRow: View {
    let label: String
    let max: Int
    @Binding var selection: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label.uppercased())
                .font(.body(9, weight: .extraBold)).tracking(1.4)
                .foregroundStyle(Theme.mute)
            HStack(spacing: 5) {
                ForEach(1...max, id: \.self) { n in
                    Button { selection = n } label: {
                        Text("\(n)")
                            .font(.body(13, weight: .bold)).monospacedDigit()
                            .foregroundStyle(selection == n ? Theme.bg : Theme.txt)
                            .frame(width: 30, height: 30)
                            .background(
                                Circle().fill(selection == n ? scaleColor(n) : Theme.Glass.fill)
                            )
                            .overlay(
                                Circle().stroke(selection == n ? scaleColor(n) : Theme.Glass.line, lineWidth: 1)
                            )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
    private func scaleColor(_ n: Int) -> Color {
        if n <= 3 { return Theme.green }
        if n <= 6 { return Theme.goal }
        return Theme.over
    }
}

private struct PrimaryCta: View {
    let title: String
    var disabled: Bool = false
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.body(15, weight: .extraBold))
                .foregroundStyle(disabled ? Theme.mute : Theme.bg)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(disabled ? Color.white.opacity(0.12) : Theme.txt, in: RoundedRectangle(cornerRadius: 14))
        }
        .buttonStyle(.plain)
        .disabled(disabled)
    }
}

// MARK: - SymptomReportSheet
//
// Niggle | Sick toggle. Pairs the two entry surfaces cleanly per David's
// directive. Niggle routes Today to a niggle surface; Sick pauses the plan.
//
// Posts to /api/niggle or /api/sick depending on selection.

struct SymptomReportSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var tab: Int = 0       // 0 = niggle, 1 = sick
    // Niggle state
    @State private var bodyPart: String? = nil
    @State private var severity: Int = 3
    @State private var status: String? = "few_days"
    // Sick state
    @State private var symptoms: Set<String> = []
    // Submit state
    @State private var submitting: Bool = false
    @State private var error: String? = nil
    var onSubmitted: () -> Void = {}

    private let bodyParts = ["Calf", "Hamstring", "Knee", "Achilles", "Foot", "Hip", "Quad", "Lower back"]
    private let sickSymptoms = ["Sore throat", "Cough", "Fatigue", "Congestion", "Fever", "Body aches"]
    private let statusOptions: [(label: String, value: String)] = [
        ("Just started", "just_started"),
        ("Few days",     "few_days"),
        ("Weeks",        "weeks"),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            sheetHeader(
                "Log something",
                subtitle: tab == 1 ? "Logging sick pauses your plan until you're ready." : nil
            )
            VStack(alignment: .leading, spacing: 18) {
                SegToggle(options: ["Niggle", "Sick"], selectionIndex: $tab)
                if tab == 0 {
                    PickRow(label: "Where",
                            options: bodyParts,
                            selection: $bodyPart)
                    ScaleRow(label: "How bad · 1 mild to 10 severe",
                             max: 10,
                             selection: $severity)
                    PickRow(label: "Status",
                            options: statusOptions.map(\.label),
                            selection: Binding(
                                get: { statusOptions.first(where: { $0.value == status })?.label },
                                set: { lbl in status = statusOptions.first(where: { $0.label == lbl })?.value }))
                    if let e = error { errorRow(e) }
                    PrimaryCta(title: submitting ? "Logging…" : "Log it",
                               disabled: bodyPart == nil || submitting,
                               action: submitNiggle)
                } else {
                    PickRow(label: "Symptoms",
                            options: sickSymptoms,
                            selection: Binding(
                                get: { nil },
                                set: { v in
                                    if let v {
                                        if symptoms.contains(v) { symptoms.remove(v) } else { symptoms.insert(v) }
                                    }
                                }))
                    SelectedSymptomsRow(symptoms: symptoms)
                    if let e = error { errorRow(e) }
                    PrimaryCta(title: submitting ? "Pausing…" : "Pause plan",
                               disabled: symptoms.isEmpty || submitting,
                               action: submitSick)
                    Button("Not now") { dismiss() }
                        .font(.body(13, weight: .semibold))
                        .foregroundStyle(Theme.mute)
                        .frame(maxWidth: .infinity)
                }
            }
            .padding(24)
            Spacer(minLength: 0)
        }
        .background(Theme.Glass.strong)
        .ignoresSafeArea(edges: .bottom)
    }

    private func errorRow(_ e: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Theme.over)
            Text(e)
                .font(.body(12, weight: .medium))
                .foregroundStyle(Theme.txt)
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(Theme.over.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
    }

    private func submitNiggle() {
        guard let part = bodyPart, let st = status else { return }
        submitting = true; error = nil
        Task {
            do {
                _ = try await API.postNiggle(bodyPart: part.lowercased(),
                                              severity: severity,
                                              status: st)
                await MainActor.run {
                    submitting = false
                    onSubmitted()
                    dismiss()
                }
            } catch {
                await MainActor.run {
                    self.submitting = false
                    self.error = error.localizedDescription
                }
            }
        }
    }

    private func submitSick() {
        guard !symptoms.isEmpty else { return }
        submitting = true; error = nil
        Task {
            do {
                _ = try await API.postSick(symptoms: Array(symptoms), fever: symptoms.contains("Fever"))
                await MainActor.run {
                    submitting = false
                    onSubmitted()
                    dismiss()
                }
            } catch {
                await MainActor.run {
                    self.submitting = false
                    self.error = error.localizedDescription
                }
            }
        }
    }
}

private struct SelectedSymptomsRow: View {
    let symptoms: Set<String>
    var body: some View {
        if symptoms.isEmpty {
            EmptyView()
        } else {
            HStack(spacing: 6) {
                ForEach(Array(symptoms), id: \.self) { s in
                    Text(s)
                        .font(.body(11, weight: .semibold))
                        .foregroundStyle(Theme.bg)
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(Capsule().fill(Theme.over))
                }
            }
        }
    }
}

// MARK: - ReturnGateCard
//
// While sick, Today renders REST plus this return-gate. The runner
// self-clears when symptoms pass; the plan resumes from there.

struct ReturnGateCard: View {
    let pausedDaysAgo: Int
    let symptoms: [String]
    let onReturn: () -> Void
    let onStillResting: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Ready to run?")
                .font(.display(22, weight: .bold))
                .foregroundStyle(Theme.txt)
            Text(subtitle)
                .font(.body(13, weight: .medium))
                .foregroundStyle(Theme.txt.opacity(0.85))
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 8) {
                Button(action: onReturn) {
                    Text("Yes, ease me back")
                        .font(.body(13, weight: .extraBold))
                        .foregroundStyle(Theme.bg)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(Theme.txt, in: RoundedRectangle(cornerRadius: 13))
                }
                .buttonStyle(.plain)
                Button(action: onStillResting) {
                    Text("Still resting")
                        .font(.body(13, weight: .extraBold))
                        .foregroundStyle(Theme.txt)
                        .padding(.horizontal, 14).padding(.vertical, 12)
                        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: 13))
                        .overlay(RoundedRectangle(cornerRadius: 13).stroke(Theme.Glass.line, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(16)
        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rCard, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.rCard, style: .continuous).stroke(Theme.Accent.mintReady.opacity(0.35), lineWidth: 1))
    }

    private var subtitle: String {
        let when: String = {
            if pausedDaysAgo <= 0 { return "today" }
            if pausedDaysAgo == 1 { return "yesterday" }
            return "\(pausedDaysAgo) days ago"
        }()
        let syms = symptoms.isEmpty ? "" : " with " + symptoms.joined(separator: " and ").lowercased()
        return "You paused \(when)\(syms). We'll ease you back in, not straight to the workout you missed."
    }
}

// MARK: - LogNonRunSheet
//
// One sheet, Strength | Cross-train toggle. Posts to /api/strength or
// /api/cross-training.

struct LogNonRunSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var tab: Int = 0
    @State private var strengthType: String? = "Full body"
    @State private var strengthMinutes: String? = "45 min"
    @State private var modality: String? = "Bike"
    @State private var intensity: String? = "Moderate"
    @State private var submitting: Bool = false
    @State private var error: String? = nil
    var onSubmitted: () -> Void = {}

    private let strengthTypes = ["Full body", "Upper", "Lower", "Core"]
    private let durations = ["20 min", "30 min", "45 min", "60 min", "90 min"]
    private let modalities = ["Bike", "Swim", "Hike", "Row", "Ski", "Yoga"]
    private let intensities = ["Easy", "Moderate", "Hard"]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            sheetHeader("Log non-run")
            VStack(alignment: .leading, spacing: 18) {
                SegToggle(options: ["Strength", "Cross-train"], selectionIndex: $tab)
                if tab == 0 {
                    PickRow(label: "Type", options: strengthTypes, selection: $strengthType)
                    PickRow(label: "Duration", options: durations, selection: $strengthMinutes)
                } else {
                    PickRow(label: "Modality", options: modalities, selection: $modality)
                    PickRow(label: "Duration", options: durations, selection: $strengthMinutes)
                    PickRow(label: "Intensity", options: intensities, selection: $intensity)
                }
                if let e = error {
                    Text(e).font(.body(12, weight: .medium))
                        .foregroundStyle(Theme.over)
                }
                PrimaryCta(title: submitting ? "Saving…" : "Save session",
                           disabled: submitting,
                           action: submit)
            }
            .padding(24)
            Spacer(minLength: 0)
        }
        .background(Theme.Glass.strong)
        .ignoresSafeArea(edges: .bottom)
    }

    private func parseMinutes(_ s: String?) -> Int {
        guard let s else { return 45 }
        let scanner = Scanner(string: s); var v: Int = 0
        _ = scanner.scanInt(&v); return v == 0 ? 45 : v
    }

    private func submit() {
        submitting = true; error = nil
        let mins = parseMinutes(strengthMinutes)
        Task {
            do {
                if tab == 0 {
                    _ = try await API.postStrength(type: strengthType ?? "Full body",
                                                    durationMin: mins)
                } else {
                    _ = try await API.postCrossTraining(modality: modality ?? "Bike",
                                                         durationMin: mins,
                                                         intensity: intensity ?? "Moderate")
                }
                await MainActor.run { submitting = false; onSubmitted(); dismiss() }
            } catch {
                await MainActor.run { self.submitting = false; self.error = error.localizedDescription }
            }
        }
    }
}

// MARK: - SetGoalSheet
//
// Set a time goal for a specific distance — no race required.
// Distance: horizontal chip picker.
// Time: three wheel pickers — hours (0-9) · minutes (00-59) · seconds (00/15/30/45).
// Saves via POST /api/profile/goal.

struct NewGoalSheet: View {
    var onSubmitted: () -> Void = {}
    var existingGoal: FitnessGoal? = nil

    var body: some View {
        SetGoalSheet(onSubmitted: onSubmitted, existingGoal: existingGoal)
    }
}

struct SetGoalSheet: View {
    @Environment(\.dismiss) private var dismiss
    var onSubmitted: () -> Void = {}
    var existingGoal: FitnessGoal? = nil

    private let distances = ["5K", "10K", "Half Marathon", "Marathon", "50K", "100K"]
    private let secondOptions = [0, 15, 30, 45]

    @State private var distance: String = "Half Marathon"
    @State private var hours: Int = 1
    @State private var minutes: Int = 45
    @State private var seconds: Int = 0
    @State private var saving: Bool = false
    @State private var error: String? = nil

    private var goalTimeString: String {
        let m = String(format: "%02d", minutes)
        let s = String(format: "%02d", seconds)
        return hours > 0 ? "\(hours):\(m):\(s)" : "\(minutes):\(s)"
    }

    private var isValid: Bool { hours > 0 || minutes > 0 }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            sheetHeader(existingGoal != nil ? "Edit goal" : "Set your goal")
            VStack(alignment: .leading, spacing: 24) {

                // Distance chips
                VStack(alignment: .leading, spacing: 8) {
                    Text("DISTANCE")
                        .font(.body(10, weight: .extraBold)).tracking(1.5)
                        .foregroundStyle(Theme.mute)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(distances, id: \.self) { d in
                                Button { distance = d } label: {
                                    Text(d)
                                        .font(.body(13, weight: distance == d ? .extraBold : .semibold))
                                        .foregroundStyle(distance == d ? Theme.bg : Theme.txt)
                                        .padding(.horizontal, 14).padding(.vertical, 8)
                                        .background(distance == d ? Theme.race : Theme.Glass.fill,
                                                    in: Capsule())
                                }
                                .buttonStyle(.plain)
                                .animation(.easeInOut(duration: 0.15), value: distance)
                            }
                        }
                        .padding(.horizontal, 1)
                    }
                }

                // Time wheel picker
                VStack(alignment: .leading, spacing: 10) {
                    Text("TARGET TIME")
                        .font(.body(10, weight: .extraBold)).tracking(1.5)
                        .foregroundStyle(Theme.mute)

                    HStack(spacing: 0) {
                        timeColumn(label: "HR") {
                            Picker("", selection: $hours) {
                                ForEach(0...9, id: \.self) { h in Text("\(h)").tag(h) }
                            }
                        }
                        colonSep
                        timeColumn(label: "MIN") {
                            Picker("", selection: $minutes) {
                                ForEach(0...59, id: \.self) { m in
                                    Text(String(format: "%02d", m)).tag(m)
                                }
                            }
                        }
                        colonSep
                        timeColumn(label: "SEC") {
                            Picker("", selection: $seconds) {
                                ForEach(secondOptions, id: \.self) { s in
                                    Text(String(format: "%02d", s)).tag(s)
                                }
                            }
                        }
                    }
                    .frame(maxWidth: .infinity)
                }

                if let e = error {
                    Text(e).font(.body(12, weight: .medium)).foregroundStyle(Theme.over)
                }

                PrimaryCta(
                    title: saving ? "Saving…" : "Set goal",
                    disabled: saving || !isValid,
                    action: save
                )
            }
            .padding(24)
            Spacer(minLength: 0)
        }
        .background(Theme.Glass.strong)
        .ignoresSafeArea(edges: .bottom)
        .onAppear { seedValues() }
        .onChange(of: distance) { _, _ in if existingGoal == nil { setDefaults(for: distance) } }
    }

    @ViewBuilder
    private func timeColumn<P: View>(label: String, @ViewBuilder picker: () -> P) -> some View {
        VStack(spacing: 4) {
            picker()
                .labelsHidden()
                .pickerStyle(.wheel)
                .frame(width: 72, height: 120)
                .clipped()
            Text(label)
                .font(.body(9, weight: .bold)).tracking(1)
                .foregroundStyle(Theme.mute)
        }
        .frame(maxWidth: .infinity)
    }

    private var colonSep: some View {
        Text(":")
            .font(.display(26, weight: .bold))
            .foregroundStyle(Theme.mute)
            .padding(.bottom, 22)
    }

    private func seedValues() {
        if let g = existingGoal {
            distance = g.distance
            let parts = g.time.split(separator: ":").compactMap { Int($0) }
            if parts.count == 2 {
                hours = 0; minutes = parts[0]; seconds = snap15(parts[1])
            } else if parts.count == 3 {
                hours = parts[0]; minutes = parts[1]; seconds = snap15(parts[2])
            }
        } else {
            setDefaults(for: distance)
        }
    }

    private func setDefaults(for d: String) {
        switch d {
        case "5K":            hours = 0; minutes = 25; seconds = 0
        case "10K":           hours = 0; minutes = 50; seconds = 0
        case "Half Marathon": hours = 1; minutes = 45; seconds = 0
        case "Marathon":      hours = 3; minutes = 30; seconds = 0
        case "50K":           hours = 5; minutes = 0;  seconds = 0
        default:              hours = 9; minutes = 0;  seconds = 0
        }
    }

    private func snap15(_ s: Int) -> Int {
        secondOptions.min(by: { abs($0 - s) < abs($1 - s) }) ?? 0
    }

    private func save() {
        saving = true; error = nil
        Task {
            let ok = (try? await API.setFitnessGoal(
                distanceLabel: distance,
                goalTime: goalTimeString
            )) ?? false
            await MainActor.run {
                if ok { onSubmitted(); dismiss() }
                else { error = "Could not save goal. Try again."; saving = false }
            }
        }
    }
}
