//
//  CourseImportV5.swift
//  faff.run iPhone · screen 20b, "Add a race · course import".
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE RACE IS ALREADY SAVED BY THE TIME THIS RENDERS
//
//  That is the whole reason the 0821 handoff splits add-a-race into a sheet
//  and a pushed screen rather than making the course a second sheet step:
//  the course involves a real network round trip, and "failure never blocks
//  the race from saving — the race is the important object and the course is
//  secondary."
//
//  So this screen can only ever ADD something. Every exit from it leaves the
//  race intact, which is why "Skip for now" and "Add the course manually" sit
//  here permanently rather than appearing when something goes wrong. They are
//  not error recovery; they are two of the three normal endings.
//
//  ─────────────────────────────────────────────────────────────────────────
//  FOUR STATES, AND WHAT EACH ONE IS ALLOWED TO SAY
//
//  idle     · paste a link, or search by name
//  loading  · a skeleton that reserves the found state's height. NO shimmer —
//             the system's motion rule is that nothing pulses.
//  found    · the course, its distance, a mini profile, and an amber `~` note
//             when the found distance disagrees with what was entered
//  failed   · `Alert` at fault tone. "We could not read this", never a fact
//             about the runner, and never the outage screen — the race is
//             fine, one lookup is not.
//

import SwiftUI

struct CourseImportV5: View {
    /// The race this course attaches to. It exists already.
    let raceSlug: String
    /// What the runner typed on 20a, used to seed the name search and to
    /// notice when a found course is a different distance.
    let raceName: String
    let enteredDistanceMi: Double?

    var onBack: () -> Void = {}
    /// The course is attached, or deliberately not. Either way the flow ends.
    var onDone: () -> Void = {}

    enum Phase: Equatable {
        case idle
        case loading
        case found([GpxCandidateV5])
        case failed(String)
    }

    @State private var url: String = ""
    @State private var phase: Phase = .idle
    @State private var attaching = false
    @State private var attachFailed: String?

    private var trimmedURL: String { url.trimmingCharacters(in: .whitespaces) }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                AppBar(title: "Course", onBack: onBack)

                VStack(alignment: .leading, spacing: V5.S.s24) {
                    header
                    lookupField
                    stateBody
                    escapes
                }
                .padding(.horizontal, V5.S.gutter)
                .padding(.bottom, V5.S.s32)
            }
        }
        .background(V5.surfacePage)
        .navigationBarBackButtonHidden(true)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: V5.S.s8) {
            Text("Pull it in from somewhere")
                .faffDisplayV5(TypeScaleV5.display38, fit: .free)
                .foregroundStyle(V5.textPrimary)
            Text("Paste a Strava route link or the race's own page. We read the distance and elevation off it.")
                .font(.faffText(TypeScaleV5.body15))
                .foregroundStyle(V5.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var lookupField: some View {
        VStack(alignment: .leading, spacing: V5.S.s12) {
            FaffInput(label: "Link", text: $url,
                      placeholder: "strava.com/routes/\u{2026}",
                      keyboard: .URL)
            FaffButton(isLoading ? "Reading the link\u{2026}" : "Look up",
                       variant: .secondary, size: .md, full: true,
                       enabled: !isLoading,
                       action: { Task { await lookUp() } })
        }
    }

    private var isLoading: Bool { if case .loading = phase { return true } else { return false } }

    @ViewBuilder
    private var stateBody: some View {
        switch phase {
        case .idle:
            EmptyView()

        case .loading:
            // Reserves the found state's height so nothing reflows when it
            // resolves, and does not pulse — "nothing bounces, pulses, or
            // scales up" is a system rule, not a preference.
            VStack(alignment: .leading, spacing: V5.S.s10) {
                skeletonBar(width: 0.55, height: 20)
                skeletonBar(width: 0.34, height: 15)
                skeletonBar(width: 1.0, height: 72)
            }

        case .found(let candidates):
            VStack(alignment: .leading, spacing: V5.S.s12) {
                V5SectionLabel(text: candidates.count > 1 ? "Which one" : "Found")
                    .padding(.horizontal, V5.S.s4)
                ListGroup {
                    ForEach(candidates) { c in
                        ListRow(label: c.name,
                                sub: mismatchNote(for: c),
                                value: FaffValue.from(FaffFmt.milesUnit(c.distanceMi), modelled: false),
                                onTap: { Task { await attach(c) } })
                    }
                }
                if let attachFailed {
                    Alert(text: attachFailed, tone: .fault)
                }
            }

        case .failed(let reason):
            // Fault tone: we could not read the link. Never a statement about
            // the runner, and never the data-outage screen — the race saved.
            Alert(text: reason, tone: .fault)
        }
    }

    /// The amber mark earns its place only when the two distances actually
    /// disagree — a found course that matches what was entered needs no note.
    private func mismatchNote(for c: GpxCandidateV5) -> String? {
        guard let entered = enteredDistanceMi, entered > 0 else { return nil }
        guard abs(c.distanceMi - entered) >= 0.3 else { return nil }
        let found = FaffFmt.milesUnit(c.distanceMi) ?? "\(c.distanceMi) mi"
        let said = FaffFmt.milesUnit(entered) ?? "\(entered) mi"
        return "This course is \(found) \u{00B7} you entered \(said)"
    }

    private var escapes: some View {
        ListGroup {
            ListRow(label: "Add the course manually",
                    sub: "Distance only, no elevation",
                    onTap: onDone)
            ListRow(label: "Skip for now",
                    sub: "The race saves without a course \u{00B7} add one later",
                    onTap: onDone)
        }
    }

    /// A placeholder block at a fraction of the content width. Static — the
    /// system's motion rule is that nothing pulses, so a skeleton reserves
    /// space and says nothing else.
    private func skeletonBar(width: CGFloat, height: CGFloat) -> some View {
        GeometryReader { geo in
            RoundedRectangle(cornerRadius: V5.R.r10, style: .continuous)
                .fill(V5.materialTile)
                .frame(width: geo.size.width * width, height: height)
        }
        .frame(height: height)
    }

    // MARK: - Work

    private func lookUp() async {
        attachFailed = nil
        phase = .loading
        // A pasted URL is exact and immediate. Fall back to searching by the
        // race's own name only when there is nothing to paste.
        if !trimmedURL.isEmpty {
            let ok = (try? await API.importStravaRoute(slug: raceSlug, stravaUrl: trimmedURL)) ?? false
            if ok { onDone(); return }
            phase = .failed("Could not read that link. It might be private, or not a route or race page.")
            return
        }
        guard !raceName.trimmingCharacters(in: .whitespaces).isEmpty else {
            phase = .failed("Paste a link, or name the race so we can look for its route.")
            return
        }
        let result = await API.searchGpxCandidates(query: raceName, distanceMi: enteredDistanceMi)
        let candidates = result?.candidates ?? []
        phase = candidates.isEmpty
            ? .failed("Nothing came back for that name. Paste a link instead, or add the course later.")
            : .found(candidates)
    }

    private func attach(_ c: GpxCandidateV5) async {
        guard !attaching else { return }
        attaching = true
        defer { attaching = false }
        let ok = await API.importGpxCandidate(raceSlug: raceSlug, source: c.source, sourceId: c.sourceId)
        if ok { onDone() }
        else { attachFailed = "Could not attach that course. The race is saved either way." }
    }
}
