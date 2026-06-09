//
//  TodayPostRunBody.swift
//  The completed-run body for the Today slide-up sheet, per the
//  redesigned Today v2 brief (designs/from Design agent/Today page v2/).
//
//  Renders when displayDay.completedRunId is non-nil. Replaces the
//  pre-run prescription/fueling/coach blocks with:
//
//    1. Win line · green check + result.win (or fallback derived
//       from RunRecap.verdict + first fact)
//    2. Stats trio · Distance / Avg pace / Moving time
//    3. Secondary stats · Avg HR / Elev gain / Conditions
//    4. Route map · stylized polyline on a dark card with start/finish
//       dots + distance · elev overlay
//    5. Mile splits · one row per mile, phase-colored bar (work = run
//       accent, warmup/cooldown = teal)
//    6. Form grid · Cadence / GCT / Vert osc / Power (only present
//       metrics show; grid cols = count)
//    7. How it went · `On plan` tag + verdict + recap + planned-vs-actual
//       comparison rows for HR / Pace / Cadence
//
//  Doctrine: dark-first inside the cream sheet (this surface is on
//  the cream sheet, so text is dark) · no em dashes · stats display
//  both numbers (no derived deltas) · no prescription copy.
//

import SwiftUI
import MapKit
import CoreLocation

struct TodayPostRunBody: View {
    /// The fetched run detail · drives every section. Until it hydrates
    /// we render skeleton placeholders.
    let detail: RunDetail?
    /// Post-run coach voice (verdict + facts + win line when backend ships it).
    let recap: RunRecap?
    /// Run accent color · matches the pre-run effort accent so the
    /// peek + ticks + splits stay in one palette.
    let accent: Color
    /// The run's id · used to push to RunDetail from the "View full
    /// run" link at the bottom of the body. Optional · the link hides
    /// when there's no id (e.g. during hydration).
    let runId: String?
    /// 2026-06-01 round 7 · design package #3 header inputs.
    /// Drives the eyebrow ("TODAY · HARD · DONE") and Oswald title.
    /// Optional · falls back gracefully when not provided.
    var effortLabel: String? = nil   // "HARD"
    var dowLabel: String? = nil      // "TODAY" / "MON"
    var titleText: String? = nil     // "TEMPO" (Oswald hero)
    /// 2026-06-02 round 45 · workout name shown subordinately to the
    /// hero title ("4×1 mi @ I · 3 min jog" under "INTERVALS"). Hides
    /// when it duplicates the hero or is empty.
    var nameSubtitle: String? = nil
    /// 2026-06-02 round 62 · render context flag.
    ///
    /// Default false → the original white-on-cream styling for the
    /// today + done drag-sheet body (white card sections + dark text
    /// on a white sheet background). The drag-sheet is a white
    /// surface, so white cards blend into a continuous result page.
    ///
    /// When true → render for the dark time-of-day MESH (past-day
    /// flat layout). All white card backgrounds go transparent so
    /// the mesh shows through, dark text inverts to white with
    /// opacity tiers for hierarchy, cream dividers become white
    /// lines at low opacity. The recap reads as one beat of the
    /// mesh page instead of a hard cream slab welded onto it.
    var onMesh: Bool = false

    // MARK: - Context-aware colors (round 62)
    //
    // Five tokens drive every surface decision. Each gets a literal
    // value for cream-context and a mesh-context variant. Replacing
    // the 28 literal-color sites with these tokens means future tone
    // tweaks (e.g. softer dividers, warmer mute) happen in one place.

