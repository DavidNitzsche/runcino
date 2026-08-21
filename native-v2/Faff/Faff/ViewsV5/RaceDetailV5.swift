//
//  RaceDetailV5.swift
//  faff.run iPhone · screen 8a, pushed from a schedule row on Races.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE SHELL EXCEPTION
//
//  Pushed screens are AppBar + plain list — no gradient panel. There is no
//  "place" being opened here, just a course and a plan, so the day-state
//  poster grammar does not apply. `docs/design/iphone-v5/reference/screens/8a.html`
//  is the source; every measurement below is taken from it.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHERE THE FOUR RULES LAND ON THIS SCREEN
//
//  RULE ONE — Projected is modelled and MUST carry the tilde. That happens
//  for free: `V5RaceDetail.projected` is a `V5Number`, and `.value` turns the
//  engine's own `modelled` flag into a `FaffValue` before this file ever sees
//  it. This view cannot print it as a bare String even if it wanted to.
//
//  RULE THREE — two designed absences, not two missing states:
//    · `taperProgress == nil` → the block has no taper phase yet. Draw
//      nothing, not a zero-progress bar (a bar at 0% reads as "taper hasn't
//      started", which is a different, false statement from "not applicable").
//    · `gear.isEmpty` → no gear plan yet. Draw nothing, not an invented shoe.
//
//  ─────────────────────────────────────────────────────────────────────────
//  JOB 3 · RESULT ENTRY, ADDED ONTO THE EXISTING SCREEN
//
//  `POST /api/race/result` was live with no way in from the phone. The entry
//  point lives here, on the race's own detail screen, rather than as a new
//  push — a runner logging a result is already looking at the race they ran.
//  `resultSection` below draws nothing at all once `resultEntry.status ==
//  "confirmed"`: a row with nothing left to open. RULE ONE is the reason it
//  exists in the first place — `resultEntry.finish` carries `modelled: true`
//  on a provisional (auto-detected, not yet confirmed) read, so the amber
//  tilde is on it before this form ever renders, and the copy names it
//  "Training effort · race to lock in" rather than presenting it as a PR.
//

import SwiftUI

// MARK: - Screen

struct RaceDetailV5: View {
    let raceDetail: V5RaceDetail

    /// Fires when a tappable gear row (one whose `action` the engine set) is
    /// tapped. The screen does not know what "Change" does — that is the
    /// composition root's job.
    var onGearRowTap: ((V5Row) -> Void)? = nil
    /// A finish time (and optional average heart rate) was submitted. `async`
    /// (matching `PacesMovedV5.confirm`'s own pattern) so this view can await
    /// it and clear `submitting` afterward instead of leaving the button
    /// disabled forever on a failed write — the screen does not call
    /// `POST /api/race/result` itself, but it does need to know when the
    /// caller's write (and refetch) has finished. A settled result flips
    /// `resultEntry.status` to `"confirmed"` on the next `raceDetail`, which
    /// is what actually removes this section — `submitting` only guards the
    /// button for the one round trip.
    var onSubmitResult: (_ finishDisplay: String, _ avgHrBpm: Int?) async -> Void = { _, _ in }
    /// What the last submission came back as, when it came back as anything
    /// other than "done". The write used to answer a bare `Bool`, so a race
    /// the server would not accept and a dropped connection both ended as a
    /// button that appeared to do nothing.
    var submitOutcome: V5WriteOutcome? = nil
    var onBack: (() -> Void)? = nil

    @State private var resultExpanded = false
    @State private var finishText: String = ""
    @State private var hrText: String = ""
    @State private var submitting = false

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                AppBar(title: raceDetail.name, eyebrow: raceDetail.dateLine, onBack: onBack)

