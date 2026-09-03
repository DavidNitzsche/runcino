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

// MARK: - PostRunVerdictV5 · one coaching read, not four cards
//
// ─────────────────────────────────────────────────────────────────────────
// THE PROBLEM THIS REPLACES
//
// The redesign's own first draft still made a runner parse the answer to
// "how did it go" out of four separately-carded blocks stacked in a row:
// `recapSection`'s headline+summary+cost card, then `PostRunLearnedV5
// (.meaning)`'s learned+change card underneath it — each in its own
// `V5.materialTile` rounded rectangle, each with its own vertical padding,
// reading as four ideas from four authors rather than one coach's answer.
// Rendered and reviewed against the Strava references this project already
// has: neither reference does this. One verdict, one voice, one paragraph;
// depth is a tap away, not a second card down.
//
// THE FIX. `headline` (bold) and `summary` sit together as the answer to
// "how did it go" — that pairing was already this contract's Layer 1A.
// Immediately under it, ONE short plan-status clause — "Plan unchanged." /
// "Plan updated." / "Under review." — because that is the one fact from
// Layer 1B a runner reads even at a glance, and the brief's own hero example
// keeps it on its own line for exactly that reason. Everything else this
// object carries — the physiological cost, the full evidence sentence
// (`learned`), the itemised plan changes, the disclosure reasons, the
// weather/conditions note — sits behind ONE "Why" toggle, so the runner who
// wants depth gets all of it in one place instead of four.
//
// NO CARD. This is the answer the whole page exists to give, so it sits on
// the page's own background like the headline of anything else worth
// reading — not boxed apart from it. The card treatment stays for what it
// was always more honest for: reference detail further down the page.
struct PostRunVerdictV5: View {
    let model: PostRunV5
    /// From `RunRecap.conditions_note` / `V5Today.conditionsNote` — not on
    /// `PostRunV5` itself (see the wire's own doc comment), so the caller
    /// supplies it. Folded into the disclosure, never onto the visible line.
    var conditions: String? = nil
    /// From `RunRecap.coach_tip` / `V5Today.coachTip`. Forward-looking, so it
    /// stays visible under the disclosure rather than inside it — a runner
    /// closing "Why" should not lose the one line about tomorrow.
    var coachTip: String? = nil

    @State private var whyOpen = false

    private var headline: String { model.headline.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var summary: String { model.summary.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var cost: String? {
        let c = model.cost?.trimmingCharacters(in: .whitespacesAndNewlines)
        return (c?.isEmpty ?? true) ? nil : c
    }
    private var learned: String? {
        let l = model.learned.trimmingCharacters(in: .whitespacesAndNewlines)
        return l.isEmpty ? nil : l
    }
    private var change: String? {
        let c = model.change.trimmingCharacters(in: .whitespacesAndNewlines)
        return c.isEmpty ? nil : c
    }
    private var conditionsTrimmed: String? {
        let c = conditions?.trimmingCharacters(in: .whitespacesAndNewlines)
        return (c?.isEmpty ?? true) ? nil : c
    }
    private var why: [String] {
        model.why.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }
    private var changes: [String] {
        model.changes.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }
    private var next: String? {
        let n = model.next?.trimmingCharacters(in: .whitespacesAndNewlines)
        return (n?.isEmpty ?? true) ? nil : n
    }

    /// The one line a runner reads even without opening "Why" — never the
    /// full `change` sentence, which can run to two sentences once it
    /// carries the disambiguating clause `readPlan` now adds (the
    /// 2026-08-16 fix). A CODE drives the word, per the design contract's
    /// "never encode an outcome only by colour" rule applied to text: the
    /// sentence changing would silently break this switch, the code cannot.
    private var planStatusLine: String? {
        switch model.changeState {
        case "UNCHANGED":         return "Plan unchanged."
        case "UPDATED":           return "Plan updated."
        case "HELD_FOR_EVIDENCE": return "Under review."
        case "NO_PLAN", "UNKNOWN": return nil
        default:                  return nil
        }
    }

    private var hasDisclosureContent: Bool {
        cost != nil || learned != nil || !changes.isEmpty || conditionsTrimmed != nil || !why.isEmpty
    }

    var body: some View {
        if !headline.isEmpty || !summary.isEmpty {
            VStack(alignment: .leading, spacing: V5.S.s10) {
                if !headline.isEmpty {
                    Text(headline)
                        .font(.faffText(TypeScaleV5.body17, weight: .semibold))
                        .foregroundStyle(V5.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if !summary.isEmpty {
                    Text(summary)
                        .font(.faffText(TypeScaleV5.body17))
                        .foregroundStyle(V5.textPrimary)
                        .lineSpacing(4)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let planStatusLine {
                    Text(planStatusLine)
                        .font(.faffText(TypeScaleV5.body15))
                        .foregroundStyle(V5.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if hasDisclosureContent {
                    Button {
                        withAnimation(V5.Motion.expand) { whyOpen.toggle() }
                    } label: {
                        HStack(spacing: V5.S.s6) {
                            Text(whyOpen ? "Hide why" : "Why")
                                .font(.faffText(TypeScaleV5.label14, weight: .semibold))
                                .foregroundStyle(V5.textSecondary)
                            Spacer(minLength: 0)
                        }
                        // 44pt target on a row whose visible text is 14pt —
                        // the accessibility contract's own minimum.
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(whyOpen ? "Hide why" : "Why")
                    .accessibilityAddTraits(whyOpen ? [.isButton, .isSelected] : .isButton)

                    if whyOpen {
                        VStack(alignment: .leading, spacing: V5.S.s10) {
                            if let cost {
                                Text(cost)
                                    .font(.faffText(TypeScaleV5.body15))
                                    .foregroundStyle(V5.textSecondary)
                                    .lineSpacing(3)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            if let learned {
                                Text(learned)
                                    .font(.faffText(TypeScaleV5.body15))
                                    .foregroundStyle(V5.textSecondary)
                                    .lineSpacing(3)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            if let change {
                                Text(change)
                                    .font(.faffText(TypeScaleV5.body15))
                                    .foregroundStyle(V5.textSecondary)
                                    .lineSpacing(3)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            ForEach(changes, id: \.self) { line in
                                Text(line)
                                    .font(.faffText(TypeScaleV5.label14))
                                    .foregroundStyle(V5.textQuiet)
                                    .lineSpacing(3)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            if let conditionsTrimmed {
                                Text(conditionsTrimmed)
                                    .font(.faffText(TypeScaleV5.label14))
                                    .foregroundStyle(V5.textQuiet)
                                    .lineSpacing(3)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            ForEach(why, id: \.self) { line in
                                Text(line)
                                    .font(.faffText(TypeScaleV5.label14))
                                    .foregroundStyle(V5.textQuiet)
                                    .lineSpacing(3)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .transition(.opacity)
                    }
                }

                if let next {
                    Text(next)
                        .font(.faffText(TypeScaleV5.body15))
                        .foregroundStyle(V5.textPrimary)
                        .lineSpacing(3)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if let coachTip {
                    // NOT `CoachCaveat` — that component carries its own
                    // 4pt horizontal inset, tuned for sitting alone at a
                    // section's top level. Nested here it would pull one
                    // line out of alignment with every other line in this
                    // flush paragraph. Same visual treatment (quiet, 13pt),
                    // no borrowed padding.
                    Text(coachTip)
                        .font(.faffText(TypeScaleV5.label13))
                        .foregroundStyle(V5.textQuiet)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            // NO CARD (see the file header). Flush with the page's own
            // gutter, not a tile's internal padding.
        }
    }
}
