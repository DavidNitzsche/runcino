//
//  Theme.swift
//  faff.run v3 · canonical design tokens (paint by number).
//
//  Source of truth: the approved Faff Web App color palette, mirrored
//  here verbatim. Every hex traces back to that palette. iOS does NOT
//  reinterpret colors. To change a token, edit it in the web canonical
//  first, then mirror here.
//
//  Single dark skin (no Paper revert in v3, that was a v2 detour).
//  Text on warm meshes (TEMPO/INTERVALS/TARGETS/RACE) does NOT auto
//  invert · always `Theme.txt` (#F6F7F8).
//

import SwiftUI

// MARK: - Theme

enum Theme {

    // ───── Core neutrals ─────
    static let bg     = Color(hex: 0x0A0C10)        // deep canvas
    static let bgPage = Color(hex: 0x0A0C10)        // page bg (= bg in v3)
    static let card   = Color(hex: 0x11141A)        // tile body
    static let card2  = Color(hex: 0x13171F)        // raised card
    static let line   = Color.white.opacity(0.08)   // hairline borders
    static let line2  = Color.white.opacity(0.04)
    static let ink    = Color(hex: 0xF6F7F8)        // alias of txt
    static let txt    = Color(hex: 0xF6F7F8)        // primary text
    static let mute   = Color(hex: 0x8A90A0)        // secondary text
    static let dim    = Color(hex: 0x4B505E)        // tertiary text

    // ───── Semantic accents · LOCKED TEN-COLOR PALETTE (brief v2, AFC 2026-06-09) ─────
    // Byte-for-byte identical with web globals.css :root and the watch
    // (WatchTheme.swift + FaceKit.swift). Do not add an eleventh color.
    static let green     = Color(hex: 0x3EBD41)     // good state / on-plan / READY
    static let goal      = Color(hex: 0xF3AD38)     // long / goal markers / attention
    static let over      = Color(hex: 0xFC4D64)     // off / warn
    static let dist      = Color(hex: 0x27B4E0)     // distance / recovery / info
    static let rest      = Color(hex: 0x27B4E0)     // rest chrome (= recovery blue · corporate #008FEC deleted)
    static let race      = Color(hex: 0xFF5722)     // race day / tempo (the brand hero color)
    static let intervals = Color(hex: 0xF43F5E)     // intervals / max-quality effort

    // ───── Bright-on-dark TEXT siblings of the fill accents ─────
    // `goal`/`over` are tuned as FILLS (dots, bars, badge bodies). On dark
    // backgrounds a bright text/mark wants a lighter, more luminous tone so
    // the glyph reads. These legitimize the shadow-amber/coral found in 14+
    // call sites (readiness tags, slow-pace marks, attention copy) that were
    // each hand-rolling the same lighter value. Per David: warn/miss get
    // their own bright-text token rather than being force-routed to goal/over.
    static let warnText  = Color(hex: 0xFFB24D)     // bright warn/attention TEXT on dark
    static let overText  = Color(hex: 0xFF6A6A)     // bright miss/over TEXT on dark

    // ───── Calm / neutral teal · warmup-cool segment color ─────
    // Tokenizes the existing 0x5BBFB0 used for warmup/cooldown ticks, OK
    // recovery state, and other "neutral teal" marks. Zero visual change.
    static let neutralTeal = Color(hex: 0x5BBFB0)

    // ───── Phase identity · CI-LOCKED with web (check-palette-sync.sh) ─────
    // Categorical training-phase hues. NOT the effort temperature scale ·
    // these label which mesocycle a week belongs to (Base/Build/Peak/Taper).
    // Byte-for-byte identical with the web phase palette. iOS had two
    // hand-rolled phase switches drifting off these values · both now point
    // here, closing a cross-surface CI-lock violation.
    enum Phase {
        static let base  = Color(hex: 0x5BD8D2)
        static let build = Color(hex: 0xFFCB47)
        static let peak  = Color(hex: 0xFF7733)
        static let taper = Color(hex: 0x56E0B0)
    }

