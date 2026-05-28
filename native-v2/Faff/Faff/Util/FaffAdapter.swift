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
    ///   3. done_nailed · ran today (≥ 0.5 mi recorded — we approximate via
    ///      the absence of a planned workout + presence of a logged run;
    ///      `briefing.mode == "post-run"` is the strongest signal we have
    ///      without a Run feed.)
    ///   4. base 4 · rest / long / quality / easy keyed off plan day type
    static func resolveDayState(
        plan: PlanWeek?,
        briefing: Briefing?,
        workout: WatchWorkout?
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
        }
    }

    /// SLEEP / RHR / HRV / LOAD tiles. The iPhone's ReadinessSnapshot
    /// only carries score + label + band right now, so we surface 4
    /// placeholder tiles that key off the readiness band. When the
    /// inputs slice lands (HK-fed sleep / RHR / HRV), the tile values
    /// flip from `—` to real numbers without any caller change.
    private static func bodyTiles(readiness: ReadinessSnapshot?) -> [FaffMiniTile] {
        let band = (readiness?.band ?? "").lowercased()
        let dot: FaffDotColor = band == "green" ? .green
                              : band == "yellow" ? .amber
                              : band == "red"    ? .over
                              : .none

        // Until per-metric readiness lands, the 4 tiles re-state the
        // readiness signal at metric granularity so the dashboard reads
        // honestly. Each value renders as `—` when no data — no fake
        // placeholder numbers (Cardinal Rule #6 · the only honest answer
        // is the truth).
        return [
            FaffMiniTile(
                label: "SLEEP",
                value: "—",
                valueUnit: "h",
                meta: "7d avg",
                metaStrong: nil,
                dot: dot
            ),
            FaffMiniTile(
                label: "RHR",
                value: "—",
                valueUnit: "bpm",
                meta: "vs base",
                metaStrong: nil,
                dot: dot
            ),
            FaffMiniTile(
                label: "HRV",
                value: "—",
                valueUnit: "ms",
                meta: "vs base",
                metaStrong: nil,
                dot: dot
            ),
            FaffMiniTile(
                label: "LOAD",
                value: readiness?.score.map { "\($0)" } ?? "—",
                valueUnit: nil,
                meta: readiness?.label ?? "—",
                metaStrong: nil,
                dot: dot
            ),
        ]
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

    static func buildWeekStrip(plan: PlanWeek?) -> WeekStripPayload {
        guard let plan else {
            return WeekStripPayload(
                weekStart: "",
                days: [],
                plannedMi: 0,
                completedMi: 0
            )
        }

        let todayIso = plan.today_iso
        let days: [FaffWeekDay] = plan.days.map { d in
            FaffWeekDay(
                date: d.date_iso,
                dow: d.dow,
                plannedType: d.type,
                plannedDistance: d.distance_mi > 0 ? d.distance_mi : nil,
                plannedTypeLabel: typeLabel(
                    plannedType: d.type,
                    plannedLabel: d.sub_label
                ),
                // PlanDay doesn't carry a completed-run id today; the
                // resolveDayState path handles the today + done case
                // separately via the briefing's `post-run` mode. Past
                // completed days light up via is_past + plannedType==easy
                // assumption — the proper wiring lands when /api/plan/week
                // adds a `completedRunId` field.
                completedRunId: d.is_past && d.type != "rest" ? d.date_iso : nil,
                isToday: d.is_today,
                isFuture: !d.is_today && !d.is_past
            )
        }

        let plannedSum = days.reduce(0.0) { $0 + ($1.plannedDistance ?? 0) }
        // Completed-mi rollup: we don't have run-by-run mileage on PlanDay,
        // so render 0 for now. The header just reads "0 / N mi" until the
        // run feed lands.
        let completedSum = 0.0

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
}
