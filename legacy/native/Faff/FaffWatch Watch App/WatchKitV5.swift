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
                .font(WatchV5.coach(labelSize, weight: 600))
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
                .font(WatchV5.coach(15))
                .foregroundStyle(WatchV5.destructive)
                .frame(maxWidth: .infinity)
                .frame(height: WatchV5.Metric.targetHeight)
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
    /// Explicit override for the boards that are not on the hero/secondary
    /// ladder — Page 2's four-up is a flat 37pt, Always-On is 42/35. Passing a
    /// size opts out of `rank.size` only; the unit still steps from the rank.
    var size: CGFloat? = nil

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(value)
                .font(WatchV5.number(size ?? rank.size))
                .foregroundStyle(grade.color)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            if let unit {
                Text(unit)
                    .font(WatchV5.number(rank.unitSize))
                    .foregroundStyle(unitColor)
            }
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

// MARK: - Words

/// Uppercase kicker — a phase label, a list heading, the source line on a
/// notification. 11-13pt, .08em tracking.
struct WKicker: View {
    let text: String
    var color: Color = WatchV5.valueDim
    var size: CGFloat = 12
    /// Set when the kicker CARRIES A FIGURE — "Rep 4 of 6 · 1:12 left",
    /// "Mile 5 · 44:16", "Ceiling is 165".
    ///
    /// This is not a style preference. The coach face has no tabular figures,
    /// so a live countdown drawn in it SHUFFLES HORIZONTALLY as it ticks —
    /// on the one board a runner reads mid-rep, at arm's length, moving. The
    /// telemetry register is tabular by construction, so a figure-bearing
    /// kicker uses it and a prose kicker does not.
    var figures: Bool = false

    var body: some View {
        Text(text.uppercased())
            .font(figures ? WatchV5.number(size) : WatchV5.coach(size, weight: 600))
            .tracking(size * 0.08)
            .foregroundStyle(color)
    }
}

/// The display register — session type, a moment word, a notification title.
/// Uppercase, Archivo 800/112. NEVER inside a running metric.
struct WDisplayWord: View {
    let text: String
    var size: CGFloat = 36
    var color: Color = WatchV5.value

    var body: some View {
        Text(text.uppercased())
            .font(WatchV5.display(size))
            .foregroundStyle(color)
            .lineLimit(1)
            .minimumScaleFactor(0.5)
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
            .font(WatchV5.coach(size, weight: 600))
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
        .background(fill, in: RoundedRectangle(cornerRadius: WatchV5.Metric.rowRadius,
                                               style: .continuous))
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