    // ───── Shape · matches colors_and_type.css --r-* ─────
    static let rChip:  CGFloat = 14
    static let rCard:  CGFloat = 18
    static let rTile:  CGFloat = 20
    static let rSheet: CGFloat = 30
    static let rPill:  CGFloat = 999
    static let rInput: CGFloat = 14

    // ───── Glass surfaces (over the effort mesh) ─────
    enum Glass {
        static let fill   = Color.white.opacity(0.06)
        static let line   = Color.white.opacity(0.12)
        static let strong = Color(hex: 0x11141A).opacity(0.92)
        static let blur:  CGFloat = 16
    }

    // ───── Spacing scale (px) · matches --sp-1..7 ─────
    enum Sp {
        static let s1: CGFloat = 4
        static let s2: CGFloat = 8
        static let s3: CGFloat = 12
        static let s4: CGFloat = 16
        static let s5: CGFloat = 22
        static let s6: CGFloat = 28
        static let s7: CGFloat = 40
    }

    // ───── Motion · matches --ease/--dur tokens ─────
    enum Motion {
        /// Mesh re-theme between effort states (Today day swap, Train phase scrub).
        static let mesh: Animation = .easeInOut(duration: 0.7)
        /// Drag-sheet / modal in/out.
        static let sheet: Animation = .timingCurve(0.32, 0.72, 0, 1, duration: 0.42)
        /// Press feedback.
        static let tap: Animation = .easeOut(duration: 0.12)
        /// Generic spring used for selection toggles.
        static let spring: Animation = .timingCurve(0.32, 0.72, 0, 1, duration: 0.36)
        /// Smooth ease used for plan-card / chip selections.
        static let smooth: Animation = .timingCurve(0.4, 0, 0.2, 1, duration: 0.30)
    }

    // ───── Brandmark sweep · FAFF·RUN (Anton, skew −9°, 6s linear ∞) ─────
    enum Brand {
        static let sweepStops: [Color] = [
            Color(hex: 0xF43F5E),     // 0%   hot pink
            Color(hex: 0xFF5722),     // 17%  ember
            Color(hex: 0xF5C518),     // 35%  gold
            Color(hex: 0x14C08C),     // 55%  emerald
            Color(hex: 0x4F8FF7),     // 75%  blue
            Color(hex: 0xF43F5E)      // 100% back to hot pink
        ]
        static let dot = Color(hex: 0xF5C518)       // gold middot
        static let skewDegrees: Double = -9
        static let sweepDuration: TimeInterval = 6

        // Strava's brand orange · used for the Strava connect/push/reconnect
        // chrome only. A DELIBERATE near-twin of `over` (#FC4D64), NOT a typo:
        // it must match Strava's actual brand mark, so it stays its own token.
        static let strava = Color(hex: 0xFC4C02)
    }

    // ───── HR zones · stacked bar palette (completed run TIME IN ZONES) ─────
    enum Zone {
        static let z1 = Color(hex: 0x54DDD0)
        static let z2 = Color(hex: 0x8EF0B0)
        static let z3 = Color(hex: 0xFFE0A0)
        static let z4 = Color(hex: 0xFF9560)
        static let z5 = Color(hex: 0xFF5A52)
    }

    // ───── HR zones · split bars / pacing segments palette ─────
    // AFC fix 2 · the canonical zone ladder = the effort temperature scale
    // (recovery → easy → long → tempo → intervals). Synced byte-for-byte
    // with web ZC (constants.ts) + RunDetailModal ZONE_COLOR.
    enum ZoneSplit {
        static let z1 = Color(hex: 0x27B4E0)
        static let z2 = Color(hex: 0x14C08C)
        static let z3 = Color(hex: 0xF3AD38)
        static let z4 = Color(hex: 0xFF5722)
        static let z5 = Color(hex: 0xF43F5E)
    }

