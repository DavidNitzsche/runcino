//
//  RepBreakdownV5.swift
//  faff.run iPhone · the session as the watch actually ran it, piece by piece.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY THIS EXISTS
//
//  `RunDetail.phase_breakdown` has been on the wire and decoded by Swift for
//  months. It fed exactly one thing: the colour of the route polyline. On
//  2026-08-11 the runner's tune-up stored NINE phases — warm-up, four 1 km
//  reps, three recovery jogs, a cool-down, each with its own target, its own
//  actual, its own heart rate and the watch's own grade — and run detail drew
//  a mile-by-mile bar chart. The reps were never shown.
//
//  A rep session is a list of reps. That is what the runner came to see, and
//  a chart cut on mile boundaries cannot show it: mile two of that session
//  contains the back half of rep one, a recovery jog, and the front of rep
//  two, averaged into one bar. The split chart is not wrong — it answers
//  "what shape was the run" — it just cannot answer "how did the reps go".
//  Both stay. They are different questions.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE COMPOSITION SEAM
//
//  Same contract `WristDecisionsV5` set: the WIRE carries quantities, the
//  PHONE owns the sentences. This component takes formatted strings and
//  arranges them; `RunDetailV5.repPieces` is the one place a phase becomes
//  words. A wording revision never touches the payload.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE REGISTER · WORDS, NOT COLOUR
//
//  This section grades execution, which `WristDecisionsV5` explicitly may not
//  do. So the rules collide and the collision needs settling out loud:
//
//    · NO AMBER, NO RED, NO GREEN, on any row. Green as a grade is out of
//      this palette everywhere. Amber means "out of range or provisional" and
//      a missed rep genuinely is out of range — so amber would be legal here
//      in a way it is not on a decision. It is still refused. Nine rows inked
//      by outcome turns a training session into a scorecard, and the coach's
//      own verdict — which has the heat, the terrain and the taper context
//      this list does not — is already two inches down the screen doing that
//      job properly. A list that grades every rep in isolation would be
//      arguing with it.
//
//    · A REP THE RUNNER CHOSE TO SKIP CARRIES NO GRADE AT ALL. `completed:
//      false` is the same byte whether the watch offered a stop and the
//      runner took it or the runner simply stopped, and on this screen those
//      two must not read the same. The caller resolves it against
//      `RunDetail.rep_skips` — an explicit record, never inferred — and a
//      chosen skip arrives here with `chosen: true` and no verdict phrase.
//
//    · THE WORK IS PRIMARY, the rest is context. Reps draw in full ink;
//      warm-up, recovery jogs and cool-down draw quiet. That is the only
//      visual hierarchy in the component and it encodes structure, never
//      outcome.
//
//  RULE ONE. An actual pace is measured — it is a reading off the wrist. A
//  target pace is modelled: it comes out of the plan's own pace table.
//  PACE-CONTRACT-1 (2026-09-05) retired the blanket word "asked" in front of
//  every target — it named a ceiling's one-sided bound the same way it named
//  a window's own range, which is the "8:48 against an 8:00/mi ceiling reads
//  as a miss" bug. The distinction is carried by `paceContractText`'s
//  shape-aware phrasing instead ("No faster than 8:00/mi", "7:09–7:19/mi
//  window") — see that function's own header in this file.
//
//  RULE THREE. A run with no phases draws NOTHING — not a header over an
//  empty list, which reads as a section that failed to load. The caller does
//  not construct this view at all in that case.
//

import SwiftUI

// MARK: - One piece of the session

/// A single phase, already turned into words by the caller.
struct RepPiece: Identifiable, Equatable {
    /// What kind of phase this is, for LAYOUT only — never a grade. A row's
    /// kind decides how tall it draws and where the timeline strip lights
    /// up; it says nothing about how the phase went.
    ///
    /// 2026-09-03 · added to fix the "wall of similarly styled rows"
    /// finding: every phase drew at the same row height regardless of
    /// whether it was the work the runner opened the screen to see or a
    /// one-minute jog between two of it. `isWork` alone could not express
    /// "warm-up and cool-down are real distance and deserve more than one
    /// line, but still less than a rep" — this can.
    enum Kind: Equatable {
        case warmup, work, recovery, cooldown, other

