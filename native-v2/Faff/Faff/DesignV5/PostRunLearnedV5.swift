import SwiftUI

// MARK: - What the run taught the coach
//
// ─────────────────────────────────────────────────────────────────────────
// ONE COMPONENT, BOTH POST-RUN SCREENS.
//
// `TodayAfterV5` and `RunDetailV5` are two independently written compositions
// over two payloads, and the post-run brief's first P0 is that they can
// therefore disagree. They already did: on 2026-09-01, for the same 4 x 1 mile
// session, `/api/v5/today` said "Tempo done, 8.5 mi total at 8:03/mi" and
// `/api/runs/[id]/recap` said "Tempo done, 4 mi @ 7:03" — one run, one field
// name, two distances, two paces.
//
// The server side of that is fixed: `lib/postrun/experience.ts` composes ONE
// interpretation and all three routes return it under `postRun`. This is the
// client side of the same rule. Not two views that happen to look alike — one
// view, drawn by both screens, so a change to what the runner reads cannot
// land on one and miss the other.
//
// ─────────────────────────────────────────────────────────────────────────
// WHAT THIS REPLACES
//
// "What this did" was a weekly mileage percentage and a niggle row. The
// brief's DELETE list names that percentage by name — "weekly mileage
// percentage as the meaning of a run" — and it is not an answer to what the
// run changed. Meanwhile the Evidence Engine had been classifying every
// activity for weeks, capacity by capacity, and no post-run surface read it.
//
// The runner now gets the three sentences that were missing:
//
//   LEARNED  what the run contributed to what the coach believes
//   CHANGE   whether the plan moved, held, or is waiting
//   NEXT     only when there is something the plan does not already say
//
// ─────────────────────────────────────────────────────────────────────────
// RULE 17 · THE BRIEFING IS NOT DRAWN HERE.
//
// The headline, the execution sentence and the cost sentence already reach
// both screens through the existing recap tile (`win` / `verdict` / `facts`),
// which the server now fills from this same object. Drawing them again here
// would print the same three sentences twice on one screen, which is the
// finding this whole brief opens with. This component draws ONLY what the
// recap tile does not carry.
//
// ─────────────────────────────────────────────────────────────────────────
// RULE 11 · A NULL IS A DECISION, NOT A GAP.
//
// `next` is null on most days because the plan already says what is next.
// `why` is empty when nothing was withheld. `changes` is empty unless the plan
// actually moved. Each is simply not drawn — never a row reading "none", which
// is furniture with a shrug in it.

/// The canonical post-run interpretation, as the phone reads it.
///
/// Composed by `web-v2/lib/postrun/experience.ts`, mapped by
/// `web-v2/lib/postrun/wire.ts`, and returned under the key `postRun` by
/// `/api/v5/today`, `/api/runs/[id]` and `/api/runs/[id]/recap` — the same
/// object from the same loader on all three.
struct PostRunV5: Decodable, Equatable {
    /// The interpretation model's own version.
    let version: String
    let runId: String
    /// Identical across every surface showing this run. It is what lets a test
    /// prove two screens render the same decision rather than assert it.
    let decisionVersion: String
    /// Three to eight words. Already drawn by the recap tile as `win`.
    let headline: String
    /// Already drawn by the recap tile as `verdict`.
    let summary: String
    /// Already drawn by the recap tile as the first `fact`. Null when nothing
    /// honest can be said about what the session cost.
    let cost: String?
    /// What the run contributed to the coach's picture of this runner.
    let learned: String
    /// The plan's own word for what moved.
    let change: String
    /// `UNCHANGED` / `UPDATED` / `HELD_FOR_EVIDENCE` / `NO_PLAN` / `UNKNOWN`.
    /// A CODE, never a colour: the design contract forbids encoding an outcome
    /// only by colour, and a screen that switched on the sentence would break
    /// the moment the sentence changed.
    let changeState: String
    /// One line per recorded change. Empty on every state but `UPDATED`.
    let changes: [String]
    /// Only when this run produced something the plan does not already say.
    let next: String?
    /// The disclosure body: what was withheld and why, plus the hedge that
    /// belongs to this certainty. Never a restatement of the sentences above.
    let why: [String]
    /// One sentence for VoiceOver, spoken instead of the layout.
    let accessibilitySummary: String
    /// WHAT THE RECORDING COVERS, when it does not cover the run.
    ///
    /// Rule 11 applied to distance: "we recorded 5.98 miles" and "he ran 5.98
    /// miles" are two facts, and this screen used to print the first in a way
    /// that could only be read as the second. Null when there is nothing to
    /// say, and then nothing is drawn.
    let capture: String?
    /// The strides, when the session had them. Null when it did not.
    ///
    /// His 2026-09-02 easy day prescribed `6x20s strides`, ran all six, and
    /// the screen showed none of them: `workoutType` "easy" resolves to
    /// `.steady`, which decomposes to `.miles`, and the mile table cannot see
    /// a 20-second acceleration. "Not showing the strides."
    let strides: PostRunStridesV5?