    // ───── Shoe role colors (Garage chips, picker dots) ─────
    // AFC fix 2 · per the locked palette RACE and TEMPO share #FF5722
    // (one semantic slot) · the two role chips are color-identical and
    // differentiated by their text label. Synced with web ROLECOL.
    enum Shoe {
        static let race      = Color(hex: 0xFF5722)
        static let tempo     = Color(hex: 0xFF5722)
        static let long      = Color(hex: 0xF3AD38)
        static let easy      = Color(hex: 0x14C08C)
        static let recovery  = Color(hex: 0x27B4E0)
    }

    // ───── Accents · amber + mint (Coach tags, gap chip, callouts) ─────
    enum Accent {
        static let amberBright = Color(hex: 0xFFCE8A) // primary eyebrow / COACH tag
        static let amberPale   = Color(hex: 0xFFE7C2) // gradient highlight end
        static let amberGold   = Color(hex: 0xF5C518) // PR gold pill
        static let mintReady   = Color(hex: 0x86EFA0) // good-state text
        static let mintGlow    = Color(hex: 0x7BE8A0) // gap-chip glow / paths
    }

    // ───── Status tints (PR badges, log row badges) ─────
    enum Status {
        static let solidBorder = Color(hex: 0x3EBD41).opacity(0.40)
        static let solidText   = Color(hex: 0x86EFA0)
        static let prBorder    = Color(hex: 0xF5C518).opacity(0.50)
        static let prText      = Color(hex: 0xF5C518)
    }

    // ───── Readiness band → color · THE one source ─────
    // Collapses six hand-rolled verdict→color switches (TodayReadinessPanel
    // tint+arc, TodayView arc, HealthView bandColor, plus the already-canonical
    // ReadinessBriefSheet + HealthCompactGauge) onto one map. `fill` is the
    // canonical accent (dots, bars, body). `text` is the bright-on-dark
    // sibling for tags/arcs where a more luminous glyph was intended.
    // Normalizes case + all backend aliases ("sharp"/"primed", "ready"/
    // "hold easy", "pull-back"/"pullback"/"back off", "no-data"/"nodata").
    enum ReadinessBand {
        case sharp, ready, moderate, pullback, noData

        static func from(_ raw: String?) -> ReadinessBand {
            switch (raw ?? "").lowercased().replacingOccurrences(of: " ", with: "-") {
            case "sharp", "primed", "good":               return .sharp
            case "ready", "hold-easy":                    return .ready
            case "moderate", "watch":                     return .moderate
            case "pull-back", "pullback", "back-off", "low": return .pullback
            // "ok" is the design's neutral pillar alias · greys out like no-data.
            case "no-data", "nodata", "ok", "":           return .noData
            default:                                      return .moderate
            }
        }

        /// Canonical accent fill (arc body, dots, bars).
        static func fill(_ raw: String?) -> Color {
            switch from(raw) {
            case .sharp, .ready: return Theme.green   // READY is GREEN, not blue
            case .moderate:      return Theme.goal
            case .pullback:      return Theme.over
            case .noData:        return Theme.mute
            }
        }

        /// Bright-on-dark sibling · for the tag text + ring arc where the
        /// design wanted a punchier glyph than the fill.
        static func text(_ raw: String?) -> Color {
            switch from(raw) {
            case .sharp, .ready: return Theme.Accent.mintReady
            case .moderate:      return Theme.warnText
            case .pullback:      return Theme.overText
            case .noData:        return Theme.mute
            }
        }
    }

