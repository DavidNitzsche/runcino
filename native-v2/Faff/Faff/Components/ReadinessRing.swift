//
//  ReadinessRing.swift  (2026-05-27 iPhone parity audit)
//
//  Extracted from TodayView's private ReadinessChip so /health (and any
//  future surface) can show the same composite readiness number with
//  the same color semantics: green ≥75 (Primed), amber 60-74 (Hold
//  easy), red <60 (Back off). Score comes from /api/readiness via
//  API.fetchReadiness().
//
//  Two sizes:
//    - .chip:   44×44, fits in headers / hero rows
//    - .large:  120×120, fits health page hero
//

import SwiftUI

enum ReadinessRingSize {
    case chip
    case large

    var diameter: CGFloat {
        switch self {
        case .chip:  return 44
        case .large: return 120
        }
    }
    var lineWidth: CGFloat {
        switch self {
        case .chip:  return 3
        case .large: return 6
        }
    }
    var fontSize: CGFloat {
        switch self {
        case .chip:  return 16
        case .large: return 44
        }
    }
}

struct ReadinessRing: View {
    /// Optional — nil when /api/readiness can't compute a score yet
    /// (fresh install, no HK data). Renders "?" instead of lying with
    /// a fixed placeholder.
    let score: Int?
    /// Band label ("PRIMED" / "HOLD EASY" / "BACK OFF" / "PENDING").
    /// Only shown on .large size.
    let label: String?
    let size: ReadinessRingSize

    init(score: Int?, label: String? = nil, size: ReadinessRingSize = .chip) {
        self.score = score
        self.label = label
        self.size = size
    }

    var body: some View {
        VStack(spacing: size == .large ? 10 : 0) {
            ZStack {
                Circle().stroke(Color.white.opacity(0.08), lineWidth: size.lineWidth)
                if let score {
                    Circle()
                        .trim(from: 0, to: CGFloat(score) / 100)
                        .stroke(color(for: score), style: StrokeStyle(lineWidth: size.lineWidth, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                    Text("\(score)").font(.display(size.fontSize)).foregroundStyle(color(for: score))
                } else {
                    Text("?").font(.display(size.fontSize)).foregroundStyle(Theme.mute)
                }
            }
            .frame(width: size.diameter, height: size.diameter)
            if size == .large, let label {
                Text(label.uppercased())
                    .font(.label(11)).tracking(1.6)
                    .foregroundStyle(color(for: score ?? 0))
            }
        }
    }

    /// Color matches the band the server returns:
    /// ≥75 green (Primed) · 60-74 amber (Hold easy) · <60 red (Back off).
    private func color(for s: Int) -> Color {
        if s >= 75 { return Theme.green }
        if s >= 60 { return Theme.goal }
        return Theme.over
    }
}
