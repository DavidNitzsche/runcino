//
//  MileBreakdownV5.swift
//  faff.run iPhone · the run mile by mile, as numbers.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY THIS EXISTS
//
//  The route map was carrying the per-mile story as COLOUR, and a coloured
//  line cannot carry it. The runner said so:
//
//      "Instead of trying to make the route have all these colors and overlap
//       bullshit, lets just add in a breakdown for per mile on easy or longer
//       runs and per section for intervals and tempos or whatever is best for
//       the run"
//
//  He is right, and his own 2026-08-24 run is the proof. Its five miles ran
//  127 / 140 / 138 / 144 / 158 bpm — a Z1 opening and a Z4 finish — and no
//  shading of a polyline was ever going to say that. A line has one channel;
//  a mile has a pace, a heart rate, a climb and a cadence. This is the four
//  of them in the four places a reader can compare down a column.
//
//  It also settles, by being built, the open question in `ChartsV5.SplitBar`:
//  "`RunSplit` has carried `hr` since it was written and nothing has ever
//  read it … round three asked design to confirm this chart is bars only and
//  that question is still open." The answer is that the chart stays bars —
//  height is pace, and the shape of the run is what it is for — and the
//  reading goes here, where a number can be read as a number.
//
//  SIBLING OF `RepBreakdownV5`, deliberately. That component answers "how did
//  the reps go" for a session made of reps; this answers "how did the miles
//  go" for a session made of miles. Same register, same seam, same refusals.
//  The caller picks between them on what the run actually was, and a run with
//  phases prefers sections — a mile holding the back of one rep, a jog and
//  the front of the next is an average of three different things.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE REGISTER · NUMBERS, NOT VERDICTS
//
//  No colour carries a VERDICT here. Heart rate is not tinted by zone, a climb
//  is not tinted by gradient, and pace is not tinted by whether it sat in a
//  window. The coach's recap — which holds the heat, the terrain and the taper
//  context this table does not — is what says whether the run was what was
//  asked. A table that graded every mile in isolation would be arguing with it.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE ONE COLOUR, AND WHY IT CHANGED (2026-08-30)
//
//  The pace column DID tint by band adherence, and it was the second thing on
//  the run-detail screen doing something different with the same orange. The
//  route map above it had just become a continuous amber→orange pace gradient
//  where orange means "ran faster"; this table's orange meant "inside the
//  prescription". On the runner's own 13.49 mi long run, prescribed 8:37-9:12
//  and actually run 7:16-8:38 with a friend, mile 4 at 6:52 was the fastest
//  mile of the day: bright orange on the map, plain ink in the table, two
//  inches apart on one screen.
//
//      "Make the mile table match the map."
//
//  So the pace column now draws off `RouteMapView.runPaceColorFn` — the same
//  function, over the same normalisation, so a mile cannot be one colour in
//  the graphic and another in the table. Orange means one thing on this
//  screen: you ran faster here. It is not a grade in either direction.
//
//  BAND ADHERENCE DID NOT VANISH, it stopped being a colour. It is said in
//  words by the run recap, which is his reasoning and is the better carrier
//  besides: a colour cannot tell you whether running fast was good or bad on
//  a given day, and a sentence can.
//
//  ─────────────────────────────────────────────────────────────────────────
//  RULE ONE, AND THE ONE THAT ACTUALLY BIT
//
//  Every figure here is a reading, so every one renders `.measured`. The
//  trap is the other direction: `run-state.ts:perMileFilled` — and its Swift
//  twin in `RouteMapView` — hand a split with no reading its NEIGHBOUR's
//  value so that every mile has something to draw. Inside a colour gradient
//  that is invisible. In a table it would print "140" beside a mile that
//  never recorded a heart rate, which is a borrowed number wearing a measured
//  number's clothes.
//
//  So nothing is filled here. A cell with no reading is EMPTY — not a dash.
//  `FaffValue.measured(nil)` renders "—" in fault red and means "we tried to
//  read this and could not", which is a different and stronger claim than
//  "this mile carried no cadence". Absence is drawn as absence.
//
//  A COLUMN NOBODY HAS DATA FOR IS NOT DRAWN. If no mile carried a heart
//  rate, there is no heart-rate column — a header over five blanks reads as a
//  section that failed to load.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE TRAILING PIECE
//
//  A 4.11 mile run is four miles and a bit. The bit is a real split whose
//  pace is measured over a tenth of a mile, so it swings hardest and means
//  least, and calling it "Mile 5" claims a whole mile that was not run. It is
//  named for what it is and carries its own distance.
//
//  That is only possible because `RunSplit.distanceMi` now reaches the phone;
//  the stored row has always had it and the wire dropped it. Where it is
//  still absent the row says nothing about its length rather than assuming a
//  whole mile — `nil` is "we were not told", which is not "1".
//

