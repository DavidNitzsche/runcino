//
//  TokensV5.swift
//  faff.run iPhone · the v5 design system's token layer.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY THIS FILE EXISTS ALONGSIDE ThemeV5.swift
//
//  ThemeV5.swift holds the RAW palette exactly as the v5 README states it:
//  ground, four surface steps, three signals, six day-state gradients. It is
//  CI-locked by scripts/check-palette-sync.sh and must not grow semantics.
//
//  The approved prototype (docs/design/iphone-v5/reference/) does not paint
//  with raw hexes. Every fill in it is a CSS custom property — `--material-tile`,
//  `--text-quiet`, `--action-primary-text` — resolved by a design-system bundle
//  (`_ds/…/tokens/colors.css`) that was NOT shipped with the handoff. So the
//  prototype's markup is exact and its token VALUES are one indirection away.
//
//  This file is that indirection, named one-for-one with the prototype's
//  variables so porting a screen is a substitution and not a judgement:
//
//      background:var(--material-tile)   →   .fill(V5.materialTile)
//      color:var(--text-quiet)           →   .foregroundStyle(V5.textQuiet)
//
//  ─────────────────────────────────────────────────────────────────────────
//  PROVENANCE OF EVERY VALUE BELOW · read before changing one
//
//  STATED — the v5 README gives the hex outright. Locked, do not touch:
//      surfacePage · surface1 · surface2 · surface3 · surface4
//      signal · attention · fault · all six day-state ramps
//
//  DERIVED — the README does not name the token, but the prototype's usage
//  pins it to exactly one stated value. Reasoning recorded per token below:
//      materialTile · materialTileRaised · materialControl · materialAction
//      actionPrimaryText · stateEasy · stateRest · stateQuality · stateRace
//
//  INFERRED — neither source carries it. The three text tiers are the only
//  ones. They are expressed as white at an opacity rather than as invented
//  hexes, so that they composite correctly on the page, on every surface step
//  AND on a day-state gradient, and so nothing here can drift from the four
//  locked steps. The ladder is taken from the design's own on-panel treatment,
//  which spells its secondary out in the markup as rgba(255,255,255,.78).
//
//      Flagged to David: the text tiers are the one part of this file that no
//      source in the handoff states. If type reads too quiet on device, these
//      three numbers are what to move — nothing else here is a guess.
//

import SwiftUI
import UIKit

/// The v5 design system's semantic tokens. Named for the prototype's CSS
/// custom properties. Every v5 screen paints from here, never from a hex.
enum V5 {

    // ═════════════════════════════════════════════════════════════════════
    // MARK: Ground and containment
    // "Pure black page. Four surface steps above it. No borders anywhere —
    //  containment is always a fill-step change, never a hairline. A tile
    //  inside a tile steps up one fill level."
    // ═════════════════════════════════════════════════════════════════════

    /// `--surface-page` · the page itself, and the pinned bottom chrome. STATED.
    static let surfacePage = Theme.V5.ground        // #000000

    /// `--surface-1` · a floating sheet's body. STATED (step 1).
    static let surface1 = Theme.V5.surface1         // #0F1011

    /// `--surface-2` · the quiet no-gradient panel on the screens that have
    /// nothing to prescribe (injury flare, off-season, paces moved). STATED.
    static let surface2 = Theme.V5.surface2         // #17191B

    /// `--material-tile` · a tile on the page. DERIVED: the prototype's tiles
    /// sit directly on `--surface-page`, so a tile is the first containment
    /// step a tile can be, and `--surface-2` is used for the same visual
    /// weight one line away. Both resolve to step 2.
    static let materialTile = Theme.V5.surface2     // #17191B

    /// `--material-tile-raised` · a tile INSIDE a tile, and a quiet button on
    /// a sheet. DERIVED from the README's own rule: one step up from a tile.
    static let materialTileRaised = Theme.V5.surface3   // #212427

