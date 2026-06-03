//
//  RecoveryBrief.swift
//
//  Decodable mirror of the backend RecoveryBrief contract in
//  designs/briefs/today-postrun-pivot-execution.md TASK B1 (backend
//  module lib/coach/recovery-brief.ts).
//
//  Returned by GET /api/coach/recovery-brief when today's run is done.
//  Powers the Today screen's post-run pivot (5 sections A-E replacing
//  the morning readiness ring + pillars + chips).
//
//  Lenient on every field · partial payloads never drop the decode.
//  Doctrine: every field defaulted so a malformed sub-object can't
//  blank out the entire pivot view. Cold-start returns nil cleanly
//  (no HRV history etc).
//
//  Created 2026-06-02 round 58 · forward-compat ahead of backend B1.
//

import Foundation

struct RecoveryBrief: Decodable {
    /// "standard" for easy/tempo/intervals/recovery days · "long_run"
    /// for the long-run day. Drives copy + pillar weighting.
    let mode: String                              // "standard" | "long_run"
    let score: Int                                // 0-100
    let band: String                              // "recovered" | "recovering" | "dragging" | "depleted"
    let oneLine: String                           // engine-authored, ≤90 chars
    let bigCopy: String                           // 2-line headline

    let pillars: RecoveryPillars
    let trainingInput: RecoveryTrainingInput
    let nextHard: RecoveryNextHard
    let weekProgress: RecoveryWeekProgress
    /// 2026-06-02 round 66 · backend shipped @ c4579d85.
    /// ISO timestamp of the LATEST pillar return-time (typically HRV
    /// rebound, but RHR-baseline wins on high-RHR + mild-HRV days).
    /// Sleep target intentionally excluded — would conflate "fully
    /// recovered" with "after you wake up." Empty string when not
    /// computable. Prefer this over per-pillar projectedReturnISO
    /// math for the FULLY RECOVERED tile (Section D).
    let fullyRecoveredAt: String

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.mode = try c.decodeIfPresent(String.self, forKey: .mode) ?? "standard"
        self.score = c.decodeFlexInt(forKey: .score) ?? 0
        self.band = try c.decodeIfPresent(String.self, forKey: .band) ?? "recovering"
        self.oneLine = try c.decodeIfPresent(String.self, forKey: .oneLine) ?? ""
        self.bigCopy = try c.decodeIfPresent(String.self, forKey: .bigCopy) ?? ""
        self.pillars = (try? c.decode(RecoveryPillars.self, forKey: .pillars)) ?? RecoveryPillars.empty
        self.trainingInput = (try? c.decode(RecoveryTrainingInput.self, forKey: .trainingInput)) ?? RecoveryTrainingInput.empty
        self.nextHard = (try? c.decode(RecoveryNextHard.self, forKey: .nextHard)) ?? RecoveryNextHard.empty
        self.weekProgress = (try? c.decode(RecoveryWeekProgress.self, forKey: .weekProgress)) ?? RecoveryWeekProgress.empty
        self.fullyRecoveredAt = try c.decodeIfPresent(String.self, forKey: .fullyRecoveredAt) ?? ""
    }
    enum CodingKeys: String, CodingKey {
        case mode, score, band, oneLine, bigCopy
        case pillars, trainingInput, nextHard, weekProgress
        case fullyRecoveredAt
    }
}

// MARK: - Pillars

struct RecoveryPillars: Decodable {
    let sleepTarget: SleepTargetPillar
    let hrvRebound: HRVReboundPillar
    let rhrDelta: RHRDeltaPillar
    let fueling: FuelingPillar

    static let empty = RecoveryPillars(
        sleepTarget: .empty, hrvRebound: .empty, rhrDelta: .empty, fueling: .empty
    )

    init(sleepTarget: SleepTargetPillar,
         hrvRebound: HRVReboundPillar,
         rhrDelta: RHRDeltaPillar,
         fueling: FuelingPillar) {
        self.sleepTarget = sleepTarget
        self.hrvRebound = hrvRebound
        self.rhrDelta = rhrDelta
        self.fueling = fueling
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.sleepTarget = (try? c.decode(SleepTargetPillar.self, forKey: .sleepTarget)) ?? .empty
        self.hrvRebound = (try? c.decode(HRVReboundPillar.self, forKey: .hrvRebound)) ?? .empty
        self.rhrDelta = (try? c.decode(RHRDeltaPillar.self, forKey: .rhrDelta)) ?? .empty
        self.fueling = (try? c.decode(FuelingPillar.self, forKey: .fueling)) ?? .empty
    }
    enum CodingKeys: String, CodingKey { case sleepTarget, hrvRebound, rhrDelta, fueling }
}

