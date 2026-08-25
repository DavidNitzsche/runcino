//
//  ComponentsV5.swift
//  faff.run iPhone · the v5 design system's components, in SwiftUI.
//
//  These are the components the approved prototype imports by name. Their
//  prop signatures are taken verbatim from its markup, so porting a screen is
//  a substitution:
//
//      <x-import …ListRow label="Shoes" sub="Endorphin Speed" value="238 mi"
//                onClick="{{ pickShoe }}">
//                                    ↓
//      ListRow(label: "Shoes", sub: "Endorphin Speed",
//              value: .measured("238 mi"), onTap: pickShoe)
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE FOUR RULES, AS THEY LAND IN THIS FILE
//
//  1 · A MODELLED NUMBER MUST NEVER LOOK MEASURED. Every component that shows
//      a number takes a `FaffValue`, not a `String`. There is no way to put a
//      projected finish time into a `ListRow` without saying it is projected.
//
//  2 · ONE SIGNAL NEVER CHANGES A SESSION. Not this file's job to enforce —
//      the engine gates it — but `CoachSay` is where the copy lands, so see
//      `ConvergenceNote` in ChartsV5 for the shape that names three domains.
//
//  3 · A REFUSAL IS A CORRECT ANSWER, NOT AN EMPTY STATE. Three components,
//      three different jobs, and they must never be swapped:
//
//        `Alert`      we read it and the answer is no.   Attention amber.
//                     No confirm button — there is nothing to confirm.
//        `ErrorNote`  we could not read this.            Fault red. Retry.
//        `Silence`    there is nothing honest to say.    Quiet. Designed.
//
//      Using `ErrorNote` for a refusal tells the runner the app is broken.
//      Using `Alert` for an outage tells them the answer is no when we simply
//      could not see. Pick by which sentence is true.
//
//  4 · COACH VOICE. Short, direct. No hype, no exclamation marks, no emoji,
//      no em dashes. Never scold. `CoachSay` does not style its way out of
//      bad copy — the copy is the component.
//
//  ─────────────────────────────────────────────────────────────────────────
//  CONTAINMENT
//
//  No borders anywhere. A tile is a fill-step change; a tile inside a tile
//  steps up one level. Nothing in this file draws a hairline, and nothing
//  should be added that does.
//

import SwiftUI

// MARK: - Section label
//
// The small tracked uppercase register that titles a group. Below 20pt the
// display face is not used at all (see FontsV5), so `Font.faffDisplay` hands
// back the text face in bold and the tracking does the rest.

struct V5SectionLabel: View {
    let text: String
    var color: Color = V5.textSecondary
    var size: CGFloat = TypeScaleV5.body15
    /// A section label titles a group, and that is a heading. The one case it
    /// is not is a label used as a chip or an inline kind marker — the coach
    /// log's "week-close" tag sits beside a date, not above a group.
    var isHeading: Bool = true

    var body: some View {
        Text(text)
            .font(.faffDisplay(size))
            .textCase(.uppercase)
            .tracking(size * 0.06)
            .foregroundStyle(color)
            // WITHOUT THIS THE ROTOR FINDS NOTHING.
            //
            // Every group on every v5 screen is titled by one of these, and
            // they were all plain static text. VoiceOver's Headings rotor —
            // the way a screen reader user skips a screen instead of swiping
            // through it one element at a time — returned an empty list on
            // Today, on Races, on all of them. Today alone has six groups and
            // roughly forty elements; without headings that is forty swipes.
            .accessibilityAddTraits(isHeading ? .isHeader : [])
    }
}

// MARK: - Tile

/// A tile on the page. Radius 22, `--material-tile`, padding 18–20.
struct Tile<Content: View>: View {
    var fill: Color = V5.materialTile
    var radius: CGFloat = V5.R.r22
    var padding: CGFloat = V5.S.tilePad
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: V5.S.s12) { content() }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(padding)
            .background(fill, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
    }
}

// MARK: - AppBar
//
// Pushed screens are AppBar + plain list. They do NOT get a gradient panel —
// that is the shell exception the README names.

struct AppBar: View {
    let title: String
    /// A quiet line above the title. Race detail puts the date here.
    var eyebrow: String? = nil
    var onBack: (() -> Void)? = nil

    var body: some View {
        // Top-aligned, not centre-aligned. A long race name wraps to two or
        // three lines, and a vertically-centred chevron then sits ON the
        // title. The button belongs beside the FIRST line.
        HStack(alignment: .top, spacing: V5.S.s12) {
            if let onBack {
                Button(action: onBack) {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(V5.textPrimary)
                        .frame(width: V5.Shell.headerButton, height: V5.Shell.headerButton)
                        .background(V5.materialControl, in: Circle())
                        // Same rule as the header discs: the drawn circle stays
                        // 30, the target grows to 44 and the negative padding
                        // gives the layout its 30pt footprint back. Here the
                        // button is alone on its side of the row, so the full
                        // 44×44 is reachable with nothing to steal it from.
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(-7)
                .accessibilityLabel("Back")
            }
            VStack(alignment: .leading, spacing: V5.S.s2) {
                if let eyebrow {
                    Text(eyebrow)
                        .font(.faffText(TypeScaleV5.label13))
                        .foregroundStyle(V5.textQuiet)
                }
                Text(title)
                    .font(.faffDisplay(20))
                    .textCase(.uppercase)
                    .tracking(20 * 0.02)
                    .foregroundStyle(V5.textPrimary)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, V5.S.gutter)
        .frame(height: V5.Shell.appBarHeight, alignment: .bottom)
        .padding(.bottom, V5.S.s12)
        .frame(maxWidth: .infinity)
        .background(V5.surfacePage)
    }
}

// MARK: - ListGroup / ListRow
//
// The app's list primitive. Header and footer sit OUTSIDE the tile in the
// small tracked register; the rows sit flush inside it with no dividers,
// because containment is a fill change and never a hairline.

struct ListGroup<Content: View>: View {
    var header: String? = nil
    var footer: String? = nil
    @ViewBuilder var rows: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: V5.S.s10) {
            if let header {
                V5SectionLabel(text: header).padding(.horizontal, V5.S.s4)
            }
            VStack(spacing: 0) { rows() }
                .background(V5.materialTile,
                            in: RoundedRectangle(cornerRadius: V5.R.r22, style: .continuous))
                .clipShape(RoundedRectangle(cornerRadius: V5.R.r22, style: .continuous))
            if let footer {
                Text(footer)
                    .font(.faffText(TypeScaleV5.label13))
                    .foregroundStyle(V5.textQuiet)
                    .padding(.horizontal, V5.S.s4)
            }
        }
    }
}

