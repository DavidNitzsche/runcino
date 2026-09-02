//
//  APIV5.swift
//  faff.run iPhone · the v5 surface's wire contracts.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY THE V5 SURFACE HAS ITS OWN ENDPOINTS
//
//  The existing endpoints are organised by DATA (plan week, training state,
//  readiness, races, projection). The v5 design is organised by SCREEN, and
//  the two do not line up: Today alone would need six calls and would then
//  have to decide client-side whether the session changed overnight, whether
//  the runner is in a week off, and whether a number is modelled.
//
//  That last one is why this file exists rather than a pile of client-side
//  derivation. Rule one says a modelled number must never look measured, and
//  the design contract puts the responsibility in the right place: "the engine
//  flags every case in its payloads." So every number that can be modelled
//  arrives with its own `modelled` flag beside it, and the phone never decides.
//
//  `V5Number` is that pair. It decodes straight into a `FaffValue`, so a field
//  the server marked projected cannot reach the screen without its amber tilde.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THIS FILE IS THE CONTRACT
//
//  The routes under `web-v2/app/api/v5/**` are written to match these structs.
//  Where a struct has an explicit `CodingKeys`, the wire key is the raw value
//  there; otherwise the wire key is the property name. Changing a key here is
//  changing the contract.
//
//  A screen is never blocked on a route. Every optional here has a designed
//  absent state in the v5 README — `Silence`, `Alert`, or the `unreadable`
//  value — so a surface that is not built yet degrades to the state the design
//  already draws rather than to a blank.
//

import Foundation
import SwiftUI

// MARK: - A number with its provenance

/// The engine's own answer to "is this measured or modelled".
///
/// Wire: `{ "text": "3:16:45", "modelled": true }`. A null object is not the
/// same as a null text — a missing object means the engine had nothing to say,
/// which is `unreadable`, not zero.
struct V5Number: Decodable, Equatable, Hashable {
    let text: String?
    let modelled: Bool

    enum CodingKeys: String, CodingKey { case text, modelled }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        text = try c.decodeIfPresent(String.self, forKey: .text)
        // Absent flag reads as MODELLED, never as measured. Over-marking makes
        // a real number look humble; under-marking is the sin.
        //
        // UNREADABLE READS AS MODELLED TOO, and it used to throw.
        //
        // This was `try c.decodeIfPresent(Bool.self, ...)`, so a `modelled`
        // that arrived as anything but a JSON bool — `"true"`, `1`, whatever a
        // driver or a jsonb column hands back — did not fall to the safe
        // default the line above it promises. It raised, out through the
        // enclosing `V5Number`, out through the row, out through the payload,
        // and took the entire screen with it. The one field carrying rule one
        // was the most brittle field in the contract.
        //
        // Now: a flag we cannot read is treated exactly like a flag that was
        // never sent. There is no third answer, and "measured" is never it.
        if let flag = try? c.decodeIfPresent(Bool.self, forKey: .modelled) {
            modelled = flag ?? true
        } else {
            modelled = true
        }
    }

    init(text: String?, modelled: Bool) {
        self.text = text
        self.modelled = modelled
    }

    /// The only way this reaches a screen.
    var value: FaffValue { .from(text, modelled: modelled) }
}

extension Optional where Wrapped == V5Number {
    /// ─────────────────────────────────────────────────────────────────────
    /// ABSENT IS NOT UNREADABLE, AND THIS USED TO CONFLATE THEM
    ///
    /// The first version of this returned `.unreadable` for nil, which is
    /// right for a STAT — a plate always has three slots, and an empty slot
    /// means we could not read it — and catastrophically wrong for a ROW.
    /// `V5Row.value` is nil when the row simply has no value: "Move or skip"
    /// has none, an upcoming race has no finish time. Those rendered a
    /// fault-red dash, which is the app's one way of saying "we could not read
    /// this". On the Races schedule it claimed we had failed to read the
    /// result of five races that have not been run yet.
    ///
    /// So there is no blanket conversion any more. A caller with a slot to
    /// fill asks for `unreadableIfAbsent`; a caller rendering an optional row
    /// passes the optional straight through and nil draws nothing.
    var unreadableIfAbsent: FaffValue { self?.value ?? .unreadable }

    /// nil stays nil. The component draws nothing.
    var optionalValue: FaffValue? { self?.value }
}

// MARK: - Shared small shapes

/// How the engine wants a value inked.
///
/// ─────────────────────────────────────────────────────────────────────────
/// WHY TONE IS ON THE WIRE AND NOT DERIVED ON THE PHONE
///
/// The prototype draws an out-of-band value in amber, and the obvious client
/// implementation is `if ran < band.low || ran > band.high`. That is wrong for
/// the same reason rule one is a system rule: the phone does not hold the band.
/// It holds a formatted string. The engine knows what was asked, what was run,
/// what the heat did to the target and whether the workout was a taper session
/// that is meant to be slow. A client comparison would paint a deliberately
/// easy taper mile amber and tell the runner they missed.
///
/// So the engine says. Absent means neutral, which is the safe default: a
/// missing tone can only ever under-mark, never accuse.
///
/// There is no `good`. Amber means outside the range that was asked for, fault
/// means we could not read it, and no value is ever graded.
enum V5Tone: String, Decodable {
    case neutral
    /// Outside its target range, stale, or a decision waiting.
    case attention
    /// The runner's own current position or value. Never "good".
    case signal
    /// We could not read this.
    case fault

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = V5Tone(rawValue: raw) ?? .neutral
    }

    var ink: Color {
        switch self {
        case .neutral:   return V5.textPrimary
        case .attention: return V5.attention
        case .signal:    return V5.signal
        case .fault:     return V5.fault
        }
    }

    /// The ink where the component already HAS a default for an untoned
    /// value — a quiet row, a value on a gradient panel.
    ///
    /// Neutral is nil, not `textPrimary`: "the engine said nothing" must
    /// leave a value exactly as quiet as it was, and on a poster the page
    /// ink is the wrong ink outright. Every other case is the engine asking
    /// for a specific colour, so it gets one.
    ///
    /// This exists because the call sites were writing `tone == "attention"`
    /// against the RAW string, which silently dropped `fault` and `signal` —
    /// a value the engine said it could not read was drawn as if it had.
    var inkOverride: Color? { self == .neutral ? nil : ink }
}

/// A labelled value on a poster's translucent plate.
struct V5Stat: Decodable, Equatable, Hashable {
    let label: String
    let value: V5Number
    /// `"attention"` when the engine wants this drawn amber — a gap behind its
    /// goal. Never a grade, and never green, because there is no green.
    let tone: String?

    var toneValue: V5Tone { tone.flatMap(V5Tone.init(rawValue:)) ?? .neutral }
}

/// A row in any `ListGroup`.
/// One workout phase's distance and duration, for colouring reps at their
/// true pace rather than smearing them into mile averages.
struct V5RoutePhase: Decodable, Equatable {
    let mi: Double
    let sec: Int
    /// "warmup" | "work" | "recovery" | "cooldown" | "unknown" | nil.
    ///
    /// Nil on a payload from before 2026-09-01 — `web-v2/app/api/v5/today
    /// /route.ts`'s `routePhases` dropped the watch's own `type` on the
    /// floor, wire-narrowing a real classification down to a bare
    /// distance-and-duration pair. `TodayAfterV5.sectionPieces` falls back
    /// to a numbered, unnamed row only when this is nil — never guesses a
    /// phase's role from its pace.
    let type: String?
    /// VERDICT-1 (2026-09-01) · THE canonical verdict for this phase —
    /// "hit" | "fast" | "slow" | "incomplete" — from
    /// `web-v2/lib/execution/verdict.ts`, the same resolver run detail's
    /// phase panel reads. Nil when the phase was not pace-graded (a
    /// recovery jog, a by-feel stride) and on older payloads.
    let verdict: String?
    /// The word for `verdict`, correct for the phase's pace shape ("Under
    /// the ceiling", "Quicker than target"), composed server side so this
    /// sheet and run detail read one sentence. Nil when nothing was graded.
    let statusLabel: String?

    enum K: String, CodingKey {
        case mi, sec, type, verdict
        case statusLabel = "status_label"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        mi = try c.decode(Double.self, forKey: .mi)
        sec = try c.decode(Int.self, forKey: .sec)
        type = try c.decodeIfPresent(String.self, forKey: .type)
        verdict = try c.decodeIfPresent(String.self, forKey: .verdict)
        statusLabel = try c.decodeIfPresent(String.self, forKey: .statusLabel)
    }

    init(mi: Double, sec: Int, type: String?, verdict: String? = nil, statusLabel: String? = nil) {
        self.mi = mi; self.sec = sec; self.type = type
        self.verdict = verdict; self.statusLabel = statusLabel
    }
}

/// The pace window the session asked for, seconds per mile. When present the
/// route stops grading and answers the same question the split chart answers.
struct V5PaceBand: Decodable, Equatable {
    let lo: Int
    let hi: Int
}

struct V5Row: Decodable, Equatable, Hashable, Identifiable {
    /// Server id where the row stands for a real record; otherwise a synthesised
    /// stable key. Identity is never the date.
    let id: String
    let label: String
    let sub: String?
    let value: V5Number?
    /// What tapping it does, as a verb the client switches on. Absent means the
    /// row opens nothing, and therefore draws no chevron.
    let action: String?
    /// How the engine wants the VALUE inked. See `V5Tone`. Absent is neutral.
    let tone: String?

