//
//  WeeklySheet.swift
//  Weekly check-in · coach closes the week, sets up next.
//

import SwiftUI

struct WeeklySheet: View {
    let onDismiss: () -> Void

    private let mesh = FaffMesh(
        c1: 0xFFE0A0, c2: 0xF8B85F, c3: 0xB46026,
        c4: 0x7A3A18, c5: 0x7A3A18, base: 0x2A1208
    )

    var body: some View {
        ZStack {
            FaffMeshView(mesh: mesh)

            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    header
                        .padding(.top, 50)
                        .padding(.horizontal, 24)
                    hero
                        .padding(.top, 18)
                        .padding(.horizontal, 24)

                    sectionLabel("THE WEEK")
                        .padding(.top, 26)
                        .padding(.horizontal, 24)
                    weekChart
                        .padding(.top, 14)
                        .padding(.horizontal, 24)

                    sectionLabel("FAFF SAYS")
                        .padding(.top, 26)
                        .padding(.horizontal, 24)
                    coachCard
                        .padding(.top, 14)
                        .padding(.horizontal, 24)

                    sectionLabel("NEXT WEEK")
                        .padding(.top, 26)
                        .padding(.horizontal, 24)
                    nextWeekTile
                        .padding(.top, 14)
                        .padding(.horizontal, 24)
                        .padding(.bottom, 42)
                }
            }
        }
    }

    private var header: some View {
        HStack {
            Text("WEEKLY CHECK-IN")
                .font(.label(13)).tracking(2.5)
                .foregroundStyle(Theme.txt)
            Spacer()
            Button { onDismiss() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Theme.txt)
                    .frame(width: 32, height: 32)
                    .background(Color.white.opacity(0.14), in: Circle())
            }
            .buttonStyle(.plain)
        }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("WEEK 14 · BUILD PHASE")
                .font(.label(11)).tracking(2.5)
                .foregroundStyle(Theme.txt.opacity(0.66))
            Text("A strong\nweek.")
                .font(.display(44, weight: .bold))
                .tracking(-2)
                .foregroundStyle(Theme.txt)
                .lineSpacing(-6)
                .padding(.top, 9)
            Text("May 19 – May 25")
                .font(.display(11, weight: .bold))
                .foregroundStyle(Theme.txt.opacity(0.7))
                .padding(.top, 10)

            HStack(alignment: .top, spacing: 26) {
                heroStat(value: "47", unit: "mi", key: "DISTANCE")
                heroStat(value: "4", unit: "/5", key: "SESSIONS")
                heroStat(value: "+3", unit: "mi", key: "VS LAST WK")
                Spacer(minLength: 0)
            }
            .padding(.top, 22)
        }
    }

    private func heroStat(value: String, unit: String, key: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(value)
                    .font(.display(30, weight: .semibold))
                    .tracking(-1.5)
                    .foregroundStyle(Theme.txt)
                Text(unit)
                    .font(.display(14, weight: .semibold))
                    .foregroundStyle(Theme.txt.opacity(0.7))
            }
            SpecLabel(text: key, size: 9, tracking: 1.5, color: Theme.txt.opacity(0.6))
        }
    }

    private func sectionLabel(_ text: String) -> some View {
        HStack {
            SpecLabel(text: text, color: Theme.txt.opacity(0.6))
            Spacer()
        }
    }

    private struct Day: Hashable {
        let dn: String
        let dm: String
        let height: CGFloat
        let color: Color?
        let done: Bool
        let miss: Bool
    }

    private let days: [Day] = [
        Day(dn: "M", dm: "rest",    height: 0,    color: nil,                done: false, miss: false),
        Day(dn: "T", dm: "6 easy",  height: 0.38, color: Color(hex: 0x34C194), done: true,  miss: false),
        Day(dn: "W", dm: "8 tempo", height: 0.64, color: Color(hex: 0xFF7A45), done: true,  miss: false),
        Day(dn: "T", dm: "easy",    height: 0.30, color: nil,                done: false, miss: true),
        Day(dn: "F", dm: "5 rec",   height: 0.30, color: Color(hex: 0x3AB0CF), done: true,  miss: false),
        Day(dn: "S", dm: "16 long", height: 1.00, color: Color(hex: 0xF8B85F), done: true,  miss: false),
        Day(dn: "S", dm: "4 shake", height: 0.26, color: Color(hex: 0x3AB0CF), done: true,  miss: false)
    ]

    private var weekChart: some View {
        VStack(spacing: 0) {
            HStack(alignment: .bottom, spacing: 8) {
                ForEach(Array(days.enumerated()), id: \.offset) { _, d in
                    VStack(spacing: 7) {
                        ZStack(alignment: .top) {
                            if d.height > 0 {
                                ZStack(alignment: .top) {
                                    if d.miss {
                                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                                            .fill(Color.white.opacity(0.06))
                                            .overlay(
                                                StripePattern()
                                                    .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                                            )
                                            .frame(height: 110 * d.height)
                                    } else {
                                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                                            .fill(d.color ?? Color.white.opacity(0.12))
                                            .frame(height: 110 * d.height)
                                    }
                                    if d.done {
                                        Image(systemName: "checkmark")
                                            .font(.system(size: 10, weight: .heavy))
                                            .foregroundStyle(Color(hex: 0x9AF0BF))
                                            .offset(y: -16)
                                    }
                                }
                            } else {
                                RoundedRectangle(cornerRadius: 6, style: .continuous)
                                    .fill(Color.white.opacity(0.12))
                                    .frame(height: 8)
                                    .offset(y: 102)
                            }
                        }
                        .frame(height: 110)
                        Text(d.dn)
                            .font(.body(9, weight: .extraBold))
                            .foregroundStyle(Theme.txt.opacity(0.6))
                        Text(d.dm)
                            .font(.display(8.5, weight: .bold))
                            .foregroundStyle(Theme.txt.opacity(0.55))
                    }
                    .frame(maxWidth: .infinity)
                }
            }
        }
    }

    private var coachCard: some View {
        HStack(alignment: .top, spacing: 11) {
            Text("COACH")
                .font(.label(9)).tracking(1)
                .foregroundStyle(Color(hex: 0x9AF0BF))
                .padding(.horizontal, 7).padding(.vertical, 4)
                .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .stroke(Color(hex: 0x9AF0BF).opacity(0.4), lineWidth: 1))
                .padding(.top, 2)
            Text("You nailed the long run and Wednesday's tempo · both right on target. Skipping Thursday's easy was the right call after a short night. Load's climbing cleanly. Same shape next week, a touch more volume.")
                .font(.body(15, weight: .semibold))
                .foregroundStyle(Theme.txt.opacity(0.92))
                .lineSpacing(4)
            Spacer(minLength: 0)
        }
    }

    private var nextWeekTile: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Peak build · biggest week yet")
                .font(.body(17, weight: .extraBold))
                .foregroundStyle(Theme.txt)
            Text("50 mi · key session: 2 × 3 mi @ threshold")
                .font(.display(11, weight: .semibold))
                .foregroundStyle(Theme.txt.opacity(0.6))
                .padding(.top, 5)
            nextRow(key: "Volume", value: "50 mi · +3")
                .padding(.top, 14)
            nextRow(key: "Quality days", value: "Tue threshold · Sat long")
            nextRow(key: "CIM", value: "184 days out")
        }
        .padding(16)
        .background(Color(hex: 0x1C0C04).opacity(0.46),
                    in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous)
            .stroke(Color.white.opacity(0.14), lineWidth: 1))
        .background(.ultraThinMaterial,
                    in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private func nextRow(key: String, value: String) -> some View {
        HStack {
            Text(key)
                .font(.body(13, weight: .semibold))
                .foregroundStyle(Theme.txt.opacity(0.66))
            Spacer()
            Text(value)
                .font(.display(13, weight: .bold))
                .foregroundStyle(Theme.txt)
        }
        .padding(.vertical, 9)
    }
}

private struct StripePattern: View {
    var body: some View {
        Canvas { ctx, size in
            let stripe: CGFloat = 5
            var x: CGFloat = -size.height
            while x < size.width + size.height {
                let path = Path { p in
                    p.move(to: CGPoint(x: x, y: 0))
                    p.addLine(to: CGPoint(x: x + size.height, y: size.height))
                    p.addLine(to: CGPoint(x: x + size.height + stripe, y: size.height))
                    p.addLine(to: CGPoint(x: x + stripe, y: 0))
                    p.closeSubpath()
                }
                ctx.fill(path, with: .color(Color.white.opacity(0.14)))
                x += stripe * 2
            }
        }
    }
}
