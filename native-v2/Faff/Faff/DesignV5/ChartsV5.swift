//
//  ChartsV5.swift
//  faff.run iPhone · every graphic in the v5 design, drawn from data.
//
//  "No icon font, image, or illustration assets are used — every graphic
//   (route line, elevation profile, week shape, phase bar, zone bar, trend
//   bars, range scales) is drawn from data with inline SVG/CSS, not an asset."
//
//  So: Shape and Canvas, never an image. The only icons in the app are
//  system stroke glyphs (chevron, plus, minus, calendar).
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE COLOUR RULE THESE ALL OBEY
//
//  Signal orange is "the runner's current position/value, the one highlighted
//  bar in any chart". It is never a grade. Everything else in a chart is plot
//  ink or plot quiet. Attention amber appears only where a value is outside
//  the range that was asked for. There is no green, so nothing here can say
//  "good".
//

import SwiftUI

// MARK: - RangeScale
//
// A pill track with the asked-for range marked on it and the runner's current
// value sitting somewhere along it. Three modes, from the prototype:
//
//   band      · a target band, and whether you are inside it (live pace)
//   ceiling   · a ceiling, and how close you are to it (heart rate)
//   progress  · how far through something you are (taper weeks)

struct RangeScale: View {
    enum Mode { case band, ceiling, progress }
    enum Hue { case pace, heart, phase }
    enum Size { case s, m }

    let mode: Mode
    let min: Double
    let max: Double
    /// The asked-for range. `ceiling` uses `high` as the ceiling and ignores
    /// `low`. `progress` ignores it entirely.
    var band: (low: Double, high: Double)? = nil
    /// Where the runner actually is. Nil renders the track with no marker
    /// rather than a marker at zero, which would read as a real reading.
    var value: Double?
    var endpoints: (String, String)? = nil
    var centerLabel: String? = nil
    var hue: Hue = .pace
    var size: Size = .s

    private var trackHeight: CGFloat { size == .s ? 10 : 14 }

    private func frac(_ v: Double) -> Double {
        guard max > min else { return 0 }
        return Swift.min(Swift.max((v - min) / (max - min), 0), 1)
    }

    /// Outside the band is the one thing amber means here.
    private var outOfRange: Bool {
        guard let value else { return false }
        switch mode {
        case .band:     guard let b = band else { return false }; return value < b.low || value > b.high
        case .ceiling:  guard let b = band else { return false }; return value > b.high
        case .progress: return false
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: V5.S.s6) {
            GeometryReader { geo in
                let w = geo.size.width
                ZStack(alignment: .leading) {
                    Capsule().fill(V5.plotQuiet).frame(height: trackHeight)

                    switch mode {
                    case .band:
                        if let b = band {
                            Capsule()
                                .fill(Color.white.opacity(0.26))
                                .frame(width: Swift.max((frac(b.high) - frac(b.low)) * w, 2),
                                       height: trackHeight)
                                .offset(x: frac(b.low) * w)
                        }
                    case .ceiling:
                        if let b = band {
                            Capsule()
                                .fill(Color.white.opacity(0.26))
                                .frame(width: Swift.max(frac(b.high) * w, 2), height: trackHeight)
                        }
                    case .progress:
                        if let value {
                            Capsule()
                                .fill(V5.signal)
                                .frame(width: Swift.max(frac(value) * w, 2), height: trackHeight)
                        }
                    }

                    if mode != .progress, let value {
                        // The runner's own position. Signal orange, or amber
                        // when it is outside what was asked for.
                        Capsule()
                            .fill(outOfRange ? V5.attention : V5.signal)
                            .frame(width: 4, height: trackHeight + 8)
                            .offset(x: Swift.max(frac(value) * w - 2, 0))
                    }
                }
                .frame(height: trackHeight + 8)
                .frame(maxHeight: .infinity, alignment: .center)
            }
            .frame(height: trackHeight + 8)

            if endpoints != nil || centerLabel != nil {
                HStack(spacing: V5.S.s8) {
                    if let e = endpoints {
                        Text(e.0).font(.faffText(TypeScaleV5.label12)).foregroundStyle(V5.textQuiet)
                        Spacer(minLength: 0)
                        if let c = centerLabel {
                            Text(c).font(.faffText(TypeScaleV5.label12)).foregroundStyle(V5.textQuiet)
                            Spacer(minLength: 0)
                        }
                        Text(e.1).font(.faffText(TypeScaleV5.label12)).foregroundStyle(V5.textQuiet)
                    } else if let c = centerLabel {
                        Spacer(minLength: 0)
                        Text(c).font(.faffText(TypeScaleV5.label12)).foregroundStyle(V5.textQuiet)
                        Spacer(minLength: 0)
                    }
                }
            }
        }
    }
}