    /// Section background. White for the drag-sheet body, transparent
    /// for the mesh page so the time-of-day palette shows through.
    private var sectionBg: Color { onMesh ? Color.clear : Color.white }
    /// Primary readable text (titles, hero numbers, stat values).
    private var primaryText: Color { onMesh ? Color.white : Color(hex: 0x14110D) }
    /// Mid-tier text (subtitles, secondary labels).
    private var mutedText: Color { onMesh ? Color.white.opacity(0.78) : Color(hex: 0x736C61) }
    /// Tertiary text (eyebrows, hint copy, axis labels).
    private var subtleText: Color { onMesh ? Color.white.opacity(0.55) : Color(hex: 0xA39A8C) }
    /// Hairline dividers between sections / chip strokes.
    /// Named dividerColor (not divider) to avoid colliding with the
    /// existing `private var divider: some View` 1×28pt vertical rule.
    private var dividerColor: Color { onMesh ? Color.white.opacity(0.18) : Color(hex: 0xEEE7DA) }
    /// 2026-06-02 round 64 · subtle visible-tile background (mile-split
    /// stat tiles, etc.). On cream context: warm tan (cream surface
    /// elevation). On mesh: low-opacity white wash so the tile is
    /// readable against the dark mesh without dropping a hard cream
    /// slab. Use this anywhere a contained chip needs a faint bg fill ·
    /// not for white-card sections (those are sectionBg).
    private var chipBg: Color { onMesh ? Color.white.opacity(0.08) : Color(hex: 0xF6F0E2) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header                          // NEW · eyebrow + Oswald title + win line
            statsTrio
            secondaryStats
            // Route map · only render the section when there's actual
            // polyline data. The Today v2 feedback caught the old
            // unconditional render leaving a black card on runs without
            // GPS export (apple_watch source · most of David's runs).
            if let poly = detail?.route_polyline, !poly.isEmpty,
               decodePolyline(poly).count >= 2 {
                routeMap(polyline: poly)
            }
            // 2026-06-09 · mile splits open to all non-rest run types.
            // Easy/recovery previously relied on AEROBIC STAMP's mile-pace
            // footprint, but that footprint is inside the recap-gated block
            // and often doesn't fire for easy runs with sparse recap data.
            // Every GPS run benefits from seeing its pace distribution.
            if hiwEffort != .rest {
                mileSplits
            }
            formGrid
            howItWent
            // 2026-06-02 round 50 · "View full run ›" link retired.
            // Post-run pull-up sheet is the canonical post-run surface
            // now · everything the runner needs lives here. The
            // viewFullRunLink view itself is kept dead-coded in case
            // a future deep-link route brings it back.
            // 2026-06-02 round 54 · tail-filler REVERTED · the 320pt
            // void was worse than the cream band. Real fix is in
            // DragSheet/TodayView · the sheet's body BG now goes white
            // in post-run mode so there's no cream to hide.
        }
    }

    /// 2026-06-02 round 49 · effort resolved from the run's planned type
    /// (preferred) or actual type (fallback) · drives both the per-type
    /// HOW IT WENT panel and the mile-splits gate.
    private var hiwEffort: FaffEffort {
        let raw = (detail?.planned_spec?.kind
                   ?? detail?.type
                   ?? "")
        return FaffEffort.fromType(raw)
    }

    /// 2026-06-01 round 7 · eyebrow + Oswald title + green-check win line.
    /// 2026-06-03 round 68 · eyebrow retired. David: "we can remove
    /// MON EASY DONE at the top above easy. All of that information is
    /// already obvious." DOW lives in the week strip, type word IS the
    /// Oswald title, DONE is implied by being on the post-run surface.
    /// Just renders Oswald title + green-check win line now.
    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(headerTitle.uppercased())
                .font(.display(46, weight: .bold))
                .tracking(-1.5)
                .foregroundStyle(primaryText)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .padding(.top, 2)
            if let sub = subtitleText {
                Text(sub)
                    .font(.body(14, weight: .semibold))
                    .foregroundStyle(mutedText)
                    .lineLimit(2)
                    .padding(.top, 1)
            }
            // 2026-06-03 round 70 · WIN LINE as a contained pill.
            // David: "still hard to read" — round 67 green-on-mesh
            // was muddy. Pattern: WHITE pill background + DARK GREEN
            // text + check on mesh context · semantic green-ness via
            // the icon/text, max contrast via the white pill.
            // Cream context keeps the original light-green chip.
            if let win = winLineText {
                let pillBg: Color = onMesh ? Color.white : Color(hex: 0xE9F7EE)
                let inkColor: Color = Color(hex: 0x1F9A6F)
                HStack(alignment: .firstTextBaseline, spacing: 0) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(inkColor)
                        Text(win)
                            .font(.body(15, weight: .extraBold))
                            .foregroundStyle(inkColor)
                            .fixedSize(horizontal: false, vertical: true)
                            .lineLimit(2)
                    }
                    .padding(.horizontal, 14).padding(.vertical, 9)
                    .background(pillBg, in: Capsule())
                    Spacer(minLength: 0)
                }
                .padding(.top, 10)
            }
        }
        .padding(.horizontal, 24).padding(.top, 18).padding(.bottom, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(sectionBg)
        .overlay(
            Rectangle().fill(dividerColor).frame(height: 1),
            alignment: .bottom
        )
    }

    private var headerEyebrow: String {
        let day = dowLabel ?? "TODAY"
        let eff = effortLabel ?? "RUN"
        return "\(day) · \(eff) · DONE"
    }

    private var headerTitle: String {
        if let t = titleText, !t.isEmpty { return t }
        if let n = detail?.name, !n.isEmpty { return n }
        return "Run"
    }

    /// 2026-06-02 round 45 · subordinate workout name under the hero.
    /// Hides when it duplicates the hero (so "EASY" name under "EASY"
    /// hero doesn't repeat) or when the caller didn't pass one.
    private var subtitleText: String? {
        guard let raw = nameSubtitle?.trimmingCharacters(in: .whitespaces),
              !raw.isEmpty else { return nil }
        let title = (titleText ?? "").trimmingCharacters(in: .whitespaces)
        if raw.uppercased() == title.uppercased() { return nil }
        return raw
    }

    /// Small chevron-link at the bottom of the post-run body · replaces
    /// the old StickyCTABar Share Run button (which buried the body
    /// content). Pushes to RunDetail where Push-to-Strava lives.
    @ViewBuilder
    private var viewFullRunLink: some View {
        if let id = runId {
            NavigationLink(value: FaffRoute.runDetail(id: id)) {
                HStack(spacing: 6) {
                    Spacer(minLength: 0)
                    Text("View full run")
                        .font(.body(13, weight: .extraBold)).tracking(0.4)
                        .foregroundStyle(accent)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(accent)
                    Spacer(minLength: 0)
                }
                .padding(.vertical, 18)
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: - 1. Win line

    @ViewBuilder
    private var winLine: some View {
        if let line = winLineText, !line.isEmpty {
            // 2026-06-03 round 70 · David: "still hard to read." Round 67's
            // saturated-green-pill + white-text combo didn't pop against
            // the time-of-day mesh (esp. cool sunrise / dusk palettes
            // where the green pill blended with the gradient). Flipping
            // to MAX-CONTRAST treatment: WHITE pill + DARK GREEN text +
            // DARK GREEN check on mesh. White-on-mesh is the brightest
            // contrast surface in the app · semantic green-ness comes
            // from the icon + text inside. Cream context keeps the
            // original light-green pill since it's already on white.
            //
            // Also bumped text size 14→15, check 14→16, padding
            // tightened so the pill reads as a confident pill, not a
            // shy chip.
            let pillBg: Color = onMesh ? Color.white : Color(hex: 0xE9F7EE)
            let inkColor: Color = Color(hex: 0x1F9A6F)   // dark green both contexts
            HStack(alignment: .firstTextBaseline, spacing: 0) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(inkColor)
                    Text(line)
                        .font(.body(15, weight: .extraBold))
                        .foregroundStyle(inkColor)
                        .fixedSize(horizontal: false, vertical: true)
                        .lineLimit(2)
                }
                .padding(.horizontal, 14).padding(.vertical, 9)
                .background(pillBg, in: Capsule())
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 24).padding(.vertical, 16)
            .background(sectionBg)
            .overlay(
                Rectangle()
                    .fill(dividerColor)
                    .frame(height: 1),
                alignment: .bottom
            )
        }
    }

    /// Win line · read straight from `recap.win`. Composer ships per-
    /// type 4-10 word coach voice (lib/coach/run-win.ts · backend
    /// commits cd091124 + 9fd07cdf). The composer returns null when
    /// the run was off-plan, DNF, or had insufficient data to claim a
    /// win · the iPhone hides the green check + line in that case
    /// (the rest of the post-run sheet still renders).
    private var winLineText: String? {
        guard let w = recap?.win?.trimmingCharacters(in: .whitespacesAndNewlines),
              !w.isEmpty else {
            return nil
        }
        return w
    }

    // MARK: - 2. Stats trio · Distance / Pace / Moving time

    /// True when the run type is tempo / threshold / progression /
    /// intervals — sessions where the work-phase pace is the key
    /// number and the overall avg is diluted by warmup + cooldown.
    private var isQualityRun: Bool {
        hiwEffort == .tempo || hiwEffort == .intervals
    }

    /// Work-phase pace string ("{M:SS}/mi") for quality sessions,
    /// or nil when unavailable (easy/long/rest) or when pace_work
    /// isn't populated (non-Faff-watch sources).
    private var workPaceDisplay: String? {
        guard isQualityRun,
              let wp = detail?.pace_work, !wp.isEmpty else { return nil }
        return "\(wp)/mi"
    }

    private var statsTrio: some View {
        let paceLabel = workPaceDisplay != nil ? "WORK PACE" : "AVG PACE"
        let paceValue = workPaceDisplay ?? paceText
        return HStack(spacing: 0) {
            statColumn(key: "DISTANCE", value: distanceText)
            divider
            statColumn(key: paceLabel, value: paceValue)
            divider
            statColumn(key: "MOVING", value: movingText)
        }
        .padding(.vertical, 18)
        .background(sectionBg)
        .overlay(
            Rectangle()
                .fill(dividerColor)
                .frame(height: 1),
            alignment: .bottom
        )
    }

    private func statColumn(key: String, value: String) -> some View {
        VStack(spacing: 4) {
            Text(key)
                .font(.body(10, weight: .extraBold)).tracking(1.0)
                .foregroundStyle(subtleText)
            Text(value)
                .font(.display(22, weight: .bold)).tracking(-0.3)
                .foregroundStyle(primaryText)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity)
    }

    private var divider: some View {
        Rectangle()
            .fill(dividerColor)
            .frame(width: 1, height: 28)
    }

    private var distanceText: String {
        guard let d = detail?.distance_mi, d > 0 else { return "—" }
        return d.truncatingRemainder(dividingBy: 1) == 0
            ? "\(Int(d)) mi"
            : String(format: "%.1f mi", d)
    }
    private var paceText: String {
        if let p = detail?.pace, !p.isEmpty { return "\(p)/mi" }
        if let sec = detail?.pace_s_per_mi, sec > 0 {
            return String(format: "%d:%02d/mi", sec / 60, sec % 60)
        }
        return "—"
    }
    private var movingText: String { detail?.time_moving ?? detail?.time_elapsed ?? "—" }

    // MARK: - 3. Secondary stats

    private var secondaryStats: some View {
        HStack(spacing: 0) {
            statColumn(key: "AVG HR", value: hrText)
            divider
            statColumn(key: "ELEV GAIN", value: elevText)
            divider
            // 2026-06-01 round 7 · design renames TEMP → CONDITIONS and
            // shows a range "60° → 74°" when backend ships both start
            // and end. Single value falls back to "{N}°" (no °F · the
            // arrow + range column header carries the unit).
            statColumn(key: "CONDITIONS", value: conditionsText)
        }
        .padding(.vertical, 14)
        .background(sectionBg)
        .overlay(
            Rectangle()
                .fill(dividerColor)
                .frame(height: 1),
            alignment: .bottom
        )
    }

    private var hrText: String { detail?.hr_avg.map { "\($0)" } ?? "—" }
    private var elevText: String {
        guard let ft = detail?.elev_gain_ft, ft > 0 else { return "—" }
        return "\(ft) ft"
    }
    /// Conditions column · range when both ends present, single-value
    /// fallback otherwise. RunDetail.temp_f is single-value today (the
    /// avg over the run); when backend adds temp_start_f / temp_end_f
    /// the range renders cleanly.
    private var conditionsText: String {
        guard let t = detail?.temp_f else { return "—" }
        // Single value fallback. Range support waits for backend.
        return "\(Int(t.rounded()))°"
    }

    // MARK: - 4. Route map

    private func routeMap(polyline: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            RoutePolylineCard(
                polyline: polyline,
                accent: accent,
                distanceMi: detail?.distance_mi ?? 0,
                elevGainFt: detail?.elev_gain_ft ?? 0
            )
            .frame(height: 196)
            .padding(.horizontal, 18)
            .padding(.vertical, 18)
        }
        .background(sectionBg)
        .overlay(
            Rectangle()
                .fill(dividerColor)
                .frame(height: 1),
            alignment: .bottom
        )
    }

    // MARK: - 5. Mile splits

    @ViewBuilder
    private var mileSplits: some View {
        if let splits = detail?.splits, !splits.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                Text("MILE SPLITS")
                    .font(.body(11, weight: .extraBold)).tracking(1.5)
                    .foregroundStyle(subtleText)
                let paces = splits.compactMap { paceSecForSplit($0) }
                let fastest = paces.min() ?? 0
                let slowest = paces.max() ?? 1
                let denom = max(1, slowest - fastest)
                VStack(spacing: 8) {
                    ForEach(splits) { split in
                        SplitRow(
                            split: split,
                            paceSec: paceSecForSplit(split),
                            tint: tintForSplit(split, total: splits.count),
                            fastestSec: fastest,
                            denom: denom,
                            onMesh: onMesh
                        )
                    }
                }
            }
            .padding(.horizontal, 24).padding(.vertical, 18)
            .background(sectionBg)
            .overlay(
                Rectangle()
                    .fill(dividerColor)
                    .frame(height: 1),
                alignment: .bottom
            )
        }
    }

    /// Color a split by phase position · warmup (first ~15% miles) and
    /// cooldown (last ~15%) read as the teal "support" color; work-phase
    /// miles read in the run accent. Tracks the prototype's per-type
    /// pattern without coupling to specific run types.
    private func tintForSplit(_ split: RunSplit, total: Int) -> Color {
        if total < 3 { return accent }
        let i = split.mile - 1
        let warm = max(1, total / 6)
        let cool = max(1, total / 6)
        if i < warm || i >= (total - cool) {
            return Color(hex: 0x5BBFB0)
        }
        return accent
    }

    private func paceSecForSplit(_ s: RunSplit) -> Int {
        guard let pace = s.pace, !pace.isEmpty else { return 0 }
        let parts = pace.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2 else { return 0 }
        return parts[0] * 60 + parts[1]
    }

    // MARK: - 6. Form grid

    @ViewBuilder
    private var formGrid: some View {
        let metrics = formMetrics
        if !metrics.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                Text("FORM")
                    .font(.body(11, weight: .extraBold)).tracking(1.5)
                    .foregroundStyle(subtleText)
                LazyVGrid(columns: gridColumns(count: metrics.count), spacing: 8) {
                    ForEach(metrics, id: \.0) { item in
                        VStack(alignment: .leading, spacing: 3) {
                            Text(item.0)
                                .font(.body(9, weight: .extraBold)).tracking(1.0)
                                .foregroundStyle(subtleText)
                            Text(item.1)
                                .font(.display(18, weight: .bold)).tracking(-0.2)
                                .foregroundStyle(primaryText)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 12).padding(.vertical, 10)
                        .background(chipBg, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                }
            }
            .padding(.horizontal, 24).padding(.vertical, 18)
            .background(sectionBg)
            .overlay(
                Rectangle()
                    .fill(dividerColor)
                    .frame(height: 1),
                alignment: .bottom
            )
        }
    }

    private var formMetrics: [(String, String)] {
        guard let f = detail?.form else { return [] }
        var out: [(String, String)] = []
        if let cad = f.cadence_spm, cad > 0 {
            out.append(("CADENCE", "\(Int(cad.rounded())) spm"))
        }
        if let gct = f.ground_contact_ms, gct > 0 {
            out.append(("GROUND CONTACT", "\(Int(gct.rounded())) ms"))
        }
        if let vo = f.vertical_oscillation_cm, vo > 0 {
            out.append(("VERT OSC", String(format: "%.1f cm", vo)))
        }
        if let pw = f.run_power_w, pw > 0 {
            out.append(("POWER", "\(Int(pw.rounded())) W"))
        }
        return out
    }

    private func gridColumns(count: Int) -> [GridItem] {
        let n = max(1, min(4, count))
        return Array(repeating: GridItem(.flexible(), spacing: 8), count: n)
    }

    // MARK: - 7. How it went

    @ViewBuilder
    private var howItWent: some View {
        if let recap, !recap.verdict.isEmpty || !recap.facts.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    Text("HOW IT WENT")
                        .font(.body(11, weight: .extraBold)).tracking(1.5)
                        .foregroundStyle(subtleText)
                    Spacer()
                    Text(recap.verdict.replacingOccurrences(of: ".", with: "").uppercased())
                        .font(.body(9, weight: .extraBold)).tracking(1.2)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(verdictTint, in: Capsule())
                }
                // 2026-06-02 round 51 · facts + coach_tip share one
                // VStack so every bullet uses the same 7pt spacing.
                // Earlier round-50 fix split them with .padding(.top, 7)
                // on the tip · parent VStack's 12pt + the 7pt → double-
                // gap above the last bullet. Single list = consistent
                // rhythm.
                let bullets: [String] = recap.facts +
                    ((recap.coach_tip ?? "").isEmpty ? [] : [recap.coach_tip!])
                if !bullets.isEmpty {
                    VStack(alignment: .leading, spacing: 7) {
                        ForEach(Array(bullets.enumerated()), id: \.offset) { _, line in
                            HStack(alignment: .top, spacing: 8) {
                                Circle()
                                    .fill(accent)
                                    .frame(width: 4, height: 4)
                                    .padding(.top, 6)
                                Text(line)
                                    .font(.body(13))
                                    .foregroundStyle(mutedText)
                                    .fixedSize(horizontal: false, vertical: true)
                                Spacer(minLength: 0)
                            }
                        }
                    }
                }
                // 2026-06-09 · conditions note (heat adjustment context).
                // recap.conditions_note carries the web's "Heat slowdown:
                // 14.5% · adjusted verdict" copy when the engine applied a
                // heat penalty. Previously only surfaced in RunDetailView;
                // added here so the Today post-run view shows it inline.
                if let cn = recap.conditions_note, !cn.isEmpty {
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "thermometer.medium")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(subtleText)
                            .padding(.top, 2)
                        Text(cn)
                            .font(.body(12))
                            .foregroundStyle(mutedText)
                            .fixedSize(horizontal: false, vertical: true)
                            .lineLimit(3)
                    }
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(chipBg, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                // Per-run-type analysis panel (design_handoff_iphone_postrun).
                // Swaps body by effort:
                //   easy/recovery → AEROBIC STAMP
                //   long          → THE LONG
                //   tempo         → THE TEMPO
                //   intervals     → THE REPS
                HowItWentPanel(
                    effort: hiwEffort,
                    detail: detail,
                    accent: accent,
                    onMesh: onMesh
                )
            }
            .padding(.horizontal, 24).padding(.vertical, 18)
            .background(sectionBg)
        }
    }

    /// 2026-06-01 round 7 · planned-vs-actual triplet
    /// (HEART RATE / PACE / CADENCE) below the verdict + recap.
    @ViewBuilder
    private var comparisonRows: some View {
        let rows = comparisonItems
        if !rows.isEmpty {
            VStack(spacing: 10) {
                ForEach(rows, id: \.0) { (key, value) in
                    HStack {
                        Text(key)
                            .font(.body(11, weight: .extraBold)).tracking(1.5)
                            .foregroundStyle(subtleText)
                        Spacer()
                        Text(value)
                            .font(.body(13, weight: .extraBold)).tracking(-0.2)
                            .foregroundStyle(primaryText)
                    }
                }
            }
            .padding(.top, 14)
            .padding(.horizontal, 0)
        }
    }

    private var comparisonItems: [(String, String)] {
        var out: [(String, String)] = []
        // HR · actual avg vs target band (when both present).
        if let avg = detail?.hr_avg {
            // The target band would ideally come from the workout payload's
            // recommended zone; for now, show actual only · the eyebrow
            // already implies the planned effort.
            out.append(("HEART RATE", "\(avg) avg"))
        }
        // Pace · actual vs target.
        if let pace = detail?.pace, !pace.isEmpty {
            if let plannedPace = plannedPaceLabel {
                out.append(("PACE", "\(pace) avg vs \(plannedPace) target"))
            } else {
                out.append(("PACE", "\(pace) avg"))
            }
        }
        if let cad = detail?.cadence_avg, cad > 0 {
            out.append(("CADENCE", "\(cad) spm"))
        }
        return out
    }

    /// Pull the planned target pace from RunDetail.planned_spec when
    /// the workout had one. Null on easy/long runs without a structured
    /// target.
    private var plannedPaceLabel: String? {
        guard let s = detail?.planned_spec else { return nil }
        let secs: Int? = {
            if let p = s.rep_pace_s_per_mi { return Int(p) }
            if let p = s.tempo_pace_s_per_mi { return Int(p) }
            if let p = s.mp_pace_s_per_mi { return Int(p) }
            return nil
        }()
        guard let s = secs else { return nil }
        return String(format: "%d:%02d", s / 60, s % 60)
    }

    private var verdictTint: Color {
        let v = (recap?.verdict ?? "").lowercased()
        if v.contains("off plan") || v.contains("dnf") { return Color(hex: 0xFC4D64) }
        return Color(hex: 0x1F9A6F)
    }
}

