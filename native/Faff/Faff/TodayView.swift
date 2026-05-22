//
//  TodayView.swift
//  Faff
//
//  Today tab (handoff §1). Date strip + coach brief + state-driven hero
//  (run vs rest) + readiness + check-in. The sticky brand/avatar/race bar
//  lives in the shell (RootTabView), not here. Real data from
//  /api/overview; tap the hero / Open Workout → Workout detail sheet.
//

import SwiftUI

struct TodayView: View {
    let overview: OverviewResponse
    var onWhy: () -> Void = {}
    var onOpenWorkout: () -> Void = {}
    var onReload: () -> Void = {}

    @State private var selected: String?   // nil = today
    @State private var showReadiness = false
    @State private var recapDate: RecapDate?  // non-nil → show run recap sheet
    @State private var reschedule: RescheduleTarget?
    @State private var showSkipConfirm = false
    @State private var working = false
    private struct RecapDate: Identifiable { let id: String }

    // The logged run for the selected day (past, or a completed today), drives
    // both the hero's actuals AND the inline recap surfaced below it, so the
    // run's route / splits / dynamics fill the space instead of hiding behind
    // a "View full recap" tap.
    @State private var selRun: RunRecap?
    @State private var selDynamics: HealthKitManager.RunDynamics?

    private var selDate: String { selected ?? overview.today ?? "" }
    private var selDay: OPlanDay? { overview.planWeekWorkouts?.first { $0.dateISO == selDate } }
    private var isTodaySel: Bool { selDate == overview.today }
    private var isPastSel: Bool { selDate < (overview.today ?? "") }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Faff.S.rowGap) {
                PendingAdaptationsCard(overview: overview, onReload: onReload)
                CoachAdaptationsCard(overview: overview)
                dateStrip(overview)
                coachLineView
                heroView
                // Inline recap, when the selected day has a logged run, surface
                // its route, mile splits, summary and per-run dynamics right
                // here instead of leaving the space empty.
                if let r = selRun {
                    RunRecapContent(run: r, dynamics: selDynamics, showHeader: false)
                }
                if isTodaySel {
                    readinessCard(overview)
                    CheckInCard()
                } else if !isPastSel {
                    previewReadiness
                }
            }
            .padding(.horizontal, Faff.S.pageEdge)
            .padding(.top, Faff.S.scrollTop)
            .padding(.bottom, Faff.S.scrollBottom)
        }
        .background(Faff.C.bg)
        .task(id: selDate) { await loadSelRun() }
        .sheet(isPresented: $showReadiness) { ReadinessDetailSheet(overview: overview) }
        .sheet(item: $recapDate) { d in RunRecapView(date: d.id) }
        .sheet(item: $reschedule) { t in
            RescheduleSheet(action: t.action, fromDateISO: overview.today ?? "",
                            days: overview.planWeekWorkouts ?? [],
                            onDone: { onReload() })
        }
        .confirmationDialog("Skip today's \(overview.todayWorkout.label.lowercased())?",
                            isPresented: $showSkipConfirm, titleVisibility: .visible) {
            Button("Skip workout", role: .destructive) { Task { await skipToday() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("The coach treats a skip as a recovery signal and adapts the days around it.")
        }
    }

    private func skipToday() async {
        let dw = overview.todayWorkout
        guard let date = overview.today else { return }
        working = true; defer { working = false }
        try? await PlanActionAPI.skip(dateISO: date, type: dw.label, mi: dw.distanceMi)
        onReload()
    }

    /// Today's plan-week row (for completion detection).
    private var todayPlanDay: OPlanDay? { overview.planWeekWorkouts?.first { $0.dateISO == overview.today } }
    private var todayDone: Bool { todayPlanDay.map { overview.isPlanDayDone($0) } ?? false }

    /// Whether the selected day is rest (so we never fetch a run for it).
    private var selIsRest: Bool {
        if isTodaySel { return overview.todayWorkout.isRest }
        return (selDay?.type ?? "") == "rest"
    }

    /// Load the logged run (+ per-run dynamics) for the selected day, for the
    /// hero actuals and the inline recap. Only past days or a completed today;
    /// cleared otherwise so switching to a future/rest day shows nothing.
    private func loadSelRun() async {
        let date = selDate
        let wantsRun = !date.isEmpty && !selIsRest && (isPastSel || (isTodaySel && todayDone))
        guard wantsRun else { selRun = nil; selDynamics = nil; return }
        selRun = nil; selDynamics = nil
        let r = (try? await RunByDateAPI.fetch(date: date))?.run
        guard date == selDate else { return }   // a faster tap won the race
        selRun = r
        if let r { selDynamics = await HealthKitManager.shared.runDynamics(forDateISO: r.date ?? date) }
    }

    @ViewBuilder private var heroView: some View {
        if isTodaySel {
            if overview.todayWorkout.isRest {
                restHero(overview)
            } else if todayDone, let d = todayPlanDay {
                // Post-run: today's run is logged, show the recap hero
                // (loads actuals + taps into the full recap), matching web.
                PastDayHero(
                    date: overview.today ?? "",
                    eyebrow: "Today",
                    title: heroTitle(overview.todayWorkout),
                    isRest: false,
                    plannedMi: d.distanceMi,
                    hasStrength: d.hasStrength == true,
                    run: selRun,
                    onOpenRecap: { date in recapDate = RecapDate(id: date) }
                )
            } else {
                runHero(overview)
            }
        } else if let d = selDay {
            if isPastSel {
                let dw = DerivedWorkout(plan: d, fallback: nil)
                PastDayHero(
                    date: d.dateISO ?? "",
                    eyebrow: eyebrowDate(d.dateISO),
                    title: dw.isRest ? "Rest" : heroTitle(dw),
                    isRest: dw.isRest,
                    plannedMi: d.distanceMi,
                    hasStrength: d.hasStrength == true,
                    run: selRun,
                    onOpenRecap: { date in recapDate = RecapDate(id: date) }
                )
            } else { previewHero(d) }
        }
    }
    @ViewBuilder private var coachLineView: some View {
        if isTodaySel { coachBrief(overview) }
        else if let d = selDay {
            Text(dayLine(d)).font(Faff.F.inter(14)).foregroundStyle(Faff.C.ink).lineSpacing(4)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 2)
        }
    }

    // ── Date strip ────────────────────────────────────────────────
    private func dateStrip(_ o: OverviewResponse) -> some View {
        let days = o.planWeekWorkouts ?? []
        return HStack(spacing: 4) {
            ForEach(Array(days.enumerated()), id: \.offset) { _, day in
                let isToday = day.dateISO == o.today
                let isSel = day.dateISO == selDate
                let isDone = o.isPlanDayDone(day)
                // Completed day → green fill (like the black today/selected
                // mark, but green). Selected day stays ink. Either → white text.
                let fill: Color = isSel ? Faff.C.ink : (isDone ? Faff.C.recovery : .clear)
                let onFill = isSel || isDone
                Button {
                    selected = (day.dateISO == o.today) ? nil : day.dateISO
                } label: {
                    VStack(spacing: 5) {
                        Text(dow(day.dow)).font(Faff.F.inter(9.5, .bold)).tracking(0.5)
                            .foregroundStyle(onFill ? .white : (isToday ? Faff.C.race : Faff.C.textDim))
                        Text(dom(day.dateISO)).font(Faff.F.display(20))
                            .foregroundStyle(onFill ? .white : (isToday ? Faff.C.race : Faff.C.textMuted))
                        statusDot(o, day, onFill: onFill).frame(height: 7)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 7)
                    .background(fill, in: RoundedRectangle(cornerRadius: Faff.R.tile, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: Faff.R.tile)
                            .stroke(Faff.C.race.opacity(0.55), lineWidth: (isToday && !isSel && !isDone) ? 1.5 : 0)
                    )
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func dayLine(_ d: OPlanDay) -> String {
        let dw = DerivedWorkout(plan: d, fallback: nil)
        let wd = weekday(d.dateISO)
        if dw.isRest { return "\(wd) is a rest day, recovery is part of the work." }
        let mi = OverviewFormat.distance(d.distanceMi)
        if isPastSel {
            let actual = overview.completedByDate?[d.dateISO ?? ""] ?? 0
            if overview.isPlanDayDone(d) { return "\(wd)'s \(dw.label.lowercased()), logged, \(OverviewFormat.distance(actual)) of \(mi) mi." }
            if overview.isPlanDaySkipped(d) { return "\(wd)'s \(dw.label.lowercased()), skipped. The coach adapts the days around it." }
            if overview.isPlanDayShort(d) { return "\(wd)'s \(dw.label.lowercased()), ran \(OverviewFormat.distance(actual)) of \(mi) mi planned. Short, but it counts." }
            return "\(wd)'s \(dw.label.lowercased()), \(mi) mi planned, missed (not logged)."
        }
        return "\(wd)'s \(dw.label.lowercased()), \(mi) mi planned. Tap Open workout for the structure."
    }
    private func weekday(_ iso: String?) -> String {
        guard let iso, iso.count >= 10 else { return "That day" }
        let inF = DateFormatter(); inF.dateFormat = "yyyy-MM-dd"; inF.timeZone = TimeZone(identifier: "UTC")
        guard let dt = inF.date(from: String(iso.prefix(10))) else { return "That day" }
        let out = DateFormatter(); out.dateFormat = "EEEE"; out.timeZone = TimeZone(identifier: "UTC")
        return out.string(from: dt)
    }
    @ViewBuilder private func statusDot(_ o: OverviewResponse, _ d: OPlanDay, onFill: Bool) -> some View {
        let isRest = (d.type ?? "") == "rest"
        let isToday = d.dateISO == o.today
        let isPast = (d.dateISO ?? "") < (o.today ?? "")
        if o.isPlanDayDone(d) {
            // Completed, green check (white when sitting on the green fill).
            Image(systemName: "checkmark").font(.system(size: 7, weight: .black))
                .foregroundStyle(onFill ? .white : Faff.C.recovery)
        } else if o.isPlanDaySkipped(d) {
            // Deliberately skipped, amber slash (the coach knows; not "missed").
            Image(systemName: "slash.circle").font(.system(size: 7, weight: .bold))
                .foregroundStyle(onFill ? .white : Faff.C.milestone)
        } else if o.isPlanDayShort(d) {
            // Logged, but short of plan, amber check (ran, didn't complete it).
            Image(systemName: "checkmark").font(.system(size: 7, weight: .black))
                .foregroundStyle(onFill ? .white : Faff.C.milestone)
        } else if isRest {
            Circle().stroke(Faff.C.textFaint, lineWidth: 1.5).frame(width: 5, height: 5)
        } else if isToday {
            Circle().fill(Faff.C.milestone).frame(width: 5, height: 5)
        } else if isPast {
            // Missed, planned, not logged, not skipped. A hollow warn ring so
            // it's clearly distinct from a deliberate skip and from "to come".
            Circle().stroke(Faff.C.warn.opacity(0.85), lineWidth: 1.5).frame(width: 5, height: 5)
        } else {
            Circle().fill(Faff.C.textFaint.opacity(0.6)).frame(width: 5, height: 5)
        }
    }
    private func dow(_ d: Int?) -> String { ["S","M","T","W","T","F","S"][(d ?? 0) % 7] }
    private func dom(_ iso: String?) -> String {
        guard let iso, iso.count >= 10 else { return "" }
        return String(Int(iso.suffix(2)) ?? 0)
    }

    // ── Coach brief (no eyebrow on Today, date strip gives context) ──
    private func coachBrief(_ o: OverviewResponse) -> some View {
        faffMarkdown(o.coachRead)
            .font(Faff.F.inter(14)).foregroundStyle(Faff.C.ink).lineSpacing(4)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 2)
    }

    // ── Run hero ──────────────────────────────────────────────────
    private func runHero(_ o: OverviewResponse) -> some View {
        let dw = o.todayWorkout
        let phase = o.planCurrentPhase ?? "Today"
        let hasStrength = o.planWeekWorkouts?.first { $0.dateISO == o.today }?.hasStrength == true
        return Button(action: onOpenWorkout) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .center, spacing: 8) {
                    HStack(spacing: 6) {
                        Text("Today · \(phase)".uppercased())
                            .font(Faff.F.inter(10, .semibold)).tracking(1.6).foregroundStyle(Faff.C.textDim)
                        if hasStrength { StrengthMark(size: 15) }
                    }
                    Spacer()
                    WhyChip(action: onWhy)
                }
                Text(heroTitle(dw).uppercased())
                    .font(Faff.F.display(54)).tracking(-0.5)
                    .foregroundStyle(Faff.C.ink).lineLimit(2).minimumScaleFactor(0.6)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 9).padding(.bottom, 15)
                HStack(spacing: Faff.S.inlineGap) {
                    StatPill(value: OverviewFormat.distance(dw.distanceMi), unit: "mi", label: "Distance")
                    StatPill(value: dw.paceDisplay, unit: dw.paceDisplay.contains(":") ? "/mi" : nil,
                             label: "Pace", accent: dw.isQuality)
                    StatPill(value: dw.durationMin.map { "~\($0)" } ?? ", ",
                             unit: dw.durationMin != nil ? "min" : nil, label: "Time")
                }
                actionButtons
                    .padding(.top, 12)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .faffCard(padding: 17)
        }
        .buttonStyle(.plain)
    }

    /// Display label for the hero: bare types read better with "Run".
    private func heroTitle(_ dw: DerivedWorkout) -> String {
        switch dw.label.lowercased() {
        case "easy": return "Easy Run"
        case "long": return "Long Run"
        case "recovery": return "Recovery Run"
        default: return dw.label
        }
    }

    private var actionButtons: some View {
        VStack(spacing: 8) {
            PrimaryButton(title: "Open Workout", action: onOpenWorkout)
            HStack(spacing: 8) {
                GhostButton(title: "Skip", icon: "forward.end") { showSkipConfirm = true }
                GhostButton(title: "Substitute", icon: "arrow.left.arrow.right") { reschedule = RescheduleTarget(action: "swap") }
            }
            .disabled(working)
        }
    }

    // ── Rest hero ─────────────────────────────────────────────────
    private func restHero(_ o: OverviewResponse) -> some View {
        let phase = o.planCurrentPhase ?? "Today"
        return VStack(alignment: .leading, spacing: 0) {
            Text("Today · \(phase)".uppercased())
                .font(Faff.F.inter(10, .semibold)).tracking(1.6).foregroundStyle(Faff.C.textDim)
            Text("REST").font(Faff.F.display(54)).tracking(-0.5)
                .foregroundStyle(Faff.C.ink).padding(.top, 9).padding(.bottom, 8)
            Text("No run on the schedule today. **Recovery is part of training**, let the body absorb the work from this week and come into the next session fresh.")
                .font(Faff.F.inter(13)).foregroundStyle(Faff.C.textMuted).lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .faffCard(padding: 17)
    }


    // ── Future day · preview hero ─────────────────────────────────
    private func previewHero(_ d: OPlanDay) -> some View {
        let dw = DerivedWorkout(plan: d, fallback: nil)
        let rest = dw.isRest
        return VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 8) {
                HStack(spacing: 6) {
                    Text("\(eyebrowDate(d.dateISO)) · PLANNED")
                        .font(Faff.F.inter(10, .semibold)).tracking(1.6).foregroundStyle(Faff.C.textDim)
                    if d.hasStrength == true { StrengthMark(size: 15) }
                }
                Spacer()
                Badge(text: "Upcoming", tone: .grey)
            }
            Text((rest ? "REST" : heroTitle(dw)).uppercased())
                .font(Faff.F.display(54)).tracking(-0.5).foregroundStyle(Faff.C.ink)
                .padding(.top, 9).padding(.bottom, 14)
            if !rest {
                HStack(spacing: Faff.S.inlineGap) {
                    StatPill(value: OverviewFormat.distance(dw.distanceMi), unit: "mi", label: "Distance")
                    StatPill(value: dw.paceDisplay, unit: dw.paceDisplay.contains(":") ? "/mi" : nil, label: "Pace", accent: dw.isQuality)
                    StatPill(value: dw.durationMin.map { "~\($0)" } ?? ", ", unit: dw.durationMin != nil ? "min" : nil, label: "Time")
                }
                GhostButton(title: "Open workout") { onOpenWorkout() }.padding(.top, 12)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).faffCard(padding: 17)
    }

    private var previewReadiness: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("READINESS").font(Faff.F.inter(10, .semibold)).tracking(0.9).foregroundStyle(Faff.C.textDim)
                Spacer()
                Badge(text: "\(shortWeekday(selDate)) AM", tone: .grey)
            }
            HStack(spacing: 14) {
                ReadinessRing(score: nil, size: 54)
                Text("Your readiness score posts \(weekday(selDate)) morning, once sleep & HRV sync.")
                    .font(Faff.F.inter(12.5)).foregroundStyle(Faff.C.textMuted).lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).faffCard()
    }

    private func eyebrowDate(_ iso: String?) -> String {
        guard let iso, iso.count >= 10 else { return "" }
        let inF = DateFormatter(); inF.dateFormat = "yyyy-MM-dd"; inF.timeZone = TimeZone(identifier: "UTC")
        guard let dt = inF.date(from: String(iso.prefix(10))) else { return "" }
        let out = DateFormatter(); out.dateFormat = "EEE MMM d"; out.timeZone = TimeZone(identifier: "UTC")
        return out.string(from: dt)
    }
    private func shortWeekday(_ iso: String?) -> String {
        guard let iso, iso.count >= 10 else { return "" }
        let inF = DateFormatter(); inF.dateFormat = "yyyy-MM-dd"; inF.timeZone = TimeZone(identifier: "UTC")
        guard let dt = inF.date(from: String(iso.prefix(10))) else { return "" }
        let out = DateFormatter(); out.dateFormat = "EEE"; out.timeZone = TimeZone(identifier: "UTC")
        return out.string(from: dt)
    }

    // ── Readiness ─────────────────────────────────────────────────
    // Real 0–100 score from computeReadinessScore when available; dashed
    // "No data" otherwise. Badge reflects state (or the ACWR load read).
    private func readinessCard(_ o: OverviewResponse) -> some View {
        let acwr = o.acwrValue
        let ringTone = Self.tone(for: o.readinessState)
        let (badgeText, badgeTone): (String, Badge.Tone) = {
            switch o.readinessState {
            case "green": return ("Primed", .green)
            case "yellow": return ("Watch load", .amber)
            case "red": return ("Back off", .warn)
            default:
                guard let a = acwr else { return ("No data", .grey) }
                return a > 1.3 ? ("Watch load", .amber) : ("On track", .green)
            }
        }()
        return Button { showReadiness = true } label: {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("READINESS").font(Faff.F.inter(10, .semibold)).tracking(0.9)
                        .foregroundStyle(Faff.C.textDim)
                    Spacer()
                    Badge(text: badgeText, tone: badgeTone)
                    if o.readinessHasDetail {
                        Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(Faff.C.textFaint)
                    }
                }
                HStack(spacing: 14) {
                    ReadinessRing(score: o.readinessScore, tone: ringTone, size: 54)
                    Text(readinessCopy(acwr))
                        .font(Faff.F.inter(12.5)).foregroundStyle(Faff.C.textMuted).lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true).multilineTextAlignment(.leading)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .faffCard()
        }
        .buttonStyle(.plain)
        .disabled(!o.readinessHasDetail)
    }
    static func tone(for state: String?) -> Color {
        switch state {
        case "green": return Faff.C.recovery
        case "yellow": return Faff.C.milestone
        case "red": return Faff.C.warn
        default: return Faff.C.recovery
        }
    }
    private func readinessCopy(_ acwr: Double?) -> String {
        // Real score → the informative, data-driven summary (recommendation +
        // biggest driver); tap the card for the full breakdown.
        if overview.readinessHasDetail { return overview.readinessSummary }
        guard let a = acwr else { return "No recovery data yet. Connect Apple Health for heart-rate variability, resting heart rate and sleep." }
        let load = a > 1.3
            ? "Your training load is climbing, keep easy days easy."
            : "Your training load is balanced."
        return load + (o_hasHealth ? "" : " Connect Apple Health for heart-rate variability & sleep.")
    }
    private var o_hasHealth: Bool { overview.hasHealthData }
}

