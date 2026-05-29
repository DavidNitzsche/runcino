//
//  FaffAdapter.swift
//
//  Pure functions · existing iOS models (Briefing / WatchWorkout /
//  PlanWeek / ReadinessSnapshot) → Faff payload triple
//  (PosterPayload / SiblingPayload / WeekStripPayload).
//
//  Mirrors `web-v2/lib/faff/glance-adapter.ts` — the day-state resolver,
//  hero verb dictionary, and 4-char WeekStrip vocabulary all line up
//  one-for-one with the web adapter (per design/resolver/states.md
//  + design/components/WeekStrip.md, locked 2026-05-28).
//
//  Cardinal Rule #1 (build it right): adapter is pure functions, no
//  side effects, no LLM calls. Same input → same output.
//

import Foundation
import SwiftUI

enum FaffAdapter {

    // ──────────────────────────────────────────────────────────────────
    // 1. Day-state resolver
    // ──────────────────────────────────────────────────────────────────

    /// Mirrors `resolveDayState()` in web-v2/lib/faff/glance-adapter.ts.
    /// Priority order (locked 2026-05-28):
    ///   1. new_user · no plan attached
    ///   2. race_week · daysToRace ≤ 7  (deferred · no race signal in PlanWeek)
    ///   2b. skipped · runner explicitly tapped SKIP on the poster — sits
    ///      *after* race-week (race takeover is sacred) but *before* the
    ///      base-4 so the skipped surface wins over the original
    ///      easy/quality/long for today. Mirrors
    ///      web-v2/lib/faff/glance-adapter.ts:73.
    ///   3. done_nailed · ran today (≥ 0.5 mi recorded — we approximate via
    ///      the absence of a planned workout + presence of a logged run;
    ///      `briefing.mode == "post-run"` is the strongest signal we have
    ///      without a Run feed.)
    ///   4. base 4 · rest / long / quality / easy keyed off plan day type
    static func resolveDayState(
        plan: PlanWeek?,
        briefing: Briefing?,
        workout: WatchWorkout?,
        skipped: Bool = false
    ) -> FaffDayState {
        // 1. new_user · no plan or empty plan
        guard let plan, !plan.days.isEmpty else { return .new_user }

        // 3. done · briefing mode signals a post-run state
        if briefing?.mode == "post-run" {
            return .done_nailed
        }

        // race_week — when the briefing flips into race mode the post-run
        // doctrine still applies, but we surface race week early too.
        if briefing?.mode == "race-week" || briefing?.mode == "race-day" {
            return .race_week
        }

        // 2b. skipped · explicit skip wins over the original base-4 surface
        // for today (but sits behind race-week + done, like the web).
        if skipped { return .skipped }

        // 6. base 4 · keyed off today's plan row
        let today = plan.days.first(where: { $0.is_today })
        let t = (today?.type ?? "").lowercased()
        switch t {
        case "rest":      return .rest
        case "long":      return .long
        case "threshold", "tempo", "intervals", "fartlek", "progression",
             "quality":   return .quality
        case "easy", "shakeout", "recovery":
            return .easy
        default:
            // Unknown / unplanned → easy is the safest default that still
            // reads as "go run."
            return .easy
        }
    }

    // ──────────────────────────────────────────────────────────────────
    // 2. Gradient lookup
    // ──────────────────────────────────────────────────────────────────

    /// Mirrors `GRADIENT_BY_STATE` in glance-adapter.ts.
    static func gradient(for state: FaffDayState) -> LinearGradient {
        switch state {
        case .easy:          return Theme.Gradient.easy
        case .quality:       return Theme.Gradient.quality
        case .long:          return Theme.Gradient.long
        case .rest:          return Theme.Gradient.rest
        case .done_nailed:   return Theme.Gradient.done
        case .done_ease_off: return Theme.Gradient.ease
        case .niggle:        return Theme.Gradient.niggle
        case .sick:          return Theme.Gradient.sick
        case .missed:        return Theme.Gradient.missed
        case .race_week:     return Theme.Gradient.race
        case .new_user:      return Theme.Gradient.new
        case .skipped:       return Theme.Gradient.skip
        }
    }

    // ──────────────────────────────────────────────────────────────────
    // 3. Hero verb
    // ──────────────────────────────────────────────────────────────────

