//
//  RunDetailView.swift
//  Post-run detail · one run, one home. Mesh wears the effort.
//  Splits lead, then the scrubbable trace, then route. Reached from
//  Activity and the post-run Today.
//

import SwiftUI

struct RunDetailView: View {
    let runId: String

    @State private var run: RunDetail?
    @State private var splitReadout: String?
    @State private var traceReadout: String?
    @State private var currentMetric: TraceMetric = .pace

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let eff = effort
        let mesh = eff.mesh
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

                    section(title: "MILE SPLITS", right: "FASTEST 6:33 · MI 4") {
                        VStack(alignment: .leading, spacing: 8) {
                            MileBars(bars: splitBars, target: 398, readout: $splitReadout)
                                .frame(height: 150)
                            Text(splitReadout ?? "Tap a mile · tempo block held 6:35 avg through miles 3–7")
                                .font(.display(11, weight: .bold))
                                .foregroundStyle(Theme.txt.opacity(0.72))
                                .padding(.top, 4)
                        }
                    }
                    .padding(.top, 26)

                    section(title: "TRACE", right: traceAvgLabel) {
                        VStack(alignment: .leading, spacing: 12) {
                            chipsRow
                            ScrubbableTrace(
                                points: currentMetric.points,
                                labels: currentMetric.labels,
                                color: currentMetric.color,
                                fill: true,
                                target: nil,
                                band: nil,
                                readout: $traceReadout
                            )
                            .frame(height: 120)
                            Text(traceReadout ?? "drag the trace to read any point")
                                .font(.display(11, weight: .bold))
                                .foregroundStyle(Theme.txt.opacity(0.72))
                        }
                    }
                    .padding(.top, 26)

                    section(title: "ROUTE", right: "8.0 MI · +240 FT") {
                        routePanel
                    }
                    .padding(.top, 26)

                    section(title: "TIME IN ZONE", right: "54 MIN") {
                        ZoneBar(zones: zonePcts, height: 14, legend: true)
                    }
                    .padding(.top, 26)

