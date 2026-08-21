//
//  FacesControlV5.swift
//  FaffWatch
//
//  Controls, faults, and the two places the coach asks a question.
//
//  SOURCE OF TRUTH — see WatchThemeV5.swift's header:
//    /Volumes/WP/06 Claude Code/Faff/design/0821/design_handoff_faff_watch_app/
//      README.md  §5 Controls, §6 Faults, §7 The coach asks
//      Faff-Watch-App.dc.html  boards `Controls`, `Controls structured`,
//        `End confirm`, `Skip confirm`, `Extend recovery`, `GPS acquiring`,
//        `Heart dropout`, `Low battery`, `Water lock`, `Bail offered`,
//        `Ceiling breach`, `Ceiling override`, `Spoken cue`
//
//  Every size in this file is the 2x board's px divided by two. Every colour
//  is a WatchV5 token; every font is WatchV5.number / .display / .coach.
//
//  These thirteen boards carry more of the handoff's thirteen rules than any
//  other file in the app, so the rules are named at the call sites that keep
//  them:
//
//    Rule 2  Red names a SENSOR, never a value. `Heart dropout` renders the
//            words and no figure — a stale or greyed last-known number was
//            drawn and explicitly rejected. `WSensorFault` has no figure
//            parameter, which is how the rule survives a future edit.
//    Rule 6  Every target is 50pt, full width, pill. No exceptions, including
//            on faults and confirmations. That is `WTarget`, always.
//    Rule 7  Destructive verbs get no filled target. "Discard it" is
//            `WDestructive` — text at 42%, no pill.
//    Rule 8  NO SENSOR BLOCKS THE RUN. `GPS acquiring` is amber, not red,
//            and Start stays white and pressable. `Low battery` never takes
//            the run away either.
//    Rule 11 Anything the runner can answer is answered where it is asked —
//            `Ceiling override` takes an answer instead of stating a limit,
//            and `Extend recovery` lives on the recovery face rather than in
//            controls because it is only true for ninety seconds.
//    Rule 13 No spinners. `GPS acquiring` in particular has no motion of any
//            kind: motion is the failure this system was built against.
//
//  Views here take plain values and closures. They hold no engine and no
//  workout or session object — the caller owns state and hands down
//  strings, so a board can be previewed, and so a live countdown stays live
//  (see `FaceExtendRecoveryV5`).
//
//
//  NEEDS — shared-component changes these boards would want. NONE were made;
//  every one is worked around locally, and the workaround is marked at its
//  call site so it can be deleted when the component catches up.
//
//  NEEDS: `WSensorFault` is fixed at coach(17). The `Heart dropout` board
//         draws "No heart signal" at 19pt so the broken slot sits at the same
//         optical weight as the three untouched values around it. Used at 17
//         here; the slot reads a little light against a 46pt pace.
//
//  NEEDS: `WKicker` renders in the coach register. Every mid-run kicker in
//         the 0821 file is drawn in the TELEMETRY register instead, because
//         they carry figures — "Rep 4 of 6 · 1:12 left", "Ceiling is 165",
//         "Skip rep 4" — and the coach face has no tabular figures, so a
//         countdown inside a kicker would shuffle horizontally as it ticks.
//         Worked around with the private `WFigureKicker` below. If `WKicker`
//         gains a register parameter, delete it.
//
//  NEEDS: `WTarget` is fixed at coach(17). The design steps the LEAD verb one
//         notch up (19pt on Lap / Skip rep / Start) and leaves the rest at 18.
//         The handoff's own type table says "Target label 17-19", so 17 is
//         inside the band; the lead verb just does not lead on size here.
//
//  NEEDS: there is no token between `valueDim` (.72) and `value` (1.0). The
//         design uses .62 for a stated fact and .86 for a coach sentence on a
//         condition board. Both are mapped to `valueDim`, which is the closer
//         honest token in each case, rather than inventing an opacity.
//

import SwiftUI

// MARK: - Local vocabulary

/// A kicker drawn in the telemetry register rather than the coach register,
/// because it carries a figure. See the NEEDS note at the top of the file.
///
/// 11-13pt, uppercase, .08em tracking — the handoff's kicker spec, in the one
/// face that has tabular figures.
private struct WFigureKicker: View {
    let text: String
    var color: Color = WatchV5.valueMute
    var size: CGFloat = 12

    var body: some View {
        Text(text.uppercased())
            .font(WatchV5.number(size))
            .tracking(size * 0.08)
            .foregroundStyle(color)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
    }
}

