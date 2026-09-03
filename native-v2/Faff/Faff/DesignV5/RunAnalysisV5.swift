import SwiftUI

// MARK: - RunAnalysisV5 · the synchronised chart stack
//
// PR-8 (pace) · PR-9 (heart rate) · PR-10 (elevation) · PR-11 (the overlay).
//
// ═══════════════════════════════════════════════════════════════════════════
// ONE AXIS, SELECTABLE LAYERS, AND WHY IT IS BUILT THAT WAY
//
// The post-run brief asks for "one synchronized chart stack with selectable
// layers" and lists its requirements in order: shared x-axis · phase
// boundaries and labels · target range overlay ONLY over the phases it applies
// to · honest gaps for missing data · VoiceOver summary plus an accessible
// data table · avoid dual axes that make comparison unreadable · modelled
// values marked consistently.
//
// Every one of those is a decision this file had to make, and the two that
// shaped it most:
//
//   NO DUAL AXES. Pace and heart rate are never drawn on top of each other
//   against two scales. That is the chart the brief warns about by name, and
//   it is unreadable for a specific reason: the two axes have no common zero,
//   so where the lines cross is an artefact of where you put them. The layers
//   are SELECTED instead, and the phase bands stay put underneath, so the eye
//   carries the alignment across a tap rather than the chart faking it. The
//   pace layer alone carries a second series — the target — and that one
//   shares its axis honestly, because it is a pace.
//
//   THE TARGET IS DRAWN PER BAND. Not one line across the session. On the
//   owner's 2026-09-01 threshold run the warm-up asked for 8:22 and the reps
//   asked for 7:10, and a single line at either value marks the other half of
//   the run a failure. The jogs and the strides carry no target at all and get
//   no line — which is the same rule that stops a strides day being drawn as
//   six misses.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT THIS FILE REFUSES TO DRAW
//
//   · NO VERDICT COLOUR. A pace inside its band and a pace outside it are the
//     same ink. This is Layer 2 — the shape of the session — and the grade is
//     already stated by the coach card and the rep list above it (Rule 17).
//     `RepBreakdownV5` is where a rep is judged. Colouring the line green for
//     good would also be the one thing this palette forbids outright.
//   · NO WHOLE-RUN AVERAGE LINE. It would be exactly the number this surface
//     exists to keep off an interval session.
//   · NO NUMBERS ALREADY ON THE SCREEN. The mile table prints per-mile pace
//     and heart rate; the stats row prints the run's own. This chart prints an
//     axis and the value under the runner's finger, and nothing else.

// MARK: - Which layer

enum RunAnalysisLayer: String, CaseIterable, Identifiable {
    case pace, heart, elevation
    var id: String { rawValue }

    var title: String {
        switch self {
        case .pace:      return "Pace"
        case .heart:     return "Heart rate"
        case .elevation: return "Elevation"
        }
    }
}

// MARK: - The line

/// The series as a `Shape`, so no drawing maths runs inside a `ViewBuilder`.
///
/// A NIL BREAKS THE PATH. `move(to:)` rather than `addLine(to:)` after a gap,
/// so a stretch the run did not record is a hole in the line and not a chord
/// across it. That is the whole of the brief's "honest gaps" requirement, and
/// it is one branch.
struct RunAnalysisLine: Shape {
    /// One entry per column. Nil is a gap.
    let values: [Double?]
    /// The value domain, low first. Pace is INVERTED by the caller so that
    /// faster draws higher, which is what the reference does and what every
    /// runner expects.
    let lo: Double
    let hi: Double
    /// Close the path to the baseline for a filled area.
    var closed: Bool = false