    var toneValue: V5Tone { tone.flatMap(V5Tone.init(rawValue:)) ?? .neutral }

    /// Defaults on the two the engine may not send, so adding a field to this
    /// contract never breaks a construction site.
    init(id: String, label: String, sub: String? = nil, value: V5Number? = nil,
         action: String? = nil, tone: String? = nil) {
        self.id = id; self.label = label; self.sub = sub
        self.value = value; self.action = action; self.tone = tone
    }
}

/// An instruction group: Warm up / Work / Cool down, or a per-mile list.
struct V5Group: Decodable, Equatable, Hashable, Identifiable {
    let id: String
    let title: String
    let note: String?
    let steps: [V5Step]
    /// True for the group that carries the actual work, as against the warm up
    /// and the cool down around it. The design tints the work's tile and keeps
    /// the bookends quiet; inferring that from POSITION breaks the moment a
    /// session has two work blocks or none, so the engine says which.
    let isWork: Bool?
    /// PRERUN-1 · how to EXECUTE this group, and what to do when it goes
    /// wrong. "Same pace on every rep. If the last one slips, the target was
    /// too fast." "Continuous and controlled. If the breathing turns ragged,
    /// ease off 5 to 10 sec/mi."
    ///
    /// The approved 5a design carries this as `groupFooter`, and the server
    /// has composed the sentences in `lib/training/spec-card.ts` all along —
    /// one per phase role, never naming a distance, so they cannot contradict
    /// the structure above them. `lib/faff/v5-today.ts` was dropping them on
    /// the floor with the rest of the step, which left the screen holding
    /// numbers and no instruction: on a rep day the only thing telling the
    /// runner what to do when the third rep slips was nothing at all.
    ///
    /// Optional and additive. A build that has never heard of it decodes and
    /// renders exactly as it did before.
    let footer: String?

    var work: Bool { isWork ?? false }

    init(id: String, title: String, note: String? = nil,
         steps: [V5Step], isWork: Bool? = nil, footer: String? = nil) {
        self.id = id; self.title = title; self.note = note
        self.steps = steps; self.isWork = isWork; self.footer = footer
    }
}

struct V5Step: Decodable, Equatable, Hashable, Identifiable {
    let id: String
    let main: String
    let sub: V5Number?
    /// How the engine wants this step's value inked. See `V5Tone`. This is the
    /// per-mile "ran 11s slow" case, and the engine owns the judgement because
    /// it is the only side that holds the band and the context around it.
    let tone: String?

    var toneValue: V5Tone { tone.flatMap(V5Tone.init(rawValue:)) ?? .neutral }

    init(id: String, main: String, sub: V5Number? = nil, tone: String? = nil) {
        self.id = id; self.main = main; self.sub = sub; self.tone = tone
    }
}

// MARK: - Today · GET /api/v5/today
//
// One call for the hero screen, and the one place that decides WHICH Today
// this is. The client does not infer the state from a pile of nulls.

/// Which Today this is. Unknown values decode to `.beforeRun` rather than
/// failing, so a server that learns a new state does not break an old build.
enum V5TodayState: String, Decodable {
    case beforeRun = "before_run"
    case afterRun = "after_run"
    case changedOvernight = "changed_overnight"
    case injuryFlare = "injury_flare"
    /// Systemic illness (`sick_episodes`), not a diagnosed injury
    /// (`runner_injuries`, `.injuryFlare` above). Same quiet, no-gradient
    /// treatment; a different backing table, verdict copy and check-in
    /// (a daily trend, not a one-shot note — see `V5Sick`).
    case sick = "sick"
    case weekOff = "week_off"
    case offSeason = "off_season"
    case raceDay = "race_day"
    /// The runner is not in race mode. The phone has no screens for coached,
    /// just-run, or distance-goal-without-a-race, and says so rather than
    /// drawing three blank screens.
    case notOnPhoneYet = "not_on_phone_yet"

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = V5TodayState(rawValue: raw) ?? .beforeRun
    }
}

/// The panel at the top of a place screen.
struct V5Panel: Decodable, Equatable {
    /// `easy|rest|quality|race|phase|long`. Ignored when `quiet` is true.
    let dayState: String
    /// True on the screens with nothing to prescribe — injury flare,
    /// off-season, paces moved. A designed state, not a missing gradient.
    let quiet: Bool
    let place: String
    let dateLine: String
    /// The right-hand line beside the date. "Week 6 of 16" before a run,
    /// "Logged 07:11" after one.
    let weekLine: String?
    /// Weather plus duration before a run. "Treadmill · indoor, no GPS" after
    /// a treadmill one, with no weather, because there was none.
    let kicker: String?
    /// The display-face graphic. Uppercase at the call site.
    let type: String
    /// The dose, in the value face.
    let dose: V5Number?
    let stats: [V5Stat]

    var state: V5.DayState { V5.DayState(rawValue: dayState) ?? .easy }
    var fill: PanelFill { quiet ? .quiet : .state(state) }
}

struct V5WeekStripDay: Decodable, Equatable, Hashable, Identifiable {
    /// `plan_workout_id`, or `date:<iso>` for a synthesised rest day. The date
    /// is a lookup, never an identity.
    let id: String
    let dateISO: String
    let letter: String
    let number: String
    let dayState: String
    let isToday: Bool
    let isDone: Bool
    let isRest: Bool

    var strip: WeekStripDayV5 {
        WeekStripDayV5(id: id, dateISO: dateISO,
                       letter: letter, weekday: Self.weekdayName(dateISO),
                       number: number,
                       state: V5.DayState(rawValue: dayState) ?? .easy,
                       isToday: isToday, isDone: isDone, isRest: isRest)
    }

    /// "Thursday" from "2026-08-20". Speech only — the strip still draws the
    /// single letter the design specifies.
    ///
    /// Fixed to the POSIX calendar and UTC on purpose: `dateISO` is a plain
    /// calendar date with no zone, and re-interpreting it in the device's zone
    /// is how a Sunday becomes a Saturday for anyone west of Greenwich. The
    /// formatter is localised, so the NAME follows the runner's language even
    /// though the arithmetic does not move.
    private static func weekdayName(_ iso: String) -> String? {
        guard let date = Self.isoParser.date(from: String(iso.prefix(10))) else { return nil }
        return Self.weekdayFormatter.string(from: date)
    }

    private static let isoParser: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(secondsFromGMT: 0)
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    private static let weekdayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.timeZone = TimeZone(secondsFromGMT: 0)
        f.setLocalizedDateFormatFromTemplate("EEEE")
        return f
    }()
}

/// RULE TWO on the wire.
///
/// The engine grades readiness from five independent domains and needs THREE
/// to converge before it may downgrade a session. So a payload describing a
/// changed session carries the domains that converged, and the client renders
/// the story only when there are three. `coachLine` is composed server-side
/// from the same set and never names one cause.
struct V5Convergence: Decodable, Equatable {
    /// "3:12 AM".
    let updatedAt: String
    /// What the session was before. "Threshold".
    let wasType: String?
    let coachLine: String
    let converged: [V5ConvergedDomain]
    /// Where the original session went. Null when a downgrade replaced it in
    /// place rather than moving it, which is the usual case — and the screen
    /// then says so instead of inventing a destination.
    let movedTo: V5Row?
}

struct V5ConvergedDomain: Decodable, Equatable, Hashable, Identifiable {
    let id: String
    /// "Sleep", "HRV", "Resting heart rate".
    let domain: String
    let value: V5Number
    /// The runner's OWN rolling baseline, named. Readiness has no single
    /// evening/morning pair to compare, only a 7-day median and a 3-day
    /// average, so the row says which one it is against.
    let baseline: String

    var row: ConvergenceDomainRow {
        ConvergenceDomainRow(domain: domain, value: value.value, baseline: baseline)
    }
}

struct V5Injury: Decodable, Equatable {
    let area: String
    let since: String
    let verdict: String
    /// "what changed this week" — reduced mileage and the like.
    let whatChanged: [V5Row]
    /// Better / About the same / Worse. Tapping logs in place.
    let checkIn: [V5Row]
    /// Present once the flare has cleared to return. Links to the ladder.
    let returnAvailable: Bool
}

/// Systemic illness, from `sick_episodes` — NOT `V5Injury`. Same shape on
/// the wire (a quiet panel, a verdict, a check-in list), because both are
/// "the engine read it and the answer is not today" — but `checkIn` here is
/// a daily TREND (better/same/worse/recovered → `POST /api/sick/recovery`),
/// not a one-shot note, and there is no `returnAvailable` ladder: answering
/// `recovered` clears the episode server-side and Today reverts to its
/// normal state on its own next load.
struct V5Sick: Decodable, Equatable {
    let symptoms: [String]
    let hasFever: Bool
    let since: String
    let verdict: String
    let checkIn: [V5Row]
}

struct V5WeekOff: Decodable, Equatable {
    let reason: String
    let fromISO: String
    let toISO: String
    let coachLine: String
    /// What Monday looks like.
    let nextUp: V5Row?
}

struct V5OffSeason: Decodable, Equatable {
    /// "Eleven weeks since Big Sur".
    let sinceLastRace: String?
    /// The `Silence` component's reason. The coach has nothing honest to say
    /// about a block that does not exist yet, and says that, rather than
    /// inventing a sentence to fill the space.
    let silenceReason: String
    /// A loose range, deliberately loose. "25 to 35 miles a week".
    let weeklyRange: String?
}

