//
//  HealthSeed.swift
//
//  Composes HealthMetric values for the BODY / SLEEP / FORM sections
//  from REAL backend data only. When a signal is absent, the tile
//  renders an honest em-dash ("—") with no chart — never a fabricated
//  placeholder value or a synthesized trend.
//
//  2026-06-08 · de-fabrication pass (UI-HEALTH-REPORT 1.2 / 1.3).
//  Removed the `?? <plausible literal>` value fallbacks, the
//  drift()/chartFromHistory()/preferRealOrPad() chart synthesis, and the
//  hardcoded directional coach lines. Coach copy is now derived from the
//  ACTUAL delta via coachForDelta(). Added WEIGHT / SPO₂ / BODY FAT /
//  LEAN MASS / MAX HR / ACTIVE ENERGY / HRV CV tiles (data already on
//  HealthState — server ships it, the model now decodes it). Removed the
//  phantom BODY TEMP tile (no `body_temp` source exists).
//
//  Created 2026-06-03 round 72 · de-fabricated 2026-06-08.
//

import Foundation

enum HealthSeed {

    // MARK: - BODY section metrics

    static func bodyMetrics(readiness: ReadinessSnapshot?,
                            healthState: HealthState?) -> [HealthMetric] {
        var out: [HealthMetric] = []

        // HRV
        if let cur = readiness?.hrvCurrent {
            let base = readiness?.hrvBaseline
            out.append(metric(
                id: "hrv", label: "HRV", value: "\(cur)", unit: " ms",
                history: (healthState?.hrvSeries ?? []).suffix(14).map { Double($0.ms) },
                chart28: realChart((healthState?.hrvSeries ?? []).map { Double($0.ms) }),
                target: base.map(Double.init),
                status: cur >= (base ?? cur) ? .good : .warn,
                direction: trendDir(cur: Double(cur), base: base.map(Double.init)),
                caption: base.map { "baseline \($0)" } ?? "baseline forming",
                coach: coachForDelta(noun: "HRV", cur: Double(cur), base: base.map(Double.init),
                                     unit: "ms", higherIsBetter: true)))
        } else {
            out.append(noDataMetric(id: "hrv", label: "HRV", unit: " ms"))
        }

        // RESTING HR
        if let cur = readiness?.rhrCurrent {
            let base = readiness?.rhrBaseline
            out.append(metric(
                id: "rhr", label: "RESTING HR", value: "\(cur)", unit: " bpm",
                history: (healthState?.rhrSeries ?? []).suffix(14).map { Double($0.bpm) },
                chart28: realChart((healthState?.rhrSeries ?? []).map { Double($0.bpm) }),
                target: base.map(Double.init),
                status: cur <= (base ?? cur) ? .good : .warn,
                direction: trendDir(cur: Double(cur), base: base.map(Double.init)),
                caption: base.map { "baseline \($0)" } ?? "baseline forming",
                coach: coachForDelta(noun: "Resting HR", cur: Double(cur), base: base.map(Double.init),
                                     unit: "bpm", higherIsBetter: false)))
        } else {
            out.append(noDataMetric(id: "rhr", label: "RESTING HR", unit: " bpm"))
        }

        // VO₂ MAX · no baseline in payload · coach derived from the real series trend
        if let cur = healthState?.vo2.current {
            let s = healthState?.vo2.series28d ?? []
            let coach: String = {
                guard s.count >= 2, let f = s.first, let l = s.last else {
                    return "VO₂ trend builds with more test-day readings."
                }
                let d = l - f
                if abs(d) < 0.3 { return "Holding steady over the last month." }
                return d > 0 ? "Up \(String(format: "%.1f", d)) over the last month."
                             : "Down \(String(format: "%.1f", abs(d))) over the last month."
            }()
            out.append(metric(
                id: "vo2", label: "VO₂ MAX", value: String(format: "%.1f", cur), unit: nil,
                history: Array(s.suffix(14)), chart28: realChart(s),
                target: nil, status: .good,
                direction: trendDir(cur: cur, base: s.first),
                caption: "30-day", coach: coach))
        } else {
            out.append(noDataMetric(id: "vo2", label: "VO₂ MAX", unit: nil))
        }

        // RESP RATE
        if let cur = healthState?.respiratoryRate?.current {
            let base = healthState?.respiratoryRate?.baseline
            let delta = healthState?.respiratoryRate?.delta
            let s = (healthState?.respiratoryRateSeries ?? []).map { $0.bpm }
            out.append(metric(
                id: "resp", label: "RESP RATE", value: String(format: "%.1f", cur), unit: " /min",
                history: Array(s.suffix(14)), chart28: realChart(s),
                target: nil,
                status: (delta ?? 0) >= 2 ? .warn : .good,
                direction: trendDir(cur: cur, base: base),
                caption: base.map { "baseline \(String(format: "%.1f", $0))" } ?? "nightly",
                coach: coachForDelta(noun: "Breathing rate", cur: cur, base: base,
                                     unit: "/min", higherIsBetter: false, decimals: 1)))
        } else {
            out.append(noDataMetric(id: "resp", label: "RESP RATE", unit: " /min"))
        }

        // WRIST TEMP · stored °C from HealthKit, displayed in the runner's
        // preference unit (was hardcoded °F, US-only). 2026-07-07 units
        // audit: `delta` (the raw °C server value, used ONLY for the 0.4°C
        // warn threshold + direction's base-comparison magnitude) is left
        // completely untouched — status/threshold logic stays exactly as
        // before. Only the DISPLAYED value/history/chart/caption/coach
        // strings route through the preference. curF/baseF/cF renamed to
        // curDisp/baseDisp/cDisp (still Fahrenheit internally when the
        // preference is F, so the "no-op for F" byte-safety guarantee holds
        // for degree math the same way it does for distance/pace).
        if let cur = healthState?.wristTemp?.current {
            let base = healthState?.wristTemp?.baseline
            let delta = healthState?.wristTemp?.delta   // °C deviation · keep the 0.4°C warn threshold
            let cF: (Double) -> Double = { $0 * 9 / 5 + 32 }
            let curF = cF(cur)
            let baseF = base.map(cF)
            let unitSuffix = Units.temperatureUnitSuffix()
            let cDisp: (Double) -> Double = { Units.convertTemperature(fahrenheit: $0, to: Units.preference.temperature) }
            let curDisp = cDisp(curF)
            let baseDisp = baseF.map(cDisp)
            let s = (healthState?.wristTempSeries ?? []).map { cDisp(cF($0.tempC)) }
            out.append(metric(
                id: "wtemp", label: "WRIST TEMP", value: String(format: "%.1f", curDisp), unit: " °\(unitSuffix)",
                history: Array(s.suffix(14)), chart28: realChart(s),
                target: nil,
                status: abs(delta ?? 0) >= 0.4 ? .warn : .good,
                direction: trendDir(cur: curF, base: baseF),
                caption: baseDisp.map { "baseline \(String(format: "%.1f", $0))" } ?? "30-day",
                coach: coachForDelta(noun: "Skin temp", cur: curDisp, base: baseDisp,
                                     unit: "°\(unitSuffix)", higherIsBetter: false, decimals: 1)))
        } else {
            out.append(noDataMetric(id: "wtemp", label: "WRIST TEMP", unit: " °\(Units.temperatureUnitSuffix())"))
        }

        // WEIGHT
        if let cur = healthState?.weight.current {
            let s = (healthState?.weightSeries ?? []).map { $0.lb }
            out.append(metric(
                id: "weight", label: "WEIGHT", value: String(format: "%.1f", cur), unit: " lb",
                history: Array(s.suffix(14)), chart28: realChart(s),
                target: nil, status: .good, direction: trendDir(cur: cur, base: s.first),
                caption: "30-day",
                coach: coachForDelta(noun: "Weight", cur: cur, base: s.first,
                                     unit: "lb", higherIsBetter: false, decimals: 1)))
        } else {
            out.append(noDataMetric(id: "weight", label: "WEIGHT", unit: " lb"))
        }

        // SPO₂
        if let cur = healthState?.spo2?.current {
            let base = healthState?.spo2?.baseline
            let s = (healthState?.spo2Series ?? []).map { Double($0.pct) }
            out.append(metric(
                id: "spo2", label: "SPO₂", value: "\(cur)", unit: " %",
                history: Array(s.suffix(14)), chart28: realChart(s),
                target: nil, status: cur >= 96 ? .good : .warn,
                direction: trendDir(cur: Double(cur), base: base.map(Double.init)),
                caption: base.map { "baseline \($0)" } ?? "nightly",
                coach: cur >= 96 ? "In the normal overnight range."
                                 : "Below your usual overnight range · worth watching."))
        } else {
            out.append(noDataMetric(id: "spo2", label: "SPO₂", unit: " %"))
        }

        // BODY FAT
        if let cur = healthState?.bodyFat?.current {
            let s = (healthState?.bodyFatSeries ?? []).map { $0.pct }
            out.append(metric(
                id: "body_fat", label: "BODY FAT", value: String(format: "%.1f", cur), unit: " %",
                history: Array(s.suffix(14)), chart28: realChart(s),
                target: nil, status: .good, direction: trendDir(cur: cur, base: s.first),
                caption: "trend",
                coach: coachForDelta(noun: "Body fat", cur: cur, base: s.first,
                                     unit: "%", higherIsBetter: false, decimals: 1)))
        } else {
            out.append(noDataMetric(id: "body_fat", label: "BODY FAT", unit: " %"))
        }

        // LEAN MASS · kg → lb to match the weight tile convention
        if let kg = healthState?.leanMass?.current {
            let cur = kg * 2.20462
            let s = (healthState?.leanMassSeries ?? []).map { $0.kg * 2.20462 }
            out.append(metric(
                id: "lean_mass", label: "LEAN MASS", value: String(format: "%.1f", cur), unit: " lb",
                history: Array(s.suffix(14)), chart28: realChart(s),
                target: nil, status: .good, direction: trendDir(cur: cur, base: s.first),
                caption: "trend",
                coach: coachForDelta(noun: "Lean mass", cur: cur, base: s.first,
                                     unit: "lb", higherIsBetter: true, decimals: 1)))
        } else {
            out.append(noDataMetric(id: "lean_mass", label: "LEAN MASS", unit: " lb"))
        }

        // HRV CV · derived client-side from the REAL hrv series (Plews CV).
        // Rolling 7-day CV series gives a trend of how stable HRV has been.
        // No on-device band — the destabilizing threshold lives server-side.
        if let cv = hrvCV(healthState?.hrvSeries ?? []) {
            let cvSeries = hrvCVSeries(healthState?.hrvSeries ?? [])
            out.append(metric(
                id: "hrv_cv", label: "HRV CV", value: String(format: "%.1f", cv), unit: " %",
                history: Array(cvSeries.suffix(14)), chart28: realChart(cvSeries),
                target: nil, status: .neutral, direction: .flat,
                caption: "variability · 14-day",
                coach: "Night-to-night HRV spread. A rising spread can precede an HRV drop."))
        }

        // MAX HR · current-only · render only when real (> 0)
        if let cur = healthState?.maxHr?.current, cur > 0 {
            out.append(metric(
                id: "max_hr", label: "MAX HR", value: "\(cur)", unit: " bpm",
                history: [], chart28: [],
                target: nil, status: .good, direction: .flat,
                caption: "observed ceiling",
                coach: "Highest HR seen recently · anchors your zones."))
        }

        // ACTIVE ENERGY · mirror the web partial-day / ingest-noise handling
        let aeToday = healthState?.activeEnergy?.today ?? 0
        let aeAvg7  = healthState?.activeEnergy?.avg7 ?? 0
        if aeToday > 0 || aeAvg7 > 0 {
            let ingestBroken = aeToday < 100 && aeAvg7 < 100
            if ingestBroken {
                out.append(noDataMetric(id: "active_energy", label: "ACTIVE ENERGY", unit: " kcal"))
            } else {
                let partialDay = aeToday > 0 && aeToday < 100 && aeAvg7 >= 500
                let display = partialDay ? aeAvg7 : (aeToday > 0 ? aeToday : aeAvg7)
                let s = (healthState?.activeEnergy?.series ?? []).map { Double($0.kcal) }
                out.append(metric(
                    id: "active_energy", label: "ACTIVE ENERGY", value: "\(display)", unit: " kcal",
                    history: Array(s.suffix(14)), chart28: realChart(s),
                    target: nil,
                    status: partialDay ? .warn : (aeAvg7 > 0 && aeToday >= aeAvg7 / 2 ? .good : .warn),
                    direction: .flat,
                    caption: aeAvg7 > 0 ? "7-day avg \(aeAvg7)" : "today",
                    coach: partialDay ? "Today is still syncing · showing your 7-day average."
                                      : "Daily movement energy from your watch."))
            }
        }

        return out
    }

