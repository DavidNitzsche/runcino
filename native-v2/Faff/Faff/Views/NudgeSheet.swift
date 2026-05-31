//
//  NudgeSheet.swift
//  Coach nudge · readiness dropped overnight, swap hard for easy.
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

                    // THE CHANGE section is hidden until we have a real
                    // coach proposal to surface. The proposals-state.ts
                    // backend writes coach_proposals rows on real triggers
                    // (illness / injury) · until the iPhone fetches them
                    // we render the readiness verdict + a single Got it CTA
                    // instead of a fake "planned → proposed" swap.

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

    /// Driven by /api/readiness inputs[] when available. The whys array is
    /// derived live · no hardcoded placeholders. When readiness isn't loaded
    /// yet (cold start), the section renders an empty state placeholder.
    private var whyRows: some View {
        let rows = readiness?.inputs ?? []
        return Group {
            if rows.isEmpty {
                Text("Pulling your readiness signal.")
                    .font(.body(13, weight: .semibold))
                    .foregroundStyle(Theme.txt.opacity(0.5))
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                VStack(spacing: 13) {
                    ForEach(rows) { r in
                        whyRow(r)
                    }
                }
            }
        }
    }

    /// One readiness-input row · key on the left, divergence bar in the middle,
    /// numeric observed value on the right. Bar is signed: negative weight
    /// lobes LEFT and tints amber; positive weight lobes RIGHT and tints mint.
    /// Bar magnitude maxes out at |weight|=25 (saturates beyond).
    @ViewBuilder
    private func whyRow(_ r: ReadinessInput) -> some View {
        let bad = r.weight < 0
        let magnitude = min(1.0, Double(abs(r.weight)) / 25.0)
        HStack(spacing: 12) {
            Text(r.key.uppercased())
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
                    // Signed bar lobe · pushes left or right from center.
                    Capsule()
                        .fill(bad ? Color(hex: 0xFFB24D) : Color(hex: 0x62E08A))
                        .frame(width: w * 0.5 * CGFloat(magnitude), height: 8)
                        .offset(x: bad ? (half - w * 0.5 * CGFloat(magnitude)) : half)
                }
            }
            .frame(height: 8)
            Text(r.observedV ?? "—")
                .font(.display(11, weight: .bold))
                .foregroundStyle(bad ? Color(hex: 0xFFCE8A) : Theme.txt)
                .frame(width: 80, alignment: .trailing)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
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
            Text(coachMessage)
                .font(.body(16, weight: .semibold))
                .foregroundStyle(Theme.txt.opacity(0.94))
                .lineSpacing(4)
            Spacer(minLength: 0)
        }
    }

    /// Pull the meaning from the worst (most-negative-weight) input the
    /// readiness endpoint surfaced. Falls back to a generic line keyed off
    /// the score band when we don't have inputs yet. Always honest · no
    /// fabricated "intervals" copy when the runner isn't doing intervals.
    private var coachMessage: String {
        if let worst = (readiness?.inputs ?? []).min(by: { $0.weight < $1.weight }),
           worst.weight < 0 {
            return worst.meaning
        }
        switch (readiness?.score ?? 0) {
        case 80...: return "Your body is primed. Run the plan."
        case 65..<80: return "Solid recovery. Hold the targets and trust the plan."
        case 50..<65: return "Borderline. Ease off and listen as you go."
        case 1..<50: return "Pull back today. Easy miles or a rest day · the work compounds when you recover."
        default: return "Awaiting your first health sample. Connect your watch to see your readiness."
        }
    }

    private var actions: some View {
        // Single-action sheet for the Morning Check today. The accept /
        // decline pair only makes sense when there's a real coach_proposal
        // to choose between · for v1 we show a Got it dismiss. The proposal
        // surface comes back when the iPhone gains the list endpoint
        // (tracked in BACKEND_FRONTEND_COVERAGE.html under Coach Moments).
        Button(action: onKeep) {
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
    }
}
