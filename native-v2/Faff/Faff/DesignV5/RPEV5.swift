import SwiftUI

// MARK: - RPECaptureRow · the post-run brief's "Add effort/RPE where supported"
//
// The brief names this control by example when it writes the accessibility
// rule it exists to satisfy: "Do not place ten tiny RPE buttons in one fixed
// row at accessibility sizes." The app already had an RPE control —
// `RPEEntryCard` in `Components/Toolkit/I_RunDetail.swift` — and it is
// exactly that anti-pattern: a single `HStack` of ten 30pt-tall buttons that
// overlaps and clips well before the top of the Dynamic Type range. It is
// also, as of this file, unreachable: nothing in the app instantiates it, and
// `RunDetailV5`/`TodayAfterV5` — the two screens the post-run brief actually
// governs — route through neither it nor its API calls. `post_run_rpe` holds
// rows in production from before the V5 migration; today there is no way for
// the runner to log one.
//
// THE PATTERN, NOT A NEW ONE. `ExpandingRow` is already this app's one
// picker interaction — the niggle row in `TodayAfterV5` uses it for exactly
// this shape: collapsed row with a value, tap to expand, pick, collapse. This
// file adds the RPE scale as another `ExpandingRow`'s expanded content
// instead of a bespoke card, so it inherits the row's own accessibility
// contract (the "Expanded"/"Collapsed" `accessibilityValue`, the 58pt
// collapsed target, `V5.Motion.expand`'s reduced-motion handling) for free.
//
// THE GRID REFLOWS, IT DOES NOT SHRINK. A `LazyVGrid` with an adaptive
// column means five-across at the app's default size and MORE ROWS, not
// smaller buttons, once Dynamic Type asks for more width than five 44pt
// cells and their spacing can hold in the page's gutter. That is the
// brief's "Dynamic Type must preserve hierarchy" applied to a numeric
// picker: every cell stays a real 44pt target at every text size, and nine
// is never quietly harder to read than one.
//
// NO SEVERITY COLOUR. The legacy card graded 1-3/4-6/7-10 into three colours,
// one of them green — which the design brief retired app-wide as a grade
// colour. An RPE is the runner's own report, not a coach verdict, so this
// picker uses the one accent (`V5.signal`) for "selected" and nothing else,
// the same rule `RunAnalysisV5`'s layer picker already follows.

struct RPECaptureRow: View {
    let runId: String

    @State private var isExpanded = false
    @State private var loaded = false
    @State private var priorRpe: Int? = nil
    @State private var priorNotes: String = ""
    @State private var pickedRpe: Int? = nil
    @State private var notes: String = ""
    @State private var submitting = false
    @State private var submitError: String? = nil

    private static let columns = [GridItem(.adaptive(minimum: 44), spacing: V5.S.s8)]

