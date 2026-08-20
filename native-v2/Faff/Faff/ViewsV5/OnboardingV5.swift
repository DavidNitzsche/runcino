//
//  OnboardingV5.swift
//  faff.run iPhone · screen 9a, "Onboarding — day one".
//
//  No shell at all — there is no plan yet to navigate to, so no tab bar and
//  no RUN pill. A five-step flow with a progress-dot row:
//
//      welcome → goal → fitness → availability → reveal
//
//  This file does not fetch and does not call the network. It collects the
//  runner's answers locally (there is nothing on the server yet to seed
//  from) and hands the finished set to `onSubmit` once, when the runner
//  taps "Write the plan" at the end of the availability step. The caller
//  does the actual writes and returns either the day-one prescription to
//  show on the reveal step, or a refusal.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE PAYLOAD SPLIT · why `onSubmit` takes ONE model but two endpoints exist
//
//  `OnboardingV5Answers` below is deliberately one flat struct, not two,
//  because the runner experiences one submit — but its doc comments name
//  which server write each field belongs to, read directly off
//  `API.completeOnboarding(payload:)` / `web-v2/app/api/onboarding/complete/
//  route.ts` and `API.patchSettings(_:)` / `web-v2/app/api/settings/route.ts`:
//
//    goal + fitness fields  → POST /api/onboarding/complete
//        distance, date, time, weeklyMi, weeklyFreq-shaped evidence,
//        ttDistance/ttTime, histAvg/histLong, raceHistory · all present on
//        that route today.
//
//    availability fields    → NOT the onboarding payload. Per this screen's
//        brief: "the availability fields go through settings, not through
//        the onboarding payload." `longRunDay` and `phoneStart` land
//        cleanly on `/api/settings` (`long_run_day`, `phone_run_enabled`
//        are both in that route's own `ALLOWED` set today). `daysPerWeek`
//        is murkier — the existing native Settings screen edits "Days per
//        week" through `/api/profile`'s `weekly_frequency`
//        (`SettingsView.swift`'s `SettingField(key: "weekly_frequency",
//        endpoint: .profile, planShaping: true)`), not through
//        `/api/settings` at all. `API.patchSettings(_:)` is the function
//        this screen's brief names explicitly, so that mismatch is flagged
//        here rather than silently resolved: whoever wires the real
//        `onSubmit` should confirm which endpoint owns "days per week"
//        before shipping, not copy this comment's guess.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE FOUR RULES, AS THEY LAND HERE
//
//  1 · A MODELLED NUMBER MUST NEVER LOOK MEASURED. Day one has no measured
//      evidence at all — every number on the reveal poster came from what
//      the runner just typed, not from a run that happened. So
//      `OnboardingV5DayOne.dose` is a `FaffValue`, and the caller has no way
//      to hand this screen a bare `String` for it. "Day one is precisely
//      when everything is modelled" — see the reveal poster below.
//
//  2 · ONE SIGNAL NEVER CHANGES A SESSION. Not reachable here — there is no
//      prior session to change on day one.
//
//  3 · A REFUSAL IS A CORRECT ANSWER, NOT AN EMPTY STATE. A goal the engine
//      will not build toward (a distance it does not plan, a date too
//      close) comes back from `onSubmit` as `.refused(reason:)`, not as a
//      thrown error and not as a client-side validation message this screen
//      invented. It renders as `Alert` — no confirm button — on the
//      availability step, where the submit happened, and does not advance
//      to the reveal step.
//
//  4 · COACH VOICE. Day one is exactly where an app is tempted to cheer.
//      The copy here is the prototype's own, verbatim, and it does not
//      raise its voice.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHAT WAS NOT BUILT, AND WHY
//
//  · No client-side validation on the goal/fitness fields (empty distance,
//    malformed goal time, a race date in the past). The engine is the one
//    source of truth for whether an answer is workable — see Rule 3 above —
//    so this screen sends whatever was typed and lets `onSubmit`'s result
//    say yes or no, rather than pre-empting the engine with rules of its
//    own it has no citation for.
//
//  · The 26px step headline size ("The goal", "Where fitness stands", "What
//    fits your week", "Day one") is not one of `TypeScaleV5`'s named
//    registers (76/56/44/38 display · 28-104 value · 17/15 body · 14/13/12
//    label — the exact list the README's "Design tokens" section states).
//    It is the prototype's own literal, repeated across all four of this
//    screen's mid-flow headlines, so it is real and not a typo — but it
//    is not in the register the README enumerates. `GalleryV5.swift`
//    hits the identical gap independently and also falls back to the bare
//    literal `26`. Flagged in this file's delivery report rather than
//    silently added to `TypeScaleV5`, since this screen does not touch
//    `DesignV5/`.
//