// MARK: - Coach adaptations card (dismissible, top of Today)

/// "Coach updated your plan", shows recent plan adaptations (grouped by
/// reason, with the day(s) touched + the research citation) so a change never
/// happens silently. Appears only when there's an adaptation newer than the
/// one this device last dismissed (local seen-tracking via @AppStorage).
/// BIG plan adaptations the coach proposes but won't apply until the runner
/// approves, cutbacks, suppressing quality, volume drops, race-week reshapes,
/// post-race pace shifts. Each card carries Approve / Skip; the change lands on
/// the plan only on approve. Small/safety adaptations auto-apply (no card).
private struct PendingAdaptationsCard: View {
    let overview: OverviewResponse
    var onReload: () -> Void = {}

    @State private var working: String?     // reason of the group being acted on
    private var groups: [OPendingAdaptation] { overview.pendingAdaptations ?? [] }

    var body: some View {
        if !groups.isEmpty {
            VStack(alignment: .leading, spacing: 14) {
                ForEach(groups) { g in
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(spacing: 6) {
                            Image(systemName: "wand.and.stars").font(.system(size: 12, weight: .bold)).foregroundStyle(Faff.C.race)
                            Text("COACH SUGGESTS A CHANGE").font(Faff.F.inter(10, .semibold)).tracking(1.2).foregroundStyle(Faff.C.textDim)
                            Spacer()
                        }
                        Text(g.reason).font(Faff.F.inter(13)).foregroundStyle(Faff.C.ink)
                            .fixedSize(horizontal: false, vertical: true).lineSpacing(2)
                        HStack(spacing: 6) {
                            Text(dayList(g.days)).font(Faff.F.inter(11, .semibold)).foregroundStyle(Faff.C.race)
                            if let c = g.citation, !c.isEmpty {
                                Text("· \(c)").font(Faff.F.inter(10)).foregroundStyle(Faff.C.textDim).lineLimit(1)
                            }
                        }
                        HStack(spacing: 10) {
                            Button { Task { await act(g, "accept") } } label: {
                                Text("APPROVE").font(Faff.F.oswald(13, .semibold)).tracking(2)
                                    .foregroundStyle(.white).frame(maxWidth: .infinity).padding(.vertical, 11)
                                    .background(Faff.C.race).clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                            }.buttonStyle(.plain)
                            Button { Task { await act(g, "decline") } } label: {
                                Text("SKIP").font(Faff.F.oswald(13, .semibold)).tracking(2)
                                    .foregroundStyle(Faff.C.ink).frame(maxWidth: .infinity).padding(.vertical, 11)
                                    .background(Color.clear)
                                    .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(Faff.C.ink.opacity(0.18), lineWidth: 1))
                            }.buttonStyle(.plain)
                        }
                        .opacity(working == g.reason ? 0.5 : 1)
                        .disabled(working != nil)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .faffCard()
        }
    }

    private func act(_ g: OPendingAdaptation, _ action: String) async {
        working = g.reason; defer { working = nil }
        _ = try? await FaffAPI.shared.actOnAdaptation(ids: g.ids, action: action)
        onReload()
    }

    private func dayList(_ days: [String]) -> String {
        let inF = DateFormatter(); inF.dateFormat = "yyyy-MM-dd"; inF.timeZone = TimeZone(identifier: "UTC")
        let out = DateFormatter(); out.dateFormat = "EEE"; out.timeZone = TimeZone(identifier: "UTC")
        let names = days.compactMap { inF.date(from: String($0.prefix(10))).map { out.string(from: $0) } }
        if names.count > 4 { return "\(names.count) days" }
        return names.joined(separator: "-")
    }
}

private struct CoachAdaptationsCard: View {
    let overview: OverviewResponse
    @AppStorage("faff.coach.adaptSeenTs") private var seenTs = ""