/// One row. 58pt tall.
///
/// A chevron appears only when the row opens something. "Never a chevron on a
/// row that has nothing to open" — and the app's one picker interaction is
/// expand-in-place, so a row that EDITS something uses `ExpandingRow` below
/// rather than a chevron.
struct ListRow: View {
    let label: String
    var sub: String? = nil
    var value: FaffValue? = nil
    /// Overrides the value's ink, from the engine's own `tone`. Nil keeps the
    /// row quiet, which is what an untoned value must stay — same contract as
    /// `PanelStat.ink`, and `V5Tone.inkOverride` is how a caller gets one.
    var valueInk: Color? = nil
    /// Paints the row one step up. The calendar marks today this way.
    var raised: Bool = false
    var onTap: (() -> Void)? = nil

    var body: some View {
        let content = HStack(alignment: .center, spacing: V5.S.s12) {
            VStack(alignment: .leading, spacing: V5.S.s2) {
                Text(label)
                    .font(.faffText(16, weight: .medium))
                    .foregroundStyle(V5.textPrimary)
                if let sub {
                    Text(sub)
                        .font(.faffText(TypeScaleV5.label13))
                        .foregroundStyle(V5.textQuiet)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: V5.S.s8)
            if let value {
                FaffValueText(value, font: .faffText(TypeScaleV5.body15), color: valueInk ?? V5.textSecondary)
                    .multilineTextAlignment(.trailing)
            }
            if onTap != nil {
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(V5.textQuiet)
            }
        }
        .padding(.horizontal, V5.S.tilePad)
        // A one-line row sits at exactly the 58pt the design specifies: the
        // label and sub come to 38pt, and this makes up the rest. A row whose
        // sub WRAPS then keeps the same breathing room instead of growing
        // past 58 with none — which is what put "…nothing else moves." hard
        // against "Travel" in the change-the-plan menu.
        .padding(.vertical, 10)
        .frame(minHeight: 58)
        .frame(maxWidth: .infinity)
        .background(raised ? V5.materialTileRaised : Color.clear)
        // ─────────────────────────────────────────────────────────────────
        // WITHOUT THIS, A ROW IS ONLY TAPPABLE ON ITS LETTERS
        //
        // `Color.clear` is not hit-testable in SwiftUI, so a row whose only
        // background is clear has no hit area of its own — the Button's
        // target collapses onto the glyphs of the label and the chevron, and
        // the whole middle of the row is dead space.
        //
        // It took a while to see because tapping a row usually LOOKS like it
        // should work: aim at the text and it does. Settings and Shoes read
        // as dead rows for exactly this reason, and every ListRow in the app
        // had it.
        .contentShape(Rectangle())

        if let onTap {
            Button(action: onTap) { content }
                .buttonStyle(V5PressStyle())
        } else {
            content
        }
    }
}

/// The press feedback the design allows: 120ms, a fill change, no scale.
/// "Nothing bounces, pulses, or scales up."
struct V5PressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(configuration.isPressed ? Color.white.opacity(0.06) : .clear)
            .animation(V5.Motion.press, value: configuration.isPressed)
    }
}

// MARK: - Expand in place
//
// "Expand-in-place is the app's one interaction pattern for pickers: a row
//  that's editable expands its own group (header naming what's being asked,
//  the options, then collapses) — never a full-screen picker."

struct ExpandingRow<Expanded: View>: View {
    let label: String
    var sub: String? = nil
    var value: FaffValue? = nil
    /// Names what is being asked, shown at the top of the expansion.
    var question: String
    @Binding var isExpanded: Bool
    @ViewBuilder var expanded: () -> Expanded

    var body: some View {
        VStack(spacing: 0) {
            Button {
                withAnimation(V5.Motion.expand) { isExpanded.toggle() }
            } label: {
                HStack(alignment: .center, spacing: V5.S.s12) {
                    VStack(alignment: .leading, spacing: V5.S.s2) {
                        Text(label)
                            .font(.faffText(16, weight: .medium))
                            .foregroundStyle(V5.textPrimary)
                        if let sub {
                            Text(sub)
                                .font(.faffText(TypeScaleV5.label13))
                                .foregroundStyle(V5.textQuiet)
                        }
                    }
                    Spacer(minLength: V5.S.s8)
                    if let value, !isExpanded {
                        FaffValueText(value, font: .faffText(TypeScaleV5.body15), color: V5.textSecondary)
                    }
                    Image(systemName: "chevron.down")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(V5.textQuiet)
                        .rotationEffect(.degrees(isExpanded ? 180 : 0))
                }
                .padding(.horizontal, V5.S.tilePad)
                .frame(minHeight: 58)
                .frame(maxWidth: .infinity)
                .contentShape(Rectangle())
            }
            .buttonStyle(V5PressStyle())
            // Expand-in-place is the app's one picker interaction, and the
            // only thing that said whether a row was open was a chevron that
            // had rotated 180°. A rotation is not a label.
            //
            // There is no `expanded` TRAIT on iOS — UIKit and SwiftUI both
            // leave it to the element's value — so the state is spoken as the
            // row's value, which is where VoiceOver reads a control's current
            // setting from.
            .accessibilityValue(isExpanded ? "Expanded" : "Collapsed")

            if isExpanded {
                VStack(alignment: .leading, spacing: V5.S.s10) {
                    Text(question)
                        .font(.faffText(TypeScaleV5.label13))
                        .foregroundStyle(V5.textQuiet)
                    expanded()
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, V5.S.tilePad)
                .padding(.bottom, V5.S.s16)
                .transition(.opacity)
            }
        }
        .background(isExpanded ? V5.materialTileRaised : Color.clear)
    }
}

// MARK: - CoachSay
//
// The coach's own line. Short, direct, no hype, no exclamation marks, no
// emoji, no em dashes, never scolding.

struct CoachSay: View {
    enum Size { case sm, md }

    let text: String
    var size: Size = .md
    /// A quiet attribution beneath. Usually nil — the coach does not sign off.
    var attribution: String? = nil
    /// `dc-props="{{ coachFlush }}"` in the prototype: no padding, for a line
    /// that already sits inside a padded group.
    var flush: Bool = false

    private var font: Font {
        .faffText(size == .md ? TypeScaleV5.body17 : TypeScaleV5.body15)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: V5.S.s6) {
            Text(text)
                .font(font)
                .foregroundStyle(V5.textPrimary)
                .lineSpacing(4)
                .fixedSize(horizontal: false, vertical: true)
            if let attribution {
                Text(attribution)
                    .font(.faffText(TypeScaleV5.label12))
                    .foregroundStyle(V5.textQuiet)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(flush ? 0 : V5.S.tilePad)
        .background(flush ? Color.clear : V5.materialTile,
                    in: RoundedRectangle(cornerRadius: V5.R.r22, style: .continuous))
    }
}

/// The quieter line that sits under a CoachSay when a forecast carries a
/// caveat. "Caveats get quieter treatment than the trade-off."
struct CoachCaveat: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.faffText(TypeScaleV5.label13))
            .foregroundStyle(V5.textQuiet)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, V5.S.s4)
    }
}

// MARK: - Alert · A REFUSAL IS A CORRECT ANSWER
//
// The engine declined on purpose. A week that cannot carry quality, a
// distance we do not plan, a goal out of reach, a change that cannot be
// satisfied. This is NOT the outage treatment: we read it, and the answer is
// no. There is no confirm button, because there is nothing to confirm.