                // The prototype's content band spells this out as `gap:24px`
                // (`padding:0 16px 32px;gap:24px`), the upper end of the
                // brief's stated 20–24 "between groups" range.
                VStack(alignment: .leading, spacing: V5.S.s24) {
                    statsRow

                    // Above the form rather than inside it: the result
                    // section stops drawing the moment a time is confirmed,
                    // and a reason has to survive whatever the refetch does
                    // to the section it belongs to.
                    if let submitOutcome {
                        WriteNote(outcome: submitOutcome)
                    }

                    resultSection

                    courseSection

                    pacePlanSection

                    if let progress = raceDetail.taperProgress {
                        taperSection(progress: progress)
                    }

                    if !raceDetail.gear.isEmpty {
                        ListGroup(header: "Gear plan") {
                            ForEach(raceDetail.gear) { row in
                                ListRow(label: row.label,
                                        sub: row.sub,
                                        value: row.value?.value,
                                        onTap: row.action != nil ? { onGearRowTap?(row) } : nil)
                            }
                        }
                    }

                    if let coachLine = raceDetail.coachLine, !coachLine.isEmpty {
                        CoachSay(text: coachLine, size: .md)
                    }
                }
                .padding(.horizontal, V5.S.gutter)
                .padding(.bottom, V5.S.s32)
            }
        }
        .background(V5.surfacePage)
        .scrollIndicators(.hidden)
    }

    // MARK: Result entry · Job 3
    //
    // Three states, and only two of them draw anything:
    //   nothing logged yet     → a plain "Log your result" entry row.
    //   provisional            → an Alert naming it unconfirmed, THEN the
    //                            same entry row (label "Confirm your time"),
    //                            prefilled with the provisional reading.
    //   confirmed               → nothing. A row with nothing left to open.

    @ViewBuilder
    private var resultSection: some View {
        if let entry = raceDetail.resultEntry, entry.isPast, entry.status != "confirmed" {
            VStack(alignment: .leading, spacing: V5.S.s10) {
                V5SectionLabel(text: entry.status == "provisional" ? "Provisional result" : "Race result")

                if entry.status == "provisional" {
                    // Rule one, in copy: this is explicitly not a confirmed
                    // finish. `entry.finish` already carries the tilde via
                    // `FaffValueText` wherever it renders; the Alert states
                    // in words what the tilde states visually.
                    Alert(text: "Training effort · race to lock in. Confirm your chip time below, or correct it if it's wrong.",
                          tone: .attention)
                }

                ExpandingRow(
                    label: entry.status == "provisional" ? "Confirm your time" : "Log your result",
                    value: entry.finish?.value,
                    question: "What did you run?",
                    isExpanded: $resultExpanded
                ) {
                    resultForm
                }
                .onAppear {
                    if finishText.isEmpty { finishText = entry.finish?.text ?? "" }
                }
            }
        }
    }

    private var resultForm: some View {
        VStack(alignment: .leading, spacing: V5.S.s16) {
            FaffInput(label: "Finish time", text: $finishText,
                      placeholder: "1:41:53", keyboard: .numbersAndPunctuation)
            FaffInput(label: "Average heart rate", text: $hrText,
                      placeholder: "Optional", unit: "bpm", keyboard: .numberPad)
            FaffButton(submitting ? "Logging…" : "Log result",
                       variant: .primary, size: .md,
                       enabled: !finishText.trimmingCharacters(in: .whitespaces).isEmpty && !submitting,
                       disabledReason: submitting ? nil : "A finish time is the one thing this needs. Heart rate is optional.") {
                guard !submitting else { return }
                submitting = true
                let finish = finishText.trimmingCharacters(in: .whitespaces)
                let hr = Int(hrText.trimmingCharacters(in: .whitespaces))
                Task {
                    await onSubmitResult(finish, hr)
                    await MainActor.run { submitting = false }
                }
            }
        }
    }

    // MARK: Stats row · Goal / Projected / Gap

    /// "we read it and the answer is no" does not apply here — this is a
    /// plain fact rendering, not a refusal. Gap renders amber only when the
    /// runner is behind (a positive gap, the sign the engine already draws).
    private var gapBehind: Bool {
        (raceDetail.gap?.text ?? "").hasPrefix("+")
    }

    private var statsRow: some View {
        HStack(alignment: .firstTextBaseline, spacing: V5.S.s12) {
            stat("Goal", raceDetail.goal.unreadableIfAbsent, ink: V5.textPrimary)
            stat("Projected", raceDetail.projected.unreadableIfAbsent, ink: V5.textPrimary)
            stat("Gap", raceDetail.gap.unreadableIfAbsent, ink: gapBehind ? V5.attention : V5.textPrimary)
        }
        .padding(V5.S.tilePad)
        .background(V5.materialTile, in: RoundedRectangle(cornerRadius: V5.R.r22, style: .continuous))
    }

    private func stat(_ label: String, _ value: FaffValue, ink: Color) -> some View {
        VStack(alignment: .leading, spacing: V5.S.s6) {
            Text(label)
                .font(.faffText(TypeScaleV5.label12))
                .foregroundStyle(V5.textQuiet)
            FaffValueText(value, font: .faffText(20, weight: .semibold), color: ink)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Course

    private var courseSection: some View {
        VStack(alignment: .leading, spacing: V5.S.s10) {
            V5SectionLabel(text: "Course").padding(.horizontal, V5.S.s4)
            Tile {
                ElevationProfile(points: raceDetail.elevation,
                                  marks: raceDetail.elevationMarks.map(\.mark),
                                  footnotes: raceDetail.elevationFootnotes,
                                  height: 120)
            }
        }
    }

    // MARK: Pace plan · named sections, never a per-mile chart

    private var pacePlanSection: some View {
        VStack(alignment: .leading, spacing: V5.S.s16) {
            V5SectionLabel(text: "Pace plan").padding(.horizontal, V5.S.s4)
            ForEach(raceDetail.pacePlan) { row in
                paceSection(row)
            }
        }
    }

    private func paceSection(_ row: V5Row) -> some View {
        VStack(alignment: .leading, spacing: V5.S.s10) {
            HStack(alignment: .firstTextBaseline, spacing: V5.S.s12) {
                Text(row.label)
                    .font(.faffDisplay(15))
                    .textCase(.uppercase)
                    .tracking(15 * 0.06)
                    .foregroundStyle(V5.textPrimary)
                Spacer(minLength: 0)
                if let sub = row.sub {
                    Text(sub)
                        .font(.faffText(TypeScaleV5.label13))
                        .foregroundStyle(V5.textQuiet)
                        .multilineTextAlignment(.trailing)
                }
            }
            .padding(.horizontal, V5.S.s4)

            HStack(alignment: .firstTextBaseline) {
                Text("Pace")
                    .font(.faffText(TypeScaleV5.body15))
                    .foregroundStyle(V5.textSecondary)
                Spacer(minLength: V5.S.s12)
                FaffValueText(row.value?.value ?? .unreadable,
                              font: .faffText(TypeScaleV5.body17),
                              color: V5.textPrimary)
            }
            .padding(.horizontal, V5.S.tilePad)
            .padding(.vertical, V5.S.s16)
            .background(V5.materialTile, in: RoundedRectangle(cornerRadius: V5.R.r18, style: .continuous))
        }
    }

    // MARK: Taper · a designed absence when the block has no taper phase yet

    private func taperSection(progress: Double) -> some View {
        VStack(alignment: .leading, spacing: V5.S.s12) {
            Text("Taper")
                .font(.faffDisplay(15))
                .textCase(.uppercase)
                .tracking(15 * 0.06)
                .foregroundStyle(V5.textSecondary)
            RangeScale(mode: .progress,
                       min: 0, max: 1,
                       value: progress,
                       endpoints: raceDetail.taperEndpoints.count >= 2
                           ? (raceDetail.taperEndpoints[0], raceDetail.taperEndpoints[1])
                           : nil,
                       centerLabel: raceDetail.taperCentreLabel,
                       hue: .phase)
        }
        .padding(V5.S.tilePad)
        .background(V5.materialTile, in: RoundedRectangle(cornerRadius: V5.R.r22, style: .continuous))
    }
}

// MARK: - Preview

#Preview("Race detail · 8a") {
    RaceDetailV5(raceDetail: .v5Sample, onGearRowTap: { _ in }, onBack: {})
        .preferredColorScheme(.dark)
}

