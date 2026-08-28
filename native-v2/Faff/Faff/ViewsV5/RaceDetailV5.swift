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

                // The prototype specified `gap:24px` here — the upper end of the
                // brief's own stated 20-24 "between groups" range, which is exactly
                // the kind of per-screen pick-a-number-in-the-range latitude that
                // reads as inconsistency once two screens land on different ends of
                // it. Unified onto `betweenGroups`, the same rhythm Today/Block/
                // Races already use for this exact relationship.
                VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
                    statsRow

                    coachGoalSection

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
                // A vertical page must never pan sideways — see `v5PageWidth`.
                .v5PageWidth()
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

    /// "Projected" is a claim about the future. On a race that has already
    /// been run the middle column holds the finish the runner actually
    /// recorded, so the label has to say so — the route stops projecting a
    /// past race and sends the result in that slot instead.
    ///
    /// 2026-08-25 · AND THE VALUE HAS TO AGREE. This read `isPast` alone, so
    /// the word "Result" was a claim about which SLOT the route filled rather
    /// than about the number in it. `V5Number` carries `modelled` for exactly
    /// this and the label ignored it.
    ///
    /// The tilde is retired, so on this screen the label is the ONLY thing
    /// carrying provenance — which makes "Result" over a modelled figure the
    /// strongest possible false claim, and an unmarked one. Driven on a
    /// simulator, the catalog's own past-race samples showed a marathon
    /// PROJECTION of 3:31:48 under the word "Result" on a half marathon, one
    /// of them directly above the words "Log your result". `racePlateFor`
    /// cannot currently produce that pair, so this is a guard rather than a
    /// live bug — but a guard is what makes it stay that way, and a label
    /// derived from a sibling field instead of from its own value is the
    /// shape that lets it come back.
    private var middleStatLabel: String {
        let past = raceDetail.resultEntry?.isPast == true
        let measured = raceDetail.projected?.modelled == false
        return past && measured ? "Result" : "Projected"
    }

    /// AN UNSET GOAL IS NOT AN UNREADABLE ONE.
    ///
    /// All three columns rendered through `unreadableIfAbsent`, which turns
    /// nil into `FaffValue.unreadable` — a FAULT RED dash that VoiceOver reads
    /// as "could not be read". The add-a-race sheet calls a goal time
    /// "Optional", so a race entered without one drew two red dashes claiming
    /// a data failure that never happened. Fault red is defined as "we could
    /// not read this value" and "never used to render a real value"; rule
    /// three is the same idea in the other direction, that a designed absence
    /// must not wear the outage's clothes.
    ///
    /// There is no fourth `FaffBasis` for "absent by design", and inventing
    /// one is the design system's call, not this screen's. So the column is
    /// simply not drawn: nothing is claimed about a number nobody entered.
    /// A read that genuinely failed does not reach this screen at all — the
    /// route answers `outage()` for the whole payload.
    static func showsColumns(goal: String?, middle: String?, gap: String?) -> (goal: Bool, middle: Bool, gap: Bool, any: Bool) {
        let g = goal?.isEmpty == false
        let m = middle?.isEmpty == false
        let p = gap?.isEmpty == false
        return (g, m, p, g || m || p)
    }

    @ViewBuilder
    private var statsRow: some View {
        let cols = Self.showsColumns(goal: raceDetail.goal?.text,
                                     middle: raceDetail.projected?.text,
                                     gap: raceDetail.gap?.text)
        if cols.any {
            HStack(alignment: .firstTextBaseline, spacing: V5.S.s12) {
                if cols.goal {
                    stat("Goal", raceDetail.goal.unreadableIfAbsent, ink: V5.textPrimary)
                }
                if cols.middle {
                    stat(middleStatLabel, raceDetail.projected.unreadableIfAbsent, ink: V5.textPrimary)
                }
                if cols.gap {
                    stat("Gap", raceDetail.gap.unreadableIfAbsent, ink: gapBehind ? V5.attention : V5.textPrimary)
                }
            }
            .padding(V5.S.tilePad)
            .background(V5.materialTile, in: RoundedRectangle(cornerRadius: V5.R.r22, style: .continuous))
        }
    }

    private func stat(_ label: String, _ value: FaffValue, ink: Color) -> some View {
        VStack(alignment: .leading, spacing: V5.S.s6) {
            Text(label)
                .font(.faffText(TypeScaleV5.label12))
                .foregroundStyle(V5.textQuiet)
            FaffValueText(value, font: .faffText(20, weight: .semibold), color: ink)
                // The third copy of the Goal/Projected/Gap row (the panel
                // plate and the decision card's target tiles are the other
                // two), and it fails the same way: three columns across a
                // phone cannot hold a full marathon time at accessibility
                // sizes, and it broke as "3:30:0" / "0" and "~3:31:" / "48".
                // Whole and smaller beats large and shattered.
                .lineLimit(1)
                .minimumScaleFactor(0.5)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        // Goal, Projected and Gap read as three labels then three values,
        // three swipes apart. Paired, and the tilde's "estimated" survives
        // into the pair.
        .accessibilityElement(children: .combine)
    }

    // MARK: Coach-set goal
    //
    // Shown ONLY while the runner's own goal is empty — the moment they state
    // one, the server stops sending `coachGoal` and this section vanishes,
    // leaving the stated goal rendering exactly as it always has. The guard
    // here re-checks `goal == nil` anyway so a payload that carried both can
    // never draw a second, competing goal (standing rule: the coach projects,
    // it never renegotiates a stated goal).
    //
    // RULE ONE: every tier is modelled by construction, so each time wears
    // the amber tilde — the same treatment the web's RaceView gives its
    // "COACH SET · A ~45:00 · B ~45:55 · C ~46:50" line. An effort framing
    // (C race, hilly course) has no numbers at all, by doctrine, and renders
    // the framing sentence alone.

    @ViewBuilder
    private var coachGoalSection: some View {
        if raceDetail.goal == nil, let cg = raceDetail.coachGoal {
            VStack(alignment: .leading, spacing: V5.S.s6) {
                Text("COACH SET")
                    .font(.faffText(TypeScaleV5.label12, weight: .bold))
                    .tracking(TypeScaleV5.label12 * 0.08)
                    .foregroundStyle(V5.textQuiet)
                if cg.hasTiers {
                    coachTierLine(cg)
                }
                if let line = cg.line, !line.isEmpty {
                    Text(line)
                        .font(.faffText(TypeScaleV5.label13))
                        .foregroundStyle(V5.textQuiet)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(V5.S.tilePad)
            .background(V5.materialTile, in: RoundedRectangle(cornerRadius: V5.R.r22, style: .continuous))
            // One element: "Coach set. A, estimated 45:00 …" — the tiers and
            // their estimated-ness arrive as a sentence, not six swipes.
            .accessibilityElement(children: .combine)
        }
    }

    /// "A ~45:00 · B ~45:55 · C ~46:50" — every time is a modelled value, so
    /// the mark is drawn by FaffValueText, never as a literal character.
    private func coachTierLine(_ cg: V5CoachGoal) -> some View {
        HStack(spacing: V5.S.s6) {
            coachTier("A", cg.aDisplay)
            coachTierDot
            coachTier("B", cg.bDisplay)
            coachTierDot
            coachTier("C", cg.cDisplay)
        }
        .lineLimit(1)
        .minimumScaleFactor(0.6)
    }

    private var coachTierDot: some View {
        Text("·")
            .font(.faffText(17, weight: .semibold))
            .foregroundStyle(V5.textQuiet)
    }

    private func coachTier(_ label: String, _ display: String?) -> some View {
        HStack(spacing: V5.S.s2) {
            Text(label)
                .font(.faffText(17, weight: .semibold))
                .foregroundStyle(V5.textSecondary)
            FaffValueText(.modelled(display ?? "—"), font: .faffText(17, weight: .semibold))
        }
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
    //
    // Guarded on `isEmpty` the way the gear section above already is. The
    // route only builds a pace plan when the race carries a GOAL TIME, and
    // the add-a-race form says in as many words that a goal time is
    // "Optional" — so any race entered without one drew the words "PACE
    // PLAN" over nothing at all. A header standing over an empty list is a
    // header promising something the screen does not have.

    @ViewBuilder
    private var pacePlanSection: some View {
        if !raceDetail.pacePlan.isEmpty {
            VStack(alignment: .leading, spacing: V5.S.s16) {
                V5SectionLabel(text: "Pace plan").padding(.horizontal, V5.S.s4)
                ForEach(raceDetail.pacePlan) { row in
                    paceSection(row)
                }
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
        resultEntry: nil,
        coachGoal: nil
    )

    // ── The half-marathon samples' own course and plan ──────────────────────
    //
    // 2026-08-25 · the three half samples below were each `let r = v5Sample`
    // followed by a field-by-field copy, and every one of them inherited CIM's
    // marathon numbers: goal 3:30:00, projection 3:31:48, gap +1:48, an
    // elevation mark reading "Big drop, mile 16", and a pace plan whose last
    // row is "Miles 21–26.2". Rendered, the Sombrero Half showed
    // "Result 3:31:48" — a MARATHON projection, under the word Result, on a
    // thirteen-mile race, directly above the words "Log your result".
    //
    // A catalog exists so a screen gets LOOKED AT. A sample that cannot happen
    // makes the screen unreadable as evidence: every real defect on it is
    // indistinguishable from the sample being nonsense, which is how the
    // "Result over a modelled number" label bug above sat unnoticed on three
    // entries at once. Halves get a half's course and a half's plan.
    static let halfElevation: [Double] = [
        80, 78, 76, 79, 74, 70, 66, 60, 54, 50, 46, 40, 34,
        30, 26, 20, 14, 10, 6, 2, 0,
    ]
    static let halfElevationMarks: [V5ElevationMark] = [
        V5ElevationMark(id: "m1", at: 0.15, label: "Rollers, mile 2"),
        V5ElevationMark(id: "m2", at: 0.53, label: "Big drop, mile 7"),
        V5ElevationMark(id: "m3", at: 0.92, label: "Flat to the line"),
    ]
    /// 1:30:00 over 13.11 mi is 6:52/mi. Opening a shade easy, holding, then
    /// whatever is left — the same three-beat shape as the marathon plan.
    static let halfPacePlan: [V5Row] = [
        V5Row(id: "p1", label: "Miles 1–3", sub: "Easy into it",
              value: V5Number(text: "6:58–7:04/mi", modelled: false), action: nil),
        V5Row(id: "p2", label: "Miles 4–10", sub: "Threshold effort, the pace that matters",
              value: V5Number(text: "6:48–6:54/mi", modelled: false), action: nil),
        V5Row(id: "p3", label: "Miles 11–13.1", sub: "Whatever is left, honestly",
              value: V5Number(text: "Even or better", modelled: false), action: nil),
    ]

    /// A past race with an auto-detected (watch-matched, not chip-confirmed)
    /// finish — rule one's whole reason for this section to exist. `finish`
    /// carries `modelled: true`, so the value drawn in the entry row's own
    /// chevron-value slot already shows the amber tilde before the Alert's
    /// copy says the same thing in words.
    static let v5SampleProvisional: V5RaceDetail = {
        return V5RaceDetail(
            slug: "cedar-falls-half", name: "Cedar Falls Half",
            dateLine: "Half marathon · Sunday 3 August",
            goal: V5Number(text: "1:30:00", modelled: false),
            // `racePlateFor` puts the FINISH in this slot for a past race, at
            // `modelled: false`, and measures the gap against the goal. The
            // provisional reading is the only finish there is, so it is what
            // the plate carries — and the Provisional Result section below is
            // what says it is not chip-confirmed yet.
            projected: V5Number(text: "1:32:04", modelled: false),
            gap: V5Number(text: "+2:04", modelled: false),
            elevation: halfElevation, elevationMarks: halfElevationMarks,
            elevationFootnotes: ["Net −80 ft", "Nothing over 2%"],
            pacePlan: halfPacePlan, taperProgress: nil, taperEndpoints: [], taperCentreLabel: nil,
            gear: [], coachLine: "The drop is all in the second half · run the first six by effort.",
            resultEntry: V5RaceResultEntry(isPast: true, status: "provisional",
                                            finish: V5Number(text: "1:32:04", modelled: true)),
            coachGoal: nil
        )
    }()

    /// A past race with nothing logged at all yet — the plain "Log your
    /// result" entry row, no Alert.
    static let v5SampleNoResult: V5RaceDetail = {
        return V5RaceDetail(
            slug: "sombrero-half", name: "Sombrero Half",
            dateLine: "Half marathon · Sunday 15 June",
            goal: V5Number(text: "1:30:00", modelled: false),
            // PAST AND UNFINISHED · `racePlateFor` returns `middleSec: nil` and
            // `gapSec: nil` here, and `showsColumns` then draws neither. A race
            // with nothing logged has no result and nothing to gap against.
            projected: nil, gap: nil,
            elevation: halfElevation, elevationMarks: halfElevationMarks,
            elevationFootnotes: ["Net −80 ft", "Nothing over 2%"],
            pacePlan: halfPacePlan, taperProgress: nil, taperEndpoints: [], taperCentreLabel: nil,
            gear: [], coachLine: "The drop is all in the second half · run the first six by effort.",
            resultEntry: V5RaceResultEntry(isPast: true, status: nil, finish: nil),
            coachGoal: nil
        )
    }()

    /// AN UPCOMING RACE ENTERED WITHOUT A GOAL TIME.
    ///
    /// The add-a-race sheet calls goal time "Optional" in as many words, and
    /// `app/api/v5/race/[slug]/route.ts` only builds a pace plan when a goal
    /// exists — so this is not a corner case, it is what a C race looks like.
    /// It had no sample and no route into the catalog, and `pacePlanSection`
    /// drew the words "PACE PLAN" over nothing at all until 2026-08-24.
    ///
    /// Kept as its own entry rather than folded into one of the samples above
    /// so the empty state stays LOOKED AT rather than reasoned about.
    static let v5SampleNoGoal: V5RaceDetail = {
        let r = v5Sample
        return V5RaceDetail(
            slug: "clarksburg-half", name: "Clarksburg Half",
            dateLine: "Half marathon · Sunday 24 November · 13 weeks out",
            // Upcoming, so the middle column IS a projection — and a half's
            // projection, not the marathon sample's 3:31:48.
            goal: nil, projected: V5Number(text: "1:41:22", modelled: true), gap: nil,
            elevation: halfElevation, elevationMarks: [], elevationFootnotes: r.elevationFootnotes,
            pacePlan: [], taperProgress: nil, taperEndpoints: [], taperCentreLabel: nil,
            gear: [], coachLine: nil,
            resultEntry: V5RaceResultEntry(isPast: false, status: nil, finish: nil),
            // A no-goal race is exactly where the coach-set framing lands —
            // sampled here so the section stays LOOKED AT, same rule as the
            // empty state this entry already exists for.
            coachGoal: V5CoachGoal(kind: "time",
                                   aDisplay: "1:39:30", bDisplay: "1:41:20", cDisplay: "1:43:10",
                                   line: "Coach set from your current fitness. Yours to edit.")
        )
    }()
}
