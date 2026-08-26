//
//  SettingsV5.swift
//  faff.run iPhone · screen 10a.
//
//  AppBar + plain black background — the shell exception, same as race
//  detail and shoes: no gradient panel, because there is no "place" here.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THIS VIEW DOES NOT FETCH
//
//  It takes the current settings and a set of write closures. Two writes are
//  the exception, hard-wired rather than passed in, because the design
//  contract names them explicitly:
//
//  · The phone-run switch is THE single source of truth for whether RUN
//    appears in the tab bar everywhere, so it reports outward through
//    `onSetPhoneRun` and the composition root does the write. It used to
//    write `phone_run_enabled` straight through `API.patchSettings(_:)` and
//    invalidate `SettingsCache.shared`, on the belief that the bar would
//    then update without a relaunch. It did not: the pill reads
//    `PhoneRunGate.enabled`, a `@Published` only written by the gate's own
//    `refresh()`, and invalidating the cache does not republish it. The root
//    already refreshes the gate on every other settings patch, so routing
//    this switch the same way is what actually makes it the source of truth
//    the design describes. The direct write survives as the nil fallback so
//    a preview still toggles; nothing else here talks to the network.
//
//  · Sign out calls `SessionHygiene.signOut()` and nothing else. That
//    function already posts `.faffGateReset` itself, so there is no
//    "onSignOut" closure to wire — adding one would just be a second path to
//    the same door.
//
//  Every other control keeps a small local `@State` mirror seeded from the
//  model so the row updates instantly, and reports the change outward
//  through its own closure — the composition root owns the real PATCH and
//  the real field name for those.
//

import SwiftUI

// MARK: - Model

/// What this screen needs to render. The composition root assembles this
/// from `UserSettings` + `ProfileFields`; this file does not know either
/// shape.
struct SettingsV5Model: Equatable {
    var longRunDay: String
    var longRunDayOptions: [String]
    var daysPerWeek: Int
    /// 2026-08-25 · was `2...7`. Seven is not a weekly frequency this product
    /// has: `lib/onboarding/state.ts` types `WeeklyFrequency` as `0…6`,
    /// `/api/onboarding/complete` rejects anything outside that set, and the
    /// plan builder assigns a rest day BEFORE it applies the frequency cap, so
    /// a seven can only ever come out as six sessions and a rest day.
    ///
    /// The onboarding host already knew, and clamped: `min(max(daysPerWeek,
    /// 0), 6)`. This screen did not — it writes through `/api/profile`, whose
    /// validator is `intIn(1, 7)` — so one control offered seven and silently
    /// gave six, and the other offered seven and stored a seven the type
    /// system says is not a frequency. Same column, two answers.
    ///
    /// Offering a number the engine cannot deliver is the choice to remove.
    /// Nobody currently holds a 7 (checked against production, read-only:
    /// stored values are 0, 2, 3, 4, 5 and null), so nothing regresses.
    /// The `/api/profile` range disagreement is reported, not fixed here.
    var daysPerWeekRange: ClosedRange<Int> = 2...6
    var phoneRunEnabled: Bool
    var sessionReminders: Bool
    var weeklySummary: Bool
    var units: String
    var unitsOptions: [String]
    var stravaConnected: Bool
    var email: String
}

// MARK: - Screen

struct SettingsV5: View {
    let model: SettingsV5Model

    let onSetLongRunDay: (String) -> Void
    let onSetDaysPerWeek: (Int) -> Void
    let onToggleSessionReminders: (Bool) -> Void
    let onToggleWeeklySummary: (Bool) -> Void
    let onSetUnits: (String) -> Void
    let onToggleStrava: () -> Void
    /// The phone-run switch, routed OUT to the composition root when the
    /// caller supplies it. See the file header: invalidating `SettingsCache`
    /// alone does not republish `PhoneRunGate.enabled`, so the RUN pill kept
    /// its old state until the next launch. The root's own `patch(_:)` does
    /// the invalidate AND the gate refresh, which is what makes this switch
    /// the single source of truth the design says it is. Nil falls back to
    /// the direct write, so a preview still toggles.
    var onSetPhoneRun: ((Bool) -> Void)? = nil
    var onBack: (() -> Void)? = nil

    @State private var longRunDay: String
    @State private var daysPerWeek: Int
    @State private var phoneRunEnabled: Bool
    @State private var sessionReminders: Bool
    @State private var weeklySummary: Bool
    @State private var units: String