    enum K: String, CodingKey {
        case version, runId, decisionVersion, headline, summary, cost
        case learned, change, changeState, changes, next, why, accessibilitySummary
        case capture, strides
    }

    /// LENIENT BY DESIGN, and written out rather than borrowed.
    ///
    /// `APIV5.swift`'s `text`/`opt`/`list` helpers are `fileprivate`, so this
    /// spells the same policy locally: a missing or null string becomes "" and
    /// a missing array becomes empty, so one absent field can never take the
    /// whole section down. The view then decides what an empty string means —
    /// which is "do not draw this", never "draw a blank row".
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        func str(_ k: K) -> String { ((try? c.decodeIfPresent(String.self, forKey: k)) ?? "") ?? "" }
        func optStr(_ k: K) -> String? { (try? c.decodeIfPresent(String.self, forKey: k)) ?? nil }
        func strs(_ k: K) -> [String] { ((try? c.decodeIfPresent([String].self, forKey: k)) ?? []) ?? [] }
        version = str(.version)
        runId = str(.runId)
        decisionVersion = str(.decisionVersion)
        headline = str(.headline)
        summary = str(.summary)
        cost = optStr(.cost)
        learned = str(.learned)
        change = str(.change)
        changeState = str(.changeState)
        changes = strs(.changes)
        next = optStr(.next)
        why = strs(.why)
        accessibilitySummary = str(.accessibilitySummary)
        capture = optStr(.capture)
        strides = (try? c.decodeIfPresent(PostRunStridesV5.self, forKey: .strides)) ?? nil
    }

    /// Memberwise, for previews and tests only. The wire path is `init(from:)`.
    init(version: String, runId: String, decisionVersion: String, headline: String,
         summary: String, cost: String?, learned: String, change: String,
         changeState: String, changes: [String], next: String?, why: [String],
         accessibilitySummary: String,
         capture: String? = nil, strides: PostRunStridesV5? = nil) {
        self.version = version
        self.runId = runId
        self.decisionVersion = decisionVersion
        self.headline = headline
        self.summary = summary
        self.cost = cost
        self.learned = learned
        self.change = change
        self.changeState = changeState
        self.changes = changes
        self.next = next
        self.why = why
        self.accessibilitySummary = accessibilitySummary
        self.capture = capture
        self.strides = strides
    }
}

extension PostRunLearnedV5 {
    /// VoiceOver reads a sentence, not a row of columns.
    ///
    /// The accessibility contract requires every figure to be announced with
    /// its unit, and a bare "0:20 5:47/mi 147" is three unlabelled numbers.
    static func strideSpoken(_ r: PostRunStrideV5) -> String {
        var parts: [String] = [r.label ?? "Stride \(r.ordinal)"]
        if let d = r.duration { parts.append("\(d) seconds") }
        if let p = r.pace { parts.append("at \(p)") }
        if let hr = r.hr { parts.append("heart rate \(hr)") }
        return parts.joined(separator: ", ")
    }
}

/// One stride, as the runner reads it.
///
/// THERE IS NO VERDICT FIELD AND THERE MUST NOT BE ONE.
/// `Research/04-workout-vocabulary.md` §7.2 calls a stride "relaxed",
/// "~85-95% max effort" and, in as many words, "Not a workout" — which is why
/// the server gives it a deliberately wide band and grades it `effort`, a
/// shape that is never pace-graded at all. Four of his six came in at 347-365
/// s/mi against a 401 target and the old screen reported them as deviations.
/// Being quick is what a stride is FOR.
struct PostRunStrideV5: Decodable, Equatable, Identifiable {
    var id: Int { ordinal }
    let ordinal: Int
    let label: String?
    /// "0:20".
    let duration: String?
    /// "5:47/mi". A reading, never a grade.
    let pace: String?
    let hr: Int?
    let distanceMi: Double?

