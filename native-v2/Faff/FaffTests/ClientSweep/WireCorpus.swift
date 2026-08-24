//
//  WireCorpus.swift
//  faff.run iPhone · the payloads the sweep runs against.
//
//  ─────────────────────────────────────────────────────────────────────────
//  EVERY FIXTURE HERE IS THE SERVER'S OWN OUTPUT.
//
//  Not one of them was written to make a test pass. `V5ContractTests.Fixtures`
//  is `composeV5Today`'s verbatim dump; `RunDetailV5Sample` is production, read
//  at `faff_readonly` out of `coach_intents.value.phases` for the 2026-08-11
//  race-week tune-up. A fixture invented to fit the decoder only ever proves
//  the decoder agrees with itself, which is the failure this whole directory
//  exists to stop.
//
//  Reusing them rather than copying them is deliberate. A second copy of a
//  fixture drifts from the first, and then two tests disagree about what the
//  server sends with no way to tell which one is right.
//

import Foundation
@testable import Faff

/// One payload the sweep will corrupt, plus what the phone should do about it.
struct CorpusEntry {
    let name: String
    let json: String
    /// The app's real decoder. Throwing on purpose: the sweep needs to see the
    /// throw, not a nil that hides which of the two things went wrong.
    let decode: (String) throws -> Any

    /// JSON paths where a REFUSAL IS THE CORRECT ANSWER.
    ///
    /// Rule three: a refusal is a correct answer, not an empty state. A
    /// payload that cannot say which screen it is, or which day it is for, is
    /// not a payload with a hole in it — it is not a payload. Failing loudly
    /// there is right, and the sweep must not nag about it.
    ///
    /// Everything NOT named here is a detail, and a detail must never be able
    /// to take the whole screen down with it. Naming a path here is a decision
    /// on the record; the silence of an allowlist nobody wrote is not.
    let identity: Set<String>

    /// KNOWN VIOLATIONS, EACH WITH AN HONEST REASON.
    ///
    /// Straight out of Rule 7: when a gate reveals a real violation you do not
    /// loosen the gate, you record the violation and say so in the report.
    /// Every key here is a defect this sweep found on the day it was written
    /// and which is NOT yet fixed — not a case being excused, a case being
    /// tracked.
    ///
    /// These are checked for STALENESS. Fix the decoder and the sweep fails
    /// until the entry is deleted, so the list can only ever shrink. An
    /// exemption nobody can remove is just a hole with paperwork.
    let exempt: [String: String]

    init(_ name: String,
         json: String,
         identity: Set<String> = [],
         exempt: [String: String] = [:],
         decode: @escaping (String) throws -> Any) {
        self.name = name
        self.json = json
        self.identity = identity
        self.exempt = exempt
        self.decode = decode
    }
}

enum WireCorpus {

    private static func v5Today(_ json: String) throws -> Any {
        try JSONDecoder().decode(V5Today.self, from: Data(json.utf8))
    }
    private static func runDetail(_ json: String) throws -> Any {
        try JSONDecoder().decode(RunDetail.self, from: Data(json.utf8))
    }
    private static func runRecap(_ json: String) throws -> Any {
        try JSONDecoder().decode(RunRecap.self, from: Data(json.utf8))
    }

    // ─────────────────────────────────────────────────────────────────────
    // KNOWN VIOLATIONS · found by this sweep on the day it was written.
    //
    // None of these is invented and none is theoretical: each is a decode
    // the app performs today, with the screen it produces named. They are
    // recorded rather than silenced, and the staleness check means fixing
    // one FORCES its removal from this file.
    // ─────────────────────────────────────────────────────────────────────