/// The whole Today surface.
struct V5Today: Decodable, Equatable {
    let dateISO: String
    let state: V5TodayState
    let panel: V5Panel
    let weekStrip: [V5WeekStripDay]
    let groups: [V5Group]
    /// "Why this run".
    let why: String?
    /// See `V5Thesis`. Absent on older servers, on a day that prescribes
    /// nothing, and when the resolve failed.
    let thesis: V5Thesis?
    let whereYouAre: [V5Row]
    let beforeYouGo: [V5Row]
    /// Today's own entry point onto 18a. Present only when the active plan
    /// carries an unacknowledged pace-drop event — `V5Route.pacesMoved`,
    /// "reached from a coach line, not from the bar".
    let paceNote: V5Row?
    /// The block-transition coach note (2026-08-28). Non-nil only on the
    /// morning a block auto-started (recovery→build handoff and its
    /// lifecycle siblings, the server's own 24h window). The push
    /// notification is the lock-screen half; this is what the runner finds
    /// when they open Today. Absent on older servers.
    let blockNote: V5BlockNote?

    // ── after a run ──
    /// The asked-vs-ran table. Effort is the only tappable row.
    let askedVsRan: [V5Row]
    let verdict: String?
    /// The recap's supporting sentences, under the verdict.
    ///
    /// `deriveRecap` has returned four things since it was written — a
    /// verdict, one or two plain-English facts, an optional forward-looking
    /// tip and an optional conditions note — and this screen took the verdict.
    /// The others were composed on every request and dropped. One or two
    /// short sentences; empty is a real answer.
    let facts: [String]
    /// `lib/coach/run-win.ts`'s four-to-ten word line, when the run has a real
    /// thing to point at. Null far more often than not, and a null is the
    /// engine declining rather than a gap to fill.
    let win: String?
    /// What the weather did to the session. Null on a neutral day, and a
    /// neutral day draws nothing rather than a heading over nothing.
    let conditionsNote: String?
    /// The only sentence here that is about next time.
    let coachTip: String?
    /// THE READING · the four instrument values the run recorded.
    ///
    /// Quantities, not sentences: this screen owns the words and the units, so
    /// a wording change never touches the payload. Nil means the run recorded
    /// nothing, and the row is then NOT DRAWN — never a zero, never a dash.
    let hrAvg: Int?
    let hrMax: Int?
    let cadenceAvg: Int?
    /// Air temperature, F. MODELLED — nothing on the wrist or in the phone has
    /// a thermometer, so this is a weather read for a grid square and an hour
    /// bucket. Rendered `.modelled`, the same call run detail already makes.
    let tempF: Double?
    /// The canonical session type, from `lib/training/workout-type.ts`.
    ///
    /// THE SCREEN COMPOSES ITSELF FROM THIS. `panel.dayState` is the coarse
    /// four-way bucket and cannot tell a tempo from a rep set — and those two
    /// need different screens, because an aggregate that summarises a tempo
    /// block describes no part of a rep session.
    let workoutType: String?
    /// THE SAME READING, SCOPED TO THE WORK.
    ///
    /// What a session made of pieces shows INSTEAD of the whole-run figures,
    /// not as well as. Computed by `lib/runs/work-averages.ts`, the one place
    /// in the app that does this arithmetic, shared with run detail.
    let hrAvgWork: Int?
    let cadenceAvgWork: Int?
    let paceWork: String?
    /// Percent in each of five zones.
    let zoneShares: [Double]?
    /// The zone(s) the session asked for, ascending.
    ///
    /// `zoneTarget` is the older single-Int field and is NULL whenever the
    /// ask is a set — the server will not pick one of a half-marathon's two
    /// zones to fit an Int, because emphasising half an instruction is worse
    /// than emphasising none. Read `zoneTargets`; `zoneTarget` is kept only
    /// so a phone running against a server that predates the set still has
    /// something to fall back to.
    let zoneTargets: [Int]?
    let zoneTarget: Int?
    /// The route's elevation, for the profile. Absent on a treadmill run,
    /// where the design replaces the card entirely — and absent, now, when
    /// no split carried an elevation reading. It used to arrive as a run of
    /// zeros in that case, which drew a flat line at sea level and was
    /// indistinguishable from a genuinely flat run.
    let elevation: [Double]?
    /// Per-mile splits, phases, zone bands and the asked pace window — what
    /// lets the map colour by the axis that matters for THIS session instead
    /// of drawing one flat line that says only where the runner went.
    let routeSplits: [RunSplit]
    let routePhases: [V5RoutePhase]
    let hrZones: [HRZoneRange]
    let paceBand: V5PaceBand?
    /// True only when an instrument measured the climb. A `gps_derived` figure
    /// is arithmetic over the weakest axis of a GPS fix and runs 2.3x the
    /// barometer on this runner's data; it must never print as measured.
    let elevGainMeasured: Bool
    /// The run's encoded route. Null on a treadmill and null when no GPS was
    /// recorded; the card says which rather than drawing an empty frame.
    let routePolyline: String?
    /// The run's MEASURED climb, in feet.
    ///
    /// Read instead of summing `elevation`. The card used to derive its climb
    /// from the profile, so a run whose splits carried no elevation reported
    /// "0 ft up" while its own row recorded 128. The profile is a picture of
    /// the terrain; this is the measurement of it.
    let elevGainFt: Int?
    /// Every shoe in the garage, so the worn row can offer a menu instead of
    /// sending the runner to another screen to answer a question about
    /// this run.
    let shoeOptions: [V5Row]
    /// The treadmill run's "On the belt" card. Avg speed mph, avg incline pct.
    let onTheBelt: [V5Stat]?
    let shoesWorn: V5Row?
    let whatThisDidToTheWeek: [V5Row]
    /// THE CANONICAL POST-RUN INTERPRETATION.
    ///
    /// The same object `/api/runs/[id]` and `/api/runs/[id]/recap` return under
    /// the same key, composed once by `lib/postrun/experience.ts`. Nil on a
    /// server that predates the field and on a run it could not be composed
    /// for — the section is then not drawn, which is honest; an empty section
    /// under a heading is not.
    let postRun: PostRunV5?
    let runId: String?

    // ── the state screens ──
    let changed: V5Convergence?
    let injury: V5Injury?
    let sick: V5Sick?
    let weekOff: V5WeekOff?
    let offSeason: V5OffSeason?

    /// Race mode is the only mode the phone draws. Everything else is a
    /// refusal with a reason, not three blank screens.
    let notOnPhoneYet: String?
}

/// One block-transition note: the decision card's own headline plus the
/// proposal's composed message, quoted verbatim — the phone never rewrites
/// the coach's sentence (same contract as `verdict`/`facts`).
struct V5BlockNote: Decodable, Equatable {
    let title: String
    let body: String
}

/// THE COACHING THESIS · `BRAIN_CONSTITUTION.md` §F, on the wire.
///
/// "What are we currently trying to accomplish with this runner." Composed
/// server-side by `lib/training/coaching-thesis.ts` off the Runner Model's own
/// capacities and QUOTED here, never re-written: §P is explicit that the UI
/// displays intelligence and does not create it, so this screen owns where the
/// sentence sits and nothing about what it says.
///
/// Two fields, both rendered, and no third. The limiter, the priority code and
/// the confidence stay on the server's own `CoachingThesis` — they are how the
/// sentence was arrived at, not something a runner acts on, and a property the
/// phone decodes but never draws is decoration.
///
/// On Today this is an ALTERNATIVE to `why`, never a sibling: the route
/// composes `why` out of this thesis on every quality day, so the About
/// section draws one of them and the runner never reads the strategy twice
/// (Rule 17).
struct V5Thesis: Decodable, Equatable {
    /// Two sentences: what holds, then where the work goes.
    let coachLine: String
    /// What would change the strategy. Belongs to the BLOCK, not to a day —
    /// see the Block screen's own comment for why it is drawn only there.
    let reviewTrigger: String?
}

extension V5Thesis {
    // Spelled as an explicit `enum K` rather than left to the synthesised
    // conformance so `scripts/check-wire-keys.sh` can SEE these two keys. The
    // gate's extractor reads `enum K: String, CodingKey` blocks; a struct that
    // relies on synthesis is invisible to it, which is a green light over a
    // road nobody is watching — the exact failure that script's own header
    // describes.
    enum K: String, CodingKey { case coachLine, reviewTrigger }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        coachLine = c.text(.coachLine)
        reviewTrigger = c.opt(.reviewTrigger)
    }
}

// MARK: - Block · GET /api/v5/block

struct V5Block: Decodable, Equatable {
    let panel: V5Panel
    /// The phase arc.
    let phases: [V5Phase]
    let coachLine: String?
    /// See `V5Thesis`. The block-level strategy, drawn under `coachLine`.
    let thesis: V5Thesis?
    /// "so far in this block".
    let soFar: [V5Row]
    /// All sixteen weeks. Not sampled — the design lists every one.
    let weeks: [V5BlockWeek]
    /// WEEKANSWERS-1 (2026-09-02) · the block's five answers: how the long runs
    /// progress, where marathon pace starts, how it builds, why the longest run
    /// is that distance, and how the block prepares race effort rather than
    /// mileage. Derived by the composer and stored on the plan; nil on a block
    /// authored before they existed. Said ONCE here, never repeated per week
    /// (Rule 17) — the per-week answers are `V5BlockWeek.answers`.
    let blockAnswers: [V5Answer]?
    /// The 59-session catalogue.
    let library: [V5Workout]
    /// The five change-the-plan scenarios this runner can actually reach right
    /// now, each with its refusal reason if it cannot.
    let scenarios: [V5Scenario]
}