        /// Classified from the phase's own wire type. One switch, called at
        /// both construction sites (`RunDetailV5.repPieces`,
        /// `TodayAfterV5.repPieces`), so the two screens cannot classify a
        /// phase differently.
        static func of(type: String?, isWork: Bool) -> Kind {
            switch type {
            case "warmup":   return .warmup
            case "cooldown": return .cooldown
            case "recovery": return .recovery
            case "work":     return .work
            default:         return isWork ? .work : .other
            }
        }
    }

    /// The phase's own index in the workout. Identity is never the label —
    /// "Interval · 1 km" repeats four times in one session.
    let id: Int

    /// What the watch called it. "Warm-up", "Interval · 1 km", "Jog 1:30".
    let label: String

    /// True for a work rep. Drives ink weight; `kind` (below) drives row
    /// height and is the finer-grained read of the same phase.
    let isWork: Bool

    /// The pace that was run, formatted with its unit. Measured.
    let actualPace: String?

    /// PACE-CONTRACT-1, 2026-09-05 · the FULL, shape-aware pace contract
    /// text — "No faster than 8:00/mi", "7:09–7:19/mi window" — pre-composed
    /// by the caller via `paceContractText(shape:targetPaceSec:tolerancePaceSec:)`
    /// so this component never re-derives shape from a bare number. Renamed
    /// in meaning, not in name, from the old "bare pace the caller prefixes
    /// with 'asked'" contract — every call site already reads through this
    /// doc comment rather than the old one surviving as a trap.
    let askedPace: String?

    /// Distance, duration, heart rate — whatever the phase carried, joined by
    /// the middle dot. Nil when it carried none of them.
    let detail: String?

    /// The watch's grade, in plain words. Nil when the phase had no target to
    /// grade against, and ALWAYS nil on a chosen skip.
    let verdictPhrase: String?

    /// The runner chose to stop this rep. Not a lapse, and not graded.
    let chosen: Bool

    /// Layout classification. Defaults to `.work`/`.other` from `isWork` for
    /// any caller that has not been updated to pass one explicitly, so this
    /// field could be added without a coordinated two-call-site release.
    var kind: Kind = .other

    /// The phase's own recorded duration, in seconds — the raw number
    /// `detail` already renders as a formatted clock string. Carried
    /// separately, not parsed back out of that string, so the timeline
    /// strip's proportions are real seconds rather than prose read
    /// backwards. Nil draws a nominal sliver rather than vanishing the
    /// segment from the shape.
    var durationSec: Int? = nil
}

// MARK: - Shared verdict phrasing

/// PARITY-1, 2026-09-04 · the ONE place a graded phase's `(pace_shape,
/// verdict, status_label, type)` becomes the word a runner reads —
/// `RunDetailV5.verdictPhrase(_:)` now delegates to this rather than
/// re-deriving the same switch, and `TodayAfterV5.sectionPieces` calls it
/// directly off `V5RoutePhase`'s own four matching fields. Two wire types,
/// one function, so the same graded phase reads the same word on both
/// screens by construction rather than by two authors agreeing to.
func phaseVerdictPhrase(paceShape: String?, verdict: String?, statusLabel: String?, type: String?) -> String? {
    // A ceiling phase gets its word whatever its type — a warm-up and a
    // cool-down are exactly the phases this fixes.
    if paceShape == "ceiling" {
        switch verdict {
        case "fast":       return "Over the ceiling"
        case "hit":        return "Under the ceiling"
        // PACE-SHAPE-AUDIT-1, 2026-09-05 · WAS "Ended before its target" on
        // both arms — "target" names a point a ceiling never claimed to be,
        // and the completion fact (stopped early) has nothing to do with
        // pace direction anyway. "Ended early" says exactly what happened,
        // correctly for a ceiling or a window.
        case "incomplete": return "Ended early"
        default:           return statusLabel
        }
    }
    guard type == "work" else { return nil }
    if let label = statusLabel, !label.isEmpty { return label }
    switch verdict {
    case "hit":        return "In the band"
    case "fast":       return "Quicker than the band"
    case "slow":       return "Slower than the band"
    // LEGACY, from builds before 2026-09-01. Kept because stored rows carry
    // them; no build emits them.
    case "drifted":    return "In and out of the band"
    case "missed":     return "Outside the band"
    case "incomplete": return "Ended before its target"
    default:           return nil
    }
}