    // MARK: - SLEEP section metrics (4 stages, clock-formatted values)

    static func sleepMetrics(readiness: ReadinessSnapshot?,
                              healthState: HealthState? = nil) -> [HealthMetric] {
        // Real stages or honest "—" · no more 18/22/52/8 ratio fabrication
        // and no drift series for cold-start / non-watch nights.
        guard let s = healthState?.sleepStages else {
            return [ noDataMetric(id: "deep",  label: "DEEP",  unit: nil),
                     noDataMetric(id: "rem",   label: "REM",   unit: nil),
                     noDataMetric(id: "light", label: "LIGHT", unit: nil),
                     noDataMetric(id: "awake", label: "AWAKE", unit: nil) ]
        }
        func tile(_ id: String, _ label: String, _ minutes: Int?, _ series: [Int],
                  target: Double?, warnBelow: Int?, captionTarget: String, coach: String) -> HealthMetric {
            guard let m = minutes else { return noDataMetric(id: id, label: label, unit: nil) }
            return metric(
                id: id, label: label, value: clock(m), unit: nil,
                history: series.suffix(14).map(Double.init),
                chart28: realChart(series.map(Double.init)),
                target: target,
                status: warnBelow.map { m < $0 ? .warn : .good } ?? .neutral,
                direction: target.map { Double(m) < $0 ? .down : .flat } ?? .flat,
                caption: captionTarget, coach: coach)
        }
        // Percentage-based targets: Deep ~16% / REM ~21% of true sleep time.
        // Total sleep = deep + rem + light (excludes awake, which is time-in-bed awake).
        // Hardcoded minute targets fail short/long sleepers; percentages stay proportional.
        let totalSleepMin = (s.deepMin ?? 0) + (s.remMin ?? 0) + (s.lightMin ?? 0)
        let deepTarget  = totalSleepMin > 0 ? max(60, Int(Double(totalSleepMin) * 0.16)) : 75
        let deepWarn    = totalSleepMin > 0 ? max(52, Int(Double(totalSleepMin) * 0.13)) : 70
        let remTarget   = totalSleepMin > 0 ? max(72, Int(Double(totalSleepMin) * 0.21)) : 100
        let remWarn     = totalSleepMin > 0 ? max(61, Int(Double(totalSleepMin) * 0.17)) : 90
        return [
            tile("deep", "DEEP", s.deepMin, s.deepSeries,
                 target: Double(deepTarget), warnBelow: deepWarn,
                 captionTarget: "target \(clock(deepTarget))",
                 coach: (s.deepMin ?? 99) < deepTarget
                     ? "Light on deep sleep · an earlier night usually helps."
                     : "Deep sleep on target."),
            tile("rem", "REM", s.remMin, s.remSeries,
                 target: Double(remTarget), warnBelow: remWarn,
                 captionTarget: "target \(clock(remTarget))",
                 coach: (s.remMin ?? 999) < remTarget
                     ? "REM tracks total sleep · it returns when hours do."
                     : "REM in a healthy range."),
            tile("light", "LIGHT", s.lightMin, s.lightSeries, target: nil, warnBelow: nil,
                 captionTarget: "normal range", coach: "Light sleep in its normal range."),
            tile("awake", "AWAKE", s.awakeMin, s.awakeSeries, target: nil, warnBelow: nil,
                 captionTarget: "normal range", coach: "Brief wake-ups · within normal."),
        ]
    }

