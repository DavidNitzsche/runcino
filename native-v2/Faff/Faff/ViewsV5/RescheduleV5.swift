//
//  RescheduleV5.swift
//  faff.run iPhone · "I cannot run this day."   RS-2 · RS-4 · RS-6 · RS-7 · RS-8
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHAT THIS SCREEN IS
//
//  The runner says he cannot do a prescribed session on its day. The coach
//  shows him the ways to keep its training value, ranked, each one saying what
//  it costs. Nothing is written until he picks one and confirms.
//
//  Backend: `GET/POST /api/plan/reschedule` · `web-v2/lib/plan/reschedule.ts`.
//  Contract: `docs/RESCHEDULING_CONTRACT.md` and MASTER_CORE_PRODUCT_PROGRAM
//  RS-1..RS-8.
//
//  ─────────────────────────────────────────────────────────────────────────
//  RS-2 · AVAILABILITY IS ASKED FOR, NEVER ASSUMED
//
//  The first stage is a day picker across the search window, and it opens with
//  NOTHING selected. That is deliberate and is the contract's own instruction:
//  "Never assume a preference when availability is unknown — ask, or show the
//  viable choices." He may skip it, and then the server is told UNKNOWN rather
//  than "no days are blocked", and every option carries the line saying the
//  list will narrow once he marks days. An empty selection is a THIRD state,
//  not a synonym for "everything is fine".
//
//  RS-7 · PLAIN LANGUAGE, NO LOAD TERMINOLOGY
//
//  The entry points read "Move this workout", "I cannot do this day" and "Find
//  the best day". The words acute, chronic, ACWR, dose, ramp and stimulus do
//  not appear anywhere a runner reads. `_reschedule_ui_voice` in the backend
//  suite gates the SERVER's sentences; this file's own strings are held to the
//  same bar by review, and `scripts/check-coach-voice.sh` covers em dashes.
//
//  RS-4 · WHAT EVERY OPTION SHOWS
//
//  New date · what moved · what did not · the long run's distance and purpose ·
//  separation from the hard sessions around it · the rolling-load change · the
//  effect on the next long run, race, cutback and taper · the training value
//  preserved · the tradeoffs · and why the coach ranks it there. All of it
//  comes from the server, verbatim. This view composes, it never re-derives —
//  a second opinion computed on the phone would be a second answer to a
//  question the engine already owns.
//
//  RS-8 · AFTER APPROVING
//
//  What moved, what is unchanged, why, any instruction for the rearranged
//  days, and an Undo that stays reachable.
//
//  ─────────────────────────────────────────────────────────────────────────
//  RULE 17 · THE RUNNER READS A SENTENCE ONCE
//
//  The split refusal, the purpose line and the "this is a calendar change, not
//  a training change" line are properties of the WORKOUT, so they are drawn
//  once at the top and never repeated per option. Per-option detail lives
//  behind the option's own disclosure.
//

import SwiftUI

// ═════════════════════════════════════════════════════════════════════════
// MARK: - Wire
// ═════════════════════════════════════════════════════════════════════════

struct V5RescheduleTarget: Decodable, Equatable {
    let planWorkoutId: String
    let dateISO: String
    let label: String
    let type: String
    let distanceMi: Double
    let purpose: String
    let family: String
}

struct V5RescheduleSeparation: Decodable, Equatable, Identifiable {
    let earlierISO: String
    let earlierLabel: String
    let laterISO: String
    let laterLabel: String
    let interveningDays: Int
    let requiredDays: Int
    let deficitDays: Int
    let nominalHours: Int
    var id: String { "\(earlierISO)-\(laterISO)" }
}

struct V5RescheduleWeekLoad: Decodable, Equatable, Identifiable {
    let weekId: String
    let startISO: String
    let weekIdx: Int
    let beforeMi: Double
    let afterMi: Double
    let isCutback: Bool
    let isTaper: Bool
    let racePriority: String?
    var id: String { weekId }
}

struct V5RescheduleLoad: Decodable, Equatable {
    let peakRolling7DeltaMi: Double
    let peakRolling7OnISO: String?
    let rolling7BeforeMi: Double
    let rolling7AfterMi: Double
    let weeks: [V5RescheduleWeekLoad]
}

struct V5RescheduleDownstream: Decodable, Equatable {
    struct NextLong: Decodable, Equatable { let dateISO: String; let distanceMi: Double; let changed: Bool }
    struct NextRace: Decodable, Equatable {
        let dateISO: String; let name: String; let priority: String?
        let daysAfterMovedSession: Int
    }
    struct NextCutback: Decodable, Equatable { let startISO: String; let weekIdx: Int; let touched: Bool }
    struct Taper: Decodable, Equatable { let startsISO: String?; let touched: Bool }
    let nextLongRun: NextLong?
    let nextRace: NextRace?
    let nextCutbackWeek: NextCutback?
    let taper: Taper
}

