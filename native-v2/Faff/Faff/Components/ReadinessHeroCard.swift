//
//  ReadinessHeroCard.swift
//
//  Big READINESS score block for /health, mirroring the
//  ReadinessBreakdownView card on web-v2/app/health/page.tsx:
//
//      <div className="card" ...>
//        <div className="card-eyebrow" style={{ color: 'var(--green)' }}>
//          READINESS · TODAY
//        </div>
//        <ReadinessBreakdownView breakdown={glance.readiness} />
//      </div>
//
//  On iPhone we don't need the full breakdown (sleep / hr / hrv subscores
//  with their own bars) here — those live in the BodyMetricCards beneath
//  this hero. So the hero collapses to:
//      eyebrow "READINESS · TODAY"
//      huge ReadinessRing (large size)
//      band label "PRIMED" / "HOLD EASY" / "BACK OFF" / "PENDING"
//
//  The band color matches the ring color via Theme.green / Theme.goal /
//  Theme.over per the rules in ReadinessRing.color(for:).
//
//  Phase 25b · 2026-05-28 · iPhone /health v3 cutover.
//

import SwiftUI

struct ReadinessHeroCard: View {
    let score: Int?
    let label: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("READINESS · TODAY")
                .font(.label(10)).tracking(1.6)
                .foregroundStyle(Theme.green)

            HStack(alignment: .center, spacing: 18) {
                ReadinessRing(score: score, label: nil, size: .large)
                VStack(alignment: .leading, spacing: 6) {
                    Text(headlineWord)
                        .font(.display(34))
                        .foregroundStyle(ringColor)
                    Text(subline)
                        .font(.body(12))
                        .foregroundStyle(Theme.mute)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 22)
        .padding(.vertical, 20)
        .background(Theme.card)
        .overlay(
            RoundedRectangle(cornerRadius: Theme.rCard)
                .stroke(Theme.line, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
        .padding(.horizontal, 24)
    }

    /// Match the ring color rules in ReadinessRing.color(for:):
    /// ≥75 green · 60-74 amber · <60 red · nil → mute.
    private var ringColor: Color {
        guard let s = score else { return Theme.mute }
        if s >= 75 { return Theme.green }
        if s >= 60 { return Theme.goal }
        return Theme.over
    }

    /// Big-word headline. Prefer the server-supplied label, fallback to
    /// the band classification when the server is silent.
    private var headlineWord: String {
        if let label, !label.isEmpty { return label.capitalized }
        guard let s = score else { return "Pending" }
        if s >= 75 { return "Primed" }
        if s >= 60 { return "Hold easy" }
        return "Back off"
    }

    /// One-line explainer underneath the headline word.
    private var subline: String {
        guard let s = score else {
            return "Need a few nights of HR + sleep data before this gets useful."
        }
        if s >= 75 { return "Sleep, HRV, HR · all green. Press today." }
        if s >= 60 { return "One signal is soft. Hold to easy intensity." }
        return "Multiple stressors stacked. Pull back, recover, reassess."
    }
}