    /// Mirrors `heroVerb()` in glance-adapter.ts. Single deterministic
    /// value per state for v1 (no rotation).
    static func heroVerb(state: FaffDayState, todayMi: Double?) -> String {
        switch state {
        case .easy:
            if let mi = todayMi, mi > 0 { return "EASY \(formatMi(mi))." }
            return "EASY."
        case .quality:
            if let mi = todayMi, mi > 0 { return "QUALITY \(formatMi(mi))." }
            return "QUALITY."
        case .long:
            if let mi = todayMi, mi > 0 { return "LONG \(formatMi(mi))." }
            return "GO LONG."
        case .rest:          return "REST."
        case .done_nailed:   return "NAILED IT."
        case .done_ease_off: return "EASE OFF TOMORROW."
        case .niggle:        return "LISTEN TO IT."
        case .sick:          return "RECOVER FIRST."
        case .missed:        return "MISSED THE TARGETS."
        case .race_week:     return "RACE WEEK."
        case .new_user:      return "WELCOME TO FAFF."
        case .skipped:       return "SKIPPED TODAY."
        }
    }

    // ──────────────────────────────────────────────────────────────────
    // 4. Poster
    // ──────────────────────────────────────────────────────────────────

    static func buildPoster(
        state: FaffDayState,
        plan: PlanWeek?,
        readiness: ReadinessSnapshot?,
        workout: WatchWorkout?,
        phaseLabel: String? = nil
    ) -> PosterPayload {
        let today = plan?.days.first(where: { $0.is_today })
        let todayMi = today?.distance_mi

        let eyebrow = composeEyebrow(phase: phaseLabel)
        let phaseTag = phaseLabel.map { $0.uppercased() }
        let verb = heroVerb(state: state, todayMi: todayMi)

        // Stat trio — base 4 vs done vs rest vs race_week. Mirrors
        // `buildStatTrio()` in glance-adapter.ts.
        let statTrio: [FaffStat]? = {
            switch state {
            case .easy, .quality, .long:
                return [
                    FaffStat(
                        value: (todayMi ?? 0) > 0 ? formatMi(todayMi!) : "—",
                        label: "PLANNED MI"
                    ),
                    FaffStat(
                        value: readiness?.score.map { "\($0)" } ?? "—",
                        label: "READINESS"
                    ),
                    FaffStat(
                        value: readiness?.label?.uppercased() ?? "—",
                        label: "TODAY"
                    ),
                ]
            case .done_nailed, .done_ease_off:
                let banked = workout?.distanceMi ?? todayMi ?? 0
                return [
                    FaffStat(value: formatMi(banked), label: "BANKED MI"),
                    FaffStat(value: "—", label: "WEEK MI"),
                    FaffStat(value: "✓", label: "PLAN HIT", valueColor: .green),
                ]
            case .rest:
                return [
                    FaffStat(
                        value: readiness?.score.map { "\($0)" } ?? "—",
                        label: "READINESS"
                    ),
                    FaffStat(
                        value: readiness?.label?.uppercased() ?? "—",
                        label: "TODAY"
                    ),
                    FaffStat(value: "—", label: "WEEK MI"),
                ]
            case .race_week:
                return [
                    FaffStat(value: "—", label: "DAYS", valueColor: .race),
                    FaffStat(value: "—", label: "WEEK MI"),
                    FaffStat(
                        value: readiness?.score.map { "\($0)" } ?? "—",
                        label: "READINESS"
                    ),
                ]
            case .new_user, .missed, .niggle, .sick:
                return nil
            case .skipped:
                // P-SKIP (Phase 12) · skipped poster is verb + gradient only,
                // no stat trio. Mirrors glance-adapter.ts:264-269 — the body
                // tiles (sleep/RHR/HRV/load) live on the Sibling.
                return nil
            }
        }()

        // Hero number for done states · mileage banked.
        let heroNumber: FaffHeroNumber? = {
            switch state {
            case .done_nailed, .done_ease_off:
                let banked = workout?.distanceMi ?? todayMi ?? 0
                return FaffHeroNumber(
                    value: formatMi(banked),
                    unit: "MI",
                    duration: nil
                )
            default:
                return nil
            }
        }()

        return PosterPayload(
            state: state,
            gradient: gradient(for: state),
            eyebrow: eyebrow,
            verb: verb,
            verbSuffix: nil,
            prose: nil,
            phaseTag: phaseTag,
            statTrio: statTrio,
            heroNumber: heroNumber,
            daysCountdown: nil
        )
    }

