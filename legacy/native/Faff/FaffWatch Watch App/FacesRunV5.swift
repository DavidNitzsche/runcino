//
//  FacesRunV5.swift
//  FaffWatch
//
//  The running faces, from the 0821 watch handoff.
//
//  SOURCE OF TRUTH — see WatchThemeV5.swift's header:
//    /Volumes/WP/06 Claude Code/Faff/design/0821/design_handoff_faff_watch_app/
//      README.md + Faff-Watch-App.dc.html
//
//  Boards in this file, by their `data-screen-label` in the design file:
//    · Page 1 primary       → RunFacePrimary(grade: .inBand, …)
//    · Page 1 off band      → RunFacePrimary(grade: .outOfBand, …)
//    · Page 2 outdoor       → RunFacePerformance(power:, elevation:)
//    · Page 2 treadmill     → RunFacePerformance(power: nil, elevation: nil)
//    · Treadmill page 1     → RunFaceTreadmillPrimary(…)
//    · Always-On            → RunFaceAlwaysOn(…)
//
//  Every size below is the design file's 2× px ÷ 2. Where a number here looks
//  arbitrary it was measured off the board, not chosen.
//
//  These views take plain values. Nothing in this file knows about
//  WorkoutEngine, WatchWorkout or HealthKit — wiring is a separate pass, and
//  keeping the boards parameter-only is what lets the previews below be the
//  design review.
//
//
//  ── NEEDS ────────────────────────────────────────────────────────────────
//  Things a shared component would have given me. I have NOT edited
//  WatchKitV5.swift; each is worked around locally and each workaround is
//  marked at its definition.
//
//  NEEDS 1 · `WMetricRank` sizes do not fit a running face.
//      The ranks are hero 48 / secondary 28 / tertiary 22. Every running face
//      in the design file is drawn at hero 44 (88px) and secondary 36 (72px),
//      with the structured phase boards at 44 / 33 (66px). 48 over 28 is a
//      1.71 ratio; the handoff's own rule 4 and `Metric.heroLeadRatio` both
//      say ~1.20, which is what 44 over 36 gives. So the ranks appear to have
//      been calibrated against a denser board family, and using them here
//      would shrink heart rate, distance and elapsed by eight points and
//      break the ratio rule the same component documents.
//      Wanted: either corrected rank sizes, or `WMetric(size:)` as an
//      explicit override. Worked around with `FaceMetric` below, which still
//      takes its colours from `WMetricGrade` so the colour rule stays in the
//      shared vocabulary.
//
//  NEEDS 2 · There is no shared band strip.
//      The lit-band-and-marker strip under the lead pace appears on Page 1
//      primary, Page 1 off band, Warm-up, Work interval, Recovery, Threshold
//      and Race — seven boards across at least two files. It also encodes a
//      rule (the lit segment goes white the moment the marker leaves it, so
//      the strip never shows two greens). Worked around with `FaceBandStrip`
//      below; it should be promoted to `WBandStrip` in WatchKitV5 before the
//      structured-phase file re-implements it.
//
//  NEEDS 3 · There is no shared progress strip.
//      Page 1's distance-against-prescribed bar (orange fill on a white .16
//      track) is the same object as the Work interval board's rep segments.
//      Worked around with `FaceProgressStrip` below.
//
//  NEEDS 4 · `WMetric` draws a graded unit at `grade.color.opacity(0.72)`.
//      Every graded unit in the design file is at .62 (`rgba(62,189,65,.62)`,
//      `rgba(242,176,60,.62)`). `FaceMetric` uses .62.
//
//  Not worth a change, recorded so the next reader does not re-measure:
//  `WPageDots` draws 4pt dots at 4pt spacing; the design draws 4.5 at 6. The
//  shared component is used as-is.
//  ─────────────────────────────────────────────────────────────────────────
//

import SwiftUI

// MARK: - Vocabulary

