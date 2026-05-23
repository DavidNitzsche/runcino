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

/// Approx workout duration for stat tiles. App-wide rule: switch to H:MM once
/// it crosses an hour (101 min -> "~1:41") instead of "~101 min". Returns
/// (value, unit); unit is nil in H:MM form and for the empty placeholder.
func faffApproxDuration(_ minutes: Int?) -> (value: String, unit: String?) {
    guard let m = minutes, m > 0 else { return ("-", nil) }
    if m >= 60 { return ("~\(m / 60):" + String(format: "%02d", m % 60), nil) }
    return ("~\(m)", "min")
}

struct TodayView: View {
    let overview: OverviewResponse
    var onWhy: () -> Void = {}
    /// Open the workout-detail sheet. `dateISO == nil` → today (default,
    /// for the today hero); a date string → that day's preview (used by
    /// the future-day preview hero so tapping Sunday's "Open workout"
    /// shows Sunday's long run, not today's REST).
    var onOpenWorkout: (String?) -> Void = { _ in }
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
                // Tune-up race nudge — fires when behind on the trajectory
                // with room to act. Coach-voice copy from the server.
                if let rec = overview.raceProjection?.tuneUpRecommendation,
                   let copy = rec.copy, !copy.isEmpty {
                    TuneUpRecCard(copy: copy)
                }
                dateStrip(overview)
                // Status pill under the date strip — one-line summary of
                // where the runner sits vs their A-race goal. Tapping it
                // (TODO) opens the race-detail trajectory card. Color
                // tracks status: green=ahead, ink=on-track, amber=behind.
                if let proj = overview.raceProjection, let status = proj.status,
                   let race = overview.raceCountdown {
                    RaceStatusPill(raceName: race.name, daysAway: race.days, status: status)
                }
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
                            .foregroundStyle(onFill ? .white : (isToday ? Faff.C.ink : Faff.C.textDim))
                        Text(dom(day.dateISO)).font(Faff.F.display(20))
                            .foregroundStyle(onFill ? .white : (isToday ? Faff.C.ink : Faff.C.textMuted))
                        statusDot(o, day, onFill: onFill).frame(height: 7)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 7)
                    .background(fill, in: RoundedRectangle(cornerRadius: Faff.R.tile, style: .continuous))
                    .overlay(
                        // Today (unselected, not yet done) gets a neutral ink
                        // outline — orange is reserved for warnings, not "today".
                        RoundedRectangle(cornerRadius: Faff.R.tile)
                            .stroke(Faff.C.ink.opacity(0.35), lineWidth: (isToday && !isSel && !isDone) ? 1.5 : 0)
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
            // Today (not yet done): neutral ink dot, not orange. Orange is
            // reserved for warnings; the outlined cell border carries today.
            Circle().fill(Faff.C.ink).frame(width: 5, height: 5)
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
        return Button(action: { onOpenWorkout(nil) }) {
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
                    StatPill(value: faffApproxDuration(dw.durationMin).value,
                             unit: faffApproxDuration(dw.durationMin).unit, label: "Time")
                }
                // Fueling chip — when the run warrants gels, surface the plan
                // INLINE on the pre-run hero so the runner sees what to take
                // and when before they start. Rehearsal long runs get a green
                // tint + RACE REHEARSAL eyebrow.
                if let f = o.todayFueling, f.needed {
                    FuelingChip(fueling: f).padding(.top, 12)
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
            PrimaryButton(title: "Open Workout") { onOpenWorkout(nil) }
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
                    StatPill(value: faffApproxDuration(dw.durationMin).value, unit: faffApproxDuration(dw.durationMin).unit, label: "Time")
                }
                // Pre-run fuel chip on future-day preview too (parity with the
                // today hero) — Sunday's long run shouldn't go silent on its
                // gel plan just because it's not today.
                if let f = dw.fueling, f.needed {
                    FuelingChip(fueling: f).padding(.top, 12)
                }
                GhostButton(title: "Open workout") { onOpenWorkout(d.dateISO) }.padding(.top, 12)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).faffCard(padding: 17)
    }

    /// Future-day readiness preview. The real score posts that morning
    /// once sleep + HRV sync, but the runner shouldn't wait helplessly
    /// — the card uses what we DO know (14-day sleep debt + current
    /// recovery vitals) to coach what they can do TONIGHT to set up
    /// that morning's readiness.
    private var previewReadiness: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("READINESS").font(Faff.F.inter(10, .semibold)).tracking(0.9).foregroundStyle(Faff.C.textDim)
                Spacer()
                Badge(text: "\(shortWeekday(selDate)) AM · FORECAST", tone: previewBadgeTone)
            }
            HStack(spacing: 14) {
                ReadinessRing(score: nil, tone: previewRingTone, size: 54)
                Text(previewReadinessCopy)
                    .font(Faff.F.inter(12.5)).foregroundStyle(Faff.C.ink).lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).faffCard()
    }

    /// Coach-voice forecast copy. Uses the 14-day sleep deficit when
    /// present (Whoop-style debt) to call out actionable tonight-job:
    /// banked → reinforce, on-target → hold steady, deficit → priority
    /// sleep tonight. Falls back to a generic "8h tonight" nudge when
    /// no sleep samples have synced yet.
    private var previewReadinessCopy: String {
        let day = weekday(selDate)
        let debt = overview.state?.recovery?.sleepDeficit14d
        if let d = debt, let status = d.status {
            switch status {
            case "depleted":
                let hrs = d.hoursOver14d.map { String(format: "%.0f", $0) } ?? "several"
                let short = d.daysShort ?? 0
                return short > 0
                    ? "Sleep debt is hitting — \(hrs)h short over two weeks, \(short) nights under 7h. Tonight's job is 8+. \(day) morning's readiness needs the sleep first."
                    : "Sleep debt is hitting — \(hrs)h short over two weeks. Tonight's job is 8+. \(day) morning's readiness needs the sleep first."
            case "building-deficit":
                return "Sleep deficit building. Get 8 hours tonight to keep \(day) morning's readiness from sliding."
            case "banked":
                return "Sleep is banked. Hold the rhythm tonight and \(day) morning's readiness will reflect the work."
            case "on-target":
                return "Sleep is on track. Stay steady tonight and \(day) morning's readiness lands strong."
            default: break
            }
        }
        // Fallback when no sleep samples have synced yet.
        return "Get 8 hours tonight so \(day) morning's readiness has something to work with."
    }

    /// Ring tone color for the forecast — matches the sleep-debt status
    /// so the user can see at a glance whether tonight is high-stakes.
    /// ReadinessRing takes a Color directly (not an enum).
    private var previewRingTone: Color {
        switch overview.state?.recovery?.sleepDeficit14d?.status {
        case "depleted":          return Faff.C.warn
        case "building-deficit":  return Faff.C.milestone
        case "banked":            return Faff.C.recovery
        default:                  return Faff.C.textFaint
        }
    }

    /// Badge color: depleted → warn, building → amber, banked → green,
    /// else neutral grey.
    private var previewBadgeTone: Badge.Tone {
        switch overview.state?.recovery?.sleepDeficit14d?.status {
        case "depleted":          return .warn
        case "building-deficit":  return .amber
        case "banked":            return .green
        default:                  return .grey
        }
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
                // Score suppressed / not enough data. Show an honest "No data"
                // state — do NOT substitute an ACWR-derived verdict, which
                // would invent a green "On track" the readiness engine never
                // produced (the source of a past readiness-display surprise).
                return ("No data", .grey)
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
        default: return Faff.C.textFaint   // no-data: neutral, not a green "all good"
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
        // The badge carries the state loudly (a filled green DONE for a
        // completed run); the eyebrow stays a quiet date label and only
        // repeats the state for the non-celebratory cases.
        let eyebrowState = outcome == .onPlan ? "" : (outcome == .short ? "SHORT" : "NOT LOGGED")
        let (badgeText, badgeTone): (String, Badge.Tone) = {
            switch outcome {
            case .onPlan: return ("Done", .greenSolid)
            case .short:  return ("Short", .amber)
            case .missed: return ("Not logged", .grey)
            }
        }()
        let eyebrowText = isRest ? "\(eyebrow) · REST"
            : (eyebrowState.isEmpty ? eyebrow : "\(eyebrow) · \(eyebrowState)")
        return VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 8) {
                HStack(spacing: 6) {
                    Text(eyebrowText)
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
                             valueColor: outcome == .onPlan ? Faff.C.recovery : nil)
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

// MARK: - Fueling chip (pre-run gel plan)

/// One-line gel/carb plan for runs that warrant fueling. Mirrors the web
/// overview chip — rehearsal long runs use a green tint + RACE REHEARSAL
/// eyebrow so they read distinct from a routine fuel line.
/// Made internal so WorkoutDetailView (today's + future-day sheet) and
/// the Plan list can render the same chip — fuel surfaces wherever a run
/// is shown, not only on the today hero.
struct FuelingChip: View {
    let fueling: OFueling
    var body: some View {
        let rehearsal = fueling.isRehearsal
        let label = rehearsal ? "RACE REHEARSAL" : "FUEL"
        // Strip the "Fuel:" / "Fuel rehearsal:" prefix from the shortLine
        // since the eyebrow carries that.
        let body = fueling.shortLine
            .replacingOccurrences(of: "Fuel rehearsal: ", with: "")
            .replacingOccurrences(of: "Fuel: ", with: "")
        return HStack(alignment: .firstTextBaseline, spacing: 9) {
            Text(label)
                .font(Faff.F.oswald(10, .semibold)).tracking(1.4)
                .foregroundStyle(rehearsal ? Faff.C.recovery : Faff.C.textDim)
            Text(body)
                .font(Faff.F.inter(13)).foregroundStyle(Faff.C.ink)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12).padding(.vertical, 9)
        .background(rehearsal ? Faff.C.recovery.opacity(0.10) : Faff.C.pillBg,
                    in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(rehearsal ? Faff.C.recovery.opacity(0.30) : Faff.C.pillLine, lineWidth: 1)
        )
    }
}

// MARK: - Fueling breakdown (alternating RUN / GEL timeline)

/// Full gel timeline — alternating RUN / GEL rows so the runner can see
/// exactly when each gel hits, how long they're running between gels,
/// and how much distance each leg covers at target pace. Lives in the
/// workout-detail sheet; the one-line FuelingChip stays on the hero
/// where space is tight.
struct FuelingBreakdown: View {
    let fueling: OFueling
    /// Target pace in seconds-per-mile — fallback when the payload doesn't
    /// ship `fueling.atMiles[]` (older clients), so we can still compute
    /// per-gel mile positions locally as pace × time. nil → display falls
    /// back to time-only.
    let paceSPerMi: Double?
    /// Workout duration, lets the last leg show its actual length instead
    /// of "Run to finish". nil → final leg is open-ended.
    let totalDurationMin: Int?
    /// Prescribed total distance (mi), so the trailing FINISH row anchors
    /// exactly on the planned finish ("FINISH at 11.6 mi") instead of a
    /// derived value. nil → fall back to pace × duration.
    var finishMi: Double? = nil

    var body: some View {
        let rehearsal = fueling.isRehearsal
        let header = rehearsal ? "RACE REHEARSAL" : "FUEL TIMELINE"
        let accent = rehearsal ? Faff.C.recovery : Faff.C.race
        let stats: String = {
            var parts = ["\(fueling.gels) gels", "\(fueling.gPerHr) g/hr"]
            if fueling.totalCarbsG > 0 { parts.append("\(fueling.totalCarbsG) g total") }
            return parts.joined(separator: " · ")
        }()
        return VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(header)
                    .font(Faff.F.oswald(11, .semibold)).tracking(1.4)
                    .foregroundStyle(rehearsal ? Faff.C.recovery : Faff.C.textDim)
                Text(stats)
                    .font(Faff.F.inter(12.5, .semibold))
                    .foregroundStyle(Faff.C.textMuted)
            }
            VStack(spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.offset) { _, r in
                    rowView(r, accent: accent)
                }
            }
            if !fueling.why.isEmpty {
                Text(fueling.why)
                    .font(Faff.F.inter(12.5)).foregroundStyle(Faff.C.textMuted).lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 4)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .faffCard()
    }

    /// Each gel row shows WHERE it lands (cumulative mile + cumulative time),
    /// with the segment from the previous gel as a small annotation. A
    /// trailing finish row tells the runner how much they have after the
    /// last gel. The previous layout interleaved RUN / GEL rows which made
    /// the reader cumulate mileage in their head — the mile-anchored read
    /// is what the runner actually needs ("Gel 2 is at 6.2 mi", not "after
    /// 3.7 mi of running from gel 1, you take Gel 2").
    private enum Row {
        case gel(index: Int, atCumMi: Double?, atCumMin: Int, fromPrevMi: Double?)
        case finish(atCumMi: Double?, remainingMi: Double?, remainingMin: Int?)
    }

    private var rows: [Row] {
        var out: [Row] = []
        var prevMin = 0
        var prevMi: Double? = nil
        for (i, t) in fueling.atMins.enumerated() {
            let segMin = max(0, t - prevMin)
            // Canonical mile from the planner when present (single source of
            // truth — watch fires on the same numbers); local fallback
            // (pace × time) for older payloads that don't ship atMiles.
            let atCumMi = canonicalMile(at: i) ?? milesFor(t)
            let fromPrevMi: Double? = {
                if i == 0 { return nil }
                if let cur = atCumMi, let pv = prevMi { return cur - pv }
                return milesFor(segMin)
            }()
            out.append(.gel(index: i + 1, atCumMi: atCumMi, atCumMin: t, fromPrevMi: fromPrevMi))
            prevMin = t
            prevMi = atCumMi
        }
        if let total = totalDurationMin, total > prevMin + 2 {
            let remMin = total - prevMin
            // Finish-mile prefers the workout's prescribed distance over a
            // re-projection from time, so the timeline ends exactly at the
            // planned finish ("FINISH at 11.6 mi"), not a derived value.
            let cumMi = finishMi ?? milesFor(total)
            let remMi: Double? = {
                if let cum = cumMi, let pv = prevMi { return cum - pv }
                return milesFor(remMin)
            }()
            out.append(.finish(atCumMi: cumMi, remainingMi: remMi, remainingMin: remMin))
        } else if totalDurationMin == nil {
            out.append(.finish(atCumMi: nil, remainingMi: nil, remainingMin: nil))
        }
        return out
    }

    /// Canonical mile for gel index `i` from the planner-emitted atMiles.
    /// Nil when the payload doesn't ship atMiles (older clients) — caller
    /// falls back to the local pace × minutes computation.
    private func canonicalMile(at i: Int) -> Double? {
        guard fueling.atMiles.indices.contains(i) else { return nil }
        return fueling.atMiles[i]
    }

    private func milesFor(_ minutes: Int) -> Double? {
        guard let pace = paceSPerMi, pace > 0, minutes > 0 else { return nil }
        return Double(minutes) * 60.0 / pace
    }

    @ViewBuilder
    private func rowView(_ row: Row, accent: Color) -> some View {
        switch row {
        case .gel(let idx, let mi, let cum, _):
            // Headline reads TIME because the watch fires by elapsed time
            // (doctrine: "every ~30 min"). Mile is a sub-line approximation
            // ("around 2.5 mi") so the runner can orient — at planned pace
            // they'll be near that mile when the cue fires, but the actual
            // trigger is the clock.
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Circle().fill(accent).frame(width: 8, height: 8)
                    .padding(.leading, 6).offset(y: -2)
                VStack(alignment: .leading, spacing: 1) {
                    HStack(alignment: .firstTextBaseline, spacing: 7) {
                        Text("GEL \(idx)")
                            .font(Faff.F.oswald(12, .semibold)).tracking(1.2)
                            .foregroundStyle(accent)
                        Text("at ~\(formatMin(cum)) in")
                            .font(Faff.F.inter(13, .semibold))
                            .foregroundStyle(Faff.C.ink)
                    }
                    if let mi {
                        Text("around \(formatMi(mi)) mi")
                            .font(Faff.F.inter(11))
                            .foregroundStyle(Faff.C.textMuted)
                    }
                }
                Spacer(minLength: 6)
            }
            .padding(.vertical, 8).padding(.horizontal, 8)
            .background(accent.opacity(0.07),
                        in: RoundedRectangle(cornerRadius: 7, style: .continuous))
        case .finish(let cumMi, _, let remMin):
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Circle().fill(Faff.C.textDim.opacity(0.4))
                    .frame(width: 8, height: 8)
                    .padding(.leading, 6).offset(y: -2)
                VStack(alignment: .leading, spacing: 1) {
                    if let remMin, let total = totalDurationMin {
                        Text("FINISH at ~\(formatMin(total))")
                            .font(Faff.F.oswald(12, .semibold)).tracking(1.2)
                            .foregroundStyle(Faff.C.textDim)
                        // Distance is the firm number (prescribed by the plan),
                        // so it reads without an "around" hedge.
                        if let cumMi {
                            Text("\(formatMi(cumMi)) mi · \(remMin) min more")
                                .font(Faff.F.inter(11))
                                .foregroundStyle(Faff.C.textMuted)
                        } else {
                            Text("\(remMin) min more")
                                .font(Faff.F.inter(11))
                                .foregroundStyle(Faff.C.textMuted)
                        }
                    } else {
                        Text("RUN TO FINISH")
                            .font(Faff.F.oswald(12, .semibold)).tracking(1.2)
                            .foregroundStyle(Faff.C.textDim)
                    }
                }
                Spacer(minLength: 6)
            }
            .padding(.vertical, 8).padding(.horizontal, 8)
        }
    }

    private func formatMi(_ mi: Double) -> String {
        mi < 10 ? String(format: "%.1f", mi) : String(format: "%.0f", mi)
    }
    private func formatMin(_ m: Int) -> String {
        if m < 60 { return "\(m) min" }
        let h = m / 60, mm = m % 60
        return mm == 0 ? "\(h)h" : "\(h):\(String(format: "%02d", mm))"
    }
}