import SwiftUI

// MARK: - Fitness evidence mode

/// The five mutually-exclusive ways a runner can tell the coach where
/// fitness stands. Exactly one relevant follow-up field per mode — see
/// `fitnessFollowUp` below. Verbatim from the prototype's `ONBOARD_MODES`.
enum OnboardingV5FitnessMode: String, CaseIterable, Identifiable {
    case recent, effort, consistent, timeoff, new

    var id: String { rawValue }

    var label: String {
        switch self {
        case .recent:     return "I have a recent race"
        case .effort:      return "I know my hard-effort pace"
        case .consistent: return "I have been training without racing"
        case .timeoff:    return "I am coming back from time off"
        case .new:        return "I am new to structured training"
        }
    }

    var sub: String {
        switch self {
        case .recent:     return "A time from the last 12 months reads best"
        case .effort:      return "A pace you can hold for 20 minutes, honestly"
        case .consistent: return "Consistent weeks, no time trial"
        case .timeoff:    return "Fitness has to be rebuilt, not assumed"
        case .new:        return "The habit comes before the pace"
        }
    }
}

// MARK: - What the runner answered

/// Everything collected across the five steps. See this file's header for
/// which server write each group belongs to.
struct OnboardingV5Answers: Equatable {

    // MARK: Step 1 · goal → completeOnboarding: distance / date / time
    var distance: String = "marathon"        // "5k" | "10k" | "half" | "marathon" | "none"
    var raceDate: Date? = nil
    var goalTime: String = ""                // free text, e.g. "3:30:00"

    // MARK: Step 2 · fitness → completeOnboarding's Step-1b evidence fields
    var fitnessMode: OnboardingV5FitnessMode = .recent
    /// `.recent` → a self-reported PR. Closest server shape is a
    /// `raceHistory` entry (distance/timeSec/whenRaced); this screen
    /// collects distance + time only, exactly what the prototype asks.
    var recentRaceDistance: String = ""
    var recentRaceTime: String = ""
    /// `.effort` → not a field the current route models explicitly. Sent
    /// through as evidence for whoever builds the real submit.
    var effortPace: String = ""
    /// `.consistent` → `weeklyMi` on the onboarding route.
    var weeklyMi: Int = 24
    /// `.timeoff` → free text; the route has no dedicated timeoff fields
    /// today, so these ride along as evidence rather than a typed column.
    var offWeeks: String = ""
    var offWeeklyMi: String = ""

    // MARK: Step 3 · availability → settings, NOT the onboarding payload
    var daysPerWeek: Int = 5
    var longRunDay: String = "sun"           // "fri" | "sat" | "sun"
    var phoneStart: Bool = true
}

// MARK: - What the engine answered back

/// Day one's prescription, exactly as the reveal poster shows it. Built by
/// the caller from whatever the plan-generation step returns — there is no
/// measured evidence yet, so `dose` always carries a basis, never a bare
/// number.
struct OnboardingV5DayOne: Equatable {
    /// "Base begins today" — names the phase, not a place. This screen has
    /// no place yet.
    let phaseLine: String
    let dayState: V5.DayState
    /// The display-face session type, e.g. "Easy".
    let sessionType: String
    /// The dose. Day one is entirely self-reported fitness — there is no
    /// race result and no logged run behind it yet — so this is `.modelled`
    /// by construction; there is no honest way to mark it `.measured`.
    let dose: FaffValue
    let coachLine: String
}

