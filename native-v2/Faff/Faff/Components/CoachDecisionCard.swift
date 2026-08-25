//
//  CoachDecisionCard.swift
//  The ONE interruption chrome on iPhone · the phone's mirror of the web
//  recomposition deck, Decision 2 (approved 2026-08-17).
//
//  ── What this replaces ────────────────────────────────────────────────
//
//  Today carried three unrelated pre-hero treatments, each with its own
//  shape and its own button vocabulary:
//
//    proposalCard(_:)          amber "PROPOSAL" tag · ACCEPT / DECLINE inline
//    workoutProposalBanner(_:) amber "ADJUST" tag · taps through to NudgeSheet
//    recentlyAppliedLine(_:)   green tick line · X to dismiss
//
//  ── The two defects this fixes ────────────────────────────────────────
//
//  1. THE CAP WAS VIOLATED, NOT ENFORCED. Brief v2 §6 allows at most one
//     banner above the hero. Today rendered `ForEach(workoutProposals)`
//     AND `ForEach(pendingProposals)` as unbounded stacks, so a runner
//     with three pending items got three cards stacked over the 88pt hero
//     and pushed it off the first screen.
//
//  2. THE SINGLE SLOT SILENTLY DROPPED THE REST. This is the same defect
//     Wave 1 found on web, in a different place: `adaptationIntent` is
//     ONE optional (`adaptList.first`), so when the engine applied two
//     adaptations in a day the runner was only ever told about one, with
//     no affordance saying another existed. Nothing surfaced the loss.
//
//  Both are the same bug in opposite directions — multiplicity handled by
//  the layout instead of by the design. The deck's ruling fixes both the
//  same way: ONE card, kind-driven dressing, and an "N WAITING" pager so
//  the cap is structural and every item stays reachable.
//
//  ── The grammar (locked, byte-for-byte with the web) ──────────────────
//
//    kind .decision · amber #F3AD38 · "COACH · NEEDS A DECISION"
//    kind .notice   · recovery blue #27B4E0 · "COACH · APPLIED"
//
//  Primary button labels always begin ACCEPT. Secondary always begin
//  KEEP. Decisions have no X — a decision the coach is waiting on gets
//  answered, not swept away; "DECIDE LATER" defers it for the session.
//  Notices carry DISMISS, persisted, because they are FYI.
//
//  The selector below is PURE (no SwiftUI, no networking) for the same
//  reason decision-cards.ts is: kind / priority / pager selection is the
//  part worth reasoning about independently of how it is painted.
//

import SwiftUI

// MARK: - Model

/// Amber = the coach needs a call. Recovery blue = already applied.
enum CoachDecisionKind {
    case decision
    case notice
}

/// Which loader produced the row. Drives the action dispatch, never the
/// dressing (deck: dressing is kind-driven, not source-driven).
enum CoachDecisionSource {
    case coachProposal(PendingProposal)
    case workoutProposal(WorkoutProposal)
    /// 2026-08-25 · plan_proposals · the block-level rebuild. Pending rows are
    /// a decision; auto_applied rows are the notice that it already happened.
    case planProposal(PlanProposal)
    case adaptation(CoachIntent)
}

/// One button. `role` fixes the grammar.
///   accept · primary, label always begins "ACCEPT"
///   keep   · secondary, label always begins "KEEP"
///   undo   · secondary on a NOTICE, label always begins "PUT"
///
/// 2026-08-25 · `undo` is new, and mirrors `decision-cards.ts` exactly. The
/// deck's rule was that a notice carries no buttons because it already
/// happened and there is nothing left to decide. That held while an applied
/// change was irreversible. It is not any more: the ruling was "apply, but let
/// me undo", and an undo the runner cannot reach is not an undo.
///
/// `keep` was the obvious reuse and it is wrong. "KEEP THE CURRENT PLAN" means
/// decline a change that has not happened; on a notice the change HAS happened,
/// so KEEP would be offering to keep the very thing being got rid of.
struct CoachDecisionAction: Identifiable, Equatable {
    enum Role { case accept, keep, undo }
    let role: Role
    let label: String
    /// Shown while the request is in flight.
    let busyLabel: String
    var id: String { label }
}

