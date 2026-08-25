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
//  No colour carries meaning here. Pace is not tinted by whether it sat in a
//  window, heart rate is not tinted by zone, a climb is not tinted by
//  gradient. The split chart above already answers "was this mile inside what
//  was asked" with its fill, and the coach's verdict — which holds the heat,
//  the terrain and the taper context this table does not — answers the rest.
//  A table that graded every mile in isolation would be arguing with both.
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

    /// Did this mile sit inside the pace window the session asked for?
    ///
    /// NIL WHEN NOTHING WAS ASKED, and that is the common case — an unplanned
    /// run has no window, and a session with a rep pace has no single one.
    /// Then the pace column carries no verdict at all.
    ///
    /// THIS IS THE ONE THING COLOUR MEANS IN THIS TABLE. It is inherited, not
    /// invented: the split chart this replaces used its bar fill for exactly
    /// this and nothing else, and its own screen printed the rule underneath
    /// ("filled where the mile sat inside what the session asked for"), which
    /// is the proof the colour was load-bearing rather than decorative. The
    /// fill comes from `SplitBars.barFill` rather than being restated here, so
    /// `V5ContrastTests` still measures the colour that actually ships.
    let inBand: Bool?

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


    /// The colour rule, said once in words, when there is a rule to say.
    ///
    /// Carried over from the chart this replaces for the reason its own
    /// comment gave: without it the fill is a code the screen never breaks.
    /// Nil when the session asked for no window, because then there is no
    /// code — every pace draws the same and a sentence about colour would be
    /// describing something that is not happening.
    var bandLine: String? = nil

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
                if let bandLine {
                    Text(bandLine)
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
        .padding(.horizontal, 14)
        .padding(.bottom, V5.S.s6)
        .accessibilityHidden(true)
    }

    private func row(_ p: MilePiece) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: V5.S.s12) {
            VStack(alignment: .leading, spacing: 2) {
                Text("\(p.mile)")
                    .font(.faffText(TypeScaleV5.body17))
                    .foregroundStyle(V5.textPrimary)
                // Only when we were told. See `isPartial`.
                if p.isPartial, let d = p.distanceMi {
                    // In miles, for the same reason the header says MILE: this
                    // is a mile-cut piece, so its length is a fraction of a
                    // mile. "0.18 km" would describe it in a unit it was never
                    // measured in.
                    Text(String(format: "%.2f mi", d))
                        .font(.faffText(TypeScaleV5.label12))
                        .foregroundStyle(V5.textQuiet)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            // THE PACE COLUMN IS THE ONLY ONE THAT CAN CARRY A VERDICT, and
            // only when the session asked for something.
            //
            // `barFill(inBand:)` returns SIGNAL for nil, which is right on the
            // chart it comes from — an orange bar among orange bars is
            // neutral — and wrong here. A column of orange numbers reads as a
            // column of highlighted numbers, so a run with no pace window
            // would look graded when nothing was asked of it. Nil takes plain
            // ink; the shared fill is consulted only when there is a window,
            // which keeps `V5ContrastTests` measuring the colour that ships.
            if allowsPace {
                cell(p.paceSec.map { Units.formatPaceBare(secPerMile: $0) },
                     color: p.inBand == nil ? V5.textPrimary
                                            : SplitBars.barFill(inBand: p.inBand))
            }
            if showsHr { cell(p.hr.map { "\($0)" }) }
            if showsElev { cell(p.elevFt.map { $0 > 0 ? "+\($0)" : "\($0)" }) }
            if showsCadence { cell(p.cadence.map { "\($0)" }) }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
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
        // The colour, in words. A sighted reader gets it from the fill; this
        // is the same fact, not an extra one.
        switch p.inBand {
        case .some(true):  out.append("inside the target")
        case .some(false): out.append("outside the target")
        case .none:        break
        }
        return out.joined(separator: ", ") + "."
    }
}

// MARK: - Building the pieces

extension MileBreakdownV5 {
    /// Splits → rows, with nothing invented.
    ///
    /// `totalMi` is the run's own distance, used ONLY to size a trailing piece
    /// the wire did not size itself — a run of 4.11 miles reporting five
    /// splits has a fifth that covers 0.11 of one, and older payloads carry no
    /// `distanceMi` to say so. Passing nil (a surface that does not know the
    /// total) means the last row makes no claim about its length, which is
    /// correct: unknown is not "whole".
    static func pieces(from splits: [RunSplit],
                       totalMi: Double? = nil,
                       band: (lo: Int, hi: Int)? = nil) -> [MilePiece] {
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
            let sec = paceSeconds(s.pace)
            // ONE VERDICT IN BOTH DIRECTIONS, inherited from the chart: a mile
            // run fast and a mile run slow are both "not what was asked", and
            // giving fast its own colour would grade it good.
            let inBand: Bool? = {
                guard let band, let sec else { return nil }
                return sec >= band.lo && sec <= band.hi
            }()
            return MilePiece(id: s.mile,
                             mile: s.mile,
                             paceSec: sec,
                             hr: (s.hr ?? 0) > 0 ? s.hr : nil,
                             elevFt: s.elev_change_ft,
                             cadence: (s.cadence ?? 0) > 0 ? s.cadence : nil,
                             distanceMi: derived,
                             inBand: inBand)
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
