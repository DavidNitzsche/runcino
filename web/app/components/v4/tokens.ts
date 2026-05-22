/**
 * v4 design tokens, LAW.
 *
 * Every spacing, sizing, and typography value used by the v4 primitives
 * lives here. Components import these instead of inlining magic numbers.
 *
 * Rule of thumb when designing a new page:
 *   1. If you reach for a value, look here first. If it exists, use it.
 *   2. If it doesn't exist, ask whether the rule applies AND should be
 *      added to the system, or whether you genuinely need an exception.
 *      Exceptions go in the component, not in this file.
 *   3. Never invent a new spacing or font-size value that's "close to"
 *      an existing one. Either reuse or document why a new one belongs.
 *
 * Authority: derived from `designs/overview-v4.html`. See
 * `designs/V4_DESIGN_LAW.md` for the prose explanation of when each
 * token applies.
 */

// ─────────────────────────────────────────────────────────────────────
// Spacing, the only six values allowed for vertical/horizontal rhythm
// ─────────────────────────────────────────────────────────────────────

export const SPACING = {
  /** Between adjacent rows on a page (coach strip → hero, hero → week). */
  rowGap: '16px',
  /** Page edge padding (left/right on the main stage). Topbar respects this. */
  pageEdge: '40px',
  /** Standard card interior padding. Used on hero columns, schedule
   *  modal body, workout-detail modal body. */
  cardPadding: '40px',
  /** Tight card interior padding. Used on small cards like the
   *  check-in panel on the coach strip. */
  cardPaddingTight: '24px',
  /** Between elements inside a card (label → value, value → unit,
   *  stat row → segments table). Not a section gap. */
  blockGap: '14px',
  /** Tighter inline gap (between checkin sliders, between stat pills). */
  inlineGap: '10px',
} as const;

// ─────────────────────────────────────────────────────────────────────
// Sizing, fixed widths, heights, radii
// ─────────────────────────────────────────────────────────────────────

export const SIZING = {
  /** Page max-width. Anything larger feels too wide on desktop. */
  pageMaxWidth: '1280px',
  /** Right-column width of the hero card. Fixed, never flexes. The
   *  left column flexes to fill remaining space. */
  heroRightCol: '460px',
  /** Right-side check-in card width on the coach strip. */
  coachCheckinWidth: '300px',
  /** Min-height of the coach strip, keeps short briefings from
   *  collapsing the section. The briefing copy should trim to fit,
   *  not the strip shrink. */
  coachStripMinHeight: '160px',
  /** Hero card border radius. */
  heroRadius: '20px',
  /** Week card border radius. Smaller than hero on purpose, the
   *  hero is the centerpiece. */
  weekRadius: '16px',
  /** Modal card border radius. Larger than hero, modals feel softer. */
  modalRadius: '24px',
  /** Pill / button border radius. */
  pillRadius: '10px',
  /** Small chip / range track radius. */
  chipRadius: '8px',
  /** Slider thumb / dot radius, circular. */
  dotRadius: '50%',
  /** Standard button vertical padding (matches v4 .btn-primary). */
  buttonPaddingY: '14px',
  /** Standard button horizontal padding. */
  buttonPaddingX: '32px',
  /** Readiness ring SVG dimensions. The math (r=130, 270° arc) is
   *  in components/v4/ReadinessRing.tsx; these are the canvas. */
  readinessRingSize: '300px',
} as const;

// ─────────────────────────────────────────────────────────────────────
// Typography, font, size, weight, letter-spacing, line-height
// ─────────────────────────────────────────────────────────────────────

export const FONT = {
  /** Display + numerics. Used for titles, stat values, day dates. */
  display: "'Bebas Neue', sans-serif",
  /** Body + labels. The default. */
  body: "'Inter', sans-serif",
  /** Sub-headers (segment row labels, day workout names, button copy). */
  sub: "'Oswald', sans-serif",
  /** Monospaced numerics (used rarely; reserved for the topbar clock
   *  and any audit trail UI). */
  mono: "'JetBrains Mono', monospace",
} as const;

