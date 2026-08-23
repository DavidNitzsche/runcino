//
//  WatchKitV5.swift
//  FaffWatch
//
//  The shared vocabulary every 0821 board is built from.
//
//  SOURCE OF TRUTH — see WatchThemeV5.swift's header. This file holds no
//  design decisions of its own: every number in it is from the handoff
//  README, and where a component encodes a RULE the rule is named in the
//  comment so a future edit can see what it would be breaking.
//
//  Build boards out of these. A board that reaches past them for a raw
//  Color, a raw font size or a hand-rolled button is how thirteen rules
//  become twelve.
//

import SwiftUI

// MARK: - The steps between `value` and `valueDim`
//
// WatchThemeV5 declares three white steps — 1.0, .72, .48 — and the 0821 file
// draws four more between and below them. Every board that wanted one reached
// for `.opacity()` at the call site, which is how a step becomes a literal and
// a literal becomes a drift: five boards asking for "the coach's sentence"
// brightness were spelling it three different ways.
//
// These are DERIVATIONS of `value`, not new hues, so they carry no hex and the
// palette gate has nothing to assert about them. They live here rather than in
// WatchThemeV5 only because this pass may not edit that file; move them up to
// sit beside `valueDim` and `valueMute` the next time it is open, and delete
// this extension.
extension WatchV5 {

    /// A coach sentence drawn OVER a day-state ramp — Complete, the lobby's
    /// one note, the rest-day refusal. Brighter than `prose` because the ramp
    /// is competing with it. Measured: `rgba(255,255,255,.92)`.
    static let proseOnRamp = Color.white.opacity(0.92)

    /// A coach sentence on a black board — the battery board, the ceiling
    /// override, first launch, the stale plan. The only sentence on a board
    /// the runner is standing still to read, so it sits above `valueDim`.
    /// Measured: `rgba(255,255,255,.86)`.
    static let prose       = Color.white.opacity(0.86)

    /// A FACT stated under the hero and not itself a metric — Complete's
    /// "48:12 · 8:01 /mi", the lobby's band line. Measured:
    /// `rgba(255,255,255,.82)`.
    static let valueStated = Color.white.opacity(0.82)

    /// Kickers, grouped-row labels, and the unit under a figure on a board
    /// that is not a running face. BELOW `valueDim`, not above it: this step
    /// is the one that gets out of the way. Measured: every kicker in the
    /// 0821 file is `rgba(255,255,255,.62)` or `.5`, and the graded unit's
    /// white twin is `.62` as well.
    static let valueLabel  = Color.white.opacity(0.62)
}

// MARK: - Board scaffold

/// Every board. True-black ground, and the top 22pt left empty because the
/// system clock owns that corner and the app cannot restyle it (rule 5).
///
/// `ignoresSafeArea` is deliberate and load-bearing: the design is drawn to
/// the physical screen, and letting watchOS inset it would move every number
/// down into the space the clock clearance already accounts for.
struct WBoard<Content: View>: View {
    var background: AnyView = AnyView(WatchV5.ground)
    /// Boards that scroll (Summary is the only one) manage their own bottom
    /// inset, so they opt out of the fixed bottom padding.
    var scrolls: Bool = false
    @ViewBuilder var content: () -> Content

    var body: some View {
        ZStack(alignment: .topLeading) {
            background.ignoresSafeArea()
            content()
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, WatchV5.Metric.clockClearance)
                .padding(.horizontal, WatchV5.Metric.sidePadding)
                .padding(.bottom, scrolls ? 0 : WatchV5.Metric.bottomPadding)
        }
        .ignoresSafeArea()
    }
}

/// A board whose ground is a day-state ramp — the lobby, the pre-session
/// boards, the Fuel moment and the Smart Stack widget. The one place colour
/// fills a screen, which is exactly why a ramp is not a verdict on a figure.
struct WGradientBoard<Content: View>: View {
    let session: String
    var scrolls: Bool = false
    @ViewBuilder var content: () -> Content

    var body: some View {
        WBoard(background: AnyView(WRamp(session: session)), scrolls: scrolls) {
            content()
        }
    }
}

