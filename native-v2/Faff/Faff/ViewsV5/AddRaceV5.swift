//
//  AddRaceV5.swift
//  faff.run iPhone · adding a race, and pulling its course in.
//
//  A bottom sheet off Races (7a). The v5 design never drew this screen — its
//  own README and the reference screens stop at "the goal is still real" and
//  the schedule that answers it; there is no mock for the sheet that PUTS a
//  race on that schedule in the first place. Built in the existing language:
//  `V5SheetHost` + `FaffInput` / `FaffSelect` / `ExpandingRow` / `FaffButton`,
//  no new component, no new token.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY THIS FILE OWNS ITS OWN NETWORK CALLS
//
//  Every other ViewsV5 screen is pure — it takes a decoded model and renders
//  it, and a Host in HostsV5.swift owns the fetch. That shape fits a screen
//  with one GET behind it. This one does not: create the race, THEN try to
//  attach a course with whatever the race's own new slug turned out to be —
//  a real sequential dependency, not a single request a closure could name.
//  Wiring that through Host closures would mean HostsV5.swift growing the
//  whole multi-step flow instead of a few lines, which the brief asks this
//  file to avoid. So `AddRaceV5` is self-contained: it owns its form state
//  and calls `API.*` directly, and only tells the Host two things — cancel,
//  or "a race now exists, here is its slug."
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE COURSE STEP, AND WHERE THE BRIEF'S OWN DESCRIPTION DOESN'T HOLD
//
//  The task brief describes `API.autofillRace(slug:url:name:)` as pulling
//  "race details from a URL or a name" — which reads like a second course
//  source alongside the Strava route URL. Reading the real route handler
//  (`web-v2/app/api/race/[slug]/autofill/route.ts`) says otherwise: its
//  whole `RaceAutofillProposal` shape is race-DAY LOGISTICS — start time,
//  wave, bib, parking, shuttle, packet pickup, aid stations, notable miles,
//  weather norms, gear check, pacers, spectators. No course geometry, no
//  name/date/distance. It cannot fill this form and it cannot pull a course.
//  It also requires an existing `slug`, so it could not run before creation
//  even if it did.
//
//  So "pulling the course in from Strava or a race URL" is built with the
//  two mechanisms that actually exist and actually return geometry, both of
//  which — like autofill — need the race's slug and therefore run AFTER
//  create, never before:
//
//    · A pasted Strava route URL → `POST /api/race/strava-course`
//      (`API.importStravaRoute`). Exact, immediate, no ambiguity.
//    · A search of the runner's own Strava route library BY THE RACE'S
//      NAME → `GET /api/gpx/search` (ranked candidates) → the runner picks
//      one → `POST /api/gpx/import` applies it. This is genuinely "pulling
//      the course in from Strava" without a URL in hand — the closest real
//      answer to what a bare "race URL" was asked to do, and unlike
//      autofill it actually returns a course. `API.swift` had no wrapper for
//      either endpoint; both were added there (`searchGpxCandidates` /
//      `importGpxCandidate`), matching the file's existing conventions.
//
//  Neither is a stub: both hit real endpoints, decode real responses, and a
//  failure or an empty result says so in plain text rather than pretending.
//  A missing course is not an error (rule three) — the race saves either way.
//
//  ─────────────────────────────────────────────────────────────────────────
//  RULE THREE, APPLIED TO WHAT `POST /api/race` ACTUALLY DOES
//
//  Reading `web-v2/app/api/race/route.ts` POST: as long as a name and a date
//  are present, the race ROW always saves — there is no server-side refusal
//  shaped like "a date inside a taper" or "a distance we do not plan" that
//  blocks creating the race itself. What CAN be refused is the PLAN the
//  server tries to author for a new A-race (`generatePlan`, surfaced as
//  `plan_error` — "target < 2 weeks away", "race distance unrecognized",
//  "plan needs at least 3 weeks runway", and the one the server rewrites to
//  friendlier prose, the low-mileage case). That refusal is real and is
//  rendered as `Alert`, exactly as the brief asks — but it is a refusal
//  about the PLAN, and the race it belongs to still exists, so it renders
//  UNDER the confirmation that the race saved, never in its place.
//
//  The one case this file cannot label with confidence is `createRace`
//  returning a nil slug. The Swift wrapper collapses every non-2xx response
//  (a genuine validation 400, a slug-collision 409, a dropped connection)
//  into the same `(nil, nil)`, so there is no way to tell "the engine said
//  no" from "the network never arrived" apart from the fact that a blank
//  name is already refused client-side (mirroring the server's own name+date
//  requirement, not inventing a new one) and a collision is rare. Given that
//  ambiguity, this is treated as the more common real case — a failed
//  read — and rendered `ErrorNote` with Retry, not `Alert`. Flagged in the
//  build report; the fix is a server-message passthrough on `createRace`,
//  which is a change to a shared wrapper other callers use and is out of
//  this file's scope.
//
//  `coached_externally` is also on the server's response and is not decoded
//  by `createRace` at all (it returns only `slug` / `plan_error`) — a
//  coached runner adding a race gets no "your coach owns the plan" note
//  here. Also flagged; same reason for not fixing it in this pass.
//

