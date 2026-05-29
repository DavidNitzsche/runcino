//
//  TodayView.swift
//
//  iPhone TODAY surface — PAPER GUT (2026-05-29).
//
//  This is no longer a stack of rounded cards. It is an edge-to-edge
//  editorial spec-sheet, per docs/DESIGN_OVERHAUL_2026-05-29.md:
//
//    1) RACE-BIB SPINE  — FAFF wordmark · race name · T-N · GOAL · WK x/n
//                         · status ● (from readiness/ACWR, no LLM).
//    2) VERB HERO       — massive Oswald 700 verb bleeding off the edge,
//                         ghosted numeral behind, [ BRACKET ] token + a
//                         tone registration rule. The verb carries ALL the
//                         personality — no prose under it.
//    3) STRUCTURE BAND  — the prescribed session shape as a duration-
//                         weighted intensity strip (warmup/work/rec/cool).
//    4) BODY SPEC-SHEET — SLEEP / RHR / HRV / LOAD as dense ruled SpecRows
//                         (replaces the rounded SiblingCard tiles).
//    5) THIS WEEK       — 7 graphic volume bars (replaces WeekStripV3).
//    6) DISPATCH        — the coach voice in its designated telex slot.
//    7) STAMP FOOTER    — page/version registration stamps.
//
//  Cardinal Rules honoured: zero-LLM (facts only), watch untouched,
//  token-driven (Theme.*) so the dark skin stays one swap away. ALL the
//  existing data plumbing — loadAll fan-out, AppCache hydration, skip
//  toggle, WatchSync push, HealthKit import — is preserved verbatim; only
//  the visual shell is gutted. TrainingState is added to the fan-out so
//  the race-bib spine reads real countdown/goal/phase data.
//

import SwiftUI

struct TodayView: View {
    // Initial values come from the last successful response on disk via
    // AppCache. First-ever launch reads nil; every subsequent launch
    // paints real (slightly stale) content the instant the view appears.
    @State private var briefing: Briefing? =
        AppCache.read(.todayBriefing, as: Briefing.self)
    @State private var workout: WatchWorkout? =
        AppCache.read(.todayWorkout, as: TodayWorkoutWrapper.self)?.workout
    @State private var planWeek: PlanWeek? =
        AppCache.read(.planWeek, as: PlanWeek.self)
    @State private var readiness: ReadinessSnapshot? =
        AppCache.read(.readiness, as: ReadinessSnapshot.self)
    /// Race-bib spine data (T-N · GOAL · phase · week x/n · week mileage).
    /// Same payload the PLAN tab uses — added to TODAY's fan-out so the
    /// header reads real race context instead of fabricating it.
    @State private var training: TrainingState? =
        AppCache.read(.trainingState, as: TrainingState.self)
    @State private var error: String?
    // P-SKIP (Phase 12 · 2026-05-28). Mirror of the web "is today skipped?"
    // signal. Hydrated by GET /api/today/skip on every loadAll().
    @State private var todaySkipped: Bool = false
    @State private var skipBusy: Bool = false

    private let hPad: CGFloat = 20

    var body: some View {
        NavigationStack {
            ScrollView {
                let state = FaffAdapter.resolveDayState(
                    plan: planWeek,
                    briefing: briefing,
                    workout: workout,
                    skipped: todaySkipped
                )

                VStack(alignment: .leading, spacing: 0) {
                    raceBibSpine

                    if let error { errorBlock(error) }

                    verbHero(state: state)

                    if let w = workout, w.phases.count > 1,
                       state == .easy || state == .quality || state == .long || state == .race_week {
                        structureBand(workout: w, state: state)
                    }

                    // 3b · PRESCRIPTION — pace / HR / fuel for the prescribed
                    // session (#163). Server-emitted on TODAY only; gated to
                    // the workout states so it never trails a done/rest verb.
                    if let rows = briefing?.workout_breakdown, !rows.isEmpty,
                       state == .easy || state == .quality || state == .long || state == .race_week {
                        prescriptionSheet(rows: rows)
                    }

                    bodySpecSheet(state: state)

                    weekStripSection

                    // DISPATCH — coach voice, restyled telex slot. Skeleton
                    // while loading, snaps in when the brief arrives. Never
                    // blocks the screen.
                    CoachSlot(
                        briefing: briefing,
                        surface: "today",
                        askPrompt: briefing.map { askPrompt(for: $0.mode) },
                        onCheckIn: { rating in
                            guard let b = briefing else { return false }
                            do {
                                try await API.checkin(
                                    rating: rating.rawValue,
                                    briefingId: "\(b.surface)|\(b.mode)"
                                )
                                Task { await loadAll() }
                                return true
                            } catch {
                                return false
                            }
                        }
                    )
                    .padding(.top, 8)

                    stampFooter
                }
                .padding(.bottom, 44)
                .animation(.spring(response: 0.45, dampingFraction: 0.85), value: workout?.workoutId)
                .animation(.spring(response: 0.45, dampingFraction: 0.85), value: briefing?.lead)
                .animation(.spring(response: 0.45, dampingFraction: 0.85), value: todaySkipped)
            }
            .background(Theme.bgPage.ignoresSafeArea())
            .toolbar(.hidden, for: .navigationBar)
            .task { await loadAll() }
            .refreshable { await loadAll() }
            .sensoryFeedback(.success, trigger: workout?.workoutId)
            .sensoryFeedback(.success, trigger: todaySkipped)
        }
    }