/// The ramp itself, with its grain. Split out so the Smart Stack widget can
/// use it at a different radius without re-deriving the stops.
struct WRamp: View {
    let session: String

    var body: some View {
        let stops = WatchV5.DayState.forSession(session)
        let locs  = WatchV5.DayState.locations(for: session)

        // The design's third stop sits past 1.0 on purpose, so the deep end
        // stays only just darker than the middle. SwiftUI clamps, so we hand
        // it the clamped positions and accept the slightly shallower tail —
        // the STOPS are the locked part, the interpolation is the renderer's.
        LinearGradient(
            stops: zip(stops, locs).map {
                .init(color: $0.0, location: min(1.0, $0.1))
            },
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .overlay(WGrain())
    }
}

/// The grain layer — over the colour, under the type, 50%, overlay blend.
///
/// NOT decoration. It is what keeps white type legible on a ramp without a
/// scrim, and the handoff says so explicitly: do not drop it. The design
/// specifies SVG feTurbulence fractalNoise, which has no SwiftUI equivalent,
/// so this is a deterministic value-noise tile generated once and drawn
/// repeating. Deterministic matters — a grain that reshuffles between renders
/// is motion, and rule 13 is that motion is the failure this system was built
/// against.
struct WGrain: View {
    var body: some View {
        Image(uiImage: WGrain.tile)
            .resizable(resizingMode: .tile)
            .blendMode(.overlay)
            .opacity(WatchV5.DayState.grainOpacity)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }

    /// 64×64 is large enough that the repeat is invisible at watch scale and
    /// small enough to cost nothing. Built once, on first use.
    static let tile: UIImage = {
        let side = 64
        var pixels = [UInt8](repeating: 0, count: side * side * 4)
        // A fixed LCG, not Int.random: same tile every launch, on every watch.
        var seed: UInt64 = 0x5A1F_F2B0_3C3E_BD41
        for i in 0..<(side * side) {
            seed = seed &* 6364136223846793005 &+ 1442695040888963407
            let v = UInt8((seed >> 33) & 0x3F) &+ 0x70   // mid-grey ± a little
            pixels[i * 4 + 0] = v
            pixels[i * 4 + 1] = v
            pixels[i * 4 + 2] = v
            pixels[i * 4 + 3] = 255
        }
        let cs = CGColorSpaceCreateDeviceRGB()
        guard let ctx = CGContext(data: &pixels, width: side, height: side,
                                  bitsPerComponent: 8, bytesPerRow: side * 4,
                                  space: cs,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
              let cg = ctx.makeImage() else {
            return UIImage()
        }
        return UIImage(cgImage: cg)
    }()
}

// MARK: - Targets
//
// EVERY target is 50pt tall, full width, pill radius. No exceptions,
// including on faults and confirmations, because the hand pressing them is
// wet and moving (rule 6). The stack gap is 5pt and the reading block sits
// 7pt above it.

/// How much weight a target carries. `filled` leads; `quiet` is the option
/// that is equally legitimate but that the runner reaches for less often.
enum WTargetWeight {
    /// White fill, black label, and the label steps up to 19pt. ONE per
    /// board — the verb that leads. Measured: `Lap` / `Skip rep` / `Drop GPS`
    /// / `Cut it short` are all 38px = 19pt on #000 over #fff.
    case filled
    /// Surface-step fill, label white at .86. The default for a second verb.
    case quiet
    /// Amber fill — a decision waiting, not an error, on a board that is
    /// itself a condition.
    case attention
    /// On a day-state ramp: BLACK fill, white label. The inverse of `filled`,
    /// because a white pill on a lit green ramp is a hole in the poster.
    /// This is the lobby Start.
    case onRamp
    /// The quiet escape on a ramp board — black at 42%, so the ramp reads
    /// through it. "Run anyway" on Rest day, "Just run" on No session:
    /// present, but nothing here is being sold.
    case onRampQuiet
}

struct WTarget: View {
    let label: String
    var weight: WTargetWeight = .quiet
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(WatchV5.label(labelSize, labelWeight >= 800 ? .heavy : .bold))
                .foregroundStyle(foreground)
                .frame(maxWidth: .infinity)
                .frame(height: WatchV5.Metric.targetHeight)
                .background(background, in: Capsule())
        }
        .buttonStyle(.plain)
    }