/// What came back when the runner tapped.
///
/// 2026-08-25 · this was a `Bool`, and a Bool cannot tell the difference
/// between "the network dropped" and "the server looked at your training and
/// said no". Undo can genuinely refuse — the runner has already run a day the
/// two blocks treat differently — and a refusal is a correct answer carrying a
/// sentence about his own training. Rendering it as "could not save, check
/// your connection and try again" would tell him to retry something that will
/// refuse every time, for a reason he was never shown.
enum CoachDecisionOutcome: Equatable {
    /// It landed. The card clears.
    case done
    /// The request did not reach a verdict. Retrying is reasonable.
    case failed
    /// The server declined, and this is what to show. Coach voice, server-side.
    case refused(String)
}

struct CoachDecision: Identifiable {
    /// Stable, source-scoped so ids from different tables can't collide.
    let key: String
    let source: CoachDecisionSource
    let kind: CoachDecisionKind
    /// Kind-driven eyebrow copy.
    let eyebrow: String
    /// Display line. Sentence case, coach voice.
    let title: String
    /// Body paragraph. Short, direct, no hype.
    let body: String
    /// Notices show a date stamp where decisions show the pager.
    let stamp: String?
    let actions: [CoachDecisionAction]
    /// Sort weight WITHIN a kind. Lower renders first. Kind always wins:
    /// every decision precedes every notice.
    let priority: Int

    var id: String { key }
}

// MARK: - Selector (pure)

enum CoachDecisions {

    static let eyebrowDecision = "COACH · NEEDS A DECISION"
    static let eyebrowNotice = "COACH · APPLIED"

    /* priority ladder · mirrors decision-cards.ts PRIORITY.
       Injury / illness first: those rows exist because something happened
       to the runner's body. Then the whole block, then a single workout,
       then passive notices.

       2026-08-25 · plan_proposal FILLED. The slot was left here on the
       promise that "adding it later does not reshuffle anything", and that
       held: the two numbers below are unchanged. A block-level rebuild
       outranks a single-workout tweak because it is the larger change to
       the runner's week, and is outranked by injury and illness because
       those are about the runner's body. */
    static let priorityCoachProposal = 10
    static let priorityPlanProposal = 20
    static let priorityWorkoutProposal = 30
    static let priorityPlanApplied = 60
    static let priorityAdaptation = 70

    /// Recency gate for adaptation notices · "happened in the last day",
    /// same 24h window the web card applies.
    static let adaptationRecencyHours: Double = 24

    /// Fold every interruption source into one ordered queue.
    ///
    /// Ordering, in this exact precedence:
    ///   1. kind · every decision precedes every notice
    ///   2. priority · the ladder above
    ///   3. key · stable tiebreak so the pager never reshuffles
    static func select(
        coachProposals: [PendingProposal],
        workoutProposals: [WorkoutProposal],
        // 2026-08-25 · defaulted so every existing call site and preview keeps
        // compiling unchanged. The default is the empty list, which is what
        // this surface has effectively been passing since the app shipped.
        planProposals: [PlanProposal] = [],
        adaptations: [CoachIntent],
        todayISO: String,
        now: Date = Date()
    ) -> [CoachDecision] {
        var out: [CoachDecision] = []
        for p in coachProposals { out.append(fromCoachProposal(p)) }
        for p in workoutProposals { out.append(fromWorkoutProposal(p, todayISO: todayISO)) }
        for p in planProposals {
            if let d = fromPlanProposal(p, now: now) { out.append(d) }
        }
        for a in adaptations where isWithinRecency(a.when_iso, now: now) {
            out.append(fromAdaptation(a))
        }
        return out.sorted { a, b in
            let ka = a.kind == .decision ? 0 : 1
            let kb = b.kind == .decision ? 0 : 1
            if ka != kb { return ka < kb }
            if a.priority != b.priority { return a.priority < b.priority }
            return a.key < b.key
        }
    }

    /// "2 OF 3 WAITING ›" · nil when a single item waits (no pager chrome
    /// for one card). Index is 0-based; the label is 1-based because
    /// runners count from one.
    static func pagerLabel(index: Int, total: Int) -> String? {
        guard total > 1 else { return nil }
        return "\(index + 1) OF \(total) WAITING ›"
    }

    /// Accent hex per kind, straight off the locked ten-color palette.
    static func accent(_ kind: CoachDecisionKind) -> Color {
        kind == .decision ? Theme.goal : Theme.dist
    }

