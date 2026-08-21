//
//  FacesFinishV5.swift
//  FaffWatch
//
//  Six 0821 boards: the three that end a run, and the three that come before
//  there is a session to run at all.
//
//  SOURCE OF TRUTH — see WatchThemeV5.swift's header.
//    Finish · Race complete · Summary
//      /Volumes/WP/06 Claude Code/Faff/design/0821/design_handoff_faff_watch_app/
//        README.md § "Screens § 8 · Finish"
//        Faff-Watch-App.dc.html  data-screen-label="Complete" / "Race complete" / "Summary"
//    First launch · Stale plan · Recovered run
//      /Volumes/WP/06 Claude Code/Faff/design/0821/design_handoff_0821_addendum/
//        README.md § "3 · Watch · before there is a session"
//        Watch-Before-A-Session.html
//
//  Every measurement below is the 2× set's px ÷ 2. Every colour is a WatchV5
//  token and every face is WatchV5.number / .display / .coach — this file
//  contains no hex literal, by design and by CI gate.
//
//  These are presentation only. They take plain values and closures, hold no
//  state, and know nothing about WorkoutEngine, WatchWorkout, PhoneSync or the
//  legacy Faff.* palette. Wiring them to the engine is a separate change.
//
// ─────────────────────────────────────────────────────────────────────────────
//  NEEDS — six things the shared kit cannot currently express. Per the build
//  constraint NONE of these were made: WatchKitV5.swift and WatchThemeV5.swift
//  are untouched and each is worked around locally, below. Anyone landing these
//  upstream should delete the corresponding workaround here.
//
//  NEEDS 1 · `WTargetWeight` has no case for a target sitting ON a full-bleed
//    ramp. Complete and Race complete both draw Save as BLACK fill with a WHITE
//    label — "Save is black on the colour because the colour is the point"
//    (dc.html, Complete). `.filled` is white-on-black and `.quiet` is surface3,
//    which on a gradient reads as a grey smudge rather than a hole punched in
//    the colour. Worked around: `WFinishSaveTarget`, private to this file, same
//    50pt / full width / Capsule geometry as WTarget.
//
//  NEEDS 2 · `WWordmark` takes no colour or opacity. The first-launch board
//    draws the lettering at 62% white with the dot at full `signal`. Worked
//    around with `.opacity(0.62)` on the whole mark, which also dims the dot —
//    the one visible deviation from the addendum on that board. A `dim: Bool`
//    or a `lettering: Color` parameter on WWordmark closes it properly.
//
//  NEEDS 3 · `WMetric` has no muted grade (48% white) and its rank ladder is
//    fixed at hero 48 / secondary 28 / tertiary 22 pt with a 16pt unit. None of
//    these boards is a running face, and none of their figures is on that
//    ladder: 38 / 31 / 22 / 16 / 15 / 14 pt. `WMetricGrade` also has no `.mute`
//    for the stale prescription, which WatchThemeV5 explicitly says is what
//    `valueMute` is for. Worked around by drawing the figures with
//    `WatchV5.number(_:)` + `value` / `valueDim` / `valueMute` directly. Rule 4
//    is not at risk: it governs running faces, and none of these is one.
//
//  NEEDS 4 · There is no prose opacity step between `value` (1.0) and
//    `valueDim` (0.72). The coach lines on these six boards are drawn at .82,
//    .86 and .92 — brighter than valueDim because they are the only sentence on
//    a board the runner is standing still to read. Worked around with
//    `WatchV5.value.opacity(_:)`, which is a token derivation and not a literal.
//    A `valueProse` step in WatchThemeV5 would make the intent legible.
//
//  NEEDS 5 · `WDestructive` is fixed at `Metric.targetHeight` (50pt). The
//    addendum draws "Throw it away" at 26pt tall. Used AS IS and deliberately
//    not worked around — rule 7 is about the absence of a pill, not the height,
//    and a hand-rolled destructive verb is exactly the thing that component
//    exists to prevent.
//
//  NEEDS 6 · `WRow` gives every row its own 10pt radius. The Summary design
//    draws a group as ONE 10pt-radius plate with square inner rows separated by
//    a 1pt gap in the ground. Used AS IS: the rule the component encodes ("rows
//    step in FILL, never in borders") is the load-bearing part and it holds. A
//    `WRowGroup` that clips a VStack of square rows would land the plate.
// ─────────────────────────────────────────────────────────────────────────────
//
//  ONE DESIGN DISCREPANCY, resolved toward the READMEs:
//    Faff-Watch-App.dc.html draws the Race complete watch time at #F7DFAF, a
//    pale gold that is in neither palette. Both READMEs say amber — "carries
//    the provisional chip time in amber" (watch README § 8) and "#F2B03C
//    (amber = provisional)" (addendum § 2, for the phone board that receives
//    this one). Amber is also what the rest of the product means by
//    provisional. This board uses `WatchV5.attention`.
//