struct Alert: View {
    enum Tone { case attention, fault }

    let text: String
    var tone: Tone = .attention

    private var ink: Color { tone == .attention ? V5.attention : V5.fault }

    var body: some View {
        VStack(alignment: .leading, spacing: V5.S.s8) {
            Text(text)
                .font(.faffText(TypeScaleV5.body15))
                .foregroundStyle(V5.textPrimary)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(V5.S.tilePad)
        .background(V5.materialTile, in: RoundedRectangle(cornerRadius: V5.R.r22, style: .continuous))
        .overlay(alignment: .leading) {
            // Not a border. A fill mark, 3pt, inside the tile's own radius —
            // the one thing that separates "the answer is no" from a note.
            RoundedRectangle(cornerRadius: V5.R.r6, style: .continuous)
                .fill(ink)
                .frame(width: 3)
                .padding(.vertical, V5.S.s12)
                .padding(.leading, V5.S.s6)
        }
    }
}

// MARK: - WriteNote · WHAT CAME BACK FROM A WRITE
//
// A tap that posts something has three endings and only one of them is
// silence. Discarding the result collapses all three into silence: the runner
// taps, the same card re-renders unchanged, and nothing says why. That is how
// a write that the engine REFUSED, out loud, with a sentence, reads as a
// broken button.
//
// So the two non-silent endings get the two treatments the design already
// has, and the line between them is rule three's line: the engine declining
// is an answer (`Alert`), a write we could not complete is not (`ErrorNote`).

enum V5WriteOutcome: Equatable {
    /// The engine declined, and said why. Its words, never ours.
    case refused(String)
    /// We could not complete it. Never a refusal, and never dressed as one.
    case failed(String)
}

struct WriteNote: View {
    let outcome: V5WriteOutcome

    @ViewBuilder
    var body: some View {
        switch outcome {
        case .refused(let reason):
            Alert(text: reason, tone: .attention)
        case .failed(let text):
            ErrorNote(text: text)
        }
    }
}

// MARK: - ErrorNote · WE COULD NOT READ THIS
//
// The network-failure treatment, and only that. Fault red is never used to
// render a real value, so this component shows no value at all.

struct ErrorNote: View {
    /// The design's own copy, and the shape every other one should follow:
    /// what failed, then that the runner is fine, then what we cannot see.
    var text: String = "Readiness did not load. Your score is fine, we just cannot see it."
    var onRetry: (() -> Void)? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: V5.S.s12) {
            Text(text)
                .font(.faffText(TypeScaleV5.body15))
                .foregroundStyle(V5.textPrimary)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
            if let onRetry {
                FaffButton("Retry", variant: .secondary, size: .md, action: onRetry)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(V5.S.tilePad)
        .background(V5.materialTile, in: RoundedRectangle(cornerRadius: V5.R.r22, style: .continuous))
        .overlay(alignment: .leading) {
            RoundedRectangle(cornerRadius: V5.R.r6, style: .continuous)
                .fill(V5.fault)
                .frame(width: 3)
                .padding(.vertical, V5.S.s12)
                .padding(.leading, V5.S.s6)
        }
    }
}

// MARK: - Skeleton
//
// "Reserves the exact layout height, does not shimmer/pulse." Nothing in this
// system pulses, so the placeholder does not either. Give it the height the
// real content will take, so nothing appears, disappears, or reflows.

struct Skeleton: View {
    var lines: Int = 3
    /// The height one line reserves. Match the real content's line box.
    var lineHeight: CGFloat = 15
    var spacing: CGFloat = V5.S.s12

    var body: some View {
        VStack(alignment: .leading, spacing: spacing) {
            ForEach(0..<max(lines, 1), id: \.self) { i in
                RoundedRectangle(cornerRadius: V5.R.r6, style: .continuous)
                    .fill(V5.materialTileRaised)
                    .frame(height: lineHeight)
                    // The last line is short, the way a paragraph ends.
                    .frame(maxWidth: i == lines - 1 ? .infinity : .infinity)
                    .padding(.trailing, i == lines - 1 ? 96 : 0)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(V5.S.tilePad)
        .background(V5.materialTile, in: RoundedRectangle(cornerRadius: V5.R.r22, style: .continuous))
        // `.accessibilityLabel` ALONE WAS A NO-OP HERE.
        //
        // A label names an element; it does not create one. Every child of
        // this stack is a `RoundedRectangle`, and a Shape publishes nothing to
        // the accessibility tree — so there was no element for "Loading" to
        // attach to and VoiceOver skipped the placeholder in silence. The
        // runner heard the section header, then the section after it, with the
        // loading tile simply absent. `children: .ignore` is what promotes the
        // container into an element of its own.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading")
    }
}

// MARK: - Silence
//
// "The coach has nothing honest to say about a block that doesn't exist yet —
//  this is a designed empty state, not a missing one."
//
// So it does not apologise, does not offer a retry, and does not fill the
// space with a sentence invented to fill it. It states why it is quiet.

struct Silence: View {
    let reason: String

    var body: some View {
        Text(reason)
            .font(.faffText(TypeScaleV5.body15))
            .foregroundStyle(V5.textQuiet)
            .lineSpacing(3)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(V5.S.tilePad)
            .background(V5.surface1, in: RoundedRectangle(cornerRadius: V5.R.r22, style: .continuous))
    }
}

// MARK: - Button

struct FaffButton: View {
    enum Variant { case primary, secondary, ghost, destructive }
    enum Size { case md, lg }

    let title: String
    var variant: Variant = .primary
    var size: Size = .lg
    var full: Bool = true
    var enabled: Bool = true
    /// RULE THREE, made structural.
    ///
    /// A control that cannot be used must say WHY, not just dim. Dimming alone
    /// is the same failure as an empty state standing in for a refusal: the
    /// answer is "no" and the reason is missing, so the runner is left tapping
    /// a dead button working out what it wants. `AddRaceV5` had already
    /// written this by hand next to one of its buttons; four other call sites
    /// dimmed in silence. Putting it on the component means the next screen
    /// gets it for nothing, and the reason lives beside the control it
    /// explains instead of being remembered at each site.
    ///
    /// Renders only while `enabled` is false, quiet, under the button. Leave
    /// nil when the label itself already carries the reason — a button that
    /// reads "Saving…" has said why it is not tappable.
    var disabledReason: String? = nil
    let action: () -> Void

    init(_ title: String,
         variant: Variant = .primary,
         size: Size = .lg,
         full: Bool = true,
         enabled: Bool = true,
         disabledReason: String? = nil,
         action: @escaping () -> Void) {
        self.title = title
        self.variant = variant
        self.size = size
        self.full = full
        self.enabled = enabled
        self.disabledReason = disabledReason
        self.action = action
    }

    private var height: CGFloat { size == .lg ? 52 : 44 }
    private var fontSize: CGFloat { size == .lg ? 16 : 15 }

    private var fill: Color {
        switch variant {
        case .primary:     return V5.materialAction
        case .secondary:   return V5.materialTileRaised
        case .ghost:       return .clear
        case .destructive: return V5.materialTileRaised
        }
    }

    private var ink: Color {
        switch variant {
        case .primary:     return V5.actionPrimaryText
        case .secondary:   return V5.textPrimary
        case .ghost:       return V5.textSecondary
        case .destructive: return V5.fault
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: V5.S.s6) {
            Button(action: action) {
                Text(title)
                    .font(.faffText(fontSize, weight: variant == .primary ? .bold : .semibold))
                    .foregroundStyle(ink)
                    .frame(maxWidth: full ? .infinity : nil)
                    .padding(.horizontal, full ? 0 : V5.S.s20)
                    .frame(height: height)
                    .background(fill, in: Capsule(style: .continuous))
                    // THE HIT AREA IS THE CAPSULE, NOT THE INK.
                    //
                    // `.ghost` fills with `Color.clear`, and a clear
                    // background does not hit-test in SwiftUI. That left
                    // every ghost button tappable only where it had drawn
                    // something — which for a centred label is a fraction of
                    // the 44pt row it appears to occupy. "Leave it alone" is
                    // the escape from the change-the-plan sheet, and it was
                    // reachable only by hitting the glyphs.
                    //
                    // Stated once here rather than at the call sites, because
                    // the variant that needs it most is the one whose author
                    // is least likely to think about a background.
                    .contentShape(Capsule(style: .continuous))
            }
            .buttonStyle(V5PressStyle())
            .disabled(!enabled)
            .opacity(enabled ? 1 : 0.4)

            // The reason, not an apology. Quiet ink, never fault red: nothing
            // has failed, the control simply is not ready yet.
            if !enabled, let disabledReason, !disabledReason.isEmpty {
                Text(disabledReason)
                    .font(.faffText(TypeScaleV5.label13))
                    .foregroundStyle(V5.textQuiet)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: full ? .infinity : nil, alignment: .leading)
                    .accessibilityLabel("Unavailable. \(disabledReason)")
            }
        }
    }
}

// MARK: - Switch
//
// The "start runs from this phone" switch in Settings is the single source of
// truth for whether RUN appears in the tab bar everywhere.

struct FaffSwitch: View {
    let label: String
    var sub: String? = nil
    @Binding var isOn: Bool