import SwiftUI

// MARK: - One mile

/// A single split, already reduced to what the table draws. Identity is the
/// mile number, which is unique within a run.
struct MilePiece: Identifiable, Equatable {
    let id: Int
    /// 1-based mile number.
    let mile: Int
    /// Seconds per mile, as measured over this split. Nil when the split
    /// carried no usable pace.
    let paceSec: Int?
    /// Average heart rate over the split. Nil means the split carried none —
    /// never a neighbour's.
    let hr: Int?
    /// Net climb across the split, in feet, signed.
    let elevFt: Int?
    /// Steps per minute.
    let cadence: Int?
    /// How much of a mile this covers. Nil when the source did not say, which
    /// is why it is not defaulted to 1.
    let distanceMi: Double?

    // `inBand` IS GONE (2026-08-30). It carried the band verdict into the
    // pace column's fill, which is the collision this component's header
    // describes. Nothing replaces it here: the fact is the recap's to state,
    // in words, and a second channel saying the same thing in colour is what
    // put two meanings on one orange.

    /// True only when we were TOLD the split is short. A nil distance is not
    /// evidence of a whole mile, and it is not evidence of a fragment either,
    /// so it produces no claim in the label.
    var isPartial: Bool {
        guard let d = distanceMi else { return false }
        return d < 0.95
    }
}

// MARK: - The section

struct MileBreakdownV5: View {
    /// "Mile by mile". The caller owns the word, because the caller is the one
    /// holding the runner's unit preference.
    let title: String
    let pieces: [MilePiece]


    /// The colour rule, said once in words.
    ///
    /// Carried over from the chart this replaces for the reason its own
    /// comment gave: without it the fill is a code the screen never breaks.
    /// It used to describe the band and is now the pace ramp — see
    /// `RouteMapView.paceColumnCaption`, which authors it beside the sentence
    /// under the map so the two cannot drift into describing different rules.
    /// Nil when no colour rule is in force, i.e. the caller passed no
    /// `paceColor` and every figure draws in plain ink.
    var paceLine: String? = nil

    /// SECONDS PER MILE → THE COLOUR THE ROUTE LINE PAINTS AT THAT PACE.
    ///
    /// Supplied by the caller, from `RouteMapView.runPaceColorFn`, rather than
    /// derived here. This component sees only its own rows; the map's
    /// normalisation depends on whether the run recorded phases, and a table
    /// that re-decided that for itself is a second answer waiting to disagree
    /// with the first.
    ///
    /// Nil draws plain ink, which is the honest fallback for a caller that has
    /// no map on screen: it is a missing colour, never a wrong one.
    var paceColor: ((Int) -> Color)? = nil

    /// False where the run type says a per-mile climb is not a measurement.
    /// Defaults true so a caller that has no shape still gets the data-driven
    /// behaviour rather than a silently missing column.
    var allowsElevation: Bool = true

    /// False on a recovery run, where doctrine says to ignore pace outright.
    /// See `RunShapeV5.showsPerMilePace`.
    var allowsPace: Bool = true

    /// Columns are drawn only where at least one mile has something to put in
    /// them. See the header comment: a column of blanks reads as a failure to
    /// load, not as an absence of data.
    private var showsHr: Bool { pieces.contains { $0.hr != nil } }
    /// Data AND doctrine. A column nobody has readings for is not drawn — and
    /// a column the run type says is a fabrication is not drawn even when
    /// readings exist. A treadmill's per-mile "climb" is invented by the
    /// barometer or zero regardless of a 6% grade; either way it is not the
    /// run's climb. See `RunShapeV5.showsElevation`.
    private var showsElev: Bool {
        allowsElevation && pieces.contains { $0.elevFt != nil }
    }
    /// Cadence is the first thing to go when the row is tight. It is the least
    /// asked-for of the four and the only one with no coaching consequence on
    /// this screen, so it draws only when there is room left after the rest.
    private var showsCadence: Bool {
        pieces.contains { $0.cadence != nil } && !(showsHr && showsElev)
    }

    private let numberColumn: CGFloat = 58

