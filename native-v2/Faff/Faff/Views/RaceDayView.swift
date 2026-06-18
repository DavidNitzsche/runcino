//
//  RaceDayView.swift
//  Race-day spec. Mesh is the race warm-red wash. Same product language
//  as the rest of the app: readiness ring, goal pace, gap beam, course,
//  plan segments, race-morning checklist.
//

import SwiftUI
import CoreLocation

struct RaceDayView: View {
    let raceSlug: String

    @Environment(\.dismiss) private var dismiss

    @State private var detail: RaceDetailResponse?
    @State private var raceFacts: CoachFactsBlock?
    @State private var projection: ProjectionSummary?
    /// GPX file-picker toggle · drives the .fileImporter sheet under the
    /// CourseAnnotations.stub upload affordance.
    @State private var showGpxPicker: Bool = false
    /// Banner shown after a successful GPX upload · reloads the detail
    /// in the background so the new course geometry pops in.
    @State private var gpxUploadStatus: String?
    /// Race-edit sheet toggle · the pencil in the header pill opens
    /// RaceEditSheet prefilled from the loaded detail (race P1). On save
    /// the detail + projection reload so distance / date / goal changes pop.
    @State private var showEditSheet: Bool = false
    /// Composed race-morning brief from /api/race/[slug]/execution-plan
    /// (race P2) · per-mile splits, B-goal trigger, heat tree, warm-up
    /// timeline. nil before load, or when the server 404s (no goal set).
    @State private var execPlan: RaceExecutionPlan?
    /// Post-race retro sheet toggle (race P5) · opens RaceRetroSheet for a
    /// PAST race so the runner can log their finish time + how it went.
    @State private var showRetroSheet: Bool = false

