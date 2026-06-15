//
//  HowItWentPanel.swift
//
//  Post-run "How it went" panel · per-run-type analysis surface.
//  Replaces the generic 3-row HEART RATE / PACE / CADENCE comparison
//  with a panel that swaps by run type:
//
//    easy / recovery → AEROBIC STAMP
//      · KEPT IT EASY gauge (Z1+Z2 share)
//      · HEART RATE DRIFT (first half vs second half)
//      · Mile pace footprint (taller = faster, with avg line)
//
//    long → THE LONG
//      · Three thirds cards (First / Middle / Last) with pace + HR
//      · Last third tinted green/amber by finish character
//      · HEART RATE DRIFT (first third vs final third)
//
//    tempo / threshold → THE TEMPO
//      · TEMPO BLOCK header with target vs actual cmpBar
//      · HR thirds (early / middle / late)
//      · WU / CD row
//
//    intervals → THE REPS
//      · Target chip + WU → reps (diverging bars) → recoveries → CD rail
//
//  Plus a SignatureRow (one-line summary) underneath every panel.
//
//  Design ref: /Users/david/Downloads/design_handoff_iphone_postrun
//  Web parity: web-v2/components/faff-app/views/TodayView.tsx
//  (EasyPanel / LongPanel / TempoPanel — same data shapes).
//
//  Status colors (light-surface · semantic, already in palette):
//    good   = #1F9A6F
//    warn   = #BD7A16
//    bad    = #D6483F
//    track  = #ECE5D7
//
//  Created 2026-06-02 round 49.
//

import SwiftUI

// MARK: - Public entry point

/// Per-run-type "How it went" panel. Swaps body by effort. Returns
/// EmptyView for race / rest (no analysis to render).
struct HowItWentPanel: View {
    let effort: FaffEffort
    let detail: RunDetail?
    let accent: Color
    var onMesh: Bool = false

    var body: some View {
        switch effort {
        case .easy, .recovery:
            AerobicStampPanel(detail: detail, accent: accent, isRecovery: effort == .recovery, onMesh: onMesh)
        case .long:
            ThePLongPanel(detail: detail, accent: accent, onMesh: onMesh)
        case .tempo:
            TempoPostPanel(detail: detail, accent: accent, onMesh: onMesh)
        case .intervals:
            RepsPostPanel(detail: detail, accent: accent, onMesh: onMesh)
        case .race, .rest:
            EmptyView()
        }
    }
}

/// Signature row · pinned summary below the panel. One stat the runner
/// reads at-a-glance: "AVG HR · 128 bpm · −17 vs threshold".
struct HowItWentSignature: View {
    let label: String
    let value: String
    let valueUnit: String?
    let delta: String?
    let deltaTone: HIWTone
    var onMesh: Bool = false

    private var primaryText: Color { onMesh ? Color.white : Color(hex: 0x14110D) }
    private var mutedText: Color { onMesh ? Color.white.opacity(0.78) : Color(hex: 0x736C61) }

    var body: some View {
        HStack(spacing: 0) {
            Text(label)
                .font(.body(11, weight: .extraBold)).tracking(0.6)
                .foregroundStyle(mutedText)
                .lineLimit(1)
            Spacer(minLength: 8)
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text(value)
                    .font(.display(18, weight: .bold))
                    .foregroundStyle(primaryText)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                if let unit = valueUnit, !unit.isEmpty {
                    Text(unit)
                        .font(.body(10, weight: .semibold))
                        .foregroundStyle(mutedText)
                        .lineLimit(1)
                }
                if let d = delta, !d.isEmpty {
                    Text(d)
                        .font(.body(10.5, weight: .extraBold))
                        .foregroundStyle(deltaTone.color)
                        .padding(.leading, 3)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
            }
            .layoutPriority(1)
        }
        // 2026-06-02 round 65 · added lineLimit(1) + minimumScaleFactor
        // to value + delta and put a positive layoutPriority on the
        // right-side stack. The delta string "+0 vs threshold" (or worse,
        // "+12 vs threshold" with longer label) was sizing the row wider
        // than the viewport. A vertical ScrollView surfaces that
        // overflow as a HORIZONTAL pan · whole page slid left/right.
        // Now the right cluster wins the priority battle and shrinks
        // (vs the label getting truncated), keeping the row at viewport
        // width and killing the rogue horizontal scroll.
    }
}

/// Tone for status indicators (gauge fills, third backgrounds, bar fills,
/// delta tint). Matches the locked semantic palette.
enum HIWTone {
    case good, warn, bad, neutral

    var color: Color {
        switch self {
        case .good:    return Color(hex: 0x1F9A6F)
        case .warn:    return Color(hex: 0xBD7A16)
        case .bad:     return Color(hex: 0xD6483F)
        case .neutral: return Color(hex: 0x6B6358)
        }
    }
}

// MARK: - Shared helpers

/// Section eyebrow ("AEROBIC STAMP" / "THE LONG" / "THE TEMPO" / "THE REPS")
/// + optional trailing meta ("16 MI" / "4 MI BLOCK" / "TARGET 2:58/800m").
private struct HIWHead: View {
    let title: String
    let meta: String?
    var onMesh: Bool = false

