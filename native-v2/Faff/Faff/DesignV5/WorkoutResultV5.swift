import SwiftUI

// MARK: - WorkoutResultFactsV5 · the meaningful result, not the whole-run average
//
// ─────────────────────────────────────────────────────────────────────────
// WHY THIS EXISTS
//
// `detail.pace_work` / `model.paceWork` — the work-phase-only average pace,
// server-computed since P42+P45 (excludes warm-up, cool-down, recovery) —
// has been on both wire shapes and decoded on both screens since before this
// file existed. Neither screen drew it. `RunDetailV5` led with whole-run
// average pace at the same visual weight as everything else, so a 4×1mi
// threshold day at 7:02/mi work pace read the same as an 8:02/mi jog,
// because 8:02/mi — the number that also includes the warm-up and cool-down
// — was the only pace either screen showed.
//
// This component is the fix: three compact facts, in the order a runner
// actually asks them — did it complete, what did the work look like, was it
// steady — ahead of anything else on the page. It takes primitives, not a
// wire model, so `RunDetailV5` (reading `RunDetail`) and `TodayAfterV5`
// (reading `V5Today`) can both feed it without a shared decoder existing.
//
// NOTHING HERE IS A COACHING JUDGEMENT. Completion is a count. Work pace is
// a server-computed average, unchanged. Consistency is the spread between
// the fastest and slowest graded rep — arithmetic over numbers the watch
// already graded, not a second opinion about whether the session succeeded.
// The verdict on whether that spread is good sits in `postRun.summary`,
// composed server-side; this component states the fact the verdict is about.

struct WorkoutResultFactsV5: View {
    /// Nil when the session was not a rep set (easy/long/race) — the whole
    /// block draws nothing rather than a completion count for a run with no
    /// reps to complete.
    var completion: (done: Int, total: Int)? = nil
    /// The work-phase-only average, already formatted ("7:02/mi"). Nil when
    /// the run carries no phase data to scope a work pace from.
    var workPaceText: String? = nil
    /// One factual sentence about rep-to-rep spread, or nil when there are
    /// fewer than two graded reps to compare.
    var consistencyText: String? = nil

    private var hasContent: Bool {
        completion != nil || workPaceText != nil || consistencyText != nil
    }

    var body: some View {
        if hasContent {
            VStack(alignment: .leading, spacing: V5.S.s4) {
                if let completion {
                    Text("\(completion.done) of \(completion.total) completed")
                        .font(.faffText(TypeScaleV5.body17, weight: .semibold))
                        .foregroundStyle(V5.textPrimary)
                }
                if let workPaceText {
                    (Text(workPaceText).font(.faffText(TypeScaleV5.body17, weight: .semibold))
                     + Text(" average work pace").font(.faffText(TypeScaleV5.body17)))
                        .foregroundStyle(V5.textPrimary)
                }
                if let consistencyText {
                    Text(consistencyText)
                        .font(.faffText(TypeScaleV5.body15))
                        .foregroundStyle(V5.textSecondary)
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityElement(children: .combine)
        }
    }
}

// MARK: - SessionDetailsGridV5 · the compact replacement for a tall single-column card
//
// The brief's own complaint, verified by rendering: "Reading" — avg HR, max
// HR, cadence, temperature, four rows at ListRow height plus a section
// header — was the tallest thing on the screen after the chart, for the
// least important numbers on it. This is the same facts in a two-column
// grid, so four rows become two, and the section stops competing with the
// coaching answer above it for the runner's first glance.
//
// ONE SCOPE QUALIFIER, NOT ONE PER ROW. "Heart rate, across the 4 reps" /
// "Cadence, across the 4 reps" repeated the scope in every label; here the
// caller states it once, as the section's own caption, and the row labels
// go back to being just "Heart rate" / "Cadence" (Rule 17).
struct SessionDetailsGridV5: View {
    struct Metric: Identifiable {
        let id: String
        let label: String
        let value: FaffValue
        /// "asked 9:15" — the target this reading is judged against, when
        /// the caller has an honest one. Same role `RunDetailV5.stat()`'s
        /// `asked` parameter played before this grid replaced it.
        var sub: String? = nil
        init(_ label: String, _ value: FaffValue, sub: String? = nil) {
            self.id = label; self.label = label; self.value = value; self.sub = sub
        }
    }

    /// Shown once, above the grid — "Across the work", "Whole run" — rather
    /// than folded into every row's own label.
    var scopeCaption: String? = nil
    let metrics: [Metric]

    private static let columns = [GridItem(.flexible(), alignment: .leading),
                                   GridItem(.flexible(), alignment: .leading)]

    var body: some View {
        if !metrics.isEmpty {
            VStack(alignment: .leading, spacing: V5.S.s10) {
                if let scopeCaption {
                    Text(scopeCaption.uppercased())
                        .font(.faffText(TypeScaleV5.label12, weight: .medium))
                        .foregroundStyle(V5.textQuiet)
                        .tracking(0.4)
                }
                LazyVGrid(columns: Self.columns, alignment: .leading, spacing: V5.S.s14) {
                    ForEach(metrics) { m in
                        VStack(alignment: .leading, spacing: V5.S.s2) {
                            Text(m.label)
                                .font(.faffText(TypeScaleV5.label12))
                                .foregroundStyle(V5.textQuiet)
                            FaffValueText(m.value, font: .faffText(TypeScaleV5.body15, weight: .medium),
                                          color: V5.textPrimary)
                            if let sub = m.sub {
                                Text("asked \(sub)")
                                    .font(.faffText(TypeScaleV5.label12))
                                    .foregroundStyle(V5.textQuiet)
                                    .accessibilityLabel("asked estimated \(sub) per mile")
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            .padding(V5.S.tilePad)
            .background(V5.materialTile, in: RoundedRectangle(cornerRadius: V5.R.r18, style: .continuous))
        }
    }
}

// MARK: - Consistency, from graded rep paces alone
//
// Pure arithmetic over `actual_distance_mi` / `actual_duration_sec` on the
// phases the caller has already decided are true work reps (never strides —
// the caller filters those out before this ever sees them, the same filter
// `repSectionTitle` already applies). No verdict, no threshold tuned to
// sound impressive — the sentence states the range and lets the coach's own
// paragraph say what it means.
enum WorkConsistencyV5 {
    /// - Parameter repPaceSecPerMi: one entry per graded work rep, in
    ///   seconds per mile. Fewer than two produces no sentence — there is no
    ///   "spread" to describe with a single rep.
    static func sentence(repPaceSecPerMi: [Double], repWord: String) -> String? {
        guard repPaceSecPerMi.count >= 2,
              let lo = repPaceSecPerMi.min(), let hi = repPaceSecPerMi.max(),
              let fastest = FaffFmt.pace(secPerMi: lo),
              let slowest = FaffFmt.pace(secPerMi: hi) else { return nil }
        if lo == hi { return "Every \(repWord) landed at the same pace." }
        return "\(repWord.capitalized)s ranged \(fastest) to \(slowest)/mi."
    }
}