struct V5RescheduleIdentity: Decodable, Equatable {
    let kind: String                       // SAME_INSTANCE | REVISED_VERSION
    let reductionReason: String?
}

struct V5RescheduleSession: Decodable, Equatable {
    /// With the distance in it, for a sentence.
    let label: String
    /// WITHOUT the distance. Used wherever a distance is already on the line,
    /// which is why the detail header stopped reading "15 mi · 15 mi long run".
    let name: String
    let type: String
    let distanceMi: Double
    let originalDistanceMi: Double
    let purpose: String
}

struct V5RescheduleOption: Decodable, Equatable, Identifiable {
    let id: String
    let rank: Int
    let moveKind: String
    let newDateISO: String
    let newDow: Int
    let session: V5RescheduleSession
    let identity: V5RescheduleIdentity
    let stimulusPreservation: String       // FULL | PARTIAL | SUBSTITUTED | LOST
    let trainingValuePreserved: String
    let moved: [String]
    let unchanged: [String]
    let separation: [V5RescheduleSeparation]
    let load: V5RescheduleLoad
    let downstream: V5RescheduleDownstream
    let tradeoffs: [String]
    let whyRankedHere: String
    let isCompromise: Bool
}

struct V5RescheduleRefusal: Decodable, Equatable, Identifiable {
    let dateISO: String
    let reason: String
    let cause: String
    var id: String { "\(dateISO)-\(cause)" }
}

struct V5RescheduleSplit: Decodable, Equatable { let eligible: Bool; let reason: String }

struct V5Reschedule: Decodable, Equatable {
    let kind: String
    let origin: String
    let planId: String
    let target: V5RescheduleTarget
    let availabilityUnknown: Bool
    let considered: [String]
    let refusals: [V5RescheduleRefusal]
    let options: [V5RescheduleOption]
    let impossibility: String?
    let splitVerdict: V5RescheduleSplit?
    let token: String
}

struct V5RescheduleSummary: Decodable, Equatable {
    let headline: String
    let whatMoved: [String]
    let whatIsUnchanged: [String]
    let why: String
    let instructions: [String]
    let decisionId: String
}

struct V5RescheduleApplied: Decodable, Equatable {
    struct Decision: Decodable, Equatable { let decisionId: String; let newDateISO: String }
    let decision: Decision
    let summary: V5RescheduleSummary
}

// ═════════════════════════════════════════════════════════════════════════
// MARK: - Calls
// ═════════════════════════════════════════════════════════════════════════

/// `V5Refusal` in APIV5.swift is private to that file, so this is its twin
/// rather than a widening of it: the engine's own sentence, under whichever of
/// the two keys the route family happens to use.
private struct RescheduleRefusalBody: Decodable {
    let error: String?
    let reason: String?
    let refusal: String?
    var text: String? {
        for t in [refusal, reason] where !(t ?? "").isEmpty { return t }
        return nil
    }
}

extension API {

    /// The three-outcome shape the rest of v5 uses: an answer, a refusal in the
    /// engine's own words, or an outage. Collapsing a refusal into an outage is
    /// the mistake `V5Fetch` exists to stop, and it matters more here than
    /// anywhere: "you have already run that day" and "we could not reach the
    /// coach" are opposite facts.
    enum V5RescheduleFetch {
        case ok(V5Reschedule)
        case absent(String)
        case failed
    }

    enum V5RescheduleWrite {
        case applied(V5RescheduleApplied)
        case refused(String)
        case failed
    }

    /// Undo answers a DIFFERENT shape from apply, and reusing one decoder for
    /// both is a bug that only rendering could find: the request succeeded, the
    /// decode failed, and the screen said "That did not go through. Your plan
    /// is as the change left it." over a plan that HAD been put back. Seen on
    /// device 2026-09-02, which is the whole of CLAUDE.md Rule 13.
    enum V5RescheduleUndo {
        case undone
        case refused(String)
        case failed
    }

    private struct RescheduleUndoBody: Decodable {
        let ok: Bool?
        let decisionId: String?
        let restored: Int?
    }

