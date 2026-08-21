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

    /// ─────────────────────────────────────────────────────────────────────
    /// LOOKING AT ANOTHER DAY
    ///
    /// The week strip drew seven days and none of them did anything. They are
    /// the obvious way to ask "what was Tuesday" or "what is Sunday", and
    /// `/api/v5/today?date=` already answers exactly that — the tomorrow
    /// preview after a niggle uses the same read.
    ///
    /// Nil means today. Anything else is a day the runner asked for, and the
    /// panel says so and offers the way back, because a screen called TODAY
    /// showing another day without saying so is a lie.
    @State private var viewingDate: String?
    /// The account sheet, hoisted here so every Today variant can open it —
    /// the after-run screen and all four state screens had a dead button.
    @State private var accountOpen = false

    /// The runner's initials for the account button, or nil for a glyph.
    private var initials: String? {
        let letters = accountName.split(separator: " ").prefix(2).compactMap(\.first)
        return letters.isEmpty ? nil : String(letters).uppercased()
    }

    var body: some View {
        Group {
            if let model = surface.model {
                // Keyed on the day, so stepping between days crossfades
                // instead of snapping. The old day stays up until the new one
                // lands (see V5Surface.rebind), so this is a fade between two
                // real screens and never a fade through nothing.
                content(model)
                    .id(model.dateISO)
                    .transition(.opacity)
            } else if let reason = surface.absentReason {
                // The engine answered and the answer is that this does
                // not apply. Silence, never ErrorNote: nothing failed.
                ScrollView {
                    Silence(reason: reason)
                        .padding(.horizontal, V5.S.gutter)
                        .padding(.top, V5.S.s40)
                }
                .background(V5.surfacePage)
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
        .animation(V5.Motion.fill, value: surface.model?.dateISO)
        // One account sheet for every Today variant. It used to live inside
        // TodayBeforeV5, so the after-run screen and all four state screens
        // had an account button that opened nothing.
        .overlay {
            V5SheetHost(isPresented: $accountOpen) {
                VStack(alignment: .leading, spacing: V5.S.s16) {
                    HStack(alignment: .lastTextBaseline, spacing: V5.S.s12) {
                        Text(accountName)
                            .font(.faffDisplay(20))
                            .textCase(.uppercase)
                            .tracking(20 * 0.02)
                            .foregroundStyle(V5.textPrimary)
                        Spacer(minLength: V5.S.s12)
                        Text(surface.model?.panel.weekLine ?? "")
                            .font(.faffText(TypeScaleV5.label13))
                            .foregroundStyle(V5.textQuiet)
                    }
                    .padding(.horizontal, V5.S.s4)

                    ListGroup {
                        ForEach(accountRows) { row in
                            ListRow(label: row.label, sub: row.sub, onTap: {
                                withAnimation(V5.Motion.sheet) { accountOpen = false }
                                DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                                    switch row.action {
                                    case "settings": path.append(.settings)
                                    case "shoes":    path.append(.shoes)
                                    default: break
                                    }
                                }
                            })
                        }
                    }

                    FaffButton("Close", variant: .secondary) {
                        withAnimation(V5.Motion.sheet) { accountOpen = false }
                    }
                }
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
                TodayChangedV5(panel: model.panel, convergence: changed,
                               onOpenAccount: { accountOpen = true })
            } else {
                TodayBeforeLiveV5(model: model, accountName: accountName,
                              accountWeekLine: model.panel.weekLine ?? "",
                              accountRows: [], fallbackCalendarWeeks: calendarWeeks(model))
            }

        case .injuryFlare:
            if let injury = model.injury {
                InjuryFlareV5(model: injury,
                              onOpenAccount: { accountOpen = true },
                              onCheckIn: { row in Task { await checkInNiggle(row.id) } },
                              onReturnToRunning: { path.append(.returnToRunning) })
            } else {
                TodayBeforeLiveV5(model: model, accountName: accountName,
                              accountWeekLine: model.panel.weekLine ?? "",
                              accountRows: [], fallbackCalendarWeeks: calendarWeeks(model))
            }

        case .sick:
            if let sick = model.sick {
                SickFlareV5(model: sick,
                            onOpenAccount: { accountOpen = true },
                            onLogTrend: { row in Task { await logSickTrend(row.action) } })
            } else {
                TodayBeforeLiveV5(model: model, accountName: accountName,
                                  accountWeekLine: model.panel.weekLine ?? "",
                                  accountRows: [], fallbackCalendarWeeks: calendarWeeks(model))
            }

        case .weekOff:
            if let off = model.weekOff {
                WeekOffV5(model: off, onOpenAccount: { accountOpen = true })
            } else {
                TodayBeforeLiveV5(model: model, accountName: accountName,
                              accountWeekLine: model.panel.weekLine ?? "",
                              accountRows: [], fallbackCalendarWeeks: calendarWeeks(model))
            }

        case .offSeason:
            if let off = model.offSeason {
                OffSeasonV5(model: off, onOpenAccount: { accountOpen = true })
            } else {
                NotOnPhoneYetV5(reason: nil)
            }

        case .afterRun:
            TodayAfterV5(model: model,
                         onOpenAccount: { accountOpen = true },
                         onLogEffort: { rpe in Task { await logEffort(model, rpe) } },
                         onFlagNiggle: { part in Task { await flagNiggle(part) } },
                         onOpenInjuryFlare: { path.append(.injuryFlare) },
                         onChangeShoe: { path.append(.shoes) },
                         onRowAction: { _ in },
                         onPushStrava: { Task { await pushStrava(model) } },
                         onPickDay: { id in pickDay(id, in: model) },
                         viewingDayLabel: viewingDayLabel,
                         onBackToToday: { backToToday() },
                         initials: initials,
                         onReportSick: { sym, started, fever in
                             Task { await reportSick(sym, started, fever) }
                         })

        case .beforeRun, .raceDay:
            TodayBeforeLiveV5(model: model,
                          accountName: accountName,
                          accountWeekLine: model.panel.weekLine ?? "",
                          accountRows: accountRows,
                          fallbackCalendarWeeks: calendarWeeks(model),
                          onAccountRowTap: { row in
                              switch row.action {
                              case "settings": path.append(.settings)
                              case "shoes":    path.append(.shoes)
                              default: break
                              }
                          },
                          onPickDay: { id in pickDay(id, in: model) },
                          viewingDayLabel: viewingDayLabel,
                          onBackToToday: { backToToday() },
                          onOpenPacesMoved: { path.append(.pacesMoved) },
                          onReportSick: { sym, started, fever in
                              Task { await reportSick(sym, started, fever) }
                          },
                          reload: { await surface.load() })
        }
    }

    /// The strip hands back a plan row's server id; the date lives beside it
    /// on the same row. Identity is the id, the date is a lookup — never the
    /// other way round.
    private func pickDay(_ id: String, in model: V5Today) {
        guard let day = model.weekStrip.first(where: { $0.id == id }) else { return }
        let iso: String? = day.isToday ? nil : day.dateISO
        guard iso != viewingDate else { return }
        viewingDate = iso
        Task {
            await surface.rebind { try await API.fetchV5Today(date: iso) }
        }
    }

    private func backToToday() {
        guard viewingDate != nil else { return }
        viewingDate = nil
        Task { await surface.rebind { try await API.fetchV5Today() } }
    }

    /// Step one day. Nil means today, so stepping from nil starts at the
    /// runner's own today rather than at a date the device invented.
    private func step(_ days: Int, from model: V5Today) {
        let base = viewingDate ?? model.dateISO
        guard let d = Self.iso.date(from: base),
              let next = Calendar.current.date(byAdding: .day, value: days, to: d) else { return }
        let iso = Self.iso.string(from: next)
        // Stepping back onto today is going home, not visiting a date.
        let target: String? = iso == model.dateISO && viewingDate == nil ? nil
                            : (iso == todayISO(model) ? nil : iso)
        viewingDate = target
        Task { await surface.rebind { try await API.fetchV5Today(date: target) } }
    }

    /// The runner's own today, as the payload reported it when we were on it.
    private func todayISO(_ model: V5Today) -> String {
        model.weekStrip.first(where: \.isToday)?.dateISO ?? model.dateISO
    }

    private static let iso: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "UTC")
        return f
    }()

    /// "Tue 18 Aug" — what the place label says when it is not today.
    private var viewingDayLabel: String? {
        guard let viewingDate, let d = Self.iso.date(from: viewingDate) else { return nil }
        let f = DateFormatter()
        f.dateFormat = "EEE d MMM"
        f.timeZone = TimeZone(identifier: "UTC")
        return f.string(from: d)
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

    /// The ladder's sibling: the daily flare check-in. The row ids are
    /// literally the values the endpoint expects, so there is no mapping to
    /// get wrong.
    private func checkInNiggle(_ today: String) async {
        var req = URLRequest(url: API.baseURL.appendingPathComponent("api/niggle/recovery"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["today": today])
        _ = try? await API.authedSend(req)
        await surface.load()
    }

    private func reportSick(_ symptoms: [String], _ started: String, _ hasFever: Bool) async {
        _ = try? await API.postSick(symptoms: symptoms, started: started, fever: hasFever)
        await surface.load()
    }

    /// The sick check-in is a TREND, not a one-shot note: "recovered" clears
    /// the episode server-side, which the injury flow has no equivalent of.
    private func logSickTrend(_ action: String?) async {
        let trend: String
        switch action {
        case "trend_better":    trend = "better"
        case "trend_same":      trend = "same"
        case "trend_worse":     trend = "worse"
        case "trend_recovered": trend = "recovered"
        default: return
        }
        _ = try? await API.postSickRecovery(trend: trend)
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
                BlockV5(model: model,
                        onChanged: { _ in
                            // A confirmed change re-authors the plan, so both
                            // surfaces that read it are refetched rather than
                            // patched locally.
                            Task { await surface.load() }
                        },
                        onOpenRunLog: { path.append(.runLog) })
            } else if let reason = surface.absentReason {
                // The engine answered and the answer is that this does
                // not apply. Silence, never ErrorNote: nothing failed.
                ScrollView {
                    Silence(reason: reason)
                        .padding(.horizontal, V5.S.gutter)
                        .padding(.top, V5.S.s40)
                }
                .background(V5.surfacePage)
            } else if surface.isOutage {
                ScrollView {
                    OutageBodyV5(copy: .block, onRetry: { Task { await surface.load() } })
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
        ZStack {
            Group {
                if let model = surface.model {
                    RacesV5(model: model,
                            onAnswer: { a in Task { await send(a, model) } },
                            onEvidenceTap: { _ in },
                            onOpenRace: { row in path.append(.raceDetail(slug: row.slug)) },
                            onAddRace: { path.append(.addRace) })
                } else if let reason = surface.absentReason {
                    ScrollView {
                        Silence(reason: reason)
                            .padding(.horizontal, V5.S.gutter)
                            .padding(.top, V5.S.s40)
                    }
                    .background(V5.surfacePage)
                } else if surface.isOutage {
                    ScrollView {
                        OutageBodyV5(copy: .races, onRetry: { Task { await surface.load() } })
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
            // Coming back from a pushed screen that may have written — adding
            // a race, answering on the detail — the list behind it is stale.
            // The stack does not re-run `.task` on pop, so watch the path.
            .onChange(of: path.isEmpty) { _, isRoot in
                if isRoot { Task { await surface.load() } }
            }

        }
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
    @Environment(\.dismiss) private var dismiss
    @StateObject private var surface: V5Surface<V5RaceDetail>

    init(slug: String) {
        self.slug = slug
        _surface = StateObject(wrappedValue: V5Surfaces.raceDetail(slug: slug))
    }

    var body: some View {
        Group {
            if let d = surface.model {
                RaceDetailV5(raceDetail: d,
                             onSubmitResult: { finish, hr in
                                 _ = await API.postRaceResult(slug: slug,
                                                              finishDisplay: finish,
                                                              avgHrBpm: hr)
                                 await surface.load()
                             },
                             onBack: { dismiss() })
            } else if let reason = surface.absentReason {
                // The engine answered and the answer is that this does
                // not apply. Silence, never ErrorNote: nothing failed.
                ScrollView {
                    Silence(reason: reason)
                        .padding(.horizontal, V5.S.gutter)
                        .padding(.top, V5.S.s40)
                }
                .background(V5.surfacePage)
            } else if surface.isOutage {
                ScrollView {
                    OutageBodyV5(copy: .raceDetail, onRetry: { Task { await surface.load() } })
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
            } else if let reason = surface.absentReason {
                // The engine answered and the answer is that this does
                // not apply. Silence, never ErrorNote: nothing failed.
                ScrollView {
                    Silence(reason: reason)
                        .padding(.horizontal, V5.S.gutter)
                        .padding(.top, V5.S.s40)
                }
                .background(V5.surfacePage)
            } else if surface.isOutage {
                ScrollView {
                    OutageBodyV5(copy: .paces, onRetry: { Task { await surface.load() } })
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
            } else if let reason = surface.absentReason {
                // The engine answered and the answer is that this does
                // not apply. Silence, never ErrorNote: nothing failed.
                ScrollView {
                    Silence(reason: reason)
                        .padding(.horizontal, V5.S.gutter)
                        .padding(.top, V5.S.s40)
                }
                .background(V5.surfacePage)
            } else if surface.isOutage {
                ScrollView {
                    OutageBodyV5(copy: .returnLadder, onRetry: { Task { await surface.load() } })
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

/// Adding a race is its own screen. `AddRaceV5` is bare content — it draws
/// no bar and does not scroll — so the chrome lives here, exactly as
/// `ShoesV5` and `SettingsV5` carry theirs.
struct AddRaceHostV5: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                AppBar(title: "Add a race", onBack: { dismiss() })
                AddRaceV5(onCancel: { dismiss() },
                          onCreated: { _ in dismiss() })
                    .padding(.horizontal, V5.S.gutter)
                    .padding(.bottom, V5.S.s32)
            }
        }
        .background(V5.surfacePage)
        .navigationBarBackButtonHidden(true)
    }
}

struct ShoesHostV5: View {
    @Environment(\.dismiss) private var dismiss
    @State private var shoes: [Shoe] = []

    var body: some View {
        ShoesV5(shoes: shoes,
                onWear: { id in Task { await patch(id, ["preferred": true]) } },
                onRetire: { id in Task { await patch(id, ["retired": true]) } },
                onAddPair: { brand, model, shoeType, startMi in
                    Task { await addPair(brand: brand, model: model,
                                         shoeType: shoeType, startMi: startMi) }
                },
                onBack: { dismiss() })
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

    /// The cap is nil unless the runner typed one. The retirement band is the
    /// engine's to resolve from the shoe TYPE — the README is explicit that
    /// those figures are a backend concern and must not be hardcoded here.
    /// `startMi` is miles already on the shoe when it joins the rotation, which
    /// the API keeps as `baseline_mi` and adds to everything logged after. NOT
    /// a retirement cap — screen 21a shows no retirement figure, because that
    /// band belongs to the engine and is gated against Research/17.
    private func addPair(brand: String, model: String, shoeType: String, startMi: Double) async {
        _ = try? await API.createShoeV5(brand: brand, model: model,
                                        shoeType: shoeType, baselineMi: startMi)
        await load()
    }
}

struct SettingsHostV5: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var runGate: PhoneRunGate
    @State private var stravaConnecting = false
    @State private var model: SettingsV5Model?

    var body: some View {
        Group {
            if let model {
                SettingsV5(model: model,
                           onSetLongRunDay: { d in Task { await patch(["long_run_day": Self.dayKey(d)]) } },
                           onSetDaysPerWeek: { n in Task { await patchProfile(["weekly_frequency": n]) } },
                           onToggleSessionReminders: { v in
                               Task { await setPref("skip_recovery_enabled", v) }
                           },
                           onToggleWeeklySummary: { v in
                               Task { await setPref("weekly_checkin_enabled", v) }
                           },
                           onSetUnits: { u in Task { await patch(["units_distance": u]) } },
                           onToggleStrava: { Task { await connectStrava() } },
                           onBack: { dismiss() })
            } else {
                ScrollView { Skeleton(lines: 6).padding(.horizontal, V5.S.gutter) }
                    .background(V5.surfacePage)
            }
        }
        .task { await load() }
        .navigationBarBackButtonHidden(true)
    }

    /// THE WIRE SPEAKS SHORTCODES, THE SCREEN SPEAKS WEEKDAYS.
    ///
    /// `users.long_run_day` is `sun`…`sat` and the whole plan engine parses
    /// it that way (`DOW_OF_SHORTCODE` in `lib/plan/adapt.ts`, `dose-guard`).
    /// This screen listed full weekday names and posted them back verbatim,
    /// so choosing a long run day would have written "Sunday" into a column
    /// every reader treats as a three-letter code — and the long run day IS
    /// the training week's boundary. Onboarding already maps both ways
    /// (`OnboardingV5.longDayOptions`); Settings does now too.
    static let dayNames: [(key: String, label: String)] = [
        ("mon", "Monday"), ("tue", "Tuesday"), ("wed", "Wednesday"),
        ("thu", "Thursday"), ("fri", "Friday"), ("sat", "Saturday"), ("sun", "Sunday"),
    ]

    static func dayLabel(_ key: String) -> String {
        dayNames.first { $0.key == key.lowercased() }?.label ?? key
    }

    static func dayKey(_ label: String) -> String {
        dayNames.first { $0.label == label }?.key ?? label.lowercased()
    }

    private func load() async {
        await SettingsCache.shared.warm()
        let (settings, profile) = await SettingsCache.shared.read()
        // THE SCHEDULER READS profile.notification_prefs, NOT settings.
        // These two switches wrote `push_enabled` (which no notification
        // category consults) and `weekly_summary_enabled` (which the
        // settings route's allowlist drops on the floor), and the screen
        // showed the weekly one as ON no matter what. Both now read and
        // write the jsonb the cron actually gates on.
        let prefs = try? await API.fetchNotificationPrefs()
        model = SettingsV5Model(
            longRunDay: Self.dayLabel(settings?.long_run_day ?? "sun"),
            longRunDayOptions: Self.dayNames.map(\.label),
            daysPerWeek: profile?.weekly_frequency ?? 5,
            phoneRunEnabled: settings?.phoneRunEnabled ?? true,
            sessionReminders: prefs?.skip_recovery_enabled ?? true,
            weeklySummary: prefs?.weekly_checkin_enabled ?? true,
            units: settings?.units_distance ?? "mi",
            unitsOptions: ["mi", "km"],
            stravaConnected: StravaConnection.isConnected,
            email: profile?.email ?? ""
        )
    }

    private func setPref(_ key: String, _ value: Bool) async {
        _ = await API.patchNotificationPref(key: key, value: value)
        await load()
    }

    private func patch(_ fields: [String: Any]) async {
        _ = try? await API.patchSettings(fields)
        await SettingsCache.shared.invalidate()
        await runGate.refresh()
        await load()
    }

    private func connectStrava() async {
        guard !stravaConnecting else { return }
        stravaConnecting = true
        _ = await StravaOAuthSession.shared.start()
        stravaConnecting = false
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
    /// Read from the profile rather than passed in, so the account button
    /// shows the runner's own initials instead of an empty disc.
    @State private var accountName: String = ""
    @ViewBuilder var live: (LiveRunMode, @escaping () -> Void) -> LiveContent

    var body: some View {
        RootV5(
            selected: $selected,
            showRun: runGate.enabled,
            today: { path in TodayHostV5(path: path, accountName: accountName) },
            block: { path in BlockHostV5(path: path) },
            races: { path in RacesHostV5(path: path) },
            route: { route, path in
                switch route {
                case .raceDetail(let slug): RaceDetailHostV5(slug: slug)
                case .runLog:               RunLogHostV5(path: path)
                case .runDetail(let id):    RunDetailHostV5(id: id)
                case .settings:             SettingsHostV5()
                case .shoes:                ShoesHostV5()
                case .addRace:              AddRaceHostV5()
                case .pacesMoved:           PacesHostV5()
                case .returnToRunning:      ReturnHostV5()
                case .injuryFlare:          InjuryPreviewHostV5()
                }
            },
            live: live
        )
        .environmentObject(runGate)
        .task {
            await runGate.refresh()
            // The profile-state payload is already cached at launch, so this
            // is a synchronous read in the common case, not a fetch.
            if let cached = AppCache.read(.profileState, as: ProfileState.self),
               let name = cached.identity.full_name, !name.isEmpty {
                accountName = name
            } else if let fresh = try? await API.fetchProfileState(),
                      let name = fresh.identity.full_name, !name.isEmpty {
                accountName = name
            }
        }
    }
}

// MARK: - What tomorrow becomes
//
// "Flagging a niggle in 5b/5c reveals a link to 13a, showing what tomorrow
//  becomes if the niggle is still there."
//
// So this is not today's screen pushed onto itself — it is TOMORROW, asked for
// by date. `/api/v5/today?date=` already answers that, and the engine decides
// whether the flare it was just told about turns tomorrow into an injury day.
// If it does not, the honest answer is that nothing changes, and the screen
// says so rather than showing a flare that the engine did not call.

struct InjuryPreviewHostV5: View {
    @StateObject private var surface: V5Surface<V5Today>

    init() {
        let iso = InjuryPreviewHostV5.tomorrowISO()
        _surface = StateObject(wrappedValue: V5Surface(cache: nil) {
            try await API.fetchV5Today(date: iso)
        })
    }

    /// The runner's own tomorrow. The device's calendar is the right clock
    /// here: the server re-resolves the date in the runner's timezone anyway,
    /// and this is a preview, not a write.
    private static func tomorrowISO() -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: Calendar.current.date(byAdding: .day, value: 1, to: Date()) ?? Date())
    }

    var body: some View {
        Group {
            if let model = surface.model {
                if let injury = model.injury {
                    InjuryFlareV5(model: injury)
                } else {
                    // A refusal, not an empty state: we read tomorrow and the
                    // answer is that it still stands.
                    ScrollView {
                        VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
                            Silence(reason: "Tomorrow still stands as planned. If the niggle is still there in the morning, say so and the day changes then.")
                        }
                        .padding(.horizontal, V5.S.gutter)
                        .padding(.top, V5.S.s40)
                    }
                    .background(V5.surfacePage)
                }
            } else if let reason = surface.absentReason {
                // The engine answered and the answer is that this does
                // not apply. Silence, never ErrorNote: nothing failed.
                ScrollView {
                    Silence(reason: reason)
                        .padding(.horizontal, V5.S.gutter)
                        .padding(.top, V5.S.s40)
                }
                .background(V5.surfacePage)
            } else if surface.isOutage {
                ScrollView {
                    OutageBodyV5(copy: .tomorrow, onRetry: { Task { await surface.load() } })
                        .padding(.horizontal, V5.S.gutter)
                        .padding(.top, V5.S.s40)
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

// MARK: - Live run
//
// The one navigation in the design that leaves the shell entirely. Both
// consoles need the day's plan — the pace band, the ceiling, the phases — and
// that comes from the same `/api/watch/today` payload the watch reads, so the
// phone and the wrist are never prescribing different things.

struct LiveRunHostV5: View {
    let mode: LiveRunMode
    let onDismiss: () -> Void

    /// Owned here, for exactly the run's lifetime. The consoles observe it;
    /// they neither own nor drive it, because ending a run has to outlive the
    /// screen that was showing it — and because a run whose clock depends on
    /// a view rendering is a run that stops when the view does not. The
    /// tracker keeps its own clock (`PhoneRunTracker.startClock`).
    @StateObject private var tracker = PhoneRunTracker()
    @StateObject private var hr = TreadmillHRStreamer()

    @State private var plan: LiveRunPlanV5?
    /// True once the workout has been asked for. Until then neither console
    /// renders, because a live console that appears and then reflows when the
    /// plan lands is exactly what the design forbids.
    @State private var asked = false
    /// The End confirm. A run is hours of work and End is a single tap next
    /// to Pause; it used to finish, save and dismiss with no step in between.
    @State private var confirmingEnd = false
    /// Set when a run this app died in the middle of was recovered on the way
    /// in — see `.task`. Shown once, on this console, because there is
    /// nowhere else the runner would think to look for it.
    @State private var recovered: PhoneRunCheckpoint?

    var body: some View {
        Group {
            // 2026-08-21 · this was built unconditionally and merely hidden
            // with `.opacity(asked ? 1 : 0)`. A hidden view is still a live
            // view: the treadmill console's clock was already ticking, and its
            // `State(initialValue:)` seeds — including the belt's starting
            // speed — were resolved against a `plan` that had not arrived, so
            // every planned session opened at the flat fallback speed and
            // counted the fetch as running. Build it when there is something
            // to build it from.
            if asked {
                switch mode {
                case .outdoor:
                    // A run worth keeping gets a confirm; an empty console —
                    // the refusal screen's "Back", or a mode opened by
                    // accident — just leaves, because there is nothing to be
                    // sure about.
                    LiveRunOutdoorV5(tracker: tracker, hr: hr, plan: plan,
                                     onPause: togglePause,
                                     onEnd: { if hasRecordedRun { confirmingEnd = true } else { end() } })
                case .treadmill:
                    LiveRunTreadmillV5(plan: plan, hr: hr,
                                       onPause: togglePause, onEnd: end)
                }
            } else {
                V5.surfacePage.ignoresSafeArea()
            }
        }
        .overlay { if mode == .outdoor { endConfirmSheet } }
        .task {
            // A run the app was killed in the middle of, re-submitted through
            // the same durable queue a normal End uses. Done BEFORE this
            // session starts, so the checkpoint on disk belongs to exactly
            // one run at a time. Idempotent at the server (row id derives
            // from workoutId), so this can never duplicate a run that did
            // manage to save.
            if mode == .outdoor { recovered = PhoneRunTracker.flushInterruptedRun() }
            // A failure here is not an outage screen: the run can still be
            // recorded, it just has no target to hold. `plan` stays nil and
            // both consoles already draw their no-target layout.
            if let w = try? await API.fetchWatchWorkout() {
                plan = LiveRunPlanV5(workout: w, sessionType: w.name)
            }
            asked = true
            // Safe before authorization has been answered: the tracker
            // remembers the request and starts itself when the prompt is
            // answered. It used to return silently, leaving a live-looking
            // console frozen at 0:00 on every runner's first ever run.
            if mode == .outdoor { tracker.start() }
            // 2026-08-21 · the HR stream is NOT started here any more.
            // `TreadmillHRStreamer.start` is first-caller-wins on the sample
            // anchor, and this call fires with "whenever the plan finished
            // loading" — racing both consoles, which start it themselves with
            // the run's actual start instant. Whichever won pinned the anchor,
            // and the console's more accurate one was silently discarded.
            // Each console owns its own anchor because each console knows
            // when its run began.
        }
    }

    /// ─────────────────────────────────────────────────────────────────────
    /// THE END CONFIRM
    ///
    /// Three shapes, because there are three different things End can mean:
    ///
    ///   · a real run   → say what is about to be saved, and save it;
    ///   · nothing yet  → there is no run here to keep, so leaving is
    ///                    leaving, and it must not claim to have saved
    ///                    anything (the old path POSTed a 0.00 mi run, which
    ///                    the backend's sub-threshold guard then had to throw
    ///                    away — a lie that happened to be caught downstream);
    ///   · refused      → location is off, so the button is just a way out.
    @ViewBuilder
    private var endConfirmSheet: some View {
        V5SheetHost(isPresented: $confirmingEnd, title: hasRecordedRun ? "End the run" : "Leave") {
            VStack(alignment: .leading, spacing: V5.S.s16) {
                if let recovered {
                    Alert(text: "A run the app was interrupted during was saved on the way in: "
                          + "\(String(format: "%.2f", recovered.distanceMi)) mi.")
                }
                Text(endSheetBody)
                    .font(.faffText(TypeScaleV5.body15))
                    .foregroundStyle(V5.textSecondary)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
                FaffButton(hasRecordedRun ? "End and save" : "Leave", variant: .primary, size: .lg) {
                    confirmingEnd = false
                    end()
                }
                FaffButton("Keep running", variant: .ghost, size: .lg) {
                    confirmingEnd = false
                }
            }
        }
    }

    /// Enough to be a run: the same thresholds the backend's sub-threshold
    /// guard uses (lib/runs/length-guard.ts · < 0.25 mi AND < 180 s is a tap
    /// test), asked here so the answer on screen matches the answer the
    /// server would give.
    private var hasRecordedRun: Bool {
        tracker.distanceMi >= 0.25 || tracker.elapsedSec >= 180
    }

    private var endSheetBody: String {
        guard hasRecordedRun else {
            return "Nothing has been recorded yet, so there is nothing to save."
        }
        let dist = String(format: "%.2f", tracker.distanceMi)
        let m = tracker.elapsedSec / 60, s = tracker.elapsedSec % 60
        let clock = "\(m):" + String(format: "%02d", s)
        var line = "Saves \(dist) mi in \(clock)."
        if tracker.trackHasGap {
            line += " Part of the track could not be measured, so the distance reads short."
        }
        return line
    }

    /// ─────────────────────────────────────────────────────────────────────
    /// ONLY AN OUTDOOR RUN HAS A TRACKER
    ///
    /// These drove `PhoneRunTracker` regardless of mode, and on a treadmill
    /// that is actively wrong: the treadmill console owns its own clock and
    /// its own speed/incline state, and there is no GPS involved at all. The
    /// symptom was unmissable once it was on a device — tapping Pause during
    /// a TREADMILL run called `tracker.start()`, which asked the runner for
    /// location permission mid-session, on the one screen the design defines
    /// as "speed and incline, no GPS".
    private func togglePause() {
        guard mode == .outdoor else { return }
        tracker.state == .running ? tracker.pause() : tracker.start()
    }

    /// ─────────────────────────────────────────────────────────────────────
    /// ENDING A RUN HAS TO SAVE IT, AND HAS TO LET GO OF THE SCREEN
    ///
    /// This used to call `tracker.finish()` and a caller-supplied `onDismiss`
    /// that was literally `{}`. Two failures at once, and the second one hid
    /// the first: the recorded run never reached the server, and the console
    /// is a `fullScreenCover` with no dismiss gesture, so the runner was left
    /// on a frozen clock with no way out short of force-quitting the app.
    ///
    /// The save goes through `WatchSync.saveCompletionDurably`, which is the
    /// same door the legacy recorder and the watch both use: it writes the
    /// payload to disk BEFORE attempting the network, so a failed POST is
    /// "will sync later" and never "run gone". That property is the whole
    /// reason to reuse it rather than POST from here.
    private func end() {
        guard mode == .outdoor else {
            // A treadmill session has no recorder behind it yet — the console
            // owns its own numbers and nothing has ever been persisted from
            // it. Leaving is leaving; it must not pretend to have saved.
            onDismiss()
            return
        }
        hr.stop()
        // Nothing worth keeping: throw it away rather than POST a run the
        // backend will only discard. `discard()` also clears the checkpoint,
        // so the recovery path does not resurrect it on the next open.
        guard hasRecordedRun else {
            tracker.discard()
            onDismiss()
            return
        }
        tracker.finish()
        // The phone is recording the ROUTE. That does not mean there is no
        // wrist: a watch worn on an outdoor run writes HR into HealthKit
        // exactly as it does on a treadmill, and this path used to drop
        // every one of those samples on the floor, so a phone-recorded run
        // reached the coach engine with no heart rate at all.
        let sessionHr = hr.closeSession()
        let id = tracker.workoutId
        let payload = tracker.buildCompletionPayload(status: "completed",
                                                     avgHr: sessionHr.avg,
                                                     maxHr: sessionHr.max)
        if let data = try? JSONSerialization.data(withJSONObject: payload) {
            Task {
                _ = await WatchSync.shared.saveCompletionDurably(data)
                // Only once the payload is in the durable queue. A crash in
                // the gap leaves the checkpoint intact and the run
                // recoverable; clearing it at `finish()` would have opened a
                // window where the run existed nowhere.
                PhoneRunTracker.clearCheckpoint(workoutId: id)
            }
        }
        onDismiss()
    }
}

// MARK: - Onboarding
//
// ─────────────────────────────────────────────────────────────────────────
// THE V5 ONBOARDING EXISTED AND NEVER RAN
//
// `OnboardingV5.swift` is a complete five-step flow and its only call sites
// were its own `#Preview` blocks. The launch gate still routed every new
// signup through the v4 `OnboardingView`, so a runner's very first experience
// of the app was the design the rest of it had replaced.
//
// This is the half that was missing: the submit. The screen collects answers
// and refuses to invent validation the engine does not have; this turns those
// answers into the two calls the backend actually wants, and then reads day
// one back out of the same Today surface the app runs on — rather than
// composing a preview of it, which would be a second source of truth for the
// most important screen in the product.

struct OnboardingHostV5: View {
    /// Fired once the runner has a plan and has seen day one.
    let onDone: () -> Void

    var body: some View {
        OnboardingV5(onSubmit: submit, onSeeToday: onDone)
    }

    private func submit(_ a: OnboardingV5Answers) async -> OnboardingV5Outcome {
        // ── the plan ──────────────────────────────────────────────────────
        // `distance` is the goal distance; the route validates it against its
        // own set and ignores anything it does not know, so there is no client
        // validation to duplicate here.
        var payload: [String: Any] = [
            "distance": a.distance,
            "timezone": TimeZone.current.identifier,
            "connectionsSkipped": true,
        ]
        if let raceDate = a.raceDate {
            let f = DateFormatter()
            f.dateFormat = "yyyy-MM-dd"
            payload["date"] = f.string(from: raceDate)
        }
        if !a.goalTime.isEmpty { payload["time"] = a.goalTime }
        payload["weeklyMi"] = a.weeklyMi
        payload["weeklyFreq"] = a.daysPerWeek

        // A self-reported recent race is the strongest fitness evidence the
        // runner can give on day one, and the route models it as raceHistory.
        if a.fitnessMode == .recent,
           !a.recentRaceDistance.isEmpty, !a.recentRaceTime.isEmpty {
            payload["raceHistory"] = [[
                "distance": a.recentRaceDistance,
                "time": a.recentRaceTime,
            ]]
        }

        do {
            try await API.completeOnboarding(payload: payload)
        } catch let e as APIServerError {
            // The engine declined and said why. That is an answer.
            return .refused(reason: e.message ?? "That goal is not one we can build a plan toward yet.")
        } catch {
            return .refused(reason: "We could not reach the server to build your plan. Try again in a moment.")
        }

        // ── the week ──────────────────────────────────────────────────────
        // Availability does NOT go through the onboarding payload; long-run
        // day and the phone-run switch are settings, and days-per-week lives
        // on the profile as `weekly_frequency`.
        _ = try? await API.patchSettings([
            "long_run_day": a.longRunDay,
            "phone_run_enabled": a.phoneStart,
        ])
        _ = try? await API.updateProfile(["weekly_frequency": a.daysPerWeek])
        await SettingsCache.shared.invalidate()

        // ── day one ───────────────────────────────────────────────────────
        // Read it off the real Today surface. A preview composed here would be
        // a second source of truth for the first screen the runner ever sees.
        guard case .ok(let today) = (try? await API.fetchV5Today()) ?? .failed else {
            return .refused(reason: "The plan is being written. It will be on Today in a moment.")
        }
        return .success(OnboardingV5DayOne(
            phaseLine: today.panel.dateLine,
            dayState: today.panel.state,
            sessionType: today.panel.type,
            dose: today.panel.dose.unreadableIfAbsent,
            coachLine: today.why ?? ""
        ))
    }
}


// MARK: - Run history
//
// The one surface v5 had no answer for at all: nothing could open a finished
// run. `GET /api/log` has the history and `GET /api/runs/[id]` has the run;
// neither was reachable.
//
// These take a plain `Model?` rather than a `V5Surface`, because they read the
// older endpoints that predate the v5 wire contract and do not carry its
// refusal shape. When those move over, so should these.

struct RunLogHostV5: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var path: [V5Route]
    @State private var log: LogState?

    var body: some View {
        Group {
            if let log {
                RunLogV5(log: log,
                         onOpenRun: { id in path.append(.runDetail(id: id)) },
                         onBack: { dismiss() })
            } else {
                ScrollView { Skeleton(lines: 6).padding(.horizontal, V5.S.gutter) }
                    .background(V5.surfacePage)
            }
        }
        .task { log = try? await API.fetchLog(limit: 120) }
        .navigationBarBackButtonHidden(true)
    }
}

struct RunDetailHostV5: View {
    let id: String
    @Environment(\.dismiss) private var dismiss
    @State private var detail: RunDetail?
    @State private var recap: RunRecap?

    var body: some View {
        Group {
            if let detail {
                RunDetailV5(detail: detail, recap: recap, onBack: { dismiss() })
            } else {
                ScrollView { Skeleton(lines: 8).padding(.horizontal, V5.S.gutter) }
                    .background(V5.surfacePage)
            }
        }
        .task {
            detail = try? await API.fetchRunDetail(id: id)
            recap = try? await API.fetchRunRecap(runId: id)
        }
        .navigationBarBackButtonHidden(true)
    }
}
