//
//  TrainView.swift
//  v3 Train tab · scrubbable 26-week season arc.
//  BASE → BUILD → PEAK → TAPER → RACE. Bars live directly on the mesh
//  (no dark container · per locked design). The whole background lerps
//  between phase meshes as you scrub. FOCUS row is height-locked under
//  the phase headline. THIS WEEK panel binds to the scrubbed week.
//

import SwiftUI

struct TrainView: View {
    let onProfile: () -> Void

    @State private var state: TrainingState?
    @State private var focusedIndex: Int = 0

    /// Linear interpolation across phases for the mesh.
    private var currentMesh: FaffMesh {
        guard let state else { return FaffMesh.forView(.train) }
        return phaseMeshFor(weekIndex: focusedIndex, totalWeeks: state.weeks.count)
    }

    var body: some View {
        ZStack {
            FaffMeshView(mesh: currentMesh)

            VStack(spacing: 0) {
                header
                    .padding(.horizontal, 24).padding(.top, 12)
                focusBlock
                    .padding(.horizontal, 24).padding(.top, 22)

                if let s = state {
                    bars(for: s)
                        .padding(.top, 20)
                        .padding(.horizontal, 6)
                        .frame(height: 180)
                    detail(for: s)
                        .padding(.horizontal, 24)
                        .padding(.top, 14)
                } else {
                    Spacer()
                }

                Spacer(minLength: 0)
            }
            .padding(.bottom, 100)
        }
        .task { state = try? await API.fetchTrainingState() }
    }

    // MARK: - Header

    private var header: some View {
        HStack(alignment: .center) {
            SpecLabel(text: roadToText, size: 11, tracking: 2, color: Theme.txt)
            Spacer()
            Text(daysOutText)
                .font(.display(11, weight: .semibold))
                .foregroundStyle(Theme.txt.opacity(0.82))
            Button { onProfile() } label: {
                Text("DK")
                    .font(.display(11, weight: .bold))
                    .foregroundStyle(Theme.txt)
                    .frame(width: 28, height: 28)
                    .background(LinearGradient(colors: [Color(hex: 0xFF7A45), Color(hex: 0xD6263C)], startPoint: .topLeading, endPoint: .bottomTrailing), in: Circle())
            }
            .buttonStyle(.plain)
            .padding(.leading, 8)
        }
    }

    private var roadToText: String {
        if let race = state?.race?.name { return "ROAD TO \(race.uppercased())" }
        return "ROAD TO RACE"
    }

    private var daysOutText: String {
        if let s = state, let d = s.race?.days_to_race { return "\(d)d" }
        return ""
    }

    // MARK: - Focus block (phase headline + readout chip)

    private var focusBlock: some View {
        let (phaseLabel, phaseName, phaseSub) = phaseInfoForFocus()
        return VStack(alignment: .leading, spacing: 6) {
            SpecLabel(text: phaseLabel, size: 11, tracking: 2, color: Theme.txt.opacity(0.8))
            Text(phaseName)
                .displayRecipe(size: 62, weight: .bold)
                .foregroundStyle(Theme.txt)
                .shadow(color: .black.opacity(0.34), radius: 30, y: 3)
            Text(phaseSub)
                .font(.body(13.5, weight: .bold))
                .foregroundStyle(Theme.txt.opacity(0.9))
                .frame(height: 36, alignment: .topLeading)    // height-locked 2 lines
            HStack(spacing: 9) {
                Text(readoutChip)
                    .font(.display(12.5, weight: .bold))
                    .foregroundStyle(Theme.txt)
                if isViewingNow {
                    HStack(spacing: 5) {
                        Circle().fill(Color(hex: 0x7BE8A0)).frame(width: 6, height: 6)
                            .shadow(color: Color(hex: 0x7BE8A0), radius: 4)
                        Text("NOW")
                            .font(.label(10)).tracking(0.5).textCase(.uppercase)
                            .foregroundStyle(Color(hex: 0xAEF0C4))
                    }
                }
            }
            .padding(.horizontal, 13).padding(.vertical, 6)
            .background(Color.white.opacity(0.16), in: Capsule())
            .overlay(Capsule().stroke(Color.white.opacity(0.28)))
            .padding(.top, 8)
        }
    }

