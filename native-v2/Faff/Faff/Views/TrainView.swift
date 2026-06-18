//
//  TrainView.swift
//
//  Train tab (rewrite 2026-06-02 round 41 · design_handoff_train_combined).
//  One screen, one job: navigate the whole multi-week plan.
//
//  Composition top → bottom:
//    1. Header  · ROAD TO <race> · <goal>  |  <days>d  →  PHASE big +
//       "Phase N · <subtitle>"  +  WK x OF y · z MI pill
//    2. THIS WEEK card · 7-day schedule (dot · name · sub · meta · done/today)
//    3. Plan adjustments expander (reuses WhatChangedExpander)
//    4. FULL PLAN card · WEEKS ↔ CALENDAR segmented lens
//        · WEEKS: phases grouped, volume bar, key session, ★ for key
//          workouts, NOW tag for current. Tap expands a 7-day peek AND
//          warms the mesh to that week's phase.
//        · CALENDAR: month grid with day-tinted cells, today ringed,
//          race day flagged 🏁. Tap a day → fills detail strip below.
//
//  Phase mesh is the soul · exploring future weeks warms cool→hot. Default
//  is the current phase. Reverts when the user dismisses any selection.
//

import SwiftUI

/// Distance label · whole miles show clean ("6"), half/odd miles keep one
/// decimal ("7.5"). Matches Today + the calendar so a 7.5 mi session never
/// reads as "8" on one screen and "7.5" on another (David, 2026-06-16).
private func trainMi(_ m: Double) -> String {
    m.truncatingRemainder(dividingBy: 1) == 0
        ? String(format: "%.0f", m)
        : String(format: "%.1f", m)
}

struct TrainView: View {
    let onProfile: () -> Void

    @State private var state: TrainingState? =
        AppCache.read(.trainingState, as: TrainingState.self)
    @State private var planAdaptIntents: [CoachIntent]?
    @State private var profile: ProfileState? =
        AppCache.read(.profileState, as: ProfileState.self)

    // MARK: Lens + selection state

    enum TrainLens: String, CaseIterable { case weeks, calendar }
    @State private var lens: TrainLens = .weeks
    @State private var expandedWeekIdx: Int? = nil
    @State private var calMonthOffset: Int = 0          // 0 = month containing current week
    @State private var selectedCalDate: String? = nil   // ISO yyyy-mm-dd
    @State private var refreshing = false

    /// Phase the mesh currently renders. Defaults to the current week's
    /// phase and shifts (warms) when the runner explores a future week
    /// or pages the calendar forward.
    @State private var displayPhase: TrainPhase = .base

    // MARK: Body