/// What the wrist is allowed to say about the lead pace.
///
/// Rule 1: colour grades, and only on the one value the session asks the
/// runner to hold. This enum exists so a face cannot be handed `.dim` or
/// `.plain` for its lead pace by accident, and so the treadmill's "there is no
/// trustworthy pace on a belt" is a named state rather than an omission.
enum FacePaceGrade {
    /// Inside the prescribed band. The only green in the product.
    case inBand
    /// Outside it. Amber, and the strip's lit segment goes white.
    case outOfBand
    /// A belt. Nothing on a treadmill face grades — amber on a running face
    /// means one thing only, off the band, and spending it on a treadmill
    /// would teach the runner that a whole belt session is a warning.
    case untrusted

    /// Maps into the shared grade so the colours still come from one place.
    var metric: WMetricGrade {
        switch self {
        case .inBand:    return .inBand
        case .outOfBand: return .outOfBand
        case .untrusted: return .plain
        }
    }

    /// The strip is the detail behind the colour, so an ungraded pace has no
    /// strip to draw: an untrusted number cannot be held to a five-second
    /// target and drawing the target anyway would claim it can.
    var drawsBand: Bool { self != .untrusted }
}

/// The prescribed band, and where the runner is in it. All three are
/// fractions of the strip's width, which is how the design file positions
/// them (`left:18%`, `right:34%`, marker `left:52%`) — the strip's scale is
/// the session's business, not this view's.
struct FaceBand {
    /// Leading edge of the lit segment, 0-1.
    var start: Double
    /// Trailing edge of the lit segment, 0-1.
    var end: Double
    /// The runner's current pace on the same scale, 0-1.
    var marker: Double

    init(start: Double, end: Double, marker: Double) {
        self.start = start
        self.end = end
        self.marker = marker
    }
}

// MARK: - Telemetry row
//
// NEEDS 1's workaround. `WMetric` with an explicit size would delete this
// whole type; it is deliberately kept to the same shape (figure, then unit
// carrying the meaning) so the swap is mechanical.
//
// There is no `label` parameter here either, and that is not an oversight:
// units carry the meaning and POSITION carries the identity. Adding a label
// would reintroduce the labelled-metric grammar the design replaced, on the
// one surface with the least room for it.

private struct FaceMetric: View {
    let value: String
    var unit: String? = nil
    /// Points. From the board, not from a rank — see NEEDS 1.
    let size: CGFloat
    let unitSize: CGFloat
    var grade: WMetricGrade = .plain

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 5) {   // 10px
            Text(value)
                .font(WatchV5.number(size))
                .foregroundStyle(grade.color)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            if let unit {
                Text(unit)
                    .font(WatchV5.number(unitSize))
                    .foregroundStyle(unitColour)
                    .lineLimit(1)
            }
        }
    }

    /// A graded unit is drawn in its own hue at .62; an ungraded one is always
    /// the white mute step, whatever the figure above it is doing.
    private var unitColour: Color {
        switch grade {
        case .inBand, .outOfBand: return grade.color.opacity(0.62)   // NEEDS 4
        case .plain, .dim:        return WatchV5.valueMute
        }
    }
}

// MARK: - Band strip
//
// NEEDS 2's workaround.

/// The lit band under the lead pace, with the runner's mark on it.
///
/// Green and the strip say the same thing twice on purpose: the colour is the
/// half-second read, the strip is the detail if you want it. When the mark
/// leaves the band the mark goes amber AND the lit segment goes white — the
/// segment is no longer where the runner is, so it stops claiming a hue.
private struct FaceBandStrip: View {
    let band: FaceBand
    let grade: WMetricGrade

    private let track: CGFloat = 5   // 10px
    private let mark:  CGFloat = 8   // 16px

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(WatchV5.value.opacity(0.16))
                    .frame(height: track)

                Capsule()
                    .fill(litColour.opacity(0.34))
                    .frame(width: max(0, w * (band.end - band.start)), height: track)
                    .offset(x: w * clamped(band.start))

                Circle()
                    .fill(grade.color)
                    .frame(width: mark, height: mark)
                    .offset(x: min(max(0, w * clamped(band.marker)), max(0, w - mark)))
            }
            .frame(width: w, height: geo.size.height, alignment: .leading)
        }
        .frame(height: mark)
        .allowsHitTesting(false)
    }

    private var litColour: Color {
        grade == .inBand ? WatchV5.band : WatchV5.value
    }

    private func clamped(_ v: Double) -> Double { min(max(v, 0), 1) }
}

