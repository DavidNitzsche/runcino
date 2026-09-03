//
//  ScreensCatalogV5.swift
//  faff.run iPhone · every v5 screen, on a device, with no server.
//
//  Each screen ships a sample built from the approved prototype's own data.
//  This puts them all behind one picker so the whole surface can be walked in
//  one pass — which is the only way to catch the things that are invisible
//  screen by screen: a panel that reads differently beside its neighbour, a
//  register that drifts, a refusal that has quietly grown an error's tone.
//
//      xcrun simctl launch <udid> run.faff.app -faffV5Screens
//
//  Sample-only. Nothing here touches the network, so it also works before the
//  v5 routes are deployed.
//

import SwiftUI

struct ScreensCatalogV5: View {
    private struct Entry: Identifiable {
        let id: String
        let title: String
        let sub: String
        let make: () -> AnyView
    }

    /// Deep link straight to one screen, so capturing a screenshot is one
    /// command rather than a sequence of taps:
    ///
    ///     xcrun simctl launch <udid> run.faff.app -faffV5Screens 7a
    ///
    /// Any argument that matches an entry id opens it on launch.
    @State private var showing: String? = ScreensCatalogV5.launchArgumentScreen

    static var launchArgumentScreen: String? {
        return ProcessInfo.processInfo.arguments.first(where: allIDs.contains)
    }

    /// Derived from `entries`, never hand-maintained. It used to be a literal
    /// `Set` written out beside the list, so adding an entry and forgetting
    /// the set produced a screen that was in the picker but NOT openable by
    /// `-faffV5Screens <id>` — the deep link silently did nothing. A second
    /// copy of a list is a second thing to forget.
    static var allIDs: Set<String> { Set(entries.map(\.id)).union(["system"]) }

    /// The ids IN ORDER, with duplicates intact — `allIDs` is a Set and so
    /// cannot show one. `CatalogSampleArithmeticTests` needs the list, not
    /// the set, to tell a duplicate from a unique id.
    static var entryIDsForTest: [String] { entries.map(\.id) }

    private var entries: [Entry] { Self.entries }