    /// `--material-control` · a round control that sits on the page rather
    /// than in a tile — the treadmill console's 72pt minus button, the 30pt
    /// header buttons. DERIVED: it must read as a control against pure black
    /// with no border to help it, which is the job the README gives step 4
    /// ("pressed / raised control"). This is also the only assignment under
    /// which all four stated steps are used.
    static let materialControl = Theme.V5.surface4  // #2A2E32

    // ═════════════════════════════════════════════════════════════════════
    // MARK: The three signals · one accent, one meaning each
    // ═════════════════════════════════════════════════════════════════════

    /// `--signal` · the runner's current position or value, the primary
    /// action, the one highlighted bar in a chart. NEVER means "good". STATED.
    static let signal = Theme.V5.signal             // #FF5A1F

    /// `--attention` · outside its target range, stale data, a decision
    /// waiting. NEVER means "error". Also inks the modelled-number tilde.
    /// STATED.
    static let attention = Theme.V5.attention       // #F2B03C

    /// `--fault` · we could not read this value. Never renders a real value.
    /// STATED.
    static let fault = Theme.V5.fault               // #FF4438

    /// `--material-action` · the fill of a primary action. DERIVED: every
    /// occurrence in the prototype pairs it with `--action-primary-text`, and
    /// the tab bar's RUN pill — the same pairing — is specified in the README
    /// as "a filled RUN pill (signal-orange background)".
    static let materialAction = Theme.V5.signal     // #FF5A1F

    /// `--action-primary-text` · ink ON a primary action. DERIVED: it must
    /// carry 13–17px text at weight 700 on #FF5A1F. Black clears 6.4:1 there;
    /// white manages 3.3:1 and would fail its own size class. Black.
    static let actionPrimaryText = Color.black

    // There is no green in this palette on purpose. The app never grades a
    // number as "good". The `easy` day-state ramp is a KIND of day, not a
    // verdict on one.

    // ═════════════════════════════════════════════════════════════════════
    // MARK: Type tiers
    // INFERRED — see the header. White at an opacity, so one ladder works on
    // the page, on all four steps, and on a gradient.
    // ═════════════════════════════════════════════════════════════════════

    /// `--text-primary` · the value, the headline, the thing being read.
    static let textPrimary = Color.white

    /// `--text-secondary` · a supporting line. Matches the on-panel .78 the
    /// prototype spells out, nudged down a hair for the flatter surfaces.
    static let textSecondary = Color.white.opacity(0.72)

    /// `--text-quiet` · a unit, a caption, a row's right-hand note. Still
    /// clears 4.9:1 on a tile.
    static let textQuiet = Color.white.opacity(0.48)

    /// Type on a day-state gradient. The prototype hard-codes these, so they
    /// are STATED, not inferred.
    enum OnPanel {
        static let primary   = Color.white
        static let secondary = Color.white.opacity(0.78)
        static let quiet     = Color.white.opacity(0.62)
        /// The translucent stats plate a panel carries. STATED.
        static let plate     = Color.white.opacity(0.16)
        /// A round header button on a panel. STATED.
        static let control   = Color.white.opacity(0.20)
    }

    // ═════════════════════════════════════════════════════════════════════
    // MARK: Plot ink
    // ═════════════════════════════════════════════════════════════════════

    /// `--plot-ink` · a drawn line or bar that is not the highlighted one.
    static let plotInk = Color.white.opacity(0.62)
    /// `--plot-quiet` · a baseline, a gridline, an unfilled track.
    static let plotQuiet = Color.white.opacity(0.16)

    // ═════════════════════════════════════════════════════════════════════
    // MARK: Day states
    // A day state is WHICH KIND of day this is. It is never a grade.
    // ═════════════════════════════════════════════════════════════════════

    enum DayState: String, CaseIterable, Hashable {
        case easy, rest, quality, race, phase, long

