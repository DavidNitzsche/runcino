//
//  HostsV5.swift
//  faff.run iPhone · the composition root.
//
//  The screens are pure: each takes a decoded model and renders it. This file
//  is where they meet the network, the cache, and each other — one host per
//  place, and one root that wires the three places to the shell.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE ONE DECISION EVERY HOST MAKES
//
//  A screen can be in exactly four situations, and three of them are content:
//
//    the payload said something      → render it
//    the payload said "no"           → still render it. A refusal is content.
//    we have an old payload          → render it. Old is not wrong.
//    we have nothing and cannot read → THIS is the outage screen, and only this.
//
//  `V5Surface` draws that line (see SurfaceStoreV5). A host never invents a
//  fourth case, and never shows an error where the engine gave an answer.
//
//  Today has a fifth, which is not a failure either: `not_on_phone_yet`. A
//  coached runner, a just-run runner, or a distance goal with no race all work
//  end to end on the server and simply have no phone screens yet. That is a
//  refusal with a reason, not three blank screens.
//

import SwiftUI

// MARK: - Today

struct TodayHostV5: View {
    @StateObject private var surface = V5Surfaces.today()
    @Binding var path: [V5Route]
    /// The runner's own name, for the account sheet.
    var accountName: String = ""

    var body: some View {
        Group {
            if let model = surface.model {
                content(model)
            } else if surface.isOutage {
                // Nothing cached and the read failed. The design's own outage
                // screen needs a Today shell to sit in, and we do not have one,
                // so this is the honest floor: the note and the reserved space.
                ScrollView {
                    OutageBodyV5(onRetry: { Task { await surface.load() } })
                        .padding(.horizontal, V5.S.gutter)
                        .padding(.top, V5.S.s40)
                }
                .background(V5.surfacePage)
            } else {
                // Cold start. Reserve the shape the real content will take.
                coldStart
            }
        }
        // The launch gate holds the splash until every destination says it is
        // painted. "Painted" includes a surface that resolved to its outage
        // state — an app that never lifts its splash because the network is
        // down is worse than one that shows the outage screen honestly.
        .task {
            await surface.load()
            NotificationCenter.default.post(name: .faffSurfaceReady, object: "today")
        }
        .refreshable { await surface.load() }
    }

    @ViewBuilder
    private func content(_ model: V5Today) -> some View {
        switch model.state {
        case .notOnPhoneYet:
            NotOnPhoneYetV5(reason: model.notOnPhoneYet)

        case .changedOvernight:
            // RULE TWO. The story only exists when three independent domains
            // converged. If the payload cannot show that, this is an ordinary
            // Today and the app says nothing about a change.
            if let changed = model.changed, changed.namesAConvergence {
                TodayChangedV5(panel: model.panel, convergence: changed)
            } else {
                TodayBeforeV5(model: model, accountName: accountName,
                              accountWeekLine: model.panel.weekLine ?? "",
                              accountRows: [], calendarWeeks: calendarWeeks(model))
            }

        case .injuryFlare:
            if let injury = model.injury {
                InjuryFlareV5(model: injury,
                              onReturnToRunning: { path.append(.returnToRunning) })
            } else {
                TodayBeforeV5(model: model, accountName: accountName,
                              accountWeekLine: model.panel.weekLine ?? "",
                              accountRows: [], calendarWeeks: calendarWeeks(model))
            }

        case .weekOff:
            if let off = model.weekOff {
                WeekOffV5(model: off)
            } else {
                TodayBeforeV5(model: model, accountName: accountName,
                              accountWeekLine: model.panel.weekLine ?? "",
                              accountRows: [], calendarWeeks: calendarWeeks(model))
            }

        case .offSeason:
            if let off = model.offSeason {
                OffSeasonV5(model: off)
            } else {
                NotOnPhoneYetV5(reason: nil)
            }

        case .afterRun:
            TodayAfterV5(model: model,
                         onOpenAccount: {},
                         onLogEffort: { rpe in Task { await logEffort(model, rpe) } },
                         onFlagNiggle: { part in Task { await flagNiggle(part) } },
                         onOpenInjuryFlare: { path.append(.injuryFlare) },
                         onChangeShoe: { path.append(.shoes) },
                         onRowAction: { _ in },
                         onPushStrava: { Task { await pushStrava(model) } })

        case .beforeRun, .raceDay:
            TodayBeforeV5(model: model,
                          accountName: accountName,
                          accountWeekLine: model.panel.weekLine ?? "",
                          accountRows: accountRows,
                          calendarWeeks: calendarWeeks(model),
                          onAccountRowTap: { row in
                              switch row.action {
                              case "settings": path.append(.settings)
                              case "shoes":    path.append(.shoes)
                              default: break
                              }
                          })
        }
    }