    private static var entries: [Entry] {
        var out: [Entry] = [
            Entry(id: "5a", title: "Today · before the run", sub: "The day's prescription") {
                AnyView(TodayBeforeV5(model: .sampleBeforeRun,
                                      accountName: "Jamie Rowe",
                                      accountWeekLine: "Week 6 of 16",
                                      accountRows: TodayBeforeV5Sample.accountRows,
                                      calendarWeeks: TodayBeforeV5Sample.calendarWeeks))
            },
            Entry(id: "5a-reps", title: "Today · rep session", sub: "PRERUN-1 · real 5×400 m off prod") {
                AnyView(TodayBeforeV5(model: .samplePreRun_tuneup,
                                      accountName: "Jamie Rowe",
                                      accountWeekLine: "Week 7 of 16",
                                      accountRows: TodayBeforeV5Sample.accountRows,
                                      calendarWeeks: TodayBeforeV5Sample.calendarWeeks))
            },
            Entry(id: "5a-hills", title: "Today · hill set", sub: "PRERUN-1 · by effort, no pace to state") {
                AnyView(TodayBeforeV5(model: .samplePreRun_hills,
                                      accountName: "Jamie Rowe",
                                      accountWeekLine: "Week 7 of 16",
                                      accountRows: TodayBeforeV5Sample.accountRows,
                                      calendarWeeks: TodayBeforeV5Sample.calendarWeeks))
            },
            Entry(id: "5a-long", title: "Today · long run", sub: "PRERUN-1 · finish is the session") {
                AnyView(TodayBeforeV5(model: .samplePreRun_longFinish,
                                      accountName: "Jamie Rowe",
                                      accountWeekLine: "Week 7 of 16",
                                      accountRows: TodayBeforeV5Sample.accountRows,
                                      calendarWeeks: TodayBeforeV5Sample.calendarWeeks))
            },
            Entry(id: "5a-race", title: "Today · race day", sub: "PRERUN-1 · the plan for going wrong") {
                AnyView(TodayBeforeV5(model: .samplePreRun_race,
                                      accountName: "Jamie Rowe",
                                      accountWeekLine: "Race week",
                                      accountRows: TodayBeforeV5Sample.accountRows,
                                      calendarWeeks: TodayBeforeV5Sample.calendarWeeks))
            },
            Entry(id: "5b", title: "Today · after the run", sub: "Asked against ran") {
                AnyView(TodayAfterV5(model: TodayAfterV5Samples.outdoor,
                                     onOpenAccount: {}, onLogEffort: { _ in },
                                     onFlagNiggle: { _ in }, onOpenInjuryFlare: {},
                                     onChangeShoe: {}, onPickShoe: { _ in }, onRowAction: { _ in }, onPushStrava: {}))
            },
            // Asked 5, ran 11. The case the table was built for and could not
            // describe until the Distance row landed.
            Entry(id: "5d", title: "Today · after a long overshoot", sub: "Asked 5 mi, ran 11") {
                AnyView(TodayAfterV5(model: TodayAfterV5Samples.overshot,
                                     onOpenAccount: {}, onLogEffort: { _ in },
                                     onFlagNiggle: { _ in }, onOpenInjuryFlare: {},
                                     onChangeShoe: {}, onPickShoe: { _ in }, onRowAction: { _ in }, onPushStrava: {}))
            },
            // THE POST-RUN BREAKDOWN, ON BOTH GRAINS AND ON ITS AWKWARD CASES.
            //
            // The section picks miles or sections from what the run was, so
            // one entry can only ever show half of it. These four also carry
            // the three ways the data is thinner than the table — no cadence
            // or climb, a missing reading, a trailing part-mile — which are
            // the cases where a table is easiest to make dishonest.
            // See `BreakdownV5Samples`.
            Entry(id: "5b-miles", title: "Today · mile by mile", sub: "Z1 opening, Z4 finish, part-mile tail") {
                AnyView(TodayAfterV5(model: BreakdownV5Samples.easy))
            },
            Entry(id: "5b-miles-thin", title: "Today · mile by mile, thin", sub: "Pace and heart rate, nothing else") {
                AnyView(TodayAfterV5(model: BreakdownV5Samples.easyThin))
            },
            Entry(id: "5b-miles-gaps", title: "Today · miles with no reading", sub: "Blank, never a neighbour's number") {
                AnyView(TodayAfterV5(model: BreakdownV5Samples.easyGaps))
            },
            Entry(id: "5b-sections", title: "Today · section by section", sub: "A session made of pieces") {
                AnyView(TodayAfterV5(model: BreakdownV5Samples.reps))
            },
            // ONE ENTRY PER RUN TYPE. The composition REMOVES rows, and the
            // only way to review a removal is to look at the screen it was
            // removed from. Every payload below carries all four readings; the
            // screen keeps what that kind of session earns. See
            // `PostRunShapeV5` for the argument behind each.
            Entry(id: "5b-recovery", title: "Today · recovery", sub: "No pace row, by doctrine") {
                AnyView(TodayAfterV5(model: BreakdownV5Samples.recovery))
            },
            Entry(id: "5b-long", title: "Today · long", sub: "Miles, and what happened late") {
                AnyView(TodayAfterV5(model: BreakdownV5Samples.long))
            },
            Entry(id: "5b-tempo", title: "Today · tempo", sub: "The block, not the whole run") {
                AnyView(TodayAfterV5(model: BreakdownV5Samples.tempo))
            },
            Entry(id: "5b-tuneup", title: "Today · race-week tune-up", sub: "Aggregates all suppressed") {
                AnyView(TodayAfterV5(model: BreakdownV5Samples.tuneUp))
            },
            Entry(id: "5b-race", title: "Today · race", sub: "The HR curve, not one average") {
                AnyView(TodayAfterV5(model: BreakdownV5Samples.race))
            },
            Entry(id: "5b-belt", title: "Today · treadmill", sub: "No route, no climb, no weather") {
                AnyView(TodayAfterV5(model: BreakdownV5Samples.treadmill))
            },
            Entry(id: "5c", title: "Today · after a treadmill run", sub: "On the belt, no route card") {
                AnyView(TodayAfterV5(model: TodayAfterV5Samples.treadmill,
                                     onOpenAccount: {}, onLogEffort: { _ in },
                                     onFlagNiggle: { _ in }, onOpenInjuryFlare: {},
                                     onChangeShoe: {}, onPickShoe: { _ in }, onRowAction: { _ in }, onPushStrava: {}))
            },
            // BLOCK — THE SECOND TAB — HAD NO ENTRY HERE UNTIL 2026-08-24.
            //
            // Same gap 8c is scolded for below, on a bigger screen: `BlockV5`
            // and its change-the-plan sheet had three `#Preview`s and nothing
            // else, and its samples were `fileprivate`, so the only way to look
            // at the app's second tab was the Xcode canvas. The two sheet
            // states below are the ones the design contract says are hardest
            // to get right — the longest realistic trade-off string (§6, which
            // must hold "without scrolling") and a refusal (which must not read
            // as an error).
            Entry(id: "6a", title: "Block", sub: "The shape of the whole block") {
                AnyView(BlockV5(model: .sample))
            },
            Entry(id: "6a-longest", title: "Change the plan · longest", sub: "Five clauses, six sentences") {
                AnyView(BlockV5(model: .sample,
                                previewStage: .proposed(.sampleAnotherRaceScenario,
                                                        .sampleAnotherRaceLongest)))
            },
            Entry(id: "6a-refusal", title: "Change the plan · refusal", sub: "A correct answer, not an error") {
                AnyView(BlockV5(model: .sample,
                                previewStage: .refused(.sampleTravelScenario,
                                                       .sampleTravelRefusal)))
            },
            Entry(id: "7a", title: "Races", sub: "Is the goal still real") {
                AnyView(RacesV5(model: RacesV5.sample))
            },
            Entry(id: "8a", title: "Race detail", sub: "AppBar and a plain list") {
                AnyView(RaceDetailV5(raceDetail: .v5Sample))
            },
            // THE NEW WORK WAS NEVER ADDED HERE, AND THAT IS HOW 8c SHIPPED
            // UNREACHABLE.
            //
            // `RaceJustFinishedV5` had no route, no host, no catalog entry and
            // not even a `#Preview`: it compiled, the build said SUCCEEDED, and
            // no runner or reviewer could get to it. A drawn screen with no way
            // in is indistinguishable from one that was never built.
            //
            // These three do not create a production path — 8c still needs a
            // real `V5TodayState` and a backend that says a race just landed.
            // They make the screens REVIEWABLE, which is the gap that let the
            // first one go unnoticed.
            Entry(id: "8c", title: "Race · twenty minutes after", sub: "Holds the number, refuses to promote it") {
                AnyView(RaceJustFinishedV5(model: .sampleV5))
            },
            Entry(id: "22a", title: "Past runs", sub: "The history, off Block") {
                AnyView(RunLogV5(log: RunLogV5Sample.log))
            },
            Entry(id: "23a", title: "Run detail", sub: "Splits, route, zones, what you decided") {
                AnyView(RunDetailV5(detail: RunDetailV5Sample.outdoor,
                                    recap: RunDetailV5Sample.recap))
            },
            // The rep session, on the real 2026-08-11 payload. A separate
            // entry rather than a change to 23a because the two are genuinely
            // different screens: an easy run has a shape and no reps, a
            // tune-up has reps and its mile chart is misleading on its own.
            // Both need looking at.
            Entry(id: "23b", title: "Run detail \u{00B7} reps", sub: "Rep by rep, and what the watch graded") {
                AnyView(RunDetailV5(detail: RunDetailV5Sample.intervals,
                                    recap: RunDetailV5Sample.intervalsRecap))
            },
            // A DECISION IS NOT A LAPSE, on a rep. The fourth rep is a stop
            // the watch offered and the runner took: no verdict, no dash
            // where a pace would be, and a sentence naming whose call it was.
            Entry(id: "23c", title: "Run detail \u{00B7} a rep you stopped", sub: "The offer taken, not a rep lost") {
                AnyView(RunDetailV5(detail: RunDetailV5Sample.intervalsWithSkip,
                                    recap: RunDetailV5Sample.intervalsRecap))
            },
            Entry(id: "13a", title: "Injury flare", sub: "Not today") {
                AnyView(InjuryFlareV5(model: .sampleV5))
            },
            Entry(id: "14a", title: "Week off", sub: "A zero week goes in the book") {
                AnyView(WeekOffV5(model: .sampleV5))
            },
            Entry(id: "15a", title: "Off-season", sub: "Silence, by design") {
                AnyView(OffSeasonV5(model: .sampleV5))
            },
            Entry(id: "16a", title: "Data outage", sub: "We could not read this") {
                AnyView(DataOutageV5(today: .sampleOutageV5, onRetry: {}))
            },
            Entry(id: "18a-slower", title: "Paces slower", sub: "Modelled · did this race count?") {
                AnyView(PacesMovedV5(paces: PacesMovedV5Sample.slower))
            },
            Entry(id: "18a-faster", title: "Paces faster · race", sub: "Hard evidence, one action") {
                AnyView(PacesMovedV5(paces: PacesMovedV5Sample.fasterRace))
            },
            Entry(id: "19a", title: "Return to running", sub: "Stage 3 of 8") {
                AnyView(ReturnToRunningV5(ret: ReturnToRunningV5Sample.stage3))
            },
            Entry(id: "19a-refused", title: "Return · clinician gated", sub: "A refusal, not a disabled button") {
                AnyView(ReturnToRunningV5(ret: ReturnToRunningV5Sample.refused))
            },
            Entry(id: "not-yet", title: "Not on the phone yet", sub: "A refusal, not a screen set") {
                AnyView(NotOnPhoneYetV5(reason: nil))
            },

            // ── Screens that had a #Preview and nothing else ──────────────
            //
            // Everything below was drawn, compiled, and unreachable on a
            // device. Settings, the shoe list, the add-a-race sheet, the
            // provisional and no-result race details, the run detail without
            // GPS, and SEVEN of the eight Races verdicts — the shapes the
            // design contract cares most about, because they are the ones
            // that decide whether a decision reads as a decision.
            Entry(id: "10a", title: "Settings", sub: "The switches, and what they own") {
                AnyView(SettingsV5(model: SettingsV5Model(
                    longRunDay: "Sunday",
                    longRunDayOptions: ["Friday", "Saturday", "Sunday"],
                    daysPerWeek: 5, phoneRunEnabled: true, sessionReminders: true,
                    weeklySummary: true, units: "Miles",
                    unitsOptions: ["Miles", "Kilometres"],
                    stravaConnected: true, email: "jamie@rowe.run"),
                    onSetLongRunDay: { _ in }, onSetDaysPerWeek: { _ in },
                    onToggleSessionReminders: { _ in }, onToggleWeeklySummary: { _ in },
                    onSetUnits: { _ in }, onToggleStrava: {}))
            },
            Entry(id: "11a", title: "Shoes", sub: "Mileage against a retirement point") {
                AnyView(ShoesV5(shoes: ShoesV5CatalogSample.shoes,
                                onWear: { _ in }, onRetire: { _ in },
                                onAddPair: { _, _, _, _ in }))
            },
            Entry(id: "20a", title: "Add a race", sub: "The sheet, on its own") {
                AnyView(AddRaceSheetCatalogHost())
            },
            Entry(id: "8b", title: "Race detail · provisional", sub: "Strava elapsed, not a result") {
                AnyView(RaceDetailV5(raceDetail: .v5SampleProvisional))
            },
            Entry(id: "8d", title: "Race detail · no result", sub: "Run, not yet locked in") {
                AnyView(RaceDetailV5(raceDetail: .v5SampleNoResult))
            },
            Entry(id: "8e", title: "Race detail · no goal time", sub: "No pace plan to draw") {
                AnyView(RaceDetailV5(raceDetail: .v5SampleNoGoal))
            },
            // 2026-08-25 · this was a SECOND `23b`. "Run detail · reps" holds
            // that id further up, so `-faffV5Screens 23b` opened the reps
            // screen and the treadmill one had no deep link at all — and
            // `allIDs` is a Set, which is why nothing noticed. The same file
            // already argues that a second copy of a list is a second thing
            // to forget; a second copy of an ID is the same bug in one line.
            Entry(id: "23d", title: "Run detail · no GPS", sub: "Treadmill, no route card") {
                AnyView(RunDetailV5(detail: RunDetailV5Sample.treadmill))
            },
            Entry(id: "sick", title: "Sick", sub: "Not an injury") {
                AnyView(SickFlareV5(model: .sampleV5))
            },
            Entry(id: "7a-behind", title: "Races · behind", sub: "The goal needs more than fitness shows") {
                AnyView(RacesV5(model: RacesV5Sample.decode("behind")))
            },
            Entry(id: "7a-stale", title: "Races · stale", sub: "Set before the flare") {
                AnyView(RacesV5(model: RacesV5Sample.decode("stale")))
            },
            Entry(id: "7a-injury", title: "Races · injury", sub: "A decision under a flare") {
                AnyView(RacesV5(model: RacesV5Sample.decode("injury")))
            },
            Entry(id: "7a-course", title: "Races · course changed", sub: "A fact, not a decision") {
                AnyView(RacesV5(model: RacesV5Sample.decode("course")))
            },
            Entry(id: "7a-lock", title: "Races · chip-time lock", sub: "A fact, not a decision") {
                AnyView(RacesV5(model: RacesV5Sample.decode("lock")))
            },
            Entry(id: "7a-two", title: "Races · two A races", sub: "A choice, not a verdict") {
                AnyView(RacesV5(model: RacesV5Sample.decode("races")))
            },
        ]

        // The live-run screens build their samples from DEBUG-only preview
        // helpers, so they are reachable in a debug build only. They are the
        // two screens a runner stares at for an hour at a time, which makes
        // them the last ones that should have been unreviewable.
        #if DEBUG
        out += [
            Entry(id: "12a", title: "Live run · outdoor", sub: "Mid-run, with heart") {
                AnyView(outdoorMidRunPreview())
            },
            Entry(id: "12a-noheart", title: "Live run · no heart source", sub: "A dash, not a zero") {
                AnyView(outdoorNoHeartPreview())
            },
            Entry(id: "12a-gps", title: "Live run · finding GPS", sub: "Before the first fix") {
                AnyView(outdoorFindingGpsPreview())
            },
            Entry(id: "12a-gap", title: "Live run · track has a gap", sub: "The line the phone did not see") {
                AnyView(outdoorGapPreview())
            },
            Entry(id: "12b", title: "Live run · treadmill", sub: "Speed and incline, no GPS") {
                AnyView(treadmillWithHeartPreview())
            },
            Entry(id: "12b-noheart", title: "Treadmill · no heart source", sub: "Foreground-only, no watch") {
                AnyView(treadmillNoHeartPreview())
            },
        ]
        #endif

        // 2026-08-25 · ONBOARDING, which nothing could open.
        //
        // `OnboardingV5` shipped with five `#Preview`s and no catalog entry,
        // so on a device the only way to reach it was to create an account —
        // which is the one thing an audit is told not to do. The result is
        // that the first five screens a new runner ever sees are the only
        // five in v5 that had been swept in TypeScript and never once looked
        // at on glass. `initialStep` and `initialAnswers` already exist for
        // exactly this; they just had no route in.
        //
        // `onSubmit` returns the sample rather than posting: the catalog is
        // sample-only ("Nothing here touches the network", per this file's
        // header), and an onboarding screen that signed somebody up would be
        // the single worst place to break that.
        out += [
            Entry(id: "9a", title: "Onboarding · welcome", sub: "Before anything is asked") {
                AnyView(OnboardingV5(onSubmit: { _ in .success(.sampleV5) }, onSeeToday: {}))
            },
            Entry(id: "9a-goal", title: "Onboarding · goal", sub: "Distance, date, target") {
                AnyView(OnboardingV5(onSubmit: { _ in .success(.sampleV5) }, onSeeToday: {},
                                     initialStep: 1, initialAnswers: .sampleV5))
            },
            Entry(id: "9a-fitness", title: "Onboarding · fitness", sub: "What the plan is built off") {
                AnyView(OnboardingV5(onSubmit: { _ in .success(.sampleV5) }, onSeeToday: {},
                                     initialStep: 2, initialAnswers: .sampleV5))
            },
            Entry(id: "9a-availability", title: "Onboarding · availability", sub: "Days, mileage, long-run day") {
                AnyView(OnboardingV5(onSubmit: { _ in .success(.sampleV5) }, onSeeToday: {},
                                     initialStep: 3, initialAnswers: .sampleV5))
            },
            Entry(id: "9a-reveal", title: "Onboarding · day one", sub: "The first session, modelled") {
                AnyView(OnboardingV5(onSubmit: { _ in .success(.sampleV5) }, onSeeToday: {},
                                     initialStep: 4, initialAnswers: .sampleV5,
                                     initialDayOne: .sampleV5))
            },
        ]

        return out
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
                    VStack(alignment: .leading, spacing: V5.S.s4) {
                        Text("faff v5")
                            .faffDisplayV5(TypeScaleV5.display44)
                            .foregroundStyle(V5.textPrimary)
                        Text("Every screen, from the prototype's own sample data.")
                            .font(.faffText(TypeScaleV5.body15))
                            .foregroundStyle(V5.textQuiet)
                    }

                    ListGroup(header: "Screens") {
                        ForEach(entries) { e in
                            ListRow(label: e.title, sub: e.sub,
                                    value: .measured(e.id),
                                    onTap: { showing = e.id })
                        }
                    }

                    ListGroup(header: "The system") {
                        ListRow(label: "Design system", sub: "Tokens, ramps, components, charts",
                                onTap: { showing = "system" })
                    }
                }
                .padding(.horizontal, V5.S.gutter)
                .padding(.vertical, V5.S.s24)
            }
            .background(V5.surfacePage)
            .scrollIndicators(.hidden)
        }
        .fullScreenCover(item: Binding(get: { showing.map(Showing.init) },
                                       set: { showing = $0?.id })) { s in
            ZStack(alignment: .topTrailing) {
                if s.id == "system" {
                    GalleryV5()
                } else if let e = entries.first(where: { $0.id == s.id }) {
                    e.make()
                }
                // Bottom-left: the top-right of every screen in this design
                // is a real control (calendar, avatar), and a catalog chrome
                // button sitting on top of one hides the thing being reviewed.
                Button("Close") { showing = nil }
                    .font(.faffText(TypeScaleV5.label13, weight: .semibold))
                    .foregroundStyle(V5.actionPrimaryText)
                    .padding(.horizontal, V5.S.s12)
                    .frame(height: 30)
                    .background(V5.materialAction, in: Capsule())
                    .padding(.leading, V5.S.gutter)
                    .padding(.bottom, V5.S.s24)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
            }
            .background(V5.surfacePage)
        }
        .preferredColorScheme(.dark)
    }

    private struct Showing: Identifiable { let id: String }
}