import SwiftUI

// MARK: - The screen

struct AddRaceV5: View {
    /// The runner backed out before anything saved.
    var onCancel: () -> Void = {}
    /// A race now exists. Called only from the confirmation body, once the
    /// runner has had a chance to read whatever came back about the plan or
    /// the course — never fired automatically the instant the POST returns.
    var onCreated: (String) -> Void = { _ in }
    /// The race is saved and the flow continues on screen 20b.
    ///
    /// The 0821 handoff splits these deliberately: the course involves a real
    /// network round trip, so it gets its own pushed screen rather than a
    /// second sheet step, and the race is saved BEFORE it — "failure never
    /// blocks the race from saving, because the race is the important object
    /// and the course is secondary".
    var onContinueToCourse: (_ slug: String, _ name: String, _ distanceMi: Double?) -> Void = { _, _, _ in }

    // ── the race itself ──────────────────────────────────────────────────
    @State private var name: String = ""
    @State private var date: Date = Calendar.current.date(byAdding: .month, value: 3, to: Date()) ?? Date()
    @State private var distance: String = "Half Marathon"
    @State private var priorityLabel: String = AddRaceV5.priorityOptions[0]
    @State private var goal: String = ""

    // ── the course ────────────────────────────────────────────────────────
    @State private var stravaURL: String = ""
    @State private var courseCandidates: [GpxCandidateV5] = []
    @State private var courseSearching: Bool = false
    @State private var courseSearchReason: String?
    @State private var courseSearchRan: Bool = false
    @State private var selectedCandidateID: String?

    // ── save flow ─────────────────────────────────────────────────────────
    @State private var saving: Bool = false
    @State private var saveFailed: Bool = false
    /// RULE THREE · the engine read the request and the answer is no.
    ///
    /// `API.createRace` has returned a `refusal` since the transport learned
    /// that a 4xx is an answer, and this screen threw it away: every decline
    /// landed on `saveFailed` and drew the data-outage `ErrorNote` — "Could
    /// not save the race. Check your connection and try again." — complete
    /// with a Retry that would decline identically for as long as the runner
    /// pressed it. The connection was fine. We had the sentence and printed
    /// a different one.
    @State private var saveRefusal: String?
    @State private var savedSlug: String?
    @State private var planError: String?
    @State private var courseNote: String?

    private static let distanceOptions =
        ["5K", "10K", "Half Marathon", "Marathon", "50K", "50M", "100K", "100M", "Other"]
    /// Same three, same order, everywhere a priority is picked in the app
    /// (`RaceEditSheet`, the legacy `AddRaceSheet`).
    private static let priorityOptions = ["A \u{b7} Goal race", "B \u{b7} Tune-up", "C \u{b7} For fun"]