    private var groups: [OCoachAdaptation] { overview.coachAdaptations ?? [] }
    private var latest: String { overview.adaptationsLatestTs ?? "" }
    private var shouldShow: Bool { !latest.isEmpty && !groups.isEmpty && latest != seenTs }

    var body: some View {
        if shouldShow {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 6) {
                    Image(systemName: "wand.and.stars").font(.system(size: 12, weight: .bold)).foregroundStyle(Faff.C.race)
                    Text("COACH UPDATED YOUR PLAN").font(Faff.F.inter(10, .semibold)).tracking(1.2).foregroundStyle(Faff.C.textDim)
                    Spacer()
                    Button { seenTs = latest } label: {
                        Image(systemName: "xmark").font(.system(size: 11, weight: .bold)).foregroundStyle(Faff.C.textDim)
                    }.buttonStyle(.plain)
                }
                ForEach(groups) { g in
                    VStack(alignment: .leading, spacing: 3) {
                        Text(g.reason).font(Faff.F.inter(13)).foregroundStyle(Faff.C.ink)
                            .fixedSize(horizontal: false, vertical: true).lineSpacing(2)
                        HStack(spacing: 6) {
                            Text(dayList(g.days)).font(Faff.F.inter(11, .semibold)).foregroundStyle(Faff.C.race)
                            if let c = g.citation, !c.isEmpty {
                                Text("· \(c)").font(Faff.F.inter(10)).foregroundStyle(Faff.C.textDim).lineLimit(1)
                            }
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .faffCard()
        }
    }

    /// "Thu, Fri, Sun" from ISO dates (or "N days" when many).
    private func dayList(_ days: [String]) -> String {
        let inF = DateFormatter(); inF.dateFormat = "yyyy-MM-dd"; inF.timeZone = TimeZone(identifier: "UTC")
        let out = DateFormatter(); out.dateFormat = "EEE"; out.timeZone = TimeZone(identifier: "UTC")
        let names = days.compactMap { inF.date(from: String($0.prefix(10))).map { out.string(from: $0) } }
        if names.count > 4 { return "\(names.count) days" }
        return names.joined(separator: "-")
    }
}

// MARK: - Structure bar (quality days), kept from the prior build

struct StructureBar: View {
    enum Seg { case warm, work, rec, cool }
    private let segs: [Seg] = [.warm, .work, .rec, .work, .rec, .work, .rec, .work, .rec, .work, .rec, .work, .cool]
    private func weight(_ k: Seg) -> CGFloat { switch k { case .warm,.cool: return 1.3; case .work: return 1; case .rec: return 0.5 } }
    private func color(_ k: Seg) -> Color { switch k { case .warm,.cool: return Faff.C.ink.opacity(0.14); case .work: return Faff.C.race; case .rec: return Faff.C.orangeWash } }
    var body: some View {
        GeometryReader { geo in
            let gap: CGFloat = 2
            let total = segs.reduce(0) { $0 + weight($1) }
            let usable = geo.size.width - gap * CGFloat(segs.count - 1)
            HStack(spacing: gap) {
                ForEach(Array(segs.enumerated()), id: \.offset) { _, s in
                    RoundedRectangle(cornerRadius: 2).fill(color(s)).frame(width: usable * weight(s) / total)
                }
            }
        }
        .frame(height: 6)
    }
}

// MARK: - Daily check-in (Energy / Soreness / Stress), real data

private struct CheckInCard: View {
    @State private var energy: Double = 5
    @State private var soreness: Double = 3
    @State private var stress: Double = 3
    @State private var logged = false
    @State private var editing = false
    @State private var loaded = false
    @State private var saving = false

    private let energyColor   = Color(hex: 0x4FA45B)
    private let sorenessColor = Color(hex: 0xE0796B)
    private let stressColor   = Color(hex: 0xCBA23C)

    var body: some View {
        Group {
            if logged && !editing {
                confirmedView
            } else {
                editorView
            }
        }
        .task { await load() }
    }

    // Confirmed, solid green card with a checkmark + the logged stats.
    private var confirmedView: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
                Text("CHECKED IN FOR TODAY")
                    .font(Faff.F.oswald(13, .semibold)).tracking(1).foregroundStyle(.white)
                Spacer()
            }
            HStack(spacing: 10) {
                confirmedStat("Energy", Int(energy.rounded()))
                confirmedStat("Soreness", Int(soreness.rounded()))
                confirmedStat("Stress", Int(stress.rounded()))
            }
            Button { editing = true } label: {
                Text("EDIT").font(Faff.F.oswald(11, .semibold)).tracking(1.5)
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity).padding(.vertical, 9)
                    .background(Color.white.opacity(0.16))
                    .overlay(RoundedRectangle(cornerRadius: 999, style: .continuous)
                        .stroke(Color.white.opacity(0.28), lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 999, style: .continuous))
            }
            .buttonStyle(.plain)
        }
        .padding(16)
        .background(Faff.C.recovery)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func confirmedStat(_ label: String, _ val: Int) -> some View {
        VStack(spacing: 4) {
            Text("\(val)").font(Faff.F.display(22)).foregroundStyle(.white)
            Text(label.uppercased()).font(Faff.F.inter(9, .semibold)).tracking(1)
                .foregroundStyle(.white.opacity(0.82))
        }
        .frame(maxWidth: .infinity)
    }

