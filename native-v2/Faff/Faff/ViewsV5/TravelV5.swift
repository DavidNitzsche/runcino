//
//  TravelV5.swift
//  faff.run iPhone · travel windows (TRAVEL-1, 2026-08-28).
//
//  A bottom sheet off Settings. Owner ruling: travel is "something the phone
//  should surface, not me and you in the backend" — the runner tells the app
//  the dates they are away, and the plan keeps them running through the
//  window: easy days stay, quality and the long run land on home days where
//  the week has room. The engine side is web-v2/lib/plan/travel-windows.ts;
//  this screen's only job is getting the dates in and out.
//
//  Like AddRaceV5 (and for the same stated reason), this file owns its own
//  network calls: list, save, and remove are a real multi-request flow with a
//  reload after every write, and threading five closures through
//  SettingsHostV5 would move the whole flow into HostsV5.swift to avoid four
//  lines here. Built entirely in the existing language — V5SheetHost,
//  ListGroup/ListRow, FaffInput, FaffButton, ExpandingRow — no new component,
//  no new token.
//
//  Distinct from BlockV5's change-the-plan "Travel" scenario, which means
//  "days I cannot run · take them out". A travel window means the opposite —
//  still running, easy-preferred — which is why the copy here never says
//  "away from running".
//

import SwiftUI

// MARK: - The sheet

struct TravelSheetV5: View {
    var onClose: () -> Void = {}

    @State private var windows: [TravelWindowWire] = []
    @State private var loading = true
    @State private var loadFailed = false
    /// Non-nil → the form is open, either for a new window (id nil) or an
    /// existing one.
    @State private var editing: EditState? = nil
    @State private var saving = false
    @State private var saveFailed = false
    /// One line under the list after a successful write · says whether the
    /// plan reshaped.
    @State private var notice: String? = nil

    struct EditState {
        var id: Int? = nil
        var start: Date
        var end: Date
        var note: String = ""
    }