    private var primaryText: Color { onMesh ? Color.white : Color(hex: 0x14110D) }
    private var mutedText: Color { onMesh ? Color.white.opacity(0.78) : Color(hex: 0x736C61) }

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .font(.body(15, weight: .bold)).tracking(0.4)
                .foregroundStyle(primaryText)
            Spacer(minLength: 8)
            if let m = meta, !m.isEmpty {
                Text(m)
                    .font(.body(10, weight: .extraBold)).tracking(0.8)
                    .foregroundStyle(mutedText)
            }
        }
        // Negative · counters the panel's VStack(spacing: 18) so the section
        // header tucks ~10pt above its first row (was floating 30pt above
        // AEROBIC STAMP → KEPT IT EASY; 2pt still read as 20). David 2026-06-15.
        .padding(.bottom, -8)
    }
}

/// Inner section label · "HEART RATE DRIFT" / "MILE PACE" / "HR ACROSS THE BLOCK".
/// Optional trailing tag with semantic color ("STAYED FLAT" / "STRONG FINISH" /
/// "LATE FADE").
private struct HIWSectionHead: View {
    let label: String
    let tag: String?
    let tagTone: HIWTone?
    var onMesh: Bool = false

    private var mutedText: Color { onMesh ? Color.white.opacity(0.78) : Color(hex: 0x736C61) }

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .font(.body(11, weight: .extraBold)).tracking(0.6)
                .foregroundStyle(mutedText)
            Spacer(minLength: 6)
            if let t = tag, !t.isEmpty {
                Text(t)
                    .font(.body(9.5, weight: .extraBold)).tracking(1)
                    .foregroundStyle((tagTone ?? .neutral).color)
            }
        }
    }
}

/// Two-bar HR drift row · "FIRST HALF" / "SECOND HALF" with a track
/// bar (HR mapped from 120-170 bpm window) + the bpm readout.
private struct DriftRow: View {
    let label: String
    let bpm: Int
    let accent: Color
    let darker: Bool
    var onMesh: Bool = false

    private var primaryText: Color { onMesh ? Color.white : Color(hex: 0x14110D) }
    private var mutedText: Color { onMesh ? Color.white.opacity(0.78) : Color(hex: 0x736C61) }
    private var dividerColor: Color { onMesh ? Color.white.opacity(0.18) : Color(hex: 0xEEE7DA) }

    var body: some View {
        HStack(spacing: 11) {
            Text(label)
                .font(.body(9.5, weight: .extraBold)).tracking(0.6)
                .foregroundStyle(mutedText)
                .frame(width: 84, alignment: .leading)
            GeometryReader { geo in
                let pct = max(0.06, min(1.0, Double(bpm - 120) / 50.0))
                let w = geo.size.width
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 6).fill(dividerColor)
                    RoundedRectangle(cornerRadius: 6)
                        .fill(darker ? accent.opacity(0.86) : accent)
                        .frame(width: w * pct)
                }
            }
            .frame(height: 11)
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text("\(bpm)")
                    .font(.display(16, weight: .bold))
                    .foregroundStyle(primaryText)
                Text("bpm")
                    .font(.body(9, weight: .semibold))
                    .foregroundStyle(mutedText)
            }
            .frame(width: 62, alignment: .trailing)
        }
    }
}

/// Thirds card · "FIRST 5 / 7:50 / 146 ♥" style. Tinted good/warn
/// when tone is set; neutral cream-card otherwise.
private struct ThirdCard: View {
    let label: String
    let big: String
    let sub: String
    let tone: HIWTone
    var onMesh: Bool = false

    private var primaryText: Color { onMesh ? Color.white : Color(hex: 0x14110D) }
    private var mutedText: Color { onMesh ? Color.white.opacity(0.78) : Color(hex: 0x736C61) }
    private var subtleText: Color { onMesh ? Color.white.opacity(0.55) : Color(hex: 0xA39A8C) }
    private var dividerColor: Color { onMesh ? Color.white.opacity(0.18) : Color(hex: 0xEEE7DA) }

    var body: some View {
        VStack(spacing: 8) {
            Text(label)
                .font(.body(8.5, weight: .extraBold)).tracking(0.6)
                .foregroundStyle(mutedText)
            Text(big)
                .font(.display(20, weight: .bold))
                .foregroundStyle(tone == .neutral ? primaryText : tone.color)
            Text(sub)
                .font(.body(11, weight: .bold))
                .foregroundStyle(tone == .neutral ? subtleText : tone.color.opacity(0.85))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(thirdBg, in: RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(thirdBorder, lineWidth: 1)
        )
    }

    private var thirdBg: Color {
        switch tone {
        case .good: return onMesh ? Color(hex: 0x1F9A6F).opacity(0.18) : Color(hex: 0x1F9A6F).opacity(0.10)
        case .warn: return onMesh ? Color(hex: 0xBD7A16).opacity(0.18) : Color(hex: 0xBD7A16).opacity(0.10)
        case .bad:  return onMesh ? Color(hex: 0xD6483F).opacity(0.18) : Color(hex: 0xD6483F).opacity(0.10)
        case .neutral: return onMesh ? Color.white.opacity(0.10) : Color(hex: 0xF6EFE2)
        }
    }
    private var thirdBorder: Color {
        switch tone {
        case .good: return Color(hex: 0x1F9A6F).opacity(0.38)
        case .warn: return Color(hex: 0xBD7A16).opacity(0.40)
        case .bad:  return Color(hex: 0xD6483F).opacity(0.36)
        case .neutral: return dividerColor
        }
    }
}

/// Mile-pace footprint · vertical bars · taller = faster. Dashed
/// average reference line + mile-number ticks below.
private struct PaceFootprint: View {
    let secondsPerMile: [Int]
    let avgSecondsPerMile: Int
    let accent: Color
    var onMesh: Bool = false