import SwiftUI

// MARK: - Local workaround · the Save target on a ramp
//
// NEEDS 1. Black fill, white label, on the colour. Same geometry as WTarget so
// that when a `.onColour` weight lands upstream this can be deleted and the
// call sites swapped with no layout change.

private struct WFinishSaveTarget: View {
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(WatchV5.coach(19, weight: 800))   // 38px ÷ 2; README target label 17-19
                .foregroundStyle(WatchV5.value)
                .frame(maxWidth: .infinity)
                .frame(height: WatchV5.Metric.targetHeight)
                .background(WatchV5.ground, in: Capsule())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - 8 · Finish · Complete
//
// "Wrist up, standing still, nothing to operate: the one moment the watch has
// time to be loud." Full-bleed session ramp with its grain, the three
// quantities that describe the run, one line of judgement, and Save.
//
// This is the loudest board in the app and that is the whole point of it — the
// runner is not operating anything, so density is free and legibility is not.

/// Complete. Loud, full-bleed, one target.
///
/// - Parameters:
///   - session: the session class, which picks the ramp — the same string the
///     wire already carries (`SessionClass` in lib/watch/build-workout.ts).
///     A run keeps its own ramp at the finish; the finish is not a new colour.
///   - coachLine: obeys the copy rules — no exclamation marks, no emoji, no em
///     dashes (the separator is `·`), second person, 8-40 words.
struct FinishCompleteBoard: View {
    var session: String = "easy"
    /// Display lede. "Done" in the design; never a sentence.
    var lede: String = "Done"
    let distance: String            // "6.02"
    var distanceUnit: String = "mi"
    let duration: String            // "48:12"
    let pace: String                // "8:01 /mi"
    let coachLine: String
    var saveLabel: String = "Save"
    let onSave: () -> Void

