//
//  SickV5.swift
//  faff.run iPhone · Job 1 — the sick flow, in the v5 language.
//
//  ─────────────────────────────────────────────────────────────────────────
//  HOW SICK DIFFERS FROM INJURY (read before touching this file)
//
//  `grep -rn -i "sick" ViewsV5/` returned nothing before this file: the
//  backend (`GET/POST/DELETE /api/sick`, `POST /api/sick/recovery`) and the
//  legacy toolkit sheet (`Components/Toolkit/F_Sheets.swift`,
//  `SymptomReportSheet`'s Sick tab) both work; the v5 phone had no way in.
//
//  Backend shape, concretely — NOT the same table, NOT the same fields:
//
//    Injury (`runner_injuries`, `glance.activeInjury`, v5 state
//    `injury_flare`) — a diagnosed musculoskeletal issue. `site` (a body
//    part), `severity` (minor/moderate/major), `start_date`,
//    `expected_return_date`. Check-in is a one-shot note
//    (better/same/worse, `action: checkin_*`) that does not itself clear
//    the flare; clearing happens when `expected_return_date` passes and
//    `returnAvailable` unlocks the walk-run ladder (19a).
//
//    Sick (`sick_episodes`, `glance.activeSick`, v5 state `sick`) — systemic
//    illness. `symptoms` (a string ARRAY of codes: head_cold | chest |
//    fever | gi | aches | fatigue | voice | other), `has_fever` (a
//    denormalized bool, not derived from the symptoms array server-side —
//    this view derives it client-side the same way the legacy sheet did:
//    `hasFever = symptoms.contains("fever")`), `started` (today | yesterday
//    | few_days | week_plus — a RELATIVE window, not a date). Check-in is a
//    daily TREND (`POST /api/sick/recovery`, body `{ today: better | same |
//    worse | recovered }`) — `recovered` clears the episode server-side by
//    itself; there is no separate ladder screen the way injury has one.
//
//  The legacy `SymptomReportSheet.submitSick()` call this file does NOT
//  reuse: it posted human-label strings from its own six-item list ("Sore
//  throat", "Cough", "Fatigue", "Congestion", "Fever", "Body aches") under
//  `symptoms`, which don't match the backend's eight-code vocabulary at
//  all, and it sent `started` as an ISO date string where the route
//  requires one of the four relative-window enum values. `API.postSick`
//  (`API+Toolkit.swift`) has been given a
//  `started` parameter (defaulting to `"today"` so the legacy call site
//  still compiles unchanged) so this file can pass the real enum value;
//  everything below uses the backend's own vocabulary, not the legacy
//  sheet's copy.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHAT THIS FILE BUILDS
//
//  `SickFlareV5` — the ACTIVE state, the closest drawn analogue being 13a
//  (injury flare): a quiet, no-gradient panel ("we read it, the answer is
//  not today" — rule three), the verdict, what was reported, and the daily
//  trend check-in. Wired as a new `V5TodayState.sick` case, sibling to
//  `.injuryFlare`, checked second in the route (an injury takes the screen
//  over a concurrent sick day — see the route's own comment).
//
//  `SickReportRowV5` — the REPORTING entry point, "expand-in-place, off
//  Today" exactly as specified: one row, embedded directly in
//  `TodayBeforeV5` and `TodayAfterV5` (both editable files — this needed no
//  change to the forbidden hosts beyond wiring the write, see this file's
//  companion report), that expands to a symptom multi-select, a "started"
//  single-select, and a submit button. Posting flips Today's own state to
//  `sick` on the next load, which is what actually shows `SickFlareV5` —
//  this row does not navigate anywhere itself.
//
//  RULE FOUR, concretely: the verdict never scolds ("you should have rested
//  sooner") — it states the pause as a fact, the way injury's copy does.
//

import SwiftUI

// MARK: - Active state · closest analogue 13a