    /// The leading verb is 19pt, everything else 18. Both sit inside the
    /// handoff's 17-19 target-label band; the step is what makes the lead
    /// verb lead without giving it a second colour.
    private var labelSize: CGFloat {
        switch weight {
        case .filled, .attention, .onRamp: return 19
        case .quiet, .onRampQuiet:         return 18
        }
    }

    /// MEASURED, not chosen. Every target label in the design file is drawn
    /// at `font-weight:800` — Start 38px/800, Save 38px/800, Drop GPS and
    /// Keep it all 36px/800, Lift it for today 34px/800, Open on iPhone
    /// 32px/800 — except the quiet escape on a ramp, which is 700 ("Run
    /// anyway" and "Just run", both 32px/700 on black at 42%). This was 600
    /// across the board, which is why two files hand-rolled their own ramp
    /// target at 700 and 800 rather than reach for this one.
    private var labelWeight: Double {
        switch weight {
        case .onRampQuiet: return 700
        default:           return 800
        }
    }

    private var foreground: Color {
        switch weight {
        case .filled, .attention: return .black
        case .quiet:              return WatchV5.value.opacity(0.86)
        case .onRamp:             return WatchV5.value
        case .onRampQuiet:        return WatchV5.value.opacity(0.86)
        }
    }

    private var background: Color {
        switch weight {
        case .filled:      return WatchV5.value
        case .quiet:       return WatchV5.surface3
        case .attention:   return WatchV5.attention
        case .onRamp:      return WatchV5.ground
        case .onRampQuiet: return WatchV5.ground.opacity(0.42)
        }
    }
}

/// A destructive verb. TEXT, at 42%, with no pill — never a filled target
/// (rule 7). A filled pill beside a filled pill is how a run gets thrown
/// away by accident, so this component deliberately cannot be given one.
struct WDestructive: View {
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(WatchV5.label(15, .semibold))
                .foregroundStyle(WatchV5.destructive)
                .frame(maxWidth: .infinity)
                .frame(height: WatchV5.Metric.targetHeight)
                // WITHOUT THIS the target is the text glyphs, roughly
                // 60x18pt, not the 396x50 the frame declares. A .frame does
                // not make its empty region hittable; WTarget gets away with
                // it because its Capsule background fills the frame and is.
                // Rule 6 says every target is 50pt with no exceptions, and
                // this was the exception — benignly, since the hard-to-hit
                // button is the one that throws a run away, but a drawn rule
                // and a built rule must agree.
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// The target stack at the foot of a board. Gap is fixed at 5pt.
struct WTargetStack<Content: View>: View {
    @ViewBuilder var content: () -> Content
    var body: some View {
        VStack(spacing: WatchV5.Metric.targetGap) { content() }
            .padding(.top, WatchV5.Metric.readingToStack)
    }
}

// MARK: - Telemetry

/// What a number means, which is what decides whether it may be coloured.
///
/// Rule 1: colour grades, and only on the one value the session asks the
/// runner to hold. Rule 4: the metric that matters is first and ~20% larger.
/// So `inBand` / `outOfBand` belong to the LEAD metric only — a second
/// coloured figure reads as a second verdict.
enum WMetricGrade {
    /// Inside the prescribed band. The only green in the product.
    case inBand
    /// Outside it.
    case outOfBand
    /// Measured, ungraded. Every other number, and EVERY number on a
    /// treadmill face — there is no trustworthy pace on a belt, so nothing
    /// on it grades.
    case plain
    /// Secondary emphasis step for an ungraded number.
    case dim