// MARK: - Race status pill (Today)

/// One-line race-readiness summary under the date strip. Color tracks
/// trajectory: green=ahead, ink=on-track, amber=behind. Compact so it
/// doesn't crowd the date strip + coach line + hero.
struct RaceStatusPill: View {
    let raceName: String
    let daysAway: Int
    let status: String   // "on-track" | "behind" | "ahead"

    var body: some View {
        let (label, bg, fg): (String, Color, Color) = {
            switch status {
            case "ahead":    return ("AHEAD",    Faff.C.recovery.opacity(0.14), Faff.C.recovery)
            case "behind":   return ("BEHIND",   Faff.C.warn.opacity(0.14),     Faff.C.warn)
            default:         return ("ON TRACK", Faff.C.pillBg,                  Faff.C.ink)
            }
        }()
        return HStack(spacing: 8) {
            Text(label).font(Faff.F.oswald(10, .semibold)).tracking(1.2).foregroundStyle(fg)
            Text("·").foregroundStyle(Faff.C.textFaint)
            Text("\(raceName)").font(Faff.F.inter(12, .semibold)).foregroundStyle(Faff.C.ink)
            Text("· \(daysAway)d").font(Faff.F.inter(11)).foregroundStyle(Faff.C.textMuted)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 11).padding(.vertical, 7)
        .background(bg, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8).stroke(fg.opacity(0.25), lineWidth: 1)
        )
    }
}

// MARK: - Tune-up race recommendation card

/// Coach-voice card surfaced on Today when the engine recommends a
/// tune-up race (behind on trajectory + room to act). Single-button
/// dismissable per session; tapping the card body opens search.
struct TuneUpRecCard: View {
    let copy: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "flag.checkered")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Faff.C.race)
                Text("CONSIDER A TUNE-UP RACE")
                    .font(Faff.F.oswald(11, .semibold)).tracking(1.2)
                    .foregroundStyle(Faff.C.race)
                Spacer()
            }
            Text(copy)
                .font(Faff.F.inter(13)).foregroundStyle(Faff.C.ink).lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Faff.C.race.opacity(0.07), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12).stroke(Faff.C.race.opacity(0.30), lineWidth: 1)
        )
    }
}