struct SickFlareV5: View {
    let model: V5Sick
    var onOpenAccount: () -> Void = {}
    /// A check-in row was tapped — the caller posts the trend
    /// (`POST /api/sick/recovery`) and reloads. This view does not persist
    /// anything itself.
    var onLogTrend: (V5Row) -> Void = { _ in }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
                DayPanel(fill: .quiet) {
                    header
                    VStack(alignment: .leading, spacing: V5.S.s2) {
                        Text(model.since)
                            .font(.faffText(TypeScaleV5.label13))
                            .foregroundStyle(V5.textSecondary)
                        Text("Not today")
                            .faffDisplayV5(TypeScaleV5.display44)
                            .foregroundStyle(V5.textPrimary)
                    }
                }

                CoachSay(text: model.verdict, size: .md)

                if !model.symptoms.isEmpty {
                    ListGroup(header: "What's going on") {
                        ListRow(label: model.symptoms.joined(separator: ", "),
                                sub: model.hasFever ? "Fever" : nil)
                    }
                }

                VStack(alignment: .leading, spacing: V5.S.inGroup) {
                    V5SectionLabel(text: "How's it going today")
                    ListGroup {
                        ForEach(model.checkIn) { row in
                            ListRow(label: row.label, sub: row.sub, onTap: { onLogTrend(row) })
                        }
                    }
                }
            }
            .padding(.horizontal, V5.S.gutter)
            .padding(.bottom, V5.S.s24)
        }
        .background(V5.surfacePage)
        .scrollIndicators(.hidden)
    }

    /// The same small "Today" + account-button row every quiet-panel state
    /// screen opens with (13a/15a). The row stays local — `PlaceHeaderRow` is
    /// private to `StateScreensV5.swift` — but the disc is the kit's.
    private var header: some View {
        HStack(alignment: .center, spacing: V5.S.s8) {
            Text("Today")
                .font(.faffDisplay(20))
                .textCase(.uppercase)
                .tracking(20 * 0.02)
                .foregroundStyle(V5.textPrimary)
            Spacer(minLength: V5.S.s8)
            HeaderDiscV5(glyph: .initials("JR"),
                         label: "Account and settings",
                         fill: .quiet,
                         action: onOpenAccount)
        }
    }
}

// MARK: - Report entry point · expand-in-place, off Today

/// One row, embeddable on any Today variant. Expands to the symptom
/// picker; submitting calls back with the backend's own vocabulary
/// (`symptoms` codes, `started` enum) so the host can `POST /api/sick`
/// verbatim.
struct SickReportRowV5: View {
    var onReport: (_ symptoms: [String], _ started: String, _ hasFever: Bool) -> Void = { _, _, _ in }

    @State private var expanded = false
    @State private var selectedSymptoms: Set<String> = []
    @State private var selectedStarted: String = "today"
    @State private var submitted = false

    /// The backend's own eight-code vocabulary (`app/api/sick/route.ts`'s
    /// header comment). Order matches the legacy sheet's rough grouping —
    /// respiratory/systemic first, catch-all last.
    private static let symptomOptions: [(code: String, label: String)] = [
        ("head_cold", "Head cold"),
        ("chest", "Chest"),
        ("fever", "Fever"),
        ("gi", "Upset stomach"),
        ("aches", "Body aches"),
        ("fatigue", "Fatigue"),
        ("voice", "Lost voice"),
        ("other", "Something else"),
    ]

    /// The backend's relative-window enum (`started`) — never a date.
    private static let startedOptions: [(code: String, label: String)] = [
        ("today", "Today"),
        ("yesterday", "Yesterday"),
        ("few_days", "A few days"),
        ("week_plus", "A week or more"),
    ]

