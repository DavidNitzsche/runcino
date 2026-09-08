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
    /// SETTINGSPARTIAL-1 (2026-09-07 review) · WHICH OF THESE VALUES ARE REAL.
    ///
    /// Every field above has a default the host fills in when the wire says
    /// nothing. That default is correct for a runner who has no stored value
    /// and WRONG for a runner whose value we failed to read — and on screen
    /// the two are the same pixels. With `/api/settings` down and
    /// `/api/profile` up, a runner on kilometres was shown "Miles", and a
    /// runner whose long run is Saturday was shown "Sunday", in the same ink
    /// as a value that had actually been read.
    ///
    /// So the model carries which sources answered, and the rows behind a
    /// failed source render `UnavailableRow` instead of a value. Defaults to
    /// `.healthy`, which is what every preview and every whole load is.
    var health: SettingsSourceHealth = .healthy
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
    /// TRAVEL-1 · opens the travel-windows sheet. Routed out like every other
    /// control — the host owns the presentation, this view only reports the
    /// tap. Nil hides the row (previews without a host still render).
    var onOpenTravel: (() -> Void)? = nil
    /// V5PROPOSALSURFACE-1 · opens the decision history. Same posture as
    /// `onOpenTravel`: routed out, and nil hides the row so a bare preview
    /// never draws a dead entry.
    var onOpenDecisions: (() -> Void)? = nil
    var onBack: (() -> Void)? = nil
    /// SETTINGSPARTIAL-1 · retries the load behind the partial-failure
    /// banner. Same closure the full failure state's Retry runs. Nil drops
    /// the button (a preview has nothing to retry), never the sentence.
    var onRetry: (() -> Void)? = nil

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
         onOpenTravel: (() -> Void)? = nil,
         onOpenDecisions: (() -> Void)? = nil,
         onBack: (() -> Void)? = nil,
         onRetry: (() -> Void)? = nil) {
        self.model = model
        self.onRetry = onRetry
        self.onSetLongRunDay = onSetLongRunDay
        self.onSetDaysPerWeek = onSetDaysPerWeek
        self.onToggleSessionReminders = onToggleSessionReminders
        self.onToggleWeeklySummary = onToggleWeeklySummary
        self.onSetUnits = onSetUnits
        self.onToggleStrava = onToggleStrava
        self.onSetPhoneRun = onSetPhoneRun
        self.onOpenTravel = onOpenTravel
        self.onOpenDecisions = onOpenDecisions
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
        // SETTINGSPARTIAL-1 · the day comes from `/api/settings`, so this
        // sentence is gated on that read (Rule 16: a sentence asserting a
        // fact about a measurement is gated on that measurement). With
        // settings down, `longRunDay` holds the "sun" default and this line
        // would have told a Saturday runner "Sunday evening" — a fabricated
        // fact inside an otherwise honest partial screen.
        guard model.health.settings == nil else {
            return "The evening of your long run"
        }
        return "\(longRunDay) evening, after the long run"
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                AppBar(title: "Settings", onBack: onBack)

                // The prototype's content band specified `gap:24px` here; unified
                // onto the app's one "between top-level sections" rhythm instead —
                // see `betweenGroups`'s own doc comment.
                VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
                    // SETTINGSPARTIAL-1 · one source down, the rest up. The
                    // screen keeps everything that DID load and says, once,
                    // that some of it did not. Which rows are affected is
                    // said by the rows themselves, not restated here.
                    if let note = model.health.partialMessage {
                        ErrorNote(text: note, onRetry: onRetry)
                    }
                    trainingSection
                    travelSection
                    coachSection
                    notificationsSection
                    unitsSection
                    dataSection

                    FaffButton("Sign out", variant: .destructive, size: .md, full: true) {
                        Task { await SessionHygiene.signOut() }
                    }

                    // STAGE1-DIAG-1 · plain version/build text, useful on its
                    // own for a support conversation. Seven taps opens the
                    // internal request-diagnostics sheet. SETTINGSDIAG-1 ·
                    // extracted so the FAILURE state can host the identical
                    // affordance — it had none, which locked a runner out of
                    // diagnostics at the one moment they need them.
                    SettingsDiagnosticsFooter()
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
                    // SETTINGSWRITE-1 · the same gate the host's `applyWrite`
                    // applies, for the same reason: a PATCH that threw
                    // changed nothing on the server, so wiping the cached
                    // copy would replace a value we still hold with an
                    // "Unavailable" on the next read. This is the preview
                    // fallback and never runs inside the app, but it is the
                    // same footgun and a reader finding this line first
                    // should not learn the wrong pattern from it.
                    let landed = (try? await API.patchSettings(["phone_run_enabled": newValue])) != nil
                    if landed { await SettingsCache.shared.invalidate() }
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
                // SETTINGSPARTIAL-1 · this one tile draws from BOTH
                // endpoints, which is exactly why a per-section marker would
                // have been dishonest: with `/api/profile` down, "Long run
                // day" is still real and "Days per week" is not.
                if model.health.settings == nil {
                    FaffSelect(label: "Long run day",
                               value: longRunDay,
                               options: model.longRunDayOptions,
                               onChange: { day in
                        longRunDay = day
                        onSetLongRunDay(day)
                    })
                } else {
                    UnavailableRow(label: "Long run day")
                }
                if model.health.profile == nil {
                    FaffStepper(label: "Days per week",
                                value: $daysPerWeek,
                                range: model.daysPerWeekRange,
                                onChange: onSetDaysPerWeek)
                } else {
                    UnavailableRow(label: "Days per week")
                }
                if model.health.settings == nil {
                    FaffSwitch(label: "Start runs from this phone",
                               sub: phoneRunSub,
                               isOn: $phoneRunEnabled)
                } else {
                    UnavailableRow(label: "Start runs from this phone")
                }
            }
            .padding(V5.S.tilePad)
            .background(V5.materialTile, in: RoundedRectangle(cornerRadius: V5.R.r22, style: .continuous))
        }
    }

    // MARK: Travel

    /// TRAVEL-1 · the entry the owner asked for: "something the phone should
    /// surface". The sheet behind it lists windows and takes new ones; the
    /// plan keeps the runner running through them (easy-preferred days,
    /// quality on home days). Hidden when no host wired the closure, so a
    /// bare preview does not draw a dead row.
    @ViewBuilder
    private var travelSection: some View {
        if let onOpenTravel {
            ListGroup(header: "Travel") {
                ListRow(label: "Travel windows",
                        sub: "Tell the plan when you are away \u{b7} it keeps you running through it",
                        onTap: onOpenTravel)
            }
        }
    }

    // MARK: Coach

    private var coachSection: some View {
        ListGroup(header: "Coach") {
            ListRow(label: "Coach voice", value: .measured("Honest, no cheerleading"))
            // V5PROPOSALSURFACE-1 · the record. Seven proposals had been
            // raised against this runner's plan and he had never seen one.
            if let onOpenDecisions {
                ListRow(label: "Decisions",
                        sub: "Every change the coach has proposed, and what became of it",
                        onTap: onOpenDecisions)
            }
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
                // SETTINGSPARTIAL-1 · both switches read
                // `profile.notification_prefs`, and both defaulted to ON
                // when that read failed. A runner who had turned the weekly
                // summary off was shown it on.
                if model.health.prefs == nil {
                    FaffSwitch(label: "Skipped-run check",
                               sub: "The morning after a skip \u{00B7} are you good for today",
                               isOn: $sessionReminders)
                    FaffSwitch(label: "Weekly summary",
                               sub: weeklySummarySub,
                               isOn: $weeklySummary)
                } else {
                    UnavailableRow(label: "Skipped-run check")
                    UnavailableRow(label: "Weekly summary")
                }
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
                // SETTINGSPARTIAL-1 · `?? "mi"` is the reason this matters
                // most. A runner on kilometres, with /api/settings down, was
                // shown "Miles" in exactly the ink a real answer uses.
                if model.health.settings == nil {
                    FaffSelect(label: "Distance",
                               value: units,
                               options: model.unitsOptions,
                               onChange: { u in
                        units = u
                        onSetUnits(u)
                    })
                } else {
                    UnavailableRow(label: "Distance")
                }
            }
        }
    }

    // MARK: Data

    private var dataSection: some View {
        ListGroup(header: "Data", footer: "Your watch keeps recording either way.") {
            // Rule 17 · the connection state is ONE fact, said once. It used to
            // be passed as both `sub` and `value`, so the row rendered
            // "Strava / Not connected" above "Not connected" — the same two
            // words printed twice, six points apart, on one row.
            ListRow(label: "Strava",
                    value: .measured(model.stravaConnected ? "Connected" : "Not connected"),
                    onTap: onToggleStrava)
            // SETTINGSPARTIAL-1 · with /api/profile down this rendered
            // `?? ""` — an Email row with nothing beside it, which reads as
            // "faff has no email for you" rather than "we could not read it".
            // A blank is a claim too.
            if model.health.profile == nil {
                ListRow(label: "Email", value: .measured(model.email))
            } else {
                UnavailableRow(label: "Email", inGroup: true)
            }
        }
    }
}