// MARK: - Split row

private struct SplitRow: View {
    let split: RunSplit
    let paceSec: Int
    let tint: Color
    let fastestSec: Int
    let denom: Int
    /// 2026-06-02 round 64 · same context flag as TodayPostRunBody.
    /// SplitRow is a private struct (out of scope of the parent's
    /// helpers), so it takes its own copy. Default false preserves
    /// the cream-context look for the drag-sheet body.
    var onMesh: Bool = false

    private var mutedText: Color { onMesh ? Color.white.opacity(0.78) : Color(hex: 0x4F483F) }
    private var subtleText: Color { onMesh ? Color.white.opacity(0.55) : Color(hex: 0x9A9286) }
    private var trackFill: Color { onMesh ? Color.white.opacity(0.15) : Color(hex: 0xF1EBDF) }

    var body: some View {
        HStack(spacing: 12) {
            Text("\(split.mile)")
                .font(.display(14, weight: .bold))
                .foregroundStyle(mutedText)
                .frame(width: 22, alignment: .leading)
            GeometryReader { geo in
                let frac = denom > 0 ? CGFloat(paceSec - fastestSec) / CGFloat(denom) : 0
                let w = geo.size.width * (0.25 + 0.75 * frac)
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(trackFill)
                    Capsule()
                        .fill(tint.opacity(0.85))
                        .frame(width: max(28, w))
                }
            }
            .frame(height: 8)
            Text(split.pace ?? "—")
                .font(.body(12, weight: .bold))
                .foregroundStyle(mutedText)
                .frame(width: 50, alignment: .trailing)
            Text(split.hr.map { "\($0)" } ?? "—")
                .font(.body(11, weight: .semibold))
                .foregroundStyle(subtleText)
                .frame(width: 32, alignment: .trailing)
        }
    }
}