// MARK: - ZoneBar
//
// Time in each of five heart-rate zones, as one stacked bar. The zone the
// session ASKED for is the highlighted one; the rest are plot ink. Nothing
// here says a distribution was good.

struct ZoneBar: View {
    /// Percent in each zone, Z1…Z5. Need not sum to exactly 100.
    let shares: [Double]
    /// The zone the session asked for, 1-indexed. Nil highlights nothing.
    var target: Int? = nil
    var height: CGFloat = 44
    var labels: Bool = false

    private var total: Double { Swift.max(shares.reduce(0, +), 0.0001) }

    private func width(_ s: Double, in full: CGFloat) -> CGFloat {
        Swift.max(full * (s / total) - 2, s > 0 ? 2 : 0)
    }

    var body: some View {
        GeometryReader { geo in
            VStack(alignment: .leading, spacing: V5.S.s6) {
                HStack(spacing: 2) {
                    ForEach(Array(shares.enumerated()), id: \.offset) { i, s in
                        let isTarget = target.map { $0 == i + 1 } ?? false
                        RoundedRectangle(cornerRadius: V5.R.r6, style: .continuous)
                            // Zones step in density, Z1 lightest to Z5
                            // densest. Without it a bar with no target — a
                            // finished run, where nothing was "asked for" —
                            // rendered as one flat grey block and read as a
                            // single value rather than as a distribution.
                            //
                            // Density, not hue: an ordinal ramp says which
                            // zone without saying anything about whether the
                            // distribution was good, which this app never does.
                            .fill(isTarget ? V5.signal
                                  : V5.plotInk.opacity(0.22 + Double(i) * 0.14))
                            .frame(width: width(s, in: geo.size.width))
                    }
                }
                .frame(height: height, alignment: .leading)

                // EACH LABEL SITS UNDER ITS OWN BAR.
                //
                // Evenly-spaced labels under proportional bars misread badly
                // the moment a zone is empty: David's half sat entirely in Z4
                // and Z5, so the first two blocks on screen were a narrow one
                // and a wide one — under labels that started at Z1. It read as
                // an easy run. The label row now takes the bar's own widths,
                // and a zone with no time in it gets no label to point at.
                if labels {
                    HStack(spacing: 2) {
                        ForEach(Array(shares.enumerated()), id: \.offset) { i, s in
                            Text(s > 0 ? "Z\(i + 1)" : "")
                                .font(.faffText(TypeScaleV5.label12))
                                .foregroundStyle(target.map { $0 == i + 1 } ?? false ? V5.signal : V5.textQuiet)
                                .lineLimit(1)
                                .fixedSize()
                                .frame(width: width(s, in: geo.size.width), alignment: .leading)
                                .clipped()
                        }
                    }
                }
            }
        }
        .frame(height: labels ? height + V5.S.s6 + 15 : height)
    }
}

// MARK: - TrendBars
//
// A run of daily reads with one bar highlighted, a headline value above and
// footnotes below. The Races screen's projected-finish trend.
//
// The headline takes a `FaffValue`, because a projected finish IS modelled and
// must carry its mark.

struct TrendBars: View {
    let values: [Double]
    /// Index of the highlighted bar. Negative counts from the end, so -1 is
    /// the most recent read, matching the prototype.
    var highlight: Int = -1
    var height: CGFloat = 96
    var headline: FaffValue? = nil
    var headlineLabel: String? = nil
    var footnotes: [String] = []

    private var hi: Int {
        highlight < 0 ? values.count + highlight : highlight
    }