struct V5Phase: Decodable, Equatable, Hashable, Identifiable {
    let id: String
    let name: String
    let weeks: Int
    let current: Bool
    /// 0…1 through the current phase.
    let at: Double?

    var segment: PhaseSegment {
        PhaseSegment(name, weeks: weeks, current: current, at: at)
    }
}

struct V5BlockWeek: Decodable, Equatable, Hashable, Identifiable {
    let id: String
    /// "Wk 6".
    let label: String
    /// "This week" / "Race week" / "Cutback" / the phase name.
    let flag: String
    let miles: V5Number
    let isCurrent: Bool
    /// Seven days' load, for the week's shape.
    let days: [V5BlockDay]
    /// Long run / quality count / mileage, revealed when the row expands.
    let detail: [V5Row]
    /// WEEKANSWERS-1 (2026-09-02) · why this week looks like this: the
    /// mileage, the long run, the sessions, the cutback where there is one,
    /// how it builds on the week before, and how it prepares race day.
    /// Derived by the composer and stored on the plan. Optional so a block
    /// authored before they existed still decodes and simply shows none.
    let answers: [V5Answer]?
}

/// WEEKANSWERS-1 · one question and its answer, in coach voice.
struct V5Answer: Decodable, Equatable, Hashable, Identifiable {
    let id: String
    let label: String
    let text: String
}

struct V5BlockDay: Decodable, Equatable, Hashable, Identifiable {
    let id: String
    let miles: Double
    let quality: Bool
    let race: Bool
    let isToday: Bool
    let isFuture: Bool
    /// 2026-08-20 · added alongside the block-day route so the Today
    /// calendar sheet can list every week, not just the current one, from
    /// this same payload (`lib/plan/v5-block.ts:buildWeeks`). Optional so a
    /// stale cached payload from before this field existed still decodes —
    /// `WeekShape` (Block's own sparkline) never reads these three and is
    /// unaffected either way.
    let dateISO: String?
    /// Title-case display type — "Easy" / "Threshold" / "Rest" — the same
    /// word `/api/v5/today`'s week strip shows, via `displayTypeFor`.
    let type: String?
    let isDone: Bool?

    var load: WeekDayLoad {
        WeekDayLoad(miles: miles, quality: quality, race: race,
                    today: isToday, future: isFuture)
    }
}

/// One of the 59 cited sessions.
struct V5Workout: Decodable, Equatable, Hashable, Identifiable {
    let id: String
    let name: String
    /// "Threshold", "Interval", "Long run".
    let family: String
    /// The prescription, in coach voice.
    let prescription: String
    let structure: String?
    /// Where it comes from. A session with no citation is not in the library.
    let citation: String?
    let isQuality: Bool
}

/// A change-the-plan scenario, and whether it is available.
///
/// RULE THREE: an unavailable scenario is a refusal with a reason, not a
/// disabled control with no explanation and not an error. The sheet renders it
/// as an `Alert` with no confirm button, because there is nothing to confirm.
struct V5Scenario: Decodable, Equatable, Hashable, Identifiable {
    /// `cutback | travel | extra_day | move_day | another_race`.
    let id: String
    let label: String
    let sub: String
    let available: Bool
    /// Present exactly when `available` is false. "A cutback on a taper week
    /// is not a cutback." The sheet shows this and stops.
    let refusal: String?
}

// MARK: - Change the plan · POST /api/plan/change
//
// SHIPPING already. Proposes first and writes nothing until a confirm carrying
// a state token, so "read the trade-off, then confirm or back out" is the
// actual contract rather than a convention. A stale token comes back as
// `plan_moved` rather than applying to a plan the runner never read.

struct V5PlanChangeProposal: Decodable, Equatable {
    let ok: Bool
    let applied: Bool
    let scenario: String
    /// The confirm button's label.
    let verb: String
    /// One line naming what is about to happen.
    let headline: String
    /// The coach's stated trade-off. This is the thing the runner reads, and
    /// it is real output — its clauses are conditional, so size the container
    /// for the longest realistic string, not the average one.
    let tradeOff: String
    /// Anything in that sentence which is not a prescribed plan number. These
    /// get QUIETER treatment than the trade-off, below the coach line, never
    /// folded into it.
    let caveats: [String]
    let token: String
    let planId: String
    let effect: V5PlanEffect
    /// The Block screen's "Changed" entry, once applied.
    let changed: V5ChangedEntry
}

struct V5PlanEffect: Decodable, Equatable {
    let weeks: [V5PlanWeekChange]
    let milesDelta: Double
    let firstAffectedISO: String?
    let lastAffectedISO: String?
    /// True when applying hands the block to the generator rather than editing
    /// rows — which is why another-race's trade-off is a FORECAST, and why its
    /// caveat says so.
    let rebuilds: Bool
}

struct V5PlanWeekChange: Decodable, Equatable, Hashable, Identifiable {
    var id: Int { weekIdx }
    let weekIdx: Int
    let startISO: String
    let phase: String
    let milesBefore: Double
    let milesAfter: Double
    let longBefore: Double
    let longAfter: Double
    let qualityBefore: Int
    let qualityAfter: Int
    let flag: String?
}

struct V5ChangedEntry: Decodable, Equatable {
    let label: String
    let sub: String
}

/// A refusal, or a failure. These are DIFFERENT and the screen must not merge
/// them: `unavailable` and `rejected` mean we read it and the answer is no;
/// `plan_moved` means look again; the rest mean something broke.
struct V5PlanChangeRefusal: Decodable, Equatable {
    let ok: Bool
    /// `no_plan | bad_request | unavailable | plan_moved | rejected |
    ///  dosing_breach | rebuild_failed`
    let error: String
    let reason: String
    let violations: [String]?

    /// True when this is the engine declining on purpose. Renders as `Alert`.
    /// False means we could not do it, which renders as `ErrorNote`.
    ///
    /// `no_plan` belongs on this side of the line and was on the other one.
    /// `replan-scenarios.ts` answers it with a fully-formed sentence — "There
    /// is no active plan to change yet." — which is the engine reading the
    /// request and declining, exactly like `unavailable`. Treating it as a
    /// failure dressed a correct answer in the data-outage treatment and put a
    /// Retry button under it that could never succeed, because nothing was
    /// broken and nothing would change on a second try.
    ///
    /// `plan_moved` stays a failure on purpose: "look again" IS the right
    /// action there. `bad_request` and `rebuild_failed` stay failures because
    /// they mean something on our side is wrong, not that the answer is no.
    var isRefusal: Bool {
        error == "unavailable" || error == "rejected"
            || error == "dosing_breach" || error == "no_plan"
    }
}

// MARK: - Races · GET /api/v5/races
//
// TWO AXES, AND BOTH ARE REAL.
//
//   The TRIGGER is why we are asking now — a discrete event. It may be absent:
//   the goal can simply have drifted.
//
//   The VERDICT is what the engine thinks of the goal today. It is recomputed
//   on every read whether or not anything happened, so it is always present.
//
// The trigger decides the card's SHAPE, not just its copy. Only four of the
// eight triggers are a decision about the goal. A "Take 3:16:45" button under
// "is it hot on race morning" answers a question nobody asked, which is the
// mistake this split prevents.

enum V5CardShape: String, Decodable {
    /// Verdict, safe target, stretch target, up to three cautions, and three
    /// buttons naming real numbers.
    case decision
    /// One question and its own one or two answers. No safe/stretch pair, no
    /// target-naming buttons.
    case fact
    /// The same, where the engine cannot choose and the runner must.
    case choice

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = V5CardShape(rawValue: raw) ?? .fact
    }
}

/// The engine's standing judgement. Eight values, always present.
enum V5Feasibility: String, Decodable {
    case comfortable, realistic, ambitious, aggressive
    case outOfReach = "out-of-reach"
    case openEnded = "open-ended"
    case datePassed = "date-passed"
    case unreadable

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = V5Feasibility(rawValue: raw) ?? .unreadable
    }

    /// The quiet badge on the card.
    var badge: String {
        switch self {
        case .comfortable: return "Comfortable"
        case .realistic:   return "Realistic"
        case .ambitious:   return "Ambitious"
        case .aggressive:  return "Aggressive"
        case .outOfReach:  return "Out of reach"
        case .openEnded:   return "Open ended"
        case .datePassed:  return "Date passed"
        case .unreadable:  return "Cannot read it"
        }
    }
}

struct V5DecisionCard: Decodable, Equatable {
    let shape: V5CardShape
    let verdict: V5Feasibility
    /// Why we are asking now. Null when nothing happened and the goal drifted.
    let trigger: String?
    /// The question, in coach voice.
    let question: String
    /// Decision shape only. Both are PROJECTED and both carry the mark.
    let safeTarget: V5Number?
    let stretchTarget: V5Number?
    /// Up to three, each independently context-filtered by the engine.
    let cautions: [String]
    /// The answers. The row wraps rather than clipping, so a longer label like
    /// "Wait for Saturday" drops to its own line.
    let answers: [V5CardAnswer]
}

