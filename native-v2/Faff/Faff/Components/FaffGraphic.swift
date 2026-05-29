//
//  FaffGraphic.swift
//
//  FAFF graphic primitives · the technical spec-sheet visual language.
//  Paper-overhaul gut (2026-05-29 · docs/DESIGN_OVERHAUL_2026-05-29.md §9).
//
//  The SwiftUI mirror of web-v2/components/faff/graphic/index.tsx. These
//  are the industrial-graphic DNA the gutted surfaces are built from —
//  registration marks, brackets, barcodes, crop frames, EKG activity
//  traces, ticket-stub numbers, mono stamps, tick rules, and the ruled
//  SpecRow that REPLACES the old rounded body chips/cards.
//
//  All token-driven (Theme.*) so they track the active skin and stay
//  revertable (Cardinal Rule #8). Pure presentational — no data fetch,
//  no state. Tone → Theme color via FaffTone.color.
//

import SwiftUI

// ──────────────────────────────────────────────────────────────────────
// Tone — the semantic accent axis. Mirrors StatusTone in the web index.
// Color is a thin registration MARK, never a fill (except race takeover).
// ──────────────────────────────────────────────────────────────────────

enum FaffTone {
    case green, amber, over, dist, rest, race, learn, mute, none

    var color: Color {
        switch self {
        case .green: return Theme.green
        case .amber: return Theme.goal
        case .over:  return Theme.over
        case .dist:  return Theme.dist
        case .rest:  return Theme.rest
        case .race:  return Theme.race
        case .learn: return Theme.learn
        case .mute:  return Theme.mute
        case .none:  return Color.clear
        }
    }

    /// Map the existing FaffValueColor cue → tone (adapter reuse).
    static func from(_ v: FaffValueColor) -> FaffTone {
        switch v {
        case .green:   return .green
        case .amber:   return .amber
        case .over:    return .over
        case .race:    return .race
        case .dist:    return .dist
        case .default: return .mute
        }
    }

    /// Map the existing FaffDotColor cue → tone (adapter reuse).
    static func from(_ d: FaffDotColor) -> FaffTone {
        switch d {
        case .green: return .green
        case .amber: return .amber
        case .over:  return .over
        case .dist:  return .dist
        case .none:  return .none
        }
    }

    /// Map a plan workout `type` string → tone. Shared across surfaces so
    /// EASY/LONG/QUALITY/REST/RACE always carry the same accent.
    static func forType(_ type: String?) -> FaffTone {
        switch (type ?? "").lowercased() {
        case "easy", "shakeout", "recovery":                 return .green
        case "long":                                         return .dist
        case "threshold", "tempo", "intervals", "fartlek",
             "progression", "quality":                       return .amber
        case "rest":                                         return .rest
        case "race":                                         return .race
        case "cross", "strength", "xtrain":                  return .learn
        default:                                             return .mute
        }
    }
}

// ──────────────────────────────────────────────────────────────────────
// SpecLabel — the instrument-readout caps label used everywhere.
// Inter-Bold, tracked, mute. The quiet voice of the spec sheet.
// ──────────────────────────────────────────────────────────────────────

struct SpecLabel: View {
    let text: String
    var size: CGFloat = 10
    var tone: FaffTone = .mute
    var tracking: CGFloat = 1.6

    init(_ text: String, size: CGFloat = 10, tone: FaffTone = .mute, tracking: CGFloat = 1.6) {
        self.text = text
        self.size = size
        self.tone = tone
        self.tracking = tracking
    }

    var body: some View {
        Text(text.uppercased())
            .font(.label(size))
            .tracking(tracking)
            .foregroundStyle(tone == .mute ? Theme.mute : tone.color)
    }
}

// ──────────────────────────────────────────────────────────────────────
// MonoStamp text — JetBrains-ish technical mono via the system monospace
// design (no bundled TTF needed). Used by Stamp + barcode captions.
// ──────────────────────────────────────────────────────────────────────

private func monoFont(_ size: CGFloat, weight: Font.Weight = .bold) -> Font {
    .system(size: size, weight: weight, design: .monospaced)
}

// ──────────────────────────────────────────────────────────────────────
// RegistrationDot — the status ● mark. Filled disc, optional crosshair ring.
// ──────────────────────────────────────────────────────────────────────