// MARK: - Route polyline card
//
// Renders the Google-polyline route as a stroked path on a dark card.
// Visual parity with the web's RouteMap.tsx (Leaflet + CartoDB tiles) ·
// same coloring + endpoint markers + mile dots, just no basemap. The
// MapKit-with-tiles upgrade can come later · this gets the line clean.
//
// Web parity:
//   · 5 pace quintile buckets across the polyline's own progress
//     · coral #FC4D64 → orange #FF8847 → amber #F3AD38 → teal #48B3B5 → blue #27B4E0
//   · start marker · green ring #14C08C around a dark fill
//   · finish marker · coral #FC4D64 fill
//   · mile markers · white dots along the line at integer-mile crossings
//     (Haversine walk)
//   · coral baseline underlayer drawn first · belt-and-suspenders so
//     the line is always visible even if the bucket walker errors
//   · 5pt stroke · round caps + joins

private let PACE_BUCKETS: [Color] = [
    Color(hex: 0xFC4D64),  // fastest · coral
    Color(hex: 0xFF8847),  // orange
    Color(hex: 0xF3AD38),  // amber
    Color(hex: 0x48B3B5),  // teal
    Color(hex: 0x27B4E0),  // slowest · blue
]
private let START_RING_COLOR = Color(hex: 0x14C08C)
private let FINISH_FILL_COLOR = Color(hex: 0xFC4D64)
private let BASELINE_UNDER_COLOR = Color(hex: 0xFC4D64)

