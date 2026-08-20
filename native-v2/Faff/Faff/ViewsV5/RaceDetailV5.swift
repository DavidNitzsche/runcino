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

import SwiftUI

// MARK: - Screen

struct RaceDetailV5: View {
    let raceDetail: V5RaceDetail

    /// Fires when a tappable gear row (one whose `action` the engine set) is
    /// tapped. The screen does not know what "Change" does — that is the
    /// composition root's job.
    var onGearRowTap: ((V5Row) -> Void)? = nil
    var onBack: (() -> Void)? = nil

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                AppBar(title: raceDetail.name, eyebrow: raceDetail.dateLine, onBack: onBack)

                // The prototype's content band spells this out as `gap:24px`
                // (`padding:0 16px 32px;gap:24px`), the upper end of the
                // brief's stated 20–24 "between groups" range.
                VStack(alignment: .leading, spacing: V5.S.s24) {
                    statsRow

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

    // MARK: Stats row · Goal / Projected / Gap

    /// "we read it and the answer is no" does not apply here — this is a
    /// plain fact rendering, not a refusal. Gap renders amber only when the
    /// runner is behind (a positive gap, the sign the engine already draws).
    private var gapBehind: Bool {
        (raceDetail.gap?.text ?? "").hasPrefix("+")
    }

    private var statsRow: some View {
        HStack(alignment: .firstTextBaseline, spacing: V5.S.s12) {
            stat("Goal", raceDetail.goal.value, ink: V5.textPrimary)
            stat("Projected", raceDetail.projected.value, ink: V5.textPrimary)
            stat("Gap", raceDetail.gap.value, ink: gapBehind ? V5.attention : V5.textPrimary)
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

extension V5RaceDetail {
    /// Built from the prototype's own `RACE_DETAIL` sample
    /// (`docs/design/iphone-v5/reference/screens/_script-data.js`), so the
    /// screen can be looked at without a server.
    static let v5Sample = V5RaceDetail(
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
        coachLine: "The course drops the whole way · bank nothing early and it pays you back after mile 20."
    )
}