    // MARK: Per-source mappers

    private static func fromCoachProposal(_ p: PendingProposal) -> CoachDecision {
        let isInjury = p.proposal_type == "injury_adjust"
        let isIllness = p.proposal_type == "illness_adjust"
        let title = isInjury
            ? "Switch to an injury-return plan"
            : isIllness
                ? "Take the recovery week"
                : "The coach has a proposal"
        let acceptVerb = isInjury
            ? "BUILD THE INJURY PLAN"
            : isIllness
                ? "DROP THIS WEEK'S QUALITY"
                : "MAKE THE CHANGE"
        // reason = what we noticed, suggested = what we'd do. Both are
        // already coach-voice strings from lib/plan/adapt.ts.
        let body = [p.reason, p.suggested]
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        return CoachDecision(
            key: "coach-\(p.id)",
            source: .coachProposal(p),
            kind: .decision,
            eyebrow: eyebrowDecision,
            title: title,
            body: body,
            stamp: p.created_at.isEmpty ? nil : p.created_at,
            actions: [
                .init(role: .accept, label: "ACCEPT · \(acceptVerb)", busyLabel: "APPLYING"),
                .init(role: .keep, label: "KEEP THE CURRENT PLAN", busyLabel: "NOTING"),
            ],
            priority: priorityCoachProposal
        )
    }

    private static func fromWorkoutProposal(_ p: WorkoutProposal, todayISO: String) -> CoachDecision {
        let day = workoutDayLabel(p.workoutDateISO, todayISO: todayISO)
        let phrase = workoutActionPhrase(p)
        return CoachDecision(
            key: "workout-\(p.id)",
            source: .workoutProposal(p),
            kind: .decision,
            eyebrow: eyebrowDecision,
            title: "\(day) workout could \(phrase)",
            body: p.why ?? p.reason,
            stamp: p.createdAt.isEmpty ? nil : p.createdAt,
            actions: [
                .init(role: .accept, label: "ACCEPT · \(phrase.uppercased())", busyLabel: "UPDATING"),
                .init(role: .keep, label: "KEEP IT AS PLANNED", busyLabel: "KEEPING"),
            ],
            priority: priorityWorkoutProposal
        )
    }

    /// Titles per plan-proposal kind. Mirrors `PLAN_TITLES` in decision-cards.ts.
    ///
    /// A dictionary rather than a switch, and a String key rather than an enum,
    /// so a kind this build has never heard of falls back to a real sentence
    /// instead of disappearing. The web's equivalent was an exhaustive switch
    /// over a union that had drifted behind its writers, and it returned
    /// `undefined` — a card with a title and an empty body — for four kinds the
    /// server was actively stamping.
    private static let planTitles: [String: String] = [
        "volume_drift": "Your volume has drifted off plan",
        "vdot_drift": "Your fitness has moved",
        "staleness": "This plan is due a refresh",
        "easy_drift": "Your easy days have drifted",
        "long_drift": "Your long runs have drifted",
        "quality_drift": "Your quality work has drifted",
        "goal_gap_widening": "The gap to your goal is widening",
        "race_date_changed": "A race date changed",
        "goal_time_changed": "Your goal time changed",
        "a_race_added": "A goal race was added",
        "a_race_removed": "A goal race was removed",
        "goal_renegotiation": "Your race target needs a call",
        "pace_reanchor": "Your paces are off your fitness",
        "replan": "Your settings reshaped the block",
        "plan_change": "Your settings reshaped the block",
        "race_graduate": "The next block is up",
        "recovery_complete": "Recovery is done",
        "plan_elapsed": "That block ran out",
        "maintenance_to_raceprep": "Race prep starts here",
    ]

    /// What ACCEPT concretely does, per kind. Mirrors `PLAN_ACCEPT_VERB`.
    private static let planAcceptVerbs: [String: String] = [
        "staleness": "REFRESH THE PLAN",
        "goal_renegotiation": "SET THE REVISED TARGET",
        "pace_reanchor": "RE-ANCHOR THE PACES",
    ]