private struct RoutePolylineCard: View {
    let polyline: String
    let accent: Color
    let distanceMi: Double
    let elevGainFt: Int

    var body: some View {
        let points = decodePolyline(polyline)
        let coords = points.map { CLLocationCoordinate2D(latitude: $0.0, longitude: $0.1) }
        ZStack {
            if coords.count >= 2 {
                // 2026-06-02 round 11 · MapKit basemap with the route
                // overlaid · matches the web's RouteMap.tsx (Leaflet +
                // CartoDB dark tiles) by using MapKit's standard
                // dark-emphasis style. Apple's basemap renders street
                // grid + parks + freeways under the polyline so the
                // run reads with real geography. Polyline = coral
                // stroke; start = green ring; finish = coral dot.
                routeMap(coords: coords)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    // Force dark color scheme so the standard map
                    // renders dark tiles (per the design's dark theme).
                    .environment(\.colorScheme, .dark)
                    // 2026-06-02 round 63 · David: "this completed run
                    // panel tries to scroll or move off screen left to
                    // right." The Map view was intercepting touches even
                    // though interactionModes is []. MapKit still hit-
                    // tests the view region for gesture recognition; that
                    // pulled the page's vertical scroll into a horizontal
                    // drag whenever the finger landed on the map. Killing
                    // hit-testing makes the map purely visual — touches
                    // pass through to the parent ScrollView's pan.
                    .allowsHitTesting(false)
            } else {
                // True no-GPS state · matches the web's "NO GPS TRACK
                // FOR THIS RUN" empty card. RoutePolylineCard is a
                // private struct out of TodayPostRunBody's scope, so
                // the context-aware helpers (round 62) don't reach
                // here — literal dark fill is correct for both
                // contexts (the empty card stays visually dark
                // whether the parent is cream or mesh).
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Color(hex: 0x14110D))
                    .overlay(
                        VStack(spacing: 8) {
                            Image(systemName: "mountain.2.fill")
                                .font(.system(size: 22, weight: .medium))
                                .foregroundStyle(.white.opacity(0.3))
                            Text("NO GPS TRACK")
                                .font(.body(10, weight: .extraBold)).tracking(1.4)
                                .foregroundStyle(.white.opacity(0.45))
                        }
                    )
            }
            // 2026-06-02 round 13 · the X.X MI · ↗ Y FT overlay pill
            // is retired. Distance + elev already live in the stats
            // trio (DISTANCE) + secondary stats (ELEV GAIN) directly
            // above the map · re-stating them on the route was just
            // chrome noise.
        }
    }

    @ViewBuilder
    private func routeMap(coords: [CLLocationCoordinate2D]) -> some View {
        let region = boundingRegion(for: coords, paddingFactor: 1.18)
        Map(initialPosition: .region(region), interactionModes: []) {
            MapPolyline(coordinates: coords)
                .stroke(BASELINE_UNDER_COLOR, style: StrokeStyle(
                    lineWidth: 5, lineCap: .round, lineJoin: .round
                ))
            if let first = coords.first {
                // Empty title string suppresses MapKit's default label
                // floater · the custom circle IS the marker, we don't
                // want "Start" / "Finish" text floating next to it.
                Annotation("", coordinate: first, anchor: .center) {
                    Circle()
                        .fill(Color(hex: 0x080B0F))
                        .frame(width: 14, height: 14)
                        .overlay(Circle().stroke(START_RING_COLOR, lineWidth: 2.5))
                        .accessibilityLabel("Start")
                }
            }
            if let last = coords.last {
                Annotation("", coordinate: last, anchor: .center) {
                    Circle()
                        .fill(FINISH_FILL_COLOR)
                        .frame(width: 14, height: 14)
                        .accessibilityLabel("Finish")
                }
            }
        }
        // Standard map style with muted emphasis (less label noise) ·
        // combined with .environment(\.colorScheme, .dark) above gives
        // the dark-tile look that mirrors the web's CartoDB dark base.
        .mapStyle(.standard(elevation: .flat, emphasis: .muted))
    }

    /// MKCoordinateRegion fitting all points with a padding multiplier
    /// (1.18 = ~9% breathing room on each edge).
    private func boundingRegion(for coords: [CLLocationCoordinate2D], paddingFactor: Double) -> MKCoordinateRegion {
        let lats = coords.map { $0.latitude }
        let lons = coords.map { $0.longitude }
        let minLat = lats.min() ?? 0
        let maxLat = lats.max() ?? 0
        let minLon = lons.min() ?? 0
        let maxLon = lons.max() ?? 0
        let center = CLLocationCoordinate2D(
            latitude: (minLat + maxLat) / 2,
            longitude: (minLon + maxLon) / 2
        )
        // Minimum span keeps very short runs from zooming in to a
        // single building (where the polyline becomes invisible).
        let latDelta = max(0.0035, (maxLat - minLat) * paddingFactor)
        let lonDelta = max(0.0035, (maxLon - minLon) * paddingFactor)
        return MKCoordinateRegion(
            center: center,
            span: MKCoordinateSpan(latitudeDelta: latDelta, longitudeDelta: lonDelta)
        )
    }

    private var overlayText: String {
        let mi = distanceMi.truncatingRemainder(dividingBy: 1) == 0
            ? "\(Int(distanceMi)) MI"
            : String(format: "%.1f MI", distanceMi)
        if elevGainFt > 0 { return "\(mi) · ↗ \(elevGainFt) FT" }
        return mi
    }
}