    var body: some View {
        // RULE THREE, belt and braces, same as `RepBreakdownV5`: a component
        // that can draw an empty header eventually will.
        if !pieces.isEmpty {
            VStack(alignment: .leading, spacing: V5.S.s10) {
                V5SectionLabel(text: title).padding(.horizontal, V5.S.s4)

                VStack(alignment: .leading, spacing: 0) {
                    header
                    ForEach(pieces) { row($0) }
                }
                .padding(.vertical, V5.S.s6)
                .background(V5.materialTile,
                            in: RoundedRectangle(cornerRadius: V5.R.r18, style: .continuous))
                if let paceLine {
                    Text(paceLine)
                        .font(.faffText(TypeScaleV5.label12))
                        .foregroundStyle(V5.textQuiet)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, V5.S.s4)
                }
            }
        }
    }

    /// A TABLE NAMES ITS OWN COLUMNS.
    ///
    /// This is the same need that produced the request for a key over the
    /// map — "we need a key … this route will be shaded different based on
    /// the run so we need to be clear". A graphic has to be given a legend
    /// from outside; a table carries one. Nothing here has to be decoded.
    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: V5.S.s12) {
            // ALWAYS "MILE", whatever the runner's display unit.
            //
            // The backend cuts splits per mile regardless of preference, and
            // `SplitBars.spoken` already settled this for the chart: calling
            // one "kilometre 4" to match a preference would name it something
            // it is not. The FIGURE follows the preference — `formatPaceBare`
            // converts — but the SPLIT does not.
            Text("MILE")
                .frame(maxWidth: .infinity, alignment: .leading)
            if allowsPace { Text("PACE").frame(width: numberColumn, alignment: .trailing) }
            if showsHr { Text("HR").frame(width: numberColumn, alignment: .trailing) }
            if showsElev { Text("CLIMB").frame(width: numberColumn, alignment: .trailing) }
            if showsCadence { Text("SPM").frame(width: numberColumn, alignment: .trailing) }
        }
        .font(.faffText(TypeScaleV5.label12))
        .foregroundStyle(V5.textQuiet)
        .padding(.horizontal, V5.S.s14)
        .padding(.bottom, V5.S.s6)
        .accessibilityHidden(true)
    }

    private func row(_ p: MilePiece) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: V5.S.s12) {
            // THE PARTIAL IS NOT NUMBERED.
            //
            // This drew a full-size "5" with "0.11 mi" beneath it, and the
            // owner read exactly what it says: five miles, plus an orphan
            // tenth "for no reason and to nowhere". The number was the
            // problem. There is no fifth mile — there is four miles and a
            // remainder, and a numeral claims the mile whatever the subtitle
            // says underneath it.
            //
            // So the remainder gives up its number and states its length in
            // the same slot, in the same weight the numerals use. The column
            // then reads 1, 2, 3, 4, 0.11 mi — which is what happened.
            //
            // In miles, for the same reason the header says MILE: this is a
            // mile-cut piece, so its length is a fraction of a mile. "0.18 km"
            // would describe it in a unit it was never measured in.
            Group {
                if p.isPartial, let d = p.distanceMi {
                    Text(String(format: "%.2f mi", d))
                        .font(.faffText(TypeScaleV5.body17))
                        .foregroundStyle(V5.textSecondary)
                } else {
                    Text("\(p.mile)")
                        .font(.faffText(TypeScaleV5.body17))
                        .foregroundStyle(V5.textPrimary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            // THE PACE COLUMN IS THE ONLY COLOURED ONE, and what it carries
            // is INTENSITY, not a verdict: amber at this run's slowest, orange
            // at its fastest, off the same ramp the route line above is drawn
            // with.
            //
            // A run whose spread is under `RouteMapView.paceRangeFloorSec`
            // comes back one flat `V5.signal` for every mile, which is
            // deliberate and is the map's behaviour too — the alternative is
            // amplifying GPS noise into a rainbow. `paceColumnCaption` says so
            // in that case rather than promising a gradient that is not there.
            if allowsPace {
                cell(p.paceSec.map { Units.formatPaceBare(secPerMile: $0) },
                     color: p.paceSec.flatMap { sec in paceColor?(sec) } ?? V5.textPrimary)
            }
            if showsHr { cell(p.hr.map { "\($0)" }) }
            if showsElev { cell(p.elevFt.map { $0 > 0 ? "+\($0)" : "\($0)" }) }
            if showsCadence { cell(p.cadence.map { "\($0)" }) }
        }
        .padding(.horizontal, V5.S.s14)
        .padding(.vertical, V5.S.s9)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken(p))
    }

    /// NOTHING, NOT A DASH, when the mile carried no reading.
    ///
    /// `FaffValue.measured(nil)` draws "—" in fault red and means "we tried
    /// and failed". A mile that simply recorded no cadence is not a failure,
    /// and colouring it like one would be the table crying wolf four times a
    /// run. Empty space is the honest mark for nothing.
    @ViewBuilder
    private func cell(_ text: String?, color: Color = V5.textPrimary) -> some View {
        if let text {
            FaffValueText(.measured(text),
                          font: .faffText(TypeScaleV5.body17, weight: .semibold),
                          color: color)
                .frame(width: numberColumn, alignment: .trailing)
        } else {
            Color.clear.frame(width: numberColumn, height: 1)
        }
    }

    /// VoiceOver reads a row as a sentence, and says nothing at all about a
    /// column the mile had no reading for. "Cadence, none" would be inventing
    /// a fact about the absence.
    private func spoken(_ p: MilePiece) -> String {
        // "mile", never "kilometre" — see the header. The pace FIGURE below
        // still follows the runner's unit preference.
        let unitWord = "mile"
        var out: [String] = []
        if p.isPartial, let d = p.distanceMi {
            out.append(String(format: "Part mile %d, %.2f of a mile", p.mile, d))
        } else {
            out.append("Mile \(p.mile)")
        }
        // A REFUSAL IS A REFUSAL IN BOTH CHANNELS. Speaking a pace the screen
        // deliberately does not print would hand it straight back to the one
        // reader who cannot see that it was withheld.
        if allowsPace, let s = p.paceSec {
            out.append("\(Units.formatPaceBare(secPerMile: s)) per \(unitWord)")
        }
        if let hr = p.hr { out.append("heart rate \(hr)") }
        if let e = p.elevFt {
            out.append(e >= 0 ? "\(e) feet up" : "\(abs(e)) feet down")
        }
        if let c = p.cadence { out.append("cadence \(c)") }
        // NOTHING ABOUT THE BAND, and nothing about the ramp either. The band
        // verdict left this component with its fill (see the header) and
        // speaking it here would hand VoiceOver a fact the screen no longer
        // makes. The ramp needs no spoken twin: it encodes the pace, and the
        // pace is already read out as a number.
        return out.joined(separator: ", ") + "."
    }
}

