//
//  PlannedView.swift
//  Planned workout detail · the before-twin of Run Detail.
//  Mesh wears the effort temperature for the planned workout type.
//

import SwiftUI

struct PlannedView: View {
    /// ISO date for the planned day. nil → fetch today's workout (legacy
    /// behavior). Non-nil → fetch /api/watch/today?date=<iso>.
    let date: String?

    @State private var workout: WatchWorkout? =
        AppCache.read(.todayWorkout, as: TodayWorkoutWrapper.self)?.workout

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            FaffMeshView(mesh: .neutral)

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    header
                        .padding(.horizontal, 22)
                        .padding(.top, 8)

                    hero
                        .padding(.horizontal, 24)
                        .padding(.top, 18)

                    if workout?.fueling?.heatAdjusted == true {
                        section("CONDITIONS · RECALIBRATED") {
                            heatCard
                        }
                        .padding(.top, 24)
                    }

                    if !(workout?.phases.isEmpty ?? true) {
                        section("THE SHAPE") {
                            shapeBar
                        }
                        .padding(.top, 24)

                        section("THE SESSION") {
                            sessionList
                        }
                        .padding(.top, 24)
                    }

                    if let coach = coachLine {
                        section("WHY THIS, TODAY") {
                            CoachNote(
                                message: coach,
                                tag: "Coach",
                                accent: Theme.Accent.mintReady,
                                style: .note
                            )
                            .padding(.horizontal, -24)
                        }
                        .padding(.top, 12)
                    }

                    if let fueling = workout?.fueling, fueling.needed {
                        section("FUEL & HYDRATION") {
                            fuelTile(fueling: fueling)
                        }
                        .padding(.top, 6)
                    }

                    // WHY THIS WORKOUT · WorkoutWhyCard. Citation comes
                    // from the workout name's matching Learn slug (the
                    // tips library mirrors the doctrine articles). Deep
                    // links into LearnArticleSheet on tap. Toolkit · Family D.
                    if let slug = whyArticleSlug {
                        WorkoutWhyCard(
                            title: "Why this workout",
                            text: whyArticleSummary,
                            source: whyArticleSource,
                            learnSlug: slug
                        )
                        .padding(.horizontal, 24)
                        .padding(.top, 18)
                    }