/// What `onSubmit` hands back. See Rule 3 in the file header: a refusal is
/// content, not a thrown error, and this screen never invents one on its
/// own.
enum OnboardingV5Outcome {
    case success(OnboardingV5DayOne)
    /// The engine's own reason — a distance it does not plan, a date too
    /// close, a runway that cannot carry it. Rendered as `Alert`, no
    /// confirm button.
    case refused(reason: String)
}

// MARK: - The screen

struct OnboardingV5: View {
    /// Fires once, when the runner finishes availability and taps "Write
    /// the plan". This view owns no network client — see the file header.
    let onSubmit: (OnboardingV5Answers) async -> OnboardingV5Outcome
    /// "See today", the reveal step's one way onward. Leaves onboarding.
    let onSeeToday: () -> Void

    @State private var step: Int
    @State private var answers: OnboardingV5Answers
    @State private var submitting = false
    /// Set only by a `.refused` outcome. Rendered inline on the
    /// availability step, where the submit happened — never advances past
    /// it.
    @State private var refusal: String? = nil
    @State private var dayOne: OnboardingV5DayOne?

    private let stepCount = 5
    /// The prototype's own literal for this screen's mid-flow headlines.
    /// See the file header — not one of `TypeScaleV5`'s named registers.
    private let stepHeadline: CGFloat = 26

    init(onSubmit: @escaping (OnboardingV5Answers) async -> OnboardingV5Outcome,
         onSeeToday: @escaping () -> Void,
         initialStep: Int = 0,
         initialAnswers: OnboardingV5Answers = OnboardingV5Answers(),
         initialDayOne: OnboardingV5DayOne? = nil) {
        self.onSubmit = onSubmit
        self.onSeeToday = onSeeToday
        _step = State(initialValue: initialStep)
        _answers = State(initialValue: initialAnswers)
        _dayOne = State(initialValue: initialDayOne)
    }

    var body: some View {
        ZStack {
            V5.surfacePage.ignoresSafeArea()

            VStack(spacing: 0) {
                progressDots
                    .padding(.horizontal, V5.S.gutter)
                    .padding(.top, V5.S.s24)

                Group {
                    switch step {
                    case 0: welcomeStep
                    case 1: goalStep
                    case 2: fitnessStep
                    case 3: availabilityStep
                    default: revealStep
                    }
                }
                .id(step)
                .transition(.opacity)
            }
        }
        .animation(V5.Motion.fill, value: step)
        .preferredColorScheme(.dark)
    }

    // MARK: - Progress dots

    private var progressDots: some View {
        HStack(spacing: V5.S.s6) {
            ForEach(0..<stepCount, id: \.self) { i in
                Capsule()
                    .fill(i <= step ? V5.signal : V5.materialControl)
                    .frame(height: 4)
                    .frame(maxWidth: .infinity)
            }
        }
    }

    // MARK: - Navigation

    private func goBack() {
        refusal = nil
        withAnimation(V5.Motion.fill) { step = max(step - 1, 0) }
    }

    private func goNext() {
        guard step < stepCount - 1 else { return }
        if step == 3 {
            Task { await submit() }
        } else {
            withAnimation(V5.Motion.fill) { step += 1 }
        }
    }

    private func submit() async {
        refusal = nil
        submitting = true
        let outcome = await onSubmit(answers)
        submitting = false
        switch outcome {
        case .success(let day):
            dayOne = day
            withAnimation(V5.Motion.fill) { step = 4 }
        case .refused(let reason):
            refusal = reason
        }
    }

    // MARK: - Step 0 · welcome