    var body: some View {
        ZStack {
            FaffMeshView(mesh: .neutral)

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    // Header-pill clearance (bar 50 + pill 84), matching the tabs.
                    Color.clear.frame(height: 132)

                    // Countdown · the big type. Grows in urgency toward race
                    // day, becomes the finish time once the race is run.
                    Text(countdownHeadline)
                        .font(.heroDisplay(88))
                        .tracking(-2)
                        .foregroundStyle(countdownColor)
                        .minimumScaleFactor(0.5)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 24)
                        .padding(.top, 6)
                    if let sub = countdownSub {
                        Text(sub)
                            .font(.body(13, weight: .bold))
                            .foregroundStyle(Theme.txt.opacity(0.7))
                            .padding(.horizontal, 24)
                            .padding(.top, 2)
                    }

                    // THE COURSE — the route is the most visually important
                    // thing on this page, so it LEADS, right under the countdown.
                    // Dark CartoDB-tile map (the same RouteMapView as the post-run
                    // route), not the old flat path render. David 2026-06-17.
                    if let geo = detail?.course_geometry,
                       let pts = geo.trackPoints, pts.count > 5 {
                        let coords = pts.compactMap { p -> CLLocationCoordinate2D? in
                            guard let lat = p.lat, let lon = p.lon else { return nil }
                            return CLLocationCoordinate2D(latitude: lat, longitude: lon)
                        }
                        section(title: "THE COURSE", right: courseStat) {
                            VStack(alignment: .leading, spacing: 12) {
                                // No run splits/HR for a not-yet-run course →
                                // RouteMapView draws the clean route line on the
                                // CartoDB dark tiles + start/finish dots.
                                RouteMapView(coords: coords, splits: [])
                                    .frame(height: 200)
                                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                                    .allowsHitTesting(false)
                                // Elevation moved up to the header (next to the
                                // distance). Only a real crowd (≥2 runners) leaves
                                // anything under the map — usually nothing.
                                if let prov = courseProvenanceLabel {
                                    HStack {
                                        Text(prov)
                                            .font(.body(10, weight: .bold)).tracking(0.5)
                                            .foregroundStyle(Theme.txt.opacity(0.5))
                                        Spacer()
                                    }
                                }
                            }
                        }
                        .padding(.top, 24)
                    } else if detail?.race.is_past != true {
                        // No course geometry yet · let the runner upload a GPX.
                        section(title: "THE COURSE", right: nil) {
                            CourseAnnotations(variant: .stub(onUpload: { showGpxPicker = true }))
                        }
                        .padding(.top, 24)
                    }

                    // ELEVATION — the course terrain, right under the route and
                    // above the plan, so "how hard is this course" reads before
                    // "how to run it". Plotted by true cumulative distance; the
                    // start → finish drop is the section's right label. Shows
                    // whenever the course has elevation data (David 2026-06-17).
                    if let geo = detail?.course_geometry,
                       let pts = geo.trackPoints,
                       pts.count > 5,
                       pts.contains(where: { $0.ele != nil }) {
                        section(title: "ELEVATION",
                                right: CourseElevationProfile.startFinishLabel(pts)) {
                            CourseElevationProfile(trackPoints: pts,
                                                   distanceMi: detail?.race.distance_mi ?? 0)
                        }
                        .padding(.top, 30)
                    }

                    // 1 · THE PLAN — how to run it, stretch by stretch.
                    // Prefer the backend's course-aware named segments
                    // (pacing.phases · "Point Loma Climb · 6:58/mi", grade-
                    // weighted over the authored course). Fall back to the
                    // local generic negative-split block ONLY when the server
                    // has no course geometry to phase against (phases empty).
                    if detail?.race.is_past != true {
                        if let phases = coursePhases, !phases.isEmpty {
                            section(title: "THE PLAN", right: planRightLabel) {
                                coursePhasesCard(phases)
                            }
                            .padding(.top, 30)
                        } else if !planPhases.isEmpty {
                            section(title: "THE PLAN", right: planRightLabel) {
                                planPhasesCard
                            }
                            .padding(.top, 30)
                        }
                    }

                    // 1b · THE BRIEF — the race-morning execution brief from
                    // /api/race/[slug]/execution-plan. THE PLAN above is now the
                    // single, merged pace table (terrain + negative-split arc),
                    // so the redundant per-mile SPLITS card is dropped (David
                    // 2026-06-17 · "what do I actually follow"). The conflict-free
                    // parts of the brief — B-goal trigger / heat / warm-up — still
                    // render inside a sensible proximity window so it's not a wall
                    // of numbers months out.
                    if showMorningBrief, let plan = execPlan {
                        // IF IT GOES SIDEWAYS — the objective B-goal trigger.
                        if let trigger = plan.bGoalTriggers.first {
                            section(title: "IF IT GOES SIDEWAYS", right: nil) {
                                bGoalTriggerCard(trigger)
                            }
                            .padding(.top, 30)
                        }

                        // HEAT decision-tree removed (David 2026-06-17): a generic
                        // "if 75°F add 19s · consider the B plan" table is
                        // premature and plants doubt months out. The smart move is
                        // to pull the ACTUAL race-week forecast and give one
                        // concrete adjustment — a forecast-driven note, future work.

                        // WARM-UP — the gun-anchored timeline.
                        if !plan.warmup.isEmpty {
                            section(title: "WARM-UP", right: warmupRightLabel) {
                                warmupCard(plan.warmup)
                            }
                            .padding(.top, 30)
                        }
                    }

                    // (THE COURSE moved to the top, under the countdown — the
                    // route is the page's hero. See above.)

                    // 3 · FUELING — the real backend recommendation (race P5).
                    // Reads the top-level `fueling` block: target rate, servings
                    // to carry, the product, and the per-mile intake schedule.
                    // When isDefault the runner hasn't entered their fuel, so we
                    // show the sensible default plan with a prompt to enter their
                    // own. recommendedServings 0 = a sub-50-min race that needs no
                    // on-course fuel; we skip the section rather than show "0 gels".
                    if let fuel = detail?.fueling,
                       fuel.recommendedServings > 0,
                       detail?.race.is_past != true {
                        section(title: "FUELING", right: fuelingRightLabel(fuel)) {
                            fuelingPlanCard(fuel)
                        }
                        .padding(.top, 30)
                    }

                    // 4 · RACE WEEK — the final-7-days ladder, mirrors the push
                    // cadence (T-7 / T-5 / T-3 / T-1 / Race). Only in the window.
                    if let days = detail?.race.days,
                       days >= 0 && days <= 7,
                       detail?.race.is_past != true {
                        section(title: "RACE WEEK", right: nil) {
                            CountdownLadder(rungs: makeCountdownRungs(daysToRace: days))
                        }
                        .padding(.top, 30)
                    }

                    // 5 · THE DETAILS — the practical race-day facts, each
                    // editable INLINE (tap a row, no full sheet). Start, corral,
                    // bib, where, parking, shuttle, packet pickup, website,
                    // notes. On race morning you want them in one place, not
                    // buried in settings (David 2026-06-17). Auto-fill from the
                    // race site lands in phase 2.
                    if let d = detail, d.race.is_past != true {
                        section(title: "THE DETAILS", right: nil) {
                            RaceDetailsCard(
                                race: d.race,
                                slug: raceSlug,
                                onSaved: { Task { await load() } }
                            )
                        }
                        .padding(.top, 30)
                    }

                    // Past race · jump into the matched run for full splits/HR.
                    if detail?.race.is_past == true,
                       let mr = detail?.race.matchedRun,
                       let aid = mr.activity_id, !aid.isEmpty {
                        section(title: "THE RUN", right: nil) {
                            NavigationLink(value: FaffRoute.runDetail(id: aid)) {
                                HStack(spacing: 8) {
                                    Image(systemName: "arrow.up.right")
                                        .font(.system(size: 12, weight: .bold))
                                    Text(matchedRunMetaLine(mr))
                                        .font(.body(13, weight: .semibold))
                                    Spacer()
                                }
                                .foregroundStyle(Theme.txt.opacity(0.85))
                                .padding(14)
                                .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
                            }
                            .buttonStyle(.plain)
                        }
                        .padding(.top, 30)
                    }

                    // Past race · the retrospective. Today the page only SHOWS
                    // the finish + PB chip with no way to enter the result or
                    // reflect on it (race P5). This surfaces a log-it / how-it-
                    // went affordance: the finish time → POST /api/race/result
                    // (authoritative chip time, fires the recalc + next plan),
                    // and felt / execution / notes → PATCH /api/race.
                    if detail?.race.is_past == true {
                        section(title: "THE RETRO", right: nil) {
                            retroCard
                        }
                        .padding(.top, 30)
                    }

                    Spacer(minLength: 80)
                }
            }
            .faffHeaderDissolve(clearTo: 56, opaqueAt: 80)
        }
        // Shared frosted header pill · race + goal summary, in the slot the
        // tabs use. The countdown owns the days, so the pill drops "days out".
        .faffHeaderPill { racePill }
        .task { await load() }
        .fileImporter(isPresented: $showGpxPicker,
                      allowedContentTypes: [.xml, .data],
                      allowsMultipleSelection: false) { result in
            handleGpxPick(result)
        }
        .sheet(isPresented: $showEditSheet) {
            RaceEditSheet(
                slug: raceSlug,
                seedName: detail?.race.name,
                seedDate: detail?.race.date,
                seedDistanceLabel: detail?.race.distance_label,
                seedPriority: detail?.race.priority,
                seedGoal: detail?.race.goal,
                seedWave: detail?.race.wave,
                seedStartTime: detail?.race.gun_time,
                seedLocation: detail?.race.location,
                onSaved: {
                    // Reload detail + projection · the server already ran the
                    // auto-rebuild + VDOT/LTHR recalc, so a fresh GET reflects
                    // the new distance / date / goal and the re-paced splits.
                    Task { await load() }
                }
            )
            .presentationDetents([.large])
        }
        .sheet(isPresented: $showRetroSheet) {
            RaceRetroSheet(
                slug: raceSlug,
                raceName: detail?.race.name ?? "Race",
                seedFinish: detail?.race.finishTime,
                onSaved: {
                    // The result POST fires a fresh projection + VDOT recalc
                    // and the next-race plan server-side, so reload to pull
                    // the locked finish + PB state.
                    Task { await load() }
                }
            )
            .presentationDetents([.large])
        }
        .overlay(alignment: .top) {
            if let msg = gpxUploadStatus {
                Text(msg)
                    .font(.body(12, weight: .extraBold))
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(Theme.Glass.fill, in: Capsule())
                    .overlay(Capsule().stroke(Theme.Accent.mintReady.opacity(0.40), lineWidth: 1))
                    .foregroundStyle(Theme.Accent.mintReady)
                    .padding(.top, 10)
                    .transition(.opacity)
            }
        }
    }

    private func handleGpxPick(_ result: Result<[URL], Error>) {
        switch result {
        case .success(let urls):
            guard let url = urls.first else { return }
            Task {
                // Security-scoped access for files-app URLs.
                let gained = url.startAccessingSecurityScopedResource()
                defer { if gained { url.stopAccessingSecurityScopedResource() } }
                guard let data = try? Data(contentsOf: url) else {
                    await MainActor.run { gpxUploadStatus = "Couldn't read that file." }
                    return
                }
                let ok = (try? await API.uploadRaceGPX(slug: raceSlug,
                                                       gpxData: data,
                                                       filename: url.lastPathComponent)) ?? false
                await MainActor.run {
                    gpxUploadStatus = ok ? "Course uploaded · refreshing" : "Upload failed."
                }
                if ok { await load() }
                try? await Task.sleep(nanoseconds: 2_500_000_000)
                await MainActor.run { gpxUploadStatus = nil }
            }
        case .failure:
            gpxUploadStatus = "Couldn't open the picker."
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
                                    .font(.body(11, weight: .semibold))
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
                            .font(.body(13, weight: .bold))
                            .foregroundStyle(Theme.txt.opacity(0.78))
                    } else {
                        Text("GOAL TIME")
                            .font(.body(13, weight: .bold))
                            .foregroundStyle(Theme.txt.opacity(0.78))
                    }
                }
                .padding(.top, 20)
            }

            if let chip = daysChip {
                HStack {
                    Text(chip)
                        .font(.body(11, weight: .bold))
                        .foregroundStyle(Theme.txt.opacity(0.85))
                    Spacer()
                    if let pr = pbChip {
                        Text(pr)
                            .font(.body(11, weight: .bold))
                            .foregroundStyle(Theme.Accent.mintReady)
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

    // courseRoute(points:) removed 2026-06-17 — THE COURSE now renders via
    // RouteMapView (CartoDB dark tiles), the same map as the post-run route.

    // MARK: - Facelift · countdown · pill · plan · fueling

    private var countdownHeadline: String {
        if detail?.race.is_past == true { return detail?.race.finishTime ?? "DONE" }
        guard let d = detail?.race.days else { return "—" }
        if d <= 0 { return "RACE DAY" }
        if d == 1 { return "TOMORROW" }
        return "\(d) DAYS"
    }

    private var countdownColor: Color {
        if detail?.race.is_past == true {
            return detail?.race.pb == true ? Color(hex: 0xF5C518) : Theme.txt
        }
        return Theme.race
    }

    private var countdownSub: String? {
        if detail?.race.is_past == true {
            return detail?.race.pb == true ? "FINISHED · PERSONAL BEST" : "FINISHED"
        }
        guard let d = detail?.race.days, d > 0 else { return "Race day. Trust the work." }
        // No "TO {code}" days-out subtitle — the name lives in the header pill;
        // the course map leads right under the countdown (David 2026-06-17).
        return nil
    }

    /// Race + goal summary for the shared header pill. The countdown owns the
    /// days, so the pill carries name + goal + pace only.
    private var racePill: some View {
        HStack(alignment: .center, spacing: 11) {
            // Back to the Goal tab · this is a pushed detail view with the nav
            // bar hidden, so it needs an explicit way out. Scoped to the pill
            // so it rides the shared header slot without a second header row.
            Button { dismiss() } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Theme.txt)
                    .frame(width: 30, height: 30)
                    .background(Theme.Glass.fill, in: Circle())
                    .overlay(Circle().stroke(Theme.Glass.line, lineWidth: 1))
            }
            .buttonStyle(.plain)
            VStack(alignment: .leading, spacing: 3) {
                Text("A-RACE")
                    .font(.body(9.5, weight: .extraBold)).tracking(2)
                    .foregroundStyle(Theme.txt.opacity(0.6))
                Text(raceName)
                    .font(.body(16, weight: .extraBold)).tracking(-0.2)
                    .foregroundStyle(Theme.txt)
                    .lineLimit(2).minimumScaleFactor(0.7)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 3) {
                Text("GOAL")
                    .font(.body(9.5, weight: .extraBold)).tracking(1.2)
                    .foregroundStyle(Theme.txt.opacity(0.6))
                Text(goalTime)
                    .font(.display(20, weight: .bold)).tracking(-0.5)
                    .foregroundStyle(Theme.txt)
                    .lineLimit(1).minimumScaleFactor(0.7)
                if goalPace != "—" {
                    Text("\(goalPace)/mi")
                        .font(.body(10.5, weight: .bold))
                        .foregroundStyle(Theme.txt.opacity(0.6))
                }
            }
            // Edit affordance · the page had no way to change distance / date /
            // goal before this (race P1). Opens RaceEditSheet prefilled from the
            // loaded detail. Hidden for past races · their meta is locked behind
            // the finish-time / retro surfaces, not this editor.
            if detail?.race.is_past != true {
                Button { showEditSheet = true } label: {
                    Image(systemName: "pencil")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Theme.txt)
                        .frame(width: 30, height: 30)
                        .background(Theme.Glass.fill, in: Circle())
                        .overlay(Circle().stroke(Theme.Glass.line, lineWidth: 1))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Edit race")
            }
        }
        .padding(.horizontal, 15)
        .padding(.vertical, 12)
    }

    private struct RacePhase: Identifiable {
        let id = UUID(); let range: String; let intent: String; let pace: String
    }

    /// Negative-split plan derived from goal pace + distance · controlled
    /// start, goal-pace middle, strong finish. Real numbers, not the old
    /// hardcoded "MI 1-3 settle 6:55" copy.
    private var planPhases: [RacePhase] {
        guard let gs = parsedGoalSec,
              let dist = detail?.race.distance_mi, dist > 0 else { return [] }
        let goalPaceSec = Double(gs) / dist
        let settleEnd = max(1, Int((dist * 0.22).rounded()))
        let goalEnd = max(settleEnd + 1, Int((dist * 0.77).rounded()))
        let distLabel = dist.truncatingRemainder(dividingBy: 1) == 0
            ? "\(Int(dist))" : String(format: "%.1f", dist)
        return [
            RacePhase(range: "MILES 1–\(settleEnd)", intent: "Settle in · bank nothing",
                      pace: fmtPaceSec(goalPaceSec + 5)),
            RacePhase(range: "MILES \(settleEnd + 1)–\(goalEnd)", intent: "Lock goal pace",
                      pace: fmtPaceSec(goalPaceSec)),
            RacePhase(range: "MILES \(goalEnd + 1)–\(distLabel)", intent: "Empty the tank",
                      pace: fmtPaceSec(goalPaceSec - 7)),
        ]
    }

    private var planRightLabel: String? {
        goalPace == "—" ? nil : "AVG \(goalPace)/mi"
    }

    // MARK: - Course-aware pacing (backend RacePacing.phases · race P2)

    /// The backend's named, grade-weighted course segments. nil when the
    /// server has no course geometry to phase against · the body then falls
    /// back to the local generic negative-split block.
    private var coursePhases: [RacePacingPhase]? {
        detail?.pacing?.phases
    }

    /// Format a server pace-string. The composer already emits "6:58/mi" in
    /// `display`; strip a trailing "/mi" so the card owns the unit and the
    /// number sits clean next to it.
    private func paceNumber(from display: String) -> String {
        display.replacingOccurrences(of: "/mi", with: "")
            .trimmingCharacters(in: .whitespaces)
    }

    /// THE PLAN, merged · terrain pace + the negative-split race arc, one
    /// table (David 2026-06-17 · the page used to show two competing pace
    /// tables). One row per named course segment: the course name + its mile
    /// range on the left, the position-based strategy cue ("Settle in" /
    /// "Empty the tank") as the sub-label, and the merged pace on the right.
    /// Each segment therefore carries BOTH the terrain pace and the race-arc
    /// intent. The fastest (lowest s/mi) segment reads in race orange so the
    /// surge stretch is obvious at a glance.
    private func coursePhasesCard(_ phases: [RacePacingPhase]) -> some View {
        // Fastest (lowest s/mi) segment gets the accent — the surge.
        let fastestIdx = phases.enumerated().min(by: { $0.element.pace_s_per_mi < $1.element.pace_s_per_mi })?.offset
        return VStack(spacing: 0) {
            ForEach(Array(phases.enumerated()), id: \.offset) { i, ph in
                HStack(alignment: .center) {
                    VStack(alignment: .leading, spacing: 3) {
                        // Course name + mile range on one line · the where.
                        (Text(ph.label.uppercased())
                            .foregroundStyle(Theme.txt)
                         + Text("  ·  \(milesRange(ph.start_mi, ph.end_mi))")
                            .foregroundStyle(Theme.txt.opacity(0.5)))
                            .font(.body(12, weight: .extraBold))
                            .tracking(0.4)
                            .lineLimit(1).minimumScaleFactor(0.75)
                        // Strategy cue · the how (the negative-split intent).
                        if let cue = ph.cue, !cue.isEmpty {
                            Text(cue)
                                .font(.body(11, weight: .semibold))
                                .foregroundStyle(Theme.txt.opacity(0.7))
                        }
                    }
                    Spacer(minLength: 12)
                    Text("\(paceNumber(from: ph.display))/mi")
                        .font(.display(18, weight: .bold)).tracking(-0.3)
                        .foregroundStyle(i == fastestIdx ? Theme.race : Theme.txt)
                }
                .padding(.horizontal, 14).padding(.vertical, 13)
                if i < phases.count - 1 {
                    Divider().background(Color.white.opacity(0.08))
                }
            }
        }
        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
    }

    /// "MILES 1–4" / "MILE 6" — humanised range label for a course segment.
    private func milesRange(_ start: Double, _ end: Double) -> String {
        let s = miLabel(start), e = miLabel(end)
        return s == e ? "MILE \(s)" : "MILES \(s)–\(e)"
    }

    private func miLabel(_ mi: Double) -> String {
        mi.truncatingRemainder(dividingBy: 1) == 0
            ? "\(Int(mi))" : String(format: "%.1f", mi)
    }

    private var planPhasesCard: some View {
        VStack(spacing: 0) {
            ForEach(Array(planPhases.enumerated()), id: \.offset) { i, ph in
                HStack(alignment: .center) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(ph.range)
                            .font(.body(12, weight: .extraBold)).tracking(0.6)
                            .foregroundStyle(Theme.txt)
                        Text(ph.intent)
                            .font(.body(11, weight: .semibold))
                            .foregroundStyle(Theme.txt.opacity(0.6))
                    }
                    Spacer(minLength: 12)
                    Text("\(ph.pace)/mi")
                        .font(.display(18, weight: .bold)).tracking(-0.3)
                        .foregroundStyle(i == 1 ? Theme.race : Theme.txt)
                }
                .padding(.horizontal, 14).padding(.vertical, 13)
                if i < planPhases.count - 1 {
                    Divider().background(Color.white.opacity(0.08))
                }
            }
            if let b = bGoalTime, let bp = bGoalPace {
                Divider().background(Color.white.opacity(0.08))
                HStack {
                    Text("IF IT GOES SIDEWAYS")
                        .font(.body(9.5, weight: .extraBold)).tracking(1.2)
                        .foregroundStyle(Theme.txt.opacity(0.5))
                    Spacer()
                    Text("\(b) · \(bp)/mi")
                        .font(.body(12, weight: .bold))
                        .foregroundStyle(Theme.txt.opacity(0.7))
                }
                .padding(.horizontal, 14).padding(.vertical, 11)
            }
        }
        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
    }

    // MARK: - Fueling (race P5 · backend `fueling` block)

    /// Right-rail label · servings to carry. "5 GELS" / "1 GEL". The product
    /// noun is generic ("gel") on the default plan, so keep it as GELS there.
    private func fuelingRightLabel(_ f: RaceFueling) -> String {
        let n = f.recommendedServings
        return n == 1 ? "1 GEL" : "\(n) GELS"
    }

    /// FUELING · the coach amount + the per-mile gel timeline. The headline
    /// line reads "Carry 5 × Maurten Gel 100 · one every ~25 min ≈ 75 g/hr",
    /// then the schedule strip places each gel on the course by mile. When
    /// the runner hasn't entered fuel (isDefault) the same plan shows under a
    /// clear "Enter your race fuel →" prompt that opens the editor. Gels are
    /// not a status colour — they ride Theme.goal (the amber milestone token),
    /// not a green/over semantic.
    private func fuelingPlanCard(_ f: RaceFueling) -> some View {
        return VStack(alignment: .leading, spacing: 12) {
            // Headline · what to carry, how often, what rate it hits.
            Text(fuelHeadline(f))
                .font(.body(14, weight: .bold))
                .foregroundStyle(Theme.txt)
                .fixedSize(horizontal: false, vertical: true)
                .lineSpacing(2)

            // The schedule · ONE clean line of mile markers. (Was a dot timeline
            // PLUS a verbose "Gel 1 · mi 3 …" list — two redundant reads of the
            // same thing, which made the card hard to parse · David 2026-06-17.)
            if !f.scheduleMi.isEmpty {
                let miles = f.scheduleMi.map { "\(Int($0.mi.rounded()))" }.joined(separator: " · ")
                (Text("Take one at mile  ").foregroundStyle(Theme.txt.opacity(0.5))
                 + Text(miles).foregroundStyle(Theme.txt.opacity(0.9)))
                    .font(.body(13, weight: .semibold))
                    .fixedSize(horizontal: false, vertical: true)
                    .lineSpacing(3)
            }

            // Default-plan prompt · the runner hasn't entered their fuel, so
            // this is a research default. Invite them to make it theirs.
            if f.isDefault {
                Divider().background(Color.white.opacity(0.08))
                Button { showEditSheet = true } label: {
                    HStack(spacing: 6) {
                        Text("Enter your race fuel")
                            .font(.body(12, weight: .extraBold))
                        Image(systemName: "arrow.right")
                            .font(.system(size: 11, weight: .bold))
                    }
                    .foregroundStyle(Theme.goal)
                }
                .buttonStyle(.plain)
                Text("Showing a sensible default until you set your gel.")
                    .font(.body(10.5, weight: .semibold))
                    .foregroundStyle(Theme.txt.opacity(0.5))
            }
        }
        .padding(14)
        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
    }

    /// "Carry 5 × Maurten Gel 100 · one every ~25 min ≈ 75 g/hr". Built from
    /// the structured block so the noun + count agree with the schedule. The
    /// cadence (~N min) is recovered from the first schedule gap; the rate is
    /// the server's targetCarbsPerHourG.
    private func fuelHeadline(_ f: RaceFueling) -> String {
        let isGeneric = f.productName.isEmpty || f.productName.lowercased() == "gel"
        var line = isGeneric
            ? "Carry \(f.recommendedServings) gels"
            : "Carry \(f.recommendedServings) × \(f.productName)"
        if let gap = fuelCadenceMin(f) {
            line += " · one every ~\(gap) min"
        }
        if f.targetCarbsPerHourG > 0 {
            line += " ≈ \(f.targetCarbsPerHourG) g/hr"
        }
        return line + "."
    }

    /// Recover the intake cadence (minutes between gels) from the schedule's
    /// first gap. nil when there's only one stop.
    private func fuelCadenceMin(_ f: RaceFueling) -> Int? {
        guard f.scheduleMin.count >= 2 else { return nil }
        let gap = f.scheduleMin[1] - f.scheduleMin[0]
        return gap > 0 ? gap : nil
    }

    // MARK: - Post-race retro (race P5)

    /// THE RETRO card · two states. With a logged finish it reads back the
    /// time + PB chip and offers "Edit result". With no finish yet it invites
    /// the runner to log it. Either way the button opens RaceRetroSheet, which
    /// owns the finish-time → /api/race/result write and the felt / execution
    /// / notes → PATCH /api/race write.
    private var retroCard: some View {
        let hasFinish = (detail?.race.finishTime?.isEmpty == false)
        let isPB = detail?.race.pb == true
        let pbHex: UInt32 = 0xF5C518
        return VStack(alignment: .leading, spacing: 12) {
            if hasFinish, let finish = detail?.race.finishTime {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(finish)
                        .font(.display(28, weight: .bold)).tracking(-0.5)
                        .foregroundStyle(isPB ? Color(hex: pbHex) : Theme.txt)
                    Text(isPB ? "FINISHED · PERSONAL BEST" : "FINISHED")
                        .font(.body(9.5, weight: .extraBold)).tracking(1.4)
                        .foregroundStyle(Theme.txt.opacity(0.6))
                    Spacer()
                }
                Text("Tap below to add how it went, or correct the time.")
                    .font(.body(11, weight: .semibold))
                    .foregroundStyle(Theme.txt.opacity(0.6))
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Text("Log your result")
                    .font(.body(14, weight: .bold))
                    .foregroundStyle(Theme.txt)
                Text("Add your chip time so the coach can recalibrate fitness off the race. You can note how it went too.")
                    .font(.body(11, weight: .semibold))
                    .foregroundStyle(Theme.txt.opacity(0.6))
                    .fixedSize(horizontal: false, vertical: true)
                    .lineSpacing(2)
            }
            Divider().background(Color.white.opacity(0.08))
            Button { showRetroSheet = true } label: {
                HStack(spacing: 6) {
                    Image(systemName: hasFinish ? "pencil" : "flag.checkered")
                        .font(.system(size: 12, weight: .bold))
                    Text(hasFinish ? "Edit result" : "Log result")
                        .font(.body(13, weight: .extraBold))
                    Spacer()
                    Image(systemName: "arrow.right")
                        .font(.system(size: 11, weight: .bold))
                }
                .foregroundStyle(Theme.race)
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
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
                    Text(r).font(.body(11, weight: .bold)).foregroundStyle(Theme.txt.opacity(0.85))
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
        // 2026-06-09 · race-killer F2 — RaceClock (API.swift) carries the
        // h:mm-vs-m:ss heuristic. The local 2-part branch read the stored
        // "1:30" goal as 90s → "0:07/mi" on race morning.
        guard let totalSec = RaceClock.seconds(from: detail?.race.goal),
              let dist = detail?.race.distance_mi, dist > 0 else { return "—" }
        let perMile = Int(round(Double(totalSec) / dist))
        return String(format: "%d:%02d", perMile / 60, perMile % 60)
    }
    private var courseStat: String {
        var parts: [String] = []
        if let d = detail?.race.distance_mi, d > 0 { parts.append(String(format: "%.1f MI", d)) }
        // Elevation lives in the header next to the distance (David 2026-06-17) —
        // the recomputed (noise-thresholded) course gain, not stranded below the map.
        if let elev = detail?.course_geometry?.elevation_gain_ft, elev > 0 {
            parts.append("↗ \(Int(elev)) FT")
        }
        return parts.joined(separator: " · ")
    }

    /// Crowd-sourced provenance line shown under the route. Drawn only when
    /// the course came from the shared course_library and at least one
    /// other runner has raced it. New 2026-05-30 backend audit surface.
    private var courseProvenanceLabel: String? {
        guard let lib = detail?.course_library else { return nil }
        let n = lib.contributor_count
        // Only surface provenance when it's genuinely a crowd (≥2 runners).
        // "Crowd-sourced · 1 runner" is just the runner's own imported GPX —
        // odd to badge as crowd-sourced (David 2026-06-17).
        guard n >= 2 else { return nil }
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
        async let proj = (try? await API.fetchTargetsProjection(raceSlug: raceSlug))
        async let ep = (try? await API.fetchRaceExecutionPlan(slug: raceSlug))
        let (rd, fc, pj, xp) = await (r, f, proj, ep)
        await MainActor.run {
            self.detail = rd; self.raceFacts = fc; self.projection = pj
            self.execPlan = xp?.plan
        }
    }

    // MARK: - Race-morning + plan helpers

    /// Parse goal string ("1:30:00" / "1:30" / "45:00") → total seconds.
    /// Used by B-goal, splits, and fuel computations so we only decode once.
    /// 2026-06-09 · race-killer F2 — RaceClock (API.swift). The local
    /// 2-part branch read the stored "1:30" goal as 90 seconds, which made
    /// this view's race-morning splits card show 5K "0:21" and B-goal "8:30".
    private var parsedGoalSec: Int? {
        RaceClock.seconds(from: detail?.race.goal)
    }

    private func fmtRaceTime(_ secs: Int) -> String {
        let h = secs / 3600
        let m = (secs % 3600) / 60
        let s = secs % 60
        return h > 0
            ? String(format: "%d:%02d:%02d", h, m, s)
            : String(format: "%d:%02d", m, s)
    }

    private func fmtPaceSec(_ secPerMile: Double) -> String {
        let total = Int(secPerMile.rounded())
        return String(format: "%d:%02d", total / 60, total % 60)
    }

    /// B-goal = A-goal + 7 minutes. Mirrors web raceDetail.ts:283.
    private var bGoalTime: String? {
        guard let gs = parsedGoalSec else { return nil }
        return fmtRaceTime(gs + 420)
    }

    private var bGoalPace: String? {
        guard let gs = parsedGoalSec,
              let dist = detail?.race.distance_mi, dist > 0 else { return nil }
        return fmtPaceSec(Double(gs + 420) / dist)
    }

    /// Cumulative split times at standard checkpoints.
    /// 2026-06-09 · race-killer F3 — prefer the server's course-aware
    /// splits (RaceDetailResponse.pacing · grade-weighted over the
    /// authored course phases, cite Research/11 §grade-cost). The local
    /// linear ladder remains as the fallback for older servers / courses
    /// with no usable phase profile — flat-course splits on AFC told the
    /// runner to bank nothing on The Drop and left the Balboa climb
    /// unpriced.
    private var raceSplits: [(label: String, time: String)] {
        if let server = detail?.pacing?.splits, !server.isEmpty {
            return server.map { ($0.label, $0.display) }
        }
        guard let gs = parsedGoalSec,
              let dist = detail?.race.distance_mi, dist > 0 else { return [] }
        let rungs: [(label: String, mi: Double)] = [
            ("5K", 3.1069), ("10K", 6.2137), ("HALF", 13.1094),
            ("30K", 18.641), ("40K", 24.855),
        ]
        var out = rungs
            .filter { $0.mi < dist - 0.1 }
            .map { r -> (label: String, time: String) in
                let cum = Int((r.mi / dist * Double(gs)).rounded())
                return (r.label, fmtRaceTime(cum))
            }
        out.append(("FINISH", fmtRaceTime(gs)))
        return out
    }

    // MARK: - Race-morning card (days == 0)

    private var raceMorningRows: [(label: String, value: String, dim: Bool)] {
        var rows: [(label: String, value: String, dim: Bool)] = [
            ("GUN TIME", detail?.race.gun_time ?? "—", detail?.race.gun_time == nil)
        ]
        if let w = detail?.race.wave     { rows.append(("WAVE",     w, false)) }
        if let loc = detail?.race.location { rows.append(("LOCATION", loc, false)) }
        return rows
    }

    private var raceMorningCard: some View {
        let rows = raceMorningRows
        return VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.offset) { i, row in
                HStack {
                    SpecLabel(text: row.label, size: 10, tracking: 1.5,
                              color: Theme.txt.opacity(0.55))
                    Spacer(minLength: 12)
                    Text(row.value)
                        .font(.body(15, weight: .bold))
                        .foregroundStyle(row.dim ? Theme.txt.opacity(0.35) : Theme.txt)
                        .multilineTextAlignment(.trailing)
                }
                .padding(14)
                if i < rows.count - 1 {
                    Divider().background(Color.white.opacity(0.08))
                }
            }
        }
        .background(Theme.Glass.fill,
                    in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous)
            .stroke(Theme.Glass.line, lineWidth: 1))
    }

    // MARK: - Race plan card (A + B goal)

    private var racePlanCard: some View {
        let aTime  = goalTime   // existing computed property
        let aPace  = goalPace   // existing computed property
        let bTime  = bGoalTime ?? "—"
        let bPace  = bGoalPace ?? "—"
        return VStack(spacing: 0) {
            HStack {
                SpecLabel(text: "A GOAL", size: 10, tracking: 1.5,
                          color: Theme.txt.opacity(0.55))
                Spacer(minLength: 12)
                Text("\(aTime)  ·  \(aPace)/mi")
                    .font(.body(14, weight: .bold))
                    .foregroundStyle(Theme.txt)
            }
            .padding(14)
            Divider().background(Color.white.opacity(0.08))
            HStack {
                SpecLabel(text: "B GOAL", size: 10, tracking: 1.5,
                          color: Theme.txt.opacity(0.55))
                Spacer(minLength: 12)
                Text("\(bTime)  ·  \(bPace)/mi")
                    .font(.body(14, weight: .bold))
                    .foregroundStyle(Theme.txt.opacity(0.65))
            }
            .padding(14)
        }
        .background(Theme.Glass.fill,
                    in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous)
            .stroke(Theme.Glass.line, lineWidth: 1))
    }

    // MARK: - Splits card

    private var splitsCard: some View {
        let splits = raceSplits
        return VStack(spacing: 0) {
            ForEach(Array(splits.enumerated()), id: \.offset) { i, row in
                HStack {
                    SpecLabel(text: row.label, size: 10, tracking: 1.5,
                              color: Theme.txt.opacity(0.55))
                    Spacer(minLength: 12)
                    Text(row.time)
                        .font(.body(15, weight: .bold))
                        .foregroundStyle(i == splits.count - 1 ? Theme.race : Theme.txt)
                }
                .padding(14)
                if i < splits.count - 1 {
                    Divider().background(Color.white.opacity(0.08))
                }
            }
        }
        .background(Theme.Glass.fill,
                    in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous)
            .stroke(Theme.Glass.line, lineWidth: 1))
    }

    // MARK: - Toolkit helpers (CountdownLadder + VDOTPredictionTable)
    //
    // The fueling strip now reads the backend `fueling` block (race P5 ·
    // fuelingPlanCard) — the coach's amount + schedule, not a client-side
    // gels-per-hour guess. The old `computedGelsMi` / `raceGelsMi` heuristic
    // (and the watch-workout fetch that fed them) are removed: two sources of
    // truth for the same gel timeline is exactly the "competing fueling UI"
    // the spec calls out.

    // MARK: - Race header status (RaceStatusDot)

    /// Deterministic on_track / watch / off classification derived from
    /// proximity + days_to_race + (when present) a projection-vs-goal
    /// gap from raceFacts. Hidden for past races. Toolkit · Family A.
    private var derivedRaceStatus: (dot: RaceStatus, reason: String)? {
        guard detail?.race.is_past != true,
              let days = detail?.race.days else { return nil }
        // Days-out heuristic · plenty of time = on track until a signal
        // says otherwise. The reason copy stays runner-facing.
        if days > 60 {
            return (.on_track, "Base phase. Plenty of runway before the race.")
        }
        // Look at the projection-vs-goal fact when the coach surfaced it.
        let projGap = raceFacts?.facts.first(where: { $0.label.uppercased().contains("PROJECTION") || $0.label.uppercased().contains("PROJ") })
        if let gap = projGap?.meta ?? projGap?.value, gap.contains("over") || gap.contains("slower") {
            return (.off, gap)
        }
        if days <= 14 {
            return (.watch, "Race week is close · the next two weeks are taper math, not fitness math.")
        }
        return (.on_track, "Building toward race week. Hit the easy days and the quality lands.")
    }

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

    // MARK: - Race-morning brief (execution-plan · race P2)

    /// Gate for the morning brief (splits / trigger / heat / warm-up). The
    /// named pacing strategy shows always; the brief is the race-execution
    /// payoff, so it surfaces inside a sensible proximity window rather than
    /// dumping the full plan months out. Window: within 14 days of the gun,
    /// or whenever the server already calls it race-week / sharpening. Never
    /// for past races.
    private var showMorningBrief: Bool {
        guard detail?.race.is_past != true else { return false }
        // Race-week only. The warm-up timeline + B-goal contingency are
        // race-morning tactical — premature (and doubt-inducing) months out
        // (David 2026-06-17). Tightened from the old 14-day / "sharpening" gate.
        if let d = detail?.race.days, d >= 0, d <= 7 { return true }
        return (detail?.proximity ?? "").lowercased() == "race-week"
    }

    /// Format seconds-per-mile → "m:ss". Shared by the B-goal + heat cards
    /// which carry raw s/mi from the composer.
    private func fmtPacePerMi(_ secPerMi: Int) -> String {
        String(format: "%d:%02d", secPerMi / 60, secPerMi % 60)
    }

    /// Right-rail label for WARM-UP · "DONE 15 MIN OUT" so the runner knows
    /// the timeline lands them in the corral.
    private var warmupRightLabel: String? {
        guard let plan = execPlan,
              let last = plan.warmup.min(by: { ($0.minutesBeforeGun ?? 0) < ($1.minutesBeforeGun ?? 0) }),
              let m = last.minutesBeforeGun else { return nil }
        return "DONE \(m) MIN OUT"
    }

    // THE SPLITS card removed 2026-06-17 · the per-mile negative-split
    // ladder (splitTargetsCard / groupedSplits / segmentIntent) was a
    // second pace table competing with THE PLAN. THE PLAN now carries the
    // negative-split arc folded onto the terrain pace (one merged table,
    // each segment tagged with its strategy cue), so the splits renderer is
    // gone. The execution-plan fetch + model stay — IF IT GOES SIDEWAYS,
    // HEAT, and WARM-UP below still consume it; only `splits` goes unrendered.

    /// IF IT GOES SIDEWAYS · the objective B-goal trigger. The condition
    /// (HR + pace by the checkpoint mile) up top, the action below. This is
    /// the single most important line on race morning · render it as one
    /// clear decision, not a data table.
    private func bGoalTriggerCard(_ t: BGoalTrigger) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            // The trip condition.
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("BY MILE \(t.atMile ?? 5)")
                    .font(.body(10, weight: .extraBold)).tracking(1.2)
                    .foregroundStyle(Theme.over)
                Spacer()
            }
            Text(triggerConditionLine(t))
                .font(.body(13, weight: .bold))
                .foregroundStyle(Theme.txt)
                .fixedSize(horizontal: false, vertical: true)
            if let action = t.action, !action.isEmpty {
                Divider().background(Color.white.opacity(0.08))
                Text(action)
                    .font(.body(12, weight: .semibold))
                    .foregroundStyle(Theme.txt.opacity(0.75))
                    .fixedSize(horizontal: false, vertical: true)
                    .lineSpacing(2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Theme.over.opacity(0.07), in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.over.opacity(0.30), lineWidth: 1))
    }

    /// "If HR is over 169 or pace is slower than 7:14/mi" — built from the
    /// trigger's HR + pace thresholds. HR clause drops when the runner has
    /// no LTHR / maxHr anchor (hrAboveBpm null).
    private func triggerConditionLine(_ t: BGoalTrigger) -> String {
        var clauses: [String] = []
        if let hr = t.hrAboveBpm, hr > 0 {
            clauses.append("HR is over \(hr)")
        }
        if let pace = t.paceSlowerThanSPerMi, pace > 0 {
            clauses.append("pace is slower than \(fmtPacePerMi(pace))/mi")
        }
        if clauses.isEmpty { return "If the effort is already at the edge here, ease off." }
        return "If " + clauses.joined(separator: " or ") + ":"
    }

    // heatTreeCard / heatNoteShort removed 2026-06-17 — the generic heat
    // decision tree is gone (premature + doubt-inducing months out). The future
    // move is a forecast-driven note (real race-week weather → one adjustment);
    // the HeatRule model is kept for that.

    /// WARM-UP · the gun-anchored timeline. The clock time leads when known
    /// (server emits "6:15 AM" off the gun); otherwise the minutes-before
    /// chip carries it. Each step is a short coach instruction.
    private func warmupCard(_ steps: [WarmupStep]) -> some View {
        // Show in run order: furthest-out step first.
        let ordered = steps.sorted { ($0.minutesBeforeGun ?? 0) > ($1.minutesBeforeGun ?? 0) }
        return VStack(spacing: 0) {
            ForEach(Array(ordered.enumerated()), id: \.offset) { i, s in
                HStack(alignment: .top, spacing: 12) {
                    Text(warmupTimeLabel(s))
                        .font(.body(11, weight: .extraBold)).tracking(0.4)
                        .foregroundStyle(Theme.race)
                        .frame(width: 64, alignment: .leading)
                    Text(s.step ?? "")
                        .font(.body(12, weight: .semibold))
                        .foregroundStyle(Theme.txt.opacity(0.85))
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 14).padding(.vertical, 12)
                if i < ordered.count - 1 {
                    Divider().background(Color.white.opacity(0.08))
                }
            }
        }
        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
    }

    /// Clock time when the gun is known ("6:15 AM"); else "T-45" minutes-out.
    private func warmupTimeLabel(_ s: WarmupStep) -> String {
        if let clock = s.clock, !clock.isEmpty { return clock }
        if let m = s.minutesBeforeGun { return "T-\(m)" }
        return ""
    }

}

