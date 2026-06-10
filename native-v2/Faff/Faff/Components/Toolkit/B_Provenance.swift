//
//  B_Provenance.swift
//  Family B · Provenance & Metrics tiles.
//
//  Components: ProvenanceLine · StatTile · WorkSegmentRow · ConditionsLine ·
//              HRTargetPill · VDOTPredictionTable.
//
//  ProvenanceLine is a CONSOLIDATION CANDIDATE per the coverage memo · the
//  same grey "where this came from" line goes under LTHR, HRmax, VDOT, and
//  weight. Build once, drop anywhere a number has a story.
//
//  ConditionsLine is also CONSOLIDATION · one component for Today (upcoming)
//  + Run Detail (past run) + Race Detail (race morning).
//

import SwiftUI

// MARK: - ProvenanceLine
//
// Small grey caption that explains where a physiology number came from.
// Renders flat text only; the number itself is the caller's responsibility
// (this is the line UNDER the number).
//
// Doctrine: secondary text uses Theme.mute solid, not a faded primary
// (legibility law 2).

enum ProvenanceKind {
    case raceCalibrated(raceName: String, dateLabel: String)   // "from your Sombrero Half · May 4"
    case estimated(method: String)                             // "estimated from age formula · add a max effort to calibrate"
    case stale(daysOrLabel: String, callToAction: String)      // "last set 7 months ago · update to tune fueling math"
    case manual                                                // "set manually · re-test to refresh"
}

struct ProvenanceLine: View {
    let kind: ProvenanceKind

    var body: some View {
        Text(line)
            .font(.body(11.5, weight: .medium))
            .tracking(0.1)
            .foregroundStyle(textColor)
            .lineLimit(2)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var line: AttributedString {
        switch kind {
        case .raceCalibrated(let name, let date):
            var s = AttributedString("from your ")
            var n = AttributedString(name); n.font = .body(11.5, weight: .extraBold)
            n.foregroundColor = Theme.txt
            var rest = AttributedString(" · " + date)
            s.append(n); s.append(rest); return s
        case .estimated(let m):
            return AttributedString("estimated from " + m)
        case .stale(let d, let cta):
            return AttributedString("last set \(d) · \(cta)")
        case .manual:
            return AttributedString("set manually · re-test to refresh")
        }
    }
    private var textColor: Color {
        switch kind {
        case .stale: return Theme.goal
        default:     return Theme.mute
        }
    }
}

// MARK: - StatTile
//
// Reusable bold-numeric tile. VDOT is the headline use; same shape fits
// MaxHR / RHR / Weight on the physiology block. Three states: populated,
// loading, empty (with a "Log a race to set" affordance).

struct StatTile: View {
    let value: String                 // "47" / "—"
    let label: String                 // "VDOT"
    var explainText: String? = nil    // "What is this?" / "Log a race to set"
    var loading: Bool = false
    var onExplain: (() -> Void)? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if loading {
                RoundedRectangle(cornerRadius: 6)
                    .fill(Color.white.opacity(0.08))
                    .frame(width: 64, height: 30)
            } else {
                Text(value)
                    .font(.display(34, weight: .bold))
                    .monospacedDigit()
                    .tracking(-1)
                    .foregroundStyle(valueColor)
            }
            Text(label.uppercased())
                .font(.body(10, weight: .extraBold))
                .tracking(1.6)
                .foregroundStyle(Theme.mute)
            if let e = explainText, !loading {
                Button { onExplain?() } label: {
                    HStack(spacing: 4) {
                        Text(e)
                            .font(.body(10.5, weight: .semibold))
                            .foregroundStyle(Theme.dist)
                        Image(systemName: "chevron.right")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(Theme.dist)
                    }
                }
                .buttonStyle(.plain)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
    }

    private var valueColor: Color {
        value == "—" ? Theme.mute : Theme.txt
    }
}

// MARK: - WorkSegmentRow
//
// Work-segment-only stats for intervals/tempo runs. The work-only averages
// matter more than whole-run averages when the run has structure. Hide on
// steady easy runs (caller's responsibility · render the empty state if
// there is no `work_seconds`).

struct WorkSegmentRow: View {
    let pace: String?            // "6:14"
    let hr: Int?
    let cadence: Int?
    let workSeconds: Int?
    var loading: Bool = false

