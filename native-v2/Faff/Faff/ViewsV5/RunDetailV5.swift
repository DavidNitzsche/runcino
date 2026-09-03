//
//  RunDetailV5.swift
//  faff.run iPhone · a finished run, opened from `RunLogV5` (or any other
//  caller holding a real run id).
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHICH OPTION THIS IS, AND WHY
//
//  There were two honest ways to close the "no past-run detail" gap:
//
//    (a) route "open this run" through the existing dated Today read
//        (`/api/v5/today?date=`, which already answers with the after-run
//        shape `TodayAfterV5` renders).
//    (b) a real run-detail screen off `GET /api/runs/[id]`.
//
//  This file is (b). `V5Today` (the payload (a) reads) carries an `elevation:
//  [Double]?` — a profile, not a track — and no lat/lng at all, so (a)
//  cannot draw the real route map this task asks for; the wire contract that
//  can is `RunDetail.route_polyline` (`Models/Runs.swift`, mirroring
//  `lib/coach/run-state.ts`). (a) also has no way in from a browsable
//  history — it answers "what happened on this DATE", and a runner picking a
//  run out of `RunLogV5` is picking a RUN, which may or may not be the day's
//  only one. So (b) is the only one of the two that satisfies "splits, the
//  route map, zones" as asked.
//
//  That said, (a) was not wasted: `TodayBeforeV5`'s calendar sheet now wires
//  its "Done"/"Today" rows to the SAME `onPickDay` the week strip already
//  uses, so stepping to a recent day inline (from the calendar, without
//  leaving Today) still goes through the after-run screen that already
//  exists — no new screen needed for that narrower case. This screen is for
//  browsing the FULL history and seeing the real map, splits and zones for
//  any run in it.
//
//  ─────────────────────────────────────────────────────────────────────────
//  ANATOMY, BORROWED FROM 5b
//
//  "A past run is the same anatomy for a different day." The content sections
//  below are the same ones `TodayAfterV5` draws for today's finished run —
//  distance/time/pace, per-mile splits, a zone bar, the route, shoes worn, a
//  coach line — reusing the same components (`ListGroup`/`ListRow`/`Tile`/
//  `ZoneBar`/`CoachSay`). The one deliberate departure is the SHELL: this
//  screen is reached by pushing from a list (`RunLogV5`), not by opening a
//  "place", so it takes the shell's own documented exception instead of a
//  gradient `DayPanel` — "pushed screens are AppBar + plain list", exactly
//  the choice `RaceDetailV5` (8a) already made for the same reason. A day
//  panel needs a day state to gradient against; a run pulled out of history
//  by id is not "today's place", it is a record, and `RaceDetailV5` is the
//  precedent for a rich pushed record screen in this kit.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE ROUTE MAP
//
//  `Components/RouteMapView.swift` — CartoDB dark tiles, MKMapView, a
//  pace-or-zone-graded polyline — is reused UNCHANGED, per this task's own
//  instruction. `RunDetail.route_polyline` decodes through the existing
//  global `decodePolyline(_:)` (also unchanged, from
//  `Components/TodayPostRunBody.swift`). A run with fewer than two decoded
//  points has no map — this says so in text instead of drawing an empty
//  frame, the same rule `ElevationProfile` already applies via `hasSeries`.
//
//  ─────────────────────────────────────────────────────────────────────────
//  RULE ONE, CONCRETELY
//
//  Every number `RunDetail` carries here is something that HAPPENED — a
//  logged distance, a recorded pace, a heart rate off the wrist — so every
//  one renders `.measured`. There is no modelled number on this screen: the
//  legacy `RunDetail` wire shape (unlike the v5-native `V5Number` contract)
//  does not yet carry a `grade_adjusted_pace_s_per_mi` / `terrain_label`
//  pair on the phone's decoder, so that read is not rendered here rather
//  than guessed at — see the report for this named as a real gap.
//

import SwiftUI
import MapKit

// MARK: - Screen

struct RunDetailV5: View {
    let detail: RunDetail
    /// The coach's verdict on this run (`GET /api/runs/[id]/recap`). Optional
    /// because this view does not fetch — a caller that has not loaded the
    /// recap yet (or the run predates it) just gets no `CoachSay`, not a
    /// blocked screen.
    var recap: RunRecap? = nil
    var onBack: (() -> Void)? = nil
    /// Fires when the shoe row is tapped. Nil (the default) draws the row
    /// with no chevron — "never a chevron on a row that has nothing to open."
    var onChangeShoe: (() -> Void)? = nil

    /// 8b · the decisions the runner took on the wrist. Empty (the default)
    /// draws nothing — most runs have none, and an empty "What you decided"
    /// group would imply the runner decided nothing when they simply ran the
    /// session as written.
    ///
    /// THE COMPOSITION SEAM. The wire carries QUANTITIES, not sentences — the
    /// phone owns this copy, so a revision to the wording never touches the
    /// payload. When the watch's completion fields land, the map from wire to
    /// `WristDecision` goes in ONE factory, not spread across call sites.
    ///
    /// One ruling already made, because the two rules collide and the
    /// collision is not obvious. The drawn ceiling row reads "Ran to 174 ·
    /// the ceiling was 165, and it was 27 degrees". Nothing in this product
    /// has a thermometer: a run's temperature is a weather model for a grid
    /// square and an hour bucket, which by rule one must carry the amber
    /// mark. But this register forbids amber on a decision, ever. Marking it
    /// breaks the register; leaving it bare breaks rule one. So the clause is
    /// DROPPED — the addendum explicitly permits it and the sentence stands
    /// as "Ran to 174 · the ceiling was 165." Dropping a modelled clause is
    /// the only move that satisfies both rules.
    var wristDecisions: [WristDecision] = []

    /// THE COMPOSITION SEAM, and the only place wire quantities become
    /// sentences. The wire carries figures precisely so a wording change never
    /// touches the payload; this is where the wording lives.
    ///
    /// Every row states its own reason. A decision with no reason beside it
    /// reads as a lapse, which is the one thing this register exists to
    /// prevent — so a record that cannot produce a reason produces no row at
    /// all rather than a bare statement.
    ///
    /// The bail is not here. It rides `ruleOutcomes` and predates these
    /// fields; it joins this list when that path is read.
    private var decisionsFromWire: [WristDecision] {
        var out: [WristDecision] = []

        // Ceiling · READING AND LIMIT, never a delta. "+9 over" is what a
        // backend naturally produces and it is unreadable at a glance.
        //
        // The drawn row ends "and it was 27 degrees". Dropped, and not for
        // brevity: nothing in this product has a thermometer, so a run's
        // temperature is a weather model for a grid square and an hour
        // bucket. Rule one says mark it; this register forbids amber on a
        // decision, ever. It can be neither marked nor left bare, so it
        // cannot honestly appear — and the sentence stands without it.
        if let lift = detail.ceiling_lift,
           let reading = lift.readingBpm, let ceiling = lift.ceilingBpm {
            out.append(.init(id: "ceiling",
                             statement: "Lifted the ceiling for the day",
                             reason: "Ran to \(reading) \u{00B7} the ceiling was \(ceiling)"))
        }

        // Skips · one row each, named by ordinal, because "skipped the fourth
        // rep" is what the runner did and "1 rep skipped" is a tally.
        for skip in detail.rep_skips {
            let done: String? = {
                guard let c = skip.repsCompleted, let n = skip.repCount else { return nil }
                return "\(Self.spelled(c).capitalized) of \(Self.spelled(n))"
            }()
            // "you chose it, we did not lose it" used to close this row.
            // It denies a charge nobody made, and raising the failure in
            // order to deny it is how the failure gets into the room —
            // the same shape as a recap saying "noted, not judged", which
            // announces the rule instead of following it. The reason is
            // now what the record actually holds: the watch offered the
            // stop, the runner took it. Whose decision it was is the one
            // fact this register exists to carry.
            let reason = [done, "the watch offered the stop and you took it"]
                .compactMap { $0 }.joined(separator: " \u{00B7} ")
            out.append(.init(id: "skip-\(skip.repIndex)",
                             statement: "Skipped the \(Self.ordinal(skip.repIndex)) rep",
                             reason: reason))
        }

        // Recovery · ONE row for all of them. Four separate rows saying the
        // same thing would make one ordinary decision look like a pattern of
        // them, which is the screen grading a choice by repetition.
        if !detail.recovery_extensions.isEmpty {
            let added = detail.recovery_extensions.compactMap(\.addedSec).reduce(0, +)
            let n = detail.recovery_extensions.count
            let bounds = detail.recovery_extensions.compactMap { e -> Int? in e.afterRepIndex }
            let between: String? = {
                guard let lo = bounds.min(), let hi = bounds.max(), lo != hi else {
                    return bounds.first.map { "after rep \(Self.spelled($0))" }
                }
                return "between reps \(Self.spelled(lo)) and \(Self.spelled(hi + 1))"
            }()
            let howMany = n == 1 ? "Once" : n == 2 ? "Twice" : "\(Self.spelled(n).capitalized) times"
            // THE ROW'S OWN CONTRACT, ENFORCED.
            //
            // "A record that cannot produce a reason produces no row at all.
            // A decision with nothing beside it reads as a lapse." Without
            // `between` — every extension recorded with no rep boundary —
            // the reason collapsed to the single word "Twice", which is a
            // tally, not a reason, and left the statement standing on its
            // own in all but the literal sense. The guard the comment
            // promised was never written for this row; it is written now.
            if let between {
                out.append(.init(id: "recovery",
                                 statement: added > 0
                                    ? "Took \(added) seconds more recovery"
                                    : "Took more recovery",
                                 reason: "\(howMany), \(between)"))
            }
        }
        return out
    }