    var body: some View {
        ListGroup {
            ExpandingRow(
                label: submitted ? "Reported" : "Not feeling right",
                sub: submitted ? "Logged. Today rests." : "Report symptoms and pause today",
                question: "What's going on",
                isExpanded: $expanded
            ) {
                if !submitted { form }
            }
        }
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: V5.S.s16) {
            VStack(alignment: .leading, spacing: V5.S.s6) {
                V5SectionLabel(text: "Symptoms", size: TypeScaleV5.label12)
                VStack(spacing: 0) {
                    ForEach(Self.symptomOptions, id: \.code) { opt in
                        symptomToggle(opt)
                    }
                }
                .background(V5.materialTile, in: RoundedRectangle(cornerRadius: V5.R.r16, style: .continuous))
            }

            VStack(alignment: .leading, spacing: V5.S.s6) {
                V5SectionLabel(text: "Started", size: TypeScaleV5.label12)
                HStack(spacing: V5.S.s8) {
                    ForEach(Self.startedOptions, id: \.code) { opt in
                        startedChip(opt)
                    }
                }
            }

            FaffButton("Report it", variant: .primary, size: .md,
                       enabled: !selectedSymptoms.isEmpty,
                       disabledReason: "Pick at least one symptom \u{b7} it decides how long the plan waits.") {
                onReport(Array(selectedSymptoms), selectedStarted, selectedSymptoms.contains("fever"))
                submitted = true
                withAnimation(V5.Motion.expand) { expanded = false }
            }
        }
    }

    private func symptomToggle(_ opt: (code: String, label: String)) -> some View {
        let checked = selectedSymptoms.contains(opt.code)
        return Button {
            if checked { selectedSymptoms.remove(opt.code) } else { selectedSymptoms.insert(opt.code) }
        } label: {
            HStack(spacing: V5.S.s12) {
                ZStack {
                    Circle().fill(V5.materialTileRaised).frame(width: 20, height: 20)
                    if checked { Circle().fill(V5.signal).frame(width: 10, height: 10) }
                }
                Text(opt.label)
                    .font(.faffText(15, weight: .medium))
                    .foregroundStyle(V5.textPrimary)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, V5.S.tilePad)
            .frame(minHeight: 46)
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(V5PressStyle())
    }

    private func startedChip(_ opt: (code: String, label: String)) -> some View {
        let selected = selectedStarted == opt.code
        return Button {
            selectedStarted = opt.code
        } label: {
            Text(opt.label)
                .font(.faffText(13, weight: .semibold))
                .foregroundStyle(selected ? V5.actionPrimaryText : V5.textSecondary)
                .padding(.horizontal, V5.S.s14x)
                .frame(height: 34)
                .background(selected ? V5.signal : V5.materialTileRaised, in: Capsule())
                .contentShape(Capsule())
        }
        .buttonStyle(V5PressStyle())
    }
}

// MARK: - Previews

private func decode<T: Decodable>(_ type: T.Type, _ json: String) -> T {
    do {
        return try JSONDecoder().decode(T.self, from: Data(json.utf8))
    } catch {
        fatalError("SickV5 sample failed to decode \(T.self): \(error)")
    }
}

extension V5Sick {
    static let sampleV5: V5Sick = decode(V5Sick.self, """
    {
      "symptoms": ["Head cold", "Fatigue"],
      "hasFever": false,
      "since": "Flagged 2 days ago",
      "verdict": "Rest, not run. Whatever this is gets a real day off before anything asks more of you.",
      "checkIn": [
        { "id": "better", "label": "Better today", "sub": "Still resting, trending the right way", "value": null, "action": "trend_better" },
        { "id": "same", "label": "About the same", "sub": "Another day off, then reassess", "value": null, "action": "trend_same" },
        { "id": "worse", "label": "Worse", "sub": "Worth a call with someone who can look at it", "value": null, "action": "trend_worse" },
        { "id": "recovered", "label": "I'm better, let's run", "sub": "Clears this and hands today back to the plan", "value": null, "action": "trend_recovered" }
      ]
    }
    """)
}

#Preview("Sick · active") {
    SickFlareV5(model: .sampleV5)
        .preferredColorScheme(.dark)
}

#Preview("Sick · report row, collapsed") {
    ScrollView {
        SickReportRowV5()
            .padding(.horizontal, V5.S.gutter)
            .padding(.top, V5.S.s40)
    }
    .background(V5.surfacePage)
    .preferredColorScheme(.dark)
}
