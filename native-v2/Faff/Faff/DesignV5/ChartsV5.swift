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

// ═════════════════════════════════════════════════════════════════════════
// EVERY GRAPHIC IN THIS FILE IS DRAWN FROM DATA, AND EVERY ONE OF THEM WAS
// SILENT.
//
// The handoff is explicit that nothing here is an asset: "every graphic
// (route line, elevation profile, week shape, phase bar, zone bar, trend
// bars, range scales) is drawn from data with inline SVG/CSS". Drawn from
// data is exactly why they need saying out loud — the data is the content,
// and a `Capsule` or a `RoundedRectangle` produces no accessibility element
// at all. Not an unlabelled image: nothing. A VoiceOver runner swiping
// through Today went from the effort row straight to the shoes, and the zone
// distribution, the elevation and the pace band simply were not on the
// screen as far as they were concerned.
//
// So each component below collapses to ONE element carrying a sentence that
// says what the picture says. Rules that apply throughout:
//
//   · The sentence states the reading, never a grade. No chart in this app
//     tells a runner a distribution was good, and neither does its label.
//   · Where the component already renders a `FaffValue`, the label is built
//     from the same value so the modelled mark survives into speech — a
//     projection that reads "3:16:45" out loud where the screen shows
//     "~3:16:45" is rule one broken in the one place nobody checks.
//   · Amber "outside the band" is a colour. The label says the words.
// ═════════════════════════════════════════════════════════════════════════

// MARK: - RangeScale
//
// A pill track with the asked-for range marked on it and the runner's current
// value sitting somewhere along it. Four modes:
//
//   band      · a target band, and whether you are inside it (live pace)
//   ceiling   · a real ceiling, and how close you are to it (aerobic HR cap
//               on an easy/long day — staying under it is the discipline)
//   progress  · how far through something you are (taper weeks)
//   reference · HR-SEMANTICS-1 (2026-09-01) · a value worth SHOWING but never
//               ENFORCING — the quality-phase "expected response" HR reading
//               (see `LiveRunOutdoorV5.heartReference`). Added because the
//               live run screen was drawing this exact number in `.ceiling`
//               mode: a threshold rep running a few beats past 100% LTHR —
//               normal, expected, not a breach — turned the marker amber and
//               had VoiceOver announce "above the ceiling", the same alarm a
//               real easy-day aerobic-cap breach gets. Doctrine (see
//               `docs/reports/hr-semantics-2026-09-01.md`): pace/effort is
//               the primary instruction on a quality rep, HR is a secondary,
//               informational signal that must never fight it by reading as
//               a hard limit. `.reference` draws no shaded zone and never
//               marks the value out-of-range — it is a number to notice, not
//               a line to stay under.

struct RangeScale: View {
    enum Mode { case band, ceiling, progress, reference }
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

    /// Outside the band is the one thing amber means here. `.reference` never
    /// returns true — see the Mode doc comment: a value that is worth showing
    /// but never enforcing has no "outside" to flag.
    private var outOfRange: Bool {
        guard let value else { return false }
        switch mode {
        case .band:      guard let b = band else { return false }; return value < b.low || value > b.high
        case .ceiling:   guard let b = band else { return false }; return value > b.high
        case .progress:  return false
        case .reference: return false
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
                    case .reference:
                        // No shaded zone, on purpose — see the Mode doc
                        // comment. The plain track plus the value marker
                        // below is the whole picture: a reading, not a line.
                        EmptyView()
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
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken)
    }

    /// What the track says, in words. The amber marker is the only thing that
    /// draws "outside the band", so this is the only place that state exists
    /// for a runner who is not reading the colour.
    ///
    /// THE ENDPOINTS ARE PART OF THE SENTENCE, NOT A FALLBACK.
    ///
    /// `ends` used to be computed and then used only on the three paths where
    /// there was no value to report — so every time the scale actually had
    /// something to say, the caller's own endpoint labels were dropped. The
    /// component ignores its children, and those labels are drawn as children,
    /// so nothing else was carrying them.
    ///
    /// `.progress` was the expensive case. `ShoesV5` passes
    /// `endpoints: ("0 mi", "350 mi retirement")` and the spoken string was
    /// "62% through." — 62% of an amount VoiceOver never stated. A shoe's
    /// mileage against its retirement threshold is the entire content of that
    /// card, and it was unavailable.
    private var spoken: String {
        let ends = endpoints.map { " Scale \($0.0) to \($0.1)." } ?? ""
        switch mode {
        case .band:
            guard let b = band else { return ends.isEmpty ? "Pace scale" : "Pace scale.\(ends)" }
            let range = "Target band \(fmt(b.low)) to \(fmt(b.high))."
            guard let value else { return "\(range) No reading yet.\(ends)" }
            let where_ = outOfRange ? "outside the band" : "inside the band"
            return "\(range) You are at \(fmt(value)), \(where_).\(ends)"
        case .ceiling:
            guard let b = band else { return ends.isEmpty ? "Ceiling scale" : "Ceiling scale.\(ends)" }
            let ceil = "Ceiling \(fmt(b.high))."
            guard let value else { return "\(ceil) No reading yet.\(ends)" }
            return outOfRange
                ? "\(ceil) You are at \(fmt(value)), above the ceiling.\(ends)"
                : "\(ceil) You are at \(fmt(value)), under the ceiling.\(ends)"
        case .progress:
            guard let value else { return (centerLabel ?? "Progress") + ends }
            let pct = Int((frac(value) * 100).rounded())
            let head = centerLabel.map { "\($0). \(pct)% through." } ?? "\(pct)% through."
            return head + ends
        case .reference:
            // Never "ceiling", never "band" — see the Mode doc comment. This
            // is the one mode that says outright it is not a target, so a
            // VoiceOver runner gets the same "informational only" framing a
            // sighted runner gets from the missing shaded zone.
            guard let value else { return ends.isEmpty ? "Reference scale" : "Reference scale.\(ends)" }
            return "You are at \(fmt(value)). Informational only, not a target.\(ends)"
        }
    }

