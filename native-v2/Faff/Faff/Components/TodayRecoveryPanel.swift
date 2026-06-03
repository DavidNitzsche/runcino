//
//  TodayRecoveryPanel.swift
//
//  Post-run pivot · top-section recovery view. Replaces the morning
//  readiness ring + Sleep/HRV/RHR/LOAD pillars + 6 chip tiles when
//  today's run is done. Week strip + workout swipe-up sheet unchanged
//  (per design scope · separate handoff covers the sheet's per-type
//  HIW panels).
//
//  5 sections top → bottom:
//    A · Recovery card · Status-forward variant (big band word ·
//        score · 24h projection curve from NOW → ~7AM)
//    B · Recovery pillars · Sleep target · HRV rebound · RHR delta ·
//        Fueling. Left-anchored % fills (not the morning's diverging
//        bars · these represent % of 24h recovery complete)
//    C · Training input strip · "+92 TSS · Form -4 → OPTIMAL · ↗ ARC"
//    D · NEXT HARD + FULLY RECOVERED tile pair
//    E · Week-to-date · Week MI dots / Long-run / ACWR
//
//  Design ref: /Users/david/Downloads/design_handoff_today_postrun_pivot
//  Execution brief: designs/briefs/today-postrun-pivot-execution.md
//
//  Created 2026-06-02 round 58.
//

import SwiftUI

// MARK: - Public entry

struct TodayRecoveryPanel: View {
    let brief: RecoveryBrief?
    var onTapRecoveryCard: () -> Void = {}

    var body: some View {
        VStack(spacing: 18) {
            sectionA
            sectionB
            sectionC
            sectionD
            sectionE
        }
    }

    // Cold-state placeholder · backend hasn't shipped or no data yet
    private var hasData: Bool { brief != nil }
}

// MARK: - Section A · Recovery card (Status-forward variant)

private extension TodayRecoveryPanel {
    var sectionA: some View {
        Button(action: onTapRecoveryCard) {
            VStack(alignment: .leading, spacing: 12) {
                // Big band word hero
                HStack(alignment: .firstTextBaseline) {
                    Text(bandWordUpper)
                        .font(.display(36, weight: .bold))
                        .tracking(-0.5)
                        .foregroundStyle(bandColor)
                    Spacer(minLength: 8)
                    // Score
                    VStack(alignment: .trailing, spacing: 0) {
                        Text("\(brief?.score ?? 0)")
                            .font(.display(28, weight: .bold))
                            .foregroundStyle(Color.white)
                        Text("RECOVERY")
                            .font(.body(8, weight: .extraBold)).tracking(1.2)
                            .foregroundStyle(Color.white.opacity(0.55))
                    }
                }
                // 24h projection curve · placeholder when no data
                projectionCurve
                    .frame(height: 38)
                // Engine one-liner
                if let line = brief?.oneLine, !line.isEmpty {
                    Text(line)
                        .font(.body(13, weight: .semibold))
                        .foregroundStyle(Color.white.opacity(0.78))
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                // "View full read ›" affordance
                HStack(spacing: 4) {
                    Text("View full read")
                        .font(.body(11, weight: .semibold)).tracking(0.2)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 9, weight: .bold))
                }
                .foregroundStyle(Color.white.opacity(0.55))
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(Theme.Glass.line, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    var bandWordUpper: String {
        switch (brief?.band ?? "recovering").lowercased() {
        case "recovered":  return "RECOVERED"
        case "recovering": return "RECOVERING"
        case "dragging":   return "DRAGGING"
        case "depleted":   return "DEPLETED"
        default:           return "RECOVERING"
        }
    }

    var bandColor: Color {
        switch (brief?.band ?? "").lowercased() {
        case "recovered":  return Color(hex: 0x3FB6B0)   // teal
        case "recovering": return Color(hex: 0x7BC8B8)   // muted teal
        case "dragging":   return Color(hex: 0xE0A23A)   // amber
        case "depleted":   return Color(hex: 0xD6483F)   // coral
        default:           return Color(hex: 0x7BC8B8)
        }
    }

    @ViewBuilder
    var projectionCurve: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            ZStack {
                // Axis baseline
                Path { p in
                    p.move(to: CGPoint(x: 0, y: h - 1))
                    p.addLine(to: CGPoint(x: w, y: h - 1))
                }
                .stroke(Color.white.opacity(0.12), lineWidth: 1)
                // Curve · score (now) rising to ~95 at "+24h"
                Path { p in
                    let startY = h * (1 - CGFloat(brief?.score ?? 0) / 100)
                    let endY = h * 0.08
                    p.move(to: CGPoint(x: 0, y: startY))
                    p.addCurve(
                        to: CGPoint(x: w, y: endY),
                        control1: CGPoint(x: w * 0.4, y: startY - h * 0.1),
                        control2: CGPoint(x: w * 0.7, y: endY + h * 0.15)
                    )
                }
                .stroke(bandColor.opacity(0.85), style: StrokeStyle(lineWidth: 2.2, lineCap: .round))
                // NOW dot
                Circle()
                    .fill(bandColor)
                    .frame(width: 7, height: 7)
                    .position(x: 4, y: h * (1 - CGFloat(brief?.score ?? 0) / 100))
                // +24h dot
                Circle()
                    .fill(bandColor.opacity(0.35))
                    .frame(width: 6, height: 6)
                    .position(x: w - 4, y: h * 0.08)
                // Tick labels
                Text("NOW")
                    .font(.body(7.5, weight: .extraBold)).tracking(0.8)
                    .foregroundStyle(Color.white.opacity(0.45))
                    .position(x: 14, y: h + 6)
                Text("~7 AM")
                    .font(.body(7.5, weight: .extraBold)).tracking(0.8)
                    .foregroundStyle(Color.white.opacity(0.45))
                    .position(x: w - 18, y: h + 6)
            }
        }
    }
}

// MARK: - Section B · Recovery pillars

private extension TodayRecoveryPanel {
    var sectionB: some View {
        VStack(spacing: 11) {
            pillarRow(label: "SLEEP TARGET",
                      pct: sleepTargetPct,
                      subtext: sleepTargetSubtext)
            pillarRow(label: "HRV REBOUND",
                      pct: brief?.pillars.hrvRebound.pct ?? 0,
                      subtext: hrvSubtext)
            pillarRow(label: "RHR DELTA",
                      pct: brief?.pillars.rhrDelta.pct ?? 0,
                      subtext: rhrSubtext)
            pillarRow(label: "FUELING",
                      pct: brief?.pillars.fueling.pct ?? 0,
                      subtext: fuelingSubtext)
        }
        .padding(.horizontal, 2)
    }