    // ───── Tweaks-panel accent options (the user-selectable accent recolors goal + race) ─────
    enum TweakAccent: String, CaseIterable {
        case ember, gold, violet, cool
        var goal: Color {
            switch self {
            case .ember:  return Color(hex: 0xF3AD38)
            case .gold:   return Color(hex: 0xF5C518)
            case .violet: return Color(hex: 0xA78BFA)
            case .cool:   return Color(hex: 0x27B4E0)
            }
        }
        var race: Color {
            switch self {
            // AFC fix 2 · the DEFAULT (ember) tweak now returns the locked
            // race hex. gold/violet/cool remain opt-in recolors via the
            // Tweaks panel (out-of-palette by design · flagged in recap).
            case .ember:  return Color(hex: 0xFF5722)
            case .gold:   return Color(hex: 0xF5A518)
            case .violet: return Color(hex: 0xB794F4)
            case .cool:   return Color(hex: 0x3AA0E0)
            }
        }
    }
}

// MARK: - Effort temperature scale
//
// The product's organizing principle. Every workout / day has an effort
// temperature. The mesh + accents track it.
//
// Color labels are TITLE-CASE per locked design intent ("Easy", not "EASY"
// or "easy"). For all-caps display contexts the View applies .uppercased().

enum FaffEffort: String, CaseIterable, Identifiable, Hashable {
    case recovery, easy, long, tempo, intervals, rest, race
    var id: String { rawValue }

    /// Title-case label used in coach copy. Apply .uppercased() in display.
    var title: String {
        switch self {
        case .recovery:  return "Recovery"
        case .easy:      return "Easy"
        case .long:      return "Long"
        case .tempo:     return "Tempo"
        case .intervals: return "Intervals"
        case .rest:      return "Rest"
        case .race:      return "Race"
        }
    }

    /// Effort-readout label ("Very easy" / "Easy" / "Moderate" / "Hard" / "Max" / "Off" / "Race").
    /// Used as the meter caret label on Today and chip labels on splits.
    var effortLabel: String {
        switch self {
        case .recovery:  return "Very easy"
        case .easy:      return "Easy"
        case .long:      return "Moderate"
        case .tempo:     return "Hard"
        case .intervals: return "Max"
        case .rest:      return "Off"
        case .race:      return "Race"
        }
    }

    /// Dot color for chips, week strip dots, splits · the registration mark.
    /// Authoritative source: colors_and_type.css (wins over app/tokens.css).
    var dot: Color {
        // AFC fix 2 · = web constants.ts EFF[*].dot, byte-for-byte.
        switch self {
        case .recovery:  return Color(hex: 0x27B4E0)
        case .easy:      return Color(hex: 0x14C08C)  // per --eff-easy
        case .long:      return Color(hex: 0xF3AD38)
        case .tempo:     return Color(hex: 0xFF5722)
        case .intervals: return Color(hex: 0xF43F5E)
        case .rest:      return Color(hex: 0x8A90A0)
        case .race:      return Color(hex: 0xFF5722)  // per --eff-race
        }
    }

    /// 6-color mesh palette [c1, c2, c3, c4, c5, mBase] painting the
    /// animated background. Cool to hot. mBase is the deep wash behind the
    /// blobs. Per locked design: Today re-tints to the selected day's effort
    /// over 0.7s ease.
    ///
    /// Retuned 2026-05-31 per Effort Mesh Background spec · luminous, no
    /// brown. Recovery and Easy intentionally share the teal mesh (they
    /// differ only by accent dot). Race tracks Intervals (no separate
    /// race-only mesh in the spec).
    var mesh: FaffMesh {
        // AFC fix 6 (2026-06-09) · stops synced byte-for-byte with web
        // constants.ts EFF[*].mesh. tempo + intervals were still the
        // retired v1 palettes (web moved to v3 on 2026-06-03: same
        // saturation, brightest mid stops ~6-8% down so cards stay
        // legible). race gets the dedicated race mesh the web shipped
        // 2026-06-08 instead of tracking intervals.
        switch self {
        case .recovery, .easy:
            return FaffMesh(c1: 0x8FF0E0, c2: 0x46CFC6, c3: 0x2FC0E6, c4: 0x23A98E, c5: 0x1B8C7C, base: 0x0E5A54)
        case .long:
            return FaffMesh(c1: 0xFFE7B0, c2: 0xF8BC4E, c3: 0xF0A638, c4: 0xEC8C2A, c5: 0xD9791C, base: 0xA85A14)
        case .tempo:
            return FaffMesh(c1: 0xF5C297, c2: 0xF18847, c3: 0xE15F30, c4: 0xD04525, c5: 0xC2303E, base: 0x8A1E30)
        case .intervals:
            return FaffMesh(c1: 0xF2C878, c2: 0xF07A48, c3: 0xEB4560, c4: 0xCD2540, c5: 0xA91A3E, base: 0x6D1129)
        case .rest:
            return FaffMesh(c1: 0xC4C8D2, c2: 0x9CA2B0, c3: 0x787E8E, c4: 0x58606E, c5: 0x3E4350, base: 0x252935)
        case .race:
            return FaffMesh(c1: 0xFFD27A, c2: 0xFF7A45, c3: 0xFC4D64, c4: 0xD6263C, c5: 0x9E1733, base: 0x3A0E12)
        }
    }