    var body: some View {
        if loading {
            HStack(spacing: 12) {
                Text("WORK")
                    .font(.body(10, weight: .extraBold)).tracking(1.6)
                    .foregroundStyle(Theme.amberBright)
                RoundedRectangle(cornerRadius: 4).fill(Color.white.opacity(0.08))
                    .frame(width: 200, height: 12)
            }
            .padding(14)
            .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
        } else if hasAny {
            HStack(alignment: .center, spacing: 16) {
                Text("WORK")
                    .font(.body(10, weight: .extraBold)).tracking(1.6)
                    .foregroundStyle(Theme.amberBright)
                if let p = pace { metric(p, "/mi") }
                if let h = hr { metric("\(h)", "bpm") }
                if let c = cadence { metric("\(c)", "spm") }
                if let s = workSeconds { metric(fmtDuration(s), "work") }
                Spacer(minLength: 0)
            }
            .padding(14)
            .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
        } else {
            HStack {
                Spacer()
                Text("Steady run · no work segments to isolate")
                    .font(.body(12, weight: .medium))
                    .foregroundStyle(Theme.mute)
                Spacer()
            }
            .padding(14)
            .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
        }
    }

    private var hasAny: Bool {
        pace != nil || hr != nil || cadence != nil || workSeconds != nil
    }
    private func metric(_ v: String, _ unit: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 3) {
            Text(v).font(.display(16, weight: .bold)).monospacedDigit().foregroundStyle(Theme.txt)
            Text(unit).font(.body(10, weight: .semibold)).foregroundStyle(Theme.mute)
        }
    }
    private func fmtDuration(_ secs: Int) -> String {
        let m = secs / 60, s = secs % 60
        return String(format: "%d:%02d", m, s)
    }
}

extension Theme {
    static let amberBright = Color(hex: 0xFFCE8A)
}

// MARK: - ConditionsLine
//
// One weather string for three surfaces. Span variant shows start → peak
// for runs/races that traverse a temperature gradient. Hot styling tints
// the temperature only (legibility law 3).

struct ConditionsLine: View {
    enum Variant {
        case mild(tempF: Int, feelsF: Int?, windMph: Int?)
        case hot(tempF: Int, feelsF: Int?, humidityPct: Int?)
        case span(startF: Int, peakF: Int)
        case loading
        case error(retry: () -> Void)
    }
    let variant: Variant

    var body: some View {
        switch variant {
        case .mild(let t, let feels, let wind):
            chip {
                Image(systemName: "sun.max")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.mute)
                Text("\(t)°F").font(.body(13, weight: .semibold)).monospacedDigit().foregroundStyle(Theme.txt)
                if let f = feels { sep(); Text("feels \(f)").font(.body(11.5, weight: .medium)).foregroundStyle(Theme.mute) }
                if let w = wind { sep(); Text("wind \(w) mph").font(.body(11.5, weight: .medium)).foregroundStyle(Theme.mute) }
            }
        case .hot(let t, let feels, let hum):
            chip {
                Image(systemName: "sun.max.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.race)
                Text("\(t)°F").font(.body(13, weight: .semibold)).monospacedDigit().foregroundStyle(Theme.race)
                if let f = feels { Text(" · feels \(f)").font(.body(11.5, weight: .medium)).foregroundStyle(Theme.race) }
                if let h = hum { sep(); Text("\(h)% RH").font(.body(11.5, weight: .medium)).foregroundStyle(Theme.mute) }
            }
        case .span(let s, let p):
            chip {
                Image(systemName: "sun.max")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.mute)
                Text("\(s)°F").font(.body(13, weight: .semibold)).monospacedDigit().foregroundStyle(Theme.txt)
                Text("→").font(.body(11.5)).foregroundStyle(Theme.mute)
                Text("\(p)°F").font(.body(13, weight: .semibold)).monospacedDigit().foregroundStyle(Theme.race)
                sep()
                Text("peak \(p)°F").font(.body(11.5, weight: .medium)).foregroundStyle(Theme.mute)
            }
        case .loading:
            chip {
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color.white.opacity(0.08))
                    .frame(width: 180, height: 13)
            }
        case .error(let retry):
            HStack(spacing: 8) {
                Image(systemName: "exclamationmark.triangle")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Theme.over)
                Text("Forecast unavailable")
                    .font(.body(12, weight: .semibold))
                    .foregroundStyle(Theme.txt)
                Button("Retry", action: retry)
                    .font(.body(11, weight: .extraBold))
                    .tracking(0.6)
                    .foregroundStyle(Theme.over)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(Theme.over.opacity(0.12), in: Capsule())
                    .overlay(Capsule().stroke(Theme.over.opacity(0.40), lineWidth: 1))
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(Theme.Glass.fill, in: Capsule())
        }
    }

    @ViewBuilder private func chip<C: View>(@ViewBuilder _ content: () -> C) -> some View {
        HStack(spacing: 8) { content() }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(Theme.Glass.fill, in: Capsule())
            .overlay(Capsule().stroke(Theme.Glass.line, lineWidth: 1))
    }
    @ViewBuilder private func sep() -> some View {
        Text("·").font(.body(11.5)).foregroundStyle(Theme.dim)
    }
}