/// A figure and its unit, off the running face.
///
/// `WMetric` is the running-face component and its ranks are the running-face
/// sizes. These boards are moments and conditions, and rule 9 says a moment
/// reduces density at a size no other board uses — so the size is passed
/// rather than ranked. The unit follows `WMetric`'s own grammar exactly: a
/// coloured figure's unit is that colour at .72, a white figure's unit is
/// `valueMute`.
private struct WFigure: View {
    let value: String
    var unit: String? = nil
    let size: CGFloat
    var color: Color = WatchV5.value
    /// True when `color` is a signal (amber) rather than white.
    var coloured: Bool = false

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
            Text(value)
                .font(WatchV5.number(size))
                .foregroundStyle(color)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            if let unit {
                Text(unit)
                    .font(WatchV5.number(max(15, size * 0.34)))
                    .foregroundStyle(coloured ? color.opacity(0.72) : WatchV5.valueMute)
            }
        }
    }
}

/// mm:ss, the way every countdown and elapsed figure in the app is written.
private func wClock(_ seconds: Int) -> String {
    let s = max(0, seconds)
    return "\(s / 60):" + String(format: "%02d", s % 60)
}

// MARK: - 5 · Controls
//
// Reached by tapping the running face, dismissed by tapping elsewhere. Three
// verbs and no telemetry: the runner came here to do something, not to read.

/// Which session the controls were opened from — which is what decides the
/// first verb.
///
/// Lap has no meaning when the session is already cutting its own laps, so
/// inside a rep it becomes **Skip rep**: the same slot, the same target, a
/// verb that applies. This is one enum and not two views on purpose — the
/// slot must not move between them.
enum WControlsMode: Equatable {
    /// A steady run. The first verb is Lap, and it leads on fill because it
    /// is the only one of the three that does not interrupt the run.
    case steady
    /// Inside a rep of a structured session. The first verb is Skip rep.
    case structured

    var leadVerb: String {
        switch self {
        case .steady:     return "Lap"
        case .structured: return "Skip rep"
        }
    }
}

/// Boards `Controls` and `Controls structured`.
///
/// `header` is the caller's, and it is not decoration: on a steady run it
/// says where the runner is (`Mile 5 · 44:16`), and inside a rep it NAMES THE
/// REP (`Rep 4 of 6 · 1:12 left`), because Skip without that is a question
/// the runner cannot answer.
struct FaceControlsV5: View {
    var mode: WControlsMode = .steady
    let header: String
    let onLead: () -> Void
    let onPause: () -> Void
    let onEnd: () -> Void

    var body: some View {
        WBoard {
            VStack(alignment: .leading, spacing: 6) {
                WFigureKicker(text: header)
                    .padding(.leading, 2)

                Spacer(minLength: 0)

                WTargetStack {
                    WTarget(label: mode.leadVerb, weight: .filled, action: onLead)
                    WTarget(label: "Pause", action: onPause)
                    WTarget(label: "End run", action: onEnd)
                }
            }
        }
    }
}

/// Board `End confirm`.
///
/// States what is unfinished as a FACT, not a warning: two reps left is
/// information the runner may already have decided about, and a warning would
/// be arguing with a decision that has been made. `unfinished` is optional
/// because a steady run has nothing unfinished — the line drops rather than
/// finding something to say.
///
/// Save leads. Discard is `WDestructive`: text, 42%, no pill (rule 7).
struct FaceEndConfirmV5: View {
    /// e.g. "Two reps unfinished". Nil on a run with nothing outstanding.
    var unfinished: String? = nil
    let onEndAndSave: () -> Void
    let onKeepRunning: () -> Void
    let onDiscard: () -> Void

    var body: some View {
        WBoard {
            VStack(alignment: .leading, spacing: 0) {
                Spacer(minLength: 0)

                VStack(alignment: .leading, spacing: 4) {
                    WDisplayWord(text: "End run", size: 26)
                    if let unfinished {
                        // Telemetry register, not coach: this is a count, and
                        // the coach does not comment on it here.
                        Text(unfinished)
                            .font(WatchV5.number(16))
                            .foregroundStyle(WatchV5.valueDim)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.leading, 2)

                Spacer(minLength: 0)

                WTargetStack {
                    WTarget(label: "End and save", weight: .filled, action: onEndAndSave)
                    WTarget(label: "Keep running", action: onKeepRunning)
                    // Rule 7. A filled pill beside a filled pill is how a run
                    // gets thrown away by accident.
                    WDestructive(label: "Discard it", action: onDiscard)
                }
            }
        }
    }
}

/// Board `Skip confirm`.
///
/// The ONE confirmation that earns a coach sentence, because skipping a rep
/// is the decision the coach has an opinion about. It gives the opinion and
/// then honours either answer: no second ask, and no nag on the next rep.
/// Whichever verb is pressed, this board does not come back.
///
/// The amber kicker is a decision waiting, not an error.
struct FaceSkipConfirmV5: View {
    /// e.g. "Skip rep 4" — names the rep, so the answer is answerable.
    let repLabel: String
    /// The opinion. 8-40 words, second person, no scolding.
    let coachLine: String
    let onSkipAnyway: () -> Void
    let onFinishIt: () -> Void

