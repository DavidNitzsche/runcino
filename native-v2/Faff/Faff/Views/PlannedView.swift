//
//  PlannedView.swift
//  Planned workout detail · the before-twin of Run Detail.
//  Mesh wears the effort temperature for the planned workout type.
//

import SwiftUI

struct PlannedView: View {
    let workoutId: String?

    @State private var workout: WatchWorkout? =
        AppCache.read(.todayWorkout, as: TodayWorkoutWrapper.self)?.workout

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let mesh = effort.mesh
        ZStack {
            FaffMeshView(mesh: mesh)
                .animation(Theme.Motion.mesh, value: mesh)

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    header
                        .padding(.horizontal, 22)
                        .padding(.top, 8)

                    hero
                        .padding(.horizontal, 24)
                        .padding(.top, 18)

                    section("CONDITIONS · RECALIBRATED") {
                        heatCard
                    }
                    .padding(.top, 24)

                    section("THE SHAPE") {
                        shapeBar
                    }
                    .padding(.top, 24)

                    section("THE SESSION") {
                        sessionList
                    }
                    .padding(.top, 24)

                    section("WHY THIS, TODAY") {
                        CoachNote(
                            body: coachBody,
                            tag: "Coach",
                            accent: Theme.Accent.mintReady,
                            style: .note
                        )
                        .padding(.horizontal, -24)
                    }
                    .padding(.top, 12)

                    section("FUEL & HYDRATION") {
                        fuelTile
                    }
                    .padding(.top, 6)

                    section("EXECUTE") {
                        executeBullets
                    }
                    .padding(.top, 24)

                    Spacer(minLength: 140)
                }
            }

            VStack {
                Spacer()
                StickyCTABar(bgColor: mesh.base) {
                    FaffPrimaryButton(
                        title: "Start \(workoutTitle)",
                        accentDot: effort.dot
                    ) { /* push WatchMirror */ }
                }
                .frame(height: 130)
            }
            .ignoresSafeArea(edges: .bottom)
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
            SpecLabel(text: eyebrowText, size: 11, tracking: 2.5, color: Theme.txt.opacity(0.7))
            Text(workoutTitle)
                .displayRecipe(size: 44, weight: .bold)
                .foregroundStyle(Theme.txt)
                .shadow(color: .black.opacity(0.3), radius: 22, y: 2)
                .padding(.top, 9)

            HStack(alignment: .top, spacing: 24) {
                heroStat(value: distanceValue, key: "MILES")
                heroStat(value: estTimeValue, key: "EST TIME")
                heroStat(value: paceValue, key: "TARGET /MI")
            }
            .padding(.top, 18)

            Pill(text: pillText, color: Color.white.opacity(0.16), textColor: Theme.txt, size: 10, tracking: 1)
                .overlay(Capsule().stroke(Color.white.opacity(0.3), lineWidth: 1))
                .padding(.top, 15)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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

    private var heatCard: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 9) {
                Image(systemName: "sun.max.fill")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(Color(hex: 0xFF8C5A))
                Text("Hot at run time")
                    .font(.body(14, weight: .extraBold))
                    .foregroundStyle(Theme.txt)
                Spacer()
                Text("84°F")
                    .font(.display(16, weight: .bold))
                    .foregroundStyle(Theme.txt)
            }
            Text("Faff eased your targets +8s/mi for the heat — run threshold by effort, not the number. Expect HR to read ~6 bpm high; that's the weather, not lost fitness. Hydrate before you start.")
                .font(.body(13, weight: .medium))
                .foregroundStyle(Theme.txt.opacity(0.92))
                .fixedSize(horizontal: false, vertical: true)
                .lineSpacing(2)
        }
        .padding(15)
        .background(
            LinearGradient(colors: [Color(hex: 0xFF5A28).opacity(0.22), Color(hex: 0xD6261C).opacity(0.16)],
                           startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: 18, style: .continuous)
        )
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous)
            .stroke(Color(hex: 0xFF8C5A).opacity(0.4), lineWidth: 1))
    }

    private var shapeBar: some View {
        let segs = shapeSegments
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .bottom, spacing: 3) {
                ForEach(segs) { s in
                    VStack {
                        Spacer(minLength: 0)
                        Text(s.tag)
                            .font(.display(8, weight: .bold))
                            .foregroundStyle(Color.black.opacity(0.55))
                            .padding(.bottom, 5)
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 54 * s.heightFrac)
                    .background(s.color, in: UnevenRoundedRectangle(topLeadingRadius: 6, topTrailingRadius: 6))
                    .frame(maxWidth: .infinity)
                    .layoutPriority(s.flex)
                }
            }
            .frame(height: 54)

            HStack {
                ForEach(segs) { s in
                    Text(s.subLabel)
                        .font(.display(9, weight: .bold))
                        .foregroundStyle(Theme.txt.opacity(0.55))
                        .frame(maxWidth: .infinity, alignment: s == segs.first ? .leading : (s == segs.last ? .trailing : .center))
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
                            .font(.display(11, weight: .bold))
                            .foregroundStyle(Theme.txt.opacity(0.62))
                            .lineSpacing(2)
                    }
                    Spacer(minLength: 0)
                }
                .padding(.vertical, 11)
            }
        }
    }

    private var fuelTile: some View {
        GlassTile(padding: 6) {
            VStack(spacing: 0) {
                fuelRow("Before", "16 oz water + electrolytes")
                fuelRow("Carry", "SkyFlask · PF 60 mix")
                fuelRow("During", "PF 30 gel @ mi 5")
                fuelRow("Heat add", "+1 electrolyte tab")
            }
        }
    }

    private func fuelRow(_ k: String, _ v: String) -> some View {
        HStack {
            Text(k).font(.body(13, weight: .semibold)).foregroundStyle(Theme.txt.opacity(0.66))
            Spacer()
            Text(v).font(.display(12, weight: .bold)).foregroundStyle(Theme.txt)
        }
        .padding(.vertical, 11)
        .padding(.horizontal, 10)
    }

    private var executeBullets: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(executeCues, id: \.self) { cue in
                HStack(alignment: .top, spacing: 10) {
                    Text("•").font(.body(14)).foregroundStyle(Theme.txt.opacity(0.7))
                    Text(cue)
                        .font(.body(14, weight: .semibold))
                        .foregroundStyle(Theme.txt.opacity(0.9))
                        .lineSpacing(2)
                }
                .padding(.vertical, 4)
            }
        }
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
        workout?.name ?? "Tempo Run"
    }

    private var eyebrowText: String {
        "WED, MAY 28 · TODAY · \(effort.title.uppercased())"
    }

    private var distanceValue: String {
        if let d = workout?.distanceMi { return String(format: "%.1f", d) }
        return "8.0"
    }

    private var estTimeValue: String {
        if let m = workout?.totalEstimatedMinutes { return "~\(m)" }
        return "~54"
    }

    private var paceValue: String {
        if let phases = workout?.phases,
           let work = phases.first(where: { $0.type == .work && $0.targetPaceSPerMi != nil }),
           let p = work.targetPaceSPerMi {
            return PaceFormat.mmss(p)
        }
        return "6:38"
    }

    private var pillText: String {
        "PLANNED · WEEK 14 BUILD"
    }

    private var coachBody: String {
        "This is your weekly threshold stimulus — it lifts the pace you can hold before lactate piles up. Hold the line at effort and it feeds straight into CIM's 6:51 goal pace. Don't bank time early; the back half is the test."
    }

    private var executeCues: [String] {
        [
            "Settle the first threshold mile — don't sprint into it.",
            "If HR spikes past Z4 in the heat, hold effort and let pace drift.",
            "Finish the last mile the strongest, not the fastest."
        ]
    }

    private var shapeSegments: [ShapeSeg] {
        if let phases = workout?.phases, !phases.isEmpty {
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
        return [
            ShapeSeg(id: 0, tag: "WU", heightFrac: 0.46, color: Color(hex: 0x34C194), subLabel: "2 mi easy", flex: 2),
            ShapeSeg(id: 1, tag: "THRESHOLD", heightFrac: 1.0, color: Color(hex: 0xEF6038), subLabel: "4 mi @ threshold", flex: 4),
            ShapeSeg(id: 2, tag: "CD", heightFrac: 0.42, color: Color(hex: 0x22B8C4), subLabel: "2 mi easy", flex: 2)
        ]
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
        if let d = p.distanceMi { return "\(String(format: "%.1f", d)) mi" }
        return "\(p.durationSec / 60) min"
    }

    private func colorFor(_ t: WatchPhaseType) -> Color {
        switch t {
        case .warmup:   return Color(hex: 0x34C194)
        case .cooldown: return Color(hex: 0x22B8C4)
        case .work:     return effort.dot
        case .recovery: return Color(hex: 0x22B8C4)
        }
    }

    private var sessionRows: [SessionRow] {
        if let phases = workout?.phases, !phases.isEmpty {
            return phases.enumerated().map { (i, p) in
                let title = "\(p.label) · \(subLabelFor(p))"
                let detail: String = {
                    if let tp = p.targetPaceSPerMi { return "@ \(PaceFormat.mmss(tp))/mi · target pace" }
                    return "fully easy — let HR settle"
                }()
                return SessionRow(id: i, title: title, subtitle: detail, color: colorFor(p.type))
            }
        }
        return [
            SessionRow(id: 0, title: "Warm up · 2 mi", subtitle: "@ 8:30/mi · build into it, drills + 2 strides before the block", color: Color(hex: 0x34C194)),
            SessionRow(id: 1, title: "Threshold · 4 mi", subtitle: "@ 6:38/mi · eased to ~6:46 today (heat) · comfortably hard, HR Z4", color: Color(hex: 0xEF6038)),
            SessionRow(id: 2, title: "Cool down · 2 mi", subtitle: "@ 8:45/mi · fully easy, let HR fall", color: Color(hex: 0x22B8C4))
        ]
    }

    private func load() async {
        if workout == nil, let w = try? await API.fetchWatchWorkout() {
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