    var body: some View {
        WGradientBoard(session: session) {
            VStack(alignment: .leading, spacing: 0) {
                Spacer(minLength: 0)

                VStack(alignment: .leading, spacing: 5) {   // 10px
                    WDisplayWord(text: lede, size: 30)      // 60px

                    HStack(alignment: .firstTextBaseline, spacing: 5) {
                        Text(distance)
                            .font(WatchV5.number(36))       // 72px
                            .foregroundStyle(WatchV5.value)
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)
                        Text(distanceUnit)
                            .font(WatchV5.number(15))       // 30px
                            .foregroundStyle(WatchV5.value.opacity(0.62))
                    }

                    // Duration and pace read as one quantity here, not two
                    // metrics — this is not a running face and the middot is
                    // the sanctioned separator.
                    Text("\(duration) \(WatchV5.separator) \(pace)")
                        .font(WatchV5.number(17))           // 34px
                        .foregroundStyle(WatchV5.value.opacity(0.82))
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)

                    WCoachLine(text: coachLine,
                               size: 14,                    // 28px
                               color: WatchV5.value.opacity(0.92))
                        .padding(.top, 3)                   // 6px
                }

                Spacer(minLength: 0)

                WTargetStack {
                    WFinishSaveTarget(label: saveLabel, action: onSave)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
    }
}

// MARK: - 8 · Finish · Complete · race day
//
// The clock is NOT the result, so it must not pose as one. Amber until the chip
// time lands. Under the goal, and nothing else — the coach's sentence can wait
// for the phone, and this board hands off to the phone's `8c`.
//
// Note what is deliberately absent: no coach line, no splits, no "PR", no
// celebration. A result the product cannot yet stand behind gets a figure, a
// comparison, the word Provisional, and a way to save it.

/// Complete · race day. The provisional finish, in amber, with no verdict.
struct FinishRaceCompleteBoard: View {
    /// The race distance as its own name — "Marathon", "Half", "10K".
    let raceName: String
    /// The watch's own elapsed time. Amber, because it is provisional: the chip
    /// will move it by seconds, not minutes, and it never becomes the result.
    let watchTime: String           // "3:28:44"
    /// Stated against the goal and nothing else. "Under 3:29:59".
    let goalComparison: String
    var provisionalLabel: String = "Provisional"
    var saveLabel: String = "Save"
    let onSave: () -> Void

    var body: some View {
        WGradientBoard(session: "race") {
            VStack(alignment: .leading, spacing: 0) {
                Spacer(minLength: 0)

                VStack(alignment: .leading, spacing: 4) {   // 8px
                    WDisplayWord(text: raceName, size: 26)  // 52px

                    // Amber, per both READMEs. The dc.html's #F7DFAF is off
                    // both palettes — see the header note.
                    Text(watchTime)
                        .font(WatchV5.number(38))           // 76px
                        .foregroundStyle(WatchV5.attention)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)

                    Text(goalComparison)
                        .font(WatchV5.number(16))           // 32px
                        .foregroundStyle(WatchV5.value.opacity(0.86))
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)

                    Text(provisionalLabel)
                        .font(WatchV5.number(13))           // 26px
                        .foregroundStyle(WatchV5.valueDim)
                }

                Spacer(minLength: 0)

                WTargetStack {
                    WFinishSaveTarget(label: saveLabel, action: onSave)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
    }
}

// MARK: - 8 · Finish · Summary

/// One row of the summary: a name and a quantity. Nothing grades here — the run
/// is over, and a green number on a finished run is a verdict the phone gives.
struct FinishSummaryRow: Identifiable, Hashable {
    let label: String
    let value: String
    var id: String { label + "\u{001F}" + value }

    init(_ label: String, _ value: String) {
        self.label = label
        self.value = value
    }
}

/// A grouped plate of rows. Rows step in FILL, never in borders (there are no
/// borders anywhere in this design), and the fill step is what says which group
/// a row belongs to.
private struct WSummaryGroup: View {
    let rows: [FinishSummaryRow]
    let fill: Color
    let valueSize: CGFloat

