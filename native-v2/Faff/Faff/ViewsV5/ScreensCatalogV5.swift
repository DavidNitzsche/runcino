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
        let ids = Set(["5a", "5b", "5c", "6a", "6a-longest", "6a-refusal",
                       "7a", "8a", "8c", "11a", "13a", "14a", "15a", "16a",
                       "17a", "18a-slower", "18a-faster", "19a", "19a-refused",
                       "22a", "23a", "not-yet", "system"])
        return ProcessInfo.processInfo.arguments.first(where: ids.contains)
    }

    private var entries: [Entry] {
        [
            Entry(id: "5a", title: "Today · before the run", sub: "The day's prescription") {
                AnyView(TodayBeforeV5(model: .sampleBeforeRun,
                                      accountName: "Jamie Rowe",
                                      accountWeekLine: "Week 6 of 16",
                                      accountRows: TodayBeforeV5Sample.accountRows,
                                      calendarWeeks: TodayBeforeV5Sample.calendarWeeks))
            },
            Entry(id: "5b", title: "Today · after the run", sub: "Asked against ran") {
                AnyView(TodayAfterV5(model: TodayAfterV5Samples.outdoor,
                                     onOpenAccount: {}, onLogEffort: { _ in },
                                     onFlagNiggle: { _ in }, onOpenInjuryFlare: {},
                                     onChangeShoe: {}, onRowAction: { _ in }, onPushStrava: {}))
            },
            Entry(id: "5c", title: "Today · after a treadmill run", sub: "On the belt, no route card") {
                AnyView(TodayAfterV5(model: TodayAfterV5Samples.treadmill,
                                     onOpenAccount: {}, onLogEffort: { _ in },
                                     onFlagNiggle: { _ in }, onOpenInjuryFlare: {},
                                     onChangeShoe: {}, onRowAction: { _ in }, onPushStrava: {}))
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
            Entry(id: "11a", title: "Sick", sub: "Not an injury") {
                AnyView(SickFlareV5(model: .sampleV5))
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
            Entry(id: "17a", title: "Today changed overnight", sub: "Three domains converged") {
                AnyView(TodayChangedV5(panel: TodayChangedV5Sample.panel,
                                       convergence: TodayChangedV5Sample.convergedAndMoved))
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
        ]
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

#Preview { ScreensCatalogV5() }