struct V5CardAnswer: Decodable, Equatable, Hashable, Identifiable {
    let id: String
    let label: String
    /// `hold | take | not_now | acknowledge | repace | confirm | leave |
    ///  choose_race`
    let action: String
    /// For `take`, the target being accepted, so the client never re-derives a
    /// time from a label.
    let targetSec: Double?
}

struct V5Races: Decodable, Equatable {
    let panel: V5Panel
    let card: V5DecisionCard?
    /// The full schedule. Upcoming ranked A/B/C in colour, past dimmed.
    let schedule: [V5RaceRow]
    /// The projected-finish trend. Modelled by definition, so the headline
    /// carries the mark.
    let trend: [Double]
    let trendHeadline: V5Number?
    /// The move over the window the series ACTUALLY covers, e.g. "Faster by
    /// 1m 12s over 12 days". Never a fixed "past month" label. Modelled, like
    /// everything derived from the trajectory. Nil below two reads.
    let trendDelta: V5Number?
    let trendFootnotes: [String]
    /// The races that count toward the read. This is the evidence, and a race
    /// whose chip time has not locked is explicitly NOT authoritative for
    /// fitness — its row says so.
    let evidence: [V5Row]
    let coachLog: [V5LogEntry]
}

struct V5RaceRow: Decodable, Equatable, Hashable, Identifiable {
    let id: String
    let slug: String
    let name: String
    let dateLine: String
    let distance: String
    /// `A | B | C`.
    let priority: String
    let isPast: Bool
    let result: V5Number?
    /// Expanded detail.
    let detail: [V5Row]
    /// `representative | compromised | unrepresentative`, once known. The
    /// design's "did this race count?" writes exactly this.
    let authority: String?
}

struct V5LogEntry: Decodable, Equatable, Hashable, Identifiable {
    let id: String
    let kind: String
    let date: String
    let body: String
    /// The coach's own eyebrow for this entry — "WEEK CLOSED", "PHASE",
    /// "FIRST", "FITNESS". Optional because the field is newer than the
    /// screen: `/api/v5/races` mapped `kind` and dropped `title`, so the
    /// phone printed the machine identifier. See `eyebrow`.
    let title: String?

    enum CodingKeys: String, CodingKey { case id, kind, date, body, title }

    /// Lenient decode per doctrine 2026-05-31 · every field defaults, so one
    /// malformed entry can never take the Races screen down with it.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try c.decodeIfPresent(String.self, forKey: .id) ?? ""
        self.kind = try c.decodeIfPresent(String.self, forKey: .kind) ?? ""
        self.date = try c.decodeIfPresent(String.self, forKey: .date) ?? ""
        self.body = try c.decodeIfPresent(String.self, forKey: .body) ?? ""
        self.title = try c.decodeIfPresent(String.self, forKey: .title)
    }

    /// Preview / test constructor · NOT a wire path.
    init(id: String, kind: String, date: String, body: String, title: String? = nil) {
        self.id = id; self.kind = kind; self.date = date
        self.body = body; self.title = title
    }

    /// WHAT THE RUNNER ACTUALLY READS ABOVE THE ENTRY.
    ///
    /// The log printed `kind` verbatim, so the owner's Races screen showed
    /// `WEEK_CLOSE` and `RACE_REPLACEMENT` — raw enum identifiers, in a
    /// surface whose whole job is the coach's voice. A coach does not say
    /// "WEEK_CLOSE".
    ///
    /// The server authors a real eyebrow ("WEEK CLOSED") and it is now on the
    /// wire. When it is absent — an older server, or a kind added without one
    /// — the identifier is at least de-cased rather than shown raw, so the
    /// worst case is "WEEK CLOSE" instead of "WEEK_CLOSE".
    var eyebrow: String {
        if let t = title?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty {
            return t
        }
        return kind.replacingOccurrences(of: "_", with: " ")
    }

    /// An entry with no body is a write-path receipt that leaked into the log,
    /// not something to draw. The owner's account carries exactly one — a
    /// `goal_answer` receipt written under the log's own `coach_log_` prefix
    /// (see `/api/v5/goal-answer`'s header) — and it rendered as an empty
    /// card under a heading claiming a week had closed, on a Wednesday.
    /// Mirrors `CoachLogEntry.isRenderable`, which the other reader already had.
    var isRenderable: Bool {
        !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

// MARK: - Race detail · GET /api/v5/race/{slug}
//
// A pushed screen: AppBar plus a plain list, no gradient panel. That is the
// shell exception the README names.

struct V5RaceDetail: Decodable, Equatable {
    /// Needed to POST a result back against this race. Absent from the
    /// screen's original contract — `RaceDetailHostV5` used to carry the
    /// slug on its own and this view never saw it — so a result-entry
    /// section has to read it off the payload the same way every other
    /// field here does.
    let slug: String
    let name: String
    let dateLine: String
    let goal: V5Number?
    let projected: V5Number?
    let gap: V5Number?
    let elevation: [Double]
    let elevationMarks: [V5ElevationMark]
    let elevationFootnotes: [String]
    /// Named sections, not a per-mile chart. "Miles 1-6 · easy into it ·
    /// 8:00-8:10/mi".
    let pacePlan: [V5Row]
    /// 0…1 through the taper, with its own endpoint labels.
    let taperProgress: Double?
    let taperEndpoints: [String]
    let taperCentreLabel: String?
    let gear: [V5Row]
    let coachLine: String?
    /// Whether — and how — this race can take a logged result. Absent
    /// entirely on an upcoming race (no entry makes sense yet).
    let resultEntry: V5RaceResultEntry?
    /// Coach-set goal for a race the runner left without one (2026-08-28).
    /// Non-nil only when the runner's own goal is EMPTY — the moment they
    /// state one, the server goes silent here and the stated goal renders
    /// exactly as before. Absent on older servers (additive decode).
    let coachGoal: V5CoachGoal?
    /// 2026-09-01 · the race-pace brain, serialised (`lib/race/race-outlook.ts`
    /// via `race-outlook-payload.ts`). Four distinct quantities plus the
    /// bridge between them. Additive: absent on older servers, and `var`
    /// with a default so every preview's memberwise init still compiles.
    var outlook: V5RaceOutlook? = nil
}

/// One quantity of the race outlook: a number with its display forms and,
/// where the brain has one, a likely range and a confidence.
struct V5OutlookQuantity: Decodable, Equatable {
    let sec: Int?
    let display: String?
    let pace: String?
    let likelyRange: V5OutlookRange?
    let confidence: Double?
    let basis: String?
}

struct V5OutlookRange: Decodable, Equatable {
    let lo: String?
    let hi: String?
}

struct V5OutlookHr: Decodable, Equatable {
    let expectedRangeBpm: [Int]
    let earlyCeilingBpm: Int?
    let earlyThroughMi: Double?
    let checkpointMi: Double?
    let checkpointAbortBpm: Int?
    let informationalOnly: Bool
}

struct V5OutlookExecution: Decodable, Equatable {
    let targetDisplay: String?
    let pace: String?
    let source: String?
    let reason: String?
    let hr: V5OutlookHr?
}

struct V5OutlookTraining: Decodable, Equatable {
    let kind: String?
    let pace: String?
    let why: String?
}

struct V5OutlookBridgeStep: Decodable, Equatable, Identifiable {
    var id: String { step }
    let step: String
    let label: String
    let value: String
    let confidence: Double?
    let differsFromPrevious: String?
    let changeTrigger: String
}

struct V5OutlookFeasibility: Decodable, Equatable {
    let status: String
}

/// The race-pace brain on the wire. Every field is named for the quantity it
/// is; none of them is "the projection".
struct V5RaceOutlook: Decodable, Equatable {
    let currentProjection: V5OutlookQuantity
    let trainingPrescription: V5OutlookTraining
    let expectedRaceDay: V5OutlookQuantity
    let execution: V5OutlookExecution
    let goalFeasibility: V5OutlookFeasibility
    let bridge: [V5OutlookBridgeStep]
}

/// The coach-set A/B/C framing from `lib/race/coach-goal.ts`.
///
/// `kind == "time"` carries the three tier displays — every one of them
/// MODELLED by construction (the server's own `modelled: true`), so the view
/// draws the amber tilde on each, the same mark rule one puts on every
/// estimated number. `kind == "effort"` is the C-priority / hilly framing:
/// no time at all, by doctrine rather than by data gap, and `line` says so.
struct V5CoachGoal: Decodable, Equatable {
    let kind: String          // "time" | "effort"
    let aDisplay: String?
    let bDisplay: String?
    let cDisplay: String?
    /// Coach-voice basis line ("Coach set from your current fitness. Yours
    /// to edit.") or the effort framing ("No time goal. Run it hard and
    /// enjoy the day.").
    let line: String?

    /// True when this can render the A/B/C row — a `time` framing whose
    /// three displays all made it over the wire.
    var hasTiers: Bool {
        kind == "time" && aDisplay?.isEmpty == false
            && bDisplay?.isEmpty == false && cDisplay?.isEmpty == false
    }
}

/// Job 3 · "no way to enter a race result". Rule-one territory: `status`
/// distinguishes a chip time that has LOCKED (`"confirmed"`) from one that
/// is only an auto-detected/watch-matched guess (`"provisional"`,
/// CLAUDE.md's "Training effort · race to lock in" — explicitly NOT
/// authoritative for fitness) from nothing logged at all (`nil`). `finish`
/// carries `modelled: true` on a provisional read, so `FaffValueText`
/// draws the amber tilde on it automatically — a provisional result cannot
/// reach this screen looking confirmed even by accident.
struct V5RaceResultEntry: Decodable, Equatable {
    let isPast: Bool
    /// `"confirmed" | "provisional"`, or nil when nothing has been logged
    /// (or the race hasn't happened yet). `"confirmed"` gets no entry form
    /// at all — nothing left to ask.
    let status: String?
    /// The currently known finish, if any — prefilled into the entry form
    /// so confirming a provisional time doesn't mean retyping it.
    let finish: V5Number?
}

struct V5ElevationMark: Decodable, Equatable, Hashable, Identifiable {
    let id: String
    let at: Double
    let label: String

    var mark: ElevationMark { ElevationMark(at: at, label: label) }
}

// MARK: - Paces moved · GET /api/v5/paces
//
// One mirrored component, three data variants. Direction and source change the
// tone and the accent, never the structure.
//
//   slower / faster-training  are MODELLED reads. Every zone value carries the
//                             mark, the caption says so, and both are
//                             dismissible.
//   faster-race               is hard evidence. No marks, and one action —
//                             a race result is not noise to dismiss.

enum V5PaceDirection: String, Decodable {
    case slower
    case fasterTraining = "faster-training"
    case fasterRace = "faster-race"

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = V5PaceDirection(rawValue: raw) ?? .slower
    }

    var isModelled: Bool { self != .fasterRace }
}

