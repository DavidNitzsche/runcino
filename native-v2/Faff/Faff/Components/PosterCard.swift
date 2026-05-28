//
//  PosterCard.swift
//
//  Mirrors web-v2/components/faff/Poster.tsx (+ Poster.module.css).
//
//  Gradient hero card · eyebrow row → display verb → optional phase
//  tag → optional hero number → optional stat trio at the bottom.
//
//  Typography follows the locked Oswald 700 display recipe via the
//  `.displayRecipe(size:)` modifier in Theme.swift. Body text uses
//  Inter via .body() helper from Fonts.swift.
//

import SwiftUI

struct PosterCard: View {
    let payload: PosterPayload

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // EYEBROW · "THU · MAY 28 · BASE"
            Text(payload.eyebrow)
                .font(.body(10, weight: .bold))
                .tracking(2.2)
                .foregroundStyle(Color.white.opacity(0.85))
                .padding(.bottom, 14)

            // VERB · Oswald 700 display recipe
            //
            // The web sizes between 56–88 with a CSS clamp. SwiftUI's
            // .minimumScaleFactor handles the long-verb overflow case
            // without needing the clamp math — at 72pt the longest verb
            // ("MISSED THE TARGETS.", "EASE OFF TOMORROW.") scales to
            // ~52pt to fit a 2-line max.
            Text(payload.verb)
                .displayRecipe(size: verbSize(payload.verb))
                .foregroundStyle(Color.white)
                .minimumScaleFactor(0.6)
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)

            if let suffix = payload.verbSuffix {
                Text(suffix)
                    .font(.body(18, weight: .medium).italic())
                    .foregroundStyle(Color.white.opacity(0.85))
                    .padding(.top, 8)
            }

            if let phaseTag = payload.phaseTag {
                Text(phaseTag)
                    .font(.body(10, weight: .bold))
                    .tracking(1.8)
                    .foregroundStyle(Color.white.opacity(0.65))
                    .padding(.top, 14)
            }

            if let hero = payload.heroNumber {
                heroNumberRow(hero)
                    .padding(.top, 8)
            }

            if let countdown = payload.daysCountdown {
                daysCountdownRow(countdown)
                    .padding(.top, 8)
            }

            if let prose = payload.prose {
                Text(prose)
                    .font(.body(14, weight: .medium))
                    .lineSpacing(4)
                    .foregroundStyle(Color.white.opacity(0.88))
                    .padding(.top, 14)
                    .fixedSize(horizontal: false, vertical: true)
            }

            // Push the stat trio to the bottom so the gradient breathes
            // above it · matches the web Poster's `flex-direction: column`
            // with the trio anchored at the foot.
            if let stats = payload.statTrio, !stats.isEmpty {
                Spacer(minLength: 22)
                statTrioRow(stats)
            }
        }
        .padding(.horizontal, 22)
        .padding(.top, 20)
        .padding(.bottom, 20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(minHeight: 340, alignment: .topLeading)
        .background(payload.gradient)
        .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
    }

    // MARK: - Verb sizing

    /// Mirrors the data-verb-length classification in Poster.tsx →
    /// the responsive clamp() ladder in Poster.module.css. On phone
    /// scale we land somewhere in the 56–80pt range depending on
    /// character count + presence of a space (single-word verbs get
    /// the tightest tier because they have no wrap point).
    private func verbSize(_ verb: String) -> CGFloat {
        let n = verb.count
        let body = verb.replacingOccurrences(of: ".", with: "")
        let hasSpace = body.contains(" ")
        if n <= 6 { return 80 }                      // short · REST. GO.
        if n <= 10 {
            return hasSpace ? 68 : 64               // medium / medium-singleword
        }
        if n <= 15 { return 60 }                     // long
        return 52                                    // very-long
    }

    // MARK: - Hero number row

    private func heroNumberRow(_ hero: FaffHeroNumber) -> some View {
        HStack(alignment: .lastTextBaseline, spacing: 8) {
            Text(hero.value)
                .font(Theme.Font.display(96))
                .tracking(Theme.Font.tracking(for: 96))
                .foregroundStyle(Color.white)
                .monospacedDigit()
                .minimumScaleFactor(0.5)
                .lineLimit(1)
            if let unit = hero.unit {
                Text(unit)
                    .font(.body(11, weight: .bold))
                    .tracking(2)
                    .foregroundStyle(Color.white.opacity(0.85))
            }
            if let duration = hero.duration {
                Spacer()
                Text("~\(duration)")
                    .font(.body(14, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.75))
            }
        }
    }

    // MARK: - Days countdown (race week)

    private func daysCountdownRow(_ c: FaffDaysCountdown) -> some View {
        HStack(alignment: .lastTextBaseline, spacing: 8) {
            Text("\(c.days)")
                .font(Theme.Font.display(96))
                .tracking(Theme.Font.tracking(for: 96))
                .foregroundStyle(Color.white)
                .monospacedDigit()
            Text(c.days == 1 ? "DAY" : "DAYS")
                .font(.body(12, weight: .bold))
                .tracking(2.2)
                .foregroundStyle(Color.white.opacity(0.85))
            Spacer()
            Text(c.dateLabel)
                .font(.body(13, weight: .medium))
                .foregroundStyle(Color.white.opacity(0.75))
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
    }

    // MARK: - Stat trio (bottom)

    private func statTrioRow(_ stats: [FaffStat]) -> some View {
        HStack(alignment: .top, spacing: 14) {
            ForEach(0..<stats.count, id: \.self) { i in
                let s = stats[i]
                VStack(alignment: .leading, spacing: 4) {
                    Text(s.value)
                        .font(Theme.Font.display(26))
                        .tracking(Theme.Font.tracking(for: 26))
                        .foregroundStyle(statValueColor(s.valueColor))
                        .monospacedDigit()
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                    Text(s.label)
                        .font(.body(9, weight: .bold))
                        .tracking(1.4)
                        .foregroundStyle(Color.white.opacity(0.75))
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private func statValueColor(_ v: FaffValueColor) -> Color {
        switch v {
        case .green: return Theme.green
        case .amber: return Theme.goal
        case .over:  return Theme.over
        case .race:  return Theme.race
        case .dist:  return Theme.dist
        case .default: return Color.white
        }
    }
}