    var body: some View {
        ExpandingRow(
            label: "Effort",
            sub: priorRpe == nil ? "How hard did that feel" : nil,
            value: collapsedValue,
            question: "How hard did that feel, 1 to 10",
            isExpanded: $isExpanded
        ) {
            VStack(alignment: .leading, spacing: V5.S.s12) {
                scaleEndpoints
                grid
                if let notesLine {
                    Text(notesLine)
                        .font(.faffText(TypeScaleV5.label13))
                        .foregroundStyle(V5.textQuiet)
                        .italic()
                        .fixedSize(horizontal: false, vertical: true)
                } else if pickedRpe != nil {
                    notesField
                }
                if let submitError {
                    Text(submitError)
                        .font(.faffText(TypeScaleV5.label13))
                        .foregroundStyle(V5.fault)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if pickedRpe != nil, pickedRpe != priorRpe || notes != priorNotes {
                    FaffButton(submitting ? "Saving…" : (priorRpe == nil ? "Save" : "Update"),
                               variant: .primary, size: .md,
                               enabled: !submitting) {
                        submit()
                    }
                }
            }
        }
        .task {
            guard !loaded else { return }
            loaded = true
            await loadPrior()
        }
    }

    // MARK: Collapsed value

    private var collapsedValue: FaffValue? {
        guard let priorRpe else { return .measured("Add") }
        return .measured("\(priorRpe) \u{00B7} \(Self.adjective(priorRpe))")
    }

    /// The prior note is shown only once it has already been saved — this
    /// is the row's own settled state, spoken exactly the way the niggle
    /// row states what it already knows, rather than a second editable
    /// field sitting under the one the runner is actively using.
    private var notesLine: String? {
        guard pickedRpe == priorRpe, !priorNotes.isEmpty else { return nil }
        return "\u{201C}\(priorNotes)\u{201D}"
    }

    // MARK: Scale endpoints

    private var scaleEndpoints: some View {
        HStack {
            Text("Easy")
            Spacer(minLength: V5.S.s8)
            Text("Max")
        }
        .font(.faffText(TypeScaleV5.label12, weight: .medium))
        .foregroundStyle(V5.textQuiet)
        .accessibilityHidden(true) // spoken per-cell instead; see `cellLabel`
    }

    // MARK: The grid

    private var grid: some View {
        LazyVGrid(columns: Self.columns, spacing: V5.S.s8) {
            ForEach(1...10, id: \.self) { n in
                let selected = pickedRpe == n
                Button {
                    pickedRpe = n
                } label: {
                    Text("\(n)")
                        .font(.faffText(TypeScaleV5.body15, weight: .semibold))
                        .monospacedDigit()
                        .foregroundStyle(selected ? V5.surfacePage : V5.textPrimary)
                        .frame(minWidth: 44, minHeight: 44)
                        .frame(maxWidth: .infinity)
                        .background(selected ? V5.signal : V5.materialTile,
                                    in: RoundedRectangle(cornerRadius: V5.R.r10, style: .continuous))
                }
                .buttonStyle(V5PressStyle())
                .accessibilityLabel(Self.cellLabel(n))
                .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
            }
        }
    }

    private static func cellLabel(_ n: Int) -> String {
        "\(n) of 10, \(adjective(n))"
    }

    private static func adjective(_ n: Int) -> String {
        switch n {
        case 1...2: return "very easy"
        case 3:     return "easy"
        case 4:     return "moderate"
        case 5...6: return "comfortably hard"
        case 7:     return "hard"
        case 8...9: return "very hard"
        default:    return "max"
        }
    }

    // MARK: Notes

    private var notesField: some View {
        ZStack(alignment: .topLeading) {
            TextEditor(text: $notes)
                .font(.faffText(TypeScaleV5.body15))
                .foregroundStyle(V5.textPrimary)
                .scrollContentBackground(.hidden)
                .frame(minHeight: 60)
                .padding(V5.S.s8)
                .background(V5.materialTile, in: RoundedRectangle(cornerRadius: V5.R.r10, style: .continuous))
            if notes.isEmpty {
                Text("Anything worth noting? Legs, weather, how it sat.")
                    .font(.faffText(TypeScaleV5.body15))
                    .foregroundStyle(V5.textQuiet)
                    .padding(.horizontal, V5.S.s12)
                    .padding(.vertical, V5.S.s12)
                    .allowsHitTesting(false)
            }
        }
        .accessibilityLabel("Notes")
    }

    // MARK: Network

    private func loadPrior() async {
        guard let r = try? await API.fetchRPE(runId: runId), let v = r.rpe else { return }
        await MainActor.run {
            priorRpe = v.rpe
            priorNotes = v.notes ?? ""
            pickedRpe = v.rpe
            notes = v.notes ?? ""
        }
    }

    private func submit() {
        guard let rpe = pickedRpe, !submitting else { return }
        submitting = true
        submitError = nil
        Task {
            do {
                let ok = try await API.postRPE(runId: runId, rpe: rpe, notes: notes.isEmpty ? nil : notes)
                await MainActor.run {
                    submitting = false
                    if ok {
                        priorRpe = rpe
                        priorNotes = notes
                        withAnimation(V5.Motion.expand) { isExpanded = false }
                    } else {
                        submitError = "Could not save. Try again."
                    }
                }
            } catch {
                await MainActor.run {
                    submitting = false
                    submitError = "Could not save. Try again."
                }
            }
        }
    }
}
