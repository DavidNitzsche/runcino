# faff.run v4 — Local Build

The v4 redesign, fully wired as a functional local app. Open `designs/faff.html` in a browser (or `localhost:4040/designs/faff.html`) to launch.

## What's working

### Single entry point
`faff.html` iframes the v4 site. You land on Overview; the nav inside each page drives between Overview → Training → Races → Health.

### Central data hub
**`designs/faff-store.js`** is the data layer. localStorage-backed, cross-tab synced, exposed as `window.FaffStore`. One source of truth that every page reads on load and writes to on actions.

```js
FaffStore.getState()          // full state object
FaffStore.setState(updater)   // mutate state (writes localStorage, fires listeners)
FaffStore.logCheckIn({ energy: 7, soreness: 3, stress: 2 })
FaffStore.todayCheckIn()      // null or { energy, soreness, stress, loggedAt }
FaffStore.recentCheckIns(14)  // [{ date, log }, ...] over the last N days
FaffStore.currentWeekPlan()   // this week's days from the plan
FaffStore.todayWorkout()      // today's day object from the plan
FaffStore.subscribe(fn)       // fires on local + cross-tab changes
FaffStore.resetState()        // wipe and reseed (debug)
FaffStore.fmtDayLabel(iso)    // '2026-05-16' → 'Sat May 16'
```

The seed state is the current production snapshot — same data the four approved pages were designed around.

### Three pieces of glue

- **`faff-bind.js`** — declarative binder. Tag any element with `data-today-label`, `data-plan-week`, `data-plan-phase`, `data-plan-race-days-away`, `data-vdot-anchor`, etc., and it gets filled from the store on load (and re-filled on store changes). See the script for the full list.
- **`faff-live.js`** — best-effort live API refresh. Tries to fetch `/api/overview` from production on each page load and update `[data-live=...]` surfaces. Currently blocked by CORS; the embedded snapshot is used. `web/middleware.ts` is committed locally with the CORS fix — once deployed, live fetching activates.
- Inline `<script>` per page — pages with structured data (lists, grids, timelines) render their content from the store using small inline render functions.

### What's actually rendering from the store

These are the surfaces that read from `FaffStore` instead of static HTML:

**Overview**
- Coach strip date label (`COACH · SAT MAY 16 · ...`)
- This Week strip (7 day-cols) — full plan data, today highlight, ✓ Done, strength badges, rest day
- Today's Check-In widget + writes to store on Log

**Health**
- Coach strip date label
- Hero eyebrow date label
- Top-right mini check-in + writes to store on Log
- Check-In Timeline (14-day strip) — rendered from store, today's column fills on log
- Hero "Check-In" trend row — flips to logged state when check-in exists

**Races**
- Recent Races list (6 rows) — rendered from `store.races.recent`
- Upcoming Races horizontal timeline (Today + 5 stations) — positions computed proportional to `daysAway`, placement alternates above/below

**Cross-page demo**
1. Open Overview → check-in widget shows "Log Check-In"
2. Adjust sliders → click Log → button flips to "✓ Logged"
3. Click Health in the nav → page loads, reads store, three things reflect the log:
   - Mini form is locked with your values
   - 14-day timeline today-column has three colored bars
   - Hero "Check-In" trend row flipped from grey "Not logged" to green with your values

Works in either direction. Cross-tab too — open Overview and Health in two tabs, log in one, the other updates live via the `storage` event.

### What's still hardcoded

The store has the data; the pages just haven't been refactored to template it yet. Next-pass targets:

- **Overview** — workout hero (today's EASY RUN), warmup/main/cooldown segments, strength callout meta, Path to Race card, Next Push card
- **Health** — 4-section coach brief, Training Load chart (CTL/ATL paths + race markers), Recovery Vitals tiles, Running Form tiles, Insights bullets
- **Training** — 14-week calendar grid, phase rows, paces card, Plan Adapted
- **Races** — A-race hero, VDOT card, PRs grid

These would follow the same pattern: replace static markup with a `<div id="x">`, write a `renderX()` reading from the store, subscribe. ~1 hour per surface.

## File map

```
designs/
  faff.html             — single entry SPA wrapper
  faff-store.js         — central state hub (data layer)
  faff-bind.js          — declarative data-* binder for labels
  faff-live.js          — best-effort live API refresh
  README-v4.md             — this file
  overview-v4.html         — Overview page (approved)
  training-v4.html         — Training page (approved)
  races-v4.html            — Races page (approved)
  health-v4.html           — Health page (approved)
  log-v4.html              — Log page (draft, unapproved)
  profile-v4.html          — Profile page (draft, unapproved)
  race-plan-v4.html        — Race-plan detail (needs trim pass)
web/
  middleware.ts            — CORS for /api/* (unlocks live fetch when deployed)
```

## Debug

- **Reset state** in dev console: `FaffStore.resetState()` then refresh
- **Inspect state**: `FaffStore.getState()` returns the full object
- **Mutate state**: `FaffStore.setState(s => ({...s, today: '2026-05-15'}))` — all bound surfaces re-render
- **Force re-render**: subscribers re-fire on any `setState`; pages render fresh on load

## Push live

The "push live" step is to port `designs/*-v4.html` markup into the corresponding `web/app/*/page.tsx` Next.js components. The render patterns in the inline scripts translate cleanly to React (Zustand/Context for the store, useEffect for subscribe, JSX templates for what's currently in template strings). The seed in `faff-store.js` documents the data contract the Next.js pages need from the API.