    var body: some View {
        // 2px in the 2× set. NEEDS 6: the design clips the whole group to one
        // 10pt plate; WRow rounds each row individually.
        VStack(spacing: 1) {
            ForEach(rows) { row in
                WRow(fill: fill) {
                    Text(row.label)
                        .font(WatchV5.number(12))           // 24px
                        .foregroundStyle(WatchV5.valueDim)
                        .lineLimit(1)
                } trailing: {
                    Text(row.value)
                        .font(WatchV5.number(valueSize))
                        .foregroundStyle(WatchV5.value)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
            }
        }
    }
}

/// Summary. **The only scrolling board in the app, so the only one allowed more
/// than four numbers** — rule 4 caps a running face, and this is not one.
///
/// THE FIRST SCREENFUL MUST END ON A WHOLE ROW. A sliced row reads as a bug,
/// not an invitation to scroll. The design's first screenful is exactly:
///
///     6.02 mi              48:12
///     Pace          8:01 /mi
///     Heart          148 avg
///     Cadence        159 spm
///     ─────────────────────────
///     Mile 1            8:12
///
/// with climb and miles two onward below the fold. The row heights, the 1pt
/// row gaps and the 5pt group gaps here are the design's, so that fold lands
/// where it was drawn. **Do not insert a group above `splits`** and do not grow
/// `averages` past three rows — either one pushes Mile 1 under the fold and
/// breaks the rule silently, because nothing in SwiftUI can measure it back.
///
/// - Parameters:
///   - averages: the whole-run quantities. Three, in the design: Pace, Heart,
///     Cadence.
///   - splits: per-mile, in order. Mile 1 is the last row above the fold.
///   - totals: what the design puts below the splits. Climb lives here — the
///     handoff draws only the first screenful, so climb's exact placement below
///     the fold is an inference, and it is kept out of `averages` because that
///     is the one thing the drawn board rules out.
struct FinishSummaryBoard: View {
    let distance: String            // "6.02"
    var distanceUnit: String = "mi"
    let duration: String            // "48:12"
    let averages: [FinishSummaryRow]
    let splits: [FinishSummaryRow]
    var totals: [FinishSummaryRow] = []