// MARK: - Progress strip
//
// NEEDS 3's workaround.

/// Distance against the prescribed distance. Orange is drawn intent, not a
/// grade (rule 3) — it is allowed here because a strip is not a figure, and
/// the same object carries the rep count on the structured boards.
private struct FaceProgressStrip: View {
    /// 0-1.
    let fraction: Double

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(WatchV5.value.opacity(0.16))
                Capsule()
                    .fill(WatchV5.signal)
                    .frame(width: geo.size.width * min(max(fraction, 0), 1))
            }
        }
        .frame(height: 4)   // 8px
        .allowsHitTesting(false)
    }
}

// MARK: - Page 1 · primary  /  Page 1 · off band

/// The board the runner is on for most of a run: pace, heart rate, distance,
/// time. Four metrics, one left edge, lead first and ~20% larger (rule 4).
///
/// The lead pace is the only thing on it that may be coloured. Heart rate,
/// distance and elapsed stay white however they are going — a second coloured
/// figure reads as a second verdict.
///
/// `Page 1 off band` is this same view with `grade: .outOfBand` and a marker
/// outside the band. It is not a separate board; making it one would let the
/// two states drift.
struct RunFacePrimary: View {
    /// mm:ss for a mile or a kilometre. The unit says which.
    let pace: String
    var paceUnit: String = "/mi"
    let grade: FacePaceGrade
    /// Omit on a session with no prescribed band — the strip disappears, it
    /// does not draw an empty track.
    var band: FaceBand? = nil

    let heartRate: String
    var heartRateUnit: String = "bpm"

    let distance: String
    var distanceUnit: String = "mi"

    /// h:mm:ss or mm:ss. Carries no unit: position is its identity.
    let elapsed: String

    /// Distance against the session's prescribed distance, 0-1. Nil on a
    /// session with no prescribed distance — the strip is not drawn, rather
    /// than drawn empty.
    var distanceProgress: Double? = nil

    var pageIndex: Int = 0
    var pageCount: Int = 2

    var body: some View {
        WBoard {
            VStack(spacing: 0) {
                Spacer(minLength: 0)

                VStack(alignment: .leading, spacing: 3) {   // 6px
                    FaceMetric(value: pace, unit: paceUnit,
                               size: 44, unitSize: 18,      // 88 / 36
                               grade: grade.metric)

                    if grade.drawsBand, let band {
                        FaceBandStrip(band: band, grade: grade.metric)
                            .padding(.top, 1)               // 2px
                            .padding(.bottom, 4)            // 8px
                    }

                    FaceMetric(value: heartRate, unit: heartRateUnit,
                               size: 36, unitSize: 16)      // 72 / 32
                    FaceMetric(value: distance, unit: distanceUnit,
                               size: 36, unitSize: 16)
                    FaceMetric(value: elapsed,
                               size: 36, unitSize: 16)
                }
                .padding(.leading, 1)                       // 2px
                .frame(maxWidth: .infinity, alignment: .leading)

                Spacer(minLength: 0)

                VStack(spacing: 7) {                        // 14px
                    if let distanceProgress {
                        FaceProgressStrip(fraction: distanceProgress)
                    }
                    WPageDots(count: pageCount, index: pageIndex)
                }
            }
            .frame(maxHeight: .infinity)
        }
    }
}

// MARK: - Page 2 · performance  (outdoor and treadmill)

/// Cadence, average pace, power, climb. Nothing here is the ask, so nothing
/// here takes a hue: all white, stepped 1.0 and .72.
///
/// Cadence and average pace lead because they exist on any surface. Power and
/// climb sit last because those two are the ones that can go missing — and
/// when they do they DROP OUT, they do not become placeholders. The board
/// does not hold four rows open: two metrics means two-metric type, which is
/// what makes `Page 2 treadmill` the same view as `Page 2 outdoor`.
struct RunFacePerformance: View {
    let cadence: String
    var cadenceUnit: String = "spm"

    let averagePace: String
    var averagePaceUnit: String = "/mi avg"

    /// Watts. Nil when the watch cannot report it — pending a belt test, this
    /// is nil on a treadmill.
    var power: String? = nil
    var powerUnit: String = "W"