    init(model: SettingsV5Model,
         onSetLongRunDay: @escaping (String) -> Void,
         onSetDaysPerWeek: @escaping (Int) -> Void,
         onToggleSessionReminders: @escaping (Bool) -> Void,
         onToggleWeeklySummary: @escaping (Bool) -> Void,
         onSetUnits: @escaping (String) -> Void,
         onToggleStrava: @escaping () -> Void,
         onSetPhoneRun: ((Bool) -> Void)? = nil,
         onBack: (() -> Void)? = nil) {
        self.model = model
        self.onSetLongRunDay = onSetLongRunDay
        self.onSetDaysPerWeek = onSetDaysPerWeek
        self.onToggleSessionReminders = onToggleSessionReminders
        self.onToggleWeeklySummary = onToggleWeeklySummary
        self.onSetUnits = onSetUnits
        self.onToggleStrava = onToggleStrava
        self.onSetPhoneRun = onSetPhoneRun
        self.onBack = onBack
        _longRunDay = State(initialValue: model.longRunDay)
        _daysPerWeek = State(initialValue: model.daysPerWeek)
        _phoneRunEnabled = State(initialValue: model.phoneRunEnabled)
        _sessionReminders = State(initialValue: model.sessionReminders)
        _weeklySummary = State(initialValue: model.weeklySummary)
        _units = State(initialValue: model.units)
    }

    private var phoneRunSub: String {
        phoneRunEnabled ? "RUN sits in the bottom bar" : "Your watch starts every session"
    }