// MARK: - Post-race retro sheet (race P5)

/// Log a race result + reflection for a PAST race. Two writes, sequenced:
///   1. The finish time (+ optional avg HR) → POST /api/race/result. That's
///      the authoritative chip-time write — it beats raw Strava elapsed (the
///      race-data source-of-truth rule), fires fresh projection snapshots +
///      a VDOT recalc, archives the active plan, and auto-generates the next
///      A/B race's plan. The runner types "1:29:45"; the server parses it.
///   2. How it went (felt / execution / notes) → PATCH /api/race (meta
///      passthrough). Sent only when the runner filled something in.
/// Either write can stand alone — a runner can log just the time, or just a
/// reflection on a finish Strava already matched.
struct RaceRetroSheet: View {
    let slug: String
    let raceName: String
    /// Prefill the finish field from a finish already on the race (a curated
    /// result or a Strava-matched time the runner is confirming).
    var seedFinish: String? = nil
    var onSaved: () -> Void = {}

    @Environment(\.dismiss) private var dismiss

    @State private var finish: String = ""
    @State private var avgHr: String = ""
    @State private var felt: String = ""          // "great" / "ok" / "rough"
    @State private var execution: String = ""     // free text · how the plan held
    @State private var notes: String = ""
    @State private var saving: Bool = false
    @State private var error: String? = nil

