//
//  TreadmillPhaseSets.swift
//  faff.run iPhone · which phases count as "the same set" for override
//  propagation.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY TYPE ALONE WAS TOO BROAD (P0 gap #2)
//
//  `BeltSession` used to key a runner's speed/incline override by
//  `WatchPhaseType` alone — every `.work` phase in the whole session shared
//  one override. Correct for a session with a single repeated block (ten
//  hill reps, all the same prescription), wrong the moment a session has
//  TWO work blocks with different targets (4x800m @ threshold, then
//  4x400m @ mile pace): an edit to an 800 would have silently carried into
//  the 400s, which are a different prescription entirely.
//
//  THE FIX: group by (type, nominal target), not type alone. A "set" is
//  every phase sharing the same `WatchPhaseType` AND the same nominal
//  speed/incline target (`BeltSession.nominalMph`/`nominalInclinePct` — the
//  SAME resolved value the recorder already adopts as each phase's own plan
//  target, never a second reading of what a phase is prescribed) as the
//  MOST RECENT phase of that same type — not "adjacent in the whole array."
//  A real interval session alternates work and recovery every phase
//  (Hill/Jog/Hill/Jog...), so grouping by raw array adjacency alone would
//  put every single phase in its own set the moment a different-type phase
//  sits between two otherwise-identical ones — the exact defect
//  `setIds(for:)`'s own header now documents, found by its own test. Two
//  work blocks with different targets still get different set ids even
//  though both are `.work`, because at the moment the second block starts
//  it does not match what was last seen for `.work`. Warm-up and cooldown
//  are singletons in every plan this app authors, so each lands in its own
//  one-phase set automatically — no special case needed.
//
//  Pure, no HealthKit/SwiftUI dependency — testable against a literal
//  phase array.
//

import Foundation

enum TreadmillPhaseSets {
    /// One set id per phase, same length and order as `phases`. Phases at
    /// the same index in two different calls with the same input always
    /// produce the same ids — deterministic, no hidden state.
    ///
    /// FALSIFIED AND FIXED (2026-09-03, closing P0 gap #2's own re-audit):
    /// the first version compared each phase only to the phase IMMEDIATELY
    /// BEFORE it — correct for a block with nothing interleaved, wrong for
    /// the actual shape every real interval session has. Hill/Jog/Hill/Jog
    /// alternates TYPES every phase, so under adjacency-only grouping every
    /// single phase differed from its immediate predecessor and got its own
    /// id — ten hill reps would have produced TEN sets, one runner override
    /// apiece, propagating to none of the others. `testSetIdsGroupConsecutivePhasesOfTheSameTypeAndTarget`
    /// caught it: two Hill reps with a Jog between them read as two
    /// different sets.
    ///
    /// Fixed by tracking the last (type, target) key seen FOR EACH TYPE
    /// independently, not for the array position — a phase reuses its
    /// type's last id when its own key still matches that type's last-seen
    /// key, so recoveries interleaving with work does not reset either
    /// stream. A genuinely different target for the same type (a later,
    /// differently-prescribed work block) still starts a new id, because at
    /// the moment it appears it does not match what was last seen for
    /// `.work`.
    static func setIds(for phases: [WatchPhase]) -> [Int] {
        var ids: [Int] = []
        ids.reserveCapacity(phases.count)
        var nextId = 0
        var lastKeyForType: [WatchPhaseType: SetKey] = [:]
        var lastIdForType: [WatchPhaseType: Int] = [:]
        for phase in phases {
            let key = SetKey(phase)
            if lastKeyForType[phase.type] == key, let reuse = lastIdForType[phase.type] {
                ids.append(reuse)
            } else {
                let id = nextId
                nextId += 1
                lastKeyForType[phase.type] = key
                lastIdForType[phase.type] = id
                ids.append(id)
            }
        }
        return ids
    }

    /// The equality that defines "the same set." Rounded to 2 decimal
    /// places so server-side floating-point noise on an otherwise-identical
    /// target (9.500000001 vs 9.5) can never split one authored set into
    /// two by accident.
    private struct SetKey: Equatable {
        let type: WatchPhaseType
        let mph: Double
        let inclinePct: Double

        init(_ phase: WatchPhase) {
            type = phase.type
            mph = (BeltSession.nominalMph(for: phase) * 100).rounded() / 100
            inclinePct = (BeltSession.nominalInclinePct(for: phase) * 100).rounded() / 100
        }
    }
}