// MARK: - Samples the catalog owns
//
// Kept here rather than widening a `#Preview`'s inline literal, so the screens
// themselves stay untouched.

enum ShoesV5CatalogSample {
    /// One pair near its retirement point, one already past it, one barely
    /// worn, one retired — the four states the list has to tell apart.
    static let shoes: [Shoe] = [
        Shoe(id: 1, brand: "Saucony", model: "Endorphin Speed 4", color: nil,
             mileage: 214, mileage_cap: nil, shoe_type: "super", retire_at_mi: 250,
             run_types: nil, baseline_mi: nil, retired: false, preferred: true, notes: nil),
        Shoe(id: 2, brand: "ASICS", model: "Novablast 5", color: nil,
             mileage: 386, mileage_cap: nil, shoe_type: "daily_trainer", retire_at_mi: 400,
             run_types: nil, baseline_mi: nil, retired: false, preferred: false, notes: nil),
        Shoe(id: 3, brand: "Nike", model: "Vaporfly 3", color: nil,
             mileage: 58, mileage_cap: nil, shoe_type: "super", retire_at_mi: 250,
             run_types: nil, baseline_mi: nil, retired: false, preferred: false, notes: nil),
        Shoe(id: 4, brand: "Nike", model: "Pegasus 40", color: nil,
             mileage: 412, mileage_cap: nil, shoe_type: "daily_trainer", retire_at_mi: 400,
             run_types: nil, baseline_mi: nil, retired: true, preferred: false, notes: nil),
    ]
}

/// The add-a-race sheet is a sheet, so it needs a host to be looked at.
///
/// Mirrors `AddRaceHostV5` — `tall: true` and NO `title:` — rather than the
/// screen's own `#Preview`, which passes `title: "Add a race"` and so draws
/// the name twice: once as the screen's own 56pt "ADD A RACE" and again as
/// the sheet bar's "Add a race" underneath it. That is the 0821 rule "no
/// content is ever printed twice on one screen" broken in the review harness
/// rather than in the app, which is its own trap: it shows a reviewer a
/// defect the runner never sees, and hides the layout the runner does.
struct AddRaceSheetCatalogHost: View {
    @State private var open = true
    var body: some View {
        ZStack {
            V5.surfacePage.ignoresSafeArea()
            V5SheetHost(isPresented: $open, tall: true) {
                AddRaceV5()
            }
        }
    }
}

#Preview { ScreensCatalogV5() }