    /// The weekly summary fires on the runner's own long-run evening — the
    /// cron reads `user_settings.long_run_day` and sums the week that ends
    /// that day (`app/api/cron/notifications/route.ts`). This line used to say
    /// "Sunday evening" to everyone, so a runner who had just chosen Saturday
    /// two rows above was told the wrong night by the row underneath. The
    /// backend was right; the sentence was the only thing that was wrong.
    private var weeklySummarySub: String {
        "\(longRunDay) evening, after the long run"
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                AppBar(title: "Settings", onBack: onBack)

                // The prototype's content band specified `gap:24px` here; unified
                // onto the app's one "between top-level sections" rhythm instead —
                // see `betweenGroups`'s own doc comment.
                VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
                    trainingSection
                    coachSection
                    notificationsSection
                    unitsSection
                    dataSection

                    FaffButton("Sign out", variant: .destructive, size: .md, full: true) {
                        Task { await SessionHygiene.signOut() }
                    }
                }
                .padding(.horizontal, V5.S.gutter)
                .padding(.bottom, V5.S.s32)
                // A vertical page must never pan sideways — see `v5PageWidth`.
                .v5PageWidth()
            }
        }
        .background(V5.surfacePage)
        .scrollIndicators(.hidden)
        // The phone-run switch is the ONE control here that talks to the
        // network directly — see the file header.
        .onChange(of: phoneRunEnabled) { _, newValue in
            // Only write a value the server does not already have. Without
            // this the revert below (a failed write putting the local state
            // back) would itself look like a toggle and write again.
            guard newValue != model.phoneRunEnabled else { return }
            if let onSetPhoneRun {
                onSetPhoneRun(newValue)
            } else {
                Task {
                    try? await API.patchSettings(["phone_run_enabled": newValue])
                    await SettingsCache.shared.invalidate()
                }
            }
        }
        // 2026-08-25 · THE SCREEN HAS TO FOLLOW THE SERVER BACK.
        //
        // Every control here writes through the host, and every one of the
        // host's writers ends `await load()` — which rebuilds `model` from
        // `SettingsCache` so a write that did not land shows its real value
        // again. It could not. `State(initialValue:)` runs on the FIRST build
        // of a view only, and `SettingsHostV5` keeps this view's identity
        // across every reload, so all six locals below were seeded once at
        // first render and never looked at the model again. (The identical
        // trap is called out in `LiveRunTreadmillV5`, where a plan arriving
        // after the first build never reached the belt.)
        //
        // Both host writers are `_ = try? await`, so a PATCH that fails is
        // silent — and with the state frozen the screen went on showing the
        // runner's choice while the server kept the old one. Two of these are
        // `long_run_day` and `weekly_frequency`: the day the training week
        // ends, and how many times a week the engine writes a run. A runner
        // who believes they moved their long run to Saturday, on a server that
        // still says Sunday, gets a plan shaped against a week they think they
        // changed, with nothing on screen disagreeing.
        //
        // Following the model means a failed write now visibly reverts. That
        // is not the same as saying so, which the host should — noted in the
        // report — but a silent revert beats a silent lie.
        .onChange(of: model) { _, m in
            longRunDay = m.longRunDay
            daysPerWeek = m.daysPerWeek
            phoneRunEnabled = m.phoneRunEnabled
            sessionReminders = m.sessionReminders
            weeklySummary = m.weeklySummary
            units = m.units
        }
    }

    // MARK: Training

    private var trainingSection: some View {
        VStack(alignment: .leading, spacing: V5.S.s10) {
            V5SectionLabel(text: "Training").padding(.horizontal, V5.S.s4)
            VStack(alignment: .leading, spacing: V5.S.s16) {
                FaffSelect(label: "Long run day",
                           value: longRunDay,
                           options: model.longRunDayOptions,
                           onChange: { day in
                    longRunDay = day
                    onSetLongRunDay(day)
                })
                FaffStepper(label: "Days per week",
                            value: $daysPerWeek,
                            range: model.daysPerWeekRange,
                            onChange: onSetDaysPerWeek)
                FaffSwitch(label: "Start runs from this phone",
                           sub: phoneRunSub,
                           isOn: $phoneRunEnabled)
            }
            .padding(V5.S.tilePad)
            .background(V5.materialTile, in: RoundedRectangle(cornerRadius: V5.R.r22, style: .continuous))
        }
    }

    // MARK: Coach

    private var coachSection: some View {
        ListGroup(header: "Coach") {
            ListRow(label: "Coach voice", value: .measured("Honest, no cheerleading"))
        }
    }

    // MARK: Notifications

    private var notificationsSection: some View {
        VStack(alignment: .leading, spacing: V5.S.s10) {
            V5SectionLabel(text: "Notifications").padding(.horizontal, V5.S.s4)
            VStack(alignment: .leading, spacing: V5.S.s16) {
                // NAMES THE CATEGORY THAT ACTUALLY FIRES.
                //
                // This switch is `skip_recovery_enabled`, and that category is
                // enqueued by `POST /api/today/skip` for 07:15 the next
                // morning. There is no eve-of-quality notification anywhere in
                // the scheduler, so "one notification the evening before a
                // quality day" described something that has never been sent —
                // a switch for a thing that does not exist. Same correction
                // the legacy and web surfaces took on 2026-08-21.
                FaffSwitch(label: "Skipped-run check",
                           sub: "The morning after a skip \u{00B7} are you good for today",
                           isOn: $sessionReminders)
                FaffSwitch(label: "Weekly summary",
                           sub: weeklySummarySub,
                           isOn: $weeklySummary)
            }
            .padding(V5.S.tilePad)
            .background(V5.materialTile, in: RoundedRectangle(cornerRadius: V5.R.r22, style: .continuous))
        }
        // Same guard as the phone-run switch above · a revert is not a tap.
        .onChange(of: sessionReminders) { _, newValue in
            guard newValue != model.sessionReminders else { return }
            onToggleSessionReminders(newValue)
        }
        .onChange(of: weeklySummary) { _, newValue in
            guard newValue != model.weeklySummary else { return }
            onToggleWeeklySummary(newValue)
        }
    }

    // MARK: Units

    private var unitsSection: some View {
        VStack(alignment: .leading, spacing: V5.S.s10) {
            V5SectionLabel(text: "Units").padding(.horizontal, V5.S.s4)
            Tile {
                FaffSelect(label: "Distance",
                           value: units,
                           options: model.unitsOptions,
                           onChange: { u in
                    units = u
                    onSetUnits(u)
                })
            }
        }
    }

    // MARK: Data

    private var dataSection: some View {
        ListGroup(header: "Data", footer: "Your watch keeps recording either way.") {
            ListRow(label: "Strava",
                    sub: model.stravaConnected ? "Connected" : "Not connected",
                    value: .measured(model.stravaConnected ? "Connected" : "Not connected"),
                    onTap: onToggleStrava)
            ListRow(label: "Email", value: .measured(model.email))
        }
    }
}

// MARK: - Preview

#Preview("Settings · 10a") {
    SettingsV5(
        model: SettingsV5Model(
            longRunDay: "Sunday",
            longRunDayOptions: ["Friday", "Saturday", "Sunday"],
            daysPerWeek: 5,
            phoneRunEnabled: true,
            sessionReminders: true,
            weeklySummary: true,
            units: "Miles",
            unitsOptions: ["Miles", "Kilometres"],
            stravaConnected: true,
            email: "jamie@rowe.run"
        ),
        onSetLongRunDay: { _ in },
        onSetDaysPerWeek: { _ in },
        onToggleSessionReminders: { _ in },
        onToggleWeeklySummary: { _ in },
        onSetUnits: { _ in },
        onToggleStrava: {},
        onBack: {}
    )
    .preferredColorScheme(.dark)
}