struct SleepTargetPillar: Decodable {
    let hoursTarget: Double                       // 8.5
    let hoursDelta: Double                        // +0.75 vs personal avg
    let reason: String                            // "Pfitz +30-60min after threshold work"

    static let empty = SleepTargetPillar(hoursTarget: 0, hoursDelta: 0, reason: "")

    init(hoursTarget: Double, hoursDelta: Double, reason: String) {
        self.hoursTarget = hoursTarget
        self.hoursDelta = hoursDelta
        self.reason = reason
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.hoursTarget = try c.decodeIfPresent(Double.self, forKey: .hoursTarget) ?? 0
        self.hoursDelta = try c.decodeIfPresent(Double.self, forKey: .hoursDelta) ?? 0
        self.reason = try c.decodeIfPresent(String.self, forKey: .reason) ?? ""
    }
    enum CodingKeys: String, CodingKey { case hoursTarget, hoursDelta, reason }
}

struct HRVReboundPillar: Decodable {
    let currentDrop: Int                          // ms drop vs 14d baseline
    let projectedReturnISO: String                // "2026-06-03T07:00:00-07:00"
    let pct: Int                                  // 0-100 recovery progress

    static let empty = HRVReboundPillar(currentDrop: 0, projectedReturnISO: "", pct: 0)

    init(currentDrop: Int, projectedReturnISO: String, pct: Int) {
        self.currentDrop = currentDrop
        self.projectedReturnISO = projectedReturnISO
        self.pct = pct
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.currentDrop = c.decodeFlexInt(forKey: .currentDrop) ?? 0
        self.projectedReturnISO = try c.decodeIfPresent(String.self, forKey: .projectedReturnISO) ?? ""
        self.pct = c.decodeFlexInt(forKey: .pct) ?? 0
    }
    enum CodingKeys: String, CodingKey { case currentDrop, projectedReturnISO, pct }
}

struct RHRDeltaPillar: Decodable {
    let currentBpm: Int
    let baselineBpm: Int
    let projectedMorningBpm: Int
    let pct: Int                                  // 0-100

    static let empty = RHRDeltaPillar(currentBpm: 0, baselineBpm: 0, projectedMorningBpm: 0, pct: 0)

    init(currentBpm: Int, baselineBpm: Int, projectedMorningBpm: Int, pct: Int) {
        self.currentBpm = currentBpm
        self.baselineBpm = baselineBpm
        self.projectedMorningBpm = projectedMorningBpm
        self.pct = pct
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.currentBpm = c.decodeFlexInt(forKey: .currentBpm) ?? 0
        self.baselineBpm = c.decodeFlexInt(forKey: .baselineBpm) ?? 0
        self.projectedMorningBpm = c.decodeFlexInt(forKey: .projectedMorningBpm) ?? 0
        self.pct = c.decodeFlexInt(forKey: .pct) ?? 0
    }
    enum CodingKeys: String, CodingKey { case currentBpm, baselineBpm, projectedMorningBpm, pct }
}

struct FuelingPillar: Decodable {
    /// "open" (< 20min since run) · "closing" (20-30min) · "closed" (>30min) ·
    /// "logged" when nutrition is recorded · "missed" when window passed
    /// without a log.
    let windowState: String
    let minutesRemaining: Int?
    let pct: Int                                  // 0-100

    static let empty = FuelingPillar(windowState: "closed", minutesRemaining: nil, pct: 0)

    init(windowState: String, minutesRemaining: Int?, pct: Int) {
        self.windowState = windowState
        self.minutesRemaining = minutesRemaining
        self.pct = pct
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.windowState = try c.decodeIfPresent(String.self, forKey: .windowState) ?? "closed"
        self.minutesRemaining = c.decodeFlexInt(forKey: .minutesRemaining)
        self.pct = c.decodeFlexInt(forKey: .pct) ?? 0
    }
    enum CodingKeys: String, CodingKey { case windowState, minutesRemaining, pct }
}

// MARK: - Training input

struct RecoveryTrainingInput: Decodable {
    let tssDelta: Int                             // +92 TSS
    let formDelta: Int                            // -4
    let formBandLabel: String                     // "OPTIMAL" | "PRODUCTIVE" | "OVERREACH" | "FRESH"
    let arcDirection: String                      // "on_track" | "flat" | "slipping"

    static let empty = RecoveryTrainingInput(tssDelta: 0, formDelta: 0, formBandLabel: "", arcDirection: "")