    // MARK: - FORM section metrics (cadence, power, stride, vert osc, GCT, L/R)

    enum FormPreference { case higher, lower, neutral }

    static func formMetrics(healthState: HealthState?) -> [HealthMetric] {
        // Each metric gates on a real `current` · no placeholder values, no
        // drift series. Coach derived from the real cur-vs-30d-avg delta.
        let form = healthState?.runForm
        return [
            formMetric(m: form?.cadenceSpm,      id: "cad",    label: "CADENCE",        unit: " spm", decimals: 0, target: 172, lower: 130, upper: 220, prefer: .higher,  noun: "Cadence"),
            formMetric(m: form?.runPowerW,       id: "pow",    label: "RUN POWER",      unit: " W",   decimals: 0, target: nil, lower: 50,  upper: 600, prefer: .higher,  noun: "Power"),
            formMetric(m: form?.strideLengthM,   id: "stride", label: "STRIDE",         unit: " m",   decimals: 2, target: nil, lower: 0.8, upper: 2.0, prefer: .higher,  noun: "Stride"),
            formMetric(m: form?.vertOscCm,       id: "vosc",   label: "VERT OSC",       unit: " cm",  decimals: 1, target: 8.5, lower: 4,   upper: 14,  prefer: .lower,   noun: "Vertical oscillation"),
            formMetric(m: form?.groundContactMs, id: "gct",    label: "GROUND CONTACT", unit: " ms",  decimals: 0, target: 235, lower: 180, upper: 350, prefer: .lower,   noun: "Ground contact"),
        ]
    }

