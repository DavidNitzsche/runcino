//
//  Primitives.swift
//  Small reusable building blocks shared across screens.
//
//   · SpecLabel  — tracked caps eyebrow (Inter ExtraBold)
//   · BackChip   — 38pt circular glass chevron-back
//   · Pill       — caps tag in a pill (sized + colored)
//   · GlassTile  — dark glass card body
//   · GlassRow   — 1-line key + right widget row
//   · SectionLabel — tracked caps section heading
//   · StatRow    — 3-up KEY/VALUE row
//   · FaffToggle — 46×27 custom toggle (Settings)
//   · LivePulseDot — pulsing dot for LIVE chips
//   · ReadinessRing — circular progress ring (parametric)
//   · EffortMeter   — gradient bar with optional marker
//

import SwiftUI

// MARK: - SpecLabel

struct SpecLabel: View {
    let text: String
    var size: CGFloat = 11
    var tracking: CGFloat = 2.0
    var color: Color = Theme.txt.opacity(0.62)
    var body: some View {
        Text(text)
            .font(.label(size))
            .tracking(tracking)
            .textCase(.uppercase)
            .foregroundStyle(color)
    }
}

// MARK: - BackChip

struct BackChip: View {
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: "chevron.backward")
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(Theme.txt)
                .frame(width: 38, height: 38)
                .background(Theme.Glass.fill, in: Circle())
                .overlay(Circle().stroke(Theme.Glass.line, lineWidth: 1))
                .background(.ultraThinMaterial, in: Circle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Pill

struct Pill: View {
    let text: String
    var color: Color = .white
    var textColor: Color = Theme.bg
    var size: CGFloat = 10
    var tracking: CGFloat = 1.0
    var icon: String? = nil

    var body: some View {
        HStack(spacing: 5) {
            if let icon {
                Image(systemName: icon).font(.system(size: size * 0.9, weight: .bold))
            }
            Text(text)
                .font(.label(size))
                .tracking(tracking)
                .textCase(.uppercase)
        }
        .foregroundStyle(textColor)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(color, in: Capsule())
    }
}

// MARK: - GlassTile

struct GlassTile<Content: View>: View {
    var padding: CGFloat = 16
    var radius: CGFloat = Theme.rTile
    @ViewBuilder var content: () -> Content

    var body: some View {
        content()
            .padding(padding)
            .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous)
                .stroke(Theme.Glass.line, lineWidth: 1))
            .background(.ultraThinMaterial,
                        in: RoundedRectangle(cornerRadius: radius, style: .continuous))
    }
}

// MARK: - GlassRow

struct GlassRow<Trailing: View>: View {
    let title: String
    var subtitle: String? = nil
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.body(15, weight: .semibold))
                    .foregroundStyle(Theme.txt)
                if let subtitle {
                    Text(subtitle)
                        .font(.body(11, weight: .medium))
                        .foregroundStyle(Theme.mute)
                }
            }
            Spacer(minLength: 12)
            trailing()
        }
    }
}

// MARK: - SectionLabel

struct SectionLabel: View {
    let title: String
    var trailing: AnyView? = nil
    var body: some View {
        HStack {
            SpecLabel(text: title)
            Spacer()
            if let trailing { trailing }
        }
    }
}

// MARK: - StatRow

struct Stat: Hashable {
    let value: String
    let key: String
    var unit: String? = nil
}

struct StatRow: View {
    let stats: [Stat]
    var valueFont: CGFloat = 26
    var keyColor: Color = Theme.txt.opacity(0.56)
    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            ForEach(Array(stats.enumerated()), id: \.offset) { _, s in
                VStack(alignment: .center, spacing: 5) {
                    HStack(alignment: .firstTextBaseline, spacing: 3) {
                        Text(s.value)
                            .font(.display(valueFont, weight: .semibold))
                            .foregroundStyle(Theme.txt)
                        if let unit = s.unit {
                            Text(unit)
                                .font(.body(11, weight: .bold))
                                .foregroundStyle(Theme.txt.opacity(0.6))
                        }
                    }
                    SpecLabel(text: s.key, size: 9, tracking: 1.4, color: keyColor)
                }
                .frame(maxWidth: .infinity)
            }
        }
    }
}

// MARK: - FaffToggle (Settings)

struct FaffToggle: View {
    @Binding var isOn: Bool
    var onColor: Color = Theme.green

    var body: some View {
        Button { withAnimation(Theme.Motion.smooth) { isOn.toggle() } } label: {
            ZStack(alignment: isOn ? .trailing : .leading) {
                Capsule()
                    .fill(isOn ? onColor.opacity(0.62) : Theme.Glass.line)
                    .frame(width: 46, height: 27)
                Circle()
                    .fill(Color.white)
                    .frame(width: 23, height: 23)
                    .shadow(color: .black.opacity(0.25), radius: 2, y: 1)
                    .padding(2)
            }
        }
        .buttonStyle(.plain)
    }
}