    private var sectionBg: Color { onMesh ? Color.clear : Color.white }
    private var mutedText: Color { onMesh ? Color.white.opacity(0.78) : Color(hex: 0x736C61) }
    private var subtleText: Color { onMesh ? Color.white.opacity(0.55) : Color(hex: 0xA39A8C) }

    var body: some View {
        let all = secondsPerMile + [avgSecondsPerMile]
        let mn = max(1, all.min() ?? 0)
        let mx = max(mn + 1, all.max() ?? mn + 1)
        let rng = max(1, mx - mn)
        let H: (Int) -> Double = { s in
            0.30 + Double(mx - s) / Double(rng) * 0.64
        }
        return VStack(spacing: 6) {
            ZStack(alignment: .topLeading) {
                GeometryReader { geo in
                    let h = geo.size.height
                    HStack(alignment: .bottom, spacing: 5) {
                        ForEach(Array(secondsPerMile.enumerated()), id: \.offset) { _, s in
                            RoundedRectangle(cornerRadius: 3)
                                .fill(LinearGradient(
                                    colors: [accent.opacity(0.86), accent],
                                    startPoint: .top, endPoint: .bottom))
                                .frame(height: max(5, h * H(s)))
                        }
                    }
                    let avgY = h * (1 - H(avgSecondsPerMile))
                    ZStack(alignment: .leading) {
                        Path { p in
                            p.move(to: CGPoint(x: 0, y: avgY))
                            p.addLine(to: CGPoint(x: geo.size.width, y: avgY))
                        }
                        .stroke(subtleText, style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                        // Readable chip · the old `sectionBg` was Color.clear on
                        // the mesh, so the white "8:46 avg" sat directly on the
                        // green bars (unreadable · David 2026-06-15). Solid
                        // contrast pill instead.
                        Text(formatPace(avgSecondsPerMile) + " avg")
                            .font(.body(9, weight: .extraBold)).tracking(0.2)
                            .foregroundStyle(onMesh ? Color.white : Color(hex: 0x14110D))
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(
                                Capsule().fill(onMesh ? Color(hex: 0x0A0C10).opacity(0.78)
                                                      : Color.white.opacity(0.92))
                            )
                            .position(x: geo.size.width - 32, y: max(9, avgY))
                    }
                }
                .frame(height: 56)
            }
            HStack(spacing: 5) {
                ForEach(0..<secondsPerMile.count, id: \.self) { i in
                    Text("\(i + 1)")
                        .font(.body(9, weight: .bold))
                        .foregroundStyle(subtleText)
                        .frame(maxWidth: .infinity)
                }
            }
        }
    }
}

/// Centre-anchored comparison bar · target = centre tick, faster→right
/// (green), slower→left (amber).
private struct CmpBar: View {
    let actualSec: Int
    let goalSec: Int
    let maxDev: Int
    var onMesh: Bool = false

    private var primaryText: Color { onMesh ? Color.white : Color(hex: 0x14110D) }
    private var mutedText: Color { onMesh ? Color.white.opacity(0.78) : Color(hex: 0x736C61) }
    private var dividerColor: Color { onMesh ? Color.white.opacity(0.18) : Color(hex: 0xEEE7DA) }

    var body: some View {
        let d = actualSec - goalSec
        let tone: HIWTone = d > 0 ? .warn : (d < 0 ? .good : .neutral)
        let mag = max(0.05, min(1.0, Double(abs(d)) / Double(max(1, maxDev)))) * 0.5
        return VStack(spacing: 7) {
            GeometryReader { geo in
                let w = geo.size.width
                ZStack {
                    RoundedRectangle(cornerRadius: 6).fill(dividerColor)
                        .frame(height: 12)
                    if abs(d) > 0 {
                        let xStart: Double = d > 0 ? 0.5 - mag : 0.5
                        RoundedRectangle(cornerRadius: 3)
                            .fill(tone.color)
                            .frame(width: w * mag, height: 10)
                            .offset(x: w * xStart - w / 2 + w * mag / 2, y: 0)
                    } else {
                        RoundedRectangle(cornerRadius: 3)
                            .fill(primaryText)
                            .frame(width: w * 0.06, height: 10)
                    }
                    // Centre tick
                    Rectangle()
                        .fill(primaryText)
                        .frame(width: 2, height: 16)
                }
            }
            .frame(height: 16)
            HStack {
                Text("◂ SLOWER")
                    .font(.body(8, weight: .extraBold)).tracking(1)
                    .foregroundStyle(Color(hex: 0xBD7A16))
                Spacer()
                Text("TARGET")
                    .font(.body(8, weight: .extraBold)).tracking(1)
                    .foregroundStyle(mutedText)
                Spacer()
                Text("FASTER ▸")
                    .font(.body(8, weight: .extraBold)).tracking(1)
                    .foregroundStyle(Color(hex: 0x1F9A6F))
            }
        }
    }
}

// MARK: - AEROBIC STAMP (easy / recovery)

private struct AerobicStampPanel: View {
    let detail: RunDetail?
    let accent: Color
    let isRecovery: Bool
    var onMesh: Bool = false

