//
//  RaceEditSheet.swift
//  Race P1 · edit an EXISTING race. Mirrors AddRaceSheet's structure and
//  Theme so the two read as one family — the only differences are that this
//  sheet prefills from the race's current values and PATCHes (not POSTs).
//
//  David's core ask: change the A-race's distance, date, and goal/details
//  from the phone (the app could only CREATE a race before this). The
//  backend (web-v2/app/api/race/route.ts PATCH) accepts name, date,
//  distance_label, priority, goal, goal_safe, bib, wave, startTime, location
//  and fires the plan auto-rebuild + VDOT/LTHR recalc server-side when date /
//  goal / priority change — so on success the caller just refreshes.
//
//  Course GPX / Strava attach already lives on RaceDayView (CourseAnnotations
//  + the GPX file-importer); this sheet does not duplicate it.
//

import SwiftUI

struct RaceEditSheet: View {
    let slug: String
    /// Optional instant-prefill seed from whatever the caller already holds
    /// (the race tile / the loaded detail). Avoids a blank flash before the
    /// fresh GET lands. nil is fine — the sheet shows a loading state then.
    var seedName: String? = nil
    var seedDate: String? = nil           // ISO yyyy-MM-dd
    var seedDistanceLabel: String? = nil
    var seedPriority: String? = nil
    var seedGoal: String? = nil
    var seedWave: String? = nil
    var seedStartTime: String? = nil
    var seedLocation: String? = nil
    var onSaved: () -> Void = {}

    @Environment(\.dismiss) private var dismiss

    @State private var name: String = ""
    @State private var date: Date = Date()
    @State private var distance: String = "Half Marathon"
    @State private var priority: String = "A"
    @State private var goal: String = ""        // A-goal
    @State private var goalSafe: String = ""     // B / safe goal
    @State private var bib: String = ""
    @State private var wave: String = ""
    @State private var startTime: String = ""
    @State private var location: String = ""

    // Race P5 · per-race fuel. Prefills from the detail's `fueling` block
    // when the runner has already entered fuel (isDefault == false). The
    // product + serving carbs round-trip directly; cadence is recovered from
    // the schedule's first gap (the server builds the schedule from cadence).
    @State private var fuelProduct: String = ""
    @State private var fuelCarbs: String = ""     // g per serving
    @State private var fuelCadence: String = ""   // every N min
    @State private var fuelRate: String = ""      // optional direct g/hr

    // Race P5 · logistics. `shuttle` / `packetPickup` / `officialUrl` aren't
    // surfaced by the detail GET yet, so they start blank and are write-only
    // (PATCH preserves untouched meta either way). `location` round-trips.
    @State private var shuttle: String = ""
    @State private var packetPickup: String = ""
    @State private var officialUrl: String = ""

    @State private var loaded: Bool = false
    @State private var saving: Bool = false
    @State private var error: String? = nil

    // Same distance set + ordering as AddRaceSheet so the two are consistent.
    private let distances = ["5K", "10K", "Half Marathon", "Marathon", "50K", "50M", "100K", "100M", "Other"]