    /// RECOMMEND. Reads only. Passing neither list means UNKNOWN, and the
    /// server says so back rather than assuming the rest of the week is free.
    static func fetchReschedule(dateISO: String,
                                unavailable: [String] = [],
                                available: [String] = [],
                                adjacentWeek: Bool = false) async throws -> V5RescheduleFetch {
        var comps = URLComponents(string: API.baseURL.absoluteString + "/api/plan/reschedule")
        var q = [URLQueryItem(name: "date", value: dateISO)]
        if !unavailable.isEmpty { q.append(URLQueryItem(name: "unavailable", value: unavailable.joined(separator: ","))) }
        if !available.isEmpty { q.append(URLQueryItem(name: "available", value: available.joined(separator: ","))) }
        if adjacentWeek { q.append(URLQueryItem(name: "adjacent_week", value: "1")) }
        comps?.queryItems = q
        guard let url = comps?.url else { return .failed }

        let (data, http) = try await API.authedGET(url)
        if (200...299).contains(http.statusCode) {
            return .ok(try JSONDecoder().decode(V5Reschedule.self, from: data))
        }
        if (400...499).contains(http.statusCode),
           let r = try? JSONDecoder().decode(RescheduleRefusalBody.self, from: data),
           let text = r.text {
            return .absent(text)
        }
        return .failed
    }

    /// APPLY. The only write, and it carries the token the runner actually
    /// read. Without it the server refuses, because a change applied to a plan
    /// he never saw is indistinguishable from a bug.
    static func applyReschedule(dateISO: String,
                                optionId: String,
                                token: String,
                                unavailable: [String] = [],
                                available: [String] = []) async throws -> V5RescheduleWrite {
        var body: [String: Any] = ["date": dateISO, "option_id": optionId, "token": token]
        if !unavailable.isEmpty { body["unavailable"] = unavailable }
        if !available.isEmpty { body["available"] = available }
        return try await rescheduleWrite(body)
    }