    // ──────────────────────────────────────────────────────────────────
    // 5. Sibling
    // ──────────────────────────────────────────────────────────────────

    static func buildSibling(
        state: FaffDayState,
        readiness: ReadinessSnapshot?,
        plan: PlanWeek?
    ) -> SiblingPayload {
        let title = siblingTitle(for: state)
        let tiles = bodyTiles(readiness: readiness)

        // Per-state prose mirrors glance-adapter.ts.
        let prose: String? = {
            switch state {
            case .easy:
                return "If you can't chat the whole way, you're going too hard."
            case .quality:
                return "Lock the target pace. Form first, splits hold themselves."
            case .long:
                return "Keep it aerobic. Fuel by 45 minutes. Time on feet is the point."
            case .rest:
                return nil
            case .done_nailed:
                return "In the books. Refuel within the hour, sleep early."
            case .done_ease_off:
                return "Big day banked. Tomorrow goes easier than the plan says."
            case .race_week:
                return "Volume drops, intensity stays sharp. Trust the taper."
            case .niggle:
                return "Listen to it. The body is the signal."
            case .sick:
                return "Plan paused. Resumes at easy when you mark recovered."
            case .missed:
                return "Yesterday is gone. Catch up or move on — both protect the plan."
            case .new_user:
                return "Connect Strava and pick a race. The rest builds from there."
            case .skipped:
                // P-SKIP (Phase 12) · reassurance prose. Mirrors
                // glance-adapter.ts:378-380 — one day off is not the end of
                // a block. Plan picks back up tomorrow exactly as written.
                return "You called it. The plan picks back up tomorrow exactly as written. One day off is not the end of a block."
            }
        }()

        return SiblingPayload(
            state: state,
            title: title,
            tiles: tiles,
            prose: prose,
            actionTileIndex: state == .done_ease_off ? 0 : nil
        )
    }

    private static func siblingTitle(for state: FaffDayState) -> FaffSiblingTitle {
        switch state {
        case .easy, .quality, .long, .rest:
            return FaffSiblingTitle(main: "THE BODY", suffix: "TODAY")
        case .done_nailed:
            return FaffSiblingTitle(main: "BANKED IT", suffix: "TODAY")
        case .done_ease_off:
            return FaffSiblingTitle(main: "WENT BIG", suffix: "EASE OFF")
        case .niggle:
            return FaffSiblingTitle(main: "BODY ALERT", suffix: "WATCH IT")
        case .sick:
            return FaffSiblingTitle(main: "PLAN PAUSED", suffix: "RECOVER")
        case .missed:
            return FaffSiblingTitle(main: "MISSED", suffix: "CATCH UP?")
        case .race_week:
            return FaffSiblingTitle(main: "RACE WEEK", suffix: "TAPER ON")
        case .new_user:
            return FaffSiblingTitle(main: "SET UP", suffix: "GET ROLLING")
        case .skipped:
            // P-SKIP (Phase 12) · "TOMORROW · WE GO" mirrors
            // glance-adapter.ts:291.
            return FaffSiblingTitle(main: "TOMORROW", suffix: "WE GO")
        }
    }