struct RegistrationDot: View {
    var tone: FaffTone = .green
    var size: CGFloat = 9
    var ring: Bool = false

    var body: some View {
        if ring {
            ZStack {
                Circle().stroke(tone.color, lineWidth: 1)
                Circle().fill(tone.color).padding(3)
            }
            .frame(width: size + 6, height: size + 6)
        } else {
            Circle().fill(tone.color).frame(width: size, height: size)
        }
    }
}

// ──────────────────────────────────────────────────────────────────────
// FaffBracket — the [ EASY ] motif. Brackets tone-colored; label is ink.
// ──────────────────────────────────────────────────────────────────────

struct FaffBracket: View {
    let text: String
    var tone: FaffTone = .mute
    var size: CGFloat = 11
    var labelTone: FaffTone? = nil   // nil → ink

    init(_ text: String, tone: FaffTone = .mute, size: CGFloat = 11, labelTone: FaffTone? = nil) {
        self.text = text
        self.tone = tone
        self.size = size
        self.labelTone = labelTone
    }

    var body: some View {
        HStack(spacing: 6) {
            Text("[").font(.body(size + 3, weight: .regular)).foregroundStyle(tone.color)
            Text(text.uppercased())
                .font(.label(size)).tracking(1.4)
                .foregroundStyle(labelTone?.color ?? Theme.ink)
            Text("]").font(.body(size + 3, weight: .regular)).foregroundStyle(tone.color)
        }
    }
}

// ──────────────────────────────────────────────────────────────────────
// Barcode — variable-width bars. Doubles as a progress bar: `fill` (0..1)
// colors the leading fraction with `tone`, the remainder is faint ink.
// Deterministic widths from `seed` so the "code" is stable across renders.
// ──────────────────────────────────────────────────────────────────────

struct Barcode: View {
    var bars: Int = 34
    var fill: Double = 1
    var tone: FaffTone = .mute
    var height: CGFloat = 26
    var seed: Int = 7
    var gap: CGFloat = 2

    private var widths: [Int] {
        var out: [Int] = []
        var s = seed * 9301 + 49297
        for _ in 0..<bars {
            s = (s * 9301 + 49297) % 233280
            let r = Double(s) / 233280.0
            out.append(r < 0.5 ? 1 : (r < 0.82 ? 2 : 3))
        }
        return out
    }

    var body: some View {
        let ws = widths
        let total = ws.reduce(0, +)
        let filledCount = Int((max(0, min(1, fill)) * Double(bars)).rounded())
        let color = tone == .mute ? Theme.ink.opacity(0.55) : tone.color
        Canvas { ctx, size in
            let gapTotal = gap * CGFloat(max(0, bars - 1))
            let unit = (size.width - gapTotal) / CGFloat(max(1, total))
            var x: CGFloat = 0
            for i in 0..<ws.count {
                let w = unit * CGFloat(ws[i])
                let rect = CGRect(x: x, y: 0, width: max(0.5, w), height: size.height)
                let c = i < filledCount ? color : Theme.ink.opacity(0.12)
                ctx.fill(Path(rect), with: .color(c))
                x += w + gap
            }
        }
        .frame(height: height)
    }
}

// ──────────────────────────────────────────────────────────────────────
// ActivityTrace — EKG-style polyline (HR / pace / elevation / structure).
// Accepts raw numbers; auto-scales to the box. Optional area fill + baseline.
// ──────────────────────────────────────────────────────────────────────

struct ActivityTrace: View {
    let points: [Double]
    var tone: FaffTone = .mute
    var height: CGFloat = 36
    var strokeWidth: CGFloat = 1.5
    var fillArea: Bool = false
    var baseline: Bool = false