#Preview("Race detail · provisional result") {
    RaceDetailV5(raceDetail: .v5SampleProvisional, onGearRowTap: { _ in }, onBack: {})
        .preferredColorScheme(.dark)
}

#Preview("Race detail · no result yet") {
    RaceDetailV5(raceDetail: .v5SampleNoResult, onGearRowTap: { _ in }, onBack: {})
        .preferredColorScheme(.dark)
}

extension V5RaceDetail {
    /// Built from the prototype's own `RACE_DETAIL` sample
    /// (`docs/design/iphone-v5/reference/screens/_script-data.js`), so the
    /// screen can be looked at without a server. Upcoming, so no result
    /// section — `resultEntry` is nil the way the route sends it pre-race.
    static let v5Sample = V5RaceDetail(
        slug: "cim",
        name: "CIM",
        dateLine: "Marathon · Sunday 7 December · 10 weeks out",
        goal: V5Number(text: "3:30:00", modelled: false),
        projected: V5Number(text: "3:31:48", modelled: true),
        gap: V5Number(text: "+1:48", modelled: false),
        elevation: [120, 118, 114, 116, 108, 102, 98, 90, 84, 80, 76, 70, 64, 60,
                    55, 50, 44, 40, 36, 30, 24, 18, 10, 4, 0, 0],
        elevationMarks: [
            V5ElevationMark(id: "m1", at: 0.08, label: "Rollers, mile 3"),
            V5ElevationMark(id: "m2", at: 0.5, label: "Big drop, mile 16"),
            V5ElevationMark(id: "m3", at: 0.93, label: "Flat to the line")
        ],
        elevationFootnotes: ["Net −120 ft", "Nothing over 2%"],
        pacePlan: [
            V5Row(id: "p1", label: "Miles 1–6", sub: "Easy into it",
                  value: V5Number(text: "8:00–8:10/mi", modelled: false), action: nil),
            V5Row(id: "p2", label: "Miles 7–20", sub: "Marathon effort, the pace that matters",
                  value: V5Number(text: "7:58–8:05/mi", modelled: false), action: nil),
            V5Row(id: "p3", label: "Miles 21–26.2", sub: "Whatever is left, honestly",
                  value: V5Number(text: "Even or better", modelled: false), action: nil)
        ],
        taperProgress: 10.0 / 16.0,
        taperEndpoints: ["Week 10", "16-week block"],
        taperCentreLabel: "Three weeks out",
        gear: [
            V5Row(id: "shoe-1", label: "Endorphin Speed 4", sub: "214 mi · plenty left for race day",
                  value: V5Number(text: "Change", modelled: false), action: "changeShoe")
        ],
        coachLine: "The course drops the whole way · bank nothing early and it pays you back after mile 20.",
        resultEntry: nil
    )