    private var welcomeStep: some View {
        OnboardingStepScaffold {
            VStack(alignment: .leading, spacing: V5.S.s16) {
                VStack(alignment: .leading, spacing: V5.S.s10) {
                    Text("Let\u{2019}s write the plan")
                        .font(.faffDisplay(TypeScaleV5.display38))
                        .textCase(.uppercase)
                        .foregroundStyle(V5.textPrimary)
                    Text("A few questions, then a real prescription for tomorrow. Nothing here is permanent.")
                        .font(.faffText(TypeScaleV5.body15))
                        .foregroundStyle(V5.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.top, V5.S.s40)

                Spacer(minLength: V5.S.s24)

                FaffButton("Start", variant: .primary, size: .lg, action: goNext)
            }
        }
    }

    // MARK: - Step 1 · goal

    private static let distanceOptions: [(key: String, label: String)] = [
        ("5k", "5k"), ("10k", "10k"), ("half", "Half marathon"),
        ("marathon", "Marathon"), ("none", "No race yet"),
    ]

    private var goalStep: some View {
        OnboardingStepScaffold {
            VStack(alignment: .leading, spacing: V5.S.s20) {
                stepHeadlineText("The goal")

                FaffSelect(
                    label: "Distance",
                    value: Self.label(for: answers.distance, in: Self.distanceOptions),
                    options: Self.distanceOptions.map(\.label),
                    onChange: { answers.distance = Self.key(for: $0, in: Self.distanceOptions) }
                )

                VStack(alignment: .leading, spacing: V5.S.s8) {
                    GoalDateField(date: $answers.raceDate)
                    Text("Leave it blank if you have not entered yet.")
                        .font(.faffText(TypeScaleV5.label13))
                        .foregroundStyle(V5.textQuiet)
                        .fixedSize(horizontal: false, vertical: true)
                }

                FaffInput(
                    label: "Goal time",
                    text: $answers.goalTime,
                    placeholder: "e.g. 3:30:00",
                    helper: "Optional. The coach can set one later from your fitness alone."
                )

                Spacer(minLength: V5.S.s24)
                backContinueRow(continueLabel: "Continue")
            }
        }
    }

    // MARK: - Step 2 · fitness

    private var fitnessStep: some View {
        OnboardingStepScaffold {
            VStack(alignment: .leading, spacing: V5.S.s16) {
                stepHeadlineText("Where fitness stands")

                VStack(spacing: V5.S.s10) {
                    ForEach(OnboardingV5FitnessMode.allCases) { mode in
                        FaffRadio(
                            label: mode.label,
                            sub: mode.sub,
                            checked: answers.fitnessMode == mode,
                            onChange: { answers.fitnessMode = mode }
                        )
                    }
                }

                fitnessFollowUp

                Spacer(minLength: V5.S.s24)
                backContinueRow(continueLabel: "Continue")
            }
        }
    }

    @ViewBuilder
    private var fitnessFollowUp: some View {
        switch answers.fitnessMode {
        case .recent:
            VStack(alignment: .leading, spacing: V5.S.s12) {
                FaffInput(label: "Race distance", text: $answers.recentRaceDistance,
                          placeholder: "Half marathon")
                FaffInput(label: "Finish time", text: $answers.recentRaceTime,
                          placeholder: "1:38:12")
            }
        case .effort:
            FaffInput(label: "Pace for 20 minutes hard", text: $answers.effortPace,
                      placeholder: "7:10 /mi", unit: "/mi")
        case .consistent:
            FaffStepper(label: "Typical weekly mileage", value: $answers.weeklyMi, range: 10...70)
        case .timeoff:
            VStack(alignment: .leading, spacing: V5.S.s12) {
                FaffInput(label: "Weeks off", text: $answers.offWeeks, keyboard: .numberPad)
                FaffInput(label: "Weekly mileage before the break", text: $answers.offWeeklyMi,
                          keyboard: .numberPad)
            }
        case .new:
            CoachSay(text: "The first weeks build the habit before the pace.", size: .sm)
        }
    }

    // MARK: - Step 3 · availability

    private static let longDayOptions: [(key: String, label: String)] = [
        ("fri", "Friday"), ("sat", "Saturday"), ("sun", "Sunday"),
    ]

    private var daysHelper: String {
        answers.daysPerWeek >= 6
            ? "Six or more and the coach holds at least three easy days."
            : "Five is enough for almost every goal."
    }

    private var phoneStartSub: String {
        answers.phoneStart
            ? "The RUN button starts every session"
            : "Your watch starts every run instead"
    }

    private var availabilityStep: some View {
        OnboardingStepScaffold {
            VStack(alignment: .leading, spacing: V5.S.s20) {
                stepHeadlineText("What fits your week")

                FaffStepper(label: "Days per week", value: $answers.daysPerWeek, range: 2...7,
                            helper: daysHelper)

                FaffSelect(
                    label: "Long run day",
                    value: Self.label(for: answers.longRunDay, in: Self.longDayOptions),
                    options: Self.longDayOptions.map(\.label),
                    onChange: { answers.longRunDay = Self.key(for: $0, in: Self.longDayOptions) }
                )

                FaffSwitch(label: "Start sessions from this phone", sub: phoneStartSub,
                           isOn: $answers.phoneStart)

                if let refusal {
                    Alert(text: refusal, tone: .attention)
                }

                Spacer(minLength: V5.S.s24)
                HStack(spacing: V5.S.s8) {
                    FaffButton("Back", variant: .ghost, size: .lg, full: false,
                               enabled: !submitting, action: goBack)
                    FaffButton(submitting ? "Writing the plan\u{2026}" : "Write the plan",
                               variant: .primary, size: .lg, enabled: !submitting, action: goNext)
                }
            }
        }
    }

    // MARK: - Step 4 · reveal

    private var revealStep: some View {
        OnboardingStepScaffold {
            VStack(alignment: .leading, spacing: V5.S.s20) {
                stepHeadlineText("Day one")

                if let dayOne {
                    OnboardingRevealPanel(day: dayOne)
                    CoachSay(text: dayOne.coachLine, size: .md)
                }

                Spacer(minLength: V5.S.s24)
                FaffButton("See today", variant: .primary, size: .lg, action: onSeeToday)
            }
        }
    }

    // MARK: - Shared bits

    private func stepHeadlineText(_ text: String) -> some View {
        Text(text)
            .font(.faffDisplay(stepHeadline))
            .textCase(.uppercase)
            .foregroundStyle(V5.textPrimary)
    }

    private func backContinueRow(continueLabel: String) -> some View {
        HStack(spacing: V5.S.s8) {
            FaffButton("Back", variant: .ghost, size: .lg, full: false, action: goBack)
            FaffButton(continueLabel, variant: .primary, size: .lg, action: goNext)
        }
    }

    private static func label(for key: String, in options: [(key: String, label: String)]) -> String {
        options.first(where: { $0.key == key })?.label ?? key
    }

    private static func key(for label: String, in options: [(key: String, label: String)]) -> String {
        options.first(where: { $0.label == label })?.key ?? label
    }
}

// MARK: - Step scaffold
//
// Mirrors the prototype's own `flex-direction:column;gap:…;flex:1` column: a
// group of fields, then a spacer, then a button row pinned toward the bottom
// of the available space when the content is short (welcome, reveal) and a
// normal scroll when it is not (fitness's follow-up fields under a small
// device + keyboard).

private struct OnboardingStepScaffold<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        GeometryReader { geo in
            ScrollView {
                content()
                    .frame(minHeight: geo.size.height, alignment: .top)
                    .padding(.horizontal, V5.S.gutter)
                    .padding(.top, V5.S.s24)
                    .padding(.bottom, V5.S.s24)
            }
            .scrollIndicators(.hidden)
        }
    }
}

