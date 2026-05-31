//
//  NudgeSheet.swift
//  Morning check · score ring + per-driver bars + coach voice. Used to
//  hardcode the WHY rows (HRV 48·−20, RHR 53·+5, SLEEP 5:40 short, LOAD
//  balanced) AND a fake planned-vs-proposed swap card · rendered the same
//  placeholder regardless of the runner's data. Now the WHYs come from
//  /api/readiness inputs and the coach text from the top driver's meaning.
//  The swap proposal section is gone until a real coach-proposal API ships.
//

import SwiftUI

struct NudgeSheet: View {
    let onAccept: () -> Void
    let onKeep: () -> Void
    var readiness: ReadinessSnapshot? = nil
    var healthFacts: CoachFactsBlock? = nil

    private let mesh = FaffMesh(
        c1: 0x3FB6B0, c2: 0xFFB24D, c3: 0x0E4F4C,
        c4: 0x155A4A, c5: 0x155A4A, base: 0x0A2622
    )

    @State private var loadedFacts: CoachFactsBlock?

    private var facts: CoachFactsBlock? { healthFacts ?? loadedFacts }

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

                    if !drivers.isEmpty {
                        sectionLabel("WHY")
                            .padding(.top, 26)
                            .padding(.horizontal, 24)
                        whyRows
                            .padding(.top, 14)
                            .padding(.horizontal, 24)
                    }

                    if let coachText {
                        sectionLabel("FAFF SAYS")
                            .padding(.top, 26)
                            .padding(.horizontal, 24)
                        coachCard(text: coachText)
                            .padding(.top, 14)
                            .padding(.horizontal, 24)
                    }

