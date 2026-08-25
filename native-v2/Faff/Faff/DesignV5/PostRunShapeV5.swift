//
//  PostRunShapeV5.swift
//  faff.run iPhone · what a finished run of THIS kind is allowed to claim.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY THIS EXISTS
//
//      "each type of run will need a different break down. Not everything is
//       by mile. Not everything is a global cadence, etc. not everything is a
//       global HR."
//
//  The post-run screen was template-driven: one set of rows, drawn for every
//  run, filled with whatever the payload happened to carry. CLAUDE.md has said
//  the opposite since it was written — "composition is state-driven, not
//  template-driven" — and this surface was the last one still ignoring it.
//
//  THE CLAIM AN AGGREGATE MAKES. A whole-run average asserts that the run was
//  ONE THING. That is true of an easy run and false of a rep session, and the
//  falseness is not a rounding error: the 2026-08-11 tune-up stored nine
//  phases, and a single average across them is a number no part of that run
//  was ever at. It averages 5:50 reps with jogging recovery and describes
//  neither. Cadence is worse, because cadence is a direct function of pace —
//  "172 spm" across a session alternating reps with walking is not a fact
//  about anything the runner did.
//
//  So an aggregate has to EARN its place per run type. Where it cannot, the
//  honest moves are, in order: scope it to the work (`hr_avg_work` and
//  `cadence_avg_work` have been computed server-side for months and drawn
//  nowhere), or omit it. Never print it anyway.
//
//  DECOMPOSITION IS THE SAME QUESTION. Per-mile is ONE decomposition, not the
//  decomposition. Miles suit a run held at one effort. A rep session
//  decomposes to its reps. A tempo decomposes to its block, with the warm-up
//  and the cool-down as context rather than content. A treadmill run has no
//  route at all and should not pretend otherwise.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHAT THIS FILE IS AND IS NOT
//
//  It is the RULE, in one place, shared by `TodayAfterV5` and `RunDetailV5` —
//  because the constraint that binds hardest here is that no two surfaces may
//  disagree about one run. Both screens ask this type what to draw; neither
//  decides for itself.
//
//  It is NOT a design document. The v5 handoff governs type scale, ink,
//  spacing and how a row is built. It does not decide which rows exist, and
//  looking there for a list of what a post-run screen contains is looking in
//  the wrong place. This is a training-science question before it is a design
//  one, and the citations below are to `Research/`, not to the handoff.
//

import Foundation

/// The shape of a finished session, reduced to the distinctions that change
/// what is honest to show.
///
/// Deliberately COARSER than `lib/training/workout-type.ts`'s thirteen types.
/// Threshold and intervals are different prescriptions and the same shape —
/// hard efforts with recovery between them — so they compose identically, and
/// a case per wire spelling would be thirteen chances to forget one.
enum RunShapeV5: Equatable {

    /// Held one effort throughout · easy, shakeout.
    case steady

    /// A recovery jog. Its own case, not a quieter easy run.
    ///
    /// `Research/00b` §"Recovery Run vs. Easy Run" is explicit that these are
    /// distinct sessions and "mislabeling them produces fatigue accumulation":
    /// RPE 2-3, under 60% HRmax, and a stimulus that is "minimal — the purpose
    /// is circulation, not adaptation". `Research/03` §14 then gives the rule
    /// that separates the two screens: for a recovery jog, "cap HR; ignore
    /// pace". Printing a pace on this run creates the exact incentive the
    /// doctrine warns against.
    case recovery

    /// Held one effort, for long enough that the story is what happened LATE.
    /// `Research/02` §long run: the adaptation is durability, so the question
    /// is whether the last miles held, which is a per-mile question.
    case longSteady

    /// One block of work inside a frame · tempo, threshold. The block is the
    /// session; the warm-up and cool-down are how you get to it and back.
    case workBlock

    /// A race-week tune-up. The type most likely to generate a false alarm,
    /// and therefore its own case.
    ///
    /// `Research/08` §9.3's template is 35-45 minutes containing about five
    /// minutes of quality — "3 mi w/ 5 x 1 min @ 5K pace, full recovery". Every
    /// whole-run aggregate therefore describes the jogging, and a screen that
    /// read them would report a low-intensity session on a correctly executed
    /// taper workout. CLAUDE.md already carries this exact incident: a taper
    /// workout with pace in the T-band and HR sub-Z4 was misread as an
    /// easy-days-too-hard symptom when it was intentional conservation.
    ///
    /// So the aggregates come off entirely and the reps carry the session.
    case tuneUp

    /// Many short efforts with recovery between · intervals, fartlek.
    case reps

    /// A ramp · progression. Decomposes per mile like a steady run, because
    /// the ramp IS the mile-by-mile story, but carries no whole-run aggregate
    /// because the whole point is that it was not one effort.
    case progression

    /// Measured against a goal rather than a prescription.
    case race

    /// No route, no GPS, and no outdoors.
    case indoor

    /// Nothing recognisable. Composes as the shape that ASSERTS LEAST — miles,
    /// which every run has, and only the aggregates that are safe on any run.
    case unknown