    @ViewBuilder
    func pillarRow(label: String, pct: Int, subtext: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(label)
                    .font(.body(10, weight: .extraBold)).tracking(1.2)
                    .foregroundStyle(Color.white.opacity(0.7))
                Spacer()
                Text(subtext)
                    .font(.body(10, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.62))
            }
            // Left-anchored % fill (NOT diverging from baseline · this
            // represents % of 24h recovery complete per the design)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 4).fill(Color.white.opacity(0.12))
                    RoundedRectangle(cornerRadius: 4)
                        .fill(Color.white.opacity(0.78))
                        .frame(width: geo.size.width * CGFloat(min(100, max(0, pct))) / 100)
                }
            }
            .frame(height: 7)
        }
    }

    var sleepTargetPct: Int {
        // Render as % of 10h goal so the bar moves with the target.
        guard let h = brief?.pillars.sleepTarget.hoursTarget, h > 0 else { return 0 }
        return min(100, Int((h / 10.0 * 100).rounded()))
    }

    var sleepTargetSubtext: String {
        guard let p = brief?.pillars.sleepTarget, p.hoursTarget > 0 else { return "" }
        let h = formatHours(p.hoursTarget)
        if p.hoursDelta > 0.05 {
            let min = Int((p.hoursDelta * 60).rounded())
            return "\(h) tonight · +\(min)min"
        }
        return "\(h) tonight"
    }

    var hrvSubtext: String {
        guard let p = brief?.pillars.hrvRebound, !p.projectedReturnISO.isEmpty else { return "" }
        let timeStr = shortTime(iso: p.projectedReturnISO) ?? "—"
        return "back to base ≈ \(timeStr)"
    }

    var rhrSubtext: String {
        guard let p = brief?.pillars.rhrDelta, p.currentBpm > 0 else { return "" }
        let delta = p.currentBpm - p.baselineBpm
        let sign = delta >= 0 ? "+" : ""
        return "\(sign)\(delta) bpm · proj \(p.projectedMorningBpm) by morning"
    }

    var fuelingSubtext: String {
        guard let p = brief?.pillars.fueling else { return "" }
        switch p.windowState.lowercased() {
        case "open":    return "carb window open"
        case "closing": return "carb window in \(p.minutesRemaining ?? 0) min"
        case "logged":  return "logged"
        case "missed":  return "window missed"
        default:        return "carb window closed"
        }
    }
}

