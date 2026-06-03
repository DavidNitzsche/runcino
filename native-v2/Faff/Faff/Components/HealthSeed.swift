//
//  HealthSeed.swift
//
//  Composes HealthMetric values for the BODY / SLEEP / FORM sections.
//  Wires backend-available signals (ReadinessSnapshot inputs, HealthState
//  trends) into the bar-card shape, falling back to plausible
//  placeholder series for metrics the backend doesn't ship yet (run
//  power, vertical oscillation, ground contact, L/R balance, sleep
//  stages broken out, body/wrist temp, resp rate).
//
//  Per the brief: "treat the numbers as representative, not literal."
//  Once backend ships a /api/health/v2 endpoint with the full driver
//  shape, swap the placeholder helpers for real fields without
//  touching the section views.
//
//  Created 2026-06-03 round 72.
//

import Foundation

enum HealthSeed {

    // MARK: - BODY section metrics

    static func bodyMetrics(readiness: ReadinessSnapshot?,
                            healthState: HealthState?) -> [HealthMetric] {
        let hrvCur = readiness?.hrvCurrent ?? 52
        let hrvBase = readiness?.hrvBaseline ?? 58
        let rhrCur = readiness?.rhrCurrent ?? 49
        let rhrBase = readiness?.rhrBaseline ?? 50
        let vo2 = healthState?.vo2.current ?? 61.4
        // 2026-06-03 round 77 · bodyTemp wires when backend ships it,
        // placeholder when nil. currentC = current body temp (°C).
        let bodyTempC = healthState?.bodyTemp?.currentC
        let bodyTempBaseline = healthState?.bodyTemp?.baselineC ?? 36.5
        let bodyTempSeries30 = healthState?.bodyTemp?.series30d ?? []

        return [
            metric(
                id: "hrv", label: "HRV",
                value: "\(hrvCur)", unit: " ms",
                history: drift(from: Double(hrvBase) - 2, to: Double(hrvCur), n: 14, seed: 42),
                chart28: drift(from: Double(hrvBase) + 1, to: Double(hrvCur), n: 28, seed: 142),
                target: Double(hrvBase),
                status: hrvCur < hrvBase - 4 ? .warn : (hrvCur < hrvBase - 8 ? .bad : .good),
                direction: hrvCur < hrvBase ? .down : .up,
                caption: "baseline \(hrvBase)",
                coach: "Down \(max(0, hrvBase - hrvCur)) ms across recent nights · tracks short sleep, not a fade."
            ),
            metric(
                id: "rhr", label: "RESTING HR",
                value: "\(rhrCur)", unit: " bpm",
                history: drift(from: Double(rhrBase) + 1, to: Double(rhrCur), n: 14, seed: 7),
                chart28: drift(from: Double(rhrBase) + 2, to: Double(rhrCur), n: 28, seed: 107),
                target: Double(rhrBase),
                status: rhrCur <= rhrBase ? .good : .warn,
                direction: rhrCur < rhrBase ? .down : .flat,
                caption: "baseline \(rhrBase)",
                coach: "Sitting near baseline · cardiovascular load is low."
            ),
            metric(
                id: "vo2", label: "VO₂ MAX",
                value: String(format: "%.1f", vo2), unit: nil,
                history: drift(from: vo2 - 1.0, to: vo2, n: 14, seed: 33),
                chart28: drift(from: vo2 - 1.4, to: vo2, n: 28, seed: 133),
                target: nil,
                status: .good, direction: .up,
                caption: "30-day",
                coach: "Up across the block · aerobic engine is climbing."
            ),
            metric(
                id: "resp", label: "RESP RATE",
                value: "15.1", unit: " /min",
                history: drift(from: 15.0, to: 15.1, n: 14, seed: 61),
                chart28: drift(from: 15.2, to: 15.1, n: 28, seed: 161),
                target: nil,
                status: .neutral, direction: .flat,
                caption: "nightly",
                coach: "Steady and normal · no illness signal in breathing rate."
            ),
            metric(
                id: "btemp", label: "BODY TEMP",
                value: bodyTempC.map { String(format: "%.1f", $0) } ?? "—",
                unit: " °C",
                history: bodyTempSeries30.suffix(14).map { $0 }.isEmpty
                    ? drift(from: 36.5, to: 36.6, n: 14, seed: 71)
                    : Array(bodyTempSeries30.suffix(14)),
                chart28: bodyTempSeries30.isEmpty
                    ? drift(from: 36.5, to: 36.6, n: 28, seed: 171)
                    : bodyTempSeries30,
                target: nil,
                status: .neutral, direction: .flat,
                caption: bodyTempC.map { _ in "baseline \(String(format: "%.1f", bodyTempBaseline))" } ?? "30-day",
                coach: "Within your normal band · nothing flagged."
            ),
            metric(
                id: "wtemp", label: "WRIST TEMP",
                value: "35.78", unit: " °C",
                history: drift(from: 35.74, to: 35.78, n: 14, seed: 51),
                chart28: drift(from: 35.74, to: 35.78, n: 28, seed: 151),
                target: nil,
                status: .neutral, direction: .flat,
                caption: "30-day",
                coach: "Skin temperature is stable overnight · no deviation."
            ),
        ]
    }