        /// The three stops, 135°, exactly as ThemeV5 locks them.
        var stops: [Color] {
            switch self {
            case .easy:    return Theme.V5.DayState.easy
            case .rest:    return Theme.V5.DayState.rest
            case .quality: return Theme.V5.DayState.quality
            case .race:    return Theme.V5.DayState.race
            case .phase:   return Theme.V5.DayState.phase
            case .long:    return Theme.V5.DayState.long
            }
        }

        /// Stop positions. The race ramp alone moves its middle stop earlier,
        /// and every ramp's dark terminal sits past the panel edge on purpose
        /// so the deep end stays only just darker.
        var locations: [Double] {
            self == .race ? Theme.V5.DayState.raceLocations : Theme.V5.DayState.locations
        }

        /// `--state-easy` / `--state-rest` / `--state-quality` / `--state-race`
        /// · the flat accent that stands for this day state where a gradient
        /// will not fit (a week-strip rail, a chart mark, a legend dot).
        /// DERIVED: each ramp's first stop, which is what a one-colour stand-in
        /// for a gradient is.
        var accent: Color { stops[0] }
    }

    // ═════════════════════════════════════════════════════════════════════
    // MARK: Shape · larger surfaces get larger radii, every pill is 999
    // ═════════════════════════════════════════════════════════════════════

    enum R {
        static let r6:   CGFloat = Theme.V5.Radius.r6
        static let r10:  CGFloat = Theme.V5.Radius.r10
        static let r14:  CGFloat = Theme.V5.Radius.r14
        static let r16:  CGFloat = 16     // the prototype's tile-in-tile radius
        static let r18:  CGFloat = Theme.V5.Radius.r18
        static let r22:  CGFloat = Theme.V5.Radius.r22
        static let r26:  CGFloat = Theme.V5.Radius.r26
        static let pill: CGFloat = Theme.V5.Radius.pill
        /// The bottom corners of a full-bleed day panel.
        static let panel: CGFloat = Theme.V5.Radius.panel   // 30
    }

    // ═════════════════════════════════════════════════════════════════════
    // MARK: Space · 2 4 6 8 12 16 20 24 32 40 56 72 96 128
    // ═════════════════════════════════════════════════════════════════════

    enum S {
        static let s2:   CGFloat = 2
        static let s4:   CGFloat = 4
        static let s6:   CGFloat = 6
        static let s8:   CGFloat = 8
        static let s10:  CGFloat = 10   // the prototype's in-tile row gap
        static let s12:  CGFloat = 12
        static let s16:  CGFloat = 16
        static let s20:  CGFloat = 20
        static let s24:  CGFloat = 24
        static let s32:  CGFloat = 32
        static let s40:  CGFloat = 40
        static let s56:  CGFloat = 56
        static let s72:  CGFloat = 72
        static let s96:  CGFloat = 96
        static let s128: CGFloat = 128

        /// The content band's own gutter. The prototype scrolls at
        /// `padding:0 16px 24px` and the full-bleed panel escapes it with
        /// `margin:0 -16px`.
        static let gutter: CGFloat = 16
        /// Tile padding, 18–20.
        static let tilePad: CGFloat = 18
        /// Gap between tiles in a group.
        static let inGroup: CGFloat = 8
        /// Gap between groups.
        static let betweenGroups: CGFloat = 20
    }

    // ═════════════════════════════════════════════════════════════════════
    // MARK: Motion · nothing bounces, pulses, or scales up
    // ═════════════════════════════════════════════════════════════════════

    enum Motion {
        // ─────────────────────────────────────────────────────────────────
        // REDUCE MOTION · the design's durations, or none of them.
        //
        // The design specifies 120ms press, 200ms fill, 320ms sheet. A runner
        // who has asked the system for less motion gets the same STATE change
        // with no tween — never a different layout, never a missing step. The
        // design is unaltered; only its interpolation is.
        //
        // Read as a computed `static var`, not a lazy `static let`. TokensV5's
        // header records why: a lazy static that touches UIKit and is first
        // evaluated inside a view body re-enters `_dispatch_once_wait` and
        // traps. `UIAccessibility.isReduceMotionEnabled` is a plain read with
        // no one-time initialiser behind it, so a computed var is safe where a
        // lazy let is not.
        //
        // Nothing in this system bounces, pulses or scales, so there is no
        // second animation to suppress — cutting the duration is the whole of
        // the accommodation.
        // ─────────────────────────────────────────────────────────────────