    /// Shared by every composed Today state.
    private static let todayStateDefault = [
        "identity|state":
            "V5Today.init reads `c.opt(.state) ?? .beforeRun`. A payload that cannot say which state it is draws the PRE-RUN screen — so on an injury-flare day a hurt runner is shown a session and told to go and run."
    ]
    private static let weekStripCollapse = [
        "list|weekStrip":
            "`c.list` is `(try? decodeIfPresent([T])) ?? []`. One unreadable field on one day empties the ENTIRE week strip, and an empty strip is indistinguishable from a strip the server never sent."
    ]

    /// Shared by every run-detail shape.
    private static let runDetailKnown: [String: String] = [
        "identity|id":
            "RunDetail.id falls back rather than refusing. A detail screen that cannot say which run it is showing still draws every other number it managed to decode.",
        "zero|distance_mi":
            "`?? 0`. A run whose distance could not be read renders a confident 0.0 mi beside a real duration.",
        "zero|hrZonePcts.z1": Self.zoneReason, "zero|hrZonePcts.z2": Self.zoneReason,
        "zero|hrZonePcts.z3": Self.zoneReason, "zero|hrZonePcts.z4": Self.zoneReason,
        "zero|hrZonePcts.z5": Self.zoneReason,
        "collapse|distance_mi · numberAsString":
            "`try c.decode(Double.self)`. node-pg hands numerics back as strings for int8/numeric, and one such column fails the WHOLE run detail rather than one field.",
    ]
    private static let shoeReason =
        "RunDetailShoe decodes through the SYNTHESISED initialiser — the exact shape PhaseBreakdown was written out by hand to escape, unfixed here. Any corruption of a shoe row fails the ENTIRE run detail, so a runner opening a run they just finished gets nothing because of the shoe they wore."

    private static let zoneReason =
        "HRZonePcts falls back to an all-zero struct, so a zone breakdown we could not read draws 0% in all five bands — a chart making a confident claim out of a hole."

    private static func phaseElementNulls() -> [String: String] {
        var out: [String: String] = [:]
        for i in 0...8 {
            out["collapse|phase_breakdown[\(i)] · nulled"] =
                "A null ELEMENT still re-raises through `[PhaseBreakdown]`. The per-field leniency written after the 164.5 bpm incident covers a bad FIELD; it does not cover a null phase, which still takes the whole run detail down."
        }
        for i in 1...8 {
            out["zero|phase_breakdown[\(i)].index"] =
                "`decodeFlexInt(.index) ?? 0`. Every unreadable phase collapses onto index 0, and `id` is `index` — so two phases collide and SwiftUI draws one of them."
        }
        return out
    }