    /// The scale carries raw numbers whose unit lives in the caller's own
    /// endpoint labels, so this stays a plain figure rather than inventing a
    /// unit the component does not know.
    private func fmt(_ v: Double) -> String {
        v == v.rounded() ? String(Int(v)) : String(format: "%.1f", v)
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
    /// The zones the session ASKED FOR, 1-indexed. Empty highlights nothing.
    ///
    /// A race prescribes Z4 AND Z5, which is why this is a set and not one
    /// index — a race rendered with a single highlight put the emphasis on
    /// whichever zone happened to be taller, so the graphic followed the
    /// outcome instead of the prescription.
    ///
    /// IT COMES FROM THE SESSION, NEVER FROM WHERE THE TIME LANDED. The bar
    /// then answers "did it sit where it was asked to" by inspection, which
    /// is the only question it exists to answer.
    var targets: Set<Int> = []
    var height: CGFloat = 44
    var labels: Bool = false

    /// Convenience for the single-zone case (easy runs ask for Z2).
    init(shares: [Double], target: Int?, height: CGFloat = 44, labels: Bool = false) {
        self.init(shares: shares, targets: target.map { [$0] } ?? [], height: height, labels: labels)
    }

    init(shares: [Double], targets: Set<Int> = [], height: CGFloat = 44, labels: Bool = false) {
        self.shares = shares
        self.targets = targets
        self.height = height
        self.labels = labels
    }

    private var total: Double { Swift.max(shares.reduce(0, +), 0.0001) }

    /// EVERY SEGMENT WITH TIME IN IT GETS AT LEAST 6% OF THE BAR.
    ///
    /// Below that a zone renders as a hairline, which reads as "none" rather
    /// than "a little" — and the difference between four minutes in Z5 and
    /// none at all is most of what the bar is for. The floored segment is
    /// visibly the smallest thing on the bar, so it cannot be mistaken for a
    /// large one, and VoiceOver carries the real percentage regardless.
    private static let minShare: Double = 0.06

    /// Fractions after flooring, renormalised so they still sum to 1.
    private var fractions: [Double] {
        let raw = shares.map { Swift.max($0, 0) / total }
        let floored = raw.map { $0 > 0 ? Swift.max($0, Self.minShare) : 0 }
        let sum = Swift.max(floored.reduce(0, +), 0.0001)
        return floored.map { $0 / sum }
    }

    private func width(_ i: Int, in full: CGFloat) -> CGFloat {
        let f = fractions[i]
        return Swift.max(full * CGFloat(f) - 2, f > 0 ? 2 : 0)
    }

    /// A zone the session did not ask for.
    ///
    /// Round three asks for three surface fills — #2F343A / #272B2F / #1F2225
    /// — because on a RACE only three zones are non-target. Implemented that
    /// way first and it was wrong in the general case: five zones need five
    /// steps, the locked palette carries four surfaces, and mapping five onto
    /// four put Z4 and Z5 in the SAME grey. On the AFC half, where the whole
    /// run sat in Z4 and Z5, the bar became two indistinguishable blocks.
    ///
    /// That is precisely the failure the density ramp was written to prevent:
    /// "a bar with no target rendered as one flat grey block and read as a
    /// single value rather than as a distribution."
    ///
    /// So the ramp stays. It steps five ways, it is ordinal rather than
    /// hued — it says WHICH zone without saying whether the distribution was
    /// good — and it recedes behind the signal fill exactly as the handoff
    /// wants. The three named hexes are also new colours against a byte-locked
    /// palette, so they would need their own exemption to exist at all.
    /// THE RAMP KEEPS ITS FIVE STEPS; IT NO LONGER STARTS BELOW VISIBLE.
    ///
    /// It ran `.22 + i*.14` of `plotInk`, which is white at .136 through .484.
    /// Against the `materialTile` these bars sit on that is 1.51:1 at Z1,
    /// 2.06:1 at Z2 and 2.81:1 at Z3 — three of the five segments under the
    /// 3:1 a graphic needs to be read, and Z1 effectively not drawn. The
    /// segment's EXTENT is the content here (how much time sat in that zone),
    /// so a segment you cannot find the ends of carries nothing, and the
    /// `minShare` floor that guarantees a small zone is at least 6% of the bar
    /// was guaranteeing 6% of something invisible.
    ///
    /// Re-based to .55…1.0 of `plotInk` — white .341 through .620, which is
    /// 3.12:1 at Z1 and 7.37:1 at Z5. Still five ordinal steps, still density
    /// rather than hue, still receding behind the signal fill. The range is
    /// compressed, so adjacent steps sit at 1.22–1.27:1 against each other
    /// rather than 1.32–1.37:1; they are separated by a 2pt gap of tile and
    /// each is read against the tile, not against its neighbour.
    ///
    /// `static` and internal so `V5ContrastTests` measures THIS ramp rather
    /// than a copy of the arithmetic. A contrast test that restates the
    /// formula only proves the test agrees with itself.
    static func restFill(_ zoneIndex: Int) -> Color {
        V5.plotInk.opacity(0.55 + Double(zoneIndex) * 0.1125)
    }

    private func restFill(_ zoneIndex: Int) -> Color { Self.restFill(zoneIndex) }

    var body: some View {
        GeometryReader { geo in
            VStack(alignment: .leading, spacing: V5.S.s6) {
                HStack(spacing: V5.S.s2) {
                    ForEach(Array(shares.enumerated()), id: \.offset) { i, s in
                        let isTarget = targets.contains(i + 1)
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
                            .fill(isTarget ? V5.signal : restFill(i))
                            .frame(width: width(i, in: geo.size.width))
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
                    HStack(spacing: V5.S.s2) {
                        ForEach(Array(shares.enumerated()), id: \.offset) { i, s in
                            Text(s > 0 ? "Z\(i + 1)" : "")
                                .font(.faffText(TypeScaleV5.label12))
                                .foregroundStyle(targets.contains(i + 1) ? V5.signal : V5.textQuiet)
                                .lineLimit(1)
                                .fixedSize()
                                .frame(width: width(i, in: geo.size.width), alignment: .leading)
                                .clipped()
                        }
                    }
                }
            }
        }
        .frame(height: labels ? height + V5.S.s6 + 15 : height)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken)
    }

    /// "Time in zone. Zone 2, 58%. Zone 3, 22%. …" — and, where the session
    /// asked for one, which zone that was. The bar's density ramp is ordinal
    /// and the highlight is orange; neither is readable without sight, and
    /// the percentages are the whole content.
    private var spoken: String {
        let parts = shares.enumerated().compactMap { i, s -> String? in
            guard s > 0 else { return nil }
            let pct = Int((s / total * 100).rounded())
            guard pct > 0 else { return nil }
            return "Zone \(i + 1), \(pct)%"
        }
        guard !parts.isEmpty else { return "Time in zone. No reading." }
        let asked = targets.isEmpty ? "" :
            " The session asked for zone " + targets.sorted().map(String.init).joined(separator: " and ") + "."
        return "Time in zone. " + parts.joined(separator: ". ") + "." + asked
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
    /// The move across the window the series covers, already worded by the
    /// server ("Faster by 1m 12s over 12 days"). A `FaffValue` because it is
    /// a figure derived from the same model as the headline, and because the
    /// phone must never re-decide a provenance the wire already carries.
    var delta: FaffValue? = nil
    /// What one bar in the row IS, printed once in the same small quiet
    /// idiom as `headlineLabel` and `footnotes`. `barsSpoken` below gives
    /// VoiceOver a full account of the trend, but a sighted reader gets
    /// nothing from that — without this, the row is unlabeled bars with no
    /// legend. Optional and off by default so a call site that already
    /// captions the chart some other way isn't forced into a second one.
    var caption: String? = nil
    var footnotes: [String] = []

    private var hi: Int {
        highlight < 0 ? values.count + highlight : highlight
    }

    /// ─────────────────────────────────────────────────────────────────────
    /// A CONSTANT IS NOT A CHART.
    ///
    /// `barHeight` below already refuses to exaggerate a series that barely
    /// moves — that is the honest half. It cannot do anything about a series
    /// that does not move at all, which draws as a row of identical
    /// mid-height rectangles and reads as a picture of a trend when it is a
    /// picture of one number, repeated.
    ///
    /// The server decides this (`composeProjectionTrend`, which withholds
    /// `values` entirely when the window never moved a push-worthy 30
    /// seconds) and states the reason in a footnote instead. This is the
    /// phone honouring that: an empty series draws no bar row, no caption
    /// over an absent chart, and no accessibility label describing a trend
    /// that is not on screen. It is not an error state, so nothing is
    /// greyed or dashed; the headline, the delta and the footnotes carry
    /// the whole story on their own.
    private var drawsBars: Bool { !values.isEmpty }

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

    /// The shape of the run, not every bar in it. Reading out twelve weeks of
    /// daily projections one figure at a time is worse than silence; what the
    /// picture actually shows is a direction and two endpoints.
    ///
    /// No units and no "better" or "worse": the series can be a finish time
    /// (down is faster) or a mileage (up is more), and this component is not
    /// told which. It says which way the line went and leaves the meaning to
    /// the headline and footnotes that sit either side of it, both of which
    /// stay their own elements.
    private var barsSpoken: String {
        guard let first = values.first, let last = values.last, values.count > 1 else {
            return "Trend. Not enough reads to draw."
        }
        let dir = last > first ? "rising" : last < first ? "falling" : "flat"
        return "Trend, \(values.count) reads, \(dir). "
             + "The highlighted read is number \(hi + 1) of \(values.count)."
    }

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

            if let delta {
                FaffValueText(delta, font: .faffText(TypeScaleV5.label12), color: V5.textQuiet)
            }

            if drawsBars, let caption {
                Text(caption)
                    .font(.faffText(TypeScaleV5.label12))
                    .foregroundStyle(V5.textQuiet)
            }

            // The BARS get the accessibility label, not the whole component.
            // The headline above is a `FaffValue` and renders its own
            // provenance through `FaffValueText`; folding it into a combined
            // label here would flatten "estimated, 3:16:45" back to "3:16:45"
            // and lose rule one in the one place a sighted reader would never
            // notice.
            if drawsBars {
                GeometryReader { geo in
                    HStack(alignment: .bottom, spacing: V5.S.s2) {
                        ForEach(Array(values.enumerated()), id: \.offset) { i, v in
                            RoundedRectangle(cornerRadius: 2, style: .continuous)
                                .fill(i == hi ? V5.signal : V5.plotInk.opacity(0.32))
                                .frame(height: barHeight(v, in: geo.size.height))
                        }
                    }
                    .frame(height: geo.size.height, alignment: .bottom)
                }
                .frame(height: height)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(barsSpoken)
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

    /// One staggered label row. 12px type on a 1.25 line box, rounded.
    private var labelRowHeight: CGFloat { 15 }

    /// One segment's drawn width. The single source of truth for both the bar
    /// and the name under it — the two drifting apart is the whole bug the
    /// label row below documents.
    func segmentWidth(_ p: PhaseSegment, in total: CGFloat) -> CGFloat {
        total * CGFloat(Double(p.weeks) / totalWeeks) - 2
    }

    /// Where segment `idx` starts, accounting for the 2pt gap the bar's HStack
    /// puts between segments.
    func segmentStart(_ idx: Int, in total: CGFloat) -> CGFloat {
        let weeksBefore = phases.prefix(idx).reduce(0) { $0 + $1.weeks }
        return total * CGFloat(Double(weeksBefore) / totalWeeks)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: V5.S.s6) {
            GeometryReader { geo in
                HStack(spacing: V5.S.s2) {
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

            // A PHASE NAME HAS TO STAND UNDER ITS OWN PHASE.
            //
            // The bar above sizes each segment by that phase's share of the
            // block — `geo.size.width * (weeks / totalWeeks)`. This row used
            // `.frame(maxWidth: .infinity)`, which gives every name an EQUAL
            // share instead. The two only agree for the first phase, so on a
            // real 16-week block (Base 8 · Quality 4 · Race specific 3 ·
            // Taper 1) the bar reads 50/25/19/6 while the names read
            // 25/25/25/25: "Quality" sat under Base's segment, and "Taper"
            // sat a third of the bar to the left of the sliver it names. A
            // runner reading "when does the taper start" off this chart read
            // the wrong week.
            //
            // Same proportional width as the segment, so each name begins
            // where its phase begins. `fixedSize` before the frame lets a
            // name wider than its own sliver spill to the right rather than
            // truncate — a phase is allowed to be one week long, and "Taper"
            // is not allowed to become "Ta…". The final phase hugs the bar's
            // right edge so the spill goes inward instead of off-screen.
            //
            // AND THE NAMES ARE STAGGERED, because at their true positions
            // they do not fit on one line. A 16-week block ends with a 3-week
            // "Race specific" and a 1-week "Taper": at 12px those two names
            // want ~135pt and ~36pt but their segments start only ~60pt
            // apart, so a single row rendered "Race specTaiper" — two labels
            // printed through each other. Verified on the simulator.
            //
            // Shrinking to fit is not available: the design's type floor is
            // "nothing renders smaller than 12px", and a phase name that
            // truncates to "Ta…" is worse than one that moves down a line.
            // So odd-indexed names drop to a second row. Neighbours can then
            // never collide, and every name still BEGINS where its phase
            // begins, which is the thing the chart is for.
            GeometryReader { geo in
                ZStack(alignment: .topLeading) {
                    ForEach(Array(phases.enumerated()), id: \.element.id) { idx, p in
                        Text(p.name)
                            .font(.faffText(TypeScaleV5.label12))
                            .foregroundStyle(p.current ? V5.signal : V5.textQuiet)
                            .lineLimit(1)
                            .fixedSize(horizontal: true, vertical: false)
                            .frame(width: Swift.max(segmentWidth(p, in: geo.size.width), 1),
                                   alignment: idx == phases.count - 1 ? .trailing : .leading)
                            .offset(x: segmentStart(idx, in: geo.size.width),
                                    y: idx.isMultiple(of: 2) ? 0 : labelRowHeight)
                    }
                }
            }
            .frame(height: phases.count > 1 ? labelRowHeight * 2 : labelRowHeight)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken)
    }

    /// The phase names are already drawn under the bar, but which one is
    /// CURRENT is carried by signal orange and a 4pt marker — colour and a
    /// tick, nothing else. This is the sentence that says it.
    private var spoken: String {
        let shape = phases.map { "\($0.name), \($0.weeks) week\($0.weeks == 1 ? "" : "s")" }
            .joined(separator: ". ")
        guard let now = phases.first(where: { $0.current }) else {
            return "Block phases. \(shape)."
        }
        let through = now.at.map { at -> String in
            let wk = Swift.min(Swift.max(at, 0), 1) * Double(now.weeks)
            return " You are \(Int(wk.rounded(.down)) + 1) week"
                 + (Int(wk.rounded(.down)) + 1 == 1 ? "" : "s")
                 + " into it."
        } ?? ""
        return "Block phases. \(shape). Now in \(now.name).\(through)"
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
    /// Neither the chart nor its marks are drawn without one.
    private var hasSeries: Bool { points.count > 1 }

    /// A shape, not a reading. The component is handed bare numbers with no
    /// unit — the caller's own footnote carries "340 ft up" — so this says
    /// where the climbs are rather than inventing feet.
    ///
    /// Thirds, because that is the resolution the eye gets from a 120pt line
    /// on a phone, and because "rises through the middle, drops to the finish"
    /// is the thing a runner is actually looking for.
    private var spoken: String {
        guard points.count > 1 else { return "Elevation profile. No course stored." }
        let n = points.count
        func mean(_ r: Range<Int>) -> Double {
            let s = points[r.clamped(to: 0..<n)]
            return s.isEmpty ? 0 : s.reduce(0, +) / Double(s.count)
        }
        let a = mean(0..<Swift.max(n / 3, 1))
        let b = mean(n / 3..<Swift.max(2 * n / 3, n / 3 + 1))
        let c = mean(2 * n / 3..<n)
        let span = Swift.max((points.max() ?? 0) - (points.min() ?? 0), 0.0001)
        func move(_ from: Double, _ to: Double) -> String {
            let d = (to - from) / span
            if d > 0.12 { return "climbs" }
            if d < -0.12 { return "drops" }
            return "holds"
        }
        let start = (points.first ?? 0) < (points.last ?? 0) ? "finishes higher than it starts"
                  : (points.first ?? 0) > (points.last ?? 0) ? "finishes lower than it starts"
                  : "finishes level with the start"
        return "Elevation profile. First third \(move(a, b)) into the middle, "
             + "last third \(move(b, c)). The course \(start)."
    }

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
            // The line, the two dots and the mark rules are all Shapes, so the
            // whole chart produced nothing at all. The marks' LABELS are drawn
            // below and stay their own elements; what is missing without this
            // is the profile itself.
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(spoken)
            }

            // A mark is a POSITION on the profile. With no profile there is
            // nothing to mark, and the labels sat in an empty box as three
            // orphan lines — on the race screen they also repeat the pace
            // plan's own section names a few rows further down. The footnote
            // below still carries the reason the chart is missing.
            if hasSeries, !marks.isEmpty {
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
                // Read out as "Right, image" between the two paces, three
                // times over on the paces-moved screen. The Was and Now
                // labels either side already carry the direction; the glyph
                // is drawing, not content.
                .accessibilityHidden(true)
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
        // SIX STOPS, IN LAYOUT ORDER, THREE TIMES OVER.
        //
        // The row is a pair of columns plus a gap column, so VoiceOver read
        // "Was", "estimated 6:44", "Now", "estimated 7:08", "Moved", "+24" as
        // six separate elements — and `PacesMovedV5` stacks three of these, so
        // the runner counted eighteen swipes and matched each figure to the
        // word two stops back. `.combine` keeps the children's own labels, so
        // the amber tilde's "estimated" survives into the joined sentence.
        // Same fix, same reason, as `PanelStatPlate`.
        .accessibilityElement(children: .combine)
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
    /// The day this cell is, as `yyyy-MM-dd`.
    ///
    /// A LOOKUP, NEVER AN IDENTITY — `id` is still what a tap hands back. This
    /// is here so the strip can work out the weeks either side of itself by
    /// arithmetic while a swipe is under the finger, which it has to do before
    /// any payload for those weeks could arrive. Optional because the strip is
    /// also built by hand in previews and catalogue screens.
    var dateISO: String? = nil
    /// One letter. M T W T F S S.
    let letter: String
    /// The weekday spelled out, for speech only — never drawn.
    ///
    /// The strip draws single letters, and three of the seven are ambiguous
    /// out loud: T is Tuesday or Thursday, S is Saturday or Sunday. The wire
    /// carries `dateISO`, so the unambiguous name is free rather than guessed
    /// from a position in the row (the strip starts on the runner's own week
    /// boundary, not always Monday).
    var weekday: String? = nil
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

    /// Page the whole strip a week at a time. -1 back, +1 forward.
    var onPageWeek: ((Int) -> Void)? = nil

    /// The strip is drawn INSIDE the panel, so it takes the ramp's ink. Unlike
    /// the screens that own the fill, this is a child of `DayPanel` and the
    /// environment resolves correctly here.
    @Environment(\.v5PanelInk) private var panelInk

    /// THE PILL TRAVELS, IT DOES NOT TELEPORT.
    ///
    /// David: "the week strip doesnt actually slide or move... we need
    /// things to move and to be slick." The plate behind whichever cell is
    /// "today" used to be seven independent `if/else` backgrounds — the old
    /// cell's plate vanished and the new one appeared with no relationship
    /// between them, which reads as a swap, not a slide.
    ///
    /// One namespace, shared across all seven cells and both neighbour
    /// pages — harmless there, since a ghost's `isToday` is always false so
    /// it never claims the id: only the cell that IS today ever attaches
    /// `.matchedGeometryEffect(id: "pill", in:)`, so SwiftUI interpolates
    /// the SAME view's frame from where it was to where it now is.
    @Namespace private var pillSpace

    /// ─────────────────────────────────────────────────────────────────────
    /// A REAL TabView(.page), PORTED A SECOND TIME — David, sixth round:
    /// "I told you so many times to look back and how the old design did
    /// it. that was right." He is right twice over: the old
    /// `Components/WeekStrip.swift` used a genuine `TabView(.page)` — native
    /// UIKit paging physics, an actual finger-tracked scroll view, not an
    /// approximation of one — and the FIRST port of that here was abandoned
    /// on a false result.
    ///
    /// That first attempt sized the TabView by measuring real content in a
    /// hidden background `GeometryReader`, which reports 0 on the first
    /// layout pass — a plausible reason a TabView could come up dead to
    /// touch. It was rebuilt with this exact fixed `.frame(height: 80)` (the
    /// old app's own number, no measurement) and DID start responding to
    /// taps and swipes. What looked like a NEW bug right after — the strip
    /// landing on the wrong week — was tested on a simulator process that,
    /// it turned out later the same session, had failed to actually
    /// terminate between two installs: `xcrun simctl launch` re-activated a
    /// stale process running a DIFFERENT build with old in-memory
    /// `@State`, not a defect in this code. The evidence for that: once
    /// process hygiene was fixed elsewhere in this file's caller, the
    /// exact symptom never reproduced again on the hand-rolled DragGesture
    /// version — which had nothing in common with this TabView version
    /// except being tested on the same confused process.
    ///
    /// So: back to the real thing, verified this time against a PID
    /// confirmed to have actually changed between install and launch, not
    /// concluded from a run that may have been talking to yesterday's app.
    ///
    /// THE NEIGHBOURS ARE DRAWN FROM DATES, NOT FROM DATA. Next week's plan
    /// is a fetch away, and the strip has to be under the finger NOW. Dates
    /// are arithmetic, so the incoming week shows its real day numbers
    /// immediately and its rails stay blank until the payload arrives —
    /// the same honest "not read yet" mark a rest day wears.
    ///
    /// THREE PAGES, NOT EVERY WEEK. The old strip held every week of the
    /// screen it served, already loaded — paging just moved an index
    /// through an array Swift already had. Today's week is one network read
    /// at a time, so this keeps exactly three pages (previous / current /
    /// next) and recentres the instant a page change lands: `page` snaps
    /// back to the middle with no animation, on the same runloop tick
    /// TabView finishes its own swipe — invisible, because the middle page
    /// by then holds exactly what the edge page was already showing.
    @State private var page: Int = 1

    var body: some View {
        TabView(selection: $page) {
            week(neighbour(-7)).tag(0)
            week(days).tag(1)
            week(neighbour(7)).tag(2)
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        // The old app's own number, unmeasured — see the header comment.
        .frame(height: 80)
        .onChange(of: page) { _, p in
            guard p != 1, let onPageWeek else { return }
            onPageWeek(p == 0 ? -1 : 1)
            // `Task { @MainActor in ... }` rather than `DispatchQueue.main
            // .async`. Both land the reset "next tick", but a GCD block is
            // scheduled outside SwiftUI's own actor-isolated update cycle —
            // it can land in the middle of a render pass SwiftUI is already
            // mid-way through, rather than cleanly after one commits. A
            // `Task` hop is still one MainActor turn, and MainActor turns
            // are exactly what SwiftUI's own state commits run on, so this
            // recentre lands where the framework's own updates do.
            Task { @MainActor in
                var t = Transaction()
                t.disablesAnimations = true
                withTransaction(t) { page = 1 }
            }
        }
        // A swipe gesture is not reachable by VoiceOver — the same trap that
        // left the treadmill's speed controls inoperable mid-run. `.page`
        // style already answers VoiceOver's own swipe-to-adjust, but a named
        // action is discoverable without guessing that a page control
        // accepts one.
        .accessibilityAction(named: "Previous week") { onPageWeek?(-1) }
        .accessibilityAction(named: "Next week") { onPageWeek?(1) }
    }

    /// One week of seven cells — `maxWidth`/`maxHeight: .infinity` plus
    /// `contentShape(Rectangle())` so the WHOLE slot is tappable, not just
    /// the drawn cell.
    @ViewBuilder
    private func week(_ ds: [WeekStripDayV5]) -> some View {
        HStack(spacing: V5.S.s4) {
            ForEach(ds) { d in
                let cell = VStack(spacing: V5.S.s8) {
                    Text(d.letter)
                        .font(.faffText(TypeScaleV5.label12))
                        .foregroundStyle(d.isToday ? panelInk.primary : panelInk.quiet)
                    Text(d.number)
                        .font(.faffText(16, weight: d.isToday ? .semibold : .regular))
                        .foregroundStyle(d.isToday ? panelInk.primary : panelInk.secondary)
                    Capsule()
                        .fill(rail(d))
                        .frame(maxWidth: 22)
                        .frame(height: 4)
                }
                .padding(.vertical, V5.S.s10)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background {
                    // Only the "today" cell ever attaches the shared id — see
                    // `pillSpace`'s header comment. This is what turns the
                    // plate into something that SLIDES between two cells
                    // instead of vanishing from one and appearing on another.
                    if d.isToday {
                        RoundedRectangle(cornerRadius: V5.R.r16, style: .continuous)
                            .fill(panelInk.plate)
                            .matchedGeometryEffect(id: "pill", in: pillSpace)
                    }
                }
                .contentShape(Rectangle())

                if let onTap {
                    Button { onTap(d) } label: { cell }
                        .buttonStyle(V5PressStyle())
                        .accessibilityLabel(spoken(d))
                } else {
                    cell.accessibilityElement(children: .ignore)
                        .accessibilityLabel(spoken(d))
                }
            }
        }
        // David, sixth round: "make sure that nothing JUMPS and nothing
        // POPS... If we can animate anything do it." This used to key off
        // ONLY which cell is today, so the pill slid but everything else
        // about a cell — its rail appearing, its label ink switching from
        // quiet to primary — changed in a single unanimated frame. Sharpest
        // case: a neighbour page is drawn as a GHOST (blank rails — "we
        // haven't read that week and must not draw a claim about it"), and
        // the moment the real payload lands its rails, done-marks and inks
        // all snap in at once. Keying on every cell's full drawn state
        // instead of just which one is `isToday` means the whole row
        // crossfades together — the rail fading in rather than appearing,
        // which is what turns "the ghost got replaced" into "this cell
        // learned its answer."
        .animation(V5.Motion.fill, value: ds.map { "\($0.id)|\($0.state.rawValue)|\($0.isDone)|\($0.isRest)" })
    }

    /// The week `offset` days away, as dates only. No state, no rails, no
    /// plate: we have not read that week and must not draw a claim about it.
    /// The `id` is deliberately date-keyed and NOT a plan row id — nothing
    /// can tap these, and a fabricated server id is exactly the sort of
    /// thing that ends up in a request.
    private func neighbour(_ offset: Int) -> [WeekStripDayV5] {
        days.compactMap { d in
            guard let iso = d.dateISO,
                  let base = Self.iso.date(from: iso),
                  let moved = Calendar.current.date(byAdding: .day, value: offset, to: base)
            else { return nil }
            var c = Calendar(identifier: .gregorian)
            c.timeZone = TimeZone(identifier: "UTC")!
            return WeekStripDayV5(id: "ghost:\(Self.iso.string(from: moved))",
                                  letter: d.letter,
                                  weekday: d.weekday,
                                  number: String(c.component(.day, from: moved)),
                                  state: .rest, isToday: false, isDone: false, isRest: true)
        }
    }

    private static let iso: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "UTC")
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()

    // ─────────────────────────────────────────────────────────────────────
    // THE RAIL IS THE ONLY THING THAT SAYS WHAT KIND OF DAY THIS IS, AND IT
    // IS A COLOURED CAPSULE 4 POINTS TALL.
    //
    // Seven cells read out as "M 17", "T 18", "W 19" … "T 20" — the same
    // shape for today, for a rest day, and for a session already done. A
    // runner using VoiceOver could not tell which day of the strip was today,
    // which was the long run, or which they had already run. Two of the seven
    // labels were also literally identical ("T, 18" and "T, 20" differ only
    // in the number, and Tuesday/Thursday share a letter).
    //
    // The state was doubly unavailable: silent to VoiceOver, and carried by
    // opacity alone for anyone reading it — the rest / future / done rails
    // are white at .18, .30 and .55 on a gradient, which measures between
    // 1.13:1 and 1.98:1. Well under the 3:1 a meaningful graphic needs.
    // The label is the fix that does not touch the drawing.
    // ─────────────────────────────────────────────────────────────────────
    private func spoken(_ d: WeekStripDayV5) -> String {
        var parts = [d.weekday ?? d.letter, d.number]
        if d.isToday { parts.append("today") }
        if d.isRest {
            parts.append("rest day")
        } else {
            parts.append(kind(d.state))
            if d.isDone { parts.append("done") }
        }
        return parts.joined(separator: ", ")
    }

    /// A day state names WHICH KIND of day this is. It is never a grade, so
    /// neither is this — "quality" and "long run" are descriptions, not marks.
    private func kind(_ s: V5.DayState) -> String {
        switch s {
        case .easy:    return "easy"
        case .rest:    return "rest day"
        case .quality: return "quality session"
        case .race:    return "race"
        case .phase:   return "block day"
        case .long:    return "long run"
        }
    }

    /// THE RAIL SAYS WHETHER THERE IS A RUN, AND WHETHER IT IS DONE.
    private func rail(_ d: WeekStripDayV5) -> Color {
        guard !d.isRest else { return .clear }
        return panelInk.primary.opacity(d.isDone ? 1.0 : 0.42)
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
            HStack(alignment: .bottom, spacing: V5.S.s4) {
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
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken)
    }

    /// The week's shape as a sentence. Block lists all sixteen weeks this way,
    /// and the only difference between a cutback week and a peak week — the
    /// entire reason the component exists — is the height of seven bars.
    private var spoken: String {
        let total = days.reduce(0) { $0 + $1.miles }
        guard total > 0 else { return "Week shape. No miles this week." }
        let running = days.filter { $0.miles > 0 }.count
        let quality = days.filter { $0.quality && $0.miles > 0 }.count
        let biggest = days.max { $0.miles < $1.miles }?.miles ?? 0
        let mi = { (v: Double) in
            v == v.rounded() ? String(Int(v)) : String(format: "%.1f", v)
        }
        let race = days.contains { $0.race && $0.miles > 0 } ? " Carries a race." : ""
        return "Week shape. \(mi(total)) miles over \(running) day\(running == 1 ? "" : "s"), "
             + "biggest day \(mi(biggest)). "
             + "\(quality) quality session\(quality == 1 ? "" : "s").\(race)"
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

// MARK: - SplitBars
//
// 23a's per-mile split chart. One bar per mile, taller for faster, filled in
// signal when the mile landed inside what the session asked for and in the
// flat control grey when it did not.
//
// Out-of-band is ONE colour in BOTH directions. A mile run fast and a mile run
// slow are both "not what was asked", and giving fast its own colour would be
// grading a number good — the same reason no green appears anywhere in this
// palette as a verdict.
//
// Two things this component refuses to invent:
//
//   1. THE BAND. If the run carries no target — an unplanned run, or a session
//      kind whose spec has no pace window — every bar draws in signal and the
//      spoken label says nothing about a band. Colouring against a made-up
//      target would be rule one at chart scale: a modelled comparison wearing
//      a measured chart's clothes.
//
//   2. THE TRAILING FRAGMENT. A 6.3 mile run has a seventh "mile" that is
//      three tenths long, and its pace is measured over that fragment, so it
//      swings hardest and means least. Drawing it the same width as a whole
//      mile claims a weight it does not have, so it is drawn at its real
//      fraction of a mile and named as a part mile when spoken. This is a
//      deliberate departure from the prototype's equal-width bars, made on
//      the same principle as the amber tilde: nothing should look like more
//      than it is.
struct SplitBar: Identifiable, Equatable {
    var id: Int { mile }
    /// 1-based mile number.
    let mile: Int
    /// Seconds per mile for this split.
    let paceSec: Int
    /// How much of a mile this split actually covers, 0 < fraction <= 1.
    /// Whole miles are 1. Only a trailing fragment is less.
    var fraction: Double = 1
    /// Nil when the run carries no target window.
    var inBand: Bool? = nil

    /// Average heart rate over this split, when the row carried one.
    ///
    /// SPOKEN, NOT DRAWN, AND THAT IS PENDING A RULING.
    ///
    /// `RunSplit` has carried `hr` in the same row the chart reads pace from
    /// since it was written, and nothing has ever read it. Round three item 5
    /// asked design to confirm that this chart is bars only — "no labels, no
    /// scale, it reads beautifully as the shape of a run" — and that question
    /// is still open. Until it is answered, a second visible channel is not
    /// something to add on our own: the chart's one job is the shape, and
    /// height already carries pace.
    ///
    /// So the honest minimum ships. VoiceOver already names every bar with its
    /// mile and its pace, and now names its heart rate too — real data
    /// reaching a real reader, at zero cost to the reading the chart exists
    /// for. If the ruling comes back "give it a visible channel", this field
    /// is already populated and the change is in the drawing, not the wire.
    var hr: Int? = nil
}

struct SplitBars: View {
    let bars: [SplitBar]
    var height: CGFloat = 74

    /// Same padded-domain reasoning as `TrendBars`: a run held honestly at one
    /// pace must not draw as a mountain range. The domain is at least this
    /// fraction of the run's own pace, centred on it.
    private static let domainFloorFraction = 0.06
    private static let barFloorFraction: CGFloat = 0.24
    private static let barMaxWidth: CGFloat = 14

    /// AN OUT-OF-BAND MILE HAS TO BE VISIBLE TO COUNT.
    ///
    /// This drew `V5.materialControl` (#2A2E32) on the `V5.materialTile`
    /// (#17191B) these bars sit on — 1.29:1. The bar was very nearly the tile.
    /// And the fill is the ONLY thing separating a mile that sat inside what
    /// the session asked for from one that did not: the height axis carries
    /// pace. The screen even prints the rule underneath ("Filled where the
    /// mile sat inside what the session asked for"), which is the proof the
    /// colour is load-bearing rather than decorative.
    ///
    /// `plotInk` is the token for "a drawn bar that is not the highlighted
    /// one", which is exactly this, and it measures 7.37:1 on a tile. The
    /// highlight still reads as the highlight.
    ///
    /// `static` and internal so `V5ContrastTests` measures THIS choice rather
    /// than a copy of it — a contrast test that restates the token only proves
    /// the test agrees with itself.
    static func barFill(inBand: Bool?) -> Color {
        (inBand ?? true) ? V5.signal : V5.plotInk
    }

    private func barHeight(_ sec: Int, in full: CGFloat) -> CGFloat {
        let secs = bars.map { Double($0.paceSec) }
        let lo = secs.min() ?? 0
        let hiV = secs.max() ?? 1
        let mid = (lo + hiV) / 2
        let span = Swift.max(hiV - lo, mid * Self.domainFloorFraction, 0.0001)
        // Faster is taller, so the fraction is inverted against pace.
        let frac = 1 - CGFloat((Double(sec) - (mid - span / 2)) / span)
        let scaled = Self.barFloorFraction + (1 - Self.barFloorFraction) * Swift.min(Swift.max(frac, 0), 1)
        return Swift.max(scaled * full, 2)
    }

    private func spoken(_ b: SplitBar) -> String {
        let pace = Units.formatPaceBare(secPerMile: b.paceSec)
        // The FIGURE follows the runner's unit preference; the SPLIT does not.
        // The backend cuts splits per mile whatever the display unit is, so
        // calling one "kilometre 4" to match a preference would name it
        // something it is not.
        let unitWord = Units.distanceLabel() == "km" ? "kilometre" : "mile"
        let which = b.fraction < 0.95
            ? "Part mile \(b.mile), \(Int((b.fraction * 10).rounded())) tenths"
            : "Mile \(b.mile)"
        // The heart rate goes LAST and only when the row carried one. Pace is
        // what the bar's height means and stays the first thing said; a
        // reader listening for mile nine's pace should not have to sit
        // through a heart rate to reach it. A split with no HR says nothing
        // about HR rather than "no data" — absence is not a reading.
        let heart = b.hr.map { ", heart rate \($0)" } ?? ""
        switch b.inBand {
        case .some(true):  return "\(which), \(pace) per \(unitWord), inside the target\(heart)."
        case .some(false): return "\(which), \(pace) per \(unitWord), outside the target\(heart)."
        case .none:        return "\(which), \(pace) per \(unitWord)\(heart)."
        }
    }

    var body: some View {
        GeometryReader { geo in
            HStack(alignment: .bottom, spacing: V5.S.s6) {
                ForEach(bars) { b in
                    UnevenRoundedRectangle(topLeadingRadius: 4, bottomLeadingRadius: 0,
                                           bottomTrailingRadius: 0, topTrailingRadius: 4,
                                           style: .continuous)
                        .fill(Self.barFill(inBand: b.inBand))
                        .frame(maxWidth: Self.barMaxWidth * CGFloat(b.fraction))
                        .frame(height: barHeight(b.paceSec, in: geo.size.height))
                        // EACH MILE CLAIMS AN EQUAL SHARE OF THE WIDTH, and
                        // the bar sits centred inside its share, capped at 14.
                        // Capping the bar alone left every mile hugging the
                        // leading edge with dead space trailing — the chart
                        // read as a run that stopped early rather than one
                        // that filled the tile.
                        .frame(maxWidth: .infinity)
                        // Each mile is its own element. Unlike a twelve-week
                        // trend, where the shape is the story and the figures
                        // are noise, a runner asking about mile nine wants
                        // mile nine.
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel(spoken(b))
                }
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .bottom)
        }
        .frame(height: height)
        // A RUN OF ELEMENTS WITH NOTHING SAYING WHAT THE RUN IS.
        //
        // Each bar names itself ("Mile 9, 7:42 per mile, inside the target"),
        // which is right — a runner asking about mile nine wants mile nine.
        // But twenty of them arrived with no announcement, so the first one
        // read as a stray sentence in the middle of the screen. `.contain`
        // groups them under one name without collapsing the per-mile detail.
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Splits, \(bars.count) miles")
    }
}