        /// True when the runner has asked the system for reduced motion.
        static var reduced: Bool { UIAccessibility.isReduceMotionEnabled }

        static var press: Animation? { reduced ? nil : Theme.V5.Motion.press }   // 120ms
        static var fill:  Animation? { reduced ? nil : Theme.V5.Motion.fill }    // 200ms
        static var sheet: Animation? { reduced ? nil : Theme.V5.Motion.sheet }   // 320ms

        /// The sheet's 24pt rise. Zero under reduce-motion: the sheet still
        /// appears, it just does not travel.
        static var sheetOffset: CGFloat { reduced ? 0 : Theme.V5.Motion.sheetOffset }

        /// Expand-in-place, the app's one picker interaction. Same curve as a
        /// sheet: a row opening is the same gesture at a smaller scale.
        static var expand: Animation? { reduced ? nil : Theme.V5.Motion.sheet }
    }

    // ═════════════════════════════════════════════════════════════════════
    // MARK: Shadow · flat by default; the only one is under a floating sheet
    // ═════════════════════════════════════════════════════════════════════

    enum Shadow {
        static let color  = Theme.V5.Shadow.color
        static let radius = Theme.V5.Shadow.radius
        static let y      = Theme.V5.Shadow.yOffset
    }

    // ═════════════════════════════════════════════════════════════════════
    // MARK: Shell metrics
    // Build to the real device safe areas, never a fixed 390×844 box — these
    // are the fixed BANDS inside it, which the prototype does state.
    // ═════════════════════════════════════════════════════════════════════

    enum Shell {
        /// The bottom tab bar. Pinned. The home-indicator strip sits below it
        /// and comes from the safe area, not from a constant.
        static let tabBarHeight: CGFloat = 62
        /// A pushed screen's AppBar.
        static let appBarHeight: CGFloat = 92
        /// A round header button on a panel.
        static let headerButton: CGFloat = 30

        /// The design's status band, and the FLOOR for the real one.
        ///
        /// The handoff draws 44pt and says in the same breath to "build to the
        /// actual device safe areas, not a fixed 390×844 box" — and the two
        /// disagree on every device made since. So the real inset arrives
        /// through the environment (`\.v5TopInset`, published by the shell from
        /// a GeometryReader) and this is what a preview or a detached screen
        /// falls back to.
        ///
        /// This used to be a lazy `static let` that read
        /// `UIApplication.shared.connectedScenes` on first touch. It crashed
        /// on launch — EXC_BREAKPOINT in `_dispatch_once_wait`, because the
        /// first touch was inside `DayPanel.body`, and reading the window from
        /// a view body re-entered the same one-time initialiser. Do not put
        /// UIKit lookups behind a lazy static that a body evaluates.
        static let statusBarInset: CGFloat = 44
    }
}


// MARK: - The real safe-area inset

/// The device's own top safe-area inset, published by the shell.
///
/// SwiftUI hands this out through `GeometryReader.safeAreaInsets`, which is
/// the only way to read it that is safe from inside a view body. The shell
/// measures it once at the root and puts it here; anything drawing a
/// full-bleed panel reads it rather than asking UIKit.
private struct V5TopInsetKey: EnvironmentKey {
    static let defaultValue: CGFloat = V5.Shell.statusBarInset
}

extension EnvironmentValues {
    var v5TopInset: CGFloat {
        get { self[V5TopInsetKey.self] }
        set { self[V5TopInsetKey.self] = newValue }
    }
}
