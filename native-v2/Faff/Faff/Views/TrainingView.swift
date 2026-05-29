//
//  TrainingView.swift
//
//  iPhone PLAN tab — PAPER GUT (2026-05-29).
//
//  No longer a stack of rounded component-cards (PageHeader + PhaseStrip
//  + VolumeArc + WeekAheadGrid + nextQualityCard). It is the whole race
//  arc rendered as one continuous editorial spec-sheet, per
//  docs/DESIGN_OVERHAUL_2026-05-29.md. The race is the spine; the plan
//  is the instrument readout beneath it.
//
//    1) RACE SPINE      — FAFF wordmark · RACES ▸ · race name · T−N ·
//                         GOAL · WK x/n · PHASE ● (phase-toned).
//    2) PHASE ARC       — BASE→BUILD→PEAK→TAPER→RACE as a proportional
//                         (week-weighted) strip, current block emphatic.
//    3) WEEKLY VOLUME   — every week's planned mileage as graphic bars,
//                         phase-toned, the current week notched in ink.
//    4) THIS WEEK       — the 7 days as dense ruled SpecRows (DOW · type
//                         · pace target · planned mi), today emphasised.
//    5) NEXT QUALITY    — the next hard session as a bracketed callout.
//    6) DISPATCH        — coach voice in its telex slot (surface=training).
//    7) STAMP FOOTER    — page/version registration stamps.
//
//  Cardinal Rules honoured: zero-LLM (facts only), watch untouched,
//  token-driven (Theme.*) for one-swap dark revert. ALL data plumbing is
//  preserved verbatim — load() fan-out (state + brief), AppCache
//  hydration, the Races sheet, refreshable. Week indices are 0-based on
//  the wire (plan_weeks.week_idx starts at 0); displayed as idx+1 (the
//  old eyebrow rendered idx directly → "WEEK 0 OF 13", now fixed).
//

import SwiftUI

struct TrainingView: View {
    @State private var briefing: Briefing? =
        AppCache.read(.trainingBriefing, as: Briefing.self)
    @State private var state: TrainingState? =
        AppCache.read(.trainingState, as: TrainingState.self)
    @State private var loading: Bool = AppCache.readRaw(.trainingState) == nil
    /// Races lost its primary tab in the 3-tab collapse; it opens here as
    /// a sheet, reachable from the spine (RACES ▸) in every state.
    @State private var showRacesSheet = false

    private let hPad: CGFloat = 20

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    raceSpine

                    if let s = state, !s.weeks.isEmpty {
                        let blocks = FaffAdapter.buildPhaseStrip(state: s)
                        let currentIdx = FaffAdapter.currentPhaseBlockIdx(
                            blocks: blocks, currentPhase: s.currentPhase
                        )
                        phaseArcBand(blocks: blocks, currentIdx: currentIdx, totalWeeks: s.weeks.count)

                        volumeArcSection(bars: FaffAdapter.buildVolumeArc(state: s))

                        let weekDays = FaffAdapter.buildWeekAhead(state: s)
                        if !weekDays.isEmpty,
                           let currentWeek = s.weeks.first(where: { $0.isCurrent }) {
                            weekAheadSection(days: weekDays, plannedMi: currentWeek.plannedMi, today: s.today)
                        }

                        if let q = s.nextQuality {
                            nextQualitySection(q)
                        }
                    } else if loading {
                        planSkeleton
                    } else {
                        noPlanBlock
                    }

                    // DISPATCH — coach voice on the phase / arc. Background-
                    // loads via CoachSlot, never blocks the structure above.
                    CoachSlot(briefing: briefing, surface: "training", askPrompt: nil)
                        .padding(.top, 8)