    // Coach-voice felt options · no hype, plain words.
    private let feltOptions = ["", "strong", "solid", "even", "tough", "fell apart"]

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Finish time · e.g. 1:29:45", text: $finish)
                        .keyboardType(.numbersAndPunctuation)
                    TextField("Average HR · bpm (optional)", text: $avgHr)
                        .keyboardType(.numberPad)
                } header: {
                    Text("RESULT")
                } footer: {
                    Text("Your chip time. The coach recalibrates fitness off it and updates the plan for your next race. Adding HR also recalibrates your threshold.")
                        .font(.body(11))
                }
                Section {
                    Picker("How it felt", selection: $felt) {
                        ForEach(feltOptions, id: \.self) { opt in
                            Text(opt.isEmpty ? "—" : opt.capitalized).tag(opt)
                        }
                    }
                    TextField("How the plan held up", text: $execution, axis: .vertical)
                        .lineLimit(2...4)
                    TextField("Anything to remember", text: $notes, axis: .vertical)
                        .lineLimit(2...5)
                } header: {
                    Text("HOW IT WENT (optional)")
                }
                if let err = error {
                    Section { Text(err).foregroundStyle(.red).font(.body(13)) }
                }
            }
            .navigationTitle(raceName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : "Save") {
                        Task { await save() }
                    }
                    .disabled(saving || !hasSomething)
                }
            }
            .onAppear {
                if finish.isEmpty, let s = seedFinish, !s.isEmpty { finish = s }
            }
        }
    }

    /// Save is enabled when the runner entered a finish time OR any reflection
    /// field · a blank sheet has nothing to write.
    private var hasSomething: Bool {
        !trimmed(finish).isEmpty || !trimmed(felt).isEmpty
            || !trimmed(execution).isEmpty || !trimmed(notes).isEmpty
    }

    private func trimmed(_ s: String) -> String { s.trimmingCharacters(in: .whitespaces) }

    private func save() async {
        saving = true
        error = nil
        let hrInt = Int(trimmed(avgHr))
        let hr: Int? = (hrInt ?? 0) > 0 ? hrInt : nil

        var ok = true

        // 1 · authoritative finish time → /api/race/result (carries HR).
        let finishStr = trimmed(finish)
        if !finishStr.isEmpty {
            // Guard the format so we don't POST garbage · RaceClock mirrors the
            // server's h:mm:ss / m:ss parser.
            guard RaceClock.seconds(from: finishStr) != nil else {
                await MainActor.run {
                    error = "That finish time doesn't look right. Use 1:29:45 or 45:12."
                    saving = false
                }
                return
            }
            ok = await API.postRaceResult(slug: slug, finishDisplay: finishStr, avgHrBpm: hr)
        }

        // 2 · reflection → PATCH /api/race (only the filled fields). avgHr is
        // also passed here so a reflection-only save (no finish) still records
        // it · the result POST already wrote it when a finish was present.
        if ok {
            var retro: [String: Any] = [:]
            if !trimmed(felt).isEmpty { retro["retroFelt"] = trimmed(felt) }
            if !trimmed(execution).isEmpty { retro["retroExecution"] = trimmed(execution) }
            if !trimmed(notes).isEmpty { retro["retroNotes"] = trimmed(notes) }
            if finishStr.isEmpty, let hr { retro["avgHrBpm"] = hr }
            if !retro.isEmpty {
                do { try await API.submitRaceRetro(slug: slug, body: retro) }
                catch { ok = false }
            }
        }

        await MainActor.run {
            if ok {
                onSaved()
                dismiss()
            } else {
                error = "Could not save. Check your connection and try again."
                saving = false
            }
        }
    }
}