    /// Signed feet. Nil when the watch cannot report it.
    var elevation: String? = nil
    var elevationUnit: String = "ft"

    var pageIndex: Int = 1
    var pageCount: Int = 2

    var body: some View {
        let rows = presentRows

        WBoard {
            VStack(spacing: 0) {
                Spacer(minLength: 0)

                VStack(alignment: .leading, spacing: gap(rows.count)) {
                    ForEach(Array(rows.enumerated()), id: \.offset) { i, row in
                        FaceMetric(value: row.value, unit: row.unit,
                                   size: size(rows.count),
                                   unitSize: unitSize(rows.count),
                                   grade: step(i, of: rows.count))
                    }
                }
                .padding(.leading, 1)
                .frame(maxWidth: .infinity, alignment: .leading)

                Spacer(minLength: 0)

                WPageDots(count: pageCount, index: pageIndex)
                    .frame(maxWidth: .infinity)
            }
            .frame(maxHeight: .infinity)
        }
    }

    private struct Row { let value: String; let unit: String }

    private var presentRows: [Row] {
        var out: [Row] = [
            Row(value: cadence, unit: cadenceUnit),
            Row(value: averagePace, unit: averagePaceUnit),
        ]
        if let power     { out.append(Row(value: power, unit: powerUnit)) }
        if let elevation { out.append(Row(value: elevation, unit: elevationUnit)) }
        return out
    }

    /// 4-up is 74px, 2-up is 94px. Three is not drawn in the design file; 82
    /// is the honest interpolation and is flagged as such rather than passed
    /// off as measured.
    private func size(_ n: Int) -> CGFloat {
        switch n {
        case ...2: return 47   // 94px
        case 3:    return 41   // interpolated
        default:   return 37   // 74px
        }
    }

    private func unitSize(_ n: Int) -> CGFloat {
        n <= 2 ? 19 : 16       // 38px / 32px
    }

    private func gap(_ n: Int) -> CGFloat {
        switch n {
        case ...2: return 12   // 24px
        case 3:    return 8    // interpolated
        default:   return 4    // 8px
        }
    }

    /// The white steps alternate 1.0 / .72 so four adjacent rows of the same
    /// hue still read as four rows. At two rows there is nothing to separate,
    /// so both stay at full — which is how the treadmill board is drawn.
    private func step(_ index: Int, of count: Int) -> WMetricGrade {
        guard count >= 3 else { return .plain }
        return index.isMultiple(of: 2) ? .plain : .dim
    }
}

// MARK: - Treadmill · page 1

/// The belt's primary face. Same four registers as `RunFacePrimary`, three
/// differences, all of them the same decision:
///
///  · every value is white, throughout — there is no trustworthy pace on a
///    belt, so nothing grades;
///  · no band strip, because nothing here can be held to a five-second
///    target and drawing the target would claim it can;
///  · distance sits second rather than third, because on a belt the ground
///    covered is the thing the runner is actually working towards.
///
/// The estimate lives in what is absent instead of in a caveat.
struct RunFaceTreadmillPrimary: View {
    let pace: String
    var paceUnit: String = "/mi"

    let distance: String
    var distanceUnit: String = "mi"

    let heartRate: String
    var heartRateUnit: String = "bpm"

    let elapsed: String

    var pageIndex: Int = 0
    var pageCount: Int = 2

    var body: some View {
        WBoard {
            VStack(spacing: 0) {
                Spacer(minLength: 0)

                VStack(alignment: .leading, spacing: 4) {   // 8px
                    FaceMetric(value: pace, unit: paceUnit,
                               size: 44, unitSize: 17)      // 88 / 34
                    FaceMetric(value: distance, unit: distanceUnit,
                               size: 36, unitSize: 16)
                    FaceMetric(value: heartRate, unit: heartRateUnit,
                               size: 36, unitSize: 16)
                    FaceMetric(value: elapsed,
                               size: 36, unitSize: 16)
                }
                .padding(.leading, 1)
                .frame(maxWidth: .infinity, alignment: .leading)

                Spacer(minLength: 0)

                WPageDots(count: pageCount, index: pageIndex)
                    .frame(maxWidth: .infinity)
            }
            .frame(maxHeight: .infinity)
        }
    }
}