    private var readoutChip: String {
        guard let s = state else { return "" }
        if focusedIndex >= s.weeks.count - 1 { return "RACE WEEK" }
        let week = s.weeks[focusedIndex]
        let mi = Int(week.plannedMi)
        return "WK \(week.idx + 1) · \(mi) MI"
    }

    private var isViewingNow: Bool {
        (state?.currentWeekIdx ?? -1) == focusedIndex
    }

    // MARK: - Bars

    private func bars(for s: TrainingState) -> some View {
        let maxMi = max(1, s.weeks.map { $0.plannedMi }.max() ?? 1)
        return ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .bottom, spacing: 7) {
                    Spacer().frame(width: 160)
                    ForEach(s.weeks, id: \.idx) { wk in
                        let h = CGFloat(wk.plannedMi / maxMi) * 140
                        VStack(spacing: 6) {
                            if wk.idx == (s.currentWeekIdx ?? -1) {
                                Circle()
                                    .fill(Color.white)
                                    .frame(width: 7, height: 7)
                                    .shadow(color: .white.opacity(0.4), radius: 5)
                            } else { Color.clear.frame(height: 7) }
                            Rectangle()
                                .fill(barColor(for: wk.phase))
                                .frame(width: 18, height: max(10, h))
                                .clipShape(RoundedRectangle(cornerRadius: 3, style: .continuous))
                                .opacity(focusedIndex == wk.idx ? 1.0 : 0.78)
                                .scaleEffect(focusedIndex == wk.idx ? CGSize(width: 1.0, height: 1.06) : CGSize(width: 1, height: 1))
                            Text("\(wk.idx + 1)")
                                .font(.label(8.5)).tracking(0.5)
                                .foregroundStyle(Theme.txt.opacity(focusedIndex == wk.idx ? 1 : 0.45))
                        }
                        .id(wk.idx)
                        .onTapGesture {
                            withAnimation(Theme.Motion.mesh) { focusedIndex = wk.idx }
                        }
                    }
                    // Race finish marker
                    VStack(spacing: 6) {
                        Text("🏁").font(.system(size: 18))
                        Rectangle()
                            .fill(Color.white.opacity(0.85))
                            .frame(width: 3, height: 60)
                            .clipShape(RoundedRectangle(cornerRadius: 3, style: .continuous))
                        Text("FIN")
                            .font(.label(8.5)).tracking(0.5)
                            .foregroundStyle(Theme.txt.opacity(0.85))
                    }
                    .id(s.weeks.count)
                    Spacer().frame(width: 160)
                }
                .frame(maxHeight: .infinity, alignment: .bottom)
            }
            .onAppear {
                let i = s.currentWeekIdx ?? 0
                proxy.scrollTo(i, anchor: .center)
                focusedIndex = i
            }
        }
    }

    private func barColor(for phase: String) -> Color {
        switch phase.lowercased() {
        case "base":  return Color(hex: 0x3FAE9A)
        case "build": return Color(hex: 0xE0972C)
        case "peak":  return Color(hex: 0xE0432C)
        case "taper": return Color(hex: 0x3FAE6E)
        case "race":  return Color(hex: 0xE0432C)
        default:      return Color(hex: 0xE0972C)
        }
    }

    // MARK: - Detail

    private func detail(for s: TrainingState) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(focusText(s))
                .font(.body(13.5, weight: .bold))
                .foregroundStyle(Theme.txt.opacity(0.95))

            let wk = s.weeks[min(max(0, focusedIndex), s.weeks.count - 1)]
            HStack(spacing: 5) {
                ForEach(wk.days, id: \.date) { day in
                    let dayContent = VStack(spacing: 5) {
                        Text(["S","M","T","W","T","F","S"][day.dow % 7])
                            .font(.label(9)).tracking(0.4)
                            .foregroundStyle(Theme.txt.opacity(0.5))
                        if day.type.lowercased() == "rest" {
                            Capsule().fill(Color.white.opacity(0.4)).frame(width: 8, height: 2)
                        } else {
                            Circle().fill(FaffEffort.fromType(day.type).dot).frame(width: 7, height: 7)
                        }
                        Text(day.mi > 0 ? "\(Int(day.mi))" : "—")
                            .font(.display(12.5, weight: .bold))
                            .foregroundStyle(Theme.txt.opacity(0.95))
                        Text(day.type.prefix(3).capitalized)
                            .font(.label(8)).tracking(0.2)
                            .foregroundStyle(Theme.txt.opacity(0.62))
                    }
                    .frame(maxWidth: .infinity)
                    if let runId = day.activityId {
                        NavigationLink(value: FaffRoute.runDetail(id: runId)) {
                            dayContent
                        }
                        .buttonStyle(.plain)
                    } else if day.type.lowercased() != "rest" {
                        NavigationLink(value: FaffRoute.planned(workoutId: nil)) {
                            dayContent
                        }
                        .buttonStyle(.plain)
                    } else {
                        dayContent
                    }
                }
            }
            .padding(.top, 6)

            Rectangle().fill(Color.white.opacity(0.14)).frame(height: 1)

            HStack {
                Text("WEEK \(wk.idx + 1) OF \(s.weeks.count)")
                    .font(.label(10)).tracking(0.8)
                    .foregroundStyle(Theme.txt.opacity(0.78))
                Spacer()
                Text("\(Int(wk.plannedMi)) MI PLANNED")
                    .font(.label(10)).tracking(0.8)
                    .foregroundStyle(Theme.txt.opacity(0.78))
            }
        }
        .padding(15)
        .background(Color(hex: 0x100905).opacity(0.34), in: RoundedRectangle(cornerRadius: 22))
        .overlay(RoundedRectangle(cornerRadius: 22).stroke(Color.white.opacity(0.16)))
    }

    private func focusText(_ s: TrainingState) -> String {
        guard focusedIndex < s.weeks.count else { return "" }
        switch s.weeks[focusedIndex].phase.lowercased() {
        case "base":  return "Build the engine. Easy volume and durability before the hard work begins."
        case "build": return "Sharpen threshold and layer in marathon pace. Where the sub-goal is built."
        case "peak":  return "Top-end fitness and race rehearsal at your highest weekly load."
        case "taper": return "Cut the volume, keep the intensity, and roll into the start line fresh."
        default:      return "Same shape next week. The plan adapts."
        }
    }

    // MARK: - Phase info

    private func phaseInfoForFocus() -> (String, String, String) {
        guard let s = state, focusedIndex < s.weeks.count else { return ("PHASE", "TRAIN", "") }
        let wk = s.weeks[focusedIndex]
        let label = "PHASE · WEEK \(wk.idx + 1)"
        switch wk.phase.lowercased() {
        case "base":  return (label.replacingOccurrences(of: "PHASE", with: "PHASE 01"), "BASE", "Aerobic foundation")
        case "build": return (label.replacingOccurrences(of: "PHASE", with: "PHASE 02"), "BUILD", "Threshold + marathon-pace volume")
        case "peak":  return (label.replacingOccurrences(of: "PHASE", with: "PHASE 03"), "PEAK", "Max volume & race simulation")
        case "taper": return (label.replacingOccurrences(of: "PHASE", with: "PHASE 04"), "TAPER", "Freshen, sharpen, arrive primed")
        default:      return (label, "RACE", "Everything you built, on the line")
        }
    }

    private func phaseMeshFor(weekIndex: Int, totalWeeks: Int) -> FaffMesh {
        // 5 phase anchors across the season; lerp between them.
        let anchors: [(Double, TrainPhase)] = [
            (Double(totalWeeks) * 0.10, .base),
            (Double(totalWeeks) * 0.35, .build),
            (Double(totalWeeks) * 0.65, .peak),
            (Double(totalWeeks) * 0.88, .taper),
            (Double(totalWeeks),         .race)
        ]
        let x = Double(weekIndex)
        for i in 0..<(anchors.count - 1) {
            let (xa, pa) = anchors[i]; let (xb, pb) = anchors[i + 1]
            if x >= xa && x < xb {
                let t = (x - xa) / max(0.0001, xb - xa)
                return FaffMesh.forPhase(pa).lerp(to: FaffMesh.forPhase(pb), t: t)
            }
        }
        return FaffMesh.forPhase(anchors.last!.1)
    }
}