struct V5Paces: Decodable, Equatable {
    let direction: V5PaceDirection
    let headline: String
    /// States the re-anchor as a fact. Where a diagnosis is not confirmed it
    /// says so directly, and it never asserts a cause the engine did not
    /// detect — no "accumulated fatigue".
    let coachLine: String
    /// One row per zone. Zones do NOT move by the same amount — a three-point
    /// drop moves threshold +24 s/mi, interval +22, rep +19 — so there is no
    /// single headline delta and nothing here will let you print one.
    let zones: [V5PaceZone]
    /// "Modelled from training · not confirmed by a race", on the two modelled
    /// variants only.
    let caption: String?
    /// What the read is built on. Training causes on a modelled read; the
    /// race, finish and effort on a race-confirmed one.
    let evidence: [V5Row]
    let confirm: V5PaceConfirm
}

struct V5PaceZone: Decodable, Equatable, Hashable, Identifiable {
    let id: String
    /// "Threshold" / "Interval" / "Rep".
    let name: String
    let before: V5Number
    let after: V5Number
    /// "+24 s/mi".
    let delta: String?
}

/// The confirm section.
///
/// On a SLOWER read this is NOT accept/deny. Paces come from evidence, and
/// declining them would mean training at paces the runner's fitness does not
/// support. So the question is "did this race count?", with the three tiers the
/// engine already uses.
///
/// HARD CONSTRAINT: answering `compromised` or `unrepresentative` falls back to
/// the NEXT-BEST ANCHOR, never to the old faster paces. Otherwise the question
/// becomes a disguised "make me faster" button. The server owns that fallback;
/// the client only reports the answer.
struct V5PaceConfirm: Decodable, Equatable {
    /// `race_counted | update | dismiss`
    let kind: String
    let question: String?
    let options: [V5Row]
    /// The single action on a race-confirmed read.
    let actionLabel: String?
    /// The race being asked about, for the POST.
    let raceSlug: String?
}

// MARK: - Return to running · GET /api/v5/return
//
// The eight-stage walk-run ladder that follows an injury flare once it clears.
// Max one stage per week, two sessions minimum at each, no walk-only stage —
// stage 1 is run 1 · walk 4 × 5.

struct V5Return: Decodable, Equatable {
    let panel: V5Panel
    /// 1…8.
    let stage: Int
    let stageCount: Int
    /// The current stage's prescription.
    let prescription: String
    /// The advancement gate, in one sentence: silent during, silent the next
    /// morning, or the stage repeats.
    let coachLine: String
    let stages: [V5ReturnStage]
    /// "How did today go". Calf stayed silent advances; something felt off
    /// repeats. Never scolds.
    let checkIn: [V5Row]
    /// Bone stress is clinician-gated; a niggle is not. Present when the
    /// engine will not advance on a self-report alone — a refusal with a
    /// reason, not a disabled button.
    let refusal: String?
}

struct V5ReturnStage: Decodable, Equatable, Hashable, Identifiable {
    let id: String
    let number: Int
    let label: String
    /// `done | today | upcoming`
    let status: String
}

// MARK: - Calls

extension API {

    /// What a v5 GET can come back as. Three outcomes, and the middle one is
    /// the reason this is not just an optional.
    ///
    /// ─────────────────────────────────────────────────────────────────────
    /// RULE THREE, ON THE TRANSPORT
    ///
    /// `GET /api/v5/paces` on a runner whose paces have never moved answers
    /// 404 `{"error":"no_pace_change","reason":"this plan has never recorded a
    /// pace re-anchor"}`. That is not a failure. We read it perfectly and the
    /// answer is that there is nothing to show.
    ///
    /// Collapsing it to nil made the screen say "The pace read did not load.
    /// Your paces are unchanged, we just cannot see them" — which claims we
    /// went blind when we did not. A refusal wearing the outage treatment is
    /// the exact mistake the design names, and it reached the transport layer
    /// because an optional cannot hold the difference.
    enum V5Fetch<T> {
        case ok(T)
        /// The engine answered, and the answer is that this does not apply.
        /// Carries the engine's own sentence.
        case absent(String)
        /// We could not read it. THIS is the outage.
        case failed
    }

    /// One GET, one cache write. The cache write is what lets the next launch
    /// paint real content on frame one instead of a placeholder — the design
    /// requires that loading states reserve their exact final layout height and
    /// that nothing appears, disappears, or reflows.
    ///
    /// Only a 2xx writes. A 4xx/5xx body must never overwrite the last good
    /// payload, or an outage would erase the screen it was meant to preserve.
    private static func v5<T: Decodable>(_ path: String,
                                         cache: AppCache.Key?,
                                         as: T.Type) async throws -> V5Fetch<T> {
        guard let url = URL(string: API.baseURL.absoluteString + path) else { return .failed }
        let (data, http) = try await API.authedGET(url)

        if (200...299).contains(http.statusCode) {
            let decoded = try JSONDecoder().decode(T.self, from: data)
            if let cache { AppCache.writeRaw(cache, data: data) }
            return .ok(decoded)
        }

        // A 4xx carrying the engine's own reason is an answer, not a failure.
        // A 5xx is not: the engine did not decide anything, it fell over.
        //
        // `refusal ?? reason`, not `reason` alone. The write path has read
        // both keys since the clinician gate landed; this one read only
        // `reason`, so a GET that declined with `refusal` — the key the gate
        // uses, and the key any route that later grows a gate will reach for —
        // fell through to `.failed` and wore the data-outage screen. That is
        // the production shape rule three exists to forbid, sitting one key
        // away from firing. The two paths read the same body now.
        if (400...499).contains(http.statusCode),
           let body = try? JSONDecoder().decode(V5Refusal.self, from: data),
           let reason = body.refusal ?? body.reason, !reason.isEmpty {
            return .absent(reason)
        }
        return .failed
    }

    /// The shape every v5 route uses when it declines. `refusal` is the
    /// clinician gate's key; `reason` is everyone else's.
    private struct V5Refusal: Decodable {
        let error: String?
        let reason: String?
        let refusal: String?
    }

    static func fetchV5Today(date: String? = nil) async throws -> V5Fetch<V5Today> {
        // A dated read is history, not today, so it must not overwrite today's
        // cache entry.
        try await v5("/api/v5/today" + (date.map { "?date=\($0)" } ?? ""),
                     cache: date == nil ? .v5Today : nil, as: V5Today.self)
    }

    static func fetchV5Block() async throws -> V5Fetch<V5Block> {
        try await v5("/api/v5/block", cache: .v5Block, as: V5Block.self)
    }

    static func fetchV5Races() async throws -> V5Fetch<V5Races> {
        try await v5("/api/v5/races", cache: .v5Races, as: V5Races.self)
    }

    static func fetchV5RaceDetail(slug: String) async throws -> V5Fetch<V5RaceDetail> {
        try await v5("/api/v5/race/\(slug)", cache: nil, as: V5RaceDetail.self)
    }

    static func fetchV5Paces() async throws -> V5Fetch<V5Paces> {
        try await v5("/api/v5/paces", cache: .v5Paces, as: V5Paces.self)
    }

    static func fetchV5Return() async throws -> V5Fetch<V5Return> {
        try await v5("/api/v5/return", cache: .v5Return, as: V5Return.self)
    }