// MARK: - Section C · Training input strip

private extension TodayRecoveryPanel {
    @ViewBuilder
    var sectionC: some View {
        if let t = brief?.trainingInput {
            HStack(alignment: .center, spacing: 0) {
                // +TSS
                inputCell(value: "+\(t.tssDelta)", label: "TSS",
                          tone: t.tssDelta > 0 ? Color(hex: 0x7BC8B8) : Color.white)
                middot
                // Form delta + band
                inputCell(
                    value: "\(t.formDelta >= 0 ? "+" : "")\(t.formDelta)",
                    label: t.formBandLabel.isEmpty ? "FORM" : t.formBandLabel,
                    tone: formTone(t.formBandLabel)
                )
                middot
                // Arc direction
                inputCell(
                    value: arcGlyph(t.arcDirection),
                    label: "ARC",
                    tone: arcTone(t.arcDirection)
                )
            }
            .padding(.horizontal, 14).padding(.vertical, 13)
            .frame(maxWidth: .infinity)
            .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(Theme.Glass.line, lineWidth: 1)
            )
        }
    }

    func inputCell(value: String, label: String, tone: Color) -> some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.display(15, weight: .bold))
                .foregroundStyle(tone)
            Text(label)
                .font(.body(8.5, weight: .extraBold)).tracking(0.8)
                .foregroundStyle(Color.white.opacity(0.55))
        }
        .frame(maxWidth: .infinity)
    }

    var middot: some View {
        Text("·")
            .font(.body(13, weight: .bold))
            .foregroundStyle(Color.white.opacity(0.3))
    }

    func formTone(_ band: String) -> Color {
        switch band.uppercased() {
        case "OPTIMAL":    return Color(hex: 0x7BC8B8)
        case "PRODUCTIVE": return Color(hex: 0x7BC8B8)
        case "OVERREACH":  return Color(hex: 0xE0A23A)
        case "FRESH":      return Color.white
        default:           return Color.white
        }
    }

    func arcGlyph(_ dir: String) -> String {
        switch dir.lowercased() {
        case "on_track": return "↗"
        case "flat":     return "→"
        case "slipping": return "↘"
        default:         return "→"
        }
    }

    func arcTone(_ dir: String) -> Color {
        switch dir.lowercased() {
        case "on_track": return Color(hex: 0x7BC8B8)
        case "flat":     return Color.white.opacity(0.85)
        case "slipping": return Color(hex: 0xE0A23A)
        default:         return Color.white
        }
    }
}

// MARK: - Section D · Next Hard + Fully Recovered

private extension TodayRecoveryPanel {
    var sectionD: some View {
        HStack(spacing: 11) {
            tileD(
                eyebrow: "NEXT HARD",
                big: brief?.nextHard.label.isEmpty == false
                    ? brief!.nextHard.label
                    : "—",
                sub: nextHardSub
            )
            tileD(
                eyebrow: "FULLY RECOVERED",
                big: fullyRecoveredBig,
                sub: fullyRecoveredSub
            )
        }
    }

    func tileD(eyebrow: String, big: String, sub: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(eyebrow)
                .font(.body(9, weight: .extraBold)).tracking(1.2)
                .foregroundStyle(Color.white.opacity(0.55))
            Text(big)
                .font(.display(17, weight: .bold))
                .foregroundStyle(Color.white)
                .lineLimit(1).minimumScaleFactor(0.7)
            Text(sub)
                .font(.body(10.5, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.62))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 13).padding(.vertical, 13)
        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(Theme.Glass.line, lineWidth: 1)
        )
    }

    var nextHardSub: String {
        guard let h = brief?.nextHard.hoursUntil, h > 0 else { return "" }
        if h < 36 { return "in \(h)h" }
        let days = (h + 12) / 24
        return "in \(days)d"
    }

    var fullyRecoveredBig: String {
        // Show projected return time from HRV rebound's
        // projectedReturnISO if present, else "—".
        guard let iso = brief?.pillars.hrvRebound.projectedReturnISO,
              let t = shortTime(iso: iso) else { return "—" }
        return t
    }

    var fullyRecoveredSub: String {
        guard let pct = brief?.pillars.hrvRebound.pct, pct > 0 else { return "" }
        return "HRV \(pct)% of baseline"
    }
}

// MARK: - Section E · Week-to-date

private extension TodayRecoveryPanel {
    var sectionE: some View {
        HStack(spacing: 11) {
            weekMiTile
            longRunTile
            acwrTile
        }
    }