    /// SLEEP / RHR / HRV / LOAD tiles.
    ///
    /// Phase 12 (2026-05-28) — mirrors `bodyTiles()` in
    /// web-v2/lib/faff/glance-adapter.ts:384-443. The web adapter
    /// derives delta-based amber / over coloring from the same
    /// (current, baseline) pairs we now decode in ReadinessSnapshot:
    ///
    ///   · SLEEP: amber when 7d avg < 7h, else green.
    ///   · RHR  : amber when current ≥ baseline + 5 (elevated).
    ///   · HRV  : amber when current ≤ baseline − 8 (suppressed).
    ///   · LOAD : amber < 0.8 (detrain risk), over > 1.3 (spike risk),
    ///            else green (sweet spot).
    ///
    /// Tiles render only when their underlying values are present —
    /// no `—` placeholders. Empty array when no health data has
    /// synced yet (matches the web behavior of skipping a tile when
    /// its inputs are nil).
    private static func bodyTiles(readiness: ReadinessSnapshot?) -> [FaffMiniTile] {
        var tiles: [FaffMiniTile] = []

        // SLEEP · 7d avg hours. Web threshold: <7h = amber.
        if let s = readiness?.sleep7Avg {
            let isLow = s < 7
            tiles.append(FaffMiniTile(
                label: "SLEEP",
                value: String(format: "%.1f", s),
                valueUnit: "h",
                valueColor: isLow ? .amber : .green,
                meta: "7d avg",
                metaStrong: nil,
                dot: isLow ? .amber : .green
            ))
        }

        // RHR · current bpm + signed delta vs baseline.
        // Web threshold: delta ≥ +5 bpm = amber.
        if let cur = readiness?.rhrCurrent, let base = readiness?.rhrBaseline {
            let delta = cur - base
            let elevated = delta >= 5
            let sign = delta >= 0 ? "+" : ""
            tiles.append(FaffMiniTile(
                label: "RHR",
                value: "\(cur)",
                valueUnit: "bpm",
                valueColor: elevated ? .amber : .default,
                meta: "\(sign)\(delta) vs base",
                metaStrong: nil,
                dot: elevated ? .amber : .green
            ))
        }

        // HRV · current ms + signed delta vs baseline.
        // Web threshold: delta ≤ −8 ms = amber (suppressed).
        if let cur = readiness?.hrvCurrent, let base = readiness?.hrvBaseline {
            let delta = cur - base
            let suppressed = delta <= -8
            let sign = delta >= 0 ? "+" : ""
            tiles.append(FaffMiniTile(
                label: "HRV",
                value: "\(cur)",
                valueUnit: "ms",
                valueColor: suppressed ? .amber : .default,
                meta: "\(sign)\(delta) vs base",
                metaStrong: nil,
                dot: suppressed ? .amber : .green
            ))
        }

        // LOAD · ACWR (acute:chronic workload ratio).
        // Web thresholds: > 1.3 = over (spike risk), < 0.8 = amber
        // (detrain risk), 0.8–1.3 = green (sweet spot).
        if let acwr = readiness?.loadAcwr {
            let hot = acwr > 1.3
            let cold = acwr < 0.8
            let metaText = hot ? "spike risk"
                         : cold ? "detrain risk"
                         : "sweet spot"
            let color: FaffValueColor = hot ? .over : (cold ? .amber : .green)
            let dotColor: FaffDotColor = hot ? .over : (cold ? .amber : .green)
            tiles.append(FaffMiniTile(
                label: "LOAD",
                value: String(format: "%.2f", acwr),
                valueUnit: nil,
                valueColor: color,
                meta: metaText,
                metaStrong: nil,
                dot: dotColor
            ))
        }

        return tiles
    }

    // ──────────────────────────────────────────────────────────────────
    // 6. WeekStrip
    // ──────────────────────────────────────────────────────────────────

    /// Closed 4-char vocabulary per design/components/WeekStrip.md
    /// §"Type label vocabulary" (locked 2026-05-28). Mirrors
    /// `typeLabel()` in glance-adapter.ts.
    static func typeLabel(plannedType: String, plannedLabel: String?) -> String {
        let t = plannedType.lowercased()
        switch t {
        case "rest":     return "REST"
        case "race":     return "RACE"
        case "long":     return "LONG"
        case "easy", "shakeout", "recovery":
            return "EASY"
        case "cross", "strength":
            return "XTRN"
        case "fartlek":   return "FART"
        case "tempo":     return "TMPO"
        case "threshold": return "THRS"
        case "intervals": return "INTS"
        case "quality":   return "QUAL"
        default:
            let sub = (plannedLabel ?? "").lowercased()
            if sub.contains("×") || sub.contains("x") { return "INTS" }
            if sub.contains("tempo") { return "TMPO" }
            if sub.contains("thr") { return "THRS" }
            return "—"
        }
    }

