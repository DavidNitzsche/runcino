//
//  TodayPreRunBodyV3.swift   (2026-06-01 round 7 · design package #3)
//
//  Pre-run sheet body for the redesigned Today screen. Replaces the
//  generic prescription/conditions stack that shipped in v2. Mirrors
//  the design handoff exactly:
//
//    1. Header eyebrow (MON · HARD · TODAY) + Oswald title
//    2. Stats trio · Distance / Target pace / Est time
//    3. EFFORT TARGET · Z1-Z5 gradient bar + marker bubble + zone labels
//    4. CONDITIONS & KIT · 2x2 (Forecast / Best window / Shoe / Fuel)
//    5. SESSION · segment list with accent ticks
//    6. CUE · italic coaching cue with [CUE] tag
//    7. THE PLAN · verdict + recap + HEART RATE / EFFORT / CADENCE targets
//    8. Skip this run footer
//
//  Reference: /Users/david/Downloads/design_handoff_today_redesign 3/
//             screenshots/02-today-prerun-detail.png
//

import SwiftUI

struct TodayPreRunBodyV3: View {
    let workout: WatchWorkout?
    let effort: FaffEffort
    let dowLabel: String        // "MON"
    let isToday: Bool           // drives "TODAY" vs "UPCOMING" tag
    let weather: WeatherBaseline?
    let shoeName: String?       // currently always "—" until backend wires
    let briefing: Briefing?
    let purpose: RunPurpose?
    let adaptation: CoachIntent?
    let onSkip: () -> Void
    let onShoeTap: (() -> Void)?