    /// The account sheet's rows. Not on `V5Today`'s contract — it is a shell
    /// concern, so the shell supplies it.
    private var accountRows: [V5Row] {
        [
            V5Row(id: "settings", label: "Settings", sub: "Training, notifications, units", action: "settings"),
            V5Row(id: "shoes", label: "Shoes", sub: "Rotation and retirement", action: "shoes"),
        ]
    }

    /// The training calendar. Built from the week strip the payload already
    /// carries, so the sheet and the strip can never disagree about a day.
    private func calendarWeeks(_ model: V5Today) -> [TodayCalendarWeek] {
        guard !model.weekStrip.isEmpty else { return [] }
        return [
            TodayCalendarWeek(
                id: "current",
                range: model.panel.weekLine ?? "This week",
                days: model.weekStrip.map { d in
                    TodayCalendarDay(id: d.id,
                                     label: "\(d.letter) \(d.number)",
                                     sub: d.isRest ? "Rest day" : d.dayState.capitalized,
                                     status: d.isToday ? .measured("Today")
                                           : d.isDone ? .measured("Done") : nil,
                                     isToday: d.isToday)
                }
            )
        ]
    }

    private var coldStart: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
                // The panel's own height, reserved. Nothing appears or
                // disappears and reflows.
                RoundedRectangle(cornerRadius: V5.R.panel, style: .continuous)
                    .fill(V5.surface1)
                    .frame(height: 380)
                Skeleton(lines: 3)
                Skeleton(lines: 2)
            }
            .padding(.horizontal, V5.S.gutter)
        }
        .background(V5.surfacePage)
    }

    // ── writes ──

    private func logEffort(_ model: V5Today, _ rpe: Int) async {
        guard let runId = model.runId else { return }
        var req = URLRequest(url: API.baseURL.appendingPathComponent("api/runs/\(runId)/rpe"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["rpe": rpe])
        _ = try? await API.authedSend(req)
        await surface.load()
    }

    private func flagNiggle(_ bodyPart: String) async {
        var req = URLRequest(url: API.baseURL.appendingPathComponent("api/niggle"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: [
            "body_part": bodyPart, "severity": 1, "status": "active",
        ])
        _ = try? await API.authedSend(req)
        await surface.load()
    }

    private func pushStrava(_ model: V5Today) async {
        guard let runId = model.runId else { return }
        _ = try? await API.pushRunToStrava(runId: runId)
    }
}

// MARK: - Block

struct BlockHostV5: View {
    @StateObject private var surface = V5Surfaces.block()
    @Binding var path: [V5Route]

    var body: some View {
        Group {
            if let model = surface.model {
                BlockV5(model: model, onChanged: { _ in
                    // A confirmed change re-authors the plan, so both surfaces
                    // that read it are refetched rather than patched locally.
                    Task { await surface.load() }
                })
            } else if surface.isOutage {
                ScrollView {
                    OutageBodyV5(onRetry: { Task { await surface.load() } })
                        .padding(.horizontal, V5.S.gutter)
                        .padding(.top, V5.S.s40)
                }
                .background(V5.surfacePage)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
                        RoundedRectangle(cornerRadius: V5.R.panel, style: .continuous)
                            .fill(V5.surface1).frame(height: 300)
                        Skeleton(lines: 4)
                    }
                    .padding(.horizontal, V5.S.gutter)
                }
                .background(V5.surfacePage)
            }
        }
        .task {
            await surface.load()
            NotificationCenter.default.post(name: .faffSurfaceReady, object: "block")
        }
        .refreshable { await surface.load() }
    }
}

// MARK: - Races

struct RacesHostV5: View {
    @StateObject private var surface = V5Surfaces.races()
    @Binding var path: [V5Route]

