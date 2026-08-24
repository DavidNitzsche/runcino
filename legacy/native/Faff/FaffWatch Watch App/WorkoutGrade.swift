//
//  WorkoutGrade.swift
//  FaffWatch
//
//  The pace grade and the prescribed band, as data.
//
//  These lived in FacesRunV5.swift, whose four V5 running faces were deleted
//  2026-08-24 once the V6 foundation replaced them. The VIEWS were dead — only
//  their own previews built them — but the file also defined these two types,
//  which the router uses on every running face. Deleting the file took them
//  with it and the build said so immediately.
//
//  Worth keeping as a note: "nothing constructs this view" is a good test for a
//  dead board and a bad test for a dead FILE. A file is dead when nothing it
//  defines is reachable, and a view file that also carries shared types is not
//  the same thing as a dead view.
//
//  They live here rather than in WorkoutFoundation.swift because the foundation
//  owns how a metric is DRAWN and these say what it MEANS — the router computes
//  them from the plan and the tracker, and hands the foundation a colour.
//

import SwiftUI

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

extension FacePaceGrade {
    /// The foundation's grade. Not a bridge any more — the V5 generation this
    /// mapped away from is gone, and this is now the only path from a plan's
    /// verdict to a drawn colour.
    /// `.untrusted` becomes `.neutral`: a belt, a dropped GPS and the first
    /// minute of a run all mean "nothing graded this", which is white.
    var workoutGrade: MetricGrade {
        switch self {
        case .inBand:    return .onTarget
        case .outOfBand: return .drifting
        case .untrusted: return .neutral
        }
    }

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