    private var editorView: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 5) {
                Text("Today's Check-in".uppercased())
                    .font(Faff.F.inter(10, .semibold)).tracking(1.2).foregroundStyle(Faff.C.textDim)
                Text("· not yet").font(Faff.F.inter(10)).foregroundStyle(Faff.C.textFaint)
                Spacer()
            }
            CheckInRow(label: "Energy",   value: $energy,   color: energyColor)
            CheckInRow(label: "Soreness", value: $soreness, color: sorenessColor)
            CheckInRow(label: "Stress",   value: $stress,   color: stressColor)
            HStack {
                Spacer()
                Button { Task { await save() } } label: {
                    Text(saving ? "SAVING…" : (logged ? "UPDATE" : "LOG CHECK-IN"))
                        .font(Faff.F.oswald(13, .semibold)).tracking(2)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 24).padding(.vertical, 11)
                        .background(saving ? Faff.C.ink.opacity(0.6) : Faff.C.ink)
                        .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                }
                .buttonStyle(.plain).disabled(saving)
            }
        }
        .faffCard()
    }

    private func load() async {
        guard !loaded else { return }
        defer { loaded = true }
        // No token guard: /api/checkin serves the legacy 'me' demo row
        // anonymously, so the design-preview round-trips too.
        if let c = try? await FaffAPI.shared.getCheckin() {
            energy = c.energy; soreness = c.soreness; stress = c.stress; logged = true
        } else { logged = false }
    }
    private func save() async {
        guard !saving else { return }
        saving = true
        defer { saving = false }
        let e = min(10, max(1, Int(energy.rounded())))
        let s = min(10, max(1, Int(soreness.rounded())))
        let st = min(10, max(1, Int(stress.rounded())))
        if (try? await FaffAPI.shared.postCheckin(energy: e, soreness: s, stress: st)) != nil { logged = true; editing = false }
    }
}

