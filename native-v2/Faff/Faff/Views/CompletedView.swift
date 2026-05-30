//
//  CompletedView.swift
//  Post-run state · the after-twin of Planned. Mesh wears the actual effort.
//  Sheet drags up to reveal splits / zones / route / coach.
//

import SwiftUI

struct CompletedView: View {
    let runId: String

    @State private var run: RunDetail?
    @State private var sheetProgress: Double = 1   // 1 = collapsed
    @State private var selectedDayID: String = ""

    var body: some View {
        let eff = effort
        let mesh = eff.mesh
        ZStack {
            FaffMeshView(mesh: mesh)
                .animation(Theme.Motion.mesh, value: mesh)

            heroLayer
                .opacity(max(0.05, 1.0 - (1 - sheetProgress) * 1.1))
                .offset(y: -22 * (1 - sheetProgress))

            DragSheet(
                collapsedFromTop: 452,
                progress: $sheetProgress,
                header: { peekHeader },
                content: { sheetContent }
            )

            VStack {
                Spacer()
                StickyCTABar(bgColor: Color(hex: 0xFAF7F1)) {
                    FaffPrimaryButton(title: "Share Run", accentDot: nil) {}
                }
                .frame(height: 130)
            }
            .ignoresSafeArea(edges: .bottom)
            .opacity(1 - sheetProgress)
        }
        .task { await load() }
    }

    // MARK: - Hero layer (under the sheet)

    private var heroLayer: some View {
        VStack(alignment: .leading, spacing: 0) {
            topBar
                .padding(.horizontal, 24)
                .padding(.top, 8)

            weekStripBlock
                .padding(.horizontal, 22)
                .padding(.top, 12)

            heroInner
                .padding(.horizontal, 26)
                .padding(.top, 24)

            Spacer(minLength: 0)
        }
    }