    init(tssDelta: Int, formDelta: Int, formBandLabel: String, arcDirection: String) {
        self.tssDelta = tssDelta
        self.formDelta = formDelta
        self.formBandLabel = formBandLabel
        self.arcDirection = arcDirection
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.tssDelta = c.decodeFlexInt(forKey: .tssDelta) ?? 0
        self.formDelta = c.decodeFlexInt(forKey: .formDelta) ?? 0
        self.formBandLabel = try c.decodeIfPresent(String.self, forKey: .formBandLabel) ?? ""
        self.arcDirection = try c.decodeIfPresent(String.self, forKey: .arcDirection) ?? ""
    }
    enum CodingKeys: String, CodingKey { case tssDelta, formDelta, formBandLabel, arcDirection }
}

// MARK: - Next hard session

struct RecoveryNextHard: Decodable {
    let type: String                              // "tempo"
    let dateISO: String                           // "2026-06-04"
    let label: String                             // "THU TEMPO"
    let hoursUntil: Int                           // 47
    let trajectoryChip: String                    // "Sleep tonight matters" (≤7 words)

    static let empty = RecoveryNextHard(type: "", dateISO: "", label: "", hoursUntil: 0, trajectoryChip: "")

    init(type: String, dateISO: String, label: String, hoursUntil: Int, trajectoryChip: String) {
        self.type = type
        self.dateISO = dateISO
        self.label = label
        self.hoursUntil = hoursUntil
        self.trajectoryChip = trajectoryChip
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.type = try c.decodeIfPresent(String.self, forKey: .type) ?? ""
        self.dateISO = try c.decodeIfPresent(String.self, forKey: .dateISO) ?? ""
        self.label = try c.decodeIfPresent(String.self, forKey: .label) ?? ""
        self.hoursUntil = c.decodeFlexInt(forKey: .hoursUntil) ?? 0
        self.trajectoryChip = try c.decodeIfPresent(String.self, forKey: .trajectoryChip) ?? ""
    }
    enum CodingKeys: String, CodingKey { case type, dateISO, label, hoursUntil, trajectoryChip }
}

// MARK: - Week-to-date progress

struct RecoveryWeekProgress: Decodable {
    let bankedMi: Double                          // 28
    let targetMi: Double                          // 45
    let dots: Int                                 // 4 (filled out of 7)
    let longRun: RecoveryLongRun?
    let acwr: RecoveryACWR

    static let empty = RecoveryWeekProgress(
        bankedMi: 0, targetMi: 0, dots: 0, longRun: nil, acwr: RecoveryACWR(value: 0, band: "OK")
    )

    init(bankedMi: Double, targetMi: Double, dots: Int, longRun: RecoveryLongRun?, acwr: RecoveryACWR) {
        self.bankedMi = bankedMi
        self.targetMi = targetMi
        self.dots = dots
        self.longRun = longRun
        self.acwr = acwr
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.bankedMi = try c.decodeIfPresent(Double.self, forKey: .bankedMi) ?? 0
        self.targetMi = try c.decodeIfPresent(Double.self, forKey: .targetMi) ?? 0
        self.dots = c.decodeFlexInt(forKey: .dots) ?? 0
        self.longRun = try? c.decode(RecoveryLongRun.self, forKey: .longRun)
        self.acwr = (try? c.decode(RecoveryACWR.self, forKey: .acwr)) ?? RecoveryACWR(value: 0, band: "OK")
    }
    enum CodingKeys: String, CodingKey { case bankedMi, targetMi, dots, longRun, acwr }
}

struct RecoveryLongRun: Decodable {
    let dateISO: String
    let mi: Double
    let daysUntil: Int

    init(dateISO: String, mi: Double, daysUntil: Int) {
        self.dateISO = dateISO; self.mi = mi; self.daysUntil = daysUntil
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.dateISO = try c.decodeIfPresent(String.self, forKey: .dateISO) ?? ""
        self.mi = try c.decodeIfPresent(Double.self, forKey: .mi) ?? 0
        self.daysUntil = c.decodeFlexInt(forKey: .daysUntil) ?? 0
    }
    enum CodingKeys: String, CodingKey { case dateISO, mi, daysUntil }
}

struct RecoveryACWR: Decodable {
    let value: Double                             // 1.02
    let band: String                              // "OK" | "WATCH" | "RAMP_UP"

    init(value: Double, band: String) { self.value = value; self.band = band }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.value = try c.decodeIfPresent(Double.self, forKey: .value) ?? 0
        self.band = try c.decodeIfPresent(String.self, forKey: .band) ?? "OK"
    }
    enum CodingKeys: String, CodingKey { case value, band }
}