                    stampFooter
                }
                .padding(.bottom, 44)
                .animation(.spring(response: 0.45, dampingFraction: 0.85), value: state?.plan_id)
                .animation(.spring(response: 0.45, dampingFraction: 0.85), value: briefing?.lead)
            }
            .background(Theme.bgPage.ignoresSafeArea())
            .toolbar(.hidden, for: .navigationBar)
            .sheet(isPresented: $showRacesSheet) {
                RacesView()
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
            }
            .task { await load() }
            .refreshable { await load() }
        }
    }

    // ══════════════════════════════════════════════════════════════════
    // 1 · RACE SPINE
    // ══════════════════════════════════════════════════════════════════

    private var raceSpine: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text("FAFF")
                    .font(Theme.Font.display(22)).tracking(2)
                    .foregroundStyle(Theme.ink)
                Spacer()
                Button { showRacesSheet = true } label: {
                    Stamp("RACES \u{25B8}", tone: .race)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Open races")
            }

            if let race = state?.race {
                Text(race.name.uppercased())
                    .font(Theme.Font.display(26))
                    .tracking(Theme.Font.tracking(for: 26))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                planSpecLine(race: race)
            } else {
                Text("NO ACTIVE PLAN")
                    .font(Theme.Font.display(26))
                    .tracking(Theme.Font.tracking(for: 26))
                    .foregroundStyle(Theme.ink)
                HStack(spacing: 10) {
                    Text("PICK A RACE TO BUILD ONE")
                        .font(monoSpec(12)).foregroundStyle(Theme.mute)
                    Spacer(minLength: 0)
                }
                .lineLimit(1).minimumScaleFactor(0.7)
            }
        }
        .padding(.horizontal, hPad)
        .padding(.top, 8)
        .padding(.bottom, 16)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Theme.line).frame(height: 1)
        }
    }

    /// `T−87 · GOAL 1:45 · WK 4/12 · BUILD ●` — tabular, ruled.
    private func planSpecLine(race: TrainingRace) -> some View {
        let phase = (state?.currentPhase ?? "").uppercased()
        let pTone = phaseTone(state?.currentPhase ?? "")
        return HStack(spacing: 10) {
            Text("T\u{2212}\(race.days_to_race)")
                .font(monoSpec(12)).foregroundStyle(Theme.race)
            specDot()
            if let goal = race.goal, !goal.isEmpty {
                Text("GOAL \(goal)").font(monoSpec(12)).foregroundStyle(Theme.mute)
                specDot()
            }
            if let wt = weekText {
                Text(wt).font(monoSpec(12)).foregroundStyle(Theme.mute)
                specDot()
            }
            if !phase.isEmpty {
                HStack(spacing: 5) {
                    Text(phase).font(monoSpec(12)).foregroundStyle(pTone.color)
                    RegistrationDot(tone: pTone, size: 7)
                }
            }
            Spacer(minLength: 0)
        }
        .lineLimit(1)
        .minimumScaleFactor(0.7)
    }

    // ══════════════════════════════════════════════════════════════════
    // 2 · PHASE ARC — proportional block strip
    // ══════════════════════════════════════════════════════════════════

    private func phaseArcBand(blocks: [PhaseBlock], currentIdx: Int?, totalWeeks: Int) -> some View {
        let total = max(1, blocks.reduce(0) { $0 + $1.weekCount })
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                SpecLabel("PHASE ARC", size: 10)
                Spacer()
                Text("\(totalWeeks) WK").font(monoSpec(10)).foregroundStyle(Theme.mute)
            }
            GeometryReader { geo in
                let gap: CGFloat = 3
                let usable = geo.size.width - gap * CGFloat(max(0, blocks.count - 1))
                HStack(spacing: gap) {
                    ForEach(Array(blocks.enumerated()), id: \.element.id) { idx, b in
                        let w = usable * CGFloat(b.weekCount) / CGFloat(total)
                        let active = idx == currentIdx
                        let t = phaseTone(b.label)
                        VStack(spacing: 6) {
                            RoundedRectangle(cornerRadius: 2)
                                .fill(active ? t.color : t.color.opacity(0.26))
                                .frame(height: 9)
                                .overlay(alignment: .top) {
                                    if active {
                                        Rectangle().fill(Theme.ink).frame(height: 2)
                                    }
                                }
                            Text(b.label)
                                .font(monoSpec(8.5))
                                .foregroundStyle(active ? t.color : Theme.dim)
                                .lineLimit(1).minimumScaleFactor(0.5)
                        }
                        .frame(width: max(10, w))
                    }
                }
            }
            .frame(height: 32)
        }
        .padding(.horizontal, hPad)
        .padding(.vertical, 16)
    }

    // ══════════════════════════════════════════════════════════════════
    // 3 · WEEKLY VOLUME — every week as a graphic bar
    // ══════════════════════════════════════════════════════════════════

    private func volumeArcSection(bars: [VolumeBar]) -> some View {
        let maxMi = max(1, bars.map { $0.plannedMi }.max() ?? 1)
        let peak = bars.map { $0.plannedMi }.max() ?? 0
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                SpecLabel("WEEKLY VOLUME", size: 10)
                Spacer()
                Text("PEAK \(trimMi(peak)) MI").font(monoSpec(10)).foregroundStyle(Theme.mute)
            }
            HStack(alignment: .bottom, spacing: 3) {
                ForEach(bars) { bar in
                    let t = phaseTone(bar.phase)
                    let h = max(3, CGFloat(bar.plannedMi / maxMi) * 64)
                    RoundedRectangle(cornerRadius: 1.5)
                        .fill(bar.isCurrent ? t.color : t.color.opacity(0.30))
                        .frame(height: h)
                        .frame(maxWidth: .infinity)
                        .overlay(alignment: .top) {
                            if bar.isCurrent {
                                Rectangle().fill(Theme.ink).frame(height: 2)
                            }
                        }
                }
            }
            .frame(height: 64, alignment: .bottom)
        }
        .padding(.horizontal, hPad)
        .padding(.vertical, 16)
        .overlay(alignment: .top) {
            Rectangle().fill(Theme.line).frame(height: 1)
        }
    }

    // ══════════════════════════════════════════════════════════════════
    // 4 · THIS WEEK — 7 ruled SpecRows
    // ══════════════════════════════════════════════════════════════════

    private func weekAheadSection(days: [WeekAheadDay], plannedMi: Double, today: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                SpecLabel("THIS WEEK", size: 10)
                Spacer()
                Text("\(trimMi(plannedMi)) MI PLANNED")
                    .font(monoSpec(10)).foregroundStyle(Theme.mute)
            }
            .padding(.bottom, 8)
            TickRule(ticks: 28).padding(.bottom, 2)

            ForEach(Array(days.enumerated()), id: \.element.id) { idx, d in
                let isToday = d.date == today
                let isRest = d.type.lowercased() == "rest"
                SpecRow(
                    label: dowLabel(d.dow),
                    value: d.plannedMi > 0 ? trimMi(d.plannedMi) : "REST",
                    unit: d.plannedMi > 0 ? "MI" : nil,
                    meta: weekRowMeta(d),
                    tone: isRest ? .mute : FaffTone.forType(d.type),
                    dot: d.doneMi > 0 ? .green : (isToday ? FaffTone.forType(d.type) : nil),
                    showRule: idx != 0
                )
            }
        }
        .padding(.horizontal, hPad)
        .padding(.vertical, 16)
        .overlay(alignment: .top) {
            Rectangle().fill(Theme.line).frame(height: 1)
        }
    }

    private func weekRowMeta(_ d: WeekAheadDay) -> String {
        let word = (d.label?.isEmpty == false ? d.label! : d.type).uppercased()
        if d.type.lowercased() == "rest" { return word }
        return "\(word) · \(d.paceTarget)"
    }

    // ══════════════════════════════════════════════════════════════════
    // 5 · NEXT QUALITY — bracketed callout
    // ══════════════════════════════════════════════════════════════════

    private func nextQualitySection(_ q: TrainingNextQuality) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Rectangle().fill(Theme.goal).frame(width: 4).frame(maxHeight: .infinity)
            VStack(alignment: .leading, spacing: 7) {
                FaffBracket("NEXT QUALITY", tone: .amber, size: 10)
                Text(q.label ?? q.type.capitalized)
                    .font(Theme.Font.display(24)).tracking(0.4)
                    .foregroundStyle(Theme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 8) {
                    Text(dowLabel(q.dow)).font(monoSpec(11)).foregroundStyle(Theme.mute)
                    specDot()
                    Text("\(trimMi(q.mi)) MI").font(monoSpec(11)).foregroundStyle(Theme.mute)
                }
            }
            Spacer(minLength: 0)
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.horizontal, hPad)
        .padding(.vertical, 16)
        .overlay(alignment: .top) {
            Rectangle().fill(Theme.line).frame(height: 1)
        }
    }

    // ══════════════════════════════════════════════════════════════════
    // No-plan + skeleton
    // ══════════════════════════════════════════════════════════════════

    private var noPlanBlock: some View {
        VStack(alignment: .leading, spacing: 10) {
            FaffBracket("NO PLAN", tone: .learn, size: 11)
            Text("Pick a race and Faff builds the arc — base through taper — around it.")
                .font(.body(14)).foregroundStyle(Theme.ink.opacity(0.82)).lineSpacing(3)
            Button { showRacesSheet = true } label: {
                Stamp("PICK A RACE \u{25B8}", tone: .race)
            }
            .buttonStyle(.plain)
            .padding(.top, 4)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, hPad)
        .padding(.vertical, 28)
    }

    private var planSkeleton: some View {
        VStack(alignment: .leading, spacing: 16) {
            RoundedRectangle(cornerRadius: 2)
                .fill(Theme.ink.opacity(0.06)).frame(height: 9)
            HStack(alignment: .bottom, spacing: 3) {
                ForEach(0..<12, id: \.self) { i in
                    RoundedRectangle(cornerRadius: 1.5)
                        .fill(Theme.ink.opacity(0.05))
                        .frame(height: CGFloat(20 + (i % 5) * 9))
                        .frame(maxWidth: .infinity)
                }
            }
            .frame(height: 64, alignment: .bottom)
        }
        .padding(.horizontal, hPad)
        .padding(.vertical, 20)
    }

    // ══════════════════════════════════════════════════════════════════
    // 7 · STAMP FOOTER
    // ══════════════════════════════════════════════════════════════════

    private var stampFooter: some View {
        HStack(spacing: 8) {
            Stamp("FAFF", tone: .mute)
            Stamp("PLAN", tone: .mute)
            Spacer()
            if let n = state?.weeks.count, n > 0 {
                Stamp("\(n) WK ARC", tone: .mute)
            }
            Stamp("v4", tone: .race)
        }
        .padding(.horizontal, hPad)
        .padding(.top, 22)
    }

    // ══════════════════════════════════════════════════════════════════
    // Load — UNCHANGED plumbing
    // ══════════════════════════════════════════════════════════════════

    private func load() async {
        loading = true
        defer { loading = false }
        async let sRes = (try? await API.fetchTrainingState())
        async let bRes = (try? await API.briefing(surface: "training"))
        let s = await sRes
        let b = await bRes
        self.state = s ?? nil
        self.briefing = b ?? nil
    }

    // ══════════════════════════════════════════════════════════════════
    // Helpers
    // ══════════════════════════════════════════════════════════════════

    /// `WK 4/12` — week_idx is 0-based on the wire, displayed as idx+1.
    private var weekText: String? {
        guard let s = state, let wk = s.weeks.first(where: { $0.isCurrent }), !s.weeks.isEmpty
        else { return nil }
        return "WK \(wk.idx + 1)/\(s.weeks.count)"
    }

    private func phaseTone(_ phase: String) -> FaffTone {
        switch phase.lowercased() {
        case "base":  return .green
        case "build": return .dist
        case "peak":  return .learn
        case "taper": return .amber
        case "race":  return .race
        default:      return .mute
        }
    }

    /// 0 = Sunday per the training-state loader convention.
    private func dowLabel(_ dow: Int) -> String {
        let labels = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
        return labels.indices.contains(dow) ? labels[dow] : "—"
    }

    private func trimMi(_ mi: Double) -> String {
        if mi <= 0 { return "0" }
        if mi.truncatingRemainder(dividingBy: 1) == 0 { return String(Int(mi)) }
        return String(format: "%.1f", mi)
    }

    private func monoSpec(_ size: CGFloat) -> Font {
        .system(size: size, weight: .semibold, design: .monospaced)
    }

    @ViewBuilder private func specDot() -> some View {
        Text("·").font(monoSpec(12)).foregroundStyle(Theme.dim)
    }
}