    private static let isoFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = .current
        return f
    }()

    private static func displayRange(_ startISO: String, _ endISO: String) -> String {
        let f = DateFormatter()
        f.dateFormat = "MMM d"
        guard let s = isoFormatter.date(from: startISO),
              let e = isoFormatter.date(from: endISO) else { return "\(startISO) \u{b7} \(endISO)" }
        if startISO == endISO { return f.string(from: s) }
        return "\(f.string(from: s)) \u{2013} \(f.string(from: e))"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: V5.S.s20) {
            header
            if let e = editing {
                form(e)
            } else {
                list
            }
        }
        .task { await load() }
    }

    // MARK: Header

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            Button(editing == nil ? "Done" : "Back") {
                if editing == nil { onClose() } else { editing = nil; saveFailed = false }
            }
            .font(.faffText(TypeScaleV5.body15, weight: .semibold))
            .foregroundStyle(V5.textSecondary)
            Spacer(minLength: V5.S.s8)
            Text(editing == nil ? "Travel" : (editing?.id == nil ? "Add travel" : "Edit travel"))
                .font(.faffDisplay(17))
                .foregroundStyle(V5.textPrimary)
            Spacer(minLength: V5.S.s8)
            Color.clear.frame(width: 52, height: 1)
        }
        .padding(.horizontal, V5.S.s4)
    }

    // MARK: List

    private var list: some View {
        VStack(alignment: .leading, spacing: V5.S.s16) {
            ScrollView {
                VStack(alignment: .leading, spacing: V5.S.s16) {
                    Text("Tell the plan when you are away. Easy days stay easy days \u{b7} quality and the long run land on home days where the week has room.")
                        .font(.faffText(TypeScaleV5.body15))
                        .foregroundStyle(V5.textSecondary)
                        .lineSpacing(3)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, V5.S.s4)

                    if loading {
                        Skeleton(lines: 3)
                    } else if loadFailed {
                        ErrorNote(text: "Could not load your travel dates. Check your connection and try again.",
                                  onRetry: { Task { await load() } })
                    } else if windows.isEmpty {
                        Text("No travel on file.")
                            .font(.faffText(TypeScaleV5.label13))
                            .foregroundStyle(V5.textQuiet)
                            .padding(.horizontal, V5.S.s4)
                    } else {
                        ListGroup {
                            ForEach(windows) { w in
                                ListRow(label: Self.displayRange(w.start_date, w.end_date),
                                        sub: w.note,
                                        onTap: { openEditor(w) })
                            }
                        }
                    }

                    if let notice {
                        Text(notice)
                            .font(.faffText(TypeScaleV5.label13))
                            .foregroundStyle(V5.textQuiet)
                            .padding(.horizontal, V5.S.s4)
                    }
                }
                .padding(.horizontal, V5.S.s2)
            }
            .scrollIndicators(.hidden)
            .frame(maxHeight: .infinity, alignment: .top)

            FaffButton("Add travel", variant: .primary, size: .lg, full: true,
                       enabled: !loading,
                       action: { openEditor(nil) })
        }
    }

    private func openEditor(_ w: TravelWindowWire?) {
        notice = nil
        saveFailed = false
        if let w,
           let s = Self.isoFormatter.date(from: w.start_date),
           let e = Self.isoFormatter.date(from: w.end_date) {
            editing = EditState(id: w.id, start: s, end: e, note: w.note ?? "")
        } else {
            let tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: Date()) ?? Date()
            editing = EditState(start: tomorrow, end: tomorrow)
        }
    }

    // MARK: Form

    private func form(_ e: EditState) -> some View {
        VStack(alignment: .leading, spacing: V5.S.s16) {
            ScrollView {
                VStack(alignment: .leading, spacing: V5.S.s16) {
                    TravelDateFieldV5(label: "First day away",
                                      date: Binding(
                                        get: { editing?.start ?? e.start },
                                        set: { d in
                                            editing?.start = d
                                            if let end = editing?.end, end < d { editing?.end = d }
                                        }))
                    TravelDateFieldV5(label: "Last day away",
                                      floor: editing?.start,
                                      date: Binding(
                                        get: { editing?.end ?? e.end },
                                        set: { editing?.end = $0 }))
                    FaffInput(label: "Note",
                              text: Binding(get: { editing?.note ?? "" },
                                            set: { editing?.note = $0 }),
                              placeholder: "e.g. Thanksgiving",
                              helper: "Optional. Shows on the list so future you knows which trip this was.")

                    if saveFailed {
                        ErrorNote(text: "That did not save. Nothing was written, so it is safe to try again.",
                                  onRetry: { Task { await save() } })
                    }

                    if editing?.id != nil {
                        FaffButton("Remove this trip", variant: .destructive, size: .md, full: true,
                                   enabled: !saving,
                                   action: { Task { await remove() } })
                    }
                }
                .padding(.horizontal, V5.S.s2)
            }
            .scrollIndicators(.hidden)
            .frame(maxHeight: .infinity, alignment: .top)

            FaffButton(saving ? "Saving\u{2026}" : "Save",
                       variant: .primary, size: .lg, full: true,
                       enabled: !saving,
                       action: { Task { await save() } })
        }
    }

    // MARK: Network

    private func load() async {
        loading = true
        loadFailed = false
        if let fetched = try? await API.fetchTravelWindows() {
            windows = fetched
        } else {
            loadFailed = true
        }
        loading = false
    }

    private func save() async {
        guard let e = editing else { return }
        saving = true
        saveFailed = false
        let ack = try? await API.saveTravelWindow(
            id: e.id,
            startDate: Self.isoFormatter.string(from: e.start),
            endDate: Self.isoFormatter.string(from: max(e.start, e.end)),
            note: e.note)
        saving = false
        guard ack != nil else { saveFailed = true; return }
        editing = nil
        notice = ack?.replanned == true
            ? "Saved. The plan reshaped around your trip \u{b7} check the week."
            : "Saved. The next plan build will work around it."
        await load()
    }

    private func remove() async {
        guard let id = editing?.id else { return }
        saving = true
        saveFailed = false
        let ack = try? await API.deleteTravelWindow(id: id)
        saving = false
        guard ack != nil else { saveFailed = true; return }
        editing = nil
        notice = ack?.replanned == true
            ? "Removed. The plan reshaped \u{b7} check the week."
            : "Removed."
        await load()
    }
}

// MARK: - Date field
//
// Same shape as AddRaceV5's `RaceDateFieldV5` — an `ExpandingRow` opening a
// `.graphical` `DatePicker`, the app's one picker pattern. Not shared with
// that one because its range is fixed at tomorrow…+3y; a travel window can
// legitimately start today (the runner is at the airport) and the end field
// is floored at the start.

private struct TravelDateFieldV5: View {
    let label: String
    var floor: Date? = nil
    @Binding var date: Date
    @State private var open = false

    private var range: ClosedRange<Date> {
        let cal = Calendar.current
        let lo = floor ?? cal.startOfDay(for: Date())
        let hi = cal.date(byAdding: .year, value: 1, to: Date()) ?? Date()
        return lo...(max(lo, hi))
    }

    private var display: String {
        let f = DateFormatter()
        f.dateStyle = .medium
        return f.string(from: date)
    }

    var body: some View {
        ExpandingRow(label: label, value: .measured(display), question: label, isExpanded: $open) {
            DatePicker("", selection: $date, in: range, displayedComponents: .date)
                .datePickerStyle(.graphical)
                .labelsHidden()
                .tint(V5.signal)
        }
    }
}

// MARK: - Preview

#Preview("Travel · sheet") {
    ZStack {
        V5.surfacePage.ignoresSafeArea()
        V5SheetHost(isPresented: .constant(true), tall: true) {
            TravelSheetV5()
        }
    }
}