    /// Run detail, through the v5 refusal shape.
    ///
    /// ─────────────────────────────────────────────────────────────────────
    /// A RUN THAT IS NOT YOURS IS AN ANSWER
    ///
    /// `API.fetchRunDetail` returns `RunDetail?`, so "that run is not in your
    /// log any more" and a dropped connection arrive at the screen as the
    /// same nil — and `RunDetailHostV5` drew both as a `Skeleton` that never
    /// resolves. That is worse than the outage treatment rule three forbids:
    /// it is the COLD-START treatment, which claims we are still looking.
    /// `SurfaceStoreV5` keeps `isColdStart`, `isOutage` and `absentReason`
    /// apart for exactly this reason; this route now speaks the same three.
    ///
    /// `/api/runs/[id]` carries a `reason` on both of its 404s, so a decline
    /// comes back as `.absent` with the engine's own sentence.
    static func fetchV5RunDetail(id: String) async throws -> V5Fetch<RunDetail> {
        // Leading slash: `v5` concatenates onto `baseURL.absoluteString`
        // rather than appending a path component, so every path it is given
        // carries its own separator.
        try await v5("/api/runs/\(id)", cache: nil, as: RunDetail.self)
    }

    // ── writes ──

    /// The outcome of a plan change. Propose and confirm share it, because the
    /// refusal is as real an answer as the proposal.
    enum V5PlanChangeOutcome {
        case proposed(V5PlanChangeProposal)
        case applied(V5PlanChangeProposal)
        /// We read it and the answer is no.
        case refused(V5PlanChangeRefusal)
        /// Something broke, or the plan moved underneath. Not the same thing.
        case failed(V5PlanChangeRefusal)
    }

    /// Propose, or confirm. Nothing is written without `confirm` AND the token
    /// from the propose that the runner actually read.
    static func planChange(scenario: String,
                           params: [String: Any] = [:],
                           confirm: Bool = false,
                           token: String? = nil) async throws -> V5PlanChangeOutcome {
        var body: [String: Any] = params
        body["scenario"] = scenario
        if confirm {
            body["confirm"] = true
            if let token { body["token"] = token }
        }

        var req = URLRequest(url: API.baseURL.appendingPathComponent("api/plan/change"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, http) = try await API.authedSend(req)
        if (200...299).contains(http.statusCode) {
            let p = try JSONDecoder().decode(V5PlanChangeProposal.self, from: data)
            return p.applied ? .applied(p) : .proposed(p)
        }
        let r = try JSONDecoder().decode(V5PlanChangeRefusal.self, from: data)
        return r.isRefusal ? .refused(r) : .failed(r)
    }

    /// "Did this race count?" — the runner's own answer, which is the only
    /// source for it. Heat, illness, ran-it-as-a-workout and paced-a-friend are
    /// things the runner knows and the engine does not.
    ///
    /// `tier` is `representative | compromised | unrepresentative`. The server
    /// owns the fallback to the next-best anchor; there is deliberately no
    /// parameter here for "go back to my old paces".
    @discardableResult
    static func confirmRaceAuthority(slug: String, tier: String, note: String? = nil) async throws -> V5Write {
        var body: [String: Any] = ["slug": slug, "tier": tier]
        if let note { body["note"] = note }
        return try await v5Write("api/v5/race-authority", body: body)
    }

    /// Sets the plan's pending pace-drop event aside without a race behind
    /// it — the "Got it" / "Just a good patch" / "Update my paces" (faster
    /// -race) confirms, none of which are a race-representativeness answer.
    /// Without this, `GET /api/v5/paces` (which now 404s only once the event
    /// is acknowledged) would keep answering the same pending question
    /// forever, and Today's paces-moved entry row would never clear either.
    @discardableResult
    static func acknowledgePaceDrop() async throws -> V5Write {
        try await v5Write("api/v5/paces", body: ["action": "acknowledge"])
    }

    /// What a v5 write came back as.
    ///
    /// ─────────────────────────────────────────────────────────────────────
    /// A WRITE CAN BE REFUSED TOO
    ///
    /// These used to return a bare `Bool` from the status code and never read
    /// the body — so a server that declined with a reason ("Bone stress is
    /// clinician-gated", "That race is not on your schedule any more") had
    /// that reason thrown away at the transport, and the screen could only
    /// show a generic nothing-happened. The read path learned this lesson
    /// already; the write path had not.
    enum V5Write {
        case ok
        /// The engine declined, and said why. Renders as `Alert`.
        case refused(String)
        /// We could not complete it. Renders as `ErrorNote`.
        case failed
    }

    private static func v5Write(_ path: String, body: [String: Any]) async throws -> V5Write {
        var req = URLRequest(url: API.baseURL.appendingPathComponent(path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, http) = try await API.authedSend(req)
        if (200...299).contains(http.statusCode) { return .ok }
        if (400...499).contains(http.statusCode),
           let r = try? JSONDecoder().decode(V5Refusal.self, from: data) {
            // `refusal` is what the clinician gate uses; `reason` is what
            // everything else uses. Either is an answer.
            if let text = r.refusal ?? r.reason, !text.isEmpty { return .refused(text) }
        }
        return .failed
    }

    /// The ladder's own check-in. `outcome` is `silent | something_off`.
    @discardableResult
    static func returnCheckIn(outcome: String) async throws -> V5Write {
        try await v5Write("api/v5/return/checkin", body: ["outcome": outcome])
    }

    /// Answer the Races decision card. `action` is one of the card's own
    /// answer actions; the server decides what each one means.
    @discardableResult
    static func answerGoalCard(action: String, targetSec: Double? = nil, raceSlug: String? = nil) async throws -> V5Write {
        var body: [String: Any] = ["action": action]
        if let targetSec { body["targetSec"] = targetSec }
        if let raceSlug { body["raceSlug"] = raceSlug }
        return try await v5Write("api/v5/goal-answer", body: body)
    }

    /// `POST /api/race/result`, with the engine's own answer kept.
    ///
    /// ─────────────────────────────────────────────────────────────────────
    /// THE SAME LESSON `V5Write` ALREADY LEARNED, ONE ROUTE LATE
    ///
    /// `API.postRaceResult` collapses this call into a `Bool` at the
    /// transport, so a 404 ("that race is not on your schedule any more")
    /// and a dropped connection arrive at the screen as the same `false` and
    /// can only be drawn as the outage treatment. A 4xx is an ANSWER.
    ///
    /// This route does not speak the v5 refusal shape — its bodies are
    /// `{ error: "race not found" }`, which is machine text and must never
    /// be printed at a runner. So a reason is used when the route gives one,
    /// a 404 maps to the app's own existing sentence for a race that is
    /// gone, and everything else stays `.failed`. Nothing is invented: the
    /// phone never writes a reason the engine did not have.
    static func postRaceResultOutcome(slug: String, finishDisplay: String, avgHrBpm: Int? = nil) async -> V5Write {
        var req = URLRequest(url: API.baseURL.appendingPathComponent("api/race/result"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = ["slug": slug, "finishDisplay": finishDisplay]
        if let avgHrBpm { body["avgHrBpm"] = avgHrBpm }
        guard let payload = try? JSONSerialization.data(withJSONObject: body) else { return .failed }
        req.httpBody = payload
        guard let response = try? await API.authedSend(req) else { return .failed }
        let data = response.0
        let http = response.1
        if (200...299).contains(http.statusCode) { return .ok }
        guard (400...499).contains(http.statusCode) else { return .failed }
        if let r = try? JSONDecoder().decode(V5Refusal.self, from: data),
           let text = r.refusal ?? r.reason, !text.isEmpty {
            return .refused(text)
        }
        if http.statusCode == 404 {
            return .refused("That race is not on your schedule any more.")
        }
        return .failed
    }
}

// MARK: - Lenient decoding
//
// A screen must not go blank because one key was absent. Every list defaults
// to empty and every flag to its safe side, so a partial payload degrades to
// the state the design already draws — a `Silence`, an `Alert`, or an
// `unreadable` value — rather than to a decode failure and a black screen.
//
// The one asymmetry is deliberate: `V5Number.modelled` defaults to TRUE (see
// its own decoder). Everywhere else absence is benign; there it is the sin.

private extension KeyedDecodingContainer {
    func list<T: Decodable>(_ key: Key) -> [T] {
        ((try? decodeIfPresent([T].self, forKey: key)) ?? []) ?? []
    }
    func opt<T: Decodable>(_ key: Key) -> T? {
        (try? decodeIfPresent(T.self, forKey: key)) ?? nil
    }
    func flag(_ key: Key, default d: Bool = false) -> Bool {
        ((try? decodeIfPresent(Bool.self, forKey: key)) ?? d) ?? d
    }
    func num(_ key: Key, default d: Double = 0) -> Double {
        ((try? decodeIfPresent(Double.self, forKey: key)) ?? d) ?? d
    }
    func int(_ key: Key, default d: Int = 0) -> Int {
        ((try? decodeIfPresent(Int.self, forKey: key)) ?? d) ?? d
    }
    func text(_ key: Key, default d: String = "") -> String {
        ((try? decodeIfPresent(String.self, forKey: key)) ?? d) ?? d
    }
}

extension V5Today {
    enum K: String, CodingKey {
        case dateISO, state, panel, weekStrip, groups, why, thesis, whereYouAre, beforeYouGo
        case askedVsRan, verdict, zoneShares, zoneTargets, zoneTarget, elevation, onTheBelt
        case routePolyline, elevGainFt, shoeOptions
        case routeSplits, routePhases, hrZones, paceBand, elevGainMeasured
        case shoesWorn, whatThisDidToTheWeek, runId, postRun
        case changed, injury, weekOff, offSeason, notOnPhoneYet
        case paceNote, blockNote, sick
        case facts, win, conditionsNote, coachTip
        case hrAvg, hrMax, cadenceAvg, tempF, workoutType
        case hrAvgWork, cadenceAvgWork, paceWork
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        dateISO = c.text(.dateISO)
        state = c.opt(.state) ?? .beforeRun
        panel = try c.decode(V5Panel.self, forKey: .panel)
        weekStrip = c.list(.weekStrip)
        groups = c.list(.groups)
        why = c.opt(.why)
        thesis = try? c.decodeIfPresent(V5Thesis.self, forKey: .thesis)
        whereYouAre = c.list(.whereYouAre)
        beforeYouGo = c.list(.beforeYouGo)
        askedVsRan = c.list(.askedVsRan)
        verdict = c.opt(.verdict)
        facts = c.list(.facts)
        win = c.opt(.win)
        conditionsNote = c.opt(.conditionsNote)
        coachTip = c.opt(.coachTip)
        hrAvg = c.opt(.hrAvg)
        hrMax = c.opt(.hrMax)
        cadenceAvg = c.opt(.cadenceAvg)
        tempF = c.opt(.tempF)
        workoutType = c.opt(.workoutType)
        hrAvgWork = c.opt(.hrAvgWork)
        cadenceAvgWork = c.opt(.cadenceAvgWork)
        paceWork = c.opt(.paceWork)
        zoneShares = c.opt(.zoneShares)
        zoneTargets = c.opt(.zoneTargets)
        zoneTarget = c.opt(.zoneTarget)
        elevation = c.opt(.elevation)
        routePolyline = c.opt(.routePolyline)
        elevGainFt = c.opt(.elevGainFt)
        routeSplits = c.list(.routeSplits)
        routePhases = c.list(.routePhases)
        hrZones = c.list(.hrZones)
        paceBand = c.opt(.paceBand)
        elevGainMeasured = c.opt(.elevGainMeasured) ?? false
        shoeOptions = c.list(.shoeOptions)
        onTheBelt = c.opt(.onTheBelt)
        shoesWorn = c.opt(.shoesWorn)
        whatThisDidToTheWeek = c.list(.whatThisDidToTheWeek)
        postRun = try? c.decodeIfPresent(PostRunV5.self, forKey: .postRun)
        runId = c.opt(.runId)
        changed = c.opt(.changed)
        injury = c.opt(.injury)
        weekOff = c.opt(.weekOff)
        offSeason = c.opt(.offSeason)
        notOnPhoneYet = c.opt(.notOnPhoneYet)
        paceNote = c.opt(.paceNote)
        blockNote = c.opt(.blockNote)
        sick = c.opt(.sick)
    }
}

extension V5Panel {
    enum K: String, CodingKey {
        case dayState, quiet, place, dateLine, weekLine, kicker, type, dose, stats
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        dayState = c.text(.dayState, default: "easy")
        quiet = c.flag(.quiet)
        place = c.text(.place)
        dateLine = c.text(.dateLine)
        weekLine = c.opt(.weekLine)
        kicker = c.opt(.kicker)
        type = c.text(.type)
        dose = c.opt(.dose)
        stats = c.list(.stats)
    }
}

extension V5Block {
    enum K: String, CodingKey { case panel, phases, coachLine, thesis, soFar, weeks, library, scenarios }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        panel = try c.decode(V5Panel.self, forKey: .panel)
        phases = c.list(.phases)
        coachLine = c.opt(.coachLine)
        thesis = try? c.decodeIfPresent(V5Thesis.self, forKey: .thesis)
        soFar = c.list(.soFar)
        weeks = c.list(.weeks)
        library = c.list(.library)
        scenarios = c.list(.scenarios)
    }
}

extension V5Races {
    enum K: String, CodingKey {
        case panel, card, schedule, trend, trendHeadline, trendDelta, trendFootnotes, evidence, coachLog
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        panel = try c.decode(V5Panel.self, forKey: .panel)
        card = c.opt(.card)
        schedule = c.list(.schedule)
        trend = c.list(.trend)
        trendHeadline = c.opt(.trendHeadline)
        trendDelta = c.opt(.trendDelta)
        trendFootnotes = c.list(.trendFootnotes)
        evidence = c.list(.evidence)
        coachLog = c.list(.coachLog)
    }
}

extension V5DecisionCard {
    enum K: String, CodingKey {
        case shape, verdict, trigger, question, safeTarget, stretchTarget, cautions, answers
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        shape = c.opt(.shape) ?? .fact
        verdict = c.opt(.verdict) ?? .unreadable
        trigger = c.opt(.trigger)
        question = c.text(.question)
        safeTarget = c.opt(.safeTarget)
        stretchTarget = c.opt(.stretchTarget)
        // Up to three. The engine filters each one on its own context; the
        // client never adds a fourth and never re-orders them.
        cautions = Array(c.list(.cautions).prefix(3))
        answers = c.list(.answers)
    }
}

extension V5RaceDetail {
    enum K: String, CodingKey {
        case slug, name, dateLine, goal, projected, gap, elevation, elevationMarks
        case elevationFootnotes, pacePlan, taperProgress, taperEndpoints
        case taperCentreLabel, gear, coachLine, resultEntry, coachGoal
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        // The caller already knows the slug — it is the route parameter — so
        // an older server that does not echo it is not a decode failure.
        slug = c.text(.slug)
        name = c.text(.name)
        dateLine = c.text(.dateLine)
        goal = c.opt(.goal); projected = c.opt(.projected); gap = c.opt(.gap)
        elevation = c.list(.elevation)
        elevationMarks = c.list(.elevationMarks)
        elevationFootnotes = c.list(.elevationFootnotes)
        pacePlan = c.list(.pacePlan)
        taperProgress = c.opt(.taperProgress)
        taperEndpoints = c.list(.taperEndpoints)
        taperCentreLabel = c.opt(.taperCentreLabel)
        gear = c.list(.gear)
        coachLine = c.opt(.coachLine)
        resultEntry = c.opt(.resultEntry)
        coachGoal = c.opt(.coachGoal)
    }
}

extension V5Paces {
    enum K: String, CodingKey { case direction, headline, coachLine, zones, caption, evidence, confirm }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        direction = c.opt(.direction) ?? .slower
        headline = c.text(.headline)
        coachLine = c.text(.coachLine)
        zones = c.list(.zones)
        caption = c.opt(.caption)
        evidence = c.list(.evidence)
        confirm = try c.decode(V5PaceConfirm.self, forKey: .confirm)
    }
}

extension V5PaceConfirm {
    enum K: String, CodingKey { case kind, question, options, actionLabel, raceSlug }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        kind = c.text(.kind, default: "dismiss")
        question = c.opt(.question)
        options = c.list(.options)
        actionLabel = c.opt(.actionLabel)
        raceSlug = c.opt(.raceSlug)
    }
}

extension V5Return {
    enum K: String, CodingKey {
        case panel, stage, stageCount, prescription, coachLine, stages, checkIn, refusal
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        panel = try c.decode(V5Panel.self, forKey: .panel)
        stage = c.int(.stage, default: 1)
        stageCount = c.int(.stageCount, default: 8)
        prescription = c.text(.prescription)
        coachLine = c.text(.coachLine)
        stages = c.list(.stages)
        checkIn = c.list(.checkIn)
        refusal = c.opt(.refusal)
    }
}

extension V5Convergence {
    enum K: String, CodingKey { case updatedAt, wasType, coachLine, converged, movedTo }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        updatedAt = c.text(.updatedAt)
        wasType = c.opt(.wasType)
        coachLine = c.text(.coachLine)
        converged = c.list(.converged)
        movedTo = c.opt(.movedTo)
    }