    /// UNDO.  RS-6.
    static func undoReschedule(decisionId: String) async throws -> V5RescheduleUndo {
        var req = URLRequest(url: API.baseURL.appendingPathComponent("api/plan/reschedule"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(
            withJSONObject: ["action": "undo", "decision_id": decisionId])
        let (data, http) = try await API.authedSend(req)
        if (200...299).contains(http.statusCode) {
            let body = try? JSONDecoder().decode(RescheduleUndoBody.self, from: data)
            return (body?.ok ?? false) ? .undone : .failed
        }
        if let r = try? JSONDecoder().decode(RescheduleRefusalBody.self, from: data),
           let text = r.text {
            return .refused(text)
        }
        return .failed
    }

    private static func rescheduleWrite(_ body: [String: Any]) async throws -> V5RescheduleWrite {
        var req = URLRequest(url: API.baseURL.appendingPathComponent("api/plan/reschedule"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, http) = try await API.authedSend(req)
        if (200...299).contains(http.statusCode) {
            if let applied = try? JSONDecoder().decode(V5RescheduleApplied.self, from: data) {
                return .applied(applied)
            }
            return .failed
        }
        if (400...599).contains(http.statusCode),
           let r = try? JSONDecoder().decode(RescheduleRefusalBody.self, from: data),
           let text = r.text {
            return .refused(text)
        }
        return .failed
    }
}

// ═════════════════════════════════════════════════════════════════════════
// MARK: - Entry point   RS-7
// ═════════════════════════════════════════════════════════════════════════

/// The row that opens all of this, in plain language.
///
/// Three phrasings, because the same action arrives from three places: the
/// workout itself ("I cannot do this day"), the plan surface ("Move a
/// workout"), and a runner who knows the day is out but not where it should go
/// ("Find the best day"). One destination, one decision, three doors.
struct RescheduleEntryRowV5: View {
    enum Phrasing { case cannotDoThisDay, moveThisWorkout, findTheBestDay }

    let dateISO: String
    var phrasing: Phrasing = .cannotDoThisDay
    var sessionLabel: String? = nil
    @State private var open = false

    private var label: String {
        switch phrasing {
        case .cannotDoThisDay: return "I cannot do this day"
        case .moveThisWorkout: return "Move this workout"
        case .findTheBestDay:  return "Find the best day"
        }
    }

    private var sub: String {
        switch phrasing {
        case .cannotDoThisDay:
            return sessionLabel.map { "See how to keep the \($0)." } ?? "See how to keep its training value."
        case .moveThisWorkout: return "Pick a day that costs the rest of the week least."
        case .findTheBestDay:  return "The coach ranks the days that work."
        }
    }

    var body: some View {
        ListRow(label: label, sub: sub, onTap: { open = true })
            .overlay {
                V5SheetHost(isPresented: $open, tall: true) {
                    RescheduleSheetV5(dateISO: dateISO, onClose: { open = false })
                }
            }
    }
}

// ═════════════════════════════════════════════════════════════════════════
// MARK: - The sheet
// ═════════════════════════════════════════════════════════════════════════

struct RescheduleSheetV5: View {
    let dateISO: String
    var onClose: () -> Void = {}

    /// The stages, in the order the decision is actually made.
    private enum Stage: Equatable {
        /// RS-2 · mark the days that work. Opens with nothing selected.
        case availability
        /// RS-4 · the ranked options.
        case options
        /// One option, in full.
        case detail(String)
        /// RS-8 · what happened, and Undo.
        case done(V5RescheduleSummary)
        /// The engine answered and the answer is no.
        case absent(String)
        /// We could not reach the coach. Not the same thing.
        case outage
    }

    @State private var stage: Stage = .availability
    @State private var model: V5Reschedule?
    @State private var busy = false
    @State private var refusal: String?
    @State private var undone = false

    /// RS-2 · the days he has marked. EMPTY IS NOT "all clear" — it is
    /// "he has not said", and that is what gets sent.
    @State private var cannotRun: Set<String> = []
    /// The window we offer to mark. Filled from the server's own `considered`
    /// list on the first read, so the phone never invents a search window.
    @State private var window: [String] = []

    /// One string per stage, so `.id` resets the scroll when the stage changes.
    private var stageKey: String {
        switch stage {
        case .availability: return "availability"
        case .options: return "options"
        case .detail(let id): return "detail-\(id)"
        case .done(let s): return "done-\(s.decisionId)"
        case .absent: return "absent"
        case .outage: return "outage"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: V5.S.tilePad) {
            header
            switch stage {
            case .availability: availabilityBody
            case .options:      optionsBody
            case .detail(let id): detailBody(id)
            case .done(let s):  doneBody(s)
            case .absent(let text): absentBody(text)
            case .outage:       outageBody
            }
        }
        .id(stageKey)
        .task { if model == nil { await load() } }
    }

    // ── header ──────────────────────────────────────────────────────────

    private var header: some View {
        VStack(alignment: .leading, spacing: V5.S.s4) {
            Text("Move this workout")
                .font(.faffDisplay(20))
                .textCase(.uppercase)
                .tracking(20 * 0.02)
                .foregroundStyle(V5.textPrimary)
            Text(headerSub)
                .font(.faffText(TypeScaleV5.label13))
                .foregroundStyle(V5.textQuiet)
        }
        .padding(.horizontal, V5.S.s4)
    }

    /// The subtitle only ever claims a read that has happened. Following the
    /// same correction `BlockV5`'s sheet already carries: a line saying the
    /// coach has read the block, printed above a picker that has sent nothing,
    /// is a fluent sentence about something that did not occur.
    private var headerSub: String {
        switch stage {
        case .availability:
            return "Tell the coach which days are out. Nothing changes yet."
        case .options, .detail:
            guard let m = model else { return "Reading the block." }
            return m.availabilityUnknown
                ? "Ranked on the block as it stands. Mark the days that are out to narrow it."
                : "Ranked on the days you can run."
        case .done:    return "Applied. You can put it back."
        case .absent:  return "The coach has an answer, and it is no."
        case .outage:  return "The coach could not be reached."
        }
    }

    // ── RS-2 · availability ─────────────────────────────────────────────

    private var availabilityBody: some View {
        VStack(alignment: .leading, spacing: V5.S.s16) {
            if let m = model {
                targetPlate(m)

                VStack(alignment: .leading, spacing: V5.S.s10) {
                    V5SectionLabel(text: "Which days are out")
                        .padding(.horizontal, V5.S.s4)
                    // Opens with nothing selected. That is RS-2, drawn.
                    dayChips
                    Text("Leave this blank if you are not sure. The coach will show every option it can and say what it does not know.")
                        .font(.faffText(TypeScaleV5.label12))
                        .foregroundStyle(V5.textQuiet)
                        .padding(.horizontal, V5.S.s4)
                }

                FaffButton(busy ? "Reading the block…" : "Show me the options",
                           variant: .primary, size: .lg, enabled: !busy) {
                    Task { await load() ; stage = .options }
                }
                FaffButton("Close", variant: .ghost, size: .md) { onClose() }
            } else if busy {
                Skeleton().frame(height: 120)
            } else {
                outageBody
            }
        }
    }

    private var dayChips: some View {
        // A wrapped row of day chips. The window comes from the server's own
        // search boundary, never from a client-side guess about how far a
        // session may move.
        FlowRowV5(spacing: V5.S.s8) {
            ForEach(window, id: \.self) { iso in
                let on = cannotRun.contains(iso)
                Button {
                    if on { cannotRun.remove(iso) } else { cannotRun.insert(iso) }
                } label: {
                    VStack(spacing: V5.S.s2) {
                        Text(Self.dowShort(iso))
                            .font(.faffText(TypeScaleV5.label12, weight: .medium))
                        Text(Self.dayNumber(iso))
                            .font(.faffText(TypeScaleV5.body15, weight: .semibold))
                    }
                    .frame(width: 46, height: 46)
                    .background(on ? V5.signal : V5.materialControl, in: RoundedRectangle(cornerRadius: V5.R.r14, style: .continuous))
                    .foregroundStyle(on ? V5.actionPrimaryText : V5.textSecondary)
                }
                .buttonStyle(V5PressStyle())
                .accessibilityLabel("\(Self.dowLong(iso)) \(Self.dayNumber(iso))")
                .accessibilityValue(on ? "cannot run" : "not marked")
            }
        }
        .padding(.horizontal, V5.S.s4)
    }

    // ── RS-4 · the options ──────────────────────────────────────────────

    private var optionsBody: some View {
        Group {
            if let m = model {
                ScrollView {
                    VStack(alignment: .leading, spacing: V5.S.s16) {
                        targetPlate(m)

                        // Rule 17 · said once, on the workout, not per option.
                        if let split = m.splitVerdict, !split.eligible {
                            CoachSay(text: split.reason, size: .sm)
                        }
                        if let impossible = m.impossibility {
                            Alert(text: impossible, tone: .attention)
                        }

                        if m.options.isEmpty {
                            VStack(alignment: .leading, spacing: V5.S.s10) {
                                V5SectionLabel(text: "Why each day is out")
                                ForEach(m.refusals) { r in
                                    Text("\(Self.dayWords(r.dateISO)) · \(r.reason)")
                                        .font(.faffText(TypeScaleV5.label13))
                                        .foregroundStyle(V5.textSecondary)
                                }
                            }
                        } else {
                            VStack(alignment: .leading, spacing: V5.S.inGroup) {
                                V5SectionLabel(text: "The coach's order")
                                    .padding(.horizontal, V5.S.s4)
                                ForEach(m.options) { o in
                                    optionRow(o)
                                }
                            }
                        }

                        if !m.refusals.isEmpty && !m.options.isEmpty {
                            VStack(alignment: .leading, spacing: V5.S.s6) {
                                V5SectionLabel(text: "Days that are out")
                                    .padding(.horizontal, V5.S.s4)
                                ForEach(m.refusals) { r in
                                    Text("\(Self.dayWords(r.dateISO)) · \(r.reason)")
                                        .font(.faffText(TypeScaleV5.label12))
                                        .foregroundStyle(V5.textQuiet)
                                        .padding(.horizontal, V5.S.s4)
                                }
                            }
                        }

                        FaffButton("Change which days are out", variant: .secondary, size: .md) {
                            stage = .availability
                        }
                        FaffButton("Leave it where it is", variant: .ghost, size: .md) { onClose() }
                    }
                }
            } else if busy {
                Skeleton().frame(height: 200)
            } else {
                outageBody
            }
        }
    }

    private func optionRow(_ o: V5RescheduleOption) -> some View {
        Button { stage = .detail(o.id) } label: {
            VStack(alignment: .leading, spacing: V5.S.s6) {
                HStack(alignment: .firstTextBaseline, spacing: V5.S.s8) {
                    Text(Self.dayWords(o.newDateISO))
                        .font(.faffText(TypeScaleV5.body17, weight: .semibold))
                        .foregroundStyle(V5.textPrimary)
                    Spacer(minLength: 0)
                    Text(Self.miles(o.session.distanceMi))
                        .font(.faffText(TypeScaleV5.body15, weight: .semibold))
                        .foregroundStyle(o.stimulusPreservation == "FULL" ? V5.textPrimary : V5.attention)
                }
                // The one-line verdict, in the coach's own words.
                Text(o.whyRankedHere)
                    .font(.faffText(TypeScaleV5.label13))
                    .foregroundStyle(V5.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                if o.stimulusPreservation != "FULL" {
                    Text("Shorter than prescribed. Some of the long run is given up.")
                        .font(.faffText(TypeScaleV5.label12))
                        .foregroundStyle(V5.attention)
                }
                if o.isCompromise {
                    Text("A compromise. Nothing available keeps everything.")
                        .font(.faffText(TypeScaleV5.label12))
                        .foregroundStyle(V5.attention)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(V5.S.tilePad)
            .background(V5.materialTile, in: RoundedRectangle(cornerRadius: V5.R.r18, style: .continuous))
        }
        .buttonStyle(V5PressStyle())
    }

    // ── one option, in full ─────────────────────────────────────────────

    @ViewBuilder
    private func detailBody(_ id: String) -> some View {
        if let m = model, let o = m.options.first(where: { $0.id == id }) {
            ScrollView {
                VStack(alignment: .leading, spacing: V5.S.betweenGroups) {

                    // The headline: the new date, the distance, the purpose.
                    VStack(alignment: .leading, spacing: V5.S.s6) {
                        Text(Self.dayWords(o.newDateISO))
                            .font(.faffDisplay(38))
                            .foregroundStyle(V5.textPrimary)
                        Text("\(Self.miles(o.session.distanceMi)) · \(o.session.name)")
                            .font(.faffText(TypeScaleV5.body17, weight: .semibold))
                            .foregroundStyle(V5.textPrimary)
                        Text(o.session.purpose)
                            .font(.faffText(TypeScaleV5.label13))
                            .foregroundStyle(V5.textQuiet)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.horizontal, V5.S.s4)

                    CoachSay(text: o.whyRankedHere, size: .md)
                    CoachSay(text: o.trainingValuePreserved, size: .sm)

                    if let reason = o.identity.reductionReason {
                        Alert(text: reason, tone: .attention)
                    }

                    section("What moves", o.moved)
                    section("What does not", o.unchanged)

                    // Separation, in days. The nominal hours are shown as
                    // nominal, because a plan row carries a date and no time
                    // of day and the difference is not ours to pretend away.
                    VStack(alignment: .leading, spacing: V5.S.s6) {
                        V5SectionLabel(text: "Space around the hard days")
                            .padding(.horizontal, V5.S.s4)
                        ForEach(o.separation) { s in
                            HStack(alignment: .top, spacing: V5.S.s8) {
                                Text("\(s.interveningDays)")
                                    .font(.faffText(TypeScaleV5.body15, weight: .semibold))
                                    .foregroundStyle(s.deficitDays > 0 ? V5.fault : V5.textPrimary)
                                    .frame(width: 16, alignment: .trailing)
                                VStack(alignment: .leading, spacing: V5.S.s2) {
                                    Text("easy day\(s.interveningDays == 1 ? "" : "s") between \(s.earlierLabel) and \(s.laterLabel)")
                                        .font(.faffText(TypeScaleV5.label13))
                                        .foregroundStyle(V5.textSecondary)
                                    Text(s.deficitDays > 0
                                         ? "Doctrine asks for \(s.requiredDays). This is the shortfall."
                                         : "About \(s.nominalHours) hours apart.")
                                        .font(.faffText(TypeScaleV5.label12))
                                        .foregroundStyle(s.deficitDays > 0 ? V5.fault : V5.textQuiet)
                                }
                                Spacer(minLength: 0)
                            }
                            .padding(.horizontal, V5.S.s4)
                        }
                    }

                    // Rolling load, in plain words. No ACWR, no "acute".
                    VStack(alignment: .leading, spacing: V5.S.s6) {
                        V5SectionLabel(text: "What it does to the miles")
                            .padding(.horizontal, V5.S.s4)
                        Text(loadSentence(o.load))
                            .font(.faffText(TypeScaleV5.label13))
                            .foregroundStyle(V5.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.horizontal, V5.S.s4)
                        ForEach(o.load.weeks) { w in
                            Text("Week of \(Self.dayWords(w.startISO)) · \(Self.miles(w.beforeMi)) becomes \(Self.miles(w.afterMi))\(weekFlag(w))")
                                .font(.faffText(TypeScaleV5.label12))
                                .foregroundStyle(V5.textQuiet)
                                .padding(.horizontal, V5.S.s4)
                        }
                    }

                    section("What it means further out", downstreamLines(o.downstream))

                    if !o.tradeoffs.isEmpty {
                        section("What you give up", o.tradeoffs, ink: V5.attention)
                    }

                    if let refusal {
                        Alert(text: refusal, tone: .fault)
                    }

                    FaffButton(busy ? "Applying…" : "Move it to \(Self.dowLong(o.newDateISO))",
                               variant: .primary, size: .lg, enabled: !busy) {
                        Task { await apply(o) }
                    }
                    FaffButton("Back to the options", variant: .ghost, size: .md) { stage = .options }
                }
            }
        } else {
            outageBody
        }
    }

    // ── RS-8 · after approving ──────────────────────────────────────────

    private func doneBody(_ s: V5RescheduleSummary) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
                Text(s.headline)
                    .font(.faffText(TypeScaleV5.body17, weight: .semibold))
                    .foregroundStyle(V5.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, V5.S.s4)

                CoachSay(text: s.why, size: .sm)

                section("What moved", s.whatMoved)
                section("What is unchanged", s.whatIsUnchanged)
                if !s.instructions.isEmpty {
                    section("For the days that changed", s.instructions, ink: V5.attention)
                }

                if undone {
                    Alert(text: "Put back. Your week is as it was.", tone: .attention)
                    FaffButton("Close", variant: .primary, size: .lg) { onClose() }
                } else {
                    if let refusal { Alert(text: refusal, tone: .fault) }
                    // RS-6 · undo stays reachable, and says what it does.
                    FaffButton(busy ? "Putting it back…" : "Undo this change",
                               variant: .secondary, size: .md, enabled: !busy) {
                        Task { await undo(s.decisionId) }
                    }
                    FaffButton("Done", variant: .ghost, size: .md) { onClose() }
                }
            }
        }
    }

    // ── refusal and outage are different facts ──────────────────────────

    private func absentBody(_ text: String) -> some View {
        VStack(alignment: .leading, spacing: V5.S.s16) {
            Alert(text: text, tone: .attention)
            FaffButton("Close", variant: .ghost, size: .md) { onClose() }
        }
    }

    private var outageBody: some View {
        VStack(alignment: .leading, spacing: V5.S.s16) {
            ErrorNote(text: "The coach could not be reached. Nothing was changed.")
            FaffButton(busy ? "Trying again…" : "Try again",
                       variant: .secondary, size: .md, enabled: !busy) {
                Task { await load() }
            }
            FaffButton("Close", variant: .ghost, size: .md) { onClose() }
        }
    }

    // ── pieces ──────────────────────────────────────────────────────────

    private func targetPlate(_ m: V5Reschedule) -> some View {
        Tile {
            VStack(alignment: .leading, spacing: V5.S.s4) {
                Text("\(Self.dayWords(m.target.dateISO)) · \(m.target.label)")
                    .font(.faffText(TypeScaleV5.body15, weight: .semibold))
                    .foregroundStyle(V5.textPrimary)
                Text(m.target.purpose)
                    .font(.faffText(TypeScaleV5.label12))
                    .foregroundStyle(V5.textQuiet)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func section(_ title: String, _ lines: [String], ink: Color = V5.textSecondary) -> some View {
        VStack(alignment: .leading, spacing: V5.S.s6) {
            V5SectionLabel(text: title)
                .padding(.horizontal, V5.S.s4)
            ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                Text(line)
                    .font(.faffText(TypeScaleV5.label13))
                    .foregroundStyle(ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, V5.S.s4)
            }
        }
    }

    private func weekFlag(_ w: V5RescheduleWeekLoad) -> String {
        if w.isTaper { return " · taper week" }
        if let p = w.racePriority, w.isCutback { return " · your \(p) race is in it, and it was authored lighter" }
        if let p = w.racePriority { return " · your \(p) race is in it" }
        if w.isCutback { return " · authored as a lighter week" }
        return ""
    }

    /// Rolling seven-day miles, said the way a runner reads it. The number is
    /// the engine's; the sentence is the only thing composed here.
    private func loadSentence(_ l: V5RescheduleLoad) -> String {
        let d = l.peakRolling7DeltaMi
        if abs(d) < 0.05 {
            return "The miles in any seven-day stretch do not change. This moves a run across a calendar boundary, not across your legs."
        }
        let dir = d > 0 ? "more" : "fewer"
        let on = l.peakRolling7OnISO.map { " around \(Self.dayWords($0))" } ?? ""
        return "At its biggest, a seven-day stretch\(on) carries \(Self.miles(abs(d))) \(dir) than it does now, \(Self.miles(l.rolling7BeforeMi)) becoming \(Self.miles(l.rolling7AfterMi))."
    }

    private func downstreamLines(_ d: V5RescheduleDownstream) -> [String] {
        var out: [String] = []
        if let l = d.nextLongRun {
            out.append(l.changed
                ? "Your next long run, \(Self.miles(l.distanceMi)) on \(Self.dayWords(l.dateISO)), moves too."
                : "Your next long run, \(Self.miles(l.distanceMi)) on \(Self.dayWords(l.dateISO)), stays where it is.")
        }
        if let r = d.nextRace {
            out.append("\(r.name) is \(r.daysAfterMovedSession) day\(r.daysAfterMovedSession == 1 ? "" : "s") after this run, and does not move.")
        }
        if let c = d.nextCutbackWeek {
            out.append(c.touched
                ? "It lands in the lighter week beginning \(Self.dayWords(c.startISO))."
                : "The lighter week beginning \(Self.dayWords(c.startISO)) is untouched.")
        }
        if let t = d.taper.startsISO {
            out.append(d.taper.touched
                ? "Your taper is affected. Read this one carefully."
                : "Your taper, from \(Self.dayWords(t)), is untouched.")
        }
        return out
    }

    // ── work ────────────────────────────────────────────────────────────

    private func load() async {
        busy = true; refusal = nil
        defer { busy = false }
        do {
            let out = try await API.fetchReschedule(dateISO: dateISO,
                                                    unavailable: cannotRun.sorted())
            switch out {
            case .ok(let m):
                model = m
                // The window to mark comes from the server's own search
                // boundary. The phone never decides how far a session may go.
                if window.isEmpty { window = m.considered }
                if case .availability = stage {} else { stage = .options }
            case .absent(let text): stage = .absent(text)
            case .failed:           stage = .outage
            }
        } catch {
            stage = .outage
        }
    }

    private func apply(_ o: V5RescheduleOption) async {
        guard let m = model else { return }
        busy = true; refusal = nil
        defer { busy = false }
        do {
            let out = try await API.applyReschedule(dateISO: dateISO,
                                                    optionId: o.id,
                                                    token: m.token,
                                                    unavailable: cannotRun.sorted())
            switch out {
            case .applied(let a):
                stage = .done(a.summary)
                // PLANSNAPSHOT-1 · the block just changed under the runner's
                // feet — a fresh sync is one of the named triggers.
                NotificationCenter.default.post(name: .faffPlanMutated, object: nil)
            case .refused(let text): refusal = text
            case .failed: refusal = "That did not go through, and nothing was changed. Try again."
            }
        } catch {
            refusal = "That did not go through, and nothing was changed. Try again."
        }
    }

    private func undo(_ decisionId: String) async {
        busy = true; refusal = nil
        defer { busy = false }
        do {
            switch try await API.undoReschedule(decisionId: decisionId) {
            case .undone:
                undone = true
                NotificationCenter.default.post(name: .faffPlanMutated, object: nil)
            case .refused(let text): refusal = text
            case .failed: refusal = "That did not go through. Your plan is as the change left it."
            }
        } catch {
            refusal = "That did not go through. Your plan is as the change left it."
        }
    }

    // ── formatting ──────────────────────────────────────────────────────

    private static let dowLongNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    private static let dowShortNames = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]

    private static func dow(_ iso: String) -> Int {
        guard let d = ISO8601DateFormatter().date(from: "\(iso)T12:00:00Z") else { return 0 }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        return cal.component(.weekday, from: d) - 1
    }
    static func dowLong(_ iso: String) -> String { dowLongNames[dow(iso)] }
    static func dowShort(_ iso: String) -> String { dowShortNames[dow(iso)] }
    static func dayNumber(_ iso: String) -> String { String(Int(iso.suffix(2)) ?? 0) }
    static func dayWords(_ iso: String) -> String { "\(dowShort(iso)) \(dayNumber(iso))" }
    static func miles(_ mi: Double) -> String {
        let r = (mi * 10).rounded() / 10
        return r == r.rounded() ? "\(Int(r)) mi" : "\(r) mi"
    }
}

// ═════════════════════════════════════════════════════════════════════════
// MARK: - A wrapping row of chips
// ═════════════════════════════════════════════════════════════════════════

/// The day picker wraps, and the number of days depends on the session family
/// (a long run searches ±3, a quality session ±2), so a fixed grid would be
/// wrong for one of them. `Layout` wraps to whatever it is given.
struct FlowRowV5: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > 0, x + s.width > maxWidth { x = 0; y += rowHeight + spacing; rowHeight = 0 }
            x += s.width + spacing
            rowHeight = max(rowHeight, s.height)
        }
        return CGSize(width: maxWidth == .infinity ? x : maxWidth, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > bounds.minX, x + s.width > bounds.maxX { x = bounds.minX; y += rowHeight + spacing; rowHeight = 0 }
            v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(s))
            x += s.width + spacing
            rowHeight = max(rowHeight, s.height)
        }
    }
}

// ═════════════════════════════════════════════════════════════════════════
// MARK: - Standalone host
// ═════════════════════════════════════════════════════════════════════════

/// The sheet on its own page.
///
/// Two uses. The launch argument `-faffReschedule <ISO>` renders the decision
/// directly, which is how it is verified on device (CLAUDE.md Rule 13). And a
/// push destination, for a plan surface that wants the decision as a screen
/// rather than a sheet.
struct RescheduleHostV5: View {
    let dateISO: String
    var onClose: () -> Void = {}

    var body: some View {
        ZStack {
            V5.surfacePage.ignoresSafeArea()
            ScrollView {
                RescheduleSheetV5(dateISO: dateISO, onClose: onClose)
                    .padding(.horizontal, V5.S.gutter)
                    // The shell's own inset. Without it the scroll runs under
                    // the clock, which is what the first render on device did.
                    .padding(.top, V5.Shell.statusBarInset + V5.S.s16)
                    .padding(.bottom, V5.S.s40)
            }
        }
        .preferredColorScheme(.dark)
    }
}