    /// 2026-08-25 · the block-level rebuild, on the phone at last.
    ///
    /// TWO SHAPES, and the difference is the whole point of this audit:
    ///
    ///   pending      · the coach is asking. ACCEPT rebuilds, KEEP does not.
    ///                  These were completely unreachable on the phone — a
    ///                  proposal could stand for fourteen days and the surface
    ///                  that would have shown it could not be called.
    ///
    ///   auto_applied · it ALREADY HAPPENED. No buttons, because there is
    ///                  nothing left to decide; a notice, because the runner is
    ///                  owed the fact and the reason. This is the shape that
    ///                  went missing on 2026-08-25.
    ///
    /// Every other status (accepted, dismissed, superseded, expired) is
    /// resolved and never interrupts, exactly as the web decides it.
    private static func fromPlanProposal(_ p: PlanProposal, now: Date) -> CoachDecision? {
        let title = planTitles[p.kind] ?? "Your training plan changed"
        // The server always populates `message`. If it somehow did not, say the
        // honest generic thing rather than rendering an empty card.
        let body = p.message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? "Open the plan to see what moved."
            : p.message

        if p.status == "pending" {
            let verb = planAcceptVerbs[p.kind] ?? "REBUILD THE PLAN"
            return CoachDecision(
                key: "plan-\(p.id)",
                source: .planProposal(p),
                kind: .decision,
                eyebrow: eyebrowDecision,
                title: title,
                body: body,
                stamp: p.createdAt.isEmpty ? nil : p.createdAt,
                actions: [
                    .init(role: .accept, label: "ACCEPT · \(verb)", busyLabel: "REBUILDING"),
                    .init(role: .keep, label: "KEEP THE CURRENT PLAN", busyLabel: "NOTING"),
                ],
                priority: priorityPlanProposal
            )
        }

        if p.status == "auto_applied" {
            // The server's own 24h window on auto_applied rows is the contract.
            // Applying the same recency filter the adaptation notices use means
            // a stale payload cannot resurface a week-old rebuild as news.
            guard isWithinRecency(p.createdAt, now: now) else { return nil }
            // 2026-08-25 · THE NOTICE GREW A BUTTON.
            //
            // Offered whenever the row records BOTH sides of the swap, because
            // those two ids are what the server needs to reverse it. Whether the
            // undo is SAFE is not decided here: it depends on which days the
            // runner has run since the rebuild, which is a database question. A
            // client that guessed would either hide a safe undo or promise an
            // unsafe one, so the button is offered and the server rules. A
            // refusal comes back with a sentence, which the card renders.
            let canUndo = (p.previousPlanId?.isEmpty == false) && (p.newPlanId?.isEmpty == false)
            return CoachDecision(
                key: "plan-\(p.id)",
                source: .planProposal(p),
                kind: .notice,
                eyebrow: eyebrowNotice,
                title: title,
                body: body,
                stamp: p.createdAt.isEmpty ? nil : p.createdAt,
                actions: canUndo
                    ? [.init(role: .undo, label: "PUT THE OLD BLOCK BACK", busyLabel: "PUTTING IT BACK")]
                    : [],
                priority: priorityPlanApplied
            )
        }

        return nil
    }

    private static func fromAdaptation(_ a: CoachIntent) -> CoachDecision {
        let isOverride = a.severity == .override
        return CoachDecision(
            key: "adapt-\(a.id)",
            source: .adaptation(a),
            kind: .notice,
            eyebrow: eyebrowNotice,
            title: isOverride ? "You overrode the plan" : "The plan adapted",
            // The adapter's own `why` when it wrote one, else the
            // plain-English summary the endpoint composes. Never a
            // fabricated line (the reason the old AdaptationCard was
            // pulled from the hero on 2026-06-02).
            body: a.why ?? a.summary,
            stamp: a.when_iso.isEmpty ? nil : a.when_iso,
            actions: [],
            priority: priorityAdaptation
        )
    }

    // MARK: Phrasing helpers (mirrors decision-cards.ts)

    /// "Today's" / "Tomorrow's" / "Thursday's".
    static func workoutDayLabel(_ iso: String, todayISO: String) -> String {
        if iso == todayISO { return "Today's" }
        guard let t = isoDate(todayISO), let w = isoDate(iso) else { return "That day's" }
        let days = Int((w.timeIntervalSince(t) / 86400).rounded())
        if days == 1 { return "Tomorrow's" }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "EEEE"
        return "\(f.string(from: w))'s"
    }