    /// Compose a HealthMetric from a backend RunFormMetric. nil current →
    /// honest no-data tile. Real series only; coach derived from the delta.
    private static func formMetric(
        m: RunFormMetric?,
        id: String, label: String, unit: String?, decimals: Int,
        target: Double?, lower: Double, upper: Double,
        prefer: FormPreference, noun: String
    ) -> HealthMetric {
        guard let cur = m?.current else { return noDataMetric(id: id, label: label, unit: unit) }
        let avg14 = m?.avg14d
        let avg28 = m?.avg28d
        let valueStr = decimals == 0
            ? "\(Int(cur.rounded()))"
            : String(format: "%.\(decimals)f", cur)
        let direction: HealthMetric.Direction = {
            guard let a = avg14 else { return .flat }
            return abs(cur - a) < (upper - lower) * 0.01 ? .flat : (cur > a ? .up : .down)
        }()
        let status: HealthMetric.Status = {
            guard let t = target else { return .good }
            switch prefer {
            case .higher: return cur >= t ? .good : (cur >= t * 0.95 ? .warn : .bad)
            case .lower:  return cur <= t ? .good : (cur <= t * 1.05 ? .warn : .bad)
            case .neutral: return .good
            }
        }()
        let caption: String = {
            if let t = target {
                return decimals == 0 ? "target \(Int(t))" : "aim \(String(format: "%.1f", t))"
            }
            if let a = avg28 {
                return "30-day avg \(decimals == 0 ? "\(Int(a.rounded()))" : String(format: "%.\(decimals)f", a))"
            }
            return "30-day"
        }()
        let realSeries = m?.series28d ?? []
        let coach: String = (prefer == .neutral)
            ? "Within a normal range · no action."
            : coachForDelta(noun: noun, cur: cur, base: avg28,
                            unit: (unit ?? "").trimmingCharacters(in: .whitespaces),
                            higherIsBetter: prefer == .higher, decimals: decimals)
        return HealthMetric(
            id: id, label: label, value: valueStr, unit: unit,
            history: Array(realSeries.suffix(14)), chart28: realChart(realSeries),
            target: target, status: status, direction: direction,
            caption: caption, coach: coach)
    }