    var color: Color {
        switch self {
        case .inBand:    return WatchV5.band
        case .outOfBand: return WatchV5.attention
        case .plain:     return WatchV5.value
        case .dim:       return WatchV5.valueDim
        }
    }
}

/// Where a metric sits in the hierarchy. Sizes are the handoff's, and the
/// hero/secondary gap is what makes the ordering survive a runner who cannot
/// distinguish green from amber.
/// MEASURED OFF THE BOARDS, NOT OFF THE README TABLE — they disagree, and the
/// handoff's own instruction is that the 2x set is the spec.
///
/// The README's size table gives "hero metric 46-52, secondary 26-31". No
/// running face in the file is drawn at either. Page 1 is 88/72px = **44/36pt**,
/// Work interval 88/66 = 44/33, Page 2 four-up 74 = 37, Always-On 84/70 = 42/35.
///
/// The table is not a rounding error, it is a ratio error, and the component
/// caught it: 48-over-28 is 1.71, while rule 4 and `Metric.heroLeadRatio` both
/// say the lead is ~20% larger than the next. 44-over-36 is 1.22. The drawn
/// boards obey the rule the README states; the README's own table does not.
/// Raised with design — see docs/design/watch-0821/AUDIT.md.
enum WMetricRank {
    case hero, secondary, tertiary

    var size: CGFloat {
        switch self {
        case .hero:      return 44   // Page 1 / Work interval lead
        case .secondary: return 36   // Page 1 supporting rows
        case .tertiary:  return 33   // Work interval's denser supporting rows
        }
    }

    /// Units are their own step, not a fraction — 18 under a hero, 16 under a
    /// secondary, and the 16pt unit floor is the type floor for a unit.
    var unitSize: CGFloat {
        switch self {
        case .hero:      return 18
        case .secondary: return 16
        case .tertiary:  return 15
        }
    }
}

/// One telemetry reading: the figure, and its unit carrying the meaning.
///
/// There are no labels on a metric — units carry the meaning and POSITION
/// carries the identity. That is why this takes no `label` parameter: adding
/// one would quietly reintroduce the labelled-metric grammar the design
/// replaced.
struct WMetric: View {
    let value: String
    var unit: String? = nil
    var rank: WMetricRank = .secondary
    var grade: WMetricGrade = .plain
    var size: CGFloat? = nil
    /// Explicit unit size for the boards off the rank ladder.
    var unitSize: CGFloat? = nil
    /// ACCESSIBILITY ONLY. Draws nothing, ever.
    ///
    /// This component deliberately takes no drawn label — units carry the
    /// meaning and POSITION carries the identity. But position is exactly
    /// what VoiceOver destroys: it linearises the board, so a runner using
    /// it hears "7:42", "/mi", "154", "bpm", "5.72", "mi", "44:16" as seven
    /// unlabelled stops, and the elapsed time has no unit at all by design.
    ///
    /// So the no-label rule holds where it was written — on the drawn board —
    /// and does not extend to a channel that draws nothing. A runner who
    /// cannot see the layout gets told what each number is.
    var role: String? = nil

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
            Text(value)
                .font(WatchV5.number(size ?? rank.size))
                .foregroundStyle(grade.color)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            if let unit {
                Text(unit)
                    .font(WatchV5.number(unitSize ?? rank.unitSize))
                    .foregroundStyle(unitColor)
                    .lineLimit(1)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(a11yLabel)
    }

    /// "Pace, 7:42 per mile, in band". The GRADE is folded in here because
    /// this is the only non-visual channel that can carry it — the band strip
    /// is silent, and rule 4's size step conveys hierarchy, not whether the
    /// runner is holding the ask.
    private var a11yLabel: String {
        var parts: [String] = []
        if let role { parts.append(role) }
        parts.append(value.replacingOccurrences(of: WatchV5.separator, with: ","))
        if let unit { parts.append(Self.spoken(unit)) }
        switch grade {
        case .inBand:    parts.append("in band")
        case .outOfBand: parts.append("outside the band")
        case .plain, .dim: break
        }
        return parts.joined(separator: ", ")
    }

