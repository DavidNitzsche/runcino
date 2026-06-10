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
    var onExplainACWR: (() -> Void)? = nil

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
    /// 2026-06-02 round 59 · matches design_handoff_today_postrun_pivot
    /// Status-forward variant · NO glass card box, all on the mesh:
    ///   RECOVERING (big band word, band-tinted)
    ///   "Sleep tonight matters. HRV down 18ms…" (one-liner)
    ///   64/100 score on left, projection curve on right (one row)
    ///   NOW · 12 AM · ≈7 AM ✓ ticks
    var sectionA: some View {
        Button(action: onTapRecoveryCard) {
            VStack(alignment: .leading, spacing: 10) {
                // 2026-06-02 round 60 · band word now SOLID WHITE.
                // Earlier rounds tinted by band (recovering = amber etc) ·
                // amber-on-warm-mesh washed out. White carries on any
                // time-of-day palette. The WORD itself ("DRAGGING") +
                // score communicate the band; color is no longer the
                // semantic signal.
                Text(bandWordUpper)
                    .font(.display(42, weight: .bold))
                    .tracking(-0.5)
                    .foregroundStyle(Color.white)
                // Engine one-liner directly below
                if let line = brief?.oneLine, !line.isEmpty {
                    Text(line)
                        .font(.body(13.5, weight: .semibold))
                        .foregroundStyle(Color.white)
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.bottom, 2)
                }
                // Score row · projection curve + axis ticks retired
                // round 69. David: "I dont think the line graph is
                // actually tracking anything or moving." The curve was
                // a static cubic bezier that didn't tie to any
                // backend time-series · backend only ships per-pillar
                // projectedReturnISO + fullyRecoveredAt (single
                // timestamps, not a track). Removing visual decoration
                // that isn't earning its space. Band word + score +
                // pillar bars below carry the read-out.
                HStack(alignment: .firstTextBaseline, spacing: 1) {
                    Text("\(brief?.score ?? 0)")
                        .font(.display(44, weight: .bold))
                        .foregroundStyle(Color.white)
                    Text("/100")
                        .font(.body(13, weight: .semibold))
                        .foregroundStyle(Color.white)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
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

    // 2026-06-02 round 60 · bandColor helper retired. Recovery panel
    // now renders solid white across the time-of-day mesh palettes
    // (sunrise / day / dusk / night). Band semantics are carried by
    // the WORD ("DRAGGING") + the score + the engine one-liner;
    // color isn't the channel. See round-60 doctrine note above the
    // band-word text.

    // 2026-06-03 round 69 · projectionCurve helper retired alongside
    // the curve render in sectionA. Re-introduce only when backend
    // ships a real time-series of recovery scores (currently it
    // only ships the LATEST projected-return timestamp per pillar +
    // top-level fullyRecoveredAt · neither is enough to plot a curve).
}

// MARK: - Section B · Recovery pillars

private extension TodayRecoveryPanel {
    /// 2026-06-02 round 59 · per design · single-row layout:
    ///   LABEL ── amber bar ── subtext (right-aligned)
    /// Drops the boxed/glassy container, drops the two-line stack.
    /// Bars use amber fill (Sleep/HRV/RHR/Fueling all read as "in
    /// progress" while recovery completes · amber is the right tone).
    var sectionB: some View {
        // 2026-06-03 round 69 · FUELING pillar retired. David:
        // "Fueling - carb window closed is not wired to anything. If we
        // cant make this purposeful, then remove." The pillar surfaced
        // backend's windowState ("open" / "closing" / "closed" / etc.)
        // but iPhone copy was generic status reporting — no behavior
        // change, no log-nutrition CTA, no actionable signal. Drop to
        // 3 physiologically-authoritative pillars (Sleep / HRV / RHR).
        // Re-introduce when there's a real fueling action loop (e.g.
        // tap-to-log nutrition + window-aware coach voice).
        VStack(spacing: 14) {
            pillarRow(label: "SLEEP TARGET",
                      pct: sleepTargetPct,
                      subtext: sleepTargetSubtext)
            pillarRow(label: "HRV REBOUND",
                      pct: brief?.pillars.hrvRebound.pct ?? 0,
                      subtext: hrvSubtext)
            pillarRow(label: "RHR DELTA",
                      pct: brief?.pillars.rhrDelta.pct ?? 0,
                      subtext: rhrSubtext)
        }
    }

    @ViewBuilder
    func pillarRow(label: String, pct: Int, subtext: String) -> some View {
        HStack(spacing: 11) {
            Text(label)
                .font(.body(10, weight: .extraBold)).tracking(1.0)
                .foregroundStyle(Color.white)
                .frame(width: 112, alignment: .leading)
            // Amber left-anchored fill bar
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.10))
                    Capsule()
                        .fill(Color.white)
                        .frame(width: geo.size.width * CGFloat(min(100, max(0, pct))) / 100)
                }
            }
            .frame(height: 6)
            Text(subtext)
                .font(.body(10.5, weight: .semibold))
                .foregroundStyle(Color.white)
                .lineLimit(1).minimumScaleFactor(0.85)
                .frame(maxWidth: 140, alignment: .trailing)
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
                // 2026-06-02 round 60 · all input-cell values solid white.
                // Semantic info (band label / arc direction) carried by
                // the value text + glyph, not color.
                inputCell(value: "+\(t.tssDelta)", label: "TSS", tone: Color.white)
                middot
                inputCell(
                    value: "\(t.formDelta >= 0 ? "+" : "")\(t.formDelta)",
                    label: t.formBandLabel.isEmpty ? "FORM" : t.formBandLabel,
                    tone: Color.white
                )
                middot
                inputCell(
                    value: arcGlyph(t.arcDirection),
                    label: "ARC",
                    tone: Color.white
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
                .font(.body(15, weight: .bold))
                .foregroundStyle(tone)
            Text(label)
                .font(.body(8.5, weight: .extraBold)).tracking(0.8)
                .foregroundStyle(Color.white)
        }
        .frame(maxWidth: .infinity)
    }

    var middot: some View {
        Text("·")
            .font(.body(13, weight: .bold))
            .foregroundStyle(Color.white)
    }

    // 2026-06-02 round 60 · formTone + arcTone retired alongside
    // bandColor. Form-band label + arc glyph carry the meaning;
    // color reads as solid white.

    func arcGlyph(_ dir: String) -> String {
        switch dir.lowercased() {
        case "on_track": return "↗"
        case "flat":     return "→"
        case "slipping": return "↘"
        default:         return "→"
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
                .foregroundStyle(Color.white)
            Text(big)
                .font(.display(17, weight: .bold))
                .foregroundStyle(Color.white)
                .lineLimit(1).minimumScaleFactor(0.7)
            Text(sub)
                .font(.body(10.5, weight: .semibold))
                .foregroundStyle(Color.white)
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
        // 2026-06-02 round 66 · prefer backend's top-level
        // fullyRecoveredAt (LATEST of all pillar returns: typically
        // HRV rebound, but RHR-baseline wins on high-RHR + mild-HRV
        // days). Falls back to per-pillar HRV-rebound math when the
        // top-level field is absent (older backend payloads).
        if let iso = brief?.fullyRecoveredAt, !iso.isEmpty,
           let t = shortTime(iso: iso) { return t }
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
                .foregroundStyle(Color.white)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text("\(Int((brief?.weekProgress.bankedMi ?? 0).rounded()))")
                    .font(.display(17, weight: .bold))
                    .foregroundStyle(Color.white)
                Text("/ \(Int((brief?.weekProgress.targetMi ?? 0).rounded()))")
                    .font(.body(11, weight: .semibold))
                    .foregroundStyle(Color.white)
            }
            // 7-dot row
            HStack(spacing: 3) {
                let dots = brief?.weekProgress.dots ?? 0
                ForEach(0..<7, id: \.self) { i in
                    Circle()
                        .fill(i < dots ? Color.white : Color.white.opacity(0.18))
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
                .foregroundStyle(Color.white)
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
                    .foregroundStyle(Color.white)
            } else {
                Text("—")
                    .font(.display(17, weight: .bold))
                    .foregroundStyle(Color.white)
                Text("done")
                    .font(.body(10.5, weight: .semibold))
                    .foregroundStyle(Color.white)
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
                .foregroundStyle(Color.white)
            Text(v > 0 ? String(format: "%.2f", v) : "—")
                .font(.display(17, weight: .bold))
                .foregroundStyle(Color.white)
            // Solid color capsule + white text · max contrast.
            Text(badge.label)
                .font(.body(10, weight: .extraBold)).tracking(1.0)
                .foregroundStyle(Color.white)
                .padding(.horizontal, 8).padding(.vertical, 3)
                .background(badge.color, in: Capsule())
            if let explain = onExplainACWR {
                Button(action: explain) {
                    HStack(spacing: 3) {
                        Text("WHY")
                            .font(.body(9.5, weight: .semibold))
                            .foregroundStyle(Theme.dist)
                        Image(systemName: "chevron.right")
                            .font(.system(size: 8, weight: .bold))
                            .foregroundStyle(Theme.dist)
                    }
                }
                .buttonStyle(.plain)
                .padding(.top, 2)
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

    // 2026-06-03 round 70 · ACWR badge contrast bump.
    // David: "this OK is hard to read." Earlier rounds used the
    // semantic color as text + a 0.16-opacity capsule of the same
    // hue · teal-on-teal was muddy against the glass tile. New
    // treatment: SOLID semantic-color capsule + WHITE text on top.
    // Same pattern as the win-line pill (white inside, semantic
    // outside) but inverted color stack — works because the badge
    // is a tiny chip on its own glass background, can carry the
    // saturated color without dominating.
    func acwrBadge(_ raw: String) -> (label: String, color: Color) {
        switch raw.uppercased() {
        case "OK":      return ("OK", Color(hex: 0x3FB6B0))     // saturated teal
        case "WATCH":   return ("WATCH", Color(hex: 0xE0A23A))  // amber
        case "RAMP_UP": return ("RAMP", Color(hex: 0xD6483F))   // coral
        default:        return ("OK", Color(hex: 0x3FB6B0))
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