    /// A past race with an auto-detected (watch-matched, not chip-confirmed)
    /// finish — rule one's whole reason for this section to exist. `finish`
    /// carries `modelled: true`, so the value drawn in the entry row's own
    /// chevron-value slot already shows the amber tilde before the Alert's
    /// copy says the same thing in words.
    static let v5SampleProvisional: V5RaceDetail = {
        let r = v5Sample
        return V5RaceDetail(
            slug: "cedar-falls-half", name: "Cedar Falls Half",
            dateLine: "Half marathon · Sunday 3 August", goal: r.goal, projected: r.projected, gap: r.gap,
            elevation: r.elevation, elevationMarks: r.elevationMarks, elevationFootnotes: r.elevationFootnotes,
            pacePlan: r.pacePlan, taperProgress: nil, taperEndpoints: [], taperCentreLabel: nil,
            gear: [], coachLine: r.coachLine,
            resultEntry: V5RaceResultEntry(isPast: true, status: "provisional",
                                            finish: V5Number(text: "1:32:04", modelled: true))
        )
    }()

    /// A past race with nothing logged at all yet — the plain "Log your
    /// result" entry row, no Alert.
    static let v5SampleNoResult: V5RaceDetail = {
        let r = v5Sample
        return V5RaceDetail(
            slug: "sombrero-half", name: "Sombrero Half",
            dateLine: "Half marathon · Sunday 15 June", goal: r.goal, projected: r.projected, gap: r.gap,
            elevation: r.elevation, elevationMarks: r.elevationMarks, elevationFootnotes: r.elevationFootnotes,
            pacePlan: r.pacePlan, taperProgress: nil, taperEndpoints: [], taperCentreLabel: nil,
            gear: [], coachLine: r.coachLine,
            resultEntry: V5RaceResultEntry(isPast: true, status: nil, finish: nil)
        )
    }()
}