    /// The concrete change, phrased once and reused in title and button.
    static func workoutActionPhrase(_ p: WorkoutProposal) -> String {
        switch p.actionKind {
        case "downgrade":
            return "swap to \(p.newType ?? "easy")"
        case "shave":
            let frac = p.shaveFraction ?? 0.15
            return "trim by \(Int((frac * 100).rounded()))%"
        case "reschedule":
            guard let nd = p.newDate, let d = isoDate(nd) else { return "reschedule" }
            let f = DateFormatter()
            f.locale = Locale(identifier: "en_US_POSIX")
            f.timeZone = TimeZone(identifier: "UTC")
            f.dateFormat = "EEE, MMM d"
            return "move to \(f.string(from: d))"
        case "field_test":
            return "run as a 30 minute field test"
        default:
            return "adjust"
        }
    }

    /// "AUG 14" · a notice's date, shown where a decision shows its pager.
    static func shortStamp(_ iso: String) -> String? {
        guard iso.count >= 10, let d = isoDate(String(iso.prefix(10))) else { return nil }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "MMM d"
        return f.string(from: d).uppercased()
    }

    /// Noon-UTC anchored so a date-only string never shifts a day.
    private static func isoDate(_ iso: String) -> Date? {
        guard iso.count >= 10 else { return nil }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss'Z'"
        return f.date(from: "\(iso.prefix(10))T12:00:00Z")
    }

    /// Recency test for an adaptation notice. Carries forward the exact
    /// normalisation the retired `TodayView.isWithinLast24h` did — Postgres
    /// hands back space-separated timestamps and sometimes no zone marker,
    /// and a notice that silently fails to parse is a notice the runner
    /// never sees.
    private static func isWithinRecency(_ iso: String, now: Date) -> Bool {
        guard !iso.isEmpty else { return false }
        let cleaned = iso.replacingOccurrences(of: " ", with: "T")
        let withFractional = ISO8601DateFormatter()
        withFractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        let parsed = withFractional.date(from: cleaned)
            ?? withFractional.date(from: cleaned + "Z")
            ?? plain.date(from: cleaned)
            ?? plain.date(from: cleaned + "Z")
        guard let d = parsed else { return false }
        return now.timeIntervalSince(d) <= adaptationRecencyHours * 3600
    }
}

// MARK: - View

/// Renders exactly ONE decision from the queue, with a pager when more
/// wait. The parent owns the queue and the dispatch; this view owns the
/// cursor, the busy state and the error line.
struct CoachDecisionCard: View {
    let queue: [CoachDecision]
    /// Perform the action. Returns true on success; the card resolves the
    /// item out of its local view only when the parent confirms.
    let onAct: (CoachDecision, CoachDecisionAction) async -> CoachDecisionOutcome
    /// Persist a notice dismissal (parent writes it to UserDefaults so it
    /// survives the next load within the recency window).
    let onDismiss: (CoachDecision) -> Void

    @State private var index: Int = 0
    /// Items answered or deferred this session · they drop out at once so
    /// the pager count stays honest without a reload.
    @State private var resolved: Set<String> = []
    @State private var busy: String? = nil
    /// The server's own sentence when it declined, or the generic line when the
    /// request never got a verdict. Nil when nothing has gone wrong.
    @State private var failure: String? = nil

    private var live: [CoachDecision] {
        queue.filter { !resolved.contains($0.key) }
    }

    var body: some View {
        if live.isEmpty {
            EmptyView()
        } else {
            let item = live[min(index, live.count - 1)]
            let accent = CoachDecisions.accent(item.kind)
            let pager = CoachDecisions.pagerLabel(index: min(index, live.count - 1),
                                                 total: live.count)
            card(item: item, accent: accent, pager: pager)
                .onChange(of: live.count) { _, newCount in
                    if index >= newCount { index = max(0, newCount - 1) }
                }
        }
    }