    /// THE SEVEN COMPOSED TODAY STATES plus the run-detail shapes the phone
    /// can be handed. Between them these are the screens the runner actually
    /// looks at on a training day.
    static let all: [CorpusEntry] = [
        // ── Today · every state composeV5Today can produce ──────────────────
        // `state` is the discriminator that decides which screen draws at all,
        // and `panel` is the poster every state but one carries. Losing either
        // is not a hole in Today, it is the absence of Today.
        CorpusEntry("today/before_run",
                    json: V5ContractTests.Fixtures.beforeRun,
                    identity: ["state", "panel"],
                    exempt: todayStateDefault.merging(weekStripCollapse) { a, _ in a },
                    decode: v5Today),
        CorpusEntry("today/changed_overnight",
                    json: V5ContractTests.Fixtures.changedOvernight,
                    identity: ["state", "panel"],
                    exempt: todayStateDefault
                        .merging(weekStripCollapse) { a, _ in a }
                        .merging([
                            "list|changed.converged":
                                "Same lenient helper. RULE TWO LIVES IN THIS LIST — three independent domains must converge before a session changes — so one unreadable domain empties it, and the convergence story disappears with no trace that it was ever told."
                        ]) { a, _ in a },
                    decode: v5Today),
        CorpusEntry("today/changed_two_domains",
                    json: V5ContractTests.Fixtures.changedOvernightTwoDomains,
                    identity: ["state", "panel"],
                    exempt: todayStateDefault.merging(weekStripCollapse) { a, _ in a },
                    decode: v5Today),
        CorpusEntry("today/injury_flare",
                    json: V5ContractTests.Fixtures.injuryFlare,
                    identity: ["state", "panel"],
                    exempt: todayStateDefault.merging(weekStripCollapse) { a, _ in a },
                    decode: v5Today),
        CorpusEntry("today/week_off",
                    json: V5ContractTests.Fixtures.weekOff,
                    identity: ["state", "panel"],
                    exempt: todayStateDefault.merging(weekStripCollapse) { a, _ in a },
                    decode: v5Today),
        CorpusEntry("today/off_season",
                    json: V5ContractTests.Fixtures.offSeason,
                    identity: ["state", "panel"],
                    exempt: todayStateDefault.merging(weekStripCollapse) { a, _ in a },
                    decode: v5Today),
        // No week strip on this one — it is a refusal, and it draws no week.
        CorpusEntry("today/not_on_phone_yet",
                    json: V5ContractTests.Fixtures.notOnPhoneYet,
                    identity: ["state", "panel"],
                    exempt: todayStateDefault,
                    decode: v5Today),

        // ── Run detail · the 2026-08-11 tune-up and its siblings ────────────
        // `id` identifies WHICH run. A detail screen that cannot say which run
        // it is showing must refuse rather than draw someone else's numbers.
        CorpusEntry("run/intervals",
                    json: RunDetailV5Sample.intervalsJSON,
                    identity: ["id"],
                    exempt: runDetailKnown
                        .merging(phaseElementNulls()) { a, _ in a }
                        .merging([
                            "list|splits":
                                "`(try? c.decode([RunSplit].self)) ?? []`. One unreadable mile empties every mile, and the run draws no split list at all.",
                            "collapse|planned_distance_mi · numberAsString":
                                "`try c.decodeIfPresent(Double.self)`. A planned distance returned as a string fails the whole run detail.",
                        ]) { a, _ in a },
                    decode: runDetail),
        CorpusEntry("run/outdoor",
                    json: RunDetailV5Sample.outdoorJSON,
                    identity: ["id"],
                    exempt: runDetailKnown.merging([
                        "list|splits":
                            "`(try? c.decode([RunSplit].self)) ?? []`. One unreadable mile empties every mile.",
                        "collapse|temp_f · numberAsString":
                            "`try c.decodeIfPresent(Double.self)`. A temperature returned as a string fails the whole run detail.",
                        // RunDetailShoe still decodes through the SYNTHESISED
                        // initialiser — the exact shape PhaseBreakdown was
                        // written out by hand to escape. Every corruption of a
                        // shoe's id takes the run detail with it.
                        "collapse|shoes[0] · nulled": Self.shoeReason,
                        "collapse|shoes[0].id · nulled": Self.shoeReason,
                        "collapse|shoes[0].id · removed": Self.shoeReason,
                        "collapse|shoes[0].id · fractional": Self.shoeReason,
                        "collapse|shoes[0].id · numberAsString": Self.shoeReason,
                        "collapse|shoes[0].mileage · numberAsString": Self.shoeReason,
                        "collapse|shoes[0].retire_at_mi · numberAsString": Self.shoeReason,
                        "collapse|shoes[0].run_types[0] · nulled": Self.shoeReason,
                    ]) { a, _ in a },
                    decode: runDetail),
        CorpusEntry("run/treadmill",
                    json: RunDetailV5Sample.treadmillJSON,
                    identity: ["id"],
                    exempt: runDetailKnown,
                    decode: runDetail),

        // ── Recap · the sentences the engine wrote about a run ──────────────
        CorpusEntry("recap/outdoor",
                    json: RunDetailV5Sample.recapJSON,
                    decode: runRecap),
        CorpusEntry("recap/intervals",
                    json: RunDetailV5Sample.intervalsRecapJSON,
                    decode: runRecap),
    ]
}