// MARK: - SETTINGSPARTIAL-1 · a row whose source failed

/// What a row shows when the endpoint behind it did not answer.
///
/// It shows NO VALUE. That is the whole point: a control seeded from a
/// fallback default is pixel-identical to one seeded from the runner's real
/// setting, so the only honest rendering of "we could not read this" is to
/// decline to state it. Not editable either — writing a setting whose current
/// value we could not read is how a runner overwrites something they never
/// saw.
///
/// The fault mark is carried by the banner above, once. This row stays quiet
/// (`textQuiet`, the same ink every secondary value uses) rather than
/// repeating fault red per row, which would paint a two-endpoint outage as
/// six separate alarms.
struct UnavailableRow: View {
    let label: String
    /// `ListGroup` supplies its own tile; a bare `Tile`-hosted stack does not.
    var inGroup: Bool = false

    var body: some View {
        HStack(alignment: .center, spacing: V5.S.s12) {
            Text(label)
                .font(.faffText(16, weight: .medium))
                .foregroundStyle(V5.textQuiet)
            Spacer(minLength: V5.S.s8)
            Text("Unavailable")
                .font(.faffText(TypeScaleV5.body15))
                .foregroundStyle(V5.textQuiet)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, inGroup ? V5.S.tilePad : 0)
        .padding(.vertical, inGroup ? V5.S.s10 : 0)
        .frame(minHeight: inGroup ? 58 : 0)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(label), unavailable")
    }
}