    var body: some View {
        let color = tone == .none ? Theme.mute : tone.color
        Canvas { ctx, size in
            let pad = strokeWidth + 1
            guard points.count >= 2 else {
                var l = Path()
                l.move(to: CGPoint(x: 0, y: size.height / 2))
                l.addLine(to: CGPoint(x: size.width, y: size.height / 2))
                ctx.stroke(l, with: .color(Theme.ink.opacity(0.12)), lineWidth: 1)
                return
            }
            let mn = points.min()!, mx = points.max()!
            let span = (mx - mn) == 0 ? 1 : (mx - mn)
            let stepX = size.width / CGFloat(points.count - 1)
            func pt(_ i: Int) -> CGPoint {
                let x = CGFloat(i) * stepX
                let y = pad + (1 - CGFloat((points[i] - mn) / span)) * (size.height - pad * 2)
                return CGPoint(x: x, y: y)
            }
            if baseline {
                var b = Path()
                b.move(to: CGPoint(x: 0, y: size.height - pad))
                b.addLine(to: CGPoint(x: size.width, y: size.height - pad))
                ctx.stroke(b, with: .color(Theme.ink.opacity(0.12)), lineWidth: 1)
            }
            var line = Path()
            for i in points.indices {
                i == 0 ? line.move(to: pt(i)) : line.addLine(to: pt(i))
            }
            if fillArea {
                var area = line
                area.addLine(to: CGPoint(x: size.width, y: size.height))
                area.addLine(to: CGPoint(x: 0, y: size.height))
                area.closeSubpath()
                ctx.fill(area, with: .color(color.opacity(0.12)))
            }
            ctx.stroke(line, with: .color(color),
                       style: StrokeStyle(lineWidth: strokeWidth, lineCap: .round, lineJoin: .round))
        }
        .frame(height: height)
    }
}

// ──────────────────────────────────────────────────────────────────────
// IntensityBar — segmented workout-structure strip (warm/work/rec/cool).
// Each segment is duration-weighted; tone keys off the phase type. A
// graphic, honest read of the prescribed session shape.
// ──────────────────────────────────────────────────────────────────────

struct IntensitySegment: Identifiable {
    let id = UUID()
    let weight: Double   // duration or distance share
    let tone: FaffTone
    let emphatic: Bool   // work reps render solid; warm/cool render faint
}

struct IntensityBar: View {
    let segments: [IntensitySegment]
    var height: CGFloat = 8
    var gap: CGFloat = 2

    var body: some View {
        GeometryReader { geo in
            let total = max(0.0001, segments.reduce(0) { $0 + $1.weight })
            let gapTotal = gap * CGFloat(max(0, segments.count - 1))
            let usable = geo.size.width - gapTotal
            HStack(spacing: gap) {
                ForEach(segments) { seg in
                    RoundedRectangle(cornerRadius: 2)
                        .fill(seg.emphatic ? seg.tone.color : seg.tone.color.opacity(0.22))
                        .frame(width: max(2, usable * CGFloat(seg.weight / total)))
                }
            }
        }
        .frame(height: height)
    }
}

// ──────────────────────────────────────────────────────────────────────
// VerticalStripNumber — big ticket-stub number with a stacked caps label.
// ──────────────────────────────────────────────────────────────────────

struct VerticalStripNumber: View {
    let value: String
    var label: String? = nil
    var tone: FaffTone = .mute
    var size: CGFloat = 64