    /// From the canonical session type. `indoor` outranks everything: a tempo
    /// on a treadmill still has no route and still has no weather.
    static func of(workoutType: String?, indoor: Bool) -> RunShapeV5 {
        if indoor { return .indoor }
        switch (workoutType ?? "").lowercased() {
        case "easy", "shakeout":       return .steady
        case "recovery":               return .recovery
        case "long":                   return .longSteady
        case "tempo", "threshold":     return .workBlock
        case "race_week_tuneup":       return .tuneUp
        case "intervals", "fartlek":   return .reps
        case "progression":            return .progression
        case "race":                   return .race
        default:                       return .unknown
        }
    }

    // MARK: - How the run breaks down

    enum Decomposition {
        /// Mile by mile.
        case miles
        /// The pieces the session was actually made of.
        case sections
        /// Neither is honest. Nothing is drawn.
        case none
    }

    /// A SESSION MADE OF PIECES IS NOT DESCRIBED BY ITS MILES.
    ///
    /// Mile two of a tune-up holds the back of one rep, a recovery jog and the
    /// front of the next, averaged into a single row. That row is arithmetic
    /// on three different efforts and answers no question anyone has. Where
    /// the run recorded its pieces, the pieces are the breakdown.
    ///
    /// A run whose phases did not survive falls back to miles, which is worse
    /// but true — see `preferredDecomposition(hasSections:hasMiles:)`.
    var decomposition: Decomposition {
        switch self {
        case .steady, .recovery, .longSteady, .progression,
             .race, .indoor, .unknown:            return .miles
        case .workBlock, .tuneUp, .reps:          return .sections
        }
    }

    /// What is actually drawable, given what this run recorded. The rule above
    /// is a preference; a rep session whose phases never reached the phone is
    /// still better served by its miles than by nothing.
    func decomposition(hasSections: Bool, hasMiles: Bool) -> Decomposition {
        switch decomposition {
        case .sections: return hasSections ? .sections : (hasMiles ? .miles : .none)
        case .miles:    return hasMiles ? .miles : (hasSections ? .sections : .none)
        case .none:     return .none
        }
    }

    // MARK: - Which aggregates earn their place

    /// A WHOLE-RUN AVERAGE HEART RATE.
    ///
    /// YES on a run held at one effort. `Research/03` §13 puts the boundary
    /// exactly there — "≥15 min · HR reliable · HR primary" — and §14's
    /// per-type table makes internal load the coaching metric for aerobic
    /// work. On an easy or recovery run the average IS the effort.
    ///
    /// NO on anything made of pieces, and the reason is mechanical rather than
    /// aesthetic. `Research/04` §6.1 prescribes recovery jogs of roughly the
    /// same duration as the reps, so the average is a near 50/50 blend of two
    /// intensities that were never prescribed together. `Research/03` §13
    /// compounds it: HR lags 30-90 s to plateau, so during short reps it never
    /// reaches the intended band at all. A 12 x 400 session run entirely at 5K
    /// pace can report an average heart rate in Z3 — which reads as a session
    /// that undershot when it did nothing of the kind.
    ///
    /// NO ON A RACE either, which surprised me and is well argued.
    /// `Research/08` §6.1: "cardiovascular drift adds 3-5 bpm/hour at constant
    /// effort, so fixed mid-marathon caps are unreliable", and `Research/03`
    /// §14 prescribes "pace early, HR later" for marathon and up. A race's
    /// heart rate is a deliberately RISING CURVE, and one average collapses it
    /// into a number that describes no phase of the race. The per-mile table's
    /// own HR column is that curve, drawn properly.
    var showsWholeRunHrAvg: Bool {
        switch self {
        case .steady, .recovery, .longSteady, .indoor, .unknown: return true
        case .workBlock, .tuneUp, .reps, .progression, .race:    return false
        }
    }

    /// AVERAGE HEART RATE ACROSS THE WORK ONLY.
    ///
    /// The honest replacement on a session made of pieces. `run-state.ts` has
    /// computed `hr_avg_work` — a weighted average over WORK phases, "the real
    /// effort numbers minus the jog-in-between dilution" — since P44, and no
    /// screen has ever drawn it.
    ///
    /// NOT ON A TUNE-UP. Even scoped to the work, `Research/03` §13 says HR
    /// does not resolve on the one-minute reps `Research/08` §9.3 prescribes
    /// for race week, so a work-scoped average there would still be a number
    /// the runner was never at.
    var showsWorkHrAvg: Bool {
        switch self {
        case .workBlock, .reps, .progression: return true
        default:                              return false
        }
    }

