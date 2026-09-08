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
    /// kind decides how tall it draws and how much of the piece it prints;
    /// it says nothing about how the phase went.
    ///
    /// 2026-09-08 · this sentence used to end "and where the timeline strip
    /// lights up". The strip is deleted (see `body`), so that clause named a
    /// consumer that no longer exists — Rule 20's corollary, a comment
    /// nothing verifies is worse than silence.
    ///
    /// 2026-09-03 · added to fix the "wall of similarly styled rows"
    /// finding: every phase drew at the same row height regardless of
    /// whether it was the work the runner opened the screen to see or a
    /// one-minute jog between two of it. `isWork` alone could not express
    /// "warm-up and cool-down are real distance and deserve more than one
    /// line, but still less than a rep" — this can.
    enum Kind: Equatable {
        case warmup, work, recovery, cooldown, overtime, other

        /// Classified from the phase's own wire type. One switch, called at
        /// both construction sites (`RunDetailV5.repPieces`,
        /// `TodayAfterV5.repPieces`), so the two screens cannot classify a
        /// phase differently.
        ///
        /// OVERTIME-PHASE-1 (2026-09-08) · `overtime` — running after the
        /// last prescribed piece — reaches the wire under its own name now
        /// (see `run-shape.ts`'s `PhaseType`). Before that it arrived as a
        /// null type and fell to `isWork`, which the Today screen defaulted
        /// TRUE: a 118-second jog home drew at full work weight beside a
        /// 25-minute tempo. It is a bookend, not work.
        static func of(type: String?, isWork: Bool) -> Kind {
            switch type {
            case "warmup":   return .warmup
            case "cooldown": return .cooldown
            case "recovery": return .recovery
            case "work":     return .work
            case "overtime": return .overtime
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
    /// `detail` already renders as a formatted clock string.
    ///
    /// 2026-09-08 · NOTHING IN THIS COMPONENT READS IT ANY MORE. It existed
    /// to weight the timeline strip's segments in real seconds, and the strip
    /// is deleted (see `body`). It is kept as a carried FACT rather than
    /// removed, because both call sites already populate it from their own
    /// wire and a future reader of this list — a chart, an export, a spoken
    /// summary — needs the number rather than the prose. Said out loud so
    /// the next reader does not go looking for the consumer.
    var durationSec: Int? = nil

    /// PHASE-GRAIN-1 (2026-09-08) · THIS PIECE, MILE BY MILE, when it was long
    /// enough to have miles of its own.
    ///
    /// The runner, on his own 3.5-mile tempo drawn as one number: "the 3.5
    /// tempo shows just one number but I'd like to see it broken down by mile.
    /// the shorter tempos obv wont but 3.5 miles is long enough that seeing
    /// the mile breakdown would be helpful." His row is the argument for it —
    /// 7:14 / 7:08 / 7:14 at 154 / 157 / 162 bpm, then a closing half mile at
    /// 165. Flat pace, eleven beats of drift, and a single "7:11/mi · HR 160"
    /// cannot say so.
    ///
    /// EMPTY IS THE NORMAL VALUE. The server refuses below two whole-mile
    /// boundaries of the piece's own sample stream, so a rep, a jog and a
    /// short tempo all arrive empty and draw nothing — the same treatment as a
    /// piece whose samples were never recorded, because Rule Three says a
    /// header over an empty list reads as a section that failed to load.
    ///
    /// Counted from the START OF THIS PIECE, never from the start of the run:
    /// mile 1 of a tempo that began a mile and a half in is the session's
    /// third mile, and the row does not claim otherwise.
    var mileSplits: [MilePiece] = []
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
/// Picks the WEAKEST claim the data actually supports:
///
///   1. any rep's completion is genuinely unknown → "Recorded" / bare count.
///      Nothing here licenses the word "completed".
///   2. more were recorded than planned → "Recorded" / the total recorded,
///      the surplus named in `sub` — "completed" against a number the plan
///      never set is not a claim to make.
///   3. otherwise → "Completed" / `completed of TOTAL`, where TOTAL is the
///      prescribed count (`planned` when known, else the raw recorded
///      count) — SKIP-TRANSPARENCY-1 (2026-09-05): a chosen skip is one of
///      the reps that was prescribed and still counts in the denominator,
///      so "3 of 3" never happens for a 4-rep session with one skip — that
///      reads as though only three were ever asked for. David, directly:
///      "Do not turn four prescribed reps with one chosen skip into '3 of 3
///      completed.' That can imply only three were prescribed." `sub` names
///      every qualifier that applies, in order: ended-early count,
///      intentionally-skipped count, missing count (`planned` known and
///      more reps were prescribed than ever got a record at all — a
///      distinct fact from a skip, which DOES have a record).
///
/// `planned` is nil wherever the caller has no prescribed rep count to
/// compare against (Today, currently) — the "missing" qualifier then never
/// fires, which is the correct, honest degradation: a surface with less
/// data makes a narrower claim, never a guessed one. Recorded-but-skipped
/// reps are never treated as "missing" — a skip has a phase record and a
/// reason; a genuinely missing rep has neither.
func repCompletionSummary(states: [RepRecordState], planned: Int?) -> RepCompletionSummary? {
    guard !states.isEmpty else { return nil }
    let recorded = states.count
    let completed = states.filter { $0 == .completed }.count
    let partial = states.filter { $0 == .partial }.count
    let skipped = states.filter { $0 == .skipped }.count
    let unknown = states.filter { $0 == .unknown }.count

    if unknown > 0 {
        let sub = skipped > 0 ? (skipped == 1 ? "1 skipped" : "\(skipped) skipped") : nil
        return .init(label: "Recorded", value: "\(recorded)", sub: sub)
    }
    if let planned, recorded > planned {
        let extra = recorded - planned
        return .init(label: "Recorded", value: "\(recorded)",
                     sub: extra == 1 ? "1 more than planned" : "\(extra) more than planned")
    }

    // The denominator is the PRESCRIBED count, never silently shrunk by
    // subtracting a chosen skip — a skip is one of the prescribed reps, not
    // one fewer of them.
    let total = planned ?? recorded

    var subParts: [String] = []
    if partial > 0 {
        subParts.append(partial == 1 ? "1 ended early" : "\(partial) ended early")
    }
    if skipped > 0 {
        subParts.append(skipped == 1 ? "1 intentionally skipped" : "\(skipped) intentionally skipped")
    }
    if let planned, recorded < planned {
        let missing = planned - recorded
        subParts.append(missing == 1 ? "1 missing" : "\(missing) missing")
    }

    return .init(label: "Completed", value: "\(completed) of \(total)",
                 sub: subParts.isEmpty ? nil : subParts.joined(separator: ", "))
}

// MARK: - The section

struct RepBreakdownV5: View {
    /// "Rep by rep" when the session was a rep set, "Piece by piece"
    /// otherwise. The caller decides, because it is the one holding the
    /// phase types.
    let title: String
    let pieces: [RepPiece]

    var body: some View {
        // RULE THREE, belt and braces. The caller already guards this; a
        // component that can draw an empty header is a component that
        // eventually will.
        if !pieces.isEmpty {
            VStack(alignment: .leading, spacing: V5.S.s10) {
                V5SectionLabel(text: title).padding(.horizontal, V5.S.s4)

                /* THE TIMELINE STRIP IS GONE (2026-09-08).
                 *
                 * A 6pt proportional bar, one segment per piece, drawn above
                 * this list since 2026-09-03. David, on his real 2026-09-08
                 * tempo, seeing it for the first time on a screen he was
                 * actually reading: an orange bar chart he could not explain.
                 * He was right, and the component's own code says why on
                 * three separate lines:
                 *
                 *   · `.accessibilityHidden(true)` — it admits it carries no
                 *     information a screen reader would need. A graphic that
                 *     is safe to hide from one runner entirely is a graphic
                 *     the other one does not need either.
                 *   · its own header forbade it labels or numbers, because
                 *     the table directly below already carries every figure
                 *     it could print and a second copy would be Rule 17. So
                 *     it was required to be unreadable to be legal.
                 *   · MEASURED, not eyeballed (Rule 13 §4): its quiet
                 *     segments are `V5.plotQuiet` at 0.6 alpha over the pure
                 *     black page ground — a contrast ratio of 1.18:1,
                 *     against the WCAG 3:1 minimum for a graphical object.
                 *     Three of this session's four segments were therefore
                 *     invisible in practice, so what he actually saw was not
                 *     a proportional four-part timeline at all. It was two
                 *     orange marks floating in nothing.
                 *
                 * Deleted, not fixed. The question it was reaching for — what
                 * shape was this session — already has a correct answer in
                 * `RunDetailV5.workoutAnalysisSection`: labelled bars, real
                 * contrast, a legend. Porting that to this screen is a
                 * separate decision and is NOT taken here; a screen with no
                 * chart is strictly better than one with a chart that cannot
                 * be read. */

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
        // OVERTIME-PHASE-1 (2026-09-08) · running after the last prescribed
        // piece is a BOOKEND, not work. It has real distance and a real
        // duration, so it keeps the detail line; it has no target, so there
        // is no note for it to drop. The row it used to draw — full ink,
        // full height, orange in the strip — was a null wire type read as
        // work, and it made a 118-second jog home look like a rep.
        case .warmup, .cooldown, .overtime:
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

        return VStack(alignment: .leading, spacing: 0) {
            fullRowHead(p, primary: primary)
            // PHASE-GRAIN-1 · NESTED UNDER THE PIECE, not as a section of its
            // own beside this one. These miles are miles OF this rep, and a
            // sibling section with its own header would be a second "how did
            // the pieces go" heading two inches under the first — the
            // duplicate-header problem this screen already has. Nesting also
            // means an eight-rep session that somehow qualified twice reads as
            // two indented tables under their own reps, not as two anonymous
            // ones at the bottom.
            if !p.mileSplits.isEmpty { mileTable(p.mileSplits) }
        }
        // One element per piece. Read as five separate strings a rep becomes
        // "Interval · 1 km" followed by four orphaned fragments, and the
        // fragment that says whose decision the skip was is the one that
        // stops the row sounding like a confession.
        .accessibilityElement(children: .contain)
    }

    private func fullRowHead(_ p: RepPiece, primary: Color) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: V5.S.s12) {
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

    // MARK: - The piece, mile by mile
    //
    // PHASE-GRAIN-1 (2026-09-08). A COMPACT table, not a second
    // `MileBreakdownV5`: that component carries a section label, a tile of its
    // own, a colour ramp and up to two captions, all of which belong to a
    // top-level section and none of which a nested three-row table has any use
    // for. What it DOES share is the thing that matters — `MilePiece`, and
    // `MilePiece.columnLabel`, so the remainder is named the same way in both.
    //
    // PACE IS NOT COLOURED HERE. `MileBreakdownV5`'s ramp is normalised over
    // the WHOLE RUN and drawn to match the route line above it; a nested table
    // has no map beside it and no access to that normalisation, and inventing
    // a second, phase-local ramp would put two meanings on one orange — the
    // exact collision that component's own header records being fixed. Plain
    // ink is a missing colour, never a wrong one.
    //
    // NO CLIMB AND NO CADENCE COLUMNS: a stored phase sample carries neither,
    // so there is nothing to draw and a header over blanks reads as a failure
    // to load.

    private static let mileNumberColumn: CGFloat = 52

    private func mileTable(_ pieces: [MilePiece]) -> some View {
        // Only where at least one mile has one — same rule the whole-run table
        // applies, for the same reason.
        let showsHr = pieces.contains { $0.hr != nil }
        return VStack(alignment: .leading, spacing: V5.S.s6) {
            HStack(alignment: .firstTextBaseline, spacing: V5.S.s12) {
                // "OF THIS PIECE" IS LOAD-BEARING, not decoration. Run detail
                // draws `MileBreakdownV5` on the same screen, under a column
                // also headed MILE, and those miles are cut from the START OF
                // THE RUN — the run's mile 3 spans the end of the warm-up and
                // the start of the tempo. Two columns headed MILE counting from
                // two origins is Rule 16 in its plainest form, and the cheaper
                // half of the fix is the one word that says which is which.
                //
                // The tables both stay: the run-relative one cannot answer what
                // the tempo's own first mile did, which is the entire reason
                // this section exists.
                Text("MILE OF THIS PIECE").frame(maxWidth: .infinity, alignment: .leading)
                Text("PACE").frame(width: Self.mileNumberColumn, alignment: .trailing)
                if showsHr { Text("HR").frame(width: Self.mileNumberColumn, alignment: .trailing) }
            }
            .font(.faffText(TypeScaleV5.label12))
            .foregroundStyle(V5.textQuiet)
            .accessibilityHidden(true)

            ForEach(pieces) { m in
                HStack(alignment: .firstTextBaseline, spacing: V5.S.s12) {
                    Text(m.columnLabel)
                        .font(.faffText(TypeScaleV5.label13))
                        .foregroundStyle(m.isPartial ? V5.textQuiet : V5.textSecondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    mileCell(m.paceSec.map { Units.formatPaceBare(secPerMile: $0) })
                    if showsHr { mileCell(m.hr.map { "\($0)" }) }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Self.spokenMile(m))
            }
        }
        // INDENTED, and under a hairline, so the table reads as belonging to
        // the row above it rather than as the next row of the list.
        .padding(.leading, V5.S.s16)
        .padding(.trailing, V5.S.tilePad)
        .padding(.bottom, V5.S.s12)
    }

    /// NOTHING, NOT A DASH, when the mile carried no reading — the whole-run
    /// table's rule, and its reasoning: `.measured(nil)` draws a fault-red dash
    /// meaning "we tried and failed", which a mile that simply recorded no
    /// heart rate did not do.
    @ViewBuilder
    private func mileCell(_ text: String?) -> some View {
        if let text {
            FaffValueText(.measured(text),
                          font: .faffText(TypeScaleV5.label13, weight: .semibold),
                          color: V5.textSecondary)
                .frame(width: Self.mileNumberColumn, alignment: .trailing)
        } else {
            Color.clear.frame(width: Self.mileNumberColumn, height: 1)
        }
    }

    /// "Mile 2 of this piece, 7:08 per mile, heart rate 157." Says nothing about
    /// a column the mile had no reading for, and names the remainder by its
    /// length rather than claiming a mile it did not cover.
    ///
    /// "OF THIS PIECE" IS SPOKEN TOO, for the reason the header carries it: a
    /// reader who cannot see the indent has nothing else to tell these miles
    /// apart from the run's own, which are read out under the same word two
    /// sections down.
    private static func spokenMile(_ m: MilePiece) -> String {
        var out: [String] = []
        if m.isPartial, let d = m.distanceMi {
            out.append(String(format: "Final %.2f of a mile of this piece", d))
        } else {
            out.append("Mile \(m.mile) of this piece")
        }
        if let s = m.paceSec { out.append("\(Units.formatPaceBare(secPerMile: s)) per mile") }
        if let hr = m.hr { out.append("heart rate \(hr)") }
        return out.joined(separator: ", ") + "."
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