    // MARK: - Honest helpers (2026-06-08 de-fabrication)

    /// A tile with no real data · em-dash, no bars, neutral. Mirrors web `noData`.
    private static func noDataMetric(id: String, label: String, unit: String?,
                                     caption: String = "no data yet") -> HealthMetric {
        HealthMetric(
            id: id, label: label, value: "—", unit: unit,
            history: [], chart28: [],
            target: nil, status: .neutral, direction: .flat,
            caption: caption, coach: "Trend builds with daily syncs.")
    }

    /// Real series only · last 28 if we have them, else whatever is real. No padding/drift.
    private static func realChart(_ full: [Double]) -> [Double] {
        full.count >= 28 ? Array(full.suffix(28)) : full
    }

    /// Literal trend arrow · cur vs base. .flat when no baseline or no movement.
    private static func trendDir(cur: Double, base: Double?) -> HealthMetric.Direction {
        guard let base = base else { return .flat }
        if abs(cur - base) < 0.0001 { return .flat }
        return cur > base ? .up : .down
    }

    /// Coach line derived from the ACTUAL delta · never asserts a direction
    /// the data doesn't show. nil baseline → "still forming"; on-baseline →
    /// "right on baseline"; otherwise states the real move + whether it's favorable.
    private static func coachForDelta(noun: String, cur: Double, base: Double?,
                                      unit: String, higherIsBetter: Bool, decimals: Int = 0) -> String {
        guard let base = base else { return "\(noun) baseline still forming · keep syncing." }
        let mag = abs(cur - base)
        let onBaseline = (decimals == 0)
            ? Int(mag.rounded()) == 0
            : mag < pow(10.0, -Double(decimals))
        if onBaseline { return "Sitting right on baseline." }
        let magStr = decimals == 0 ? "\(Int(mag.rounded()))" : String(format: "%.\(decimals)f", mag)
        let unitPart = unit.isEmpty ? "" : " \(unit)"
        let favorable = ((cur - base) > 0) == higherIsBetter
        return "\((cur - base) > 0 ? "Up" : "Down") \(magStr)\(unitPart) vs baseline · \(favorable ? "trending the right way" : "worth watching")."
    }