// MARK: - Race date field
//
// "Expand in place. Never a full-screen picker, never a wheel." A compact
// `DatePicker` reads as a wheel on iOS (`.wheel` style is a literal spinning
// wheel and `.compact`'s popover is a system sheet neither one this design
// allows), so this expands the same way `FaffSelect` does — the app's one
// picker interaction — into a `.graphical` calendar grid, which is a grid
// tap target, not a wheel and not a new screen.

private struct GoalDateField: View {
    @Binding var date: Date?
    @State private var open = false

    private static let range: ClosedRange<Date> = {
        let cal = Calendar.current
        let lo = cal.date(byAdding: .day, value: 1, to: Date()) ?? Date()
        let hi = cal.date(byAdding: .year, value: 2, to: Date()) ?? Date()
        return lo...hi
    }()

    private var display: String {
        guard let date else { return "" }
        let f = DateFormatter()
        f.dateStyle = .medium
        return f.string(from: date)
    }

    var body: some View {
        ExpandingRow(
            label: "Race date",
            value: date != nil ? .measured(display) : nil,
            question: "Race date",
            isExpanded: $open
        ) {
            VStack(alignment: .leading, spacing: V5.S.s10) {
                DatePicker(
                    "", selection: Binding(get: { date ?? Self.range.lowerBound },
                                           set: { date = $0 }),
                    in: Self.range, displayedComponents: .date
                )
                .datePickerStyle(.graphical)
                .labelsHidden()
                .tint(V5.signal)

                if date != nil {
                    FaffButton("Clear", variant: .ghost, size: .md, full: false) {
                        date = nil
                    }
                }
            }
        }
    }
}