/// Walk the polyline by Haversine distance and emit the
/// already-normalized CGPoints that fall on integer-mile boundaries.
/// Web parity: mileMarkersAlongPolyline in lib/route/polyline.ts.
private func mileMarkerPoints(
    points: [(Double, Double)],
    normalized: [CGPoint],
) -> [(CGFloat, CGFloat)] {
    guard points.count >= 2 && normalized.count == points.count else { return [] }
    var markers: [(CGFloat, CGFloat)] = []
    var distMi: Double = 0
    var nextMile: Double = 1
    for i in 1..<points.count {
        let (lat1, lon1) = points[i - 1]
        let (lat2, lon2) = points[i]
        let segMi = haversineMi(lat1: lat1, lon1: lon1, lat2: lat2, lon2: lon2)
        if segMi <= 0 { continue }
        let prevDist = distMi
        distMi += segMi
        // Emit one marker for every integer-mile boundary this segment
        // crosses (a single very long segment can cross multiple).
        while distMi >= nextMile {
            let frac = (nextMile - prevDist) / segMi
            let x = normalized[i - 1].x + CGFloat(frac) * (normalized[i].x - normalized[i - 1].x)
            let y = normalized[i - 1].y + CGFloat(frac) * (normalized[i].y - normalized[i - 1].y)
            markers.append((x, y))
            nextMile += 1
            if markers.count > 50 { return markers }   // sanity cap
        }
    }
    return markers
}