    static func buildWeekStrip(plan: PlanWeek?, todaySkipped: Bool = false) -> WeekStripPayload {
        guard let plan else {
            return WeekStripPayload(
                weekStart: "",
                days: [],
                plannedMi: 0,
                completedMi: 0
            )
        }

        let todayIso = plan.today_iso
        var days: [FaffWeekDay] = plan.days.map { d in
            FaffWeekDay(
                date: d.date_iso,
                dow: d.dow,
                plannedType: d.type,
                plannedDistance: d.distance_mi > 0 ? d.distance_mi : nil,
                plannedTypeLabel: typeLabel(
                    plannedType: d.type,
                    plannedLabel: d.sub_label
                ),
                // Phase 17 (2026-05-28) — heuristic retired. The server now
                // resolves the canonical strava activity per day via
                // canonicalMileageByDay (mirroring glance-state.ts), so DONE
                // checkmarks reflect a real logged run instead of
                // `is_past && type != "rest"`.
                completedRunId: d.completedRunId,
                isToday: d.is_today,
                isFuture: !d.is_today && !d.is_past
            )
        }

        // P-SKIP 2026-05-28 · when today is skipped, the WeekStrip card
        // mirrors the Poster's `skipped` state — dim accent, em-dash
        // mileage, SKIP label. Mirrors the web override in
        // lib/faff/glance-adapter.ts buildWeekStrip.
        if todaySkipped, let idx = days.firstIndex(where: { $0.isToday }) {
            let original = days[idx]
            days[idx] = FaffWeekDay(
                date: original.date,
                dow: original.dow,
                plannedType: "rest",
                plannedDistance: nil,
                plannedTypeLabel: "SKIP",
                completedRunId: original.completedRunId,
                isToday: true,
                isFuture: false
            )
        }

        let plannedSum = days.reduce(0.0) { $0 + ($1.plannedDistance ?? 0) }
        // Phase 17 (2026-05-28) — completed-mi rollup. PlanDay now carries
        // `done_mi` (canonical, dedupe'd) so the WeekStrip header agrees
        // with /log and stops reading "0 / N mi" for non-empty weeks.
        let completedSum = plan.days.reduce(0.0) { $0 + ($1.done_mi ?? 0) }

        return WeekStripPayload(
            weekStart: plan.week_start_iso ?? todayIso,
            days: days,
            plannedMi: plannedSum,
            completedMi: completedSum
        )
    }

    // ──────────────────────────────────────────────────────────────────
    // helpers
    // ──────────────────────────────────────────────────────────────────

    private static func formatMi(_ mi: Double) -> String {
        if mi <= 0 { return "0" }
        // Show integer when whole, one decimal otherwise.
        if mi.truncatingRemainder(dividingBy: 1) == 0 {
            return String(Int(mi))
        }
        return String(format: "%.1f", mi)
    }

    /// "THU · MAY 28 · BASE"
    private static func composeEyebrow(phase: String?) -> String {
        let fmt = DateFormatter()
        fmt.dateFormat = "E · MMM d"
        let date = fmt.string(from: Date()).uppercased()
        if let phase, !phase.isEmpty {
            return "\(date) · \(phase.uppercased())"
        }
        return date
    }

    // ──────────────────────────────────────────────────────────────────
    // 7. Training / Plan-surface builders
    //
    // Mirrors the web /training surface (web-v2/app/training/page.tsx)
    // which feeds three coordinated widgets — PhaseStrip, PlanArc (=
    // VolumeArc on iPhone), and WeekAhead (= WeekAheadGrid on iPhone).
    //
    // Source of truth: web-v2/lib/coach/training-state.ts → TrainingState.
    // On the iPhone, that loader's output ships as the `TrainingState`
    // model in API.swift (decoded from /api/training/state). The rich
    // PlanWeek shape the web surface uses is mirrored as
    // `TrainingPlanWeek` on iPhone — NOT to be confused with the simpler
    // Mon-Sun PlanWeek (/api/plan/week) that powers the /today
    // WeekStrip. Both names exist on the iPhone side; these adapters
    // accept the rich TrainingState (so we hit parity with the web).
    //
    // The instructions also asked for PlanWeek-keyed signatures as a
    // fallback for the simpler shape. We provide both — TrainingState
    // overloads carry full fidelity; PlanWeek overloads degrade to the
    // best info available (e.g. a 5-block default phase strip flagged
    // as approximation, since the simple shape lacks phase metadata).
    // ──────────────────────────────────────────────────────────────────

    // ── 7.1 PhaseStrip — derive blocks from the plan arc ──

    /// Build the phase strip from the rich TrainingState. Phases ship
    /// with explicit week-index ranges from the loader, so this is a
    /// straight pass-through (preserving the canonical BASE → BUILD →
    /// PEAK → TAPER → RACE order via PhaseStrip's own order constant).
    static func buildPhaseStrip(state: TrainingState?) -> [PhaseBlock] {
        guard let phases = state?.phases else { return defaultPhaseBlocks() }
        // Empty phases (legacy plan before phase rows were generated) →
        // 5-block default flagged as approximation.
        if phases.isEmpty { return defaultPhaseBlocks() }
        return phases.map {
            PhaseBlock(
                label: $0.label.uppercased(),
                startWeekIdx: $0.startWeekIdx,
                endWeekIdx: $0.endWeekIdx
            )
        }
    }