    private var primaryText: Color { onMesh ? Color.white : Color(hex: 0x14110D) }
    private var mutedText: Color { onMesh ? Color.white.opacity(0.78) : Color(hex: 0x736C61) }
    private var dividerColor: Color { onMesh ? Color.white.opacity(0.18) : Color(hex: 0xEEE7DA) }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HIWHead(title: "AEROBIC STAMP", meta: nil, onMesh: onMesh)
            keptItEasyGauge
            heartRateDriftSection
            milePaceSection
            signature
        }
    }

    private var easyShare: Int? {
        guard let z = detail?.hrZonePcts else { return nil }
        let z1 = Int((z.z1 ?? 0).rounded())
        let z2 = Int((z.z2 ?? 0).rounded())
        return z1 + z2
    }

    private var easyTone: HIWTone {
        guard let p = easyShare else { return .neutral }
        if p >= 85 { return .good }
        if p >= 70 { return .warn }
        return .bad
    }

    @ViewBuilder
    private var keptItEasyGauge: some View {
        if let pct = easyShare {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .firstTextBaseline) {
                    Text(isRecovery ? "KEPT IT EASY" : "KEPT IT EASY")
                        .font(.body(11, weight: .extraBold)).tracking(0.6)
                        .foregroundStyle(mutedText)
                    Spacer()
                    Text("\(pct)%")
                        .font(.display(20, weight: .bold))
                        .foregroundStyle(primaryText)
                }
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 7).fill(dividerColor)
                        RoundedRectangle(cornerRadius: 7)
                            .fill(easyTone.color)
                            .frame(width: geo.size.width * Double(pct) / 100.0)
                    }
                }
                .frame(height: 13)
                Text(isRecovery ? "Z1 share of moving time" : "Z1–Z2 share of moving time")
                    .font(.body(11, weight: .semibold))
                    .foregroundStyle(mutedText)
            }
        }
    }

    private var splitsWithHr: [RunSplit] {
        (detail?.splits ?? []).filter { ($0.hr ?? 0) > 0 }
    }
    private var firstHalfHr: Int? {
        let arr = splitsWithHr
        guard !arr.isEmpty else { return nil }
        let mid = max(1, arr.count / 2)
        let slice = Array(arr.prefix(mid))
        guard !slice.isEmpty else { return nil }
        let sum = slice.reduce(0) { $0 + ($1.hr ?? 0) }
        return sum / slice.count
    }
    private var secondHalfHr: Int? {
        let arr = splitsWithHr
        guard !arr.isEmpty else { return nil }
        let mid = arr.count / 2
        let slice = Array(arr.suffix(arr.count - mid))
        guard !slice.isEmpty else { return nil }
        let sum = slice.reduce(0) { $0 + ($1.hr ?? 0) }
        return sum / slice.count
    }
    private var hrDelta: Int? {
        guard let a = firstHalfHr, let b = secondHalfHr else { return nil }
        return b - a
    }
    private var driftBand: (text: String, tone: HIWTone)? {
        guard let d = hrDelta else { return nil }
        let abs_d = abs(d)
        if abs_d <= 4 { return ("STAYED FLAT", .good) }
        if abs_d <= 8 { return ("SOME DRIFT", .warn) }
        return ("LATE FADE", .bad)
    }

    @ViewBuilder
    private var heartRateDriftSection: some View {
        if let first = firstHalfHr, let second = secondHalfHr {
            VStack(alignment: .leading, spacing: 10) {
                HIWSectionHead(label: "Heart rate drift",
                               tag: driftBand?.text, tagTone: driftBand?.tone, onMesh: onMesh)
                DriftRow(label: "FIRST HALF", bpm: first, accent: accent, darker: false, onMesh: onMesh)
                DriftRow(label: "SECOND HALF", bpm: second, accent: accent, darker: true, onMesh: onMesh)
                if let d = hrDelta {
                    let sign = d > 0 ? "+\(d)" : "\(d)"
                    let tone: HIWTone = driftBand?.tone ?? .neutral
                    HStack(alignment: .top, spacing: 4) {
                        Text("Heart rose ")
                            .font(.body(12, weight: .medium))
                            .foregroundStyle(mutedText)
                        Text("\(sign) bpm")
                            .font(.body(13, weight: .bold))
                            .foregroundStyle(tone.color)
                        Text(" across the run.")
                            .font(.body(12, weight: .medium))
                            .foregroundStyle(mutedText)
                        Spacer(minLength: 0)
                    }
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 4)
                }
            }
        }
    }

    private var paceSecondsPerMile: [Int] {
        (detail?.splits ?? []).compactMap { s in
            parsePaceSec(s.pace)
        }
    }
    private var avgPaceSec: Int? {
        let arr = paceSecondsPerMile
        guard !arr.isEmpty else { return nil }
        return arr.reduce(0, +) / arr.count
    }

    @ViewBuilder
    private var milePaceSection: some View {
        let secs = paceSecondsPerMile
        if let avg = avgPaceSec, secs.count >= 2 {
            VStack(alignment: .leading, spacing: 12) {
                Text("MILE PACE")
                    .font(.body(11, weight: .extraBold)).tracking(0.6)
                    .foregroundStyle(mutedText)
                PaceFootprint(secondsPerMile: secs, avgSecondsPerMile: avg, accent: accent, onMesh: onMesh)
                if let mn = secs.min(), let mx = secs.max() {
                    let spread = mx - mn
                    Text("\(secs.count) mi · fastest \(formatPace(mn)) · slowest \(formatPace(mx)) · \(spread)s spread")
                        .font(.body(11, weight: .semibold))
                        .foregroundStyle(mutedText)
                }
            }
        }
    }

    @ViewBuilder
    private var signature: some View {
        if let avg = detail?.hr_avg {
            let lthrish = 162
            let delta = avg - lthrish
            let tone: HIWTone = abs(delta) <= 10 ? .good : (delta < 0 ? .good : .warn)
            HowItWentSignature(
                label: "AVG HR",
                value: "\(avg)",
                valueUnit: "bpm",
                delta: "\(delta >= 0 ? "+" : "")\(delta) vs threshold",
                deltaTone: tone,
                onMesh: onMesh
            )
        }
    }
}