export const TYPE = {
  /** The big workout title on the hero card. Bebas Neue, 300px, line-
   *  height .86 (Bebas Neue has built-in side-bearing; we compensate
   *  with margin-left:-6px to align the ink with the eyebrow above). */
  heroTitle: {
    fontFamily: FONT.display,
    fontSize: '300px',
    lineHeight: 0.86,
    letterSpacing: '-4px',
  },
  /** Modal title (compact hero, same shape, smaller scale). */
  modalTitle: {
    fontFamily: FONT.display,
    fontSize: '88px',
    lineHeight: 0.86,
    letterSpacing: 'normal',
  },
  /** Schedule-modal title, between hero and modal. */
  scheduleTitle: {
    fontFamily: FONT.display,
    fontSize: '52px',
    lineHeight: 1,
  },
  /** Coach briefing body. The whole strip. Never less than 22px;
   *  trim the copy instead of shrinking the type. */
  briefing: {
    fontFamily: FONT.body,
    fontSize: '22px',
    lineHeight: 1.5,
    fontWeight: 400,
  },
  /** Stat pill value (5.5, 9:15, ~52, ≤145). Bebas Neue, 32px. */
  statValue: {
    fontFamily: FONT.display,
    fontSize: '32px',
    lineHeight: 1,
  },
  /** Stat pill unit (mi, /mi, min, bpm), sits to the right of the
   *  value at the same baseline. */
  statUnit: {
    fontFamily: FONT.body,
    fontSize: '13px',
    color: 'rgba(13,15,18,.55)',
  },
  /** Day-of-month in the week strip. Bebas Neue, 28px. */
  dayDate: {
    fontFamily: FONT.display,
    fontSize: '28px',
    lineHeight: 1,
  },
  /** Slider value badge on the check-in (the "6" next to Energy). */
  sliderValue: {
    fontFamily: FONT.display,
    fontSize: '20px',
    lineHeight: 1,
    color: 'rgba(13,15,18,.55)',
  },
  /** Mid-emphasis label inside cards, pill labels, stat labels,
   *  trend labels. 12px Inter uppercase, tight tracking. */
  label: {
    fontFamily: FONT.body,
    fontSize: '12px',
    letterSpacing: '1.5px',
    color: 'rgba(13,15,18,.35)',
    textTransform: 'uppercase' as const,
  },
  /** Eyebrow above a title. Used at the top of the hero, modals.
   *  Wider tracking than .label. */
  eyebrow: {
    fontFamily: FONT.body,
    fontSize: '12px',
    letterSpacing: '2.5px',
    color: 'rgba(13,15,18,.35)',
    textTransform: 'uppercase' as const,
  },
  /** Sub-header style, segment row label, day workout name.
   *  Oswald 13px semibold. */
  subHeader: {
    fontFamily: FONT.sub,
    fontWeight: 600,
    fontSize: '13px',
    letterSpacing: '1px',
    textTransform: 'uppercase' as const,
  },
  /** Button copy. Oswald 13px semibold with wider tracking. */
  button: {
    fontFamily: FONT.sub,
    fontWeight: 600,
    fontSize: '13px',
    letterSpacing: '1.5px',
    textTransform: 'uppercase' as const,
  },
  /** Small italic note under the intensity bar. Inter 13px italic. */
  note: {
    fontFamily: FONT.body,
    fontSize: '13px',
    fontStyle: 'italic' as const,
    color: 'rgba(13,15,18,.35)',
    lineHeight: 1.55,
  },
  /** Coach-strip label (the "● COACH · THU MAY 15 · BASE WEEK 3" line).
   *  Same as eyebrow but with even wider tracking. */
  coachLabel: {
    fontFamily: FONT.body,
    fontSize: '12px',
    letterSpacing: '2.5px',
    color: 'rgba(13,15,18,.35)',
    textTransform: 'uppercase' as const,
  },
} as const;

// ─────────────────────────────────────────────────────────────────────
// Color tokens, pull from globals.css, but the v4 primitives need
// them as inline-style values. The recovery green and amber milestone
// are referenced across cards; warn-red for errors only.
// ─────────────────────────────────────────────────────────────────────

export const COLOR = {
  /** Page background. */
  bg: 'var(--bg, #E6E8EF)',
  /** Card surface. */
  surface: 'var(--surface, #FFFFFF)',
  /** Hero-right tinted surface (right column of the hero card). */
  surfaceTint: 'rgba(13,15,18,.02)',
  /** Primary ink. */
  ink: 'var(--ink, #080808)',
  /** Body-text muted. */
  textMuted: 'rgba(13,15,18,.55)',
  /** Label / eyebrow text, even more muted. */
  textDim: 'rgba(13,15,18,.35)',
  /** Faintest text (rest day em-dash, used sparingly). */
  textFaint: 'rgba(13,15,18,.20)',
  /** Borders / dividers. */
  line: 'rgba(13,15,18,.08)',
  /** Heavier border (button outline). */
  lineHeavy: 'rgba(13,15,18,.20)',
  /** Stat pill / segment cell background. */
  cellWash: 'rgba(13,15,18,.04)',
  /** Track background on progress bars + signal bars. */
  trackBg: 'rgba(13,15,18,.07)',
  /** Range slider unfilled. */
  trackBgRange: 'rgba(13,15,18,.10)',

  // Semantic
  recovery: 'var(--recovery, #3EBD41)',
  recoveryWash: 'rgba(62,189,65,.06)',
  recoveryBadgeWash: 'rgba(62,189,65,.12)',
  milestone: 'var(--milestone, #F3AD38)',
  milestoneWash: 'rgba(212,144,10,.12)',
  todayWash: 'rgba(232,93,38,.04)',
  warn: 'var(--warn, #FC4D64)',
  warnWash: 'rgba(244,63,94,.12)',
  race: 'var(--race, #E88021)',
} as const;

// ─────────────────────────────────────────────────────────────────────
// Shadow tokens
// ─────────────────────────────────────────────────────────────────────

export const SHADOW = {
  /** Standard card elevation. Used on every white card. */
  card: '0 1px 3px rgba(0,0,0,.06), 0 4px 16px rgba(0,0,0,.04)',
  /** Modal elevation, heavier. */
  modal: '0 24px 80px rgba(0,0,0,.22)',
  /** Slider thumb. */
  thumb: '0 1px 6px rgba(0,0,0,.16)',
} as const;

// ─────────────────────────────────────────────────────────────────────
// Layout grid, column rhythm. All rows on a v4 page divide 12.
// ─────────────────────────────────────────────────────────────────────

export const GRID = {
  /** Total columns the page divides into. Never use 13+. */
  cols: 12,
  /** Gap between cells in a multi-cell row. */
  gap: SPACING.rowGap,
} as const;

// ─────────────────────────────────────────────────────────────────────
// Re-export as a flat namespace for convenience.
// ─────────────────────────────────────────────────────────────────────

export const TOKENS = {
  SPACING,
  SIZING,
  FONT,
  TYPE,
  COLOR,
  SHADOW,
  GRID,
} as const;