    /// HRV coefficient of variation (Plews) from the REAL hrv series ·
    /// stdev/mean × 100 over the last 7-14 nights (sample stdev). nil when
    /// fewer than 7 real nights.
    private static func hrvCV(_ series: [HealthDayMs]) -> Double? {
        let vals = series.suffix(14).map { Double($0.ms) }
        guard vals.count >= 7 else { return nil }
        let mean = vals.reduce(0, +) / Double(vals.count)
        guard mean > 0 else { return nil }
        let variance = vals.map { ($0 - mean) * ($0 - mean) }.reduce(0, +) / Double(vals.count - 1)
        return (variance.squareRoot() / mean) * 100
    }

    /// Rolling 7-day CV series — one value per day once 7 nights are available.
    /// Gives a trend line showing whether HRV stability is rising or falling.
    private static func hrvCVSeries(_ series: [HealthDayMs]) -> [Double] {
        guard series.count >= 7 else { return [] }
        return (6..<series.count).compactMap { i in
            let window = series[(i - 6)...i].map { Double($0.ms) }
            let mean = window.reduce(0, +) / Double(window.count)
            guard mean > 0 else { return nil }
            let variance = window.map { ($0 - mean) * ($0 - mean) }.reduce(0, +) / Double(window.count - 1)
            return (variance.squareRoot() / mean) * 100
        }
    }

    private static func metric(
        id: String, label: String, value: String, unit: String?,
        history: [Double], chart28: [Double],
        target: Double?, status: HealthMetric.Status, direction: HealthMetric.Direction,
        caption: String, coach: String
    ) -> HealthMetric {
        HealthMetric(
            id: id, label: label, value: value, unit: unit,
            history: history, chart28: chart28,
            target: target, status: status, direction: direction,
            caption: caption, coach: coach
        )
    }

    private static func clock(_ minutes: Int) -> String {
        let h = minutes / 60
        let m = minutes % 60
        return "\(h):\(String(format: "%02d", m))"
    }
}