    /// PlanWeek fallback — the simpler Mon-Sun shape doesn't carry
    /// phase metadata, so this returns the 5-block default. Documented
    /// open gap (see file header comment).
    static func buildPhaseStrip(plan: PlanWeek?) -> [PhaseBlock] {
        // OPEN DATA GAP — PlanWeek (the simple Mon-Sun shape from
        // /api/plan/week) doesn't carry plan_phases rows. The rich
        // TrainingState from /api/training/state does. Until the
        // /api/plan/week shape grows phase metadata, this fallback
        // outputs the canonical 13-week marathon default.
        return defaultPhaseBlocks()
    }

    /// Canonical default block layout — used when phase metadata isn't
    /// available. Matches the implicit assumption in the instructions:
    /// "Base 4wk · Build 4wk · Peak 3wk · Taper 1wk · Race 1wk".
    private static func defaultPhaseBlocks() -> [PhaseBlock] {
        // Week indices are 0-based inclusive ranges.
        return [
            PhaseBlock(label: "BASE",  startWeekIdx: 0,  endWeekIdx: 3),
            PhaseBlock(label: "BUILD", startWeekIdx: 4,  endWeekIdx: 7),
            PhaseBlock(label: "PEAK",  startWeekIdx: 8,  endWeekIdx: 10),
            PhaseBlock(label: "TAPER", startWeekIdx: 11, endWeekIdx: 11),
            PhaseBlock(label: "RACE",  startWeekIdx: 12, endWeekIdx: 12),
        ]
    }

    /// Find the index INTO the returned `blocks` array that matches the
    /// state's currentPhase label. PhaseStrip uses this to ring the
    /// active pill.
    static func currentPhaseBlockIdx(blocks: [PhaseBlock], currentPhase: String?) -> Int? {
        guard let label = currentPhase?.uppercased() else { return nil }
        return blocks.firstIndex(where: { $0.label.uppercased() == label })
    }

    // ── 7.2 VolumeArc — derive weekly mileage bars from the plan ──

    /// Build the per-week volume bars from the rich TrainingState.
    /// Each TrainingPlanWeek carries idx, phase, plannedMi, isCurrent —
    /// exactly the four fields VolumeBar needs.
    static func buildVolumeArc(state: TrainingState?) -> [VolumeBar] {
        guard let weeks = state?.weeks else { return [] }
        return weeks.map {
            VolumeBar(
                weekIdx: $0.idx,
                plannedMi: $0.plannedMi,
                phase: $0.phase,
                isCurrent: $0.isCurrent
            )
        }
    }

    /// PlanWeek fallback — the simple Mon-Sun shape only describes ONE
    /// week (the current one). It has no notion of the multi-week arc,
    /// so we return an empty array rather than fabricate fake bars.
    /// OPEN DATA GAP documented inline.
    static func buildVolumeArc(plan: PlanWeek?) -> [VolumeBar] {
        // OPEN DATA GAP — PlanWeek is the /api/plan/week shape (Mon-Sun
        // for ONE week). The multi-week arc lives in TrainingState
        // (/api/training/state). Don't fabricate the 12-13 weeks the
        // web surface shows — return empty and let the view show
        // nothing rather than a lie.
        return []
    }

    // ── 7.3 WeekAheadGrid — 7-day rows w/ planned mi + type + target ──

    /// Build the 7 day cards from the current week of the rich TrainingState.
    /// The week is whichever TrainingPlanWeek carries isCurrent=true; if
    /// none does (pre-plan), returns empty.
    static func buildWeekAhead(state: TrainingState?) -> [WeekAheadDay] {
        guard let weeks = state?.weeks else { return [] }
        guard let current = weeks.first(where: { $0.isCurrent }) else { return [] }
        return current.days.map { d in
            let (pace, secondary) = paceTarget(for: d.type, label: d.label)
            return WeekAheadDay(
                date: d.date,
                dow: d.dow,
                plannedMi: d.mi,
                type: d.type,
                label: d.label,
                doneMi: d.doneMi,
                activityId: d.activityId,
                paceTarget: pace,
                secondaryTarget: secondary
            )
        }
    }