    /// Units are drawn short and said long. "/mi" reads as "slash em eye".
    private static func spoken(_ unit: String) -> String {
        switch unit {
        case "/mi":     return "per mile"
        case "/km":     return "per kilometre"
        case "/mi avg": return "average, per mile"
        case "/km avg": return "average, per kilometre"
        case "mi":      return "miles"
        case "km":      return "kilometres"
        case "bpm":     return "beats per minute"
        case "spm":     return "steps per minute"
        case "W":       return "watts"
        case "ft":      return "feet"
        case "m":       return "metres"
        case "min":     return "minutes"
        default:        return unit
        }
    }

    /// A graded unit is the SAME hue at .62 — it belongs to the figure it sits
    /// under, so it may not go white and read as a separate ungraded value.
    /// An ungraded unit is white at .48, the third step. Both measured off
    /// Page 1: `/mi` is rgba(62,189,65,.62), `bpm` and `mi` are
    /// rgba(255,255,255,.48).
    private var unitColor: Color {
        switch grade {
        case .inBand, .outOfBand: return grade.color.opacity(0.62)
        case .plain, .dim:        return WatchV5.valueMute
        }
    }
}

/// The running-face stack: up to four metrics, one left edge, lead first.
///
/// The cap is rule 4 and it is enforced rather than documented — a fifth
/// metric is dropped, loudly in debug, because a running face that grew a
/// fifth row is a bug and should not render as if it were a design.
struct WMetricStack: View {
    let metrics: [WMetric]

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(Array(capped.enumerated()), id: \.offset) { _, m in
                m
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var capped: [WMetric] {
        if metrics.count > WatchV5.Metric.maxMetricsPerFace {
            assertionFailure(
                "A running face may hold four metrics (rule 4); got \(metrics.count)."
            )
            return Array(metrics.prefix(WatchV5.Metric.maxMetricsPerFace))
        }
        return metrics
    }
}

// MARK: - Strips
//
// The two horizontal bars in the system. Both were written privately in two
// files before they lived here — the band strip on seven boards across two
// files, the progress strip in three shapes across two — and the band strip
// carries a RULE, which is the reason it may not be re-derived per board.

/// The prescribed band under the lead pace, with the runner's mark on it.
///
/// Green and the strip say the same thing twice on purpose: the colour is the
/// half-second read, the strip is the detail if you want it.
///
/// **THE RULE: the lit segment goes WHITE the moment the mark leaves it.**
/// The band has not changed, only the runner's position in it — so the lit
/// segment stops claiming a hue rather than turning amber, and the strip never
/// shows two greens or two ambers. That is why this takes `inBand` and not a
/// `WMetricGrade`: a grade could be handed `.plain` or `.dim` and the strip
/// would have to invent an answer, and an ungraded pace has no band to draw.
///
/// Positions are FRACTIONS of the strip's width, which is how the design file
/// places them (`left:18%`, `right:34%`, marker `left:52%`). The scale is the
/// session's business, not this view's.
struct WBandStrip: View {
    /// Leading edge of the lit segment, 0-1.
    let start: Double
    /// Trailing edge of the lit segment, 0-1.
    let end: Double
    /// Where the runner is, on the same scale, 0-1.
    let marker: Double
    /// Drives both the lit segment and the mark. See the rule above.
    var inBand: Bool = true

    /// 10px and 16px in the 2× set. The mark deliberately overhangs the
    /// track: it is a position on the band, not a segment of it.
    private let track: CGFloat = 5
    private let mark:  CGFloat = 8

    var body: some View {
        GeometryReader { geo in
            let w    = geo.size.width
            let lead = CGFloat(clamped(start)) * w
            let lit  = max(0, CGFloat(clamped(end)) * w - lead)
            // The design positions the mark by its LEADING edge, the way CSS
            // `left` does. The second clamp keeps a mark at 1.0 fully on the
            // strip instead of half off the right of the board.
            let dot  = min(CGFloat(clamped(marker)) * w, max(0, w - mark))

            ZStack(alignment: .leading) {
                Capsule()
                    .fill(WatchV5.value.opacity(0.16))
                    .frame(height: track)

                Capsule()
                    .fill(litColour.opacity(0.34))
                    .frame(width: lit, height: track)
                    .offset(x: lead)

                Circle()
                    .fill(inBand ? WatchV5.band : WatchV5.attention)
                    .frame(width: mark, height: mark)
                    .offset(x: dot)
            }
            .frame(width: w, height: geo.size.height, alignment: .leading)
        }
        .frame(height: mark)
        .allowsHitTesting(false)
        .accessibilityHidden(true)   // the grade it carries is spoken by WMetric
    }