    /// A MAXIMUM HEART RATE.
    ///
    /// YES on a rep session, where it is the most informative row on the
    /// screen. `Research/03` §18 makes the peak a PACE-VALIDITY check rather
    /// than a target: "HR not reaching VO2max band by rep 3 of 5 x 3 min →
    /// pace too slow". How deep the later reps went is what the runner came
    /// to see.
    ///
    /// YES on a race, and on a tempo as a sanity check that the block did not
    /// tip into VO2max territory.
    ///
    /// NO on easy, recovery, long or progression runs. The peak there is a
    /// hill, a road crossing, a dog, or a wrist-optical cadence lock
    /// (`Research/03` §15 catalogues the failure modes). `Research/03` grades
    /// an easy run on where it SAT, and printing its worst second beside a Z2
    /// prescription invites reading a thirty-second spike as a failed session.
    var showsMaxHr: Bool {
        switch self {
        case .reps, .race, .workBlock: return true
        case .steady, .recovery, .longSteady, .progression,
             .tuneUp, .indoor, .unknown: return false
        }
    }

    /// A WHOLE-RUN AVERAGE CADENCE.
    ///
    /// Cadence is speed-dependent — `Research/00a` §"Cadence rules": "cadence
    /// is speed-dependent: it rises naturally with pace" — so one figure is a
    /// real fact only when the run held one pace. On a session alternating
    /// reps with jogging it is the mean of two populations and describes
    /// neither, and it hides the one thing cadence is good for: the
    /// fatigue-driven drop late in a hard effort (`Research/08` §7.1 records a
    /// 3-8 spm fall in a marathon's final 10K that "precedes the pace drop").
    var showsWholeRunCadence: Bool {
        switch self {
        case .steady, .recovery, .longSteady, .race, .indoor, .unknown: return true
        case .workBlock, .tuneUp, .reps, .progression:                  return false
        }
    }

    /// Cadence across the work only · `cadence_avg_work`, same argument as
    /// `showsWorkHrAvg`.
    var showsWorkCadence: Bool { showsWorkHrAvg }

    /// A WHOLE-RUN AVERAGE PACE, as a stated row.
    ///
    /// NO ON A RECOVERY RUN, which is the one flat prohibition in this file.
    /// `Research/03` §14, for a recovery jog: "cap HR; ignore pace". The
    /// session's stimulus is circulation, not adaptation (`Research/00b`
    /// §"Recovery Run vs. Easy Run"), and putting a pace on the screen creates
    /// exactly the incentive that turns a recovery run into a slow easy run —
    /// which that section names as the mislabelling that "produces fatigue
    /// accumulation".
    ///
    /// NO on a session made of pieces, for the blending reason above: an
    /// average of rep-pace work and jog recoveries lands near easy pace.
    var showsWholeRunPace: Bool {
        switch self {
        case .recovery, .workBlock, .tuneUp, .reps, .progression: return false
        case .steady, .longSteady, .race, .indoor, .unknown:      return true
        }
    }

    /// A PACE COLUMN IN THE BREAKDOWN.
    ///
    /// Off on a recovery run, which is the only place this is false, and it is
    /// the sharp end of the same ruling as `showsWholeRunPace`. `Research/03`
    /// §14 does not say "de-emphasise pace" for a recovery jog, it says
    /// "ignore pace" — and suppressing only the whole-run figure while listing
    /// it mile by mile would leave the incentive exactly where it was.
    /// `Research/00b` §"Recovery Run vs. Easy Run" names the consequence:
    /// mislabelling the two "produces fatigue accumulation", and a runner
    /// reading three paces off a recovery run is being invited to make it a
    /// slow easy run.
    ///
    /// Heart rate stays, because that is the one thing the session is graded
    /// on — RPE 2-3, under 60% HRmax.
    var showsPerMilePace: Bool { self != .recovery }

    /// TEMPERATURE.
    ///
    /// Every outdoor run, because heat is the largest confounder of pace the
    /// runner does not control (`Research/06`), and a slow day in heat is a
    /// different fact from a slow day.
    ///
    /// NEVER INDOORS. A treadmill run's "temperature" is a weather model for a
    /// grid square the runner was not standing in. It is not a weak reading;
    /// it is a reading of somewhere else.
    var showsTemperature: Bool { self != .indoor }

    /// ELEVATION.
    ///
    /// NEVER INDOORS, and this one is a fabrication rather than a weak signal.
    /// `Research/01` §"Treadmill workout-specific notes" and `Research/15`
    /// §"Pace and GPS Accuracy" both note the watch has nothing to measure
    /// there: the figure comes back either invented by the barometer or zero
    /// regardless of a 6% grade. Either way it is not the run's climb.
    ///
    /// Suppressed on a rep session and a tune-up too, where a track's
    /// barometric wander is noise around zero.
    var showsElevation: Bool {
        switch self {
        case .indoor, .reps, .tuneUp: return false
        default:                      return true
        }
    }

    /// A route map. Indoors there is nothing to draw, and the card says so in
    /// words rather than drawing an empty frame.
    var showsRoute: Bool { self != .indoor }

    /// The heading over the breakdown, in the runner's words.
    func breakdownTitle(_ d: Decomposition) -> String {
        switch d {
        case .miles:    return "Mile by mile"
        case .sections: return self == .reps ? "Rep by rep" : "Piece by piece"
        case .none:     return ""
        }
    }
}