    var weekMiTile: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("WEEK MI")
                .font(.body(9, weight: .extraBold)).tracking(1.2)
                .foregroundStyle(Color.white.opacity(0.55))
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text("\(Int((brief?.weekProgress.bankedMi ?? 0).rounded()))")
                    .font(.display(17, weight: .bold))
                    .foregroundStyle(Color.white)
                Text("/ \(Int((brief?.weekProgress.targetMi ?? 0).rounded()))")
                    .font(.body(11, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.55))
            }
            // 7-dot row
            HStack(spacing: 3) {
                let dots = brief?.weekProgress.dots ?? 0
                ForEach(0..<7, id: \.self) { i in
                    Circle()
                        .fill(i < dots ? Color.white.opacity(0.78) : Color.white.opacity(0.18))
                        .frame(width: 5, height: 5)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 13).padding(.vertical, 13)
        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(Theme.Glass.line, lineWidth: 1)
        )
    }

    var longRunTile: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("LONG-RUN")
                .font(.body(9, weight: .extraBold)).tracking(1.2)
                .foregroundStyle(Color.white.opacity(0.55))
            if let lr = brief?.weekProgress.longRun {
                let dayName = dayAbbrev(iso: lr.dateISO)
                let miStr = lr.mi.truncatingRemainder(dividingBy: 1) == 0
                    ? String(format: "%.0f", lr.mi)
                    : String(format: "%.1f", lr.mi)
                Text("\(dayName) · \(miStr)mi")
                    .font(.display(17, weight: .bold))
                    .foregroundStyle(Color.white)
                    .lineLimit(1).minimumScaleFactor(0.7)
                Text(lr.daysUntil == 0 ? "today" : (lr.daysUntil == 1 ? "tomorrow" : "in \(lr.daysUntil) days"))
                    .font(.body(10.5, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.62))
            } else {
                Text("—")
                    .font(.display(17, weight: .bold))
                    .foregroundStyle(Color.white.opacity(0.4))
                Text("done")
                    .font(.body(10.5, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.42))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 13).padding(.vertical, 13)
        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(Theme.Glass.line, lineWidth: 1)
        )
    }

    var acwrTile: some View {
        let v = brief?.weekProgress.acwr.value ?? 0
        let bandRaw = (brief?.weekProgress.acwr.band ?? "OK")
        let badge = acwrBadge(bandRaw)
        return VStack(alignment: .leading, spacing: 4) {
            Text("ACWR")
                .font(.body(9, weight: .extraBold)).tracking(1.2)
                .foregroundStyle(Color.white.opacity(0.55))
            Text(v > 0 ? String(format: "%.2f", v) : "—")
                .font(.display(17, weight: .bold))
                .foregroundStyle(Color.white)
            Text(badge.label)
                .font(.body(9.5, weight: .extraBold)).tracking(0.8)
                .foregroundStyle(badge.color)
                .padding(.horizontal, 6).padding(.vertical, 2)
                .background(badge.color.opacity(0.16), in: Capsule())
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 13).padding(.vertical, 13)
        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(Theme.Glass.line, lineWidth: 1)
        )
    }

    func acwrBadge(_ raw: String) -> (label: String, color: Color) {
        switch raw.uppercased() {
        case "OK":      return ("OK", Color(hex: 0x7BC8B8))
        case "WATCH":   return ("WATCH", Color(hex: 0xE0A23A))
        case "RAMP_UP": return ("RAMP", Color(hex: 0xD6483F))
        default:        return ("OK", Color(hex: 0x7BC8B8))
        }
    }
}

// MARK: - Date/time helpers

private func shortTime(iso: String) -> String? {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime]
    guard let d = f.date(from: iso) else {
        let f2 = ISO8601DateFormatter()
        f2.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let d2 = f2.date(from: iso) else { return nil }
        return formatHourMinute(d2)
    }
    return formatHourMinute(d)
}

private func formatHourMinute(_ d: Date) -> String {
    let df = DateFormatter()
    df.dateFormat = "h:mm a"
    return df.string(from: d)
}

private func dayAbbrev(iso: String) -> String {
    let parts = iso.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 3 else { return "—" }
    var c = DateComponents()
    c.year = parts[0]; c.month = parts[1]; c.day = parts[2]
    guard let d = Calendar.current.date(from: c) else { return "—" }
    let df = DateFormatter()
    df.dateFormat = "EEE"
    return df.string(from: d).uppercased()
}

private func formatHours(_ h: Double) -> String {
    if h.truncatingRemainder(dividingBy: 1) == 0 { return "\(Int(h))h" }
    return String(format: "%.1fh", h)
}