    var body: some View {
        VStack(spacing: 4) {
            Text(value)
                .font(Theme.Font.display(size))
                .tracking(Theme.Font.tracking(for: size))
                .monospacedDigit()
                .foregroundStyle(tone == .mute || tone == .none ? Theme.ink : tone.color)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            if let label { SpecLabel(label, size: 9) }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────
// Stamp — mono caps micro-stamp (version / page / T-N). Outlined chip.
// ──────────────────────────────────────────────────────────────────────

struct Stamp: View {
    let text: String
    var tone: FaffTone = .mute
    var filled: Bool = false

    init(_ text: String, tone: FaffTone = .mute, filled: Bool = false) {
        self.text = text
        self.tone = tone
        self.filled = filled
    }

    var body: some View {
        let color = tone == .mute ? Theme.mute : tone.color
        Text(text.uppercased())
            .font(monoFont(9.5))
            .tracking(1.4)
            .foregroundStyle(filled ? Theme.bgPage : color)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(filled ? color : Color.clear)
            .overlay(
                RoundedRectangle(cornerRadius: 3)
                    .stroke(filled ? Color.clear : (tone == .mute ? Theme.line : color), lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 3))
    }
}

// ──────────────────────────────────────────────────────────────────────
// TickRule — a horizontal ruler hairline with periodic ticks. Divider.
// ──────────────────────────────────────────────────────────────────────

struct TickRule: View {
    var ticks: Int = 24
    var height: CGFloat = 7

    var body: some View {
        Canvas { ctx, size in
            // baseline
            var base = Path()
            base.move(to: CGPoint(x: 0, y: size.height))
            base.addLine(to: CGPoint(x: size.width, y: size.height))
            ctx.stroke(base, with: .color(Theme.ink.opacity(0.14)), lineWidth: 1)
            // ticks
            guard ticks > 1 else { return }
            let step = size.width / CGFloat(ticks - 1)
            for i in 0..<ticks {
                let x = CGFloat(i) * step
                let h = i % 4 == 0 ? size.height : size.height / 2
                var t = Path()
                t.move(to: CGPoint(x: x, y: size.height - h))
                t.addLine(to: CGPoint(x: x, y: size.height))
                ctx.stroke(t, with: .color(Theme.ink.opacity(0.24)), lineWidth: 1)
            }
        }
        .frame(height: height)
    }
}

// ──────────────────────────────────────────────────────────────────────
// SpecRow — THE chip-killer. A dense, ruled data row: caps label on the
// left, a big tabular value (+ unit) on the right, optional meta + status
// dot. Hairline rule on top. This replaces every rounded body "tile".
// ──────────────────────────────────────────────────────────────────────

struct SpecRow: View {
    let label: String
    let value: String
    var unit: String? = nil
    var meta: String? = nil
    var tone: FaffTone = .mute
    var dot: FaffTone? = nil
    var valueSize: CGFloat = 22
    var showRule: Bool = true

    var body: some View {
        VStack(spacing: 0) {
            if showRule {
                Rectangle().fill(Theme.line).frame(height: 1)
            }
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                SpecLabel(label, size: 10)
                    .frame(width: 64, alignment: .leading)

                if let meta {
                    Text(meta)
                        .font(.body(11, weight: .medium))
                        .foregroundStyle(Theme.mute)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }

                Spacer(minLength: 8)

                HStack(alignment: .firstTextBaseline, spacing: 3) {
                    Text(value)
                        .font(Theme.Font.display(valueSize))
                        .tracking(Theme.Font.tracking(for: valueSize))
                        .monospacedDigit()
                        .foregroundStyle(tone == .mute || tone == .none ? Theme.ink : tone.color)
                        .lineLimit(1)
                    if let unit {
                        Text(unit)
                            .font(.label(9))
                            .foregroundStyle(Theme.mute)
                    }
                }
                if let dot {
                    RegistrationDot(tone: dot, size: 7)
                }
            }
            .padding(.vertical, 11)
        }
    }
}

// ──────────────────────────────────────────────────────────────────────
// CropFrame — corner registration marks (L brackets) around a region.
// Applied as a modifier so any view can wear the crop marks.
// ──────────────────────────────────────────────────────────────────────

private struct CropMarks: View {
    var arm: CGFloat
    var thickness: CGFloat
    var color: Color

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            Path { p in
                // top-left
                p.move(to: CGPoint(x: 0, y: arm));   p.addLine(to: CGPoint(x: 0, y: 0)); p.addLine(to: CGPoint(x: arm, y: 0))
                // top-right
                p.move(to: CGPoint(x: w - arm, y: 0)); p.addLine(to: CGPoint(x: w, y: 0)); p.addLine(to: CGPoint(x: w, y: arm))
                // bottom-left
                p.move(to: CGPoint(x: 0, y: h - arm)); p.addLine(to: CGPoint(x: 0, y: h)); p.addLine(to: CGPoint(x: arm, y: h))
                // bottom-right
                p.move(to: CGPoint(x: w - arm, y: h)); p.addLine(to: CGPoint(x: w, y: h)); p.addLine(to: CGPoint(x: w, y: h - arm))
            }
            .stroke(color, lineWidth: thickness)
        }
        .allowsHitTesting(false)
    }
}

extension View {
    /// Wrap the view in floating corner registration marks.
    func cropFrame(tone: FaffTone = .mute, arm: CGFloat = 11, thickness: CGFloat = 1.5, inset: CGFloat = 0) -> some View {
        let color = tone == .mute ? Theme.ink.opacity(0.24) : tone.color
        return self.overlay(
            CropMarks(arm: arm, thickness: thickness, color: color).padding(-inset)
        )
    }
}