    /// Miles for exactly the fixed labels this screen offers — a hint for
    /// ranking the Strava name-search, not a general parser. The server's own
    /// `distanceMiFromLabel` (`web-v2/lib/race/distance.ts`) is the real one;
    /// this only needs to agree with it for the strings in `distanceOptions`.
    private static let distanceMiHint: [String: Double] = [
        "5K": 3.1, "10K": 6.2, "Half Marathon": 13.1, "Marathon": 26.2,
        "50K": 31.07, "50M": 50, "100K": 62.14, "100M": 100,
    ]

    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var canSave: Bool { !trimmedName.isEmpty }
    private var priorityCode: String { String(priorityLabel.prefix(1)) }
    private var isoDate: String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = .current
        return f.string(from: date)
    }
    private var selectedCandidate: GpxCandidateV5? {
        courseCandidates.first { $0.id == selectedCandidateID }
    }

    var body: some View {
        // Same shape as 21a: a fixed header, a scrolling middle, and the
        // primary action pinned at the bottom. The middle is what grows when
        // a date picker expands in place, and the action must not travel with
        // it — see V5SheetHost's `tall`.
        VStack(alignment: .leading, spacing: V5.S.s20) {
            header
            if let slug = savedSlug {
                ScrollView { confirmation(slug: slug) }
                    .scrollIndicators(.hidden)
                    .frame(maxHeight: .infinity, alignment: .top)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: V5.S.s16) {
                        raceFields
                        // A refusal is an ANSWER. `Alert`, no Retry — there
                        // is nothing to retry, and offering one would be the
                        // screen pretending it had not understood.
                        if let saveRefusal {
                            Alert(text: saveRefusal, tone: .attention)
                        } else if saveFailed {
                            ErrorNote(text: "That did not save. Nothing was written, so it is safe to try again.",
                                      onRetry: { Task { await save() } })
                        }
                    }
                    .padding(.horizontal, V5.S.s2)
                }
                .scrollIndicators(.hidden)
                .frame(maxHeight: .infinity, alignment: .top)

                FaffButton(saving ? "Saving\u{2026}" : "Continue to course",
                           variant: .primary, size: .lg, full: true,
                           enabled: canSave && !saving,
                           disabledReason: saving ? nil : "Name the race first. The date and distance already have defaults.",
                           action: { Task { await save() } })
            }
        }
    }

    // MARK: Race fields

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            Button("Cancel", action: onCancel)
                .font(.faffText(TypeScaleV5.body15, weight: .semibold))
                .foregroundStyle(V5.textSecondary)
            Spacer(minLength: V5.S.s8)
            Text("Add a race")
                .font(.faffDisplay(17))
                .foregroundStyle(V5.textPrimary)
            Spacer(minLength: V5.S.s8)
            Color.clear.frame(width: 52, height: 1)
        }
        .padding(.horizontal, V5.S.s4)
    }

    private var raceFields: some View {
        VStack(alignment: .leading, spacing: V5.S.s16) {
            FaffInput(label: "Name", text: $name, placeholder: "e.g. Clarksburg Half")

            RaceDateFieldV5(date: $date)

            FaffSelect(label: "Distance", value: distance,
                       options: Self.distanceOptions,
                       onChange: { distance = $0 })

            FaffSelect(label: "Priority", value: priorityLabel,
                       options: Self.priorityOptions,
                       onChange: { priorityLabel = $0 })

            FaffInput(label: "Goal time", text: $goal,
                      placeholder: "e.g. 1:45:00",
                      helper: "Optional. The coach can set one later from your fitness alone.",
                      keyboard: .numbersAndPunctuation)
        }
    }

    // MARK: Course

    private var courseFields: some View {
        VStack(alignment: .leading, spacing: V5.S.s10) {
            V5SectionLabel(text: "Course").padding(.horizontal, V5.S.s4)

            VStack(alignment: .leading, spacing: V5.S.s12) {
                FaffInput(label: "Strava route URL", text: $stravaURL,
                          placeholder: "strava.com/routes/…",
                          helper: "Pulls the real polyline and elevation in directly.",
                          keyboard: .URL)

                if stravaURL.trimmingCharacters(in: .whitespaces).isEmpty {
                    FaffButton(courseSearching ? "Searching Strava\u{2026}" : "Find it on Strava by name",
                               variant: .secondary, size: .md,
                               enabled: !trimmedName.isEmpty && !courseSearching,
                               action: { Task { await searchCourse() } })

                    // A disabled control with no reason beside it is a dead
                    // end. Say what is missing.
                    if trimmedName.isEmpty {
                        Text("Name the race first \u{b7} the search goes by name.")
                            .font(.faffText(TypeScaleV5.label13))
                            .foregroundStyle(V5.textQuiet)
                    }

                    courseSearchResult
                } else {
                    // A URL was pasted — it wins at save time (matches the
                    // legacy sheet's own rule), so a name search here would
                    // offer a choice that is never actually used.
                    Text("A pasted URL takes the course directly; clear it to search by name instead.")
                        .font(.faffText(TypeScaleV5.label13))
                        .foregroundStyle(V5.textQuiet)
                        .padding(.horizontal, V5.S.s4)
                }
            }
            .padding(V5.S.tilePad)
            .background(V5.materialTile, in: RoundedRectangle(cornerRadius: V5.R.r22, style: .continuous))
        }
    }

    @ViewBuilder
    private var courseSearchResult: some View {
        if courseSearchRan {
            if courseCandidates.isEmpty {
                Text(courseSearchReason ?? "No match found on Strava for that name.")
                    .font(.faffText(TypeScaleV5.label13))
                    .foregroundStyle(V5.textQuiet)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                VStack(spacing: 0) {
                    ForEach(courseCandidates) { c in
                        ListRow(label: c.name,
                                sub: [FaffFmt.milesUnit(c.distanceMi),
                                      c.elevationGainFt.flatMap { FaffFmt.feet($0) }.map { "\($0) gain" }]
                                    .compactMap { $0 }.joined(separator: " \u{b7} "),
                                value: selectedCandidateID == c.id ? .measured("Selected") : nil,
                                onTap: { selectedCandidateID = c.id })
                    }
                }
                .background(V5.materialTileRaised, in: RoundedRectangle(cornerRadius: V5.R.r16, style: .continuous))
            }
        }
    }

    // MARK: Actions

    // MARK: Confirmation
    //
    // The race exists the moment this renders — nothing below is a reason to
    // doubt that, only notes about what happened next. `planError` is a
    // refusal about the PLAN (rule three: Alert, no confirm button, because
    // there is nothing to confirm). `courseNote` is neither a refusal nor an
    // outage — a course pull is best-effort, and the design's own words are
    // "if the pull fails or finds nothing, say so plainly" — so it renders
    // as a quiet line, not an Alert and not an ErrorNote.

    private func confirmation(slug: String) -> some View {
        VStack(alignment: .leading, spacing: V5.S.s16) {
            CoachSay(text: "\(trimmedName.isEmpty ? "The race" : trimmedName) is on the schedule.")

            if let planError {
                Alert(text: planError, tone: .attention)
            }
            if let courseNote {
                CoachCaveat(text: courseNote)
            }

            FaffButton("Continue to course", variant: .primary, size: .lg,
                       action: { onContinueToCourse(slug, trimmedName, Self.distanceMiHint[distance]) })
        }
    }

    // MARK: - Save flow

    /// Saves the race, then hands off to 20b.
    ///
    /// The course work that used to live here has moved to `CourseImportV5`.
    /// This function no longer touches a course at all, which is the point of
    /// the split: the race is committed before anything with a network round
    /// trip is attempted, so no course failure can cost the runner the race.
    ///
    /// `planError` still renders here when it comes back, because that is a
    /// refusal about the PLAN and it belongs to this step.
    private func save() async {
        saving = true
        saveFailed = false
        saveRefusal = nil
        let created = try? await API.createRace(
            name: trimmedName,
            date: isoDate,
            distanceLabel: distance == "Other" ? nil : distance,
            priority: priorityCode,
            goal: goal.trimmingCharacters(in: .whitespaces).isEmpty ? nil : goal.trimmingCharacters(in: .whitespaces)
        )
        saving = false
        guard let slug = created?.slug else {
            // The engine's own sentence when it gave one; the outage note
            // only when it did not. Nothing is invented here — the phone
            // never writes a reason the engine did not have.
            if let refusal = created?.refusal, !refusal.isEmpty {
                saveRefusal = refusal
            } else {
                saveFailed = true
            }
            return
        }
        // A plan refusal is worth reading before moving on; anything else and
        // the course step is the next thing the runner wants.
        if let planError = created?.planError, !planError.isEmpty {
            self.planError = planError
            savedSlug = slug
            return
        }
        onContinueToCourse(slug, trimmedName, Self.distanceMiHint[distance])
    }

    private func searchCourse() async {
        courseSearching = true
        courseSearchRan = false
        courseCandidates = []
        courseSearchReason = nil
        selectedCandidateID = nil
        let result = await API.searchGpxCandidates(query: trimmedName, distanceMi: Self.distanceMiHint[distance])
        courseCandidates = result?.candidates ?? []
        courseSearchReason = result?.reason
        courseSearching = false
        courseSearchRan = true
    }
}