    private var accent: Color { effort.dot }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header                        // 1
            statsTrio                     // 2
            effortTargetBar               // 3
            conditionsKit                 // 4
            sessionList                   // 5
            cueLine                       // 6
            thePlan                       // 7
            skipFooter                    // 8
        }
    }

    // MARK: 1 · Header eyebrow + Oswald title

    private var header: some View {
        let typeTag = effort.effortLabel.uppercased()
        let dayTag = isToday ? "TODAY" : dowLabel.uppercased()
        return VStack(alignment: .leading, spacing: 6) {
            SpecLabel(
                text: "\(dayTag) · \(typeTag) · PLANNED",
                size: 10, tracking: 1.8,
                color: Color(hex: 0xA39A8C)
            )
            Text(workoutTitle.uppercased())
                .font(.display(46, weight: .bold))
                .tracking(-1.5)
                .foregroundStyle(Color(hex: 0x14110D))
                .lineLimit(2)
                .padding(.top, 2)
            // Optional adaptation banner · only when the plan was
            // adapted (intent exists). Reads "Adjusted from {original} ·
            // Restore" when backend ships the structured copy.
            if let adapt = adaptation {
                adaptationBanner(adapt)
                    .padding(.top, 10)
            }
        }
        .padding(.horizontal, 24).padding(.top, 18).padding(.bottom, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white)
        .overlay(separator, alignment: .bottom)
    }

    @ViewBuilder
    private func adaptationBanner(_ a: CoachIntent) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "arrow.triangle.2.circlepath")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(Color(hex: 0xC57700))
            Text(adaptationCopy(a))
                .font(.body(11.5, weight: .semibold))
                .foregroundStyle(Color(hex: 0x6B4F1F))
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 11).padding(.vertical, 8)
        .background(Color(hex: 0xFFF1D9), in: RoundedRectangle(cornerRadius: 10))
    }

    private func adaptationCopy(_ a: CoachIntent) -> String {
        if let d = a.detail, !d.isEmpty { return d.replacingOccurrences(of: "—", with: "·") }
        if !a.summary.isEmpty { return a.summary }
        return "Plan adapted"
    }

    private var workoutTitle: String {
        // Prefer the WatchWorkout name; fall back to effort.title.
        if let n = workout?.name, !n.isEmpty {
            return n
        }
        switch effort {
        case .recovery:  return "Recovery"
        case .easy:      return "Easy"
        case .long:      return "Long Run"
        case .tempo:     return "Tempo"
        case .intervals: return "Intervals"
        case .rest:      return "Rest"
        case .race:      return "Race"
        }
    }

    // MARK: 2 · Stats trio · Distance / Target pace / Est time

    private var statsTrio: some View {
        HStack(spacing: 0) {
            statColumn(key: "DISTANCE", value: distanceText, unit: "mi")
            divider
            statColumn(key: "TARGET PACE", value: targetPaceText, unit: "/mi")
            divider
            statColumn(key: "EST TIME", value: estTimeText, unit: "min")
        }
        .padding(.vertical, 18)
        .background(Color.white)
        .overlay(separator, alignment: .bottom)
    }

    private func statColumn(key: String, value: String, unit: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            SpecLabel(text: key, size: 9, tracking: 1.3, color: Color(hex: 0xA39A8C))
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(value)
                    .font(.display(28, weight: .bold))
                    .tracking(-0.8)
                    .foregroundStyle(Color(hex: 0x14110D))
                if value != "—" {
                    Text(unit)
                        .font(.body(11, weight: .extraBold))
                        .foregroundStyle(Color(hex: 0x736C61))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 22)
    }

    private var distanceText: String {
        guard let mi = workout?.distanceMi, mi > 0 else { return "—" }
        return String(format: mi.truncatingRemainder(dividingBy: 1) == 0 ? "%.0f" : "%.1f", mi)
    }

    private var targetPaceText: String {
        guard let p = workout?.phases.first(where: { $0.targetPaceSPerMi != nil })?.targetPaceSPerMi else {
            return "—"
        }
        return formatPace(p)
    }

    private var estTimeText: String {
        guard let mins = workout?.totalEstimatedMinutes, mins > 0 else { return "—" }
        return "~\(mins)"
    }

    // MARK: 3 · EFFORT TARGET · gradient bar + marker

    private var effortTargetBar: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                SpecLabel(text: "EFFORT TARGET", size: 11, tracking: 1.5, color: Color(hex: 0xA39A8C))
                Spacer()
                SpecLabel(text: zoneTagText, size: 11, tracking: 0.5, color: Color(hex: 0x736C61))
            }
            ZStack(alignment: .bottomLeading) {
                // Gradient bar
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(LinearGradient(colors: [
                        Color(hex: 0x54DDD0),  // Z1 teal
                        Color(hex: 0x8EF0B0),  // Z2 mint
                        Color(hex: 0xFFE0A0),  // Z3 amber
                        Color(hex: 0xFF9560),  // Z4 orange
                        Color(hex: 0xFC4D64),  // Z5 coral
                    ], startPoint: .leading, endPoint: .trailing))
                    .frame(height: 8)
                    .padding(.top, 26)
                // Marker bubble + caret · positioned by effort
                GeometryReader { geo in
                    let pin = effortPinPct
                    let x = geo.size.width * pin
                    VStack(spacing: 0) {
                        Text(zoneTagText)
                            .font(.body(10, weight: .extraBold)).tracking(0.8)
                            .foregroundStyle(.white)
                            .padding(.horizontal, 9).padding(.vertical, 4)
                            .background(Color(hex: 0x1B1814), in: Capsule())
                        Triangle()
                            .fill(Color(hex: 0x1B1814))
                            .frame(width: 8, height: 6)
                    }
                    .offset(x: x - 30, y: -8)
                }
                .frame(height: 30)
                .offset(y: -34)
            }
            HStack(spacing: 0) {
                ForEach(["Z1", "Z2", "Z3", "Z4", "Z5"], id: \.self) { z in
                    Text(z)
                        .font(.body(9, weight: .extraBold)).tracking(1)
                        .foregroundStyle(Color(hex: 0xB3AA9C))
                        .frame(maxWidth: .infinity)
                }
            }
            .padding(.top, 4)
        }
        .padding(.horizontal, 24).padding(.vertical, 20)
        .background(Color.white)
        .overlay(separator, alignment: .bottom)
    }

    /// Position of the marker (0..1) based on the run's effort.
    private var effortPinPct: Double {
        switch effort {
        case .recovery: return 0.08
        case .easy:     return 0.30
        case .long:     return 0.40
        case .tempo:    return 0.76
        case .intervals: return 0.92
        case .rest:     return 0.05
        case .race:     return 0.85
        }
    }

    private var zoneTagText: String {
        switch effort {
        case .recovery:  return "Very easy · Z1"
        case .easy:      return "Conversational · Z2"
        case .long:      return "Steady · Z2 to MP"
        case .tempo:     return "Threshold · Z4"
        case .intervals: return "VO₂ · Z5"
        case .rest:      return "Rest"
        case .race:      return "Race effort"
        }
    }

    // MARK: 4 · CONDITIONS & KIT · 2x2 grid

    private var conditionsKit: some View {
        VStack(alignment: .leading, spacing: 14) {
            SpecLabel(text: "CONDITIONS & KIT", size: 11, tracking: 1.5, color: Color(hex: 0xA39A8C))
            VStack(spacing: 1) {
                HStack(spacing: 1) {
                    kitCell(key: "FORECAST", value: forecastText)
                    kitCell(key: "BEST WINDOW", value: bestWindowText)
                }
                HStack(spacing: 1) {
                    kitCell(key: "SHOE", value: shoeText, isPicker: true, onTap: onShoeTap)
                    kitCell(key: "FUEL", value: fuelText)
                }
            }
            .background(Color(hex: 0xEEE7DA))
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .padding(.horizontal, 24).padding(.vertical, 20)
        .background(Color.white)
        .overlay(separator, alignment: .bottom)
    }

    @ViewBuilder
    private func kitCell(key: String, value: String, isPicker: Bool = false, onTap: (() -> Void)? = nil) -> some View {
        let inner = VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 4) {
                SpecLabel(text: key, size: 9, tracking: 1.0, color: Color(hex: 0xA39A8C))
                Spacer()
                if isPicker {
                    Image(systemName: "chevron.down")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(Color(hex: 0xA39A8C))
                }
            }
            Text(value)
                .font(.body(14, weight: .extraBold)).tracking(-0.2)
                .foregroundStyle(Color(hex: 0x14110D))
                .lineLimit(1)
                .minimumScaleFactor(0.85)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white)
        if isPicker, let onTap {
            Button(action: onTap) { inner }.buttonStyle(.plain)
        } else {
            inner
        }
    }

    private var forecastText: String {
        guard let wx = weather, let t = wx.tempF, t > 10, t < 130 else { return "—" }
        return "\(Int(t.rounded()))°"
    }

    private var bestWindowText: String {
        guard let wx = weather, let t = wx.tempF, t > 10 else { return "—" }
        // Heuristic: hot → before 7AM, cold → midday, mild → anytime.
        if t >= 78 { return "Before 7 AM" }
        if t <= 40 { return "Midday" }
        return "Anytime"
    }

    private var shoeText: String {
        if let s = shoeName, !s.isEmpty, s != "—" { return s }
        return "Pick a shoe"
    }

    private var fuelText: String {
        if let f = workout?.fueling, f.needed {
            if !f.shortLine.isEmpty { return f.shortLine }
            if f.gels > 0 { return "\(f.gels) gels" }
        }
        // Even for non-fuel days, communicate "water only" so the cell
        // doesn't render an inscrutable em-dash.
        return "Water only"
    }

    // MARK: 5 · SESSION segment list

    @ViewBuilder
    private var sessionList: some View {
        if let phases = workout?.phases, !phases.isEmpty {
            VStack(alignment: .leading, spacing: 14) {
                SpecLabel(text: "SESSION", size: 11, tracking: 1.5, color: Color(hex: 0xA39A8C))
                VStack(spacing: 14) {
                    ForEach(phases) { phase in
                        HStack(alignment: .top, spacing: 13) {
                            Rectangle()
                                .fill(accentForPhase(phase.type))
                                .frame(width: 3)
                                .frame(minHeight: 30)
                                .clipShape(RoundedRectangle(cornerRadius: 3))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(segmentDistanceLabel(phase))
                                    .font(.body(14, weight: .extraBold)).tracking(-0.2)
                                    .foregroundStyle(Color(hex: 0x14110D))
                                Text(segmentSubLabel(phase))
                                    .font(.body(12))
                                    .foregroundStyle(Color(hex: 0x736C61))
                            }
                            Spacer(minLength: 0)
                        }
                    }
                }
            }
            .padding(.horizontal, 24).padding(.vertical, 20)
            .background(Color.white)
            .overlay(separator, alignment: .bottom)
        }
    }

    private func accentForPhase(_ type: WatchPhaseType) -> Color {
        switch type {
        case .work:               return accent
        case .warmup, .cooldown:  return Color(hex: 0x5BBFB0)
        case .recovery:           return Color(hex: 0x8AA0A8)
        }
    }

    private func segmentDistanceLabel(_ p: WatchPhase) -> String {
        if let d = p.distanceMi, d > 0 {
            return d.truncatingRemainder(dividingBy: 1) == 0
                ? "\(Int(d)) mi"
                : String(format: "%.1f mi", d)
        }
        // Fall back to duration-only labels.
        let m = max(1, p.durationSec / 60)
        return "\(m) min"
    }

    private func segmentSubLabel(_ p: WatchPhase) -> String {
        let base: String = {
            switch p.type {
            case .warmup:   return "warmup"
            case .work:     return p.label.isEmpty ? "main set" : p.label.lowercased()
            case .recovery: return "recovery"
            case .cooldown: return "cooldown"
            }
        }()
        if let pace = p.targetPaceSPerMi {
            return "\(base) @ \(formatPace(pace))/mi"
        }
        return base
    }

    // MARK: 6 · CUE line

    @ViewBuilder
    private var cueLine: some View {
        if let cue = cueText {
            HStack(alignment: .top, spacing: 10) {
                Text("CUE")
                    .font(.body(9, weight: .extraBold)).tracking(1)
                    .foregroundStyle(Color(hex: 0x7D756A))
                    .padding(.horizontal, 7).padding(.vertical, 3)
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color(hex: 0xD9D2C4)))
                Text(cue)
                    .font(.body(13))
                    .italic()
                    .foregroundStyle(Color(hex: 0x4F483F))
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 24).padding(.vertical, 18)
            .background(Color.white)
            .overlay(separator, alignment: .bottom)
        }
    }

    private var cueText: String? {
        // Derive a coaching cue from the workout summary when present.
        // The backend doesn't ship a dedicated `cue` field yet (open ask
        // in the design package); for now we pull the first sentence of
        // workout.summary as a proxy. Falls back to type-specific defaults
        // so the runner always sees one.
        if let summary = workout?.summary,
           let first = summary.split(separator: ".").first {
            let s = first.trimmingCharacters(in: .whitespaces)
            if !s.isEmpty { return s + "." }
        }
        switch effort {
        case .tempo:     return "Settle in by mile 3 and hold form when it bites."
        case .intervals: return "Even effort across all reps. Don't start out too hot."
        case .easy:      return "Keep it truly easy. Nose-breathing pace the whole way."
        case .long:      return "Patience early. Earn the back-half pace by holding back."
        case .recovery:  return "Slow on purpose. The point is moving, not training."
        case .race, .rest: return nil
        }
    }

    // MARK: 7 · THE PLAN · verdict + recap + targets

    @ViewBuilder
    private var thePlan: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                SpecLabel(text: "THE PLAN", size: 11, tracking: 1.5, color: Color(hex: 0xA39A8C))
                Spacer()
                Text(isToday ? "TODAY" : "UPCOMING")
                    .font(.body(9, weight: .extraBold)).tracking(1.2)
                    .foregroundStyle(Color(hex: 0x736C61))
                    .padding(.horizontal, 9).padding(.vertical, 4)
                    .overlay(Capsule().stroke(Color(hex: 0xD9D2C4)))
            }
            if let v = verdictText {
                Text(v)
                    .font(.body(20, weight: .extraBold))
                    .tracking(-0.3)
                    .foregroundStyle(Color(hex: 0x14110D))
            }
            if let r = recapText {
                Text(r)
                    .font(.body(13))
                    .foregroundStyle(Color(hex: 0x4F483F))
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            VStack(spacing: 11) {
                targetRow(key: "HEART RATE", value: heartRateTarget)
                targetRow(key: "EFFORT", value: effortTarget)
                targetRow(key: "CADENCE", value: cadenceTarget)
            }
            .padding(.top, 6)
        }
        .padding(.horizontal, 24).padding(.vertical, 20)
        .background(Color.white)
        .overlay(separator, alignment: .bottom)
    }

    private func targetRow(key: String, value: String) -> some View {
        HStack {
            SpecLabel(text: key, size: 11, tracking: 1.5, color: Color(hex: 0xA39A8C))
            Spacer()
            Text(value)
                .font(.body(13, weight: .extraBold)).tracking(-0.2)
                .foregroundStyle(Color(hex: 0x14110D))
        }
    }

    private var verdictText: String? {
        if let p = purpose, !p.verdict.isEmpty { return p.verdict }
        if let lead = briefing?.lead, !lead.isEmpty { return lead }
        return nil
    }

    private var recapText: String? {
        // Use the purpose's first fact if available · the design's "recap"
        // body is descriptive context, not prescription.
        if let facts = purpose?.facts.first { return facts }
        return nil
    }

    private var heartRateTarget: String {
        switch effort {
        case .recovery:  return "<125 bpm · Z1"
        case .easy:      return "<140 bpm · Z2"
        case .long:      return "140-155 · Z2 to MP"
        case .tempo:     return "160-168 · Z4"
        case .intervals: return "175+ · Z5"
        case .rest:      return "—"
        case .race:      return "Race effort"
        }
    }

    private var effortTarget: String {
        switch effort {
        case .recovery:  return "2 / 10 · very easy"
        case .easy:      return "4 / 10 · conversational"
        case .long:      return "6 / 10 · steady"
        case .tempo:     return "7 / 10 · hard"
        case .intervals: return "9 / 10 · all in"
        case .rest:      return "—"
        case .race:      return "8-9 / 10"
        }
    }

    private var cadenceTarget: String {
        switch effort {
        case .recovery:  return "relaxed"
        case .easy:      return "relaxed"
        case .long:      return "strong"
        case .tempo:     return "quick"
        case .intervals: return "fast"
        case .rest:      return "—"
        case .race:      return "strong"
        }
    }

    // MARK: 8 · Skip footer

    private var skipFooter: some View {
        Button(action: onSkip) {
            HStack(spacing: 8) {
                Image(systemName: "forward.fill")
                    .font(.system(size: 11, weight: .bold))
                Text("Skip this run")
                    .font(.body(13, weight: .extraBold))
            }
            .foregroundStyle(Color(hex: 0x9A9286))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 18)
        }
        .buttonStyle(.plain)
        .background(Color.white)
    }

    // MARK: Helpers

    private var divider: some View {
        Rectangle()
            .fill(Color(hex: 0xEEE7DA))
            .frame(width: 1, height: 30)
    }

    private var separator: some View {
        Rectangle()
            .fill(Color(hex: 0xEEE7DA))
            .frame(height: 1)
    }

    private func formatPace(_ secPerMi: Int) -> String {
        let m = secPerMi / 60
        let s = secPerMi % 60
        return String(format: "%d:%02d", m, s)
    }
}

// Triangle shape lives in Components/Primitives.swift · reused here.
