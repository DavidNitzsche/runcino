//
//  NudgeSheet.swift
//  Coach nudge · readiness dropped overnight, swap hard for easy.
//

import SwiftUI

struct NudgeSheet: View {
    let onAccept: () -> Void
    let onKeep: () -> Void

    private let mesh = FaffMesh(
        c1: 0x3FB6B0, c2: 0xFFB24D, c3: 0x0E4F4C,
        c4: 0x155A4A, c5: 0x155A4A, base: 0x0A2622
    )

    var body: some View {
        ZStack {
            FaffMeshView(mesh: mesh)

            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    topLabel
                        .padding(.top, 50)
                        .padding(.horizontal, 24)
                    hero
                        .padding(.top, 22)
                        .padding(.horizontal, 24)

                    sectionLabel("WHY")
                        .padding(.top, 26)
                        .padding(.horizontal, 24)
                    whyRows
                        .padding(.top, 14)
                        .padding(.horizontal, 24)

                    sectionLabel("FAFF SAYS")
                        .padding(.top, 26)
                        .padding(.horizontal, 24)
                    coachCard
                        .padding(.top, 14)
                        .padding(.horizontal, 24)

                    sectionLabel("THE CHANGE")
                        .padding(.top, 26)
                        .padding(.horizontal, 24)
                    swap
                        .padding(.top, 14)
                        .padding(.horizontal, 24)

                    actions
                        .padding(.top, 26)
                        .padding(.horizontal, 24)
                        .padding(.bottom, 40)
                }
            }
        }
    }

    private var topLabel: some View {
        HStack(spacing: 9) {
            Circle().fill(Color(hex: 0xFFB24D)).frame(width: 8, height: 8)
            Text("MORNING CHECK · THU")
                .font(.label(13)).tracking(2.5)
                .foregroundStyle(Theme.txt)
            Spacer()
        }
    }

    private var hero: some View {
        HStack(spacing: 18) {
            ZStack {
                Circle()
                    .stroke(Color.white.opacity(0.16), lineWidth: 7)
                Circle()
                    .trim(from: 0, to: 0.61)
                    .stroke(Color(hex: 0xFFB24D),
                            style: StrokeStyle(lineWidth: 7, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                VStack(spacing: 5) {
                    Text("61")
                        .font(.display(36, weight: .bold))
                        .tracking(-1.5)
                        .foregroundStyle(Theme.txt)
                    Text("EASY")
                        .font(.label(8)).tracking(2)
                        .foregroundStyle(Color(hex: 0xFFCE8A))
                }
            }
            .frame(width: 104, height: 104)

            VStack(alignment: .leading, spacing: 0) {
                Text("READINESS")
                    .font(.label(11)).tracking(2)
                    .foregroundStyle(Theme.txt.opacity(0.66))
                Text("Down 21\novernight")
                    .font(.display(27, weight: .bold))
                    .tracking(-1)
                    .foregroundStyle(Theme.txt)
                    .lineSpacing(-4)
                    .padding(.top, 8)
                Text("was 82 yesterday")
                    .font(.display(11, weight: .bold))
                    .foregroundStyle(Color(hex: 0xFFCE8A))
                    .padding(.top, 9)
            }
            Spacer()
        }
    }

    private func sectionLabel(_ text: String) -> some View {
        HStack {
            SpecLabel(text: text, color: Theme.txt.opacity(0.6))
            Spacer()
        }
    }

    private struct WhyRow: Hashable {
        let key: String
        let bar: CGFloat
        let rightSide: Bool
        let bad: Bool
        let value: String
    }

    private let whys: [WhyRow] = [
        WhyRow(key: "HRV", bar: 0.30, rightSide: false, bad: true, value: "48 · −20"),
        WhyRow(key: "RHR", bar: 0.18, rightSide: false, bad: true, value: "53 · +5"),
        WhyRow(key: "SLEEP", bar: 0.34, rightSide: false, bad: true, value: "5:40 short"),
        WhyRow(key: "LOAD", bar: 0.14, rightSide: true, bad: false, value: "balanced")
    ]

    private var whyRows: some View {
        VStack(spacing: 13) {
            ForEach(whys, id: \.self) { r in
                HStack(spacing: 12) {
                    Text(r.key)
                        .font(.display(11, weight: .bold))
                        .foregroundStyle(Theme.txt.opacity(0.7))
                        .frame(width: 52, alignment: .leading)
                    GeometryReader { geo in
                        let w = geo.size.width
                        let half = w / 2
                        ZStack(alignment: .leading) {
                            Capsule().fill(Color.white.opacity(0.1)).frame(height: 8)
                            // Center divider tick.
                            Rectangle()
                                .fill(Color.white.opacity(0.3))
                                .frame(width: 1, height: 10)
                                .position(x: half, y: 4)
                            // Bar lobe.
                            Capsule()
                                .fill(r.bad ? Color(hex: 0xFFB24D) : Color(hex: 0x62E08A))
                                .frame(width: w * r.bar, height: 8)
                                .offset(x: r.rightSide ? half : (half - w * r.bar))
                        }
                    }
                    .frame(height: 8)
                    Text(r.value)
                        .font(.display(11, weight: .bold))
                        .foregroundStyle(r.bad ? Color(hex: 0xFFCE8A) : Theme.txt)
                        .frame(width: 80, alignment: .trailing)
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
            Text("Your body isn't ready for today's intervals · HRV dropped and sleep ran short. Pushing now costs more than it builds. Let's swap to easy miles and protect the week.")
                .font(.body(16, weight: .semibold))
                .foregroundStyle(Theme.txt.opacity(0.94))
                .lineSpacing(4)
            Spacer(minLength: 0)
        }
    }

    private var swap: some View {
        VStack(spacing: 0) {
            sessionCard(label: "TODAY · PLANNED", title: "5 × 1 mi @ 6:10",
                        desc: "VO2 intervals · hard",
                        accent: Color(hex: 0xE2293F),
                        struckOut: true)
            Image(systemName: "arrow.down")
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(Theme.txt)
                .frame(width: 34, height: 34)
                .background(Color.white.opacity(0.12), in: Circle())
                .overlay(Circle().stroke(Color.white.opacity(0.2), lineWidth: 1))
                .offset(y: -9)
                .padding(.bottom, -9)
                .zIndex(2)
            sessionCard(label: "PROPOSED", title: "Easy 6 mi @ 8:15",
                        desc: "recovery · conversational",
                        accent: Color(hex: 0x34C194),
                        struckOut: false,
                        good: true)
        }
    }

    private func sessionCard(label: String, title: String, desc: String,
                             accent: Color, struckOut: Bool, good: Bool = false) -> some View {
        HStack(spacing: 0) {
            Rectangle().fill(accent).frame(width: 4)
            VStack(alignment: .leading, spacing: 6) {
                Text(label)
                    .font(.label(9)).tracking(1.5)
                    .foregroundStyle(Theme.txt.opacity(0.6))
                Text(title)
                    .font(.body(18, weight: .extraBold))
                    .foregroundStyle(Theme.txt)
                    .strikethrough(struckOut, color: Theme.txt.opacity(0.4))
                Text(desc)
                    .font(.display(11, weight: .bold))
                    .foregroundStyle(Theme.txt.opacity(0.62))
            }
            .padding(.vertical, 15).padding(.horizontal, 17)
            Spacer()
        }
        .background(
            good
            ? Color(hex: 0x122822).opacity(0.55)
            : (struckOut ? Color(hex: 0x140608).opacity(0.4) : Color.white.opacity(0.06)),
            in: RoundedRectangle(cornerRadius: 18, style: .continuous)
        )
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous)
            .stroke(good ? Color(hex: 0x9AF0BF).opacity(0.4) : Color.white.opacity(0.14), lineWidth: 1))
        .opacity(struckOut ? 0.55 : 1.0)
        .shadow(color: good ? Color(hex: 0x62E08A).opacity(0.22) : .clear, radius: 22)
    }

    private var actions: some View {
        VStack(spacing: 11) {
            Button(action: onAccept) {
                Text("Accept the change")
                    .font(.body(16, weight: .extraBold))
                    .foregroundStyle(Color(hex: 0x06302A))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 17)
                    .background(Color(hex: 0x9AF0BF),
                                in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .shadow(color: Color(hex: 0x62E08A).opacity(0.5), radius: 30, y: 12)
            }
            .buttonStyle(.plain)

            Button(action: onKeep) {
                Text("Keep today's intervals")
                    .font(.body(13, weight: .bold))
                    .foregroundStyle(Theme.txt.opacity(0.62))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
            }
            .buttonStyle(.plain)
        }
    }
}