    /// Map a backend workout `type` string to an effort. Mirrors the web
    /// classification.
    static func fromType(_ raw: String?) -> FaffEffort {
        switch (raw ?? "").lowercased() {
        case "easy", "shakeout":                   return .easy
        case "recovery":                           return .recovery
        case "long":                               return .long
        case "tempo", "threshold", "progression":  return .tempo
        case "intervals", "vo2", "vo2max",
             "fartlek", "track", "quality":        return .intervals
        case "race", "race_a", "race_b", "race_c": return .race
        case "rest", "off":                        return .rest
        default:                                   return .easy
        }
    }
}

// MARK: - FaffMesh
//
// A 6-color palette for the animated background mesh. c1..c5 paint the
// 5 blob layers; base is the deep wash behind them.

struct FaffMesh: Equatable {
    let c1: Color
    let c2: Color
    let c3: Color
    let c4: Color
    let c5: Color
    let base: Color

    init(c1: UInt32, c2: UInt32, c3: UInt32, c4: UInt32, c5: UInt32, base: UInt32) {
        self.c1 = Color(hex: c1)
        self.c2 = Color(hex: c2)
        self.c3 = Color(hex: c3)
        self.c4 = Color(hex: c4)
        self.c5 = Color(hex: c5)
        self.base = Color(hex: base)
    }

    init(_ c1: Color, _ c2: Color, _ c3: Color, _ c4: Color, _ c5: Color, base: Color) {
        self.c1 = c1; self.c2 = c2; self.c3 = c3; self.c4 = c4; self.c5 = c5; self.base = base
    }

    /// Charcoal neutral · the calm default canvas (brief v2 §8 · AFC task 8).
    /// Byte-for-byte the web MESH.targets stops. Today (default state) and
    /// Targets both read this; semantic color lives on the data, not the page.
    static let neutral = FaffMesh(c1: 0x363B45, c2: 0x2B2F38, c3: 0x21242B, c4: 0x191C22, c5: 0x121419, base: 0x0C0D11)