    /// The bars are scaled against a PADDED domain, not against the series'
    /// own min and max.
    ///
    /// Min-anchored normalisation is quietly dishonest on a series that
    /// barely moves: three projections of 3:31:40 / 3:31:44 / 3:31:48 —
    /// eight seconds apart on a three-and-a-half-hour race — would draw as
    /// empty bar to full bar and read as an enormous swing. And a series
    /// that does not move at all collapses to the 2pt floor on every bar,
    /// which looks like a broken chart rather than a flat trend.
    ///
    /// So the domain is at least `domainFloorFraction` of the series' own
    /// magnitude, centred on it, and every bar keeps `barFloorFraction` of
    /// the height. Equal values draw equal, mid-height bars. A small real
    /// change draws as a small change. A large one still fills the chart.
    private static let domainFloorFraction = 0.02
    private static let barFloorFraction: CGFloat = 0.18

    private func barHeight(_ v: Double, in full: CGFloat) -> CGFloat {
        let lo = values.min() ?? 0
        let hiV = values.max() ?? 1
        let mid = (lo + hiV) / 2
        let span = Swift.max(hiV - lo, abs(mid) * Self.domainFloorFraction, 0.0001)
        let frac = CGFloat((v - (mid - span / 2)) / span)
        let scaled = Self.barFloorFraction + (1 - Self.barFloorFraction) * Swift.min(Swift.max(frac, 0), 1)
        return Swift.max(scaled * full, 2)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: V5.S.s12) {
            if let headline {
                VStack(alignment: .leading, spacing: V5.S.s4) {
                    if let headlineLabel {
                        Text(headlineLabel)
                            .font(.faffText(TypeScaleV5.label12))
                            .foregroundStyle(V5.textQuiet)
                    }
                    FaffValueText(headline, font: .faffText(28, weight: .semibold))
                }
            }

            GeometryReader { geo in
                HStack(alignment: .bottom, spacing: 2) {
                    ForEach(Array(values.enumerated()), id: \.offset) { i, v in
                        RoundedRectangle(cornerRadius: 2, style: .continuous)
                            .fill(i == hi ? V5.signal : V5.plotInk.opacity(0.32))
                            .frame(height: barHeight(v, in: geo.size.height))
                    }
                }
                .frame(height: geo.size.height, alignment: .bottom)
            }
            .frame(height: height)

            if !footnotes.isEmpty {
                HStack(spacing: V5.S.s12) {
                    ForEach(footnotes, id: \.self) { f in
                        Text(f)
                            .font(.faffText(TypeScaleV5.label12))
                            .foregroundStyle(V5.textQuiet)
                    }
                    Spacer(minLength: 0)
                }
            }
        }
    }
}

// MARK: - PhaseBar
//
// The block's phases as one bar, sized by weeks, with the current phase
// highlighted and a marker showing how far into it the runner is.

struct PhaseSegment: Identifiable, Equatable {
    let id = UUID()
    let name: String
    let weeks: Int
    var current: Bool = false
    /// 0…1 through this phase. Only read on the current one.
    var at: Double? = nil

    init(_ name: String, weeks: Int, current: Bool = false, at: Double? = nil) {
        self.name = name; self.weeks = weeks; self.current = current; self.at = at
    }
}

struct PhaseBar: View {
    let phases: [PhaseSegment]
    var height: CGFloat = 30