                    Spacer(minLength: 40)
                }
            }
            // 2026-06-01 round 5: dead Start CTA retired.
            //
            // PlannedView's StickyCTABar shipped with an empty action
            // body (`/* push WatchMirror */` was a comment, not code)
            // AND .ignoresSafeArea(edges: .bottom) which buried it
            // behind the floating tab bar anyway. Doubly broken.
            //
            // The page is now preview-only · reached from TrainView
            // (tap a day in the plan). Today no longer routes here ·
            // David's feedback: the pre-run sheet already shows
            // identical content, so a separate page was redundant.
            // Live runs launch from Today's sheet directly into
            // WatchMirrorView, not from a preview page.
        }
        .task { await load() }
    }

    private var header: some View {
        HStack(spacing: 12) {
            BackChip { dismiss() }
            SpecLabel(text: "PLANNED", size: 13, tracking: 2.5, color: Theme.txt)
            Spacer()
        }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 0) {
            // RACE REHEARSAL eyebrow · fires when the watch payload's
            // fueling.isRehearsal flag is set. Same line carries the
            // workout's date-context eyebrow when not rehearsing.
            HStack(spacing: 8) {
                SpecLabel(text: eyebrowText, size: 11, tracking: 2.5, color: Theme.txt.opacity(0.7))
                if workout?.fueling?.isRehearsal == true {
                    Text("RACE REHEARSAL")
                        .font(.body(9, weight: .extraBold)).tracking(1.4)
                        .foregroundStyle(Theme.bg)
                        .padding(.horizontal, 6).padding(.vertical, 3)
                        .background(Theme.Accent.amberBright, in: Capsule())
                }
            }
            Text(workoutTitle)
                .displayRecipe(size: 44, weight: .bold)
                .foregroundStyle(Theme.txt)
                .shadow(color: .black.opacity(0.3), radius: 22, y: 2)
                .padding(.top, 9)

            HStack(alignment: .top, spacing: 24) {
                heroStat(value: distanceValue, key: Units.distanceLabel() == "km" ? "KILOMETERS" : "MILES")
                heroStat(value: estTimeValue, key: "EST TIME")
                heroStat(value: paceValue, key: "TARGET /\(Units.distanceLabel().uppercased())")
            }
            .padding(.top, 18)

            HStack(spacing: 8) {
                Pill(text: pillText, color: Color.white.opacity(0.16), textColor: Theme.txt, size: 10, tracking: 1)
                    .overlay(Capsule().stroke(Color.white.opacity(0.3), lineWidth: 1))
                // WATCH FACE hint · "WATCH · HR", "WATCH · PROGRESSION",
                // "WATCH · STRIDES" so the runner knows which in-run
                // face the watch will draw before they start. Hidden
                // when the server didn't pick a flavor.
                if let hint = watchFaceHint {
                    Text("WATCH · \(hint)")
                        .font(.body(9, weight: .extraBold)).tracking(1.4)
                        .foregroundStyle(Theme.txt)
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(Theme.Glass.fill, in: Capsule())
                        .overlay(Capsule().stroke(Theme.Glass.line, lineWidth: 1))
                }
            }
            .padding(.top, 15)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Uppercase watch-face label from WatchWorkout.displayHint, mapped
    /// to the three known flavors. Nil → no chip rendered.
    private var watchFaceHint: String? {
        guard let raw = workout?.displayHint?.lowercased() else { return nil }
        switch raw {
        case "hr": return "HR"
        case "progression": return "PROGRESSION"
        case "strides": return "STRIDES"
        default: return nil
        }
    }

    private func heroStat(value: String, key: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(value)
                .font(.display(24, weight: .bold))
                .tracking(-1)
                .foregroundStyle(Theme.txt)
            SpecLabel(text: key, size: 9, tracking: 1.5, color: Theme.txt.opacity(0.6))
        }
    }

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            SpecLabel(text: title, size: 11, tracking: 2, color: Theme.txt.opacity(0.6))
            content()
        }
        .padding(.horizontal, 22)
    }

    /// Heat-adjusted card · the body text comes from the workout's
    /// fueling.why (server-side, doctrine-cited) so the runner doesn't
    /// see the same canned "Targets eased…" line every hot day. Hidden by
    /// the surrounding gate when fueling.heatAdjusted=false.
    private var heatCard: some View {
        let body: String = {
            if let why = workout?.fueling?.why, !why.isEmpty { return why }
            return "Targets eased for today's conditions. Run by effort and hydrate before you start."
        }()
        return VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 9) {
                Image(systemName: "sun.max.fill")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(Theme.race)
                Text("Heat-adjusted")
                    .font(.body(14, weight: .extraBold))
                    .foregroundStyle(Theme.txt)
                Spacer()
            }
            Text(body)
                .font(.body(13, weight: .medium))
                .foregroundStyle(Theme.txt.opacity(0.92))
                .fixedSize(horizontal: false, vertical: true)
                .lineSpacing(2)
        }
        .padding(15)
        .background(
            LinearGradient(colors: [Theme.race.opacity(0.22), Color(hex: 0xD6261C).opacity(0.16)],
                           startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: 18, style: .continuous)
        )
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous)
            .stroke(Theme.race.opacity(0.4), lineWidth: 1))
    }

    private var shapeBar: some View {
        let segs = shapeSegments
        let totalFlex = segs.reduce(0.0) { $0 + $1.flex }
        return VStack(alignment: .leading, spacing: 8) {
            GeometryReader { geo in
                let unit = (geo.size.width - CGFloat(max(0, segs.count - 1)) * 3) / CGFloat(max(0.0001, totalFlex))
                HStack(alignment: .bottom, spacing: 3) {
                    ForEach(segs) { s in
                        VStack {
                            Spacer(minLength: 0)
                            Text(s.tag)
                                .font(.body(8, weight: .bold))
                                .foregroundStyle(Color.black.opacity(0.55))
                                .padding(.bottom, 5)
                        }
                        .frame(width: max(0, unit * CGFloat(s.flex)), height: 54 * s.heightFrac)
                        .background(s.color, in: UnevenRoundedRectangle(topLeadingRadius: 6, topTrailingRadius: 6))
                    }
                }
            }
            .frame(height: 54)

            HStack(spacing: 0) {
                ForEach(Array(segs.enumerated()), id: \.offset) { idx, s in
                    let align: Alignment = idx == 0 ? .leading : (idx == segs.count - 1 ? .trailing : .center)
                    Text(s.subLabel)
                        .font(.body(9, weight: .bold))
                        .foregroundStyle(Theme.txt.opacity(0.55))
                        .frame(maxWidth: .infinity, alignment: align)
                }
            }
        }
    }

    private var sessionList: some View {
        VStack(spacing: 0) {
            ForEach(sessionRows) { r in
                HStack(alignment: .top, spacing: 13) {
                    Circle().fill(r.color).frame(width: 9, height: 9).padding(.top, 5)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(r.title)
                            .font(.body(15, weight: .extraBold))
                            .foregroundStyle(Theme.txt)
                        Text(r.subtitle)
                            .font(.body(11, weight: .bold))
                            .foregroundStyle(Theme.txt.opacity(0.62))
                            .lineSpacing(2)
                    }
                    Spacer(minLength: 0)
                }
                .padding(.vertical, 11)
            }
        }
    }

    private func fuelTile(fueling: WatchFueling) -> some View {
        GlassTile(padding: 6) {
            VStack(spacing: 0) {
                fuelRow("Gels", "\(fueling.gels) · \(fueling.gPerHr) g/hr")
                if !fueling.atMins.isEmpty {
                    let mins = fueling.atMins.map(String.init).joined(separator: " · ")
                    fuelRow("At minutes", mins)
                }
                fuelRow("Total carbs", "\(fueling.totalCarbsG) g")
                if !fueling.shortLine.isEmpty {
                    fuelRow("Coach", fueling.shortLine)
                }
            }
        }
    }

    private func fuelRow(_ k: String, _ v: String) -> some View {
        HStack {
            Text(k).font(.body(13, weight: .semibold)).foregroundStyle(Theme.txt.opacity(0.66))
            Spacer()
            Text(v).font(.body(12, weight: .bold)).foregroundStyle(Theme.txt)
        }
        .padding(.vertical, 11)
        .padding(.horizontal, 10)
    }

    // MARK: - Data

    private var effort: FaffEffort {
        FaffEffort.fromType(workout?.paceLabel.map { paceLabelToType($0) } ?? "tempo")
    }

    private func paceLabelToType(_ label: String) -> String {
        switch label.uppercased() {
        case "T":  return "tempo"
        case "I":  return "intervals"
        case "E":  return "easy"
        case "R":  return "recovery"
        case "L":  return "long"
        case "RACE": return "race"
        default:   return "tempo"
        }
    }

    private var workoutTitle: String {
        workout?.name ?? "Workout"
    }

    // MARK: - WorkoutWhyCard helpers
    //
    // Resolve the relevant Learn article slug + 1-line summary +
    // citation source for the effort type. The slugs match the Learn
    // article SEED in web-v2/app/learn/[slug]/seed.ts so the deep link
    // lands on a real page. Slug is nil for rest/recovery so the card
    // hides.

    private var whyArticleSlug: String? {
        let pace = (workout?.paceLabel ?? "").lowercased()
        let name = (workout?.name ?? "").lowercased()
        if pace.contains("t") || name.contains("tempo") || name.contains("threshold") {
            return "threshold"
        }
        if pace.contains("i") || name.contains("intervals") || name.contains("vo2") {
            return "vo2-max"
        }
        if name.contains("long") {
            return "the-long-run"
        }
        if pace.contains("e") || name.contains("easy") {
            return "why-easy-is-easy"
        }
        return nil
    }
    private var whyArticleSummary: String {
        switch whyArticleSlug {
        case "threshold":
            return "Threshold work teaches your body to clear lactate at race effort. Hold the surges even, not hard."
        case "vo2-max":
            return "Short, hard intervals raise the ceiling on the engine you race with. The recoveries are part of the work."
        case "the-long-run":
            return "The aerobic stimulus is in the time on feet, not the last-mile split. Stay in the temperature for the day."
        case "why-easy-is-easy":
            return "Easy means easy. Most of the week's adaptation banks here, where the cost stays cheap."
        default:
            return ""
        }
    }
    private var whyArticleSource: String? {
        switch whyArticleSlug {
        case "threshold": return "Daniels Table 4 · Research/04 §threshold"
        case "vo2-max":   return "Daniels VO₂max · Research/05 §intervals"
        case "the-long-run": return "Research/02 §long-run-doctrine"
        case "why-easy-is-easy": return "Research/01 §80-20"
        default: return nil
        }
    }

    /// Eyebrow text · "MON, MAY 26 · TODAY · LONG". Falls back to the
    /// effort title alone when no date is provided · used to render a
    /// hardcoded "WED, MAY 28 · TODAY" regardless of the actual day.
    private var eyebrowText: String {
        let dayLabel = formattedDayLabel
        let effortLabel = effort.title.uppercased()
        if !dayLabel.isEmpty {
            return "\(dayLabel) · \(effortLabel)"
        }
        return effortLabel
    }

    /// Resolve "MON, MAY 26 · TODAY" (or just "MON, MAY 26") from the
    /// view's date argument. Empty string when no date — drops out of the
    /// eyebrow rather than showing yesterday's day-of-week.
    private var formattedDayLabel: String {
        let parts = (date ?? todayISO).split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3,
              let d = Calendar.current.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])) else {
            return ""
        }
        let f = DateFormatter(); f.dateFormat = "EEE, MMM d"
        let label = f.string(from: d).uppercased()
        let isToday = (date ?? todayISO) == todayISO
        return isToday ? "\(label) · TODAY" : label
    }

    private var todayISO: String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone.current
        return f.string(from: Date())
    }

    /// 2026-07-07 · units audit — display only.
    private var distanceValue: String {
        if let d = workout?.distanceMi { return Units.formatDistance(miles: d) }
        return "—"
    }

    private var estTimeValue: String {
        if let m = workout?.totalEstimatedMinutes { return "~\(m)" }
        return "—"
    }

    private var paceValue: String {
        if let phases = workout?.phases,
           let work = phases.first(where: { $0.type == .work && $0.targetPaceSPerMi != nil }),
           let p = work.targetPaceSPerMi {
            return PaceFormat.mmss(p)
        }
        return "—"
    }

    /// Pill chip under the hero · was hardcoded "PLANNED · WEEK 14 BUILD".
    /// Now reads the workout's paceLabel (the type code · T/I/E/R/L) so it
    /// matches the actual session.
    private var pillText: String {
        let lbl = workout?.paceLabel ?? ""
        if !lbl.isEmpty {
            return "PLANNED · \(lbl.uppercased())"
        }
        return "PLANNED"
    }

    /// Coach copy for this workout. Sourced from the watch workout's
    /// fueling.why when present (the only per-workout coach text that
    /// reliably ships from the server today). Hides otherwise.
    private var coachLine: String? {
        if let w = workout?.fueling?.why, !w.isEmpty { return w }
        return nil
    }

    /// Bars across the top of "THE SHAPE". Empty when no real phase data ·
    /// the surrounding `if !(workout?.phases.isEmpty ?? true)` gate hides
    /// this section in that case, so the old WU/THRESHOLD/CD mock fallback
    /// is gone.
    private var shapeSegments: [ShapeSeg] {
        guard let phases = workout?.phases, !phases.isEmpty else { return [] }
        return phases.enumerated().map { (i, p) in
            let frac: Double = {
                switch p.type {
                case .work: return 1.0
                case .warmup, .cooldown: return 0.46
                case .recovery: return 0.5
                }
            }()
            return ShapeSeg(
                id: i,
                tag: shortTag(p),
                heightFrac: frac,
                color: colorFor(p.type),
                subLabel: subLabelFor(p),
                flex: Double(max(1, p.durationSec / 120))
            )
        }
    }

    private func shortTag(_ p: WatchPhase) -> String {
        switch p.type {
        case .warmup:   return "WU"
        case .cooldown: return "CD"
        case .work:     return p.label.uppercased().split(separator: " ").first.map(String.init) ?? "WORK"
        case .recovery: return "REC"
        }
    }

    private func subLabelFor(_ p: WatchPhase) -> String {
        // 2026-07-07 · units audit — display only.
        if let d = p.distanceMi { return "\(Units.formatDistance(miles: d)) \(Units.distanceLabel())" }
        return "\(p.durationSec / 60) min"
    }

    private func colorFor(_ t: WatchPhaseType) -> Color {
        switch t {
        case .warmup:   return Theme.neutralTeal
        case .cooldown: return Theme.neutralTeal
        case .work:     return effort.dot
        case .recovery: return Theme.neutralTeal
        }
    }

    /// Row list under "THE SESSION". Empty when no real phase data ·
    /// surrounding gate hides the section. The hardcoded fallback that
    /// described David's CIM threshold workout regardless of his actual
    /// plan is gone.
    private var sessionRows: [SessionRow] {
        guard let phases = workout?.phases, !phases.isEmpty else { return [] }
        return phases.enumerated().map { (i, p) in
            let title = "\(p.label) · \(subLabelFor(p))"
            let detail: String = {
                if let tp = p.targetPaceSPerMi { return "@ \(PaceFormat.mmss(tp))/\(Units.distanceLabel()) · target pace" }
                return "fully easy · let HR settle"
            }()
            return SessionRow(id: i, title: title, subtitle: detail, color: colorFor(p.type))
        }
    }

    private func load() async {
        // Always fetch when a date is provided · the AppCache only holds
        // today's workout, so a different day must hit the wire.
        if let date {
            let w = try? await API.fetchWatchWorkout(date: date)
            await MainActor.run { workout = w }
        } else if workout == nil {
            let w = try? await API.fetchWatchWorkout()
            await MainActor.run { workout = w }
        }
    }
}

private struct ShapeSeg: Identifiable, Equatable {
    let id: Int
    let tag: String
    let heightFrac: Double
    let color: Color
    let subLabel: String
    let flex: Double

    static func == (lhs: ShapeSeg, rhs: ShapeSeg) -> Bool { lhs.id == rhs.id }
}

private struct SessionRow: Identifiable {
    let id: Int
    let title: String
    let subtitle: String
    let color: Color
}