    /// PlanWeek (simple Mon-Sun) fallback. Has the day list but lacks
    /// activity_id / done_mi field naming consistency — those map cleanly
    /// since the API responses converged in Phase 17. Open gap: no
    /// prescription pace, so we fall back to type-based defaults
    /// (same as web's `targetFor()`).
    static func buildWeekAhead(plan: PlanWeek?) -> [WeekAheadDay] {
        guard let days = plan?.days else { return [] }
        return days.map { d in
            let (pace, secondary) = paceTarget(for: d.type, label: d.sub_label)
            return WeekAheadDay(
                date: d.date_iso,
                dow: d.dow,
                plannedMi: d.distance_mi,
                type: d.type,
                label: d.sub_label,
                doneMi: d.done_mi ?? 0,
                activityId: d.completedRunId,
                paceTarget: pace,
                secondaryTarget: secondary
            )
        }
    }

    /// Type-based pace target placeholders. Mirrors `targetFor()` in
    /// web-v2/components/training/WeekAhead.tsx — same dictionary, same
    /// strings.
    ///
    /// OPEN DATA GAP — the web surface upgrades these placeholders by
    /// pre-fetching /api/prescription per planned day (see WeekAhead's
    /// `presByDate` effect), then pulling pace + HR off the work step.
    /// iOS doesn't yet wire that fetch — adapter consumers get the same
    /// type-based defaults the web showed before P-TILE-PRES-DRIFT.
    private static func paceTarget(for type: String, label: String?) -> (String, String) {
        switch type.lowercased() {
        case "easy":      return ("9:00 /mi", "HR < 140")
        case "long":      return ("8:50 /mi", "HR < 145 · fuel @45'")
        case "threshold": return ("6:48 /mi", label ?? "T pace")
        case "tempo":     return ("6:35 /mi", label ?? "tempo")
        case "intervals": return ("3:45 /K",  label ?? "intervals")
        case "race":      return ("race effort", label ?? "race day")
        case "rest":      return ("sleep +1h", "recovery day")
        case "shakeout":  return ("9:30 /mi", "easy & short")
        default:          return ("—", "")
        }
    }

    // ──────────────────────────────────────────────────────────────────
    // 6. Health-surface helpers (Phase 25b · 2026-05-28)
    //
    // Mirrors the headline + eyebrow logic at the top of
    // web-v2/app/health/page.tsx:
    //
    //     const headlineColor = watchMode === 'watch-red' ? 'var(--over)'
    //       : watchMode === 'watch-amber' ? 'var(--goal)'
    //       : watchMode === 'green' ? 'var(--green)' : 'var(--ink)';
    //     const headlineText = watchMode === 'watch-red'  ? 'Pull back.'
    //       : watchMode === 'watch-amber' ? 'Health.'
    //       : watchMode === 'green' ? "Everything's green." : 'Health.';
    //     eyebrow = `LONG-TERM PATTERNS · 30-DAY VIEW · WATCH MODE: ${...}`
    //
    // PageHeader takes a single eyebrow + title + titleColor — these
    // three functions produce all three so HealthView stays
    // render-only.
    // ──────────────────────────────────────────────────────────────────

    /// Eyebrow for the /health PageHeader. Always opens with
    /// "LONG-TERM PATTERNS · 30-DAY VIEW", then appends the watch mode
    /// when the server has emitted one. Mirrors web-v2/app/health/page.tsx.
    static func healthEyebrow(state: HealthState?) -> String {
        var s = "LONG-TERM PATTERNS · 30-DAY VIEW"
        if let mode = state?.watchMode, !mode.isEmpty {
            s += " · WATCH MODE: \(mode.uppercased())"
        }
        return s
    }

    /// Title color override for the /health PageHeader. Defaults to
    /// Theme.ink when watchMode is nil / unknown.
    static func healthTitleColor(watchMode: String?) -> Color {
        switch watchMode {
        case "watch-red":   return Theme.over
        case "watch-amber": return Theme.goal
        case "green":       return Theme.green
        default:            return Theme.ink
        }
    }

    /// Hero verb for the /health PageHeader. One short sentence the
    /// user reads first — same dictionary the web headline uses.
    static func healthTitle(watchMode: String?) -> String {
        switch watchMode {
        case "watch-red":   return "Pull back."
        case "watch-amber": return "Health."
        case "green":       return "Everything's green."
        default:            return "Health."
        }
    }

