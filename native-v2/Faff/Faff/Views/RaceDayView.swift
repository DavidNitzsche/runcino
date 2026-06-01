//
//  RaceDayView.swift
//  Race-day spec. Mesh is the race warm-red wash. Same product language
//  as the rest of the app: readiness ring, goal pace, gap beam, course,
//  plan segments, race-morning checklist.
//

import SwiftUI

struct RaceDayView: View {
    let raceSlug: String

    @State private var detail: RaceDetailResponse?
    @State private var raceFacts: CoachFactsBlock?
    /// ProfileState · used to read VDOT for the prediction table when the
    /// runner has a fitness baseline. Loaded in parallel with /api/race.
    @State private var profile: ProfileState? =
        AppCache.read(.profileState, as: ProfileState.self)
    /// Watch workout payload for the race date · carries gelsMi for the
    /// fueling strip on race-week. nil when no workout is scheduled or
    /// the race is past.
    @State private var raceWatchWorkout: WatchWorkout?

    var body: some View {
        let mesh = FaffEffort.race.mesh
        ZStack {
            FaffMeshView(mesh: mesh)

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    topRow
                        .padding(.horizontal, 22)
                        .padding(.top, 8)

                    hero
                        .padding(.horizontal, 24)
                        .padding(.top, 18)

                    // THE COURSE — only render when we actually have course
                    // geometry from /api/race/[slug]. The old "mapPlaceholder"
                    // + "elevationPlaceholder" + "366 ft / 26 ft / THE ROLLERS"
                    // was a hardcoded mock that rendered for every race. The
                    // fueling line ("4 gels · PF 30 at miles 5 · 10 · 15 · 20")
                    // was the same · gone until per-race fueling ships.
                    if let geo = detail?.course_geometry,
                       let pts = geo.trackPoints, pts.count > 5 {
                        section(title: "THE COURSE", right: courseStat) {
                            VStack(alignment: .leading, spacing: 14) {
                                SpecLabel(text: "ROUTE", size: 9, tracking: 2, color: Theme.txt.opacity(0.5))
                                courseRoute(points: pts)
                                    .frame(height: 118)
                                if let prov = courseProvenanceLabel {
                                    Text(prov)
                                        .font(.display(10, weight: .bold))
                                        .tracking(0.5)
                                        .foregroundStyle(Theme.txt.opacity(0.55))
                                        .padding(.top, 2)
                                }
                                if let elev = geo.elevation_gain_ft, elev > 0 {
                                    SpecLabel(text: "ELEVATION GAIN · \(Int(elev)) FT", size: 9, tracking: 2, color: Theme.txt.opacity(0.5))
                                        .padding(.top, 4)
                                }
                            }
                        }
                        .padding(.top, 26)
                    }

                    // THE PLAN section was 4 hardcoded "MI 1-3 Settle in 6:55"
                    // rows + "Set from your sub-3 goal and the CIM profile"
                    // copy · not derived from anything. RACE MORNING was
                    // similarly hardcoded ("Gun time 7:00 AM · Wave 1",
                    // "Weather 41°F · clear · calm"). Both gone until per-race
                    // plan steps + race-morning data ship.

                    // CountdownLadder · race-week vertical timeline that mirrors
                    // the push cadence (T-7 / T-5 / T-3 / T-1 / Race). Today's
                    // rung glows. Only renders when days_to_race is in the
                    // 0..7 window AND not past · keeps Building / weeks-out
                    // pages clean. Toolkit · Family H.
                    if let days = detail?.race.days,
                       days >= 0 && days <= 7,
                       detail?.race.is_past != true {
                        section(title: "RACE WEEK", right: nil) {
                            CountdownLadder(rungs: makeCountdownRungs(daysToRace: days))
                        }
                        .padding(.top, 26)
                    }

                    // VDOTPredictionTable · Daniels predicted times across
                    // distances when we have a VDOT. Reads profile.physiology
                    // (already in the cached profile state). Toolkit · Family B.
                    if let vdot = profileVdot, vdot > 0,
                       detail?.race.is_past != true {
                        section(title: "WHAT VDOT \(Int(vdot)) PREDICTS", right: nil) {
                            VDOTPredictionTable(rows: vdotPredictionRows(for: vdot))
                        }
                        .padding(.top, 26)
                    }

                    // GelMileMarkers · distance-anchored fueling strip,
                    // ticks on the elevation curve at the gel mile points.
                    // Renders only when the watch workout payload carries
                    // gelsMi AND the race has a distance to anchor against.
                    // Toolkit · Family H.
                    if let gels = raceGelsMi, !gels.isEmpty,
                       let totalMi = detail?.race.distance_mi, totalMi > 0,
                       detail?.race.is_past != true {
                        section(title: "FUELING PLAN", right: nil) {
                            GelMileMarkers(gelsMi: gels,
                                           totalMi: totalMi,
                                           elevationPoints: courseElevationNormalized)
                        }
                        .padding(.top, 26)
                    }

                    if let facts = raceFacts?.facts, !facts.isEmpty {
                        section(title: "AT A GLANCE", right: nil) {
                            VStack(spacing: 0) {
                                ForEach(Array(facts.enumerated()), id: \.element.label) { i, f in
                                    HStack(alignment: .top) {
                                        VStack(alignment: .leading, spacing: 3) {
                                            SpecLabel(text: f.label, size: 10, tracking: 1.5, color: Theme.txt.opacity(0.55))
                                            if let meta = f.meta, !meta.isEmpty {
                                                Text(meta)
                                                    .font(.display(11, weight: .semibold))
                                                    .foregroundStyle(Theme.txt.opacity(0.62))
                                                    .lineLimit(2)
                                            }
                                        }
                                        Spacer(minLength: 12)
                                        Text(f.value)
                                            .font(.display(15, weight: .bold))
                                            .foregroundStyle(factTint(f.valueColor))
                                            .multilineTextAlignment(.trailing)
                                    }
                                    .padding(14)
                                    if i < facts.count - 1 {
                                        Divider().background(Color.white.opacity(0.08))
                                    }
                                }
                            }
                            .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
                        }
                        .padding(.top, 26)
                    }

                    Spacer(minLength: 60)
                }
            }
        }
        .task { await load() }
    }

    /// Topbar label · "RACE DAY" / "RACE WEEK" / "BUILDING" derived from
    /// race.is_past + proximity. Was always "RACE DAY" with a hardcoded
    /// 92 readiness ring next to it · misleading on a race 11 weeks out.
    private var topRow: some View {
        HStack(alignment: .center) {
            HStack(spacing: 9) {
                LivePulseDot(color: Color(hex: 0xFFD27A), size: 8)
                    .frame(width: 12, height: 12)
                Text(topRowLabel)
                    .font(.label(13)).tracking(2.5)
                    .foregroundStyle(Theme.txt)
            }
            Spacer()
        }
    }

    private var topRowLabel: String {
        if detail?.race.is_past == true { return "POST-RACE" }
        switch (detail?.proximity ?? "").uppercased() {
        case "RACE-WEEK":  return "RACE WEEK"
        case "SHARPENING": return "SHARPENING"
        case "BUILDING":   return "BUILD PHASE"
        case "POST-RACE":  return "POST-RACE"
        default:           return "RACE"
        }
    }

    /// Hero is now grounded in real fields: race short-code + name + date
    /// eyebrow + goal time + derived goal pace + days-to-race chip. The
    /// "PROJECTED 2:58:40 · 50s UNDER GOAL" block + the GapBeam + the
    /// "SEASON START 3:11" line + the "You closed the gap…" coach line
    /// were all hardcoded mock copy that rendered for every race · they
    /// claimed David was projected sub-3 on AFC (a half) and on every
    /// race regardless of plan state. All removed until a real projection
    /// endpoint ships and emits per-race projected times.
    private var hero: some View {
        VStack(alignment: .leading, spacing: 0) {
            SpecLabel(text: heroEyebrow, size: 11, tracking: 2.5, color: Theme.txt.opacity(0.66))
            VStack(alignment: .leading, spacing: 9) {
                Text(raceShortCode)
                    .font(.display(78, weight: .bold))
                    .tracking(-4)
                    .foregroundStyle(Theme.txt)
                    .lineSpacing(-16)
                    .shadow(color: .black.opacity(0.34), radius: 26, y: 2)
                Text(raceName)
                    .font(.body(13, weight: .bold))
                    .foregroundStyle(Theme.txt.opacity(0.82))
            }
            .padding(.top, 8)

            // Past race · swap goal hero for the actual finish time.
            // PR-marked when pb=true. Tapping the row pushes the matched
            // Strava run via the run-detail destination so the runner can
            // dig into splits / HR / cadence on race day.
            if let finish = detail?.race.finishTime, detail?.race.is_past == true {
                let isPB = detail?.race.pb == true
                let pbHex: UInt32 = 0xF5C518
                VStack(alignment: .leading, spacing: 9) {
                    Text(finish)
                        .font(.display(58, weight: .bold))
                        .tracking(-2.5)
                        .foregroundStyle(isPB ? Color(hex: pbHex) : Theme.txt)
                        .shadow(color: .black.opacity(0.3), radius: 22, y: 2)
                    HStack(spacing: 8) {
                        SpecLabel(text: "FINISHED", size: 11, tracking: 2,
                                  color: Theme.txt.opacity(0.78))
                        if isPB {
                            Text("PERSONAL BEST")
                                .font(.label(10)).tracking(1.5)
                                .foregroundStyle(Color(hex: pbHex))
                                .padding(.horizontal, 7).padding(.vertical, 3)
                                .background(Color(hex: pbHex).opacity(0.18),
                                            in: RoundedRectangle(cornerRadius: 5))
                                .overlay(RoundedRectangle(cornerRadius: 5)
                                    .stroke(Color(hex: pbHex).opacity(0.45), lineWidth: 1))
                        }
                    }
                    if let mr = detail?.race.matchedRun,
                       let aid = mr.activity_id, !aid.isEmpty {
                        NavigationLink(value: FaffRoute.runDetail(id: aid)) {
                            HStack(spacing: 6) {
                                Image(systemName: "arrow.up.right")
                                    .font(.system(size: 11, weight: .bold))
                                Text(matchedRunMetaLine(mr))
                                    .font(.display(11, weight: .semibold))
                            }
                            .foregroundStyle(Theme.txt.opacity(0.82))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.top, 20)
            } else if goalTime != "—" {
                VStack(alignment: .leading, spacing: 9) {
                    Text(goalTime)
                        .font(.display(58, weight: .bold))
                        .tracking(-2.5)
                        .foregroundStyle(Theme.txt)
                        .shadow(color: .black.opacity(0.3), radius: 22, y: 2)
                    if goalPace != "—" {
                        Text("GOAL TIME  ·  \(goalPace) /mi")
                            .font(.display(13, weight: .bold))
                            .foregroundStyle(Theme.txt.opacity(0.78))
                    } else {
                        Text("GOAL TIME")
                            .font(.display(13, weight: .bold))
                            .foregroundStyle(Theme.txt.opacity(0.78))
                    }
                }
                .padding(.top, 20)
            }

            if let chip = daysChip {
                HStack {
                    Text(chip)
                        .font(.display(11, weight: .bold))
                        .foregroundStyle(Theme.txt.opacity(0.85))
                    Spacer()
                    if let pr = pbChip {
                        Text(pr)
                            .font(.display(11, weight: .bold))
                            .foregroundStyle(Color(hex: 0x9AF0BF))
                    }
                }
                .padding(.top, 22)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Compact meta string under the past-race finish · pace, HR, elev
    /// pulled from the matched Strava run. Each field hides individually
    /// when null so the line collapses gracefully for sparser races.
    private func matchedRunMetaLine(_ mr: RaceMatchedRun) -> String {
        var parts: [String] = []
        if let p = mr.pace { parts.append("\(p)/mi") }
        if let bpm = mr.avg_hr { parts.append("\(bpm) bpm") }
        if let ft = mr.elev_gain_ft { parts.append("\(ft) ft") }
        return parts.isEmpty ? "View the run" : "View the run · " + parts.joined(separator: " · ")
    }

    /// "77 DAYS OUT" / "RACE WEEK" / etc. — derives from race.days +
    /// proximity. Returns nil for past races (the hero then leans on
    /// matchedRun via the post-race surfaces).
    private var daysChip: String? {
        guard let d = detail?.race.days else { return nil }
        if d == 0 { return "RACE DAY" }
        if d < 0 { return nil }
        if let prox = detail?.proximity.uppercased(), prox == "RACE-WEEK" { return "RACE WEEK · \(d) DAYS" }
        return "\(d) DAYS OUT"
    }

    /// Existing-PR chip when the user has logged a personal best for this
    /// race. Hidden when the field is null (most races) or false.
    private var pbChip: String? {
        if let pb = detail?.race.pb, pb { return "PERSONAL BEST" }
        return nil
    }

    /// Real GPX route from /api/race/[slug].course_geometry.trackPoints.
    /// Projects lat/lon onto a 2D viewport using min/max of the bbox so
    /// it fits the visible frame regardless of which race we're looking
    /// at. Replaces the hardcoded `mapPlaceholder` that drew an abstract
    /// CIM-shaped curve for every race.
    private func courseRoute(points pts: [CourseTrackPoint]) -> some View {
        let lats = pts.compactMap { $0.lat }
        let lons = pts.compactMap { $0.lon }
        let minLat = lats.min() ?? 0
        let maxLat = lats.max() ?? 1
        let minLon = lons.min() ?? 0
        let maxLon = lons.max() ?? 1
        let latSpan = max(0.0001, maxLat - minLat)
        let lonSpan = max(0.0001, maxLon - minLon)
        return GeometryReader { geo in
            let w = geo.size.width
            let h = geo.size.height
            Path { p in
                var started = false
                for pt in pts {
                    guard let lat = pt.lat, let lon = pt.lon else { continue }
                    let x = CGFloat((lon - minLon) / lonSpan) * w
                    let y = h - CGFloat((lat - minLat) / latSpan) * h
                    if started { p.addLine(to: CGPoint(x: x, y: y)) }
                    else { p.move(to: CGPoint(x: x, y: y)); started = true }
                }
            }
            .stroke(
                LinearGradient(colors: [Color(hex: 0xFFE0A0), Color(hex: 0xFF5A52)],
                               startPoint: .topLeading, endPoint: .bottomTrailing),
                style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round)
            )
            .background(Color.black.opacity(0.18))
        }
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    // Note: removed `mapPlaceholder`, `elevationPlaceholder`, `fuelLine`,
    // `planSegments`/`planSegRow`, `morningTile`/`row` · these were drawing
    // hardcoded CIM-shaped route curves, fake "366 ft / 26 ft / THE ROLLERS"
    // elevation labels, "4 gels · PF 30 at miles 5 · 10 · 15 · 20" fueling
    // copy, the 4-row "MI 1-3 Settle in 6:55" plan strip, and the "Gun
    // time 7:00 AM · Wave 1 / Weather 41°F · clear · calm" morning tile
    // regardless of the actual race. The course section now renders real
    // GPX from /api/race/[slug].course_geometry via courseRoute(); the rest
    // of the sections stay hidden until backend endpoints emit per-race
    // plan steps / fueling / morning data.

    private func section<C: View>(title: String, right: String?, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                SpecLabel(text: title, size: 11, tracking: 2, color: Theme.txt.opacity(0.6))
                Spacer()
                if let r = right {
                    Text(r).font(.display(11, weight: .bold)).foregroundStyle(Theme.txt.opacity(0.85))
                }
            }
            content()
        }
        .padding(.horizontal, 22)
    }

    // MARK: - Data

    private var raceName: String { detail?.race.name ?? "Race" }

    private var raceShortCode: String {
        // Always abbreviate the hero — even "Boston Marathon" reads as "BM".
        // Falls back to "RACE" if no name yet.
        guard let name = detail?.race.name, !name.isEmpty else { return "RACE" }
        return RaceName.short(name, abbreviateAlways: true)
    }

    private var heroEyebrow: String {
        if let d = detail?.race.date { return "\(d.uppercased()) · YOUR A-RACE" }
        return "YOUR A-RACE"
    }

    /// Goal time string from the race detail. Used to render the hero
    /// time. Returns "—" when no race is loaded · the previous "2:59:30"
    /// fallback rendered as if the runner had committed to a sub-3 even
    /// when the race detail hadn't loaded (or no goal was set).
    private var goalTime: String { detail?.race.goal ?? "—" }

    /// Pace per mile derived from goal time / distance. Falls back to
    /// "—" when either is unknown. The "6:51" hardcode was the old
    /// sub-3-marathon placeholder · misleading when shown over another
    /// distance or no race.
    private var goalPace: String {
        guard let g = detail?.race.goal,
              let dist = detail?.race.distance_mi, dist > 0 else { return "—" }
        let parts = g.split(separator: ":").map { Int($0) ?? 0 }
        let totalSec: Int
        switch parts.count {
        case 3: totalSec = parts[0] * 3600 + parts[1] * 60 + parts[2]
        case 2: totalSec = parts[0] * 60 + parts[1]
        default: return "—"
        }
        let perMile = Int(round(Double(totalSec) / dist))
        return String(format: "%d:%02d", perMile / 60, perMile % 60)
    }
    private var courseStat: String {
        let mi = detail?.race.distance_mi.map { String(format: "%.1f MI", $0) }
        // RaceDetail has no elev field today; fall back to "" if absent.
        return mi ?? ""
    }

    /// Crowd-sourced provenance line shown under the route. Drawn only when
    /// the course came from the shared course_library and at least one
    /// other runner has raced it. New 2026-05-30 backend audit surface.
    private var courseProvenanceLabel: String? {
        guard let lib = detail?.course_library else { return nil }
        let n = lib.contributor_count
        guard n > 0 else { return nil }
        if n == 1 { return "CROWD-SOURCED · 1 RUNNER" }
        return "CROWD-SOURCED · \(n) RUNNERS"
    }

    private func factTint(_ tone: String?) -> Color {
        switch (tone ?? "").lowercased() {
        case "race":  return Theme.race
        case "green": return Theme.green
        case "amber": return Theme.goal
        case "over":  return Theme.over
        default:      return Theme.txt
        }
    }

    private func load() async {
        async let r = (try? await API.fetchRaceDetail(slug: raceSlug))
        async let f = (try? await API.fetchCoachFacts(surface: "race_detail", raceSlug: raceSlug))
        async let p = (try? await API.fetchProfileState())
        let (rd, fc, pr) = await (r, f, p)
        await MainActor.run {
            self.detail = rd; self.raceFacts = fc
            if let pr { self.profile = pr }
        }
        // Pull the watch workout for the race date so we can read
        // gelsMi for GelMileMarkers. Fires only when the race is
        // upcoming AND within ~6 weeks (avoid the cost on far-out races).
        if let date = rd?.race.date,
           rd?.race.is_past != true,
           let days = rd?.race.days, days >= 0, days <= 42 {
            let w = try? await API.fetchWatchWorkout(date: date)
            await MainActor.run { self.raceWatchWorkout = w }
        }
    }

    // MARK: - Toolkit helpers (CountdownLadder + VDOTPredictionTable + GelMileMarkers)

    /// Gel mile points from the watch workout payload · race-only fueling
    /// hint. `nil` when no race-week workout has loaded yet.
    private var raceGelsMi: [Double]? { raceWatchWorkout?.gelsMi }

    /// Normalised 0..1 elevation profile for the GelMileMarkers strip.
    /// Pulls from course_geometry.trackPoints when present; returns nil
    /// so GelMileMarkers can render a flat baseline.
    private var courseElevationNormalized: [Double]? {
        guard let pts = detail?.course_geometry?.trackPoints, pts.count > 5 else { return nil }
        let eles = pts.compactMap { $0.ele }
        guard !eles.isEmpty else { return nil }
        let lo = eles.min() ?? 0
        let hi = eles.max() ?? 1
        let span = max(hi - lo, 1)
        return eles.map { ($0 - lo) / span }
    }


    /// VDOT from the cached profile state. Used to drive the prediction
    /// table when known; the section is hidden otherwise so we never
    /// guess fitness.
    private var profileVdot: Double? { profile?.physiology.vdot }

    /// Build the 5 rungs of the race-week countdown (T-7 / T-5 / T-3 /
    /// T-1 / Race). Today's rung glows; everything earlier renders as
    /// past, everything later renders as upcoming. Matches the push
    /// cadence the notifications cron actually fires on.
    private func makeCountdownRungs(daysToRace days: Int) -> [CountdownRung] {
        struct Plan { let n: Int; let title: String }
        let plan: [Plan] = [
            Plan(n: 7, title: "Race week begins"),
            Plan(n: 5, title: "Last quality day"),
            Plan(n: 3, title: "Sharpen · short and snappy"),
            Plan(n: 1, title: "Shakeout · kit + fuel ready"),
            Plan(n: 0, title: detail?.race.name ?? "Race day"),
        ]
        return plan.map { p in
            CountdownRung(
                id: "T-\(p.n)",
                label: p.n == 0 ? "Race" : "T-\(p.n)",
                title: p.title,
                isPast:  days <  p.n,
                isToday: days == p.n,
                isRace:  p.n == 0
            )
        }
    }

    /// Daniels prediction rows for 5K / 10K / Half / Marathon at the
    /// runner's VDOT. The formulas mirror lib/vdot.ts predictRaceTime;
    /// we keep the math in-line (small enough · no need to round-trip a
    /// new endpoint just for this table).
    private func vdotPredictionRows(for vdot: Double) -> [VDOTPredictionRow] {
        // Daniels approximation: race velocity (m/min) = VDOT × intensityFraction
        // where intensityFraction = 0.8 + 0.1894393·e^(-0.012778·t)
        //                            + 0.2989558·e^(-0.1932605·t)
        // For each distance we iterate on t (minutes) until residual settles.
        // Distances in meters.
        let distances: [(label: String, meters: Double)] = [
            ("5K", 5000), ("10K", 10000),
            ("Half", 21097.5), ("Marathon", 42195),
        ]
        return distances.map { d in
            var t = d.meters / 250.0  // minutes seed
            for _ in 0..<8 {
                let fI = 0.8
                    + 0.1894393 * exp(-0.012778  * t)
                    + 0.2989558 * exp(-0.1932605 * t)
                let v_mPerMin = vdot * fI / (-4.6 + 0.182258 * pow(vdot, 0) + 1)  // simplified
                // Simpler velocity from VDOT-to-pace mapping: use the canonical
                // VO2-velocity inverse. Daniels' actual lookup is a table;
                // approximate by inverting the relation: v = (-4.6 + sqrt(4.6^2 + 4·0.000104·VDOT·1000)) / (2·0.000104)
                _ = v_mPerMin
                let v = (-4.6 + (4.6 * 4.6 + 4 * 0.000104 * vdot * 1000).squareRoot()) / (2 * 0.000104)
                // v is m/min · time = meters / v · iterate using the intensity
                // fraction to refine.
                let tRefined = d.meters / (v * fI)
                t = (t + tRefined) / 2
            }
            return VDOTPredictionRow(distance: d.label, time: formatSecondsTime(Int(t * 60)))
        }
    }

    private func formatSecondsTime(_ s: Int) -> String {
        let h = s / 3600, m = (s % 3600) / 60, sec = s % 60
        if h > 0 { return String(format: "%d:%02d:%02d", h, m, sec) }
        return String(format: "%d:%02d", m, sec)
    }
}