/// PACE-CONTRACT-1, 2026-09-05 · what a phase was actually asked to do,
/// worded for what its SHAPE means — replacing a blanket "asked X" that
/// implied every prescription was one point to hit exactly. A runner's own
/// correction, direct: showing "asked 8:00/mi" beside an 8:48 actual reads
/// as a miss even when 8:48 is fully compliant with an 8:00 CEILING; a
/// window's real contract is a RANGE, not the bare number in the middle of
/// it; an effort-graded phase was never asked a pace at all.
///
///   · `ceiling` — "No faster than 7:XX/mi" · the one edge that matters.
///   · `window`  — the RANGE, `target ± tolerance`, when both are known;
///                 the bare target only when tolerance is not.
///   · `effort` / `none` — nil. Nothing to compare — omit, don't guess.
///   · unrecognised/absent shape — nil rather than the old blanket "asked
///     X", which is exactly the ambiguous case this function replaces.
///
/// Takes RAW seconds (not the pre-formatted `target_pace` string) because a
/// window's range has to be computed, not just relabelled.
func paceContractText(
    shape: String?, targetPaceSec: Double?, tolerancePaceSec: Double?
) -> String? {
    guard let targetPaceSec, targetPaceSec > 0 else { return nil }
    switch shape {
    case "ceiling":
        guard let t = FaffFmt.pace(secPerMi: targetPaceSec) else { return nil }
        return "No faster than \(t)/mi"
    case "window":
        if let tol = tolerancePaceSec, tol > 0,
           let lo = FaffFmt.pace(secPerMi: targetPaceSec - tol),
           let hi = FaffFmt.pace(secPerMi: targetPaceSec + tol) {
            return "\(lo)–\(hi)/mi window"
        }
        guard let t = FaffFmt.pace(secPerMi: targetPaceSec) else { return nil }
        return "\(t)/mi window"
    default:
        return nil
    }
}

/// COMPLETION-STATE-1, 2026-09-05 · one rep's recorded outcome, resolved by
/// the caller from what it actually has — `PhaseBreakdown.completed` /
/// `V5RoutePhase.completed` (both now the honest `Bool?` the wire sends,
/// never coerced) crossed with `rep_skips` where that's available. Kept as
/// its own enum, not folded into `PhaseVerdict` (`hit`/`fast`/`slow`/…),
/// because completion and pace grade are different questions — a rep can be
/// `.completed` and `slow`, or `.partial` and otherwise on pace up to the
/// point it stopped.
enum RepRecordState { case completed, partial, skipped, unknown }

struct RepCompletionSummary { let label: String; let value: String; let sub: String? }

/// "4 of 4 completed" is a claim, and until this function existed it was
/// made unconditionally — the grid printed it whether or not any phase ever
/// said so. David, directly: "Today and Run Detail cannot say '4 of 4
/// completed' when the wire has no explicit completion status and the
/// implementation is counting returned rep records."
///
/// Picks the WEAKEST claim the data actually supports, in this order:
///
///   1. any rep's completion is genuinely unknown → "Recorded" / bare count.
///      Nothing here licenses the word "completed".
///   2. a rep is EXPLICITLY incomplete (ended early) → "N of M completed",
///      M excluding chosen skips, with the ended-early count in `sub`.
///   3. every recorded, non-skipped rep is explicitly complete, but
///      `planned` (when known) says there should be more → "N of PLANNED
///      completed", the gap named as missing in `sub`.
///   4. more were recorded than planned → "Recorded" / the total, the
///      surplus named in `sub`.
///   5. otherwise — everything recorded is explicitly complete and either
///      the planned count is unknown or matches → "N of N completed".
///
/// `planned` is nil wherever the caller has no prescribed rep count to
/// compare against (Today, currently) — cases 3-4 then never fire, which is
/// the correct, honest degradation: a surface with less data makes a
/// narrower claim, never a guessed one.
func repCompletionSummary(states: [RepRecordState], planned: Int?) -> RepCompletionSummary? {
    guard !states.isEmpty else { return nil }
    let recorded = states.count
    let completed = states.filter { $0 == .completed }.count
    let partial = states.filter { $0 == .partial }.count
    let skipped = states.filter { $0 == .skipped }.count
    let unknown = states.filter { $0 == .unknown }.count
    let attempted = recorded - skipped
    let skipNote = skipped == 1 ? "1 skipped" : "\(skipped) skipped"

    if unknown > 0 {
        return .init(label: "Recorded", value: "\(recorded)", sub: skipped > 0 ? skipNote : nil)
    }
    if partial > 0 {
        let endedEarly = partial == 1 ? "1 ended early" : "\(partial) ended early"
        let sub = skipped > 0 ? "\(endedEarly), \(skipNote)" : endedEarly
        return .init(label: "Completed", value: "\(completed) of \(attempted)", sub: sub)
    }
    if let planned, recorded < planned {
        let missing = planned - recorded
        return .init(label: "Completed", value: "\(completed) of \(planned)",
                     sub: missing == 1 ? "1 missing" : "\(missing) missing")
    }
    if let planned, recorded > planned {
        let extra = recorded - planned
        return .init(label: "Recorded", value: "\(recorded)",
                     sub: extra == 1 ? "1 more than planned" : "\(extra) more than planned")
    }
    if skipped > 0 {
        return .init(label: "Completed", value: "\(completed) of \(attempted)", sub: skipNote)
    }
    return .init(label: "Completed", value: "\(completed) of \(completed)", sub: nil)
}