    private static func ordinal(_ n: Int) -> String {
        let words = ["", "first", "second", "third", "fourth", "fifth", "sixth",
                     "seventh", "eighth", "ninth", "tenth"]
        if n >= 1 && n < words.count { return words[n] }
        // A twenty-rep set is rare and a mile session is not, so the numeric
        // fallback does get reached. `"\(n)th"` spelled 21, 22 and 23 as
        // "21th", "22th", "23th" — printed at a runner, in a row whose whole
        // job is to read as something a person said.
        let lastTwo = abs(n) % 100
        let last = abs(n) % 10
        let suffix: String
        if (11...13).contains(lastTwo) { suffix = "th" }
        else if last == 1 { suffix = "st" }
        else if last == 2 { suffix = "nd" }
        else if last == 3 { suffix = "rd" }
        else { suffix = "th" }
        return "\(n)\(suffix)"
    }

    private static func spelled(_ n: Int) -> String {
        let words = ["zero", "one", "two", "three", "four", "five", "six",
                     "seven", "eight", "nine", "ten"]
        return n >= 0 && n < words.count ? words[n] : "\(n)"
    }

    /// What the group actually draws: whatever the caller passed, or the wire.
    private var resolvedDecisions: [WristDecision] {
        wristDecisions.isEmpty ? decisionsFromWire : wristDecisions
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                AppBar(title: title, eyebrow: eyebrow, onBack: onBack)

                VStack(alignment: .leading, spacing: V5.S.betweenGroups) {

                    /* ═══ LAYER 1 · THE IMMEDIATE ANSWER ═════════════════
                     *
                     * `docs/0901/post-run-experience-review-and-brief-2026-09-02.md`
                     * §4: identity and overview, then ONE compact coach card.
                     * The programme calls the same two things PR-1 and PR-2,
                     * and PR-2 says "near the top" in as many words.
                     *
                     * THIS SCREEN DID NOT DO THAT. The order was stats,
                     * reading, reps, splits, zones, route, shoes, decisions,
                     * and only then the coach — the answer arrived ninth, past
                     * the map and the shoe row, which is the brief's "current
                     * hierarchy is not decisive enough" exactly.
                     *
                     * WHAT THIS OVERTURNS, AND WHY. The recap used to sit
                     * under the wrist decisions on 8a's rule that "a verdict
                     * that arrives before its evidence reads as a mood". That
                     * rule is not discarded — it is applied where it bites.
                     * The decisions are evidence for what the run TAUGHT, not
                     * for what it WAS, so they now sit directly above the
                     * learning claim in Layer 3 and the ordering they were
                     * written to protect is intact. What a coach says first is
                     * the answer; a runner who opens a finished session and
                     * has to scroll past a shoe row to find out how it went is
                     * being made to do the coach's work.
                     */
                    statsRow

                    /* THE RECORDING'S OWN HONESTY, ABOVE EVERY NUMBER IT IS
                     * ABOUT.
                     *
                     * `wire.ts` says of this sentence: "this sentence goes
                     * ABOVE the numbers, because a caveat under a total is a
                     * caveat nobody reads." `PostRunLearnedV5`'s header says
                     * the same thing about itself. Both were false in
                     * composition until now — the block that carries it was
                     * drawn LAST on this screen, under the stats, the splits,
                     * the zone bar, the route and the shoes. Rule 20: a claim
                     * in a comment that nothing verifies is not a fact, and
                     * `_postrun_wire_consumed.audit.test.ts` is now the thing
                     * that verifies the field is read at all.
                     *
                     * On the 2026-09-02 run this is the difference between a
                     * screen that shows five mile rows for a 6.41 mi run and
                     * one that says so first. "Not showing all the miles."
                     */
                    if let pr = detail.postRun {
                        PostRunLearnedV5(model: pr, includes: .capture)
                    }

                    // The coach's answer, second. Layer 1B.
                    recapSection

                    /* ═══ LAYER 2 · WHAT THE SESSION WAS ═════════════════ */

                    if !readingRows.isEmpty {
                        ListGroup(header: "Reading") {
                            ForEach(readingRows, id: \.0) { row in
                                ListRow(label: row.0, value: row.1)
                            }
                        }
                    }

                    // THE REPS COME BEFORE THE SPLIT CHART, and on a rep
                    // session that ordering is the whole point. A runner
                    // opening a tune-up wants rep three; the split chart
                    // cannot show them rep three, because mile two of that
                    // session is the back of rep one, a recovery jog and the
                    // front of rep two averaged into one bar. Evidence at the
                    // grain the session was actually run at, then the shape of
                    // the whole run underneath it.
                    //
                    // RULE THREE. Built only when there is something to build
                    // from; a run with no phases draws nothing at all rather
                    // than a header over an empty list.
                    if !repPieces.isEmpty || toleranceLine != nil {
                        RepBreakdownV5(title: repSectionTitle,
                                       pieces: repPieces,
                                       toleranceLine: toleranceLine)
                    }

                    // The breakdown, drawn only when a decomposition of this
                    // run means anything. `splitsMeaningful` is the SERVER's
                    // judgement (see lib/coach/reading-scope.ts) — an 8x400
                    // has splits, and they describe nothing.
                    if detail.readings?.splitsMeaningful ?? true {
                        breakdownSection
                    }

                    // Same ruling, applied to the heart. A time-in-zone bar
                    // over a warm-up, four reps, three jogs and a cool-down is
                    // mostly the jogs and mostly HR's own rise time, and the
                    // zone the session asked for is unreachable across that
                    // span by construction — so the bar can only ever report a
                    // miss on a session that was executed.
                    /* THE STRIDES ARE PART OF THE SESSION, so they are drawn
                     * with it and not below the map.
                     *
                     * His complaint on 2026-09-02 was two things at once —
                     * "not showing all the miles, not showing the strides" —
                     * and the strides half was answered by adding the rows to
                     * a block that renders after the route and the shoe row.
                     * Six 20-second accelerations are what that easy day
                     * actually WAS; the mile table above cannot see them and
                     * the rep list cannot grade them, so this is the piece
                     * that completes the session, immediately under it. */
                    if let pr = detail.postRun {
                        PostRunLearnedV5(model: pr, includes: .strides)
                    }

                    if hasZoneData, detail.readings?.zoneBarMeaningful ?? true {
                        zoneSection
                    }

                    /* ═══ THE SHAPE OF THE RUN · PR-8 to PR-12 ═══════════
                     *
                     * BELOW the rep list and the mile table, and that order is
                     * the brief's: "workout analysis before generic charts".
                     * A runner opening a tune-up wants rep three, and rep
                     * three is not something a chart can hand him — mile two
                     * of that session is the back of rep one, a jog and the
                     * front of rep two averaged into one bar. Evidence at the
                     * grain the session was run at first; the shape of the
                     * whole run underneath it.
                     *
                     * BELOW the zone bar too, because the zone bar answers
                     * "where did the heart sit" and this chart answers "when".
                     * The bar is the summary and the chart is the detail, and
                     * a summary above its own detail is the way round every
                     * other section on this screen already runs.
                     *
                     * NOTHING HERE IS SAID TWICE (Rule 17). The chart prints
                     * no average pace, no average heart rate and no per-mile
                     * numbers — the stats row, the reading rows and the mile
                     * table already carry all three. It draws an axis, a
                     * shape, and the value under the runner's finger.
                     *
                     * RULE THREE. Absent entirely on a run that recorded no
                     * series — a manual entry, an older treadmill row — rather
                     * than a header over an empty plot.
                     */
                    if let a = detail.analysis {
                        RunAnalysisV5(analysis: a,
                                      gradeAdjustedSecPerMi: detail.grade_adjusted_pace_s_per_mi,
                                      terrainLabel: detail.terrain_label)
                    }

                    /* ═══ LAYER 3 · WHAT IT MEANT ════════════════════════ */

                    // EVIDENCE BEFORE JUDGEMENT. 8a's rule, kept and moved to
                    // where it actually bites: the runner's own decisions are
                    // evidence for what the run TAUGHT, so they sit directly
                    // above the learning claim rather than above the recap.
                    // A verdict that arrives before its evidence reads as a
                    // mood; the recap in Layer 1 states what happened, and
                    // that is not the judgement this rule was written about.
                    if !resolvedDecisions.isEmpty {
                        WristDecisionsV5(decisions: resolvedDecisions)
                    }

                    // WHAT THE RUN TAUGHT THE COACH — the SAME component the
                    // after-run sheet draws, over the SAME object. Not a view
                    // that looks like the other one: one view, so a change to
                    // what the runner reads cannot land on one screen and miss
                    // the other. That divergence is the post-run brief's first
                    // P0 and it was live on 2026-09-01.
                    //
                    // `.meaning` only. The capture sentence and the strides
                    // from this same object are drawn in Layers 1 and 2, where
                    // each belongs — one component still owns all three
                    // pieces of copy, so the two post-run screens cannot drift.
                    if let pr = detail.postRun {
                        PostRunLearnedV5(model: pr, includes: .meaning)
                    }

                    /* THE ONE COMPARABLE PRIOR SESSION · PR-15.
                     *
                     * Layer 3, and specifically AFTER what the run taught the
                     * coach. The brief files matched effort under "meaning and
                     * context", and context is what it is: the learning claim
                     * above stands on this run's own evidence, and this says
                     * where that sits against the last time he did the same
                     * session. Putting it first would make the comparison read
                     * as the finding, which it is not.
                     *
                     * At most one, hidden entirely when nothing is defensible,
                     * and carrying its own sentence when it looked and refused.
                     */
                    MatchedWorkoutV5(matched: detail.matchedWorkout,
                                     refusal: detail.matchedRefusal)

                    /* ═══ LAYER 4 · THE RECORD ═══════════════════════════
                     *
                     * The brief's Layer 4: route, shoes, source. Reference
                     * material, reached by scrolling, and never in front of
                     * the answer.
                     */

                    if shape.showsRoute { routeSection }

                    if let shoe = wornShoe {
                        ListGroup(header: "Shoes worn") {
                            ListRow(label: shoe.displayName,
                                    sub: shoeMileageSub(shoe),
                                    onTap: onChangeShoe)
                        }
                    }

                    // The brief's "Add effort/RPE where supported" (Actions),
                    // kept secondary to the interpretation above it and, on
                    // this screen, to the record it sits beside — same row
                    // `TodayAfterV5`'s "Log" group draws, over the same API,
                    // so a rating made from either screen is the same rating.
                    ListGroup(header: "Log") {
                        RPECaptureRow(runId: detail.id)
                    }
                }
                .padding(.horizontal, V5.S.gutter)
                .padding(.bottom, V5.S.s32)
                // A vertical page must never pan sideways — see `v5PageWidth`.
                .v5PageWidth()
            }
        }
        .background(V5.surfacePage)
        .scrollIndicators(.hidden)
    }

    // MARK: - Title / eyebrow

    /// Device-default names carry zero information — mirrors
    /// `LogRun.hasMeaningfulName` (`Models/Runs.swift`) so the two screens
    /// agree on which names are worth showing.
    private static let genericNames: Set<String> = [
        "run", "workout", "treadmill", "treadmill run", "outdoor run", "indoor run",
    ]

    var title: String {
        if let name = detail.name?.trimmingCharacters(in: .whitespacesAndNewlines),
           !name.isEmpty, !Self.genericNames.contains(name.lowercased()) {
            return name
        }
        // AN ENUM IS NOT A NAME.
        //
        // This used to title-case `detail.type` and hand it to the display
        // register, which is uppercase — so a race-week tune-up headlined
        // RACE_WEEK_TUNEUP, a column value printed at a runner in 44pt
        // Archivo. Every other surface reads `/api/v5/today`, which has run
        // its `displayTypeFor` table since it was written; this payload
        // simply never carried the word.
        //
        // The table is NOT copied here. That is this file's own zone-target
        // lesson, one screen down: the local copy of `zone-target.ts` had
        // drifted from the original before anyone noticed. The server sends
        // `type_display` now and this reads it.
        if let display = detail.type_display?.trimmingCharacters(in: .whitespacesAndNewlines),
           !display.isEmpty {
            return display
        }
        // A server that predates the field. Underscores still may not reach
        // the glass, so the fallback breaks the enum apart rather than
        // shipping it whole — "Race week tuneup" is wrong-ish, "RACE_WEEK_
        // TUNEUP" is a leak.
        if let type = detail.type, !type.isEmpty {
            let words = type.replacingOccurrences(of: "_", with: " ")
            return words.prefix(1).uppercased() + words.dropFirst()
        }
        return "Run"
    }

    private var eyebrow: String? { Self.longDate(detail.date) }

    private static func longDate(_ iso: String) -> String? {
        guard let date = isoDayFormatter.date(from: iso) else { return nil }
        return displayFormatter.string(from: date)
    }
    private static let isoDayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.calendar = Calendar(identifier: .gregorian)
        f.timeZone = TimeZone(identifier: "UTC")
        return f
    }()
    private static let displayFormatter: DateFormatter = {
        let f = DateFormatter()
        // US order — month, then day. David, 2026-08-25: "it should be Month, Day,
        // Year formatted". `lib/format/date.ts` is the same decision on the
        // server, for the strings it composes.
        f.dateFormat = "EEEE, MMMM d"
        f.timeZone = TimeZone(identifier: "UTC")
        return f
    }()

    // MARK: - Stats row · Distance / Time / Pace, same poster the after-run
    // screen reads (5b's `done.distance` / `done.time` / `done.pace`).

    private var statsRow: some View {
        HStack(alignment: .firstTextBaseline, spacing: V5.S.s12) {
            stat("Distance", .measured(FaffFmt.milesUnit(detail.distance_mi)))
            stat("Time", .measured(detail.time_moving ?? detail.time_elapsed))
            stat("Pace", .measured(detail.pace.map { "\($0)/mi" }), asked: askedPaceText)
        }
        .padding(V5.S.tilePad)
        .background(V5.materialTile, in: RoundedRectangle(cornerRadius: V5.R.r22, style: .continuous))
    }

    /// The pace the coach's verdict was judged against, when printing it
    /// beside a whole-run average is an honest comparison.
    ///
    /// THIS SCREEN SHOWED A PACE WITH NOTHING TO READ IT AGAINST. 5b's table
    /// is literally called asked-vs-ran; run detail, opened from history,
    /// carried only the ran side. `evaluated_pace_s_per_mi` has been on the
    /// recap wire since the frozen-target fix and was in none of the phone's
    /// `CodingKeys`, so the screen had no way to say what was asked.
    ///
    /// SUPPRESSED ON A STRUCTURED SESSION, and that guard is the whole
    /// difficulty. On a rep workout the evaluated target is the REP pace —
    /// 6:52 for the 2026-08-11 tune-up — and the poster's pace is the average
    /// of a warm-up, four reps, three jogs and a cool-down, 7:18. Printing
    /// "asked 6:52" under "7:18/mi" invites the runner to subtract two
    /// numbers that were never about the same thing, and would read as a
    /// 26-second miss on a session they executed. Those sessions carry their
    /// ask per rep in the list below instead, where it belongs.
    ///
    /// RULE ONE. A target pace comes out of the plan's pace table: modelled.
    /// The word "asked" is what carries that now the tilde is retired, and
    /// VoiceOver says "estimated" before the figure.
    var askedPaceText: String? {
        guard workPhases.isEmpty,
              let sec = recap?.evaluatedPaceSPerMi, sec > 0,
              let text = FaffFmt.pace(secPerMi: Double(sec)) else { return nil }
        return text
    }

    private func stat(_ label: String, _ value: FaffValue, asked: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: V5.S.s6) {
            Text(label)
                .font(.faffText(TypeScaleV5.label12))
                .foregroundStyle(V5.textQuiet)
            FaffValueText(value, font: .faffText(20, weight: .semibold), color: V5.textPrimary)
            if let asked {
                Text("asked \(asked)")
                    .font(.faffText(TypeScaleV5.label12))
                    .foregroundStyle(V5.textQuiet)
                    .accessibilityLabel("asked estimated \(asked) per mile")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Reading · avg/max HR, cadence, temperature — whatever the run
    // actually carries. Each one only appears when `RunDetail` has it; there
    // is no invented row for a field the source did not populate.

    /// The client-side shape, kept ONLY as the fallback below. `readings` from
    /// the server is the decision; this is what answers when a phone on a new
    /// build meets a server that predates it.
    var shape: RunShapeV5 {
        RunShapeV5.of(workoutType: detail.type, indoor: false)
    }

    /// EVERY AVERAGE NAMES ITS INTERVAL, OR IT DOES NOT APPEAR.
    ///
    /// What this used to be: `hr_avg` and `cadence_avg` straight out of the
    /// row, on every run, with no label beyond "avg". On 2026-08-11 that drew
    /// "Heart rate, avg · 153 bpm" over a session whose four kilometre reps ran
    /// 164, 169, 168 and 160. The stored 153 is the mean of hard reps and slow
    /// jogs and **nothing on that run happened at it** — a number that is
    /// arithmetically correct and describes no part of the session, which is
    /// the whole failure mode this pass exists to remove.
    ///
    /// The scope is not decided here. `detail.readings` is derived server-side
    /// (`lib/coach/reading-scope.ts`) so this screen and the web one cannot
    /// drift apart, and it keys on the run's PHASE STRUCTURE rather than its
    /// type — because only 36 of his 143 live runs carry a semantic type,
    /// while phases are on every watch run since June and are the thing that
    /// actually makes a whole-run mean span two intents.
    ///
    /// THREE OUTCOMES, AND THE THIRD IS THE ONE THAT MATTERS:
    ///   whole · one intent end to end · row unchanged, no label needed
    ///   work  · row reads "Heart rate, across the 4 reps"
    ///   none  · **no row at all**, and that is an answer
    ///
    /// `none` fires on reps under two minutes, where `Research/03` §14 says
    /// `| Reps / R-pace (<2 min) | Pace | RPE | Ignore HR |`. Not average it
    /// more carefully — ignore it. An 8×400 never reaches its HR band, so the
    /// HR it did reach is the rise time. Drawing a smaller, better-labelled
    /// version of a number that measures the sensor rather than the runner
    /// would be the same mistake with a nicer caption.
    ///
    /// MAX HR SURVIVES ALL THREE. A peak is not an average — it names the
    /// single hardest moment, which is a true statement about any run
    /// regardless of how many intents it contained.
    ///
    /// Nil `readings` (a payload from a server that predates the field) falls
    /// back to the old unscoped rows, so this ships without a coordinated
    /// release.
    private var readingRows: [(String, FaffValue)] {
        var out: [(String, FaffValue)] = []

        if let r = detail.readings {
            if !r.hr.isRefused, let hr = r.hr.value {
                let label = r.hr.isWhole ? "Heart rate, avg" : "Heart rate, \(r.hr.note ?? "on the work")"
                out.append((label, .measured("\(hr) bpm")))
            }
            if let hrMax = detail.hr_max { out.append(("Heart rate, max", .measured("\(hrMax) bpm"))) }
            if !r.cadence.isRefused, let cad = r.cadence.value {
                let label = r.cadence.isWhole ? "Cadence" : "Cadence, \(r.cadence.note ?? "on the work")"
                out.append((label, .measured("\(cad) spm")))
            }
        } else {
            if let hr = detail.hr_avg { out.append(("Heart rate, avg", .measured("\(hr) bpm"))) }
            if let hrMax = detail.hr_max { out.append(("Heart rate, max", .measured("\(hrMax) bpm"))) }
            if let cad = detail.cadence_avg { out.append(("Cadence", .measured("\(cad) spm"))) }
        }
        // RULE ONE. Nothing on the phone or the watch has a thermometer in it.
        // A run's temperature is a weather read for a grid square and an hour
        // bucket — `lib/weather/openmeteo.ts` fetches it from the forecast API
        // for a recent run and the reanalysis archive for an old one, and the
        // `apple_hk` path is Apple Weather, which is another model. The wire
        // carries no source with it (`RunDetail.temp_f` is a bare Double), so
        // by the type's own rule — if a screen cannot tell, the answer is
        // modelled — this is modelled. Same shape as the race-morning forecast
        // that shipped as a hard read.
        //
        // 2026-08-25 · AND THE LABEL HAS TO CARRY IT, because since the amber
        // tilde was retired on 2026-08-21 nothing else does. Driven with
        // VoiceOver attached, this row announced "estimated 61 degrees
        // Fahrenheit" while the screen drew a bare "61°F" in a section headed
        // READING, between "Heart rate, avg 141 bpm" and "Cadence 172 spm" —
        // two genuine reads. The accessible name knew more than the picture,
        // which means the picture was the thing that was wrong.
        //
        // The retirement's own argument was that the words beside a value were
        // already carrying the distinction: "Pace band" and "HR ceiling" are
        // prescriptions by name, Races says "Projected", 8c says "on the
        // watch". "Temperature" says nothing, so it is the row that argument
        // missed. The comma-qualifier is the same idiom as "Cadence, on the
        // work" directly above.
        if shape.showsTemperature, let temp = detail.temp_f {
            out.append(("Temperature, from weather", .modelled("\(Int(temp.rounded()))\u{00B0}F")))
        }
        return out
    }

    // MARK: - What the coach actually said
    //
    // `RunRecap` decodes `facts`, `win` and `conditions_note` and this screen
    // drew `verdict` and `coach_tip`. The other three arrived on every fetch
    // and were discarded — the same drop 5b had, in a second place.
    //
    // Same order, same reasoning, same one-voice rule as `TodayAfterV5`'s
    // `recapSection`. Kept as two implementations rather than one shared
    // component on purpose: 5b reads `V5Today` and this reads `RunRecap`, two
    // wire shapes that carry the same five strings under different names, and
    // a shared view would need an adapter longer than either body.

    @ViewBuilder
    private var recapSection: some View {
        let verdict = recap?.verdict.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let win = recap?.win?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let facts = (recap?.facts ?? []).filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        let conditions = recap?.conditions_note?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

        if !verdict.isEmpty || !win.isEmpty || !facts.isEmpty || !conditions.isEmpty {
            Tile {
                if !win.isEmpty {
                    Text(win)
                        .font(.faffText(TypeScaleV5.body17, weight: .semibold))
                        .foregroundStyle(V5.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if !verdict.isEmpty {
                    Text(verdict)
                        .font(.faffText(TypeScaleV5.body17))
                        .foregroundStyle(V5.textPrimary)
                        .lineSpacing(4)
                        .fixedSize(horizontal: false, vertical: true)
                }
                ForEach(facts, id: \.self) { fact in
                    Text(fact)
                        .font(.faffText(TypeScaleV5.body15))
                        .foregroundStyle(V5.textSecondary)
                        .lineSpacing(3)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if !conditions.isEmpty {
                    Text(conditions)
                        .font(.faffText(TypeScaleV5.label14))
                        .foregroundStyle(V5.textQuiet)
                        .lineSpacing(3)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }

        if let tip = recap?.coach_tip?.trimmingCharacters(in: .whitespacesAndNewlines), !tip.isEmpty {
            CoachCaveat(text: tip)
        }
    }

    // MARK: - Rep by rep · P44's phase breakdown, finally drawn
    //
    // THE COMPOSITION SEAM. `RepBreakdownV5` takes formatted strings; this is
    // the one place a wire phase becomes words, exactly as `decisionsFromWire`
    // is the one place a wire quantity becomes a decision sentence.

    private var phases: [PhaseBreakdown] { detail.phase_breakdown ?? [] }

    private var workPhases: [PhaseBreakdown] { phases.filter { $0.type == "work" } }

    /// The rep indices the runner CHOSE to skip, as an explicit record.
    ///
    /// Never inferred from `completed: false`. A dropped rep and a rep the
    /// watch offered to stop are the same byte on the wire, and on a screen
    /// whose register says a decision is not a lapse they must not read the
    /// same. `RunDetail.rep_skips` is the only thing that can tell them apart.
    ///
    /// `RunRepSkip.repIndex` counts REPS (the fourth rep), while
    /// `PhaseBreakdown.index` counts PHASES (the seventh phase, because the
    /// jogs are in there too). Resolved by position within the work phases,
    /// which is the only mapping the two shapes share.
    var chosenSkipPhaseIndices: Set<Int> {
        let skipped = Set(detail.rep_skips.map(\.repIndex))
        guard !skipped.isEmpty else { return [] }
        var out: Set<Int> = []
        for (ordinal, phase) in workPhases.enumerated() where skipped.contains(ordinal + 1) {
            out.insert(phase.index)
        }
        return out
    }

    /// "Rep by rep" when the session was a rep set, "Piece by piece" when it
    /// was a warm-up, a block and a cool-down. Naming a two-phase tempo "Rep
    /// by rep" would call something a rep that the plan never called one.
    var repSectionTitle: String {
        /* A STRIDE IS NOT A REP, AND NEITHER IS AN EASY BLOCK (2026-09-02).
         *
         * `workPhases` is every phase typed "work", which on the runner's
         * easy-plus-strides day is his 5.0 mi easy block PLUS six 20-second
         * accelerations — seven, so this returned "Rep by rep" over a session
         * the plan never called a rep set. It is the same off-by-one the server
         * composer had and the same one `WorkoutEngine.repCountForDisplay`
         * still has on the wrist: one expression, three surfaces.
         *
         * `pace_shape == "effort"` is the server's resolved answer, arriving
         * through `PhaseBreakdown` — not a second opinion formed here. A stride
         * is the only thing that carries it on a work phase, because
         * `paceShapeFor` returns `effort` for `byEffort` and nothing else does.
         *
         * "Piece by piece" is also the honest word when the pieces are a body
         * and a drill rather than a set, which is why a steady session never
         * reaches the rep wording at all. */
        guard shape.decomposition != .miles else { return "Piece by piece" }
        let reps = workPhases.filter { $0.pace_shape != "effort" }
        return reps.count >= 2 ? "Rep by rep" : "Piece by piece"
    }

    /// The phases, as words.
    ///
    /// EMPTY ON A SINGLE-PHASE SESSION, deliberately. When the watch recorded
    /// one phase, that phase IS the run — the poster at the top of this screen
    /// already carries its distance, its time and its pace, and restating them
    /// in a list of one is a section that says nothing. The tolerance line
    /// below still draws, because that is a fact the poster does not hold.
    var repPieces: [RepPiece] {
        guard phases.count > 1 else { return [] }
        let chosen = chosenSkipPhaseIndices
        return phases.map { p in
            let isChosenSkip = chosen.contains(p.index)
            return RepPiece(
                id: p.index,
                label: p.label.isEmpty ? Self.fallbackLabel(p) : p.label,
                isWork: p.type == "work",
                actualPace: p.actual_pace.map { "\($0)/mi" },
                // A RECOVERY JOG'S "TARGET" IS NOT A TARGET.
                //
                // The server writes easy pace into `target_pace` for every
                // recovery and cool-down phase because the watch needs a
                // number to draw a band against. On 2026-08-11 that made a
                // 90-second jog "miss" its 8:57 by two and a half minutes,
                // which is what a jog between two hard kilometres is supposed
                // to look like. Printing "asked 8:57" beside it would assert
                // a prescription the plan never wrote.
                // A STRIDE IS NEVER SHOWN A TARGET (2026-09-02, from a render).
                //
                // `p.type == "work"` alone printed "asked 6:41" beside every
                // one of the runner's six strides, and the sixth — 7:11 — read
                // as a thirty-second miss. `Research/04-workout-vocabulary.md`
                // §7.2 calls a stride "relaxed", puts it at 85-95% of max
                // effort and says in as many words that it is "Not a workout",
                // which is why the server grades it `effort`, a shape that is
                // never pace-graded, and why `PostRunStrideV5` has no field
                // that could hold a target at all.
                //
                // So the same screen carried both treatments of one quantity:
                // this list asserting a prescription, and the strides section
                // two inches below correctly asserting none (Rule 16). The
                // ask was never real — `appendStrides` gives a stride a
                // deliberately wide 45 s/mi band precisely so nothing grades
                // it — and printing it invites the runner to subtract two
                // numbers the plan never put in the same sentence.
                //
                // `pace_shape` is the server's own resolved answer arriving
                // through `PhaseBreakdown`, not a second opinion formed here:
                // `paceShapeFor` returns `effort` for `byEffort` and for
                // nothing else. It is the same field `repSectionTitle` already
                // reads one screen up to keep a stride from being counted a rep.
                askedPace: (p.type == "work" && p.pace_shape != "effort") ? p.target_pace : nil,
                detail: Self.pieceDetail(p),
                verdictPhrase: isChosenSkip ? nil : Self.verdictPhrase(p),
                chosen: isChosenSkip
            )
        }
    }

    private static func fallbackLabel(_ p: PhaseBreakdown) -> String {
        switch p.type {
        case "warmup":   return "Warm-up"
        case "cooldown": return "Cool-down"
        case "recovery": return "Recovery"
        case "work":     return "Rep \(p.index + 1)"
        default:         return "Phase \(p.index + 1)"
        }
    }

    /// Distance, duration and heart rate, in that order, joined by the middle
    /// dot. Every one of them is a reading, so every one is measured; a phase
    /// that carried none of them produces no line rather than an empty one.
    private static func pieceDetail(_ p: PhaseBreakdown) -> String? {
        var parts: [String] = []
        if let mi = FaffFmt.milesUnit(p.actual_distance_mi) { parts.append(mi) }
        if let sec = p.actual_duration_sec, let clock = FaffFmt.clock(sec: Double(sec)) {
            parts.append(clock)
        }
        if let hr = p.avg_hr { parts.append("HR \(hr)") }
        return parts.isEmpty ? nil : parts.joined(separator: " \u{00B7} ")
    }

    /// The watch's grade, in plain words.
    ///
    /// THE WORD IS THE WHOLE TREATMENT. No amber, no red, no green — see
    /// `RepBreakdownV5`'s header for why a section that grades every rep in
    /// isolation would be arguing with the coach's own verdict two inches
    /// below it, which has the heat and the terrain this list does not.
    ///
    /// The wire's four grades and what each one actually means:
    ///
    ///   hit        · mean pace in band AND at least 70% of samples in band
    ///   drifted    · mean pace in band, under 70% of samples in band
    ///   missed     · mean pace outside the band
    ///   incomplete · the phase ended before reaching its target
    ///
    /// "Drifted" is the one worth spelling out. It is not a worse "hit" — the
    /// average was fine and the execution sawed — so the phrase names the
    /// sawing rather than implying a smaller miss.
    ///
    /// A RECOVERY JOG IS NEVER GRADED. The device graded it against easy pace
    /// because that is the only number it had; jogging slowly between hard
    /// kilometres is the instruction, not a miss, and repeating the device's
    /// word here would print "outside the band" against a phase executed
    /// exactly as written. `nil` says the honest thing: nothing to grade.
    ///
    /// PACE-SHAPE-1 (2026-09-01) · A CEILING PHASE NEVER READS "OUTSIDE THE
    /// BAND". A warm-up and a cool-down are easy running and their target is
    /// the easy band's FAST edge, so running slower than it is correct. On
    /// 2026-09-01 a 8:54/mi cool-down under an 8:22/mi ceiling came back
    /// `missed` from the wrist while a 8:36/mi warm-up against the same number
    /// came back `hit`, and this function would have printed "Outside the
    /// band" over the correct one. It now reads `pace_shape` and says what
    /// actually happened.
    ///
    /// `status_label` is the server's own word, composed by the one owner
    /// (`lib/training/execution-semantics.ts`) so the phone and every other
    /// surface read the same sentence. It is preferred whenever it arrives;
    /// the switch below is the fallback for a payload from an older backend
    /// and for the two legacy verdict words still sitting on stored rows.
    static func verdictPhrase(_ p: PhaseBreakdown) -> String? {
        // A ceiling phase gets its word whatever its type — a warm-up and a
        // cool-down are exactly the phases this fixes.
        if p.pace_shape == "ceiling" {
            switch p.verdict {
            case "fast":       return "Over the ceiling"
            case "hit":        return "Under the ceiling"
            case "incomplete": return "Ended before its target"
            default:           return p.status_label
            }
        }
        guard p.type == "work" else { return nil }
        if let label = p.status_label, !label.isEmpty { return label }
        switch p.verdict {
        case "hit":        return "In the band"
        case "fast":       return "Quicker than the band"
        case "slow":       return "Slower than the band"
        // LEGACY, from builds before 2026-09-01. Kept because stored rows
        // carry them; no build emits them.
        case "drifted":    return "In and out of the band"
        case "missed":     return "Outside the band"
        case "incomplete": return "Ended before its target"
        default:           return nil
        }
    }

    /// The watch's tolerance arithmetic across the work, as one sentence.
    ///
    /// THE MOST HONEST SENTENCE AVAILABLE ABOUT A SESSION, and it has been on
    /// the wire, computed by the device against the server's own tolerance,
    /// reaching no screen. On 2026-08-23 the work block carried 90 seconds
    /// inside the band against 2280 outside it. The run detail said nothing.
    ///
    /// WORK PHASES ONLY. The device also counts a warm-up and a cool-down
    /// against easy pace, and rolling those in would let a long steady
    /// cool-down drown the four kilometres the session was actually about.
    /// `lib/runs/run-shape.ts`'s `workToleranceShare` filters the same way,
    /// for the same reason.
    ///
    /// "IT GRADED" IS LOAD-BEARING. In + out is shorter than the work's real
    /// duration — the device only counts a second it had a pace for — so the
    /// denominator is graded time, not elapsed time, and the sentence says so
    /// rather than quietly presenting one as the other.
    var toleranceLine: String? {
        var inSec = 0, outSec = 0
        var counted = 0
        for p in workPhases {
            guard let i = p.time_in_tolerance_sec, let o = p.time_out_of_tolerance_sec else { continue }
            inSec += i; outSec += o; counted += 1
        }
        let total = inSec + outSec
        guard counted > 0, total > 0,
              let inside = FaffFmt.clock(sec: Double(inSec)),
              let graded = FaffFmt.clock(sec: Double(total)) else { return nil }
        return "The watch had you inside the target pace for \(inside) of the \(graded) of work it graded."
    }

    // MARK: - Splits

    /// The band a split can be judged against, or nil.
    ///
    /// Only the steady kinds carry one — easy, long, recovery — because only
    /// they ask for a single pace window across the whole run. A threshold or
    /// interval session has a rep pace, and holding mile three of a session
    /// with a warmup, six reps and a cooldown against that number would mark
    /// every recovery jog "outside the target". So a structured session gets
    /// no band and its bars all draw in signal, which says what is true: these
    /// are the miles, and this chart is not the place the work gets judged.
    ///
    /// 2026-08-30 · ITS LAST ON-SCREEN CONSUMER IS GONE. `MileBreakdownV5` no
    /// longer colours by the window, so this feeds only `splitBars`, the model
    /// behind the retired bar chart. Kept because that model is what the
    /// wire-level test reads; it renders nothing today.
    private var splitBand: (lo: Int, hi: Int)? {
        guard let spec = detail.planned_spec,
              let lo = spec.pace_target_s_per_mi_lo,
              let hi = spec.pace_target_s_per_mi_hi,
              hi >= lo else { return nil }
        return (Int(lo.rounded()), Int(hi.rounded()))
    }

    /// The run mile by mile, for `MileBreakdownV5`.
    ///
    /// `detail.distance_mi` sizes a trailing piece the wire did not size
    /// itself — the same arithmetic `splitBars` does for its last bar, kept in
    /// one place in the component so the chart and the table cannot come to
    /// different conclusions about how long the last mile was.
    var milePieces: [MilePiece] {
        MileBreakdownV5.pieces(from: detail.splits,
                               totalMi: detail.distance_mi > 0 ? detail.distance_mi : nil)
    }

    /// WHAT THE MILE TABLE COVERS, when the reconciliation sentence has not
    /// already said it.
    ///
    /// The two are mutually exclusive on purpose (Rule 17). `postRun.capture`
    /// is prose at the top of the screen and, when it exists, it already names
    /// this table. It exists only for a run with overtime or a failed clock —
    /// so a run whose splits stop short of a distance the phases fully account
    /// for said nothing anywhere, and the table read as the run.
    ///
    /// Nil is the common answer and draws nothing.
    var mileCoverageLine: String? {
        guard let pr = detail.postRun, pr.capture == nil else { return nil }
        return pr.coverage?.mileTableQualifier
    }

    /// The samples the route map normalises its pace ramp across, built the
    /// same way `routeBody` builds the map's own. One expression, read twice,
    /// so the table and the line cannot be handed different runs.
    private var routePhaseSamples: [PhaseSample] {
        RouteMapView.phaseSamples(from: detail.phase_breakdown)
    }

    /// MILES OR PIECES, decided by what the session was and what it recorded.
    @ViewBuilder
    var breakdownSection: some View {
        let d = shape.decomposition(hasSections: !repPieces.isEmpty,
                                    hasMiles: !milePieces.isEmpty)
        switch d {
        case .sections:
            RepBreakdownV5(title: repSectionTitle,
                           pieces: repPieces,
                           toleranceLine: toleranceLine)
        /* BOTH, BODY FIRST (2026-09-02).
         *
         * An easy run with strides is two things at once and the screen used to
         * draw only the first. `.milesAndSections` fires when a steady-shaped
         * session ALSO recorded structure, which on a plain easy or long run it
         * does not — `repPieces` is empty on a single-phase recording, by
         * design. See `RunShapeV5.Decomposition.milesAndSections`.
         *
         * The mile table keeps the pace caption and the pace ramp; the piece
         * list carries no caption of its own beyond its tolerance line, so
         * nothing is said twice. */
        case .milesAndSections:
            MileBreakdownV5(title: shape.breakdownTitle(.miles),
                            pieces: milePieces,
                            paceLine: shape.showsPerMilePace
                                ? RouteMapView.paceColumnCaption(splits: detail.splits,
                                                                 phases: routePhaseSamples)
                                : nil,
                            coverageLine: mileCoverageLine,
                            paceColor: MileBreakdownV5.paceRamp(splits: detail.splits,
                                                                phases: routePhaseSamples),
                            allowsElevation: shape.showsElevation,
                            allowsPace: shape.showsPerMilePace)
            RepBreakdownV5(title: repSectionTitle,
                           pieces: repPieces,
                           toleranceLine: toleranceLine)
        case .miles:
            MileBreakdownV5(title: shape.breakdownTitle(.miles),
                            pieces: milePieces,
                            // The colour rule this table now runs on is the
                            // map's, so the sentence explaining it is the
                            // map's too. Only printed when the pace column is
                            // drawn at all — a recovery run withholds pace,
                            // and a caption about a column that is not there
                            // describes nothing.
                            paceLine: shape.showsPerMilePace
                                ? RouteMapView.paceColumnCaption(splits: detail.splits,
                                                                 phases: routePhaseSamples)
                                : nil,
                            coverageLine: mileCoverageLine,
                            paceColor: MileBreakdownV5.paceRamp(splits: detail.splits,
                                                                phases: routePhaseSamples),
                            allowsElevation: shape.showsElevation,
                            allowsPace: shape.showsPerMilePace)
        case .none:
            // RULE THREE, belt and braces. A run with neither draws nothing.
            EmptyView()
        }
    }

    var splitBars: [SplitBar] {
        let band = splitBand
        // `hr` travels with the mile from here. It has sat in `RunSplit`
        // unread since the type was written — see `SplitBar.hr` for what it is
        // and is not allowed to do with it while round three item 5 is open.
        let parsed: [(mile: Int, sec: Int, hr: Int?)] = detail.splits.compactMap { s in
            guard let sec = Self.paceSeconds(s.pace) else { return nil }
            return (s.mile, sec, s.hr)
        }
        // A run of 6.3 miles reports seven splits, and the seventh is three
        // tenths long. Size it to what it actually covers rather than letting
        // a fragment draw with a whole mile's weight.
        let tail: Double = {
            guard detail.distance_mi > 0, parsed.count > 1 else { return 1 }
            let remainder = detail.distance_mi - Double(parsed.count - 1)
            return (remainder > 0 && remainder < 0.95) ? remainder : 1
        }()
        return parsed.enumerated().map { i, p in
            SplitBar(mile: p.mile,
                     paceSec: p.sec,
                     fraction: i == parsed.count - 1 ? tail : 1,
                     inBand: band.map { p.sec >= $0.lo && p.sec <= $0.hi },
                     hr: p.hr)
        }
    }

    private static func paceSeconds(_ s: String?) -> Int? {
        guard let s, !s.isEmpty else { return nil }
        let parts = s.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2, parts[1] >= 0, parts[1] < 60 else { return nil }
        return parts[0] * 60 + parts[1]
    }

    // `splitsSection` IS GONE (2026-08-30). It was never composed into this
    // view — `MileBreakdownV5` replaced the bar chart on screen — and what it
    // still held was the sentence "Filled where the mile sat inside what the
    // session asked for", i.e. exactly the band-as-colour rule this screen has
    // just stopped using. An unmounted view carrying a retired rule is an
    // invitation to remount it. `splitBars` survives it: it is the model the
    // wire-level test reads, and `SplitBar` is where `RunSplit.hr` travels.

    // MARK: - Zone bar

    private var hasZoneData: Bool {
        let z = detail.hrZonePcts
        return (z.z1 + z.z2 + z.z3 + z.z4 + z.z5) > 0
    }

    /// The zone(s) the session ASKED for — read off the wire, not derived.
    ///
    /// ─────────────────────────────────────────────────────────────────────
    /// WHAT THIS USED TO BE, AND WHY IT IS GONE
    ///
    /// This was a local `switch` over `detail.type` that restated
    /// `lib/coach/zone-target.ts` from memory. Two things were wrong with it,
    /// and the second is the one that mattered.
    ///
    ///   · IT HAD DRIFTED. The local copy mapped `mp` and had never heard of
    ///     `race_week_tuneup`; the server's table is the reverse. A copy of a
    ///     table is a table that will disagree with the original, and this one
    ///     already did.
    ///
    ///   · IT WAS KEYED ON THE WRONG THING. `detail.type` is the RUN's type,
    ///     what came back from the watch or Strava. The zone bar asks "did it
    ///     sit where it was asked to", and the ask lives in the plan row, not
    ///     in the run. `detail.zoneTargets` comes from `plan_workouts.type`
    ///     and `.distance_mi` — the prescription — so the bar is now answering
    ///     the question it was drawn for.
    ///
    /// Races used to highlight nothing here, deliberately: round three said a
    /// race targets Z4/Z5, the constant said zone 3, and drawing zone 3 on a
    /// race would have put the screen at odds with the ruling that
    /// commissioned it. Refusing a design ruling as grounds to move a
    /// physiological constant was right. The constant itself was wrong, and
    /// has since been re-derived from the two doctrine tables that settle it
    /// (Research/08 §6.1 race HR bands × Research/03 §4 ACSM zones, commit
    /// c6b7ed13): 5K and 10K ask for Z5, a half for Z4 AND Z5, a marathon for
    /// Z4. No race distance doctrine publishes reaches down into zone 3.
    ///
    /// So there is nothing left to dodge, and nothing left to restate.
    private var zoneTargets: Set<Int> { Set(detail.zoneTargets) }

    private var zoneSection: some View {
        Tile {
            Text("Where the heart sat")
                .font(.faffText(TypeScaleV5.label13))
                .foregroundStyle(V5.textSecondary)
            ZoneBar(shares: [detail.hrZonePcts.z1, detail.hrZonePcts.z2, detail.hrZonePcts.z3,
                             detail.hrZonePcts.z4, detail.hrZonePcts.z5],
                    targets: zoneTargets, height: 44, labels: true)
        }
    }

    // MARK: - Route · the real map, not a redrawn one
    //
    // `RouteMapView` colors by pace (see its header) — `mappedEffort` below
    // only picks which AXIS that coloring runs on, the same choice
    // `RunDetail.type` already drives everywhere else in the app. It changes
    // no number on screen.
    //
    // THE MAP AND THE CHART NOW ANSWER TWO DIFFERENT QUESTIONS (David
    // 2026-08-30, asked directly what the route line should show: "Pace
    // gradient but no grey it blends in too much. Use the faff color
    // system."). The note that used to sit under `paceBand` here said the
    // grey stretch on the map and the grey bar in the chart "must be the same
    // mile". That coupling is deliberately broken and this comment records
    // it rather than leaving the old claim standing:
    //
    //   · the MAP is a continuous amber→orange pace gradient, normalised
    //     across the run's own fastest and slowest mile. It knows nothing
    //     about `splitBand` any more — `RouteMapView` no longer takes one.
    //     It answers WHERE HE RAN AND HOW HARD, and it stays legible on a run
    //     that ignored the plan, which the coupled version did not: his real
    //     13.49 mi long run had twelve of thirteen miles outside the window
    //     and rendered as one flat grey.
    //   · the TABLE above (`MileBreakdownV5`) now draws its pace column off
    //     `RouteMapView.runPaceColorFn`, the same function and the same
    //     normalisation. A mile is one colour on this screen.
    //
    // THE CORRECTION, SAME DAY. The paragraph above used to end here saying
    // the table "keeps band adherence, unchanged", two graphics two questions.
    // Read on the device that is one orange with two opposite meanings a
    // thumb's width apart: mile 4 of his 13.49 mi long run, 6:52 and the
    // fastest of the day, drew bright orange on the map and plain ink in the
    // table, because fast was outside the 8:37-9:12 window. His ruling was
    // "make the mile table match the map", and band adherence moved OUT of
    // colour entirely into the recap's words, where a sentence can say what a
    // hue cannot: whether running that fast was the right call today.

    private var routeSection: some View {
        Tile {
            HStack(alignment: .firstTextBaseline) {
                Text("Route")
                    .font(.faffText(TypeScaleV5.label13))
                    .foregroundStyle(V5.textSecondary)
                Spacer(minLength: 0)
                if let ft = detail.elev_gain_ft, ft > 0 {
                    HStack(spacing: V5.S.s4) {
                        FaffValueText(.measured("\(ft)"), font: .faffText(15, weight: .semibold), color: V5.textPrimary)
                        Text("ft up")
                            .font(.faffText(TypeScaleV5.label13))
                            .foregroundStyle(V5.textQuiet)
                    }
                }
            }
            routeBody
        }
    }

    private var routeCoords: [CLLocationCoordinate2D] {
        guard let poly = detail.route_polyline, !poly.isEmpty else { return [] }
        return decodePolyline(poly).map { CLLocationCoordinate2D(latitude: $0.0, longitude: $0.1) }
    }

    @ViewBuilder
    private var routeBody: some View {
        let coords = routeCoords
        if coords.count >= 2 {
            RouteMapView(coords: coords,
                         splits: detail.splits,
                         phases: RouteMapView.phaseSamples(from: detail.phase_breakdown),
                         effort: mappedEffort,
                         // NO ZONE AXIS ON THIS MAP ANY MORE. Passing the
                         // bands turned the line into a five-step HR ramp,
                         // and a line has one channel: it could say roughly
                         // which zone and never the reading, the climb or the
                         // cadence. `MileBreakdownV5` below carries all four
                         // as numbers. Withholding the bands is the whole
                         // change — `usesHrZones` needs two of them, so the
                         // map falls back to what it was always best at,
                         // which is saying where the runner went.
                         hrZones: [])
                .frame(height: 200)
                .clipShape(RoundedRectangle(cornerRadius: V5.R.r16, style: .continuous))
                // Purely visual: MapKit hit-tests its region even when
                // non-interactive, which otherwise hijacks the parent
                // ScrollView's vertical pan (same fix `RoutePolylineCard`
                // already carries).
                .allowsHitTesting(false)
                // `.allowsHitTesting(false)` suppresses TOUCH, not the
                // accessibility tree. `MKMapView` is an accessibility element
                // and publishes its own annotations and overlays as children,
                // so VoiceOver walked into the map and read out MapKit's
                // furniture in the middle of the run. The map is a picture of
                // a route the runner already ran; everything it means is the
                // splits and the elevation profile below it, both of which
                // carry their own data. One named element, then move on.
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Route map")
            // THE LINE'S COLOUR RULE, SAID IN WORDS. The card printed the
            // run's climb and nothing about the gradient, which is the
            // unexplained-visual defect the owner has now flagged three
            // times: without a sentence the fill is a code the screen never
            // breaks. Authored next to the table's, in `RouteMapView`, so the
            // two cannot come to describe different rules. Nil where the run
            // recorded no pace and the line therefore says nothing about one.
            if let caption = RouteMapView.routeCaption(splits: detail.splits,
                                                       phases: routePhaseSamples) {
                Text(caption)
                    .font(.faffText(TypeScaleV5.label13))
                    .foregroundStyle(V5.textQuiet)
                    .fixedSize(horizontal: false, vertical: true)
            }
        } else {
            // RULE THREE, applied to a chart rather than a session: a run
            // with no GPS has no map. Say so instead of drawing an empty
            // frame, exactly what `ElevationProfile.hasSeries` already does.
            Text("No GPS for this run.")
                .font(.faffText(TypeScaleV5.body15))
                .foregroundStyle(V5.textQuiet)
        }
    }

    private var mappedEffort: FaffEffort {
        switch (detail.type ?? "").lowercased() {
        case "recovery":                          return .recovery
        case "long":                               return .long
        case "tempo", "progression", "mp":         return .tempo
        case "intervals", "threshold", "fartlek":  return .intervals
        case "race":                               return .race
        case "rest":                               return .rest
        default:                                   return .easy
        }
    }

    // MARK: - Shoes worn
    //
    // `RunDetail.shoes` is filtered to non-retired pairs (the picker's own
    // rule — see `Models/Runs.swift`), so an assigned RETIRED shoe can be
    // unresolvable here. That is honest: the row simply does not appear
    // rather than naming a shoe this payload cannot confirm.

    private var wornShoe: RunDetailShoe? {
        guard let id = detail.shoe_id else { return nil }
        return detail.shoes?.first(where: { $0.id == id })
    }

    private func shoeMileageSub(_ shoe: RunDetailShoe) -> String? {
        guard let mi = shoe.mileage, mi > 0, let text = FaffFmt.milesUnit(mi) else { return nil }
        return "\(text) on them"
    }
}

// MARK: - Preview

#Preview("Run detail · outdoor, with route") {
    RunDetailV5(detail: RunDetailV5Sample.outdoor, recap: RunDetailV5Sample.recap, onBack: {})
        .preferredColorScheme(.dark)
}

#Preview("Run detail · no GPS") {
    RunDetailV5(detail: RunDetailV5Sample.treadmill, onBack: {})
        .preferredColorScheme(.dark)
}

enum RunDetailV5Sample {
    static let outdoor: RunDetail = decode(outdoorJSON)
    static let treadmill: RunDetail = decode(treadmillJSON)
    static let recap: RunRecap = decodeRecap(recapJSON)
    /// The 2026-08-11 race-week tune-up, as production actually holds it.
    static let intervals: RunDetail = decode(intervalsJSON)
    static let intervalsRecap: RunRecap = decodeRecap(intervalsRecapJSON)

    /// THE ONE CASE PRODUCTION CANNOT YET SUPPLY, and the one the register
    /// exists for.
    ///
    /// The same 2026-08-11 payload with the fourth rep marked as a stop the
    /// watch offered and the runner took. NOT a real row: `rep_skips` is the
    /// 8b wrist-decision contract, it shipped days ago, and no run in
    /// production carries one yet (checked at `faff_readonly`, 2026-08-24 —
    /// zero rows with `repSkips`). Constructed and said so, rather than left
    /// undrawable until someone happens to skip a rep.
    ///
    /// It is worth constructing because it is the rule that is easiest to
    /// break and hardest to notice: `completed: false` is the same byte
    /// whether the coach offered the stop or the runner lost the rep, and a
    /// screen that grades both identically tells a runner who took the offer
    /// that they failed. The drawn row must carry no verdict, no dash where a
    /// pace would be, and a sentence naming whose decision it was.
    static let intervalsWithSkip: RunDetail = decode(intervalsSkipJSON)

    private static func decode(_ json: String) -> RunDetail {
        // swiftlint:disable:next force_try
        try! JSONDecoder().decode(RunDetail.self, from: Data(json.utf8))
    }
    private static func decodeRecap(_ json: String) -> RunRecap {
        // swiftlint:disable:next force_try
        try! JSONDecoder().decode(RunRecap.self, from: Data(json.utf8))
    }

    // A short real-looking polyline (a handful of points along a loop) so the
    // preview exercises the actual `RouteMapView` rather than the no-GPS text.
    private static let samplePolyline =
        "kbnaFxzhkV??`AmA?_A?_@@]@w@?[?_@?e@?a@Ac@?_@?a@?a@?c@?a@?a@?_@?e@?a@Ac@"

    static let outdoorJSON = """
    {
      "id": "run_9f21",
      "date": "2026-09-18",
      "start_local": "2026-09-18T06:41:00",
      "name": "Run",
      "source": "watch",
      "type": "easy",
      "distance_mi": 6.02,
      "pace": "9:02",
      "pace_s_per_mi": 542,
      "time_moving": "54:16",
      "time_elapsed": "54:38",
      "avg_speed_mph": null,
      "hr_avg": 141,
      "hr_max": 158,
      "cadence_avg": 172,
      "elev_gain_ft": 62,
      "temp_f": 61,
      "has_route": true,
      "route_polyline": "\(samplePolyline)",
      "splits": [
        { "mile": 1, "pace": "9:05", "hr": 136, "elev_change_ft": 8 },
        { "mile": 2, "pace": "9:12", "hr": 139, "elev_change_ft": 14 },
        { "mile": 3, "pace": "8:58", "hr": 143, "elev_change_ft": -6 },
        { "mile": 4, "pace": "9:21", "hr": 145, "elev_change_ft": 22 },
        { "mile": 5, "pace": "8:31", "hr": 148, "elev_change_ft": -18 },
        { "mile": 6, "pace": "9:09", "hr": 141, "elev_change_ft": 4 }
      ],
      "hrZonePcts": { "z1": 6, "z2": 58, "z3": 30, "z4": 5, "z5": 1 },
      "zoneTargets": [2],
      "shoe_id": 12,
      "shoes": [
        { "id": 12, "brand": "Saucony", "model": "Endorphin Speed 4", "color": null,
          "color2": null, "run_types": ["easy"], "mileage": 214, "mileage_cap": null,
          "shoe_type": "daily_trainer", "retire_at_mi": 450, "retired": false,
          "preferred": true, "notes": null }
      ]
    }
    """

    static let treadmillJSON = """
    {
      "id": "run_2b7a",
      "date": "2026-09-16",
      "name": "Run",
      "source": "manual",
      "type": "threshold",
      "distance_mi": 10.1,
      "pace": "7:47",
      "time_moving": "1:18:44",
      "hr_avg": 169,
      "hr_max": 178,
      "elev_gain_ft": 0,
      "has_route": false,
      "route_polyline": null,
      "splits": [],
      "hrZonePcts": { "z1": 2, "z2": 14, "z3": 28, "z4": 44, "z5": 12 },
      "zoneTargets": [4, 5],
      "shoes": []
    }
    """

    static let recapJSON = """
    {
      "ok": true,
      "runId": "run_9f21",
      "date": "2026-09-18",
      "type": "easy",
      "phase": "BUILD",
      "verdict": "Sat in the band all the way bar mile five, which crept thirty seconds quick. Pull that one back and this is a clean easy day.",
      "facts": ["6.02 mi at 9:02/mi, HR averaged 141."],
      "coach_tip": "Mile five ran hot. Worth a check on effort next time it happens twice in a row.",
      "conditions_note": null,
      "win": null,
      "intervals_adjusted_target_s_per_mi": null,
      "prescribed_pace_s_per_mi": null,
      "plan_now_pace_s_per_mi": 555,
      "evaluated_pace_s_per_mi": 555
    }
    """

    // ─────────────────────────────────────────────────────────────────────
    // THE RUN THAT STARTED THIS. Not invented: every number below is read
    // out of production at `faff_readonly` on 2026-08-24.
    //
    //   plan_workouts    · race_week_tuneup, 5.5 mi, "1.5 mi WU · 4×1km @
    //                      race pace · 90s jog · 1 mi CD", rep pace 412 s/mi
    //   coach_intents    · reason 'watch_completion', field
    //                      "…-2026-08-11#1842", NINE phases, each with its
    //                      own target, actual, HR, verdict and tolerance
    //                      counters
    //   runs.data.splits · seven mile splits with heart rate on each
    //
    // The two together are the argument for the whole section. The splits say
    // mile three ran 6:37 and mile four ran 8:16, which is a chart of a run
    // that surged and faded. The phases say four kilometre reps at 6:21, 6:27,
    // 6:42 and 6:56 with 90-second jogs between them, which is a runner
    // executing a tune-up and going out slightly hot. Mile four is a rep and a
    // jog averaged together and means neither.
    static let intervalsJSON = """
    {
      "id": "run_aug11",
      "date": "2026-08-11",
      "start_local": "2026-08-11T18:42:04",
      "name": "Run",
      "source": "watch",
      "type": "race_week_tuneup",
      "type_display": "Tune-up",
      "distance_mi": 6.34,
      "pace": "7:18",
      "pace_s_per_mi": 438,
      "time_moving": "46:16",
      "time_elapsed": "46:16",
      "hr_avg": 165,
      "hr_max": 175,
      "cadence_avg": 169,
      "elev_gain_ft": 2330,
      "has_route": false,
      "route_polyline": null,
      "splits": [
        { "mile": 1, "pace": "7:44", "hr": 124, "cadence": 140, "elev_change_ft": 505 },
        { "mile": 2, "pace": "6:40", "hr": 146, "cadence": 144, "elev_change_ft": 11 },
        { "mile": 3, "pace": "6:37", "hr": 168, "cadence": 166, "elev_change_ft": -22 },
        { "mile": 4, "pace": "8:16", "hr": 158, "cadence": 131, "elev_change_ft": 5 },
        { "mile": 5, "pace": "6:47", "hr": 159, "cadence": 137, "elev_change_ft": 7 },
        { "mile": 6, "pace": "7:50", "hr": 155, "cadence": 130, "elev_change_ft": -2 },
        { "mile": 7, "pace": "7:19", "hr": 155, "cadence": 152, "elev_change_ft": 0 }
      ],
      "hrZonePcts": { "z1": 1, "z2": 12, "z3": 22, "z4": 48, "z5": 17 },
      "zoneTargets": [4],
      "planned_sub_label": "1.5 mi WU · 4×1km @ race pace · 90s jog · 1 mi CD",
      "planned_distance_mi": 5.5,
      "phase_breakdown": [
        { "index": 0, "label": "Warm-up", "type": "warmup",
          "target_pace": "8:57", "target_pace_sec": 537, "tolerance_pace_sec": null,
          "actual_pace": "7:55", "actual_distance_mi": 1.5, "actual_duration_sec": 714,
          "avg_hr": 135, "max_hr": 155, "avg_cadence": 159, "completed": true,
          "status": null, "verdict": "missed",
          "time_in_tolerance_sec": 25, "time_out_of_tolerance_sec": 675 },
        { "index": 1, "label": "Interval \u{00B7} 1 km", "type": "work",
          "target_pace": "6:52", "target_pace_sec": 412, "tolerance_pace_sec": 8,
          "actual_pace": "6:21", "actual_distance_mi": 0.62, "actual_duration_sec": 237,
          "avg_hr": 164, "max_hr": 169, "avg_cadence": 174, "completed": true,
          "status": "fast", "verdict": "missed",
          "time_in_tolerance_sec": 15, "time_out_of_tolerance_sec": 225 },
        { "index": 2, "label": "Jog 1:30", "type": "recovery",
          "target_pace": "8:57", "target_pace_sec": 537, "tolerance_pace_sec": null,
          "actual_pace": "8:14", "actual_distance_mi": 0.18, "actual_duration_sec": 90,
          "avg_hr": 164, "max_hr": 170, "avg_cadence": 160, "completed": true,
          "status": null, "verdict": "hit",
          "time_in_tolerance_sec": 70, "time_out_of_tolerance_sec": 20 },
        { "index": 3, "label": "Interval \u{00B7} 1 km", "type": "work",
          "target_pace": "6:52", "target_pace_sec": 412, "tolerance_pace_sec": 8,
          "actual_pace": "6:27", "actual_distance_mi": 0.62, "actual_duration_sec": 242,
          "avg_hr": 169, "max_hr": 173, "avg_cadence": 171, "completed": true,
          "status": "fast", "verdict": "missed",
          "time_in_tolerance_sec": 15, "time_out_of_tolerance_sec": 225 },
        { "index": 4, "label": "Jog 1:30", "type": "recovery",
          "target_pace": "8:57", "target_pace_sec": 537, "tolerance_pace_sec": null,
          "actual_pace": "14:17", "actual_distance_mi": 0.1, "actual_duration_sec": 90,
          "avg_hr": 127, "max_hr": 173, "avg_cadence": 116, "completed": true,
          "status": null, "verdict": "missed",
          "time_in_tolerance_sec": 5, "time_out_of_tolerance_sec": 85 },
        { "index": 5, "label": "Interval \u{00B7} 1 km", "type": "work",
          "target_pace": "6:52", "target_pace_sec": 412, "tolerance_pace_sec": 8,
          "actual_pace": "6:42", "actual_distance_mi": 0.62, "actual_duration_sec": 250,
          "avg_hr": 168, "max_hr": 175, "avg_cadence": 168, "completed": true,
          "status": "on", "verdict": "drifted",
          "time_in_tolerance_sec": 155, "time_out_of_tolerance_sec": 95 },
        { "index": 6, "label": "Jog 1:30", "type": "recovery",
          "target_pace": "8:57", "target_pace_sec": 537, "tolerance_pace_sec": null,
          "actual_pace": "16:46", "actual_distance_mi": 0.09, "actual_duration_sec": 90,
          "avg_hr": 155, "max_hr": 175, "avg_cadence": 115, "completed": true,
          "status": null, "verdict": "missed",
          "time_in_tolerance_sec": 0, "time_out_of_tolerance_sec": 90 },
        { "index": 7, "label": "Interval \u{00B7} 1 km", "type": "work",
          "target_pace": "6:52", "target_pace_sec": 412, "tolerance_pace_sec": 8,
          "actual_pace": "6:56", "actual_distance_mi": 0.62, "actual_duration_sec": 259,
          "avg_hr": 160, "max_hr": 174, "avg_cadence": 162, "completed": true,
          "status": "on", "verdict": "drifted",
          "time_in_tolerance_sec": 170, "time_out_of_tolerance_sec": 90 },
        { "index": 8, "label": "Cool-down", "type": "cooldown",
          "target_pace": "8:57", "target_pace_sec": 537, "tolerance_pace_sec": null,
          "actual_pace": "8:25", "actual_distance_mi": 1.0, "actual_duration_sec": 507,
          "avg_hr": 161, "max_hr": 174, "avg_cadence": 154, "completed": true,
          "status": null, "verdict": "missed",
          "time_in_tolerance_sec": 15, "time_out_of_tolerance_sec": 490 }
      ],
      "shoes": []
    }
    """

    /// The real payload with the fourth rep turned into a taken offer:
    /// `completed: false`, no actual pace, no verdict, and a `rep_skips`
    /// entry naming it as the runner's own call. The recovery jog after it
    /// goes too — there is nothing to recover from.
    private static let intervalsSkipJSON: String = {
        // SINGLE LINES, EACH UNIQUE IN THE SOURCE. A multi-line search string
        // inside a Swift literal depends on the closing delimiter's own
        // indentation matching the target's, which is exactly the kind of
        // thing that fails silently and leaves a "constructed" fixture
        // identical to the one it was constructed from.
        //
        // 6:56, 160/174/162 and 170/90 each occur once in the payload, on
        // phase seven and nowhere else. `edits` is walked with a check that
        // every one landed.
        let edits: [(String, String)] = [
            ("\"actual_pace\": \"6:56\", \"actual_distance_mi\": 0.62, \"actual_duration_sec\": 259,",
             "\"actual_pace\": null, \"actual_distance_mi\": null, \"actual_duration_sec\": null,"),
            ("\"avg_hr\": 160, \"max_hr\": 174, \"avg_cadence\": 162, \"completed\": true,",
             "\"avg_hr\": null, \"max_hr\": null, \"avg_cadence\": null, \"completed\": false,"),
            ("\"time_in_tolerance_sec\": 170, \"time_out_of_tolerance_sec\": 90 }",
             "\"time_in_tolerance_sec\": null, \"time_out_of_tolerance_sec\": null }"),
            // `verdict: "drifted"` is deliberately LEFT ON the phase. The
            // watch graded the rep before the runner took the stop, and the
            // row must still print no verdict — proving the guard is in the
            // composer and not an accident of the fixture.
            ("\"shoes\": []",
             "\"rep_skips\": [ { \"repIndex\": 4, \"repCount\": 4, \"repsCompleted\": 3, "
             + "\"phaseLabel\": \"Interval \u{00B7} 1 km\" } ], \"shoes\": []"),
        ]
        var s = intervalsJSON
        for (from, to) in edits {
            assert(s.contains(from), "intervalsSkipJSON: no match for \(from)")
            s = s.replacingOccurrences(of: from, with: to)
        }
        return s
    }()

    static let intervalsRecapJSON = """
    {
      "ok": true,
      "runId": "run_aug11",
      "date": "2026-08-11",
      "type": "race_week_tuneup",
      "type_display": "Tune-up",
      "phase": "RACE-SPECIFIC",
      "verdict": "Four reps on the rail, and the first two went out quick. Race pace is 6:52 and you opened at 6:21.",
      "facts": [
        "4 reps at 6:21, 6:27, 6:42, 6:56. HR climbed to 175.",
        "The set faded 35 seconds a mile from first rep to last."
      ],
      "coach_tip": "Open the next set at the number, not under it. The back half is where the tune-up is won.",
      "conditions_note": null,
      "win": "4 on the rail \u{00B7} clean set.",
      "intervals_adjusted_target_s_per_mi": 412,
      "prescribed_pace_s_per_mi": 412,
      "plan_now_pace_s_per_mi": 412,
      "evaluated_pace_s_per_mi": 412
    }
    """
}