// MARK: - THE LONG

private struct ThePLongPanel: View {
    let detail: RunDetail?
    let accent: Color
    var onMesh: Bool = false

    private var thirds: (first: [RunSplit], middle: [RunSplit], last: [RunSplit])? {
        let arr = detail?.splits ?? []
        guard arr.count >= 3 else { return nil }
        let n = arr.count
        let firstEnd = max(1, n / 3)
        let lastStart = n - max(1, n / 3)
        let first = Array(arr.prefix(firstEnd))
        let middle = Array(arr[firstEnd..<lastStart])
        let last = Array(arr.suffix(n - lastStart))
        return (first, middle, last)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HIWHead(title: "THE LONG", meta: distanceLabel, onMesh: onMesh)
            if let t = thirds { thirdsRow(t) }
            heartRateDriftSection
            signature
        }
    }

    private var distanceLabel: String? {
        guard let mi = detail?.distance_mi, mi > 0 else { return nil }
        let n = Int(mi.rounded())
        return "\(n) MI"
    }

    @ViewBuilder
    private func thirdsRow(_ t: (first: [RunSplit], middle: [RunSplit], last: [RunSplit])) -> some View {
        let firstPace = avgPace(t.first)
        let middlePace = avgPace(t.middle)
        let lastPace = avgPace(t.last)
        let firstHr = avgHr(t.first)
        let middleHr = avgHr(t.middle)
        let lastHr = avgHr(t.last)
        // Negative-split detection · last third faster (smaller sec/mi)
        // than first third by 5%+ → strong finish (green); slower by 5%+
        // → late fade (amber); else neutral.
        let lastTone: HIWTone = {
            guard let f = firstPace, let l = lastPace, f > 0 else { return .neutral }
            let pct = Double(l - f) / Double(f)
            if pct <= -0.03 { return .good }
            if pct >= 0.05 { return .warn }
            return .neutral
        }()
        HStack(spacing: 8) {
            ThirdCard(
                label: "FIRST \(t.first.count)",
                big: firstPace.map(formatPace) ?? "—",
                sub: firstHr.map { "\($0) ♥" } ?? "—",
                tone: .neutral,
                onMesh: onMesh
            )
            ThirdCard(
                label: "MIDDLE \(t.middle.count)",
                big: middlePace.map(formatPace) ?? "—",
                sub: middleHr.map { "\($0) ♥" } ?? "—",
                tone: .neutral,
                onMesh: onMesh
            )
            ThirdCard(
                label: "LAST \(t.last.count)",
                big: lastPace.map(formatPace) ?? "—",
                sub: lastHr.map { "\($0) ♥" } ?? "—",
                tone: lastTone,
                onMesh: onMesh
            )
        }
    }

    @ViewBuilder
    private var heartRateDriftSection: some View {
        if let t = thirds {
            let firstHr = avgHr(t.first)
            let lastHr = avgHr(t.last)
            if let f = firstHr, let l = lastHr {
                let delta = l - f
                let lastPaceFaster: Bool = {
                    guard let fp = avgPace(t.first), let lp = avgPace(t.last) else { return false }
                    return lp < fp
                }()
                let tag: (String, HIWTone) = {
                    if lastPaceFaster && delta <= 10 { return ("STRONG FINISH", .good) }
                    if delta <= 6 { return ("STAYED FLAT", .good) }
                    if delta <= 12 { return ("SOME DRIFT", .warn) }
                    return ("LATE FADE", .bad)
                }()
                VStack(alignment: .leading, spacing: 10) {
                    HIWSectionHead(label: "Heart rate drift", tag: tag.0, tagTone: tag.1, onMesh: onMesh)
                    DriftRow(label: "FIRST THIRD", bpm: f, accent: accent, darker: false, onMesh: onMesh)
                    DriftRow(label: "FINAL THIRD", bpm: l, accent: accent, darker: true, onMesh: onMesh)
                }
            }
        }
    }

    @ViewBuilder
    private var signature: some View {
        if let pace = detail?.pace, !pace.isEmpty {
            let neg: Bool = {
                guard let t = thirds, let fp = avgPace(t.first), let lp = avgPace(t.last) else { return false }
                return lp < fp
            }()
            HowItWentSignature(
                label: "AVG PACE",
                value: pace,
                valueUnit: "/mi",
                delta: neg ? "neg split" : nil,
                deltaTone: .good,
                onMesh: onMesh
            )
        }
    }

    private func avgPace(_ arr: [RunSplit]) -> Int? {
        let secs = arr.compactMap { parsePaceSec($0.pace) }
        guard !secs.isEmpty else { return nil }
        return secs.reduce(0, +) / secs.count
    }
    private func avgHr(_ arr: [RunSplit]) -> Int? {
        let hrs = arr.compactMap { $0.hr }.filter { $0 > 0 }
        guard !hrs.isEmpty else { return nil }
        return hrs.reduce(0, +) / hrs.count
    }
}