    var body: some View {
        WBoard {
            VStack(alignment: .leading, spacing: 0) {
                Spacer(minLength: 0)

                VStack(alignment: .leading, spacing: 6) {
                    WFigureKicker(text: repLabel, color: WatchV5.attention)
                    WCoachLine(text: coachLine, size: 15, color: WatchV5.value)
                }
                .padding(.leading, 2)

                Spacer(minLength: 0)

                WTargetStack {
                    WTarget(label: "Skip it anyway", weight: .filled, action: onSkipAnyway)
                    WTarget(label: "Finish it", action: onFinishIt)
                }
            }
        }
    }
}

/// Board `Extend recovery`.
///
/// Lives on the RECOVERY FACE, not in controls, because it is only true for
/// ninety seconds — burying it behind a tap would put it out of reach for
/// exactly as long as it is offered.
///
/// **The countdown stays live while the buttons show.** `secondsRemaining` is
/// a parameter the caller keeps updating, not a value this view captures:
/// +30 sec adds to the number the runner is watching, which is the whole
/// reason it is drawn here rather than described. Do not freeze it, and do not
/// re-render this view from a snapshot taken when the buttons appeared.
struct FaceExtendRecoveryV5: View {
    /// Live. The caller ticks this; `onAddThirty` should raise it by 30.
    let secondsRemaining: Int
    let onAddThirty: () -> Void
    let onGoNow: () -> Void

    var body: some View {
        WBoard {
            VStack(alignment: .leading, spacing: 0) {
                Spacer(minLength: 0)

                VStack(alignment: .leading, spacing: 2) {
                    WFigureKicker(text: "Recovery")
                    // 52pt — the top of the hero band. The number the runner
                    // is watching, and the one the button changes.
                    Text(wClock(secondsRemaining))
                        .font(WatchV5.number(52))
                        .foregroundStyle(WatchV5.value)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                }
                .padding(.leading, 2)

                Spacer(minLength: 0)

                WTargetStack {
                    WTarget(label: "+30 sec", weight: .filled, action: onAddThirty)
                    WTarget(label: "Go now", action: onGoNow)
                }
            }
        }
    }
}

// MARK: - 6 · Faults
//
// Red enters the wrist here and nowhere else, and it obeys rule 2 exactly: it
// marks a thing we could not read and it never renders a value. Amber stays
// what it is everywhere else — a condition, not a fault.
//
// NOTHING HERE BLOCKS THE RUN (rule 8). A watch that will not start until it
// has found a satellite is a watch the runner stops trusting on the third cold
// morning. Every fault names the sensor and never the runner.

/// Board `GPS acquiring`.
///
/// AMBER, NOT RED: nothing has failed. Start stays white and stays pressable,
/// the run begins on the runner's schedule, and the pace arrives when it
/// arrives.
///
/// No spinner, no pulse, no shimmer (rule 13). If you are tempted to add one
/// here, that is the exact impulse the rule exists against.
struct FaceGPSAcquiringV5: View {
    let onStart: () -> Void

