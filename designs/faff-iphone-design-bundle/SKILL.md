---
name: faff-design
description: Use this skill to generate well-branded interfaces and assets for Faff (a running-training app with a coach at its center), for production or throwaway prototypes/mocks. Contains the design language, color system, type, fonts, and the iOS + web UI kits.
user-invocable: true
---

# Faff design skill

Read `README.md` first, then explore the other files. Faff is a dark-first running-training
product whose signature is the **effort temperature** language: color always means effort (cool
recovery to hot race), and a blurred mesh background re-themes per the active workout.

## Where things live
- `README.md` · brand context, content + visual foundations, iconography, index.
- `colors_and_type.css` · all tokens as CSS variables. Import this first.
- `color-system.md` · the canonical color export (effort dots, meshes, HR zones, shoe roles, accents). Match exactly.
- `preview/` · the Design System cards (type, color, spacing, components, brand).
- `brand-identity.html` · the one-page identity sheet.
- `ui_kits/ios/` and `ui_kits/web/` · high-fidelity recreations of each surface.
- `screens/` · the 28 approved iOS screens (one file each).
- `HANDOFF.md` · the iOS build spec (incl. a Swift `Color+Faff` scaffold).

## How to use
- **Visual artifacts** (slides, mocks, throwaway prototypes): copy the fonts (Anton / Oswald / Inter),
  link or inline `colors_and_type.css`, copy the components you need from a UI kit, and output static
  HTML for the user to view. Put the FAFF·RUN wordmark in Anton with the animated sweep and round gold dot.
- **Production code**: read the rules here and the `color-system.md` tokens to design on-brand. For iOS,
  bundle the three fonts and use the canonical colors verbatim.

## Non-negotiables
- Type roles: Anton = wordmark only; Oswald = display + ALL numerics (condensed, uppercase-leaning);
  Inter = body / labels / buttons.
- Color = effort. Never invent accent colors; pull from `color-system.md`.
- Dark-first. Glass panels over the mesh. No emoji.
- **Never use em dashes.** Use periods, commas, or the middot ·. En dashes only for numeric ranges.

If invoked with no guidance, ask what the user wants to build, ask a few questions, then act as an
expert Faff designer and output HTML artifacts or production code as needed.