    // ══════════════════════════════════════════════════════════════════
    // 1 · RACE-BIB SPINE
    // ══════════════════════════════════════════════════════════════════

    private var raceBibSpine: some View {
        VStack(alignment: .leading, spacing: 12) {
            // FAFF wordmark ←→ date stamp
            HStack(alignment: .firstTextBaseline) {
                Text("FAFF")
                    .font(Theme.Font.display(22))
                    .tracking(2)
                    .foregroundStyle(Theme.ink)
                Spacer()
                Stamp(todayDateStamp, tone: .mute)
            }

            if let race = training?.race {
                Text(race.name.uppercased())
                    .font(Theme.Font.display(26))
                    .tracking(Theme.Font.tracking(for: 26))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)

                spineSpecLine(
                    leading: "T\u{2212}\(race.days_to_race)",
                    leadingTone: .race,
                    goal: race.goal,
                    weekText: weekText
                )
            } else {
                Text((training?.currentPhase ?? "BASE").uppercased() + " PHASE")
                    .font(Theme.Font.display(26))
                    .tracking(Theme.Font.tracking(for: 26))
                    .foregroundStyle(Theme.ink)
                spineSpecLine(
                    leading: training?.currentPhase?.uppercased() ?? "BASE",
                    leadingTone: .learn,
                    goal: nil,
                    weekText: weekText
                )
            }
        }
        .padding(.horizontal, hPad)
        .padding(.top, 8)
        .padding(.bottom, 16)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Theme.line).frame(height: 1)
        }
    }

    /// `T-87 · GOAL 1:45 · WK 4/12 · ON TRACK ●` — tabular, ruled.
    private func spineSpecLine(leading: String, leadingTone: FaffTone, goal: String?, weekText: String?) -> some View {
        let status = statusLabelTone()
        return HStack(spacing: 10) {
            Text(leading)
                .font(monoSpec(12))
                .foregroundStyle(leadingTone.color)
            specDot()
            if let goal {
                Text("GOAL \(goal)").font(monoSpec(12)).foregroundStyle(Theme.mute)
                specDot()
            }
            if let weekText {
                Text(weekText).font(monoSpec(12)).foregroundStyle(Theme.mute)
                specDot()
            }
            HStack(spacing: 5) {
                Text(status.0).font(monoSpec(12)).foregroundStyle(status.1.color)
                RegistrationDot(tone: status.1, size: 7)
            }
            Spacer(minLength: 0)
        }
        .lineLimit(1)
        .minimumScaleFactor(0.7)
    }

    // ══════════════════════════════════════════════════════════════════
    // 2 · VERB HERO
    // ══════════════════════════════════════════════════════════════════

    private func verbHero(state: FaffDayState) -> some View {
        let tone = tone(for: state)
        let verb = FaffAdapter.heroVerb(state: state, todayMi: todayMi)
        let ghost = ghostNumber(for: state)

        return HStack(alignment: .top, spacing: 14) {
            // Tone registration rule — a thin vertical mark, color as
            // punctuation not fill.
            Rectangle()
                .fill(tone.color)
                .frame(width: 4)
                .frame(maxHeight: .infinity)

            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .center) {
                    FaffBracket(bracketToken(for: state), tone: tone, size: 11)
                    Spacer()
                    if showSkipChip(for: state) { skipChip(currentState: state) }
                }

                Text(verb)
                    .displayRecipe(size: verbSize(verb))
                    .foregroundStyle(Theme.ink)
                    .minimumScaleFactor(0.5)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)

                if let sub = workoutSubline(state: state) {
                    Text(sub)
                        .font(.body(14, weight: .medium))
                        .foregroundStyle(Theme.mute)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(alignment: .topTrailing) {
                if let ghost {
                    Text(ghost)
                        .font(Theme.Font.display(190))
                        .monospacedDigit()
                        .foregroundStyle(Theme.ink.opacity(0.045))
                        .offset(x: 26, y: -34)
                        .fixedSize()
                        .allowsHitTesting(false)
                }
            }
        }
        .frame(minHeight: 188, alignment: .top)
        .clipped()
        .padding(.horizontal, hPad)
        .padding(.top, 22)
        .padding(.bottom, 18)
    }

    // ══════════════════════════════════════════════════════════════════
    // 3 · STRUCTURE BAND
    // ══════════════════════════════════════════════════════════════════

    private func structureBand(workout: WatchWorkout, state: FaffDayState) -> some View {
        let dayTone = tone(for: state)
        let segments: [IntensitySegment] = workout.phases.map { ph in
            let segTone: FaffTone
            let emphatic: Bool
            switch ph.type {
            case .work:      segTone = dayTone;  emphatic = true
            case .recovery:  segTone = dayTone;  emphatic = false
            case .warmup, .cooldown: segTone = .mute; emphatic = false
            }
            return IntensitySegment(
                weight: Double(max(1, ph.durationSec)),
                tone: segTone,
                emphatic: emphatic
            )
        }
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                SpecLabel("SESSION SHAPE", size: 10)
                Spacer()
                Text(workout.name.uppercased())
                    .font(monoSpec(10)).foregroundStyle(Theme.mute)
                    .lineLimit(1).minimumScaleFactor(0.6)
            }
            IntensityBar(segments: segments, height: 10)
            // est minutes / phase count
            HStack(spacing: 8) {
                Text("\(workout.totalEstimatedMinutes) MIN").font(monoSpec(10)).foregroundStyle(Theme.mute)
                specDot()
                Text("\(workout.phases.count) SEGMENTS").font(monoSpec(10)).foregroundStyle(Theme.mute)
                if let pace = workout.paceLabel {
                    specDot()
                    Text("ZONE \(pace.uppercased())").font(monoSpec(10)).foregroundStyle(Theme.mute)
                }
            }
        }
        .padding(.horizontal, hPad)
        .padding(.vertical, 16)
    }

    // ══════════════════════════════════════════════════════════════════
    // 4 · BODY SPEC-SHEET
    // ══════════════════════════════════════════════════════════════════

    private func bodySpecSheet(state: FaffDayState) -> some View {
        let tiles = FaffAdapter.buildSibling(state: state, readiness: readiness, plan: planWeek).tiles
        return VStack(alignment: .leading, spacing: 0) {
            HStack {
                SpecLabel("BODY · TODAY", size: 10)
                Spacer()
                if let label = readiness?.label {
                    Stamp(label, tone: readinessTone())
                }
            }
            .padding(.bottom, 8)
            TickRule(ticks: 28)
                .padding(.bottom, 2)

            if tiles.isEmpty {
                Text("NO BODY DATA SYNCED")
                    .font(monoSpec(11)).foregroundStyle(Theme.dim)
                    .padding(.vertical, 16)
            } else {
                ForEach(Array(tiles.enumerated()), id: \.offset) { idx, tile in
                    SpecRow(
                        label: tile.label,
                        value: tile.value,
                        unit: tile.valueUnit,
                        meta: tile.meta,
                        tone: FaffTone.from(tile.valueColor),
                        dot: FaffTone.from(tile.dot),
                        showRule: idx != 0
                    )
                }
            }
        }
        .padding(.horizontal, hPad)
        .padding(.vertical, 16)
    }

    // ══════════════════════════════════════════════════════════════════
    // 5 · THIS WEEK — graphic volume bars
    // ══════════════════════════════════════════════════════════════════

    private var weekStripSection: some View {
        let payload = FaffAdapter.buildWeekStrip(plan: planWeek, todaySkipped: todaySkipped)
        let maxMi = max(1, payload.days.map { $0.plannedDistance ?? 0 }.max() ?? 1)
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                SpecLabel("THIS WEEK", size: 10)
                Spacer()
                Text(weekMileageText(payload))
                    .font(monoSpec(11)).foregroundStyle(Theme.mute)
            }

            HStack(alignment: .bottom, spacing: 6) {
                ForEach(payload.days) { day in
                    weekBar(day: day, maxMi: maxMi)
                }
            }
            .frame(height: 84)
        }
        .padding(.horizontal, hPad)
        .padding(.vertical, 16)
        .overlay(alignment: .top) {
            Rectangle().fill(Theme.line).frame(height: 1)
        }
    }

    private func weekBar(day: FaffWeekDay, maxMi: Double) -> some View {
        let mi = day.plannedDistance ?? 0
        let tone = FaffTone.forType(day.plannedType)
        let done = day.completedRunId != nil
        let barH = max(4, CGFloat(mi / maxMi) * 56)
        return VStack(spacing: 6) {
            Spacer(minLength: 0)
            // mileage value (tiny)
            Text(mi > 0 ? trimMi(mi) : "—")
                .font(monoSpec(8.5))
                .foregroundStyle(day.isToday ? tone.color : Theme.dim)
                .lineLimit(1).minimumScaleFactor(0.5)
            // the bar
            RoundedRectangle(cornerRadius: 2)
                .fill(done || day.isToday ? tone.color : tone.color.opacity(0.18))
                .frame(height: barH)
                .overlay(alignment: .top) {
                    if day.isToday {
                        // today registration: a hairline cap notch
                        Rectangle().fill(Theme.ink).frame(height: 2)
                    }
                }
            // day letter
            Text(dowLetter(day.dow))
                .font(monoSpec(9))
                .foregroundStyle(day.isToday ? Theme.ink : Theme.dim)
        }
        .frame(maxWidth: .infinity)
    }

    // ══════════════════════════════════════════════════════════════════
    // 7 · STAMP FOOTER
    // ══════════════════════════════════════════════════════════════════

    private var stampFooter: some View {
        HStack(spacing: 8) {
            Stamp("FAFF", tone: .mute)
            Stamp("TODAY", tone: .mute)
            Spacer()
            Stamp(todayDateStamp, tone: .mute)
            Stamp("v4", tone: .race)
        }
        .padding(.horizontal, hPad)
        .padding(.top, 22)
    }

    // ══════════════════════════════════════════════════════════════════
    // Load — UNCHANGED plumbing (+ TrainingState added to the fan-out)
    // ══════════════════════════════════════════════════════════════════

    private func loadAll() async {
        async let bRes = (try? await API.briefing(surface: "today"))
        async let wRes = (try? await API.fetchWatchWorkout())
        async let pRes = (try? await API.fetchPlanWeek())
        async let rRes = (try? await API.fetchReadiness())
        async let sRes = (try? await API.fetchTodaySkipped())
        async let tRes = (try? await API.fetchTrainingState())

        let b = await bRes
        let w = await wRes
        let p = await pRes
        let r = await rRes
        let s = await sRes
        let t = await tRes

        self.briefing = b
        self.workout = w
        self.planWeek = p
        self.readiness = r ?? nil
        self.todaySkipped = s ?? false
        self.training = (t ?? nil) ?? self.training
        self.error = (b == nil && w == nil && p == nil)
            ? "Couldn't reach the coach. Pull to refresh."
            : nil

        // Push the freshly-fetched workout to the watch so the watch picks
        // up plan edits without the user having to relaunch the iPhone app.
        Task { await WatchSync.shared.pushTodayToWatch() }

        // Quiet HK workout import — only runs if Health auth was previously
        // granted; never prompts here.
        Task { await HealthKitImporter.shared.importIfConnected(daysBack: 3) }
    }

    // ══════════════════════════════════════════════════════════════════
    // Skip chip (P-SKIP · Phase 12) — logic unchanged, restyled as a Stamp
    // ══════════════════════════════════════════════════════════════════

    private func showSkipChip(for state: FaffDayState) -> Bool {
        switch state {
        case .easy, .quality, .long, .skipped: return true
        default: return false
        }
    }

    @ViewBuilder
    private func skipChip(currentState: FaffDayState) -> some View {
        let isSkipped = currentState == .skipped
        let chipText = skipBusy ? "…" : (isSkipped ? "UNDO SKIP" : "SKIP")
        Button {
            guard !skipBusy else { return }
            Task { await toggleSkip(currentlySkipped: isSkipped) }
        } label: {
            Stamp(chipText, tone: isSkipped ? .mute : .over)
        }
        .buttonStyle(.plain)
        .disabled(skipBusy)
        .accessibilityLabel(isSkipped ? "Undo skip" : "Skip today's workout")
    }

    private func toggleSkip(currentlySkipped: Bool) async {
        skipBusy = true
        defer { skipBusy = false }
        do {
            if currentlySkipped {
                try await API.deleteSkipToday()
                self.todaySkipped = false
            } else {
                try await API.postSkipToday()
                self.todaySkipped = true
            }
        } catch {
            // Network blip → silently re-fetch the truth below.
        }
        await loadAll()
    }

    // ══════════════════════════════════════════════════════════════════
    // Helpers
    // ══════════════════════════════════════════════════════════════════

    private var todayMi: Double? {
        planWeek?.days.first(where: { $0.is_today })?.distance_mi
    }

    private var weekText: String? {
        guard let idx = training?.currentWeekIdx, let n = training?.weeks.count, n > 0 else { return nil }
        return "WK \(idx + 1)/\(n)"
    }

    private var todayDateStamp: String {
        let f = DateFormatter()
        f.dateFormat = "E d MMM"
        return f.string(from: Date()).uppercased()
    }

    private func weekMileageText(_ p: WeekStripPayload) -> String {
        let done = Int(p.completedMi.rounded())
        let planned = Int(p.plannedMi.rounded())
        return "\(done)/\(planned) MI"
    }

    /// Status ● — derived from readiness band/score + ACWR. NO LLM.
    private func statusLabelTone() -> (String, FaffTone) {
        // ACWR spike overrides everything — protect the runner.
        if let acwr = readiness?.loadAcwr, acwr > 1.35 {
            return ("LOAD HIGH", .over)
        }
        let band = (readiness?.band ?? "").lowercased()
        switch band {
        case "primed":                 return ("ON TRACK", .green)
        case "steady", "ready":        return ("STEADY", .green)
        case "caution", "moderate":    return ("HOLD", .amber)
        case "compromised", "low":     return ("BACK OFF", .over)
        default: break
        }
        if let s = readiness?.score {
            if s >= 80 { return ("ON TRACK", .green) }
            if s >= 60 { return ("STEADY", .green) }
            if s >= 40 { return ("HOLD", .amber) }
            return ("BACK OFF", .over)
        }
        return ("—", .mute)
    }

    private func readinessTone() -> FaffTone { statusLabelTone().1 }

    private func tone(for state: FaffDayState) -> FaffTone {
        switch state {
        case .easy:          return .green
        case .quality:       return .amber
        case .long:          return .dist
        case .rest:          return .rest
        case .done_nailed:   return .green
        case .done_ease_off: return .amber
        case .race_week:     return .race
        case .new_user:      return .learn
        case .niggle:        return .amber
        case .sick:          return .over
        case .missed:        return .amber
        case .skipped:       return .mute
        }
    }

    private func bracketToken(for state: FaffDayState) -> String {
        switch state {
        case .easy:          return "EASY"
        case .quality:       return "QUALITY"
        case .long:          return "LONG"
        case .rest:          return "REST DAY"
        case .done_nailed:   return "LOGGED"
        case .done_ease_off: return "LOGGED · BIG"
        case .race_week:     return "RACE WEEK"
        case .new_user:      return "WELCOME"
        case .niggle:        return "NIGGLE"
        case .sick:          return "SICK"
        case .missed:        return "MISSED"
        case .skipped:       return "SKIPPED"
        }
    }

    /// The big ghosted numeral behind the verb.
    private func ghostNumber(for state: FaffDayState) -> String? {
        switch state {
        case .easy, .quality, .long:
            if let mi = todayMi, mi > 0 { return trimMi(mi) }
            return nil
        case .race_week:
            if let d = training?.race?.days_to_race { return "\(d)" }
            return nil
        case .done_nailed, .done_ease_off:
            let banked = workout?.distanceMi ?? todayMi ?? 0
            return banked > 0 ? trimMi(banked) : nil
        default:
            return nil
        }
    }

    /// One editorial sub-line under the verb (workout identity / context).
    private func workoutSubline(state: FaffDayState) -> String? {
        switch state {
        case .easy, .quality, .long:
            if let w = workout, !w.summary.isEmpty { return w.summary }
            if let w = workout, !w.name.isEmpty { return w.name }
            return nil
        case .race_week:
            if let race = training?.race { return "Taper holds. \(race.name) is close." }
            return nil
        default:
            return nil
        }
    }

    private func verbSize(_ verb: String) -> CGFloat {
        let n = verb.count
        let hasSpace = verb.replacingOccurrences(of: ".", with: "").contains(" ")
        if n <= 6 { return 84 }
        if n <= 10 { return hasSpace ? 72 : 66 }
        if n <= 15 { return 60 }
        return 50
    }

    private func dowLetter(_ dow: Int) -> String {
        // 0 = Monday per the strip's DOW convention.
        let labels = ["M", "T", "W", "T", "F", "S", "S"]
        return labels.indices.contains(dow) ? labels[dow] : "·"
    }

    private func trimMi(_ mi: Double) -> String {
        if mi.truncatingRemainder(dividingBy: 1) == 0 { return String(Int(mi)) }
        return String(format: "%.1f", mi)
    }

    private func monoSpec(_ size: CGFloat) -> Font {
        .system(size: size, weight: .semibold, design: .monospaced)
    }

    @ViewBuilder private func specDot() -> some View {
        Text("·").font(monoSpec(12)).foregroundStyle(Theme.dim)
    }

    private func askPrompt(for mode: String) -> String {
        switch mode {
        case "post-run": return "Let me know how it felt."
        case "pre-run":  return "How are the legs?"
        case "rest-day": return "Anything sore?"
        case "race-day": return "Ready?"
        default:         return "Let me know."
        }
    }

    private func errorBlock(_ msg: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Rectangle().fill(Theme.over).frame(width: 3).frame(maxHeight: .infinity)
            VStack(alignment: .leading, spacing: 4) {
                SpecLabel("BRIEFING ERROR", size: 9, tone: .over)
                Text(msg).font(.body(12)).foregroundStyle(Theme.ink.opacity(0.85)).lineSpacing(2)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.horizontal, hPad)
        .padding(.vertical, 12)
    }

    // ══════════════════════════════════════════════════════════════════
    // PRESCRIPTION — workout_breakdown rows (PACE / HR CAP / FUEL)
    // ══════════════════════════════════════════════════════════════════
    //
    // #163 · the prescribed session's pace / HR / fuel detail, emitted by
    // GET /api/briefing?surface=today — computed server-side by the SAME
    // buildWorkoutBreakdown() the web /today renders, so iOS mirrors web
    // exactly instead of re-deriving it client-side. The STRUCTURE BAND
    // above shows the session SHAPE; this shows the NUMBERS.

    private func prescriptionSheet(rows: [PosterBreakdownRow]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            SpecLabel("PRESCRIPTION", size: 10)
                .padding(.bottom, 8)
            TickRule(ticks: 28)
                .padding(.bottom, 2)
            ForEach(Array(rows.enumerated()), id: \.offset) { idx, row in
                prescriptionRow(row, showRule: idx != 0)
            }
        }
        .padding(.horizontal, hPad)
        .padding(.vertical, 16)
    }

    private func prescriptionRow(_ row: PosterBreakdownRow, showRule: Bool) -> some View {
        VStack(spacing: 0) {
            if showRule {
                Rectangle().fill(Theme.line).frame(height: 1)
            }
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                SpecLabel(row.label, size: 10)
                    .frame(width: 72, alignment: .leading)
                Text(row.body)
                    .font(.body(13, weight: .medium))
                    .foregroundStyle(Theme.ink.opacity(0.9))
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 8)
                if let tail = row.tail {
                    Text(tail)
                        .font(monoSpec(12))
                        .foregroundStyle(Theme.mute)
                        .multilineTextAlignment(.trailing)
                        .lineLimit(2)
                        .minimumScaleFactor(0.7)
                }
            }
            .padding(.vertical, 11)
        }
    }
}