    var body: some View {
        WBoard {
            VStack(alignment: .leading, spacing: 0) {
                Spacer(minLength: 0)

                VStack(alignment: .leading, spacing: 5) {
                    WDisplayWord(text: "No fix yet", size: 26, color: WatchV5.attention)
                    WCoachLine(text: "Start anyway \(WatchV5.separator) the pace catches up within a minute.",
                               size: 14)
                }
                .padding(.leading, 2)

                Spacer(minLength: 0)

                WTargetStack {
                    // Rule 8. White and pressable, on a board that is telling
                    // the runner a sensor is not ready yet.
                    WTarget(label: "Start", weight: .filled, action: onStart)
                }
            }
        }
    }
}

/// Board `Heart dropout`.
///
/// **Page 1 with ONE SLOT BROKEN.** The other three values are untouched — the
/// pace still grades, the distance and the elapsed still read exactly as they
/// did a second ago — so the failure reads as one slot and not one screen.
///
/// Rule 2 is absolute in that broken slot: red states that the sensor is
/// unread, IN WORDS, and never renders a number. A red 148 would be a value
/// the runner half believes. A last-known number greyed out was drawn and
/// thrown away: a stale heart rate in a work interval is worse than none.
/// `WSensorFault` takes no figure, so this cannot be undone by accident.
///
/// Still four slots, so rule 4 holds: the broken one occupies its slot rather
/// than vacating it, which is what keeps the other three where the runner's
/// eye already is.
struct FaceHeartDropoutV5: View {
    /// The lead metric, still graded — the session's question is unaffected.
    let pace: String
    var paceUnit: String = "/mi"
    var paceInBand: Bool = true
    let distance: String
    var distanceUnit: String = "mi"
    let elapsed: String

    var body: some View {
        WBoard {
            VStack(alignment: .leading, spacing: 8) {
                Spacer(minLength: 0)

                WMetric(value: pace, unit: paceUnit, rank: .hero,
                        grade: paceInBand ? .inBand : .outOfBand)

                // The broken slot. Words, never a figure.
                // NEEDS: fixed at 17pt; the design draws it at 19.
                WSensorFault(sensor: "No heart signal")

                WMetric(value: distance, unit: distanceUnit, rank: .secondary)
                WMetric(value: elapsed, rank: .tertiary, grade: .dim)

                Spacer(minLength: 0)
            }
        }
    }
}

/// Board `Low battery`.
///
/// A condition, so amber — and **the percentage IS drawn**, because it is a
/// real reading and not a sensor we failed to read. That is the line between
/// amber and red on this surface.
///
/// One sensor called one name: the sentence names the cost of dropping the
/// expensive sensor and the button names the SAME sensor. The runner is never
/// asked to work out that the pace read and GPS are the same choice.
///
/// `projectedMinutes` MUST come from a real estimate. If none is available it
/// is nil and **the sentence loses that clause** rather than guessing — the
/// handoff flags this explicitly as the one place a constant would be a lie.
///
/// "Keep it all" is the quiet option and the default if nothing is pressed:
/// the board does not take the run away on a timeout (rule 8).
struct FaceLowBatteryV5: View {
    let percent: Int
    /// A real projection of remaining run time, or nil. Never a constant.
    var projectedMinutes: Int? = nil
    let onDropGPS: () -> Void
    let onKeepItAll: () -> Void

    private var sentence: String {
        let cost = "GPS is most of that spend."
        guard let projectedMinutes else { return cost }
        return "About \(projectedMinutes) minutes \(WatchV5.separator) \(cost)"
    }

    var body: some View {
        WBoard {
            VStack(alignment: .leading, spacing: 0) {
                Spacer(minLength: 0)

                VStack(alignment: .leading, spacing: 3) {
                    WFigureKicker(text: "Battery")
                    WFigure(value: "\(percent)%", size: 44,
                            color: WatchV5.attention, coloured: true)
                    WCoachLine(text: sentence, size: 13)
                        .padding(.top, 3)
                }
                .padding(.leading, 2)

                Spacer(minLength: 0)

                WTargetStack {
                    WTarget(label: "Drop GPS", weight: .filled, action: onDropGPS)
                    // The quiet option, and the default if nothing is pressed.
                    WTarget(label: "Keep it all", action: onKeepItAll)
                }
            }
        }
    }
}

/// Board `Water lock`.
///
/// Not a fault, but it belongs with them because it is the other state where
/// the screen stops being usable. Rain on the wrist locks the display and
/// **the run keeps recording** — so the board's whole job is to PROVE the
/// recording is alive: two numbers, both moving, and the way out.
///
/// Both figures are caller-updated for that reason. A frozen pair here would
/// say the opposite of what the board exists to say.
struct FaceWaterLockV5: View {
    let distance: String
    var distanceUnit: String = "mi"
    let elapsed: String