    var body: some View {
        HStack(alignment: .center, spacing: V5.S.s12) {
            VStack(alignment: .leading, spacing: V5.S.s2) {
                Text(label)
                    .font(.faffText(16, weight: .medium))
                    .foregroundStyle(V5.textPrimary)
                if let sub {
                    Text(sub)
                        .font(.faffText(TypeScaleV5.label13))
                        .foregroundStyle(V5.textQuiet)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: V5.S.s8)
            Toggle("", isOn: $isOn)
                .labelsHidden()
                .tint(V5.signal)
                // `Toggle("")` with `.labelsHidden()` hides the label from the
                // screen AND from VoiceOver, which read the whole row as
                // "switch button, off" with nothing saying what it switches.
                // Settings has five of these in a column. The visible label
                // beside it is a separate element, so a runner swiping the
                // switches heard five identical unnamed toggles.
                //
                // `.labelsHidden()` is still right — the design draws the label
                // on the left of the row, not attached to the control. This
                // puts the name back on the control without drawing it twice.
                .accessibilityLabel(label)
        }
        .padding(.horizontal, V5.S.tilePad)
        .frame(minHeight: 58)
        .frame(maxWidth: .infinity)
        // One element, one announcement: "Start runs from this phone, sub, switch, on".
        // Without this the row is three stops on the rotor for one control.
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Radio
//
// Mutually exclusive options, each of which may reveal exactly one follow-up
// field (onboarding's fitness step). A filled dot in signal orange, no ring
// animation, no bounce.

struct FaffRadio: View {
    let label: String
    var sub: String? = nil
    let checked: Bool
    let onChange: () -> Void

    var body: some View {
        Button(action: onChange) {
            HStack(alignment: .top, spacing: V5.S.s12) {
                ZStack {
                    Circle().fill(V5.materialTileRaised).frame(width: 22, height: 22)
                    if checked { Circle().fill(V5.signal).frame(width: 11, height: 11) }
                }
                .padding(.top, 1)
                VStack(alignment: .leading, spacing: V5.S.s2) {
                    Text(label)
                        .font(.faffText(16, weight: .medium))
                        .foregroundStyle(V5.textPrimary)
                        .multilineTextAlignment(.leading)
                    if let sub {
                        Text(sub)
                            .font(.faffText(TypeScaleV5.label13))
                            .foregroundStyle(V5.textQuiet)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, V5.S.tilePad)
            .padding(.vertical, V5.S.s16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(V5PressStyle())
        .animation(V5.Motion.fill, value: checked)
        // WHICH ONE IS CHOSEN, SAID OUT LOUD.
        //
        // The filled orange dot is the only thing that says "this is the one",
        // and a dot is not text. Onboarding's fitness step is five mutually
        // exclusive options; a VoiceOver runner heard five identical buttons
        // and no way to tell which was already picked, so the step could not
        // be completed with any confidence. `.isSelected` is what the rotor
        // and the "selected" announcement both read.
        .accessibilityAddTraits(checked ? [.isSelected] : [])
    }
}

// MARK: - Select
//
// Expand-in-place, never a full-screen picker and never a wheel.

struct FaffSelect: View {
    let label: String
    let value: String
    let options: [String]
    let onChange: (String) -> Void
    @State private var open = false

    var body: some View {
        ExpandingRow(label: label,
                     value: .measured(value),
                     question: label,
                     isExpanded: $open) {
            VStack(spacing: V5.S.s6) {
                ForEach(options, id: \.self) { opt in
                    Button {
                        onChange(opt)
                        withAnimation(V5.Motion.expand) { open = false }
                    } label: {
                        HStack {
                            Text(opt)
                                .font(.faffText(TypeScaleV5.body15))
                                .foregroundStyle(opt == value ? V5.signal : V5.textPrimary)
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, V5.S.s14x)
                        .frame(height: 44)
                        .frame(maxWidth: .infinity)
                        .background(V5.materialTile,
                                    in: RoundedRectangle(cornerRadius: V5.R.r16, style: .continuous))
                    }
                    .buttonStyle(V5PressStyle())
                }
            }
        }
    }
}

extension V5.S {
    /// The prototype's in-control horizontal padding (`padding:12px 14px`).
    static let s14x: CGFloat = 14
}

// MARK: - Stepper

struct FaffStepper: View {
    let label: String
    @Binding var value: Int
    let range: ClosedRange<Int>
    var helper: String? = nil
    var onChange: ((Int) -> Void)? = nil

    private func step(_ d: Int) {
        let next = min(max(value + d, range.lowerBound), range.upperBound)
        guard next != value else { return }
        value = next
        onChange?(next)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: V5.S.s8) {
            HStack(spacing: V5.S.s12) {
                Text(label)
                    .font(.faffText(16, weight: .medium))
                    .foregroundStyle(V5.textPrimary)
                Spacer(minLength: V5.S.s8)
                HStack(spacing: V5.S.s10) {
                    roundControl("minus", label: "Decrease \(label.lowercased())") { step(-1) }
                        .disabled(value <= range.lowerBound)
                    Text(String(value))
                        .font(.faffText(20, weight: .semibold))
                        .foregroundStyle(V5.textPrimary)
                        .frame(minWidth: 28)
                        // The number is the value of the control beside it, not
                        // a loose numeral. Said as a value it reads
                        // "Days a week, 5"; said as static text it reads "5".
                        .accessibilityLabel(label)
                        .accessibilityValue(String(value))
                    roundControl("plus", label: "Increase \(label.lowercased())") { step(1) }
                        .disabled(value >= range.upperBound)
                }
            }
            if let helper {
                Text(helper)
                    .font(.faffText(TypeScaleV5.label13))
                    .foregroundStyle(V5.textQuiet)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, V5.S.tilePad)
        .padding(.vertical, V5.S.s16)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func roundControl(_ symbol: String, label: String,
                              _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(V5.textPrimary)
                .frame(width: 34, height: 34)
                .background(V5.materialControl, in: Circle())
                // Drawn at 34, tapped at 44. The row has 16pt of vertical
                // padding and 10pt between the two discs, so the expansion
                // sits entirely in space the design already leaves empty and
                // the negative padding keeps the 34pt footprint. Nothing moves.
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(V5PressStyle())
        .padding(-5)
        // "minus" and "plus" were the SF Symbol names, and that is what
        // VoiceOver said. Two unnamed steppers on the availability step read
        // as four identical "plus"/"minus" buttons.
        .accessibilityLabel(label)
    }
}

// MARK: - Input

struct FaffInput: View {
    let label: String
    @Binding var text: String
    var placeholder: String = ""
    var helper: String? = nil
    /// A trailing unit that is part of the field, not part of the value.
    var unit: String? = nil
    var keyboard: UIKeyboardType = .default

    var body: some View {
        VStack(alignment: .leading, spacing: V5.S.s8) {
            Text(label)
                .font(.faffText(TypeScaleV5.label13))
                .foregroundStyle(V5.textQuiet)
            HStack(spacing: V5.S.s8) {
                TextField("", text: $text, prompt:
                    Text(placeholder).foregroundStyle(V5.textQuiet))
                    .font(.faffText(17))
                    .foregroundStyle(V5.textPrimary)
                    .keyboardType(keyboard)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    // The field's name is drawn above it as its own Text, and
                    // `TextField("")` gave the control itself no name at all —
                    // VoiceOver landed on it and said "text field" with the
                    // label two swipes back. Add-a-race has four in a column.
                    // The unit belongs to the field, not to the value, so it
                    // is spoken as part of what is being asked for.
                    .accessibilityLabel(unit.map { "\(label), \($0)" } ?? label)
                if let unit {
                    Text(unit)
                        .font(.faffText(TypeScaleV5.body15))
                        .foregroundStyle(V5.textQuiet)
                }
            }
            .padding(.horizontal, V5.S.s16)
            .frame(height: 52)
            .background(V5.materialTileRaised,
                        in: RoundedRectangle(cornerRadius: V5.R.r16, style: .continuous))
            if let helper {
                Text(helper)
                    .font(.faffText(TypeScaleV5.label13))
                    .foregroundStyle(V5.textQuiet)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

// MARK: - LogEntry
//
// A dated entry in the coach's log.

struct LogEntry: View {
    let kind: String
    let date: String
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: V5.S.s6) {
            HStack(spacing: V5.S.s8) {
                // A kind marker beside a date, not a group title — so it wears
                // the section label's type but not its heading trait. A rotor
                // full of "week-close" and "discipline" is not a table of
                // contents.
                V5SectionLabel(text: kind, color: V5.textSecondary,
                               size: TypeScaleV5.label12, isHeading: false)
                Spacer(minLength: 0)
                Text(date)
                    .font(.faffText(TypeScaleV5.label12))
                    .foregroundStyle(V5.textQuiet)
            }
            Text(text)
                .font(.faffText(TypeScaleV5.body15))
                .foregroundStyle(V5.textPrimary)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(V5.S.tilePad)
        .background(V5.materialTile, in: RoundedRectangle(cornerRadius: V5.R.r22, style: .continuous))
    }
}

// MARK: - Bottom sheet
//
// 320ms, translateY 24 → 0, opacity .4 → 1, cubic-bezier(.2,.7,.3,1). The one
// shadow in the system sits under it. Nothing bounces.

/// Presenting container. Put one at the root of a screen; it dims, catches the
/// outside tap, and slides its body up.
struct V5SheetHost<Sheet: View>: View {
    @Binding var isPresented: Bool
    var title: String? = nil
    /// A sheet whose content is a FORM rather than a short list.
    ///
    /// The default sheet sizes itself to its content with no ceiling, which is
    /// right for four rows and wrong for anything taller: add-a-race grew past
    /// the notch at the top and under the tab bar at the bottom, and the 0821
    /// handoff warns that the another-race trade-off runs to six sentences and
    /// "the sheet must hold its longest realistic string without scrolling".
    ///
    /// Tall pins the sheet a proportional inset below the top of the screen and
    /// lets it fill the rest — the shape screen 21a is drawn as. The CONTENT
    /// owns its own scroll region, because the design's sheet is a flex column
    /// with a fixed header, a scrolling middle and a pinned action; a scroll
    /// wrapped around the whole thing would take the action with it.
    var tall: Bool = false
    /// 120 of the design's 844pt frame, as a fraction, so the sheet keeps its
    /// proportion on every device rather than a fixed gap that swallows a
    /// small screen.
    private var topInsetFraction: CGFloat { 120.0 / 844.0 }
    @ViewBuilder var sheet: () -> Sheet

    /// Set from the ZStack's own geometry, so the inset is proportional on
    /// every device rather than a fixed gap that swallows a small screen.
    @State private var tallHeight: CGFloat? = nil
    /// The whole screen's height, for the ordinary sheet's ceiling.
    @State private var screenHeight: CGFloat? = nil
    /// What the content wants, measured. Compared against the ceiling to
    /// decide whether this sheet needs to scroll at all.
    @State private var contentHeight: CGFloat = 0

    /// AN ORDINARY SHEET NOW HAS A CEILING, AND DEGRADES INSTEAD OF CLIPPING.
    ///
    /// It used to size to its content with no maximum, which is right for four
    /// rows and silently wrong past that — add-a-race put its title under the
    /// clock and its buttons under the tab bar, and nothing said so.
    ///
    /// 76% of the screen. The six-sentence another-race trade-off fits a
    /// 390×844 screen with room to spare, so this changes nothing today; it is
    /// here because six sentences is the longest string we have WRITTEN, not
    /// the longest one that can occur. The reason it fits is worth keeping:
    /// the sentences are the coach's, not a form's. If a sheet ever needs more
    /// than six, the fix is the copy.
    private var maxHeightFraction: CGFloat { 0.76 }

    private var ceiling: CGFloat? {
        guard !tall, let screenHeight else { return nil }
        return screenHeight * maxHeightFraction
    }

    /// Only scroll when the content actually exceeds the ceiling. A ScrollView
    /// takes every point it is offered, so wrapping unconditionally would
    /// stretch a four-row sheet to three-quarters of the screen.
    private var needsScroll: Bool {
        guard let ceiling else { return false }
        return contentHeight > ceiling
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            GeometryReader { geo in
                Color.clear
                    .onAppear {
                        screenHeight = geo.size.height
                        if tall { tallHeight = geo.size.height * (1 - topInsetFraction) }
                    }
                    .onChange(of: geo.size.height) { _, h in
                        screenHeight = h
                        if tall { tallHeight = h * (1 - topInsetFraction) }
                    }
            }
            .allowsHitTesting(false)
            if isPresented {
                Color.black.opacity(0.72)
                    .ignoresSafeArea()
                    .onTapGesture { withAnimation(V5.Motion.sheet) { isPresented = false } }
                    .transition(.opacity)
                    // Tap-outside-to-dismiss is a gesture on a dimmed rectangle,
                    // which is nothing at all to a runner who cannot see the
                    // dim. Named, it becomes a reachable control; without it the
                    // only way out of a sheet was to find the sheet's own
                    // action, and the refusal sheets deliberately have none.
                    .accessibilityLabel("Close")
                    .accessibilityAddTraits(.isButton)

                let body = VStack(alignment: .leading, spacing: V5.S.s16) {
                    if let title {
                        Text(title)
                            .font(.faffDisplay(20))
                            .textCase(.uppercase)
                            .tracking(20 * 0.02)
                            .foregroundStyle(V5.textPrimary)
                            .padding(.horizontal, V5.S.s4)
                    }
                    sheet()
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .background {
                    GeometryReader { g in
                        Color.clear
                            .onAppear { contentHeight = g.size.height }
                            .onChange(of: g.size.height) { _, h in contentHeight = h }
                    }
                }

                Group {
                    if needsScroll {
                        ScrollView { body }.scrollIndicators(.visible)
                    } else {
                        body
                    }
                }
                .frame(maxHeight: tall ? tallHeight : ceiling, alignment: .top)
                .padding(.top, 22)
                .padding(.horizontal, V5.S.tilePad)
                .padding(.bottom, 34)
                .background(V5.surface1)
                .clipShape(SheetShape())
                .shadow(color: V5.Shadow.color, radius: V5.Shadow.radius, y: V5.Shadow.y)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .ignoresSafeArea(edges: .bottom)
                // A SHEET IN A ZSTACK DOES NOT HIDE WHAT IT COVERS.
                //
                // This is a hand-built presenter, not `.sheet`, so the screen
                // underneath stays in the accessibility tree. VoiceOver read
                // straight through the scrim: swipe past the last button on
                // the change-the-plan sheet and you landed back in the Block
                // screen behind it, still able to activate rows that the sheet
                // was covering. `.isModal` is what tells VoiceOver that
                // everything outside this subtree is off-limits while it is up.
                .accessibilityAddTraits(.isModal)
            }
        }
        .animation(V5.Motion.sheet, value: isPresented)
    }
}

/// `border-radius:26px 26px 44px 44px` — the sheet meets the device's own
/// corner at the bottom.
struct SheetShape: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        let top: CGFloat = V5.R.r26, bottom: CGFloat = 44
        p.move(to: CGPoint(x: rect.minX, y: rect.maxY - bottom))
        p.addLine(to: CGPoint(x: rect.minX, y: rect.minY + top))
        p.addQuadCurve(to: CGPoint(x: rect.minX + top, y: rect.minY),
                       control: CGPoint(x: rect.minX, y: rect.minY))
        p.addLine(to: CGPoint(x: rect.maxX - top, y: rect.minY))
        p.addQuadCurve(to: CGPoint(x: rect.maxX, y: rect.minY + top),
                       control: CGPoint(x: rect.maxX, y: rect.minY))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - bottom))
        p.addQuadCurve(to: CGPoint(x: rect.maxX - bottom, y: rect.maxY),
                       control: CGPoint(x: rect.maxX, y: rect.maxY))
        p.addLine(to: CGPoint(x: rect.minX + bottom, y: rect.maxY))
        p.addQuadCurve(to: CGPoint(x: rect.minX, y: rect.maxY - bottom),
                       control: CGPoint(x: rect.minX, y: rect.maxY))
        p.closeSubpath()
        return p
    }
}

// MARK: - The round header disc
//
// THE SAME 30-POINT DISC USED TO BE HAND-ROLLED IN NINE FILES.
//
// Each of the nine carried a comment explaining why it kept a private copy —
// "not worth promoting to the shared kit for one more call site with the same
// two-line body". That held while the body really was two lines. It stopped
// holding the moment every copy needed the same tap target and the same
// spoken name: the 2026-08-21 accessibility audit had to add both to all nine
// by hand, and found eight of them missing both. Nine copies were nine
// chances to forget, and eight had already been taken.
//
// So the disc is one component now. `v5HeaderTarget` below is still its own
// modifier because the geometry is the interesting part and `AppBar`'s back
// button hand-rolls the same trick; `HeaderDiscV5` is what screens call.

extension View {
    /// Expands a drawn 30pt header disc to a real tap target and gives it a
    /// name, without moving it.
    ///
    /// The disc still draws at `V5.Shell.headerButton`. The target grows to
    /// `width` × 44 and the negative padding hands the layout back the 30pt
    /// footprint it had, so nothing on screen shifts by a point.
    ///
    /// `width` is 44 for a button that stands alone on its side of a header
    /// row. Two discs 6pt apart cannot both have 44pt of width without one
    /// taking the other's — pass 36 there (the disc plus the gap) and report
    /// the shortfall rather than letting the buttons steal each other's taps.
    func v5HeaderTarget(_ label: String, width: CGFloat = 44) -> some View {
        self
            .frame(width: width, height: 44)
            .contentShape(Rectangle())
            .padding(.horizontal, -(width - V5.Shell.headerButton) / 2)
            .padding(.vertical, -(44 - V5.Shell.headerButton) / 2)
            .accessibilityLabel(label)
    }
}

/// The round 30pt header disc: an SF Symbol or the runner's initials on a
/// tinted circle, with a 44pt-tall tap target and a spoken name.
///
/// Every "place" header row on the phone is built out of these — the account
/// button on Today, Today-after, the four state screens, the sick flare, the
/// two refusal screens; the calendar button beside it; the plus on Races.
struct HeaderDiscV5: View {
    @Environment(\.v5PanelInk) private var panelInk

    /// What the disc paints itself out of.
    ///
    /// A gradient panel paints with the on-panel set (white at opacity, which
    /// is the only thing that reads on a colour that moves under it). A quiet
    /// panel paints with the plain material tokens. `quietRaised` is the same
    /// quiet ink one surface step up, which is what the two refusal screens
    /// use — they have no panel behind them to lift the disc off.
    enum Fill {
        case onPanel
        case quiet
        case quietRaised

        /// The panel's ink is passed IN rather than read here. An enum has no
        /// position in the view tree, so it cannot resolve an environment
        /// value — and `.onPanel` is exactly the case whose answer depends on
        /// which panel. The view supplies it.
        func ink(_ panel: V5.PanelInk) -> Color {
            switch self {
            case .onPanel:                return panel.primary
            case .quiet, .quietRaised:    return V5.textPrimary
            }
        }

        func disc(_ panel: V5.PanelInk) -> Color {
            switch self {
            case .onPanel:      return panel.control
            case .quiet:        return V5.materialControl
            case .quietRaised:  return V5.materialTileRaised
            }
        }
    }

    /// What is drawn inside the disc. Decoration either way — the button's
    /// NAME is `label`, and that is what a runner hears.
    enum Glyph {
        /// `size` is 14 everywhere the design drew a disc on a panel. The two
        /// refusal screens drew their person glyph at 13 and that is kept
        /// rather than quietly normalised: it is a pixel, and this change
        /// moves none of them. Worth a designer's ruling, not a refactor's.
        case symbol(String, size: CGFloat = 14)
        case initials(String)

        /// Initials when we know the runner's name, a person glyph when we do
        /// not. Never an empty disc, which is what a blank name rendered and
        /// what reads on device as a control that failed to load.
        static func account(_ initials: String?, personSize: CGFloat = 14) -> Glyph {
            guard let initials, !initials.isEmpty else {
                return .symbol("person", size: personSize)
            }
            return .initials(initials)
        }
    }

    let glyph: Glyph
    /// What VoiceOver reads. Without it the initials disc announced "JR" and
    /// the person glyph announced "person" — the raw SF Symbol name, straight
    /// through to the runner.
    let label: String
    var fill: Fill = .onPanel
    /// 44 for a disc alone on its side of a header row. 36 for one of a pair
    /// sitting 6pt apart, which cannot both take 44 without one stealing the
    /// other's taps — see `v5HeaderTarget`.
    var targetWidth: CGFloat = 44
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Group {
                switch glyph {
                case let .symbol(name, size):
                    Image(systemName: name)
                        .font(.system(size: size, weight: .semibold))
                case let .initials(text):
                    // THE INITIALS LIVE INSIDE A FIXED 30-POINT DISC.
                    //
                    // Scaled with the reading register they outgrew it: at the
                    // third accessibility size "JR" rendered as "…" — the
                    // runner's own initials truncated to an ellipsis in the
                    // account button. The disc is a fixed graphic, so its two
                    // letters are sized to the disc, not to the runner's text
                    // setting. The button's name is what VoiceOver reads.
                    Text(text)
                        .font(.faffText(12, weight: .semibold, scales: false))
                }
            }
            .foregroundStyle(fill.ink(panelInk))
            .frame(width: V5.Shell.headerButton, height: V5.Shell.headerButton)
            .background(fill.disc(panelInk), in: Circle())
        }
        .buttonStyle(V5PressStyle())
        .v5HeaderTarget(label, width: targetWidth)
    }
}

// MARK: - The place header on a day panel
//
// Every "place" screen opens with the same row: the place label on the left,
// round controls on the right. Today, Today-after-the-run and the four state
// screens each hand-rolled their own, which is how the after-run screen ended
// up with a dead account button and no way to step between days while the
// before-run screen had both.
//
// One row, one set of behaviours, six call sites.

struct PlaceHeaderV5: View {
    /// Drawn inside the panel — a child of `DayPanel`, so the environment is
    /// the right source. The place word, the way-back chip and the header
    /// discs all take the ramp's ink.
    @Environment(\.v5PanelInk) private var panelInk

    /// "Today", "Races", "Block" — or the day being looked at, when that is
    /// not today. A screen headed TODAY showing Tuesday is a lie.
    let place: String
    /// Non-nil when the runner has stepped off today.
    var viewingDayLabel: String? = nil
    var onBackToToday: (() -> Void)? = nil
    var onCalendar: (() -> Void)? = nil
    /// The runner's initials, or nil for a person glyph. Never an empty disc.
    var initials: String? = nil
    var onAccount: (() -> Void)? = nil

    var body: some View {
        HStack(alignment: .center, spacing: V5.S.s8) {
            Text(viewingDayLabel ?? place)
                .font(.faffDisplay(20))
                .textCase(.uppercase)
                .tracking(20 * 0.02)
                .foregroundStyle(panelInk.primary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)

            Spacer(minLength: V5.S.s8)

            HStack(spacing: V5.S.s6) {
                if let onCalendar {
                    HeaderDiscV5(glyph: .symbol("calendar"),
                                 label: "Training calendar",
                                 targetWidth: discTargetWidth,
                                 action: onCalendar)
                }
                // 22b. THE WAY BACK STANDS WHERE THE ACCOUNT DISC STANDS,
                // AND THE ACCOUNT DISC STANDS DOWN.
                //
                // A day you have stepped to must not be mistakable for today,
                // and the strongest tell is that today's furniture is missing.
                // Settings are two taps away from the real Today; nothing on
                // a past Tuesday needs them, and leaving the disc there would
                // leave the screen looking like the one it is not.
                if viewingDayLabel != nil, let onBackToToday {
                    Button(action: onBackToToday) {
                        HStack(spacing: 3) {
                            Image(systemName: "chevron.left")
                                .font(.system(size: 10, weight: .semibold))
                            Text("Today")
                                .font(.faffText(TypeScaleV5.label12, weight: .semibold))
                        }
                        .foregroundStyle(panelInk.primary)
                        .padding(.horizontal, V5.S.s10)
                        .frame(height: V5.Shell.headerButton)
                        .background(panelInk.control, in: Capsule())
                    }
                    .buttonStyle(V5PressStyle())
                    // ── 44 TALL TO TAP, `V5.Shell.headerButton` TALL TO SEE ──
                    //
                    // David, 2026-08-25: "the TODAY back button is hard to
                    // click" — it drew at 30pt, under Apple's own 44pt
                    // minimum. Then, once a 44pt VISUAL pill was sitting next
                    // to the 30pt calendar disc: "if you need to make things
                    // bigger then everything else needs to match too."
                    //
                    // Both are true, and this is the same recipe
                    // `v5HeaderTarget` already uses for that calendar disc:
                    // `.frame` grows the tap box first, `.contentShape` bakes
                    // the hit-test region in AT that size, and only THEN does
                    // negative padding shrink the reported LAYOUT footprint
                    // back to `V5.Shell.headerButton` — so this row measures
                    // the same as it always did and nothing shifts, while the
                    // capsule stays visually the same height as the disc
                    // beside it.
                    //
                    // AN EARLIER PASS TRIED THIS SAME RECIPE AND IT DID NOT
                    // WORK — tapping did nothing. That turned out to be a
                    // false trail: the button was always receiving the tap
                    // and calling `onBackToToday`; the server was marking the
                    // VIEWED day `is_today` instead of the real one, so the
                    // handler compared the target date to itself and no-opped
                    // silently. See `goTo` in `HostsV5.swift` and the fix in
                    // `app/api/v5/today/route.ts`, 2026-08-25. The enlarge
                    // recipe was never the problem; it just failed alongside
                    // the real bug and took the blame.
                    .frame(height: 44)
                    .contentShape(Rectangle())
                    .padding(.vertical, -(44 - V5.Shell.headerButton) / 2)
                    .accessibilityLabel("Back to today")
                } else if let onAccount {
                    HeaderDiscV5(glyph: .account(initials),
                                 label: "Account and settings",
                                 targetWidth: discTargetWidth,
                                 action: onAccount)
                }
            }
        }
        .frame(height: 44)
    }

    // ─────────────────────────────────────────────────────────────────────
    // THE HIT AREA IS NOT THE CIRCLE.
    //
    // The design draws a 30pt disc. Apple asks for 44×44. `.contentShape(Circle())`
    // pinned the tap target to exactly the drawn disc, which is 30×30 — and
    // on the account button it also clipped the corners off, so the target was
    // smaller than the disc's own bounding box.
    //
    // The disc still draws at 30 and the target grows around it. Two discs
    // 6pt apart can have 36 each (the disc plus the gap) without either
    // stealing the other's taps; one disc on its own — the after-run screen
    // passes no calendar — takes the full 44 with nothing to steal it from.
    // This row used to hardcode 36 for both cases, so the lone account button
    // on Today-after was 36 wide for no reason at all.
    //
    // 36×44 is the ceiling for the pair, not a pass. Reaching a true 44×44
    // there needs the two discs to move apart or grow, and both are the
    // design's call — flagged rather than taken.
    // ─────────────────────────────────────────────────────────────────────
    private var discTargetWidth: CGFloat {
        (onCalendar != nil && onAccount != nil) ? 36 : 44
    }
}

// MARK: - WristDecisions · 8b
//
// The four decisions the watch sends up — bail taken, ceiling lifted, rep
// skipped, recovery extended — as their own group on run detail.
//
// THE REGISTER IS THE WHOLE DIFFICULTY, and it is subtractive. A decision is
// a STATEMENT: no colour, no chevron, nothing tappable. None of it is
// editable after the fact, so nothing may look like it is.
//
// No amber, no red, no green on a decision, ever. Amber means out of range
// or provisional, and a choice the coach offered is neither — colouring it
// grades it. That is why this component takes plain `String`s and not
// `FaffValue`s: the type's whole job is to stamp a mark, and there is no
// mark that belongs here.
//
// The phone may not retroactively grade a choice the watch offered. The
// watch said taking the bail is not a failed run, it is a shorter one. If
// the phone disagrees, the wrist offer stops being honest the second time it
// fires — and it fires once per run, so the runner meets it again next week.
//
// Rows, not tiles inside tiles. No dividers: the row rhythm is the
// separation.
struct WristDecision: Identifiable, Equatable {
    let id: String
    /// The decision in the runner's own words, as the wrist put it. The
    /// phone repeats the watch's verb; it does not rename it.
    let statement: String
    /// The evidence the coach used, then what was asked. A decision with no
    /// reason beside it reads as a lapse, so this is not optional.
    let reason: String
}

struct WristDecisionsV5: View {
    let decisions: [WristDecision]

    var body: some View {
        VStack(alignment: .leading, spacing: V5.S.s10) {
            V5SectionLabel(text: "What you decided").padding(.horizontal, V5.S.s4)
            VStack(alignment: .leading, spacing: 0) {
                ForEach(decisions) { d in
                    VStack(alignment: .leading, spacing: 3) {
                        Text(d.statement)
                            .font(.faffText(TypeScaleV5.body17))
                            .foregroundStyle(V5.textPrimary)
                        Text(d.reason)
                            .font(.faffText(TypeScaleV5.label14))
                            .lineSpacing(TypeScaleV5.label14 * 0.45)
                            .foregroundStyle(V5.textSecondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 14)
                    // One element per decision. Read as two separate strings
                    // it becomes "Cut it short at mile 6" followed by an
                    // orphaned fragment, and the reason is the only thing
                    // keeping the statement from sounding like a confession.
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(d.statement). \(d.reason)")
                }
            }
            .padding(.vertical, V5.S.s6)
            .background(V5.materialTile,
                        in: RoundedRectangle(cornerRadius: V5.R.r18, style: .continuous))
        }
    }
}

// MARK: - A vertical page must never pan sideways
//
// ─────────────────────────────────────────────────────────────────────────
// DAVID, 2026-08-25: "the races page can go left and right and slides off
// the edge."
//
// SwiftUI's `ScrollView` takes an AXES argument, and every reading of that
// argument except UIScrollView's own is wrong. `.vertical` does not mean
// "only scrolls vertically" — it sets `alwaysBounceVertical`, and nothing
// else. Scrolling itself is governed by `contentSize` against `bounds`, on
// BOTH axes, always. So a vertical page whose content lays out even a
// fraction of a point wider than the viewport becomes horizontally
// scrollable, and once it is scrollable it also RUBBER-BANDS: a half-point
// of real overflow buys the runner a hundred points of drag. That is what
// David saw, and why it reads as the whole page sliding off the edge rather
// than as something being slightly too wide.
//
// Which child overflows is a moving target — it depends on the payload (a
// long race name, an address, a gun-time sentence) and on the runner's own
// text size, since everything below 28pt scales with Dynamic Type. Chasing
// the child of the day fixes one screen for one payload. Pinning the band
// fixes the class: the scrolling content reports exactly the width of the
// scroll view it sits in, no matter what it contains, so `contentSize.width`
// can never exceed `bounds.width` and the horizontal axis is dead.
//
// `.frame(width:)` semantics are the point — the pin REPORTS the container's
// width whatever the child does with the proposal. A child that genuinely
// wants more is then clipped by the scroll view instead of towing the page
// with it. Clipped is a visible bug someone reports; a page that slides is
// a mystery.
//
// APPLY IT OUTSIDE THE GUTTER PADDING. Inside, the pin sets the band to the
// container width and the padding then adds 32 back on, which is the very
// overflow this exists to remove.
// ─────────────────────────────────────────────────────────────────────────
extension View {
    /// Pins scrolling content to the width of its scroll view, so a vertical
    /// page can never scroll or rubber-band horizontally.
    func v5PageWidth() -> some View {
        containerRelativeFrame(.horizontal)
    }
}