// MARK: - LivePulseDot

struct LivePulseDot: View {
    var color: Color = Color(hex: 0xFC4D64)
    var size: CGFloat = 8

    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSinceReferenceDate
            let phase = (sin(t * 2 * .pi / 1.4) + 1) / 2
            ZStack {
                Circle()
                    .fill(color.opacity(0.4 + 0.4 * phase))
                    .frame(width: size + size * phase, height: size + size * phase)
                    .blur(radius: 2)
                Circle()
                    .fill(color)
                    .frame(width: size, height: size)
            }
            .frame(width: size * 2.4, height: size * 2.4)
        }
    }
}

// MARK: - ReadinessRing

struct ReadinessRing: View {
    let score: Int
    var size: CGFloat = 54
    var color: Color = Theme.green
    var trackColor: Color = Color.white.opacity(0.22)
    /// Override the sub-label (otherwise auto-classifies score → EASY/STEADY/READY/PRIMED/PEAK).
    var subLabel: String? = nil
    /// Override the breathing animation halo.
    var breathing: Bool = false

    var body: some View {
        let score = max(0, min(100, score))
        let fraction = Double(score) / 100.0
        let strokeWidth: CGFloat = max(4, size * 0.085)

        ZStack {
            Circle()
                .stroke(trackColor, lineWidth: strokeWidth)

            Circle()
                .trim(from: 0, to: CGFloat(fraction))
                .stroke(color, style: StrokeStyle(lineWidth: strokeWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(.easeOut(duration: 0.55), value: fraction)

            VStack(spacing: max(2, size * 0.04)) {
                Text("\(score)")
                    .font(.display(size * 0.36, weight: .bold))
                    .tracking(-size * 0.012)
                    .foregroundStyle(Theme.txt)
                if let sub = subLabel ?? Self.classify(score) {
                    Text(sub)
                        .font(.label(max(8, size * 0.085)))
                        .tracking(max(1, size * 0.038))
                        .textCase(.uppercase)
                        .foregroundStyle(color)
                }
            }
        }
        .frame(width: size, height: size)
        .overlay(
            Circle()
                .stroke(color.opacity(breathing ? 0.3 : 0), lineWidth: 4)
                .blur(radius: 8)
                .scaleEffect(breathing ? 1.05 : 1.0)
                .animation(breathing ? .easeInOut(duration: 3.6).repeatForever(autoreverses: true) : nil, value: breathing)
        )
    }

    static func classify(_ score: Int) -> String? {
        switch score {
        case ..<40:   return "Easy"
        case 40..<55: return "Steady"
        case 55..<70: return "Ready"
        case 70..<85: return "Primed"
        default:      return "Peak"
        }
    }
}

// MARK: - EffortMeter

struct EffortMeter: View {
    /// Marker position 0..1 across the meter, with optional label.
    let position: Double
    let label: String?
    var height: CGFloat = 6
    var showZones: Bool = true

    var body: some View {
        let stops: [Color] = [
            Color(hex: 0x54DDD0),
            Color(hex: 0x8EF0B0),
            Color(hex: 0xFFE0A0),
            Color(hex: 0xFF9560),
            Color(hex: 0xFC4D64)
        ]
        VStack(alignment: .leading, spacing: 12) {
            ZStack(alignment: .leading) {
                LinearGradient(colors: stops, startPoint: .leading, endPoint: .trailing)
                    .frame(height: height)
                    .clipShape(Capsule())
                    .overlay(
                        Capsule().stroke(Color.white.opacity(0.12), lineWidth: 1)
                    )
                GeometryReader { geo in
                    let x = max(8, min(geo.size.width - 8, geo.size.width * CGFloat(position)))
                    VStack(spacing: 1) {
                        if let label {
                            Text(label)
                                .font(.label(9.5)).tracking(0.8).textCase(.uppercase)
                                .foregroundStyle(Theme.bg)
                                .padding(.horizontal, 9).padding(.vertical, 3)
                                .background(Color.white, in: Capsule())
                                .shadow(color: .black.opacity(0.3), radius: 3, y: 2)
                        }
                        Triangle()
                            .fill(Color.white)
                            .frame(width: 10, height: 6)
                    }
                    .offset(x: x - 16, y: -22 - (label != nil ? 16 : 0))
                }
                .frame(height: height)
            }
            if showZones {
                HStack {
                    ForEach(["Z1","Z2","Z3","Z4","Z5"], id: \.self) { z in
                        SpecLabel(text: z, size: 8, tracking: 1, color: Theme.txt.opacity(0.5))
                            .frame(maxWidth: .infinity)
                    }
                }
            }
        }
    }
}

// MARK: - Triangle path

struct Triangle: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: rect.midX, y: rect.maxY))
        p.addLine(to: CGPoint(x: rect.minX, y: rect.minY))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        p.closeSubpath()
        return p
    }
}