    var body: some View {
        Group {
            if let model = surface.model {
                RacesV5(model: model,
                        onAnswer: { a in Task { await send(a, model) } },
                        onEvidenceTap: { _ in })
            } else if surface.isOutage {
                ScrollView {
                    OutageBodyV5(onRetry: { Task { await surface.load() } })
                        .padding(.horizontal, V5.S.gutter)
                        .padding(.top, V5.S.s40)
                }
                .background(V5.surfacePage)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
                        RoundedRectangle(cornerRadius: V5.R.panel, style: .continuous)
                            .fill(V5.surface1).frame(height: 340)
                        Skeleton(lines: 3)
                    }
                    .padding(.horizontal, V5.S.gutter)
                }
                .background(V5.surfacePage)
            }
        }
        .task {
            await surface.load()
            NotificationCenter.default.post(name: .faffSurfaceReady, object: "races")
        }
        .refreshable { await surface.load() }
    }

    /// The card's own answers, sent back verbatim. The client never decides
    /// what an answer means — `action` is the engine's vocabulary and the
    /// engine applies it.
    private func send(_ a: V5CardAnswer, _ model: V5Races) async {
        let slug = a.action == "choose_race" ? a.id : model.schedule.first(where: { !$0.isPast })?.slug
        _ = try? await API.answerGoalCard(action: a.action, targetSec: a.targetSec, raceSlug: slug)
        await surface.load()
    }
}

// MARK: - Pushed screens

struct RaceDetailHostV5: View {
    let slug: String
    @StateObject private var surface: V5Surface<V5RaceDetail>

    init(slug: String) {
        self.slug = slug
        _surface = StateObject(wrappedValue: V5Surfaces.raceDetail(slug: slug))
    }

    var body: some View {
        Group {
            if let d = surface.model {
                RaceDetailV5(raceDetail: d)
            } else if surface.isOutage {
                ScrollView {
                    OutageBodyV5(onRetry: { Task { await surface.load() } })
                        .padding(.horizontal, V5.S.gutter)
                }
                .background(V5.surfacePage)
            } else {
                ScrollView { Skeleton(lines: 6).padding(.horizontal, V5.S.gutter) }
                    .background(V5.surfacePage)
            }
        }
        .task { await surface.load() }
        .navigationBarBackButtonHidden(true)
    }
}

struct PacesHostV5: View {
    @StateObject private var surface = V5Surfaces.paces()

    var body: some View {
        Group {
            if let p = surface.model {
                PacesMovedV5(paces: p, onSettled: { Task { await surface.load() } })
            } else if surface.isOutage {
                ScrollView {
                    OutageBodyV5(onRetry: { Task { await surface.load() } })
                        .padding(.horizontal, V5.S.gutter)
                }
                .background(V5.surfacePage)
            } else {
                ScrollView { Skeleton(lines: 5).padding(.horizontal, V5.S.gutter) }
                    .background(V5.surfacePage)
            }
        }
        .task { await surface.load() }
        .navigationBarBackButtonHidden(true)
    }
}

struct ReturnHostV5: View {
    @StateObject private var surface = V5Surfaces.returnToRunning()

    var body: some View {
        Group {
            if let r = surface.model {
                ReturnToRunningV5(ret: r, onCheckedIn: { Task { await surface.load() } })
            } else if surface.isOutage {
                ScrollView {
                    OutageBodyV5(onRetry: { Task { await surface.load() } })
                        .padding(.horizontal, V5.S.gutter)
                }
                .background(V5.surfacePage)
            } else {
                ScrollView { Skeleton(lines: 5).padding(.horizontal, V5.S.gutter) }
                    .background(V5.surfacePage)
            }
        }
        .task { await surface.load() }
        .navigationBarBackButtonHidden(true)
    }
}

struct ShoesHostV5: View {
    @State private var shoes: [Shoe] = []

    var body: some View {
        ShoesV5(shoes: shoes,
                onWear: { id in Task { await patch(id, ["preferred": true]) } },
                onRetire: { id in Task { await patch(id, ["retired": true]) } },
                onAddPair: {})
            .task { await load() }
            .navigationBarBackButtonHidden(true)
    }

    private func load() async {
        shoes = (try? await API.fetchShoes())?.shoes ?? []
    }

    private func patch(_ id: Int, _ fields: [String: Any]) async {
        _ = try? await API.patchShoe(id: id, fields: fields)
        await load()
    }
}

struct SettingsHostV5: View {
    @EnvironmentObject private var runGate: PhoneRunGate
    @State private var model: SettingsV5Model?

    var body: some View {
        Group {
            if let model {
                SettingsV5(model: model,
                           onSetLongRunDay: { d in Task { await patch(["long_run_day": d]) } },
                           onSetDaysPerWeek: { n in Task { await patchProfile(["weekly_frequency": n]) } },
                           onToggleSessionReminders: { v in Task { await patch(["push_enabled": v]) } },
                           onToggleWeeklySummary: { v in Task { await patch(["weekly_summary_enabled": v]) } },
                           onSetUnits: { u in Task { await patch(["units_distance": u]) } },
                           onToggleStrava: {})
            } else {
                ScrollView { Skeleton(lines: 6).padding(.horizontal, V5.S.gutter) }
                    .background(V5.surfacePage)
            }
        }
        .task { await load() }
        .navigationBarBackButtonHidden(true)
    }

