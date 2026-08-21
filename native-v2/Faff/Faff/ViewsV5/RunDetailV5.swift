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

                    if !detail.splits.isEmpty { splitsSection }

                    if hasZoneData { zoneSection }

                    routeSection

                    if let shoe = wornShoe {
                        ListGroup(header: "Shoes worn") {
                            ListRow(label: shoe.displayName,
                                    sub: shoeMileageSub(shoe),
                                    onTap: onChangeShoe)
                        }
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

    private var splitsSection: some View {
        ListGroup(header: "Splits") {
            ForEach(detail.splits) { split in
                ListRow(label: "Mile \(split.mile)",
                        sub: splitSub(split),
                        value: .measured(split.pace.map { "\($0)/mi" }))
            }
        }
    }

    private func splitSub(_ s: RunSplit) -> String? {
        var parts: [String] = []
        if let hr = s.hr { parts.append("\(hr) bpm") }
        if let e = s.elev_change_ft, e != 0 { parts.append("\(e > 0 ? "+" : "")\(e) ft") }
        return parts.isEmpty ? nil : parts.joined(separator: " \u{00B7} ")
    }

    // MARK: - Zone bar

    private var hasZoneData: Bool {
        let z = detail.hrZonePcts
        return (z.z1 + z.z2 + z.z3 + z.z4 + z.z5) > 0
    }

    private var zoneSection: some View {
        Tile {
            Text("Where the heart sat")
                .font(.faffText(TypeScaleV5.label13))
                .foregroundStyle(V5.textSecondary)
            ZoneBar(shares: [detail.hrZonePcts.z1, detail.hrZonePcts.z2, detail.hrZonePcts.z3,
                             detail.hrZonePcts.z4, detail.hrZonePcts.z5],
                    target: nil, height: 44, labels: true)
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
                         hrZones: detail.hr_zones_from_lthr?.ranges ?? [])
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