/// Great-circle distance in miles. Earth radius 3958.8.
private func haversineMi(lat1: Double, lon1: Double, lat2: Double, lon2: Double) -> Double {
    let R = 3958.8
    let dLat = (lat2 - lat1) * .pi / 180
    let dLon = (lon2 - lon1) * .pi / 180
    let a = sin(dLat/2) * sin(dLat/2)
        + cos(lat1 * .pi / 180) * cos(lat2 * .pi / 180)
        * sin(dLon/2) * sin(dLon/2)
    let c = 2 * atan2(sqrt(a), sqrt(1 - a))
    return R * c
}

/// Decode a Google polyline (precision 5) into an array of (lat, lon).
private func decodePolyline(_ encoded: String) -> [(Double, Double)] {
    var out: [(Double, Double)] = []
    var index = encoded.startIndex
    var lat = 0, lon = 0
    while index < encoded.endIndex {
        var result = 0, shift = 0, b: Int
        repeat {
            guard index < encoded.endIndex else { break }
            b = Int(encoded[index].asciiValue ?? 0) - 63
            index = encoded.index(after: index)
            result |= (b & 0x1F) << shift
            shift += 5
        } while b >= 0x20
        let dLat = (result & 1) != 0 ? ~(result >> 1) : (result >> 1)
        lat += dLat
        result = 0; shift = 0
        repeat {
            guard index < encoded.endIndex else { break }
            b = Int(encoded[index].asciiValue ?? 0) - 63
            index = encoded.index(after: index)
            result |= (b & 0x1F) << shift
            shift += 5
        } while b >= 0x20
        let dLon = (result & 1) != 0 ? ~(result >> 1) : (result >> 1)
        lon += dLon
        out.append((Double(lat) / 1e5, Double(lon) / 1e5))
    }
    return out
}