    var body: some View {
        ZStack {
            FaffMeshView(mesh: .neutral)
                .ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    // Reserve the shared header-pill slot (50pt bar + ~82pt
                    // pill), matching the Today week strip. The BUILD hero
                    // scrolls and dissolves behind the pill like TEMPO does.
                    Color.clear.frame(height: 132)
                    header
                        .padding(.horizontal, Theme.Space.pageH)
                        .padding(.top, 6)
                    thisWeekCard
                        .padding(.horizontal, Theme.Space.pageH)
                        .padding(.top, Theme.Space.section)
                    execStripCard
                        .padding(.horizontal, Theme.Space.pageH)
                        .padding(.top, Theme.Space.section)
                    adjustmentsBlock
                        .padding(.horizontal, Theme.Space.pageH)
                        .padding(.top, Theme.Space.section)
                    fullPlanCard
                        .padding(.horizontal, Theme.Space.pageH)
                        .padding(.top, Theme.Space.section)
                    Spacer(minLength: 110) // tab bar clearance
                }
            }
            .refreshable { await reload() }
            // Dissolve the BUILD hero into the mesh behind the frosted pill,
            // same as TEMPO on Today (clear above the pill, ramp behind it).
            .faffHeaderDissolve(clearTo: 56, opaqueAt: 80)
        }
        // Shared frosted header pill · phase summary in the week-strip slot.
        .faffHeaderPill { phasePill }
        .task { await reload() }
        .onReceive(NotificationCenter.default.publisher(for: .faffForegroundRefresh)) { _ in
            Task { await reload() }
        }
        .onAppear { syncDisplayPhase() }
    }

    /// Glance pill for the shared header slot · phase eyebrow + 2-line summary,
    /// sized to match the Today week strip so every tab carries one header.
    @ViewBuilder
    private var phasePill: some View {
        let phaseKey = (state?.currentPhase ?? "base").lowercased()
        let phase = TrainPhase(phaseKey: phaseKey)
        let totalWks = state?.weeks.count ?? 13
        let weeks = state?.weeks ?? []
        let range = phaseWeekRange(phaseKey: phaseKey, weeks: weeks)
        let phaseColor = accent(for: phase)
        HStack(alignment: .top, spacing: 12) {
            Capsule()
                .fill(phaseColor)
                .shadow(color: phaseColor.opacity(0.6), radius: 4)
                .frame(width: 4)
            VStack(alignment: .leading, spacing: 6) {
                Text("\(phase.label) PHASE · WK \(range.0)–\(range.1) OF \(totalWks)")
                    .font(.body(10.5, weight: .extraBold))
                    .tracking(1.4)
                    .foregroundStyle(phaseColor)
                    .lineLimit(1).minimumScaleFactor(0.8)
                Text(phaseContextBody(for: phase))
                    .font(.body(12.5, weight: .semibold))
                    .foregroundStyle(Theme.txt.opacity(0.82))
                    .lineSpacing(1)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 15)
        .padding(.vertical, 13)
    }

    // MARK: Topbar (avatar + refresh)

    @ViewBuilder
    private var topbar: some View {
        HStack {
            Button { onProfile() } label: {
                Group {
                    if !avatarInitials.isEmpty {
                        Text(avatarInitials).font(.body(12, weight: .bold))
                    } else {
                        Image(systemName: "person.fill")
                            .font(.system(size: 13, weight: .bold))
                    }
                }
                .foregroundStyle(Theme.txt)
                .frame(width: 32, height: 32)
                .background(Theme.Glass.fill, in: Circle())
                .overlay(Circle().stroke(Theme.Glass.line, lineWidth: 1))
            }
            .buttonStyle(.plain)
            Spacer()
            refreshButton
        }
    }

    private var avatarInitials: String { profile?.identity.avatarInitials ?? "" }

    private var refreshButton: some View {
        Button {
            guard !refreshing else { return }
            refreshing = true
            Task {
                await reload()
                await MainActor.run { refreshing = false }
            }
        } label: {
            Image(systemName: "arrow.triangle.2.circlepath")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(Theme.txt.opacity(refreshing ? 0.4 : 0.85))
                .frame(width: 32, height: 32)
                .background(Theme.Glass.fill, in: Circle())
                .overlay(Circle().stroke(Theme.Glass.line, lineWidth: 1))
                .rotationEffect(.degrees(refreshing ? 360 : 0))
                .animation(refreshing ? .linear(duration: 1).repeatForever(autoreverses: false) : .default, value: refreshing)
        }
        .buttonStyle(.plain)
        .disabled(refreshing)
    }

    // MARK: Header (phase big — the lone headline below the pill)

    @ViewBuilder
    private var header: some View {
        let phaseKey = (state?.currentPhase ?? "base").lowercased()
        let phase = TrainPhase(phaseKey: phaseKey)
        let phaseColor = accent(for: phase)

        // Phase big — leads the body right below the pill, the way TEMPO
        // leads Today. The pill already carries phase · week range · focus,
        // so the body needs only the headline (the THIS-WEEK card follows).
        Text(phase.label)
            .font(.heroDisplay(88))
            .tracking(-2)
            .foregroundStyle(phaseColor)
            .minimumScaleFactor(0.55)
            .lineLimit(1)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: This week

    @ViewBuilder
    private var thisWeekCard: some View {
        if let curWeek = state?.weeks.first(where: { $0.isCurrent }) {
            VStack(alignment: .leading, spacing: 13) {
                HStack(alignment: .firstTextBaseline) {
                    Text("WK \((state?.currentWeekIdx ?? 0) + 1) OF \(state?.weeks.count ?? 13)")
                        .font(.body(10.5, weight: .extraBold))
                        .tracking(1.4)
                        .foregroundStyle(Theme.txt.opacity(0.66))
                    Spacer()
                    // Progress, not just the plan · miles run so far this week
                    // (sum of actuals) over the planned total.
                    Text("\(trainMi((curWeek.days.reduce(0.0) { $0 + $1.doneMi } * 10).rounded() / 10)) / \(trainMi(curWeek.plannedMi)) mi")
                        .font(.body(11, weight: .bold))
                        .tracking(0.3)
                        .foregroundStyle(Theme.txt.opacity(0.78))
                }
                VStack(spacing: 0) {
                    ForEach(Array(curWeek.days.enumerated()), id: \.offset) { idx, day in
                        if day.type.lowercased() == "rest" {
                            TrainWeekRow(
                                day: day,
                                isFirst: idx == 0,
                                isToday: day.date == (state?.today ?? "")
                            )
                        } else if let actId = day.activityId {
                            NavigationLink(value: FaffRoute.runDetail(id: actId)) {
                                TrainWeekRow(
                                    day: day,
                                    isFirst: idx == 0,
                                    isToday: day.date == (state?.today ?? "")
                                )
                            }
                            .buttonStyle(.plain)
                        } else {
                            Button {
                                NotificationCenter.default.post(
                                    name: .faffJumpToDay,
                                    object: nil,
                                    userInfo: ["date": day.date]
                                )
                            } label: {
                                TrainWeekRow(
                                    day: day,
                                    isFirst: idx == 0,
                                    isToday: day.date == (state?.today ?? "")
                                )
                                .frame(maxWidth: .infinity)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .padding(15)
            .background(Color(hex: 0x0C1416).opacity(0.32),
                        in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .stroke(Color.white.opacity(0.15), lineWidth: 1)
            )
        }
    }

    // MARK: Phase context

    @ViewBuilder
    private var phaseContextCard: some View {
        let phaseKey = (state?.currentPhase ?? "base").lowercased()
        let phase = TrainPhase(phaseKey: phaseKey)
        let totalWks = state?.weeks.count ?? 13
        let weeks = state?.weeks ?? []
        let range = phaseWeekRange(phaseKey: phaseKey, weeks: weeks)
        let phaseColor = accent(for: phase)

        HStack(alignment: .top, spacing: 12) {
            Capsule()
                .fill(phaseColor)
                .shadow(color: phaseColor.opacity(0.6), radius: 4)
                .frame(width: 4)
                .padding(.vertical, 2)

            VStack(alignment: .leading, spacing: 8) {
                Text("\(phase.label) PHASE · WK \(range.0)–\(range.1) OF \(totalWks)")
                    .font(.body(10.5, weight: .extraBold))
                    .tracking(1.4)
                    .foregroundStyle(phaseColor)

                Text(phaseContextBody(for: phase))
                    .font(.body(13, weight: .semibold))
                    .foregroundStyle(Theme.txt.opacity(0.78))
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(15)
        .background(Color(hex: 0x0C1416).opacity(0.32),
                    in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(phaseColor.opacity(0.3), lineWidth: 1)
        )
    }

    // MARK: Execution strip

    /// Last 4 completed weeks + current week, newest first (current at top).
    /// Computes actualMi by summing day.doneMi — no extra API call needed.
    private var execRows: [ExecRow] {
        guard let weeks = state?.weeks, let curIdx = state?.currentWeekIdx else { return [] }
        let infRank: [String: Int] = [
            "compromised": 0, "slipping": 1, "working": 2, "consistent": 3, "on_track": 4,
        ]
        let infColor: [String: Color] = [
            "on_track":   Color(hex: 0x86EFA0),
            "consistent": Color(hex: 0x86EFA0),
            "working":    Color(hex: 0xF3AD38),
            "slipping":   Color(hex: 0xF3AD38),
            "compromised":Color(hex: 0x646464),
        ]
        var rows: [ExecRow] = []
        for (i, week) in weeks.enumerated() {
            guard i <= curIdx else { break }
            let actualMi = (week.days.reduce(0.0) { $0 + $1.doneMi } * 10).rounded() / 10
            let nonRest = week.days.filter { $0.type.lowercased() != "rest" }
            let sessDone = nonRest.filter { $0.doneMi > 0.1 }.count
            // Worst-ranked trainingInfluence across quality done sessions.
            var worstRank = Int.max
            var worstInf: (kind: String, color: Color)? = nil
            for d in week.days
            where ["intervals","tempo","long"].contains(d.type.lowercased()) && d.doneMi > 0.1 {
                guard let ti = d.trainingInfluence, !ti.kind.isEmpty,
                      let color = infColor[ti.kind] else { continue }
                let rank = infRank[ti.kind] ?? 5
                if rank < worstRank { worstRank = rank; worstInf = (ti.kind, color) }
            }
            rows.append(ExecRow(
                weekIdx: i,
                startDate: week.startDate,
                plannedMi: week.plannedMi,
                actualMi: actualMi,
                sessTotal: nonRest.count,
                sessDone: sessDone,
                influence: worstInf,
                isCurrent: week.isCurrent
            ))
        }
        // Current week first, then last 4 completed in reverse chronological order.
        // Take suffix(5) to give last 4 past + current, then reverse so current is top.
        return Array(rows.suffix(5).reversed())
    }

    @ViewBuilder
    private var execStripCard: some View {
        let rows = execRows
        if !rows.isEmpty {
            VStack(alignment: .leading, spacing: 13) {
                HStack(alignment: .firstTextBaseline) {
                    Text("EXECUTION")
                        .font(.body(10.5, weight: .extraBold))
                        .tracking(1.4)
                        .foregroundStyle(Theme.txt.opacity(0.66))
                    Spacer()
                    let pastCount = rows.filter { !$0.isCurrent }.count
                    if pastCount > 0 {
                        Text("LAST \(pastCount) WEEKS")
                            .font(.body(11, weight: .bold))
                            .tracking(0.3)
                            .foregroundStyle(Theme.txt.opacity(0.78))
                    }
                }
                VStack(spacing: 0) {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { idx, row in
                        ExecStripRow(row: row, isFirst: idx == 0)
                    }
                }
            }
            .padding(15)
            .background(Color(hex: 0x0C1416).opacity(0.32),
                        in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .stroke(Color.white.opacity(0.15), lineWidth: 1)
            )
        }
    }

    // MARK: Adjustments

    @ViewBuilder
    private var adjustmentsBlock: some View {
        if let rows = planAdaptIntents, !rows.isEmpty {
            WhatChangedExpander(intents: rows)
        }
    }

    // MARK: Full plan card

    @ViewBuilder
    private var fullPlanCard: some View {
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text("FULL PLAN · \(state?.weeks.count ?? 13) WEEKS TO RACE")
                    .font(.body(10.5, weight: .extraBold))
                    .tracking(1.4)
                    .foregroundStyle(Theme.txt.opacity(0.66))
                Spacer()
                Text(lens == .weeks ? "★ KEY" : monthHeaderTrailingLabel())
                    .font(.body(11, weight: .bold))
                    .tracking(0.3)
                    .foregroundStyle(Theme.txt.opacity(0.78))
            }
            .padding(.bottom, 13)

            lensToggle
                .padding(.bottom, 14)

            switch lens {
            case .weeks:    weeksLens
            case .calendar: calendarLens
            }
        }
        .padding(15)
        .background(Color(hex: 0x0C1416).opacity(0.32),
                    in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(Color.white.opacity(0.15), lineWidth: 1)
        )
    }

    // MARK: Lens toggle

    @ViewBuilder
    private var lensToggle: some View {
        HStack(spacing: 4) {
            lensButton(.weeks, label: "WEEKS", icon: "list.bullet")
            lensButton(.calendar, label: "CALENDAR", icon: "calendar")
        }
        .padding(4)
        .background(Color.white.opacity(0.1),
                    in: RoundedRectangle(cornerRadius: 13, style: .continuous))
    }

    private func lensButton(_ which: TrainLens, label: String, icon: String) -> some View {
        let on = (lens == which)
        return Button {
            withAnimation(.easeInOut(duration: 0.18)) {
                lens = which
                if which == .weeks { syncDisplayPhase() }
                else { setMonthMesh() }
            }
        } label: {
            HStack(spacing: 7) {
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .bold))
                Text(label)
                    .font(.body(12, weight: .extraBold))
                    .tracking(0.4)
            }
            .foregroundStyle(on ? Color.black : Color.white.opacity(0.6))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 9)
            .background(on ? Color.white.opacity(0.94) : Color.clear,
                        in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    // MARK: Weeks lens

    @ViewBuilder
    private var weeksLens: some View {
        if let weeks = state?.weeks, !weeks.isEmpty {
            let maxMi = max(1.0, weeks.map(\.plannedMi).max() ?? 1)
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(weeks.enumerated()), id: \.offset) { idx, week in
                    let prevPhase = idx == 0 ? "" : weeks[idx - 1].phase
                    if week.phase != prevPhase {
                        phaseDivider(phaseKey: week.phase, weeks: weeks)
                    }
                    TrainWeekRowSummary(
                        week: week,
                        idx: idx,
                        maxMi: maxMi,
                        keyLabel: keyLabel(for: week),
                        starred: isStarWeek(week),
                        selected: expandedWeekIdx == idx,
                        onTap: { tapWeek(idx) }
                    )
                    if expandedWeekIdx == idx {
                        weekDayPeek(week: week)
                            .transition(.opacity.combined(with: .move(edge: .top)))
                    }
                }
                // Race row
                if let race = state?.race, !race.name.isEmpty {
                    raceDividerAndRow(race: race)
                }
            }
        }
    }

    @ViewBuilder
    private func phaseDivider(phaseKey: String, weeks: [TrainingPlanWeek]) -> some View {
        let phase = TrainPhase(phaseKey: phaseKey)
        let range = phaseWeekRange(phaseKey: phaseKey, weeks: weeks)
        HStack(spacing: 10) {
            Text("\(phase.label) · WK \(range.0)–\(range.1)")
                .font(.body(10, weight: .extraBold)).tracking(1.6)
                .foregroundStyle(accent(for: phase))
            Rectangle().fill(accent(for: phase).opacity(0.27))
                .frame(height: 1)
                .frame(maxWidth: .infinity)
        }
        .padding(.top, 14).padding(.bottom, 6)
    }

    @ViewBuilder
    private func weekDayPeek(week: TrainingPlanWeek) -> some View {
        // Seven small dot+mi cells under the row, matching the brief's
        // .wexp-in layout. Reads real day types from the plan.
        HStack(spacing: 5) {
            ForEach(week.days, id: \.id) { day in
                if day.type.lowercased() == "rest" {
                    peekCell(day: day)
                } else if let actId = day.activityId {
                    NavigationLink(value: FaffRoute.runDetail(id: actId)) {
                        peekCell(day: day)
                    }
                    .buttonStyle(.plain)
                } else {
                    Button {
                        NotificationCenter.default.post(
                            name: .faffJumpToDay,
                            object: nil,
                            userInfo: ["date": day.date]
                        )
                    } label: {
                        peekCell(day: day)
                            .frame(maxWidth: .infinity)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(.horizontal, 10).padding(.top, 4).padding(.bottom, 12)
    }

    @ViewBuilder
    private func peekCell(day: TrainingPlanDay) -> some View {
        let isRest = day.type.lowercased() == "rest"
        VStack(spacing: 5) {
            Text(dayLetter(day))
                .font(.body(8.5, weight: .extraBold))
                .foregroundStyle(Theme.txt.opacity(0.5))
            Group {
                if isRest {
                    Capsule().fill(Color.white.opacity(0.4))
                        .frame(width: 8, height: 2)
                } else {
                    Circle().fill(FaffEffort.fromType(day.type).dot)
                        .frame(width: 7, height: 7)
                }
            }
            Text(isRest ? "—" : trainMi(day.mi))
                .font(.body(11, weight: .extraBold))
                .foregroundStyle(Theme.txt)
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private func raceDividerAndRow(race: TrainingRace) -> some View {
        let gold = Color(hex: 0xF3AD38)
        HStack(spacing: 10) {
            Text("RACE")
                .font(.body(10, weight: .extraBold)).tracking(1.6)
                .foregroundStyle(gold)
            Rectangle().fill(gold.opacity(0.27))
                .frame(height: 1)
                .frame(maxWidth: .infinity)
        }
        .padding(.top, 14).padding(.bottom, 6)

        HStack(spacing: 11) {
            Text("★")
                .font(.body(14, weight: .bold))
                .foregroundStyle(gold)
                .frame(width: 20, alignment: .center)
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 3).fill(Color.white.opacity(0.12))
                RoundedRectangle(cornerRadius: 3).fill(gold)
            }
            .frame(width: 54, height: 6)
            Text("\(race.name) · \(race.goal ?? "")")
                .font(.body(13, weight: .semibold))
                .foregroundStyle(Theme.txt)
                .lineLimit(1).truncationMode(.tail)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10).padding(.vertical, 9)
        .background(expandedWeekIdx == -1 ? Color.white.opacity(0.14) : Color.clear,
                    in: RoundedRectangle(cornerRadius: 13))
        .onTapGesture {
            withAnimation(.easeInOut(duration: 0.15)) {
                if expandedWeekIdx == -1 {
                    expandedWeekIdx = nil
                    syncDisplayPhase()
                } else {
                    expandedWeekIdx = -1
                    displayPhase = .race
                }
            }
        }
    }

    // MARK: Calendar lens

    @ViewBuilder
    private var calendarLens: some View {
        VStack(spacing: 0) {
            calendarNav
                .padding(.bottom, 12)
            calendarGrid
            calendarLegend
                .padding(.top, 13)
            calendarSelection
                .padding(.top, 13)
        }
    }

    @ViewBuilder
    private var calendarNav: some View {
        HStack {
            Button { paginateMonth(by: -1) } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.txt)
                    .frame(width: 30, height: 30)
                    .background(Color.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 9))
                    .overlay(RoundedRectangle(cornerRadius: 9).stroke(Color.white.opacity(0.2), lineWidth: 1))
            }
            .buttonStyle(.plain)
            .opacity(calCanGo(-1) ? 1 : 0.3)
            .disabled(!calCanGo(-1))

            Spacer()
            Text(monthHeaderTitle())
                .font(.display(17, weight: .bold)).tracking(0.3)
                .foregroundStyle(Theme.txt)
            Spacer()

            Button { paginateMonth(by: +1) } label: {
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.txt)
                    .frame(width: 30, height: 30)
                    .background(Color.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 9))
                    .overlay(RoundedRectangle(cornerRadius: 9).stroke(Color.white.opacity(0.2), lineWidth: 1))
            }
            .buttonStyle(.plain)
            .opacity(calCanGo(+1) ? 1 : 0.3)
            .disabled(!calCanGo(+1))
        }
    }

    @ViewBuilder
    private var calendarGrid: some View {
        let cells = monthCells()
        VStack(spacing: 4) {
            HStack(spacing: 4) {
                ForEach(["M","T","W","T","F","S","S"], id: \.self) { d in
                    Text(d)
                        .font(.body(9, weight: .extraBold)).tracking(0.5)
                        .foregroundStyle(Theme.txt.opacity(0.45))
                        .frame(maxWidth: .infinity)
                }
            }
            ForEach(0..<6, id: \.self) { row in
                HStack(spacing: 4) {
                    ForEach(0..<7, id: \.self) { col in
                        let i = row * 7 + col
                        if i < cells.count {
                            calendarCell(cells[i])
                        } else {
                            Color.clear.aspectRatio(1, contentMode: .fit)
                                .frame(maxWidth: .infinity)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func calendarCell(_ cell: CalCell) -> some View {
        let isSelected = (selectedCalDate == cell.dateISO && cell.dateISO != nil)
        let gold = Color(hex: 0xF3AD38)
        let bg: Color = {
            if cell.isRace { return gold.opacity(0.2) }
            if isSelected { return Color.white.opacity(0.2) }
            if cell.kind == .empty { return Color.clear }
            return Color.white.opacity(0.05)
        }()
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(bg)
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(cell.isToday ? Color.white : (cell.isRace ? gold : Color.clear),
                                lineWidth: cell.isToday ? 1.6 : (cell.isRace ? 1.4 : 0))
                )
                .aspectRatio(1, contentMode: .fit)
            if let label = cell.dayLabel {
                Text(label)
                    .font(.body(11, weight: .extraBold))
                    .foregroundStyle(Theme.txt.opacity(cell.kind == .rest ? 0.4 : 0.82))
                    .padding(.leading, 5).padding(.top, 5)
            }
            if cell.isRace {
                Text("🏁")
                    .font(.system(size: 10))
                    .padding(.top, 3).padding(.trailing, 4)
                    .frame(maxWidth: .infinity, alignment: .topTrailing)
            }
            VStack {
                Spacer()
                if cell.kind == .normal || cell.isRace {
                    Capsule()
                        .fill(cell.isRace ? gold : cell.tint)
                        .frame(height: 4)
                        .padding(.horizontal, 4)
                        .padding(.bottom, 5)
                }
            }
        }
        .opacity(cell.isPast && !cell.isToday ? 0.4 : 1.0)
        .onTapGesture {
            if cell.kind == .empty { return }
            withAnimation(.easeInOut(duration: 0.15)) {
                if selectedCalDate == cell.dateISO {
                    selectedCalDate = nil
                } else {
                    selectedCalDate = cell.dateISO
                }
            }
        }
    }

    @ViewBuilder
    private var calendarLegend: some View {
        let legends: [(String, Color)] = [
            ("Easy",      FaffEffort.easy.dot),
            ("Tempo",     FaffEffort.tempo.dot),
            ("Intervals", FaffEffort.intervals.dot),
            ("Long",      FaffEffort.long.dot),
            ("Rest",      FaffEffort.rest.dot),
            ("Race",      Color(hex: 0xF3AD38))
        ]
        // Wrap manually so the row doesn't overflow on small phones.
        FlowRow(spacing: 11) {
            ForEach(legends, id: \.0) { item in
                HStack(spacing: 5) {
                    RoundedRectangle(cornerRadius: 3).fill(item.1)
                        .frame(width: 8, height: 8)
                    Text(item.0)
                        .font(.body(10, weight: .extraBold))
                        .foregroundStyle(Theme.txt.opacity(0.72))
                }
            }
        }
    }

    @ViewBuilder
    private var calendarSelection: some View {
        let selected = resolveSelectedCalDay()
        VStack(spacing: 0) {
            Rectangle().fill(Color.white.opacity(0.1)).frame(height: 1)
                .padding(.bottom, 13)
            if let sel = selected, let iso = selectedCalDate {
                let isRest = sel.day.type.lowercased() == "rest"
                if isRest || sel.isRace {
                    calSelectionRow(sel)
                } else if let actId = sel.day.activityId {
                    NavigationLink(value: FaffRoute.runDetail(id: actId)) {
                        calSelectionRow(sel)
                    }
                    .buttonStyle(.plain)
                } else {
                    Button {
                        NotificationCenter.default.post(
                            name: .faffJumpToDay,
                            object: nil,
                            userInfo: ["date": iso]
                        )
                    } label: {
                        calSelectionRow(sel)
                            .frame(maxWidth: .infinity)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            } else {
                Text("Tap a day to see its session")
                    .font(.body(12.5, weight: .semibold))
                    .foregroundStyle(Theme.txt.opacity(0.5))
                    .frame(maxWidth: .infinity, alignment: .center)
                    .frame(minHeight: 46)
            }
        }
    }

    @ViewBuilder
    private func calSelectionRow(_ sel: CalSelected) -> some View {
        HStack(spacing: 12) {
            Circle()
                .fill(sel.isRace ? Color(hex: 0xF3AD38) : FaffEffort.fromType(sel.day.type).dot)
                .frame(width: 11, height: 11)
            VStack(alignment: .leading, spacing: 2) {
                Text(sel.dateHeader)
                    .font(.body(10, weight: .extraBold)).tracking(0.6)
                    .foregroundStyle(Theme.txt.opacity(0.55))
                Text(sel.title)
                    .font(.body(15, weight: .extraBold))
                    .foregroundStyle(Theme.txt)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            Text(sel.meta)
                .font(.body(13, weight: .bold))
                .foregroundStyle(Theme.txt.opacity(0.82))
        }
        .frame(minHeight: 46)
    }

    // MARK: Loaders

    private func reload() async {
        // Compute the ISO start of the current training week (Monday) so the
        // "Plan adjustments this week" expander only shows this week's intents.
        // ISO-8601 week always starts Monday, matching David's Mon-Sun boundary.
        var isoCal = Calendar(identifier: .iso8601)
        isoCal.timeZone = TimeZone.current
        let weekMonday = isoCal.dateInterval(of: .weekOfYear, for: Date())?.start ?? Date()
        let df = DateFormatter(); df.dateFormat = "yyyy-MM-dd"; df.timeZone = isoCal.timeZone
        let weekStartISO = df.string(from: weekMonday)

        async let s  = (try? await API.fetchTrainingState())
        async let p  = (try? await API.fetchProfileState())
        async let ai = (try? await API.fetchCoachIntents(limit: 20, since: weekStartISO, reasonLike: "plan_adapt_"))
        let (st, pf, ints) = await (s, p, ai)
        await MainActor.run {
            if let st { self.state = st }
            if let pf { self.profile = pf }
            self.planAdaptIntents = ints ?? []
            syncDisplayPhase()
            primeCalMonthFromToday()
            // Zero-pop launch · Train surface painted, release the splash gate.
            NotificationCenter.default.post(name: .faffSurfaceReady, object: "train")
        }
    }

    // MARK: Helpers · phase / mesh

    private func syncDisplayPhase() {
        guard expandedWeekIdx == nil else { return }
        let key = (state?.currentPhase ?? "base").lowercased()
        displayPhase = TrainPhase(phaseKey: key)
    }

    private func tapWeek(_ idx: Int) {
        withAnimation(.easeInOut(duration: 0.18)) {
            if expandedWeekIdx == idx {
                expandedWeekIdx = nil
                syncDisplayPhase()
            } else {
                expandedWeekIdx = idx
                if let week = state?.weeks[safe: idx] {
                    displayPhase = TrainPhase(phaseKey: week.phase)
                }
            }
        }
    }

    private func phaseSubtitle(for phase: TrainPhase, totalWeeks: Int) -> String {
        switch phase {
        case .base:  return "Building your aerobic engine."
        case .build: return "Building race-specific fitness."
        case .peak:  return "Sharpening for race day."
        case .taper: return "Banking the fitness."
        case .race:  return "Trust the work."
        }
    }

    /// Pill copy · kept to two lines so it never truncates in the fixed-height
    /// header pill. One tight sentence per phase.
    private func phaseContextBody(for phase: TrainPhase) -> String {
        switch phase {
        case .base:
            return "Easy miles and long runs build the aerobic base."
        case .build:
            return "Tempos and intervals sharpen your threshold and VO2max."
        case .peak:
            return "Race-pace work at peak volume before the taper."
        case .taper:
            return "Volume drops, intensity holds. Sharp by race morning."
        case .race:
            return "Light activation keeps the legs fresh for race day."
        }
    }

    private func accent(for phase: TrainPhase) -> Color { TrainView.phaseAccent(phase) }

    /// Phase identity color · the ONE source for both TrainView phase switches.
    /// base/build/peak/taper come from the CI-locked Theme.Phase palette
    /// (synced byte-for-byte with web · check-palette-sync.sh). `.race` keeps
    /// the amberBright accent (no race hue in the categorical phase scale).
    static func phaseAccent(_ phase: TrainPhase) -> Color {
        switch phase {
        case .base:  return Theme.Phase.base
        case .build: return Theme.Phase.build
        case .peak:  return Theme.Phase.peak
        case .taper: return Theme.Phase.taper
        case .race:  return Theme.Accent.amberBright
        }
    }

    private func phaseWeekRange(phaseKey: String, weeks: [TrainingPlanWeek]) -> (Int, Int) {
        let inPhase = weeks.enumerated().filter { $0.element.phase.lowercased() == phaseKey.lowercased() }
        let first = (inPhase.first?.offset ?? 0) + 1
        let last = (inPhase.last?.offset ?? 0) + 1
        return (first, last)
    }

    private func keyLabel(for week: TrainingPlanWeek) -> String {
        // 2026-06-02 round 48 · pick the "hardest" session of the week
        // and describe it as TYPE WORD + distance, NOT the raw workout
        // name. The old "pick.label" surface returned the workout name
        // ("4×1 mi @ I · 3 min jog") for every quality week · twelve
        // rows of structural noise. Now reads "Intervals · 7.5mi" /
        // "Tempo · 8mi" / "Long · 14mi" · the WEEK'S story in one
        // glance.
        //
        // Priority: race > intervals > tempo > long > easy. Race wins
        // when the week contains the race day.
        let priority: [String: Int] = [
            "race": -1,
            "intervals": 0, "vo2": 0, "vo2max": 0, "fartlek": 0, "quality": 0, "track": 0,
            "threshold": 1, "tempo": 1, "progression": 1,
            "long": 2,
        ]
        let workouts = week.days
            .filter { $0.type.lowercased() != "rest" && $0.type.lowercased() != "easy" }
            .sorted { (priority[$0.type.lowercased()] ?? 99) < (priority[$1.type.lowercased()] ?? 99) }
        if let pick = workouts.first {
            let typeWord = FaffEffort.fromType(pick.type).title
            if pick.type.lowercased() == "race" { return "Race · \(trainMi(pick.mi))mi" }
            if pick.mi > 0 { return "\(typeWord) · \(trainMi(pick.mi))mi" }
            return typeWord
        }
        // Pure easy week → describe the long run instead.
        if let long = week.days.max(by: { $0.mi < $1.mi }), long.mi > 0 {
            return "Long · \(trainMi(long.mi))mi"
        }
        return "Easy + base"
    }

    private func isStarWeek(_ week: TrainingPlanWeek) -> Bool {
        // Mark weeks containing intervals / race-pace as ★ workouts.
        week.days.contains(where: {
            let t = $0.type.lowercased()
            return ["intervals","vo2","vo2max","fartlek","track","quality","threshold","tempo","race"].contains(t)
                && $0.mi >= 3
        })
    }

    private func dayLetter(_ day: TrainingPlanDay) -> String {
        let letters = ["S","M","T","W","T","F","S"]
        let idx = ((day.dow % 7) + 7) % 7
        return letters[idx]
    }

    private func raceShortName(_ raceLabel: String) -> String {
        let words = raceLabel.split(separator: " ").map(String.init)
        if words.count >= 3 {
            let acronym = words.compactMap { $0.first.map(String.init) }.joined()
            if acronym.count >= 3 { return acronym }
        }
        return raceLabel
    }

    // MARK: Helpers · calendar

    private struct CalCell {
        enum Kind { case empty, normal, rest }
        let kind: Kind
        let dayLabel: String?
        let dateISO: String?
        let tint: Color
        let isToday: Bool
        let isRace: Bool
        let isPast: Bool
    }

    private func primeCalMonthFromToday() {
        guard let todayISO = state?.today,
              let today = Self.isoDate(todayISO) else { return }
        // Anchor month offset 0 to the month containing today, so paging
        // forward/back is relative to "this month".
        let cal = Calendar.current
        let comps = cal.dateComponents([.year,.month], from: today)
        if let anchor = cal.date(from: comps), let _ = anchor as Date? {
            // calMonthOffset stays at 0 — we just need anchor for the page
            // headers. Anchor month resolution lives in monthAnchorDate().
        }
    }

    private func monthAnchorDate() -> Date {
        let today = Self.isoDate(state?.today ?? "") ?? Date()
        let cal = Calendar.current
        var comps = cal.dateComponents([.year,.month], from: today)
        comps.day = 1
        let anchor = cal.date(from: comps) ?? today
        return cal.date(byAdding: .month, value: calMonthOffset, to: anchor) ?? anchor
    }

    private func monthHeaderTitle() -> String {
        let f = DateFormatter()
        f.dateFormat = "MMMM yyyy"
        return f.string(from: monthAnchorDate())
    }

    private func monthHeaderTrailingLabel() -> String {
        // Show the season span (e.g. "JUN → AUG") when in calendar lens.
        guard let first = state?.weeks.first?.startDate,
              let last = state?.weeks.last?.startDate,
              let a = Self.isoDate(first),
              let b = Self.isoDate(last) else { return "" }
        let f = DateFormatter(); f.dateFormat = "MMM"
        return "\(f.string(from: a).uppercased()) → \(f.string(from: b).uppercased())"
    }

    private func paginateMonth(by delta: Int) {
        let next = calMonthOffset + delta
        guard calCanGoTo(next) else { return }
        withAnimation(.easeInOut(duration: 0.18)) {
            calMonthOffset = next
            selectedCalDate = nil
            setMonthMesh()
        }
    }

    private func setMonthMesh() {
        // Pick the dominant phase across the anchored month.
        let cal = Calendar.current
        let anchor = monthAnchorDate()
        guard let weeks = state?.weeks else {
            syncDisplayPhase()
            return
        }
        let monthInterval = cal.dateInterval(of: .month, for: anchor)
        let phasesInMonth = weeks.compactMap { wk -> TrainPhase? in
            guard let wd = Self.isoDate(wk.startDate),
                  let mi = monthInterval, mi.contains(wd) else { return nil }
            return TrainPhase(phaseKey: wk.phase)
        }
        let chosen = phasesInMonth.first ?? TrainPhase(phaseKey: state?.currentPhase ?? "base")
        displayPhase = chosen
    }

    private func calCanGo(_ delta: Int) -> Bool { calCanGoTo(calMonthOffset + delta) }

    private func calCanGoTo(_ off: Int) -> Bool {
        // Allow paging across the months the plan touches plus 1 buffer
        // either side, so the runner can peek pre-/post-plan freely.
        guard let weeks = state?.weeks, !weeks.isEmpty else { return false }
        let today = Self.isoDate(state?.today ?? "") ?? Date()
        let cal = Calendar.current
        guard let firstStart = Self.isoDate(weeks.first?.startDate ?? ""),
              let lastStart  = Self.isoDate(weeks.last?.startDate  ?? "") else { return false }
        // Convert today/first/last to month-offset relative to today.
        let f = cal.dateComponents([.month], from: today, to: firstStart).month ?? 0
        let l = cal.dateComponents([.month], from: today, to: lastStart).month ?? 0
        return off >= f - 1 && off <= l + 1
    }

    private func monthCells() -> [CalCell] {
        guard let todayISO = state?.today, let today = Self.isoDate(todayISO)
        else { return [] }
        let cal = Calendar.current
        let anchor = monthAnchorDate()
        let monthComps = cal.dateComponents([.year, .month], from: anchor)
        let firstOfMonth = cal.date(from: monthComps) ?? anchor
        let leadDow = (cal.component(.weekday, from: firstOfMonth) + 5) % 7 // Mon-first
        let daysInMonth = cal.range(of: .day, in: .month, for: firstOfMonth)?.count ?? 30

        var dayMap: [String: TrainingPlanDay] = [:]
        for wk in (state?.weeks ?? []) {
            for d in wk.days { dayMap[d.date] = d }
        }
        let raceISO = state?.race?.date

        var cells: [CalCell] = []
        for _ in 0..<leadDow {
            cells.append(CalCell(kind: .empty, dayLabel: nil, dateISO: nil, tint: .clear,
                                 isToday: false, isRace: false, isPast: false))
        }
        for dayNum in 1...daysInMonth {
            var c = cal.dateComponents([.year, .month], from: firstOfMonth)
            c.day = dayNum
            let date = cal.date(from: c) ?? firstOfMonth
            let iso = Self.isoString(date)
            let isToday = (iso == todayISO)
            let isPast = date < today && !isToday
            let isRace = (iso == raceISO)
            let plannedDay = dayMap[iso]
            let kind: CalCell.Kind = {
                if let p = plannedDay {
                    if p.type.lowercased() == "rest" { return .rest }
                    return .normal
                }
                return .normal // unplanned days (shouldn't happen if plan covers all dates)
            }()
            let tint: Color = {
                if isRace { return Color(hex: 0xF3AD38) }
                if let p = plannedDay { return FaffEffort.fromType(p.type).dot }
                return .clear
            }()
            cells.append(CalCell(kind: kind, dayLabel: "\(dayNum)", dateISO: iso, tint: tint,
                                 isToday: isToday, isRace: isRace, isPast: isPast))
        }
        // Pad to a multiple of 7
        while cells.count % 7 != 0 {
            cells.append(CalCell(kind: .empty, dayLabel: nil, dateISO: nil, tint: .clear,
                                 isToday: false, isRace: false, isPast: false))
        }
        return cells
    }

    // MARK: Calendar selection resolution

    private struct CalSelected {
        let day: TrainingPlanDay
        let dateHeader: String
        let title: String
        let meta: String
        let isRace: Bool
    }

    private func resolveSelectedCalDay() -> CalSelected? {
        guard let iso = selectedCalDate else { return nil }
        let dayMap: [String: TrainingPlanDay] = {
            var m: [String: TrainingPlanDay] = [:]
            for wk in (state?.weeks ?? []) { for d in wk.days { m[d.date] = d } }
            return m
        }()
        let isRace = (iso == state?.race?.date)
        // Build a synthetic TrainingPlanDay for race day if it's not in the plan.
        let day: TrainingPlanDay = dayMap[iso] ?? TrainingPlanDay.placeholder(date: iso, type: isRace ? "race" : "rest")
        let dateHeader: String = {
            let f = DateFormatter(); f.dateFormat = "EEE LLL d"
            if let d = Self.isoDate(iso) { return f.string(from: d).uppercased() }
            return iso
        }()
        let title: String = {
            if isRace { return state?.race?.name ?? "Race day" }
            if day.type.lowercased() == "rest" { return "Rest" }
            return day.label ?? FaffEffort.fromType(day.type).title
        }()
        let meta: String = {
            if isRace {
                let goal = state?.race?.goal ?? ""
                return goal.isEmpty ? "Race" : goal
            }
            if day.type.lowercased() == "rest" { return "Sleep + mobility" }
            return "\(trainMi(day.mi)) mi"
        }()
        return CalSelected(day: day, dateHeader: dateHeader, title: title, meta: meta, isRace: isRace)
    }

    // MARK: Date utilities

    static func isoDate(_ s: String) -> Date? {
        guard !s.isEmpty else { return nil }
        let parts = s.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        var c = DateComponents()
        c.year = parts[0]; c.month = parts[1]; c.day = parts[2]
        return Calendar.current.date(from: c)
    }

    static func isoString(_ d: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
}

// MARK: - Row subviews

private struct TrainWeekRow: View {
    let day: TrainingPlanDay
    let isFirst: Bool
    let isToday: Bool

    var body: some View {
        let eff = FaffEffort.fromType(day.type)
        let isRest = day.type.lowercased() == "rest"
        // 2026-06-02 round 46 · `&& !isToday` was hiding the check for
        // today's completed run · David flagged today's INTERVALS as
        // missing the check while MON's done easy had it. Done takes
        // priority over the TODAY badge · if both are true the check
        // wins, badge hides.
        let isDone = day.doneMi > 0.1
        return VStack(spacing: 0) {
            if !isFirst {
                Rectangle().fill(Color.white.opacity(0.08)).frame(height: 1)
            }
            HStack(spacing: 12) {
                Text(dowAbbrev())
                    .font(.body(10, weight: .extraBold)).tracking(0.5)
                    .foregroundStyle(Theme.txt.opacity(0.6))
                    .frame(width: 30, alignment: .leading)
                if isRest {
                    Capsule().fill(Color.white.opacity(0.4)).frame(width: 11, height: 2)
                        .padding(.vertical, 3.5)
                } else {
                    Circle().fill(eff.dot).frame(width: 9, height: 9)
                }
                VStack(alignment: .leading, spacing: 1) {
                    // 2026-06-02 round 46 · title is the type word (EASY /
                    // INTERVALS / TEMPO / LONG / REST), NOT day.label.
                    // For quality sessions day.label is the workout name
                    // ("4×1 mi @ I · 3 min jog") · that goes in the
                    // subline instead. Matches the peek / hero pattern.
                    Text(eff.title.uppercased())
                        .font(.body(14, weight: .bold)).tracking(-0.2)
                        .foregroundStyle(Theme.txt)
                        .lineLimit(1)
                    Text(subline())
                        .font(.body(11.5, weight: .semibold))
                        .foregroundStyle(Theme.txt.opacity(0.6))
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                // 2026-06-02 round 47 · right-column alignment fix. The
                // mi text needs a FIXED-WIDTH frame so done rows (with
                // check) and undone rows (no check) line up at the same
                // right edge · before, the optional check pushed "mi"
                // left by ~14pt on done rows.
                Text(metaLabel())
                    .font(.body(12.5, weight: .bold))
                    .foregroundStyle(Theme.txt.opacity(0.82))
                    .frame(width: 44, alignment: .trailing)
                // Status indicator gets its own fixed-width slot · same
                // 18pt whether check / TODAY badge / empty. Now every
                // row's mi text sits in the same column.
                ZStack(alignment: .trailing) {
                    Color.clear.frame(width: 18, height: 1)
                    if isDone {
                        Image(systemName: "checkmark")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(Color(hex: 0x7BE8A0))
                    } else if isToday {
                        Text("TODAY")
                            .font(.body(8.5, weight: .extraBold)).tracking(1)
                            .foregroundStyle(Color(hex: 0xF3AD38))
                            .fixedSize()
                    }
                }
            }
            .padding(.vertical, 9)
            // 2026-06-02 round 48 · today highlight gets a bit of
            // breathing room on left + right · -6pt horizontal extends
            // the rounded rectangle past the content without shifting
            // the content itself (column alignment preserved). Uses a
            // negative-padded background view rather than `.background(in:)`
            // so the inset is BG-only.
            .background(
                Group {
                    if isToday {
                        Color.white.opacity(0.08)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .padding(.horizontal, -6)
                    }
                }
            )
        }
    }

    private func dowAbbrev() -> String {
        let labels = ["SUN","MON","TUE","WED","THU","FRI","SAT"]
        let idx = ((day.dow % 7) + 7) % 7
        return labels[idx]
    }

    /// 2026-06-02 round 46 · subline · workout name when day.label
    /// is the structural sub_label ("4×1 mi @ I · 3 min jog" ·
    /// "2 mi WU · 4 mi @ T · 2 mi CD"), effort severity otherwise.
    /// For matched-name days (sub_label == type word) we show the
    /// severity so the row isn't half-empty.
    private func subline() -> String {
        if day.type.lowercased() == "rest" { return "Sleep + mobility" }
        let eff = FaffEffort.fromType(day.type)
        let typeWord = eff.title.uppercased()
        if let lbl = day.label,
           !lbl.isEmpty,
           lbl.uppercased() != typeWord {
            return lbl
        }
        return eff.effortLabel
    }

    private func metaLabel() -> String {
        if day.type.lowercased() == "rest" { return "—" }
        return "\(trainMi(day.mi)) mi"
    }
}

private struct TrainWeekRowSummary: View {
    let week: TrainingPlanWeek
    let idx: Int
    let maxMi: Double
    let keyLabel: String
    let starred: Bool
    let selected: Bool
    let onTap: () -> Void

    var body: some View {
        let phase = TrainPhase(phaseKey: week.phase)
        let phaseAccent: Color = TrainView.phaseAccent(phase)
        let cur = week.isCurrent
        let pct = max(0.05, min(1.0, week.plannedMi / maxMi))
        return Button(action: onTap) {
            HStack(spacing: 11) {
                Text("\(idx + 1)")
                    .font(.body(14, weight: .bold))
                    .foregroundStyle(Theme.txt.opacity(0.75))
                    .frame(width: 20, alignment: .center)
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 3).fill(Color.white.opacity(0.12))
                    RoundedRectangle(cornerRadius: 3).fill(phaseAccent)
                        .frame(width: 54 * pct)
                }
                .frame(width: 54, height: 6)
                Text(keyLabel)
                    .font(.body(13, weight: .semibold))
                    .foregroundStyle(Theme.txt)
                    .lineLimit(1).truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if starred {
                    Text("★")
                        .font(.body(11, weight: .extraBold))
                        .foregroundStyle(Color(hex: 0xF3AD38))
                }
                if cur {
                    Text("NOW")
                        .font(.body(8, weight: .extraBold)).tracking(0.8)
                        .foregroundStyle(Color(hex: 0xF3AD38))
                } else {
                    // #47 · trainMi → 1 decimal only when fractional (no noisy
                    // .0 on whole-mile weeks), matching the WK header + app convention.
                    Text(trainMi(week.plannedMi))
                        .font(.body(12.5, weight: .bold))
                        .foregroundStyle(Theme.txt.opacity(0.78))
                }
            }
            .padding(.horizontal, 10).padding(.vertical, 9)
            .background(
                (cur ? Color.white.opacity(0.1)
                     : (selected ? Color.white.opacity(0.14) : Color.clear)),
                in: RoundedRectangle(cornerRadius: 13, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 13, style: .continuous)
                    .stroke(cur ? Color.white.opacity(0.2) : Color.clear, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Execution strip row data + view

private struct ExecRow: Identifiable {
    let weekIdx: Int
    let startDate: String
    let plannedMi: Double
    let actualMi: Double
    let sessTotal: Int
    let sessDone: Int
    /// Worst-ranked trainingInfluence across quality done sessions this week.
    /// Nil when no quality workouts were completed or no influence signal exists.
    let influence: (kind: String, color: Color)?
    let isCurrent: Bool
    var id: Int { weekIdx }
}

private struct ExecStripRow: View {
    let row: ExecRow
    let isFirst: Bool

    var body: some View {
        let pct: Double = row.plannedMi > 0
            ? min(1.0, row.actualMi / row.plannedMi)
            : 0
        let barFill: Color = {
            if row.isCurrent { return Color(hex: 0xF3AD38).opacity(0.55) }
            if pct >= 0.95 { return Color(hex: 0x3EBD41) }  // good state
            if pct >= 0.80 { return Color(hex: 0xF3AD38) }  // amber
            return Color(hex: 0xFC4D64)                       // off/warn
        }()
        let dateLabel: String = {
            if row.isCurrent { return "THIS WEEK" }
            let parts = row.startDate.split(separator: "-").compactMap { Int($0) }
            guard parts.count == 3 else { return row.startDate }
            var c = DateComponents()
            c.year = parts[0]; c.month = parts[1]; c.day = parts[2]
            guard let d = Calendar.current.date(from: c) else { return row.startDate }
            let f = DateFormatter(); f.dateFormat = "MMM d"
            return f.string(from: d).uppercased()
        }()
        let sessLabel: String = {
            if row.isCurrent {
                let remain = max(0, row.sessTotal - row.sessDone)
                return remain == 0 ? "done" : "\(remain) left"
            }
            return "\(row.sessDone)/\(row.sessTotal)"
        }()

        return VStack(spacing: 0) {
            if !isFirst {
                Rectangle().fill(Color.white.opacity(0.08)).frame(height: 1)
            }
            HStack(alignment: .center, spacing: 8) {
                // Date label
                Text(dateLabel)
                    .font(.body(10, weight: .extraBold))
                    .tracking(row.isCurrent ? 0.5 : 0.3)
                    .foregroundStyle(row.isCurrent
                                     ? Color(hex: 0xF3AD38)
                                     : Theme.txt.opacity(0.65))
                    .frame(width: 66, alignment: .leading)
                    .lineLimit(1)
                    .minimumScaleFactor(0.82)

                // Progress bar (flex)
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 3)
                            .fill(Color.white.opacity(0.10))
                        RoundedRectangle(cornerRadius: 3)
                            .fill(barFill)
                            .frame(width: max(0, geo.size.width * pct))
                    }
                }
                .frame(height: 5)

                // Actual / planned mi
                (
                    Text(String(format: "%.1f", row.actualMi))
                        .font(.body(12, weight: .bold))
                        .foregroundStyle(Theme.txt)
                    +
                    Text("/\(trainMi(row.plannedMi))mi")
                        .font(.body(10, weight: .semibold))
                        .foregroundStyle(Theme.txt.opacity(0.44))
                )
                .frame(width: 68, alignment: .trailing)
                .lineLimit(1)

                // Session ratio
                Text(sessLabel)
                    .font(.body(10, weight: .extraBold))
                    .tracking(0.2)
                    .foregroundStyle(Theme.txt.opacity(0.58))
                    .frame(width: 36, alignment: .trailing)
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)

                // Influence dot (past weeks only; hidden slot preserves column alignment)
                Group {
                    if let inf = row.influence, !row.isCurrent {
                        Circle()
                            .fill(inf.color)
                            .shadow(color: inf.color.opacity(0.65), radius: 3)
                    } else {
                        Circle().fill(Color.clear)
                    }
                }
                .frame(width: 8, height: 8)
            }
            .padding(.vertical, 9)
        }
    }
}

// MARK: - FlowRow (simple wrapping HStack)

private struct FlowRow<Content: View>: View {
    let spacing: CGFloat
    @ViewBuilder let content: () -> Content

    var body: some View {
        // SwiftUI's Layout API would be cleaner but for 6 short legend chips
        // an LTR multi-line HStack is fine. We approximate with a 3-col grid
        // so it never overflows on small phones.
        LazyVGrid(columns: [
            GridItem(.flexible(), spacing: spacing),
            GridItem(.flexible(), spacing: spacing),
            GridItem(.flexible(), spacing: spacing)
        ], alignment: .leading, spacing: 6) {
            content()
        }
    }
}

// MARK: - TrainingPlanDay placeholder

extension TrainingPlanDay {
    /// Synthesise a minimal placeholder day for selection edge cases
    /// (race day not present in the plan, or an empty date the calendar
    /// surfaces). Mileage zero · type defaults to "rest".
    static func placeholder(date: String, type: String = "rest") -> TrainingPlanDay {
        let json = """
        {"date":"\(date)","dow":0,"type":"\(type)","mi":0,"label":null,"doneMi":0,"activityId":null}
        """.data(using: .utf8)!
        return (try? JSONDecoder().decode(TrainingPlanDay.self, from: json))
            ?? (try! JSONDecoder().decode(TrainingPlanDay.self, from: json))
    }
}

// MARK: - Array safe index

private extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