    private var litColour: Color {
        inBand ? WatchV5.band : WatchV5.value
    }

    private func clamped(_ v: Double) -> Double { min(max(v, 0), 1) }
}

/// What a progress strip is allowed to be filled with.
///
/// Not a style choice. Orange is drawn intent (rule 3) and is allowed on a
/// strip because a strip is not a figure — but on the quality and race ramps
/// signal orange sits within a few points of the board's own palette and would
/// read as a live warning on the hardest sessions, so those boards fill white.
/// The design says so in as many words on the Threshold board.
enum WProgressTone {
    /// Signal orange. Page 1's distance bar, and the rep segments.
    case intent
    /// White at .62. Threshold and Race.
    case quiet

    var fill: Color {
        switch self {
        case .intent: return WatchV5.signal
        case .quiet:  return WatchV5.valueLabel
        }
    }
}

/// How far through. One object in two shapes, because they ARE one object:
/// Page 1 draws distance against the prescribed distance as a continuous bar,
/// and Work interval draws the same bar cut into one segment per rep.
///
/// Segments where there is a rep count, continuous where there is not — inside
/// a session with reps the runner's question is "how many left", and a
/// distance bar answers a question nobody is asking mid-interval.
struct WProgressStrip: View {

    // `Kind` and not `Shape`: a nested `Shape` shadows SwiftUI's protocol of
    // that name inside this type.
    private enum Kind {
        case continuous(Double)
        case segments(total: Int, done: Int)
    }

    private let kind: Kind
    private let tone: WProgressTone

    /// Continuous. `fraction` is 0-1 and is clamped.
    init(fraction: Double, tone: WProgressTone = .intent) {
        self.kind = .continuous(fraction)
        self.tone = tone
    }

    /// Segmented. `done` counts the rep IN PROGRESS: "Rep 3 / 6" lights three.
    init(total: Int, done: Int, tone: WProgressTone = .intent) {
        self.kind = .segments(total: total, done: done)
        self.tone = tone
    }

    /// 8px in the 2× set, on every board that draws one.
    private let thickness: CGFloat = 4
    private let track: Color = WatchV5.value.opacity(0.16)

    var body: some View {
        Group {
            switch kind {
            case .continuous(let fraction):
                GeometryReader { geo in
                    let done = CGFloat(min(max(fraction, 0), 1)) * geo.size.width
                    ZStack(alignment: .leading) {
                        Capsule().fill(track)
                        Capsule()
                            .fill(tone.fill)
                            .frame(width: done)
                    }
                    .frame(height: thickness)
                }
            case .segments(let total, let done):
                HStack(spacing: 3) {   // 6px
                    ForEach(0..<max(total, 1), id: \.self) { i in
                        Capsule()
                            .fill(i < done ? tone.fill : track)
                            .frame(height: thickness)
                    }
                }
            }
        }
        .frame(height: thickness)
        .allowsHitTesting(false)
        .accessibilityHidden(true)   // the grade it carries is spoken by WMetric
    }
}

// MARK: - Words

/// Uppercase kicker — a phase label, a list heading, the evidence line over a
/// question. 11-13pt, .08em tracking, in the TELEMETRY register.
///
/// The register is not a preference and it is not a parameter. Two arguments
/// arrive at the same place:
///
///  · The design file draws twenty kickers and every one of them is
///    `ui-rounded` — the phase labels on all six structured boards, the lobby
///    list headings, Split, Paused, the controls headers, the fault and
///    coach-question boards, the notification. Two of them state the family
///    explicitly rather than inheriting it. There is no kicker anywhere in the
///    0821 file drawn in Instrument Sans.
///  · Most kickers CARRY A FIGURE — "Rep 4 of 6 · 1:12 left", "Mile 5 ·
///    44:16", "Ceiling is 165", "9 days old". The coach face has no tabular
///    figures, so a live countdown drawn in it shuffles horizontally as it
///    ticks, on the one board a runner reads mid-rep, at arm's length,
///    moving. The telemetry register is tabular by construction.
///
/// So this took a `figures: Bool` and the answer was always true. The
/// parameter is gone rather than defaulted, because a register a board can
/// opt out of is a register that drifts.
///
/// The default colour is the .62 step, which is what every kicker on a black
/// board is drawn at bar the four that go to .5 (`valueMute`), amber or
/// orange — all of which pass a colour.
struct WKicker: View {
    let text: String
    var color: Color = WatchV5.valueLabel
    var size: CGFloat = 12