    var body: some View {
        WBoard(scrolls: true) {
            ScrollView {
                VStack(alignment: .leading, spacing: 5) {   // 10px
                    header
                    if !averages.isEmpty {
                        WSummaryGroup(rows: averages,
                                      fill: WatchV5.surface2,
                                      valueSize: 15)        // 30px
                    }
                    if !splits.isEmpty {
                        WSummaryGroup(rows: splits,
                                      fill: WatchV5.surface1,
                                      valueSize: 14)        // 28px
                    }
                    if !totals.isEmpty {
                        WSummaryGroup(rows: totals,
                                      fill: WatchV5.surface1,
                                      valueSize: 14)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.bottom, WatchV5.Metric.bottomPadding)
            }
        }
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
            Text(distance)
                .font(WatchV5.number(31))                   // 62px
                .foregroundStyle(WatchV5.value)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(distanceUnit)
                .font(WatchV5.number(14))                   // 28px
                .foregroundStyle(WatchV5.valueMute)
            Spacer(minLength: 6)
            Text(duration)
                .font(WatchV5.number(17))                   // 34px
                .foregroundStyle(WatchV5.valueDim)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .padding(.leading, 1)                               // 2px
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Before there is a session
//
// Three states, all inside the first thirty seconds, all shipping raw until
// now. The shared rule across the three:
//
//   THE WATCH NEVER PRETENDS TO BE THE PLANNER, and an unusable prescription
//   degrades to a PLAIN RUN rather than a blocked one.
//
// "Plain run" is the exact wording and it is load-bearing. Not "free run", not
// "no plan", not "quick start" — an unprescribed run is a real thing this
// product records, not a fallback, and the label is what says so. It is spelled
// out at each call site rather than hoisted to a constant, because a file-local
// constant cannot be a default argument on an internal initialiser and a shared
// one would be a token this file has no authority to declare.

// MARK: First launch · nothing sent yet
//
// This is THE WHOLE OF ONBOARDING on the wrist. No steps, no sign-in, no
// pairing screen: the plan is made on the phone and this app is a receiver, so
// the board says that and stops.

/// First launch. One statement, one sentence, one thing the watch can do.
struct PreSessionFirstLaunchBoard: View {
    var lede: String = "No plan yet"
    var coachLine: String = "Open faff on your phone once \(WatchV5.separator) today's session arrives here on its own."
    var plainRunLabel: String = "Plain run"
    let onPlainRun: () -> Void

    var body: some View {
        WBoard {
            VStack(alignment: .leading, spacing: 0) {
                // NEEDS 2: the addendum draws the lettering at 62% with the dot
                // at full orange; WWordmark has no colour parameter, so the
                // whole mark is dimmed and the dot goes with it.
                WWordmark(size: 12)                         // 24px
                    .opacity(0.62)
                    .padding(.leading, 3)                   // 6px

                Spacer(minLength: 0)

                VStack(alignment: .leading, spacing: 6) {   // 12px
                    WDisplayWord(text: lede, size: 22)      // 44px
                    WCoachLine(text: coachLine,
                               size: 13,                    // 26px
                               color: WatchV5.value.opacity(0.86))
                }
                .padding(.leading, 3)

                Spacer(minLength: 0)

                WTargetStack {
                    WTarget(label: plainRunLabel, weight: .quiet, action: onPlainRun)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
    }
}

// MARK: The plan is too old to trust
//
// A session on the wrist, nine days old, no phone contact since.
//
// AMBER, NOT RED. Stale evidence is what amber means everywhere in this
// product; red names a sensor that failed to read (rule 2), and nothing here
// failed to read. The prescription is STILL DRAWN, at 48%, because hiding it
// would be pretending we do not have it — and the second target is the same
// escape as the first-launch board: an expired prescription becomes a plain
// run rather than a blocked one.

/// The plan is too old to trust. The prescription stays on screen, dimmed.
struct PreSessionStalePlanBoard: View {
    /// "9 days old". Uppercased by the kicker. Amber.
    let ageKicker: String
    /// The session type, in the display register, at 48%.
    let sessionType: String         // "Easy"
    /// Its dose, beside the type, at 48%.
    let sessionDose: String         // "6 mi"
    var coachLine: String = "The plan has moved on since \(WatchV5.separator) targets may be wrong."
    var runAnywayLabel: String = "Run it anyway"
    var plainRunLabel: String = "Plain run"
    let onRunAnyway: () -> Void
    let onPlainRun: () -> Void

    var body: some View {
        WBoard {
            VStack(alignment: .leading, spacing: 0) {
                Spacer(minLength: 0)

                VStack(alignment: .leading, spacing: 3) {   // 6px
                    WKicker(text: ageKicker,
                            color: WatchV5.attention,
                            size: 12)                       // 24px

                    // NEEDS 3: the stale prescription is exactly what
                    // WatchThemeV5 says `valueMute` is for, but WMetric has no
                    // muted grade, so the dose is drawn directly.
                    HStack(alignment: .firstTextBaseline, spacing: 6) {  // 12px
                        WDisplayWord(text: sessionType,
                                     size: 22,              // 44px
                                     color: WatchV5.valueMute)
                            .layoutPriority(1)
                        Text(sessionDose)
                            .font(WatchV5.number(16))       // 32px
                            .foregroundStyle(WatchV5.valueMute)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                    }

                    // 24px in the 2× set → 12pt. One point under the watch
                    // README's 13-17 coach band. The addendum is the later
                    // document, it draws this sentence at 24px, and the 2× set
                    // is the spec — so 12 it is, noted rather than rounded up.
                    WCoachLine(text: coachLine,
                               size: 12,
                               color: WatchV5.value.opacity(0.86))
                        .padding(.top, 3)                   // 6px
                }

                Spacer(minLength: 0)

                WTargetStack {
                    WTarget(label: runAnywayLabel, weight: .filled, action: onRunAnyway)
                    WTarget(label: plainRunLabel, weight: .quiet, action: onPlainRun)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
    }
}

// MARK: A run survived the crash
//
// Battery died or the app fell over, and a partial run is on disk.
//
// It LEADS WITH THE EVIDENCE that the run is really there — when it started,
// how far, how long — because nobody trusts an offer to resume something the
// watch cannot describe. Carry on leads on fill; Save it as is keeps it where
// it stands; throwing it away is TEXT WITH NO PILL, the same rule as Discard on
// the end confirmation (rule 7), because a filled pill beside a filled pill is
// how a run gets thrown away by accident.

/// A recovered partial run, described before it is offered.
struct PreSessionRecoveredRunBoard: View {
    /// Clock time the run began — "7:11". Drawn as evidence, not as a metric.
    let startedAt: String
    let distance: String            // "4.88"
    var distanceUnit: String = "mi"
    let duration: String            // "41:02"
    var carryOnLabel: String = "Carry on"
    var saveLabel: String = "Save it as is"
    var discardLabel: String = "Throw it away"
    let onCarryOn: () -> Void
    let onSaveAsIs: () -> Void
    let onDiscard: () -> Void

    var body: some View {
        WBoard {
            VStack(alignment: .leading, spacing: 0) {
                Spacer(minLength: 0)

                VStack(alignment: .leading, spacing: 2) {   // 4px
                    WKicker(text: "Unfinished \(WatchV5.separator) from \(startedAt)",
                            color: WatchV5.valueMute,
                            size: 11)                       // 22px

                    HStack(alignment: .firstTextBaseline, spacing: 5) {  // 10px
                        Text(distance)
                            .font(WatchV5.number(38))       // 76px
                            .foregroundStyle(WatchV5.value)
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)
                        Text(distanceUnit)
                            .font(WatchV5.number(15))       // 30px
                            .foregroundStyle(WatchV5.valueMute)
                    }

                    Text(duration)
                        .font(WatchV5.number(22))           // 44px
                        .foregroundStyle(WatchV5.valueDim)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }

                Spacer(minLength: 0)

                WTargetStack {
                    WTarget(label: carryOnLabel, weight: .filled, action: onCarryOn)
                    WTarget(label: saveLabel, weight: .quiet, action: onSaveAsIs)
                    // NEEDS 5: 50pt in the component, 26pt in the design. The
                    // absence of the pill is the rule; the height is not.
                    WDestructive(label: discardLabel, action: onDiscard)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Previews
//
// Fixture values are the design's own, board for board.

#Preview("Complete") {
    FinishCompleteBoard(
        session: "easy",
        distance: "6.02",
        duration: "48:12",
        pace: "8:01 /mi",
        coachLine: "Held the band the whole way \(WatchV5.separator) that is the session."
    ) { }
}

#Preview("Race complete") {
    FinishRaceCompleteBoard(
        raceName: "Marathon",
        watchTime: "3:28:44",
        goalComparison: "Under 3:29:59"
    ) { }
}

#Preview("Summary") {
    FinishSummaryBoard(
        distance: "6.02",
        duration: "48:12",
        averages: [
            FinishSummaryRow("Pace", "8:01 /mi"),
            FinishSummaryRow("Heart", "148 avg"),
            FinishSummaryRow("Cadence", "159 spm"),
        ],
        splits: [
            FinishSummaryRow("Mile 1", "8:12"),
            FinishSummaryRow("Mile 2", "8:04"),
            FinishSummaryRow("Mile 3", "7:58"),
            FinishSummaryRow("Mile 4", "7:56"),
            FinishSummaryRow("Mile 5", "8:00"),
            FinishSummaryRow("Mile 6", "7:54"),
        ],
        totals: [
            FinishSummaryRow("Climb", "312 ft"),
        ]
    )
}

#Preview("First launch") {
    PreSessionFirstLaunchBoard { }
}

#Preview("Stale plan") {
    PreSessionStalePlanBoard(
        ageKicker: "9 days old",
        sessionType: "Easy",
        sessionDose: "6 mi",
        onRunAnyway: { },
        onPlainRun: { }
    )
}

#Preview("Recovered run") {
    PreSessionRecoveredRunBoard(
        startedAt: "7:11",
        distance: "4.88",
        duration: "41:02",
        onCarryOn: { },
        onSaveAsIs: { },
        onDiscard: { }
    )
}