// MARK: - The reveal poster
//
// "A mini version of the Today gradient poster showing day one's
// prescription" — the same ramp + grain machinery `DayPanel` paints with,
// at 9a's own smaller register. NOT `DayPanel` itself: the prototype's
// markup for this panel is a plain `border-radius:22px` block sitting mid-
// flow (kicker 13px, type 44px, dose 22px — smaller than Today's 56/28),
// not the shell's full-bleed, bottom-only-rounded, status-bar-reaching
// panel — there is no place yet on day one, just a preview of one.

private struct OnboardingRevealPanel: View {
    let day: OnboardingV5DayOne

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(day.phaseLine)
                .font(.faffText(TypeScaleV5.label13))
                .foregroundStyle(V5.OnPanel.secondary)
            Text(day.sessionType)
                .font(.faffDisplay(44))
                .textCase(.uppercase)
                .foregroundStyle(V5.OnPanel.primary)
            day.dose.text(.faffText(22, weight: .semibold), color: V5.OnPanel.primary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(V5.S.s20)
        .background {
            V5Ramp.gradient(day.dayState).v5Grain()
        }
        .clipShape(RoundedRectangle(cornerRadius: V5.R.r22, style: .continuous))
    }
}

// MARK: - Preview sample data
//
// Lifted from the prototype's own `_script-data.js` (`ONBOARD_MODES`, the
// `onboard.weeklyMi` default of 24, the reveal step's literal copy).

extension OnboardingV5Answers {
    static let sampleV5 = OnboardingV5Answers(
        distance: "marathon",
        raceDate: Calendar.current.date(byAdding: .weekOfYear, value: 16, to: Date()),
        goalTime: "3:30:00",
        fitnessMode: .recent,
        recentRaceDistance: "Half marathon",
        recentRaceTime: "1:38:12",
        weeklyMi: 24,
        daysPerWeek: 5,
        longRunDay: "sun",
        phoneStart: true
    )
}

extension OnboardingV5DayOne {
    static let sampleV5 = OnboardingV5DayOne(
        phaseLine: "Base begins today",
        dayState: .easy,
        sessionType: "Easy",
        dose: .modelled("4 mi"),
        coachLine: "Four easy miles to get the legs moving \u{00B7} the real work begins once the habit does."
    )
}

// MARK: - Previews

#Preview("9a · welcome") {
    OnboardingV5(onSubmit: { _ in .success(.sampleV5) }, onSeeToday: {})
}

#Preview("9a · goal") {
    OnboardingV5(onSubmit: { _ in .success(.sampleV5) }, onSeeToday: {},
                 initialStep: 1, initialAnswers: .sampleV5)
}

#Preview("9a · fitness") {
    OnboardingV5(onSubmit: { _ in .success(.sampleV5) }, onSeeToday: {},
                 initialStep: 2, initialAnswers: .sampleV5)
}

#Preview("9a · availability") {
    OnboardingV5(onSubmit: { _ in .success(.sampleV5) }, onSeeToday: {},
                 initialStep: 3, initialAnswers: .sampleV5)
}

#Preview("9a · reveal") {
    OnboardingV5(onSubmit: { _ in .success(.sampleV5) }, onSeeToday: {},
                 initialStep: 4, initialAnswers: .sampleV5, initialDayOne: .sampleV5)
}