/// Normalize (lat, lon) points to the card's drawable area, preserving
/// aspect, centering, and inverting latitude (lat increases northward,
/// y increases downward).
private func normalize(points: [(Double, Double)], size: CGSize, padding: CGFloat) -> [CGPoint] {
    let lats = points.map { $0.0 }
    let lons = points.map { $0.1 }
    let minLat = lats.min() ?? 0
    let maxLat = lats.max() ?? 0
    let minLon = lons.min() ?? 0
    let maxLon = lons.max() ?? 0
    let latSpan = max(0.00001, maxLat - minLat)
    let lonSpan = max(0.00001, maxLon - minLon)
    // Approximate lat-lon → x-y aspect by collapsing longitude with
    // cos(midLat). Good enough for a stylized card.
    let midLat = (minLat + maxLat) / 2
    let lonScale = cos(midLat * .pi / 180)
    let aspect = (lonSpan * lonScale) / latSpan
    let drawW = size.width - 2 * padding
    let drawH = size.height - 2 * padding
    let routeAspect = aspect
    let cardAspect = drawW / drawH
    let scale: CGFloat
    var offsetX: CGFloat = 0
    var offsetY: CGFloat = 0
    if routeAspect > cardAspect {
        scale = drawW / CGFloat(lonSpan * lonScale)
        let usedH = CGFloat(latSpan) * scale
        offsetY = (drawH - usedH) / 2
    } else {
        scale = drawH / CGFloat(latSpan)
        let usedW = CGFloat(lonSpan * lonScale) * scale
        offsetX = (drawW - usedW) / 2
    }
    return points.map { (lat, lon) in
        let x = padding + offsetX + CGFloat((lon - minLon) * lonScale) * scale
        // 2026-06-02 round 9 · fix wide-shallow-route bug. The previous
        // formula `y = padding + offsetY + drawH - (lat - minLat) * scale`
        // added an extra drawH term that pushed every point ~drawH pixels
        // below the card's frame for routes wider than tall (David's 5K:
        // 3.5km wide × 500m tall, routeAspect=7.35 vs cardAspect=1.76).
        // Result: polyline rendered 200+pt below the map card · only the
        // top edge of the line and the start/finish dots peeked out at
        // the bottom edge of the surrounding white sheet.
        //
        // Correct formula: y from maxLat (top of card · low y) to
        // minLat (bottom · high y), offset by offsetY for vertical
        // centering in the width-fit branch. Inverts lat → y axis
        // (lat increases northward; screen y increases downward).
        let y = padding + offsetY + CGFloat(maxLat - lat) * scale
        return CGPoint(x: x, y: y)
    }
}

// (dropTrailingPeriod helper retired 2026-06-01 · the verdict + facts
//  fallback for the win line is gone, recap.win is the source of truth.)