    func path(in rect: CGRect) -> Path {
        var p = Path()
        guard values.count > 1 else { return p }
        let span = Swift.max(hi - lo, 0.0001)
        let dx = rect.width / CGFloat(values.count - 1)

        func point(_ i: Int, _ v: Double) -> CGPoint {
            CGPoint(x: rect.minX + dx * CGFloat(i),
                    y: rect.maxY - CGFloat((v - lo) / span) * rect.height)
        }

        var open = false
        var runStart = 0
        for (i, v) in values.enumerated() {
            guard let v else {
                // Close the fill on the segment that just ended, then break.
                if open && closed {
                    p.addLine(to: CGPoint(x: rect.minX + dx * CGFloat(i - 1), y: rect.maxY))
                    p.addLine(to: CGPoint(x: rect.minX + dx * CGFloat(runStart), y: rect.maxY))
                    p.closeSubpath()
                }
                open = false
                continue
            }
            if !open {
                if closed {
                    p.move(to: CGPoint(x: rect.minX + dx * CGFloat(i), y: rect.maxY))
                    p.addLine(to: point(i, v))
                } else {
                    p.move(to: point(i, v))
                }
                runStart = i
                open = true
            } else {
                p.addLine(to: point(i, v))
            }
        }
        if open && closed {
            p.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
            p.addLine(to: CGPoint(x: rect.minX + dx * CGFloat(runStart), y: rect.maxY))
            p.closeSubpath()
        }
        return p
    }
}

/// The per-band target, drawn as a stepped line that exists only where a band
/// carries one. Same geometry as `RunAnalysisLine`, fed a values array that is
/// nil everywhere the session asked for nothing.
private struct TargetSteps: Shape {
    let values: [Double?]
    let lo: Double
    let hi: Double

    func path(in rect: CGRect) -> Path {
        var p = Path()
        guard values.count > 1 else { return p }
        let span = Swift.max(hi - lo, 0.0001)
        let dx = rect.width / CGFloat(values.count - 1)
        var open = false
        for (i, v) in values.enumerated() {
            guard let v else { open = false; continue }
            let pt = CGPoint(x: rect.minX + dx * CGFloat(i),
                             y: rect.maxY - CGFloat((v - lo) / span) * rect.height)
            if open { p.addLine(to: pt) } else { p.move(to: pt); open = true }
        }
        return p
    }
}

// MARK: - The stack

struct RunAnalysisV5: View {
    let analysis: RunAnalysis
    /// PR-12 · the run's grade-adjusted pace and its label, when the terrain
    /// moved the read far enough for the server to publish one. Both nil is
    /// the common case and draws nothing.
    var gradeAdjustedSecPerMi: Int? = nil
    var terrainLabel: String? = nil

    @State private var layer: RunAnalysisLayer = .pace
    /// The column under the runner's finger, or nil.
    @State private var probe: Int? = nil

    private static let plotHeight: CGFloat = 132

    // ── which layers this run can actually offer ───────────────────────────
    //
    // RULE THREE. A layer is offered only when the run recorded it. A picker
    // with an "Elevation" tab that draws a flat line on a run whose splits
    // never carried one is a measurement we do not have, presented as one we
    // do — rule one, at chart scale.
    private var layers: [RunAnalysisLayer] {
        var out: [RunAnalysisLayer] = []
        if analysis.hasPace { out.append(.pace) }
        if analysis.hasHr { out.append(.heart) }
        if analysis.elevation?.isEmpty == false { out.append(.elevation) }
        return out
    }

    var body: some View {
        // RULE THREE, at the top: a stack with no layer draws nothing at all
        // rather than a header over an empty box.
        if layers.isEmpty {
            EmptyView()
        } else {
            Tile {
                header
                if layers.count > 1 { picker }
                plot
                axis
                if let line = captionLine {
                    Text(line)
                        .font(.faffText(TypeScaleV5.label12))
                        .foregroundStyle(V5.textQuiet)
                        .fixedSize(horizontal: false, vertical: true)
                }
                gradeAdjustedRow
            }
        }
    }

    /* NO `.accessibilityElement(children: .combine)` ON THE TILE, and that is
     * a correction rather than an omission.
     *
     * It was there, with the spoken summary as the tile's label — and
     * combining the children swallows the layer picker, so a VoiceOver user
     * could not have switched to the heart-rate or elevation layer at all.
     * The summary belongs to the PLOT, which is the one part of this tile that
     * is genuinely opaque to a screen reader; the picker stays three ordinary
     * buttons and the caption stays ordinary text. See `plot`. */

