//
//  ThemeV5.swift
//  faff.run iPhone · v5 design tokens.
//
//  SOURCE OF TRUTH for the phone palette and typography:
//    design/0819/design_handoff_faff_iphone_app v5/
//      · README.md                  — the token prose, marked "Fidelity: high,
//                                     treat hex values as exact"
//      · Faff-iPhone-App.dc.html    — the only machine-readable token block in
//                                     the bundle (`:root { --g-*-panel }`), which
//                                     carries the six day-state gradient ramps.
//                                     Every hex below that also appears there is
//                                     byte-identical to it.
//
//  `Design/running-app-design-brief-v2.md` governs WEB and WATCH. It does not
//  govern the phone any more: the v5 handoff supersedes it here (it forbids
//  orange; the phone's primary accent is now orange #FF5A1F). Do not "reconcile"
//  these values against brief v2 — the handoff wins on the phone.
//
//  ADDITIVE, DELIBERATELY. Nothing in this file is wired to a view yet and no
//  existing token was recoloured or removed. The current build is live on
//  TestFlight on the legacy ten-colour palette; a half-migrated palette reaching
//  a real device is the one outcome worth avoiding. The build session authoring
//  the v5 screens rewires call sites; `scripts/check-palette-sync.sh` requires
//  the legacy block in Theme.swift to be DELETED once its last consumer is gone,
//  so the two palettes cannot coexist forever by accident.
//
//  These values are CI-locked. Change one by changing the v5 handoff first,
//  then this file, then the assertions in scripts/check-palette-sync.sh.
//

import SwiftUI

extension Theme {

    /// The v5 iPhone palette. Ten semantic slots plus six day-state gradients.
    enum V5 {

        // ───── Ground and containment ─────
        // Pure black page. Four surface steps above it, and no borders anywhere:
        // containment is always a fill-step change, never a hairline. A tile
        // inside a tile steps up one level.
        static let ground   = Color(hex: 0x000000)   // the page
        static let surface1 = Color(hex: 0x0F1011)   // first step off the page
        static let surface2 = Color(hex: 0x17191B)   // tile
        static let surface3 = Color(hex: 0x212427)   // tile inside a tile / control
        static let surface4 = Color(hex: 0x2A2E32)   // pressed / raised control

        // ───── The three signals · one accent, one meaning each ─────
        /// The runner's current position or value, the primary action, the one
        /// highlighted bar in any chart. NEVER means "good".
        static let signal    = Color(hex: 0xFF5A1F)
        /// Outside its target range, stale data, a decision waiting. NEVER means
        /// "error". Also inks the modelled-number tilde (see `modelledMark`).
        static let attention = Color(hex: 0xF2B03C)
        /// We could not read this value. Never used to render a real value.
        static let fault     = Color(hex: 0xFF4438)

        // There is no green in this palette on purpose. The app never grades a
        // number as "good". (`DayState.easy` is a day-state gradient, not a
        // verdict — it says which kind of day this is, not that it went well.)

        /// The one mark for "this number is estimated": a small amber tilde
        /// immediately before the value. Backed by the design contract's first
        /// rule — a modelled number must never look measured.
        static let modelledMark = "~"

        // ───── Day-state gradients ─────
        // Three stops each, 135°, interpolated in oklab in the design so the
        // midpoint has no hue crease. SwiftUI's LinearGradient interpolates in
        // the working colour space, not oklab, so a faithful build either
        // interpolates manually or accepts a slightly different midpoint — the
        // STOPS are the locked part, the interpolation is the renderer's.
        //
        // Position hints from the design's own ramps: stop 1 at 0%, stop 2 at
        // 76% (race: 72%), stop 3 at 185%, with an easing hint either side of
        // the middle stop and the dark terminal deliberately past the panel edge
        // so the deep end stays only just darker.
        //
        // `v5stop` on each line exempts these from the retired-hex tripwire in
        // check-palette-sync.sh, the same way `gstop` exempts the hero-gradient
        // ingredients: #FF8847, #E85D26 and #008FEC were retired under the OLD
        // phone palette and are restored by v5 as gradient stops.
        enum DayState {
            static let easy:    [Color] = [Color(hex: 0x3EBD41), Color(hex: 0x1F8A52), Color(hex: 0x0F4A3A)] // v5stop
            static let rest:    [Color] = [Color(hex: 0x008FEC), Color(hex: 0x4A3A8E), Color(hex: 0x1C1A3A)] // v5stop
            static let quality: [Color] = [Color(hex: 0xF3AD38), Color(hex: 0xE85D26), Color(hex: 0x7A2828)] // v5stop
            static let race:    [Color] = [Color(hex: 0xFF8847), Color(hex: 0xE85D26), Color(hex: 0x7A2828)] // v5stop
            static let phase:   [Color] = [Color(hex: 0xB084FF), Color(hex: 0x6A4ACE), Color(hex: 0x2A1A5A)] // v5stop
            static let long:    [Color] = [Color(hex: 0x27B4E0), Color(hex: 0x1A6A9E), Color(hex: 0x0C2A5E)] // v5stop