    var body: some View {
        WBoard {
            VStack(alignment: .leading, spacing: 6) {
                Spacer(minLength: 0)

                WDisplayWord(text: "Locked", size: 22, color: WatchV5.valueDim)
                WFigure(value: distance, unit: distanceUnit, size: 38)
                WFigure(value: elapsed, size: 28, color: WatchV5.valueDim)
                WCoachLine(text: "Turn the crown to unlock.", size: 13)
                    .padding(.top, 4)

                Spacer(minLength: 0)
            }
        }
    }
}

// MARK: - 7 · The coach asks

/// Board `Bail offered`.
///
/// Mile 6, still running, decision open. **The evidence first and quietly**
/// ("Two miles adrift"), then the judgement in the coach's own register, then
/// two verbs.
///
/// **"Cut it short" leads on fill** — not because it is the recommendation,
/// but because it is the one the runner will not press by themselves, and a
/// coach that only ever offers the brave option is not offering anything.
///
/// **This is the only shape in the app that does not give the screen back on
/// its own. IT WAITS.** Do not add a dismiss timer, an auto-return, or a
/// swipe-away: an unanswered question that vanishes is worse than one that was
/// never asked. Fires once per run.
///
/// Whichever verb is pressed is recorded on the run and sent back to the
/// phone, which judges the session.
struct FaceBailOfferedV5: View {
    /// The evidence, quietly. e.g. "Two miles adrift".
    let evidence: String
    /// The judgement, in the coach's register.
    let judgement: String
    let onCutItShort: () -> Void
    let onRunItOut: () -> Void

    var body: some View {
        WBoard {
            VStack(alignment: .leading, spacing: 0) {
                Spacer(minLength: 0)

                VStack(alignment: .leading, spacing: 6) {
                    WFigureKicker(text: evidence, color: WatchV5.attention)
                    WCoachLine(text: judgement, size: 14.5, color: WatchV5.value)
                }
                .padding(.leading, 2)

                Spacer(minLength: 0)

                WTargetStack {
                    WTarget(label: "Cut it short", weight: .filled, action: onCutItShort)
                    WTarget(label: "Run it out", action: onRunItOut)
                }
            }
        }
    }
}

/// Board `Ceiling breach`.
///
/// The moment: a limit, named, with the number that broke it. Same grammar as
/// a band crossing, because it is the same class of event.
///
/// Heart rate is amber HERE AND NOWHERE ELSE, because this is the one time it
/// has a band to be outside of. Rule 1 is not bent — the figure is graded
/// because a grade exists for it, and only on this board.
///
/// Holds 2-3 seconds behind a haptic, then gives the screen back. It has no
/// verbs; `FaceCeilingOverrideV5` is the one that takes an answer.
struct FaceCeilingBreachV5: View {
    let bpm: String
    /// The limit itself, so the reading is legible against something.
    let ceiling: String

    var body: some View {
        WBoard {
            VStack(alignment: .leading, spacing: 6) {
                Spacer(minLength: 0)

                WDisplayWord(text: "Ceiling", size: 29, color: WatchV5.attention)
                WFigure(value: bpm, unit: "bpm", size: 48,
                        color: WatchV5.attention, coloured: true)
                Text("Ceiling is \(ceiling)")
                    .font(WatchV5.number(18))
                    .foregroundStyle(WatchV5.valueDim)

                Spacer(minLength: 0)
            }
        }
    }
}

/// Board `Ceiling override`.
///
/// **Takes an ANSWER instead of stating an unanswerable limit.** The old board
/// stated a limit the runner had no way to reply to, and an unanswerable limit
/// becomes an alert they learn to swipe (rule 11).
///
/// Amber because a decision is waiting. The reading and the limit are both
/// drawn once. The coach NAMES THE COST rather than forbidding the choice —
/// "Hot day, so the number runs high · the effort may be honest" is a reason,
/// not a permission slip.
///
/// Lifting it is recorded on the run and surfaces on the phone's summary. The
/// watch does not quietly forget it happened, so `onLiftForToday` must write
/// the decision, not only change a threshold in memory.
struct FaceCeilingOverrideV5: View {
    let bpm: String
    /// The prescribed limit, e.g. "165".
    let ceiling: String
    /// The cost, named. Nil when there is nothing honest to say — silence
    /// beats an unfalsifiable claim, and the board still takes its answer.
    var coachLine: String? = nil
    let onLiftForToday: () -> Void
    let onEaseOff: () -> Void