private struct CheckInRow: View {
    let label: String
    @Binding var value: Double
    let color: Color
    var body: some View {
        HStack(spacing: 12) {
            Text(label.uppercased()).font(Faff.F.inter(10, .medium)).tracking(0.8)
                .foregroundStyle(Faff.C.textDim).frame(width: 64, alignment: .leading)
            CheckInSlider(value: $value, color: color)
            Text("\(Int(value.rounded()))").font(Faff.F.display(21))
                .foregroundStyle(Faff.C.ink.opacity(0.7)).frame(width: 18, alignment: .trailing)
        }
    }
}

private struct CheckInSlider: View {
    @Binding var value: Double
    let color: Color
    private let thumb: CGFloat = 20
    var body: some View {
        GeometryReader { geo in
            let usable = max(0, geo.size.width - thumb)
            let x = usable * CGFloat(min(max(value, 0), 10) / 10)
            ZStack(alignment: .leading) {
                Capsule().fill(LinearGradient(colors: [color.opacity(0.28), color],
                                              startPoint: .leading, endPoint: .trailing)).frame(height: 7)
                Circle().fill(.white).frame(width: thumb, height: thumb)
                    .overlay(Circle().stroke(Faff.C.ink.opacity(0.06), lineWidth: 1))
                    .shadow(color: .black.opacity(0.18), radius: 3, x: 0, y: 1)
                    .offset(x: x)
                    .gesture(DragGesture(minimumDistance: 0).onChanged { g in
                        let nx = min(max(0, g.location.x - thumb / 2), usable)
                        value = (usable > 0 ? Double(nx / usable) : 0) * 10
                    })
            }
            .frame(height: thumb).frame(maxHeight: .infinity, alignment: .center)
        }
        .frame(height: thumb)
    }
}