    // ──────────────────────────────────────────────────────────────────
    // 8. Races-surface helpers (Phase 25b · iOS /races mirror)
    //
    // The iPhone races surface receives a flat `[RaceListItem]` from
    // GET /api/races (sorted soonest-first, past at the tail). The web
    // equivalent has the loader pre-bucket into A / B / C / past
    // (see web-v2/lib/coach/races-state.ts → loadRacesState). The three
    // helpers below derive the per-bucket counts + next-A countdown
    // client-side so the iOS PageHeader can produce the same eyebrow
    // ("3 A-RACES · 1 B-RACE · 1 C-RACE · 5 PAST") and accent chip
    // ("17 DAYS") that web/app/races/page.tsx renders.
    //
    // No new wire model needed — the existing API.fetchRaces() payload
    // is sufficient. When the iPhone eventually mirrors the full web
    // RacesState (with matchedRun enrichment for past races, etc), these
    // helpers stay relevant: they only need the priority + days_to_race
    // axis.
    // ──────────────────────────────────────────────────────────────────

    /// Caps-tracked eyebrow string for the iOS /races PageHeader. Mirrors
    /// the web assembly in web-v2/app/races/page.tsx lines 15-22:
    ///
    ///   "3 A-RACES · 1 B-RACE · 1 C-RACE · 5 PAST"
    ///
    /// Plurality matches the web ("1 A-RACE" / "3 A-RACES"). When the
    /// list has no A-races at all, the first segment becomes
    /// "NO A-RACE SET" so the eyebrow still communicates the gap.
    /// Past races are always included as the trailing segment, even when
    /// the count is zero, to match the web's stable shape.
    static func racesEyebrow(races: [RaceListItem]) -> String {
        let upcoming = races.filter { ($0.days_to_race ?? 0) >= 0 }
        let past = races.filter { ($0.days_to_race ?? 0) < 0 }
        let aRaces = upcoming.filter { ($0.priority ?? "").uppercased() == "A" }
        let bRaces = upcoming.filter { ($0.priority ?? "").uppercased() == "B" }
        // Per races-state.ts:155, "null priority" buckets with C.
        let cRaces = upcoming.filter {
            let p = ($0.priority ?? "").uppercased()
            return p == "C" || p.isEmpty
        }

        let aPart = aRaces.isEmpty
            ? "NO A-RACE SET"
            : "\(aRaces.count) A-RACE\(aRaces.count == 1 ? "" : "S")"
        let bPart = "\(bRaces.count) B-RACE\(bRaces.count == 1 ? "" : "S")"
        let cPart = "\(cRaces.count) C-RACE\(cRaces.count == 1 ? "" : "S")"
        let pastPart = "\(past.count) PAST"

        return [aPart, bPart, cPart, pastPart].joined(separator: " · ")
    }

    /// Days-to-next-A countdown for the PageHeader accent slot.
    /// Returns `nil` when there's no upcoming A-race (caller suppresses
    /// the accent chip entirely in that case — mirrors the web's
    /// `races.aRace ? ...` branch).
    static func nextARaceCountdown(races: [RaceListItem]) -> Int? {
        let upcomingA = races.filter {
            ($0.priority ?? "").uppercased() == "A" && ($0.days_to_race ?? -1) >= 0
        }
        // RaceListResponse is already sorted soonest-first by the loader,
        // but we sort defensively in case a caller passes raw rows.
        let soonest = upcomingA.min(by: {
            ($0.days_to_race ?? Int.max) < ($1.days_to_race ?? Int.max)
        })
        return soonest?.days_to_race
    }

    /// Priority → semantic color. Mirrors the BCRaceCard `priority === 'B'
    /// ? var(--goal) : var(--learn)` branch in web /races plus the A-race
    /// orange used for the hero + secondary A cards. C / unknown falls
    /// through to `Theme.learn` (matches the web's "C" color choice in
    /// BCRaceCard).
    static func racePriorityColor(priority: String?) -> Color {
        switch (priority ?? "").uppercased() {
        case "A": return Theme.race    // race orange #FF8847
        case "B": return Theme.goal    // quality gold #F3AD38
        case "C": return Theme.learn   // phase purple #B084FF
        default:  return Theme.mute    // unknown / null
        }
    }
}