    private var totalWeeks: Double {
        Swift.max(Double(phases.reduce(0) { $0 + $1.weeks }), 0.0001)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: V5.S.s6) {
            GeometryReader { geo in
                HStack(spacing: 2) {
                    ForEach(phases) { p in
                        ZStack(alignment: .leading) {
                            RoundedRectangle(cornerRadius: V5.R.r6, style: .continuous)
                                .fill(p.current ? V5.plotInk.opacity(0.30) : V5.plotQuiet)
                            if p.current, let at = p.at {
                                GeometryReader { seg in
                                    Capsule()
                                        .fill(V5.signal)
                                        .frame(width: 4)
                                        .offset(x: Swift.max(Swift.min(at, 1) * seg.size.width - 2, 0))
                                }
                            }
                        }
                        .frame(width: geo.size.width * (Double(p.weeks) / totalWeeks) - 2)
                    }
                }
                .frame(height: geo.size.height)
            }
            .frame(height: height)

            HStack(spacing: 2) {
                ForEach(phases) { p in
                    Text(p.name)
                        .font(.faffText(TypeScaleV5.label12))
                        .foregroundStyle(p.current ? V5.signal : V5.textQuiet)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }
}

// MARK: - ElevationProfile
//
// A course, or a run's route. A line with a start and an end dot, labelled
// marks along it, and footnotes.

struct ElevationMark: Identifiable, Equatable {
    let id = UUID()
    /// 0…1 along the course.
    let at: Double
    let label: String

    init(at: Double, label: String) { self.at = at; self.label = label }
}

/// The line itself, as a Shape, so no drawing maths runs inside a ViewBuilder.
struct ElevationLine: Shape {
    let points: [Double]
    /// Close the path down to the baseline for the quiet fill underneath.
    var closed: Bool = false

    func path(in rect: CGRect) -> Path {
        var p = Path()
        guard points.count > 1 else { return p }
        let lo = points.min() ?? 0
        let hi = points.max() ?? 1
        let span = Swift.max(hi - lo, 0.0001)
        func at(_ i: Int) -> CGPoint {
            CGPoint(x: rect.width * Double(i) / Double(points.count - 1),
                    y: rect.height - (points[i] - lo) / span * rect.height)
        }
        if closed { p.move(to: CGPoint(x: 0, y: rect.height)); p.addLine(to: at(0)) }
        else { p.move(to: at(0)) }
        for i in points.indices.dropFirst() { p.addLine(to: at(i)) }
        if closed {
            p.addLine(to: CGPoint(x: rect.width, y: rect.height))
            p.closeSubpath()
        }
        return p
    }
}

struct ElevationProfile: View {
    let points: [Double]
    var marks: [ElevationMark] = []
    var footnotes: [String] = []
    var height: CGFloat = 120

    private var normalised: [Double] {
        let lo = points.min() ?? 0
        let hi = points.max() ?? 1
        let span = Swift.max(hi - lo, 0.0001)
        return points.map { ($0 - lo) / span }
    }

    /// A profile needs at least two readings. With none, the marks were still
    /// drawn — three bare vertical lines floating in an empty box, which reads
    /// as a chart that failed rather than as a course with no stored geometry.
    /// The named marks are still worth showing; the chart is not.
    private var hasSeries: Bool { points.count > 1 }

    var body: some View {
        VStack(alignment: .leading, spacing: V5.S.s10) {
            if hasSeries {
            ZStack(alignment: .topLeading) {
                ElevationLine(points: points, closed: true).fill(V5.plotQuiet)
                ElevationLine(points: points)
                    .stroke(V5.plotInk,
                            style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))

                GeometryReader { geo in
                    ZStack(alignment: .topLeading) {
                        ForEach(marks) { m in
                            Rectangle()
                                .fill(V5.plotInk.opacity(0.45))
                                .frame(width: 1)
                                .offset(x: Swift.min(Swift.max(m.at, 0), 1) * geo.size.width)
                        }
                        if let first = normalised.first {
                            Circle().fill(V5.textPrimary).frame(width: 6, height: 6)
                                .offset(x: -3, y: (1 - first) * geo.size.height - 3)
                        }
                        if let last = normalised.last {
                            Circle().fill(V5.signal).frame(width: 6, height: 6)
                                .offset(x: geo.size.width - 3, y: (1 - last) * geo.size.height - 3)
                        }
                    }
                }
            }
            .frame(height: height)
            }

            if !marks.isEmpty {
                VStack(alignment: .leading, spacing: V5.S.s4) {
                    ForEach(marks) { m in
                        Text(m.label)
                            .font(.faffText(TypeScaleV5.label12))
                            .foregroundStyle(V5.textQuiet)
                    }
                }
            }

            if !footnotes.isEmpty {
                HStack(spacing: V5.S.s12) {
                    ForEach(footnotes, id: \.self) { f in
                        Text(f)
                            .font(.faffText(TypeScaleV5.label12))
                            .foregroundStyle(V5.textQuiet)
                    }
                    Spacer(minLength: 0)
                }
            }
        }
    }
}

// MARK: - DualPoint
//
// Before and after, with the move between them named. The paces-moved screen
// uses one per zone, because zones do NOT move by the same amount — threshold
// +24 s/mi, interval +22, rep +19 on a three-point drop — so there is no
// single headline delta and no component here that would let you print one.

struct DualPoint: View {
    enum Size { case sm, md }
    enum Tone { case neutral, attention, signal }