// ── Past day hero ─────────────────────────────────────────────────
/// A selected past day. Loads the real run from /api/runs/by-date (the
/// source of truth, works around flaky completedByDate detection) so
/// the card shows the true result + a tap into the full recap (route,
/// mile splits, HR). Honest "missed" when nothing synced.
private struct PastDayHero: View {
    let date: String
    let eyebrow: String
    let title: String
    let isRest: Bool
    let plannedMi: Double?
    var hasStrength: Bool = false
    /// The logged run, loaded by the parent (TodayView) so the inline recap
    /// below the hero shares the same fetch. nil → "not logged" state.
    var run: RunRecap?
    var onOpenRecap: (String) -> Void

    /// Outcome vs the plan: on-plan (≥60% of planned), short (logged but under),
    /// or missed (nothing synced).
    private enum Outcome { case onPlan, short, missed }
    private var outcome: Outcome {
        guard let r = run else { return .missed }
        if let p = plannedMi, p > 0, (r.distanceMi ?? 0) < p * 0.6 { return .short }
        return .onPlan
    }

    var body: some View {
        let logged = run != nil
        let eyebrowState = outcome == .onPlan ? "DONE" : (outcome == .short ? "SHORT" : "NOT LOGGED")
        let (badgeText, badgeTone): (String, Badge.Tone) = {
            switch outcome {
            case .onPlan: return ("On plan", .green)
            case .short:  return ("Short", .amber)
            case .missed: return ("Not logged", .grey)
            }
        }()
        return VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 8) {
                HStack(spacing: 6) {
                    Text("\(eyebrow) · \(isRest ? "REST" : eyebrowState)")
                        .font(Faff.F.inter(10, .semibold)).tracking(1.6).foregroundStyle(Faff.C.textDim)
                    if hasStrength { StrengthMark(size: 15) }
                }
                Spacer()
                if !isRest { Badge(text: badgeText, tone: badgeTone) }
            }
            Text(title.uppercased())
                .font(Faff.F.display(54)).tracking(-0.5).foregroundStyle(Faff.C.ink)
                .padding(.top, 9).padding(.bottom, 14)
            if !isRest {
                HStack(spacing: Faff.S.inlineGap) {
                    StatPill(value: OverviewFormat.distance(plannedMi), unit: "mi", label: "Planned")
                    StatPill(value: logged ? OverviewFormat.distance(run?.distanceMi) : "-",
                             unit: logged ? "mi" : nil, label: "Ran",
                             accent: outcome == .onPlan)
                }
                if let r = run {
                    HStack(spacing: Faff.S.inlineGap) {
                        StatPill(value: r.paceDisplay, unit: "/mi", label: "Avg pace")
                        StatPill(value: r.durationDisplay, unit: nil, label: "Time")
                        if let hr = r.avgHr { StatPill(value: "\(Int(hr))", unit: "bpm", label: "Avg HR") }
                    }.padding(.top, Faff.S.inlineGap)
                } else {
                    // Nothing synced for this day, say so plainly (no recap to
                    // surface below).
                    Text("No run synced for this day yet.")
                        .font(Faff.F.inter(12.5)).foregroundStyle(Faff.C.textMuted)
                        .padding(.top, 10)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).faffCard(padding: 17)
        .contentShape(Rectangle())
        .onTapGesture { if !isRest, !date.isEmpty { onOpenRecap(date) } }
    }
}