// MARK: - Building the pieces

extension MileBreakdownV5 {
    /// THE PACE COLUMN'S COLOUR, WHICH IS THE ROUTE LINE'S COLOUR.
    ///
    /// A thin `Color` wrapper over `RouteMapView.runPaceColorFn` so both
    /// callers spell the coupling the same way and neither is tempted to
    /// normalise for itself. Pass the SAME splits and phases the route card
    /// passes its map, which is what makes a given mile one colour on the
    /// screen instead of two.
    static func paceRamp(splits: [RunSplit], phases: [PhaseSample]) -> (Int) -> Color {
        let fn = RouteMapView.runPaceColorFn(splits: splits, phases: phases)
        return { Color(uiColor: fn(Double($0))) }
    }

    /// Splits → rows, with nothing invented.
    ///
    /// `totalMi` is the run's own distance, used ONLY to size a trailing piece
    /// the wire did not size itself — a run of 4.11 miles reporting five
    /// splits has a fifth that covers 0.11 of one, and older payloads carry no
    /// `distanceMi` to say so. Passing nil (a surface that does not know the
    /// total) means the last row makes no claim about its length, which is
    /// correct: unknown is not "whole".
    static func pieces(from splits: [RunSplit],
                       totalMi: Double? = nil) -> [MilePiece] {
        let ordered = splits.sorted { $0.mile < $1.mile }
        return ordered.enumerated().map { i, s in
            let derived: Double? = {
                if let d = s.distanceMi { return d }
                // Only the LAST split can be short, and only if we know how
                // long the run was. Everything else stays nil rather than
                // being asserted as a whole mile.
                guard i == ordered.count - 1, let total = totalMi, total > 0,
                      ordered.count > 1 else { return nil }
                let remainder = total - Double(ordered.count - 1)
                return (remainder > 0 && remainder < 0.95) ? remainder : nil
            }()
            return MilePiece(id: s.mile,
                             mile: s.mile,
                             paceSec: paceSeconds(s.pace),
                             hr: (s.hr ?? 0) > 0 ? s.hr : nil,
                             elevFt: s.elev_change_ft,
                             cadence: (s.cadence ?? 0) > 0 ? s.cadence : nil,
                             distanceMi: derived)
        }
    }

    /// "8:28" → 508. Nil for a missing or garbled pace, which then draws as an
    /// empty cell rather than a zero.
    static func paceSeconds(_ s: String?) -> Int? {
        guard let s, let colon = s.firstIndex(of: ":"),
              let mm = Int(s[s.startIndex..<colon]),
              let ss = Int(s[s.index(after: colon)...]) else { return nil }
        let total = mm * 60 + ss
        return total > 0 ? total : nil
    }
}
