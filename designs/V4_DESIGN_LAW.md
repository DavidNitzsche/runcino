# faff.run v4 · Design Law

This document is the source of truth for the v4 visual system. It was
derived from `designs/overview-v4.html` (the approved mockup) and is
implemented in code as `web/app/components/v4/tokens.ts`. When you
draft a new page mockup, **read this first.** When you write a new
primitive, import from `tokens.ts` instead of inlining magic numbers.

The trust contract on data ("every number is real, coach-computed, or
honest NO DATA YET") has a sibling: the visual contract on layout.
Every page should feel like the same product. That happens by making
the system invariant, not by hoping the next designer remembers the
rules.

---

## Core principles

1. **Simplification beats addition.** The v4 redesign of /overview
   killed twelve secondary cards in favor of three primary sections.
   When in doubt, leave it out.
2. **Cards are quiet.** White surface, subtle shadow, no border. Color
   only when it carries meaning.
3. **Bebas Neue for numbers and titles. Inter for body. Oswald for
   sub-headers.** Never mix. Never substitute.
4. **One column rhythm.** Every row divides 12 cols. No full-width
   rows that break the grid (the previous /overview had two of these
   and they looked wrong).
5. **Spacing is finite.** Six allowed gap values (see `SPACING`). If
   you want a value not in the list, you're probably wrong.
6. **Bottom-anchored sections.** When two pieces sit side-by-side (the
   coach strip's briefing left + check-in right), they stretch to the
   same height — `align-items: stretch`, not centered.

---

## Spacing table

Only these values may be used for spacing. Anything else is a bug.

| Token | Value | When |
|---|---|---|
| `SPACING.rowGap` | `16px` | Between two adjacent rows on the page (coach strip → hero, hero → week strip). Also between cells in a multi-cell row. |
| `SPACING.pageEdge` | `40px` | Left/right page margin (already set by `<Stage>`). |
| `SPACING.cardPadding` | `40px` | Interior padding of hero card columns, modal bodies. The default for any card big enough to host its own content layout. |
| `SPACING.cardPaddingTight` | `24px` | Smaller cards / day columns inside the week strip / check-in panel on the coach strip. |
| `SPACING.blockGap` | `14px` | Inside a card — between a label and its value, between a row and its bar. Not a section gap. |
| `SPACING.inlineGap` | `10px` | Inline gap between same-type elements (stat pills next to each other, day columns inside the week grid, dot separators). |

If you need a value outside this list, the answer is usually
"compose two existing spacings together" (e.g., a 30px feel = `24px`
padding + `6px` margin somewhere natural) or "your layout doesn't
match the doctrine."

---

## Sizing table

Fixed widths, heights, and radii. Anything not on this list does not
exist in the system.

| Token | Value | When |
|---|---|---|
| `SIZING.pageMaxWidth` | `1280px` | The page's outer max-width. Larger feels too wide. |
| `SIZING.heroRightCol` | `460px` | The hero card's right column. Never flexes. Left column gets the rest. |
| `SIZING.coachCheckinWidth` | `300px` | The check-in card on the coach strip. Fixed; briefing flex fills the rest. |
| `SIZING.coachStripMinHeight` | `160px` | Coach strip never shrinks below this — keeps short briefings from collapsing the layout. |
| `SIZING.heroRadius` | `20px` | Hero card. |
| `SIZING.weekRadius` | `16px` | Week card (smaller than hero on purpose). |
| `SIZING.modalRadius` | `24px` | Modals — softer than cards. |
| `SIZING.pillRadius` | `10px` | Stat pills, buttons. |
| `SIZING.chipRadius` | `8px` | Smaller chips, slider tracks. |
| `SIZING.dotRadius` | `50%` | Circular indicators (the coach pulse dot, slider thumbs). |

---

## Typography ladder

Every font / size / weight / letter-spacing combination is enumerated in
`TYPE`. Pick one of these; don't invent.

| Token | Use |
|---|---|
| `TYPE.heroTitle` | Bebas Neue 300px / .86 / -4px letter-spacing. The big workout title on the hero card. There is only ONE of these on a page. |
| `TYPE.modalTitle` | Bebas Neue 88px / .86. Workout-detail modal title. |
| `TYPE.scheduleTitle` | Bebas Neue 52px / 1.0. "Full Schedule" header. |
| `TYPE.briefing` | Inter 22px / 1.5. The coach strip briefing. Trim copy, never the size. |
| `TYPE.statValue` | Bebas Neue 32px / 1.0. Stat pill big number. |
| `TYPE.statUnit` | Inter 13px. The "mi" / "/mi" / "min" / "bpm" next to a stat value. |
| `TYPE.dayDate` | Bebas Neue 28px / 1.0. Day-of-month in the week strip. |
| `TYPE.sliderValue` | Bebas Neue 20px / 1.0. The number badge next to each check-in slider. |
| `TYPE.label` | Inter 12px / 1.5px tracking / upper. Pill / stat / trend labels. |
| `TYPE.eyebrow` | Inter 12px / 2.5px tracking / upper. Sits above a hero or modal title. |
| `TYPE.coachLabel` | Same as eyebrow. The "● COACH · THU MAY 15 · BASE WEEK 3" line. |
| `TYPE.subHeader` | Oswald 13px semibold / 1px tracking / upper. Segment row labels, day workout names. |
| `TYPE.button` | Oswald 13px semibold / 1.5px tracking / upper. Button copy. |
| `TYPE.note` | Inter 13px italic / dim. The coach-voice note under the intensity bar. |

---

## Color use

Colors that carry meaning:

| Token | Means |
|---|---|
| `COLOR.recovery` (green #2CA82F) | On plan, done, healthy, easy zone. Default positive. |
| `COLOR.milestone` (amber #D4900A) | Today, taper, "in progress," watching. Halfway between go and stop. |
| `COLOR.race` (orange #E85D26) | Brand, A-race, race day. Use sparingly — too much makes the page feel alarmed. |
| `COLOR.warn` (red #F43F5E) | Errors only. Not "behind on plan" — that's amber. |
| `COLOR.ink` (#0D0F12) | Primary text. Buttons. The dominant ink. |
| `COLOR.textMuted` | Secondary text — values inside cards. |
| `COLOR.textDim` | Tertiary — labels, eyebrows. |
| `COLOR.textFaint` | Quaternary — em-dashes for rest days. |
| Wash variants (`*Wash`) | Background tints behind chips, badges, today columns. Always combined with the same-color text. |

---

## Layout rules

1. **Every row divides 12 cols.** `<Row>` from `@/app/components`
   does this; v4 cards inside compose to `6 + 6` or `6 + 3 + 3` or
   `8 + 4`, never `12`.
2. **No full-width rows** for content that wants a card. Full-width is
   reserved for sections like the coach strip and the week card, which
   are visually "their own section" (not part of a tile grid). Even
   they respect the `pageEdge` padding.
3. **Cards stack from heaviest to lightest.** The hero is the
   centerpiece; everything below it should feel quieter (smaller
   border-radius, less padding, less color).
4. **Adjacent cards stretch to the same height** when they share a
   row. `align-items: stretch` on the flex container. The short
   sibling pads with its own content; never pad with whitespace.
5. **Empty states collapse the slot, not reserve it.** If `narrative`
   is null, the narrative line renders nothing — no placeholder bar.
6. **Skeletons mirror the final layout.** Loading state has the same
   row heights as the loaded state so the page doesn't jump.

---

## When you draft a new page mockup

1. Sketch with the three v4 primitives in mind: coach strip (if the
   page has a coach voice), hero card (if there's a single "thing of
   the day"), week strip / list (the bottom-rhythm section).
2. Use only the values in `SPACING`, `SIZING`, and `TYPE`.
3. Use only the colors in `COLOR`.
4. Compose into 12-col rows. No full-width content cards.
5. When you're done, you should be able to point at every numeric
   value on the screen and name a token. If you can't, it's wrong.
6. Save the HTML mockup to `designs/<page>-v4.html`. The coding pass
   then ports it using the same primitives.

---

## When you build a new primitive

1. Import from `web/app/components/v4/tokens.ts`. Never inline a
   value the token covers.
2. If the new primitive needs a value not in `tokens.ts`, stop and
   ask: should this be a new token, or is this primitive an exception?
   Most of the time, it's a new token — add it to `tokens.ts` with a
   doc comment explaining when it applies.
3. Use `'use client'` only if the component has interactivity. If
   it's render-only, leave it server-renderable for performance.
4. Type every prop. Default to required props; optional only when
   genuinely optional.
5. Empty states render nothing (return `null`) or a single em-dash
   token — never a placeholder shape that simulates content.

---

## Anti-patterns

Don't:

- Pick a font size by eye and hope it matches. Use `TYPE`.
- Add `margin-top: 18px` because "16px feels too tight." 16px is the
  rule. If it's tight in your case, your composition is wrong.
- Introduce a new shade of green or amber. Use the one that's there.
- Reuse `COLOR.race` for "warning." Race is for races. Warn is for
  errors.
- Build a card that's 100% width. The grid is 12. Use it.
- Stack two cards vertically without `SPACING.rowGap` between them.
- Render a placeholder skeleton inside a final layout. Skeletons
  match the final shape exactly.

---

## Migration status

Pages currently on v4 (in code, not just the mockup):
- [x] /overview — `web/app/overview/page.tsx`

Pages with a v4 mockup approved but not yet ported:
- *(none yet — /training is the next draft)*

Pages awaiting a v4 mockup:
- /training, /races, /health, /log, /profile

When a page is ported, add it to the "currently on v4" list.