    /// View mesh for a tab that isn't dictated by an active workout.
    static func forView(_ v: ViewMesh) -> FaffMesh {
        switch v {
        case .train:     return FaffMesh(c1: 0xFFE0A0, c2: 0xF3AD38, c3: 0xE89B3A, c4: 0xE07A2A, c5: 0xC47812, base: 0x3E2A0A)
        case .activity:  return FaffMesh(c1: 0xD6BE98, c2: 0xB2916A, c3: 0x8A6A48, c4: 0x5E4630, c5: 0x45331F, base: 0x1C140D)
        // HEALTH + SPECTATOR share the recovery/easy teal identity ·
        // updated 2026-05-31 to the luminous teal stops so view meshes
        // stay in sync with the effort palette when the runner cycles
        // from a teal effort day into the Health tab.
        case .health:    return FaffMesh(c1: 0x8FF0E0, c2: 0x46CFC6, c3: 0x2FC0E6, c4: 0x23A98E, c5: 0x1B8C7C, base: 0x0E5A54)
        // AFC fix 5 (2026-06-09) · Targets goes NEUTRAL CHARCOAL (shared
        // FaffMesh.neutral · = web MESH.targets). The old red intervals
        // mesh fought every on-track-green status surface · green-on-red
        // is the worst contrast pair. Same rationale as the web's
        // 2026-06-04 Targets rebuild: semantic color is reserved for the
        // data (green on-track / amber watching / warn off-track), the
        // page itself stays calm.
        case .targets:   return neutral
        case .profile:   return FaffMesh(c1: 0x6B6358, c2: 0x4E4840, c3: 0x3A352E, c4: 0x2A2723, c5: 0x1E1C19, base: 0x121110)
        case .spectator: return FaffMesh(c1: 0x8FF0E0, c2: 0x46CFC6, c3: 0x2FC0E6, c4: 0x23A98E, c5: 0x1B8C7C, base: 0x0E5A54)
        // AFC fix 6 · dedicated race mesh (= web MESH.race), no longer
        // borrowing the intervals stops.
        case .race:      return FaffMesh(c1: 0xFFD27A, c2: 0xFF7A45, c3: 0xFC4D64, c4: 0xD6263C, c5: 0x9E1733, base: 0x3A0E12)
        }
    }

    // MARK: - Time-of-day mesh (Today tab redesign · 2026-06-01)
    //
    // The Today tab no longer recolors its background by the selected run's
    // effort. Instead the mesh tracks LOCAL HOUR — morning teal-green,
    // afternoon sky, evening sunset, night indigo. Per-run accent color
    // still tints the week dot · peek/session ticks · Start button dot,
    // but the mesh itself stays time-bound.
    //
    // Doctrine: this set is ADDITIVE to the locked ViewMesh palettes. The
    // other tabs (Activity / Train / Health / Profile / Targets) keep
    // their existing forView(_:) palettes. Today opts in via forTimeOfDay.

    /// Mesh for the Today tab, driven by local hour.
    static func forTimeOfDay(_ p: TimeOfDay) -> FaffMesh {
        switch p {
        case .morning:
            // teal-green → warm amber · the look David approved
            return FaffMesh(c1: 0x62E3D4, c2: 0x2FAF7C, c3: 0xFFD98A,
                            c4: 0x1F8A68, c5: 0x0F6A5A, base: 0x0A3A2E)
        case .afternoon:
            // sky → teal blue
            return FaffMesh(c1: 0x8FD0FF, c2: 0x34B6D6, c3: 0x5FD0C4,
                            c4: 0x2A86B8, c5: 0x1C6F9A, base: 0x0A2F44)
        case .evening:
            // sunset orange → pink → violet
            return FaffMesh(c1: 0xFFCF8A, c2: 0xFF8E6A, c3: 0xF2673A,
                            c4: 0xC0457A, c5: 0x7A3A86, base: 0x2A142E)
        case .night:
            // 2026-06-02 round 41 · proper night, not "lavender at
            // dusk." Old palette (#7E8AD8 / #5360B4 / etc.) read as
            // bright periwinkle-purple even at 11pm · David: "its
            // supposed to be NIGHTTT". Dropped saturation + brightness
            // hard so the base reads near-black with the faintest
            // navy undertone, blobs are deep indigo whispers rather
            // than purple highlights.
            return FaffMesh(c1: 0x3F4870, c2: 0x2D3460, c3: 0x1A2050,
                            c4: 0x131840, c5: 0x0A0E2A, base: 0x04060F)
        }
    }