// MARK: - HRTargetPill
//
// Sits under the pace chip on Day Detail. The cap variant fires only when
// the workout carries an explicit hrCeilingBpm (easy / Z2 / heat-flag days).

struct HRTargetPill: View {
    enum Variant {
        case zone(label: String, lower: Int, upper: Int)   // "Z4 · 152–162"
        case cap(bpm: Int, note: String)                   // "HR cap · 152 bpm · let it climb..."
    }
    let variant: Variant

    var body: some View {
        switch variant {
        case .zone(let label, let lo, let hi):
            HStack(spacing: 8) {
                Text("HR")
                    .font(.body(10, weight: .extraBold)).tracking(1.4)
                    .foregroundStyle(Theme.mute)
                Text("\(lo)–\(hi) bpm")
                    .font(.body(13, weight: .semibold)).monospacedDigit()
                    .foregroundStyle(Theme.txt)
                Text("·").font(.body(11.5)).foregroundStyle(Theme.dim)
                Text(label)
                    .font(.body(11, weight: .extraBold))
                    .foregroundStyle(Theme.dist)
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(Theme.Glass.fill, in: Capsule())
            .overlay(Capsule().stroke(Theme.Glass.line, lineWidth: 1))
        case .cap(let bpm, let note):
            HStack(spacing: 8) {
                Text("HR cap")
                    .font(.body(10, weight: .extraBold)).tracking(1.4)
                    .foregroundStyle(Theme.over)
                Text("\(bpm) bpm")
                    .font(.body(13, weight: .semibold)).monospacedDigit()
                    .foregroundStyle(Theme.over)
                Text("·").font(.body(11.5)).foregroundStyle(Theme.dim)
                Text(note)
                    .font(.body(11.5, weight: .medium))
                    .foregroundStyle(Theme.txt)
                    .lineLimit(2)
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(Theme.over.opacity(0.10), in: Capsule())
            .overlay(Capsule().stroke(Theme.over.opacity(0.45), lineWidth: 1))
        }
    }
}

// MARK: - VDOTPredictionTable
//
// Daniels predicted finish times across distances. Frame honestly: this
// is a prediction; weather + course + day matter too. Caller passes a
// closure to compute times from VDOT (lib/vdot.ts equivalent lives in
// API.swift or RaceDayView).

struct VDOTPredictionRow: Identifiable {
    let distance: String   // "5K" / "10K" / "Half" / "Marathon"
    let time: String       // "19:42"
    var id: String { distance }
}

struct VDOTPredictionTable: View {
    let rows: [VDOTPredictionRow]?  // nil → loading; empty → "no VDOT yet"

    var body: some View {
        if let rs = rows {
            if rs.isEmpty {
                Text("Log a race to unlock predictions.")
                    .font(.body(12, weight: .medium))
                    .foregroundStyle(Theme.mute)
                    .padding(14)
                    .frame(maxWidth: .infinity)
                    .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(rs.enumerated()), id: \.offset) { idx, r in
                        HStack {
                            Text(r.distance)
                                .font(.body(12, weight: .extraBold))
                                .tracking(0.6)
                                .foregroundStyle(Theme.mute)
                            Spacer()
                            Text(r.time)
                                .font(.display(17, weight: .bold))
                                .monospacedDigit()
                                .foregroundStyle(Theme.txt)
                        }
                        .padding(.vertical, 10)
                        if idx < rs.count - 1 { Divider().background(Color.white.opacity(0.08)) }
                    }
                }
                .padding(.horizontal, 16)
                .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
            }
        } else {
            VStack(spacing: 8) {
                ForEach(0..<4, id: \.self) { _ in
                    HStack {
                        RoundedRectangle(cornerRadius: 4)
                            .fill(Color.white.opacity(0.08))
                            .frame(width: 56, height: 12)
                        Spacer()
                        RoundedRectangle(cornerRadius: 4)
                            .fill(Color.white.opacity(0.08))
                            .frame(width: 60, height: 16)
                    }
                    .padding(.vertical, 8)
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 8)
            .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
        }
    }
}