    var body: some View {
        WBoard {
            VStack(alignment: .leading, spacing: 0) {
                Spacer(minLength: 0)

                VStack(alignment: .leading, spacing: 2) {
                    WFigureKicker(text: "Ceiling is \(ceiling)")
                    WFigure(value: bpm, unit: "bpm", size: 44,
                            color: WatchV5.attention, coloured: true)
                    if let coachLine {
                        WCoachLine(text: coachLine, size: 13)
                            .padding(.top, 4)
                    }
                }
                .padding(.leading, 2)

                Spacer(minLength: 0)

                WTargetStack {
                    WTarget(label: "Lift it for today", weight: .filled, action: onLiftForToday)
                    WTarget(label: "Ease off", action: onEaseOff)
                }
            }
        }
    }
}

/// Board `Spoken cue`.
///
/// Every line the coach says in the ear is ALSO DRAWN on the wrist for the
/// three seconds it is spoken, in the coach's own register and **with nothing
/// else on the board** (rule 10). One runner has headphones in, one has them
/// in a pocket, and both get the same sentence: audio is a delivery route,
/// never a second content channel.
///
/// The orange kicker is the ONE PLACE ORANGE APPEARS MID-RUN. It marks WHO IS
/// TALKING, not how it is going — rule 3, drawn intent only, never on a
/// number. Do not add a metric, a phase label or a progress strip to this
/// board; the emptiness is the design.
struct FaceSpokenCueV5: View {
    /// The line, exactly as it is spoken. Copy rules hold: no exclamation
    /// marks, no emoji, no em dashes, second person present tense, 8-40 words.
    let line: String

    var body: some View {
        WBoard {
            VStack(alignment: .leading, spacing: 7) {
                Spacer(minLength: 0)

                WFigureKicker(text: "Coach", color: WatchV5.signal)
                WCoachLine(text: line, size: 17, color: WatchV5.value)

                Spacer(minLength: 0)
            }
        }
    }
}

// MARK: - Previews
//
// The design file's own fixture values, board for board.

#Preview("Controls") {
    FaceControlsV5(mode: .steady,
                   header: "Mile 5 \(WatchV5.separator) 44:16",
                   onLead: {}, onPause: {}, onEnd: {})
}

#Preview("Controls structured") {
    FaceControlsV5(mode: .structured,
                   header: "Rep 4 of 6 \(WatchV5.separator) 1:12 left",
                   onLead: {}, onPause: {}, onEnd: {})
}

#Preview("End confirm") {
    FaceEndConfirmV5(unfinished: "Two reps unfinished",
                     onEndAndSave: {}, onKeepRunning: {}, onDiscard: {})
}

#Preview("End confirm · nothing left") {
    FaceEndConfirmV5(onEndAndSave: {}, onKeepRunning: {}, onDiscard: {})
}

#Preview("Skip confirm") {
    FaceSkipConfirmV5(
        repLabel: "Skip rep 4",
        coachLine: "Three are banked \(WatchV5.separator) the last three are where the session earns its name.",
        onSkipAnyway: {}, onFinishIt: {})
}

#Preview("Extend recovery") {
    FaceExtendRecoveryV5(secondsRemaining: 72, onAddThirty: {}, onGoNow: {})
}

#Preview("GPS acquiring") {
    FaceGPSAcquiringV5(onStart: {})
}

#Preview("Heart dropout") {
    FaceHeartDropoutV5(pace: "8:24", paceInBand: true,
                       distance: "3.41", elapsed: "28:39")
}

#Preview("Low battery") {
    FaceLowBatteryV5(percent: 14, projectedMinutes: 40,
                     onDropGPS: {}, onKeepItAll: {})
}

#Preview("Low battery · no estimate") {
    // The clause is dropped, not guessed.
    FaceLowBatteryV5(percent: 14, projectedMinutes: nil,
                     onDropGPS: {}, onKeepItAll: {})
}

#Preview("Water lock") {
    FaceWaterLockV5(distance: "4.88", elapsed: "41:02")
}

#Preview("Bail offered") {
    FaceBailOfferedV5(
        evidence: "Two miles adrift",
        judgement: "The stimulus is already banked \(WatchV5.separator) forcing the rest buys fatigue, not fitness.",
        onCutItShort: {}, onRunItOut: {})
}

#Preview("Ceiling breach") {
    FaceCeilingBreachV5(bpm: "178", ceiling: "168")
}

#Preview("Ceiling override") {
    FaceCeilingOverrideV5(
        bpm: "174", ceiling: "165",
        coachLine: "Hot day, so the number runs high \(WatchV5.separator) the effort may be honest.",
        onLiftForToday: {}, onEaseOff: {})
}

#Preview("Spoken cue") {
    FaceSpokenCueV5(line: "Last two miles. Hold what you have \(WatchV5.separator) this is the part that counts.")
}