    let leftLabel: String
    let leftValue: FaffValue
    let rightLabel: String
    let rightValue: FaffValue
    var gapLabel: String? = nil
    var gapValue: String? = nil
    var tone: Tone = .neutral
    var size: Size = .sm

    private var valueFont: Font { .faffText(size == .sm ? 20 : 26, weight: .semibold) }
    private var toneInk: Color {
        switch tone {
        case .neutral:   return V5.textPrimary
        case .attention: return V5.attention
        case .signal:    return V5.signal
        }
    }

    var body: some View {
        HStack(alignment: .center, spacing: V5.S.s12) {
            VStack(alignment: .leading, spacing: V5.S.s4) {
                Text(leftLabel)
                    .font(.faffText(TypeScaleV5.label12))
                    .foregroundStyle(V5.textQuiet)
                FaffValueText(leftValue, font: valueFont, color: V5.textSecondary)
            }
            Image(systemName: "arrow.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(V5.textQuiet)
            VStack(alignment: .leading, spacing: V5.S.s4) {
                Text(rightLabel)
                    .font(.faffText(TypeScaleV5.label12))
                    .foregroundStyle(V5.textQuiet)
                FaffValueText(rightValue, font: valueFont, color: V5.textPrimary)
            }
            Spacer(minLength: 0)
            if gapValue != nil || gapLabel != nil {
                VStack(alignment: .trailing, spacing: V5.S.s4) {
                    if let gapLabel {
                        Text(gapLabel)
                            .font(.faffText(TypeScaleV5.label12))
                            .foregroundStyle(V5.textQuiet)
                    }
                    if let gapValue {
                        Text(gapValue)
                            .font(.faffText(TypeScaleV5.body15, weight: .semibold))
                            .foregroundStyle(toneInk)
                    }
                }
            }
        }
        .padding(.horizontal, V5.S.tilePad)
        .padding(.vertical, V5.S.s16)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Week strip
//
// The seven days across the top of a Today panel: day letter, date number,
// and a status rail underneath. It sits ON a gradient, so its inks are the
// on-panel set, and the whole thing is drawn, not an asset.

struct WeekStripDayV5: Identifiable, Equatable {
    /// The plan row's SERVER id. A plan day now carries one, and it is the
    /// identity — the date is a lookup, not an identity. A synthesised rest
    /// day with no row falls back to a `date:`-prefixed key.
    let id: String
    /// One letter. M T W T F S S.
    let letter: String
    /// Date number.
    let number: String
    var state: V5.DayState = .easy
    var isToday: Bool = false
    var isDone: Bool = false
    var isRest: Bool = false
}

struct WeekStripV5: View {
    let days: [WeekStripDayV5]
    var onTap: ((WeekStripDayV5) -> Void)? = nil

    var body: some View {
        HStack(spacing: V5.S.s4) {
            ForEach(days) { d in
                let cell = VStack(spacing: V5.S.s8) {
                    Text(d.letter)
                        .font(.faffText(TypeScaleV5.label12))
                        .foregroundStyle(d.isToday ? V5.OnPanel.primary : V5.OnPanel.quiet)
                    Text(d.number)
                        .font(.faffText(16, weight: d.isToday ? .semibold : .regular))
                        .foregroundStyle(d.isToday ? V5.OnPanel.primary : V5.OnPanel.secondary)
                    Capsule()
                        .fill(rail(d))
                        .frame(maxWidth: 22)
                        .frame(height: 4)
                }
                .padding(.vertical, V5.S.s10)
                .frame(maxWidth: .infinity)
                .background(d.isToday ? Color.white.opacity(0.16) : .clear,
                            in: RoundedRectangle(cornerRadius: V5.R.r16, style: .continuous))
                // Same lesson as every other row: a clear background is not
                // hit-testable, so without this only the day's two glyphs are.
                .contentShape(RoundedRectangle(cornerRadius: V5.R.r16, style: .continuous))

                if let onTap {
                    Button { onTap(d) } label: { cell }.buttonStyle(V5PressStyle())
                } else {
                    cell
                }
            }
        }
    }

    private func rail(_ d: WeekStripDayV5) -> Color {
        if d.isRest { return Color.white.opacity(0.18) }
        if d.isToday { return V5.OnPanel.primary }
        return Color.white.opacity(d.isDone ? 0.55 : 0.30)
    }
}

// MARK: - Week shape
//
// A block week drawn as seven bars sized by that day's load — the shape of the
// week, which is what makes a cutback week legible next to a peak week without
// reading a number.

struct WeekDayLoad: Identifiable, Equatable {
    let id = UUID()
    let miles: Double
    var quality: Bool = false
    var race: Bool = false
    var today: Bool = false
    var future: Bool = false

    init(miles: Double, quality: Bool = false, race: Bool = false,
         today: Bool = false, future: Bool = false) {
        self.miles = miles; self.quality = quality; self.race = race
        self.today = today; self.future = future
    }
}

struct WeekShape: View {
    let days: [WeekDayLoad]
    /// The biggest day across the WHOLE block, so weeks are sized against each
    /// other rather than each against itself. The design lists all 16 weeks
    /// "sized by that week's biggest day", which only reads as a comparison if
    /// the scale is shared.
    let scaleMax: Double
    var height: CGFloat = 34

    var body: some View {
        GeometryReader { geo in
            HStack(alignment: .bottom, spacing: 3) {
                ForEach(days) { d in
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(ink(d))
                        .frame(height: d.miles <= 0 ? 2
                               : Swift.max(d.miles / Swift.max(scaleMax, 0.0001) * geo.size.height, 3))
                }
            }
            .frame(height: geo.size.height, alignment: .bottom)
        }
        .frame(height: height)
    }

    private func ink(_ d: WeekDayLoad) -> Color {
        if d.miles <= 0 { return V5.plotQuiet }
        if d.today { return V5.signal }
        if d.race { return V5.DayState.race.accent }
        if d.quality { return V5.DayState.quality.accent.opacity(d.future ? 0.55 : 0.85) }
        return V5.plotInk.opacity(d.future ? 0.30 : 0.55)
    }
}

// MARK: - Convergence · RULE TWO MADE VISIBLE
//
// "One signal never changes a session. Readiness needs three independent
//  domains to converge before it can downgrade anything, and that is a build
//  gate. Any copy about a changed session names the convergence, never a
//  single cause."
//
// So this component will not render fewer than three domains. If the payload
// carries one or two, that is not a story about a changed session and the
// screen must not tell one — it returns nothing and the caller shows the
// unchanged session. Enforcing it here means no screen can get it wrong by
// forgetting to check.

struct ConvergenceDomainRow: Identifiable, Equatable {
    let id = UUID()
    /// "Sleep", "HRV", "Resting heart rate".
    let domain: String
    /// The reading. Measured.
    let value: FaffValue
    /// What it is being compared against — the runner's OWN rolling baseline.
    /// Readiness has no single evening/morning pair to compare, only a 7-day
    /// median and a 3-day average, so the row says which.
    let baseline: String

    init(domain: String, value: FaffValue, baseline: String) {
        self.domain = domain; self.value = value; self.baseline = baseline
    }
}

struct ConvergenceList: View {
    let domains: [ConvergenceDomainRow]

    /// The gate. Three independent domains, or there is no story.
    static let minimumDomains = 3

    var body: some View {
        if domains.count >= Self.minimumDomains {
            ListGroup(header: "What converged") {
                ForEach(domains) { d in
                    ListRow(label: d.domain, sub: d.baseline, value: d.value)
                }
            }
        }
    }
}
