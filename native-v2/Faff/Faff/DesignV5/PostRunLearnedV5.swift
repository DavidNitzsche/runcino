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

    enum K: String, CodingKey {
        case version, runId, decisionVersion, headline, summary, cost
        case learned, change, changeState, changes, next, why, accessibilitySummary
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
    }

    /// Memberwise, for previews and tests only. The wire path is `init(from:)`.
    init(version: String, runId: String, decisionVersion: String, headline: String,
         summary: String, cost: String?, learned: String, change: String,
         changeState: String, changes: [String], next: String?, why: [String],
         accessibilitySummary: String) {
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

    /// Nothing to say means nothing drawn. A header over an empty tile is the
    /// same defect as a zero standing in for a missing reading.
    private var hasContent: Bool { !learned.isEmpty || !change.isEmpty }

    var body: some View {
        if hasContent {
            VStack(alignment: .leading, spacing: V5.S.s10) {
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