    // MARK: - SLEEP section metrics (4 stages, clock-formatted values)

    static func sleepMetrics(readiness: ReadinessSnapshot?,
                              healthState: HealthState? = nil) -> [HealthMetric] {
        // 2026-06-03 round 77 · prefer real sleep stages from backend
        // (HealthState.sleepStages · backend aa45d543). Falls back to
        // typical 18/22/52/8 ratios when stages aren't populated yet
        // (cold start / non-watch night / older snapshot).
        let stages = healthState?.sleepStages
        let deep: Int
        let rem: Int
        let light: Int
        let awake: Int
        if let s = stages,
           let d = s.deepMin, let r = s.remMin,
           let l = s.lightMin, let a = s.awakeMin {
            deep = d; rem = r; light = l; awake = a
        } else {
            let totalH = readiness?.sleep7Avg ?? 6.5
            let totalMin = Int(totalH * 60)
            deep = Int(Double(totalMin) * 0.18)
            rem = Int(Double(totalMin) * 0.22)
            light = Int(Double(totalMin) * 0.52)
            awake = max(8, Int(Double(totalMin) * 0.05))
        }
        // Series for the mini-bars · real backend series when available,
        // else fabricated drift around the current value.
        let deepSeries = (stages?.deepSeries.isEmpty == false)
            ? stages!.deepSeries.suffix(14).map(Double.init)
            : drift(from: 78, to: Double(deep), n: 14, seed: 101)
        let remSeries = (stages?.remSeries.isEmpty == false)
            ? stages!.remSeries.suffix(14).map(Double.init)
            : drift(from: 96, to: Double(rem), n: 14, seed: 111)
        let lightSeries = (stages?.lightSeries.isEmpty == false)
            ? stages!.lightSeries.suffix(14).map(Double.init)
            : drift(from: 200, to: Double(light), n: 14, seed: 121)
        let awakeSeries = (stages?.awakeSeries.isEmpty == false)
            ? stages!.awakeSeries.suffix(14).map(Double.init)
            : drift(from: 18, to: Double(awake), n: 14, seed: 131)

        return [
            metric(
                id: "deep", label: "DEEP",
                value: clock(deep), unit: nil,
                history: deepSeries,
                chart28: deepSeries.count < 28
                    ? drift(from: 80, to: Double(deep), n: 28, seed: 201)
                    : deepSeries,
                target: 75,
                status: deep < 70 ? .warn : .good,
                direction: deep < 75 ? .down : .flat,
                caption: "target 1:15",
                coach: "A little light on deep sleep · earlier bedtime usually fixes it."
            ),
            metric(
                id: "rem", label: "REM",
                value: clock(rem), unit: nil,
                history: remSeries,
                chart28: remSeries.count < 28
                    ? drift(from: 98, to: Double(rem), n: 28, seed: 211)
                    : remSeries,
                target: 100,
                status: rem < 90 ? .warn : .good,
                direction: rem < 100 ? .down : .flat,
                caption: "target 1:40",
                coach: "REM follows total sleep · it returns when hours do."
            ),
            metric(
                id: "light", label: "LIGHT",
                value: clock(light), unit: nil,
                history: lightSeries,
                chart28: lightSeries.count < 28
                    ? drift(from: 205, to: Double(light), n: 28, seed: 221)
                    : lightSeries,
                target: nil,
                status: .neutral, direction: .flat,
                caption: "context",
                coach: "Light sleep is in its normal range · nothing to action."
            ),
            metric(
                id: "awake", label: "AWAKE",
                value: clock(awake), unit: nil,
                history: awakeSeries,
                chart28: awakeSeries.count < 28
                    ? drift(from: 16, to: Double(awake), n: 28, seed: 231)
                    : awakeSeries,
                target: nil,
                status: .neutral, direction: .flat,
                caption: "context",
                coach: "A couple of brief wake-ups · well within normal."
            ),
        ]
    }

    // MARK: - FORM section metrics (cadence, power, stride, vert osc, GCT, L/R)

