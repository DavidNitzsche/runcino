//
//  RaceDayView.swift
//  Race-day spec. Mesh is the race warm-red wash. Same product language
//  as the rest of the app: readiness ring, goal pace, gap beam, course,
//  plan segments, race-morning checklist.
//

import SwiftUI

struct RaceDayView: View {
    let raceSlug: String

    @State private var detail: RaceDetailResponse?

    var body: some View {
        let mesh = FaffEffort.race.mesh
        ZStack {
            FaffMeshView(mesh: mesh)

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    topRow
                        .padding(.horizontal, 22)
                        .padding(.top, 8)

                    hero
                        .padding(.horizontal, 24)
                        .padding(.top, 18)

                    section(title: "THE COURSE", right: courseStat) {
                        VStack(alignment: .leading, spacing: 14) {
                            SpecLabel(text: "ROUTE", size: 9, tracking: 2, color: Theme.txt.opacity(0.5))
                            mapPlaceholder
                                .frame(height: 118)
                            SpecLabel(text: "ELEVATION", size: 9, tracking: 2, color: Theme.txt.opacity(0.5))
                                .padding(.top, 4)
                            elevationPlaceholder
                                .frame(height: 150)
                            fuelLine
                                .padding(.top, 6)
                        }
                    }
                    .padding(.top, 26)

                    section(title: "THE PLAN", right: "EVEN EFFORT") {
                        planSegments
                        Text("Set from your sub-3 goal and the CIM profile. Faff re-tunes if conditions change.")
                            .font(.display(10, weight: .semibold))
                            .foregroundStyle(Theme.txt.opacity(0.5))
                            .lineSpacing(2)
                            .padding(.top, 8)
                    }
                    .padding(.top, 26)

                    section(title: "RACE MORNING", right: nil) {
                        morningTile
                    }
                    .padding(.top, 26)

                    Spacer(minLength: 60)
                }
            }
        }
        .task { await load() }
    }

    private var topRow: some View {
        HStack(alignment: .center) {
            HStack(spacing: 9) {
                LivePulseDot(color: Color(hex: 0xFFD27A), size: 8)
                    .frame(width: 12, height: 12)
                Text("RACE DAY")
                    .font(.label(13)).tracking(2.5)
                    .foregroundStyle(Theme.txt)
            }
            Spacer()
            ReadinessRing(score: 92, size: 46, color: Color(hex: 0x62E08A), subLabel: "PEAK")
        }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 0) {
            SpecLabel(text: heroEyebrow, size: 11, tracking: 2.5, color: Theme.txt.opacity(0.66))
            VStack(alignment: .leading, spacing: 9) {
                Text(raceShortCode)
                    .font(.display(78, weight: .bold))
                    .tracking(-4)
                    .foregroundStyle(Theme.txt)
                    .lineSpacing(-16)
                    .shadow(color: .black.opacity(0.34), radius: 26, y: 2)
                Text(raceName)
                    .font(.body(13, weight: .bold))
                    .foregroundStyle(Theme.txt.opacity(0.82))
            }
            .padding(.top, 8)

            VStack(alignment: .leading, spacing: 9) {
                Text(goalTime)
                    .font(.display(58, weight: .bold))
                    .tracking(-2.5)
                    .foregroundStyle(Theme.txt)
                    .shadow(color: .black.opacity(0.3), radius: 22, y: 2)
                Text("GOAL TIME  ·  \(goalPace) /mi")
                    .font(.display(13, weight: .bold))
                    .foregroundStyle(Theme.txt.opacity(0.78))
            }
            .padding(.top, 20)

            HStack {
                Text("PROJECTED 2:58:40")
                    .font(.display(11, weight: .bold))
                    .foregroundStyle(Theme.txt.opacity(0.85))
                Spacer()
                Text("50s UNDER GOAL")
                    .font(.display(11, weight: .bold))
                    .foregroundStyle(Color(hex: 0x9AF0BF))
            }
            .padding(.top, 22)

            GapBeam(
                progress: 1.0,
                height: 14,
                fillStops: [Color(hex: 0xFFD27A).opacity(0.5), Color(hex: 0x9AF0BF)],
                gapColor: Color(hex: 0xFFB24D),
                showKnob: false
            )
            .padding(.top, 12)

            HStack {
                Text("SEASON START 3:11")
                    .font(.display(10, weight: .bold))
                    .foregroundStyle(Theme.txt.opacity(0.5))
                Spacer()
                Text("GOAL 2:59:30 ✓")
                    .font(.display(10, weight: .bold))
                    .foregroundStyle(Color(hex: 0x9AF0BF))
            }
            .padding(.top, 12)

            Text("You closed the gap. You're peaked and projected under goal · everything from here is execution.")
                .font(.body(14, weight: .semibold))
                .foregroundStyle(Theme.txt.opacity(0.9))
                .lineSpacing(2)
                .padding(.top, 16)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var mapPlaceholder: some View {
        ZStack(alignment: .center) {
            RadialGradient(colors: [Color.black.opacity(0.4), Color.black.opacity(0)], center: .center, startRadius: 0, endRadius: 240)
            Path { p in
                p.move(to: .init(x: 34, y: 36))
                p.addCurve(to: .init(x: 116, y: 76), control1: .init(x: 78, y: 48), control2: .init(x: 70, y: 70))
                p.addCurve(to: .init(x: 198, y: 66), control1: .init(x: 160, y: 82), control2: .init(x: 152, y: 56))
                p.addCurve(to: .init(x: 280, y: 100), control1: .init(x: 244, y: 76), control2: .init(x: 234, y: 96))
                p.addCurve(to: .init(x: 322, y: 110), control1: .init(x: 306, y: 102), control2: .init(x: 310, y: 108))
            }
            .stroke(
                LinearGradient(colors: [Color(hex: 0xFFE0A0), Color(hex: 0xFF5A52)], startPoint: .topLeading, endPoint: .bottomTrailing),
                style: StrokeStyle(lineWidth: 4, lineCap: .round)
            )

            // Start & finish dots
            HStack {
                VStack(alignment: .leading) {
                    Circle()
                        .stroke(Color(hex: 0xFFD27A).opacity(0.5), lineWidth: 1.4)
                        .frame(width: 18, height: 18)
                        .background(Circle().fill(Color(hex: 0xFFD27A)).frame(width: 9, height: 9))
                    Text("START · Folsom")
                        .font(.display(8.5, weight: .bold))
                        .foregroundStyle(Color(hex: 0xFFD27A))
                }
                Spacer()
            }
            .padding(20)

            VStack {
                Spacer()
                HStack {
                    Spacer()
                    VStack(alignment: .trailing) {
                        Text("FINISH · Sacramento")
                            .font(.display(8.5, weight: .bold))
                            .foregroundStyle(Theme.txt)
                        Circle().fill(Color.white).frame(width: 10, height: 10)
                    }
                }
            }
            .padding(20)
        }
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var elevationPlaceholder: some View {
        ZStack {
            // Filled elevation profile
            GeometryReader { geo in
                let w = geo.size.width
                let h = geo.size.height
                Path { p in
                    p.move(to: .init(x: 0, y: h * 0.30))
                    let pts: [CGPoint] = [
                        .init(x: w * 0.08, y: h * 0.34),
                        .init(x: w * 0.16, y: h * 0.30),
                        .init(x: w * 0.24, y: h * 0.36),
                        .init(x: w * 0.32, y: h * 0.42),
                        .init(x: w * 0.42, y: h * 0.46),
                        .init(x: w * 0.52, y: h * 0.50),
                        .init(x: w * 0.62, y: h * 0.55),
                        .init(x: w * 0.72, y: h * 0.62),
                        .init(x: w * 0.82, y: h * 0.70),
                        .init(x: w * 0.92, y: h * 0.78),
                        .init(x: w,        y: h * 0.84)
                    ]
                    for pt in pts { p.addLine(to: pt) }
                    p.addLine(to: .init(x: w, y: h))
                    p.addLine(to: .init(x: 0, y: h))
                    p.closeSubpath()
                }
                .fill(LinearGradient(colors: [Color(hex: 0xFF8A4D).opacity(0.42), Color(hex: 0xFF8A4D).opacity(0)], startPoint: .top, endPoint: .bottom))

                Path { p in
                    p.move(to: .init(x: 0, y: h * 0.30))
                    let pts: [CGPoint] = [
                        .init(x: w * 0.08, y: h * 0.34),
                        .init(x: w * 0.24, y: h * 0.36),
                        .init(x: w * 0.42, y: h * 0.46),
                        .init(x: w * 0.62, y: h * 0.55),
                        .init(x: w * 0.82, y: h * 0.70),
                        .init(x: w,        y: h * 0.84)
                    ]
                    for pt in pts { p.addLine(to: pt) }
                }
                .stroke(
                    LinearGradient(colors: [Color(hex: 0xFFD27A), Color(hex: 0xFF9442), Color(hex: 0xFF6A3C), Color(hex: 0xE2293F)], startPoint: .leading, endPoint: .trailing),
                    style: StrokeStyle(lineWidth: 3, lineCap: .round)
                )

                Text("THE ROLLERS")
                    .font(.display(8.5, weight: .bold))
                    .tracking(1)
                    .foregroundStyle(Theme.txt.opacity(0.5))
                    .position(x: w * 0.16, y: h * 0.20)

                Text("366 ft")
                    .font(.display(9, weight: .bold))
                    .foregroundStyle(Color(hex: 0xFFD27A))
                    .position(x: 26, y: h * 0.18)
                Text("26 ft")
                    .font(.display(9, weight: .bold))
                    .foregroundStyle(Theme.txt)
                    .position(x: w - 22, y: h * 0.92)
            }
        }
    }

    private var fuelLine: some View {
        (
            Text("4 gels").bold().foregroundColor(Color(hex: 0xFFD49A)) +
            Text(" · PF 30 at miles 5 · 10 · 15 · 20 (caffeine) · PF 60 in flask, ~70g carb/hr")
        )
        .font(.display(10.5, weight: .bold))
        .tracking(0.2)
        .foregroundStyle(Theme.txt.opacity(0.66))
        .lineSpacing(2)
    }

    private var planSegments: some View {
        VStack(spacing: 0) {
            planSegRow(dot: Color(hex: 0xFFD27A), mi: "MI 1–3",   name: "Settle in",         sub: "controlled start · let them go",       pace: "6:55")
            planSegRow(dot: Color(hex: 0xFF9442), mi: "MI 3–10",  name: "The rollers",       sub: "even effort · don't fight the hills",  pace: "6:52")
            planSegRow(dot: Color(hex: 0xFF6A3C), mi: "MI 10–20", name: "Find your rhythm",  sub: "net downhill · lock into goal",        pace: "6:49")
            planSegRow(dot: Color(hex: 0xE2293F), mi: "MI 20–26.2", name: "Empty the tank", sub: "downhill finish · negative split",    pace: "6:43")
        }
    }

    private func planSegRow(dot: Color, mi: String, name: String, sub: String, pace: String) -> some View {
        HStack(alignment: .top, spacing: 13) {
            Circle().fill(dot).frame(width: 9, height: 9).padding(.top, 6)
            Text(mi)
                .font(.display(11, weight: .bold))
                .frame(width: 82, alignment: .leading)
                .foregroundStyle(Theme.txt.opacity(0.82))
                .padding(.top, 4)
            VStack(alignment: .leading, spacing: 2) {
                Text(name)
                    .font(.body(15, weight: .extraBold))
                    .tracking(-0.2)
                    .foregroundStyle(Theme.txt)
                Text(sub)
                    .font(.body(11.5, weight: .medium))
                    .foregroundStyle(Theme.txt.opacity(0.6))
            }
            Spacer()
            Text(pace)
                .font(.display(18, weight: .bold))
                .tracking(-0.5)
                .foregroundStyle(Color(hex: 0xFFD27A))
                .padding(.top, 2)
        }
        .padding(.vertical, 11)
    }

    private var morningTile: some View {
        GlassTile(padding: 6) {
            VStack(spacing: 0) {
                row("Gun time", "7:00 AM · Wave 1")
                row("Weather", "41°F · clear · calm", good: true)
                row("Gear check", "closes 6:40 AM")
                row("Shoes", "SC Trainer v3")
            }
        }
    }

    private func row(_ k: String, _ v: String, good: Bool = false) -> some View {
        HStack {
            Text(k).font(.body(13, weight: .semibold)).foregroundStyle(Theme.txt.opacity(0.66))
            Spacer()
            Text(v)
                .font(.display(13, weight: .bold))
                .foregroundStyle(good ? Color(hex: 0x9AF0BF) : Theme.txt)
        }
        .padding(.vertical, 11)
        .padding(.horizontal, 10)
    }

    private func section<C: View>(title: String, right: String?, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 14) {
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

    private var raceName: String { detail?.race.name ?? "California International Marathon" }

    private var raceShortCode: String {
        if let name = detail?.race.name {
            let initials = name.split(separator: " ").compactMap { $0.first.map(String.init) }.prefix(3).joined()
            return initials.isEmpty ? "CIM" : initials.uppercased()
        }
        return "CIM"
    }

    private var heroEyebrow: String {
        if let d = detail?.race.date { return "\(d.uppercased()) · YOUR A-RACE" }
        return "DEC 6 · YOUR A-RACE"
    }

    private var goalTime: String { detail?.race.goal ?? "2:59:30" }
    private var goalPace: String { "6:51" }
    private var courseStat: String { "26.2 MI · −340 FT · FAST" }

    private func load() async {
        if let r = try? await API.fetchRaceDetail(slug: raceSlug) {
            await MainActor.run { detail = r }
        }
    }
}