    var body: some View {
        Text(text.uppercased())
            .font(WatchV5.number(size))
            .tracking(size * 0.08)
            .foregroundStyle(color)
            // A kicker is one line by construction. Controls hangs a rep
            // count and a live clock off one ("Rep 4 of 6 · 1:12 left"), and
            // a kicker that wrapped there would move the reading block down
            // mid-rep.
            .lineLimit(1)
            .minimumScaleFactor(0.7)
    }
}

/// The display register — session type, a moment word, a notification title.
/// Uppercase, Archivo 800/112. NEVER inside a running metric.
struct WDisplayWord: View {
    let text: String
    var size: CGFloat = 36
    var color: Color = WatchV5.value
    /// One line on a board, because a moment word is a WORD and a second line
    /// would make it a sentence. Notifications are the exception: their lede
    /// is a phrase ("SESSION MOVED"), long enough to shrink itself unreadable
    /// in a 178pt column rather than wrap.
    var lineLimit: Int = 1
    /// Letterspacing, for the boards that carry it.
    var tracking: CGFloat = 0
    /// The design draws multi-line display type at `line-height: .92`.
    /// `.leading(.tight)` is the closest SwiftUI gets; without it a two-line
    /// lede opens up by about 4pt and the block stops reading as one
    /// statement. Only meaningful when `lineLimit > 1`.
    var tightLeading: Bool = false

    var body: some View {
        Text(text.uppercased())
            .font(tightLeading ? WatchV5.display(size).leading(.tight)
                               : WatchV5.display(size))
            .tracking(tracking)
            .foregroundStyle(color)
            .lineLimit(lineLimit)
            .minimumScaleFactor(0.5)
            .fixedSize(horizontal: false, vertical: lineLimit > 1)
    }
}

/// Everything the coach says. The only face used for prose.
///
/// Copy rules are machine-enforced elsewhere in the codebase and hold here:
/// no exclamation marks, no emoji, no em dashes (the separator is `·`),
/// second person present tense, 8-40 words, never scolding, and silence over
/// an unfalsifiable claim.
struct WCoachLine: View {
    let text: String
    var size: CGFloat = 15          // 13-17
    var color: Color = WatchV5.valueDim