    /// Phase mesh for the Train scrubber. Lerps between adjacent phase
    /// meshes as the user scrubs.
    static func forPhase(_ p: TrainPhase) -> FaffMesh {
        switch p {
        case .base:  return forView(.health)
        case .build: return forView(.train)
        case .peak:  return FaffMesh(c1: 0xFFA566, c2: 0xFF5A52, c3: 0xEC2F54, c4: 0xC01D48, c5: 0xA8163F, base: 0x4E0A22)
        case .taper: return FaffMesh(c1: 0x8EF0B0, c2: 0x34C194, c3: 0x1F8A68, c4: 0x128A64, c5: 0x137259, base: 0x06382E)
        case .race:  return forView(.race)
        }
    }

    /// Linear interpolation between two meshes. Used by the Train scrubber
    /// to lerp between phase meshes as the user drags.
    func lerp(to other: FaffMesh, t: Double) -> FaffMesh {
        let k = max(0, min(1, t))
        return FaffMesh(
            FaffMesh.mix(c1,   other.c1,   t: k),
            FaffMesh.mix(c2,   other.c2,   t: k),
            FaffMesh.mix(c3,   other.c3,   t: k),
            FaffMesh.mix(c4,   other.c4,   t: k),
            FaffMesh.mix(c5,   other.c5,   t: k),
            base: FaffMesh.mix(base, other.base, t: k)
        )
    }

    private static func mix(_ a: Color, _ b: Color, t: Double) -> Color {
        let ai = a.rgba, bi = b.rgba
        return Color(
            red:   ai.r + (bi.r - ai.r) * t,
            green: ai.g + (bi.g - ai.g) * t,
            blue:  ai.b + (bi.b - ai.b) * t,
            opacity: ai.a + (bi.a - ai.a) * t
        )
    }
}

enum ViewMesh: String, CaseIterable, Hashable {
    case train, activity, health, targets, profile, spectator, race
}

/// Local-hour bucket for the Today tab background + greeting copy.
/// Periods · per the Today redesign brief (2026-06-01):
///   hour < 5  → night
///   hour < 12 → morning
///   hour < 17 → afternoon
///   hour < 21 → evening
///   else      → night
enum TimeOfDay: String, CaseIterable, Hashable {
    case morning, afternoon, evening, night

    /// Pick the bucket from a Date (defaults to now).
    static func current(_ now: Date = Date()) -> TimeOfDay {
        let h = Calendar.current.component(.hour, from: now)
        switch h {
        case 0..<5:   return .night
        case 5..<12:  return .morning
        case 12..<17: return .afternoon
        case 17..<21: return .evening
        default:      return .night
        }
    }

    /// Greeting eyebrow copy. Used on the Today topbar.
    var greeting: String {
        switch self {
        case .morning:   return "Good morning"
        case .afternoon: return "Good afternoon"
        case .evening:   return "Good evening"
        case .night:     return "Late night"
        }
    }
}

enum TrainPhase: String, CaseIterable, Hashable {
    case base, build, peak, taper, race

    var label: String {
        switch self {
        case .base:  return "BASE"
        case .build: return "BUILD"
        case .peak:  return "PEAK"
        case .taper: return "TAPER"
        case .race:  return "RACE"
        }
    }

    // "quality" and "race-specific" are server-side aliases.
    init(phaseKey key: String) {
        let k = key.lowercased()
        switch k {
        case "quality":                        self = .build
        case "race-specific", "race_specific": self = .peak
        default:                               self = TrainPhase(rawValue: k) ?? .base
        }
    }
}

// MARK: - Color hex init + RGBA decompose

extension Color {
    init(hex: UInt32, alpha: Double = 1.0) {
        let r = Double((hex >> 16) & 0xFF) / 255
        let g = Double((hex >> 8)  & 0xFF) / 255
        let b = Double( hex        & 0xFF) / 255
        self.init(.sRGB, red: r, green: g, blue: b, opacity: alpha)
    }

