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
//  ── NEEDS · ALL FOUR CLOSED ──────────────────────────────────────────────
//  This file carried four local workarounds for gaps in WatchKitV5. All four
//  are now shared components and every workaround here has been deleted.
//
//  NEEDS 1 · `WMetricRank` sizes did not fit a running face — CLOSED.
//      The ranks were the README table's (hero 48 / secondary 28 / tertiary
//      22) and every running face in the design file is drawn at 44 / 36.
//      They have since been re-measured off the boards to 44 / 36 / 33 with a
//      per-rank unit step, and `WMetric` gained `size:` and `unitSize:`
//      overrides for the boards off that ladder. `FaceMetric` is gone.
//
//  NEEDS 2 · There was no shared band strip — CLOSED. It appeared on seven
//      boards across two files and it carries a rule. It is `WBandStrip` now,
//      and the rule (the lit segment goes white the moment the mark leaves
//      it) is stated at the component rather than in each caller.
//
//  NEEDS 3 · There was no shared progress strip — CLOSED. Page 1's
//      distance-against-prescribed bar is the same object as Work interval's
//      rep segments, so `WProgressStrip` is one type with two initialisers,
//      and its two fills are a named `WProgressTone` rather than a colour a
//      board picks.
//
//  NEEDS 4 · `WMetric` drew a graded unit at .72 — CLOSED. It is .62 in the
//      shared component now, which is what the design file draws.
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
extension FacePaceGrade {
    /// The three-state grade as the shared component's own enum. Exists so a
    /// board cannot collapse `.untrusted` into `.outOfBand` on the way past.
    var metricGrade: WMetricGrade {
        switch self {
        case .inBand:    return .inBand
        case .outOfBand: return .outOfBand
        case .untrusted: return .plain
        }
    }
}

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
                    // 88 / 36 in the 2× set, which is `.hero` exactly.
                    WMetric(value: pace, unit: paceUnit,
                            rank: .hero, grade: grade.metric, role: "Pace")

                    if grade.drawsBand, let band {
                        WBandStrip(start: band.start,
                                   end: band.end,
                                   marker: band.marker,
                                   inBand: grade == .inBand)
                            .padding(.top, 1)               // 2px
                            .padding(.bottom, 4)            // 8px
                    }

                    // 72 / 32, which is `.secondary` exactly.
                    WMetric(value: heartRate, unit: heartRateUnit, rank: .secondary, role: "Heart rate")
                    WMetric(value: distance, unit: distanceUnit, rank: .secondary, role: "Distance")
                    WMetric(value: elapsed, rank: .secondary, role: "Elapsed")
                }
                .padding(.leading, 1)                       // 2px
                .frame(maxWidth: .infinity, alignment: .leading)

                Spacer(minLength: 0)

                VStack(spacing: 7) {                        // 14px
                    if let distanceProgress {
                        // `.intent` — orange. Page 1 is on black, so the
                        // reason Threshold and Race go white does not apply.
                        WProgressStrip(fraction: distanceProgress)
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
                        // Off the hero/secondary ladder entirely — this board
                        // resizes with how many rows survived — so both the
                        // figure and its unit are passed.
                        WMetric(value: row.value, unit: row.unit,
                                grade: step(i, of: rows.count),
                                size: size(rows.count),
                                unitSize: unitSize(rows.count))
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
                    // 88 / 34 — hero, with a unit one point under the
                    // ladder's, so the unit step is passed and the size is
                    // not.
                    WMetric(value: pace, unit: paceUnit, rank: .hero, unitSize: 17, role: "Pace")
                    WMetric(value: distance, unit: distanceUnit, rank: .secondary, role: "Distance")
                    WMetric(value: heartRate, unit: heartRateUnit, rank: .secondary, role: "Heart rate")
                    WMetric(value: elapsed, rank: .secondary, role: "Elapsed")
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
                    WMetric(value: pace, unit: paceUnit,
                            grade: grade.metric,
                            size: 42, unitSize: 17, role: "Pace")         // 84 / 34
                    WMetric(value: distance, unit: distanceUnit,
                            grade: .dim,
                            size: 35, unitSize: 16, role: "Distance")         // 70 / 32
                    WMetric(value: elapsedMinutes, unit: elapsedUnit,
                            grade: .dim,
                            size: 35, unitSize: 16, role: "Elapsed")
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