    @ViewBuilder
    private func card(item: CoachDecision, accent: Color, pager: String?) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text(item.eyebrow)
                    .font(.body(9, weight: .extraBold))
                    .tracking(1.5)
                    .foregroundStyle(accent)
                Spacer(minLength: 4)
                if let pager {
                    Button {
                        withAnimation(Theme.Motion.smooth) {
                            index = (index + 1) % max(1, live.count)
                        }
                    } label: {
                        Text(pager)
                            .font(.body(9, weight: .extraBold))
                            .tracking(1.2)
                            .foregroundStyle(accent)
                    }
                    .buttonStyle(.plain)
                } else if item.kind == .notice,
                          let s = item.stamp,
                          let label = CoachDecisions.shortStamp(s) {
                    Text(label)
                        .font(.body(9, weight: .extraBold))
                        .tracking(1.2)
                        .foregroundStyle(Theme.txt.opacity(0.45))
                }
            }

            Text(item.title)
                .font(.body(13.5, weight: .extraBold))
                .foregroundStyle(Theme.txt)
                .fixedSize(horizontal: false, vertical: true)

            if !item.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Text(item.body)
                    .font(.body(11.5, weight: .medium))
                    .foregroundStyle(Theme.txt.opacity(0.82))
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let failure {
                Text(failure)
                    .font(.body(11, weight: .semibold))
                    .foregroundStyle(Theme.overText)
                    .fixedSize(horizontal: false, vertical: true)
            }

            actionRow(item: item, accent: accent)
                .padding(.top, 2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rCard, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.rCard, style: .continuous)
                .stroke(accent.opacity(0.35), lineWidth: 1)
        )
        // The kind's accent as a left rule · the web card's borderLeftColor,
        // rendered the way iOS draws a rule inside a rounded card.
        .overlay(alignment: .leading) {
            Capsule()
                .fill(accent)
                .frame(width: 3)
                .padding(.vertical, 12)
                .padding(.leading, 1)
        }
    }

    @ViewBuilder
    private func actionRow(item: CoachDecision, accent: Color) -> some View {
        // FlowRow-free: two short buttons plus the quiet trailing verb fit
        // one line at every dynamic-type size we support because the labels
        // are fixed-length caps strings.
        VStack(alignment: .leading, spacing: 8) {
            ForEach(item.actions) { a in
                Button {
                    act(item, a)
                } label: {
                    HStack(spacing: 7) {
                        if busy == a.label {
                            ProgressView()
                                .controlSize(.mini)
                                .tint(a.role == .accept ? Theme.bg : Theme.txt)
                        }
                        Text(busy == a.label ? a.busyLabel : a.label)
                            .font(.body(11, weight: .extraBold))
                            .tracking(0.8)
                            .lineLimit(1)
                            .minimumScaleFactor(0.75)
                    }
                    .foregroundStyle(a.role == .accept ? Theme.bg : Theme.txt)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 9)
                    .background(
                        a.role == .accept ? AnyShapeStyle(accent) : AnyShapeStyle(Theme.Glass.fill),
                        in: Capsule()
                    )
                    .overlay {
                        if a.role != .accept {
                            Capsule().stroke(Theme.Glass.line, lineWidth: 1)
                        }
                    }
                }
                .buttonStyle(.plain)
                .disabled(busy != nil)
            }

            // A decision is answered, not swept away · DECIDE LATER defers
            // it for the session without resolving the row server-side.
            // A notice is FYI, so it gets a real, persisted dismiss.
            Button {
                if item.kind == .decision {
                    withAnimation(Theme.Motion.smooth) { _ = resolved.insert(item.key) }
                } else {
                    onDismiss(item)
                    withAnimation(Theme.Motion.smooth) { _ = resolved.insert(item.key) }
                }
            } label: {
                Text(item.kind == .decision ? "DECIDE LATER" : "DISMISS")
                    .font(.body(10, weight: .extraBold))
                    .tracking(1.0)
                    .foregroundStyle(Theme.txt.opacity(0.45))
            }
            .buttonStyle(.plain)
            .disabled(busy != nil)
        }
    }

    private func act(_ item: CoachDecision, _ action: CoachDecisionAction) {
        busy = action.label
        failure = nil
        Task {
            let outcome = await onAct(item, action)
            await MainActor.run {
                busy = nil
                switch outcome {
                case .done:
                    failure = nil
                    withAnimation(Theme.Motion.smooth) { _ = resolved.insert(item.key) }
                case .failed:
                    failure = "Could not save. Check your connection and try again."
                case .refused(let why):
                    // The card STAYS. A refusal is information about the
                    // runner's training, not a dead end to be swept away, and
                    // the row it belongs to is still the true state of things.
                    failure = why
                }
            }
        }
    }
}
