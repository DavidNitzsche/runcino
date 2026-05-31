# Faff · Design System

Faff is a running‑training product with a coach at its center. It builds a plan around what you are
chasing (a race, a goal time, or just staying consistent), is honest about where you stand today, and
adapts every day from your own training data. Two surfaces share one language: a **dark‑first iOS app**
and a **web app**.

The signature idea is the **effort temperature scale**: every run and every day has a temperature, from
cool (recovery) to hot (race). That temperature drives a living, blurred color **mesh** behind the UI and
the accent colors on top, so the nav and screens themselves carry the system's identity.

## Sources this was distilled from
- `Faff Web App.html` · the canonical web app (sidebar nav, Today/Train/Activity/Health/Targets, gate flow, Pro). Type system source of truth.
- `screens/` · the 28 approved iOS screens (front door, 5 tabs, detail/live, profile, coach moments, social).
- `Faff App.html` + `app/` · the iOS screens assembled into one navigable iPhone shell.
- `HANDOFF.md` · the iOS build spec (navigation map, fonts, what is still needed).

## Products
1. **Faff iOS** · dark, full‑bleed, effort‑mesh backgrounds, bottom tab bar, drag‑up detail sheets, live/watch.
2. **Faff Web** · same language on a sidebar layout, denser instrument panels (Gap · Race Day · Volume · Form), overlays for run detail / Pro / weekly check‑in.

---

## CONTENT FUNDAMENTALS

**Voice.** A sharp, encouraging coach. Confident and plain‑spoken, never hype, never cute. It tells you
the truth ("you're 11 min to find") and then points at the next action ("now let's start running and close it").

**Person.** Second person throughout. "You", "your running", "what are you chasing?". The coach refers to
itself only as **FAFF** / "Faff Coach" on coach surfaces.

**Casing.**
- Display headlines and big numerics: often **UPPERCASE** on web (Oswald), mixed‑case on iOS hero titles. Both are valid; pick per surface.
- Eyebrows / section labels / metrics keys: **UPPERCASE**, letter‑spaced (e.g. `THIS WEEK`, `GOAL TIME`, `DAYS OUT`).
- Body and supporting copy: sentence case.

**Punctuation.** Use the middot `·` as the separator in meta lines (`8.0 mi · 6:38 /mi · readiness 82`).
**Never use em dashes.** Use periods, commas, or `·`. En dashes are fine only for numeric ranges (`May 19–25`).

**Numbers are the hero.** Paces, distances, times, countdowns, gaps and scores are set large in Oswald and
do a lot of the talking. Keep units small and dimmed beside them (`3:00:00`, `191 DAYS OUT`, `8.0 mi`).

**No emoji.** Ever. Meaning is carried by color (effort), line icons, and type.

**Sample copy.**
- "Your running, coached."
- "What are you chasing?"
- "Bring your history in." / "We'll pull in every run so Faff is alive from minute one."
- "Train like it's your job." (Pro)
- "You're 11 min to find." · "Now let's start running and close it."
- "A rest day reads as earned and intentional."

---

## VISUAL FOUNDATIONS

**Theme.** Dark‑first. Base canvas `#0A0C10`. Content sits on either the near‑black base or a colored
**effort mesh**.

**The effort mesh (signature).** A full‑bleed background of large, heavily blurred radial color blobs
(`blur ~40px`) that slowly drift (20–30s `ease-in-out infinite`) and **re‑theme over ~0.7s** when the
effort/temperature changes. Each state has a 5‑stop palette plus a dark base (see `--mesh-*` tokens:
ember for race/tempo, cool teal for onboarding/sign‑in, green "you" for profile/health). A faint **grain**
overlay (~5% opacity, `mix-blend: overlay`) sits on top, plus **protection scrims** (top and bottom
vertical gradients) so white text stays legible over bright mesh.

**Glass.** Panels and cards over the mesh are translucent (`rgba(255,255,255,.05–.08)`) with a hairline
white border (`rgba(255,255,255,.12)`) and `backdrop-filter: blur(16px)`. On the solid web canvas, cards
are `#11141A` with an 8% white hairline.

**Type.** Anton for the wordmark only; Oswald (condensed, 500/600, tight tracking) for every headline and
number; Inter (400–800) for body, labels, buttons. Hero numerics sometimes use a warm gradient clipped to
the text (`background-clip:text`).

**Color usage.** Neutrals carry the layout; the **effort scale** carries meaning. A run, a shoe, a zone, a
day are colored by their effort (recovery cool → race hot). `--positive` green (`#7BE8A0`) marks ahead/good.

**Corners.** Chips 14px · cards 18px · tiles 20px · sheets & pills 30px. iOS device screen ~54px.

**Elevation.** Soft, deep, low‑spread shadows (`0 12–22px 30–56px -18/-22px rgba(0,0,0,.4–.55)`). Sheets
cast an upward shadow. No hard 1px drop shadows.

**Motion.** Mesh drift + 0.7s re‑theme · drag‑up detail sheets and modals spring in
(`cubic-bezier(.32,.72,0,1)`, ~0.42s) · numbers count up on reveal · the projection "beam" scales in ·
press states scale to ~0.9–0.98 · web hovers lighten background and brighten borders. Nothing bounces
gratuitously; motion is calm and physical.

**Layout.** iOS: full‑bleed mesh, content in safe‑area padding, persistent bottom tab bar (translucent
blur), top status bar. Web: fixed left sidebar (collapsible) + scrolling main, instrument cards in a grid.

---

## ICONOGRAPHY

- **Line icons, Feather/Lucide style:** 24×24 viewBox, ~2px stroke, `stroke-linecap/linejoin: round`,
  `stroke: currentColor`, no fill. Used inline as SVG throughout both surfaces (tab bar, nav, rows, chips).
- A few **filled** glyphs appear for emphasis (Pro star, brand source logos like Apple Health / Strava / Garmin).
- **No emoji.** No icon font. Icons are inline SVG so they inherit `currentColor` and the effort accent.
- The brand **wordmark** is type, not a glyph: `FAFF` + a yellow dot (`#F5C518`) + `RUN`, set in Anton,
  skewed ‑9°, uppercase, with the animated rainbow sweep clipped to the text.
- For new work, **Lucide** (CDN) is the closest match to the existing set (same stroke weight and round caps).
  Substitute from there and keep the 2px round style. *(Flagged: the existing icons are hand‑placed inline
  SVGs in the screens, not a shared icon file. Reuse those, or adopt Lucide wholesale for consistency.)*

---

## INDEX
- `colors_and_type.css` · all color + type + shape + motion tokens (CSS variables).
- `color-system.md` · the canonical color export (effort dots, meshes, HR zones, shoe roles, accents). Match exactly.
- `brand-identity.html` · one-page visual brand identity sheet.
- `preview/` · Design System tab cards (type, color, effort scale, components, brand).
- `ui_kits/ios/` · the iOS app kit (assembled shell + 28 screens).
- `ui_kits/web/` · the web app kit (source of the design language).
- `screens/` · the 28 approved iOS screens (one file each, correct type system).
- `Faff App.html` + `app/` · navigable iOS shell (frame, tab bar, router).
- `HANDOFF.md` · iOS build spec for Claude Code (incl. Swift color scaffold).
- `SKILL.md` · how an agent should use this system.