// MARK: - Always-On · wrist down

/// Three quantities, dimmed, and elapsed drops to the minute because a
/// ticking second the display cannot redraw is a lie.
///
/// No strip, no dots, no heart rate: the hold and the ground covered survive,
/// the rest waits for the wrist to come up. Pace keeps its grade — it is the
/// one question the runner glanced down to ask.
///
/// The whole stack is drawn at .9 rather than each row carrying its own
/// always-on opacity. That is what makes the design's steps fall out exactly
/// (1.0→.9, .72→.65, .48→.43) instead of being restated as four more
/// literals, and it keeps every colour a token.
struct RunFaceAlwaysOn: View {
    let pace: String
    var paceUnit: String = "/mi"
    let grade: FacePaceGrade

    let distance: String
    var distanceUnit: String = "mi"

    /// Whole minutes. Not mm:ss — see above.
    let elapsedMinutes: String
    var elapsedUnit: String = "min"

    var body: some View {
        WBoard {
            VStack(spacing: 0) {
                Spacer(minLength: 0)

                VStack(alignment: .leading, spacing: 8) {   // 16px
                    FaceMetric(value: pace, unit: paceUnit,
                               size: 42, unitSize: 17,      // 84 / 34
                               grade: grade.metric)
                    FaceMetric(value: distance, unit: distanceUnit,
                               size: 35, unitSize: 16,      // 70 / 32
                               grade: .dim)
                    FaceMetric(value: elapsedMinutes, unit: elapsedUnit,
                               size: 35, unitSize: 16,
                               grade: .dim)
                }
                .padding(.leading, 1)
                .frame(maxWidth: .infinity, alignment: .leading)

                Spacer(minLength: 0)
            }
            .frame(maxHeight: .infinity)
            .opacity(0.9)
            .padding(.bottom, 2)   // 24px bottom on this board vs the usual 14
        }
    }
}

// MARK: - Previews
//
// The design file's own numbers, so a preview that stops matching the board
// is a regression and not a fixture that drifted.

#Preview("Page 1 · primary") {
    RunFacePrimary(
        pace: "7:42",
        grade: .inBand,
        band: FaceBand(start: 0.18, end: 0.66, marker: 0.52),
        heartRate: "154",
        distance: "5.72",
        elapsed: "44:16",
        distanceProgress: 0.95,
        pageIndex: 0,
        pageCount: 2
    )
}

#Preview("Page 1 · off band") {
    RunFacePrimary(
        pace: "7:48",
        grade: .outOfBand,
        band: FaceBand(start: 0.18, end: 0.66, marker: 0.82),
        heartRate: "151",
        distance: "5.94",
        elapsed: "46:22",
        distanceProgress: 0.99,
        pageIndex: 0,
        pageCount: 2
    )
}

#Preview("Page 2 · outdoor") {
    RunFacePerformance(
        cadence: "158",
        averagePace: "7:51",
        power: "246",
        elevation: "+482",
        pageIndex: 1,
        pageCount: 2
    )
}

#Preview("Page 2 · treadmill") {
    RunFacePerformance(
        cadence: "158",
        averagePace: "7:51",
        averagePaceUnit: "/mi",
        power: nil,
        elevation: nil,
        pageIndex: 1,
        pageCount: 2
    )
}

#Preview("Page 2 · power missing") {
    RunFacePerformance(
        cadence: "158",
        averagePace: "7:51",
        power: nil,
        elevation: "+482",
        pageIndex: 1,
        pageCount: 2
    )
}

#Preview("Treadmill · page 1") {
    RunFaceTreadmillPrimary(
        pace: "7:51",
        distance: "4.20",
        heartRate: "156",
        elapsed: "33:04",
        pageIndex: 0,
        pageCount: 2
    )
}

#Preview("Always-On") {
    RunFaceAlwaysOn(
        pace: "7:42",
        grade: .inBand,
        distance: "5.72",
        elapsedMinutes: "44"
    )
}

#Preview("Always-On · off band") {
    RunFaceAlwaysOn(
        pace: "8:09",
        grade: .outOfBand,
        distance: "5.72",
        elapsedMinutes: "44"
    )
}