    // MARK: Header

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            Text("The shape of the run")
                .font(.faffText(TypeScaleV5.label13))
                .foregroundStyle(V5.textSecondary)
            Spacer(minLength: V5.S.s8)
            // THE VALUE UNDER THE FINGER, and only while there is one. It
            // replaces nothing: with no touch there is no reading here, so the
            // chart never competes with the stats row above it (Rule 17).
            if let readout {
                FaffValueText(readout, font: .faffText(TypeScaleV5.label14, weight: .medium))
            }
        }
    }

    private var readout: FaffValue? {
        guard let probe, probe >= 0, probe < analysis.points.count else { return nil }
        let p = analysis.points[probe]
        switch layer {
        case .pace:
            // NO `?? ""`. A pace this formatter could not render is a pace we
            // could not read, and `.unreadable` is what that is — a fallback
            // constant inside a measured value prints a number we do not have
            // as one we do. `check-modelled-mark.sh` guard 4 caught the first
            // draft of this line doing exactly that.
            guard let s = p.paceSecPerMi,
                  let text = FaffFmt.pace(secPerMi: Double(s)) else { return .unreadable }
            return .measured("\(text)/mi · \(mileWord(p.atMi))")
        case .heart:
            guard let hr = p.hrBpm else { return .unreadable }
            return .measured("\(hr) bpm · \(mileWord(p.atMi))")
        case .elevation:
            guard let e = elevationAt(p.atMi) else { return .unreadable }
            return .measured("\(Int(e.rounded())) ft · \(mileWord(p.atMi))")
        }
    }

    private func mileWord(_ mi: Double) -> String {
        String(format: "%.2f mi", mi)
    }

    // MARK: Picker

    private var picker: some View {
        HStack(spacing: V5.S.s6) {
            ForEach(layers) { l in
                let on = l == layer
                Text(l.title)
                    .font(.faffText(TypeScaleV5.label12, weight: on ? .medium : .regular))
                    .foregroundStyle(on ? V5.textPrimary : V5.textQuiet)
                    .padding(.horizontal, V5.S.s10)
                    .padding(.vertical, V5.S.s6)
                    .background(on ? V5.materialControl : Color.clear,
                                in: Capsule())
                    .contentShape(Capsule())
                    .onTapGesture { layer = l; probe = nil }
                    .accessibilityAddTraits(on ? [.isSelected, .isButton] : .isButton)
            }
            Spacer(minLength: 0)
        }
    }

    // MARK: The plot

    @ViewBuilder
    private var plot: some View {
        let series = values
        let domain = self.domain(series)
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                // ── phase bands, behind everything ────────────────────────
                //
                // The WORK is lifted and everything else recedes — the
                // reference's own idea, and the rule at the top of this
                // surface: never let the eye read a recovery jog as part of
                // the effort. A single-phase recording has no bands and this
                // draws nothing.
                ForEach(analysis.bands) { b in
                    if b.isWork {
                        let x0 = x(b.fromMi, in: geo.size.width)
                        let x1 = x(b.toMi, in: geo.size.width)
                        Rectangle()
                            .fill(V5.signal.opacity(0.08))
                            .frame(width: Swift.max(x1 - x0, 1), height: geo.size.height)
                            .offset(x: x0)
                    }
                }

                /* ── THE SERIES, IN TWO PASSES ────────────────────────────
                 *
                 * THE WHOLE RUN QUIET, THEN THE WORK ON TOP. This was one
                 * pass in one ink with a heavy area fill, and rendered
                 * against the owner's real 2026-09-01 session it failed:
                 * the fill swamped the plot, and the four reps were barely
                 * separable from the warm-up and the cool-down around them.
                 * The reference the owner supplied for this surface
                 * (`03-workout-analysis-splits`) shows the idea it was
                 * missing — work segments highlighted, recoveries
                 * de-emphasised — and that is what two passes give.
                 *
                 * THIS IS NOT A VERDICT COLOUR. It says WHICH KIND of
                 * segment this is, exactly as the day-state ramps say which
                 * kind of day: `V5.plotInk` is the token for "a drawn line
                 * that is not the highlighted one", and the highlight here
                 * is the work, not a pace that was good. A rep run slower
                 * than its target draws in the same signal as one run
                 * faster.
                 *
                 * The fill is faint and follows the QUIET line only, so it
                 * gives the plot a body without competing with the reps. */
                RunAnalysisLine(values: series, lo: domain.lo, hi: domain.hi, closed: true)
                    .fill(V5.plotInk.opacity(0.10))
                RunAnalysisLine(values: series, lo: domain.lo, hi: domain.hi)
                    .stroke(V5.plotInk, style: StrokeStyle(lineWidth: 1.4,
                                                           lineCap: .round, lineJoin: .round))
                if hasWorkBands {
                    RunAnalysisLine(values: workOnly(series), lo: domain.lo, hi: domain.hi)
                        .stroke(lineInk, style: StrokeStyle(lineWidth: 2,
                                                            lineCap: .round, lineJoin: .round))
                }

                // ── the target, per band, pace layer only ─────────────────
                if layer == .pace {
                    TargetSteps(values: targetValues, lo: domain.lo, hi: domain.hi)
                        .stroke(V5.textQuiet,
                                style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                }

                // ── the probe ─────────────────────────────────────────────
                if let probe, series.indices.contains(probe) {
                    Rectangle()
                        .fill(V5.plotQuiet)
                        .frame(width: 1, height: geo.size.height)
                        .offset(x: geo.size.width * CGFloat(probe)
                                / CGFloat(Swift.max(series.count - 1, 1)))
                }
            }
            .contentShape(Rectangle())
            /* ── HOLD TO SCRUB, SWIPE TO SCROLL ────────────────────────────
             *
             * A bare `DragGesture(minimumDistance: 0)` was here and it BROKE
             * THE PAGE. It claims the touch on contact, so a runner who begins
             * a normal upward swipe anywhere over the plot does not scroll —
             * the screen simply stops moving, with no indication why. Found by
             * rendering, not by reading: two identical screenshots in a row
             * while trying to scroll past the chart is what it looks like.
             *
             * A short press first is the standard scrub gesture and it
             * resolves the conflict at the right level: a swipe never
             * qualifies, so the ScrollView keeps every one of them, and a
             * deliberate hold hands the touch to the chart.
             */
            .gesture(
                LongPressGesture(minimumDuration: 0.12)
                    .sequenced(before: DragGesture(minimumDistance: 0))
                    .onChanged { value in
                        guard case .second(true, let drag?) = value else { return }
                        let f = Swift.min(Swift.max(drag.location.x / geo.size.width, 0), 1)
                        probe = Int((f * CGFloat(Swift.max(series.count - 1, 1))).rounded())
                    }
                    .onEnded { _ in probe = nil }
            )
        }
        .frame(height: Self.plotHeight)
        /* THE SPOKEN CHART. A drawing is opaque to a screen reader, so the
         * server's summary stands in for it — it names the layers present, the
         * GRAIN they were drawn at, how many work segments are marked, and how
         * many columns recorded nothing.
         *
         * THE ACCESSIBLE DATA TABLE the brief also asks for is already on this
         * screen, twice, above this tile: `MileBreakdownV5` reads every mile's
         * pace, heart rate and elevation change, and `RepBreakdownV5` reads
         * every rep against its target. Adding a third rendering of the same
         * numbers underneath the chart would be Rule 17 with a VoiceOver
         * excuse. */
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(analysis.accessibilitySummary)
    }

    /// The ink for the WORK pass. The base pass is always `V5.plotInk`.
    ///
    /// ONE INK FOR EVERY LAYER, and that is a correction. It read
    /// `layer == .pace ? V5.signal : V5.plotInk` — written when there was a
    /// single pass and the layer needed distinguishing — and rendered against
    /// the owner's real session the heart-rate layer drew its work pass in the
    /// SAME grey as the base pass underneath it. The reps were invisible on
    /// exactly the layer where "did his heart settle inside the reps" is the
    /// question, and the second pass was drawing nothing at all.
    ///
    /// NEITHER INK GRADES ANYTHING. `signal` is the accent for the thing being
    /// read; `plotInk` is the token for "a drawn line that is not the
    /// highlighted one". Which segment, never how it went.
    private var lineInk: Color { V5.signal }

    /// The layer's values, one per column, nil where nothing was recorded.
    ///
    /// PACE IS NEGATED so that faster draws higher. Without it the chart is
    /// upside down against every reference and against the runner's intuition;
    /// with it the axis labels have to be reversed too, which `axis` does.
    private var values: [Double?] {
        switch layer {
        case .pace:
            return analysis.points.map { $0.paceSecPerMi.map { -Double($0) } }
        case .heart:
            return analysis.points.map { $0.hrBpm.map(Double.init) }
        case .elevation:
            return analysis.points.map { elevationAt($0.atMi) }
        }
    }

    /// Does this session have work segments to lift at all?
    ///
    /// False on a steady run, where the second pass would be the same line
    /// drawn twice — and on a strides day, because `isWork` excludes a stride.
    /// Six 20-second accelerations lit up as the session's work would say this
    /// was a rep workout, which it was not.
    private var hasWorkBands: Bool { analysis.bands.contains(where: { $0.isWork }) }

    /// The series masked to the work bands. Nil everywhere else.
    ///
    /// NO OVERLAP AT THE EDGES, and that is a correction made at the screen
    /// rather than in the reading. The first draft widened each run by one
    /// column on both sides to avoid a hairline where the two passes abut —
    /// and on the owner's real 2026-09-01 session the one-minute jogs are a
    /// single column wide, so a jog flanked by two reps was claimed by both
    /// and drew ENTIRELY in the work ink. The chart said the recoveries were
    /// the work, which is the one thing this two-pass drawing exists to stop.
    ///
    /// There is no gap to avoid: the quiet line is a full-length pass drawn
    /// underneath this one, so where the highlight stops the quiet line is
    /// already there.
    private func workOnly(_ s: [Double?]) -> [Double?] {
        let pts = analysis.points
        return s.indices.map { i in
            let inWork = analysis.bands.contains {
                $0.isWork && pts[i].atMi >= $0.fromMi && pts[i].atMi <= $0.toMi
            }
            return inWork ? s[i] : nil
        }
    }

    /// The target for each column, nil outside a band that carries one.
    private var targetValues: [Double?] {
        analysis.points.map { p in
            guard let b = analysis.bands.first(where: { p.atMi >= $0.fromMi && p.atMi <= $0.toMi }),
                  let t = b.targetSecPerMi else { return nil }
            return -Double(t)
        }
    }

    /// Elevation on the point axis. The elevation series has its own, coarser
    /// grain — one entry per mile — so it is read by position rather than
    /// resampled into a second array that could fall out of step with the first.
    private func elevationAt(_ mi: Double) -> Double? {
        guard let e = analysis.elevation, e.count > 1 else { return nil }
        if mi <= e[0].atMi { return e[0].ft }
        for i in 1..<e.count where mi <= e[i].atMi {
            let a = e[i - 1], b = e[i]
            let span = b.atMi - a.atMi
            guard span > 0 else { return b.ft }
            // Linear WITHIN a recorded mile, which is not an invention: the
            // split states the whole mile's change and says nothing about how
            // it was distributed, so a straight line between two measured
            // points is the only shape the data supports. Contrast the pace
            // and heart layers, where a gap means NO reading and is left as a
            // hole — here both endpoints were measured.
            return a.ft + (b.ft - a.ft) * ((mi - a.atMi) / span)
        }
        return e[e.count - 1].ft
    }

    /// The value domain, padded so a run held honestly at one pace does not
    /// draw as a mountain range. Same reasoning as `SplitBars` and `TrendBars`.
    private func domain(_ s: [Double?]) -> (lo: Double, hi: Double) {
        let vs = s.compactMap { $0 } + (layer == .pace ? targetValues.compactMap { $0 } : [])
        guard let lo = vs.min(), let hi = vs.max() else { return (0, 1) }
        let mid = (lo + hi) / 2
        let floorSpan = Swift.max(abs(mid) * 0.06, 1)
        let span = Swift.max(hi - lo, floorSpan)
        let pad = span * 0.12
        return (mid - span / 2 - pad, mid + span / 2 + pad)
    }

    private func x(_ mi: Double, in width: CGFloat) -> CGFloat {
        let last = analysis.points.last?.atMi ?? 1
        guard last > 0 else { return 0 }
        return width * CGFloat(Swift.min(Swift.max(mi / last, 0), 1))
    }

    // MARK: Axis

    /// Distance ticks along the bottom. Whole miles where they fit, so the
    /// runner reads "4 mi" and not "3.87".
    private var axis: some View {
        let last = analysis.points.last?.atMi ?? 0
        let step: Double = last > 12 ? 4 : last > 6 ? 2 : 1
        let ticks = stride(from: step, through: last, by: step).map { $0 }
        return GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                ForEach(ticks, id: \.self) { t in
                    Text("\(Int(t)) mi")
                        .font(.faffText(TypeScaleV5.label12))
                        .foregroundStyle(V5.textQuiet)
                        .fixedSize()
                        .offset(x: Swift.max(0, x(t, in: geo.size.width) - 14))
                }
            }
        }
        .frame(height: 14)
        .accessibilityHidden(true)
    }

    // MARK: Caption

    /// ONE line, and it says the two things a glance cannot: what grain this
    /// was drawn at, and — on the elevation layer — that the numbers are a
    /// shape rather than an altitude.
    private var captionLine: String? {
        switch layer {
        case .elevation:
            return "Feet gained and lost from the start, mile by mile. Not height above sea level."
        case .heart:
            return analysis.isSampled ? nil : "One reading per mile."
        case .pace:
            var parts: [String] = []
            if !analysis.isSampled { parts.append("One reading per mile.") }
            if analysis.bands.contains(where: { $0.targetSecPerMi != nil }) {
                parts.append("The dashed line is what each piece asked for.")
            }
            return parts.isEmpty ? nil : parts.joined(separator: " ")
        }
    }

    // MARK: PR-12 · what the effort was worth on the flat

    /// The grade-adjusted pace, on the PACE layer, beside the real pace, and
    /// only when the terrain actually moved the read.
    ///
    /// ─────────────────────────────────────────────────────────────────────
    /// THREE RULES MEET ON THIS ROW AND ALL THREE ARE LOAD-BEARING
    ///
    /// 1 · IT IS MODELLED, so it wears the tilde. It is the output of a linear
    ///     energy-cost model, not a reading off an instrument, and rule one is
    ///     that a modelled number must never look measured. `FaffValue.modelled`
    ///     is how it says so; the tilde is drawn by `FaffValueText` and is
    ///     never typed into the string, because a literal one can be truncated,
    ///     copied or written by a caller who does not know what it means.
    ///
    /// 2 · IT IS NEVER "YOUR PACE". `lib/terrain/grade-adjust.ts`, in its own
    ///     header: "grade-adjusted pace is for judging effort. It is NEVER what
    ///     the runner ran." So the label says what it is, and the real pace
    ///     stays where it is, in the stats row at the top of the screen.
    ///
    /// 3 · `terrain_label` IS THE GATE, not a decoration. On a flat road run
    ///     the adjusted pace equals the real pace exactly and the server sends
    ///     no label. Drawing the row anyway would print the same number twice
    ///     under two names on nearly every run (Rule 17), which is how a true
    ///     number becomes noise.
    ///
    /// THERE IS NO PER-MILE GAP SERIES, deliberately. Recomputing the
    /// adjustment per split needs per-split GAIN and LOSS, and a split row
    /// carries only a signed NET change — so a rolling mile that climbed sixty
    /// feet and dropped sixty would adjust to nothing. That is not the owner's
    /// model at a finer grain, it is a second and worse model wearing its name,
    /// and there is exactly one course-adjustment coefficient in this app.
    @ViewBuilder
    private var gradeAdjustedRow: some View {
        if layer == .pace, terrainLabel != nil, let gap = gradeAdjustedSecPerMi,
           let text = FaffFmt.paceUnit(secPerMi: Double(gap)) {
            HStack(alignment: .firstTextBaseline, spacing: V5.S.s8) {
                Text("Worth on the flat")
                    .font(.faffText(TypeScaleV5.label13))
                    .foregroundStyle(V5.textSecondary)
                Spacer(minLength: V5.S.s8)
                FaffValueText(.modelled(text), font: .faffText(TypeScaleV5.label14, weight: .medium))
            }
        }
    }
}