                    actions
                        .padding(.top, 26)
                        .padding(.horizontal, 24)
                        .padding(.bottom, 40)
                }
                .task {
                    if healthFacts == nil {
                        loadedFacts = try? await API.fetchCoachFacts(surface: "health")
                    }
                }
            }
        }
    }

    private var topLabel: some View {
        HStack(spacing: 9) {
            Circle().fill(Color(hex: 0xFFB24D)).frame(width: 8, height: 8)
            Text(headerLabel)
                .font(.label(13)).tracking(2.5)
                .foregroundStyle(Theme.txt)
            Spacer()
        }
    }

    private var headerLabel: String {
        let f = DateFormatter(); f.dateFormat = "EEE"
        return "MORNING CHECK · \(f.string(from: Date()).uppercased())"
    }

    private var hero: some View {
        let score = readiness?.score ?? 0
        let label = (readiness?.label ?? ReadinessRing.classify(score) ?? "—").uppercased()
        let frac = Double(max(0, min(100, score))) / 100.0
        return HStack(spacing: 18) {
            ZStack {
                Circle()
                    .stroke(Color.white.opacity(0.16), lineWidth: 7)
                Circle()
                    .trim(from: 0, to: CGFloat(frac))
                    .stroke(score < 65 ? Color(hex: 0xFFB24D) : Color(hex: 0x62E08A),
                            style: StrokeStyle(lineWidth: 7, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                VStack(spacing: 5) {
                    Text(score > 0 ? "\(score)" : "—")
                        .font(.display(36, weight: .bold))
                        .tracking(-1.5)
                        .foregroundStyle(Theme.txt)
                    Text(label)
                        .font(.label(8)).tracking(2)
                        .foregroundStyle(score < 65 ? Color(hex: 0xFFCE8A) : Color(hex: 0x9AF0BF))
                }
            }
            .frame(width: 104, height: 104)

            VStack(alignment: .leading, spacing: 0) {
                Text("READINESS")
                    .font(.label(11)).tracking(2)
                    .foregroundStyle(Theme.txt.opacity(0.66))
                Text(readinessHeadline)
                    .font(.display(20, weight: .bold))
                    .tracking(-0.5)
                    .foregroundStyle(Theme.txt)
                    .lineSpacing(-2)
                    .padding(.top, 8)
                    .multilineTextAlignment(.leading)
            }
            Spacer()
        }
    }

    private var readinessHeadline: String {
        let score = readiness?.score ?? 0
        switch score {
        case 80...: return "Primed for the work."
        case 65..<80: return "Hold the plan."
        case 50..<65: return "Ease the targets today."
        case 1..<50: return "Recover. Don't push."
        default: return "Awaiting your first sample."
        }
    }

    private func sectionLabel(_ text: String) -> some View {
        HStack {
            SpecLabel(text: text, color: Theme.txt.opacity(0.6))
            Spacer()
        }
    }

    /// Real readiness drivers from /api/readiness. Previously a hardcoded
    /// `[WhyRow]` array (HRV 48·−20 etc.) that rendered every morning whether
    /// the runner's data supported it or not. Now empty == hide the section.
    private var drivers: [ReadinessInput] { readiness?.inputs ?? [] }

    /// Pull the WHY text from `meaning` on the highest-weight driver (most
    /// impactful · positive or negative). If we have no inputs we fall back
    /// to the band label so the section either says something real or hides.
    private var coachText: String? {
        if let top = drivers.max(by: { abs($0.weight ?? 0) < abs($1.weight ?? 0) }),
           let m = top.meaning, !m.isEmpty {
            return m
        }
        return nil
    }

    private var whyRows: some View {
        VStack(spacing: 13) {
            ForEach(drivers.prefix(5), id: \.self) { input in
                whyRow(input)
            }
        }
    }

    /// One driver row — server gives us label + observedV + weight.
    /// Bar lobe scales off |weight| (server weights are roughly ±5..±20),
    /// side is right when weight is positive ("good"), bar color follows.
    private func whyRow(_ input: ReadinessInput) -> some View {
        let weight = input.weight ?? 0
        let bad = weight < 0
        let lobe = min(0.5, Double(abs(weight)) / 30.0)
        // server already prefixes "SLEEP · 28%" — strip the percent suffix
        // for the row chip so it reads cleanly.
        let key = input.label.split(separator: "·").first
            .map { $0.trimmingCharacters(in: .whitespaces) }
            ?? input.key.uppercased()
        return HStack(spacing: 12) {
            Text(key)
                .font(.display(11, weight: .bold))
                .foregroundStyle(Theme.txt.opacity(0.7))
                .frame(width: 52, alignment: .leading)
            GeometryReader { geo in
                let w = geo.size.width
                let half = w / 2
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.1)).frame(height: 8)
                    Rectangle()
                        .fill(Color.white.opacity(0.3))
                        .frame(width: 1, height: 10)
                        .position(x: half, y: 4)
                    Capsule()
                        .fill(bad ? Color(hex: 0xFFB24D) : Color(hex: 0x62E08A))
                        .frame(width: w * lobe, height: 8)
                        .offset(x: bad ? (half - w * lobe) : half)
                }
            }
            .frame(height: 8)
            Text(input.observedV ?? input.observedSub ?? "")
                .font(.display(11, weight: .bold))
                .foregroundStyle(bad ? Color(hex: 0xFFCE8A) : Theme.txt)
                .frame(width: 92, alignment: .trailing)
                .lineLimit(1)
        }
    }

    /// Coach card with real text from the top driver's `meaning`. No more
    /// hardcoded "Your body isn't ready for today's intervals" copy that
    /// rendered whether the readiness data supported it or not.
    private func coachCard(text: String) -> some View {
        HStack(alignment: .top, spacing: 11) {
            Text("COACH")
                .font(.label(9)).tracking(1)
                .foregroundStyle(Color(hex: 0x9AF0BF))
                .padding(.horizontal, 7).padding(.vertical, 4)
                .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .stroke(Color(hex: 0x9AF0BF).opacity(0.4), lineWidth: 1))
                .padding(.top, 2)
            Text(text)
                .font(.body(16, weight: .semibold))
                .foregroundStyle(Theme.txt.opacity(0.94))
                .lineSpacing(4)
            Spacer(minLength: 0)
        }
    }

    /// Acknowledge / dismiss actions. Previously framed as "Accept the
    /// change" / "Keep today's intervals" because the sheet showed a
    /// hardcoded swap proposal. There's no swap-proposal API yet, so the
    /// buttons now read what they actually do: ack the nudge, or stay.
    private var actions: some View {
        VStack(spacing: 11) {
            Button(action: onAccept) {
                Text("Got it")
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
                Text("Dismiss")
                    .font(.body(13, weight: .bold))
                    .foregroundStyle(Theme.txt.opacity(0.62))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
            }
            .buttonStyle(.plain)
        }
    }
}