    static func formMetrics(healthState: HealthState?) -> [HealthMetric] {
        // 2026-06-03 round 77 · wire to backend's runForm block
        // (HealthState.runForm · backend aa45d543). Each metric's
        // current / avg14d / avg28d feeds value + caption + status.
        // Falls back to plausible placeholders when backend hasn't
        // populated yet · lrBalance stays placeholder until ingest
        // carries avgLrBalancePct.
        let form = healthState?.runForm
        return [
            formMetric(
                m: form?.cadenceSpm,
                id: "cad", label: "CADENCE", unit: " spm", decimals: 0,
                target: 172, lower: 130, upper: 220, prefer: .higher,
                fallback: (cur: 168, avg: 164),
                coach: "Creeping up toward target · quick feet on easy days helps most."
            ),
            formMetric(
                m: form?.runPowerW,
                id: "pow", label: "RUN POWER", unit: " W", decimals: 0,
                target: nil, lower: 50, upper: 600, prefer: .higher,
                fallback: (cur: 268, avg: 262),
                coach: "Holding more power at the same heart rate · efficiency is up."
            ),
            formMetric(
                m: form?.strideLengthM,
                id: "stride", label: "STRIDE", unit: " m", decimals: 2,
                target: nil, lower: 0.8, upper: 2.0, prefer: .higher,
                fallback: (cur: 1.17, avg: 1.13),
                coach: "Opening slightly as fitness builds · no overstriding signal."
            ),
            formMetric(
                m: form?.vertOscCm,
                id: "vosc", label: "VERT OSC", unit: " cm", decimals: 1,
                target: 8.5, lower: 4, upper: 14, prefer: .lower,
                fallback: (cur: 9.8, avg: 10.2),
                coach: "A touch bouncy · cadence work brings this down with it."
            ),
            formMetric(
                m: form?.groundContactMs,
                id: "gct", label: "GROUND CONTACT", unit: " ms", decimals: 0,
                target: 235, lower: 180, upper: 350, prefer: .lower,
                fallback: (cur: 244, avg: 250),
                coach: "Trending the right way · faster turnover shortens it further."
            ),
            formMetric(
                m: form?.lrBalancePct,
                id: "bal", label: "L / R BALANCE", unit: nil, decimals: 1,
                target: nil, lower: 40, upper: 60, prefer: .neutral,
                fallback: (cur: 49.4, avg: 49.2),
                coach: "Within a point of even · no meaningful asymmetry."
            ),
        ]
    }

    enum FormPreference { case higher, lower, neutral }

    /// Compose a HealthMetric from a backend RunFormMetric. When current
    /// is nil, falls back to placeholder values. Decimals + units stay
    /// metric-specific. Direction derives from current vs avg14d.
    private static func formMetric(
        m: RunFormMetric?,
        id: String, label: String, unit: String?, decimals: Int,
        target: Double?, lower: Double, upper: Double,
        prefer: FormPreference,
        fallback: (cur: Double, avg: Double),
        coach: String
    ) -> HealthMetric {
        let cur = m?.current ?? fallback.cur
        let avg14 = m?.avg14d ?? fallback.avg
        let avg28 = m?.avg28d ?? fallback.avg
        // Compose value display
        let valueStr = decimals == 0
            ? "\(Int(cur.rounded()))"
            : String(format: "%.\(decimals)f", cur)
        // Direction · current vs 14d avg
        let direction: HealthMetric.Direction = {
            if abs(cur - avg14) < (upper - lower) * 0.01 { return .flat }
            return cur > avg14 ? .up : .down
        }()
        // Status vs target (only when target present)
        let status: HealthMetric.Status = {
            guard let t = target else { return .good }
            switch prefer {
            case .higher:
                return cur >= t ? .good : (cur >= t * 0.95 ? .warn : .bad)
            case .lower:
                return cur <= t ? .good : (cur <= t * 1.05 ? .warn : .bad)
            case .neutral:
                return .good
            }
        }()
        // Caption
        let caption: String = {
            if let t = target {
                return decimals == 0 ? "target \(Int(t))" : "aim \(String(format: "%.1f", t))"
            }
            return "30-day avg \(decimals == 0 ? "\(Int(avg28.rounded()))" : String(format: "%.\(decimals)f", avg28))"
        }()
        // History bars from the small drift between avg14 and current ·
        // backend doesn't ship a per-day series for form yet so we
        // synthesize a plausible 14-bar drift between 28d-avg and current.
        let history = drift(from: avg28, to: cur, n: 14, seed: id.hashValue & 0xFFFF)
        let chart28 = drift(from: avg28 * 0.97, to: cur, n: 28, seed: (id + "28").hashValue & 0xFFFF)
        return HealthMetric(
            id: id, label: label, value: valueStr, unit: unit,
            history: history, chart28: chart28,
            target: target, status: status, direction: direction,
            caption: caption, coach: coach
        )
    }

    // MARK: - Helpers

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

    /// Stable pseudo-random drift from `start` → `end` over `n` samples
    /// with small per-point jitter. Same seed always returns the same
    /// series so charts don't flicker across renders.
    private static func drift(from start: Double, to end: Double, n: Int, seed: Int) -> [Double] {
        var rng = SeededRNG(seed: UInt64(seed))
        var result: [Double] = []
        for i in 0..<n {
            let t = Double(i) / Double(max(1, n - 1))
            let base = start + (end - start) * t
            let jitter = (Double(rng.next() % 1000) / 1000.0 - 0.5) * abs(end - start) * 0.18
            result.append(base + jitter)
        }
        return result
    }

    private static func clock(_ minutes: Int) -> String {
        let h = minutes / 60
        let m = minutes % 60
        return "\(h):\(String(format: "%02d", m))"
    }
}

/// xorshift PRNG · seedable so series stays stable across re-renders.
private struct SeededRNG {
    var state: UInt64
    init(seed: UInt64) { self.state = seed == 0 ? 0xDEAD_BEEF : seed }
    mutating func next() -> UInt64 {
        state ^= state << 13
        state ^= state >> 7
        state ^= state << 17
        return state
    }
}