    enum K: String, CodingKey { case ordinal, label, duration, pace, hr, distanceMi }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        ordinal = ((try? c.decodeIfPresent(Int.self, forKey: .ordinal)) ?? 0) ?? 0
        label = (try? c.decodeIfPresent(String.self, forKey: .label)) ?? nil
        duration = (try? c.decodeIfPresent(String.self, forKey: .duration)) ?? nil
        pace = (try? c.decodeIfPresent(String.self, forKey: .pace)) ?? nil
        hr = (try? c.decodeIfPresent(Int.self, forKey: .hr)) ?? nil
        distanceMi = (try? c.decodeIfPresent(Double.self, forKey: .distanceMi)) ?? nil
    }

    init(ordinal: Int, label: String?, duration: String?, pace: String?, hr: Int?, distanceMi: Double?) {
        self.ordinal = ordinal; self.label = label; self.duration = duration
        self.pace = pace; self.hr = hr; self.distanceMi = distanceMi
    }
}

struct PostRunStridesV5: Decodable, Equatable {
    /// One sentence. Completion and distance, never compliance.
    let summary: String
    let rows: [PostRunStrideV5]
    /// The walk-backs between them. Doctrine prescribes "Full walk-back or
    /// 60-90 s jog - no fatigue between strides", so taking them is correct
    /// execution and the runner is shown that he did, not graded on it.
    let recoveryCount: Int
    let recoveryDistanceMi: Double?

    enum K: String, CodingKey { case summary, rows, recoveryCount, recoveryDistanceMi }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        summary = ((try? c.decodeIfPresent(String.self, forKey: .summary)) ?? "") ?? ""
        rows = ((try? c.decodeIfPresent([PostRunStrideV5].self, forKey: .rows)) ?? []) ?? []
        recoveryCount = ((try? c.decodeIfPresent(Int.self, forKey: .recoveryCount)) ?? 0) ?? 0
        recoveryDistanceMi = (try? c.decodeIfPresent(Double.self, forKey: .recoveryDistanceMi)) ?? nil
    }

    init(summary: String, rows: [PostRunStrideV5], recoveryCount: Int, recoveryDistanceMi: Double?) {
        self.summary = summary; self.rows = rows
        self.recoveryCount = recoveryCount; self.recoveryDistanceMi = recoveryDistanceMi
    }
}

/// The section both post-run screens draw under the analysis.
struct PostRunLearnedV5: View {
    let model: PostRunV5
    /// Collapsed by default. The disclosure exists for the runner who wants
    /// the provenance; the four in ten who never open it are not shown a
    /// paragraph they did not ask for.
    @State private var whyOpen = false