// MARK: - THE TEMPO

private struct TempoPostPanel: View {
    let detail: RunDetail?
    let accent: Color
    var onMesh: Bool = false

    private var primaryText: Color { onMesh ? Color.white : Color(hex: 0x14110D) }
    private var mutedText: Color { onMesh ? Color.white.opacity(0.78) : Color(hex: 0x736C61) }
    private var subtleText: Color { onMesh ? Color.white.opacity(0.55) : Color(hex: 0xA39A8C) }

    /// The single "work" phase = the tempo block. Picked from
    /// phase_breakdown when present.
    private var workPhase: PhaseBreakdown? {
        (detail?.phase_breakdown ?? []).first(where: { $0.type.lowercased() == "work" })
    }
    private var warmupPhase: PhaseBreakdown? {
        (detail?.phase_breakdown ?? []).first(where: { $0.type.lowercased() == "warmup" })
    }
    private var cooldownPhase: PhaseBreakdown? {
        (detail?.phase_breakdown ?? []).first(where: { $0.type.lowercased() == "cooldown" })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HIWHead(title: "THE TEMPO", meta: blockMeta, onMesh: onMesh)
            tempoBlock
            hrAcrossBlock
            warmupCooldownRow
            signature
        }
    }

    private var blockMeta: String? {
        guard let w = workPhase, let mi = w.actual_distance_mi, mi > 0 else { return nil }
        let m = mi.truncatingRemainder(dividingBy: 1) == 0
            ? String(format: "%.0f", mi)
            : String(format: "%.1f", mi)
        return "\(m) MI BLOCK"
    }

    @ViewBuilder
    private var tempoBlock: some View {
        if let w = workPhase, let actualSec = parsePaceSec(w.actual_pace) {
            let specPace: Int? = detail?.planned_spec?.rep_pace_s_per_mi.map { Int($0) }
            let targetSec = parsePaceSec(w.target_pace) ?? specPace ?? actualSec
            VStack(alignment: .leading, spacing: 11) {
                HStack(alignment: .firstTextBaseline) {
                    Text("TEMPO BLOCK")
                        .font(.body(11, weight: .extraBold)).tracking(0.6)
                        .foregroundStyle(primaryText)
                    Spacer()
                    HStack(alignment: .firstTextBaseline, spacing: 3) {
                        Text(formatPace(actualSec))
                            .font(.display(20, weight: .bold))
                            .foregroundStyle(primaryText)
                        Text("/mi")
                            .font(.body(10, weight: .semibold))
                            .foregroundStyle(mutedText)
                    }
                }
                HStack {
                    Text("TARGET \(formatPace(targetSec))/mi")
                        .font(.body(10.5, weight: .bold))
                        .foregroundStyle(mutedText)
                    Spacer()
                    if let hr = w.avg_hr {
                        Text("\(hr) bpm")
                            .font(.body(10.5, weight: .bold))
                            .foregroundStyle(mutedText)
                    }
                }
                CmpBar(actualSec: actualSec, goalSec: targetSec, maxDev: 10, onMesh: onMesh)
            }
        }
    }

    @ViewBuilder
    private var hrAcrossBlock: some View {
        if let w = workPhase, w.actual_distance_mi ?? 0 > 1.5 {
            // Approximate HR thirds from splits within the work-phase
            // window. Falls back to single avg when we can't separate.
            let splits = (detail?.splits ?? []).filter { ($0.hr ?? 0) > 0 }
            if splits.count >= 3 {
                let n = splits.count
                let firstEnd = max(1, n / 3)
                let lastStart = n - max(1, n / 3)
                let first = Array(splits.prefix(firstEnd))
                let mid = Array(splits[firstEnd..<lastStart])
                let last = Array(splits.suffix(n - lastStart))
                let fhr = avgHr(first), mhr = avgHr(mid), lhr = avgHr(last)
                VStack(alignment: .leading, spacing: 11) {
                    Text("HR ACROSS THE BLOCK")
                        .font(.body(11, weight: .extraBold)).tracking(0.6)
                        .foregroundStyle(mutedText)
                    HStack(spacing: 8) {
                        ThirdCard(label: "EARLY",  big: fhr.map { "\($0)" } ?? "—", sub: "bpm", tone: .neutral, onMesh: onMesh)
                        ThirdCard(label: "MIDDLE", big: mhr.map { "\($0)" } ?? "—", sub: "bpm", tone: .neutral, onMesh: onMesh)
                        ThirdCard(label: "LATE",   big: lhr.map { "\($0)" } ?? "—", sub: "bpm", tone: .neutral, onMesh: onMesh)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var warmupCooldownRow: some View {
        if warmupPhase != nil || cooldownPhase != nil {
            HStack(alignment: .top) {
                if let w = warmupPhase {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("WARM-UP")
                            .font(.body(9, weight: .extraBold)).tracking(0.8)
                            .foregroundStyle(mutedText)
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text(distLabel(w.actual_distance_mi) ?? "—")
                                .font(.body(12, weight: .semibold))
                                .foregroundStyle(mutedText)
                            Text("·")
                                .foregroundStyle(subtleText)
                            Text(w.actual_pace ?? "—")
                                .font(.body(13, weight: .bold))
                                .foregroundStyle(primaryText)
                        }
                    }
                }
                Spacer()
                if let c = cooldownPhase {
                    VStack(alignment: .trailing, spacing: 3) {
                        Text("COOL-DOWN")
                            .font(.body(9, weight: .extraBold)).tracking(0.8)
                            .foregroundStyle(mutedText)
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text(distLabel(c.actual_distance_mi) ?? "—")
                                .font(.body(12, weight: .semibold))
                                .foregroundStyle(mutedText)
                            Text("·")
                                .foregroundStyle(subtleText)
                            Text(c.actual_pace ?? "—")
                                .font(.body(13, weight: .bold))
                                .foregroundStyle(primaryText)
                        }
                    }
                }
            }
            .padding(.top, 2)
        }
    }

    @ViewBuilder
    private var signature: some View {
        if let w = workPhase, let actualSec = parsePaceSec(w.actual_pace) {
            let target = parsePaceSec(w.target_pace) ?? actualSec
            let delta = actualSec - target
            let tone: HIWTone = abs(delta) <= 3 ? .good : (delta > 0 ? .warn : .good)
            let deltaStr: String? = {
                if delta == 0 { return "on target" }
                let sign = delta > 0 ? "+\(delta)" : "\(delta)"
                return "\(sign) vs goal"
            }()
            HowItWentSignature(
                label: "TEMPO",
                value: formatPace(actualSec),
                valueUnit: "/mi",
                delta: deltaStr,
                deltaTone: tone,
                onMesh: onMesh
            )
        }
    }

    private func avgHr(_ arr: [RunSplit]) -> Int? {
        let hrs = arr.compactMap { $0.hr }.filter { $0 > 0 }
        guard !hrs.isEmpty else { return nil }
        return hrs.reduce(0, +) / hrs.count
    }
    private func distLabel(_ mi: Double?) -> String? {
        guard let m = mi, m > 0 else { return nil }
        return m.truncatingRemainder(dividingBy: 1) == 0
            ? String(format: "%.0f mi", m)
            : String(format: "%.1f mi", m)
    }
}

// MARK: - THE REPS

private struct RepsPostPanel: View {
    let detail: RunDetail?
    let accent: Color
    var onMesh: Bool = false

    private var sectionBg: Color { onMesh ? Color.white.opacity(0.10) : Color(hex: 0xF6EFE2) }
    private var primaryText: Color { onMesh ? Color.white : Color(hex: 0x14110D) }
    private var mutedText: Color { onMesh ? Color.white.opacity(0.78) : Color(hex: 0x736C61) }
    private var dividerColor: Color { onMesh ? Color.white.opacity(0.18) : Color(hex: 0xEEE7DA) }

    private var workReps: [PhaseBreakdown] {
        (detail?.phase_breakdown ?? []).filter { $0.type.lowercased() == "work" }
    }
    private var recoveries: [PhaseBreakdown] {
        (detail?.phase_breakdown ?? []).filter { $0.type.lowercased() == "recovery" }
    }
    private var warmup: PhaseBreakdown? {
        (detail?.phase_breakdown ?? []).first(where: { $0.type.lowercased() == "warmup" })
    }
    private var cooldown: PhaseBreakdown? {
        (detail?.phase_breakdown ?? []).first(where: { $0.type.lowercased() == "cooldown" })
    }
    private var targetSec: Int? {
        if let s = parsePaceSec(workReps.first?.target_pace) { return s }
        return detail?.planned_spec?.rep_pace_s_per_mi.map { Int($0) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HIWHead(title: "THE REPS", meta: targetMeta, onMesh: onMesh)
            axisLegend
            rail
            signature
        }
    }

    private var targetMeta: String? {
        guard let t = targetSec else { return nil }
        return "TARGET \(formatPace(t))/mi"
    }

    private var axisLegend: some View {
        HStack {
            Text("◂ SLOWER")
                .font(.body(8, weight: .extraBold)).tracking(1)
                .foregroundStyle(Color(hex: 0xBD7A16))
            Spacer()
            Text("TARGET")
                .font(.body(8, weight: .extraBold)).tracking(1)
                .foregroundStyle(mutedText)
            Spacer()
            Text("FASTER ▸")
                .font(.body(8, weight: .extraBold)).tracking(1)
                .foregroundStyle(Color(hex: 0x1F9A6F))
        }
        .padding(.top, -4)
    }

    @ViewBuilder
    private var rail: some View {
        VStack(spacing: 8) {
            if let w = warmup {
                phaseRow(name: "WARM-UP", phase: w)
            }
            ForEach(Array(workReps.enumerated()), id: \.offset) { idx, rep in
                repRow(idx: idx, rep: rep)
                if idx < workReps.count - 1 {
                    recoveryRow(idx: idx)
                }
            }
            if let c = cooldown {
                phaseRow(name: "COOL-DOWN", phase: c)
            }
        }
    }

    private func phaseRow(name: String, phase: PhaseBreakdown) -> some View {
        HStack(spacing: 10) {
            Circle().fill(Color(hex: 0x7BC8B8)).frame(width: 6, height: 6)
            Text(name)
                .font(.body(10.5, weight: .extraBold)).tracking(0.6)
                .foregroundStyle(primaryText)
            if let mi = phase.actual_distance_mi, mi > 0 {
                Text("· \(formatMi(mi)) mi")
                    .font(.body(10.5, weight: .semibold))
                    .foregroundStyle(mutedText)
            }
            Spacer(minLength: 0)
            if let pace = phase.actual_pace {
                HStack(alignment: .firstTextBaseline, spacing: 2) {
                    Text(pace)
                        .font(.body(13, weight: .bold))
                        .foregroundStyle(primaryText)
                    Text("/mi")
                        .font(.body(9, weight: .semibold))
                        .foregroundStyle(mutedText)
                }
            }
        }
        .padding(.horizontal, 10).padding(.vertical, 7)
        .background(sectionBg,
                    in: RoundedRectangle(cornerRadius: 10))
    }

    private func recoveryRow(idx: Int) -> some View {
        let rec = idx < recoveries.count ? recoveries[idx] : nil
        let durLabel: String = {
            if let r = rec, let s = r.actual_duration_sec, s > 0 {
                let m = s / 60, secs = s % 60
                return secs == 0 ? "\(m):00" : "\(m):\(String(format: "%02d", secs))"
            }
            return "—"
        }()
        return HStack(spacing: 10) {
            Color.clear.frame(width: 6, height: 6)
            Text("\(durLabel) jog · recovery")
                .font(.body(10, weight: .semibold))
                .foregroundStyle(mutedText)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10).padding(.vertical, 4)
    }

    private func repRow(idx: Int, rep: PhaseBreakdown) -> some View {
        let actualSec = parsePaceSec(rep.actual_pace) ?? (targetSec ?? 0)
        let goalSec = targetSec ?? actualSec
        let delta = actualSec - goalSec
        let tone: HIWTone = delta > 0 ? .warn : (delta < 0 ? .good : .neutral)
        let deltaStr: String = {
            if delta == 0 { return "±0" }
            return delta > 0 ? "+\(delta)" : "\(delta)"
        }()
        return HStack(spacing: 10) {
            VStack(spacing: 0) {
                Text("\(idx + 1)")
                    .font(.body(15, weight: .bold))
                    .foregroundStyle(primaryText)
                Text("REP")
                    .font(.body(7.5, weight: .extraBold)).tracking(0.6)
                    .foregroundStyle(mutedText)
            }
            .frame(width: 30)
            GeometryReader { geo in
                let w = geo.size.width
                let mag = max(0.04, min(1.0, Double(abs(delta)) / 6.0)) * 0.5
                ZStack {
                    RoundedRectangle(cornerRadius: 6).fill(dividerColor)
                        .frame(height: 12)
                    if abs(delta) > 0 {
                        let xStart: Double = delta > 0 ? 0.5 - mag : 0.5
                        RoundedRectangle(cornerRadius: 3)
                            .fill(tone.color)
                            .frame(width: w * mag, height: 10)
                            .offset(x: w * xStart - w / 2 + w * mag / 2, y: 0)
                    } else {
                        RoundedRectangle(cornerRadius: 3)
                            .fill(primaryText)
                            .frame(width: w * 0.06, height: 10)
                    }
                    Rectangle()
                        .fill(primaryText)
                        .frame(width: 2, height: 16)
                }
            }
            .frame(height: 16)
            VStack(alignment: .trailing, spacing: 1) {
                Text(rep.actual_pace ?? "—")
                    .font(.body(13, weight: .bold))
                    .foregroundStyle(primaryText)
                Text(deltaStr)
                    .font(.body(10, weight: .extraBold))
                    .foregroundStyle(tone.color)
            }
            .frame(width: 64, alignment: .trailing)
        }
        .padding(.horizontal, 10).padding(.vertical, 7)
    }

    @ViewBuilder
    private var signature: some View {
        if let t = targetSec, !workReps.isEmpty {
            let secs = workReps.compactMap { parsePaceSec($0.actual_pace) }
            if !secs.isEmpty {
                let avgWork = secs.reduce(0, +) / secs.count
                let delta = avgWork - t
                let tone: HIWTone = abs(delta) <= 3 ? .good : (delta > 0 ? .warn : .good)
                let deltaStr: String = {
                    if delta == 0 { return "on target" }
                    let sign = delta > 0 ? "+\(delta)" : "\(delta)"
                    return "\(sign) vs goal"
                }()
                HowItWentSignature(
                    label: "AVG WORK",
                    value: formatPace(avgWork),
                    valueUnit: "/mi",
                    delta: deltaStr,
                    deltaTone: tone,
                    onMesh: onMesh
                )
            }
        }
    }
}

// MARK: - Utilities

private func parsePaceSec(_ s: String?) -> Int? {
    guard let s = s, !s.isEmpty else { return nil }
    let parts = s.split(separator: ":").compactMap { Int($0) }
    guard parts.count == 2 else { return nil }
    return parts[0] * 60 + parts[1]
}

private func formatPace(_ secondsPerMile: Int) -> String {
    let m = secondsPerMile / 60
    let s = secondsPerMile % 60
    return "\(m):\(String(format: "%02d", s))"
}

private func formatMi(_ m: Double) -> String {
    return m.truncatingRemainder(dividingBy: 1) == 0
        ? String(format: "%.0f", m)
        : String(format: "%.1f", m)
}
