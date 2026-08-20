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

    var body: some View {
        Text(text)
            .font(.faffDisplay(size))
            .textCase(.uppercase)
            .tracking(size * 0.06)
            .foregroundStyle(color)
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
                }
                .buttonStyle(.plain)
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
                FaffValueText(value, font: .faffText(TypeScaleV5.body15), color: V5.textSecondary)
                    .multilineTextAlignment(.trailing)
            }
            if onTap != nil {
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(V5.textQuiet)
            }
        }
        .padding(.horizontal, V5.S.tilePad)
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
    let action: () -> Void

    init(_ title: String,
         variant: Variant = .primary,
         size: Size = .lg,
         full: Bool = true,
         enabled: Bool = true,
         action: @escaping () -> Void) {
        self.title = title
        self.variant = variant
        self.size = size
        self.full = full
        self.enabled = enabled
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
        Button(action: action) {
            Text(title)
                .font(.faffText(fontSize, weight: variant == .primary ? .bold : .semibold))
                .foregroundStyle(ink)
                .frame(maxWidth: full ? .infinity : nil)
                .padding(.horizontal, full ? 0 : V5.S.s20)
                .frame(height: height)
                .background(fill, in: Capsule(style: .continuous))
        }
        .buttonStyle(V5PressStyle())
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.4)
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
        }
        .padding(.horizontal, V5.S.tilePad)
        .frame(minHeight: 58)
        .frame(maxWidth: .infinity)
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
                    roundControl("minus") { step(-1) }
                        .disabled(value <= range.lowerBound)
                    Text(String(value))
                        .font(.faffText(20, weight: .semibold))
                        .foregroundStyle(V5.textPrimary)
                        .frame(minWidth: 28)
                    roundControl("plus") { step(1) }
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

    private func roundControl(_ symbol: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(V5.textPrimary)
                .frame(width: 34, height: 34)
                .background(V5.materialControl, in: Circle())
        }
        .buttonStyle(V5PressStyle())
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
                V5SectionLabel(text: kind, color: V5.textSecondary, size: TypeScaleV5.label12)
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
    @ViewBuilder var sheet: () -> Sheet

    var body: some View {
        ZStack(alignment: .bottom) {
            if isPresented {
                Color.black.opacity(0.72)
                    .ignoresSafeArea()
                    .onTapGesture { withAnimation(V5.Motion.sheet) { isPresented = false } }
                    .transition(.opacity)

                VStack(alignment: .leading, spacing: V5.S.s16) {
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
                .padding(.top, 22)
                .padding(.horizontal, V5.S.tilePad)
                .padding(.bottom, 34)
                .background(V5.surface1)
                .clipShape(SheetShape())
                .shadow(color: V5.Shadow.color, radius: V5.Shadow.radius, y: V5.Shadow.y)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .ignoresSafeArea(edges: .bottom)
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
    /// "Today", "Races", "Block" — or the day being looked at, when that is
    /// not today. A screen headed TODAY showing Tuesday is a lie.
    let place: String
    /// Non-nil when the runner has stepped off today.
    var viewingDayLabel: String? = nil
    var onBackToToday: (() -> Void)? = nil
    /// Day stepping. Omit both on a screen where it makes no sense.
    var onPrevDay: (() -> Void)? = nil
    var onNextDay: (() -> Void)? = nil
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
                .foregroundStyle(V5.OnPanel.primary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)

            if viewingDayLabel != nil, let onBackToToday {
                Button(action: onBackToToday) {
                    Text("Today")
                        .font(.faffText(TypeScaleV5.label12, weight: .semibold))
                        .foregroundStyle(V5.OnPanel.primary)
                        .padding(.horizontal, V5.S.s10)
                        .frame(height: 26)
                        .background(V5.OnPanel.control, in: Capsule())
                        .contentShape(Capsule())
                }
                .buttonStyle(V5PressStyle())
            }

            Spacer(minLength: V5.S.s8)

            HStack(spacing: V5.S.s6) {
                if let onPrevDay { control(systemImage: "chevron.left", action: onPrevDay) }
                if let onNextDay { control(systemImage: "chevron.right", action: onNextDay) }
                if let onCalendar { control(systemImage: "calendar", action: onCalendar) }
                if let onAccount {
                    control(systemImage: (initials?.isEmpty ?? true) ? "person" : nil,
                            text: (initials?.isEmpty ?? true) ? nil : initials,
                            action: onAccount)
                }
            }
        }
        .frame(height: 44)
    }

    private func control(systemImage: String? = nil, text: String? = nil,
                         action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Group {
                if let systemImage {
                    Image(systemName: systemImage)
                        .font(.system(size: 14, weight: .semibold))
                } else {
                    Text(text ?? "")
                        .font(.faffText(12, weight: .semibold))
                }
            }
            .foregroundStyle(V5.OnPanel.primary)
            .frame(width: V5.Shell.headerButton, height: V5.Shell.headerButton)
            .background(V5.OnPanel.control, in: Circle())
            .contentShape(Circle())
        }
        .buttonStyle(V5PressStyle())
    }
}
