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
//    appears in the tab bar everywhere. It writes `phone_run_enabled`
//    straight through `API.patchSettings(_:)`, then invalidates
//    `SettingsCache.shared` so the bar updates without a relaunch — see
//    `Util/SettingsCache.swift`. Nothing else in this file talks to the
//    network directly.
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
struct SettingsV5Model {
    var longRunDay: String
    var longRunDayOptions: [String]
    var daysPerWeek: Int
    var daysPerWeekRange: ClosedRange<Int> = 2...7
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
         onBack: (() -> Void)? = nil) {
        self.model = model
        self.onSetLongRunDay = onSetLongRunDay
        self.onSetDaysPerWeek = onSetDaysPerWeek
        self.onToggleSessionReminders = onToggleSessionReminders
        self.onToggleWeeklySummary = onToggleWeeklySummary
        self.onSetUnits = onSetUnits
        self.onToggleStrava = onToggleStrava
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

                // The prototype's content band: `padding:0 16px 32px;gap:24px`.
                VStack(alignment: .leading, spacing: V5.S.s24) {
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
            }
        }
        .background(V5.surfacePage)
        .scrollIndicators(.hidden)
        // The phone-run switch is the ONE control here that talks to the
        // network directly — see the file header.
        .onChange(of: phoneRunEnabled) { _, newValue in
            Task {
                try? await API.patchSettings(["phone_run_enabled": newValue])
                await SettingsCache.shared.invalidate()
            }
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
        .onChange(of: sessionReminders) { _, newValue in onToggleSessionReminders(newValue) }
        .onChange(of: weeklySummary) { _, newValue in onToggleWeeklySummary(newValue) }
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