    private var learned: String {
        model.learned.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    private var change: String {
        model.change.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    private var next: String? {
        guard let n = model.next?.trimmingCharacters(in: .whitespacesAndNewlines),
              !n.isEmpty else { return nil }
        return n
    }
    private var why: [String] {
        model.why
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    private var capture: String? {
        guard let c = model.capture?.trimmingCharacters(in: .whitespacesAndNewlines),
              !c.isEmpty else { return nil }
        return c
    }

    private var strides: PostRunStridesV5? {
        guard let s = model.strides, !s.rows.isEmpty else { return nil }
        return s
    }

    /// Nothing to say means nothing drawn. A header over an empty tile is the
    /// same defect as a zero standing in for a missing reading.
    private var hasContent: Bool {
        !learned.isEmpty || !change.isEmpty || capture != nil || strides != nil
    }

    var body: some View {
        if hasContent {
            VStack(alignment: .leading, spacing: V5.S.s10) {
                /* WHAT THE RECORDING COVERS, ABOVE EVERYTHING IT COVERS.
                 *
                 * A caveat printed under a total is a caveat nobody reads. When
                 * the run's own numbers do not add up to the run — 6.41 mi
                 * total, 5.98 mi of phases, 5.00 mi of mile rows on
                 * 2026-09-02 — the sentence that reconciles them goes first, so
                 * every figure below it is read as what it is. */
                if let c = capture {
                    Text(c)
                        .font(.faffText(TypeScaleV5.body15))
                        .foregroundStyle(V5.textSecondary)
                        .lineSpacing(3)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, V5.S.s4)
                        .padding(.bottom, V5.S.s6)
                }

                /* THE STRIDES.
                 *
                 * Drawn HERE, in the one component both post-run screens
                 * already share, rather than in each screen's own breakdown —
                 * the brief's first P0 is that Today-after-run and Run Detail
                 * are two compositions that can disagree, and a section added
                 * to one of them would be that defect committed again.
                 *
                 * NOTHING IS GRADED. A pace and a heart rate are readings; no
                 * row carries a target, a verdict or a status word, and
                 * `PostRunStrideV5` has no field that could hold one. */
                if let st = strides {
                    VStack(alignment: .leading, spacing: V5.S.s10) {
                        V5SectionLabel(text: "Strides")
                            .padding(.horizontal, V5.S.s4)
                        VStack(alignment: .leading, spacing: V5.S.s8) {
                            ForEach(st.rows) { row in
                                HStack(alignment: .firstTextBaseline, spacing: V5.S.s8) {
                                    Text(row.label ?? "Stride \(row.ordinal)")
                                        .font(.faffText(TypeScaleV5.body15))
                                        .foregroundStyle(V5.textPrimary)
                                    Spacer(minLength: V5.S.s8)
                                    if let d = row.duration {
                                        Text(d)
                                            .font(.faffText(TypeScaleV5.label14))
                                            .foregroundStyle(V5.textSecondary)
                                    }
                                    if let pace = row.pace {
                                        Text(pace)
                                            .font(.faffText(TypeScaleV5.label14))
                                            .foregroundStyle(V5.textSecondary)
                                    }
                                    if let hr = row.hr {
                                        Text("\(hr)")
                                            .font(.faffText(TypeScaleV5.label14))
                                            .foregroundStyle(V5.textQuiet)
                                    }
                                }
                                .accessibilityElement(children: .combine)
                                .accessibilityLabel(Self.strideSpoken(row))
                            }
                            if !st.summary.isEmpty {
                                Text(st.summary)
                                    .font(.faffText(TypeScaleV5.label14))
                                    .foregroundStyle(V5.textQuiet)
                                    .lineSpacing(3)
                                    .fixedSize(horizontal: false, vertical: true)
                                    .padding(.top, V5.S.s4)
                            }
                        }
                        .padding(.horizontal, V5.S.s4)
                    }
                    .padding(.bottom, V5.S.s6)
                }

                V5SectionLabel(text: "What this taught the coach")
                    .padding(.horizontal, V5.S.s4)

                VStack(alignment: .leading, spacing: V5.S.s14) {
                    if !learned.isEmpty {
                        Text(learned)
                            .font(.faffText(TypeScaleV5.body17))
                            .foregroundStyle(V5.textPrimary)
                            .lineSpacing(4)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    if !change.isEmpty {
                        VStack(alignment: .leading, spacing: V5.S.s6) {
                            Text(change)
                                .font(.faffText(TypeScaleV5.body15))
                                .foregroundStyle(V5.textSecondary)
                                .lineSpacing(3)
                                .fixedSize(horizontal: false, vertical: true)
                            // Only on the state that has them, and each on its
                            // own line — a plan change the runner cannot see
                            // itemised is an announcement, not an explanation.
                            ForEach(model.changes, id: \.self) { line in
                                Text(line)
                                    .font(.faffText(TypeScaleV5.label14))
                                    .foregroundStyle(V5.textQuiet)
                                    .lineSpacing(3)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }

                    if let n = next {
                        Text(n)
                            .font(.faffText(TypeScaleV5.body15))
                            .foregroundStyle(V5.textPrimary)
                            .lineSpacing(3)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    if !why.isEmpty {
                        Button {
                            withAnimation(V5.Motion.expand) { whyOpen.toggle() }
                        } label: {
                            HStack(spacing: V5.S.s6) {
                                Text(whyOpen ? "Hide why" : "Why")
                                    .font(.faffText(TypeScaleV5.label14, weight: .semibold))
                                    .foregroundStyle(V5.textSecondary)
                                Spacer(minLength: 0)
                            }
                            // 44pt, per the accessibility contract, on a row
                            // whose visible text is 14pt.
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        // The state is ANNOUNCED, not left to the caret. A
                        // disclosure whose expanded state is only visual is
                        // invisible to VoiceOver.
                        .accessibilityLabel(whyOpen ? "Hide why" : "Why")
                        .accessibilityAddTraits(whyOpen ? [.isButton, .isSelected] : .isButton)

                        if whyOpen {
                            VStack(alignment: .leading, spacing: V5.S.s6) {
                                ForEach(why, id: \.self) { line in
                                    Text(line)
                                        .font(.faffText(TypeScaleV5.label14))
                                        .foregroundStyle(V5.textQuiet)
                                        .lineSpacing(3)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            }
                            .transition(.opacity)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, V5.S.tilePad)
                .padding(.vertical, V5.S.s14)
                .background(V5.materialTile,
                            in: RoundedRectangle(cornerRadius: V5.R.r18, style: .continuous))
            }
        }
    }
}