// MARK: - The section

struct RepBreakdownV5: View {
    /// "Rep by rep" when the session was a rep set, "Piece by piece"
    /// otherwise. The caller decides, because it is the one holding the
    /// phase types.
    let title: String
    let pieces: [RepPiece]

    /// DEPRECATED, 2026-09-05 (LESS-IS-MORE-2) · the watch's tolerance
    /// arithmetic used to draw here unconditionally, as the exact sentence
    /// David named to remove from the primary scan path. It now lives in
    /// `PostRunVerdictV5.analysisNote`, behind "Why", in plain language.
    /// Parameter kept (always nil in every live call site) rather than torn
    /// out of the initializer in the same pass that also touched every
    /// caller — deleting it is a clean, separate, zero-behavior-risk step.
    var toleranceLine: String? = nil

    var body: some View {
        // RULE THREE, belt and braces. The caller already guards this; a
        // component that can draw an empty header is a component that
        // eventually will.
        if !pieces.isEmpty {
            VStack(alignment: .leading, spacing: V5.S.s10) {
                V5SectionLabel(text: title).padding(.horizontal, V5.S.s4)

                // THE SHAPE, BEFORE THE LIST. A runner scanning ten hill
                // reps for the first time gets the proportions in one
                // glance — work lit, everything around it quiet, the same
                // "which segment is which kind" read `RunAnalysisV5`'s phase
                // bands give the chart, at list scale rather than axis
                // scale. Non-interactive: touching it does nothing yet (see
                // this component's own header for why the chart-row sync
                // the brief asks for is not built).
                if pieces.count > 2 { timelineStrip.padding(.horizontal, V5.S.s14) }

                VStack(alignment: .leading, spacing: 0) {
                    ForEach(pieces) { piece in
                        row(piece)
                    }
                }
                .padding(.vertical, V5.S.s6)
                .background(V5.materialTile,
                            in: RoundedRectangle(cornerRadius: V5.R.r18, style: .continuous))
            }
        }
    }

    // MARK: - A row

    @ViewBuilder
    private func row(_ p: RepPiece) -> some View {
        // COMPACT, ONE LINE, for a recovery jog or a bookend. This is the
        // fix for "piece by piece becomes a long wall of similarly styled
        // rows" — a ten-rep hill session used to draw its nine jogs at the
        // same three-line height as its ten reps, so the reps the runner
        // actually came to read were 47% of a twenty-row list by count and
        // nowhere near that by attention. A jog is one fact (how long, how
        // fast) and gets one line to state it in.
        switch p.kind {
        case .recovery:
            compactRow(p)
        case .warmup, .cooldown:
            // A BOOKEND KEEPS ITS DETAIL LINE — it carries real distance and
            // a real duration, which a runner reading "warm-up" alone
            // cannot judge — but drops the trailing note line a work rep
            // gets, since a ceiling phase's note ("Under the ceiling") is
            // already implied by pace-shape convention and repeating it on
            // both bookends of every session is exactly Rule 17's target.
            bookendRow(p)
        case .work, .other:
            fullRow(p)
        }
    }