    var body: some View {
        NavigationStack {
            Form {
                Section("RACE") {
                    TextField("Race name", text: $name)
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                    Picker("Distance", selection: $distance) {
                        ForEach(distances, id: \.self) { Text($0) }
                    }
                    Picker("Priority", selection: $priority) {
                        Text("A — goal race").tag("A")
                        Text("B — tune-up").tag("B")
                        Text("C — for fun").tag("C")
                    }
                }
                Section {
                    TextField("A goal · e.g. 1:30:00", text: $goal)
                        .keyboardType(.numbersAndPunctuation)
                    TextField("B goal · the day-it-goes-sideways time", text: $goalSafe)
                        .keyboardType(.numbersAndPunctuation)
                } header: {
                    Text("GOAL (optional)")
                } footer: {
                    Text("Changing the date or A goal rebuilds your plan around it.")
                        .font(.body(11))
                }
                Section("RACE MORNING (optional)") {
                    TextField("Start time · e.g. 7:00 AM", text: $startTime)
                    TextField("Wave / corral", text: $wave)
                    TextField("Bib number", text: $bib)
                    TextField("Location", text: $location)
                }
                Section {
                    TextField("Product · e.g. Maurten Gel 100", text: $fuelProduct)
                    TextField("Carbs per serving · g", text: $fuelCarbs)
                        .keyboardType(.numberPad)
                    TextField("Take one every · min", text: $fuelCadence)
                        .keyboardType(.numberPad)
                    TextField("Target rate · g/hr (optional)", text: $fuelRate)
                        .keyboardType(.numberPad)
                } header: {
                    Text("RACE FUEL (optional)")
                } footer: {
                    Text("Your gel and how often you take it. The coach builds the amount and schedule around it.")
                        .font(.body(11))
                }
                Section {
                    TextField("Packet pickup · where and when", text: $packetPickup)
                    TextField("Shuttle / parking", text: $shuttle)
                    TextField("Official site", text: $officialUrl)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                } header: {
                    Text("LOGISTICS (optional)")
                }
                if let err = error {
                    Section { Text(err).foregroundStyle(.red).font(.body(13)) }
                }
            }
            .navigationTitle("Edit Race")
            .navigationBarTitleDisplayMode(.inline)
            .disabled(!loaded && error == nil)
            .overlay {
                if !loaded && error == nil {
                    ProgressView().tint(Theme.mute)
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : "Save") {
                        guard !name.trimmingCharacters(in: .whitespaces).isEmpty else {
                            error = "Race name is required."
                            return
                        }
                        Task { await save() }
                    }
                    .disabled(saving || !loaded || name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .task { await prefill() }
        }
    }

    private var isoDate: String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }

    /// Parse an ISO yyyy-MM-dd string to a Date at noon-local so DST never
    /// shifts the displayed day. Falls back to today on a malformed string.
    private func parseISO(_ iso: String?) -> Date? {
        guard let iso, !iso.isEmpty else { return nil }
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = .current
        guard let d = f.date(from: String(iso.prefix(10))) else { return nil }
        return Calendar.current.date(bySettingHour: 12, minute: 0, second: 0, of: d) ?? d
    }

    /// Match a stored distance_label to a Picker option. Unrecognized (and
    /// the nil "Other" case createRace writes) map to "Other" so the Picker
    /// always has a valid selection.
    private func normalizedDistance(_ label: String?) -> String {
        guard let label, distances.contains(label) else { return "Other" }
        return label
    }

    /// Seed the form from the caller's instant values first, then refine with
    /// the fresh GET so goal / wave / start-time reflect the server. goal_safe
    /// and bib are not surfaced by the detail GET, so they only prefill from a
    /// seed if the caller had them — otherwise they start blank and the runner
    /// can set them (PATCH preserves untouched meta fields either way).
    private func prefill() async {
        guard !loaded else { return }
        // 1 · instant seed from the caller.
        applySeed()

        // 2 · authoritative refresh from /api/race/[slug].
        let detail = try? await API.fetchRaceDetail(slug: slug)
        await MainActor.run {
            if let r = detail?.race {
                if !r.name.isEmpty { name = r.name }
                if let d = parseISO(r.date) { date = d }
                distance = normalizedDistance(r.distance_label)
                if let p = r.priority, !p.isEmpty { priority = p }
                if let g = r.goal, !g.isEmpty { goal = g }
                if let w = r.wave, !w.isEmpty { wave = w }
                if let st = r.gun_time, !st.isEmpty { startTime = st }
                if let loc = r.location, !loc.isEmpty { location = loc }
            }
            // Race P5 · prefill fuel from the resolved `fueling` block, but
            // only when the runner has actually entered fuel (isDefault ==
            // false). A default plan must stay blank in the form so saving an
            // untouched sheet never persists the research default as the
            // runner's own choice.
            if let f = detail?.fueling, !f.isDefault {
                if !f.productName.isEmpty, f.productName != "gel" { fuelProduct = f.productName }
                if f.carbsPerServingG > 0 { fuelCarbs = String(f.carbsPerServingG) }
                if let gap = cadenceFromSchedule(f.scheduleMin) { fuelCadence = String(gap) }
            }
            if detail?.race == nil && name.isEmpty && seedName == nil {
                // No seed and the detail failed to load · surface it rather
                // than letting the runner edit a blank form into existence.
                error = "Couldn't load this race. Check your connection and try again."
            }
            loaded = true
        }
    }

    private func applySeed() {
        if let v = seedName { name = v }
        if let d = parseISO(seedDate) { date = d }
        distance = normalizedDistance(seedDistanceLabel)
        if let v = seedPriority, !v.isEmpty { priority = v }
        if let v = seedGoal { goal = v }
        if let v = seedWave { wave = v }
        if let v = seedStartTime { startTime = v }
        if let v = seedLocation { location = v }
    }

    /// Recover the runner's cadence from a built schedule · the gap between
    /// the first two stops. The server places stops every N minutes, so the
    /// first gap is the cadence the runner originally entered. Single-stop
    /// or empty schedules yield nil (no cadence to recover).
    private func cadenceFromSchedule(_ mins: [Int]) -> Int? {
        guard mins.count >= 2 else { return nil }
        let gap = mins[1] - mins[0]
        return gap > 0 ? gap : nil
    }

    private func save() async {
        saving = true
        error = nil
        func tidy(_ s: String) -> String { s.trimmingCharacters(in: .whitespaces) }
        /// Send a number field only when the runner typed a positive value ·
        /// a blank or zero passes nil so it never clobbers a stored value.
        func num(_ s: String) -> Int? {
            let v = Int(tidy(s))
            return (v ?? 0) > 0 ? v : nil
        }
        // distance_label · "Other" is stored as null (mirrors createRace), so
        // pass nil for it · everything else passes the picked label through.
        let distanceLabel: String? = distance == "Other" ? "" : distance
        let ok = await API.updateRace(
            slug: slug,
            name: tidy(name),
            date: isoDate,
            distanceLabel: distanceLabel,
            priority: priority,
            goal: tidy(goal),
            goalSafe: tidy(goalSafe),
            bib: tidy(bib),
            wave: tidy(wave),
            startTime: tidy(startTime),
            location: tidy(location),
            // Race P5 · per-race fuel. Product passes through as typed (an
            // empty string is a deliberate clear); the numbers go in only
            // when positive so a half-filled fuel form is non-destructive.
            fuelProduct: tidy(fuelProduct).isEmpty ? nil : tidy(fuelProduct),
            fuelCarbsPerServingG: num(fuelCarbs),
            fuelCadenceMin: num(fuelCadence),
            fuelCarbsPerHourTargetG: num(fuelRate),
            // Race P5 · logistics. Sent only when typed so an untouched field
            // never overwrites stored meta.
            shuttle: tidy(shuttle).isEmpty ? nil : tidy(shuttle),
            packetPickup: tidy(packetPickup).isEmpty ? nil : tidy(packetPickup),
            officialUrl: tidy(officialUrl).isEmpty ? nil : tidy(officialUrl)
        )
        await MainActor.run {
            if ok {
                onSaved()
                dismiss()
            } else {
                error = "Could not save your changes. Check your connection and try again."
                saving = false
            }
        }
    }
}