    /// RGBA components in sRGB. Used by FaffMesh.lerp.
    var rgba: (r: Double, g: Double, b: Double, a: Double) {
        #if canImport(UIKit)
        let ui = UIColor(self)
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        ui.getRed(&r, green: &g, blue: &b, alpha: &a)
        return (Double(r), Double(g), Double(b), Double(a))
        #else
        return (0, 0, 0, 1)
        #endif
    }
}

// MARK: - Global top-bar dissolve

extension View {
    /// Dissolves rising scroll content into the mesh as it enters the
    /// global top-bar zone, so nothing bleeds behind the header. The header
    /// (`globalTopBar` in RootTabView) is transparent on every page, so any
    /// content scrolled up into the bar zone renders straight behind the FAFF
    /// logo. A flat scrim painted over it can never match the charcoal-
    /// GRADIENT mesh — its edge always seams. Instead we fade the content's
    /// OWN alpha to nothing across the header zone, so it melts into the real
    /// mesh it sits on (no second surface → no seam).
    ///
    /// `clearTo` / `opaqueAt` are measured in points from the masked view's
    /// top, which sits at the safe-area top (a ScrollView's frame is inset to
    /// the safe area even though its content scrolls behind the bar). Keep
    /// `clearTo` ≥ the bar height (~50pt) so content is fully hidden through
    /// the whole header; `opaqueAt` is where it returns to full opacity —
    /// behind the frosted pill/strip on tabbed pages.
    ///
    /// - Parameters:
    ///   - clearTo: points kept fully hidden (the header zone).
    ///   - opaqueAt: point at which content reaches full opacity. On pages
    ///     with a header pill/strip this lands behind it so the ramp is
    ///     blurred away; bare pages land it just below the bar.
    func faffHeaderDissolve(clearTo: CGFloat = 50, opaqueAt: CGFloat = 58) -> some View {
        mask(alignment: .top) {
            VStack(spacing: 0) {
                LinearGradient(
                    stops: [
                        .init(color: .clear, location: 0),
                        .init(color: .clear, location: min(0.999, clearTo / opaqueAt)),
                        .init(color: .black, location: 1),
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(height: opaqueAt)
                Color.black
            }
            .ignoresSafeArea(edges: .bottom)
        }
    }

    /// Frosted header pill in the global top-bar slot — the same container the
    /// Today week strip uses (regularMaterial · r18 · hairline · 12pt side
    /// inset · 50pt clearance under the FAFF bar). Every tab fills it with its
    /// own glanceable summary while the page scrolls and dissolves behind it
    /// (pair with `faffHeaderDissolve`). Keeps position/size/style identical
    /// across tabs; only the contents change.
    /// Conditionally apply the header pill. When `visible` is false the
    /// view is returned untouched — used by surfaces whose pill would be
    /// empty in a cold state (e.g. Goal with no race + no goal), where an
    /// empty frosted box reads as a bug.
    @ViewBuilder
    func faffHeaderPill<C: View>(visible: Bool, @ViewBuilder _ content: () -> C) -> some View {
        if visible {
            faffHeaderPill(content)
        } else {
            self
        }
    }

    func faffHeaderPill<C: View>(@ViewBuilder _ content: () -> C) -> some View {
        overlay(alignment: .top) {
            VStack(spacing: 0) {
                Color.clear
                    .frame(height: 50)
                    .ignoresSafeArea(edges: .top)
                    .allowsHitTesting(false)
                content()
                    .frame(maxWidth: .infinity)
                    // Fixed height = the Today week strip (80pt content + 4pt
                    // inset). Every page's pill is therefore the exact same
                    // size and position; only the contents differ. A flexible
                    // child (e.g. an accent capsule) now fills the pill height
                    // cleanly instead of being proposed the whole screen.
                    .frame(height: 84)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .stroke(Theme.line, lineWidth: 1)
                    )
                    .padding(.horizontal, 12)
            }
            .frame(maxWidth: .infinity)
        }
    }
}