    private var topBar: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 9) {
                    Text(dayLabel)
                        .font(.body(21, weight: .extraBold))
                        .tracking(-0.4)
                        .foregroundStyle(Theme.txt)
                    Pill(text: "DONE", color: Color(hex: 0x3FAE6E), textColor: .white, size: 9, tracking: 1, icon: "checkmark")
                }
                Text(timeWeatherLine)
                    .font(.body(11, weight: .bold))
                    .foregroundStyle(Theme.txt.opacity(0.72))
            }
            Spacer()
            ReadinessRing(score: 82, size: 54, color: Color(hex: 0x62E08A))
        }
    }

    private var weekStripBlock: some View {
        WeekStrip(days: stripDays, selectedID: $selectedDayID)
    }

    private var heroInner: some View {
        VStack(alignment: .leading, spacing: 0) {
            SpecLabel(text: "Threshold Session", size: 12, tracking: 1.5, color: Theme.txt.opacity(0.82))
            Text(workoutName)
                .displayRecipe(size: 54, weight: .bold)
                .foregroundStyle(Theme.txt)
                .lineSpacing(-12)
                .shadow(color: .black.opacity(0.32), radius: 30, y: 2)
                .padding(.top, 7)

            HStack(spacing: 7) {
                Circle().fill(Color(hex: 0x3FAE6E)).frame(width: 16, height: 16)
                    .overlay(Image(systemName: "checkmark").font(.system(size: 9, weight: .bold)).foregroundStyle(.white))
                Text(winLine)
                    .font(.body(13, weight: .extraBold))
                    .foregroundStyle(Color(hex: 0xC4F5D6))
            }
            .padding(.top, 12)

            HStack(spacing: 22) {
                keyStat("Distance", "\(distanceFmt)", "mi")
                keyStat("Time", timeFmt, nil)
                keyStat("Avg Pace", paceFmt, "/mi")
            }
            .padding(.top, 18)

            EffortMeter(position: 0.76, label: "HARD")
                .frame(maxWidth: 236)
                .padding(.top, 26)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func keyStat(_ k: String, _ v: String, _ unit: String?) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            SpecLabel(text: k, size: 10, tracking: 1, color: Theme.txt.opacity(0.72))
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(v).font(.display(21, weight: .extraBold)).tracking(-0.5).foregroundStyle(Theme.txt)
                if let u = unit { Text(u).font(.body(11, weight: .semibold)).foregroundStyle(Theme.txt.opacity(0.8)) }
            }
        }
    }

    // MARK: - Drag-sheet header + content

    private var peekHeader: some View {
        HStack {
            Text(workoutName)
                .font(.body(18, weight: .extraBold))
                .tracking(-0.3)
                .foregroundStyle(Color(hex: 0x211D18))
            Spacer()
            Text("\(timeFmt) · \(paceFmt)/mi")
                .font(.display(12, weight: .bold))
                .foregroundStyle(Color(hex: 0x9A9286))
        }
    }

    private var sheetContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            milesBlock
            zonesBlock
            routeBlock
            infoGridBlock
            coachBlock
        }
        .foregroundStyle(Color(hex: 0x3C362F))
    }

    private var milesBlock: some View {
        sheetSection(title: "Mile Splits", right: "fastest 6:32") {
            MileBarsLight()
                .frame(height: 92)
            Text("Tempo block 6:34 avg vs 6:38 target · negative split ✓")
                .font(.display(11, weight: .bold))
                .foregroundStyle(Color(hex: 0x736C61))
                .padding(.top, 12)
        }
    }

    private var zonesBlock: some View {
        sheetSection(title: "Time in Zones", right: "avg ♥ 156 · peak 174") {
            ZoneBar(zones: zonePcts, height: 14, legend: true)
        }
    }

    private var routeBlock: some View {
        sheetSection(title: "Route", right: "Reseda loop") {
            ZStack(alignment: .bottomLeading) {
                Color(hex: 0xEEF0EA)
                Path { p in
                    let pts: [CGPoint] = [
                        .init(x: 18, y: 86), .init(x: 52, y: 40), .init(x: 98, y: 66),
                        .init(x: 140, y: 30), .init(x: 196, y: 52), .init(x: 244, y: 26),
                        .init(x: 292, y: 70), .init(x: 342, y: 40)
                    ]
                    p.move(to: pts[0])
                    for pt in pts.dropFirst() { p.addLine(to: pt) }
                }
                .stroke(Color(hex: 0xEE6038), style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
                .frame(height: 120)

                HStack {
                    Text("8.02 MI").font(.display(9, weight: .bold)).foregroundStyle(Color(hex: 0x5C574E))
                    Spacer()
                    Text("↗ 312 FT").font(.display(9, weight: .bold)).foregroundStyle(Color(hex: 0x5C574E))
                    Spacer()
                    Text("34.20°N").font(.display(9, weight: .bold)).foregroundStyle(Color(hex: 0x5C574E))
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 9)
            }
            .frame(height: 120)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Color(hex: 0xE4DED2), lineWidth: 1))
        }
    }

    private var infoGridBlock: some View {
        sheetSection(title: "Conditions & Kit", right: nil) {
            let cells: [(String, String)] = [
                ("Weather", "\(weatherTemp)° · Clear"),
                ("Shoe", shoeName),
                ("Fuel", "PF 30 ✓ mi 5"),
                ("Calories", "742 kcal")
            ]
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 1), GridItem(.flexible(), spacing: 1)], spacing: 1) {
                ForEach(0..<cells.count, id: \.self) { i in
                    let c = cells[i]
                    VStack(alignment: .leading, spacing: 4) {
                        SpecLabel(text: c.0, size: 10, tracking: 1, color: Color(hex: 0xA39A8C))
                        Text(c.1).font(.body(15, weight: .bold)).foregroundStyle(Color(hex: 0x211D18))
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.white)
                }
            }
            .background(Color(hex: 0xEEE7DA))
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }

    private var coachBlock: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Faff Coach")
                .font(.label(10)).tracking(1.5).textCase(.uppercase)
                .foregroundStyle(Color(hex: 0xEE6038))
            Text("Dialed in. You held 6:34 across the tempo block — 4 seconds under target — and miles 5 and 6 were your quickest, so you finished into it rather than fading. HR settled right in Z4 with no spikes. Textbook threshold execution; this is exactly the fitness CIM needs.")
                .font(.body(14.5, weight: .medium))
                .foregroundStyle(Color(hex: 0x3C362F))
                .lineSpacing(3)
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 18)
    }

    private func sheetSection<C: View>(title: String, right: String?, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text(title.uppercased())
                    .font(.label(11)).tracking(1.5)
                    .foregroundStyle(Color(hex: 0xA39A8C))
                Spacer()
                if let r = right {
                    Text(r.uppercased())
                        .font(.label(11)).tracking(0.3)
                        .foregroundStyle(Color(hex: 0x736C61))
                }
            }
            content()
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 18)
        .background(
            Rectangle().fill(Color.clear).overlay(Rectangle().fill(Color(hex: 0xEEE7DA)).frame(height: 1), alignment: .bottom)
        )
    }

    // MARK: - Data

    private var effort: FaffEffort {
        FaffEffort.fromType(run?.type ?? "tempo")
    }

    private var workoutName: String {
        if let n = run?.name { return n }
        return "Tempo\nRun"
    }

    private var dayLabel: String {
        "Wednesday 28"
    }

    private var timeWeatherLine: String {
        if let t = run?.start_local, let temp = run?.temp_f {
            return "Ran \(t) · \(Int(temp))° clear"
        }
        return "Ran 6:12 AM · 64° clear"
    }

    private var winLine: String {
        "Held 6:34 — 4s under target"
    }

    private var distanceFmt: String {
        if let d = run?.distance_mi { return String(format: "%.2f", d) }
        return "8.02"
    }

    private var timeFmt: String {
        run?.time_moving ?? "1:00:46"
    }

    private var paceFmt: String {
        run?.pace ?? "7:34"
    }

    private var weatherTemp: Int {
        if let t = run?.temp_f { return Int(t) }
        return 64
    }

    private var shoeName: String {
        run?.shoes?.first?.displayName ?? "Zoom Fly 6"
    }

    private var zonePcts: [ZonePct] {
        if let z = run?.hrZonePcts {
            let total = z.z1 + z.z2 + z.z3 + z.z4 + z.z5
            guard total > 0 else { return defaultZones }
            return [
                ZonePct(zone: 1, pct: z.z1 / total, timeLabel: "\(Int(round(z.z1 / total * 60)))m"),
                ZonePct(zone: 2, pct: z.z2 / total, timeLabel: "\(Int(round(z.z2 / total * 60)))m"),
                ZonePct(zone: 3, pct: z.z3 / total, timeLabel: "\(Int(round(z.z3 / total * 60)))m"),
                ZonePct(zone: 4, pct: z.z4 / total, timeLabel: "\(Int(round(z.z4 / total * 60)))m"),
                ZonePct(zone: 5, pct: z.z5 / total, timeLabel: "\(Int(round(z.z5 / total * 60)))m")
            ]
        }
        return defaultZones
    }

    private var defaultZones: [ZonePct] {
        [
            ZonePct(zone: 1, pct: 0.06, timeLabel: "4m"),
            ZonePct(zone: 2, pct: 0.34, timeLabel: "21m"),
            ZonePct(zone: 3, pct: 0.22, timeLabel: "13m"),
            ZonePct(zone: 4, pct: 0.36, timeLabel: "22m"),
            ZonePct(zone: 5, pct: 0.02, timeLabel: "1m")
        ]
    }

    private var stripDays: [WeekStripDay] {
        [
            WeekStripDay(id: "2026-05-26", dow: "M", date: 26, effort: .easy, isToday: false, isDone: true),
            WeekStripDay(id: "2026-05-27", dow: "T", date: 27, effort: .intervals, isToday: false, isDone: true),
            WeekStripDay(id: "2026-05-28", dow: "W", date: 28, effort: .tempo, isToday: true, isDone: true),
            WeekStripDay(id: "2026-05-29", dow: "T", date: 29, effort: .recovery),
            WeekStripDay(id: "2026-05-30", dow: "F", date: 30, effort: .rest),
            WeekStripDay(id: "2026-05-31", dow: "S", date: 31, effort: .long),
            WeekStripDay(id: "2026-06-01", dow: "S", date: 1, effort: .recovery)
        ]
    }

    private func load() async {
        if let r = try? await API.fetchRunDetail(id: runId) {
            await MainActor.run {
                run = r
                if selectedDayID.isEmpty { selectedDayID = "2026-05-28" }
            }
        } else if selectedDayID.isEmpty {
            await MainActor.run { selectedDayID = "2026-05-28" }
        }
    }
}

// Light-theme mile bars matching the sheet's #FAF7F1 surface.
private struct MileBarsLight: View {
    private let bars: [(mi: Int, h: CGFloat, work: Bool)] = [
        (1, 0.16, false), (2, 0.22, false), (3, 0.96, true),
        (4, 0.99, true), (5, 1.0, true), (6, 0.98, true),
        (7, 0.15, false), (8, 0.14, false)
    ]
    var body: some View {
        GeometryReader { geo in
            HStack(alignment: .bottom, spacing: 5) {
                ForEach(0..<bars.count, id: \.self) { i in
                    let b = bars[i]
                    VStack(spacing: 6) {
                        Rectangle()
                            .fill(b.work ? Color(hex: 0xEE6038) : Color(hex: 0xD8D0C2))
                            .frame(height: max(8, geo.size.height * b.h - 14))
                            .clipShape(UnevenRoundedRectangle(topLeadingRadius: 5, bottomLeadingRadius: 2, bottomTrailingRadius: 2, topTrailingRadius: 5))
                        Text("\(b.mi)").font(.display(9, weight: .bold)).foregroundStyle(Color(hex: 0xA39A8C))
                    }
                    .frame(maxWidth: .infinity)
                }
            }
        }
    }
}