// MARK: - SETTINGSDIAG-1 · the version footer, and the door behind it

/// STAGE1-DIAG-1's hidden seven-tap entry into `RequestDiagnosticsView`,
/// lifted out of `SettingsV5` so the host's FAILURE state can render the
/// identical affordance.
///
/// It lived only inside the loaded screen, and the failure state is an
/// `AppBar` plus an `ErrorNote` with no footer at all — so a runner staring
/// at "Can't reach faff" could reach neither the request log nor the build
/// number, at the one moment both are worth having. Settings is the only door
/// to this tool in the whole app.
struct SettingsDiagnosticsFooter: View {
    @State private var tapCount = 0
    @State private var showDiagnostics = false

    private var appVersionString: String {
        let short = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?"
        return "faff.run \(short) (\(build))"
    }

    var body: some View {
        Text(appVersionString)
            .font(.faffText(TypeScaleV5.label12))
            .foregroundStyle(V5.textQuiet)
            .frame(maxWidth: .infinity)
            .padding(.top, V5.S.s8)
            .contentShape(Rectangle())
            .onTapGesture {
                tapCount += 1
                if tapCount >= 7 {
                    tapCount = 0
                    showDiagnostics = true
                }
            }
            .sheet(isPresented: $showDiagnostics) {
                RequestDiagnosticsView()
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