    private func load() async {
        await SettingsCache.shared.warm()
        let (settings, profile) = await SettingsCache.shared.read()
        model = SettingsV5Model(
            longRunDay: settings?.long_run_day ?? "Sunday",
            longRunDayOptions: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
            daysPerWeek: profile?.weekly_frequency ?? 5,
            phoneRunEnabled: settings?.phoneRunEnabled ?? true,
            sessionReminders: settings?.push_enabled ?? true,
            weeklySummary: true,
            units: settings?.units_distance ?? "mi",
            unitsOptions: ["mi", "km"],
            stravaConnected: StravaConnection.isConnected,
            email: profile?.email ?? ""
        )
    }

    private func patch(_ fields: [String: Any]) async {
        _ = try? await API.patchSettings(fields)
        await SettingsCache.shared.invalidate()
        await runGate.refresh()
        await load()
    }

    private func patchProfile(_ fields: [String: Any]) async {
        _ = try? await API.updateProfile(fields)
        await SettingsCache.shared.invalidate()
        await load()
    }
}

// MARK: - The root

/// The three places, wired.
///
/// `live` comes in from the caller so this file does not depend on the run
/// consoles: starting a run is the one navigation in the design that leaves the
/// shell entirely, and the consoles own their own machinery.
struct FaffV5Root<LiveContent: View>: View {
    @StateObject private var runGate = PhoneRunGate()
    @State private var selected: FaffTabV5 = .today
    var accountName: String = ""
    @ViewBuilder var live: (LiveRunMode) -> LiveContent

    var body: some View {
        RootV5(
            selected: $selected,
            showRun: runGate.enabled,
            today: { path in TodayHostV5(path: path, accountName: accountName) },
            block: { path in BlockHostV5(path: path) },
            races: { path in RacesHostV5(path: path) },
            route: { route in
                switch route {
                case .raceDetail(let slug): RaceDetailHostV5(slug: slug)
                case .settings:             SettingsHostV5()
                case .shoes:                ShoesHostV5()
                case .pacesMoved:           PacesHostV5()
                case .returnToRunning:      ReturnHostV5()
                case .injuryFlare:          TodayHostV5(path: .constant([]))
                }
            },
            live: live
        )
        .environmentObject(runGate)
        .task { await runGate.refresh() }
    }
}

// MARK: - Live run
//
// The one navigation in the design that leaves the shell entirely. Both
// consoles need the day's plan — the pace band, the ceiling, the phases — and
// that comes from the same `/api/watch/today` payload the watch reads, so the
// phone and the wrist are never prescribing different things.

struct LiveRunHostV5: View {
    let mode: LiveRunMode
    let onDismiss: () -> Void

    /// Owned here, for exactly the run's lifetime. The consoles observe and
    /// tick it; they do not own it, because ending a run has to outlive the
    /// screen that was showing it.
    @StateObject private var tracker = PhoneRunTracker()
    @StateObject private var hr = TreadmillHRStreamer()

    @State private var plan: LiveRunPlanV5?
    /// True once the workout has been asked for. Until then neither console
    /// renders, because a live console that appears and then reflows when the
    /// plan lands is exactly what the design forbids.
    @State private var asked = false

    var body: some View {
        Group {
            switch mode {
            case .outdoor:
                LiveRunOutdoorV5(tracker: tracker, hr: hr, plan: plan,
                                 onPause: togglePause, onEnd: end)
            case .treadmill:
                LiveRunTreadmillV5(plan: plan, hr: hr,
                                   onPause: togglePause, onEnd: end)
            }
        }
        .opacity(asked ? 1 : 0)
        .task {
            // A failure here is not an outage screen: the run can still be
            // recorded, it just has no target to hold. `plan` stays nil and
            // both consoles already draw their no-target layout.
            if let w = try? await API.fetchWatchWorkout() {
                plan = LiveRunPlanV5(workout: w, sessionType: w.name)
            }
            asked = true
            if mode == .outdoor { tracker.start() }
            await hr.start(from: Date())
        }
    }

    private func togglePause() {
        tracker.state == .running ? tracker.pause() : tracker.start()
    }

    private func end() {
        tracker.finish()
        onDismiss()
    }
}