                    section(title: "VS PLAN", right: nil) {
                        HStack(alignment: .top, spacing: 13) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text("1.5 wu · 5.0 @ 6:38 · 1.5 cd")
                                    .font(.body(14, weight: .bold))
                                    .foregroundStyle(Theme.txt)
                                Text("tempo block ran 6:35 avg · 3s under target")
                                    .font(.display(11, weight: .bold))
                                    .foregroundStyle(Theme.txt.opacity(0.6))
                            }
                            Spacer()
                            Pill(text: "NAILED IT", color: Color(hex: 0x9AF0BF), textColor: Color(hex: 0x007722), size: 10, tracking: 0.5)
                        }
                    }
                    .padding(.top, 26)

                    section(title: "COACH", right: nil) {
                        CoachNote(
                            message: "Clean execution. You held the tempo block 3s under target with HR steady in Z4. Cadence touched 170 mid-run. Nothing to fix, bank it.",
                            tag: "Faff",
                            accent: Theme.Accent.mintReady,
                            style: .note
                        )
                        .padding(.horizontal, -24)
                    }
                    .padding(.top, 12)

                    section(title: "DETAILS", right: nil) {
                        detailsTile
                    }
                    .padding(.top, 12)

                    Spacer(minLength: 60)
                }
            }
        }
        .task { await load() }
    }

    private var header: some View {
        HStack(spacing: 12) {
            BackChip { dismiss() }
            SpecLabel(text: "RUN DETAIL", size: 13, tracking: 2.5, color: Theme.txt)
            Spacer()
        }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 0) {
            SpecLabel(text: eyebrowText, size: 11, tracking: 2.5, color: Theme.txt.opacity(0.7))
            Text(workoutName)
                .displayRecipe(size: 46, weight: .bold)
                .foregroundStyle(Theme.txt)
                .shadow(color: .black.opacity(0.3), radius: 22, y: 2)
                .padding(.top, 9)

            HStack(alignment: .top, spacing: 24) {
                heroStat(value: distanceValue, key: "MILES")
                heroStat(value: timeValue, key: "TIME")
                heroStat(value: paceValue, key: "AVG /MI")
            }
            .padding(.top, 20)

            HStack(spacing: 6) {
                Image(systemName: "checkmark")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Color(hex: 0x9AF0BF))
                Text("COMPLETED · FELT STRONG")
                    .font(.label(10)).tracking(1)
                    .foregroundStyle(Color(hex: 0x9AF0BF))
            }
            .padding(.horizontal, 10).padding(.vertical, 4)
            .background(Color(hex: 0x9AF0BF).opacity(0.2), in: Capsule())
            .overlay(Capsule().stroke(Color(hex: 0x9AF0BF).opacity(0.4), lineWidth: 1))
            .padding(.top, 16)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func heroStat(value: String, key: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(value)
                .font(.display(26, weight: .bold))
                .tracking(-1)
                .foregroundStyle(Theme.txt)
            SpecLabel(text: key, size: 9, tracking: 1.5, color: Theme.txt.opacity(0.6))
        }
    }

    private var chipsRow: some View {
        HStack(spacing: 7) {
            ForEach(TraceMetric.allCases, id: \.self) { m in
                let on = currentMetric == m
                Button {
                    withAnimation(Theme.Motion.smooth) {
                        currentMetric = m
                        traceReadout = nil
                    }
                } label: {
                    Text(m.label)
                        .font(.display(10, weight: .bold))
                        .tracking(0.5)
                        .foregroundStyle(on ? Color(hex: 0x5A1606) : Theme.txt)
                        .padding(.horizontal, 12).padding(.vertical, 6)
                        .background(on ? Color.white.opacity(0.92) : Color.white.opacity(0.1), in: Capsule())
                        .overlay(Capsule().stroke(Color.white.opacity(on ? 0 : 0.18), lineWidth: 1))
                        .opacity(on ? 1 : 0.6)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var routePanel: some View {
        ZStack {
            RadialGradient(
                colors: [Color.black.opacity(0.34), Color.black.opacity(0)],
                center: .center, startRadius: 0, endRadius: 200
            )
            Path { p in
                p.move(to: .init(x: 52, y: 92))
                p.addCurve(to: .init(x: 110, y: 44), control1: .init(x: 40, y: 60), control2: .init(x: 70, y: 40))
                p.addCurve(to: .init(x: 192, y: 86), control1: .init(x: 150, y: 48), control2: .init(x: 150, y: 84))
                p.addCurve(to: .init(x: 292, y: 50), control1: .init(x: 236, y: 88), control2: .init(x: 250, y: 56))
                p.addCurve(to: .init(x: 286, y: 86), control1: .init(x: 320, y: 46), control2: .init(x: 318, y: 78))
            }
            .stroke(
                LinearGradient(colors: [Color(hex: 0xFFCE8A), Color(hex: 0xFF5A3C)], startPoint: .topLeading, endPoint: .bottomTrailing),
                style: StrokeStyle(lineWidth: 3.4, lineCap: .round)
            )

            // Start/finish marker
            VStack {
                Spacer()
                HStack {
                    HStack(spacing: 8) {
                        Circle().fill(Color(hex: 0x9AF0BF)).frame(width: 10, height: 10)
                        Text("START / FINISH")
                            .font(.display(8.5, weight: .bold))
                            .foregroundStyle(Color(hex: 0x9AF0BF))
                    }
                    Spacer()
                }
                .padding(.bottom, 12).padding(.leading, 50)
            }
        }
        .frame(height: 120)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var detailsTile: some View {
        GlassTile(padding: 6) {
            VStack(spacing: 0) {
                detailRow("Shoes", "\(shoeShort) · +8 → 276 mi", chev: true)
                detailRow("Avg / Max HR", "\(hrAvg) / \(hrMax) bpm", chev: false)
                detailRow("Avg cadence", "\(cadAvg) spm", chev: false)
                detailRow("Weather", "\(weatherTemp)°F · clear", chev: false, good: true)
            }
        }
    }

    private func detailRow(_ k: String, _ v: String, chev: Bool, good: Bool = false) -> some View {
        HStack {
            Text(k).font(.body(13, weight: .semibold)).foregroundStyle(Theme.txt.opacity(0.66))
            Spacer()
            HStack(spacing: 7) {
                Text(v)
                    .font(.display(13, weight: .bold))
                    .foregroundStyle(good ? Color(hex: 0x9AF0BF) : Theme.txt)
                if chev {
                    Image(systemName: "chevron.down")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(Theme.txt.opacity(0.6))
                }
            }
        }
        .padding(.vertical, 11)
        .padding(.horizontal, 10)
    }

    private func section<C: View>(title: String, right: String?, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                SpecLabel(text: title, size: 11, tracking: 2, color: Theme.txt.opacity(0.6))
                Spacer()
                if let r = right {
                    Text(r).font(.display(11, weight: .bold)).foregroundStyle(Theme.txt.opacity(0.85))
                }
            }
            content()
        }
        .padding(.horizontal, 22)
    }

    // MARK: - Data

    private var effort: FaffEffort { FaffEffort.fromType(run?.type ?? "tempo") }

    private var eyebrowText: String { "WED, MAY 27 · 6:48 AM · TEMPO" }
    private var workoutName: String { run?.name ?? "Tempo Run" }

    private var distanceValue: String {
        if let d = run?.distance_mi { return String(format: "%.1f", d) }
        return "8.0"
    }
    private var timeValue: String { run?.time_moving ?? "54:16" }
    private var paceValue: String { run?.pace ?? "6:47" }
    private var hrAvg: String { run?.hr_avg.map(String.init) ?? "158" }
    private var hrMax: String { run?.hr_max.map(String.init) ?? "172" }
    private var cadAvg: String { run?.cadence_avg.map(String.init) ?? "167" }
    private var weatherTemp: String { run?.temp_f.map { String(Int($0)) } ?? "54" }
    private var shoeShort: String {
        if let n = run?.shoes?.first?.displayName {
            return n.replacingOccurrences(of: "ASICS ", with: "").replacingOccurrences(of: "Nike ", with: "")
        }
        return "Zoom Fly 6"
    }

    private var splitBars: [MileBar] {
        if let splits = run?.splits, !splits.isEmpty {
            return splits.map { s in
                let secs = paceToSeconds(s.pace) ?? 400
                let color = colorForSplit(secs: secs)
                return MileBar(
                    id: s.mile,
                    value: Double(800 - secs),  // invert so faster = taller
                    label: s.pace ?? "-",
                    subLabel: s.hr.map { "\($0) bpm" },
                    color: color,
                    isHighlight: secs < 410
                )
            }
        }
        return defaultSplits
    }

    private var defaultSplits: [MileBar] {
        let raw: [(Int, Int, Int, Color, Bool)] = [
            (1, 438, 146, Color(hex: 0xFFB45A), false),
            (2, 418, 147, Color(hex: 0xF97B3F), false),
            (3, 396, 160, Color(hex: 0xDB3620), true),
            (4, 393, 161, Color(hex: 0xD62D1C), true),
            (5, 395, 162, Color(hex: 0xD9331E), true),
            (6, 394, 163, Color(hex: 0xD7301D), true),
            (7, 397, 164, Color(hex: 0xDC3921), true),
            (8, 425, 153, Color(hex: 0xFF9148), false)
        ]
        return raw.map { (mi, secs, hr, col, hi) in
            MileBar(
                id: mi,
                value: Double(800 - secs),
                label: PaceFormat.mmss(secs),
                subLabel: "\(hr) bpm",
                color: col,
                isHighlight: hi
            )
        }
    }

    private func colorForSplit(secs: Int) -> Color {
        switch secs {
        case ..<395: return Color(hex: 0xD62D1C)
        case 395..<410: return Color(hex: 0xDB3620)
        case 410..<420: return Color(hex: 0xF97B3F)
        default: return Color(hex: 0xFFB45A)
        }
    }

    private func paceToSeconds(_ s: String?) -> Int? {
        guard let s else { return nil }
        let parts = s.split(separator: ":")
        guard parts.count == 2, let m = Int(parts[0]), let sec = Int(parts[1]) else { return nil }
        return m * 60 + sec
    }

    private var zonePcts: [ZonePct] {
        if let z = run?.hrZonePcts {
            let t = z.z1 + z.z2 + z.z3 + z.z4 + z.z5
            guard t > 0 else { return defaultZones }
            return [
                ZonePct(zone: 1, pct: z.z1 / t, timeLabel: "\(Int(round(z.z1 / t * 54)))m"),
                ZonePct(zone: 2, pct: z.z2 / t, timeLabel: "\(Int(round(z.z2 / t * 54)))m"),
                ZonePct(zone: 3, pct: z.z3 / t, timeLabel: "\(Int(round(z.z3 / t * 54)))m"),
                ZonePct(zone: 4, pct: z.z4 / t, timeLabel: "\(Int(round(z.z4 / t * 54)))m"),
                ZonePct(zone: 5, pct: z.z5 / t, timeLabel: "\(Int(round(z.z5 / t * 54)))m")
            ]
        }
        return defaultZones
    }

    private var defaultZones: [ZonePct] {
        [
            ZonePct(zone: 1, pct: 0.11, timeLabel: "6m"),
            ZonePct(zone: 2, pct: 0.17, timeLabel: "9m"),
            ZonePct(zone: 3, pct: 0.41, timeLabel: "22m"),
            ZonePct(zone: 4, pct: 0.26, timeLabel: "14m"),
            ZonePct(zone: 5, pct: 0.06, timeLabel: "3m")
        ]
    }

    private var traceAvgLabel: String {
        switch currentMetric {
        case .pace: return "AVG 6:47 /mi"
        case .hr:   return "AVG 158 bpm"
        case .elev: return "+240 ft GAIN"
        case .cad:  return "AVG 167 spm"
        }
    }

    private func load() async {
        if let r = try? await API.fetchRunDetail(id: runId) {
            await MainActor.run { run = r }
        }
    }
}

private enum TraceMetric: String, CaseIterable {
    case pace, hr, elev, cad

    var label: String {
        switch self {
        case .pace: return "PACE"
        case .hr:   return "HR"
        case .elev: return "ELEV"
        case .cad:  return "CADENCE"
        }
    }

    var color: Color {
        switch self {
        case .pace: return Color(hex: 0xFF7A45)
        case .hr:   return Color(hex: 0xFF5A6E)
        case .elev: return Color(hex: 0xFFCE8A)
        case .cad:  return Color(hex: 0x9AF0BF)
        }
    }

    var points: [Double] {
        switch self {
        case .pace: return [436.6, 435.2, 439.2, 429.0, 427.0, 420.1, 412.0, 409.9, 400.5, 398.1, 389.6, 389.7, 392.4, 395.6, 390.0, 390.8, 394.0, 396.6, 393.6, 392.2, 396.8, 389.4, 395.9, 391.3, 390.2, 389.9, 391.5, 395.5, 390.4, 401.7, 410.1, 416.0, 425.4]
        case .hr:   return [118.3, 124.9, 132.2, 140.7, 146.4, 151.4, 153.1, 153.2, 153.3, 155.9, 156.2, 155.0, 157.0, 157.4, 159.5, 159.5, 158.4, 161.9, 159.1, 160.9, 162.9, 161.1, 163.1, 162.0, 165.2, 166.2, 166.1, 167.9, 169.3, 166.8, 162.4, 158.3, 153.8]
        case .elev: return [182.0, 202.6, 214.1, 220.7, 213.8, 209.0, 199.6, 196.6, 196.3, 198.0, 203.9, 206.4, 195.9, 184.6, 165.0, 148.6, 139.1, 144.2, 150.3, 166.4, 182.6, 196.1, 195.2, 195.7, 193.1, 195.0, 200.4, 212.4, 223.2, 235.7, 239.6, 237.1, 223.2]
        case .cad:  return [159.0, 159.9, 160.9, 161.7, 163.3, 166.3, 165.5, 165.0, 166.4, 166.4, 167.2, 168.6, 168.0, 167.7, 168.2, 168.6, 166.9, 169.6, 169.5, 170.0, 169.9, 168.9, 169.1, 168.5, 170.2, 168.7, 168.9, 169.6, 167.0, 165.5, 162.7, 160.5, 159.0]
        }
    }

    var labels: [String] {
        let count = points.count
        return (0..<count).map { i in
            let mi = Double(i) / Double(max(1, count - 1)) * 8.0
            return "mi \(String(format: "%.1f", mi)) · \(formatted(i))"
        }
    }

    private func formatted(_ i: Int) -> String {
        let v = points[i]
        switch self {
        case .pace:
            let s = Int(v.rounded())
            return "\(s / 60):\(String(format: "%02d", s % 60)) /mi"
        case .hr:   return "\(Int(v.rounded())) bpm"
        case .elev: return "\(Int(v.rounded())) ft"
        case .cad:  return "\(Int(v.rounded())) spm"
        }
    }
}