    /// RULE TWO. Three independent domains, or this is not a story about a
    /// changed session and no screen may tell one.
    var namesAConvergence: Bool { converged.count >= ConvergenceList.minimumDomains }
}

extension V5PlanChangeProposal {
    enum K: String, CodingKey {
        case ok, applied, scenario, verb, headline, tradeOff, caveats, token, planId, effect, changed
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        ok = c.flag(.ok, default: true)
        applied = c.flag(.applied)
        scenario = c.text(.scenario)
        verb = c.text(.verb, default: "Confirm")
        headline = c.text(.headline)
        tradeOff = c.text(.tradeOff)
        caveats = c.list(.caveats)
        token = c.text(.token)
        planId = c.text(.planId)
        effect = (try? c.decode(V5PlanEffect.self, forKey: .effect))
            ?? V5PlanEffect(weeks: [], milesDelta: 0, firstAffectedISO: nil,
                            lastAffectedISO: nil, rebuilds: false)
        changed = (try? c.decode(V5ChangedEntry.self, forKey: .changed))
            ?? V5ChangedEntry(label: "", sub: "")
    }
}

extension V5PlanEffect {
    enum K: String, CodingKey {
        case weeks, milesDelta, firstAffectedISO, lastAffectedISO, rebuilds
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        weeks = c.list(.weeks)
        milesDelta = c.num(.milesDelta)
        firstAffectedISO = c.opt(.firstAffectedISO)
        lastAffectedISO = c.opt(.lastAffectedISO)
        rebuilds = c.flag(.rebuilds)
    }
}

extension V5ChangedEntry {
    enum K: String, CodingKey { case label, sub }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        label = c.text(.label); sub = c.text(.sub)
    }
}

extension V5PlanChangeRefusal {
    enum K: String, CodingKey { case ok, error, reason, violations }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        ok = c.flag(.ok)
        error = c.text(.error, default: "rebuild_failed")
        reason = c.text(.reason)
        violations = c.opt(.violations)
    }
}