// MARK: - Date field
//
// Same shape as onboarding's `GoalDateField` (`OnboardingV5.swift`) — an
// `ExpandingRow` opening a `.graphical` `DatePicker`, which is the closest
// the system offers to "expand in place, never a wheel" for an arbitrary
// calendar date months out. Not shared with onboarding's version because
// that one's date is optional (a runner may not have entered a race yet);
// this one always carries a real date, so there is no "Clear".

private struct RaceDateFieldV5: View {
    @Binding var date: Date
    @State private var open = false

    private static let range: ClosedRange<Date> = {
        let cal = Calendar.current
        let lo = cal.date(byAdding: .day, value: 1, to: Date()) ?? Date()
        let hi = cal.date(byAdding: .year, value: 3, to: Date()) ?? Date()
        return lo...hi
    }()

    private var display: String {
        let f = DateFormatter()
        f.dateStyle = .medium
        return f.string(from: date)
    }

    var body: some View {
        ExpandingRow(label: "Date", value: .measured(display), question: "Race date", isExpanded: $open) {
            DatePicker("", selection: $date, in: Self.range, displayedComponents: .date)
                .datePickerStyle(.graphical)
                .labelsHidden()
                .tint(V5.signal)
        }
    }
}

// MARK: - Preview

// Hosted the way `AddRaceHostV5` hosts it — `tall: true`, and NO `title:`.
//
// This preview used to pass `title: "Add a race"`, which drew the name twice:
// the screen's own 56pt "ADD A RACE" with the sheet bar's "Add a race"
// directly under it. Production never did that, so the preview showed a
// reviewer a duplication the runner never sees, and hid the layout the runner
// does. A preview that does not host the screen the way the app hosts it is
// not a preview of the screen.
#Preview("Add race") {
    ZStack {
        V5.surfacePage.ignoresSafeArea()
        V5SheetHost(isPresented: .constant(true), tall: true) {
            AddRaceV5()
        }
    }
}
