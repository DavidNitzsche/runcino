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

                VStack(alignment: .leading, spacing: V5.S.s24) {
                    statsRow

                    if !readingRows.isEmpty {
                        ListGroup(header: "Reading") {
                            ForEach(readingRows, id: \.0) { row in
                                ListRow(label: row.0, value: row.1)
                            }
                        }
                    }

                    if !splitBars.isEmpty { splitsSection }

                    if hasZoneData { zoneSection }

                    routeSection

                    if let shoe = wornShoe {
                        ListGroup(header: "Shoes worn") {
                            ListRow(label: shoe.displayName,
                                    sub: shoeMileageSub(shoe),
                                    onTap: onChangeShoe)
                        }
                    }

                    // EVIDENCE BEFORE JUDGEMENT. 8a's rule, which applies
                    // to 8b for the same reason: a verdict that arrives
                    // before its evidence reads as a mood. The decisions are
                    // the runner's own, so they sit above the coach's line,
                    // never under it.
                    if !resolvedDecisions.isEmpty {
                        WristDecisionsV5(decisions: resolvedDecisions)
                    }

                    if let recap, !recap.verdict.isEmpty {
                        CoachSay(text: recap.verdict, size: .md)
                    }
                    if let tip = recap?.coach_tip, !tip.isEmpty {
                        CoachCaveat(text: tip)
                    }
                }
                .padding(.horizontal, V5.S.gutter)
                .padding(.bottom, V5.S.s32)
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

    private var title: String {
        if let name = detail.name?.trimmingCharacters(in: .whitespacesAndNewlines),
           !name.isEmpty, !Self.genericNames.contains(name.lowercased()) {
            return name
        }
        if let type = detail.type, !type.isEmpty {
            return type.prefix(1).uppercased() + type.dropFirst()
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
        f.dateFormat = "EEEE d MMMM"
        f.timeZone = TimeZone(identifier: "UTC")
        return f
    }()

    // MARK: - Stats row · Distance / Time / Pace, same poster the after-run
    // screen reads (5b's `done.distance` / `done.time` / `done.pace`).

    private var statsRow: some View {
        HStack(alignment: .firstTextBaseline, spacing: V5.S.s12) {
            stat("Distance", .measured(FaffFmt.milesUnit(detail.distance_mi)))
            stat("Time", .measured(detail.time_moving ?? detail.time_elapsed))
            stat("Pace", .measured(detail.pace.map { "\($0)/mi" }))
        }
        .padding(V5.S.tilePad)
        .background(V5.materialTile, in: RoundedRectangle(cornerRadius: V5.R.r22, style: .continuous))
    }

    private func stat(_ label: String, _ value: FaffValue) -> some View {
        VStack(alignment: .leading, spacing: V5.S.s6) {
            Text(label)
                .font(.faffText(TypeScaleV5.label12))
                .foregroundStyle(V5.textQuiet)
            FaffValueText(value, font: .faffText(20, weight: .semibold), color: V5.textPrimary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Reading · avg/max HR, cadence, temperature — whatever the run
    // actually carries. Each one only appears when `RunDetail` has it; there
    // is no invented row for a field the source did not populate.

    private var readingRows: [(String, FaffValue)] {
        var out: [(String, FaffValue)] = []
        if let hr = detail.hr_avg { out.append(("Heart rate, avg", .measured("\(hr) bpm"))) }
        if let hrMax = detail.hr_max { out.append(("Heart rate, max", .measured("\(hrMax) bpm"))) }
        if let cad = detail.cadence_avg { out.append(("Cadence", .measured("\(cad) spm"))) }
        // RULE ONE. Nothing on the phone or the watch has a thermometer in it.
        // A run's temperature is a weather read for a grid square and an hour
        // bucket — `lib/weather/openmeteo.ts` fetches it from the forecast API
        // for a recent run and the reanalysis archive for an old one, and the
        // `apple_hk` path is Apple Weather, which is another model. The wire
        // carries no source with it (`RunDetail.temp_f` is a bare Double), so
        // by the type's own rule — if a screen cannot tell, the answer is
        // modelled — this is modelled. Same shape as the race-morning forecast
        // that shipped as a hard read.
        if let temp = detail.temp_f { out.append(("Temperature", .modelled("\(Int(temp.rounded()))\u{00B0}F"))) }
        return out
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
    private var splitBand: (lo: Int, hi: Int)? {
        guard let spec = detail.planned_spec,
              let lo = spec.pace_target_s_per_mi_lo,
              let hi = spec.pace_target_s_per_mi_hi,
              hi >= lo else { return nil }
        return (Int(lo.rounded()), Int(hi.rounded()))
    }

    private var splitBars: [SplitBar] {
        let band = splitBand
        let parsed: [(Int, Int)] = detail.splits.compactMap { s in
            guard let sec = Self.paceSeconds(s.pace) else { return nil }
            return (s.mile, sec)
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
            SplitBar(mile: p.0,
                     paceSec: p.1,
                     fraction: i == parsed.count - 1 ? tail : 1,
                     inBand: band.map { p.1 >= $0.lo && p.1 <= $0.hi })
        }
    }

    private static func paceSeconds(_ s: String?) -> Int? {
        guard let s, !s.isEmpty else { return nil }
        let parts = s.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2, parts[1] >= 0, parts[1] < 60 else { return nil }
        return parts[0] * 60 + parts[1]
    }

    private var splitsSection: some View {
        VStack(alignment: .leading, spacing: V5.S.s10) {
            V5SectionLabel(text: "Splits").padding(.horizontal, V5.S.s4)
            SplitBars(bars: splitBars)
                .padding(.top, 18)
                .padding(.horizontal, V5.S.s12)
                .padding(.bottom, V5.S.s8)
                .background(V5.materialTile,
                            in: RoundedRectangle(cornerRadius: V5.R.r22, style: .continuous))
            if splitBand != nil {
                // The chart's one colour rule, said once in words. Without it
                // the grey bars are a code the screen never breaks.
                Text("Filled where the mile sat inside what the session asked for.")
                    .font(.faffText(TypeScaleV5.label13))
                    .foregroundStyle(V5.textQuiet)
                    .padding(.horizontal, V5.S.s4)
            }
        }
    }

    // MARK: - Zone bar

    private var hasZoneData: Bool {
        let z = detail.hrZonePcts
        return (z.z1 + z.z2 + z.z3 + z.z4 + z.z5) > 0
    }

    /// The zone the session ASKED for, mirroring `lib/coach/zone-target.ts`
    /// (ACSM five-zone table, `Research/03` §4) — which is the same mapping
    /// `V5Today.zoneTarget` already hands the after-run screen. 23a reads no
    /// such field, so it derives the target from the run's own type rather
    /// than leaving the graphic mute.
    ///
    /// ─────────────────────────────────────────────────────────────────────
    /// THE ONE CASE THAT STAYS NIL, AND WHY IT IS ONLY ONE
    ///
    /// Round three says the target "comes from the session's own prescription"
    /// and that "a race targets Z4/Z5". `zoneTargetForWorkout` maps race to
    /// zone 3, off §4's own Purpose column, with a doctrine claim watching it.
    /// A design ruling does not move a physiological constant, so the constant
    /// stands — but drawing Z3 on a race would put the design's own screen at
    /// odds with the ruling that commissioned it, so a race highlights nothing
    /// and the bar states the distribution without answering.
    ///
    /// This screen previously passed nil for EVERY run for that reason, which
    /// was the wrong size of retreat: the two sources disagree on races alone.
    /// On an easy, long, threshold or interval run they name the same zone, so
    /// there was never a conflict to dodge — and a bar with nothing highlighted
    /// cannot answer "did it sit where it was asked to", which is the only
    /// question it exists for.
    private var zoneTarget: Int? {
        switch (detail.type ?? "").lowercased() {
        case "easy", "recovery", "shakeout", "long":  return 2
        case "tempo", "progression", "mp":            return 3
        case "threshold", "fartlek":                  return 4
        case "intervals", "vo2max":                   return 5
        // Race: see above. Rest and anything unrecognised: nothing was asked.
        default:                                       return nil
        }
    }

    private var zoneSection: some View {
        Tile {
            Text("Where the heart sat")
                .font(.faffText(TypeScaleV5.label13))
                .foregroundStyle(V5.textSecondary)
            ZoneBar(shares: [detail.hrZonePcts.z1, detail.hrZonePcts.z2, detail.hrZonePcts.z3,
                             detail.hrZonePcts.z4, detail.hrZonePcts.z5],
                    target: zoneTarget, height: 44, labels: true)
        }
    }

    // MARK: - Route · the real map, not a redrawn one
    //
    // `RouteMapView` colors by pace or by HR zone depending on the run's own
    // effort + zone data (see its header) — `mappedEffort` below only picks
    // which AXIS that coloring runs on, the same choice `RunDetail.type`
    // already drives everywhere else in the app. It changes no number on
    // screen.

    private var routeSection: some View {
        Tile {
            HStack(alignment: .firstTextBaseline) {
                Text("Route")
                    .font(.faffText(TypeScaleV5.label13))
                    .foregroundStyle(V5.textSecondary)
                Spacer(minLength: 0)
                if let ft = detail.elev_gain_ft, ft > 0 {
                    HStack(spacing: 4) {
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
                         hrZones: detail.hr_zones_from_lthr?.ranges ?? [],
                         // THE SAME BAND THE SPLIT CHART USES. That is the
                         // whole point of round three item 4 — the grey
                         // stretch on the map and the grey bar in the chart
                         // must be the same mile, or the two graphics compete
                         // instead of answering each other.
                         paceBand: splitBand)
                .frame(height: 200)
                .clipShape(RoundedRectangle(cornerRadius: V5.R.r16, style: .continuous))
                // Purely visual: MapKit hit-tests its region even when
                // non-interactive, which otherwise hijacks the parent
                // ScrollView's vertical pan (same fix `RoutePolylineCard`
                // already carries).
                .allowsHitTesting(false)
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

    private static let outdoorJSON = """
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
      "shoe_id": 12,
      "shoes": [
        { "id": 12, "brand": "Saucony", "model": "Endorphin Speed 4", "color": null,
          "color2": null, "run_types": ["easy"], "mileage": 214, "mileage_cap": null,
          "shoe_type": "daily_trainer", "retire_at_mi": 450, "retired": false,
          "preferred": true, "notes": null }
      ]
    }
    """

    private static let treadmillJSON = """
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
      "shoes": []
    }
    """

    private static let recapJSON = """
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
      "intervals_adjusted_target_s_per_mi": null
    }
    """
}