    var body: some View {
        Text(text)
            .font(WatchV5.coach(size))
            .foregroundStyle(color)
            .lineSpacing(2)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The wordmark, with the one orange dot. Orange here is drawn intent, not a
/// grade (rule 3) — this and the coach-speaking kicker are the only places it
/// appears, and never on a number.
struct WWordmark: View {
    var size: CGFloat = 12
    /// Opacity of the WORDS only. The dot never dims.
    ///
    /// The addendum draws the mark at 62% with the dot at full orange, so a
    /// single opacity on the whole mark is wrong: it takes the one piece of
    /// drawn intent in the wordmark down with the letters. The dot is the
    /// mark — the words are just the name it is attached to.
    var wordOpacity: Double = 1.0

    var body: some View {
        HStack(spacing: 1) {
            Text("faff")
                .font(WatchV5.display(size))
                .foregroundStyle(WatchV5.value.opacity(wordOpacity))
            Text(".")
                .font(WatchV5.display(size))
                .foregroundStyle(WatchV5.signal)
            Text("run")
                .font(WatchV5.display(size))
                .foregroundStyle(WatchV5.value.opacity(wordOpacity))
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("faff dot run")
    }
}

// MARK: - Faults

/// Red names a SENSOR, never a value (rule 2). This component takes a
/// `sensor` string and has no parameter for a figure, so the rule cannot be
/// broken through it — a stale or greyed last-known number was explicitly
/// rejected, because the runner cannot tell it has stopped moving.
struct WSensorFault: View {
    let sensor: String
    /// 19pt so the broken slot carries the optical weight of the three
    /// untouched values beside it. A fault that reads lighter than the
    /// numbers around it looks like a caption, not like a slot that stopped.
    var size: CGFloat = 19

    var body: some View {
        Text(sensor)
            .font(WatchV5.label(size, .semibold))
            .foregroundStyle(WatchV5.fault)
    }
}

// MARK: - Rows

/// A row inside a grouped list — the race plan, the summary, a decision.
/// Rows step in FILL, never in borders: there are no borders anywhere in this
/// design, and containment is always a fill-step change.
struct WRow<Leading: View, Trailing: View>: View {
    var fill: Color = WatchV5.surface2
    @ViewBuilder var leading: () -> Leading
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            leading()
            Spacer(minLength: 8)
            trailing()
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .background(fill, in: RoundedRectangle(cornerRadius: WatchV5.Metric.rowRadius,
                                               style: .continuous))
    }
}

/// A GROUP of rows — the lobby's page-2 lists, the summary's three plates.
///
/// The design draws these as ONE plate: a single 10pt radius on the outside,
/// squared rows inside it, separated by a 1pt gap that the ground shows
/// through. `WRow` rounds every row at 10pt, which is right for one row and
/// reads as a stack of separate pills the moment there are three — so both
/// files that needed a list built their own clipped VStack rather than use it.
///
/// `WRow` stays, and is still the right answer for a genuinely single row: the
/// lobby's Gels footer is one row and is drawn as one rounded tile in the
/// design.
///
/// Content is a ViewBuilder rather than a `[Row]` array on purpose. The two
/// lists that use it carry different type scales (the lobby is 13/16, the
/// summary 12/15 and 12/14) and the summary emphasises by FILL between groups
/// while the lobby emphasises by fill within one — a row model general enough
/// for both would be a second layout language.
struct WRowGroup<Content: View>: View {
    /// 2px in the 2× set. The gap is ground showing through the plate, which
    /// is why it is a spacing and not a divider: there are no borders
    /// anywhere in this design.
    private let gap: CGFloat = 1

    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(spacing: gap) { content() }
            .clipShape(RoundedRectangle(cornerRadius: WatchV5.Metric.rowRadius,
                                        style: .continuous))
    }
}

/// One row INSIDE a `WRowGroup`. Squared, because the group carries the
/// radius; a rounded row inside a clipped plate is the pill stack again.
///
/// Rows step in FILL, never in borders — `surface2` against `surface3` is how
/// the lobby says which step the session is actually about, and `surface1`
/// against `surface2` is how the summary separates splits from averages.
struct WGroupRow<Leading: View, Trailing: View>: View {
    var fill: Color = WatchV5.surface2
    @ViewBuilder var leading: () -> Leading
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            leading()
            Spacer(minLength: 8)
            trailing()
        }
        .padding(.horizontal, 8)    // 16px
        .padding(.vertical, 7)      // 13px, rounded up
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(fill)
    }
}

// MARK: - Page indicator

/// Tridots. The running faces and the lobby page through with the gesture the
/// runner already knows, so the indicator is the same on both.
///
/// An empty page is never drawn to even a count — callers pass the real page
/// count, and a session with nothing on page 3 passes 2.
struct WPageDots: View {
    let count: Int
    let index: Int

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<max(count, 1), id: \.self) { i in
                Circle()
                    .fill(i == index ? WatchV5.value : WatchV5.valueMute)
                    .frame(width: 4, height: 4)
            }
        }
    }
}