    /// The one-line treatment: a recovery jog, in full.
    private func compactRow(_ p: RepPiece) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: V5.S.s10) {
            Text(p.label)
                .font(.faffText(TypeScaleV5.label14))
                .foregroundStyle(V5.textQuiet)
            if let detail = p.detail {
                Text(detail)
                    .font(.faffText(TypeScaleV5.label13))
                    .foregroundStyle(V5.textQuiet)
            }
            Spacer(minLength: V5.S.s8)
            if let pace = p.actualPace {
                Text(pace)
                    .font(.faffText(TypeScaleV5.label13))
                    .foregroundStyle(V5.textQuiet)
            }
        }
        .padding(.horizontal, V5.S.tilePad)
        .padding(.vertical, V5.S.s6)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken(p))
    }

    /// The two-line treatment: a warm-up or cool-down — real distance, no
    /// trailing note.
    private func bookendRow(_ p: RepPiece) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: V5.S.s12) {
            VStack(alignment: .leading, spacing: V5.S.s2) {
                Text(p.label)
                    .font(.faffText(TypeScaleV5.body15))
                    .foregroundStyle(V5.textSecondary)
                if let detail = p.detail {
                    Text(detail)
                        .font(.faffText(TypeScaleV5.label13))
                        .foregroundStyle(V5.textQuiet)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if let pace = p.actualPace {
                Text(pace)
                    .font(.faffText(TypeScaleV5.body15, weight: .medium))
                    .foregroundStyle(V5.textSecondary)
            }
        }
        .padding(.horizontal, V5.S.tilePad)
        .padding(.vertical, V5.S.s9)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken(p))
    }

    /// The full treatment: a work rep, unchanged from before this pass.
    private func fullRow(_ p: RepPiece) -> some View {
        // Work reps in full ink. Structure, never outcome — a missed rep
        // and a hit rep are the same weight.
        let primary = V5.textPrimary

        return HStack(alignment: .firstTextBaseline, spacing: V5.S.s12) {
            VStack(alignment: .leading, spacing: V5.S.s4) {
                Text(p.label)
                    .font(.faffText(TypeScaleV5.body17))
                    .foregroundStyle(primary)
                if let detail = p.detail {
                    Text(detail)
                        .font(.faffText(TypeScaleV5.label13))
                        .foregroundStyle(V5.textQuiet)
                }
                if let note = Self.note(p) {
                    Text(note)
                        .font(.faffText(TypeScaleV5.label13))
                        .foregroundStyle(V5.textQuiet)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            VStack(alignment: .trailing, spacing: V5.S.s4) {
                // NOTHING, NOT A DASH, when there is no pace.
                //
                // `FaffValue.measured(nil)` is `.unreadable`, which draws "—"
                // in FAULT RED and means "we tried to read this and could
                // not". A rep the runner chose to skip was never run: there is
                // nothing to read, and a red dash on that row is precisely the
                // screen calling a decision a failure. Absence is the honest
                // mark for absence.
                if let pace = p.actualPace {
                    FaffValueText(.measured(pace),
                                  font: .faffText(17, weight: .semibold),
                                  color: primary)
                }
                if let asked = p.askedPace {
                    // PACE-CONTRACT-1 · the caller's already-composed,
                    // shape-aware text — "No faster than 8:00/mi", "7:09–
                    // 7:19/mi window" — printed verbatim. The bare "asked X"
                    // prefix this used to add is gone: it named every
                    // prescription a single point to hit, which is only
                    // true for a window's own displayed range, never for a
                    // ceiling's one-sided bound.
                    Text(asked)
                        .font(.faffText(TypeScaleV5.label12))
                        .foregroundStyle(V5.textQuiet)
                }
            }
        }
        .padding(.horizontal, V5.S.tilePad)
        .padding(.vertical, V5.S.s12)
        // One element per piece. Read as five separate strings a rep becomes
        // "Interval · 1 km" followed by four orphaned fragments, and the
        // fragment that says whose decision the skip was is the one that
        // stops the row sounding like a confession.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken(p))
    }

    // MARK: - The timeline strip
    //
    // A proportional bar, one segment per piece, sized by its share of the
    // session's TOTAL DURATION (not distance — a 20-second stride and a
    // 90-second jog are both short in miles and this is a TIME shape, the
    // same axis the coach's own "how did the reps go" question runs on).
    // Work segments draw in the one accent; everything else quiet. No
    // labels, no numbers — the rows below already carry every figure this
    // strip could print, and a second copy of them here would be Rule 17.
    private var timelineStrip: some View {
        let total = pieces.reduce(0.0) { $0 + Self.weight($1) }
        return GeometryReader { geo in
            HStack(spacing: 1.5) {
                ForEach(pieces) { p in
                    let w = total > 0 ? Self.weight(p) / total : 0
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(p.isWork ? V5.signal : V5.plotQuiet.opacity(0.6))
                        .frame(width: max(geo.size.width * w, p.isWork ? 3 : 1.5))
                }
            }
            .frame(width: geo.size.width)
        }
        .frame(height: 6)
        .accessibilityHidden(true)
    }

    /// Real seconds, when the phase carries them — a genuine time-weighted
    /// strip, not a decorative approximation. A phase with no recorded
    /// duration (an older payload, a chosen skip) still draws a nominal
    /// sliver so it stays visible as a segment in the shape, rather than
    /// vanishing and silently shrinking every segment beside it.
    private static func weight(_ p: RepPiece) -> Double {
        guard let sec = p.durationSec, sec > 0 else { return 8 }
        return Double(sec)
    }

    /// The one line under a row, or none.
    ///
    /// A CHOSEN SKIP OUTRANKS A VERDICT AND REPLACES IT. The caller already
    /// declines to compose a verdict phrase for a chosen skip, so this is the
    /// second of two guards on the same rule — the one thing this section may
    /// not do is print "outside the band" against a rep the coach offered to
    /// stop. The sentence names whose decision it was, which is the only fact
    /// that separates it from a rep the runner simply lost.
    static func note(_ p: RepPiece) -> String? {
        p.chosen ? "You took the stop the watch offered" : p.verdictPhrase
    }

    /// The spoken row.
    ///
    /// "estimated" goes in front of the target and nowhere else. That word is
    /// rule one's whole remaining carrier now the tilde is gone, so it has to
    /// be attached to the modelled figure and only to it — an actual pace is a
    /// reading and must never pick it up.
    private func spoken(_ p: RepPiece) -> String {
        var parts: [String] = [p.label]
        if let pace = p.actualPace { parts.append("ran \(pace)") }
        // PACE-CONTRACT-1 · `asked` is now the full shape-aware sentence
        // fragment ("No faster than 8:00/mi", "7:09–7:19/mi window") —
        // "per mile" no longer belongs appended, it is already inside it.
        if let asked = p.askedPace { parts.append(asked) }
        if let detail = p.detail { parts.append(detail.replacingOccurrences(of: " \u{00B7} ", with: ", ")) }
        if let note = Self.note(p) { parts.append(note) }
        return parts.joined(separator: ". ") + "."
    }
}

// MARK: - Preview

#Preview("Rep by rep · the 2026-08-11 tune-up") {
    ScrollView {
        RepBreakdownV5(
            title: "Rep by rep",
            pieces: [
                RepPiece(id: 0, label: "Warm-up", isWork: false, actualPace: "7:55/mi",
                         askedPace: "8:57", detail: "1.5 mi \u{00B7} 11:54 \u{00B7} HR 135",
                         verdictPhrase: nil, chosen: false),
                RepPiece(id: 1, label: "Interval \u{00B7} 1 km", isWork: true, actualPace: "6:21/mi",
                         askedPace: "6:52", detail: "0.62 mi \u{00B7} 3:57 \u{00B7} HR 164",
                         verdictPhrase: "Outside the band", chosen: false),
                RepPiece(id: 2, label: "Jog 1:30", isWork: false, actualPace: "8:14/mi",
                         askedPace: nil, detail: "0.18 mi \u{00B7} 1:30 \u{00B7} HR 164",
                         verdictPhrase: nil, chosen: false),
                RepPiece(id: 3, label: "Interval \u{00B7} 1 km", isWork: true, actualPace: "6:27/mi",
                         askedPace: "6:52", detail: "0.62 mi \u{00B7} 4:02 \u{00B7} HR 169",
                         verdictPhrase: "Outside the band", chosen: false),
                RepPiece(id: 5, label: "Interval \u{00B7} 1 km", isWork: true, actualPace: "6:42/mi",
                         askedPace: "6:52", detail: "0.62 mi \u{00B7} 4:10 \u{00B7} HR 168",
                         verdictPhrase: "In and out of the band", chosen: false),
                RepPiece(id: 7, label: "Interval \u{00B7} 1 km", isWork: true, actualPace: nil,
                         askedPace: "6:52", detail: nil,
                         verdictPhrase: nil, chosen: true),
            ]
        )
        .padding(.horizontal, V5.S.gutter)
    }
    .background(V5.surfacePage)
    .preferredColorScheme(.dark)
}