            /// Design stop positions, as fractions of the panel. Stop 3 sits
            /// past 1.0 on purpose; clamp when handing these to SwiftUI.
            static let locations:     [Double] = [0.00, 0.76, 1.85]
            /// The two LIGHT ramps — quality and race — put their middle stop
            /// at 52%.
            ///
            /// An earlier pass moved it to 72% to keep text clear of the dark
            /// terminal. Reverted on David's ruling: 72% flattens the panel
            /// into one orange field, and that flatness was most of what
            /// looked wrong in the first place. The terminal sits at 185%, so
            /// text never reaches it regardless.
            static let darkInkLocations: [Double] = [0.00, 0.52, 1.85]

            /// Ink for the two light ramps.
            ///
            /// DRAWN FROM THE RAMP'S OWN DEEP END, not a neutral black.
            /// Neutral black on saturated amber reads as a costume — the ink
            /// has to belong to the same family as the colour under it.
            /// `#3A1410` is the terminal `#7A2828` carried further down.
            ///
            /// MEASURED, composited, against the ramps themselves: 8.42:1 on
            /// the quality start, 6.89:1 on the race start, 4.68:1 on the
            /// shared mid stop. The mid stop is the number that matters,
            /// being the darkest colour any text reaches. White on the
            /// quality start was 1.94:1.
            ///
            /// The ramp itself is untouched — every hex, every stop, the full
            /// progression. No scrim, no darker ramp, no desaturation: the
            /// colour IS the day state, and muting it to make text legible
            /// trades the signal for the label.
            static let darkInk = Color(hex: 0x3A1410) // v5stop

            /// Every gradient panel carries a fine fractalNoise grain layer at
            /// 50% opacity, `mix-blend-mode: overlay`, between the gradient and
            /// the type. That grain is what keeps white type legible on the
            /// gradient without a scrim — it is not decoration, do not drop it.
            static let grainOpacity: Double = 0.5
        }

        // ───── Type on a gradient panel ─────
        /// White, and the translucent plate that carries stats on a panel.
        static let onPanel      = Color(hex: 0xFFFFFF)
        static let panelPlate   = Color.white.opacity(0.16)

        // ───── Shape ─────
        // Larger surfaces get larger radii. Every pill is 999.
        enum Radius {
            static let r6:   CGFloat = 6
            static let r10:  CGFloat = 10
            static let r14:  CGFloat = 14
            static let r18:  CGFloat = 18
            static let r22:  CGFloat = 22
            static let r26:  CGFloat = 26
            static let pill: CGFloat = 999
            /// Bottom corners of the full-bleed day panel.
            static let panel: CGFloat = 30
        }

        // ───── Space scale (pt) ─────
        enum Space {
            static let scale: [CGFloat] = [2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 56, 72, 96, 128]
        }

        // ───── Motion ─────
        // Nothing bounces, pulses, or scales up.
        enum Motion {
            /// Press feedback.
            static let press:  Animation = .easeInOut(duration: 0.12)
            /// Fill / colour transitions.
            static let fill:   Animation = .easeInOut(duration: 0.20)
            /// Sheet slide-up: translateY 24 → 0 with opacity .4 → 1.
            static let sheet:  Animation = .timingCurve(0.2, 0.7, 0.3, 1, duration: 0.32)
            static let sheetOffset: CGFloat = 24
        }

        // ───── Shadow ─────
        // Flat by default. The only shadow in the system sits under a floating
        // sheet: 0 32px 80px -24px rgba(0,0,0,.85).
        enum Shadow {
            static let color: Color = .black.opacity(0.85)
            static let radius: CGFloat = 40      // 80px blur ≈ 40pt SwiftUI radius
            static let yOffset: CGFloat = 32
        }
    }
}
